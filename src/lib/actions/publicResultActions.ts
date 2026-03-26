// src/lib/actions/publicResultActions.ts
'use server';

import type { RaceResult, EventCalendarEntry } from '@/lib/types';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue, toDateStringSafe } from '@/lib/utils';
import { getKV } from '../cloudflare/kv';
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
    if (!eventsWithResults || !Array.isArray(eventsWithResults) || eventsWithResults.length === 0) {
      return { success: true, message: 'No events with results found in KV.', races: [] };
    }

    const eventIds = eventsWithResults.map(e => e.id);
    const allRaces: RaceResult[] = [];

    const racePromises = eventIds.map(eventId => getKV<RaceResult[]>(`results:${eventId}`, actionName));
    const eventResultsArray = await Promise.all(racePromises);

    eventResultsArray.forEach(eventRaces => {
      if (eventRaces && Array.isArray(eventRaces)) {
        allRaces.push(...eventRaces);
      }
    });
    
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
    const results = await getKV<RaceResult[]>(
      `results:${eventId}`,
      `${actionName}:${eventId}`
    );

    if (!results || !Array.isArray(results)) {
      console.warn(`[${actionName}] KV cache miss or non-array for results:${eventId}`);
      return {
        success: true,
        message: "No results found for this event.",
        participants: [],
      };
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
  email: string
): Promise<{ success: boolean; message: string; races?: RaceResult[] }> {
  const actionName = '[publicResultActions][getAthleteRaceHistoryAction]';
  if (!email) {
    return { success: false, message: 'Email is required to fetch race history.' };
  }

  try {
    // 1. Get all event IDs that have results from KV
    const eventsWithResults = await getKV<{ id: string }[]>('events:with-results', actionName);
    if (!eventsWithResults || !Array.isArray(eventsWithResults) || eventsWithResults.length === 0) {
      return { success: true, message: 'No events with race results found.', races: [] };
    }

    const eventIds = eventsWithResults.map(e => e.id);
    const allRaces: RaceResult[] = [];

    // 2. Fetch results for each event from KV
    const racePromises = eventIds.map(eventId => getKV<RaceResult[]>(`results:${eventId}`, actionName));
    const eventResultsArray = await Promise.all(racePromises);

    // 3. Filter and combine results for the user
    const lowerCaseEmail = email.toLowerCase();
    eventResultsArray.forEach(eventRaces => {
      if (eventRaces && Array.isArray(eventRaces)) {
        const userRaces = eventRaces.filter(race => race.emailLower === lowerCaseEmail);
        allRaces.push(...userRaces);
      }
    });

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
