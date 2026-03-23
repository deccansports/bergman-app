// src/lib/actions/couponActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { CouponCreateSchema, type CouponCreateFormInput, CouponUpdateSchema, type CouponUpdateFormInput } from '@/lib/schemas';
import type { Coupon } from '@/lib/types';
import { serializeValue } from '@/lib/utils';
import { format, parseISO, isBefore, isAfter, startOfDay } from 'date-fns';
import { NO_CLUB_SELECTED_VALUE } from '../constants';
import { getKV, putKV } from '../cloudflare/kv';
import { _syncCouponsToKV } from './dataSyncActions';

async function validateClubCoupon(coupon: Coupon, athleteUid: string, db: Firestore): Promise<{ success: boolean; message: string }> {
    if (!athleteUid) {
        return { success: false, message: 'You must be logged in to use a Club Coupon.' };
    }
    try {
        const userDoc = await db.collection('users').doc(athleteUid).get();
        if (!userDoc.exists) { 
            return { success: false, message: 'Could not verify user profile for club affiliation.' };
        }
        const userData = userDoc.data();
        const clubId = userData?.clubId;
        
        if (!clubId || clubId === NO_CLUB_SELECTED_VALUE) {
            return { success: false, message: 'This coupon is only valid for athletes affiliated with a registered club.' };
        }
        return { success: true, message: 'Club affiliation verified.' };
    } catch (error: any) {
        console.error(`[validateClubCoupon] Error: ${error.message}`);
        return { success: false, message: 'Could not verify club affiliation.' };
    }
}

async function validatePreviousParticipant(
    coupon: Coupon,
    userEmail: string,
    db: Firestore
): Promise<{ success: boolean; message: string }> {
    if (!coupon.sourceEventIds || coupon.sourceEventIds.length === 0) {
        return { success: false, message: "Coupon is not configured correctly (missing source events)." };
    }
    if (!userEmail) {
        return { success: false, message: "User email is required to check participation history." };
    }

    try {
        const lowerCaseEmail = userEmail.toLowerCase();
        for (const sourceEventId of coupon.sourceEventIds) {
            const participantsSnap = await db.collection('events').doc(sourceEventId).collection('participants')
                .where('email', '==', lowerCaseEmail)
                .limit(1)
                .get();

            if (!participantsSnap.empty) {
                return { success: true, message: 'User is a previous participant.' };
            }
        }
        return { success: false, message: "This discount is for previous participants only." };
    } catch (error: any) {
        console.error(`[validatePreviousParticipant] Error:`, error);
        return { success: false, message: `Could not verify participation history.` };
    }
}

export async function createCouponAction(data: CouponCreateFormInput): Promise<{ success: boolean; message: string; couponId?: string }> {
  const adminDb: Firestore = getFirestoreInstance();
  try {
    const payloadForValidation = {
      ...data,
      startDate: data.startDate ? format(parseISO(data.startDate), 'yyyy-MM-dd') : undefined,
      expiryDate: data.expiryDate ? format(parseISO(data.expiryDate), 'yyyy-MM-dd') : undefined,
    };

    const validation = CouponCreateSchema.safeParse(payloadForValidation);
    if (!validation.success) {
      return { success: false, message: validation.error.errors[0].message };
    }
    const validatedData = validation.data;
    
    const couponRef = adminDb.collection('coupons').doc(validatedData.code.toUpperCase());
    const couponSnap = await couponRef.get();
    if (couponSnap.exists) return { success: false, message: 'Coupon code already exists.' };
    
    const payloadForServer = {
      ...validatedData,
      usageCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    };

    await couponRef.set(payloadForServer);
    
    // 🔥 AUTO-SYNC TO KV
    await _syncCouponsToKV();
    
    revalidatePath('/admin/dashboard');
    return { success: true, message: `Coupon "${payloadForServer.code}" created and synced successfully.`, couponId: payloadForServer.code };
  } catch (e: any) {
    return { success: false, message: `Coupon creation failed: ${e.message}` };
  }
}

export async function updateCouponAction(couponId: string, data: CouponUpdateFormInput): Promise<{ success: boolean; message: string }> {
  const adminDb: Firestore = getFirestoreInstance();
  try {
     const payloadForValidation = {
      ...data,
      startDate: data.startDate ? (typeof data.startDate === 'string' ? data.startDate : format(data.startDate, 'yyyy-MM-dd')) : undefined,
      expiryDate: data.expiryDate ? (typeof data.expiryDate === 'string' ? data.expiryDate : format(data.expiryDate, 'yyyy-MM-dd')) : undefined,
    };
    const validation = CouponUpdateSchema.safeParse(payloadForValidation);
    if (!validation.success) {
      return { success: false, message: validation.error.errors[0].message };
    }
    const validatedData = validation.data;
    const couponRef = adminDb.collection('coupons').doc(couponId);
    
    await couponRef.update({
      ...validatedData,
      updatedAt: FieldValue.serverTimestamp(),
    });
    
    // 🔥 AUTO-SYNC TO KV
    await _syncCouponsToKV();
    
    revalidatePath('/admin/dashboard');
    return { success: true, message: `Coupon "${couponId}" updated and synced.` };
  } catch (e: any) {
    return { success: false, message: `Coupon update failed: ${e.message}` };
  }
}

export async function deleteCouponAction(couponId: string): Promise<{ success: boolean; message: string }> {
  const adminDb: Firestore = getFirestoreInstance();
  try {
    await adminDb.collection('coupons').doc(couponId).delete();
    
    // 🔥 AUTO-SYNC TO KV
    await _syncCouponsToKV();
    
    revalidatePath('/admin/dashboard');
    return { success: true, message: `Coupon "${couponId}" deleted and sync triggered.` };
  } catch (e: any) {
    return { success: false, message: `Coupon deletion failed: ${e.message}` };
  }
}

export async function getAllCouponsAction(): Promise<{ success: boolean; message: string; coupons?: Coupon[] }> {
    const adminDb: Firestore = getFirestoreInstance();
    try {
        const couponsSnapshot = await adminDb.collection('coupons').orderBy('createdAt', 'desc').get();
        if (couponsSnapshot.empty) return { success: true, message: "No coupons found.", coupons: [] };
        const coupons: Coupon[] = couponsSnapshot.docs.map(doc => ({ ...serializeValue(doc.data()), id: doc.id } as Coupon));
        return { success: true, message: 'Coupons fetched.', coupons };
    } catch (e: any) {
        return { success: false, message: `Error fetching coupons: ${e.message}` };
    }
}

/**
 * SCALE-FIRST: VALIDATE COUPON VIA EDGE CACHE (KV)
 */
export async function validateCouponAction(
  code: string,
  eventId: string,
  ticketId: string,
  athleteUid?: string
): Promise<{ success: boolean; message: string; coupon?: Coupon; discountAmountPaisa?: number }> {
  const actionName = 'validateCouponAction';
  if (!code) return { success: false, message: 'Coupon code is required.' };

  try {
    const activeCoupons = await getKV<Coupon[]>('coupons:active', actionName);
    const upperCode = code.toUpperCase();
    
    const coupon = activeCoupons?.find(c => c.code === upperCode);
    
    if (coupon) {
        // 1. Basic Checks
        if (!coupon.isActive) return { success: false, message: 'This coupon is no longer active.' };
        if (coupon.usageCount >= coupon.usageLimit) return { success: false, message: 'This coupon has reached its usage limit.' };
        
        const now = new Date();
        if (coupon.startDate && isAfter(parseISO(coupon.startDate), now)) return { success: false, message: 'This coupon is not yet active.' };
        if (coupon.expiryDate && isBefore(parseISO(coupon.expiryDate), startOfDay(now))) return { success: false, message: 'This coupon has expired.' };

        // 2. Targeting Checks
        if (coupon.applicableEventIds && coupon.applicableEventIds.length > 0 && !coupon.applicableEventIds.includes(eventId)) {
          return { success: false, message: 'This coupon is not valid for the selected event.' };
        }
        
        if (coupon.applicableTicketIds && coupon.applicableTicketIds.length > 0 && !coupon.applicableTicketIds.includes(ticketId)) {
          return { success: false, message: 'This coupon is not valid for the selected race category.' };
        }

        // 3. Role/History Validation
        const adminDb = getFirestoreInstance();
        let typeValidationResult: { success: boolean, message: string };
        switch(coupon.couponType) {
            case 'Club Coupon':
                typeValidationResult = await validateClubCoupon(coupon, athleteUid || '', adminDb);
                break;
            case 'Previous Participant':
                 const userDoc = athleteUid ? await adminDb.collection('users').doc(athleteUid).get() : null;
                 const userEmail = userDoc?.data()?.email;
                 if (!userEmail) return { success: false, message: 'User email is required.' };
                 typeValidationResult = await validatePreviousParticipant(coupon, userEmail, adminDb);
                break;
            case 'Feedback Coupon':
                if ((coupon as any).used) return { success: false, message: 'This feedback coupon has already been used.' };
                typeValidationResult = { success: true, message: "Valid feedback coupon." };
                break;
            default:
                typeValidationResult = { success: true, message: "Coupon is valid." };
                break;
        }
        if (!typeValidationResult.success) return typeValidationResult;
        
        // 4. Calculate Discount
        const ticketSnap = await adminDb.collection('events').doc(eventId).collection('ticketDefinitions').doc(ticketId).get();
        if (!ticketSnap.exists) return { success: false, message: 'Cannot apply coupon: ticket not found.' };
        const basePrice = ticketSnap.data()?.price || 0;

        if (coupon.minCartValue && basePrice < coupon.minCartValue) return { success: false, message: `A minimum ticket price of ₹${coupon.minCartValue / 100} is required.` };
        
        let discountAmountPaisa = coupon.discountType === 'percentage' 
            ? Math.round((basePrice * coupon.discountValue) / 100)
            : (coupon.discountValue * 100); 
        
        return { success: true, message: 'Coupon applied successfully!', coupon, discountAmountPaisa: Math.min(discountAmountPaisa, basePrice) };
    }

    return { success: false, message: 'Invalid coupon code.' };
  } catch (e: any) {
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

/**
 * SCALE-FIRST: AUTO-APPLY COUPONS VIA EDGE CACHE
 */
export async function getAutoApplyCouponForUserAction(
    eventId: string,
    ticketId: string,
    athleteUid: string
): Promise<{ success: boolean; message: string; coupon?: Coupon; }> {
    const actionName = 'getAutoApplyCouponForUserAction';
    if (!athleteUid || !eventId) return { success: false, message: "User and event must be specified." };
    try {
        const coupons = await getKV<Coupon[]>('coupons:active', actionName);
        if (!coupons || coupons.length === 0) return { success: true, message: 'No coupons in cache.' };

        const adminDb: Firestore = getFirestoreInstance();
        const userDoc = await adminDb.collection('users').doc(athleteUid).get();
        if (!userDoc.exists) return { success: false, message: "User profile not found." };
        const userData = userDoc.data();
        const userEmail = userData?.email;
        const userClubId = userData?.clubId;
        
        if (!userEmail) return { success: true, message: "No user email found." };
        
        const now = new Date();
        const eligibleAutoCoupons = coupons.filter(c => ['Previous Participant', 'Early Bird / Sale', 'Feedback Coupon', 'Club Coupon'].includes(c.couponType));

        for (const coupon of eligibleAutoCoupons) {
            const expiryDate = coupon.expiryDate ? parseISO(coupon.expiryDate) : null;
            if (expiryDate && isBefore(expiryDate, startOfDay(now))) continue;
            if (coupon.usageCount >= coupon.usageLimit) continue;
            
            if (coupon.applicableEventIds && coupon.applicableEventIds.length > 0 && !coupon.applicableEventIds.includes(eventId)) continue;
            if (coupon.applicableTicketIds && coupon.applicableTicketIds.length > 0 && !coupon.applicableTicketIds.includes(ticketId)) continue;

            if (coupon.couponType === 'Feedback Coupon') {
                if ((coupon as any).email?.toLowerCase() === userEmail.toLowerCase() && !(coupon as any).used) {
                    return { success: true, message: 'Feedback coupon applied!', coupon };
                }
            } else if (coupon.couponType === 'Club Coupon') {
                if (userClubId && userClubId !== NO_CLUB_SELECTED_VALUE) {
                    return { success: true, message: 'Club discount applied!', coupon };
                }
            } else if (coupon.couponType === 'Previous Participant') {
                const lowerCaseEmail = userEmail.toLowerCase();
                let isEligible = false;
                for (const sourceId of (coupon.sourceEventIds || [])) {
                    const snap = await adminDb.collection('events').doc(sourceId).collection('participants').where('email', '==', lowerCaseEmail).limit(1).get();
                    if(!snap.empty) { isEligible = true; break; }
                }
                if (isEligible) return { success: true, message: `Previous participant discount applied!`, coupon };
            } else if (coupon.couponType === 'Early Bird / Sale') {
                return { success: true, message: 'Early Bird discount applied!', coupon };
            }
        }
        return { success: true, message: 'No eligible automatic discounts.', coupon: undefined };
    } catch (e: any) {
        return { success: false, message: `Server action failed: ${e.message}` };
    }
}
