import { NextRequest, NextResponse } from 'next/server';
import { getKV } from '@/lib/cloudflare/kv';
import { resolveLiveTrackingAccess } from '@/lib/liveTrackingAccess';

export const dynamic = 'force-dynamic';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return normalize(value).toLowerCase();
}

/**
 * GET /api/live/leaderboard/[eventId]
 * 
 * Returns the leaderboard for a specific event, optionally filtered by:
 * - contest: contest UUID or name
 * - ageGroup: age group UUID or name
 * - gender: Male, Female, or All
 * 
 * Query params:
 * - contest: (optional) filter by contest
 * - ageGroup: (optional) filter by age group
 * - gender: (optional) filter by gender (Male, Female, All)
 * - limit: (optional) max results (default 100)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const eventId = normalize(params.eventId);
  const contestFilter = normalize(request.nextUrl.searchParams.get('contest') || '');
  const ageGroupFilter = normalize(request.nextUrl.searchParams.get('ageGroup') || '');
  const genderFilter = normalize(request.nextUrl.searchParams.get('gender') || 'All');
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 100), 500);

  if (!eventId) {
    return NextResponse.json(
      { error: 'Event ID is required' },
      { status: 400 }
    );
  }

  try {
    // Check access permissions
    const access = await resolveLiveTrackingAccess(request);
    if (!access) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Load leaderboard index from KV
    const leaderboardKey = `live:event:${eventId}:leaderboard`;
    const leaderboardData = await getKV<any>(leaderboardKey, 'api-live-leaderboard');

    if (!leaderboardData || typeof leaderboardData !== 'object') {
      return NextResponse.json({
        success: true,
        eventId,
        athletes: [],
        contest: contestFilter,
        ageGroup: ageGroupFilter,
        gender: genderFilter,
        count: 0,
        source: 'kv',
      });
    }

    // Extract athletes from leaderboard based on filters
    const athletes: any[] = [];
    const lowerGenderFilter = lower(genderFilter);
    const lowerAgeGroupFilter = lower(ageGroupFilter);
    const lowerContestFilter = lower(contestFilter);

    // Navigate through the leaderboard structure
    for (const [contestKey, contestData] of Object.entries(leaderboardData)) {
      if (!contestData || typeof contestData !== 'object') continue;

      // Filter by contest if specified
      if (
        lowerContestFilter &&
        !lower(contestKey).includes(lowerContestFilter) &&
        !lower((contestData as any).contestName || '').includes(lowerContestFilter) &&
        !lower((contestData as any).contestUuid || '').includes(lowerContestFilter)
      ) {
        continue;
      }

      for (const [ageGroupKey, ageGroupData] of Object.entries(contestData)) {
        if (!ageGroupData || typeof ageGroupData !== 'object') continue;

        // Filter by age group if specified
        if (
          lowerAgeGroupFilter &&
          !lower(ageGroupKey).includes(lowerAgeGroupFilter) &&
          !lower((ageGroupData as any).ageGroupName || '').includes(lowerAgeGroupFilter) &&
          !lower((ageGroupData as any).ageGroupUuid || '').includes(lowerAgeGroupFilter)
        ) {
          continue;
        }

        for (const [genderKey, genderData] of Object.entries(ageGroupData)) {
          if (!Array.isArray(genderData)) continue;

          // Filter by gender if specified
          if (lowerGenderFilter !== 'all' && !lower(genderKey).startsWith(lowerGenderFilter)) {
            continue;
          }

          // Add athletes from this gender category
          for (const athlete of genderData) {
            if (!athlete || typeof athlete !== 'object') continue;

            athletes.push({
              rank: athlete.rank || athletes.length + 1,
              athleteId: athlete.athleteId || athlete.id || null,
              name: normalize(athlete.name || athlete.fullName || ''),
              bib: normalize(athlete.bib || ''),
              bibNumber: athlete.bibNumber || null,
              contest: normalize(athlete.contest || (contestData as any).contestName || contestKey),
              ageGroup: normalize(athlete.ageGroup || ageGroupKey),
              gender: normalize(athlete.gender || genderKey),
              currentLeg: athlete.currentLeg || athlete.leg || 'NOT_STARTED',
              gap: athlete.gap || '00:00:00',
              deltaTime: athlete.deltaTime || null,
              status: athlete.status || 'Racing',
              speed: athlete.speed || null,
              pace: athlete.pace || null,
              distanceCovered: athlete.distanceCovered || 0,
              distanceRemaining: athlete.distanceRemaining || null,
              eta: athlete.eta || null,
              lastUpdated: athlete.lastUpdated || null,
            });
          }
        }
      }
    }

    // Sort by rank and limit results
    athletes.sort((a, b) => (a.rank || 999) - (b.rank || 999));
    const limited = athletes.slice(0, limit);

    return NextResponse.json({
      success: true,
      eventId,
      athletes: limited,
      contest: contestFilter,
      ageGroup: ageGroupFilter,
      gender: genderFilter,
      count: limited.length,
      total: athletes.length,
      source: 'kv',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[leaderboard/${eventId}] Error:`, error);
    return NextResponse.json(
      {
        error: 'Failed to load leaderboard',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
