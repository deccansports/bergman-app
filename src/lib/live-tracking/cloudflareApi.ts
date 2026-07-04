import type { LiveAthlete } from '@/lib/types';

const DEFAULT_EDGE_BASE_URL = process.env.NEXT_PUBLIC_LIVE_TRACKING_EDGE_API_BASE || process.env.LIVE_TRACKING_EDGE_API_BASE || '';

export function normalizeEdgeBaseUrl(input?: string | null) {
  const raw = String(input || '').trim().replace(/\s+/g, '');
  if (!raw) return '';

  // Repair malformed values like "https:api.bergmantri.com" or "http:example.com"
  const fixedScheme = raw.match(/^https?:[^/]/i)
    ? `${raw.startsWith('https:') ? 'https://' : 'http://'}${raw.replace(/^https?:/i, '')}`
    : raw;

  const normalizedSlashes = fixedScheme.startsWith('//') ? `https:${fixedScheme}` : fixedScheme;

  const withProtocol = /^https?:\/\//i.test(normalizedSlashes) ? normalizedSlashes : `https://${normalizedSlashes}`;
  try {
    const parsed = new URL(withProtocol);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function getLiveTrackingEdgeBaseUrl() {
  return normalizeEdgeBaseUrl(DEFAULT_EDGE_BASE_URL);
}

type CloudflareFetchInit = RequestInit & {
  baseUrl?: string;
};

export class CloudflareLiveApiError extends Error {
  details: Record<string, any>;

  constructor(message: string, details: Record<string, any>) {
    super(message);
    this.name = 'CloudflareLiveApiError';
    this.details = details;
  }
}

export async function fetchCloudflareLiveAthletes(eventId: string, mode: 'live' | 'history' = 'live'): Promise<LiveAthlete[]> {
  const baseUrl = getLiveTrackingEdgeBaseUrl() || 'https://api.bergmantri.com';
  if (!baseUrl) return [];

  const response = await fetch(`${baseUrl}/v1/events/${encodeURIComponent(eventId)}/athletes?mode=${encodeURIComponent(mode)}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Cloudflare live API error ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.participants) ? (payload.participants as LiveAthlete[]) : [];
}

export async function fetchCloudflareLiveJson<T>(path: string, init?: CloudflareFetchInit): Promise<T> {
  const baseUrlOverride = init?.baseUrl || '';
  const baseUrl = normalizeEdgeBaseUrl(baseUrlOverride || getLiveTrackingEdgeBaseUrl()) || 'https://api.bergmantri.com';
  if (!baseUrl) {
    throw new Error('Cloudflare live tracking edge API base URL is not configured.');
  }

  const { baseUrl: _ignoredBaseUrl, ...requestInit } = init || {};
  const endpointPath = path.startsWith('/') ? path : `/${path}`;
  const primaryUrl = `${baseUrl}${endpointPath}`;
  const fallbackBaseUrl = 'https://api.bergmantri.com';
  const fallbackUrl = `${fallbackBaseUrl}${endpointPath}`;

  let response: Response;
  try {
    response = await fetch(primaryUrl, {
      cache: 'no-store',
      ...requestInit,
      headers: {
        Accept: 'application/json',
        ...(requestInit?.headers || {}),
      },
    });
  } catch (error) {
    if (baseUrl !== fallbackBaseUrl) {
      try {
        response = await fetch(fallbackUrl, {
          cache: 'no-store',
          ...requestInit,
          headers: {
            Accept: 'application/json',
            ...(requestInit?.headers || {}),
          },
        });
      } catch {
        throw new Error(`Cloudflare live API fetch failed for ${primaryUrl} (fallback ${fallbackUrl} also failed)`);
      }
    } else {
      throw new Error(`Cloudflare live API fetch failed for ${primaryUrl}`);
    }
  }

  if (!response.ok) {
    let rawBody = '';
    let parsedPayload: any = null;
    let detail = '';
    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        parsedPayload = await response.json();
        rawBody = JSON.stringify(parsedPayload, null, 2);
        detail = parsedPayload?.message || parsedPayload?.error || rawBody;
      } else {
        rawBody = await response.text();
        detail = rawBody;
      }
    } catch {
      detail = '';
    }
    const embeddedStatus = (() => {
      const normalized = String(detail || '');
      const fromFeibot = normalized.match(/feibot\s+a?pi\s+error\s+(\d{3})/i);
      if (fromFeibot) return Number(fromFeibot[1]);
      const fromJsonStatus = normalized.match(/"status"\s*:\s*(\d{3})/i);
      if (fromJsonStatus) return Number(fromJsonStatus[1]);
      return null;
    })();
    const effectiveStatus = response.status === 502 && embeddedStatus ? embeddedStatus : response.status;
    const recommendation = effectiveStatus === 401 || effectiveStatus === 403
      ? ' Verify Access Key, Secret Key, and Event UUID.'
      : '';
    throw new CloudflareLiveApiError(
      `Cloudflare live API error ${effectiveStatus}${detail ? `: ${detail}` : ''}${recommendation}`,
      {
        source: 'cloudflare-worker',
        baseUrl,
        url: primaryUrl,
        path: endpointPath,
        method: String(requestInit?.method || 'GET').toUpperCase(),
        cloudflareStatus: response.status,
        effectiveStatus,
        responseBody: parsedPayload ?? rawBody ?? detail,
        payload: parsedPayload,
        message: detail,
        embeddedStatus,
      },
    );
  }

  return response.json() as Promise<T>;
}
