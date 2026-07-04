'use server';

import { getAuthInstance, getFirestoreInstance } from '../firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { User, ClubHistoryEntry } from '../types';
import { serializeValue } from '../utils';
import { revalidatePath } from 'next/cache';
import { _syncClubUpcomingAthletes, _mirrorParticipantToKV } from './dataSyncActions';
import { getCachedServerValue } from '@/lib/serverCache';

async function _findParticipantDocsForUser(
  adminDb: FirebaseFirestore.Firestore,
  userId: string,
  userEmailRaw?: string | null
): Promise<Map<string, FirebaseFirestore.QueryDocumentSnapshot>> {
  const userEmail = String(userEmailRaw || '').toLowerCase().trim();
  const allDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  try {
    const byUid = await adminDb.collectionGroup('participants').where('athleteUid', '==', userId).get();
    for (const d of byUid.docs) allDocs.set(d.ref.path, d);

    if (userEmail) {
      const byEmail = await adminDb.collectionGroup('participants').where('email', '==', userEmail).get();
      for (const d of byEmail.docs) allDocs.set(d.ref.path, d);
    }
    return allDocs;
  } catch (e: any) {
    const code = String(e?.code || '');
    const msg = String(e?.message || '');
    const shouldFallback = code === '9' || /FAILED_PRECONDITION/i.test(msg);
    if (!shouldFallback) throw e;

    // Missing collectionGroup index: fallback to event-by-event scans.
    const eventsSnap = await adminDb.collection('events').select().get();
    for (const eventDoc of eventsSnap.docs) {
      const participantsRef = adminDb.collection('events').doc(eventDoc.id).collection('participants');
      const byUid = await participantsRef.where('athleteUid', '==', userId).get();
      for (const d of byUid.docs) allDocs.set(d.ref.path, d);

      if (userEmail) {
        const byEmail = await participantsRef.where('email', '==', userEmail).get();
        for (const d of byEmail.docs) allDocs.set(d.ref.path, d);
      }
    }
    return allDocs;
  }
}

/**
 * Change an athlete's club and maintain history
 * - Closes the old club entry (if exists)
 * - Adds a new club entry to history
 * - Updates main clubId, clubName, clubAffiliationDate
 */
export async function changeClubAction(
  userId: string,
  newClubId: string,
  newClubName: string
): Promise<{ success: boolean; message: string; updatedUser?: Partial<User> }> {
  try {
    const adminDb = getFirestoreInstance();
    const userRef = adminDb.collection('users').doc(userId);
    const userSnap = await getCachedServerValue(`user-doc:${userId}`, 60_000, async () => userRef.get());

    if (!userSnap.exists) {
      return { success: false, message: 'User not found' };
    }

    const userData = userSnap.data() as User;
    const now = new Date().toISOString();

    // Get existing club history or create new array
    const currentHistory = (userData.clubHistory || []) as ClubHistoryEntry[];

    // Close the old club (if any is currently active)
    const updatedHistory = currentHistory.map((entry) =>
      entry.isActive
        ? {
            ...entry,
            isActive: false,
            leftAt: now,
          }
        : entry
    );

    // Add new active club
    updatedHistory.push({
      clubId: newClubId,
      clubName: newClubName,
      joinedAt: now,
      leftAt: null,
      isActive: true,
    });

    // Update user document
    const updateData = {
      clubId: newClubId,
      clubName: newClubName,
      clubAffiliationDate: now,
      clubHistory: updatedHistory,
      updatedAt: new Date(),
    };

    await userRef.update(updateData);

    // Back-fill participant documents across all events for this user
    try {
      const allDocs = await _findParticipantDocsForUser(adminDb, userId, userData.email || '');

        const batchUpdate = adminDb.batch();
        let batchCount = 0;
        for (const [, docSnap] of allDocs) {
            batchUpdate.update(docSnap.ref, {
                clubId: newClubId,
                clubName: newClubName,
                athleteUid: userId,
                updatedAt: FieldValue.serverTimestamp(),
            });
            batchCount++;
            if (batchCount === 500) break;
        }
        if (batchCount > 0) {
            await batchUpdate.commit();
            for (const [, docSnap] of allDocs) {
                try {
                    const updatedData = { ...docSnap.data(), id: docSnap.id, clubId: newClubId, clubName: newClubName, athleteUid: userId };
                    await _mirrorParticipantToKV(updatedData as any);
                } catch { /* non-critical */ }
            }
        }
        // Sync upcoming lineup for new club
        await _syncClubUpcomingAthletes(newClubId);
        if (userData.clubId && userData.clubId !== newClubId) {
            await _syncClubUpcomingAthletes(userData.clubId);
        }
    } catch (e) {
        console.warn(`[changeClubAction] Participant back-fill failed for UID ${userId}:`, e);
    }

    revalidatePath('/admin/dashboard');

    return {
      success: true,
      message: 'Club changed successfully',
      updatedUser: {
        ...serializeValue({ ...userData, ...updateData }),
      },
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Initialize club history for a user if they have clubId but no clubHistory
 * Used for migration of existing users
 */
export async function initializeClubHistoryAction(
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const userRef = adminDb.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return { success: false, message: 'User not found' };
    }

    const userData = userSnap.data() as User;

    // Skip if already has history
    if (userData.clubHistory && userData.clubHistory.length > 0) {
      return { success: true, message: 'User already has club history' };
    }

    // Skip if no current club
    if (!userData.clubId) {
      return { success: true, message: 'User has no club affiliation' };
    }

    // Create history entry from current club
    const affiliationDate = userData.clubAffiliationDate || userData.createdAt?.toDate?.().toISOString() || new Date().toISOString();

    const clubHistory: ClubHistoryEntry[] = [
      {
        clubId: userData.clubId,
        clubName: userData.clubName || 'Unknown Club',
        joinedAt: affiliationDate,
        leftAt: null,
        isActive: true,
      },
    ];

    await userRef.update({
      clubHistory,
      updatedAt: new Date(),
    });

    return { success: true, message: 'Club history initialized' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get club history for a specific user
 */
export async function getClubHistoryAction(
  userId: string
): Promise<{ success: boolean; message: string; history?: ClubHistoryEntry[]; currentClub?: Partial<ClubHistoryEntry> }> {
  try {
    const adminDb = getFirestoreInstance();
    const userSnap = await adminDb.collection('users').doc(userId).get();

    if (!userSnap.exists) {
      return { success: false, message: 'User not found' };
    }

    const userData = userSnap.data() as User;
    const history = userData.clubHistory || [];
    const currentClub = history.find((c) => c.isActive);

    return {
      success: true,
      message: 'Club history retrieved',
      history,
      currentClub,
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get all users who need club history migration (have clubId but no clubHistory)
 */
export async function getCandidatesForHistoryMigrationAction(): Promise<{
  success: boolean;
  message: string;
  totalCandidates?: number;
  candidates?: Array<{ uid: string; name: string; clubName: string; clubAffiliationDate: string }>;
}> {
  try {
    const adminDb = getFirestoreInstance();

    // Get all users
    const allUsersSnap = await adminDb.collection('users').get();
    const candidates = [];

    for (const doc of allUsersSnap.docs) {
      const userData = doc.data() as User;

      // Find users with clubId but no/empty clubHistory
      if (userData.clubId && (!userData.clubHistory || userData.clubHistory.length === 0)) {
        candidates.push({
          uid: doc.id,
          name: userData.name || 'Unknown',
          clubName: userData.clubName || 'Unknown Club',
          clubAffiliationDate: userData.clubAffiliationDate || 'Unknown Date',
        });
      }
    }

    return {
      success: true,
      message: `Found ${candidates.length} candidates for migration`,
      totalCandidates: candidates.length,
      candidates,
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Migrate all users to have club history
 * Processes all users with clubId but no clubHistory
 */
export async function migrateClubHistoryForAllUsersAction(): Promise<{
  success: boolean;
  message: string;
  migratedCount?: number;
  failedCount?: number;
  errors?: string[];
}> {
  try {
    const adminDb = getFirestoreInstance();
    let migratedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Get all users
    const allUsersSnap = await adminDb.collection('users').get();

    for (const doc of allUsersSnap.docs) {
      try {
        const userData = doc.data() as User;

        // Skip if already has history or no club
        if (userData.clubHistory && userData.clubHistory.length > 0) {
          continue;
        }
        if (!userData.clubId) {
          continue;
        }

        // Create history entry from current club
        const affiliationDate = userData.clubAffiliationDate || userData.createdAt?.toDate?.().toISOString() || new Date().toISOString();

        const clubHistory: ClubHistoryEntry[] = [
          {
            clubId: userData.clubId,
            clubName: userData.clubName || 'Unknown Club',
            joinedAt: affiliationDate,
            leftAt: null,
            isActive: true,
          },
        ];

        await doc.ref.update({
          clubHistory,
          updatedAt: new Date(),
        });

        migratedCount++;
      } catch (error: any) {
        failedCount++;
        errors.push(`Failed to migrate ${doc.id}: ${error.message}`);
      }
    }

    revalidatePath('/admin/dashboard');

    return {
      success: true,
      message: `Migrated ${migratedCount} users, ${failedCount} failed`,
      migratedCount,
      failedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * BACKFILL: Fix users whose clubId/clubName root fields are null but clubHistory has an active entry.
 * This repairs the migration gap where clubHistory was written but root fields were left null.
 */
export async function backfillClubRootFieldsAction(): Promise<{
  success: boolean;
  message: string;
  fixedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  participantDocsUpdated?: number;
}> {
  const actionName = 'backfillClubRootFieldsAction';
  try {
    const adminDb = getFirestoreInstance();
    const allUsersSnap = await adminDb.collection('users').get();
    let fixedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let participantDocsUpdated = 0;
    const affectedClubIds = new Set<string>();

    for (const doc of allUsersSnap.docs) {
      try {
        const userData = doc.data() as User;
        const history = (userData.clubHistory || []) as ClubHistoryEntry[];
        const activeEntry = history.find((e) => e.isActive);

        // Determine the correct clubId for this user (root field or active history entry)
        const correctClubId = userData.clubId || userData.ownedClubId || activeEntry?.clubId || null;
        const correctClubName = correctClubId
          ? (userData.clubName || userData.ownedClubName || activeEntry?.clubName || null)
          : null;
        const correctAffiliationDate = correctClubId
          ? (userData.clubAffiliationDate || activeEntry?.joinedAt || null)
          : null;

        // Update user root fields if needed
        const needsUserUpdate =
          correctClubId &&
          (userData.clubId !== correctClubId ||
            userData.clubName !== correctClubName ||
            !userData.clubAffiliationDate);

        if (needsUserUpdate) {
          await doc.ref.update({
            clubId: correctClubId,
            clubName: correctClubName,
            clubAffiliationDate: correctAffiliationDate,
            updatedAt: FieldValue.serverTimestamp(),
          });
          fixedCount++;
          if (correctClubId) affectedClubIds.add(correctClubId);
        } else {
          skippedCount++;
        }

        // Always propagate current clubId to all participant docs for this user
        if (correctClubId) {
          try {
            const uid = doc.id;
            const allParticipantDocs = await _findParticipantDocsForUser(adminDb, uid, userData.email || '');

            const batch = adminDb.batch();
            let batchCount = 0;
            for (const [, pDoc] of allParticipantDocs) {
              const pData = pDoc.data() as any;
              if (pData.clubId !== correctClubId || pData.clubName !== correctClubName) {
                batch.update(pDoc.ref, {
                  clubId: correctClubId,
                  clubName: correctClubName,
                  athleteUid: uid,
                  updatedAt: FieldValue.serverTimestamp(),
                });
                batchCount++;
                participantDocsUpdated++;
                if (batchCount === 500) break;
              }
            }
            if (batchCount > 0) {
              await batch.commit();
              for (const [, pDoc] of allParticipantDocs) {
                try {
                  const updated = { ...pDoc.data(), id: pDoc.id, clubId: correctClubId, clubName: correctClubName, athleteUid: uid };
                  await _mirrorParticipantToKV(updated as any);
                } catch { /* non-critical */ }
              }
            }
          } catch (e) {
            console.warn(`[${actionName}] Participant propagation failed for UID ${doc.id}:`, e);
          }
        }
      } catch (e: any) {
        console.error(`[${actionName}] Failed for ${doc.id}:`, e.message);
        failedCount++;
      }
    }

    // Sync upcoming athletes for all affected clubs
    for (const clubId of affectedClubIds) {
      try { await _syncClubUpcomingAthletes(clubId); } catch { /* non-critical */ }
    }

    revalidatePath('/admin/dashboard');

    return {
      success: true,
      message: `User profiles fixed: ${fixedCount}, already correct: ${skippedCount}, failed: ${failedCount}. Participant docs updated: ${participantDocsUpdated}.`,
      fixedCount,
      skippedCount,
      failedCount,
      participantDocsUpdated,
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get club members filtered by active/past status using clubHistory
 */
export async function getClubMembersWithHistoryFilterAction(
  clubId: string,
  filter: 'active' | 'past' = 'active'
): Promise<{
  success: boolean;
  message: string;
  members?: Array<{ uid: string; name: string; email: string; joinedAt?: string; leftAt?: string }>;
  totalCount?: number;
}> {
  try {
    const adminDb = getFirestoreInstance();

    // Get all users
    const allUsersSnap = await adminDb.collection('users').get();
    const members = [];

    for (const doc of allUsersSnap.docs) {
      const userData = doc.data() as User;
      const history = userData.clubHistory || [];

      // Find club entries for this user
      const clubEntries = history.filter((entry) => entry.clubId === clubId);

      if (clubEntries.length === 0) {
        continue;
      }

      if (filter === 'active') {
        // Include only users with active club membership
        const activeEntry = clubEntries.find((entry) => entry.isActive);
        if (activeEntry) {
          members.push({
            uid: doc.id,
            name: userData.name || 'Unknown',
            email: userData.email || 'N/A',
            joinedAt: activeEntry.joinedAt,
            leftAt: activeEntry.leftAt || undefined,
          });
        }
      } else {
        // Include only users with past (inactive) club membership
        const pastEntries = clubEntries.filter((entry) => !entry.isActive);
        if (pastEntries.length > 0) {
          for (const entry of pastEntries) {
            members.push({
              uid: doc.id,
              name: userData.name || 'Unknown',
              email: userData.email || 'N/A',
              joinedAt: entry.joinedAt,
              leftAt: entry.leftAt || undefined,
            });
          }
        }
      }
    }

    return {
      success: true,
      message: `Retrieved ${filter} members`,
      members,
      totalCount: members.length,
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}
