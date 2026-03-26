
// src/lib/actions/backupActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { BackupRecord, EventParticipant } from '@/lib/types';
import { serializeParticipantDataUtil, toIsoStringSafe } from '@/lib/utils';

const BACKUPS_COLLECTION = 'eventBackups'; // Use a top-level collection

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
    const eventName = eventSnap.data()?.eventName || 'Unknown Event';

    const participantsRef = eventRef.collection('participants');
    const participantsSnapshot = await participantsRef.get();

    const participantsData: EventParticipant[] = participantsSnapshot.docs.map(doc => serializeParticipantDataUtil(doc));
    
    const participantsDataString = JSON.stringify(participantsData);

    const backupPayload = {
      eventId,
      eventName, // Store event name for easier identification
      createdAt: FieldValue.serverTimestamp(),
      participantCount: participantsData.length,
      participantsData: participantsDataString,
    };

    const newBackupRef = await adminDb.collection(BACKUPS_COLLECTION).add(backupPayload);

    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Backup created successfully.', backupId: newBackupRef.id };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getBackupsForEventAction(
  eventId: string
): Promise<{ success: boolean; message: string; backups?: BackupRecord[] }> {
  const actionName = 'getBackupsForEventAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }

  try {
    const adminDb = getFirestoreInstance();
    const snapshot = await adminDb.collection(BACKUPS_COLLECTION)
      .where('eventId', '==', eventId)
      .orderBy('createdAt', 'desc')
      .get();

    if (snapshot.empty) {
      return { success: true, message: 'No backups found for this event.', backups: [] };
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
