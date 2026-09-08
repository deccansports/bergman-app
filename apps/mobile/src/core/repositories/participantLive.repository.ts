import { env } from "../constants/env";
import { canonicalMobileLiveParticipantKey } from "@bergman/live-tracking-contracts";
import { recordLivePerformance } from "@/features/tracking/livePerformanceDiagnostics";
import {
  finishDiagnosticRequest,
  startDiagnosticRequest,
  type LiveTriggerSource,
} from "@/core/services/performance/iosLiveDiagnostics";

export type MobileLiveReadReason =
  | "initial_load"
  | "athlete_changed"
  | "socket_invalidated"
  | "foreground"
  | "manual_refresh"
  | "poll";

type MobileLiveParticipant = {
  schemaVersion: 1;
  eventId: string;
  providerEventUuid: string;
  participantUuid: string;
  providerParticipantUuid: string;
  contestUuid: string;
  providerContestUuid: string;
  bib: string;
  displayName: string;
  /** Added compatibly; older deployed compact records may omit it. */
  ageGroup?: string | null;
  visibility: "PUBLIC" | "ANONYMOUS";
  status: string;
  eventTimezone: string;
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
  splits: Array<Record<string, unknown>>;
  progress: Record<string, unknown>;
  rank: {
    overall: number | null;
    gender: number | null;
    ageGroup: number | null;
    club: number | null;
  };
  timing: Record<string, unknown>;
  cutoff: Record<string, unknown> | null;
  location: Record<string, unknown> | null;
  timingVersion: number;
  leaderboardVersion: number;
  liveRevision: number;
  canonicalBuildVersion: string;
  updatedAt: string;
};

type CacheEntry = {
  etag: string | null;
  participant: MobileLiveParticipant;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<MobileLiveParticipant>>();
const observedBuildsByScope = new Map<string, Map<string, string>>();
let previousSelectedParticipantUuid: string | null = null;

export const MAX_PARTICIPANT_LIVE_CACHE_ENTRIES = 50;

function touchCacheEntry(cacheKey: string, entry: CacheEntry): void {
  cache.delete(cacheKey);
  cache.set(cacheKey, entry);
}

function setCacheEntry(cacheKey: string, entry: CacheEntry): void {
  touchCacheEntry(cacheKey, entry);
  while (cache.size > MAX_PARTICIPANT_LIVE_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    cache.delete(oldestKey);
  }
}

type CacheComparatorResult = {
  decision: "accept_incoming" | "reuse_existing";
  reason:
    | "no_previous_value"
    | "newer_canonical_build"
    | "different_unordered_canonical_build"
    | "newer_timing_version"
    | "newer_live_revision"
    | "newer_leaderboard_version"
    | "unchanged_revision"
    | "stale_canonical_build"
    | "stale_timing_version"
    | "stale_live_revision"
    | "stale_leaderboard_version";
};

function canonicalBuildTimestamp(value: string): number | null {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2}\.\d{3})Z-/,
  );
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function compareParticipantLiveVersions(
  incoming: MobileLiveParticipant,
  previous?: MobileLiveParticipant,
): CacheComparatorResult {
  if (!previous)
    return { decision: "accept_incoming", reason: "no_previous_value" };
  if (incoming.canonicalBuildVersion !== previous.canonicalBuildVersion) {
    const incomingAt = canonicalBuildTimestamp(incoming.canonicalBuildVersion);
    const previousAt = canonicalBuildTimestamp(previous.canonicalBuildVersion);
    if (incomingAt != null && previousAt != null) {
      return incomingAt < previousAt
        ? { decision: "reuse_existing", reason: "stale_canonical_build" }
        : { decision: "accept_incoming", reason: "newer_canonical_build" };
    }
    return {
      decision: "accept_incoming",
      reason: "different_unordered_canonical_build",
    };
  }
  if (incoming.timingVersion < previous.timingVersion) {
    return { decision: "reuse_existing", reason: "stale_timing_version" };
  }
  if (incoming.timingVersion > previous.timingVersion) {
    return { decision: "accept_incoming", reason: "newer_timing_version" };
  }
  if (incoming.liveRevision < previous.liveRevision) {
    return { decision: "reuse_existing", reason: "stale_live_revision" };
  }
  if (incoming.liveRevision > previous.liveRevision) {
    return { decision: "accept_incoming", reason: "newer_live_revision" };
  }
  if (incoming.leaderboardVersion < previous.leaderboardVersion) {
    return { decision: "reuse_existing", reason: "stale_leaderboard_version" };
  }
  if (incoming.leaderboardVersion > previous.leaderboardVersion) {
    return { decision: "accept_incoming", reason: "newer_leaderboard_version" };
  }
  return { decision: "reuse_existing", reason: "unchanged_revision" };
}

function comparisonFields(
  incoming: MobileLiveParticipant | null,
  previous?: MobileLiveParticipant,
  comparison?: CacheComparatorResult,
) {
  return {
    canonicalBuildVersion: incoming?.canonicalBuildVersion ?? null,
    previousCanonicalBuildVersion: previous?.canonicalBuildVersion ?? null,
    timingVersion: incoming?.timingVersion ?? null,
    previousTimingVersion: previous?.timingVersion ?? null,
    leaderboardVersion: incoming?.leaderboardVersion ?? null,
    previousLeaderboardVersion: previous?.leaderboardVersion ?? null,
    liveRevision: incoming?.liveRevision ?? null,
    previousLiveRevision: previous?.liveRevision ?? null,
    comparatorDecision: comparison?.decision ?? "no_incoming_value",
    comparatorReason: comparison?.reason ?? "transport_response_without_value",
  };
}

function recordCanonicalBuildCohort(participant: MobileLiveParticipant): void {
  if (process.env.NODE_ENV === "production") return;
  const scope = `${participant.eventId}:${participant.providerEventUuid.toLowerCase()}`;
  const participants =
    observedBuildsByScope.get(scope) ?? new Map<string, string>();
  const identity = participant.participantUuid.toLowerCase();
  participants.delete(identity);
  participants.set(identity, participant.canonicalBuildVersion);
  while (participants.size > MAX_PARTICIPANT_LIVE_CACHE_ENTRIES) {
    const oldestIdentity = participants.keys().next().value;
    if (typeof oldestIdentity !== "string") break;
    participants.delete(oldestIdentity);
  }
  observedBuildsByScope.delete(scope);
  observedBuildsByScope.set(scope, participants);
  while (observedBuildsByScope.size > 8) {
    const oldestScope = observedBuildsByScope.keys().next().value;
    if (typeof oldestScope !== "string") break;
    observedBuildsByScope.delete(oldestScope);
  }
  const versions = [...new Set(participants.values())];
  console.info("[MOBILE_LIVE_BUILD_COHORT]", {
    eventId: participant.eventId,
    providerEventUuid: participant.providerEventUuid,
    participantCount: participants.size,
    canonicalBuildVersions: versions,
    consistent: versions.length <= 1,
  });
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function elapsedSecondsAtServerNow(participant: MobileLiveParticipant): number {
  const status = participant.status.toUpperCase();
  const terminal = ["FINISHED", "DNF", "DNS", "DNQ", "DSQ", "CUT_OFF"].includes(
    status,
  );
  const finalMs = numberOrNull(participant.timing.finalElapsedMs);
  if (terminal) return Math.max(0, Math.floor((finalMs ?? 0) / 1_000));
  if (!participant.timing.hasStarted) return 0;
  const mode = String(participant.timing.mode || "GUN").toUpperCase();
  const anchor =
    mode === "CHIP"
      ? participant.chipStartAt
      : mode === "WAVE"
        ? participant.waveStartAt
        : (participant.gunStartAt ?? participant.officialStartAt);
  const now = Date.parse(participant.serverNow || "");
  const start = Date.parse(anchor || "");
  return Number.isFinite(now) && Number.isFinite(start)
    ? Math.max(0, Math.floor((now - start) / 1_000))
    : Math.max(
        0,
        Math.floor(
          (numberOrNull(participant.timing.officialRaceElapsedMs) ?? 0) / 1_000,
        ),
      );
}

function emitCanonicalTimingDiagnostics(
  participant: MobileLiveParticipant,
  previous?: MobileLiveParticipant,
): void {
  const elapsedSeconds = elapsedSecondsAtServerNow(participant);
  console.info("[ELAPSED_TIME_SOURCE]", {
    participantUuid: participant.participantUuid,
    bib: participant.bib,
    status: participant.status,
    source: `CANONICAL_${String(participant.timing.mode || "UNKNOWN").toUpperCase()}`,
    gunStartAt: participant.gunStartAt,
    chipStartAt: participant.chipStartAt,
    finishAt: participant.finishAt,
    serverNow: participant.serverNow,
    elapsedSeconds,
    timingVersion: participant.timingVersion,
    leaderboardVersion: participant.leaderboardVersion,
    liveRevision: participant.liveRevision,
  });
  if (previous && previous.timingVersion !== participant.timingVersion) {
    console.info("[ELAPSED_TIME_REBASE]", {
      participantUuid: participant.participantUuid,
      previousTimingVersion: previous.timingVersion,
      nextTimingVersion: participant.timingVersion,
      previousLeaderboardVersion: previous.leaderboardVersion,
      nextLeaderboardVersion: participant.leaderboardVersion,
      previousStartAt: previous.acceptedStartAt ?? previous.officialStartAt,
      nextStartAt: participant.acceptedStartAt ?? participant.officialStartAt,
      previousElapsedSeconds: elapsedSecondsAtServerNow(previous),
      nextElapsedSeconds: elapsedSeconds,
      reason: "canonical_timing_version_changed",
    });
  }
  if (
    previous &&
    previous.status !== "FINISHED" &&
    participant.status === "FINISHED"
  ) {
    console.info("[ATHLETE_FINISH_TRANSITION]", {
      participantUuid: participant.participantUuid,
      previousStatus: previous.status,
      nextStatus: participant.status,
      previousLiveRevision: previous.liveRevision,
      nextLiveRevision: participant.liveRevision,
      timingVersion: participant.timingVersion,
      finishAt: participant.finishAt,
      elapsedSeconds,
      splitCount: participant.splits.filter((split) => Boolean(split.readAt))
        .length,
    });
  }
}

function key(
  eventId: string,
  providerEventUuid: string,
  participantUuid: string,
): string {
  return `${eventId}:${providerEventUuid.toLowerCase()}:${participantUuid.toLowerCase()}`;
}

function endpoint(
  eventId: string,
  providerEventUuid: string,
  participantUuid: string,
): string {
  const base = env.liveTrackingEdgeBaseUrl.replace(/\/$/, "");
  return `${base}/v1/live-participant/${encodeURIComponent(eventId)}/${encodeURIComponent(
    providerEventUuid,
  )}/${encodeURIComponent(participantUuid)}`;
}

function valid(value: unknown): value is MobileLiveParticipant {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<MobileLiveParticipant>;
  return (
    row.schemaVersion === 1 &&
    Boolean(
      row.eventId &&
      row.providerEventUuid &&
      row.participantUuid &&
      row.bib &&
      Array.isArray(row.splits) &&
      row.progress &&
      row.timing,
    )
  );
}

export class ParticipantLiveReadError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ParticipantLiveReadError";
  }
}

/** Direct public Worker read: no Firebase token, SecureStore, or api-mobile. */
export function getParticipantLive(
  eventId: string,
  providerEventUuid: string,
  participantUuid: string,
  signal?: AbortSignal,
  reason: MobileLiveReadReason = "initial_load",
): Promise<MobileLiveParticipant> {
  const cacheKey = key(eventId, providerEventUuid, participantUuid);
  const current = inFlight.get(cacheKey);
  if (current) return current;
  const request = (async () => {
    const startedAt = Date.now();
    const cached = cache.get(cacheKey);
    // This is the actual direct Worker/KV network boundary. The shared API
    // client cannot observe it, so count it here rather than at a derivation
    // or React Query layer.
    recordLivePerformance("mobileLiveReads");
    const requestUrl = endpoint(eventId, providerEventUuid, participantUuid);
    const trigger: LiveTriggerSource =
      reason === "socket_invalidated"
        ? "socket"
        : reason === "poll"
          ? "poll"
          : reason === "foreground"
            ? "foreground"
            : reason === "athlete_changed"
              ? "user_selection"
              : "repository";
    const diagnosticRequest = startDiagnosticRequest({
      method: "GET",
      url: requestUrl,
      source: "participantLive.repository:getParticipantLive",
      trigger,
      participantUuid,
      queryKey: [
        "mobile-live-participant",
        eventId,
        providerEventUuid,
        participantUuid,
      ],
    });
    let response: Response;
    try {
      response = await fetch(requestUrl, {
        method: "GET",
        headers: {
          accept: "application/json",
          ...(cached?.etag ? { "if-none-match": cached.etag } : {}),
        },
        signal,
      });
      finishDiagnosticRequest(diagnosticRequest, { status: response.status });
    } catch (error) {
      finishDiagnosticRequest(diagnosticRequest, {
        status: "ERR",
        cancelled:
          signal?.aborted === true ||
          (error instanceof Error && error.name === "AbortError"),
      });
      throw error;
    }
    const storageKey = canonicalMobileLiveParticipantKey(
      eventId,
      providerEventUuid,
      participantUuid,
    );
    const readSource =
      response.headers.get("x-bergman-athlete-source") || "DIRECT_KV";
    if (response.status === 304 && cached) {
      touchCacheEntry(cacheKey, cached);
      if (process.env.NODE_ENV !== "production") {
        console.info("[MOBILE_LIVE_READ]", {
          eventId,
          providerEventUuid,
          participantUuid,
          key: storageKey,
          ...comparisonFields(cached.participant, cached.participant, {
            decision: "reuse_existing",
            reason: "unchanged_revision",
          }),
          leaderboardVersion: cached.participant.leaderboardVersion,
          responseBytes: 0,
          durationMs: Date.now() - startedAt,
          cacheStatus: "etag_304",
          reason,
        });
        console.info("[MOBILE_LIVE_SOURCE]", readSource);
      }
      recordCanonicalBuildCohort(cached.participant);
      return cached.participant;
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      if (process.env.NODE_ENV !== "production") {
        console.info("[MOBILE_LIVE_READ]", {
          eventId,
          providerEventUuid,
          participantUuid,
          key: storageKey,
          ...comparisonFields(null, cached?.participant),
          leaderboardVersion: cached?.participant.leaderboardVersion ?? null,
          responseBytes: new TextEncoder().encode(errorText).byteLength,
          durationMs: Date.now() - startedAt,
          cacheStatus: `error_${response.status}`,
          reason,
        });
        console.info("[MOBILE_LIVE_SOURCE]", readSource);
      }
      throw new ParticipantLiveReadError(
        response.status,
        `PARTICIPANT_LIVE_READ_${response.status}`,
      );
    }
    const responseText = await response.text();
    const responseBytes = new TextEncoder().encode(responseText).byteLength;
    const decoded = JSON.parse(responseText) as unknown;
    if (!valid(decoded))
      throw new ParticipantLiveReadError(502, "PARTICIPANT_LIVE_INVALID");
    // Older seeded objects predate leaderboardVersion. Treat them as revision
    // zero so a newly reranked projection always wins the cache comparison.
    const participant: MobileLiveParticipant = {
      ...decoded,
      leaderboardVersion: Math.max(0, Number(decoded.leaderboardVersion) || 0),
    };
    const existing = cache.get(cacheKey);
    const comparison = compareParticipantLiveVersions(
      participant,
      existing?.participant,
    );
    if (process.env.NODE_ENV !== "production") {
      console.info("[MOBILE_LIVE_READ]", {
        eventId,
        providerEventUuid,
        participantUuid,
        key: storageKey,
        ...comparisonFields(participant, existing?.participant, comparison),
        leaderboardVersion: participant.leaderboardVersion,
        responseBytes,
        durationMs: Date.now() - startedAt,
        cacheStatus:
          comparison.decision === "reuse_existing"
            ? comparison.reason
            : response.headers.get("cf-cache-status")?.toLowerCase() || "miss",
        reason,
      });
      console.info("[MOBILE_LIVE_SOURCE]", readSource);
    }
    if (comparison.decision === "reuse_existing" && existing) {
      touchCacheEntry(cacheKey, existing);
      recordCanonicalBuildCohort(existing.participant);
      return existing.participant;
    }
    emitCanonicalTimingDiagnostics(participant, existing?.participant);
    if (reason === "athlete_changed") {
      console.info("[ATHLETE_SWITCH_PERFORMANCE]", {
        fromParticipantUuid: previousSelectedParticipantUuid,
        toParticipantUuid: participantUuid,
        durationMs: Date.now() - startedAt,
        mobileLiveReads: 1,
        canonicalAthleteReads: 0,
        participantIndexReads: 0,
        fullCanonicalReads: 0,
        gpxRequests: 0,
        gpxParses: 0,
        socketReconnects: 0,
        bytesDownloaded: responseBytes,
        participantCacheSize: cache.size,
        participantCacheLimit: MAX_PARTICIPANT_LIVE_CACHE_ENTRIES,
      });
      previousSelectedParticipantUuid = participantUuid;
    }
    setCacheEntry(cacheKey, {
      etag: response.headers.get("etag"),
      participant,
    });
    recordCanonicalBuildCohort(participant);
    return participant;
  })();
  inFlight.set(cacheKey, request);
  return request.finally(() => {
    if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
  });
}

/** Translate transport shape only; canonical timing was already resolved server-side. */
export function participantLiveAsCanonicalEnvelope(
  participant: MobileLiveParticipant,
): unknown {
  const resolvedSplits = participant.splits;
  const officialTimingMode = String(participant.timing.mode || "GUN")
    .trim()
    .toUpperCase();
  const startTiming = {
    officialTimingMode,
    mode: officialTimingMode,
    startTimeSource: officialTimingMode,
    gunStartAt: participant.gunStartAt,
    chipStartAt: participant.chipStartAt,
    acceptedChipStartAt: participant.acceptedStartAt,
    acceptedStartAt: participant.acceptedStartAt,
    officialStartAt: participant.officialStartAt,
    hasAcceptedStart: participant.timing.hasStarted,
  };
  const resolved = {
    ...participant.progress,
    ...participant.timing,
    predictedPaceSecondsPerKm: participant.progress.predictedPaceSecondsPerKm,
    predictedSpeedKmh: participant.progress.predictedSpeedKmh,
    estimatedFinishTime: participant.progress.estimatedFinishTime,
    predictionSource: participant.progress.predictionSource,
    predictionConfidence: participant.progress.predictionConfidence,
    officialTimingMode,
    timingMode: officialTimingMode,
    startTiming,
    eventTimezone: participant.eventTimezone,
    status: participant.status,
    serverNow: participant.serverNow,
    gunStartAt: participant.gunStartAt,
    chipStartAt: participant.chipStartAt,
    waveStartAt: participant.waveStartAt,
    acceptedStartAt: participant.acceptedStartAt,
    officialStartAt: participant.officialStartAt,
    finishAt: participant.finishAt,
    currentLeg: participant.currentLeg,
    currentSectionKey: participant.currentSectionKey,
    currentSplit:
      resolvedSplits.find(
        (split) => split.splitKey === participant.currentSplitKey,
      ) ?? null,
    nextExpectedSplit:
      resolvedSplits.find(
        (split) => split.splitKey === participant.nextSplitKey,
      ) ?? null,
    lastCompletedSplit:
      [...resolvedSplits]
        .reverse()
        .find((split) => split.status === "COMPLETED" || split.readAt) ?? null,
    splits: resolvedSplits,
    overallRank: participant.rank.overall,
    genderRank: participant.rank.gender,
    categoryRank: participant.rank.ageGroup,
    clubRank: participant.rank.club,
    cutoff: participant.cutoff,
  };
  return {
    success: true,
    eventId: participant.eventId,
    activeVersion: participant.canonicalBuildVersion,
    data: {
      eventId: participant.eventId,
      buildVersion: participant.canonicalBuildVersion,
      updatedAt: participant.updatedAt,
      providerEventUuid: participant.providerEventUuid,
      contestUuid: participant.contestUuid,
      providerContestUuid: participant.providerContestUuid,
      timingVersion: participant.timingVersion,
      leaderboardVersion: participant.leaderboardVersion,
      identity: {
        participantUuid: participant.participantUuid,
        providerParticipantUuid: participant.providerParticipantUuid,
        bib: participant.bib,
        displayName: participant.displayName,
        ageGroupKey: participant.ageGroup,
        trackingVisibility: participant.visibility,
      },
      raceState: {
        status: participant.status,
        currentSectionKey: participant.currentSectionKey,
        currentLegType: participant.currentLeg,
        progressRatio: participant.progress.officialProgressRatio,
        distanceCompletedKm: participant.progress.officialDistanceKm,
        elapsedSeconds:
          typeof participant.timing.officialRaceElapsedMs === "number"
            ? participant.timing.officialRaceElapsedMs / 1000
            : null,
        lastReadAt: participant.updatedAt,
        resolved,
      },
      startTiming,
      splits: resolvedSplits,
      splitRankings: Object.fromEntries(
        resolvedSplits.map((split) => [
          String(split.splitKey || ""),
          {
            splitKey: split.splitKey,
            overallRank: split.overallRank ?? null,
            genderRank: split.genderRank ?? null,
            ageGroupRank: split.categoryRank ?? null,
          },
        ]),
      ),
      calculated: {
        overallSeconds:
          typeof participant.timing.finalElapsedMs === "number"
            ? participant.timing.finalElapsedMs / 1000
            : null,
      },
      overallRanking: {
        overallRank: participant.rank.overall,
        genderRank: participant.rank.gender,
        ageGroupRank: participant.rank.ageGroup,
        clubRank: participant.rank.club,
      },
      location: participant.location,
      versions: {
        timing: participant.timingVersion,
        leaderboard: participant.leaderboardVersion,
      },
      participantLive: {
        identity: {
          participantUuid: participant.participantUuid,
          providerParticipantUuid: participant.providerParticipantUuid,
          bib: participant.bib,
          displayName: participant.displayName,
          ageGroup: participant.ageGroup,
          ageGroupName: participant.ageGroup,
        },
        contestUuid: participant.contestUuid,
        timingVersion: participant.timingVersion,
        leaderboardVersion: participant.leaderboardVersion,
        liveRevision: participant.liveRevision,
        status: participant.status,
        serverNow: participant.serverNow,
        startTiming,
        cutoff: participant.cutoff,
        currentLeg: participant.currentLeg,
        currentSplit: participant.currentSplitKey,
        splits: resolvedSplits,
        resolvedRaceState: resolved,
        updatedAt: participant.updatedAt,
      },
      liveRevision: participant.liveRevision,
    },
  };
}

export function resetParticipantLiveRepositoryForTests(): void {
  cache.clear();
  inFlight.clear();
  observedBuildsByScope.clear();
  previousSelectedParticipantUuid = null;
}

export function participantLiveRepositoryCacheKeysForTests(): string[] {
  return [...cache.keys()];
}
