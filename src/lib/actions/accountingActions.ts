// src/lib/actions/accountingActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { EventParticipant, FinancialSummary, DeferralEntry, CategoryChangeEntry } from '@/lib/types';
import { getStateName, serializeParticipantData, serializeValue } from '@/lib/utils';
import { deleteZohoInvoice as deleteZohoInvoiceFromService, findInvoiceByReference } from '../zoho/invoice';
import { createServiceFeeInvoiceAction } from './invoiceActions';
import { markInvoiceAsSent } from '../zoho/invoice';
import { applyPaymentToInvoice } from '../zoho/payments';
import { findZohoCustomerByEmail, findZohoCustomerByName } from '../zoho/customer';
import { createZohoCustomer } from '../zoho/customer';
import { format } from 'date-fns';

const toNumberSafe = (value: any): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getPlatformCostFromTransaction = (t: EventParticipant): number => {
  // Primary source: explicit stored fields on participant.
  const directFees = toNumberSafe(t.processingFeePaidPaisa) + toNumberSafe(t.platformFeePaidPaisa);
  if (directFees > 0) return directFees;

  // Fallback source: pricing breakdown (used by newer flows).
  const pb: any = t.pricingBreakdown || {};
  const pricingFees =
    toNumberSafe(pb.processingFeeBase) +
    toNumberSafe(pb.processingGST) +
    toNumberSafe(pb.platformFeeBase) +
    toNumberSafe(pb.platformGST);

  return pricingFees;
};

const getTaxFromTransaction = (t: EventParticipant): number => {
  const directTax = toNumberSafe(t.taxAmountPaidPaisa);
  if (directTax > 0) return directTax;

  const pb: any = t.pricingBreakdown || {};
  return toNumberSafe(pb.eventGST);
};

/**
 * Fetches standard race registration transactions.
 */
const buildEmptyFinancialSummary = (): FinancialSummary => ({
  totalRevenue: 0,
  totalOnlineRevenue: 0,
  totalOfflineRevenue: 0,
  totalTax: 0,
  totalFees: 0,
  netRevenue: 0,
  totalTransactions: 0,
});

export async function getFinancialsForEventAction(eventId?: string): Promise<{
  success: boolean;
  message: string;
  summary?: FinancialSummary;
  transactions?: EventParticipant[];
}> {
  try {
    const adminDb = getFirestoreInstance();
    const isAllEvents = !eventId || eventId === 'all';
    const participantsSnap = isAllEvents
      ? await adminDb.collectionGroup('participants').get()
      : await adminDb.collection('events').doc(eventId).collection('participants').get();
    
    if (participantsSnap.empty) {
      return {
        success: true,
        message: isAllEvents ? 'No transactions found.' : 'No transactions for this event.',
        summary: buildEmptyFinancialSummary(),
        transactions: [],
      };
    }

    const transactions = participantsSnap.docs.map(doc => serializeParticipantData(doc));

    let totalRevenue = 0;
    let totalOnlineRevenue = 0;
    let totalOfflineRevenue = 0;
    let totalTax = 0;
    let totalFees = 0;

    transactions.forEach(t => {
      const amount = toNumberSafe(t.amountPaidPaisa);
      totalRevenue += amount;
      totalTax += getTaxFromTransaction(t);
      totalFees += getPlatformCostFromTransaction(t);
      
      const paymentMethod = (t.paymentMethod || '').toLowerCase();
      const isOffline =
        paymentMethod.includes('offline') ||
        paymentMethod.includes('cash') ||
        paymentMethod.includes('admin manual') ||
        paymentMethod.includes('admin entry');
      const isOnline = !isOffline;
      if (isOnline) {
        totalOnlineRevenue += amount;
      } else {
        totalOfflineRevenue += amount;
      }
    });

    const summary: FinancialSummary = {
      totalRevenue,
      totalOnlineRevenue,
      totalOfflineRevenue,
      totalTax,
      totalFees,
      netRevenue: totalRevenue - totalTax - totalFees,
      totalTransactions: transactions.length,
    };

    // Sort by date DESC
    transactions.sort((a, b) => new Date(b.registeredAt || 0).getTime() - new Date(a.registeredAt || 0).getTime());

    return {
      success: true,
      message: isAllEvents ? 'Consolidated financials fetched.' : 'Financials fetched.',
      summary,
      transactions,
    };

  } catch (e: any) {
    return { success: false, message: `Failed to get financials: ${e.message}` };
  }
}

/**
 * Fetches all deferral fee transactions.
 */
export async function getDeferralAccountingAction(eventId?: string): Promise<{ success: boolean; deferrals?: DeferralEntry[] }> {
    try {
        const db = getFirestoreInstance();
        let query: FirebaseFirestore.Query = db.collection('deferrals').orderBy('createdAt', 'desc');
        
        if (eventId && eventId !== 'all') {
            query = query.where('originalEventId', '==', eventId);
        }

        const snap = await query.get();
        const deferrals = snap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() })) as DeferralEntry[];
        return { success: true, deferrals };
    } catch (e: any) {
        return { success: false, deferrals: [] };
    }
}

/**
 * Fetches all category change upgrade transactions.
 */
export async function getCategoryChangeAccountingAction(eventId?: string): Promise<{ success: boolean; changes?: CategoryChangeEntry[] }> {
    try {
        const db = getFirestoreInstance();
    // IMPORTANT:
    // `where(eventId) + orderBy(createdAt)` requires a composite index.
    // Use where-only in filtered mode and sort in memory.
    let query: FirebaseFirestore.Query = db.collection('categoryChanges');
    if (eventId && eventId !== 'all') {
      query = query.where('eventId', '==', eventId);
    } else {
      query = query.orderBy('createdAt', 'desc');
    }

        const snap = await query.get();
    const changes = snap.docs
      .map(doc => serializeValue({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => {
      const aTime = new Date(String(a?.createdAt || '')).getTime() || 0;
      const bTime = new Date(String(b?.createdAt || '')).getTime() || 0;
      return bTime - aTime;
      }) as CategoryChangeEntry[];
        return { success: true, changes };
    } catch (e: any) {
        return { success: false, changes: [] };
    }
}

export async function deleteZohoInvoiceAction(
  eventId: string,
  participantId: string,
  invoiceId: string | null,
  invoiceNumber: string | null
): Promise<{ success: boolean; message: string; }> {
  const adminDb = getFirestoreInstance();
  const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);

  try {
    let finalInvoiceId = invoiceId;
    if (!finalInvoiceId && invoiceNumber) {
        const foundInvoice = await findInvoiceByReference(invoiceNumber);
        if (foundInvoice) {
            finalInvoiceId = foundInvoice.invoice_id;
        }
    }

    if (finalInvoiceId) {
        await deleteZohoInvoiceFromService(finalInvoiceId);
    }

    await participantRef.update({
        invoiceId: FieldValue.delete(),
        invoiceNumber: FieldValue.delete(),
        zohoSynced: false,
        zohoSyncError: 'Invoice manually deleted by admin.',
        updatedAt: FieldValue.serverTimestamp()
    });

    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Zoho invoice and local records have been cleared.' };
  } catch (e: any) {
    return { success: false, message: `Failed to delete invoice: ${e.message}` };
  }
}

async function resolveZohoCustomerFromAccounting(
  db: Firestore,
  userId?: string | null,
  email?: string | null,
  name?: string | null
): Promise<{ customerId: string | null; userState?: string | null }> {
  let userRef: any = null;
  let userState: string | null = null;

  if (userId) {
    userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const userData = userSnap.data() as any;
      userState = userData?.state || null;
      if (userData?.zohoCustomerId) {
        return { customerId: userData.zohoCustomerId, userState };
      }
    }
  }

  const cleanEmail = String(email || '').trim().toLowerCase();
  if (cleanEmail) {
    const foundByEmail = await findZohoCustomerByEmail(cleanEmail);
    if (foundByEmail?.contact_id) return { customerId: foundByEmail.contact_id, userState };
  }

  const cleanName = String(name || '').trim();
  if (cleanName) {
    const foundByName = await findZohoCustomerByName(cleanName);
    if (foundByName?.contact_id) return { customerId: foundByName.contact_id, userState };
  }

  // Last resort: create Zoho customer from accounting record
  if (cleanEmail || cleanName) {
    const fallbackName = cleanName || cleanEmail || 'Bergman Athlete';
    const stateName = getStateName(userState || 'MH') || 'Maharashtra';

    try {
      const created = await createZohoCustomer({
        contact_name: fallbackName.substring(0, 95),
        email: cleanEmail || undefined,
        gst_treatment: 'consumer',
        billing_address: {
          state: stateName,
          country: 'India',
        },
      });

      if (created?.contact_id) {
        if (userRef) {
          await userRef.set(
            {
              zohoCustomerId: created.contact_id,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        return { customerId: created.contact_id, userState };
      }
    } catch {
      // If already exists race-condition, re-query and continue
      if (cleanEmail) {
        const retryByEmail = await findZohoCustomerByEmail(cleanEmail);
        if (retryByEmail?.contact_id) return { customerId: retryByEmail.contact_id, userState };
      }
      if (cleanName) {
        const retryByName = await findZohoCustomerByName(cleanName);
        if (retryByName?.contact_id) return { customerId: retryByName.contact_id, userState };
      }
    }
  }

  return { customerId: null, userState };
}

async function getEventCurrency(db: Firestore, eventId?: string | null): Promise<'INR' | 'USD'> {
  if (!eventId) return 'INR';
  try {
    const eventSnap = await db.collection('events').doc(eventId).get();
    const code = String(eventSnap.data()?.currency || 'INR').toUpperCase();
    return code === 'USD' ? 'USD' : 'INR';
  } catch {
    return 'INR';
  }
}

export async function syncDeferralInvoiceToZohoAction(deferralId: string): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    const docRef = db.collection('deferrals').doc(deferralId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return { success: false, message: 'Deferral record not found.' };
    }

    const d = docSnap.data() as DeferralEntry;
    const amountPaisa = toNumberSafe(d.totalAmountPaidPaisa);
    if (amountPaisa <= 0) {
      return { success: false, message: 'Deferral has no payable amount for invoicing.' };
    }

    const { customerId, userState } = await resolveZohoCustomerFromAccounting(
      db,
      d.userId,
      d.participantEmail,
      d.participantName || undefined
    );

    if (!customerId) {
      return { success: false, message: 'Zoho customer not found for this deferral.' };
    }

    const currency = await getEventCurrency(db, d.originalEventId);
    const reference = d.paymentId || `DEF-${deferralId}`;

    const existingInvoice = await findInvoiceByReference(reference);
    const invoice = existingInvoice
      ? { invoice_id: existingInvoice.invoice_id, invoiceNumber: existingInvoice.invoice_number }
      : await createServiceFeeInvoiceAction({
          customerId,
          reference,
          date: format(new Date(), 'yyyy-MM-dd'),
          pricing: { totalPayable: amountPaisa, gstRate: currency === 'USD' ? 0 : 0.18 },
          serviceType: 'Deferral',
          eventName: d.originalEventName || 'Event',
          currency,
          userState,
        });

    const invoiceNumber = invoice.invoiceNumber || invoice.invoice_id;
    await markInvoiceAsSent(invoice.invoice_id);

    await docRef.update({
      invoiceId: invoice.invoice_id,
      invoiceNumber,
      zohoSyncStatus: 'success',
      zohoSyncError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      await applyPaymentToInvoice({
        invoice_id: invoice.invoice_id,
        customer_id: customerId,
        amount: Math.max(0.01, Number((amountPaisa / 100).toFixed(2))),
        payment_date: format(new Date(), 'yyyy-MM-dd'),
        reference_number: reference,
        payment_mode: 'Online',
      });
    } catch (paymentErr: any) {
      await docRef.update({
        zohoSyncError: `Invoice created but payment mapping failed: ${paymentErr?.message || paymentErr}`,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { success: true, message: `Deferral invoice synced: ${invoiceNumber} (payment mapping pending)` };
    }

    return { success: true, message: `Deferral invoice synced: ${invoiceNumber}` };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Failed to sync deferral invoice.' };
  }
}

export async function syncCategoryChangeInvoiceToZohoAction(changeId: string): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    const docRef = db.collection('categoryChanges').doc(changeId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return { success: false, message: 'Category change record not found.' };
    }

    const c = docSnap.data() as CategoryChangeEntry;
    const amountPaisa = toNumberSafe(c.totalPaidPaisa);
    if (amountPaisa <= 0) {
      return { success: false, message: 'Category change has no payable amount for invoicing.' };
    }

    const { customerId, userState } = await resolveZohoCustomerFromAccounting(
      db,
      c.userId,
      c.participantEmail,
      c.participantName || undefined
    );

    if (!customerId) {
      return { success: false, message: 'Zoho customer not found for this category change.' };
    }

    const currency = await getEventCurrency(db, c.eventId);
    const reference = c.paymentId || `CAT-${changeId}`;

    const existingInvoice = await findInvoiceByReference(reference);
    const invoice = existingInvoice
      ? { invoice_id: existingInvoice.invoice_id, invoiceNumber: existingInvoice.invoice_number }
      : await createServiceFeeInvoiceAction({
          customerId,
          reference,
          date: format(new Date(), 'yyyy-MM-dd'),
          pricing: { totalPayable: amountPaisa, gstRate: currency === 'USD' ? 0 : 0.18 },
          serviceType: 'Category Change',
          eventName: c.eventId || 'Event',
          currency,
          userState,
        });

    const invoiceNumber = invoice.invoiceNumber || invoice.invoice_id;
    await markInvoiceAsSent(invoice.invoice_id);

    await docRef.update({
      zohoSync: {
        status: 'success',
        retries: toNumberSafe(c.zohoSync?.retries),
        invoiceId: invoice.invoice_id,
        invoiceNumber,
        lastAttempt: new Date().toISOString(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      await applyPaymentToInvoice({
        invoice_id: invoice.invoice_id,
        customer_id: customerId,
        amount: Math.max(0.01, Number((amountPaisa / 100).toFixed(2))),
        payment_date: format(new Date(), 'yyyy-MM-dd'),
        reference_number: reference,
        payment_mode: 'Online',
      });
    } catch (paymentErr: any) {
      await docRef.update({
        zohoSync: {
          status: 'success',
          retries: toNumberSafe(c.zohoSync?.retries),
          invoiceId: invoice.invoice_id,
          invoiceNumber,
          error: `Invoice created but payment mapping failed: ${paymentErr?.message || paymentErr}`,
          lastAttempt: new Date().toISOString(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { success: true, message: `Category change invoice synced: ${invoiceNumber} (payment mapping pending)` };
    }

    return { success: true, message: `Category change invoice synced: ${invoiceNumber}` };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Failed to sync category change invoice.' };
  }
}
