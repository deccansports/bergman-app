'use server';

import { getFirestoreInstance } from '../firebaseAdmin';
import { putKV } from '../cloudflare/kv';
import { NO_CLUB_SELECTED_VALUE } from '@/lib/constants';
import type { EventParticipant, User } from '@/lib/types';

interface UserDataSyncResult {
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
    itemsSynced?: string[];
  }>;
}

/**
 * Sync user data from event participants to user profiles
 * Includes: ID proofs, GST number, business name, business address, etc.
 * Also updates KV cache with synced data
 */
export async function syncUserDataToUsersAction(): Promise<UserDataSyncResult> {
  const actionName = 'syncUserDataToUsersAction';
  const details: UserDataSyncResult['details'] = [];
  let syncedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  try {
    const adminDb = getFirestoreInstance();

    // Step 1: Get all events and their participants
    console.log(`[${actionName}] Starting comprehensive user data sync...`);
    const eventsSnapshot = await adminDb.collection('events').get();
    const allParticipants: Map<string, any> = new Map();

    for (const eventDoc of eventsSnapshot.docs) {
      const participantsSnapshot = await eventDoc.ref.collection('participants').get();
      
      for (const participantDoc of participantsSnapshot.docs) {
        const data = participantDoc.data();
        const participantKey = data.email?.toLowerCase() || data.uid;

        const normalizedClubId = data.clubId && data.clubId !== NO_CLUB_SELECTED_VALUE ? String(data.clubId).trim() : null;

        // Store participant if they have any syncable data
        if (participantKey && (data.idProofUrl || data.gstin || data.businessName || normalizedClubId)) {
          // Keep the most recent/best available data for this participant
          if (!allParticipants.has(participantKey) || 
              (data.idProofUrl && data.idProofUrl !== 'na') ||
              (data.gstin && !allParticipants.get(participantKey)?.gstin) ||
              (normalizedClubId && !allParticipants.get(participantKey)?.clubId)) {
            allParticipants.set(participantKey, {
              ...data,
              id: participantDoc.id,
              eventId: eventDoc.id,
              email: data.email,
              uid: data.uid,
            } as any);
          }
        }
      }
    }

    console.log(`[${actionName}] Found ${allParticipants.size} participants with syncable data`);

    // Step 2: Match participants to users and sync data
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

        const userDoc = await userRef.get();
        const userData = userDoc.data() as User | undefined;

        // Collect items to sync
        const updateData: Record<string, any> = {};
        const syncedItems: string[] = [];

        // Sync ID proof
        if (participant.idProofUrl && participant.idProofUrl !== 'na') {
          const userHasId = userData?.idProofUrl && userData.idProofUrl !== 'na';
          
          if (!userHasId) {
            updateData.idProofUrl = participant.idProofUrl;
            syncedItems.push('ID Proof');
          }
        }

        // Sync business details (GST, company name, address)
        if (participant.gstin) {
          const userHasGst = userData?.gstin;
          
          if (!userHasGst) {
            updateData.gstin = participant.gstin;
            syncedItems.push('GST Number');
            
            // Also sync business address components
            if (participant.businessName) {
              updateData.businessName = participant.businessName;
              syncedItems.push('Business Name');
            }
            if (participant.address) {
              updateData.businessAddress = participant.address;
              syncedItems.push('Business Address');
            }
            if (participant.city) {
              updateData.businessCity = participant.city;
              syncedItems.push('Business City');
            }
            if (participant.state) {
              updateData.businessState = participant.state;
              syncedItems.push('Business State');
            }
            if (participant.pincode) {
              updateData.businessPincode = participant.pincode;
              syncedItems.push('Business Pincode');
            }
          }
        }

        // Sync club affiliation (do not override club owner profile)
        const participantClubId = participant.clubId && participant.clubId !== NO_CLUB_SELECTED_VALUE
          ? String(participant.clubId).trim()
          : null;
        const participantClubName = participantClubId
          ? (String(participant.clubName || '').trim() || null)
          : null;
        const participantClubAffiliationDate = participantClubId
          ? (String(participant.clubAffiliationDate || '').trim() || null)
          : null;

        if (!userData?.ownedClubId && participantClubId) {
          const existingClubId = userData?.clubId ? String(userData.clubId).trim() : null;
          const existingClubName = userData?.clubName ? String(userData.clubName).trim() : null;

          if (!existingClubId || existingClubId !== participantClubId) {
            updateData.clubId = participantClubId;
            updateData.clubName = participantClubName;
            if (participantClubAffiliationDate) updateData.clubAffiliationDate = participantClubAffiliationDate;
            syncedItems.push('Club Affiliation');
          } else if (participantClubName && (!existingClubName || existingClubName !== participantClubName)) {
            updateData.clubName = participantClubName;
            syncedItems.push('Club Name');
          }
        }

        // If nothing to sync, skip this user
        if (Object.keys(updateData).length === 0) {
          skippedCount++;
          details.push({
            email: email || uid || 'unknown',
            uid: userId,
            status: 'skipped',
            reason: 'User already has all available data',
          });
          continue;
        }

        // Sync data to user profile
        updateData.updatedAt = new Date();
        await userRef.update(updateData);

        // Update KV cache with synced user data
        try {
          const updatedUserDoc = await userRef.get();
          const userData = { ...updatedUserDoc.data(), id: userId } as any;
          
          // Sync to KV patterns that are commonly accessed
          // Pattern 1: User profile data
          await putKV(`user:${userId}`, userData, `${actionName}:kv`);
          
          // Pattern 2: User email index for quick lookup
          if (email) {
            await putKV(`user:email:${email}`, userId, `${actionName}:kv`);
          }
          
          // Pattern 3: ID proof index if synced
          if (updateData.idProofUrl) {
            await putKV(`user:idproof:${userId}`, true, `${actionName}:kv`);
          }
          
          // Pattern 4: GST index if synced
          if (updateData.gstin) {
            await putKV(`user:gst:${updateData.gstin}`, userId, `${actionName}:kv`);
          }
          
          console.log(`[${actionName}] Updated KV cache for user ${userId}`);
        } catch (kvErr) {
          console.warn(`[${actionName}] KV sync failed for user ${userId}:`, kvErr);
          // Don't fail the whole sync if KV fails
        }

        syncedCount++;
        details.push({
          email: email || 'unknown',
          uid: userId,
          status: 'synced',
          itemsSynced: syncedItems,
        });

        console.log(`[${actionName}] Synced ${syncedItems.join(', ')} for user: ${email || uid}`);
      } catch (err) {
        errorCount++;
        details.push({
          email: participant.email || participant.uid || 'unknown',
          uid: participant.uid,
          status: 'error',
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
        console.error(`[${actionName}] Error syncing data for ${participant.email || participant.uid}:`, err);
      }
    }

    console.log(`[${actionName}] Sync complete. Synced: ${syncedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);

    return {
      success: errorCount === 0,
      message: `User Data Sync Complete - Synced: ${syncedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`,
      syncedCount,
      skippedCount,
      errorCount,
      details,
    };
  } catch (error) {
    console.error(`[${actionName}] Fatal error:`, error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error during sync',
      errorCount: 1,
      details: [],
    };
  }
}

/**
 * Sync data for a specific user by UID or email
 */
export async function syncUserDataFromParticipantsAction(
  userId: string,
  email?: string
): Promise<UserDataSyncResult> {
  const actionName = 'syncUserDataFromParticipantsAction';
  const details: UserDataSyncResult['details'] = [];

  try {
    const adminDb = getFirestoreInstance();

    // Get user details
    const userDoc = await adminDb.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return {
        success: false,
        message: 'User not found',
        errorCount: 1,
      };
    }

    const userData = userDoc.data() as User | undefined;
    const userEmail = userData?.email || email;

    if (!userEmail) {
      return {
        success: false,
        message: 'User email not found',
        errorCount: 1,
      };
    }

    // Get all participant records for this user
    const eventsSnapshot = await adminDb.collection('events').get();
    const participantRecords: any[] = [];

    for (const eventDoc of eventsSnapshot.docs) {
      const participantsSnapshot = await eventDoc
        .ref.collection('participants')
        .where('email', '==', userEmail.toLowerCase())
        .get();

      for (const participantDoc of participantsSnapshot.docs) {
        participantRecords.push({
          ...participantDoc.data(),
          eventId: eventDoc.id,
        });
      }
    }

    if (participantRecords.length === 0) {
      return {
        success: true,
        message: 'No participant records found for this user',
        skippedCount: 1,
        details: [
          {
            email: userEmail,
            uid: userId,
            status: 'skipped',
            reason: 'No participant records found',
          },
        ],
      };
    }

    // Collect and sync best available data
    const updateData: Record<string, any> = {};
    const syncedItems: string[] = [];

    const isClubOwner = !!userData?.ownedClubId;

    // Merge data from all participant records (prioritize most recent/complete data)
    for (const participant of participantRecords) {
      if (participant.idProofUrl && participant.idProofUrl !== 'na' && !updateData.idProofUrl) {
        updateData.idProofUrl = participant.idProofUrl;
        syncedItems.push('ID Proof');
      }

      if (participant.gstin && !updateData.gstin) {
        updateData.gstin = participant.gstin;
        syncedItems.push('GST Number');

        if (participant.businessName && !updateData.businessName) {
          updateData.businessName = participant.businessName;
          syncedItems.push('Business Name');
        }
        if (participant.address && !updateData.businessAddress) {
          updateData.businessAddress = participant.address;
          syncedItems.push('Business Address');
        }
        if (participant.city && !updateData.businessCity) {
          updateData.businessCity = participant.city;
          syncedItems.push('Business City');
        }
        if (participant.state && !updateData.businessState) {
          updateData.businessState = participant.state;
          syncedItems.push('Business State');
        }
        if (participant.pincode && !updateData.businessPincode) {
          updateData.businessPincode = participant.pincode;
          syncedItems.push('Business Pincode');
        }
      }

      if (!isClubOwner) {
        const participantClubId = participant.clubId && participant.clubId !== NO_CLUB_SELECTED_VALUE
          ? String(participant.clubId).trim()
          : null;
        const participantClubName = participantClubId
          ? (String(participant.clubName || '').trim() || null)
          : null;
        const participantClubAffiliationDate = participantClubId
          ? (String(participant.clubAffiliationDate || '').trim() || null)
          : null;

        if (participantClubId && !updateData.clubId) {
          updateData.clubId = participantClubId;
          updateData.clubName = participantClubName;
          if (participantClubAffiliationDate) updateData.clubAffiliationDate = participantClubAffiliationDate;
          syncedItems.push('Club Affiliation');
        } else if (!updateData.clubName && participantClubName) {
          updateData.clubName = participantClubName;
          syncedItems.push('Club Name');
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return {
        success: true,
        message: 'User already has all available data',
        skippedCount: 1,
        details: [
          {
            email: userEmail,
            uid: userId,
            status: 'skipped',
            reason: 'User already has all available data',
          },
        ],
      };
    }

    // Update user profile
    updateData.updatedAt = new Date();
    await userDoc.ref.update(updateData);

    // Update KV cache with synced user data
    try {
      const updatedUserDoc = await adminDb.collection('users').doc(userId).get();
      const updatedUserData = { ...updatedUserDoc.data(), id: userId } as any;
      
      // Sync to KV patterns
      await putKV(`user:${userId}`, updatedUserData, `${actionName}:kv`);
      if (userEmail) {
        await putKV(`user:email:${userEmail.toLowerCase()}`, userId, `${actionName}:kv`);
      }
      if (updateData.idProofUrl) {
        await putKV(`user:idproof:${userId}`, true, `${actionName}:kv`);
      }
      if (updateData.gstin) {
        await putKV(`user:gst:${updateData.gstin}`, userId, `${actionName}:kv`);
      }
      
      console.log(`[${actionName}] Updated KV cache for user ${userId}`);
    } catch (kvErr) {
      console.warn(`[${actionName}] KV sync failed for user ${userId}:`, kvErr);
      // Don't fail the whole operation if KV fails
    }

    return {
      success: true,
      message: `Synced ${syncedItems.length} item(s) for user`,
      syncedCount: 1,
      details: [
        {
          email: userEmail,
          uid: userId,
          status: 'synced',
          itemsSynced: syncedItems,
        },
      ],
    };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
      errorCount: 1,
    };
  }
}

/**
 * Get status of how many users could have data synced
 */
export async function getUserDataSyncStatusAction(): Promise<any> {
  const actionName = 'getUserDataSyncStatusAction';

  try {
    const adminDb = getFirestoreInstance();

    const eventsSnapshot = await adminDb.collection('events').get();
    const participantDataMap = new Map<string, any>();
    let usersWithIdProof = 0;
    let usersWithGst = 0;
    let potentialSyncCandidates = 0;

    for (const eventDoc of eventsSnapshot.docs) {
      const participantsSnapshot = await eventDoc.ref.collection('participants').get();

      for (const participantDoc of participantsSnapshot.docs) {
        const data = participantDoc.data();
        const key = data.email?.toLowerCase() || data.uid;

        if (!key) continue;

        if (!participantDataMap.has(key)) {
          participantDataMap.set(key, { hasId: false, hasGst: false, hasClub: false });
        }

        if (data.idProofUrl && data.idProofUrl !== 'na') {
          participantDataMap.get(key)!.hasId = true;
        }
        if (data.gstin) {
          participantDataMap.get(key)!.hasGst = true;
        }
        if (data.clubId && data.clubId !== NO_CLUB_SELECTED_VALUE) {
          participantDataMap.get(key)!.hasClub = true;
        }
      }
    }

    // Count unique users with syncable data
    for (const data of participantDataMap.values()) {
      if (data.hasId) usersWithIdProof++;
      if (data.hasGst) usersWithGst++;
      if (data.hasId || data.hasGst || data.hasClub) potentialSyncCandidates++;
    }

    return {
      totalParticipants: participantDataMap.size,
      usersWithIdProof,
      usersWithGst,
      potentialSyncCandidates,
    };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return {
      totalParticipants: 0,
      usersWithIdProof: 0,
      usersWithGst: 0,
      potentialSyncCandidates: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
