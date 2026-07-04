import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { _syncCalendarToKV } from '@/lib/actions/eventActions';
import { putKV } from '@/lib/cloudflare/kv';
import { serializeValue } from '@/lib/utils';
import { getFeibotRuntimeSecretsAsync } from '@/lib/feibot-integration/secure-credentials';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest) {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  const token = req.headers.get('x-bergman-internal-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return token === expectedToken;
}

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
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

    const existing = eventSnap.data() || {};
    const existingHub = serializeValue(existing.liveTrackingHub || {}) || {};
    const feibotConfig = existingHub?.feibotConfig || {};
    const cloudConfig = feibotConfig?.cloud || {};
    const scoreConfig = feibotConfig?.score || {};
    const legacyEventUuid = String(feibotConfig?.legacyEventUuid || (feibotConfig?.eventUuid && feibotConfig?.eventUuid !== cloudConfig?.eventUuid ? feibotConfig?.eventUuid : '') || '').trim();

    let hasCredentials = false;
    let credentialsSource: 'cloudflare-secrets' | 'firestore' | 'none' = 'none';
    try {
      const runtime = await getFeibotRuntimeSecretsAsync();
      hasCredentials = Boolean(runtime.accessKey && runtime.secretKey);
      credentialsSource = runtime.source === 'env' ? 'cloudflare-secrets' : 'firestore';
    } catch {
      hasCredentials = false;
      credentialsSource = 'none';
    }

    return NextResponse.json({
      success: true,
      eventId,
      provider: 'feibot',
      config: {
        trackingConfig: {
          enabled: Boolean(existingHub?.trackingConfig?.enabled ?? true),
          showOnHomepage: Boolean(existingHub?.trackingConfig?.showOnHomepage ?? existing?.showLiveTrackingOnHomepage ?? false),
        },
        feibotConfig: {
          hasCredentials,
          credentialsSource,
          eventUuid: String(cloudConfig?.eventUuid || feibotConfig?.eventUuid || ''),
          resolvedEventUuid: String(cloudConfig?.eventUuid || feibotConfig?.eventUuid || ''),
          legacyEventUuid,
          apiBaseUrl: String(process.env.FEIBOT_API_BASE_URL || cloudConfig?.apiBaseUrl || feibotConfig?.apiBaseUrl || 'https://apicn.feibot.com'),
          cloud: {
            eventUuid: String(cloudConfig?.eventUuid || ''),
            apiBaseUrl: String(process.env.FEIBOT_API_BASE_URL || cloudConfig?.apiBaseUrl || 'https://apicn.feibot.com'),
            hasCredentials,
          },
          score: {
            eventUuid: String(scoreConfig?.eventUuid || ''),
            overviewUrl: String(scoreConfig?.overviewUrl || ''),
            progressUrl: String(scoreConfig?.progressUrl || ''),
            available: !!scoreConfig?.available,
          },
          timingRuleSource: String(feibotConfig?.timingRuleSource || 'cloud'),
        },
      },
      message: 'Provider configuration retrieved',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to retrieve provider configuration',
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const eventId = String(params.eventId || '').trim();
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const provider = String(body?.provider || body?.config?.provider || 'manual').trim().toLowerCase();

    if (provider !== 'feibot') {
      return NextResponse.json({ success: false, message: 'Only feibot provider is supported in this endpoint' }, { status: 400 });
    }

    const feibotConfig = body?.config?.feibotConfig || {};
    const cloudInput = feibotConfig?.cloud || {};
    const scoreInput = feibotConfig?.score || {};

    const cloudEventUuid = String(cloudInput?.eventUuid || feibotConfig?.eventUuid || '').trim();
    const scoreEventUuid = String(scoreInput?.eventUuid || feibotConfig?.scoreEventUuid || '').trim();
    const apiBaseUrl = String(process.env.FEIBOT_API_BASE_URL || cloudInput?.apiBaseUrl || feibotConfig?.apiBaseUrl || 'https://apicn.feibot.com').trim() || 'https://apicn.feibot.com';
    const timingRuleSource = 'cloud';

    const clientPassedSensitiveValues = Boolean(
      cloudInput?.accessKey ||
      cloudInput?.secretKey ||
      feibotConfig?.accessKey ||
      feibotConfig?.secretKey,
    );

    if (clientPassedSensitiveValues) {
      return NextResponse.json(
        {
          success: false,
          message: 'Access Key/Secret Key must not be sent from frontend. Configure credentials in backend secrets or use Admin Panel → Feibot Authentication → Update Credentials.',
        },
        { status: 400 },
      );
    }

    const missing: string[] = [];
    if (!cloudEventUuid) missing.push('cloud.eventUuid');
    if (missing.length > 0) {
      return NextResponse.json({ success: false, message: `Missing required fields: ${missing.join(', ')}` }, { status: 400 });
    }

    const db = getFirestoreInstance();
    const eventRef = db.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();

    if (!eventSnap.exists) {
      return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    }

    const existing = eventSnap.data() || {};
    const existingHub = serializeValue(existing.liveTrackingHub || {}) || {};

    const scoreOverviewUrl = scoreEventUuid ? `https://score.feibot.com/?id=${encodeURIComponent(scoreEventUuid)}` : '';
    const scoreProgressUrl = scoreEventUuid
      ? `https://score.feibot.com/onlineDateQuery/index.html#/progress/event?event_uuid=${encodeURIComponent(scoreEventUuid)}`
      : '';
    const previousLegacyEventUuid = String(existingHub?.feibotConfig?.legacyEventUuid || (existingHub?.feibotConfig?.eventUuid && existingHub?.feibotConfig?.eventUuid !== cloudEventUuid ? existingHub?.feibotConfig?.eventUuid : '') || '').trim();

    const nextHub = {
      ...existingHub,
      provider: 'feibot',
      feibotConfig: {
        ...(existingHub?.feibotConfig || {}),
        eventUuid: cloudEventUuid,
        apiBaseUrl,
        cloud: {
          ...(existingHub?.feibotConfig?.cloud || {}),
          eventUuid: cloudEventUuid,
          apiBaseUrl,
          connected: Boolean(existingHub?.feibotConfig?.cloud?.connected),
          authenticated: Boolean(existingHub?.feibotConfig?.cloud?.authenticated),
        },
        legacyEventUuid: previousLegacyEventUuid || undefined,
        score: {
          ...(existingHub?.feibotConfig?.score || {}),
          eventUuid: scoreEventUuid,
          overviewUrl: scoreOverviewUrl,
          progressUrl: scoreProgressUrl,
          available: !!scoreEventUuid,
        },
        timingRuleSource: 'cloud',
      },
    };

    await eventRef.set(
      {
        liveTrackingHub: nextHub,
        liveDataSource: 'timing_partner',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await _syncCalendarToKV();

    // Sync provider config to KV for health-check and contest-mapping
    const kvConfig = {
      provider: 'feibot',
      providerConfig: {
        eventUuid: cloudEventUuid,
        apiBaseUrl,
      },
      feibotConfig: {
        eventUuid: cloudEventUuid,
        apiBaseUrl,
        legacyEventUuid: previousLegacyEventUuid || undefined,
        cloud: {
          eventUuid: cloudEventUuid,
          apiBaseUrl,
        },
        score: {
          eventUuid: scoreEventUuid,
          overviewUrl: scoreOverviewUrl,
          progressUrl: scoreProgressUrl,
          available: !!scoreEventUuid,
        },
        timingRuleSource: 'cloud',
      },
    };

    await putKV(`event:${eventId}:config`, kvConfig, 'api-contest-mapping');
    await putKV(`live:event:${eventId}:config`, kvConfig, 'api-contest-mapping');
    await putKV(`live:event:${eventId}:provider-config`, kvConfig, 'api-contest-mapping');

    const refreshed = await eventRef.get();
    const refreshedData = refreshed.data() || {};
    const refreshedHub = serializeValue(refreshedData.liveTrackingHub || {}) || {};
    const refreshedCloud = refreshedHub?.feibotConfig?.cloud || {};
    const refreshedScore = refreshedHub?.feibotConfig?.score || {};

    let hasCredentials = false;
    let credentialsSource: 'cloudflare-secrets' | 'firestore' | 'none' = 'none';
    try {
      const runtime = await getFeibotRuntimeSecretsAsync();
      hasCredentials = Boolean(runtime.accessKey && runtime.secretKey);
      credentialsSource = runtime.source === 'env' ? 'cloudflare-secrets' : 'firestore';
    } catch {
      hasCredentials = false;
      credentialsSource = 'none';
    }

    return NextResponse.json({
      success: true,
      eventId,
      provider: 'feibot',
      config: {
        trackingConfig: {
          enabled: Boolean(refreshedHub?.trackingConfig?.enabled ?? true),
          showOnHomepage: Boolean(refreshedHub?.trackingConfig?.showOnHomepage ?? refreshedData?.showLiveTrackingOnHomepage ?? false),
        },
        feibotConfig: {
          hasCredentials,
          credentialsSource,
          eventUuid: String(refreshedHub?.feibotConfig?.eventUuid || cloudEventUuid),
          resolvedEventUuid: String(refreshedHub?.feibotConfig?.cloud?.eventUuid || refreshedHub?.feibotConfig?.eventUuid || cloudEventUuid),
          legacyEventUuid: String(refreshedHub?.feibotConfig?.legacyEventUuid || (refreshedHub?.feibotConfig?.eventUuid && refreshedHub?.feibotConfig?.eventUuid !== cloudEventUuid ? refreshedHub?.feibotConfig?.eventUuid : '') || ''),
          apiBaseUrl: String(refreshedHub?.feibotConfig?.apiBaseUrl || apiBaseUrl),
          cloud: {
            eventUuid: String(refreshedCloud?.eventUuid || cloudEventUuid),
            apiBaseUrl: String(refreshedCloud?.apiBaseUrl || apiBaseUrl),
            hasCredentials,
          },
          score: {
            eventUuid: String(refreshedScore?.eventUuid || scoreEventUuid),
            overviewUrl: String(refreshedScore?.overviewUrl || scoreOverviewUrl),
            progressUrl: String(refreshedScore?.progressUrl || scoreProgressUrl),
          },
          timingRuleSource: String(refreshedHub?.feibotConfig?.timingRuleSource || 'cloud'),
        },
      },
      message: 'Provider configuration saved',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save provider configuration',
      },
      { status: 500 },
    );
  }
}
