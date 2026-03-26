// src/lib/actions/accountingActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { EventParticipant, FinancialSummary, DeferralEntry, CategoryChangeEntry } from '@/lib/types';
import { serializeParticipantData, serializeValue } from '@/lib/utils';
import { deleteZohoInvoice as deleteZohoInvoiceFromService, findInvoiceByReference } from '../zoho/invoice';

/**
 * Fetches standard race registration transactions.
 */
export async function getFinancialsForEventAction(eventId: string): Promise<{
  success: boolean;
  message: string;
  summary?: FinancialSummary;
  transactions?: EventParticipant[];
}> {
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const participantsSnap = await adminDb.collection('events').doc(eventId).collection('participants').get();
    
    if (participantsSnap.empty) {
      return { success: true, message: "No transactions for this event.", summary: { totalRevenue: 0, totalOnlineRevenue: 0, totalOfflineRevenue: 0, totalTax: 0, totalFees: 0, netRevenue: 0, totalTransactions: 0 }, transactions: [] };
    }

    const transactions = participantsSnap.docs.map(doc => serializeParticipantData(doc));

    let totalRevenue = 0;
    let totalOnlineRevenue = 0;
    let totalOfflineRevenue = 0;
    let totalTax = 0;
    let totalFees = 0;

    transactions.forEach(t => {
      const amount = t.amountPaidPaisa ?? 0;
      totalRevenue += amount;
      totalTax += t.taxAmountPaidPaisa ?? 0;
      totalFees += (t.processingFeePaidPaisa ?? 0) + (t.platformFeePaidPaisa ?? 0);
      
      const isOnline = t.paymentMethod?.toLowerCase() !== 'offline/bulk' && t.paymentMethod?.toLowerCase() !== 'cash' && t.paymentMethod?.toLowerCase() !== 'admin entry';
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

    return { success: true, message: "Financials fetched.", summary, transactions };

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
        let query: FirebaseFirestore.Query = db.collection('categoryChanges').orderBy('createdAt', 'desc');
        
        if (eventId && eventId !== 'all') {
            query = query.where('eventId', '==', eventId);
        }

        const snap = await query.get();
        const changes = snap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() })) as CategoryChangeEntry[];
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
