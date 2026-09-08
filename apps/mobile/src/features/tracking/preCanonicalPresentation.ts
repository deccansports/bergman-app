import type { AthleteDetailViewModel } from "./mappers";

export type PreCanonicalAthleteIdentity = {
  id?: string;
  bib?: string;
  name?: string;
  category?: string;
  ageGroup?: string;
  club?: string;
  photoUrl?: string;
  raceDate?: string;
};

export type TrackedAthleteTimingSummary = PreCanonicalAthleteIdentity & {
  participantUuid?: string;
  status?: string;
  currentLeg?: string;
  progressPercent?: number;
  participantLive?: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scalarText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const candidate = String(value).trim();
    if (candidate) return candidate;
  }
  return "";
}

function trackedSummaryRaceState(status: string): {
  status: AthleteDetailViewModel["header"]["status"];
  label: string;
} | null {
  const normalized = status.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "FINISHED" || normalized === "COMPLETED") {
    return { status: "finished", label: "FINISHED" };
  }
  if (
    normalized === "ON_COURSE" ||
    normalized === "LIVE" ||
    normalized === "ACTIVE" ||
    normalized === "STARTED"
  ) {
    return { status: "live", label: "LIVE" };
  }
  if (normalized === "UPCOMING" || normalized === "SCHEDULED") {
    return { status: "upcoming", label: "EVENT NOT STARTED" };
  }
  if (
    normalized === "NOT_STARTED" ||
    normalized === "WAITING_START" ||
    normalized === "WAITING_CHIP_START" ||
    normalized === "REGISTERED"
  ) {
    return {
      status: "notStarted",
      label:
        normalized === "WAITING_CHIP_START"
          ? "WAITING TO START"
          : "NOT STARTED",
    };
  }
  if (["DNF", "DNS", "DNQ", "DSQ"].includes(normalized)) {
    return { status: "notStarted", label: normalized };
  }
  return null;
}

/**
 * Identity-only watchlist rows are useful for painting the selected card while
 * canonical hydration is in flight. They are deliberately not timing input:
 * there is no prediction state, course state, race progress, or timeline.
 */
export function buildPreCanonicalAthletePresentation(
  athlete: PreCanonicalAthleteIdentity,
): AthleteDetailViewModel {
  return {
    id: athlete.id ?? athlete.bib ?? "pre-canonical-athlete",
    visibility: "PUBLIC",
    isAnonymous: false,
    isPrivate: false,
    hasOfficialResults: false,
    header: {
      name: athlete.name ?? (athlete.bib ? `Bib ${athlete.bib}` : "Athlete"),
      photo: athlete.photoUrl,
      bib: athlete.bib ?? "",
      contest: athlete.category,
      raceCategory: athlete.category,
      category: athlete.ageGroup,
      club: athlete.club,
      eventDate: athlete.raceDate,
      anonymous: false,
      status: "upcoming",
      statusLabel: "LOADING LIVE TIMING…",
    },
    startTiming: {
      officialTimingMode: "GUN",
      canonicalStatus: "",
      waitingForChipStart: false,
      hasAcceptedStart: false,
      statusLabel: "",
      showRaceClock: false,
      showCutoffClock: false,
    },
    lifecycle: { label: "Loading live timing…", frozen: false },
    liveStats: [],
    courseOverview: [],
    rankings: [],
    cutoffs: [],
    timeline: [],
    replay: { available: false },
  };
}

/**
 * Paint a non-selected tracked card from its compact watchlist/socket state.
 * This does not derive timing or predictions. It only prevents an already
 * known canonical race state from being replaced by the identity-only loading
 * placeholder while another participant owns the detail request.
 */
export function buildTrackedAthleteSummaryPresentation(
  athlete: TrackedAthleteTimingSummary,
): AthleteDetailViewModel {
  const base = buildPreCanonicalAthletePresentation(athlete);
  const participantLive = record(athlete.participantLive);
  const resolved = record(participantLive.resolvedRaceState);
  const raceState = trackedSummaryRaceState(
    scalarText(resolved.status, participantLive.status, athlete.status),
  );
  if (!raceState) return base;

  const resolvedRatio = Number(resolved.officialProgressRatio);
  const resolvedPercent = Number(resolved.officialProgressPercent);
  const suppliedPercent = Number(athlete.progressPercent);
  const progressPercent = Number.isFinite(resolvedRatio)
    ? resolvedRatio * 100
    : Number.isFinite(resolvedPercent)
      ? resolvedPercent
      : Number.isFinite(suppliedPercent)
        ? suppliedPercent
        : 0;
  const boundedProgress = Math.max(0, Math.min(100, progressPercent));
  const currentLeg = scalarText(
    resolved.currentLeg,
    participantLive.currentLeg,
    athlete.currentLeg,
  );

  return {
    ...base,
    participantUuid:
      scalarText(
        resolved.participantUuid,
        participantLive.participantUuid,
        athlete.participantUuid,
      ) || undefined,
    header: {
      ...base.header,
      status: raceState.status,
      statusLabel: raceState.label,
    },
    startTiming: {
      ...base.startTiming,
      canonicalStatus: scalarText(
        resolved.status,
        participantLive.status,
        athlete.status,
      ).toUpperCase(),
      waitingForChipStart:
        scalarText(
          resolved.status,
          participantLive.status,
          athlete.status,
        ).toUpperCase() === "WAITING_CHIP_START",
      hasAcceptedStart:
        raceState.status === "live" || raceState.status === "finished",
      statusLabel: raceState.label,
      showRaceClock: raceState.status === "live",
    },
    lifecycle: { label: raceState.label, frozen: false },
    raceProgress: {
      legLabel: currentLeg || raceState.label,
      raceCategory: athlete.category,
      percentLabel: `${Math.round(boundedProgress)}%`,
      progress: boundedProgress / 100,
      coveredLabel: "—",
      remainingLabel: "—",
    },
  };
}
