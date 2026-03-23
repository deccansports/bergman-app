import { NextResponse } from 'next/server';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import { _internal_fetchAllRaceDataFromKV } from '@/lib/actions/publicResultActions';
import { calculateAthleteTierData } from '@/lib/actions/athleteTierLogic';
import type { AthleteTierStats } from '@/lib/types/athleteTier';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mobile = searchParams.get('mobile');

  if (!mobile) {
    return NextResponse.json({ success: false, message: 'Mobile number is required' }, { status: 400 });
  }

  try {
    const kvKey = `athlete:${mobile}`;
    let tierStats = await getKV<AthleteTierStats>(kvKey, 'DashboardAPI');

    const raceDataResult = await _internal_fetchAllRaceDataFromKV();
    const allRaces = raceDataResult.races || [];
    
    const athleteRaces = allRaces.filter(r => r.mobile === mobile || r.mobile === `+91${mobile}` || `+91${r.mobile}` === mobile);
    
    // Sort recent races
    const recent_results = athleteRaces
      .sort((a,b) => new Date(b.raceDate || 0).getTime() - new Date(a.raceDate || 0).getTime())
      .slice(0, 5)
      .map(r => ({
        eventName: r.eventName,
        raceDate: r.raceDate,
        chipTime: r.chipTime,
        status: r.statusNormalized || r.status
      }));

    // If stats don't exist in KV, or we just want to ensure it's up-to-date
    // Since points calculate dynamically from races, we can compute it if missing.
    // However, if we recalculate it always, it defeats caching. But for this requirement, let's calculate if missing or outdated.
    const name = athleteRaces.length > 0 ? athleteRaces[0].name : 'Athlete';
    const computedStats = calculateAthleteTierData(mobile, name, athleteRaces);
    
    // Auto-update KV if points mismatch (to keep it fresh when new races are added)
    if (!tierStats || tierStats.points !== computedStats.points) {
      await putKV(kvKey, computedStats, 'DashboardAPI');
      tierStats = computedStats;
    }

    // Dummy leaderboard rank for now unless globally ranked
    const leaderboard_rank = Math.floor(Math.random() * 50) + 1;

    return NextResponse.json({
      success: true,
      data: {
        ...tierStats,
        leaderboard_rank, // Ideally fetched from a sorted global set
        recent_results
      }
    });
  } catch (error: any) {
    console.error('API Error in /dashboard', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
