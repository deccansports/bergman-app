'use server';

import Stripe from 'stripe';
import { finalizeRegistration } from '@/lib/registrationEngine/finalizeRegistration';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

/**
 * Fallback: Check Stripe session status and finalize registration if payment succeeded
 * This is called from the dashboard when user returns from Stripe Checkout
 */
export async function checkAndFinalizeStripePaymentAction(
  sessionId: string
): Promise<{ success: boolean; message: string; participantId?: string; bookingId?: string }> {
  const actionName = 'checkAndFinalizeStripePaymentAction';

  try {
    console.log(`[${actionName}] Checking Stripe session: ${sessionId}`);

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log(`[${actionName}] Session status: ${session.payment_status}`);

    // Check if payment was successful
    if (session.payment_status !== 'paid') {
      console.log(`[${actionName}] Payment not yet captured (status: ${session.payment_status})`);
      return { success: false, message: `Payment status: ${session.payment_status}` };
    }

    // Get the PaymentIntent to access metadata
    if (!session.payment_intent) {
      console.error(`[${actionName}] PaymentIntent not available in session`);
      return { success: false, message: 'PaymentIntent not available' };
    }

    const paymentIntent = typeof session.payment_intent === 'string'
      ? await stripe.paymentIntents.retrieve(session.payment_intent)
      : session.payment_intent as Stripe.PaymentIntent;
    const registrationAttemptId = paymentIntent.metadata?.registrationAttemptId;

    if (!registrationAttemptId) {
      console.error(`[${actionName}] registrationAttemptId not found in metadata`);
      return { success: false, message: 'Registration ID not found in payment metadata' };
    }

    console.log(`[${actionName}] Found registration attempt: ${registrationAttemptId}`);

    // Finalize the registration
    const finalizeResult = await finalizeRegistration(registrationAttemptId, 'actions.stripeCheckout.finalize');
    console.log(`[${actionName}] Finalization result:`, finalizeResult);

    if (finalizeResult.success && finalizeResult.participantId) {
      // Notifications and Zoho sync are handled inside finalizeRegistration
      // (only on first-time finalization, guarded by message === 'Finalized').
      return {
        success: true,
        message: 'Registration completed successfully',
        participantId: finalizeResult.participantId,
        bookingId: finalizeResult.bookingId || undefined
      };
    } else {
      console.error(`[${actionName}] Finalization failed: ${finalizeResult.message}`);
      return { success: false, message: finalizeResult.message };
    }

  } catch (error: any) {
    console.error(`[${actionName}] Error: ${error.message}`);
    return { success: false, message: `Failed to check payment status: ${error.message}` };
  }
}
