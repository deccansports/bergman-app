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
    const snap = await db.collection('expo').doc(expoId).get();
    if (!snap.exists) return NextResponse.json({ success: false, message: 'Expo not found' }, { status: 404 });

    return NextResponse.json({ success: true, expo: { id: snap.id, ...(serializeValue(snap.data()) || {}) } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to load expo' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, message: 'Invalid payload' }, { status: 400 });
    }

    const db = getFirestoreInstance();
    const ref = db.collection('expo').doc(expoId);
    const exists = await ref.get();
    if (!exists.exists) return NextResponse.json({ success: false, message: 'Expo not found' }, { status: 404 });

    await ref.set({ ...body, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const saved = await ref.get();

    return NextResponse.json({ success: true, expo: { id: saved.id, ...(serializeValue(saved.data()) || {}) } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to update expo' },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const db = getFirestoreInstance();
    await db.collection('expo').doc(expoId).delete();

    return NextResponse.json({ success: true, deleted: expoId });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to delete expo' },
      { status: 500 },
    );
  }
}
