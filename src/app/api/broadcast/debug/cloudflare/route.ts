import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { requireBroadcastManager } from '@/lib/broadcast/auth';
import { maskSecret } from '@/lib/broadcast/security';

export const dynamic = 'force-dynamic';

const API_BASE = 'https://api.cloudflare.com/client/v4';

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

function headersToObject(headers: Headers) {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

async function cfRequest(path: string, init: RequestInit = {}, accountId?: string) {
  const { accountId: configuredAccountId, apiToken } = getCloudflareConfig();
  const resolvedAccountId = accountId || configuredAccountId;

  if (!resolvedAccountId || !apiToken) {
    throw new Error('Cloudflare Stream is not configured.');
  }

  const startedAt = Date.now();
  const response = await fetch(`${API_BASE}/accounts/${resolvedAccountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });

  const rawText = await response.text();
  let rawJson: any = null;
  try {
    rawJson = rawText ? JSON.parse(rawText) : null;
  } catch {
    rawJson = null;
  }

  const headers = headersToObject(response.headers);

  console.info('[broadcast-debug][cloudflare-response]', {
    path,
    method: String(init.method || 'GET').toUpperCase(),
    status: response.status,
    elapsedMs: Date.now() - startedAt,
    headers,
  });

  return {
    status: response.status,
    ok: response.ok,
    headers,
    rawText,
    rawJson,
  };
}

async function cfGlobalRequest(path: string, init: RequestInit = {}) {
  const { apiToken } = getCloudflareConfig();

  if (!apiToken) {
    throw new Error('Cloudflare Stream is not configured.');
  }

  const startedAt = Date.now();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });

  const rawText = await response.text();
  let rawJson: any = null;
  try {
    rawJson = rawText ? JSON.parse(rawText) : null;
  } catch {
    rawJson = null;
  }

  const headers = headersToObject(response.headers);

  console.info('[broadcast-debug][cloudflare-response]', {
    path,
    method: String(init.method || 'GET').toUpperCase(),
    status: response.status,
    elapsedMs: Date.now() - startedAt,
    headers,
  });

  return {
    status: response.status,
    ok: response.ok,
    headers,
    rawText,
    rawJson,
  };
}

async function fetchLiveInputReadSnapshot(liveInputUid: string) {
  const { accountId } = getCloudflareConfig();
  const encodedUid = encodeURIComponent(liveInputUid);

  const [liveInput, videos, outputs] = await Promise.all([
    cfRequest(`/stream/live_inputs/${encodedUid}`, {}, accountId),
    cfRequest(`/stream/live_inputs/${encodedUid}/videos`, {}, accountId),
    cfRequest(`/stream/live_inputs/${encodedUid}/outputs`, {}, accountId).catch((error: any) => ({
      status: 0,
      ok: false,
      headers: {},
      rawText: String(error?.message || error || 'Unknown outputs error'),
      rawJson: null,
    })),
  ]);

  const liveInputResult = liveInput.rawJson?.result || {};
  const videosResult = Array.isArray(videos.rawJson?.result) ? videos.rawJson.result : [];
  const outputsResult = Array.isArray(outputs.rawJson?.result) ? outputs.rawJson.result : [];
  const firstVideo = videosResult[0] || null;
  const lifecycleUrl = getCustomerCode()
    ? `https://customer-${getCustomerCode()}.cloudflarestream.com/${liveInputUid}/lifecycle`
    : `https://videodelivery.net/${liveInputUid}/lifecycle`;

  const lifecycle = await fetch(lifecycleUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getCloudflareConfig().apiToken}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  }).then(async (response) => {
    const rawText = await response.text();
    let rawJson: any = null;
    try {
      rawJson = rawText ? JSON.parse(rawText) : null;
    } catch {
      rawJson = null;
    }
    const headers = headersToObject(response.headers);
    console.info('[broadcast-debug][cloudflare-response]', {
      path: lifecycleUrl,
      method: 'GET',
      status: response.status,
      elapsedMs: 0,
      headers,
    });
    return { status: response.status, ok: response.ok, headers, rawText, rawJson };
  }).catch((error: any) => ({
    status: 0,
    ok: false,
    headers: {},
    rawText: String(error?.message || error || 'Unknown lifecycle error'),
    rawJson: null,
  }));

  const status = liveInputResult?.status ?? liveInputResult?.state ?? null;
  const connected = Boolean(
    liveInputResult?.connected ??
    liveInputResult?.connection?.connected,
  ) || videosResult.some((video: any) => String(video?.status?.state || '').startsWith('live'));

  const lastSeen =
    liveInputResult?.lastSeen ??
    liveInputResult?.last_seen ??
    liveInputResult?.lastSeenBroadcaster ??
    liveInputResult?.modified ??
    null;

  const lastError =
    liveInputResult?.lastError ??
    liveInputResult?.last_error ??
    liveInputResult?.error ??
    liveInputResult?.status?.errorReasonText ??
    liveInputResult?.status?.errorReasonCode ??
    null;

  const recordingStatus =
    liveInputResult?.recording?.status ??
    liveInputResult?.recording?.mode ??
    firstVideo?.status?.state ??
    null;

  const viewerUrl =
    firstVideo?.preview ??
    liveInputResult?.webRTCPlayback?.url ??
    liveInputResult?.webRTCPlayback?.preview ??
    null;

  const playbackUrl =
    firstVideo?.playback?.hls ??
    firstVideo?.playback?.dash ??
    firstVideo?.preview ??
    liveInputResult?.playback?.hls ??
    liveInputResult?.playback?.dash ??
    null;

  const publishUrl =
    liveInputResult?.webRTC?.url ??
    (() => {
      const server = String(liveInputResult?.rtmps?.url || '').trim();
      const streamKey = String(liveInputResult?.rtmps?.streamKey || '').trim();
      if (!server || !streamKey) return null;
      return server.endsWith('/') ? `${server}${streamKey}` : `${server}/${streamKey}`;
    })();

  const liveInputHeaders = liveInput.headers;
  const liveInputResponseFields = liveInputResult && typeof liveInputResult === 'object' ? Object.keys(liveInputResult) : [];

  const permissionChecks = {
    liveInputsRead: Boolean(liveInput.ok),
    videosRead: Boolean(videos.ok),
    outputsRead: Boolean(outputs.ok),
  };

  const lifecycleLive = Boolean(lifecycle.rawJson?.live ?? false);
  const everReceivedHandshake = Boolean(
    lifecycleLive ||
    connected ||
    status === 'live' ||
    status === 'recording' ||
    videosResult.some((video: any) => String(video?.status?.state || '').includes('live-inprogress')),
  );

  return {
    liveInput: liveInput.rawJson?.result ?? null,
    connected,
    status,
    lastSeen,
    lastError,
    playbackUrl,
    recordingStatus,
    viewerUrl,
    publishUrl,
    rtmpCredentials: {
      server: String(liveInputResult?.rtmps?.url || '').trim(),
      streamKey: String(liveInputResult?.rtmps?.streamKey || '').trim(),
      combinedUrl: publishUrl,
      serverMasked: maskSecret(String(liveInputResult?.rtmps?.url || '')),
      streamKeyMasked: maskSecret(String(liveInputResult?.rtmps?.streamKey || '')),
    },
    accountId: getCloudflareConfig().accountId,
    endpoints: {
      liveInput: {
        status: liveInput.status,
        headers: liveInputHeaders,
        rawText: liveInput.rawText,
        rawJson: liveInput.rawJson,
      },
      videos: {
        status: videos.status,
        headers: videos.headers,
        rawText: videos.rawText,
        rawJson: videos.rawJson,
      },
      outputs: {
        status: outputs.status,
        headers: outputs.headers,
        rawText: outputs.rawText,
        rawJson: outputs.rawJson,
      },
      lifecycle: {
        url: lifecycleUrl,
        status: lifecycle.status,
        headers: lifecycle.headers,
        rawText: lifecycle.rawText,
        rawJson: lifecycle.rawJson,
      },
      tokenVerify: {
        status: null,
        headers: {},
        rawText: null,
        rawJson: null,
      },
    },
    liveInputResponseFields,
    videos: videosResult,
    outputs: outputsResult,
    lifecycle: lifecycle.rawJson,
    raw: {
      liveInput: liveInput.rawJson,
      videos: videos.rawJson,
      outputs: outputs.rawJson,
      lifecycle: lifecycle.rawJson,
    },
    everReceivedHandshake,
    diagnostics: {
      liveInputHeaders,
      videosHeaders: videos.headers,
      outputsHeaders: outputs.headers,
      lifecycleHeaders: lifecycle.headers,
      liveInputResponseFields,
    },
  };
}

async function verifyTokenScopes(liveInputUid: string, baseline: Awaited<ReturnType<typeof fetchLiveInputReadSnapshot>>) {
  const { accountId } = getCloudflareConfig();
  const encodedUid = encodeURIComponent(liveInputUid);
  const tokenVerify = await cfGlobalRequest('/user/tokens/verify').catch((error: any) => ({
    status: 0,
    ok: false,
    headers: {},
    rawText: String(error?.message || error || 'Unknown token verify error'),
    rawJson: null,
  }));

  const noOpUpdate = await cfRequest(
    `/stream/live_inputs/${encodedUid}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        enabled: baseline.liveInput?.enabled ?? true,
        meta: baseline.liveInput?.meta ?? {},
        recording: baseline.liveInput?.recording ?? { mode: 'off' },
      }),
    },
    accountId,
  ).catch((error: any) => ({
    status: 0,
    ok: false,
    headers: {},
    rawText: String(error?.message || error || 'Unknown update probe error'),
    rawJson: null,
  }));

  const tokenPrefix = String(getCloudflareConfig().apiToken || '').slice(0, 5);

  return {
    tokenPrefix,
    verification: tokenVerify.rawJson?.result || null,
    requiredPermissions: [
      'Account · Stream · Read',
      'Account · Stream · Edit',
    ],
    permissionChecks: {
      liveInputsRead: Number(baseline.endpoints.liveInput.status || 0) > 0,
      liveInputsEdit: Boolean(noOpUpdate.ok),
      videosRead: Number(baseline.endpoints.videos.status || 0) > 0,
      outputsRead: Number(baseline.endpoints.outputs.status || 0) > 0,
      lifecycleRead: Number(baseline.endpoints.lifecycle.status || 0) > 0,
    },
    note: 'Cloudflare token verification only returns active/status; granular scopes are inferred from endpoint probes.',
    endpoints: {
      tokenVerify: {
        status: tokenVerify.status,
        headers: tokenVerify.headers,
        rawText: tokenVerify.rawText,
        rawJson: tokenVerify.rawJson,
      },
      noOpUpdateProbe: {
        status: noOpUpdate.status,
        headers: noOpUpdate.headers,
        rawText: noOpUpdate.rawText,
        rawJson: noOpUpdate.rawJson,
      },
    },
  };
}

async function observeState(liveInputUid: string, seconds = 30) {
  const timeline: Array<Record<string, any>> = [];
  const limit = Math.max(1, Math.min(30, Number(seconds || 30)));

  for (let i = 0; i < limit; i += 1) {
    const snapshot = await fetchLiveInputReadSnapshot(liveInputUid);
    const entry = {
      timestamp: new Date().toISOString(),
      second: i + 1,
      connected: snapshot.connected,
      status: snapshot.status,
      lastSeen: snapshot.lastSeen,
      lastError: snapshot.lastError,
      everReceivedHandshake: snapshot.everReceivedHandshake,
    };

    timeline.push(entry);
    console.info('[broadcast-debug][poll]', entry);

    if (i < limit - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return timeline;
}

export async function GET(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.message }, { status: auth.status });
  }

  const cameraId = String(req.nextUrl.searchParams.get('cameraId') || '').trim();
  let liveInputUid = String(req.nextUrl.searchParams.get('liveInputUid') || '').trim();
  const observe = String(req.nextUrl.searchParams.get('observe') || '').toLowerCase();
  const observeSeconds = Number(req.nextUrl.searchParams.get('observeSeconds') || 30);

  if (!liveInputUid && cameraId) {
    const db = getFirestoreInstance();
    const snap = await db.collection('broadcastCameras').doc(cameraId).get();
    if (snap.exists) {
      liveInputUid = String((snap.data() as any)?.cloudflare?.liveInputUid || '').trim();
    }
  }

  if (!liveInputUid) {
    return NextResponse.json({ success: false, error: 'liveInputUid or cameraId is required' }, { status: 400 });
  }

  const baseline = await fetchLiveInputReadSnapshot(liveInputUid);
  const tokenScopes = await verifyTokenScopes(liveInputUid, baseline);
  const timeline = observe === 'true' || observe === '1' ? await observeState(liveInputUid, observeSeconds) : [];

  return NextResponse.json({
    success: true,
    data: {
      liveInputUid,
      cameraId: cameraId || null,
      accountId: getCloudflareConfig().accountId,
      connected: baseline.connected,
      status: baseline.status,
      lastSeen: baseline.lastSeen,
      lastError: baseline.lastError,
      playbackUrl: baseline.playbackUrl,
      recordingStatus: baseline.recordingStatus,
      viewerUrl: baseline.viewerUrl,
      publishUrl: baseline.publishUrl,
      rtmpCredentials: baseline.rtmpCredentials,
      tokenScopes,
      liveInput: baseline.liveInput,
      endpoints: baseline.endpoints,
      diagnostics: baseline.diagnostics,
      videos: baseline.videos,
      outputs: baseline.outputs,
      lifecycle: baseline.lifecycle,
      everReceivedHandshake: baseline.everReceivedHandshake,
      observedTimeline: timeline,
      summary: {
        liveInputResponseFields: baseline.liveInputResponseFields,
        connectedTransitions: timeline.filter((item) => item.connected).length,
        everTransitionedConnected: timeline.some((item) => item.connected),
        tokenStatus: tokenScopes?.verification?.status || null,
        permissionChecks: tokenScopes?.permissionChecks || null,
      },
    },
  });
}
