'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { syncPaymentToZohoAction } from './invoiceActions';
import { zohoFetch } from '@/lib/zoho/fetch';

/**
 * Manual Zoho Sync Debug Action
 * Allows admin to manually trigger Zoho sync for a failed participant and see detailed error logs
 */
export async function debugZohoSyncAction(eventId: string, participantId: string) {
  const db = getFirestoreInstance();
  const participantRef = db.collection('events').doc(eventId).collection('participants').doc(participantId);

  try {
    console.log(`[Zoho Debug] Starting sync for participant: ${participantId}`);
    
    const snap = await participantRef.get();
    if (!snap.exists) {
      return { success: false, message: "Participant not found", details: {} };
    }

    const participant = snap.data() as any;
    console.log(`[Zoho Debug] Participant data:`, {
      bookingId: participant.bookingId,
      name: participant.name,
      email: participant.email,
      gstin: participant.gstin ? '***' : 'None',
      confirmGstDetails: participant.confirmGstDetails,
      amountPaidPaisa: participant.amountPaidPaisa,
      zohoSynced: participant.zohoSynced,
      previousError: participant.zohoSyncError,
    });

    // Check if pricing breakdown exists and is valid
    if (!participant.pricingBreakdown) {
      return { 
        success: false, 
        message: "Pricing breakdown missing", 
        details: { error: "pricingBreakdown field is missing from participant record" } 
      };
    }

    console.log(`[Zoho Debug] Pricing breakdown:`, participant.pricingBreakdown);

    // Attempt the sync
    const result = await syncPaymentToZohoAction(eventId, participantId);
    
    // Re-fetch to get updated error if any
    const updated = await participantRef.get();
    const updatedData = updated.data() as any;

    return {
      success: result.success,
      message: result.message,
      details: {
        syncResult: result,
        currentZohoSynced: updatedData.zohoSynced,
        currentZohoError: updatedData.zohoSyncError,
        bookingId: participant.bookingId,
        customerName: participant.name,
      }
    };

  } catch (error: any) {
    const errorMsg = error.zohoMessage || error.message || "Unknown error";
    const errorCode = error.zohoCode || error.response?.status || "Unknown";
    console.error(`[Zoho Debug] Sync failed:`, errorMsg);
    
    return {
      success: false,
      message: errorMsg,
      details: {
        errorCode,
        errorMessage: errorMsg,
        participantId,
      }
    };
  }
}

/**
 * Test Zoho API Connection
 * Verifies API credentials and basic connectivity
 */
export async function testZohoConnectionAction() {
  try {
    const orgId = process.env.ZOHO_ORG_ID || "60013782026";
    console.log(`[Zoho Test] Testing connection to org: ${orgId}`);
    
    const data = await zohoFetch('/contacts', { params: { page: 1, per_page: 1 } });
    
    return {
      success: true,
      message: "Zoho connection OK",
      details: {
        orgId,
        contactsCount: data.contacts?.length || 0,
      }
    };
  } catch (error: any) {
    const errorMsg = error.zohoMessage || error.message || "Unknown error";
    const errorCode = error.zohoCode || error.response?.status || "Unknown";
    
    return {
      success: false,
      message: `Zoho connection failed: ${errorMsg}`,
      details: {
        errorCode,
        errorMessage: errorMsg,
        suggestion: errorCode === 401 ? "Check ZOHO_API_KEY and ZOHO_REFRESH_TOKEN" : "Check ZOHO_API_DOMAIN and ZOHO_ORG_ID",
      }
    };
  }
}

/**
 * Retry Failed Zoho Syncs
 * Finds all participants with zohoSyncError and attempts to resync them
 */
export async function retryFailedZohoSyncsAction(eventId: string) {
  const db = getFirestoreInstance();
  let retried = 0;
  let success = 0;
  const errors: Array<{ participantId: string; error: string }> = [];

  try {
    console.log(`[Zoho Retry] Finding failed syncs for event: ${eventId}`);
    
    // Query both zohoSynced===false and zohoSyncPending===true to catch all unsynced registrations.
    const [unsyncedSnap, pendingSnap] = await Promise.all([
      db.collection('events').doc(eventId).collection('participants')
        .where('zohoSynced', '==', false).limit(20).get(),
      db.collection('events').doc(eventId).collection('participants')
        .where('zohoSyncPending', '==', true).limit(20).get(),
    ]);

    // Deduplicate by doc ID
    const docMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const doc of [...unsyncedSnap.docs, ...pendingSnap.docs]) docMap.set(doc.id, doc);
    const query = { docs: Array.from(docMap.values()) };

    console.log(`[Zoho Retry] Found ${query.docs.length} participants with sync errors`);

    for (const doc of query.docs) {
      const participantId = doc.id;
      retried++;

      try {
        console.log(`[Zoho Retry] Attempting sync for: ${participantId}`);
        const result = await syncPaymentToZohoAction(eventId, participantId);
        
        if (result.success) {
          success++;
          console.log(`[Zoho Retry] Success for ${participantId}`);
        } else {
          errors.push({ participantId, error: result.message });
          console.log(`[Zoho Retry] Failed for ${participantId}: ${result.message}`);
        }
      } catch (error: any) {
        const msg = error.message || "Unknown error";
        errors.push({ participantId, error: msg });
        console.error(`[Zoho Retry] Exception for ${participantId}:`, msg);
      }
    }

    return {
      success: success === retried,
      message: `Retried ${retried} sync attempts, ${success} succeeded`,
      details: { retried, success, failed: errors.length, errors }
    };

  } catch (error: any) {
    return {
      success: false,
      message: `Retry batch failed: ${error.message}`,
      details: { retried, success, errors }
    };
  }
}
