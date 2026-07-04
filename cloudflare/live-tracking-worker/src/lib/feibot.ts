import type { FeibotConfig, WorkerEnv } from '../types';
import {
  FEIBOT_CLOUD_API_BASE_URL,
  buildFeibotHeaders,
  buildFeibotRequestUrl,
  buildSortedQueryString,
  getUnixTimestampSeconds,
  signRequest,
} from './signing';

const RETRY_BACKOFF_MS = [1000, 2000, 5000] as const;

type FeibotCallContext = {
  env?: WorkerEnv;
  eventId?: string;
  endpointName?: string;
  timeoutMs?: number;
  maxAttempts?: number;
};

type FeibotDiagnosticsRecord = {
  endpoint: string;
  requestUrl: string;
  baseUrl: string;
  path: string;
  query: string;
  method: string;
  timestamp: number;
  durationMs: number;
  httpStatus: number;
  success: boolean;
  requestBytes: number;
  responseBytes: number;
  performance: {
    dnsMs: number | null;
    connectionMs: number | null;
    tlsMs: number | null;
    requestMs: number;
    responseMs: number;
    totalMs: number;
  };
  recommendation?: string;
  message?: string;
  stringToSign?: string;
  signatureLength?: number;
};

export class FeibotApiError extends Error {
  httpStatus: number;
  endpoint: string;
  requestUrl: string;
  recommendation: string;
  retryable: boolean;
  diagnostics: FeibotDiagnosticsRecord;

  constructor(params: {
    message: string;
    httpStatus: number;
    endpoint: string;
    requestUrl: string;
    recommendation: string;
    retryable: boolean;
    diagnostics: FeibotDiagnosticsRecord;
  }) {
    super(params.message);
    this.name = 'FeibotApiError';
    this.httpStatus = params.httpStatus;
    this.endpoint = params.endpoint;
    this.requestUrl = params.requestUrl;
    this.recommendation = params.recommendation;
    this.retryable = params.retryable;
    this.diagnostics = params.diagnostics;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEndpointName(path: string) {
  const cleanPath = String(path || '').split('?')[0];
  const segments = cleanPath.split('/').filter(Boolean);
  return segments[segments.length - 1] || 'unknown';
}

function normalizeFeibotBaseUrl() {
  return FEIBOT_CLOUD_API_BASE_URL;
}

function mapStatusMessage(status: number) {
  if (status === 200) return 'PASS';
  if (status === 400) return 'Bad Request';
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not Found';
  if (status === 408) return 'Timeout';
  if (status === 429) return 'Rate Limited';
  if (status >= 500) return 'Server Error';
  return 'Request Failed';
}

function mapRecommendation(status: number) {
  if (status === 401 || status === 403) return 'Verify Access Key, Secret Key and Event UUID.';
  if (status === 404) return 'Verify API path and event UUID.';
  if (status === 429) return 'Rate limited by Feibot. Retry with backoff.';
  if (status === 408 || status >= 500) return 'Transient provider issue. Retry recommended.';
  if (status === 400) return 'Check request query/body format.';
  return 'Check provider connectivity and configuration.';
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500 || status === 502 || status === 503;
}

function toRequestBody(body: unknown, method: string) {
  if (String(method || 'GET').toUpperCase() === 'GET') return '';
  if (!body) return '';
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

async function mergeKvJson(env: WorkerEnv, key: string, patch: Record<string, unknown>) {
  const currentRaw = await env.BERGMAN_KV.get(key);
  const current = currentRaw ? (JSON.parse(currentRaw) as Record<string, unknown>) : {};
  const next = { ...current, ...patch };
  await env.BERGMAN_KV.put(key, JSON.stringify(next));
  return next;
}

async function persistDiagnostics(env: WorkerEnv, eventId: string, record: FeibotDiagnosticsRecord) {
  const nowIso = new Date().toISOString();
  const statusText = mapStatusMessage(record.httpStatus);
  const authState = record.success ? 'verified' : record.httpStatus === 401 || record.httpStatus === 403 ? 'failed' : 'unknown';
  const cloudStatus = record.success ? 'PASS' : record.httpStatus === 401 || record.httpStatus === 403 ? 'FAILED' : 'ERROR';

  await mergeKvJson(env, `live:event:${eventId}:provider-diagnostics`, {
    authentication: authState,
    authenticationState: {
      status: authState,
      checkedAt: nowIso,
      lastSuccess: record.success ? nowIso : null,
      lastFailure: record.success ? null : nowIso,
      lastStatusCode: record.httpStatus,
      lastError: record.success ? null : record.message || statusText,
    },
    cloudApi: {
      status: cloudStatus,
      checkedAt: nowIso,
      statusCode: record.httpStatus,
    },
    responseTimeMs: record.durationMs,
    durationMs: record.durationMs,
    endpoint: record.endpoint,
    message: record.success ? undefined : record.message || statusText,
    lastTestAt: nowIso,
    lastSuccessAt: record.success ? nowIso : undefined,
    lastFailureAt: record.success ? undefined : nowIso,
    lastApiCall: {
      endpoint: record.endpoint,
      durationMs: record.durationMs,
      responseTimeMs: record.durationMs,
      status: record.httpStatus,
      success: record.success,
      timestamp: nowIso,
      requestUrl: record.requestUrl,
      baseUrl: record.baseUrl,
      path: record.path,
      query: record.query,
      unixTimestamp: record.timestamp,
      stringToSign: record.stringToSign,
      signatureLength: record.signatureLength,
    },
    lastError: record.success
      ? null
      : {
          status: record.httpStatus,
          message: statusText,
          endpoint: record.endpoint,
          timestamp: nowIso,
          recommendation: record.recommendation,
        },
  });

  await mergeKvJson(env, `live:event:${eventId}:monitoring`, {
    providerResponseMs: record.durationMs,
    performance: {
      providerResponseMs: record.durationMs,
      requestBytes: record.requestBytes,
      responseBytes: record.responseBytes,
      dnsMs: record.performance.dnsMs,
      connectionMs: record.performance.connectionMs,
      tlsMs: record.performance.tlsMs,
      requestMs: record.performance.requestMs,
      responseMs: record.performance.responseMs,
      totalMs: record.performance.totalMs,
    },
    lastSync: nowIso,
    lastApiCall: {
      endpoint: record.endpoint,
      httpStatus: record.httpStatus,
      durationMs: record.durationMs,
      requestUrl: record.requestUrl,
      baseUrl: record.baseUrl,
      path: record.path,
      query: record.query,
      unixTimestamp: record.timestamp,
      stringToSign: record.stringToSign,
      signatureLength: record.signatureLength,
      success: record.success,
      timestamp: nowIso,
    },
  });

  const historyKey = `live:event:${eventId}:provider-api-history`;
  const rawHistory = await env.BERGMAN_KV.get(historyKey);
  const history = rawHistory ? (JSON.parse(rawHistory) as FeibotDiagnosticsRecord[]) : [];
  history.push(record);
  const trimmed = history.slice(-100);
  await env.BERGMAN_KV.put(historyKey, JSON.stringify(trimmed));
}

export async function callFeibot<T>(params: {
  config: FeibotConfig;
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, unknown> | URLSearchParams | string;
  body?: unknown;
  init?: RequestInit;
  context?: FeibotCallContext;
}): Promise<T> {
  const method = String(params.method || 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE';
  const path = String(params.endpoint || '/').split('?')[0];
  const sortedQueryString = buildSortedQueryString(
    params.query ?? (String(params.endpoint || '').includes('?') ? String(params.endpoint).split('?')[1] : ''),
  );
  const endpointName = params.context?.endpointName || getEndpointName(path);

  const accessKey = String(params.config?.accessKey || '').trim();
  const secretKey = String(params.config?.secretKey || '').trim();
  const eventUuid = String(params.config?.eventUuid || '').trim();
  if (!accessKey || !secretKey || !eventUuid) {
    throw new FeibotApiError({
      message: 'Feibot configuration is incomplete.',
      httpStatus: 400,
      endpoint: endpointName,
      requestUrl: buildFeibotRequestUrl(path, sortedQueryString, normalizeFeibotBaseUrl()),
      recommendation: 'Verify Access Key, Secret Key and Event UUID.',
      retryable: false,
      diagnostics: {
        endpoint: endpointName,
        requestUrl: buildFeibotRequestUrl(path, sortedQueryString, normalizeFeibotBaseUrl()),
        baseUrl: normalizeFeibotBaseUrl(),
        path,
        query: sortedQueryString,
        method,
        timestamp: Math.floor(Date.now() / 1000),
        durationMs: 0,
        httpStatus: 400,
        success: false,
        requestBytes: 0,
        responseBytes: 0,
        performance: { dnsMs: null, connectionMs: null, tlsMs: null, requestMs: 0, responseMs: 0, totalMs: 0 },
        recommendation: 'Verify Access Key, Secret Key and Event UUID.',
        message: 'Feibot configuration is incomplete.',
      },
    });
  }

  const requestBody = toRequestBody(params.body, method);
  const requestBytes = new TextEncoder().encode(requestBody || '').length;
  const timeoutMs = Number(params.context?.timeoutMs || 30000);
  const maxAttempts = Math.min(Math.max(1, Number(params.context?.maxAttempts || 3)), 3);
  const baseUrl = normalizeFeibotBaseUrl();
  const requestUrl = buildFeibotRequestUrl(path, sortedQueryString, baseUrl);

  let lastError: FeibotApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timestamp = getUnixTimestampSeconds();
    const { signature, payload } = await signRequest({
      method,
      path,
      timestamp,
      sortedQueryString,
      body: requestBody,
      secretKey,
    });
    const headers = {
      ...buildFeibotHeaders({ accessKey, timestamp, signature }),
      ...(params.init?.headers || {}),
    };

    const startedAt = Date.now();
    const requestStartedAt = startedAt;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort('timeout'), timeoutMs);

    try {
      const response = await fetch(requestUrl, {
        method,
        ...params.init,
        headers,
        body: requestBody || undefined,
        signal: abortController.signal,
      });

      const responseReceivedAt = Date.now();
      const rawText = await response.text();
      const completedAt = Date.now();
      const responseBytes = new TextEncoder().encode(rawText || '').length;
      const durationMs = completedAt - startedAt;
      const parsed = rawText ? JSON.parse(rawText) : null;

      const diagnostics: FeibotDiagnosticsRecord = {
        endpoint: endpointName,
        requestUrl,
        baseUrl,
        path,
        query: sortedQueryString,
        method,
        timestamp: Number(timestamp),
        durationMs,
        httpStatus: response.status,
        success: response.ok,
        requestBytes,
        responseBytes,
        performance: {
          dnsMs: null,
          connectionMs: null,
          tlsMs: null,
          requestMs: responseReceivedAt - requestStartedAt,
          responseMs: completedAt - responseReceivedAt,
          totalMs: durationMs,
        },
        stringToSign: payload,
        signatureLength: signature.length,
      };

      if (params.context?.env && params.context?.eventId) {
        await persistDiagnostics(params.context.env, params.context.eventId, diagnostics);
      }

      if (!response.ok) {
        const statusMessage = mapStatusMessage(response.status);
        const recommendation = mapRecommendation(response.status);
        const retryable = isRetryableStatus(response.status);
        const error = new FeibotApiError({
          message: `Feibot API error ${response.status}: ${statusMessage} ; stringToSign=${payload}`,
          httpStatus: response.status,
          endpoint: endpointName,
          requestUrl,
          recommendation,
          retryable,
          diagnostics: {
            ...diagnostics,
            recommendation,
            message: statusMessage,
            stringToSign: payload,
          },
        });
        lastError = error;
        if (!retryable || attempt >= maxAttempts) throw error;
        await sleep(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]);
        continue;
      }

      return parsed as T;
    } catch (error) {
      const completedAt = Date.now();
      const durationMs = completedAt - startedAt;
      const isTimeout = String((error as any)?.name || '').toLowerCase() === 'aborterror' || String(error || '').includes('timeout');
      const httpStatus = isTimeout ? 408 : 0;
      const statusMessage = isTimeout ? 'Timeout' : 'Connection Error';
      const recommendation = isTimeout
        ? 'Request timed out. Retry recommended.'
        : 'Check network connectivity to Feibot Cloud API.';
      const diagnostics: FeibotDiagnosticsRecord = {
        endpoint: endpointName,
        requestUrl,
        baseUrl,
        path,
        query: sortedQueryString,
        method,
        timestamp: Number(timestamp),
        durationMs,
        httpStatus,
        success: false,
        requestBytes,
        responseBytes: 0,
        performance: {
          dnsMs: null,
          connectionMs: null,
          tlsMs: null,
          requestMs: durationMs,
          responseMs: 0,
          totalMs: durationMs,
        },
        recommendation,
        message: statusMessage,
        stringToSign: payload,
        signatureLength: signature.length,
      };

      if (params.context?.env && params.context?.eventId) {
        await persistDiagnostics(params.context.env, params.context.eventId, diagnostics);
      }

      const normalizedError = error instanceof FeibotApiError
        ? error
        : new FeibotApiError({
            message: `Feibot API error ${httpStatus || 0}: ${statusMessage} ; stringToSign=${payload}`,
            httpStatus,
            endpoint: endpointName,
            requestUrl,
            recommendation,
            retryable: isTimeout || httpStatus === 0,
            diagnostics,
          });
      lastError = normalizedError;

      const retryable = normalizedError.retryable || normalizedError.httpStatus === 429 || normalizedError.httpStatus >= 500 || normalizedError.httpStatus === 0;
      if (!retryable || attempt >= maxAttempts) {
        throw normalizedError;
      }

      await sleep(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  if (lastError) throw lastError;
  throw new FeibotApiError({
    message: 'Feibot request failed',
    httpStatus: 0,
    endpoint: endpointName,
    requestUrl,
    recommendation: 'Check provider connectivity and configuration.',
    retryable: true,
    diagnostics: {
      endpoint: endpointName,
      requestUrl,
      baseUrl,
      path,
      query: sortedQueryString,
      method,
      timestamp: Math.floor(Date.now() / 1000),
      durationMs: 0,
      httpStatus: 0,
      success: false,
      requestBytes,
      responseBytes: 0,
      performance: { dnsMs: null, connectionMs: null, tlsMs: null, requestMs: 0, responseMs: 0, totalMs: 0 },
      message: 'Connection Error',
      recommendation: 'Check provider connectivity and configuration.',
    },
  });
}

export async function feibotRequest(path: string, config: FeibotConfig, init?: RequestInit, context?: FeibotCallContext) {
  const method = (String(init?.method || 'GET').toUpperCase() || 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE';
  const [rawPath, rawQuery = ''] = String(path || '').split('?');
  return callFeibot<any>({
    config,
    endpoint: rawPath,
    method,
    query: rawQuery,
    body: init?.body,
    init,
    context,
  });
}
