import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const db = getFirestoreInstance();
    const snap = await db.collection('stallTypes').where('expoId', '==', expoId).get();
    const stallTypes = snap.docs
      .map((doc) => ({ id: doc.id, ...(serializeValue(doc.data()) || {}) }))
      .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));

    return NextResponse.json({ success: true, stallTypes, count: stallTypes.length });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to load stall types' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const body = await req.json().catch(() => null);
    const name = String(body?.name || '').trim();
    if (!name) return NextResponse.json({ success: false, message: 'name is required' }, { status: 400 });

    const db = getFirestoreInstance();
    const expoSnap = await db.collection('expo').doc(expoId).get();
    if (!expoSnap.exists) return NextResponse.json({ success: false, message: 'Expo not found' }, { status: 404 });

    const expo = serializeValue(expoSnap.data() || {}) || {};
    const docRef = db.collection('stallTypes').doc();

    const width = Number(body?.width || 0);
    const height = Number(body?.height || 0);
    const area = width > 0 && height > 0 ? width * height : Number(body?.area || 0);

    await docRef.set(
      {
        expoId,
        eventId: String(expo?.eventId || '').trim() || null,
        name,
        width,
        height,
        area,
        currency: String(body?.currency || 'INR').toUpperCase(),
        price: Number(body?.price || 0),
        electricityIncluded: !!body?.electricityIncluded,
        furnitureIncluded: !!body?.furnitureIncluded,
        internetIncluded: !!body?.internetIncluded,
        description: String(body?.description || '').trim() || null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const saved = await docRef.get();
    return NextResponse.json({ success: true, stallType: { id: saved.id, ...(serializeValue(saved.data()) || {}) } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to create stall type' },
      { status: 500 },
    );
  }
}
