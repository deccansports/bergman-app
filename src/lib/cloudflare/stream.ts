import type { BroadcastProviderService, CreateLiveInputParams, CreateLiveInputResult } from '@/lib/broadcast/provider';
import { validateCloudflareCredentials } from '@/lib/broadcast/cloudflareCompatibility';

const API_BASE = 'https://api.cloudflare.com/client/v4';
export const CLOUDFLARE_RTMPS_SERVER = 'rtmps://live.cloudflare.com:443/live/';

export class CloudflareStreamError extends Error {
  status: number;
  code: string;
  details?: any;

  constructor(message: string, status: number, code: string, details?: any) {
    super(message);
    this.name = 'CloudflareStreamError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getCloudflareConfig() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = String(
    process.env.CLOUDFLARE_STREAM_API_TOKEN ||
    process.env.CLOUDFLARE_API_TOKEN ||
    process.env.CF_API_TOKEN ||
    '',
  ).trim();
  return { accountId, apiToken };
}

function getCustomerCode() {
  const raw = String(
    process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE ||
    process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN ||
    '',
  ).trim();
  return raw.replace(/^customer-/i, '').trim() || '';
}

function nowMs() {
  return Date.now();
}

function safeStringify(value: any) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function headersToObject(headers: Headers) {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function toSafeErrorMessage(value: unknown) {
  return String(value || '').trim() || 'Cloudflare API request failed';
}

function classifyCloudflareError(status: number, message: string) {
  const msg = String(message || '').toLowerCase();
  if (status === 401 || status === 403 || /auth|forbidden|permission|token/.test(msg)) {
    return {
      code: 'cloudflare_auth_error',
      explanation: 'Authentication failed. Verify Stream API token permissions (read/edit) for this account.',
    };
  }
  if (/stream key|rtmp key|invalid key/.test(msg)) {
    return {
      code: 'cloudflare_invalid_stream_key',
      explanation: 'Invalid stream key. Rotate key and update the streaming device configuration.',
    };
  }
  if (status === 408 || status === 504 || /timed out|timeout/.test(msg)) {
    return {
      code: 'cloudflare_timeout',
      explanation: 'Cloudflare timed out while processing the request.',
    };
  }
  if (status === 503 || status === 502 || /unavailable|temporarily unavailable/.test(msg)) {
    return {
      code: 'cloudflare_service_unavailable',
      explanation: 'Cloudflare Stream is temporarily unavailable. Try again shortly.',
    };
  }
  return {
    code: 'cloudflare_api_error',
    explanation: 'Cloudflare Stream request failed.',
  };
}

function logCloudflareInteraction(params: {
  path: string;
  method: string;
  status: number;
  durationMs: number;
  requestId?: string | null;
  cameraId?: string | null;
  eventId?: string | null;
  liveInputUid?: string | null;
  healthCheckResult?: string | null;
}) {
  console.info('[cloudflare-stream]', {
    path: params.path,
    method: params.method,
    status: params.status,
    responseTimeMs: params.durationMs,
    requestId: params.requestId || null,
    cameraId: params.cameraId || null,
    eventId: params.eventId || null,
    liveInputUid: params.liveInputUid || null,
    healthCheckResult: params.healthCheckResult || null,
  });
}

async function performCloudflareRequest(path: string, init?: RequestInit & { logContext?: Record<string, any> }) {
  const { accountId, apiToken } = getCloudflareConfig();
  if (!accountId || !apiToken) {
    throw new CloudflareStreamError(
      'Cloudflare Stream not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN (or CLOUDFLARE_API_TOKEN).',
      500,
      'cloudflare_not_configured',
    );
  }

  const { logContext, ...requestInit } = init || {};
  const startedAt = nowMs();
  const method = String(requestInit?.method || 'GET').toUpperCase();
  const res = await fetch(`${API_BASE}/accounts/${accountId}${path}`, {
    ...requestInit,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...(requestInit?.headers || {}),
    },
    cache: 'no-store',
  });

  const rawText = await res.text();
  let payload: any = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = null;
  }
  const durationMs = nowMs() - startedAt;
  const requestId = res.headers.get('cf-ray') || res.headers.get('x-request-id') || null;
  const responseHeaders = headersToObject(res.headers);

  console.info('[cloudflare-stream][response-headers]', {
    path,
    method,
    status: Number(res.status || 200),
    headers: responseHeaders,
  });

  return {
    res,
    payload,
    rawText,
    durationMs,
    requestId,
    method,
    path,
    logContext,
    responseHeaders,
  };
}

async function cfFetch<T>(path: string, init?: RequestInit & { logContext?: Record<string, any> }): Promise<T> {
  const { res, payload, rawText, durationMs, requestId, method, logContext, responseHeaders } = await performCloudflareRequest(path, init);

  if (!res.ok || !payload?.success) {
    const cfMessage = toSafeErrorMessage(payload?.errors?.[0]?.message || payload?.messages?.[0]?.message || rawText || '');
    const cfCode = Number(payload?.errors?.[0]?.code || 0) || null;
    const status = Number(res.status || 500);
    const classification = classifyCloudflareError(status, cfMessage);

    logCloudflareInteraction({
      path,
      method,
      status,
      durationMs,
      requestId,
      cameraId: String(logContext?.cameraId || '') || null,
      eventId: String(logContext?.eventId || '') || null,
      liveInputUid: String(logContext?.liveInputUid || '') || null,
      healthCheckResult: 'failed',
    });

    throw new CloudflareStreamError(
      classification.explanation,
      status,
      classification.code,
      {
        path,
        method,
        status,
        responseTimeMs: durationMs,
        requestId,
        cloudflareErrorCode: cfCode,
        cloudflareErrorMessage: cfMessage || null,
        cloudflareErrors: Array.isArray(payload?.errors) ? payload.errors : null,
      },
    );
  }

  if (method === 'GET' && /\/stream\/live_inputs\//.test(path)) {
    console.info('===== RAW CLOUDFLARE RESPONSE =====');
    console.info(safeStringify(payload));
    console.info('[cloudflare-stream][live-input-details]', {
      path,
      method,
      status: Number(res.status || 200),
      durationMs,
      requestId,
      rawText,
      responseHeaders,
      resultType: typeof payload?.result,
      resultKeys: payload?.result ? Object.keys(payload.result) : [],
      result: payload?.result,
      statusField: payload?.result?.status ?? payload?.result?.state ?? null,
      recordingMode: payload?.result?.recording?.mode ?? null,
      recordingStatus: payload?.result?.recording?.status ?? null,
      connected: payload?.result?.connected ?? payload?.result?.connection?.connected ?? null,
      lastSeen: payload?.result?.lastSeen ?? payload?.result?.last_seen ?? payload?.result?.lastSeenBroadcaster ?? null,
      lastError: payload?.result?.lastError ?? payload?.result?.last_error ?? payload?.result?.error ?? null,
      playback: payload?.result?.playback ?? payload?.result?.video?.playback ?? null,
      video: payload?.result?.video ?? payload?.result?.currentVideo ?? null,
      creator: payload?.result?.creator ?? payload?.result?.createdBy ?? null,
      meta: payload?.result?.meta ?? null,
    });
  }

  logCloudflareInteraction({
    path,
    method,
    status: Number(res.status || 200),
    durationMs,
    requestId,
    cameraId: String(logContext?.cameraId || '') || null,
    eventId: String(logContext?.eventId || '') || null,
    liveInputUid: String(logContext?.liveInputUid || '') || null,
    healthCheckResult: String(logContext?.healthCheckResult || '') || null,
  });

  return payload.result as T;
}

export async function createLiveInput(params: CreateLiveInputParams): Promise<CreateLiveInputResult> {
  const request = await performCloudflareRequest('/stream/live_inputs', {
    method: 'POST',
    body: JSON.stringify({
      meta: {
        name: params.name,
        ...(params.meta || {}),
      },
      recording: {
        mode: 'off',
      },
    }),
    logContext: {
      eventId: String((params.meta as any)?.eventId || ''),
      cameraId: String((params.meta as any)?.cameraId || ''),
    },
  });

  const { res, payload, rawText, durationMs, requestId } = request;
  if (!res.ok || !payload?.success) {
    const cfMessage = toSafeErrorMessage(payload?.errors?.[0]?.message || payload?.messages?.[0]?.message || rawText || '');
    const cfCode = Number(payload?.errors?.[0]?.code || 0) || null;
    const status = Number(res.status || 500);
    const classification = classifyCloudflareError(status, cfMessage);

    console.info('===== RAW CLOUDFLARE RESPONSE =====');
    console.info(rawText);

    throw new CloudflareStreamError(classification.explanation, status, classification.code, {
      path: '/stream/live_inputs',
      method: 'POST',
      status,
      responseTimeMs: durationMs,
      requestId,
      cloudflareErrorCode: cfCode,
      cloudflareErrorMessage: cfMessage || null,
      cloudflareErrors: Array.isArray(payload?.errors) ? payload.errors : null,
      rawResponseText: rawText,
      rawResponseJson: payload,
    });
  }

  const result = payload?.result || {};

  const validation = validateCloudflareCredentials(result);

  console.info('===== RAW CLOUDFLARE RESPONSE =====');
  console.info(safeStringify(payload));
  console.info('UID:', result?.uid, 'typeof=', typeof result?.uid, 'length=', String(result?.uid || '').length);
  console.info('RTMPS URL:', result?.rtmps?.url, 'typeof=', typeof result?.rtmps?.url, 'length=', String(result?.rtmps?.url || '').length);
  console.info('STREAM KEY:', result?.rtmps?.streamKey, 'typeof=', typeof result?.rtmps?.streamKey, 'length=', String(result?.rtmps?.streamKey || '').length);
  console.info('result.rtmps typeof=', typeof result?.rtmps);
  console.info('result.uid typeof=', typeof result?.uid);
  console.info('result.rtmps.url typeof=', typeof result?.rtmps?.url);
  console.info('result.rtmps.streamKey typeof=', typeof result?.rtmps?.streamKey);
  console.info('result.rtmps keys=', result?.rtmps ? Object.keys(result.rtmps) : []);
  console.info('===== CLOUDFLARE STREAM VALIDATION =====');
  console.info(validation);
  if (String(result?.rtmps?.streamKey || '').endsWith(String(result?.uid || ''))) {
    console.info("INFO: Cloudflare returned composite credential format (token + 'k' + uid)");
  }

  const liveInputUid = String(result?.uid || '');
  const rtmpsUrl = String(result?.rtmps?.url || '');
  const streamKey = String(result?.rtmps?.streamKey || '');

  console.info('UID LENGTH:', liveInputUid.length);
  console.info('RTMPS URL LENGTH:', rtmpsUrl.length);
  console.info('STREAM KEY LENGTH:', streamKey.length);

  return {
    liveInputUid,
    rtmpsUrl,
    streamKey,
    // Per Cloudflare lifecycle docs, live input creation does not guarantee playback/video availability.
    playbackUid: null,
  };
}

export async function deleteLiveInput(liveInputUid: string) {
  await cfFetch(`/stream/live_inputs/${encodeURIComponent(liveInputUid)}`, {
    method: 'DELETE',
    logContext: {
      liveInputUid,
    },
  });
}

export async function deleteStreamVideo(videoUid: string) {
  const uid = String(videoUid || '').trim();
  if (!uid) return;
  await cfFetch(`/stream/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    logContext: {
      liveInputUid: uid,
      healthCheckResult: 'delete_video',
    },
  });
}

export async function listStreamVideos(params?: { limit?: number; search?: string; status?: string; type?: 'vod' | 'live' | '' }) {
  const query = new URLSearchParams();
  const limit = Math.min(1000, Math.max(1, Number(params?.limit || 100)));
  query.set('limit', String(limit));
  query.set('include_counts', 'true');
  if (params?.search) query.set('search', String(params.search).trim());
  if (params?.status) query.set('status', String(params.status).trim());
  if (params?.type) query.set('type', String(params.type).trim());

  const result = await cfFetch<any>(`/stream?${query.toString()}`);
  const items = Array.isArray(result)
    ? result
    : Array.isArray(result?.result)
      ? result.result
      : Array.isArray(result?.videos)
        ? result.videos
        : [];

  return {
    items,
    total: Number(result?.total ?? result?.count ?? items.length ?? 0),
  };
}

export async function getLiveInput(liveInputUid: string) {
  return cfFetch<any>(`/stream/live_inputs/${encodeURIComponent(liveInputUid)}`, {
    logContext: {
      liveInputUid,
      healthCheckResult: 'queried',
    },
  });
}

export async function getLiveInputDebug(liveInputUid: string) {
  const request = await performCloudflareRequest(`/stream/live_inputs/${encodeURIComponent(liveInputUid)}`, {
    logContext: {
      liveInputUid,
      healthCheckResult: 'debug_query',
    },
  });

  return {
    status: request.res.status,
    requestId: request.requestId,
    rawText: request.rawText,
    rawJson: request.payload,
    rawHeaders: request.responseHeaders,
    result: request.payload?.result || null,
  };
}

export async function getStreamVideo(playbackUid: string) {
  const uid = String(playbackUid || '').trim();
  if (!uid) return null;
  return cfFetch<any>(`/stream/${encodeURIComponent(uid)}`, {
    logContext: {
      liveInputUid: uid,
      healthCheckResult: 'playback_lookup',
    },
  });
}

export async function listLiveInputs() {
  const result = await cfFetch<any>('/stream/live_inputs?per_page=100');
  return Array.isArray(result) ? result : Array.isArray(result?.live_inputs) ? result.live_inputs : [];
}

export function getPlaybackUrl(playbackUid: string) {
  const uid = String(playbackUid || '').trim();
  if (!uid) return '';
  const customerCode = getCustomerCode();
  if (customerCode) {
    return `https://customer-${customerCode}.cloudflarestream.com/${uid}/manifest/video.m3u8`;
  }
  return `https://videodelivery.net/${uid}/manifest/video.m3u8`;
}

export function getPlaybackIframeUrl(playbackUid: string) {
  const uid = String(playbackUid || '').trim();
  if (!uid) return '';
  const customerCode = getCustomerCode();
  if (customerCode) {
    return `https://customer-${customerCode}.cloudflarestream.com/${uid}/iframe`;
  }
  return `https://iframe.videodelivery.net/${uid}`;
}

export async function getViewerCounts(playbackUid: string): Promise<number> {
  if (!playbackUid) return 0;
  try {
    const result = await cfFetch<any>(`/stream/${encodeURIComponent(playbackUid)}`);
    const viewers = Number(result?.liveInput?.viewerCount || result?.viewerCount || 0);
    return Number.isFinite(viewers) ? viewers : 0;
  } catch {
    return 0;
  }
}

export const cloudflareBroadcastProvider: BroadcastProviderService = {
  provider: 'cloudflare',
  createLiveInput,
  deleteLiveInput,
  getLiveInput,
  listLiveInputs,
  getPlaybackUrl,
  getViewerCounts,
};
