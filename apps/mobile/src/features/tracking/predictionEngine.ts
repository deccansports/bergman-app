export type PredictionRaceState =
  "NOT_STARTED" | "ACTIVE" | "FINISHED" | "DNF" | "DNS" | "DNQ" | "DSQ";

export type PredictionCoursePoint = {
  key: string;
  matchKeys: string[];
  label: string;
  sequence: number;
  sport?: string;
  cumulativeDistanceKm?: number;
};

export type AcceptedPredictionSplit = {
  keys: string[];
  sequence?: number;
  acceptedTimestamp?: number;
  elapsedSeconds?: number;
  cumulativeDistanceKm?: number;
};

export type PredictedCoursePoint = PredictionCoursePoint & {
  remainingDistanceKm: number;
  expectedTimestamp?: number;
  expectedElapsedSeconds?: number;
};

export type CanonicalPredictionState = {
  latestAcceptedSplitKey?: string;
  latestAcceptedSequence?: number;
  latestAcceptedTimestamp?: number;
  latestAcceptedElapsedSeconds?: number;
  latestCumulativeDistanceKm: number;
  totalDistanceKm: number;
  remainingDistanceKm: number;
  raceState: PredictionRaceState;
  nextCheckpoint?: PredictedCoursePoint;
  remainingCheckpoints: PredictedCoursePoint[];
  projectedFinishTimestamp?: number;
  projectedFinishElapsedSeconds?: number;
  predictionSuppressed: boolean;
  suppressionReason?:
    "finished" | "terminal" | "no_course" | "not_started" | "terminal_status";
};

export type PredictionPaceModel = {
  secondsPerKmBySport?: Partial<Record<"swim" | "bike" | "run", number>>;
  transitionSeconds?: number;
};

type PredictionInput = {
  raceState: PredictionRaceState;
  course: PredictionCoursePoint[];
  acceptedSplits: AcceptedPredictionSplit[];
  officialDistanceKm?: number;
  totalDistanceKm?: number;
  paceModel?: PredictionPaceModel;
};

function key(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return value != null && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function sportFor(
  point: PredictionCoursePoint,
): "swim" | "bike" | "run" | "transition" {
  const value = key(`${point.sport ?? ""} ${point.label}`);
  if (value.includes("swim")) return "swim";
  if (value.includes("bike") || value.includes("cycle")) return "bike";
  if (value.includes("run")) return "run";
  return "transition";
}

function isTerminalFinishPoint(
  point: PredictionCoursePoint,
  index: number,
  course: PredictionCoursePoint[],
): boolean {
  if (index === course.length - 1) return true;
  const identity = key(`${point.key} ${point.label}`);
  return (
    identity === "finish" ||
    identity.includes("racefinish") ||
    identity.includes("runfinish")
  );
}

function secondsForSegment(
  previousDistanceKm: number,
  point: PredictionCoursePoint,
  paceModel: PredictionPaceModel,
): number {
  const nextDistanceKm = Math.max(
    previousDistanceKm,
    finiteNonNegative(point.cumulativeDistanceKm) ?? previousDistanceKm,
  );
  const distanceKm = nextDistanceKm - previousDistanceKm;
  if (distanceKm <= 0) return paceModel.transitionSeconds ?? 120;
  const sport = sportFor(point);
  const fallback = sport === "swim" ? 1_800 : sport === "bike" ? 180 : 420;
  const pace =
    sport === "transition"
      ? undefined
      : finiteNonNegative(paceModel.secondsPerKmBySport?.[sport]);
  return distanceKm * (pace && pace > 0 ? pace : fallback);
}

/**
 * Derives prediction strictly from accepted canonical progression and the
 * contest's ordered canonical course. Provider payload order is irrelevant.
 */
export function buildCanonicalPredictionState(
  input: PredictionInput,
): CanonicalPredictionState {
  const course = [...input.course]
    .filter((point) => point.key && Number.isFinite(point.sequence))
    .sort((left, right) => left.sequence - right.sequence);
  const totalDistanceKm = Math.max(
    finiteNonNegative(input.totalDistanceKm) ?? 0,
    ...course.map(
      (point) => finiteNonNegative(point.cumulativeDistanceKm) ?? 0,
    ),
  );
  if (course.length === 0) {
    const finished = input.raceState === "FINISHED";
    const terminalStatus = ["DNF", "DNS", "DNQ", "DSQ"].includes(
      input.raceState,
    );
    return {
      latestCumulativeDistanceKm:
        finiteNonNegative(input.officialDistanceKm) ?? 0,
      totalDistanceKm,
      remainingDistanceKm: finished ? 0 : totalDistanceKm,
      raceState: input.raceState,
      remainingCheckpoints: [],
      predictionSuppressed: true,
      suppressionReason: finished
        ? "finished"
        : terminalStatus
          ? "terminal_status"
          : "no_course",
    };
  }

  const acceptedByCourseIndex = new Map<number, AcceptedPredictionSplit>();
  for (const accepted of input.acceptedSplits) {
    const acceptedKeys = new Set(accepted.keys.map(key).filter(Boolean));
    // Resolve the canonical pass identity before broad provider/mat aliases.
    // Multi-pass courses can legitimately reuse one physical timing mat, so a
    // shared location key must not make Pass 2 look like the already accepted
    // Pass 1 checkpoint.
    let courseIndex = course.findIndex((point) =>
      acceptedKeys.has(key(point.key)),
    );
    if (courseIndex < 0 && accepted.sequence != null) {
      courseIndex = course.findIndex(
        (point) => point.sequence === accepted.sequence,
      );
    }
    if (courseIndex < 0) {
      courseIndex = course.findIndex((point) =>
        point.matchKeys.some((candidate) => acceptedKeys.has(key(candidate))),
      );
    }
    if (courseIndex < 0) continue;
    const current = acceptedByCourseIndex.get(courseIndex);
    if (
      !current ||
      (finiteNonNegative(accepted.acceptedTimestamp) ?? 0) >=
        (finiteNonNegative(current.acceptedTimestamp) ?? 0)
    ) {
      acceptedByCourseIndex.set(courseIndex, accepted);
    }
  }

  // A configured zero-distance first checkpoint (for example `swimstart`) is
  // course metadata, not timing evidence. Until an accepted canonical read is
  // matched, pre-race athletes must not receive a next-split or finish ETA.
  if (input.raceState === "NOT_STARTED" && acceptedByCourseIndex.size === 0) {
    return {
      latestCumulativeDistanceKm: 0,
      totalDistanceKm,
      remainingDistanceKm: totalDistanceKm,
      raceState: "NOT_STARTED",
      remainingCheckpoints: [],
      predictionSuppressed: true,
      suppressionReason: "not_started",
    };
  }

  let latestCourseIndex = Math.max(-1, ...acceptedByCourseIndex.keys());
  const officialDistanceKm = finiteNonNegative(input.officialDistanceKm);
  // Accepted canonical split identity is the primary cursor. Distance is only
  // a recovery hint when none of the accepted keys can be matched; otherwise
  // equal-distance transition points could falsely advance progression.
  if (officialDistanceKm != null && latestCourseIndex < 0) {
    course.forEach((point, index) => {
      const distanceKm = finiteNonNegative(point.cumulativeDistanceKm);
      if (distanceKm != null && distanceKm <= officialDistanceKm + 0.000_001) {
        latestCourseIndex = Math.max(latestCourseIndex, index);
      }
    });
  }

  const latestPoint =
    latestCourseIndex >= 0 ? course[latestCourseIndex] : undefined;
  const latestAccepted =
    latestCourseIndex >= 0
      ? acceptedByCourseIndex.get(latestCourseIndex)
      : undefined;
  const distanceFallback =
    latestCourseIndex < 0 ? (officialDistanceKm ?? 0) : 0;
  const latestCumulativeDistanceKm = Math.min(
    totalDistanceKm,
    Math.max(
      0,
      distanceFallback,
      finiteNonNegative(latestAccepted?.cumulativeDistanceKm) ?? 0,
      finiteNonNegative(latestPoint?.cumulativeDistanceKm) ?? 0,
    ),
  );
  const terminalAccepted = Boolean(
    latestPoint &&
    isTerminalFinishPoint(latestPoint, latestCourseIndex, course),
  );
  const terminalStatus = ["DNF", "DNS", "DNQ", "DSQ"].includes(input.raceState);
  const finished = input.raceState === "FINISHED" || terminalAccepted;
  if (finished || terminalStatus) {
    return {
      latestAcceptedSplitKey: latestPoint?.key,
      latestAcceptedSequence: latestPoint?.sequence,
      latestAcceptedTimestamp: latestAccepted?.acceptedTimestamp,
      latestAcceptedElapsedSeconds: latestAccepted?.elapsedSeconds,
      latestCumulativeDistanceKm: finished
        ? totalDistanceKm
        : latestCumulativeDistanceKm,
      totalDistanceKm,
      remainingDistanceKm: finished
        ? 0
        : Math.max(0, totalDistanceKm - latestCumulativeDistanceKm),
      raceState: finished ? "FINISHED" : input.raceState,
      remainingCheckpoints: [],
      predictionSuppressed: true,
      suppressionReason: finished
        ? input.raceState === "FINISHED"
          ? "finished"
          : "terminal"
        : "terminal_status",
    };
  }

  const remainingCourse = course.filter(
    (_point, index) =>
      index > latestCourseIndex && !acceptedByCourseIndex.has(index),
  );
  let predictedTimestamp = latestAccepted?.acceptedTimestamp;
  let predictedElapsedSeconds = latestAccepted?.elapsedSeconds;
  let previousDistanceKm = latestCumulativeDistanceKm;
  const remainingCheckpoints = remainingCourse.map((point) => {
    const segmentSeconds = secondsForSegment(
      previousDistanceKm,
      point,
      input.paceModel ?? {},
    );
    if (predictedTimestamp != null)
      predictedTimestamp += segmentSeconds * 1_000;
    if (predictedElapsedSeconds != null)
      predictedElapsedSeconds += segmentSeconds;
    const pointDistanceKm = Math.max(
      previousDistanceKm,
      finiteNonNegative(point.cumulativeDistanceKm) ?? previousDistanceKm,
    );
    const prediction: PredictedCoursePoint = {
      ...point,
      remainingDistanceKm: Math.max(
        0,
        pointDistanceKm - latestCumulativeDistanceKm,
      ),
      expectedTimestamp: predictedTimestamp,
      expectedElapsedSeconds: predictedElapsedSeconds,
    };
    previousDistanceKm = pointDistanceKm;
    return prediction;
  });

  return {
    latestAcceptedSplitKey: latestPoint?.key,
    latestAcceptedSequence: latestPoint?.sequence,
    latestAcceptedTimestamp: latestAccepted?.acceptedTimestamp,
    latestAcceptedElapsedSeconds: latestAccepted?.elapsedSeconds,
    latestCumulativeDistanceKm,
    totalDistanceKm,
    remainingDistanceKm: Math.max(
      0,
      totalDistanceKm - latestCumulativeDistanceKm,
    ),
    raceState:
      latestCourseIndex >= 0 || input.raceState === "ACTIVE"
        ? "ACTIVE"
        : input.raceState,
    nextCheckpoint: remainingCheckpoints[0],
    remainingCheckpoints,
    projectedFinishTimestamp: remainingCheckpoints.at(-1)?.expectedTimestamp,
    projectedFinishElapsedSeconds:
      remainingCheckpoints.at(-1)?.expectedElapsedSeconds,
    predictionSuppressed: remainingCheckpoints.length === 0,
    suppressionReason:
      remainingCheckpoints.length === 0 ? "terminal" : undefined,
  };
}
