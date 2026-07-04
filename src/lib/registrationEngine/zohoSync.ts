// src/lib/registrationEngine/zohoSync.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { syncPaymentToZohoAction } from '@/lib/actions/invoiceActions';
import type { RegistrationAttempt } from '@/lib/types';
import { createStripeInvoiceForRegistration } from './stripeSync';

const isUSA = (value?: string | null) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'usa' || v === 'us' || v === 'united states' || v === 'united states of america';
};

const isIndia = (value?: string | null) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'india' || v === 'in' || v === 'bharat';
};

const isInternational = (value?: string | null) => {
  const v = String(value || '').trim();
  if (!v) return false;
  return !isIndia(v);
};

/**
 * Triggers appropriate invoice synchronization for a completed order.
 * Routes to Stripe for USD/USA events, Zoho for INR/India events.
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

      // Policy: USD payments or USA events should use Stripe invoice (not Zoho).
      const participantSnap = await db.collection('events').doc(eventId).collection('participants').doc(participantId).get();
      const eventSnap = await db.collection('events').doc(eventId).get();

      const participant = participantSnap.exists ? (participantSnap.data() as any) : null;
      const eventData = eventSnap.exists ? (eventSnap.data() as any) : null;

      if (participant?.zohoSynced === true) {
        console.log(`[${actionName}] ✅ Invoice sync already completed for participant ${participantId}. Skipping.`);
        return;
      }

      console.log(`[${actionName}] Participant data:`, JSON.stringify({
        zohoSynced: participant?.zohoSynced,
        invoiceId: participant?.invoiceId,
        currency: participant?.pricingBreakdown?.currency,
        country: participant?.country
      }, null, 2));

      const paymentCurrency = String(participant?.pricingBreakdown?.currency || '').toUpperCase();
      
      // Default to INR/Zoho if currency is not explicitly set
      // Only use Stripe if currency is explicitly USD or region is explicitly USA/International
      const isExplicitlyUSD = paymentCurrency === 'USD';
      const isExplicitlyNonINR = paymentCurrency && paymentCurrency !== 'INR' && paymentCurrency !== '';
      const useStripeInvoice =
        (isExplicitlyUSD || isExplicitlyNonINR) || (
          paymentCurrency === '' && (
            isUSA(eventData?.country) ||
            isUSA(participant?.country) ||
            isInternational(eventData?.country) ||
            isInternational(participant?.country)
          )
        );

      console.log(`[${actionName}] 🔍 Routing Decision:`);
      console.log(`[${actionName}] - PaymentCurrency: "${paymentCurrency}"`);
      console.log(`[${actionName}] - IsExplicitlyUSD: ${isExplicitlyUSD}`);
      console.log(`[${actionName}] - IsExplicitlyNonINR: ${isExplicitlyNonINR}`);
      console.log(`[${actionName}] - EventCountry: ${eventData?.country}`);
      console.log(`[${actionName}] - ParticipantCountry: ${participant?.country}`);
      console.log(`[${actionName}] - UseStripeInvoice: ${useStripeInvoice}`);

      if (useStripeInvoice) {
        console.log(`[${actionName}] 📊 Routing to Stripe invoice for registration attempt ${orderId}`);
        await createStripeInvoiceForRegistration(eventId, participantId);
        console.log(`[${actionName}] ✅ Stripe invoice flow completed for registration attempt ${orderId}.`);
        return;
      }

      console.log(`[${actionName}] 🚀 Routing to Zoho invoice sync for registration attempt ${orderId}`);
      await syncPaymentToZohoAction(eventId, participantId);
      console.log(`[${actionName}] ✅ Zoho sync triggered for registration attempt ${orderId}.`);
  
    } catch (error: any) {
      console.error(`[${actionName}] Uncaught error triggering Zoho sync for attempt ${orderId}:`, error.message);
    }
  }


