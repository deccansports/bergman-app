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
import { refundPaymentAction } from './paymentActions';
import type { CancellationEntry, BankDetails, User, CancellationStats, EventParticipant } from '@/lib/types';
import { _mirrorParticipantToKV } from './dataSyncActions';


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
  originalProcessingFeePaidPaisa: number | null
): Promise<{ success: boolean; message: string; cancellationId?: string }> {
  const actionName = 'processCancellationRequestAction';
  let adminDb: Firestore;

  try {
    adminDb = getFirestoreInstance();

    if (!eventId || !participantDocId || !athleteUid || !athleteEmail || !eventName || !eventDate) {
      return { success: false, message: "Missing required data for cancellation request." };
    }
    if (calculatedRefundAmountPaisa > 0 && !bankDetails) {
        return { success: false, message: "Bank details are required when a refund is due." };
    }

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

    await participantRef.update({
      ticketStatus: 'Cancelled',
      updatedAt: FieldValue.serverTimestamp(),
    });

    const updatedParticipantSnap = await participantRef.get();
    if(updatedParticipantSnap.exists) {
        await _mirrorParticipantToKV(serializeParticipantData(updatedParticipantSnap));
    }

    const now = new Date();
    const cancellationEntryData: Omit<CancellationEntry, 'id'> = {
      userId: athleteUid,
      eventId,
      participantEmail: athleteEmail.toLowerCase(),
      participantName: participantData?.name || null,
      eventName,
      eventDate,
      originalAmountPaidPaisa,
      calculatedRefundAmountPaisa: calculatedRefundAmountPaisa,
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

    return {
      success: true,
      message: `Cancellation request for ${eventName} submitted. A confirmation has been sent. Calculated refund (if any): ₹${(calculatedRefundAmountPaisa / 100).toFixed(2)}.`,
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
    
    const requests: CancellationEntry[] = snapshot.docs.map(doc => {
        return serializeValue({ id: doc.id, ...doc.data() }) as CancellationEntry;
    });

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

    await cancRef.update({
      status:'Processing',
      refundInitiatedDate: refundInitiatedDate,
      refundTransactionId:refundTransactionId,
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
