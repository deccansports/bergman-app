import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { requireBroadcastManager } from '@/lib/broadcast/auth';
import { cloudflareBroadcastProvider, CloudflareStreamError, CLOUDFLARE_RTMPS_SERVER, getPlaybackIframeUrl, getStreamVideo } from '@/lib/cloudflare/stream';
import { CloudflareStreamCredentialMutationError, decryptStreamKey, encryptStreamKey, maskSecret, sha256Hex } from '@/lib/broadcast/security';
import { validateCloudflareCredentials } from '@/lib/broadcast/cloudflareCompatibility';
import type { BroadcastCameraStatus } from '@/lib/types/broadcast';

export const dynamic = 'force-dynamic';

function response(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

function resolveRtmpsServer(cameraRtmpsUrl: unknown) {
  const raw = String(cameraRtmpsUrl || '').trim();
  const fallback = CLOUDFLARE_RTMPS_SERVER;
  if (!raw) return fallback;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'rtmps:') return fallback;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    const basePath = parsed.pathname || '/live/';
    const pathname = basePath.endsWith('/') ? basePath : `${basePath}/`;
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return raw;
  }
}

function buildGoProRtmpUrl(rtmpsServer: string, streamKey: string) {
  const server = String(rtmpsServer || '').trim();
  const key = String(streamKey || '');
  if (!server || !key) return '';
  const normalizedServer = server.endsWith('/') ? server : `${server}/`;
  return `${normalizedServer}${key}`;
}

function getRtmpDebugDetails(rtmpsServer: string, streamKey: string, camera: any) {
  const server = String(rtmpsServer || '').trim();
  const key = String(streamKey || '');
  const combinedUrl = buildGoProRtmpUrl(server, key);
  let protocol = 'unknown';
  let port = 'unknown';

  try {
    const parsed = new URL(server);
    protocol = parsed.protocol.replace(':', '') || 'unknown';
    port = parsed.port || (parsed.protocol === 'rtmps:' ? '443' : 'unknown');
  } catch {
    // keep defaults
  }

  const goproModel = String(
    camera?.customMetadata?.goproModel ||
    camera?.cloudflare?.goproModel ||
    camera?.goproModel ||
    camera?.model ||
    camera?.cameraType ||
    'unknown'
  ).trim() || 'unknown';

  return {
    goproModel,
    server,
    key,
    combinedUrl,
    lengths: {
      server: server.length,
      key: key.length,
      combined: combinedUrl.length,
    },
    protocol,
    port,
    fieldModes: {
      separateFields: {
        server,
        streamKey: key,
      },
      singleUrl: combinedUrl,
    },
  };
}

function nowIso() {
  return new Date().toISOString();
}

function requiresAdminForSecrets(role: string) {
  return role !== 'admin';
}

function normalizePlaybackValidationStatus(value: 'ready' | 'waiting' | 'error' | 'offline') {
  if (value === 'ready') return 'Ready';
  if (value === 'waiting') return 'Waiting';
  if (value === 'offline') return 'Offline';
  return 'Error';
}

function buildCloudflareDiagnostics(error: unknown, endpoint: string) {
  if (error instanceof CloudflareStreamError) {
    return {
      endpoint,
      httpStatus: error.status,
      code: error.code,
      message: error.message,
      requestId: error.details?.requestId || null,
      cloudflareErrorCode: error.details?.cloudflareErrorCode || null,
      cloudflareErrorMessage: error.details?.cloudflareErrorMessage || null,
    };
  }

  return {
    endpoint,
    httpStatus: 500,
    code: 'unknown_error',
    message: error instanceof Error ? error.message : 'Unknown Cloudflare error',
    requestId: null,
    cloudflareErrorCode: null,
    cloudflareErrorMessage: null,
  };
}

function mapConnectionResultToCameraStatus(params: { input?: any; error?: unknown }) {
  if (params.error instanceof CloudflareStreamError) {
    if (params.error.code === 'cloudflare_auth_error') {
      return {
        status: 'authentication_failed' as BroadcastCameraStatus,
        connectionState: 'Authentication Failed',
        message: 'Cloudflare authentication failed. Verify API token permissions.',
        healthScore: 10,
      };
    }
    if (params.error.code === 'cloudflare_invalid_stream_key') {
      return {
        status: 'invalid_stream_key' as BroadcastCameraStatus,
        connectionState: 'Invalid Stream Key',
        message: 'Stream key appears invalid. Rotate key and reprovision camera.',
        healthScore: 15,
      };
    }
    if (params.error.code === 'cloudflare_timeout') {
      return {
        status: 'connection_timed_out' as BroadcastCameraStatus,
        connectionState: 'Connection Timed Out',
        message: 'Connection timed out while checking live input.',
        healthScore: 20,
      };
    }
  }

  const input = params.input || {};
  const nestedState = String(
    input?.status?.current?.state ||
    input?.status?.current?.status ||
    input?.status?.state ||
    input?.state ||
    ''
  ).trim().toLowerCase();
  const candidate = [
    nestedState,
    input?.status,
    input?.state,
    input?.liveInput?.status,
    input?.lifecycle?.status,
    input?.connection?.status,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  const isConnected = Boolean(input?.connected) || /live|connected|active|healthy/.test(candidate);
  const signal = Number(input?.signal || input?.status?.signal || 0);
  const isConnecting = /connect|starting|boot|initializing/.test(candidate);
  const isWaiting = /wait|idle|pending|ready/.test(candidate);
  const isStopping = /stopping|ending|finishing|draining/.test(candidate);
  const isArchived = /archived|completed|complete|recorded/.test(candidate);
  const isDisconnected = /disconnect|offline|stopped|ended/.test(candidate);
  const isError = /error|failed|invalid/.test(candidate);
  const isRecording = /record/.test(candidate);

  if (isArchived) {
    return {
      status: 'archived' as BroadcastCameraStatus,
      connectionState: 'Archived',
      message: 'Stream ended and moved to archive/recording state.',
      healthScore: 75,
    };
  }

  if (isStopping) {
    return {
      status: 'stopping' as BroadcastCameraStatus,
      connectionState: 'Stopping',
      message: 'Live stream is stopping and finalizing recording.',
      healthScore: 65,
    };
  }

  if (isConnected && Number.isFinite(signal) && signal > 0 && signal <= 5) {
    return {
      status: 'signal_lost' as BroadcastCameraStatus,
      connectionState: 'Signal Lost',
      message: 'Incoming signal is extremely weak or unstable.',
      healthScore: 25,
    };
  }

  if (isConnected && isRecording) {
    return {
      status: 'recording' as BroadcastCameraStatus,
      connectionState: 'Live',
      message: 'Camera stream is live and recording.',
      healthScore: 95,
    };
  }

  if (isConnected) {
    return {
      status: 'live' as BroadcastCameraStatus,
      connectionState: 'Live',
      message: 'Camera stream is live.',
      healthScore: 90,
    };
  }

  if (isConnecting) {
    return {
      status: 'connecting' as BroadcastCameraStatus,
      connectionState: 'Connecting',
      message: 'Camera is connecting to Cloudflare Stream.',
      healthScore: 55,
    };
  }

  if (isWaiting) {
    return {
      status: 'waiting_for_stream' as BroadcastCameraStatus,
      connectionState: 'Waiting for Stream',
      message: 'Cloudflare is ready and waiting for incoming stream.',
      healthScore: 60,
    };
  }

  if (isDisconnected) {
    return {
      status: 'offline' as BroadcastCameraStatus,
      connectionState: 'Disconnected',
      message: 'No active incoming stream detected.',
      healthScore: 35,
    };
  }

  if (isError) {
    return {
      status: 'error' as BroadcastCameraStatus,
      connectionState: 'Error',
      message: 'Cloudflare reported an input error.',
      healthScore: 20,
    };
  }

  return {
    status: 'waiting_for_stream' as BroadcastCameraStatus,
    connectionState: 'Waiting for Stream',
    message: 'Waiting for incoming stream.',
    healthScore: 60,
  };
}

function firstNonEmptyString(values: unknown[]) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function deriveSignalStrength(input: any, camera: any, connectionStatus: string) {
  const runtimeSignal = Number(input?.signal || input?.status?.signal || input?.status?.current?.signal || camera?.signal || 0);
  if (Number.isFinite(runtimeSignal) && runtimeSignal > 0) {
    return Math.max(0, Math.min(100, runtimeSignal));
  }

  const bitrate = Number(input?.bitrate || input?.status?.bitrate || input?.status?.current?.bitrate || input?.video?.bitrate || camera?.bitrate || 0);
  const fps = Number(input?.fps || input?.status?.fps || input?.status?.current?.fps || input?.video?.fps || camera?.fps || 0);
  const isActive = ['live', 'recording', 'stopping'].includes(String(connectionStatus || '').toLowerCase());

  if (!isActive) return 0;
  if (bitrate >= 6000 || fps >= 50) return 100;
  if (bitrate >= 3000 || fps >= 30) return 90;
  if (bitrate >= 1500 || fps >= 24) return 80;
  if (bitrate > 0 || fps > 0) return 70;
  return 60;
}

function extractPlaybackFromLiveInput(input: any, camera: any, liveInputUid?: string | null) {
  const playbackUid = firstNonEmptyString([
    input?.video?.uid,
    input?.currentVideo?.uid,
    input?.stream?.uid,
    input?.playback?.uid,
    input?.liveInput?.video?.uid,
    input?.recording?.uid,
    camera?.cloudflare?.playbackUid,
    liveInputUid,
  ]) || null;

  const playbackUrl = firstNonEmptyString([
    input?.video?.playback?.hls,
    input?.video?.playback?.url,
    input?.playback?.url,
    input?.manifest?.url,
    input?.webRTCPlayback?.url,
    input?.rtmpsPlayback?.url,
    camera?.cloudflare?.playbackUrl,
    playbackUid ? cloudflareBroadcastProvider.getPlaybackUrl(playbackUid) : '',
  ]) || null;

  return {
    playbackUid,
    playbackUrl,
    videoUid: firstNonEmptyString([input?.video?.uid, input?.currentVideo?.uid, camera?.cloudflare?.videoUid]) || null,
    recordingUid: firstNonEmptyString([input?.recording?.uid, camera?.cloudflare?.recordingUid]) || null,
    thumbnailUrl: firstNonEmptyString([input?.video?.thumbnail, input?.thumbnail, camera?.cloudflare?.thumbnailUrl]) || null,
    durationSeconds: Number(input?.video?.duration || input?.duration || camera?.cloudflare?.durationSeconds || 0) || null,
  };
}

function getCloudflareStatusText(input: any) {
  if (!input) return 'ready';
  if (typeof input?.status === 'object' && input?.status) {
    return String(input.status.current?.state || input.status.current?.status || input.status.state || 'ready');
  }
  return String(input?.status || input?.state || 'ready');
}

export async function POST(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) return response({ success: false, error: auth.message }, auth.status);

  const body = await req.json().catch(() => null);
  const action = String(body?.action || '').trim();
  const cameraId = String(body?.cameraId || '').trim();

  if (!action || !cameraId) return response({ success: false, error: 'action and cameraId are required' }, 400);

  const db = getFirestoreInstance();
  const ref = db.collection('broadcastCameras').doc(cameraId);
  const snap = await ref.get();
  if (!snap.exists) return response({ success: false, error: 'Camera not found' }, 404);

  const camera = { cameraId: snap.id, ...(snap.data() || {}) } as any;
  const liveInputUid = String(camera?.cloudflare?.liveInputUid || '').trim();
  const storedEncryptedStreamKey = String(camera?.cloudflare?.streamKeyEncrypted || '');

  if (storedEncryptedStreamKey) {
    const storedDecryptedStreamKey = decryptStreamKey(storedEncryptedStreamKey);
    console.info('[broadcast-live-input][firestore-stream-key]', {
      cameraId,
      liveInputUid,
      encrypted: storedEncryptedStreamKey,
      decrypted: storedDecryptedStreamKey,
      encryptedLength: storedEncryptedStreamKey.length,
      decryptedLength: storedDecryptedStreamKey.length,
      encryptedSha256: sha256Hex(storedEncryptedStreamKey),
      decryptedSha256: sha256Hex(storedDecryptedStreamKey),
    });

    const roundTripEncrypted = encryptStreamKey(storedDecryptedStreamKey);
    const roundTripDecrypted = decryptStreamKey(roundTripEncrypted);
    if (roundTripDecrypted !== storedDecryptedStreamKey) {
      throw new CloudflareStreamCredentialMutationError('STREAM KEY ENCRYPTION CORRUPTED');
    }
  }

  if (action === 'reveal_key') {
    if (requiresAdminForSecrets(String(auth.role || ''))) {
      return response({ success: false, error: 'Only administrators can reveal stream keys.' }, 403);
    }

    // === PRE-FLIGHT DIAGNOSTICS: Fetch live input from Cloudflare immediately ===
    let liveInputSnapshot: any = null;
    let preFlightError: unknown = null;
    try {
      liveInputSnapshot = await cloudflareBroadcastProvider.getLiveInput(liveInputUid);
    } catch (error: any) {
      preFlightError = error;
    }

    const cloudflareStreamKey = String(liveInputSnapshot?.rtmps?.streamKey || liveInputSnapshot?.rtmps?.stream_key || liveInputSnapshot?.streamKey || '').trim();
    let decrypted = '';
    try {
      decrypted = decryptStreamKey(String(camera?.cloudflare?.streamKeyEncrypted || ''));
    } catch (error) {
      console.warn('[broadcast-live-input][reveal-key][decrypt-failed]', {
        cameraId,
        liveInputUid,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    const resolvedStreamKey = cloudflareStreamKey || decrypted;
    const rtmpsServer = resolveRtmpsServer(camera?.cloudflare?.rtmpsUrl);
    const goProRtmpUrl = buildGoProRtmpUrl(rtmpsServer, resolvedStreamKey);
    const debug = getRtmpDebugDetails(rtmpsServer, resolvedStreamKey, camera);
    const validation = validateCloudflareCredentials({
      uid: liveInputUid,
      rtmps: {
        url: rtmpsServer,
        streamKey: resolvedStreamKey,
      },
    });

    // === 4-WAY KEY COMPARISON ===
    const cloudflareStreamKeyRaw = String(liveInputSnapshot?.rtmps?.streamKey || liveInputSnapshot?.rtmps?.stream_key || liveInputSnapshot?.streamKey || '');
    const firestoreEncrypted = String(camera?.cloudflare?.streamKeyEncrypted || '');
    const firestoreDecrypted = decrypted;
    const uiStreamKey = String(resolvedStreamKey || '');
    
    const keyComparison = {
      cloudflareKey: cloudflareStreamKeyRaw,
      firestoreEncrypted,
      firestoreDecrypted,
      uiKey: uiStreamKey,
      sha256: {
        cloudflare: sha256Hex(cloudflareStreamKeyRaw),
        firestoreEncrypted: sha256Hex(firestoreEncrypted),
        firestoreDecrypted: sha256Hex(firestoreDecrypted),
        ui: sha256Hex(uiStreamKey),
      },
      lengths: {
        cloudflare: cloudflareStreamKeyRaw.length,
        firestoreEncrypted: firestoreEncrypted.length,
        firestoreDecrypted: firestoreDecrypted.length,
        ui: uiStreamKey.length,
      },
      matches: {
        cloudflareVsFirestoreDecrypted: cloudflareStreamKeyRaw === firestoreDecrypted,
        cloudflareVsUI: cloudflareStreamKeyRaw === uiStreamKey,
        allThreeMatch: cloudflareStreamKeyRaw === firestoreDecrypted && firestoreDecrypted === uiStreamKey,
      },
    };

    // === LIVE INPUT STATE VERIFICATION ===
    const liveInputState = {
      uid: liveInputSnapshot?.uid || liveInputUid,
      enabled: Boolean(liveInputSnapshot?.enabled),
      status: liveInputSnapshot?.status || null,
      connected: Boolean(liveInputSnapshot?.connected),
      lastSeen: liveInputSnapshot?.lastSeen || liveInputSnapshot?.last_seen || null,
      lastError: liveInputSnapshot?.lastError || liveInputSnapshot?.last_error || null,
      recording: liveInputSnapshot?.recording || null,
      rtmpsUrl: liveInputSnapshot?.rtmps?.url || null,
      srtUrl: liveInputSnapshot?.srt?.url || null,
      webRtcUrl: liveInputSnapshot?.webRTC?.url || null,
    };

    // === COMPLETE RTMP PUBLISH LIFECYCLE ===
    const rtmpPublishLifecycle = {
      rtmps: liveInputSnapshot?.rtmps || null,
      rtmpsPlayback: liveInputSnapshot?.rtmpsPlayback || null,
      srt: liveInputSnapshot?.srt || null,
      srtPlayback: liveInputSnapshot?.srtPlayback || null,
      webRTC: liveInputSnapshot?.webRTC || null,
      webRTCPlayback: liveInputSnapshot?.webRTCPlayback || null,
    };

    console.info('[broadcast-live-input][pre-flight-diagnostics]', {
      timestamp: nowIso(),
      cameraId,
      eventId: String(camera?.eventId || ''),
      liveInputUid,
      cloudflareError: preFlightError ? String(preFlightError) : null,
      keyComparison,
      liveInputState,
      rtmpPublishLifecycle,
      validation,
    });

    console.info('[broadcast-live-input][rtmp-compatibility]', {
      cameraId,
      eventId: String(camera?.eventId || ''),
      liveInputUid,
      ...debug,
      validation,
      copiedValues: {
        server: debug.server,
        streamKey: debug.key,
        combinedUrl: debug.combinedUrl,
      },
    });

    return response({
      success: true,
      data: {
        cameraId,
        rtmpsServer,
        streamKey: resolvedStreamKey,
        goProRtmpUrl,
        debug,
        validation,
        preFlightDiagnostics: {
          keyComparison,
          liveInputState,
          rtmpPublishLifecycle,
        },
        expiresInSeconds: 30,
        streamKeySource: cloudflareStreamKey ? 'cloudflare' : decrypted ? 'firestore' : 'none',
      },
    });
  }

  if (action === 'provisioning_payload') {
    return response({
      success: true,
      data: {
        cameraId,
        payload: {
          version: '1.0.0',
          provider: 'cloudflare_stream',
          cameraName: String(camera?.name || ''),
          liveInputUid: liveInputUid || null,
          rtmpsServer: resolveRtmpsServer(camera?.cloudflare?.rtmpsUrl),
          encryptedStreamKey: String(camera?.cloudflare?.streamKeyEncrypted || ''),
          configurationVersion: 'broadcast.provisioning.v1',
          timestamp: nowIso(),
        },
      },
    });
  }

  if (action === 'status' || action === 'test_connection') {
    if (!liveInputUid) return response({ success: false, error: 'No Cloudflare live input attached' }, 400);
    let input: any;
    let cloudflareError: unknown = null;
    try {
      input = await cloudflareBroadcastProvider.getLiveInput(liveInputUid);
    } catch (error: any) {
      cloudflareError = error;
    }

    const connection = mapConnectionResultToCameraStatus({ input, error: cloudflareError });
    const diagnostics = cloudflareError ? buildCloudflareDiagnostics(cloudflareError, `/stream/live_inputs/${encodeURIComponent(liveInputUid)}`) : null;
    const playbackInfo = extractPlaybackFromLiveInput(input, camera, liveInputUid);
    const isTestConnection = action === 'test_connection';
    const streamActive = connection.status === 'live' || connection.status === 'recording' || connection.status === 'stopping';
    const canDiscoverPlayback = !isTestConnection && streamActive;
    const playbackSourceUid = streamActive
      ? (playbackInfo.playbackUid || liveInputUid)
      : (playbackInfo.playbackUid && playbackInfo.playbackUid !== liveInputUid ? playbackInfo.playbackUid : null);
    const canQueryPlaybackResource = canDiscoverPlayback && !!playbackInfo.playbackUid && playbackInfo.playbackUid !== liveInputUid;
    const cloudflareRtmpsUrl = String(input?.rtmps?.url || input?.rtmps?.rtmpsUrl || input?.rtmpsUrl || '').trim();
    const cloudflareStreamKey = String(input?.rtmps?.streamKey || input?.rtmps?.stream_key || input?.streamKey || '');
    const storedRtmpsUrl = String(camera?.cloudflare?.rtmpsUrl || '').trim();
    const storedStreamKey = decryptStreamKey(String(camera?.cloudflare?.streamKeyEncrypted || ''));
    const cloudflareComparison = {
      stored: {
        rtmpsUrl: storedRtmpsUrl,
        streamKey: storedStreamKey,
        rtmpsUrlSha256: sha256Hex(storedRtmpsUrl),
        streamKeySha256: sha256Hex(storedStreamKey),
      },
      cloudflare: {
        rtmpsUrl: cloudflareRtmpsUrl,
        streamKey: cloudflareStreamKey,
        rtmpsUrlSha256: sha256Hex(cloudflareRtmpsUrl),
        streamKeySha256: sha256Hex(cloudflareStreamKey),
      },
      matches: {
        rtmpsUrl: storedRtmpsUrl === cloudflareRtmpsUrl,
        streamKey: storedStreamKey === cloudflareStreamKey,
      },
    };

    if (cloudflareComparison.matches.rtmpsUrl === false || cloudflareComparison.matches.streamKey === false) {
      console.error('[broadcast-live-input][comparison-mismatch]', {
        cameraId,
        liveInputUid,
        cloudflareComparison,
      });
      return response({
        success: false,
        error: cloudflareComparison.matches.rtmpsUrl === false && cloudflareComparison.matches.streamKey === false
          ? 'Stored RTMPS URL and Stream Key do not match Cloudflare.'
          : cloudflareComparison.matches.rtmpsUrl === false
            ? 'Stored RTMPS URL does not match Cloudflare.'
            : 'Stored Stream Key does not match Cloudflare.',
        details: {
          comparison: cloudflareComparison,
          cameraStatus: connection.status,
          connectionState: connection.connectionState,
          diagnostics,
        },
      }, 409);
    }

    const validation = validateCloudflareCredentials({
      uid: liveInputUid,
      rtmps: {
        url: cloudflareRtmpsUrl || storedRtmpsUrl,
        streamKey: cloudflareStreamKey || storedStreamKey,
      },
    });

    if (canDiscoverPlayback && playbackInfo.playbackUid && !playbackInfo.playbackUrl) {
      playbackInfo.playbackUrl = cloudflareBroadcastProvider.getPlaybackUrl(playbackInfo.playbackUid);
    }

    if (canQueryPlaybackResource) {
      try {
        const streamVideo = await getStreamVideo(String(playbackInfo.playbackUid));
        if (streamVideo) {
          playbackInfo.playbackUrl = firstNonEmptyString([
            streamVideo?.playback?.hls,
            streamVideo?.playback?.dash,
            playbackInfo.playbackUrl,
          ]) || playbackInfo.playbackUrl;
          playbackInfo.thumbnailUrl = firstNonEmptyString([
            streamVideo?.thumbnail,
            playbackInfo.thumbnailUrl,
          ]) || playbackInfo.thumbnailUrl;
          playbackInfo.durationSeconds = Number(streamVideo?.duration || playbackInfo.durationSeconds || 0) || playbackInfo.durationSeconds;
          playbackInfo.videoUid = firstNonEmptyString([streamVideo?.uid, playbackInfo.videoUid]) || playbackInfo.videoUid;
        }
      } catch {
        // Playback may still be initializing; treat this as expected.
      }
    }

    const observedLatency = Number(input?.latencyMs || input?.status?.latencyMs || camera?.latency || 0);
    const normalizedLatency = Number.isFinite(observedLatency) ? observedLatency : 0;
    const normalizedSignal = deriveSignalStrength(input, camera, connection.status);
    const recordingMode = String(input?.recording?.mode || input?.recording?.status || camera?.cloudflare?.recordingMode || 'off').trim() || 'off';
    const recordingModeNormalized = recordingMode.toLowerCase();

    const obsStages = [
      { key: 'rtmps_reachable', label: 'RTMPS Reachable', ok: Boolean(cloudflareRtmpsUrl || storedRtmpsUrl) },
      { key: 'authentication', label: 'Authentication', ok: cloudflareComparison.matches.rtmpsUrl && cloudflareComparison.matches.streamKey },
      { key: 'stream_key_valid', label: 'Stream Key Valid', ok: validation.valid },
      { key: 'receiving_video', label: 'Receiving Video', ok: Boolean(playbackInfo.videoUid || playbackInfo.playbackUid || streamActive) },
      { key: 'receiving_audio', label: 'Receiving Audio', ok: Boolean(playbackInfo.videoUid || playbackInfo.playbackUid || streamActive) },
      { key: 'cloudflare_connected', label: 'Cloudflare Connected', ok: connection.status === 'live' || connection.status === 'recording' || connection.status === 'stopping' },
      { key: 'live_playback_ready', label: 'Live Playback Ready', ok: Boolean(playbackSourceUid || playbackInfo.playbackUrl) },
      { key: 'recording_enabled', label: 'Recording Enabled', ok: recordingModeNormalized !== 'off' },
    ];
    const obsTest = {
      ok: obsStages.every((stage) => stage.ok),
      failedStage: obsStages.find((stage) => !stage.ok)?.label || null,
      stages: obsStages,
    };

    const viewerLookupId = String(playbackInfo.videoUid || playbackInfo.playbackUid || liveInputUid || '').trim();
    const viewers = viewerLookupId ? await cloudflareBroadcastProvider.getViewerCounts(viewerLookupId) : 0;

    const now = nowIso();
    const patch: Record<string, any> = {
      status: connection.status,
      viewerCount: viewers,
      latency: normalizedLatency,
      signal: normalizedSignal,
      healthScore: connection.healthScore,
      lastHealthCheckAt: now,
      cloudflare: canDiscoverPlayback
        ? {
            ...(camera?.cloudflare || {}),
            playbackUid: playbackSourceUid,
            playbackUrl: playbackInfo.playbackUrl || (playbackSourceUid ? cloudflareBroadcastProvider.getPlaybackUrl(playbackSourceUid) : null),
            playbackIframeUrl: playbackSourceUid ? getPlaybackIframeUrl(playbackSourceUid) : null,
            rtmpsPlaybackUrl: firstNonEmptyString([input?.rtmpsPlayback?.url, camera?.cloudflare?.rtmpsPlaybackUrl]) || null,
            webRTCPlaybackUrl: firstNonEmptyString([input?.webRTCPlayback?.url, camera?.cloudflare?.webRTCPlaybackUrl]) || null,
            videoUid: playbackInfo.videoUid,
            recordingUid: playbackInfo.recordingUid,
            thumbnailUrl: playbackInfo.thumbnailUrl,
            durationSeconds: playbackInfo.durationSeconds,
            recordingMode,
          }
        : {
            ...(camera?.cloudflare || {}),
            rtmpsPlaybackUrl: firstNonEmptyString([input?.rtmpsPlayback?.url, camera?.cloudflare?.rtmpsPlaybackUrl]) || null,
            webRTCPlaybackUrl: firstNonEmptyString([input?.webRTCPlayback?.url, camera?.cloudflare?.webRTCPlaybackUrl]) || null,
            recordingMode,
          },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    };

    if (connection.status === 'live' || connection.status === 'recording') {
      patch.lastConnectedAt = camera?.lastConnectedAt || now;
      patch.lastStreamStartedAt = camera?.lastStreamStartedAt || now;
    }

    if (
      ['offline', 'signal_lost', 'error', 'connection_timed_out', 'authentication_failed', 'invalid_stream_key', 'archived'].includes(connection.status)
      && (camera?.status === 'live' || camera?.status === 'recording' || camera?.status === 'connecting' || camera?.status === 'stopping')
    ) {
      patch.lastDisconnectedAt = now;
      patch.lastStreamEndedAt = now;
    }

    await ref.set(patch, { merge: true });

    console.info('[broadcast-live-input][test-connection]', {
      cameraId,
      eventId: String(camera?.eventId || ''),
      liveInputUid,
      requestStatus: cloudflareError ? 'failed' : 'ok',
      healthCheckResult: connection.status,
      playbackCheckSkipped: !canDiscoverPlayback,
      playbackNotYetCreated: !playbackInfo.playbackUid,
      cloudflareComparison,
      validation,
    });

    if (!cloudflareError && !canDiscoverPlayback) {
      console.info('[broadcast-live-input][idle]', {
        cameraId,
        eventId: String(camera?.eventId || ''),
        liveInputUid,
        message: `Live Input Found | Status: ${connection.status} | No active broadcaster | Playback not yet created`,
      });
    }

    if (cloudflareError) {
      return response({
        success: false,
        error: connection.message,
        details: {
          connectionState: connection.connectionState,
          cameraStatus: connection.status,
          diagnostics,
        },
      }, diagnostics?.httpStatus === 401 || diagnostics?.httpStatus === 403 ? 502 : Math.max(400, Number(diagnostics?.httpStatus || 502)));
    }

    return response({
      success: true,
      data: {
        cameraId,
        connectionState: connection.connectionState,
        cameraStatus: connection.status,
        message: connection.message,
        cloudflare: input,
        playback: {
          status: playbackSourceUid || playbackInfo.playbackUrl ? 'ready' : 'not_yet_available',
          message: playbackSourceUid || playbackInfo.playbackUrl
            ? 'Playback is available.'
            : 'Playback will become available automatically once the first stream begins.',
          playbackSource: playbackInfo.videoUid ? 'Recorded Video' : 'Live Input',
          playbackUid: playbackSourceUid,
          playbackUrl: playbackInfo.playbackUrl || (playbackSourceUid ? cloudflareBroadcastProvider.getPlaybackUrl(playbackSourceUid) : null),
          iframeUrl: playbackSourceUid ? getPlaybackIframeUrl(playbackSourceUid) : null,
          livePlayback: playbackSourceUid ? 'Ready' : 'Pending',
          recording: playbackInfo.videoUid ? 'Ready' : 'Pending',
          replay: playbackInfo.videoUid ? 'Ready' : 'Pending',
          recordingVideoUid: playbackInfo.videoUid || null,
          liveInputUid,
          videoUid: playbackInfo.videoUid,
          recordingUid: playbackInfo.recordingUid,
          thumbnailUrl: playbackInfo.thumbnailUrl,
          durationSeconds: playbackInfo.durationSeconds,
        },
        viewerCount: viewers,
        rtmpsServer: resolveRtmpsServer(camera?.cloudflare?.rtmpsUrl),
        rtmpsUrlMasked: resolveRtmpsServer(camera?.cloudflare?.rtmpsUrl),
        streamKeyMasked: maskSecret(String(decryptStreamKey(String(camera?.cloudflare?.streamKeyEncrypted || '')) || '')),
        health: {
          cloudflareStatus: getCloudflareStatusText(input),
          liveInputStatus: connection.connectionState,
          signal: normalizedSignal,
          recordingStatus: recordingMode,
          currentViewers: viewers,
          latency: normalizedLatency,
          lastConnected: patch.lastConnectedAt || camera?.lastConnectedAt || null,
          lastDisconnected: patch.lastDisconnectedAt || camera?.lastDisconnectedAt || null,
          healthScore: connection.healthScore,
          lastHealthCheck: now,
        },
        diagnostics,
        comparison: cloudflareComparison,
        validation,
        obsTest,
      },
    });
  }

  if (action === 'validate_playback') {
    const playbackUidRaw = String(camera?.cloudflare?.playbackUid || '').trim();
    const isLiveCamera = ['live', 'recording', 'stopping'].includes(String(camera?.status || '').trim().toLowerCase());
    const playbackUid = playbackUidRaw && playbackUidRaw !== liveInputUid ? playbackUidRaw : (isLiveCamera ? liveInputUid : '');
    const playbackUrl = String(
      camera?.cloudflare?.webRTCPlaybackUrl ||
      camera?.cloudflare?.playbackUrl ||
      camera?.cloudflare?.rtmpsPlaybackUrl ||
      ''
    ).trim() || (playbackUid ? cloudflareBroadcastProvider.getPlaybackUrl(playbackUid) : '');
    const playbackAvailable = Boolean(playbackUrl);

    if (!playbackAvailable) {
      return response({
        success: true,
        data: {
          cameraId,
          status: 'waiting',
          statusLabel: normalizePlaybackValidationStatus('waiting'),
          message: 'Playback will become available automatically once the first stream begins.',
          playbackSource: isLiveCamera ? 'Live Input' : 'Pending',
          livePlayback: 'Pending',
          recording: 'Pending',
          replay: 'Pending',
          playbackUid: playbackUid || null,
          playbackUrl: playbackUrl || null,
          recordingVideoUid: null,
          associated: Boolean(liveInputUid),
        },
      });
    }

    try {
      if (playbackUid === liveInputUid) {
        return response({
          success: true,
          data: {
            cameraId,
            status: 'ready',
            statusLabel: normalizePlaybackValidationStatus('ready'),
            message: 'Playback URL is available.',
            playbackSource: playbackUid === liveInputUid ? 'Live Input' : 'Recorded Video',
            livePlayback: 'Ready',
            recording: playbackUid === liveInputUid ? 'Pending' : 'Ready',
            replay: playbackUid === liveInputUid ? 'Pending' : 'Ready',
            playbackUid: null,
            playbackUrl,
            recordingVideoUid: playbackUid === liveInputUid ? null : playbackUid,
            associated: Boolean(liveInputUid),
          },
        });
      }

      const check = await fetch(playbackUrl, { method: 'HEAD', cache: 'no-store' });
      const ready = check.ok;
      const status = ready ? 'ready' : check.status === 404 ? 'waiting' : 'offline';
      return response({
        success: true,
        data: {
          cameraId,
          status,
          statusLabel: normalizePlaybackValidationStatus(status),
          message: ready ? 'Playback is reachable.' : (status === 'waiting' ? 'Playback not ready yet.' : 'Playback appears offline.'),
          httpStatus: check.status,
          playbackSource: playbackUid === liveInputUid ? 'Live Input' : 'Recorded Video',
          livePlayback: ready ? 'Ready' : 'Pending',
          recording: playbackUid === liveInputUid ? 'Pending' : (ready ? 'Ready' : 'Pending'),
          replay: playbackUid === liveInputUid ? 'Pending' : (ready ? 'Ready' : 'Pending'),
          playbackUid,
          playbackUrl,
          recordingVideoUid: playbackUid === liveInputUid ? null : playbackUid,
          associated: Boolean(liveInputUid),
        },
      });
    } catch (error) {
      return response({
        success: true,
        data: {
          cameraId,
          status: 'error',
          statusLabel: normalizePlaybackValidationStatus('error'),
          message: 'Playback validation failed.',
          playbackSource: playbackUid === liveInputUid ? 'Live Input' : 'Recorded Video',
          livePlayback: 'Pending',
          recording: playbackUid === liveInputUid ? 'Pending' : 'Ready',
          replay: 'Pending',
          playbackUid,
          playbackUrl,
          recordingVideoUid: playbackUid === liveInputUid ? null : playbackUid,
          associated: Boolean(liveInputUid),
        },
      });
    }
  }

  if (action === 'rotate_key') {
    if (requiresAdminForSecrets(String(auth.role || ''))) {
      return response({ success: false, error: 'Only administrators can rotate stream keys.' }, 403);
    }

    if (!liveInputUid) return response({ success: false, error: 'No Cloudflare live input attached' }, 400);

    const currentName = String(camera?.name || 'Camera').trim() || 'Camera';
    try { await cloudflareBroadcastProvider.deleteLiveInput(liveInputUid); } catch {}
    let recreated;
    try {
      recreated = await cloudflareBroadcastProvider.createLiveInput({ name: currentName, meta: { cameraId } });
    } catch (error: any) {
      const message = error instanceof CloudflareStreamError ? error.message : 'Could not rotate stream key';
      const status = error instanceof CloudflareStreamError ? (error.status === 401 || error.status === 403 ? 502 : error.status) : 502;
      return response({ success: false, error: message, details: error instanceof CloudflareStreamError ? error.details : undefined }, status);
    }

    await ref.set({
      cloudflare: {
        ...(camera?.cloudflare || {}),
        liveInputUid: recreated.liveInputUid,
        rtmpsUrl: recreated.rtmpsUrl,
        streamKeyEncrypted: encryptStreamKey(recreated.streamKey),
        playbackUid: null,
        playbackUrl: null,
        videoUid: null,
        recordingUid: null,
        thumbnailUrl: null,
        durationSeconds: null,
        recordingMode: 'off',
      },
      status: 'waiting_for_stream',
      lastHealthCheckAt: nowIso(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    }, { merge: true });

    console.info('[broadcast-live-input][rotate-key]', {
      cameraId,
      eventId: String(camera?.eventId || ''),
      liveInputUid: recreated.liveInputUid,
      requestStatus: 'ok',
      healthCheckResult: 'waiting_for_stream',
    });

    return response({
      success: true,
      data: {
        cameraId,
        liveInputUid: recreated.liveInputUid,
        rtmpsServer: resolveRtmpsServer(recreated.rtmpsUrl),
      },
    });
  }

  return response({ success: false, error: 'Unsupported action' }, 400);
}
