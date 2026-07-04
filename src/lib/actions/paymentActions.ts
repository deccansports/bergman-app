
'use server';

import Razorpay from 'razorpay';
import crypto from 'crypto';
import Stripe from 'stripe';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { RegistrationAttempt, PaymentRecord, TicketDefinition } from '@/lib/types';
import type { RelayTeamRegistrationFormInput, RelaySharedLegs } from '@/lib/types';
import { handleDeferral } from './deferralActions';
import { processCategoryChangeFinal } from './categoryActions';
import { getEventRegistrationButtonState, isTicketSaleOpen } from '@/lib/utils';
import { createRelayTeamRegistrationAction } from './relayRegistrationActions';
import { finalizeRegistration } from '@/lib/registrationEngine/finalizeRegistration';
import { validateWaitlistCodeForRegistrationAction } from './waitlistActions';

const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;

let razorpayInstance: Razorpay | null = null;
if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  try {
    razorpayInstance = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
  } catch(e) {
    console.error("Failed to initialize Razorpay instance:", e);
    razorpayInstance = null;
  }
}

let stripeInstance: Stripe | null = null;
if (STRIPE_SECRET_KEY) {
    stripeInstance = new Stripe(STRIPE_SECRET_KEY);
}

export async function refundPaymentAction(
  paymentId: string,
  amountPaisa?: number
): Promise<{ success: boolean; message: string; refundId?: string; status?: string; refundRrn?: string }> {
  if (!razorpayInstance) return { success: false, message: "Payment gateway not configured for refunds." };

  try {
    const refundPayload: Record<string, any> = {};
    if (typeof amountPaisa === 'number' && Number.isFinite(amountPaisa) && amountPaisa > 0) {
      refundPayload.amount = Math.round(amountPaisa);
    }
    const refund = await razorpayInstance.payments.refund(paymentId, refundPayload);
    
    if (refund && (refund.status === 'processed' || refund.status === 'pending')) {
      const amountText = refundPayload.amount ? `₹${(refundPayload.amount / 100).toFixed(2)}` : 'full amount';
      return {
        success: true,
        message: `Successfully initiated ${amountText} refund for payment ${paymentId}.`,
        refundId: (refund as any)?.id,
        status: (refund as any)?.status,
        refundRrn:
          (refund as any)?.acquirer_data?.rrn ||
          (refund as any)?.acquirer_data?.arn ||
          (refund as any)?.rrn ||
          (refund as any)?.arn ||
          undefined,
      };
    } else {
      return { success: false, message: `Refund initiation failed. Status: ${refund?.status}`, status: refund?.status };
    }
  } catch (e: any) {
    return { success: false, message: `Refund failed: ${e?.error?.description || e.message}` };
  }
}

export async function refundStripePaymentAction(
  paymentId: string,
  amountPaisa?: number
): Promise<{ success: boolean; message: string; refundId?: string; status?: string; refundRrn?: string }> {
  if (!stripeInstance) return { success: false, message: 'Stripe is not configured for refunds.' };

  try {
    const refundPayload: Record<string, any> = {};
    if (typeof amountPaisa === 'number' && Number.isFinite(amountPaisa) && amountPaisa > 0) {
      refundPayload.amount = Math.round(amountPaisa);
    }

    // Support both PaymentIntent IDs (pi_...) and Charge IDs (ch_...)
    if (String(paymentId).startsWith('ch_')) {
      refundPayload.charge = paymentId;
    } else {
      refundPayload.payment_intent = paymentId;
    }

    const refund = await stripeInstance.refunds.create(refundPayload);
    if (refund && (refund.status === 'succeeded' || refund.status === 'pending' || refund.status === 'requires_action')) {
      const amountText = refundPayload.amount ? `$${(refundPayload.amount / 100).toFixed(2)}` : 'full amount';
      return {
        success: true,
        message: `Successfully initiated ${amountText} Stripe refund for payment ${paymentId}.`,
        refundId: refund.id,
        status: refund.status,
        refundRrn:
          (refund as any)?.destination_details?.card?.reference ||
          (typeof (refund as any)?.balance_transaction === 'string' ? (refund as any).balance_transaction : undefined),
      };
    }

    return { success: false, message: `Stripe refund initiation failed. Status: ${refund?.status}`, status: refund?.status as any };
  } catch (e: any) {
    return { success: false, message: `Stripe refund failed: ${e?.raw?.message || e.message}` };
  }
}

export async function createStripeCreditNoteAction(options: {
  invoiceId: string;
  amountPaisa: number;
  refundId?: string | null;
  reason?: 'duplicate' | 'fraudulent' | 'order_change' | 'product_unsatisfactory';
  memo?: string;
}): Promise<{ success: boolean; message: string; creditNoteId?: string; creditNoteNumber?: string; error?: string }> {
  if (!stripeInstance) return { success: false, message: 'Stripe is not configured for credit notes.', error: 'Stripe not configured' };

  try {
    const { invoiceId, amountPaisa, refundId, reason = 'order_change', memo } = options;

    if (!invoiceId) {
      return { success: false, message: 'Invoice ID is required to create a credit note.', error: 'Missing invoice ID' };
    }

    if (amountPaisa <= 0) {
      return { success: false, message: 'Credit note amount must be greater than zero.', error: 'Invalid amount' };
    }

    const amount = Math.round(amountPaisa);
    let creditNote: Stripe.CreditNote;

    // For post-payment invoices, Stripe requires post-payment amount to be matched by
    // refunds and/or out_of_band_amount.
    if (refundId) {
      try {
        creditNote = await stripeInstance.creditNotes.create({
          invoice: invoiceId,
          amount,
          reason,
          memo,
          refunds: [{ refund: refundId, amount_refunded: amount }],
        } as any);
      } catch (e1: any) {
        try {
          // Fallback: link refund without explicit amount_refunded
          creditNote = await stripeInstance.creditNotes.create({
            invoice: invoiceId,
            amount,
            reason,
            memo,
            refunds: [{ refund: refundId }],
          } as any);
        } catch (e2: any) {
          // Final fallback: account adjustment without refund linkage
          creditNote = await stripeInstance.creditNotes.create({
            invoice: invoiceId,
            amount,
            reason,
            memo,
            out_of_band_amount: amount,
          } as any);
        }
      }
    } else {
      creditNote = await stripeInstance.creditNotes.create({
        invoice: invoiceId,
        amount,
        reason,
        memo,
        out_of_band_amount: amount,
      } as any);
    }

    if (creditNote && creditNote.id) {
      const amountText = `$${(amountPaisa / 100).toFixed(2)}`;
      return {
        success: true,
        message: `Successfully created Stripe credit note ${creditNote.number} for ${amountText}.`,
        creditNoteId: creditNote.id,
        creditNoteNumber: creditNote.number,
      };
    }

    return {
      success: false,
      message: 'Failed to create Stripe credit note.',
      error: 'Credit note creation returned no ID',
    };
  } catch (e: any) {
    return {
      success: false,
      message: `Stripe credit note creation failed: ${e?.raw?.message || e.message}`,
      error: e?.raw?.message || e.message,
    };
  }
}

interface CreateDeferralFeeOrderInput {
  eventId: string;
  participantId: string;
  athleteUid: string;
  athleteEmail: string;
  athleteName: string;
  totalAmountToChargePaisa: number;
  originUrl?: string;
}

function resolveAppBaseUrl(originUrl?: string): string {
  const envBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.APP_URL;

  return (originUrl || envBaseUrl || 'http://localhost:3000').replace(/\/$/, '');
}

async function createStripeCheckoutSession(params: {
  amount: number;
  currency: 'usd';
  customerEmail?: string;
  metadata: Record<string, string>;
  name: string;
  description?: string;
  successUrl: string;
  cancelUrl: string;
}) {
  if (!stripeInstance) {
    throw new Error('Stripe is not configured.');
  }

  const session = await stripeInstance.checkout.sessions.create({
    mode: 'payment',
    customer_email: params.customerEmail,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: params.currency,
          unit_amount: Math.round(params.amount),
          product_data: {
            name: params.name,
            description: params.description,
          },
        },
      },
    ],
    payment_intent_data: {
      receipt_email: params.customerEmail,
      metadata: params.metadata,
    },
    metadata: params.metadata,
  });

  if (!session.url) {
    throw new Error('Failed to create Stripe Checkout session.');
  }

  return session;
}

export async function createDeferralFeeOrderAction(
  input: CreateDeferralFeeOrderInput
): Promise<{ success: boolean; message: string; orderId?: string; amount?: number; currency?: string; keyId?: string; notes?: Record<string, any>; paymentGateway?: 'razorpay' | 'stripe'; checkoutUrl?: string }> {
  
  const { eventId, athleteUid, totalAmountToChargePaisa, originUrl } = input;
  if (totalAmountToChargePaisa < 100) return { success: false, message: "Calculated deferral fee is too low for payment."};
  
  try {
    const adminDb = getFirestoreInstance();
    const eventSnap = await adminDb.collection('events').doc(eventId).get();
    if (!eventSnap.exists) return { success: false, message: "Event not found." };
    const eventData = eventSnap.data() || {};
    const eventName = eventData.eventName || 'Unknown Event';
    const normalizedCurrency = String(eventData.currency || 'INR').toUpperCase();
    const isUsd = normalizedCurrency === 'USD';
    if (normalizedCurrency !== 'USD' && normalizedCurrency !== 'INR') {
      return { success: false, message: `Unsupported event currency: ${eventData.currency}` };
    }

    const deferralAttemptRef = adminDb.collection('deferralFeeAttempts').doc();

    const notes = {
        type: 'deferral_fee',
        firestoreDocId: deferralAttemptRef.id,
        ...input,
        eventName: eventName,
    };

    await deferralAttemptRef.set({
      ...notes,
      status: 'Pending',
      amountPaisa: totalAmountToChargePaisa,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (isUsd) {
      const baseUrl = resolveAppBaseUrl(originUrl);
      const session = await createStripeCheckoutSession({
        amount: totalAmountToChargePaisa,
        currency: 'usd',
        customerEmail: input.athleteEmail,
        name: `Deferral Fee - ${eventName}`,
        description: `Deferral service fee for ${eventName}`,
        successUrl: `${baseUrl}/dashboard?payment=processing&type=deferral&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/dashboard?payment=cancelled&type=deferral`,
        metadata: {
          paymentType: 'deferral_fee',
          firestoreDocId: deferralAttemptRef.id,
          eventId,
          participantId: input.participantId,
          athleteUid: input.athleteUid,
          athleteEmail: input.athleteEmail,
          athleteName: input.athleteName,
          totalAmountToChargePaisa: String(totalAmountToChargePaisa),
          eventName,
        },
      });

      return {
        success: true,
        message: 'Stripe checkout created.',
        orderId: session.id,
        checkoutUrl: session.url || undefined,
        paymentGateway: 'stripe',
      };
    }

    if (!razorpayInstance) return { success: false, message: "Payment gateway not configured." };
    
    const options = {
        amount: Math.round(totalAmountToChargePaisa),
        currency: 'INR',
        receipt: `def_fee_${eventId.slice(-6)}_${athleteUid.slice(-6)}_${Date.now().toString().slice(-6)}`,
        notes,
    };

    const order = await razorpayInstance.orders.create(options);
    if (!order || !order.id) throw new Error('Razorpay order creation failed.');

    await deferralAttemptRef.update({ razorpayOrderId: order.id, updatedAt: FieldValue.serverTimestamp() });

    return { success: true, message: 'Deferral fee order created.', orderId: order.id, amount: Number(order.amount), currency: order.currency, keyId: RAZORPAY_KEY_ID!, notes, paymentGateway: 'razorpay' };
  } catch (e: any) {
    return { success: false, message: `Order creation error: ${e.message}` };
  }
}

interface VerifyDeferralFeePaymentInput {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  eventId: string;
  participantId: string;
  athleteUid: string;
  totalAmountToChargePaisa: number;
}

export async function verifyDeferralFeePaymentAndProcessAction(
  paymentData: VerifyDeferralFeePaymentInput
): Promise<{ success: boolean; message: string; deferralId?: string }> {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, eventId, participantId, athleteUid, totalAmountToChargePaisa } = paymentData;
  if (!RAZORPAY_KEY_SECRET) return { success: false, message: "Payment verification service not configured." };
  
  try {
      const shasum = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET);
      shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
      const expectedSignature = shasum.digest('hex');
      
      if (expectedSignature !== razorpay_signature) {
          return { success: false, message: 'Payment verification failed. Signature mismatch.' };
      }
      
      const adminDb = getFirestoreInstance();
      await adminDb.collection('deferralFeeAttempts').add({
          paymentId: razorpay_payment_id,
          eventId,
          participantId,
          athleteUid,
          status: 'Paid',
          amountPaisa: totalAmountToChargePaisa,
          createdAt: FieldValue.serverTimestamp(),
      });

      // CORE LOGIC: Issued immediately after payment verification.
      return await handleDeferral(eventId, participantId, razorpay_payment_id, totalAmountToChargePaisa);
      
  } catch (e: any) {
    return { success: false, message: `Deferral verification processing failed: ${e.message}` };
  }
}

export async function createEventTicketOrderAction(
  registrationPayload: Partial<RegistrationAttempt>
): Promise<{ success: boolean; message: string; orderId?: string; amount?: number; currency?: string; keyId?: string; notes?: Record<string, string>, paymentGateway?: 'razorpay' | 'stripe'; checkoutUrl?: string }> {
  const { eventId, ticketId, amountPaidPaisa, email } = registrationPayload;
  
  if (!eventId) {
    return { success: false, message: "Event ID is required to create an order." };
  }
  
  const adminDb = getFirestoreInstance();

  const normalizedEmail = String(email || '').toLowerCase().trim();
  if (eventId && normalizedEmail) {
    const guardSnap = await adminDb
      .collection('registrationDeletionGuards')
      .doc(`athlete_${normalizedEmail}_event_${eventId}`)
      .get();
    if (guardSnap.exists) {
      const guard = guardSnap.data() as Record<string, any> | undefined;
      const deletedBy = String(guard?.deletedBy || '').trim().toLowerCase();
      const blockedByAdmin = guard?.manualBlock === true || deletedBy === 'admin-manual';
      if (blockedByAdmin) {
        return {
          success: false,
          message: 'Registration is blocked by admin for this event.',
        };
      }
    }
  }

  try {
    const eventRef = adminDb.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) return { success: false, message: "Event not found." };
    const eventData = eventSnap.data()! as any;

    if (!ticketId) {
      return { success: false, message: 'Ticket ID is required.' };
    }

    const ticketSnap = await eventRef.collection('ticketDefinitions').doc(ticketId).get();
    if (!ticketSnap.exists) {
      return { success: false, message: 'Ticket definition not found.' };
    }

    const ticketData = ticketSnap.data() as TicketDefinition;
    const ticketRegistrationType =
      ticketData.registrationType ||
      (/\brelay\b/i.test(ticketData.ticketName || '') || /\brelay\b/i.test(ticketData.description || '')
        ? 'relay'
        : 'individual');
    if (ticketRegistrationType === 'relay') {
      return {
        success: false,
        message: 'Relay ticket selected. Please use the dedicated relay registration form (Team Name + 3 Participants + Waiver).',
      };
    }

    const isEventSoldOut = getEventRegistrationButtonState(eventData) === 'sold_out';
    const isTicketWindowOpen = isTicketSaleOpen(ticketData.openDate, ticketData.startTime, ticketData.closeDate, ticketData.endTime);
    const isTicketPubliclyClosed = !!ticketData.isSoldOut || !isTicketWindowOpen || isEventSoldOut;

    const waitlistCode = String((registrationPayload as any)?.waitlistCode || '').trim();
    const waitlistCodeEmail = String((registrationPayload as any)?.waitlistCodeEmail || registrationPayload.email || '').trim().toLowerCase();

    if (isTicketPubliclyClosed) {
      if (!waitlistCode) {
        return { success: false, message: 'This ticket is sold out or registration has ended. Please join the waitlist.' };
      }

      const waitlistValidation = await validateWaitlistCodeForRegistrationAction({
        code: waitlistCode,
        email: waitlistCodeEmail,
        eventId,
        ticketId,
      });

      if (!waitlistValidation.success || !waitlistValidation.code) {
        return { success: false, message: waitlistValidation.message || 'Invalid waitlist code for this ticket.' };
      }

      (registrationPayload as any).waitlistCode = waitlistValidation.code.code;
      (registrationPayload as any).waitlistCodeId = waitlistValidation.code.id;
      (registrationPayload as any).waitlistCodeEmail = waitlistValidation.code.email;
      (registrationPayload as any).waitlistCodeEntryId = waitlistValidation.code.entryId || null;
    }
    
    const attemptRef = adminDb.collection("registrationAttempts").doc();
    const newAttemptId = attemptRef.id;

    const normalizedCurrency = String(eventData.currency || 'INR').toUpperCase();
    const isUsd = normalizedCurrency === 'USD';
    if (normalizedCurrency !== 'USD' && normalizedCurrency !== 'INR') {
      return { success: false, message: `Unsupported event currency: ${eventData.currency}` };
    }

    if (isUsd) {
      await adminDb.collection("registrationAttempts").doc(newAttemptId).set({
        ...registrationPayload,
        status: 'PaymentInitiated',
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });

      const baseUrl = resolveAppBaseUrl((registrationPayload as any).originUrl);
      const cancelPath = eventData.customSlug
        ? `${baseUrl}/event-form/${eventData.customSlug}?payment=cancelled`
        : `${baseUrl}/dashboard?payment=cancelled&type=registration`;
      const session = await createStripeCheckoutSession({
        amount: amountPaidPaisa || 0,
        currency: 'usd',
        customerEmail: email || undefined,
        name: `${eventData.eventName} Registration`,
        description: `${registrationPayload.ticketName || 'Event Ticket'}`,
        successUrl: `${baseUrl}/dashboard?payment=processing&type=registration&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: cancelPath,
        metadata: {
          paymentType: 'event_registration',
          registrationAttemptId: newAttemptId,
          eventName: eventData.eventName,
        },
      });

      await adminDb.collection("registrationAttempts").doc(newAttemptId).update({
        stripeCheckoutSessionId: session.id,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { success: true, message: 'Stripe checkout created.', orderId: session.id, checkoutUrl: session.url || undefined, paymentGateway: 'stripe' };
    
    } else { 
      if (!razorpayInstance) return { success: false, message: 'Razorpay is not configured.' };

      const notesPayload = { 
        registrationAttemptId: newAttemptId,
        eventName: registrationPayload.eventName || '',
        eventId: registrationPayload.eventId || '',
        ticketId: registrationPayload.ticketId || '',
        athleteUid: registrationPayload.userId || '',
        type: 'event_registration'
      };
      
      const options = {
          amount: Math.round(amountPaidPaisa || 0),
          currency: 'INR',
          receipt: `reg_${eventId.slice(-4)}_${(registrationPayload.userId || 'guest').slice(-4)}_${Date.now().toString().slice(-6)}`,
          notes: notesPayload
      };
      
      const order = await razorpayInstance.orders.create(options);
      if (!order || !order.id) throw new Error('Razorpay order creation failed.');
      
      await adminDb.collection("registrationAttempts").doc(newAttemptId).set({
          ...registrationPayload,
          status: 'PaymentInitiated',
          razorpayOrderId: order.id,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
      });
      
      return {
          success: true, message: 'Razorpay order created.',
          orderId: order.id,
          amount: Number(order.amount), 
          currency: order.currency,
          keyId: RAZORPAY_KEY_ID!, 
          notes: notesPayload,
          paymentGateway: 'razorpay',
      };
    }
  } catch (e: any) {
    return { success: false, message: `Failed to create payment order: ${e.message}` };
  }
}

export async function createRelayRegistrationOrderAction(input: {
  eventId: string;
  ticketId: string;
  teamName: string;
  amountPaidPaisa: number;
  couponCode?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
}): Promise<{ success: boolean; message: string; orderId?: string; amount?: number; currency?: string; keyId?: string; notes?: Record<string, string>; paymentGateway?: 'razorpay' }> {
  if (!input.eventId || !input.ticketId) {
    return { success: false, message: 'Event ID and Ticket ID are required.' };
  }

  try {
    const adminDb = getFirestoreInstance();
    const eventRef = adminDb.collection('events').doc(input.eventId);
    const [eventSnap, ticketSnap] = await Promise.all([
      eventRef.get(),
      eventRef.collection('ticketDefinitions').doc(input.ticketId).get(),
    ]);

    if (!eventSnap.exists) return { success: false, message: 'Event not found.' };
    if (!ticketSnap.exists) return { success: false, message: 'Ticket definition not found.' };
    if (!razorpayInstance) return { success: false, message: 'Razorpay is not configured.' };

    const eventData = eventSnap.data() as any;
    const ticketData = ticketSnap.data() as TicketDefinition;
    const normalizedCurrency = String(eventData.currency || 'INR').toUpperCase();
    if (normalizedCurrency !== 'INR') {
      return { success: false, message: 'Relay online payment is currently supported only for INR events.' };
    }

    const attemptRef = adminDb.collection('relayRegistrationAttempts').doc();
    const notes: Record<string, string> = {
      type: 'relay_registration',
      firestoreDocId: attemptRef.id,
      eventId: input.eventId,
      ticketId: input.ticketId,
      teamName: input.teamName || 'Relay Team',
      eventName: eventData.eventName || '',
      ticketName: ticketData.ticketName || '',
      athleteUid: input.userId || '',
      athleteEmail: input.userEmail || '',
      amountPaidPaisa: String(Math.round(input.amountPaidPaisa || 0)),
    };

    const order = await razorpayInstance.orders.create({
      amount: Math.round(input.amountPaidPaisa || 0),
      currency: 'INR',
      receipt: `relay_${input.eventId.slice(-4)}_${Date.now().toString().slice(-6)}`,
      notes,
    });

    await attemptRef.set({
      ...notes,
      couponCode: input.couponCode || null,
      createdByUid: input.userId || null,
      createdByEmail: input.userEmail || null,
      createdByName: input.userName || null,
      razorpayOrderId: order.id,
      status: 'PaymentInitiated',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      message: 'Relay Razorpay order created.',
      orderId: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      keyId: RAZORPAY_KEY_ID!,
      notes,
      paymentGateway: 'razorpay',
    };
  } catch (e: any) {
    return { success: false, message: `Failed to create relay payment order: ${e.message}` };
  }
}

export async function verifyRelayRegistrationPaymentAndCreateAction(input: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  firestoreDocId?: string;
  formData: RelayTeamRegistrationFormInput;
  userEmail: string;
  userId: string;
  userName: string;
}): Promise<{ success: boolean; message: string; relayTeamId?: string; teamBib?: string }> {
  if (!RAZORPAY_KEY_SECRET) return { success: false, message: 'Payment verification service not configured.' };

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, firestoreDocId, formData, userEmail, userId, userName } = input;

  try {
    const shasum = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET);
    shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const expectedSignature = shasum.digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return { success: false, message: 'Payment verification failed. Signature mismatch.' };
    }

    const adminDb = getFirestoreInstance();
    if (firestoreDocId) {
      await adminDb.collection('relayRegistrationAttempts').doc(firestoreDocId).set({
        status: 'PaymentCaptured',
        transactionId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const result = await createRelayTeamRegistrationAction(
      formData,
      userEmail,
      userId,
      userName,
      {
        transactionId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        paymentMethod: 'Razorpay',
      }
    );

    if (firestoreDocId) {
      await adminDb.collection('relayRegistrationAttempts').doc(firestoreDocId).set({
        status: result.success ? 'Completed' : 'RegistrationFailed',
        relayTeamId: result.relayTeamId || null,
        teamBib: result.teamBib || null,
        lastError: result.success ? FieldValue.delete() : (result.message || 'Relay registration failed after payment'),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return result;
  } catch (e: any) {
    if (input.firestoreDocId) {
      const adminDb = getFirestoreInstance();
      await adminDb.collection('relayRegistrationAttempts').doc(input.firestoreDocId).set({
        status: 'RegistrationFailed',
        lastError: e.message,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return { success: false, message: `Relay payment verification failed: ${e.message}` };
  }
}

export async function verifyEventRegistrationPaymentAndFinalizeAction(input: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  registrationAttemptId?: string;
}): Promise<{ success: boolean; message: string; bookingId?: string | null; participantId?: string | null }> {
  if (!RAZORPAY_KEY_SECRET) {
    return { success: false, message: 'Payment verification service not configured.' };
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, registrationAttemptId } = input;

  try {
    const shasum = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET);
    shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const expectedSignature = shasum.digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return { success: false, message: 'Payment verification failed. Signature mismatch.' };
    }

    const adminDb = getFirestoreInstance();

    let attemptDocRef: FirebaseFirestore.DocumentReference | null = null;
    let attemptDocSnap: FirebaseFirestore.DocumentSnapshot | null = null;

    if (registrationAttemptId) {
      const ref = adminDb.collection('registrationAttempts').doc(registrationAttemptId);
      const snap = await ref.get();
      if (snap.exists) {
        attemptDocRef = ref;
        attemptDocSnap = snap;
      }
    }

    if (!attemptDocRef) {
      const byOrderSnap = await adminDb
        .collection('registrationAttempts')
        .where('razorpayOrderId', '==', razorpay_order_id)
        .limit(1)
        .get();
      if (byOrderSnap.empty) {
        return { success: false, message: 'Registration attempt not found for payment order.' };
      }
      attemptDocRef = byOrderSnap.docs[0].ref;
      attemptDocSnap = byOrderSnap.docs[0];
    }

    const attemptData = (attemptDocSnap!.data() || {}) as RegistrationAttempt;

    if (attemptData.status !== 'Completed') {
      await attemptDocRef.update({
        status: 'PaymentCaptured',
        transactionId: razorpay_payment_id,
        specificPaymentMethod: 'Online',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const finalizeRes = await finalizeRegistration(attemptDocRef.id, 'payment.verifyEventRegistrationPaymentAndFinalizeAction');
    if (!finalizeRes.success) {
      return { success: false, message: finalizeRes.message || 'Registration finalization failed.' };
    }

    return {
      success: true,
      message: finalizeRes.message || 'Registration finalized successfully.',
      bookingId: finalizeRes.bookingId || null,
      participantId: finalizeRes.participantId || null,
    };
  } catch (e: any) {
    return { success: false, message: `Payment verification/finalization failed: ${e.message}` };
  }
}

export async function createCategoryChangeRazorpayOrderAction(input: any): Promise<any> {
    const {
        originalEventId,
        originalParticipantId,
        newTicketId,
        newTicketName,
        totalAmountToChargePaisa,
        athleteUid,
        athleteEmail,
        athleteName,
        originUrl
    } = input;
    
    try {
        const adminDb = getFirestoreInstance();
        const eventSnap = await adminDb.collection('events').doc(originalEventId).get();
        if (!eventSnap.exists) throw new Error("Event not found.");
        const eventData = eventSnap.data() || {};
        const eventName = eventData.eventName || 'Unknown Event';
        const normalizedCurrency = String(eventData.currency || 'INR').toUpperCase();
        const isUsd = normalizedCurrency === 'USD';
        if (normalizedCurrency !== 'USD' && normalizedCurrency !== 'INR') {
          return { success: false, message: `Unsupported event currency: ${eventData.currency}` };
        }

        const orderRef = adminDb.collection('categoryChangeAttempts').doc();
        const notes = {
            type: 'category_change',
            firestoreDocId: orderRef.id,
            originalEventId,
            originalParticipantId,
            newTicketId,
            newTicketName,
            totalAmountToChargePaisa: String(totalAmountToChargePaisa),
            athleteUid,
            athleteEmail,
            athleteName,
            eventName,
            newSubCategoryId: input.newSubCategoryId || '',
        };

          await orderRef.set({ ...notes, status: 'Pending', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });

          if (isUsd) {
            const baseUrl = resolveAppBaseUrl(originUrl);
            const session = await createStripeCheckoutSession({
              amount: totalAmountToChargePaisa,
              currency: 'usd',
              customerEmail: athleteEmail,
              name: `Category Change - ${eventName}`,
              description: `Category change to ${newTicketName}`,
              successUrl: `${baseUrl}/dashboard?payment=processing&type=category-change&session_id={CHECKOUT_SESSION_ID}`,
              cancelUrl: `${baseUrl}/dashboard?payment=cancelled&type=category-change`,
              metadata: {
                paymentType: 'category_change',
                firestoreDocId: orderRef.id,
                originalEventId,
                originalParticipantId,
                newTicketId,
                newSubCategoryId: input.newSubCategoryId || '',
                newTicketName,
                totalAmountToChargePaisa: String(totalAmountToChargePaisa),
                athleteUid,
                athleteEmail,
                athleteName,
                eventName,
              },
            });

            await orderRef.update({ stripeCheckoutSessionId: session.id, updatedAt: FieldValue.serverTimestamp() });
            return { success: true, message: 'Category change checkout created.', orderId: session.id, checkoutUrl: session.url || undefined, paymentGateway: 'stripe', notes };
          }

          if (!razorpayInstance) throw new Error("Payment gateway not configured.");

        const options = {
            amount: Math.round(totalAmountToChargePaisa),
            currency: 'INR',
            receipt: `cat_chg_${originalParticipantId.slice(-4)}_${Date.now().toString().slice(-6)}`,
            notes,
        };

        const order = await razorpayInstance.orders.create(options);
        if (!order || !order.id) throw new Error('Razorpay order creation failed.');

    await orderRef.update({ razorpayOrderId: order.id, updatedAt: FieldValue.serverTimestamp() });

    return { success: true, message: 'Category change order created.', orderId: order.id, amount: Number(order.amount), currency: order.currency, keyId: RAZORPAY_KEY_ID!, notes, paymentGateway: 'razorpay' };
    } catch (e: any) {
        return { success: false, message: `Category change order creation error: ${e.message}` };
    }
}

export async function verifyCategoryChangePaymentAndProcessAction(paymentData: any): Promise<{ success: boolean; message: string; }> {
  const { 
    razorpay_order_id, 
    razorpay_payment_id, 
    razorpay_signature, 
    firestoreDocId,
    originalEventId, 
    originalParticipantId, 
    newTicketId, 
    newTicketName, 
    athleteUid, 
    athleteName, 
    athleteEmail,
    totalAmountToChargePaisa
  } = paymentData;

  if (!RAZORPAY_KEY_SECRET) return { success: false, message: "Payment verification service not configured." };

  try {
    const shasum = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET);
    shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const expectedSignature = shasum.digest('hex');
    
    if (expectedSignature !== razorpay_signature) {
        return { success: false, message: 'Payment verification failed. Signature mismatch.' };
    }

    const adminDb = getFirestoreInstance();
    const attemptRef = adminDb.collection('categoryChangeAttempts').doc(firestoreDocId);
    await attemptRef.update({ status: 'Completed', transactionId: razorpay_payment_id, updatedAt: FieldValue.serverTimestamp() });

    return await processCategoryChangeFinal({
        originalEventId,
        participantId: originalParticipantId,
        newTicketId,
        newTicketName,
        paymentId: razorpay_payment_id,
        athleteUid,
        athleteName,
        athleteEmail,
        totalAmountToChargePaisa: parseInt(String(totalAmountToChargePaisa), 10)
    });

  } catch (e: any) {
    return { success: false, message: `Category change verification failed: ${e.message}` };
  }
}

export async function getPaymentRecordsAction(
  options: { searchTerm?: string; searchBy?: 'paymentId' | 'orderId' | 'email' | 'contact' | 'method'; eventId?: string; }
): Promise<{ success: boolean; message: string; payments?: PaymentRecord[] }> {
  if (!razorpayInstance) return { success: false, message: 'Payment gateway not configured.' };
  try {
    const allPayments = await razorpayInstance.payments.all({ count: 100 });
    let payments = allPayments.items;
    if (options.eventId) {
      const adminDb = getFirestoreInstance();
      const participantsSnap = await adminDb.collection('events').doc(options.eventId).collection('participants').select('transactionId').get();
      const eventPaymentIds = new Set(participantsSnap.docs.map(d => d.data().transactionId).filter(Boolean));
      payments = payments.filter(p => eventPaymentIds.has(p.id));
    }
    return { success: true, message: 'Payments fetched.', payments: payments as any };
  } catch (e: any) {
    return { success: false, message: `Failed to fetch payments: ${e.message}` };
  }
}
