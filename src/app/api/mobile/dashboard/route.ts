import { NextRequest } from 'next/server';
import { calculateAthleteTierData } from '@/lib/actions/athleteTierLogic';
import { getAthleteRankingData, getAthleteRaceHistoryAction, getClubRankingData, getCalendarEventsAction } from '@/lib/actions';
import { getAthleteRegisteredEventsAction } from '@/lib/actions/userActions';
import { mobileJson, parseMobileYear, requireMobileAuth, getMobileUpcomingEvents } from '../_shared';
import { normalizeStatus } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function matchesAthlete(entry: any, uid: string, email: string, mobile: string) {
  const athleteId = String(entry?.athleteId || '').trim();
  const entryEmail = String(entry?.email || '').toLowerCase().trim();
  const entryMobile = String(entry?.mobile || '').replace(/\D/g, '');
  const normalizedMobile = String(mobile || '').replace(/\D/g, '');
  return (
    athleteId === uid ||
    (email && entryEmail === email) ||
    (normalizedMobile && (entryMobile === normalizedMobile || entryMobile.endsWith(normalizedMobile.slice(-10))))
  );
}

export async function GET(request: NextRequest) {
  const authResult = await requireMobileAuth(request);
  if (!authResult.ok) return authResult.response;

  const { uid, user } = authResult.auth;
  const year = parseMobileYear(request);
  const email = String((user as any)?.email || '').toLowerCase().trim();
  const mobile = String((user as any)?.mobile || '').trim();

  try {
    const [raceHistory, registrations, athleteRankings, clubRankings, upcomingEvents, calendarResult] = await Promise.all([
      getAthleteRaceHistoryAction(email, uid, mobile),
      getAthleteRegisteredEventsAction(uid, email || null, { upcomingOnly: true }),
      getAthleteRankingData({ year }),
      getClubRankingData({ year }),
      getMobileUpcomingEvents(),
      getCalendarEventsAction(),
    ]);

    const races = (raceHistory.success && Array.isArray(raceHistory.races) ? raceHistory.races : [])
      .slice()
      .sort((a, b) => new Date(b.raceDate || 0).getTime() - new Date(a.raceDate || 0).getTime());

    const athleteRankingEntry = (athleteRankings.rankings || []).find((entry: any) => matchesAthlete(entry, uid, email, mobile)) || null;
    const clubId = String((user as any)?.ownedClubId || (user as any)?.clubId || '').trim();
    const clubRankingEntry = clubId
      ? (clubRankings.rankings || []).find((entry: any) => String(entry?.clubId || '').trim() === clubId) || null
      : null;

    const tier = calculateAthleteTierData(mobile, String((user as any)?.name || 'Athlete'), races);
    const finishedRaces = races.filter((race) => normalizeStatus(race.status) === 'Finished');

    return mobileJson(true, {
      profile: {
        uid,
        name: (user as any)?.name || null,
        email: (user as any)?.email || null,
        mobile: (user as any)?.mobile || null,
        photoURL: (user as any)?.photoURL || null,
        clubId: (user as any)?.clubId || null,
        clubName: (user as any)?.clubName || null,
        ownedClubId: (user as any)?.ownedClubId || null,
        activeDeferral: (user as any)?.activeDeferral || null,
        activeCancellation: (user as any)?.activeCancellation || null,
        isAdmin: Boolean((user as any)?.isAdmin),
      },
      summary: {
        points: tier.points,
        tier: tier.tier,
        progress: tier.progress,
        totalRaces: tier.total_races,
        badges: tier.badges,
        finishedRaces: finishedRaces.length,
        athleteRank: athleteRankingEntry?.overallRank || null,
        athletePoints: athleteRankingEntry?.totalPoints || null,
        clubRank: clubRankingEntry?.overallRank || null,
        clubPoints: clubRankingEntry?.totalPoints || null,
        registeredEventsCount: (registrations.events || []).length,
        upcomingEventsCount: upcomingEvents.length,
      },
      raceHistory: races,
      registeredEvents: registrations.events || [],
      athleteRanking: athleteRankingEntry,
      clubRanking: clubRankingEntry,
      upcomingEvents,
      liveEvents: Array.isArray((calendarResult as any)?.events)
        ? (calendarResult as any).events.filter((event: any) => Boolean(event?.showLiveTrackingOnHomepage || event?.liveTrackingHub?.trackingConfig?.enabled))
        : [],
      year,
    });
  } catch (error: any) {
    return mobileJson(false, undefined, error?.message || 'Failed to load mobile dashboard', 500);
  }
}
