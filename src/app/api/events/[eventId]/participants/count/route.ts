import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  try {
    const eventId = params.eventId;
    if (!eventId) {
      return NextResponse.json(
        { success: false, message: 'Event ID required' },
        { status: 400 }
      );
    }

    const db = getFirestoreInstance();
    const snapshot = await db
      .collection('events')
      .doc(eventId)
      .collection('participants')
      .count()
      .get();

    return NextResponse.json({
      success: true,
      count: snapshot.data().count,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to count participants' },
      { status: 500 }
    );
  }
}
