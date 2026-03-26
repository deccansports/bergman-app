// src/lib/actions/eventActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { EventCalendarEntry, TicketDefinition, Sponsor, CategoryChangeLogEntry, ContentBlock } from '@/lib/types';
import { serializeValue } from '@/lib/utils';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { isBefore, parseISO, startOfDay, format, isValid, isEqual } from 'date-fns';
import { getKV, putKV } from '../cloudflare/kv';

/**
 * CORE LOGIC: Computes the full calendar metadata by aggregating ticket dates.
 * This is the source of truth for displayDateRange and disciplineSchedule.
 */
export async function _computeCalendarEvents(): Promise<{ success: boolean; message: string; events?: EventCalendarEntry[] }> {
  const actionName = '_computeCalendarEvents';
  
  try {
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
              ...ticketData
            }) as TicketDefinition;
        })
        .filter((ticket): ticket is TicketDefinition => ticket !== null);

      ticketDefinitions.sort((a, b) => (a.order || 0) - (b.order || 0));

      // 2. FETCH PARTICIPANT LINKS (For slot-based tiering)
      // Only select fields we need to keep the object small for KV
      const participantsSnap = await doc.ref.collection('participants')
        .where('ticketStatus', 'in', ['Active', 'Confirmed', 'Paid'])
        .select('ticketId', 'selectedSubCategory')
        .get();
      const participants = participantsSnap.docs.map(p => p.data());

      const uniqueDates = new Set<string>();
      const scheduleMap = new Map<string, Set<string>>();

      // 1. Collect all dates and categories from tickets (Primary Source)
      ticketDefinitions.forEach(t => {
        const dateToUse = t.eventDate || data.eventDate;
        if (dateToUse && dateToUse !== 'TBD') {
          const dateStr = dateToUse.split('T')[0]; 
          uniqueDates.add(dateStr);
          if (!scheduleMap.has(dateStr)) scheduleMap.set(dateStr, new Set());
          
          // Use Ticket Name for descriptive schedule
          scheduleMap.get(dateStr)!.add(t.ticketName);
        }
      });

      // 2. Fallback: Main event date if no ticket dates resulted in a schedule
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
                    // Multi-day
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
          // If absolutely no dates found in tickets or main record
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
        displayDateRange,
        disciplineSchedule,
        isRaceWeekend: sortedDates.length > 1,
        ticketDefinitions,
        participants, // Included for accurate slot counting in components
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

    return { success: true, message: "Computed.", events: [...upcomingEvents, ...pastEvents] };
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

export async function getEventBySlugAction(slug: string): Promise<{ success: boolean; message: string; event?: EventCalendarEntry }> {
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
    // REUSE the heavy compute logic to ensure the specific event page has the same rich date/schedule info
    const fullCalendar = await _computeCalendarEvents();
    const eventData = fullCalendar.events?.find(e => e.id === eventId);

    if (!eventData) return { success: false, message: "Computation error." };

    const sponsorsSnapshot = await eventDoc.ref.collection('sponsors').orderBy('order', 'asc').get();
    const sponsors: Sponsor[] = sponsorsSnapshot.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }) as Sponsor);

    return { 
        success: true, 
        message: "Fetched.", 
        event: { ...eventData, sponsors } 
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
    const fullCalendar = await _computeCalendarEvents();
    const event = fullCalendar.events?.find(e => e.id === eventId);
    
    if (!event) return { success: false, message: `Not found.` };

    return { success: true, message: "Fetched.", event };
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
    let query: FirebaseFirestore.Query = adminDb.collectionGroup('categoryChangeLog');
    if (eventId) query = query.where('eventId', '==', eventId);
    query = query.orderBy('changedAt', 'desc');
    const snapshot = await query.get();
    if (snapshot.empty) return { success: true, message: "No data.", log: [] };
    const logs = snapshot.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }));
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
