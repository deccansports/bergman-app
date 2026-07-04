import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function normalizeCode(input: string) {
  return String(input || '').trim().toUpperCase();
}

export async function GET(_req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const db = getFirestoreInstance();
    const snap = await db.collection('expoCoupons').where('expoId', '==', expoId).get();
    const coupons = snap.docs
      .map((doc) => ({ id: doc.id, ...(serializeValue(doc.data()) || {}) }))
      .sort((a: any, b: any) => String(a?.code || '').localeCompare(String(b?.code || '')));

    return NextResponse.json({ success: true, coupons, count: coupons.length });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to load expo coupons' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const body = await req.json().catch(() => null);
    const code = normalizeCode(body?.code);
    const discountType = String(body?.discountType || 'percentage').toLowerCase();
    const discountValue = Number(body?.discountValue || 0);
    const usageLimit = Number(body?.usageLimit || 1);

    if (!code) return NextResponse.json({ success: false, message: 'Coupon code is required' }, { status: 400 });
    if (!['percentage', 'fixed'].includes(discountType)) {
      return NextResponse.json({ success: false, message: 'discountType must be percentage or fixed' }, { status: 400 });
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      return NextResponse.json({ success: false, message: 'discountValue must be greater than 0' }, { status: 400 });
    }

    const db = getFirestoreInstance();
    const expoSnap = await db.collection('expo').doc(expoId).get();
    if (!expoSnap.exists) return NextResponse.json({ success: false, message: 'Expo not found' }, { status: 404 });

    const ref = db.collection('expoCoupons').doc();
    const payload = {
      expoId,
      code,
      discountType,
      discountValue,
      usageLimit: Number.isFinite(usageLimit) ? usageLimit : 1,
      usageCount: 0,
      isActive: body?.isActive !== false,
      startDate: String(body?.startDate || '').trim() || null,
      expiryDate: String(body?.expiryDate || '').trim() || null,
      minCartValue: body?.minCartValue === '' || body?.minCartValue == null ? null : Number(body?.minCartValue),
      applicableEventIds: Array.isArray(body?.applicableEventIds) ? body.applicableEventIds : [String(expoSnap.data()?.eventId || '').trim()].filter(Boolean),
      stallIds: Array.isArray(body?.stallIds) ? body.stallIds : [],
      stallTypeIds: Array.isArray(body?.stallTypeIds) ? body.stallTypeIds : [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await ref.set(payload, { merge: true });
    const saved = await ref.get();

    return NextResponse.json({ success: true, coupon: { id: saved.id, ...(serializeValue(saved.data() || {}) || {}) } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to create coupon' },
      { status: 500 },
    );
  }
}
