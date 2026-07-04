
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
        const legacyFromYear = await getKV<LegacyAthlete[]>(`legacy:athletes:${year}`, actionName);
        const sourceLabel = legacyFromYear ? 'year' : 'global';
        const baseLegacy = legacyFromYear || await getKV<LegacyAthlete[]>('legacy:athletes', actionName) || [];

        if (baseLegacy.length === 0) {
          return { success: true, message: `Fetched from ${sourceLabel} KV.`, legacyAthletes: [] };
        }

        const needsEnrichment = baseLegacy.some(a =>
          a.athleteUid === undefined ||
          a.mobile === undefined ||
          a.address === undefined ||
          a.city === undefined ||
          a.state === undefined ||
          a.pincode === undefined ||
          a.country === undefined
        );
        if (!needsEnrichment) {
          return { success: true, message: `Fetched from ${sourceLabel} KV.`, legacyAthletes: baseLegacy };
        }

        const adminDb = getFirestoreInstance();
        const profileByUid = new Map<string, {
          uid: string;
          mobile: string | null;
          address: string | null;
          city: string | null;
          state: string | null;
          pincode: string | null;
          country: string | null;
        }>();
        const profileByEmail = new Map<string, {
          uid: string;
          mobile: string | null;
          address: string | null;
          city: string | null;
          state: string | null;
          pincode: string | null;
          country: string | null;
        }>();

        const composeAddress = (u: Partial<User>): string | null => {
          const addr = [u.address, u.city, u.state, u.pincode, u.country]
            .map(v => typeof v === 'string' ? v.trim() : '')
            .filter(Boolean)
            .join(', ');
          return addr || null;
        };

        const uidCandidates = Array.from(new Set(baseLegacy.map(a => a.athleteUid).filter(Boolean) as string[]));
        for (let i = 0; i < uidCandidates.length; i += 30) {
          const batch = uidCandidates.slice(i, i + 30);
          if (batch.length === 0) continue;
          const snap = await adminDb.collection('users').where(FieldPath.documentId(), 'in', batch).get();
          snap.forEach(doc => {
            const userData = doc.data() as User;
            const profile = {
              uid: doc.id,
              mobile: userData.mobile || null,
              address: composeAddress(userData),
              city: userData.city || null,
              state: userData.state || null,
              pincode: userData.pincode || null,
              country: userData.country || null,
            };
            profileByUid.set(doc.id, profile);
            const emailLower = String(userData.email || '').trim().toLowerCase();
            if (emailLower) profileByEmail.set(emailLower, profile);
          });
        }

        const unresolvedEmails = Array.from(new Set(
          baseLegacy
            .filter(a => !a.athleteUid || !profileByUid.get(a.athleteUid))
            .map(a => String(a.email || '').trim())
            .filter(Boolean)
        ));

        for (let i = 0; i < unresolvedEmails.length; i += 30) {
          const batch = unresolvedEmails.slice(i, i + 30);
          if (batch.length === 0) continue;
          const snap = await adminDb.collection('users').where('email', 'in', batch).get();
          snap.forEach(doc => {
            const userData = doc.data() as User;
            const profile = {
              uid: doc.id,
              mobile: userData.mobile || null,
              address: composeAddress(userData),
              city: userData.city || null,
              state: userData.state || null,
              pincode: userData.pincode || null,
              country: userData.country || null,
            };
            profileByUid.set(doc.id, profile);
            const emailLower = String(userData.email || '').trim().toLowerCase();
            if (emailLower) profileByEmail.set(emailLower, profile);
          });
        }

        const enrichedLegacy = baseLegacy.map((athlete) => {
          const fromUid = athlete.athleteUid ? profileByUid.get(athlete.athleteUid) : undefined;
          const fromEmail = profileByEmail.get(String(athlete.email || '').trim().toLowerCase());
          const profile = fromUid || fromEmail;

          return {
            ...athlete,
            athleteUid: athlete.athleteUid || profile?.uid,
            mobile: athlete.mobile ?? profile?.mobile ?? null,
            address: athlete.address ?? profile?.address ?? null,
            city: athlete.city ?? profile?.city ?? null,
            state: athlete.state ?? profile?.state ?? null,
            pincode: athlete.pincode ?? profile?.pincode ?? null,
            country: athlete.country ?? profile?.country ?? null,
          };
        });

        await putKV(`legacy:athletes:${year}`, enrichedLegacy, actionName);
        await putKV('legacy:athletes', enrichedLegacy, actionName);

        return {
          success: true,
          message: `Fetched from ${sourceLabel} KV and enriched from user data.`,
          legacyAthletes: enrichedLegacy,
        };
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

    const athleteProfileMap = new Map<string, {
      mobile: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      pincode: string | null;
      country: string | null;
    }>();
    const legacyCandidateUids = Array.from(athleteYearMap.keys());

    if (legacyCandidateUids.length > 0) {
      const adminDb = getFirestoreInstance();
      for (let i = 0; i < legacyCandidateUids.length; i += 30) {
        const batchUids = legacyCandidateUids.slice(i, i + 30);
        const usersSnapshot = await adminDb.collection('users').where(FieldPath.documentId(), 'in', batchUids).get();
        usersSnapshot.forEach(doc => {
          const userData = doc.data() as User;
          const composedAddress = [userData.address, userData.city, userData.state, userData.pincode, userData.country]
            .map(v => typeof v === 'string' ? v.trim() : '')
            .filter(Boolean)
            .join(', ');

          athleteProfileMap.set(doc.id, {
            mobile: userData.mobile || null,
            address: composedAddress || null,
            city: userData.city || null,
            state: userData.state || null,
            pincode: userData.pincode || null,
            country: userData.country || null,
          });
        });
      }
    }

    const legacyAthletes: LegacyAthlete[] = [];
    for (const [uid, yearsSet] of Array.from(athleteYearMap.entries())) {
      const stats: AthleteStats = { yearsFinished: Array.from(yearsSet), consecutiveStreak: 0, lastFinishedYear: null, isLegacy: false, legacyValidTill: null };
      const updatedStats = await computeLegacyStatus(stats, currentYear);
      if (updatedStats.isLegacy) {
        const userProfile = athleteProfileMap.get(uid);
        const fallbackRace = (athleteRacesMap.get(uid) || [])[0];
        legacyAthletes.push({
          athleteUid: uid,
          name: athleteNameMap.get(uid) || 'Athlete',
          email: athleteEmailMap.get(uid) || '',
          mobile: userProfile?.mobile || fallbackRace?.mobile || null,
          address: userProfile?.address || null,
          city: userProfile?.city || fallbackRace?.cityAtRace || null,
          state: userProfile?.state || fallbackRace?.stateAtRace || null,
          pincode: userProfile?.pincode || null,
          country: userProfile?.country || fallbackRace?.countryAtRace || null,
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
    
  if (!templateId || templateId === 0) return { success: false, message: 'Template not configured for BergTechno provider.' };

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
  return { success, message: success ? 'Recap email sent.' : 'Failed to deliver email via BergTechno.' };
}
