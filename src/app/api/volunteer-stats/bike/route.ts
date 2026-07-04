// src/app/api/volunteer-stats/bike/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

    // Read once and derive counts in-memory so historical/past-event data remains visible
    // even if check-in status fields were modified after race day.
    const snapshot = await participantsRef.get();

    let totalParticipants = 0;
    let checkedInCount = 0;
    let checkedOutCount = 0;

    snapshot.docs.forEach((doc) => {
      const p = doc.data() as any;
      const checkInStatus = p?.checkInStatus;
      const bikeCheckInStatus = p?.bikeCheckInStatus;
      const bikeCheckOutStatus = p?.bikeCheckOutStatus;

      if (
        checkInStatus === 'CheckedIn' ||
        bikeCheckInStatus === 'CheckedIn' ||
        bikeCheckOutStatus === 'CheckedOut'
      ) {
        totalParticipants += 1;
      }

      if (bikeCheckInStatus === 'CheckedIn') checkedInCount += 1;
      if (bikeCheckOutStatus === 'CheckedOut') checkedOutCount += 1;
    });

    const stats = {
      totalParticipants, // Total eligible for bike check-in
      checkedInCount,
      checkedOutCount,
      remainingCount: Math.max(checkedInCount - checkedOutCount, 0), // Bikes remaining in transition
    };
    
    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    console.error(`[${actionName}] Error fetching bike stats:`, error);
    return NextResponse.json({ success: false, message: 'Internal server error.' }, { status: 500 });
  }
}

