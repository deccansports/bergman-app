// src/lib/actions/backupActions.ts
 'use server';

import { getFirestoreInstance, getStorageInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { BackupRecord } from '@/lib/types';
import { serializeParticipantData, toIsoStringSafe, serializeValue } from '@/lib/utils';
import * as zlib from 'zlib';
import { getParticipantsPaginatedAction } from './participantActions';

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

    // Fetch the full participant list from the same KV/Firestore-backed source used by the Participants tab.
    // This keeps backups aligned with the UI and prevents cancelled/deferred rows from being dropped.
    const participantsResult = await getParticipantsPaginatedAction(eventId, 10000, null, false);
    const participantRows = participantsResult?.success && Array.isArray(participantsResult.participants)
      ? participantsResult.participants
      : [];

    // Fallback for older data that may not yet be reflected in the paginated source.
    const participantsSnap = await eventRef.collection('participants').get();
    const ticketsSnap = await eventRef.collection('ticketDefinitions').get();
    const bibsSnap = await eventRef.collection('bibAssignments').get();
    const sponsorsSnap = await eventRef.collection('sponsors').get();
    const inventorySnap = await eventRef.collection('inventory').doc('mainInventory').get();

    const firestoreParticipantsData = participantsSnap.docs.map(doc => serializeParticipantData(doc));
    const participantsData = participantRows.length > 0 ? participantRows : firestoreParticipantsData;
    const ticketDefinitionsData = ticketsSnap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }));
    const bibAssignmentsData = bibsSnap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }));
    const sponsorsData = sponsorsSnap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }));
    const inventoryData = inventorySnap.exists ? serializeValue(inventorySnap.data()) : null;
    
    // Construct the payload, converting all nested objects to strings
    // We use null instead of undefined to satisfy Firestore requirements if settings aren't applied
    // Create a full JS object representation of everything we want to persist
    const fullBackupObject = {
      participantsData,
      eventDocument: serializeValue(eventData),
      ticketDefinitionsData,
      bibAssignmentsData,
      sponsorsData,
      inventoryData,
    };

    const fullString = JSON.stringify(fullBackupObject);

    // If payload is large, upload to Storage and save a small Firestore record
    const shouldUseStorage = Buffer.byteLength(fullString, 'utf8') > 800000; // ~800KB threshold

    const backupPayloadBase: Omit<BackupRecord, 'id' | 'createdAt'> = {
      eventId,
      eventName,
      participantCount: participantsData.length,
      participantsData: null,
      eventDocument: null,
      ticketDefinitionsData: null,
      bibAssignmentsData: null,
      sponsorsData: null,
      inventoryData: null,
      storagePath: null,
      storageSize: null,
      storageCompressed: null,
    };

    let finalPayload = { ...backupPayloadBase } as any;

    if (shouldUseStorage) {
      const storage = getStorageInstance();
      const bucket = storage.bucket();
      const filename = `backups/${eventId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.json.gz`;
      const compressed = zlib.gzipSync(Buffer.from(fullString, 'utf8'));
      const file = bucket.file(filename);
      await file.save(compressed, { resumable: false, contentType: 'application/gzip' });

      finalPayload.storagePath = filename;
      finalPayload.storageSize = compressed.length;
      finalPayload.storageCompressed = true;
    } else {
      // Small enough to keep inline in Firestore as before
      finalPayload.participantsData = JSON.stringify(participantsData);
      finalPayload.eventDocument = JSON.stringify(serializeValue(eventData));
      finalPayload.ticketDefinitionsData = JSON.stringify(ticketDefinitionsData);
      finalPayload.bibAssignmentsData = JSON.stringify(bibAssignmentsData);
      finalPayload.sponsorsData = JSON.stringify(sponsorsData);
      finalPayload.inventoryData = inventoryData ? JSON.stringify(inventoryData) : null;
    }

    const newBackupRef = await adminDb.collection(BACKUPS_COLLECTION).add({
      ...finalPayload,
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
      let derivedParticipantCount = Number(data.participantCount || 0);

      if (typeof data.participantsData === 'string' && data.participantsData.trim()) {
        try {
          const parsedParticipants = JSON.parse(data.participantsData);
          if (Array.isArray(parsedParticipants)) {
            derivedParticipantCount = parsedParticipants.length;
          }
        } catch {
          // Keep stored count if payload cannot be parsed.
        }
      }

      return {
        id: doc.id,
        eventId: data.eventId,
        eventName: data.eventName,
        createdAt: toIsoStringSafe(data.createdAt) || '',
        participantCount: derivedParticipantCount,
        participantsData: data.participantsData,
        eventDocument: data.eventDocument,
        ticketDefinitionsData: data.ticketDefinitionsData,
        bibAssignmentsData: data.bibAssignmentsData,
        sponsorsData: data.sponsorsData,
        inventoryData: data.inventoryData,
        storagePath: data.storagePath || null,
        storageSize: data.storageSize || null,
        storageCompressed: data.storageCompressed || null,
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

export async function fetchBackupDataAction(backupId: string): Promise<{ success: boolean; message: string; data?: { participantsData?: string | null; eventDocument?: string | null; ticketDefinitionsData?: string | null; bibAssignmentsData?: string | null; sponsorsData?: string | null; inventoryData?: string | null } }> {
  const actionName = 'fetchBackupDataAction';
  if (!backupId) return { success: false, message: 'Backup ID is required.' };
  try {
    const adminDb = getFirestoreInstance();
    const snap = await adminDb.collection(BACKUPS_COLLECTION).doc(backupId).get();
    if (!snap.exists) return { success: false, message: 'Backup not found.' };
    const data = snap.data() as any;

    // If stored in storage, download and decompress
    if (data.storagePath) {
      const storage = getStorageInstance();
      const bucket = storage.bucket();
      const file = bucket.file(data.storagePath);
      const [buffer] = await file.download();
      const raw = data.storageCompressed ? zlib.gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
      const parsed = JSON.parse(raw);
      return {
        success: true,
        message: 'Backup payload loaded from storage.',
        data: {
          participantsData: JSON.stringify(parsed.participantsData),
          eventDocument: JSON.stringify(parsed.eventDocument),
          ticketDefinitionsData: JSON.stringify(parsed.ticketDefinitionsData),
          bibAssignmentsData: JSON.stringify(parsed.bibAssignmentsData),
          sponsorsData: JSON.stringify(parsed.sponsorsData),
          inventoryData: parsed.inventoryData ? JSON.stringify(parsed.inventoryData) : null,
        }
      };
    }

    // Inline data
    return {
      success: true,
      message: 'Backup payload loaded from Firestore.',
      data: {
        participantsData: data.participantsData || null,
        eventDocument: data.eventDocument || null,
        ticketDefinitionsData: data.ticketDefinitionsData || null,
        bibAssignmentsData: data.bibAssignmentsData || null,
        sponsorsData: data.sponsorsData || null,
        inventoryData: data.inventoryData || null,
      }
    };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Failed to fetch backup payload: ${e.message}` };
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
    
    let backupData = backupSnap.data() as BackupRecord;
    // If backup is stored in Storage, load the payload and populate inline fields for restore
    if (!backupData) return { success: false, message: 'Backup not found.' };
    if (!backupData.participantsData && backupData.storagePath) {
      const storage = getStorageInstance();
      const bucket = storage.bucket();
      const file = bucket.file(backupData.storagePath!);
      const [buffer] = await file.download();
      const raw = backupData.storageCompressed ? zlib.gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
      const parsed = JSON.parse(raw);
      backupData = {
        ...backupData,
        participantsData: JSON.stringify(parsed.participantsData),
        eventDocument: JSON.stringify(parsed.eventDocument),
        ticketDefinitionsData: JSON.stringify(parsed.ticketDefinitionsData),
        bibAssignmentsData: JSON.stringify(parsed.bibAssignmentsData),
        sponsorsData: JSON.stringify(parsed.sponsorsData),
        inventoryData: parsed.inventoryData ? JSON.stringify(parsed.inventoryData) : null,
      } as BackupRecord;
    }
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
    let backupData = backupSnap.data() as BackupRecord | undefined;
    if (!backupSnap.exists || !backupData) return { success: false, message: "Backup data is incomplete or not found." };

    // If backup payload is in Storage, load it so we can access eventDocument
    if (!backupData.eventDocument && backupData.storagePath) {
      const storage = getStorageInstance();
      const bucket = storage.bucket();
      const file = bucket.file(backupData.storagePath);
      const [buffer] = await file.download();
      const raw = backupData.storageCompressed ? zlib.gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
      const parsed = JSON.parse(raw);
      backupData = {
        ...backupData,
        participantsData: JSON.stringify(parsed.participantsData),
        eventDocument: JSON.stringify(parsed.eventDocument),
        ticketDefinitionsData: JSON.stringify(parsed.ticketDefinitionsData),
        bibAssignmentsData: JSON.stringify(parsed.bibAssignmentsData),
        sponsorsData: JSON.stringify(parsed.sponsorsData),
        inventoryData: parsed.inventoryData ? JSON.stringify(parsed.inventoryData) : null,
      } as BackupRecord;
    }

    if (!backupData.eventDocument) {
      return { success: false, message: "Backup payload missing eventDocument." };
    }
    const eventDocData = JSON.parse(backupData.eventDocument as string);
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
