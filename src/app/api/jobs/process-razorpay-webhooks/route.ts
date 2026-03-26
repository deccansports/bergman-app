// src/app/api/jobs/process-razorpay-webhooks/route.ts
import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { syncPaymentToZohoAction } from '@/lib/actions/invoiceActions';
import { FieldValue } from 'firebase-admin/firestore';
import Razorpay from 'razorpay';

export const dynamic = "force-dynamic";

let razorpayInstance: Razorpay | null = null;
if (process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  try {
    razorpayInstance = new Razorpay({ key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  } catch(e) {
    console.error("Failed to initialize Razorpay instance for webhook job:", e);
    razorpayInstance = null;
  }
}


async function handleWebhookEvent(payload: any, db: FirebaseFirestore.Firestore) {
    const actionName = '[Razorpay Webhook Job Handler]';
  
    const eventType = payload.event;
    
    if (eventType !== 'payment.captured') {
        return { success: true, message: `Event type ${eventType} ignored.`, status: 'IGNORED' };
    }

    const paymentId = payload.payload?.payment?.entity?.id;
    if (!paymentId) {
        throw new Error("Missing payment ID in webhook payload.");
    }
    
    if (!razorpayInstance) throw new Error("Razorpay instance not available.");
    const payment = await razorpayInstance.payments.fetch(paymentId);
    if (payment.status !== 'captured') {
        console.log(`[${actionName}] Payment ${paymentId} not captured yet. Skipping.`);
        return { success: true, message: 'Payment not captured.', status: 'SKIPPED' };
    }

    const participantsSnapshot = await db.collectionGroup('participants').where('transactionId', '==', paymentId).limit(1).get();
    
    if (participantsSnapshot.empty) {
        console.warn(`[${actionName}] Orphan payment detected: ${paymentId}. No participant found. Logging for manual review.`);
        await db.collection('orphanPayments').doc(paymentId).set({
            paymentId,
            email: payment.email,
            amount: payment.amount,
            notes: payment.notes,
            createdAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return { success: true, message: 'Orphan payment logged.', status: 'ORPHANED' };
    }
    
    const participantDoc = participantsSnapshot.docs[0];
    const registration = participantDoc.data();
    
    if (registration.zohoSynced === true) {
        console.log(`[${actionName}] Participant ${participantDoc.id} already synced. Skipping.`);
        return { success: true, message: 'Already synced.', status: 'SKIPPED_DUPLICATE' };
    }
    
    console.log(`[${actionName}] Triggering Zoho sync for participant ${participantDoc.id} from webhook job.`);
    const syncResult = await syncPaymentToZohoAction(registration.eventId, participantDoc.id);

    if (!syncResult.success) {
        throw new Error(syncResult.message || `Zoho sync failed for participant ${participantDoc.id}.`);
    }

    return { success: true, message: 'Webhook processed and Zoho sync triggered.', status: 'PROCESSED' };
}


export async function POST() {
  console.log('🔥 Manual Webhook Processing Job Triggered 🔥');
  const db = getFirestoreInstance();
  const results = { processed: 0, failed: 0, skipped: 0, orphaned: 0, ignored: 0 };

  const snap = await db
    .collection('webhookLogs')
    .where('status', 'in', ['RECEIVED', 'FAILED']) // Process new and previously failed webhooks
    .orderBy('receivedAt', 'asc') // Process oldest first
    .limit(20) // Process up to 20 at a time to avoid timeouts
    .get();

  if (snap.empty) {
    return NextResponse.json({ success: true, message: 'No pending or failed webhooks to process.', ...results });
  }

  for (const logDoc of snap.docs) {
    const logData = logDoc.data();
    const payload = logData.payload;

    if (!payload) {
      await logDoc.ref.update({ status: 'FAILED', error: 'Missing payload in log.', processedAt: FieldValue.serverTimestamp() });
      results.failed++;
      continue;
    }

    try {
      const result = await handleWebhookEvent(payload, db);
      await logDoc.ref.update({ status: result.status, processedAt: new Date(), detail: result.message, error: null });

      switch(result.status) {
        case 'PROCESSED': results.processed++; break;
        case 'SKIPPED_DUPLICATE': results.skipped++; break;
        case 'ORPHANED': results.orphaned++; break;
        case 'IGNORED': results.ignored++; break;
        default: results.skipped++; break;
      }
    } catch (e: any) {
      console.error(`[ProcessWebhooksJob] Processing failed for log ${logDoc.id}:`, e.message);
      await logDoc.ref.update({ status: 'FAILED', error: e.message, processedAt: new Date() });
      results.failed++;
    }
  }

  return NextResponse.json({ success: true, message: `Job finished. Processed: ${results.processed}, Failed: ${results.failed}, Skipped: ${results.skipped}, Orphaned: ${results.orphaned}, Ignored: ${results.ignored}.`, ...results });
}
