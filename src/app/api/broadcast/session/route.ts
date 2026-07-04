import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { requireBroadcastManager } from '@/lib/broadcast/auth';

export const dynamic = 'force-dynamic';

function fail(message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code: 'request_error', message } }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  const eventId = String(req.nextUrl.searchParams.get('eventId') || '').trim();
  if (!eventId) return fail('eventId is required', 400);

  const db = getFirestoreInstance();
  const [sessionSnap, settingsSnap, camerasSnap] = await Promise.all([
    db.collection('broadcastSessions').doc(eventId).get(),
    db.collection('broadcastSettings').doc(eventId).get(),
    db.collection('broadcastCameras').where('eventId', '==', eventId).get(),
  ]);

  const cameras = camerasSnap.docs.map((d) => ({ cameraId: d.id, ...(d.data() || {}) })) as any[];
  const viewers = cameras.reduce((sum, c) => sum + Number(c.viewerCount || 0), 0);
  const averageLatency = cameras.length > 0 ? Math.round(cameras.reduce((sum, c) => sum + Number(c.latency || 0), 0) / cameras.length) : 0;

  return NextResponse.json({
    success: true,
    data: {
      eventId,
      session: sessionSnap.exists ? { sessionId: sessionSnap.id, ...(sessionSnap.data() || {}) } : null,
      settings: settingsSnap.exists ? { eventId, ...(settingsSnap.data() || {}) } : null,
      summary: {
        liveCameras: cameras.filter((c) => c.status === 'live').length,
        offlineCameras: cameras.filter((c) => c.status === 'offline').length,
        currentViewers: viewers,
        averageLatency,
        recordingEnabledCount: cameras.filter((c) => c.recordingEnabled).length,
      },
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const eventId = String(body?.eventId || '').trim();
  const action = String(body?.action || '').trim();
  if (!eventId || !action) return fail('eventId and action are required', 400);

  const db = getFirestoreInstance();

  if (action === 'update_session') {
    const layout = String(body?.layout || 'auto') as 'single' | '2' | '4' | '9' | 'auto';
    const selectedCameraIds = Array.isArray(body?.selectedCameraIds) ? body.selectedCameraIds.map((v: any) => String(v || '').trim()).filter(Boolean) : [];

    await db.collection('broadcastSessions').doc(eventId).set({
      sessionId: eventId,
      eventId,
      active: body?.active !== false,
      layout,
      selectedCameraIds,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
      startedAt: body?.active === true ? FieldValue.serverTimestamp() : undefined,
      endedAt: body?.active === false ? FieldValue.serverTimestamp() : undefined,
    }, { merge: true });

    return NextResponse.json({ success: true, data: { eventId } });
  }

  if (action === 'update_settings') {
    await db.collection('broadcastSettings').doc(eventId).set({
      eventId,
      enableBroadcast: Boolean(body?.enableBroadcast),
      publicBroadcast: Boolean(body?.publicBroadcast),
      privateBroadcast: Boolean(body?.privateBroadcast),
      autoRecording: Boolean(body?.autoRecording),
      allowReplay: Boolean(body?.allowReplay),
      cameraSwitching: Boolean(body?.cameraSwitching),
      enableAthleteAutoCamera: Boolean(body?.enableAthleteAutoCamera),
      lowLatencyMode: Boolean(body?.lowLatencyMode),
      viewerChat: Boolean(body?.viewerChat),
      sponsorOverlay: Boolean(body?.sponsorOverlay),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    }, { merge: true });

    return NextResponse.json({ success: true, data: { eventId } });
  }

  return fail('Unsupported action', 400);
}
