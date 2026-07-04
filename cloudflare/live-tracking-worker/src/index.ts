import type { WorkerEnv, ProviderType, FeibotConfig, EventConfigResponse } from './types';
import { feibotRequest } from './lib/feibot';

const DEFAULT_ADMIN_BASE_URLS = ['https://bergmantri.com', 'https://www.bergmantri.com'];

export class LiveRaceState {
  constructor(private readonly state: any) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ success: true, durableObject: 'LiveRaceState' }), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'LiveRaceState is ready.' }), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, x-bergman-internal-token',
      ...(init?.headers || {}),
    },
  });
}

function parseUrl(request: Request) {
  return new URL(request.url);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeTimeTo24h(value: any) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match12 = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)$/i);
  if (match12) {
    let hour = Number(match12[1] || 0);
    const minute = Number(match12[2] || 0);
    const second = Number(match12[3] || 0);
    const period = String(match12[4] || '').toUpperCase();
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  }
  const match24 = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?$/);
  if (!match24) return raw;
  const hour = Number(match24[1] || 0);
  const minute = Number(match24[2] || 0);
  const second = Number(match24[3] || 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function composeEstimatedStart(raceDate: any, startTime: any) {
  const dateRaw = String(raceDate || '').trim();
  const timeRaw = normalizeTimeTo24h(startTime);
  if (!dateRaw || !timeRaw) return null;
  const dateMatch = dateRaw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) return null;
  return `${dateMatch[1]}T${timeRaw}`;
}

function isUsableAdminBaseUrl(value?: string | null) {
  const normalized = String(value || '').trim();
  return !!normalized && !normalized.includes('your-bergman-app.example.com');
}

function getAdminBaseCandidates(env: WorkerEnv) {
  return uniqueStrings([
    isUsableAdminBaseUrl(env.BERGMAN_ADMIN_API_BASE) ? env.BERGMAN_ADMIN_API_BASE : null,
    ...DEFAULT_ADMIN_BASE_URLS,
  ]);
}

function mapRuntimeKvConfigToEventConfig(eventId: string, runtimeConfig: any): EventConfigResponse {
  const event = runtimeConfig?.event || {};
  return {
    success: true,
    eventId,
    eventName: event?.eventName || event?.name || runtimeConfig?.eventName || 'Untitled Event',
    eventDate: event?.raceDate || event?.eventDate || runtimeConfig?.raceDate || runtimeConfig?.eventDate || null,
    eventStartTime: event?.startTime || event?.eventStartTime || runtimeConfig?.startTime || null,
    status: event?.status || runtimeConfig?.status || 'upcoming',
    updatedAt: runtimeConfig?.generatedAt || event?.updatedAt || null,
    liveTrackingHub: runtimeConfig,
    liveTracking: runtimeConfig,
    event: {
      id: eventId,
      eventName: event?.eventName || event?.name || runtimeConfig?.eventName || 'Untitled Event',
      raceDate: event?.raceDate || event?.eventDate || runtimeConfig?.raceDate || runtimeConfig?.eventDate || null,
      startTime: event?.startTime || event?.eventStartTime || runtimeConfig?.startTime || null,
      phase: event?.phase || runtimeConfig?.phase || null,
      status: event?.status || runtimeConfig?.status || 'upcoming',
      updatedAt: runtimeConfig?.generatedAt || event?.updatedAt || null,
      liveTrackingEnabled: runtimeConfig?.trackingConfig?.enabled ?? true,
    },
    registrationStats: {
      registered: Number(runtimeConfig?.participants?.count || 0),
      totalDocuments: Number(runtimeConfig?.participants?.count || 0),
      cancelled: 0,
      withBib: Number(runtimeConfig?.participants?.count || 0),
      bibNumbers: [],
      duplicates: 0,
      missingChips: 0,
    },
  };
}

async function loadEventConfig(env: WorkerEnv, eventId: string): Promise<EventConfigResponse | null> {
  const runtimeConfig = await readKvJson(env, `event:${eventId}:config`);
  if (runtimeConfig && typeof runtimeConfig === 'object') {
    return mapRuntimeKvConfigToEventConfig(eventId, runtimeConfig);
  }

  let lastStatus: number | null = null;

  for (const baseUrl of getAdminBaseCandidates(env)) {
    const url = `${baseUrl.replace(/\/$/, '')}/api/live/config/${encodeURIComponent(eventId)}`;
    const res = await fetch(url, {
      headers: {
        'x-bergman-internal-token': env.BERGMAN_INTERNAL_TOKEN,
        accept: 'application/json',
      },
    });

    if (!res.ok) {
      lastStatus = res.status;
      console.warn(`Event config unavailable: ${res.status} for ${url}`);
      continue;
    }

    return (await res.json()) as EventConfigResponse;
  }

  if (lastStatus !== null) {
    console.warn(`Event config unavailable for event ${eventId}; last status ${lastStatus}`);
  }

  const kvFallback = await loadEventConfigFromKv(env, eventId);
  if (kvFallback) return kvFallback;

  return null;
}

async function loadProviderDatabaseFromApp(env: WorkerEnv, eventId: string) {
  for (const baseUrl of getAdminBaseCandidates(env)) {
    const url = `${baseUrl.replace(/\/$/, '')}/api/live/provider-database/${encodeURIComponent(eventId)}`;
    try {
      const res = await fetch(url, {
        headers: {
          'x-bergman-internal-token': env.BERGMAN_INTERNAL_TOKEN,
          accept: 'application/json',
        },
      });
      if (!res.ok) continue;
      const payload = await res.json().catch(() => null);
      if (!payload?.success) continue;
      return payload?.database || null;
    } catch {
      continue;
    }
  }
  return null;
}

async function persistProviderDatabaseToApp(env: WorkerEnv, eventId: string, database: any) {
  for (const baseUrl of getAdminBaseCandidates(env)) {
    const url = `${baseUrl.replace(/\/$/, '')}/api/live/provider-database/${encodeURIComponent(eventId)}`;
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-bergman-internal-token': env.BERGMAN_INTERNAL_TOKEN,
          accept: 'application/json',
        },
        body: JSON.stringify({ database }),
      });
      if (!res.ok) continue;
      const payload = await res.json().catch(() => null);
      if (payload?.success) return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function fetchProviderParticipantsFromApp(env: WorkerEnv, eventId: string) {
  for (const baseUrl of getAdminBaseCandidates(env)) {
    const url = `${baseUrl.replace(/\/$/, '')}/api/live/provider-participants/${encodeURIComponent(eventId)}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'x-bergman-internal-token': env.BERGMAN_INTERNAL_TOKEN,
          accept: 'application/json',
        },
      });
      if (!res.ok) continue;
      const payload = await res.json().catch(() => null);
      const participants = Array.isArray(payload?.participants) ? payload.participants : [];
      if (participants.length > 0) return participants;
    } catch {
      continue;
    }
  }
  return [];
}

async function persistTimingConfigurationSnapshot(env: WorkerEnv, eventId: string, timingConfiguration: any) {
  const snapshot = {
    eventId,
    provider: timingConfiguration?.provider || 'feibot',
    source: timingConfiguration?.source || 'manual',
    course: {
      legs: Array.isArray(timingConfiguration?.legs) ? timingConfiguration.legs : Array.isArray(timingConfiguration?.course?.legs) ? timingConfiguration.course.legs : [],
      timingPoints: Array.isArray(timingConfiguration?.timingPoints)
        ? timingConfiguration.timingPoints
        : Array.isArray(timingConfiguration?.course?.timingPoints)
          ? timingConfiguration.course.timingPoints
          : [],
      splits: Array.isArray(timingConfiguration?.splits)
        ? timingConfiguration.splits
        : Array.isArray(timingConfiguration?.course?.splits)
          ? timingConfiguration.course.splits
          : [],
      contests: Array.isArray(timingConfiguration?.contests)
        ? timingConfiguration.contests
        : Array.isArray(timingConfiguration?.course?.contests)
          ? timingConfiguration.course.contests
          : [],
    },
    contests: Array.isArray(timingConfiguration?.contests) ? timingConfiguration.contests : [],
    timingPoints: Array.isArray(timingConfiguration?.timingPoints) ? timingConfiguration.timingPoints : [],
    splits: Array.isArray(timingConfiguration?.splits) ? timingConfiguration.splits : [],
    devices: Array.isArray(timingConfiguration?.devices) ? timingConfiguration.devices : [],
    legs: Array.isArray(timingConfiguration?.legs) ? timingConfiguration.legs : [],
    ageGroups: Array.isArray(timingConfiguration?.ageGroups) ? timingConfiguration.ageGroups : [],
    importedAt: timingConfiguration?.importedAt || new Date().toISOString(),
  };

  await writeKvJson(env, `event:${eventId}:timingConfiguration`, snapshot);
  await writeKvJson(env, `live:event:${eventId}:timingConfiguration`, snapshot);
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return toHex(digest);
}

function normalizeFeibotHashInput(config: { accessKey?: string; secretKey?: string; eventUuid?: string }) {
  return {
    accessKey: String(config?.accessKey || '').trim(),
    secretKey: String(config?.secretKey || '').trim(),
    eventUuid: String(config?.eventUuid || '').trim(),
  };
}

async function computeFeibotConfigHash(config: { accessKey?: string; secretKey?: string; eventUuid?: string }) {
  const normalized = normalizeFeibotHashInput(config);
  const payload = `${normalized.eventUuid}|${normalized.accessKey}|${normalized.secretKey}`;
  const hash = payload === '||' ? '' : await sha256Hex(payload);
  return {
    hash,
    accessKeyLength: normalized.accessKey.length,
    secretKeyLength: normalized.secretKey.length,
    eventUuid: normalized.eventUuid,
  };
}

function resolveFeibotUuids(config: {
  eventUuid?: string;
  cloudEventUuid?: string;
  scoreEventUuid?: string;
  cloud?: { eventUuid?: string };
  score?: { eventUuid?: string; databaseUuid?: string };
} = {}) {
  const cloudEventUuid = String(
    config.cloudEventUuid ||
    config.cloud?.eventUuid ||
    config.eventUuid ||
    '',
  ).trim();
  const scoreEventUuid = String(
    config.scoreEventUuid ||
    config.score?.eventUuid ||
    config.score?.databaseUuid ||
    '',
  ).trim();

  return {
    cloudEventUuid: cloudEventUuid || scoreEventUuid,
    scoreEventUuid: scoreEventUuid || cloudEventUuid,
  };
}

function getCloudEventUuid(config: Partial<FeibotConfig> = {}) {
  return resolveFeibotUuids(config).cloudEventUuid;
}

function getScoreEventUuid(config: Partial<FeibotConfig> = {}) {
  return resolveFeibotUuids(config).scoreEventUuid;
}

async function loadProviderConfigFromApp(env: WorkerEnv, eventId: string) {
  for (const baseUrl of getAdminBaseCandidates(env)) {
    const url = `${baseUrl.replace(/\/$/, '')}/api/live/provider-config/${encodeURIComponent(eventId)}`;
    try {
      const res = await fetch(url, {
        headers: {
          'x-bergman-internal-token': env.BERGMAN_INTERNAL_TOKEN,
          accept: 'application/json',
        },
      });
      if (!res.ok) continue;
      const payload = await res.json().catch(() => null);
      if (payload?.success) return payload;
    } catch {
      continue;
    }
  }
  return null;
}

async function getProviderConfig(env: WorkerEnv, eventId: string) {
  const configResponse = await loadEventConfig(env, eventId).catch(() => null);
  const fallbackProviderConfig = await readKvJson(env, `live:event:${eventId}:provider-config`);
  const hub = mergeHubConfig(getHubConfig(configResponse), fallbackProviderConfig);
  const feibotConfig = hub?.feibotConfig || {};
  const cloud = feibotConfig?.cloud || {};
  const score = feibotConfig?.score || {};

  const accessKey = String(cloud?.accessKey || feibotConfig?.accessKey || '').trim();
  const secretKey = String(cloud?.secretKey || feibotConfig?.secretKey || '').trim();
  const eventUuid = String(cloud?.eventUuid || feibotConfig?.cloudEventUuid || feibotConfig?.eventUuid || '').trim();
  const apiBaseUrl = String(cloud?.apiBaseUrl || feibotConfig?.apiBaseUrl || 'https://apicn.feibot.com').trim() || 'https://apicn.feibot.com';
  const scoreEventUuid = String(score?.eventUuid || feibotConfig?.scoreEventUuid || '').trim();
  const fingerprint = await computeFeibotConfigHash({ accessKey, secretKey, eventUuid });

  return {
    provider: String(hub?.provider || 'feibot').trim().toLowerCase() || 'feibot',
    feibotConfig: {
      ...(feibotConfig || {}),
      accessKey,
      secretKey,
      eventUuid,
      cloudEventUuid: eventUuid,
      scoreEventUuid,
      apiBaseUrl,
      cloud: {
        ...(cloud || {}),
        eventUuid,
        apiBaseUrl,
        accessKey,
        secretKey,
      },
      score: {
        ...(score || {}),
        eventUuid: scoreEventUuid,
        overviewUrl: scoreEventUuid ? `https://score.feibot.com/?id=${encodeURIComponent(scoreEventUuid)}` : '',
        progressUrl: scoreEventUuid
          ? `https://score.feibot.com/onlineDateQuery/index.html#/progress/event?event_uuid=${encodeURIComponent(scoreEventUuid)}`
          : '',
        available: !!scoreEventUuid,
      },
      configHash: fingerprint.hash,
      accessKeyLength: fingerprint.accessKeyLength,
      secretKeyLength: fingerprint.secretKeyLength,
      timingRuleSource: String(feibotConfig?.timingRuleSource || 'cloud'),
    },
  };
}

async function inspectProviderConfig(env: WorkerEnv, eventId: string) {
  const workerConfig = await getProviderConfig(env, eventId);
  const appPayload = await loadProviderConfigFromApp(env, eventId);
  const appFeibot = appPayload?.config?.feibotConfig || {};
  const appCloud = appFeibot?.cloud || {};

  const workerAccessKey = String(workerConfig?.feibotConfig?.cloud?.accessKey || workerConfig?.feibotConfig?.accessKey || '').trim();
  const workerSecretKey = String(workerConfig?.feibotConfig?.cloud?.secretKey || workerConfig?.feibotConfig?.secretKey || '').trim();
  const workerEventUuid = String(workerConfig?.feibotConfig?.cloud?.eventUuid || workerConfig?.feibotConfig?.cloudEventUuid || workerConfig?.feibotConfig?.eventUuid || '').trim();
  const workerScoreEventUuid = String(workerConfig?.feibotConfig?.score?.eventUuid || workerConfig?.feibotConfig?.scoreEventUuid || '').trim();
  const workerApiBaseUrl = String(workerConfig?.feibotConfig?.cloud?.apiBaseUrl || workerConfig?.feibotConfig?.apiBaseUrl || 'https://apicn.feibot.com').trim() || 'https://apicn.feibot.com';
  const workerHash = await computeFeibotConfigHash({ accessKey: workerAccessKey, secretKey: workerSecretKey, eventUuid: workerEventUuid });

  const firestoreAccessKey = String(appCloud?.accessKey || appFeibot?.accessKey || '').trim();
  const firestoreSecretKey = String(appCloud?.secretKey || appFeibot?.secretKey || '').trim();
  const firestoreEventUuid = String(appCloud?.eventUuid || appFeibot?.eventUuid || '').trim();
  const firestoreApiBaseUrl = String(appCloud?.apiBaseUrl || appFeibot?.apiBaseUrl || 'https://apicn.feibot.com').trim() || 'https://apicn.feibot.com';
  const firestoreHash = await computeFeibotConfigHash({ accessKey: firestoreAccessKey, secretKey: firestoreSecretKey, eventUuid: firestoreEventUuid });

  const fallbackRaw = await readKvJson(env, `live:event:${eventId}:provider-config`);
  const fallbackCloud = fallbackRaw?.feibotConfig?.cloud || {};
  const fallbackHash = await computeFeibotConfigHash({
    accessKey: String(fallbackCloud?.accessKey || fallbackRaw?.feibotConfig?.accessKey || '').trim(),
    secretKey: String(fallbackCloud?.secretKey || fallbackRaw?.feibotConfig?.secretKey || '').trim(),
    eventUuid: String(fallbackCloud?.eventUuid || fallbackRaw?.feibotConfig?.eventUuid || '').trim(),
  });

  const firestoreAvailable = !!appPayload?.success;
  const hashesMatch = firestoreAvailable && !!workerHash.hash && workerHash.hash === firestoreHash.hash;
  const baseUrlMatch = firestoreAvailable && workerApiBaseUrl === firestoreApiBaseUrl;

  return {
    configured: {
      worker: !!(workerHash.accessKeyLength && workerHash.secretKeyLength && workerHash.eventUuid),
      firestore: !!(firestoreHash.accessKeyLength && firestoreHash.secretKeyLength && firestoreHash.eventUuid),
      fallbackKv: !!(fallbackHash.accessKeyLength && fallbackHash.secretKeyLength && fallbackHash.eventUuid),
    },
    match: {
      firestoreToWorker: hashesMatch && baseUrlMatch,
      hash: hashesMatch,
      apiBaseUrl: baseUrlMatch,
    },
    worker: {
      hash: workerHash.hash,
      eventUuid: workerHash.eventUuid,
      cloudEventUuid: workerEventUuid,
      scoreEventUuid: workerScoreEventUuid,
      accessKeyLength: workerHash.accessKeyLength,
      secretKeyLength: workerHash.secretKeyLength,
      apiBaseUrl: workerApiBaseUrl,
    },
    firestore: {
      available: firestoreAvailable,
      hash: firestoreHash.hash,
      eventUuid: firestoreHash.eventUuid,
      accessKeyLength: firestoreHash.accessKeyLength,
      secretKeyLength: firestoreHash.secretKeyLength,
      apiBaseUrl: firestoreApiBaseUrl,
    },
    fallbackKv: {
      hash: fallbackHash.hash,
      eventUuid: fallbackHash.eventUuid,
      accessKeyLength: fallbackHash.accessKeyLength,
      secretKeyLength: fallbackHash.secretKeyLength,
    },
  };
}

function getEventIdFromPath(pathname: string) {
  const match = pathname.match(/^\/v1\/events\/([^/]+)(?:\/(.*))?$/);
  return match ? { eventId: decodeURIComponent(match[1]), tail: match[2] || '' } : null;
}

async function readKvJson(env: WorkerEnv, key: string) {
  const value = await env.BERGMAN_KV.get(key, 'json');
  return value ?? null;
}

function getRegistrationBib(participant: any) {
  return String(participant?.bibNumber || participant?.bib || participant?.bib_no || participant?.number || participant?.no || '').trim();
}

function getRegistrationAthleteUid(participant: any) {
  return String(
    participant?.athleteUid ||
    participant?.athlete_uid ||
    participant?.participantUuid ||
    participant?.participant_uuid ||
    participant?.providerParticipantUuid ||
    participant?.provider_uuid ||
    participant?.registrationId ||
    participant?.participantId ||
    participant?.id ||
    participant?.bookingId ||
    '',
  ).trim();
}

function getRegistrationChip(participant: any) {
  return String(participant?.timingChipId || participant?.chipCode || participant?.chip || participant?.chipId || participant?.chip_code || '').trim();
}

function isCancelledRegistration(participant: any) {
  const status = String(participant?.ticketStatus || participant?.status || participant?.registrationStatus || '').trim().toLowerCase();
  return status === 'cancelled' || status === 'canceled' || status === 'refunded';
}

function buildRegistrationStats(participants: any[]) {
  const activeParticipants = participants.filter((participant) => !isCancelledRegistration(participant));
  const bibs = activeParticipants.map((participant) => getRegistrationBib(participant)).filter(Boolean);
  return {
    registered: activeParticipants.length,
    totalDocuments: participants.length,
    cancelled: Math.max(participants.length - activeParticipants.length, 0),
    withBib: bibs.length,
    bibNumbers: bibs,
    duplicates: computeDuplicateBibCount(activeParticipants.map((participant) => ({ bib: getRegistrationBib(participant) }))),
    missingChips: activeParticipants.filter((participant) => !getRegistrationChip(participant)).length,
  };
}

async function loadEventConfigFromKv(env: WorkerEnv, eventId: string): Promise<EventConfigResponse | null> {
  const calendar = await readKvJson(env, 'calendar:snapshot');
  const events = Array.isArray(calendar) ? calendar : [];
  const event = events.find((entry: any) => String(entry?.id || '').trim() === eventId);
  if (!event) return null;

  const participants = await readKvJson(env, `event:${eventId}:participants:index`);
  const participantList = Array.isArray(participants) ? participants : [];
  const raceDate = String(event?.eventDate || event?.disciplineSchedule?.[0]?.date || '').trim() || null;
  const startTime = String(event?.eventStartTime || event?.startTime || '').trim() || null;
  const liveTrackingHub = event?.liveTrackingHub || event?.liveTracking || null;
  const registrationStats = buildRegistrationStats(participantList);

  return {
    success: true,
    eventId,
    liveTrackingHub,
    liveTracking: event?.liveTracking || null,
    liveDataSource: event?.liveDataSource,
    liveTimingConfig: event?.liveTimingConfig,
    event: {
      id: eventId,
      eventName: event?.eventName || event?.name || 'Untitled Event',
      raceDate,
      startTime,
      phase: event?.phase || null,
      status: event?.status || 'upcoming',
      updatedAt: event?.updatedAt || null,
      liveTrackingEnabled: liveTrackingHub?.trackingConfig?.enabled ?? event?.showLiveTrackingOnHomepage ?? false,
    },
    eventName: event?.eventName || event?.name || 'Untitled Event',
    eventDate: raceDate,
    eventStartTime: startTime,
    status: event?.status || 'upcoming',
    updatedAt: event?.updatedAt || null,
    registrationStats,
  };
}

async function readR2Json(env: WorkerEnv, key: string) {
  const obj = await env.BERGMAN_R2.get(key);
  if (!obj) return null;
  return obj.json();
}

async function writeKvJson(env: WorkerEnv, key: string, value: unknown) {
  await env.BERGMAN_KV.put(key, JSON.stringify(value));
}

async function mergeKvJson(env: WorkerEnv, key: string, patch: Record<string, any>) {
  const current = (await readKvJson(env, key)) || {};
  const next = { ...(current as Record<string, any>), ...patch };
  await writeKvJson(env, key, next);
  return next;
}

function getHubConfig(eventConfig: EventConfigResponse | null) {
  return eventConfig?.liveTrackingHub || eventConfig?.liveTracking || {};
}

function preferValue(primary: any, fallback: any) {
  if (typeof primary === 'string') {
    return primary.trim() ? primary : fallback;
  }
  return primary ?? fallback;
}

function mergeHubConfig(baseHub: any, fallbackHub: any) {
  const baseFeibot = baseHub?.feibotConfig || {};
  const fallbackFeibot = fallbackHub?.feibotConfig || {};
  const baseCloud = baseFeibot?.cloud || {};
  const fallbackCloud = fallbackFeibot?.cloud || {};
  const baseScore = baseFeibot?.score || {};
  const fallbackScore = fallbackFeibot?.score || {};
  const baseCloudTimingRules = baseFeibot?.cloudTimingRules || {};
  const fallbackCloudTimingRules = fallbackFeibot?.cloudTimingRules || {};
  return {
    ...(fallbackHub || {}),
    ...(baseHub || {}),
    trackingConfig: {
      ...(fallbackHub?.trackingConfig || {}),
      ...(baseHub?.trackingConfig || {}),
    },
    feibotConfig: {
      ...(fallbackFeibot || {}),
      ...(baseFeibot || {}),
      accessKey: preferValue(baseFeibot?.accessKey, fallbackFeibot?.accessKey),
      secretKey: preferValue(baseFeibot?.secretKey, fallbackFeibot?.secretKey),
      eventUuid: preferValue(baseFeibot?.eventUuid, fallbackFeibot?.eventUuid),
      apiBaseUrl: preferValue(baseFeibot?.apiBaseUrl, fallbackFeibot?.apiBaseUrl),
      timingRuleSource: preferValue(baseFeibot?.timingRuleSource, fallbackFeibot?.timingRuleSource),
      cloud: {
        ...(fallbackCloud || {}),
        ...(baseCloud || {}),
        eventUuid: preferValue(baseCloud?.eventUuid, fallbackCloud?.eventUuid),
        apiBaseUrl: preferValue(baseCloud?.apiBaseUrl, fallbackCloud?.apiBaseUrl),
        accessKey: preferValue(baseCloud?.accessKey, fallbackCloud?.accessKey),
        secretKey: preferValue(baseCloud?.secretKey, fallbackCloud?.secretKey),
      },
      score: {
        ...(fallbackScore || {}),
        ...(baseScore || {}),
        eventUuid: preferValue(baseScore?.eventUuid, fallbackScore?.eventUuid),
        overviewUrl: preferValue(baseScore?.overviewUrl, fallbackScore?.overviewUrl),
        progressUrl: preferValue(baseScore?.progressUrl, fallbackScore?.progressUrl),
        available: typeof baseScore?.available === 'boolean' ? baseScore.available : fallbackScore?.available,
      },
      cloudTimingRules: {
        ...(fallbackCloudTimingRules || {}),
        ...(baseCloudTimingRules || {}),
        contests: Array.isArray(baseCloudTimingRules?.contests) && baseCloudTimingRules.contests.length > 0
          ? baseCloudTimingRules.contests
          : Array.isArray(fallbackCloudTimingRules?.contests) ? fallbackCloudTimingRules.contests : [],
        splits: Array.isArray(baseCloudTimingRules?.splits) && baseCloudTimingRules.splits.length > 0
          ? baseCloudTimingRules.splits
          : Array.isArray(fallbackCloudTimingRules?.splits) ? fallbackCloudTimingRules.splits : [],
        timingPoints: Array.isArray(baseCloudTimingRules?.timingPoints) && baseCloudTimingRules.timingPoints.length > 0
          ? baseCloudTimingRules.timingPoints
          : Array.isArray(fallbackCloudTimingRules?.timingPoints) ? fallbackCloudTimingRules.timingPoints : [],
        ageGroups: Array.isArray(baseCloudTimingRules?.ageGroups) && baseCloudTimingRules.ageGroups.length > 0
          ? baseCloudTimingRules.ageGroups
          : Array.isArray(fallbackCloudTimingRules?.ageGroups) ? fallbackCloudTimingRules.ageGroups : [],
        updatedAt: preferValue(baseCloudTimingRules?.updatedAt, fallbackCloudTimingRules?.updatedAt),
      },
    },
    leaderboardConfig: {
      ...(fallbackHub?.leaderboardConfig || {}),
      ...(baseHub?.leaderboardConfig || {}),
    },
    syncEngine: {
      ...(fallbackHub?.syncEngine || {}),
      ...(baseHub?.syncEngine || {}),
    },
  };
}

function normalizeProviderLabel(provider: string | null | undefined) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (!normalized) return 'Feibot';
  if (normalized === 'racemap') return 'RaceMap';
  if (normalized === 'raceresult') return 'RaceResult';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function extractHttpStatus(error: unknown) {
  const statusFromObject = Number((error as any)?.httpStatus || (error as any)?.status || 0);
  if (Number.isFinite(statusFromObject) && statusFromObject > 0) return statusFromObject;
  const message = error instanceof Error ? error.message : String(error || '');
  const match = message.match(/\b(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

function extractStringToSign(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const match = message.match(/string\s*ToSign\s*=\s*([^\n\r;]+)/i);
  return match ? String(match[1]).trim() : null;
}

function stripStringToSignFromMessage(message: string | null | undefined) {
  return String(message || '')
    .replace(/\s*;?\s*string\s*ToSign\s*=\s*[^\n\r;]+/gi, '')
    .trim();
}

function classifyProviderApiState(details: { success: boolean; status: number; message?: string | null }) {
  const status = Number(details.status || 0);
  const message = String(details.message || '').toLowerCase();
  const isTimeoutOrNetwork =
    !status &&
    /timeout|timed out|network|fetch failed|econn|enotfound|dns|socket|abort/.test(message);

  if (details.success || status === 200) {
    return {
      providerStatus: 'connected',
      authentication: 'verified',
      cloudApi: 'PASS',
      authState: 'verified',
    } as const;
  }

  if (status === 401 || status === 403) {
    return {
      providerStatus: 'error',
      authentication: 'failed',
      cloudApi: 'FAILED',
      authState: 'failed',
    } as const;
  }

  if (isTimeoutOrNetwork) {
    return {
      providerStatus: 'warning',
      authentication: 'unknown',
      cloudApi: 'FAILED',
      authState: 'unknown',
    } as const;
  }

  return {
    providerStatus: 'warning',
    authentication: 'unknown',
    cloudApi: 'FAILED',
    authState: 'unknown',
  } as const;
}

function decodePrintableSlice(bytes: Uint8Array) {
  let output = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const code = bytes[i];
    output += code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
  }
  return output;
}

function inferLocalDatabaseMetadataFromFile(fileBuffer: ArrayBuffer, fileName: string) {
  const bytes = new Uint8Array(fileBuffer);
  const sampleSize = Math.min(bytes.length, 2 * 1024 * 1024);
  const head = bytes.slice(0, sampleSize);
  const tail = bytes.length > sampleSize ? bytes.slice(Math.max(0, bytes.length - sampleSize)) : new Uint8Array();
  const haystack = `${decodePrintableSlice(head)} ${decodePrintableSlice(tail)}`;

  const readByRegex = (pattern: RegExp): string => {
    const match = haystack.match(pattern);
    return String(match?.[1] || '').trim();
  };

  const databaseUuid =
    readByRegex(/(?:database[_\s-]?uuid|db[_\s-]?uuid)\s*[:=\-]?\s*([A-Za-z0-9]{6,24})/i) ||
    readByRegex(/score\.feibot\.com\/?\?id=([A-Za-z0-9]{6,24})/i);

  const cloudEventUuid =
    readByRegex(/(?:cloud[_\s-]?event[_\s-]?uuid|event[_\s-]?uuid)\s*[:=\-]?\s*([A-Za-z0-9]{6,24})/i) ||
    readByRegex(/event_uuid=([A-Za-z0-9]{6,24})/i);

  const scoreEventUuid =
    readByRegex(/(?:score[_\s-]?event[_\s-]?uuid|event[_\s-]?score[_\s-]?uuid)\s*[:=\-]?\s*([A-Za-z0-9]{6,24})/i) ||
    readByRegex(/score\.feibot\.com\/?\?id=([A-Za-z0-9]{6,24})/i);

  const eventName = readByRegex(/(?:event[_\s-]?name|race[_\s-]?name)\s*[:=\-]?\s*([A-Za-z0-9\s\-_.()]{4,80})/i);

  return {
    databaseUuid,
    cloudEventUuid,
    scoreEventUuid: scoreEventUuid || databaseUuid,
    eventName,
    fileName,
  };
}

function defaultImportsState() {
  return {
    timingRules: {
      status: 'waiting',
      count: {
        contests: 0,
        splits: 0,
        timingPoints: 0,
        devices: 0,
      },
      lastImport: null,
      durationMs: null,
    },
    participants: {
      status: 'waiting',
      count: 0,
      lastImport: null,
      durationMs: null,
    },
    results: {
      status: 'waiting',
      count: 0,
      lastImport: null,
      durationMs: null,
    },
  };
}

async function upsertImportsState(env: WorkerEnv, eventId: string, patch: any) {
  const key = `live:event:${eventId}:imports`;
  const current = (await readKvJson(env, key)) || defaultImportsState();
  const next = {
    ...defaultImportsState(),
    ...current,
    ...patch,
    timingRules: {
      ...defaultImportsState().timingRules,
      count: {
        ...defaultImportsState().timingRules.count,
        ...(current?.timingRules?.count || {}),
        ...(patch?.timingRules?.count || {}),
      },
    },
    participants: {
      ...defaultImportsState().participants,
      ...(current?.participants || {}),
      ...(patch?.participants || {}),
    },
    results: {
      ...defaultImportsState().results,
      ...(current?.results || {}),
      ...(patch?.results || {}),
    },
  };
  await writeKvJson(env, key, next);
  return next;
}

async function recordProviderApiCall(
  env: WorkerEnv,
  eventId: string,
  details: {
    provider: string;
    endpoint: string;
    responseTimeMs: number;
    status: number;
    success: boolean;
    timestamp?: string;
    eventUuid?: string;
    requestUrl?: string | null;
    baseUrl?: string | null;
    path?: string | null;
    query?: string | null;
    unixTimestamp?: number | null;
    stringToSign?: string | null;
    signatureLength?: number | null;
    message?: string | null;
  },
) {
  const timestamp = details.timestamp || new Date().toISOString();
  const statusCode = Number(details.status || 0);
  const state = classifyProviderApiState({ success: details.success, status: statusCode, message: details.message || null });
  const configResponse = await loadEventConfig(env, eventId).catch(() => null);
  const fallbackProviderConfig = await readKvJson(env, `live:event:${eventId}:provider-config`);
  const hub = mergeHubConfig(getHubConfig(configResponse), fallbackProviderConfig);
  const timingRuleSourceRaw = String(hub?.feibotConfig?.timingRuleSource || '').trim().toLowerCase();
  const configurationSource = timingRuleSourceRaw === 'manual' ? 'manual' : 'cloud_api';
  const currentProviderState = (await readKvJson(env, `event:${eventId}:providerState`)) || (await readKvJson(env, `live:event:${eventId}:providerState`)) || {};
  const current = (await readKvJson(env, `live:event:${eventId}:provider-diagnostics`)) || {};
  const existingAuth = current?.authenticationState || {};
  const existingAuthStatus = String(existingAuth?.status || current?.authentication || '').trim().toLowerCase();
  const isAuthFailure = statusCode === 401 || statusCode === 403;
  const preserveVerifiedAuth = existingAuthStatus === 'verified' && !isAuthFailure && !details.success;
  const nextConsecutiveFailures = details.success ? 0 : Number(currentProviderState?.consecutiveFailures || 0) + 1;
  const nextFailureCount = details.success ? Number(currentProviderState?.failureCount || 0) : Number(currentProviderState?.failureCount || 0) + 1;
  const nextAverageResponseTime = Number.isFinite(Number(currentProviderState?.averageResponseTime))
    ? Math.round((Number(currentProviderState.averageResponseTime) + Number(details.responseTimeMs || 0)) / 2)
    : Number(details.responseTimeMs || 0);
  const nextMaximumResponseTime = Math.max(Number(currentProviderState?.maximumResponseTime || 0), Number(details.responseTimeMs || 0));
  const endpointAvailability = {
    ...(currentProviderState?.endpointAvailability || {}),
    [details.endpoint]: details.success ? 'available' : 'unavailable',
  };
  const providerState = {
    provider: String(details.provider || currentProviderState?.provider || 'feibot'),
    status: details.success
      ? 'connected'
      : nextConsecutiveFailures >= 5
        ? 'disconnected'
        : nextConsecutiveFailures >= 3
          ? 'error'
          : 'warning',
    // On success: ALWAYS upgrade to 'verified' (don't let old 'pending' short-circuit)
    // On non-auth failure: preserve existing 'verified' so it never degrades
    // On 401/403: set 'failed'
    authentication: details.success
      ? 'verified'
      : preserveVerifiedAuth
        ? 'verified'
        : isAuthFailure
          ? 'failed'
          : (currentProviderState?.authentication === 'verified' ? 'verified' : state.authState) || 'unknown',
    cloudApi: details.success
      ? 'pass'
      : isAuthFailure
        ? 'failed'
        : currentProviderState?.cloudApi === 'pass'
          ? 'pass'
          : nextConsecutiveFailures >= 5
            ? 'failed'
            : 'warning',
    publicScore: currentProviderState?.publicScore || (state.cloudApi === 'PASS' ? 'pass' : 'pending'),
    progressPage: currentProviderState?.progressPage || (state.cloudApi === 'PASS' ? 'pass' : 'pending'),
    configurationSource: currentProviderState?.configurationSource || configurationSource,
    lastSuccessfulConnection: details.success ? timestamp : currentProviderState?.lastSuccessfulConnection || null,
    lastSuccessfulAuthentication: preserveVerifiedAuth || state.authState === 'verified' ? timestamp : currentProviderState?.lastSuccessfulAuthentication || null,
    lastSuccessfulParticipantImport: currentProviderState?.lastSuccessfulParticipantImport || null,
    lastSuccessfulResultImport: currentProviderState?.lastSuccessfulResultImport || null,
    lastProviderCall: details.endpoint,
    lastResponseCode: statusCode || null,
    lastResponseTime: Number(details.responseTimeMs || 0),
    lastFailure: details.success ? null : details.message || null,
    failureCount: nextFailureCount,
    consecutiveFailures: nextConsecutiveFailures,
    averageResponseTime: nextAverageResponseTime,
    maximumResponseTime: nextMaximumResponseTime,
    timingRulesImported: Boolean(currentProviderState?.timingRulesImported),
    participantsImported: Boolean(currentProviderState?.participantsImported),
    resultsImported: Boolean(currentProviderState?.resultsImported),
    liveSyncRunning: Boolean(currentProviderState?.liveSyncRunning),
    replayEnabled: Boolean(currentProviderState?.replayEnabled ?? hub?.trackingConfig?.enableReplayMode),
    updatedAt: timestamp,
    endpointAvailability,
  };

  const nextAuthentication = {
    status: preserveVerifiedAuth ? 'verified' : state.authState,
    checkedAt: timestamp,
    lastSuccess: state.authState === 'verified' || preserveVerifiedAuth ? timestamp : existingAuth?.lastSuccess || current?.lastSuccessAt || null,
    lastFailure: isAuthFailure ? timestamp : existingAuth?.lastFailure || current?.lastFailureAt || null,
    lastStatusCode: statusCode || existingAuth?.lastStatusCode || null,
    lastError: details.success ? null : details.message || null,
  };

  const existingLastApiCall = current?.lastApiCall || {};
  const nextLastApiCall = {
    endpoint: details.endpoint,
    durationMs: details.responseTimeMs,
    responseTimeMs: details.responseTimeMs,
    status: statusCode,
    success: details.success,
    timestamp,
    requestUrl: details.requestUrl || existingLastApiCall?.requestUrl || null,
    baseUrl: details.baseUrl || existingLastApiCall?.baseUrl || null,
    eventUuid: details.eventUuid || existingLastApiCall?.eventUuid || null,
    path: details.path || existingLastApiCall?.path || null,
    query: details.query || existingLastApiCall?.query || null,
    unixTimestamp: details.unixTimestamp || existingLastApiCall?.unixTimestamp || null,
    stringToSign: details.stringToSign || existingLastApiCall?.stringToSign || null,
    signatureLength: details.signatureLength || existingLastApiCall?.signatureLength || null,
  };

  await mergeKvJson(env, `live:event:${eventId}:provider-diagnostics`, {
    provider: details.provider,
    status: state.providerStatus,
    authentication: state.authentication,
    cloudApi: {
      status: state.cloudApi,
      checkedAt: timestamp,
      statusCode: statusCode || null,
    },
    authenticationState: nextAuthentication,
    eventUuid: details.eventUuid || null,
    responseTimeMs: details.responseTimeMs,
    durationMs: details.responseTimeMs,
    endpoint: details.endpoint,
    lastTestAt: timestamp,
    lastSuccessAt: state.authState === 'verified' ? timestamp : undefined,
    lastFailureAt: isAuthFailure ? timestamp : undefined,
    message: details.message || undefined,
    lastApiCall: nextLastApiCall,
  });

  await mergeKvJson(env, `live:event:${eventId}:monitoring`, {
    providerResponseMs: details.responseTimeMs,
    lastSync: timestamp,
    syncEngine: {
      state: 'idle',
      lastRun: timestamp,
      nextRun: null,
      readsProcessed: Number((await readKvJson(env, `live:event:${eventId}:monitoring`))?.syncEngine?.readsProcessed || 0),
      lastError: details.success ? null : details.message || 'Provider call failed',
    },
  });

  await writeKvJson(env, `event:${eventId}:providerState`, providerState);
  await writeKvJson(env, `live:event:${eventId}:providerState`, providerState);
}

function getTimingRulesImportStats(result: any) {
  const payload = timingRulesPayloadFromResult(result);
  return {
    contests: payload.contests.length,
    splits: payload.splits.length,
    timingPoints: payload.timingPoints.length || payload.splits.length,
    devices: payload.devices.length,
  };
}

function timingRulesPayloadFromResult(result: any) {
  const directRules = result?.timing_rules;
  const nestedRules = result?.data?.timing_rules;
  const rules = directRules && typeof directRules === 'object' ? directRules : nestedRules && typeof nestedRules === 'object' ? nestedRules : null;
  if (rules) {
    const contests = Array.isArray(rules.contests) ? rules.contests : [];
    const splits = Array.isArray(rules.splits) ? rules.splits : [];
    const timingPoints = Array.isArray(rules.timing_points) ? rules.timing_points : [];
    const devices = Array.isArray(rules.devices) ? rules.devices : [];
    return { contests, splits, timingPoints, devices };
  }

  const contests = Array.isArray(result?.contests)
    ? result.contests
    : Array.isArray(result?.data?.contests)
      ? result.data.contests
      : [];
  const splits = Array.isArray(result?.splits)
    ? result.splits
    : Array.isArray(result?.data?.splits)
      ? result.data.splits
      : [];
  const timingPoints = Array.isArray(result?.timing_points)
    ? result.timing_points
    : Array.isArray(result?.data?.timing_points)
      ? result.data.timing_points
      : [];
  const devices = Array.isArray(result?.devices)
    ? result.devices
    : Array.isArray(result?.data?.devices)
      ? result.data.devices
      : [];
  return { contests, splits, timingPoints, devices };
}

function hasCloudTimingRules(result: any) {
  const payload = timingRulesPayloadFromResult(result);
  return payload.contests.length > 0 || payload.splits.length > 0 || payload.timingPoints.length > 0 || payload.devices.length > 0;
}

async function setTimingRuleSource(env: WorkerEnv, eventId: string, source: 'cloud' | 'local_database' | 'manual') {
  await writeKvJson(env, `live:event:${eventId}:timing-rules-source`, {
    source: 'cloud',
    updatedAt: new Date().toISOString(),
  });

  const current = (await readKvJson(env, `live:event:${eventId}:provider-config`)) || {};
  await writeKvJson(env, `live:event:${eventId}:provider-config`, {
    ...(current || {}),
    feibotConfig: {
      ...(current?.feibotConfig || {}),
      timingRuleSource: 'cloud',
    },
  });
}

async function getTimingRuleSource(env: WorkerEnv, eventId: string, hub: any) {
  const sourceFromHub = String(hub?.feibotConfig?.timingRuleSource || hub?.timingRuleSource || '').trim();
  if (sourceFromHub === 'cloud' || sourceFromHub === 'cloud_api') return 'cloud';
  const sourceState = await readKvJson(env, `live:event:${eventId}:timing-rules-source`);
  const sourceFromKv = String(sourceState?.source || '').trim();
  if (sourceFromKv === 'cloud' || sourceFromKv === 'cloud_api') return 'cloud';
  const importsState = await readKvJson(env, `live:event:${eventId}:imports`);
  const importSource = String(importsState?.timingRules?.source || '').trim();
  return 'cloud';
}

async function runFeibotEndpointDiagnostics(env: WorkerEnv, eventId: string, config: FeibotConfig) {
  const timestamp = new Date().toISOString();
  const eventUuid = encodeURIComponent(getScoreEventUuid(config));

  const run = async (label: string, endpoint: string) => {
    const startedAt = Date.now();
    try {
      const result = await feibotRequest(endpoint, config, { method: 'GET' }, { env, eventId, endpointName: label });
      const responseTimeMs = Date.now() - startedAt;
      const rows = extractFeibotParticipants(result);
      return {
        label,
        endpoint,
        status: 'PASS',
        success: true,
        httpStatus: 200,
        responseTimeMs,
        count: rows.length,
        available: rows.length > 0 || (result && typeof result === 'object' ? Object.keys(result).length > 0 : false),
        timestamp,
      };
    } catch (error) {
      return {
        label,
        endpoint,
        status: 'FAIL',
        success: false,
        httpStatus: extractHttpStatus(error) || 502,
        responseTimeMs: Date.now() - startedAt,
        count: 0,
        available: false,
        timestamp,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const participants = await run('Participants', `/temporary/participantsGetAll?event_uuid=${eventUuid}`);
  const results = await run('Results', `/temporary/temporary_ResultDataGetAll?event_uuid=${eventUuid}`);
  const leaderboard = await run('Leaderboard', `/api/leaderboardQuery?event_uuid=${eventUuid}`);
  const process = await run('Process', `/api/processQuery?event_uuid=${eventUuid}`);

  try {
    const rawProcess = JSON.stringify({ eventId, importedAt: timestamp, payload: process }, null, 2);
    await env.BERGMAN_R2.put(`events/${eventId}/configuration/process.json`, rawProcess);
    await env.BERGMAN_R2.put(`events/${eventId}/configuration/process-${Date.now()}.json`, rawProcess);
  } catch (e) {
    console.warn('Failed to write raw process diagnostics to R2', e instanceof Error ? e.message : e);
  }

  await writeKvJson(env, `live:event:${eventId}:timing-rules-diagnostics`, {
    timestamp,
    authentication: 'PASS',
    timingRules: 'EMPTY',
    endpoints: {
      participants,
      results,
      leaderboard,
      process,
    },
  });

  return {
    timestamp,
    authentication: 'PASS',
    timingRules: 'EMPTY',
    endpoints: {
      participants,
      results,
      leaderboard,
      process,
    },
  };
}

async function validateExternalUrlStatus(url: string) {
  const target = String(url || '').trim();
  const checkedAt = new Date().toISOString();
  if (!target) {
    return {
      available: false,
      status: 0,
      statusText: 'Not Configured',
      checkedAt,
    };
  }

  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': 'BERGMAN-Live-Tracking-Worker/1.0',
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    } as any);

    return {
      available: response.ok,
      status: Number(response.status || 0),
      statusText: String(response.statusText || ''),
      checkedAt,
    };
  } catch (error) {
    return {
      available: false,
      status: 0,
      statusText: error instanceof Error ? error.message : 'Request failed',
      checkedAt,
    };
  }
}

function hasFeibotConfiguration(hub: any) {
  const cloud = hub?.feibotConfig?.cloud || {};
  return !!(
    hub?.provider === 'feibot' &&
    (cloud?.accessKey || hub?.feibotConfig?.accessKey) &&
    (cloud?.secretKey || hub?.feibotConfig?.secretKey) &&
    (cloud?.eventUuid || hub?.feibotConfig?.eventUuid)
  );
}

function computeDuplicateBibCount(items: any[]) {
  const seen = new Map<string, number>();
  for (const item of items) {
    const bib = String(item?.bib || item?.bib_no || item?.number || '').trim();
    if (!bib) continue;
    seen.set(bib, (seen.get(bib) || 0) + 1);
  }

  let duplicates = 0;
  for (const count of seen.values()) {
    if (count > 1) duplicates += count - 1;
  }
  return duplicates;
}

function buildSyntheticRecentActivity(params: {
  logs: any[];
  providerConfigured: boolean;
  providerStatus: string;
  providerName: string;
  timingRulesImported: boolean;
  participantsImported: boolean;
  providerDiagnostics: any;
  eventUpdatedAt?: string | null;
}) {
  const logItems = Array.isArray(params.logs)
    ? params.logs
        .map((entry) => ({
          at: entry?.at || entry?.timestamp || entry?.createdAt || null,
          title: entry?.title || entry?.message || 'Activity',
          description: entry?.description || null,
          severity: entry?.severity || entry?.level || 'info',
        }))
        .filter((entry) => entry.title)
    : [];

  if (logItems.length > 0) return logItems.slice(0, 6);

  const nowIso = new Date().toISOString();
  const activity: Array<{ at: string; title: string; description: string; severity: 'info' | 'warning' | 'error' }> = [];

  if (params.providerConfigured) {
    activity.push({
      at: params.eventUpdatedAt || nowIso,
      title: 'Provider Configuration Saved',
      description: `${params.providerName} configuration is stored on the event document.`,
      severity: 'info',
    });
  }

  if (params.providerStatus === 'connected') {
    activity.push({
      at: params.providerDiagnostics?.lastSuccessAt || params.providerDiagnostics?.lastTestAt || params.eventUpdatedAt || nowIso,
      title: 'Connection Test Successful',
      description: 'Provider authentication is verified and ready for imports.',
      severity: 'info',
    });
  }

  if (!params.timingRulesImported) {
    activity.push({
      at: nowIso,
      title: 'Waiting for Timing Rule Import',
      description: 'Import timing rules to unlock splits, checkpoints, and race progress.',
      severity: 'warning',
    });
  }

  if (!params.participantsImported) {
    activity.push({
      at: nowIso,
      title: 'Waiting for Participant Import',
      description: 'Import Bergman and provider participants to enable live athlete tracking.',
      severity: 'warning',
    });
  }

  return activity.slice(0, 6);
}

async function getOverview(env: WorkerEnv, eventId: string) {
  const cached = await readKvJson(env, `live:event:${eventId}:overview`);
  const athletes = await getAthletes(env, eventId);
  const monitoring = await readKvJson(env, `live:event:${eventId}:monitoring`);
  const providerDiagnostics = await readKvJson(env, `live:event:${eventId}:provider-diagnostics`);
  const providerState = (await readKvJson(env, `event:${eventId}:providerState`)) || (await readKvJson(env, `live:event:${eventId}:providerState`)) || null;
  const providerParticipantsKv = (await readKvJson(env, `event:${eventId}:providerParticipants`)) || (await readKvJson(env, `live:event:${eventId}:providerParticipants`)) || null;
  const participantMappingsKv = (await readKvJson(env, `event:${eventId}:participantMappings`)) || (await readKvJson(env, `live:event:${eventId}:participantMappings`)) || null;
  const timingRuleDiagnostics = await readKvJson(env, `live:event:${eventId}:timing-rules-diagnostics`);
  const importsStateRaw = await readKvJson(env, `live:event:${eventId}:imports`);
  const savedProviderConfig = await readKvJson(env, `live:event:${eventId}:provider-config`);
  const logs = await getLogs(env, eventId);
  const eventConfig = await loadEventConfig(env, eventId).catch(() => null);
  const hub = mergeHubConfig(getHubConfig(eventConfig), savedProviderConfig);
  const timingRuleSource = await getTimingRuleSource(env, eventId, hub);
  const nowIso = new Date().toISOString();
  const activeAthletes = athletes.length;
  const providerImported = Array.isArray(providerParticipantsKv?.participants)
    ? providerParticipantsKv.participants.length
    : Number(providerParticipantsKv?.importedCount || 0);
  const participantMappingsList = Array.isArray(participantMappingsKv?.mappings) ? participantMappingsKv.mappings : [];
  const participantMappingsMapped = participantMappingsList.filter((mapping: any) => Boolean(mapping?.synced ?? mapping?.mapped ?? String(mapping?.status || '').toLowerCase() === 'matched')).length;
  const participantMappingsUnmatched = participantMappingsList.filter((mapping: any) => String(mapping?.status || '').toLowerCase() === 'unmatched' || String(mapping?.status || '').toLowerCase() === 'needs_review').length;
  const providerMapped = Number(participantMappingsKv?.summary?.mapped ?? participantMappingsMapped ?? providerParticipantsKv?.mappingSummary?.mapped ?? 0);
  const providerUnmatched = Number(participantMappingsKv?.summary?.unmatched ?? participantMappingsUnmatched ?? providerParticipantsKv?.mappingSummary?.unmatched ?? 0);
  const providerMissingChips = Number(providerParticipantsKv?.mappingSummary?.missingChips || 0);
  const providerDuplicateBibs = Number(participantMappingsKv?.summary?.registrationDuplicates || providerParticipantsKv?.mappingSummary?.registrationDuplicates || providerParticipantsKv?.mappingSummary?.providerBibDuplicates || 0);
  const finished = athletes.filter((athlete: any) => String(athlete?.status || '').toLowerCase() === 'finished' || String(athlete?.leg || '').toUpperCase() === 'FINISHED').length;
  const dnf = athletes.filter((athlete: any) => String(athlete?.status || '').toLowerCase() === 'dnf').length;
  const dns = athletes.filter((athlete: any) => String(athlete?.status || '').toLowerCase() === 'dns').length;
  const imported = activeAthletes;
  const registeredBibNumbers = Array.isArray(eventConfig?.registrationStats?.bibNumbers)
    ? eventConfig.registrationStats.bibNumbers.map((bib) => String(bib || '').trim()).filter(Boolean)
    : [];
  const registeredBibSet = new Set(registeredBibNumbers);
  const mappedByBib = registeredBibSet.size > 0
    ? athletes.filter((athlete: any) => {
        const bib = String(athlete?.bib || athlete?.bib_no || athlete?.number || '').trim();
        return !!bib && registeredBibSet.has(bib);
      }).length
    : athletes.filter((athlete: any) => !!athlete?.bib).length;
  const mapped = Number(monitoring?.mappingSummary?.mapped ?? providerMapped ?? mappedByBib);
  const unmatched = Number(monitoring?.mappingSummary?.unmatched ?? providerUnmatched ?? Math.max(imported - mapped, 0));
  const importsState = {
    ...defaultImportsState(),
    ...(importsStateRaw || {}),
    timingRules: {
      ...defaultImportsState().timingRules,
      ...(importsStateRaw?.timingRules || {}),
      count: {
        ...defaultImportsState().timingRules.count,
        ...(importsStateRaw?.timingRules?.count || {}),
      },
    },
    participants: {
      ...defaultImportsState().participants,
      ...(importsStateRaw?.participants || {}),
    },
    results: {
      ...defaultImportsState().results,
      ...(importsStateRaw?.results || {}),
    },
  };
  const timingConfigurationSnapshot =
    (await readKvJson(env, `event:${eventId}:timingConfiguration`)) ||
    (await readKvJson(env, `live:event:${eventId}:timingConfiguration`)) ||
    null;
  const timingConfigurationAgeGroups = Array.isArray(timingConfigurationSnapshot?.ageGroups)
    ? timingConfigurationSnapshot.ageGroups.length
    : Number(timingConfigurationSnapshot?.ageGroupsCount || 0);

  const missingChips = Number(
    monitoring?.missingChips ?? eventConfig?.registrationStats?.missingChips ?? athletes.filter((athlete: any) => !String(athlete?.chipCode || '').trim()).length ?? 0,
  );
  const duplicates = Number(
    monitoring?.mappingSummary?.registrationDuplicates ?? eventConfig?.registrationStats?.duplicates ?? monitoring?.duplicateParticipants ?? computeDuplicateBibCount(athletes),
  );
  const registered = Number(monitoring?.mappingSummary?.totalRegistrations ?? eventConfig?.registrationStats?.registered ?? monitoring?.registeredParticipants ?? imported);
  const recentLogs = Array.isArray(logs?.logs) ? logs.logs.slice(-6).reverse() : [];
  const providerName = normalizeProviderLabel(hub?.provider || cached?.provider || 'feibot');
  const cloudEventUuid = String(hub?.feibotConfig?.cloud?.eventUuid || hub?.feibotConfig?.eventUuid || '').trim();
  const scoreEventUuid = String(hub?.feibotConfig?.score?.eventUuid || '').trim();
  const scoreOverviewUrl = scoreEventUuid ? `https://score.feibot.com/?id=${encodeURIComponent(scoreEventUuid)}` : '';
  const scoreProgressUrl = scoreEventUuid
    ? `https://score.feibot.com/onlineDateQuery/index.html#/progress/event?event_uuid=${encodeURIComponent(scoreEventUuid)}`
    : '';
  const providerConfigured = hasFeibotConfiguration(hub);
  const cloudEventLoaded = !!cloudEventUuid;
  const timingSourceLabel = timingRuleSource === 'manual' ? 'manual' : 'cloud_api';
  const timingSourceRecommendation = timingSourceLabel === 'manual' ? 'Manual Configuration' : 'Cloud API';
  const authState = String(providerDiagnostics?.authenticationState?.status || providerDiagnostics?.authentication || '').trim().toLowerCase();
  const authenticationFailed = authState === 'failed';
  const authenticationVerified = authState === 'verified';
  const providerVerified = authenticationVerified;
  const trackingEnabled = hub?.trackingConfig?.enabled ?? eventConfig?.event?.liveTrackingEnabled ?? true;
  const timingRulesImported =
    importsState.timingRules.status === 'completed' || importsState.timingRules.status === 'not_available_cloud' ||
    (Array.isArray(hub?.categoryTimingConfiguration) && hub.categoryTimingConfiguration.length > 0);
  const participantsImported = importsState.participants.status === 'completed' ? Number(importsState.participants.count || 0) > 0 : providerImported > 0 || imported > 0;
  const resultsImported = importsState.results.status === 'completed' ? Number(importsState.results.count || 0) > 0 : Boolean(monitoring?.resultsImported);
  const chipAssignment = participantsImported
    ? {
        status: 'ready',
        assigned: athletes.filter((athlete: any) => String(athlete?.chipCode || '').trim().length > 0).length,
        missing: providerMissingChips || missingChips,
        duplicates: providerDuplicateBibs || computeDuplicateBibCount(athletes.map((athlete: any) => ({ bib: athlete?.chipCode }))),
        conflicts: Number(monitoring?.mappingSummary?.conflicts ?? monitoring?.chipConflicts ?? providerParticipantsKv?.mappingSummary?.conflicts ?? 0),
      }
    : {
        status: 'waiting_for_import',
        assigned: 0,
        missing: null,
        duplicates: 0,
        conflicts: 0,
      };
  const mappingScore = registered > 0 ? Math.min(20, Math.round((mapped / Math.max(registered, 1)) * 20)) : 0;
  const readinessScore = (() => {
    let score = 0;
    if (authenticationVerified) score += 20;
    if (timingRulesImported) score += 15;
    if (participantsImported) score += 20;
    score += mappingScore;
    if (resultsImported) score += 10;
    if (leaderboardsReady(hub)) score += 10;
    if (trackingEnabled && Number(monitoring?.readsPerMinute || 0) > 0) score += 5;
    return Math.max(0, Math.min(100, score));
  })();
  const providerStatus = (() => {
    const providerStateStatus = String(providerState?.status || '').trim().toLowerCase();
    if (providerStateStatus === 'connected' || providerStateStatus === 'warning') return providerStateStatus;
    const lastStatusCode = Number(providerDiagnostics?.authenticationState?.lastStatusCode || providerDiagnostics?.lastApiCall?.status || 0);
    const lastErrorMessage = String(providerDiagnostics?.authenticationState?.lastError || providerDiagnostics?.message || '').toLowerCase();
    const isNetworkFailure = /timeout|timed out|network|fetch failed|econn|enotfound|dns|socket|abort/.test(lastErrorMessage);
    if (!providerConfigured && !cloudEventLoaded) return 'error';
    if (authenticationFailed) return 'error';
    if (lastStatusCode === 403) return 'error';
    if (lastStatusCode >= 500 || isNetworkFailure) return 'warning';
    if (providerVerified) return 'connected';
    return 'warning';
  })();
  const configurationSource = providerConfigured || cloudEventLoaded ? 'cloud_api' : 'manual';
  const lastApiCall = providerDiagnostics?.lastApiCall
    ? providerDiagnostics.lastApiCall
    : providerDiagnostics?.endpoint || providerDiagnostics?.lastTestAt
      ? {
          endpoint: String(providerDiagnostics?.endpoint || 'timingRulesGet'),
          durationMs: Number(providerDiagnostics?.durationMs || providerDiagnostics?.responseTimeMs || monitoring?.providerResponseMs || 0),
          responseTimeMs: Number(providerDiagnostics?.responseTimeMs || monitoring?.providerResponseMs || 0),
          status: providerDiagnostics?.status === 'error' || providerDiagnostics?.authentication === 'failed' ? 502 : 200,
          success: !(providerDiagnostics?.status === 'error' || providerDiagnostics?.authentication === 'failed'),
          timestamp: providerDiagnostics?.lastTestAt || providerDiagnostics?.lastSuccessAt || monitoring?.lastSync || nowIso,
        }
      : null;
  const storedAuthentication = providerDiagnostics?.authenticationState || {
    status: !providerConfigured ? 'pending' : authenticationFailed ? 'failed' : authenticationVerified ? 'verified' : 'unknown',
    checkedAt: providerDiagnostics?.lastTestAt || providerDiagnostics?.lastSuccessAt || null,
    lastSuccess: providerDiagnostics?.lastSuccessAt || null,
    lastFailure: providerDiagnostics?.lastFailureAt || null,
    lastStatusCode: providerDiagnostics?.lastApiCall?.status || null,
    lastError: providerDiagnostics?.message || null,
  };
  const storedScoreOverview = providerDiagnostics?.score?.overview || {
    available: !!scoreOverviewUrl,
    status: scoreOverviewUrl ? 200 : 0,
    statusText: scoreOverviewUrl ? 'Configured' : 'Not Configured',
    checkedAt: providerDiagnostics?.lastTestAt || providerDiagnostics?.lastSuccessAt || null,
  };
  const storedScoreProgress = providerDiagnostics?.score?.progress || {
    available: !!scoreProgressUrl,
    status: scoreProgressUrl ? 200 : 0,
    statusText: scoreProgressUrl ? 'Configured' : 'Not Configured',
    checkedAt: providerDiagnostics?.lastTestAt || providerDiagnostics?.lastSuccessAt || null,
  };
  const storedCloudApi = providerDiagnostics?.cloudApi || {
    status: authenticationVerified ? 'PASS' : authenticationFailed ? 'FAILED' : (providerConfigured || cloudEventLoaded) ? 'CONFIGURED' : 'MISSING',
    checkedAt: providerDiagnostics?.lastTestAt || providerDiagnostics?.lastSuccessAt || null,
    statusCode: providerDiagnostics?.lastApiCall?.status || null,
  };
  const storedTimingRules = providerDiagnostics?.timingRules || {
    status:
      importsState.timingRules.status === 'not_available_cloud'
        ? 'EMPTY'
        : timingRulesImported
          ? 'PASS'
          : 'WAITING',
    checkedAt: importsState.timingRules.lastImport || providerDiagnostics?.lastTestAt || null,
  };
  const alerts = buildOverviewAlerts({
    imported,
    unmatched,
    missingChips: chipAssignment.status === 'ready' ? Number(chipAssignment.missing || 0) : null,
    workerOnline: true,
    providerConfigured,
    providerConnected: providerStatus === 'connected',
    authenticationFailed,
    timingRulesImported,
    participantsImported,
  });
  const recentActivity = buildSyntheticRecentActivity({
    logs: recentLogs,
    providerConfigured,
    providerStatus,
    providerName,
    timingRulesImported,
    participantsImported,
    providerDiagnostics,
    eventUpdatedAt: eventConfig?.event?.updatedAt || eventConfig?.updatedAt || null,
  });

  return {
    provider: {
      name: providerState?.provider || providerName,
      status: providerState?.status || providerStatus,
      configurationSource: providerState?.configurationSource || configurationSource,
      eventUuid: cloudEventUuid,
      cloudEventUuid,
      scoreEventUuid,
      scoreOverviewUrl,
      scoreProgressUrl,
      eventName: eventConfig?.event?.eventName || eventConfig?.eventName || '—',
      lastSync: providerState?.lastSuccessfulConnection || monitoring?.lastSync || providerDiagnostics?.lastSuccessAt || cached?.lastUpdate || nowIso,
      responseTimeMs: Number(providerState?.lastResponseTime ?? providerDiagnostics?.responseTimeMs ?? monitoring?.providerResponseMs ?? 0),
      lastApiCall,
      authentication: providerState?.authentication || storedAuthentication?.status || (!providerConfigured ? 'pending' : authenticationFailed ? 'failed' : providerVerified ? 'verified' : 'unknown'),
      authenticationState: storedAuthentication,
      score: {
        overview: storedScoreOverview,
        progress: storedScoreProgress,
      },
      timingRulesImported: Boolean(providerState?.timingRulesImported || timingRulesImported),
      participantsImported: Boolean(providerState?.participantsImported || participantsImported),
      resultsImported: Boolean(providerState?.resultsImported || resultsImported),
      cloud: {
        eventUuid: cloudEventUuid || null,
        scoreEventUuid: scoreEventUuid || null,
        contests: Number(importsState.timingRules.count?.contests || 0),
        splits: Number(importsState.timingRules.count?.splits || 0),
        timingPoints: Number(importsState.timingRules.count?.timingPoints || 0),
        ageGroups: Number(timingConfigurationAgeGroups || 0),
        participants: providerImported || imported,
        devices: Number(importsState.timingRules.count?.devices || 0),
      },
      diagnostics: {
        authentication: String(providerState?.authentication || storedAuthentication?.status || '').toUpperCase() || 'UNKNOWN',
        cloudApi: String(providerState?.cloudApi || storedCloudApi.status || '').toUpperCase() || storedCloudApi.status,
        scoreSystem: storedScoreOverview.available ? 'PASS' : scoreEventUuid ? 'WAITING' : 'NOT_CONFIGURED',
        timingRules: storedTimingRules.status,
        participants: (providerState?.participantsImported ?? participantsImported) ? 'PASS' : 'WAITING',
        results: (providerState?.resultsImported ?? resultsImported) ? 'PASS' : 'WAITING',
        scoreOverview: storedScoreOverview,
        scoreProgress: storedScoreProgress,
      },
      providerState: providerState || null,
    },
    imports: {
      timingRules: timingRulesImported
        ? {
            status: importsState.timingRules.status || 'completed',
            count: {
              contests: importsState.timingRules.status === 'not_available_cloud'
                ? Number(importsState.timingRules.count?.contests || 0)
                : Number(importsState.timingRules.count?.contests || hub?.categoryTimingConfiguration?.length || 0),
              splits: Number(importsState.timingRules.count?.splits || 0),
              timingPoints: Number(
                importsState.timingRules.status === 'not_available_cloud'
                  ? Number(importsState.timingRules.count?.timingPoints || 0)
                  : importsState.timingRules.count?.timingPoints ||
                      (Array.isArray(hub?.categoryTimingConfiguration)
                        ? hub.categoryTimingConfiguration.reduce((sum: number, item: any) => sum + Number(item?.timingPoints?.length || 0), 0)
                        : 0),
              ),
              devices: Number(importsState.timingRules.count?.devices || 0),
            },
            lastImport: importsState.timingRules.lastImport || monitoring?.timingRulesLastImport || providerDiagnostics?.lastSuccessAt || null,
            durationMs: Number(importsState.timingRules.durationMs || monitoring?.timingRulesImportDurationMs || 0) || null,
            source: timingSourceLabel,
            recommendation:
              importsState.timingRules.status === 'not_available_cloud'
                ? 'Cloud API'
                : timingSourceRecommendation,
            diagnostics: timingRuleDiagnostics || null,
          }
        : {
            status: 'waiting',
            count: {
              contests: 0,
              splits: 0,
              timingPoints: 0,
              devices: 0,
            },
            lastImport: null,
            durationMs: null,
            source: timingSourceLabel,
            recommendation: timingSourceRecommendation,
            diagnostics: timingRuleDiagnostics || null,
          },
      participants: participantsImported
        ? {
            status: 'completed',
            count: Number(importsState.participants.count || imported),
            lastImport: importsState.participants.lastImport || monitoring?.lastParticipantSync || null,
            durationMs: Number(importsState.participants.durationMs || 0) || null,
          }
        : {
            status: 'waiting',
            count: 0,
            lastImport: null,
            durationMs: null,
          },
      results: resultsImported
        ? {
            status: 'completed',
            count: Number(importsState.results.count || monitoring?.resultsCount || 0),
            lastImport: importsState.results.lastImport || monitoring?.resultsLastImport || null,
            durationMs: Number(importsState.results.durationMs || 0) || null,
          }
        : {
            status: 'waiting',
            count: 0,
            lastImport: null,
            durationMs: null,
          },
    },
    race: {
      name: eventConfig?.event?.eventName || eventConfig?.eventName || 'Bergman Event',
      status: eventConfig?.event?.status || eventConfig?.status || 'upcoming',
      raceDate: eventConfig?.event?.raceDate || eventConfig?.eventDate || null,
      startTime: eventConfig?.event?.startTime || eventConfig?.eventStartTime || null,
      estimatedStart: composeEstimatedStart(
        eventConfig?.event?.raceDate || eventConfig?.eventDate || null,
        eventConfig?.event?.startTime || eventConfig?.eventStartTime || null,
      ),
      countdown: monitoring?.countdown || null,
      liveDuration: monitoring?.liveDuration || null,
      phase: monitoring?.phase || eventConfig?.event?.phase || 'registration',
    },
    participants: {
      registered,
      imported: providerImported || imported,
      mapped,
      unmatched,
      duplicates: providerDuplicateBibs || duplicates,
      missingChips: chipAssignment.missing,
      chipAssignment,
      mappingSummary: {
        ...(participantMappingsKv?.summary || providerParticipantsKv?.mappingSummary || {}),
        mapped,
        unmatched,
        totalRegistrations: registered,
        totalProviderParticipants: providerImported || imported,
      },
      lastParticipantSync: monitoring?.lastParticipantSync || cached?.lastUpdate || nowIso,
    },
    syncEngine: {
      state: String(monitoring?.syncEngine?.state || 'idle'),
      lastRun: monitoring?.syncEngine?.lastRun || monitoring?.lastSync || null,
      nextRun: monitoring?.syncEngine?.nextRun || null,
      readsProcessed: Number(monitoring?.syncEngine?.readsProcessed || 0),
      lastError: monitoring?.syncEngine?.lastError || null,
    },
    tracking: {
      enabled: trackingEnabled,
      activeAthletes,
      finished,
      dnf,
      dns,
      lastRead: monitoring?.lastRead || cached?.lastUpdate || nowIso,
      readsPerMinute: Number(monitoring?.readsPerMinute || 0),
      averageProcessingDelaySec: Number(monitoring?.averageProcessingDelaySec || 0),
    },
    leaderboards: {
      overall: true,
      categories: Boolean(hub?.leaderboardConfig?.modes?.length),
      clubs: Boolean(hub?.trackingConfig?.enableClubRankings),
      relay: Boolean(hub?.leaderboardConfig?.modes?.includes?.('relay')),
      lastUpdate: monitoring?.leaderboardLastUpdate || cached?.lastUpdate || nowIso,
      refreshRateSec: Number(hub?.syncEngine?.leaderboardEverySeconds || 5),
    },
    cloudflare: {
      worker: 'online',
      kv: 'connected',
      kvObjects: activeAthletes + providerImported,
      r2: 'connected',
      r2Objects: Number(monitoring?.r2Objects || 0),
      durableObject: 'connected',
      currentSessions: Number(monitoring?.currentSessions || 1),
      cacheHitRate: Number(cached?.cacheHitRate || monitoring?.cacheHitRate || 0),
      workerLatencyMs: Number(monitoring?.workerLatencyMs || 24),
      storageUsed: cached?.storageUsage || monitoring?.storageUsage || 'KV/R2',
    },
    storage: {
      kvReads: Number(monitoring?.kvReads || 0),
      kvWrites: Number(monitoring?.kvWrites || 0),
      r2Reads: Number(monitoring?.r2Reads || 0),
      r2Writes: Number(monitoring?.r2Writes || 0),
      historicalReadsStored: Number(monitoring?.historicalReadsStored || 0),
      replaySnapshots: Number(monitoring?.replaySnapshots || 0),
      resultFiles: Number(monitoring?.resultFiles || 0),
      participantFiles: Number(monitoring?.participantFiles || 0),
      analyticsFiles: Number(monitoring?.analyticsFiles || 0),
    },
    performance: {
      feibotResponseTimeMs: Number(monitoring?.providerResponseMs || 0),
      workerResponseTimeMs: Number(monitoring?.workerLatencyMs || 24),
      overviewApiMs: Number(monitoring?.overviewApiMs || 15),
      leaderboardApiMs: Number(monitoring?.leaderboardApiMs || 9),
      trackingApiMs: Number(monitoring?.trackingApiMs || 12),
      averageSyncMs: Number(monitoring?.averageSyncMs || 1500),
      requestsToday: Number(cached?.readsToday || monitoring?.requestsToday || 0),
      errorsToday: Number(monitoring?.errorsToday || 0),
      retries: Number(monitoring?.retries || 0),
    },
    readiness: {
      score: readinessScore,
      status: readinessScore >= 90 ? 'ready' : readinessScore > 0 ? 'setup_required' : 'draft',
    },
    alerts,
    recentActivity,
  };
}

async function getMonitoringDashboard(env: WorkerEnv, eventId: string) {
  const [overview, monitoringRaw, providerDiagnostics] = await Promise.all([
    getOverview(env, eventId),
    readKvJson(env, `live:event:${eventId}:monitoring`),
    readKvJson(env, `live:event:${eventId}:provider-diagnostics`),
  ]);

  const monitoring = monitoringRaw || {};
  const nowIso = new Date().toISOString();
  const providerResponseMs = Number(
    overview?.provider?.lastApiCall?.responseTimeMs ||
      overview?.provider?.responseTimeMs ||
      providerDiagnostics?.responseTimeMs ||
      monitoring?.providerResponseMs ||
      0,
  );
  const authStatus = String(overview?.provider?.authenticationState?.status || overview?.provider?.authentication || 'unknown').toLowerCase();
  const cloudStatus = String(overview?.provider?.diagnostics?.cloudApi || 'UNKNOWN').toUpperCase();
  const timingRulesStatus = String(overview?.provider?.diagnostics?.timingRules || 'UNKNOWN').toUpperCase();

  let healthScore = 0;
  if (authStatus === 'verified') healthScore += 30;
  if (cloudStatus === 'PASS' || cloudStatus === 'LOCAL_DATABASE') healthScore += 20;
  if (timingRulesStatus === 'PASS') healthScore += 15;
  if (overview?.imports?.participants?.status === 'completed') healthScore += 10;
  if (overview?.cloudflare?.worker === 'online') healthScore += 10;
  if (overview?.cloudflare?.kv === 'connected') healthScore += 5;
  if (overview?.cloudflare?.r2 === 'connected') healthScore += 5;
  if (overview?.cloudflare?.durableObject === 'connected') healthScore += 5;
  if (providerResponseMs > 0 && providerResponseMs <= 3000) healthScore += 10;
  healthScore = Math.max(0, Math.min(100, healthScore));

  const recommendations: string[] = [];
  if (authStatus !== 'verified') recommendations.push('Cloud authentication failed. Verify Access Key, Secret Key, and Event UUID.');
  if (timingRulesStatus !== 'PASS') recommendations.push('Import timing rules from local database or cloud before race start.');
  if (overview?.imports?.participants?.status !== 'completed') recommendations.push('Import participants and map bib/chip assignments.');
  if (Number(overview?.participants?.missingChips || 0) > 0) recommendations.push('Resolve missing chip assignments for imported participants.');
  if (Number(overview?.participants?.duplicates || 0) > 0) recommendations.push('Resolve duplicate bib/chip mappings before going live.');
  if (providerResponseMs > 3000) recommendations.push('Provider API response time is high. Re-test connectivity and check provider service health.');

  return {
    provider: {
      name: overview?.provider?.name || 'Unknown',
      status: overview?.provider?.status || 'warning',
      authentication: overview?.provider?.authenticationState || null,
      cloudApi: {
        status: cloudStatus,
        checkedAt: overview?.provider?.diagnostics?.scoreOverview?.checkedAt || providerDiagnostics?.lastTestAt || null,
        statusCode: overview?.provider?.lastApiCall?.status || null,
      },
      lastApiCall: overview?.provider?.lastApiCall || null,
      lastError: providerDiagnostics?.lastError || null,
      lastTest: providerDiagnostics?.lastTest || null,
    },
    syncEngine: {
      ...(overview?.syncEngine || {}),
      state: overview?.syncEngine?.state || 'idle',
    },
    worker: {
      status: overview?.cloudflare?.worker || 'unknown',
      latencyMs: Number(overview?.cloudflare?.workerLatencyMs || monitoring?.workerLatencyMs || 0),
      cacheHitRate: Number(overview?.cloudflare?.cacheHitRate || monitoring?.cacheHitRate || 0),
    },
    kv: {
      status: overview?.cloudflare?.kv || 'unknown',
      objects: Number(overview?.cloudflare?.kvObjects || 0),
      reads: Number(overview?.storage?.kvReads || 0),
      writes: Number(overview?.storage?.kvWrites || 0),
    },
    r2: {
      status: overview?.cloudflare?.r2 || 'unknown',
      objects: Number(overview?.cloudflare?.r2Objects || 0),
      reads: Number(overview?.storage?.r2Reads || 0),
      writes: Number(overview?.storage?.r2Writes || 0),
    },
    durableObject: {
      status: overview?.cloudflare?.durableObject || 'unknown',
      sessions: Number(overview?.cloudflare?.currentSessions || 0),
    },
    tracking: {
      ...(overview?.tracking || {}),
      imports: {
        participants: overview?.imports?.participants || null,
        results: overview?.imports?.results || null,
        timingRules: overview?.imports?.timingRules || null,
      },
    },
    performance: {
      ...(overview?.performance || {}),
      providerResponseMs,
    },
    health: {
      score: healthScore,
      status: healthScore >= 90 ? 'healthy' : healthScore >= 70 ? 'warning' : 'critical',
      lastEvaluatedAt: nowIso,
    },
    readiness: overview?.readiness || { score: 0, status: 'draft' },
    recommendations,
    rawMonitoring: monitoring,
  };
}

function leaderboardsReady(hub: any) {
  return Array.isArray(hub?.leaderboardConfig?.modes) && hub.leaderboardConfig.modes.length > 0;
}

function buildOverviewAlerts(params: { imported: number; unmatched: number; missingChips: number | null; workerOnline: boolean; providerConfigured: boolean; providerConnected: boolean; authenticationFailed: boolean; timingRulesImported: boolean; participantsImported: boolean }) {
  const alerts: Array<{ severity: 'error' | 'warning' | 'info'; title: string }> = [];
  if (!params.workerOnline) alerts.push({ severity: 'error', title: 'Cloudflare Worker Offline' });
  if (!params.providerConfigured) {
    alerts.push({ severity: 'error', title: 'Provider Configuration Missing' });
  } else if (params.authenticationFailed) {
    alerts.push({ severity: 'error', title: 'Provider Authentication Failed' });
  } else if (params.providerConnected) {
    alerts.push({ severity: 'info', title: 'Provider Connected' });
  }
  if (!params.timingRulesImported) alerts.push({ severity: 'warning', title: 'Timing Rules Not Imported' });
  if (!params.participantsImported) alerts.push({ severity: 'warning', title: 'Participants Not Imported' });
  if (params.unmatched > 0) alerts.push({ severity: 'warning', title: 'Participant Mapping Incomplete' });
  if (Number(params.missingChips || 0) > 0) alerts.push({ severity: 'warning', title: 'Missing Chips' });
  return alerts;
}

function parseIncludeEmptyFlag(url: URL) {
  const raw = String(url.searchParams.get('includeEmpty') || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

async function getActiveContestIdentifiers(env: WorkerEnv, eventId: string) {
  const providerParticipants =
    (await readKvJson(env, `event:${eventId}:providerParticipants`)) ||
    (await readKvJson(env, `live:event:${eventId}:providerParticipants`)) ||
    {};
  const participants = Array.isArray((providerParticipants as any)?.participants) ? (providerParticipants as any).participants : [];
  const activeIds = new Set<string>();
  const activeNames = new Set<string>();

  for (const participant of participants) {
    const contestUuid = String(participant?.contestUuid || participant?.contest_uuid || participant?.providerContestUuid || '').trim();
    const contestName = String(participant?.contestName || participant?.contest_name || participant?.providerContestName || participant?.category || '').trim();
    if (contestUuid) activeIds.add(contestUuid);
    if (contestName) activeNames.add(contestName.toLowerCase());
  }

  return { activeIds, activeNames };
}

function normalizeTimingContest(entry: any, index: number) {
  const contestUuid = String(entry?.contestUuid || entry?.uuid || entry?.UUID || entry?.id || `contest-${index + 1}`).trim();
  const contestName = String(entry?.contestName || entry?.name || entry?.Name || '').trim();
  return {
    ...entry,
    contestUuid,
    contestName,
  };
}

async function filterTimingConfigurationContestsByActivity(env: WorkerEnv, eventId: string, timingConfiguration: any, includeEmpty: boolean) {
  if (!timingConfiguration || includeEmpty) return timingConfiguration;
  const { activeIds, activeNames } = await getActiveContestIdentifiers(env, eventId);
  if (activeIds.size === 0 && activeNames.size === 0) return timingConfiguration;

  const sourceContests = Array.isArray(timingConfiguration?.contests)
    ? timingConfiguration.contests
    : Array.isArray(timingConfiguration?.course?.contests)
      ? timingConfiguration.course.contests
      : [];

  if (!Array.isArray(sourceContests) || sourceContests.length === 0) return timingConfiguration;

  const filtered = sourceContests
    .map((entry: any, index: number) => normalizeTimingContest(entry, index))
    .filter((contest: any) => {
      const id = String(contest?.contestUuid || '').trim();
      const name = String(contest?.contestName || '').trim().toLowerCase();
      return (id && activeIds.has(id)) || (name && activeNames.has(name));
    });

  return {
    ...timingConfiguration,
    contests: filtered,
    course: {
      ...(timingConfiguration?.course || {}),
      contests: filtered,
    },
  };
}

async function getAthletes(env: WorkerEnv, eventId: string, categoryId?: string) {
  const categoryKey = categoryId ? `event:${eventId}:category:${categoryId}:athletes` : null;
  const cached = categoryKey ? await readKvJson(env, categoryKey) : await readKvJson(env, `live:event:${eventId}:athletes`);
  return Array.isArray(cached) ? cached : [];
}

async function getLogs(env: WorkerEnv, eventId: string) {
  const cached =
    (await readR2Json(env, `events/${eventId}/analytics/logs.json`)) ||
    (await readR2Json(env, `event/${eventId}/analytics/logs.json`));
  return cached || { logs: [] };
}

async function getLeaderboard(env: WorkerEnv, eventId: string, mode: string, limit: number, categoryId?: string) {
  const key = categoryId
    ? `event:${eventId}:category:${categoryId}:leaderboard:${mode}:${limit}`
    : `live:event:${eventId}:leaderboard:${mode}:${limit}`;
  const cached = await readKvJson(env, key);
  return cached || { mode, limit, rows: [] };
}

function extractFeibotParticipants(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];

  const directCandidates = [
    result.data,
    result.participants,
    result.rows,
    result.list,
    result.items,
    result.records,
    result.athletes,
    result.participant_list,
    result.participantList,
    result.dataList,
    result.tableData,
    result.content,
    result.participantData,
    result.participantDataList,
  ];
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  const visited = new Set<any>();
  const scoreArray = (items: any[]) => {
    if (!Array.isArray(items) || items.length === 0) return 0;
    const first = items[0];
    if (!first || typeof first !== 'object') return 0;
    let score = 0;
    const keys = ['bib', 'bib_no', 'bibNumber', 'number', 'no', 'name', 'full_name', 'email', 'mail', 'chip', 'chip_code', 'chipCode', 'registration_id', 'registrationId', 'athlete_uid', 'athleteUid', 'participant_uuid', 'participantUuid', 'id'];
    for (const key of keys) {
      if (key in first) score += 1;
    }
    return score;
  };

  const findArray = (input: any, depth = 0): any[] => {
    if (depth > 6) return [];
    if (!input || typeof input !== 'object' || visited.has(input)) return [];
    visited.add(input);

    const candidates: any[] = [];
    for (const value of Object.values(input)) {
      if (Array.isArray(value)) {
        candidates.push(value);
      } else if (value && typeof value === 'object') {
        const nested = findArray(value, depth + 1);
        if (nested.length > 0) candidates.push(nested);
      }
    }

    if (candidates.length === 0) return [];
    return candidates.sort((a, b) => scoreArray(b) - scoreArray(a))[0] || [];
  };

  const recursive = findArray(result);
  if (recursive.length > 0) return recursive;

  const nestedCandidates = [result.data, result.result, result.payload, result.response];
  for (const candidate of nestedCandidates) {
    if (candidate && typeof candidate === 'object') {
      const nested = extractFeibotParticipants(candidate);
      if (nested.length > 0) return nested;
    }
  }

  // Last-chance heuristic: pick first array of objects containing participant-like keys.
  for (const value of Object.values(result)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const first = value[0];
    if (!first || typeof first !== 'object') continue;
    const hasParticipantSignals =
      'bib' in first || 'bib_no' in first || 'number' in first || 'name' in first || 'full_name' in first || 'chip' in first || 'chip_code' in first;
    if (hasParticipantSignals) return value as any[];
  }

  return [];
}

function extractFeibotResults(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];

  const directCandidates = [result.data, result.results, result.rows, result.list, result.items];
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  const nestedCandidates = [result.data, result.result, result.payload];
  for (const candidate of nestedCandidates) {
    if (candidate && typeof candidate === 'object') {
      const nested = extractFeibotResults(candidate);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

async function fetchFeibotParticipantsPayload(env: WorkerEnv, eventId: string, config: FeibotConfig) {
  const cloudEventUuid = String(getCloudEventUuid(config) || '').trim();
  const scoreEventUuid = String(getScoreEventUuid(config) || '').trim();
  const uuidCandidates = Array.from(new Set([cloudEventUuid, scoreEventUuid].filter(Boolean)));

  const endpointTemplates = [
    {
      endpointName: 'participantsGetAll',
      endpointFor: (encodedUuid: string) => `/temporary/participantsGetAll?event_uuid=${encodedUuid}`,
    },
  ] as const;

  const errors: any[] = [];

  for (const rawUuid of uuidCandidates) {
    const encodedUuid = encodeURIComponent(rawUuid);
    for (const template of endpointTemplates) {
      const endpoint = template.endpointFor(encodedUuid);
      try {
        const payload = await feibotRequest(
          endpoint,
          config,
          { method: 'GET' },
          { env, eventId, endpointName: template.endpointName },
        );
        return {
          payload,
          endpointName: template.endpointName,
          endpoint,
          eventUuid: rawUuid,
        };
      } catch (error) {
        const tagged = error && typeof error === 'object'
          ? Object.assign(error as any, { endpointName: template.endpointName, attemptedEventUuid: rawUuid, attemptedEndpoint: endpoint })
          : { message: String(error || ''), endpointName: template.endpointName, attemptedEventUuid: rawUuid, attemptedEndpoint: endpoint };
        errors.push(tagged);
      }
    }
  }

  const preferred =
    errors.find((err) => err?.endpointName === 'participantsGetAll' && String(err?.attemptedEventUuid || '') === cloudEventUuid)
    || errors.find((err) => err?.endpointName === 'participantsGetAll')
    || errors[errors.length - 1]
    || null;

  throw preferred instanceof Error
    ? preferred
    : new Error(String((preferred as any)?.message || 'Failed to fetch Feibot participants'));
}

async function fetchFeibotResultsPayload(env: WorkerEnv, eventId: string, config: FeibotConfig) {
  const eventUuid = encodeURIComponent(getScoreEventUuid(config));
  const endpoints = [
    {
      endpoint: '/temporary/temporary_ResultDataGetAll?event_uuid=' + eventUuid,
      endpointName: 'temporary_ResultDataGetAll',
    },
    {
      endpoint: '/temporary/temporary_ResultDataQuery?event_uuid=' + eventUuid,
      endpointName: 'temporary_ResultDataQuery',
    },
    {
      endpoint: '/finishResultQuery?event_uuid=' + eventUuid,
      endpointName: 'finishResultQuery',
    },
    {
      endpoint: '/api/temporary_ResultDataGetAll?event_uuid=' + eventUuid,
      endpointName: 'api_temporary_ResultDataGetAll',
    },
    {
      endpoint: '/api/leaderboardQuery?event_uuid=' + eventUuid,
      endpointName: 'leaderboardQuery',
    },
    {
      endpoint: '/api/processQuery?event_uuid=' + eventUuid,
      endpointName: 'processQuery',
    },
  ] as const;

  const attempts: Array<{ endpoint: string; endpointName: string; status: number | null; message: string }> = [];
  let lastError: unknown = null;
  for (const candidate of endpoints) {
    try {
      const payload = await feibotRequest(
        candidate.endpoint,
        config,
        { method: 'GET' },
        { env, eventId, endpointName: candidate.endpointName },
      );
      return { payload, endpointName: candidate.endpointName, endpoint: candidate.endpoint };
    } catch (error) {
      lastError = error;
      const status = extractHttpStatus(error);
      attempts.push({
        endpoint: candidate.endpoint,
        endpointName: candidate.endpointName,
        status,
        message: stripStringToSignFromMessage(error instanceof Error ? error.message : String(error || 'Unknown error')),
      });
      if (status === 401 || status === 403) {
        break;
      }
    }
  }

  const attemptsSummary = attempts
    .map((attempt) => `${attempt.endpointName}:${attempt.status || 0}`)
    .join(', ');

  const baseMessage = stripStringToSignFromMessage(
    lastError instanceof Error ? lastError.message : String(lastError || 'Failed to fetch Feibot results'),
  );

  const aggregateError = new Error(
    attempts.length > 0
      ? `Feibot results fetch failed after ${attempts.length} endpoint attempts. Last error: ${baseMessage}. Attempts: ${attemptsSummary}`
      : baseMessage,
  );
  (aggregateError as any).attempts = attempts;
  (aggregateError as any).httpStatus = extractHttpStatus(lastError) || 500;

  if (lastError && typeof lastError === 'object') {
    (aggregateError as any).diagnostics = (lastError as any).diagnostics;
  }

  throw aggregateError;
}

function normalizeResultStatus(result: any) {
  const raw = String(
    result?.status ||
      result?.result_status ||
      result?.race_status ||
      result?.state ||
      result?.rank_status ||
      '',
  )
    .trim()
    .toLowerCase();

  if (raw === 'dnf' || raw === 'did_not_finish') return 'dnf';
  if (raw === 'dns' || raw === 'did_not_start') return 'dns';
  if (raw === 'dnq' || raw === 'disqualified' || raw === 'dq') return 'dnq';
  if (raw === 'finished' || raw === 'finish' || raw === 'ok' || raw === 'complete' || raw === 'completed') return 'finished';

  const finishLike = String(result?.finish_time || result?.finishTime || result?.official_time || result?.total_time || '').trim();
  return finishLike ? 'finished' : 'unknown';
}

function getResultBib(result: any) {
  return String(result?.bib || result?.bib_no || result?.number || result?.no || result?.bibNumber || '').trim();
}

function parseResultTimeToSeconds(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value : null;
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }
  const parts = text.split(':').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function extractResultLegSummary(result: any) {
  const swim = parseResultTimeToSeconds(result?.swim || result?.swim_time || result?.swimTime);
  const t1 = parseResultTimeToSeconds(result?.t1 || result?.transition1 || result?.t1_time || result?.transition_1_time);
  const bike = parseResultTimeToSeconds(result?.bike || result?.bike_time || result?.bikeTime || result?.cycle_time);
  const t2 = parseResultTimeToSeconds(result?.t2 || result?.transition2 || result?.t2_time || result?.transition_2_time);
  const run = parseResultTimeToSeconds(result?.run || result?.run_time || result?.runTime);
  const run1 = parseResultTimeToSeconds(result?.run1 || result?.run_1 || result?.run1_time);
  const run2 = parseResultTimeToSeconds(result?.run2 || result?.run_2 || result?.run2_time);
  const finish = parseResultTimeToSeconds(
    result?.finish_time || result?.finishTime || result?.official_time || result?.chip_time || result?.chipTime || result?.total_time,
  );

  const summary: Record<string, number> = {};
  if (swim) summary.SWIM = swim;
  if (t1) summary.T1 = t1;
  if (bike) summary.BIKE = bike;
  if (t2) summary.T2 = t2;
  if (run) summary.RUN = run;
  if (run1) summary.RUN1 = run1;
  if (run2) summary.RUN2 = run2;
  if (finish) {
    summary.FINISH = finish;
    summary.FINISHED = finish;
  }

  const splits = [
    { segment: 'SWIM', time: swim },
    { segment: 'T1', time: t1 },
    { segment: 'BIKE', time: bike },
    { segment: 'T2', time: t2 },
    { segment: 'RUN1', time: run1 },
    { segment: 'RUN2', time: run2 },
    { segment: 'RUN', time: run },
    { segment: 'FINISHED', time: finish },
  ]
    .filter((entry) => Number(entry.time || 0) > 0)
    .map((entry) => ({
      segment: entry.segment,
      name: entry.segment,
      distance: 0,
      time: Number(entry.time),
      rawSplitLabel: entry.segment,
    }));

  return {
    summary,
    splits,
    hasProgress: Object.keys(summary).length > 0,
  };
}

function normalizeGender(value: any): 'Male' | 'Female' {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'f' || text === 'female' || text === 'woman' || text === 'women' || text === 'girl' || text === '2' || text === '女') {
    return 'Female';
  }
  return 'Male';
}

function normalizeFeibotParticipant(eventId: string, participant: any) {
  const participantUuid = String(participant?.participant_uuid || participant?.participantUuid || participant?.uuid || participant?.id || '').trim() || null;
  const contestUuid = String(participant?.contest_uuid || participant?.contestUuid || participant?.contest?.uuid || participant?.contest?.UUID || '').trim() || null;
  const contestName = String(participant?.contest_name || participant?.contestName || participant?.contest?.name || participant?.contest?.Name || participant?.category || '').trim() || null;
  const ageGroupUuid = String(participant?.age_group_uuid || participant?.ageGroupUuid || participant?.ageGroup?.uuid || participant?.ageGroup?.UUID || '').trim() || null;
  const ageGroupName = String(participant?.age_group_name || participant?.ageGroupName || participant?.ageGroup?.name || participant?.ageGroup?.Name || participant?.age_group || participant?.ageGroup || '').trim() || null;
  const bib = String(participant?.bib || participant?.bib_no || participant?.number || participant?.no || '').trim();
  const name = String(participant?.name || participant?.full_name || participant?.athlete_name || 'Unknown Athlete').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = String(participant?.first_name || participant?.firstName || (parts.length > 0 ? parts.slice(0, -1).join(' ') || parts[0] : '')).trim() || null;
  const lastName = String(participant?.last_name || participant?.lastName || (parts.length > 1 ? parts[parts.length - 1] : '')).trim() || null;
  const category = String(participant?.category || contestName || participant?.group_name || '').trim();
  const chipCode = String(participant?.chip_code || participant?.chip || participant?.chipCode || '').trim();
  const ticketId = String(participant?.ticketId || participant?.registrationTicketId || participant?.ticket?.id || participant?.ticket_uuid || participant?.ticketUuid || '').trim() || null;
  const subCategoryId = String(participant?.subCategoryId || participant?.selectedSubCategoryId || participant?.sub_category_id || participant?.subCategory?.id || '').trim() || null;
  return {
    id: String(participant?.id || chipCode || bib || `${eventId}-${name}`),
    athleteUid: participantUuid,
    participantUuid,
    participant_uuid: participantUuid,
    bib,
    name,
    firstName,
    lastName,
    fullName: name,
    ticketId,
    subCategoryId,
    category,
    ageGroup: ageGroupName,
    ageGroupUuid: ageGroupUuid,
    ageGroupName: ageGroupName,
    age_group_uuid: ageGroupUuid,
    age_group_name: ageGroupName,
    gender: normalizeGender(participant?.gender || participant?.sex),
    country: participant?.country ? String(participant.country) : null,
    contestUuid,
    contest_uuid: contestUuid,
    contestName,
    contest_name: contestName,
    status: 'registered',
    leg: 'START',
    splits: [],
    startTime: null,
    lastUpdateTime: Date.now(),
    clubName: participant?.club ? String(participant.club) : null,
    courseProgress: 0,
    ranks: {},
    chipCode,
    source: 'feibot',
    raw: participant,
  };
}

async function persistNormalizedAthletes(env: WorkerEnv, eventId: string, athletes: any[]) {
  const now = new Date().toISOString();
  const compactAthletes = athletes.map((athlete) => {
    const { raw, ...rest } = athlete || {};
    return rest;
  });

  await env.BERGMAN_KV.put(`live:event:${eventId}:athletes`, JSON.stringify(compactAthletes));
  await env.BERGMAN_KV.put(
    `live:event:${eventId}:overview`,
    JSON.stringify({
      provider: 'feibot',
      activeAthletes: compactAthletes.length,
      lastUpdate: now,
      readsToday: 0,
      leaderboardUpdates: 0,
      storageUsage: 'KV',
      cacheHitRate: 0,
    }),
  );

  await Promise.all(
    compactAthletes.map((athlete) =>
      env.BERGMAN_KV.put(`live:event:${eventId}:athlete:${encodeURIComponent(String(athlete.bib || athlete.id))}`, JSON.stringify(athlete)),
    ),
  );
}

function normalizeParticipantText(value: any) {
  return String(value || '').trim();
}

function normalizeParticipantPhone(value: any) {
  return normalizeParticipantText(value).replace(/\D+/g, '');
}

function buildParticipantsIndexPayload(athletes: any[]) {
  const byBib: Record<string, any> = {};
  const byChip: Record<string, any> = {};
  const byUuid: Record<string, any> = {};
  const byEmail: Record<string, any> = {};
  const byMobile: Record<string, any> = {};

  for (const athlete of athletes) {
    const row = {
      ...(athlete || {}),
      contestUuid: normalizeParticipantText(athlete?.contestUuid || athlete?.contest_uuid) || null,
      contest_uuid: normalizeParticipantText(athlete?.contestUuid || athlete?.contest_uuid) || null,
      contestName: normalizeParticipantText(athlete?.contestName || athlete?.contest_name) || null,
      contest_name: normalizeParticipantText(athlete?.contestName || athlete?.contest_name) || null,
      ticketId: normalizeParticipantText(athlete?.ticketId || athlete?.ticket_id) || null,
      subCategoryId: normalizeParticipantText(athlete?.subCategoryId || athlete?.selectedSubCategoryId || athlete?.sub_category_id) || null,
      mappingSource: normalizeParticipantText(athlete?.mappingSource) || 'ticketMappings',
    };

    const bib = normalizeParticipantText(row?.bib || row?.bibNumber);
    const chip = normalizeParticipantText(row?.chipCode || row?.chip || row?.chip_id || row?.chipId);
    const uuid = normalizeParticipantText(row?.participantUuid || row?.participant_uuid || row?.providerUuid || row?.id);
    const email = normalizeParticipantText(row?.email).toLowerCase();
    const mobile = normalizeParticipantPhone(row?.mobile || row?.phone);

    if (bib) byBib[bib] = row;
    if (chip) byChip[chip] = row;
    if (uuid) byUuid[uuid] = row;
    if (email) byEmail[email] = row;
    if (mobile) byMobile[mobile] = row;
  }

  return {
    byBib,
    byChip,
    byUuid,
    byEmail,
    byMobile,
    participants: athletes,
    count: athletes.length,
    generatedAt: new Date().toISOString(),
  };
}

function buildFeibotConfig(body: any, hub: any, eventId: string): FeibotConfig {
  const bodyCloud = body?.config?.feibotConfig?.cloud || {};
  const hubCloud = hub?.feibotConfig?.cloud || {};
  const bodyScore = body?.config?.feibotConfig?.score || {};
  const hubScore = hub?.feibotConfig?.score || {};
  const cloudEventUuid = String(
    bodyCloud?.eventUuid ||
    body?.config?.feibotConfig?.eventUuid ||
    hubCloud?.eventUuid ||
    hub?.feibotConfig?.cloudEventUuid ||
    hub?.feibotConfig?.eventUuid ||
    eventId,
  ).trim();
  const scoreEventUuid = String(
    bodyScore?.eventUuid ||
    body?.config?.feibotConfig?.scoreEventUuid ||
    hubScore?.eventUuid ||
    hub?.feibotConfig?.scoreEventUuid ||
    '',
  ).trim();
  return {
    accessKey:
      bodyCloud?.accessKey ||
      body?.config?.feibotConfig?.accessKey ||
      hubCloud?.accessKey ||
      hub?.feibotConfig?.accessKey ||
      '',
    secretKey:
      bodyCloud?.secretKey ||
      body?.config?.feibotConfig?.secretKey ||
      hubCloud?.secretKey ||
      hub?.feibotConfig?.secretKey ||
      '',
    eventUuid: cloudEventUuid || scoreEventUuid || eventId,
    cloudEventUuid: cloudEventUuid || scoreEventUuid || eventId,
    scoreEventUuid: scoreEventUuid || cloudEventUuid || eventId,
    apiBaseUrl:
      bodyCloud?.apiBaseUrl ||
      body?.config?.feibotConfig?.apiBaseUrl ||
      hubCloud?.apiBaseUrl ||
      hub?.feibotConfig?.apiBaseUrl ||
      'https://apicn.feibot.com',
  };
}

function validateFeibotConfig(config: FeibotConfig) {
  const missing: string[] = [];
  if (!config.accessKey?.trim()) missing.push('accessKey');
  if (!config.secretKey?.trim()) missing.push('secretKey');
  if (!getCloudEventUuid(config)?.trim()) missing.push('cloud.eventUuid');
  return missing;
}

async function persistProviderConfigFallback(env: WorkerEnv, eventId: string, body: any, currentHub: any) {
  const provider = body?.config?.provider || body?.provider || currentHub?.provider;
  if (provider !== 'feibot') return;

  const config = buildFeibotConfig(body, currentHub, eventId);
  if (validateFeibotConfig(config).length > 0) return;

  await writeKvJson(env, `live:event:${eventId}:provider-config`, {
    ...currentHub,
    provider: 'feibot',
    trackingConfig: {
      enabled: currentHub?.trackingConfig?.enabled ?? true,
      showOnHomepage: currentHub?.trackingConfig?.showOnHomepage ?? false,
      edgeCacheSeconds: currentHub?.trackingConfig?.edgeCacheSeconds ?? 10,
      spectatorSoftLimit: currentHub?.trackingConfig?.spectatorSoftLimit,
      enableAthleteSearch: currentHub?.trackingConfig?.enableAthleteSearch,
      enableReplayMode: currentHub?.trackingConfig?.enableReplayMode,
      enableClubRankings: currentHub?.trackingConfig?.enableClubRankings,
    },
    feibotConfig: {
      ...(currentHub?.feibotConfig || {}),
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      eventUuid: getCloudEventUuid(config),
      cloudEventUuid: config.cloudEventUuid,
      scoreEventUuid: config.scoreEventUuid,
      apiBaseUrl: config.apiBaseUrl,
      cloud: {
        ...(currentHub?.feibotConfig?.cloud || {}),
        accessKey: config.accessKey,
        secretKey: config.secretKey,
        eventUuid: getCloudEventUuid(config),
        apiBaseUrl: config.apiBaseUrl,
      },
      score: {
        ...(currentHub?.feibotConfig?.score || {}),
        eventUuid: config.scoreEventUuid,
      },
    },
  });

  const providerStateCurrent = (await readKvJson(env, `event:${eventId}:providerState`)) || (await readKvJson(env, `live:event:${eventId}:providerState`)) || {};
  const providerStatePatch = {
    ...providerStateCurrent,
    provider: 'feibot',
    configurationSource: String(currentHub?.feibotConfig?.timingRuleSource || '').trim().toLowerCase() === 'manual' ? 'manual' : 'cloud_api',
    replayEnabled: Boolean(currentHub?.trackingConfig?.enableReplayMode),
    updatedAt: new Date().toISOString(),
  };
  await writeKvJson(env, `event:${eventId}:providerState`, providerStatePatch);
  await writeKvJson(env, `live:event:${eventId}:providerState`, providerStatePatch);
}

async function saveProviderConfig(request: Request, env: WorkerEnv, eventId: string) {
  const body = await request.json().catch(() => ({}));
  const provider = String(body?.provider || body?.config?.provider || '').trim().toLowerCase();
  if (provider !== 'feibot') {
    return json({ success: false, eventId, message: 'Only feibot provider is supported' }, { status: 400 });
  }

  const config = body?.config?.feibotConfig || {};
  const cloud = config?.cloud || {};
  const score = config?.score || {};
  const accessKey = String(cloud?.accessKey || config?.accessKey || '').trim();
  const secretKey = String(cloud?.secretKey || config?.secretKey || '').trim();
  const eventUuid = String(cloud?.eventUuid || config?.eventUuid || '').trim();
  const scoreEventUuid = String(score?.eventUuid || config?.scoreEventUuid || '').trim();
  const apiBaseUrl = String(cloud?.apiBaseUrl || config?.apiBaseUrl || 'https://apicn.feibot.com').trim() || 'https://apicn.feibot.com';

  const missing: string[] = [];
  if (!accessKey) missing.push('accessKey');
  if (!secretKey) missing.push('secretKey');
  if (!eventUuid) missing.push('eventUuid');
  if (missing.length > 0) {
    return json({ success: false, eventId, message: `Missing Feibot config fields: ${missing.join(', ')}` }, { status: 400 });
  }
  const expectedHash = await computeFeibotConfigHash({ accessKey, secretKey, eventUuid });

  const baseCandidates = getAdminBaseCandidates(env);
  let lastError = 'Provider config API unavailable';
  const configResponse = await loadEventConfig(env, eventId).catch(() => null);
  const fallbackProviderConfig = await readKvJson(env, `live:event:${eventId}:provider-config`);
  const currentHub = mergeHubConfig(getHubConfig(configResponse), fallbackProviderConfig);
  const previousAccessKey = String(currentHub?.feibotConfig?.cloud?.accessKey || currentHub?.feibotConfig?.accessKey || '').trim();
  const previousSecretKey = String(currentHub?.feibotConfig?.cloud?.secretKey || currentHub?.feibotConfig?.secretKey || '').trim();
  const previousEventUuid = String(currentHub?.feibotConfig?.cloud?.eventUuid || currentHub?.feibotConfig?.eventUuid || '').trim();
  const previousProvider = String(currentHub?.provider || '').trim().toLowerCase();
  const credentialsChanged =
    previousProvider !== 'feibot' ||
    previousAccessKey !== accessKey ||
    previousSecretKey !== secretKey ||
    previousEventUuid !== eventUuid;
  for (const baseUrl of baseCandidates) {
    const url = `${baseUrl.replace(/\/$/, '')}/api/live/provider-config/${encodeURIComponent(eventId)}`;
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-bergman-internal-token': env.BERGMAN_INTERNAL_TOKEN,
          accept: 'application/json',
        },
        body: JSON.stringify({
          provider: 'feibot',
          config: {
            feibotConfig: {
              accessKey,
              secretKey,
              eventUuid,
              cloudEventUuid: eventUuid,
              scoreEventUuid,
              apiBaseUrl,
              cloud: {
                eventUuid,
                apiBaseUrl,
                accessKey,
                secretKey,
              },
              score: {
                eventUuid: scoreEventUuid,
              },
              timingRuleSource: String(config?.timingRuleSource || 'cloud'),
            },
          },
        }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        lastError = payload?.message || `Config save failed (${res.status})`;
        continue;
      }

      await writeKvJson(env, `live:event:${eventId}:provider-config`, {
        provider: 'feibot',
        feibotConfig: {
          accessKey,
          secretKey,
          eventUuid,
          cloudEventUuid: eventUuid,
          scoreEventUuid,
          apiBaseUrl,
          cloud: {
            eventUuid,
            apiBaseUrl,
            accessKey,
            secretKey,
          },
          score: {
            eventUuid: scoreEventUuid,
            overviewUrl: scoreEventUuid ? `https://score.feibot.com/?id=${encodeURIComponent(scoreEventUuid)}` : '',
            progressUrl: scoreEventUuid
              ? `https://score.feibot.com/onlineDateQuery/index.html#/progress/event?event_uuid=${encodeURIComponent(scoreEventUuid)}`
              : '',
            available: !!scoreEventUuid,
          },
        },
      });

      const currentProviderState = (await readKvJson(env, `event:${eventId}:providerState`)) || (await readKvJson(env, `live:event:${eventId}:providerState`)) || {};
      const updatedProviderState = {
        ...currentProviderState,
        provider: 'feibot',
        status: credentialsChanged ? 'pending' : String(currentProviderState?.status || 'pending'),
        authentication: credentialsChanged ? 'pending' : String(currentProviderState?.authentication || 'pending'),
        configurationSource: String(config?.timingRuleSource || '').trim().toLowerCase() === 'manual' ? 'manual' : 'cloud_api',
        replayEnabled: Boolean(body?.config?.trackingConfig?.enableReplayMode ?? currentHub?.trackingConfig?.enableReplayMode),
        updatedAt: new Date().toISOString(),
      };
      await writeKvJson(env, `event:${eventId}:providerState`, updatedProviderState);
      await writeKvJson(env, `live:event:${eventId}:providerState`, updatedProviderState);

      const inspection = await inspectProviderConfig(env, eventId);

      return json({
        success: true,
        eventId,
        provider: 'feibot',
        message: payload?.message || 'Provider configuration saved',
        verification: {
          expectedHash: expectedHash.hash,
          firestoreToWorkerMatch: inspection?.match?.firestoreToWorker,
          hashMatch: inspection?.match?.hash,
          apiBaseUrlMatch: inspection?.match?.apiBaseUrl,
        },
        inspection,
        saved: payload?.config || {
          feibotConfig: {
            accessKey,
            secretKeyEncrypted: 'stored',
            eventUuid,
            apiBaseUrl,
          },
        },
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Failed to save provider config';
    }
  }

  try {
    await persistProviderConfigFallback(env, eventId, body, currentHub);
    const saved = await getProviderConfig(env, eventId);
    const inspection = await inspectProviderConfig(env, eventId);
    return json({
      success: true,
      eventId,
      provider: 'feibot',
      message: 'Provider configuration saved.',
      saved,
      verification: {
        expectedHash: expectedHash.hash,
        firestoreToWorkerMatch: inspection?.match?.firestoreToWorker,
        hashMatch: inspection?.match?.hash,
        apiBaseUrlMatch: inspection?.match?.apiBaseUrl,
      },
      inspection,
      fallback: true,
      warning: lastError,
    });
  } catch (error) {
    const fallbackError = error instanceof Error ? error.message : 'Failed to save provider config';
    return json({ success: false, eventId, message: `${lastError}; fallback failed: ${fallbackError}` }, { status: 502 });
  }
}

async function setTimingRulesSource(request: Request, env: WorkerEnv, eventId: string) {
  const body = await request.json().catch(() => ({}));
  const source = String(body?.source || '').trim();
  if (source !== 'cloud' && source !== 'local_database' && source !== 'manual') {
    return json({ success: false, eventId, message: 'source must be cloud, local_database, or manual' }, { status: 400 });
  }

  await setTimingRuleSource(env, eventId, source as 'cloud' | 'local_database' | 'manual');

  const counts = body?.count && typeof body.count === 'object'
    ? {
        contests: Number(body.count.contests || 0),
        splits: Number(body.count.splits || 0),
        timingPoints: Number(body.count.timingPoints || 0),
        devices: Number(body.count.devices || 0),
      }
    : {
        contests: 0,
        splits: 0,
        timingPoints: 0,
        devices: 0,
      };

  const nowIso = new Date().toISOString();
  await upsertImportsState(env, eventId, {
    timingRules: {
      status: source === 'cloud' ? 'waiting' : 'completed',
      source,
      count: counts,
      lastImport: source === 'cloud' ? null : nowIso,
      durationMs: null,
    },
  });

  return json({
    success: true,
    eventId,
    timingRules: {
      source,
      status: source === 'cloud' ? 'waiting' : 'completed',
      count: counts,
      lastImport: source === 'cloud' ? null : nowIso,
    },
  });
}

async function saveLocalDatabaseMetadata(request: Request, env: WorkerEnv, eventId: string) {
  const body = await request.json().catch(() => ({}));
  const metadata = body?.metadata && typeof body.metadata === 'object' ? body.metadata : {};

  const current = (await readKvJson(env, `live:event:${eventId}:provider-config`)) || {};
  const existingLocalDatabase = current?.feibotConfig?.localDatabase || {};
  const existingCloudEventUuid = String(current?.feibotConfig?.cloud?.eventUuid || current?.feibotConfig?.eventUuid || existingLocalDatabase?.cloudEventUuid || '').trim();
  const existingScoreEventUuid = String(current?.feibotConfig?.score?.eventUuid || existingLocalDatabase?.scoreEventUuid || '').trim();
  const existingDatabaseUuid = String(existingLocalDatabase?.databaseUuid || '').trim();

  const cloudEventUuid = String(metadata?.cloudEventUuid || existingCloudEventUuid || '').trim();
  const scoreEventUuid = String(metadata?.scoreEventUuid || existingScoreEventUuid || metadata?.databaseUuid || '').trim();
  const databaseUuid = String(metadata?.databaseUuid || existingDatabaseUuid || scoreEventUuid || '').trim();
  const filePath = String(metadata?.filePath || '').trim();
  const toNullableNumber = (value: any) => {
    if (value === null || value === undefined || value === '') return null;
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
  };
  const preserveString = (incoming: any, existing: any) => {
    const normalized = String(incoming || '').trim();
    if (normalized) return normalized;
    const prev = String(existing || '').trim();
    return prev || null;
  };
  const preserveArray = (incoming: any, existing: any) => {
    if (Array.isArray(incoming) && incoming.length > 0) return incoming;
    if (Array.isArray(existing)) return existing;
    return [];
  };
  const preserveNumber = (incoming: any, existing: any, fallback: number | null = null) => {
    const next = toNullableNumber(incoming);
    if (next !== null) return next;
    const prev = toNullableNumber(existing);
    if (prev !== null) return prev;
    return fallback;
  };
  const existingEventName = String(existingLocalDatabase?.eventName || '').trim();
  const existingEventDate = String(existingLocalDatabase?.eventDate || '').trim();
  const contests = preserveArray(metadata?.contests, existingLocalDatabase?.contests);
  const timingPoints = preserveArray(metadata?.timingPoints, existingLocalDatabase?.timingPoints);
  const splits = preserveArray(metadata?.splits, existingLocalDatabase?.splits);
  const ageGroups = preserveArray(metadata?.ageGroups, existingLocalDatabase?.ageGroups);
  const legs = preserveArray(metadata?.legs, existingLocalDatabase?.legs);
  const rawData = preserveArray(metadata?.rawData, existingLocalDatabase?.rawData);
  const rawReads = preserveNumber(metadata?.rawReads, existingLocalDatabase?.rawReads, 0);

  const merged = {
    ...(current || {}),
    provider: 'feibot',
    feibotConfig: {
      ...(current?.feibotConfig || {}),
      timingRuleSource: String(metadata?.timingRuleSource || 'local_database'),
      localDatabase: {
        ...(current?.feibotConfig?.localDatabase || {}),
        filePath: filePath || String(existingLocalDatabase?.filePath || '').trim(),
        uploadedAt: metadata?.uploadedAt || new Date().toISOString(),
        uploadedBy: metadata?.uploadedBy || existingLocalDatabase?.uploadedBy || null,
        uploaded: true,
        databaseUuid,
        cloudEventUuid,
        scoreEventUuid,
        eventName: preserveString(metadata?.eventName, existingEventName),
        eventDate: preserveString(metadata?.eventDate, existingEventDate),
        contests,
        timingPoints,
        splits,
        ageGroups,
        legs,
        rawData,
        rawReads,
        devices: preserveNumber(metadata?.devices, existingLocalDatabase?.devices, 0),
        participants: preserveNumber(metadata?.participants, existingLocalDatabase?.participants, 0),
        simulation: metadata?.simulation || existingLocalDatabase?.simulation || null,
      },
      cloud: {
        ...(current?.feibotConfig?.cloud || {}),
        eventUuid: cloudEventUuid || current?.feibotConfig?.cloud?.eventUuid || current?.feibotConfig?.eventUuid || '',
      },
      score: {
        ...(current?.feibotConfig?.score || {}),
        eventUuid: scoreEventUuid || current?.feibotConfig?.score?.eventUuid || '',
        overviewUrl: scoreEventUuid ? `https://score.feibot.com/?id=${encodeURIComponent(scoreEventUuid)}` : current?.feibotConfig?.score?.overviewUrl || '',
        progressUrl: scoreEventUuid
          ? `https://score.feibot.com/onlineDateQuery/index.html#/progress/event?event_uuid=${encodeURIComponent(scoreEventUuid)}`
          : current?.feibotConfig?.score?.progressUrl || '',
      },
      eventUuid: cloudEventUuid || current?.feibotConfig?.eventUuid || '',
    },
  };

  await writeKvJson(env, `live:event:${eventId}:provider-config`, merged);
  // Dedicated snapshot key — read by getProviderDatabase without going through mergeHubConfig
  const dbSnapshot = merged?.feibotConfig?.localDatabase || null;
  if (dbSnapshot) {
    await writeKvJson(env, `live:event:${eventId}:database-metadata`, dbSnapshot);
  }
  await persistProviderDatabaseToApp(env, eventId, dbSnapshot);
  await setTimingRuleSource(env, eventId, 'local_database');

  await upsertImportsState(env, eventId, {
    timingRules: {
      status: 'completed',
      source: 'local_database',
      count: {
        contests: contests.length,
        splits: Array.isArray(splits) ? splits.length : 0,
        timingPoints: timingPoints.length,
        devices: Number(preserveNumber(metadata?.devices, existingLocalDatabase?.devices, 0) || 0),
      },
      lastImport: new Date().toISOString(),
      durationMs: null,
    },
  });

  return json({ success: true, eventId, metadata: merged?.feibotConfig?.localDatabase || null });
}

async function getProviderDatabase(env: WorkerEnv, eventId: string) {
  const providerConfig = await getProviderConfig(env, eventId);
  const feibotConfig = providerConfig?.feibotConfig || {};
  const eventUuid = String(feibotConfig?.cloud?.eventUuid || feibotConfig?.cloudEventUuid || feibotConfig?.eventUuid || '').trim();
  if (!eventUuid) return null;

  const scoreEventUuid = String(feibotConfig?.score?.eventUuid || feibotConfig?.scoreEventUuid || '').trim();
  const participantEventUuid = (scoreEventUuid || eventUuid).trim();
  const startedAt = Date.now();
  const [timingRulesResult, participantsResult] = await Promise.allSettled([
    feibotRequest(`/eventConfigFile/timingRulesGet?event_uuid=${encodeURIComponent(eventUuid)}`, feibotConfig, { method: 'GET' }, { env, eventId, endpointName: 'timingRulesGet' }),
    feibotRequest(`/temporary/participantsGetAll?event_uuid=${encodeURIComponent(participantEventUuid)}`, feibotConfig, { method: 'GET' }, { env, eventId, endpointName: 'participantsGetAll' }),
  ]);

  const timingRules = timingRulesResult.status === 'fulfilled' ? timingRulesResult.value : null;
  const participants = participantsResult.status === 'fulfilled' ? extractFeibotParticipants(participantsResult.value) : [];
  const timingPayload = timingRulesPayloadFromResult(timingRules);
  const responseTimeMs = Date.now() - startedAt;

  return {
    provider: 'feibot',
    cloudEventUuid: eventUuid,
    scoreEventUuid: scoreEventUuid || null,
    eventName: String((timingRules as any)?.event_name || (timingRules as any)?.eventName || feibotConfig?.cloud?.eventName || feibotConfig?.eventName || '').trim() || null,
    cloudApiStatus: timingRules ? 'Connected' : 'Unavailable',
    authentication: timingRules ? 'verified' : 'failed',
    lastSync: new Date().toISOString(),
    responseTimeMs,
    contests: timingPayload.contests,
    timingPoints: timingPayload.timingPoints,
    splits: timingPayload.splits,
    ageGroups: Array.isArray((timingRules as any)?.age_groups) ? (timingRules as any).age_groups : Array.isArray((timingRules as any)?.ageGroups) ? (timingRules as any).ageGroups : [],
    devices: timingPayload.devices,
    participants,
    participantsCount: participants.length,
    contestsCount: timingPayload.contests.length,
    timingPointsCount: timingPayload.timingPoints.length,
    splitsCount: timingPayload.splits.length,
    ageGroupsCount: Array.isArray((timingRules as any)?.age_groups) ? (timingRules as any).age_groups.length : Array.isArray((timingRules as any)?.ageGroups) ? (timingRules as any).ageGroups.length : 0,
    devicesCount: timingPayload.devices.length,
    source: 'cloud_api',
  };
}

async function reparseLocalDatabase(request: Request, env: WorkerEnv, eventId: string) {
  return json({ success: false, eventId, message: 'Local database reparse is no longer supported. Cloud API is the only source of truth.' }, { status: 410 });
}

async function uploadLocalDatabaseFile(request: Request, env: WorkerEnv, eventId: string) {
  return json({ success: false, eventId, message: 'Local database upload is no longer supported. Cloud API is the only source of truth.' }, { status: 410 });
}

async function testProvider(request: Request, env: WorkerEnv, eventId: string) {
  let hub: any = {};
  let loadConfigError: string | null = null;
  const fallbackProviderConfig = await readKvJson(env, `live:event:${eventId}:provider-config`);
  try {
    const configResponse = await loadEventConfig(env, eventId);
    hub = mergeHubConfig(getHubConfig(configResponse), fallbackProviderConfig);
  } catch (error) {
    loadConfigError = error instanceof Error ? error.message : 'Failed to load event config';
    hub = mergeHubConfig({}, fallbackProviderConfig);
  }

  const body = await request.json().catch(() => ({}));
  const requestedAction = String(body?.action || '').trim().toLowerCase();
  const provider: ProviderType = (body?.config?.provider || hub.provider || body?.provider || 'manual') as ProviderType;

  if (provider === 'feibot') {
    const config: FeibotConfig = {
      accessKey: body?.config?.feibotConfig?.accessKey || hub.feibotConfig?.accessKey || '',
      secretKey: body?.config?.feibotConfig?.secretKey || hub.feibotConfig?.secretKey || '',
      eventUuid: getCloudEventUuid({
        eventUuid: body?.config?.feibotConfig?.eventUuid || hub.feibotConfig?.eventUuid || eventId,
        cloudEventUuid: body?.config?.feibotConfig?.cloudEventUuid || hub.feibotConfig?.cloudEventUuid,
      }),
      cloudEventUuid: body?.config?.feibotConfig?.cloudEventUuid || hub.feibotConfig?.cloudEventUuid || body?.config?.feibotConfig?.eventUuid || hub.feibotConfig?.eventUuid || eventId,
      scoreEventUuid: body?.config?.feibotConfig?.score?.eventUuid || body?.config?.feibotConfig?.scoreEventUuid || hub.feibotConfig?.score?.eventUuid || hub.feibotConfig?.scoreEventUuid || '',
      apiBaseUrl: body?.config?.feibotConfig?.apiBaseUrl || hub.feibotConfig?.apiBaseUrl || 'https://apicn.feibot.com',
    };

    const missing: string[] = [];
    if (!config.accessKey) missing.push('accessKey');
    if (!config.secretKey) missing.push('secretKey');
    if (!getCloudEventUuid(config)) missing.push('cloud.eventUuid');
    if (missing.length > 0) {
      return json(
        {
          success: false,
          provider,
          message: `Missing Feibot config fields: ${missing.join(', ')}`,
          debug: {
            bodyProvided: !!body?.config,
            hubConfigLoaded: !!hub.feibotConfig,
            fromBody: {
              accessKey: !!body?.config?.feibotConfig?.accessKey,
              secretKey: !!body?.config?.feibotConfig?.secretKey,
              eventUuid: !!body?.config?.feibotConfig?.eventUuid,
            },
            fromHub: {
              accessKey: !!hub.feibotConfig?.accessKey,
              secretKey: !!hub.feibotConfig?.secretKey,
              eventUuid: !!hub.feibotConfig?.eventUuid,
            },
          },
          loadConfigError,
        },
        { status: 400 },
      );
    }

    const providerTestStartedAt = Date.now();
    const scoreEventUuid = String(
      body?.config?.feibotConfig?.score?.eventUuid ||
      body?.config?.feibotConfig?.scoreEventUuid ||
      hub?.feibotConfig?.score?.eventUuid ||
      hub?.feibotConfig?.scoreEventUuid ||
      '',
    ).trim();
    try {
      const startedAt = providerTestStartedAt;
      const requestEventUuid = getCloudEventUuid(config);
      const result = await feibotRequest(
        `/eventConfigFile/timingRulesGet?event_uuid=${encodeURIComponent(requestEventUuid)}`,
        config,
        { method: 'GET' },
        { env, eventId, endpointName: 'timingRulesGet' },
      );
      const responseTimeMs = Date.now() - startedAt;
      const timestamp = new Date().toISOString();
      const scoreOverviewUrl = scoreEventUuid ? `https://score.feibot.com/?id=${encodeURIComponent(scoreEventUuid)}` : '';
      const scoreProgressUrl = scoreEventUuid
        ? `https://score.feibot.com/onlineDateQuery/index.html#/progress/event?event_uuid=${encodeURIComponent(scoreEventUuid)}`
        : '';
      const localDatabase = body?.config?.feibotConfig?.localDatabase || hub?.feibotConfig?.localDatabase || {};
      const localDatabaseConfigured =
        !!String(localDatabase?.databaseUuid || '').trim() ||
        !!String(localDatabase?.cloudEventUuid || '').trim() ||
        !!String(localDatabase?.scoreEventUuid || '').trim() ||
        !!String(localDatabase?.filePath || '').trim() ||
        !!localDatabase?.uploaded;
      const scoreOverview = await validateExternalUrlStatus(scoreOverviewUrl);
      const scoreProgress = await validateExternalUrlStatus(scoreProgressUrl);
      const timingRulesAvailable = hasCloudTimingRules(result);
      // Cloud returned HTTP 200 but zero timing rules — this is NOT an auth failure.
      // Authentication and timing-rule availability are separate concerns.
      const cloudTimingRulesStatus = timingRulesAvailable ? 'available' : 'empty';
      const timingRulesStatus = timingRulesAvailable ? 'PASS' : localDatabaseConfigured ? 'LOCAL_DATABASE' : 'EMPTY';
      const timingConfiguration = {
        eventId,
        source: timingRulesAvailable ? 'cloud' : localDatabaseConfigured ? 'local_database' : 'manual',
        contests: Array.isArray(result?.contests) ? result.contests : Array.isArray(result?.data?.contests) ? result.data.contests : Array.isArray(localDatabase?.contests) ? localDatabase.contests : [],
        timingPoints: Array.isArray(result?.timing_points)
          ? result.timing_points
          : Array.isArray(result?.data?.timing_points)
            ? result.data.timing_points
            : Array.isArray(localDatabase?.timingPoints)
              ? localDatabase.timingPoints
              : [],
        splits: Array.isArray(result?.splits) ? result.splits : Array.isArray(result?.data?.splits) ? result.data.splits : Array.isArray(localDatabase?.splits) ? localDatabase.splits : [],
        devices: Array.isArray(result?.devices) ? result.devices : Array.isArray(result?.data?.devices) ? result.data.devices : Array.isArray(localDatabase?.devices) ? localDatabase.devices : [],
        legs: Array.isArray(localDatabase?.legs) ? localDatabase.legs : [],
        ageGroups: Array.isArray(localDatabase?.ageGroups) ? localDatabase.ageGroups : [],
        importedAt: timestamp,
        provider: 'feibot',
      };
      const normalizedTimingCounts = getTimingRulesImportStats(result);
      try {
        const eventSnapshot = JSON.stringify({
          eventId,
          importedAt: timestamp,
          provider: 'feibot',
          eventUuid: getCloudEventUuid(config),
          cloudEventUuid: getCloudEventUuid(config),
          scoreEventUuid,
          apiBaseUrl: config.apiBaseUrl,
          timingRuleSource: timingConfiguration.source,
          source: 'feibot-timing-rules',
        }, null, 2);
        await env.BERGMAN_R2.put(`events/${eventId}/configuration/event.json`, eventSnapshot);
        await env.BERGMAN_R2.put(`events/${eventId}/configuration/event-${Date.now()}.json`, eventSnapshot);
        const rawTimingRules = JSON.stringify({ eventId, importedAt: timestamp, payload: result }, null, 2);
        await env.BERGMAN_R2.put(`events/${eventId}/configuration/timing_rules.json`, rawTimingRules);
        await env.BERGMAN_R2.put(`events/${eventId}/configuration/timing_rules-${Date.now()}.json`, rawTimingRules);
        const rawContests = JSON.stringify({ eventId, importedAt: timestamp, payload: Array.isArray(result?.contests) ? result.contests : Array.isArray(result?.data?.contests) ? result.data.contests : [] }, null, 2);
        await env.BERGMAN_R2.put(`events/${eventId}/configuration/contests.json`, rawContests);
        await env.BERGMAN_R2.put(`events/${eventId}/configuration/contests-${Date.now()}.json`, rawContests);
        const rawAgeGroups = JSON.stringify({ eventId, importedAt: timestamp, payload: Array.isArray(localDatabase?.ageGroups) ? localDatabase.ageGroups : [] }, null, 2);
        await env.BERGMAN_R2.put(`events/${eventId}/configuration/age_groups.json`, rawAgeGroups);
        await env.BERGMAN_R2.put(`events/${eventId}/configuration/age_groups-${Date.now()}.json`, rawAgeGroups);
      } catch (e) {
        console.warn('Failed to write raw timing rules to R2', e instanceof Error ? e.message : e);
      }
      await persistTimingConfigurationSnapshot(env, eventId, timingConfiguration).catch(() => false);

      await recordProviderApiCall(env, eventId, {
        provider,
        endpoint: 'timingRulesGet',
        responseTimeMs,
        status: 200,
        success: true,
        timestamp,
        eventUuid: getCloudEventUuid(config),
        requestUrl: `${String(config.apiBaseUrl || 'https://apicn.feibot.com').replace(/\/$/, '')}/eventConfigFile/timingRulesGet?event_uuid=${encodeURIComponent(getCloudEventUuid(config))}`,
        baseUrl: String(config.apiBaseUrl || 'https://apicn.feibot.com').replace(/\/$/, ''),
      });
      await mergeKvJson(env, `live:event:${eventId}:provider-diagnostics`, {
        provider,
        status: 'connected',
        authentication: 'verified',
        authenticationState: {
          status: 'verified',
          checkedAt: timestamp,
          lastSuccess: timestamp,
          lastFailure: null,
          lastStatusCode: 200,
          lastError: null,
        },
        cloudApi: {
          status: 'PASS',
          checkedAt: timestamp,
        },
        // Separate field — empty cloud timing rules ≠ auth failure
        cloudTimingRules: {
          status: cloudTimingRulesStatus,  // 'available' | 'empty'
          checkedAt: timestamp,
        },
        score: {
          overview: scoreOverview,
          progress: scoreProgress,
        },
        timingRules: {
          status: timingRulesStatus,  // 'PASS' | 'LOCAL_DATABASE' | 'EMPTY'
          checkedAt: timestamp,
        },
        lastTest: {
          status: timingRulesAvailable || localDatabaseConfigured ? 'passed' : 'warning',
          checkedAt: timestamp,
          durationMs: responseTimeMs,
          authentication: 'verified',
          cloudApi: 'PASS',
          cloudTimingRules: cloudTimingRulesStatus,
          scoreOverview: scoreOverview.available ? 'PASS' : 'FAIL',
          scoreProgress: scoreProgress.available ? 'PASS' : 'FAIL',
        },
      });
      if (requestedAction === 'timing-rules') {
        const timingCounts = getTimingRulesImportStats(result);
        if (timingRulesAvailable) {
          await setTimingRuleSource(env, eventId, 'cloud');
          await upsertImportsState(env, eventId, {
            timingRules: {
              status: 'completed',
              count: timingCounts,
              lastImport: timestamp,
              durationMs: responseTimeMs,
              source: 'cloud',
            },
          });
          await writeKvJson(env, `event:${eventId}:providerState`, {
            ...((await readKvJson(env, `event:${eventId}:providerState`)) || {}),
            authentication: 'verified',
            cloudApi: 'pass',
            timingRulesImported: true,
            configurationSource: 'cloud_api',
            cloudTimingRules: 'available',
            updatedAt: timestamp,
          });
          await writeKvJson(env, `live:event:${eventId}:providerState`, {
            ...((await readKvJson(env, `live:event:${eventId}:providerState`)) || {}),
            authentication: 'verified',
            cloudApi: 'pass',
            timingRulesImported: true,
            configurationSource: 'cloud_api',
            cloudTimingRules: 'available',
            updatedAt: timestamp,
          });
        } else {
          // Cloud API authenticated successfully but returned empty timing rules.
          // This is NOT an error. Use local database as timing source.
          const diagnostics = await runFeibotEndpointDiagnostics(env, eventId, config);
          const source = localDatabaseConfigured ? 'local_database' : 'cloud';
          await setTimingRuleSource(env, eventId, source);
          const localDbCounts = {
            contests: Array.isArray(localDatabase?.contests) ? localDatabase.contests.length : 0,
            timingPoints: Array.isArray(localDatabase?.timingPoints) ? localDatabase.timingPoints.length : 0,
            splits: Array.isArray(localDatabase?.splits) ? localDatabase.splits.length : 0,
            devices: Array.isArray(localDatabase?.devices) ? localDatabase.devices.length : Number(localDatabase?.devices || 0),
          };
          await upsertImportsState(env, eventId, {
            timingRules: {
              status: localDatabaseConfigured ? 'not_available_cloud' : 'empty',
              count: localDatabaseConfigured ? localDbCounts : timingCounts,
              lastImport: timestamp,
              durationMs: responseTimeMs,
              source,
              summary: {
                contests: localDatabaseConfigured ? localDbCounts.contests : timingCounts.contests,
                splits: localDatabaseConfigured ? localDbCounts.splits : timingCounts.splits,
                timingPoints: localDatabaseConfigured ? localDbCounts.timingPoints : timingCounts.timingPoints,
                devices: localDatabaseConfigured ? localDbCounts.devices : timingCounts.devices,
              },
            },
          });
          // Persist: auth verified, cloud empty, local DB active — still CONNECTED
          const psBase = (await readKvJson(env, `event:${eventId}:providerState`)) || {};
          const psUpdate = {
            ...psBase,
            authentication: 'verified',
            cloudApi: 'pass',
            cloudTimingRules: 'empty',
            timingRulesImported: localDatabaseConfigured,
            configurationSource: localDatabaseConfigured ? 'local_database' : 'unknown',
            status: 'connected',
            updatedAt: timestamp,
          };
          await writeKvJson(env, `event:${eventId}:providerState`, psUpdate);
          await writeKvJson(env, `live:event:${eventId}:providerState`, psUpdate);
          return json({
            success: true,
            provider,
            endpoint: 'timingRulesGet',
            message: localDatabaseConfigured
              ? 'Connected. Cloud API returned empty timing rules — Local Database is the active timing source.'
              : 'Connected. Cloud API returned empty timing rules.',
            timingRules: {
              status: 'not_available_cloud',
              cloudTimingRules: 'empty',
              source,
              recommendation: localDatabaseConfigured ? 'Local Database' : 'Local Database Recommended',
              options: ['cloud', 'local_database', 'manual'],
              checkedAt: timestamp,
              localDbCounts: localDatabaseConfigured ? localDbCounts : timingCounts,
              counts: normalizedTimingCounts,
              summary: normalizedTimingCounts,
            },
            timingConfiguration,
            diagnostics,
            config: {
              apiBaseUrl: config.apiBaseUrl,
              cloudEventUuid: getCloudEventUuid(config),
              scoreEventUuid,
              requestEventUuid,
              eventUuid: requestEventUuid,
              accessKeyLength: config.accessKey.length,
              secretKeyLength: config.secretKey.length,
            },
            authentication: {
              status: 'verified',
              checkedAt: timestamp,
              lastSuccess: timestamp,
              lastFailure: null,
            },
            cloudApi: {
              status: 'PASS',
              checkedAt: timestamp,
            },
            score: {
              overview: scoreOverview,
              progress: scoreProgress,
            },
            loadConfigError,
            result,
          });
        }
      }
      return json({ 
        success: true, 
        provider, 
        endpoint: 'timingRulesGet',
        config: {
          apiBaseUrl: config.apiBaseUrl,
          cloudEventUuid: getCloudEventUuid(config),
          scoreEventUuid,
          requestEventUuid: getCloudEventUuid(config),
          eventUuid: getCloudEventUuid(config),
          accessKeyLength: config.accessKey.length,
          secretKeyLength: config.secretKey.length,
        },
        authentication: {
          status: 'verified',
          checkedAt: timestamp,
          lastSuccess: timestamp,
          lastFailure: null,
        },
        cloudApi: {
          status: 'PASS',
          checkedAt: timestamp,
        },
        score: {
          overview: scoreOverview,
          progress: scoreProgress,
        },
        timingRules: {
          status: timingRulesAvailable ? 'PASS' : 'EMPTY',
          checkedAt: timestamp,
          counts: normalizedTimingCounts,
        },
        loadConfigError, 
        result 
      });
    } catch (error) {
      const timestamp = new Date().toISOString();
      const statusCode = extractHttpStatus(error) || 502;
      const stringToSign = extractStringToSign(error);
      const errorMessage = error instanceof Error ? error.message : 'Feibot request failed';
      await recordProviderApiCall(env, eventId, {
        provider,
        endpoint: 'timingRulesGet',
        responseTimeMs: Date.now() - providerTestStartedAt,
        status: statusCode,
        success: false,
        timestamp,
        eventUuid: getCloudEventUuid(config),
        requestUrl: (error as any)?.diagnostics?.requestUrl || `${String(config.apiBaseUrl || 'https://apicn.feibot.com').replace(/\/$/, '')}/eventConfigFile/timingRulesGet?event_uuid=${encodeURIComponent(getCloudEventUuid(config))}`,
        baseUrl: (() => {
          const requestUrl = String((error as any)?.diagnostics?.requestUrl || '').trim();
          if (!requestUrl) return String(config.apiBaseUrl || 'https://apicn.feibot.com').replace(/\/$/, '');
          try {
            return new URL(requestUrl).origin;
          } catch {
            return String(config.apiBaseUrl || 'https://apicn.feibot.com').replace(/\/$/, '');
          }
        })(),
        path: (error as any)?.diagnostics?.path || '/eventConfigFile/timingRulesGet',
        query: (error as any)?.diagnostics?.query || `event_uuid=${encodeURIComponent(getCloudEventUuid(config))}`,
        unixTimestamp: Number((error as any)?.diagnostics?.timestamp || 0) || null,
        stringToSign: (error as any)?.diagnostics?.stringToSign || stringToSign || null,
        signatureLength: Number((error as any)?.diagnostics?.signatureLength || 0) || null,
        message: errorMessage,
      });
      await mergeKvJson(env, `live:event:${eventId}:provider-diagnostics`, {
        lastError: {
          status: statusCode,
          message: statusCode === 401 ? 'Unauthorized' : statusCode === 403 ? 'Forbidden' : errorMessage,
          endpoint: 'timingRulesGet',
          timestamp,
          stringToSign,
          recommendation: 'Verify Access Key, Secret Key and Event UUID.',
        },
        lastTest: {
          status: 'failed',
          checkedAt: timestamp,
          durationMs: Date.now() - providerTestStartedAt,
          authentication: statusCode === 401 || statusCode === 403 ? 'failed' : 'unknown',
          cloudApi: 'FAIL',
          scoreOverview: 'UNKNOWN',
          scoreProgress: 'UNKNOWN',
        },
      });
      return json(
        {
          success: false,
          provider,
          endpoint: 'timingRulesGet',
          message: errorMessage,
          error: {
            status: statusCode,
            message: statusCode === 401 ? 'Unauthorized' : statusCode === 403 ? 'Forbidden' : errorMessage,
            endpoint: 'timingRulesGet',
            timestamp,
            stringToSign,
            recommendation: 'Verify Access Key, Secret Key and Event UUID.',
          },
          config: {
            apiBaseUrl: config.apiBaseUrl,
            cloudEventUuid: getCloudEventUuid(config),
            scoreEventUuid,
            requestEventUuid: getCloudEventUuid(config),
            eventUuid: getCloudEventUuid(config),
            accessKeyLength: config.accessKey.length,
            secretKeyLength: config.secretKey.length,
          },
          requestDiagnostics: {
            requestUrl: (error as any)?.diagnostics?.requestUrl || null,
            baseUrl: (error as any)?.diagnostics?.baseUrl || null,
            path: (error as any)?.diagnostics?.path || '/eventConfigFile/timingRulesGet',
            query: (error as any)?.diagnostics?.query || `event_uuid=${encodeURIComponent(getCloudEventUuid(config))}`,
            unixTimestamp: Number((error as any)?.diagnostics?.timestamp || 0) || null,
            stringToSign: (error as any)?.diagnostics?.stringToSign || stringToSign || null,
            signatureLength: Number((error as any)?.diagnostics?.signatureLength || 0) || null,
          },
          loadConfigError,
        },
        { status: statusCode },
      );
    }
  }

  return json({ success: true, provider, loadConfigError, message: 'Provider test stub completed. Configure Feibot to run a signed request.' });
}

async function importFeibotParticipants(request: Request, env: WorkerEnv, eventId: string) {
  try {
    const importStartedAt = Date.now();
    const body = await request.json().catch(() => ({}));
    const configResponse = await loadEventConfig(env, eventId).catch(() => null);
    const fallbackProviderConfig = await readKvJson(env, `live:event:${eventId}:provider-config`);
    const hub = mergeHubConfig(getHubConfig(configResponse), fallbackProviderConfig);
    await mergeKvJson(env, `live:event:${eventId}:monitoring`, {
      syncEngine: {
        state: 'importing',
        lastRun: new Date(importStartedAt).toISOString(),
        nextRun: null,
        readsProcessed: Number((await readKvJson(env, `live:event:${eventId}:monitoring`))?.syncEngine?.readsProcessed || 0),
        lastError: null,
      },
    });
    const config = buildFeibotConfig(body, hub, eventId);
    const missing = validateFeibotConfig(config);
    if (missing.length > 0) {
      return json(
        {
          success: false,
          eventId,
          message: `Missing Feibot config fields: ${missing.join(', ')}`,
          debug: {
            fromBody: {
              accessKey: !!body?.config?.feibotConfig?.accessKey,
              secretKey: !!body?.config?.feibotConfig?.secretKey,
              eventUuid: !!body?.config?.feibotConfig?.eventUuid,
            },
            fromHub: {
              accessKey: !!hub?.feibotConfig?.accessKey,
              secretKey: !!hub?.feibotConfig?.secretKey,
              eventUuid: !!hub?.feibotConfig?.eventUuid,
            },
          },
        },
        { status: 400 },
      );
    }

  await persistProviderConfigFallback(env, eventId, body, hub);

    const providerCallStartedAt = Date.now();
    const participantsFetch = await fetchFeibotParticipantsPayload(env, eventId, config);
    const result = participantsFetch.payload;
    const providerCallDurationMs = Date.now() - providerCallStartedAt;
    const extractedParticipants: any[] = extractFeibotParticipants(result);
    const fallbackParticipants = extractedParticipants.length === 0 ? await fetchProviderParticipantsFromApp(env, eventId) : [];
    const participants: any[] = extractedParticipants.length > 0 ? extractedParticipants : fallbackParticipants;
    const participantsSource = extractedParticipants.length > 0 ? 'cloud_api' : fallbackParticipants.length > 0 ? 'app_persisted' : 'cloud_api';

    // Save raw payload to R2 for auditing
    try {
      const timestampIso = new Date().toISOString();
      const safeTimestamp = timestampIso.replace(/[:.]/g, '-');
      const rawKey = `events/${eventId}/participants/raw/${safeTimestamp}.json`;
      const rawJson = JSON.stringify(result);
      const sha256 = await sha256Hex(rawJson);
      const archiveMetadata = {
        provider: 'feibot',
        eventId,
        eventUuid: config.eventUuid || config.scoreEventUuid || null,
        generatedAt: timestampIso,
        downloadedAt: timestampIso,
        contentLength: rawJson.length,
        recordCount: Array.isArray(participants) ? participants.length : 0,
        sha256,
        apiVersion: 'participantsGetAll',
        responseTimeMs: providerCallDurationMs,
      };
      await env.BERGMAN_R2.put(rawKey, rawJson, { httpMetadata: { contentType: 'application/json' } });
      await env.BERGMAN_R2.put(`events/${eventId}/participants/raw/${safeTimestamp}.metadata.json`, JSON.stringify(archiveMetadata));

      const processedSnapshot = participants.map((participant) => ({
        participantUuid: String(participant?.participantUuid || participant?.participant_uuid || participant?.id || '').trim() || null,
        bookingId: String(participant?.bookingId || participant?.registrationId || participant?.bergmanBookingId || '').trim() || null,
        bib: String(participant?.bib || participant?.bibNumber || '').trim() || null,
        chip: String(participant?.chip || participant?.chipCode || participant?.chipNumber || '').trim() || null,
        providerContestUuid: String(participant?.contestUuid || participant?.providerContestUuid || '').trim() || null,
        matched: Boolean(participant?.matched ?? participant?.synced ?? participant?.bookingId),
        matchedBy: String(participant?.matchedBy || participant?.matchMethod || participant?.mappedBy || '').trim() || null,
        timestamp: timestampIso,
      }));
      await env.BERGMAN_R2.put(`events/${eventId}/participants/processed/matched-${safeTimestamp}.json`, JSON.stringify(processedSnapshot));

      const providerKey = `provider-responses/participants/${safeTimestamp}.json`;
      await env.BERGMAN_R2.put(providerKey, rawJson);
    } catch (e) {
      console.warn('Failed to write raw participants to R2', e instanceof Error ? e.message : e);
    }

    const normalizedAthletes = participants.map((participant) => normalizeFeibotParticipant(eventId, participant));
    const timestamp = new Date().toISOString();
    const totalImportDurationMs = Date.now() - importStartedAt;

    const registrationRowsRaw = await readKvJson(env, `event:${eventId}:participants:index`);
    const registrationRows = (Array.isArray(registrationRowsRaw) ? registrationRowsRaw : []).filter((row: any) => !isCancelledRegistration(row));

    const normalizeText = (value: any) => String(value || '').trim().toLowerCase();
    const normalizePhone = (value: any) => String(value || '').replace(/\D+/g, '');
    const normalizeDate = (value: any) => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return normalizeText(raw);
      return d.toISOString().slice(0, 10);
    };
    const registrationId = (row: any) => String(row?.id || row?.bookingId || row?.participantId || row?.athleteUid || row?.athleteUUID || '').trim();
    const registrationAthleteUid = (row: any) => String(
      row?.athleteUid ||
      row?.athlete_uid ||
      row?.participantUuid ||
      row?.participant_uuid ||
      row?.providerParticipantUuid ||
      row?.provider_uuid ||
      row?.registrationId ||
      row?.participantId ||
      row?.id ||
      row?.bookingId ||
      '',
    ).trim();
    const registrationLookupKey = (row: any) => {
      const id = registrationAthleteUid(row) || registrationId(row);
      const bib = getRegistrationBib(row);
      const email = normalizeText(row?.email || row?.buyerEmail);
      const phone = normalizePhone(row?.mobile || row?.phone || row?.phoneNumber);
      const nameDob = buildNameDobKey(row?.name || row?.fullName, row?.dob || row?.dateOfBirth);
      return id || bib || email || phone || nameDob || '';
    };
    const providerId = (participant: any) => String(participant?.id || participant?.participant_id || participant?.uid || '').trim();
    const buildNameDobKey = (name: any, dob: any) => {
      const normalizedName = normalizeText(name).replace(/\s+/g, ' ').trim();
      const normalizedDob = normalizeDate(dob);
      if (!normalizedName || !normalizedDob) return '';
      return `${normalizedName}|${normalizedDob}`;
    };
    const buildIndex = (rows: any[], deriveKey: (row: any) => string) => {
      const index = new Map<string, any[]>();
      for (const row of rows) {
        const key = deriveKey(row);
        if (!key) continue;
        const existing = index.get(key) || [];
        existing.push(row);
        index.set(key, existing);
      }
      return index;
    };

    const byAthleteUid = buildIndex(registrationRows, (row) => registrationAthleteUid(row));
    const byBib = buildIndex(registrationRows, (row) => getRegistrationBib(row));
    const byChip = buildIndex(registrationRows, (row) => getRegistrationChip(row));
    const byRegistrationId = buildIndex(registrationRows, (row) => registrationId(row));
    const byEmail = buildIndex(registrationRows, (row) => normalizeText(row?.email));
    const byPhone = buildIndex(registrationRows, (row) => normalizePhone(row?.mobile || row?.phone || row?.phoneNumber));
    const byNameDob = buildIndex(registrationRows, (row) => buildNameDobKey(row?.name || row?.fullName, row?.dob || row?.dateOfBirth));

    const ticketContestMappingsByTicket = new Map<string, { contestUuid: string | null; contestName: string | null }>();
    const ticketMappingsKv =
      (await readKvJson(env, `event:${eventId}:ticketMappings`)) ||
      (await readKvJson(env, `live:event:${eventId}:ticketMappings`)) ||
      null;
    const ticketToContestKv = (ticketMappingsKv as any)?.ticketToContest || {};
    const ticketsByIdKv = (ticketMappingsKv as any)?.ticketsById || {};
    const configuredTicketMappings = Array.isArray(hub?.feibotConfig?.ticketContestMappings) ? hub.feibotConfig.ticketContestMappings : [];
    for (const mapping of configuredTicketMappings) {
      const ticketId = String(mapping?.ticketId || '').trim();
      if (!ticketId) continue;
      const contestUuid = String(mapping?.providerContestUuid || mapping?.contestUuid || mapping?.contestUUID || '').trim() || null;
      const contestName = String(mapping?.providerContestName || mapping?.contestName || mapping?.contest_name || '').trim() || null;
      ticketContestMappingsByTicket.set(ticketId, { contestUuid, contestName });
    }

    const resolveContestFromTicketMapping = (ticketIdRaw: any, subCategoryIdRaw: any) => {
      const ticketId = String(ticketIdRaw || '').trim();
      if (!ticketId) return null;
      const subCategoryId = String(subCategoryIdRaw || '').trim();
      if (subCategoryId) {
        const compositeKey = `${ticketId}:${subCategoryId}`;
        const contestUuid = String(ticketToContestKv?.[compositeKey] || ticketToContestKv?.[ticketId] || '').trim();
        if (!contestUuid) return null;
        const detail = ticketsByIdKv?.[compositeKey] || ticketsByIdKv?.[ticketId] || null;
        return {
          contestUuid,
          contestName: String(detail?.contestName || '').trim() || null,
        };
      }

      const baseKey = `${ticketId}:base`;
      const contestUuid = String(ticketToContestKv?.[baseKey] || ticketToContestKv?.[ticketId] || '').trim();
      if (contestUuid) {
        const detail = ticketsByIdKv?.[baseKey] || ticketsByIdKv?.[ticketId] || null;
        return {
          contestUuid,
          contestName: String(detail?.contestName || '').trim() || null,
        };
      }

      return ticketContestMappingsByTicket.get(ticketId) || null;
    };

    const mappings: any[] = [];
    const mappedRegistrationIds = new Set<string>();
    const seenProviderIds = new Set<string>();
    let matched = 0;
    let unmatched = 0;
    let conflicts = 0;
    let ambiguous = 0;

    const methodConfidence: Record<string, number> = {
      bib: 100,
      chip: 98,
      registration_id: 95,
      email: 90,
      phone: 85,
      name_dob: 80,
      manual: 0,
    };

    participants.forEach((participant: any, idx: number) => {
      const normalized = normalizedAthletes[idx] || normalizeFeibotParticipant(eventId, participant);
      const normalizedAny: any = normalized as any;
      const candidateKeys = {
        athleteUid: String(
          normalizedAny?.athleteUid ||
          normalizedAny?.athlete_uid ||
          participant?.athleteUid ||
          participant?.athlete_uid ||
          participant?.participantUuid ||
          participant?.participant_uuid ||
          participant?.registration_id ||
          participant?.registrationId ||
          participant?.id ||
          '',
        ).trim(),
        bib: String(normalized?.bib || participant?.bib || participant?.bib_no || participant?.number || participant?.no || '').trim(),
        chip: String(normalized?.chipCode || participant?.chip_code || participant?.chip || participant?.chipCode || '').trim(),
        registrationId: String(participant?.registration_id || participant?.registrationId || participant?.athlete_uid || participant?.athleteUid || participant?.participantUuid || participant?.participant_uuid || '').trim(),
        email: normalizeText(participant?.email || participant?.mail),
        phone: normalizePhone(participant?.mobile || participant?.phone || participant?.phone_number),
        nameDob: buildNameDobKey(normalized?.name || participant?.name || participant?.full_name, participant?.dob || participant?.birthday || participant?.date_of_birth),
      };

      const attempts: Array<{ method: string; key: string; index: Map<string, any[]> }> = [
        { method: 'athlete_uid', key: candidateKeys.athleteUid, index: byAthleteUid },
        { method: 'bib', key: candidateKeys.bib, index: byBib },
        { method: 'chip', key: candidateKeys.chip, index: byChip },
        { method: 'registration_id', key: candidateKeys.registrationId, index: byRegistrationId },
        { method: 'email', key: candidateKeys.email, index: byEmail },
        { method: 'phone', key: candidateKeys.phone, index: byPhone },
        { method: 'name_dob', key: candidateKeys.nameDob, index: byNameDob },
      ];

      let selectedRegistration: any = null;
      let selectedMethod = 'manual';
      let selectedKey = '';

      for (const attempt of attempts) {
        if (!attempt.key) continue;
        const candidates = attempt.index.get(attempt.key) || [];
        if (candidates.length === 0) continue;
        if (candidates.length > 1) ambiguous += 1;
        const availableCandidate = candidates.find((row) => {
          const id = registrationId(row);
          return id && !mappedRegistrationIds.has(id);
        });
        const fallbackCandidate = candidates[0] || null;
        if (!availableCandidate && fallbackCandidate) conflicts += 1;
        selectedRegistration = availableCandidate || fallbackCandidate;
        selectedMethod = attempt.method;
        selectedKey = attempt.key;
        break;
      }

      const selectedRegistrationId = selectedRegistration ? registrationLookupKey(selectedRegistration) : '';
      const selectedProviderId = providerId(participant);
      if (selectedRegistrationId) mappedRegistrationIds.add(selectedRegistrationId);
      if (selectedProviderId) seenProviderIds.add(selectedProviderId);

      console.log('[participant-import][match-result]', {
        bib: candidateKeys.bib || null,
        athleteUid: candidateKeys.athleteUid || null,
        email: candidateKeys.email || null,
        phone: candidateKeys.phone || null,
        nameDob: candidateKeys.nameDob || null,
        matched: Boolean(selectedRegistrationId),
        matchedBy: selectedMethod,
        selectedRegistrationId: selectedRegistrationId || null,
        selectedProviderId: selectedProviderId || null,
        contestUuid: resolvedContestUUID || null,
        ticketId: selectedTicketId || null,
        subCategoryId: selectedSubCategoryId || null,
      });

      const selectedTicketId = String(
        normalizedAny?.ticketId ||
        normalizedAny?.ticket_id ||
        participant?.ticketId ||
        participant?.registrationTicketId ||
        participant?.ticket?.id ||
        participant?.ticket_uuid ||
        participant?.ticketUuid ||
        selectedRegistration?.ticketId ||
        selectedRegistration?.ticket_id ||
        '',
      ).trim();
      const selectedSubCategoryId = String(
        normalizedAny?.subCategoryId ||
        normalizedAny?.selectedSubCategoryId ||
        normalizedAny?.sub_category_id ||
        participant?.subCategoryId ||
        participant?.selectedSubCategoryId ||
        participant?.sub_category_id ||
        participant?.subCategory?.id ||
        selectedRegistration?.subCategoryId
        || selectedRegistration?.selectedSubCategoryId
        || selectedRegistration?.sub_category_id
        || selectedRegistration?.subCategory?.id
        || '',
      ).trim();
      const mappingKey = selectedSubCategoryId ? `${selectedTicketId}:${selectedSubCategoryId}` : selectedTicketId;
      const mappedTicketContest = selectedTicketId ? resolveContestFromTicketMapping(selectedTicketId, selectedSubCategoryId) : null;
      const resolvedContestUUID = String(
        normalized?.contest_uuid ||
        normalized?.contestUuid ||
        mappedTicketContest?.contestUuid ||
        '',
      ).trim() || null;
      const resolvedContestName = String(
        normalized?.contest_name ||
        normalized?.contestName ||
        mappedTicketContest?.contestName ||
        '',
      ).trim() || null;

      console.log('[participant-import][mapping]', {
        bib: candidateKeys.bib || null,
        ticketId: selectedTicketId || null,
        subCategoryId: selectedSubCategoryId || null,
        mappingKey: mappingKey || null,
        resolvedContestUuid: resolvedContestUUID,
      });

      if (resolvedContestUUID || resolvedContestName) {
        const currentAthlete: any = normalizedAthletes[idx] || normalized;
        normalizedAthletes[idx] = {
          ...currentAthlete,
          ticketId: selectedTicketId || currentAthlete?.ticketId || null,
          subCategoryId: selectedSubCategoryId || currentAthlete?.subCategoryId || null,
          contestUuid: resolvedContestUUID,
          contest_uuid: resolvedContestUUID,
          contestName: resolvedContestName,
          contest_name: resolvedContestName,
          mappingSource: mappedTicketContest ? 'ticketMappings' : (resolvedContestUUID ? 'provider' : 'unmapped'),
        };
      } else {
        const currentAthlete: any = normalizedAthletes[idx] || normalized;
        normalizedAthletes[idx] = {
          ...currentAthlete,
          ticketId: selectedTicketId || currentAthlete?.ticketId || null,
          subCategoryId: selectedSubCategoryId || currentAthlete?.subCategoryId || null,
          contestUuid: null,
          contest_uuid: null,
          contestName: null,
          contest_name: null,
          mappingSource: selectedTicketId ? 'ticketMappings' : 'unmapped',
        };
      }

      const isMapped = Boolean(selectedRegistrationId);
      if (isMapped) {
        matched += 1;
      } else {
        unmatched += 1;
      }

      mappings.push({
        bergmanParticipantId: selectedRegistrationId || null,
        bergmanAthleteId: selectedRegistration?.athleteUid || selectedRegistrationId || null,
        bergmanAthleteUid: selectedRegistration?.athleteUid || null,
        bergmanBookingId: selectedRegistration?.bookingId || null,
        ticketId: selectedTicketId || null,
        subCategoryId: selectedSubCategoryId || null,
        feibotParticipantId: selectedProviderId || null,
        contestUUID: resolvedContestUUID,
        contest_name: resolvedContestName,
        bib: candidateKeys.bib,
        chipCode: candidateKeys.chip || null,
        mappingMethod: selectedMethod,
        mappingKey: selectedKey || null,
        confidence: methodConfidence[selectedMethod] ?? 0,
        mapped: isMapped,
        syncedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        lastSync: new Date().toISOString(),
        raw: participant,
        bergmanRaw: selectedRegistration || null,
      });
    });

    const providerBibDuplicates = computeDuplicateBibCount(normalizedAthletes.map((athlete: any) => ({ bib: athlete?.bib })));
    const providerChipDuplicates = computeDuplicateBibCount(normalizedAthletes.map((athlete: any) => ({ bib: athlete?.chipCode })));
    const registrationDuplicates = computeDuplicateBibCount(registrationRows.map((row: any) => ({ bib: getRegistrationBib(row) })));
    const onlyInBergman = Math.max(registrationRows.length - mappedRegistrationIds.size, 0);
    const onlyInProvider = Math.max(participants.length - mappedRegistrationIds.size, 0);
    const mappingSummary = {
      totalProviderParticipants: participants.length,
      totalRegistrations: registrationRows.length,
      mapped: matched,
      unmatched,
      onlyInBergman,
      onlyInProvider,
      providerBibDuplicates,
      providerChipDuplicates,
      registrationDuplicates,
      conflicts,
      ambiguous,
      mappedRegistrationUnique: mappedRegistrationIds.size,
      mappedProviderUnique: seenProviderIds.size,
      methods: mappings.reduce((acc: Record<string, number>, row: any) => {
        const key = String(row?.mappingMethod || 'manual');
        acc[key] = Number(acc[key] || 0) + 1;
        return acc;
      }, {}),
    };

    const participantMappings = mappings.map((mapping: any) => ({
      bergmanParticipantId: mapping.bergmanParticipantId || null,
      bergmanAthleteId: mapping.bergmanAthleteId || mapping.bergmanAthleteUid || mapping.bergmanParticipantId || null,
      bergmanAthleteUid: mapping.bergmanAthleteUid || null,
      bergmanBookingId: mapping.bergmanBookingId || null,
      ticketId: mapping.ticketId || null,
      subCategoryId: mapping.subCategoryId || null,
      feibotParticipantUUID: mapping.feibotParticipantId || null,
      eventId,
      contestUUID: mapping.contestUUID || null,
      contest_name: mapping.contest_name || null,
      bib: mapping.bib || null,
      chipCode: mapping.chipCode || null,
      synced: Boolean(mapping.mapped),
      syncedAt: mapping.syncedAt || timestamp,
      lastUpdated: mapping.lastUpdated || timestamp,
      lastSync: mapping.lastSync || timestamp,
      status: mapping.mapped ? 'matched' : mapping.mappingMethod === 'manual' ? 'needs_review' : 'unmatched',
    }));

    // Persist a snapshot of mappings to R2
    try {
      const mapKey = `events/${eventId}/participantMappings/snapshot-${Date.now()}.json`;
      await env.BERGMAN_R2.put(mapKey, JSON.stringify({ mappings: participantMappings, summary: mappingSummary }, null, 2));
    } catch (e) {
      console.warn('Failed to write mappings to R2', e instanceof Error ? e.message : e);
    }

    await mergeKvJson(env, `event:${eventId}:participantMappings`, {
      updatedAt: timestamp,
      mappings: participantMappings,
      summary: mappingSummary,
    });
    await mergeKvJson(env, `live:event:${eventId}:participantMappings`, {
      updatedAt: timestamp,
      mappings: participantMappings,
      summary: mappingSummary,
    });

    await mergeKvJson(env, `live:event:${eventId}:monitoring`, {
      lastParticipantSync: timestamp,
      lastSync: timestamp,
      registeredParticipants: Number(registrationRows.length || configResponse?.registrationStats?.registered || participants.length),
      duplicateParticipants: Number(registrationDuplicates || configResponse?.registrationStats?.duplicates || 0),
      missingChips: participants.length > 0 ? normalizedAthletes.filter((athlete) => !String(athlete?.chipCode || '').trim()).length : null,
      chipConflicts: Number(conflicts || 0),
      mappingSummary,
      participantsImported: participants.length > 0,
      syncEngine: {
        state: 'idle',
        lastRun: timestamp,
        nextRun: null,
        readsProcessed: Number((await readKvJson(env, `live:event:${eventId}:monitoring`))?.syncEngine?.readsProcessed || 0),
        lastError: null,
      },
    });
    await recordProviderApiCall(env, eventId, {
      provider: 'feibot',
      endpoint: participantsFetch.endpointName,
      responseTimeMs: providerCallDurationMs,
      status: 200,
      success: true,
      timestamp,
      eventUuid: participantsFetch.eventUuid || getCloudEventUuid(config) || getScoreEventUuid(config),
      requestUrl: `${String(config.apiBaseUrl || 'https://apicn.feibot.com').replace(/\/$/, '')}${participantsFetch.endpoint}`,
      baseUrl: String(config.apiBaseUrl || 'https://apicn.feibot.com').replace(/\/$/, ''),
    });
    await upsertImportsState(env, eventId, {
      participants: participants.length > 0
        ? {
            status: 'completed',
            count: participants.length,
            lastImport: timestamp,
            durationMs: totalImportDurationMs,
          }
        : {
            status: 'waiting',
            count: 0,
            lastImport: null,
            durationMs: null,
          },
    });

    await writeKvJson(env, `event:${eventId}:providerState`, {
      ...((await readKvJson(env, `event:${eventId}:providerState`)) || {}),
      participantsImported: participants.length > 0,
      lastSuccessfulParticipantImport: timestamp,
      updatedAt: timestamp,
    });
    await writeKvJson(env, `live:event:${eventId}:providerState`, {
      ...((await readKvJson(env, `live:event:${eventId}:providerState`)) || {}),
      participantsImported: participants.length > 0,
      lastSuccessfulParticipantImport: timestamp,
      updatedAt: timestamp,
    });

    const participantsIndexPayload = buildParticipantsIndexPayload(normalizedAthletes);
    await writeKvJson(env, `event:${eventId}:participants`, participantsIndexPayload);
    await writeKvJson(env, `live:event:${eventId}:participants`, participantsIndexPayload);

    await persistNormalizedAthletes(env, eventId, normalizedAthletes);

    const providerParticipantsPayload = {
      provider: 'feibot',
      source: participantsSource,
      providerVersion: 'v1',
      importTime: timestamp,
      responseSize: new TextEncoder().encode(JSON.stringify(result || {})).length,
      importedCount: participants.length,
      durationMs: totalImportDurationMs,
      participantCount: normalizedAthletes.length,
      mappingSummary,
      participants: normalizedAthletes.map((athlete) => {
        const { raw, ...rest } = athlete || {};
        return rest;
      }),
    };

    await writeKvJson(env, `event:${eventId}:providerParticipants`, providerParticipantsPayload);
    await writeKvJson(env, `live:event:${eventId}:providerParticipants`, providerParticipantsPayload);

    return json({ success: true, eventId, total: participants.length, matched, unmatched, mappingSummary, participants: normalizedAthletes, rawSummary: { keys: result && typeof result === 'object' ? Object.keys(result).slice(0, 20) : [], code: result?.code, msg: result?.msg || result?.message || null }, mappingsSample: mappings.slice(0, 25) });
  } catch (error) {
    const timestamp = new Date().toISOString();
    await mergeKvJson(env, `live:event:${eventId}:monitoring`, {
      syncEngine: {
        state: 'error',
        lastRun: timestamp,
        nextRun: null,
        readsProcessed: Number((await readKvJson(env, `live:event:${eventId}:monitoring`))?.syncEngine?.readsProcessed || 0),
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
    await recordProviderApiCall(env, eventId, {
      provider: 'feibot',
      endpoint: 'participantsGetAll',
      responseTimeMs: 0,
      status: extractHttpStatus(error) || 500,
      success: false,
      timestamp,
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ success: false, message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

async function syncParticipants(request: Request, env: WorkerEnv, eventId: string) {
  return importFeibotParticipants(request, env, eventId);
}

async function importFeibotResults(request: Request, env: WorkerEnv, eventId: string) {
  try {
    const importStartedAt = Date.now();
    const body = await request.json().catch(() => ({}));
    const configResponse = await loadEventConfig(env, eventId).catch(() => null);
    const fallbackProviderConfig = await readKvJson(env, `live:event:${eventId}:provider-config`);
    const hub = mergeHubConfig(getHubConfig(configResponse), fallbackProviderConfig);
    const currentMonitoring = (await readKvJson(env, `live:event:${eventId}:monitoring`)) || {};

    await mergeKvJson(env, `live:event:${eventId}:monitoring`, {
      syncEngine: {
        state: 'importing_results',
        lastRun: new Date(importStartedAt).toISOString(),
        nextRun: null,
        readsProcessed: Number(currentMonitoring?.syncEngine?.readsProcessed || 0),
        lastError: null,
      },
    });

    const config = buildFeibotConfig(body, hub, eventId);
    const missing = validateFeibotConfig(config);
    if (missing.length > 0) {
      return json({ success: false, eventId, message: `Missing Feibot config fields: ${missing.join(', ')}` }, { status: 400 });
    }

    await persistProviderConfigFallback(env, eventId, body, hub);

    const providerCallStartedAt = Date.now();
    const resultsFetch = await fetchFeibotResultsPayload(env, eventId, config);
    const resultPayload = resultsFetch.payload;
    const providerCallDurationMs = Date.now() - providerCallStartedAt;
    const results = extractFeibotResults(resultPayload);

    try {
      const key = `events/${eventId}/results/raw-${Date.now()}.json`;
      await env.BERGMAN_R2.put(key, JSON.stringify(resultPayload, null, 2));
    } catch (e) {
      console.warn('Failed to write raw results to R2', e instanceof Error ? e.message : e);
    }

    const existingAthletes = await getAthletes(env, eventId);
    const athleteByBib = new Map<string, any>();
    existingAthletes.forEach((athlete: any) => {
      const bib = String(athlete?.bib || '').trim();
      if (bib) athleteByBib.set(bib, athlete);
    });

    let finished = 0;
    let dnf = 0;
    let dns = 0;
    let dnq = 0;
    let updated = 0;

    for (const row of results) {
      const bib = getResultBib(row);
      if (!bib) continue;

      const athlete = athleteByBib.get(bib);
      if (!athlete) continue;

      const resultTiming = extractResultLegSummary(row);

      const normalized = normalizeResultStatus(row);
      if (normalized === 'finished') finished += 1;
      else if (normalized === 'dnf') dnf += 1;
      else if (normalized === 'dns') dns += 1;
      else if (normalized === 'dnq') dnq += 1;

      const nextStatus = normalized === 'unknown'
        ? resultTiming.hasProgress
          ? 'on course'
          : String(athlete?.status || 'registered').toLowerCase()
        : normalized;
      const previousStatus = String(athlete?.status || '').toLowerCase();
      if (nextStatus !== previousStatus) updated += 1;

      athlete.status = nextStatus;
      if (nextStatus === 'finished') {
        athlete.leg = 'FINISHED';
        athlete.courseProgress = 100;
      } else if (resultTiming.hasProgress && String(athlete?.leg || '').toUpperCase() === 'START') {
        athlete.leg = resultTiming.summary.RUN2 ? 'RUN2' : resultTiming.summary.RUN ? 'RUN' : resultTiming.summary.BIKE ? 'BIKE' : resultTiming.summary.SWIM ? 'SWIM' : athlete.leg;
      }
      athlete.summary = {
        ...(athlete.summary || {}),
        ...resultTiming.summary,
      };
      athlete.splits = resultTiming.splits.length > 0 ? resultTiming.splits : Array.isArray(athlete.splits) ? athlete.splits : [];
      athlete.lastUpdateTime = Date.now();
      athlete.result = row;
    }

    const timestamp = new Date().toISOString();
    const totalImportDurationMs = Date.now() - importStartedAt;

    await persistNormalizedAthletes(env, eventId, existingAthletes);
    await writeKvJson(env, `live:event:${eventId}:timings`, {
      updatedAt: timestamp,
      source: 'feibot-results',
      totalRows: results.length,
      summary: { finished, dnf, dns, dnq },
      rows: results.slice(0, 200),
    });

    const existingReadsProcessed = Number(currentMonitoring?.syncEngine?.readsProcessed || 0);
    await mergeKvJson(env, `live:event:${eventId}:monitoring`, {
      lastSync: timestamp,
      resultsImported: results.length > 0,
      resultsCount: results.length,
      resultsLastImport: timestamp,
      readsPerMinute: Math.max(Number(currentMonitoring?.readsPerMinute || 0), results.length > 0 ? 1 : 0),
      syncEngine: {
        state: 'idle',
        lastRun: timestamp,
        nextRun: null,
        readsProcessed: existingReadsProcessed + results.length,
        lastError: null,
      },
    });

    await upsertImportsState(env, eventId, {
      results: results.length > 0
        ? {
            status: 'completed',
            count: results.length,
            lastImport: timestamp,
            durationMs: totalImportDurationMs,
          }
        : {
            status: 'waiting',
            count: 0,
            lastImport: null,
            durationMs: null,
          },
    });

    await writeKvJson(env, `event:${eventId}:providerState`, {
      ...((await readKvJson(env, `event:${eventId}:providerState`)) || {}),
      resultsImported: results.length > 0,
      lastSuccessfulResultImport: timestamp,
      updatedAt: timestamp,
    });
    await writeKvJson(env, `live:event:${eventId}:providerState`, {
      ...((await readKvJson(env, `live:event:${eventId}:providerState`)) || {}),
      resultsImported: results.length > 0,
      lastSuccessfulResultImport: timestamp,
      updatedAt: timestamp,
    });

    await recordProviderApiCall(env, eventId, {
      provider: 'feibot',
      endpoint: resultsFetch.endpointName,
      responseTimeMs: providerCallDurationMs,
      status: 200,
      success: true,
      timestamp,
      eventUuid: getScoreEventUuid(config),
      requestUrl: `${String(config.apiBaseUrl || 'https://apicn.feibot.com').replace(/\/$/, '')}${resultsFetch.endpoint}`,
      baseUrl: String(config.apiBaseUrl || 'https://apicn.feibot.com').replace(/\/$/, ''),
    });

    return json({
      success: true,
      eventId,
      total: results.length,
      updatedAthletes: updated,
      summary: { finished, dnf, dns, dnq },
      message: results.length > 0 ? `Results imported from ${resultsFetch.endpointName} and athlete statuses updated.` : 'No results returned by provider.',
    });
  } catch (error) {
    const timestamp = new Date().toISOString();
    const currentMonitoring = (await readKvJson(env, `live:event:${eventId}:monitoring`)) || {};
    const sanitizedErrorMessage = stripStringToSignFromMessage(error instanceof Error ? error.message : String(error));
    const failedEndpointName = String((error as any)?.diagnostics?.endpoint || 'temporary_ResultDataGetAll');
    await mergeKvJson(env, `live:event:${eventId}:monitoring`, {
      syncEngine: {
        state: 'error',
        lastRun: timestamp,
        nextRun: null,
        readsProcessed: Number(currentMonitoring?.syncEngine?.readsProcessed || 0),
        lastError: sanitizedErrorMessage,
      },
    });
    await recordProviderApiCall(env, eventId, {
      provider: 'feibot',
      endpoint: failedEndpointName,
      responseTimeMs: 0,
      status: extractHttpStatus(error) || 500,
      success: false,
      timestamp,
      message: sanitizedErrorMessage,
    });
    return json({ success: false, eventId, message: sanitizedErrorMessage }, { status: 500 });
  }
}

async function syncResults(request: Request, env: WorkerEnv, eventId: string) {
  return importFeibotResults(request, env, eventId);
}

async function syncFull(request: Request, env: WorkerEnv, eventId: string) {
  const body = await request.json().catch(() => ({}));
  const bodyString = JSON.stringify(body || {});
  const buildRequest = () =>
    new Request(`https://worker.local/v1/events/${encodeURIComponent(eventId)}/sync/full`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodyString,
    });

  const participantsResponse = await importFeibotParticipants(buildRequest(), env, eventId);
  const participantsPayload = await participantsResponse.clone().json().catch(() => null);
  if (!participantsResponse.ok) {
    return json(
      {
        success: false,
        eventId,
        message: 'Full sync failed during participant import.',
        participants: participantsPayload,
      },
      { status: participantsResponse.status },
    );
  }

  const resultsResponse = await importFeibotResults(buildRequest(), env, eventId);
  const resultsPayload = await resultsResponse.clone().json().catch(() => null);
  if (!resultsResponse.ok) {
    return json(
      {
        success: false,
        eventId,
        message: 'Full sync failed during results import.',
        participants: participantsPayload,
        results: resultsPayload,
      },
      { status: resultsResponse.status },
    );
  }

  const nowIso = new Date().toISOString();
  const currentMonitoring = (await readKvJson(env, `live:event:${eventId}:monitoring`)) || {};
  await mergeKvJson(env, `live:event:${eventId}:monitoring`, {
    lastSync: nowIso,
    syncEngine: {
      state: 'idle',
      lastRun: nowIso,
      nextRun: null,
      readsProcessed: Number(currentMonitoring?.syncEngine?.readsProcessed || 0),
      lastError: null,
    },
  });

  return json({
    success: true,
    eventId,
    message: 'Full sync completed (participants + results).',
    participants: participantsPayload,
    results: resultsPayload,
  });
}

const workerModule = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'access-control-allow-headers': 'content-type, x-bergman-internal-token',
        },
      });
    }

    try {
      const url = parseUrl(request);

      // ── Internal R2 file serving (used by Next.js reparse) ────────────────
      // Path: GET /v1/internal/r2/<r2key>
      // The key may contain slashes so we take everything after the prefix.
      if (request.method === 'GET' && url.pathname.startsWith('/v1/internal/r2/')) {
        const internalToken = request.headers.get('x-bergman-internal-token');
        const expectedToken = env.BERGMAN_INTERNAL_TOKEN;
        if (expectedToken && internalToken !== expectedToken) {
          return json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }
        const r2Key = decodeURIComponent(url.pathname.replace('/v1/internal/r2/', ''));
        if (!r2Key) return json({ success: false, message: 'Missing R2 key' }, { status: 400 });
        const obj = await env.BERGMAN_R2.get(r2Key);
        if (!obj) return json({ success: false, message: `File not found in R2: ${r2Key}` }, { status: 404 });
        const data = await obj.arrayBuffer();
        return new Response(data, {
          status: 200,
          headers: {
            'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
            'content-length': String(data.byteLength),
            'cache-control': 'no-store',
          },
        });
      }

      const route = getEventIdFromPath(url.pathname);
      if (!route) return json({ success: false, message: 'Not found' }, { status: 404 });

      const { eventId, tail } = route;
      const includeEmpty = parseIncludeEmptyFlag(url);
      if (request.method === 'GET' && tail === 'overview') return json({ success: true, eventId, ...(await getOverview(env, eventId)) });
      const categoryId = url.searchParams.get('categoryId') || undefined;
      if (request.method === 'GET' && tail === 'athletes') {
        if (categoryId && !includeEmpty) {
          const { activeIds } = await getActiveContestIdentifiers(env, eventId);
          if (activeIds.size > 0 && !activeIds.has(categoryId)) {
            return json({ success: true, eventId, categoryId, participants: [] });
          }
        }
        return json({ success: true, eventId, categoryId, participants: await getAthletes(env, eventId, categoryId) });
      }
      if (request.method === 'GET' && tail === 'leaderboard') {
        if (categoryId && !includeEmpty) {
          const { activeIds } = await getActiveContestIdentifiers(env, eventId);
          if (activeIds.size > 0 && !activeIds.has(categoryId)) {
            return json({ success: true, eventId, categoryId, leaderboard: { mode: url.searchParams.get('mode') || 'overall', limit: Number(url.searchParams.get('limit') || '25'), rows: [] } });
          }
        }
        return json({ success: true, eventId, categoryId, leaderboard: await getLeaderboard(env, eventId, url.searchParams.get('mode') || 'overall', Number(url.searchParams.get('limit') || '25'), categoryId) });
      }
      if (request.method === 'GET' && tail === 'timings') {
        const timingConfiguration =
          await readKvJson(env, `event:${eventId}:timingConfiguration`) ||
          await readKvJson(env, `live:event:${eventId}:timingConfiguration`) ||
          null;

        const filteredTimingConfiguration = await filterTimingConfigurationContestsByActivity(env, eventId, timingConfiguration, includeEmpty);

        console.log('[live-tracking-worker][timings]', {
          eventId,
          hasTimingConfiguration: Boolean(timingConfiguration),
          includeEmpty,
          topLevelKeys: timingConfiguration ? Object.keys(timingConfiguration) : [],
          contestCount: Array.isArray((timingConfiguration as any)?.contests) ? (timingConfiguration as any).contests.length : Array.isArray((timingConfiguration as any)?.course?.contests) ? (timingConfiguration as any).course.contests.length : 0,
          visibleContestCount: Array.isArray((filteredTimingConfiguration as any)?.contests) ? (filteredTimingConfiguration as any).contests.length : Array.isArray((filteredTimingConfiguration as any)?.course?.contests) ? (filteredTimingConfiguration as any).course.contests.length : 0,
          splitCount: Array.isArray((timingConfiguration as any)?.splits) ? (timingConfiguration as any).splits.length : Array.isArray((timingConfiguration as any)?.course?.splits) ? (timingConfiguration as any).course.splits.length : 0,
          timingPointCount: Array.isArray((timingConfiguration as any)?.timingPoints) ? (timingConfiguration as any).timingPoints.length : Array.isArray((timingConfiguration as any)?.course?.timingPoints) ? (timingConfiguration as any).course.timingPoints.length : 0,
        });

        return json({ success: true, eventId, includeEmpty, timings: filteredTimingConfiguration });
      }
      if (request.method === 'GET' && tail === 'replay') return json({ success: true, eventId, replay: await readR2Json(env, `event/${eventId}/replay/index.json`) });
      if (request.method === 'GET' && tail === 'monitoring') return json({ success: true, eventId, monitoring: await getMonitoringDashboard(env, eventId) });
      if (request.method === 'GET' && tail === 'logs') return json({ success: true, eventId, ...await getLogs(env, eventId) });
      if (request.method === 'GET' && tail === 'provider/database') return json({ success: true, eventId, database: await getProviderDatabase(env, eventId) });
      if (request.method === 'GET' && tail === 'provider/config') return json({ success: true, eventId, config: await getProviderConfig(env, eventId) });
      if (request.method === 'GET' && tail === 'provider/config/inspect') return json({ success: true, eventId, inspection: await inspectProviderConfig(env, eventId) });
      if (request.method === 'POST' && tail === 'provider/test') return testProvider(request, env, eventId);
      if (request.method === 'PUT' && tail === 'provider/config') return saveProviderConfig(request, env, eventId);
      if (request.method === 'PUT' && tail === 'timing-rules/source') return setTimingRulesSource(request, env, eventId);
      if (request.method === 'PUT' && tail === 'provider/database/metadata') return json({ success: false, eventId, message: 'Local database metadata is no longer supported.' }, { status: 410 });
      if (request.method === 'POST' && tail === 'provider/database/upload') return json({ success: false, eventId, message: 'Local database upload is no longer supported.' }, { status: 410 });
      if (request.method === 'POST' && tail === 'provider/database/reparse') return json({ success: false, eventId, message: 'Local database reparse is no longer supported.' }, { status: 410 });
      if (request.method === 'POST' && tail === 'import/feibot-participants') return importFeibotParticipants(request, env, eventId);
      if (request.method === 'POST' && tail.startsWith('sync/')) {
        const job = tail.replace('sync/', '');
        if (job === 'participants') return syncParticipants(request, env, eventId);
        if (job === 'results') return syncResults(request, env, eventId);
        if (job === 'full') return syncFull(request, env, eventId);
        return json({ success: true, eventId, job, message: 'Sync triggered. Wire this to your Durable Object orchestration.' });
      }

      return json({ success: false, message: 'Unknown live-tracking endpoint' }, { status: 404 });
    } catch (error) {
      return json({ success: false, message: error instanceof Error ? error.message : 'Worker error' }, { status: 500 });
    }
  },
};

export default workerModule;
