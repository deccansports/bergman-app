// src/app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { finalizeRegistration } from '@/lib/registrationEngine/finalizeRegistration';
import type { Order, RegistrationAttempt } from '@/lib/types';


const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const actionName = '[Stripe Webhook]';
  const db = getFirestoreInstance();
  const buf = await req.text();
  const sig = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;
  let webhookId = `stripe_evt_${Date.now()}`;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    webhookId = event.id;
  } catch (err: any) {
    console.error(`${actionName} Error verifying signature: ${err.message}`);
    await db.collection('webhookLogs').doc(webhookId).set({
      source: 'stripe',
      event: 'signature_verification_failed',
      status: 'SIGNATURE_MISMATCH',
      error: err.message,
      receivedAt: FieldValue.serverTimestamp(),
      processedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  const logRef = db.collection('webhookLogs').doc(webhookId);

  // Handle the event
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const paymentId = paymentIntent.id;
    const paymentType = paymentIntent.metadata?.paymentType || 'event_registration';

    console.log(`${actionName} Processing ${event.type}: paymentId=${paymentId}, paymentType=${paymentType}, metadata=${JSON.stringify(paymentIntent.metadata)}`);

    await logRef.set({
      source: 'stripe',
      event: event.type,
      stripePaymentIntentId: paymentId,
      status: 'RECEIVED',
      detail: `paymentType=${paymentType}`,
      receivedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (paymentType === 'deferral_fee') {
      const firestoreDocId = paymentIntent.metadata?.firestoreDocId;
      const eventId = paymentIntent.metadata?.eventId;
      const participantId = paymentIntent.metadata?.participantId;
      const totalAmountToChargePaisa = Number(paymentIntent.metadata?.totalAmountToChargePaisa || 0);

      if (!firestoreDocId || !eventId || !participantId) {
        console.error(`[Stripe Webhook] Critical: deferral metadata missing for PaymentIntent ${paymentId}.`);
        return NextResponse.json({ received: true, message: 'Missing deferral metadata.' });
      }

      const attemptRef = db.collection('deferralFeeAttempts').doc(firestoreDocId);

      try {
        const attemptSnap = await attemptRef.get();
        if (attemptSnap.exists && attemptSnap.data()?.status === 'Completed') {
          return NextResponse.json({ received: true, message: 'Deferral already handled.' });
        }

        await attemptRef.set({
          status: 'Completed',
          paymentId,
          transactionId: paymentId,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        const { handleDeferral } = await import('@/lib/actions/deferralActions');
        const result = await handleDeferral(eventId, participantId, paymentId, totalAmountToChargePaisa);
        if (!result.success) {
          throw new Error(result.message || 'Deferral finalization failed.');
        }

        await logRef.set({
          status: 'PROCESSED',
          detail: 'Deferral payment finalized',
          processedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        return NextResponse.json({ received: true, message: 'Deferral handled.' });
      } catch (err: any) {
        console.error(`${actionName} Error processing deferral payment ${paymentId}: ${err.message}`);
        await attemptRef.set({ status: 'Failed', lastError: err.message, updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
        await logRef.set({
          status: 'FAILED',
          error: err.message,
          processedAt: FieldValue.serverTimestamp(),
        }, { merge: true }).catch(() => {});
        return NextResponse.json({ error: `Webhook handler failed: ${err.message}` }, { status: 500 });
      }
    }

    if (paymentType === 'category_change') {
      const firestoreDocId = paymentIntent.metadata?.firestoreDocId;

      if (!firestoreDocId) {
        console.error(`[Stripe Webhook] Critical: category change metadata missing for PaymentIntent ${paymentId}.`);
        return NextResponse.json({ received: true, message: 'Missing category change metadata.' });
      }

      const attemptRef = db.collection('categoryChangeAttempts').doc(firestoreDocId);

      try {
        const attemptSnap = await attemptRef.get();
        if (attemptSnap.exists && attemptSnap.data()?.status === 'Completed') {
          return NextResponse.json({ received: true, message: 'Category change already handled.' });
        }

        await attemptRef.set({
          status: 'Completed',
          transactionId: paymentId,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        const { processCategoryChangeFinal } = await import('@/lib/actions/categoryActions');
        const result = await processCategoryChangeFinal({
          originalEventId: paymentIntent.metadata?.originalEventId,
          participantId: paymentIntent.metadata?.originalParticipantId,
          newTicketId: paymentIntent.metadata?.newTicketId,
          newSubCategoryId: paymentIntent.metadata?.newSubCategoryId || null,
          newTicketName: paymentIntent.metadata?.newTicketName,
          paymentId,
          athleteUid: paymentIntent.metadata?.athleteUid,
          athleteName: paymentIntent.metadata?.athleteName,
          athleteEmail: paymentIntent.metadata?.athleteEmail,
          totalAmountToChargePaisa: Number(paymentIntent.metadata?.totalAmountToChargePaisa || 0),
        });

        if (!result.success) {
          throw new Error(result.message || 'Category change finalization failed.');
        }

        await logRef.set({
          status: 'PROCESSED',
          detail: 'Category change finalized',
          processedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        return NextResponse.json({ received: true, message: 'Category change handled.' });
      } catch (err: any) {
        console.error(`${actionName} Error processing category change payment ${paymentId}: ${err.message}`);
        await attemptRef.set({ status: 'Failed', lastError: err.message, updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
        await logRef.set({
          status: 'FAILED',
          error: err.message,
          processedAt: FieldValue.serverTimestamp(),
        }, { merge: true }).catch(() => {});
        return NextResponse.json({ error: `Webhook handler failed: ${err.message}` }, { status: 500 });
      }
    }

    const registrationAttemptId = paymentIntent.metadata?.registrationAttemptId;

    if (!registrationAttemptId) {
      console.error(`${actionName} Critical: registrationAttemptId missing from metadata for PaymentIntent ${paymentId}. Full metadata: ${JSON.stringify(paymentIntent.metadata)}`);
      await logRef.set({
        status: 'FAILED',
        error: 'Missing registrationAttemptId in metadata',
        processedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => {});
      return NextResponse.json({ received: true, message: "Missing order ID in metadata." });
    }

    console.log(`${actionName} Processing registration payment: attemptId=${registrationAttemptId}`);

    const attemptRef = db.collection('registrationAttempts').doc(registrationAttemptId);

    try {
        const attemptSnap = await attemptRef.get();
        if (!attemptSnap.exists) {
          console.error(`${actionName} ❌ Registration attempt ${registrationAttemptId} not found in Firestore.`);
            throw new Error(`Registration attempt ${registrationAttemptId} not found in Firestore.`);
        }
        const registrationData = attemptSnap.data() as RegistrationAttempt;
        console.log(`${actionName} ✅ Found registration attempt with status: ${registrationData.status}`);
        
        // Prevent duplicate processing
        if (registrationData.status === 'Completed' || registrationData.status === 'PaymentCaptured') {
          console.log(`${actionName} ⚠️ Registration attempt ${registrationAttemptId} already processed (status: ${registrationData.status}).`);
          await logRef.set({
            status: 'SKIPPED_DUPLICATE',
            detail: `Already processed (${registrationData.status})`,
            processedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
            return NextResponse.json({ received: true, message: 'Registration already handled.' });
        }
        
        await attemptRef.update({
            status: 'PaymentCaptured',
            transactionId: paymentId,
            updatedAt: FieldValue.serverTimestamp()
        });
        console.log(`${actionName} ✅ Updated attempt status to PaymentCaptured`);

        // Finalize the registration transactionally
        const finalizeResult = await finalizeRegistration(registrationAttemptId, 'api.webhooks.stripe');
        console.log(`${actionName} Finalization result:`, finalizeResult);

        if (finalizeResult.success && finalizeResult.participantId) {
            console.log(`${actionName} ✅ Registration finalized for attempt ${registrationAttemptId}, participant ${finalizeResult.participantId}`);
            await logRef.set({
              status: 'PROCESSED',
              participantId: finalizeResult.participantId,
              processedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        } else {
            // The error is already logged inside finalizeRegistration
            console.error(`${actionName} ❌ Finalization failed: ${finalizeResult.message}`);
            throw new Error(finalizeResult.message || `Finalization failed for attempt ${registrationAttemptId}.`);
        }

    } catch (err: any) {
        console.error(`${actionName} ❌ Error processing payment_intent.succeeded for attempt ${registrationAttemptId}: ${err.message}`);
        await attemptRef.set({ status: 'Payment Failed', lastError: err.message, updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(e => console.error(`[Stripe Webhook] Failed to mark attempt ${registrationAttemptId} as Failed:`, e));
        await logRef.set({
          status: 'FAILED',
          error: err.message,
          processedAt: FieldValue.serverTimestamp(),
        }, { merge: true }).catch(() => {});
        return NextResponse.json({ error: `Webhook handler failed: ${err.message}` }, { status: 500 });
    }
  } else {
    await logRef.set({
      source: 'stripe',
      event: event.type,
      status: 'IGNORED',
      detail: 'Event type not handled by this webhook route',
      receivedAt: FieldValue.serverTimestamp(),
      processedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }

  return NextResponse.json({ received: true });
}
