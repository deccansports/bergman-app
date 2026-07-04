import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest) {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  const token = req.headers.get('x-bergman-internal-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return token === expectedToken;
}

async function resolveEventDoc(eventId: string) {
  const db = getFirestoreInstance();
  const eventsRef = db.collection('events').doc(eventId);
  const eventsSnap = await eventsRef.get();
  if (eventsSnap.exists) return { ref: eventsRef, exists: true, data: serializeValue(eventsSnap.data() || {}) || {} };

  const calendarRef = db.collection('eventCalendar').doc(eventId);
  const calendarSnap = await calendarRef.get();
  if (calendarSnap.exists) return { ref: calendarRef, exists: true, data: serializeValue(calendarSnap.data() || {}) || {} };

  return null;
}

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    if (!isAuthorized(req)) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const eventId = String(params.eventId || '').trim();
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });

    const record = await resolveEventDoc(eventId);
    if (!record) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });

    return NextResponse.json({
      success: true,
      eventId,
      overrides: record.data?.timingConfigurationOverrides || { timingPoints: {}, updatedAt: null },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to load overrides' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    if (!isAuthorized(req)) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const eventId = String(params.eventId || '').trim();
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const pointId = String(body?.pointId || body?.providerId || body?.providerCode || '').trim();
    const patch = body?.patch && typeof body.patch === 'object' ? body.patch : null;
    if (!pointId || !patch) {
      return NextResponse.json({ success: false, message: 'pointId/providerId and patch are required' }, { status: 400 });
    }

    const record = await resolveEventDoc(eventId);
    if (!record) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });

    const current = record.data?.timingConfigurationOverrides || { timingPoints: {} };
    const next = {
      ...current,
      timingPoints: {
        ...(current?.timingPoints || {}),
        [pointId]: {
          ...(current?.timingPoints?.[pointId] || {}),
          ...patch,
        },
      },
      updatedAt: new Date().toISOString(),
    };

    await record.ref.set({ timingConfigurationOverrides: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    return NextResponse.json({ success: true, eventId, overrides: next, message: 'Timing point override saved' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to save overrides' }, { status: 500 });
  }
}
