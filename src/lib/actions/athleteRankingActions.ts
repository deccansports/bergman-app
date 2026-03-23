
// src/lib/actions/athleteRankingActions.ts
'use server';

import type { RaceResult, RankedAthlete, User, LegacyAthlete, AthleteStats, ClubRankingEntry } from '../types';
import { serializeValue, normalizeStatus, toDateStringSafe, getOrdinal } from '@/lib/utils';
import { getFirestoreInstance } from '../firebaseAdmin';
import { FieldPath } from 'firebase-admin/firestore';
import { getKV, putKV } from '../cloudflare/kv';
import { _internal_fetchAllRaceDataFromFirestore, _internal_fetchAllRaceDataFromKV } from './publicResultActions';
import { sendDynamicTemplateEmail } from '../auth/brevoService';
import { authOtpConfig } from '@/lib/auth/authConfig';

const MIN_YEAR_FOR_ATHLETE_RANKING_STATS = 2022;

interface AthleteDataForRanking {
  athleteId: string;
  name: string;
  email: string | null;
  mobile: string | null; 
  gender: string | null;
  ageCategory: string | null;
  country: string | null;
  totalPoints: number;
  racesFinished: number;
  clubName: string | null;
  clubId: string | null;
  photoURL?: string | null;
  races: RaceResult[];
}

export async function computeLegacyStatus(
  stats: AthleteStats,
  currentYear: number
): Promise<AthleteStats> {
  const sortedYears = Array.from(new Set(stats.yearsFinished))
    .map(Number)
    .sort((a, b) => a - b);

  if (sortedYears.length === 0) {
      return { ...stats, yearsFinished: [], consecutiveStreak: 0, isLegacy: false, legacyValidTill: null };
  }

  let maxStreak = 0;
  let currentStreak = 1;

  for (let i = 1; i < sortedYears.length; i++) {
    if (sortedYears[i] === sortedYears[i - 1] + 1) {
      currentStreak++;
    } else {
      maxStreak = Math.max(maxStreak, currentStreak);
      currentStreak = 1;
    }
  }
  maxStreak = Math.max(maxStreak, currentStreak);

  const lastYear = sortedYears[sortedYears.length - 1];
  const yearsSet = new Set(sortedYears);

  let isLegacy = false;
  let legacyValidTill: number | null = null;

  // Criteria: 3 finishes in 3 consecutive years
  const hasCurrentStreak = yearsSet.has(currentYear) && yearsSet.has(currentYear - 1) && yearsSet.has(currentYear - 2);
  const hasPreviousStreak = yearsSet.has(currentYear - 1) && yearsSet.has(currentYear - 2) && yearsSet.has(currentYear - 3);

  if (hasCurrentStreak) {
    isLegacy = true;
    legacyValidTill = currentYear + 1;
  } else if (hasPreviousStreak) {
    isLegacy = true;
    legacyValidTill = currentYear;
  }

  return {
    yearsFinished: sortedYears,
    consecutiveStreak: maxStreak,
    lastFinishedYear: lastYear,
    isLegacy,
    legacyValidTill,
  };
}

export async function getAthleteRankingData({ year }: { year?: number }): Promise<{
  success: boolean; message: string; rankings?: RankedAthlete[]; rankingYear?: number;
}> {
  const actionName = 'getAthleteRankingData';
  let displayYear = year && year >= MIN_YEAR_FOR_ATHLETE_RANKING_STATS ? year : new Date().getFullYear();
  if (displayYear < MIN_YEAR_FOR_ATHLETE_RANKING_STATS) displayYear = MIN_YEAR_FOR_ATHLETE_RANKING_STATS;

  const rankings = await getKV<RankedAthlete[]>(`rankings:athletes:${displayYear}`, actionName);
  return { 
    success: true, 
    message: rankings ? 'Fetched.' : 'No data available.', 
    rankings: rankings || [], 
    rankingYear: displayYear 
  };
}

export async function getLegacyAthletesAction(params?: { year?: number }): Promise<{ success: boolean; message: string; legacyAthletes?: LegacyAthlete[] }> {
    const actionName = 'getLegacyAthletesAction';
    const year = params?.year || new Date().getFullYear();
    try {
        const legacy = await getKV<LegacyAthlete[]>(`legacy:athletes:${year}`, actionName);
        if (legacy) return { success: true, message: 'Fetched from KV.', legacyAthletes: legacy };
        
        const fallback = await getKV<LegacyAthlete[]>('legacy:athletes', actionName);
        return { success: true, message: 'Fetched from global fallback.', legacyAthletes: fallback || [] };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function _computeAthleteRankings({ year }: { year?: number }): Promise<{
  success: boolean; message: string; rankings?: RankedAthlete[]; rankingYear?: number;
}> {
  const actionName = '_computeAthleteRankings';
  let displayYear = year && year >= MIN_YEAR_FOR_ATHLETE_RANKING_STATS ? year : new Date().getFullYear();
  
  try {
    const raceDataResult = await _internal_fetchAllRaceDataFromFirestore({ year: displayYear });
    if (!raceDataResult.success) return { success: false, message: raceDataResult.message, rankings: [] };
    
    const allRacesForYear = raceDataResult.races || [];
    if (allRacesForYear.length === 0) return { success: true, message: "No data.", rankings: [] };

    const athletesMap = new Map<string, AthleteDataForRanking>();
    const allAthleteUids = new Set<string>();

    for (const race of allRacesForYear) {
      if (!race.athleteUid || normalizeStatus(race.status) !== 'Finished') continue;
      allAthleteUids.add(race.athleteUid);

      let athleteData = athletesMap.get(race.athleteUid);
      if (!athleteData) {
        athleteData = {
          athleteId: race.athleteUid, name: race.name, email: race.email,
          mobile: race.mobile || null, gender: (race.gender as string) || null, ageCategory: race.category, country: (race as any).countryAtRace || null,
          clubId: (race as any).clubIdAtRace || null, clubName: (race as any).clubNameAtRace || null,
          totalPoints: 0, racesFinished: 0, races: [], photoURL: null,
        };
      }
      athleteData.totalPoints += race.pointsAwarded || 0;
      athleteData.racesFinished += 1;
      athleteData.races.push(race);
      athletesMap.set(race.athleteUid, athleteData);
    }
    
    const adminDb = getFirestoreInstance();
    const uidsToFetch = Array.from(allAthleteUids);
    if (uidsToFetch.length > 0) {
      for (let i = 0; i < uidsToFetch.length; i += 30) {
        const batchUids = uidsToFetch.slice(i, i + 30);
        const usersSnapshot = await adminDb.collection('users').where(FieldPath.documentId(), 'in', batchUids).get();
        usersSnapshot.forEach(doc => {
          const userData = doc.data();
          const athlete = athletesMap.get(doc.id);
          if (athlete) athlete.photoURL = userData.photoURL || null;
        });
      }
    }

    const rankedList = Array.from(athletesMap.values()).sort((a, b) => b.totalPoints - a.totalPoints);
    const finalRankings: RankedAthlete[] = rankedList.map((athlete, index) => {
      const genderRanked = rankedList.filter(r => r.gender === athlete.gender);
      const categoryRanked = genderRanked.filter(r => r.ageCategory === athlete.ageCategory);
      return {
        ...athlete,
        gender: athlete.gender || "Unknown",
        overallRank: index + 1,
        genderOverallRank: { rank: genderRanked.findIndex(r => r.athleteId === athlete.athleteId) + 1, total: genderRanked.length },
        categoryRank: categoryRanked.findIndex(r => r.athleteId === athlete.athleteId) + 1,
        totalInCategory: categoryRanked.length,
      };
    });

    await putKV(`rankings:athletes:${displayYear}`, finalRankings, actionName);
    return { success: true, message: "Computed.", rankings: finalRankings, rankingYear: displayYear };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function _computeLegacyAthletes(): Promise<{
  success: boolean; message: string; legacyAthletes?: LegacyAthlete[];
}> {
  const actionName = '_computeLegacyAthletes';
  const currentYear = new Date().getFullYear();

  try {
    const { races } = await _internal_fetchAllRaceDataFromFirestore(); 
    if (!races || races.length === 0) return { success: true, message: 'No race data.', legacyAthletes: [] };

    const athleteYearMap = new Map<string, Set<number>>();
    const athleteNameMap = new Map<string, string>();
    const athleteEmailMap = new Map<string, string>();
    const athleteRacesMap = new Map<string, RaceResult[]>();

    for (const race of races) {
      if (!race.athleteUid || normalizeStatus(race.status) !== 'Finished' || !race.raceYear) continue;
      if (!athleteYearMap.has(race.athleteUid)) athleteYearMap.set(race.athleteUid, new Set());
      athleteYearMap.get(race.athleteUid)!.add(Number(race.raceYear));
      athleteNameMap.set(race.athleteUid, race.name);
      athleteEmailMap.set(race.athleteUid, race.email);
      if (!athleteRacesMap.has(race.athleteUid)) athleteRacesMap.set(race.athleteUid, []);
      athleteRacesMap.get(race.athleteUid)!.push(race);
    }

    const legacyAthletes: LegacyAthlete[] = [];
    for (const [uid, yearsSet] of Array.from(athleteYearMap.entries())) {
      const stats: AthleteStats = { yearsFinished: Array.from(yearsSet), consecutiveStreak: 0, lastFinishedYear: null, isLegacy: false, legacyValidTill: null };
      const updatedStats = await computeLegacyStatus(stats, currentYear);
      if (updatedStats.isLegacy) {
        legacyAthletes.push({
          name: athleteNameMap.get(uid) || 'Athlete',
          email: athleteEmailMap.get(uid) || '',
          achievementYears: `${updatedStats.yearsFinished[0]}–${updatedStats.lastFinishedYear}`,
          totalYears: updatedStats.consecutiveStreak,
          contributingRaces: (athleteRacesMap.get(uid) || []).map(r => ({
            raceName: r.eventName || r.raceCategory,
            raceDate: r.raceDate!,
            location: r.location,
            year: Number(r.raceYear!),
            pointsEarned: r.pointsAwarded || 0
          }))
        });
      }
    }

    await putKV(`legacy:athletes:${currentYear}`, legacyAthletes, actionName);
    await putKV('legacy:athletes', legacyAthletes, actionName);
    return { success: true, message: `Computed ${legacyAthletes.length} legacy athletes.`, legacyAthletes };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function sendYearlyRecapEmailAction(
  data: RankedAthlete | ClubRankingEntry,
  year: number,
  isTest: boolean = false
): Promise<{ success: boolean; message: string }> {
  const actionName = 'sendYearlyRecapEmailAction';
  const isClubRecap = 'contributingAthleteDetails' in data;
  let recipientEmail: string | null | undefined = isTest ? (data as any).email : (isClubRecap ? (data as ClubRankingEntry).email : (data as RankedAthlete).email);

  if (!recipientEmail) return { success: false, message: 'Recipient email missing.' };
  
  const templateId = isClubRecap 
    ? authOtpConfig.brevo.clubYearlyRecapTemplateId 
    : authOtpConfig.brevo.yearlyRecapTemplateId;
    
  if (!templateId || templateId === 0) return { success: false, message: 'Template not configured in Brevo.' };

  const params: Record<string, any> = isClubRecap ? {
      year, 
      clubName: (data as ClubRankingEntry).clubName, 
      totalPoints: (data as ClubRankingEntry).totalPoints,
      overallRank: (data as ClubRankingEntry).overallRank ? `${(data as ClubRankingEntry).overallRank}${getOrdinal((data as ClubRankingEntry).overallRank!)}` : 'Unranked',
      athlete_count: (data as ClubRankingEntry).athleteCount,
      event_count: (data as ClubRankingEntry).eventCount,
  } : {
      year, 
      name: (data as RankedAthlete).name, 
      points: (data as RankedAthlete).totalPoints,
      position: (data as RankedAthlete).overallRank ? `${(data as RankedAthlete).overallRank}${getOrdinal((data as RankedAthlete).overallRank)}` : 'N/A',
      rank_category: (data as RankedAthlete).categoryRank ? `${(data as RankedAthlete).categoryRank}${getOrdinal((data as RankedAthlete).categoryRank)}` : 'N/A',
      category_name: (data as RankedAthlete).ageCategory,
      races_count: (data as RankedAthlete).racesFinished,
      best_performance: (data as RankedAthlete).races?.sort((a,b) => (b.pointsAwarded || 0) - (a.pointsAwarded || 0))[0]?.eventName || 'N/A'
  };

  const success = await sendDynamicTemplateEmail(templateId, recipientEmail, params, actionName);
  return { success, message: success ? 'Recap email sent.' : 'Failed to deliver email via Brevo.' };
}
