// src/lib/registrationEngine/zohoSync.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { syncPaymentToZohoAction } from '@/lib/actions/invoiceActions';
import type { RegistrationAttempt } from '@/lib/types';

/**
 * Triggers Zoho synchronization for a completed order.
 * This is a non-blocking, fire-and-forget operation.
 */
export async function syncRegistrationToZoho(orderId: string): Promise<void> {
    const actionName = 'syncRegistrationToZoho';
  
    try {
      const db = getFirestoreInstance();
  
      const attemptRef = db.collection('registrationAttempts').doc(orderId);
      const attemptSnap = await attemptRef.get();
  
      if (!attemptSnap.exists) {
        console.error(`[${actionName}] Registration Attempt document not found for ID ${orderId}.`);
        return;
      }
  
      const attemptData = attemptSnap.data() as RegistrationAttempt;
  
      const { eventId, participantId } = attemptData;
  
      if (!eventId || !participantId) {
        console.error(`[${actionName}] Event ID or Participant ID missing for attempt ${orderId}.`);
        return;
      }
  
      await syncPaymentToZohoAction(eventId, participantId);
  
      console.log(`[${actionName}] Zoho sync triggered for registration attempt ${orderId}.`);
  
    } catch (error: any) {
      console.error(`[${actionName}] Uncaught error triggering Zoho sync for attempt ${orderId}:`, error.message);
    }
  }
