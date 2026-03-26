// src/app/api/admin/paid-food/search/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { PaidFoodOrder, PaidFoodCoupon } from '@/lib/types';
import { toIsoStringSafe } from '@/lib/utils';

async function searchPaidFoodOrders(
    searchTerm: string,
    searchBy: 'mobile' | 'email' | 'orderId' | 'coupon'
): Promise<{ success: boolean; message: string; order?: PaidFoodOrder, coupons?: PaidFoodCoupon[] }> {
    const actionName = 'searchPaidFoodOrders (API)';
    if (!searchTerm) {
        return { success: false, message: 'Search term is required.' };
    }
    
    const adminDb = getFirestoreInstance();
    let order: PaidFoodOrder | undefined;
    let coupons: PaidFoodCoupon[] = [];

    try {
        if (searchBy === 'coupon') {
            if (searchTerm.length !== 4) return { success: false, message: 'Coupon code must be 4 digits.' };
            const couponSnap = await adminDb.collection('paidFoodCoupons').doc(searchTerm).get();
            if (!couponSnap.exists) return { success: false, message: 'Coupon not found.' };
            const couponData = couponSnap.data() as PaidFoodCoupon;
            
            const orderQuery = await adminDb.collection('paidFoodOrders').where('orderId', '==', couponData.orderId).limit(1).get();
            if (orderQuery.empty) return { success: false, message: 'Order associated with coupon not found.' };

            const orderDoc = orderQuery.docs[0];
            const orderData = orderDoc.data();
            order = { id: orderDoc.id, ...orderData, createdAt: toIsoStringSafe(orderData?.createdAt) } as PaidFoodOrder;

        } else {
            const queryField = searchBy === 'orderId' ? 'orderId' : (searchBy === 'email' ? 'buyerEmail' : 'buyerMobile');
            const orderQuery = await adminDb.collection('paidFoodOrders').where(queryField, '==', searchTerm).orderBy('createdAt', 'desc').limit(1).get();

            if (orderQuery.empty) return { success: false, message: 'No order found for this contact.' };
            
            const orderDoc = orderQuery.docs[0];
            const orderData = orderDoc.data();
            order = { id: orderDoc.id, ...orderData, createdAt: toIsoStringSafe(orderData?.createdAt) } as PaidFoodOrder;
        }
        
        if (order) {
            const couponsSnapshot = await adminDb.collection('paidFoodCoupons').where('orderId', '==', order.orderId).get();
            coupons = couponsSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    issuedAt: toIsoStringSafe(data.issuedAt),
                    redeemedAt: toIsoStringSafe(data.redeemedAt),
                } as PaidFoodCoupon;
            });
        }

        return { success: true, message: 'Order found.', order, coupons };

    } catch (e: any) {
        console.error(`[${actionName}] Error:`, e);
        if ((e as any).code === 'FAILED_PRECONDITION') {
            return { success: false, message: `A database index is required for this query.` };
        }
        return { success: false, message: `Server search error: ${e.message}` };
    }
}


export async function POST(request: NextRequest) {
    try {
        const { term, by } = await request.json();
        const result = await searchPaidFoodOrders(term, by);
        if (result.success) {
            return NextResponse.json(result);
        } else {
            return NextResponse.json(result, { status: 404 });
        }
    } catch (error) {
        return NextResponse.json({ success: false, message: 'Invalid request body.' }, { status: 400 });
    }
}
