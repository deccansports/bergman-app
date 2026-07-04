'use server';

import { getFirestoreInstance } from '../firebaseAdmin';
import { getKV, putKV } from '../cloudflare/kv';
import type { Club, User } from '@/lib/types';
import { _internal_fetchAllRaceDataFromFirestore } from './publicResultActions';

interface ClubWithStats extends Club {
  memberCount: number;
  totalPoints: number;
  activeMembers: number;
  pastMembers: number;
  rank?: number;
}

/**
 * Get club member counts and points from KV cache and Firestore
 * Much faster than scanning all users
 */
export async function getClubMemberStatsAction(clubId: string): Promise<{
  success: boolean;
  message: string;
  memberCount?: number;
  totalPoints?: number;
  activeMembers?: number;
  pastMembers?: number;
}> {
  try {
    const adminDb = getFirestoreInstance();

    // Try to get cached stats first
    const cachedStats = await getKV<any>(`club:${clubId}:stats`, 'getClubMemberStats');
    if (cachedStats) {
      return {
        success: true,
        message: 'Stats retrieved from cache',
        memberCount: cachedStats.memberCount || 0,
        totalPoints: cachedStats.totalPoints || 0,
        activeMembers: cachedStats.activeMembers || 0,
        pastMembers: cachedStats.pastMembers || 0,
      };
    }

    // If not in cache, calculate from Firestore
    const usersSnapshot = await adminDb.collection('users').get();
    let memberCount = 0;
    let activeMembers = 0;
    let pastMembers = 0;
    let totalPoints = 0;

    for (const doc of usersSnapshot.docs) {
      const user = doc.data() as User;

      // Check current club membership
      if (user.clubId === clubId) {
        memberCount++;
        activeMembers++;
      }

      // Check club history for past memberships
      if (user.clubHistory) {
        for (const entry of user.clubHistory) {
          if (entry.clubId === clubId && !entry.isActive) {
            if (!user.clubId || user.clubId !== clubId) {
              pastMembers++;
            }
          }
        }
      }
    }

    // Cache the stats
    await putKV(
      `club:${clubId}:stats`,
      { memberCount, totalPoints, activeMembers, pastMembers },
      'getClubMemberStats'
    );

    return {
      success: true,
      message: 'Stats calculated and cached',
      memberCount,
      totalPoints,
      activeMembers,
      pastMembers,
    };
  } catch (e: any) {
    return {
      success: false,
      message: e.message,
    };
  }
}

/**
 * Get all clubs enriched with member stats from KV cache (OPTIMIZED)
 * Scans users once instead of per-club
 * Also fetches points from current year rankings
 */
export async function getAllClubsWithStatsAction(year?: number): Promise<{
  success: boolean;
  message: string;
  clubs?: ClubWithStats[];
}> {
  try {
    const adminDb = getFirestoreInstance();
    const displayYear = year || new Date().getFullYear();
    const normalizeText = (value: unknown) => String(value || '').trim().toLowerCase();

    // Try to get cached result first (5 minute TTL)
    const cacheKey = `clubs:stats:${displayYear}:v4`;
    const cachedClubs = await getKV<any[]>(cacheKey, 'getAllClubsWithStatsAction');
    if (cachedClubs && Array.isArray(cachedClubs) && cachedClubs.length > 0) {
      return {
        success: true,
        message: 'Clubs with stats retrieved (cached)',
        clubs: cachedClubs,
      };
    }

    // Get all clubs first
    const clubsSnapshot = await adminDb.collection('clubs').get();
    const clubMap = new Map<string, ClubWithStats>();
    const clubIdByName = new Map<string, string>();
    const clubsByOwnerId = new Map<string, ClubWithStats>();

    // Initialize all clubs with zero stats
    for (const doc of clubsSnapshot.docs) {
      const club = doc.data() as Club;
      const clubWithStats: ClubWithStats = {
        ...club,
        id: doc.id,
        memberCount: 0,
        totalPoints: 0,
        activeMembers: 0,
        pastMembers: 0,
      };
      clubMap.set(doc.id, clubWithStats);
      clubIdByName.set(normalizeText(club.name), doc.id);
      
      // Map by ownerUid for quick lookup
      if (club.ownerUid) {
        clubsByOwnerId.set(club.ownerUid, clubWithStats);
      }
    }

    // Fetch club rankings in parallel with user scan
    const rankingsPromise = getKV<any[]>(`rankings:clubs:${displayYear}`, 'getAllClubsWithStatsAction');
    const usersSnapshot = await adminDb.collection('users').get();

    // Process users to count members and populate ownerEmail
    for (const userDoc of usersSnapshot.docs) {
      const user = userDoc.data() as User;
      const userId = userDoc.id;

      // Count current club membership (active)
      if (user.clubId && clubMap.has(user.clubId)) {
        const club = clubMap.get(user.clubId)!;
        club.memberCount += 1;
        club.activeMembers += 1;
      }

      // Count past club memberships from history
      if (user.clubHistory && Array.isArray(user.clubHistory)) {
        for (const entry of user.clubHistory) {
          if (!entry.isActive && clubMap.has(entry.clubId)) {
            // Only count as past member if they're not currently in this club
            if (user.clubId !== entry.clubId) {
              const club = clubMap.get(entry.clubId)!;
              club.pastMembers += 1;
            }
          }
        }
      }

      // Populate ownerEmail for clubs where it's missing
      // First try by ownedClubId
      if (user.ownedClubId && clubMap.has(user.ownedClubId)) {
        const club = clubMap.get(user.ownedClubId)!;
        if (!club.ownerEmail && user.email) {
          club.ownerEmail = user.email.toLowerCase();
        }
      }
      
      // Also try by UID match (in case ownedClubId is not set)
      if (userId && clubsByOwnerId.has(userId) && user.email) {
        const club = clubsByOwnerId.get(userId)!;
        if (!club.ownerEmail) {
          club.ownerEmail = user.email.toLowerCase();
        }
      }
    }

    // Wait for rankings to complete
    const clubRankings = await rankingsPromise;
    const pointsMap = new Map<string, number>();
    const rankMap = new Map<string, number>();
    
    if (clubRankings && Array.isArray(clubRankings)) {
      for (const ranking of clubRankings) {
        pointsMap.set(ranking.clubId, ranking.totalPoints || 0);
        if (ranking.overallRank) {
          rankMap.set(ranking.clubId, ranking.overallRank);
        }
      }
    }

    // Fallback for historical years where rankings KV may not exist
    if (pointsMap.size === 0) {
      const raceResult = await _internal_fetchAllRaceDataFromFirestore({ year: displayYear });
      const fallbackContributors = new Map<string, Set<string>>();

      for (const race of raceResult.races || []) {
        const clubId = race.clubIdAtRace || clubIdByName.get(normalizeText(race.clubNameAtRace));
        if (!clubId || !clubMap.has(clubId)) continue;
        const points = race.pointsAwarded || 0;
        if (points <= 0) continue;

        pointsMap.set(clubId, (pointsMap.get(clubId) || 0) + points);

        const athleteKey = race.athleteUid || race.athleteEmail || race.emailLower || race.email;
        if (athleteKey) {
          if (!fallbackContributors.has(clubId)) fallbackContributors.set(clubId, new Set<string>());
          fallbackContributors.get(clubId)!.add(String(athleteKey).toLowerCase());
        }
      }

      const rankedFallbackClubs = Array.from(clubMap.values())
        .map((club) => ({
          clubId: club.id,
          totalPoints: pointsMap.get(club.id) || 0,
          contributingAthletes: fallbackContributors.get(club.id)?.size || 0,
        }))
        .filter((club) => club.totalPoints > 0 && club.contributingAthletes >= 3)
        .sort((a, b) => b.totalPoints - a.totalPoints);

      rankedFallbackClubs.forEach((club, index) => {
        rankMap.set(club.clubId, index + 1);
      });
    }

    // Apply points and ranks from rankings
    for (const [clubId, club] of clubMap) {
      club.totalPoints = pointsMap.get(clubId) || 0;
      const rank = rankMap.get(clubId);
      if (rank) {
        club.rank = rank;
      }
    }

    // Convert to array and sort by rank, then by points
    const clubsWithStats = Array.from(clubMap.values());
    clubsWithStats.sort((a, b) => {
      const rankA = a.rank || Infinity;
      const rankB = b.rank || Infinity;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return (b.totalPoints || 0) - (a.totalPoints || 0);
    });

    // Serialize clubs to ensure no non-serializable objects
    const serializedClubs = JSON.parse(JSON.stringify(clubsWithStats));

    // Cache the result for 5 minutes
    await putKV(cacheKey, serializedClubs, 'getAllClubsWithStatsAction');

    return {
      success: true,
      message: 'Clubs with stats retrieved',
      clubs: serializedClubs,
    };
  } catch (e: any) {
    return {
      success: false,
      message: e.message,
    };
  }
}

/**
 * Refresh club stats in KV cache
 * Call this after member changes
 */
export async function refreshClubStatsAction(clubId?: string): Promise<{
  success: boolean;
  message: string;
  refreshedCount?: number;
}> {
  try {
    const adminDb = getFirestoreInstance();
    let refreshedCount = 0;

    if (clubId) {
      // Refresh specific club
      await getClubMemberStatsAction(clubId);
      refreshedCount = 1;
    } else {
      // Refresh all clubs
      const clubsSnapshot = await adminDb.collection('clubs').get();
      for (const doc of clubsSnapshot.docs) {
        await getClubMemberStatsAction(doc.id);
        refreshedCount++;
      }
    }

    return {
      success: true,
      message: `Refreshed ${refreshedCount} club stats`,
      refreshedCount,
    };
  } catch (e: any) {
    return {
      success: false,
      message: e.message,
    };
  }
}

/**
 * Get club stats for year with points calculation
 */
export async function getClubStatsForYearAction(clubId: string, year: number): Promise<{
  success: boolean;
  message: string;
  memberCount?: number;
  activeMembers?: number;
  totalPoints?: number;
  yearPoints?: { [athleteUid: string]: number };
}> {
  try {
    const adminDb = getFirestoreInstance();

    // Get members in this club
    const usersSnapshot = await adminDb.collection('users').get();
    let memberCount = 0;
    let activeMembers = 0;
    const athleteUids: string[] = [];

    for (const doc of usersSnapshot.docs) {
      const user = doc.data() as User;
      if (user.clubId === clubId) {
        memberCount++;
        activeMembers++;
        athleteUids.push(doc.id);
      }
    }

    // Get points from KV cache for the year
    let totalPoints = 0;
    const yearPoints: { [athleteUid: string]: number } = {};

    for (const uid of athleteUids) {
      const athleteRankings = await getKV<any>(
        `athlete:${uid}:rankings:${year}`,
        'getClubStatsForYear'
      );
      if (athleteRankings && athleteRankings.points) {
        yearPoints[uid] = athleteRankings.points;
        totalPoints += athleteRankings.points;
      }
    }

    return {
      success: true,
      message: 'Club stats for year retrieved',
      memberCount,
      activeMembers,
      totalPoints,
      yearPoints,
    };
  } catch (e: any) {
    return {
      success: false,
      message: e.message,
    };
  }
}
