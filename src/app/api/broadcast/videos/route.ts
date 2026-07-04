import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { requireBroadcastManager } from '@/lib/broadcast/auth';
import { deleteStreamVideo, listStreamVideos } from '@/lib/cloudflare/stream';
import { getLegacyBroadcastCameraDocRef, getLiveCameraDocRef } from '@/lib/broadcast/liveCameras';
import type { ApiResponse } from '@/lib/types/broadcast';

export const dynamic = 'force-dynamic';

function ok<T>(data: T) {
  return NextResponse.json({ success: true, data } as ApiResponse<T>);
}

function fail(code: string, message: string, status = 400, details?: any) {
  return NextResponse.json({ success: false, error: { code, message, details } } as ApiResponse<never>, { status });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);

  const body = await req.json().catch(() => null);
  const videoUid = String(body?.videoUid || req.nextUrl.searchParams.get('videoUid') || '').trim();
  const cameraId = String(body?.cameraId || req.nextUrl.searchParams.get('cameraId') || '').trim();
  const eventId = String(body?.eventId || req.nextUrl.searchParams.get('eventId') || '').trim();

  if (!videoUid) {
    return fail('invalid_request', 'videoUid is required', 400);
  }

  await deleteStreamVideo(videoUid);

  if (cameraId && eventId) {
    const db = getFirestoreInstance();
    const patch = {
      cloudflare: {
        videoUid: null,
        recordingUid: null,
        playbackUid: null,
        playbackUrl: null,
      },
      updatedAt: new Date().toISOString(),
    };

    await Promise.all([
      getLiveCameraDocRef(db, eventId, cameraId).set(patch, { merge: true }).catch(() => null),
      getLegacyBroadcastCameraDocRef(db, cameraId).set(patch, { merge: true }).catch(() => null),
    ]);
  }

  return ok({ deleted: true, videoUid });
}

export async function GET(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);

  const search = String(req.nextUrl.searchParams.get('search') || '').trim();
  const status = String(req.nextUrl.searchParams.get('status') || '').trim();
  const type = String(req.nextUrl.searchParams.get('type') || '').trim() as 'vod' | 'live' | '';
  const limit = Number(req.nextUrl.searchParams.get('limit') || 100);

  const { items, total } = await listStreamVideos({
    limit: Number.isFinite(limit) ? limit : 100,
    search: search || undefined,
    status: status || undefined,
    type: type === 'vod' || type === 'live' ? type : '',
  });

  const videos = items.map((video: any) => {
    const uid = String(video?.uid || '').trim();
    const title = String(video?.meta?.name || video?.publicDetails?.title || video?.name || uid || 'Untitled').trim();
    const created = String(video?.created || video?.uploaded || video?.modified || new Date().toISOString());
    const playback = video?.playback || {};
    const statusState = String(video?.status?.state || video?.status || (video?.readyToStream ? 'ready' : '') || '').trim();

    return {
      uid,
      title,
      status: statusState || (video?.readyToStream ? 'ready' : 'unknown'),
      duration: Number(video?.duration || 0) || 0,
      thumbnail: video?.thumbnail || null,
      preview: video?.preview || null,
      hlsUrl: playback?.hls || null,
      dashUrl: playback?.dash || null,
      created,
      uploaded: video?.uploaded || null,
      modified: video?.modified || null,
      creator: video?.creator || null,
      liveInputId: video?.liveInput || null,
      readyToStream: Boolean(video?.readyToStream),
      requireSignedURLs: Boolean(video?.requireSignedURLs),
      size: Number(video?.size || 0) || 0,
      raw: video,
    };
  });

  return ok({ videos, total, count: videos.length });
}
