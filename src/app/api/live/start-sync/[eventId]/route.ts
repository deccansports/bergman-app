import { NextRequest, NextResponse } from 'next/server';
import { putKV } from '@/lib/cloudflare/kv';

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

    const apiBaseUrl = String(process.env.FEIBOT_API_BASE_URL || 'https://apicn.feibot.com');
    const updatedAt = new Date().toISOString();

    const liveTrackingHub = {
      provider: 'feibot',
      feibotConfig: {
        eventUuid,
        cloudEventUuid: eventUuid,
        scoreEventUuid,
        apiBaseUrl,
        cloud: {
          eventUuid,
          apiBaseUrl,
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
      providerState: {
        provider: 'feibot',
        status: 'connected',
        authentication: 'verified',
        configurationSource: 'cloud_api',
        timingRulesImported: true,
        participantsImported: true,
        resultsImported: true,
        updatedAt,
      },
      updatedAt,
    };

    const kvConfig = {
      provider: 'feibot',
      providerConfig: {
        eventUuid,
        apiBaseUrl,
      },
      feibotConfig: {
        eventUuid,
        apiBaseUrl,
        cloud: {
          eventUuid,
          apiBaseUrl,
        },
        score: {
          eventUuid: scoreEventUuid,
          overviewUrl: scoreEventUuid ? `https://score.feibot.com/?id=${encodeURIComponent(scoreEventUuid)}` : '',
          progressUrl: scoreEventUuid
            ? `https://score.feibot.com/onlineDateQuery/index.html#/progress/event?event_uuid=${encodeURIComponent(scoreEventUuid)}`
            : '',
          available: Boolean(scoreEventUuid),
        },
        timingRuleSource: 'cloud',
      },
      trackingConfig: {
        enabled: true,
        enableReplayMode: true,
      },
      providerState: {
        provider: 'feibot',
        status: 'connected',
        authentication: 'verified',
        configurationSource: 'cloud_api',
        timingRulesImported: true,
        participantsImported: true,
        resultsImported: true,
        updatedAt,
      },
      liveTrackingHub,
      updatedAt,
    };

    await Promise.all([
      putKV(`event:${eventId}:config`, kvConfig, 'api-live-start-sync'),
      putKV(`live:event:${eventId}:config`, kvConfig, 'api-live-start-sync'),
      putKV(`live:event:${eventId}:provider-config`, kvConfig, 'api-live-start-sync'),
    ]);

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

    const updatedAt = new Date().toISOString();
    const kvConfig = {
      provider: 'feibot',
      trackingConfig: {
        enabled: false,
      },
      providerState: {
        provider: 'feibot',
        status: 'disabled',
        updatedAt,
      },
      updatedAt,
    };

    await Promise.all([
      putKV(`event:${eventId}:config`, kvConfig, 'api-live-start-sync'),
      putKV(`live:event:${eventId}:config`, kvConfig, 'api-live-start-sync'),
      putKV(`live:event:${eventId}:provider-config`, kvConfig, 'api-live-start-sync'),
    ]);

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
