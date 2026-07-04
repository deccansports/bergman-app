// src/lib/actions/eventActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { EventCalendarEntry, TicketDefinition, Sponsor, Influencer, CategoryChangeLogEntry, ContentBlock } from '@/lib/types';
import { serializeValue, isEventHidden, isTicketHidden } from '@/lib/utils';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { isBefore, parseISO, startOfDay, format, isValid, isEqual } from 'date-fns';
import { getKV, putKV } from '../cloudflare/kv';
import { getInfluencersForEventAction } from './influencerActions';
import { getCachedServerValue } from '@/lib/serverCache';

/**
 * CORE LOGIC: Computes the full calendar metadata by aggregating ticket dates.
 * This is the source of truth for displayDateRange and disciplineSchedule.
 */
export async function _computeCalendarEvents(): Promise<{ success: boolean; message: string; events?: EventCalendarEntry[] }> {
  const actionName = '_computeCalendarEvents';
  
  try {
    return await getCachedServerValue(`calendar:compute:${actionName}`, 60_000, async () => {
      const adminDb = getFirestoreInstance();
      const eventsSnapshot = await adminDb.collection('events').get();

      const eventsDataPromises = eventsSnapshot.docs.map(async doc => {
        if (!doc.id || doc.id.trim() === '') return null;
        const data = doc.data();
        
        // 1. FETCH ALL TICKETS
        const ticketDefsSnapshot = await doc.ref.collection('ticketDefinitions').get();
        const ticketDefinitions: TicketDefinition[] = ticketDefsSnapshot.docs
          .map((ticketDoc): TicketDefinition | null => {
              const ticketData = ticketDoc.data();
              if (!ticketDoc.id || ticketDoc.id.trim() === '') return null;
              return serializeValue({
                id: ticketDoc.id,
                eventId: doc.id,
                ...ticketData,
                isHidden: isTicketHidden(ticketData),
              }) as TicketDefinition;
          })
          .filter((ticket): ticket is TicketDefinition => ticket !== null);

        ticketDefinitions.sort((a, b) => (a.order || 0) - (b.order || 0));

        const uniqueDates = new Set<string>();
        const scheduleMap = new Map<string, Set<string>>();

        ticketDefinitions.forEach(t => {
          const dateToUse = t.eventDate || data.eventDate;
          if (dateToUse && dateToUse !== 'TBD') {
            const dateStr = dateToUse.split('T')[0]; 
            uniqueDates.add(dateStr);
            if (!scheduleMap.has(dateStr)) scheduleMap.set(dateStr, new Set());
            
            scheduleMap.get(dateStr)!.add(t.ticketName);
          }
        });

        if (scheduleMap.size === 0 && data.eventDate && data.eventDate !== 'TBD') {
          const dateStr = data.eventDate.split('T')[0];
          uniqueDates.add(dateStr);
          if (!scheduleMap.has(dateStr)) scheduleMap.set(dateStr, new Set());
          
          if (ticketDefinitions.length > 0) {
              ticketDefinitions.forEach(t => scheduleMap.get(dateStr)!.add(t.ticketName));
          } else {
              scheduleMap.get(dateStr)!.add('Main Event');
          }
        }

        const sortedDates = Array.from(uniqueDates).sort();
        let displayDateRange = data.eventDate || 'Date TBD';

        if (sortedDates.length > 0) {
          try {
              const dStart = parseISO(sortedDates[0]);
              const dEnd = parseISO(sortedDates[sortedDates.length - 1]);
              
              if (isValid(dStart) && isValid(dEnd)) {
                  if (sortedDates.length === 1) {
                      displayDateRange = format(dStart, 'MMMM dd, yyyy');
                  } else if (isEqual(startOfDay(dStart), startOfDay(dEnd))) {
                      displayDateRange = format(dStart, 'MMMM dd, yyyy');
                  } else {
                      if (dStart.getFullYear() === dEnd.getFullYear()) {
                          if (dStart.getMonth() === dEnd.getMonth()) {
                              displayDateRange = `${format(dStart, 'MMMM dd')} & ${format(dEnd, 'dd, yyyy')}`;
                          } else {
                              displayDateRange = `${format(dStart, 'MMM dd')} - ${format(dEnd, 'MMM dd, yyyy')}`;
                          }
                      } else {
                          displayDateRange = `${format(dStart, 'MMM dd, yyyy')} - ${format(dEnd, 'MMM dd, yyyy')}`;
                      }
                  }
              }
          } catch (e) {
              displayDateRange = data.eventDate || 'Date TBD';
          }
        } else {
            displayDateRange = 'Date TBD';
        }

        const disciplineSchedule = Array.from(scheduleMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, categories]) => ({
              date,
              disciplines: Array.from(categories)
          }));

        const eventData = {
          id: doc.id,
          ...data,
          isHidden: isEventHidden(data),
          displayDateRange,
          disciplineSchedule,
          isRaceWeekend: sortedDates.length > 1,
          ticketDefinitions,
        };

        return serializeValue(eventData) as EventCalendarEntry;
      });

      const eventsDataResults = await Promise.all(eventsDataPromises);
      const validEventsData = eventsDataResults.filter((event): event is EventCalendarEntry => event !== null);
      
      const now = startOfDay(new Date());
      const upcomingEvents: EventCalendarEntry[] = [];
      const pastEvents: EventCalendarEntry[] = [];

      validEventsData.forEach(event => {
        const effectiveDateStr = event.disciplineSchedule?.[0]?.date || (event.eventDate !== 'TBD' ? event.eventDate : null);
        if (!effectiveDateStr) {
          upcomingEvents.push(event);
        } else {
          const eventDate = parseISO(effectiveDateStr);
          if (isBefore(eventDate, now)) pastEvents.push(event);
          else upcomingEvents.push(event);
        }
      });

      upcomingEvents.sort((a, b) => {
        const dateAStr = a.disciplineSchedule?.[0]?.date || (a.eventDate !== 'TBD' ? a.eventDate : null);
        const dateBStr = b.disciplineSchedule?.[0]?.date || (b.eventDate !== 'TBD' ? b.eventDate : null);
        const dateA = dateAStr ? new Date(dateAStr).getTime() : Infinity;
        const dateB = dateBStr ? new Date(dateBStr).getTime() : Infinity;
        return dateA - dateB;
      });

      const finalEvents = [...upcomingEvents, ...pastEvents].map(event => 
        JSON.parse(JSON.stringify(event)) as EventCalendarEntry
      );

      return { success: true, message: "Computed.", events: finalEvents };
    });
  } catch (error: any) {
    return { success: false, message: `Failed: ${error.message}` };
  }
}

export async function getCalendarEventsAction(): Promise<{ success: boolean; message: string; events?: EventCalendarEntry[] }> {
    const actionName = 'getCalendarEventsAction';
    try {
        const events = await getKV<EventCalendarEntry[]>('calendar:snapshot', actionName);
        if (!events) return await _computeCalendarEvents();
        return { success: true, message: 'Fetched from cache.', events };
    } catch (error: any) {
        return await _computeCalendarEvents();
    }
}

export async function _syncCalendarToKV() {
    const result = await _computeCalendarEvents();
    if (result.success && result.events) {
        await putKV('calendar:snapshot', result.events, 'auto-sync');
        const eventsWithResults = result.events.filter(e => !!e.eventDate);
        await putKV('events:with-results', eventsWithResults, 'auto-sync');
    }
}

export async function getEventBySlugAction(slug: string, includeHidden: boolean = false): Promise<{ success: boolean; message: string; event?: EventCalendarEntry }> {
  try {
    const adminDb = getFirestoreInstance();
    if (!slug) return { success: false, message: "Slug missing." };

    const eventsSnapshot = await adminDb.collection('events').where('customSlug', '==', slug).limit(1).get();

    let eventDoc;
    if (eventsSnapshot.empty) {
        const directDoc = await adminDb.collection('events').doc(slug).get();
        if (directDoc.exists) eventDoc = directDoc;
        else return { success: false, message: `Event not found.` };
    } else {
        eventDoc = eventsSnapshot.docs[0];
    }

    const eventId = eventDoc.id;
  const fullCalendar = await getCalendarEventsAction();
  const eventData = fullCalendar.events?.find(e => e.id === eventId);

    if (!eventData) return { success: false, message: "Computation error." };
    if (eventData.isHidden && !includeHidden) return { success: false, message: "This event is hidden." };

    const sponsorsSnapshot = await eventDoc.ref.collection('sponsors').orderBy('order', 'asc').get();
    const sponsors: Sponsor[] = sponsorsSnapshot.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }) as Sponsor);
    const influencers = await getInfluencersForEventAction(eventId, { publicOnly: true });

    return { 
        success: true, 
        message: "Fetched.", 
      event: { ...eventData, sponsors, influencers: Array.isArray(influencers) ? influencers : [] } 
    };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function getEventByFoodSlugAction(slug: string): Promise<{ success: boolean; message: string; event?: EventCalendarEntry }> {
    try {
        const adminDb = getFirestoreInstance();
        if (!slug) return { success: false, message: "Slug missing." };
        const eventsSnapshot = await adminDb.collection('events').where('foodPurchaseSlug', '==', slug).limit(1).get();
        if (eventsSnapshot.empty) return { success: false, message: `Not found.` };
        const eventDoc = eventsSnapshot.docs[0];
        return { success: true, message: "Fetched.", event: serializeValue({ id: eventDoc.id, ...eventDoc.data() }) };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}


export async function getEventDetailsWithTicketsAction(eventId: string): Promise<{ success: boolean; message: string; event?: EventCalendarEntry }> {
  try {
    if (!eventId) return { success: false, message: "ID missing." };
    const adminDb = getFirestoreInstance();
    const fullCalendar = await getCalendarEventsAction();
    const cachedEvent = fullCalendar.events?.find(e => e.id === eventId);
    
    if (!cachedEvent) return { success: false, message: `Not found.` };

    const eventDoc = await adminDb.collection('events').doc(eventId).get();
    if (!eventDoc.exists) return { success: false, message: `Not found.` };

    const ticketDefsSnapshot = await eventDoc.ref.collection('ticketDefinitions').get();
    const liveTicketDefinitions: TicketDefinition[] = ticketDefsSnapshot.docs
      .map((ticketDoc): TicketDefinition | null => {
        const ticketData = ticketDoc.data();
        if (!ticketDoc.id || ticketDoc.id.trim() === '') return null;
        return serializeValue({
          id: ticketDoc.id,
          eventId,
          ...ticketData,
          isHidden: isTicketHidden(ticketData),
        }) as TicketDefinition;
      })
      .filter((ticket): ticket is TicketDefinition => ticket !== null)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    return {
      success: true,
      message: "Fetched.",
      event: {
        ...cachedEvent,
        ...serializeValue({ id: eventDoc.id, ...eventDoc.data() }),
        ticketDefinitions: liveTicketDefinitions,
      } as EventCalendarEntry,
    };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function addCalendarEventAction(
  eventData: Partial<Omit<EventCalendarEntry, 'id'>>
): Promise<{ success: boolean; message: string; eventId?: string }> {
  try {
    const adminDb = getFirestoreInstance();
    if (!eventData.eventName) return { success: false, message: "Event name is required." };

    const eventNameForSlug = eventData.eventName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const eventYear = eventData.eventDate ? new Date(eventData.eventDate).getFullYear() : new Date().getFullYear();
    const foodPurchaseSlug = `${eventNameForSlug}-${eventYear}-food`;
    
    const payload = {
      ...eventData,
      foodPurchaseSlug,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const newEventRef = await adminDb.collection('events').add(payload);
    await _syncCalendarToKV();
    revalidatePath('/admin/dashboard');
    revalidatePath('/');
    return { success: true, message: "Added.", eventId: newEventRef.id };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function updateCalendarEventAction(
  eventId: string,
  eventData: { [key: string]: any }
): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    if (!eventId) return { success: false, message: "ID missing." };
    
    const updatePayload: { [key: string]: any } = {
        ...eventData,
        updatedAt: FieldValue.serverTimestamp(),
    };

    if (eventData.deleteLiveTimingConfig === true) {
        updatePayload.liveTimingConfig = FieldValue.delete();
    }
    delete updatePayload.deleteLiveTimingConfig;

    const eventRef = adminDb.collection('events').doc(eventId);
    await eventRef.set(updatePayload, { merge: true });

    await _syncCalendarToKV();
    revalidatePath('/admin/dashboard');
    revalidatePath('/');
    return { success: true, message: "Updated." };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function deleteCalendarEventAction(eventId: string): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    if (!eventId) return { success: false, message: "ID missing." };
    
    const eventRef = adminDb.collection('events').doc(eventId);
    const participantsSnapshot = await eventRef.collection('participants').limit(1).get();
    if (!participantsSnapshot.empty) return { success: false, message: "Cannot delete with active participants." };

    await eventRef.delete();
    
    await _syncCalendarToKV();
    revalidatePath('/admin/dashboard');
    revalidatePath('/');
    return { success: true, message: "Deleted." };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}


export async function cloneEventAction(eventId: string): Promise<{ success: boolean; message: string; newEventId?: string }> {
  try {
    const adminDb = getFirestoreInstance();
    if (!eventId) return { success: false, message: "Source ID missing." };
    
    const sourceEventRef = adminDb.collection('events').doc(eventId);
    const sourceEventSnap = await sourceEventRef.get();
    if (!sourceEventSnap.exists) return { success: false, message: "Source not found." };
    
    const sourceEventData = sourceEventSnap.data()!;
    const newEventData = { ...sourceEventData };
    
    newEventData.eventName = `${sourceEventData.eventName} (Clone)`;
    newEventData.eventDate = null;
    newEventData.customSlug = sourceEventData.customSlug ? `${sourceEventData.customSlug}-clone` : null;
    newEventData.createdAt = FieldValue.serverTimestamp();
    newEventData.updatedAt = FieldValue.serverTimestamp();
    delete newEventData.sponsors;
    
    const newEventRef = await adminDb.collection('events').add(newEventData);
    await _syncCalendarToKV();
    revalidatePath('/admin/dashboard');
    revalidatePath('/');
    return { success: true, message: `Cloned.`, newEventId: newEventRef.id };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function getCategoryChangeLogAction(eventId?: string): Promise<{
  success: boolean;
  message: string;
  log?: CategoryChangeLogEntry[];
}> {
  try {
    const adminDb = getFirestoreInstance();
    // Read from top-level `categoryChanges` ledger to avoid collectionGroup index
    // precondition errors in admin dashboard.
    let query: FirebaseFirestore.Query = adminDb.collection('categoryChanges');
    if (eventId) {
      query = query.where('eventId', '==', eventId);
    }

    const snapshot = await query.get();
    if (snapshot.empty) return { success: true, message: "No data.", log: [] };

    // Backfill event names for legacy categoryChanges rows where eventName was not stored.
    const eventIds = Array.from(new Set(
      snapshot.docs
        .map((d) => String(d.data().eventId || '').trim())
        .filter(Boolean)
    ));
    const eventNameById = new Map<string, string>();
    await Promise.all(eventIds.map(async (id) => {
      try {
        const ev = await adminDb.collection('events').doc(id).get();
        if (ev.exists) {
          const name = String((ev.data() as any)?.eventName || '').trim();
          if (name) eventNameById.set(id, name);
        }
      } catch {
        // ignore per-event lookup errors
      }
    }));

    const logs = snapshot.docs
      .map((doc) => {
        const row = serializeValue({ id: doc.id, ...doc.data() }) as any;
        const rowEventId = String(row.eventId || '').trim();
        return {
          id: String(row.id || doc.id),
          eventId: rowEventId,
          eventName: String(row.eventName || eventNameById.get(rowEventId) || '—'),
          participantId: String(row.participantId || ''),
          participantName: String(row.participantName || 'Unknown'),
          participantEmail: String(row.participantEmail || ''),
          fromTicketName: String(row.fromTicketName || '—'),
          toTicketName: String(row.toTicketName || '—'),
          fromBibNumber: row.fromBibNumber ? String(row.fromBibNumber) : null,
          toBibNumber: row.toBibNumber ? String(row.toBibNumber) : null,
          paymentId: row.paymentId ? String(row.paymentId) : null,
          changedAt: String(row.changedAt || row.createdAt || new Date().toISOString()),
          invoiceNumber:
            row.invoiceNumber
              ? String(row.invoiceNumber)
              : (row.zohoSync?.invoiceNumber ? String(row.zohoSync.invoiceNumber) : null),
        } as CategoryChangeLogEntry;
      })
      .sort((a, b) => {
        const aTime = new Date(String(a.changedAt || '')).getTime() || 0;
        const bTime = new Date(String(b.changedAt || '')).getTime() || 0;
        return bTime - aTime;
      });

    return { success: true, message: "Fetched.", log: logs };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getGeneralSettingAction(settingKey: 'showLiveTrackingOnHomepage'): Promise<{ success: boolean; value: any; message?: string; }> {
    try {
        const adminDb = getFirestoreInstance();
        const doc = await adminDb.collection('settings').doc('general').get();
        return { success: true, value: doc.exists ? doc.data()?.[settingKey] : null };
    } catch (error: any) {
        return { success: false, value: null, message: error.message };
    }
}


export async function updateGeneralSettingAction(settingKey: 'showLiveTrackingOnHomepage', value: boolean): Promise<{ success: boolean; message: string }> {
    try {
        const adminDb = getFirestoreInstance();
        await adminDb.collection('settings').doc('general').set({ [settingKey]: value }, { merge: true });
        revalidatePath('/');
        return { success: true, message: 'Updated.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}
