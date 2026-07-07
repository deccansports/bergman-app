import { NextRequest, NextResponse } from 'next/server';
import { getKV } from '@/lib/cloudflare/kv';

export const dynamic = 'force-dynamic';

async function loadTimingSnapshot(eventId: string) {
  return (await getKV<Record<string, any>>(`live:event:${eventId}:timingConfiguration`, 'api-timing-configuration')) || null;
}

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = String(params.eventId || '').trim();
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });

    const snapshot = await loadTimingSnapshot(eventId);
    if (!snapshot) return NextResponse.json({ success: false, message: 'Timing configuration snapshot not found' }, { status: 404 });

    const timingConfiguration = {
      ...snapshot,
      eventId,
      source: snapshot?.source || snapshot?.provider || 'feibot',
    };

    return NextResponse.json({
      success: true,
      ...timingConfiguration,
      timings: timingConfiguration,
      timingConfiguration,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to load timing configuration' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    return NextResponse.json({ success: false, message: 'Timing configuration is read-only and must be imported from Feibot.' }, { status: 405 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to save timing configuration' }, { status: 500 });
  }
}
