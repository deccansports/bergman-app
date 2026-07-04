import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { expoId: string; stallTypeId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    const stallTypeId = String(params.stallTypeId || '').trim();
    if (!expoId || !stallTypeId) {
      return NextResponse.json({ success: false, message: 'expoId and stallTypeId are required' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, message: 'Invalid payload' }, { status: 400 });
    }

    const db = getFirestoreInstance();
    const ref = db.collection('stallTypes').doc(stallTypeId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ success: false, message: 'Stall type not found' }, { status: 404 });

    const current = serializeValue(snap.data() || {}) || {};
    if (String(current?.expoId || '') !== expoId) {
      return NextResponse.json({ success: false, message: 'Stall type does not belong to expo' }, { status: 400 });
    }

    const width = Number(body?.width ?? current?.width ?? 0);
    const height = Number(body?.height ?? current?.height ?? 0);

    await ref.set(
      {
        ...body,
        width,
        height,
        area: width > 0 && height > 0 ? width * height : Number(body?.area ?? current?.area ?? 0),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const saved = await ref.get();
    return NextResponse.json({ success: true, stallType: { id: saved.id, ...(serializeValue(saved.data()) || {}) } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to update stall type' },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { expoId: string; stallTypeId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    const stallTypeId = String(params.stallTypeId || '').trim();
    if (!expoId || !stallTypeId) {
      return NextResponse.json({ success: false, message: 'expoId and stallTypeId are required' }, { status: 400 });
    }

    const db = getFirestoreInstance();
    const ref = db.collection('stallTypes').doc(stallTypeId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ success: false, message: 'Stall type not found' }, { status: 404 });

    const current = serializeValue(snap.data() || {}) || {};
    if (String(current?.expoId || '') !== expoId) {
      return NextResponse.json({ success: false, message: 'Stall type does not belong to expo' }, { status: 400 });
    }

    await ref.delete();

    return NextResponse.json({ success: true, deleted: stallTypeId });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to delete stall type' },
      { status: 500 },
    );
  }
}
