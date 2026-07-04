// src/app/api/volunteer-stats/food/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get('eventId');
  const actionName = '[API /volunteer-stats/food]';

  if (!eventId) {
    return NextResponse.json({ success: false, message: 'Event ID is required' }, { status: 400 });
  }

  try {
    const adminDb = getFirestoreInstance();
    const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');
    
    // Fetch counts for both breakfast and lunch issued
    const breakfastSnap = await participantsRef.where('breakfastIssued', '==', true).count().get();
    const lunchSnap = await participantsRef.where('lunchIssued', '==', true).count().get();
    const totalParticipantsSnap = await participantsRef.where('ticketStatus', '==', 'Active').count().get();


    const stats = {
      breakfast: breakfastSnap.data().count,
      lunch: lunchSnap.data().count,
      total: totalParticipantsSnap.data().count, // Total participants in the event
    };
    
    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    console.error(`[${actionName}] Error fetching food stats:`, error);
    return NextResponse.json({ success: false, message: 'Internal server error.' }, { status: 500 });
  }
}

