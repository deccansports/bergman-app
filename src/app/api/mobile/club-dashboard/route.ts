import { NextRequest } from 'next/server';
import { getCalendarEventsAction, getClubDashboardDataAction, getClubRegistrationsAction, getClubRankingData } from '@/lib/actions';
import { mobileJson, parseMobileYear, requireMobileAuth, getMobileUpcomingEvents } from '../_shared';
import { isBefore, parseISO, startOfDay } from 'date-fns';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await requireMobileAuth(request);
  if (!authResult.ok) return authResult.response;

  const { user } = authResult.auth;
  const requestedClubId = String(request.nextUrl.searchParams.get('clubId') || '').trim();
  const linkedClubId = String((user as any)?.ownedClubId || (user as any)?.clubId || '').trim();
  const clubId = requestedClubId || linkedClubId;
  const year = parseMobileYear(request);

  if (!clubId) {
    return mobileJson(false, undefined, 'No club is linked to this account', 400);
  }

  if (requestedClubId && requestedClubId !== linkedClubId && !authResult.auth.isAdmin) {
    return mobileJson(false, undefined, 'Forbidden', 403);
  }

  try {
    const [dashboardResult, registrationsResult, rankingResult, calendarResult, upcomingEvents] = await Promise.all([
      getClubDashboardDataAction(clubId, year),
      getClubRegistrationsAction(clubId),
      getClubRankingData({ year }),
      getCalendarEventsAction(),
      getMobileUpcomingEvents(),
    ]);

    if (!dashboardResult.success || !dashboardResult.dashboard) {
      return mobileJson(false, undefined, dashboardResult.message || 'Failed to load club dashboard', 404);
    }

    const today = startOfDay(new Date());
    const upcomingCalendarEvents = Array.isArray(calendarResult.events)
      ? calendarResult.events.filter((event: any) => {
          if (event?.isHidden) return false;
          if (!event?.eventDate) return true;
          return !isBefore(parseISO(event.eventDate), today);
        })
      : [];

    const clubRanking = (rankingResult.rankings || []).find((entry: any) => String(entry?.clubId || '') === clubId) || null;

    return mobileJson(true, {
      year,
      clubId,
      club: dashboardResult.dashboard.club,
      summary: {
        totalPoints: dashboardResult.dashboard.totalPoints,
        globalRank: dashboardResult.dashboard.globalRank || clubRanking?.overallRank || null,
        athleteCount: dashboardResult.dashboard.athleteCount,
        eventCount: dashboardResult.dashboard.eventCount,
        upcomingRacesCount: dashboardResult.dashboard.upcomingRacesCount,
        sentThisMonth: dashboardResult.dashboard.emailStats?.sentThisMonth || 0,
        remainingMonthlyEmails: dashboardResult.dashboard.emailStats?.remaining || 0,
        totalLimit: dashboardResult.dashboard.emailStats?.totalLimit || 0,
      },
      members: dashboardResult.dashboard.members || [],
      monthlyPerformance: dashboardResult.dashboard.monthlyPerformance || [],
      topContributors: dashboardResult.dashboard.topContributors || [],
      bestPerformer: dashboardResult.dashboard.bestPerformer || null,
      upcomingRegistrations: registrationsResult.registrations || [],
      upcomingEvents,
      upcomingCalendarEvents,
    });
  } catch (error: any) {
    return mobileJson(false, undefined, error?.message || 'Failed to load mobile club dashboard', 500);
  }
}
