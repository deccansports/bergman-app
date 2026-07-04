import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getFeibotCredentialBundle, getStoredFeibotAnyEventCredential, getStoredFeibotGlobalCredential, type FeibotCredentialType } from './credentials';
import { loadFeibotIntegrationSecrets } from './integration-store';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function preserveExact(value: unknown) {
  return String(value ?? '');
}

/** Synchronous — reads from env vars only. Throws if not configured. */
export function getFeibotRuntimeSecrets() {
  const accessKey = preserveExact(process.env.FEIBOT_ACCESS_KEY);
  const secretKey = preserveExact(process.env.FEIBOT_SECRET_KEY);
  const accountId = normalize(process.env.FEIBOT_ACCOUNT || 'feibot');
  const apiBaseUrl = normalize(process.env.FEIBOT_API_BASE_URL || 'https://apicn.feibot.com') || 'https://apicn.feibot.com';

  if (!accessKey || !secretKey) {
    throw new Error('Feibot secrets are not configured. Set FEIBOT_ACCESS_KEY and FEIBOT_SECRET_KEY (or update via Admin Panel).');
  }

  return { accountId, accessKey, secretKey, apiBaseUrl };
}

export function resolveFeibotRuntimeEventUuid(params: {
  endpoint?: string;
  credentialType?: Exclude<FeibotCredentialType, 'auto'> | 'auto' | null;
  credentialBoundEventUuid?: string | null;
  cloudEventUuid?: string | null;
  providerEventUuid?: string | null;
  manualEventUuid?: string | null;
  requestedEventUuid?: string | null;
}) {
  const credentialType = params.credentialType === 'event' || params.credentialType === 'account'
    ? params.credentialType
    : 'account';
  const credentialBoundEventUuid = normalize(params.credentialBoundEventUuid || '');
  const cloudEventUuid = normalize(params.cloudEventUuid || '');
  const providerEventUuid = normalize(params.providerEventUuid || '');
  const manualEventUuid = normalize(params.manualEventUuid || '');
  const requestedEventUuid = normalize(params.requestedEventUuid || '');

  const resolvedEventUuid = credentialType === 'event'
    ? credentialBoundEventUuid
    : cloudEventUuid || providerEventUuid || manualEventUuid || requestedEventUuid || '';

  if (credentialType === 'event' && resolvedEventUuid !== credentialBoundEventUuid) {
    throw new Error('Runtime resolved incorrect Event UUID for Event Credential');
  }

  return {
    endpoint: normalize(params.endpoint || '') || null,
    credentialType,
    credentialBoundEventUuid: credentialBoundEventUuid || null,
    cloudEventUuid: cloudEventUuid || null,
    manualEventUuid: manualEventUuid || requestedEventUuid || null,
    resolvedEventUuid: resolvedEventUuid || null,
  };
}

/**
 * Async — reads from env vars first, then falls back to Firestore-stored credentials.
 * Use this in routes where the admin may have updated credentials via the Admin Panel.
 */
export async function getFeibotRuntimeSecretsAsync(): Promise<{
  accountId: string;
  accessKey: string;
  secretKey: string;
  apiBaseUrl: string;
  source: 'env' | 'firestore';
  credentialType?: Exclude<FeibotCredentialType, 'auto'> | 'account' | 'event';
  eventId?: string;
  eventUuid?: string;
  fallbackAvailable?: boolean;
  selectedMode?: Exclude<FeibotCredentialType, 'auto'> | null;
  selectedCredentialType?: 'account' | 'event' | null;
  actualCredentialType?: 'account' | 'event' | 'unknown' | null;
  resolvedCredentialSource?: string | null;
}> {
  return getFeibotRuntimeSecretsAsyncForEvent({});
}

export async function getFeibotRuntimeSecretsAsyncForEvent(params: {
  eventId?: string;
  eventUuid?: string;
  credentialType?: FeibotCredentialType;
}): Promise<{
  accountId: string;
  accessKey: string;
  secretKey: string;
  apiBaseUrl: string;
  source: 'env' | 'firestore';
  credentialType: Exclude<FeibotCredentialType, 'auto'> | 'account' | 'event';
  eventId?: string;
  eventUuid?: string;
  fallbackAvailable: boolean;
  selectedMode?: Exclude<FeibotCredentialType, 'auto'> | null;
  selectedCredentialType?: 'account' | 'event' | null;
  actualCredentialType?: 'account' | 'event' | 'unknown' | null;
  resolvedCredentialSource?: string | null;
}> {
  const envSk = preserveExact(process.env.FEIBOT_SECRET_KEY);
  const envAkExact = preserveExact(process.env.FEIBOT_ACCESS_KEY);

  if (envAkExact && envSk) {
    return {
      accountId: normalize(process.env.FEIBOT_ACCOUNT || 'feibot'),
      accessKey: envAkExact,
      secretKey: envSk,
      apiBaseUrl: normalize(process.env.FEIBOT_API_BASE_URL || 'https://apicn.feibot.com') || 'https://apicn.feibot.com',
      source: 'env',
      credentialType: 'account',
      fallbackAvailable: false,
    };
  }

  if (params.eventId) {
    const integrationSecrets = await loadFeibotIntegrationSecrets(params.eventId).catch(() => null);
    if (!integrationSecrets) {
      throw new Error('No Feibot Event UUID configured. Authenticate and discover events first.');
    }

    return {
      accountId: integrationSecrets.accountId,
      accessKey: integrationSecrets.accessKey,
      secretKey: integrationSecrets.secretKey,
      apiBaseUrl: integrationSecrets.apiBaseUrl,
      source: 'firestore',
      credentialType: 'event',
      eventId: integrationSecrets.eventId,
      eventUuid: integrationSecrets.eventUuid,
      fallbackAvailable: false,
      selectedMode: 'event',
      selectedCredentialType: 'event',
      actualCredentialType: integrationSecrets.accessKey.startsWith('fbwb_event_') ? 'event' : integrationSecrets.accessKey.startsWith('fbwb_account_') ? 'account' : 'unknown',
      resolvedCredentialSource: integrationSecrets.source,
    };
  }

  const bundle = await getFeibotCredentialBundle({
    eventId: params.eventId,
    eventUuid: params.eventUuid,
    credentialType: params.credentialType || 'auto',
  });

  const detectType = (accessKey: string): 'account' | 'event' | 'unknown' => {
    if (accessKey.startsWith('fbwb_account_')) return 'account';
    if (accessKey.startsWith('fbwb_event_')) return 'event';
    return 'unknown';
  };

  const selected = bundle.selected || bundle.event || bundle.account;
  if (selected?.accessKey && selected?.secretKey) {
    const actualCredentialType = detectType(selected.accessKey);
    console.log('[FEIBOT CREDENTIAL RESOLUTION][Selected]', {
      firestoreEventId: normalize(params.eventId || '') || null,
      firestoreEventUuid: normalize(params.eventUuid || '') || null,
      requestedEventUuid: normalize(params.eventUuid || '') || null,
      credentialBoundEventUuid: normalize(selected.eventUuid || '') || null,
      credentialSource: selected.source,
      accessKeyPrefix: selected.accessKey.substring(0, 20) || null,
    });
    return {
      accountId: selected.accountId,
      accessKey: selected.accessKey,
      secretKey: selected.secretKey,
      apiBaseUrl: selected.apiBaseUrl,
      source: 'firestore',
      credentialType: selected.credentialType,
      eventId: selected.eventId,
      eventUuid: selected.eventUuid,
      fallbackAvailable: bundle.eventConfigured && bundle.accountConfigured,
      selectedMode: bundle.selectedMode,
      selectedCredentialType: selected.credentialType,
      actualCredentialType,
      resolvedCredentialSource: selected.source,
    };
  }

  // Fallback: read from Firestore (legacy credentials stored via Admin Panel)
  try {
    const stored = await getStoredFeibotGlobalCredential();
    if (stored?.accessKey && stored?.secretKey) {
      const actualCredentialType = detectType(stored.accessKey);
      console.log('[FEIBOT CREDENTIAL RESOLUTION][Fallback Global]', {
        firestoreEventId: normalize(params.eventId || '') || null,
        firestoreEventUuid: normalize(params.eventUuid || '') || null,
        requestedEventUuid: normalize(params.eventUuid || '') || null,
        credentialBoundEventUuid: normalize(stored.eventUuid || '') || null,
        credentialSource: stored.source,
        accessKeyPrefix: stored.accessKey.substring(0, 20) || null,
      });
      return {
        accountId: stored.accountId,
        accessKey: stored.accessKey,
        secretKey: stored.secretKey,
        apiBaseUrl: stored.apiBaseUrl || 'https://apicn.feibot.com',
        source: 'firestore',
        credentialType: 'account',
        fallbackAvailable: false,
        selectedMode: 'account',
        selectedCredentialType: 'account',
        actualCredentialType,
        resolvedCredentialSource: stored.source,
      };
    }
  } catch {
    // Firestore read failed — fall through to error
  }

  if (!params.eventId && !params.eventUuid) {
    try {
      const storedAnyEvent = await getStoredFeibotAnyEventCredential();
      if (storedAnyEvent?.accessKey && storedAnyEvent?.secretKey) {
        const actualCredentialType = detectType(storedAnyEvent.accessKey);
        console.log('[FEIBOT CREDENTIAL RESOLUTION][Fallback Any Event]', {
          firestoreEventId: null,
          firestoreEventUuid: normalize(storedAnyEvent.eventUuid || '') || null,
          requestedEventUuid: null,
          credentialBoundEventUuid: normalize(storedAnyEvent.eventUuid || '') || null,
          credentialSource: storedAnyEvent.source,
          accessKeyPrefix: storedAnyEvent.accessKey.substring(0, 20) || null,
        });
        return {
          accountId: storedAnyEvent.accountId,
          accessKey: storedAnyEvent.accessKey,
          secretKey: storedAnyEvent.secretKey,
          apiBaseUrl: storedAnyEvent.apiBaseUrl || 'https://apicn.feibot.com',
          source: 'firestore',
          credentialType: 'event',
          fallbackAvailable: false,
          selectedMode: 'event',
          selectedCredentialType: 'event',
          actualCredentialType,
          resolvedCredentialSource: storedAnyEvent.source,
          eventUuid: storedAnyEvent.eventUuid,
          eventId: storedAnyEvent.eventId,
        };
      }
    } catch {
      // ignore and fall through to error
    }
  }

  throw new Error('Feibot credentials not configured. Set FEIBOT_ACCESS_KEY/FEIBOT_SECRET_KEY or use Admin Panel → Provider → Feibot Authentication → Update Credentials.');
}

export async function getEventFeibotUuids(eventId: string) {
  const db = getFirestoreInstance();
  const snap = await db.collection('events').doc(eventId).get();
  const data = snap.exists ? snap.data() || {} : {};

  const top = (data as any)?.feibotConfig || {};
  const hub = (data as any)?.liveTrackingHub?.feibotConfig || {};
  const cloud = hub?.cloud || {};
  const score = hub?.score || {};

  return {
    eventUuid: normalize(top?.eventUuid || cloud?.eventUuid || hub?.eventUuid),
    scoreEventUuid: normalize(score?.eventUuid || top?.scoreEventUuid || hub?.scoreEventUuid),
  };
}
