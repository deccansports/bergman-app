
// src/lib/actions/registrationStatusActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { RegistrationAttempt } from '@/lib/types';
import { serializeValue } from '@/lib/utils';

export async function getRegistrationStatusAction(
  orderId: string
): Promise<{ success: boolean; status: 'Completed' | 'Pending' | 'Failed'; message: string; bookingId?: string | null }> {
  const actionName = 'getRegistrationStatusAction';
  try {
    const adminDb = getFirestoreInstance();
    
    // Query by razorpayOrderId instead of assuming the doc ID is the orderId
    const attemptsQuery = adminDb.collection('registrationAttempts').where('razorpayOrderId', '==', orderId).limit(1);
    const attemptsSnapshot = await attemptsQuery.get();

    if (attemptsSnapshot.empty) {
      // It's possible the webhook hasn't created the log yet, so this is a "Pending" state, not a hard "Failed".
      return { success: true, status: 'Pending', message: 'Registration attempt not yet found. Processing...' };
    }
    
    const attemptDoc = attemptsSnapshot.docs[0];
    const attemptData = attemptDoc.data() as RegistrationAttempt;

    if (attemptData.status === 'Completed') {
      return {
        success: true,
        status: 'Completed',
        message: 'Registration is complete.',
        bookingId: attemptData.bookingId,
      };
    }

    if (attemptData.status === 'RegistrationFailed') {
      return {
        success: false,
        status: 'Failed',
        message: attemptData.lastError || 'Registration processing failed.',
      };
    }

    // Any other status ('PaymentInitiated', 'PaymentCaptured') is considered pending from the user's POV
    return { success: true, status: 'Pending', message: 'Registration is still being processed.' };

  } catch (e: any) {
    console.error(`[${actionName}] Error fetching status for order ${orderId}:`, e);
     if (e.code === 'FAILED_PRECONDITION') {
        return { success: false, status: 'Failed', message: 'Database query failed. An index might be required on `razorpayOrderId`.' };
    }
    return { success: false, status: 'Failed', message: `Server error: ${e.message}` };
  }
}
