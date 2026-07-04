import { NextRequest, NextResponse } from 'next/server';
import { requireBroadcastManager } from '@/lib/broadcast/auth';
import { cloudflareBroadcastProvider } from '@/lib/cloudflare/stream';
import { buildGoProConfigurations } from '@/lib/broadcast/goproCompatibility';
import { validateCloudflareCredentials } from '@/lib/broadcast/cloudflareCompatibility';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.message }, { status: auth.status });
  }

  const liveInputUid = String(req.nextUrl.searchParams.get('liveInputUid') || '').trim();
  if (!liveInputUid) {
    return NextResponse.json({ success: false, error: 'liveInputUid is required' }, { status: 400 });
  }

  const liveInput = await cloudflareBroadcastProvider.getLiveInput(liveInputUid);
  const validation = validateCloudflareCredentials(liveInput);
  const server = String(liveInput?.rtmps?.url || '').trim();
  const streamKey = String(liveInput?.rtmps?.streamKey || '');
  const combinedUrl = server.endsWith('/') ? `${server}${streamKey}` : `${server}/${streamKey}`;
  const cloudflarePatternDetected = validation.valid;
  const recommendedOBSConfiguration = {
    protocol: 'RTMPS',
    server,
    streamKey,
  };

  return NextResponse.json({
    success: true,
    data: {
      server,
      streamKey,
      combinedUrl,
      cloudflarePatternDetected,
      recommendedOBSConfiguration,
      validation,
      goProConfigurations: buildGoProConfigurations({
        streamKey,
        liveInputUid,
      }),
      rawCloudflareResponse: liveInput,
    },
  });
}
