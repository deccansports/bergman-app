import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';
import { syncFeibotCloudEventInfo } from '@/lib/feibot-integration/cloud-event-sync';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest) {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  const token = req.headers.get('x-bergman-internal-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return token === expectedToken;
}

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const eventId = String(params.eventId || '').trim();
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const db = getFirestoreInstance();
    const eventRef = db.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    }

    const event = serializeValue(eventSnap.data() || {}) || {};
    const hub = serializeValue(event?.liveTrackingHub || {}) || {};
    const cloudEventUuid = String(hub?.feibotConfig?.cloud?.eventUuid || hub?.feibotConfig?.eventUuid || '').trim();
    const scoreEventUuid = String(hub?.feibotConfig?.score?.eventUuid || '').trim();
    const snapshotRef = db.collection('liveTracking').doc('feibot').collection('eventSnapshots').doc(eventId);
    let snapshot = null as any;
    try {
      const snapshotDoc = await snapshotRef.get();
      snapshot = snapshotDoc.exists ? serializeValue(snapshotDoc.data() || {}) : null;
    } catch {
      snapshot = null;
    }

    const snapshotAgeMs = snapshot?.lastSync ? Math.abs(Date.now() - new Date(snapshot.lastSync).getTime()) : Number.POSITIVE_INFINITY;
    const shouldRefresh = !!cloudEventUuid && (!snapshot || snapshotAgeMs > 15 * 60 * 1000 || String(snapshot?.eventUuid || '') !== cloudEventUuid);

    if (shouldRefresh) {
      try {
        const synced = await syncFeibotCloudEventInfo({ eventId, eventUuid: cloudEventUuid, scoreEventUuid, triggeredBy: 'provider-database:get' });
        if (synced?.success && synced.snapshot) {
          snapshot = serializeValue(synced.snapshot);
        }
      } catch {
        // Keep last good snapshot if refresh fails.
      }
    }

    const summary = serializeValue(hub?.cloudApiEventInfo || {}) || {};
    const cloudEvent = {
      cloudEventUuid: String(snapshot?.cloudEventUuid || summary?.cloudEventUuid || cloudEventUuid || '').trim() || null,
      scoreEventUuid: String(snapshot?.scoreEventUuid || summary?.scoreEventUuid || scoreEventUuid || '').trim() || null,
      eventName: snapshot?.eventName || summary?.eventName || event?.eventName || hub?.eventName || null,
      provider: 'Feibot',
      cloudApiStatus: snapshot?.status === 'connected' || summary?.status === 'connected' ? 'Connected' : cloudEventUuid ? 'Configured' : 'Not Configured',
      authentication: snapshot?.authentication || summary?.authentication || (cloudEventUuid ? 'pending' : 'missing'),
      lastSync: snapshot?.lastSync || summary?.lastSync || event?.updatedAt || null,
      responseTimeMs: snapshot?.diagnostics?.timingRules?.responseTimeMs ?? hub?.providerDiagnostics?.responseTimeMs ?? null,
      contestsCount: Number(snapshot?.contestsCount ?? summary?.contestsCount ?? 0),
      timingPointsCount: Number(snapshot?.timingPointsCount ?? summary?.timingPointsCount ?? 0),
      splitsCount: Number(snapshot?.splitsCount ?? summary?.splitsCount ?? 0),
      ageGroupsCount: Number(snapshot?.ageGroupsCount ?? summary?.ageGroupsCount ?? 0),
      participantsCount: Number(snapshot?.participantsCount ?? summary?.participantsCount ?? 0),
      devicesCount: Number(snapshot?.devicesCount ?? summary?.devicesCount ?? 0),
      contests: Array.isArray(snapshot?.contests) ? snapshot.contests : [],
      timingPoints: Array.isArray(snapshot?.timingPoints) ? snapshot.timingPoints : [],
      splits: Array.isArray(snapshot?.splits) ? snapshot.splits : [],
      ageGroups: Array.isArray(snapshot?.ageGroups) ? snapshot.ageGroups : [],
      devices: Array.isArray(snapshot?.devices) ? snapshot.devices : [],
      diagnostics: snapshot?.diagnostics || null,
    };

    return NextResponse.json({
      success: true,
      eventId,
      database: cloudEvent,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load provider database metadata',
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest, { params }: { params: { eventId: string } }) {
  const eventId = String(params.eventId || '').trim();
  return NextResponse.json({ success: false, eventId, message: 'Legacy database writes are disabled. Cloud API is the source of truth.' }, { status: 410 });
}
