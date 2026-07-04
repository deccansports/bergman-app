import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import { finalizeRegistration } from '@/lib/registrationEngine/finalizeRegistration';
import { sendRegistrationNotifications } from '@/lib/registrationEngine/registrationNotifications';
import { syncRegistrationToZoho } from '@/lib/registrationEngine/zohoSync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

async function verifyAdmin(request: NextRequest): Promise<{ uid: string } | null> {
  try {
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const decoded = await getAuthInstance().verifyIdToken(auth.replace('Bearer ', ''));
    const userDoc = await getFirestoreInstance().collection('users').doc(decoded.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) return null;
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirestoreInstance();

  try {
    const body = await request.json().catch(() => ({}));
    const paymentIntentId = (body?.paymentIntentId || '').trim();
    const webhookLogId = (body?.webhookLogId || '').trim();

    if (!paymentIntentId) {
      return NextResponse.json({ success: false, message: 'paymentIntentId is required' }, { status: 400 });
    }

    const logRef = webhookLogId ? db.collection('webhookLogs').doc(webhookLogId) : null;

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!paymentIntent || paymentIntent.status !== 'succeeded') {
      await logRef?.set(
        {
          status: 'FAILED',
          error: `Retry blocked: payment intent status is ${paymentIntent?.status || 'unknown'}`,
          processedAt: FieldValue.serverTimestamp(),
          retriedBy: admin.uid,
        },
        { merge: true }
      );
      return NextResponse.json(
        {
          success: false,
          message: `PaymentIntent status is ${paymentIntent?.status || 'unknown'}, not succeeded`,
        },
        { status: 400 }
      );
    }

    const registrationAttemptId = paymentIntent.metadata?.registrationAttemptId;
    if (!registrationAttemptId) {
      await logRef?.set(
        {
          status: 'FAILED',
          error: 'Retry failed: registrationAttemptId missing in payment intent metadata',
          processedAt: FieldValue.serverTimestamp(),
          retriedBy: admin.uid,
        },
        { merge: true }
      );
      return NextResponse.json(
        { success: false, message: 'registrationAttemptId missing in payment metadata' },
        { status: 400 }
      );
    }

    const attemptRef = db.collection('registrationAttempts').doc(registrationAttemptId);
    const attemptSnap = await attemptRef.get();
    if (!attemptSnap.exists) {
      return NextResponse.json(
        { success: false, message: `registrationAttempt not found: ${registrationAttemptId}` },
        { status: 404 }
      );
    }

    const currentStatus = attemptSnap.data()?.status;
    if (currentStatus === 'Completed') {
      await logRef?.set(
        {
          status: 'SKIPPED_DUPLICATE',
          detail: 'Retry skipped: registration already Completed',
          processedAt: FieldValue.serverTimestamp(),
          retriedBy: admin.uid,
        },
        { merge: true }
      );
      return NextResponse.json({ success: true, message: 'Already completed' });
    }

    await attemptRef.set(
      {
        status: 'PaymentCaptured',
        transactionId: paymentIntentId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const result = await finalizeRegistration(registrationAttemptId, 'admin.stripe.retry-finalization');
    if (!result.success) {
      await logRef?.set(
        {
          status: 'FAILED',
          error: result.message || 'finalizeRegistration failed',
          processedAt: FieldValue.serverTimestamp(),
          retriedBy: admin.uid,
        },
        { merge: true }
      );
      return NextResponse.json({ success: false, message: result.message || 'Finalization failed' }, { status: 500 });
    }

    sendRegistrationNotifications(registrationAttemptId).catch(() => {});
    syncRegistrationToZoho(registrationAttemptId).catch(() => {});

    await logRef?.set(
      {
        status: 'PROCESSED',
        participantId: result.participantId || null,
        detail: 'Finalized via admin retry',
        processedAt: FieldValue.serverTimestamp(),
        retriedBy: admin.uid,
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      message: 'Stripe registration finalized successfully',
      participantId: result.participantId,
      bookingId: result.bookingId,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message || 'Retry failed' }, { status: 500 });
  }
}
