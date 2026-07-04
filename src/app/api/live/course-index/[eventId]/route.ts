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

    const [courseIndex, splitsDashboardFlag] = await Promise.all([
      (getKV<any>(`live:event:${eventId}:course:index`, 'api-live-course-index')
        .then((v) => v || getKV<any>(`event:${eventId}:course:index`, 'api-live-course-index'))),
      getKV<any>(`event:${eventId}:splits:dashboard:enabled`, 'api-live-course-index').catch(() => null),
    ]);

    if (!courseIndex) {
      return NextResponse.json({ success: false, eventId, message: 'Course index not found' }, { status: 404 });
    }

    const timingConfiguration = buildTimingConfigurationFromCourseIndex(courseIndex);
    const splitsEnabledForAthleteDashboard = Boolean(splitsDashboardFlag?.enabled);

    return NextResponse.json({
      success: true,
      eventId,
      courseIndex,
      splitsEnabledForAthleteDashboard,
      timingConfiguration: {
        ...timingConfiguration,
        splitsEnabledForAthleteDashboard,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to load course index' }, { status: 500 });
  }
}
