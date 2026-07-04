/**
 * Feibot API Client
 * 
 * Handles authentication via HMAC-SHA256 headers and API communication.
 * Supports secure credential usage without exposing secrets.
 */

import crypto from 'crypto';
import { getFeibotCredentialBundle, type FeibotCredentialType } from './credentials';
import { resolveFeibotRuntimeEventUuid } from './secure-credentials';
import type { FeibotAPIConfig, FeibotEventConfig, RawFeibotArchive } from './types';

type TimingRulesGetResponse = {
  event_uuid?: string;
  timing_rules?: FeibotEventConfig;
  data?: {
    event_uuid?: string;
    timing_rules?: FeibotEventConfig;
  };
  [key: string]: any;
};

function safePrefix(value: unknown, length = 12) {
  return String(value ?? '').slice(0, length);
}

function detectCredentialTypeFromAccessKey(accessKey: unknown): 'account' | 'event' | 'unknown' {
  const key = String(accessKey ?? '');
  if (key.startsWith('fbwb_account_')) return 'account';
  if (key.startsWith('fbwb_event_')) return 'event';
  return 'unknown';
}

function isLikelyFeibotEventUuid(value: unknown) {
  const key = String(value ?? '').trim();
  if (!key) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return false;
  return key.length >= 6 && key.length <= 12;
}

function sha256Hex(value: string) {
  return crypto.createHash('sha256').update(Buffer.from(String(value ?? ''), 'utf8')).digest('hex');
}

/**
 * Build HMAC-SHA256 signature for Feibot requests
 */
function buildSignature(
  method: string,
  path: string,
  timestamp: string,
  queryString: string,
  requestBody: string,
  secretKey: string
): { signature: string; stringToSign: string } {
  const stringToSign =
    method.toUpperCase() +
    path +
    timestamp +
    queryString +
    requestBody;

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return { signature, stringToSign };
}

/**
 * Build sorted query string for HMAC signature.
 * Per Feibot spec: plain key=value pairs, alphabetically sorted, NO URL encoding.
 * Example: event_uuid=7BvuefrS&type=live → used in string-to-sign
 */
function buildSignatureQuery(query: Record<string, any>): string {
  return Object.keys(query)
    .sort()
    .filter((k) => query[k] !== undefined && query[k] !== null && String(query[k]) !== '')
    .map((k) => `${k}=${String(query[k])}`)
    .join('&');
}

/**
 * Build raw query string for the actual HTTP request URL.
 * Feibot documentation requires the sent URL to match the signed query string exactly.
 */
function buildUrlQuery(query: Record<string, any>): string {
  return Object.keys(query)
    .sort()
    .filter((k) => query[k] !== undefined && query[k] !== null && String(query[k]) !== '')
    .map((k) => `${k}=${String(query[k])}`)
    .join('&');
}

/**
 * Make an authenticated Feibot API request
 */
export async function callFeibotAPI<T>(
  config: FeibotAPIConfig,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT';
    query?: Record<string, any>;
    body?: any;
  } = {}
): Promise<{
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  diagnostics: {
    endpoint: string;
    requestUrl: string;
    method: string;
    path: string;
    timestamp: number;
    selectedEventUuid?: string;
    queryParameters: Array<{ key: string; value: string }>;
    rawQueryString: string;
    sortedQuery: string;
    body: string;
    bodyHash: string;
    stringToSign: string;
    algorithm: string;
    digestEncoding: string;
    requestSignature: string;
    signatureLength: number;
    responseTimeMs: number;
    requestHeaders: {
      'X-Feibot-AK': string;
      'X-Feibot-Timestamp': string;
      'X-Feibot-Signature': string;
      Accept: string;
      'Content-Type': string;
    };
    responseHeaders?: Record<string, string>;
    responseBodyText?: string;
    masked: { 'X-Feibot-AK': string; 'X-Feibot-Timestamp': string; 'X-Feibot-Signature': string };
    authAudit: {
      credentialType: string;
      requestedEventUuid: string | null;
      boundEventUuid: string | null;
      storedAkPrefix: string;
      storedAkLength: number;
      decryptedAkPrefix: string;
      decryptedAkLength: number;
      headerAkPrefix: string;
      headerAkLength: number;
      headerEqualsDecrypted: boolean;
      headerEqualsStored: boolean;
      signatureMatch: boolean;
      storedAkHash?: string | null;
      decryptedAkHash?: string | null;
      headerAkHash?: string | null;
    };
  };
}> {
  const method = options.method || 'GET';
  const query = options.query || {};
  const body = options.body ? JSON.stringify(options.body) : '';

  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Per Feibot spec: signature uses plain key=value (no URL encoding)
  const signatureQuery = buildSignatureQuery(query);
  // Actual HTTP URL uses properly URL-encoded params
  const urlQuery = buildUrlQuery(query);

  const { signature, stringToSign } = buildSignature(
    method,
    path,
    timestamp,
    signatureQuery,
    body,
    config.secretKey,
  );

  const recomputed = buildSignature(
    method,
    path,
    timestamp,
    signatureQuery,
    body,
    config.secretKey,
  );

  const url = `${config.apiBaseUrl}${path}${urlQuery ? `?${urlQuery}` : ''}`;
  const bodyHash = crypto.createHash('sha256').update(body || '', 'utf8').digest('hex');
  const queryParameters = Object.keys(query)
    .sort()
    .filter((k) => query[k] !== undefined && query[k] !== null && String(query[k]) !== '')
    .map((key) => ({ key, value: String(query[key]) }));
  const selectedEventUuid = String((query as any)?.event_uuid ?? '').trim() || undefined;

  // Masked values for safe frontend display
  const maskedAk = config.accessKey.length > 6
    ? `${config.accessKey.slice(0, 4)}${'*'.repeat(Math.max(6, config.accessKey.length - 6))}${config.accessKey.slice(-2)}`
    : '****';
  const maskedSig = `${signature.slice(0, 8)}****`;

  const requestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Feibot-AK': config.accessKey,
    'X-Feibot-Timestamp': timestamp,
    'X-Feibot-Signature': signature,
  };
  
  const startTime = Date.now();

  const credentialType = config.credentialMeta?.credentialType || 'unknown';
  const boundEventUuid = String(config.credentialMeta?.boundEventUuid || '').trim() || null;
  const requestedEventUuid = selectedEventUuid || String(config.credentialMeta?.requestedEventUuid || '').trim() || null;
  const storedAk = String(config.credentialMeta?.storedAccessKeyRaw || '');
  const decryptedAk = String(config.credentialMeta?.decryptedAccessKey || config.accessKey || '');
  const headerAk = String(requestHeaders['X-Feibot-AK'] || '');
  const storedAkHash = storedAk ? sha256Hex(storedAk) : '';
  const decryptedAkHash = decryptedAk ? sha256Hex(decryptedAk) : '';
  const headerAkHash = headerAk ? sha256Hex(headerAk) : '';
  const headerEqualsStored = storedAk ? headerAk === storedAk : false;
  const headerEqualsDecrypted = headerAk === decryptedAk;
  const signatureMatch = recomputed.signature === signature;

  console.log('[FEIBOT AUTH DIAGNOSTICS][REQUEST]', {
    credentialType,
    requestedEventUuid,
    boundEventUuid,
    storedAkPrefix: safePrefix(storedAk),
    storedAkLength: storedAk.length,
    decryptedAkPrefix: safePrefix(decryptedAk),
    decryptedAkLength: decryptedAk.length,
    headerAkPrefix: safePrefix(headerAk),
    headerAkLength: headerAk.length,
    headerEqualsDecrypted,
    headerEqualsStored,
    storedAkHash: storedAkHash ? `${storedAkHash.slice(0, 12)}...` : null,
    decryptedAkHash: decryptedAkHash ? `${decryptedAkHash.slice(0, 12)}...` : null,
    headerAkHash: headerAkHash ? `${headerAkHash.slice(0, 12)}...` : null,
    method,
    path,
    sortedQuery: signatureQuery,
    timestamp,
    stringToSign,
    generatedSignature: maskedSig,
    recomputedSignature: `${recomputed.signature.slice(0, 8)}****`,
    signatureMatch,
    requestUrl: url,
  });

  console.log('[FEIBOT REQUEST]', {
    endpoint: path,
    method,
    path,
    eventUuid: selectedEventUuid || null,
    credentialType,
    accessKeyPrefix: safePrefix(config.accessKey, 16),
    credentialSource: config.credentialMeta?.source || null,
    requestUrl: url,
    queryParameters,
    rawQueryString: signatureQuery,
    timestamp,
    rawBody: body || '',
    stringToSign,
    generatedSignature: signature,
    signatureLength: signature.length,
    bodyHash,
    selectedEventUuid,
    accessKey: maskedAk,
    credentialIntegrity: {
      accessKeyCharLength: config.accessKey.length,
      accessKeyByteLength: Buffer.byteLength(config.accessKey, 'utf8'),
      secretKeyCharLength: config.secretKey.length,
      secretKeyByteLength: Buffer.byteLength(config.secretKey, 'utf8'),
      headerAccessKeyMatchesConfig: requestHeaders['X-Feibot-AK'] === config.accessKey,
      signatureRecomputedMatches: signatureMatch,
    },
  });
  
  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: method === 'GET' ? undefined : body,
      cache: 'no-store',
    });
    
    const responseTime = Date.now() - startTime;
    const text = await response.text();
    const responseHeaders = Object.fromEntries(response.headers.entries());
    
    let data: T | null = null;
    let error: string | undefined;
    
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      error = `Invalid JSON response: ${text.substring(0, 100)}`;
    }
    
    if (!response.ok) {
      console.error('[FEIBOT RESPONSE ERROR]', {
        endpoint: path,
        status: response.status,
        statusText: response.statusText,
        eventUuid: selectedEventUuid || null,
        credentialType,
        accessKeyPrefix: safePrefix(config.accessKey, 16),
        requestUrl: url,
        responseHeaders,
        body: text,
      });
    }

    console.log('[FEIBOT RESPONSE]', {
      endpoint: path,
      status: response.status,
      statusText: response.statusText,
      eventUuid: selectedEventUuid || null,
      credentialType,
      accessKeyPrefix: safePrefix(config.accessKey, 16),
      requestUrl: url,
      responseLength: text.length,
      responseHeaders,
      responseBody: text,
    });

    console.log('[FEIBOT AUTH DIAGNOSTICS][RESPONSE]', {
      credentialType,
      requestedEventUuid,
      boundEventUuid,
      headerAkPrefix: safePrefix(headerAk),
      headerAkLength: headerAk.length,
      headerEqualsDecrypted,
      headerEqualsStored,
      signatureMatch,
      requestUrl: url,
      httpStatus: response.status,
      responseBody: text,
    });

    return {
      ok: response.ok,
      status: response.status,
      data,
        error: !response.ok ? (error || `HTTP ${response.status}`) : undefined,
        diagnostics: {
          endpoint: url,
          requestUrl: url,
          method,
          path,
          timestamp: Number(timestamp),
          selectedEventUuid,
          queryParameters,
          rawQueryString: signatureQuery,
          sortedQuery: signatureQuery,
          body: body || '',
          bodyHash,
          stringToSign,
          algorithm: 'HMAC-SHA256',
          digestEncoding: 'lowercase-hex',
          requestSignature: signature,
          signatureLength: signature.length,
          responseTimeMs: responseTime,
          requestHeaders,
          responseHeaders,
          responseBodyText: text,
          masked: {
            'X-Feibot-AK': maskedAk,
            'X-Feibot-Timestamp': timestamp,
            'X-Feibot-Signature': maskedSig,
          },
          authAudit: {
            credentialType,
            requestedEventUuid,
            boundEventUuid,
            storedAkPrefix: safePrefix(storedAk),
            storedAkLength: storedAk.length,
            decryptedAkPrefix: safePrefix(decryptedAk),
            decryptedAkLength: decryptedAk.length,
            headerAkPrefix: safePrefix(headerAk),
            headerAkLength: headerAk.length,
            headerEqualsDecrypted,
            headerEqualsStored,
            signatureMatch,
            storedAkHash: storedAkHash ? `${storedAkHash.slice(0, 12)}...` : null,
            decryptedAkHash: decryptedAkHash ? `${decryptedAkHash.slice(0, 12)}...` : null,
            headerAkHash: headerAkHash ? `${headerAkHash.slice(0, 12)}...` : null,
          },
        },
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    return {
      ok: false,
      status: 0,
      data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        diagnostics: {
          endpoint: url,
          requestUrl: url,
          method,
          path,
          timestamp: Number(timestamp),
          selectedEventUuid,
          queryParameters,
          rawQueryString: signatureQuery,
          sortedQuery: signatureQuery,
          body: body || '',
          bodyHash,
          stringToSign,
          algorithm: 'HMAC-SHA256',
          digestEncoding: 'lowercase-hex',
          requestSignature: signature,
          signatureLength: signature.length,
          responseTimeMs: responseTime,
          requestHeaders,
          masked: {
            'X-Feibot-AK': maskedAk,
            'X-Feibot-Timestamp': timestamp,
            'X-Feibot-Signature': maskedSig,
          },
          authAudit: {
            credentialType,
            requestedEventUuid,
            boundEventUuid,
            storedAkPrefix: safePrefix(storedAk),
            storedAkLength: storedAk.length,
            decryptedAkPrefix: safePrefix(decryptedAk),
            decryptedAkLength: decryptedAk.length,
            headerAkPrefix: safePrefix(headerAk),
            headerAkLength: headerAk.length,
            headerEqualsDecrypted,
            headerEqualsStored,
            signatureMatch,
            storedAkHash: storedAkHash ? `${storedAkHash.slice(0, 12)}...` : null,
            decryptedAkHash: decryptedAkHash ? `${decryptedAkHash.slice(0, 12)}...` : null,
            headerAkHash: headerAkHash ? `${headerAkHash.slice(0, 12)}...` : null,
          },
        },
    };
  }
}

export async function callFeibotAPIWithCredentialFallback<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT';
    query?: Record<string, any>;
    body?: any;
  } = {},
  credentialOptions: {
    eventId?: string;
    credentialType?: FeibotCredentialType;
    apiBaseUrl?: string;
    accountId?: string;
  } = {},
): Promise<{
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  retry?: {
    attempted: boolean;
    firstCredentialType?: 'event' | 'account' | null;
    secondCredentialType?: 'event' | 'account' | null;
    reason?: string;
  };
  diagnostics: any;
}> {
  const requestEventUuid = options.query?.event_uuid ? String(options.query.event_uuid).trim() : '';
  const requestedMode = credentialOptions.credentialType || 'auto';

  if (requestEventUuid && !isLikelyFeibotEventUuid(requestEventUuid)) {
    return {
      ok: false,
      status: 400,
      data: null,
      error: 'Invalid event_uuid. Rejecting Firestore document IDs.',
      retry: { attempted: false, firstCredentialType: null, secondCredentialType: null, reason: 'Invalid Feibot event_uuid format' },
      diagnostics: {
        reason: 'Invalid Feibot event_uuid format',
        requestedEventUuid: requestEventUuid,
        requestedMode,
      },
    };
  }

  let bundle: Awaited<ReturnType<typeof getFeibotCredentialBundle>>;
  try {
    bundle = await getFeibotCredentialBundle({
      eventId: credentialOptions.eventId,
      eventUuid: requestEventUuid || undefined,
      credentialType: requestedMode,
    });
  } catch (error) {
    return {
      ok: false,
      status: 400,
      data: null,
      error: error instanceof Error ? error.message : 'Credential validation failed',
      retry: { attempted: false, firstCredentialType: null, secondCredentialType: null, reason: 'Credential validation failed before dispatch' },
      diagnostics: {
        reason: error instanceof Error ? error.message : 'Credential validation failed before dispatch',
        requestedMode,
        requestedEventUuid: requestEventUuid || null,
      },
    };
  }

  const makeConfig = (credential: NonNullable<typeof bundle.selected>) => ({
    accountId: credentialOptions.accountId || credential.accountId,
    accessKey: credential.accessKey,
    secretKey: credential.secretKey,
    apiBaseUrl: credentialOptions.apiBaseUrl || credential.apiBaseUrl,
    credentialMeta: {
      credentialType: credential.credentialType,
      requestedEventUuid: options.query?.event_uuid ? String(options.query.event_uuid).trim() : undefined,
      boundEventUuid: credential.eventUuid,
      storedAccessKeyRaw: credential.storedAccessKeyRaw,
      storedSecretKeyRaw: credential.storedSecretKeyRaw,
      decryptedAccessKey: credential.accessKey,
      decryptedSecretKey: credential.secretKey,
      source: credential.source,
    },
  });

  const first = (bundle.selected || bundle.event || bundle.account) as NonNullable<typeof bundle.selected> | null;
  if (!first) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: requestedMode === 'event'
        ? 'Missing Event Credential'
        : requestedMode === 'account'
          ? 'Missing Account Credential'
          : 'Feibot credentials not configured',
      retry: { attempted: false, firstCredentialType: null, secondCredentialType: null, reason: 'No credentials available' },
      diagnostics: {
        reason: 'No credentials available',
        requestedMode,
        requestedEventUuid: requestEventUuid || null,
      },
    };
  }

  const firstAkPrefix = safePrefix(first.accessKey, 16);
  const firstBoundEventUuid = String(first.eventUuid || '').trim() || null;
  const actualCredentialType = detectCredentialTypeFromAccessKey(first.accessKey);
  const runtimeResolution = resolveFeibotRuntimeEventUuid({
    endpoint: path,
    credentialType: first.credentialType,
    credentialBoundEventUuid: firstBoundEventUuid,
    cloudEventUuid: String((credentialOptions as any)?.cloudEventUuid || '').trim() || null,
    providerEventUuid: String((credentialOptions as any)?.providerEventUuid || '').trim() || null,
    manualEventUuid: String((credentialOptions as any)?.manualEventUuid || requestEventUuid || '').trim() || null,
    requestedEventUuid: String((credentialOptions as any)?.requestedEventUuid || requestEventUuid || '').trim() || null,
  });
  const resolvedEventUuid = runtimeResolution.resolvedEventUuid || null;

  if (first.credentialType === 'event' && resolvedEventUuid !== firstBoundEventUuid) {
    throw new Error('Runtime resolved incorrect Event UUID for Event Credential');
  }

  if (actualCredentialType === 'unknown') {
    return {
      ok: false,
      status: 400,
      data: null,
      error: 'Credential Type Mismatch',
      retry: { attempted: false, firstCredentialType: first.credentialType, secondCredentialType: null, reason: 'Unknown AK prefix' },
      diagnostics: {
        reason: 'Unknown AK prefix',
        requestedMode,
        selectedCredentialType: first.credentialType,
        actualCredentialType,
        accessKeyPrefix: firstAkPrefix,
      },
    };
  }

  if (first.credentialType !== actualCredentialType) {
    return {
      ok: false,
      status: 400,
      data: null,
      error: 'Credential Resolver Bug',
      retry: { attempted: false, firstCredentialType: first.credentialType, secondCredentialType: null, reason: 'Selected credential type does not match AK prefix' },
      diagnostics: {
        reason: 'Selected credential type does not match AK prefix',
        requestedMode,
        selectedCredentialType: first.credentialType,
        actualCredentialType,
        accessKeyPrefix: firstAkPrefix,
      },
    };
  }

  if (requestedMode === 'account' && first.credentialType !== 'account') {
    return {
      ok: false,
      status: 400,
      data: null,
      error: 'Credential Type Mismatch',
      retry: { attempted: false, firstCredentialType: first.credentialType, secondCredentialType: null, reason: 'Requested ACCOUNT mode but selected non-account credential' },
      diagnostics: {
        reason: 'Requested ACCOUNT mode but selected non-account credential',
        requestedMode,
        selectedCredentialType: first.credentialType,
        actualCredentialType,
        accessKeyPrefix: firstAkPrefix,
      },
    };
  }

  if (requestedMode === 'event' && first.credentialType !== 'event') {
    return {
      ok: false,
      status: 400,
      data: null,
      error: 'Credential Type Mismatch',
      retry: { attempted: false, firstCredentialType: first.credentialType, secondCredentialType: null, reason: 'Requested EVENT mode but selected non-event credential' },
      diagnostics: {
        reason: 'Requested EVENT mode but selected non-event credential',
        requestedMode,
        selectedCredentialType: first.credentialType,
        actualCredentialType,
        accessKeyPrefix: firstAkPrefix,
      },
    };
  }

  const eventUuidMatch = first.credentialType === 'event'
    ? Boolean(requestEventUuid && firstBoundEventUuid && requestEventUuid === firstBoundEventUuid)
    : null;

  console.log('[Credential Selected]', {
    requestedMode,
    resolvedMode: bundle.selectedMode,
    credentialType: first.credentialType,
    actualCredentialType,
    credentialSource: first.source,
    accessKeyPrefix: firstAkPrefix,
    eventUuid: requestEventUuid || null,
    boundEventUuid: firstBoundEventUuid,
  });

  console.log('[FEIBOT CREDENTIAL BINDING CHECK]', {
    credentialType: first.credentialType,
    akPrefix: firstAkPrefix,
    storedBoundEventUuid: firstBoundEventUuid,
    requestedEventUuid: requestEventUuid || null,
    eventUuidMatch,
  });

  console.log('[FEIBOT REQUEST RESOLUTION]', {
    endpoint: path,
    credentialType: first.credentialType,
    credentialBoundEventUuid: firstBoundEventUuid,
    cloudEventUuid: String((credentialOptions as any)?.cloudEventUuid || '') || null,
    manualEventUuid: String((credentialOptions as any)?.manualEventUuid || requestEventUuid || '') || null,
    resolvedEventUuid,
  });

  const resolvedQuery = {
    ...(options.query || {}),
    ...(resolvedEventUuid ? { event_uuid: resolvedEventUuid } : {}),
  };

  const result = await callFeibotAPI<T>(makeConfig(first), path, {
    ...options,
    query: resolvedQuery,
  });

  // Do not hide provider errors via automatic credential retries.
  return {
    ...result,
    retry: {
      attempted: false,
      firstCredentialType: first.credentialType,
      secondCredentialType: null,
      reason: undefined,
    },
  };
}

/**
 * Test Feibot API connection
 */
export async function testFeibotConnection(
  config: FeibotAPIConfig
): Promise<{
  success: boolean;
  statusCode?: number;
  message: string;
}> {
  void config;
  return {
    success: false,
    statusCode: 400,
    message: 'Connection test via /eventConfigFile/eventsList is disabled because the endpoint is undocumented. Use event-scoped checks instead.',
  };
}

/**
 * Fetch event configuration (timing rules) from Feibot
 */
export async function fetchEventConfiguration(
  config: FeibotAPIConfig,
  eventUuid: string,
  credentialOptions: { eventId?: string; credentialType?: FeibotCredentialType } = {}
): Promise<{
  ok: boolean;
  status: number;
  data: FeibotEventConfig | null;
  error?: string;
  diagnostics: any;
}> {
  const result = await callFeibotAPIWithCredentialFallback<TimingRulesGetResponse>(
    '/eventConfigFile/timingRulesGet',
    { method: 'GET', query: { event_uuid: eventUuid } },
    { apiBaseUrl: config.apiBaseUrl, eventId: credentialOptions.eventId, credentialType: credentialOptions.credentialType },
  );
  const normalized = (result.data as TimingRulesGetResponse | null)?.timing_rules
    || (result.data as TimingRulesGetResponse | null)?.data?.timing_rules
    || null;

  return {
    ok: result.ok,
    status: result.status,
    data: normalized,
    error: result.error,
    diagnostics: result.diagnostics,
  };
}

/**
 * Fetch timing rules from Feibot using the documented wrapper response.
 * Returns the raw payload with event_uuid and timing_rules.
 */
export async function fetchTimingRules(
  config: FeibotAPIConfig,
  eventUuid: string,
  credentialOptions: { eventId?: string; credentialType?: FeibotCredentialType } = {}
): Promise<{
  ok: boolean;
  status: number;
  data: TimingRulesGetResponse | null;
  error?: string;
  diagnostics: any;
}> {
  const result = await callFeibotAPIWithCredentialFallback<TimingRulesGetResponse>(
    '/eventConfigFile/timingRulesGet',
    { method: 'GET', query: { event_uuid: eventUuid } },
    { apiBaseUrl: config.apiBaseUrl, eventId: credentialOptions.eventId, credentialType: credentialOptions.credentialType },
  );

  return {
    ok: result.ok,
    status: result.status,
    data: result.data,
    error: result.error,
    diagnostics: result.diagnostics,
  };
}

/**
 * Fetch participants from Feibot
 */
export async function fetchParticipants(
  config: FeibotAPIConfig,
  eventUuid: string,
  credentialOptions: { eventId?: string; credentialType?: FeibotCredentialType } = {}
): Promise<{
  ok: boolean;
  status: number;
  data: any[] | null;
  error?: string;
  diagnostics: any;
}> {
  const result = await callFeibotAPIWithCredentialFallback<any[]>(
    '/temporary/participantsGetAll',
    { method: 'GET', query: { event_uuid: eventUuid } },
    { apiBaseUrl: config.apiBaseUrl, eventId: credentialOptions.eventId, credentialType: credentialOptions.credentialType },
  );
  
  return {
    ok: result.ok,
    status: result.status,
    data: result.data,
    error: result.error,
    diagnostics: result.diagnostics,
  };
}

/**
 * Fetch one or more participants using the documented participantsQuery endpoint.
 * Query params are signed and sent exactly as provided, in alphabetical order.
 */
export async function fetchParticipantsQuery(
  config: FeibotAPIConfig,
  params: {
    event_uuid: string;
    bib?: string;
    chip_code?: string;
    name?: string;
    id_code?: string;
  },
  credentialOptions: { eventId?: string; credentialType?: FeibotCredentialType } = {}
): Promise<{
  ok: boolean;
  status: number;
  data: any;
  error?: string;
  diagnostics: any;
}> {
  const result = await callFeibotAPIWithCredentialFallback<any>(
    '/temporary/participantsQuery',
    { method: 'GET', query: params },
    { apiBaseUrl: config.apiBaseUrl, eventId: credentialOptions.eventId, credentialType: credentialOptions.credentialType },
  );

  return {
    ok: result.ok,
    status: result.status,
    data: result.data,
    error: result.error,
    diagnostics: result.diagnostics,
  };
}

/**
 * Fetch results from Feibot
 */
export async function fetchResults(
  config: FeibotAPIConfig,
  eventUuid: string,
  credentialOptions: { eventId?: string; credentialType?: FeibotCredentialType } = {}
): Promise<{
  ok: boolean;
  status: number;
  data: any[] | null;
  error?: string;
  diagnostics: any;
}> {
  const result = await callFeibotAPIWithCredentialFallback<any[]>(
    '/temporary/temporary_ResultDataGetAll',
    { method: 'GET', query: { event_uuid: eventUuid } },
    { apiBaseUrl: config.apiBaseUrl, eventId: credentialOptions.eventId, credentialType: credentialOptions.credentialType },
  );
  
  return {
    ok: result.ok,
    status: result.status,
    data: result.data,
    error: result.error,
    diagnostics: result.diagnostics,
  };
}
