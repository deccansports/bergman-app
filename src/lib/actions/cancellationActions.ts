// src/lib/actions/cancellationActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { format } from 'date-fns';
import { sendRefundInitiatedWhatsApp, sendCancellationConfirmationWhatsApp } from '../auth/aisensyService';
import { sendDynamicTemplateEmail, sendCancellationRequestConfirmationEmail, sendAdminCancellationNoticeEmail } from '../auth/brevoService';
import { authOtpConfig } from '@/lib/auth/authConfig';
import type { AdminInitiateRefundFormInput } from '@/lib/schemas';
import { AdminInitiateRefundSchema } from '@/lib/schemas';
import { toIsoStringSafe, serializeValue, serializeParticipantData } from '@/lib/utils';
import { refundPaymentAction, refundStripePaymentAction, createStripeCreditNoteAction } from './paymentActions';
import type { CancellationEntry, BankDetails, User, CancellationStats, EventParticipant } from '@/lib/types';
import { _mirrorParticipantToKV } from './dataSyncActions';
import { createCreditNote } from '@/lib/zoho/creditNote';
import { findInvoiceByInvoiceNumber, findInvoiceByReference } from '@/lib/zoho/invoice';
import { createZohoCustomer, findZohoCustomerByEmail, findZohoCustomerByName } from '@/lib/zoho/customer';

function isRazorpayPayment(paymentMethod?: string | null, paymentId?: string | null): boolean {
  const method = String(paymentMethod || '').toLowerCase();
  return method.includes('razorpay') || String(paymentId || '').startsWith('pay_');
}

function isStripePayment(paymentMethod?: string | null, paymentId?: string | null): boolean {
  const method = String(paymentMethod || '').toLowerCase();
  const id = String(paymentId || '');
  return method.includes('stripe') || id.startsWith('pi_') || id.startsWith('ch_');
}

async function createCancellationCreditNote(options: {
  participant: EventParticipant;
  cancellation: CancellationEntry;
  refundAmountPaisa: number;
  refundMode: NonNullable<CancellationEntry['refundMode']>;
  cancellationId: string;
  adminDb?: Firestore;
}) {
  const { participant, cancellation, refundAmountPaisa, refundMode, cancellationId, adminDb } = options;

  const resolveZohoCustomerForCancellation = async (): Promise<string | null> => {
    const existing = String((participant as any)?.zohoCustomerId || '').trim();
    if (existing) return existing;

    const participantEmail = String((participant as any)?.email || cancellation.participantEmail || '').toLowerCase().trim();
    const participantName = String((participant as any)?.name || cancellation.participantName || '').trim();

    const participantRef =
      adminDb && cancellation.eventId && (participant as any)?.id
        ? adminDb.collection('events').doc(cancellation.eventId).collection('participants').doc(String((participant as any).id))
        : null;
    const userRef =
      adminDb && (participant as any)?.athleteUid
        ? adminDb.collection('users').doc(String((participant as any).athleteUid))
        : null;

    if (userRef) {
      try {
        const userSnap = await userRef.get();
        const userZohoCustomerId = String((userSnap.data() as any)?.zohoCustomerId || '').trim();
        if (userZohoCustomerId) {
          if (participantRef) await participantRef.set({ zohoCustomerId: userZohoCustomerId }, { merge: true });
          return userZohoCustomerId;
        }
      } catch {
        // Continue with Zoho lookup/create.
      }
    }

    let customer: any = null;
    if (participantEmail) customer = await findZohoCustomerByEmail(participantEmail);
    if (!customer && participantName) customer = await findZohoCustomerByName(participantName);

    if (!customer?.contact_id && participantEmail) {
      try {
        customer = await createZohoCustomer({
          contact_name: participantName || participantEmail,
          email: participantEmail,
          phone: String((participant as any)?.mobile || '').replace(/\D/g, '').slice(-10) || undefined,
          gst_treatment: 'consumer',
        });
      } catch {
        customer = null;
      }
    }

    const contactId = String(customer?.contact_id || '').trim();
    if (!contactId) return null;

    if (participantRef) await participantRef.set({ zohoCustomerId: contactId }, { merge: true });
    if (userRef) await userRef.set({ zohoCustomerId: contactId }, { merge: true });

    return contactId;
  };

  const customerId = await resolveZohoCustomerForCancellation();
  const rawInvoiceId = String((participant as any)?.invoiceId || cancellation.sourceInvoiceId || '').trim() || null;
  const rawInvoiceNumber = String((participant as any)?.invoiceNumber || cancellation.sourceInvoiceNumber || '').trim() || null;
  let invoiceId = rawInvoiceId;
  let invoiceNumber = rawInvoiceNumber;

  // For legacy rows where invoiceId is missing, try resolving by booking/reference number.
  if (!invoiceId) {
    const bookingReference = String((participant as any)?.bookingId || cancellation.participantDocId || cancellation.id || '').trim();
    const lookupCandidates = [bookingReference, rawInvoiceNumber].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    for (const candidate of lookupCandidates) {
      try {
        const foundInvoice = await findInvoiceByReference(candidate);
        if (foundInvoice?.invoice_id) {
          invoiceId = String(foundInvoice.invoice_id).trim();
          invoiceNumber = String(foundInvoice.invoice_number || invoiceNumber || '').trim() || invoiceNumber;
          break;
        }
      } catch {
        // Ignore lookup failures and continue with next candidate.
      }
    }

    if (!invoiceId && rawInvoiceNumber) {
      try {
        const foundByInvoiceNumber = await findInvoiceByInvoiceNumber(rawInvoiceNumber);
        if (foundByInvoiceNumber?.invoice_id) {
          invoiceId = String(foundByInvoiceNumber.invoice_id).trim();
          invoiceNumber = String(foundByInvoiceNumber.invoice_number || invoiceNumber || '').trim() || invoiceNumber;
        }
      } catch {
        // Ignore lookup failures and let standard error handling continue.
      }
    }
  }
  const hasAccountingReference = !!customerId;

  if (!hasAccountingReference || refundAmountPaisa <= 0) {
    return {
      status: 'skipped' as const,
      noteId: null,
      noteNumber: null,
      error: !hasAccountingReference ? 'Missing Zoho customer.' : 'Refund amount is zero.',
    };
  }

  if (!invoiceId) {
    return {
      status: 'skipped' as const,
      noteId: null,
      noteNumber: null,
      error: 'Missing associated Zoho invoice ID for credit note.',
    };
  }

  const eligibleRefundPaisa = Math.max(
    0,
    Math.min(
      Number(refundAmountPaisa || 0),
      Number(cancellation.calculatedRefundAmountPaisa || refundAmountPaisa || 0)
    )
  );

  if (eligibleRefundPaisa <= 0) {
    return {
      status: 'skipped' as const,
      noteId: null,
      noteNumber: null,
      error: 'Eligible refund amount is zero after excluding GST/fees.',
    };
  }

  const amount = Number((eligibleRefundPaisa / 100).toFixed(2));
  const bookingRef = String(participant.bookingId || participant.id || cancellationId).toUpperCase();
  const referenceNumber = `CN-${bookingRef}-${cancellationId.slice(0, 6).toUpperCase()}`;

  try {
    const creditNote = await createCreditNote({
      customer_id: customerId,
      reference_number: referenceNumber,
      date: format(new Date(), 'yyyy-MM-dd'),
      is_inclusive_tax: false,
      notes: `Cancellation refund (${refundMode}) for ${cancellation.eventName} (excluding GST/fees)${invoiceNumber ? ` | Original Invoice: ${invoiceNumber}` : ''}`,
      line_items: [
        {
          name: `Cancellation Refund - ${cancellation.eventName}`,
          rate: amount,
          quantity: 1,
        },
      ],
      invoice_id: invoiceId,
    });

    return {
      status: 'created' as const,
      noteId: creditNote?.creditnote_id || null,
      noteNumber: creditNote?.creditnote_number || null,
      error: null,
    };
  } catch (e: any) {
    return {
      status: 'failed' as const,
      noteId: null,
      noteNumber: null,
      error: e?.zohoMessage || e?.message || 'Zoho credit note creation failed.',
    };
  }
}

async function resolveParticipantForCancellation(adminDb: Firestore, cancellation: CancellationEntry): Promise<EventParticipant | null> {
  const participantsRef = adminDb.collection('events').doc(cancellation.eventId).collection('participants');
  let participantSnap = cancellation.participantDocId
    ? await participantsRef.doc(cancellation.participantDocId).get()
    : null;

  if (!participantSnap?.exists && cancellation.participantEmail) {
    const byEmail = await participantsRef.where('email', '==', cancellation.participantEmail).limit(1).get();
    participantSnap = byEmail.docs[0] || null;
  }

  return participantSnap?.exists ? (participantSnap.data() as EventParticipant) : null;
}


async function sendAdminCancellationRequestNotificationEmail(
  cancellationData: Omit<CancellationEntry, 'id'>
): Promise<boolean> {
  const actionName = 'sendAdminCancellationRequestNotificationEmail';
  const adminEmail = "info@bergmantri.com";
  // As per your request, using Template ID 201 for the admin notification
  const templateId = 201;

  const params = {
    eventname: `CANCELLATION: for ${cancellationData.eventName}`,
    name: cancellationData.participantName,
    amount: (cancellationData.calculatedRefundAmountPaisa / 100).toFixed(2)
  };

  console.log(`[${actionName}] Sending cancellation notification for ${cancellationData.participantName} to admin at ${adminEmail} using template ID ${templateId}.`);

  return sendDynamicTemplateEmail(templateId, adminEmail, params, actionName);
}


export async function processCancellationRequestAction(
  eventId: string,
  participantDocId: string,
  athleteUid: string,
  athleteEmail: string,
  eventName: string,
  eventDate: string,
  originalAmountPaidPaisa: number,
  bankDetails: BankDetails | null,
  calculatedRefundAmountPaisa: number,
  refundPolicyApplied: string,
  gstOriginallyPaid: 'Yes' | 'No' | null,
  originalProcessingFeePaidPaisa: number | null,
  currency: string = 'INR'
): Promise<{ success: boolean; message: string; cancellationId?: string }> {
  const actionName = 'processCancellationRequestAction';
  let adminDb: Firestore;

  try {
    adminDb = getFirestoreInstance();

    if (!eventId || !participantDocId || !athleteUid || !athleteEmail || !eventName || !eventDate) {
      return { success: false, message: "Missing required data for cancellation request." };
    }
    const isUsd = currency === 'USD';

    const participantRef = adminDb
      .collection('events')
      .doc(eventId)
      .collection('participants')
      .doc(participantDocId);

    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
      return { success: false, message: `Participant record not found for event ${eventId}.` };
    }
    const participantData = participantSnap.data() as EventParticipant;
    if (participantData?.ticketStatus === 'Cancelled') {
        return { success: false, message: "This registration has already been cancelled." };
    }
    if (participantData?.ticketStatus === 'Deferred') {
        return { success: false, message: "Deferred registrations cannot be cancelled for a refund." };
    }

    const paidViaRazorpay = isRazorpayPayment(participantData?.paymentMethod, participantData?.paymentId || null);
    if (calculatedRefundAmountPaisa > 0 && !bankDetails && !isUsd && !paidViaRazorpay) {
      return { success: false, message: "Bank details are required for offline / non-Razorpay refunds." };
    }

    await participantRef.update({
      ticketStatus: 'Cancelled',
      updatedAt: FieldValue.serverTimestamp(),
    });

    const updatedParticipantSnap = await participantRef.get();
    if(updatedParticipantSnap.exists) {
        await _mirrorParticipantToKV(serializeParticipantData(updatedParticipantSnap));
    }

    // Resolve payment references robustly for cancellation/refund routing.
    let resolvedSourcePaymentId: string | null = participantData?.paymentId || null;
    let resolvedSourcePaymentMethod: string | null = participantData?.paymentMethod || null;

    if (!resolvedSourcePaymentId && (participantData as any)?.registrationAttemptId) {
      try {
        const attemptSnap = await adminDb
          .collection('registrationAttempts')
          .doc(String((participantData as any).registrationAttemptId))
          .get();
        if (attemptSnap.exists) {
          const attempt = attemptSnap.data() as any;
          resolvedSourcePaymentId = attempt?.transactionId || null;
          resolvedSourcePaymentMethod = resolvedSourcePaymentMethod || attempt?.specificPaymentMethod || null;
        }
      } catch {
        // ignore backfill failure
      }
    }

    if (!resolvedSourcePaymentMethod) {
      const pid = String(resolvedSourcePaymentId || '');
      if (pid.startsWith('pi_') || pid.startsWith('ch_') || currency === 'USD') {
        resolvedSourcePaymentMethod = 'Stripe';
      } else if (pid.startsWith('pay_') || currency === 'INR') {
        resolvedSourcePaymentMethod = 'Razorpay';
      }
    }

    const now = new Date();
    const cancellationEntryData: Omit<CancellationEntry, 'id'> = {
      userId: athleteUid,
      eventId,
      participantDocId,
      participantEmail: athleteEmail.toLowerCase(),
      participantName: participantData?.name || null,
      eventName,
      eventDate,
      currency,
      originalAmountPaidPaisa,
      calculatedRefundAmountPaisa: calculatedRefundAmountPaisa,
      sourcePaymentId: resolvedSourcePaymentId,
      sourcePaymentMethod: resolvedSourcePaymentMethod,
      sourceInvoiceId: participantData?.invoiceId || null,
      sourceInvoiceNumber: participantData?.invoiceNumber || null,
      refundMode: null,
      refundedAmountPaisa: null,
      refundDestination: null,
      stripeCreditNoteId: null,
      stripeCreditNoteNumber: null,
      stripeCreditNoteStatus: null,
      stripeCreditNoteError: null,
      zohoCreditNoteId: null,
      zohoCreditNoteNumber: null,
      zohoCreditNoteStatus: null,
      zohoCreditNoteError: null,
      refundPolicyApplied,
      requestedAt: now.toISOString(),
      status: 'Requested',
      bankDetails: bankDetails,
      gstOriginallyPaid: gstOriginallyPaid,
      originalProcessingFeePaidPaisa: originalProcessingFeePaidPaisa,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      adminNotes: null,
      refundInitiatedDate: null,
      refundProcessedAt: null,
      refundTransactionId: null,
      refundRrn: null,
    };

    const newCancellationRef = await adminDb.collection('cancellations').add({
      ...cancellationEntryData,
      createdAt: FieldValue.serverTimestamp(), // Overwrite with server timestamp
      updatedAt: FieldValue.serverTimestamp(),
    });

    const userRef = adminDb.collection('users').doc(athleteUid);
    await userRef.update({
      activeCancellation: {
        cancellationId: newCancellationRef.id,
        eventName: eventName,
        requestedAt: cancellationEntryData.requestedAt,
        status: 'Requested',
        expectedRefundAmountPaisa: calculatedRefundAmountPaisa,
        gstOriginallyPaid: gstOriginallyPaid,
      },
      activeDeferral: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    
    // Send Admin Notification
    await sendAdminCancellationRequestNotificationEmail(cancellationEntryData);
    // Athlete Notification (This is separate)
    await sendCancellationRequestConfirmationEmail(athleteEmail, cancellationEntryData.participantName || null, eventName, calculatedRefundAmountPaisa);

    if (participantData?.mobile) {
      await sendCancellationConfirmationWhatsApp(participantData.mobile, cancellationEntryData.participantName || "Athlete", eventName);
    }


    revalidatePath('/dashboard');
    revalidatePath(`/admin/dashboard`);

    const currencySymbol = currency === 'USD' ? '$' : '₹';
    return {
      success: true,
      message: `Cancellation request for ${eventName} submitted. A confirmation has been sent. Calculated refund (if any): ${currencySymbol}${(calculatedRefundAmountPaisa / 100).toFixed(2)}.`,
      cancellationId: newCancellationRef.id,
    };

  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${actionName}] Error processing cancellation request:`, err.message, err.stack);
    return { success: false, message: `Failed to process cancellation request: ${err.message}` };
  }
}

export async function getAllCancellationRequestsAction(): Promise<{ success: boolean; message: string; cancellationRequests?: CancellationEntry[] }> {
  const actionName = 'getAllCancellationRequestsAction'; let adminDb: Firestore;
  try {
    adminDb = getFirestoreInstance();
    const snapshot = await adminDb.collection('cancellations').orderBy('requestedAt', 'desc').get();
    if (snapshot.empty) return { success: true, message: 'No cancellation requests found.', cancellationRequests: [] };

    const requests: CancellationEntry[] = await Promise.all(snapshot.docs.map(async (doc) => {
      const request = serializeValue({ id: doc.id, ...doc.data() }) as CancellationEntry;

      const storedMethod = String(request.sourcePaymentMethod || '').toLowerCase();
      const reqCurrency = String(request.currency || '').toUpperCase();
      const methodCurrencyMismatch =
        (reqCurrency === 'USD' && storedMethod.includes('razorpay')) ||
        (reqCurrency === 'INR' && storedMethod.includes('stripe'));

      if (request.sourcePaymentId && request.sourcePaymentMethod && request.sourceInvoiceNumber && !methodCurrencyMismatch) {
        return request;
      }

      try {
        const participantsRef = adminDb.collection('events').doc(request.eventId).collection('participants');
        let participantSnap = request.participantDocId
          ? await participantsRef.doc(request.participantDocId).get()
          : null;

        if (!participantSnap?.exists && request.participantEmail) {
          const byEmail = await participantsRef.where('email', '==', request.participantEmail).limit(1).get();
          participantSnap = byEmail.docs[0] || null;
        }

        const participant = participantSnap?.exists ? (participantSnap.data() as EventParticipant) : null;

        if (participant) {
          let sourcePaymentId = participant.paymentId || participant.transactionId || null;
          let sourcePaymentMethod = participant.paymentMethod || null;
          const sourceInvoiceId = participant.invoiceId || null;
          const sourceInvoiceNumber = participant.invoiceNumber || null;

          // Fallback to registration attempt when participant payment ID is missing.
          if (!sourcePaymentId && (participant as any)?.registrationAttemptId) {
            try {
              const attemptSnap = await adminDb
                .collection('registrationAttempts')
                .doc(String((participant as any).registrationAttemptId))
                .get();
              if (attemptSnap.exists) {
                const attempt = attemptSnap.data() as any;
                sourcePaymentId = attempt?.transactionId || sourcePaymentId;
                sourcePaymentMethod = sourcePaymentMethod || attempt?.specificPaymentMethod || null;
              }
            } catch {
              // ignore fallback lookup failure
            }
          }

          // Infer payment gateway for legacy records where method is missing/incorrect.
          if (!sourcePaymentMethod) {
            const pid = String(sourcePaymentId || '');
            const invId = String(sourceInvoiceId || '');
            const reqCurrency = String(request.currency || '').toUpperCase();
            if (pid.startsWith('pi_') || pid.startsWith('ch_') || invId.startsWith('in_') || reqCurrency === 'USD') {
              sourcePaymentMethod = 'Stripe';
            } else if (pid.startsWith('pay_') || reqCurrency === 'INR') {
              sourcePaymentMethod = 'Razorpay';
            }
          }

          if (sourcePaymentId || sourcePaymentMethod || sourceInvoiceNumber || !request.participantDocId) {
            await doc.ref.update({
              participantDocId: request.participantDocId || participantSnap?.id,
              sourcePaymentId: sourcePaymentId || null,
              sourcePaymentMethod: sourcePaymentMethod || null,
              sourceInvoiceId: sourceInvoiceId || null,
              sourceInvoiceNumber: sourceInvoiceNumber || null,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          return {
            ...request,
            participantDocId: request.participantDocId || participantSnap?.id,
            sourcePaymentId: request.sourcePaymentId || sourcePaymentId,
            sourcePaymentMethod: request.sourcePaymentMethod || sourcePaymentMethod,
            sourceInvoiceId: request.sourceInvoiceId || sourceInvoiceId,
            sourceInvoiceNumber: request.sourceInvoiceNumber || sourceInvoiceNumber,
          } as CancellationEntry;
        }
      } catch {
        // keep original request if lookup/backfill fails
      }

      return request;
    }));

    return { success: true, message: 'Cancellation requests fetched.', cancellationRequests: requests };
  } catch (e:any) {
    console.error(`[${actionName}] Error fetching cancellations:`, e);
    return { success: false, message: `Server action '${actionName}' failed: ${e.message}` };
  }
}

export async function getCancellationStatsAction(): Promise<{ success: boolean; message: string; stats?: CancellationStats }> {
  const actionName = 'getCancellationStatsAction';
  let adminDb: Firestore;
  try {
    adminDb = getFirestoreInstance();
    const cancellationsRef = adminDb.collection('cancellations');
    
    const totalPromise = cancellationsRef.count().get();
    const pendingPromise = cancellationsRef.where('status', '==', 'Requested').count().get();
    const processingPromise = cancellationsRef.where('status', '==', 'Processing').count().get();
    const deniedPromise = cancellationsRef.where('status', '==', 'Denied').count().get();
    const refundedSnapPromise = cancellationsRef.where('status', '==', 'Refunded').get();

    const [totalSnap, pendingSnap, processingSnap, deniedSnap, refundedSnap] = await Promise.all([
      totalPromise,
      pendingPromise,
      processingPromise,
      deniedPromise,
      refundedSnapPromise
    ]);

    const totalRequests = totalSnap.data().count;
    const pendingRequests = pendingSnap.data().count;
    const processingRefunds = processingSnap.data().count;
    const deniedRequests = deniedSnap.data().count;
    
    let totalRefundedAmountPaisa = 0;
    refundedSnap.forEach(doc => {
        totalRefundedAmountPaisa += doc.data().calculatedRefundAmountPaisa || 0;
    });

    return {
      success: true,
      message: "Cancellation stats fetched.",
      stats: { totalRequests, pendingRequests, processingRefunds, totalRefundedAmountPaisa, deniedRequests }
    };
  } catch (e: any) {
    console.error(`[${actionName}] Error: ${e.message}`, e);
    return { success: false, message: `Server action '${actionName}' failed: ${e.message}` };
  }
}

export async function initiateRefundForCancellationAction(cancellationId:string, data: AdminInitiateRefundFormInput):Promise<{success:boolean;message:string}>{
  const actionName='initiateRefundForCancellationAction'; let adminDb: Firestore;
  try{
    adminDb = getFirestoreInstance();
    const validation = AdminInitiateRefundSchema.safeParse(data);
    if(!validation.success) {
        const firstError = validation.error.errors[0];
        return {success:false, message: `${firstError.path.join('.')} - ${firstError.message}` || "Invalid input." };
    }
    const{refundInitiatedDate,refundTransactionId,adminNotes}=validation.data;
    const cancRef=adminDb.collection('cancellations').doc(cancellationId);
    const cancSnap=await cancRef.get();
    if(!cancSnap.exists)return{success:false,message:"Cancellation request not found."};
    const cancData=cancSnap.data()as CancellationEntry;
    if(cancData.status!=='Requested')return{success:false,message:`Cannot initiate refund for status: ${cancData.status}.`};

    const participantData = await resolveParticipantForCancellation(adminDb, { ...cancData, id: cancellationId });

    const creditNoteResult = participantData
      ? await createCancellationCreditNote({
          participant: participantData,
          cancellation: { ...cancData, id: cancellationId },
          refundAmountPaisa: cancData.calculatedRefundAmountPaisa,
          refundMode: 'manual',
          cancellationId,
          adminDb,
        })
      : { status: 'skipped' as const, noteId: null, noteNumber: null, error: 'Participant record missing.' };

    const destinationText = cancData?.bankDetails?.accountNumber
      ? `Bank transfer to account ending ${String(cancData.bankDetails.accountNumber).slice(-4) || 'XXXX'}`
      : 'Manual refund initiated by admin';

    await cancRef.update({
      status:'Processing',
      refundInitiatedDate: refundInitiatedDate,
      refundTransactionId:refundTransactionId,
      refundMode: 'manual',
      refundedAmountPaisa: cancData.calculatedRefundAmountPaisa,
      refundDestination: destinationText,
      sourceInvoiceId: participantData?.invoiceId || cancData.sourceInvoiceId || null,
      sourceInvoiceNumber: participantData?.invoiceNumber || cancData.sourceInvoiceNumber || null,
      zohoCreditNoteId: creditNoteResult.noteId,
      zohoCreditNoteNumber: creditNoteResult.noteNumber,
      zohoCreditNoteStatus: creditNoteResult.status,
      zohoCreditNoteError: creditNoteResult.error,
      adminNotes:adminNotes||cancData.adminNotes||null,
      updatedAt:FieldValue.serverTimestamp(),
    });

    const userRef=adminDb.collection('users').doc(cancData.userId);
    const userSnap = await userRef.get();
    let userMobile: string | null = null;
    let userName: string | null = null;
    if (userSnap.exists) {
        const userData = userSnap.data() as User;
        userMobile = userData.mobile || null;
        userName = userData.name || cancData.participantName || 'Athlete';
    } else {
        userName = cancData.participantName || 'Athlete';
    }

    await userRef.set({
      activeCancellation:{
        cancellationId:cancellationId,
        eventName:cancData.eventName,
        requestedAt:cancData.requestedAt,
        status:'Processing',
        expectedRefundAmountPaisa:cancData.calculatedRefundAmountPaisa,
        gstOriginallyPaid:cancData.gstOriginallyPaid,
        refundInitiatedDate:refundInitiatedDate.toISOString(),
        refundTransactionId:refundTransactionId,
        refundRrn:null,
        refundMode:'manual',
        refundDestination:destinationText,
        refundedAmountPaisa:cancData.calculatedRefundAmountPaisa,
        refundProcessedAt:null,
      },
      updatedAt:FieldValue.serverTimestamp()
    },{merge:true});

    // Send WhatsApp notification
    if (userMobile && userName) {
        await sendRefundInitiatedWhatsApp(userMobile, userName, refundTransactionId, refundInitiatedDate, cancData.calculatedRefundAmountPaisa);
    }

    revalidatePath('/admin/dashboard');
    revalidatePath(`/dashboard`);
    return{success:true,message:`Refund initiation for ${cancData.participantEmail} recorded. Status: 'Processing'. WhatsApp notification sent if mobile available.`};
  }catch(e:any){return{success:false,message:`Server action '${actionName}' failed: ${e.message}`};}
}

export async function initiateRazorpayRefundForCancellationAction(
  cancellationId: string,
  options: {
    mode: 'calculated' | 'custom';
    customAmountPaisa?: number | null;
    adminNotes?: string | null;
    paymentIdOverride?: string | null;
    paymentMethodOverride?: string | null;
  }
): Promise<{ success: boolean; message: string }> {
  const actionName = 'initiateRazorpayRefundForCancellationAction';
  let adminDb: Firestore;
  try {
    adminDb = getFirestoreInstance();
    const cancRef = adminDb.collection('cancellations').doc(cancellationId);
    const cancSnap = await cancRef.get();
    if (!cancSnap.exists) return { success: false, message: 'Cancellation request not found.' };

    const cancData = cancSnap.data() as CancellationEntry;
    if (cancData.status !== 'Requested') {
      return { success: false, message: `Cannot refund for status: ${cancData.status}.` };
    }

    let paymentId = cancData.sourcePaymentId || null;
    let paymentMethod = cancData.sourcePaymentMethod || null;

    if (!paymentId && options.paymentIdOverride) {
      paymentId = String(options.paymentIdOverride).trim();
    }
    if (!paymentMethod && options.paymentMethodOverride) {
      paymentMethod = String(options.paymentMethodOverride).trim();
    }

    // Backfill from participant record for legacy cancellation entries.
    if (!paymentId || !paymentMethod) {
      try {
        const p = await resolveParticipantForCancellation(adminDb, { ...cancData, id: cancellationId });
        if (p) {
          paymentId = paymentId || p.paymentId || p.transactionId || null;
          paymentMethod = paymentMethod || p.paymentMethod || null;
        }
      } catch {
        // ignore fallback lookup failure
      }
    }

    if (!paymentId) {
      return { success: false, message: 'Payment ID missing. Enter Payment ID and retry.' };
    }

    const calculatedAmount = Math.max(0, Number(cancData.calculatedRefundAmountPaisa || 0));
    const customAmount = Math.max(0, Number(options.customAmountPaisa || 0));
    const refundAmountPaisa = options.mode === 'custom' ? customAmount : calculatedAmount;

    if (!refundAmountPaisa || refundAmountPaisa <= 0) {
      return { success: false, message: 'Refund amount must be greater than zero.' };
    }

    if (refundAmountPaisa > Number(cancData.originalAmountPaidPaisa || 0)) {
      return { success: false, message: 'Refund amount cannot exceed original amount paid.' };
    }

    if (options.mode === 'custom' && refundAmountPaisa > calculatedAmount) {
      return { success: false, message: 'Custom refund cannot exceed calculated eligible refund (excluding GST/fees).' };
    }

    const useStripeRefund = isStripePayment(paymentMethod, paymentId);
    const useRazorpayRefund = isRazorpayPayment(paymentMethod, paymentId);

    if (!useStripeRefund && !useRazorpayRefund) {
      return { success: false, message: 'Unsupported payment gateway for automatic refund. Use manual refund.' };
    }

    // For Stripe: refund policy amount + create credit note for accounting
    let refundResult: any;
    if (useStripeRefund) {
      const invoiceId = cancData.sourceInvoiceId;
      if (!invoiceId) {
        return { success: false, message: 'Stripe invoice ID not found. Cannot create credit note. Use manual refund.' };
      }
      
      // Refund according to policy (calculated amount excluding GST/fees)
      refundResult = await refundStripePaymentAction(paymentId, refundAmountPaisa);
      if (!refundResult.success) {
        return { success: false, message: `Failed to process policy refund: ${refundResult.message}` };
      }

      // Create credit note for calculated refund (excluding GST/fees) for accounting purposes
      const creditNoteResult = await createStripeCreditNoteAction({
        invoiceId,
        amountPaisa: refundAmountPaisa,
        refundId: refundResult.refundId || null,
        reason: 'order_change',
        memo: `Cancellation refund for ${cancData.eventName} (Policy: ${cancData.refundPolicyApplied})`,
      });

      if (!creditNoteResult.success) {
        // Log warning but don't fail - refund already processed
        console.warn(`[initiateRazorpayRefundForCancellationAction] Credit note creation failed for Stripe refund: ${creditNoteResult.message}`);
      }

      // Attach credit note to refund result for tracking
      refundResult.creditNoteId = creditNoteResult.creditNoteId;
      refundResult.creditNoteNumber = creditNoteResult.creditNoteNumber;
    } else {
      // For Razorpay, use regular refund
      refundResult = await refundPaymentAction(paymentId, refundAmountPaisa);
      if (!refundResult.success) {
        return { success: false, message: refundResult.message };
      }
    }

    const participantData = await resolveParticipantForCancellation(adminDb, { ...cancData, id: cancellationId });

    const modeValue = useStripeRefund
      ? (options.mode === 'custom' ? 'stripe_custom' : 'stripe_calculated')
      : (options.mode === 'custom' ? 'razorpay_custom' : 'razorpay_calculated');
    
    // Record the policy-based refund amount (both Stripe and Razorpay use policy)
    const recordedRefundAmountPaisa = refundAmountPaisa;
    
    const refundDestination = useStripeRefund
      ? `Stripe refund with Stripe credit note`
      : 'Original Razorpay payment source';
    const paymentMethodForRecord = useStripeRefund ? 'Stripe' : (paymentMethod || 'Razorpay');
    const creditNoteResult = !useStripeRefund && participantData
      ? await createCancellationCreditNote({
          participant: participantData,
          cancellation: { ...cancData, id: cancellationId },
          refundAmountPaisa,
          refundMode: modeValue,
          cancellationId,
          adminDb,
        })
      : { status: 'skipped' as const, noteId: null, noteNumber: null, error: useStripeRefund ? null : 'Participant record missing.' };

    const nowIso = new Date().toISOString();
    await cancRef.update({
      status: 'Refunded',
      refundInitiatedDate: nowIso,
      refundProcessedAt: nowIso,
      refundTransactionId: useStripeRefund 
        ? (refundResult.refundId || `stripe_refund:${paymentId}`)
        : (refundResult.refundId || `razorpay:${paymentId}`),
      refundRrn: useStripeRefund
        ? (refundResult.refundRrn || refundResult.creditNoteNumber || null)
        : (refundResult.refundRrn || null),
      sourcePaymentId: paymentId,
      sourcePaymentMethod: paymentMethodForRecord,
      sourceInvoiceId: participantData?.invoiceId || cancData.sourceInvoiceId || null,
      sourceInvoiceNumber: participantData?.invoiceNumber || cancData.sourceInvoiceNumber || null,
      refundMode: modeValue,
      refundedAmountPaisa: recordedRefundAmountPaisa,
      refundDestination,
      stripeCreditNoteId: useStripeRefund ? (refundResult.creditNoteId || null) : (cancData.stripeCreditNoteId || null),
      stripeCreditNoteNumber: useStripeRefund ? (refundResult.creditNoteNumber || null) : (cancData.stripeCreditNoteNumber || null),
      stripeCreditNoteStatus: useStripeRefund ? ((refundResult.creditNoteId || refundResult.creditNoteNumber) ? 'created' : 'failed') : (cancData.stripeCreditNoteStatus || null),
      stripeCreditNoteError: useStripeRefund ? (refundResult.creditNoteId || refundResult.creditNoteNumber ? null : 'Stripe credit note creation failed.') : (cancData.stripeCreditNoteError || null),
      zohoCreditNoteId: creditNoteResult.noteId,
      zohoCreditNoteNumber: creditNoteResult.noteNumber,
      zohoCreditNoteStatus: creditNoteResult.status,
      zohoCreditNoteError: creditNoteResult.error,
      adminNotes: options.adminNotes || cancData.adminNotes || null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await adminDb.collection('users').doc(cancData.userId).set({
      activeCancellation: {
        cancellationId,
        eventName: cancData.eventName,
        requestedAt: cancData.requestedAt,
        status: 'Refunded',
        expectedRefundAmountPaisa: recordedRefundAmountPaisa,
        gstOriginallyPaid: cancData.gstOriginallyPaid,
        refundInitiatedDate: nowIso,
        refundTransactionId: useStripeRefund 
          ? (refundResult.refundId || null)
          : (refundResult.refundId || null),
        refundRrn: useStripeRefund ? refundResult.creditNoteNumber : (refundResult.refundRrn || null),
        refundMode: modeValue,
        refundDestination,
        refundedAmountPaisa: recordedRefundAmountPaisa,
        refundProcessedAt: nowIso,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    revalidatePath('/admin/dashboard');
    revalidatePath('/dashboard');

    const successMessage = useStripeRefund
      ? `Stripe refund (${(refundAmountPaisa / 100).toFixed(2)} USD per policy) processed successfully. Credit note created for accounting.`
      : `Razorpay refund initiated successfully (${(refundAmountPaisa / 100).toFixed(2)} ${cancData.currency || 'INR'}).`;

    return {
      success: true,
      message: successMessage,
    };
  } catch (e: any) {
    return { success: false, message: `Server action '${actionName}' failed: ${e?.message || e?.toString?.() || 'Unknown error'}` };
  }
}

export async function markCancellationAsRefundedAction(
  cancellationId: string,
  input?: { adminNotes?: string | null; refundTransactionId?: string | null }
): Promise<{ success: boolean; message: string }> {
  const actionName = 'markCancellationAsRefundedAction';
  let adminDb: Firestore;
  try {
    adminDb = getFirestoreInstance();
    const cancRef = adminDb.collection('cancellations').doc(cancellationId);
    const cancSnap = await cancRef.get();
    if (!cancSnap.exists) return { success: false, message: 'Cancellation request not found.' };

    const c = cancSnap.data() as CancellationEntry;
    if (c.status !== 'Processing' && c.status !== 'Requested') {
      return { success: false, message: `Cannot mark refunded from status: ${c.status}.` };
    }

    const nowIso = new Date().toISOString();
    await cancRef.update({
      status: 'Refunded',
      refundProcessedAt: nowIso,
      refundTransactionId: input?.refundTransactionId || c.refundTransactionId || null,
      refundRrn: c.refundRrn || null,
      refundedAmountPaisa: c.refundedAmountPaisa || c.calculatedRefundAmountPaisa,
      adminNotes: input?.adminNotes || c.adminNotes || null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await adminDb.collection('users').doc(c.userId).set({
      activeCancellation: {
        cancellationId,
        eventName: c.eventName,
        requestedAt: c.requestedAt,
        status: 'Refunded',
        expectedRefundAmountPaisa: c.refundedAmountPaisa || c.calculatedRefundAmountPaisa,
        gstOriginallyPaid: c.gstOriginallyPaid,
        refundInitiatedDate: c.refundInitiatedDate,
        refundTransactionId: input?.refundTransactionId || c.refundTransactionId || null,
        refundRrn: c.refundRrn || null,
        refundMode: c.refundMode,
        refundDestination: c.refundDestination,
        refundedAmountPaisa: c.refundedAmountPaisa || c.calculatedRefundAmountPaisa,
        refundProcessedAt: nowIso,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    revalidatePath('/admin/dashboard');
    revalidatePath('/dashboard');
    return { success: true, message: 'Cancellation marked as refunded.' };
  } catch (e: any) {
    return { success: false, message: `Server action '${actionName}' failed: ${e.message}` };
  }
}

export async function syncCancellationCreditNoteAction(cancellationId: string): Promise<{ success: boolean; message: string }> {
  const actionName = 'syncCancellationCreditNoteAction';
  let adminDb: Firestore;
  try {
    adminDb = getFirestoreInstance();
    const cancRef = adminDb.collection('cancellations').doc(cancellationId);
    const cancSnap = await cancRef.get();
    if (!cancSnap.exists) return { success: false, message: 'Cancellation request not found.' };
    const c = cancSnap.data() as CancellationEntry;

    const paymentId = c.sourcePaymentId || null;
    const paymentMethod = c.sourcePaymentMethod || null;
    const useStripeCreditNote = isStripePayment(paymentMethod, paymentId);

    if (useStripeCreditNote) {
      if (!c.sourceInvoiceId) {
        return { success: false, message: 'Stripe invoice ID missing for this cancellation.' };
      }

      const stripeCreditNote = await createStripeCreditNoteAction({
        invoiceId: c.sourceInvoiceId,
        amountPaisa: c.refundedAmountPaisa || c.calculatedRefundAmountPaisa,
        refundId: String(c.refundTransactionId || '').startsWith('re_') ? c.refundTransactionId : null,
        reason: 'order_change',
        memo: `Cancellation refund for ${c.eventName} (Policy: ${c.refundPolicyApplied})`,
      });

      await cancRef.update({
        stripeCreditNoteId: stripeCreditNote.creditNoteId || null,
        stripeCreditNoteNumber: stripeCreditNote.creditNoteNumber || null,
        stripeCreditNoteStatus: stripeCreditNote.success ? 'created' : 'failed',
        stripeCreditNoteError: stripeCreditNote.success ? null : (stripeCreditNote.error || stripeCreditNote.message),
        updatedAt: FieldValue.serverTimestamp(),
      });

      revalidatePath('/admin/dashboard');
      return {
        success: stripeCreditNote.success,
        message: stripeCreditNote.success
          ? `Stripe credit note synced: ${stripeCreditNote.creditNoteNumber || stripeCreditNote.creditNoteId}`
          : `Stripe credit note sync failed: ${stripeCreditNote.error || stripeCreditNote.message}`,
      };
    }

    const participant = await resolveParticipantForCancellation(adminDb, { ...c, id: cancellationId });
    if (!participant) return { success: false, message: 'Participant record not found for this cancellation.' };

    const creditNoteResult = await createCancellationCreditNote({
      participant,
      cancellation: { ...c, id: cancellationId },
      refundAmountPaisa: c.refundedAmountPaisa || c.calculatedRefundAmountPaisa,
      refundMode: (c.refundMode || 'manual') as NonNullable<CancellationEntry['refundMode']>,
      cancellationId,
    });

    await cancRef.update({
      sourceInvoiceId: participant.invoiceId || c.sourceInvoiceId || null,
      sourceInvoiceNumber: participant.invoiceNumber || c.sourceInvoiceNumber || null,
      zohoCreditNoteId: creditNoteResult.noteId,
      zohoCreditNoteNumber: creditNoteResult.noteNumber,
      zohoCreditNoteStatus: creditNoteResult.status,
      zohoCreditNoteError: creditNoteResult.error,
      updatedAt: FieldValue.serverTimestamp(),
    });

    revalidatePath('/admin/dashboard');
    const ok = creditNoteResult.status === 'created';
    return {
      success: ok,
      message: ok
        ? `Credit note synced: ${creditNoteResult.noteNumber || creditNoteResult.noteId}`
        : `Credit note sync ${creditNoteResult.status}: ${creditNoteResult.error || 'No details'}`,
    };
  } catch (e: any) {
    return { success: false, message: `Server action '${actionName}' failed: ${e.message}` };
  }
}

export async function deleteCancellationRequestAction(cancellationId: string, userId: string):Promise<{success:boolean;message:string}>{
  const actionName='deleteCancellationRequestAction'; let adminDb: Firestore;
  try{
    adminDb = getFirestoreInstance();
    if(!cancellationId||!userId)return{success:false,message:"Cancellation ID and User ID required."};
    const cancRef=adminDb.collection('cancellations').doc(cancellationId);
    const cancSnap=await cancRef.get();
    if(!cancSnap.exists)return{success:true,message:"Request already deleted."};
    await cancRef.delete();
    const userRef=adminDb.collection('users').doc(userId);
    const userSnap=await userRef.get();
    if(userSnap.exists){
      const userData=userSnap.data()as User;
      if(userData.activeCancellation&&userData.activeCancellation.cancellationId===cancellationId){
        await userRef.update({activeCancellation:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()});
      }
    }
    revalidatePath('/admin/dashboard');
    revalidatePath('/dashboard');
    return{success:true,message:"Cancellation request deleted."};
  }catch(e:any){return{success:false,message:`Server action '${actionName}' failed: ${e.message}`};}
}

export async function cancelParticipantRegistrationByAdminAction(
    eventId: string,
    participantId: string,
    reason: string,
    sendEmail: boolean
): Promise<{ success: boolean; message: string }> {
  const actionName = 'cancelParticipantRegistrationByAdminAction';
  let adminDb: Firestore;
  try {
    adminDb = getFirestoreInstance();
    const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
      return { success: false, message: 'Participant not found.' };
    }
    const participantData = participantSnap.data() as EventParticipant;

    await participantRef.update({
      ticketStatus: 'Cancelled',
      cancellationDetails: {
        cancelledBy: 'Admin',
        cancellationDate: new Date().toISOString(),
        reason: reason || 'Cancelled by administrator.',
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    const updatedParticipantSnap = await participantRef.get();
    if(updatedParticipantSnap.exists) {
        await _mirrorParticipantToKV(serializeParticipantData(updatedParticipantSnap));
    }

    if (sendEmail && participantData.email) {
      await sendAdminCancellationNoticeEmail(
        participantData.email,
        participantData.name,
        participantData.eventName || 'the event',
        reason
      );
    }
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Participant registration has been cancelled.' };
  } catch (e: any) {
    return { success: false, message: `Failed to cancel registration: ${e.message}` };
  }
}
