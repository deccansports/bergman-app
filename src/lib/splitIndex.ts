import { createHash } from 'crypto';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import type { ResolvedContestTiming, ResolvedTimingConfiguration, ResolvedTimingPoint } from '@/lib/timingConfiguration';

export type SplitIndexSplit = {
  uuid: string;
  splitUuid: string;
  contestUuid: string;
  contestName: string;
  order: number;
  splitName: string;
  timingPointUuid: string | null;
  timingPointName: string | null;
  timingPointExists: boolean;
  distance: number | null;
  distanceMeters: number | null;
  distanceKm: number | null;
  distanceUnit: string | null;
  isMandatory: boolean;
  isFinish: boolean;
  isStart: boolean;
  isTransition: boolean;
  provider: string | null;
  raw: Record<string, any> | null;
  // Compatibility fields
  type?: string | null;
  leg?: string | null;
  displayName?: string;
  shortName?: string;
  timingPointPass: string | number | null;
  splitDistanceKm: number | null;
  icon: string;
  color: string | null;
  visible: boolean;
  leaderboard: boolean;
  transition: boolean;
  finish: boolean;
  checkpoint: boolean;
  averageMetric: string | null;
  expectedMetric: string | null;
};

export type SplitIndexContest = {
  contestUuid: string;
  contestName: string;
  contestColor: string | null;
  contestAbbreviation: string | null;
  splitCount: number;
  timingPointCount: number;
  firstSplit: string | null;
  lastSplit: string | null;
  firstTimingPoint: string | null;
  lastTimingPoint: string | null;
  transitions: number;
  totalDistance: number;
  splits: string[];
};

export type SplitIndex = {
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
  byContest: Record<string, {
    contestUuid: string;
    contestName: string;
    splits: SplitIndexSplit[];
    splitCount: number;
    timingPointCount: number;
  }>;
  byContestAndSplit: Record<string, SplitIndexSplit>;
  byTimingPoint: Record<string, SplitIndexSplit[]>;
  splitLookup?: Record<string, SplitIndexSplit>;
  contestLookup?: Record<string, any>;
  timingPointLookup?: Record<string, ResolvedTimingPoint>;
  // Compatibility/legacy readers
  contests?: Array<{
    contestUuid: string;
    contestName: string;
    splits: SplitIndexSplit[];
  }>;
  contestsByUuid?: Record<string, any>;
  byContestUuid?: Record<string, any>;
  bySplitId?: Record<string, any>;
  byTimingPointId?: Record<string, any[]>;
  metadata?: Record<string, any>;
  contestsByName?: Record<string, string>;
  splitsByContest?: Record<string, SplitIndexSplit[]>;
  splitByUuid?: Record<string, SplitIndexSplit>;
  timingPointByUuid?: Record<string, ResolvedTimingPoint>;
  splitByTimingPointUuid?: Record<string, SplitIndexSplit>;
  splitByTimingPointPass?: Record<string, SplitIndexSplit>;
  splitOrder?: Record<string, string[]>;
  transitionLookup?: Record<string, { T1?: string | null; T2?: string | null; finish?: string | null }>;
  timingPointIndex?: TimingPointIndex;
  ageGroupIndex?: AgeGroupIndex;
  contestIndex?: ContestIndexIndex;
  validation: {
    splitCount: number;
    timingPointCount: number;
    missingReferences: number;
    skippedFinishSplits: number;
    duplicateKeys: number;
    status: 'PASS' | 'FAIL';
    errors: string[];
    rows: Array<{
      contestUuid: string;
      contestName: string;
      splitName: string;
      splitUuid: string;
      timingPointUuid: string;
      timingPointExists: boolean;
      reason: string;
    }>;
    contestCount?: number;
    uniqueTimingPoints?: number;
    uniqueSplits?: number;
    sharedTimingPoints?: number;
    sharedTimingPointReferences?: number;
    transitionCount?: number;
    lookupTables?: number;
    contestCoverage?: number;
    duplicateSplits?: number;
    duplicateTimingPoints?: number;
    missingTimingPoints?: number;
    missingContests?: number;
    duplicateUuids?: number;
    hash?: string;
  };
};

export type TimingPointIndex = {
  version: number;
  updatedAt: string;
  byUuid: Record<string, ResolvedTimingPoint>;
  list: ResolvedTimingPoint[];
};

export type AgeGroupIndex = {
  version: number;
  updatedAt: string;
  byUuid: Record<string, any>;
  list: any[];
};

export type ContestIndexIndex = {
  version: number;
  updatedAt: string;
  byUuid: Record<string, any>;
  list: any[];
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

const LEG_ORDER = ['SWIM', 'T1', 'BIKE', 'T2', 'RUN1', 'RUN2', 'RUN', 'FINISH'];

function canonicalLegToken(value: any) {
  const text = normalize(value);
  if (!text) return '';
  const lower = text.toLowerCase();
  if (/swim/i.test(lower)) return 'SWIM';
  if (/t1|transition\s*1|transition\s*a/i.test(lower)) return 'T1';
  if (/bike/i.test(lower)) return 'BIKE';
  if (/t2|transition\s*2/i.test(lower)) return 'T2';
  if (/run\s*1|run1|run\s*split\s*1/i.test(lower)) return 'RUN1';
  if (/run\s*2|run2|run\s*split\s*2/i.test(lower)) return 'RUN2';
  if (/run/i.test(lower)) return 'RUN';
  if (/finish|fini(sh)?/i.test(lower)) return 'FINISH';
  return text.toUpperCase();
}

function sortLegTokens(values: Array<any>) {
  const seen = new Set<string>();
  const tokens = values
    .map((value) => canonicalLegToken(value))
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeLookupKey(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return tokens.sort((a, b) => {
    const indexA = LEG_ORDER.indexOf(a);
    const indexB = LEG_ORDER.indexOf(b);
    const resolvedA = indexA === -1 ? LEG_ORDER.length : indexA;
    const resolvedB = indexB === -1 ? LEG_ORDER.length : indexB;
    if (resolvedA !== resolvedB) return resolvedA - resolvedB;
    return a.localeCompare(b);
  });
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

function getContestEntry(contestIndex: Record<string, ResolvedContestTiming>, contestUuid: string) {
  const key = normalize(contestUuid);
  return contestIndex[normalizeLookupKey(key)] || contestIndex[normalizeKey(key)] || null;
}

function getContestDisplayName(contest: any, fallback: string) {
  return normalize(
    contest?.contestName ||
    contest?.name ||
    contest?.contest?.contestName ||
    contest?.contest?.name ||
    fallback,
  ) || fallback;
}

function getSplitUuidLike(split: any, fallback: string) {
  if (typeof split === 'string' || typeof split === 'number') {
    return normalize(split) || fallback;
  }
  return normalize(
    split?.UUID ||
    split?.uuid ||
    split?.splitUuid ||
    split?.split_uuid ||
    split?.id ||
    fallback,
  ) || fallback;
}

function getContestSplitUuids(contest: any) {
  const contestUuid = normalize(contest?.contestUuid || contest?.uuid || contest?.id || contest?.contest?.contestUuid || contest?.contest?.uuid || contest?.contest?.id || 'contest');
  const contestKey = normalizeLookupKey(contestUuid) || 'contest';
  return asArray(contest?.splits || contest?.contest?.splits)
    .map((split, index) => getSplitUuidLike(split, `contest-split-${contestKey}-${index + 1}`))
    .filter(Boolean);
}

function getTimingPointAliases(point: any) {
  return Array.from(new Set([
    point?.id,
    point?.uuid,
    point?.providerId,
    point?.providerCode,
    point?.UUID,
    point?.timingPointUuid,
    point?.timingPointUUID,
    point?.timing_point_uuid,
    point?.timingPointId,
    point?.timing_point_id,
  ].map((value) => normalize(value)).filter(Boolean)));
}

function getTimingPointPrimaryKey(point: any, fallback: string) {
  return normalize(
    point?.id ||
    point?.uuid ||
    point?.providerId ||
    point?.providerCode ||
    point?.UUID ||
    point?.timingPointUuid ||
    point?.timingPointUUID ||
    point?.timing_point_uuid ||
    point?.timingPointId ||
    point?.timing_point_id ||
    fallback,
  ) || fallback;
}

function getTimingPointCanonicalKey(point: any) {
  return normalize(
    point?.canonicalUuid ||
    point?.raw?.UUID ||
    point?.raw?.uuid ||
    point?.raw?.TimingPointUUID ||
    point?.raw?.timingPointUUID ||
    point?.raw?.timing_point_uuid ||
    point?.raw?.TimingPointId ||
    point?.raw?.timingPointId ||
    point?.raw?.timing_point_id ||
    point?.raw?.providerUuid ||
    point?.raw?.providerId ||
    point?.raw?.providerCode ||
    point?.UUID ||
    point?.uuid ||
    point?.TimingPointUUID ||
    point?.timingPointUUID ||
    point?.timing_point_uuid ||
    point?.TimingPointId ||
    point?.timingPointId ||
    point?.timing_point_id ||
    point?.providerUuid ||
    point?.providerId ||
    point?.providerCode ||
    '',
  ) || '';
}

function getSplitTimingPointForeignKey(split: any) {
  return normalize(
    split?.TimingPointUUID ||
    split?.timingPointUUID ||
    split?.timing_point_uuid ||
    split?.TimingPointId ||
    split?.timingPointId ||
    split?.timing_point_id ||
    split?.providerUuid ||
    split?.providerId ||
    split?.providerCode ||
    split?.timingPoint?.UUID ||
    split?.timingPoint?.uuid ||
    split?.timingPoint?.TimingPointUUID ||
    split?.timingPoint?.timingPointUUID ||
    split?.timingPoint?.timing_point_uuid ||
    split?.timingPoint?.TimingPointId ||
    split?.timingPoint?.timingPointId ||
    split?.timingPoint?.timing_point_id ||
    split?.timingPoint?.providerUuid ||
    split?.timingPoint?.providerId ||
    split?.timingPoint?.providerCode ||
    '',
  ) || '';
}

function getContestUuidFromEntry(contest: any, fallback: string) {
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

function getContestNameFromEntry(contest: any, fallback: string) {
  return normalize(
    contest?.contestName ||
    contest?.name ||
    contest?.contest?.contestName ||
    contest?.contest?.name ||
    contest?.UUID ||
    contest?.uuid ||
    contest?.contestUuid ||
    contest?.id ||
    fallback,
  ) || fallback;
}

function getContestNameFromLookup(contestLookup: Record<string, any> | undefined, contestUuid: string, fallback: string) {
  const contest = contestLookup?.[normalizeLookupKey(contestUuid)] || contestLookup?.[normalizeKey(contestUuid)] || null;
  return normalize(
    contest?.contestName ||
    contest?.Name ||
    contest?.name ||
    contest?.label ||
    contest?.contest?.contestName ||
    contest?.contest?.name ||
    fallback,
  ) || fallback;
}

function getSplitUuid(split: any, contestUuid: string, index: number) {
  return normalize(split?.UUID || split?.uuid || split?.splitUuid || split?.split_uuid || split?.id || `${contestUuid}:split:${index + 1}`) || `${contestUuid}:split:${index + 1}`;
}

function getSplitName(split: any, fallback: string) {
  return normalize(split?.Name || split?.name || split?.Label || split?.label || split?.splitName || split?.displayName || fallback) || fallback;
}

function getSplitDistanceDetails(split: any) {
  const rawDistance = Number(split?.DistanceFromStart ?? split?.distanceFromStart ?? split?.distance ?? split?.meters ?? split?.Distance);
  const hasDistance = Number.isFinite(rawDistance);
  const unit = normalize(split?.DistanceFromStartUnit || split?.distanceFromStartUnit || split?.DistanceUnit || split?.distanceUnit || split?.unit || '').toLowerCase();
  return {
    distanceMeters: hasDistance ? rawDistance : null,
    distanceKm: hasDistance ? (unit.includes('km') || unit.includes('kilomet') ? rawDistance : rawDistance / 1000) : null,
    distanceUnit: hasDistance ? 'meters' : null,
  };
}

function isFinishSplit(split: any, splitName: string) {
  return Boolean(split?.isFinish || split?.finish || /finish/i.test(`${split?.TypeOfSport || split?.typeOfSport || ''} ${splitName}`));
}

function isStartSplit(split: any, splitName: string) {
  return Boolean(split?.isStart || /^start$/i.test(splitName) || /start/i.test(`${split?.TypeOfSport || split?.typeOfSport || ''} ${splitName}`));
}

function isTransitionSplit(split: any, splitName: string) {
  return Boolean(split?.isTransition || split?.transition || /transition|\bT1\b|\bT2\b/i.test(`${split?.TypeOfSport || split?.typeOfSport || ''} ${splitName}`));
}

function getTimingPointCanonicalUuid(point: any) {
  return normalize(
    point?.canonicalUuid ||
    point?.UUID ||
    point?.uuid ||
    point?.TimingPointUUID ||
    point?.timingPointUUID ||
    point?.timing_point_uuid ||
    point?.TimingPointId ||
    point?.timingPointId ||
    point?.timing_point_id ||
    point?.providerUuid ||
    point?.providerId ||
    point?.providerCode ||
    '',
  ) || '';
}

function normalizeTimingPointForIndex(point: any, fallbackIndex: number): ResolvedTimingPoint {
  const canonicalUuid = getTimingPointCanonicalUuid(point);
  return {
    id: canonicalUuid || '',
    canonicalUuid,
    providerId: normalize(point?.providerId || point?.providerUuid || point?.id || point?.uuid || null) || null,
    providerCode: normalize(point?.providerCode || point?.code || point?.splitCode || null) || null,
    displayName: normalize(point?.displayName || point?.label || point?.name || point?.splitName || `Timing Point ${fallbackIndex + 1}`) || `Timing Point ${fallbackIndex + 1}`,
    shortName: normalize(point?.shortName || point?.code || point?.label || point?.name || canonicalUuid) || canonicalUuid,
    eventId: normalize(point?.eventId || null) || null,
    distance: Number.isFinite(Number(point?.distance ?? point?.distanceKm)) ? Number(point?.distance ?? point?.distanceKm) : null,
    distanceKm: Number.isFinite(Number(point?.distanceKm ?? point?.distance)) ? Number(point?.distanceKm ?? point?.distance) : null,
    leg: normalize(point?.leg || null) || null,
    order: Number(point?.order ?? point?.index ?? fallbackIndex + 1) || fallbackIndex + 1,
    latitude: Number(point?.latitude ?? point?.lat ?? 0) || 0,
    longitude: Number(point?.longitude ?? point?.lng ?? point?.lon ?? 0) || 0,
    markerType: point?.markerType === 'finish' ? 'finish' : point?.markerType === 'transition' ? 'transition' : point?.markerType === 'medical' ? 'medical' : 'checkpoint',
    icon: normalize(point?.icon || point?.markerType || 'checkpoint') || 'checkpoint',
    leaderboard: Boolean(point?.leaderboard || point?.isLeaderboard || false),
    transition: Boolean(point?.transition || point?.isTransition || false),
    finish: Boolean(point?.finish || point?.isFinish || false),
    visible: point?.visible !== false,
    isLeaderboard: Boolean(point?.isLeaderboard || point?.leaderboard || false),
    isTransition: Boolean(point?.isTransition || point?.transition || false),
    isFinish: Boolean(point?.isFinish || point?.finish || false),
    raw: point || null,
  };
}

function buildTimingPointIndex(input: { timingConfiguration: ResolvedTimingConfiguration; generatedAt?: string; previousVersion?: number | null; eventId?: string; }): TimingPointIndex {
  const timingConfiguration = input.timingConfiguration as any;
  const contestEntries = Object.values((timingConfiguration?.contestIndex && typeof timingConfiguration.contestIndex === 'object') ? timingConfiguration.contestIndex : (timingConfiguration?.contestByUuid && typeof timingConfiguration.contestByUuid === 'object' ? timingConfiguration.contestByUuid : {}));
  const rawPoints = [
    ...asArray(timingConfiguration?.timingPoints),
    ...contestEntries.flatMap((contest: any) => asArray(contest?.timingPoints)),
  ];
  const byUuid: Record<string, ResolvedTimingPoint> = {};
  const list: ResolvedTimingPoint[] = [];
  const seen = new Set<string>();

  rawPoints.forEach((point, index) => {
    const normalized = normalizeTimingPointForIndex(point, index);
    const key = normalize(normalized.canonicalUuid || normalized.id);
    if (!key || seen.has(key)) return;
    seen.add(key);
    byUuid[normalizeLookupKey(key)] = normalized;
    list.push(normalized);
  });

  return {
    version: (Number(input.previousVersion || timingConfiguration?.timingPointIndex?.version || 0) + 1) || 1,
    updatedAt: input.generatedAt || new Date().toISOString(),
    byUuid,
    list,
  };
}

function buildAgeGroupIndex(input: { timingConfiguration: ResolvedTimingConfiguration; generatedAt?: string; previousVersion?: number | null; eventId?: string; }): AgeGroupIndex {
  const timingConfiguration = input.timingConfiguration as any;
  const contestAgeGroups = Object.values(timingConfiguration?.contestIndex || {}).flatMap((contest: any) => asArray(contest?.ageGroups));
  const ageGroupsByContest = Object.values(timingConfiguration?.ageGroupsByContest || {}).flatMap((groups: any) => asArray(groups));
  const rawAgeGroups = [...contestAgeGroups, ...ageGroupsByContest]
    .concat(asArray(timingConfiguration?.ageGroups))
    .filter((ageGroup) => ageGroup && typeof ageGroup === 'object');
  const byUuid: Record<string, any> = {};
  const list: any[] = [];
  const seen = new Set<string>();

  rawAgeGroups.forEach((ageGroup) => {
    const uuid = normalize(ageGroup?.UUID || ageGroup?.uuid || ageGroup?.id || ageGroup?.code);
    if (!uuid || seen.has(uuid)) return;
    seen.add(uuid);
    const normalized = {
      uuid,
      id: uuid,
      provider: 'feibot',
      providerAgeGroupUuid: uuid,
      name: normalize(ageGroup?.Name || ageGroup?.name || ageGroup?.label || ageGroup?.ageGroup || ageGroup?.code),
      label: normalize(ageGroup?.Name || ageGroup?.label || ageGroup?.name || ageGroup?.ageGroup || ageGroup?.code),
      abbreviation: normalize(ageGroup?.Abbreviation || ageGroup?.abbreviation || ageGroup?.code || ageGroup?.label || ageGroup?.Name),
      fromAge: Number.isFinite(Number(ageGroup?.FromAge ?? ageGroup?.fromAge)) ? Number(ageGroup?.FromAge ?? ageGroup?.fromAge) : null,
      toAge: Number.isFinite(Number(ageGroup?.ToAge ?? ageGroup?.toAge)) ? Number(ageGroup?.ToAge ?? ageGroup?.toAge) : null,
      gender: normalize(ageGroup?.Gender || ageGroup?.gender) || null,
      higherValueEqual: Boolean(ageGroup?.HigherValueEqual ?? ageGroup?.higherValueEqual ?? false),
      raw: ageGroup,
    };
    byUuid[normalizeLookupKey(uuid)] = normalized;
    list.push(normalized);
  });

  return {
    version: (Number(input.previousVersion || timingConfiguration?.ageGroupIndex?.version || 0) + 1) || 1,
    updatedAt: input.generatedAt || new Date().toISOString(),
    byUuid,
    list,
  };
}

function buildContestIndexIndex(input: { timingConfiguration: ResolvedTimingConfiguration; generatedAt?: string; previousVersion?: number | null; eventId?: string; }): ContestIndexIndex {
  const timingConfiguration = input.timingConfiguration as any;
  const rawContestEntries = asArray(timingConfiguration?.contests);
  const contestEntries = rawContestEntries.length > 0
    ? rawContestEntries
    : Object.values((timingConfiguration?.contestIndex && typeof timingConfiguration.contestIndex === 'object') ? timingConfiguration.contestIndex : (timingConfiguration?.contestByUuid && typeof timingConfiguration.contestByUuid === 'object' ? timingConfiguration.contestByUuid : {}));
  const contestLookup = timingConfiguration?.contestLookup && typeof timingConfiguration.contestLookup === 'object' ? timingConfiguration.contestLookup : {};
  const byUuid: Record<string, any> = {};
  const list: any[] = [];

  contestEntries.forEach((contest: any, index: number) => {
    const contestUuid = getContestUuidFromEntry(contest, `contest-${index + 1}`);
    const contestName = getContestNameFromLookup(contestLookup, contestUuid, getContestNameFromEntry(contest, contestUuid || `contest-${index + 1}`));
    const splits = asArray(contest?.splits || contest?.contest?.splits).map((split: any, splitIndex: number) => ({
      splitUuid: getSplitUuid(split, contestUuid, splitIndex),
      splitName: getSplitName(split, `Split ${splitIndex + 1}`),
      order: Number(split?.Order ?? split?.order ?? split?.Index ?? split?.index ?? splitIndex + 1) || splitIndex + 1,
      timingPointUuid: getSplitTimingPointForeignKey(split),
      timingPointName: normalize(split?.timingPointName || split?.TimingPointName || split?.timingPoint?.displayName || split?.timingPoint?.name || '') || null,
      timingPointExists: true,
      distance: getSplitDistanceDetails(split).distanceMeters,
      distanceMeters: getSplitDistanceDetails(split).distanceMeters,
      distanceKm: getSplitDistanceDetails(split).distanceKm,
      distanceUnit: getSplitDistanceDetails(split).distanceUnit,
      isMandatory: split?.isMandatory !== false && split?.mandatory !== false,
      isFinish: isFinishSplit(split, getSplitName(split, `Split ${splitIndex + 1}`)),
      isStart: isStartSplit(split, getSplitName(split, `Split ${splitIndex + 1}`)),
      isTransition: isTransitionSplit(split, getSplitName(split, `Split ${splitIndex + 1}`)),
      provider: normalize(split?.provider || contest?.provider || timingConfiguration?.provider || 'feibot') || 'feibot',
      raw: split || null,
    }));

    const normalized = {
      contestUuid,
      contestName,
      splits,
      splitCount: splits.length,
      timingPointCount: asArray(contest?.timingPoints).length,
    };
    byUuid[normalizeLookupKey(contestUuid)] = normalized;
    list.push(normalized);
  });

  return {
    version: (Number(input.previousVersion || timingConfiguration?.contestIndexVersion || 0) + 1) || 1,
    updatedAt: input.generatedAt || new Date().toISOString(),
    byUuid,
    list,
  };
}

function buildSplitObject(split: any, contestUuid: string, contestName: string, contestLegs: string[]): SplitIndexSplit {
  const splitUuid = getSplitUuid(split, contestUuid, Number(split?.Order ?? split?.order ?? split?.Index ?? split?.index ?? 0) || 0);
  const splitName = getSplitName(split, splitUuid);
  const order = Number(split?.Order ?? split?.order ?? split?.Index ?? split?.index ?? 0) || 0;
  const timingPointUuid = getSplitTimingPointForeignKey(split);
  const distanceDetails = getSplitDistanceDetails(split);
  const isFinish = isFinishSplit(split, splitName);
  const isStart = isStartSplit(split, splitName);
  const isTransition = isTransitionSplit(split, splitName);
  const inferredLeg = canonicalLegToken(
    split?.leg ||
    split?.Leg ||
    split?.raw?.leg ||
    split?.raw?.Leg ||
    split?.timingPoint?.leg ||
    split?.timingPoint?.Leg ||
    splitName,
  ) || null;
  const contestLegSet = new Set((contestLegs || []).map((leg) => normalizeLookupKey(leg)).filter(Boolean));
  const legExists = contestLegSet.size > 0
    ? Boolean(inferredLeg && contestLegSet.has(normalizeLookupKey(inferredLeg)))
    : Boolean(inferredLeg);
  const timingPointExists = false;
  return {
    uuid: splitUuid,
    splitUuid,
    contestUuid,
    contestName,
    order,
    splitName,
    timingPointUuid: timingPointUuid || null,
    timingPointName: normalize(split?.timingPointName || split?.TimingPointName || split?.timingPoint?.displayName || split?.timingPoint?.name || '') || null,
    timingPointExists,
    distance: distanceDetails.distanceMeters,
    distanceMeters: distanceDetails.distanceMeters,
    distanceUnit: distanceDetails.distanceUnit,
    isMandatory: split?.isMandatory !== false && split?.mandatory !== false,
    isFinish,
    isStart,
    isTransition,
    provider: normalize(split?.provider || split?.sourceProvider || 'feibot') || 'feibot',
    raw: split || null,
    // compatibility aliases
    type: normalize(split?.TypeOfSport || split?.typeOfSport || '') || null,
    leg: inferredLeg,
    displayName: splitName,
    shortName: splitName,
    timingPointPass: split?.TimingPointPass ?? split?.timingPointPass ?? split?.pass ?? null,
    distanceKm: distanceDetails.distanceKm,
    splitDistanceKm: distanceDetails.distanceKm,
    icon: normalize(split?.icon || (isFinish ? 'finish' : isTransition ? 'transition' : 'checkpoint')) || 'checkpoint',
    color: normalize(split?.color || split?.Color || '') || null,
    visible: split?.visible !== false,
    leaderboard: Boolean(split?.leaderboard ?? split?.isLeaderboard ?? false),
    transition: isTransition,
    finish: isFinish,
    checkpoint: !isTransition && !isFinish,
    averageMetric: normalize(split?.averageMetric || split?.average_metric || '') || null,
    expectedMetric: normalize(split?.expectedMetric || split?.expected_metric || '') || null,
  };
}

export function buildSplitIndex(input: {
  eventId: string;
  timingConfiguration: ResolvedTimingConfiguration;
  provider?: string | null;
  generatedBy?: string;
  syncType?: string;
  sourceVersion?: string | null;
  previousVersion?: number | null;
  generatedAt?: string;
}): SplitIndex {
  const startedAt = Date.now();
  const generatedAt = input.generatedAt || new Date().toISOString();
  const timingConfiguration = input.timingConfiguration as any;
  const rawContestEntries = asArray(timingConfiguration?.contests);
  const contestIndexSource = rawContestEntries.length > 0
    ? rawContestEntries.reduce<Record<string, any>>((acc, contest: any, index: number) => {
        const contestUuid = getContestUuidFromEntry(contest, `contest-${index + 1}`);
        const normalizedKey = normalizeLookupKey(contestUuid);
        if (normalizedKey) acc[normalizedKey] = contest;
        return acc;
      }, {})
    : timingConfiguration?.contestIndex && typeof timingConfiguration.contestIndex === 'object'
      ? timingConfiguration.contestIndex
      : timingConfiguration?.contestByUuid && typeof timingConfiguration.contestByUuid === 'object'
        ? timingConfiguration.contestByUuid
        : {};
  const contestLookup = timingConfiguration?.contestLookup && typeof timingConfiguration.contestLookup === 'object' ? timingConfiguration.contestLookup : {};
  const contestEntries = rawContestEntries.length > 0
    ? rawContestEntries
    : Array.from(new Map(
        Object.values(contestIndexSource).map((contest: any) => [getContestUuidFromEntry(contest, ''), contest]),
      ).values()).filter(Boolean) as any[];
  const timingPointIndex = buildTimingPointIndex({ timingConfiguration, generatedAt, previousVersion: input.previousVersion });
  const ageGroupIndex = buildAgeGroupIndex({ timingConfiguration, generatedAt, previousVersion: input.previousVersion });
  const contestIndex = buildContestIndexIndex({ timingConfiguration, generatedAt, previousVersion: input.previousVersion });

  const byContest: SplitIndex['byContest'] = {};
  const byContestAndSplit: Record<string, SplitIndexSplit> = {};
  const splitLookup: Record<string, SplitIndexSplit> = {};
  const byTimingPoint: Record<string, SplitIndexSplit[]> = {};
  const contestRows: Array<{ contestUuid: string; contestName: string; splits: SplitIndexSplit[] }> = [];
  const validationRows: SplitIndex['validation']['rows'] = [];
  const splitKeys = new Set<string>();
  let skippedFinishSplits = 0;
  let duplicateKeys = 0;

  for (const contest of contestEntries) {
    const contestUuid = getContestUuidFromEntry(contest, `contest-${contestRows.length + 1}`);
    const contestName = getContestNameFromLookup(contestLookup, contestUuid, getContestNameFromEntry(contest, contestUuid || `contest-${contestRows.length + 1}`));
    const splitSource = asArray(contest?.splits || contest?.contest?.splits);
    const contestLegs = sortLegTokens([
      ...asArray(contest?.legs || contest?.contest?.legs).map((leg) => normalize(leg?.name || leg?.label || leg?.leg || leg)),
      ...splitSource.map((split: any) => normalize(split?.leg || split?.Leg || split?.name || split?.Name || split?.label || split?.Label)),
      ...asArray(contest?.timingPoints || contest?.contest?.timingPoints).map((point: any) => normalize(point?.leg || point?.Leg || point?.name || point?.Name || point?.label || point?.Label)),
    ]);
    const splits: SplitIndexSplit[] = [];

    splitSource.forEach((split: any, index: number) => {
      const splitObj = buildSplitObject(split, contestUuid, contestName, contestLegs);
      const splitKey = splitObj.splitUuid;
      const rawTimingPointUuid = normalizeLookupKey(splitObj.timingPointUuid || '');
      const timingPointExists = rawTimingPointUuid === ''
        ? false
        : Boolean(timingPointIndex.byUuid[rawTimingPointUuid]);
      const rawLegKey = normalizeLookupKey(splitObj.leg || '');
      const legExists = rawLegKey === ''
        ? false
        : contestLegs.length > 0
          ? contestLegs.some((leg) => normalizeLookupKey(leg) === rawLegKey)
          : Boolean(rawLegKey);
      const isFinishSplitOnly = rawTimingPointUuid === '' && splitObj.isFinish;

      if (isFinishSplitOnly) skippedFinishSplits += 1;
      if (splitKeys.has(splitKey)) duplicateKeys += 1;
      splitKeys.add(splitKey);

      const nextSplit: SplitIndexSplit = {
        ...splitObj,
        timingPointExists,
      };

      const lowerSplitKey = normalizeLookupKey(splitKey);
      byContestAndSplit[lowerSplitKey] = nextSplit;
      splitLookup[lowerSplitKey] = nextSplit;
      splits.push(nextSplit);

      if (rawTimingPointUuid) {
        if (!byTimingPoint[rawTimingPointUuid]) byTimingPoint[rawTimingPointUuid] = [];
        byTimingPoint[rawTimingPointUuid].push(nextSplit);
      }

      validationRows.push({
        contestUuid,
        contestName,
        splitName: nextSplit.splitName,
        splitUuid: nextSplit.splitUuid,
        timingPointUuid: rawTimingPointUuid,
        timingPointExists,
        reason: rawTimingPointUuid === '' && splitObj.isFinish
          ? 'Finish split without timing point'
          : rawTimingPointUuid === ''
            ? 'Timing point missing'
            : !legExists
              ? 'Leg missing or invalid for contest'
              : timingPointExists
                ? 'Timing point found'
                : 'Timing point missing',
      });

      nextSplit.timingPointExists = timingPointExists;
      nextSplit.order = Number(splitObj.order || index + 1) || index + 1;
      nextSplit.uuid = splitKey;
      nextSplit.displayName = nextSplit.splitName;
      nextSplit.shortName = nextSplit.splitName;
      nextSplit.timingPointName = nextSplit.timingPointName || timingPointIndex.byUuid[rawTimingPointUuid]?.displayName || null;
      nextSplit.timingPointUuid = rawTimingPointUuid || null;
      nextSplit.leg = splitObj.leg || null;
    });

    byContest[normalizeLookupKey(contestUuid)] = {
      contestUuid,
      contestName,
      splits,
      splitCount: splits.length,
      timingPointCount: splits.filter((split) => !!split.timingPointUuid).length,
    };
    contestRows.push({ contestUuid, contestName, splits });
  }

  const splitCount = validationRows.length;
  const timingPointCount = Object.keys(timingPointIndex.byUuid).length;
  const contestCount = Object.keys(byContest).length;
  const missingReferenceRows = validationRows.filter((row) => row.timingPointUuid && !row.timingPointExists);
  const invalidLegRows = validationRows.filter((row) => row.reason.includes('Leg missing or invalid'));
  const missingReferences = missingReferenceRows.length + invalidLegRows.length;
  const status: 'PASS' | 'FAIL' = missingReferences === 0 ? 'PASS' : 'FAIL';
  const sourceHash = sha256(stableStringify({
    eventId: input.eventId,
    contests: contestRows,
    timingPoints: timingPointIndex.list,
    ageGroups: ageGroupIndex.list,
  }));

  return {
    version: 2,
    provider: normalize(input.provider || timingConfiguration?.provider || 'feibot') || 'feibot',
    eventId: input.eventId,
    generatedAt,
    generatedBy: input.generatedBy || 'split-index-builder',
    updatedAt: generatedAt,
    sourceProvider: normalize(timingConfiguration?.provider || input.provider || 'feibot') || 'feibot',
    sourceHash,
    sourceVersion: normalize(input.sourceVersion || timingConfiguration?.version || timingConfiguration?.meta?.version || null) || null,
    syncType: input.syncType || 'unknown',
    buildDurationMs: Date.now() - startedAt,
    contestCount,
    splitCount,
    timingPointCount,
    byContest,
    byContestAndSplit,
    byTimingPoint,
    contests: contestRows,
    byContestUuid: byContest,
    bySplitId: byContestAndSplit,
    byTimingPointId: byTimingPoint,
    splitLookup,
    contestLookup,
    metadata: {
      eventId: input.eventId,
      updatedAt: generatedAt,
      contestCount,
      splitCount,
      timingPointCount,
      ageGroupCount: ageGroupIndex.list.length,
      sourceHash,
      sourceVersion: normalize(input.sourceVersion || timingConfiguration?.version || timingConfiguration?.meta?.version || null) || null,
    },
    contestsByUuid: byContest as any,
    contestsByName: Object.fromEntries(contestRows.map((contest) => [normalizeKey(contest.contestName), contest.contestUuid])),
    splitsByContest: Object.fromEntries(contestRows.map((contest) => [normalizeLookupKey(contest.contestUuid), contest.splits])),
    splitByUuid: byContestAndSplit,
    timingPointByUuid: timingPointIndex.byUuid,
    splitByTimingPointUuid: Object.fromEntries(Object.entries(byTimingPoint).map(([key, rows]) => [normalizeLookupKey(key), rows[0]])),
    splitByTimingPointPass: {},
    splitOrder: Object.fromEntries(contestRows.map((contest) => [normalizeLookupKey(contest.contestUuid), contest.splits.map((split) => split.uuid)])),
    timingPointLookup: timingPointIndex.byUuid,
    transitionLookup: {},
    timingPointIndex,
    ageGroupIndex,
    contestIndex,
    validation: {
      splitCount,
      timingPointCount,
      missingReferences,
      skippedFinishSplits,
      duplicateKeys,
      status,
      errors: [
        ...missingReferenceRows.map((row) => `Contest ${row.contestUuid} / ${row.contestName}: ${row.splitName} (${row.splitUuid}) -> ${row.timingPointUuid || 'finish split'} not found`),
        ...invalidLegRows.map((row) => `Contest ${row.contestUuid} / ${row.contestName}: ${row.splitName} (${row.splitUuid}) -> invalid leg mapping`),
      ],
      rows: validationRows,
      contestCount,
      uniqueTimingPoints: timingPointCount,
      uniqueSplits: splitCount,
      sharedTimingPoints: 0,
      sharedTimingPointReferences: 0,
      transitionCount: 0,
      lookupTables: 3,
      contestCoverage: contestCount > 0 ? 100 : 0,
      duplicateSplits: duplicateKeys,
      duplicateTimingPoints: 0,
      missingTimingPoints: missingReferences,
      missingContests: 0,
      duplicateUuids: duplicateKeys,
      hash: sourceHash,
    } as any,
  };
}

export function printSplitIndexValidation(splitIndex: SplitIndex) {
  console.log('================================================');
  console.log('SPLIT INDEX BUILD');
  console.log('================================================');
  console.log('Contests', splitIndex.contestCount);
  console.log('Timing Points', splitIndex.timingPointCount);
  console.log('Splits', splitIndex.splitCount);
  console.log('Split Index Entries', Object.keys(splitIndex.byContestAndSplit || {}).length);
  console.log('Timing Point Index Entries', Object.keys(splitIndex.timingPointIndex?.byUuid || {}).length);
  console.log('Validation', splitIndex.validation.status);
  console.log('================================================');
  for (const contest of Object.values(splitIndex.byContest || {})) {
    console.log('Contest', contest.contestName);
    console.log('Contest UUID', contest.contestUuid);
    console.log('Split Count', contest.splitCount);
    console.log('Timing Point Count', contest.timingPointCount);
    const contestRows = splitIndex.validation.rows.filter((row) => row.contestUuid === contest.contestUuid);
    console.log('Missing References', contestRows.filter((row) => !row.timingPointExists && row.timingPointUuid).length);
    console.log('Duplicate Keys', 0);
    console.log('Skipped Finish Splits', contestRows.filter((row) => row.reason.includes('Finish split')).length);
    console.log('---');
  }
  if (splitIndex.validation.status === 'FAIL') {
    for (const row of splitIndex.validation.rows.filter((entry) => !entry.timingPointExists && entry.timingPointUuid)) {
      console.log('[split-index][validation-fail]', row);
    }
  }
}

export async function rebuildSplitIndexInKv(input: {
  eventId: string;
  timingConfiguration: ResolvedTimingConfiguration;
  provider?: string | null;
  generatedBy?: string;
  syncType?: string;
  sourceVersion?: string | null;
  previousVersion?: number | null;
  generatedAt?: string;
}) {
  console.log('[REBUILD] Event', input.eventId);

  const existingSplitIndex = (await getKV<SplitIndex>(`event:${input.eventId}:splitIndex`, input.generatedBy || 'split-index')) ||
    (await getKV<SplitIndex>(`live:event:${input.eventId}:splitIndex`, input.generatedBy || 'split-index')) ||
    null;
  const existingTimingPointIndex = (await getKV<TimingPointIndex>(`event:${input.eventId}:timingPointIndex`, input.generatedBy || 'split-index')) ||
    (await getKV<TimingPointIndex>(`live:event:${input.eventId}:timingPointIndex`, input.generatedBy || 'split-index')) ||
    null;
  const existingAgeGroupIndex = (await getKV<AgeGroupIndex>(`event:${input.eventId}:ageGroupIndex`, input.generatedBy || 'split-index')) ||
    (await getKV<AgeGroupIndex>(`live:event:${input.eventId}:ageGroupIndex`, input.generatedBy || 'split-index')) ||
    null;
  const existingContestIndex = (await getKV<ContestIndexIndex>(`event:${input.eventId}:contestIndex`, input.generatedBy || 'split-index')) ||
    (await getKV<ContestIndexIndex>(`live:event:${input.eventId}:contestIndex`, input.generatedBy || 'split-index')) ||
    null;

  const nextContestIndex = buildContestIndexIndex({
    eventId: input.eventId,
    timingConfiguration: input.timingConfiguration,
    generatedAt: input.generatedAt,
    previousVersion: existingContestIndex?.version || input.previousVersion || 0,
  } as any);
  const nextTimingPointIndex = buildTimingPointIndex({
    eventId: input.eventId,
    timingConfiguration: input.timingConfiguration,
    generatedAt: input.generatedAt,
    previousVersion: existingTimingPointIndex?.version || input.previousVersion || 0,
  } as any);
  const nextAgeGroupIndex = buildAgeGroupIndex({
    eventId: input.eventId,
    timingConfiguration: input.timingConfiguration,
    generatedAt: input.generatedAt,
    previousVersion: existingAgeGroupIndex?.version || input.previousVersion || 0,
  } as any);
  const nextSplitIndex = buildSplitIndex({
    eventId: input.eventId,
    timingConfiguration: input.timingConfiguration,
    provider: input.provider || input.timingConfiguration?.provider || 'feibot',
    generatedBy: input.generatedBy,
    syncType: input.syncType,
    sourceVersion: input.sourceVersion,
    previousVersion: input.previousVersion || existingSplitIndex?.version || 0,
  });

  const rebuildContests = Object.values(nextSplitIndex.byContest || {});
  console.log('[REBUILD] Contests', rebuildContests.length);
  for (const contest of rebuildContests) {
    console.log('[REBUILD]', contest.contestName, Array.isArray(contest.splits) ? contest.splits.length : 0);
  }

  if (
    !nextSplitIndex ||
    !nextSplitIndex.byContest ||
    Object.keys(nextSplitIndex.byContest).length === 0 ||
    Number(nextSplitIndex.splitCount || 0) === 0
  ) {
    console.warn('[REBUILD] Split index is empty. Preserving existing KV payload.', {
      eventId: input.eventId,
      existingSplitIndex: Boolean(existingSplitIndex),
      existingTimingPointIndex: Boolean(existingTimingPointIndex),
      existingAgeGroupIndex: Boolean(existingAgeGroupIndex),
      existingContestIndex: Boolean(existingContestIndex),
    });
    return {
      status: 'preserved' as const,
      splitIndex: existingSplitIndex,
      existing: {
        splitIndex: existingSplitIndex,
        timingPointIndex: existingTimingPointIndex,
        ageGroupIndex: existingAgeGroupIndex,
        contestIndex: existingContestIndex,
      },
    };
  }

  const unchanged = Boolean(existingSplitIndex?.sourceHash && existingSplitIndex.sourceHash === nextSplitIndex.sourceHash);
  const hasAllIndexes = Boolean(existingContestIndex && existingTimingPointIndex && existingAgeGroupIndex && existingSplitIndex);
  if (unchanged && hasAllIndexes) {
    const currentSplitIndex = existingSplitIndex as SplitIndex;
    console.log('Split Index unchanged', { eventId: input.eventId, version: currentSplitIndex.version, sourceHash: currentSplitIndex.sourceHash });
    return { status: 'unchanged' as const, splitIndex: currentSplitIndex };
  }

  if (nextSplitIndex.validation.status !== 'PASS') {
    console.warn('Split Index validation failed', { eventId: input.eventId, errors: nextSplitIndex.validation.errors, rows: nextSplitIndex.validation.rows });
    return { status: 'failed' as const, splitIndex: existingSplitIndex, errors: nextSplitIndex.validation.errors };
  }

  const invalidAgeGroups = nextAgeGroupIndex.list.filter((ageGroup: any) => {
    const firstKey = Object.keys(ageGroup || {})[0] || '';
    return !ageGroup?.uuid || !ageGroup?.name || /^Age Group\s+\d+$/i.test(String(ageGroup?.name || '')) || /^\d+$/.test(firstKey);
  });
  if (invalidAgeGroups.length > 0) {
    throw new Error('Invalid ageGroupIndex generated.');
  }

  const kvTag = input.generatedBy || 'split-index';
  console.log('[KV WRITE]', `event:${input.eventId}:contestIndex`, nextContestIndex);
  await putKV(`event:${input.eventId}:contestIndex`, nextContestIndex, kvTag);
  console.log('[KV WRITE]', `live:event:${input.eventId}:contestIndex`, nextContestIndex);
  await putKV(`live:event:${input.eventId}:contestIndex`, nextContestIndex, kvTag);
  console.log('[KV WRITE]', `event:${input.eventId}:timingPointIndex`, nextTimingPointIndex);
  await putKV(`event:${input.eventId}:timingPointIndex`, nextTimingPointIndex, kvTag);
  console.log('[KV WRITE]', `live:event:${input.eventId}:timingPointIndex`, nextTimingPointIndex);
  await putKV(`live:event:${input.eventId}:timingPointIndex`, nextTimingPointIndex, kvTag);
  console.log('[KV WRITE]', `event:${input.eventId}:splitIndex`, nextSplitIndex);
  await putKV(`event:${input.eventId}:splitIndex`, nextSplitIndex, kvTag);
  console.log('[KV WRITE]', `live:event:${input.eventId}:splitIndex`, nextSplitIndex);
  await putKV(`live:event:${input.eventId}:splitIndex`, nextSplitIndex, kvTag);
  console.log('[KV WRITE]', `event:${input.eventId}:ageGroupIndex`, nextAgeGroupIndex);
  await putKV(`event:${input.eventId}:ageGroupIndex`, nextAgeGroupIndex, kvTag);
  console.log('[KV WRITE]', `live:event:${input.eventId}:ageGroupIndex`, nextAgeGroupIndex);
  await putKV(`live:event:${input.eventId}:ageGroupIndex`, nextAgeGroupIndex, kvTag);

  const verifySplitIndex = await getKV<SplitIndex>(`live:event:${input.eventId}:splitIndex`, kvTag);
  console.log('[KV VERIFY]', verifySplitIndex);
  console.log('[split-index][write-counts]', {
    eventId: input.eventId,
    contestIndex: Object.keys(nextContestIndex || {}).length,
    timingPointIndex: Object.keys(nextTimingPointIndex?.byUuid || {}).length,
    splitIndex: nextSplitIndex.splitCount || 0,
    ageGroupIndex: Object.keys(nextAgeGroupIndex?.byUuid || nextAgeGroupIndex?.list || {}).length,
  });
  printSplitIndexValidation(nextSplitIndex);
  return { status: unchanged ? 'unchanged' as const : 'updated' as const, splitIndex: nextSplitIndex };
}

export async function loadSplitIndex(eventId: string) {
  return (await getKV<SplitIndex>(`event:${eventId}:splitIndex`, 'split-index-load')) ||
    (await getKV<SplitIndex>(`live:event:${eventId}:splitIndex`, 'split-index-load')) ||
    null;
}
