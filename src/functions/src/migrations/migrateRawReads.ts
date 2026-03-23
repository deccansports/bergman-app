// functions/src/migrations/migrateRawReads.ts
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

export async function migrateRawReads(eventId: string) {
  const db = getFirestore();

  const oldPath = db
    .collection('events')
    .doc(eventId)
    .collection('rawReads');

  const newPath = db
    .collection('rawReads')
    .doc(eventId)
    .collection('reads');

  const snap = await oldPath.get();

  if (snap.empty) {
    logger.info(`[MIGRATION] No rawReads found for event ${eventId} in old path.`);
    return;
  }

  const batch = db.batch();
  let migrated = 0;

  snap.docs.forEach(doc => {
    const data = doc.data();

    // ✅ HARD GUARD (do not migrate junk)
    if (!data.bib && !data.bibNumber) {
        logger.warn(`[MIGRATION] Skipping doc ${doc.id}, no bib found.`);
        return;
    }

    const readId = doc.id;
    const targetRef = newPath.doc(readId);

    batch.set(
      targetRef,
      {
        ...data,
        eventId, // Ensure eventId is part of the new document
        migratedAt: new Date().toISOString(),
        migratedFrom: 'events/{eventId}/rawReads'
      },
      { merge: true } // Use merge to be safe
    );

    migrated++;
  });

  if (migrated > 0) {
    await batch.commit();
  }

  logger.info(`[MIGRATION] Migrated ${migrated} rawReads for ${eventId}.`);
}
