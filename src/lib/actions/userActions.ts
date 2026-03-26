// src/lib/actions/userActions.ts
'use server';

import { getFirestoreInstance, getAuthInstance } from '@/lib/firebaseAdmin';
import { FieldValue, type DocumentReference, FieldPath } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import {
  format,
  parseISO,
  isAfter,
  startOfDay as startOfDayFns,
  addDays,
} from 'date-fns';
import {
  serializeValue,
  serializeParticipantData,
  calculateAgeGroup as calculateAgeGroupUtil,
  calculateRefundAmount,
  normalizeToE164
} from '@/lib/utils';
import { sendClubAffiliationNoticeToOwnerEmail } from '../auth/brevoService';
import { getKV, putKV } from '../cloudflare/kv';

import type {
  User,
  UserProfileUpdateData,
  ActiveDeferralInfo,
  EventParticipant,
  AthleteRegisteredEventDetail,
  RankedAthlete,
  EventCalendarEntry,
  CreateUserFormInput
} from '@/lib/types';
import { NO_CLUB_SELECTED_VALUE } from '../constants';
import { _syncUserToKV, _deleteParticipantFromKV } from './dataSyncActions';
import { getRewardTierByPoints } from '../rewardsEngine';

/**
 * AUTO-LINK: Executed on login to merge bulk-upload placeholders with real auth accounts.
 * Safe approach: Checks for email match and loops events to move registrations.
 */
export async function linkAccountOnLoginAction(uid: string, email: string): Promise<{ success: boolean; merged?: boolean }> {
    const actionName = 'linkAccountOnLoginAction';
    if (!uid || !email) return { success: false };

    try {
        const db = getFirestoreInstance();
        const lowerEmail = email.toLowerCase().trim();

        // 1. Find if a placeholder profile exists for this email
        const snap = await db.collection('users')
            .where('email', '==', lowerEmail)
            .get();

        const placeholder = snap.docs.find(doc => doc.id !== uid);
        
        if (!placeholder) return { success: true, merged: false };

        const duplicateUid = placeholder.id;
        const duplicateData = placeholder.data();

        // 2. Identify and move Registrations (INDEX-FREE PER-EVENT SCAN)
        const eventsSnap = await db.collection('events').get();
        let totalMoved = 0;

        for (const eventDoc of eventsSnap.docs) {
            const participantsSnap = await eventDoc.ref.collection('participants').where('email', '==', lowerEmail).get();
            if (!participantsSnap.empty) {
                const batch = db.batch();
                participantsSnap.docs.forEach(doc => {
                    batch.update(doc.ref, { athleteUid: uid, updatedAt: FieldValue.serverTimestamp() });
                    totalMoved++;
                });
                await batch.commit();
            }
        }

        // 3. Move Deferrals & Results
        const resultsSnap = await db.collection('raceResults').where('email', '==', lowerEmail).get();
        if (!resultsSnap.empty) {
            const resultsBatch = db.batch();
            resultsSnap.docs.forEach(doc => {
                resultsBatch.update(doc.ref, { athleteUid: uid, updatedAt: FieldValue.serverTimestamp() });
            });
            await resultsBatch.commit();
        }

        const deferralsSnap = await db.collection('deferrals').where('participantEmail', '==', lowerEmail).get();
        if (!deferralsSnap.empty) {
            const defBatch = db.batch();
            deferralsSnap.docs.forEach(doc => {
                defBatch.update(doc.ref, { userId: uid, updatedAt: FieldValue.serverTimestamp() });
            });
            await defBatch.commit();
        }

        // 4. Update Primary Profile with missing data from placeholder
        const updatePayload: any = {
            name: duplicateData.name || null,
            mobile: duplicateData.mobile || null,
            clubId: duplicateData.clubId || null,
            clubName: duplicateData.clubName || null,
            updatedAt: FieldValue.serverTimestamp()
        };
        await db.collection('users').doc(uid).set(updatePayload, { merge: true });

        // 5. Audit Log & Cleanup
        await db.collection('mergeLogs').add({
            email: lowerEmail,
            mergedInto: uid,
            duplicateUid,
            duplicateData,
            totalMoved,
            timestamp: FieldValue.serverTimestamp(),
            source: 'auto-login'
        });

        await db.collection('users').doc(duplicateUid).delete();
        await _syncUserToKV(uid);

        return { success: true, merged: true };
    } catch (e: any) {
        console.error(`[${actionName}] Auto-link failed:`, e.message);
        return { success: false };
    }
}

/**
 * CORE INTERNAL: Syncs user profile data from a specific registration.
 */
export async function _updateUserFromParticipantData(
    participantData: Partial<EventParticipant>
): Promise<void> {
    const actionName = '_updateUserFromParticipantData';
    const identifier = participantData.email?.toLowerCase();
    const userIdentifier = participantData.athleteUid || identifier;

    if (!userIdentifier) return;

    try {
        const adminDb = getFirestoreInstance();
        const usersCollectionRef = adminDb.collection('users');
        let userDocRef: DocumentReference;
        let existingUserData: User | null = null;
        let isNewUser = false;

        if (participantData.athleteUid) {
            userDocRef = usersCollectionRef.doc(participantData.athleteUid);
            const userDoc = await userDocRef.get();
            if (userDoc.exists) existingUserData = userDoc.data() as User;
            else isNewUser = true;
        } else {
            const userQuery = await usersCollectionRef.where('email', '==', userIdentifier).limit(1).get();
            if (!userQuery.empty) {
                userDocRef = userQuery.docs[0].ref;
                existingUserData = userQuery.docs[0].data() as User;
            } else {
                isNewUser = true;
                const auth = getAuthInstance();
                try {
                    const authUser = await auth.getUserByEmail(identifier!);
                    userDocRef = usersCollectionRef.doc(authUser.uid);
                } catch(e) {
                    userDocRef = usersCollectionRef.doc();
                }
            }
        }
        
        const updatePayload: { [key: string]: any } = {};
        const isClubOwner = !!(existingUserData?.ownedClubId);

        const fieldsToSync: (keyof User)[] = [
            'name', 'mobile', 'gender', 'dob', 'address', 'city',
            'pincode', 'state', 'country', 'tshirtSize', 'bloodGroup',
            'emergencyContactNumber', 'personalRaceEmail', 'idProofUrl',
            'clubId', 'clubName', 'clubAffiliationDate'
        ];

        fieldsToSync.forEach(field => {
            if (isClubOwner && (field === 'clubId' || field === 'clubName' || field === 'clubAffiliationDate')) return;
            const newValue = participantData[field as keyof typeof participantData];
            
            if (newValue !== undefined) {
                if (field === 'clubId' && newValue === NO_CLUB_SELECTED_VALUE) {
                    updatePayload[field] = null;
                } else {
                    updatePayload[field] = newValue === '' ? null : newValue;
                }
            }
        });
        
        if (participantData.name) {
            updatePayload.name = participantData.name.trim();
            updatePayload.nameLower = updatePayload.name.toLowerCase();
        }

        if (Object.keys(updatePayload).length > 0 || isNewUser) {
            updatePayload.updatedAt = FieldValue.serverTimestamp();
            if (isNewUser) {
                updatePayload.createdAt = FieldValue.serverTimestamp();
                updatePayload.email = participantData.email?.toLowerCase();
                updatePayload.uid = userDocRef.id;
            }
            await userDocRef.set(updatePayload, { merge: true });
            await _syncUserToKV(userDocRef.id);
            revalidatePath(`/dashboard`); 
        }
    } catch (error: any) {
        console.error(`[${actionName}] Error:`, error.message);
    }
}

export async function createUserAction(data: CreateUserFormInput): Promise<{ success: boolean; message: string }> {
  try {
    const adminAuth = getAuthInstance();
    const adminDb = getFirestoreInstance();
    const password = Math.random().toString(36).slice(-12) + "A1!"; 
    
    const userRecord = await adminAuth.createUser({
      email: data.email,
      password: password,
      displayName: data.name,
      phoneNumber: normalizeToE164(data.mobile) || undefined,
    });

    await adminDb.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      name: data.name,
      nameLower: data.name.toLowerCase(),
      email: data.email.toLowerCase(),
      mobile: normalizeToE164(data.mobile) || null,
      emailVerified: false,
      isAdmin: false,
      isVolunteer: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true, message: "User account created successfully." };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function updateUserProfile(
  uid: string,
  data: UserProfileUpdateData
): Promise<{ success: boolean; message: string; updatedUser?: Partial<User> }> {
  try {
    const adminDb = getFirestoreInstance();
    const adminAuth = getAuthInstance();
    const userDocRef = adminDb.collection("users").doc(uid);
    const userDoc = await userDocRef.get();
    const existingUserData = userDoc.exists ? userDoc.data() as User : null;

    const isClubOwner = !!(existingUserData?.ownedClubId);
    const updateDataFirestore: { [key: string]: any } = { updatedAt: FieldValue.serverTimestamp() };
    const authUpdatePayload: { [key: string]: any } = {};
    
    const fields = [
      'name', 'mobile', 'photoURL', 'email', 'country', 'state', 'gender', 
      'dob', 'tshirtSize', 'bloodGroup', 'address', 'city', 'pincode', 
      'emergencyContactNumber', 'isVolunteer', 'idProofUrl', 'personalRaceEmail', 
      'clubAffiliationDate', 'clubId'
    ];
    
    fields.forEach(f => {
        if (data[f as keyof UserProfileUpdateData] !== undefined) {
            const val = data[f as keyof UserProfileUpdateData];
            updateDataFirestore[f] = val === '' ? null : val;
            if (f === 'name' && val) {
                updateDataFirestore.name = String(val).trim();
                updateDataFirestore.nameLower = String(val).trim().toLowerCase();
                authUpdatePayload.displayName = String(val).trim();
            }
            if (f === 'mobile' && val) {
                const normalizedMobile = normalizeToE164(String(val));
                if (normalizedMobile) {
                    updateDataFirestore.mobile = normalizedMobile;
                    authUpdatePayload.phoneNumber = normalizedMobile;
                }
            }
            if (f === 'email') authUpdatePayload.email = String(val).toLowerCase();
            if (f === 'photoURL') authUpdatePayload.photoURL = String(val);
        }
    });

    if (data.emailVerified !== undefined) {
        updateDataFirestore.emailVerified = data.emailVerified;
        authUpdatePayload.emailVerified = data.emailVerified;
    }

    if (!isClubOwner && data.clubId !== undefined) {
        const newClubId = (data.clubId === '' || data.clubId === NO_CLUB_SELECTED_VALUE) ? null : data.clubId;
        updateDataFirestore.clubId = newClubId;
        if (newClubId) {
            const clubSnap = await adminDb.collection('clubs').doc(newClubId).get();
            if (clubSnap.exists) {
                const cData = clubSnap.data()!;
                updateDataFirestore.clubName = cData.name || null;
                if (!updateDataFirestore.clubAffiliationDate && !existingUserData?.clubAffiliationDate) {
                    updateDataFirestore.clubAffiliationDate = format(new Date(), 'yyyy-MM-dd');
                }
                
                if (cData.ownerUid) {
                    const ownerDoc = await adminDb.collection('users').doc(cData.ownerUid).get();
                    if (ownerDoc.exists) {
                        const oData = ownerDoc.data() as User;
                        const athleteName = updateDataFirestore.name || existingUserData?.name || 'Athlete';
                        if (oData.email) sendClubAffiliationNoticeToOwnerEmail(oData.email, athleteName, cData.name).catch(console.error);
                    }
                }
            }
        } else {
            updateDataFirestore.clubName = null;
            updateDataFirestore.clubAffiliationDate = null;
        }
    }

    if (Object.keys(authUpdatePayload).length > 0) {
        await adminAuth.updateUser(uid, authUpdatePayload).catch((e) => {
            console.warn(`[updateUserProfile] Auth update partial failure for UID ${uid}:`, e.message);
        });
    }

    await userDocRef.set(updateDataFirestore, { merge: true });
    await _syncUserToKV(uid);

    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Profile updated.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function clearActiveCancellationNoticeAction(uid: string) {
  try {
    const db = getFirestoreInstance();
    await db.collection('users').doc(uid).update({ activeCancellation: FieldValue.delete() });
    revalidatePath('/dashboard');
    return { success: true, message: 'Cleared' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function clearActiveDeferralNoticeAction(uid: string) {
  try {
    const db = getFirestoreInstance();
    await db.collection('users').doc(uid).update({ activeDeferral: FieldValue.delete() });
    revalidatePath('/dashboard');
    return { success: true, message: 'Cleared' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * SCALE-FIRST: Fetch registered events with automatic GHOST PRUNING.
 */
export async function getAthleteRegisteredEventsAction(userId: string): Promise<{ success: boolean; message: string; events?: AthleteRegisteredEventDetail[] }> {
    const actionName = 'getAthleteRegisteredEventsAction';
    try {
      const indexKey = `user:${userId}:events:index`;
      const userEventSummaries = await getKV<any[]>(indexKey, actionName);
      
      if (!userEventSummaries || !Array.isArray(userEventSummaries) || userEventSummaries.length === 0) {
          return { success: true, message: "No registered events found.", events: [] };
      }

      const detailKeys = userEventSummaries.map(s => `event:${s.eventId}:participant:${s.bookingId}`);
      const detailResults = await Promise.all(detailKeys.map(key => getKV<EventParticipant>(key, actionName)));

      const validSummaries: any[] = [];
      const validParticipants: EventParticipant[] = [];
      let ghostDetected = false;

      userEventSummaries.forEach((summary, index) => {
          const detail = detailResults[index];
          if (detail) {
              validSummaries.push(summary);
              validParticipants.push(detail);
          } else {
              ghostDetected = true;
              console.warn(`[${actionName}] Pruning ghost registration link: BookingID ${summary.bookingId} in Event ${summary.eventId}`);
              // Trigger explicit cleanup for this specific key
              _deleteParticipantFromKV(summary.eventId, summary.bookingId, userId).catch(console.error);
          }
      });

      // GHOST PRUNING: If dead links were found, update the user's index in the cache immediately
      if (ghostDetected) {
          await putKV(indexKey, validSummaries, actionName);
      }

      const calendar = await getKV<EventCalendarEntry[]>('calendar:snapshot', actionName) || [];
      const eventMetaMap = new Map(calendar.map(e => [e.id, e]));

      const now = new Date();
      const registeredEvents: AthleteRegisteredEventDetail[] = validParticipants.map(p => {
        const eventId = p.eventId!;
        const eData = eventMetaMap.get(eventId);
        const eventDateStr = p.eventDate || eData?.eventDate || null;
        const eventDate = eventDateStr ? parseISO(eventDateStr) : null;

        const { refundAmountPaisa, policyApplied } = calculateRefundAmount(
            eventDateStr, 
            p.originalAmountPaidAtFirstRegistrationPaisa ?? null, 
            p.taxAmountPaidPaisa ?? null, 
            p.processingFeePaidPaisa ?? null, 
            p.platformFeePaidPaisa ?? null, 
            p.registeredAt
        );

        return {
            id: eventId,
            eventId: eventId,
            participantId: p.id,
            name: p.name || 'Athlete',
            email: p.email || '',
            dob: p.dob || null, // ENSURE DOB IS PASSED
            bookingId: p.bookingId || p.id,
            registeredAt: p.registeredAt || p.createdAt || null,
            athleteRaceCategory: p.ageCategory || 'N/A',
            eventName: eData?.eventName || p.eventName || 'Bergman Event',
            eventDate: eventDateStr,
            startTime: eData?.startTime || p.startTime || null,
            ticketName: p.ticketName || 'Selected Ticket',
            ticketId: p.ticketId || null,
            selectedSubCategory: p.selectedSubCategory || null,
            athleteBibNumber: p.bibNumber || null,
            ticketStatus: p.ticketStatus as any,
            amountPaidPaisa: p.amountPaidPaisa,
            originalAmountPaidAtFirstRegistrationPaisa: p.originalAmountPaidAtFirstRegistrationPaisa,
            basePricePaisa: p.basePricePaisa,
            couponDiscountPaisa: p.couponDiscountPaisa,
            currency: eData?.currency || 'INR',
            canBeDeferred: eventDate ? isAfter(eventDate, addDays(now, 45)) : false,
            canBeCancelled: eventDate ? isAfter(eventDate, addDays(now, 60)) : false,
            canChangeCategory: eventDate ? isAfter(eventDate, addDays(now, 45)) : false,
            potentialRefundAmountPaisa: refundAmountPaisa,
            refundPolicyApplied: policyApplied,
            ticketDefinitions: eData?.ticketDefinitions || [],
            pricingBreakdown: p.pricingBreakdown,
            previousDeferralDetails: p.previousDeferralDetails,
            customSlug: eData?.customSlug || null,
        };
      });

      registeredEvents.sort((a, b) => {
          const dateA = a.eventDate ? new Date(a.eventDate).getTime() : 0;
          const dateB = b.eventDate ? new Date(b.eventDate).getTime() : 0;
          return dateB - dateA;
      });

      return { success: true, message: "History fetched and cleaned.", events: serializeValue(registeredEvents) };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getPerformanceRewardAction(userId: string, currentRaceYear: number): Promise<{ 
    success: boolean; 
    message: string; 
    discountPercent: number; 
    unlockedTier?: string; 
    pointsEarnedLastYear?: number;
}> {
    const actionName = 'getPerformanceRewardAction';
    try {
        const lastYear = currentRaceYear - 1;
        const rankings = await getKV<RankedAthlete[]>(`rankings:athletes:${lastYear}`, actionName);
        
        if (!rankings || !Array.isArray(rankings)) {
            return { success: true, message: "No rankings found for previous season.", discountPercent: 0 };
        }

        const athleteData = rankings.find(r => r.athleteId === userId);
        if (!athleteData || athleteData.totalPoints === 0) {
            return { success: true, message: "No points recorded in previous season.", discountPercent: 0 };
        }

        const reward = getRewardTierByPoints(athleteData.totalPoints);
        
        return {
            success: true,
            message: `Performance reward found: ${reward.label}`,
            discountPercent: reward.discountPercent,
            unlockedTier: reward.tier,
            pointsEarnedLastYear: athleteData.totalPoints
        };
    } catch (error: any) {
        return { success: false, message: error.message, discountPercent: 0 };
    }
}

export async function getBlacklistedUsersAction(): Promise<{ success: boolean; message: string; users?: User[] }> {
    try {
        const db = getFirestoreInstance();
        const snap = await db.collection('users').where('isBlacklisted', '==', true).get();
        const users = snap.docs.map(doc => ({ ...doc.data(), uid: doc.id } as User));
        return { success: true, message: 'Fetched', users: serializeValue(users) };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function blacklistUserAction(uid: string, reason: string): Promise<{ success: boolean; message: string }> {
    try {
        const db = getFirestoreInstance();
        await db.collection('users').doc(uid).update({
            isBlacklisted: true,
            blacklistReason: reason,
            blacklistedAt: new Date().toISOString(),
            updatedAt: FieldValue.serverTimestamp()
        });
        await _syncUserToKV(uid);
        return { success: true, message: 'User blacklisted.' };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function unblacklistUserAction(uid: string): Promise<{ success: boolean; message: string }> {
    try {
        const db = getFirestoreInstance();
        await db.collection('users').doc(uid).update({
            isBlacklisted: false,
            blacklistReason: FieldValue.delete(),
            blacklistedAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp()
        });
        await _syncUserToKV(uid);
        return { success: true, message: 'User removed from blacklist.' };
    } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getEligibleEventsForDeferralAction(uid: string, email: string): Promise<{ success: boolean; message: string; events?: EventCalendarEntry[] }> {
    try {
        const db = getFirestoreInstance();
        const now = startOfDayFns(new Date());
        const snap = await db.collection('events').where('eventDate', '>=', now.toISOString().split('T')[0]).get();
        const events = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as EventCalendarEntry)).filter(e => !e.isHidden);
        return { success: true, message: 'Fetched', events: serializeValue(events) };
    } catch (e: any) { return { success: false, message: e.message }; }
}
