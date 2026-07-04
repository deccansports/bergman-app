/**
 * Feibot Credential Management
 * 
 * Handles secure storage, retrieval, and validation of Feibot API credentials.
 * All credentials are encrypted before storage in Firestore.
 */

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import crypto from 'crypto';
import { encryptProviderSecret, decryptProviderSecret, isEncryptedSecret } from '@/lib/liveTrackingSecret';
import { getCredentialEncryptionKey } from '@/lib/secrets/encryption-key';
import { loadFeibotIntegration } from './integration-store';
import type { FeibotConnection, FeibotAPIConfig } from './types';

const COLLECTION_NAME = 'feibotConnections';
const GLOBAL_SETTINGS_DOC_PATH = 'settings/liveTracking/providers/feibot';
const PROVIDER_CREDENTIALS_FIELD = 'providerCredentials';

export type FeibotCredentialType = 'auto' | 'event' | 'account';
export type FeibotCredentialSource = 'env' | 'firestore' | 'migration' | 'none';

export interface FeibotResolvedCredential extends FeibotAPIConfig {
  credentialType: Exclude<FeibotCredentialType, 'auto'>;
  source: FeibotCredentialSource;
  eventId?: string;
  eventUuid?: string;
  updatedAt?: string;
  storedAccessKeyRaw?: string;
  storedSecretKeyRaw?: string;
}

export interface FeibotCredentialBundle {
  requestedMode: FeibotCredentialType;
  selectedMode: Exclude<FeibotCredentialType, 'auto'> | null;
  selected: FeibotResolvedCredential | null;
  event: FeibotResolvedCredential | null;
  account: FeibotResolvedCredential | null;
  eventConfigured: boolean;
  accountConfigured: boolean;
}

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeLookupKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function preserveExact(value: unknown) {
  return String(value ?? '');
}

function detectCredentialTypeFromAccessKey(accessKey: unknown): Exclude<FeibotCredentialType, 'auto'> | 'unknown' {
  const key = preserveExact(accessKey);
  if (key.startsWith('fbwb_account_')) return 'account';
  if (key.startsWith('fbwb_event_')) return 'event';
  return 'unknown';
}

function isLikelyFeibotEventUuid(value: unknown) {
  const key = normalize(value);
  if (!key) return false;
  // Reject Firestore-like IDs and allow Feibot short event UUIDs like 7BvuefrS, 3cS58x1f
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return false;
  return key.length >= 6 && key.length <= 12;
}

function maskPrefix(value: unknown, size = 16) {
  return preserveExact(value).slice(0, size);
}

type CanonicalProviderCredentialStore = {
  account?: {
    accessKey?: string;
    secretKey?: string;
    accountId?: string;
    apiBaseUrl?: string;
    credentialType?: 'account';
    updatedAt?: string;
    updatedBy?: string;
  };
  events?: Record<string, {
    accessKey?: string;
    secretKey?: string;
    eventUuid?: string;
    accountId?: string;
    apiBaseUrl?: string;
    credentialType?: 'event';
    updatedAt?: string;
    updatedBy?: string;
    eventId?: string;
  }>;
};

function validateResolvedCredential(input: {
  credential: FeibotResolvedCredential;
  requestedMode: FeibotCredentialType;
  requestedEventUuid?: string;
}) {
  const credential = input.credential;
  const accessKey = preserveExact(credential.accessKey);
  const secretKey = preserveExact(credential.secretKey);
  const actualType = detectCredentialTypeFromAccessKey(accessKey);
  const requestedEventUuid = normalize(input.requestedEventUuid || '');

  if (!accessKey) throw new Error('Access Key missing');
  if (!secretKey) throw new Error('Secret Key missing');
  if (secretKey.length <= 0) throw new Error('Secret Key length > 0 validation failed');
  if (actualType === 'unknown') throw new Error('Credential Type Mismatch');
  if (credential.credentialType !== actualType) throw new Error('Credential Resolver Bug');
  if (credential.credentialType === 'account' && !accessKey.startsWith('fbwb_account_')) throw new Error('Credential Type Mismatch');
  if (credential.credentialType === 'event' && !accessKey.startsWith('fbwb_event_')) throw new Error('Credential Type Mismatch');

  if (credential.credentialType === 'event') {
    const boundEventUuid = normalize(credential.eventUuid || '');
    if (!boundEventUuid) throw new Error('Wrong Event Credential');
    if (!isLikelyFeibotEventUuid(boundEventUuid)) throw new Error('Wrong Event Credential');
    if (requestedEventUuid && boundEventUuid !== requestedEventUuid) throw new Error('Wrong Event Credential');
  }

  if (credential.credentialType === 'account' && input.requestedMode === 'event') {
    throw new Error('Credential Type Mismatch');
  }
}

let startupCredentialValidationDone = false;

async function validateCredentialStoreOnStartup() {
  if (startupCredentialValidationDone) return;
  const { store } = await readProviderCredentialStore();

  const errors: string[] = [];
  const account = store?.account;
  if (account) {
    const ak = preserveExact(account.accessKey || '');
    const sk = preserveExact(account.secretKey || '');
    if (!ak) errors.push('Account Access Key missing');
    if (!sk) errors.push('Account Secret Key missing');
    if (ak && detectCredentialTypeFromAccessKey(ak) !== 'account') {
      errors.push('Account AK must start with fbwb_account_');
    }
  }

  const eventEntries = Object.entries(store?.events || {});
  const seen = new Set<string>();
  for (const [mapKey, row] of eventEntries) {
    const eventUuid = normalize((row as any)?.eventUuid || mapKey);
    const key = normalizeLookupKey(eventUuid || mapKey);
    const accessKeyStored = preserveExact((row as any)?.accessKey || '');
    const secretKeyStored = preserveExact((row as any)?.secretKey || '');
    const credentialSource: FeibotCredentialSource = accessKeyStored ? 'firestore' : 'none';
    let accessKey = accessKeyStored;
    let secretKey = secretKeyStored;

    if (accessKeyStored && (accessKeyStored.startsWith('enc:v1:') || accessKeyStored.startsWith('gcm:') || accessKeyStored.startsWith('b64:'))) {
      try {
        accessKey = await decryptMaybe(accessKeyStored);
      } catch {
        accessKey = accessKeyStored;
      }
    }
    if (secretKeyStored && (secretKeyStored.startsWith('enc:v1:') || secretKeyStored.startsWith('gcm:') || secretKeyStored.startsWith('b64:'))) {
      try {
        secretKey = await decryptMaybe(secretKeyStored);
      } catch {
        secretKey = secretKeyStored;
      }
    }

    console.log('[FEIBOT STARTUP VALIDATION][Event Credential]', {
      firestoreEventId: normalize((row as any)?.eventId || mapKey) || null,
      firestoreEventUuid: eventUuid || null,
      requestedEventUuid: null,
      credentialBoundEventUuid: eventUuid || null,
      credentialSource,
      accessKeyPrefix: accessKey.substring(0, 20) || null,
      decryptedAccessKeyPrefix: accessKeyStored === accessKey ? null : accessKey.substring(0, 20) || null,
    });

    if (seen.has(key)) errors.push(`Duplicate event UUID: ${eventUuid || mapKey}`);
    seen.add(key);

    if (!accessKey) errors.push(`Event Access Key missing for ${eventUuid || mapKey}`);
    if (!secretKey) errors.push(`Event Secret Key missing for ${eventUuid || mapKey}`);
    if (accessKey && detectCredentialTypeFromAccessKey(accessKey) !== 'event') {
      errors.push(`Event AK must start with fbwb_event_ for ${eventUuid || mapKey}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Credential store startup validation failed: ${errors.join('; ')}`);
  }

  startupCredentialValidationDone = true;
}

function detectKeyFormat(value: string) {
  if (value.startsWith('fbwb_')) return 'fbwb_';
  if (value.startsWith('gcm:')) return 'gcm:';
  if (value.startsWith('enc:v1:')) return 'enc:v1:';
  if (value.startsWith('b64:')) return 'b64:';
  return 'other';
}

function sha256Hex(value: string) {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function safePrefix(value: string, length = 12) {
  return preserveExact(value).slice(0, length);
}

function logCredentialIntegrityDiagnostics(params: {
  context: string;
  field: 'accessKey' | 'secretKey';
  original: string;
  decrypted: string;
}) {
  const original = preserveExact(params.original);
  const decrypted = preserveExact(params.decrypted);
  const originalBytes = Buffer.byteLength(original, 'utf8');
  const decryptedBytes = Buffer.byteLength(decrypted, 'utf8');
  const charLengthMatch = original.length === decrypted.length;
  const byteLengthMatch = originalBytes === decryptedBytes;
  const exactMatch = original === decrypted;
  const formatMatch = detectKeyFormat(original) === detectKeyFormat(decrypted);
  const originalSha256 = sha256Hex(original);
  const decryptedSha256 = sha256Hex(decrypted);
  const shaMatch = originalSha256 === decryptedSha256;

  console.log('[FEIBOT CREDENTIAL INTEGRITY]', {
    context: params.context,
    field: params.field,
    originalCharLength: original.length,
    decryptedCharLength: decrypted.length,
    originalByteLength: originalBytes,
    decryptedByteLength: decryptedBytes,
    charLengthMatch,
    byteLengthMatch,
    formatMatch,
    originalPrefix: safePrefix(original),
    decryptedPrefix: safePrefix(decrypted),
    originalSha256: `${originalSha256.slice(0, 10)}...`,
    decryptedSha256: `${decryptedSha256.slice(0, 10)}...`,
    shaMatch,
    exactMatch,
  });

  if (!exactMatch || !byteLengthMatch || !charLengthMatch || !formatMatch || !shaMatch) {
    throw new Error(`Credential ${params.field} integrity validation failed (${params.context})`);
  }
}

async function decryptLegacyRouteCredential(value: string): Promise<string> {
  const text = preserveExact(value);
  if (!text) return '';

  if (text.startsWith('b64:')) {
    return Buffer.from(text.slice(4), 'base64').toString('utf8');
  }

  if (text.startsWith('gcm:')) {
    const key = await getCredentialEncryptionKey();
    if (!key) {
      throw new Error('Credential decryption key is missing for gcm-encrypted Feibot credentials');
    }

    const parts = text.split(':');
    if (parts.length !== 4) {
      throw new Error('Malformed gcm credential payload');
    }

    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encrypted = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  return text;
}

async function decryptMaybe(value: unknown) {
  const text = preserveExact(value);
  if (!text) return '';
  if (isEncryptedSecret(text)) {
    return decryptProviderSecret(text);
  }

  if (text.startsWith('gcm:') || text.startsWith('b64:')) {
    return decryptLegacyRouteCredential(text);
  }

  return text;
}

function toResolvedCredential(input: {
  accountId: string;
  accessKey: string;
  secretKey: string;
  apiBaseUrl?: string;
  credentialType: Exclude<FeibotCredentialType, 'auto'>;
  source: FeibotCredentialSource;
  eventId?: string;
  eventUuid?: string;
  updatedAt?: string;
  storedAccessKeyRaw?: string;
  storedSecretKeyRaw?: string;
}): FeibotResolvedCredential {
  return {
    accountId: normalize(input.accountId) || 'feibot',
    accessKey: preserveExact(input.accessKey),
    secretKey: preserveExact(input.secretKey),
    apiBaseUrl: normalize(input.apiBaseUrl || 'https://apicn.feibot.com') || 'https://apicn.feibot.com',
    credentialType: input.credentialType,
    source: input.source,
    eventId: normalize(input.eventId) || undefined,
    eventUuid: normalize(input.eventUuid) || undefined,
    updatedAt: normalize(input.updatedAt) || undefined,
    storedAccessKeyRaw: preserveExact(input.storedAccessKeyRaw) || undefined,
    storedSecretKeyRaw: preserveExact(input.storedSecretKeyRaw) || undefined,
  };
}

async function readProviderCredentialStore() {
  const db = getFirestoreInstance();
  const snap = await db.doc(GLOBAL_SETTINGS_DOC_PATH).get().catch(() => null);
  const root = snap?.exists ? (snap.data() || {}) : {};
  const store = ((root as any)?.[PROVIDER_CREDENTIALS_FIELD] || {}) as CanonicalProviderCredentialStore;
  return { root, store };
}

async function writeProviderCredentialStore(store: CanonicalProviderCredentialStore) {
  const db = getFirestoreInstance();
  await db.doc(GLOBAL_SETTINGS_DOC_PATH).set({
    [PROVIDER_CREDENTIALS_FIELD]: store,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

async function resolveEventUuidFromEventId(eventId: string): Promise<string | null> {
  const id = normalize(eventId);
  if (!id) return null;
  try {
    const integration = await loadFeibotIntegration(id);
    const candidate = normalize(integration?.eventUuid || integration?.selectedEvent?.uuid || '');
    return candidate || null;
  } catch {
    return null;
  }
}

async function readGlobalCredentialDoc(): Promise<FeibotResolvedCredential | null> {
  const { root, store } = await readProviderCredentialStore();
  const accountEntry = (store?.account || {}) as CanonicalProviderCredentialStore['account'];

  // One-time migration from pre-canonical fields in the same provider settings document.
  const migratedAccessKey = preserveExact((root as any).accountAccessKey || (root as any).accessKey);
  const migratedSecretKey = preserveExact((root as any).accountSecretKey || (root as any).secretKey);

  const accessKeyStored = preserveExact(accountEntry?.accessKey || migratedAccessKey);
  const secretKeyStored = preserveExact(accountEntry?.secretKey || migratedSecretKey);
  if (!accessKeyStored || !secretKeyStored) return null;

  const accessKey = await decryptMaybe(accessKeyStored);
  const secretKey = await decryptMaybe(secretKeyStored);
  if (!accessKey || !secretKey) return null;

  const source: FeibotCredentialSource = accountEntry?.accessKey ? 'firestore' : 'migration';
  if (source === 'migration') {
    const nextStore: CanonicalProviderCredentialStore = {
      ...store,
      account: {
        accessKey: accessKeyStored,
        secretKey: secretKeyStored,
        accountId: normalize((root as any).accountId || (root as any).account || 'feibot') || 'feibot',
        apiBaseUrl: normalize((root as any).apiBaseUrl || 'https://apicn.feibot.com') || 'https://apicn.feibot.com',
        credentialType: 'account',
        updatedAt: new Date().toISOString(),
        updatedBy: 'migration',
      },
    };
    await writeProviderCredentialStore(nextStore);
  }

  return toResolvedCredential({
    accountId: accountEntry?.accountId || (root as any).accountId || (root as any).account || 'feibot',
    accessKey,
    secretKey,
    apiBaseUrl: accountEntry?.apiBaseUrl || (root as any).apiBaseUrl,
    credentialType: 'account',
    source,
    updatedAt: accountEntry?.updatedAt || (root as any).updatedAt,
    storedAccessKeyRaw: accessKeyStored,
    storedSecretKeyRaw: secretKeyStored,
  });
}

async function readEventCredentialDoc(params: { eventId?: string; eventUuid?: string }): Promise<FeibotResolvedCredential | null> {
  const eventUuidCandidate = normalize(await resolveEventUuidFromEventId(params.eventId || '')) || normalize(params.eventUuid || '');
  if (!eventUuidCandidate) return null;

  const { store } = await readProviderCredentialStore();
  const events = (store?.events || {}) as NonNullable<CanonicalProviderCredentialStore['events']>;
  const eventEntry = events[eventUuidCandidate] || events[normalizeLookupKey(eventUuidCandidate)] || null;

  let accessKeyStored = preserveExact(eventEntry?.accessKey || '');
  let secretKeyStored = preserveExact(eventEntry?.secretKey || '');
  let resolvedEventUuid = normalize(eventEntry?.eventUuid || eventUuidCandidate);
  let source: FeibotCredentialSource = eventEntry?.accessKey ? 'firestore' : 'none';

  // One-time migration from per-event provider doc.
  if (!accessKeyStored || !secretKeyStored) {
    const eventId = normalize(params.eventId || '');
    if (eventId) {
      const db = getFirestoreInstance();
      const legacySnap = await db.doc(`events/${eventId}/liveTracking/provider`).get().catch(() => null);
      const legacyData = legacySnap?.exists ? (legacySnap.data() || {}) : null;
      if (legacyData) {
        accessKeyStored = preserveExact((legacyData as any).eventAccessKey || (legacyData as any).accessKey);
        secretKeyStored = preserveExact((legacyData as any).eventSecretKey || (legacyData as any).secretKey);
        resolvedEventUuid = normalize((legacyData as any).boundEventUuid || (legacyData as any).eventUuid || eventUuidCandidate);
        if (accessKeyStored && secretKeyStored && resolvedEventUuid) {
          const nextStore: CanonicalProviderCredentialStore = {
            ...store,
            events: {
              ...(store?.events || {}),
              [resolvedEventUuid]: {
                accessKey: accessKeyStored,
                secretKey: secretKeyStored,
                eventUuid: resolvedEventUuid,
                accountId: normalize((legacyData as any).accountId || (legacyData as any).account || 'feibot') || 'feibot',
                apiBaseUrl: normalize((legacyData as any).apiBaseUrl || 'https://apicn.feibot.com') || 'https://apicn.feibot.com',
                credentialType: 'event',
                updatedAt: new Date().toISOString(),
                updatedBy: 'migration',
                eventId,
              },
            },
          };
          await writeProviderCredentialStore(nextStore);
          source = 'migration';
        }
      }
    }
  }

  if (!accessKeyStored || !secretKeyStored || !resolvedEventUuid) return null;

  const accessKey = await decryptMaybe(accessKeyStored);
  const secretKey = await decryptMaybe(secretKeyStored);
  if (!accessKey || !secretKey) return null;

  return toResolvedCredential({
    accountId: eventEntry?.accountId || 'feibot',
    accessKey,
    secretKey,
    apiBaseUrl: eventEntry?.apiBaseUrl,
    credentialType: 'event',
    source,
    eventId: normalize(params.eventId),
    eventUuid: resolvedEventUuid,
    updatedAt: eventEntry?.updatedAt,
    storedAccessKeyRaw: accessKeyStored,
    storedSecretKeyRaw: secretKeyStored,
  });
}

export async function getStoredFeibotGlobalCredential(): Promise<FeibotResolvedCredential | null> {
  const envAccessKey = preserveExact(process.env.FEIBOT_ACCESS_KEY);
  const envSecretKey = preserveExact(process.env.FEIBOT_SECRET_KEY);
  if (envAccessKey && envSecretKey) {
    return toResolvedCredential({
      accountId: normalize(process.env.FEIBOT_ACCOUNT || 'feibot') || 'feibot',
      accessKey: envAccessKey,
      secretKey: envSecretKey,
      apiBaseUrl: normalize(process.env.FEIBOT_API_BASE_URL || 'https://apicn.feibot.com') || 'https://apicn.feibot.com',
      credentialType: 'account',
      source: 'env',
    });
  }

  return readGlobalCredentialDoc();
}

export async function getStoredFeibotEventCredential(eventRef: string): Promise<FeibotResolvedCredential | null> {
  const normalized = normalize(eventRef);
  if (!normalized) return null;
  if (isLikelyFeibotEventUuid(normalized)) {
    return readEventCredentialDoc({ eventUuid: normalized });
  }
  return readEventCredentialDoc({ eventId: normalized });
}

export async function getStoredFeibotAnyEventCredential(): Promise<FeibotResolvedCredential | null> {
  const { store } = await readProviderCredentialStore();
  const entries = Object.entries(store?.events || {});
  for (const [eventUuid, row] of entries) {
    const candidate = await readEventCredentialDoc({ eventUuid }).catch(() => null);
    if (candidate?.accessKey && candidate?.secretKey) {
      return candidate;
    }

    const accessKeyStored = preserveExact((row as any)?.accessKey || '');
    const secretKeyStored = preserveExact((row as any)?.secretKey || '');
    if (!accessKeyStored || !secretKeyStored) continue;
    const accessKey = await decryptMaybe(accessKeyStored).catch(() => accessKeyStored);
    const secretKey = await decryptMaybe(secretKeyStored).catch(() => secretKeyStored);
    if (!accessKey || !secretKey) continue;

    return toResolvedCredential({
      accountId: normalize((row as any)?.accountId || 'feibot') || 'feibot',
      accessKey,
      secretKey,
      apiBaseUrl: (row as any)?.apiBaseUrl,
      credentialType: 'event',
      source: 'firestore',
      eventUuid: normalize((row as any)?.eventUuid || eventUuid) || eventUuid,
      eventId: normalize((row as any)?.eventId),
      updatedAt: (row as any)?.updatedAt,
      storedAccessKeyRaw: accessKeyStored,
      storedSecretKeyRaw: secretKeyStored,
    });
  }

  return null;
}

export async function getFeibotCredentialBundle(params: {
  eventId?: string;
  eventUuid?: string;
  credentialType?: FeibotCredentialType;
} = {}): Promise<FeibotCredentialBundle> {
  await validateCredentialStoreOnStartup();
  const requestedMode = params.credentialType || 'auto';
  const requestedEventUuid = normalize(params.eventUuid || '') || normalize(await resolveEventUuidFromEventId(params.eventId || ''));
  const [event, account] = await Promise.all([
    readEventCredentialDoc({ eventId: params.eventId, eventUuid: requestedEventUuid || undefined }),
    getStoredFeibotGlobalCredential(),
  ]);

  const eventConfigured = Boolean(event?.accessKey && event?.secretKey);
  const accountConfigured = Boolean(account?.accessKey && account?.secretKey);

  const selectedMode: Exclude<FeibotCredentialType, 'auto'> | null =
    requestedMode === 'event'
      ? (eventConfigured ? 'event' : null)
      : requestedMode === 'account'
        ? (accountConfigured ? 'account' : null)
        : (eventConfigured ? 'event' : accountConfigured ? 'account' : null);

  const selected = selectedMode === 'event' ? event : selectedMode === 'account' ? account : null;

  const storePreview = {
    account: account ? {
      accessKeyPrefix: maskPrefix(account.accessKey, 14),
      credentialType: detectCredentialTypeFromAccessKey(account.accessKey),
      eventUuid: null,
    } : null,
    events: event ? {
      [String(event.eventUuid || requestedEventUuid || 'unknown')]: {
        accessKeyPrefix: maskPrefix(event.accessKey, 14),
        credentialType: detectCredentialTypeFromAccessKey(event.accessKey),
        eventUuid: event.eventUuid || null,
      },
    } : {},
  };

  console.log('[FEIBOT CREDENTIAL STORE]', storePreview);

  if (selected) {
    validateResolvedCredential({ credential: selected, requestedMode, requestedEventUuid });

    const actualCredentialType = detectCredentialTypeFromAccessKey(selected.accessKey);
    const storedAk = preserveExact(selected.storedAccessKeyRaw || '');
    const decryptedAk = preserveExact(selected.accessKey || '');
    const storedSk = preserveExact(selected.storedSecretKeyRaw || '');
    const decryptedSk = preserveExact(selected.secretKey || '');
    const akHashMatch = storedAk
      ? sha256Hex(preserveExact(await decryptMaybe(storedAk))) === sha256Hex(decryptedAk)
      : true;
    const skHashMatch = storedSk
      ? sha256Hex(preserveExact(await decryptMaybe(storedSk))) === sha256Hex(decryptedSk)
      : true;

    console.log('[Credential Selected]', {
      requestedMode,
      resolvedMode: selectedMode,
      credentialType: selected.credentialType,
      actualCredentialType,
      credentialSource: selected.source,
      accessKeyPrefix: maskPrefix(selected.accessKey, 16),
      eventUuid: requestedEventUuid || null,
      boundEventUuid: selected.eventUuid || null,
      eventId: normalize(params.eventId) || null,
      storedAkPrefix: safePrefix(storedAk),
      storedAkLength: storedAk.length,
      decryptedAkPrefix: safePrefix(decryptedAk),
      decryptedAkLength: decryptedAk.length,
      storedSkPrefix: safePrefix(storedSk),
      storedSkLength: storedSk.length,
      decryptedSkPrefix: safePrefix(decryptedSk),
      decryptedSkLength: decryptedSk.length,
      akHashMatch,
      skHashMatch,
    });
  }

  return {
    requestedMode,
    selectedMode,
    selected,
    event,
    account,
    eventConfigured,
    accountConfigured,
  };
}

export async function saveFeibotGlobalCredential(params: {
  accountId: string;
  accessKey: string;
  secretKey: string;
  apiBaseUrl?: string;
  updatedBy?: string;
}) {
  const db = getFirestoreInstance();
  const now = new Date().toISOString();
  const accessKeyOriginal = preserveExact(params.accessKey);
  const secretKeyOriginal = preserveExact(params.secretKey);
  const encryptedAccessKey = encryptProviderSecret(accessKeyOriginal);
  const encryptedSecretKey = encryptProviderSecret(secretKeyOriginal);

  const decryptedAccessKey = decryptProviderSecret(encryptedAccessKey);
  const decryptedSecretKey = decryptProviderSecret(encryptedSecretKey);
  logCredentialIntegrityDiagnostics({
    context: 'saveFeibotGlobalCredential',
    field: 'accessKey',
    original: accessKeyOriginal,
    decrypted: decryptedAccessKey,
  });
  logCredentialIntegrityDiagnostics({
    context: 'saveFeibotGlobalCredential',
    field: 'secretKey',
    original: secretKeyOriginal,
    decrypted: decryptedSecretKey,
  });
  const payload = {
    accountId: normalize(params.accountId || 'feibot') || 'feibot',
    accountAccessKey: encryptedAccessKey,
    accountSecretKey: encryptedSecretKey,
    apiBaseUrl: normalize(params.apiBaseUrl || 'https://apicn.feibot.com') || 'https://apicn.feibot.com',
    updatedAt: now,
    updatedBy: normalize(params.updatedBy || 'admin') || 'admin',
    credentialType: 'account',
  };

  const { store } = await readProviderCredentialStore();
  const nextStore: CanonicalProviderCredentialStore = {
    ...store,
    account: {
      accessKey: encryptedAccessKey,
      secretKey: encryptedSecretKey,
      accountId: payload.accountId,
      apiBaseUrl: payload.apiBaseUrl,
      credentialType: 'account',
      updatedAt: now,
      updatedBy: payload.updatedBy,
    },
  };

  await db.doc(GLOBAL_SETTINGS_DOC_PATH).set({
    [PROVIDER_CREDENTIALS_FIELD]: nextStore,
    updatedAt: now,
    updatedBy: payload.updatedBy,
  }, { merge: true });

  return payload;
}

export async function saveFeibotEventCredential(params: {
  eventId: string;
  eventUuid?: string;
  boundEventUuid?: string;
  accessKey: string;
  secretKey: string;
  apiBaseUrl?: string;
  updatedBy?: string;
}) {
  const db = getFirestoreInstance();
  const eventId = normalize(params.eventId);
  if (!eventId) throw new Error('eventId is required');
  const now = new Date().toISOString();
  const accessKeyOriginal = preserveExact(params.accessKey);
  const secretKeyOriginal = preserveExact(params.secretKey);
  const encryptedAccessKey = encryptProviderSecret(accessKeyOriginal);
  const encryptedSecretKey = encryptProviderSecret(secretKeyOriginal);

  const decryptedAccessKey = decryptProviderSecret(encryptedAccessKey);
  const decryptedSecretKey = decryptProviderSecret(encryptedSecretKey);
  logCredentialIntegrityDiagnostics({
    context: 'saveFeibotEventCredential',
    field: 'accessKey',
    original: accessKeyOriginal,
    decrypted: decryptedAccessKey,
  });
  logCredentialIntegrityDiagnostics({
    context: 'saveFeibotEventCredential',
    field: 'secretKey',
    original: secretKeyOriginal,
    decrypted: decryptedSecretKey,
  });
  const boundEventUuid = normalize(params.boundEventUuid || params.eventUuid);
  if (!boundEventUuid) {
    throw new Error('boundEventUuid is required for event credentials');
  }
  if (!isLikelyFeibotEventUuid(boundEventUuid)) {
    throw new Error('Wrong Event Credential');
  }
  const payload = {
    eventId,
    boundEventUuid,
    eventUuid: boundEventUuid,
    eventAccessKey: encryptedAccessKey,
    eventSecretKey: encryptedSecretKey,
    apiBaseUrl: normalize(params.apiBaseUrl || 'https://apicn.feibot.com') || 'https://apicn.feibot.com',
    credentialType: 'event',
    updatedAt: now,
    updatedBy: normalize(params.updatedBy || 'admin') || 'admin',
  };

  const { store } = await readProviderCredentialStore();
  const nextStore: CanonicalProviderCredentialStore = {
    ...store,
    events: {
      ...(store?.events || {}),
      [boundEventUuid]: {
        accessKey: encryptedAccessKey,
        secretKey: encryptedSecretKey,
        eventUuid: boundEventUuid,
        eventId,
        accountId: normalize((store?.account as any)?.accountId || 'feibot') || 'feibot',
        apiBaseUrl: payload.apiBaseUrl,
        credentialType: 'event',
        updatedAt: now,
        updatedBy: payload.updatedBy,
      },
    },
  };

  await db.doc(GLOBAL_SETTINGS_DOC_PATH).set({
    [PROVIDER_CREDENTIALS_FIELD]: nextStore,
    updatedAt: now,
    updatedBy: payload.updatedBy,
  }, { merge: true });

  // Keep event-scoped mirror for compatibility/debug UI, but resolver reads canonical providerCredentials only.
  await db.doc(`events/${eventId}/liveTracking/provider`).set(payload, { merge: true });
  return payload;
}

/**
 * Save a new Feibot connection
 * Credentials are encrypted before storage
 */
export async function saveFeibotConnection(
  accountId: string,
  accessKey: string,
  secretKey: string,
  userId: string,
  options: {
    accountName?: string;
    apiBaseUrl?: string;
    environment?: 'production' | 'staging' | 'sandbox';
  } = {}
): Promise<{ connectionId: string; connection: FeibotConnection }> {
  const db = getFirestoreInstance();
  
  // Encrypt credentials
  const accessKeyOriginal = preserveExact(accessKey);
  const secretKeyOriginal = preserveExact(secretKey);
  const encryptedAccessKey = encryptProviderSecret(accessKeyOriginal);
  const encryptedSecretKey = encryptProviderSecret(secretKeyOriginal);

  const decryptedAccessKey = decryptProviderSecret(encryptedAccessKey);
  const decryptedSecretKey = decryptProviderSecret(encryptedSecretKey);
  logCredentialIntegrityDiagnostics({
    context: 'saveFeibotConnection',
    field: 'accessKey',
    original: accessKeyOriginal,
    decrypted: decryptedAccessKey,
  });
  logCredentialIntegrityDiagnostics({
    context: 'saveFeibotConnection',
    field: 'secretKey',
    original: secretKeyOriginal,
    decrypted: decryptedSecretKey,
  });
  
  if (!encryptedAccessKey || !encryptedSecretKey) {
    throw new Error('Failed to encrypt credentials');
  }
  
  const now = new Date().toISOString();
  
  const connection: FeibotConnection = {
    connectionId: '', // Will be set by Firestore
    accountId,
    accountName: options.accountName,
    encryptedAccessKey,
    encryptedSecretKey,
    encryptionVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    status: 'testing', // Start as testing until we verify credentials
    apiBaseUrl: options.apiBaseUrl || 'https://apicn.feibot.com',
    environment: options.environment || 'production',
    failureCount: 0,
    consecutiveFailures: 0,
  };
  
  // Save to Firestore
  const docRef = await db.collection(COLLECTION_NAME).add(connection);
  
  return {
    connectionId: docRef.id,
    connection: {
      ...connection,
      connectionId: docRef.id,
    },
  };
}

/**
 * Get a Feibot connection and decrypt credentials
 */
export async function getFeibotConnection(
  connectionId: string
): Promise<FeibotConnection | null> {
  const db = getFirestoreInstance();
  
  try {
    const doc = await db.collection(COLLECTION_NAME).doc(connectionId).get();
    
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data();
    return {
      ...data,
      connectionId: doc.id,
    } as FeibotConnection;
  } catch (error) {
    console.error(`Error retrieving Feibot connection ${connectionId}:`, error);
    return null;
  }
}

/**
 * Get decrypted API credentials for making requests
 */
export async function getDecryptedCredentials(
  connectionId: string
): Promise<FeibotAPIConfig | null> {
  const connection = await getFeibotConnection(connectionId);
  
  if (!connection) {
    return null;
  }
  
  const accessKey = decryptProviderSecret(connection.encryptedAccessKey);
  const secretKey = decryptProviderSecret(connection.encryptedSecretKey);
  
  if (!accessKey || !secretKey) {
    throw new Error('Failed to decrypt credentials');
  }
  
  return {
    accountId: connection.accountId,
    accessKey,
    secretKey,
    apiBaseUrl: connection.apiBaseUrl,
  };
}

/**
 * Get all Feibot connections for an account
 */
export async function getAccountConnections(
  accountId: string
): Promise<FeibotConnection[]> {
  const db = getFirestoreInstance();
  
  try {
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('accountId', '==', accountId)
      .get();
    
    return snapshot.docs.map((doc) => ({
      ...doc.data(),
      connectionId: doc.id,
    })) as FeibotConnection[];
  } catch (error) {
    console.error(`Error retrieving connections for account ${accountId}:`, error);
    return [];
  }
}

/**
 * Update connection status
 */
export async function updateConnectionStatus(
  connectionId: string,
  status: FeibotConnection['status'],
  metadata: {
    lastSuccessfulConnection?: string;
    lastSuccessfulSync?: string;
    lastFailedAttempt?: string;
    failureCount?: number;
    consecutiveFailures?: number;
    statusReason?: string;
  } = {}
): Promise<void> {
  const db = getFirestoreInstance();
  
  const updateData: any = {
    status,
    updatedAt: new Date().toISOString(),
    ...metadata,
  };
  
  await db.collection(COLLECTION_NAME).doc(connectionId).update(updateData);
}

/**
 * Mark a successful connection
 */
export async function markConnectionSuccessful(
  connectionId: string
): Promise<void> {
  const now = new Date().toISOString();
  
  await updateConnectionStatus(connectionId, 'active', {
    lastSuccessfulConnection: now,
    failureCount: 0,
    consecutiveFailures: 0,
    statusReason: undefined,
  });
}

/**
 * Record a connection failure
 */
export async function recordConnectionFailure(
  connectionId: string,
  reason: string
): Promise<void> {
  const connection = await getFeibotConnection(connectionId);
  
  if (!connection) {
    throw new Error(`Connection ${connectionId} not found`);
  }
  
  const failureCount = (connection.failureCount || 0) + 1;
  const consecutiveFailures = (connection.consecutiveFailures || 0) + 1;
  
  // Mark as failed if too many consecutive failures
  const status = consecutiveFailures >= 5 ? 'failed' : 'active';
  
  await updateConnectionStatus(connectionId, status, {
    lastFailedAttempt: new Date().toISOString(),
    failureCount,
    consecutiveFailures,
    statusReason: reason,
  });
}

/**
 * Delete a Feibot connection
 */
export async function deleteFeibotConnection(connectionId: string): Promise<void> {
  const db = getFirestoreInstance();
  
  await db.collection(COLLECTION_NAME).doc(connectionId).delete();
}
