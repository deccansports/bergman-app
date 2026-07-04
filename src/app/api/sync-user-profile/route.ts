import { syncUserProfileAction } from '@/lib/actions/userProfileSyncAction';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { success: false, message: 'User ID is required' },
        { status: 400 }
      );
    }

    const result = await syncUserProfileAction(userId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API] Error syncing user profile:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to sync user profile' },
      { status: 500 }
    );
  }
}
