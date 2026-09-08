import type {
  CanonicalAthleteSnapshot,
  CanonicalResolvedAthleteState,
  CanonicalResolvedSplitState,
  CanonicalSplitRow,
} from "./contracts";

export const MOBILE_LIVE_PARTICIPANT_SCHEMA_VERSION = 1 as const;

export type MobileLiveVisibility = "PUBLIC" | "ANONYMOUS" | "PRIVATE";

export interface MobileLiveParticipantSplit {
  splitKey: string;
  name: string;
  legType: string | null;
  order: number | null;
  readAt: string | null;
  timeOfDay: string | null;
  elapsedSeconds: number | null;
  overallElapsedSeconds: number | null;
  legElapsedSeconds: number | null;
  sectionElapsedSeconds: number | null;
  distanceKm: number | null;
  legDistanceKm: number | null;
  status: string;
  paceSecondsPerKm: number | null;
  paceSecondsPer100m: number | null;
  speedKmh: number | null;
  overallRank: number | null;
  genderRank: number | null;
  categoryRank: number | null;
}

export interface MobileLiveParticipant {
  schemaVersion: typeof MOBILE_LIVE_PARTICIPANT_SCHEMA_VERSION;
  eventId: string;
  providerEventUuid: string;
  participantUuid: string;
  providerParticipantUuid: string;
  contestUuid: string;
  providerContestUuid: string;
  bib: string;
  /** PUBLIC keeps the public display name; ANONYMOUS is always redacted. */
  displayName: string;
  /** Immutable canonical age-group label; avoids loading the participant index. */
  ageGroup: string | null;
  visibility: MobileLiveVisibility;
  status: string;
  eventTimezone: string;
  /** Server response anchor. Readers advance from this rather than trusting device wall time. */
  serverNow: string | null;
  gunStartAt: string | null;
  chipStartAt: string | null;
  waveStartAt: string | null;
  acceptedStartAt: string | null;
  officialStartAt: string | null;
  finishAt: string | null;
  currentLeg: string | null;
  currentSectionKey: string | null;
  currentSplitKey: string | null;
  nextSplitKey: string | null;
  splits: MobileLiveParticipantSplit[];
  progress: {
    officialDistanceKm: number;
    estimatedDistanceKm: number;
    totalDistanceKm: number;
    distanceRemainingKm: number;
    officialProgressRatio: number;
    estimatedProgressRatio: number;
    nextSplitDistanceKm: number | null;
    etaNextSplit: string | null;
    predictedPaceSecondsPerKm?: number | null;
    predictedSpeedKmh?: number | null;
    estimatedFinishTime?: string | null;
    predictionSource?: string | null;
    predictionConfidence?: string | null;
  };
  rank: {
    overall: number | null;
    gender: number | null;
    ageGroup: number | null;
    club: number | null;
  };
  timing: {
    mode: string | null;
    hasStarted: boolean;
    liveOverallElapsedMs: number | null;
    officialRaceElapsedMs: number | null;
    gunElapsedMs: number | null;
    chipElapsedMs: number | null;
    waveElapsedMs: number | null;
    currentLegElapsedMs: number | null;
    currentSectionElapsedMs: number | null;
    finalElapsedMs: number | null;
    finalSplitAccepted: boolean;
  };
  cutoff: {
    applicable: true;
    checkpointKey: string;
    checkpointLabel: string;
    basis: "GUN" | "CHIP" | "WAVE";
    cutoffSeconds: number;
    deadlineAt: string;
    remainingSeconds: number;
    state: "UPCOMING" | "SAFE" | "AT_RISK" | "MISSED" | "CONFIRMED_CUTOFF";
    resolvedAt: string | null;
    failureReason: string | null;
  } | null;
  location: {
    segment: string;
    latitude: number | null;
    longitude: number | null;
    courseDistanceKm: number | null;
    legDistanceKm: number | null;
    recordedAt: string | null;
    source: string;
    estimated: boolean;
  } | null;
  timingVersion: number;
  /** Monotonic rank revision; consumers must invalidate rank-only changes. */
  leaderboardVersion: number;
  liveRevision: number;
  canonicalBuildVersion: string;
  updatedAt: string;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactSplit(
  resolved: CanonicalResolvedSplitState,
  calculated?: CanonicalSplitRow,
): MobileLiveParticipantSplit {
  return {
    splitKey: resolved.splitKey,
    name: resolved.name || calculated?.displayName || resolved.splitKey,
    legType: resolved.legType || calculated?.legType || null,
    order: numberOrNull(resolved.order),
    readAt: resolved.readAt,
    timeOfDay: resolved.timeOfDay ?? calculated?.timeOfDay ?? null,
    elapsedSeconds: numberOrNull(
      resolved.elapsedSeconds ?? calculated?.elapsedSeconds,
    ),
    overallElapsedSeconds: numberOrNull(
      resolved.overallElapsedSeconds ?? calculated?.overallElapsedSeconds,
    ),
    legElapsedSeconds: numberOrNull(
      resolved.legElapsedSeconds ?? calculated?.legElapsedSeconds,
    ),
    sectionElapsedSeconds: numberOrNull(
      resolved.sectionElapsedSeconds ?? calculated?.sectionElapsedSeconds,
    ),
    distanceKm: numberOrNull(
      resolved.cumulativeRaceDistanceKm ?? resolved.distanceKm,
    ),
    legDistanceKm: numberOrNull(resolved.legDistanceKm),
    status: resolved.status,
    paceSecondsPerKm: numberOrNull(calculated?.paceSecondsPerKm),
    paceSecondsPer100m: numberOrNull(calculated?.paceSecondsPer100m),
    speedKmh: numberOrNull(calculated?.speedKmh),
    overallRank: numberOrNull(
      resolved.overallRank ?? calculated?.ranking?.overallRank,
    ),
    genderRank: numberOrNull(
      resolved.genderRank ?? calculated?.ranking?.genderRank,
    ),
    categoryRank: numberOrNull(
      resolved.categoryRank ?? calculated?.ranking?.ageGroupRank,
    ),
  };
}

function selectedSplits(
  resolved: CanonicalResolvedAthleteState | undefined,
  rows: CanonicalSplitRow[],
): MobileLiveParticipantSplit[] {
  if (!resolved) return [];
  const calculated = new Map(rows.map((row) => [row.splitKey, row]));
  // Live Tracking needs accepted history plus one next checkpoint. It does not
  // need every future timing definition inside every participant object.
  const accepted = resolved.splits.filter(
    (split) => split.status === "COMPLETED" && Boolean(split.readAt),
  );
  const next = resolved.nextExpectedSplit;
  const values =
    next && !accepted.some((split) => split.splitKey === next.splitKey)
      ? [...accepted, next]
      : accepted;
  return values.map((split) =>
    compactSplit(split, calculated.get(split.splitKey)),
  );
}

function normalizeVisibility(value: unknown): MobileLiveVisibility {
  const visibility = String(value || "PUBLIC")
    .trim()
    .toUpperCase();
  if (visibility === "PRIVATE" || visibility === "OFFICIALS_ONLY")
    return "PRIVATE";
  if (visibility === "ANONYMOUS" || visibility === "ANON") return "ANONYMOUS";
  return "PUBLIC";
}

/** Build a complete immutable response object before the single KV put. */
export function buildMobileLiveParticipant(
  snapshot: CanonicalAthleteSnapshot,
  options: { liveRevision?: number; canonicalBuildVersion?: string } = {},
): MobileLiveParticipant {
  const resolved = snapshot.raceState.resolved;
  const visibility = normalizeVisibility(snapshot.identity.trackingVisibility);
  const timingVersion = Math.max(
    0,
    Number(snapshot.timingVersion) || 0,
    Number(snapshot.versions?.timing) || 0,
    Number(options.liveRevision) || 0,
  );
  const leaderboardVersion = Math.max(
    0,
    Number(snapshot.leaderboardVersion) || 0,
    Number(snapshot.versions?.leaderboard) || 0,
  );
  const status = resolved?.status || snapshot.raceState.status;
  const rankExcluded = ["DNS", "DNF", "DNQ", "DSQ"].includes(
    String(status || "").trim().toUpperCase(),
  );
  const splits = selectedSplits(resolved, snapshot.splits || []).map((split) =>
    rankExcluded
      ? {
          ...split,
          overallRank: null,
          genderRank: null,
          categoryRank: null,
        }
      : split,
  );
  return {
    schemaVersion: MOBILE_LIVE_PARTICIPANT_SCHEMA_VERSION,
    eventId: snapshot.eventId,
    providerEventUuid: String(snapshot.providerEventUuid || "").trim(),
    participantUuid: snapshot.identity.participantUuid,
    providerParticipantUuid: snapshot.identity.providerParticipantUuid,
    contestUuid: snapshot.contestUuid,
    providerContestUuid: snapshot.providerContestUuid || snapshot.contestUuid,
    bib: visibility === "PRIVATE" ? "" : snapshot.identity.bib,
    displayName:
      visibility === "PUBLIC"
        ? snapshot.identity.displayName
        : visibility === "ANONYMOUS"
          ? "Anonymous Athlete"
          : "",
    ageGroup: snapshot.identity.ageGroupKey || null,
    visibility,
    status,
    eventTimezone: resolved?.eventTimezone || "UTC",
    serverNow: snapshot.updatedAt || null,
    gunStartAt: resolved?.gunStartAt ?? null,
    chipStartAt: resolved?.chipStartAt ?? null,
    waveStartAt: resolved?.waveStartAt ?? null,
    acceptedStartAt: resolved?.acceptedStartAt ?? null,
    officialStartAt: resolved?.officialStartAt ?? null,
    finishAt: resolved?.finishAt ?? null,
    currentLeg: resolved?.currentLeg ?? snapshot.raceState.currentLegType,
    currentSectionKey:
      resolved?.currentSectionKey ?? snapshot.raceState.currentSectionKey,
    currentSplitKey: resolved?.currentSplit?.splitKey ?? null,
    nextSplitKey: resolved?.nextExpectedSplit?.splitKey ?? null,
    splits,
    progress: {
      officialDistanceKm:
        resolved?.officialDistanceKm ?? snapshot.raceState.distanceCompletedKm,
      estimatedDistanceKm:
        resolved?.estimatedDistanceKm ?? snapshot.raceState.distanceCompletedKm,
      totalDistanceKm: resolved?.totalDistanceKm ?? 0,
      distanceRemainingKm: resolved?.distanceRemainingKm ?? 0,
      officialProgressRatio:
        resolved?.officialProgressRatio ?? snapshot.raceState.progressRatio,
      estimatedProgressRatio:
        resolved?.estimatedProgressRatio ?? snapshot.raceState.progressRatio,
      nextSplitDistanceKm: resolved?.nextSplitDistanceKm ?? null,
      etaNextSplit: resolved?.etaNextSplit ?? null,
      predictedPaceSecondsPerKm: resolved?.predictedPaceSecondsPerKm ?? null,
      predictedSpeedKmh: resolved?.predictedSpeedKmh ?? null,
      estimatedFinishTime: resolved?.estimatedFinishTime ?? null,
      predictionSource: resolved?.predictionSource ?? null,
      predictionConfidence: resolved?.predictionConfidence ?? null,
    },
    rank: {
      overall: rankExcluded
        ? null
        : (resolved?.overallRank ?? snapshot.overallRanking.overallRank),
      gender: rankExcluded
        ? null
        : (resolved?.genderRank ?? snapshot.overallRanking.genderRank),
      ageGroup: rankExcluded
        ? null
        : (resolved?.categoryRank ?? snapshot.overallRanking.ageGroupRank),
      club: rankExcluded
        ? null
        : (resolved?.clubRank ?? snapshot.overallRanking.clubRank),
    },
    timing: {
      mode: resolved?.officialTimingMode ?? null,
      hasStarted: resolved?.hasStarted === true,
      liveOverallElapsedMs: resolved?.liveOverallElapsedMs ?? null,
      officialRaceElapsedMs: resolved?.officialRaceElapsedMs ?? null,
      gunElapsedMs: resolved?.gunElapsedMs ?? null,
      chipElapsedMs: resolved?.chipElapsedMs ?? null,
      waveElapsedMs: resolved?.waveElapsedMs ?? null,
      currentLegElapsedMs: resolved?.currentLegElapsedMs ?? null,
      currentSectionElapsedMs: resolved?.currentSectionElapsedMs ?? null,
      finalElapsedMs: resolved?.finalElapsedMs ?? null,
      finalSplitAccepted: resolved?.finalSplitAccepted === true,
    },
    cutoff: resolved?.cutoff
      ? {
          applicable: true,
          checkpointKey: resolved.cutoff.boundarySplitKey,
          checkpointLabel: resolved.cutoff.displayName,
          basis: resolved.cutoff.basis,
          cutoffSeconds: resolved.cutoff.cutoffSeconds,
          deadlineAt: resolved.cutoff.deadlineUtc,
          remainingSeconds: resolved.cutoff.remainingSeconds,
          state:
            resolved.status === "DNF" &&
            resolved.statusSource === "AUTO_CUTOFF_RULE"
              ? "CONFIRMED_CUTOFF"
              : resolved.cutoff.officialStatus === "OUT_OF_CUTOFF"
                ? "MISSED"
                : resolved.cutoff.projectionStatus === "DANGER"
                  ? "AT_RISK"
                  : resolved.cutoff.projectionStatus === "SAFE"
                    ? "SAFE"
                    : "UPCOMING",
          resolvedAt:
            resolved.status === "DNF" ? resolved.statusResolvedAt : null,
          failureReason:
            resolved.status === "DNF" ? resolved.statusReason : null,
        }
      : null,
    location: snapshot.location
      ? {
          segment: snapshot.location.segment,
          latitude: snapshot.location.latitude,
          longitude: snapshot.location.longitude,
          courseDistanceKm: snapshot.location.courseDistanceKm,
          legDistanceKm: snapshot.location.legDistanceKm,
          recordedAt: snapshot.location.recordedAt,
          source: snapshot.location.source,
          estimated: snapshot.location.estimated,
        }
      : null,
    timingVersion,
    leaderboardVersion,
    liveRevision: Math.max(timingVersion, Number(options.liveRevision) || 0),
    canonicalBuildVersion:
      options.canonicalBuildVersion || snapshot.buildVersion,
    updatedAt: snapshot.updatedAt,
  };
}

type MutableParticipantLiveInput = {
  eventId: string;
  providerEventUuid: string;
  participantUuid: string;
  providerParticipantUuid: string;
  contestUuid: string;
  providerContestUuid?: string | null;
  bib: string;
  displayName?: string | null;
  ageGroup?: string | null;
  trackingVisibility?: string | null;
  canonicalBuildVersion?: string | null;
  updatedAt: string;
  participantLive: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

/**
 * Materialize the already-reconciled mutable canonical state before the
 * canonical-change socket event is emitted. This function does not interpret
 * provider reads; it only projects fields the canonical timing worker already
 * accepted and resolved.
 */
export function buildMobileLiveParticipantFromMutableState(
  input: MutableParticipantLiveInput,
): MobileLiveParticipant {
  const live = input.participantLive;
  const resolved = record(live.resolvedRaceState);
  const visibility = normalizeVisibility(
    input.trackingVisibility ?? live.trackingVisibility,
  );
  const liveRevision = Math.max(
    0,
    Number(live.liveRevision) || 0,
    Number(live.timingVersion) || 0,
  );
  const leaderboardVersion = Math.max(
    0,
    Number(live.leaderboardVersion) || 0,
    Number(record(live.versions).leaderboard) || 0,
  );
  const participantStatus =
    text(resolved.status ?? live.status) || "NOT_STARTED";
  const participantRank = {
    overall: numberOrNull(resolved.overallRank ?? live.overallRank),
    gender: numberOrNull(resolved.genderRank ?? live.genderRank),
    ageGroup: numberOrNull(
      resolved.categoryRank ?? live.ageGroupRank ?? live.categoryRank,
    ),
    club: numberOrNull(resolved.clubRank ?? live.clubRank),
  };
  const splits = (Array.isArray(live.splits) ? live.splits : [])
    .map(record)
    .filter((split) => {
      const status = String(split.status || "").toUpperCase();
      return (
        split.accepted === true ||
        split.isAccepted === true ||
        [
          "VALID",
          "CONFIRMED",
          "CORRECTED",
          "OFFICIAL",
          "MANUAL_CORRECTED",
          "COMPLETED",
        ].includes(status)
      );
    })
    .map((split): MobileLiveParticipantSplit => ({
      splitKey: text(split.splitKey ?? split.key) || "",
      name:
        text(split.splitName ?? split.name ?? split.splitKey ?? split.key) ||
        "",
      legType: text(split.legType ?? split.leg),
      order: numberOrNull(split.order),
      readAt: text(split.readAt ?? split.acceptedAt ?? split.detectedAt),
      timeOfDay: text(split.timeOfDay),
      elapsedSeconds: numberOrNull(split.elapsedSeconds),
      overallElapsedSeconds: numberOrNull(split.overallElapsedSeconds),
      legElapsedSeconds: numberOrNull(split.legElapsedSeconds),
      sectionElapsedSeconds: numberOrNull(
        split.sectionElapsedSeconds ?? split.sectionSeconds,
      ),
      distanceKm: numberOrNull(
        split.cumulativeRaceDistanceKm ?? split.distanceKm,
      ),
      legDistanceKm: numberOrNull(split.legDistanceKm),
      status: text(split.status) || "COMPLETED",
      paceSecondsPerKm: numberOrNull(split.paceSecondsPerKm),
      paceSecondsPer100m: numberOrNull(split.paceSecondsPer100m),
      speedKmh: numberOrNull(split.speedKmh),
      overallRank: numberOrNull(
        split.overallRank ?? record(split.ranking).overallRank,
      ),
      genderRank: numberOrNull(
        split.genderRank ?? record(split.ranking).genderRank,
      ),
      categoryRank: numberOrNull(
        split.categoryRank ?? record(split.ranking).ageGroupRank,
      ),
    }))
    .filter((split) => Boolean(split.splitKey));
  if (participantStatus.toUpperCase() === "FINISHED") {
    const finish = [...splits]
      .reverse()
      .find((split) => /(^|_)finish$/i.test(split.splitKey));
    if (finish) {
      finish.overallRank ??= participantRank.overall;
      finish.genderRank ??= participantRank.gender;
      finish.categoryRank ??= participantRank.ageGroup;
    }
  }
  const next = record(resolved.nextExpectedSplit);
  const nextKey = text(next.splitKey ?? next.key);
  if (nextKey && !splits.some((split) => split.splitKey === nextKey)) {
    splits.push({
      splitKey: nextKey,
      name: text(next.name ?? next.splitName) || nextKey,
      legType: text(next.legType ?? next.leg),
      order: numberOrNull(next.order),
      readAt: null,
      timeOfDay: null,
      elapsedSeconds: null,
      overallElapsedSeconds: null,
      legElapsedSeconds: null,
      sectionElapsedSeconds: null,
      distanceKm: numberOrNull(
        next.cumulativeRaceDistanceKm ?? next.distanceKm,
      ),
      legDistanceKm: numberOrNull(next.legDistanceKm),
      status: "PENDING",
      paceSecondsPerKm: null,
      paceSecondsPer100m: null,
      speedKmh: null,
      overallRank: null,
      genderRank: null,
      categoryRank: null,
    });
  }
  return {
    schemaVersion: MOBILE_LIVE_PARTICIPANT_SCHEMA_VERSION,
    eventId: input.eventId,
    providerEventUuid: input.providerEventUuid,
    participantUuid: input.participantUuid,
    providerParticipantUuid: input.providerParticipantUuid,
    contestUuid: input.contestUuid,
    providerContestUuid: input.providerContestUuid || input.contestUuid,
    bib: visibility === "PRIVATE" ? "" : input.bib,
    displayName:
      visibility === "PUBLIC"
        ? text(input.displayName) || `Bib ${input.bib}`
        : visibility === "ANONYMOUS"
          ? "Anonymous Athlete"
          : "",
    ageGroup: text(
      input.ageGroup ??
        live.ageGroupKey ??
        live.ageGroup ??
        live.ageGroupName ??
        live.ageCategory,
    ),
    visibility,
    status: participantStatus,
    eventTimezone: text(resolved.eventTimezone ?? live.eventTimezone) || "UTC",
    serverNow: text(live.serverNow ?? live.updatedAt ?? input.updatedAt),
    gunStartAt: text(resolved.gunStartAt ?? resolved.officialGunStartAt),
    chipStartAt: text(resolved.chipStartAt ?? resolved.acceptedStartAt),
    waveStartAt: text(resolved.waveStartAt),
    acceptedStartAt: text(resolved.acceptedStartAt),
    officialStartAt: text(resolved.officialStartAt),
    finishAt: text(
      resolved.finishAt ?? resolved.officialFinishAt ?? live.finishedAt,
    ),
    currentLeg: text(resolved.currentLeg ?? live.currentLeg),
    currentSectionKey: text(resolved.currentSectionKey),
    currentSplitKey: text(
      record(resolved.currentSplit).splitKey ?? live.currentSplit,
    ),
    nextSplitKey: nextKey,
    splits,
    progress: {
      officialDistanceKm: numberOrNull(resolved.officialDistanceKm) ?? 0,
      estimatedDistanceKm: numberOrNull(resolved.estimatedDistanceKm) ?? 0,
      totalDistanceKm: numberOrNull(resolved.totalDistanceKm) ?? 0,
      distanceRemainingKm: numberOrNull(resolved.distanceRemainingKm) ?? 0,
      officialProgressRatio: numberOrNull(resolved.officialProgressRatio) ?? 0,
      estimatedProgressRatio:
        numberOrNull(resolved.estimatedProgressRatio) ?? 0,
      nextSplitDistanceKm: numberOrNull(resolved.nextSplitDistanceKm),
      etaNextSplit: text(resolved.etaNextSplit),
      predictedPaceSecondsPerKm: numberOrNull(
        resolved.predictedPaceSecondsPerKm,
      ),
      predictedSpeedKmh: numberOrNull(resolved.predictedSpeedKmh),
      estimatedFinishTime: text(resolved.estimatedFinishTime),
      predictionSource: text(resolved.predictionSource),
      predictionConfidence: text(resolved.predictionConfidence),
    },
    rank: participantRank,
    timing: {
      mode: text(resolved.officialTimingMode ?? resolved.timingMode),
      hasStarted: resolved.hasStarted === true,
      liveOverallElapsedMs: numberOrNull(resolved.liveOverallElapsedMs),
      officialRaceElapsedMs: numberOrNull(resolved.officialRaceElapsedMs),
      gunElapsedMs: numberOrNull(resolved.gunElapsedMs),
      chipElapsedMs: numberOrNull(resolved.chipElapsedMs),
      waveElapsedMs: numberOrNull(resolved.waveElapsedMs),
      currentLegElapsedMs: numberOrNull(resolved.currentLegElapsedMs),
      currentSectionElapsedMs: numberOrNull(resolved.currentSectionElapsedMs),
      finalElapsedMs: numberOrNull(resolved.finalElapsedMs),
      finalSplitAccepted: resolved.finalSplitAccepted === true,
    },
    cutoff: (() => {
      const cutoff = record(resolved.cutoff);
      const checkpointKey = text(
        cutoff.boundarySplitKey ?? cutoff.checkpointKey,
      );
      const deadlineAt = text(cutoff.deadlineUtc ?? cutoff.deadlineAt);
      const cutoffSeconds = numberOrNull(cutoff.cutoffSeconds);
      if (!checkpointKey || !deadlineAt || cutoffSeconds == null) return null;
      const mode = (
        text(cutoff.basis ?? resolved.officialTimingMode) || "GUN"
      ).toUpperCase();
      const basis = mode === "CHIP" || mode === "WAVE" ? mode : "GUN";
      const confirmed =
        String(resolved.status || "").toUpperCase() === "DNF" &&
        String(resolved.statusSource || "").toUpperCase() ===
          "AUTO_CUTOFF_RULE";
      const officialStatus = String(cutoff.officialStatus || "").toUpperCase();
      const projectionStatus = String(
        cutoff.projectionStatus || "",
      ).toUpperCase();
      return {
        applicable: true as const,
        checkpointKey,
        checkpointLabel:
          text(cutoff.displayName ?? cutoff.checkpointLabel) || checkpointKey,
        basis,
        cutoffSeconds,
        deadlineAt,
        remainingSeconds: numberOrNull(cutoff.remainingSeconds) ?? 0,
        state: confirmed
          ? ("CONFIRMED_CUTOFF" as const)
          : officialStatus === "OUT_OF_CUTOFF"
            ? ("MISSED" as const)
            : projectionStatus === "DANGER"
              ? ("AT_RISK" as const)
              : projectionStatus === "SAFE"
                ? ("SAFE" as const)
                : ("UPCOMING" as const),
        resolvedAt: confirmed ? text(resolved.statusResolvedAt) : null,
        failureReason: confirmed ? text(resolved.statusReason) : null,
      };
    })(),
    location: null,
    timingVersion: liveRevision,
    leaderboardVersion,
    liveRevision,
    canonicalBuildVersion:
      text(input.canonicalBuildVersion) || "hot-state-only",
    updatedAt: input.updatedAt,
  };
}

/**
 * Participant-scoped recovery model used when the ready MobileLive value is
 * absent. The immutable snapshot owns identity/build metadata; a newer
 * participantLive record may replace only mutable race state.
 */
export function buildMobileLiveParticipantFromSnapshotAndMutableState(
  snapshot: CanonicalAthleteSnapshot,
  participantLive?: Record<string, unknown> | null,
): MobileLiveParticipant {
  const base = buildMobileLiveParticipant(snapshot);
  if (!participantLive) return base;
  const mutableRevision = Math.max(
    0,
    Number(participantLive.liveRevision) || 0,
    Number(participantLive.timingVersion) || 0,
  );
  if (mutableRevision < base.liveRevision) return base;
  const hot = buildMobileLiveParticipantFromMutableState({
    eventId: snapshot.eventId,
    providerEventUuid: String(snapshot.providerEventUuid || "").trim(),
    participantUuid: snapshot.identity.participantUuid,
    providerParticipantUuid: snapshot.identity.providerParticipantUuid,
    contestUuid: snapshot.contestUuid,
    providerContestUuid: snapshot.providerContestUuid,
    bib: snapshot.identity.bib,
    displayName: snapshot.identity.displayName,
    ageGroup: snapshot.identity.ageGroupKey,
    trackingVisibility: snapshot.identity.trackingVisibility,
    canonicalBuildVersion: snapshot.buildVersion,
    updatedAt: text(participantLive.updatedAt) || snapshot.updatedAt,
    participantLive,
  });
  const hotOwnsRanks = hot.leaderboardVersion >= base.leaderboardVersion;
  const baseSplits = new Map(
    base.splits.map((split) => [split.splitKey, split]),
  );
  return {
    ...base,
    ...hot,
    // Participant timing overlays are intentionally sparse. Immutable
    // identity must survive even when the hot record has no age-group field.
    ageGroup: hot.ageGroup ?? base.ageGroup,
    // The immutable contest configuration owns the official gun start. A
    // sparse race-day participant overlay must never erase it with null;
    // accepted chip/wave timestamps remain mutable and continue to come from
    // the hot projection when present.
    gunStartAt: hot.gunStartAt ?? base.gunStartAt,
    splits: hot.splits.map((split) => {
      const immutable = baseSplits.get(split.splitKey);
      return hotOwnsRanks || !immutable
        ? split
        : {
            ...split,
            overallRank: immutable.overallRank,
            genderRank: immutable.genderRank,
            categoryRank: immutable.categoryRank,
          };
    }),
    rank: hotOwnsRanks ? hot.rank : base.rank,
    leaderboardVersion: Math.max(
      base.leaderboardVersion,
      hot.leaderboardVersion,
    ),
    location: hot.location ?? base.location,
    canonicalBuildVersion: snapshot.buildVersion,
  };
}

export function mobileLiveParticipantEtag(
  value: MobileLiveParticipant,
): string {
  const build = encodeURIComponent(
    value.canonicalBuildVersion || "hot-state-only",
  );
  // Force clients holding an older compact projection (including the
  // pre-ageGroup and pre-prediction shapes) to refresh once.
  const identityRevision = Object.prototype.hasOwnProperty.call(
    value,
    "ageGroup",
  )
    ? "i3"
    : "i0";
  return `\"mlp-${build}-${value.timingVersion}-${value.leaderboardVersion}-${value.liveRevision}-${identityRevision}\"`;
}
