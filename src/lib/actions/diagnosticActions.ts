'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export async function getClubDiagnosticData(clubId: string): Promise<{
  success: boolean;
  message: string;
  clubData?: any;
  ownerData?: any;
  allUsersOwnedClubIds?: any;
}> {
  try {
    const adminDb = getFirestoreInstance();
    
    // Get the club
    const clubSnap = await adminDb.collection('clubs').doc(clubId).get();
    if (!clubSnap.exists) {
      return {
        success: false,
        message: `Club ${clubId} not found`,
      };
    }

    const clubData = clubSnap.data();
    console.log(`[Diagnostic] Club data for ${clubId}:`, clubData);

    // Try to get owner by ownerUid
    let ownerData = null;
    if (clubData?.ownerUid) {
      const ownerSnap = await adminDb.collection('users').doc(clubData.ownerUid).get();
      if (ownerSnap.exists) {
        ownerData = ownerSnap.data();
        console.log(`[Diagnostic] Owner data for UID ${clubData.ownerUid}:`, {
          email: ownerData?.email,
          ownedClubId: ownerData?.ownedClubId,
          uid: ownerSnap.id,
        });
      }
    }

    // Check all users who own clubs
    const usersSnap = await adminDb.collection('users').where('ownedClubId', '==', clubId).get();
    const usersOwnedClubIds = usersSnap.docs.map((doc: any) => ({
      uid: doc.id,
      email: doc.data().email,
      ownedClubId: doc.data().ownedClubId,
    }));
    console.log(`[Diagnostic] Users with ownedClubId=${clubId}:`, usersOwnedClubIds);

    return {
      success: true,
      message: 'Diagnostic data retrieved',
      clubData: {
        id: clubId,
        name: clubData?.name,
        ownerUid: clubData?.ownerUid,
        ownerEmail: clubData?.ownerEmail,
        email: clubData?.email,
      },
      ownerData: ownerData ? {
        uid: clubData?.ownerUid,
        email: ownerData.email,
        ownedClubId: ownerData.ownedClubId,
      } : null,
      allUsersOwnedClubIds: usersOwnedClubIds,
    };
  } catch (e: any) {
    return {
      success: false,
      message: e.message,
    };
  }
}
