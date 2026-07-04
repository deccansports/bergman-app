'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { _syncClubToKV } from './clubActions';
import { Club, User } from '@/lib/types';

export async function syncClubOwnerEmails(): Promise<{
  success: boolean;
  message: string;
  synced?: number;
  errors?: string[];
}> {
  const actionName = 'syncClubOwnerEmails';
  const errors: string[] = [];
  let syncedCount = 0;

  try {
    const adminDb = getFirestoreInstance();
    console.log(`[${actionName}] Starting sync...`);

    // Get all clubs
    const clubsSnap = await adminDb.collection('clubs').get();
    console.log(`[${actionName}] Found ${clubsSnap.docs.length} clubs`);

    // Get all users for lookups
    const usersSnap = await adminDb.collection('users').get();
    const usersByUid = new Map<string, User>();
    const usersByOwnedClubId = new Map<string, User>();

    for (const userDoc of usersSnap.docs) {
      const user = userDoc.data() as User;
      usersByUid.set(userDoc.id, user);
      if (user.ownedClubId) {
        usersByOwnedClubId.set(user.ownedClubId, user);
      }
    }

    console.log(`[${actionName}] Loaded ${usersSnap.docs.length} users`);

    // Process each club
    for (const clubDoc of clubsSnap.docs) {
      try {
        const club = clubDoc.data() as Club;
        const clubId = clubDoc.id;

        // Skip if already has ownerEmail
        if (club.ownerEmail) {
          console.log(`[${actionName}] Club ${clubId} already has ownerEmail: ${club.ownerEmail}`);
          continue;
        }

        // Try to find owner email
        let ownerEmail: string | null = null;

        // Method 1: Look up by ownerUid
        if (club.ownerUid && usersByUid.has(club.ownerUid)) {
          const owner = usersByUid.get(club.ownerUid)!;
          ownerEmail = owner.email || null;
          console.log(`[${actionName}] Found owner by ownerUid ${club.ownerUid}: ${ownerEmail}`);
        }

        // Method 2: Look up by clubId in ownedClubId
        if (!ownerEmail && usersByOwnedClubId.has(clubId)) {
          const owner = usersByOwnedClubId.get(clubId)!;
          ownerEmail = owner.email || null;
          console.log(`[${actionName}] Found owner by ownedClubId: ${ownerEmail}`);
        }

        // Update club if we found an owner email
        if (ownerEmail) {
          console.log(`[${actionName}] Updating club ${clubId} with ownerEmail: ${ownerEmail}`);
          
          await adminDb.collection('clubs').doc(clubId).update({
            ownerEmail: ownerEmail.toLowerCase(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Sync to KV
          await _syncClubToKV(clubId);
          syncedCount++;
          console.log(`[${actionName}] Synced club ${clubId}`);
        } else {
          const msg = `Could not find owner email for club ${clubId} (ownerUid: ${club.ownerUid})`;
          console.warn(`[${actionName}] ${msg}`);
          errors.push(msg);
        }
      } catch (e: any) {
        const msg = `Error syncing club ${clubDoc.id}: ${e.message}`;
        console.error(`[${actionName}] ${msg}`);
        errors.push(msg);
      }
    }

    const message = `Synced ${syncedCount} clubs with owner emails${errors.length > 0 ? `. ${errors.length} errors.` : '.'}`;
    console.log(`[${actionName}] Complete: ${message}`);

    return {
      success: true,
      message,
      synced: syncedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (e: any) {
    const message = `Failed to sync club owner emails: ${e.message}`;
    console.error(`[${actionName}] ${message}`);
    return {
      success: false,
      message,
      errors: [e.message],
    };
  }
}
