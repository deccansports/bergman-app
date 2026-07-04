import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { synchronizeEventConfiguration } from '@/lib/feibot-integration/event-config';

export const dynamic = 'force-dynamic';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function isAuthorized(req: NextRequest): boolean {
  const expectedToken = process.env.SYNC_SECRET || process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const internal = req.headers.get('x-bergman-internal-token');
  return bearer === expectedToken || internal === expectedToken;
}

function resolveSyncInfo(eventId: string, eventData: any): { eventId: string; eventUuid: string; connectionId: string } {
  const topLevel = eventData?.feibotConfig || {};
  const hubConfig = eventData?.liveTrackingHub?.feibotConfig || {};
  const cloudConfig = hubConfig?.cloud || {};

  const eventUuid = normalize(topLevel?.eventUuid || cloudConfig?.eventUuid || hubConfig?.eventUuid);
  const connectionId = normalize(topLevel?.connectionId || hubConfig?.connectionId);

  return { eventId, eventUuid, connectionId };
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const force = req.nextUrl.searchParams.get('force') === '1';
    const requestedEventId = normalize(req.nextUrl.searchParams.get('eventId'));

    const db = getFirestoreInstance();

    const targets: Array<{ eventId: string; eventUuid: string; connectionId: string }> = [];

    if (requestedEventId) {
      const doc = await db.collection('events').doc(requestedEventId).get();
      if (!doc.exists) {
        return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
      }
      targets.push(resolveSyncInfo(doc.id, doc.data() || {}));
    } else {
      const snapshot = await db.collection('events').limit(500).get();
      for (const doc of snapshot.docs) {
        const resolved = resolveSyncInfo(doc.id, doc.data() || {});
        if (resolved.eventUuid && resolved.connectionId) {
          targets.push(resolved);
        }
      }
    }

    const startedAt = Date.now();
    const results: Array<{
      eventId: string;
      eventUuid: string;
      success: boolean;
      changed: boolean;
      message: string;
      error?: string;
    }> = [];

    for (const target of targets) {
      try {
        const sync = await synchronizeEventConfiguration(target.eventId, target.eventUuid, target.connectionId, { force });
        results.push({
          eventId: target.eventId,
          eventUuid: target.eventUuid,
          success: sync.success,
          changed: sync.changed,
          message: sync.message,
          error: sync.error,
        });
      } catch (error) {
        results.push({
          eventId: target.eventId,
          eventUuid: target.eventUuid,
          success: false,
          changed: false,
          message: 'Failed to synchronize',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const changed = results.filter((r) => r.success && r.changed).length;
    const unchanged = results.filter((r) => r.success && !r.changed).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: failed === 0,
      message: 'Feibot configuration sync job completed',
      stats: {
        total: results.length,
        changed,
        unchanged,
        failed,
        durationMs: Date.now() - startedAt,
        force,
      },
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Job failed',
      },
      { status: 500 },
    );
  }
}
