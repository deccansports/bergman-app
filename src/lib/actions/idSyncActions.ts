'use server';

import { getFirestoreInstance } from '../firebaseAdmin';
import type { EventParticipant, User } from '@/lib/types';

interface IdSyncResult {
  success: boolean;
  message: string;
  syncedCount?: number;
  skippedCount?: number;
  errorCount?: number;
  details?: Array<{
    email: string;
    uid?: string;
    status: 'synced' | 'skipped' | 'error';
    reason?: string;
  }>;
}

/**
 * Sync ID proofs from event participants to user profiles
 * Matches participants to users by email or uid
 * Only updates users who don't have an ID saved yet
 */
export async function syncParticipantIdsToUsersAction(): Promise<IdSyncResult> {
  const actionName = 'syncParticipantIdsToUsersAction';
  const details: IdSyncResult['details'] = [];
  let syncedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  try {
    const adminDb = getFirestoreInstance();

    // Step 1: Get all events and their participants
    console.log(`[${actionName}] Starting ID sync process...`);
    const eventsSnapshot = await adminDb.collection('events').get();
    const allParticipants: Map<string, any> = new Map();

    for (const eventDoc of eventsSnapshot.docs) {
      const participantsSnapshot = await eventDoc.ref.collection('participants').get();
      
      for (const participantDoc of participantsSnapshot.docs) {
        const data = participantDoc.data();
        const participantKey = data.email?.toLowerCase() || data.uid;

        // Store participant with their ID if available
        if (participantKey && data.idProofUrl && data.idProofUrl !== 'na') {
          // Keep the most recent/best available ID for this participant
          if (!allParticipants.has(participantKey) || !allParticipants.get(participantKey)?.idProofUrl) {
            allParticipants.set(participantKey, {
              ...data,
              id: participantDoc.id,
              email: data.email,
              uid: data.uid,
            } as any);
          }
        }
      }
    }

    console.log(`[${actionName}] Found ${allParticipants.size} participants with ID proofs`);

    // Step 2: Match participants to users and sync IDs
    for (const [participantKey, participant] of allParticipants) {
      try {
        const email = participant.email?.toLowerCase();
        const uid = participant.uid;
        let userRef = null;
        let userId = null;

        // Try to find user by UID first (more reliable)
        if (uid) {
          const userDoc = await adminDb.collection('users').doc(uid).get();
          if (userDoc.exists) {
            userRef = userDoc.ref;
            userId = uid;
          }
        }

        // If not found by UID, try by email
        if (!userRef && email) {
          const userQuery = await adminDb
            .collection('users')
            .where('email', '==', email)
            .limit(1)
            .get();

          if (!userQuery.empty) {
            userRef = userQuery.docs[0].ref;
            userId = userQuery.docs[0].id;
          }
        }

        if (!userRef || !userId) {
          skippedCount++;
          details.push({
            email: email || uid || 'unknown',
            uid,
            status: 'skipped',
            reason: 'User not found in database',
          });
          continue;
        }

        // Check if user already has an ID
        const userDoc = await userRef.get();
        const userData = userDoc.data() as User | undefined;
        const userHasId = userData?.idProofUrl && userData.idProofUrl !== 'na';

        if (userHasId) {
          skippedCount++;
          details.push({
            email: email || uid || 'unknown',
            uid: userId,
            status: 'skipped',
            reason: 'User already has ID proof saved',
          });
          continue;
        }

        // Sync the ID to user profile
        await userRef.update({
          idProofUrl: participant.idProofUrl,
          updatedAt: new Date(),
        });

        syncedCount++;
        details.push({
          email: email || 'unknown',
          uid: userId,
          status: 'synced',
        });

        console.log(`[${actionName}] Synced ID for user: ${email || uid}`);
      } catch (err) {
        errorCount++;
        details.push({
          email: participant.email || participant.uid || 'unknown',
          uid: participant.uid,
          status: 'error',
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
        console.error(`[${actionName}] Error syncing ID for ${participant.email || participant.uid}:`, err);
      }
    }

    console.log(`[${actionName}] Sync complete. Synced: ${syncedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);

    return {
      success: true,
      message: `ID sync completed. Synced: ${syncedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`,
      syncedCount,
      skippedCount,
      errorCount,
      details,
    };
  } catch (err) {
    console.error(`[${actionName}] Fatal error:`, err);
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Fatal error during ID sync',
      syncedCount: 0,
      skippedCount: 0,
      errorCount: 1,
    };
  }
}

/**
 * Sync ID for a specific user from their event registrations
 * Useful for syncing a single user after they register
 */
export async function syncUserIdFromParticipantsAction(userId: string, email?: string): Promise<IdSyncResult> {
  const actionName = 'syncUserIdFromParticipantsAction';

  try {
    const adminDb = getFirestoreInstance();

    // Get user to verify they exist
    const userDoc = await adminDb.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return {
        success: false,
        message: 'User not found',
      };
    }

    const userData = userDoc.data() as User | undefined;
    const userEmail = (email || userData?.email)?.toLowerCase();

    // Check if user already has ID
    if (userData?.idProofUrl && userData.idProofUrl !== 'na') {
      return {
        success: true,
        message: 'User already has ID proof saved',
        skippedCount: 1,
      };
    }

    // Find most recent participant record with ID for this user
    let foundId: string | null = null;
    const eventsSnapshot = await adminDb.collection('events').get();

    for (const eventDoc of eventsSnapshot.docs) {
      const participantsSnapshot = await eventDoc.ref
        .collection('participants')
        .where('uid', '==', userId)
        .get();

      for (const participantDoc of participantsSnapshot.docs) {
        const participant = participantDoc.data();
        if (participant.idProofUrl && participant.idProofUrl !== 'na') {
          foundId = participant.idProofUrl;
          break; // Use the first valid ID found
        }
      }

      if (foundId) break;
    }

    // If not found by UID, try by email
    if (!foundId && userEmail) {
      for (const eventDoc of eventsSnapshot.docs) {
        const participantsSnapshot = await eventDoc.ref
          .collection('participants')
          .where('email', '==', userEmail)
          .get();

        for (const participantDoc of participantsSnapshot.docs) {
          const participant = participantDoc.data();
          if (participant.idProofUrl && participant.idProofUrl !== 'na') {
            foundId = participant.idProofUrl;
            break;
          }
        }

        if (foundId) break;
      }
    }

    if (!foundId) {
      return {
        success: true,
        message: 'No ID proof found in participant records',
        skippedCount: 1,
      };
    }

    // Update user with the found ID
    await userDoc.ref.update({
      idProofUrl: foundId,
      updatedAt: new Date(),
    });

    return {
      success: true,
      message: 'ID proof synced to user profile',
      syncedCount: 1,
      details: [
        {
          email: userEmail || 'unknown',
          uid: userId,
          status: 'synced',
        },
      ],
    };
  } catch (err) {
    console.error(`[${actionName}] Error:`, err);
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Error syncing ID',
      errorCount: 1,
    };
  }
}

/**
 * Get sync status: how many users are missing IDs that could be synced
 */
export async function getIdSyncStatusAction(): Promise<{
  success: boolean;
  message: string;
  totalUsers?: number;
  usersWithId?: number;
  usersWithoutId?: number;
  potentialSyncCandidates?: number;
}> {
  const actionName = 'getIdSyncStatusAction';

  try {
    const adminDb = getFirestoreInstance();

    // Count total users and those with IDs
    const usersSnapshot = await adminDb.collection('users').get();
    const totalUsers = usersSnapshot.size;
    let usersWithId = 0;

    const usersWithoutId = usersSnapshot.docs.filter(doc => {
      const userData = doc.data() as User;
      const hasId = userData.idProofUrl && userData.idProofUrl !== 'na';
      if (hasId) usersWithId++;
      return !hasId;
    }).length;

    // Find participants with IDs
    const eventsSnapshot = await adminDb.collection('events').get();
    const participantEmails = new Set<string>();
    const participantUids = new Set<string>();

    for (const eventDoc of eventsSnapshot.docs) {
      const participantsSnapshot = await eventDoc.ref.collection('participants').get();
      
      for (const participantDoc of participantsSnapshot.docs) {
        const data = participantDoc.data();
        if (data.idProofUrl && data.idProofUrl !== 'na') {
          if (data.email) participantEmails.add(data.email.toLowerCase());
          if (data.uid) participantUids.add(data.uid);
        }
      }
    }

    // Count how many could potentially be synced
    let potentialSyncCandidates = 0;
    for (const doc of usersSnapshot.docs) {
      const userData = doc.data() as User;
      if (!userData.idProofUrl || userData.idProofUrl === 'na') {
        const userEmail = userData.email?.toLowerCase();
        if ((userEmail && participantEmails.has(userEmail)) || participantUids.has(doc.id)) {
          potentialSyncCandidates++;
        }
      }
    }

    return {
      success: true,
      message: `ID sync status: ${usersWithId}/${totalUsers} users have IDs, ${potentialSyncCandidates} could be synced`,
      totalUsers,
      usersWithId,
      usersWithoutId,
      potentialSyncCandidates,
    };
  } catch (err) {
    console.error(`[${actionName}] Error:`, err);
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Error getting sync status',
    };
  }
}

/**
 * Sync users from participants - create user if not exists and sync ID
 * Used when participants have registered but don't have user account
 */
export async function syncUsersFromParticipantsAction(): Promise<IdSyncResult> {
  const actionName = 'syncUsersFromParticipantsAction';
  const details: IdSyncResult['details'] = [];
  let syncedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  try {
    const adminDb = getFirestoreInstance();

    console.log(`[${actionName}] Starting user sync from participants...`);

    // Get all users
    const usersSnapshot = await adminDb.collection('users').get();
    const existingUserIds = new Set(usersSnapshot.docs.map((doc) => doc.id));
    const existingUserEmails = new Set(
      usersSnapshot.docs
        .map((doc) => doc.data().email?.toLowerCase())
        .filter(Boolean)
    );

    // Iterate through all events and participants
    const eventsSnapshot = await adminDb.collection('events').get();
    const processedParticipants = new Set<string>();

    for (const eventDoc of eventsSnapshot.docs) {
      const participantsSnapshot = await eventDoc.ref.collection('participants').get();

      for (const participantDoc of participantsSnapshot.docs) {
        const participant = participantDoc.data();
        const participantEmail = participant.email?.toLowerCase();
        const participantUid = participant.uid;

        // Create unique key to avoid processing same participant twice
        const participantKey = participantUid || participantEmail;
        if (!participantKey || processedParticipants.has(participantKey)) {
          continue;
        }
        processedParticipants.add(participantKey);

        // Skip if participant has no email and no uid
        if (!participantEmail && !participantUid) {
          skippedCount++;
          details.push({
            email: 'unknown',
            status: 'skipped',
            reason: 'No email or UID in participant record',
          });
          continue;
        }

        // Check if user already exists
        const userExists =
          (participantUid && existingUserIds.has(participantUid)) ||
          (participantEmail && existingUserEmails.has(participantEmail));

        if (userExists) {
          skippedCount++;
          details.push({
            email: participantEmail || 'unknown',
            status: 'skipped',
            reason: 'User already exists in database',
          });
          continue;
        }

        // Create new user from participant data
        try {
          const newUserId = participantUid || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          const newUserData = {
            id: newUserId,
            uid: newUserId,
            email: participantEmail || '',
            name: participant.name || '',
            mobile: participant.mobile || null,
            clubId: null,
            clubName: null,
            idProofUrl: participant.idProofUrl && participant.idProofUrl !== 'na' ? participant.idProofUrl : null,
            createdAt: new Date(),
            updatedAt: new Date(),
            role: 'athlete' as const,
            isAdmin: false,
            isVolunteer: false,
          };

          await adminDb.collection('users').doc(newUserId).set(newUserData);

          syncedCount++;
          details.push({
            email: participantEmail || 'unknown',
            uid: newUserId,
            status: 'synced',
            reason: 'Created from participant data',
          });

          console.log(`[${actionName}] Created user ${newUserId} from participant ${participantEmail}`);
        } catch (err) {
          errorCount++;
          details.push({
            email: participantEmail || 'unknown',
            status: 'error',
            reason: err instanceof Error ? err.message : 'Unknown error creating user',
          });
          console.error(`[${actionName}] Error creating user for ${participantEmail}:`, err);
        }
      }
    }

    console.log(`[${actionName}] Complete. Created: ${syncedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);

    return {
      success: true,
      message: `User sync completed. Created: ${syncedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`,
      syncedCount,
      skippedCount,
      errorCount,
      details,
    };
  } catch (err) {
    console.error(`[${actionName}] Fatal error:`, err);
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Fatal error during user sync',
      syncedCount: 0,
      skippedCount: 0,
      errorCount: 1,
    };
  }
}
