import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function toEpochMs(value: any): number {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object') {
    const seconds = Number(value?.seconds);
    const nanoseconds = Number(value?.nanoseconds || 0);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
    }
  }
  return 0;
}

export async function GET(_req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) {
      return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });
    }

    const db = getFirestoreInstance();
    const snap = await db
      .collection('bookings')
      .where('expoId', '==', expoId)
      .limit(500)
      .get();

    const bookings = snap.docs
      .map((doc) => {
        const raw = serializeValue(doc.data() || {}) || {};
        return {
          id: doc.id,
          bookingId: String(raw?.bookingId || doc.id),
          expoId: String(raw?.expoId || ''),
          eventId: String(raw?.eventId || ''),
          stallId: String(raw?.stallId || ''),
          stallNumber: String(raw?.stallNumber || ''),
          companyName: String(raw?.companyName || ''),
          contactPerson: String(raw?.contactPerson || ''),
          email: String(raw?.email || ''),
          phone: String(raw?.phone || ''),
          status: String(raw?.status || 'reserved').toLowerCase(),
          paymentStatus: String(raw?.paymentStatus || 'pending').toLowerCase(),
          reservationExpiresAtMs: Number(raw?.reservationExpiresAtMs || 0),
          paidAt: raw?.paidAt || null,
          createdAt: raw?.createdAt || null,
          updatedAt: raw?.updatedAt || null,
        };
      })
      .sort((a, b) => {
        const aTs = toEpochMs(a.createdAt) || toEpochMs(a.updatedAt) || 0;
        const bTs = toEpochMs(b.createdAt) || toEpochMs(b.updatedAt) || 0;
        return bTs - aTs;
      });

    const successfulBookings = bookings.filter(
      (booking) => booking.status === 'paid' || booking.paymentStatus === 'paid',
    );

    return NextResponse.json({
      success: true,
      expoId,
      bookings,
      successfulBookings,
      count: bookings.length,
      successfulCount: successfulBookings.length,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to load expo bookings' },
      { status: 500 },
    );
  }
}
