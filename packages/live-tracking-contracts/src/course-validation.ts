import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalContestCourse,
  type CanonicalCourseBundle,
  type CanonicalLegType,
  type CanonicalValidationIssue,
  type CanonicalValidationResult,
} from './contracts';

const REQUIRED_BOUNDARIES: Record<string, string[]> = {
  triathlon: ['swim_start', 'swim_finish', 'bike_start', 'bike_finish', 'run_start', 'run_finish'],
  aquathlon: ['swim_start', 'swim_finish', 'run_start', 'run_finish'],
  duathlon: ['run_1_start', 'run_1_finish', 'bike_start', 'bike_finish', 'run_2_start', 'run_2_finish'],
  swimathon: ['swim_start', 'swim_finish'],
  running: ['run_start', 'run_finish'],
};

function issue(
  severity: CanonicalValidationIssue['severity'],
  code: string,
  message: string,
  bundle: Pick<CanonicalCourseBundle, 'eventId'>,
  contest?: Pick<CanonicalContestCourse, 'providerContestUuid'>,
  path?: string,
  providerId?: string,
): CanonicalValidationIssue {
  return {
    severity,
    code,
    message,
    eventId: bundle.eventId,
    contestUuid: contest?.providerContestUuid,
    path,
    providerId,
  };
}

function pushIssue(target: CanonicalValidationIssue[], value: CanonicalValidationIssue): void {
  target.push(value);
}

function validateContest(
  bundle: CanonicalCourseBundle,
  contest: CanonicalContestCourse,
  errors: CanonicalValidationIssue[],
  warnings: CanonicalValidationIssue[],
  finishToleranceKm: number,
): void {
  if (!contest.providerContestUuid) {
    pushIssue(errors, issue('error', 'provider_contest_unmapped', 'Provider contest UUID is required.', bundle, contest, 'providerContestUuid'));
  }
  if (!contest.bergmanTicketId) {
    pushIssue(errors, issue('error', 'bergman_ticket_unmapped', 'BERGMAN ticket mapping is required.', bundle, contest, 'bergmanTicketId'));
  }

  const splitKeys = new Set<string>();
  const splitOrders = new Set<number>();
  let previousOrder = Number.NEGATIVE_INFINITY;
  let previousDistance = Number.NEGATIVE_INFINITY;
  const timingPointUsage = new Map<string, typeof contest.splits>();
  const timingPointPassUsage = new Map<string, typeof contest.splits>();
  const providerSplitIdentityUsage = new Map<string, typeof contest.splits>();

  for (const split of contest.splits) {
    // Older canonical fixtures predate providerSplitUuid; an explicit null is
    // the new signal that identity intentionally falls back to split index.
    const providerSplitUuid = split.providerSplitUuid === undefined
      ? split.providerSplitId || null
      : split.providerSplitUuid;
    if (contest.providerEventUuid) {
      const providerIdentityToken = providerSplitUuid || `split-index:${split.providerSplitIndex ?? split.order}`;
      const expectedIdentityKey = [bundle.eventId, contest.providerEventUuid, contest.providerContestUuid, providerIdentityToken]
        .map((value) => String(value || '').trim().toLowerCase())
        .join(':');
      if (
        split.bergmanEventId !== bundle.eventId
        || split.providerEventUuid !== contest.providerEventUuid
        || split.contestUuid !== contest.providerContestUuid
        || (providerSplitUuid ? (split.splitUuid ?? split.providerSplitId) !== providerSplitUuid : split.splitUuid !== undefined)
        || split.canonicalIdentityKey !== expectedIdentityKey
      ) {
        pushIssue(errors, issue(
          'error',
          'split_scope_identity_mismatch',
          `Split ${split.key} does not retain its Bergman event, provider event, contest, and provider split identity.`,
          bundle,
          contest,
          `splits.${split.key}.canonicalIdentityKey`,
          split.providerSplitId,
        ));
      }
    }
    if (splitKeys.has(split.key)) {
      pushIssue(errors, issue('error', 'duplicate_split_key', `Duplicate split key: ${split.key}.`, bundle, contest, `splits.${split.key}`));
    }
    splitKeys.add(split.key);

    // A split UUID is provider-owned only within its provider event + contest
    // scope. A repeated physical timing point/pass is merely routing metadata;
    // it must never become the canonical split identity.
    const providerSplitIdentity = [
      contest.providerEventUuid,
      contest.providerContestUuid,
      providerSplitUuid || `split-index:${split.providerSplitIndex ?? split.order}`,
    ].map((value) => String(value || '').trim().toLowerCase()).join(':');
    if (providerSplitUuid || Number.isFinite(split.providerSplitIndex)) {
      const rows = providerSplitIdentityUsage.get(providerSplitIdentity) ?? [];
      rows.push(split);
      providerSplitIdentityUsage.set(providerSplitIdentity, rows);
    }

    if (splitOrders.has(split.order)) {
      pushIssue(errors, issue('error', 'duplicate_split_order', `Duplicate split order: ${split.order}.`, bundle, contest, `splits.${split.key}.order`));
    }
    splitOrders.add(split.order);

    if (split.order <= previousOrder) {
      pushIssue(errors, issue('error', 'split_order_not_increasing', `Split order is not increasing at ${split.key}.`, bundle, contest, `splits.${split.key}.order`));
    }
    previousOrder = split.order;

    if (split.distanceInLegKm < 0) {
      pushIssue(errors, issue('error', 'negative_leg_distance', `Split ${split.key} has a negative distance in leg.`, bundle, contest, `splits.${split.key}.distanceInLegKm`));
    }
    if (split.cumulativeDistanceKm < previousDistance) {
      pushIssue(errors, issue('error', 'cumulative_distance_decreased', `Cumulative distance decreases at ${split.key}.`, bundle, contest, `splits.${split.key}.cumulativeDistanceKm`));
    }
    previousDistance = split.cumulativeDistanceKm;

    if (split.required && !providerSplitUuid && !Number.isFinite(split.providerSplitIndex)) {
      pushIssue(errors, issue('error', 'required_provider_split_missing', `Required split ${split.key} has neither a provider split UUID nor provider split index.`, bundle, contest, `splits.${split.key}.providerSplitId`));
    }

    if (!split.providerTimingPointId) {
      pushIssue(warnings, issue('warning', 'timing_point_unresolved_nonfatal', `Split ${split.key} has no resolved timing point; the provider split remains available.`, bundle, contest, `splits.${split.key}.providerTimingPointId`, split.providerSplitId));
    }

    if (split.providerTimingPointId) {
      const rows = timingPointUsage.get(split.providerTimingPointId) ?? [];
      rows.push(split);
      timingPointUsage.set(split.providerTimingPointId, rows);
      if (split.passNumber !== null) {
        const passKey = `${split.providerTimingPointId}:${split.passNumber}`;
        const passRows = timingPointPassUsage.get(passKey) ?? [];
        passRows.push(split);
        timingPointPassUsage.set(passKey, passRows);
      }
    }
  }

  const requiredBoundaries = REQUIRED_BOUNDARIES[contest.raceType] ?? [];
  for (const splitKey of requiredBoundaries) {
    if (!splitKeys.has(splitKey)) {
      pushIssue(errors, issue('error', 'required_boundary_missing', `Required boundary split ${splitKey} is missing.`, bundle, contest, `splits.${splitKey}`));
    }
  }

  const legOrders = new Set<number>();
  let priorLegOrder = Number.NEGATIVE_INFINITY;
  for (const leg of contest.legs) {
    if ((['t1', 't2', 'transition'] as string[]).includes(leg.type as string)) {
      pushIssue(errors, issue('error', 'transition_stored_as_leg', `Transition ${String(leg.type)} must not be a source leg.`, bundle, contest, `legs.${leg.key}.type`));
    }
    if (legOrders.has(leg.order) || leg.order <= priorLegOrder) {
      pushIssue(errors, issue('error', 'invalid_leg_order', `Leg order is invalid at ${leg.key}.`, bundle, contest, `legs.${leg.key}.order`));
    }
    legOrders.add(leg.order);
    priorLegOrder = leg.order;
    if (!splitKeys.has(leg.startSplitKey) || !splitKeys.has(leg.finishSplitKey)) {
      pushIssue(errors, issue('error', 'leg_boundary_missing', `Leg ${leg.key} references a missing boundary split.`, bundle, contest, `legs.${leg.key}`));
    }
    const expectedPrefix = `${leg.type}_`;
    const start = contest.splits.find((split) => split.key === leg.startSplitKey) ?? null;
    const finish = contest.splits.find((split) => split.key === leg.finishSplitKey) ?? null;
    if (
      !start
      || start.legType !== leg.type
      || start.isLegStart !== true
      || start.canonicalCode !== `${expectedPrefix}start`
    ) {
      pushIssue(errors, issue('error', 'leg_start_boundary_inconsistent', `Leg ${leg.key} start boundary must resolve to ${expectedPrefix}start.`, bundle, contest, `legs.${leg.key}.startSplitKey`));
    }
    if (
      !finish
      || finish.legType !== leg.type
      || finish.isLegFinish !== true
      || finish.canonicalCode !== `${expectedPrefix}finish`
    ) {
      pushIssue(errors, issue('error', 'leg_finish_boundary_inconsistent', `Leg ${leg.key} finish boundary must resolve to ${expectedPrefix}finish.`, bundle, contest, `legs.${leg.key}.finishSplitKey`));
    }
    if (leg.gpxUrls.length === 0) {
      pushIssue(warnings, issue('warning', 'gpx_missing', `No GPX URL is configured for ${leg.displayName}.`, bundle, contest, `legs.${leg.key}.gpxUrls`));
    }
  }

  let previousTransitionOrder = Number.NEGATIVE_INFINITY;
  for (const transition of contest.transitions) {
    if (!splitKeys.has(transition.startSplitKey) || !splitKeys.has(transition.finishSplitKey)) {
      pushIssue(errors, issue('error', 'transition_boundary_missing', `${transition.displayName} references a missing boundary split.`, bundle, contest, `transitions.${transition.key}`));
    }
    if (transition.order <= previousTransitionOrder) {
      pushIssue(errors, issue('error', 'invalid_transition_order', `Transition order is invalid at ${transition.displayName}.`, bundle, contest, `transitions.${transition.key}.order`));
    }
    previousTransitionOrder = transition.order;
  }

  for (const [timingPointId, splits] of timingPointUsage) {
    if (splits.length < 2) continue;
    const ambiguous = splits.filter((split) => split.readSelectionRule === null && split.passNumber === null);
    if (ambiguous.length > 0) {
      pushIssue(warnings, issue('warning', 'shared_timing_point_unresolved_nonfatal', `Timing point ${timingPointId} is shared; split identity remains authoritative until a read rule is configured.`, bundle, contest, undefined, timingPointId));
      continue;
    }
    const missingPass = splits.filter((split) => split.readSelectionRule === 'pass_number' && split.passNumber === null);
    if (missingPass.length > 0) {
      pushIssue(warnings, issue('warning', 'repeated_timing_point_missing_pass', `Timing point ${timingPointId} has no pass number; the split is preserved and timing resolution remains pending.`, bundle, contest, undefined, timingPointId));
    }
  }

  for (const [timingPointPassKey, splits] of timingPointPassUsage) {
    if (splits.length < 2) continue;
    console.info('[TIMING POINT REUSE]', {
      providerEventUuid: contest.providerEventUuid || null,
      providerContestUuid: contest.providerContestUuid,
      timingPointPass: timingPointPassKey,
      splits: splits.map((split) => ({
        providerSplitUuid: split.providerSplitUuid,
        splitKey: split.key,
        splitIndex: split.providerSplitIndex ?? split.order,
        name: split.providerName || split.displayName,
        leg: split.providerLegName || split.legType,
        passMode: split.providerPassMode || split.readSelectionRule,
        passNumber: split.passNumber,
        distanceFromStart: split.providerDistanceFromStart,
        splitLength: split.providerSplitLength,
        timeLimitMin: split.timeLimitMinRaw,
        timeLimitMax: split.timeLimitMaxRaw,
      })),
    });
    pushIssue(warnings, issue(
      'warning',
      'shared_timing_point_pass_reuse',
      `Provider event ${contest.providerEventUuid || 'unknown'} contest ${contest.providerContestUuid} reuses timing point/pass ${timingPointPassKey}; canonical provider split identity and ordered reads remain authoritative.`,
      bundle,
      contest,
      'splits',
      timingPointPassKey,
    ));
  }

  for (const [providerSplitIdentity, splits] of providerSplitIdentityUsage) {
    if (splits.length < 2) continue;
    const definitions = new Set(splits.map((split) => JSON.stringify({
      key: split.key,
      order: split.order,
      displayName: split.displayName,
      legType: split.legType,
      providerTimingPointId: split.providerTimingPointId,
      passNumber: split.passNumber,
      required: split.required,
    })));
    if (definitions.size < 2) continue;
    pushIssue(errors, issue(
      'error',
      'duplicate_provider_split_identity_conflict',
      `Provider split identity ${providerSplitIdentity} has incompatible canonical definitions.`,
      bundle,
      contest,
      'splits',
      splits[0]?.providerSplitId,
    ));
  }

  const finish = [...contest.splits].reverse().find((split) => split.isFinish) ?? contest.splits.at(-1);
  if (finish && contest.configuredRaceDistanceKm > 0) {
    const delta = Math.abs(finish.cumulativeDistanceKm - contest.configuredRaceDistanceKm);
    if (delta > finishToleranceKm) {
      pushIssue(errors, issue('error', 'finish_distance_mismatch', `Finish distance ${finish.cumulativeDistanceKm} km does not match configured distance ${contest.configuredRaceDistanceKm} km.`, bundle, contest, `splits.${finish.key}.cumulativeDistanceKm`));
    }
  }

  const optionalCheckpoints = contest.splits.filter((split) => !split.required && !split.providerSplitId);
  for (const split of optionalCheckpoints) {
    pushIssue(warnings, issue('warning', 'optional_checkpoint_missing', `Optional checkpoint ${split.displayName} is not mapped.`, bundle, contest, `splits.${split.key}`));
  }
}

export function validateCanonicalCourse(
  bundle: CanonicalCourseBundle,
  options: { finishToleranceKm?: number } = {},
): CanonicalValidationResult {
  const errors: CanonicalValidationIssue[] = [];
  const warnings: CanonicalValidationIssue[] = [];
  const finishToleranceKm = options.finishToleranceKm ?? 0.1;

  for (const contest of bundle.contests) {
    validateContest(bundle, contest, errors, warnings, finishToleranceKm);
  }

  if (bundle.contests.length === 0) {
    errors.push(issue('error', 'no_mapped_contests', 'No mapped contests were available for canonical course generation.', bundle));
  }

  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: bundle.eventId,
    buildVersion: bundle.buildVersion,
    updatedAt: bundle.updatedAt,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function expectedLegTypes(raceType: CanonicalContestCourse['raceType']): CanonicalLegType[] {
  if (raceType === 'triathlon') return ['swim', 'bike', 'run'];
  if (raceType === 'aquathlon') return ['swim', 'run'];
  if (raceType === 'duathlon') return ['run_1', 'bike', 'run_2'];
  if (raceType === 'swimathon') return ['swim'];
  if (raceType === 'running') return ['run'];
  return ['swim', 'bike', 'run'];
}
