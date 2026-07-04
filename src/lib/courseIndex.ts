import { createHash } from 'crypto';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import type { ResolvedContestTiming, ResolvedTimingConfiguration, ResolvedTimingPoint } from '@/lib/timingConfiguration';

type AnyRecord = Record<string, any>;

export type CourseIndexContest = ResolvedContestTiming & {
  order: number;
  splitCount: number;
  timingPointCount: number;
  legCount: number;
  ageGroupCount: number;
  deviceCount: number;
  devices: Array<AnyRecord>;
  cutoffs: AnyRecord | null;
  courseDistanceKm: number;
  lookup: {
    splitByUuid: Record<string, AnyRecord>;
    timingPointByUuid: Record<string, ResolvedTimingPoint>;
    legByUuid: Record<string, AnyRecord>;
    ageGroupByUuid: Record<string, AnyRecord>;
    deviceByUuid: Record<string, AnyRecord>;
  };
};

export type CourseIndex = {
  version: number;
  provider: string;
  eventId: string;
  generatedAt: string;
  generatedBy: string;
  updatedAt: string;
  sourceProvider: string;
  sourceHash: string;
  sourceVersion: string | null;
  syncType: string;
  buildDurationMs: number;
  contestCount: number;
  splitCount: number;
  timingPointCount: number;
  legCount: number;
  ageGroupCount: number;
  deviceCount: number;
  courseDistanceKm: number;
  byContest: Record<string, CourseIndexContest>;
  byContestAndSplit: Record<string, AnyRecord>;
  contestLookup: Record<string, CourseIndexContest>;
  splitLookup: Record<string, AnyRecord>;
  timingPointLookup: Record<string, ResolvedTimingPoint>;
  legLookup: Record<string, AnyRecord>;
  ageGroupLookup: Record<string, AnyRecord>;
  deviceLookup: Record<string, AnyRecord>;
  contests: CourseIndexContest[];
  validation: {
    contestCount: number;
    splitCount: number;
    timingPointCount: number;
    legCount: number;
    ageGroupCount: number;
    deviceCount: number;
    missingReferences: number;
    duplicateKeys: number;
    status: 'PASS' | 'WARNING' | 'FAIL';
    errors: string[];
    warnings: string[];
  };
};

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalize(value: any) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeKey(value: any) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeLookupKey(value: any) {
  return normalize(value).toLowerCase();
}

function stableStringify(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function getContestUuid(contest: any, fallback: string) {
  return normalize(
    contest?.contestUuid ||
    contest?.uuid ||
    contest?.id ||
    contest?.contest?.contestUuid ||
    contest?.contest?.uuid ||
    contest?.contest?.id ||
    fallback,
  ) || fallback;
}

function getContestName(contest: any, fallback: string) {
  return normalize(
    contest?.contestName ||
    contest?.name ||
    contest?.contest?.contestName ||
    contest?.contest?.name ||
    fallback,
  ) || fallback;
}

function getRowUuid(row: any, fallback: string) {
  return normalize(
    row?.uuid ||
    row?.UUID ||
    row?.id ||
    row?.splitUuid ||
    row?.split_uuid ||
    row?.timingPointUuid ||
    row?.timingPointUUID ||
    row?.timing_point_uuid ||
    row?.legUuid ||
    row?.leg_uuid ||
    row?.ageGroupUuid ||
    row?.age_group_uuid ||
    row?.deviceUuid ||
    row?.device_uuid ||
    fallback,
  ) || fallback;
}

function buildLookup<T extends AnyRecord>(rows: T[], getKey: (row: T) => string) {
  const byUuid: Record<string, T> = {};
  const list: T[] = [];
  const seen = new Set<string>();

  for (const row of asArray(rows)) {
    const key = normalizeLookupKey(getKey(row));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    byUuid[key] = row;
    list.push(row);
  }

  return { byUuid, list };
}

function getCollectionRows(container: any, contestUuid: string, pluralKey: string) {
  if (!container) return [];
  const target = normalize(contestUuid).toLowerCase();
  const directKeys = [contestUuid, target, target.toUpperCase()];

  for (const source of [container, container?.byContest, container?.[pluralKey]]) {
    if (!source) continue;

    if (Array.isArray(source)) {
      const filtered = source.filter((row) => normalize(row?.contestUuid || row?.contest_uuid || row?.contest?.contestUuid || row?.contest?.uuid || row?.contest?.id || '').toLowerCase() === target);
      if (filtered.length > 0) return filtered;
      continue;
    }

    for (const key of directKeys) {
      const rows = source[key];
      if (Array.isArray(rows) && rows.length > 0) return rows;
    }

    const contestIndexEntry = source.contestIndex && typeof source.contestIndex === 'object'
      ? source.contestIndex[target] || source.contestIndex[contestUuid] || null
      : null;
    if (contestIndexEntry && Array.isArray(contestIndexEntry?.[pluralKey]) && contestIndexEntry[pluralKey].length > 0) {
      return contestIndexEntry[pluralKey];
    }
  }

  return [];
}

function collectContestEntries(timingConfiguration: ResolvedTimingConfiguration) {
  const fromIndex = asArray(Object.values(timingConfiguration?.contestIndex || timingConfiguration?.contestByUuid || {}));
  if (fromIndex.length > 0) return fromIndex;
  return asArray(timingConfiguration?.contests).map((contest: any, index: number) => ({
    id: normalize(contest?.id || contest?.uuid || contest?.contestUuid || `contest-${index + 1}`),
    uuid: normalize(contest?.uuid || contest?.contestUuid || contest?.id || `contest-${index + 1}`),
    contestUuid: normalize(contest?.contestUuid || contest?.uuid || contest?.id || `contest-${index + 1}`),
    contestName: getContestName(contest, `Contest ${index + 1}`),
    name: getContestName(contest, `Contest ${index + 1}`),
    providerUuid: normalize(contest?.providerUuid || contest?.UUID || contest?.uuid || contest?.id || '') || null,
    provider: normalize(contest?.provider || timingConfiguration?.provider || '') || null,
    color: normalize(contest?.color || contest?.contestColor || contest?.colour || '') || null,
    distance: Number(contest?.distance ?? contest?.Distance ?? contest?.distanceMeters ?? contest?.distance_meters ?? null) || null,
    startTime: normalize(contest?.startTime || contest?.start_time || '') || null,
    status: normalize(contest?.status || '') || null,
    contest: contest || {},
    splits: asArray(contest?.splits),
    timingPoints: asArray(contest?.timingPoints),
    ageGroups: asArray(contest?.ageGroups),
    legs: asArray(contest?.legs),
    participants: asArray(contest?.participants),
    leaderboard: asArray(contest?.leaderboard),
    statistics: contest?.statistics || {},
  }));
}

function buildContestCourseEntry(params: {
  contest: ResolvedContestTiming;
  index: number;
  timingConfiguration: ResolvedTimingConfiguration;
}) {
  const contest = params.contest || ({} as ResolvedContestTiming);
  const contestUuid = getContestUuid(contest, `contest-${params.index + 1}`);
  const contestName = getContestName(contest, contestUuid);
  const timingConfiguration = params.timingConfiguration;

  const splits = getCollectionRows(timingConfiguration, contestUuid, 'splits');
  const timingPoints = getCollectionRows(timingConfiguration, contestUuid, 'timingPoints');
  const ageGroups = getCollectionRows(timingConfiguration, contestUuid, 'ageGroups');
  const legs = getCollectionRows(timingConfiguration, contestUuid, 'legs');
  const devices = getCollectionRows(timingConfiguration, contestUuid, 'devices');
  const cutoffs = (contest as any)?.cutoffs || (contest as any)?.courseMaps?.cutoffs || null;

  const splitLookup = buildLookup(splits as AnyRecord[], (row) => getRowUuid(row, `${contestUuid}:split:${params.index + 1}`));
  const timingPointLookup = buildLookup(timingPoints as ResolvedTimingPoint[], (row) => normalize((row as any)?.id || (row as any)?.uuid || (row as any)?.canonicalUuid || `${contestUuid}:tp:${params.index + 1}`));
  const ageGroupLookup = buildLookup(ageGroups as AnyRecord[], (row) => getRowUuid(row, `${contestUuid}:age:${params.index + 1}`));
  const legLookup = buildLookup(legs as AnyRecord[], (row) => getRowUuid(row, `${contestUuid}:leg:${params.index + 1}`));
  const deviceLookup = buildLookup(devices as AnyRecord[], (row) => getRowUuid(row, `${contestUuid}:device:${params.index + 1}`));

  return {
    ...contest,
    contestUuid,
    contestName,
    name: contestName,
    splits,
    timingPoints,
    ageGroups,
    legs,
    devices,
    cutoffs,
    courseDistanceKm: Number((splits as AnyRecord[]).reduce((sum, split) => sum + Number(split?.distanceKm ?? split?.distance_km ?? split?.distance ?? 0), 0) || 0),
    participants: asArray(contest.participants),
    leaderboard: asArray(contest.leaderboard),
    statistics: contest.statistics || {},
    order: params.index,
    splitCount: splits.length,
    timingPointCount: timingPoints.length,
    legCount: legs.length,
    ageGroupCount: ageGroups.length,
    deviceCount: devices.length,
    lookup: {
      splitByUuid: splitLookup.byUuid,
      timingPointByUuid: timingPointLookup.byUuid,
      legByUuid: legLookup.byUuid,
      ageGroupByUuid: ageGroupLookup.byUuid,
      deviceByUuid: deviceLookup.byUuid,
    },
  } as unknown as CourseIndexContest;
}

export function buildCourseIndex(input: {
  eventId: string;
  timingConfiguration: ResolvedTimingConfiguration;
  provider?: string | null;
  generatedBy?: string;
  syncType?: string;
  sourceVersion?: string | null;
  previousVersion?: number | null;
  generatedAt?: string;
}) {
  const startedAt = Date.now();
  const contestEntries = collectContestEntries(input.timingConfiguration || ({} as ResolvedTimingConfiguration));
  const contestCourseEntries = contestEntries.map((contest, index) => buildContestCourseEntry({ contest: contest as ResolvedContestTiming, index, timingConfiguration: input.timingConfiguration }));

  const byContest: Record<string, CourseIndexContest> = {};
  const contestLookup: Record<string, CourseIndexContest> = {};
  const byContestAndSplit: Record<string, AnyRecord> = {};
  const splitLookup: Record<string, AnyRecord> = {};
  const timingPointLookup: Record<string, ResolvedTimingPoint> = {};
  const legLookup: Record<string, AnyRecord> = {};
  const ageGroupLookup: Record<string, AnyRecord> = {};
  const deviceLookup: Record<string, AnyRecord> = {};
  const uniqueContestKeys = new Set<string>();
  let splitCount = 0;
  let timingPointCount = 0;
  let legCount = 0;
  let ageGroupCount = 0;
  let deviceCount = 0;
  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];

  contestCourseEntries.forEach((contest, index) => {
    const contestUuid = normalize(contest.contestUuid || `contest-${index + 1}`);
    const contestKey = normalizeLookupKey(contestUuid) || normalizeKey(contestUuid) || `contest-${index + 1}`;
    if (uniqueContestKeys.has(contestKey)) return;
    uniqueContestKeys.add(contestKey);

    const contestWithSplitRefs = {
      ...contest,
      splits: contest.splits.map((split: AnyRecord) => {
        const splitUuid = getRowUuid(split, `${contestUuid}:split:${splitCount + 1}`);
        const splitKey = normalizeLookupKey(splitUuid);
        const timingPointUuid = normalize(split?.timingPointUuid || split?.timing_point_uuid || split?.timingPoint?.uuid || split?.timingPoint?.UUID || split?.timingPoint?.id || split?.timingPointId || split?.timingPointID || '');
        const normalizedSplit = {
          ...split,
          splitUuid,
          timingPointUuid: timingPointUuid || null,
        };
        if (splitKey) {
          splitLookup[splitKey] = normalizedSplit;
          byContestAndSplit[`${contestKey}:${splitKey}`] = normalizedSplit;
        }
        splitCount += 1;
        return normalizedSplit;
      }),
      timingPoints: contest.timingPoints.map((point: ResolvedTimingPoint) => {
        const pointKey = normalizeLookupKey((point as any)?.id || (point as any)?.uuid || (point as any)?.canonicalUuid || '');
        if (pointKey) timingPointLookup[pointKey] = point;
        timingPointCount += 1;
        return point;
      }),
      legs: contest.legs,
      lookup: {
        ...contest.lookup,
        legByUuid: contest.lookup?.legByUuid || {},
      },
      ageGroups: contest.ageGroups.map((ageGroup: AnyRecord) => {
        const ageGroupUuid = getRowUuid(ageGroup, `${contestUuid}:age:${ageGroupCount + 1}`);
        const ageGroupKey = normalizeLookupKey(ageGroupUuid);
        const normalizedAgeGroup = { ...ageGroup, ageGroupUuid };
        if (ageGroupKey) ageGroupLookup[ageGroupKey] = normalizedAgeGroup;
        ageGroupCount += 1;
        return normalizedAgeGroup;
      }),
      devices: contest.devices.map((device: AnyRecord) => {
        const deviceUuid = getRowUuid(device, `${contestUuid}:device:${deviceCount + 1}`);
        const deviceKey = normalizeLookupKey(deviceUuid);
        const normalizedDevice = { ...device, deviceUuid };
        if (deviceKey) deviceLookup[deviceKey] = normalizedDevice;
        deviceCount += 1;
        return normalizedDevice;
      }),
      participants: asArray(contest.participants),
      leaderboard: asArray(contest.leaderboard),
      statistics: contest.statistics || {},
    } as CourseIndexContest;

    Object.entries(contest.lookup?.legByUuid || {}).forEach(([legKey, leg]) => {
      const normalizedLegKey = normalizeLookupKey(legKey);
      if (!normalizedLegKey) return;
      if (!legLookup[normalizedLegKey]) {
        legLookup[normalizedLegKey] = leg as AnyRecord;
        legCount += 1;
      }
    });

    contestCourseEntries[index] = contestWithSplitRefs;
    byContest[contestUuid] = contestWithSplitRefs;
    contestLookup[contestKey] = contestWithSplitRefs;

    const contestNameKey = normalizeLookupKey(contestWithSplitRefs.contestName);
    if (contestNameKey && !contestLookup[contestNameKey]) contestLookup[contestNameKey] = contestWithSplitRefs;

    contestWithSplitRefs.splits.forEach((split: AnyRecord) => {
      const splitUuid = normalize(split?.splitUuid || split?.uuid || split?.id || '');
      if (!splitUuid) {
        validationWarnings.push(`Missing split UUID for contest ${contestWithSplitRefs.contestName}`);
        return;
      }
      const splitKey = normalizeLookupKey(splitUuid);
      if (!splitKey) return;
      splitLookup[splitKey] = split;
    });
  });

  const contestCount = Object.keys(byContest).length;
  const courseDistanceKm = contestCourseEntries.reduce((sum, contest) => sum + Number(contest.courseDistanceKm || 0), 0);
  const validationStatus: CourseIndex['validation']['status'] = contestCount === 0 || splitCount === 0 ? 'FAIL' : validationWarnings.length > 0 ? 'WARNING' : 'PASS';
  if (contestCount === 0) validationErrors.push('Course index has no contests');
  if (splitCount === 0) validationErrors.push('Course index has no splits');

  const sourceSeed = {
    eventId: input.eventId,
    provider: input.provider || input.timingConfiguration?.provider || 'feibot',
    generatedBy: input.generatedBy || 'course-index',
    syncType: input.syncType || 'course-index',
    sourceVersion: input.sourceVersion || input.timingConfiguration?.meta?.version || null,
    contestCount,
    splitCount,
    timingPointCount,
    legCount,
    ageGroupCount,
    deviceCount,
    contests: contestCourseEntries.map((contest) => ({
      contestUuid: contest.contestUuid,
      contestName: contest.contestName,
      splitCount: contest.splitCount,
      timingPointCount: contest.timingPointCount,
      legCount: contest.legCount,
      ageGroupCount: contest.ageGroupCount,
      deviceCount: contest.deviceCount,
    })),
  };

  const sourceHash = sha256(stableStringify(sourceSeed));
  const previousVersion = Number(input.previousVersion || 0);

  return {
    version: previousVersion + 1,
    provider: input.provider || input.timingConfiguration?.provider || 'feibot',
    eventId: input.eventId,
    generatedAt: input.generatedAt || new Date().toISOString(),
    generatedBy: input.generatedBy || 'course-index',
    updatedAt: input.generatedAt || new Date().toISOString(),
    sourceProvider: input.timingConfiguration?.provider || input.provider || 'feibot',
    sourceHash,
    sourceVersion: input.sourceVersion || input.timingConfiguration?.meta?.version || null,
    syncType: input.syncType || 'course-index',
    buildDurationMs: Date.now() - startedAt,
    contestCount,
    splitCount,
    timingPointCount,
    legCount,
    ageGroupCount,
    deviceCount,
    courseDistanceKm,
    byContest,
    byContestAndSplit,
    contestLookup,
    splitLookup,
    timingPointLookup,
    legLookup,
    ageGroupLookup,
    deviceLookup,
    contests: contestCourseEntries,
    validation: {
      contestCount,
      splitCount,
      timingPointCount,
      legCount,
      ageGroupCount,
      deviceCount,
      missingReferences: validationErrors.length,
      duplicateKeys: 0,
      status: validationStatus,
      errors: validationErrors,
      warnings: validationWarnings,
    },
  } satisfies CourseIndex;
}

export async function loadCourseIndex(eventId: string) {
  return (await getKV<CourseIndex>(`event:${eventId}:course:index`, 'course-index-load')) ||
    (await getKV<CourseIndex>(`live:event:${eventId}:course:index`, 'course-index-load')) ||
    null;
}

export async function rebuildCourseIndexInKv(input: {
  eventId: string;
  timingConfiguration: ResolvedTimingConfiguration;
  provider?: string | null;
  generatedBy?: string;
  syncType?: string;
  sourceVersion?: string | null;
  previousVersion?: number | null;
  generatedAt?: string;
}) {
  const existingCourseIndex = (await getKV<CourseIndex>(`event:${input.eventId}:course:index`, input.generatedBy || 'course-index')) ||
    (await getKV<CourseIndex>(`live:event:${input.eventId}:course:index`, input.generatedBy || 'course-index')) ||
    null;

  const nextCourseIndex = buildCourseIndex({
    ...input,
    previousVersion: existingCourseIndex?.version || input.previousVersion || 0,
  });

  if (nextCourseIndex.contestCount === 0 || nextCourseIndex.splitCount === 0) {
    return {
      status: 'preserved' as const,
      courseIndex: existingCourseIndex,
      existing: existingCourseIndex,
    };
  }

  if (existingCourseIndex?.sourceHash && existingCourseIndex.sourceHash === nextCourseIndex.sourceHash) {
    return {
      status: 'unchanged' as const,
      courseIndex: existingCourseIndex,
    };
  }

  if (nextCourseIndex.validation.status === 'FAIL') {
    return {
      status: 'failed' as const,
      courseIndex: existingCourseIndex,
      errors: nextCourseIndex.validation.errors,
    };
  }

  const kvTag = input.generatedBy || 'course-index';
  await putKV(`event:${input.eventId}:course:index`, nextCourseIndex, kvTag);
  await putKV(`live:event:${input.eventId}:course:index`, nextCourseIndex, kvTag);

  return {
    status: 'updated' as const,
    courseIndex: nextCourseIndex,
  };
}
