import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = new Set([
  'available',
  'reserved',
  'pending_payment',
  'booked',
  'blocked',
  'cancelled',
  'refunded',
]);

export async function GET(_req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const db = getFirestoreInstance();
    const snap = await db.collection('stalls').where('expoId', '==', expoId).get();
    const stalls = snap.docs
      .map((doc) => ({ id: doc.id, ...(serializeValue(doc.data()) || {}) }))
      .sort((a, b) => String(a?.stallNumber || '').localeCompare(String(b?.stallNumber || ''), undefined, { numeric: true }));

    return NextResponse.json({ success: true, stalls, count: stalls.length });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to load stalls' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const body = await req.json().catch(() => null);
    const stallNumber = String(body?.stallNumber || '').trim();
    if (!stallNumber) return NextResponse.json({ success: false, message: 'stallNumber is required' }, { status: 400 });

    const db = getFirestoreInstance();
    const expoSnap = await db.collection('expo').doc(expoId).get();
    if (!expoSnap.exists) return NextResponse.json({ success: false, message: 'Expo not found' }, { status: 404 });

    const existing = await db
      .collection('stalls')
      .where('expoId', '==', expoId)
      .where('stallNumber', '==', stallNumber)
      .limit(1)
      .get();

    if (!existing.empty) {
      return NextResponse.json(
        { success: false, message: `Stall ${stallNumber} already exists in this expo` },
        { status: 409 },
      );
    }

    const expo = serializeValue(expoSnap.data() || {}) || {};
    const status = String(body?.status || 'available').toLowerCase();

    const docRef = db.collection('stalls').doc();
    await docRef.set(
      {
        expoId,
        eventId: String(expo?.eventId || '').trim() || null,
        stallNumber,
        stallTypeId: String(body?.stallTypeId || '').trim() || null,
        sizeLabel: String(body?.sizeLabel || '').trim() || null,
        price: Number(body?.price || 0),
        currency: String(body?.currency || 'INR').toUpperCase(),
        status: VALID_STATUSES.has(status) ? status : 'available',
        position: {
          x: Number(body?.position?.x || 0),
          y: Number(body?.position?.y || 0),
        },
        width: Number(body?.width || 10),
        height: Number(body?.height || 10),
        rotation: Number(body?.rotation || 0),
        locked: !!body?.locked,
        notes: String(body?.notes || '').trim() || null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const saved = await docRef.get();

    const allStallsSnap = await db.collection('stalls').where('expoId', '==', expoId).get();
    const statuses = allStallsSnap.docs.map((doc) => String(doc.data()?.status || 'available'));
    const totalStalls = statuses.length;
    const availableStalls = statuses.filter((s) => s === 'available').length;
    const reservedStalls = statuses.filter((s) => s === 'reserved').length;
    const bookedStalls = statuses.filter((s) => s === 'booked').length;

    await db.collection('expo').doc(expoId).set(
      {
        metrics: {
          ...(expo?.metrics || {}),
          totalStalls,
          availableStalls,
          reservedStalls,
          bookedStalls,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ success: true, stall: { id: saved.id, ...(serializeValue(saved.data()) || {}) } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to create stall' },
      { status: 500 },
    );
  }
}
