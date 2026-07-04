'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { normalizeToE164 } from '@/lib/utils';
import { serializeValue } from '@/lib/utils';

export interface SplitSecondPixSearchResult {
  id: string;
  name: string;
  slug: string | null;
  searchByBib: boolean;
  searchByFace: boolean;
  eventUrl: string | null;
}

export interface MappedRacePhotoEvent {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  customSlug?: string | null;
  splitSecondPixEventId: string;
  splitSecondPixEventName?: string | null;
  splitSecondPixEventSlug?: string | null;
  splitSecondPixSearchByBib?: boolean | null;
  splitSecondPixSearchByFace?: boolean | null;
  eventUrl: string | null;
}

export interface RacePhotoParticipantLookupResult {
  participantId: string;
  athleteName: string;
  bibNumber: string;
  ticketName?: string | null;
  email?: string | null;
  mobile?: string | null;
}

const SPLITSECOND_EVENT_SEARCH_URL = 'https://new.splitsecondpix.com/api/search/event';
const SPLITSECOND_EVENT_DETAIL_URL = 'https://new.splitsecondpix.com/api/get-event';

export async function searchSplitSecondPixEventsAction(
  query: string
): Promise<{ success: boolean; message: string; events?: SplitSecondPixSearchResult[] }> {
  try {
    const cleanedQuery = query.trim();
    if (!cleanedQuery) {
      return { success: true, message: 'Empty query.', events: [] };
    }

    const upstream = await fetch(SPLITSECOND_EVENT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ name: cleanedQuery }),
      cache: 'no-store',
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return { success: false, message: `Search failed: ${upstream.status} ${text}` };
    }

    const rawJson = await upstream.json();
    const rawEvents: any[] = Array.isArray(rawJson)
      ? rawJson
      : Array.isArray(rawJson?.data)
        ? rawJson.data
        : [];

    const enriched = await Promise.all(
      rawEvents.map(async (item) => {
        const eventId = String(item?.id || '').trim();
        if (!eventId) return null;

        let detail: any = null;
        try {
          const detailRes = await fetch(SPLITSECOND_EVENT_DETAIL_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ event_id: Number(eventId) || eventId }),
            cache: 'no-store',
          });

          if (detailRes.ok) {
            const detailJson = await detailRes.json();
            detail = Array.isArray(detailJson) ? detailJson[0] ?? null : null;
          }
        } catch {
          detail = null;
        }

        const slug = String(detail?.slug || item?.slug || '').trim() || null;
        return {
          id: eventId,
          name: String(item?.name || `Event ${eventId}`).trim(),
          slug,
          searchByBib: detail?.search_by_bib === 1,
          searchByFace: detail?.search_by_face === 1,
          eventUrl: slug ? `https://new.splitsecondpix.com/events/${slug}` : null,
        } satisfies SplitSecondPixSearchResult;
      })
    );

    return {
      success: true,
      message: 'Fetched Split Second Pix events.',
      events: serializeValue(enriched.filter(Boolean)),
    };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to search Split Second Pix events.' };
  }
}

export async function getMappedRacePhotoEventsAction(): Promise<{
  success: boolean;
  message: string;
  events?: MappedRacePhotoEvent[];
}> {
  try {
    const adminDb = getFirestoreInstance();
    const eventsSnap = await adminDb.collection('events').get();

    const events = eventsSnap.docs
      .map((doc) => {
        const data = doc.data() as any;
        const splitSecondPixEventId = String(data?.splitSecondPixEventId || '').trim();
        if (!splitSecondPixEventId) return null;

        const splitSecondPixEventSlug = String(data?.splitSecondPixEventSlug || '').trim() || null;
        return {
          eventId: doc.id,
          eventName: String(data?.eventName || 'Untitled Event'),
          eventDate: data?.eventDate || null,
          customSlug: data?.customSlug || null,
          splitSecondPixEventId,
          splitSecondPixEventName: data?.splitSecondPixEventName || null,
          splitSecondPixEventSlug,
          splitSecondPixSearchByBib: data?.splitSecondPixSearchByBib ?? null,
          splitSecondPixSearchByFace: data?.splitSecondPixSearchByFace ?? null,
          eventUrl: splitSecondPixEventSlug ? `https://new.splitsecondpix.com/events/${splitSecondPixEventSlug}` : null,
        } satisfies MappedRacePhotoEvent;
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aTime = a?.eventDate ? new Date(a.eventDate).getTime() : 0;
        const bTime = b?.eventDate ? new Date(b.eventDate).getTime() : 0;
        return bTime - aTime;
      });

    return { success: true, message: 'Fetched mapped race photo events.', events: serializeValue(events) };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to load race photo mappings.' };
  }
}

function normalizeLookupText(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function normalizeLookupMobile(value?: string | null) {
  const normalized = normalizeToE164(value || null);
  return String(normalized || value || '').replace(/\D/g, '');
}

export async function findRacePhotoParticipantsAction(
  eventId: string,
  identifier: string
): Promise<{ success: boolean; message: string; participants?: RacePhotoParticipantLookupResult[] }> {
  try {
    const cleanedEventId = String(eventId || '').trim();
    const cleanedIdentifier = String(identifier || '').trim();
    if (!cleanedEventId || !cleanedIdentifier) {
      return { success: false, message: 'Event and email/mobile are required.', participants: [] };
    }

    const lookupEmail = normalizeLookupText(cleanedIdentifier);
    const lookupMobile = normalizeLookupMobile(cleanedIdentifier);
    const adminDb = getFirestoreInstance();
    const participantsSnap = await adminDb.collection('events').doc(cleanedEventId).collection('participants').get();

    const matches = participantsSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
      .filter((participant) => {
        const participantEmailCandidates = [
          normalizeLookupText(participant.email),
          normalizeLookupText(participant.buyerEmail),
          normalizeLookupText(participant.businessEmail),
        ].filter(Boolean);
        const participantMobileCandidates = [
          normalizeLookupMobile(participant.mobile),
          normalizeLookupMobile(participant.businessMobile),
        ].filter(Boolean);

        const emailMatch = !!lookupEmail && participantEmailCandidates.includes(lookupEmail);
        const mobileMatch = !!lookupMobile && participantMobileCandidates.includes(lookupMobile);
        const hasBib = String(participant.bibNumber || participant.relayTeamBib || '').trim();
        const activeStatus = ['active', 'confirmed', 'pending'].includes(String(participant.ticketStatus || '').trim().toLowerCase());
        return (emailMatch || mobileMatch) && !!hasBib && activeStatus;
      })
      .sort((a, b) => {
        const aTime = new Date(a.registeredAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.registeredAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      })
      .map((participant) => ({
        participantId: participant.id,
        athleteName: String(participant.name || participant.buyerName || 'Athlete'),
        bibNumber: String(participant.bibNumber || participant.relayTeamBib || '').trim(),
        ticketName: participant.ticketName || null,
        email: participant.email || participant.buyerEmail || null,
        mobile: participant.mobile || null,
      } satisfies RacePhotoParticipantLookupResult));

    if (matches.length === 0) {
      return {
        success: false,
        message: 'No active registration with a bib number was found for this event using that email or mobile number.',
        participants: [],
      };
    }

    return {
      success: true,
      message: `Found ${matches.length} matching registration${matches.length === 1 ? '' : 's'}.`,
      participants: serializeValue(matches),
    };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to lookup participant photos.', participants: [] };
  }
}