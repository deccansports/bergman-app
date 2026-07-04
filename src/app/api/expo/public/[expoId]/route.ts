import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const RESERVATION_TTL_MS = 5 * 60 * 1000;

export async function GET(_req: NextRequest, { params }: { params: { expoId: string } }) {
  try {
    const expoId = String(params.expoId || '').trim();
    if (!expoId) return NextResponse.json({ success: false, message: 'expoId is required' }, { status: 400 });

    const db = getFirestoreInstance();
    const expoRef = db.collection('expo').doc(expoId);
    const expoSnap = await expoRef.get();
    if (!expoSnap.exists) return NextResponse.json({ success: false, message: 'Expo not found' }, { status: 404 });

    const expo = serializeValue(expoSnap.data() || {}) || {};

    const [eventSnap, stallTypesSnap, stallsSnap, bookingsSnap] = await Promise.all([
      expo?.eventId ? db.collection('events').doc(String(expo.eventId)).get() : Promise.resolve(null as any),
      db.collection('stallTypes').where('expoId', '==', expoId).get(),
      db.collection('stalls').where('expoId', '==', expoId).get(),
      db.collection('bookings').where('expoId', '==', expoId).get(),
    ]);

    const nowMs = Date.now();

    // Auto-expire stale reservations
    const expiredStallIds: string[] = [];
    const stallsRaw = stallsSnap.docs.map((doc) => ({ id: doc.id, ...(serializeValue(doc.data()) || {}) }));
    for (const stall of stallsRaw) {
      const status = String(stall?.status || '').toLowerCase();
      const expiresAtMs = Number(stall?.reservation?.expiresAtMs || 0);
      if ((status === 'reserved' || status === 'pending_payment') && expiresAtMs > 0 && expiresAtMs <= nowMs) {
        expiredStallIds.push(String(stall.id));
      }
    }

    if (expiredStallIds.length > 0) {
      const batch = db.batch();
      expiredStallIds.forEach((stallId) => {
        const ref = db.collection('stalls').doc(stallId);
        batch.set(
          ref,
          {
            status: 'available',
            reservation: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });
      await batch.commit();
    }

    // Reload current stalls after cleanup
    const freshStallsSnap = expiredStallIds.length > 0
      ? await db.collection('stalls').where('expoId', '==', expoId).get()
      : stallsSnap;

    const stalls = freshStallsSnap.docs
      .map((doc) => ({ id: doc.id, ...(serializeValue(doc.data()) || {}) }))
      .map((stall: any) => {
        const expiresAtMs = Number(stall?.reservation?.expiresAtMs || 0);
        const remainingMs = expiresAtMs > nowMs ? expiresAtMs - nowMs : 0;
        return {
          ...stall,
          reservation: stall?.reservation
            ? {
                ...stall.reservation,
                remainingMs,
              }
            : null,
        };
      })
      .sort((a: any, b: any) => String(a?.stallNumber || '').localeCompare(String(b?.stallNumber || ''), undefined, { numeric: true }));

    const stallTypes = stallTypesSnap.docs
      .map((doc) => ({ id: doc.id, ...(serializeValue(doc.data()) || {}) }))
      .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')));

    const event = eventSnap?.exists ? serializeValue(eventSnap.data() || {}) : null;

    const bookedExhibitors = bookingsSnap.docs
      .map((doc) => ({ id: doc.id, ...(serializeValue(doc.data()) || {}) }))
      .filter((booking: any) => {
        const status = String(booking?.status || '').toLowerCase();
        const paymentStatus = String(booking?.paymentStatus || '').toLowerCase();
        return status === 'paid' || status === 'booked' || paymentStatus === 'paid';
      })
      .map((booking: any) => ({
        id: String(booking?.id || ''),
        bookingId: String(booking?.bookingId || booking?.id || ''),
        stallId: String(booking?.stallId || ''),
        stallNumber: String(booking?.stallNumber || ''),
        companyName: String(booking?.companyName || ''),
        brandName: String(booking?.brandName || '').trim() || null,
        displayName: String(booking?.brandName || booking?.companyName || 'Exhibitor'),
        logoUrl: String(booking?.logoUrl || '').trim() || null,
        status: String(booking?.status || '').toLowerCase(),
        paymentStatus: String(booking?.paymentStatus || '').toLowerCase(),
        createdAt: booking?.createdAt || null,
        updatedAt: booking?.updatedAt || null,
      }))
      .sort((a: any, b: any) => String(a?.stallNumber || '').localeCompare(String(b?.stallNumber || ''), undefined, { numeric: true }));

    const metrics = {
      totalStalls: stalls.length,
      availableStalls: stalls.filter((s: any) => String(s?.status || '').toLowerCase() === 'available').length,
      reservedStalls: stalls.filter((s: any) => String(s?.status || '').toLowerCase() === 'reserved').length,
      pendingPayments: stalls.filter((s: any) => String(s?.status || '').toLowerCase() === 'pending_payment').length,
      bookedStalls: stalls.filter((s: any) => String(s?.status || '').toLowerCase() === 'booked').length,
    };

    return NextResponse.json({
      success: true,
      expo: { id: expoId, ...expo },
      event: event ? { id: String(expo?.eventId || ''), eventName: event?.eventName || null, eventDate: event?.eventDate || null } : null,
      stallTypes,
      stalls,
      bookedExhibitors,
      metrics,
      reservationPolicy: {
        holdMinutes: RESERVATION_TTL_MS / (60 * 1000),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to load public expo data' },
      { status: 500 },
    );
  }
}
