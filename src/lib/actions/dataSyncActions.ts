
// src/lib/actions/dataSyncActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { _computeAthleteRankings, _computeLegacyAthletes } from './athleteRankingActions';
import { _computeClubRankings, _syncClubsToKV } from './clubActions';
import { _computeCalendarEvents, _syncCalendarToKV } from './eventActions';
import { _computeAllEventTicketStats } from './ticketActions';
import { _computeAdminAthleteAnalytics, _computeGlobalParticipantStats } from './analyticsActions';
import { _syncAnnouncementsToKV } from './announcementActions';
import { putKV, deleteKV, getKV } from '../cloudflare/kv';
import { revalidatePath } from 'next/cache';
import type { EventParticipant, RaceResult, EventCalendarEntry, User, Coupon, StoreProduct, Announcement } from '@/lib/types';
import { serializeValue, serializeParticipantData, normalizeStatus } from '@/lib/utils';
import { startJob, updateJobProgress } from '@/lib/jobManager';

/**
 * HELPER: Safe Time Parsing for Standings
 */
function timeToSeconds(t: any): number {
  if (typeof t === "number") return t;
  if (typeof t !== "string") return Infinity;
  const trimmed = t.trim();
  if (!trimmed || trimmed === "N/A" || trimmed === "-") return Infinity;
  
  const parts = trimmed.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1 && !isNaN(parts[0])) return parts[0];
  
  return Infinity;
}

/**
 * SYNC RESULTS TO KV
 */
export async function syncResultsToKVAction(eventId: string): Promise<{ success: boolean; message: string }> {
    const actionName = 'syncResultsToKVAction';
    try {
        const db = getFirestoreInstance();
        const snapshot = await db.collection('raceResults').where('eventId', '==', eventId).get();
        
        if (snapshot.empty) return { success: true, message: "No results found in Firestore for this event." };

        const results = snapshot.docs.map(doc => serializeValue({ ...doc.data(), docId: doc.id }) as unknown as RaceResult);
        
        // Store full event results
        await putKV(`results:${eventId}`, results, actionName);

        return { success: true, message: `Successfully mirrored ${results.length} results.` };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

/**
 * SYNC COUPONS TO KV
 */
export async function _syncCouponsToKV(): Promise<{ count: number }> {
    const actionName = '_syncCouponsToKV';
    const db = getFirestoreInstance();
    const snap = await db.collection('coupons').where('isActive', '==', true).get();
    
    const coupons = snap.docs.map(doc => serializeValue({ 
        ...doc.data(), 
        id: doc.id 
    })) as Coupon[];

    await putKV('coupons:active', coupons, actionName);
    return { count: coupons.length };
}

/**
 * SYNC STORE PRODUCTS TO KV
 */
export async function _syncStoreProductsToKV(): Promise<{ count: number }> {
    const actionName = '_syncStoreProductsToKV';
    const db = getFirestoreInstance();
    const snap = await db.collection('products').where('isActive', '==', true).get();
    
    const products = snap.docs.map(doc => serializeValue({ 
        ...doc.data(), 
        id: doc.id 
    })) as StoreProduct[];

    products.sort((a, b) => (a.order || 99) - (b.order || 99));
    await putKV('store:products', products, actionName);
    return { count: products.length };
}

/**
 * RECOMPUTE LEADERBOARD
 */
export async function recomputeLeaderboardAction(eventId: string, category: string): Promise<{ success: boolean; message: string }> {
    const actionName = 'recomputeLeaderboardAction';
    try {
        const results = await getKV<RaceResult[]>(`results:${eventId}`, actionName);
        if (!results) throw new Error("Source results not found in KV. Run 'Sync Results' first.");

        const catResults = results.filter(r => r.raceCategory === category && normalizeStatus(r.status) === 'Finished');
        
        const ranked = catResults.sort((a, b) => {
            return timeToSeconds(a.chipTime) - timeToSeconds(b.chipTime);
        }).map((r, i) => ({ ...r, overallRank: i + 1 }));

        await putKV(`rank:event:${eventId}:${category}:overall`, ranked, actionName);

        const males = ranked.filter(r => r.gender === 'Male').map((r, i) => ({ ...r, genderRank: i + 1 }));
        const females = ranked.filter(r => r.gender === 'Female').map((r, i) => ({ ...r, genderRank: i + 1 }));

        await putKV(`rank:event:${eventId}:${category}:gender:Male`, males, actionName);
        await putKV(`rank:event:${eventId}:${category}:gender:Female`, females, actionName);

        return { success: true, message: `Leaderboard recomputed for ${category}.` };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

/**
 * REBUILD ALL RANKINGS (Global Re-Mirror)
 */
export async function rebuildAllRankingsAction(): Promise<{ success: boolean; message: string }> {
    const actionName = 'rebuildAllRankingsAction';
    try {
        const adminDb = getFirestoreInstance();
        const eventsSnapshot = await adminDb.collection('events').get();
        
        for (const doc of eventsSnapshot.docs) {
            await syncResultsToKVAction(doc.id);
            const results = await getKV<RaceResult[]>(`results:${doc.id}`, actionName);
            if (results) {
                const categories = [...new Set(results.map(r => r.raceCategory))].filter(Boolean) as string[];
                for (const cat of categories) {
                    await recomputeLeaderboardAction(doc.id, cat);
                }
            }
        }
        
        // Also rebuild global meta
        await _syncCalendarToKV();
        await _syncCouponsToKV();
        await _syncStoreProductsToKV();
        await _syncAnnouncementsToKV();
        await _syncClubsToKV();

        return { success: true, message: "Full KV cache cleared and rebuilt successfully." };
    } catch (e: any) {
        console.error(`[${actionName}] Error:`, e);
        return { success: false, message: e.message || "An unexpected error occurred during rebuild." };
    }
}

/**
 * SYNC PARTICIPANTS TO KV
 */
export async function _syncParticipantsToKV(eventId: string): Promise<{ participantCount: number }> {
    const actionName = '_syncParticipantsToKV';
    const adminDb = getFirestoreInstance();
    const eventRef = adminDb.collection("events").doc(eventId);
    
    const snap = await eventRef.collection("participants").get();
    const participantsData = snap.docs.map(doc => serializeParticipantData(doc)).filter(p => !!p.bookingId);

    // 1. Mirror individual detail records
    for (let i = 0; i < participantsData.length; i += 50) {
        const batch = participantsData.slice(i, i + 50);
        await Promise.all(batch.map(p => _mirrorParticipantToKV(p, true)));
    }

    // 2. Mirror summary index
    const summary = participantsData.map(p => ({
        bookingId: p.bookingId,
        name: p.name,
        bibNumber: p.bibNumber,
        ticketName: p.ticketName,
        gender: p.gender,
        category: p.ageCategory
    }));

    const indexKey = `event:${eventId}:index`;
    await putKV(indexKey, summary, actionName);
    
    // 3. Stats Snapshot
    await putKV(`analytics:event:${eventId}:stats`, { totalRegistrations: participantsData.length }, actionName);
    
    return { participantCount: snap.size };
}

export async function _mirrorParticipantToKV(participantData: EventParticipant, skipIndexUpdate = false) {
  if (!participantData.eventId || !participantData.bookingId) return;
  const { eventId, bookingId, athleteUid } = participantData;
  const actionName = '_mirrorParticipantToKV';
  
  await putKV(`event:${eventId}:participant:${bookingId}`, participantData, actionName);

  if (!skipIndexUpdate) {
    const indexKey = `event:${eventId}:index`;
    const eventIndex = await getKV<any[]>(indexKey, actionName) || [];
    const summary = {
        bookingId: participantData.bookingId,
        name: participantData.name,
        bibNumber: participantData.bibNumber,
        ticketName: participantData.ticketName,
        gender: participantData.gender,
        category: participantData.ageCategory
    };
    const existingIdx = eventIndex.findIndex(p => p.bookingId === bookingId);
    if (existingIdx > -1) eventIndex[existingIdx] = summary;
    else eventIndex.push(summary);
    await putKV(indexKey, eventIndex, actionName);
  }

  if (athleteUid) {
    const userEventsKey = `user:${athleteUid}:events:index`;
    const userEvents = await getKV<any[]>(userEventsKey, actionName) || [];
    const summary = { 
        eventId, 
        bookingId, 
        ticketStatus: participantData.ticketStatus,
        eventName: participantData.eventName,
        eventDate: participantData.eventDate
    };
    const existingIdx = userEvents.findIndex(e => e.bookingId === bookingId);
    if (existingIdx > -1) userEvents[existingIdx] = summary;
    else userEvents.push(summary);
    await putKV(userEventsKey, userEvents, actionName);
  }
}

/**
 * CLEANUP KV ON DELETION
 */
export async function _deleteParticipantFromKV(eventId: string, bookingId: string, athleteUid?: string | null) {
  const actionName = '_deleteParticipantFromKV';
  
  // 1. Delete full detail
  await deleteKV(`event:${eventId}:participant:${bookingId}`, actionName);
  
  // 2. Remove from Event Index
  const indexKey = `event:${eventId}:index`;
  const eventIndex = await getKV<any[]>(indexKey, actionName) || [];
  const filteredEventIndex = eventIndex.filter(p => p.bookingId !== bookingId);
  if (filteredEventIndex.length !== eventIndex.length) {
      await putKV(indexKey, filteredEventIndex, actionName);
  }

  // 3. Remove from User Index
  if (athleteUid) {
    const userEventsKey = `user:${athleteUid}:events:index`;
    const userEvents = await getKV<any[]>(userEventsKey, actionName) || [];
    const filteredUserEvents = userEvents.filter(e => e.bookingId !== bookingId);
    if (filteredUserEvents.length !== userEvents.length) {
        await putKV(userEventsKey, filteredUserEvents, actionName);
    }
  }
}

/**
 * SYNC ALL USERS TO KV
 */
export async function _syncAllUsersToKV(): Promise<{ count: number }> {
    const actionName = '_syncAllUsersToKV';
    const db = getFirestoreInstance();
    const snap = await db.collection('users').get();
    
    const uids: string[] = [];
    const batchSize = 100;
    
    for (let i = 0; i < snap.docs.length; i += batchSize) {
        const batch = snap.docs.slice(i, i + batchSize);
        await Promise.all(batch.map(async (doc) => {
            const user = serializeValue({ ...doc.data(), uid: doc.id });
            await putKV(`users:${doc.id}`, user, actionName);
            uids.push(doc.id);
        }));
    }

    await putKV('users:index', uids, actionName);
    return { count: snap.size };
}

/**
 * SYNC SINGLE USER TO KV
 */
export async function _syncUserToKV(uid: string): Promise<void> {
    const actionName = '_syncUserToKV';
    try {
        const adminDb = getFirestoreInstance();
        const userDoc = await adminDb.collection('users').doc(uid).get();
        if (userDoc.exists) {
            const user = serializeValue({ ...userDoc.data(), uid: userDoc.id });
            await putKV(`users:${uid}`, user, actionName);
            
            // Update index if missing
            const index = await getKV<string[]>('users:index', actionName) || [];
            if (!index.includes(uid)) {
                index.push(uid);
                await putKV('users:index', index, actionName);
            }
        }
    } catch (e: any) {
        console.error(`[${actionName}] Failed to sync user ${uid} to KV:`, e.message);
    }
}

export async function _deleteEventFromKV(eventId: string) {
    const actionName = '_deleteEventFromKV';
    await deleteKV(`results:${eventId}`, actionName);
    await deleteKV(`event:${eventId}:index`, actionName);
    await deleteKV(`analytics:event:${eventId}:stats`, actionName);
}

/**
 * BACKGROUND SYNC DISPATCHER
 */
export async function runDataSyncAction(
  syncType: string,
  eventId?: string,
  year?: number
): Promise<{ success: boolean; message: string; jobId?: string }> {
  const { jobId } = await startJob();
  const currentYear = year || new Date().getFullYear();

  (async () => {
    try {
      if (syncType === "results" && eventId) {
        await updateJobProgress(jobId, { stage: "Mirroring Results to KV...", progress: 10 });
        await syncResultsToKVAction(eventId);
        await updateJobProgress(jobId, { status: 'completed', stage: "Results Mirrored", progress: 100 });
      }

      if (syncType === "users") {
        await updateJobProgress(jobId, { stage: "Indexing Global Athlete Directory...", progress: 10 });
        const res = await _syncAllUsersToKV();
        await updateJobProgress(jobId, { status: 'completed', stage: `Users Indexed (${res.count})`, progress: 100 });
      }

      if (syncType === "coupons") {
        await updateJobProgress(jobId, { stage: "Mirroring Active Coupons...", progress: 30 });
        const res = await _syncCouponsToKV();
        await updateJobProgress(jobId, { status: 'completed', stage: `Coupons Ready (${res.count})`, progress: 100 });
      }

      if (syncType === "participants" && eventId) {
        await updateJobProgress(jobId, { stage: "Indexing Participant Roster...", progress: 30 });
        await _syncParticipantsToKV(eventId);
        await updateJobProgress(jobId, { status: 'completed', stage: "Participants Mirrored", progress: 100 });
      }

      if (syncType === "leaderboard" && eventId) {
        await updateJobProgress(jobId, { stage: "Identifying Race Categories...", progress: 10 });
        const results = await getKV<RaceResult[]>(`results:${eventId}`, "sync-job");
        if (!results) throw new Error("Sync results first.");
        
        const categories = [...new Set(results.map(r => r.raceCategory))].filter(Boolean) as string[];
        
        for (let i = 0; i < categories.length; i++) {
            await recomputeLeaderboardAction(eventId, categories[i]);
            await updateJobProgress(jobId, { 
                stage: `Computed: ${categories[i]}`, 
                progress: 10 + Math.round(((i + 1) / categories.length) * 80) 
            });
        }
        await updateJobProgress(jobId, { status: 'completed', stage: "Leaderboards Ready", progress: 100 });
      }

      if (syncType === "athleteRankings") {
        await updateJobProgress(jobId, { stage: `Computing Athlete Rankings for ${currentYear}...`, progress: 20 });
        const res = await _computeAthleteRankings({ year: currentYear });
        if (res.success && res.rankings) {
            await putKV(`rankings:athletes:${currentYear}`, res.rankings, "sync-job");
        }
        await updateJobProgress(jobId, { status: 'completed', stage: "Athletes Ranked", progress: 100 });
      }

      if (syncType === "clubRankings") {
        await updateJobProgress(jobId, { stage: `Computing Club Rankings for ${currentYear}...`, progress: 20 });
        const res = await _computeClubRankings({ year: currentYear });
        if (res.success && res.rankings) {
            await putKV(`rankings:clubs:${currentYear}`, res.rankings, "sync-job");
        }
        await updateJobProgress(jobId, { status: 'completed', stage: "Clubs Ranked", progress: 100 });
      }

      if (syncType === "analytics") {
        await updateJobProgress(jobId, { stage: "Computing Snapshot Metrics...", progress: 30 });
        const [ticketStats, athleteStats] = await Promise.all([
            _computeAllEventTicketStats(),
            _computeAdminAthleteAnalytics()
        ]);
        if (ticketStats.success) await putKV('analytics:ticket_stats', ticketStats.eventTicketStats, "sync-job");
        if (athleteStats.success) await putKV('analytics:admin_athlete_snapshot', { analytics: athleteStats.analytics, recentSignups: athleteStats.recentSignups }, "sync-job");
        await putKV('analytics:global_participant_snapshot', (await _computeGlobalParticipantStats()).stats, "sync-job");
        await updateJobProgress(jobId, { status: 'completed', stage: "Analytics Ready", progress: 100 });
      }

      if (syncType === "legacy") {
        await updateJobProgress(jobId, { stage: "Evaluating Eligibility Rules...", progress: 40 });
        await _computeLegacyAthletes();
        await updateJobProgress(jobId, { status: 'completed', stage: "Legacy Verified", progress: 100 });
      }

      if (syncType === "calendar") {
        await updateJobProgress(jobId, { stage: "Syncing Calendar Events...", progress: 50 });
        const res = await _computeCalendarEvents();
        if (res.success && res.events) {
            await putKV('calendar:snapshot', res.events, "sync-job");
            const eventsWithResults = res.events.filter(e => !!e.eventDate);
            await putKV('events:with-results', eventsWithResults, "sync-job");
        }
        // Sync static support data
        await _syncClubsToKV();
        await _syncStoreProductsToKV();
        await _syncAnnouncementsToKV();
        
        await updateJobProgress(jobId, { status: 'completed', stage: "Site Metadata Ready", progress: 100 });
      }

      if (syncType === "all") {
          await updateJobProgress(jobId, { stage: "Full Catalog Mirroring...", progress: 10 });
          await _syncCouponsToKV();
          await _syncStoreProductsToKV();
          await _syncAnnouncementsToKV();
          await _syncClubsToKV();
          await updateJobProgress(jobId, { status: 'completed', stage: "Full Mirror Complete", progress: 100 });
      }

    } catch (err: any) {
      await updateJobProgress(jobId, { status: 'failed', stage: "Job Terminated", message: err.message });
    }
  })();

  return { success: true, message: "Synchronization task dispatched.", jobId };
}
