// src/app/api/admin/sync-user-data/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { 
  syncUserDataToUsersAction, 
  getUserDataSyncStatusAction,
  syncUserDataFromParticipantsAction 
} from '@/lib/actions/userDataSyncActions';

/**
 * POST: Trigger full sync of user data (ID proofs, GST, business details) from all participants
 * GET: Get status of how many users have syncable data
 */

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const status = searchParams.get('status');

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
      return NextResponse.json({ error: 'Firebase not configured' }, { status: 503 });
    }

    if (status === 'true') {
      const statusResult = await getUserDataSyncStatusAction();
      return NextResponse.json(statusResult);
    }

    return NextResponse.json({ 
      message: 'Use ?status=true to get sync status, or POST to trigger sync' 
    });
  } catch (error) {
    console.error('[API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error getting sync status' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
      return NextResponse.json({ error: 'Firebase not configured' }, { status: 503 });
    }

    const body = await req.json();
    const action = body.action || 'sync-all';

    if (action === 'sync-all') {
      // Sync all user data from participants to user profiles
      const result = await syncUserDataToUsersAction();
      return NextResponse.json(result);
    } else if (action === 'sync-user') {
      // Sync data for a specific user
      const { userId, email } = body;
      if (!userId) {
        return NextResponse.json(
          { error: 'userId is required' },
          { status: 400 }
        );
      }
      const result = await syncUserDataFromParticipantsAction(userId, email);
      return NextResponse.json(result);
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use "sync-all" or "sync-user"' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error syncing user data' },
      { status: 500 }
    );
  }
}
