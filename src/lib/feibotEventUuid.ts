import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV } from '@/lib/cloudflare/kv';
import { loadFeibotIntegration } from './feibot-integration/integration-store';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function firstNonEmpty(...values: Array<unknown>) {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) return normalized;
  }
  return '';
}

export type FeibotEventUuidResolution = {
  eventId: string;
  resolvedEventUuid: string | null;
  cloudEventUuid: string | null;
  firestoreEventUuid: string | null;
  manualEventUuid: string | null;
  legacyEventUuid: string | null;
  source: 'cloud' | 'firestore' | 'manual' | 'legacy' | 'none';
  apiBaseUrl: string;
};

export async function resolveFeibotEventUuid(eventId: string, manualEventUuid?: string | null): Promise<FeibotEventUuidResolution> {
  const normalizedEventId = normalize(eventId);

  if (!normalizedEventId) {
    return {
      eventId: '',
      resolvedEventUuid: null,
      cloudEventUuid: null,
      firestoreEventUuid: null,
      manualEventUuid: null,
      legacyEventUuid: null,
      source: 'none',
      apiBaseUrl: process.env.FEIBOT_API_BASE_URL || 'https://apicn.feibot.com',
    };
  }

  const integration = await loadFeibotIntegration(normalizedEventId).catch(() => null);
  const resolvedEventUuid = normalize(integration?.eventUuid || integration?.selectedEvent?.uuid || '') || null;

  return {
    eventId: normalizedEventId,
    resolvedEventUuid,
    cloudEventUuid: null,
    firestoreEventUuid: resolvedEventUuid,
    manualEventUuid: null,
    legacyEventUuid: null,
    source: resolvedEventUuid ? 'firestore' : 'none',
    apiBaseUrl: firstNonEmpty(
      process.env.FEIBOT_API_BASE_URL,
      'https://apicn.feibot.com',
    ),
  };
}
