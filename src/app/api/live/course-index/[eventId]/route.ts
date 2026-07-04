import { NextRequest, NextResponse } from 'next/server';
import { getKV } from '@/lib/cloudflare/kv';
import { buildTimingConfigurationFromCourseIndex } from '@/lib/courseIndexView';

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

    const courseIndex = await getKV<any>(`live:event:${eventId}:course:index`, 'api-live-course-index')
      || await getKV<any>(`event:${eventId}:course:index`, 'api-live-course-index');

    if (!courseIndex) {
      return NextResponse.json({ success: false, eventId, message: 'Course index not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      eventId,
      courseIndex,
      timingConfiguration: buildTimingConfigurationFromCourseIndex(courseIndex),
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to load course index' }, { status: 500 });
  }
}
