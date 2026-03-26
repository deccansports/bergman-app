// src/app/api/webhooks/razorpay-store/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { StoreOrder, StoreProduct, ProductVariant, StoreCartItem } from '@/lib/types';
import { syncStoreOrderToZohoAction } from '@/lib/actions/storeActions';
import { sendStoreOrderConfirmedEmail, sendStoreAdminOrderAlertEmail } from '@/lib/auth/brevoService';
import { sendStoreOrderConfirmedWhatsApp } from '@/lib/auth/aisensyService';
import { format } from 'date-fns';

export const runtime = 'nodejs';

/**
 * PRODUCTION RE-CALCULATION UTILITY
 * Ensures zero amount tampering.
 */
function recalculateTotal(order: StoreOrder): number {
  let totalMRP = 0;
  order.items.forEach(i => { totalMRP += i.salePrice * i.quantity; });
  const grandTotal = Math.max(0, (totalMRP - (order.discount || 0)) + (order.shipping || 0));
  return Number(grandTotal.toFixed(2));
}

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers.get('x-razorpay-signature');
  const body = await req.text();
  const db = getFirestoreInstance();
  const webhookId = `store_webhook_${Date.now()}`;

  if (!secret || !signature) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  if (expectedSignature !== signature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const event = JSON.parse(body);
  
  await db.collection("webhookLogs").doc(webhookId).set({
    event: event.event,
    razorpayPaymentId: event.payload?.payment?.entity?.id || null,
    status: 'RECEIVED',
    receivedAt: FieldValue.serverTimestamp(),
    source: 'razorpay-store',
    payload: event
  });

  if (event.event === 'payment.captured') {
    const payment = event.payload.payment.entity;
    const rzpOrderId = payment.order_id;

    const ordersSnap = await db.collection('storeOrders')
      .where('razorpayOrderId', '==', rzpOrderId)
      .limit(1)
      .get();

    if (ordersSnap.empty) {
        await db.collection("webhookLogs").doc(webhookId).update({ status: 'ORPHANED' });
        return NextResponse.json({ ok: true });
    }

    const orderDoc = ordersSnap.docs[0];
    const orderData = orderDoc.data() as StoreOrder;

    if (orderData.status === 'Paid') {
        await db.collection("webhookLogs").doc(webhookId).update({ status: 'SKIPPED_DUPLICATE' });
        return NextResponse.json({ ok: true });
    }

    // CRITICAL: Integrity Check
    const verifiedTotal = recalculateTotal(orderData);
    if (Math.round(verifiedTotal * 100) !== payment.amount) {
        await db.collection("webhookLogs").doc(webhookId).update({ 
            status: 'FAILED', 
            error: `Amount mismatch: Expected ${verifiedTotal}, got ${payment.amount/100}` 
        });
        return NextResponse.json({ ok: true });
    }

    try {
      await db.runTransaction(async (tx) => {
        // Deduct Stock
        for (const item of (orderData.items || [])) {
          const productRef = db.collection('products').doc(item.productId);
          const pSnap = await tx.get(productRef);
          if (pSnap.exists) {
            const pData = pSnap.data() as StoreProduct;
            const updatedVariants = (pData.variants || []).map((v: ProductVariant) => {
                if (v.size === item.size) return { ...v, stock: Math.max(0, v.stock - item.quantity) };
                return v;
            });
            tx.update(productRef, { variants: updatedVariants, updatedAt: FieldValue.serverTimestamp() });
          }
        }

        // Coupon Tracking
        if (orderData.couponCode) {
          const couponSnap = await db.collection('storeCoupons').where('code', '==', orderData.couponCode.toUpperCase().trim()).get();
          if (!couponSnap.empty) tx.update(couponSnap.docs[0].ref, { usedCount: FieldValue.increment(1) });
        }

        tx.update(orderDoc.ref, { status: 'Paid', paymentId: payment.id, updatedAt: FieldValue.serverTimestamp() });
      });

      // Immediate Notifications
      const summary = (orderData.items || []).map(i => `${i.name} (${i.size}) x${i.quantity}`).join(', ');
      await sendStoreOrderConfirmedEmail({
        email: orderData.email,
        customer_name: orderData.customerName,
        order_id: orderData.orderId || orderDoc.id,
        order_date: format(new Date(), 'MMM dd, yyyy'),
        product_summary: summary,
        total_amount: orderData.totalAmount,
        payment_method: payment.method || 'Online',
        order_details_url: `https://bergmantri.com/dashboard`,
        support_email: 'info@bergmantri.com'
      });

      // Async Zoho Push
      syncStoreOrderToZohoAction(orderDoc.id).catch((e: any) => console.error("Zoho Sync Error:", e));
      
      await db.collection("webhookLogs").doc(webhookId).update({ status: 'PROCESSED' });

    } catch (e: any) {
      await db.collection("webhookLogs").doc(webhookId).update({ status: 'FAILED', error: e.message });
    }
  }

  return NextResponse.json({ ok: true });
}
