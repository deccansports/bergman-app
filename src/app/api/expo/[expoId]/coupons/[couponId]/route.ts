import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function normalizeCode(input: string) {
  return String(input || '').trim().toUpperCase();
}

export async function PATCH(req: NextRequest, { params }: { params: { expoId: string; couponId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    const couponId = String(params.couponId || '').trim();
    if (!expoId || !couponId) return NextResponse.json({ success: false, message: 'expoId and couponId are required' }, { status: 400 });

    const body = await req.json().catch(() => null);
    const db = getFirestoreInstance();
    const ref = db.collection('expoCoupons').doc(couponId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ success: false, message: 'Coupon not found' }, { status: 404 });
    const current = serializeValue(snap.data() || {}) || {};
    if (String(current?.expoId || '') !== expoId) {
      return NextResponse.json({ success: false, message: 'Coupon does not belong to expo' }, { status: 409 });
    }

    const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
    if (body?.code != null) updates.code = normalizeCode(body.code);
    if (body?.discountType != null) updates.discountType = String(body.discountType).toLowerCase();
    if (body?.discountValue != null) updates.discountValue = Number(body.discountValue || 0);
    if (body?.usageLimit != null) updates.usageLimit = Number(body.usageLimit || 0);
    if (body?.isActive != null) updates.isActive = !!body.isActive;
    if (body?.startDate !== undefined) updates.startDate = String(body.startDate || '').trim() || null;
    if (body?.expiryDate !== undefined) updates.expiryDate = String(body.expiryDate || '').trim() || null;
    if (body?.minCartValue !== undefined) updates.minCartValue = body.minCartValue === '' || body.minCartValue == null ? null : Number(body.minCartValue);
    if (Array.isArray(body?.applicableEventIds)) updates.applicableEventIds = body.applicableEventIds;
    if (Array.isArray(body?.stallIds)) updates.stallIds = body.stallIds;
    if (Array.isArray(body?.stallTypeIds)) updates.stallTypeIds = body.stallTypeIds;

    await ref.set(updates, { merge: true });
    const saved = await ref.get();
    return NextResponse.json({ success: true, coupon: { id: saved.id, ...(serializeValue(saved.data() || {}) || {}) } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to update coupon' },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { expoId: string; couponId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    const couponId = String(params.couponId || '').trim();
    if (!expoId || !couponId) return NextResponse.json({ success: false, message: 'expoId and couponId are required' }, { status: 400 });

    const db = getFirestoreInstance();
    const ref = db.collection('expoCoupons').doc(couponId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ success: false, message: 'Coupon not found' }, { status: 404 });
    const current = serializeValue(snap.data() || {}) || {};
    if (String(current?.expoId || '') !== expoId) {
      return NextResponse.json({ success: false, message: 'Coupon does not belong to expo' }, { status: 409 });
    }

    await ref.delete();
    return NextResponse.json({ success: true, deleted: couponId });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to delete coupon' },
      { status: 500 },
    );
  }
}
