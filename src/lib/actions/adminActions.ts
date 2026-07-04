
// src/lib/actions/adminActions.ts
'use server';

import { getFirestoreInstance, getAuthInstance } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp, type Firestore, type DocumentData, type QueryDocumentSnapshot, FieldPath } from 'firebase-admin/firestore';
import type { Auth as AdminAuthType, UserRecord } from 'firebase-admin/auth';
import { revalidatePath } from 'next/cache';
import { toDateStringSafe, toIsoStringSafe, serializeParticipantData, serializeValue, normalizeToE164 } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { isBefore, parseISO, isAfter, startOfDay } from 'date-fns';
import {
  AdminParticipantEditSchema,
  CreateUserSchema,
  type CreateUserFormInput,
  AdminRaceResultEditSchema,
  type AdminRaceResultEditFormInput,
} from '@/lib/schemas';
import type { User, UserProfileUpdateData, RaceResult, Club, AdminAthleteAnalytics, EventParticipant, RepeatedAthleteInfo, ComparisonStats, LiveAthlete, Split, Leg, Status, EventCalendarEntry } from '@/lib/types';
import { hmsToSeconds, normalizeStatus } from '../utils';
import { _internal_fetchAllRaceDataFromFirestore } from './publicResultActions';
import { _mirrorParticipantToKV, _syncUserToKV } from './dataSyncActions';
import { getCachedServerValue } from '@/lib/serverCache';


export async function testTimingPartnerApiAction(
  apiUrl: string,
  bib: string,
  eventId: string | null
): Promise<{ success: boolean; message: string; data?: any }> {
  const actionName = 'testTimingPartnerApiAction';
  if (!apiUrl || !bib) {
    return { success: false, message: 'API URL and BIB number are required.' };
  }
   if (!eventId) {
    return { success: false, message: 'An event must be selected to test against.' };
  }
  
  const url = new URL(apiUrl);
  url.searchParams.set('bibno', bib);
  const fullUrl = url.toString();

  try {
    const response = await fetch(fullUrl, {
      signal: AbortSignal.timeout(10000) // 10-second timeout
    });

    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`API responded with status ${response.status}: ${responseText}`);
    }

    const data = await response.json();
    
    // After successful API call, verify against Firestore
    const adminDb = getFirestoreInstance();
    const participantSnap = await adminDb.collection('events').doc(eventId).collection('participants').where('bibNumber', '==', String(bib)).limit(1).get();

    if (participantSnap.empty) {
      return { 
        success: false, 
        message: `API call was successful, but no participant with BIB number '${bib}' was found in the selected event's database.`,
        data
      };
    }
    
    const participantName = participantSnap.docs[0].data().name;

    return { success: true, message: `API call successful & participant '${participantName}' (BIB: ${bib}) found in the database.`, data };

  } catch (e: any) {
    console.error(`[${actionName}] Error testing API:`, e);
    return { success: false, message: `Failed to fetch from API: ${e.message}` };
  }
}

/**
 * INTERACTIVE MERGE TOOL: Detects duplicate accounts based on email.
 */
export async function findDuplicateAthletesAction(): Promise<{ success: boolean; message: string; duplicates?: { email: string; users: User[] }[] }> {
    try {
        const db = getFirestoreInstance();
        const snap = await db.collection('users').select('email', 'name', 'mobile', 'createdAt').get();
        
        const emailMap = new Map<string, User[]>();
        snap.forEach(doc => {
            const data = doc.data() as User;
            const email = data.email?.toLowerCase().trim();
            if (email) {
                if (!emailMap.has(email)) emailMap.set(email, []);
                emailMap.get(email)!.push({ ...data, uid: doc.id });
            }
        });

        const duplicates = Array.from(emailMap.entries())
            .filter(([_, users]) => users.length > 1)
            .map(([email, users]) => ({
                email,
                users: users.sort((a, b) => {
                    const getTime = (val: any) => {
                        if (!val) return 0;
                        if (val instanceof Timestamp) return val.toMillis();
                        if (typeof val === 'string') return new Date(val).getTime();
                        if (val.seconds) return val.seconds * 1000;
                        return 0;
                    };
                    return getTime(b.createdAt) - getTime(a.createdAt);
                })
            }));

        return { success: true, message: `Detected ${duplicates.length} duplicate email groups.`, duplicates: serializeValue(duplicates) };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

/**
 * INTERACTIVE MERGE TOOL: Merges a duplicate account into a primary account.
 * Simplified approach: Loops through events to avoid index requirements on collectionGroup.
 */
export async function mergeAthletesAction(primaryUid: string, duplicateUid: string): Promise<{ success: boolean; message: string }> {
    const actionName = 'mergeAthletesAction';
    try {
        const db = getFirestoreInstance();
        
        const [primarySnap, duplicateSnap] = await Promise.all([
            db.collection('users').doc(primaryUid).get(),
            db.collection('users').doc(duplicateUid).get()
        ]);

        if (!primarySnap.exists || !duplicateSnap.exists) throw new Error("One or both user profiles not found.");

        const p = primarySnap.data() as User;
        const d = duplicateSnap.data() as User;
        const email = d.email?.toLowerCase().trim() || p.email?.toLowerCase().trim();

        if (!email) throw new Error("Could not resolve email for merging.");

        // 1. Merge Profile Fields
        const updatePayload: any = {
            mobile: p.mobile || d.mobile || null,
            clubId: p.clubId || d.clubId || null,
            clubName: p.clubName || d.clubName || null,
            gender: p.gender || d.gender || null,
            dob: p.dob || d.dob || null,
            address: p.address || d.address || null,
            city: p.city || d.city || null,
            state: p.state || d.state || null,
            country: p.country || d.country || null,
            pincode: p.pincode || d.pincode || null,
            updatedAt: FieldValue.serverTimestamp()
        };

        // 2. Identify and move Registrations (INDEX-FREE PER-EVENT SCAN)
        const eventsSnap = await db.collection('events').get();
        let totalMoved = 0;

        for (const eventDoc of eventsSnap.docs) {
            const participantsSnap = await eventDoc.ref.collection('participants').where('email', '==', email).get();
            if (!participantsSnap.empty) {
                const batch = db.batch();
                participantsSnap.docs.forEach(doc => {
                    batch.update(doc.ref, { athleteUid: primaryUid, updatedAt: FieldValue.serverTimestamp() });
                    totalMoved++;
                });
                await batch.commit();
            }
        }

        // 3. Move Race Results
        const resultsSnap = await db.collection('raceResults').where('email', '==', email).get();
        if (!resultsSnap.empty) {
            const resultsBatch = db.batch();
            resultsSnap.docs.forEach(doc => {
                resultsBatch.update(doc.ref, { athleteUid: primaryUid, updatedAt: FieldValue.serverTimestamp() });
            });
            await resultsBatch.commit();
        }

        // 4. Move Deferrals
        const deferralsSnap = await db.collection('deferrals').where('participantEmail', '==', email).get();
        if (!deferralsSnap.empty) {
            const defBatch = db.batch();
            deferralsSnap.docs.forEach(doc => {
                defBatch.update(doc.ref, { userId: primaryUid, updatedAt: FieldValue.serverTimestamp() });
            });
            await defBatch.commit();
        }

        // 5. Create Audit Log
        await db.collection('mergeLogs').add({
            email,
            primaryUid,
            duplicateUid,
            duplicateData: serializeValue(d),
            totalMoved,
            timestamp: FieldValue.serverTimestamp(),
            source: 'manual-admin'
        });

        // 6. Finalize User Profiles
        await db.collection('users').doc(primaryUid).update(updatePayload);
        await db.collection('users').doc(duplicateUid).delete();

        await _syncUserToKV(primaryUid);

        revalidatePath('/admin/dashboard');
        revalidatePath('/dashboard');
        return { success: true, message: `Merge complete. Moved ${totalMoved} registrations and ${resultsSnap.size} race results.` };
    } catch (e: any) {
        console.error(`[${actionName}] Merge Failed:`, e.message);
        return { success: false, message: `Merge Failed: ${e.message}` };
    }
}

export async function searchAthletesForAdminAction(
  searchTerm: string,
  searchBy: 'name' | 'email' | 'mobile' | 'bibNumber'
): Promise<{ success: boolean; message: string; athletes?: Array<User & { races?: RaceResult[]; upcomingEvents?: { eventId: string; eventName: string; eventDate?: string; bookingId?: string; registeredDate?: string; bibNumber?: string; ticketCategory?: string; raceCategory?: string }[] }> }> {
    const actionName = 'searchAthletesForAdminAction';
    if (!searchTerm || typeof searchTerm !== 'string') {
        return { success: false, message: "A valid search term is required." };
    }
    try {
        const adminDb = getFirestoreInstance();
        const adminAuth = getAuthInstance();
        const normalizedSearchTerm = searchTerm.trim();
        const lowerSearchTerm = normalizedSearchTerm.toLowerCase();

        let userDocs: QueryDocumentSnapshot<DocumentData>[] = [];
        const userDocsMap = new Map<string, QueryDocumentSnapshot<DocumentData>>();

        if (searchBy === 'bibNumber') {
            const participantsQuery = await adminDb.collectionGroup('participants').where('bibNumber', '==', searchTerm).limit(10).get();
            if (!participantsQuery.empty) {
                const userIds = new Set(participantsQuery.docs.map(doc => doc.data().athleteUid).filter(Boolean));
                if (userIds.size > 0) {
                    const uidsToFetch = Array.from(userIds);
                    for (let i = 0; i < uidsToFetch.length; i += 30) {
                        const batchUids = uidsToFetch.slice(i, i + 30);
                        if (batchUids.length > 0) {
                            const usersSnapshot = await adminDb.collection('users').where(FieldPath.documentId(), 'in', batchUids).get();
                            usersSnapshot.forEach(doc => {
                                if (!userDocsMap.has(doc.id)) userDocsMap.set(doc.id, doc);
                            });
                        }
                    }
                }
            }
        } else { // Handle name, email, mobile
            if (searchBy === 'name') {
                const usersSnapshot = await adminDb.collection('users')
                    .where('nameLower', '>=', lowerSearchTerm)
                    .where('nameLower', '<=', lowerSearchTerm + '\uf8ff')
                    .limit(20)
                    .get();
                usersSnapshot.forEach(doc => {
                    if (!userDocsMap.has(doc.id)) userDocsMap.set(doc.id, doc);
                });
            } else if (searchBy === 'email') {
                const [byEmailLower, byEmail] = await Promise.all([
                    adminDb.collection('users').where('emailLower', '==', lowerSearchTerm).limit(20).get(),
                    adminDb.collection('users').where('email', '==', lowerSearchTerm).limit(20).get(),
                ]);
                [byEmailLower, byEmail].forEach((snap) => {
                    snap.forEach((doc) => {
                        if (!userDocsMap.has(doc.id)) userDocsMap.set(doc.id, doc);
                    });
                });
            } else {
                // mobile search: normalize and try multiple likely formats
                const mobileDigits = normalizedSearchTerm.replace(/\D/g, '');
                const mobileLast10 = mobileDigits.length >= 10 ? mobileDigits.slice(-10) : mobileDigits;
                const mobileCandidates = Array.from(new Set([
                    normalizedSearchTerm,
                    mobileDigits,
                    mobileLast10,
                    mobileDigits ? `+${mobileDigits}` : '',
                    mobileLast10 ? `+91${mobileLast10}` : '',
                ].filter(Boolean)));

                for (const candidate of mobileCandidates) {
                    const snap = await adminDb.collection('users').where('mobile', '==', candidate).limit(20).get();
                    snap.forEach((doc) => {
                        if (!userDocsMap.has(doc.id)) userDocsMap.set(doc.id, doc);
                    });
                }
            }
        }
        
        userDocs = Array.from(userDocsMap.values());
        
        if (userDocs.length === 0) {
            return { success: true, message: "No users found.", athletes: [] };
        }
        
        const allEventsSnap = await getCachedServerValue('admin:all-events', 60_000, async () => adminDb.collection('events').get());
        const upcomingEventDetails = new Map<string, { eventName: string; eventDate?: string; ticketDefinitions?: any[] }>();
        const today = startOfDay(new Date());

        allEventsSnap.forEach(doc => {
            const event = doc.data();
            const eventDate = event.eventDate ? parseISO(event.eventDate) : null;
            if (eventDate && isAfter(eventDate, today)) {
                upcomingEventDetails.set(doc.id, {
                    eventName: event.eventName,
                    eventDate: event.eventDate,
                    ticketDefinitions: Array.isArray(event.ticketDefinitions) ? event.ticketDefinitions : [],
                });
            }
        });
        
        const athletesWithRacesPromises = userDocs.map(async (userDoc) => {
            const user = { ...userDoc.data(), uid: userDoc.id } as User;

            // Normalize affiliation for legacy users migrated to clubHistory
            if ((!user.clubId || !user.clubName) && Array.isArray(user.clubHistory) && user.clubHistory.length > 0) {
                const activeClub =
                    user.clubHistory.find((entry) => entry?.isActive) ||
                    user.clubHistory.find((entry) => !entry?.leftAt) ||
                    null;
                if (activeClub) {
                    user.clubId = user.clubId || activeClub.clubId;
                    user.clubName = user.clubName || activeClub.clubName;
                }
            }

            const storedVerified = !!user.emailVerified;
            try {
                const authUser: UserRecord = await adminAuth.getUser(user.uid);
                user.emailVerified = authUser.emailVerified;
            } catch (authError) {
                // Fallback for legacy/manual users where UID doesn't exist in Auth
                if (user.email) {
                    try {
                        const authUserByEmail: UserRecord = await adminAuth.getUserByEmail(user.email);
                        user.emailVerified = authUserByEmail.emailVerified;
                    } catch {
                        user.emailVerified = storedVerified;
                    }
                } else {
                    user.emailVerified = storedVerified;
                }
            }
            const races: RaceResult[] = [];
            const normalizedEmail = String(user.email || '').toLowerCase().trim();

            if (normalizedEmail) {
                const raceResultsSnap = await adminDb
                    .collection('raceResults')
                    .where('email', '==', normalizedEmail)
                    .orderBy('raceDate', 'desc')
                    .get();
                races.push(...raceResultsSnap.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => serializeValue({ docId: doc.id, ...doc.data() }) as RaceResult));
            } else if (user.uid) {
                // Fallback for legacy users without email on profile
                const raceResultsByUidSnap = await adminDb
                    .collection('raceResults')
                    .where('athleteUid', '==', user.uid)
                    .orderBy('raceDate', 'desc')
                    .get();
                races.push(...raceResultsByUidSnap.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => serializeValue({ docId: doc.id, ...doc.data() }) as RaceResult));
            }
            
            const upcomingEvents: { eventId: string; eventName: string; eventDate?: string; bookingId?: string; registeredDate?: string; bibNumber?: string; ticketCategory?: string; raceCategory?: string }[] = [];
            
            const participantDocMap = new Map<string, QueryDocumentSnapshot<DocumentData>>();

            if (user.uid) {
                const participantByUidSnap = await adminDb.collectionGroup('participants')
                    .where('athleteUid', '==', user.uid)
                    .where('ticketStatus', 'in', ['Active', 'Confirmed'])
                    .get();
                participantByUidSnap.forEach((doc) => participantDocMap.set(doc.ref.path, doc));
            }

            if (user.email) {
                const participantByEmailSnap = await adminDb.collectionGroup('participants')
                    .where('email', '==', user.email.toLowerCase())
                    .where('ticketStatus', 'in', ['Active', 'Confirmed'])
                    .get();
                participantByEmailSnap.forEach((doc) => participantDocMap.set(doc.ref.path, doc));
            }

            if (participantDocMap.size > 0) {
                let derivedClubId: string | null = user.clubId ? String(user.clubId) : null;
                let derivedClubName: string | null = user.clubName ? String(user.clubName) : null;

                participantDocMap.forEach((doc) => {
                    const eventId = doc.ref.parent.parent?.id;
                    const participantData = doc.data();

                    if (!derivedClubId && participantData?.clubId) {
                        derivedClubId = String(participantData.clubId);
                    }
                    if (!derivedClubName && participantData?.clubName) {
                        derivedClubName = String(participantData.clubName);
                    }

                    if (eventId && upcomingEventDetails.has(eventId)) {
                        const eventDetail = upcomingEventDetails.get(eventId)!;
                        const ticketId = String(participantData.ticketId || '').trim();
                        const ticketDef = ticketId
                            ? (eventDetail.ticketDefinitions || []).find((td: any) => String(td?.id || '').trim() === ticketId)
                            : null;
                        const ticketCategory =
                            participantData.ticketName ||
                            participantData.ticketCategory ||
                            ticketDef?.ticketName ||
                            undefined;
                        const raceCategory =
                            participantData.ageCategory ||
                            participantData.selectedSubCategory ||
                            participantData.raceCategory ||
                            undefined;

                        upcomingEvents.push({
                            eventId: eventId,
                            eventName: eventDetail.eventName,
                            eventDate: eventDetail.eventDate || undefined,
                            bookingId: participantData.bookingId || undefined,
                            registeredDate: participantData.registeredAt || undefined,
                            bibNumber: participantData.bibNumber || undefined,
                            ticketCategory,
                            raceCategory,
                        });
                    }
                });

                if (!user.clubId && derivedClubId) {
                    user.clubId = derivedClubId;
                }
                if (!user.clubName && derivedClubName) {
                    user.clubName = derivedClubName;
                }
            }
            
            (user as any).upcomingEvents = upcomingEvents;
            return serializeValue({ ...user, races });
        });

        const athletesWithRaces = await Promise.all(athletesWithRacesPromises);
        return { success: true, message: `Found ${athletesWithRaces.length} athletes.`, athletes: athletesWithRaces };

    } catch (e: any) {
        console.error(`[${actionName}] Error:`, e);
        return { success: false, message: `Server action '${actionName}' failed: ${e.message}.` };
    }
}

export async function deleteRaceResultsForEventAction(eventId: string): Promise<{ success: boolean; message: string; }> {
  const actionName = 'deleteRaceResultsForEventAction';
  if (!eventId) {
    return { success: false, message: "Event ID is required." };
  }

  try {
    const adminDb = getFirestoreInstance();
    const resultsQuery = adminDb.collection('raceResults').where('eventId', '==', eventId);
    const snapshot = await resultsQuery.get();

    if (snapshot.empty) return { success: true, message: "No race results found." };

    const batch = adminDb.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    revalidatePath('/admin/dashboard');

    return { success: true, message: `Successfully deleted ${snapshot.size} race result(s).` };
  } catch (e: any) {
    return { success: false, message: `Failed to delete race results: ${e.message}` };
  }
}

export async function updateRaceResultByAdminAction(
  docId: string,
  data: AdminRaceResultEditFormInput
): Promise<{ success: boolean; message: string }> {
    const adminDb = getFirestoreInstance();
    const resultRef = adminDb.collection('raceResults').doc(docId);
    await resultRef.update({ ...data, backfilledAt: FieldValue.serverTimestamp() });
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Race result updated successfully.' };
}

export async function removeInactiveUsersAction(): Promise<{ success: boolean; message: string; removedCount?: number }> {
    try {
        const adminDb = getFirestoreInstance();
        const adminAuth = getAuthInstance();
        const firestoreUsersSnapshot = await adminDb.collection('users').get();
        const authUsersResult = await adminAuth.listUsers();
        const authUserIds = new Set(authUsersResult.users.map(u => u.uid));
        
        let removedCount = 0;
        const batch = adminDb.batch();
        firestoreUsersSnapshot.forEach(doc => {
            if (!authUserIds.has(doc.id)) {
                batch.delete(doc.ref);
                removedCount++;
            }
        });

        if (removedCount > 0) {
            await batch.commit();
            revalidatePath('/admin/dashboard');
            return { success: true, message: `Successfully removed ${removedCount} inactive profiles.`, removedCount };
        }
        return { success: true, message: "No inactive profiles found.", removedCount: 0 };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function removeDuplicateUsersAction(): Promise<{ success: boolean; message: string; removedCount?: number }> {
    try {
        const adminDb = getFirestoreInstance();
        const adminAuth = getAuthInstance();
        const usersSnapshot = await adminDb.collection('users').get();
        const emailMap = new Map<string, User[]>();

        usersSnapshot.forEach(doc => {
            const user = { uid: doc.id, ...doc.data() } as User;
            if (user.email) {
                const lowerEmail = user.email.toLowerCase().trim();
                if (!emailMap.has(lowerEmail)) emailMap.set(lowerEmail, []);
                emailMap.get(lowerEmail)!.push(user);
            }
        });

        let removedCount = 0;
        const batch = adminDb.batch();

        for (const [email, users] of Array.from(emailMap.entries())) {
            if (users.length > 1) {
                users.sort((a: User, b: User) => {
                    const getTime = (val: any) => {
                        if (!val) return 0;
                        if (val instanceof Timestamp) return val.toMillis();
                        if (typeof val === 'string') return new Date(val).getTime();
                        return 0;
                    };
                    return getTime(b.createdAt) - getTime(a.createdAt);
                });

                const duplicates = users.slice(1);
                for (const duplicate of duplicates) {
                    batch.delete(adminDb.collection('users').doc(duplicate.uid));
                    adminAuth.deleteUser(duplicate.uid).catch(() => {});
                    removedCount++;
                }
            }
        }

        if (removedCount > 0) {
            await batch.commit();
            revalidatePath('/admin/dashboard');
            return { success: true, message: `Removed ${removedCount} duplicates.`, removedCount };
        }
        return { success: true, message: "No duplicates found.", removedCount: 0 };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function syncLoggedInUsersEmailVerificationAction(): Promise<{
    success: boolean;
    message: string;
    scanned?: number;
    matchedAuth?: number;
    updated?: number;
}> {
    const actionName = 'syncLoggedInUsersEmailVerificationAction';
    try {
        const adminDb = getFirestoreInstance();
        const adminAuth = getAuthInstance();

        let scanned = 0;
        let matchedAuth = 0;
        let updated = 0;

        let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
        const pageSize = 500;

        while (true) {
            let query = adminDb.collection('users').orderBy(FieldPath.documentId()).limit(pageSize);
            if (lastDoc) query = query.startAfter(lastDoc);

            const page = await query.get();
            if (page.empty) break;

            for (const doc of page.docs) {
                scanned++;
                const data = doc.data() as User;
                const email = String(data?.email || '').trim().toLowerCase();
                if (!email) continue;

                try {
                    const authUser = await adminAuth.getUserByEmail(email);
                    matchedAuth++;

                    const patch: Record<string, any> = {};
                    if (data.email !== email) patch.email = email;
                    if ((data.emailVerified ?? null) !== authUser.emailVerified) {
                        patch.emailVerified = authUser.emailVerified;
                    }

                    if (Object.keys(patch).length > 0) {
                        patch.updatedAt = FieldValue.serverTimestamp();
                        await doc.ref.set(patch, { merge: true });
                        updated++;
                    }
                } catch {
                    // No Firebase Auth user for this email yet → skip.
                }
            }

            lastDoc = page.docs[page.docs.length - 1] || null;
            if (page.size < pageSize) break;
        }

        revalidatePath('/admin/dashboard');
        return {
            success: true,
            message: `Sync complete. Scanned ${scanned}, matched ${matchedAuth}, updated ${updated}.`,
            scanned,
            matchedAuth,
            updated,
        };
    } catch (error: any) {
        console.error(`[${actionName}] Error:`, error);
        return {
            success: false,
            message: error?.message || 'Failed to sync verified emails.',
        };
    }
}

export async function exportAllUsersAction(): Promise<{ success: boolean; message: string; fileContent?: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const usersSnapshot = await adminDb.collection('users').get();
    if (usersSnapshot.empty) return { success: true, message: "No users found.", fileContent: '' };
    
    const docs = usersSnapshot.docs;
    const usersData = docs.map(doc => {
        const u = doc.data() as User;
        return {
            'UID': doc.id,
            'Name': u.name || '',
            'Email': u.email || '',
            'Mobile': u.mobile || '',
            'Gender': u.gender || '',
            'DOB': u.dob || '',
            'T-Shirt Size': u.tshirtSize || '',
            'Country': u.country || '',
            'Affiliated Club': u.clubName || '',
            'Is Admin': u.isAdmin ? 'Yes' : 'No',
            'Admin Access Mode': u.isAdmin ? (u.adminAccessMode || 'edit') : 'none',
            'Is Volunteer': u.isVolunteer ? 'Yes' : 'No',
            'Created At': toIsoStringSafe(u.createdAt) || '',
        };
    });
    
    const ws = XLSX.utils.json_to_sheet(usersData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "All Users");
    return { success: true, message: 'Ready.', fileContent: XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function setAdminAccessModeAction(
    actorUid: string,
    targetUid: string,
    mode: 'none' | 'view' | 'edit'
): Promise<{ success: boolean; message: string }> {
    const actionName = 'setAdminAccessModeAction';

    try {
        const db = getFirestoreInstance();
        const normalizedActorUid = String(actorUid || '').trim();
        const normalizedTargetUid = String(targetUid || '').trim();

        if (!normalizedActorUid || !normalizedTargetUid) {
            return { success: false, message: 'Actor and target user are required.' };
        }

        if (!['none', 'view', 'edit'].includes(mode)) {
            return { success: false, message: 'Invalid access mode.' };
        }

        const [actorSnap, targetSnap] = await Promise.all([
            getCachedServerValue(`user-doc:${normalizedActorUid}`, 60_000, async () => db.collection('users').doc(normalizedActorUid).get()),
            getCachedServerValue(`user-doc:${normalizedTargetUid}`, 60_000, async () => db.collection('users').doc(normalizedTargetUid).get()),
        ]);

        if (!actorSnap.exists) {
            return { success: false, message: 'Actor profile not found.' };
        }

        if (!targetSnap.exists) {
            return { success: false, message: 'Target profile not found.' };
        }

        const actor = actorSnap.data() as User;
        const actorMode = String((actor as any)?.adminAccessMode || 'edit').toLowerCase();

        if (!actor?.isAdmin) {
            return { success: false, message: 'Only admins can update admin access.' };
        }

        if (actorMode === 'view') {
            return { success: false, message: 'View-only admin cannot change admin access.' };
        }

        if (normalizedActorUid === normalizedTargetUid && mode === 'none') {
            return { success: false, message: 'You cannot revoke your own admin access.' };
        }

        const target = targetSnap.data() as User;
        const patch: Record<string, any> = {
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (mode === 'none') {
            patch.isAdmin = false;
            patch.adminAccessMode = null;
            if (target?.role === 'admin') {
                patch.role = 'athlete';
            }
        } else {
            patch.isAdmin = true;
            patch.role = 'admin';
            patch.adminAccessMode = mode;
        }

        await db.collection('users').doc(normalizedTargetUid).set(patch, { merge: true });
        await _syncUserToKV(normalizedTargetUid);

        revalidatePath('/admin/dashboard');
        return { success: true, message: `Admin access updated to ${mode}.` };
    } catch (e: any) {
        console.error(`[${actionName}] Error:`, e);
        return { success: false, message: e?.message || 'Failed to update admin access.' };
    }
}
