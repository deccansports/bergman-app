import { NextRequest } from 'next/server';
import { mobileJson, requireMobileAuth, getMobileUpcomingEvents, getMobileLiveEvents } from '../_shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await requireMobileAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const [upcomingEvents, liveEvents] = await Promise.all([
      getMobileUpcomingEvents(),
      getMobileLiveEvents(),
    ]);

    return mobileJson(true, {
      upcomingEvents,
      liveEvents,
      totalUpcomingEvents: upcomingEvents.length,
      totalLiveEvents: liveEvents.length,
    });
  } catch (error: any) {
    return mobileJson(false, undefined, error?.message || 'Failed to load mobile events', 500);
  }
}
