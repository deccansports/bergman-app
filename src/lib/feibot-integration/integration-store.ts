import { getFirestoreInstance } from '@/lib/firebaseAdmin';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

export type FeibotIntegrationSelectedEvent = {
  uuid: string;
  name: string;
  cloudUuid?: string | null;
};

export type FeibotIntegrationEvent = {
  uuid: string;
  name: string;
};

export type FeibotIntegrationDocument = {
  authenticated?: boolean;
  credentialsValid?: boolean;
  status?: string;
  credentialType?: 'account' | 'event' | 'auto' | null;
  eventUuid?: string | null;
  cloudEventUuid?: string | null;
  credentialBoundEventUuid?: string | null;
  selectedEvent?: FeibotIntegrationSelectedEvent | null;
  events?: FeibotIntegrationEvent[];
  eventsCount?: number;
  updatedAt?: string | null;
  [key: string]: any;
};

export type FeibotIntegrationSecrets = {
  eventId: string;
  eventUuid: string;
  cloudEventUuid: string | null;
  credentialBoundEventUuid: string | null;
  credentialType: 'account' | 'event' | 'auto' | null;
  accountId: string;
  accessKey: string;
  secretKey: string;
  apiBaseUrl: string;
  source: 'integration-store';
  integration: FeibotIntegrationDocument;
};

export async function loadFeibotIntegration(eventId: string): Promise<FeibotIntegrationDocument | null> {
  const id = normalize(eventId);
  if (!id) return null;

  const db = getFirestoreInstance();
  const snap = await db.collection('events').doc(id).collection('integrations').doc('feibot').get().catch(() => null);
  if (!snap?.exists) return null;

  const data = snap.data() || {};
  return {
    ...data,
    credentialType: data?.credentialType || null,
    eventUuid: normalize(data?.eventUuid) || null,
    cloudEventUuid: normalize(data?.cloudEventUuid) || null,
    credentialBoundEventUuid: normalize(data?.credentialBoundEventUuid) || null,
    selectedEvent: data?.selectedEvent && typeof data.selectedEvent === 'object'
      ? {
          uuid: normalize(data.selectedEvent.uuid),
          name: normalize(data.selectedEvent.name),
          cloudUuid: normalize(data.selectedEvent.cloudUuid) || null,
        }
      : null,
    events: Array.isArray(data?.events)
      ? data.events.map((row: any) => ({ uuid: normalize(row?.uuid), name: normalize(row?.name) }))
      : [],
    eventsCount: Number(data?.eventsCount || 0) || 0,
  } as FeibotIntegrationDocument;
}

export async function saveFeibotIntegration(eventId: string, payload: FeibotIntegrationDocument) {
  const id = normalize(eventId);
  if (!id) throw new Error('eventId is required');

  const db = getFirestoreInstance();
  const now = new Date().toISOString();
  const ref = db.collection('events').doc(id).collection('integrations').doc('feibot');
  await ref.set(
    {
      ...payload,
      credentialType: payload?.credentialType || null,
      eventUuid: normalize(payload?.eventUuid) || null,
      cloudEventUuid: normalize(payload?.cloudEventUuid) || null,
      credentialBoundEventUuid: normalize(payload?.credentialBoundEventUuid) || null,
      selectedEvent: payload?.selectedEvent && typeof payload.selectedEvent === 'object'
        ? {
            uuid: normalize(payload.selectedEvent.uuid) || null,
            name: normalize(payload.selectedEvent.name) || null,
            cloudUuid: normalize(payload.selectedEvent.cloudUuid) || null,
          }
        : null,
      events: Array.isArray(payload?.events)
        ? payload.events.map((row: any) => ({ uuid: normalize(row?.uuid) || null, name: normalize(row?.name) || null }))
        : [],
      eventsCount: Number(payload?.eventsCount || (Array.isArray(payload?.events) ? payload.events.length : 0)) || 0,
      authenticated: Boolean(payload?.authenticated),
      credentialsValid: Boolean(payload?.credentialsValid),
      updatedAt: payload?.updatedAt || now,
    },
    { merge: true },
  );

  const saved = await ref.get();
  return { ref, data: (saved.data() || {}) as FeibotIntegrationDocument };
}

export async function loadFeibotIntegrationSecrets(eventId: string): Promise<FeibotIntegrationSecrets | null> {
  const id = normalize(eventId);
  if (!id) return null;

  const integration = await loadFeibotIntegration(id);
  const credentialType = integration?.credentialType || null;
  const cloudEventUuid = normalize(integration?.cloudEventUuid || integration?.selectedEvent?.cloudUuid || integration?.eventUuid) || null;
  const credentialBoundEventUuid = normalize(integration?.credentialBoundEventUuid || integration?.eventUuid) || null;
  const eventUuid = credentialType === 'event' ? credentialBoundEventUuid : cloudEventUuid;
  if (!eventUuid) return null;

  const { getStoredFeibotEventCredential } = await import('./credentials');
  const credential = await getStoredFeibotEventCredential(eventUuid);
  if (!credential?.accessKey || !credential?.secretKey) return null;

  return {
    eventId: id,
    eventUuid,
    cloudEventUuid,
    credentialBoundEventUuid,
    credentialType,
    accountId: credential.accountId || 'feibot',
    accessKey: credential.accessKey,
    secretKey: credential.secretKey,
    apiBaseUrl: credential.apiBaseUrl || 'https://apicn.feibot.com',
    source: 'integration-store',
    integration: integration || {},
  };
}