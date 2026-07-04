import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { finalizeRegistration } from '@/lib/registrationEngine/finalizeRegistration';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

/**
 * Fallback endpoint to check Stripe session status and finalize registration
 * Called from the dashboard when user returns from Stripe Checkout
 */
export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    console.log(`[Stripe Finalize] Checking session: ${sessionId}`);

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log(`[Stripe Finalize] Session payment_status: ${session.payment_status}`);

    // Check if payment was successful
    if (session.payment_status !== 'paid') {
      console.log(`[Stripe Finalize] Payment not yet captured`);
      return NextResponse.json(
        { success: false, message: `Payment status: ${session.payment_status}` },
        { status: 202 }
      );
    }

    // Get the PaymentIntent to access metadata
    if (!session.payment_intent) {
      console.error(`[Stripe Finalize] PaymentIntent not available`);
      return NextResponse.json(
        { error: 'PaymentIntent not available' },
        { status: 400 }
      );
    }

    const paymentIntent = typeof session.payment_intent === 'string'
      ? await stripe.paymentIntents.retrieve(session.payment_intent)
      : session.payment_intent as Stripe.PaymentIntent;
    const registrationAttemptId = paymentIntent.metadata?.registrationAttemptId;

    if (!registrationAttemptId) {
      console.error(`[Stripe Finalize] registrationAttemptId not found`);
      return NextResponse.json(
        { error: 'Registration ID not found in payment metadata' },
        { status: 400 }
      );
    }

    console.log(`[Stripe Finalize] Found registration attempt: ${registrationAttemptId}`);

    // Ensure attempt has Stripe transaction details even when webhook is delayed/missed.
    // IMPORTANT: never downgrade Completed -> PaymentCaptured on repeated polling.
    try {
      const db = getFirestoreInstance();
      const attemptRef = db.collection('registrationAttempts').doc(registrationAttemptId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(attemptRef);
        const current = snap.exists ? (snap.data() as any) : null;
        const isCompleted = String(current?.status || '') === 'Completed';

        if (isCompleted) {
          tx.set(attemptRef, {
            transactionId: paymentIntent.id,
            specificPaymentMethod: 'Stripe',
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          return;
        }

        tx.set(attemptRef, {
          transactionId: paymentIntent.id,
          specificPaymentMethod: 'Stripe',
          status: 'PaymentCaptured',
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    } catch (e: any) {
      console.warn(`[Stripe Finalize] Failed to persist PaymentCaptured state: ${e?.message || e}`);
    }

    // Finalize the registration
    const finalizeResult = await finalizeRegistration(registrationAttemptId, 'api.stripe.finalize-registration');
    console.log(`[Stripe Finalize] Finalization result:`, finalizeResult);

    if (finalizeResult.success && finalizeResult.participantId) {
      // Notifications and Zoho sync are fired inside finalizeRegistration
      // (only on first-time finalization, not on repeat calls).
      return NextResponse.json({
        success: true,
        message: finalizeResult.message === 'Finalized' ? 'Registration completed successfully' : 'Already finalized.',
        participantId: finalizeResult.participantId,
        bookingId: finalizeResult.bookingId || undefined
      });
    } else {
      console.error(`[Stripe Finalize] Finalization failed: ${finalizeResult.message}`);
      return NextResponse.json(
        { error: finalizeResult.message },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error(`[Stripe Finalize] Error: ${error.message}`);
    return NextResponse.json(
      { error: `Failed to check payment status: ${error.message}` },
      { status: 500 }
    );
  }
}
