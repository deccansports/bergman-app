import { NextRequest, NextResponse } from 'next/server';
import { getKV } from '@/lib/cloudflare/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

export async function GET(_req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalize(params?.eventId);
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const timingSnapshot = await getKV<Record<string, any>>(`live:event:${eventId}:timingConfiguration`, 'api-live-course-index');
    const courseIndex = await getKV<any>(`live:event:${eventId}:course:index`, 'api-live-course-index');

    if (!timingSnapshot) {
      return NextResponse.json({ success: false, eventId, message: 'Timing configuration not found' }, { status: 404 });
    }

    const timingConfiguration = {
      ...timingSnapshot,
      eventId,
      course: timingSnapshot?.course || courseIndex?.course || courseIndex || null,
      courseIndex: courseIndex || null,
      source: timingSnapshot?.source || timingSnapshot?.provider || 'feibot',
    } as any;

    return NextResponse.json({
      success: true,
      eventId,
      timingConfiguration,
      timings: timingConfiguration,
      courseIndex: courseIndex || null,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to load course index' }, { status: 500 });
  }
}
