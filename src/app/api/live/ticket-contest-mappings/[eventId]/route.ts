import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

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
    const mappingsSnapshot = await db
      .collection('events')
      .doc(eventId)
      .collection('ticketContestMappings')
      .get();

    const mappings = mappingsSnapshot.docs.map((doc) => ({
      ticketId: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({
      success: true,
      mappings,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to fetch mappings' },
      { status: 500 }
    );
  }
}

export async function PUT(
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

    const body = await req.json();
    const mappings = Array.isArray(body?.mappings) ? body.mappings : [];

    const db = getFirestoreInstance();
    const batch = db.batch();
    const now = new Date().toISOString();

    for (const mapping of mappings) {
      const ticketId = String(mapping?.ticketId || '').trim();
      if (!ticketId) continue;

      const docRef = db
        .collection('events')
        .doc(eventId)
        .collection('ticketContestMappings')
        .doc(ticketId);

      batch.set(
        docRef,
        {
          ticketId,
          ticketName: mapping?.ticketName || null,
          contestUuid: mapping?.contestUuid || null,
          contestName: mapping?.contestName || null,
          provider: 'feibot',
          eventUuid: mapping?.eventUuid || null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();

    return NextResponse.json({
      success: true,
      message: `Saved ${mappings.length} ticket-contest mappings`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to save mappings' },
      { status: 500 }
    );
  }
}
