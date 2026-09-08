import {
  formatCountdownFromSeconds,
  formatDistanceKm,
  formatSecondsToHMS,
  getCountryFlagEmoji,
} from "@/core/utils/format";
import type {
  AthleteModalResponse,
  CutoffRow,
  LatLng,
  RaceStatus,
  ResolvedTimingPoint,
  AthleteSearchMatch,
  LeaderboardRow,
  SignalKind,
  Split,
  ParticipantLive,
  Visibility,
} from "@/core/types";
import { normalizeContestDistanceScale } from "@/features/tracking/distanceScale";
import {
  deriveOverallFinishMetric,
  parseFinishDurationSeconds,
} from "@/features/tracking/finishPace";
import { debugApiLog } from "@/core/services/api/http";
import {
  conservativePaceSecPerKm,
  type TrackKeyframe,
  type TrackSeed,
} from "@/features/tracking/engine/interpolation";
import type { LeaderboardEntry } from "@/shared/components";
import {
  buildAthleteRaceSections,
  buildCanonicalRaceFlow,
  normalizeTimingKey,
  type AthleteRaceTiming,
  type RaceLegConfig,
  type RaceSplitConfig,
} from "@/features/tracking/timing";
import { formatEventLocalTime as formatCanonicalEventLocalTime } from "@bergman/live-tracking-contracts/time";
import {
  resolveStartTimingPresentation,
  type StartTimingPresentation,
} from "@/features/tracking/timing/startTimingPresentation";
import { normalizeProviderEventUuid } from "@/features/tracking/providerScope";
import { hasCanonicalFinishEvidence } from "@/features/tracking/timing/freshness";
import { hasAcceptedSplitEvidence } from "@/core/repositories/acceptedSplitEvidence";
import { recordLivePerformance } from "@/features/tracking/livePerformanceDiagnostics";
import {
  buildCanonicalPredictionState,
  type AcceptedPredictionSplit,
  type CanonicalPredictionState,
  type PredictionCoursePoint,
  type PredictionRaceState,
} from "@/features/tracking/predictionEngine";

export type AthleteSummary = {
  id: string;
  participantUuid?: string;
  providerEventUuid?: string;
  providerContestUuid?: string;
  canonicalContestUuid?: string;
  bib: string;
  name: string;
  category?: string;
  ageGroup?: string;
  club?: string;
  status?: RaceStatus;
  photoUrl?: string;
  providerUuid?: string;
  providerAthleteUuid?: string;
  providerTimingUuid?: string;
  providerRecordId?: string;
  athleteUid?: string;
  bookingId?: string;
  email?: string;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function recordText(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = text(record[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function scheduledStartFromTicket(
  athlete: Record<string, unknown>,
  ticketDefinition: Record<string, unknown>,
): string | undefined {
  const direct =
    recordText(athlete, ["scheduledStart", "eventStartTime"]) ||
    recordText(ticketDefinition, ["scheduledStart", "gunStartTime"]);
  if (direct && !Number.isNaN(Date.parse(direct))) return direct;

  const rawDate =
    recordText(ticketDefinition, ["raceDate", "eventDate", "date"]) ||
    recordText(athlete, ["eventDate", "raceDate"]);
  const rawTime =
    recordText(ticketDefinition, ["raceStartTime", "startTime"]) ||
    recordText(athlete, ["raceStartTime"]);
  if (!rawDate || !rawTime) return direct;

  let date = rawDate;
  const dateParts = rawDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dateParts) {
    date = `${dateParts[3]}-${dateParts[2].padStart(2, "0")}-${dateParts[1].padStart(2, "0")}`;
  }

  let hours: number;
  let minutes: number;
  const timeParts = rawTime
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!timeParts) return direct;
  hours = Number(timeParts[1]);
  minutes = Number(timeParts[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59)
    return direct;
  const meridiem = timeParts[3]?.toUpperCase();
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  if (hours > 23) return direct;

  // BERGMAN race schedules are authored in India local time.
  return `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+05:30`;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function collectRecordsDeep(
  value: unknown,
  preferredKeys: string[] = [],
  depth = 0,
  seen = new Set<unknown>(),
): Record<string, unknown>[] {
  if (!value || depth > 6) return [];
  if (typeof value === "object") {
    if (seen.has(value)) return [];
    seen.add(value);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      collectRecordsDeep(item, preferredKeys, depth + 1, seen),
    );
  }
  if (typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (isConfiguredSplitRecord(record)) return [record];

  const preferred = preferredKeys
    .map((key) => record[key])
    .flatMap((item) =>
      collectRecordsDeep(item, preferredKeys, depth + 1, seen),
    );
  if (preferred.length > 0) return preferred;

  return Object.values(record).flatMap((item) =>
    collectRecordsDeep(item, preferredKeys, depth + 1, seen),
  );
}

export type TimelineState = "completed" | "current" | "upcoming";

export type TimelineSplit = {
  key: string;
  segment: string;
  name: string;
  splitLabel: string;
  timeLabel: string;
  state: TimelineState;
  distanceLabel?: string;
  timeOfDayLabel?: string;
  splitTimeLabel?: string;
  elapsedTimeLabel?: string;
  paceSpeedLabel?: string;
  positionLabel?: string;
  gapLabel?: string;
  cutoffLabel?: string;
  /** The single not-yet-reached checkpoint exposed by the live projection. */
  expected?: boolean;
};

type ConfiguredTimingPoint = ResolvedTimingPoint & {
  matchKeys?: string[];
  cutoffLabel?: string;
};

/** A generic already-formatted label/value pair for grid tiles. */
export type MetricRow = { label: string; value: string };

/** One cell in the "Estimated Live Position" grid, with its provenance badge. */
export type LivePositionItem = MetricRow & { signal: SignalKind };

/**
 * Identity + event context shown in the header. All identity fields are the
 * backend-provided `display*` values (already anonymized when ANONYMOUS), so
 * the UI never decides what to hide.
 */
export type AthleteHeaderView = {
  name: string;
  photo?: string;
  email?: string;
  athleteUid?: string;
  /** Deterministic avatar color seed (athlete id). */
  colorSeed?: string;
  bib: string;
  contest?: string;
  raceCategory?: string;
  category?: string;
  gender?: string;
  club?: string;
  countryFlag?: string;
  location?: string;
  registrationStatus?: string;
  eventName?: string;
  eventDate?: string;
  scheduledStart?: string;
  anonymous: boolean;
  status: RaceStatus;
  statusLabel: string;
};

/** Race lifecycle + prediction health (the web "Race Status" card). */
export type LifecycleView = {
  label?: string;
  predictionStatus?: string;
  frozen: boolean;
  frozenReason?: string;
};

/** Contest-driven progress bar data (all display-ready). */
export type RaceProgressView = {
  legLabel: string;
  /** Ticket/contest discipline used to select swim, run, bike, duathlon, or triathlon stages. */
  raceCategory?: string;
  percentLabel: string;
  /** 0..1 for the progress bar. */
  progress: number;
  coveredLabel: string;
  remainingLabel: string;
};

/** "Next Split Prediction (Robust)" — display-ready. */
export type NextSplitView = {
  checkpoint: string;
  /** Absolute expected event-local clock time. */
  estimatedTimeOfDay?: string;
  /** Predicted cumulative race elapsed at the checkpoint. */
  estimatedRaceElapsed?: string;
  /** Countdown from now to the predicted checkpoint arrival. */
  estimatedRemaining?: string;
  remaining?: string;
  pace?: string;
  confidence?: string;
  basis?: string;
};

/** Projected finish/rank prediction — display-ready. */
export type ProjectedFinishView = {
  estimatedRaceElapsed?: string;
  estimatedTimeOfDay?: string;
  paceLabel?: string;
  position?: string;
  confidenceLabel?: string;
};

export type PredictedCheckpointView = {
  checkpoint: string;
  estimatedRaceElapsed: string;
  estimatedTimeOfDay: string;
  remaining: string;
};

export type AthletePredictionStateView = {
  raceState: PredictionRaceState;
  suppressed: boolean;
  suppressionReason?: string;
  remainingDistanceKm: number;
  nextCheckpoint: NextSplitView | null;
  remainingCheckpoints: PredictedCheckpointView[];
  projectedFinish: ProjectedFinishView | null;
};

/**
 * Official Results (post-race). When present, the Athlete Detail screen renders
 * this instead of live/estimated widgets. All fields are display-ready.
 */
export type AthleteResultView = {
  statusLabel: string;
  chipTime?: string;
  gunTime?: string;
  finishTimeOfDay?: string;
  officialTime?: string;
  officialTimeBasis?: "CHIP" | "GUN";
  averagePace?: string;
  sections?: {
    key: string;
    label: string;
    type: "leg" | "transition";
    duration: string;
    metric?: string;
  }[];
  ranks: MetricRow[];
  splits: (MetricRow & {
    timeOfDay?: string;
    segmentTime?: string;
    paceSpeed?: string;
    rank?: string;
    leg?: string;
    distanceKm?: number;
  })[];
  meta: MetricRow[];
  progressPercent?: number;
  cutoffStatus?: string;
  cutoffTime?: string;
  provisional?: boolean;
};

/** "Estimated Live Position" grid + prediction footer. */
export type LivePositionView = {
  items: LivePositionItem[];
  predictionConfidence?: string;
  confidenceSignal: SignalKind;
  source?: string;
  updatedAt?: string;
  cutoffStatus?: string;
};

/**
 * Interpolation inputs for the live map: the last official read (seed) drives
 * live animation between mats; the recorded splits (keyframes) drive replay.
 */
export type AthleteTrack = {
  seed: TrackSeed;
  /** Seconds already elapsed since the accepted anchor at this response's server time. */
  initialLiveClockSec?: number;
  keyframes: TrackKeyframe[];
  totalKm: number;
  currentLeg?: string;
  estimatedLegDistanceKm?: number;
  currentLegDistanceKm?: number;
  /** Canonical timing anchor used by the map diagnostic; never a visual-state anchor. */
  anchorSplitKey?: string;
  anchorTimestamp?: number;
  nextCheckpointKey?: string;
  nextCheckpointLabel?: string;
  nextCheckpointKm?: number;
  predictedArrivalAt?: number;
  predictedArrivalElapsedSec?: number;
  paceSource?:
    | "recent_weighted"
    | "recent_section"
    | "elapsed_section"
    | "canonical_model"
    | "transition_hold"
    | "no_safe_pace";
  predictionConfidence?: "HIGH" | "MEDIUM" | "LOW";
  serverTimeSource?: "canonical_server" | "device_fallback";
};

/**
 * Fully presentation-ready Athlete Detail view model. Every field is already
 * formatted for display; React components render this and do NO formatting,
 * parsing, or prediction math of their own.
 */
export type AthleteDetailView = {
  id: string;
  participantUuid?: string;
  canonicalVersion?: string;
  liveRevision?: string | number;
  visibility: Visibility;
  isAnonymous: boolean;
  isPrivate: boolean;
  /** True once official results are available; live/estimated widgets hidden. */
  hasOfficialResults: boolean;
  result?: AthleteResultView;
  header: AthleteHeaderView;
  /** Canonical, mode-aware start state used by every live card clock. */
  startTiming: StartTimingPresentation;
  /** Athlete-specific chip/start timestamp used for elapsed and cutoff clocks. */
  raceStartedAt?: number;
  track?: AthleteTrack;
  liveLocation?: LatLng;
  /** Direct coordinates are authoritative only when they came from real GPS. */
  liveLocationSource?: string;
  lifecycle: LifecycleView;
  liveStats: MetricRow[];
  raceProgress?: RaceProgressView;
  courseOverview: MetricRow[];
  livePosition?: LivePositionView;
  rankings: MetricRow[];
  cutoffs: CutoffRow[];
  activeCutoff?: {
    checkpointKey: string;
    checkpointLabel: string;
    basis: "GUN" | "CHIP" | "WAVE";
    cutoffSeconds: number;
    deadlineAt: number;
    state: "UPCOMING" | "SAFE" | "AT_RISK" | "MISSED" | "CONFIRMED_CUTOFF";
    resolvedAt?: number;
    failureReason?: string;
  };
  nextSplit?: NextSplitView;
  predictedCheckpoints?: PredictedCheckpointView[];
  prediction?: ProjectedFinishView;
  /** Explicit canonical result; suppression must never fall back to legacy prediction fields. */
  predictionState?: AthletePredictionStateView;
  timeline: TimelineSplit[];
  raceTiming?: AthleteRaceTiming;
  replay: { available: boolean };
};

export function canonicalAthletePresentationIdentity(
  res: AthleteModalResponse,
): string | null {
  const athlete = asRecord(res.athlete);
  const live = asRecord(res.participantLive);
  const participantUuid = firstText(
    athlete.participantUuid,
    live.participantUuid,
  );
  const providerEventUuid = normalizeProviderEventUuid(
    firstText(
      athlete.providerEventUuid,
      live.providerEventUuid,
      participantUuid.match(/^race:([^:]+):/i)?.[1],
    ),
  );
  if (!participantUuid || !providerEventUuid) return null;
  return [
    firstText(res.eventId),
    providerEventUuid,
    participantUuid.toLowerCase(),
  ].join(":");
}

function athleteStartTimestamp(res: AthleteModalResponse): number | undefined {
  const athlete = res.athlete as Record<string, unknown>;
  const live = (res.participantLive ?? {}) as Record<string, unknown>;
  if (!hasStartedEvidence(res)) return undefined;
  const resolved = freshestResolvedState(res);
  const canonicalStartTiming = asRecord(resolved.startTiming);
  const liveStartTiming = asRecord(live.startTiming);
  const acceptedStartSplit = acceptedMobileSplits(res).find(isRaceStartSplit);
  const acceptedStartReadAt = acceptedStartSplit
    ? (acceptedStartSplit.readAt ??
      acceptedStartSplit.acceptedAt ??
      acceptedStartSplit.acceptedTimestamp ??
      acceptedStartSplit.absoluteTimestamp ??
      acceptedStartSplit.timestamp ??
      acceptedStartSplit.occurredAt)
    : undefined;
  const timingMode = text(
    resolved.officialTimingMode ??
      resolved.timingMode ??
      resolved.startTimingMode ??
      canonicalStartTiming.officialTimingMode ??
      canonicalStartTiming.mode ??
      canonicalStartTiming.startTimeSource ??
      liveStartTiming.officialTimingMode ??
      liveStartTiming.mode ??
      liveStartTiming.startTimeSource ??
      athlete.startTimingMode,
  ).toUpperCase();
  const canonicalCandidates =
    timingMode === "CHIP"
      ? [
          resolved.acceptedChipStartAt,
          resolved.acceptedStartAt,
          resolved.startReaderAt,
          canonicalStartTiming.chipStartAt,
          canonicalStartTiming.acceptedChipStartAt,
          canonicalStartTiming.chipStartDetectionTime,
          canonicalStartTiming.acceptedStartAt,
          canonicalStartTiming.startReaderAt,
          liveStartTiming.chipStartAt,
          liveStartTiming.acceptedChipStartAt,
          liveStartTiming.chipStartDetectionTime,
          liveStartTiming.acceptedStartAt,
          liveStartTiming.startReaderAt,
          acceptedStartReadAt,
        ]
      : timingMode === "WAVE"
        ? [
            resolved.officialWaveStartAt,
            resolved.athleteStartTimeUtc,
            resolved.athleteStartTime,
          ]
        : [
            resolved.officialGunStartAt,
            resolved.gunStartTimeUtc,
            resolved.gunStartTime,
            resolved.athleteStartTimeUtc,
            resolved.athleteStartTime,
          ];
  const candidates =
    timingMode === "CHIP"
      ? [
          ...canonicalCandidates,
          athlete.chipStartTime,
          athlete.firstTimingReadAt,
          live.chipStartTime,
          live.firstTimingReadAt,
        ]
      : [
          ...canonicalCandidates,
          athlete.chipStartTime,
          athlete.startedAt,
          athlete.startTime,
          athlete.raceStartTime,
          athlete.gunStartTime,
          athlete.scheduledStartTime,
          athlete.firstTimingReadAt,
          live.chipStartTime,
          live.startedAt,
          live.startTime,
          live.raceStartTime,
          live.gunStartTime,
          live.scheduledStartTime,
          live.firstTimingReadAt,
        ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value < 10_000_000_000 ? value * 1_000 : value;
    }
    if (typeof value !== "string" || !value.trim()) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0)
      return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

/** Backwards-friendly alias used across the tracking feature. */
export type AthleteDetailViewModel = AthleteDetailView;

function toRaceStatus(status?: string): RaceStatus | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  const terminalStatus = s.match(/\b(dnf|dns|dnq|dsq)\b/)?.[1];
  if (terminalStatus) return terminalStatus as RaceStatus;
  if (s.includes("did not finish")) return "dnf";
  if (s.includes("did not start")) return "dns";
  if (s.includes("finish") || s.includes("complete")) return "finished";
  if (s.includes("not")) return "notStarted";
  if (
    s.includes("upcoming") ||
    s.includes("waiting") ||
    s.includes("pending") ||
    s.includes("scheduled")
  )
    return "upcoming";
  if (
    s.includes("live") ||
    s.includes("started") ||
    s.includes("course") ||
    s.includes("racing")
  )
    return "live";
  return undefined;
}

const RACE_STATUS_LABEL: Record<RaceStatus, string> = {
  live: "LIVE",
  finished: "FINISHED",
  upcoming: "EVENT NOT STARTED",
  notStarted: "NOT STARTED",
  dnf: "DNF",
  dns: "DNS",
  dnq: "DNQ",
  dsq: "DSQ",
};

function positiveStartValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  const raw = text(value);
  if (!raw || raw === "0" || raw === "—" || raw === "-") return false;
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw) > 0;
  return !Number.isNaN(Date.parse(raw));
}

function eventStartIsFuture(
  athlete: Record<string, unknown>,
  res: AthleteModalResponse,
): boolean {
  const raw = text(
    athlete.scheduledStart ??
      athlete.eventStartTime ??
      athlete.startWindow ??
      athlete.raceStartTime ??
      athlete.eventDate ??
      (res as Record<string, unknown>).scheduledStart,
  );
  if (!raw) return false;
  const parsed = Date.parse(raw);
  return !Number.isNaN(parsed) && parsed > Date.now();
}

function isAcceptedMobileSplit(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const split = value as Record<string, unknown>;
  const elapsed = numberValue(
    split.overallElapsedSeconds ?? split.elapsedSeconds ?? split.time,
  );
  return hasAcceptedSplitEvidence(split) && elapsed != null && elapsed >= 0;
}

function acceptedMobileSplits(
  res: AthleteModalResponse,
): Record<string, unknown>[] {
  const live = asRecord(res.participantLive);
  const resolved = freshestResolvedState(res);
  return [
    ...asRecordArray(resolved.splits),
    ...asRecordArray(live.splits),
    ...asRecordArray(res.athlete?.splits),
  ].filter(isAcceptedMobileSplit);
}

function freshestResolvedState(
  res: AthleteModalResponse,
): Record<string, unknown> {
  const candidates = [
    asRecord(res.participantLive).resolvedRaceState,
    asRecord(res.athlete).resolvedRaceState,
  ]
    .map(asRecord)
    .filter((value) => Object.keys(value).length > 0);
  return (
    candidates.sort((left, right) => {
      const versionDelta =
        (numberValue(right.timingVersion) ?? -1) -
        (numberValue(left.timingVersion) ?? -1);
      if (versionDelta) return versionDelta;
      const accepted = (value: Record<string, unknown>) =>
        asRecordArray(value.splits).filter(isAcceptedMobileSplit).length;
      const acceptedDelta = accepted(right) - accepted(left);
      if (acceptedDelta) return acceptedDelta;
      const updated = (value: Record<string, unknown>) =>
        Date.parse(
          text(
            value.updatedAt ??
              value.resultUpdatedAt ??
              value.lastOfficialReadAt,
          ),
        );
      return (
        (Number.isFinite(updated(right)) ? updated(right) : -1) -
        (Number.isFinite(updated(left)) ? updated(left) : -1)
      );
    })[0] || {}
  );
}

function isRaceStartSplit(split: Record<string, unknown>): boolean {
  if (split.isRaceStart === true) return true;
  const key = normalizeKey(
    text(
      split.splitKey ??
        split.key ??
        split.canonicalSplitKey ??
        split.name ??
        split.displayName,
    ),
  );
  // Leg starts such as bike_start and run_start are not race starts.
  return key === "start" || key === "race_start" || key === "swim_start";
}

function hasReachedSplit(res: AthleteModalResponse): boolean {
  return acceptedMobileSplits(res).length > 0;
}

function hasStartedEvidence(res: AthleteModalResponse): boolean {
  const athlete = res.athlete as Record<string, unknown>;
  const live = (res.participantLive ?? {}) as Record<string, unknown>;
  const resolved = freshestResolvedState(res);
  const resolvedTimingState = text(
    resolved.status ??
      resolved.timingState ??
      live.timingState ??
      live.raceStatus,
  )
    .trim()
    .toUpperCase();
  const canonicalStartTiming = asRecord(resolved.startTiming);
  const liveStartTiming = asRecord(live.startTiming);

  // Processed Feibot timing can update participantLive before a versioned
  // canonical snapshot is rebuilt. An explicitly accepted race START row is
  // stronger evidence than a stale WAITING_START flag in that older snapshot.
  // This deliberately excludes Bike Start / Run Start boundaries.
  const acceptedStartSplit = acceptedMobileSplits(res).find(isRaceStartSplit);
  if (acceptedStartSplit) return true;

  // A later accepted timing point is also conclusive start evidence. This
  // matters while an older resolved snapshot still says WAITING_CHIP_START:
  // an athlete cannot validly reach a later split without starting.
  if (hasReachedSplit(res)) return true;

  const acceptedCanonicalStart = [canonicalStartTiming, liveStartTiming].some(
    (startTiming) =>
      startTiming.hasAcceptedStart === true ||
      Boolean(text(startTiming.acceptedReadId)) ||
      Boolean(text(startTiming.startPassageId)) ||
      (startTiming.startTimeLocked === true &&
        /ON_COURSE|FINISHED/.test(
          text(startTiming.startStatus).toUpperCase(),
        ) &&
        // A locked configured gun time says nothing about an individual
        // athlete crossing START. Only a captured chip detection can be used
        // as accepted-start evidence here.
        positiveStartValue(startTiming.chipStartDetectionTime)),
  );
  if (acceptedCanonicalStart) return true;

  // A canonical reset deliberately leaves scheduled GUN/WAVE configuration in
  // place. Those configured timestamps are not athlete start evidence.
  if (
    resolved.hasAcceptedStart === false ||
    /WAITING_START|NOT_STARTED|REGISTERED/.test(resolvedTimingState)
  ) {
    return false;
  }
  if (
    resolved.hasStarted === true ||
    resolved.hasAcceptedStart === true ||
    positiveStartValue(resolved.acceptedStartAt) ||
    positiveStartValue(resolved.acceptedChipStartAt) ||
    positiveStartValue(resolved.startReaderAt)
  ) {
    return true;
  }

  const startCandidates = [
    athlete.startedAt,
    athlete.chipStartTime,
    athlete.firstSeenAt,
    athlete.firstTimingReadAt,
    live.startedAt,
    live.chipStartTime,
    live.firstSeenAt,
    live.firstTimingReadAt,
  ];
  const canonicalStateMissing =
    Object.keys(resolved).length === 0 && !resolvedTimingState;
  return (
    canonicalStateMissing &&
    (startCandidates.some(positiveStartValue) || hasReachedSplit(res))
  );
}

function hasPublishedOfficialFinish(res: AthleteModalResponse): boolean {
  const result = asRecord(res.result);
  const status = text(result.status).toUpperCase();
  return (
    status === "FINISHED" &&
    [result.officialTime, result.chipTime, result.gunTime].some(
      (value) => parseFinishDurationSeconds(value) != null,
    )
  );
}

/** Compact mobile-live terminal proof when a provider finish split cannot be
 * matched back to the configured final split identity. A status flag alone is
 * deliberately insufficient: the canonical projection must also provide the
 * accepted finish timestamp and the frozen positive race duration. */
function hasCanonicalTerminalTimestamp(res: AthleteModalResponse): boolean {
  const resolved = freshestResolvedState(res);
  const status = text(resolved.status ?? resolved.timingState).toUpperCase();
  const finishAt = text(resolved.finishAt ?? resolved.finishTimeUtc);
  const finalElapsedMs = numberValue(
    resolved.finalElapsedMs ??
      resolved.officialResultElapsedMs ??
      resolved.officialElapsedMs,
  );
  return (
    status === "FINISHED" &&
    Boolean(finishAt) &&
    finalElapsedMs != null &&
    finalElapsedMs > 0
  );
}

/** Single athlete-facing race-state resolver used by cards, detail and polling. */
export function resolveAthleteRaceState(res: AthleteModalResponse): {
  status: RaceStatus;
  label: string;
} {
  const athlete = res.athlete as Record<string, unknown>;
  const rawStatus =
    text(athlete.status) ||
    text(athlete.lifecycleLabel) ||
    text(athlete.registrationStatus);
  const normalized = rawStatus.toUpperCase();
  const live = (res.participantLive ?? {}) as Record<string, unknown>;
  const resolved = freshestResolvedState(res);
  const canonicalTimingState = text(
    resolved.status ??
      resolved.timingState ??
      live.timingState ??
      live.raceStatus,
  )
    .trim()
    .toUpperCase();
  const canonicalStatusSource = text(
    resolved.statusSource ??
      live.statusSource ??
      (res.result as Record<string, unknown> | null | undefined)?.statusSource,
  )
    .trim()
    .toUpperCase();
  // Feibot's accepted START passage is stronger than a stale automatic DNS
  // retained by an older hot row. Other manual terminal states stay intact.
  if (
    canonicalTimingState === "DNS" &&
    canonicalStatusSource !== "MANUAL_OVERRIDE" &&
    hasStartedEvidence(res)
  ) {
    return { status: "live", label: RACE_STATUS_LABEL.live };
  }
  // A completed, accepted finish passage is stronger than a stale
  // WAITING_CHIP_START / ON_COURSE snapshot. Do not use a bare legacy status
  // here: hasCanonicalFinishEvidence requires canonical finish evidence.
  if (
    !["DNF", "DNS", "DNQ", "DSQ"].includes(canonicalTimingState) &&
    (hasPublishedOfficialFinish(res) ||
      hasCanonicalFinishEvidence(res.result) ||
      hasCanonicalTerminalTimestamp(res) ||
      hasAcceptedTerminalCourseFinish(res))
  ) {
    return { status: "finished", label: RACE_STATUS_LABEL.finished };
  }
  // Canonical race state is authoritative. A legacy athlete row can retain an
  // old DNS value after a reset and must not override WAITING_CHIP_START.
  if (["DNF", "DNS", "DNQ", "DSQ"].includes(canonicalTimingState)) {
    return {
      status: canonicalTimingState.toLowerCase() as RaceStatus,
      label: canonicalTimingState,
    };
  }
  if (canonicalTimingState === "FINISHED") {
    // A raw/hot FINISHED flag without the canonical result's accepted final
    // split is diagnostic only. Preserve confirmed progression as ACTIVE.
    return hasStartedEvidence(res)
      ? { status: "live", label: RACE_STATUS_LABEL.live }
      : { status: "notStarted", label: RACE_STATUS_LABEL.notStarted };
  }
  if (canonicalTimingState === "ON_COURSE") {
    return { status: "live", label: RACE_STATUS_LABEL.live };
  }
  if (canonicalTimingState === "WAITING_CHIP_START") {
    if (hasStartedEvidence(res)) {
      return { status: "live", label: RACE_STATUS_LABEL.live };
    }
    return { status: "notStarted", label: "WAITING TO START" };
  }
  if (/WAITING_START|NOT_STARTED|REGISTERED/.test(canonicalTimingState)) {
    return { status: "notStarted", label: RACE_STATUS_LABEL.notStarted };
  }
  if (["DNF", "DNS", "DNQ", "DSQ"].includes(normalized)) {
    return {
      status: normalized.toLowerCase() as RaceStatus,
      label: normalized,
    };
  }

  const explicit = toRaceStatus(rawStatus);
  if (explicit === "finished" && hasPublishedOfficialFinish(res))
    return { status: "finished", label: RACE_STATUS_LABEL.finished };
  if (hasStartedEvidence(res))
    return { status: "live", label: RACE_STATUS_LABEL.live };
  if (eventStartIsFuture(athlete, res) || explicit === "upcoming")
    return { status: "upcoming", label: RACE_STATUS_LABEL.upcoming };
  return { status: "notStarted", label: RACE_STATUS_LABEL.notStarted };
}

export function mapLeaderboardRows(rows: LeaderboardRow[]): LeaderboardEntry[] {
  const mapped = rows.map((row) => {
    const raw = row as Record<string, unknown>;
    const rawName = text(raw.fullName) || row.name;
    const rawPhoto =
      firstText(
        raw.profilePhotoUrl,
        raw.photoUrl,
        raw.photoURL,
        raw.avatarUrl,
        raw.displayPhoto,
      ) || undefined;
    const visibility =
      raw.trackingVisibility ??
      raw.liveTrackingPrivacy ??
      row.liveTrackingVisibility ??
      row.visibility;
    const viewerCanSeeIdentity =
      raw.viewerCanSeeIdentity === true || raw.privacyMasked === false;
    const anonymous =
      !viewerCanSeeIdentity &&
      String(visibility || "").toUpperCase() === "ANONYMOUS";
    const hidden =
      !viewerCanSeeIdentity &&
      (anonymous || String(visibility || "").toUpperCase() === "PRIVATE");
    const anonymousKey = `anonymous:${row.rank ?? "unranked"}:${row.contest ?? "contest"}:${recordText(raw, ["category", "ageGroupName"]) || "all"}`;
    return {
      // id doubles as the navigation key (bib) so rows can open athlete detail.
      id: anonymous ? anonymousKey : row.bib || row.athleteId,
      rank: row.rank,
      // Backend-anonymized name wins; the client never anonymizes itself.
      name: anonymous ? "Anonymous" : (row.displayName ?? rawName),
      time: row.overallTime ?? row.gap ?? row.status ?? "—",
      detail:
        [row.contest, recordText(raw, ["category", "ageGroupName"])]
          .filter(Boolean)
          .join(" · ") || undefined,
      // Global profile photo (defensively hidden if not public); deterministic
      // color seed per athlete.
      avatarUri: hidden ? undefined : (row.profilePhotoUrl ?? rawPhoto),
      avatarSeed: row.athleteId || row.bib,
      row: raw,
    };
  });
  debugApiLog("[tracking.mappers] mapped leaderboard row count", mapped.length);
  return mapped;
}

export function mapAthleteMatches(
  matches: AthleteSearchMatch[],
): AthleteSummary[] {
  const mapped = matches.map((m) => {
    const raw = m as Record<string, unknown>;
    const rawName = text(raw.fullName) || m.name;
    const rawPhoto =
      firstText(
        raw.profilePhotoUrl,
        raw.photoUrl,
        raw.photoURL,
        raw.avatarUrl,
        raw.displayPhoto,
      ) || undefined;
    const providerUuid =
      m.providerUuid ??
      m.providerAthleteUuid ??
      m.providerTimingUuid ??
      m.providerRecordId ??
      m.bookingId ??
      m.athleteUid ??
      m.athleteId ??
      m.bib;
    return {
      id: providerUuid,
      bib: m.bib,
      name: m.displayName ?? rawName,
      category: m.contestName ?? m.contest ?? m.category,
      ageGroup: m.ageGroupName ?? m.ageGroup,
      club: m.clubName ?? m.club,
      status: toRaceStatus(m.status),
      photoUrl:
        (raw.trackingVisibility ??
          raw.liveTrackingPrivacy ??
          m.liveTrackingVisibility ??
          m.visibility) === "ANONYMOUS"
          ? undefined
          : (m.profilePhotoUrl ?? rawPhoto),
      providerUuid,
      providerAthleteUuid: m.providerAthleteUuid ?? undefined,
      providerTimingUuid: m.providerTimingUuid ?? undefined,
      providerRecordId: m.providerRecordId ?? undefined,
      athleteUid: m.athleteUid ?? undefined,
      bookingId: m.bookingId ?? undefined,
      participantUuid: m.participantUuid ?? undefined,
      providerEventUuid:
        m.providerEventUuid ??
        m.participantUuid?.match(/^race:([^:]+):/i)?.[1] ??
        undefined,
      providerContestUuid: m.contestUuid ?? undefined,
      canonicalContestUuid: m.contestUuid ?? undefined,
      email: text(raw.email) || undefined,
    };
  });
  const unique = new Map<string, AthleteSummary>();
  for (const athlete of mapped) {
    const key =
      athlete.providerUuid ||
      athlete.providerAthleteUuid ||
      athlete.providerTimingUuid ||
      athlete.providerRecordId ||
      athlete.bookingId ||
      athlete.athleteUid ||
      `${athlete.bib}-${athlete.category ?? ""}`;
    if (!unique.has(key)) {
      unique.set(key, athlete);
    }
  }
  const deduped = [...unique.values()];
  debugApiLog("[tracking.mappers] athlete match count", deduped.length);
  return deduped;
}

const DASH = "—";

function formatSpeedKmh(value?: number): string {
  return Number.isFinite(value) && (value as number) > 0
    ? `${(value as number).toFixed(2)} km/h`
    : DASH;
}

function formatPercent(fraction?: number): string {
  if (!Number.isFinite(fraction)) return DASH;
  return `${Math.round((fraction as number) * 100)}%`;
}

/** Prediction trust → signal-badge kind (HIGH=official, MEDIUM=estimated, LOW=waiting). */
function confidenceSignal(confidence?: "HIGH" | "MEDIUM" | "LOW"): SignalKind {
  if (confidence === "HIGH") return "official";
  if (confidence === "MEDIUM") return "estimated";
  return "waiting";
}

function resolveProviderRaceCategory(
  res: AthleteModalResponse,
): string | undefined {
  const contestDefinition = asRecord(res.contestDefinition);
  const contestContext = asRecord(res.contestContext?.contest);
  const direct =
    recordText(contestDefinition, [
      "raceType",
      "sport",
      "TypeOfSport",
      "typeOfSport",
    ]) ||
    recordText(contestContext, [
      "raceType",
      "sport",
      "TypeOfSport",
      "typeOfSport",
    ]);
  if (direct) return direct;

  const splits = [contestDefinition.splits, contestContext.splits]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map(asRecord);
  const sports = new Set(
    splits
      .flatMap((split) => {
        const raw = asRecord(split.raw);
        const nestedRaw = asRecord(raw.raw);
        return [
          recordText(split, ["sport", "TypeOfSport", "typeOfSport"]),
          recordText(raw, ["sport", "TypeOfSport", "typeOfSport"]),
          recordText(nestedRaw, ["sport", "TypeOfSport", "typeOfSport"]),
        ];
      })
      .map((value) => text(value).toLowerCase())
      .filter(Boolean),
  );
  if (sports.size === 1) return Array.from(sports)[0];
  const joined = Array.from(sports).join(" ");
  if (
    joined.includes("swim") &&
    joined.includes("bike") &&
    joined.includes("run")
  )
    return "Triathlon";
  if (joined.includes("swim") && joined.includes("run")) return "Aquathlon";
  return undefined;
}

function mapHeader(
  res: AthleteModalResponse,
  visibility: Visibility,
): AthleteHeaderView {
  const athlete = res.athlete as Record<string, unknown>;
  const officialResult = (res.result ?? {}) as Record<string, unknown>;
  const participantLive = asRecord(res.participantLive);
  const participantIdentity = asRecord(participantLive.identity);
  const contestContext = res.contestContext?.contest as
    Record<string, unknown> | undefined;
  const contestDefinition = asRecord(res.contestDefinition);
  const ticketDefinition = asRecord(res.ticketDefinition);
  const providerRaceCategory = resolveProviderRaceCategory(res);
  const resolvedStatus = resolveAthleteRaceState(res);
  const anonymous = visibility === "ANONYMOUS";

  const club = anonymous
    ? undefined
    : recordText(athlete, ["club", "clubName", "displayClub"]) ||
      recordText(officialResult, [
        "club",
        "clubName",
        "clubNameAtRace",
        "displayClub",
      ]) ||
      recordText(participantIdentity, ["clubName", "club", "displayClub"]);
  const displayClub = /^(?:n\/?a|none|null|undefined|-)$/i.test(club ?? "")
    ? undefined
    : club;
  const country = anonymous
    ? undefined
    : recordText(athlete, ["country", "displayCountry"]) ||
      recordText(officialResult, [
        "country",
        "displayCountry",
        "countryName",
        "countryAtRace",
        "nationality",
        "countryCode",
      ]) ||
      recordText(participantIdentity, [
        "country",
        "countryName",
        "countryCode",
        "nationality",
      ]);
  const location = anonymous
    ? undefined
    : recordText(athlete, ["displayLocation"]) ||
      [athlete.city, athlete.state, athlete.country]
        .map(text)
        .filter(Boolean)
        .join(", ") ||
      undefined;
  const photo = anonymous
    ? undefined
    : recordText(athlete, [
        "photoURL",
        "photoUrl",
        "profilePhotoUrl",
        "avatarUrl",
        "displayPhoto",
      ]) ||
      recordText(participantIdentity, [
        "profilePhotoUrl",
        "photoUrl",
        "photoURL",
        "avatarUrl",
        "displayPhoto",
      ]) ||
      recordText(officialResult, [
        "profilePhotoUrl",
        "photoUrl",
        "photoURL",
        "avatarUrl",
        "displayPhoto",
      ]);

  return {
    name: anonymous
      ? "Anonymous Athlete"
      : (recordText(athlete, ["name", "fullName", "displayName"]) ?? "Athlete"),
    photo: photo ?? undefined,
    email: anonymous
      ? undefined
      : recordText(athlete, ["email"]) || recordText(officialResult, ["email"]),
    athleteUid: anonymous
      ? undefined
      : recordText(athlete, ["athleteUid", "uid", "id"]) ||
        recordText(officialResult, ["athleteUid", "uid", "id"]),
    colorSeed: anonymous
      ? "anonymous-athlete"
      : text(athlete.id) || text(athlete.bib),
    bib: anonymous ? DASH : (recordText(athlete, ["bib"]) ?? DASH),
    contest:
      recordText(athlete, ["contestName", "contest"]) ||
      recordText(contestContext, ["name", "contestName"]),
    raceCategory:
      recordText(ticketDefinition, [
        "ticketCategory",
        "raceCategory",
        "category",
      ]) ||
      providerRaceCategory ||
      recordText(contestDefinition, [
        "ticketCategory",
        "raceCategory",
        "raceType",
        "sport",
      ]) ||
      recordText(contestContext, [
        "ticketCategory",
        "raceCategory",
        "raceType",
        "sport",
      ]) ||
      recordText(athlete, ["ticketCategory", "raceCategory", "raceType"]),
    category:
      recordText(athlete, [
        "ageGroupName",
        "ageGroup",
        "ageCategory",
        "categoryName",
        "category",
      ]) ||
      recordText(officialResult, ["ageGroupName", "ageGroup", "ageCategory"]) ||
      recordText(participantIdentity, ["ageGroupName", "ageGroup"]),
    gender: anonymous ? undefined : recordText(athlete, ["gender"]),
    club: displayClub,
    countryFlag: getCountryFlagEmoji(country) || undefined,
    location,
    registrationStatus: anonymous
      ? undefined
      : recordText(athlete, ["registrationStatus"]),
    eventName:
      recordText(athlete, ["eventName"]) ||
      recordText(participantIdentity, ["eventName"]) ||
      recordText(asRecord(res as unknown), ["eventName"]),
    eventDate:
      recordText(athlete, ["eventDate", "raceDate"]) ||
      recordText(ticketDefinition, ["raceDate", "eventDate", "date"]),
    scheduledStart: scheduledStartFromTicket(athlete, ticketDefinition),
    anonymous,
    status: resolvedStatus.status,
    statusLabel: resolvedStatus.label,
  };
}

/**
 * Normalize a privacy value exactly like the web app's
 * `normalizeLiveTrackingPrivacy` (`lib/liveTrackingPrivacy.ts`): legacy
 * PRIVATE/OFFICIALS_ONLY and ANON all resolve to ANONYMOUS.
 */
function normalizeLiveTrackingPrivacy(value: unknown): Visibility | undefined {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!raw) return undefined;
  if (raw === "PRIVATE" || raw === "OFFICIALS_ONLY" || raw === "OFFICIALS ONLY")
    return "ANONYMOUS";
  if (raw === "ANONYMOUS" || raw === "ANON") return "ANONYMOUS";
  return "PUBLIC";
}

/**
 * Resolve effective visibility. Account-level fields win so a stale
 * registration-level PUBLIC value cannot override an account-level ANONYMOUS.
 */
function resolveVisibility(res: AthleteModalResponse): Visibility {
  const a = res.athlete as Record<string, unknown>;
  const root = res as unknown as Record<string, unknown>;
  if (
    a.viewerCanSeeIdentity === true ||
    a.privacyMasked === false ||
    root.viewerCanSeeIdentity === true ||
    root.privacyMasked === false
  ) {
    return "PUBLIC";
  }
  const candidates: unknown[] = [
    a.trackingVisibility,
    a.liveTrackingPrivacy,
    root.trackingVisibility,
    root.liveTrackingPrivacy,
    a.liveTrackingVisibility,
    a.visibility,
    res.liveTrackingVisibility,
    res.visibility,
  ];
  for (const candidate of candidates) {
    const privacy = normalizeLiveTrackingPrivacy(candidate);
    if (privacy === "ANONYMOUS") return "ANONYMOUS";
  }
  return "PUBLIC";
}

function mapRankings(a: AthleteModalResponse["athlete"]): MetricRow[] {
  const ranks: MetricRow[] = [];
  if (a.overallRank != null)
    ranks.push({ label: "Overall", value: String(a.overallRank) });
  if (a.genderRank != null)
    ranks.push({ label: "Gender", value: String(a.genderRank) });
  if (a.ageGroupRank != null)
    ranks.push({ label: "Age Group", value: String(a.ageGroupRank) });
  if (a.clubRank != null)
    ranks.push({ label: "Club", value: String(a.clubRank) });
  return ranks;
}

function mapLiveStats(
  a: AthleteModalResponse["athlete"],
  live?: ParticipantLive,
  suppressPrediction = false,
): MetricRow[] {
  const stats: MetricRow[] = [];
  const resolved = asRecord(live?.resolvedRaceState);
  const elapsedMs = numberValue(
    resolved.officialElapsedMs ??
      resolved.liveOverallElapsedMs ??
      resolved.officialRaceElapsedMs ??
      resolved.athleteElapsedMs,
  );
  const predictedPace = numberValue(
    live?.predictedPaceSecondsPerKm ?? resolved.predictedPaceSecondsPerKm,
  );
  const elapsed =
    elapsedMs != null && elapsedMs >= 0
      ? formatSecondsToHMS(elapsedMs / 1000)
      : a.elapsedTime;
  const pace =
    a.currentPace ||
    (predictedPace != null
      ? `${Math.floor(predictedPace / 60)}:${String(Math.round(predictedPace % 60)).padStart(2, "0")} /km`
      : undefined);
  const averagePace = a.averagePace || live?.averagePaceLabel || pace;
  const estimatedFinishRaw = suppressPrediction
    ? undefined
    : a.estimatedFinish ||
      live?.estimatedFinishTime ||
      live?.etaFinishClock ||
      text(resolved.estimatedFinishTime);
  const estimatedFinish = estimatedFinishRaw
    ? formatClockTime(
        estimatedFinishRaw,
        eventTimezoneForResponse({
          athlete: a,
          participantLive: live,
        } as AthleteModalResponse),
      )
    : undefined;
  if (elapsed) stats.push({ label: "Elapsed", value: elapsed });
  if (pace) stats.push({ label: "Pace", value: pace });
  if (averagePace) stats.push({ label: "Avg Pace", value: averagePace });
  if (estimatedFinish)
    stats.push({ label: "Est. Finish", value: estimatedFinish });
  return stats;
}

function mapCourseOverview(res: AthleteModalResponse): MetricRow[] {
  const co = res.courseOverview;
  if (!co) return [];
  if (Array.isArray(co.breakdown) && co.breakdown.length > 0) {
    return co.breakdown
      .filter(
        (item) =>
          Number.isFinite(item.distanceKm) && Number(item.distanceKm) > 0,
      )
      .map((item) => ({
        label: item.label,
        value: formatDistanceKm(item.distanceKm) ?? DASH,
      }));
  }
  const rows: [string, number | undefined][] = [
    ["Swim", co.swimKm],
    ["Bike", co.bikeKm],
    ["Run", co.runKm],
    ["Run 1", co.run1Km],
    ["Run 2", co.run2Km],
    ["Total", co.totalKm],
  ];
  return rows
    .filter(([, v]) => Number.isFinite(v) && (v as number) > 0)
    .map(([label, v]) => ({ label, value: formatDistanceKm(v) ?? DASH }));
}

function mapRaceProgress(
  res: AthleteModalResponse,
): RaceProgressView | undefined {
  const a = res.athlete;
  const resolvedRaceState = freshestResolvedState(res);
  const ticketDefinition = asRecord(res.ticketDefinition);
  const contestDefinition = asRecord(res.contestDefinition);
  const contestContext = asRecord(res.contestContext?.contest);
  const providerRaceCategory = resolveProviderRaceCategory(res);
  const latestAcceptedDistance = acceptedMobileSplits(res)
    .map(normalizeReachedSplit)
    .filter((split): split is Split => Boolean(split))
    .reduce((latest, split) => Math.max(latest, split.distance), 0);
  const officialCovered = Math.max(
    Number(
      resolvedRaceState.officialDistanceKm ??
        a.distanceCoveredKm ??
        res.participantLive?.distanceCoveredKm ??
        0,
    ) || 0,
    latestAcceptedDistance,
  );
  const estimatedCovered = numberValue(resolvedRaceState.estimatedDistanceKm);
  // Prediction may be stale or absent, but it must never place the athlete
  // behind their latest accepted official timing point.
  const covered = Math.max(
    officialCovered,
    estimatedCovered ?? officialCovered,
  );
  const publishedTotal =
    res.courseOverview?.totalKm ??
    res.courseOverview?.breakdown?.reduce(
      (total, item) => total + (Number(item.distanceKm) || 0),
      0,
    );
  const total =
    Number(resolvedRaceState.totalDistanceKm) > 0
      ? Number(resolvedRaceState.totalDistanceKm)
      : publishedTotal && publishedTotal > 0
        ? publishedTotal
        : covered +
          Number(
            a.distanceRemainingKm ??
              res.participantLive?.distanceRemainingKm ??
              0,
          );
  if (!Number.isFinite(total) || total <= 0) return undefined;
  const remaining = Math.max(0, total - covered);
  const resolvedProgress = Number(resolvedRaceState.estimatedProgressRatio);
  // A stale snapshot can retain a 0 prediction after the live overlay has
  // accepted a split. Never display the athlete back at the start in that
  // case; the accepted timing distance is authoritative for presentation.
  const progress =
    Number.isFinite(resolvedProgress) && (resolvedProgress > 0 || covered <= 0)
      ? Math.min(1, Math.max(0, resolvedProgress))
      : Math.min(1, Math.max(0, covered / total));
  return {
    legLabel: (
      text(
        resolvedRaceState.currentLeg ??
          resolvedRaceState.currentLegName ??
          a.currentLegName ??
          res.participantLive?.currentLeg ??
          a.contestName ??
          a.contest ??
          "Race",
      ) || "Race"
    ).toUpperCase(),
    raceCategory:
      recordText(ticketDefinition, [
        "ticketCategory",
        "raceCategory",
        "category",
        "raceType",
        "sport",
      ]) ||
      providerRaceCategory ||
      recordText(contestDefinition, [
        "ticketCategory",
        "raceCategory",
        "category",
        "raceType",
        "sport",
      ]) ||
      recordText(contestContext, [
        "ticketCategory",
        "raceCategory",
        "category",
        "raceType",
        "sport",
      ]) ||
      recordText(a, ["ticketCategory", "raceCategory", "raceType"]),
    percentLabel: formatPercent(progress),
    progress,
    coveredLabel: `${formatDistanceKm(covered) ?? "0 km"} done`,
    remainingLabel: `${formatDistanceKm(remaining) ?? "0 km"} left`,
  };
}

function mapLivePosition(
  res: AthleteModalResponse,
): LivePositionView | undefined {
  const live = res.participantLive;
  if (!live) return undefined;
  const items: LivePositionItem[] = [
    {
      label: "Distance Covered",
      value: formatDistanceKm(live.distanceCoveredKm) ?? DASH,
      signal: "estimated",
    },
    {
      label: "Distance Remaining",
      value: formatDistanceKm(live.distanceRemainingKm) ?? DASH,
      signal: "estimated",
    },
    {
      label: "Current Leg",
      value: live.currentLeg || DASH,
      signal: "official",
    },
    {
      label: "Current Split",
      value: live.currentSplit || DASH,
      signal: "official",
    },
    {
      label: "Current Speed",
      value: formatSpeedKmh(live.currentSpeedKmh),
      signal: "estimated",
    },
    {
      label: "Average Speed",
      value: formatSpeedKmh(live.averageSpeedKmh),
      signal: "estimated",
    },
    {
      label: "Average Pace",
      value: live.averagePaceLabel || DASH,
      signal: "estimated",
    },
    {
      label: "ETA Next Split",
      value: formatCountdownFromSeconds(live.etaNextSplitCountdownSec) ?? DASH,
      signal: "estimated",
    },
    {
      label: "Estimated Finish",
      value: live.etaFinishClock || DASH,
      signal: "estimated",
    },
    {
      label: "Last Timing Point",
      value: live.lastTimingPoint || DASH,
      signal: "official",
    },
  ];
  return {
    items,
    predictionConfidence: live.predictionConfidence,
    confidenceSignal: confidenceSignal(live.predictionConfidence),
    source: live.predictionSource,
    updatedAt: live.predictionUpdatedAtLabel,
    cutoffStatus: live.cutoffStatus,
  };
}

function mapLiveLocation(res: AthleteModalResponse): LatLng | undefined {
  const status = resolveAthleteRaceState(res);
  if (status.status !== "finished" && !hasStartedEvidence(res))
    return undefined;
  const athlete = res.athlete as Record<string, unknown>;
  const live = res.participantLive as ParticipantLive | undefined;
  const coords = [live?.predictedLocation, athlete.predictedLocation].find(
    (value): value is LatLng =>
      Boolean(value) &&
      typeof value === "object" &&
      Number.isFinite((value as LatLng).lat) &&
      Number.isFinite((value as LatLng).lng),
  );
  if (coords) return coords;

  const latCandidates = [live?.lat, athlete.lat];
  const lngCandidates = [live?.lng, athlete.lng];
  const lat = latCandidates.find(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  const lng = lngCandidates.find(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (lat == null || lng == null) return undefined;
  return { lat, lng };
}

function mapLifecycle(res: AthleteModalResponse): LifecycleView {
  const a = res.athlete;
  const live = res.participantLive;
  const frozen = Boolean(live?.predictionFrozen);
  const status = resolveAthleteRaceState(res);
  return {
    label: status.label || a.lifecycleLabel,
    predictionStatus: frozen
      ? "🔴 Waiting for official timing"
      : live?.predictionStatus,
    frozen,
    frozenReason: live?.predictionFrozenReason,
  };
}

/** Normalize a label/name for matching (lowercase, strip non-alphanumerics). */
function normalizeKey(value?: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function splitKeyCandidates(
  record: Record<string, unknown>,
  fallback?: string,
): string[] {
  const metadata = asRecord(record.metadata);
  return [
    record.splitKey,
    record.split_key,
    record.splitUuid,
    record.split_uuid,
    metadata.split_uuid,
    record.uuid,
    record.providerId,
    record.providerCode,
    record.timingPointId,
    record.timing_point_id,
    record.rawSplitLabel,
    record.splitName,
    record.split_name,
    record.shortName,
    record.displayName,
    record.custom_display_name,
    record.name,
    record.label,
    record.checkpoint,
    record.timingPoint,
    record.id,
    record.key,
    fallback,
  ]
    .map((value) => normalizeKey(text(value)))
    .filter(Boolean);
}

function isConfiguredSplitRecord(record: Record<string, unknown>): boolean {
  const metadata = asRecord(record.metadata);
  const splitIdentity = text(
    record.splitUuid ??
      record.split_uuid ??
      metadata.split_uuid ??
      record.splitName ??
      record.split_name ??
      record.rawSplitLabel ??
      record.checkpoint ??
      record.timingPoint ??
      record.markerType ??
      record.providerCode,
  );
  if (splitIdentity) return true;
  const hasDistanceOrOrder =
    splitDistanceKm(record) != null ||
    numberValue(
      record.order ??
        record.sortOrder ??
        record.sequence ??
        record.sequenceNumber ??
        record.display_order ??
        record.split_index ??
        record.index,
    ) != null;
  const hasLabel = text(
    record.label ??
      record.name ??
      record.displayName ??
      record.custom_display_name ??
      record.split_name ??
      record.shortName ??
      record.title ??
      record.id ??
      record.uuid,
  );
  if (!hasLabel || !hasDistanceOrOrder) return false;
  const wrapperKeys = [
    "contests",
    "contestIndex",
    "splitsByContest",
    "legs",
    "legIndex",
    "courseMaps",
    "data",
    "rows",
    "items",
    "list",
  ];
  return !wrapperKeys.some(
    (key) =>
      Array.isArray(record[key]) ||
      (record[key] && typeof record[key] === "object"),
  );
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/[^\d.:-]/g, "");
  if (!cleaned) return undefined;
  if (cleaned.includes(":")) {
    const parts = cleaned.split(":").map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part))) return undefined;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatCutoffMinutes(value: unknown): string | undefined {
  const minutes = numberValue(value);
  if (minutes == null) return undefined;
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}m cutoff` : `${h}h cutoff`;
  }
  return `${Math.round(minutes)}m cutoff`;
}

function normalizeReachedSplit(value: unknown): Split | undefined {
  if (!isAcceptedMobileSplit(value)) return undefined;
  const record = value as Record<string, unknown>;
  const rawTime =
    record.time ??
    record.timeSec ??
    record.elapsedSeconds ??
    record.elapsedTime ??
    record.duration;
  const time = numberValue(rawTime);
  // An accepted START has elapsedSeconds = 0 and is an official result, not a
  // missing value. Keep it so compact and expanded timelines share the same
  // canonical start state.
  if (time == null || time < 0) return undefined;
  const distance =
    numberValue(
      record.cumulativeDistanceKm ??
        record.cumulativeRaceDistanceKm ??
        record.overallDistanceKm ??
        record.distance ??
        record.distanceKm ??
        record.km,
    ) ?? 0;
  const name =
    record.name ??
    record.displayName ??
    record.splitName ??
    record.label ??
    record.split ??
    record.checkpoint ??
    record.timingPoint;
  const segment = record.segment ?? record.legType ?? record.leg ?? name;
  const absoluteTimestamp = timestampValue(
    record.absoluteTimestamp ??
      record.readAt ??
      record.acceptedAt ??
      record.acceptedTimestamp ??
      record.timestamp ??
      record.occurredAt ??
      record.providerTimestamp ??
      record.readTimestamp ??
      record.timingPointTime ??
      record.detectedAt ??
      record.timeOfDay ??
      record.clockTime,
  );
  return {
    segment: text(segment) || text(name) || "Split",
    name: text(name) || text(segment) || "Split",
    distance,
    time,
    absoluteTimestamp,
  };
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value))
    return value > 10_000_000_000 ? value : value * 1000;
  const raw = text(value);
  if (!raw) return undefined;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function formatClockTime(value: unknown, eventTimezone = "UTC"): string {
  const raw = text(value);
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
    const [hourText = "0", minute = "00", second = "00"] = raw.split(":");
    const hour = Number(hourText);
    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute.padStart(2, "0")}:${second.padStart(2, "0")} ${period}`;
  }
  const ts = timestampValue(value);
  if (ts == null) return DASH;
  return (
    formatCanonicalEventLocalTime(new Date(ts).toISOString(), eventTimezone) ??
    DASH
  );
}

function eventTimezoneForResponse(res: AthleteModalResponse): string {
  const athlete = res.athlete as Record<string, unknown>;
  const participant = asRecord(res.participantLive);
  const resolved = freshestResolvedState(res);
  return firstText(
    resolved.eventTimezone,
    athlete.eventTimezone,
    participant.eventTimezone,
    asRecord(res.contestDefinition).timezone,
    asRecord(res.contestContext?.contest).timezone,
    String(
      athlete.country ?? athlete.countryCode ?? participant.countryCode ?? "",
    ).toUpperCase() === "IN"
      ? "Asia/Kolkata"
      : "UTC",
  );
}

function formatDuration(value: unknown): string {
  const seconds = numberValue(value);
  if (seconds == null || seconds < 0) return DASH;
  return formatSecondsToHMS(seconds);
}

function calculateSplitTime(current?: Split, previous?: Split): string {
  if (!current) return DASH;
  const previousTime = previous?.time ?? 0;
  return formatDuration(Math.max(0, current.time - previousTime));
}

function calculateElapsedTime(current?: Split): string {
  return current ? formatDuration(current.time) : DASH;
}

function splitLegKind(
  value: unknown,
): "swim" | "bike" | "run" | "transition" | "other" {
  const source = normalizeKey(text(value));
  if (source.includes("swim")) return "swim";
  if (source.includes("bike") || source.includes("cycle")) return "bike";
  if (source.includes("run")) return "run";
  if (
    source.includes("t1") ||
    source.includes("t2") ||
    source.includes("transition")
  )
    return "transition";
  return "other";
}

function calculatePaceOrSpeed(
  current?: Split,
  previous?: Split,
  label?: string,
): string {
  if (!current) return DASH;
  const elapsed = current.time - (previous?.time ?? 0);
  const distance = current.distance - (previous?.distance ?? 0);
  if (elapsed <= 0 || distance <= 0) return DASH;
  const kind = splitLegKind(label);
  if (kind === "bike")
    return `${(distance / (elapsed / 3600)).toFixed(1)} km/h`;
  if (kind === "swim") {
    const secPer100m = elapsed / (distance * 10);
    const min = Math.floor(secPer100m / 60);
    const sec = Math.round(secPer100m % 60);
    return `${min}:${String(sec).padStart(2, "0")} /100m`;
  }
  if (kind === "run") {
    const secPerKm = elapsed / distance;
    const min = Math.floor(secPerKm / 60);
    const sec = Math.round(secPerKm % 60);
    return `${min}:${String(sec).padStart(2, "0")} /km`;
  }
  return DASH;
}

function calculateGap(record?: Record<string, unknown>): string {
  if (!record) return DASH;
  const direct = text(
    record.gap ??
      record.gapLabel ??
      record.leaderGap ??
      record.categoryGap ??
      record.deltaTime,
  );
  if (direct)
    return direct.startsWith("+") || direct === DASH ? direct : `+${direct}`;
  return DASH;
}

function normalizeSplitLabel(value: unknown): string {
  return text(value).replace(/\s+/g, " ").trim().toUpperCase();
}

function isGenericTimingPointLabel(value: unknown): boolean {
  return /^timing\s*point(?:\s*\d+)?$/i.test(text(value));
}

function canonicalSplitDisplayName(record: Record<string, unknown>): string {
  const code = normalizeKey(
    text(
      record.key ?? record.canonicalCode ?? record.splitKey ?? record.split_key,
    ),
  );
  const names: Record<string, string> = {
    swimstart: "Start",
    swimfinish: "Swim Finish",
    bikestart: "Bike Start",
    bikefinish: "Bike Finish",
    runstart: "Run Start",
    runfinish: "Run Finish",
    run1start: "Run 1 Start",
    run1finish: "Run 1 Finish",
    run2start: "Run 2 Start",
    run2finish: "Run 2 Finish",
  };
  return names[code] || "";
}

function visibleConfiguredSplitLabel(
  record: Record<string, unknown>,
  candidate: string,
): string {
  const internalIds = [
    record.id,
    record.uuid,
    record.splitUuid,
    record.split_uuid,
    record.providerSplitId,
    record.providerId,
    record.providerCode,
  ]
    .map(text)
    .filter(Boolean);
  const canonical = canonicalSplitDisplayName(record);
  if (!candidate || internalIds.includes(candidate)) return canonical;
  return candidate;
}

function splitDistanceKm(record: Record<string, unknown>): number | undefined {
  const directKm = numberValue(
    record.cumulativeDistanceKm ??
      record.cumulativeRaceDistanceKm ??
      record.overallDistanceKm ??
      record.km_marking ??
      record.distanceKm ??
      record.distance_km,
  );
  if (directKm != null) return directKm;
  const meters = numberValue(record.distanceMeters ?? record.distance_meters);
  if (meters != null) return meters / 1000;
  const distance = numberValue(
    record.distance ??
      record.distanceFromStart ??
      record.distance_from_start ??
      record.DistanceFromStart ??
      record.cumulativeKm ??
      record.cumulative_km ??
      record.cumulativeDistance ??
      record.cumulative_distance ??
      record.km,
  );
  if (distance == null) return undefined;
  const unit = normalizeKey(
    text(
      record.distanceUnit ??
        record.distance_unit ??
        record.DistanceFromStartUnit,
    ),
  );
  if (unit === "m" || unit.includes("meter") || unit.includes("metre"))
    return distance / 1000;
  return distance;
}

function cutoffDisplay(record: Record<string, unknown>): string | undefined {
  const direct = text(
    record.cutoffTime ??
      record.cutoff ??
      record.cutoffHHMMSS ??
      record.cumulativeCutoffTime ??
      record.cumulativeCutoff,
  );
  if (direct) return direct;
  const seconds = numberValue(
    record.cutoffSeconds ??
      record.cutoffValueSeconds ??
      record.cumulativeCutoffSeconds,
  );
  return seconds != null && seconds >= 0
    ? formatSecondsToHMS(seconds)
    : undefined;
}

function normalizeConfiguredSplit(
  value: unknown,
  index: number,
  leg?: Record<string, unknown>,
): ConfiguredTimingPoint | undefined {
  const record = asRecord(value);
  const metadata = asRecord(record.metadata);
  if (Object.keys(record).length === 0) return undefined;
  const legName = text(
    leg?.name ??
      leg?.leg_name ??
      leg?.label ??
      leg?.segment ??
      leg?.type ??
      leg?.sport ??
      leg?.legName,
  );
  const rawLabel = text(
    record.displayName ??
      record.custom_display_name ??
      record.name ??
      record.splitName ??
      record.split_name ??
      record.shortName ??
      record.timingPointName ??
      record.checkpointName ??
      record.label ??
      record.title ??
      record.rawSplitLabel ??
      record.split ??
      record.checkpoint ??
      record.timingPoint,
  );
  const label = visibleConfiguredSplitLabel(record, rawLabel);
  if (!label && !legName) return undefined;
  const id =
    text(
      record.timingPointId ??
        record.timing_point_id ??
        record.splitId ??
        record.split_key ??
        record.providerTimingUuid ??
        record.checkpointId ??
        record.splitUuid ??
        record.split_uuid ??
        metadata.split_uuid ??
        record.uuid ??
        record.id ??
        record.providerId ??
        record.providerCode ??
        record.key ??
        `${legName || "split"}-${index}`,
    ) || `split-${index}`;
  return {
    id,
    label:
      label ||
      canonicalSplitDisplayName(record) ||
      legName ||
      `Split ${index + 1}`,
    markerType:
      text(
        record.markerType ??
          record.assigned_leg ??
          record.assignedLeg ??
          record.split_type ??
          record.type ??
          record.segment ??
          record.leg ??
          record.legName ??
          record.sport ??
          legName,
      ) || undefined,
    order:
      numberValue(
        record.order ??
          record.sortOrder ??
          (numberValue(record.leg_index) != null
            ? (numberValue(record.leg_index) ?? 0) * 100 +
              (numberValue(record.display_order ?? record.split_index) ?? index)
            : undefined) ??
          record.display_order ??
          record.split_index ??
          record.sequence ??
          record.sequenceNumber ??
          record.index ??
          record.Index ??
          record.Order ??
          index,
      ) ?? index,
    distanceKm: splitDistanceKm(record),
    cutoffMinutes: numberValue(
      record.cutoffMinutes ?? record.cutoff ?? record.cutoffMin,
    ),
    cutoffLabel: cutoffDisplay(record),
    matchKeys: splitKeyCandidates(record, label || legName || id),
  };
}

function contestKeyCandidates(res: AthleteModalResponse): string[] {
  const athlete = asRecord(res.athlete);
  const contestContext = asRecord(res.contestContext);
  const contest = asRecord(contestContext?.contest);
  const ordered = [
    text(athlete?.providerContestUuid),
    text(athlete?.contestUuid),
    text(athlete?.contestId),
    text(athlete?.providerContestId),
    text(athlete?.contestId),
    text(athlete?.contest),
    text(athlete?.contestName),
    text(athlete?.category),
    text(athlete?.ticketName),
    text(athlete?.ageGroupName),
    text(contest?.providerContestUuid),
    text(contest?.contestUuid),
    text(contest?.uuid),
    text(contest?.id),
    text(contest?.contestId),
    text(contest?.providerContestId),
    text(contest?.name),
    text(contest?.contestName),
  ];
  return [
    ...new Set(
      ordered.map((value) => String(value ?? "").trim()).filter(Boolean),
    ),
  ];
}

function recordMatchesContest(
  record: Record<string, unknown>,
  candidates: string[],
): boolean {
  if (candidates.length === 0) return false;
  const keys = [
    record.providerContestUuid,
    record.contestUuid,
    record.uuid,
    record.id,
    record.contestId,
    record.providerContestId,
    record.contest,
    record.name,
    record.contestName,
    record.category,
    record.ticketName,
  ]
    .map((value) => normalizeKey(text(value)))
    .filter(Boolean);
  const normalizedCandidates = candidates
    .map((value) => normalizeKey(value))
    .filter(Boolean);
  return normalizedCandidates.some((candidate) => keys.includes(candidate));
}

function mapRowsForContest(mapValue: unknown, candidates: string[]): unknown[] {
  const record = asRecord(mapValue);
  const rows: unknown[] = [];
  candidates.forEach((candidate) => {
    const direct = record[candidate];
    const normalizedCandidate = normalizeKey(candidate);
    const normalizedEntry = Object.entries(record).find(
      ([key]) => normalizeKey(key) === normalizedCandidate,
    )?.[1];
    if (direct) rows.push(direct);
    if (normalizedEntry && normalizedEntry !== direct)
      rows.push(normalizedEntry);
  });
  return rows;
}

function getContestTimingConfig(
  eventTimingConfig: unknown,
  athlete: unknown,
  contestContext?: unknown,
): Record<string, unknown> | null {
  const timingConfiguration = asRecord(eventTimingConfig);
  if (Object.keys(timingConfiguration).length === 0) return null;
  const contest = asRecord(asRecord(contestContext)?.contest);
  const candidates = contestKeyCandidates({
    success: true,
    eventId: "",
    athlete: asRecord(athlete) as AthleteModalResponse["athlete"],
    contestContext: { contest },
  });
  const contestRows = [
    ...mapRowsForContest(timingConfiguration.contestIndex, candidates),
    ...mapRowsForContest(timingConfiguration.contestsById, candidates),
    ...mapRowsForContest(timingConfiguration.contestsByUuid, candidates),
    ...mapRowsForContest(timingConfiguration.byContest, candidates),
    ...mapRowsForContest(timingConfiguration.byContestId, candidates),
    ...mapRowsForContest(timingConfiguration.splitsByContest, candidates),
    ...mapRowsForContest(timingConfiguration.timingPointsByContest, candidates),
    ...mapRowsForContest(timingConfiguration.raceFlowByContest, candidates),
    ...mapRowsForContest(
      timingConfiguration.raceFlowTimelineByContest,
      candidates,
    ),
    ...mapRowsForContest(
      timingConfiguration.legSplitMappingsByContest,
      candidates,
    ),
    ...mapRowsForContest(
      timingConfiguration.legSplitMappingByContest,
      candidates,
    ),
  ];
  const matchedContests = [
    ...asRecordArray(timingConfiguration.contests),
    ...asRecordArray(asRecord(timingConfiguration.data).contests),
  ].filter((row) => recordMatchesContest(row, candidates));
  const scopedRows = [...contestRows, ...matchedContests].filter(Boolean);

  if (scopedRows.length > 0) {
    return {
      contest,
      rows: scopedRows,
      timingPoints: scopedRows,
      splits: scopedRows,
    };
  }

  const hasContestCollections =
    asRecordArray(timingConfiguration.contests).length > 1 ||
    asRecordArray(asRecord(timingConfiguration.data).contests).length > 1 ||
    Object.keys(asRecord(timingConfiguration.contestIndex)).length > 0 ||
    Object.keys(asRecord(timingConfiguration.splitsByContest)).length > 0 ||
    Object.keys(asRecord(timingConfiguration.timingPointsByContest)).length > 0;
  if (hasContestCollections) return null;

  // Backend contract: athlete-modal now returns timingConfiguration already
  // scoped. Use direct rows only when it does not look like a full event config.
  return timingConfiguration;
}

function contestScopedSplitSources(res: AthleteModalResponse): unknown[] {
  const timingConfiguration = getContestTimingConfig(
    res.timingConfiguration,
    res.athlete,
    res.contestContext,
  );
  if (!timingConfiguration) return [];
  const candidates = contestKeyCandidates(res);
  const preferredKeys = [
    "splits",
    "splitIndex",
    "timingPoints",
    "timingPointIndex",
    "points",
    "rows",
    "items",
    "list",
    "legs",
    "legIndex",
    "contestIndex",
    "splitsByContest",
    "timingPointsByContest",
    "raceFlowByContest",
    "raceFlowTimelineByContest",
    "legSplitMappingsByContest",
    "legSplitMappingByContest",
  ];

  const sources: unknown[] = [];
  for (const key of candidates) {
    sources.push(
      ...mapRowsForContest(timingConfiguration.contestIndex, [key]).flatMap(
        (item) => collectRecordsDeep(item, preferredKeys),
      ),
      ...mapRowsForContest(timingConfiguration.splitsByContest, [key]).flatMap(
        (item) => collectRecordsDeep(item, preferredKeys),
      ),
      ...mapRowsForContest(timingConfiguration.timingPointsByContest, [
        key,
      ]).flatMap((item) => collectRecordsDeep(item, preferredKeys)),
      ...mapRowsForContest(timingConfiguration.raceFlowByContest, [
        key,
      ]).flatMap((item) => collectRecordsDeep(item, preferredKeys)),
      ...mapRowsForContest(timingConfiguration.raceFlowTimelineByContest, [
        key,
      ]).flatMap((item) => collectRecordsDeep(item, preferredKeys)),
      ...mapRowsForContest(timingConfiguration.legSplitMappingsByContest, [
        key,
      ]).flatMap((item) => collectRecordsDeep(item, preferredKeys)),
      ...mapRowsForContest(timingConfiguration.legSplitMappingByContest, [
        key,
      ]).flatMap((item) => collectRecordsDeep(item, preferredKeys)),
    );
  }
  sources.push(...collectRecordsDeep(timingConfiguration, preferredKeys));
  return sources;
}

function configuredSplitPoints(
  res: AthleteModalResponse,
): ConfiguredTimingPoint[] {
  const contestContext = asRecord(res.contestContext);
  const contestDefinition = asRecord(
    res.contestDefinition ?? contestContext.contest,
  );
  const directContestSplits = (
    asRecordArray(contestContext.splits).length > 0
      ? asRecordArray(contestContext.splits)
      : asRecordArray(contestDefinition.splits)
  )
    .map((split, index) => normalizeConfiguredSplit(split, index))
    .filter((point): point is ConfiguredTimingPoint => Boolean(point));
  const contestCandidates = contestKeyCandidates(res);
  const courseContests = asRecordArray(asRecord(res.courseIndex).contests);
  const selectedCourseContest = courseContests.find((contest) =>
    recordMatchesContest(contest, contestCandidates),
  );
  const mappedCourseSplits = asRecordArray(selectedCourseContest?.splits)
    .map((split, index) => normalizeConfiguredSplit(split, index))
    .filter((point): point is ConfiguredTimingPoint =>
      Boolean(
        point &&
        point.id &&
        point.label &&
        point.distanceKm != null &&
        point.markerType,
      ),
    );
  const timingConfiguration = getContestTimingConfig(
    res.timingConfiguration,
    res.athlete,
    res.contestContext,
  );
  if (!timingConfiguration) {
    return (
      directContestSplits.length >= mappedCourseSplits.length
        ? directContestSplits
        : mappedCourseSplits
    ).sort(
      (left, right) =>
        left.order - right.order ||
        (left.distanceKm ?? 0) - (right.distanceKm ?? 0),
    );
  }
  const preferredKeys = [
    "splits",
    "splitIndex",
    "timingPoints",
    "timingPointIndex",
    "points",
    "rows",
    "items",
    "list",
    "byContest",
    "byUuid",
    "contestIndex",
    "splitsByContest",
    "timingPointsByContest",
    "raceFlowByContest",
    "raceFlowTimelineByContest",
    "legSplitMappingsByContest",
    "legSplitMappingByContest",
  ];
  const configuredRows = [
    ...contestScopedSplitSources(res).flatMap((item) =>
      collectRecordsDeep(item, preferredKeys),
    ),
    ...collectRecordsDeep(timingConfiguration.splits, preferredKeys),
    ...collectRecordsDeep(timingConfiguration.timingPoints, preferredKeys),
    ...collectRecordsDeep(timingConfiguration.contests, preferredKeys),
    ...collectRecordsDeep(
      (timingConfiguration.data as Record<string, unknown> | undefined)
        ?.contests,
      preferredKeys,
    ),
    ...collectRecordsDeep(timingConfiguration.rows, preferredKeys),
    ...collectRecordsDeep(timingConfiguration.raceFlow, preferredKeys),
    ...collectRecordsDeep(timingConfiguration.raceFlowTimeline, preferredKeys),
    ...collectRecordsDeep(timingConfiguration.legSplitMappings, preferredKeys),
  ];

  const normalizedConfiguredRows = configuredRows
    .map((split, index) => normalizeConfiguredSplit(split, index))
    .filter((point): point is ConfiguredTimingPoint => Boolean(point));
  // Saved contest Race Flow is the presentation source of truth. Timing-point
  // definitions describe the provider reads behind those splits and must not
  // be appended as a second set of visible checkpoints.
  const configured: ConfiguredTimingPoint[] =
    directContestSplits.length > 0
      ? [...directContestSplits]
      : mappedCourseSplits.length > 0
        ? [...mappedCourseSplits]
        : [...normalizedConfiguredRows];

  const nestedLegRows: {
    split: Record<string, unknown>;
    leg: Record<string, unknown>;
  }[] = [];
  const legs = [
    ...asRecordArray(timingConfiguration.legs),
    ...asRecordArray(timingConfiguration.legIndex),
  ];
  legs.forEach((leg, legIndex) => {
    const legSplits = [
      ...asRecordArray(leg.splits),
      ...asRecordArray(leg.rows),
      ...asRecordArray(leg.items),
      ...asRecordArray(leg.timingPoints),
      ...asRecordArray(leg.points),
    ];
    if (legSplits.length > 0) {
      legSplits.forEach((split, splitIndex) => {
        nestedLegRows.push({
          split: {
            ...split,
            order:
              split.order ?? split.sortOrder ?? legIndex * 100 + splitIndex,
          },
          leg,
        });
      });
    }
  });

  if (configured.length === 0) {
    nestedLegRows.forEach(({ split, leg }, index) => {
      const point = normalizeConfiguredSplit(split, 10_000 + index, leg);
      if (point) configured.push(point);
    });
  }

  if (configured.length === 0) {
    legs.forEach((leg, legIndex) => {
      const point = normalizeConfiguredSplit(leg, legIndex, leg);
      if (point) configured.push(point);
    });
  }

  const seen = new Set<string>();
  const ordered = configured
    .filter((point) => !isGenericTimingPointLabel(point.label))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((point) => {
      const key = [
        normalizeKey(point.id),
        normalizeKey(point.label),
        point.distanceKm != null ? String(point.distanceKm) : "",
        normalizeKey(point.markerType),
      ]
        .filter(Boolean)
        .join(":");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  // Some Feibot race-flow exports provide every checkpoint distance in
  // metres without a unit (for example 100 and 2000). Detect that scale from
  // the whole contest so intermediate values are converted consistently.
  return normalizeContestDistanceScale(ordered);
}

function acceptedTerminalCourseFinish(
  res: AthleteModalResponse,
): Record<string, unknown> | undefined {
  const course = configuredSplitPoints(res);
  if (course.length === 0) return undefined;
  const terminal =
    [...course].reverse().find((point) => {
      const identity = normalizeKey(`${point.id} ${point.label}`);
      return (
        identity === "finish" ||
        identity.includes("racefinish") ||
        identity.includes("runfinish")
      );
    }) ?? course.at(-1);
  if (!terminal) return undefined;
  const terminalKeys = new Set(
    [
      ...(terminal.matchKeys ?? []),
      normalizeKey(terminal.id),
      normalizeKey(terminal.label),
    ].filter(Boolean),
  );
  return acceptedMobileSplits(res).find((split) =>
    splitKeyCandidates(asRecord(split)).some((candidate) =>
      terminalKeys.has(candidate),
    ),
  );
}

function hasAcceptedTerminalCourseFinish(res: AthleteModalResponse): boolean {
  return Boolean(acceptedTerminalCourseFinish(res));
}

/**
 * Contest-driven internal timeline. Resolves every configured point in order
 * so official reads retain canonical split/order semantics. The public live
 * projection later exposes only completed points plus the next expected point.
 *
 * Defined points come from contest-scoped `timingConfiguration`;
 * reached times come from the accepted canonical/live overlay. This is
 * important when the modal's base athlete snapshot predates a timing read.
 * When no config is present we fall back to the reached splits themselves.
 */
function mapTimeline(res: AthleteModalResponse): TimelineSplit[] {
  const eventTimezone = eventTimezoneForResponse(res);
  const reachedEntries = acceptedMobileSplits(res)
    .map((raw) => ({ raw: asRecord(raw), split: normalizeReachedSplit(raw) }))
    .filter((entry): entry is { raw: Record<string, unknown>; split: Split } =>
      Boolean(entry.split),
    );
  const reached = reachedEntries.map((entry) => entry.split);
  const reachedByKey = new Map<
    string,
    { raw: Record<string, unknown>; split: Split }
  >();
  reachedEntries.forEach(({ raw, split: s }) => {
    for (const key of [
      ...splitKeyCandidates(raw, s.name),
      normalizeKey(s.segment),
    ].filter(Boolean)) {
      if (!reachedByKey.has(key)) reachedByKey.set(key, { raw, split: s });
    }
  });

  const raceStartedAt = athleteStartTimestamp(res);
  const points: ResolvedTimingPoint[] = configuredSplitPoints(res).sort(
    (x, y) => (x.order ?? 0) - (y.order ?? 0),
  );
  const currentKey = normalizeKey(
    text(
      freshestResolvedState(res).currentSplitName ??
        freshestResolvedState(res).currentSplit ??
        asRecord(res.participantLive).currentSplitName ??
        res.athlete.currentSplitName,
    ),
  );
  const athleteFinished = resolveAthleteRaceState(res).status === "finished";

  // Fallback: no contest config — surface the reached splits in time order.
  if (points.length === 0) {
    const ordered = [...reached].sort((x, y) => x.time - y.time);
    return ordered.map((s, i) => {
      const key = normalizeKey(s.name) || normalizeKey(s.segment);
      const isCurrent = currentKey
        ? key === currentKey
        : i === ordered.length - 1;
      const raw = reachedEntries.find((entry) => entry.split === s)?.raw;
      const previous = ordered[i - 1];
      const label = normalizeSplitLabel(s.name || s.segment);
      return {
        key: `${s.segment}-${i}`,
        segment: s.segment,
        name: label,
        splitLabel: label,
        timeLabel: formatSecondsToHMS(s.time),
        distanceLabel:
          s.distance > 0
            ? (formatDistanceKm(s.distance) ?? undefined)
            : undefined,
        timeOfDayLabel: formatClockTime(
          raw?.readAt ??
            raw?.timestamp ??
            raw?.providerTimestamp ??
            raw?.readTimestamp ??
            raw?.timingPointTime ??
            raw?.timeOfDay ??
            raw?.clockTime ??
            s.absoluteTimestamp ??
            (raceStartedAt != null ? raceStartedAt + s.time * 1000 : undefined),
          eventTimezone,
        ),
        splitTimeLabel: calculateSplitTime(s, previous),
        elapsedTimeLabel: calculateElapsedTime(s),
        paceSpeedLabel: calculatePaceOrSpeed(s, previous, s.segment || s.name),
        positionLabel:
          text(
            raw?.position ?? raw?.rank ?? raw?.overallRank ?? raw?.splitRank,
          ) || DASH,
        gapLabel: calculateGap(raw),
        state: isCurrent ? "current" : "completed",
      };
    });
  }

  let previousMatched: Split | undefined;
  const rows: Array<TimelineSplit & { completed: boolean }> = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const pointRecord = point as ConfiguredTimingPoint;
    const keys = [
      normalizeKey(point.id),
      normalizeKey(point.label),
      ...(pointRecord.matchKeys ?? []),
    ].filter(Boolean);
    const matchedEntry =
      keys.map((key) => reachedByKey.get(key)).find(Boolean) ??
      reachedEntries.find(
        ({ split }) =>
          point.distanceKm != null &&
          split.distance > 0 &&
          Math.abs(split.distance - point.distanceKm) < 0.02 &&
          normalizeKey(split.name || split.segment) ===
            normalizeKey(point.label),
      );
    const match = matchedEntry?.split;
    const raw = matchedEntry?.raw;
    const previous = previousMatched;
    if (match) previousMatched = match;
    const label = normalizeSplitLabel(point.label);
    const startRow =
      !match &&
      (point.distanceKm ?? 0) === 0 &&
      normalizeKey(label).includes("start");
    const completed =
      Boolean(match) || Boolean(startRow && raceStartedAt != null);
    // A finished result exposes accepted history only. A live result exposes
    // accepted history plus one lightweight current/next row. Do not allocate
    // presentation rows for the untouched remainder of a long race course.
    if (athleteFinished && !completed) continue;
    const row: TimelineSplit & { completed: boolean } = {
      key: `${point.id || point.label || "tp"}-${i}`,
      segment: point.markerType ?? point.label,
      name: label,
      splitLabel: label,
      timeLabel: match
        ? formatSecondsToHMS(match.time)
        : startRow && raceStartedAt != null
          ? "00:00:00"
          : DASH,
      distanceLabel:
        point.distanceKm != null
          ? (formatDistanceKm(point.distanceKm) ?? undefined)
          : undefined,
      timeOfDayLabel: match
        ? formatClockTime(
            raw?.readAt ??
              raw?.timestamp ??
              raw?.providerTimestamp ??
              raw?.readTimestamp ??
              raw?.timingPointTime ??
              raw?.timeOfDay ??
              raw?.clockTime ??
              match.absoluteTimestamp ??
              (raceStartedAt != null
                ? raceStartedAt + match.time * 1000
                : undefined),
            eventTimezone,
          )
        : startRow
          ? formatClockTime(raceStartedAt, eventTimezone)
          : DASH,
      splitTimeLabel: match ? calculateSplitTime(match, previous) : DASH,
      elapsedTimeLabel: match
        ? calculateElapsedTime(match)
        : startRow
          ? "00:00:00"
          : DASH,
      paceSpeedLabel: match
        ? calculatePaceOrSpeed(match, previous, point.markerType ?? point.label)
        : DASH,
      positionLabel:
        text(
          raw?.position ?? raw?.rank ?? raw?.overallRank ?? raw?.splitRank,
        ) || DASH,
      gapLabel: calculateGap(raw),
      cutoffLabel:
        pointRecord.cutoffLabel ?? formatCutoffMinutes(point.cutoffMinutes),
      completed,
      state: completed ? "completed" : "current",
    };
    rows.push(row);
    if (!athleteFinished && !completed) break;
  }

  return rows.map((r) => {
    return {
      key: r.key,
      segment: r.segment,
      name: r.name,
      splitLabel: r.splitLabel,
      timeLabel: r.timeLabel,
      distanceLabel: r.distanceLabel,
      timeOfDayLabel: r.timeOfDayLabel,
      splitTimeLabel: r.splitTimeLabel,
      elapsedTimeLabel: r.elapsedTimeLabel,
      paceSpeedLabel: r.paceSpeedLabel,
      positionLabel: r.positionLabel,
      gapLabel: r.gapLabel,
      cutoffLabel: r.cutoffLabel,
      state: r.state,
    };
  });
}

function mapDerivedRaceTiming(
  res: AthleteModalResponse,
): AthleteRaceTiming | undefined {
  const canonical = buildCanonicalRaceFlow(res);
  if (canonical) return canonical;
  const timingConfiguration = getContestTimingConfig(
    res.timingConfiguration,
    res.athlete,
    res.contestContext,
  );
  if (!timingConfiguration) return undefined;
  const legRows = asRecordArray(timingConfiguration.legs);
  const directSplitRows = asRecordArray(timingConfiguration.splits);
  const nestedSplitRows: Record<string, unknown>[] = legRows.flatMap((leg) =>
    [
      ...asRecordArray(leg.splits),
      ...asRecordArray(leg.timingPoints),
      ...asRecordArray(leg.rows),
    ].map((split): Record<string, unknown> => ({
      ...split,
      legId: split.legId ?? leg.id,
    })),
  );
  const splitRows =
    directSplitRows.length > 0 ? directSplitRows : nestedSplitRows;
  if (legRows.length < 2 || splitRows.length === 0) return undefined;

  const splits: RaceSplitConfig[] = splitRows.flatMap<RaceSplitConfig>(
    (row, index) => {
      const key = normalizeTimingKey(
        row.key ?? row.splitKey ?? row.id ?? row.uuid ?? row.name ?? row.label,
      );
      const legId = normalizeTimingKey(
        row.legId ?? row.legKey ?? row.leg ?? row.segment,
      );
      if (!key || !legId) return [];
      return [
        {
          key,
          name: firstText(row.name, row.label, row.displayName, key),
          legId,
          distanceInLegKm: numberValue(
            row.distanceInLegKm ??
              row.legDistanceKm ??
              row.distanceKm ??
              row.distance,
          ),
          order: numberValue(row.order ?? row.sortOrder) ?? index + 1,
          providerIds: [
            row.providerId,
            row.providerCode,
            row.splitUuid,
            row.timingPointId,
            row.timingPointUuid,
          ]
            .map(text)
            .filter(Boolean),
          aliases: Array.isArray(row.aliases)
            ? row.aliases.map(text).filter(Boolean)
            : [],
          passRule:
            row.passRule === "last" || row.passRule === "official"
              ? row.passRule
              : "first",
        } satisfies RaceSplitConfig,
      ];
    },
  );

  const legs: RaceLegConfig[] = legRows.flatMap<RaceLegConfig>((row, index) => {
    const id = normalizeTimingKey(
      row.id ?? row.key ?? row.legId ?? row.type ?? row.segment ?? row.name,
    );
    const type = normalizeTimingKey(row.type ?? row.segment ?? row.name);
    const legSplits = splits.filter((split) => split.legId === id);
    const startSplitKey = normalizeTimingKey(
      row.startSplitKey ??
        row.startSplitId ??
        row.startTimingPointId ??
        legSplits.find((split) =>
          normalizeTimingKey(split.name).includes("start"),
        )?.key,
    );
    const finishSplitKey = normalizeTimingKey(
      row.finishSplitKey ??
        row.finishSplitId ??
        row.finishTimingPointId ??
        [...legSplits]
          .reverse()
          .find((split) =>
            /finish|end|exit|out/.test(normalizeTimingKey(split.name)),
          )?.key,
    );
    if (!id || !startSplitKey || !finishSplitKey) return [];
    return [
      {
        id,
        name: firstText(
          row.name,
          row.label,
          row.title,
          type || `Leg ${index + 1}`,
        ),
        type: type || id,
        order: numberValue(row.order ?? row.sortOrder) ?? index + 1,
        distanceKm: numberValue(row.distanceKm ?? row.distance),
        startSplitKey,
        finishSplitKey,
      } satisfies RaceLegConfig,
    ];
  });
  if (legs.length < 2) return undefined;

  return buildAthleteRaceSections({
    legs,
    splits,
    reads: acceptedMobileSplits(res),
    athleteStatus: firstText(res.result?.status, res.athlete.status),
  });
}

/**
 * Build the interpolation seed + replay keyframes from the athlete's reached
 * splits and the contest timing points. All the math lives here (not in the
 * map component): the engine consumes these to place/animate the marker.
 */
function mapTrack(
  res: AthleteModalResponse,
  canonicalPrediction?: CanonicalPredictionState,
): AthleteTrack | undefined {
  const resolved = freshestResolvedState(res);
  const reachedEntries = acceptedMobileSplits(res)
    .map((raw) => ({ raw: asRecord(raw), split: normalizeReachedSplit(raw) }))
    .filter((entry): entry is { raw: Record<string, unknown>; split: Split } =>
      Boolean(entry.split),
    )
    .filter(
      (entry, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.split.time === entry.split.time &&
            candidate.split.distance === entry.split.distance &&
            normalizeKey(candidate.split.name) ===
              normalizeKey(entry.split.name),
        ) === index,
    )
    .sort((x, y) => x.split.time - y.split.time);
  const reached = reachedEntries.map((entry) => entry.split);
  if (reached.length === 0) return undefined;

  const points = configuredSplitPoints(res)
    .map((p) => p.distanceKm)
    .filter((d): d is number => typeof d === "number" && d >= 0)
    .sort((a, b) => a - b);

  const last = reached[reached.length - 1];
  // The freshest canonical projection is authoritative, including an explicit
  // correction that moves an athlete back to an earlier checkpoint.
  const officialAnchorKm =
    canonicalPrediction?.latestCumulativeDistanceKm ??
    numberValue(resolved.officialDistanceKm) ??
    last.distance;
  const totalKm = Math.max(
    numberValue(resolved.totalDistanceKm) ?? 0,
    points[points.length - 1] ?? 0,
    last.distance,
  );
  const nextKm =
    canonicalPrediction?.nextCheckpoint?.cumulativeDistanceKm ??
    numberValue(resolved.nextSplitDistanceKm) ??
    numberValue(asRecord(resolved.nextExpectedSplit).distanceKm) ??
    points.find((d) => d > officialAnchorKm) ??
    totalKm;
  const activeLeg = text(
    resolved.currentLeg ??
      res.athlete.currentLegName ??
      asRecord(resolved.lastCompletedSplit).legType ??
      last.segment,
  ).toLowerCase();
  const transitionHold = /(^|\b)(t1|t2|transition)(\b|$)/i.test(activeLeg);
  const canonicalPace =
    numberValue(resolved.predictedPaceSecondsPerKm) ??
    (() => {
      const speed = numberValue(resolved.predictedSpeedKmh);
      return speed && speed > 0 ? 3_600 / speed : undefined;
    })();
  const pace = conservativePaceSecPerKm({
    // The web canonical response owns the pace model. Mobile may interpolate
    // that shared seed for rendering, but must not select a different pace
    // from locally reconstructed split sections.
    sectionPaces: [],
    canonicalPaceSecPerKm: canonicalPace,
    transitionHold,
  });
  const paceSecPerKm = pace.paceSecPerKm;
  // Prediction always starts at the latest accepted canonical checkpoint.
  // A server-estimated distance is presentation-only and may never become a
  // new anchor or release the marker through a later checkpoint.
  const officialAnchorTimeSec =
    canonicalPrediction?.latestAcceptedElapsedSeconds ?? last.time;

  const lastEntry = reachedEntries.at(-1);
  const serverNow = timestampValue(
    resolved.serverNow ?? asRecord(res.participantLive).serverNow,
  );
  const anchorTimestamp =
    canonicalPrediction?.latestAcceptedTimestamp ?? last.absoluteTimestamp;
  const initialLiveClockSec =
    serverNow != null && anchorTimestamp != null
      ? Math.max(0, (serverNow - anchorTimestamp) / 1_000)
      : Math.max(
          0,
          (numberValue(
            resolved.officialElapsedMs ??
              resolved.liveOverallElapsedMs ??
              resolved.officialRaceElapsedMs ??
              resolved.athleteElapsedMs,
          ) ?? officialAnchorTimeSec * 1_000) /
            1_000 -
            officialAnchorTimeSec,
        );

  const keyframes: TrackKeyframe[] = [
    { distanceKm: 0, timeSec: 0 },
    ...reached.map((s) => ({ distanceKm: s.distance, timeSec: s.time })),
  ];

  return {
    seed: {
      anchorKm: officialAnchorKm,
      anchorTimeSec: officialAnchorTimeSec,
      nextKm,
      paceSecPerKm,
      totalKm,
    },
    initialLiveClockSec,
    keyframes,
    totalKm,
    currentLeg: activeLeg || undefined,
    estimatedLegDistanceKm:
      numberValue(resolved.estimatedLegDistanceKm) ?? undefined,
    currentLegDistanceKm:
      numberValue(resolved.currentLegDistanceKm) ?? undefined,
    anchorSplitKey:
      canonicalPrediction?.latestAcceptedSplitKey ??
      firstText(
        lastEntry?.raw.canonicalSplitKey,
        lastEntry?.raw.splitKey,
        lastEntry?.raw.key,
        last.name,
      ),
    anchorTimestamp,
    nextCheckpointKey: canonicalPrediction?.nextCheckpoint?.key,
    nextCheckpointLabel: canonicalPrediction?.nextCheckpoint?.label,
    nextCheckpointKm: canonicalPrediction?.nextCheckpoint?.cumulativeDistanceKm,
    predictedArrivalAt: canonicalPrediction?.nextCheckpoint?.expectedTimestamp,
    predictedArrivalElapsedSec:
      canonicalPrediction?.nextCheckpoint?.expectedElapsedSeconds,
    paceSource: pace.source,
    predictionConfidence: pace.confidence,
    serverTimeSource: serverNow ? "canonical_server" : "device_fallback",
  };
}

function predictionRaceState(res: AthleteModalResponse): PredictionRaceState {
  const state = resolveAthleteRaceState(res);
  const terminal = state.label.toUpperCase();
  if (["DNF", "DNS", "DNQ", "DSQ"].includes(terminal))
    return terminal as PredictionRaceState;
  if (state.status === "finished") return "FINISHED";
  if (state.status === "live") return "ACTIVE";
  return "NOT_STARTED";
}

function mapCanonicalPrediction(
  res: AthleteModalResponse,
): CanonicalPredictionState {
  const resolved = freshestResolvedState(res);
  const course = configuredSplitPoints(res).map<PredictionCoursePoint>(
    (point, index) => {
      const matchKeys = [
        ...new Set(
          [
            ...(point.matchKeys ?? []),
            normalizeKey(point.id),
            normalizeKey(point.label),
          ].filter(Boolean),
        ),
      ];
      return {
        key: matchKeys[0] || `split${index}`,
        matchKeys,
        label: point.label,
        sequence: point.order ?? index,
        sport: point.markerType,
        cumulativeDistanceKm: point.distanceKm,
      };
    },
  );
  const accepted = acceptedMobileSplits(res).map<AcceptedPredictionSplit>(
    (raw) => {
      const record = asRecord(raw);
      const split = normalizeReachedSplit(record);
      return {
        keys: splitKeyCandidates(record, split?.name),
        sequence: numberValue(
          record.canonicalSequence ??
            record.canonicalOrder ??
            record.raceFlowOrder,
        ),
        acceptedTimestamp: split?.absoluteTimestamp,
        elapsedSeconds: split?.time,
        cumulativeDistanceKm: split?.distance,
      };
    },
  );
  let prediction = buildCanonicalPredictionState({
    raceState: predictionRaceState(res),
    course,
    acceptedSplits: accepted,
    officialDistanceKm: numberValue(
      resolved.officialDistanceKm ??
        asRecord(resolved.lastCompletedSplit).cumulativeDistanceKm ??
        asRecord(resolved.lastCompletedSplit).distanceKm,
    ),
    totalDistanceKm: numberValue(resolved.totalDistanceKm),
    // Structural progression is reconstructed from the shared canonical
    // course, but all prediction time/pace values below come from the server.
    paceModel: {},
  });
  // The participant Worker already resolves contest-scoped pace and its next
  // checkpoint ETA. Prefer that authoritative projection over a client sport
  // fallback (a generic `Finish` label cannot reliably reveal whether this is
  // a swim, bike, or run course).
  const serverNextExpectedAt = timestampValue(
    resolved.etaNextSplit ??
      resolved.nextSplitEta ??
      resolved.nextCheckpointEta,
  );
  const serverFinishExpectedAt = timestampValue(
    resolved.estimatedFinishTime ??
      resolved.etaFinish ??
      resolved.etaFinishClock,
  );
  const acceptedStartAt = athleteStartTimestamp(res);
  const predictionStartAt =
    acceptedStartAt ??
    (prediction.latestAcceptedTimestamp != null &&
    prediction.latestAcceptedElapsedSeconds != null
      ? prediction.latestAcceptedTimestamp -
        prediction.latestAcceptedElapsedSeconds * 1_000
      : undefined);
  if (!prediction.predictionSuppressed && prediction.nextCheckpoint) {
    const serverExpectedElapsed =
      serverNextExpectedAt != null && predictionStartAt != null
        ? Math.max(0, (serverNextExpectedAt - predictionStartAt) / 1_000)
        : undefined;
    const nextCheckpoint = {
      ...prediction.nextCheckpoint,
      expectedTimestamp: serverNextExpectedAt ?? undefined,
      expectedElapsedSeconds: serverExpectedElapsed,
    };
    prediction = {
      ...prediction,
      nextCheckpoint,
      remainingCheckpoints: prediction.remainingCheckpoints.map(
        (checkpoint, index) =>
          index === 0
            ? nextCheckpoint
            : {
                ...checkpoint,
                expectedTimestamp: undefined,
                expectedElapsedSeconds: undefined,
              },
      ),
    };
  }
  if (!prediction.predictionSuppressed) {
    prediction = {
      ...prediction,
      projectedFinishTimestamp: serverFinishExpectedAt ?? undefined,
      projectedFinishElapsedSeconds:
        serverFinishExpectedAt != null && predictionStartAt != null
          ? Math.max(0, (serverFinishExpectedAt - predictionStartAt) / 1_000)
          : undefined,
    };
  }
  if (process.env.NODE_ENV !== "production") {
    console.info("[prediction-engine]", {
      participantUuid: firstText(
        res.athlete.participantUuid,
        asRecord(res.participantLive).participantUuid,
      ),
      raceState: prediction.raceState,
      latestAcceptedSplitKey: prediction.latestAcceptedSplitKey,
      latestAcceptedSequence: prediction.latestAcceptedSequence,
      latestAcceptedTimestamp: prediction.latestAcceptedTimestamp,
      latestCumulativeDistanceKm: prediction.latestCumulativeDistanceKm,
      totalDistanceKm: prediction.totalDistanceKm,
      remainingDistanceKm: prediction.remainingDistanceKm,
      remainingCheckpointKeys: prediction.remainingCheckpoints.map(
        (point) => point.key,
      ),
      nextCheckpointKey: prediction.nextCheckpoint?.key,
      predictionSuppressed: prediction.predictionSuppressed,
      suppressionReason: prediction.suppressionReason,
    });
  }
  return prediction;
}

function mapPredictedCheckpoints(
  res: AthleteModalResponse,
  prediction: CanonicalPredictionState,
): PredictedCheckpointView[] {
  // Live Tracking intentionally exposes one prediction at a time. The full
  // ordered contest definition remains canonical, but mapping every future
  // checkpoint on every timing update creates unnecessary work and leaks the
  // complete future race flow before the athlete reaches it.
  return prediction.remainingCheckpoints.slice(0, 1).map((point) => ({
    checkpoint: point.label,
    estimatedRaceElapsed:
      point.expectedElapsedSeconds != null
        ? formatSecondsToHMS(point.expectedElapsedSeconds)
        : DASH,
    estimatedTimeOfDay:
      point.expectedTimestamp != null
        ? formatClockTime(
            point.expectedTimestamp,
            eventTimezoneForResponse(res),
          )
        : DASH,
    remaining:
      formatDistanceKm(point.remainingDistanceKm) ??
      `${point.remainingDistanceKm.toFixed(1)} km`,
  }));
}

function hasOfficialTimelineTime(split: TimelineSplit): boolean {
  // Configured START rows may carry a display-only 00:00:00 elapsed value
  // before any accepted mat passage. It must not be promoted to official.
  return [split.timeOfDayLabel, split.timeLabel].some((value) => {
    const normalized = text(value);
    return Boolean(normalized && normalized !== DASH && normalized !== "-");
  });
}

const completedTimelineRowCache = new Map<
  string,
  Map<string, { fingerprint: string; row: TimelineSplit }>
>();
const MAX_TIMELINE_PARTICIPANT_CACHES = 50;

function timelineRowFingerprint(row: TimelineSplit): string {
  return [
    row.key,
    row.segment,
    row.name,
    row.splitLabel,
    row.timeLabel,
    row.timeOfDayLabel,
    row.splitTimeLabel,
    row.elapsedTimeLabel,
    row.paceSpeedLabel,
    row.positionLabel,
    row.gapLabel,
    row.cutoffLabel,
    row.state,
    row.expected ? "1" : "0",
  ].join("\u001f");
}

function stableTimelineRows(
  cacheScope: string | undefined,
  rows: TimelineSplit[],
): TimelineSplit[] {
  if (!cacheScope) return rows;
  let cache = completedTimelineRowCache.get(cacheScope);
  if (!cache) {
    cache = new Map();
    completedTimelineRowCache.set(cacheScope, cache);
    if (completedTimelineRowCache.size > MAX_TIMELINE_PARTICIPANT_CACHES) {
      const oldest = completedTimelineRowCache.keys().next().value;
      if (oldest) completedTimelineRowCache.delete(oldest);
    }
  } else {
    // Refresh insertion order so warm athlete navigation behaves as an LRU.
    completedTimelineRowCache.delete(cacheScope);
    completedTimelineRowCache.set(cacheScope, cache);
  }
  return rows.map((row) => {
    const fingerprint = timelineRowFingerprint(row);
    const cached = cache?.get(row.key);
    if (cached?.fingerprint === fingerprint) {
      if (process.env.NODE_ENV !== "production") {
        console.debug("LIVE_TIMELINE_ROW_REUSED", {
          participantUuid: cacheScope,
          splitKey: row.key,
          reason: "accepted_timestamp_unchanged",
        });
      }
      return cached.row;
    }
    cache?.set(row.key, { fingerprint, row });
    if (process.env.NODE_ENV !== "production") {
      console.debug("LIVE_TIMELINE_ROW_CREATED", {
        participantUuid: cacheScope,
        splitKey: row.key,
        reason: cached ? "accepted_row_changed" : "new_visible_row",
      });
    }
    return row;
  });
}

/**
 * Deterministic progressive visibility rule. Only accepted history and at
 * most one current/next checkpoint are returned; untouched future rows never
 * reach React.
 */
export function getVisibleLiveSplits(
  canonicalSplitOrder: TimelineSplit[],
  acceptedSplits: TimelineSplit[],
  athleteStatus: string,
  currentLeg?: string,
  currentSplit?: string,
): TimelineSplit[] {
  const acceptedKeys = new Set(acceptedSplits.map((split) => split.key));
  const history = canonicalSplitOrder.filter((split) =>
    acceptedKeys.has(split.key),
  );
  if (normalizeKey(athleteStatus) === "finished") return history;

  const lastAcceptedIndex = history.reduce(
    (latest, split) =>
      Math.max(
        latest,
        canonicalSplitOrder.findIndex(
          (candidate) => candidate.key === split.key,
        ),
      ),
    -1,
  );
  const remaining = canonicalSplitOrder.slice(lastAcceptedIndex + 1);
  const normalizedCurrentSplit = normalizeKey(currentSplit);
  const normalizedCurrentLeg = normalizeKey(currentLeg);
  const namedCurrent = remaining.find((split) => {
    const splitIdentity = normalizeKey(`${split.splitLabel} ${split.name}`);
    const legIdentity = normalizeKey(split.segment);
    return (
      (normalizedCurrentSplit &&
        splitIdentity.includes(normalizedCurrentSplit)) ||
      (normalizedCurrentLeg && legIdentity.includes(normalizedCurrentLeg))
    );
  });
  const next = namedCurrent ?? remaining[0];
  return next ? [...history, next] : history;
}

/**
 * IRONMAN-style live split projection: official history behind the athlete and
 * exactly one expected timing point ahead. Finished/terminal athletes retain
 * their complete official history, while unreached future points stay hidden.
 */
export function projectProgressiveTimeline(input: {
  timeline: TimelineSplit[];
  terminal: boolean;
  nextSplit?: NextSplitView;
  expectedStartLabel?: string;
  participantCacheKey?: string;
  athleteStatus?: string;
  currentLeg?: string;
  currentSplit?: string;
}): TimelineSplit[] {
  const official = input.timeline
    .filter(hasOfficialTimelineTime)
    .map((split) => ({
      ...split,
      state: "completed" as const,
      expected: false,
    }));
  if (input.terminal) {
    const stable = stableTimelineRows(input.participantCacheKey, official);
    if (process.env.NODE_ENV !== "production") {
      console.debug("LIVE_TIMELINE_VISIBLE_ROWS", {
        participantUuid: input.participantCacheKey,
        reason: "finished",
        count: stable.length,
      });
    }
    return stable;
  }

  const visible = getVisibleLiveSplits(
    input.timeline,
    official,
    input.athleteStatus ?? "live",
    input.currentLeg,
    input.currentSplit,
  );
  const next = visible.find((split) => !hasOfficialTimelineTime(split));
  if (!next) return stableTimelineRows(input.participantCacheKey, official);
  const nextLabel = normalizeKey(input.nextSplit?.checkpoint);
  const rowLabel = normalizeKey(next.splitLabel || next.name);
  const expectedTime =
    nextLabel && rowLabel === nextLabel
      ? input.nextSplit?.estimatedTimeOfDay
      : official.length === 0 && /start/.test(rowLabel)
        ? input.expectedStartLabel
        : undefined;

  const projected: TimelineSplit[] = [
    ...official,
    {
      ...next,
      state: "current" as const,
      expected: true,
      timeLabel: DASH,
      timeOfDayLabel: expectedTime || DASH,
      splitTimeLabel: DASH,
      elapsedTimeLabel: DASH,
      paceSpeedLabel: DASH,
      positionLabel: DASH,
      gapLabel: DASH,
    },
  ];
  const stable = stableTimelineRows(input.participantCacheKey, projected);
  if (process.env.NODE_ENV !== "production") {
    console.debug("LIVE_TIMELINE_VISIBLE_ROWS", {
      participantUuid: input.participantCacheKey,
      reason: official.length === 0 ? "pre_start" : "live_progress",
      count: stable.length,
    });
  }
  return stable;
}

function mapDerivedNextSplit(
  res: AthleteModalResponse,
  prediction: CanonicalPredictionState,
): NextSplitView | undefined {
  const first = mapPredictedCheckpoints(res, prediction)[0];
  if (!first || prediction.predictionSuppressed) return undefined;
  return {
    checkpoint: first.checkpoint,
    estimatedTimeOfDay: first.estimatedTimeOfDay,
    estimatedRaceElapsed: first.estimatedRaceElapsed,
    remaining: first.remaining,
    confidence: prediction.latestAcceptedSequence != null ? "MEDIUM" : "LOW",
    basis: "Latest accepted canonical timing point and ordered contest course",
  };
}

function mapDerivedFinish(
  res: AthleteModalResponse,
  prediction: CanonicalPredictionState,
): ProjectedFinishView | undefined {
  if (
    prediction.predictionSuppressed ||
    prediction.projectedFinishTimestamp == null
  )
    return undefined;
  const clockLabel = formatClockTime(
    prediction.projectedFinishTimestamp,
    eventTimezoneForResponse(res),
  );
  return {
    estimatedRaceElapsed:
      prediction.projectedFinishElapsedSeconds != null
        ? formatSecondsToHMS(prediction.projectedFinishElapsedSeconds)
        : undefined,
    estimatedTimeOfDay: clockLabel,
    confidenceLabel:
      prediction.latestAcceptedSequence != null ? "MEDIUM" : "LOW",
  };
}

function mapContestCutoffs(res: AthleteModalResponse): CutoffRow[] {
  const points = configuredSplitPoints(res);
  const fromPoints = points
    .filter((point) => point.cutoffLabel || point.cutoffMinutes != null)
    .map((point) => ({
      label: point.label,
      value:
        point.cutoffLabel ?? formatCutoffMinutes(point.cutoffMinutes) ?? DASH,
    }));
  if (fromPoints.length > 0) return fromPoints;
  return getContestTimingConfig(
    res.timingConfiguration,
    res.athlete,
    res.contestContext,
  )
    ? (res.cutoffs ?? [])
    : [];
}

export function resolveOfficialRaceDurationSeconds(input: {
  raceTiming?: AthleteRaceTiming;
  terminalElapsedSeconds?: number | null;
}): number | null {
  const sections = input.raceTiming?.sections ?? [];
  const completedSectionTotal =
    sections.length > 0 &&
    sections.every(
      (section) =>
        section.status === "completed" &&
        section.durationSeconds != null &&
        Number.isFinite(section.durationSeconds) &&
        section.durationSeconds >= 0,
    )
      ? sections.reduce(
          (total, section) => total + (section.durationSeconds ?? 0),
          0,
        )
      : null;

  return (
    [
      input.raceTiming?.overallTimeSeconds,
      input.terminalElapsedSeconds,
      completedSectionTotal,
    ].find(
      (value): value is number =>
        value != null && Number.isFinite(value) && value > 0,
    ) ?? null
  );
}

/**
 * Build the Official Results view model when the backend has an official result
 * for a finished athlete (KV, uploaded post-race). Returns undefined otherwise.
 */
function mapResult(
  res: AthleteModalResponse,
  status: RaceStatus,
  raceTiming?: AthleteRaceTiming,
  timeline: TimelineSplit[] = [],
): AthleteResultView | undefined {
  const r = res.result;
  const resultStatus = text(r?.status).toUpperCase();
  const terminalFinish = acceptedTerminalCourseFinish(res);
  const hasResult = Boolean(
    r &&
    (r.chipTime ||
      r.overallRank != null ||
      (r.splits?.length ?? 0) > 0 ||
      ["DNF", "DNS", "DNQ", "DSQ"].includes(resultStatus)),
  );
  const hasOfficialOutcome =
    status === "finished" ||
    ["DNF", "DNS", "DNQ", "DSQ"].includes(resultStatus);
  const hasCanonicalFinishedTiming =
    status === "finished" &&
    (Boolean(terminalFinish) || hasCanonicalTerminalTimestamp(res));
  if ((!r || !hasResult) && !hasCanonicalFinishedTiming) return undefined;
  if (!hasOfficialOutcome) return undefined;

  const officialResult = asRecord(r);
  const athlete = asRecord(res.athlete);
  const positiveRank = (value: unknown): string | undefined => {
    const parsed = Number(String(value ?? "").replace(/^#/, ""));
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : undefined;
  };

  const ranks: MetricRow[] = [];
  const overallRank = positiveRank(r?.overallRank ?? athlete.overallRank);
  const genderRank = positiveRank(r?.genderRank ?? athlete.genderRank);
  const categoryRank = positiveRank(
    r?.categoryRank ?? officialResult.ageGroupRank ?? athlete.ageGroupRank,
  );
  if (overallRank) ranks.push({ label: "Overall", value: overallRank });
  if (genderRank) ranks.push({ label: "Gender", value: genderRank });
  if (categoryRank) ranks.push({ label: "Age Group", value: categoryRank });

  const publishedSplits = r?.splits ?? [];
  const presentSplitValue = (value: unknown): string | undefined => {
    const candidate = text(value);
    return candidate && candidate !== DASH && candidate !== "-"
      ? candidate
      : undefined;
  };
  const resultSplitKind = (label: unknown, leg?: unknown): string => {
    const key = normalizeKey(`${text(leg)} ${text(label)}`);
    if (
      /transition1|(^|[^a-z])t1([^a-z]|$)/i.test(`${text(leg)} ${text(label)}`)
    )
      return "t1";
    if (
      /transition2|(^|[^a-z])t2([^a-z]|$)/i.test(`${text(leg)} ${text(label)}`)
    )
      return "t2";
    if (key.includes("run1")) return "run1";
    if (key.includes("run2")) return "run2";
    if (key.includes("swim")) return "swim";
    if (key.includes("bike") || key.includes("cycle")) return "bike";
    if (key.includes("run")) return "run";
    return key;
  };
  const timelineForPublishedSplit = (
    label: unknown,
    leg?: unknown,
  ): TimelineSplit | undefined => {
    const kind = resultSplitKind(label, leg);
    const exactLabel = normalizeKey(text(label));
    const exact = timeline.find((candidate) =>
      [candidate.splitLabel, candidate.name].some(
        (value) => normalizeKey(value) === exactLabel,
      ),
    );
    if (exact) return exact;

    const preferredBoundary: Record<string, string[]> = {
      swim: ["swimfinish"],
      t1: ["t1finish", "transition1finish", "bikestart"],
      bike: ["bikefinish", "cyclefinish"],
      t2: ["t2finish", "transition2finish", "runstart", "run1start"],
      run: ["runfinish"],
      run1: ["run1finish"],
      run2: ["run2finish"],
    };
    const boundary = timeline.find((candidate) => {
      const candidateKey = normalizeKey(
        `${candidate.splitLabel} ${candidate.name}`,
      );
      return (preferredBoundary[kind] ?? []).some((target) =>
        candidateKey.includes(target),
      );
    });
    if (boundary) return boundary;

    return [...timeline]
      .reverse()
      .find(
        (candidate) =>
          resultSplitKind(candidate.name, candidate.segment) === kind,
      );
  };
  const splits =
    publishedSplits.length > 0
      ? publishedSplits.map((s) => {
          const canonical = timelineForPublishedSplit(s.label, s.leg);
          return {
            label: s.label,
            value: s.time,
            timeOfDay:
              presentSplitValue(s.timeOfDay) ??
              presentSplitValue(canonical?.timeOfDayLabel),
            // Uploaded rows are already leg/transition durations. Keep that
            // official value instead of exposing a blank segment column (or a
            // final checkpoint delta when a leg has intermediate mats).
            segmentTime:
              presentSplitValue(s.segmentTime) ?? presentSplitValue(s.time),
            paceSpeed:
              presentSplitValue(s.paceSpeed) ??
              presentSplitValue(canonical?.paceSpeedLabel),
            rank:
              positiveRank(s.rank) ?? positiveRank(canonical?.positionLabel),
            leg: s.leg ?? canonical?.segment,
            distanceKm:
              s.distanceKm ??
              numberValue(
                String(canonical?.distanceLabel ?? "").match(
                  /\d+(?:\.\d+)?/,
                )?.[0],
              ),
          };
        })
      : timeline
          .filter((split) => split.state === "completed")
          .map((split) => ({
            label: split.splitLabel || split.name,
            value: split.elapsedTimeLabel || split.timeLabel,
            timeOfDay: split.timeOfDayLabel,
            segmentTime: split.splitTimeLabel,
            paceSpeed: split.paceSpeedLabel,
            rank: positiveRank(split.positionLabel),
            leg: split.segment,
            distanceKm: numberValue(
              String(split.distanceLabel ?? "").match(/\d+(?:\.\d+)?/)?.[0],
            ),
          }));

  const meta: MetricRow[] = [];
  if (r?.eventCategory) meta.push({ label: "Event", value: r.eventCategory });
  if (r?.raceCategory) meta.push({ label: "Category", value: r.raceCategory });
  const ageGroup = firstText(
    officialResult.ageGroupName,
    officialResult.ageGroup,
    athlete.ageGroupName,
    athlete.ageGroup,
    athlete.ageCategory,
  );
  if (ageGroup) meta.push({ label: "Age Group", value: ageGroup });
  if (r?.raceDate) meta.push({ label: "Race Date", value: r.raceDate });
  if (r?.club) meta.push({ label: "Club", value: r.club });
  if (r?.location) meta.push({ label: "Location", value: r.location });
  if (r?.points != null)
    meta.push({ label: "Points", value: String(r.points) });

  const statusLabel =
    resultStatus === "DNF"
      ? "DNF"
      : resultStatus === "DNS"
        ? "DNS"
        : resultStatus === "DNQ"
          ? "DNQ"
          : resultStatus === "DSQ"
            ? "DSQ"
            : "Finished";

  const canonicalResolved = freshestResolvedState(res);
  const canonicalFinalElapsedMs = numberValue(
    canonicalResolved.finalElapsedMs ??
      canonicalResolved.officialResultElapsedMs ??
      canonicalResolved.officialElapsedMs,
  );
  const terminalElapsedSeconds =
    numberValue(
      terminalFinish?.overallElapsedSeconds ??
        terminalFinish?.elapsedSeconds ??
        terminalFinish?.time,
    ) ??
    (canonicalFinalElapsedMs != null && canonicalFinalElapsedMs > 0
      ? canonicalFinalElapsedMs / 1_000
      : numberValue(canonicalResolved.elapsedSeconds));
  const canonicalOverallSeconds = resolveOfficialRaceDurationSeconds({
    raceTiming,
    terminalElapsedSeconds,
  });
  // Result rows can publish `00:00:00` before their aggregate finish field is
  // populated even though accepted canonical start/finish reads are present.
  // Zero is a placeholder, not an official race duration.
  const publishedOfficialTime = [r?.officialTime, r?.chipTime, r?.gunTime].find(
    (value) => parseFinishDurationSeconds(value) != null,
  );
  const officialTime =
    publishedOfficialTime ||
    (canonicalOverallSeconds != null
      ? formatSecondsToHMS(canonicalOverallSeconds)
      : undefined);
  const publishedTotalKm =
    Number(res.courseOverview?.totalKm) > 0
      ? Number(res.courseOverview?.totalKm)
      : (res.courseOverview?.breakdown ?? []).reduce(
          (total, item) => total + (Number(item.distanceKm) || 0),
          0,
        );
  const resultDistanceKm = Math.max(
    publishedTotalKm,
    ...publishedSplits.map((split) => Number(split.distanceKm) || 0),
  );
  const overallFinishMetric = deriveOverallFinishMetric({
    durationSeconds: parseFinishDurationSeconds(officialTime),
    distanceKm: resultDistanceKm,
    raceCategory: firstText(
      r?.raceCategory,
      resolveProviderRaceCategory(res),
      res.athlete.raceCategory,
      res.athlete.contestName,
    ),
  });

  return {
    statusLabel,
    chipTime:
      parseFinishDurationSeconds(r?.chipTime) != null
        ? r?.chipTime
        : officialTime,
    gunTime: r?.gunTime,
    finishTimeOfDay:
      r?.finishTimeOfDay ||
      formatClockTime(
        terminalFinish?.readAt ??
          terminalFinish?.acceptedAt ??
          terminalFinish?.timestamp ??
          canonicalResolved.finishAt ??
          canonicalResolved.finishTimeUtc,
        eventTimezoneForResponse(res),
      ),
    officialTime,
    officialTimeBasis: r?.officialTimeBasis || "CHIP",
    averagePace: r?.averagePace || overallFinishMetric || undefined,
    sections: r?.sections?.length
      ? r.sections
      : raceTiming?.sections
          .filter((section) => section.durationSeconds != null)
          .map((section) => ({
            key: section.id,
            label: section.title,
            type: section.type,
            duration: formatSecondsToHMS(section.durationSeconds ?? 0),
            metric: section.averageMetric ?? undefined,
          })),
    ranks,
    splits,
    meta,
    progressPercent: r?.progressPercent ?? (status === "finished" ? 100 : 0),
    cutoffStatus: r?.cutoffStatus,
    cutoffTime: r?.cutoffTime,
    provisional: r?.provisional !== false,
  };
}

/**
 * Single source of truth: normalizes the raw `AthleteModalResponse` into a
 * fully display-ready view model. All formatting/derivation lives here so the
 * React layer stays pure rendering. Backend-enforced visibility is honored via
 * the `display*` fields; PRIVATE athletes short-circuit to an empty model.
 * When official results are available (post-race), live/estimated widgets are
 * dropped and the Official Results view model is surfaced. See docs/WEB_APP_ANALYSIS.md.
 */
function buildAthleteDetail(res: AthleteModalResponse): AthleteDetailView {
  const a = res.athlete;
  if (!a && process.env.NODE_ENV !== "production") {
    console.warn("mapAthleteDetail missing athlete payload", {
      success: res.success,
      eventId: res.eventId,
      hasContestContext: Boolean(res.contestContext),
    });
  }
  const visibility = resolveVisibility(res);
  const header = mapHeader(res, visibility);
  const isPrivate = visibility === "PRIVATE";
  const isAnonymous = visibility === "ANONYMOUS";
  const resolved = freshestResolvedState(res);
  const acceptedStart = hasStartedEvidence(res);
  const live = asRecord(res.participantLive);
  const canonicalStartTiming = asRecord(resolved.startTiming);
  const liveStartTiming = asRecord(live.startTiming);
  const acceptedStartSplit = acceptedMobileSplits(res).find(isRaceStartSplit);
  const acceptedStartReadAt = acceptedStartSplit
    ? (acceptedStartSplit.readAt ??
      acceptedStartSplit.acceptedAt ??
      acceptedStartSplit.acceptedTimestamp ??
      acceptedStartSplit.absoluteTimestamp ??
      acceptedStartSplit.timestamp ??
      acceptedStartSplit.occurredAt)
    : undefined;
  const resolvedStartStatus = text(
    resolved.status ?? resolved.timingState,
  ).toUpperCase();
  const startTiming = resolveStartTimingPresentation({
    officialTimingMode:
      resolved.officialTimingMode ??
      resolved.timingMode ??
      resolved.startTimingMode ??
      canonicalStartTiming.officialTimingMode ??
      canonicalStartTiming.mode ??
      canonicalStartTiming.startTimeSource ??
      liveStartTiming.officialTimingMode ??
      liveStartTiming.mode ??
      liveStartTiming.startTimeSource,
    status:
      acceptedStart && resolvedStartStatus === "DNS"
        ? "ON_COURSE"
        : (resolved.status ?? resolved.timingState),
    gunStartAt:
      resolved.gunStartAt ??
      resolved.officialGunStartAt ??
      resolved.gunStartTimeUtc ??
      resolved.gunStartTime ??
      canonicalStartTiming.gunStartAt ??
      canonicalStartTiming.officialGunStartAt ??
      canonicalStartTiming.officialStartTime ??
      liveStartTiming.gunStartAt ??
      liveStartTiming.officialGunStartAt ??
      liveStartTiming.officialStartTime,
    chipStartAt:
      resolved.chipStartAt ??
      resolved.acceptedChipStartAt ??
      resolved.acceptedStartAt ??
      resolved.startReaderAt ??
      canonicalStartTiming.chipStartAt ??
      canonicalStartTiming.acceptedChipStartAt ??
      canonicalStartTiming.chipStartDetectionTime ??
      canonicalStartTiming.acceptedStartAt ??
      canonicalStartTiming.startReaderAt ??
      liveStartTiming.chipStartAt ??
      liveStartTiming.acceptedChipStartAt ??
      liveStartTiming.chipStartDetectionTime ??
      liveStartTiming.acceptedStartAt ??
      liveStartTiming.startReaderAt ??
      acceptedStartReadAt,
    officialStartAt:
      resolved.officialStartAt ??
      resolved.athleteStartTimeUtc ??
      resolved.athleteStartTime ??
      canonicalStartTiming.officialStartAt ??
      canonicalStartTiming.officialStartTime ??
      canonicalStartTiming.athleteStartTimeUtc ??
      liveStartTiming.officialStartAt ??
      liveStartTiming.officialStartTime ??
      liveStartTiming.athleteStartTimeUtc,
    serverNow: resolved.serverNow ?? live.serverNow,
    hasAcceptedStart: acceptedStart,
    eventTimezone: resolved.eventTimezone ?? eventTimezoneForResponse(res),
  });

  const completeTimeline = mapTimeline(res);
  const cutoffRecord = asRecord(resolved.cutoff);
  const cutoffDeadlineAt = timestampValue(
    cutoffRecord.deadlineAt ?? cutoffRecord.deadlineUtc,
  );
  const cutoffSeconds = numberValue(cutoffRecord.cutoffSeconds);
  const cutoffBasis = firstText(
    cutoffRecord.basis,
    resolved.officialTimingMode,
    resolved.timingMode,
  ).toUpperCase();
  const activeCutoff =
    cutoffDeadlineAt != null && cutoffSeconds != null
      ? {
          checkpointKey: firstText(
            cutoffRecord.checkpointKey,
            cutoffRecord.boundarySplitKey,
          ),
          checkpointLabel: firstText(
            cutoffRecord.checkpointLabel,
            cutoffRecord.displayName,
            "Cutoff",
          ),
          basis: (cutoffBasis === "CHIP"
            ? "CHIP"
            : cutoffBasis === "WAVE"
              ? "WAVE"
              : "GUN") as "CHIP" | "GUN" | "WAVE",
          cutoffSeconds,
          deadlineAt: cutoffDeadlineAt,
          state: (():
            "UPCOMING" | "SAFE" | "AT_RISK" | "MISSED" | "CONFIRMED_CUTOFF" => {
            const state = firstText(cutoffRecord.state).toUpperCase();
            return [
              "UPCOMING",
              "SAFE",
              "AT_RISK",
              "MISSED",
              "CONFIRMED_CUTOFF",
            ].includes(state)
              ? (state as
                  | "UPCOMING"
                  | "SAFE"
                  | "AT_RISK"
                  | "MISSED"
                  | "CONFIRMED_CUTOFF")
              : "UPCOMING";
          })(),
          resolvedAt: timestampValue(cutoffRecord.resolvedAt),
          failureReason: firstText(cutoffRecord.failureReason) || undefined,
        }
      : undefined;
  const raceTiming = mapDerivedRaceTiming(res);
  const canonicalPrediction = mapCanonicalPrediction(res);
  const nextSplit = mapDerivedNextSplit(res, canonicalPrediction);
  const predictedCheckpoints = mapPredictedCheckpoints(
    res,
    canonicalPrediction,
  );
  const prediction = mapDerivedFinish(res, canonicalPrediction);
  const predictionState: AthletePredictionStateView = {
    raceState: canonicalPrediction.raceState,
    suppressed: canonicalPrediction.predictionSuppressed,
    suppressionReason: canonicalPrediction.suppressionReason,
    remainingDistanceKm: canonicalPrediction.remainingDistanceKm,
    nextCheckpoint: nextSplit ?? null,
    remainingCheckpoints: predictedCheckpoints,
    projectedFinish: prediction ?? null,
  };
  const result = mapResult(res, header.status, raceTiming, completeTimeline);
  const hasOfficialResults = Boolean(result);
  const participantTimelineCacheKey = [
    canonicalAthletePresentationIdentity(res) ?? "uncached-canonical",
    firstText(res.activeVersion, res.courseVersion, "unversioned"),
  ].join(":");
  const timeline = projectProgressiveTimeline({
    timeline: completeTimeline,
    terminal: hasOfficialResults,
    nextSplit,
    expectedStartLabel: startTiming.gunStartLabel,
    participantCacheKey: participantTimelineCacheKey,
    athleteStatus: header.status,
    currentLeg: firstText(resolved.currentLeg, live.currentLeg),
    currentSplit: firstText(resolved.currentSplit, live.currentSplit),
  });

  const base = {
    id: isAnonymous ? "anonymous-athlete" : (a.id ?? a.bib ?? ""),
    participantUuid:
      firstText(a.participantUuid, live.participantUuid) || undefined,
    canonicalVersion:
      firstText(res.activeVersion, res.courseVersion) || undefined,
    liveRevision:
      typeof (res as Record<string, unknown>).liveRevision === "number" ||
      typeof (res as Record<string, unknown>).liveRevision === "string"
        ? ((res as Record<string, unknown>).liveRevision as string | number)
        : typeof live.liveRevision === "number" ||
            typeof live.liveRevision === "string"
          ? (live.liveRevision as string | number)
          : undefined,
    visibility,
    isAnonymous,
    isPrivate,
    hasOfficialResults,
    result,
    predictionState,
    header,
    startTiming,
    activeCutoff,
    raceStartedAt: startTiming.officialStartAt,
  };

  // PRIVATE: tracking is unavailable — expose only the visibility flag so the
  // UI can render an "unavailable" state. No race data is surfaced.
  if (isPrivate) {
    const mapped = {
      ...base,
      lifecycle: { frozen: false },
      liveStats: [],
      courseOverview: [],
      rankings: [],
      cutoffs: [],
      timeline: [],
      replay: { available: false },
    };
    return mapped;
  }

  // OFFICIAL RESULTS mode: drop prediction / estimated position / ETA / live map;
  // the Official Results card + timeline carry the finished data.
  if (hasOfficialResults) {
    const resultTrack = mapTrack(res, canonicalPrediction);
    const mapped = {
      ...base,
      track: resultTrack,
      lifecycle: { frozen: false },
      liveStats: [],
      courseOverview: mapCourseOverview(res),
      // Compact finish metrics and the full Official Results card must consume
      // the same canonical rank values.
      rankings: result?.ranks ?? [],
      cutoffs: [],
      nextSplit: undefined,
      predictedCheckpoints: [],
      prediction: undefined,
      timeline,
      raceTiming,
      replay: { available: true },
    };
    if (process.env.NODE_ENV !== "production") {
      console.debug("[prediction-runtime][MAPPER]", {
        bib: a.bib,
        status: header.status,
        hasResult: true,
        predictionState,
        legacyEstimatedFinish: a.estimatedFinish,
        legacyNextSplit: res.nextSplitPrediction?.checkpoint,
      });
    }
    return mapped;
  }

  const track = mapTrack(res, canonicalPrediction);
  const mapped = {
    ...base,
    track,
    liveLocation: mapLiveLocation(res),
    liveLocationSource: firstText(
      asRecord(res.participantLive).positionSource,
      asRecord(asRecord(res.participantLive).resolvedRaceState).positionSource,
      asRecord(res.athlete).positionSource,
    ).toUpperCase(),
    lifecycle: mapLifecycle(res),
    liveStats: mapLiveStats(
      a,
      res.participantLive,
      header.status === "finished",
    ),
    raceProgress: mapRaceProgress(res),
    courseOverview: mapCourseOverview(res),
    livePosition: mapLivePosition(res),
    rankings: mapRankings(a),
    cutoffs: mapContestCutoffs(res),
    nextSplit,
    predictedCheckpoints,
    prediction,
    timeline,
    raceTiming,
    replay: { available: header.status === "finished" },
  };
  if (process.env.NODE_ENV !== "production") {
    console.debug("[prediction-runtime][MAPPER]", {
      bib: a.bib,
      status: header.status,
      predictionState,
      legacyEstimatedFinish: a.estimatedFinish,
      legacyNextSplit: res.nextSplitPrediction?.checkpoint,
    });
  }
  return mapped;
}

const athleteDetailPresentationCache = new Map<
  string,
  { fingerprint: string; detail: AthleteDetailView }
>();
const MAX_ATHLETE_PRESENTATION_CACHE = 50;

function acceptedSplitRevision(split: Record<string, unknown>): string {
  return [
    ...splitKeyCandidates(split),
    firstText(
      split.acceptedTimestamp,
      split.acceptedAt,
      split.readAt,
      split.timestamp,
      split.absoluteTimestamp,
    ),
    firstText(split.elapsedSeconds, split.cumulativeElapsedSeconds, split.time),
    firstText(
      split.overallRank,
      split.genderRank,
      split.ageGroupRank,
      split.rank,
    ),
  ].join("|");
}

export function athletePresentationFingerprint(
  res: AthleteModalResponse,
): string {
  const athlete = asRecord(res.athlete);
  const live = asRecord(res.participantLive);
  const resolved = freshestResolvedState(res);
  const result = asRecord(res.result);
  return [
    firstText(res.activeVersion, res.courseVersion, "unversioned"),
    [
      athlete.displayName,
      athlete.name,
      athlete.bib,
      athlete.category,
      athlete.ageGroup,
      athlete.ageGroupName,
      athlete.visibility,
      res.visibility,
    ]
      .map(text)
      .join("|"),
    firstText(
      resolved.status,
      resolved.timingState,
      result.status,
      athlete.status,
    ),
    firstText(resolved.currentLeg, live.currentLeg, athlete.currentLeg),
    firstText(resolved.currentSplit, live.currentSplit, athlete.currentSplit),
    firstText(
      resolved.officialDistanceKm,
      resolved.latestCumulativeDistanceKm,
      live.progressPercent,
    ),
    firstText(
      resolved.timingVersion,
      live.timingVersion,
      live.participantRevision,
      resolved.participantRevision,
      result.revision,
      result.resultRevision,
    ),
    firstText(
      result.chipTime,
      result.officialTime,
      result.finishTime,
      result.overallRank,
      result.genderRank,
      result.ageGroupRank,
      athlete.overallRank,
      athlete.genderRank,
      athlete.ageGroupRank,
    ),
    firstText(
      live.latitude,
      live.longitude,
      live.lat,
      live.lng,
      athlete.latitude,
      athlete.longitude,
      athlete.lat,
      athlete.lng,
    ),
    firstText(
      resolved.gunStartAt,
      resolved.chipStartAt,
      resolved.officialStartAt,
      athlete.startTime,
    ),
    acceptedMobileSplits(res).map(acceptedSplitRevision).join(";"),
  ].join("\u001e");
}

/**
 * Participant-scoped warm presentation cache. Heartbeats and unrelated
 * participant updates return the exact same view model without rebuilding the
 * timeline or prediction. A canonical version/result revision change always
 * produces a fresh representation.
 */
export function mapAthleteDetail(res: AthleteModalResponse): AthleteDetailView {
  const participantUuid = canonicalAthletePresentationIdentity(res);
  // Non-canonical payloads are intentionally never admitted to the warm
  // participant cache. LiveTrackScreen paints those through the PRE_CANONICAL
  // presenter and only invokes this mapper after canonical hydration.
  if (!participantUuid) {
    recordLivePerformance("timelineDerivations");
    return buildAthleteDetail(res);
  }
  const fingerprint = athletePresentationFingerprint(res);
  const cached = athleteDetailPresentationCache.get(participantUuid);
  if (cached?.fingerprint === fingerprint) {
    recordLivePerformance("timelineCacheReads");
    athleteDetailPresentationCache.delete(participantUuid);
    athleteDetailPresentationCache.set(participantUuid, cached);
    return cached.detail;
  }

  if (process.env.NODE_ENV !== "production") {
    console.debug("LIVE_TIMELINE_BUILD", {
      participantUuid,
      reason: cached ? "participant_revision_changed" : "cold_load",
    });
  }
  if (cached) recordLivePerformance("participantRevisionChanges");
  recordLivePerformance("timelineDerivations");
  const detail = buildAthleteDetail(res);
  athleteDetailPresentationCache.set(participantUuid, { fingerprint, detail });
  if (athleteDetailPresentationCache.size > MAX_ATHLETE_PRESENTATION_CACHE) {
    const oldest = athleteDetailPresentationCache.keys().next().value;
    if (oldest) athleteDetailPresentationCache.delete(oldest);
  }
  if (process.env.NODE_ENV !== "production" && detail.hasOfficialResults) {
    console.debug("FINISHED_VIEW_BUILD", {
      participantUuid,
      reason: cached ? "canonical_revision_changed" : "cold_load",
    });
  }
  return detail;
}
