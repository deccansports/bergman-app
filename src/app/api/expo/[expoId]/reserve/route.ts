import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import Razorpay from 'razorpay';
import Stripe from 'stripe';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const RESERVATION_TTL_MS = 5 * 60 * 1000;

function randomToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const body = await req.json().catch(() => null);
    const stallId = String(body?.stallId || '').trim();
    const companyName = String(body?.companyName || '').trim();
    const brandName = String(body?.brandName || '').trim();
    const contactPerson = String(body?.contactPerson || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    const phone = String(body?.phone || '').trim();

    if (!stallId || !companyName || !contactPerson || !email || !phone) {
      return NextResponse.json(
        { success: false, message: 'stallId, companyName, contactPerson, email and phone are required' },
        { status: 400 },
      );
    }

    const db = getFirestoreInstance();
    const expoRef = db.collection('expo').doc(expoId);
    const stallRef = db.collection('stalls').doc(stallId);

    const nowMs = Date.now();
    const expiresAtMs = nowMs + RESERVATION_TTL_MS;
    const reservationToken = randomToken();

    const bookingRef = db.collection('bookings').doc();
    let bookingAmount = 0;
    let bookingCurrency: 'INR' | 'USD' = 'INR';
    let paymentGateway = 'razorpay';
    let stallNumber = '';
    let stallSize = '';
    let expoName = 'Bergman Expo';

    await db.runTransaction(async (tx) => {
      const [expoSnap, stallSnap] = await Promise.all([tx.get(expoRef), tx.get(stallRef)]);
      if (!expoSnap.exists) throw new Error('Expo not found');
      if (!stallSnap.exists) throw new Error('Stall not found');

      const expo = serializeValue(expoSnap.data() || {}) || {};
      const stall = serializeValue(stallSnap.data() || {}) || {};
      if (String(stall?.expoId || '') !== expoId) throw new Error('Stall does not belong to expo');

      stallNumber = String(stall?.stallNumber || '').trim();
      stallSize = String(stall?.sizeLabel || `${stall?.width || ''}x${stall?.height || ''}`).trim();
      bookingAmount = Number(stall?.price || 0);
      bookingCurrency = String(stall?.currency || 'INR').toUpperCase() === 'USD' ? 'USD' : 'INR';
      expoName = String(expo?.expoName || expo?.eventName || 'Bergman Expo').trim() || 'Bergman Expo';

      const configuredGateway = String(expo?.paymentGateway || '').trim().toLowerCase();
      paymentGateway = configuredGateway === 'stripe' || bookingCurrency === 'USD' ? 'stripe' : 'razorpay';

      const status = String(stall?.status || '').toLowerCase();
      const currentExpiresAtMs = Number(stall?.reservation?.expiresAtMs || 0);

      const reservationActive = (status === 'reserved' || status === 'pending_payment') && currentExpiresAtMs > nowMs;
      const permanentlyBlocked = status === 'booked' || status === 'blocked';

      if (permanentlyBlocked || reservationActive) {
        throw new Error('Stall is not available');
      }

      tx.set(
        stallRef,
        {
          status: 'reserved',
          reservation: {
            token: reservationToken,
            reservedBy: {
              companyName,
              contactPerson,
              email,
              phone,
            },
            reservedAtMs: nowMs,
            expiresAtMs,
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      tx.set(
        bookingRef,
        {
          bookingId: bookingRef.id,
          eventId: String(expo?.eventId || '').trim() || null,
          expoId,
          stallId,
          stallNumber: String(stall?.stallNumber || '').trim() || null,
          stallSize: String(stall?.sizeLabel || `${stall?.width || ''}x${stall?.height || ''}`).trim() || null,
          amount: bookingAmount,
          currency: bookingCurrency,
          paymentGateway: paymentGateway === 'stripe' ? 'stripe' : 'razorpay',
          companyName,
          brandName: brandName || null,
          contactPerson,
          email,
          phone,
          country: String(body?.country || '').trim() || null,
          gstNumber: String(body?.gstNumber || '').trim() || null,
          website: String(body?.website || '').trim() || null,
          businessCategory: String(body?.businessCategory || '').trim() || null,
          productsServices: String(body?.productsServices || '').trim() || null,
          logoUrl: String(body?.logoUrl || '').trim() || null,
          optionalRequirements: {
            electricity: !!body?.optionalRequirements?.electricity,
            table: !!body?.optionalRequirements?.table,
            chairs: !!body?.optionalRequirements?.chairs,
            wifi: !!body?.optionalRequirements?.wifi,
            storage: !!body?.optionalRequirements?.storage,
          },
          status: 'reserved',
          paymentStatus: 'pending',
          invoiceStatus: 'pending',
          reservationToken,
          reservationExpiresAtMs: expiresAtMs,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    if (bookingAmount <= 0) {
      return NextResponse.json({
        success: true,
        bookingId: bookingRef.id,
        reservationToken,
        expiresAtMs,
        holdMinutes: RESERVATION_TTL_MS / (60 * 1000),
        paymentGateway: 'none',
        message: 'Stall reserved for 5 minutes. No payment required.',
      });
    }

    if (paymentGateway === 'stripe') {
      const stripeSecret = String(process.env.STRIPE_SECRET_KEY || '').trim();
      if (!stripeSecret) {
        throw new Error('Stripe is not configured');
      }
      const stripe = new Stripe(stripeSecret);
      const origin = String(req.headers.get('origin') || '').trim();
      const baseUrl = String(process.env.NEXT_PUBLIC_SITE_URL || origin).trim().replace(/\/$/, '');
      if (!baseUrl) throw new Error('Unable to resolve site URL for Stripe checkout');

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        success_url: `${baseUrl}/expo/${encodeURIComponent(expoId)}/payment/success?bookingId=${encodeURIComponent(bookingRef.id)}&token=${encodeURIComponent(reservationToken)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/expo/${encodeURIComponent(expoId)}/book/${encodeURIComponent(stallId)}?payment=cancelled`,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: bookingCurrency.toLowerCase(),
              unit_amount: Math.max(0, Math.round(bookingAmount * 100)),
              product_data: {
                name: `Expo Stall ${stallNumber || stallId}`,
                description: `${expoName}${stallSize ? ` · ${stallSize}` : ''}`,
              },
            },
          },
        ],
        metadata: {
          source: 'expo_booking',
          expoId,
          stallId,
          bookingId: bookingRef.id,
          reservationToken,
        },
      });

      return NextResponse.json({
        success: true,
        bookingId: bookingRef.id,
        reservationToken,
        expiresAtMs,
        holdMinutes: RESERVATION_TTL_MS / (60 * 1000),
        paymentGateway: 'stripe',
        checkoutUrl: session.url || null,
        checkoutSessionId: session.id,
        amount: Math.max(0, Math.round(bookingAmount * 100)),
        currency: bookingCurrency,
        message: 'Stall reserved for 5 minutes. Complete Stripe payment to confirm booking.',
      });
    }

    const razorpayKeyId = String(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '').trim();
    const razorpayKeySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!razorpayKeyId || !razorpayKeySecret) {
      throw new Error('Razorpay is not configured');
    }

    const razorpay = new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret });
    const order = await razorpay.orders.create({
      amount: Math.max(0, Math.round(bookingAmount * 100)),
      currency: bookingCurrency,
      receipt: `expo_${bookingRef.id.slice(0, 20)}`,
      notes: {
        source: 'expo_booking',
        expoId,
        stallId,
        bookingId: bookingRef.id,
      },
    });

    return NextResponse.json({
      success: true,
      bookingId: bookingRef.id,
      reservationToken,
      expiresAtMs,
      holdMinutes: RESERVATION_TTL_MS / (60 * 1000),
      paymentGateway: 'razorpay',
      keyId: razorpayKeyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      notes: order.notes || {},
      message: 'Stall reserved for 5 minutes. Complete payment to confirm booking.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reserve stall';
    const status = message.includes('not available') ? 409 : message.includes('not found') ? 404 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
