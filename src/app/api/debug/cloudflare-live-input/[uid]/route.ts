import { NextRequest, NextResponse } from 'next/server';
import { requireBroadcastManager } from '@/lib/broadcast/auth';
import { getLiveInputDebug } from '@/lib/cloudflare/stream';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { uid: string } },
) {
  const auth = await requireBroadcastManager(_req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.message }, { status: auth.status });
  }

  const { uid } = params;
  const liveInputUid = String(uid || '').trim();
  if (!liveInputUid) {
    return NextResponse.json({ success: false, error: 'uid is required' }, { status: 400 });
  }

  const debug = await getLiveInputDebug(liveInputUid);
  const result = debug.rawJson?.result || {};

  return NextResponse.json({
    success: true,
    data: {
      liveInputUid,
      rawCloudflareResponse: debug.rawJson,
      rawCloudflareResponseText: debug.rawText,
      liveInputStatus: result?.status ?? result?.state ?? null,
      recordingStatus: result?.recording?.status ?? result?.recording?.mode ?? null,
      meta: result?.meta ?? null,
      rtmpsUrl: result?.rtmps?.url ?? null,
      rtmpsStreamKey: result?.rtmps?.streamKey ?? null,
      connectionState: result?.connection?.status ?? result?.lifecycle?.status ?? result?.status ?? null,
      lastSeenBroadcaster: result?.lastSeenBroadcaster ?? result?.last_seen_broadcaster ?? null,
      playbackUid: result?.video?.uid ?? result?.currentVideo?.uid ?? result?.playback?.uid ?? null,
      videoUid: result?.video?.uid ?? result?.currentVideo?.uid ?? null,
    },
  });
}
