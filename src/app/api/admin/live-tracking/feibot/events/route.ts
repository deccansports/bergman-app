import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('liveTracking').doc('feibot').collection('events').get();

    const events = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
      .map((row: any) => ({
        eventUuid: String(row.eventUuid || row.id || '').trim(),
        cloudUuid: String(row.cloudUuid || '').trim() || null,
        eventName: String(row.eventName || row.name || 'Unknown Event').trim(),
        eventDate: String(row.eventDate || '').trim() || null,
        status: String(row.status || 'active').trim() || 'active',
        lastValidated: row.lastValidated || null,
        lastSync: row.lastSync || null,
        availableEndpoints: row.availableEndpoints || {},
      }))
      .filter((row) => !!row.eventUuid)
      .sort((a, b) => String(a.eventDate || '').localeCompare(String(b.eventDate || '')));

    return NextResponse.json({ success: true, events, count: events.length });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to load Feibot events' },
      { status: 500 },
    );
  }
}
