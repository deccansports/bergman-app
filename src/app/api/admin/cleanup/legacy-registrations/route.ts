import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST() {
  const db = getFirestoreInstance();
  const registrationsSnap = await db.collection('registrations').get();

  let deletedDocs = 0;
  for (let i = 0; i < registrationsSnap.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of registrationsSnap.docs.slice(i, i + 400)) {
      batch.delete(doc.ref);
      deletedDocs += 1;
    }
    await batch.commit();
  }

  return NextResponse.json({
    success: true,
    message: 'Legacy registrations collection cleaned up.',
    deletedDocs,
  });
}
