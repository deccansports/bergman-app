import { callFeibotAPIWithCredentialFallback } from '@/lib/feibot-integration/api-client';
import { getFeibotRuntimeSecretsAsyncForEvent, resolveFeibotRuntimeEventUuid } from '@/lib/feibot-integration/secure-credentials';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import { rebuildCourseIndexInKv } from '@/lib/courseIndex';
import { buildFeibotParticipantImport } from '@/lib/feibotParticipantImport';
import { rebuildSplitIndexInKv } from '@/lib/splitIndex';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

const inFlightCloudSync = new Map<string, Promise<any>>();

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function uniqueByKey<T = any>(rows: T[], getKey: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = getKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function mergeUniqueRows<T = any>(...groups: T[][]) {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const group of groups) {
    for (const row of Array.isArray(group) ? group : []) {
      const record = row as any;
      const key = normalize(record?.UUID || record?.uuid || record?.id || record?.splitUuid || record?.split_uuid || record?.timingPointUuid || record?.timingPointUUID || record?.ageGroupUuid || record?.age_group_uuid || record?.deviceUuid || record?.device_uuid || record?.name || record?.label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }

  return out;
}

async function loadCanonicalTimingConfiguration(eventId: string) {
  return (await getKV<Record<string, any>>(`event:${eventId}:timingConfiguration`, 'cloud-event-sync')) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:timingConfiguration`, 'cloud-event-sync')) ||
    null;
}

function extractTimingRulesCollections(payload: any) {
  const contests = asArray(payload?.contests).concat(asArray(payload?.timing_rules?.contests));
  const legs = asArray(payload?.legs).concat(asArray(payload?.timing_rules?.legs));
  const splits = asArray(payload?.splits).concat(asArray(payload?.timing_rules?.splits));
  const timingPoints = asArray(payload?.timing_points)
    .concat(asArray(payload?.timingPoints))
    .concat(asArray(payload?.timing_rules?.timing_points))
    .concat(asArray(payload?.timing_rules?.timingPoints));
  const ageGroups = asArray(payload?.age_groups)
    .concat(asArray(payload?.ageGroups))
    .concat(asArray(payload?.timing_rules?.age_groups))
    .concat(asArray(payload?.timing_rules?.ageGroups));

  return {
    contests,
    legs,
    splits,
    timingPoints,
    ageGroups,
  };
}

function isTimingRulesEmpty(payload: any) {
  const rows = extractTimingRulesCollections(payload);
  return (
    rows.contests.length === 0 &&
    rows.legs.length === 0 &&
    rows.splits.length === 0 &&
    rows.timingPoints.length === 0 &&
    rows.ageGroups.length === 0
  );
}

async function writeLiveTimingConfigurationIndexes(params: {
  eventId: string;
  timingConfiguration: Record<string, any>;
}) {
  const { eventId, timingConfiguration } = params;
  const contestIndex = timingConfiguration?.contestIndex || timingConfiguration?.contestByUuid || {};
  const splitIndex = timingConfiguration?.splitIndex || {};
  const splitByContest = splitIndex?.byContest || timingConfiguration?.splitsByContest || {};
  const timingPointIndex = timingConfiguration?.timingPointIndex || {
    byContest: timingConfiguration?.timingPointsByContest || {},
    byUuid: timingConfiguration?.timingPointByUuid || {},
    list: Array.isArray(timingConfiguration?.timingPoints) ? timingConfiguration.timingPoints : [],
  };
  const ageGroupIndex = timingConfiguration?.ageGroupIndex || {
    byContest: timingConfiguration?.ageGroupsByContest || {},
    byUuid: timingConfiguration?.ageGroupByUuid || {},
    list: Array.isArray(timingConfiguration?.ageGroups) ? timingConfiguration.ageGroups : [],
  };
  const legIndex = timingConfiguration?.legIndex || {
    byContest: timingConfiguration?.legsByContest || {},
    byUuid: timingConfiguration?.legByUuid || {},
    list: Array.isArray(timingConfiguration?.legs) ? timingConfiguration.legs : [],
  };

  await putKV(`live:event:${eventId}:timingConfiguration`, timingConfiguration, 'cloud-event-sync');
  await putKV(`live:event:${eventId}:contest:index`, contestIndex, 'cloud-event-sync');
  await putKV(`live:event:${eventId}:timingPoint:index`, timingPointIndex, 'cloud-event-sync');
  await putKV(`live:event:${eventId}:split:index`, splitByContest, 'cloud-event-sync');
  await putKV(`live:event:${eventId}:leg:index`, legIndex, 'cloud-event-sync');
  await putKV(`live:event:${eventId}:ageGroup:index`, ageGroupIndex, 'cloud-event-sync');
}

function buildScopedSplitKey(row: any) {
  const contestScope = extractContestCandidates(row)[0] || 'unscoped';
  const splitUuid = normalize(row?.UUID || row?.uuid || row?.splitUuid || row?.split_uuid || row?.id);
  const splitName = normalize(row?.Name || row?.name || row?.Label || row?.label || row?.splitName || row?.split_name);
  const order = normalize(row?.Order || row?.order || row?.Index || row?.index || '');
  const distance = normalize(row?.DistanceFromStart || row?.distanceFromStart || row?.distance || row?.meters || '');
  const leaf = splitUuid || `${splitName}::${order}::${distance}`;
  return `${contestScope}::${leaf}`;
}

function rowBelongsToContest(row: any, contest: any) {
  const contestUuid = normalize(contest?.contestUuid || contest?.UUID || contest?.uuid || contest?.id);
  const contestNameKey = normalizeMatchKey(contest?.contestName || contest?.name || contest?.label || '');
  const rowContestCandidates = extractContestCandidates(row);
  if (contestUuid && rowContestCandidates.includes(contestUuid)) return true;

  const rowContestNames = [
    row?.contestName,
    row?.contest_name,
    row?.ContestName,
    row?.contest,
    row?.Contest,
    row?.contestLabel,
    row?.contest_title,
    row?.category,
    row?.categoryName,
    row?.category_name,
  ]
    .map((v) => normalizeMatchKey(v))
    .filter(Boolean);

  return !!contestNameKey && rowContestNames.includes(contestNameKey);
}

function classifyError(status: number, payload: any, message?: string) {
  const raw = `${JSON.stringify(payload || {})} ${String(message || '')}`.toLowerCase();
  if (status === 429) return { type: 'rate_limit', label: 'Rate Limit', explanation: 'Feibot rate limit reached.' };
  if (status >= 500) return { type: 'server_error', label: 'Server Error', explanation: 'Feibot returned a server error.' };
  if (status === 401) return { type: 'authentication_error', label: 'Authentication Error', explanation: 'Access key, signature, or timestamp was rejected.' };
  if (status === 403) {
    if (raw.includes('not enabled') || raw.includes('disabled') || raw.includes('permission')) {
      return { type: 'permission_error', label: 'Permission Error', explanation: 'The endpoint is not enabled or the account lacks permission.' };
    }
    return { type: 'permission_error', label: 'Permission Error', explanation: 'Feibot rejected access to this endpoint.' };
  }
  if (status === 404 || raw.includes('invalid event') || raw.includes('event uuid') || raw.includes('cloud uuid')) {
    return { type: 'configuration_error', label: 'Configuration Error', explanation: 'Event configuration is invalid or incomplete.' };
  }
  return { type: 'unknown_error', label: 'Feibot API Error', explanation: 'The upstream request failed.' };
}

export function buildFeibotErrorReport(params: {
  workerStatus?: number | null;
  workerBody?: any;
  feibotStatus?: number | null;
  method: string;
  path: string;
  eventUuid?: string | null;
  cloudUuid?: string | null;
  timestamp?: number | string | null;
  sortedQuery?: string | null;
  stringToSign?: string | null;
  maskedHeaders?: Record<string, string> | null;
  responseBody?: any;
  generatedSignature?: string | null;
}) {
  const feibotStatus = Number(params.feibotStatus || 0);
  const workerStatus = Number(params.workerStatus || 0);
  const classification = classifyError(feibotStatus || workerStatus, params.responseBody || params.workerBody, undefined);
  const query = normalize(params.sortedQuery);
  const endpoint = `${params.method.toUpperCase()} ${params.path}`;
  const reasons: string[] = [];

  if (classification.type === 'permission_error') {
    reasons.push('Feature disabled for this event');
    reasons.push('Incorrect endpoint');
    reasons.push('Missing permissions');
    reasons.push('Invalid Event UUID');
  } else if (classification.type === 'authentication_error') {
    reasons.push('Invalid signature');
    reasons.push('Invalid access key');
    reasons.push('Timestamp expired');
  } else if (classification.type === 'configuration_error') {
    reasons.push('Invalid event UUID');
    reasons.push('Cloud UUID missing');
    reasons.push('Contest not configured');
  } else if (classification.type === 'rate_limit') {
    reasons.push('Retry after a short delay');
  }

  return {
    title: classification.label,
    reason: `${classification.explanation}${feibotStatus ? ` (HTTP ${feibotStatus})` : ''}`,
    worker: workerStatus
      ? {
          status: workerStatus,
          body: params.workerBody ?? null,
        }
      : null,
    feibot: {
      status: feibotStatus || null,
      method: params.method.toUpperCase(),
      path: params.path,
      endpoint,
      query,
      eventUuid: normalize(params.eventUuid) || null,
      cloudUuid: normalize(params.cloudUuid) || null,
      timestamp: params.timestamp ? String(params.timestamp) : null,
      stringToSign: normalize(params.stringToSign) || null,
      generatedSignature: normalize(params.generatedSignature) || null,
      headers: params.maskedHeaders || null,
      responseBody: params.responseBody ?? null,
    },
    suggestions: reasons,
  };
}

function extractEventName(payload: any, fallbackName?: string | null) {
  return normalize(
    payload?.event_name ||
      payload?.eventName ||
      payload?.name ||
      payload?.timing_rules?.event_name ||
      payload?.timing_rules?.eventName ||
      fallbackName ||
      '',
  ) || fallbackName || null;
}

function extractEntities(payload: any) {
  const rawContests = asArray(payload?.contests).concat(asArray(payload?.timing_rules?.contests));
  const rawTimingPoints = asArray(payload?.timing_points)
    .concat(asArray(payload?.timingPoints))
    .concat(asArray(payload?.timing_rules?.timing_points))
    .concat(asArray(payload?.timing_rules?.timingPoints));
  const rawSplits = asArray(payload?.splits).concat(asArray(payload?.timing_rules?.splits));
  const rawAgeGroups = asArray(payload?.age_groups)
    .concat(asArray(payload?.ageGroups))
    .concat(asArray(payload?.timing_rules?.age_groups))
    .concat(asArray(payload?.timing_rules?.ageGroups));
  const rawDevices = asArray(payload?.timing_devices)
    .concat(asArray(payload?.devices))
    .concat(asArray(payload?.timing_rules?.devices));

  const contests = uniqueByKey(
    rawContests,
    (row) => normalize((row as any)?.UUID || (row as any)?.uuid || (row as any)?.contestUuid || (row as any)?.contest_uuid || (row as any)?.id),
  );
  const timingPoints = uniqueByKey(
    rawTimingPoints,
    (row) => normalize((row as any)?.UUID || (row as any)?.uuid || (row as any)?.timingPointUuid || (row as any)?.timing_point_uuid || (row as any)?.id),
  );
  const splits = uniqueByKey(
    rawSplits,
    (row) => buildScopedSplitKey(row),
  );
  const ageGroups = uniqueByKey(
    rawAgeGroups,
    (row) => normalize((row as any)?.UUID || (row as any)?.uuid || (row as any)?.ageGroupUuid || (row as any)?.age_group_uuid || (row as any)?.id),
  );
  const devices = uniqueByKey(
    rawDevices,
    (row) => normalize((row as any)?.UUID || (row as any)?.uuid || (row as any)?.deviceUuid || (row as any)?.device_uuid || (row as any)?.id),
  );

  return {
    contests,
    timingPoints,
    splits,
    ageGroups,
    devices,
    rawContests,
    rawTimingPoints,
    rawSplits,
    rawAgeGroups,
    rawDevices,
  };
}

function normalizeMatchKey(value: unknown) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeEpochTimestamp(value: unknown) {
  const text = normalize(value);
  if (!text) return 0;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function extractRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const visited = new Set<any>();
  const likelyKeys = ['participants', 'rows', 'data', 'results', 'result', 'list', 'items', 'records', 'athletes', 'entries'];

  const isObjectRow = (value: unknown) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const asObjectRows = (value: unknown) =>
    Array.isArray(value)
      ? (value as any[]).filter((row) => isObjectRow(row))
      : [];

  const walk = (node: any): any[] => {
    if (!node || typeof node !== 'object') return [];
    if (visited.has(node)) return [];
    visited.add(node);

    if (Array.isArray(node)) {
      const objectRows = asObjectRows(node);
      if (objectRows.length > 0) return objectRows;
      for (const child of node) {
        const fromChild = walk(child);
        if (fromChild.length > 0) return fromChild;
      }
      return [];
    }

    for (const key of likelyKeys) {
      const direct = (node as any)?.[key];
      const directRows = asObjectRows(direct);
      if (directRows.length > 0) return directRows;
      if (direct && typeof direct === 'object') {
        const nestedRows = walk(direct);
        if (nestedRows.length > 0) return nestedRows;
      }
    }

    const values = Object.values(node as Record<string, any>);

    const objectMapRows = values.filter((value) => isObjectRow(value)) as Record<string, any>[];
    if (objectMapRows.length >= 10) {
      const participantLikeCount = objectMapRows.filter((row) => {
        const hasIdentity = Boolean(
          row?.participant_uuid
          || row?.participantUuid
          || row?.uuid
          || row?.id
          || row?.bib
          || row?.bib_number,
        );
        const hasName = Boolean(row?.name || row?.participant_name || row?.athlete_name || row?.full_name);
        const hasContest = Boolean(row?.contest_uuid || row?.contestUuid || row?.contest_name || row?.contestName);
        return hasIdentity || hasName || hasContest;
      }).length;
      if (participantLikeCount >= Math.ceil(objectMapRows.length * 0.6)) {
        return objectMapRows;
      }
    }

    let largestArray: any[] = [];
    for (const value of values) {
      if (Array.isArray(value)) {
        const objectRows = asObjectRows(value);
        if (objectRows.length > largestArray.length) largestArray = objectRows;
      }
    }
    if (largestArray.length > 0) return largestArray;

    for (const value of values) {
      const nestedRows = walk(value);
      if (nestedRows.length > 0) return nestedRows;
    }

    return [];
  };

  return walk(payload);
}

const EXCLUDED_CLOUD_IMPORT_STATUSES = new Set([
  'cancelled',
  'canceled',
  'cancel',
  'deleted',
  'inactive',
  'withdrawn',
  'withdraw',
  'transferred',
  'transfer',
  'refunded',
  'refund',
  'dns',
  'did_not_start',
  'hidden',
  'duplicate',
]);

function rowParticipantUuid(row: any) {
  return normalize(row?.participant_uuid || row?.participantUuid || row?.uuid || row?.UUID || row?.id);
}

function rowContestUuid(row: any) {
  return normalize(row?.contest_uuid || row?.contestUuid || row?.contest?.uuid || row?.contest?.UUID || row?.contestId || row?.contest_id);
}

function rowBib(row: any) {
  return normalize(row?.bib || row?.bib_no || row?.bibNumber || row?.bib_number || row?.number || row?.no);
}

function rowChip(row: any) {
  return normalize(row?.chip || row?.chip_code || row?.chipCode || row?.chip_id || row?.chipId || row?.chipNumber || row?.chip_number);
}

function rowEmail(row: any) {
  return normalize(row?.email || row?.mail || row?.e_mail || row?.Email || '').toLowerCase();
}

function rowName(row: any) {
  return normalize(row?.name || row?.full_name || row?.fullName || row?.participant_name || row?.athlete_name || [row?.firstName || row?.first_name, row?.lastName || row?.last_name].filter(Boolean).join(' '));
}

function rowDob(row: any) {
  const raw = normalize(row?.dob || row?.birthday || row?.date_of_birth || row?.birthDate || row?.birth_date);
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
}

function rowStatus(row: any) {
  return normalize(row?.status || row?.providerStatus || row?.registrationStatus || row?.registration_status || row?.ticketStatus || row?.ticket_status).toLowerCase();
}

function isTrackableCloudRow(row: any) {
  const status = rowStatus(row);
  if (status && EXCLUDED_CLOUD_IMPORT_STATUSES.has(status)) return false;
  if (row?.deleted === true || row?.isDeleted === true || row?.hidden === true || row?.isHidden === true) return false;
  return true;
}

function preferredParticipantRow(a: any, b: any) {
  const score = (row: any) => {
    let s = 0;
    if (isTrackableCloudRow(row)) s += 50;
    if (rowBib(row)) s += 10;
    if (rowChip(row)) s += 10;
    if (rowEmail(row)) s += 10;
    if (rowName(row)) s += 10;
    if (rowContestUuid(row)) s += 10;
    return s;
  };

  return score(b) > score(a) ? b : a;
}

function uniqueRowsByParticipantUuid(rows: any[]) {
  const byUuid = new Map<string, any>();
  const withoutUuid: any[] = [];
  let merged = 0;

  for (const row of rows) {
    const participantUuid = rowParticipantUuid(row);
    if (!participantUuid) {
      withoutUuid.push(row);
      continue;
    }

    if (!byUuid.has(participantUuid)) {
      byUuid.set(participantUuid, row);
      continue;
    }

    merged += 1;
    byUuid.set(participantUuid, preferredParticipantRow(byUuid.get(participantUuid), row));
  }

  return {
    rows: [...byUuid.values(), ...withoutUuid],
    merged,
  };
}

function duplicateGroups(rows: any[], keyFn: (row: any) => string, label: string, limit = 200) {
  const map = new Map<string, any[]>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)?.push(row);
  }

  const groups = Array.from(map.entries())
    .filter(([, group]) => group.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, limit)
    .map(([key, group]) => ({
      key,
      count: group.length,
      contestUuids: Array.from(new Set(group.map((row) => rowContestUuid(row)).filter(Boolean))),
      bibs: Array.from(new Set(group.map((row) => rowBib(row)).filter(Boolean))).slice(0, 10),
      emails: Array.from(new Set(group.map((row) => rowEmail(row)).filter(Boolean))).slice(0, 10),
      participantUuids: Array.from(new Set(group.map((row) => rowParticipantUuid(row)).filter(Boolean))).slice(0, 10),
    }));

  return {
    label,
    duplicateGroups: groups.length,
    samples: groups,
  };
}

function analyzeCloudParticipantRows(rows: any[]) {
  const byParticipantUuid = duplicateGroups(rows, (row) => rowParticipantUuid(row), 'participant_uuid');
  const byBib = duplicateGroups(rows, (row) => rowBib(row), 'bib');
  const byEmail = duplicateGroups(rows, (row) => rowEmail(row), 'email');
  const byChip = duplicateGroups(rows, (row) => rowChip(row), 'chip_code');
  const byContestAndEmail = duplicateGroups(rows, (row) => {
    const contest = rowContestUuid(row);
    const email = rowEmail(row);
    return contest && email ? `${contest}::${email}` : '';
  }, 'contest_uuid + email');
  const byContestAndUuid = duplicateGroups(rows, (row) => {
    const contest = rowContestUuid(row);
    const uuid = rowParticipantUuid(row);
    return contest && uuid ? `${contest}::${uuid}` : '';
  }, 'contest_uuid + participant_uuid');

  const athleteMultiContest = duplicateGroups(rows, (row) => {
    const email = rowEmail(row);
    if (email) return `email:${email}`;
    const name = rowName(row);
    const dob = rowDob(row);
    return name && dob ? `name_dob:${name.toLowerCase()}|${dob}` : '';
  }, 'athlete identity');

  const statusCounts: Record<string, number> = {};
  for (const row of rows) {
    const status = rowStatus(row) || 'unknown';
    statusCounts[status] = Number(statusCounts[status] || 0) + 1;
  }

  const trackableRows = rows.filter((row) => isTrackableCloudRow(row));
  const uniqueByUuid = uniqueRowsByParticipantUuid(trackableRows);

  return {
    totalRows: rows.length,
    trackableRows: trackableRows.length,
    excludedRows: rows.length - trackableRows.length,
    uniqueParticipantRows: uniqueByUuid.rows.length,
    mergedByParticipantUuid: uniqueByUuid.merged,
    statusCounts,
    byParticipantUuid,
    byBib,
    byEmail,
    byChip,
    byContestAndEmail,
    byContestAndUuid,
    athleteMultiContest,
  };
}

function resolveDownloadUrl(payload: any) {
  return normalize(payload?.download_url || payload?.downloadUrl || payload?.url || '');
}

async function resolveDownloadPayload(payload: any) {
  const downloadUrl = resolveDownloadUrl(payload);
  if (!downloadUrl) return payload;

  const startedAt = Date.now();
  const response = await fetch(downloadUrl, { cache: 'no-store' });
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const responseText = await response.text();
  const downloadedBytes = Buffer.byteLength(responseText || '', 'utf8');
  const preview = String(responseText || '').slice(0, 500);

  let parsed: any = null;
  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsed = null;
  }

  const rootType = Array.isArray(parsed) ? 'array' : parsed && typeof parsed === 'object' ? 'object' : 'text';
  const rootKeys = rootType === 'object' ? Object.keys(parsed || {}).slice(0, 30) : [];
  const parsedRows = extractRows(parsed || responseText);

  const safeUrl = (() => {
    try {
      const url = new URL(downloadUrl);
      return `${url.origin}${url.pathname}`;
    } catch {
      return downloadUrl.slice(0, 180);
    }
  })();

  console.log('[FEIBOT PARTICIPANT IMPORT][DOWNLOAD INSPECT]', {
    downloadUrl: safeUrl,
    httpStatus: response.status,
    contentType,
    downloadedBytes,
    rootType,
    rootKeys,
    parsedRows: parsedRows.length,
    first500Chars: preview,
    durationMs: Date.now() - startedAt,
  });

  if (!response.ok) {
    throw new Error(`Unable to download Feibot payload (${response.status}) ${preview}`);
  }

  const deniedTokens = ['accessdenied', 'expiredtoken', 'request has expired', 'signaturedoesnotmatch'];
  const previewLower = preview.toLowerCase();
  if (deniedTokens.some((token) => previewLower.includes(token))) {
    throw new Error(`Feibot download URL appears expired or denied: ${preview}`);
  }

  if (contentType.includes('application/json')) {
    if (parsed !== null) return parsed;
    throw new Error(`Downloaded payload is marked JSON but failed to parse. Preview: ${preview}`);
  }

  if (parsed !== null) return parsed;
  return { raw: responseText };
}

function extractContestCandidates(row: any): string[] {
  const candidates = [
    row?.contestUuid,
    row?.contest_uuid,
    row?.ContestUUID,
    row?.ContestUuid,
    row?.contestId,
    row?.contest_id,
    row?.ContestID,
    row?.ContestId,
    row?.providerContestUuid,
    row?.provider_contest_uuid,
    row?.providerContestId,
    row?.splitContestUuid,
    row?.timingPointContestUuid,
    row?.ageGroupContestUuid,
    row?.deviceContestUuid,
    row?.Contest?.UUID,
    row?.Contest?.uuid,
    row?.contest?.uuid,
    row?.contest?.UUID,
  ]
    .map((v) => normalize(v))
    .filter(Boolean);

  const arrays = [
    ...(Array.isArray(row?.contestUuids) ? row.contestUuids : []),
    ...(Array.isArray(row?.contestUUIDs) ? row.contestUUIDs : []),
    ...(Array.isArray(row?.contest_ids) ? row.contest_ids : []),
    ...(Array.isArray(row?.contestIds) ? row.contestIds : []),
    ...(Array.isArray(row?.applicableContestUuids) ? row.applicableContestUuids : []),
    ...(Array.isArray(row?.applicableContests) ? row.applicableContests : []),
    ...(Array.isArray(row?.contest_list) ? row.contest_list : []),

  ]
    .map((v) => normalize(v))
    .filter(Boolean);

  return Array.from(new Set([...candidates, ...arrays]));
}

function buildContestPackages(entities: { contests: any[]; timingPoints: any[]; splits: any[]; ageGroups: any[]; devices: any[] }) {
  const contests = Array.isArray(entities.contests) ? entities.contests : [];
  const timingPoints = Array.isArray(entities.timingPoints) ? entities.timingPoints : [];
  const splits = Array.isArray(entities.splits) ? entities.splits : [];
  const ageGroups = Array.isArray(entities.ageGroups) ? entities.ageGroups : [];
  const devices = Array.isArray(entities.devices) ? entities.devices : [];

  const contestByUuid = new Map<string, any>();
  const contestByName = new Map<string, any>();

  const packaged = contests.map((contest: any, index: number) => {
    const uuid = normalize(contest?.UUID || contest?.uuid || contest?.contestUuid || contest?.contest_uuid || contest?.id || `contest-${index + 1}`);
    const name = normalize(contest?.name || contest?.contestName || contest?.contest_name || `Contest ${index + 1}`);
    const contestSplits = mergeUniqueRows(
      asArray(contest?.splits),
      asArray(contest?.timing_points),
      asArray(contest?.timingPoints),
    );
    const contestTimingPoints = mergeUniqueRows(
      asArray(contest?.timingPoints),
      asArray(contest?.timing_points),
    );
    const contestAgeGroups = mergeUniqueRows(
      asArray(contest?.ageGroups),
      asArray(contest?.age_groups),
    );
    const contestDevices = mergeUniqueRows(
      asArray(contest?.devices),
      asArray(contest?.timing_devices),
    );
    const packagedContest = {
      ...contest,
      contestUuid: uuid,
      contestName: name,
      providerContestUuid: normalize(contest?.providerContestUuid || uuid) || uuid,
      timingPoints: [...contestTimingPoints],
      splits: [...contestSplits],
      ageGroups: [...contestAgeGroups],
      devices: [...contestDevices],
      timingPointsCount: contestTimingPoints.length,
      splitsCount: contestSplits.length,
      ageGroupsCount: contestAgeGroups.length,
      devicesCount: contestDevices.length,
    };

    if (uuid) contestByUuid.set(uuid, packagedContest);
    const nameKey = normalizeMatchKey(name);
    if (nameKey) contestByName.set(nameKey, packagedContest);
    return packagedContest;
  });

  const findContest = (row: any) => {
    const candidateUuids = extractContestCandidates(row);
    for (const uuid of candidateUuids) {
      const found = contestByUuid.get(uuid);
      if (found) return found;
    }

    const candidateNames = [
      row?.contestName,
      row?.contest_name,
      row?.ContestName,
      row?.contest,
      row?.Contest,
      row?.contestLabel,
      row?.contest_title,
    ].map((v) => normalize(v)).filter(Boolean);

    for (const name of candidateNames) {
      const found = contestByName.get(normalizeMatchKey(name));
      if (found) return found;
    }

    return null;
  };

  const contestsWithSplits = new Set<string>();
  const timingPointContestMap = new Map<string, Set<string>>();

  const attachRows = (rows: any[], key: 'timingPoints' | 'splits' | 'ageGroups' | 'devices') => {
    for (const row of rows) {
      const target = findContest(row);
      if (!target) continue;
      const rowKey = normalize(row?.UUID || row?.uuid || row?.id || row?.name || row?.label);
      if (rowKey && !target[key].some((existing: any) => normalize(existing?.UUID || existing?.uuid || existing?.id || existing?.name || existing?.label) === rowKey)) {
        target[key].push(row);
      }
      if (key === 'splits') {
        contestsWithSplits.add(normalize(target.contestUuid));
        const timingPointUuid = normalize(row?.TimingPointUUID || row?.timingPointUUID || row?.timingPointUuid || row?.timing_point_uuid || row?.TimingPointId || row?.timingPointId || row?.timing_point_id);
        if (timingPointUuid) {
          if (!timingPointContestMap.has(timingPointUuid)) timingPointContestMap.set(timingPointUuid, new Set<string>());
          timingPointContestMap.get(timingPointUuid)?.add(normalize(target.contestUuid));
        }
      }
    }
  };

  attachRows(timingPoints, 'timingPoints');
  attachRows(splits, 'splits');
  attachRows(ageGroups, 'ageGroups');
  attachRows(devices, 'devices');

  const attachTimingPointByContestUuid = (contestUuid: string, row: any) => {
    const target = contestByUuid.get(contestUuid);
    if (!target) return;
    const rowKey = normalize(row?.UUID || row?.uuid || row?.id || row?.name || row?.label);
    if (rowKey && target.timingPoints.some((existing: any) => normalize(existing?.UUID || existing?.uuid || existing?.id || existing?.name || existing?.label) === rowKey)) {
      return;
    }
    target.timingPoints.push(row);
  };

  for (const row of timingPoints) {
    const directContest = findContest(row);
    if (directContest) {
      attachTimingPointByContestUuid(directContest.contestUuid, row);
      continue;
    }

    const timingPointUuid = normalize(row?.UUID || row?.uuid || row?.id || row?.timingPointUuid || row?.timingPointUUID || row?.timing_point_uuid);
    const linkedContests = timingPointContestMap.get(timingPointUuid);
    if (linkedContests && linkedContests.size > 0) {
      for (const contestUuid of linkedContests) {
        attachTimingPointByContestUuid(contestUuid, row);
      }
      continue;
    }

    if (contestsWithSplits.size > 0) {
      for (const contestUuid of contestsWithSplits) {
        attachTimingPointByContestUuid(contestUuid, row);
      }
      continue;
    }

    if (packaged.length === 1) {
      attachTimingPointByContestUuid(packaged[0].contestUuid, row);
    }
  }

  for (const contest of packaged) {
    contest.timingPointsCount = contest.timingPoints.length;
    contest.splitsCount = contest.splits.length;
    contest.ageGroupsCount = contest.ageGroups.length;
    contest.devicesCount = contest.devices.length;
  }

  return packaged;
}

async function syncFeibotCloudEventInfoInternal(params: {
  eventId: string;
  eventUuid?: string;
  apiBaseUrl?: string;
  scoreEventUuid?: string;
  triggeredBy?: string;
}) {
  const liveTrackingHub =
    (await getKV<Record<string, any>>(`live:event:${params.eventId}:hub`, 'cloud-event-sync')) ||
    {};
  const feibotConfig = (liveTrackingHub as any)?.feibotConfig || {};
  const cloudConfig = feibotConfig?.cloud || {};
  const scoreConfig = feibotConfig?.score || {};

  const eventUuid = normalize(params.eventUuid || cloudConfig?.eventUuid || feibotConfig?.eventUuid);
  const runtime = await getFeibotRuntimeSecretsAsyncForEvent({
    eventId: params.eventId,
    eventUuid,
    credentialType: 'auto',
  });
  const resolvedRuntime = resolveFeibotRuntimeEventUuid({
    endpoint: '/eventConfigFile/timingRulesGet',
    credentialType: runtime.credentialType,
    credentialBoundEventUuid: runtime.eventUuid || null,
    cloudEventUuid: eventUuid,
    manualEventUuid: params.eventUuid || null,
    requestedEventUuid: params.eventUuid || null,
  });
  const runtimeEventUuid = resolvedRuntime.resolvedEventUuid || eventUuid;
  const apiBaseUrl = normalize(params.apiBaseUrl || cloudConfig?.apiBaseUrl || feibotConfig?.apiBaseUrl || runtime.apiBaseUrl || 'https://apicn.feibot.com') || 'https://apicn.feibot.com';
  const scoreEventUuid = normalize(params.scoreEventUuid || scoreConfig?.eventUuid || runtimeEventUuid) || runtimeEventUuid;

  if (!runtimeEventUuid) {
    return {
      success: false,
      errorReport: buildFeibotErrorReport({
        method: 'GET',
        path: '/eventConfigFile/timingRulesGet',
        eventUuid: null,
        cloudUuid: scoreEventUuid || null,
        responseBody: { Err: 'Cloud API Event UUID missing' },
        feibotStatus: 400,
      }),
    };
  }

  const timing = await callFeibotAPIWithCredentialFallback<any>(
    '/eventConfigFile/timingRulesGet',
    { method: 'GET', query: { event_uuid: runtimeEventUuid } },
    { eventId: params.eventId, apiBaseUrl, credentialType: 'auto' },
  );

  if (!timing.ok) {
    return {
      success: false,
      errorReport: buildFeibotErrorReport({
        method: 'GET',
        path: '/eventConfigFile/timingRulesGet',
        eventUuid: runtimeEventUuid,
        cloudUuid: scoreEventUuid,
        feibotStatus: timing.status,
        timestamp: timing.diagnostics?.timestamp,
        sortedQuery: timing.diagnostics?.sortedQuery,
        stringToSign: timing.diagnostics?.stringToSign,
        maskedHeaders: timing.diagnostics?.masked,
        generatedSignature: `${String(timing.diagnostics?.requestSignature || '').slice(0, 8)}****`,
        responseBody: timing.data,
      }),
    };
  }

  const participants = await callFeibotAPIWithCredentialFallback<any>(
    '/temporary/participantsGetAll',
    { method: 'GET', query: { event_uuid: runtimeEventUuid } },
    { eventId: params.eventId, apiBaseUrl, credentialType: 'auto' },
  );

  if (!participants.ok) {
    return {
      success: false,
      errorReport: buildFeibotErrorReport({
        method: 'GET',
        path: '/temporary/participantsGetAll',
        eventUuid: runtimeEventUuid,
        cloudUuid: scoreEventUuid,
        feibotStatus: participants.status,
        timestamp: participants.diagnostics?.timestamp,
        sortedQuery: participants.diagnostics?.sortedQuery,
        stringToSign: participants.diagnostics?.stringToSign,
        maskedHeaders: participants.diagnostics?.masked,
        generatedSignature: `${String(participants.diagnostics?.requestSignature || '').slice(0, 8)}****`,
        responseBody: participants.data,
      }),
    };
  }

  const eventMetadata = await getKV<Record<string, any>>(`live:event:${params.eventId}:data`, 'cloud-event-sync');
  const eventName = extractEventName(timing.data, normalize((eventMetadata as any)?.eventName) || null);
  const timingConfiguration = await loadCanonicalTimingConfiguration(params.eventId);
  if (!timingConfiguration) {
    return {
      success: false,
      errorReport: buildFeibotErrorReport({
        method: 'GET',
        path: '/eventConfigFile/timingRulesGet',
        eventUuid,
        cloudUuid: scoreEventUuid,
        feibotStatus: 404,
        responseBody: { message: 'Canonical timingConfiguration snapshot missing' },
      }),
    };
  }

  const contestCount = Array.isArray(timingConfiguration.contests) ? timingConfiguration.contests.length : 0;
  const legCount = Array.isArray(timingConfiguration.legs) ? timingConfiguration.legs.length : 0;
  const splitCount = Array.isArray(timingConfiguration.splits) ? timingConfiguration.splits.length : 0;
  const timingPointCount = Array.isArray(timingConfiguration.timingPoints) ? timingConfiguration.timingPoints.length : 0;
  const ageGroupCount = Array.isArray(timingConfiguration.ageGroups) ? timingConfiguration.ageGroups.length : 0;
  const timingUpdatedAt = normalizeEpochTimestamp(timingConfiguration?.updatedAt || timingConfiguration?.meta?.updatedAt || timingConfiguration?.meta?.updated_at || Date.now());
  const contestNames = Array.isArray(timingConfiguration.contests)
    ? timingConfiguration.contests.map((contest: any) => normalize(contest?.contestName || contest?.name || contest?.Name)).filter(Boolean)
    : [];

  const timingRulesWereEmpty = isTimingRulesEmpty(timing.data);
  if (timingRulesWereEmpty) {
    console.warn('Timing rules empty.');
    console.warn('Existing KV preserved.');
  }

  console.log('[TimingConfiguration Write]', {
    writer: 'cloud-event-sync',
    source: 'Feibot',
    contestCount,
    legCount,
    splitCount,
    timingPointCount,
    contestNames,
    destination: `event:${params.eventId}:timingConfiguration`,
    note: 'read-only orchestrator using canonical KV snapshot',
  });

  let timingRulesStatus: 'rebuilt' | 'preserved' = 'preserved';
  if (!timingRulesWereEmpty) {
    await rebuildSplitIndexInKv({
      eventId: params.eventId,
      timingConfiguration: timingConfiguration as any,
      provider: 'feibot',
      generatedBy: 'cloud-event-sync',
      syncType: 'timing-rules-sync',
      sourceVersion: normalize(timingConfiguration?.meta?.version || timing.data?.timing_rules?.meta?.version || timing.data?.meta?.version || null) || null,
    });

    await rebuildCourseIndexInKv({
      eventId: params.eventId,
      timingConfiguration: timingConfiguration as any,
      provider: 'feibot',
      generatedBy: 'cloud-event-sync',
      syncType: 'timing-rules-sync',
      sourceVersion: normalize(timingConfiguration?.meta?.version || timing.data?.timing_rules?.meta?.version || timing.data?.meta?.version || null) || null,
    });

    await writeLiveTimingConfigurationIndexes({
      eventId: params.eventId,
      timingConfiguration: timingConfiguration as any,
    });

    timingRulesStatus = 'rebuilt';
    console.log('[FEIBOT TIMING RULES] Timing rules rebuilt', { eventId: params.eventId });
  } else {
    console.log('[FEIBOT TIMING RULES] Timing rules preserved', { eventId: params.eventId });
  }

  const lastSync = new Date().toISOString();
  const contestsWithWarnings: any[] = [];
  const contestValidationRows: any[] = [];

  const participantsPayload = await resolveDownloadPayload(participants.data);
  const participantRowsRaw = extractRows(participantsPayload);
  const rawAnalysis = analyzeCloudParticipantRows(participantRowsRaw);
  const filteredRows = participantRowsRaw.filter((row) => isTrackableCloudRow(row));
  const uniqueRows = uniqueRowsByParticipantUuid(filteredRows);
  const participantRows = uniqueRows.rows;
  const downloadedParticipantsCount = participantRowsRaw.length;
  const participantsCount = participantRows.length;

  console.log('[FEIBOT PARTICIPANT IMPORT][STEP 1] Download complete', {
    eventId: params.eventId,
    source: 'feibot-cloud-api',
    hasDownloadUrl: Boolean(resolveDownloadUrl(participants.data)),
  });
  console.log('[FEIBOT PARTICIPANT IMPORT][STEP 2] Participant Count', {
    eventId: params.eventId,
    participantRows: downloadedParticipantsCount,
    trackableRows: filteredRows.length,
    uniqueParticipantRows: participantsCount,
    mergedByParticipantUuid: uniqueRows.merged,
  });

  const { participants: staticParticipants, participantIndexPayload, stats: participantImportStats } = await buildFeibotParticipantImport({
    eventId: params.eventId,
    source: 'feibot-cloud-api',
    provider: 'feibot',
    rawParticipants: participantRows,
    timingConfiguration: timingConfiguration as any,
    contestIndex: timingConfiguration.contestIndex as any,
    ageGroupIndex: timingConfiguration.ageGroupIndex as any,
    generatedAt: new Date().toISOString(),
  });

  const matchedUsersCount = Number(participantImportStats.matchedUsers || 0);
  console.log('[FEIBOT PARTICIPANT IMPORT][STEP 3] Normalized', {
    eventId: params.eventId,
    normalized: Number(participantImportStats.normalized || staticParticipants.length),
  });
  console.log('[FEIBOT PARTICIPANT IMPORT][STEP 4] Matched Users', {
    eventId: params.eventId,
    matchedUsers: matchedUsersCount,
  });
  console.log('[FEIBOT PARTICIPANT IMPORT][STEP 4.1] User lookup failures', {
    eventId: params.eventId,
    userLookupFailures: Number(participantImportStats.userLookupFailures || 0),
    participantFailures: Number(participantImportStats.participantFailures || 0),
    excludedByStatus: Number(participantImportStats.excludedByStatus || 0),
    duplicateByParticipantUuid: Number(participantImportStats.duplicateByParticipantUuid || 0),
    duplicateByProviderUuid: Number(participantImportStats.duplicateByProviderUuid || 0),
    duplicateByBookingId: Number(participantImportStats.duplicateByBookingId || 0),
  });
  console.log('[FEIBOT PARTICIPANT IMPORT][STEP 5] Writing timingParticipant', {
    eventId: params.eventId,
    count: staticParticipants.length,
  });

  for (const participant of staticParticipants) {
    const bookingId = String(participant.bookingId || '').trim();
    const participantUuid = String(participant.participantUuid || bookingId || '').trim();
    if (!participantUuid) continue;

    await putKV(`live:event:${params.eventId}:participant:${participantUuid}`, participant, 'cloud-event-sync');

    const bib = String(participant.bib || '').trim();
    const providerUuid = String(participant.providerUuid || '').trim();
    const athleteUid = String(participant.athleteUid || '').trim();
    const chip = String(participant.chip || '').trim();
    const email = String(participant.email || '').trim().toLowerCase();

    if (bib) await putKV(`live:event:${params.eventId}:lookup:bib:${bib}`, participantUuid, 'cloud-event-sync');
    if (providerUuid) await putKV(`live:event:${params.eventId}:lookup:provider:${providerUuid}`, participantUuid, 'cloud-event-sync');
    if (athleteUid) await putKV(`live:event:${params.eventId}:lookup:user:${athleteUid}`, participantUuid, 'cloud-event-sync');
    if (chip) await putKV(`live:event:${params.eventId}:lookup:chip:${chip}`, participantUuid, 'cloud-event-sync');
    if (email) await putKV(`live:event:${params.eventId}:lookup:email:${email}`, participantUuid, 'cloud-event-sync');
  }

  await putKV(`live:event:${params.eventId}:participant:index`, participantIndexPayload, 'cloud-event-sync');
  const participantBibIndex = Object.fromEntries(Object.entries(participantIndexPayload.byBib || {}).map(([key, value]) => [key, value || null]));
  const participantUuidIndex = Object.fromEntries(Object.entries(participantIndexPayload.byUUID || {}).map(([key, value]) => [key, value || null]));
  const participantProviderUuidIndex = Object.fromEntries(Object.entries(participantIndexPayload.byProviderUuid || {}).map(([key, value]) => [key, value || null]));
  const participantEmailIndex = Object.fromEntries(Object.entries(participantIndexPayload.byEmail || {}).map(([key, value]) => [key, value || null]));
  const participantAthleteUidIndex = Object.fromEntries(Object.entries(participantIndexPayload.byAthleteUid || {}).map(([key, value]) => [key, value || null]));
  const participantNameIndex = Object.fromEntries(Object.entries(participantIndexPayload.byName || {}).map(([key, value]) => [key, value || null]));
  const participantChipIndex = Object.fromEntries(Object.entries(participantIndexPayload.byChip || {}).map(([key, value]) => [key, value || null]));
  await putKV(`live:event:${params.eventId}:participant:bib`, participantBibIndex, 'cloud-event-sync');
  await putKV(`live:event:${params.eventId}:participant:uuid`, participantUuidIndex, 'cloud-event-sync');
  await putKV(`live:event:${params.eventId}:participant:providerUuid`, participantProviderUuidIndex, 'cloud-event-sync');
  await putKV(`live:event:${params.eventId}:participant:email`, participantEmailIndex, 'cloud-event-sync');
  await putKV(`live:event:${params.eventId}:participant:athleteUid`, participantAthleteUidIndex, 'cloud-event-sync');
  await putKV(`live:event:${params.eventId}:participant:name`, participantNameIndex, 'cloud-event-sync');
  await putKV(`live:event:${params.eventId}:participant:chip`, participantChipIndex, 'cloud-event-sync');
  await putKV(`live:event:${params.eventId}:participant:contest`, participantIndexPayload.byContest, 'cloud-event-sync');
  await putKV(`live:event:${params.eventId}:participant:ageGroup`, participantIndexPayload.byAgeGroup, 'cloud-event-sync');
  console.log('[FEIBOT PARTICIPANT IMPORT][STEP 6] Writing participant:index', {
    eventId: params.eventId,
    participantIndexCount: Number(participantIndexPayload?.participantCount || 0),
  });

  for (const participant of staticParticipants) {
    const bookingId = String(participant.bookingId || '').trim();
    if (bookingId) {
      await putKV(`live:event:${params.eventId}:timingParticipant:${bookingId}`, participant, 'cloud-event-sync');
    }

    const participantUuid = String(participant.participantUuid || bookingId || '').trim();
    if (participantUuid) {
      await putKV(`live:event:${params.eventId}:live:${participantUuid}`, { updatedAt: lastSync, bookingId: bookingId || null }, 'cloud-event-sync');
    }
  }

  const providerParticipantsIndex = {
    provider: 'feibot',
    source: 'feibot-cloud-api',
    importTime: lastSync,
    downloadedCount: downloadedParticipantsCount,
    importedCount: staticParticipants.length,
    excludedCount: Math.max(downloadedParticipantsCount - staticParticipants.length, 0),
    participantCount: staticParticipants.length,
    byProviderUuid: participantProviderUuidIndex,
    byBib: participantBibIndex,
    byChip: participantChipIndex,
    byEmail: participantEmailIndex,
    byContest: participantIndexPayload.byContest || {},
    byAgeGroup: participantIndexPayload.byAgeGroup || {},
    duplicateStats: {
      duplicateByParticipantUuid: Number(participantImportStats.duplicateByParticipantUuid || 0),
      duplicateByProviderUuid: Number(participantImportStats.duplicateByProviderUuid || 0),
      duplicateByBookingId: Number(participantImportStats.duplicateByBookingId || 0),
      excludedByStatus: Number(participantImportStats.excludedByStatus || 0),
      mergedRawByParticipantUuid: Number(uniqueRows.merged || 0),
    },
    analysis: rawAnalysis,
  };

  const providerParticipantsPayload = {
    provider: 'feibot',
    source: 'feibot-cloud-api',
    importTime: lastSync,
    downloadedCount: downloadedParticipantsCount,
    importedCount: staticParticipants.length,
    excludedCount: Math.max(downloadedParticipantsCount - staticParticipants.length, 0),
    durationMs: Number(participants.diagnostics?.responseTimeMs || 0),
    mappingSummary: {
      totalProviderParticipants: staticParticipants.length,
      downloadedRows: downloadedParticipantsCount,
      excludedRows: Math.max(downloadedParticipantsCount - staticParticipants.length, 0),
      duplicateByParticipantUuid: Number(participantImportStats.duplicateByParticipantUuid || 0),
      duplicateByProviderUuid: Number(participantImportStats.duplicateByProviderUuid || 0),
      duplicateByBookingId: Number(participantImportStats.duplicateByBookingId || 0),
      mergedRawByParticipantUuid: Number(uniqueRows.merged || 0),
    },
    participants: staticParticipants,
  };

  await putKV(`live:event:${params.eventId}:providerParticipants`, providerParticipantsPayload, 'cloud-event-sync');
  await putKV(`live:event:${params.eventId}:providerParticipants:index`, providerParticipantsIndex, 'cloud-event-sync');

  console.log('[FEIBOT PARTICIPANT IMPORT][STEP 7] Import Complete', {
    eventId: params.eventId,
    source: 'feibot-cloud-api',
    downloadedRows: downloadedParticipantsCount,
    participantCount: staticParticipants.length,
    matchedUsers: matchedUsersCount,
    userLookupFailures: Number(participantImportStats.userLookupFailures || 0),
    duplicateByParticipantUuid: Number(participantImportStats.duplicateByParticipantUuid || 0),
    duplicateByProviderUuid: Number(participantImportStats.duplicateByProviderUuid || 0),
    duplicateByBookingId: Number(participantImportStats.duplicateByBookingId || 0),
    excludedByStatus: Number(participantImportStats.excludedByStatus || 0),
  });

  const snapshot = {
    status: 'connected',
    authentication: 'verified',
    provider: 'Feibot',
    source: 'feibot-cloud-api',
    eventId: params.eventId,
    eventUuid,
    cloudEventUuid: eventUuid,
    scoreEventUuid,
    eventName,
    updatedAt: timingUpdatedAt,
    apiBaseUrl,
    lastSync,
    contests: timingConfiguration.contests,
    contestsCount: contestCount,
    legsCount: legCount,
    timingPoints: timingConfiguration.timingPoints,
    timingPointsCount: timingPointCount,
    splits: timingConfiguration.splits,
    splitsCount: splitCount,
    ageGroups: timingConfiguration.ageGroups,
    ageGroupsCount: ageGroupCount,
    devices: timingConfiguration.devices,
    devicesCount: Array.isArray(timingConfiguration.devices) ? timingConfiguration.devices.length : 0,
    participantsCount: staticParticipants.length,
    downloadedParticipantsCount,
    categoryCount: contestCount,
    diagnostics: {
      timingRules: {
        status: timing.status,
        responseTimeMs: timing.diagnostics?.responseTimeMs || 0,
        timestamp: timing.diagnostics?.timestamp || null,
        stringToSign: timing.diagnostics?.stringToSign || null,
      },
      participants: {
        status: participants.status,
        responseTimeMs: participants.diagnostics?.responseTimeMs || 0,
        timestamp: participants.diagnostics?.timestamp || null,
        stringToSign: participants.diagnostics?.stringToSign || null,
        downloadedRows: downloadedParticipantsCount,
        importedRows: staticParticipants.length,
        excludedRows: Math.max(downloadedParticipantsCount - staticParticipants.length, 0),
        duplicateByParticipantUuid: Number(participantImportStats.duplicateByParticipantUuid || 0),
        duplicateByProviderUuid: Number(participantImportStats.duplicateByProviderUuid || 0),
        duplicateByBookingId: Number(participantImportStats.duplicateByBookingId || 0),
        excludedByStatus: Number(participantImportStats.excludedByStatus || 0),
        analysis: rawAnalysis,
      },
      timingValidation: {
        contests: contestValidationRows,
        warnings: contestsWithWarnings,
      },
      triggeredBy: params.triggeredBy || 'unknown',
      credentialsSource: runtime.source,
    },
  };

  await putKV(`live:event:${params.eventId}:hub`, {
    ...(liveTrackingHub || {}),
    cloudApiEventInfo: {
      status: 'connected',
      authentication: 'verified',
      provider: 'Feibot',
      eventUuid,
      cloudEventUuid: eventUuid,
      scoreEventUuid,
      eventName,
      lastSync,
      contestsCount: contestCount,
      legsCount: legCount,
      timingPointsCount: timingPointCount,
      splitsCount: splitCount,
      ageGroupsCount: ageGroupCount,
      devicesCount: Array.isArray(timingConfiguration.devices) ? timingConfiguration.devices.length : 0,
      participantsCount: staticParticipants.length,
      downloadedParticipantsCount,
      apiBaseUrl,
      timingRulesStatus,
    },
    feibotConfig: {
      ...(liveTrackingHub as any)?.feibotConfig || {},
      eventUuid,
      apiBaseUrl,
      cloud: {
        ...((liveTrackingHub as any)?.feibotConfig?.cloud || {}),
        eventUuid,
        apiBaseUrl,
        connected: true,
        authenticated: true,
        lastVerifiedAt: lastSync,
      },
      score: {
        ...((liveTrackingHub as any)?.feibotConfig?.score || {}),
        eventUuid: scoreEventUuid,
      },
    },
    providerDiagnostics: {
      ...((liveTrackingHub as any)?.providerDiagnostics || {}),
      responseTimeMs: Math.max(Number(timing.diagnostics?.responseTimeMs || 0), Number(participants.diagnostics?.responseTimeMs || 0)),
      lastSync,
      timingRulesStatus,
    },
    latestSnapshot: snapshot,
    updatedAt: new Date().toISOString(),
  }, 'cloud-event-sync');

  return { success: true, snapshot };
}

export async function syncFeibotCloudEventInfo(params: {
  eventId: string;
  eventUuid?: string;
  apiBaseUrl?: string;
  scoreEventUuid?: string;
  triggeredBy?: string;
}) {
  const syncKey = `${normalize(params.eventId)}::${normalize(params.eventUuid || '')}`;
  const existing = inFlightCloudSync.get(syncKey);
  if (existing) {
    console.log('[FEIBOT CLOUD SYNC] Reusing in-flight sync', {
      eventId: params.eventId,
      eventUuid: normalize(params.eventUuid || '') || null,
      triggeredBy: params.triggeredBy || 'unknown',
    });
    return existing;
  }

  const promise = syncFeibotCloudEventInfoInternal(params);
  inFlightCloudSync.set(syncKey, promise);
  try {
    return await promise;
  } finally {
    if (inFlightCloudSync.get(syncKey) === promise) {
      inFlightCloudSync.delete(syncKey);
    }
  }
}
