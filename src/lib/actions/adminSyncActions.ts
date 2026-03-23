// src/lib/actions/adminSyncActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { _mirrorParticipantToKV } from './dataSyncActions';
import { serializeParticipantData } from '../utils';

export async function forceResyncRegistrationAction(
  registrationAttemptId: string
): Promise<{ success: boolean; message: string }> {
  const actionName = 'forceResyncRegistrationAction';
  try {
    const db = getFirestoreInstance();

    const attemptSnap = await db
      .collection('registrationAttempts')
      .doc(registrationAttemptId)
      .get();

    if (!attemptSnap.exists) {
      return { success: false, message: 'Registration attempt not found.' };
    }

    const attempt = attemptSnap.data();

    if (!attempt?.eventId || !attempt?.participantId) {
      return {
        success: false,
        message: 'Attempt document is missing eventId or participantId. Cannot sync.',
      };
    }

    const participantSnap = await db
      .collection('events')
      .doc(attempt.eventId)
      .collection('participants')
      .doc(attempt.participantId)
      .get();

    if (!participantSnap.exists) {
      return {
        success: false,
        message: 'Participant document not found in Firestore, though attempt exists. This indicates a registration failure.',
      };
    }

    const participantData = serializeParticipantData(participantSnap);

    // This function now handles both individual and aggregated list updates in KV
    await _mirrorParticipantToKV(participantData);

    return { success: true, message: 'Registration has been successfully re-synced to the KV cache.' };
  } catch (error: any) {
    console.error(`[${actionName}] Error:`, error);
    return { success: false, message: `Resync failed: ${error.message}` };
  }
}
