import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import crypto from 'crypto';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const body = await req.json().catch(() => null);
    const bookingId = String(body?.bookingId || '').trim();
    const reservationToken = String(body?.reservationToken || '').trim();
    const paymentStatus = String(body?.paymentStatus || 'paid').toLowerCase();
    const invoiceStatus = String(body?.invoiceStatus || 'generated').toLowerCase();
    const paymentGateway = String(body?.paymentGateway || '').trim().toLowerCase();
    const paymentId = String(body?.paymentId || body?.razorpay_payment_id || body?.stripePaymentIntentId || '').trim();
    const razorpayOrderId = String(body?.razorpay_order_id || '').trim();
    const razorpayPaymentId = String(body?.razorpay_payment_id || '').trim();
    const razorpaySignature = String(body?.razorpay_signature || '').trim();
    const stripeSessionId = String(body?.stripeSessionId || '').trim();

    if (!bookingId || !reservationToken) {
      return NextResponse.json(
        { success: false, message: 'bookingId and reservationToken are required' },
        { status: 400 },
      );
    }

    if (paymentGateway === 'razorpay' && razorpayOrderId && razorpayPaymentId && razorpaySignature) {
      const secret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
      if (!secret) {
        return NextResponse.json({ success: false, message: 'Razorpay secret is not configured' }, { status: 500 });
      }
      const shasum = crypto.createHmac('sha256', secret);
      shasum.update(`${razorpayOrderId}|${razorpayPaymentId}`);
      const expected = shasum.digest('hex');
      if (expected !== razorpaySignature) {
        return NextResponse.json({ success: false, message: 'Invalid Razorpay signature' }, { status: 409 });
      }
    }

    const db = getFirestoreInstance();
    const bookingRef = db.collection('bookings').doc(bookingId);

    await db.runTransaction(async (tx) => {
      const bookingSnap = await tx.get(bookingRef);
      if (!bookingSnap.exists) throw new Error('Booking not found');

      const booking = serializeValue(bookingSnap.data() || {}) || {};
      if (String(booking?.expoId || '') !== expoId) throw new Error('Booking does not belong to expo');
      if (String(booking?.reservationToken || '') !== reservationToken) throw new Error('Reservation token mismatch');

      const stallId = String(booking?.stallId || '').trim();
      if (!stallId) throw new Error('Booking has no stall');

      const stallRef = db.collection('stalls').doc(stallId);
      const stallSnap = await tx.get(stallRef);
      if (!stallSnap.exists) throw new Error('Stall not found');

      const stall = serializeValue(stallSnap.data() || {}) || {};
      if (String(stall?.reservation?.token || '') !== reservationToken) throw new Error('Stall reservation token mismatch');

      tx.set(
        bookingRef,
        {
          status: 'paid',
          paymentStatus,
          invoiceStatus,
          paymentGateway: paymentGateway || null,
          paymentId: paymentId || null,
          razorpayOrderId: razorpayOrderId || null,
          stripeSessionId: stripeSessionId || null,
          paidAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      tx.set(
        stallRef,
        {
          status: 'booked',
          reservation: {
            ...((stall as any)?.reservation || {}),
            convertedToBookingId: bookingId,
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    return NextResponse.json({ success: true, bookingId, message: 'Booking confirmed.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to confirm booking';
    const status = message.includes('not found') ? 404 : message.includes('mismatch') ? 409 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
