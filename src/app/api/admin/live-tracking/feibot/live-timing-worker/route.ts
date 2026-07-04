import { NextRequest, NextResponse } from 'next/server';

import { getKV } from '@/lib/cloudflare/kv';
import { syncFeibotLiveTimingToKv } from '@/lib/feibot-integration/live-timing-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const eventId = normalize(body?.eventId);
    const eventUuid = normalize(body?.eventUuid || '');
    const sourceKey = normalize(body?.sourceKey || `live:event:${eventId}:provider:live-results`);

    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required.' }, { status: 400 });
    }

    const sourcePayload = await getKV<any>(sourceKey, 'api-live-timing-worker');
    const result = await syncFeibotLiveTimingToKv({
      eventId,
      eventUuid: eventUuid || undefined,
      sourcePayload,
      triggeredBy: 'admin-live-timing-worker',
    });

    return NextResponse.json({
      success: true,
      eventId,
      result,
      sourceKey,
      message: 'Live timing worker completed.',
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || 'Failed to run live timing worker.' }, { status: 500 });
  }
}
