// src/app/api/volunteer-stats/bike/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get('eventId');
  const actionName = '[API /volunteer-stats/bike]';

  if (!eventId) {
    return NextResponse.json({ success: false, message: 'Event ID is required' }, { status: 400 });
  }

  try {
    const adminDb = getFirestoreInstance();
    const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');
    
    // We only count participants who have completed waiver check-in as "total" for bike check-in purposes
    const totalQuery = participantsRef.where('checkInStatus', '==', 'CheckedIn').count().get();
    const checkedInQuery = participantsRef.where('bikeCheckInStatus', '==', 'CheckedIn').count().get();
    const checkedOutQuery = participantsRef.where('bikeCheckOutStatus', '==', 'CheckedOut').count().get();

    const [totalSnap, checkedInSnap, checkedOutSnap] = await Promise.all([
        totalQuery,
        checkedInQuery,
        checkedOutQuery
    ]);

    const totalParticipants = totalSnap.data().count;
    const checkedInCount = checkedInSnap.data().count;
    const checkedOutCount = checkedOutSnap.data().count;

    const stats = {
      totalParticipants, // Total eligible for bike check-in
      checkedInCount,
      checkedOutCount,
      remainingCount: checkedInCount - checkedOutCount, // Bikes remaining in transition
    };
    
    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    console.error(`[${actionName}] Error fetching bike stats:`, error);
    return NextResponse.json({ success: false, message: 'Internal server error.' }, { status: 500 });
  }
}

