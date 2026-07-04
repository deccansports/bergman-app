
// src/lib/actions/clubActions.ts
'use server';

import { getAuthInstance, getFirestoreInstance } from '../firebaseAdmin';
import { FieldValue, type Firestore, FieldPath, type QueryDocumentSnapshot, type DocumentData } from 'firebase-admin/firestore';
import type { Club, User, ClubRankingEntry, ClubAthleteContribution, ClubMemberPerformanceForAdmin, ClubDashboardData, ClubDashboardUpcomingRegistration, RaceResult, EventCalendarEntry, EventParticipant } from '@/lib/types';
import { serializeValue, normalizeStatus, serializeParticipantData, isTriathlonEvent, normalizeToE164 } from '@/lib/utils';
import { revalidatePath } from 'next/cache';
import { format, parseISO, isBefore, startOfDay, isEqual } from 'date-fns';
import {
  ClubSocialLinksUpdateSchema,
  type ClubSocialLinksUpdateActionInput,
  ClubUpdateSchema,
  type ClubUpdateFormInput,
} from '../schemas';
import { sendClubRegistrationConfirmationEmail, sendAthleteClubRemovalEmail, sendClubAffiliationNoticeToOwnerEmail, sendRawHtmlEmail, sendWelcomeEmail } from '../auth/brevoService';
import { _internal_fetchAllRaceDataFromFirestore } from './publicResultActions';
import { getKV, putKV, deleteKV } from '../cloudflare/kv';
import { runDataSyncAction, _mirrorParticipantToKV, _syncClubUpcomingAthletes } from './dataSyncActions';
import { invalidateByDocument, invalidateByCollection } from './cacheInvalidationActions';
import { NO_CLUB_SELECTED_VALUE } from '../constants';
import { getAllClubsWithStatsAction } from './clubStatsActions';

const MAX_MONTHLY_ENCOURAGEMENT_EMAILS = 2;

/**
 * CORE INTERNAL: Trigger KV mirror for a specific club
 */
export async function _syncClubToKV(clubId: string): Promise<void> {
    const actionName = '_syncClubToKV';
    try {
        const adminDb = getFirestoreInstance();
        const doc = await adminDb.collection('clubs').doc(clubId).get();
        if(doc.exists) {
            const clubRecord = serializeValue({ id: doc.id, ...doc.data() }) as Club;
            await putKV(`club:${clubId}`, clubRecord, actionName);

            // Keep global club indexes fresh so newly registered clubs appear immediately.
            const [fullListCached, simpleListCached] = await Promise.all([
                getKV<Club[]>('clubs:full', actionName),
                getKV<Array<{ id: string; name: string }>>('clubs:list', actionName),
            ]);

            // If clubs:full cache is empty/missing, rebuild from Firestore so we
            // don't overwrite the full list with just this 1 club.
            let fullList: Club[] = Array.isArray(fullListCached) && fullListCached.length > 0
                ? [...fullListCached]
                : [];
            if (fullList.length === 0) {
                try {
                    const allSnap = await adminDb.collection('clubs').get();
                    fullList = allSnap.docs.map(d => serializeValue({ id: d.id, ...d.data() }) as Club);
                    console.log(`[${actionName}] clubs:full was empty — rebuilt from Firestore (${fullList.length} clubs)`);
                } catch (e) {
                    console.warn(`[${actionName}] Failed to rebuild clubs:full from Firestore:`, e);
                }
            }
            const fullIdx = fullList.findIndex((club) => club.id === clubRecord.id);
            if (fullIdx > -1) fullList[fullIdx] = clubRecord;
            else fullList.push(clubRecord);
            fullList.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

            const simpleList: Array<{ id: string; name: string }> = Array.isArray(simpleListCached) && simpleListCached.length > 0
                ? [...simpleListCached]
                : fullList.map(c => ({ id: c.id, name: c.name }));
            const simpleEntry = { id: clubRecord.id, name: clubRecord.name };
            const simpleIdx = simpleList.findIndex((club) => club.id === clubRecord.id);
            if (simpleIdx > -1) simpleList[simpleIdx] = simpleEntry;
            else simpleList.push(simpleEntry);
            simpleList.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

            await Promise.all([
                putKV('clubs:full', fullList, actionName),
                putKV('clubs:list', simpleList, actionName),
            ]);

            // Invalidate club stats cache for all years so new/updated club appears
            // immediately in admin dashboard (no stale 5-minute TTL)
            const years = [2026, 2025, 2024, 2023, 2022, 2021];
            const deletePromises = years.map(year => 
                deleteKV(`clubs:stats:${year}:v4`, actionName).catch(e => {
                    console.warn(`[${actionName}] Failed to bust clubs:stats:${year}:v4:`, e);
                })
            );

            // Delete the training-page aggregate so the next request fully rebuilds
            // it from the freshly-written clubs:full. Simpler and more reliable than
            // in-place patching which could race with eventual consistency.
            deletePromises.push(
                deleteKV('training:clubs:ranked:v2', actionName).catch(e => {
                    console.warn(`[${actionName}] Failed to bust training:clubs:ranked:v2:`, e);
                })
            );

            await Promise.all(deletePromises);
        }
    } catch(e) { console.error(`[${actionName}] Failed:`, e); }
}

/**
 * CORE INTERNAL: Sync ALL clubs to KV for training page
 */
export async function _syncAllClubsToKV(): Promise<{ success: boolean; count: number; message: string }> {
    const actionName = '_syncAllClubsToKV';
    try {
        const adminDb = getFirestoreInstance();
        
        // Get all clubs from Firestore
        const snap = await adminDb.collection('clubs').get();
                const fullClubList = snap.docs
                    .map(doc => serializeValue({ id: doc.id, ...doc.data() }) as Club)
                    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
                await putKV('clubs:full', fullClubList, actionName);
                await putKV('clubs:list', fullClubList.map((club) => ({ id: club.id, name: club.name })), actionName);
        const firestoreClubIds = new Set(snap.docs.map(doc => doc.id));
        
        let syncCount = 0;
        let errorCount = 0;
        let deleteCount = 0;
        
        console.log(`[${actionName}] Starting sync of ${snap.docs.length} clubs to KV...`);
        
        // 1. Sync each club individually with related data
        for (const doc of snap.docs) {
            try {
                const clubId = doc.id;
                const clubData = doc.data();
                
                // Sync base club data
                await putKV(`club:${clubId}`, { id: clubId, ...clubData }, actionName);
                
                // Sync members index
                const membersSnap = await adminDb.collection('clubs').doc(clubId).collection('members').get();
                const memberUids = membersSnap.docs.map(m => m.id);
                if (memberUids.length > 0) {
                    await putKV(`club:${clubId}:members:index`, memberUids, actionName);
                }
                
                // Sync upcoming events registrations
                const upcomingSnap = await adminDb.collection('clubs').doc(clubId).collection('upcomingEvents').get();
                const upcomingEvents = upcomingSnap.docs.map(e => e.data());
                if (upcomingEvents.length > 0) {
                    await putKV(`club:${clubId}:upcoming`, upcomingEvents, actionName);
                }
                
                syncCount++;
                
                // Log progress
                if (syncCount % 10 === 0) {
                    console.log(`[${actionName}] Synced ${syncCount}/${snap.docs.length} clubs...`);
                }
            } catch (e) {
                errorCount++;
                console.error(`[${actionName}] Failed to sync club ${doc.id}:`, e);
            }
        }
        
        // 2. Clean up deleted clubs from KV
        try {
            const kvListResponse = await fetch(`${process.env.CLOUDFLARE_API_URL || 'https://api.cloudflare.com/client/v4'}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/keys?prefix=club:&limit=1000`, {
                headers: { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }
            });
            
            if (kvListResponse.ok) {
                const kvData = await kvListResponse.json();
                const kvKeys = kvData.result?.map((item: { name: string }) => item.name) || [];
                
                // Extract club IDs from KV keys (format: club:{clubId} or club:{clubId}:...)
                const kvClubIds = new Set<string>();
                for (const key of kvKeys) {
                    const match = key.match(/^club:([^:]+)/);
                    if (match) {
                        kvClubIds.add(match[1]);
                    }
                }
                
                // Delete clubs that exist in KV but not in Firestore
                for (const clubId of kvClubIds) {
                    if (!firestoreClubIds.has(clubId)) {
                        try {
                            await deleteKV(`club:${clubId}`, actionName);
                            await deleteKV(`club:${clubId}:members:index`, actionName);
                            await deleteKV(`club:${clubId}:upcoming`, actionName);
                            deleteCount++;
                            console.log(`[${actionName}] Deleted club ${clubId} from KV (no longer exists in Firestore)`);
                        } catch (e) {
                            console.error(`[${actionName}] Failed to delete club ${clubId} from KV:`, e);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn(`[${actionName}] Warning: Could not clean up deleted clubs:`, e);
        }

        // Bust the ranked training-page aggregate so it rebuilds from the
        // newly synced per-club + clubs:full data on next request.
        try {
            await deleteKV('training:clubs:ranked:v2', actionName);
        } catch (e) {
            console.warn(`[${actionName}] Failed to bust training:clubs:ranked:v2:`, e);
        }

        const message = `Synced ${syncCount} clubs to KV${deleteCount > 0 ? `, deleted ${deleteCount}` : ''}${errorCount > 0 ? ` (${errorCount} errors)` : ''}`;
        console.log(`[${actionName}] ${message}`);
        
        return { success: errorCount === 0, count: syncCount, message };
    } catch(e) { 
        console.error(`[${actionName}] Failed:`, e);
        return { success: false, count: 0, message: `Sync failed: ${e instanceof Error ? e.message : 'Unknown error'}` };
    }
}

/**
 * CORE LOGIC: COMPUTES CLUB RANKINGS.
 */
export async function _computeClubRankings({ year }: { year?: number } = {}) {
    const actionName = '_computeClubRankings';
    const displayYear = year || new Date().getFullYear();
    try {
        const { races } = await _internal_fetchAllRaceDataFromFirestore({ year: displayYear });
        const adminDb = getFirestoreInstance();
        const allClubsSnap = await adminDb.collection('clubs').get();
        const validClubsMap = new Map(allClubsSnap.docs.map(doc => [doc.id, doc.data()]));
        const normalizeText = (value: unknown) => String(value || '').trim().toLowerCase();
        const clubIdByName = new Map(allClubsSnap.docs.map(doc => [normalizeText(doc.data().name), doc.id]));

        const clubMap = new Map<string, { 
            points: number, 
            races: number, 
            podiums: number,
            winners: number,
            latestRaceDate: string,
            athleteMap: Map<string, { points: number, count: number, name: string }> 
        }>();

        (races || []).forEach(r => {
            if (!isTriathlonEvent(r.raceCategory || r.eventCategory)) return;

            const resolvedClubId = r.clubIdAtRace || clubIdByName.get(normalizeText(r.clubNameAtRace));

            if (normalizeStatus(r.status) === "Finished" && (r.pointsAwarded || 0) > 0 && resolvedClubId && resolvedClubId !== NO_CLUB_SELECTED_VALUE) {
                const clubId = resolvedClubId;
                if (!validClubsMap.has(clubId)) return;

                const cur = clubMap.get(clubId) || { 
                    points: 0, 
                    races: 0, 
                    podiums: 0, 
                    winners: 0, 
                    latestRaceDate: '', 
                    athleteMap: new Map() 
                };

                cur.points += r.pointsAwarded || 0;
                cur.races += 1;

                const cRank = parseInt(r.cRank || '0', 10);
                if (!isNaN(cRank) && cRank > 0) {
                    if (cRank <= 3) cur.podiums += 1;
                    if (cRank === 1) cur.winners += 1;
                }

                if (r.raceDate && (!cur.latestRaceDate || isBefore(parseISO(cur.latestRaceDate), parseISO(r.raceDate)))) {
                    cur.latestRaceDate = r.raceDate;
                }

                const athleteUid = r.athleteUid || r.emailLower; 
                const athData = cur.athleteMap.get(athleteUid) || { points: 0, count: 0, name: r.name || 'Athlete' };
                athData.points += r.pointsAwarded || 0;
                athData.count += 1;
                cur.athleteMap.set(athleteUid, athData);

                clubMap.set(clubId, cur);
            }
        });

        const entries: ClubRankingEntry[] = [];
        
        for (const doc of allClubsSnap.docs) {
            const clubId = doc.id;
            const clubData = doc.data();
            const stats = clubMap.get(clubId) || { points: 0, races: 0, podiums: 0, winners: 0, latestRaceDate: '', athleteMap: new Map() };
            
            const contributingAthletes: ClubAthleteContribution[] = Array.from(stats.athleteMap.entries()).map(([uid, data]) => ({
                athleteUid: uid,
                athleteName: data.name,
                pointsContributed: Math.round(data.points),
                racesFinished: data.count
            })).sort((a, b) => b.pointsContributed - a.pointsContributed);

            if (contributingAthletes.length > 0) {
                await putKV(`rankings:club:${clubId}:contributors:${displayYear}`, contributingAthletes, actionName);
            }

            entries.push({
                clubId: clubId, 
                clubName: clubData.name, 
                coachName: clubData.coach_name,
                totalPoints: Math.round(stats.points), 
                athleteCount: stats.athleteMap.size, 
                eventCount: stats.races,
                country: clubData.country || null, 
                city: clubData.city || null,
                state: clubData.state || null,
                logoUrl: clubData.logoUrl || null,
                email: clubData.email || null,
                instagramUrl: clubData.instagramUrl || null,
                facebookUrl: clubData.facebookUrl || null,
                contributingAthleteDetails: contributingAthletes
            });
        }

        const sortEntries = (a: any, b: any) => {
            if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
            return b.athleteCount - a.athleteCount;
        };

        const eligibleForRank = entries.filter(e => e.athleteCount >= 3).sort(sortEntries);
        const ineligible = entries.filter(e => e.athleteCount < 3).sort(sortEntries);
        
        const finalRankings = [
            ...eligibleForRank.map((e, i) => ({ ...e, overallRank: i + 1 })),
            ...ineligible.map(e => ({ ...e, overallRank: undefined })) 
        ];

        await putKV(`rankings:clubs:${displayYear}`, finalRankings, actionName);
        return { success: true, rankings: finalRankings };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getClubRankingData({ year }: { year?: number } = {}) {
    const displayYear = year || new Date().getFullYear();
    try {
        const rankings = await getKV<ClubRankingEntry[]>(`rankings:clubs:${displayYear}`, 'getClubRankingData');
        if (rankings && Array.isArray(rankings) && rankings.length > 0) {
            return { success: true, rankings, rankingYear: displayYear };
        }

        const computed = await _computeClubRankings({ year: displayYear });
        if (computed.success && computed.rankings) {
            return { success: true, rankings: computed.rankings, rankingYear: displayYear };
        }

        return { success: true, rankings: [], rankingYear: displayYear };
    } catch (e: any) {
        const computed = await _computeClubRankings({ year: displayYear });
        if (computed.success && computed.rankings) {
            return { success: true, rankings: computed.rankings, rankingYear: displayYear };
        }
        return { success: true, message: 'No data available.', rankings: [], rankingYear: displayYear };
    }
}

export async function getClubListAction(): Promise<{ success: boolean; clubs: { id: string; name: string }[] }> {
    const actionName = 'getClubListAction';
    try {
        const list = await getKV<{id: string, name: string}[]>('clubs:list', actionName);
        if (list) return { success: true, clubs: list };
        
        const adminDb = getFirestoreInstance();
        const snap = await adminDb.collection('clubs').orderBy('name', 'asc').get();
        const clubs = snap.docs.map(doc => ({ id: doc.id, name: doc.data().name }));
        return { success: true, clubs };
    } catch (e: any) { return { success: false, clubs: [] }; }
}

export async function getAllClubs(): Promise<{ success: boolean; message: string; clubs?: Club[] }> {
  try {
        const cached = await getKV<Club[]>('clubs:full', 'getAllClubs');
        if (cached && Array.isArray(cached)) {
            return { success: true, message: 'Clubs fetched from cache.', clubs: cached };
        }

    const adminDb = getFirestoreInstance();
    const snap = await adminDb.collection('clubs').orderBy('name', 'asc').get();
    const clubs = snap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }) as Club);
        await putKV('clubs:full', clubs, 'getAllClubs');
        await putKV('clubs:list', clubs.map((club) => ({ id: club.id, name: club.name })), 'getAllClubs');
    return { success: true, message: 'Clubs fetched.', clubs };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function deleteClubAction(clubId: string, ownerUid: string, message: string): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const membersSnap = await adminDb.collection('users').where('clubId', '==', clubId).get();
    const batch = adminDb.batch();
    
    membersSnap.forEach(doc => {
      batch.update(doc.ref, {
        clubId: null,
        clubName: null,
        clubAffiliationDate: null,
        updatedAt: FieldValue.serverTimestamp()
      });
    });
    
    batch.delete(adminDb.collection('clubs').doc(clubId));
    batch.update(adminDb.collection('users').doc(ownerUid), {
      ownedClubId: null,
      ownedClubName: null,
      updatedAt: FieldValue.serverTimestamp()
    });
    
    await batch.commit();
    await _syncAllClubsToKV();
    // Invalidate all related caches
    await invalidateByDocument('clubs', clubId, 'deleted');

    const ownerSnap = await adminDb.collection('users').doc(ownerUid).get();
    const ownerEmail = ownerSnap.data()?.email;
    if (ownerEmail) {
        const subject = "Club Deactivated: Bergman Hub";
        const content = `<p>Hello,</p><p>Your club has been deactivated by the administrator.</p><p><strong>Reason:</strong> ${message}</p><p>Regards,<br/>The Bergman Team</p>`;
        await sendRawHtmlEmail(ownerEmail, subject, content);
    }

    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Club deleted and members de-affiliated.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function fetchClubMemberPerformanceForAdmin(clubId: string, year: string, _filter: 'active' | 'past' | 'contributing'): Promise<{ success: boolean; message: string; membersWithPerformance?: any[]; clubPerformanceDetails?: any }> {
    try {
        console.log(`[SERVER] fetchClubMemberPerformanceForAdmin called with:`, { clubId, year, _filter });
        const adminDb = getFirestoreInstance();
        const yearInt = parseInt(year);
        
        // **SMART KV CACHING**: Check if contributing members are already cached
        let cachedContributingMembers: any[] | null = null;
        if (_filter === 'contributing') {
            cachedContributingMembers = await getKV<any[]>(`club:${clubId}:contributing:${year}`, 'fetchClubMemberPerformanceForAdmin');
            if (cachedContributingMembers) {
                console.log(`[SERVER] Contributing members loaded from KV cache for ${clubId} in ${year}`);
                // Still fetch club performance details from rankings
                const rankings = await getKV<any[]>(`rankings:clubs:${year}`, 'admin-view');
                const clubRank = rankings?.find(r => r.clubId === clubId);
                return {
                    success: true,
                    message: 'Fetched from cache.',
                    membersWithPerformance: cachedContributingMembers,
                    clubPerformanceDetails: clubRank || null
                };
            }
        }
        
        // Get all users
        const allUsersSnap = await adminDb.collection('users').get();
        const members: any[] = [];

        // Filter users based on clubHistory if available, otherwise use clubId for backward compatibility
        for (const doc of allUsersSnap.docs) {
            const userData = doc.data();
            let isMatch = false;

            if (userData.clubHistory && Array.isArray(userData.clubHistory)) {
                // New system: Use clubHistory
                const clubEntries = userData.clubHistory.filter((entry: any) => entry.clubId === clubId);
                
                if (_filter === 'active') {
                    // Include if has active membership
                    if (clubEntries.some((entry: any) => entry.isActive)) {
                        isMatch = true;
                    }
                } else if (_filter === 'past') {
                    // Include if has past membership
                    if (clubEntries.some((entry: any) => !entry.isActive)) {
                        isMatch = true;
                    }
                } else if (_filter === 'contributing') {
                    // Contributing: include if has active membership (will filter by points later)
                    if (clubEntries.some((entry: any) => entry.isActive)) {
                        isMatch = true;
                    }
                }
            } else if (_filter === 'active' || _filter === 'contributing') {
                // Backward compatibility: Old system, only for active/contributing filter
                if (userData.clubId === clubId) {
                    isMatch = true;
                }
            }

            if (isMatch) {
                members.push({ uid: doc.id, ...userData });
            }
        }

        const { races } = await _internal_fetchAllRaceDataFromFirestore({ year: yearInt });
        
        const adminAuth = getAuthInstance();
        const normalizeText = (value: unknown) => String(value || '').trim().toLowerCase();
        const toMillis = (value: unknown): number | null => {
            if (!value) return null;
            try {
                const parsed = typeof value === 'string' ? new Date(value) : new Date(value as any);
                return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
            } catch {
                return null;
            }
        };

        const membersWithPerformance = await Promise.all(members.map(async (m) => {
            // Serialize all fields including dates - safely handle invalid dates
            const serialized = serializeValue(m);
            
            // Extract name/email from various possible fields
            let name =
                serialized.name ||
                serialized.displayName ||
                serialized.fullName ||
                ([serialized.firstName, serialized.lastName].filter(Boolean).join(' ') || null) ||
                serialized.firstName ||
                serialized.participantName ||
                serialized.athleteName ||
                null;

            let email =
                serialized.email ||
                serialized.participantEmail ||
                serialized.userEmail ||
                null;

            const memberEmailLower = normalizeText(email);
            const currentClubName = normalizeText(m.clubName || serialized.clubName);
            const clubHistoryEntriesForClub = Array.isArray(m.clubHistory)
                ? m.clubHistory.filter((entry: any) => entry.clubId === clubId)
                : [];
            const membershipWindows: Array<{ joinedAt: number; leftAt: number | null; clubName: string }> = Array.isArray(m.clubHistory) && m.clubHistory.length > 0
                ? clubHistoryEntriesForClub
                    .map((entry: any) => ({
                        joinedAt: toMillis(entry.joinedAt) ?? 0,
                        leftAt: toMillis(entry.leftAt),
                        clubName: normalizeText(entry.clubName),
                    }))
                : [{
                    joinedAt: toMillis(m.clubAffiliationDate || serialized.clubAffiliationDate || m.createdAt) ?? 0,
                    leftAt: null,
                    clubName: currentClubName,
                }];

            // Filter races for THIS club with fallbacks for legacy race data that may not have clubIdAtRace
            const memberRaces = (races || []).filter((r: any) => {
                const sameAthlete =
                    (r.athleteUid && r.athleteUid === m.uid) ||
                    (!!memberEmailLower && normalizeText(r.athleteEmail || r.email) === memberEmailLower);

                if (!sameAthlete) return false;

                if (r.clubIdAtRace === clubId) return true;

                const raceClubName = normalizeText(r.clubNameAtRace);
                if (!r.clubIdAtRace && raceClubName && membershipWindows.some((w: { joinedAt: number; leftAt: number | null; clubName: string }) => w.clubName && w.clubName === raceClubName)) {
                    return true;
                }

                if (!r.clubIdAtRace && !raceClubName) {
                    const raceTime = toMillis(r.raceDate);
                    if (raceTime !== null) {
                        return membershipWindows.some((w: { joinedAt: number; leftAt: number | null; clubName: string }) => raceTime >= w.joinedAt && (w.leftAt === null || raceTime <= w.leftAt));
                    }
                }

                return false;
            });

            const finishedMemberRaces = memberRaces.filter((r: any) => normalizeStatus(r.status) === 'Finished');
            const points = finishedMemberRaces.reduce((sum, r) => sum + (r.pointsAwarded || 0), 0);

            // Fallback from race payloads (helpful when user profile is incomplete)
            if (!name && memberRaces.length > 0) {
                                const firstRaceWithName = memberRaces.find((r: any) => r.athleteName || r.participantName || r.name) as any;
                                const raceName = firstRaceWithName?.athleteName
                                    || firstRaceWithName?.participantName
                                    || firstRaceWithName?.name
                  || null;
                if (raceName) name = raceName;
            }

            if (!email && memberRaces.length > 0) {
                                const firstRaceWithEmail = memberRaces.find((r: any) => r.athleteEmail || r.participantEmail || r.email) as any;
                                const raceEmail = firstRaceWithEmail?.athleteEmail
                                    || firstRaceWithEmail?.participantEmail
                                    || firstRaceWithEmail?.email
                  || null;
                if (raceEmail) email = raceEmail;
            }

            // Final fallback from Firebase Auth record (for accounts with minimal Firestore profile)
            if ((!name || !email) && m.uid) {
                try {
                    const authUser = await adminAuth.getUser(m.uid);
                    if (!name && authUser.displayName) name = authUser.displayName;
                    if (!email && authUser.email) email = authUser.email;
                } catch {
                    // Ignore missing auth user and keep available fields
                }
            }
            
            let serializedAffiliationDate: string | null = null;
            let serializedLeftDate: string | null = null;

            // Prefer dates from clubHistory for accuracy (especially for past members)
            try {
                if (clubHistoryEntriesForClub.length > 0) {
                    const sortedEntries = [...clubHistoryEntriesForClub].sort((a: any, b: any) => {
                        const aJoined = toMillis(a?.joinedAt) ?? 0;
                        const bJoined = toMillis(b?.joinedAt) ?? 0;
                        return bJoined - aJoined;
                    });
                    const activeEntry = sortedEntries.find((entry: any) => entry?.isActive);
                    const inactiveEntries = sortedEntries.filter((entry: any) => !entry?.isActive);
                    const selectedHistoryEntry = _filter === 'past'
                        ? (inactiveEntries[0] || sortedEntries[0])
                        : (activeEntry || sortedEntries[0]);

                    if (selectedHistoryEntry?.joinedAt) {
                        const joined = new Date(selectedHistoryEntry.joinedAt);
                        if (!isNaN(joined.getTime())) {
                            serializedAffiliationDate = joined.toISOString();
                        }
                    }

                    if (_filter === 'past' && selectedHistoryEntry?.leftAt) {
                        const left = new Date(selectedHistoryEntry.leftAt);
                        if (!isNaN(left.getTime())) {
                            serializedLeftDate = left.toISOString();
                        }
                    }
                }
            } catch (e) {
                console.warn(`[SERVER] Error deriving clubHistory dates for user ${m.uid}:`, e);
            }
            
            try {
                const affiliationDate = serializedAffiliationDate || m.clubAffiliationDate || m.createdAt;
                if (!serializedAffiliationDate && affiliationDate) {
                    if (typeof affiliationDate === 'string') {
                        // Already a string, validate it's a valid date
                        const dateObj = new Date(affiliationDate);
                        serializedAffiliationDate = !isNaN(dateObj.getTime()) ? affiliationDate : null;
                    } else if (typeof affiliationDate === 'object') {
                        // Try to convert object to ISO string
                        if (affiliationDate.toISOString && typeof affiliationDate.toISOString === 'function') {
                            serializedAffiliationDate = affiliationDate.toISOString();
                        } else if (affiliationDate.toDate && typeof affiliationDate.toDate === 'function') {
                            // Firebase Timestamp
                            const dateObj = affiliationDate.toDate();
                            serializedAffiliationDate = dateObj.toISOString();
                        } else {
                            // Try converting to date
                            const dateObj = new Date(affiliationDate);
                            if (!isNaN(dateObj.getTime())) {
                                serializedAffiliationDate = dateObj.toISOString();
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn(`[SERVER] Error serializing affiliation date for user ${m.uid}:`, e);
                serializedAffiliationDate = null;
            }
            
            return {
                ...serialized,
                name: name || email || m.uid,  // Ensure name is included
                email,
                pointsEarnedForSelectedYear: points,
                racesFinishedInSelectedYear: finishedMemberRaces.length,
                clubRankForSelectedYear: 0,
                clubAffiliationDate: serializedAffiliationDate,
                clubLeftDate: serializedLeftDate
            };
        }));

        // Sort by points descending to assign ranks
        const sortedMembers = [...membersWithPerformance].sort((a, b) => 
            b.pointsEarnedForSelectedYear - a.pointsEarnedForSelectedYear
        );

        // Assign ranks only to members with points
        let rankedMembers = membersWithPerformance.map(m => ({
            ...m,
            clubRankForSelectedYear: m.pointsEarnedForSelectedYear > 0 
                ? sortedMembers.findIndex(sm => sm.uid === m.uid) + 1
                : undefined
        }));

        // **CONTRIBUTING FILTER**: Only show members with points > 0
        if (_filter === 'contributing') {
            // Filter to only members with points > 0
            rankedMembers = rankedMembers.filter(m => m.pointsEarnedForSelectedYear > 0);
            
            // Re-rank contributing members from 1 to N (not global club rank)
            const sortedContributing = [...rankedMembers].sort((a, b) => 
                b.pointsEarnedForSelectedYear - a.pointsEarnedForSelectedYear
            );
            rankedMembers = rankedMembers.map(m => ({
                ...m,
                clubRankForSelectedYear: sortedContributing.findIndex(sc => sc.uid === m.uid) + 1
            }));
            
            // **SMART KV CACHE**: Store contributing members for future lookups (5-minute TTL)
            await putKV(`club:${clubId}:contributing:${year}`, rankedMembers, 'fetchClubMemberPerformanceForAdmin');
            console.log(`[SERVER] Cached ${rankedMembers.length} contributing members for ${clubId} in year ${year}`);
        }

        const rankings = await getKV<any[]>(`rankings:clubs:${year}`, 'admin-view');
        const clubRank = rankings?.find(r => r.clubId === clubId);
        let resolvedOverallRank = clubRank?.overallRank;

        if (!resolvedOverallRank) {
            const clubStatsResult = await getAllClubsWithStatsAction(yearInt);
            const matchedClub = clubStatsResult.clubs?.find((club: any) => club.id === clubId);
            resolvedOverallRank = matchedClub?.rank;
        }

        const fallbackClubPerformanceDetails = {
            totalPoints: rankedMembers.reduce((sum, member) => sum + (member.pointsEarnedForSelectedYear || 0), 0),
            athleteCount: rankedMembers.filter(member => (member.pointsEarnedForSelectedYear || 0) > 0).length,
            eventCount: rankedMembers.reduce((sum, member) => sum + (member.racesFinishedInSelectedYear || 0), 0),
            overallRank: resolvedOverallRank,
        };

        const response = { 
            success: true, 
            message: 'Fetched.', 
            membersWithPerformance: rankedMembers,
            clubPerformanceDetails: clubRank || fallbackClubPerformanceDetails
        };
        console.log(`[SERVER] fetchClubMemberPerformanceForAdmin returning:`, { filter: _filter, membersCount: rankedMembers.length, clubPerformanceDetails: !!clubRank });
        return response;
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function registerClubWithOwner(data: any): Promise<{ success: boolean; message: string }> {
    try {
        const adminAuth = getAuthInstance();
        const adminDb = getFirestoreInstance();
        
        const ownerMobile = normalizeToE164(data.ownerMobile);
        if (!ownerMobile) throw new Error("Owner mobile is required and must be valid.");

        const ownerRecord = await adminAuth.createUser({
            email: data.ownerLoginEmail,
            password: data.ownerPassword,
            displayName: data.ownerName,
            phoneNumber: ownerMobile
        }).catch((e: any) => {
            if (e.code === 'auth/email-already-exists' || e.code === 'auth/uid-already-exists') {
                throw new Error("account with This Email Already exist in the Bergman Athlete Hub please Sign in using email and password / Email Otp");
            }
            throw e;
        });

        const clubRef = adminDb.collection('clubs').doc();
        const clubData = {
            name: data.clubName,
            coach_name: data.ownerName,
            email: data.clubContactEmail,
            mobile: data.clubContactMobile,
            ownerUid: ownerRecord.uid,
            ownerEmail: data.ownerLoginEmail.toLowerCase(),
            instagramUrl: data.instagramUrl || null,
            facebookUrl: data.facebookUrl || null,
            country: data.country || 'India',
            city: data.city || null,
            state: data.state || null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };
        await clubRef.set(clubData);

        await adminDb.collection('users').doc(ownerRecord.uid).set({
            uid: ownerRecord.uid,
            email: data.ownerLoginEmail,
            name: data.ownerName,
            mobile: ownerMobile,
            ownedClubId: clubRef.id,
            ownedClubName: data.clubName,
            clubId: clubRef.id,
            clubName: data.clubName,
            clubAffiliationDate: format(new Date(), 'yyyy-MM-dd'),
            emailVerified: true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await _syncClubToKV(clubRef.id);  // Sync the newly created club
        // Invalidate club rankings cache
        await invalidateByDocument('clubs', clubRef.id, 'created');
        await sendClubRegistrationConfirmationEmail(data.ownerLoginEmail, data.clubContactEmail, data.ownerName, data.clubName);

        return { success: true, message: "Club and owner account created successfully." };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function getRecentClubsAction(count: number): Promise<{ success: boolean; message: string; recentClubs?: Club[] }> {
    try {
        const adminDb = getFirestoreInstance();
        const snap = await adminDb.collection('clubs').orderBy('createdAt', 'desc').limit(count).get();
        const clubs = snap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }) as Club);
        return { success: true, message: 'Recent clubs fetched.', recentClubs: clubs };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function registerClubForExistingUser(userId: string, userName: string | null, data: any): Promise<{ success: boolean; message: string; club?: Club }> {
    try {
        const adminDb = getFirestoreInstance();
        const clubRef = adminDb.collection('clubs').doc();
        const now = new Date();
        const nowIso = now.toISOString();
        
        const clubData = {
            name: data.clubName,
            coach_name: data.coachName || userName || 'Coach',
            email: data.clubContactEmail,
            mobile: data.clubContactMobile,
            ownerUid: userId,
            ownerEmail: data.clubContactEmail.toLowerCase(),
            country: data.country || 'India',
            city: data.city || null,
            state: data.state || null,
            instagramUrl: data.instagramUrl || null,
            facebookUrl: data.facebookUrl || null,
        };
        
        await clubRef.set({
            ...clubData,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        
        // Use set with merge true to handle both initial creation and updates
        await adminDb.collection('users').doc(userId).set({
            name: userName || data.coachName || 'Club Owner',
            nameLower: (userName || data.coachName || 'Club Owner').toLowerCase(),
            email: data.clubContactEmail.toLowerCase(),
            ownedClubId: clubRef.id,
            ownedClubName: data.clubName,
            clubId: clubRef.id,
            clubName: data.clubName,
            mobile: data.clubContactMobile,
            clubAffiliationDate: format(now, 'yyyy-MM-dd'),
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(), // Handled by merge
            emailVerified: true,
        }, { merge: true });

        await _syncClubToKV(clubRef.id);  // Sync the newly created club
        await sendClubRegistrationConfirmationEmail(data.clubContactEmail, data.clubContactEmail, userName || data.coachName || 'Owner', data.clubName);
        await sendWelcomeEmail(data.clubContactEmail, userName || data.coachName || 'Owner');
        
        revalidatePath('/club-dashboard'); 
        revalidatePath('/dashboard');
        
        return { 
            success: true, 
            message: 'Club registered.', 
            club: serializeValue({ 
                id: clubRef.id, 
                ...clubData, 
                createdAt: nowIso, 
                updatedAt: nowIso 
            }) as Club 
        };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getClubContributorsAction(clubId: string, year: number): Promise<{ success: boolean; message: string; contributors?: ClubAthleteContribution[] }> {
    const actionName = 'getClubContributorsAction';
    try {
        const contributors = await getKV<ClubAthleteContribution[]>(`rankings:club:${clubId}:contributors:${year}`, actionName);
        return { success: true, message: 'Fetched from KV.', contributors: contributors || [] };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function getClubDashboardDataAction(clubId: string, year: number): Promise<{ success: boolean; message: string; dashboard?: ClubDashboardData }> {
    const actionName = 'getClubDashboardDataAction';
    try {
        const club = await getKV<Club>(`club:${clubId}`, actionName);
        if (!club) throw new Error('Club not found.');

        // Check if this is a deactivated club (ownership transferred)
        // This prevents old owners from accessing clubs they no longer own
        const adminDb = getFirestoreInstance();
        const ownerHistory = club.ownershipHistory || [];
        if (ownerHistory.length > 0) {
            const lastTransfer = ownerHistory[ownerHistory.length - 1];
            // The current owner is stored in club.ownerUid/ownerEmail
            if (lastTransfer.newOwnerUid !== club.ownerUid) {
                console.warn(`[${actionName}] Stale club data detected for ${clubId}, syncing from Firestore`);
                const freshClubSnap = await adminDb.collection('clubs').doc(clubId).get();
                if (freshClubSnap.exists) {
                    const freshClubData = serializeValue({ id: freshClubSnap.id, ...freshClubSnap.data() }) as Club;
                    if (freshClubData.ownerUid !== club.ownerUid) {
                        throw new Error('You no longer have access to this club. The ownership has been transferred to another administrator.');
                    }
                }
            }
        }

        const allRankingsResult = await getClubRankingData({ year });
        const clubRank = allRankingsResult.rankings?.find(r => r.clubId === clubId);
        
        const { races } = await _internal_fetchAllRaceDataFromFirestore({ year });
        const clubRaces = (races || []).filter(r => r.clubIdAtRace === clubId);

        const monthlyMap = new Map<string, number>();
        clubRaces.forEach(r => {
            if (!r.raceDate) return;
            const m = format(parseISO(r.raceDate), 'MMM');
            monthlyMap.set(m, (monthlyMap.get(m) || 0) + (r.pointsAwarded || 0));
        });
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        const membersSnap = await adminDb.collection('users').where('clubId', '==', clubId).get();
        const membersList = membersSnap.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => {
            const points = clubRaces.filter(r => r.athleteUid === doc.id).reduce((sum, r) => sum + (r.pointsAwarded || 0), 0);
            return {
                athleteUid: doc.id,
                athleteName: doc.data().name || 'Athlete',
                email: doc.data().email,
                photoURL: doc.data().photoURL || null,
                pointsContributed: Math.round(points),
                racesFinished: clubRaces.filter(r => r.athleteUid === doc.id).length
            };
        });

        const currentMonthKey = format(new Date(), 'yyyy-MM');
        const stats = club.encouragementEmailsSent || { month: currentMonthKey, count: 0 };
        const effectiveCount = stats.month === currentMonthKey ? stats.count : 0;

        const dashboard: ClubDashboardData = {
            club, totalPoints: clubRank?.totalPoints || 0, globalRank: clubRank?.overallRank,
            athleteCount: membersSnap.size, eventCount: clubRaces.length,
            podiums: { gold: 0, silver: 0, bronze: 0 }, upcomingRacesCount: 0,
            monthlyPerformance: months.map(m => ({ month: m, points: Math.round(monthlyMap.get(m) || 0) })),
            eventPerformance: [], topContributors: [], bestPerformer: null,
            upcomingRegistrations: [], members: membersList as any,
            emailStats: { sentThisMonth: effectiveCount, remaining: Math.max(0, MAX_MONTHLY_ENCOURAGEMENT_EMAILS - effectiveCount), totalLimit: MAX_MONTHLY_ENCOURAGEMENT_EMAILS }
        };

        return { success: true, message: 'Computed.', dashboard: serializeValue(dashboard) };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function _syncClubDataToKV(clubId: string, year: number): Promise<void> {
    await getClubDashboardDataAction(clubId, year);
}

export async function updateClubSocialLinks(args: ClubSocialLinksUpdateActionInput) {
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection('clubs').doc(args.clubId).update({ 
        instagramUrl: args.instagramUrl || null, 
        facebookUrl: args.facebookUrl || null, 
        country: args.country || null, 
        city: args.city || null, 
        state: args.state || null, 
        updatedAt: FieldValue.serverTimestamp() 
    });
    
    await _syncClubToKV(args.clubId);
    
    revalidatePath('/club-dashboard');
    revalidatePath('/training');
    return { success: true, message: "Updated" };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function updateClubDetailsAction(clubId: string, data: ClubUpdateFormInput) {
    try {
        const adminDb = getFirestoreInstance();
        await adminDb.collection('clubs').doc(clubId).update({ ...data, updatedAt: FieldValue.serverTimestamp() });
        
        await _syncClubToKV(clubId);
        
        revalidatePath('/admin/dashboard'); revalidatePath('/club-dashboard'); revalidatePath('/training');
        return { success: true, message: 'Updated' };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function updateClubLogoUrl(clubId: string, logoUrl: string) {
    try {
        const adminDb = getFirestoreInstance();
        await adminDb.collection('clubs').doc(clubId).update({ logoUrl, updatedAt: FieldValue.serverTimestamp() });
        
        await _syncClubToKV(clubId);
        
        revalidatePath('/club-dashboard');
        revalidatePath('/training');
        return { success: true, message: "Updated" };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function transferClubOwnershipAction(
  clubId: string,
  newOwnerEmail: string,
  currentAdminEmail: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  const actionName = 'transferClubOwnershipAction';
  try {
    const adminDb = getFirestoreInstance();
    const auth = getAuthInstance();

    // 1. Fetch the club
    const clubRef = adminDb.collection('clubs').doc(clubId);
    const clubSnap = await clubRef.get();
    if (!clubSnap.exists) {
      return { success: false, message: 'Club not found.' };
    }
    const clubData = clubSnap.data() as any;

    // 2. Find the new owner in Users collection
    const newOwnerNormalized = newOwnerEmail.trim().toLowerCase();
    const newOwnerSnap = await adminDb.collection('users').where('email', '==', newOwnerNormalized).limit(1).get();
    if (newOwnerSnap.empty) {
      return { success: false, message: `User with email ${newOwnerEmail} not found in the system.` };
    }
    const newOwnerDoc = newOwnerSnap.docs[0];
    const newOwnerUid = newOwnerDoc.id;
    const newOwnerData = newOwnerDoc.data() as any;

    // 3. Store previous owner info for history
    const previousOwnerUid = clubData.ownerUid;
    const previousOwnerEmail = clubData.ownerEmail || '';
    const previousOwnerName = clubData.coach_name || null;

    // 4. Create ownership history entry
    const historyEntry = {
      previousOwnerUid,
      previousOwnerEmail,
      previousOwnerName,
      newOwnerUid,
      newOwnerEmail: newOwnerNormalized,
      newOwnerName: newOwnerData.name || null,
      transferredAt: new Date().toISOString(),
      transferredBy: currentAdminEmail,
      reason: reason || null,
    };

    // 5. Preserve existing history and add new entry
    const existingHistory = Array.isArray(clubData.ownershipHistory) ? clubData.ownershipHistory : [];
    const updatedHistory = [...existingHistory, historyEntry];

    // 6. Update club with new owner and history
    await clubRef.update({
      ownerUid: newOwnerUid,
      ownerEmail: newOwnerNormalized,
      ownerMobile: newOwnerData.mobile || clubData.ownerMobile || null,
      ownershipHistory: updatedHistory,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 7. Sync updated club to KV
    await _syncClubToKV(clubId);

    // 8. Invalidate related caches
    await Promise.all([
      deleteKV('training:clubs:ranked:v2', actionName),
      deleteKV('clubs:full', actionName),
      deleteKV('clubs:list', actionName),
    ]).catch(e => console.warn(`[${actionName}] Cache invalidation warning:`, e));

    // 9. Disable old club admin account from accessing this club
    // Add the club ID to a deactivated clubs list for the old owner
    try {
      const oldOwnerRef = adminDb.collection('users').doc(previousOwnerUid);
      const oldOwnerSnap = await oldOwnerRef.get();
      if (oldOwnerSnap.exists) {
        const oldOwnerFullData = oldOwnerSnap.data() as any;
        const deactivatedClubs = Array.isArray(oldOwnerFullData.deactivatedOwnedClubs)
          ? oldOwnerFullData.deactivatedOwnedClubs
          : [];
        
        if (!deactivatedClubs.includes(clubId)) {
          deactivatedClubs.push(clubId);
          await oldOwnerRef.update({
            deactivatedOwnedClubs: deactivatedClubs,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (e) {
      console.warn(`[${actionName}] Failed to mark club as deactivated for old owner:`, e);
    }

    // 10. Send notification emails to both old and new owners
    try {
      const { sendRawHtmlEmail } = await import('../auth/brevoService');
      
      // Email to old owner
      const oldOwnerEmailContent = `
        <p>Dear ${previousOwnerName || 'Club Owner'},</p>
        <p>Your ownership of <strong>${clubData.name}</strong> has been transferred to <strong>${newOwnerData.name || newOwnerNormalized}</strong> (${newOwnerNormalized}).</p>
        <p>You will no longer be able to manage this club from your account. If you believe this was done in error, please contact the Bergman administration team immediately.</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p>Best regards,<br/>Bergman Team</p>
      `;
      
      await sendRawHtmlEmail(
        previousOwnerEmail,
        `Club Ownership Transfer: ${clubData.name}`,
        oldOwnerEmailContent
      ).catch(e => console.warn(`[${actionName}] Failed to email old owner:`, e));

      // Email to new owner
      const newOwnerEmailContent = `
        <p>Dear ${newOwnerData.name || 'Club Owner'},</p>
        <p>You have been assigned as the owner of <strong>${clubData.name}</strong>. You now have full administrative access to manage this club.</p>
        <p>Log in to your Bergman account to:</p>
        <ul>
          <li>Manage club members and team rosters</li>
          <li>View club statistics and rankings</li>
          <li>Send announcements and encouragement campaigns</li>
          <li>Update club contact information</li>
        </ul>
        <p>Best regards,<br/>Bergman Team</p>
      `;
      
      await sendRawHtmlEmail(
        newOwnerNormalized,
        `You are now the owner of ${clubData.name}`,
        newOwnerEmailContent
      ).catch(e => console.warn(`[${actionName}] Failed to email new owner:`, e));
    } catch (e) {
      console.warn(`[${actionName}] Email notification failed:`, e);
    }

    revalidatePath('/admin/dashboard');
    revalidatePath('/club-dashboard');

    return {
      success: true,
      message: `Club ownership transferred from ${previousOwnerEmail} to ${newOwnerNormalized}. Previous owner access has been revoked.`,
    };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: e.message || 'Failed to transfer club ownership.' };
  }
}

export async function syncClubDataForEventParticipantsAction(eventId: string): Promise<{ success: boolean; message: string }> {
    const actionName = 'syncClubDataForEventParticipantsAction';
    try {
        const adminDb = getFirestoreInstance();
        const participantsSnapshot = await adminDb.collection('events').doc(eventId).collection('participants').get();
        let batch = adminDb.batch();

        let resolvedUsers = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        let failedMirrors = 0;
        let batchOps = 0;
        const affectedParticipants: EventParticipant[] = [];
        const affectedClubIds = new Set<string>();

        for (const doc of participantsSnapshot.docs) {
            const p = doc.data() as any;

            let athleteUid = String(p?.athleteUid || p?.userId || '').trim();

            if (!athleteUid) {
                const rawEmail = String(p?.email || p?.buyerEmail || '').trim();
                const normalizedEmail = rawEmail.toLowerCase();
                if (normalizedEmail) {
                    // Primary lookup with normalized lowercase email.
                    let emailSnap = await adminDb.collection('users').where('email', '==', normalizedEmail).limit(1).get();
                    // Fallback lookup with raw email value in case legacy user docs stored mixed casing.
                    if (emailSnap.empty && rawEmail && rawEmail !== normalizedEmail) {
                        emailSnap = await adminDb.collection('users').where('email', '==', rawEmail).limit(1).get();
                    }
                    if (!emailSnap.empty) {
                        athleteUid = emailSnap.docs[0].id;
                    }
                }
            }

            if (!athleteUid) {
                skippedCount++;
                continue;
            }

            const userSnap = await adminDb.collection('users').doc(athleteUid).get();
            if (!userSnap.exists) {
                skippedCount++;
                continue;
            }

            resolvedUsers++;
            const userData = userSnap.data() as any;
            const rawClubId = userData?.clubId || userData?.ownedClubId || null;
            const clubId = (rawClubId === NO_CLUB_SELECTED_VALUE || !rawClubId) ? null : String(rawClubId);
            const clubName = clubId ? (userData?.clubName || userData?.ownedClubName || null) : null;
            const hasChanged =
                String(p?.clubId || '') !== String(clubId || '') ||
                String(p?.clubName || '') !== String(clubName || '') ||
                String(p?.athleteUid || p?.userId || '') !== String(athleteUid || '');

            if (hasChanged) {
                batch.update(doc.ref, {
                    athleteUid,
                    clubId,
                    clubName,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                updatedCount++;
                batchOps++;

                if (batchOps >= 500) {
                    await batch.commit();
                    batch = adminDb.batch();
                    batchOps = 0;
                }
            }

            const updatedParticipantData = {
                ...serializeParticipantData(doc),
                athleteUid,
                clubId,
                clubName,
            } as EventParticipant;

            affectedParticipants.push(updatedParticipantData);
            if (clubId) affectedClubIds.add(clubId);
        }

        if (batchOps > 0) {
            await batch.commit();
        }

        if (affectedParticipants.length > 0) {
            for (let i = 0; i < affectedParticipants.length; i += 10) {
                const batchItems = affectedParticipants.slice(i, i + 10);
                const mirrorResults = await Promise.allSettled(
                    batchItems.map((participant) => _mirrorParticipantToKV(participant, true))
                );
                failedMirrors += mirrorResults.filter((r) => r.status === 'rejected').length;
            }
        }

        if (affectedClubIds.size > 0) {
            for (const clubId of affectedClubIds) {
                await _syncClubUpcomingAthletes(clubId);
            }
        }

        revalidatePath('/admin/dashboard');
        return {
            success: true,
            message: `Processed ${participantsSnapshot.size} participants. Resolved users: ${resolvedUsers}, updated: ${updatedCount}, skipped: ${skippedCount}, clubs synced: ${affectedClubIds.size}, KV mirror failures: ${failedMirrors}.`,
        };
    } catch (e: any) {
        console.error(`[${actionName}] Failed:`, e);
        return { success: false, message: e?.message || 'Failed to sync club data.' };
    }
}

export async function getAthletesByClubId(clubId: string) {
    try {
        const adminDb = getFirestoreInstance();
        const snapshot = await adminDb.collection('users').where('clubId', '==', clubId).get();
        return { success: true, athletes: snapshot.docs.map(doc => serializeValue({ uid: doc.id, ...doc.data() })) };
    } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * FULL MIGRATION: Sync club data into participant docs for ALL events at once.
 * Iterates every event, resolves each participant's user profile, and writes
 * the correct clubId / clubName back into the participant document + KV.
 */
export async function syncAllEventsClubDataAction(): Promise<{
  success: boolean;
  message: string;
  eventsProcessed?: number;
  participantsProcessed?: number;
  participantsUpdated?: number;
  failedCount?: number;
}> {
  const actionName = 'syncAllEventsClubDataAction';
  try {
    const adminDb = getFirestoreInstance();
    const eventsSnap = await adminDb.collection('events').get();

    let eventsProcessed = 0;
    let participantsProcessed = 0;
    let participantsUpdated = 0;
    let failedCount = 0;
    const affectedClubIds = new Set<string>();

    for (const eventDoc of eventsSnap.docs) {
      try {
        const participantsSnap = await adminDb
          .collection('events')
          .doc(eventDoc.id)
          .collection('participants')
          .get();

        let batchUpdate = adminDb.batch();
        let batchCount = 0;
        const batchParticipants: EventParticipant[] = [];

        for (const pDoc of participantsSnap.docs) {
          try {
            const p = pDoc.data() as any;
            participantsProcessed++;

            // Resolve the athlete's UID
            let athleteUid = String(p?.athleteUid || p?.userId || '').trim();
            if (!athleteUid) {
              const email = String(p?.email || p?.buyerEmail || '').trim().toLowerCase();
              if (email) {
                const uSnap = await adminDb.collection('users').where('email', '==', email).limit(1).get();
                if (!uSnap.empty) athleteUid = uSnap.docs[0].id;
              }
            }
            if (!athleteUid) continue;

            const userSnap = await adminDb.collection('users').doc(athleteUid).get();
            if (!userSnap.exists) continue;

            const userData = userSnap.data() as any;
            const rawClubId = userData?.clubId || userData?.ownedClubId || null;
            const clubId = (rawClubId === NO_CLUB_SELECTED_VALUE || !rawClubId) ? null : String(rawClubId);
            const clubName = clubId ? (userData?.clubName || userData?.ownedClubName || null) : null;

            // Also check clubHistory for active entry if still null
            let finalClubId = clubId;
            let finalClubName = clubName;
            if (!finalClubId && userData?.clubHistory?.length) {
              const activeEntry = (userData.clubHistory as any[]).find((e: any) => e.isActive);
              if (activeEntry?.clubId) {
                finalClubId = activeEntry.clubId;
                finalClubName = activeEntry.clubName || null;
              }
            }

            const hasChanged =
              String(p?.clubId || '') !== String(finalClubId || '') ||
              String(p?.clubName || '') !== String(finalClubName || '') ||
              String(p?.athleteUid || '') !== athleteUid;

            if (hasChanged) {
              batchUpdate.update(pDoc.ref, {
                athleteUid,
                clubId: finalClubId,
                clubName: finalClubName,
                updatedAt: FieldValue.serverTimestamp(),
              });
              batchCount++;
              participantsUpdated++;
              if (finalClubId) affectedClubIds.add(finalClubId);
                            batchParticipants.push({
                                ...serializeParticipantData(pDoc),
                                athleteUid,
                                clubId: finalClubId,
                                clubName: finalClubName,
                            } as EventParticipant);
                        }

            // Commit in chunks of 500
            if (batchCount === 500) {
              await batchUpdate.commit();
                            batchUpdate = adminDb.batch();
              batchCount = 0;
            }
          } catch (e) {
            failedCount++;
            console.warn(`[${actionName}] Participant error ${pDoc.id}:`, e);
          }
        }

        if (batchCount > 0) await batchUpdate.commit();

                // Mirror only changed participants to KV.
                // Use skipIndexUpdate=true to avoid rewriting large event indexes on every participant.
                // Process in small batches with allSettled so one network EPIPE doesn't fail the whole sync.
                for (let i = 0; i < batchParticipants.length; i += 10) {
                    const slice = batchParticipants.slice(i, i + 10);
                    const mirrorResults = await Promise.allSettled(
                        slice.map((pt) => _mirrorParticipantToKV(pt, true))
                    );
                    const mirrorFailures = mirrorResults.filter((r) => r.status === 'rejected').length;
                    if (mirrorFailures > 0) {
                        failedCount += mirrorFailures;
                        console.warn(
                            `[${actionName}] KV mirror partial failure for event ${eventDoc.id}: ${mirrorFailures}/${slice.length} failed`
                        );
                    }
        }

        eventsProcessed++;
      } catch (e) {
        console.error(`[${actionName}] Event ${eventDoc.id} failed:`, e);
        failedCount++;
      }
    }

    // Rebuild upcoming lineup for all affected clubs
    for (const clubId of affectedClubIds) {
      await _syncClubUpcomingAthletes(clubId).catch(() => {});
    }

    revalidatePath('/admin/dashboard');
    return {
      success: true,
      message: `Processed ${eventsProcessed} events, ${participantsProcessed} participants, updated ${participantsUpdated} docs, failed ${failedCount}.`,
      eventsProcessed,
      participantsProcessed,
      participantsUpdated,
      failedCount,
    };
  } catch (e: any) {
    console.error(`[${actionName}] Fatal:`, e);
    return { success: false, message: e.message };
  }
}

export async function syncClubUpcomingIndexAction(clubId: string) {    const actionName = 'syncClubUpcomingIndexAction';
    try {
        const adminDb = getFirestoreInstance();
        const membersSnap = await adminDb.collection('users').where('clubId', '==', clubId).get();
        const memberUids = membersSnap.docs.map(d => d.id);
        await putKV(`club:${clubId}:members:index`, memberUids, actionName);
        // Also rebuild the upcoming athletes lineup from each member's event index
        await _syncClubUpcomingAthletes(clubId);
        return { success: true, message: `Synced ${memberUids.length} members and upcoming lineup.` };
    } catch(e: any) { return { success: false, message: e.message }; }
}

export async function removeAthleteFromClubAction(
  ownerUid: string,
  clubId: string,
  athleteUid: string,
  reason: string
): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const clubRef = adminDb.collection('clubs').doc(clubId);
    const clubSnap = await clubRef.get();
    if (!clubSnap.exists) throw new Error("Club not found.");
    const clubData = clubSnap.data() as Club;

    if (clubData.ownerUid !== ownerUid) {
        const userRef = adminDb.collection('users').doc(ownerUid);
        const userSnap = await userRef.get();
        if (!userSnap.data()?.isAdmin) {
            throw new Error("Unauthorized: You must be the club owner or an admin.");
        }
    }

    const athleteRef = adminDb.collection('users').doc(athleteUid);
    const athleteSnap = await athleteRef.get();
    if (!athleteSnap.exists) throw new Error("Athlete profile not found.");
    const athleteData = athleteSnap.data() as User;

    await athleteRef.update({
        clubId: null,
        clubName: null,
        clubAffiliationDate: null,
        updatedAt: FieldValue.serverTimestamp()
    });

    if (athleteData.email) {
        await sendAthleteClubRemovalEmail(
            athleteData.email,
            athleteData.name || 'Athlete',
            clubData.name,
            'Club Owner',
            new Date().toISOString(),
            reason
        );
    }

    return { success: true, message: "Athlete removed from roster." };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function sendEncouragementEmailAction(clubId: string): Promise<{ success: boolean; message: string }> {
    const actionName = 'sendEncouragementEmailAction';
    try {
        const adminDb = getFirestoreInstance();
        const clubRef = adminDb.collection('clubs').doc(clubId);
        const clubSnap = await clubRef.get();
        if (!clubSnap.exists) throw new Error("Club not found.");
        const clubData = clubSnap.data() as Club;

        const now = new Date();
        const currentMonthKey = format(now, 'yyyy-MM');
        const stats = clubData.encouragementEmailsSent || { month: currentMonthKey, count: 0 };
        const effectiveCount = stats.month === currentMonthKey ? stats.count : 0;
        
        if (effectiveCount >= MAX_MONTHLY_ENCOURAGEMENT_EMAILS) {
            return { success: false, message: `Limit reached. Max ${MAX_MONTHLY_ENCOURAGEMENT_EMAILS} campaigns per month.` };
        }

        const memberUids = await getKV<string[]>(`club:${clubId}:members:index`, actionName) || [];
        if (memberUids.length === 0) return { success: true, message: "No club members found." };

        const calendar = await getKV<EventCalendarEntry[]>('calendar:snapshot', actionName) || [];
        const today = startOfDay(new Date());
        const upcomingEvents = calendar.filter(e => e.eventDate && e.eventDate !== 'TBD' && !isBefore(parseISO(e.eventDate!), today)).sort((a, b) => parseISO(a.eventDate!).getTime() - parseISO(b.eventDate!).getTime());
        const nextEventName = upcomingEvents[0]?.eventName || "upcoming Bergman races";

        const targetAthletes: { name: string; email: string }[] = [];

        for (const uid of memberUids) {
            const userEvents = await getKV<any[]>(`user:${uid}:events:index`, actionName) || [];
            const userProfile = await getKV<User>(`users:${uid}`, actionName);
            if (!userProfile?.email || userProfile.clubId !== clubId) continue;

            const hasUpcoming = userEvents.some(e => {
                const eventDateStr = (e.eventDate && e.eventDate !== 'TBD') ? e.eventDate : null;
                const d = eventDateStr ? parseISO(eventDateStr) : null;
                return e.ticketStatus === "Active" && (!d || !isBefore(d, today));
            });

            if (!hasUpcoming) targetAthletes.push({ name: userProfile.name || 'Athlete', email: userProfile.email });
        }

        if (targetAthletes.length === 0) return { success: true, message: "All members already registered." };

        const subject = `Represent ${clubData.name} – Let’s Climb to the Top`;
        for (const athlete of targetAthletes) {
            await sendRawHtmlEmail(athlete.email, subject, `<p>Dear ${athlete.name}, your team needs you at ${nextEventName}!</p>`);
        }

        const newStats = { month: currentMonthKey, count: effectiveCount + 1 };
        await clubRef.update({ encouragementEmailsSent: newStats, updatedAt: FieldValue.serverTimestamp() });
        await _syncClubToKV(clubId);

        return { success: true, message: `Sent to ${targetAthletes.length} athletes.` };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getClubRegistrationsAction(clubId: string): Promise<{ success: boolean; message: string; registrations?: ClubDashboardUpcomingRegistration[] }> {
    const actionName = 'getClubRegistrationsAction';
    try {
        // Get upcoming athletes for this club from KV
        const upcomingAthletes = await getKV<any[]>(`club:${clubId}:upcoming`, actionName) || [];
        if (upcomingAthletes.length === 0) {
            return { success: true, message: 'No upcoming registrations found.', registrations: [] };
        }

        // Firestore refs for fallback lookups
        const adminDb = getFirestoreInstance();
        const eventCache: Record<string, string> = {};
        const ticketCache: Record<string, string> = {};

        const registrations: ClubDashboardUpcomingRegistration[] = [];
        const now = new Date();

        for (const athlete of upcomingAthletes) {
            try {
                const eventDate = athlete.eventDate ? new Date(athlete.eventDate) : null;
                if (eventDate && isBefore(eventDate, startOfDay(now))) {
                    continue;
                }

                // Try to fetch eventName if missing
                let eventName = athlete.eventName;
                if ((!eventName || eventName === 'Unknown Event') && athlete.eventId) {
                    if (eventCache[athlete.eventId]) {
                        eventName = eventCache[athlete.eventId];
                    } else {
                        const eventDoc = await adminDb.collection('events').doc(athlete.eventId).get();
                        eventName = eventDoc.exists ? (eventDoc.data()?.eventName || 'Unknown Event') : 'Unknown Event';
                        eventCache[athlete.eventId] = eventName;
                    }
                }

                // Try to fetch ticketName if missing
                let ticketName = athlete.ticketName;
                if ((!ticketName || ticketName === 'Unknown Ticket') && athlete.ticketId && athlete.eventId) {
                    const ticketKey = `${athlete.eventId}:${athlete.ticketId}`;
                    if (ticketCache[ticketKey]) {
                        ticketName = ticketCache[ticketKey];
                    } else {
                        const ticketDoc = await adminDb.collection('events').doc(athlete.eventId).collection('tickets').doc(athlete.ticketId).get();
                        ticketName = ticketDoc.exists ? (ticketDoc.data()?.ticketName || 'Unknown Ticket') : 'Unknown Ticket';
                        ticketCache[ticketKey] = ticketName;
                    }
                }

                // Try to fetch BIB if missing (common when participant doc id != bookingId)
                let athleteBibNumber = athlete.athleteBibNumber || athlete.bibNumber || null;
                if (!athleteBibNumber && athlete.eventId && athlete.bookingId) {
                    try {
                        const participantKv = await getKV<any>(`event:${athlete.eventId}:participant:${athlete.bookingId}`, actionName);
                        if (participantKv?.bibNumber) {
                            athleteBibNumber = String(participantKv.bibNumber);
                        }
                        if ((!ticketName || ticketName === 'Unknown Ticket') && participantKv?.ticketName) {
                            ticketName = String(participantKv.ticketName);
                        }
                    } catch {
                        // non-blocking
                    }

                    if (!athleteBibNumber) {
                        try {
                            const participantsRef = adminDb.collection('events').doc(athlete.eventId).collection('participants');
                            const directDoc = await participantsRef.doc(athlete.bookingId).get();
                            if (directDoc.exists) {
                                const participantData = directDoc.data() as any;
                                if (participantData?.bibNumber) {
                                    athleteBibNumber = String(participantData.bibNumber);
                                }
                                if ((!ticketName || ticketName === 'Unknown Ticket') && participantData?.ticketName) {
                                    ticketName = String(participantData.ticketName);
                                }
                            } else {
                                const byBookingId = await participantsRef.where('bookingId', '==', athlete.bookingId).limit(1).get();
                                if (!byBookingId.empty) {
                                    const participantData = byBookingId.docs[0].data() as any;
                                    if (participantData?.bibNumber) {
                                        athleteBibNumber = String(participantData.bibNumber);
                                    }
                                    if ((!ticketName || ticketName === 'Unknown Ticket') && participantData?.ticketName) {
                                        ticketName = String(participantData.ticketName);
                                    }
                                }
                            }
                        } catch {
                            // non-blocking
                        }
                    }
                }

                registrations.push({
                    athleteName: athlete.athleteName || 'Unknown Athlete',
                    eventName: eventName || 'Unknown Event',
                    eventDate: athlete.eventDate || 'TBD',
                    ticketName: ticketName || 'Unknown Ticket',
                    athleteBibNumber: athleteBibNumber || 'TBD',
                    bookingId: athlete.bookingId || '',
                    athleteUid: athlete.athleteUid || ''
                });
            } catch (e) {
                console.warn(`[${actionName}] Error processing athlete:`, e, athlete);
                continue;
            }
        }

        registrations.sort((a, b) => {
            if (!a.eventDate || !b.eventDate) return 0;
            const dateA = new Date(a.eventDate);
            const dateB = new Date(b.eventDate);
            return dateA.getTime() - dateB.getTime();
        });

        return { success: true, message: 'Registrations fetched.', registrations };
    } catch (e: any) {
        console.error(`[${actionName}] Error:`, e);
        return { success: false, message: `Error fetching registrations: ${e.message}`, registrations: [] };
    }
}
