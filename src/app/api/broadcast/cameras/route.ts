import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { requireBroadcastManager } from '@/lib/broadcast/auth';
import { cloudflareBroadcastProvider, CloudflareStreamError } from '@/lib/cloudflare/stream';
import { createLiveInputViaWorker, deleteLiveInputViaWorker } from '@/lib/liveStreaming/workerClient';
import { findCourseLocation, getBroadcastCourseLocations, getDefaultCoverageRadiusForCameraType } from '@/lib/broadcast/courseLocations';
import { deleteLiveCameraDocument, loadEventLiveCameras, mirrorLiveCameraDocument, getLiveCameraDocRef } from '@/lib/broadcast/liveCameras';
import { CloudflareStreamCredentialMutationError, ProviderSecretConfigurationError, decryptStreamKey, encryptStreamKey, sha256Hex } from '@/lib/broadcast/security';
import { validateCloudflareCredentials } from '@/lib/broadcast/cloudflareCompatibility';
import type { ApiResponse, BroadcastCamera, BroadcastCameraStatus, BroadcastCameraType, BroadcastCourseLocation, BroadcastProvider } from '@/lib/types/broadcast';

export const dynamic = 'force-dynamic';

function ok<T>(data: T) {
  return NextResponse.json({ success: true, data } as ApiResponse<T>);
}

function fail(code: string, message: string, status = 400, details?: any) {
  return NextResponse.json({ success: false, error: { code, message, details } } as ApiResponse<never>, { status });
}

function mapStatus(value: unknown): BroadcastCameraStatus {
  const v = String(value || '').trim().toLowerCase();
  if (
    [
      'offline',
      'waiting_for_stream',
      'connecting',
      'live',
      'stopping',
      'archived',
      'authentication_failed',
      'invalid_stream_key',
      'connection_timed_out',
      'signal_lost',
      'recording',
      'error',
      'disabled',
    ].includes(v)
  ) {
    return v as BroadcastCameraStatus;
  }
  return 'offline';
}

function mapType(value: unknown): BroadcastCameraType {
  const v = String(value || '').trim().toLowerCase();
  if (
    [
      'finish',
      'swim',
      'stage',
      'swim_exit',
      'transition',
      'transition_entry',
      'transition_exit',
      'bike',
      'bike_turnaround',
      'run',
      'aid_station',
      'awards',
      'medical',
      'interview',
      'expo',
      'mobile',
      'drone',
      'motorcycle',
      'lead_vehicle',
      'custom',
    ].includes(v)
  ) return v as BroadcastCameraType;
  return 'custom';
}

async function loadCourseLocations(eventId: string): Promise<BroadcastCourseLocation[]> {
  const db = getFirestoreInstance();
  const snap = await db.collection('events').doc(eventId).get();
  const eventData = snap.exists ? snap.data() || {} : {};
  return getBroadcastCourseLocations(Array.isArray((eventData as any)?.broadcastCourseLocations) ? (eventData as any).broadcastCourseLocations : null);
}

export async function GET(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);

  const eventId = String(req.nextUrl.searchParams.get('eventId') || '').trim();
  if (!eventId) return fail('invalid_request', 'eventId is required', 400);

  const db = getFirestoreInstance();
  const [cameras, courseLocations] = await Promise.all([
    loadEventLiveCameras(db, eventId),
    loadCourseLocations(eventId),
  ]);

  const stats = {
    live: cameras.filter((c: any) => c.status === 'live' || c.status === 'recording').length,
    offline: cameras.filter((c: any) => c.status !== 'live' && c.status !== 'recording').length,
    connecting: cameras.filter((c: any) => c.status === 'connecting' || c.status === 'waiting_for_stream').length,
    disabled: cameras.filter((c: any) => c.status === 'disabled').length,
    viewers: cameras.reduce((sum: number, c: any) => sum + Number(c.viewerCount || 0), 0),
    averageLatency: cameras.length > 0 ? Math.round(cameras.reduce((sum: number, c: any) => sum + Number(c.latency || 0), 0) / cameras.length) : 0,
  };

  return ok({ eventId, cameras, stats, courseLocations });
}

export async function POST(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);

  const body = await req.json().catch(() => null);
  if (!body) return fail('invalid_body', 'Request body is required', 400);

  const eventId = String(body.eventId || '').trim();
  const name = String(body.name || '').trim();
  const provider = (String(body.provider || 'cloudflare').trim().toLowerCase() || 'cloudflare') as BroadcastProvider;
  const cameraType = mapType(body.cameraType);
  const locationMode = String(body.locationMode || 'fixed').trim().toLowerCase() === 'mobile' ? 'mobile' : 'fixed';
  const courseLocations = await loadCourseLocations(eventId);
  const selectedLocation = findCourseLocation(body.courseLocationId || body.assignedLocation || body.assignedLocationName || '', courseLocations) || findCourseLocation(body.courseLocationName || '', courseLocations);
  const shouldUseAutoLocation = locationMode === 'fixed' && !!selectedLocation;
  const liveWorkerConfigured = Boolean(process.env.LIVE_STREAM_WORKER_URL || process.env.NEXT_PUBLIC_LIVE_STREAM_WORKER_URL);
  const db = getFirestoreInstance();
  const cameraId = db.collection('broadcastCameras').doc().id;
  const ref = getLiveCameraDocRef(db, eventId, cameraId);

  if (!eventId || !name) return fail('invalid_request', 'eventId and name are required', 400);
  if (provider !== 'cloudflare') return fail('unsupported_provider', 'Only Cloudflare is currently supported', 400);

  let liveInput;
  try {
    liveInput = await createLiveInputViaWorker({
      eventId,
      cameraId: ref.id,
      name,
      cameraType,
      recordingMode: 'off',
    });
  } catch (error: any) {
    console.warn('[broadcast-cameras][worker-create-live-input-failed]', {
      eventId,
      name,
      message: String(error?.message || error || 'Unknown worker error'),
    });

    if (liveWorkerConfigured) {
      return fail('live_worker_error', String(error?.message || 'Live worker request failed'), 502);
    }

    try {
      liveInput = await cloudflareBroadcastProvider.createLiveInput({
        name,
        meta: {
          eventId,
          cameraType,
        },
      });
    } catch (fallbackError: any) {
      const message = fallbackError instanceof CloudflareStreamError
        ? fallbackError.message
        : String(fallbackError?.message || 'Cloudflare Stream request failed');
      const code = fallbackError instanceof CloudflareStreamError
        ? fallbackError.code
        : 'cloudflare_api_error';
      const status = fallbackError instanceof CloudflareStreamError
        ? (fallbackError.status === 401 || fallbackError.status === 403 ? 502 : Math.max(400, Math.min(599, fallbackError.status || 502)))
        : 502;

      console.warn('[broadcast-cameras][create-live-input-failed]', {
        eventId,
        name,
        code,
        message,
        details: fallbackError instanceof CloudflareStreamError ? fallbackError.details : null,
      });

      return fail(code, message, status, fallbackError instanceof CloudflareStreamError ? fallbackError.details : undefined);
    }
  }

  const nowIso = new Date().toISOString();
  const defaultRadius = getDefaultCoverageRadiusForCameraType(cameraType);
  const latitude = shouldUseAutoLocation ? selectedLocation!.latitude : (locationMode === 'mobile' ? (body.latitude ?? null) : (body.latitude ?? selectedLocation?.latitude ?? null));
  const longitude = shouldUseAutoLocation ? selectedLocation!.longitude : (locationMode === 'mobile' ? (body.longitude ?? null) : (body.longitude ?? selectedLocation?.longitude ?? null));
  const coverageRadius = body.coverageRadius ?? selectedLocation?.coverageRadius ?? defaultRadius;

  const camera: BroadcastCamera = {
    cameraId: ref.id,
    eventId,
    name,
    cameraType,
    provider,
    locationMode,
    courseLocationId: selectedLocation?.id || null,
    courseLocationName: selectedLocation?.name || String(body.assignedLocation || '').trim() || null,
    cloudflare: {
      liveInputUid: liveInput.liveInputUid,
      playbackUid: null,
      playbackUrl: null,
      videoUid: null,
      recordingUid: null,
      thumbnailUrl: null,
      durationSeconds: null,
      rtmpsUrl: liveInput.rtmpsUrl,
      streamKeyEncrypted: null,
      recordingMode: 'off',
    },
    status: 'waiting_for_stream',
    priority: Number(body.priority || 0),
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    coverageRadius: Number(coverageRadius || 0) || null,
    playbackDelay: body.playbackDelay ?? null,
    overlayTheme: body.overlayTheme ?? null,
    recordingQuality: body.recordingQuality ?? null,
    customMetadata: body.customMetadata ?? null,
    viewerCount: 0,
    latency: 0,
    recordingEnabled: Boolean(body.recordingEnabled),
    signal: null,
    battery: null,
    assignedLocation: String(body.assignedLocation || '').trim() || null,
    previewThumbnail: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastStreamStartedAt: null,
    lastStreamEndedAt: null,
    lastHealthCheckAt: nowIso,
    healthScore: 60,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  try {
    const originalStreamKey = String(liveInput.streamKey || '');
    const originalStreamKeyHash = sha256Hex(originalStreamKey);
    const cloudflareValidation = validateCloudflareCredentials({
      uid: liveInput.liveInputUid,
      rtmps: {
        url: liveInput.rtmpsUrl,
        streamKey: originalStreamKey,
      },
    });

    console.info('===== CLOUDFLARE STREAM VALIDATION =====');
    console.info(cloudflareValidation);
    if (originalStreamKey.endsWith(String(liveInput.liveInputUid || ''))) {
      console.info("INFO: Cloudflare returned composite credential format (token + 'k' + uid)");
    }

    console.info('[broadcast-cameras][stream-key-initial]', {
      eventId,
      cameraId: ref.id,
      liveInputUid: liveInput.liveInputUid,
      streamKey: originalStreamKey,
      length: originalStreamKey.length,
      sha256: originalStreamKeyHash,
      first10: originalStreamKey.slice(0, 10),
      last10: originalStreamKey.slice(-10),
      typeof: typeof liveInput.streamKey,
      rtmpsUrl: liveInput.rtmpsUrl,
      rtmpsUrlLength: String(liveInput.rtmpsUrl || '').length,
      rtmpsUrlType: typeof liveInput.rtmpsUrl,
    });

    const encryptedStreamKey = encryptStreamKey(originalStreamKey);
    const decryptedStreamKey = decryptStreamKey(encryptedStreamKey);
    if (decryptedStreamKey !== originalStreamKey) {
      throw new CloudflareStreamCredentialMutationError('STREAM KEY ENCRYPTION CORRUPTED');
    }

    console.info('[broadcast-cameras][stream-key-roundtrip]', {
      eventId,
      cameraId: ref.id,
      liveInputUid: liveInput.liveInputUid,
      original: originalStreamKey,
      originalHash: originalStreamKeyHash,
      encrypted: encryptedStreamKey,
      decrypted: decryptedStreamKey,
      encryptedLength: encryptedStreamKey.length,
      decryptedLength: decryptedStreamKey.length,
      decryptedHash: sha256Hex(decryptedStreamKey),
    });

    camera.cloudflare = {
      ...(camera.cloudflare || {}),
      streamKeyEncrypted: encryptedStreamKey,
    };

    const payload = {
      ...camera,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: auth.uid,
      updatedBy: auth.uid,
    };

    await mirrorLiveCameraDocument(db, eventId, ref.id, payload);
  } catch (error: any) {
    try {
      await cloudflareBroadcastProvider.deleteLiveInput(liveInput.liveInputUid);
    } catch (cleanupError: any) {
      console.warn('[broadcast-cameras][cleanup-live-input-failed]', {
        eventId,
        cameraId: ref.id,
        liveInputUid: liveInput.liveInputUid,
        message: String(cleanupError?.message || cleanupError || 'Unknown cleanup error'),
      });
    }

    if (error instanceof ProviderSecretConfigurationError) {
      return fail(error.code, error.message, 500);
    }

    if (error instanceof CloudflareStreamCredentialMutationError) {
      return fail(error.code, error.message, 500);
    }

    throw error;
  }

  await db.collection('broadcastEvents').doc(eventId).set({
    eventId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return ok({ camera });
}

export async function PUT(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);

  const body = await req.json().catch(() => null);
  const cameraId = String(body?.cameraId || '').trim();
  if (!cameraId) return fail('invalid_request', 'cameraId is required', 400);

  const db = getFirestoreInstance();
  const legacySnap = await db.collection('broadcastCameras').doc(cameraId).get();
  const nestedEventId = legacySnap.exists ? String((legacySnap.data() as any)?.eventId || '').trim() : '';
  const ref = getLiveCameraDocRef(db, nestedEventId, cameraId);
  const snap = legacySnap.exists ? legacySnap : await ref.get();
  if (!snap.exists) return fail('not_found', 'Camera not found', 404);

  const patch: Record<string, any> = {};
  if (body.name !== undefined) patch.name = String(body.name || '').trim();
  if (body.cameraType !== undefined) patch.cameraType = mapType(body.cameraType);
  if (body.status !== undefined) patch.status = mapStatus(body.status);
  if (body.priority !== undefined) patch.priority = Number(body.priority || 0);
  if (body.locationMode !== undefined) patch.locationMode = String(body.locationMode || '').trim().toLowerCase() === 'mobile' ? 'mobile' : 'fixed';
  if (body.courseLocationId !== undefined) patch.courseLocationId = String(body.courseLocationId || '').trim() || null;
  if (body.courseLocationName !== undefined) patch.courseLocationName = String(body.courseLocationName || '').trim() || null;
  if (body.latitude !== undefined) patch.latitude = body.latitude;
  if (body.longitude !== undefined) patch.longitude = body.longitude;
  if (body.coverageRadius !== undefined) patch.coverageRadius = body.coverageRadius;
  if (body.playbackDelay !== undefined) patch.playbackDelay = body.playbackDelay;
  if (body.overlayTheme !== undefined) patch.overlayTheme = String(body.overlayTheme || '').trim() || null;
  if (body.recordingQuality !== undefined) patch.recordingQuality = String(body.recordingQuality || '').trim() || null;
  if (body.customMetadata !== undefined) patch.customMetadata = body.customMetadata;
  if (body.recordingEnabled !== undefined) patch.recordingEnabled = Boolean(body.recordingEnabled);
  if (body.assignedLocation !== undefined) patch.assignedLocation = String(body.assignedLocation || '').trim() || null;
  if (body.previewThumbnail !== undefined) patch.previewThumbnail = String(body.previewThumbnail || '').trim() || null;

  if (patch.courseLocationId) {
    const courseLocations = await loadCourseLocations(String(snap.data()?.eventId || ''));
    const selectedLocation = findCourseLocation(patch.courseLocationId, courseLocations) || findCourseLocation(patch.courseLocationName, courseLocations);
    if (selectedLocation && (patch.locationMode || snap.data()?.locationMode || 'fixed') !== 'mobile') {
      patch.latitude = Number(patch.latitude ?? selectedLocation.latitude);
      patch.longitude = Number(patch.longitude ?? selectedLocation.longitude);
      patch.coverageRadius = Number(patch.coverageRadius ?? selectedLocation.coverageRadius);
    }
  }

  patch.updatedAt = FieldValue.serverTimestamp();
  patch.updatedBy = auth.uid;

  const eventId = String(snap.data()?.eventId || nestedEventId || '').trim();
  await mirrorLiveCameraDocument(db, eventId, cameraId, patch);
  const next = await ref.get();
  return ok({ camera: { cameraId: next.id, ...(next.data() || {}) } });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);

  const cameraId = String(req.nextUrl.searchParams.get('cameraId') || '').trim();
  if (!cameraId) return fail('invalid_request', 'cameraId is required', 400);

  const db = getFirestoreInstance();
  const legacySnap = await db.collection('broadcastCameras').doc(cameraId).get();
  const eventId = legacySnap.exists ? String((legacySnap.data() as any)?.eventId || '').trim() : '';
  const ref = getLiveCameraDocRef(db, eventId, cameraId);
  const snap = legacySnap.exists ? legacySnap : await ref.get();
  if (!snap.exists) return fail('not_found', 'Camera not found', 404);

  const camera = { cameraId: snap.id, ...(snap.data() || {}) } as BroadcastCamera;
  const liveInputUid = String(camera.cloudflare?.liveInputUid || '').trim();
  if (liveInputUid) {
    try {
      await deleteLiveInputViaWorker({ eventId: camera.eventId || undefined, cameraId, liveInputUid });
    } catch {
      try { await cloudflareBroadcastProvider.deleteLiveInput(liveInputUid); } catch {}
    }
  }

  await deleteLiveCameraDocument(db, eventId, cameraId);
  return ok({ deleted: true, cameraId });
}
