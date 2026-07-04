// src/api/webhooks/razorpay/route.ts

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { finalizeRegistration } from '@/lib/registrationEngine/finalizeRegistration';

export const runtime = 'nodejs'; // REQUIRED for crypto

export async function POST(req: NextRequest) {
  const actionName = '[Razorpay Webhook]';
  const db = getFirestoreInstance();

  let webhookId = `evt_${Date.now()}`;

  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
      console.error(`${actionName} ❌ Missing RAZORPAY_WEBHOOK_SECRET`);
      return NextResponse.json({ error: 'Webhook secret missing' }, { status: 500 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');

    if (!signature) {
      console.error(`${actionName} ❌ Missing signature header`);
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    // 🔐 Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.error(`${actionName} ❌ Signature mismatch`);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const payload = JSON.parse(rawBody);
    webhookId = payload.id || webhookId;

    const logRef = db.collection('webhookLogs').doc(webhookId);

    // 🛑 Idempotency check
    const existingLog = await logRef.get();
    if (existingLog.exists && existingLog.data()?.status === 'processed') {
      console.log(`${actionName} ⚠️ Already processed: ${webhookId}`);
      return NextResponse.json({ ok: true });
    }

    const event = payload.event;
    const payment = payload?.payload?.payment?.entity;
    const paymentId = payment?.id;
    const paymentMethod = payment?.method; // e.g., 'card', 'upi'

    await logRef.set(
      {
        event,
        razorpayPaymentId: paymentId || null,
        status: 'processing',
        receivedAt: FieldValue.serverTimestamp(),
        source: 'razorpay',
      },
      { merge: true }
    );

    // Only process payment.captured
    if (event !== 'payment.captured') {
      await logRef.update({
        status: 'ignored',
        detail: `Ignored event type: ${event}`,
      });
      return NextResponse.json({ ok: true });
    }

    if (!paymentId) {
      throw new Error('Missing payment ID in webhook payload');
    }

    /**
     * 🔥 CRITICAL PART
     * Try multiple ways to identify registrationAttempt
     */

    const paymentType = String(payment?.notes?.type || '').trim().toLowerCase();
    if (paymentType && paymentType !== 'event_registration') {
      await logRef.update({
        status: 'ignored',
        detail: `Ignored payment type: ${paymentType}`,
      });
      return NextResponse.json({ ok: true });
    }

    const registrationAttemptId = payment?.notes?.registrationAttemptId || null;

    if (!registrationAttemptId) {
      await logRef.update({
        status: 'ignored',
        detail: 'Missing registrationAttemptId in Razorpay payment notes',
      });
      return NextResponse.json({ ok: true });
    }

    console.log(`${actionName} 🔥 Processing attempt: ${registrationAttemptId}`);

    const attemptRef = db.collection('registrationAttempts').doc(registrationAttemptId);
    const attemptSnap = await attemptRef.get();

    if (!attemptSnap.exists) {
      throw new Error(`registrationAttempt not found: ${registrationAttemptId}`);
    }

    const attemptData = attemptSnap.data();
    console.log(`${actionName} Fetched attempt:`, JSON.stringify(attemptData, null, 2));

    // Idempotency: only skip when already fully completed with a participant.
    // If status is PaymentCaptured (but not completed), continue to finalize/recover.
    if (attemptData?.status === 'Completed' && attemptData?.participantId) {
      console.log(`${actionName} ⚠️ Attempt already completed: ${attemptData.participantId}`);
      await logRef.update({
        status: 'processed_duplicate',
        participantId: attemptData.participantId,
        detail: 'Attempt already completed',
      });
      return NextResponse.json({ ok: true });
    }

    if (attemptData?.status !== 'PaymentCaptured') {
      console.log(`${actionName} ℹ️ Updating attempt status to PaymentCaptured...`);
      await attemptRef.update({
        status: 'PaymentCaptured',
        transactionId: paymentId,
        specificPaymentMethod: paymentMethod || 'Online',
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log(`${actionName} ✅ Status updated to PaymentCaptured`);
    } else {
      console.log(`${actionName} ♻️ Attempt already PaymentCaptured; continuing with idempotent finalization`);
    }

    console.log(`${actionName} 🚀 Calling finalizeRegistration(${registrationAttemptId})...`);
    // Create participant
    const result = await finalizeRegistration(registrationAttemptId, 'api.webhooks.razorpay');
    console.log(`${actionName} Result:`, JSON.stringify(result, null, 2));

    if (!result.success) {
      throw new Error(result.message || 'Participant creation failed');
    }

    console.log(`${actionName} ✅ Participant created: ${result.participantId}, Booking: ${result.bookingId}`);
    await logRef.update({
      status: 'processed',
      processedAt: FieldValue.serverTimestamp(),
      participantId: result.participantId || null,
    });

    console.log(`${actionName} ✅ Registration completed successfully`);

    return NextResponse.json({ ok: true });

  } catch (err: any) {
    console.error(`${actionName} ❌ CRITICAL ERROR:`, err);

    try {
      await db.collection('webhookLogs').doc(webhookId).set(
        {
          status: 'CRITICAL_ERROR',
          error: err.message,
          processedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (logError) {
      console.error(`${actionName} Failed to log error`, logError);
    }

    return NextResponse.json({ ok: true }); // Always return 200 so Razorpay doesn't spam retries
  }
}
