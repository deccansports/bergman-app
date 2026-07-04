import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const body = await req.json().catch(() => null);
    const stallId = String(body?.stallId || '').trim();
    const reservationToken = String(body?.reservationToken || '').trim();

    if (!stallId || !reservationToken) {
      return NextResponse.json(
        { success: false, message: 'stallId and reservationToken are required' },
        { status: 400 },
      );
    }

    const db = getFirestoreInstance();
    const stallRef = db.collection('stalls').doc(stallId);

    await db.runTransaction(async (tx) => {
      const stallSnap = await tx.get(stallRef);
      if (!stallSnap.exists) throw new Error('Stall not found');

      const stall = serializeValue(stallSnap.data() || {}) || {};
      if (String(stall?.expoId || '') !== expoId) throw new Error('Stall does not belong to expo');

      const token = String(stall?.reservation?.token || '');
      if (!token || token !== reservationToken) throw new Error('Reservation token mismatch');

      const status = String(stall?.status || '').toLowerCase();
      if (status === 'booked') throw new Error('Booked stalls cannot be released');

      tx.set(
        stallRef,
        {
          status: 'available',
          reservation: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    return NextResponse.json({ success: true, message: 'Reservation released' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to release reservation';
    const status = message.includes('not found') ? 404 : message.includes('mismatch') ? 409 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
