
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
): Promise<{ success: boolean; message: string; athletes?: Array<User & { races?: RaceResult[]; upcomingEvents?: { eventId: string; eventName: string; bookingId?: string; registeredDate?: string }[] }> }> {
    const actionName = 'searchAthletesForAdminAction';
    if (!searchTerm || typeof searchTerm !== 'string') {
        return { success: false, message: "A valid search term is required." };
    }
    try {
        const adminDb = getFirestoreInstance();
        const adminAuth = getAuthInstance();
        const lowerSearchTerm = searchTerm.toLowerCase();

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
            let userQuery;
            if (searchBy === 'name') {
                userQuery = adminDb.collection('users')
                    .where('nameLower', '>=', lowerSearchTerm)
                    .where('nameLower', '<=', lowerSearchTerm + '\uf8ff');
            } else { // email or mobile
                userQuery = adminDb.collection('users').where(searchBy, '==', searchTerm);
            }
            const usersSnapshot = await userQuery.limit(20).get();
            usersSnapshot.forEach(doc => {
                if (!userDocsMap.has(doc.id)) userDocsMap.set(doc.id, doc);
            });
        }
        
        userDocs = Array.from(userDocsMap.values());
        
        if (userDocs.length === 0) {
            return { success: true, message: "No users found.", athletes: [] };
        }
        
        const allEventsSnap = await adminDb.collection('events').get();
        const upcomingEventDetails = new Map<string, { eventName: string }>();
        const today = startOfDay(new Date());

        allEventsSnap.forEach(doc => {
            const event = doc.data();
            const eventDate = event.eventDate ? parseISO(event.eventDate) : null;
            if (eventDate && isAfter(eventDate, today)) {
                upcomingEventDetails.set(doc.id, { eventName: event.eventName });
            }
        });
        
        const athletesWithRacesPromises = userDocs.map(async (userDoc) => {
            const user = { ...userDoc.data(), uid: userDoc.id } as User;
            try {
                const authUser: UserRecord = await adminAuth.getUser(user.uid);
                user.emailVerified = authUser.emailVerified;
            } catch (authError) {
                user.emailVerified = false;
            }
            const raceResultsSnap = await adminDb.collection('raceResults').where('email', '==', user.email?.toLowerCase()).orderBy('raceDate', 'desc').get();
            const races = raceResultsSnap.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => serializeValue({ docId: doc.id, ...doc.data() }) as RaceResult);
            
            const upcomingEvents: { eventId: string; eventName: string; bookingId?: string; registeredDate?: string }[] = [];
            
            if (user.email) {
                const participantRecordsSnap = await adminDb.collectionGroup('participants')
                    .where('email', '==', user.email.toLowerCase())
                    .where('ticketStatus', 'in', ['Active', 'Confirmed'])
                    .get();

                if (!participantRecordsSnap.empty) {
                    participantRecordsSnap.forEach(doc => {
                        const eventId = doc.ref.parent.parent?.id; 
                        const participantData = doc.data();
                        if (eventId && upcomingEventDetails.has(eventId)) {
                            upcomingEvents.push({
                                eventId: eventId,
                                eventName: upcomingEventDetails.get(eventId)!.eventName,
                                bookingId: participantData.bookingId || undefined,
                                registeredDate: participantData.registeredAt || undefined,
                            });
                        }
                    });
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
