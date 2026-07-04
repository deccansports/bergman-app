import { NextRequest, NextResponse } from 'next/server';
import { _syncClubUpcomingAthletes } from '@/lib/actions/dataSyncActions';

/**
 * ADMIN ENDPOINT: Sync club upcoming athletes to KV
 * Manually trigger club sync to update KV with latest event data
 * 
 * POST /api/admin/sync-club-upcoming?clubId=CLUB_ID
 * 
 * Query params:
 * - clubId: The club ID to sync
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clubId = searchParams.get('clubId');

    if (!clubId) {
      return NextResponse.json(
        { error: 'clubId is required' },
        { status: 400 }
      );
    }

    // Trigger the sync
    await _syncClubUpcomingAthletes(clubId);

    return NextResponse.json(
      {
        success: true,
        message: `Club ${clubId} upcoming athletes synced to KV`,
        clubId
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[sync-club-upcoming] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to sync club upcoming athletes',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
