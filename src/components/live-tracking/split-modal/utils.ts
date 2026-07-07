import { formatSecondsToHMS } from '@/lib/utils';
import type { LiveAthlete, Split } from '@/lib/types';
import type { ResolvedTimingConfiguration, ResolvedTimingPoint } from '@/lib/timingConfiguration';
import type { DynamicSplitSummaryTableProps, PointState, SectionGroup, SectionThemeKey, SplitModalModel, TimingRow } from './types';

const countryNameToCode: Record<string, string> = {
  India: 'IN',
  'United States': 'US',
  'USA / Canada': 'US',
  USA: 'US',
  US: 'US',
  'United Kingdom': 'GB',
  UK: 'GB',
  Canada: 'CA',
  Australia: 'AU',
  Germany: 'DE',
  France: 'FR',
  Singapore: 'SG',
  'United Arab Emirates': 'AE',
  Afghanistan: 'AF',
  Brazil: 'BR',
  China: 'CN',
  Egypt: 'EG',
  Japan: 'JP',
  Mexico: 'MX',
  Nigeria: 'NG',
  Russia: 'RU',
  'South Africa': 'ZA',
  Other: 'XX',
};

export const getCountryFlagEmoji = (countryName?: string | null): string => {
  const normalized = String(countryName || '').trim();
  if (!normalized) return '';

  const explicitCode = normalized.length === 2 ? normalized.toUpperCase() : countryNameToCode[normalized];
  if (!explicitCode || explicitCode === 'XX') return '';

  return String.fromCodePoint(...Array.from(explicitCode).map((char) => 0x1f1e6 + char.toUpperCase().charCodeAt(0) - 65));
};

export const formatDistance = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const rounded = Math.round(Number(value) * 100) / 100;
  if (rounded === 0) return '0 km';
  if (Number.isInteger(rounded)) return `${rounded.toFixed(0)} km`;
  if (Math.abs(rounded * 10 - Math.round(rounded * 10)) < 1e-8) return `${rounded.toFixed(1).replace(/\.0$/, '')} km`;
  return `${rounded.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')} km`;
};

export const formatSpeed = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '—';
  return `${value.toFixed(2)} km/h`;
};

export const formatPace = (seconds: number | null | undefined, unit: '/km' | '/100m' = '/km') => {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const text = hrs > 0
    ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${text} ${unit}`;
};

export const formatTimeOfDay = (secondsFromEpoch?: number | null) => {
  if (!secondsFromEpoch || !Number.isFinite(secondsFromEpoch)) return '—';
  return new Date(secondsFromEpoch * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export const formatAgeGroup = (value?: string | null) => String(value || '').trim() || '—';
export const resolveAthleteAgeGroup = (athlete: LiveAthlete | Record<string, any> | null | undefined) => {
  const source = athlete as any;
  return formatAgeGroup(
    source?.ageGroup ||
    source?.ageCategory ||
    source?.registration?.ageGroup ||
    source?.registration?.selectedSubCategory ||
    source?.selectedSubCategory ||
    source?.categoryName ||
    null,
  );
};

export const resolveAthleteCountry = (athlete: LiveAthlete | Record<string, any> | null | undefined) => {
  const source = athlete as any;
  return String(
    source?.country ||
    source?.countryAtRace ||
    source?.country_name ||
    source?.countryName ||
    source?.countryCode ||
    source?.country_code ||
    source?.registration?.country ||
    source?.registration?.country_name ||
    source?.nationality ||
    source?.nation ||
    source?.profile?.country ||
    source?.profile?.countryName ||
    '',
  ).trim() || null;
};

export const getInitialsFallback = (name?: string | null) => {
  const n = String(name || '').trim();
  if (!n) return 'A';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

export const getRank = (athlete: LiveAthlete, type: 'overall' | 'gender' | 'category') => {
  const ranks = athlete.ranks as any;
  if (type === 'overall') return ranks?.overall?.rank ?? athlete.rank ?? null;
  if (type === 'gender') return ranks?.gender?.rank ?? null;
  return ranks?.ageGroup?.rank ?? ranks?.category?.rank ?? null;
};

export const getRankChip = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `#${value}`);
const normalize = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const getDistanceUnitValue = (value: unknown) => String(value || '').trim().toLowerCase();

const convertDistanceToKm = (value: unknown, unitValue?: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric === 0) return 0;
  const unit = getDistanceUnitValue(unitValue);
  if (unit.includes('km') || unit.includes('kilomet')) return numeric;
  if (unit.includes('meter') || unit === 'm') return numeric / 1000;
  if (numeric > 1000) return numeric / 1000;
  return numeric;
};

const normalizeDistanceFromPoint = (point: Record<string, any>) => {
  const unit = point?.distanceUnit ?? point?.distance_unit ?? point?.unit ?? point?.distanceType ?? point?.DistanceFromStartUnit ?? point?.DistanceUnit;
  const candidates = [
    point?.distanceKm,
    point?.distance_km,
    point?.km,
    point?.meters,
    point?.distanceMeters,
    point?.distance_meters,
    point?.distance,
    point?.distanceInMeters,
    point?.cumulativeDistance,
    point?.DistanceFromStart,
  ];

  for (const candidate of candidates) {
    const converted = convertDistanceToKm(candidate, unit);
    if (converted !== null) return converted;
  }

  return null;
};

const extractDistanceFromText = (text: unknown) => {
  const value = String(text ?? '').trim();
  if (!value) return null;

  const match = value.match(/(\d+(?:\.\d+)?)(?=\s*(?:km|kilometer|kilometre)?\b)/i)
    || value.match(/(\d+(?:\.\d+)?)(?!.*\d)/i);
  if (!match) return null;

  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
};

const getContestKey = (value: unknown) => normalize(value);

const getDateKey = (value: unknown) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.includes('T') ? text.slice(0, 10) : text;
};

const getParticipantContestDates = (source: Record<string, any> | null | undefined) => {
  const record = source as any;
  const contestDate = String(
    record?.contest_date ??
    record?.contestDate ??
    record?.contest_date_etd ??
    record?.contestDateEtd ??
    record?.contestETD ??
    record?.contestEtd ??
    record?.etd ??
    record?.eventDate ??
    record?.raceDate ??
    record?.date ??
    '',
  ).trim();
  const contestEtd = String(
    record?.contest_etd ??
    record?.contestETD ??
    record?.contestDateEtd ??
    record?.etd ??
    '',
  ).trim();
  return {
    contestDate: contestDate || null,
    contestEtd: contestEtd || null,
    contestDateKey: getDateKey(contestDate),
    contestEtdKey: getDateKey(contestEtd),
  };
};

const getContestDateKey = (contest: Record<string, any> | null | undefined) => getDateKey(
  contest?.ETD ??
  contest?.etd ??
  contest?.contestDate ??
  contest?.contest_date ??
  contest?.date ??
  contest?.startDate ??
  contest?.start_date ??
  contest?.raceDate ??
  contest?.eventDate ??
  '',
);

const buildTimingPointsFromTicketDefinition = (ticketDef: DynamicSplitSummaryTableProps['ticketDef'] | null | undefined): ResolvedTimingPoint[] => {
  const courseMaps: any = ticketDef?.courseMaps || {};
  const groups = [
    { rows: Array.isArray(courseMaps.swimSplits) ? courseMaps.swimSplits : [], leg: 'swim' },
    { rows: Array.isArray(courseMaps.bikeSplits) ? courseMaps.bikeSplits : [], leg: 'bike' },
    { rows: Array.isArray(courseMaps.run1Splits) ? courseMaps.run1Splits : [], leg: 'run' },
    { rows: Array.isArray(courseMaps.run2Splits) ? courseMaps.run2Splits : [], leg: 'run' },
    { rows: Array.isArray(courseMaps.runSplits) ? courseMaps.runSplits : [], leg: 'run' },
  ];

  const rows = groups.flatMap((group) => group.rows.map((row: Record<string, any>) => ({ ...row, _leg: group.leg })));
  if (rows.length === 0) return [];

  return rows.map((split: Record<string, any>, index: number) => {
    const distance = Number(split?.distance ?? split?.DistanceFromStart ?? split?.distanceFromStart ?? split?.meters ?? 0) || 0;
    const displayName = String(split?.name ?? split?.Name ?? split?.label ?? split?.Label ?? '').trim() || String(split?.uuid ?? split?.UUID ?? split?.id ?? '').trim();
    const canonicalUuid = String(split?.uuid ?? split?.UUID ?? split?.id ?? '').trim() || null;
    return {
      id: String(split?.id ?? split?.uuid ?? split?.UUID ?? '').trim() || `ticket-split-${index + 1}`,
      canonicalUuid,
      providerId: String(split?.id ?? split?.uuid ?? split?.UUID ?? '').trim() || null,
      providerCode: String(split?.label ?? split?.Label ?? split?.code ?? split?.Code ?? '').trim() || null,
      displayName,
      shortName: displayName,
      eventId: null,
      distance: distance > 0 ? distance : null,
      distanceKm: distance > 0 ? distance : null,
      leg: String(split?._leg || '').trim() || null,
      order: index + 1,
      latitude: Number(split?.latitude ?? split?.Latitude ?? 0) || 0,
      longitude: Number(split?.longitude ?? split?.Longitude ?? 0) || 0,
      markerType: 'checkpoint',
      icon: String(split?.icon || split?.Icon || split?._leg || 'checkpoint').trim() || 'checkpoint',
      leaderboard: false,
      transition: false,
      finish: false,
      visible: true,
      isLeaderboard: false,
      isTransition: false,
      isFinish: false,
      raw: { split, ticketDef },
    } as ResolvedTimingPoint;
  });
};

const getRowContestKey = (row: Record<string, any>) => getContestKey(
  row?.ContestUUID ??
  row?.contestUUID ??
  row?.contestUuid ??
  row?.contest_uuid ??
  row?.contest_id ??
  row?.contestId ??
  row?.contest ??
  row?.contest_name ??
  row?.contestName ??
  row?.category ??
  row?.categoryName ??
  row?.category_name ??
  '',
);

const getTimingRulesCollections = (timingConfiguration?: ResolvedTimingConfiguration | null) => {
  const source = timingConfiguration as any;
  const splitIndex = source?.splitIndex && typeof source.splitIndex === 'object' ? source.splitIndex : null;
  const splitIndexContests = splitIndex?.contestsByUuid && typeof splitIndex.contestsByUuid === 'object' ? Object.values(splitIndex.contestsByUuid) : [];
  const splitIndexSplits = splitIndex?.splitsByContest && typeof splitIndex.splitsByContest === 'object' ? Object.values(splitIndex.splitsByContest).flat() : [];
  const splitIndexTimingPoints = splitIndex?.timingPointLookup && typeof splitIndex.timingPointLookup === 'object' ? Object.values(splitIndex.timingPointLookup) : [];
  const contestIndex = source?.contestIndex && typeof source.contestIndex === 'object' ? source.contestIndex : null;
  const contestIndexValues = contestIndex ? Object.values(contestIndex) : [];
  const contests = Array.isArray(source?.contests)
    ? source.contests
    : splitIndexContests.length > 0
      ? splitIndexContests
    : contestIndexValues.length > 0
      ? contestIndexValues.map((contest: any) => contest?.contest || contest)
    : Array.isArray(source?.timing_rules?.contests)
      ? source.timing_rules.contests
      : Array.isArray(source?.course?.contests)
        ? source.course.contests
        : [];
  const splits = Array.isArray(source?.splits)
    ? source.splits
    : splitIndexSplits.length > 0
      ? splitIndexSplits
    : contestIndexValues.length > 0
      ? contestIndexValues.flatMap((contest: any) => Array.isArray(contest?.splits) ? contest.splits : [])
    : Array.isArray(source?.timing_rules?.splits)
      ? source.timing_rules.splits
      : Array.isArray(source?.course?.splits)
        ? source.course.splits
        : [];
  const timingPoints = Array.isArray(source?.timingPoints)
    ? source.timingPoints
    : splitIndexTimingPoints.length > 0
      ? splitIndexTimingPoints
    : contestIndexValues.length > 0
      ? contestIndexValues.flatMap((contest: any) => Array.isArray(contest?.timingPoints) ? contest.timingPoints : [])
    : Array.isArray(source?.timing_rules?.timing_points)
      ? source.timing_rules.timing_points
      : Array.isArray(source?.timing_rules?.timingPoints)
        ? source.timing_rules.timingPoints
        : Array.isArray(source?.course?.timingPoints)
          ? source.course.timingPoints
          : Array.isArray(source?.course?.timing_points)
            ? source.course.timing_points
            : [];

  return { contests, splits, timingPoints };
};

const getContestNameFromSnapshot = (timingConfiguration: ResolvedTimingConfiguration | null | undefined, contestUuid: string | null) => {
  const key = String(contestUuid || '').trim();
  if (!key) return null;
  const source = timingConfiguration as any;
  const contest = source?.splitIndex?.contestsByUuid?.[key] || source?.contestByUuid?.[key] || source?.contestIndex?.[key] || null;
  return String(contest?.contestName || contest?.contest?.contestName || contest?.contest?.Name || contest?.contest?.name || '').trim() || null;
};

const resolveParticipantProfile = (participant: Record<string, any> | null | undefined, athlete: LiveAthlete) => {
  const source = participant as any;
  const registration = source?.registration || source?.bergmanRegistration || (athlete as any)?.registration || {};
  const startTime = Number(
    source?.start_time ??
    source?.startTime ??
    source?.gun_start_time ??
    source?.gunStartTime ??
    source?.start_unix ??
    source?.startUnix ??
    source?.startTimestamp ??
    source?.result_start_timestamp ??
    source?.resultStartTimestamp ??
    athlete.startTime ??
    0,
  );

  const ageGroup = String(
    source?.age_group_name ??
    source?.ageGroupName ??
    source?.age_group_uuid ??
    source?.ageGroupUuid ??
    registration?.ageGroup ??
    registration?.selectedSubCategory ??
    source?.selectedSubCategory ??
    source?.ageGroup ??
    athlete.ageGroup ??
    '',
  ).trim();

  const contestName = String(
    source?.contest_name ??
    source?.contestName ??
    source?.contest?.name ??
    source?.contest?.Name ??
    athlete.contestName ??
    athlete.category ??
    '',
  ).trim();
  const contestDates = getParticipantContestDates(source || athlete);

  return {
    name: String(source?.name ?? athlete.name ?? '').trim(),
    bib: String(source?.bib ?? source?.bibNumber ?? athlete.bib ?? '').trim(),
    gender: String(source?.gender ?? athlete.gender ?? '').trim() || '—',
    category: contestName || String(athlete.category ?? '').trim(),
    ageGroup: ageGroup || '—',
    country: resolveAthleteCountry(source || athlete),
    club: String(source?.club ?? source?.clubName ?? source?.club_name ?? source?.team ?? source?.teamName ?? athlete.clubName ?? '').trim() || null,
    team: String(source?.team ?? source?.teamName ?? source?.clubName ?? source?.club ?? '').trim() || null,
    contestUuid: String(source?.contest_uuid ?? source?.contestUuid ?? athlete.contest_uuid ?? athlete.contestUuid ?? '').trim() || null,
    contestName: contestName || null,
    contestDate: contestDates.contestDate,
    contestEtd: contestDates.contestEtd,
    startTime: Number.isFinite(startTime) && startTime > 0 ? startTime : null,
  };
};

const collectContestScopedRows = (contest: Record<string, any> | null | undefined) => {
  if (!contest || typeof contest !== 'object') return [] as Record<string, any>[];
  return [
    ...(Array.isArray((contest as any)?.splits) ? (contest as any).splits : []),
    ...(Array.isArray((contest as any)?.timingPoints) ? (contest as any).timingPoints : []),
    ...(Array.isArray((contest as any)?.timing_points) ? (contest as any).timing_points : []),
    ...(Array.isArray((contest as any)?.course?.splits) ? (contest as any).course.splits : []),
    ...(Array.isArray((contest as any)?.course?.timingPoints) ? (contest as any).course.timingPoints : []),
    ...(Array.isArray((contest as any)?.course?.timing_points) ? (contest as any).course.timing_points : []),
  ];
};

const collectAllContestScopedRows = (contests: Record<string, any>[]) =>
  contests.flatMap((contest) => collectContestScopedRows(contest));

const collectTimingRowsFromConfiguration = (source: Record<string, any>) => {
  const directRows = [
    ...(Array.isArray(source?.splits) ? source.splits : []),
    ...(Array.isArray(source?.timingPoints) ? source.timingPoints : []),
    ...(Array.isArray(source?.timing_points) ? source.timing_points : []),
    ...(Array.isArray(source?.course?.splits) ? source.course.splits : []),
    ...(Array.isArray(source?.course?.timingPoints) ? source.course.timingPoints : []),
    ...(Array.isArray(source?.course?.timing_points) ? source.course.timing_points : []),
  ];

  return directRows.reduce<Record<string, any>[]>((acc, row) => {
    const key = String(row?.UUID || row?.uuid || row?.id || row?.TimingPointUUID || row?.timingPointUUID || row?.label || row?.name || '').trim();
    if (!key) {
      acc.push(row);
      return acc;
    }
    if (!acc.some((existing) => String(existing?.UUID || existing?.uuid || existing?.id || existing?.TimingPointUUID || existing?.timingPointUUID || existing?.label || existing?.name || '').trim() === key)) {
      acc.push(row);
    }
    return acc;
  }, []);
};

const buildPointFromSplit = (split: Record<string, any>, timingPoint?: Record<string, any> | null): ResolvedTimingPoint => {
  const splitName = String(split?.Name || split?.name || split?.Label || split?.label || split?.splitName || split?.split_name || '').trim();
  const timingPointName = String(timingPoint?.Name || timingPoint?.name || timingPoint?.Label || timingPoint?.label || timingPoint?.displayName || timingPoint?.shortName || '').trim();
  const displayName = splitName || timingPointName || String(split?.Code || split?.code || split?.id || '').trim();
  const shortName = String(split?.Label || split?.label || split?.Code || split?.code || timingPoint?.Code || timingPoint?.code || '').trim() || displayName;
  const textToken = `${splitName} ${timingPointName} ${shortName}`.trim().toLowerCase();
  const distanceFromStart = Number(
    split?.DistanceFromStart ??
    split?.distanceFromStart ??
    split?.distance ??
    split?.meters ??
    split?.Distance ??
    timingPoint?.DistanceFromStart ??
    timingPoint?.distanceFromStart ??
    timingPoint?.distance ??
    timingPoint?.meters ??
    timingPoint?.Distance ??
    0,
  );
  const distanceUnit = split?.DistanceFromStartUnit ?? split?.distanceFromStartUnit ?? split?.DistanceUnit ?? split?.distanceUnit ?? split?.unit;
  const distanceKm = convertDistanceToKm(distanceFromStart, distanceUnit) ?? normalizeDistanceFromPoint(timingPoint || {}) ?? null;
  const sport = String(split?.TypeOfSport || split?.typeOfSport || split?.Sport || split?.sport || timingPoint?.TypeOfSport || timingPoint?.typeOfSport || '').trim();
  const order = Number(split?.Order ?? split?.order ?? split?.Index ?? split?.index ?? distanceFromStart ?? 0) || 0;
  const splitUuid = String(split?.UUID || split?.Uuid || split?.uuid || split?.ID || split?.Id || split?.id || '').trim();
  const timingPointUuid = String(split?.TimingPointUUID || split?.timingPointUUID || split?.TimingPointUuid || split?.timing_point_uuid || timingPoint?.UUID || timingPoint?.Uuid || timingPoint?.uuid || '').trim();
  const canonicalUuid = splitUuid || timingPointUuid || null;
  const rawType = String(split?.TypeOfSport || split?.typeOfSport || sport || timingPoint?.TypeOfSport || timingPoint?.typeOfSport || '').toLowerCase();
  const markerType: ResolvedTimingPoint['markerType'] = textToken.includes('transition') || /(^|\b)t\d(\b|\s|$)/i.test(textToken) || (textToken.includes('bike finish') && textToken.includes('run start')) || (textToken.includes('swim finish') && textToken.includes('bike start'))
    ? 'transition'
    : rawType.includes('finish')
      ? 'finish'
      : rawType.includes('transition') || /^t\d$/i.test(rawType)
        ? 'transition'
        : rawType.includes('medical')
          ? 'medical'
          : 'checkpoint';
  const timingPointOrder = Number(timingPoint?.Order ?? timingPoint?.order ?? timingPoint?.Index ?? timingPoint?.index ?? 0) || 0;

  return {
    id: splitUuid || timingPointUuid || `split-${order}`,
    canonicalUuid,
    providerId: splitUuid || timingPointUuid || null,
    providerCode: String(split?.Label || split?.label || split?.Code || split?.code || timingPoint?.Code || timingPoint?.code || '').trim() || null,
    displayName,
    shortName,
    eventId: null,
    distance: distanceKm,
    distanceKm,
    leg: sport || null,
    order: order || timingPointOrder,
    latitude: Number(split?.Latitude ?? split?.latitude ?? timingPoint?.Latitude ?? timingPoint?.latitude ?? 0) || 0,
    longitude: Number(split?.Longitude ?? split?.longitude ?? timingPoint?.Longitude ?? timingPoint?.longitude ?? 0) || 0,
    markerType,
    icon: String(timingPoint?.icon || split?.icon || markerType || 'checkpoint').trim() || 'checkpoint',
    leaderboard: Boolean(split?.leaderboard ?? split?.isLeaderboard ?? timingPoint?.leaderboard ?? timingPoint?.isLeaderboard),
    transition: markerType === 'transition',
    finish: markerType === 'finish',
    visible: split?.visible !== false,
    isLeaderboard: Boolean(split?.leaderboard ?? split?.isLeaderboard ?? timingPoint?.leaderboard ?? timingPoint?.isLeaderboard),
    isTransition: markerType === 'transition',
    isFinish: markerType === 'finish',
    raw: { split, timingPoint },
  };
};

const normalizeTimingPointsFromSplits = (contestSplits: Record<string, any>[], timingPoints: Record<string, any>[]) => {
  const getDistanceKmFromSplit = (split: Record<string, any>) => {
    const unit = String(split?.DistanceFromStartUnit || split?.distanceFromStartUnit || split?.unit || '').trim().toLowerCase();
    const distance = Number(split?.DistanceFromStart ?? split?.distanceFromStart ?? split?.distance ?? split?.meters ?? 0);
    if (!Number.isFinite(distance)) return null;
    if (unit.includes('km') || unit.includes('kilomet')) return distance;
    if (unit.includes('meter') || unit === 'm') return distance / 1000;
    return distance / 1000;
  };

  const timingPointMap = new Map<string, Record<string, any>>();
  timingPoints.forEach((tp) => {
    const uuid = String(tp?.UUID || tp?.uuid || '').trim();
    if (uuid) timingPointMap.set(uuid, tp);
  });

  const unique: Record<string, any>[] = [];
  const seen = new Set<string>();
  contestSplits.forEach((split, index) => {
    const splitUuid = String(split?.UUID || split?.uuid || split?.id || '').trim();
    const splitKey = splitUuid ? `uuid:${splitUuid}` : `index:${index}`;
    if (seen.has(splitKey)) return;
    seen.add(splitKey);
    unique.push(split);
  });

  console.log('Contest Split Count', unique.length);
  console.table(unique.map((split) => ({
    uuid: split?.UUID || split?.uuid || split?.id,
    contest: split?.ContestUUID || split?.contestUUID || split?.contestUuid || split?.contest_uuid,
    name: split?.Name || split?.name || split?.Label || split?.label,
    distance: split?.DistanceFromStart ?? split?.distanceFromStart ?? split?.distance ?? split?.meters,
    timingPoint: split?.TimingPointUUID || split?.timingPointUUID || split?.TimingPointUuid || split?.timing_point_uuid,
  })));

  return unique.map<ResolvedTimingPoint>((split, index) => {
    const timingPointUuid = String(split?.TimingPointUUID || split?.timingPointUUID || split?.TimingPointUuid || split?.timing_point_uuid || '').trim();
    const timingPoint = timingPointMap.get(timingPointUuid) || null;
    const distanceKm = getDistanceKmFromSplit(split) ?? normalizeDistanceFromPoint(timingPoint || {}) ?? null;
    const rawType = String(split?.TypeOfSport || split?.typeOfSport || timingPoint?.TypeOfSport || timingPoint?.typeOfSport || '').trim().toLowerCase();
    const textToken = `${String(split?.Name || split?.name || '')} ${String(split?.Label || split?.label || '')} ${String(timingPoint?.Name || timingPoint?.name || timingPoint?.Label || timingPoint?.label || '')}`.trim().toLowerCase();
    const markerType: ResolvedTimingPoint['markerType'] = textToken.includes('transition') || /(^|\b)t\d(\b|\s|$)/i.test(textToken) || (textToken.includes('bike finish') && textToken.includes('run start')) || (textToken.includes('swim finish') && textToken.includes('bike start'))
      ? 'transition'
      : rawType.includes('finish')
        ? 'finish'
        : rawType.includes('transition') || /^t\d$/i.test(rawType)
          ? 'transition'
          : rawType.includes('medical')
            ? 'medical'
            : 'checkpoint';
    const canonicalUuid = String(split?.UUID || split?.uuid || timingPoint?.UUID || timingPoint?.uuid || split?.id || '').trim() || null;

    return {
      id: String(split?.UUID || split?.uuid || split?.id || `split-${index + 1}`),
      canonicalUuid,
      providerId: String(split?.UUID || split?.uuid || split?.id || '').trim() || null,
      providerCode: String(split?.Label || split?.label || '').trim() || null,
      displayName: String(split?.Name || split?.name || timingPoint?.Name || timingPoint?.name || '').trim(),
      shortName: String(split?.Label || split?.label || split?.Name || split?.name || '').trim(),
      eventId: null,
      distance: distanceKm,
      distanceKm,
      leg: String(split?.TypeOfSport || split?.typeOfSport || '').trim() || null,
      order: Number(split?.DistanceFromStart ?? split?.distanceFromStart ?? split?.distance ?? split?.meters ?? index + 1) || index + 1,
      latitude: Number(split?.Latitude ?? split?.latitude ?? 0) || 0,
      longitude: Number(split?.Longitude ?? split?.longitude ?? 0) || 0,
      markerType,
      icon: String(timingPoint?.icon || split?.icon || markerType || 'checkpoint').trim() || 'checkpoint',
      leaderboard: Boolean(split?.leaderboard ?? split?.isLeaderboard),
      transition: markerType === 'transition',
      finish: markerType === 'finish',
      visible: split?.visible !== false,
      isLeaderboard: Boolean(split?.leaderboard ?? split?.isLeaderboard),
      isTransition: markerType === 'transition',
      isFinish: markerType === 'finish',
      raw: { split, timingPoint },
    };
  }).sort((a, b) => {
    const aOrder = Number((a.raw as any)?.split?.Order ?? (a.raw as any)?.split?.order ?? (a.raw as any)?.split?.Index ?? (a.raw as any)?.split?.index ?? a.order ?? 0) || 0;
    const bOrder = Number((b.raw as any)?.split?.Order ?? (b.raw as any)?.split?.order ?? (b.raw as any)?.split?.Index ?? (b.raw as any)?.split?.index ?? b.order ?? 0) || 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return compareTimingPointsInRaceOrder(a, b);
  });
};

const resolveContestTimingPoints = (
  athlete: LiveAthlete,
  timingConfiguration?: ResolvedTimingConfiguration | null,
  participant?: Record<string, any> | null,
  participantsByBib?: Record<string, any> | null,
  _ticketDef?: DynamicSplitSummaryTableProps['ticketDef'] | null,
) => {
  const logs: string[] = [];
  const log = (message: string, payload?: any) => {
    logs.push(message);
    if (payload !== undefined) {
      console.log(`[AthleteSplitModal] ${message}`, payload);
      return;
    }
    console.log(`[AthleteSplitModal] ${message}`);
  };

  const bib = String((athlete as any)?.bib ?? '').trim();
  const participantRecord =
    participant ??
    participantsByBib?.[bib] ??
    participantsByBib?.[bib.replace(/^0+/, '')] ??
    null;

  const contestUUID = String(
    participantRecord?.contest_uuid ??
    participantRecord?.contestUuid ??
    participantRecord?.providerContestUuid ??
    participantRecord?.liveTracking?.contestUuid ??
    participantRecord?.contest_id ??
    participantRecord?.contestId ??
    (athlete as any)?.contest_uuid ??
    (athlete as any)?.contestUuid ??
    (athlete as any)?.providerContestUuid ??
    (athlete as any)?.liveTracking?.contestUuid ??
    (athlete as any)?.contest_id ??
    (athlete as any)?.contestId ??
    '',
  ).trim();

  const contestName = String(
    participantRecord?.contest_name ??
    participantRecord?.contestName ??
    participantRecord?.providerContestName ??
    participantRecord?.liveTracking?.contestName ??
    participantRecord?.categoryName ??
    (athlete as any)?.contest_name ??
    (athlete as any)?.contestName ??
    (athlete as any)?.providerContestName ??
    (athlete as any)?.liveTracking?.contestName ??
    (athlete as any)?.category ??
    '',
  ).trim();

  const sourceAny = timingConfiguration as any;
  const splitSource = String(sourceAny?.splitSource || sourceAny?.sourceLabel || sourceAny?.source || 'KV').trim() || 'KV';
  const eventConfigurationVersion = String(
    sourceAny?.version
    ?? sourceAny?.configVersion
    ?? sourceAny?.timing_rules?.version
    ?? sourceAny?.timing_rules?.Version
    ?? sourceAny?.timings?.version
    ?? '',
  ).trim() || null;
  const lastSynced = String(
    sourceAny?.lastSynced
    ?? sourceAny?.updatedAt
    ?? sourceAny?.importedAt
    ?? sourceAny?.timing_rules?.updatedAt
    ?? sourceAny?.timing_rules?.importedAt
    ?? '',
  ).trim() || null;

  const { contests, splits, timingPoints } = getTimingRulesCollections(timingConfiguration);

  const validation = {
    contestUuidFound: !!contestUUID,
    contestExists: false,
    splitsFound: false,
    sortedByDistance: false,
    courseDistanceCalculated: false,
  };

  log('Modal load: start', {
    bib,
    contestUuid: contestUUID || null,
    contestName: contestName || null,
    splitSource,
    eventConfigurationVersion,
    lastSynced,
  });

  const effectiveContestUuid = contestUUID;
  if (!effectiveContestUuid) {
    log('Invalid contest UUID: missing from athlete/participant mapping');
    return {
      points: [],
      scopedSplits: [],
      noContestAssigned: true,
      debug: {
        contestUuid: null,
        contestName: contestName || null,
        splitSource,
        eventConfigurationVersion,
        lastSynced,
        contestFound: false,
        splitCount: 0,
        courseDistanceKm: 0,
        duplicateSplitCount: 0,
        missingTimingPointCount: 0,
        validation,
        splits: [],
        logs,
      },
    };
  }

  const contestKey = normalize(effectiveContestUuid);
  const splitIndex = sourceAny?.splitIndex && typeof sourceAny.splitIndex === 'object' ? sourceAny.splitIndex : null;
  const contestIndexEntry = splitIndex?.contestsByUuid?.[effectiveContestUuid] || splitIndex?.contestsByUuid?.[contestKey] || sourceAny?.contestIndex?.[effectiveContestUuid] || sourceAny?.contestIndex?.[contestKey] || null;
  const contestSpecificSplits = Array.isArray(splitIndex?.splitsByContest?.[effectiveContestUuid])
    ? splitIndex.splitsByContest[effectiveContestUuid]
    : Array.isArray(splitIndex?.splitsByContest?.[contestKey])
      ? splitIndex.splitsByContest[contestKey]
      : Array.isArray(sourceAny?.splitsByContest?.[effectiveContestUuid])
    ? sourceAny.splitsByContest[effectiveContestUuid]
    : Array.isArray(sourceAny?.splitsByContest?.[contestKey])
      ? sourceAny.splitsByContest[contestKey]
      : Array.isArray(sourceAny?.contestContext?.splits)
        ? sourceAny.contestContext.splits
      : null;
  const contestByUuidEntry = splitIndex?.contestsByUuid?.[effectiveContestUuid] || splitIndex?.contestsByUuid?.[contestKey] || sourceAny?.contestByUuid?.[effectiveContestUuid] || sourceAny?.contestByUuid?.[contestKey] || null;
  let matchedContest = contestIndexEntry?.contest || contestByUuidEntry?.contest || contestByUuidEntry || contests.find((contest: any) => normalize(contest?.UUID ?? contest?.uuid ?? contest?.contestUUID ?? contest?.contestUuid ?? contest?.id) === contestKey) || null;
  validation.contestExists = !!matchedContest;

  let scopedSplits = Array.isArray(contestSpecificSplits) && contestSpecificSplits.length > 0
    ? contestSpecificSplits
    : Array.isArray(contestIndexEntry?.splits) && contestIndexEntry.splits.length > 0 && typeof contestIndexEntry.splits[0] === 'object'
      ? contestIndexEntry.splits
      : Array.isArray(contestIndexEntry?.splits) && contestIndexEntry.splits.length > 0 && splitIndex?.splitByUuid
        ? contestIndexEntry.splits
            .map((splitId: any) => splitIndex.splitByUuid[String(splitId || '').trim()])
            .filter(Boolean)
        : [];
  validation.splitsFound = scopedSplits.length > 0;

  const dedupeMap = new Map<string, Record<string, any>>();
  let duplicateSplitCount = 0;
  for (const split of scopedSplits) {
    const splitUuid = String(split?.UUID || split?.uuid || split?.id || '').trim();
    const splitName = String(split?.Name || split?.name || split?.Label || split?.label || '').trim();
    const distanceKm = normalizeDistanceFromPoint(split);
    const key = splitUuid || `${splitName}::${String(distanceKm ?? '')}`;
    if (!key) continue;
    if (dedupeMap.has(key)) {
      duplicateSplitCount += 1;
      continue;
    }
    dedupeMap.set(key, split);
  }

  const uniqueSplits = Array.from(dedupeMap.values());
  const sortedSplits = uniqueSplits.slice().sort((a, b) => {
    const aOrder = Number(a?.Order ?? a?.order ?? a?.Index ?? a?.index ?? 0) || 0;
    const bOrder = Number(b?.Order ?? b?.order ?? b?.Index ?? b?.index ?? 0) || 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aIndex = uniqueSplits.indexOf(a);
    const bIndex = uniqueSplits.indexOf(b);
    return aIndex - bIndex;
  });

  validation.sortedByDistance = sortedSplits.every((split, index) => {
    if (index === 0) return true;
    const prevOrder = Number(sortedSplits[index - 1]?.Order ?? sortedSplits[index - 1]?.order ?? sortedSplits[index - 1]?.Index ?? sortedSplits[index - 1]?.index ?? 0) || 0;
    const currentOrder = Number(split?.Order ?? split?.order ?? split?.Index ?? split?.index ?? 0) || 0;
    if (prevOrder === 0 && currentOrder === 0) return true;
    return currentOrder >= prevOrder;
  });

  const courseDistanceKm = sortedSplits.reduce((max, split) => {
    const distance = normalizeDistanceFromPoint(split);
    return distance !== null ? Math.max(max, distance) : max;
  }, 0);
  validation.courseDistanceCalculated = courseDistanceKm > 0 || sortedSplits.some((split) => normalizeDistanceFromPoint(split) === 0);

  const timingPointMap = new Map<string, Record<string, any>>();
  for (const tp of timingPoints) {
    const key = String(tp?.UUID || tp?.uuid || tp?.id || '').trim();
    if (key) timingPointMap.set(key, tp);
  }

  const contestScopedTimingPoints = Array.isArray(contestIndexEntry?.timingPoints) && contestIndexEntry.timingPoints.length > 0
    ? contestIndexEntry.timingPoints
    : [];
  if (contestScopedTimingPoints.length > 0) {
    for (const tp of contestScopedTimingPoints) {
      const key = String(tp?.UUID || tp?.uuid || tp?.id || tp?.providerId || '').trim();
      if (key) timingPointMap.set(key, tp as any);
    }
  }

  const missingTimingPointCount = sortedSplits.reduce((count, split) => {
    const tpUuid = String(split?.TimingPointUUID || split?.timingPointUUID || split?.TimingPointUuid || split?.timing_point_uuid || '').trim();
    if (!tpUuid) return count;
    return timingPointMap.has(tpUuid) ? count : count + 1;
  }, 0);

  console.log({
    athleteContestUuid: effectiveContestUuid,
    availableContestKeys: Object.keys(sourceAny?.splitsByContest ?? {}),
    splitsFound: sourceAny?.splitsByContest?.[effectiveContestUuid]?.length ?? sourceAny?.contestIndex?.[effectiveContestUuid]?.splits?.length ?? 0,
  });

  const points = sortedSplits.length > 0
    ? normalizeTimingPointsFromSplits(sortedSplits, timingPoints)
    : [];

  log('Contest split resolution', {
    athleteContestUuid: effectiveContestUuid,
    athleteContestName: contestName || null,
    availableContestKeys: Object.keys(sourceAny?.splitsByContest || {}),
    selectedSplits: scopedSplits,
    selectedSplitCount: scopedSplits.length,
    selectedContestIndexSplitCount: Array.isArray(contestIndexEntry?.splits) ? contestIndexEntry.splits.length : 0,
    selectedContestByUuidSplitCount: Array.isArray(contestByUuidEntry?.splits) ? contestByUuidEntry.splits.length : 0,
  });

  if (!matchedContest) {
    log('Contest UUID not found in event configuration contests', { contestUuid: contestUUID });
  }
  if (!validation.splitsFound) {
    log('No split configuration found for contest UUID', {
      contestUuid: contestUUID,
      availableContestKeys: Object.keys(sourceAny?.splitsByContest || {}),
      contestName: getContestNameFromSnapshot(timingConfiguration, contestUUID),
    });
  }
  if (duplicateSplitCount > 0) {
    log('Duplicate splits detected', { duplicateSplitCount });
  }
  if (missingTimingPointCount > 0) {
    log('Missing timing points for split rows', { missingTimingPointCount });
  }

  log('Modal load: completed', {
  contestUuid: effectiveContestUuid,
    splitCount: points.length,
    courseDistanceKm,
    duplicateSplitCount,
    missingTimingPointCount,
    valid: validation,
  });

  return {
    points,
    scopedSplits: sortedSplits,
    noContestAssigned: false,
    debug: {
      contestUuid: contestUUID,
      resolvedContestUuid: effectiveContestUuid,
      contestName: String((matchedContest?.Name ?? matchedContest?.name ?? matchedContest?.contestName ?? matchedContest?.label ?? contestName) || '').trim() || null,
      splitSource,
      eventConfigurationVersion,
      lastSynced,
      contestFound: !!matchedContest,
      splitCount: points.length,
      courseDistanceKm,
      duplicateSplitCount,
      missingTimingPointCount,
      validation,
      splits: sortedSplits.map((split) => ({
        name: String(split?.Name || split?.name || split?.Label || split?.label || 'Unnamed Split').trim(),
        splitUuid: String(split?.UUID || split?.uuid || split?.id || '').trim() || null,
        timingPointUuid: String(split?.TimingPointUUID || split?.timingPointUUID || split?.TimingPointUuid || split?.timing_point_uuid || '').trim() || null,
        distanceKm: normalizeDistanceFromPoint(split),
      })),
      logs,
    },
  };
};

const normalizeDistanceToKm = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric === 0) return 0;
  return numeric >= 1000 ? numeric / 1000 : numeric;
};

export const getTimingPointDistanceKm = (point: ResolvedTimingPoint) => {
  const raw = point.raw as any;
  const candidates = [
    point.distanceKm,
    raw?.distanceKm,
    raw?.km,
    point.distance,
    raw?.distance,
    raw?.meters,
    raw?.distanceMeters,
    raw?.distanceInMeters,
    raw?.cumulativeDistance,
    raw?.meter_mark,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeDistanceToKm(candidate);
    if (normalized !== null) return normalized;
  }

  const labelCandidates = [
    point.displayName,
    point.shortName,
    point.providerCode,
    point.providerId,
    raw?.split?.name,
    raw?.split?.label,
    raw?.split?.Name,
    raw?.split?.Label,
  ];

  for (const candidate of labelCandidates) {
    const parsed = extractDistanceFromText(candidate);
    if (parsed !== null) return parsed;
  }

  return null;
};

const isTransitionPoint = (point: ResolvedTimingPoint) => Boolean(point.isTransition || point.transition || point.markerType === 'transition');
const isFinishPoint = (point: ResolvedTimingPoint) => Boolean(point.isFinish || point.finish || point.markerType === 'finish');

export const getTheme = (point: ResolvedTimingPoint): SectionThemeKey => {
  const token = `${point.icon || ''} ${point.markerType || ''} ${point.displayName || ''} ${point.shortName || ''}`.trim().toLowerCase();
  if (point.isFinish || token.includes('finish')) return 'finish';
  if (point.isTransition || token.includes('transition') || (token.includes('t1') || token.includes('t2')) || (token.includes('bike finish') && token.includes('run start'))) return 'transition';
  if (token.includes('swim')) return 'swim';
  if (token.includes('bike') || token.includes('cycle')) return 'bike';
  if (token.includes('run') || token.includes('trail') || token.includes('marathon')) return 'run';
  return 'generic';
};

export const pointGroupKey = (point: ResolvedTimingPoint) => {
  const theme = getTheme(point);
  if (theme && theme !== 'generic') return theme;
  return String(point.leg || point.markerType || point.icon || point.id || point.displayName || '').trim().toLowerCase();
};
export const getPointDisplayLabel = (point: ResolvedTimingPoint, fallbackIndex: number) => String(
  point.displayName ||
  point.shortName ||
  point.providerCode ||
  point.providerId ||
  point.id ||
  '',
).trim();

const findSplitForPoint = (point: ResolvedTimingPoint, splits: Split[]) => {
  const pointKeys = [
    point.id,
    point.providerId,
    point.providerCode,
    point.displayName,
    point.shortName,
    (point.raw as any)?.split?.TimingPointUUID,
    (point.raw as any)?.split?.timingPointUUID,
    (point.raw as any)?.split?.timing_point_uuid,
    (point.raw as any)?.split?.timing_point_id,
    (point.raw as any)?.split?.UUID,
    (point.raw as any)?.split?.uuid,
    (point.raw as any)?.split?.id,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  for (const split of splits) {
    const splitKeys = [
      split.id,
      split.uuid,
      split.splitUuid,
      split.providerId,
      split.providerCode,
      split.rawSplitLabel,
      split.segment,
      split.name,
      split.label,
      (split as any)?.timingPointId,
      (split as any)?.timing_point_id,
      (split as any)?.timingPointUUID,
      (split as any)?.timing_point_uuid,
      (split as any)?.raw?.timing_point_id,
      (split as any)?.raw?.timingPointId,
      (split as any)?.raw?.timing_point_uuid,
      (split as any)?.raw?.timingPointUUID,
    ]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    const matched = pointKeys.some((pointKey) => splitKeys.some((splitKey) => splitKey === pointKey));
    if (matched) return split;
  }
  return null;
};

const extractSplitUuidFromSplit = (split: Split | Record<string, any> | null | undefined) => {
  if (!split || typeof split !== 'object') return null;
  const raw = split as any;
  return String(
    raw?.splitUuid ??
    raw?.split_uuid ??
    raw?.uuid ??
    raw?.id ??
    raw?.providerId ??
    raw?.provider_id ??
    raw?.raw?.splitUuid ??
    raw?.raw?.split_uuid ??
    raw?.raw?.uuid ??
    raw?.raw?.id ??
    '',
  ).trim() || null;
};

const extractSplitUuidFromPoint = (point: ResolvedTimingPoint) => {
  const raw = point.raw as any;
  return String(
    raw?.split?.splitUuid ??
    raw?.split?.split_uuid ??
    raw?.split?.UUID ??
    raw?.split?.uuid ??
    raw?.split?.id ??
    raw?.splitUuid ??
    raw?.split_uuid ??
    raw?.UUID ??
    raw?.uuid ??
    raw?.id ??
    point.canonicalUuid ??
    point.providerId ??
    '',
  ).trim() || null;
};

const extractLegUuidFromSplit = (split: Split | Record<string, any> | null | undefined) => {
  if (!split || typeof split !== 'object') return null;
  const raw = split as any;
  return String(
    raw?.legUuid
    ?? raw?.leg_uuid
    ?? raw?.leg?.uuid
    ?? raw?.leg?.UUID
    ?? raw?.raw?.legUuid
    ?? raw?.raw?.leg_uuid
    ?? raw?.raw?.leg?.uuid
    ?? raw?.raw?.leg?.UUID
    ?? '',
  ).trim() || null;
};

type ResolvedLegBoundary = {
  id: string | number | null;
  uuid: string;
  contestUuid: string | null;
  name: string;
  label: string;
  color: string | null;
  firstSplitUuid: string | null;
  lastSplitUuid: string | null;
  order: number;
  configuration: Record<string, any> | null;
  raw: Record<string, any>;
};

type SavedLegMapping = {
  leg_index: number;
  leg_name: string;
  display_order: number;
  enabled: boolean;
  metadata?: Record<string, any>;
};

type SavedSplitMapping = {
  split_index: number;
  split_name: string;
  timing_point_id: string;
  timing_point_name: string;
  leg_index: number;
  display_order: number;
  distance?: number | null;
  split_type?: string | null;
  visibility?: 'visible' | 'hidden';
  metadata?: Record<string, any>;
};

type SavedLegSplitMapping = {
  event_id?: string;
  contest_id?: string;
  contest_name?: string;
  legs?: SavedLegMapping[];
  splits?: SavedSplitMapping[];
  updated_at?: string;
  updated_by?: string;
  version?: string;
};

const normalizeLookup = (value: unknown) => String(value ?? '').trim().toLowerCase();

const resolveLegTheme = (leg: ResolvedLegBoundary): SectionThemeKey => {
  const token = `${leg.name} ${leg.label}`.toLowerCase();
  if (/^t\d\b|transition/.test(token) || token.includes(' t1') || token.includes(' t2') || (token.includes('bike finish') && token.includes('run start')) || (token.includes('swim finish') && token.includes('bike start'))) return 'transition';
  if (token.includes('swim')) return 'swim';
  if (token.includes('bike') || token.includes('cycle')) return 'bike';
  if (token.includes('run') || token.includes('trail') || token.includes('marathon')) return 'run';
  if (token.includes('finish')) return 'finish';
  return 'generic';
};

const resolveLegOrder = (leg: Record<string, any>, fallback: number) => {
  const value = Number(
    leg?.order ??
    leg?.sequence ??
    leg?.sequence_no ??
    leg?.sequenceNo ??
    leg?.position ??
    leg?.index ??
    leg?.configuration?.order ??
    leg?.configuration?.sequence ??
    leg?.configuration?.sequence_no ??
    leg?.configuration?.sequenceNo ??
    NaN,
  );
  if (Number.isFinite(value)) return value;
  const numericId = Number(leg?.id);
  if (Number.isFinite(numericId)) return numericId;
  return fallback;
};

const resolveContestLegs = (timingConfiguration: ResolvedTimingConfiguration | null | undefined, contestUuid: string | null) => {
  const source = timingConfiguration as any;
  const target = String(contestUuid || '').trim();
  if (!target) return [] as ResolvedLegBoundary[];

  const byContestSources: any[] = [
    source?.legIndex?.byContest,
    source?.legsByContest,
    source?.contestContext?.legsByContest,
  ];

  const contestRows: Record<string, any>[] = [];
  const pushContestRows = (rows: unknown) => {
    if (Array.isArray(rows)) contestRows.push(...rows.filter((row) => row && typeof row === 'object'));
  };

  for (const byContest of byContestSources) {
    if (!byContest || typeof byContest !== 'object') continue;
    pushContestRows(byContest[target]);
    if (contestRows.length > 0) break;
    const targetLookup = normalizeLookup(target);
    const matchedKey = Object.keys(byContest).find((key) => normalizeLookup(key) === targetLookup);
    if (matchedKey) {
      pushContestRows(byContest[matchedKey]);
      if (contestRows.length > 0) break;
    }
  }

  if (contestRows.length === 0 && source?.contestContext && typeof source.contestContext === 'object') {
    pushContestRows(source.contestContext.legs);
  }

  if (contestRows.length === 0 && source?.contestIndex && typeof source.contestIndex === 'object') {
    const entry = source.contestIndex[target]
      || Object.values(source.contestIndex).find((row: any) => normalizeLookup(row?.contestUuid || row?.uuid || row?.id) === normalizeLookup(target));
    pushContestRows(entry?.legs);
  }

  const seen = new Set<string>();
  const resolved = contestRows
    .map((row, index): ResolvedLegBoundary | null => {
      const uuid = String(
        row?.uuid ??
        row?.legUuid ??
        row?.leg_uuid ??
        row?.configuration?.uuid ??
        row?.configuration?.legUuid ??
        row?.configuration?.leg_uuid ??
        '',
      ).trim();
      if (!uuid) return null;
      const dedupeKey = normalizeLookup(uuid);
      if (!dedupeKey || seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);
      const firstSplitUuid = String(
        row?.first_split_uuid ??
        row?.firstSplitUuid ??
        row?.configuration?.first_split_uuid ??
        row?.configuration?.firstSplitUuid ??
        row?.firstSplitUuidRaw ??
        '',
      ).trim() || null;
      const lastSplitUuid = String(
        row?.last_split_uuid ??
        row?.lastSplitUuid ??
        row?.configuration?.last_split_uuid ??
        row?.configuration?.lastSplitUuid ??
        row?.lastSplitUuidRaw ??
        '',
      ).trim() || null;
      return {
        id: row?.id ?? null,
        uuid,
        contestUuid: String(row?.contestUuid ?? row?.contest_uuid ?? row?.configuration?.contest_uuid ?? target).trim() || target,
        name: String(row?.name ?? row?.leg_name ?? row?.configuration?.name ?? '').trim() || `LEG ${index + 1}`,
        label: String(row?.label ?? row?.configuration?.label ?? row?.name ?? row?.leg_name ?? '').trim() || String(row?.name ?? row?.leg_name ?? '').trim() || `LEG ${index + 1}`,
        color: String(row?.color ?? row?.configuration?.color ?? '').trim() || null,
        firstSplitUuid,
        lastSplitUuid,
        order: resolveLegOrder(row, index + 1),
        configuration: row?.configuration && typeof row.configuration === 'object' ? row.configuration : null,
        raw: row,
      };
    })
    .filter(Boolean) as ResolvedLegBoundary[];

  return resolved.sort((a, b) => a.order - b.order);
};

const resolveSavedLegSplitMapping = (
  timingConfiguration: ResolvedTimingConfiguration | null | undefined,
  contestUuid: string | null,
  contestName: string | null,
): SavedLegSplitMapping | null => {
  const source = timingConfiguration as any;
  const target = String(contestUuid || '').trim();
  const targetName = String(contestName || '').trim();
  if (!source) return null;
  const mappingSources: Array<Record<string, any> | null> = [
    source?.raceFlowByContest && typeof source.raceFlowByContest === 'object' ? source.raceFlowByContest : null,
    source?.raceFlowTimelineByContest && typeof source.raceFlowTimelineByContest === 'object' ? source.raceFlowTimelineByContest : null,
    source?.legSplitMappingsByContest && typeof source.legSplitMappingsByContest === 'object' ? source.legSplitMappingsByContest : null,
  ];

  const normalizeMappingEntry = (entry: any): SavedLegSplitMapping | null => {
    if (!entry || typeof entry !== 'object') return null;
    if (Array.isArray(entry?.legs) && Array.isArray(entry?.splits)) {
      return entry as SavedLegSplitMapping;
    }
    if (entry?.mapping && typeof entry.mapping === 'object' && Array.isArray(entry.mapping?.legs) && Array.isArray(entry.mapping?.splits)) {
      return entry.mapping as SavedLegSplitMapping;
    }
    return null;
  };

  const lookupFromSource = (mappings: Record<string, any>): SavedLegSplitMapping | null => {
    if (!mappings || typeof mappings !== 'object') return null;

    if (target) {
      const direct = normalizeMappingEntry(mappings[target]) || normalizeMappingEntry(mappings[target.toLowerCase()]) || null;
      if (direct) return direct;
    }

    if (target) {
      const normalizedTarget = normalizeLookup(target);
      const matchedKey = Object.keys(mappings).find((key) => normalizeLookup(key) === normalizedTarget);
      if (matchedKey) {
        const matched = normalizeMappingEntry(mappings[matchedKey]);
        if (matched) return matched;
      }
    }

    const lookupByName = (name: string) => {
      const normalizedName = normalizeLookup(name);
      if (!normalizedName) return null;
      const contestIndex = source?.contestIndex && typeof source.contestIndex === 'object' ? source.contestIndex : null;
      if (contestIndex) {
        const match = (Object.values(contestIndex) as any[]).find((contest: any) => normalizeLookup(contest?.contestName || contest?.name || contest?.label || '') === normalizedName);
        const contestUuidMatch = String(match?.contestUuid || match?.uuid || match?.id || '').trim();
        if (contestUuidMatch) {
          const directByContest = normalizeMappingEntry(mappings[contestUuidMatch]) || normalizeMappingEntry(mappings[contestUuidMatch.toLowerCase()]);
          if (directByContest) return directByContest;
        }
      }

      const byContestEntries = Object.values(mappings)
        .map((entry: any) => normalizeMappingEntry(entry))
        .filter(Boolean) as SavedLegSplitMapping[];
      return byContestEntries.find((entry) => normalizeLookup(entry?.contest_name || '') === normalizedName) || null;
    };

    if (targetName) {
      const byName = lookupByName(targetName);
      if (byName) return byName;
    }

    return null;
  };
  for (const mappings of mappingSources) {
    if (!mappings) continue;
    const resolved = lookupFromSource(mappings);
    if (resolved) return resolved;
  }

  return null;
};

export const getSplitAverage = (theme: SectionThemeKey, splitSeconds: number | null, distanceKm: number | null, sectionDistanceKm: number | null) => {
  if (!splitSeconds || splitSeconds <= 0) return '—';
  const km = distanceKm && distanceKm > 0 ? distanceKm : sectionDistanceKm || 0;
  if (theme === 'transition') return '—';
  if (theme === 'swim') return km > 0 ? formatPace(splitSeconds / (km * 10), '/100m') : '—';
  if (theme === 'bike') return km > 0 ? formatSpeed(km / (splitSeconds / 3600)) : '—';
  return km > 0 ? formatPace(splitSeconds / km, '/km') : '—';
};

const deriveSectionPaceText = (section: SectionGroup) => {
  const duration = section.durationSeconds;
  if (!duration || duration <= 0) return '—';
  const distance = section.rows.reduce((sum, row) => sum + Number(row.distanceKm || 0), 0);
  if (section.theme === 'transition') return '—';
  if (section.theme === 'bike') return formatSpeed(distance > 0 ? distance / (duration / 3600) : 0);
  if (section.theme === 'swim') return formatPace(distance > 0 ? duration / (distance * 10) : 0, '/100m');
  return formatPace(distance > 0 ? duration / distance : 0, '/km');
};

const deriveSectionLabels = (theme: SectionThemeKey) => ({
  primary: theme === 'finish' ? 'Overall Time' : theme === 'transition' ? 'Split Time' : 'Section Time',
  secondary: theme === 'bike' ? 'Average Speed' : theme === 'swim' || theme === 'run' || theme === 'finish' ? 'Average Pace' : undefined,
  tertiary: theme === 'finish' ? 'Average Bike' : undefined,
});

const getTimingSequenceRank = (point: Record<string, any> | ResolvedTimingPoint) => {
  const token = `${(point as any)?.icon || ''} ${(point as any)?.markerType || ''} ${(point as any)?.displayName || ''} ${(point as any)?.shortName || ''}`.trim().toLowerCase();
  const theme = getTheme(point as ResolvedTimingPoint);
  const isStart = token.includes('start');
  const isFinish = token.includes('finish');
  const isTransition = token.includes('transition') || theme === 'transition' || /(^|\b)t\d(\b|\s|$)/i.test(token) || (token.includes('bike finish') && token.includes('run start')) || (token.includes('swim finish') && token.includes('bike start'));
  const isSwim = token.includes('swim') || theme === 'swim';
  const isBike = token.includes('bike') || token.includes('cycle') || theme === 'bike';
  const isRun = token.includes('run') || token.includes('trail') || token.includes('marathon') || theme === 'run';

  if (isSwim && isStart) return 10;
  if (isSwim && isFinish) return 20;
  if (isTransition && (token.includes('t1') || token.includes('bike start'))) return 30;
  if (isBike && isStart) return 40;
  if (isBike && isFinish) return 50;
  if (isTransition && (token.includes('t2') || token.includes('run start'))) return 60;
  if (isRun && isStart) return 70;
  if (isRun && isFinish) return 80;
  if (isSwim) return 15;
  if (isBike) return 45;
  if (isRun) return 75;
  if (isTransition) return 55;
  if (isFinish) return 90;
  return 100;
};

const compareTimingPointsInRaceOrder = (a: Record<string, any> | ResolvedTimingPoint, b: Record<string, any> | ResolvedTimingPoint) => {
  const rankDelta = getTimingSequenceRank(a) - getTimingSequenceRank(b);
  if (rankDelta !== 0) return rankDelta;
  const aDistance = getTimingPointDistanceKm(a as ResolvedTimingPoint);
  const bDistance = getTimingPointDistanceKm(b as ResolvedTimingPoint);
  if (aDistance !== null || bDistance !== null) {
    const distanceDelta = Number(aDistance ?? Number.POSITIVE_INFINITY) - Number(bDistance ?? Number.POSITIVE_INFINITY);
    if (distanceDelta !== 0) return distanceDelta;
  }
  const aOrder = Number((a as any)?.order ?? (a as any)?.Order ?? (a as any)?.index ?? (a as any)?.Index ?? (a as any)?.distanceKm ?? (a as any)?.distance ?? 0) || 0;
  const bOrder = Number((b as any)?.order ?? (b as any)?.Order ?? (b as any)?.index ?? (b as any)?.Index ?? (b as any)?.distanceKm ?? (b as any)?.distance ?? 0) || 0;
  if (aOrder !== bOrder) return aOrder - bOrder;
  const aLabel = String((a as any)?.displayName || (a as any)?.shortName || (a as any)?.id || '').toLowerCase();
  const bLabel = String((b as any)?.displayName || (b as any)?.shortName || (b as any)?.id || '').toLowerCase();
  return aLabel.localeCompare(bLabel);
};

const summarizeSection = (section: SectionGroup, athlete: LiveAthlete, previousSectionEnd: number | null) => {
  const end = section.rows.reduce<number | null>((acc, row) => (row.cumulativeSeconds !== null ? row.cumulativeSeconds : acc), null);
  section.durationSeconds = end !== null && previousSectionEnd !== null ? Math.max(0, end - previousSectionEnd) : end ?? null;
  section.paceText = deriveSectionPaceText(section);
  const labels = deriveSectionLabels(section.theme);
  section.primaryMetricLabel = labels.primary;
  section.primaryMetricValue = formatSecondsToHMS(section.durationSeconds || section.rows[section.rows.length - 1]?.cumulativeSeconds || null);
  section.secondaryMetricLabel = labels.secondary;
  section.secondaryMetricValue = labels.secondary ? section.paceText : undefined;
  section.tertiaryMetricLabel = labels.tertiary;
  section.tertiaryMetricValue = labels.tertiary && athlete.predictedPaceSecPerKm ? formatPace(athlete.predictedPaceSecPerKm, '/km') : undefined;
  return end;
};

const dedupeResolvedTimingPoints = (points: ResolvedTimingPoint[]) => {
  const seen = new Map<string, ResolvedTimingPoint>();

  for (const point of points) {
    const raw = point.raw as any;
    const key = [
      point.canonicalUuid,
      point.providerId,
      point.providerCode,
      point.displayName,
      point.shortName,
      point.leg,
      point.markerType,
      String(point.distanceKm ?? point.distance ?? raw?.distance ?? raw?.distanceKm ?? '').trim(),
    ]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
      .join('|');

    if (!seen.has(key)) {
      seen.set(key, point);
      continue;
    }

    const existing = seen.get(key)!;
    seen.set(key, {
      ...existing,
      ...point,
      raw: existing.raw || point.raw,
    });
  }

  return Array.from(seen.values());
};

const getMajorSectionTheme = (point: ResolvedTimingPoint, currentTheme: SectionThemeKey | null): SectionThemeKey => {
  const theme = getTheme(point);
  if (theme === 'swim' || theme === 'bike' || theme === 'run') return theme;
  if (theme === 'finish') return currentTheme || 'run';
  if (theme === 'transition') return 'transition';
  return currentTheme || 'generic';
};

export const buildSplitModalModel = ({ athlete, timingConfiguration, participant, participantsByBib, ticketDef }: DynamicSplitSummaryTableProps): SplitModalModel => {
  const resolution = resolveContestTimingPoints(athlete, timingConfiguration, participant, participantsByBib, ticketDef);
  const scopedSplits = Array.isArray((resolution as any)?.scopedSplits) ? ((resolution as any).scopedSplits as Record<string, any>[]) : [];
  const scopedSplitByUuid = scopedSplits.reduce<Record<string, Record<string, any>>>((acc, split) => {
    const splitUuid = String(split?.UUID || split?.uuid || split?.splitUuid || split?.split_uuid || split?.id || '').trim();
    if (splitUuid) acc[normalizeLookup(splitUuid)] = split;
    return acc;
  }, {});
  const scopedSplitByTimingPointUuid = scopedSplits.reduce<Record<string, Record<string, any>>>((acc, split) => {
    const timingPointUuid = String(
      split?.timingPointUuid
      || split?.timing_point_uuid
      || split?.TimingPointUUID
      || split?.timingPoint?.uuid
      || split?.timingPoint?.UUID
      || split?.timingPoint?.id
      || '',
    ).trim();
    if (timingPointUuid) acc[normalizeLookup(timingPointUuid)] = split;
    return acc;
  }, {});
  const scopedSplitDistanceByOrder = scopedSplits
    .map((split: any, index: number) => ({
      split,
      index,
      order: Number(split?.order ?? split?.Order ?? split?.index ?? split?.Index ?? index + 1) || (index + 1),
      distanceKm: normalizeDistanceFromPoint(split),
    }))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.distanceKm);
  const bib = String((athlete as any)?.bib ?? '').trim();
  const participantRecord = participant ?? participantsByBib?.[bib] ?? participantsByBib?.[bib.replace(/^0+/, '')] ?? null;
  const participantProfile = resolveParticipantProfile(participantRecord, athlete);
  const nowSeconds = Math.floor(Date.now() / 1000);

  const parseEpochSeconds = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
      }
      const parsed = Date.parse(trimmed);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed / 1000);
    }
    return null;
  };

  const parseDateTimeSeconds = (dateValue: unknown, timeValue: unknown): number | null => {
    const dateText = String(dateValue || '').trim();
    const timeText = String(timeValue || '').trim();
    if (!dateText || !timeText) return null;
    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeText)) return null;
    const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : dateText.slice(0, 10);
    const parsed = Date.parse(`${normalizedDate}T${timeText}`);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.floor(parsed / 1000);
  };

  const sourceAny = timingConfiguration as any;
  const contestUuidForStart = String(participantProfile.contestUuid || '').trim();
  const contestKeyForStart = contestUuidForStart.toLowerCase();
  const contestSource = contestUuidForStart
    ? (
      sourceAny?.contestIndex?.[contestUuidForStart]?.contest
      || sourceAny?.contestIndex?.[contestUuidForStart]
      || sourceAny?.contestIndex?.[contestKeyForStart]?.contest
      || sourceAny?.contestIndex?.[contestKeyForStart]
      || sourceAny?.contestByUuid?.[contestUuidForStart]
      || sourceAny?.contestByUuid?.[contestKeyForStart]
      || sourceAny?.splitIndex?.contestsByUuid?.[contestUuidForStart]
      || sourceAny?.splitIndex?.contestsByUuid?.[contestKeyForStart]
      || null
    )
    : null;

  const firstTimestamp = (candidates: unknown[]): number | null => {
    for (const candidate of candidates) {
      const parsed = parseEpochSeconds(candidate);
      if (parsed && parsed > 0) return parsed;
    }
    return null;
  };

  const officialStartTimeSeconds = firstTimestamp([
    parseDateTimeSeconds(ticketDef?.eventDate, ticketDef?.raceStartTime || ticketDef?.startTime),
    (participantRecord as any)?.official_start_time,
    (participantRecord as any)?.officialStartTime,
    (participantRecord as any)?.gun_start_time,
    (participantRecord as any)?.gunStartTime,
    (participantRecord as any)?.raceStartTime,
    (participantRecord as any)?.eventStartTime,
    (athlete as any)?.officialStartTime,
    (athlete as any)?.gunStartTime,
    (athlete as any)?.raceStartTime,
    contestSource?.official_start_time,
    contestSource?.officialStartTime,
    contestSource?.gun_start_time,
    contestSource?.gunStartTime,
    contestSource?.startTime,
    contestSource?.start_time,
    contestSource?.eventStartTime,
    contestSource?.eventStartAt,
    contestSource?.ETD,
    contestSource?.etd,
    participantProfile.contestEtd,
    participantProfile.contestDate,
  ]);

  const chipStartTimeSeconds = firstTimestamp([
    (participantRecord as any)?.chip_start_time,
    (participantRecord as any)?.chipStartTime,
    (participantRecord as any)?.start_time,
    (participantRecord as any)?.startTime,
    (participantRecord as any)?.start_unix,
    (participantRecord as any)?.startUnix,
    (participantRecord as any)?.startTimestamp,
    (participantRecord as any)?.result_start_timestamp,
    (participantRecord as any)?.resultStartTimestamp,
    (athlete as any)?.chipStartTime,
    (athlete as any)?.start_time,
    (athlete as any)?.startTime,
    (athlete as any)?.startTimestamp,
    participantProfile.startTime,
  ]);
  const timingPointsRaw = dedupeResolvedTimingPoints([...resolution.points]).sort(compareTimingPointsInRaceOrder);
  const savedLegSplitMapping = resolveSavedLegSplitMapping(timingConfiguration, participantProfile.contestUuid, participantProfile.contestName);
  const mappingLegs = Array.isArray(savedLegSplitMapping?.legs)
    ? [...(savedLegSplitMapping?.legs || [])]
        .filter((leg) => leg?.enabled !== false)
        .sort((a, b) => Number(a?.display_order ?? 0) - Number(b?.display_order ?? 0))
    : [];
  const mappingSplits = Array.isArray(savedLegSplitMapping?.splits)
    ? [...(savedLegSplitMapping?.splits || [])]
        .filter((split) => split?.visibility !== 'hidden')
        .sort((a, b) => Number(a?.display_order ?? 0) - Number(b?.display_order ?? 0) || Number(a?.split_index ?? 0) - Number(b?.split_index ?? 0))
    : [];

  const mappingLegByIndex = mappingLegs.reduce<Record<number, SavedLegMapping>>((acc, leg) => {
    acc[Number(leg?.leg_index ?? 0)] = leg;
    return acc;
  }, {});

  const mappingLegOrderByIndex = mappingLegs.reduce<Record<number, number>>((acc, leg) => {
    acc[Number(leg?.leg_index ?? 0)] = Number(leg?.display_order ?? 0);
    return acc;
  }, {});

  const timingPointBySplitIndex = timingPointsRaw.reduce<Record<number, ResolvedTimingPoint[]>>((acc, point, index) => {
    const rawSplit = (point.raw as any)?.split || {};
    const splitIndex = Number(rawSplit?.split_index ?? rawSplit?.index ?? rawSplit?.Index ?? rawSplit?.order ?? rawSplit?.Order ?? index + 1);
    if (!acc[splitIndex]) acc[splitIndex] = [];
    acc[splitIndex].push(point);
    return acc;
  }, {});

  const timingPointByTimingPointId = timingPointsRaw.reduce<Record<string, ResolvedTimingPoint>>((acc, point) => {
    const key = normalizeLookup(point?.providerId || point?.canonicalUuid || (point.raw as any)?.split?.timingPointUuid || (point.raw as any)?.split?.TimingPointUUID || '');
    if (key && !acc[key]) acc[key] = point;
    return acc;
  }, {});

  const timingPointByName = timingPointsRaw.reduce<Record<string, ResolvedTimingPoint>>((acc, point) => {
    const key = normalizeLookup(point?.displayName || point?.shortName || '');
    if (key && !acc[key]) acc[key] = point;
    return acc;
  }, {});

  const hasSavedLegSplitMapping = mappingLegs.length > 0 && mappingSplits.length > 0;

  const mappedTimingPoints = mappingSplits.length > 0
    ? mappingSplits.reduce<ResolvedTimingPoint[]>((acc, mappedSplit, mappedIndex) => {
        const mappedSplitIndex = Number(mappedSplit?.split_index ?? mappedIndex + 1);
        const mappedTimingPointId = normalizeLookup(mappedSplit?.timing_point_id || '');
        const importedSplitName = normalizeLookup(mappedSplit?.metadata?.imported_split_name || mappedSplit?.timing_point_name || '');
        const customSplitName = String(mappedSplit?.split_name || '').trim();
        const mappedDistanceKm = normalizeDistanceFromPoint({
          distanceKm: mappedSplit?.distance,
          distance: mappedSplit?.distance,
          cumulativeDistance: mappedSplit?.distance,
          km: mappedSplit?.distance,
          meters: mappedSplit?.distance,
          distanceUnit: 'km',
        }) ?? null;

        let matchedPoint: ResolvedTimingPoint | null = null;

        const indexedCandidates = timingPointBySplitIndex[mappedSplitIndex] || [];
        if (indexedCandidates.length > 0) {
          matchedPoint = indexedCandidates[0];
        }

        if (!matchedPoint && mappedTimingPointId) {
          matchedPoint = timingPointByTimingPointId[mappedTimingPointId] || null;
        }

        if (!matchedPoint && importedSplitName) {
          matchedPoint = timingPointByName[importedSplitName] || null;
        }

        if (!matchedPoint && customSplitName) {
          matchedPoint = timingPointByName[normalizeLookup(customSplitName)] || null;
        }

        const mappedLeg = mappingLegByIndex[Number(mappedSplit?.leg_index ?? 0)] || null;

        if (!matchedPoint) {
          const syntheticLabel = customSplitName || mappedSplit?.timing_point_name || importedSplitName || `Split ${mappedSplitIndex}`;
          const syntheticPoint: ResolvedTimingPoint = {
            id: String(mappedSplit?.timing_point_id || mappedSplitIndex),
            canonicalUuid: String(mappedSplit?.timing_point_id || mappedSplitIndex),
            providerId: String(mappedSplit?.timing_point_id || mappedSplitIndex),
            providerCode: String(mappedSplit?.timing_point_id || mappedSplitIndex),
            displayName: syntheticLabel,
            shortName: syntheticLabel,
            eventId: null,
            distance: mappedDistanceKm,
            distanceKm: mappedDistanceKm,
            leg: null,
            order: Number(mappedSplit?.display_order ?? mappedSplitIndex),
            latitude: 0,
            longitude: 0,
            markerType: 'checkpoint',
            icon: 'checkpoint',
            leaderboard: false,
            transition: false,
            finish: false,
            visible: mappedSplit?.visibility !== 'hidden',
            isLeaderboard: false,
            isTransition: false,
            isFinish: false,
            raw: {
              split: {
                UUID: String(mappedSplit?.timing_point_id || mappedSplitIndex),
                uuid: String(mappedSplit?.timing_point_id || mappedSplitIndex),
                id: String(mappedSplit?.timing_point_id || mappedSplitIndex),
                splitUuid: String(mappedSplit?.timing_point_id || mappedSplitIndex),
                split_uuid: String(mappedSplit?.timing_point_id || mappedSplitIndex),
                name: syntheticLabel,
                label: syntheticLabel,
                distance: mappedDistanceKm,
                distanceKm: mappedDistanceKm,
                cumulativeDistance: mappedDistanceKm,
              },
              legSplitMapping: {
                ...mappedSplit,
                leg_name: mappedLeg?.leg_name || null,
              },
            },
          };
          acc.push(syntheticPoint);
          return acc;
        }
        acc.push({
          ...matchedPoint,
          displayName: customSplitName || matchedPoint.displayName,
          shortName: customSplitName || matchedPoint.shortName,
          distance: mappedDistanceKm ?? matchedPoint.distance,
          distanceKm: mappedDistanceKm ?? matchedPoint.distanceKm,
          leg: mappedLeg?.leg_name || matchedPoint.leg,
          raw: {
            ...(matchedPoint.raw || {}),
            legSplitMapping: {
              ...mappedSplit,
              leg_name: mappedLeg?.leg_name || null,
            },
            split: {
              ...((matchedPoint.raw as any)?.split || {}),
              UUID: String(mappedSplit?.timing_point_id || mappedSplitIndex),
              uuid: String(mappedSplit?.timing_point_id || mappedSplitIndex),
              id: String(mappedSplit?.timing_point_id || mappedSplitIndex),
              splitUuid: String(mappedSplit?.timing_point_id || mappedSplitIndex),
              split_uuid: String(mappedSplit?.timing_point_id || mappedSplitIndex),
              name: customSplitName || matchedPoint.displayName,
              label: customSplitName || matchedPoint.shortName,
              distance: mappedDistanceKm ?? (matchedPoint.raw as any)?.split?.distance,
              distanceKm: mappedDistanceKm ?? (matchedPoint.raw as any)?.split?.distanceKm,
              cumulativeDistance: mappedDistanceKm ?? (matchedPoint.raw as any)?.split?.cumulativeDistance,
            },
          },
        });
        return acc;
      }, [])
      .sort((a, b) => {
        const aSplit = (a.raw as any)?.legSplitMapping || {};
        const bSplit = (b.raw as any)?.legSplitMapping || {};
        const aLegIndex = Number(aSplit?.leg_index ?? 0);
        const bLegIndex = Number(bSplit?.leg_index ?? 0);
        const aLegOrder = mappingLegOrderByIndex[aLegIndex] ?? Number.MAX_SAFE_INTEGER;
        const bLegOrder = mappingLegOrderByIndex[bLegIndex] ?? Number.MAX_SAFE_INTEGER;
        if (aLegOrder !== bLegOrder) return aLegOrder - bLegOrder;

        const aSplitOrder = Number(aSplit?.display_order ?? 0) || Number(aSplit?.split_index ?? 0);
        const bSplitOrder = Number(bSplit?.display_order ?? 0) || Number(bSplit?.split_index ?? 0);
        if (aSplitOrder !== bSplitOrder) return aSplitOrder - bSplitOrder;

        const aIndex = Number(aSplit?.split_index ?? 0) || 0;
        const bIndex = Number(bSplit?.split_index ?? 0) || 0;
        return aIndex - bIndex;
      })
    : [];

  const athleteSplits = (Array.isArray(athlete.splits) ? [...athlete.splits] : []).filter((split) => typeof split?.time === 'number' && split.time >= 0).sort((a, b) => (a.time || 0) - (b.time || 0));
  const athleteStatusRaw = String(participantProfile.startTime ? athlete.status || '' : athlete.status || '').trim().toLowerCase();
  const courseMaps: any = ticketDef?.courseMaps || {};
  const athleteSubCategoryId = String(
    (athlete as any)?.subCategoryId
    || (athlete as any)?.selectedSubCategoryId
    || (athlete as any)?.sub_category_id
    || (athlete as any)?.registration?.subCategoryId
    || (athlete as any)?.registration?.selectedSubCategoryId
    || (participant as any)?.subCategoryId
    || (participant as any)?.selectedSubCategoryId
    || '',
  ).trim();
  const subCategoryRow = athleteSubCategoryId && Array.isArray((ticketDef as any)?.subCategories)
    ? (ticketDef as any).subCategories.find((sub: any) => String(sub?.id || '').trim() === athleteSubCategoryId)
    : null;

  const timingPoints = hasSavedLegSplitMapping
    ? mappedTimingPoints
    : timingPointsRaw;
  const noContestAssigned = resolution.noContestAssigned && timingPoints.length === 0;

  const normalizeCourseDistanceKm = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    if (numeric === 0) return 0;
    return numeric >= 1000 ? numeric / 1000 : numeric;
  };

  const resolveCoursePoints = (theme: SectionThemeKey) => {
    if (theme === 'swim') return Array.isArray(courseMaps.swimSplits) ? courseMaps.swimSplits : [];
    if (theme === 'bike') return Array.isArray(courseMaps.bikeSplits) ? courseMaps.bikeSplits : [];
    if (theme === 'run') {
      const runPoints = Array.isArray(courseMaps.run2Splits) && courseMaps.run2Splits.length > 0
        ? courseMaps.run2Splits
        : Array.isArray(courseMaps.runSplits) && courseMaps.runSplits.length > 0
          ? courseMaps.runSplits
          : [];
      return runPoints;
    }
    return [];
  };

  const subCategoryDistanceKm = normalizeCourseDistanceKm((subCategoryRow as any)?.distance ?? (subCategoryRow as any)?.distanceKm);
  const swimDistanceKm = normalizeCourseDistanceKm(courseMaps.swimDistance) ?? subCategoryDistanceKm;
  const bikeDistanceKm = normalizeCourseDistanceKm(courseMaps.bikeDistance);
  const runDistanceKm = normalizeCourseDistanceKm(courseMaps.runDistance ?? courseMaps.run2Distance ?? courseMaps.run1Distance);
  const run1DistanceKm = normalizeCourseDistanceKm(courseMaps.run1Distance);
  const run2DistanceKm = normalizeCourseDistanceKm(courseMaps.run2Distance);
  const totalCourseDistanceKm = [swimDistanceKm, bikeDistanceKm, runDistanceKm, run1DistanceKm, run2DistanceKm].reduce<number>((sum, value) => sum + (value || 0), 0);

  let lastDisplayDistanceKm = 0;

  const resolveDisplayDistanceKm = (point: ResolvedTimingPoint, theme: SectionThemeKey, themeIndex: number) => {
    const pointLabelKeys = [
      point.displayName,
      point.shortName,
      point.providerCode,
      point.providerId,
      String((point.raw as any)?.split?.name || (point.raw as any)?.split?.label || (point.raw as any)?.split?.Name || (point.raw as any)?.split?.Label || ''),
    ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);

    const findPointDistance = (points: Array<Record<string, any>>, baseOffsetKm: number, totalKm: number | null) => {
      if (points.length === 0) return null;

      const matchedPoint = points.find((candidate, index) => {
        const candidateKeys = [
          candidate?.id,
          candidate?.name,
          candidate?.label,
        ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
        return candidateKeys.some((key) => pointLabelKeys.includes(key)) || index === themeIndex;
      }) || points[themeIndex] || null;

      const explicitDistance = normalizeCourseDistanceKm(matchedPoint?.distance);
      if (explicitDistance !== null) return baseOffsetKm + explicitDistance;

      if (points.length === 1) {
        return baseOffsetKm + (totalKm || 0);
      }

      if (totalKm !== null && Number.isFinite(totalKm) && totalKm >= 0) {
        const interpolated = points.length > 1 ? (totalKm * (themeIndex / Math.max(1, points.length - 1))) : 0;
        return baseOffsetKm + interpolated;
      }

      return baseOffsetKm;
    };

    if (theme === 'finish') return totalCourseDistanceKm > 0 ? totalCourseDistanceKm : lastDisplayDistanceKm;
    if (theme === 'transition' || theme === 'generic') return lastDisplayDistanceKm;

    if (theme === 'swim') return findPointDistance(resolveCoursePoints('swim'), 0, swimDistanceKm);
    if (theme === 'bike') return findPointDistance(resolveCoursePoints('bike'), swimDistanceKm || 0, bikeDistanceKm);
    if (theme === 'run') return findPointDistance(resolveCoursePoints('run'), (swimDistanceKm || 0) + (bikeDistanceKm || 0), runDistanceKm);

    return lastDisplayDistanceKm;
  };

  const getConfiguredSplitDistanceKm = (point: ResolvedTimingPoint, split: Split | null) => {
    const splitUuid = extractSplitUuidFromSplit(split) || extractSplitUuidFromPoint(point);
    const splitByUuid = splitUuid ? scopedSplitByUuid[normalizeLookup(splitUuid)] : null;
    const timingPointUuid = String(point?.providerId || point?.canonicalUuid || (point?.raw as any)?.split?.timingPointUuid || '').trim();
    const splitByTimingPoint = timingPointUuid ? scopedSplitByTimingPointUuid[normalizeLookup(timingPointUuid)] : null;
    const resolvedSplit = splitByUuid || splitByTimingPoint || null;
    if (!resolvedSplit) return null;

    const candidates = [
      resolvedSplit?.cumulativeDistance,
      resolvedSplit?.cumulative_distance,
      resolvedSplit?.distanceFromStart,
      resolvedSplit?.distance_from_start,
      resolvedSplit?.distanceKm,
      resolvedSplit?.distance_km,
      resolvedSplit?.distance,
      resolvedSplit?.DistanceFromStart,
      resolvedSplit?.raw?.cumulativeDistance,
      resolvedSplit?.raw?.distanceFromStart,
      resolvedSplit?.raw?.distanceKm,
      resolvedSplit?.raw?.distance,
    ];

    for (const candidate of candidates) {
      const km = normalizeDistanceFromPoint({ distanceKm: candidate, distance: candidate, DistanceFromStart: candidate });
      if (km !== null) return km;
    }

    return null;
  };

  const baseRows: TimingRow[] = [];
  let lastCumulativeSeconds: number | null = null;
  let lastPositionRank: number | null = null;
  const themeCounter = new Map<SectionThemeKey, number>();

  timingPoints.forEach((point: ResolvedTimingPoint, index: number) => {
    const theme = getTheme(point);
    const themeIndex = themeCounter.get(theme) || 0;
    themeCounter.set(theme, themeIndex + 1);
    const split = findSplitForPoint(point, athleteSplits);
    const reached = Boolean(split && typeof split.time === 'number' && split.time >= 0);
    const cumulativeSeconds = reached ? Number(split?.time ?? null) : null;
    const splitDistanceKm = getTimingPointDistanceKm(point);
    const configuredSplitDistanceKm = getConfiguredSplitDistanceKm(point, split);
    const orderedSplitDistanceKm = scopedSplitDistanceByOrder[index] ?? null;
    const distanceKm = splitDistanceKm !== null
      ? splitDistanceKm
      : configuredSplitDistanceKm !== null
        ? configuredSplitDistanceKm
        : orderedSplitDistanceKm !== null
          ? orderedSplitDistanceKm
          : resolveDisplayDistanceKm(point, theme, themeIndex);
    const splitSeconds = reached && cumulativeSeconds !== null ? (isFinishPoint(point) ? cumulativeSeconds : lastCumulativeSeconds !== null ? Math.max(0, cumulativeSeconds - lastCumulativeSeconds) : cumulativeSeconds) : null;
    const avgSpeedKph = distanceKm && splitSeconds && splitSeconds > 0 ? distanceKm / (splitSeconds / 3600) : null;
    const pointRank = (() => {
      const raw = point.raw as any;
      const candidate = Number(raw?.rank ?? raw?.overallRank ?? raw?.position ?? raw?.overallPosition ?? raw?.oRank ?? raw?.cRank);
      return Number.isFinite(candidate) && candidate > 0 ? candidate : null;
    })();
    const rankDelta = pointRank !== null && lastPositionRank !== null ? lastPositionRank - pointRank : null;
    if (pointRank !== null) lastPositionRank = pointRank;
    if (reached && cumulativeSeconds !== null) lastCumulativeSeconds = cumulativeSeconds;
    if (Number.isFinite(Number(distanceKm))) lastDisplayDistanceKm = Number(distanceKm);
    baseRows.push({ point, split, index, distanceKm, splitSeconds, cumulativeSeconds, avgSpeedKph, trend: 'neutral', reached, state: 'future', isFastest: false, rankDelta, pointRank });
  });

  const reachedCount = baseRows.filter((row) => row.reached).length;
  const lastReachedIndex = [...baseRows].reverse().findIndex((row) => row.reached);
  const currentIndex = lastReachedIndex === -1 ? -1 : baseRows.length - 1 - lastReachedIndex;
  const isDnfLike = ['dnf', 'dns', 'dnq'].includes(athleteStatusRaw);
  const bestMap = new Map<string, { index: number; score: number }>();
  baseRows.forEach((row, idx) => {
    if (!row.reached || row.splitSeconds === null) return;
    const key = pointGroupKey(row.point);
    const score = getTheme(row.point) === 'bike' ? -(row.avgSpeedKph || 0) : row.splitSeconds;
    const existing = bestMap.get(key);
    if (!existing || score < existing.score) bestMap.set(key, { index: idx, score });
  });

  const rows = baseRows.map((row, idx) => ({
    ...row,
    splitUuid: extractSplitUuidFromSplit(row.split) || extractSplitUuidFromPoint(row.point),
    state: row.reached
      ? (idx === currentIndex ? 'current' : 'completed')
      : (isDnfLike && currentIndex >= 0 && idx > currentIndex ? 'missed' : (currentIndex >= 0 && idx === currentIndex ? 'current' : 'future')) as PointState,
    isFastest: bestMap.get(pointGroupKey(row.point))?.index === idx,
    rankDelta: idx === currentIndex && athlete.prevRank !== undefined && athlete.rank !== undefined ? athlete.prevRank - athlete.rank : row.rankDelta,
  }));

  const missingDistanceLogs = rows
    .filter((row) => row.distanceKm === null)
    .map((row) => {
      const splitUuid = String(row.splitUuid || extractSplitUuidFromPoint(row.point) || 'unknown').trim() || 'unknown';
      return `Missing distance for split ${splitUuid}`;
    });

  const sections: SectionGroup[] = [];
  const legErrors: string[] = [];

  if (hasSavedLegSplitMapping) {
    const rowBySplitIndex = new Map<number, TimingRow>();
    const rowByTimingPointId = new Map<string, TimingRow>();

    for (const row of rows) {
      const mappedSplit = (row.point.raw as any)?.legSplitMapping || {};
      const splitIndex = Number(mappedSplit?.split_index ?? NaN);
      if (Number.isFinite(splitIndex) && !rowBySplitIndex.has(splitIndex)) {
        rowBySplitIndex.set(splitIndex, row);
      }

      const timingPointId = normalizeLookup(mappedSplit?.timing_point_id || row.splitUuid || row.point.providerId || row.point.canonicalUuid || '');
      if (timingPointId && !rowByTimingPointId.has(timingPointId)) {
        rowByTimingPointId.set(timingPointId, row);
      }
    }

    let previousSectionEnd: number | null = null;
    for (const leg of mappingLegs) {
      const theme = resolveLegTheme({
        id: `mapped-leg-${leg.leg_index}`,
        uuid: `mapped-leg-${leg.leg_index}`,
        contestUuid: participantProfile.contestUuid,
        name: leg.leg_name,
        label: leg.leg_name,
        color: null,
        firstSplitUuid: null,
        lastSplitUuid: null,
        order: Number(leg.display_order ?? leg.leg_index),
        configuration: null,
        raw: leg as any,
      });

      const legSplits = mappingSplits
        .filter((split) => Number(split?.leg_index ?? 0) === Number(leg.leg_index))
        .sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0) || Number(a.split_index ?? 0) - Number(b.split_index ?? 0));

      const sectionRows = legSplits
        .map((split) => {
          const splitIndex = Number(split?.split_index ?? NaN);
          const timingPointId = normalizeLookup(split?.timing_point_id || '');
          return (Number.isFinite(splitIndex) && rowBySplitIndex.get(splitIndex))
            || (timingPointId ? rowByTimingPointId.get(timingPointId) : null)
            || null;
        })
        .filter((row): row is TimingRow => Boolean(row));

      if (sectionRows.length === 0) {
        legErrors.push(`[LEG ERROR] Leg resolved zero splits leg=${leg.leg_name} index=${leg.leg_index}`);
        continue;
      }

      const from = Math.min(...sectionRows.map((row) => row.index));
      const to = Math.max(...sectionRows.map((row) => row.index));
      const section: SectionGroup = {
        key: `mapped-leg-${leg.leg_index}`,
        theme,
        label: leg.leg_name || 'LEG',
        iconKey: theme,
        rows: sectionRows,
        startIndex: from,
        endIndex: to,
        reachedCount: sectionRows.filter((row) => row.reached).length,
        durationSeconds: null,
        paceText: '—',
        primaryMetricLabel: '',
        primaryMetricValue: '—',
        summaryChips: [],
      };
      previousSectionEnd = summarizeSection(section, athlete, previousSectionEnd) ?? previousSectionEnd;
      sections.push(section);
    }
  } else {
    const resolvedContestLegs = resolveContestLegs(timingConfiguration, participantProfile.contestUuid);

    if (resolvedContestLegs.length > 0) {
      const rowSplitLookup = rows.reduce<Map<string, number[]>>((map, row, index) => {
        const key = normalizeLookup(row.splitUuid);
        if (!key) return map;
        const current = map.get(key) || [];
        current.push(index);
        map.set(key, current);
        return map;
      }, new Map<string, number[]>());

      const rowLegLookup = rows.reduce<Map<string, number[]>>((map, row, index) => {
        const splitUuidKey = normalizeLookup(row.splitUuid);
        const splitSource = splitUuidKey ? scopedSplitByUuid[splitUuidKey] : null;
        const legUuid = extractLegUuidFromSplit(splitSource || ((row.point.raw as any)?.split || null));
        const legKey = normalizeLookup(legUuid);
        if (!legKey) return map;
        const current = map.get(legKey) || [];
        current.push(index);
        map.set(legKey, current);
        return map;
      }, new Map<string, number[]>());

      const assignedRowIndexes = new Set<number>();

      let previousSectionEnd: number | null = null;
      for (const leg of resolvedContestLegs) {
        const theme = resolveLegTheme(leg);
        const legKey = normalizeLookup(leg.uuid);
        let sectionRows = (rowLegLookup.get(legKey) || [])
          .filter((index) => !assignedRowIndexes.has(index))
          .sort((a, b) => a - b)
          .map((index) => rows[index]);

        if (sectionRows.length === 0) {
          const firstCandidates = rowSplitLookup.get(normalizeLookup(leg.firstSplitUuid)) || [];
          const lastCandidates = rowSplitLookup.get(normalizeLookup(leg.lastSplitUuid)) || [];
          const startIndex = firstCandidates.length > 0 ? firstCandidates[0] : -1;
          const endIndex = lastCandidates.length > 0 ? lastCandidates[lastCandidates.length - 1] : -1;

          if (startIndex >= 0 && endIndex >= 0) {
            const from = Math.min(startIndex, endIndex);
            const to = Math.max(startIndex, endIndex);
            sectionRows = rows.slice(from, to + 1).filter((row) => !assignedRowIndexes.has(row.index));
          }
        }

        if (theme === 'swim' || theme === 'bike' || theme === 'run') {
          const filteredRows = sectionRows.filter((row) => {
            const rowTheme = getTheme(row.point);
            return rowTheme === theme || rowTheme === 'finish';
          });
          if (filteredRows.length > 0) sectionRows = filteredRows;
        }

        if (sectionRows.length === 0) {
          legErrors.push(`[LEG ERROR] Leg resolved zero splits leg=${leg.name} uuid=${leg.uuid}`);
          continue;
        }

        sectionRows.forEach((row) => assignedRowIndexes.add(row.index));
        const from = Math.min(...sectionRows.map((row) => row.index));
        const to = Math.max(...sectionRows.map((row) => row.index));
        const section: SectionGroup = {
          key: leg.uuid,
          theme,
          label: leg.name || leg.label || 'LEG',
          iconKey: theme,
          rows: sectionRows,
          startIndex: from,
          endIndex: to,
          reachedCount: sectionRows.filter((row) => row.reached).length,
          durationSeconds: null,
          paceText: '—',
          primaryMetricLabel: '',
          primaryMetricValue: '—',
          summaryChips: [],
        };
        previousSectionEnd = summarizeSection(section, athlete, previousSectionEnd) ?? previousSectionEnd;
        sections.push(section);
      }
    }

    if (sections.length === 0) {
      let currentSection: SectionGroup | null = null;
      let previousSectionEnd: number | null = null;
      rows.forEach((row, index) => {
        const sectionTheme = getMajorSectionTheme(row.point, currentSection?.theme || null);
        const key = sectionTheme;
        if (!currentSection || currentSection.key !== key) {
          if (currentSection) {
            previousSectionEnd = summarizeSection(currentSection, athlete, previousSectionEnd) ?? previousSectionEnd;
            sections.push(currentSection);
          }
          currentSection = { key, theme: sectionTheme, label: sectionTheme.toUpperCase(), iconKey: sectionTheme, rows: [], startIndex: index, endIndex: index, reachedCount: 0, durationSeconds: null, paceText: '—', primaryMetricLabel: '', primaryMetricValue: '—', summaryChips: [] };
        }
        currentSection.rows.push(row);
        currentSection.endIndex = index;
        if (row.reached) currentSection.reachedCount += 1;
      });
      if (currentSection) {
        summarizeSection(currentSection, athlete, previousSectionEnd);
        sections.push(currentSection);
      }
    }
  }

  const filteredSections = mappingSplits.length > 0
    ? sections.filter((section) => section.rows.length > 0)
    : sections.filter((section) => {
        const theme = section.theme;
        if (theme === 'transition' || theme === 'generic') return true;

        const hasSwimSplits = Array.isArray(courseMaps.swimSplits) && courseMaps.swimSplits.length > 0;
        const hasBikeSplits = Array.isArray(courseMaps.bikeSplits) && courseMaps.bikeSplits.length > 0;
        const hasRunSplits = (Array.isArray(courseMaps.run2Splits) && courseMaps.run2Splits.length > 0)
                          || (Array.isArray(courseMaps.runSplits) && courseMaps.runSplits.length > 0);

        if (theme === 'swim') return hasSwimSplits;
        if (theme === 'bike') return hasBikeSplits;
        if (theme === 'run') return hasRunSplits;

        return true;
      });

  const completedRows = rows.filter((row) => row.reached).length;
  const lastReachedRow = [...rows].reverse().find((row) => row.reached) || null;
  const nextExpectedRow = rows.find((row) => !row.reached) || rows[rows.length - 1] || null;
  const currentPoint = rows.find((row) => row.state === 'current') || null;
  const selectedSection = currentPoint
    ? filteredSections.find((section) => section.rows.some((row) => row.point.id === currentPoint.point.id && row.index === currentPoint.index)) || filteredSections[0] || null
    : null;
  const totalDistanceKm: number = (() => {
    const finishPoint = timingPoints.find((point: ResolvedTimingPoint) => isFinishPoint(point));
    const finishDistance = finishPoint ? getTimingPointDistanceKm(finishPoint) : null;
    if (totalCourseDistanceKm > 0) return totalCourseDistanceKm;
    if (finishDistance && finishDistance > 0) return finishDistance;
    return rows.reduce((sum, row) => Math.max(sum, Number(row.distanceKm || 0)), 0);
  })();
  const totalRaceTimeSeconds = lastReachedRow?.cumulativeSeconds ?? (athleteStatusRaw === 'finished' ? lastReachedRow?.cumulativeSeconds ?? null : null);
  const overallAverageSpeed = totalDistanceKm > 0 && totalRaceTimeSeconds && totalRaceTimeSeconds > 0 ? totalDistanceKm / (totalRaceTimeSeconds / 3600) : null;
  const overallAveragePace = totalDistanceKm > 0 && totalRaceTimeSeconds && totalRaceTimeSeconds > 0 ? totalRaceTimeSeconds / totalDistanceKm : null;
  const hasFinishedPoint = rows.some((row) => row.reached && isFinishPoint(row.point));
  const shouldShowRanks = completedRows > 0 || hasFinishedPoint || ['dnf', 'dns', 'dnq'].includes(athleteStatusRaw);
  const rankSummary = shouldShowRanks
    ? { overall: getRank(athlete, 'overall'), gender: getRank(athlete, 'gender'), category: getRank(athlete, 'category') }
    : { overall: null, gender: null, category: null };
  filteredSections.forEach((section) => {
    section.summaryChips = [
      { label: 'Overall', value: getRankChip(rankSummary.overall) },
      { label: 'Gender', value: getRankChip(rankSummary.gender) },
      { label: 'AG', value: getRankChip(rankSummary.category) },
    ];
  });
  const athleteStatus = athleteStatusRaw === 'dnf'
    ? 'DNF'
    : athleteStatusRaw === 'dns'
      ? 'DNS'
      : athleteStatusRaw === 'dnq'
        ? 'DNQ'
        : hasFinishedPoint
          ? 'Finished'
          : completedRows === 0
            ? 'Not Yet Started'
            : 'On Course';
  const hasOfficialStart = Boolean(officialStartTimeSeconds && officialStartTimeSeconds > 0);
  const officialStarted = hasOfficialStart ? nowSeconds >= Number(officialStartTimeSeconds) : completedRows > 0;
  const hasChipStart = Boolean((chipStartTimeSeconds && chipStartTimeSeconds > 0) || completedRows > 0);
  const hasAnyLiveProgress = completedRows > 0;

  const chipRaceTimeSeconds = (() => {
    if (typeof totalRaceTimeSeconds === 'number' && Number.isFinite(totalRaceTimeSeconds) && totalRaceTimeSeconds >= 0) {
      return Math.floor(totalRaceTimeSeconds);
    }
    if (hasChipStart && chipStartTimeSeconds && chipStartTimeSeconds > 0) {
      return Math.max(0, nowSeconds - chipStartTimeSeconds);
    }
    return null;
  })();

  const officialRaceTimeSeconds = (() => {
    if (!hasOfficialStart || !officialStarted || !officialStartTimeSeconds) return null;
    if (athleteStatus === 'Finished') {
      if (chipRaceTimeSeconds !== null && chipStartTimeSeconds && chipStartTimeSeconds > 0) {
        return Math.max(0, Math.floor(chipRaceTimeSeconds + (chipStartTimeSeconds - officialStartTimeSeconds)));
      }
      if (chipRaceTimeSeconds !== null) return Math.max(0, Math.floor(chipRaceTimeSeconds));
    }
    return Math.max(0, nowSeconds - officialStartTimeSeconds);
  })();

  const lifecycleState: SplitModalModel['lifecycleState'] = (() => {
    if (athleteStatus === 'Finished') return 'FINISHED';
    if (hasOfficialStart && !officialStarted) return 'UPCOMING';
    if (officialStarted && !hasChipStart && !hasAnyLiveProgress) return 'OFFICIAL_STARTED_WAITING_CHIP';
    if (hasChipStart && !hasAnyLiveProgress) return 'CHIP_STARTED';
    if (hasAnyLiveProgress) return 'LIVE_RACING';
    return hasOfficialStart ? 'UPCOMING' : 'OFFICIAL_STARTED_WAITING_CHIP';
  })();

  const lifecycleLabel = lifecycleState === 'UPCOMING'
    ? 'Upcoming'
    : lifecycleState === 'OFFICIAL_STARTED_WAITING_CHIP'
      ? 'Waiting for Chip Start'
      : lifecycleState === 'CHIP_STARTED'
        ? 'Chip Started · Waiting for First Checkpoint'
        : lifecycleState === 'LIVE_RACING'
          ? 'Live Racing'
          : 'Finished';
  const currentSpeedText = selectedSection ? selectedSection.paceText : '—';
  const estimatedFinishText = athlete.etaFinishUTC ? formatTimeOfDay(athlete.etaFinishUTC) : '—';
  const gapToLeaderText = !shouldShowRanks || rankSummary.overall === null || rankSummary.overall === undefined ? '—' : rankSummary.overall <= 1 ? 'Leader' : `+${rankSummary.overall - 1}`;
  const currentStatusLabel = lifecycleState === 'UPCOMING'
    ? 'Registered · Waiting for Official Start'
    : lifecycleState === 'OFFICIAL_STARTED_WAITING_CHIP'
      ? 'Waiting for Chip Start'
      : lifecycleState === 'CHIP_STARTED'
        ? 'Chip Started · Waiting for First Timing Read'
        : lifecycleState === 'FINISHED'
          ? 'Finished'
          : (athleteStatus || 'On Course');

  const resolvedSplitDebug = resolution.debug
    ? {
      ...resolution.debug,
      logs: [...(Array.isArray((resolution.debug as any)?.logs) ? (resolution.debug as any).logs : []), ...missingDistanceLogs],
    }
    : {
      contestUuid: participantProfile.contestUuid,
      contestName: participantProfile.contestName,
      splitSource: String((timingConfiguration as any)?.source || 'KV'),
      eventConfigurationVersion: null,
      lastSynced: String((timingConfiguration as any)?.importedAt || '').trim() || null,
      contestFound: false,
      splitCount: timingPoints.length,
      courseDistanceKm: totalDistanceKm,
      duplicateSplitCount: 0,
      missingTimingPointCount: 0,
      validation: {
        contestUuidFound: Boolean(participantProfile.contestUuid),
        contestExists: false,
        splitsFound: timingPoints.length > 0,
        sortedByDistance: true,
        courseDistanceCalculated: totalDistanceKm >= 0,
      },
      splits: timingPoints.map((point) => ({
        name: getPointDisplayLabel(point, 0),
        splitUuid: String((point.raw as any)?.split?.UUID || (point.raw as any)?.split?.uuid || point.providerId || '').trim() || null,
        timingPointUuid: String((point.raw as any)?.split?.TimingPointUUID || (point.raw as any)?.split?.timingPointUUID || point.providerId || '').trim() || null,
        distanceKm: getTimingPointDistanceKm(point),
      })),
      logs: missingDistanceLogs,
    };

  const model: SplitModalModel = {
    participantProfile,
    athleteStatus,
    noContestAssigned,
    isNotStarted: lifecycleState === 'UPCOMING' || lifecycleState === 'OFFICIAL_STARTED_WAITING_CHIP',
    isFinished: athleteStatus === 'Finished',
    isDnfLike,
    lifecycleState,
    lifecycleLabel,
    officialStartTimeSeconds,
    chipStartTimeSeconds,
    officialRaceTimeSeconds,
    chipRaceTimeSeconds,
    timingPoints,
    rows,
    sections: filteredSections,
    currentIndex,
    currentPoint,
    currentSection: selectedSection,
    totalDistanceKm,
    totalRaceTimeSeconds,
    overallAverageSpeed,
    overallAveragePace,
    completedRows,
    currentSpeedText,
    estimatedFinishText,
    gapToLeaderText,
    currentStatusLabel,
    lastUpdatedSeconds: Math.max(1, Math.round((Date.now() - Number(athlete.lastUpdateTime || Date.now())) / 1000)),
    sectionTimeline: filteredSections.map((section) => ({ section, state: section.rows.some((row) => row.state === 'current') ? 'current' : section.rows.every((row) => row.reached) ? 'completed' : section.rows.some((row) => row.state === 'missed') ? 'missed' : 'future' })),
    rankSummary,
    splitDebug: resolvedSplitDebug,
  };

  if (legErrors.length > 0) {
    model.splitDebug.logs.push(...legErrors);
  }

  return model;
};
