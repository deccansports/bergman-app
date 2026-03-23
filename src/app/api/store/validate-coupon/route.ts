import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { StoreCoupon } from '@/lib/types';

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { code, subtotal } = await req.json();
    const db = getFirestoreInstance();

    const snap = await db.collection('storeCoupons')
      .where('code', '==', code.toUpperCase().trim())
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ success: false, message: "Invalid or inactive coupon code." });
    }

    const coupon = snap.docs[0].data() as StoreCoupon;

    if (coupon.usedCount >= coupon.usageLimit) {
      return NextResponse.json({ success: false, message: "Coupon usage limit reached." });
    }

    if (coupon.minCartValue && subtotal < coupon.minCartValue) {
      return NextResponse.json({ 
        success: false, 
        message: `Minimum order value of ₹${coupon.minCartValue} required for this coupon.` 
      });
    }

    return NextResponse.json({ 
      success: true, 
      coupon: {
        code: coupon.code,
        type: coupon.type,
        value: coupon.value
      }
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
