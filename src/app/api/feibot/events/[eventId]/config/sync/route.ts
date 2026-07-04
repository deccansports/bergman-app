import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { synchronizeEventConfiguration } from '@/lib/feibot-integration/event-config';

export const dynamic = 'force-dynamic';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function isAuthorized(req: NextRequest): boolean {
  const expectedToken = process.env.FEIBOT_API_TOKEN || process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;

  const token =
    req.headers.get('x-bergman-internal-token') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();

  return token === expectedToken;
}

async function resolveEventSyncConfig(eventId: string, body: any): Promise<{ eventUuid: string; connectionId: string }> {
  const bodyEventUuid = normalize(body?.eventUuid);
  const bodyConnectionId = normalize(body?.connectionId);

  if (bodyEventUuid && bodyConnectionId) {
    return {
      eventUuid: bodyEventUuid,
      connectionId: bodyConnectionId,
    };
  }

  const db = getFirestoreInstance();
  const eventDoc = await db.collection('events').doc(eventId).get();
  const eventData = eventDoc.exists ? eventDoc.data() || {} : {};
  const topLevel = (eventData as any)?.feibotConfig || {};
  const hubConfig = (eventData as any)?.liveTrackingHub?.feibotConfig || {};
  const cloudConfig = hubConfig?.cloud || {};

  const eventUuid = normalize(bodyEventUuid || topLevel?.eventUuid || cloudConfig?.eventUuid || hubConfig?.eventUuid);
  const connectionId = normalize(bodyConnectionId || topLevel?.connectionId || hubConfig?.connectionId);

  return { eventUuid, connectionId };
}

export async function POST(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const eventId = normalize(params?.eventId);
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;

    const resolved = await resolveEventSyncConfig(eventId, body);

    if (!resolved.eventUuid || !resolved.connectionId) {
      return NextResponse.json(
        {
          success: false,
          message: 'eventUuid and connectionId are required (body or saved event config)',
        },
        { status: 400 },
      );
    }

    const result = await synchronizeEventConfiguration(eventId, resolved.eventUuid, resolved.connectionId, { force });
    return NextResponse.json(result, { status: result.success ? 200 : Number(result.statusCode || 500) });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to synchronize event configuration',
      },
      { status: 500 },
    );
  }
}
