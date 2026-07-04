import { NextRequest, NextResponse } from 'next/server';
import { callFeibotAPI } from '@/lib/feibot-integration/api-client';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getFeibotRuntimeSecretsAsync } from '@/lib/feibot-integration/secure-credentials';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function isAuthorized(req: NextRequest) {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  const token = req.headers.get('x-bergman-internal-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return token === expectedToken;
}

type EndpointCheck = {
  key: string;
  label: string;
  url: string;
  method: 'GET';
  status: 'PASS' | 'WARNING' | 'FAIL';
  httpCode: number;
  latencyMs: number;
  payloadSize: number;
  responseCount: number;
  lastSuccess: string | null;
  lastFailure: string | null;
  message?: string;
  signatureDiagnostics?: {
    method: string;
    path: string;
    timestamp: string;
    sortedQuery: string;
    body: string;
    stringToSign: string;
    algorithm: string;
    digestEncoding: string;
    headers: { 'X-Feibot-AK': string; 'X-Feibot-Timestamp': string; 'X-Feibot-Signature': string };
  };
};

const REQUIRED_ENDPOINT_KEYS = new Set([
  'authentication',
  'eventConfiguration',
  'participantsGetAll',
  'realtimeResults',
  'scoreUrl',
  'progressUrl',
]);

const healthCache = new Map<string, { expiresAt: number; payload: any }>();
const HEALTH_CACHE_TTL_MS = 10 * 60 * 1000;

function getHealthCacheKey(eventId: string, checkKey: string | null, cacheVariant?: string | null) {
  return `${eventId}:${checkKey || 'all'}:${String(cacheVariant || 'default').trim() || 'default'}`;
}

function readHealthCache(eventId: string, checkKey: string | null, cacheVariant?: string | null) {
  const cached = healthCache.get(getHealthCacheKey(eventId, checkKey, cacheVariant));
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    healthCache.delete(getHealthCacheKey(eventId, checkKey, cacheVariant));
    return null;
  }
  return cached.payload;
}

function writeHealthCache(eventId: string, checkKey: string | null, payload: any, cacheVariant?: string | null) {
  healthCache.set(getHealthCacheKey(eventId, checkKey, cacheVariant), {
    expiresAt: Date.now() + HEALTH_CACHE_TTL_MS,
    payload,
  });
}

function normalizeOptionalCheck(check: EndpointCheck): EndpointCheck {
  // Optional endpoints should not reduce readiness for documented behaviors.
  if (check.httpCode === 429) {
    return {
      ...check,
      status: 'PASS',
      message: 'Rate Limited (Optional): Feibot limits Finish Result exports to one request approximately every 10 seconds.',
    };
  }

  if (check.httpCode === 404) {
    return {
      ...check,
      status: 'PASS',
      message: 'Endpoint Not Supported (Optional Feature)',
    };
  }

  if (check.httpCode === 403) {
    if (check.key === 'leaderboard' || check.key === 'raceProcess') {
      return {
        ...check,
        status: 'PASS',
        message: 'Not Enabled (Optional Feature)',
      };
    }

    const msg = String(check.message || '').toLowerCase();
    if (msg.includes('not enabled') || msg.includes('disabled') || msg.includes('not support') || msg.includes('not supported')) {
      return {
        ...check,
        status: 'PASS',
        message: 'Not Enabled (Optional Feature)',
      };
    }

    return {
      ...check,
      status: 'PASS',
      message: 'Forbidden (Optional Feature)',
    };
  }

  return check;
}

type HealthProviderConfig = {
  accessKey: string;
  secretKey: string;
  apiBaseUrl: string;
  eventUuid: string;
  scoreEventUuid?: string;
  scoreOverviewUrl?: string;
  scoreProgressUrl?: string;
};

function parseQueryObject(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    query[k] = v;
  }
  return query;
}

async function loadHealthProviderConfig(eventId: string, body: any): Promise<HealthProviderConfig> {
  const db = getFirestoreInstance();
  const eventDoc = await db.collection('events').doc(eventId).get();
  const eventData = eventDoc.exists ? eventDoc.data() || {} : {};
  const hub = (eventData as any)?.liveTrackingHub || {};
  const feibotConfig = hub?.feibotConfig || {};
  const cloudConfig = feibotConfig?.cloud || {};
  const scoreConfig = feibotConfig?.score || {};

  let accessKey = normalize(process.env.FEIBOT_ACCESS_KEY);
  let secretKey = normalize(process.env.FEIBOT_SECRET_KEY);
  try {
    if (!accessKey || !secretKey) {
      const runtime = await getFeibotRuntimeSecretsAsync();
      accessKey = normalize(runtime.accessKey);
      secretKey = normalize(runtime.secretKey);
    }
  } catch {
    // keep empty strings; downstream missing checks will report this cleanly
  }

  const apiBaseUrl = normalize(
    process.env.FEIBOT_API_BASE_URL ||
      body?.apiBaseUrl ||
      cloudConfig?.apiBaseUrl ||
      feibotConfig?.apiBaseUrl ||
      'https://apicn.feibot.com',
  ) || 'https://apicn.feibot.com';

  const eventUuid = normalize(body?.eventUuid || cloudConfig?.eventUuid || feibotConfig?.eventUuid);
  const scoreEventUuid = normalize(body?.scoreEventUuid || scoreConfig?.eventUuid || feibotConfig?.scoreEventUuid);
  const scoreOverviewUrl = normalize(body?.scoreOverviewUrl || scoreConfig?.overviewUrl || feibotConfig?.scoreOverviewUrl);
  const scoreProgressUrl = normalize(body?.scoreProgressUrl || scoreConfig?.progressUrl || feibotConfig?.scoreProgressUrl);

  return {
    accessKey,
    secretKey,
    apiBaseUrl,
    eventUuid,
    scoreEventUuid: scoreEventUuid || undefined,
    scoreOverviewUrl: scoreOverviewUrl || undefined,
    scoreProgressUrl: scoreProgressUrl || undefined,
  };
}

async function checkHttp(
  label: string,
  key: string,
  url: string,
  headers: HeadersInit = {},
  feibotConfig?: { apiBaseUrl: string; accessKey: string; secretKey: string },
): Promise<EndpointCheck> {
  const started = Date.now();
  try {
    const result = feibotConfig
      ? await (async () => {
          const targetUrl = new URL(url);
          const path = targetUrl.pathname;
          const query = parseQueryObject(targetUrl);
          const response = await callFeibotAPI<any>(
            {
              accountId: 'health-check',
              accessKey: feibotConfig.accessKey,
              secretKey: feibotConfig.secretKey,
              apiBaseUrl: feibotConfig.apiBaseUrl,
            },
            path,
            {
              method: 'GET',
              query,
            },
          );
          return {
            ok: response.ok,
            status: response.status,
            url,
            text: response.data ? JSON.stringify(response.data) : '',
            data: response.data,
                      diagnostics: response.diagnostics,
          };
        })()
      : await (async () => {
          const response = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
          const bodyText = await response.text();
          let parsed: any = null;
          try { parsed = JSON.parse(bodyText); } catch {}
          return { ok: response.status >= 200 && response.status < 300, status: response.status, url, text: bodyText, data: parsed, diagnostics: null };
        })();

    const bodyText = String(result.text || '');
    let parsed: any = null;
    if (result.data && typeof result.data === 'object') {
      parsed = result.data;
    } else {
      try { parsed = JSON.parse(bodyText); } catch {}
    }

    const latencyMs = Date.now() - started;
    const payloadSize = Buffer.byteLength(bodyText || '', 'utf8');
    const responseCount = Array.isArray(parsed) ? parsed.length : Array.isArray(parsed?.data) ? parsed.data.length : Array.isArray(parsed?.participants) ? parsed.participants.length : Number(parsed?.count || 0);
    const ok = !!result.ok;

    const responseSnippet = String(bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    const statusCode = Number(result.status || 0);

    let classifiedMessage = 'OK';
    if (!ok) {
      if (statusCode === 401 || statusCode === 403) {
        classifiedMessage = `Authentication/configuration rejected by Feibot (HTTP ${statusCode})`;
      } else if (statusCode === 404) {
        classifiedMessage = 'Endpoint unavailable (HTTP 404)';
      } else if (statusCode >= 500) {
        classifiedMessage = `Feibot server error (HTTP ${statusCode})`;
      } else if (statusCode >= 400) {
        classifiedMessage = `Request rejected by endpoint (HTTP ${statusCode})`;
      } else if (statusCode === 0) {
        classifiedMessage = 'Network failure while contacting endpoint';
      }
    }

    return {
      key,
      label,
      url: String(result.url || url),
      method: 'GET',
      status: ok ? 'PASS' : statusCode >= 400 && statusCode < 500 ? 'WARNING' : 'FAIL',
      httpCode: statusCode,
      latencyMs,
      payloadSize,
      responseCount,
      lastSuccess: ok ? new Date().toISOString() : null,
      lastFailure: ok ? null : new Date().toISOString(),
      message: ok ? 'OK' : `${classifiedMessage}${responseSnippet ? ` | ${responseSnippet}` : ''}`,
          signatureDiagnostics: (() => {
            const d = (result as any).diagnostics;
            if (!d?.stringToSign) return undefined;
            return {
              method: d.method || 'GET',
              path: d.path || '',
              timestamp: String(d.timestamp || ''),
              sortedQuery: d.sortedQuery || '',
              body: d.body || '',
              stringToSign: d.stringToSign,
              algorithm: d.algorithm || 'HMAC-SHA256',
              digestEncoding: d.digestEncoding || 'lowercase-hex',
              headers: d.masked || {
                'X-Feibot-AK': '****',
                'X-Feibot-Timestamp': String(d.timestamp || ''),
                'X-Feibot-Signature': '****',
              },
            };
          })(),
    };
  } catch (error) {
    return {
      key,
      label,
      url,
      method: 'GET',
      status: 'FAIL',
      httpCode: 0,
      latencyMs: Date.now() - started,
      payloadSize: 0,
      responseCount: 0,
      lastSuccess: null,
      lastFailure: new Date().toISOString(),
      message: `Network failure: ${error instanceof Error ? error.message : 'Unknown network error'}`,
    };
  }
}

async function checkHttpAny(
  label: string,
  key: string,
  urls: string[],
  headers: HeadersInit = {},
  feibotConfig?: { apiBaseUrl: string; accessKey: string; secretKey: string },
  includeSignatureDebug: boolean = false,
): Promise<EndpointCheck> {
  let best: EndpointCheck | null = null;

  for (const url of urls) {
    const result = await checkHttp(label, key, url, headers, feibotConfig);
    if (result.status === 'PASS') return result;

    if (!best) {
      best = result;
      continue;
    }

    const score = (check: EndpointCheck) => {
      if (check.httpCode === 401 || check.httpCode === 403) return 3;
      if (check.httpCode >= 500) return 2;
      if (check.httpCode >= 400) return 1;
      return 0;
    };

    if (score(result) > score(best)) best = result;
  }

  return best || {
    key,
    label,
    url: urls[0] || 'unknown',
    method: 'GET',
    status: 'FAIL',
    httpCode: 0,
    latencyMs: 0,
    payloadSize: 0,
    responseCount: 0,
    lastSuccess: null,
    lastFailure: new Date().toISOString(),
    message: 'No URL to test',
  };
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const eventId = normalize(body?.eventId);
    const checkKey = normalize(body?.checkKey);
    const cacheVariant = [normalize(body?.eventUuid), normalize(body?.apiBaseUrl), normalize(body?.scoreEventUuid)].filter(Boolean).join('|') || 'default';
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    }

    const config = await loadHealthProviderConfig(eventId, body);
    const missing = [
      !config.accessKey ? 'accessKey' : null,
      !config.secretKey ? 'secretKey' : null,
      !config.eventUuid ? 'eventUuid' : null,
    ].filter(Boolean);

    const headers: HeadersInit = { Accept: 'application/json' };
      const cached = readHealthCache(eventId, checkKey, cacheVariant);
      if (cached) {
        return NextResponse.json({ ...cached, cached: true });
      }

    const checks: EndpointCheck[] = [];
    const shouldRun = (key: string) => !checkKey || checkKey === key;

    if (shouldRun('accessKey')) checks.push({
      key: 'accessKey',
      label: 'Access Key',
      url: 'local',
      method: 'GET',
      status: config.accessKey ? 'PASS' : 'FAIL',
      httpCode: config.accessKey ? 200 : 0,
      latencyMs: 0,
      payloadSize: config.accessKey.length,
      responseCount: 0,
      lastSuccess: config.accessKey ? new Date().toISOString() : null,
      lastFailure: config.accessKey ? null : new Date().toISOString(),
      message: config.accessKey ? 'Configured' : 'Missing',
    });

    if (shouldRun('secretKey')) checks.push({
      key: 'secretKey',
      label: 'Secret Key',
      url: 'local',
      method: 'GET',
      status: config.secretKey ? 'PASS' : 'FAIL',
      httpCode: config.secretKey ? 200 : 0,
      latencyMs: 0,
      payloadSize: config.secretKey.length,
      responseCount: 0,
      lastSuccess: config.secretKey ? new Date().toISOString() : null,
      lastFailure: config.secretKey ? null : new Date().toISOString(),
      message: config.secretKey ? 'Configured' : 'Missing',
    });

    if (shouldRun('timestamp')) checks.push({
      key: 'timestamp',
      label: 'Timestamp',
      url: 'local',
      method: 'GET',
      status: 'PASS',
      httpCode: 200,
      latencyMs: 0,
      payloadSize: 10,
      responseCount: 0,
      lastSuccess: new Date().toISOString(),
      lastFailure: null,
      message: String(Math.floor(Date.now() / 1000)),
    });

    if (shouldRun('signature')) checks.push({
      key: 'signature',
      label: 'Signature Inputs',
      url: 'local',
      method: 'GET',
      status: config.accessKey && config.secretKey ? 'PASS' : 'WARNING',
      httpCode: config.accessKey && config.secretKey ? 200 : 0,
      latencyMs: 0,
      payloadSize: config.accessKey.length + config.secretKey.length,
      responseCount: 0,
      lastSuccess: config.accessKey && config.secretKey ? new Date().toISOString() : null,
      lastFailure: config.accessKey && config.secretKey ? null : new Date().toISOString(),
      message: config.accessKey && config.secretKey ? 'Key material available' : 'Missing key material',
    });

    if (missing.length === 0) {
      const base = config.apiBaseUrl.replace(/\/$/, '');
      const eventQuery = `event_uuid=${encodeURIComponent(config.eventUuid || '')}`;

      const endpointDefs = [
        {
          key: 'authentication',
          label: 'Authentication',
          optional: false,
          paths: [
            `/eventConfigFile/timingRulesGet?${eventQuery}`,
            `/temporary/participantsGetAll?${eventQuery}`,
          ],
        },
        { key: 'eventConfiguration', label: 'Event Configuration', optional: false, paths: [`/eventConfigFile/timingRulesGet?${eventQuery}`] },
        { key: 'participantsGetAll', label: 'ParticipantsGetAll', optional: false, paths: [`/temporary/participantsGetAll?${eventQuery}`] },
        { key: 'participantsQuery', label: 'ParticipantsQuery', optional: true, paths: [`/temporary/participantsQuery?${eventQuery}`] },
        {
          key: 'realtimeResults',
          label: 'Realtime Results',
          optional: false,
          paths: [
            `/temporary/temporary_ResultDataGetAll?${eventQuery}`,
          ],
        },
        { key: 'realtimeResultsQuery', label: 'Realtime Results Query', optional: true, paths: [`/temporary/temporary_ResultDataQuery?${eventQuery}`] },
        {
          key: 'finishResults',
          label: 'Finish Results',
          optional: true,
          paths: [
            `/finishResultGetAll?${eventQuery}`,
          ],
        },
        { key: 'finishResultQuery', label: 'Finish Result Query', optional: true, paths: [`/finishResultQuery?${eventQuery}`] },
        {
          key: 'raceProcess',
          label: 'Race Process',
          optional: true,
          paths: [
            `/api/processQuery?${eventQuery}`,
          ],
        },
        {
          key: 'leaderboard',
          label: 'Leaderboard',
          optional: true,
          paths: [
            `/api/leaderboardQuery?${eventQuery}`,
          ],
        },
      ];

      let authFailed = false;
      for (const endpoint of endpointDefs) {
        if (!shouldRun(endpoint.key)) continue;
        if (authFailed && endpoint.key !== 'authentication') continue;

        const endpointCheckRaw = await checkHttpAny(endpoint.label, endpoint.key, endpoint.paths.map((path) => `${base}${path}`), headers, {
          apiBaseUrl: base,
          accessKey: config.accessKey,
          secretKey: config.secretKey,
        });

        const endpointCheck = endpoint.optional ? normalizeOptionalCheck(endpointCheckRaw) : endpointCheckRaw;

        checks.push(endpointCheck);
        if (
          endpoint.key === 'authentication' &&
          (endpointCheck.httpCode === 401 || endpointCheck.httpCode === 403)
        ) {
          authFailed = true;
        }
      }

      if (config.scoreOverviewUrl && shouldRun('scoreUrl')) checks.push(await checkHttp('Score URL', 'scoreUrl', config.scoreOverviewUrl));
      if (config.scoreProgressUrl && shouldRun('progressUrl')) checks.push(await checkHttp('Progress URL', 'progressUrl', config.scoreProgressUrl));
    }

    if (checkKey && checks.length === 0) {
      return NextResponse.json({ success: false, message: `Unknown checkKey: ${checkKey}` }, { status: 400 });
    }

    const passCount = checks.filter((c) => c.status === 'PASS').length;
    const warningCount = checks.filter((c) => c.status === 'WARNING').length;
    const failCount = checks.filter((c) => c.status === 'FAIL').length;

    const requiredChecks = checks.filter((c) => REQUIRED_ENDPOINT_KEYS.has(c.key));
    const requiredPass = requiredChecks.filter((c) => c.status === 'PASS').length;
    const requiredFail = requiredChecks.filter((c) => c.status === 'FAIL').length;
    const readinessScore = Math.max(0, Math.round((requiredPass / Math.max(requiredChecks.length, 1)) * 100));

    const rateLimited = checks.some((check) => check.httpCode === 429);
    const snapshotSync = {
      success: false,
      skipped: true,
      reason: rateLimited ? 'Provider rate limit reached.' : 'Diagnostics-only mode. Run manual Sync Snapshot to import data.',
    };

    const payload = {
      success: requiredFail === 0,
      eventId,
      provider: 'feibot',
      checks,
      summary: {
        total: checks.length,
        pass: passCount,
        warning: warningCount,
        fail: failCount,
        readinessScore,
        required: {
          total: requiredChecks.length,
          pass: requiredPass,
          fail: requiredFail,
        },
      },
      configuration: {
        apiBaseUrl: config.apiBaseUrl,
        eventUuid: config.eventUuid,
        scoreUuid: config.scoreEventUuid,
        hasScoreUrl: !!config.scoreOverviewUrl,
        hasProgressUrl: !!config.scoreProgressUrl,
      },
      snapshotSync,
      testedAt: new Date().toISOString(),
    };

    if (requiredFail === 0) {
      writeHealthCache(eventId, checkKey, payload, cacheVariant);
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to run provider health check' },
      { status: 500 },
    );
  }
}
