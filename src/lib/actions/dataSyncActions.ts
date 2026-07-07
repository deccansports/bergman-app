
// src/lib/actions/dataSyncActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { isBefore, parseISO, startOfDay } from 'date-fns';
import { _computeAthleteRankings, _computeLegacyAthletes } from './athleteRankingActions';
import { _computeClubRankings, _syncAllClubsToKV } from './clubActions';
import { _computeCalendarEvents, _syncCalendarToKV } from './eventActions';
import { syncBelSeasonFromResultsKVAction } from './eliteLeagueActions';
import { _computeAllEventTicketStats } from './ticketActions';
import { _computeAdminAthleteAnalytics, _computeGlobalParticipantStats, computeCountryRegistrationMetricsAction, computeEventRegistrationMetricsAction } from './analyticsActions';
import { _syncAnnouncementsToKV } from './announcementActions';
import { putKV, deleteKV, getKV } from '../cloudflare/kv';
import { invalidateByCollection, invalidateByDocument } from './cacheInvalidationActions';
import { revalidatePath } from 'next/cache';
import type { EventParticipant, RaceResult, EventCalendarEntry, User, Coupon, StoreProduct, Announcement } from '@/lib/types';
import { serializeValue, serializeParticipantData, normalizeStatus } from '@/lib/utils';
import { startJob, updateJobProgress } from '@/lib/jobManager';
import { normalizeLiveTrackingPrivacy } from '@/lib/liveTrackingPrivacy';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * SYNC RESULTS TO KV
 */
export async function syncResultsToKVAction(eventId: string): Promise<{ success: boolean; message: string }> {
    const actionName = 'syncResultsToKVAction';
    try {
        const db = getFirestoreInstance();
        const eventSnap = await db.collection('events').doc(eventId).get();
        const snapshot = await db.collection('raceResults').where('eventId', '==', eventId).get();
        
        if (snapshot.empty) return { success: true, message: "No results found in Firestore for this event." };

        const results = snapshot.docs.map(doc => serializeValue({ ...doc.data(), docId: doc.id }) as unknown as RaceResult);
        
        // Store full event results
        await putKV(`results:${eventId}`, results, actionName);
        await putKV(`event:${eventId}:results`, results, actionName);
        await putKV(`live:event:${eventId}:results`, results, actionName);

        if (eventSnap.exists) {
          const eventData = serializeValue({ id: eventId, ...eventSnap.data() });
          const eventsWithResults = await getKV<any[]>(`events:with-results`, actionName) || [];
          const nextEvent = {
            id: eventId,
            eventName: eventData?.eventName || eventData?.name || 'Untitled Event',
            eventDate: eventData?.eventDate || eventData?.raceDate || null,
            customSlug: eventData?.customSlug || null,
          };
          const deduped = new Map<string, any>();
          eventsWithResults.forEach((event: any) => {
            const id = String(event?.id || '').trim();
            if (!id) return;
            deduped.set(id, event);
          });
          deduped.set(eventId, nextEvent);
          await putKV('events:with-results', Array.from(deduped.values()), actionName);
        }

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
        await _syncAllClubsToKV();
        
        // Clean up deleted clubs and orphaned entries from KV
        await _cleanupDeletedClubsFromKV();

        return { success: true, message: "Full KV cache cleared, rebuilt, and cleaned up successfully." };
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
    const participantsData = snap.docs.map(doc => {
      const participant = serializeParticipantData(doc) as any;
      const contestUuid = String(participant?.contestUuid || participant?.contest_uuid || participant?.liveTracking?.contestUuid || '').trim() || null;
      const contestName = String(participant?.contestName || participant?.contest_name || participant?.liveTracking?.contestName || '').trim() || null;
      const providerParticipantUuid = String(participant?.providerParticipantUuid || participant?.participantUuid || participant?.providerUuid || participant?.liveTracking?.participantUuid || '').trim() || null;
      const providerContestUuid = String(participant?.providerContestUuid || participant?.providerContestUuid || contestUuid || '').trim() || null;
      const privacy = normalizeLiveTrackingPrivacy(
        participant?.liveTrackingPrivacy
        || participant?.trackingVisibility
        || participant?.privacy
        || participant?.registration?.liveTrackingPrivacy
        || participant?.registration?.trackingVisibility
        || participant?.userProfile?.liveTrackingPrivacy
        || participant?.userProfile?.trackingVisibility
        || 'PUBLIC'
      );
      return {
        ...participant,
        contestUuid,
        contestName,
        contestId: contestUuid,
        providerParticipantUuid,
        providerContestUuid,
        liveTrackingPrivacy: privacy,
        trackingVisibility: privacy,
        privacy,
        registration: {
          ...(participant?.registration || {}),
          liveTrackingPrivacy: privacy,
          trackingVisibility: privacy,
        },
      };
    }).filter(p => !!p.bookingId);

    await putKV(`event:${eventId}:participants:index`, participantsData, actionName);

    // 1. Mirror individual detail records
    for (let i = 0; i < participantsData.length; i += 50) {
        const batch = participantsData.slice(i, i + 50);
        await Promise.all(batch.map(p => _mirrorParticipantToKV(p, true)));
    }

    // 2. Mirror event index (full participant payload for robust downstream matching/recovery)
    const summary = participantsData.map((p) => ({
      ...p,
      eventId: p.eventId || eventId,
      bookingId: p.bookingId || p.id,
      athleteUid: p.athleteUid || (p as any).userId || null,
      email: p.email || null,
      privacy: p.privacy || p.liveTrackingPrivacy || 'PUBLIC',
      trackingVisibility: p.trackingVisibility || p.liveTrackingPrivacy || 'PUBLIC',
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
  const normalize = (value: any) => String(value || '').trim().toLowerCase();
  const normalizeDigits = (value: any) => String(value || '').replace(/\D/g, '');
  const resolvedUserUid = String(athleteUid || (participantData as any).userId || '').trim() || null;
  const normalizedParticipantData = {
    ...participantData,
    athleteUid: participantData.athleteUid || (participantData as any).userId || null,
    contestUuid: (participantData as any).contestUuid || (participantData as any).contest_uuid || (participantData as any).liveTracking?.contestUuid || null,
    contestName: (participantData as any).contestName || (participantData as any).contest_name || (participantData as any).liveTracking?.contestName || null,
    contestId: (participantData as any).contestId || (participantData as any).contestUuid || (participantData as any).contest_uuid || null,
    providerParticipantUuid: (participantData as any).providerParticipantUuid || (participantData as any).participantUuid || (participantData as any).providerUuid || (participantData as any).liveTracking?.participantUuid || null,
    providerContestUuid: (participantData as any).providerContestUuid || (participantData as any).contestUuid || (participantData as any).contest_uuid || null,
    liveTrackingPrivacy: normalizeLiveTrackingPrivacy((participantData as any).liveTrackingPrivacy || (participantData as any).privacy || (participantData as any).registration?.liveTrackingPrivacy || 'PUBLIC'),
    trackingVisibility: normalizeLiveTrackingPrivacy((participantData as any).trackingVisibility || (participantData as any).liveTrackingPrivacy || (participantData as any).privacy || (participantData as any).registration?.trackingVisibility || 'PUBLIC'),
  } as EventParticipant;
  
  await putKV(`event:${eventId}:participant:${bookingId}`, normalizedParticipantData, actionName);

  if (!skipIndexUpdate) {
    const fullIndexKey = `event:${eventId}:participants:index`;
    const fullIndex = await getKV<EventParticipant[]>(fullIndexKey, actionName) || [];
    const fullIndexExistingIdx = fullIndex.findIndex((p) => p.bookingId === bookingId);
    if (fullIndexExistingIdx > -1) fullIndex[fullIndexExistingIdx] = normalizedParticipantData;
    else fullIndex.push(normalizedParticipantData);
    await putKV(fullIndexKey, fullIndex, actionName);

    const indexKey = `event:${eventId}:index`;
    const eventIndex = await getKV<any[]>(indexKey, actionName) || [];
    const summary = {
      ...normalizedParticipantData,
      eventId,
      bookingId: participantData.bookingId || participantData.id,
      athleteUid: normalizedParticipantData.athleteUid || null,
      email: participantData.email || null,
      privacy: normalizedParticipantData.liveTrackingPrivacy || 'PUBLIC',
      trackingVisibility: normalizedParticipantData.trackingVisibility || normalizedParticipantData.liveTrackingPrivacy || 'PUBLIC',
    };
    const existingIdx = eventIndex.findIndex(p => p.bookingId === bookingId);
    if (existingIdx > -1) eventIndex[existingIdx] = summary;
    else eventIndex.push(summary);
    await putKV(indexKey, eventIndex, actionName);
  }

  if (resolvedUserUid) {
    const userEventsKey = `user:${resolvedUserUid}:events:index`;
    const userEvents = await getKV<any[]>(userEventsKey, actionName) || [];
    const summary = { 
        eventId, 
        bookingId, 
        ticketStatus: participantData.ticketStatus,
        eventName: participantData.eventName,
        eventDate: participantData.eventDate,
        ticketName: participantData.ticketName,
      ticketId: participantData.ticketId || null,
      bibNumber: participantData.bibNumber || null
    };
    const existingIdx = userEvents.findIndex(e => e.bookingId === bookingId);
    if (existingIdx > -1) userEvents[existingIdx] = summary;
    else userEvents.push(summary);
    await putKV(userEventsKey, userEvents, actionName);
  }

  // Sync athlete registration indexes for fast dashboard lookups.
  const registrationId = String((participantData as any)?.id || bookingId).trim();
  const registrationRef = { eventId, bookingId, registrationId };
  await putKV(`registration:${registrationId}`, normalizedParticipantData, actionName);

  const mergeRefs = async (key: string) => {
    const rows = await getKV<any[]>(key, actionName) || [];
    const map = new Map<string, any>();
    rows.forEach((r: any) => {
      const eId = String(r?.eventId || '').trim();
      const bId = String(r?.bookingId || '').trim();
      if (!eId || !bId) return;
      map.set(`${eId}:${bId}`, r);
    });
    map.set(`${eventId}:${bookingId}`, registrationRef);
    await putKV(key, Array.from(map.values()), actionName);
  };

  if (resolvedUserUid) {
    await mergeRefs(`athlete:uid:${resolvedUserUid}:registrations`);
  }

  const identityEmails = new Set<string>([
    normalize((participantData as any)?.email),
    normalize((participantData as any)?.buyerEmail),
  ].filter(Boolean));
  const identityMobiles = new Set<string>([
    normalizeDigits((participantData as any)?.mobile),
    normalizeDigits((participantData as any)?.buyerMobile),
    normalizeDigits((participantData as any)?.phone),
  ].filter(Boolean));

  await Promise.all([
    ...Array.from(identityEmails).map((email) => mergeRefs(`athlete:email:${email}:registrations`)),
    ...Array.from(identityMobiles).map((mobile) => mergeRefs(`athlete:mobile:${mobile}:registrations`)),
  ]);
}

/**
 * CLEANUP KV ON DELETION
 */
export async function _deleteParticipantFromKV(
  eventId: string,
  bookingId: string,
  athleteUid?: string | null,
  participantRefId?: string | null
) {
  const actionName = '_deleteParticipantFromKV';
  const normalizedRefId = String(participantRefId || '').trim();
  const normalizedBookingId = String(bookingId || '').trim();

  const isSameEntry = (row: any) => {
    const rowBookingId = String(row?.bookingId || '').trim();
    const rowId = String(row?.id || '').trim();
    return (
      (!!normalizedBookingId && rowBookingId === normalizedBookingId) ||
      (!!normalizedRefId && rowId === normalizedRefId)
    );
  };

  const fullIndexKey = `event:${eventId}:participants:index`;
  const fullIndex = await getKV<any[]>(fullIndexKey, actionName) || [];
  const fullIndexEntry = fullIndex.find((p) => isSameEntry(p));

  const indexKey = `event:${eventId}:index`;
  const eventIndex = await getKV<any[]>(indexKey, actionName) || [];
  const compactIndexEntry = eventIndex.find((p) => isSameEntry(p));

  const userUidCandidates = new Set<string>();
  const seedUid = String(athleteUid || '').trim();
  if (seedUid) userUidCandidates.add(seedUid);
  const fromFullAthleteUid = String(fullIndexEntry?.athleteUid || fullIndexEntry?.userId || '').trim();
  if (fromFullAthleteUid) userUidCandidates.add(fromFullAthleteUid);
  const fromCompactAthleteUid = String(compactIndexEntry?.athleteUid || compactIndexEntry?.userId || '').trim();
  if (fromCompactAthleteUid) userUidCandidates.add(fromCompactAthleteUid);

  const normalize = (value: any) => String(value || '').trim().toLowerCase();
  const normalizeDigits = (value: any) => String(value || '').replace(/\D/g, '');
  const emailCandidates = new Set<string>([
    normalize(fullIndexEntry?.email),
    normalize(fullIndexEntry?.buyerEmail),
    normalize(compactIndexEntry?.email),
    normalize(compactIndexEntry?.buyerEmail),
  ].filter(Boolean));
  const mobileCandidates = new Set<string>([
    normalizeDigits(fullIndexEntry?.mobile),
    normalizeDigits(fullIndexEntry?.buyerMobile),
    normalizeDigits(compactIndexEntry?.mobile),
    normalizeDigits(compactIndexEntry?.buyerMobile),
    normalizeDigits(compactIndexEntry?.phone),
  ].filter(Boolean));
  
  // 1. Delete full detail
  if (normalizedBookingId) {
    await deleteKV(`event:${eventId}:participant:${normalizedBookingId}`, actionName);
  }

  // Defensive cleanup: if detail key was accidentally written by participant document ID,
  // remove that variant too.
  if (normalizedRefId && normalizedRefId !== normalizedBookingId) {
    await deleteKV(`event:${eventId}:participant:${normalizedRefId}`, actionName);
  }

  const filteredFullIndex = fullIndex.filter((p) => !isSameEntry(p));
  if (filteredFullIndex.length !== fullIndex.length) {
      await putKV(fullIndexKey, filteredFullIndex, actionName);
  }
  
  // 2. Remove from Event Index
  const filteredEventIndex = eventIndex.filter((p) => !isSameEntry(p));
  if (filteredEventIndex.length !== eventIndex.length) {
      await putKV(indexKey, filteredEventIndex, actionName);
  }

  // 3. Remove from User Index (uid-based)
  for (const userUid of userUidCandidates) {
    const userEventsKey = `user:${userUid}:events:index`;
    const userEvents = await getKV<any[]>(userEventsKey, actionName) || [];
    const filteredUserEvents = userEvents.filter((e) => {
      const rowBookingId = String(e?.bookingId || '').trim();
      const rowId = String(e?.id || '').trim();
      return !(
        (!!normalizedBookingId && rowBookingId === normalizedBookingId) ||
        (!!normalizedRefId && rowId === normalizedRefId)
      );
    });
    if (filteredUserEvents.length !== userEvents.length) {
        await putKV(userEventsKey, filteredUserEvents, actionName);
    }
  }

  // 3b. Remove from athlete registration indexes + registration object
  const removeRef = async (key: string) => {
    const rows = await getKV<any[]>(key, actionName) || [];
    const filtered = rows.filter((r: any) => {
      const rowBookingId = String(r?.bookingId || '').trim();
      const rowEventId = String(r?.eventId || '').trim();
      return !(rowBookingId === normalizedBookingId && rowEventId === eventId);
    });
    if (filtered.length !== rows.length) await putKV(key, filtered, actionName);
  };

  await Promise.all([
    ...Array.from(userUidCandidates).map((uid) => removeRef(`athlete:uid:${uid}:registrations`)),
    ...Array.from(emailCandidates).map((email) => removeRef(`athlete:email:${email}:registrations`)),
    ...Array.from(mobileCandidates).map((mobile) => removeRef(`athlete:mobile:${mobile}:registrations`)),
  ]);

  if (normalizedRefId) await deleteKV(`registration:${normalizedRefId}`, actionName);

  // 4. Email-based fallback: if no uid found, look up user by email to ensure user index is cleaned.
  //    This handles cases where athleteUid was missing from the participant record.
  if (userUidCandidates.size === 0) {
    const candidateEmail = String(fullIndexEntry?.email || fullIndexEntry?.buyerEmail || compactIndexEntry?.email || compactIndexEntry?.buyerEmail || '').trim().toLowerCase();
    if (candidateEmail) {
      try {
        const db = getFirestoreInstance();
        const userSnap = await db.collection('users').where('email', '==', candidateEmail).limit(3).get();
        for (const userDoc of userSnap.docs) {
          const userEventsKey = `user:${userDoc.id}:events:index`;
          const userEvents = await getKV<any[]>(userEventsKey, actionName) || [];
          const filteredUserEvents = userEvents.filter((e) => {
            const rowBookingId = String(e?.bookingId || '').trim();
            const rowId = String(e?.id || '').trim();
            return !(
              (!!normalizedBookingId && rowBookingId === normalizedBookingId) ||
              (!!normalizedRefId && rowId === normalizedRefId)
            );
          });
          if (filteredUserEvents.length !== userEvents.length) {
            await putKV(userEventsKey, filteredUserEvents, actionName);
          }
        }
      } catch (e) {
        console.warn(`[${actionName}] Email-based user index cleanup failed for bookingId ${bookingId}:`, e);
      }
    }
  }
}

/**
 * SYNC CLUB'S UPCOMING ATHLETES TO KV
 * When a participant is created/updated and has a clubId, update club:{clubId}:upcoming
 */
export async function _syncClubUpcomingAthletes(clubId: string): Promise<void> {
  if (!clubId) return;
  const actionName = '_syncClubUpcomingAthletes';
  const db = getFirestoreInstance();

  try {
    // Get all club members
    const usersSnap = await db.collection('users')
      .where('clubId', '==', clubId)
      .get();

    const upcomingAthletes: any[] = [];

    // For each club member, find their upcoming registrations
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data() as any;
      const athleteUid = userDoc.id;
      const athleteName = userData.name || 'Unknown';

      // Get user's upcoming event registrations from KV
      const userEventsKey = `user:${athleteUid}:events:index`;
      const userEvents = await getKV<any[]>(userEventsKey, actionName) || [];

      for (const event of userEvents) {
        const { eventId, bookingId, ticketStatus, eventName, ticketName, ticketId } = event;
        // Only include Active/Confirmed tickets for upcoming events
        if ((ticketStatus === 'Active' || ticketStatus === 'Confirmed') && eventId && bookingId) {
          
          let finalEventName = eventName || 'Unknown Event';
          let finalEventDate = event.eventDate || null;
          let finalTicketName = ticketName || 'Unknown Ticket';
          let athleteBibNumber: string | null = event?.bibNumber ? String(event.bibNumber) : null;
          
          // If eventDate is missing, load from Firestore event
          if (!finalEventDate || finalEventDate === 'TBD' || finalEventDate === null) {
            try {
              const eventDoc = await db.collection('events').doc(eventId).get();
              if (eventDoc.exists) {
                const eventData = eventDoc.data();
                if (eventData?.eventDate) {
                  finalEventDate = eventData.eventDate;
                }
                if (!finalEventName || finalEventName === 'Unknown Event') {
                  finalEventName = eventData?.eventName || finalEventName;
                }
              }
            } catch (e) {
              // Fall back to KV if Firestore lookup fails
              const eventDataKey = `event:${eventId}:data`;
              const eventData = await getKV<any>(eventDataKey, actionName);
              if (eventData?.eventDate) {
                finalEventDate = eventData.eventDate;
              }
            }
          }
          
          // If ticketName or bibNumber is missing, load from participant record
          if (!finalTicketName || finalTicketName === 'Unknown Ticket' || !athleteBibNumber) {
            try {
              const participantDoc = await db.collection('events').doc(eventId)
                .collection('participants').doc(bookingId).get();
              if (participantDoc.exists) {
                const participantData = participantDoc.data();
                if (participantData?.ticketName) {
                  finalTicketName = participantData.ticketName;
                }
                if (!finalEventDate && participantData?.eventDate) {
                  finalEventDate = participantData.eventDate;
                }
                if (participantData?.bibNumber) {
                  athleteBibNumber = String(participantData.bibNumber);
                }
              } else {
                // For records where participant document ID differs from bookingId,
                // use KV mirror (event:{eventId}:participant:{bookingId}).
                const participantDataKey = `event:${eventId}:participant:${bookingId}`;
                const participantData = await getKV<any>(participantDataKey, actionName);
                if (participantData?.ticketName) {
                  finalTicketName = participantData.ticketName;
                }
                if (!finalEventDate && participantData?.eventDate) {
                  finalEventDate = participantData.eventDate;
                }
                if (participantData?.bibNumber) {
                  athleteBibNumber = String(participantData.bibNumber);
                }
              }
            } catch (e) {
              // Fall back to KV if Firestore lookup fails
              const participantDataKey = `event:${eventId}:participant:${bookingId}`;
              const participantData = await getKV<any>(participantDataKey, actionName);
              if (participantData?.ticketName) {
                finalTicketName = participantData.ticketName;
              }
              if (!finalEventDate && participantData?.eventDate) {
                finalEventDate = participantData.eventDate;
              }
              if (participantData?.bibNumber) {
                athleteBibNumber = String(participantData.bibNumber);
              }
            }
          }

          upcomingAthletes.push({
            athleteName,
            bookingId,
            athleteUid,
            eventId,
            eventName: finalEventName,
            eventDate: finalEventDate,
            ticketName: finalTicketName,
            ticketId: ticketId || bookingId,
            athleteBibNumber: athleteBibNumber || null
          });
        }
      }
    }

    // Store club's upcoming athletes
    await putKV(`club:${clubId}:upcoming`, upcomingAthletes, actionName);
  } catch (error) {
    console.error(`[${actionName}] Error syncing club ${clubId}:`, error);
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
  const batchSize = 25;
    
    for (let i = 0; i < snap.docs.length; i += batchSize) {
        const batch = snap.docs.slice(i, i + batchSize);
        await Promise.all(batch.map(async (doc) => {
            const user = serializeValue({ ...doc.data(), uid: doc.id });
            await putKV(`users:${doc.id}`, user, actionName);
      await putKV(`user:${doc.id}:profile`, user, actionName);
            uids.push(doc.id);
        }));
    if (i + batchSize < snap.docs.length) {
      await sleep(350);
    }
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

/**
 * CLEANUP DELETED CLUBS FROM KV
 */
export async function _cleanupDeletedClubsFromKV(): Promise<{ success: boolean; count: number; message: string }> {
    const actionName = '_cleanupDeletedClubsFromKV';
    try {
        const adminDb = getFirestoreInstance();
        const firestoreClubs = await adminDb.collection('clubs').get();
        const firestoreClubIds = new Set(firestoreClubs.docs.map(doc => doc.id));
        
        console.log(`[${actionName}] Found ${firestoreClubIds.size} clubs in Firestore: ${Array.from(firestoreClubIds).join(', ')}`);
        
        let deleteCount = 0;
        let orphanedClubIds = new Set<string>();
        
        // Get ALL keys from KV with pagination (not just club: prefix) to catch orphaned entries
        let cursor: string | undefined = undefined;
        
        const apiBase = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}`;
        
        let totalKeysScanned = 0;
        let clubKeysFound = 0;
        let foundClubIds = new Set<string>();
        
        while (true) {
            const url = new URL(`${apiBase}/keys`);
            url.searchParams.append('limit', '1000');
            if (cursor) {
                url.searchParams.append('cursor', cursor);
            }
            
            const response = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }
            });
            
            if (!response.ok) {
                console.error(`[${actionName}] Failed to fetch keys: ${response.status}`);
                break;
            }
            
            const data = await response.json();
            const kvKeys = data.result?.map((item: { name: string }) => item.name) || [];
            
            totalKeysScanned += kvKeys.length;
            
            // Check for orphaned club keys
            for (const key of kvKeys) {
                const match = key.match(/^club:([^:]+)(?::|$)/);
                if (match) {
                    clubKeysFound++;
                    const clubId = match[1];
                    foundClubIds.add(clubId);
                    
                    if (!firestoreClubIds.has(clubId)) {
                        orphanedClubIds.add(clubId);
                    }
                }
            }
            
            cursor = data.result_info?.cursor;
            if (!cursor || kvKeys.length === 0) break;
        }
        
        console.log(`[${actionName}] Found club IDs in KV: ${Array.from(foundClubIds).join(', ')}`);
        console.log(`[${actionName}] Orphaned club IDs (in KV but not in Firestore): ${Array.from(orphanedClubIds).join(', ')}`);
        
        // Now delete all keys for orphaned clubs
        for (const clubId of orphanedClubIds) {
            cursor = undefined;
            while (true) {
                const url = new URL(`${apiBase}/keys`);
                url.searchParams.append('prefix', `club:${clubId}`);
                url.searchParams.append('limit', '1000');
                if (cursor) {
                    url.searchParams.append('cursor', cursor);
                }
                
                const response = await fetch(url.toString(), {
                    headers: { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }
                });
                
                if (!response.ok) break;
                
                const data = await response.json();
                const keysToDelete = data.result?.map((item: { name: string }) => item.name) || [];
                
                for (const key of keysToDelete) {
                    try {
                        await deleteKV(key, actionName);
                        deleteCount++;
                        console.log(`[${actionName}] Deleted orphaned key: ${key}`);
                    } catch (e) {
                        console.error(`[${actionName}] Failed to delete key ${key}:`, e);
                    }
                }
                
                cursor = data.result_info?.cursor;
                if (!cursor || keysToDelete.length === 0) break;
            }
        }
        
        const message = `Removed ${deleteCount} orphaned entries for ${orphanedClubIds.size} clubs from KV (scanned ${totalKeysScanned} keys, found ${clubKeysFound} club entries across ${foundClubIds.size} unique clubs)`;
        console.log(`[${actionName}] ${message}`);
        return { success: true, count: deleteCount, message };
    } catch (e: any) {
        console.error(`[${actionName}] Failed:`, e);
        return { success: false, count: 0, message: `Cleanup failed: ${e instanceof Error ? e.message : 'Unknown error'}` };
    }
}

export async function runDataSyncAction(
  syncType: string,
  eventId?: string,
  year?: number
): Promise<{ success: boolean; message: string; jobId?: string }> {
  const { jobId } = await startJob();
  const currentYear = year || new Date().getFullYear();

  (async () => {
    try {
      if (syncType === "registrations" && eventId) {
        await updateJobProgress(jobId, { status: 'processing', stage: "Indexing Participant Roster...", progress: 30 });
        const participantRes = await _syncParticipantsToKV(eventId);
        await updateJobProgress(jobId, { stage: "Syncing Club Affiliation Data...", progress: 55 });
        const { syncClubDataForEventParticipantsAction } = await import('./clubActions');
        const clubSyncRes = await syncClubDataForEventParticipantsAction(eventId);
        if (!clubSyncRes.success) {
          console.warn(`[runDataSyncAction] Club sync warning for event ${eventId}: ${clubSyncRes.message}`);
        }
        await updateJobProgress(jobId, { stage: "Computing Registration Metrics...", progress: 70 });
        const adminDb = getFirestoreInstance();
        const eventDoc = await adminDb.collection('events').doc(eventId).get();
        const eventData = eventDoc.data() as EventCalendarEntry;
        if (eventData?.country) {
          await computeCountryRegistrationMetricsAction(eventData.country as 'IN' | 'US');
        }
        await updateJobProgress(jobId, { status: 'completed', stage: "Participants & Metrics Ready", progress: 100, syncCount: participantRes.participantCount });
        return;
      }

      if (syncType === "results" && eventId) {
        await updateJobProgress(jobId, { stage: "Mirroring Results to KV...", progress: 10 });
        const resultRes = await syncResultsToKVAction(eventId);
        // Invalidate club rankings since results changed
        await invalidateByCollection('races');
        await updateJobProgress(jobId, { status: 'completed', stage: "Results Mirrored", progress: 100, syncCount: resultRes.message.match(/\d+/) ? parseInt(resultRes.message.match(/\d+/)![0]) : 0 });
      }

      if (syncType === "users") {
        await updateJobProgress(jobId, { stage: "Indexing Global Athlete Directory...", progress: 10 });
        const res = await _syncAllUsersToKV();
        // Invalidate club stats since user data changed
        await invalidateByCollection('users');
        await updateJobProgress(jobId, { status: 'completed', stage: `Users Indexed`, progress: 100, syncCount: res.count });
      }

      if (syncType === "coupons") {
        await updateJobProgress(jobId, { stage: "Mirroring Active Coupons...", progress: 30 });
        const res = await _syncCouponsToKV();
        await updateJobProgress(jobId, { status: 'completed', stage: `Coupons Ready`, progress: 100, syncCount: res.count });
      }

      if (syncType === "participants" && eventId) {
        await updateJobProgress(jobId, { stage: "Indexing Participant Roster...", progress: 30 });
        const participantRes = await _syncParticipantsToKV(eventId);

        await updateJobProgress(jobId, { stage: "Syncing Club Affiliation Data...", progress: 55 });
        const { syncClubDataForEventParticipantsAction } = await import('./clubActions');
        const clubSyncRes = await syncClubDataForEventParticipantsAction(eventId);
        if (!clubSyncRes.success) {
          console.warn(`[runDataSyncAction] Club sync warning for event ${eventId}: ${clubSyncRes.message}`);
        }
        
        // Compute registration metrics for this event
        await updateJobProgress(jobId, { stage: "Computing Registration Metrics...", progress: 70 });
        const eventRes = await computeEventRegistrationMetricsAction(eventId);
        
        // Get event details to find country and recompute country-level metrics
        const adminDb = getFirestoreInstance();
        const eventDoc = await adminDb.collection('events').doc(eventId).get();
        const eventData = eventDoc.data() as EventCalendarEntry;
        if (eventData?.country) {
          await computeCountryRegistrationMetricsAction(eventData.country as 'IN' | 'US');
        }
        
        await updateJobProgress(jobId, { status: 'completed', stage: "Participants & Metrics Ready", progress: 100, syncCount: participantRes.participantCount });
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
            await updateJobProgress(jobId, { status: 'completed', stage: "Athletes Ranked", progress: 100, syncCount: res.rankings.length });
        } else {
            await updateJobProgress(jobId, { status: 'completed', stage: "Athletes Ranked", progress: 100, syncCount: 0 });
        }
      }

      if (syncType === "clubRankings") {
        await updateJobProgress(jobId, { stage: `Computing Club Rankings for ${currentYear}...`, progress: 20 });
        const res = await _computeClubRankings({ year: currentYear });
        if (res.success && res.rankings) {
            await putKV(`rankings:clubs:${currentYear}`, res.rankings, "sync-job");
            await updateJobProgress(jobId, { status: 'completed', stage: "Clubs Ranked", progress: 100, syncCount: res.rankings.length });
        } else {
            await updateJobProgress(jobId, { status: 'completed', stage: "Clubs Ranked", progress: 100, syncCount: 0 });
        }
      }

      if (syncType === "analytics") {
        await updateJobProgress(jobId, { stage: "Computing Snapshot Metrics...", progress: 20 });

        const [ticketStats, athleteStats, globalStats] = await Promise.all([
            _computeAllEventTicketStats(),
            _computeAdminAthleteAnalytics(),
            _computeGlobalParticipantStats(),
        ]);

        const errors: string[] = [];

        console.log(`[Analytics Sync] ticketStats.success: ${ticketStats.success}, events count: ${ticketStats.eventTicketStats?.length || 0}`);

        if (ticketStats.success) {
            await putKV('analytics:ticket_stats', ticketStats.eventTicketStats, "sync-job");
        } else {
            errors.push(`ticketStats: ${ticketStats.message}`);
        }

        if (athleteStats.success) {
            await putKV('analytics:admin_athlete_snapshot', { analytics: athleteStats.analytics, recentSignups: athleteStats.recentSignups }, "sync-job");
        } else {
            errors.push(`athleteStats: ${athleteStats.message}`);
        }

        if (globalStats.success) {
            await putKV('analytics:global_participant_snapshot', globalStats.stats, "sync-job");
        } else {
            errors.push(`globalStats: ${globalStats.message}`);
        }

        await updateJobProgress(jobId, { stage: "Refreshing Country Overview Metrics...", progress: 45 });
        const [inMetrics, usMetrics] = await Promise.all([
          computeCountryRegistrationMetricsAction('IN'),
          computeCountryRegistrationMetricsAction('US'),
        ]);

        if (!inMetrics.success) errors.push(`country:IN: ${inMetrics.message}`);
        if (!usMetrics.success) errors.push(`country:US: ${usMetrics.message}`);

        await updateJobProgress(jobId, { stage: "Refreshing Event Overview Metrics...", progress: 60 });
        const adminDb = getFirestoreInstance();
        const today = startOfDay(new Date());
        const parseEventDateSafe = (value: any): Date | null => {
          if (!value) return null;
          if (value instanceof Date) return value;
          if (typeof value?.toDate === 'function') return value.toDate();
          if (typeof value === 'string') {
            const parsed = parseISO(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
          }
          return null;
        };

        const eventsSnap = await adminDb.collection('events').select('eventDate').get();
        const upcomingEventIds = eventsSnap.docs
          .filter((doc) => {
            const eventDate = parseEventDateSafe((doc.data() as any)?.eventDate);
            return !!eventDate && !isBefore(startOfDay(eventDate), today);
          })
          .map((doc) => doc.id);

        for (let i = 0; i < upcomingEventIds.length; i++) {
          const currentEventId = upcomingEventIds[i];
          const progress = 60 + Math.round(((i + 1) / Math.max(upcomingEventIds.length, 1)) * 35);
          await updateJobProgress(jobId, {
            stage: `Refreshing event overview ${i + 1}/${upcomingEventIds.length}`,
            progress,
          });

          const eventMetrics = await computeEventRegistrationMetricsAction(currentEventId);
          if (!eventMetrics.success) {
            errors.push(`event:${currentEventId}: ${eventMetrics.message}`);
          }
        }

        if (errors.length > 0) {
          throw new Error(`Analytics sync completed with ${errors.length} issue(s): ${errors.slice(0, 5).join(' | ')}`);
        }

        await updateJobProgress(jobId, {
          status: 'completed',
          stage: "Analytics Ready",
          progress: 100,
          syncCount: upcomingEventIds.length,
        });
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
        const clubRes = await _syncAllClubsToKV();
        await _syncStoreProductsToKV();
        await _syncAnnouncementsToKV();
        
        await updateJobProgress(jobId, { status: 'completed', stage: "Site Metadata Ready", progress: 100, syncCount: clubRes.count });
      }

      if (syncType === "clubs") {
        await updateJobProgress(jobId, { stage: "Syncing All Clubs to KV...", progress: 30 });
        const res = await _syncAllClubsToKV();
        await updateJobProgress(jobId, { stage: "Cleaning up deleted clubs...", progress: 90 });
        const cleanupRes = await _cleanupDeletedClubsFromKV();
        await updateJobProgress(jobId, { status: 'completed', stage: "Clubs Synced", progress: 100, syncCount: res.count, message: `Synced ${res.count} clubs, cleaned ${cleanupRes.count} orphaned entries` });
      }

      if (syncType === "all") {
          await updateJobProgress(jobId, { stage: "Full Catalog Mirroring...", progress: 10 });
          await _syncCouponsToKV();
          await _syncStoreProductsToKV();
          await _syncAnnouncementsToKV();
          const clubRes = await _syncAllClubsToKV();
          await updateJobProgress(jobId, { stage: "Cleaning up deleted entries...", progress: 90 });
          const cleanupRes = await _cleanupDeletedClubsFromKV();
          await updateJobProgress(jobId, { status: 'completed', stage: "Full Mirror Complete", progress: 100, syncCount: clubRes.count, message: `Synced ${clubRes.count} clubs, cleaned ${cleanupRes.count} orphaned entries` });
      }

      if (syncType === "kvMigration") {
        const adminDb = getFirestoreInstance();
        await updateJobProgress(jobId, { stage: 'Preparing KV migration...', progress: 5, syncCount: 0, totalCount: 0 });

        const eventsSnapshot = await adminDb.collection('events').get();
        const eventDocs = eventsSnapshot.docs;
        const totalPhases = (eventDocs.length * 2) + 7;
        let completedPhases = 0;

        const phaseProgress = async (stage: string) => {
          completedPhases += 1;
          await updateJobProgress(jobId, {
            stage,
            progress: Math.min(98, Math.round((completedPhases / totalPhases) * 100)),
            syncCount: completedPhases,
            totalCount: totalPhases,
          });
        };

        await phaseProgress('Syncing users to KV with rate limiting...');
        await _syncAllUsersToKV();
        await sleep(500);

        await phaseProgress('Syncing clubs to KV...');
        await _syncAllClubsToKV();
        await sleep(500);

        await phaseProgress('Syncing coupons to KV...');
        await _syncCouponsToKV();
        await sleep(350);

        await phaseProgress('Syncing store products to KV...');
        await _syncStoreProductsToKV();
        await sleep(350);

        await phaseProgress('Syncing announcements to KV...');
        await _syncAnnouncementsToKV();
        await sleep(350);

        await phaseProgress('Syncing calendar snapshot to KV...');
        await _syncCalendarToKV();
        await sleep(500);

        await phaseProgress(`Syncing BEL ${currentYear} season to KV...`);
        await syncBelSeasonFromResultsKVAction(currentYear);
        await sleep(500);

        for (const eventDoc of eventDocs) {
          const eventName = String(eventDoc.data()?.eventName || eventDoc.id);

          await phaseProgress(`Migrating participants to KV for ${eventName}...`);
          await _syncParticipantsToKV(eventDoc.id);
          await sleep(650);

          await phaseProgress(`Migrating results to KV for ${eventName}...`);
          await syncResultsToKVAction(eventDoc.id);
          await sleep(650);
        }

        await updateJobProgress(jobId, {
          status: 'completed',
          stage: 'KV migration complete',
          progress: 100,
          syncCount: totalPhases,
          totalCount: totalPhases,
          message: `Migrated users, clubs, metadata, BEL, and ${eventDocs.length} events to KV with throttled pacing to reduce 429 errors.`,
        });
      }

      if (syncType === "cleanup-deleted-clubs") {
        await updateJobProgress(jobId, { stage: "Scanning for Deleted Clubs...", progress: 30 });
        const res = await _cleanupDeletedClubsFromKV();
        await updateJobProgress(jobId, { status: 'completed', stage: "Cleanup Complete", progress: 100, syncCount: res.count });
      }

    } catch (err: any) {
      await updateJobProgress(jobId, { status: 'failed', stage: "Job Terminated", message: err.message });
    }
  })();

  return { success: true, message: "Synchronization task dispatched.", jobId };
}
