
// src/lib/actions/loopActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { LoopLog, EventParticipant } from '@/lib/types';
import { toIsoStringSafe, serializeParticipantData } from '@/lib/utils';

export async function recordLoopAction(input: {
  eventId: string;
  bibNumber: string;
  segment: 'SWIM' | 'BIKE' | 'RUN';
  volunteerId: string;
  volunteerName: string;
  increment: boolean;
}): Promise<{ success: boolean; message: string; participant?: EventParticipant; }> {
  const actionName = 'recordLoopAction';
  const { eventId, bibNumber, segment, volunteerId, volunteerName, increment } = input;
  try {
    const adminDb = getFirestoreInstance();
    const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');
    const snapshot = await participantsRef.where('bibNumber', '==', bibNumber).limit(1).get();

    if (snapshot.empty) {
      return { success: false, message: `Participant with BIB ${bibNumber} not found.` };
    }

    const participantDoc = snapshot.docs[0];
    const participantRef = participantDoc.ref;
    
    let loopField: 'swimLoopsCompleted' | 'bikeLoopsCompleted' | 'runLoopsCompleted';
    switch (segment) {
      case 'SWIM': loopField = 'swimLoopsCompleted'; break;
      case 'BIKE': loopField = 'bikeLoopsCompleted'; break;
      case 'RUN': loopField = 'runLoopsCompleted'; break;
      default: return { success: false, message: 'Invalid segment.' };
    }

    await adminDb.runTransaction(async (transaction) => {
      const pDoc = await transaction.get(participantRef);
      if (!pDoc.exists) throw new Error('Participant not found during transaction.');
      const currentLoops = pDoc.data()?.[loopField] || 0;
      const newLoopCount = increment ? currentLoops + 1 : Math.max(0, currentLoops - 1);
      
      transaction.update(participantRef, { [loopField]: newLoopCount, updatedAt: FieldValue.serverTimestamp() });

      const logRef = participantRef.collection('loopLogs').doc();
      transaction.set(logRef, {
        eventId, bibNumber, segment,
        timestamp: FieldValue.serverTimestamp(),
        loopNumber: newLoopCount,
        action: increment ? 'increment' : 'decrement',
        volunteerId, volunteerName,
      });
    });

    const updatedParticipantDoc = await participantRef.get();
    const updatedParticipant = serializeParticipantData(updatedParticipantDoc);
    
    revalidatePath('/volunteer/dashboard');
    revalidatePath('/admin/dashboard');

    return { success: true, message: `Loop count updated to ${updatedParticipant[loopField]}.`, participant: updatedParticipant };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getLoopLogsForEventAction(
  eventId: string
): Promise<{ success: boolean; message: string; logs?: LoopLog[] }> {
  const actionName = 'getLoopLogsForEventAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const logsSnapshot = await adminDb.collectionGroup('loopLogs')
      .where('eventId', '==', eventId)
      .orderBy('timestamp', 'desc')
      .get();
      
    if (logsSnapshot.empty) {
      return { success: true, message: "No loop logs found.", logs: [] };
    }
    
    const logs = logsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        timestamp: toIsoStringSafe(data.timestamp)!,
      } as LoopLog;
    });

    return { success: true, message: 'Logs fetched.', logs };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}


export async function deleteLoopLogsForEventAction(eventId: string): Promise<{ success: boolean; message: string }> {
  const actionName = 'deleteLoopLogsForEventAction';
  try {
    const adminDb = getFirestoreInstance();
    // Delete from collection group
    const logsSnapshot = await adminDb.collectionGroup('loopLogs').where('eventId', '==', eventId).get();
    if (logsSnapshot.empty) return { success: true, message: "No logs to delete." };

    const batch = adminDb.batch();
    logsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // Reset counts on participants
    const participantsSnapshot = await adminDb.collection('events').doc(eventId).collection('participants').get();
    const participantBatch = adminDb.batch();
    participantsSnapshot.docs.forEach(doc => {
        participantBatch.update(doc.ref, {
            swimLoopsCompleted: FieldValue.delete(),
            bikeLoopsCompleted: FieldValue.delete(),
            runLoopsCompleted: FieldValue.delete(),
        });
    });
    await participantBatch.commit();
    
    revalidatePath('/admin/dashboard');
    return { success: true, message: `All loop logs and counts for the event have been reset.` };
  } catch (e: any) {
    return { success: false, message: `Failed to reset logs: ${e.message}` };
  }
}

export async function deleteAthleteLoopLogsAction(eventId: string, bibNumber: string): Promise<{ success: boolean; message: string }> {
  const actionName = 'deleteAthleteLoopLogsAction';
  try {
    const adminDb = getFirestoreInstance();
    const participantsSnapshot = await adminDb.collection('events').doc(eventId).collection('participants').where('bibNumber', '==', bibNumber).get();
    if (participantsSnapshot.empty) return { success: false, message: `Participant with BIB ${bibNumber} not found.` };
    
    const participantDoc = participantsSnapshot.docs[0];
    
    // Delete subcollection logs
    const logsSnapshot = await participantDoc.ref.collection('loopLogs').get();
    const batch = adminDb.batch();
    logsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    
    // Reset counts on the main participant doc
    batch.update(participantDoc.ref, {
        swimLoopsCompleted: FieldValue.delete(),
        bikeLoopsCompleted: FieldValue.delete(),
        runLoopsCompleted: FieldValue.delete(),
    });
    
    await batch.commit();
    
    revalidatePath('/admin/dashboard');
    return { success: true, message: `Loop logs for BIB ${bibNumber} have been reset.` };
  } catch (e: any) {
    return { success: false, message: `Failed to reset logs: ${e.message}` };
  }
}
