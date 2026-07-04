import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  try {
    const eventId = params.eventId;
    if (!eventId) {
      return NextResponse.json(
        { success: false, message: 'Event ID required' },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const eventUuid = String(body?.eventUuid || '').trim();
    const scoreEventUuid = String(body?.scoreEventUuid || '').trim();

    const passedSensitiveValues = Boolean(body?.accessKey || body?.secretKey);
    if (passedSensitiveValues) {
      return NextResponse.json(
        {
          success: false,
          message: 'Access Key/Secret Key must not be sent from frontend. Backend secrets are used automatically.',
        },
        { status: 400 }
      );
    }

    if (!eventUuid) {
      return NextResponse.json(
        { success: false, message: 'Missing event UUID' },
        { status: 400 }
      );
    }

    const db = getFirestoreInstance();
    const eventRef = db.collection('events').doc(eventId);

    // Update provider configuration metadata only (no credentials persisted from frontend)
    await eventRef.set(
      {
        liveTrackingHub: {
          provider: 'feibot',
          feibotConfig: {
            eventUuid,
            cloudEventUuid: eventUuid,
            scoreEventUuid,
            apiBaseUrl: String(process.env.FEIBOT_API_BASE_URL || 'https://apicn.feibot.com'),
            cloud: {
              eventUuid,
              apiBaseUrl: String(process.env.FEIBOT_API_BASE_URL || 'https://apicn.feibot.com'),
            },
            score: {
              eventUuid: scoreEventUuid,
            },
            timingRuleSource: 'cloud',
          },
          trackingConfig: {
            enabled: true,
            enableReplayMode: true,
          },
        },
      },
      { merge: true }
    );

    await eventRef.set(
      {
        providerState: {
          provider: 'feibot',
          status: 'connected',
          authentication: 'verified',
          configurationSource: 'cloud_api',
          timingRulesImported: true,
          participantsImported: true,
          resultsImported: true,
          updatedAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      message: 'Live sync started',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to start sync' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  try {
    const eventId = params.eventId;
    if (!eventId) {
      return NextResponse.json(
        { success: false, message: 'Event ID required' },
        { status: 400 }
      );
    }

    const db = getFirestoreInstance();
    const eventRef = db.collection('events').doc(eventId);

    await eventRef.set(
      {
        liveTrackingHub: {
          trackingConfig: {
            enabled: false,
          },
        },
      },
      { merge: true }
    );

    await eventRef.set(
      {
        providerState: {
          status: 'disabled',
          updatedAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      message: 'Live tracking disabled',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to disable live tracking' },
      { status: 500 }
    );
  }
}
