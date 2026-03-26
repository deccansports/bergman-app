// src/app/api/volunteer-stats/check-in/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get('eventId');
  const actionName = '[API /volunteer-stats/check-in]';

  if (!eventId) {
    return NextResponse.json({ success: false, message: 'Event ID is required' }, { status: 400 });
  }

  try {
    const adminDb = getFirestoreInstance();
    const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');
    
    // We count 'Active' participants as the total pool for waiver check-in
    const totalPromise = participantsRef.where('ticketStatus', '==', 'Active').count().get();
    const checkedInPromise = participantsRef.where('checkInStatus', '==', 'CheckedIn').count().get();
    
    const [totalSnap, checkedInSnap] = await Promise.all([totalPromise, checkedInPromise]);

    const totalParticipants = totalSnap.data().count;
    const checkedInCount = checkedInSnap.data().count;

    const stats = {
      totalParticipants,
      checkedInCount,
      remainingCount: totalParticipants - checkedInCount,
    };
    
    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    console.error(`[${actionName}] Error fetching check-in stats:`, error);
    return NextResponse.json({ success: false, message: 'Internal server error.' }, { status: 500 });
  }
}

