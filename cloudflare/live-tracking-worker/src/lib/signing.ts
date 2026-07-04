export async function hmacSha256Hex(secret: string, message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const FEIBOT_CLOUD_API_BASE_URL = 'https://apicn.feibot.com';

export function getUnixTimestampSeconds(nowMs: number = Date.now()) {
  return Math.floor(nowMs / 1000).toString();
}

export function buildSortedQueryString(query?: Record<string, unknown> | URLSearchParams | string | null) {
  if (!query) return '';

  if (typeof query === 'string') {
    const raw = query.replace(/^\?/, '').trim();
    if (!raw) return '';
    return raw
      .split('&')
      .filter(Boolean)
      .map((part) => {
        const [k, ...rest] = part.split('=');
        return [k, rest.join('=')] as const;
      })
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
  }

  const entries: Array<[string, string]> = [];
  if (query instanceof URLSearchParams) {
    for (const [key, value] of query.entries()) {
      entries.push([key, value]);
    }
  } else {
    for (const [key, rawValue] of Object.entries(query)) {
      if (rawValue === undefined || rawValue === null || rawValue === '') continue;
      entries.push([key, String(rawValue)]);
    }
  }

  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function createStringToSign(params: {
  method: string;
  path: string;
  timestamp: string;
  sortedQueryString?: string;
  body?: string;
}) {
  const normalizedMethod = String(params.method || 'GET').toUpperCase();
  const normalizedPath = String(params.path || '/').startsWith('/') ? String(params.path) : `/${params.path}`;
  const query = String(params.sortedQueryString || '');
  const body = normalizedMethod === 'GET' ? '' : String(params.body || '');
  return `${normalizedMethod}${normalizedPath}${params.timestamp}${query}${body}`;
}

export function buildFeibotRequestUrl(path: string, sortedQueryString?: string, baseUrl: string = FEIBOT_CLOUD_API_BASE_URL) {
  const normalizedPath = String(path || '/').startsWith('/') ? String(path) : `/${path}`;
  const normalizedBase = String(baseUrl || FEIBOT_CLOUD_API_BASE_URL).replace(/\/$/, '');
  return sortedQueryString ? `${normalizedBase}${normalizedPath}?${sortedQueryString}` : `${normalizedBase}${normalizedPath}`;
}

export function buildFeibotHeaders(params: { accessKey: string; timestamp: string; signature: string }) {
  return {
    'X-Feibot-Access-Key': params.accessKey,
    'X-Feibot-AK': params.accessKey,
    'X-Feibot-Timestamp': params.timestamp,
    'X-Feibot-Signature': params.signature,
    'Content-Type': 'application/json',
  };
}

export async function signRequest(params: {
  method: string;
  path: string;
  timestamp: string;
  sortedQueryString?: string;
  body?: string;
  secretKey: string;
}) {
  const payload = createStringToSign({
    method: params.method,
    path: params.path,
    timestamp: params.timestamp,
    sortedQueryString: params.sortedQueryString,
    body: params.body,
  });
  const signature = await hmacSha256Hex(params.secretKey, payload);
  return { signature, payload };
}

export async function signFeibotRequest(params: {
  accessKey: string;
  secretKey: string;
  method: string;
  path: string;
  timestamp?: string;
  sortedQueryString?: string;
  body?: string;
}) {
  const [rawPath, rawQuery = ''] = params.path.split('?');
  const timestamp = params.timestamp || getUnixTimestampSeconds();
  const sortedQueryString = params.sortedQueryString ?? buildSortedQueryString(rawQuery);
  const { signature, payload } = await signRequest({
    method: params.method,
    path: rawPath,
    timestamp,
    sortedQueryString,
    body: params.body,
    secretKey: params.secretKey,
  });

  return {
    headers: buildFeibotHeaders({ accessKey: params.accessKey, timestamp, signature }),
    payload,
    timestamp,
    sortedQueryString,
    signature,
  };
}
