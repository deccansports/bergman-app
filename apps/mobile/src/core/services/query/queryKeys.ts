import type { LeaderboardFilters } from "@/core/repositories";
import type {
  AthleteDetailParams,
  AthleteSearchMode,
} from "@/core/repositories/athlete.repository";
import {
  normalizeProviderContestUuid,
  normalizeProviderEventUuid,
} from "@/features/tracking/providerScope";

// Increment only when the normalized canonical-athlete view contract changes.
// This prevents an OTA from reusing an indefinitely-fresh snapshot produced by
// an older mapper that omitted configured split/section rows.
export const CANONICAL_ATHLETE_VIEW_SCHEMA_VERSION = "split-flow-v2";

/**
 * Centralized React Query keys for the whole app. All hooks import from here so
 * caching and invalidation are consistent.
 */
export const queryKeys = {
  athleteDashboard: () => ["dashboard", "athlete"] as const,
  athleteProfile: () => ["profile", "me"] as const,
  events: {
    list: ["events", "public-list-v2"] as const,
    scopedList: (scope: string) => ["events", "public-list-v2", scope] as const,
    detail: (eventId: string) => ["events", "detail", eventId] as const,
    live: (eventId: string) => ["events", "live", eventId] as const,
    courseIndex: (eventId: string) =>
      ["events", "course-index", eventId] as const,
    tracking: (eventId: string) => ["events", "tracking", eventId] as const,
    broadcast: (eventId: string) => ["events", "broadcast", eventId] as const,
    tickets: (eventId: string) => ["events", "tickets", eventId] as const,
    partners: (eventId: string) => ["events", "partners", eventId] as const,
    rules: (eventId: string) => ["events", "rules", eventId] as const,
  },
  announcements: {
    active: ["announcements", "active"] as const,
  },
  homepage: {
    slider: ["homepage", "slider"] as const,
  },
  dashboard: {
    athlete: ["dashboard", "athlete"] as const,
    athleteProfile: (athleteId: string) =>
      ["dashboard", "athlete-profile", athleteId] as const,
  },
  rankings: {
    years: ["rankings", "athletes", "years"] as const,
    athletes: (filters: Record<string, unknown>) =>
      ["rankings", "athletes", filters] as const,
    clubs: (filters: Record<string, unknown>) =>
      ["rankings", "clubs", filters] as const,
  },
  training: ["training"] as const,
  leaderboardScopes: (eventId: string) =>
    ["live-leaderboard-scopes", eventId] as const,
  leaderboard: (eventId: string, filters?: LeaderboardFilters) => {
    const providerEventUuid = normalizeProviderEventUuid(
      filters?.providerEventUuid,
    );
    const contestUuid = normalizeProviderContestUuid(
      filters?.contestUuid ?? filters?.contest,
    );
    const {
      providerEventUuid: _provider,
      contestUuid: _contestUuid,
      contest: _contest,
      ...rest
    } = filters ?? {};
    return [
      "live-leaderboard",
      eventId,
      providerEventUuid || "scope-unresolved",
      contestUuid || "contest-unresolved",
      rest,
    ] as const;
  },
  eventResults: (eventId: string) =>
    ["tracking", "event-results", eventId] as const,
  participants: (eventId: string) =>
    ["tracking", "participants", eventId] as const,
  accountWatchlist: (userId: string) =>
    ["tracking", "account-watchlist", userId] as const,
  athleteSearch: (eventId: string, q: string, mode?: AthleteSearchMode) =>
    ["tracking", "athlete-search", eventId, mode ?? "name", q] as const,
  athleteDetail: (eventId: string, params: AthleteDetailParams | string) =>
    ["tracking", "athlete-detail", eventId, params] as const,
  canonicalAthlete: (
    eventId: string,
    providerEventUuid: string,
    participantUuid: string,
  ) =>
    [
      "canonical-athlete",
      eventId,
      normalizeProviderEventUuid(providerEventUuid),
      participantUuid,
      CANONICAL_ATHLETE_VIEW_SCHEMA_VERSION,
    ] as const,
  mobileLiveParticipant: (
    eventId: string,
    providerEventUuid: string,
    participantUuid: string,
  ) =>
    [
      "mobile-live-participant",
      eventId,
      normalizeProviderEventUuid(providerEventUuid),
      participantUuid,
      "v1",
    ] as const,
  athleteRefresh: (eventId: string, params: AthleteDetailParams | string) =>
    ["tracking", "athlete-detail", eventId, params, "athleteOnly"] as const,
  courseMap: (eventId: string) => ["tracking", "course-map", eventId] as const,
  canonical: {
    event: (eventId: string) => ["canonical-live", eventId] as const,
    availability: (eventId: string) =>
      ["canonical-live", eventId, "availability"] as const,
    course: (eventId: string, activeVersion: string) =>
      ["canonical-live", eventId, activeVersion, "course"] as const,
    participants: (eventId: string, activeVersion: string) =>
      ["canonical-live", eventId, activeVersion, "participants"] as const,
    leaderboardManifest: (eventId: string, contestUuid: string) =>
      ["canonical-live", eventId, "leaderboard-manifest", contestUuid] as const,
    athlete: (eventId: string, activeVersion: string, identity: string) =>
      ["canonical-live", eventId, activeVersion, "athlete", identity] as const,
    leaderboard: (
      eventId: string,
      activeVersion: string,
      contestUuid: string,
      mode: string,
      qualifier = "",
    ) =>
      [
        "canonical-live",
        eventId,
        activeVersion,
        "leaderboard",
        contestUuid,
        mode,
        qualifier,
      ] as const,
    split: (
      eventId: string,
      activeVersion: string,
      contestUuid: string,
      splitKey: string,
      mode: string,
      qualifier = "",
    ) =>
      [
        "canonical-live",
        eventId,
        activeVersion,
        "split",
        contestUuid,
        splitKey,
        mode,
        qualifier,
      ] as const,
  },
  results: (eventId: string, bib: string) => ["results", eventId, bib] as const,
  certificates: ["certificates"] as const,
  profile: (uid: string) => ["profile", uid] as const,
} as const;
