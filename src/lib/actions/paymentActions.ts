
'use server';

import Razorpay from 'razorpay';
import crypto from 'crypto';
import Stripe from 'stripe';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { RegistrationAttempt, PaymentRecord } from '@/lib/types';
import { handleDeferral } from './deferralActions';
import { processCategoryChangeFinal } from './categoryActions';

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

export async function refundPaymentAction(paymentId: string): Promise<{ success: boolean; message: string }> {
  if (!razorpayInstance) return { success: false, message: "Payment gateway not configured for refunds." };

  try {
    const refund = await razorpayInstance.payments.refund(paymentId, {});
    
    if (refund && (refund.status === 'processed' || refund.status === 'pending')) {
      return { success: true, message: `Successfully initiated a full refund for payment ${paymentId}.` };
    } else {
      return { success: false, message: `Refund initiation failed. Status: ${refund?.status}` };
    }
  } catch (e: any) {
    return { success: false, message: `Refund failed: ${e?.error?.description || e.message}` };
  }
}

interface CreateDeferralFeeOrderInput {
  eventId: string;
  participantId: string;
  athleteUid: string;
  athleteEmail: string;
  athleteName: string;
  totalAmountToChargePaisa: number;
}

export async function createDeferralFeeOrderAction(
  input: CreateDeferralFeeOrderInput
): Promise<{ success: boolean; message: string; orderId?: string; amount?: number; currency?: string; keyId?: string; notes?: Record<string, any> }> {
  if (!razorpayInstance) return { success: false, message: "Payment gateway not configured." };
  
  const { eventId, athleteUid, totalAmountToChargePaisa } = input;
  if (totalAmountToChargePaisa < 100) return { success: false, message: "Calculated deferral fee is too low for payment."};
  
  try {
    const adminDb = getFirestoreInstance();
    const eventSnap = await adminDb.collection('events').doc(eventId).get();
    if (!eventSnap.exists) return { success: false, message: "Event not found." };
    const eventName = eventSnap.data()?.eventName || 'Unknown Event';

    const notes = {
        type: 'deferral_fee',
        ...input,
        eventName: eventName,
    };
    
    const options = {
        amount: Math.round(totalAmountToChargePaisa),
        currency: 'INR',
        receipt: `def_fee_${eventId.slice(-6)}_${athleteUid.slice(-6)}_${Date.now().toString().slice(-6)}`,
        notes,
    };

    const order = await razorpayInstance.orders.create(options);
    if (!order || !order.id) throw new Error('Razorpay order creation failed.');

    return { success: true, message: 'Deferral fee order created.', orderId: order.id, amount: Number(order.amount), currency: order.currency, keyId: RAZORPAY_KEY_ID!, notes };
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
): Promise<{ success: boolean; message: string; orderId?: string; amount?: number; currency?: string; keyId?: string; notes?: Record<string, string>, paymentGateway?: 'razorpay' | 'stripe' }> {
  const { eventId, amountPaidPaisa, email } = registrationPayload;
  
  if (!eventId) {
    return { success: false, message: "Event ID is required to create an order." };
  }
  
  const adminDb = getFirestoreInstance();

  try {
    const eventRef = adminDb.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) return { success: false, message: "Event not found." };
    const eventData = eventSnap.data()! as any;

    if (eventData.isSoldOut) {
        return { success: false, message: 'This event is sold out.' };
    }
    
    const attemptRef = adminDb.collection("registrationAttempts").doc();
    const newAttemptId = attemptRef.id;

    if (eventData.currency === 'USD') {
      if (!stripeInstance) return { success: false, message: 'Stripe is not configured.' };
      
      const paymentIntent = await stripeInstance.paymentIntents.create({
          amount: amountPaidPaisa || 0,
          currency: 'usd',
          automatic_payment_methods: { enabled: true },
          metadata: { 
            registrationAttemptId: newAttemptId,
            eventName: eventData.eventName,
          },
          receipt_email: email,
      });

      if (!paymentIntent.client_secret) throw new Error('Failed to create Stripe Payment Intent.');
      
      await adminDb.collection("registrationAttempts").doc(newAttemptId).set({
        ...registrationPayload,
        status: 'PaymentInitiated',
        transactionId: paymentIntent.id,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });

      return { success: true, message: 'Stripe order created.', orderId: paymentIntent.client_secret, paymentGateway: 'stripe', keyId: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY! };
    
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

export async function createCategoryChangeRazorpayOrderAction(input: any): Promise<any> {
    const {
        originalEventId,
        originalParticipantId,
        newTicketId,
        newTicketName,
        totalAmountToChargePaisa,
        athleteUid,
        athleteEmail,
        athleteName
    } = input;
    
    try {
        const adminDb = getFirestoreInstance();
        const eventSnap = await adminDb.collection('events').doc(originalEventId).get();
        if (!eventSnap.exists) throw new Error("Event not found.");
        const eventName = eventSnap.data()?.eventName || 'Unknown Event';

        if (!razorpayInstance) throw new Error("Payment gateway not configured.");

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
        };

        await orderRef.set({ ...notes, status: 'Pending', createdAt: FieldValue.serverTimestamp() });

        const options = {
            amount: Math.round(totalAmountToChargePaisa),
            currency: 'INR',
            receipt: `cat_chg_${originalParticipantId.slice(-4)}_${Date.now().toString().slice(-6)}`,
            notes,
        };

        const order = await razorpayInstance.orders.create(options);
        if (!order || !order.id) throw new Error('Razorpay order creation failed.');

        return { success: true, message: 'Category change order created.', orderId: order.id, amount: Number(order.amount), currency: order.currency, keyId: RAZORPAY_KEY_ID!, notes };
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
