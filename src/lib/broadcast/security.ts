import { decryptProviderSecret, encryptProviderSecret, CloudflareStreamCredentialMutationError, ProviderSecretConfigurationError } from '@/lib/liveTrackingSecret';
import { createHash } from 'crypto';

export { CloudflareStreamCredentialMutationError, ProviderSecretConfigurationError };

export function encryptStreamKey(raw: string) {
  const value = String(raw ?? '');
  if (!value) return '';
  return encryptProviderSecret(value);
}

export function decryptStreamKey(encrypted: string) {
  const value = String(encrypted ?? '');
  if (!value) return '';
  return decryptProviderSecret(value);
}

export function maskSecret(value: string) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}••••••${text.slice(-4)}`;
}

export function sha256Hex(value: string) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}
