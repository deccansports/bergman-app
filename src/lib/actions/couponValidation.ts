// src/lib/actions/couponValidation.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { Coupon } from '@/lib/types';
import { getUserProfile } from '@/lib/dataLayerOptimized';

/**
 * Validates if a user is eligible for a "Previous Participant" coupon.
 * @param athleteUid - The UID of the user trying to apply the coupon.
 * @param coupon - The coupon object being validated.
 * @param eventId - The ID of the event for which the coupon is being applied.
 * @returns An object indicating success or failure with a message.
 */
export async function validatePreviousParticipantCoupon(
  athleteUid: string | null | undefined,
  coupon: Coupon,
  eventId: string
): Promise<{ success: boolean; message: string }> {
  const actionName = 'validatePreviousParticipantCoupon';
  const adminDb = getFirestoreInstance();

  if (!athleteUid) {
    return { success: false, message: 'You must be logged in to use a Previous Participant coupon.' };
  }
  if (!coupon.sourceEventIds || coupon.sourceEventIds.length === 0) {
    return { success: false, message: 'This coupon is not configured correctly (missing source events).' };
  }

  // Get user's email from KV-first profile lookup
  const userProfile = await getUserProfile(athleteUid);
  if (!userProfile) {
    return { success: false, message: 'Could not verify user profile for coupon eligibility.' };
  }
  const userEmail = String(userProfile.email || '').toLowerCase();
  if (!userEmail) {
    return { success: false, message: 'User profile is missing an email address.' };
  }

  // Check if the user was registered in any of the required source events.
  let isEligible = false;
  for (const sourceEventId of coupon.sourceEventIds) {
    // We query the 'participants' subcollection, not the 'raceResults' collection.
    const participantSnap = await adminDb
      .collection('events')
      .doc(sourceEventId)
      .collection('participants')
      .where('email', '==', userEmail)
      .limit(1)
      .get();
      
    if (!participantSnap.empty) {
      isEligible = true;
      break; // Found a registration, no need to check other source events
    }
  }
  
  if (!isEligible) {
    return { success: false, message: 'This coupon is only valid for participants of previous specified events.' };
  }

  // Also check if the current event is in the coupon's target list
  if (coupon.applicableEventIds && coupon.applicableEventIds.length > 0 && !coupon.applicableEventIds.includes(eventId)) {
    return { success: false, message: 'This coupon is valid for you, but not for the selected event.' };
  }

  return { success: true, message: 'User is eligible for this coupon.' };
}
