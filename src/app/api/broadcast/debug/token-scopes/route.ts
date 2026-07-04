import { NextRequest, NextResponse } from 'next/server';
import { requireBroadcastManager } from '@/lib/broadcast/auth';

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

  return {
    status: response.status,
    ok: response.ok,
    headers: headersToObject(response.headers),
    rawText,
    rawJson,
    elapsedMs: Date.now() - startedAt,
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

  return {
    status: response.status,
    ok: response.ok,
    headers: headersToObject(response.headers),
    rawText,
    rawJson,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireBroadcastManager(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.message }, { status: auth.status });
  }

  const { accountId, apiToken } = getCloudflareConfig();
  const tokenPrefix = String(apiToken || '').slice(0, 7);

  // Token verification
  const tokenVerify = await cfGlobalRequest('/user/tokens/verify').catch((error: any) => ({
    status: 0,
    ok: false,
    headers: {},
    rawText: String(error?.message || error || 'Unknown token verify error'),
    rawJson: null,
    elapsedMs: 0,
  }));

  const tokenStatus = tokenVerify.rawJson?.result?.status || 'unknown';
  const tokenNotBefore = tokenVerify.rawJson?.result?.not_before || null;
  const tokenExpiresOn = tokenVerify.rawJson?.result?.expires_on || null;

  // List live inputs (probes Stream Read)
  const listLiveInputs = await cfRequest('/stream/live_inputs?limit=1', {}, accountId).catch((error: any) => ({
    status: 0,
    ok: false,
    headers: {},
    rawText: String(error?.message || error || 'Unknown list live inputs error'),
    rawJson: null,
    elapsedMs: 0,
  }));

  // Check if account has Stream capability
  const accountInfo = await cfGlobalRequest(`/accounts/${accountId}`).catch((error: any) => ({
    status: 0,
    ok: false,
    headers: {},
    rawText: String(error?.message || error || 'Unknown account info error'),
    rawJson: null,
    elapsedMs: 0,
  }));

  // Permission inference
  const permissionProbes = {
    streamRead: {
      endpoint: '/stream/live_inputs',
      method: 'GET',
      status: listLiveInputs.status,
      accessible: listLiveInputs.ok,
      elapsedMs: listLiveInputs.elapsedMs,
    },
    accountRead: {
      endpoint: `/accounts/${accountId}`,
      method: 'GET',
      status: accountInfo.status,
      accessible: accountInfo.ok,
      elapsedMs: accountInfo.elapsedMs,
    },
  };

  // Try to detect additional capabilities from permission groups
  const permissionChecks = {
    hasStreamRead: listLiveInputs.ok,
    hasAccountRead: accountInfo.ok,
    canProbablyEdit: listLiveInputs.ok, // If we can read, we might be able to edit
  };

  console.info('[broadcast-debug][token-scopes]', {
    timestamp: new Date().toISOString(),
    tokenPrefix,
    tokenStatus,
    tokenNotBefore,
    tokenExpiresOn,
    accountId,
    permissionProbes,
    permissionChecks,
  });

  return NextResponse.json({
    success: true,
    data: {
      token: {
        prefix: tokenPrefix,
        status: tokenStatus,
        notBefore: tokenNotBefore,
        expiresOn: tokenExpiresOn,
        verification: tokenVerify.rawJson?.result || null,
      },
      accountId,
      permissionProbes,
      permissionChecks,
      endpoints: {
        tokenVerify: {
          status: tokenVerify.status,
          ok: tokenVerify.ok,
          elapsedMs: tokenVerify.elapsedMs,
        },
        listLiveInputs: {
          status: listLiveInputs.status,
          ok: listLiveInputs.ok,
          elapsedMs: listLiveInputs.elapsedMs,
          result: Array.isArray(listLiveInputs.rawJson?.result) ? listLiveInputs.rawJson.result.length : 0,
        },
        accountInfo: {
          status: accountInfo.status,
          ok: accountInfo.ok,
          elapsedMs: accountInfo.elapsedMs,
        },
      },
      recommendation: [
        permissionChecks.hasStreamRead ? '✓ Stream Read: YES' : '✗ Stream Read: NO',
        permissionChecks.hasAccountRead ? '✓ Account Read: YES' : '✗ Account Read: NO',
        permissionChecks.canProbablyEdit ? '✓ Likely has Edit permissions' : '✗ May not have Edit permissions',
        tokenStatus === 'active' ? '✓ Token is active' : `⚠ Token status: ${tokenStatus}`,
      ].join('\n'),
    },
  });
}
