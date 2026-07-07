export type TimingConfigurationSource = 'cloud' | 'local_database' | 'manual';

type AnyRecord = Record<string, any>;

export type ResolvedTimingPoint = {
  id: string;
  canonicalUuid: string | null;
  providerId: string | null;
  providerCode: string | null;
  displayName: string;
  shortName: string;
  eventId?: string | null;
  distance: number | null;
  distanceKm: number | null;
  leg: string | null;
  order: number;
  latitude: number;
  longitude: number;
  markerType: 'checkpoint' | 'transition' | 'finish' | 'medical';
  icon: string;
  leaderboard: boolean;
  transition: boolean;
  finish: boolean;
  visible: boolean;
  isLeaderboard: boolean;
  isTransition: boolean;
  isFinish: boolean;
  raw?: Record<string, any> | null;
};

export type ResolvedContestTiming = {
  id: string;
  uuid: string;
  contestUuid: string;
  contestName: string;
  name: string;
  providerUuid: string | null;
  provider: string | null;
  color: string | null;
  distance: number | null;
  startTime: string | null;
  status: string | null;
  contest: AnyRecord;
  splits: Array<AnyRecord>;
  timingPoints: Array<ResolvedTimingPoint>;
  ageGroups: Array<AnyRecord>;
  legs: Array<string>;
  participants: Array<AnyRecord>;
  leaderboard: Array<AnyRecord>;
  statistics: AnyRecord;
};

export type ResolvedTimingConfiguration = {
  eventId?: string | null;
  source: TimingConfigurationSource;
  course: {
    legs: Array<string>;
    timingPoints: ResolvedTimingPoint[];
    splits: Array<Record<string, any>>;
    contests: Array<Record<string, any>>;
  };
  contests: Array<Record<string, any>>;
  timingPoints: ResolvedTimingPoint[];
  splits: Array<Record<string, any>>;
  devices: Array<Record<string, any>>;
  legs: Array<string>;
  ageGroups: Array<string>;
  contestIndex: Record<string, ResolvedContestTiming>;
  contestByUuid: Record<string, ResolvedContestTiming>;
  contestByName: Record<string, ResolvedContestTiming>;
  contestLookup?: Record<string, AnyRecord>;
  splitLookup?: Record<string, AnyRecord>;
  timingPointLookup?: Record<string, ResolvedTimingPoint>;
  splitsByContest: Record<string, Array<Record<string, any>>>;
  timingPointsByContest: Record<string, Array<ResolvedTimingPoint>>;
  ageGroupsByContest: Record<string, Array<Record<string, any>>>;
  timingPointIndex?: Record<string, ResolvedTimingPoint>;
  byContest?: Record<string, Array<ResolvedTimingPoint>>;
  byUuid?: Record<string, ResolvedTimingPoint>;
  list?: ResolvedTimingPoint[];
  importedAt?: string | null;
  provider?: string | null;
  updatedAt?: string | number | null;
  meta?: AnyRecord | null;
  legSplitMappingsByContest?: Record<string, {
    event_id: string;
    contest_id: string;
    contest_name: string;
    legs: Array<{
      leg_index: number;
      leg_name: string;
      display_order: number;
      enabled: boolean;
      metadata?: AnyRecord;
    }>;
    splits: Array<{
      split_index: number;
      split_name: string;
      timing_point_id: string;
      timing_point_name: string;
      leg_index: number;
      display_order: number;
      distance?: number | null;
      split_type?: string | null;
      visibility?: 'visible' | 'hidden';
      metadata?: AnyRecord;
    }>;
    updated_at?: string;
    updated_by?: string;
    version?: string;
  }>;
  legSplitMappingUpdatedAt?: string | null;
  raceFlowByContest?: Record<string, {
    event_id: string;
    contest_id: string;
    contest_name: string;
    legs: Array<{
      leg_index: number;
      leg_name: string;
      display_order: number;
      enabled: boolean;
      metadata?: AnyRecord;
    }>;
    splits: Array<{
      split_index: number;
      split_name: string;
      timing_point_id: string;
      timing_point_name: string;
      leg_index: number;
      display_order: number;
      distance?: number | null;
      split_type?: string | null;
      visibility?: 'visible' | 'hidden';
      metadata?: AnyRecord;
    }>;
    sections?: Array<{
      leg_index: number;
      leg_name: string;
      display_order: number;
      splits: Array<Record<string, any>>;
    }>;
    updated_at?: string;
    updated_by?: string;
    version?: string;
  }>;
  raceFlowTimelineByContest?: Record<string, {
    event_id: string;
    contest_id: string;
    contest_name: string;
    legs: Array<Record<string, any>>;
    splits: Array<Record<string, any>>;
    sections?: Array<Record<string, any>>;
    updated_at?: string;
    updated_by?: string;
    version?: string;
  }>;
  raceFlowTimelineUpdatedAt?: string | null;
};

const LEG_ALIASES: Array<{ test: RegExp; value: string }> = [
  { test: /swim/i, value: 'SWIM' },
  { test: /t1|transition\s*1|transi?tion\s*a?/i, value: 'T1' },
  { test: /bike/i, value: 'BIKE' },
  { test: /t2|transition\s*2/i, value: 'T2' },
  { test: /run1|run\s*split\s*1/i, value: 'RUN1' },
  { test: /run2|run\s*split\s*2/i, value: 'RUN2' },
  { test: /run/i, value: 'RUN' },
  { test: /finish|fini(sh)?/i, value: 'FINISH' },
];

const LEG_ORDER = ['SWIM', 'T1', 'BIKE', 'T2', 'RUN1', 'RUN2', 'RUN', 'FINISH'];

function canonicalLeg(value: any) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  for (const alias of LEG_ALIASES) {
    if (alias.test.test(normalized)) return alias.value;
  }
  return normalized.toUpperCase();
}

function sortLegTokens(values: Array<any>) {
  const seen = new Set<string>();
  const tokens = values
    .map((value) => canonicalLeg(value))
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeKey(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return tokens.sort((a, b) => {
    const indexA = LEG_ORDER.indexOf(a);
    const indexB = LEG_ORDER.indexOf(b);
    if (indexA !== indexB) return (indexA === -1 ? LEG_ORDER.length : indexA) - (indexB === -1 ? LEG_ORDER.length : indexB);
    return a.localeCompare(b);
  });
}

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeString(value: any): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeKey(value: any): string {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function dedupeObjectsByKey<T extends AnyRecord>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = normalizeKey(keyFn(item));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function uniqueRowsByKey<T extends AnyRecord>(rows: T[], keyFn: (row: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = normalizeKey(keyFn(row));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function toNumber(value: any): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstString(...values: any[]): string {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return '';
}

function collectRoots(source: AnyRecord) {
  return {
    course: source?.course || {},
    timingRules: source?.timing_rules || source?.timingRules || {},
    timings: source?.timings || source?.timingConfiguration || source?.timing_configuration || {},
  };
}

function collectContests(source: AnyRecord, categoryTimingConfiguration?: Array<Record<string, any>> | null) {
  const { course, timingRules, timings } = collectRoots(source);
  return dedupeObjectsByKey([
    ...asArray(source?.contests),
    ...asArray(course?.contests),
    ...asArray(timingRules?.contests),
    ...asArray(timings?.contests),
    ...asArray(categoryTimingConfiguration),
  ].filter((item) => item && typeof item === 'object'), (item) => firstString(item?.UUID, item?.uuid, item?.contestUuid, item?.contest_uuid, item?.id, item?.name, item?.Name));
}

function collectSplits(source: AnyRecord) {
  const { course, timingRules, timings } = collectRoots(source);
  return dedupeObjectsByKey([
    ...asArray(source?.splits),
    ...asArray(course?.splits),
    ...asArray(timingRules?.splits),
    ...asArray(timings?.splits),
  ].filter((item) => item && typeof item === 'object'), (item) => firstString(item?.UUID, item?.uuid, item?.splitUuid, item?.split_uuid, item?.id, item?.name, item?.Name));
}

function collectTimingPoints(source: AnyRecord) {
  const { course, timingRules, timings } = collectRoots(source);
  return dedupeObjectsByKey([
    ...asArray(source?.timingPoints),
    ...asArray(source?.timing_points),
    ...asArray(course?.timingPoints),
    ...asArray(course?.timing_points),
    ...asArray(timingRules?.timingPoints),
    ...asArray(timingRules?.timing_points),
    ...asArray(timings?.timingPoints),
    ...asArray(timings?.timing_points),
  ].filter((item) => item && typeof item === 'object'), (item) => firstString(item?.UUID, item?.uuid, item?.TimingPointUUID, item?.timingPointUUID, item?.timing_point_uuid, item?.id, item?.name, item?.Name));
}

function collectLegs(source: AnyRecord) {
  const { course, timingRules, timings } = collectRoots(source);
  const raw = [
    ...asArray(source?.legs),
    ...asArray(course?.legs),
    ...asArray(timingRules?.legs),
    ...asArray(timings?.legs),
  ];
  return uniq(raw.map((item) => normalizeString(item?.name || item?.label || item?.leg || item)).filter(Boolean));
}

function collectAgeGroups(source: AnyRecord) {
  const { course, timingRules, timings } = collectRoots(source);
  return dedupeObjectsByKey([
    ...asArray(source?.ageGroups),
    ...asArray(source?.age_groups),
    ...asArray(course?.ageGroups),
    ...asArray(course?.age_groups),
    ...asArray(timingRules?.ageGroups),
    ...asArray(timingRules?.age_groups),
    ...asArray(timings?.ageGroups),
    ...asArray(timings?.age_groups),
  ].filter((item) => item && typeof item === 'object'), (item) => firstString(item?.UUID, item?.uuid, item?.id, item?.code, item?.name, item?.Name, item?.label));
}

function collectDevices(source: AnyRecord) {
  const { course, timingRules, timings } = collectRoots(source);
  return dedupeObjectsByKey([
    ...asArray(source?.devices),
    ...asArray(course?.devices),
    ...asArray(timingRules?.devices),
    ...asArray(timings?.devices),
  ].filter((item) => item && typeof item === 'object'), (item) => firstString(item?.UUID, item?.uuid, item?.id, item?.name, item?.label));
}

function getContestUuid(row: AnyRecord | null | undefined, fallbackIndex: number) {
  return normalizeString(
    row?.contestUuid ?? row?.contest_uuid ?? row?.ContestUUID ?? row?.ContestUuid ?? row?.UUID ?? row?.uuid ?? row?.contestId ?? row?.contest_id ?? row?.categoryId ?? row?.category_id ?? row?.id ?? `contest-${fallbackIndex + 1}`,
  );
}

function getContestName(row: AnyRecord | null | undefined, fallbackIndex: number) {
  return firstString(row?.contestName, row?.contest_name, row?.name, row?.Name, row?.label, row?.categoryName, row?.category_name, row?.contestUuid, row?.contest_uuid, row?.UUID, row?.uuid, row?.id);
}

function getSplitContestCandidates(split: AnyRecord) {
  return uniq([
    split?.contestUuid,
    split?.contest_uuid,
    split?.ContestUUID,
    split?.contestId,
    split?.contest_id,
    split?.categoryId,
    split?.category_id,
    split?.contest,
    split?.contestName,
    split?.contest_name,
    split?.category,
    split?.categoryName,
    split?.category_name,
  ].map(normalizeString).filter(Boolean));
}

function getTimingPointContestCandidates(point: AnyRecord) {
  return uniq([
    point?.contestUuid,
    point?.contest_uuid,
    point?.ContestUUID,
    point?.contestId,
    point?.contest_id,
    point?.categoryId,
    point?.category_id,
    point?.contest,
    point?.contestName,
    point?.contest_name,
    point?.category,
    point?.categoryName,
    point?.category_name,
    point?.splitContestUuid,
    point?.splitContestUUID,
  ].map(normalizeString).filter(Boolean));
}

function getSplitUuid(split: AnyRecord) {
  return normalizeString(split?.UUID ?? split?.uuid ?? split?.splitUuid ?? split?.split_uuid ?? split?.id ?? '');
}

function getSplitTimingPointUuid(split: AnyRecord) {
  return normalizeString(
    split?.TimingPointUUID ?? split?.timingPointUUID ?? split?.timingPointUuid ?? split?.timing_point_uuid ?? split?.TimingPointId ?? split?.timingPointId ?? split?.timing_point_id ?? '',
  );
}

function getSplitDistance(split: AnyRecord) {
  const meters = toNumber(split?.DistanceFromStart ?? split?.distanceFromStart ?? split?.distance ?? split?.meters ?? split?.Distance);
  if (meters === null) return null;
  const unit = normalizeString(split?.DistanceFromStartUnit ?? split?.distanceFromStartUnit ?? split?.DistanceUnit ?? split?.distanceUnit).toLowerCase();
  return unit.includes('km') || unit.includes('kilomet') ? meters * 1000 : meters;
}

function isFinishSplit(split: AnyRecord, splitName: string) {
  return Boolean(split?.isFinish || split?.finish || /finish/i.test(`${split?.TypeOfSport || split?.typeOfSport || ''} ${splitName}`));
}

function isStartSplit(split: AnyRecord, splitName: string) {
  return Boolean(split?.isStart || /^start$/i.test(splitName) || /start/i.test(`${split?.TypeOfSport || split?.typeOfSport || ''} ${splitName}`));
}

function isTransitionSplit(split: AnyRecord, splitName: string) {
  return Boolean(split?.isTransition || split?.transition || /transition|\bT1\b|\bT2\b/i.test(`${split?.TypeOfSport || split?.typeOfSport || ''} ${splitName}`));
}

function sortByDistance(rows: Array<AnyRecord>) {
  return [...rows].sort((a, b) => {
    const aOrder = toNumber(a?.Order ?? a?.order ?? a?.Index ?? a?.index) ?? 0;
    const bOrder = toNumber(b?.Order ?? b?.order ?? b?.Index ?? b?.index) ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aDistance = getSplitDistance(a) ?? Number.MAX_SAFE_INTEGER;
    const bDistance = getSplitDistance(b) ?? Number.MAX_SAFE_INTEGER;
    return aDistance - bDistance;
  });
}

function inferLeg(raw: AnyRecord, label: string, providerCode: string) {
  const combined = `${normalizeString(raw?.leg)} ${label} ${providerCode}`;
  for (const alias of LEG_ALIASES) {
    if (alias.test.test(combined)) return alias.value;
  }
  return normalizeString(raw?.leg) || null;
}

function inferMarkerType(raw: AnyRecord, label: string, providerCode: string): ResolvedTimingPoint['markerType'] {
  const combined = `${normalizeString(raw?.markerType)} ${label} ${providerCode}`;
  if (/finish/i.test(combined)) return 'finish';
  if (/transition|t1|t2/i.test(combined)) return 'transition';
  if (/medical/i.test(combined)) return 'medical';
  return 'checkpoint';
}

function inferDisplayName(raw: AnyRecord, fallbackIndex: number) {
  return firstString(raw?.displayName, raw?.label, raw?.name, raw?.splitName, raw?.splitCode, raw?.code, `Timing Point ${fallbackIndex + 1}`);
}

function inferProviderCode(raw: AnyRecord, fallbackIndex: number) {
  return firstString(raw?.providerCode, raw?.splitCode, raw?.code, raw?.id, raw?.uuid, `TP_${fallbackIndex + 1}`);
}

function inferProviderId(raw: AnyRecord, fallbackIndex: number) {
  return firstString(raw?.providerId, raw?.id, raw?.uuid, raw?.splitId, `tp-${fallbackIndex + 1}`);
}

function normalizeTimingPoint(raw: AnyRecord, fallbackIndex: number, eventId?: string | null): ResolvedTimingPoint {
  const displayName = inferDisplayName(raw, fallbackIndex);
  const providerCode = inferProviderCode(raw, fallbackIndex);
  const providerId = inferProviderId(raw, fallbackIndex);
  const canonicalUuid = firstString(
    raw?.UUID,
    raw?.uuid,
    raw?.TimingPointUUID,
    raw?.timingPointUUID,
    raw?.timing_point_uuid,
    raw?.TimingPointId,
    raw?.timingPointId,
    raw?.timing_point_id,
    raw?.providerUuid,
    raw?.providerId,
    raw?.providerCode,
  ) || null;
  const metersValue = toNumber(raw?.meters);
  const distance = toNumber(raw?.distanceKm ?? raw?.distance ?? raw?.km ?? (metersValue !== null ? metersValue / 1000 : null));
  const order = toNumber(raw?.order ?? raw?.index ?? fallbackIndex + 1) ?? (fallbackIndex + 1);
  const markerType = inferMarkerType(raw, displayName, providerCode);
  const leg = inferLeg(raw, displayName, providerCode);
  const latitude = toNumber(raw?.latitude ?? raw?.lat ?? raw?.location?.lat) ?? 0;
  const longitude = toNumber(raw?.longitude ?? raw?.lng ?? raw?.lon ?? raw?.location?.lng) ?? 0;
  const shortName = firstString(raw?.shortName, raw?.short_name, providerCode, displayName.slice(0, 6)) || displayName;
  const icon = /swim/i.test(String(leg || displayName))
    ? 'swim'
    : /bike|cycle/i.test(String(leg || displayName))
      ? 'bike'
      : /run|trail|marathon/i.test(String(leg || displayName))
        ? 'run'
        : markerType === 'transition'
          ? 'transition'
          : markerType === 'finish'
            ? 'finish'
            : 'checkpoint';
  const leaderboard = raw?.leaderboard === true || raw?.isLeaderboard === true || raw?.leaderboardMarkerId !== undefined;
  const visible = raw?.visible !== false;

  return {
    id: firstString(raw?.id, providerId, providerCode, `timing-point-${fallbackIndex + 1}`),
    canonicalUuid,
    providerId,
    providerCode,
    displayName,
    shortName,
    eventId: eventId || null,
    distance,
    distanceKm: distance,
    leg,
    order,
    latitude,
    longitude,
    markerType,
    icon,
    leaderboard,
    transition: markerType === 'transition',
    finish: markerType === 'finish',
    visible,
    isLeaderboard: leaderboard,
    isTransition: markerType === 'transition',
    isFinish: markerType === 'finish',
    raw,
  };
}

function normalizeContest(raw: AnyRecord, fallbackIndex: number): AnyRecord {
  const contestUuid = getContestUuid(raw, fallbackIndex);
  const contestName = getContestName(raw, fallbackIndex);
  const distance = toNumber(raw?.distance ?? raw?.distanceKm ?? raw?.distance_km ?? raw?.distanceMeters ?? raw?.distance_meters);
  const splits = asArray(raw?.splits);
  const timingPoints = asArray(raw?.timingPoints);
  const ageGroups = asArray(raw?.ageGroups);
  const devices = asArray(raw?.devices);

  return {
    ...raw,
    id: firstString(raw?.id, raw?.contestId, raw?.uuid, contestUuid),
    uuid: firstString(raw?.uuid, raw?.contestUuid, contestUuid),
    contestUuid,
    contestName,
    name: firstString(raw?.name, contestName),
    providerUuid: firstString(raw?.providerUuid, raw?.providerContestUuid, contestUuid) || null,
    provider: firstString(raw?.provider, raw?.source, raw?.sourceType, raw?.timingSource) || null,
    color: firstString(raw?.color, raw?.colour, raw?.themeColor) || null,
    distance,
    startTime: firstString(raw?.startTime, raw?.start_time) || null,
    status: firstString(raw?.status, raw?.state) || null,
    contest: raw,
    splits,
    timingPoints,
    ageGroups,
    splitCount: toNumber(raw?.splitCount ?? raw?.splitsCount ?? splits.length) ?? splits.length,
    timingPointsCount: toNumber(raw?.timingPointsCount ?? timingPoints.length) ?? timingPoints.length,
    ageGroupsCount: toNumber(raw?.ageGroupsCount ?? raw?.ageGroupCount ?? ageGroups.length) ?? ageGroups.length,
    devicesCount: toNumber(raw?.devicesCount ?? devices.length) ?? devices.length,
    legs: uniq(asArray(raw?.legs).map((leg) => normalizeString(leg?.name || leg?.label || leg?.leg || leg)).filter(Boolean)),
    participants: asArray(raw?.participants),
    leaderboard: asArray(raw?.leaderboard),
    statistics: raw?.statistics && typeof raw.statistics === 'object' ? { ...raw.statistics } : {},
  };
}

function buildContestLookup(contests: AnyRecord[]) {
  const lookup: Record<string, AnyRecord> = {};
  for (const [index, contest] of contests.entries()) {
    const contestUuid = getContestUuid(contest, index);
    if (!contestUuid) continue;
    lookup[contestUuid] = contest;
    lookup[normalizeKey(contestUuid)] = contest;
    const name = getContestName(contest, index);
    if (name) lookup[normalizeKey(name)] = contest;
  }
  return lookup;
}

function buildSplitLookup(splits: AnyRecord[]) {
  const lookup: Record<string, AnyRecord> = {};
  for (const [index, split] of splits.entries()) {
    const splitUuid = getSplitUuid(split);
    if (!splitUuid) continue;
    lookup[splitUuid] = split;
    lookup[normalizeKey(splitUuid)] = split;
    const altKey = firstString(split?.id, split?.uuid, split?.UUID, split?.splitUuid, split?.split_uuid, split?.name, split?.Name, `split-${index + 1}`);
    if (altKey) lookup[normalizeKey(altKey)] = split;
  }
  return lookup;
}

function buildTimingPointLookup(timingPoints: ResolvedTimingPoint[]) {
  const lookup: Record<string, ResolvedTimingPoint> = {};
  for (const point of timingPoints) {
    const canonicalKey = firstString(point?.canonicalUuid, point?.id, point?.providerId, point?.providerCode, point?.raw?.UUID, point?.raw?.uuid, point?.raw?.TimingPointUUID, point?.raw?.timingPointUUID, point?.raw?.timing_point_uuid);
    if (!canonicalKey) continue;
    lookup[canonicalKey] = point;
    lookup[normalizeKey(canonicalKey)] = point;
  }
  return lookup;
}

function normalizeAgeGroups(source: AnyRecord) {
  return collectAgeGroups(source).map((ageGroup) => {
    const uuid = firstString(ageGroup?.UUID, ageGroup?.uuid, ageGroup?.id, ageGroup?.code);
    return {
      uuid,
      id: uuid,
      provider: 'feibot',
      providerAgeGroupUuid: uuid,
      name: firstString(ageGroup?.Name, ageGroup?.name, ageGroup?.label, ageGroup?.ageGroup, ageGroup?.code),
      label: firstString(ageGroup?.Name, ageGroup?.label, ageGroup?.name, ageGroup?.ageGroup, ageGroup?.code),
      abbreviation: firstString(ageGroup?.Abbreviation, ageGroup?.abbreviation, ageGroup?.code, ageGroup?.label, ageGroup?.Name),
      fromAge: Number.isFinite(Number(ageGroup?.FromAge ?? ageGroup?.fromAge)) ? Number(ageGroup?.FromAge ?? ageGroup?.fromAge) : null,
      toAge: Number.isFinite(Number(ageGroup?.ToAge ?? ageGroup?.toAge)) ? Number(ageGroup?.ToAge ?? ageGroup?.toAge) : null,
      gender: firstString(ageGroup?.Gender, ageGroup?.gender) || null,
      higherValueEqual: Boolean(ageGroup?.HigherValueEqual ?? ageGroup?.higherValueEqual ?? false),
      raw: ageGroup,
    };
  }).filter((ageGroup) => Boolean(ageGroup.uuid && ageGroup.name));
}

function timingPointKey(point: AnyRecord) {
  return firstString(point?.id, point?.uuid, point?.providerId, point?.providerCode, point?.UUID, point?.timingPointUuid, point?.timingPointUUID, point?.timing_point_uuid, point?.timingPointId, point?.timing_point_id);
}

function contestMatchesCandidate(candidate: string, contest: ResolvedContestTiming) {
  const normalizedCandidate = normalizeKey(candidate);
  if (!normalizedCandidate) return false;
  return normalizedCandidate === normalizeKey(contest.contestUuid)
    || normalizedCandidate === normalizeKey(contest.uuid)
    || normalizedCandidate === normalizeKey(contest.id)
    || normalizedCandidate === normalizeKey(contest.contestName)
    || normalizedCandidate === normalizeKey(contest.name);
}

function buildContestIndex(contests: AnyRecord[], splits: AnyRecord[], timingPoints: AnyRecord[], ageGroups: AnyRecord[], eventId?: string | null) {
  const contestIndex: Record<string, ResolvedContestTiming> = {};
  const contestByUuid: Record<string, ResolvedContestTiming> = {};
  const contestByName: Record<string, ResolvedContestTiming> = {};
  const splitsByContest: Record<string, Array<AnyRecord>> = {};
  const timingPointsByContest: Record<string, Array<ResolvedTimingPoint>> = {};
  const ageGroupsByContest: Record<string, Array<AnyRecord>> = {};
  const contestLookup = new Map<string, AnyRecord>();
  const timingPointNameLookup = new Map<string, string>();

  const normalizedTimingPoints = timingPoints.map((point, index) => normalizeTimingPoint(point, index, eventId));
  normalizedTimingPoints.forEach((point, index) => {
    const rawPoint = timingPoints[index] || {};
    const name = firstString(rawPoint?.Name, rawPoint?.name, rawPoint?.displayName, point.displayName, point.shortName, point.canonicalUuid || point.id);
    const keys = [
      rawPoint?.UUID,
      rawPoint?.uuid,
      rawPoint?.TimingPointUUID,
      rawPoint?.timingPointUUID,
      rawPoint?.timing_point_uuid,
      rawPoint?.TimingPointId,
      rawPoint?.timingPointId,
      rawPoint?.timing_point_id,
      point.canonicalUuid,
      point.id,
    ];
    for (const key of keys) {
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey || timingPointNameLookup.has(normalizedKey)) continue;
      timingPointNameLookup.set(normalizedKey, name);
    }
  });

  const contestEntries = contests.map((contest, index) => {
    const normalizedContest = normalizeContest(contest, index);
    const rawContest = normalizedContest.contest || contest || {};
    const contestUuid = normalizedContest.contestUuid;
    const contestName = firstString(
      rawContest?.Name,
      rawContest?.name,
      rawContest?.contestName,
      normalizedContest.contestName,
      normalizedContest.name,
      contestUuid,
    );
    const normalizedContestRecord: AnyRecord = {
      ...normalizedContest,
      contestName,
      name: firstString(rawContest?.Name, rawContest?.name, rawContest?.contestName, contestName),
      contest: {
        ...rawContest,
        contestUuid,
        contestName,
        name: firstString(rawContest?.Name, rawContest?.name, rawContest?.contestName, contestName),
      },
    };
    const entry: ResolvedContestTiming = {
      id: normalizedContestRecord.id,
      uuid: normalizedContestRecord.uuid,
      contestUuid,
      contestName,
      name: normalizedContestRecord.name,
      providerUuid: normalizedContestRecord.providerUuid ?? null,
      provider: normalizedContestRecord.provider ?? null,
      color: normalizedContestRecord.color ?? null,
      distance: normalizedContestRecord.distance ?? null,
      startTime: normalizedContestRecord.startTime ?? null,
      status: normalizedContestRecord.status ?? null,
      contest: normalizedContestRecord,
      splits: [],
      timingPoints: [],
      ageGroups: [...ageGroups],
      legs: [],
      participants: asArray(normalizedContest.participants),
      leaderboard: asArray(normalizedContest.leaderboard),
      statistics: normalizedContest.statistics && typeof normalizedContest.statistics === 'object' ? { ...normalizedContest.statistics } : {},
    };

    contestLookup.set(normalizeKey(contestUuid), normalizedContestRecord);
    contestLookup.set(normalizeKey(normalizedContestRecord.uuid), normalizedContestRecord);
    contestLookup.set(normalizeKey(contestName), normalizedContestRecord);
    contestLookup.set(normalizeKey(normalizedContestRecord.name), normalizedContestRecord);

    contestIndex[contestUuid] = entry;
    contestByUuid[contestUuid] = entry;
    contestByUuid[normalizedContestRecord.uuid] = entry;
    const nameKey = normalizeKey(contestName);
    if (nameKey) contestByName[nameKey] = entry;
    splitsByContest[contestUuid] = [];
    timingPointsByContest[contestUuid] = [];
    ageGroupsByContest[contestUuid] = [...ageGroups];
    return entry;
  });

  const assignContests = <T extends AnyRecord>(candidateFn: (row: T) => string[]) => (row: T) => {
    const candidates = candidateFn(row);
    const matches = candidates
      .map((candidate) => contestIndex[normalizeString(candidate)] || contestIndex[normalizeKey(candidate)] || null)
      .filter(Boolean) as ResolvedContestTiming[];
    if (matches.length > 0) return uniq(matches);
    if (contestEntries.length === 1) return [contestEntries[0]];
    return [] as ResolvedContestTiming[];
  };

  const splitAssignments = new Map<string, Set<string>>();
  for (const split of splits) {
    const splitUuid = getSplitUuid(split);
    const contestsForSplit = assignContests(getSplitContestCandidates)(split);
    for (const contest of contestsForSplit) {
      const key = contest.contestUuid;
      if (!splitAssignments.has(key)) splitAssignments.set(key, new Set<string>());
      const uniqueKey = splitUuid || normalizeString(split?.name || split?.Name || split?.label || '');
      if (uniqueKey && splitAssignments.get(key)?.has(uniqueKey)) continue;
      if (uniqueKey) splitAssignments.get(key)?.add(uniqueKey);
      splitsByContest[key].push(split);
    }
  }

  for (const contest of contestEntries) {
    const rawContest = contestLookup.get(normalizeKey(contest.contestUuid)) || contest.contest || contest;
    const contestName = firstString(rawContest?.Name, rawContest?.name, rawContest?.contestName, contest.contestName, contest.name, contest.contestUuid);
    const contestSplits = sortByDistance(uniqueRowsByKey(
      [...(splitsByContest[contest.contestUuid] || []), ...asArray(rawContest?.splits)],
      (split) => firstString(getSplitUuid(split), split?.UUID, split?.uuid, split?.name, split?.Name, split?.label, split?.Label, split?.contestUuid, split?.contest_uuid),
    )).map((split, splitIndex) => {
      const splitUuid = getSplitUuid(split);
      const splitName = firstString(split?.Name, split?.name, split?.Label, split?.label, splitUuid, `Split ${splitIndex + 1}`);
      const timingPointUuid = getSplitTimingPointUuid(split);
      const timingPointName = timingPointUuid
        ? firstString(
            timingPointNameLookup.get(normalizeKey(timingPointUuid)),
            split?.timingPoint?.Name,
            split?.timingPoint?.name,
            split?.timingPointName,
            split?.TimingPointName,
          ) || null
        : null;
      const distanceMeters = getSplitDistance(split);
      return {
        uuid: splitUuid,
        splitUuid,
        contestUuid: contest.contestUuid,
        contestName,
        order: Number(split?.Order ?? split?.order ?? split?.Index ?? split?.index ?? splitIndex + 1) || splitIndex + 1,
        splitName,
        timingPointUuid: timingPointUuid || null,
        timingPointName,
        timingPointExists: timingPointUuid ? Boolean(timingPointName) : false,
        distance: distanceMeters,
        distanceMeters,
        distanceKm: distanceMeters !== null ? distanceMeters / 1000 : null,
        distanceUnit: distanceMeters !== null ? 'meters' : null,
        isMandatory: split?.isMandatory !== false && split?.mandatory !== false,
        isFinish: isFinishSplit(split, splitName),
        isStart: isStartSplit(split, splitName),
        isTransition: isTransitionSplit(split, splitName),
        provider: normalizeString(split?.provider || rawContest?.provider || contest.provider || 'feibot') || 'feibot',
        raw: split || null,
      };
    });
    const contestTimingPointIds = new Set<string>();
    for (const split of contestSplits) {
      const timingPointUuid = getSplitTimingPointUuid(split);
      if (timingPointUuid) contestTimingPointIds.add(normalizeKey(timingPointUuid));
    }

    const contestMatchedTimingPoints = normalizedTimingPoints
      .filter((point) => {
        const pointId = firstString(point?.canonicalUuid, point?.id, point?.providerId, point?.providerCode);
        const candidates = getTimingPointContestCandidates(point.raw || point);
        const matchesContest = candidates.some((candidate) => contestMatchesCandidate(candidate, contest));
        const matchesSplit = contestTimingPointIds.size > 0 && contestTimingPointIds.has(normalizeKey(pointId));
        return matchesContest || matchesSplit || contestEntries.length === 1;
      });

    const contestRawTimingPoints = asArray(rawContest?.timingPoints).map((point, index) => normalizeTimingPoint(point, index, eventId));
    const contestTimingPoints = uniqueRowsByKey(
      [...contestMatchedTimingPoints, ...contestRawTimingPoints],
      (point) => timingPointKey(point),
    ).sort((a, b) => a.order - b.order);

    const contestAgeGroups = uniqueRowsByKey(
      [...(ageGroupsByContest[contest.contestUuid] || []), ...asArray(rawContest?.ageGroups)],
      (ageGroup) => firstString(ageGroup?.id, ageGroup?.uuid, ageGroup?.code, ageGroup?.name, ageGroup?.label),
    );

    contestIndex[contest.contestUuid].splits = contestSplits;
    contestIndex[contest.contestUuid].timingPoints = contestTimingPoints;
    contestIndex[contest.contestUuid].ageGroups = contestAgeGroups;
    contestIndex[contest.contestUuid].legs = sortLegTokens([
      ...asArray(rawContest?.legs).map((leg) => normalizeString(leg?.name || leg?.label || leg?.leg || leg)).filter(Boolean),
      ...contestSplits.map((split) => normalizeString(split?.raw?.leg || split?.raw?.Leg || split?.splitName || split?.raw?.name || split?.raw?.label)).filter(Boolean),
      ...contestIndex[contest.contestUuid].timingPoints.map((point) => normalizeString(point.leg)).filter(Boolean),
    ]);
    contestIndex[contest.contestUuid].participants = asArray(rawContest?.participants);
    contestIndex[contest.contestUuid].leaderboard = asArray(rawContest?.leaderboard);
    contestIndex[contest.contestUuid].statistics = {
      ...(contestIndex[contest.contestUuid].statistics || {}),
      splitCount: contestSplits.length,
      timingPointCount: contestIndex[contest.contestUuid].timingPoints.length,
      ageGroupCount: Array.isArray(contestIndex[contest.contestUuid].ageGroups) ? contestIndex[contest.contestUuid].ageGroups.length : 0,
      participantCount: contestIndex[contest.contestUuid].participants.length,
    };

    contestByUuid[contest.contestUuid] = contestIndex[contest.contestUuid];
    contestByUuid[contest.uuid] = contestIndex[contest.contestUuid];
    const nameKey = normalizeKey(contestName);
    if (nameKey) contestByName[nameKey] = contestIndex[contest.contestUuid];
    timingPointsByContest[contest.contestUuid] = contestIndex[contest.contestUuid].timingPoints;
  }

  return { contestIndex, contestByUuid, contestByName, splitsByContest, timingPointsByContest, ageGroupsByContest };
}

function buildContestFallbacksFromCategoryTimingConfiguration(categoryTimingConfiguration: Array<Record<string, any>> | null | undefined) {
  if (!Array.isArray(categoryTimingConfiguration)) return [];
  return categoryTimingConfiguration
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      ...item,
      contestUuid: getContestUuid(item, index),
      contestName: getContestName(item, index),
      name: getContestName(item, index),
      id: firstString(item?.id, item?.categoryId, item?.contestUuid, item?.contestId, `contest-${index + 1}`),
      uuid: firstString(item?.uuid, item?.contestUuid, item?.contestId, `contest-${index + 1}`),
    }));
}

export function buildResolvedTimingConfiguration(input: {
  eventId?: string | null;
  cloud?: Record<string, any> | null;
  manual?: Record<string, any> | null;
  categoryTimingConfiguration?: Array<Record<string, any>> | null;
  sourceHint?: TimingConfigurationSource | null;
  importedAt?: string | null;
  provider?: string | null;
}): ResolvedTimingConfiguration {
  const source = input.cloud && Object.keys(input.cloud).length > 0 ? input.cloud : (input.manual || {});
  const fallbackContests = buildContestFallbacksFromCategoryTimingConfiguration(input.categoryTimingConfiguration);
  const contests = collectContests(source, input.categoryTimingConfiguration);
  const contestSource = contests.length > 0 ? contests : fallbackContests;
  const timingPointsRaw = collectTimingPoints(source);
  const splitsRaw = collectSplits(source);
  const devices = collectDevices(source);
  const normalizedAgeGroups = normalizeAgeGroups(source);
  const sourceLegs = collectLegs(source);
  const contestIndexData = buildContestIndex(contestSource, splitsRaw, timingPointsRaw, normalizedAgeGroups, input.eventId || null);
  const contestValues = Object.values(contestIndexData.contestIndex);
  const timingPointsFallback = timingPointsRaw.map((point, index) => normalizeTimingPoint(point, index, input.eventId || null));
  const mergedTimingPoints = contestValues.flatMap((contest) => contest.timingPoints).length > 0
    ? dedupeObjectsByKey(contestValues.flatMap((contest) => contest.timingPoints), (point) => firstString(point?.canonicalUuid, point?.id, point?.providerId, point?.providerCode, point?.raw?.UUID, point?.raw?.uuid, point?.raw?.TimingPointUUID, point?.raw?.timingPointUUID, point?.raw?.timing_point_uuid))
    : dedupeObjectsByKey(timingPointsFallback, (point) => firstString(point?.canonicalUuid, point?.id, point?.providerId, point?.providerCode, point?.raw?.UUID, point?.raw?.uuid, point?.raw?.TimingPointUUID, point?.raw?.timingPointUUID, point?.raw?.timing_point_uuid));
  const contestLookup = buildContestLookup(contestSource);
  const splitLookup = buildSplitLookup(splitsRaw);
  const timingPointLookup = buildTimingPointLookup(mergedTimingPoints);
  const legs = sortLegTokens([
    ...sourceLegs,
    ...contestValues.flatMap((contest) => contest.legs),
    ...mergedTimingPoints.map((point) => normalizeString(point.leg)).filter(Boolean),
  ]);
  const contestArray = contestValues.map((contest) => ({ ...contest.contest }));

  return {
    eventId: input.eventId || null,
    source: input.sourceHint || 'cloud',
    course: {
      legs,
      timingPoints: mergedTimingPoints,
      splits: splitsRaw,
      contests: contestArray,
    },
    contests: contestValues.map((contest) => ({
      ...contest.contest,
      contestUuid: contest.contestUuid,
      contestName: contest.contestName,
      splits: contest.splits,
      timingPoints: contest.timingPoints,
      ageGroups: contest.ageGroups,
      legs: contest.legs,
      participants: contest.participants,
      leaderboard: contest.leaderboard,
      statistics: contest.statistics,
    })),
    timingPoints: mergedTimingPoints,
    splits: splitsRaw,
    devices,
    legs,
    ageGroups: normalizedAgeGroups.map((ageGroup) => ageGroup.name),
    contestIndex: contestIndexData.contestIndex,
    contestByUuid: contestIndexData.contestByUuid,
    contestByName: contestIndexData.contestByName,
    contestLookup,
    splitLookup,
    timingPointLookup,
    timingPointIndex: timingPointLookup,
    byContest: contestIndexData.timingPointsByContest,
    byUuid: timingPointLookup,
    list: mergedTimingPoints,
    splitsByContest: contestIndexData.splitsByContest,
    timingPointsByContest: contestIndexData.timingPointsByContest,
    ageGroupsByContest: contestIndexData.ageGroupsByContest,
    importedAt: input.importedAt || null,
    provider: input.provider || 'feibot',
    updatedAt: input.importedAt || null,
    meta: {
      importedAt: input.importedAt || null,
      provider: input.provider || 'feibot',
      contestCount: contestValues.length,
      splitCount: splitsRaw.length,
      timingPointCount: mergedTimingPoints.length,
      ageGroupCount: normalizedAgeGroups.length,
    },
  };
}
