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
import { getRegistrationsCollectionRef } from '@/lib/eventDataPaths';
import { sendClubAffiliationNoticeToOwnerEmail } from '../auth/brevoService';
import { getKV, putKV, deleteKV, batchGetKV, listKVByPrefix } from '../cloudflare/kv';

import type {
  User,
  UserProfileUpdateData,
  ActiveDeferralInfo,
    DeferralEntry,
  EventParticipant,
  AthleteRegisteredEventDetail,
  RankedAthlete,
  EventCalendarEntry,
  CreateUserFormInput
} from '@/lib/types';
import { NO_CLUB_SELECTED_VALUE } from '../constants';
import { _syncUserToKV, _deleteParticipantFromKV, _syncClubUpcomingAthletes, _mirrorParticipantToKV } from './dataSyncActions';
import { getRewardTierByPoints } from '../rewardsEngine';
import { normalizeLiveTrackingPrivacy } from '@/lib/liveTrackingPrivacy';

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
        let snap = await db.collection('users')
            .where('email', '==', lowerEmail)
            .get();

        // Fallback for legacy profiles stored with non-lowercased email
        if (snap.empty && email.trim() !== lowerEmail) {
            snap = await db.collection('users')
                .where('email', '==', email.trim())
                .get();
        }

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
            email: lowerEmail,
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
 * Marks a user as verified on first successful login.
 * This updates both Firebase Auth and Firestore profile for consistency.
 */
export async function autoVerifyUserOnFirstLoginAction(uid: string, email?: string | null): Promise<{ success: boolean; verified: boolean }> {
    const actionName = 'autoVerifyUserOnFirstLoginAction';
    if (!uid) return { success: false, verified: false };

    try {
        const adminDb = getFirestoreInstance();
        const adminAuth = getAuthInstance();
        const normalizedEmail = String(email || '').trim().toLowerCase() || null;

        // Best effort: mark Firebase Auth account verified.
        try {
            const authUser = await adminAuth.getUser(uid);
            if (!authUser.emailVerified) {
                await adminAuth.updateUser(uid, { emailVerified: true });
            }
        } catch {
            // For legacy/manual users not present in Auth, continue with Firestore profile update.
        }

        const patch: Record<string, any> = {
            emailVerified: true,
            updatedAt: FieldValue.serverTimestamp(),
        };
        if (normalizedEmail) patch.email = normalizedEmail;

        await adminDb.collection('users').doc(uid).set(patch, { merge: true });
        await _syncUserToKV(uid);

        return { success: true, verified: true };
    } catch (e: any) {
        console.error(`[${actionName}] Failed:`, e?.message || e);
        return { success: false, verified: false };
    }
}

export async function getFinishedRacesForAthleteAction(uid: string, email?: string | null): Promise<{
    success: boolean;
    message: string;
    events: Array<{ id: string; name: string; date?: string | null; categories: string[] }>;
}> {
    const actionName = 'getFinishedRacesForAthleteAction';
    try {
        const normalizedUid = String(uid || '').trim();
        const normalizedEmail = String(email || '').trim().toLowerCase();

        if (!normalizedUid && !normalizedEmail) {
            return { success: false, message: 'Athlete identity is required.', events: [] };
        }

        // 1. Get list of events that have results from KV
        const eventsWithResults = await getKV<{ id: string }[]>('events:with-results', actionName);
        if (!eventsWithResults || !Array.isArray(eventsWithResults) || eventsWithResults.length === 0) {
            return { success: true, message: 'No events with results found.', events: [] };
        }

        // 2. Fetch all result arrays sequentially (rate-limit safe)
        const resultKeys = eventsWithResults.map(e => `results:${e.id}`);
        const eventResultsArray = await batchGetKV<any[]>(resultKeys, actionName);

        // 3. Filter rows that belong to this athlete and are finished
        const eventMap = new Map<string, { id: string; name: string; date?: string | null; categories: Set<string> }>();

        eventResultsArray.forEach((eventRaces) => {
            if (!eventRaces || !Array.isArray(eventRaces)) return;
            eventRaces.forEach((row: any) => {
                // Match by uid or email
                const rowUid = String(row?.athleteUid || '').trim();
                const rowEmail = String(row?.emailLower || row?.email || '').trim().toLowerCase();
                const isMatch =
                    (normalizedUid && rowUid === normalizedUid) ||
                    (normalizedEmail && rowEmail === normalizedEmail);
                if (!isMatch) return;

                // Only finished races
                const status = String(row?.statusNormalized || row?.status || '').trim().toLowerCase();
                if (status !== 'finished') return;

                const eventId = String(row?.eventId || '').trim();
                const eventName = String(row?.eventName || row?.location || 'Finished Race').trim();
                const key = eventId || `${eventName}:${String(row?.raceDate || '')}`;
                if (!eventMap.has(key)) {
                    eventMap.set(key, {
                        id: eventId || key,
                        name: eventName,
                        date: row?.raceDate || null,
                        categories: new Set<string>(),
                    });
                }
                const category = String(row?.raceCategory || row?.category || '').trim();
                if (category) eventMap.get(key)!.categories.add(category);
            });
        });

        const events = Array.from(eventMap.values())
            .map((e) => ({ id: e.id, name: e.name, date: e.date || null, categories: Array.from(e.categories) }))
            .sort((a, b) => {
                const ad = a.date ? new Date(a.date).getTime() : 0;
                const bd = b.date ? new Date(b.date).getTime() : 0;
                return bd - ad;
            });

        return { success: true, message: 'Finished races fetched from KV.', events };
    } catch (e: any) {
        console.error(`[${actionName}] failed:`, e?.message || e);
        return { success: false, message: e?.message || 'Failed to fetch finished races.', events: [] };
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
    const lowerEmail = data.email.toLowerCase().trim();

    // 1. Check for duplicate by email in Firestore
    const emailQuery = await adminDb.collection('users')
      .where('email', '==', lowerEmail)
      .get();
    
    if (!emailQuery.empty) {
      return { success: false, message: `User with email ${data.email} already exists` };
    }

    // 2. Check for duplicate by email in Auth
    try {
      const existingAuthUser = await adminAuth.getUserByEmail(lowerEmail);
      if (existingAuthUser) {
        return { success: false, message: `User with email ${data.email} already exists in authentication system` };
      }
    } catch (authError: any) {
      // User not found in auth is expected, continue
      if (authError.code !== 'auth/user-not-found') {
        throw authError;
      }
    }

    // 3. Create Auth user
    const password = Math.random().toString(36).slice(-12) + "A1!"; 
    const userRecord = await adminAuth.createUser({
      email: lowerEmail,
      password: password,
      displayName: data.name,
      phoneNumber: normalizeToE164(data.mobile) || undefined,
    });

    // 4. Create Firestore user document
    const userData = {
      uid: userRecord.uid,
      id: userRecord.uid,
      name: data.name,
      nameLower: data.name.toLowerCase(),
      email: lowerEmail,
      mobile: normalizeToE164(data.mobile) || null,
      emailVerified: false,
      isAdmin: false,
      isVolunteer: false,
      role: 'athlete',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await adminDb.collection('users').doc(userRecord.uid).set(userData);

    // 5. Sync to KV cache immediately
    const { putKV } = await import('../cloudflare/kv');
    const serialized = serializeValue(userData);
    await putKV(`user:${userRecord.uid}:profile`, serialized, 'createUserAction');

    console.log(`[createUserAction] User ${userRecord.uid} created and synced to KV`);

    return { success: true, message: "User account created successfully and synced to cache." };
  } catch (e: any) {
    console.error('[createUserAction] Error:', e);
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
            'clubAffiliationDate', 'clubId', 'liveTrackingPrivacy', 'trackingVisibility'
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

    if (data.liveTrackingPrivacy !== undefined) {
        updateDataFirestore.liveTrackingPrivacy = normalizeLiveTrackingPrivacy(data.liveTrackingPrivacy);
    }

    if (data.trackingVisibility !== undefined) {
        updateDataFirestore.trackingVisibility = normalizeLiveTrackingPrivacy(data.trackingVisibility);
    }

    if (!isClubOwner && data.clubId !== undefined) {
        const newClubId = (data.clubId === '' || data.clubId === NO_CLUB_SELECTED_VALUE) ? null : data.clubId;
        const oldClubId = existingUserData?.clubId || null;
        updateDataFirestore.clubId = newClubId;

                // Keep clubHistory in sync with root club fields.
                // This is critical for unaffiliation so background migration/backfill jobs
                // do not restore an old active club entry.
                const nowIso = new Date().toISOString();
                const existingHistory = Array.isArray((existingUserData as any)?.clubHistory)
                    ? ([...(existingUserData as any).clubHistory] as any[])
                    : [];
                let updatedHistory = existingHistory.map((entry) =>
                    entry?.isActive ? { ...entry, isActive: false, leftAt: entry.leftAt || nowIso } : entry
                );

                if (newClubId) {
                    const alreadyActiveSameClub = existingHistory.some(
                        (entry) => entry?.isActive && String(entry?.clubId || '') === String(newClubId)
                    );
                    if (!alreadyActiveSameClub) {
                        updatedHistory.push({
                            clubId: newClubId,
                            clubName: null,
                            joinedAt: nowIso,
                            leftAt: null,
                            isActive: true,
                        });
                    } else {
                        // If same club is already active, preserve existing history as-is.
                        updatedHistory = existingHistory;
                    }
                }
                updateDataFirestore.clubHistory = updatedHistory;
        
        if (newClubId) {
            const clubSnap = await adminDb.collection('clubs').doc(newClubId).get();
            if (clubSnap.exists) {
                const cData = clubSnap.data()!;
                updateDataFirestore.clubName = cData.name || null;
                if (oldClubId !== newClubId) {
                    updateDataFirestore.clubAffiliationDate = format(new Date(), 'yyyy-MM-dd');
                } else if (!updateDataFirestore.clubAffiliationDate && !existingUserData?.clubAffiliationDate) {
                    updateDataFirestore.clubAffiliationDate = format(new Date(), 'yyyy-MM-dd');
                }
                                // Backfill club name in latest history entry for this newly selected club.
                                if (Array.isArray(updateDataFirestore.clubHistory) && updateDataFirestore.clubHistory.length > 0) {
                                    const lastIdx = updateDataFirestore.clubHistory.length - 1;
                                    const lastEntry = updateDataFirestore.clubHistory[lastIdx];
                                    if (lastEntry?.isActive && String(lastEntry?.clubId || '') === String(newClubId)) {
                                        updateDataFirestore.clubHistory[lastIdx] = {
                                            ...lastEntry,
                                            clubName: cData.name || lastEntry.clubName || null,
                                        };
                                    }
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
        
        // 🔥 Sync both old and new clubs when affiliation changes
        if (oldClubId && oldClubId !== newClubId) {
            await _syncClubUpcomingAthletes(oldClubId);
        }
        if (newClubId && oldClubId !== newClubId) {
            await _syncClubUpcomingAthletes(newClubId);
        }

        // 🔥 Back-fill participant documents across all events for this user
        // so the Participants tab reflects the new club immediately.
        try {
            const finalClubId = newClubId;
            const finalClubName = finalClubId ? (updateDataFirestore.clubName || null) : null;
            const userEmail = (data.email || existingUserData?.email || '').toLowerCase();
            const allDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

            // Try fast collectionGroup lookup first. If indexes are missing (FAILED_PRECONDITION),
            // gracefully fall back to scanning event subcollections so unaffiliation still works.
            try {
                const participantSnap = await adminDb
                    .collectionGroup('participants')
                    .where('athleteUid', '==', uid)
                    .get();
                for (const d of participantSnap.docs) allDocs.set(d.ref.path, d);

                if (userEmail) {
                    const emailSnap = await adminDb.collectionGroup('participants').where('email', '==', userEmail).get();
                    for (const d of emailSnap.docs) allDocs.set(d.ref.path, d);
                }
            } catch (e: any) {
                const code = String(e?.code || '');
                const message = String(e?.message || '');
                const shouldFallback = code === '9' || /FAILED_PRECONDITION/i.test(message);
                if (!shouldFallback) throw e;

                console.warn(`[updateUserProfile] collectionGroup unavailable, falling back to per-event scan for UID ${uid}`);
                const eventsSnap = await adminDb.collection('events').select().get();
                for (const eventDoc of eventsSnap.docs) {
                    const participantsRef = adminDb.collection('events').doc(eventDoc.id).collection('participants');

                    const byUidSnap = await participantsRef.where('athleteUid', '==', uid).get();
                    for (const d of byUidSnap.docs) allDocs.set(d.ref.path, d);

                    if (userEmail) {
                        const byEmailSnap = await participantsRef.where('email', '==', userEmail).get();
                        for (const d of byEmailSnap.docs) allDocs.set(d.ref.path, d);
                    }
                }
            }

            const batchUpdate = adminDb.batch();
            let batchCount = 0;
            for (const [, docSnap] of allDocs) {
                batchUpdate.update(docSnap.ref, {
                    clubId: finalClubId,
                    clubName: finalClubName,
                    athleteUid: uid,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                batchCount++;
                if (batchCount === 500) break; // Firestore batch limit
            }
            if (batchCount > 0) {
                await batchUpdate.commit();
                // Mirror updated participants to KV
                for (const [, docSnap] of allDocs) {
                    try {
                        const updatedData = { ...docSnap.data(), id: docSnap.id, clubId: finalClubId, clubName: finalClubName, athleteUid: uid };
                        await _mirrorParticipantToKV(updatedData as any);
                    } catch { /* non-critical */ }
                }
            }
        } catch (e) {
            console.warn(`[updateUserProfile] Participant club back-fill failed for UID ${uid}:`, e);
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

export async function updateLiveTrackingPrivacyAction(
    uid: string,
    privacy: 'PUBLIC' | 'ANONYMOUS' | 'PRIVATE',
): Promise<{ success: boolean; message: string; updatedCount?: number }> {
    try {
        const adminDb = getFirestoreInstance();
        const normalizedPrivacy = normalizeLiveTrackingPrivacy(privacy);
        const userRef = adminDb.collection('users').doc(uid);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            return { success: false, message: 'User profile not found.' };
        }

        const userData = userSnap.data() || {};
        await userRef.set({
            liveTrackingPrivacy: normalizedPrivacy,
            trackingVisibility: normalizedPrivacy,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        const eventRows = Array.isArray((userData as any)?.upcomingEvents) ? (userData as any).upcomingEvents : [];
        const bookingRefs = new Map<string, { eventId: string; bookingId: string }>();
        for (const row of eventRows) {
            const eventId = String(row?.eventId || '').trim();
            const bookingId = String(row?.bookingId || '').trim();
            if (eventId && bookingId) bookingRefs.set(`${eventId}:${bookingId}`, { eventId, bookingId });
        }

        const email = String(userData?.email || '').trim().toLowerCase();
        const participantDocs: Array<{ ref: any; eventId: string }> = [];
        const collectionGroupQueries: Array<Promise<any>> = [];
        collectionGroupQueries.push(adminDb.collectionGroup('registrations').where('athleteUid', '==', uid).get());
        if (email) collectionGroupQueries.push(adminDb.collectionGroup('registrations').where('email', '==', email).get());

        const querySnapshots = await Promise.all(collectionGroupQueries.map((p) => p.catch(() => null)));
        for (const snap of querySnapshots) {
            if (!snap) continue;
            for (const doc of snap.docs) {
                const pathSegments = doc.ref.path.split('/');
                const eventId = pathSegments[1] || '';
                if (eventId) participantDocs.push({ ref: doc.ref, eventId });
            }
        }

        for (const ref of bookingRefs.values()) {
            const docRef = getRegistrationsCollectionRef(adminDb, ref.eventId).doc(ref.bookingId);
            participantDocs.push({ ref: docRef, eventId: ref.eventId });
        }

        const uniqueDocs = new Map<string, { ref: any; eventId: string }>();
        for (const item of participantDocs) uniqueDocs.set(item.ref.path, item);

        let updatedCount = 0;
        const mirrorPromises: Array<Promise<any>> = [];
        for (const item of uniqueDocs.values()) {
            await item.ref.set({
                liveTrackingPrivacy: normalizedPrivacy,
                trackingVisibility: normalizedPrivacy,
                privacy: normalizedPrivacy,
                registration: { liveTrackingPrivacy: normalizedPrivacy, trackingVisibility: normalizedPrivacy },
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            // Read the updated doc and mirror only this participant to KV (no full event re-index)
            const updatedSnap = await item.ref.get();
            if (updatedSnap.exists) {
                const participantData = {
                    ...updatedSnap.data(),
                    eventId: item.eventId,
                    bookingId: updatedSnap.id,
                } as any;
                mirrorPromises.push(_mirrorParticipantToKV(participantData, false).catch(() => null));
            }
            updatedCount++;
        }

        await Promise.all([
            _syncUserToKV(uid),
            ...mirrorPromises,
        ]);

        revalidatePath('/dashboard');
        revalidatePath('/athlete-journey');

        return {
            success: true,
            message: `Live tracking privacy updated to ${normalizedPrivacy}.`,
            updatedCount,
        };
    } catch (error: any) {
        return { success: false, message: error?.message || 'Failed to update live tracking privacy.' };
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
export async function getAthleteRegisteredEventsAction(
    userId: string,
    userEmail?: string | null,
    options?: { upcomingOnly?: boolean }
): Promise<{ success: boolean; message: string; events?: AthleteRegisteredEventDetail[] }> {
    const actionName = 'getAthleteRegisteredEventsAction';
    try {
      const normalize = (value: any) => String(value || '').trim().toLowerCase();
      const normalizeDigits = (value: any) => String(value || '').replace(/\D/g, '');
      const combinedStatus = (row: any) => [
          row?.ticketStatus,
          row?.registrationStatus,
          row?.status,
          row?.paymentStatus,
      ].map((s) => String(s || '').trim().toLowerCase()).filter(Boolean).join(' ');
      const isTerminal = (status: any) => {
          const s = String(status || '').trim().toLowerCase();
          return s.includes('cancel') || s.includes('defer') || s.includes('refund') || s.includes('inactive');
      };
            const isLikelyUpcomingParticipant = (p: any) => {
                    const rawStatus = combinedStatus(p);
                    const isUpcomingStatus =
                        rawStatus.includes('active') ||
                        rawStatus.includes('confirmed') ||
                        rawStatus.includes('pending') ||
                        rawStatus.includes('paymentcaptured');
                    if (!isUpcomingStatus) return false;
                    const eventDateStr = String(p?.eventDate || '').trim();
                    if (!eventDateStr || eventDateStr === 'TBD') return true;
                    const parsed = new Date(eventDateStr);
                    if (Number.isNaN(parsed.getTime())) return true;
                    return parsed >= startOfDayFns(new Date());
            };

      const indexKey = `user:${userId}:events:index`;
      const profile = (await getKV<any>(`user:${userId}:profile`, actionName)) || {};
      const identityEmails = new Set<string>([normalize(userEmail), normalize(profile?.email)].filter(Boolean));
      const identityMobiles = new Set<string>([
          normalizeDigits(profile?.mobile),
          normalizeDigits(profile?.phone),
      ].filter(Boolean));

      let userEventSummaries = await getKV<any[]>(indexKey, actionName);
      if (!Array.isArray(userEventSummaries)) userEventSummaries = [];

      const participantMap = new Map<string, EventParticipant>();
      const candidateEventIds = new Set<string>();

      // 1) Resolve from user index first
      if (userEventSummaries.length > 0) {
          const detailKeys = userEventSummaries
              .filter((s: any) => !!s?.eventId && !!s?.bookingId)
              .map((s: any) => {
                  candidateEventIds.add(String(s.eventId));
                  return `event:${s.eventId}:participant:${s.bookingId}`;
              });
          const detailRows = await batchGetKV<EventParticipant>(detailKeys, `${actionName}:user-index`);
          detailRows.forEach((row, idx) => {
              if (!row) return;
              const summary = userEventSummaries[idx];
              const eventId = String(row?.eventId || summary?.eventId || '').trim();
              const bookingId = String(row?.bookingId || summary?.bookingId || '').trim();
              if (!eventId || !bookingId || isTerminal(combinedStatus(row))) return;
              participantMap.set(`${eventId}:${bookingId}`, {
                  ...row,
                  eventId,
                  bookingId,
                  id: row?.id || bookingId,
                  athleteUid: (row as any)?.athleteUid || userId,
              } as EventParticipant);
          });
      }

      // 2) Resolve from new indexes (uid/email first; mobile fallback only if needed)
      const indexRowsFromNewIndexes: any[] = [];
      const primaryIndexKeys = [
          `athlete:uid:${userId}:registrations`,
          ...Array.from(identityEmails).map((e) => `athlete:email:${e}:registrations`),
      ];
      const primaryIndexValues = await batchGetKV<any[]>(primaryIndexKeys, `${actionName}:identity-indexes-primary`);
      primaryIndexValues.forEach((rows) => {
          if (Array.isArray(rows)) indexRowsFromNewIndexes.push(...rows);
      });

      if (indexRowsFromNewIndexes.length === 0) {
          const mobileIndexKeys = Array.from(identityMobiles).map((m) => `athlete:mobile:${m}:registrations`);
          const mobileIndexValues = await batchGetKV<any[]>(mobileIndexKeys, `${actionName}:identity-indexes-mobile-fallback`);
          mobileIndexValues.forEach((rows) => {
              if (Array.isArray(rows)) indexRowsFromNewIndexes.push(...rows);
          });
      }

      const registrationIds = new Set<string>();
      const directRefs: Array<{ eventId: string; bookingId: string }> = [];
      indexRowsFromNewIndexes.forEach((row: any) => {
          if (typeof row === 'string') {
              registrationIds.add(String(row));
              return;
          }
          const eventId = String(row?.eventId || '').trim();
          const bookingId = String(row?.bookingId || '').trim();
          const registrationId = String(row?.registrationId || row?.id || '').trim();
          if (eventId && bookingId) {
              candidateEventIds.add(eventId);
              directRefs.push({ eventId, bookingId });
          }
          if (registrationId) registrationIds.add(registrationId);
      });

      if (directRefs.length > 0) {
          const keys = directRefs.map((r) => `event:${r.eventId}:participant:${r.bookingId}`);
          const rows = await batchGetKV<EventParticipant>(keys, `${actionName}:direct-refs`);
          rows.forEach((row, idx) => {
              if (!row) return;
              const { eventId, bookingId } = directRefs[idx];
              if (isTerminal(combinedStatus(row))) return;
              participantMap.set(`${eventId}:${bookingId}`, {
                  ...row,
                  eventId: String((row as any)?.eventId || eventId),
                  bookingId: String((row as any)?.bookingId || bookingId),
                  id: String((row as any)?.id || bookingId),
                  athleteUid: (row as any)?.athleteUid || userId,
              } as EventParticipant);
          });
      }

      if (registrationIds.size > 0) {
          const regKeys = Array.from(registrationIds).map((id) => `registration:${id}`);
          const regRows = await batchGetKV<any>(regKeys, `${actionName}:registration-rows`);
          regRows.forEach((row) => {
              if (!row) return;
              const eventId = String(row?.eventId || '').trim();
              const bookingId = String(row?.bookingId || row?.id || '').trim();
              if (!eventId || !bookingId || isTerminal(combinedStatus(row))) return;
              candidateEventIds.add(eventId);
              participantMap.set(`${eventId}:${bookingId}`, {
                  ...row,
                  eventId,
                  bookingId,
                  id: String(row?.id || bookingId),
                  athleteUid: String(row?.athleteUid || userId),
              } as EventParticipant);
          });
      }
      // 3) Performance-first mode:
      // Avoid broad `event:*:participant:*` scans for dashboard load.
      // Use only indexed KV paths (user index + athlete uid/email/mobile + registration keys).
      const calendar = await getKV<EventCalendarEntry[]>('calendar:snapshot', actionName) || [];
      const today = startOfDayFns(new Date());
      const hasUpcomingFromFastPath = Array.from(participantMap.values()).some(isLikelyUpcomingParticipant);
      if (!hasUpcomingFromFastPath) {
          console.log(`[${actionName}] Fast-path indexes found no upcoming registrations; skipping broad detail-scan for performance.`);
      }

      const validParticipants = Array.from(participantMap.values());
      const validSummaries = validParticipants.map((p) => ({
          eventId: p.eventId,
          bookingId: p.bookingId,
          ticketStatus: p.ticketStatus,
          eventName: p.eventName,
          eventDate: p.eventDate,
          ticketName: p.ticketName,
          ticketId: p.ticketId || null,
      }));

      // Sync indexes for fast future reads
      await putKV(indexKey, validSummaries, `${actionName}:sync-user-index`);
      const registrationRefs = validParticipants
          .filter((p) => !!p?.eventId && !!p?.bookingId)
          .map((p) => ({ eventId: p.eventId, bookingId: p.bookingId, registrationId: p.id || p.bookingId }));

      await putKV(`athlete:uid:${userId}:registrations`, registrationRefs, `${actionName}:sync-athlete-index`);
      await Promise.all([
          ...Array.from(identityEmails).map((e) => putKV(`athlete:email:${e}:registrations`, registrationRefs, `${actionName}:sync-athlete-index`)),
          ...Array.from(identityMobiles).map((m) => putKV(`athlete:mobile:${m}:registrations`, registrationRefs, `${actionName}:sync-athlete-index`)),
      ]);

      const eventMetaMap = new Map(calendar.map((e: any) => [e.id, e]));
      const now = new Date();
    const upcomingOnly = options?.upcomingOnly !== false;
    let registeredEvents: AthleteRegisteredEventDetail[] = validParticipants
    .map((p) => {
            const rawStatus = combinedStatus(p);
          const derivedTicketStatus: AthleteRegisteredEventDetail['ticketStatus'] =
              (rawStatus.includes('cancel')) ? 'Cancelled' :
              (rawStatus.includes('defer')) ? 'Deferred' :
              (rawStatus.includes('refund')) ? 'Refunded' :
              (rawStatus.includes('inactive')) ? 'Inactive' :
              (rawStatus.includes('confirm')) ? 'Confirmed' :
              (rawStatus.includes('pending') || rawStatus.includes('paymentcaptured')) ? 'Pending' :
              'Active';

          const eventId = p.eventId!;
          const eData = eventMetaMap.get(eventId);
          const eventDateStr = p.eventDate || eData?.eventDate || null;
          const eventDate = eventDateStr ? parseISO(eventDateStr) : null;

          const { refundAmountPaisa, policyApplied, canCancel } = calculateRefundAmount(
              eventDateStr,
              p.originalAmountPaidAtFirstRegistrationPaisa ?? null,
              p.taxAmountPaidPaisa ?? null,
              p.processingFeePaidPaisa ?? null,
              p.platformFeePaidPaisa ?? null,
              p.registeredAt || (p as any).createdAt || null
          );

          return {
              id: eventId,
              eventId,
              participantId: p.id,
              name: p.name || 'Athlete',
              email: p.email || '',
              dob: p.dob || null,
              bookingId: p.bookingId || p.id,
              invoiceId: (p as any).invoiceId || null,
              invoiceNumber: (p as any).invoiceNumber || null,
              registeredAt: p.registeredAt || p.createdAt || null,
              athleteRaceCategory: p.ageCategory || 'N/A',
              eventName: eData?.eventName || p.eventName || 'Bergman Event',
              eventDate: eventDateStr,
              startTime: eData?.startTime || p.startTime || null,
              ticketName: p.ticketName || 'Selected Ticket',
              ticketId: p.ticketId || null,
              selectedSubCategory: p.selectedSubCategory || null,
              athleteBibNumber: p.bibNumber || null,
              ticketStatus: derivedTicketStatus,
              amountPaidPaisa: p.amountPaidPaisa,
              paymentId: p.paymentId || null,
              paymentMethod: p.paymentMethod || null,
              originalAmountPaidAtFirstRegistrationPaisa: p.originalAmountPaidAtFirstRegistrationPaisa,
              basePricePaisa: p.basePricePaisa,
              couponDiscountPaisa: p.couponDiscountPaisa,
              currency: eData?.currency || 'INR',
              canBeDeferred: eventDate ? isAfter(eventDate, addDays(now, 45)) : false,
              canBeCancelled: canCancel,
              canChangeCategory: eventDate ? isAfter(eventDate, addDays(now, 45)) : false,
              potentialRefundAmountPaisa: refundAmountPaisa,
              refundPolicyApplied: policyApplied,
              ticketDefinitions: eData?.ticketDefinitions || [],
              pricingBreakdown: p.pricingBreakdown,
              previousDeferralDetails: p.previousDeferralDetails,
              customSlug: eData?.customSlug || null,
              splitSecondPixEventId: eData?.splitSecondPixEventId || null,
              splitSecondPixEventName: eData?.splitSecondPixEventName || null,
              splitSecondPixEventSlug: eData?.splitSecondPixEventSlug || null,
              splitSecondPixSearchByBib: eData?.splitSecondPixSearchByBib ?? null,
              splitSecondPixSearchByFace: eData?.splitSecondPixSearchByFace ?? null,
          };
      })
      .filter((event) => {
          if (!upcomingOnly) return true;
          const status = String(event.ticketStatus || '').trim().toLowerCase();
          const isActiveLike = status === 'active' || status === 'confirmed' || status === 'pending';
          if (!isActiveLike) return false;
          const eventDateStr = String(event.eventDate || '').trim();
          if (!eventDateStr || eventDateStr === 'TBD') return false;
          const d = new Date(eventDateStr);
          if (Number.isNaN(d.getTime())) return false;
          return d >= today;
      });

      // Nearest upcoming first.
      registeredEvents.sort((a, b) => {
          const dateA = a.eventDate ? new Date(a.eventDate).getTime() : Number.MAX_SAFE_INTEGER;
          const dateB = b.eventDate ? new Date(b.eventDate).getTime() : Number.MAX_SAFE_INTEGER;
          return dateA - dateB;
      });

      return { success: true, message: 'History fetched from KV.', events: serializeValue(registeredEvents) };
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
        const db = getFirestoreInstance();
        const userSnap = await db.collection('users').doc(userId).get();
        const profile = userSnap.exists ? (userSnap.data() as any) : null;
        const profileEmail = String(profile?.email || '').toLowerCase().trim();
        const profileMobileDigits = String(profile?.mobile || '').replace(/\D/g, '');
        const profileMobileLast10 = profileMobileDigits.length >= 10 ? profileMobileDigits.slice(-10) : profileMobileDigits;

        // Check current year BEL rankings first (for updated tier), then fall back to last year
        // This way athletes keep their last year discount until they get a new ranking in current year
        const yearsToCheck = [currentRaceYear, lastYear];
        
        for (const year of yearsToCheck) {
            let belRankings = await getKV<any[]>(`bel:season:${year}:rankings`, actionName);
            
            // If KV is empty, try to sync from Firestore
            if (!Array.isArray(belRankings) || belRankings.length === 0) {
                try {
                    const { syncBelSeasonFromResultsKVAction } = await import('./eliteLeagueActions');
                    await syncBelSeasonFromResultsKVAction(year);
                    belRankings = await getKV<any[]>(`bel:season:${year}:rankings`, actionName);
                } catch (syncErr: any) {
                    console.warn(`[${actionName}] Failed to sync BEL season ${year} from Firestore:`, syncErr?.message || syncErr);
                }
            }
            
            if (Array.isArray(belRankings) && belRankings.length > 0) {
                const belAthlete = belRankings.find((r) => {
                    const rowEmail = String(r?.email || '').toLowerCase().trim();
                    const rowMobileDigits = String(r?.mobile || '').replace(/\D/g, '');
                    const rowMobileLast10 = rowMobileDigits.length >= 10 ? rowMobileDigits.slice(-10) : rowMobileDigits;
                    return (
                        r?.athleteId === userId ||
                        (!!profileEmail && rowEmail === profileEmail) ||
                        (!!profileMobileLast10 && rowMobileLast10 === profileMobileLast10)
                    );
                });
                const belTier = String(belAthlete?.belTier || '');
                const belPoints = Number(belAthlete?.totalPoints || 0);

                if (belTier === 'Gold' || belTier === 'Silver' || belTier === 'Bronze' || belTier === 'Provisional') {
                    if (belTier === 'Provisional' && belPoints < 499) {
                        console.log(`[${actionName}] Athlete ${userId} is Provisional with insufficient points (${belPoints}) in ${year}`);
                        // Don't return here - check next year
                        continue;
                    }

                    const belDiscountMap: Record<string, number> = {
                        Gold: 20,
                        Silver: 15,
                        Bronze: 10,
                        Provisional: 5,
                    };

                    return {
                        success: true,
                        message: `BEL reward unlocked (${year}): ${belTier} (${belDiscountMap[belTier]}% auto-apply discount).`,
                        discountPercent: belDiscountMap[belTier],
                        unlockedTier: `BEL ${belTier}`,
                        pointsEarnedLastYear: year === lastYear ? belPoints : undefined,
                    };
                }
            }
        }

        // Fall back to older performance rankings (pre-BEL system)
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

                const excludedEventIds = new Set<string>();

                // Primary source: users/{uid}.activeDeferral
                const userSnap = await db.collection('users').doc(uid).get();
                const userData = (userSnap.exists ? userSnap.data() : null) as User | null;
                const activeDeferral = userData?.activeDeferral as ActiveDeferralInfo | undefined;

                if (activeDeferral?.originalEventId) excludedEventIds.add(activeDeferral.originalEventId);
                if (activeDeferral?.deferredToEventId) excludedEventIds.add(activeDeferral.deferredToEventId);

                // Fallback source: deferrals collection by uid/email (for legacy or missing activeDeferral)
                if (excludedEventIds.size === 0) {
                    const normalizedEmail = String(email || '').trim().toLowerCase();
                    const candidateMap = new Map<string, DeferralEntry>();

                    if (uid) {
                        const byUid = await db.collection('deferrals').where('userId', '==', uid).get();
                        byUid.docs.forEach((doc) => candidateMap.set(doc.id, doc.data() as DeferralEntry));
                    }

                    if (normalizedEmail) {
                        const byEmail = await db.collection('deferrals').where('participantEmail', '==', normalizedEmail).get();
                        byEmail.docs.forEach((doc) => {
                            if (!candidateMap.has(doc.id)) {
                                candidateMap.set(doc.id, doc.data() as DeferralEntry);
                            }
                        });
                    }

                    const candidates = Array.from(candidateMap.values());
                    const activeLikeStatuses = new Set<DeferralEntry['status']>([
                        'Pending Ticket Selection',
                        'Pending Upgrade Payment',
                        'Pending',
                        'Processing',
                        'ProcessingConfirmation',
                        'Expired'
                    ]);

                    const picked = candidates
                        .filter((d) => activeLikeStatuses.has(d.status as DeferralEntry['status']))
                        .sort((a, b) => {
                            const aTs = new Date(String(a.updatedAt || a.createdAt || 0)).getTime();
                            const bTs = new Date(String(b.updatedAt || b.createdAt || 0)).getTime();
                            return bTs - aTs;
                        })[0];

                    if (picked?.originalEventId) excludedEventIds.add(picked.originalEventId);
                    if (picked?.deferredToEventId) excludedEventIds.add(picked.deferredToEventId as string);
                }

        const snap = await db.collection('events').where('eventDate', '>=', now.toISOString().split('T')[0]).get();
                const events = snap.docs
                    .map(doc => ({ id: doc.id, ...doc.data() } as EventCalendarEntry))
                    .filter(e => !e.isHidden)
                    .filter(e => !excludedEventIds.has(e.id));
        return { success: true, message: 'Fetched', events: serializeValue(events) };
    } catch (e: any) { return { success: false, message: e.message }; }
}

/**
 * Get all users in a specific club
 * Used for club member list display in governance dashboard
 */
export async function getUsersInClubAction(clubId: string): Promise<{ success: boolean; message: string; users?: any[] }> {
    try {
        const db = getFirestoreInstance();
        
        // Query users with this club ID
        const snap = await db.collection('users')
            .where('clubId', '==', clubId)
            .orderBy('name')
            .get();
        
        const users = snap.docs.map(doc => {
            const data = doc.data() as User;
            return {
                id: doc.id,
                name: data.name || 'Unknown',
                email: data.email,
                mobile: data.mobile,
                gender: data.gender,
                city: data.city,
                state: data.state,
                dob: data.dob,
                tshirtSize: data.tshirtSize,
            };
        });
        
        return { 
            success: true, 
            message: `Found ${users.length} members`, 
            users: JSON.parse(JSON.stringify(users)) 
        };
    } catch (e: any) { 
        return { success: false, message: e.message }; 
    }
}
