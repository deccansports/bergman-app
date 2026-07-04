'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

interface MergeResult {
  success: boolean;
  primaryClubId: string;
  mergedClubIds: string[];
  membersMoved: number;
  upcomingMoved: number;
  message: string;
}

/**
 * Merge duplicate clubs into a primary club
 * @param primaryClubId - The club ID to keep
 * @param duplicateClubIds - Array of club IDs to merge into primary
 */
export async function mergeDuplicateClubs(
  primaryClubId: string,
  duplicateClubIds: string[]
): Promise<MergeResult> {
  const actionName = 'mergeDuplicateClubs';
  let membersMoved = 0;
  let upcomingMoved = 0;

  try {
    const adminDb = getFirestoreInstance();
    const batch = adminDb.batch();

    console.log(
      `[${actionName}] Starting merge: ${duplicateClubIds.length} duplicate clubs into ${primaryClubId}`
    );

    // Process each duplicate club
    for (const duplicateId of duplicateClubIds) {
      console.log(`[${actionName}] Processing duplicate: ${duplicateId}`);

      // Get the duplicate club data
      const duplicateSnap = await adminDb
        .collection('clubs')
        .doc(duplicateId)
        .get();
      if (!duplicateSnap.exists) {
        console.warn(`[${actionName}] Duplicate club ${duplicateId} not found`);
        continue;
      }

      // Get all members of the duplicate club
      const membersSnap = await adminDb
        .collection('clubs')
        .doc(duplicateId)
        .collection('members')
        .get();

      // Move members to primary club
      for (const memberDoc of membersSnap.docs) {
        const memberData = memberDoc.data();
        batch.set(
          adminDb
            .collection('clubs')
            .doc(primaryClubId)
            .collection('members')
            .doc(memberDoc.id),
          memberData,
          { merge: true }
        );
        membersMoved++;
      }

      // Get all upcoming events of the duplicate club
      const upcomingSnap = await adminDb
        .collection('clubs')
        .doc(duplicateId)
        .collection('upcoming')
        .get();

      // Move upcoming events to primary club
      for (const upcomingDoc of upcomingSnap.docs) {
        const upcomingData = upcomingDoc.data();
        batch.set(
          adminDb
            .collection('clubs')
            .doc(primaryClubId)
            .collection('upcoming')
            .doc(upcomingDoc.id),
          upcomingData,
          { merge: true }
        );
        upcomingMoved++;
      }

      // Delete the duplicate club
      batch.delete(adminDb.collection('clubs').doc(duplicateId));
      console.log(
        `[${actionName}] Deleted duplicate club ${duplicateId}`
      );
    }

    // Mark primary club as updated
    batch.update(adminDb.collection('clubs').doc(primaryClubId), {
      updatedAt: FieldValue.serverTimestamp(),
      _mergedDuplicates: duplicateClubIds,
      _mergedAt: FieldValue.serverTimestamp(),
    });

    // Commit batch
    await batch.commit();
    console.log(`[${actionName}] Batch commit successful`);

    const message = `Successfully merged ${duplicateClubIds.length} duplicate clubs. Moved ${membersMoved} members and ${upcomingMoved} upcoming events to primary club.`;
    console.log(`[${actionName}] ${message}`);

    return {
      success: true,
      primaryClubId,
      mergedClubIds: duplicateClubIds,
      membersMoved,
      upcomingMoved,
      message,
    };
  } catch (error: any) {
    const errorMsg = `Failed to merge clubs: ${error.message}`;
    console.error(`[${actionName}] ${errorMsg}`);
    return {
      success: false,
      primaryClubId,
      mergedClubIds: duplicateClubIds,
      membersMoved,
      upcomingMoved,
      message: errorMsg,
    };
  }
}

/**
 * Merge a specific set of known duplicates
 * Usage: Call this to merge the Trifitzone and TRIBLR duplicates
 */
export async function mergeKnownDuplicates(): Promise<MergeResult[]> {
  const results: MergeResult[] = [];

  // Merge Trifit zone (12V54wmUeawY1UYrfTDW) into Trifitzone (AgeC53KUjCCUxZW6IYHK)
  console.log('[mergeKnownDuplicates] Merging Trifit zone into Trifitzone...');
  const trifitzoneResult = await mergeDuplicateClubs(
    'AgeC53KUjCCUxZW6IYHK',
    ['12V54wmUeawY1UYrfTDW']
  );
  results.push(trifitzoneResult);

  // Merge TRIBLR (afu8lsZ3RM5s36NpTV1p) into TRIBLR (KtwokOGkZJ54s21PtSpV)
  console.log('[mergeKnownDuplicates] Merging duplicate TRIBLR...');
  const triblrResult = await mergeDuplicateClubs('KtwokOGkZJ54s21PtSpV', [
    'afu8lsZ3RM5s36NpTV1p',
  ]);
  results.push(triblrResult);

  return results;
}
