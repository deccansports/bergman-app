'use server';

import { getFirestoreInstance, getStorageInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { StoreProduct, StoreOrder, StoreCoupon, StoreSettings, ProductVariant } from '@/lib/types';
import { serializeValue, getStateCode } from '@/lib/utils';
import { sendStoreOrderConfirmedEmail } from '../auth/brevoService';
import { sendStoreOrderConfirmedWhatsApp } from '../auth/aisensyService';
import { findZohoCustomerByEmail, createZohoCustomer, updateZohoCustomer } from '../zoho/customer';
import { createInvoice, markInvoiceAsSent, getInvoicePdf, findInvoiceByReference } from '../zoho/invoice';
import { applyPaymentToInvoice } from '../zoho/payments';
import { uploadInvoiceAndGetUrl } from './invoiceActions';
import { refundPaymentAction } from './paymentActions';
import { format } from 'date-fns';
import { getKV } from '../cloudflare/kv';
import { runDataSyncAction } from './dataSyncActions';

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
    await db.collection('storeOrders').doc(id).update({ status, ...tracking, updatedAt: FieldValue.serverTimestamp() });
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
    snap.forEach(doc => {
      const o = doc.data() as any;
      if (['Paid', 'Shipped', 'Delivered'].includes(o.status)) {
        totalRevenue += o.totalAmount || 0;
        totalGst += o.gstAmount || 0;
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
    return { success: true, message: "Order reconciliation initiated." };
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
            await sendStoreOrderConfirmedWhatsApp({
                mobile: order.mobile,
                customer_name: order.customerName,
                order_id: order.orderId || orderId,
                total_amount: order.totalAmount,
                invoice_number: order.invoiceNumber,
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
    const invoice = await createInvoice({
      customer_id: customer.contact_id,
      reference_number: order.orderId || orderId,
      date: format(new Date(), 'yyyy-MM-dd'),
      currency_code: 'INR',
      place_of_supply: stateCode,
      gst_treatment: 'consumer',
      line_items: order.items.map(item => ({
        name: item.name,
        rate: item.salePrice,
        quantity: item.quantity,
        hsn_or_sac: item.hsnCode,
        tax_id: stateCode === 'MH' ? process.env.ZOHO_GST_INTRASTATE_ID : process.env.ZOHO_GST_INTERSTATE_ID
      }))
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
      zohoSynced: true
    });

    // Trigger WhatsApp Delivery
    await sendStoreInvoiceWhatsAppAction(orderId);

    return { success: true, message: `Synced: ${invoice.invoice_number}` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}
