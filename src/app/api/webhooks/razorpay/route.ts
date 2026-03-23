// src/api/webhooks/razorpay/route.ts

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { submitPublicEventRegistrationAction } from '@/lib/actions';

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

    let registrationAttemptId =
      payment?.notes?.registrationAttemptId || null;

    // Fallback: use Razorpay order_id if your Firestore doc ID = orderId
    if (!registrationAttemptId) {
      registrationAttemptId = payment?.order_id || null;
      console.log(`${actionName} ⚠️ Using fallback order_id: ${registrationAttemptId}`);
    }

    if (!registrationAttemptId) {
      throw new Error('No registrationAttemptId or order_id found in webhook');
    }

    console.log(`${actionName} 🔥 Processing attempt: ${registrationAttemptId}`);

    const attemptRef = db.collection('registrationAttempts').doc(registrationAttemptId);
    const attemptSnap = await attemptRef.get();

    if (!attemptSnap.exists) {
      throw new Error(`registrationAttempt not found: ${registrationAttemptId}`);
    }

    const attemptData = attemptSnap.data();

    // 🛑 Prevent double processing
    if (attemptData?.status === 'PaymentCaptured') {
      console.log(`${actionName} ⚠️ Attempt already marked PaymentCaptured`);
      await logRef.update({ status: 'processed_duplicate' });
      return NextResponse.json({ ok: true });
    }

    // Update attempt
    await attemptRef.update({
      status: 'PaymentCaptured',
      transactionId: paymentId,
      specificPaymentMethod: paymentMethod || 'Online',
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Create participant
    const result = await submitPublicEventRegistrationAction(registrationAttemptId);

    if (!result.success) {
      throw new Error(result.message || 'Participant creation failed');
    }

    await logRef.update({
      status: 'processed',
      processedAt: FieldValue.serverTimestamp(),
      participantId: result.participantId || null,
    });

    console.log(`${actionName} ✅ Registration completed`);

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
