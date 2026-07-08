import { NextRequest } from 'next/server';
import { getAllClubsWithStatsAction } from '@/lib/actions/clubStatsActions';
import { mobileJson, parseMobileYear, requireMobileAuth } from '../_shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await requireMobileAuth(request);
  if (!authResult.ok) return authResult.response;

  const year = parseMobileYear(request);
  const searchParams = request.nextUrl.searchParams;
  const q = String(searchParams.get('q') || searchParams.get('search') || '').trim().toLowerCase();
  const city = String(searchParams.get('city') || '').trim().toLowerCase();
  const state = String(searchParams.get('state') || '').trim().toLowerCase();
  const country = String(searchParams.get('country') || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '0', 10) || 0, 200));

  try {
    const result = await getAllClubsWithStatsAction(year);
    const clubs = (result.clubs || [])
      .filter((club: any) => {
        const name = String(club?.name || '').toLowerCase();
        const coach = String(club?.coach_name || '').toLowerCase();
        const clubCity = String(club?.city || '').toLowerCase();
        const clubState = String(club?.state || '').toLowerCase();
        const clubCountry = String(club?.country || '').toLowerCase();

        const matchesQuery = !q || name.includes(q) || coach.includes(q);
        const matchesCity = !city || clubCity === city;
        const matchesState = !state || clubState === state;
        const matchesCountry = !country || clubCountry === country;
        return matchesQuery && matchesCity && matchesState && matchesCountry;
      })
      .sort((a: any, b: any) => {
        const pointsA = Number(a?.totalPoints || 0);
        const pointsB = Number(b?.totalPoints || 0);
        if (pointsA !== pointsB) return pointsB - pointsA;
        const membersA = Number(a?.memberCount || 0);
        const membersB = Number(b?.memberCount || 0);
        if (membersA !== membersB) return membersB - membersA;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
      })
      .slice(0, limit > 0 ? limit : undefined)
      .map((club: any) => ({
        id: club.id,
        name: club.name || 'Club',
        coach_name: club.coach_name || null,
        email: club.email || null,
        mobile: club.mobile || null,
        city: club.city || null,
        state: club.state || null,
        country: club.country || null,
        memberCount: club.memberCount || 0,
        activeMembers: club.activeMembers || 0,
        pastMembers: club.pastMembers || 0,
        totalPoints: club.totalPoints || 0,
        rank: club.rank || null,
        ownerUid: club.ownerUid || null,
        ownerEmail: club.ownerEmail || null,
        logoUrl: club.logoUrl || null,
      }));

    return mobileJson(true, {
      year,
      totalCount: clubs.length,
      filters: { q, city, state, country, limit: limit || null },
      clubs,
    });
  } catch (error: any) {
    return mobileJson(false, undefined, error?.message || 'Failed to load mobile training data', 500);
  }
}
