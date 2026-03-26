// src/app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { finalizeRegistration } from '@/lib/registrationEngine/finalizeRegistration';
import { sendRegistrationNotifications } from '@/lib/registrationEngine/registrationNotifications';
import { syncRegistrationToZoho } from '@/lib/registrationEngine/zohoSync';
import type { Order, RegistrationAttempt } from '@/lib/types';


const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

export async function POST(req: NextRequest) {
  const buf = await req.text();
  const sig = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error verifying signature: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  // Handle the event
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const registrationAttemptId = paymentIntent.metadata?.registrationAttemptId;
    const paymentId = paymentIntent.id;

    if (!registrationAttemptId) {
      console.error(`[Stripe Webhook] Critical: registrationAttemptId missing from metadata for PaymentIntent ${paymentId}.`);
      return NextResponse.json({ received: true, message: "Missing order ID in metadata." });
    }

    const db = getFirestoreInstance();
    const attemptRef = db.collection('registrationAttempts').doc(registrationAttemptId);

    try {
        const attemptSnap = await attemptRef.get();
        if (!attemptSnap.exists) {
            throw new Error(`Registration attempt ${registrationAttemptId} not found in Firestore.`);
        }
        const registrationData = attemptSnap.data() as RegistrationAttempt;
        if (registrationData.status === 'Completed') {
            console.log(`[Stripe Webhook] Registration attempt ${registrationAttemptId} already completed.`);
            return NextResponse.json({ received: true, message: 'Registration already handled.' });
        }
        
        await attemptRef.update({
            status: 'Payment Initiated',
            transactionId: paymentId,
            updatedAt: FieldValue.serverTimestamp()
        });

        // Finalize the registration transactionally
        const finalizeResult = await finalizeRegistration(registrationAttemptId);

        if (finalizeResult.success && finalizeResult.participantId) {
            console.log(`[Stripe Webhook] Registration finalized for attempt ${registrationAttemptId}, participant ${finalizeResult.participantId}`);
            // Fire-and-forget side effects
            sendRegistrationNotifications(registrationAttemptId).catch(e => console.error(`[Side Effect Error] Failed to send notifications for attempt ${registrationAttemptId}:`, e));
            syncRegistrationToZoho(registrationAttemptId).catch(e => console.error(`[Side Effect Error] Failed to sync Zoho for attempt ${registrationAttemptId}:`, e));
        } else {
            // The error is already logged inside finalizeRegistration
            throw new Error(finalizeResult.message || `Finalization failed for attempt ${registrationAttemptId}.`);
        }

    } catch (err: any) {
        console.error(`[Stripe Webhook] Error processing payment_intent.succeeded for attempt ${registrationAttemptId}: ${err.message}`);
        await attemptRef.set({ status: 'Payment Failed', lastError: err.message, updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(e => console.error(`[Stripe Webhook] Failed to mark attempt ${registrationAttemptId} as Failed:`, e));
        return NextResponse.json({ error: `Webhook handler failed: ${err.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
