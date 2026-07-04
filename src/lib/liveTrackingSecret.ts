import crypto from 'crypto';

const PREFIX = 'enc:v1';

export class ProviderSecretConfigurationError extends Error {
  code: string;

  constructor(message: string) {
    super(message);
    this.name = 'ProviderSecretConfigurationError';
    this.code = 'provider_secret_configuration_error';
  }
}

export class CloudflareStreamCredentialMutationError extends Error {
  code: string;

  constructor(message: string) {
    super(message);
    this.name = 'CloudflareStreamCredentialMutationError';
    this.code = 'cloudflare_stream_credential_mutation_error';
  }
}

function getSecretKeyMaterial() {
  const raw = process.env.LIVE_TRACKING_PROVIDER_SECRET_KEY || process.env.LIVE_TRACKING_INTERNAL_TOKEN || '';
  return String(raw || '').trim();
}

function getCipherKey() {
  const material = getSecretKeyMaterial();
  if (!material) return null;
  return crypto.createHash('sha256').update(material).digest();
}

export function isEncryptedSecret(value?: string | null) {
  const text = String(value ?? '');
  return text.startsWith(`${PREFIX}:`);
}

export function encryptProviderSecret(secret: string) {
  const key = getCipherKey();
  if (!key) {
    throw new ProviderSecretConfigurationError('LIVE_TRACKING_PROVIDER_SECRET_KEY is required to encrypt provider secrets.');
  }

  const plaintext = String(secret ?? '');
  if (!plaintext) return '';

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptProviderSecret(secret: string) {
  const text = String(secret ?? '');
  if (!text) return '';
  if (!isEncryptedSecret(text)) return text;

  const key = getCipherKey();
  if (!key) {
    throw new ProviderSecretConfigurationError('LIVE_TRACKING_PROVIDER_SECRET_KEY is required to decrypt provider secrets.');
  }

  const parts = text.split(':');
  if (parts.length !== 5) return '';

  try {
    const iv = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    const payload = Buffer.from(parts[4], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new CloudflareStreamCredentialMutationError('Encrypted provider secret could not be decrypted with the configured key.');
  }
}
