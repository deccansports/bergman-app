// src/lib/actions/backupActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { BackupRecord, EventParticipant, TicketDefinition, BibAssignmentRule, Sponsor, EventInventory } from '@/lib/types';
import { serializeParticipantData, toIsoStringSafe, serializeValue } from '@/lib/utils';

const BACKUPS_COLLECTION = 'eventBackups';

export async function createBackupAction(
  eventId: string
): Promise<{ success: boolean; message: string; backupId?: string }> {
  const actionName = 'createBackupAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }

  try {
    const adminDb = getFirestoreInstance();
    const eventRef = adminDb.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
        return { success: false, message: 'Event to back up not found.' };
    }
    const eventData = eventSnap.data()!;
    const eventName = eventData.eventName || 'Unknown Event';

    // Fetch all related data
    const participantsSnap = await eventRef.collection('participants').get();
    const ticketsSnap = await eventRef.collection('ticketDefinitions').get();
    const bibsSnap = await eventRef.collection('bibAssignments').get();
    const sponsorsSnap = await eventRef.collection('sponsors').get();
    const inventorySnap = await eventRef.collection('inventory').doc('mainInventory').get();

    const participantsData = participantsSnap.docs.map(doc => serializeParticipantData(doc));
    const ticketDefinitionsData = ticketsSnap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }));
    const bibAssignmentsData = bibsSnap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }));
    const sponsorsData = sponsorsSnap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }));
    const inventoryData = inventorySnap.exists ? serializeValue(inventorySnap.data()) : null;
    
    // Construct the payload, converting all nested objects to strings
    // We use null instead of undefined to satisfy Firestore requirements if settings aren't applied
    const backupPayload: Omit<BackupRecord, 'id' | 'createdAt'> = {
      eventId,
      eventName,
      participantCount: participantsData.length,
      participantsData: JSON.stringify(participantsData),
      eventDocument: JSON.stringify(serializeValue(eventData)),
      ticketDefinitionsData: JSON.stringify(ticketDefinitionsData),
      bibAssignmentsData: JSON.stringify(bibAssignmentsData),
      sponsorsData: JSON.stringify(sponsorsData),
      inventoryData: inventoryData ? JSON.stringify(inventoryData) : null,
    };

    const newBackupRef = await adminDb.collection(BACKUPS_COLLECTION).add({
        ...backupPayload,
        createdAt: FieldValue.serverTimestamp(),
    });

    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Full backup created successfully.', backupId: newBackupRef.id };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getBackupsForEventAction(
  eventId?: string
): Promise<{ success: boolean; message: string; backups?: BackupRecord[] }> {
  const actionName = 'getBackupsForEventAction';
  try {
    const adminDb = getFirestoreInstance();
    let query = adminDb.collection(BACKUPS_COLLECTION).orderBy('createdAt', 'desc');
    
    if (eventId) {
      query = query.where('eventId', '==', eventId);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      return { success: true, message: `No backups found${eventId ? ' for this event' : ''}.`, backups: [] };
    }

    const backups: BackupRecord[] = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        eventId: data.eventId,
        eventName: data.eventName,
        createdAt: toIsoStringSafe(data.createdAt) || '',
        participantCount: data.participantCount,
        participantsData: data.participantsData,
        eventDocument: data.eventDocument,
        ticketDefinitionsData: data.ticketDefinitionsData,
        bibAssignmentsData: data.bibAssignmentsData,
        sponsorsData: data.sponsorsData,
        inventoryData: data.inventoryData,
      };
    });

    return { success: true, message: 'Backups fetched successfully.', backups };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function deleteBackupAction(
  backupId: string
): Promise<{ success: boolean; message: string }> {
  const actionName = 'deleteBackupAction';
  if (!backupId) {
    return { success: false, message: 'Backup ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection(BACKUPS_COLLECTION).doc(backupId).delete();
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Backup deleted successfully.' };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function restoreBackupAction(backupId: string, targetEventId: string): Promise<{ success: boolean; message: string }> {
  const actionName = 'restoreBackupAction';
  if (!backupId || !targetEventId) {
    return { success: false, message: 'Backup ID and Target Event ID are required.' };
  }
  const adminDb = getFirestoreInstance();
  try {
    const backupSnap = await adminDb.collection(BACKUPS_COLLECTION).doc(backupId).get();
    if (!backupSnap.exists) return { success: false, message: "Backup not found." };
    
    const backupData = backupSnap.data() as BackupRecord;
    const targetEventRef = adminDb.collection('events').doc(targetEventId);
    
    // --- Overwrite logic ---
    const collectionsToClear = ['participants', 'ticketDefinitions', 'bibAssignments', 'sponsors', 'inventory'];
    for (const coll of collectionsToClear) {
      const snapshot = await targetEventRef.collection(coll).get();
      if (!snapshot.empty) {
        const batch = adminDb.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    }
    
    const batch = adminDb.batch();

    // Restore Event Document
    if (backupData.eventDocument) {
        const eventDocData = JSON.parse(backupData.eventDocument);
        // Don't overwrite key identifiers that should be unique
        delete eventDocData.id;
        delete eventDocData.customSlug;
        delete eventDocData.foodPurchaseSlug;
        batch.set(targetEventRef, { ...eventDocData, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    
    // Restore subcollections
    if (backupData.participantsData) JSON.parse(backupData.participantsData).forEach((p: any) => batch.set(targetEventRef.collection('participants').doc(p.id), p));
    if (backupData.ticketDefinitionsData) JSON.parse(backupData.ticketDefinitionsData).forEach((t: any) => batch.set(targetEventRef.collection('ticketDefinitions').doc(t.id), t));
    if (backupData.bibAssignmentsData) JSON.parse(backupData.bibAssignmentsData).forEach((b: any) => batch.set(targetEventRef.collection('bibAssignments').doc(b.id), b));
    if (backupData.sponsorsData) JSON.parse(backupData.sponsorsData).forEach((s: any) => batch.set(targetEventRef.collection('sponsors').doc(s.id), s));
    if (backupData.inventoryData) batch.set(targetEventRef.collection('inventory').doc('mainInventory'), JSON.parse(backupData.inventoryData));
    
    await batch.commit();

    revalidatePath('/admin/dashboard');
    return { success: true, message: `Successfully restored backup to event.` };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Restore failed: ${e.message}` };
  }
}

export async function restoreBackupToNewEventAction(backupId: string): Promise<{ success: boolean; message: string, newEventId?: string }> {
  const actionName = 'restoreBackupToNewEventAction';
  if (!backupId) return { success: false, message: 'Backup ID is required.' };
  
  const adminDb = getFirestoreInstance();
  try {
    const backupSnap = await adminDb.collection(BACKUPS_COLLECTION).doc(backupId).get();
    const backupData = backupSnap.data() as BackupRecord | undefined;
    if (!backupSnap.exists || !backupData?.eventDocument) return { success: false, message: "Backup data is incomplete or not found." };

    const eventDocData = JSON.parse(backupData.eventDocument);
    const newEventData = {
        ...eventDocData,
        eventName: `${eventDocData.eventName} (Restored ${new Date().toISOString().split('T')[0]})`,
        customSlug: eventDocData.customSlug ? `${eventDocData.customSlug}-restored-${Date.now().toString().slice(-4)}` : null,
        foodPurchaseSlug: eventDocData.foodPurchaseSlug ? `${eventDocData.foodPurchaseSlug}-restored-${Date.now().toString().slice(-4)}` : null,
        isHidden: true,
        isSoldOut: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };
    delete newEventData.id;
    delete newEventData.sponsors;
    
    const newEventRef = await adminDb.collection('events').add(newEventData);
    const newEventId = newEventRef.id;

    const batch = adminDb.batch();
    if (backupData.participantsData) JSON.parse(backupData.participantsData).forEach((p: any) => batch.set(newEventRef.collection('participants').doc(p.id), p));
    if (backupData.ticketDefinitionsData) JSON.parse(backupData.ticketDefinitionsData).forEach((t: any) => batch.set(newEventRef.collection('ticketDefinitions').doc(t.id), t));
    if (backupData.bibAssignmentsData) JSON.parse(backupData.bibAssignmentsData).forEach((b: any) => batch.set(newEventRef.collection('bibAssignments').doc(b.id), b));
    if (backupData.sponsorsData) JSON.parse(backupData.sponsorsData).forEach((s: any) => batch.set(newEventRef.collection('sponsors').doc(s.id), s));
    if (backupData.inventoryData) batch.set(newEventRef.collection('inventory').doc('mainInventory'), JSON.parse(backupData.inventoryData));
    
    await batch.commit();

    revalidatePath('/admin/dashboard');
    return { success: true, message: `Successfully created a new event from backup.`, newEventId };

  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Restore to new failed: ${e.message}` };
  }
}
