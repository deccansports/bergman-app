'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, type Timestamp, FieldPath, type CollectionReference, type Firestore } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { PaidFoodItem, PaidFoodCoupon, PaidFoodOrder, PaidFoodStats, User } from '@/lib/types';
import { toIsoStringSafe, serializeValue, getStateCode } from '@/lib/utils';
import { sendFoodOrderConfirmationEmail } from '../auth/brevoService';
import { refundPaymentAction } from './paymentActions';
import crypto from 'crypto'; 
import { createZohoCustomer, findZohoCustomerByEmail } from '../zoho/customer';
import { createInvoice, markInvoiceAsSent, emailZohoInvoice, getInvoicePdf } from '../zoho/invoice';
import { applyPaymentToInvoice } from '../zoho/payments';
import { uploadInvoiceAndGetUrl } from './invoiceActions';
import Razorpay from 'razorpay';
import { sendServiceFeeInvoiceWhatsApp } from '../auth/aisensyService';


const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const ZOHO_GST5_INTRASTATE_ID = process.env.ZOHO_GST5_INTRASTATE_ID;
const ZOHO_GST5_INTERSTATE_ID = process.env.ZOHO_GST5_INTERSTATE_ID;

const FOOD_ITEMS_COLLECTION = 'paidFoodItems';
const FOOD_ORDERS_COLLECTION = 'paidFoodOrders';
const FOOD_COUPONS_COLLECTION = 'paidFoodCoupons';

export async function addPaidFoodItemAction(
  data: Omit<PaidFoodItem, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ success: boolean; message: string; itemId?: string }> {
  const actionName = 'addPaidFoodItemAction';
  if (!data.name || data.price === undefined) {
    return { success: false, message: 'Item name and price are required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const itemsSnapshot = await adminDb.collection(FOOD_ITEMS_COLLECTION).get();
    const currentCount = itemsSnapshot.size;

    const payload = {
      ...data,
      order: data.order ?? currentCount + 1,
      inventory: data.inventory ?? null, 
      description: data.description ?? null, 
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const newDocRef = await adminDb.collection(FOOD_ITEMS_COLLECTION).add(payload);
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Food item added successfully.', itemId: newDocRef.id };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function updatePaidFoodItemAction(
  itemId: string,
  data: Partial<Omit<PaidFoodItem, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<{ success: boolean; message: string }> {
  const actionName = 'updatePaidFoodItemAction';
  if (!itemId) {
    return { success: false, message: 'Item ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const payload = {
      ...data,
      updatedAt: FieldValue.serverTimestamp(),
    };
    await adminDb.collection(FOOD_ITEMS_COLLECTION).doc(itemId).update(payload);
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Food item updated successfully.' };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function deletePaidFoodItemAction(
  itemId: string
): Promise<{ success: boolean; message: string }> {
  const actionName = 'deletePaidFoodItemAction';
  if (!itemId) {
    return { success: false, message: 'Item ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection(FOOD_ITEMS_COLLECTION).doc(itemId).delete();
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Food item deleted successfully.' };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getPaidFoodItemsAction(): Promise<{ success: boolean; message: string; items?: PaidFoodItem[] }> {
  const actionName = 'getPaidFoodItemsAction';
  try {
    const adminDb = getFirestoreInstance();
    const snapshot = await adminDb.collection(FOOD_ITEMS_COLLECTION).orderBy('order', 'asc').get();
    if (snapshot.empty) {
      return { success: true, message: 'No paid food items found.', items: [] };
    }
    const items = snapshot.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }) as PaidFoodItem);
    return { success: true, message: 'Items fetched.', items };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    if ((e as any).code === 'FAILED_PRECONDITION') {
        return { success: false, message: 'A database index is required for this query.' };
    }
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function updatePaidFoodItemOrderAction(
  items: { id: string; order: number }[]
): Promise<{ success: boolean; message: string }> {
  const actionName = 'updatePaidFoodItemOrderAction';
  try {
    const adminDb = getFirestoreInstance();
    const batch = adminDb.batch();
    items.forEach(item => {
      const docRef = adminDb.collection(FOOD_ITEMS_COLLECTION).doc(item.id);
      batch.update(docRef, { order: item.order });
    });
    await batch.commit();
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Item order updated.' };
  } catch (e: any) {
    return { success: false, message: `Failed to update order: ${e.message}` };
  }
}

async function generateUniqueFoodCouponCode(db: Firestore): Promise<string> {
    let code: string;
    let isUnique = false;
    while (!isUnique) {
        code = Math.floor(1000 + Math.random() * 9000).toString();
        const docSnap = await db.collection(FOOD_COUPONS_COLLECTION).doc(code).get();
        if (!docSnap.exists) {
            isUnique = true;
        }
    }
    return code!;
}

interface CreatePaidFoodOrderInput {
    buyerName: string;
    buyerEmail: string;
    buyerMobile: string;
    eventId: string | null;
    eventName: string;
    totalAmountPaisa: number;
    items: { itemId: string; quantity: number }[];
}

interface CreatePaidFoodOrderResult {
    success: boolean;
    message: string;
    razorpayOrder?: any;
    razorpayKeyId?: string;
    notes?: Record<string, any>;
}

export async function createPaidFoodOrderAction(input: CreatePaidFoodOrderInput): Promise<CreatePaidFoodOrderResult> {
    const actionName = 'createPaidFoodOrderAction';
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
        return { success: false, message: 'Payment gateway is not configured.' };
    }
    try {
        const adminDb = getFirestoreInstance();
        const newOrderRef = adminDb.collection(FOOD_ORDERS_COLLECTION).doc();
        const razorpayInstance = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });

        const itemDetailsPromises = input.items
            .filter(item => item.quantity > 0)
            .map(async item => {
                const itemSnap = await adminDb.collection(FOOD_ITEMS_COLLECTION).doc(item.itemId).get();
                if (!itemSnap.exists) throw new Error(`Food item ${item.itemId} not found.`);
                const itemData = itemSnap.data() as PaidFoodItem;
                return { ...item, itemName: itemData.name, pricePerItem: itemData.price, taxPercentage: itemData.taxPercentage };
            });
        const itemsWithDetails = await Promise.all(itemDetailsPromises);

        const orderData = { ...input, items: itemsWithDetails, status: 'Pending', createdAt: FieldValue.serverTimestamp() };
        await newOrderRef.set(orderData);

        const notes = {
            type: 'paid_food_purchase',
            firestoreDocId: newOrderRef.id,
            orderId: newOrderRef.id,
            buyerName: input.buyerName,
            buyerEmail: input.buyerEmail,
            buyerMobile: input.buyerMobile,
            eventId: input.eventId || 'N/A',
            eventName: input.eventName,
            items: JSON.stringify(itemsWithDetails),
            totalAmountPaisa: String(input.totalAmountPaisa),
        };

        const razorpayOrder = await razorpayInstance.orders.create({
            amount: input.totalAmountPaisa,
            currency: 'INR',
            receipt: newOrderRef.id,
            notes,
        });

        return { success: true, message: 'Order created', razorpayOrder, razorpayKeyId: RAZORPAY_KEY_ID, notes };
    } catch (e: any) {
        return { success: false, message: `Order creation failed: ${e.message}` };
    }
}

interface VerifyPaidFoodPaymentInput {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
    firestoreDocId: string;
    orderId: string;
    buyerName: string;
    buyerEmail: string;
    buyerMobile: string;
    eventId: string | null;
    eventName?: string;
    items: string; 
    totalAmountPaisa: string; 
}


export async function verifyPaidFoodPaymentAction(data: VerifyPaidFoodPaymentInput): Promise<{ success: boolean; message: string }> {
    const actionName = 'verifyPaidFoodPaymentAction';
    if (!RAZORPAY_KEY_SECRET) return { success: false, message: "Payment verification service not configured." };
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, firestoreDocId } = data;

    try {
        const shasum = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET);
        shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
        if (shasum.digest('hex') !== razorpay_signature) {
            return { success: false, message: 'Payment verification failed.' };
        }
        
        const adminDb = getFirestoreInstance();
        const orderDocRef = adminDb.collection(FOOD_ORDERS_COLLECTION).doc(firestoreDocId);
        const orderSnap = await orderDocRef.get();
        if (!orderSnap.exists) {
            throw new Error(`Order document ${firestoreDocId} not found.`);
        }
        
        // --- ZOHO LOGIC ---
        const userQuery = await adminDb.collection('users').where('email', '==', data.buyerEmail.toLowerCase()).limit(1).get();
        
        const user: any = userQuery.empty 
          ? { name: data.buyerName, email: data.buyerEmail, mobile: data.buyerMobile, state: null, uid: `transient_${data.buyerEmail}` } 
          : { uid: userQuery.docs[0].id, ...userQuery.docs[0].data() };

        let customerId = user?.zohoCustomerId;
        if (!customerId) {
            const customer = await createZohoCustomer(user);
            customerId = customer.contact_id;
            if (user.uid && !user.uid.startsWith('transient')) {
                 await adminDb.collection('users').doc(user.uid).update({ zohoCustomerId: customerId });
            }
        }
        
        if (!customerId) {
            throw new Error("Zoho customerId could not be resolved.");
        }


        const parsedItems = JSON.parse(data.items);
        const userStateLower = user.state?.trim().toLowerCase();
        const isInterstate = userStateLower && userStateLower !== 'maharashtra';
        
        const line_items = parsedItems.map((item: any) => {
            let taxIdToUse = '';
            if (item.taxPercentage === 5) {
                taxIdToUse = isInterstate ? ZOHO_GST5_INTERSTATE_ID! : ZOHO_GST5_INTRASTATE_ID!;
            }
            return {
                name: item.itemName,
                rate: (item.pricePerItem || 0) / 100,
                quantity: item.quantity,
                tax_id: taxIdToUse,
                hsn_or_sac: "996331",
            }
        });

        const paymentDate = new Date().toISOString().split('T')[0];
        const stateCode = getStateCode(user.state);

        const createdInvoice = await createInvoice({
            customer_id: customerId,
            reference_number: data.orderId,
            date: paymentDate,
            line_items,
            place_of_supply: stateCode,
            is_inclusive_tax: false,
        });

        if (!createdInvoice || !createdInvoice.invoice_id) throw new Error("Zoho Invoice creation failed.");
        await markInvoiceAsSent(createdInvoice.invoice_id);
        const amountToApply = parseFloat(createdInvoice.total);
        if (amountToApply > 0) {
            await applyPaymentToInvoice({ 
              invoice_id: createdInvoice.invoice_id, 
              customer_id: customerId, 
              amount: amountToApply, 
              payment_date: paymentDate, 
              reference_number: razorpay_payment_id,
              payment_mode: "Online"
            });
        }

        const invoicePdfBuffer = await getInvoicePdf(createdInvoice.invoice_id);
        if(invoicePdfBuffer && data.buyerMobile) {
            const invoiceFileName = `Bergman_Food_Invoice_${createdInvoice.invoice_number}.pdf`;
            const invoiceUrl = await uploadInvoiceAndGetUrl(invoicePdfBuffer, invoiceFileName);

            await sendServiceFeeInvoiceWhatsApp({
                mobile: data.buyerMobile,
                firstName: data.buyerName,
                serviceType: 'Food Purchase',
                eventName: data.eventName || 'Bergman Event',
                invoiceNumber: createdInvoice.invoice_number,
                invoiceUrl: invoiceUrl,
                invoiceFileName: invoiceFileName,
            });
        }
        // --- END ZOHO LOGIC ---

        const batch = adminDb.batch();
        const finalOrderData = {
            paymentId: razorpay_payment_id, status: 'Paid' as const, updatedAt: FieldValue.serverTimestamp(),
            buyerName: data.buyerName, buyerEmail: data.buyerEmail, buyerMobile: data.buyerMobile,
            totalAmountPaisa: parseInt(data.totalAmountPaisa, 10) || 0,
            invoiceId: createdInvoice.invoice_id, invoiceNumber: createdInvoice.invoice_number, zohoSynced: true,
        };
        batch.update(orderDocRef, finalOrderData);

        for (const item of parsedItems) {
            for (let i = 0; i < item.quantity; i++) {
                const couponCode = await generateUniqueFoodCouponCode(adminDb);
                const couponRef = adminDb.collection(FOOD_COUPONS_COLLECTION).doc(couponCode);
                const newCoupon: Omit<PaidFoodCoupon, 'id'> = {
                    orderId: data.orderId, itemId: item.itemId, itemName: item.itemName,
                    status: 'ISSUED', issuedAt: new Date().toISOString(),
                };
                batch.set(couponRef, newCoupon);
                sendFoodOrderConfirmationEmail(data.buyerEmail, data.buyerName, data.orderId, item.itemName, item.pricePerItem, 1, couponCode).catch(e => console.error("Error sending Food Order Email:", e));
            }
        }
        await batch.commit();
        revalidatePath('/admin/dashboard');
        
        return { success: true, message: 'Payment verified and order finalized.' };

    } catch (e: any) {
        console.error(`[${actionName}] Error:`, e);
        return { success: false, message: `Server action failed: ${e.message}` };
    }
}

export async function redeemFoodCouponAction(
    code: string,
    volunteerId: string
): Promise<{ success: boolean; message: string }> {
    const actionName = 'redeemFoodCouponAction';
    if (!code) return { success: false, message: 'Coupon code is required.' };
    try {
        const adminDb = getFirestoreInstance();
        const couponRef = adminDb.collection(FOOD_COUPONS_COLLECTION).doc(code);
        const couponSnap = await couponRef.get();
        if (!couponSnap.exists) return { success: false, message: 'Invalid coupon code.' };
        const couponData = couponSnap.data() as PaidFoodCoupon;
        if (couponData.status === 'REDEEMED') return { success: false, message: 'This coupon has already been redeemed.' };
        if (couponData.status === 'VOID') return { success: false, message: 'This coupon is void.' };
        
        await couponRef.update({
            status: 'REDEEMED',
            redeemedAt: new Date().toISOString(),
            redeemedBy: volunteerId,
        });

        revalidatePath('/admin/dashboard');
        return { success: true, message: `Coupon for ${couponData.itemName} redeemed successfully.` };
    } catch (e: any) {
        return { success: false, message: `Failed to redeem coupon: ${e.message}` };
    }
}

export async function resetFoodCouponAction(
    couponId: string
): Promise<{ success: boolean; message: string }> {
    const actionName = 'resetFoodCouponAction';
    if (!couponId) return { success: false, message: 'Coupon ID is required.' };
    try {
        const adminDb = getFirestoreInstance();
        await adminDb.collection(FOOD_COUPONS_COLLECTION).doc(couponId).update({
            status: 'ISSUED',
            redeemedAt: FieldValue.delete(),
            redeemedBy: FieldValue.delete(),
        });
        revalidatePath('/admin/dashboard');
        return { success: true, message: 'Coupon status has been reset to "Issued".' };
    } catch(e: any) {
        return { success: false, message: `Failed to reset coupon: ${e.message}` };
    }
}

export async function cancelAndRefundPaidFoodOrderAction(orderId: string): Promise<{ success: boolean, message: string }> {
    const adminDb = getFirestoreInstance();
    const orderQuery = await adminDb.collection(FOOD_ORDERS_COLLECTION).where('orderId', '==', orderId).limit(1).get();
    if (orderQuery.empty) return { success: false, message: 'Order not found.' };

    const orderDoc = orderQuery.docs[0];
    const orderData = orderDoc.data() as PaidFoodOrder;

    if (!orderData.paymentId) return { success: false, message: 'Cannot refund: Payment ID is missing.' };
    
    const refundResult = await refundPaymentAction(orderData.paymentId);
    if (!refundResult.success) {
        return { success: false, message: `Refund failed: ${refundResult.message}` };
    }

    const batch = adminDb.batch();
    batch.update(orderDoc.ref, { status: 'Refunded', updatedAt: FieldValue.serverTimestamp() });
    
    const couponsSnap = await adminDb.collection(FOOD_COUPONS_COLLECTION).where('orderId', '==', orderId).get();
    couponsSnap.forEach(doc => {
        batch.update(doc.ref, { status: 'VOID' });
    });
    
    await batch.commit();
    revalidatePath('/admin/dashboard');
    return { success: true, message: `Order ${orderId} refunded and all associated coupons have been voided.` };
}


export async function cancelPaidFoodOrderAction(orderId: string): Promise<{ success: boolean; message: string }> {
    const adminDb = getFirestoreInstance();
    const orderQuery = await adminDb.collection(FOOD_ORDERS_COLLECTION).where('orderId', '==', orderId).limit(1).get();
    if (orderQuery.empty) return { success: false, message: 'Order not found.' };

    const orderDoc = orderQuery.docs[0];
    
    const batch = adminDb.batch();
    batch.update(orderDoc.ref, { status: 'Cancelled', updatedAt: FieldValue.serverTimestamp() });
    
    const couponsSnap = await adminDb.collection(FOOD_COUPONS_COLLECTION).where('orderId', '==', orderId).get();
    couponsSnap.forEach(doc => {
        batch.update(doc.ref, { status: 'VOID' });
    });
    
    await batch.commit();
    revalidatePath('/admin/dashboard');
    return { success: true, message: `Order ${orderId} cancelled and coupons voided.` };
}

export async function getPaidFoodStatsAndLogsAction(
    eventId?: string
): Promise<{ success: boolean; message: string; stats?: PaidFoodStats, logs?: PaidFoodOrder[] }> {
    const actionName = 'getPaidFoodStatsAndLogsAction';
    try {
        const adminDb = getFirestoreInstance();
        let ordersQuery: FirebaseFirestore.Query = adminDb.collection(FOOD_ORDERS_COLLECTION);
        if (eventId) {
            ordersQuery = ordersQuery.where('eventId', '==', eventId);
        }
        
        const ordersSnapshot = await ordersQuery.orderBy('createdAt', 'desc').get();
        
        let totalRevenue = 0;
        let totalOrders = 0;
        let totalItemsSold = 0;

        const logs = ordersSnapshot.docs.map(doc => {
            const data = doc.data() as PaidFoodOrder;
            if(data.status === 'Paid') {
                totalRevenue += data.totalAmountPaisa || 0;
                totalOrders++;
                totalItemsSold += (data.items || []).reduce((sum, item) => sum + item.quantity, 0);
            }
            return serializeValue({ ...data, id: doc.id }) as PaidFoodOrder;
        });

        const couponsSnapshot = await adminDb.collection(FOOD_COUPONS_COLLECTION).get();
        const totalItemsRedeemed = couponsSnapshot.docs.filter(doc => doc.data().status === 'REDEEMED').length;

        return { 
            success: true, 
            message: 'Stats and logs fetched.', 
            stats: { totalRevenue, totalOrders, totalItemsSold, totalItemsRedeemed }, 
            logs 
        };
    } catch (e: any) {
        return { success: false, message: `Failed to fetch data: ${e.message}` };
    }
}
