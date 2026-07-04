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
import { deleteKV, getKV, putKV } from '../cloudflare/kv';
import { _syncCouponsToKV } from './dataSyncActions';
import { getCalendarEventsAction } from './eventActions';
import { getUserProfile } from '../dataLayerOptimized';

const ALL_COUPONS_CACHE_KEY = 'coupons:all:v1';
const ALL_COUPONS_CACHE_TTL_MS = 2 * 60 * 1000;

async function validateClubCoupon(coupon: Coupon, athleteUid: string): Promise<{ success: boolean; message: string }> {
    if (!athleteUid) {
        return { success: false, message: 'You must be logged in to use a Club Coupon.' };
    }
    try {
    const db: Firestore = getFirestoreInstance();
    const liveUserSnap = await db.collection('users').doc(athleteUid).get();
    const liveUserData = liveUserSnap.exists
      ? ({ uid: liveUserSnap.id, ...serializeValue(liveUserSnap.data()) } as Record<string, any>)
      : null;
    const cachedUserData = await getUserProfile(athleteUid);
    const userData = liveUserData || cachedUserData;

    if (!userData) {
            return { success: false, message: 'Could not verify user profile for club affiliation.' };
        }
        const activeClubFromHistory = Array.isArray(userData?.clubHistory)
          ? (userData.clubHistory.find((entry: any) => entry?.isActive) || userData.clubHistory[userData.clubHistory.length - 1])
          : null;
        const clubId = userData?.clubId || activeClubFromHistory?.clubId;
        
        if (!clubId || clubId === NO_CLUB_SELECTED_VALUE) {
            return { success: false, message: 'This coupon is only valid for athletes affiliated with a registered club.' };
        }

        const allowedClubs = Array.isArray(coupon.applicableClubIds)
          ? coupon.applicableClubIds.filter(Boolean)
          : [];

        if (allowedClubs.length > 0 && !allowedClubs.includes(String(clubId))) {
          return { success: false, message: 'This club coupon is not valid for your club.' };
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

    if (validatedData.couponType === 'Club Coupon' && (!validatedData.applicableClubIds || validatedData.applicableClubIds.length === 0)) {
      return { success: false, message: 'For Club Coupon, select at least one club.' };
    }
    if (validatedData.couponType === 'Access Code' && (!validatedData.applicableTicketIds || validatedData.applicableTicketIds.length === 0)) {
      return { success: false, message: 'For Access Code, select at least one hidden ticket.' };
    }
    
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
    await deleteKV(ALL_COUPONS_CACHE_KEY, 'createCouponAction');
    
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

    if (validatedData.couponType === 'Club Coupon' && (!validatedData.applicableClubIds || validatedData.applicableClubIds.length === 0)) {
      return { success: false, message: 'For Club Coupon, select at least one club.' };
    }
    if (validatedData.couponType === 'Access Code' && (!validatedData.applicableTicketIds || validatedData.applicableTicketIds.length === 0)) {
      return { success: false, message: 'For Access Code, select at least one hidden ticket.' };
    }

    const couponRef = adminDb.collection('coupons').doc(couponId);
    
    await couponRef.update({
      ...validatedData,
      updatedAt: FieldValue.serverTimestamp(),
    });
    
    // 🔥 AUTO-SYNC TO KV
    await _syncCouponsToKV();
    await deleteKV(ALL_COUPONS_CACHE_KEY, 'updateCouponAction');
    
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
    await deleteKV(ALL_COUPONS_CACHE_KEY, 'deleteCouponAction');
    
    revalidatePath('/admin/dashboard');
    return { success: true, message: `Coupon "${couponId}" deleted and sync triggered.` };
  } catch (e: any) {
    return { success: false, message: `Coupon deletion failed: ${e.message}` };
  }
}

export async function getAllCouponsAction(): Promise<{ success: boolean; message: string; coupons?: Coupon[] }> {
    const adminDb: Firestore = getFirestoreInstance();
    try {
        const cached = await getKV<{ fetchedAt: string; coupons: Coupon[] }>(ALL_COUPONS_CACHE_KEY, 'getAllCouponsAction');
        if (cached?.fetchedAt && Array.isArray(cached.coupons)) {
          const ageMs = Date.now() - new Date(cached.fetchedAt).getTime();
          if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= ALL_COUPONS_CACHE_TTL_MS) {
            return { success: true, message: 'Coupons fetched (cached).', coupons: cached.coupons };
          }
        }

        const couponsSnapshot = await adminDb.collection('coupons').orderBy('createdAt', 'desc').get();
        if (couponsSnapshot.empty) return { success: true, message: "No coupons found.", coupons: [] };
        const coupons: Coupon[] = couponsSnapshot.docs.map(doc => ({ ...serializeValue(doc.data()), id: doc.id } as Coupon));

        await putKV(ALL_COUPONS_CACHE_KEY, {
          fetchedAt: new Date().toISOString(),
          coupons,
        }, 'getAllCouponsAction');

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
  athleteUid?: string,
  userEmailInput?: string
): Promise<{ success: boolean; message: string; coupon?: Coupon; discountAmountPaisa?: number }> {
  const actionName = 'validateCouponAction';
  if (!code) return { success: false, message: 'Coupon code is required.' };

  try {
    const activeCoupons = await getKV<Coupon[]>('coupons:active', actionName);
    const upperCode = code.toUpperCase();
    const isInfluencerRegistrationCoupon = upperCode.startsWith('INF30');
    const adminDb = getFirestoreInstance();
    let coupon = activeCoupons?.find(c => c.code === upperCode);

    // Firestore fallback — ensures regular coupons keep working even if KV is stale/missing.
    if (!coupon) {
      const couponSnap = await adminDb.collection('coupons').doc(upperCode).get();
      if (couponSnap.exists) {
        coupon = { ...serializeValue(couponSnap.data()), id: couponSnap.id } as Coupon;
        // Best effort cache refresh for subsequent validations.
        try {
          await _syncCouponsToKV();
        } catch (syncErr: any) {
          console.warn(`[${actionName}] Coupon KV refresh failed:`, syncErr?.message || syncErr);
        }
      }
    }
    
    if (coupon) {
        // 1. Basic Checks
        if (!coupon.isActive) return { success: false, message: 'This coupon is no longer active.' };
        if (coupon.usageCount >= coupon.usageLimit) return { success: false, message: 'This coupon has reached its usage limit.' };
        
        const now = new Date();
        if (coupon.startDate && isAfter(parseISO(coupon.startDate), now)) return { success: false, message: 'This coupon is not yet active.' };
        if (coupon.expiryDate && isBefore(parseISO(coupon.expiryDate), startOfDay(now))) {
          return {
            success: false,
            message: isInfluencerRegistrationCoupon
              ? 'You have not registered in the given timeframe, hence your influencer status is auto cancelled. If you have any questions, write to info@bergmantri.com.'
              : 'This coupon has expired.',
          };
        }

        // 2. Targeting Checks
        if (coupon.applicableEventIds && coupon.applicableEventIds.length > 0 && !coupon.applicableEventIds.includes(eventId)) {
          return { success: false, message: 'This coupon is not valid for the selected event.' };
        }
        
        if (coupon.applicableTicketIds && coupon.applicableTicketIds.length > 0 && !coupon.applicableTicketIds.includes(ticketId)) {
          return { success: false, message: 'This coupon is not valid for the selected race category.' };
        }

        const couponBoundEmail = String((coupon as any).email || '').trim().toLowerCase();
        if (couponBoundEmail && coupon.couponType !== 'Birthday Coupon' && coupon.couponType !== 'Feedback Coupon') {
          let resolvedUserEmail = String(userEmailInput || '').trim().toLowerCase();
          if (!resolvedUserEmail && athleteUid) {
            const userProfile = await getUserProfile(athleteUid);
            resolvedUserEmail = String(userProfile?.email || '').trim().toLowerCase();
          }

          if (!resolvedUserEmail) {
            return { success: false, message: 'Please enter your registered email to use this coupon.' };
          }

          if (resolvedUserEmail !== couponBoundEmail) {
            return { success: false, message: 'This coupon is valid only for the email it was issued to.' };
          }
        }

        // 3. Role/History Validation
        let typeValidationResult: { success: boolean, message: string };
        switch(coupon.couponType) {
            case 'Club Coupon':
                typeValidationResult = await validateClubCoupon(coupon, athleteUid || '');
                break;
            case 'Birthday Coupon': {
                const couponEmail = String((coupon as any).email || '').trim().toLowerCase();
                if (!couponEmail) {
                  return { success: false, message: 'This birthday coupon is not configured with an email.' };
                }

                let resolvedUserEmail = String(userEmailInput || '').trim().toLowerCase();
                if (!resolvedUserEmail && athleteUid) {
                  const userProfile = await getUserProfile(athleteUid);
                  resolvedUserEmail = String(userProfile?.email || '').trim().toLowerCase();
                }

                if (!resolvedUserEmail) {
                  return { success: false, message: 'Please enter your registered email to use this birthday coupon.' };
                }

                if (resolvedUserEmail !== couponEmail) {
                  return { success: false, message: 'This birthday coupon is valid only for the email it was issued to.' };
                }

                // Read fresh coupon usage from Firestore to avoid stale KV edge cache allowing reuse.
                const liveCouponSnap = await adminDb.collection('coupons').doc(String(coupon.code || '').toUpperCase()).get();
                const liveCoupon = liveCouponSnap.exists ? (liveCouponSnap.data() as Coupon) : null;
                if (!liveCoupon) {
                  return { success: false, message: 'This birthday coupon is no longer available.' };
                }
                if ((liveCoupon.usageCount || 0) >= (liveCoupon.usageLimit || 1)) {
                  return { success: false, message: 'This birthday coupon has already been used for this year.' };
                }

                typeValidationResult = { success: true, message: 'Valid birthday coupon.' };
                break;
            }
              case 'Previous Participant': {
                 const userProfile = athleteUid ? await getUserProfile(athleteUid) : null;
                 const userEmail = userProfile?.email;
                 if (!userEmail) return { success: false, message: 'User email is required.' };
                 typeValidationResult = await validatePreviousParticipant(coupon, userEmail, adminDb);
                break;
              }
            case 'Feedback Coupon': {
                if ((coupon as any).used) return { success: false, message: 'This feedback coupon has already been used.' };

                const couponEmail = String((coupon as any).email || '').trim().toLowerCase();
                if (!couponEmail) {
                  return { success: false, message: 'This feedback coupon is not configured with an email.' };
                }

                let resolvedUserEmail = String(userEmailInput || '').trim().toLowerCase();
                if (!resolvedUserEmail && athleteUid) {
                  const userProfile = await getUserProfile(athleteUid);
                  resolvedUserEmail = String(userProfile?.email || '').trim().toLowerCase();
                }

                if (!resolvedUserEmail) {
                  return { success: false, message: 'Please enter your registered email to use this feedback coupon.' };
                }

                if (resolvedUserEmail !== couponEmail) {
                  return { success: false, message: 'This feedback coupon is valid only for the email it was issued to.' };
                }

                typeValidationResult = { success: true, message: "Valid feedback coupon." };
                break;
            }
            default:
                typeValidationResult = { success: true, message: "Coupon is valid." };
                break;
        }
        if (!typeValidationResult.success) return typeValidationResult;

        // Access codes are unlock-only and must not apply any discount amount.
        if (coupon.couponType === 'Access Code') {
          return {
            success: true,
            message: 'Access code verified. It unlocks hidden tickets and does not apply a discount.',
            coupon,
            discountAmountPaisa: 0,
          };
        }
        
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

export async function unlockEventRegistrationWithAccessCodeAction(
  code: string,
  eventIdentifier: string,
  identifierType: 'slug' | 'eventId' = 'slug'
): Promise<{
  success: boolean;
  message: string;
  coupon?: Coupon;
  event?: any;
  unlockedTicketIds?: string[];
}> {
  const actionName = 'unlockEventRegistrationWithAccessCodeAction';

  if (!code?.trim()) {
    return { success: false, message: 'Access code is required.' };
  }

  if (!eventIdentifier?.trim()) {
    return { success: false, message: 'Event identifier is required.' };
  }

  try {
    const upperCode = code.trim().toUpperCase();
    const adminDb: Firestore = getFirestoreInstance();

    // Try KV cache first, fall back to Firestore so freshly-created codes work immediately
    let coupon: Coupon | undefined;
    const activeCoupons = await getKV<Coupon[]>('coupons:active', actionName);
    coupon = activeCoupons?.find((item) => item.code === upperCode);

    if (!coupon) {
      // Firestore fallback — guarantees fresh codes that haven't been KV-synced yet are found
      const directSnap = await adminDb.collection('coupons').doc(upperCode).get();
      if (directSnap.exists) {
        coupon = { ...serializeValue(directSnap.data()), id: directSnap.id } as Coupon;
        // Trigger a background KV re-sync so subsequent calls hit cache
        _syncCouponsToKV().catch(() => {});
      }
    }

    if (!coupon) {
      return { success: false, message: 'Invalid access code.' };
    }

    if (coupon.couponType !== 'Access Code') {
      return { success: false, message: 'This code does not unlock registrations.' };
    }

    if (!coupon.isActive) {
      return { success: false, message: 'This access code is inactive.' };
    }

    if ((coupon.usageCount || 0) >= (coupon.usageLimit || 1)) {
      return { success: false, message: 'This access code has reached its usage limit.' };
    }

    const now = new Date();
    if (coupon.startDate && isAfter(parseISO(coupon.startDate), now)) {
      return { success: false, message: 'This access code is not yet active.' };
    }
    if (coupon.expiryDate && isBefore(parseISO(coupon.expiryDate), startOfDay(now))) {
      return { success: false, message: 'This access code has expired.' };
    }

    let eventDoc;

    if (identifierType === 'eventId') {
      const directDoc = await adminDb.collection('events').doc(eventIdentifier).get();
      if (!directDoc.exists) {
        return { success: false, message: 'Event not found.' };
      }
      eventDoc = directDoc;
    } else {
      const eventsSnapshot = await adminDb.collection('events').where('customSlug', '==', eventIdentifier).limit(1).get();
      if (eventsSnapshot.empty) {
        const directDoc = await adminDb.collection('events').doc(eventIdentifier).get();
        if (!directDoc.exists) {
          return { success: false, message: 'Event not found.' };
        }
        eventDoc = directDoc;
      } else {
        eventDoc = eventsSnapshot.docs[0];
      }
    }

    const eventId = eventDoc.id;

    if (coupon.applicableEventIds && coupon.applicableEventIds.length > 0 && !coupon.applicableEventIds.includes(eventId)) {
      return { success: false, message: 'This access code is not valid for this event.' };
    }

    const fullCalendar = await getCalendarEventsAction();
    const eventData = fullCalendar.events?.find((item) => item.id === eventId);

    if (!eventData) {
      return { success: false, message: 'Could not load event details.' };
    }

    const sponsorsSnapshot = await eventDoc.ref.collection('sponsors').orderBy('order', 'asc').get();
    const sponsors = sponsorsSnapshot.docs.map((doc) => serializeValue({ id: doc.id, ...doc.data() }));

    const unlockedTicketIds = Array.isArray(coupon.applicableTicketIds)
      ? coupon.applicableTicketIds.filter(Boolean)
      : [];

    if (unlockedTicketIds.length > 0) {
      const eventTicketIds = (eventData.ticketDefinitions || []).map((ticket: any) => ticket.id);
      const matchingTicketIds = unlockedTicketIds.filter((ticketId) => eventTicketIds.includes(ticketId));

      if (matchingTicketIds.length === 0) {
        return { success: false, message: 'This access code is not linked to any tickets in this event.' };
      }

      return {
        success: true,
        message: 'Access code accepted.',
        coupon,
        event: { ...eventData, sponsors },
        unlockedTicketIds: matchingTicketIds,
      };
    }

    return {
      success: true,
      message: 'Access code accepted.',
      coupon,
      event: { ...eventData, sponsors },
      unlockedTicketIds: [],
    };
  } catch (e: any) {
    return { success: false, message: `Access code validation failed: ${e.message}` };
  }
}

/**
 * SCALE-FIRST: AUTO-APPLY COUPONS VIA EDGE CACHE
 */
export async function getAutoApplyCouponForUserAction(
    eventId: string,
    ticketId: string,
  athleteUid: string,
  selectedClubId?: string | null
): Promise<{ success: boolean; message: string; coupon?: Coupon; }> {
    const actionName = 'getAutoApplyCouponForUserAction';
    if (!athleteUid || !eventId) return { success: false, message: "User and event must be specified." };
    try {
        const coupons = await getKV<Coupon[]>('coupons:active', actionName);
        if (!coupons || coupons.length === 0) return { success: true, message: 'No coupons in cache.' };

        const adminDb: Firestore = getFirestoreInstance();
        const liveUserSnap = await adminDb.collection('users').doc(athleteUid).get();
        const liveUserData = liveUserSnap.exists
          ? ({ uid: liveUserSnap.id, ...serializeValue(liveUserSnap.data()) } as Record<string, any>)
          : null;
        const cachedUserData = await getUserProfile(athleteUid);
        const userData = liveUserData || cachedUserData;
        if (!userData) return { success: false, message: "User profile not found." };
        const userEmail = userData?.email;
        const activeClubFromHistory = Array.isArray(userData?.clubHistory)
          ? (userData.clubHistory.find((entry: any) => entry?.isActive) || userData.clubHistory[userData.clubHistory.length - 1])
          : null;
        const userClubId = userData?.clubId || activeClubFromHistory?.clubId;
        const resolvedSelectedClubId = selectedClubId && selectedClubId !== NO_CLUB_SELECTED_VALUE
          ? selectedClubId
          : null;
        const effectiveClubId = resolvedSelectedClubId || userClubId || null;
        
        if (!userEmail) return { success: true, message: "No user email found." };
        
        const now = new Date();
        const isClubAthlete = !!(effectiveClubId && effectiveClubId !== NO_CLUB_SELECTED_VALUE);

        const baseTypes: Coupon['couponType'][] = ['Birthday Coupon', 'Previous Participant', 'Early Bird / Sale', 'Feedback Coupon', 'Club Coupon'];
        const clubPriority: Coupon['couponType'][] = ['Birthday Coupon', 'Feedback Coupon', 'Club Coupon', 'Previous Participant', 'Early Bird / Sale'];
        const defaultPriority: Coupon['couponType'][] = ['Birthday Coupon', 'Feedback Coupon', 'Previous Participant', 'Early Bird / Sale', 'Club Coupon'];
        const priority = isClubAthlete ? clubPriority : defaultPriority;
        const typeRank = new Map(priority.map((t, i) => [t, i]));

        const eligibleAutoCoupons = coupons
          .filter(c => baseTypes.includes(c.couponType))
          .sort((a, b) => (typeRank.get(a.couponType) ?? 999) - (typeRank.get(b.couponType) ?? 999));

        for (const coupon of eligibleAutoCoupons) {
            const expiryDate = coupon.expiryDate ? parseISO(coupon.expiryDate) : null;
            if (expiryDate && isBefore(expiryDate, startOfDay(now))) continue;
            if (coupon.usageCount >= coupon.usageLimit) continue;
            
            if (coupon.applicableEventIds && coupon.applicableEventIds.length > 0 && !coupon.applicableEventIds.includes(eventId)) continue;
            if (coupon.applicableTicketIds && coupon.applicableTicketIds.length > 0 && !coupon.applicableTicketIds.includes(ticketId)) continue;

            if (coupon.couponType === 'Birthday Coupon') {
              const currentYear = new Date().getFullYear();
              const matchesYear = !(coupon as any).birthdayYear || Number((coupon as any).birthdayYear) === currentYear;
              if (matchesYear && (coupon as any).email?.toLowerCase() === userEmail.toLowerCase()) {
                return { success: true, message: 'Birthday coupon auto-applied!', coupon };
              }
            } else if (coupon.couponType === 'Feedback Coupon') {
                if ((coupon as any).email?.toLowerCase() === userEmail.toLowerCase() && !(coupon as any).used) {
                    return { success: true, message: 'Feedback coupon applied!', coupon };
                }
            } else if (coupon.couponType === 'Club Coupon') {
                if (effectiveClubId && effectiveClubId !== NO_CLUB_SELECTED_VALUE) {
                    const allowedClubs = Array.isArray(coupon.applicableClubIds)
                      ? coupon.applicableClubIds.filter(Boolean)
                      : [];
                    if (allowedClubs.length > 0 && !allowedClubs.includes(String(effectiveClubId))) {
                      continue;
                    }
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
