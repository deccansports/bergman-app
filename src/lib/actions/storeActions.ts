'use server';

import { getFirestoreInstance, getStorageInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { StoreProduct, StoreOrder, StoreCoupon, StoreSettings, ProductVariant } from '@/lib/types';
import { serializeValue, getStateCode } from '@/lib/utils';
import Razorpay from 'razorpay';
import { sendStoreAdminOrderAlertEmail, sendStoreOrderConfirmedEmail, sendStoreOrderShippedEmail } from '../auth/brevoService';
import { sendStoreOrderShippedWhatsApp } from '../auth/aisensyService';
import { findZohoCustomerByEmail, createZohoCustomer, updateZohoCustomer } from '../zoho/customer';
import { createInvoice, markInvoiceAsSent, getInvoicePdf, findInvoiceByReference } from '../zoho/invoice';
import { applyPaymentToInvoice } from '../zoho/payments';
import { uploadInvoiceAndGetUrl } from './invoiceActions';
import { refundPaymentAction } from './paymentActions';
import { format } from 'date-fns';
import { getKV } from '../cloudflare/kv';
import { runDataSyncAction } from './dataSyncActions';

const normalizeZohoHsnOrSac = (raw: unknown): string | undefined => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return undefined;

  // Zoho/GST commonly accepts 4, 6 or 8-digit HSN/SAC values.
  if ([4, 6, 8].includes(digits.length)) return digits;

  // For non-standard lengths (e.g. 7-digit), trim to a valid 6-digit code.
  if (digits.length > 6) return digits.slice(0, 6);

  // Too short to be valid for invoice line item.
  return undefined;
};

const resolveZohoStoreTaxId = (gstPercentRaw: unknown, isInterstate: boolean): string | undefined => {
  const rate = Number(gstPercentRaw);
  const roundedRate = Number.isFinite(rate) ? Math.round(rate) : 18;

  const keyByRate = isInterstate
    ? {
        0: process.env.ZOHO_GST0_INTERSTATE_ID,
        3: process.env.ZOHO_GST3_INTERSTATE_ID,
        5: process.env.ZOHO_GST5_INTERSTATE_ID,
        12: process.env.ZOHO_GST12_INTERSTATE_ID,
        18: process.env.ZOHO_GST18_INTERSTATE_ID || process.env.ZOHO_GST_INTERSTATE_ID,
        28: process.env.ZOHO_GST28_INTERSTATE_ID,
      }
    : {
        0: process.env.ZOHO_GST0_INTRASTATE_ID,
        3: process.env.ZOHO_GST3_INTRASTATE_ID,
        5: process.env.ZOHO_GST5_INTRASTATE_ID,
        12: process.env.ZOHO_GST12_INTRASTATE_ID,
        18: process.env.ZOHO_GST18_INTRASTATE_ID || process.env.ZOHO_GST_INTRASTATE_ID,
        28: process.env.ZOHO_GST28_INTRASTATE_ID,
      };

  return keyByRate[roundedRate as keyof typeof keyByRate]
    || (isInterstate ? process.env.ZOHO_GST_INTERSTATE_ID : process.env.ZOHO_GST_INTRASTATE_ID)
    || undefined;
};

/**
 * SCALE-FIRST: PUBLIC PRODUCTS FROM KV
 */
export async function getStoreProductsAction(): Promise<{ success: boolean; message?: string; products?: StoreProduct[] }> {
  const actionName = 'getStoreProductsAction';
  try {
    const products = await getKV<StoreProduct[]>('store:products', actionName);
    if (products) return { success: true, products };

    const db = getFirestoreInstance();
    const snap = await db.collection('products').get();
    const list = snap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() })) as StoreProduct[];
    list.sort((a, b) => (a.order || 99) - (b.order || 99));
    return { success: true, products: list };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getStoreProductBySlugAction(slug: string) {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('products').where('slug', '==', slug).limit(1).get();
    if (snap.empty) return { success: false, message: 'Not found' };
    return { success: true, product: serializeValue({ id: snap.docs[0].id, ...snap.docs[0].data() }) };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function saveStoreProductAction(id: string | null, data: any) {
  try {
    const db = getFirestoreInstance();
    const col = db.collection('products');
    const payload = { ...data, updatedAt: FieldValue.serverTimestamp() };
    if (id) await col.doc(id).update(payload);
    else await col.add({ ...payload, createdAt: FieldValue.serverTimestamp() });
    
    await runDataSyncAction('calendar'); // Mirror products to KV
    revalidatePath('/admin/dashboard'); revalidatePath('/shop');
    return { success: true, message: 'Saved' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function deleteStoreProductAction(id: string) {
  try {
    const db = getFirestoreInstance();
    await db.collection('products').doc(id).delete();
    await runDataSyncAction('calendar');
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Deleted' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getStoreOrdersAction() {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('storeOrders').orderBy('createdAt', 'desc').get();
    return { success: true, orders: snap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() })) };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getUserStoreSummaryAction(userId: string) {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('storeOrders')
      .where('userId', '==', userId)
      .get();
    
    if (snap.empty) return { success: true, count: 0, orders: [] };

    const orders = snap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() })) as StoreOrder[];
    const validOrders = orders.filter(o => ['Pending', 'Paid', 'Processing', 'Shipped', 'Delivered'].includes(o.status));
    
    if (validOrders.length === 0) return { success: true, count: 0, orders: [] };

    validOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const totalSpent = validOrders
        .filter(o => o.status !== 'Pending' && o.status !== 'Cancelled')
        .reduce((acc, o) => acc + (o.totalAmount || 0), 0);

    return { 
        success: true, 
        count: validOrders.length, 
        totalSpent, 
        lastOrderStatus: validOrders[0].status, 
        lastOrderDate: validOrders[0].createdAt,
        orders: validOrders
    };
  } catch (e) { return { success: false, count: 0, orders: [] }; }
}

export async function updateStoreOrderStatusAction(id: string, status: string, tracking?: any) {
  try {
    const db = getFirestoreInstance();
    const orderRef = db.collection('storeOrders').doc(id);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return { success: false, message: 'Order not found.' };

    const order = orderSnap.data() as StoreOrder;
    await orderRef.update({ status, ...tracking, updatedAt: FieldValue.serverTimestamp() });

    if (status === 'Shipped') {
      const trackingId = String(tracking?.trackingId || order.trackingId || '').trim();
      const courierPartner = String(tracking?.courierPartner || order.courierPartner || '').trim();
      const trackingUrl = String(tracking?.trackingUrl || order.trackingUrl || '').trim();
      const productSummary = (order.items || []).map(i => `${i.name} (${i.size}) x${i.quantity}`).join(', ');

      if (trackingId && courierPartner) {
        await sendStoreOrderShippedEmail({
          email: order.email,
          customer_name: order.customerName,
          order_id: order.orderId || id,
          courier_name: courierPartner,
          tracking_id: trackingId,
          tracking_url: trackingUrl || 'N/A',
        });

        await sendStoreOrderShippedWhatsApp({
          mobile: order.mobile,
          customer_name: order.customerName,
          product_summary: productSummary,
          order_id: order.orderId || id,
          tracking_id: trackingId,
          courier_name: courierPartner,
          tracking_url: trackingUrl || 'N/A',
        });
      }
    }

    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Updated' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function cancelAndRefundStoreOrderAction(orderId: string): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    const orderRef = db.collection('storeOrders').doc(orderId);
    const orderSnap = await orderRef.get();
    
    if (!orderSnap.exists) throw new Error("Order record not found.");
    const order = orderSnap.data() as StoreOrder;

    if (order.status === 'Cancelled' || order.status === 'Refunded') {
        throw new Error("This order has already been cancelled.");
    }

    if (order.paymentId) {
        const refundRes = await refundPaymentAction(order.paymentId);
        if (!refundRes.success) throw new Error(refundRes.message);
    }

    await db.runTransaction(async (tx) => {
        for (const item of (order.items || [])) {
            const productRef = db.collection('products').doc(item.productId);
            const pSnap = await tx.get(productRef);
            if (pSnap.exists) {
                const pData = pSnap.data() as StoreProduct;
                const updatedVariants = (pData.variants || []).map((v: ProductVariant) => {
                    if (v.size === item.size) return { ...v, stock: v.stock + item.quantity };
                    return v;
                });
                tx.update(productRef, { variants: updatedVariants, updatedAt: FieldValue.serverTimestamp() });
            }
        }
        tx.update(orderRef, { 
            status: 'Cancelled', 
            refundedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
        });
    });

    await runDataSyncAction('calendar'); // Sync stock back to KV
    revalidatePath('/admin/dashboard');
    return { success: true, message: "Order cancelled and payment refunded." };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getStoreAnalyticsAction() {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('storeOrders').get();
    let totalRevenue = 0, totalGst = 0, totalOrders = 0;

    const normalizeAmount = (value: unknown): number => {
      const parsed = typeof value === 'string'
        ? Number(value.replace(/[^0-9.-]/g, ''))
        : Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const isPaidLikeStatus = (status: unknown): boolean => {
      const s = String(status || '').trim().toLowerCase();
      return ['paid', 'processing', 'shipped', 'delivered'].includes(s);
    };

    snap.forEach(doc => {
      const o = doc.data() as any;
      if (isPaidLikeStatus(o.status)) {
        totalRevenue += normalizeAmount(o.totalAmount);
        totalGst += normalizeAmount(o.gstAmount);
        totalOrders++;
      }
    });
    return { success: true, stats: { totalRevenue, totalOrders, totalGst, avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0 } };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getStoreCouponsAction() {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('storeCoupons').get();
    return { success: true, coupons: snap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() })) };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function saveStoreCouponAction(id: string | null, data: any) {
  try {
    const db = getFirestoreInstance();
    if (id) await db.collection('storeCoupons').doc(id).update({ ...data, updatedAt: FieldValue.serverTimestamp() });
    else await db.collection('storeCoupons').add({ ...data, createdAt: FieldValue.serverTimestamp() });
    return { success: true, message: 'Saved' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function deleteStoreCouponAction(id: string) {
  try {
    const db = getFirestoreInstance();
    await db.collection('storeCoupons').doc(id).delete();
    return { success: true, message: 'Deleted' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getStoreSettingsAction() {
  try {
    const db = getFirestoreInstance();
    const doc = await db.collection('storeSettings').doc('shipping').get();
    return { success: true, settings: doc.exists ? doc.data() : null };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function saveStoreSettingsAction(data: any) {
  try {
    const db = getFirestoreInstance();
    await db.collection('storeSettings').doc('shipping').set(data);
    return { success: true, message: 'Saved' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function updateStoreProductOrderAction(data: any[]) {
  try {
    const db = getFirestoreInstance();
    const batch = db.batch();
    data.forEach(p => batch.update(db.collection('products').doc(p.id), { order: p.order }));
    await batch.commit();
    await runDataSyncAction('calendar');
    return { success: true, message: 'Order Updated' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function reconcileStoreOrderAction(id: string) {
    if (!id) return { success: false, message: "ID required" };

    try {
      const db = getFirestoreInstance();
      const orderRef = db.collection('storeOrders').doc(id);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) return { success: false, message: 'Order not found.' };

      const order = orderSnap.data() as StoreOrder;
      if (!order.razorpayOrderId) return { success: false, message: 'Missing Razorpay order reference.' };

      const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      if (!keyId || !keySecret) {
        return { success: false, message: 'Razorpay credentials are not configured.' };
      }

      const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
      const paymentsRes: any = await razorpay.orders.fetchPayments(order.razorpayOrderId);
      const payments: any[] = Array.isArray(paymentsRes?.items) ? paymentsRes.items : [];
      const captured = payments.find((p) => p?.status === 'captured');

      if (!captured) {
        await orderRef.update({
          zohoSynced: false,
          zohoSyncError: 'No captured payment found on Razorpay order.',
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { success: false, message: 'No captured payment found for this order.' };
      }

      const expectedAmount = Math.round(Number(order.totalAmount || 0) * 100);
      if (Number(captured.amount || 0) !== expectedAmount) {
        await orderRef.update({
          zohoSynced: false,
          zohoSyncError: `Amount mismatch. Expected ${expectedAmount}, got ${captured.amount}.`,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { success: false, message: 'Payment amount mismatch. Reconciliation blocked.' };
      }

      let transitionedToPaid = false;

      await db.runTransaction(async (tx) => {
        const latest = await tx.get(orderRef);
        if (!latest.exists) throw new Error('Order not found during reconciliation.');
        const latestData = latest.data() as StoreOrder;

        const alreadyPaid = ['Paid', 'Processing', 'Shipped', 'Delivered'].includes(latestData.status);

        if (!alreadyPaid) {
          for (const item of (latestData.items || [])) {
            const productRef = db.collection('products').doc(item.productId);
            const pSnap = await tx.get(productRef);
            if (!pSnap.exists) continue;

            const pData = pSnap.data() as StoreProduct;
            const updatedVariants = (pData.variants || []).map((v: ProductVariant) => {
              if (v.size === item.size) {
                return { ...v, stock: Math.max(0, Number(v.stock || 0) - Number(item.quantity || 0)) };
              }
              return v;
            });
            tx.update(productRef, { variants: updatedVariants, updatedAt: FieldValue.serverTimestamp() });
          }

          if (latestData.couponCode) {
            const couponSnap = await db.collection('storeCoupons')
              .where('code', '==', String(latestData.couponCode).toUpperCase().trim())
              .limit(1)
              .get();
            if (!couponSnap.empty) {
              tx.update(couponSnap.docs[0].ref, { usedCount: FieldValue.increment(1) });
            }
          }
        }

        tx.update(orderRef, {
          status: alreadyPaid ? latestData.status : 'Paid',
          paymentId: captured.id,
          zohoSyncError: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        if (!alreadyPaid) {
          transitionedToPaid = true;
        }
      });

      if (transitionedToPaid) {
        const summary = (order.items || []).map(i => `${i.name} (${i.size}) x${i.quantity}`).join(', ');
        await sendStoreAdminOrderAlertEmail({
          admin_email: 'info@bergmantri.com',
          customer_name: order.customerName,
          customer_email: order.email,
          customer_phone: order.mobile,
          order_id: order.orderId || id,
          order_date: format(new Date(), 'MMM dd, yyyy'),
          product_summary: summary,
          total_amount: order.totalAmount,
          payment_method: captured.method || 'Online',
          admin_order_url: `https://bergmantri.com/admin/store-orders`,
        });
      }

      // Best-effort downstream actions
      await syncStoreOrderToZohoAction(id);
      revalidatePath('/admin/dashboard');

      return { success: true, message: 'Order payment reconciled and downstream sync triggered.' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Failed to reconcile order.' };
    }
}

/**
 * SEND STORE INVOICE VIA WHATSAPP
 */
export async function sendStoreInvoiceWhatsAppAction(orderId: string): Promise<{ success: boolean; message: string }> {
    const actionName = 'sendStoreInvoiceWhatsAppAction';
    try {
        const db = getFirestoreInstance();
        const doc = await db.collection('storeOrders').doc(orderId).get();
        if (!doc.exists) throw new Error("Order not found");
        const order = doc.data() as StoreOrder;

        if (!order.invoiceId || !order.invoiceNumber) {
            throw new Error("This order has no synced invoice.");
        }

        const invoicePdfBuffer = await getInvoicePdf(order.invoiceId);
        if (invoicePdfBuffer && order.mobile) {
            const invoiceFileName = `Bergman_Store_Invoice_${order.invoiceNumber}.pdf`;
            const invoiceUrl = await uploadInvoiceAndGetUrl(invoicePdfBuffer, invoiceFileName);
            const { sendStoreOrderConfirmedWhatsApp } = await import('@/lib/auth/aisensyService');
          const productSummary = (order.items || []).map(i => `${i.name} (${i.size}) x${i.quantity}`).join(', ');
          const shippingAddress = [order.shippingAddress, order.city, order.state, order.pincode].filter(Boolean).join(', ');
            await sendStoreOrderConfirmedWhatsApp({
                mobile: order.mobile,
                customer_name: order.customerName,
                order_id: order.orderId || orderId,
            product_summary: productSummary,
                total_amount: order.totalAmount,
            shipping_address: shippingAddress,
                invoice_url: invoiceUrl,
                invoice_filename: invoiceFileName
            });
            return { success: true, message: "WhatsApp invoice delivered." };
        } else {
            throw new Error("Missing PDF or mobile number.");
        }
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function syncStoreOrderToZohoAction(orderId: string): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    const doc = await db.collection('storeOrders').doc(orderId).get();
    if (!doc.exists) throw new Error("Order not found");
    const order = doc.data() as StoreOrder;

    const email = (order.email || '').toLowerCase().trim();
    const name = (order.customerName || '').trim();

    let customer = await findZohoCustomerByEmail(email);
    if (customer) {
        if (!customer.gst_treatment) {
            await updateZohoCustomer(customer.contact_id, { gst_treatment: 'consumer' });
        }
    } else {
      customer = await createZohoCustomer({
        name, email, mobile: order.mobile?.trim(),
        state: order.state?.trim(), city: order.city?.trim(),
        address: order.shippingAddress?.trim(), gst_treatment: 'consumer'
      });
    }

    const stateCode = getStateCode(order.state) || 'MH';
    const isInterstate = stateCode !== 'MH';

    const productLineItems = order.items.map(item => {
      const normalizedHsn = normalizeZohoHsnOrSac(item.hsnCode);
      const unitDiscount = Number(item.discount || 0);
      const effectiveRate = Math.max(0, Number(item.salePrice || 0) - unitDiscount);
      const itemTaxId = resolveZohoStoreTaxId(item.gstPercent, isInterstate);

      return {
        name: item.name,
        rate: Number(effectiveRate.toFixed(2)),
        quantity: Number(item.quantity || 0),
        ...(normalizedHsn ? { hsn_or_sac: normalizedHsn } : {}),
        ...(itemTaxId ? { tax_id: itemTaxId } : {}),
      };
    });

    const shippingAmount = Number(order.shipping || 0);
    const shippingGstAmount = Number((order as any).shippingGst || 0);
    const derivedShippingRate = (shippingAmount > shippingGstAmount && shippingGstAmount > 0)
      ? Math.round((shippingGstAmount * 100) / (shippingAmount - shippingGstAmount))
      : null;
    const fallbackShippingRate = Math.max(...(order.items || []).map(i => Number(i.gstPercent || 0)), 18);
    const shippingRateForTax = derivedShippingRate ?? fallbackShippingRate;
    const shippingTaxId = resolveZohoStoreTaxId(shippingRateForTax, isInterstate);

    const shippingLineItem = shippingAmount > 0 ? [{
      name: 'Shipping Charges',
      rate: Number(shippingAmount.toFixed(2)),
      quantity: 1,
      hsn_or_sac: '996812',
      ...(shippingTaxId ? { tax_id: shippingTaxId } : {}),
    }] : [];

    const invoice = await createInvoice({
      customer_id: customer.contact_id,
      reference_number: order.orderId || orderId,
      date: format(new Date(), 'yyyy-MM-dd'),
      currency_code: 'INR',
      place_of_supply: stateCode,
      gst_treatment: 'consumer',
      // Store prices are tax-inclusive; keep Zoho invoice in inclusive mode.
      is_inclusive_tax: true,
      line_items: [...productLineItems, ...shippingLineItem]
    });

    await markInvoiceAsSent(invoice.invoice_id);
    await applyPaymentToInvoice({
      invoice_id: invoice.invoice_id,
      customer_id: customer.contact_id,
      amount: order.totalAmount,
      payment_date: format(new Date(), 'yyyy-MM-dd'),
      reference_number: order.paymentId || order.razorpayOrderId || "",
      payment_mode: "Online"
    });

    await db.collection('storeOrders').doc(orderId).update({
      invoiceId: invoice.invoice_id,
      invoiceNumber: invoice.invoice_number,
      zohoSynced: true,
      zohoSyncError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Send order-confirmation email (template #252) with invoice attachment once.
    const alreadySentInvoiceEmail = Boolean((order as any).storeInvoiceEmailSentAt);
    if (!alreadySentInvoiceEmail) {
      const summary = (order.items || []).map(i => `${i.name} (${i.size}) x${i.quantity}`).join(', ');
      const baseEmailPayload = {
        email: order.email,
        customer_name: order.customerName,
        order_id: order.orderId || orderId,
        order_date: format(new Date(), 'MMM dd, yyyy'),
        product_summary: summary,
        total_amount: order.totalAmount,
        payment_method: 'Online',
        order_details_url: `https://bergmantri.com/orders`,
        support_email: 'info@bergmantri.com',
        shipping_address: [order.shippingAddress, order.city, order.state, order.pincode].filter(Boolean).join(', '),
      };

      let emailSent = false;

      try {
        const invoicePdfBuffer = await getInvoicePdf(invoice.invoice_id);
        if (invoicePdfBuffer) {
          const invoiceFileName = `Bergman_Store_Invoice_${invoice.invoice_number}.pdf`;
          emailSent = await sendStoreOrderConfirmedEmail({
            ...baseEmailPayload,
            attachment: {
              name: invoiceFileName,
              content: invoicePdfBuffer.toString('base64'),
            },
          });
        }
      } catch (emailAttachmentError: any) {
        console.warn(`[syncStoreOrderToZohoAction] Attachment email attempt failed for order ${orderId}: ${emailAttachmentError?.message || emailAttachmentError}`);
      }

      // Fallback: send confirmation without attachment so invoice sync never fails.
      if (!emailSent) {
        try {
          emailSent = await sendStoreOrderConfirmedEmail(baseEmailPayload);
        } catch (emailFallbackError: any) {
          console.warn(`[syncStoreOrderToZohoAction] Fallback confirmation email failed for order ${orderId}: ${emailFallbackError?.message || emailFallbackError}`);
        }
      }

      if (emailSent) {
        await db.collection('storeOrders').doc(orderId).set({
          storeInvoiceEmailSentAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    // Trigger WhatsApp Delivery
    await sendStoreInvoiceWhatsAppAction(orderId);

    return { success: true, message: `Synced: ${invoice.invoice_number}` };
  } catch (e: any) {
    try {
      const db = getFirestoreInstance();
      await db.collection('storeOrders').doc(orderId).set({
        zohoSynced: false,
        zohoSyncError: e?.message || 'Zoho sync failed.',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch {
      // swallow secondary update failure
    }
    return { success: false, message: e.message };
  }
}
