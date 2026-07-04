import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { callFeibotAPI } from '@/lib/feibot-integration/api-client';
import { getCredentialEncryptionKey } from '@/lib/secrets/encryption-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

async function encryptValue(value: string): Promise<string> {
  const key = await getCredentialEncryptionKey();
  if (!key) {
    return `b64:${Buffer.from(value, 'utf8').toString('base64')}`;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function mapEventRow(row: any) {
  const eventUuid = normalize(row?.event_uuid || row?.eventUuid || row?.uuid || row?.id);
  const cloudUuid = normalize(
    row?.cloud_uuid ||
      row?.cloudUuid ||
      row?.score_event_uuid ||
      row?.scoreEventUuid ||
      row?.score_uuid ||
      row?.scoreUuid,
  );
  return {
    eventUuid,
    cloudUuid: cloudUuid || null,
    eventName: normalize(row?.name || row?.event_name || row?.eventName || row?.title || 'Unknown Event') || 'Unknown Event',
    eventDate: normalize(row?.date || row?.event_date || row?.eventDate || '' ) || null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const accessKey = normalize(body?.accessKey);
    const secretKey = normalize(body?.secretKey);
    const account = normalize(body?.account) || 'feibot';
    const eventUuid = normalize(body?.eventUuid);

    if (!accessKey || !secretKey) {
      return NextResponse.json(
        { success: false, message: 'Access Key and Secret Key are required.' },
        { status: 400 },
      );
    }

    const apiBaseUrl = normalize(process.env.FEIBOT_API_BASE_URL || 'https://apicn.feibot.com') || 'https://apicn.feibot.com';

    // 1) Authenticate + discover events
    const eventsResult = await callFeibotAPI<any>(
      { accountId: account, accessKey, secretKey, apiBaseUrl },
      '/eventConfigFile/eventsList',
      { method: 'GET' },
    );

    const authFailed = eventsResult.status === 401 || eventsResult.status === 403;
    const discoveryUnavailable = eventsResult.status === 404;

    if (authFailed) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid Access Key or Secret Key. Credentials were not saved.',
          checks: [{ key: 'authentication', label: 'Authentication', status: 'FAIL', httpStatus: eventsResult.status }],
        },
        { status: eventsResult.status || 400 },
      );
    }

    const rows = !discoveryUnavailable && eventsResult.ok
      ? Array.isArray((eventsResult.data as any)?.data)
        ? (eventsResult.data as any).data
        : Array.isArray(eventsResult.data)
          ? eventsResult.data
          : []
      : [];

    const discovered = rows.map(mapEventRow).filter((row: any) => !!row.eventUuid);

    const selectedEventUuid = eventUuid || discovered[0]?.eventUuid || '';

    // 2) Resolve cloud UUID where missing
    for (const event of discovered) {
      if (event.cloudUuid) continue;
      const timing = await callFeibotAPI<any>(
        { accountId: account, accessKey, secretKey, apiBaseUrl },
        '/eventConfigFile/timingRulesGet',
        { method: 'GET', query: { event_uuid: event.eventUuid } },
      );
      if (timing.ok) {
        const payload: any = timing.data || {};
        const cloudUuid = normalize(
          payload?.cloud_uuid ||
            payload?.cloudUuid ||
            payload?.score_event_uuid ||
            payload?.scoreEventUuid ||
            payload?.event_uuid ||
            payload?.eventUuid,
        );
        event.cloudUuid = cloudUuid || event.eventUuid;
      } else {
        event.cloudUuid = event.eventUuid;
      }
    }

    // 3) Full connectivity checks
    const checks: Array<{ key: string; label: string; status: 'PASS' | 'WARNING' | 'FAIL'; httpStatus: number; message?: string }> = [];

    checks.push({ key: 'authentication', label: 'Authentication', status: 'PASS', httpStatus: 200 });
    checks.push({
      key: 'events',
      label: 'Event List',
      status: discoveryUnavailable ? 'WARNING' : discovered.length > 0 ? 'PASS' : 'WARNING',
      httpStatus: eventsResult.status || 200,
      message: discoveryUnavailable ? 'Event discovery endpoint returned 404; continuing with credential save.' : `${discovered.length} events found`,
    });
    checks.push({
      key: 'cloudUuid',
      label: 'Cloud UUID',
      status: discovered[0]?.cloudUuid ? 'PASS' : 'WARNING',
      httpStatus: discovered[0]?.cloudUuid ? 200 : 0,
      message: discovered[0]?.cloudUuid ? 'Resolved' : 'Not resolved yet',
    });

    const endpointDefs = [
      { key: 'participants', label: 'Participants API', path: '/temporary/participantsGetAll' },
      { key: 'splits', label: 'Splits API', path: '/eventConfigFile/timingRulesGet' },
      { key: 'liveTiming', label: 'Live Timing API', path: '/temporary/temporary_ResultDataGetAll' },
      { key: 'checkpoints', label: 'Checkpoints API', path: '/raceProcessService/queryRaceProcess' },
      { key: 'timingData', label: 'Timing Data API', path: '/leaderboardQueryService/queryLeaderboard' },
    ];

    for (const endpoint of endpointDefs) {
      const r = await callFeibotAPI<any>(
        { accountId: account, accessKey, secretKey, apiBaseUrl },
        endpoint.path,
        { method: 'GET', query: selectedEventUuid ? { event_uuid: selectedEventUuid } : {} },
      );
      const endpointStatus: 'PASS' | 'WARNING' | 'FAIL' = r.ok
        ? 'PASS'
        : [403, 404, 429].includes(r.status)
          ? 'WARNING'
          : 'FAIL';
      checks.push({
        key: endpoint.key,
        label: endpoint.label,
        status: endpointStatus,
        httpStatus: r.status,
        message: r.ok
          ? 'Reachable'
          : r.status === 429
            ? 'Rate limited by Feibot (optional check skipped)'
            : [403, 404].includes(r.status)
              ? 'Optional endpoint not supported'
              : `HTTP ${r.status}`,
      });
    }

    const failed = checks.filter((c) => c.key === 'authentication' && c.status === 'FAIL');
    if (failed.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `${failed[0].label} is unavailable. Credentials were not saved.`,
          checks,
          eventsFound: discovered.length,
        },
        { status: 400 },
      );
    }

    // 4) Encrypt + save only after all checks pass
    const db = getFirestoreInstance();
    const now = new Date().toISOString();

    const encryptedAccessKey = await encryptValue(accessKey);
    const encryptedSecretKey = await encryptValue(secretKey);

    const credsPayload = {
      provider: 'feibot',
      account,
      apiBaseUrl,
      accessKey: encryptedAccessKey,
      secretKey: encryptedSecretKey,
      authenticated: true,
      validatedAt: now,
      updatedAt: now,
      lastAuthResult: 'success',
      eventUuid: selectedEventUuid || null,
      events: discovered,
      eventsCount: discovered.length,
      availableEndpoints: checks.reduce((acc, c) => ({ ...acc, [c.key]: c.status === 'PASS' }), {} as Record<string, boolean>),
    };

    await db.doc('__feibotCredentials/main').set({
      ...credsPayload,
      version: 1,
      updatedBy: 'admin-ui',
    }, { merge: true });

    await db.collection('liveTracking').doc('feibot').set({
      provider: 'feibot',
      authenticated: true,
      validatedAt: now,
      eventUuid: selectedEventUuid || null,
      primaryEventUuid: selectedEventUuid || null,
      events: discovered,
      eventsCount: discovered.length,
      lastUpdated: now,
      availableEndpoints: checks.reduce((acc, c) => ({ ...acc, [c.key]: c.status === 'PASS' }), {} as Record<string, boolean>),
    }, { merge: true });

    await db.collection('liveTracking').doc('feibot').collection('credentials').doc('main').set(credsPayload, { merge: true });

    const batch = db.batch();
    for (const event of discovered) {
      const ref = db.collection('liveTracking').doc('feibot').collection('events').doc(event.eventUuid);
      batch.set(ref, {
        eventUuid: event.eventUuid,
        cloudUuid: event.cloudUuid || event.eventUuid,
        eventName: event.eventName,
        eventDate: event.eventDate,
        status: 'active',
        lastValidated: now,
        lastSync: null,
        availableEndpoints: checks.reduce((acc, c) => ({ ...acc, [c.key]: c.status === 'PASS' }), {} as Record<string, boolean>),
      }, { merge: true });
    }
    await batch.commit();

    if (eventUuid && normalize(body?.eventId)) {
      const eventRef = db.collection('events').doc(normalize(body.eventId));
      await eventRef.set({
        feibotConfig: {
          ...(body?.feibotConfig && typeof body.feibotConfig === 'object' ? body.feibotConfig : {}),
          eventUuid,
          resolvedEventUuid: eventUuid,
          primaryEventUuid: selectedEventUuid || null,
          events: discovered,
          eventsCount: discovered.length,
          cloud: {
            ...(body?.feibotConfig?.cloud && typeof body.feibotConfig.cloud === 'object' ? body.feibotConfig.cloud : {}),
            eventUuid,
          },
        },
        updatedAt: now,
      }, { merge: true });
    }

    return NextResponse.json({
      success: true,
      message: discovered.length > 0
        ? 'Credentials encrypted and stored successfully.'
        : 'Credentials encrypted and stored successfully. Event discovery is unavailable for this account, so you can select an event manually later.',
      checks,
      eventsFound: discovered.length,
      events: discovered,
      primaryEventUuid: selectedEventUuid || null,
      cloudUuid: discovered[0]?.cloudUuid || selectedEventUuid || null,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to save Feibot credentials' },
      { status: 500 },
    );
  }
}
