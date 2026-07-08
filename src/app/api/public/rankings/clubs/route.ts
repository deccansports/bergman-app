// src/app/api/public/rankings/clubs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getClubRankingData } from '@/lib/actions/clubActions';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get('year');
  const year = yearParam ? parseInt(yearParam, 10) : undefined;

  if (yearParam && isNaN(year!)) {
    return NextResponse.json({ success: false, message: 'Invalid year parameter.' }, { status: 400 });
  }

  const result = await getClubRankingData({ year });
  if (result.success) {
    return NextResponse.json({ success: true, rankingYear: result.rankingYear, rankings: result.rankings });
  } else {
    return NextResponse.json({ success: false, message: result.message }, { status: 500 });
  }
}
