import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const EMPTY_METRICS = {
  totalStalls: 0,
  availableStalls: 0,
  reservedStalls: 0,
  bookedStalls: 0,
  pendingPayments: 0,
  revenueCollected: 0,
  expectedRevenue: 0,
  exhibitorsCount: 0,
};

export async function GET(req: NextRequest) {
  try {
    const eventId = String(req.nextUrl.searchParams.get('eventId') || '').trim();
    const db = getFirestoreInstance();

    let query: FirebaseFirestore.Query = db.collection('expo');
    if (eventId) query = query.where('eventId', '==', eventId);

    const snap = await query.get();
    const expos = snap.docs
      .map((doc) => ({ id: doc.id, ...(serializeValue(doc.data()) || {}) }))
      .sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));

    const dashboard = expos.reduce(
      (acc, expo: any) => {
        const m = { ...EMPTY_METRICS, ...(expo?.metrics || {}) };
        acc.totalStalls += Number(m.totalStalls || 0);
        acc.availableStalls += Number(m.availableStalls || 0);
        acc.reservedStalls += Number(m.reservedStalls || 0);
        acc.bookedStalls += Number(m.bookedStalls || 0);
        acc.pendingPayments += Number(m.pendingPayments || 0);
        acc.revenueCollected += Number(m.revenueCollected || 0);
        acc.expectedRevenue += Number(m.expectedRevenue || 0);
        acc.exhibitorsCount += Number(m.exhibitorsCount || 0);
        return acc;
      },
      { ...EMPTY_METRICS },
    );

    return NextResponse.json({ success: true, expos, dashboard, count: expos.length });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to load expos' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const eventId = String(body?.eventId || '').trim();
    const expoName = String(body?.expoName || '').trim();

    if (!eventId || !expoName) {
      return NextResponse.json(
        { success: false, message: 'eventId and expoName are required' },
        { status: 400 },
      );
    }

    const db = getFirestoreInstance();
    const docRef = db.collection('expo').doc();

    const payload = {
      eventId,
      expoName,
      venue: String(body?.venue || '').trim() || null,
      hallName: String(body?.hallName || '').trim() || null,
      expoStartDate: String(body?.expoStartDate || '').trim() || null,
      expoEndDate: String(body?.expoEndDate || '').trim() || null,
      bookingOpensAt: String(body?.bookingOpensAt || '').trim() || null,
      bookingClosesAt: String(body?.bookingClosesAt || '').trim() || null,
      currencyMode: String(body?.currencyMode || 'INR').toUpperCase(),
      paymentGateway: String(body?.paymentGateway || '').trim() || null,
      invoiceProvider: String(body?.invoiceProvider || '').trim() || null,
      status: String(body?.status || 'draft').toLowerCase(),
      layout: null,
      metrics: { ...EMPTY_METRICS },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await docRef.set(payload, { merge: true });
    const saved = await docRef.get();

    return NextResponse.json({ success: true, expo: { id: docRef.id, ...(serializeValue(saved.data()) || {}) } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to create expo' },
      { status: 500 },
    );
  }
}
