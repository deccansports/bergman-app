import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { decryptProviderSecret } from '@/lib/liveTrackingSecret';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type DebugVariant = {
  id: string;
  algorithm: 'sha256' | 'sha1';
  signatureEncoding: 'hex' | 'base64';
  hexCase?: 'upper' | 'lower';
  label: string;
};

type HeaderCandidates = {
  accessKey: string[];
  signature: string[];
  timestamp: string[];
};

const DEFAULT_BASE_URL = 'https://apicn.feibot.com';
const DEFAULT_METHOD = 'GET';
const DEFAULT_PATH = '/eventConfigFile/timingRulesGet';

const DEFAULT_HEADER_CANDIDATES: HeaderCandidates = {
  accessKey: ['accessKey', 'AccessKey', 'X-Access-Key', 'ak'],
  signature: ['signature', 'Signature', 'sign', 'X-Signature'],
  timestamp: ['timestamp', 'Timestamp', 'ts', 'X-Timestamp'],
};

const SIGNING_VARIANTS: DebugVariant[] = [
  { id: 'v1', algorithm: 'sha256', signatureEncoding: 'hex', hexCase: 'lower', label: 'HMAC-SHA256 + HEX' },
  { id: 'v2', algorithm: 'sha256', signatureEncoding: 'base64', label: 'HMAC-SHA256 + Base64' },
  { id: 'v3', algorithm: 'sha1', signatureEncoding: 'hex', hexCase: 'lower', label: 'HMAC-SHA1 + HEX' },
  { id: 'v4', algorithm: 'sha1', signatureEncoding: 'base64', label: 'HMAC-SHA1 + Base64' },
  { id: 'v5', algorithm: 'sha256', signatureEncoding: 'hex', hexCase: 'upper', label: 'Uppercase HEX' },
  { id: 'v6', algorithm: 'sha256', signatureEncoding: 'hex', hexCase: 'lower', label: 'Lowercase HEX' },
];

function isAuthorized(req: NextRequest) {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  const token = req.headers.get('x-bergman-internal-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return token === expectedToken;
}

function pickFirstNonEmpty(...values: Array<unknown>) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeHeaderList(input: unknown, fallback: string[]) {
  if (Array.isArray(input)) {
    const normalized = input.map((value) => String(value || '').trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
  }
  if (typeof input === 'string' && input.trim()) return [input.trim()];
  return fallback;
}

function toQueryString(query: URLSearchParams) {
  const pairs = Array.from(query.entries()).sort(([a], [b]) => a.localeCompare(b));
  return pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

function buildStringToSign(method: string, path: string, timestamp: number, query: string, body = '') {
  return `${method}${path}${timestamp}${query}${body}`;
}

function signString(params: {
  value: string;
  secretKey: string;
  algorithm: 'sha256' | 'sha1';
  encoding: 'hex' | 'base64';
  hexCase?: 'upper' | 'lower';
}) {
  let digest = crypto.createHmac(params.algorithm, params.secretKey).update(params.value).digest(params.encoding);
  if (params.encoding === 'hex') {
    digest = params.hexCase === 'upper' ? digest.toUpperCase() : digest.toLowerCase();
  }
  return digest;
}

async function loadFeibotConfig(eventId: string) {
  const db = getFirestoreInstance();
  const eventRef = db.collection('events').doc(eventId);
  const eventSnap = await eventRef.get();

  if (!eventSnap.exists) {
    return null;
  }

  const data = eventSnap.data() || {};
  const hub = (data as any)?.liveTrackingHub || {};
  const feibotConfig = hub?.feibotConfig || {};
  const cloud = feibotConfig?.cloud || {};

  const accessKey = pickFirstNonEmpty(cloud?.accessKey, feibotConfig?.accessKey);
  const secretRaw = pickFirstNonEmpty(cloud?.secretKey, feibotConfig?.secretKey);
  const secretKey = secretRaw ? decryptProviderSecret(secretRaw) : '';
  const eventUuid = pickFirstNonEmpty(cloud?.eventUuid, feibotConfig?.eventUuid);
  const apiBaseUrl = pickFirstNonEmpty(cloud?.apiBaseUrl, feibotConfig?.apiBaseUrl, DEFAULT_BASE_URL);

  return {
    accessKey,
    secretKey,
    eventUuid,
    apiBaseUrl,
  };
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function executeDebugRequest(params: {
  baseUrl: string;
  method: string;
  path: string;
  query: string;
  accessKey: string;
  secretKey: string;
  timestamp: number;
  variant: DebugVariant;
  headerNames: { accessKey: string; signature: string; timestamp: string };
}) {
  const stringToSign = buildStringToSign(params.method, params.path, params.timestamp, params.query);
  const signature = signString({
    value: stringToSign,
    secretKey: params.secretKey,
    algorithm: params.variant.algorithm,
    encoding: params.variant.signatureEncoding,
    hexCase: params.variant.hexCase,
  });

  const normalizedBase = params.baseUrl.replace(/\/$/, '');
  const requestUrl = `${normalizedBase}${params.path}${params.query ? `?${params.query}` : ''}`;
  const headers = new Headers({
    [params.headerNames.accessKey]: params.accessKey,
    [params.headerNames.timestamp]: String(params.timestamp),
    [params.headerNames.signature]: signature,
    'Content-Type': 'application/json',
  });

  const requestLog = {
    method: params.method,
    url: requestUrl,
    headers: {
      [params.headerNames.accessKey]: `${params.accessKey.slice(0, 4)}***(${params.accessKey.length})`,
      [params.headerNames.timestamp]: String(params.timestamp),
      [params.headerNames.signature]: `${signature.slice(0, 10)}...(${signature.length})`,
      'Content-Type': 'application/json',
    },
  };

  console.log('[provider/debug-auth] outgoing request', requestLog);

  const startedAt = Date.now();
  const response = await fetch(requestUrl, {
    method: params.method,
    headers,
    cache: 'no-store',
  });
  const durationMs = Date.now() - startedAt;
  const bodyText = await response.text();

  return {
    requestUrl,
    stringToSign,
    signature,
    signatureLength: signature.length,
    response: {
      status: response.status,
      body: bodyText,
      bodyJson: safeJsonParse(bodyText),
      durationMs,
    },
    requestLog,
  };
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const mode = String(body?.mode || 'single').trim().toLowerCase();
    const eventId = String(body?.eventId || '').trim();

    const inlineConfig = body?.configuration && typeof body.configuration === 'object' ? body.configuration : {};
    const loadedConfig = eventId ? await loadFeibotConfig(eventId) : null;

    const baseUrl = pickFirstNonEmpty(inlineConfig?.baseUrl, loadedConfig?.apiBaseUrl, DEFAULT_BASE_URL);
    const eventUuid = pickFirstNonEmpty(inlineConfig?.eventUuid, loadedConfig?.eventUuid);
    const accessKey = pickFirstNonEmpty(inlineConfig?.accessKey, loadedConfig?.accessKey);
    const secretKey = pickFirstNonEmpty(inlineConfig?.secretKey, loadedConfig?.secretKey);

    if (!eventUuid || !accessKey || !secretKey) {
      return NextResponse.json(
        {
          success: false,
          message: 'Missing required fields: eventUuid, accessKey, secretKey',
          configuration: {
            baseUrl,
            eventUuid,
            accessKeyLength: accessKey.length,
            secretKeyLength: secretKey.length,
          },
        },
        { status: 400 },
      );
    }

    const method = String(body?.request?.method || DEFAULT_METHOD).trim().toUpperCase() || DEFAULT_METHOD;
    const path = String(body?.request?.path || DEFAULT_PATH).trim() || DEFAULT_PATH;

    const queryParams = new URLSearchParams();
    queryParams.set('event_uuid', eventUuid);
    const queryOverride = String(body?.request?.query || '').trim();
    const query = queryOverride || toQueryString(queryParams);

    const timestamp = Number(body?.request?.timestamp || Math.floor(Date.now() / 1000));

    const headerCandidates: HeaderCandidates = {
      accessKey: normalizeHeaderList(body?.headerCandidates?.accessKey, DEFAULT_HEADER_CANDIDATES.accessKey),
      signature: normalizeHeaderList(body?.headerCandidates?.signature, DEFAULT_HEADER_CANDIDATES.signature),
      timestamp: normalizeHeaderList(body?.headerCandidates?.timestamp, DEFAULT_HEADER_CANDIDATES.timestamp),
    };

    const selectedHeaderNames = {
      accessKey: String(body?.headerNames?.accessKey || headerCandidates.accessKey[0] || 'accessKey'),
      signature: String(body?.headerNames?.signature || headerCandidates.signature[0] || 'signature'),
      timestamp: String(body?.headerNames?.timestamp || headerCandidates.timestamp[0] || 'timestamp'),
    };

    const configurationSummary = {
      baseUrl,
      eventUuid,
      accessKeyLength: accessKey.length,
      secretKeyLength: secretKey.length,
    };

    if (mode !== 'variants') {
      const variant = SIGNING_VARIANTS[0];
      const execution = await executeDebugRequest({
        baseUrl,
        method,
        path,
        query,
        accessKey,
        secretKey,
        timestamp,
        variant,
        headerNames: selectedHeaderNames,
      });

      return NextResponse.json({
        success: execution.response.status >= 200 && execution.response.status < 300,
        configuration: configurationSummary,
        request: {
          method,
          path,
          query,
          timestamp,
          stringToSign: execution.stringToSign,
          signatureAlgorithm: 'HMAC-SHA256',
          signatureEncoding: 'HEX',
          signatureLength: execution.signatureLength,
        },
        headersSent: {
          AccessKey: true,
          Timestamp: true,
          Signature: true,
          'Content-Type': 'application/json',
          names: selectedHeaderNames,
        },
        response: execution.response,
        requestLog: execution.requestLog,
      });
    }

    const attempts: any[] = [];
    let successAttempt: any = null;

    for (const variant of SIGNING_VARIANTS) {
      for (const accessHeader of headerCandidates.accessKey) {
        for (const signatureHeader of headerCandidates.signature) {
          const timestampHeader = headerCandidates.timestamp[0] || 'timestamp';
          const execution = await executeDebugRequest({
            baseUrl,
            method,
            path,
            query,
            accessKey,
            secretKey,
            timestamp,
            variant,
            headerNames: {
              accessKey: accessHeader,
              signature: signatureHeader,
              timestamp: timestampHeader,
            },
          });

          const attempt = {
            variantId: variant.id,
            variant: variant.label,
            signatureAlgorithm: variant.algorithm === 'sha256' ? 'HMAC-SHA256' : 'HMAC-SHA1',
            signatureEncoding: variant.signatureEncoding === 'hex' ? 'HEX' : 'Base64',
            hexCase: variant.hexCase || null,
            headers: {
              accessKey: accessHeader,
              signature: signatureHeader,
              timestamp: timestampHeader,
            },
            request: {
              method,
              path,
              query,
              timestamp,
              stringToSign: execution.stringToSign,
              signatureLength: execution.signatureLength,
            },
            response: execution.response,
            success: execution.response.status >= 200 && execution.response.status < 300,
            requestLog: execution.requestLog,
          };

          attempts.push(attempt);
          if (!successAttempt && attempt.success) {
            successAttempt = attempt;
          }
        }
      }
    }

    return NextResponse.json({
      success: !!successAttempt,
      mode: 'variants',
      configuration: configurationSummary,
      headerCandidates,
      successfulVariant: successAttempt
        ? {
            variantId: successAttempt.variantId,
            variant: successAttempt.variant,
            signatureAlgorithm: successAttempt.signatureAlgorithm,
            signatureEncoding: successAttempt.signatureEncoding,
            headers: successAttempt.headers,
            status: successAttempt.response.status,
            durationMs: successAttempt.response.durationMs,
          }
        : null,
      attempts,
      message: successAttempt ? 'At least one signing/header variant succeeded.' : 'No signing/header variant succeeded.',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to debug Feibot authentication',
      },
      { status: 500 },
    );
  }
}
