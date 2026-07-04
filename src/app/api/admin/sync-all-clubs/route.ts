import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { _syncClubUpcomingAthletes } from '@/lib/actions/dataSyncActions';

export async function POST(req: NextRequest) {
  try {
    const db = getFirestoreInstance();
    
    // Get all clubs
    const clubsSnap = await db.collection('clubs').get();
    
    if (clubsSnap.empty) {
      return NextResponse.json({
        success: true,
        message: 'No clubs found',
        synced: 0,
        total: 0
      });
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    // Sync each club's upcoming athletes
    for (const clubDoc of clubsSnap.docs) {
      const clubId = clubDoc.id;
      const clubData = clubDoc.data();
      const clubName = clubData?.clubName || 'Unknown';

      try {
        await _syncClubUpcomingAthletes(clubId);
        successCount++;
        results.push({
          clubId,
          clubName,
          status: 'success',
          message: `Synced upcoming athletes for ${clubName}`
        });
      } catch (error) {
        errorCount++;
        results.push({
          clubId,
          clubName,
          status: 'error',
          message: `Failed to sync: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${successCount} clubs. ${errorCount} errors.`,
      synced: successCount,
      errors: errorCount,
      total: clubsSnap.size,
      results
    });
  } catch (error) {
    console.error('Error syncing all clubs:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Error syncing clubs: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}
