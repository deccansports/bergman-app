import { NextRequest, NextResponse } from 'next/server';
import { requireBroadcastManager } from '@/lib/broadcast/auth';
import { attachReplayVideoToEvent, loadReplayIndex, replayIndexSummary, syncReplayIndexFromCloudflare } from '@/lib/live-tracking/replay';

export const dynamic = 'force-dynamic';

function ok(data: any) {
  return NextResponse.json({ success: true, data });
}

function fail(code: string, message: string, status = 400, details?: any) {
  return NextResponse.json({ success: false, error: { code, message, details } }, { status });
}

export async function GET(_req: NextRequest, { params }: { params: { eventId: string } }) {
  const eventId = String(params?.eventId || '').trim();
  if (!eventId) return fail('invalid_request', 'eventId is required', 400);

  const index = await syncReplayIndexFromCloudflare(eventId).catch(async () => loadReplayIndex(eventId));
  return ok({
    eventId,
    replay: index,
    summary: replayIndexSummary(index),
  });
}

export async function POST(req: NextRequest, { params }: { params: { eventId: string } }) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);

  const eventId = String(params?.eventId || '').trim();
  if (!eventId) return fail('invalid_request', 'eventId is required', 400);

  const body = await req.json().catch(() => null);
  const action = String(body?.action || 'attach').trim();

  if (action !== 'attach') {
    return fail('invalid_request', 'Unsupported replay action', 400);
  }

  const uid = String(body?.video?.uid || body?.uid || '').trim();
  if (!uid) return fail('invalid_request', 'video.uid is required', 400);

  const updated = await attachReplayVideoToEvent(eventId, {
    uid,
    title: String(body?.video?.title || body?.title || uid).trim(),
    status: String(body?.video?.status || body?.status || 'unknown').trim(),
    duration: Number(body?.video?.duration || body?.duration || 0) || 0,
    thumbnail: String(body?.video?.thumbnail || body?.thumbnail || '').trim() || null,
    playback: String(body?.video?.hlsUrl || body?.video?.playback || body?.playback || '').trim() || null,
    inputId: String(body?.video?.inputId || body?.video?.liveInputId || body?.inputId || '').trim() || null,
    createdAt: String(body?.video?.created || body?.createdAt || new Date().toISOString()),
    uploadedAt: String(body?.video?.uploaded || body?.uploadedAt || '').trim() || null,
    modifiedAt: String(body?.video?.modified || body?.modifiedAt || '').trim() || null,
    cameraId: String(body?.cameraId || body?.video?.cameraId || '').trim() || null,
  });

  return ok({ replay: updated, summary: replayIndexSummary(updated) });
}
