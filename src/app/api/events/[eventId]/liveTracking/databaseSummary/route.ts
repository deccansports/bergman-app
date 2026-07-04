import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { eventId: string } }) {
  const eventId = String(params.eventId || '').trim();
  if (!eventId) return NextResponse.json({ success: false, message: 'Missing eventId' }, { status: 400 });

  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('events').doc(eventId).get();
    if (!snap.exists) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });

    const event = serializeValue(snap.data() || {}) || {};
    const hub   = serializeValue(event?.liveTrackingHub || {}) || {};
    const cloud = serializeValue(hub?.feibotConfig?.cloud || {}) || {};
    const cloudConfig = {
      cloudEventUuid: cloud.eventUuid || hub?.feibotConfig?.cloudEventUuid || hub?.feibotConfig?.eventUuid || null,
      eventName: event?.eventName || hub?.event?.eventName || hub?.eventName || null,
      provider: 'Feibot',
      cloudApiStatus: hub?.feibotConfig?.cloud?.accessKey && hub?.feibotConfig?.cloud?.secretKey ? 'Connected' : 'Not Configured',
      authentication: hub?.feibotConfig?.cloud?.accessKey && hub?.feibotConfig?.cloud?.secretKey ? 'verified' : 'pending',
      lastSync: hub?.updatedAt || event?.updatedAt || null,
      responseTimeMs: hub?.providerDiagnostics?.responseTimeMs ?? null,
      contests: Array.isArray(hub?.liveTracking?.timingRules?.contests) ? hub.liveTracking.timingRules.contests : [],
      timingPoints: Array.isArray(hub?.liveTracking?.timingRules?.timingPoints) ? hub.liveTracking.timingRules.timingPoints : [],
      splits: Array.isArray(hub?.liveTracking?.timingRules?.splits) ? hub.liveTracking.timingRules.splits : [],
      ageGroups: Array.isArray(hub?.liveTracking?.timingRules?.ageGroups) ? hub.liveTracking.timingRules.ageGroups : [],
      participants: Number(hub?.liveTracking?.participantCount || hub?.participantsCount || 0),
      devices: Array.isArray(hub?.liveTracking?.timingRules?.devices) ? hub.liveTracking.timingRules.devices.length : Number(hub?.liveTracking?.timingRules?.devicesCount || 0),
    };

    return NextResponse.json({
      success: true,
      eventId,
      cloudEvent: cloudConfig,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to load database summary' },
      { status: 500 },
    );
  }
}
