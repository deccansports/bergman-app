import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { cloudflareBroadcastProvider, getPlaybackIframeUrl } from '@/lib/cloudflare/stream';
import { loadEventLiveCameras } from '@/lib/broadcast/liveCameras';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const eventId = String(req.nextUrl.searchParams.get('eventId') || '').trim();
    const cameraId = String(req.nextUrl.searchParams.get('cameraId') || '').trim();
    const includeOffline = String(req.nextUrl.searchParams.get('includeOffline') || '').trim() === '1';

    if (!eventId) {
      return NextResponse.json({ success: false, error: { code: 'invalid_request', message: 'eventId is required' } }, { status: 400 });
    }

    const db = getFirestoreInstance();
    if (cameraId) {
      const legacySnap = await db.collection('broadcastCameras').doc(cameraId).get();
      const eventIdFromLegacy = legacySnap.exists ? String((legacySnap.data() as any)?.eventId || '').trim() : '';
      const snap = legacySnap.exists ? legacySnap : (eventIdFromLegacy ? await db.collection('events').doc(eventIdFromLegacy).collection('liveCameras').doc(cameraId).get() : null);
      if (!snap || !snap.exists) {
        return NextResponse.json({ success: false, error: { code: 'not_found', message: 'Camera not found' } }, { status: 404 });
      }
      const camera = { cameraId: snap.id, ...(snap.data() || {}) } as any;
      const liveInputUid = String(camera?.cloudflare?.liveInputUid || '').trim();
      const rawPlaybackUid = String(camera?.cloudflare?.playbackUid || '').trim();
      const isLiveCamera = ['live', 'recording', 'stopping'].includes(String(camera?.status || '').trim().toLowerCase());
      const playbackUid = rawPlaybackUid && rawPlaybackUid !== liveInputUid ? rawPlaybackUid : (isLiveCamera ? liveInputUid : '');
      const playbackUrl = String(camera?.cloudflare?.playbackUrl || camera?.cloudflare?.webRTCPlaybackUrl || camera?.cloudflare?.rtmpsPlaybackUrl || '').trim() || (playbackUid ? cloudflareBroadcastProvider.getPlaybackUrl(playbackUid) : '');
      const viewerCount = Number(camera?.viewerCount || 0);
      return NextResponse.json({
        success: true,
        data: {
          cameraId,
          eventId,
          status: playbackUrl ? 'ready' : 'waiting_for_stream',
          message: playbackUrl ? 'Playback ready.' : 'Playback will become available automatically once the first stream begins.',
          playbackUrl,
          hlsUrl: playbackUrl,
          iframeUrl: playbackUid ? getPlaybackIframeUrl(playbackUid) : '',
          viewerCount,
        },
      });
    }

    const cameras = await loadEventLiveCameras(db, eventId);
    const streams = cameras
      .filter((c: any) => includeOffline || c.status === 'live');

    const streamRows = streams.map((camera: any) => {
      const liveInputUid = String(camera?.cloudflare?.liveInputUid || '').trim();
      const rawPlaybackUid = String(camera?.cloudflare?.playbackUid || '').trim();
      const isLiveCamera = ['live', 'recording', 'stopping'].includes(String(camera?.status || '').trim().toLowerCase());
      const playbackUid = rawPlaybackUid && rawPlaybackUid !== liveInputUid ? rawPlaybackUid : (isLiveCamera ? liveInputUid : '');
      const playbackUrl = String(camera?.cloudflare?.playbackUrl || camera?.cloudflare?.webRTCPlaybackUrl || camera?.cloudflare?.rtmpsPlaybackUrl || '').trim() || (playbackUid ? cloudflareBroadcastProvider.getPlaybackUrl(playbackUid) : '');
      const viewerCount = Number(camera?.viewerCount || 0);
      return {
        cameraId: camera.cameraId,
        name: camera.name,
        status: camera.status,
        playbackStatus: playbackUrl ? 'ready' : 'waiting_for_stream',
        playbackUrl,
        hlsUrl: playbackUrl,
        iframeUrl: playbackUid ? getPlaybackIframeUrl(playbackUid) : '',
        viewerCount,
      };
    });

    return NextResponse.json({ success: true, data: { eventId, streams: streamRows } });
  } catch (error) {
    return NextResponse.json({ success: false, error: { code: 'internal_error', message: error instanceof Error ? error.message : 'Failed to resolve playback' } }, { status: 500 });
  }
}
