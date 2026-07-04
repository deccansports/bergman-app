// src/lib/actions/publicResultActions.ts
'use server';

import type { RaceResult, EventCalendarEntry } from '@/lib/types';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue, toDateStringSafe } from '@/lib/utils';
import { getKV, batchGetKV, putKV } from '../cloudflare/kv';
import { isBefore, parseISO, startOfDay, format } from 'date-fns';

/**
 * ============================================================
 * 🔥 FIRESTORE ACCESS ALLOWED (INTERNAL ONLY)
 * ============================================================
 * This function directly queries Firestore and is intended ONLY for
 * use by other server actions during data sync/computation jobs.
 * It should NOT be called directly from any client-facing components.
 * ============================================================
 */
export async function _internal_fetchAllRaceDataFromFirestore({ year, eventId }: { year?: number; eventId?: string } = {}): Promise<{
  success: boolean;
  message: string;
  races?: RaceResult[];
}> {
  const actionName = '[publicResultActions][_internal_fetchAllRaceDataFromFirestore]';
  
  try {
    const adminDb = getFirestoreInstance();
    let query: FirebaseFirestore.Query = adminDb.collection('raceResults');
    
    if (year) {
      query = query.where('raceYear', '==', year);
    }
    if (eventId) {
      query = query.where('eventId', '==', eventId);
    }

    const snapshot = await query.get();

    if (snapshot.empty) return { success: true, message: 'No race data found for the given criteria.', races: [] };

    const races: RaceResult[] = snapshot.docs.map(doc => {
      const d = doc.data();
      return serializeValue({
        ...d,
        docId: doc.id,
        raceDate: toDateStringSafe(d.raceDate),
        uploadedAt: toDateStringSafe(d.uploadedAt),
      }) as RaceResult;
    });

    races.sort((a, b) => new Date(b.raceDate!).getTime() - new Date(a.raceDate!).getTime());

    return { success: true, message: 'All race data fetched successfully for ranking sync.', races };
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`${actionName}: Action failed: ${err.message}`, err.stack);
    if ((err as any).code === 'FAILED_PRECONDITION') {
        return { success: false, message: `A database index is required for this query. Please check your Firestore indexes configuration for the raceResults collection.`, races: [] };
    }
    return { success: false, message: `Server action '${actionName}' failed: ${err.message}.`, races: [] };
  }
}

/**
 * ============================================================
 * ☁️ CLOUDFLARE KV ACCESS ALLOWED (INTERNAL ONLY)
 * ============================================================
 */
export async function _internal_fetchAllRaceDataFromKV(): Promise<{
  success: boolean;
  message: string;
  races?: RaceResult[];
}> {
  const actionName = '[publicResultActions][_internal_fetchAllRaceDataFromKV]';
  try {
    const eventsWithResults = await getKV<EventCalendarEntry[]>('events:with-results', actionName);
    const eventIds = Array.isArray(eventsWithResults) ? eventsWithResults.map(e => e.id) : [];
    const allRaces: RaceResult[] = [];

    if (eventIds.length > 0) {
      const racePromises = eventIds.map(eventId => getKV<RaceResult[]>(`results:${eventId}`, actionName));
      const eventResultsArray = await Promise.all(racePromises);

      eventResultsArray.forEach(eventRaces => {
        if (eventRaces && Array.isArray(eventRaces)) {
          allRaces.push(...eventRaces);
        }
      });
    }

    allRaces.sort((a, b) => new Date(b.raceDate!).getTime() - new Date(a.raceDate!).getTime());

    return { success: true, message: 'All race data fetched successfully from KV.', races: allRaces };
  } catch (error: any) {
    console.error(`${actionName}: KV fetch failed: ${error.message}`, error.stack);
    return { success: false, message: `Server action '${actionName}' failed: ${error.message}.`, races: [] };
  }
}


/**
 * ============================================================
 * 🏁 PUBLIC FINAL RESULTS (KV ONLY)
 * ============================================================
 */
export async function getPublicFinalResultsAction(
  eventId: string,
  bibNumbers?: string[] | null,
  search?: { term: string; by: 'name' | 'bib' | 'email' | 'mobile' } | null
): Promise<{
  success: boolean;
  message: string;
  participants?: RaceResult[];
}> {
  const actionName = '[publicResultActions][getPublicFinalResultsAction]';

  try {
    let results = await getKV<RaceResult[]>(
      `results:${eventId}`,
      `${actionName}:${eventId}`
    );

    if (!results || !Array.isArray(results)) {
      console.warn(`[${actionName}] KV cache miss or non-array for results:${eventId}; returning empty results.`);
      results = [];
    }

    let filteredResults = results;

    // Filter by Bib Numbers (Array)
    if (bibNumbers && bibNumbers.length > 0) {
      const bibSet = new Set(bibNumbers.map(String));
      filteredResults = results.filter(r => bibSet.has(String(r.bibNumber)));
    }

    // Search Filtering
    else if (search && search.term) {
      const term = search.term.toLowerCase().trim();

      filteredResults = results.filter(r => {
        if (search.by === 'bib') {
            return String(r.bibNumber) === term; // Exact match for bib
        }
        if (search.by === 'name') {
            return r.name?.toLowerCase().includes(term);
        }
        if (search.by === 'email') {
            return r.email?.toLowerCase().includes(term) || r.emailLower?.includes(term);
        }
        if (search.by === 'mobile') {
            return r.mobile?.includes(term);
        }
        return false;
      });
    }

    return {
      success: true,
      message: 'Results fetched from KV cache.',
      participants: filteredResults,
    };
  } catch (error: any) {
    console.error(`[${actionName}] KV error:`, error);
    return {
      success: false,
      message: `Failed to fetch results from KV: ${error.message}`,
      participants: [],
    };
  }
}

/**
 * ============================================================
 * 📅 DISTINCT EVENTS LIST (KV ONLY)
 * ============================================================
 */
export async function getDistinctEventsFromResultsAction(): Promise<{
  success: boolean;
  message: string;
  events?: {
    id: string;
    name: string;
    date: string | null;
    customSlug: string | null;
  }[];
}> {
  const actionName =
    '[publicResultActions][getDistinctEventsFromResultsAction]';

  try {
    const eventsFromKV = await getKV<EventCalendarEntry[]>('events:with-results', actionName);

    if (!eventsFromKV || !Array.isArray(eventsFromKV)) {
      console.warn(`[${actionName}] KV cache miss or non-array for events:with-results`);
      return {
        success: true,
        message: 'No event data available.',
        events: [],
      };
    }
    
    const today = startOfDay(new Date());

    // Filter events to only include those that are in the past (i.e., have results)
    const pastEventsWithResults = eventsFromKV.filter(event => {
      if (!event.eventDate) return false; 
      try {
        const eventDate = parseISO(event.eventDate);
        return isBefore(eventDate, today) || event.eventDate === format(today, 'yyyy-MM-dd');
      } catch {
        return false; 
      }
    });

    // Map to the slim object format and sort by date DESCENDING (Latest first)
    const events = pastEventsWithResults
        .map(event => ({
            id: event.id,
            name: event.eventName, 
            date: event.eventDate,
            customSlug: event.customSlug || null
        }))
        .sort((a, b) => {
            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            // Sort newest (latest) first for past events
            return dateB - dateA;
        });

    return {
      success: true,
      message: 'Events with results fetched from KV cache.',
      events,
    };
  } catch (error: any) {
    console.error(`[${actionName}] KV error:`, error);
    return {
      success: false,
      message: `Failed to fetch distinct events: ${error.message}`,
      events: [],
    };
  }
}

/**
 * ============================================================
 * 🏃 ATHLETE RACE HISTORY (KV ONLY)
 * ============================================================
 */
export async function getAthleteRaceHistoryAction(
  email: string,
  athleteUid?: string,
  mobile?: string
): Promise<{ success: boolean; message: string; races?: RaceResult[] }> {
  const actionName = '[publicResultActions][getAthleteRaceHistoryAction]';
  if (!email && !athleteUid && !mobile) {
    return { success: false, message: 'Email, athlete UID, or mobile is required to fetch race history.' };
  }

  try {
    // Resolve additional identity signals from the user's Firestore profile when UID is available.
    const normalizedUid = String(athleteUid || '').trim();
    const identityEmails = new Set<string>();
    const identityMobiles = new Set<string>();

    const normalizedInputEmail = String(email || '').toLowerCase().trim();
    if (normalizedInputEmail) identityEmails.add(normalizedInputEmail);

    const normalizedInputMobile = String(mobile || '').replace(/\D/g, '');
    if (normalizedInputMobile) {
      identityMobiles.add(normalizedInputMobile);
      if (normalizedInputMobile.length >= 10) identityMobiles.add(normalizedInputMobile.slice(-10));
    }

    if (normalizedUid) {
      try {
        const db = getFirestoreInstance();
        const userSnap = await db.collection('users').doc(normalizedUid).get();
        if (userSnap.exists) {
          const profile = userSnap.data() || {};
          const profileEmails = [profile?.email, profile?.personalRaceEmail]
            .map((v: any) => String(v || '').toLowerCase().trim())
            .filter(Boolean);
          profileEmails.forEach((e: string) => identityEmails.add(e));

          const profileMobile = String(profile?.mobile || '').replace(/\D/g, '');
          if (profileMobile) {
            identityMobiles.add(profileMobile);
            if (profileMobile.length >= 10) identityMobiles.add(profileMobile.slice(-10));
          }
        }
      } catch (profileErr: any) {
        console.warn(`[${actionName}] Unable to load user profile for identity enrichment:`, profileErr?.message || profileErr);
      }
    }

    // 1. Get all event IDs that have results from KV
    const eventsWithResults = await getKV<{ id: string }[]>('events:with-results', actionName);
    const eventIds = Array.isArray(eventsWithResults) ? eventsWithResults.map(e => e.id) : [];
    const allRaces: RaceResult[] = [];

    // 2. 🔥 Fetch results for each event from KV using SEQUENTIAL reads (not parallel)
    // This prevents hitting Cloudflare's 429 rate limit
    const resultKeys = eventIds.map(id => `results:${id}`);
    const eventResultsArray = resultKeys.length > 0
      ? await batchGetKV<RaceResult[]>(resultKeys, actionName)
      : [];

    // 3. Filter and combine results for the user
    const emailCandidates = Array.from(identityEmails);
    const mobileCandidates = Array.from(identityMobiles);
    eventResultsArray.forEach(eventRaces => {
      if (eventRaces && Array.isArray(eventRaces)) {
        const userRaces = eventRaces.filter((race: any) => {
          const raceUid = String(race?.athleteUid || '').trim();
          const raceEmailLower = String(race?.emailLower || '').toLowerCase().trim();
          const raceEmail = String(race?.email || '').toLowerCase().trim();
          const raceMobileDigits = String(race?.mobile || '').replace(/\D/g, '');
          const raceMobileLast10 = raceMobileDigits.length >= 10 ? raceMobileDigits.slice(-10) : raceMobileDigits;
          const emailMatch = emailCandidates.some((candidate) => candidate && (raceEmailLower === candidate || raceEmail === candidate));
          const mobileMatch = mobileCandidates.some((candidate) => {
            if (!candidate) return false;
            return raceMobileDigits === candidate || raceMobileLast10 === candidate;
          });
          return (
            (!!normalizedUid && raceUid === normalizedUid) ||
            emailMatch ||
            mobileMatch
          );
        });
        allRaces.push(...userRaces);
      }
    });

    // Fallback: if KV has no rows for this athlete, query Firestore raceResults directly.
    if (allRaces.length === 0) {
      try {
        const db = getFirestoreInstance();
        const candidates: RaceResult[] = [];

        if (normalizedUid) {
          const byUid = await db.collection('raceResults').where('athleteUid', '==', normalizedUid).get();
          byUid.docs.forEach((doc) => {
            candidates.push(serializeValue({
              ...doc.data(),
              docId: doc.id,
              raceDate: toDateStringSafe(doc.data().raceDate),
              uploadedAt: toDateStringSafe(doc.data().uploadedAt),
            }) as RaceResult);
          });
        }

        for (const candidateEmail of emailCandidates) {
          const [byEmailLower, byEmail] = await Promise.all([
            db.collection('raceResults').where('emailLower', '==', candidateEmail).get(),
            db.collection('raceResults').where('email', '==', candidateEmail).get(),
          ]);
          [byEmailLower, byEmail].forEach((snap) => {
            snap.docs.forEach((doc) => {
              candidates.push(serializeValue({
                ...doc.data(),
                docId: doc.id,
                raceDate: toDateStringSafe(doc.data().raceDate),
                uploadedAt: toDateStringSafe(doc.data().uploadedAt),
              }) as RaceResult);
            });
          });
        }

        for (const mobileCandidate of mobileCandidates) {
          const byMobile = await db.collection('raceResults').where('mobile', '==', mobileCandidate).get();
          byMobile.docs.forEach((doc) => {
            candidates.push(serializeValue({
              ...doc.data(),
              docId: doc.id,
              raceDate: toDateStringSafe(doc.data().raceDate),
              uploadedAt: toDateStringSafe(doc.data().uploadedAt),
            }) as RaceResult);
          });
        }

        const deduped = new Map<string, RaceResult>();
        candidates.forEach((race: any) => {
          const key = String(race?.docId || `${race?.eventId || ''}:${race?.bibNumber || ''}:${race?.raceDate || ''}`);
          deduped.set(key, race);
        });

        allRaces.push(...Array.from(deduped.values()));
      } catch (fireErr: any) {
        console.warn(`[${actionName}] Firestore fallback failed:`, fireErr?.message || fireErr);
      }
    }

    // 4. Sort the combined results by date
    allRaces.sort((a, b) => new Date(b.raceDate!).getTime() - new Date(a.raceDate!).getTime());

    return { success: true, message: 'Race history fetched from cache.', races: allRaces };
  } catch (error: any) {
    console.error(`[${actionName}] KV error:`, error);
    return {
      success: false,
      message: `Failed to fetch race history from KV: ${error.message}`,
      races: [],
    };
  }
}
