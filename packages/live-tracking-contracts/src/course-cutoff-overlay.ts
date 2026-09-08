import type { CanonicalContestCourse, CanonicalCourseBundle, CanonicalRaceLeg } from './contracts';

type MappingRow = {
  leg_index?: unknown;
  leg_name?: unknown;
  split_index?: unknown;
  split_uuid?: unknown;
  timing_point_id?: unknown;
  cutoff_type?: unknown;
  cutoff_value?: unknown;
  metadata?: Record<string, unknown> | null;
};

export type BergmanCutoffMapping = {
  contest_id?: unknown;
  contest_uuid?: unknown;
  provider_event_uuid?: unknown;
  updated_at?: unknown;
  legs?: MappingRow[];
  splits?: MappingRow[];
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function cutoffSeconds(row: MappingRow): number | null {
  const type = text(row.cutoff_type ?? row.metadata?.cutoff_type).toLowerCase();
  if (type !== 'cumulative' && type !== 'overall') return null;
  const raw = row.cutoff_value ?? row.metadata?.cutoff_value;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  const value = text(raw);
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const parts = value.split(':').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function legToken(value: unknown): CanonicalRaceLeg['type'] | null {
  const token = text(value).toLowerCase();
  if (token.includes('swim')) return 'swim';
  if (token.includes('bike') || token.includes('cycle')) return 'bike';
  if (/run\s*1|run_1/.test(token)) return 'run_1';
  if (/run\s*2|run_2/.test(token)) return 'run_2';
  if (token.includes('run')) return 'run';
  return null;
}

function matchingLeg(contest: CanonicalContestCourse, row: MappingRow, index: number) {
  const token = legToken(row.leg_name);
  return contest.legs.find((leg) => leg.type === token)
    ?? contest.legs.find((leg) => leg.order === Number(row.leg_index))
    ?? contest.legs[index]
    ?? null;
}

/**
 * Applies only BERGMAN admin cutoff fields to an already validated immutable
 * canonical course. Split identity, timing points, order and distances remain
 * pinned to the active canonical build.
 */
export function applyBergmanCutoffMappingToContest(
  contest: CanonicalContestCourse,
  mapping: BergmanCutoffMapping | null | undefined,
): CanonicalContestCourse {
  if (!mapping || !Array.isArray(mapping.legs)) return contest;

  // Once a BERGMAN mapping exists it is the cutoff authority. Provider time
  // limits remain immutable evidence but cannot leak into spectator cutoffs.
  const cutoffs: Record<string, number> = {};
  const legCutoffs = new Map<CanonicalRaceLeg['type'], number | null>();
  mapping.legs.forEach((row, index) => {
    const leg = matchingLeg(contest, row, index);
    if (!leg) return;
    const seconds = cutoffSeconds(row);
    legCutoffs.set(leg.type, seconds);
    if (seconds === null) return;
    const cutoffType = text(row.cutoff_type ?? row.metadata?.cutoff_type).toLowerCase();
    if (cutoffType === 'overall') cutoffs.overall = seconds;
    else cutoffs[leg.type] = seconds;
  });

  for (const row of mapping.splits || []) {
    const seconds = cutoffSeconds(row);
    if (seconds === null) continue;
    const splitIdentity = text(row.split_uuid).toLowerCase();
    const timingPointIdentity = text(row.timing_point_id).toLowerCase();
    const split = contest.splits.find((candidate) => (
      Boolean(splitIdentity) && [candidate.key, candidate.providerSplitId].some((value) => text(value).toLowerCase() === splitIdentity)
    )) ?? contest.splits.find((candidate) => (
      Boolean(timingPointIdentity) && text(candidate.providerTimingPointId).toLowerCase() === timingPointIdentity
    ));
    if (split) cutoffs[split.key] = seconds;
  }

  return {
    ...contest,
    cutoffs,
    legs: contest.legs.map((leg) => (
      legCutoffs.has(leg.type) ? { ...leg, cutoffSeconds: legCutoffs.get(leg.type) ?? null } : leg
    )),
  };
}

export function applyBergmanCutoffMappingsToCourse(
  course: CanonicalCourseBundle,
  mappings: Record<string, BergmanCutoffMapping | null | undefined>,
): CanonicalCourseBundle {
  return {
    ...course,
    contests: course.contests.map((contest) => applyBergmanCutoffMappingToContest(
      contest,
      mappings[contest.providerContestUuid.toLowerCase()],
    )),
  };
}
