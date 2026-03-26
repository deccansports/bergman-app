// src/lib/actions/ticketActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { serializeValue } from '@/lib/utils';
import type { TicketDefinition, EventTicketStats } from '@/lib/types';
import { TicketDefinitionSchema, type TicketDefinitionFormInput } from '@/lib/schemas';
import { merge } from 'lodash';
import { getKV } from '../cloudflare/kv';
import { _syncCalendarToKV } from './eventActions';

export async function _computeAllEventTicketStats(): Promise<{ success: boolean; message: string; eventTicketStats?: EventTicketStats[] }> {
  const actionName = '_computeAllEventTicketStats';
  let adminDb;
  try {
    adminDb = getFirestoreInstance();
    const allEventTicketStats: EventTicketStats[] = [];
    const eventsSnapshot = await adminDb.collection('events').get();
    if (eventsSnapshot.empty) return { success: true, message: "No events found.", eventTicketStats: [] };

    for (const eventDoc of eventsSnapshot.docs) {
      const eventData = eventDoc.data();
      const ticketDefsSnapshot = await eventDoc.ref.collection('ticketDefinitions').get();
      
      const participantsSnapshot = await eventDoc.ref.collection('participants').get();

      const participantsByTicketId = new Map<string, number>();
      let totalRevenueFromEventPaisa = 0;

      participantsSnapshot.forEach(pDoc => {
        const pData = pDoc.data();
        if (pData.ticketId) {
          participantsByTicketId.set(pData.ticketId, (participantsByTicketId.get(pData.ticketId) || 0) + 1);
        }
        const saleAmountPaisa = pData.amountPaidPaisa ?? 0;
        if (saleAmountPaisa > 0) {
          totalRevenueFromEventPaisa += saleAmountPaisa;
        }
      });
      
      const ticketDetailsForEvent: any[] = [];
      if (!ticketDefsSnapshot.empty) {
        ticketDefsSnapshot.forEach(defDoc => {
          const defData = defDoc.data() as TicketDefinition;
          const soldCount = participantsByTicketId.get(defDoc.id) || 0;
          const remaining = typeof defData.maxQuantity === 'number' && defData.maxQuantity > 0 ? Math.max(0, defData.maxQuantity - soldCount) : 'Unlimited';
          ticketDetailsForEvent.push({ 
            ticketDefinitionId: defDoc.id, 
            ticketName: defData.ticketName, 
            sold: soldCount, 
            remaining, 
            pricePaisa: defData.price, 
            ticketType: defData.ticketType 
          });
        });
      }

      allEventTicketStats.push({ 
          eventId: eventDoc.id, 
          eventName: eventData.eventName || 'N/A', 
          totalTicketsSoldInEvent: participantsSnapshot.size, 
          totalRevenueFromEventPaisa, 
          tickets: ticketDetailsForEvent 
      });
    }

    allEventTicketStats.sort((a, b) => a.eventName.localeCompare(b.eventName));
    return { success: true, message: "Event-wise ticket stats computed.", eventTicketStats: allEventTicketStats };
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { success: false, message: `Server action '${actionName}' failed: ${err.message}.` };
  }
}

export async function getTicketStatsAction(): Promise<{ success: boolean; message: string; eventTicketStats?: EventTicketStats[] }> {
  const actionName = 'getTicketStatsAction';
  try {
      const stats = await getKV<EventTicketStats[]>('analytics:ticket_stats', actionName);
      if (!stats) {
          return { success: true, message: 'Ticket stats not found in cache. Please run a data sync.', eventTicketStats: [] };
      }
      return { success: true, message: 'Ticket stats fetched from cache.', eventTicketStats: stats };
  } catch (error: any) {
      console.error(`[${actionName}] Failed to get ticket stats from KV:`, error);
      return { success: false, message: `Failed to fetch stats from cache: ${error.message}` };
  }
}


export async function addTicketDefinitionAction(
  eventId: string,
  ticketData: TicketDefinitionFormInput
): Promise<{ success: boolean; message: string; ticketId?: string }> {
  const actionName = 'addTicketDefinitionAction';
  let adminDb;
  try {
    adminDb = getFirestoreInstance();
    if (!eventId) return { success: false, message: "Event ID is required." };
    
    const validation = TicketDefinitionSchema.safeParse(ticketData);
    if (!validation.success) {
      return { success: false, message: validation.error.errors.map((e: any) => e.message).join(', ') };
    }
    const validatedData = validation.data;

    const newTicketRef = await adminDb.collection('events').doc(eventId).collection('ticketDefinitions').add({
      ...validatedData,
      eventId,
      price: validatedData.ticketType === 'Paid' ? (validatedData.price || 0) * 100 : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // IMMEDIATE SYNC TO KV
    await _syncCalendarToKV();

    revalidatePath('/admin/dashboard');
    return { success: true, message: "Ticket type added.", ticketId: newTicketRef.id };
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { success: false, message: `Server action '${actionName}' failed: ${err.message}.` };
  }
}

export async function updateTicketDefinitionAction(
  eventId: string,
  ticketId: string,
  ticketData: Partial<TicketDefinition>
): Promise<{ success: boolean; message: string; updatedTicket?: TicketDefinition }> {
  const actionName = 'updateTicketDefinitionAction';
  let adminDb;
  try {
    adminDb = getFirestoreInstance();
    if (!eventId || !ticketId) return { success: false, message: "Event ID and Ticket ID are required." };
    if (Object.keys(ticketData).length === 0) return { success: true, message: "No data to update." };

    const ticketRef = adminDb.collection('events').doc(eventId).collection('ticketDefinitions').doc(ticketId);
    
    const updatedTicket = await adminDb.runTransaction(async (transaction) => {
        const ticketDoc = await transaction.get(ticketRef);
        if (!ticketDoc.exists) {
            throw new Error("Ticket not found.");
        }
        
        const existingData = ticketDoc.data() as TicketDefinition;

        const updatePayload: { [key: string]: any } = { 
          updatedAt: FieldValue.serverTimestamp() 
        };

        const flattenObject = (obj: any, prefix = ''): any =>
          Object.keys(obj).reduce((acc: any, k: any) => {
            const pre = prefix.length ? `${prefix}.` : '';
            if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
              Object.assign(acc, flattenObject(obj[k], pre + k));
            } else {
              acc[pre + k] = obj[k];
            }
            return acc;
          }, {});

        const flatTicketData = flattenObject(ticketData);

        for(const key in flatTicketData) {
            updatePayload[key] = flatTicketData[key];
        }
        
        if (updatePayload.ticketType === 'Free') {
            updatePayload.price = null;
        }

        transaction.update(ticketRef, updatePayload);
        
        const finalData = merge({}, existingData, ticketData, { 
            id: ticketDoc.id, 
            eventId,
            updatedAt: new Date().toISOString()
        });

        return finalData as TicketDefinition;
    });

    // IMMEDIATE SYNC TO KV
    await _syncCalendarToKV();

    revalidatePath('/admin/dashboard');
    return { success: true, message: "Ticket definition updated.", updatedTicket: serializeValue(updatedTicket) };
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${actionName}] Failed to update ticket: ${err.message}`, err.stack);
    return { success: false, message: `Server action '${actionName}' failed: ${err.message}.` };
  }
}

export async function updateTicketOrderAction(
  eventId: string,
  orders: { id: string; order: number }[]
): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const batch = adminDb.batch();
    const colRef = adminDb.collection('events').doc(eventId).collection('ticketDefinitions');

    orders.forEach(({ id, order }) => {
      batch.update(colRef.doc(id), { 
        order, 
        updatedAt: FieldValue.serverTimestamp() 
      });
    });

    await batch.commit();
    
    // IMMEDIATE SYNC TO KV
    await _syncCalendarToKV();
    
    revalidatePath('/admin/dashboard');
    return { success: true, message: "Display order updated." };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function cloneTicketDataAction(
  sourceEventId: string,
  sourceTicketId: string,
  targetEventId: string,
  targetTicketId: string,
): Promise<{ success: boolean; message: string; }> {
    const actionName = 'cloneTicketDataAction';
    let adminDb;
    try {
        adminDb = getFirestoreInstance();
        if (!sourceEventId || !sourceTicketId || !targetEventId || !targetTicketId) {
            return { success: false, message: "All source and target IDs are required." };
        }
        
        const sourceTicketRef = adminDb.collection('events').doc(sourceEventId).collection('ticketDefinitions').doc(sourceTicketId);
        const targetTicketRef = adminDb.collection('events').doc(targetEventId).collection('ticketDefinitions').doc(targetTicketId);

        const [sourceSnap, targetSnap] = await Promise.all([sourceTicketRef.get(), targetTicketRef.get()]);

        if (!sourceSnap.exists) return { success: false, message: "Source ticket definition not found." };
        if (!targetSnap.exists) return { success: false, message: "Target ticket definition not found." };

        const sourceData = sourceSnap.data();
        const dataToClone = {
            courseMaps: sourceData?.courseMaps || {},
            cutoffs: sourceData?.cutoffs || {},
            applicableAgeGroups: sourceData?.applicableAgeGroups || [],
        };

        await targetTicketRef.update({
            ...dataToClone,
            updatedAt: FieldValue.serverTimestamp(),
        });
        
        // IMMEDIATE SYNC TO KV
        await _syncCalendarToKV();

        revalidatePath('/admin/dashboard');
        return { success: true, message: "Successfully cloned GPX, Cutoff, and Age Group data." };

    } catch(e:any) {
        console.error(`[${actionName}] Error cloning data: ${e.message}`);
        return { success: false, message: `Server action failed: ${e.message}` };
    }
}


export async function deleteTicketDefinitionAction(
  eventId: string,
  ticketId: string
): Promise<{ success: boolean; message: string }> {
  const actionName = 'deleteTicketDefinitionAction';
  let adminDb;
  try {
    adminDb = getFirestoreInstance();
    if (!eventId || !ticketId) return { success: false, message: "Event ID and Ticket ID required." };
    await adminDb.collection('events').doc(eventId).collection('ticketDefinitions').doc(ticketId).delete();
    
    // IMMEDIATE SYNC TO KV
    await _syncCalendarToKV();

    revalidatePath('/admin/dashboard');
    return { success: true, message: "Ticket definition deleted." };
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { success: false, message: `Server action '${actionName}' failed: ${err.message}.` };
  }
}

export async function getTicketDefinitionsForEventAction(
  eventId: string,
  excludeTicketId?: string | null
): Promise<{ success: boolean; message: string; ticketDefinitions?: TicketDefinition[] }> {
    const actionName = 'getTicketDefinitionsForEventAction';
    if (!eventId) {
        return { success: false, message: 'Event ID is required.' };
    }
    try {
        const adminDb = getFirestoreInstance();
        const snapshot = await adminDb.collection('events').doc(eventId).collection('ticketDefinitions').get();

        if (snapshot.empty) {
            return { success: true, message: "No tickets found for this event.", ticketDefinitions: [] };
        }
        
        let tickets: TicketDefinition[] = snapshot.docs.map(doc => {
            return serializeValue({
                id: doc.id,
                eventId: eventId,
                ...doc.data(),
            }) as TicketDefinition;
        });

        // Exclude the specified ticket if provided
        if (excludeTicketId) {
            tickets = tickets.filter(ticket => ticket.id !== excludeTicketId);
        }

        // Sort by order, then createdAt
        tickets.sort((a,b) => {
            if ((a.order || 0) !== (b.order || 0)) return (a.order || 0) - (b.order || 0);
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateA - dateB;
        });
        
        return { success: true, message: "Tickets fetched successfully.", ticketDefinitions: tickets };

    } catch (e: any) {
        console.error(`[${actionName}] Error fetching tickets for event ${eventId}:`, e);
        return { success: false, message: `Failed to fetch tickets: ${e.message}` };
    }
}
