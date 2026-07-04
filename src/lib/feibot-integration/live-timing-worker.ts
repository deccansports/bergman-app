import { getKV, putKV } from '@/lib/cloudflare/kv';
import { callFeibotAPIWithCredentialFallback } from '@/lib/feibot-integration/api-client';

type AnyRecord = Record<string, any>;

type LiveTimingWorkerParams = {
  eventId: string;
  eventUuid?: string | null;
  apiBaseUrl?: string | null;
  sourcePayload?: any;
  triggeredBy?: string | null;
};

type LiveTimingWorkerResult = {
  success: boolean;
  eventId: string;
  source: 'payload' | 'feibot-api';
  processedRows: number;
  updatedParticipants: number;
  unresolvedRows: number;
  dnfCount: number;
  updatedAt: string;
  warning?: string;
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeLower(value: unknown) {
  return normalize(value).toLowerCase();
}

function normalizeLookupKey(value: unknown) {
  return normalizeLower(value).replace(/[^a-z0-9]/g, '');
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value >= 0 ? value : null;

  const text = normalize(value);
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : null;
  }

  const parts = text.split(':').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 3) return Math.max(0, (parts[0] * 3600) + (parts[1] * 60) + parts[2]);
  if (parts.length === 2) return Math.max(0, (parts[0] * 60) + parts[1]);
  return null;
}

function parseTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    return n > 1_000_000_000_000 ? Math.round(n / 1000) : Math.round(n);
  }
  const iso = normalize(value);
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 1000);
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatus(value: unknown) {
  const raw = normalizeLower(value);
  if (!raw) return 'On Course';
  if (raw === 'finished' || raw === 'finish' || raw === 'complete' || raw === 'completed' || raw === 'ok') return 'Finished';
  if (raw === 'dnf' || raw === 'did_not_finish') return 'DNF';
  if (raw === 'dns' || raw === 'did_not_start') return 'DNS';
  if (raw === 'dnq' || raw === 'dq' || raw === 'disqualified') return 'DNQ';
  if (raw === 'not_started' || raw === 'not started' || raw === 'pending') return 'Not Started';
  return 'On Course';
}

function extractRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const direct = [payload.data, payload.results, payload.rows, payload.list, payload.items, payload.participants];
  for (const candidate of direct) {
    if (Array.isArray(candidate)) return candidate;
  }

  const nested = [payload.data, payload.result, payload.payload, payload.response];
  for (const child of nested) {
    const rows = extractRows(child);
    if (rows.length > 0) return rows;
  }

  return [];
}

function resolveDownloadUrl(payload: any) {
  return normalize(payload?.download_url || payload?.downloadUrl || payload?.url || '');
}

async function resolveDownloadPayload(payload: any) {
  const downloadUrl = resolveDownloadUrl(payload);
  if (!downloadUrl) return payload;
  const response = await fetch(downloadUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to download Feibot live payload (${response.status})`);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractLatestSplits(row: any) {
  const source = Array.isArray(row?.splits)
    ? row.splits
    : Array.isArray(row?.timing_points)
      ? row.timing_points
      : Array.isArray(row?.timingPoints)
        ? row.timingPoints
        : [];

  const splits = asArray(source)
    .map((entry: any, index: number) => {
      const cumulativeSeconds = parseSeconds(
        entry?.time ?? entry?.elapsed ?? entry?.elapsed_seconds ?? entry?.result ?? entry?.value ?? entry?.overallTime,
      );
      if (cumulativeSeconds === null) return null;
      const splitUuid = normalize(entry?.splitUuid || entry?.split_uuid || entry?.uuid || entry?.id || '');
      const timingPointUuid = normalize(entry?.timingPointUuid || entry?.timing_point_uuid || entry?.TimingPointUUID || entry?.timingPointUUID || entry?.timingPointId || '');
      return {
        index,
        splitUuid,
        splitName: normalize(entry?.splitName || entry?.name || entry?.label || entry?.point || ''),
        timingPointUuid,
        timingPointName: normalize(entry?.timingPointName || entry?.point || entry?.label || ''),
        cumulativeSeconds,
        detectedAt: parseTimestamp(entry?.timestamp || entry?.time_at || entry?.updatedAt || entry?.createdAt) || null,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => a.cumulativeSeconds - b.cumulativeSeconds);

  if (splits.length === 0) return { all: [], latest: null as any };

  let previous = 0;
  for (const split of splits) {
    const delta = split.cumulativeSeconds - previous;
    (split as any).splitSeconds = delta > 0 ? delta : split.cumulativeSeconds;
    previous = split.cumulativeSeconds;
  }

  return { all: splits, latest: splits[splits.length - 1] };
}

function contestKey(contestUuid: string | null | undefined) {
  return normalizeLookupKey(contestUuid || '');
}

function findContest(courseIndex: AnyRecord | null, contestUuid: string | null) {
  const key = contestKey(contestUuid);
  if (!courseIndex || !key) return null;

  const byContest = courseIndex?.byContest || courseIndex?.contestLookup || {};
  if (byContest[key]) return byContest[key];
  if (byContest[contestUuid || '']) return byContest[contestUuid || ''];

  const contests = asArray(courseIndex?.contests);
  return contests.find((contest: any) => contestKey(contest?.contestUuid || contest?.uuid || contest?.id) === key) || null;
}

function readCutoffSeconds(cutoffs: AnyRecord | null | undefined) {
  if (!cutoffs || typeof cutoffs !== 'object') return {} as Record<string, number>;
  const out: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(cutoffs)) {
    const key = normalizeLower(rawKey);
    const candidate =
      parseSeconds(rawValue) ??
      parseSeconds((rawValue as any)?.time) ??
      parseSeconds((rawValue as any)?.value) ??
      parseSeconds((rawValue as any)?.cutoff);
    if (candidate !== null) out[key] = candidate;
  }
  return out;
}

function evaluateCutoff(params: {
  cutoffs: Record<string, number>;
  currentLeg: string;
  overallTime: number | null;
  legTime: number | null;
}) {
  const { cutoffs, currentLeg, overallTime, legTime } = params;
  const legLower = normalizeLower(currentLeg);

  const legCutoff =
    (/swim/.test(legLower) ? (cutoffs.swim ?? cutoffs.run1) : null) ??
    (/bike/.test(legLower) ? cutoffs.bike : null) ??
    (/run/.test(legLower) ? (cutoffs.run ?? cutoffs.run2) : null) ??
    null;

  const overallCutoff = cutoffs.overall ?? cutoffs.finish ?? cutoffs.total ?? null;

  const breachedLeg = legCutoff !== null && legTime !== null && legTime > legCutoff;
  const breachedOverall = overallCutoff !== null && overallTime !== null && overallTime > overallCutoff;

  if (breachedLeg || breachedOverall) {
    return {
      cutoffStatus: 'Missed Cutoff',
      cutoffReason: breachedOverall ? 'Overall cutoff exceeded' : 'Leg cutoff exceeded',
      statusOverride: 'DNF' as const,
    };
  }

  const warningThreshold = 300;
  const nearLeg = legCutoff !== null && legTime !== null && (legCutoff - legTime) <= warningThreshold;
  const nearOverall = overallCutoff !== null && overallTime !== null && (overallCutoff - overallTime) <= warningThreshold;
  if (nearLeg || nearOverall) {
    return {
      cutoffStatus: 'Approaching Cutoff',
      cutoffReason: nearOverall ? 'Approaching overall cutoff' : 'Approaching leg cutoff',
      statusOverride: null,
    };
  }

  return {
    cutoffStatus: (legCutoff !== null || overallCutoff !== null) ? 'Within Cutoff' : 'N/A',
    cutoffReason: null,
    statusOverride: null,
  };
}

function extractIdentity(row: AnyRecord) {
  return {
    bookingId: normalize(row?.bookingId || row?.booking_id || row?.registrationId || row?.registration_id || ''),
    bib: normalize(row?.bib || row?.bib_no || row?.bibNumber || row?.number || row?.no || '').replace(/^0+/, ''),
    providerUuid: normalize(row?.participant_uuid || row?.participantUuid || row?.providerUuid || row?.uuid || row?.id || ''),
    email: normalizeLower(row?.email || row?.Email || row?.e_mail || row?.userEmail || ''),
    athleteUid: normalizeLower(row?.athleteUid || row?.uid || row?.userId || row?.bergmanAthleteId || ''),
  };
}

function resolveBookingId(params: {
  row: AnyRecord;
  participantIndex: AnyRecord | null;
  lookupIndex: {
    byBib: Record<string, string>;
    byUuid: Record<string, string>;
    byProviderUuid: Record<string, string>;
    byEmail: Record<string, string>;
    byAthleteUid: Record<string, string>;
    byBookingId: Record<string, string>;
  };
}) {
  const { row, participantIndex, lookupIndex } = params;
  const identity = extractIdentity(row);

  const providerKey = normalizeLookupKey(identity.providerUuid);
  const bibKey = normalize(identity.bib);
  const emailKey = normalizeLower(identity.email);
  const athleteKey = normalizeLookupKey(identity.athleteUid);
  const directBooking = normalize(identity.bookingId);

  const candidate =
    (providerKey && (lookupIndex.byProviderUuid[providerKey] || lookupIndex.byUuid[providerKey])) ||
    (bibKey && lookupIndex.byBib[bibKey]) ||
    (emailKey && lookupIndex.byEmail[emailKey]) ||
    (athleteKey && lookupIndex.byAthleteUid[athleteKey]) ||
    (directBooking && lookupIndex.byBookingId[normalizeLookupKey(directBooking)]) ||
    null;

  if (candidate) return candidate;

  const rows = asArray(participantIndex?.participants);
  const fallback = rows.find((entry: any) => {
    const entryBib = normalize(entry?.bib || entry?.bibNumber || '').replace(/^0+/, '');
    const entryProviderUuid = normalizeLookupKey(entry?.providerUuid || entry?.provider_uuid || entry?.participantUuid || entry?.participant_uuid || entry?.uuid || '');
    const entryEmail = normalizeLower(entry?.email || entry?.emailLower || '');
    const entryAthleteUid = normalizeLookupKey(entry?.athleteUid || '');

    return (
      (!!bibKey && entryBib === bibKey)
      || (!!providerKey && entryProviderUuid === providerKey)
      || (!!emailKey && entryEmail === emailKey)
      || (!!athleteKey && entryAthleteUid === athleteKey)
    );
  }) || null;

  return normalize(fallback?.bookingId || '') || null;
}

function toBookingMap(indexMap: AnyRecord | null | undefined) {
  const map: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(indexMap || {})) {
    const key = normalizeLookupKey(rawKey);
    if (!key) continue;
    if (typeof rawValue === 'string') {
      const bookingId = normalize(rawValue);
      if (bookingId) map[key] = bookingId;
      continue;
    }
    const bookingId = normalize((rawValue as AnyRecord)?.bookingId || (rawValue as AnyRecord)?.id || '');
    if (bookingId) map[key] = bookingId;
  }
  return map;
}

function resolveSplitForDetection(params: {
  row: AnyRecord;
  latestSplit: AnyRecord | null;
  splitIndex: AnyRecord | null;
  contestUuid: string | null;
}) {
  const { row, latestSplit, splitIndex, contestUuid } = params;
  const contestKeyValue = contestKey(contestUuid);
  const byContest = splitIndex?.byContest || {};
  const contestSplits = asArray(byContest?.[contestKeyValue]?.splits || byContest?.[contestUuid || '']?.splits || []);

  const byTimingPoint = splitIndex?.byTimingPoint || splitIndex?.splitByTimingPointUuid || {};
  const splitLookup = splitIndex?.splitLookup || splitIndex?.bySplitId || splitIndex?.splitByUuid || {};

  const timingPointUuid = normalize(
    latestSplit?.timingPointUuid
    || row?.timingPointUuid
    || row?.timing_point_uuid
    || row?.TimingPointUUID
    || row?.timingPointUUID
    || row?.timingPointId
    || row?.timing_point_id
    || '',
  );
  const splitUuid = normalize(latestSplit?.splitUuid || row?.splitUuid || row?.split_uuid || row?.SplitUUID || row?.splitId || row?.split_id || '');

  let resolved: AnyRecord | null = null;

  if (splitUuid) {
    const splitKey = normalizeLookupKey(splitUuid);
    resolved = splitLookup?.[splitKey] || splitLookup?.[splitUuid] || null;
    if (!resolved && contestSplits.length > 0) {
      resolved = contestSplits.find((entry: any) => normalizeLookupKey(entry?.splitUuid || entry?.uuid || '') === splitKey) || null;
    }
  }

  if (!resolved && timingPointUuid) {
    const timingKey = normalizeLookupKey(timingPointUuid);
    const candidates = asArray(byTimingPoint?.[timingKey] || byTimingPoint?.[timingPointUuid]);
    if (candidates.length > 0) {
      resolved = candidates.find((entry: any) => contestKey(entry?.contestUuid) === contestKeyValue) || candidates[0] || null;
    }
  }

  if (!resolved && latestSplit?.splitName && contestSplits.length > 0) {
    const splitNameKey = normalizeLookupKey(latestSplit.splitName);
    resolved = contestSplits.find((entry: any) => normalizeLookupKey(entry?.splitName || entry?.name || entry?.label || '') === splitNameKey) || null;
  }

  const orderedContestSplits = contestSplits
    .slice()
    .sort((a: any, b: any) => Number(a?.order || 0) - Number(b?.order || 0));

  const currentOrder = Number(resolved?.order || 0);
  const nextSplit = orderedContestSplits.find((entry: any) => Number(entry?.order || 0) > currentOrder) || null;

  return {
    resolvedSplit: resolved,
    nextSplit,
    contestSplits: orderedContestSplits,
    timingPointUuid,
  };
}

function resolveLegFromSplit(params: {
  resolvedSplit: AnyRecord | null;
  contestUuid: string | null;
  legIndex: AnyRecord | null;
}) {
  const { resolvedSplit, contestUuid, legIndex } = params;
  const splitLeg = normalize(resolvedSplit?.leg || resolvedSplit?.type || '');
  if (splitLeg) return splitLeg.toUpperCase();

  const contestKeyValue = contestKey(contestUuid);
  const legs = asArray(legIndex?.byContest?.[contestKeyValue] || legIndex?.byContest?.[contestUuid || ''] || []);
  const splitUuid = normalizeLookupKey(resolvedSplit?.splitUuid || resolvedSplit?.uuid || '');
  if (!splitUuid || legs.length === 0) return '';

  const findOrderFor = (uuid: unknown) => normalizeLookupKey(uuid);
  const matched = legs.find((leg: any) => {
    const first = findOrderFor(leg?.firstSplitUuid || leg?.first_split_uuid || leg?.configuration?.first_split_uuid);
    const last = findOrderFor(leg?.lastSplitUuid || leg?.last_split_uuid || leg?.configuration?.last_split_uuid);
    if (!first || !last) return false;
    if (first === splitUuid || last === splitUuid) return true;
    return false;
  }) || null;

  return normalize(matched?.name || matched?.label || matched?.legName || '').toUpperCase();
}

function buildRanking(records: Array<{ bookingId: string; payload: AnyRecord; gender: string; ageGroupUuid: string; contestUuid: string }>) {
  const ranked = records
    .filter((entry) => Number.isFinite(Number(entry.payload?.overallTime)) && Number(entry.payload?.overallTime) > 0)
    .slice()
    .sort((a, b) => Number(a.payload.overallTime) - Number(b.payload.overallTime));

  for (let i = 0; i < ranked.length; i += 1) {
    ranked[i].payload.overallRank = i + 1;
  }

  const rankWithin = (selector: (entry: typeof ranked[number]) => string, field: 'genderRank' | 'ageGroupRank' | 'contestRank') => {
    const groups = new Map<string, typeof ranked>();
    for (const entry of ranked) {
      const key = normalizeLookupKey(selector(entry));
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, [] as any);
      groups.get(key)!.push(entry as any);
    }
    for (const entries of groups.values()) {
      entries.sort((a, b) => Number(a.payload.overallTime) - Number(b.payload.overallTime));
      entries.forEach((entry, index) => {
        entry.payload[field] = index + 1;
      });
    }
  };

  rankWithin((entry) => entry.gender, 'genderRank');
  rankWithin((entry) => entry.ageGroupUuid, 'ageGroupRank');
  rankWithin((entry) => entry.contestUuid, 'contestRank');
}

function toHistoryRows(allSplits: AnyRecord[], resolvedContestSplits: AnyRecord[]) {
  if (!Array.isArray(allSplits) || allSplits.length === 0) return [];
  const bySplitUuid = new Map<string, AnyRecord>();
  const byTimingPoint = new Map<string, AnyRecord>();
  for (const split of resolvedContestSplits) {
    const splitUuid = normalizeLookupKey(split?.splitUuid || split?.uuid || '');
    const timingPointUuid = normalizeLookupKey(split?.timingPointUuid || split?.timing_point_uuid || '');
    if (splitUuid) bySplitUuid.set(splitUuid, split);
    if (timingPointUuid) byTimingPoint.set(timingPointUuid, split);
  }

  return allSplits.map((entry: AnyRecord) => {
    const splitUuidKey = normalizeLookupKey(entry?.splitUuid || '');
    const timingPointKey = normalizeLookupKey(entry?.timingPointUuid || '');
    const mapped = bySplitUuid.get(splitUuidKey) || byTimingPoint.get(timingPointKey) || null;
    return {
      splitUuid: normalize(entry?.splitUuid || mapped?.splitUuid || mapped?.uuid || ''),
      splitName: normalize(entry?.splitName || mapped?.splitName || mapped?.displayName || ''),
      timingPointUuid: normalize(entry?.timingPointUuid || mapped?.timingPointUuid || ''),
      timingPointName: normalize(entry?.timingPointName || mapped?.timingPointName || ''),
      cumulativeSeconds: Number(entry?.cumulativeSeconds || 0),
      splitSeconds: Number(entry?.splitSeconds || 0),
      leg: normalize(mapped?.leg || '').toUpperCase() || null,
      detectedAt: entry?.detectedAt || null,
    };
  });
}

async function fetchLiveResultsFromFeibot(params: { eventId: string; eventUuid: string; apiBaseUrl?: string | null }) {
  const response = await callFeibotAPIWithCredentialFallback<any>(
    '/temporary/temporary_ResultDataGetAll',
    { method: 'GET', query: { event_uuid: params.eventUuid } },
    {
      eventId: params.eventId,
      apiBaseUrl: params.apiBaseUrl || undefined,
      credentialType: 'auto',
    },
  );

  if (!response.ok) {
    throw new Error(`Feibot live timing fetch failed (${response.status})`);
  }

  return resolveDownloadPayload(response.data);
}

export async function syncFeibotLiveTimingToKv(params: LiveTimingWorkerParams): Promise<LiveTimingWorkerResult> {
  const eventId = normalize(params.eventId);
  if (!eventId) {
    throw new Error('eventId is required');
  }

  const payload = params.sourcePayload
    ? await resolveDownloadPayload(params.sourcePayload)
    : (params.eventUuid
      ? await fetchLiveResultsFromFeibot({ eventId, eventUuid: normalize(params.eventUuid), apiBaseUrl: params.apiBaseUrl || null })
      : await getKV<any>(`live:event:${eventId}:provider:live-results`, 'live-timing-worker'));

  const rows = extractRows(payload);
  const updatedAtIso = new Date().toISOString();

  const [participantIndex, splitIndex, legIndex, courseIndex] = await Promise.all([
    getKV<any>(`live:event:${eventId}:participant:index`, 'live-timing-worker'),
    getKV<any>(`live:event:${eventId}:split:index`, 'live-timing-worker'),
    getKV<any>(`live:event:${eventId}:leg:index`, 'live-timing-worker'),
    getKV<any>(`live:event:${eventId}:course:index`, 'live-timing-worker'),
  ]);

  const staticParticipants = asArray(participantIndex?.participants);
  const participantByBooking = new Map<string, AnyRecord>();
  for (const participant of staticParticipants) {
    const bookingId = normalize(participant?.bookingId || '');
    if (bookingId) participantByBooking.set(bookingId, participant);
  }

  const lookupIndex = {
    byBib: toBookingMap(participantIndex?.byBib),
    byUuid: toBookingMap(participantIndex?.byUUID || participantIndex?.byUuid),
    byProviderUuid: toBookingMap(participantIndex?.byProviderUuid),
    byEmail: toBookingMap(participantIndex?.byEmail),
    byAthleteUid: toBookingMap(participantIndex?.byAthleteUid),
    byBookingId: toBookingMap(participantIndex?.byBookingId),
  };

  const out: Array<{ bookingId: string; payload: AnyRecord; gender: string; ageGroupUuid: string; contestUuid: string; participant: AnyRecord }> = [];
  let unresolvedRows = 0;

  for (const row of rows) {
    const bookingId = resolveBookingId({ row, participantIndex, lookupIndex });
    if (!bookingId) {
      unresolvedRows += 1;
      continue;
    }

    const staticParticipant = participantByBooking.get(bookingId) || null;
    if (!staticParticipant) {
      unresolvedRows += 1;
      continue;
    }

    const contestUuid = normalize(
      row?.contestUuid
      || row?.contest_uuid
      || staticParticipant?.contestUuid
      || staticParticipant?.contest_uuid
      || staticParticipant?.providerContestUuid
      || '',
    ) || null;

    const { all: allLiveSplits, latest: latestSplit } = extractLatestSplits(row);
    const { resolvedSplit, nextSplit, contestSplits, timingPointUuid } = resolveSplitForDetection({
      row,
      latestSplit,
      splitIndex,
      contestUuid,
    });

    const currentLeg = resolveLegFromSplit({ resolvedSplit, contestUuid, legIndex }) || normalize(row?.currentLeg || row?.leg || '').toUpperCase() || 'ON_COURSE';

    const overallTime =
      parseSeconds(
        row?.overallTime
        || row?.totalTime
        || row?.total_time
        || row?.elapsed
        || row?.elapsed_seconds
        || row?.official_time
        || row?.finish_time,
      ) ?? (latestSplit ? Number(latestSplit.cumulativeSeconds) : null);

    const segmentTime = latestSplit ? Number((latestSplit as any).splitSeconds || 0) : (parseSeconds(row?.segmentTime || row?.splitTime || row?.lapTime) ?? null);
    let legTime = parseSeconds(row?.legTime || row?.leg_time || row?.currentLegTime);
    if (legTime === null && overallTime !== null && latestSplit && contestSplits.length > 0 && currentLeg) {
      const legSplits = contestSplits.filter((entry: any) => normalize(entry?.leg || '').toUpperCase() === currentLeg);
      if (legSplits.length > 0) {
        const firstLegOrder = Math.min(...legSplits.map((entry: any) => Number(entry?.order || 0)));
        const previousSplit = contestSplits
          .filter((entry: any) => Number(entry?.order || 0) < firstLegOrder)
          .sort((a: any, b: any) => Number(b?.order || 0) - Number(a?.order || 0))[0] || null;
        const previousHistory = previousSplit
          ? allLiveSplits.find((entry: any) => normalizeLookupKey(entry?.splitUuid || '') === normalizeLookupKey(previousSplit?.splitUuid || previousSplit?.uuid || ''))
          : null;
        if (previousHistory) {
          const previousSeconds = Number(previousHistory.cumulativeSeconds || 0);
          legTime = Math.max(0, overallTime - previousSeconds);
        }
      }
    }

    const splitDistanceKm = parseNumber(resolvedSplit?.distanceKm) ?? parseNumber(resolvedSplit?.splitDistanceKm) ?? null;
    const rowDistanceKm = parseNumber(row?.distanceCovered || row?.distance_covered || row?.distanceKm || row?.distance || row?.km || row?.totalDistanceCovered);
    const distanceCovered = splitDistanceKm ?? rowDistanceKm ?? 0;

    const contest = findContest(courseIndex, contestUuid);
    const totalDistanceKm = parseNumber(contest?.courseDistanceKm ?? contest?.distanceKm ?? courseIndex?.courseDistanceKm ?? null) ?? 0;
    const distanceRemaining = Math.max(0, totalDistanceKm - distanceCovered);

    const pace = parseNumber(row?.pace || row?.avgPace || row?.averagePace) ?? (
      overallTime !== null && distanceCovered > 0 ? (overallTime / distanceCovered) : null
    );
    const speed = parseNumber(row?.speed || row?.avgSpeed || row?.averageSpeed || row?.currentSpeedKph) ?? (
      overallTime !== null && overallTime > 0 && distanceCovered > 0 ? (distanceCovered / (overallTime / 3600)) : null
    );

    const latestDetectionTs = parseTimestamp(
      row?.lastDetection
      || row?.lastSeen
      || row?.updatedAt
      || row?.timestamp
      || latestSplit?.detectedAt
      || Date.now(),
    ) || Math.floor(Date.now() / 1000);

    let status = normalizeStatus(row?.status || row?.result_status || row?.race_status || staticParticipant?.status || 'On Course');
    if (resolvedSplit?.isFinish || normalizeLower(resolvedSplit?.splitName).includes('finish')) {
      status = 'Finished';
    }

    const cutoffs = readCutoffSeconds((contest as any)?.cutoffs || courseIndex?.cutoffs || null);
    const cutoff = evaluateCutoff({ cutoffs, currentLeg, overallTime, legTime });
    if (cutoff.statusOverride) status = cutoff.statusOverride;

    const history = toHistoryRows(allLiveSplits, contestSplits);

    const payload: AnyRecord = {
      lastDetection: latestDetectionTs,
      lastSeen: latestDetectionTs,
      lastTimingPointUuid: normalize(
        latestSplit?.timingPointUuid
        || timingPointUuid
        || resolvedSplit?.timingPointUuid
        || '',
      ) || null,
      lastTimingPointName: normalize(latestSplit?.timingPointName || resolvedSplit?.timingPointName || row?.timingPointName || row?.timing_point_name || '') || null,
      lastSplitUuid: normalize(latestSplit?.splitUuid || resolvedSplit?.splitUuid || resolvedSplit?.uuid || '') || null,
      lastSplitName: normalize(latestSplit?.splitName || resolvedSplit?.splitName || resolvedSplit?.displayName || '') || null,
      lastLegUuid: normalize(resolvedSplit?.leg || currentLeg || '') || null,
      lastLegName: normalize(currentLeg || resolvedSplit?.leg || '') || null,
      currentLeg: normalize(currentLeg || '') || null,
      currentSplit: normalize(resolvedSplit?.splitName || resolvedSplit?.displayName || latestSplit?.splitName || '') || null,
      distanceCovered,
      distanceRemaining,
      progressPercent: totalDistanceKm > 0 ? Math.max(0, Math.min(100, Math.round((distanceCovered / totalDistanceKm) * 100))) : null,
      overallTime,
      legTime,
      segmentTime,
      pace,
      speed,
      estimatedFinish: parseTimestamp(row?.estimatedFinish || row?.expectedFinish || row?.etaFinish || ''),
      expectedNextSplit: normalize(nextSplit?.splitName || nextSplit?.displayName || '') || null,
      expectedNextDetection: parseTimestamp(row?.expectedNextDetection || row?.nextDetection || row?.next_detection || ''),
      status,
      cutoffStatus: cutoff.cutoffStatus,
      cutoffReason: cutoff.cutoffReason,
      updatedAt: updatedAtIso,
      splits: history,
      source: 'feibot-live-worker',
      sourceRow: {
        participantUuid: normalize(row?.participantUuid || row?.participant_uuid || row?.uuid || ''),
        bib: normalize(row?.bib || row?.bib_no || row?.bibNumber || ''),
      },
    };

    payload.lastTimingPoint = payload.lastTimingPointName || null;
    payload.elapsed = overallTime;
    payload.gunTime = overallTime;
    payload.chipTime = parseSeconds(row?.chipTime || row?.chip_time || row?.netTime || row?.net_time) ?? overallTime;
    payload.segmentTime = segmentTime;
    payload.distanceCompleted = distanceCovered;
    payload.averagePace = pace;
    payload.averageSpeed = speed;
    payload.transitionTime = parseSeconds(row?.transitionTime || row?.transition_time || row?.tTime) ?? null;
    payload.finished = normalizeLower(status) === 'finished';
    payload.dnf = normalizeLower(status) === 'dnf';
    payload.dns = normalizeLower(status) === 'dns';

    if (payload.dnf) {
      payload.finished = false;
    }

    console.log('[LIVE TIMING WORKER] Cutoff evaluated', {
      eventId,
      bookingId,
      cutoffStatus: payload.cutoffStatus,
      status: payload.status,
    });

    out.push({
      bookingId,
      payload,
      gender: normalizeLower(staticParticipant?.gender || ''),
      ageGroupUuid: normalize(staticParticipant?.ageGroupUuid || staticParticipant?.age_group_uuid || ''),
      contestUuid: normalize(contestUuid || staticParticipant?.contestUuid || staticParticipant?.contest_uuid || ''),
      participant: staticParticipant,
    });
  }

  buildRanking(out);

  let updatedParticipants = 0;
  for (const row of out) {
    await putKV(`live:event:${eventId}:participantLive:${row.bookingId}`, row.payload, 'live-timing-worker');
    updatedParticipants += 1;
  }

  console.log('[LIVE TIMING WORKER] participantLive updated', {
    eventId,
    updatedParticipants,
    unresolvedRows,
  });

  const leaderboardRows = out
    .filter((entry) => Number.isFinite(Number(entry.payload?.overallTime)) && Number(entry.payload?.overallTime) > 0)
    .sort((a, b) => Number(a.payload.overallTime) - Number(b.payload.overallTime))
    .map((entry) => ({
      bookingId: entry.bookingId,
      overallTime: entry.payload.overallTime,
      overallRank: entry.payload.overallRank || null,
      contestRank: entry.payload.contestRank || null,
      genderRank: entry.payload.genderRank || null,
      ageGroupRank: entry.payload.ageGroupRank || null,
      status: entry.payload.status,
      currentLeg: entry.payload.currentLeg,
      currentSplit: entry.payload.currentSplit,
      distanceCovered: entry.payload.distanceCovered,
      distanceRemaining: entry.payload.distanceRemaining,
      updatedAt: entry.payload.updatedAt,
    }));

  await putKV(`live:event:${eventId}:leaderboard`, {
    eventId,
    updatedAt: updatedAtIso,
    source: 'feibot-live-worker',
    participants: leaderboardRows,
    count: leaderboardRows.length,
  }, 'live-timing-worker');

  const athletesSnapshot = out.map((entry) => {
    const participant = entry.participant || {};
    const payload = entry.payload || {};
    return {
      ...participant,
      ...payload,
      bookingId: entry.bookingId,
      bib: participant?.bib || participant?.bibNumber || null,
      participantUuid: participant?.participantUuid || participant?.participant_uuid || participant?.providerUuid || null,
      providerUuid: participant?.providerUuid || participant?.provider_uuid || participant?.participantUuid || null,
      contestUuid: participant?.contestUuid || participant?.contest_uuid || entry.contestUuid || null,
      contestName: participant?.contestName || participant?.contest_name || null,
      ageGroupUuid: participant?.ageGroupUuid || participant?.age_group_uuid || entry.ageGroupUuid || null,
      ageGroupName: participant?.ageGroupName || participant?.age_group_name || null,
      leg: payload?.currentLeg || null,
      splitName: payload?.currentSplit || null,
      lastUpdateTime: payload?.lastSeen || null,
      status: payload?.status || 'On Course',
      cutoffStatus: payload?.cutoffStatus || 'N/A',
      cutoffReason: payload?.cutoffReason || null,
      splits: payload?.splits || [],
    };
  });

  await putKV(`live:event:${eventId}:participantLive:index`, {
    eventId,
    updatedAt: updatedAtIso,
    count: out.length,
    bookingIds: out.map((entry) => entry.bookingId),
  }, 'live-timing-worker');

  await putKV(`live:event:${eventId}:athletes`, athletesSnapshot, 'live-timing-worker');

  await putKV(`live:event:${eventId}:timingReads`, {
    eventId,
    updatedAt: updatedAtIso,
    source: 'feibot-live-worker',
    processedRows: rows.length,
    updatedParticipants,
    unresolvedRows,
  }, 'live-timing-worker');

  await putKV(`live:event:${eventId}:monitoring`, {
    eventId,
    source: 'feibot-live-worker',
    lastSync: updatedAtIso,
    processedRows: rows.length,
    updatedParticipants,
    unresolvedRows,
    dnfCount: out.filter((entry) => normalizeLower(entry.payload?.status) === 'dnf').length,
    triggeredBy: normalize(params.triggeredBy || 'unknown') || 'unknown',
  }, 'live-timing-worker');

  return {
    success: true,
    eventId,
    source: params.sourcePayload ? 'payload' : 'feibot-api',
    processedRows: rows.length,
    updatedParticipants,
    unresolvedRows,
    dnfCount: out.filter((entry) => normalizeLower(entry.payload?.status) === 'dnf').length,
    updatedAt: updatedAtIso,
    warning: rows.length === 0 ? 'No live result rows were returned.' : undefined,
  };
}
