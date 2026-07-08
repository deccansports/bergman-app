import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST() {
  const db = getFirestoreInstance();
  const eventsSnap = await db.collection('events').get();

  let eventCount = 0;
  let deletedDocs = 0;
  const purgedEvents: string[] = [];

  for (const eventDoc of eventsSnap.docs) {
    const eventId = eventDoc.id;
    const legacySnap = await db.collection('events').doc(eventId).collection('athleteMasterIndex').get();
    if (legacySnap.empty) continue;

    eventCount += 1;
    purgedEvents.push(eventId);

    for (let i = 0; i < legacySnap.docs.length; i += 400) {
      const batch = db.batch();
      const chunk = legacySnap.docs.slice(i, i + 400);
      for (const doc of chunk) {
        batch.delete(doc.ref);
        deletedDocs += 1;
      }
      await batch.commit();
    }
  }

  return NextResponse.json({
    success: true,
    message: 'Legacy athlete master index cleanup complete.',
    eventCount,
    deletedDocs,
    purgedEvents,
  });
}
