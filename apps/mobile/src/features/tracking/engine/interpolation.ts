/**
 * Pure position-interpolation math for the live-tracking engine.
 *
 * Live mode advances the athlete from the last official timing read toward the
 * next timing point using average pace (so the marker moves continuously
 * between mats, then holds at the next mat until a fresh read re-anchors it).
 *
 * Replay mode interpolates distance across all recorded split keyframes for a
 * given replay clock. Both return a course distance (km), which callers convert
 * to a fraction and then to a coordinate via `geo.positionAtFraction`.
 */

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** Live interpolation anchor: the last official read + pace + next mat. */
export type TrackSeed = {
  anchorKm: number;
  anchorTimeSec: number;
  nextKm: number;
  paceSecPerKm: number;
  totalKm: number;
};

/** A recorded split used as a replay keyframe. */
export type TrackKeyframe = { distanceKm: number; timeSec: number };

export type ConservativePaceResult = {
  paceSecPerKm: number;
  source:
    | "recent_weighted"
    | "recent_section"
    | "elapsed_section"
    | "canonical_model"
    | "transition_hold"
    | "no_safe_pace";
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

/** Resolve a conservative pace from accepted, same-discipline sections. */
export function conservativePaceSecPerKm(input: {
  sectionPaces: number[];
  canonicalPaceSecPerKm?: number;
  transitionHold?: boolean;
}): ConservativePaceResult {
  if (input.transitionHold) {
    return { paceSecPerKm: 0, source: "transition_hold", confidence: "LOW" };
  }
  const recent = input.sectionPaces
    .filter((pace) => Number.isFinite(pace) && pace > 0)
    .slice(-3);
  if (recent.length >= 3) {
    const weights = recent.map((_, index) => index + 1);
    return {
      paceSecPerKm:
        recent.reduce((sum, pace, index) => sum + pace * weights[index], 0) /
        weights.reduce((sum, weight) => sum + weight, 0),
      source: "recent_weighted",
      confidence: "HIGH",
    };
  }
  if (recent.length >= 2) {
    return {
      paceSecPerKm: recent.at(-1) ?? 0,
      source: "recent_section",
      confidence: "MEDIUM",
    };
  }
  if (recent.length === 1) {
    return {
      paceSecPerKm: recent[0],
      source: "elapsed_section",
      confidence: "MEDIUM",
    };
  }
  if (
    input.canonicalPaceSecPerKm != null &&
    Number.isFinite(input.canonicalPaceSecPerKm) &&
    input.canonicalPaceSecPerKm > 0
  ) {
    return {
      paceSecPerKm: input.canonicalPaceSecPerKm,
      source: "canonical_model",
      confidence: "LOW",
    };
  }
  return { paceSecPerKm: 0, source: "no_safe_pace", confidence: "LOW" };
}

export type CheckpointBoundedPositionState =
  | "NOT_STARTED"
  | "INTERPOLATING"
  | "AWAITING_CHECKPOINT_CONFIRMATION"
  | "FINISHED";

export type CheckpointBoundedPosition = {
  distanceKm: number;
  interpolatedKm: number;
  predictedArrivalElapsedSec?: number;
  predictedArrivalAt?: number;
  waitingSince?: number;
  waitingSeconds: number;
  state: CheckpointBoundedPositionState;
};

/**
 * Projects only within the currently confirmed canonical segment. Reaching a
 * predicted checkpoint never changes split identity, leg, rank, or finish
 * state; a new accepted canonical split must replace the seed to advance.
 */
export function checkpointBoundedPosition(input: {
  seed?: TrackSeed;
  currentRaceElapsedSec?: number;
  raceState: "NOT_STARTED" | "ACTIVE" | "FINISHED";
  latestOfficialAt?: number;
  expectedArrivalElapsedSec?: number;
  expectedArrivalAt?: number;
}): CheckpointBoundedPosition {
  const seed = input.seed;
  if (input.raceState === "NOT_STARTED" || !seed) {
    return {
      distanceKm: 0,
      interpolatedKm: 0,
      waitingSeconds: 0,
      state: "NOT_STARTED",
    };
  }
  if (input.raceState === "FINISHED") {
    return {
      distanceKm: Math.max(0, seed.totalKm),
      interpolatedKm: Math.max(0, seed.totalKm),
      waitingSeconds: 0,
      state: "FINISHED",
    };
  }
  const currentElapsed = Math.max(
    seed.anchorTimeSec,
    input.currentRaceElapsedSec ?? seed.anchorTimeSec,
  );
  const checkpointDistance = clamp(
    Number.isFinite(seed.nextKm) ? seed.nextKm : seed.totalKm,
    seed.anchorKm,
    seed.totalKm || seed.nextKm || seed.anchorKm,
  );
  const segmentSeconds =
    seed.paceSecPerKm > 0
      ? Math.max(0, checkpointDistance - seed.anchorKm) * seed.paceSecPerKm
      : undefined;
  const predictedArrivalElapsedSec =
    input.expectedArrivalElapsedSec != null &&
    Number.isFinite(input.expectedArrivalElapsedSec)
      ? Math.max(seed.anchorTimeSec, input.expectedArrivalElapsedSec)
      : segmentSeconds == null
        ? undefined
        : seed.anchorTimeSec + segmentSeconds;
  const elapsedSinceAnchor = currentElapsed - seed.anchorTimeSec;
  const interpolatedKm = estimatedDistanceKm(seed, elapsedSinceAnchor);
  const awaiting =
    predictedArrivalElapsedSec != null &&
    currentElapsed >= predictedArrivalElapsedSec;
  const waitingSeconds = awaiting
    ? Math.max(0, Math.floor(currentElapsed - predictedArrivalElapsedSec))
    : 0;
  const predictedArrivalAt =
    input.expectedArrivalAt != null && Number.isFinite(input.expectedArrivalAt)
      ? input.expectedArrivalAt
      : input.latestOfficialAt != null && predictedArrivalElapsedSec != null
        ? input.latestOfficialAt +
          (predictedArrivalElapsedSec - seed.anchorTimeSec) * 1_000
        : undefined;
  return {
    distanceKm: awaiting ? checkpointDistance : interpolatedKm,
    interpolatedKm: awaiting ? checkpointDistance : interpolatedKm,
    predictedArrivalElapsedSec,
    predictedArrivalAt,
    waitingSince: awaiting ? predictedArrivalAt : undefined,
    waitingSeconds,
    state: awaiting ? "AWAITING_CHECKPOINT_CONFIRMATION" : "INTERPOLATING",
  };
}

/**
 * Estimated course distance (km) `elapsedSinceAnchorSec` after the last read.
 * Capped at the next timing point so we never "teleport" past an unconfirmed
 * mat; a new read (new seed) releases the marker toward the following point.
 */
export function estimatedDistanceKm(
  seed: TrackSeed,
  elapsedSinceAnchorSec: number,
): number {
  if (!(seed.paceSecPerKm > 0))
    return clamp(seed.anchorKm, 0, seed.totalKm || seed.anchorKm);
  const projected =
    seed.anchorKm + Math.max(0, elapsedSinceAnchorSec) / seed.paceSecPerKm;
  // Equal-distance boundaries are real transition checkpoints (Swim Finish →
  // Bike Start, Bike Finish → Run Start). Hold at that mat until the next
  // official split changes the seed instead of moving into the next leg.
  const hasConfiguredCheckpoint =
    Number.isFinite(seed.nextKm) && seed.nextKm >= seed.anchorKm;
  const ceiling = hasConfiguredCheckpoint
    ? seed.nextKm
    : seed.totalKm || projected;
  return clamp(Math.min(projected, ceiling), 0, seed.totalKm || ceiling);
}

/** Piecewise-linear distance at `clockSec`, interpolating between keyframes. */
export function distanceAtRaceTime(
  keyframes: TrackKeyframe[],
  clockSec: number,
  totalKm: number,
): number {
  if (keyframes.length === 0) return 0;
  const sorted = [...keyframes].sort((a, b) => a.timeSec - b.timeSec);
  if (clockSec <= sorted[0].timeSec) {
    const t =
      sorted[0].timeSec > 0 ? clamp(clockSec / sorted[0].timeSec, 0, 1) : 1;
    return clamp(sorted[0].distanceKm * t, 0, totalKm || sorted[0].distanceKm);
  }
  const last = sorted[sorted.length - 1];
  if (clockSec >= last.timeSec)
    return clamp(last.distanceKm, 0, totalKm || last.distanceKm);

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (clockSec <= curr.timeSec) {
      const span = curr.timeSec - prev.timeSec || 1;
      const t = clamp((clockSec - prev.timeSec) / span, 0, 1);
      const km = prev.distanceKm + (curr.distanceKm - prev.distanceKm) * t;
      return clamp(km, 0, totalKm || km);
    }
  }
  return clamp(last.distanceKm, 0, totalKm || last.distanceKm);
}

/** Convert a course distance to a normalized 0..1 fraction of the course. */
export function distanceToFraction(
  distanceKm: number,
  totalKm: number,
): number {
  if (!(totalKm > 0)) return 0;
  return clamp(distanceKm / totalKm, 0, 1);
}

/** Total recorded duration (last keyframe time), for the replay scrubber range. */
export function replayDurationSec(keyframes: TrackKeyframe[]): number {
  return keyframes.reduce((max, k) => Math.max(max, k.timeSec), 0);
}
