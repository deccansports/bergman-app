// src/lib/actions/deferralActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { format, endOfYear, addYears, parseISO } from 'date-fns';
import { serializeParticipantData, toIsoStringSafe, serializeValue, sanitizeMoney, normalizeToE164 } from '@/lib/utils';
import { sendDeferralConfirmationWhatsApp } from '../auth/aisensyService';
import { sendDynamicTemplateEmail, sendDeferralConfirmationEmail, sendMonthlyDeferralReminderEmail } from '../auth/brevoService';
import type { AdminDeferralEditFormInput } from '@/lib/schemas';
import { AdminDeferralEditSchema, AdminManualDeferralCreateSchema, type AdminManualDeferralCreateFormInput } from '@/lib/schemas';
import type { DeferralEntry, User, DeferralStats, EventParticipant, PricingInput } from '@/lib/types';
import { _mirrorParticipantToKV } from './dataSyncActions';
import { applyPaymentToInvoice } from '../zoho/payments';
import { markInvoiceAsSent } from '../zoho/invoice';
import { createServiceFeeInvoiceAction, sendServiceFeeWhatsAppAction, sendInvoiceEmailBrevoAction } from './invoiceActions';
import { calculatePricing } from '@/lib/pricingEngine';
import { PAYMENT_GATEWAY_FEE_PERCENTAGE, PLATFORM_FEE_PAISA, GST_PERCENTAGE, NO_CLUB_SELECTED_VALUE } from '@/lib/constants';

const DEFERRALS_COLLECTION = 'deferrals';
const USERS_COLLECTION = 'users';
const DASHBOARD_VISIBLE_DEFERRAL_STATUSES: Array<DeferralEntry['status']> = ['Pending Ticket Selection', 'Expired'];

function mapDeferralToActiveInfo(deferralId: string, data: Partial<DeferralEntry>) {
  return {
    deferralId,
    participantName: data.participantName || null,
    originalEventName: data.originalEventName || 'Unknown Event',
    originalEventId: data.originalEventId || null,
    originalEventDate: data.originalEventDate || null,
    originalTicketId: data.originalTicketId || null,
    originalAmountPaidPaisa: data.originalAmountPaidPaisa ?? null,
    estimatedOriginalBasePricePaisa: data.estimatedOriginalBasePricePaisa ?? null,
    status: (data.status || 'TBD') as DeferralEntry['status'],
    deferralDate: data.deferralDate || null,
    expiryDate: data.expiryDate || null,
    deferredToEventId: data.deferredToEventId || null,
    deferredToEventName: data.deferredToEventName || null,
    deferredToTicketId: data.deferredToTicketId || null,
    deferredToTicketName: data.deferredToTicketName || null,
    amountDueForUpgradePaisa: data.amountDueForUpgradePaisa ?? null,
    upgradePaymentOrderId: data.upgradePaymentOrderId || null,
    upgradePaymentStatus: data.upgradePaymentStatus || null,
    code: data.code || null,
  };
}

async function sendAdminDeferralRequestNotificationEmail(
  deferralData: Omit<DeferralEntry, 'id' | 'createdAt' | 'updatedAt'> & { createdAt: string }
): Promise<boolean> {
  const actionName = 'sendAdminDeferralRequestNotificationEmail';
  const adminEmail = "info@bergmantri.com";
  const templateId = 201;

  const params = {
    eventname: `DEFERRAL: from ${deferralData.originalEventName}`,
    name: deferralData.participantName,
    amount: "N/A (Deferral Request)"
  };

  return sendDynamicTemplateEmail(templateId, adminEmail, params, actionName);
}

/**
 * handleDeferral
 * CORE LOGIC: Finalizes the deferral of a participant record.
 */
export async function handleDeferral(
  eventId: string,
  participantId: string,
  paymentId?: string | null,
  totalAmountPaidPaisa?: number | null
): Promise<{ success: boolean; message: string; deferralId?: string }> {
  const actionName = 'handleDeferral';
  try {
    const adminDb = getFirestoreInstance();

    const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) throw new Error("Participant not found");
    const participantData = participantSnap.data() as EventParticipant;

    const athleteUid = participantData.athleteUid;
    if (!athleteUid) throw new Error("User profile link missing");

    // 🔥 ALWAYS use what user ACTUALLY PAID (Base - Discount)
    const creditAmount = sanitizeMoney(
      participantData.amountPaidPaisa ?? (
        sanitizeMoney(participantData.pricingBreakdown?.base) -
        sanitizeMoney(participantData.pricingBreakdown?.discount)
      )
    );

    const now = new Date();
    const expiryDate = endOfYear(addYears(now, 1));
    
    // 💰 CALCULATE BREAKDOWN FOR INVOICE
    const eventSnap = await adminDb.collection('events').doc(eventId).get();
    const currency = eventSnap.data()?.currency || 'INR';
    const isUsd = currency === 'USD';

    // Fetch dynamic fee from settings
    const settingsSnap = await adminDb.collection("settings").doc("serviceFees").get();
    const globalFees = settingsSnap.data() || {};
    const raceCategory = (participantData.ticketName || '').toUpperCase();
    const typeKey = raceCategory.includes('SWIM') ? 'Swimming' : (raceCategory.includes('DUATHLON') ? 'Duathlon' : 'Triathlon');

    const baseFee = isUsd
      ? sanitizeMoney(
          (globalFees as any)?.[typeKey]?.deferralFeeUsdCents ??
          (globalFees as any)?.deferralFeeUsdCents ??
          5000
        )
      : sanitizeMoney(
          (globalFees as any)?.[typeKey]?.deferralFeePaisa ??
          (globalFees as any)?.deferralFeePaisa ??
          200000
        );

    const pricingInput: PricingInput = {
        basePrice: baseFee,
        discount: 0,
        gatewayRate: isUsd ? 0.03 : (PAYMENT_GATEWAY_FEE_PERCENTAGE / 100),
        platformFeeBase: isUsd ? 0 : PLATFORM_FEE_PAISA,
        taxEnabled: !isUsd,
        gstRate: isUsd ? 0 : GST_PERCENTAGE / 100,
        currency: isUsd ? 'USD' : 'INR',
    };
    const pricingBreakdown = calculatePricing(pricingInput);

    const deferralEntryData: Omit<DeferralEntry, 'id' | 'createdAt' | 'updatedAt'> = {
      userId: athleteUid,
      participantEmail: participantData.email || '',
      participantName: participantData.name || "Athlete",
      originalEventName: participantData.eventName || 'Unknown Event',
      originalEventId: eventId,
      originalTicketId: participantData.ticketId || null,
      originalEventDate: participantData.eventDate || null,
      deferralDate: format(now, 'yyyy-MM-dd'),
      status: 'Pending Ticket Selection',
      expiryDate: format(expiryDate, 'yyyy-MM-dd'),
      originalAmountPaidPaisa: creditAmount,
      estimatedOriginalBasePricePaisa: creditAmount,
      totalAmountPaidPaisa: totalAmountPaidPaisa || pricingBreakdown.totalPayable,
      paymentId: paymentId || null,
      code: null,
      deferredToEventId: null,
      deferredToEventName: null,
      deferredToTicketId: null,
      deferredToTicketName: null,
      amountDueForUpgradePaisa: null,
      upgradePaymentOrderId: null,
      upgradePaymentStatus: 'NotRequired',
    };
    
    // 1. CREATE DEFERRAL RECORD
    const newDeferralRef = await adminDb.collection(DEFERRALS_COLLECTION).add({ 
        ...deferralEntryData, 
        createdAt: FieldValue.serverTimestamp(), 
        updatedAt: FieldValue.serverTimestamp(),
        zohoSyncStatus: 'pending',
        zohoSyncRetries: 0
    });

    // 2. UPDATE USER STATE
    await adminDb.collection(USERS_COLLECTION).doc(athleteUid).update({ 
        activeDeferral: { deferralId: newDeferralRef.id, ...deferralEntryData }, 
        updatedAt: FieldValue.serverTimestamp() 
    });

    // 3. UPDATE PARTICIPANT ROSTER
    await participantRef.update({ 
        ticketStatus: 'Deferred', 
        bibNumber: null, 
        updatedAt: FieldValue.serverTimestamp() 
    });
    
    const updatedSnap = await participantRef.get();
    await _mirrorParticipantToKV(serializeParticipantData(updatedSnap));

    // 4. ATTEMPT ZOHO SYNC (NON-BLOCKING)
    if (paymentId) {
      (async () => {
        try {
          console.log(`[handleDeferral] Starting Zoho sync for payment ${paymentId}...`);
          const userDoc = await adminDb.collection(USERS_COLLECTION).doc(athleteUid).get();
          const userData = userDoc.data() as User;
          const customerId = userData?.zohoCustomerId;
          const userState = userData?.state || null;

          if (customerId) {
            const invoice = await createServiceFeeInvoiceAction({
              customerId,
              reference: paymentId,
              date: format(new Date(), "yyyy-MM-dd"),
              pricing: pricingBreakdown, 
              serviceType: 'Deferral',
              eventName: participantData.eventName || 'Event',
              currency: isUsd ? 'USD' : 'INR',
              userState
            });

            const invoiceNumber = invoice.invoiceNumber || invoice.invoice_id;

            await markInvoiceAsSent(invoice.invoice_id);
            
            const appliedAmount = Math.max(1, Math.round(pricingBreakdown.totalPayable / 100));

            await applyPaymentToInvoice({
              invoice_id: invoice.invoice_id, 
              customer_id: customerId, 
              amount: appliedAmount,
              payment_date: format(new Date(), "yyyy-MM-dd"),
              reference_number: paymentId,
              payment_mode: "Online",
            });

            await newDeferralRef.update({ 
                zohoSyncStatus: 'success', 
                invoiceId: invoice.invoice_id, 
              invoiceNumber 
            });

            // 🔥 Trigger WhatsApp Delivery for Service Fee
            const mobileToSend = normalizeToE164(participantData.mobile || userData.mobile);
            if (mobileToSend) {
                console.log(`[handleDeferral] Dispatching WhatsApp invoice to ${mobileToSend}...`);
                await sendServiceFeeWhatsAppAction({
                    orderId: newDeferralRef.id,
                    invoiceId: invoice.invoice_id,
                  invoiceNumber,
                    mobile: mobileToSend,
                    name: participantData.name || "Athlete",
                    serviceType: 'Deferral',
                    eventName: participantData.eventName || 'Event'
                });
            }

            // 🔥 Trigger Brevo Invoice Email (template 256)
            if (participantData.email) {
                sendInvoiceEmailBrevoAction({
                    invoiceId: invoice.invoice_id,
                  invoiceNumber,
                    recipientEmail: participantData.email,
                    name: participantData.name || 'Athlete',
                    eventName: participantData.eventName || 'Event',
                    category: participantData.ticketName || 'N/A',
                    eventDate: participantData.eventDate || null,
                    amountPaisa: pricingBreakdown.totalPayable,
                }).catch(e => console.warn('[handleDeferral] Brevo invoice email failed:', e.message));
            }
          }
        } catch (zohoErr: any) {
          console.warn("[handleDeferral] Zoho Background Failure:", zohoErr.message);
          await newDeferralRef.update({ zohoSyncStatus: 'failed', zohoSyncError: zohoErr.message });
        }
      })();
    }

    // 5. NOTIFICATIONS
    sendAdminDeferralRequestNotificationEmail({ ...deferralEntryData, createdAt: new Date().toISOString() } as any).catch(() => {});
    if (participantData.email) {
        sendDeferralConfirmationEmail(participantData.email, participantData.name, deferralEntryData.originalEventName, null).catch(() => {});
    }
    if (participantData.mobile) {
      sendDeferralConfirmationWhatsApp(participantData.mobile, participantData.name, deferralEntryData.originalEventName, null).catch(() => {});
    }

    revalidatePath('/dashboard');
    return { success: true, message: "Deferral confirmed and credit issued.", deferralId: newDeferralRef.id };
  } catch (error: any) {
    console.error(`[${actionName}] Deferral Error:`, error.message);
    return { success: false, message: error.message };
  }
}

export async function requestDeferralAction(
  eventId: string,
  participantId: string,
  paymentId?: string | null,
  totalAmountPaidPaisa?: number | null
) {
  return await handleDeferral(eventId, participantId, paymentId, totalAmountPaidPaisa);
}

export async function getDeferralStatsAction(): Promise<{ success: boolean; message: string; stats?: DeferralStats }> {
  try {
    const adminDb = getFirestoreInstance();
    const deferralsRef = adminDb.collection(DEFERRALS_COLLECTION);
    
    const [totalSnap, pendingSnap, completedSnap, deniedSnap, expiredSnap] = await Promise.all([
      deferralsRef.count().get(),
      deferralsRef.where('status', 'in', ['Pending', 'Pending Ticket Selection']).count().get(),
      deferralsRef.where('status', 'in', ['Used', 'Confirmed']).count().get(),
      deferralsRef.where('status', '==', 'RevokedByAdmin').count().get(),
      deferralsRef.where('status', '==', 'Expired').count().get()
    ]);

    const stats: DeferralStats = {
      totalDeferrals: totalSnap.data().count,
      completedDeferrals: completedSnap.data().count,
      pendingDeferrals: pendingSnap.data().count,
      expiredDeferrals: expiredSnap.data().count,
      deniedRequests: deniedSnap.data().count,
    };

    return { success: true, message: "Stats fetched.", stats: serializeValue(stats) };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getAllDeferralsAction(): Promise<{ success: boolean; message: string; deferrals?: DeferralEntry[] }> {
    try {
        const adminDb = getFirestoreInstance();
        const snapshot = await adminDb.collection(DEFERRALS_COLLECTION).orderBy('deferralDate', 'desc').get();
        const deferrals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DeferralEntry));
        return { success: true, message: 'Fetched.', deferrals: serializeValue(deferrals) };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function updateDeferralAction(deferralId: string, data: AdminDeferralEditFormInput): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const validation = AdminDeferralEditSchema.safeParse(data);
    if (!validation.success) return { success: false, message: validation.error.errors[0].message };

    const existingDoc = await adminDb.collection(DEFERRALS_COLLECTION).doc(deferralId).get();
    if (!existingDoc.exists) {
      return { success: false, message: 'Deferral not found.' };
    }

    const existingData = existingDoc.data() as DeferralEntry;
    const vD = validation.data;
    const normalizeOptionalSelection = (value?: string) => {
      const trimmed = String(value || '').trim();
      if (!trimmed || trimmed === 'NONE' || trimmed === '--no-assignment-placeholder--') return null;
      return trimmed;
    };

    const updatePayload: any = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (vD.participantName !== undefined) updatePayload.participantName = vD.participantName;
    if (vD.participantEmail !== undefined) updatePayload.participantEmail = vD.participantEmail;
    if (vD.status !== undefined) updatePayload.status = vD.status;
    if (vD.expiryDate !== undefined) updatePayload.expiryDate = vD.expiryDate ? format(vD.expiryDate, 'yyyy-MM-dd') : null;
    if (vD.estimatedOriginalBasePricePaisa !== undefined) updatePayload.estimatedOriginalBasePricePaisa = vD.estimatedOriginalBasePricePaisa;
    if (vD.originalAmountPaidPaisa !== undefined) updatePayload.originalAmountPaidPaisa = vD.originalAmountPaidPaisa;
    if (vD.adminNotes !== undefined) updatePayload.notes = vD.adminNotes || null;

    if (vD.deferredToEventId !== undefined) {
      const normalizedEventId = normalizeOptionalSelection(vD.deferredToEventId);
      updatePayload.deferredToEventId = normalizedEventId;

      if (!normalizedEventId) {
        updatePayload.deferredToEventName = null;
        updatePayload.deferredToTicketId = null;
        updatePayload.deferredToTicketName = null;
      } else {
        const eventSnap = await adminDb.collection('events').doc(normalizedEventId).get();
        updatePayload.deferredToEventName = eventSnap.exists
          ? String(eventSnap.data()?.eventName || existingData.deferredToEventName || 'Unknown Event')
          : (existingData.deferredToEventName || 'Unknown Event');
      }
    }

    if (vD.deferredToTicketId !== undefined) {
      const normalizedTicketId = normalizeOptionalSelection(vD.deferredToTicketId);
      updatePayload.deferredToTicketId = normalizedTicketId;

      if (!normalizedTicketId) {
        updatePayload.deferredToTicketName = null;
      } else {
        const eventIdForTicket = normalizeOptionalSelection(vD.deferredToEventId) || existingData.deferredToEventId || null;
        if (eventIdForTicket) {
          const ticketSnap = await adminDb
            .collection('events')
            .doc(eventIdForTicket)
            .collection('ticketDefinitions')
            .doc(normalizedTicketId)
            .get();
          updatePayload.deferredToTicketName = ticketSnap.exists
            ? String(ticketSnap.data()?.ticketName || existingData.deferredToTicketName || 'Unknown Ticket')
            : (existingData.deferredToTicketName || 'Unknown Ticket');
        }
      }
    }

    await adminDb.collection(DEFERRALS_COLLECTION).doc(deferralId).update(updatePayload);

    // Keep users/{uid}.activeDeferral in sync with edited deferral records.
    const updatedDoc = await adminDb.collection(DEFERRALS_COLLECTION).doc(deferralId).get();
    if (updatedDoc.exists) {
      const updatedData = updatedDoc.data() as DeferralEntry;
      const status = updatedData.status as DeferralEntry['status'];
      const userId = updatedData.userId;

      if (userId) {
        if (DASHBOARD_VISIBLE_DEFERRAL_STATUSES.includes(status)) {
          await adminDb.collection(USERS_COLLECTION).doc(userId).set({
            activeDeferral: mapDeferralToActiveInfo(deferralId, updatedData),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } else {
          await adminDb.collection(USERS_COLLECTION).doc(userId).set({
            activeDeferral: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      }
    }

    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Updated.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getActiveDeferralForUserAction(uid?: string | null, email?: string | null): Promise<{ success: boolean; message: string; activeDeferral?: any | null }> {
  try {
    const adminDb = getFirestoreInstance();
    const cleanUid = String(uid || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanUid && !cleanEmail) {
      return { success: false, message: 'UID or email is required.', activeDeferral: null };
    }

    const candidateDocs: Array<{ id: string; data: DeferralEntry }> = [];

    if (cleanUid) {
      const byUid = await adminDb
        .collection(DEFERRALS_COLLECTION)
        .where('userId', '==', cleanUid)
        .get();
      byUid.docs.forEach((doc) => candidateDocs.push({ id: doc.id, data: doc.data() as DeferralEntry }));
    }

    if (cleanEmail) {
      const byEmail = await adminDb
        .collection(DEFERRALS_COLLECTION)
        .where('participantEmail', '==', cleanEmail)
        .get();
      byEmail.docs.forEach((doc) => {
        if (!candidateDocs.some((c) => c.id === doc.id)) {
          candidateDocs.push({ id: doc.id, data: doc.data() as DeferralEntry });
        }
      });
    }

    if (candidateDocs.length === 0) {
      return { success: true, message: 'No deferral found.', activeDeferral: null };
    }

    const statusPriority: DeferralEntry['status'][] = ['Pending Ticket Selection', 'Pending Upgrade Payment', 'Pending', 'Processing', 'ProcessingConfirmation', 'Expired'];

    const sorted = candidateDocs.sort((a, b) => {
      const aIdx = statusPriority.indexOf(a.data.status as DeferralEntry['status']);
      const bIdx = statusPriority.indexOf(b.data.status as DeferralEntry['status']);
      const aPriority = aIdx === -1 ? 999 : aIdx;
      const bPriority = bIdx === -1 ? 999 : bIdx;
      if (aPriority !== bPriority) return aPriority - bPriority;

      const aTs = new Date(String(a.data.updatedAt || a.data.createdAt || 0)).getTime();
      const bTs = new Date(String(b.data.updatedAt || b.data.createdAt || 0)).getTime();
      return bTs - aTs;
    });

    const picked = sorted[0];
    const enrichedPickedData: Partial<DeferralEntry> = { ...picked.data };

    if ((!enrichedPickedData.originalEventName || enrichedPickedData.originalEventName === 'Unknown Event') && enrichedPickedData.originalEventId) {
      const eventSnap = await adminDb.collection('events').doc(enrichedPickedData.originalEventId).get();
      if (eventSnap.exists) {
        const eventData = eventSnap.data() as any;
        enrichedPickedData.originalEventName = String(eventData?.eventName || enrichedPickedData.originalEventName || 'Unknown Event');
        enrichedPickedData.originalEventDate = enrichedPickedData.originalEventDate || (eventData?.eventDate ? String(eventData.eventDate) : null);

        await adminDb.collection(DEFERRALS_COLLECTION).doc(picked.id).set({
          originalEventName: enrichedPickedData.originalEventName,
          originalEventDate: enrichedPickedData.originalEventDate || null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    const activeDeferral = mapDeferralToActiveInfo(picked.id, enrichedPickedData);

    // Self-heal missing user.activeDeferral (best effort)
    const userIdToSync = cleanUid || picked.data.userId || '';
    if (userIdToSync && DASHBOARD_VISIBLE_DEFERRAL_STATUSES.includes(activeDeferral.status)) {
      await adminDb.collection(USERS_COLLECTION).doc(userIdToSync).set({
        activeDeferral,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return { success: true, message: 'Fetched.', activeDeferral: serializeValue(activeDeferral) };
  } catch (e: any) {
    return { success: false, message: e.message, activeDeferral: null };
  }
}

export async function deleteDeferralAction(deferralId: string, userId: string): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection(DEFERRALS_COLLECTION).doc(deferralId).delete();
    await adminDb.collection(USERS_COLLECTION).doc(userId).update({ 
        activeDeferral: FieldValue.delete(), 
        updatedAt: FieldValue.serverTimestamp() 
    });
    revalidatePath('/admin/dashboard');
    return { success: true, message: "Deleted." };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function addManualDeferralAction(data: AdminManualDeferralCreateFormInput): Promise<{ success: boolean; message: string; deferralId?: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const vD = AdminManualDeferralCreateSchema.parse(data);
    const userQuery = await adminDb.collection(USERS_COLLECTION).where('email', '==', vD.email.toLowerCase()).limit(1).get();
    
    if (userQuery.empty) throw new Error("User not found with this email.");
    const userId = userQuery.docs[0].id;

    const originalEventSnap = await adminDb.collection('events').doc(vD.originalEventId).get();
    const originalEventData = originalEventSnap.exists ? originalEventSnap.data() : null;
    const originalEventName = String(originalEventData?.eventName || 'Unknown Event');
    const originalEventDate = originalEventData?.eventDate ? String(originalEventData.eventDate) : null;

    const deferralEntryData = {
      userId,
      participantEmail: vD.email.toLowerCase(),
      participantName: vD.name,
      originalEventName,
      originalEventId: vD.originalEventId,
      originalEventDate,
      originalAmountPaidPaisa: vD.originalAmountPaidPaisa,
      estimatedOriginalBasePricePaisa: vD.estimatedOriginalBasePricePaisa,
      deferralDate: format(vD.deferralDate, 'yyyy-MM-dd'),
      expiryDate: format(vD.expiryDate, 'yyyy-MM-dd'),
      status: 'Pending Ticket Selection',
      notes: vD.adminNotes || 'Manually issued by administrator.',
    };

    const newRef = await adminDb.collection(DEFERRALS_COLLECTION).add({
        ...deferralEntryData,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    await adminDb.collection(USERS_COLLECTION).doc(userId).update({
        activeDeferral: { deferralId: newRef.id, ...deferralEntryData }
    });

    revalidatePath('/admin/dashboard');
    return { success: true, message: "Manual deferral created.", deferralId: newRef.id };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getDeferralDetailsByIdAction(deferralId: string): Promise<{ success: boolean; message: string; deferral?: DeferralEntry }> {
    try {
        const adminDb = getFirestoreInstance();
        const doc = await adminDb.collection(DEFERRALS_COLLECTION).doc(deferralId).get();
        if (!doc.exists) return { success: false, message: "Not found." };

        const deferral = serializeValue({ id: doc.id, ...doc.data() }) as DeferralEntry;
        const status = String(deferral.status || '').trim();
        const allowedStatuses = new Set<DeferralEntry['status'] | string>(['Pending', 'Pending Ticket Selection']);
        if (!allowedStatuses.has(status)) {
            return { success: false, message: `This deferral is already ${status || 'used'} and cannot be applied again.` };
        }

        return { success: true, message: 'Fetched.', deferral };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function sendMonthlyDeferralReminderEmailAction(): Promise<{ success: boolean; message: string }> {
    try {
        const db = getFirestoreInstance();
        const pending = await db.collection(DEFERRALS_COLLECTION).where('status', 'in', ['Pending', 'Pending Ticket Selection']).get();
        let count = 0;
        for (const doc of pending.docs) {
            const data = doc.data() as DeferralEntry;
            const res = await sendMonthlyDeferralReminderEmail(data.participantEmail, data.participantName || null);
            if (res) count++;
        }
        return { success: true, message: `Reminders sent to ${count} athletes.` };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function sendManualDeferralReminderAction(id: string, channel: 'email' | 'whatsapp'): Promise<{ success: boolean; message: string }> {
    try {
        const db = getFirestoreInstance();
        const doc = await db.collection(DEFERRALS_COLLECTION).doc(id).get();
        if (!doc.exists) throw new Error("Deferral not found.");
        const data = doc.data() as DeferralEntry;

        if (channel === 'email') {
            const res = await sendMonthlyDeferralReminderEmail(data.participantEmail, data.participantName || null);
            return { success: res, message: res ? 'Email sent.' : 'Failed to send email.' };
        } else {
            const userSnap = await db.collection(USERS_COLLECTION).doc(data.userId).get();
            const userData = userSnap.data() as User;
            const mobile = normalizeToE164(userData?.mobile);
            if (!mobile) throw new Error("No valid mobile number on profile.");
            
            const res = await sendDeferralConfirmationWhatsApp(mobile, data.participantName || 'Athlete', data.originalEventName, data.expiryDate);
            return { success: res.success, message: res.message };
        }
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}
