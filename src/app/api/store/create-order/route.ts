import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { StoreCartItem, StoreProduct, StoreCoupon, StoreSettings, ProductVariant } from '@/lib/types';

const razorpay = new Razorpay({
  key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!
});

/**
 * PRODUCTION CHECKOUT CALCULATION ENGINE
 */
function calculateOrder(cartItems: StoreCartItem[], couponDiscount: number = 0, shippingCharge: number = 0) {
  let totalMRP = 0;
  
  // Calculate raw subtotal for weighting
  cartItems.forEach(item => {
    totalMRP += item.salePrice * item.quantity;
  });

  const calculatedItems = cartItems.map(item => {
    const lineTotal = item.salePrice * item.quantity;
    const weight = totalMRP > 0 ? (lineTotal / totalMRP) : 0;
    const itemTotalDiscount = weight * couponDiscount;
    const perUnitDiscount = itemTotalDiscount / item.quantity;
    
    const priceAfterDiscount = item.salePrice - perUnitDiscount;

    // Formula: GST = Price * Rate / (100 + Rate)
    const gst = (priceAfterDiscount * item.gstPercent) / (100 + item.gstPercent);
    const base = priceAfterDiscount - gst;

    return {
      ...item,
      discount: Number(perUnitDiscount.toFixed(2)),
      baseAmount: Number(base.toFixed(2)),
      gstAmount: Number(gst.toFixed(2)),
    };
  });

  // Shipping GST (use highest GST in cart for compliance)
  const highestGST = Math.max(...cartItems.map(i => i.gstPercent || 0), 18);
  const shippingGST = (shippingCharge * highestGST) / (100 + highestGST);
  const shippingBase = shippingCharge - shippingGST;

  // Final Aggregations
  const totalItemGst = calculatedItems.reduce((sum, i) => sum + (i.gstAmount * i.quantity), 0);
  const totalItemBase = calculatedItems.reduce((sum, i) => sum + (i.baseAmount * i.quantity), 0);
  
  const grandTotal = Math.max(0, (totalMRP - couponDiscount) + shippingCharge);

  return {
    items: calculatedItems,
    subtotal: totalMRP,
    discount: couponDiscount,
    discountedSubtotal: Math.max(0, totalMRP - couponDiscount),
    shipping: shippingCharge,
    shippingBase: Number(shippingBase.toFixed(2)),
    shippingGST: Number(shippingGST.toFixed(2)),
    itemBase: Number(totalItemBase.toFixed(2)),
    itemGst: Number(totalItemGst.toFixed(2)),
    totalGst: Number((totalItemGst + shippingGST).toFixed(2)),
    grandTotal: Number(grandTotal.toFixed(2))
  };
}

export async function POST(req: Request) {
  try {
    const { cart, customer, couponCode, userId } = await req.json();
    const db = getFirestoreInstance();

    // 1. Verify Stock & Fetch Master Data
    const validatedCart: StoreCartItem[] = [];
    for (const item of cart as StoreCartItem[]) {
      const pDoc = await db.collection('products').doc(item.productId).get();
      if (!pDoc.exists) throw new Error(`Product ${item.name} not found`);
      
      const pData = pDoc.data() as StoreProduct;
      const variant = pData.variants?.find((v: ProductVariant) => v.size === item.size);
      
      if (!variant) throw new Error(`Size ${item.size} not found for ${item.name}`);
      if (variant.stock < item.quantity) throw new Error(`Insufficient stock for ${item.name}`);
      
      validatedCart.push({
        ...item,
        salePrice: variant.salePrice,
        gstPercent: pData.gstPercent,
        hsnCode: pData.hsnCode
      });
    }

    // 2. Resolve Discount
    let discountAmount = 0;
    if (couponCode) {
      const couponSnap = await db.collection('storeCoupons')
        .where('code', '==', couponCode.toUpperCase().trim())
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (!couponSnap.empty) {
        const coupon = couponSnap.docs[0].data() as StoreCoupon;
        const subtotal = validatedCart.reduce((s, i) => s + (i.salePrice * i.quantity), 0);
        
        if (coupon.usedCount < coupon.usageLimit && (!coupon.minCartValue || subtotal >= coupon.minCartValue)) {
          discountAmount = coupon.type === 'percentage' 
            ? Math.round((subtotal * coupon.value) / 100)
            : coupon.value;
        }
      }
    }

    // 3. Resolve Shipping
    const settingsSnap = await db.collection('storeSettings').doc('shipping').get();
    const settings = settingsSnap.data() as StoreSettings || { minAmountFreeShipping: 2499, standardShipping: 150 };
    const subtotal = validatedCart.reduce((s, i) => s + (i.salePrice * i.quantity), 0);
    const shipping = (subtotal - discountAmount) >= settings.minAmountFreeShipping ? 0 : settings.standardShipping;

    // 4. BACKEND-ONLY CALCULATION
    const calculated = calculateOrder(validatedCart, discountAmount, shipping);

    // 5. Create Razorpay Order
    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(calculated.grandTotal * 100),
      currency: "INR",
      receipt: `store_${Date.now()}`,
      notes: {
        type: 'store_purchase',
        customerName: customer.name,
        couponCode: couponCode || ''
      }
    });

    // 6. Save Pending Order
    const orderRef = db.collection('storeOrders').doc();
    await orderRef.set({
      orderId: rzpOrder.id,
      userId: userId || null,
      customerName: customer.name,
      email: customer.email,
      mobile: customer.mobile,
      shippingAddress: customer.address,
      city: customer.city,
      state: customer.state,
      pincode: customer.pincode,
      items: calculated.items,
      subtotal: calculated.subtotal,
      discount: calculated.discount,
      discountedSubtotal: calculated.discountedSubtotal,
      itemBase: calculated.itemBase,
      itemGst: calculated.itemGst,
      shipping: calculated.shipping,
      shippingBase: calculated.shippingBase,
      shippingGst: calculated.shippingGST,
      gstAmount: calculated.totalGst,
      totalAmount: calculated.grandTotal,
      status: 'Pending',
      razorpayOrderId: rzpOrder.id,
      couponCode: couponCode || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ 
      success: true, 
      orderId: rzpOrder.id, 
      amount: rzpOrder.amount,
      firestoreId: orderRef.id 
    });

  } catch (error: any) {
    console.error("Store Checkout Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
