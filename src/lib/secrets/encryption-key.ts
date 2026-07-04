import crypto from 'crypto';
import { google } from 'googleapis';

let cachedKey: Buffer | undefined;
let inFlight: Promise<Buffer | null> | null = null;
let cacheMissUntil = 0;

function parseKeyMaterial(raw: string | null | undefined): Buffer | null {
  const value = String(raw || '').trim();
  if (!value) return null;

  // Preferred: 64-char hex (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  // Fallback: derive deterministic 32-byte key from arbitrary secret text
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

async function readFromGcpSecretManager(): Promise<Buffer | null> {
  const explicitResource = String(process.env.BERGMAN_CREDENTIAL_ENCRYPTION_KEY_SECRET_RESOURCE || '').trim();
  let projectId = String(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '').trim();
  if (!projectId) {
    try {
      const firebaseConfig = String(process.env.FIREBASE_CONFIG || '').trim();
      if (firebaseConfig) {
        const parsed = JSON.parse(firebaseConfig);
        projectId = String(parsed?.projectId || '').trim();
      }
    } catch {
      // ignore
    }
  }
  const version = String(process.env.BERGMAN_CREDENTIAL_ENCRYPTION_KEY_SECRET_VERSION || 'latest').trim() || 'latest';

  const resource = explicitResource || (projectId ? `projects/${projectId}/secrets/BERGMAN_CREDENTIAL_ENCRYPTION_KEY/versions/${version}` : '');
  if (!resource) return null;

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const tokenResponse: any = await client.getAccessToken();
  const accessToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
  if (!accessToken) return null;

  const response = await fetch(`https://secretmanager.googleapis.com/v1/${resource}:access`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) return null;

  const payload = await response.json().catch(() => null) as any;
  const dataB64 = String(payload?.payload?.data || '').trim();
  if (!dataB64) return null;

  const raw = Buffer.from(dataB64, 'base64').toString('utf8');
  return parseKeyMaterial(raw);
}

export async function getCredentialEncryptionKey(): Promise<Buffer | null> {
  if (cachedKey) return cachedKey;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    // Priority 1: direct env var value
    const envKey = parseKeyMaterial(process.env.BERGMAN_CREDENTIAL_ENCRYPTION_KEY);
    if (envKey) {
      cachedKey = envKey;
      return envKey;
    }

    // Avoid hammering Secret Manager when key is missing/unavailable.
    if (Date.now() < cacheMissUntil) {
      return null;
    }

    // Priority 2: GCP Secret Manager
    const gcpKey = await readFromGcpSecretManager();
    if (gcpKey) {
      cachedKey = gcpKey;
      return gcpKey;
    }

    // Do not permanently cache misses. Retry after short cooldown.
    cacheMissUntil = Date.now() + 30_000;
    return gcpKey;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
