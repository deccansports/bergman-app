import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST() {
  const db = getFirestoreInstance();
  const eventsSnap = await db.collection('events').get();

  let eventCount = 0;
  let migratedDocs = 0;
  let deletedDocs = 0;

  for (const eventDoc of eventsSnap.docs) {
    const eventId = eventDoc.id;
    const registrationsRef = db.collection('events').doc(eventId).collection('registrations');
    const participantsRef = db.collection('events').doc(eventId).collection('participants');
    const registrationsSnap = await registrationsRef.get();
    if (registrationsSnap.empty) continue;

    eventCount += 1;

    for (let i = 0; i < registrationsSnap.docs.length; i += 300) {
      const batch = db.batch();
      for (const regDoc of registrationsSnap.docs.slice(i, i + 300)) {
        const participantRef = participantsRef.doc(regDoc.id);
        const participantSnap = await participantRef.get();

        if (!participantSnap.exists) {
          batch.set(participantRef, {
            ...regDoc.data(),
            migratedFromLegacyRegistrations: true,
            migratedAt: new Date().toISOString(),
          }, { merge: true });
          migratedDocs += 1;
        }

        batch.delete(regDoc.ref);
        deletedDocs += 1;
      }
      await batch.commit();
    }
  }

  return NextResponse.json({
    success: true,
    message: 'Legacy event registrations migrated to participants and cleaned up.',
    eventCount,
    migratedDocs,
    deletedDocs,
  });
}
