import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";

export type LiveTimingParticipantScope = {
  eventId: string;
  providerEventUuid?: string | null;
  participantUuid?: string | null;
  providerParticipantUuid?: string | null;
  bib?: string | null;
};

type LiveTimingRefetchType = "all" | "active" | "inactive" | "none";

function normalized(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function matchesIdentity(value: unknown, identities: Set<string>): boolean {
  if (typeof value === "string") {
    const candidate = normalized(value);
    return (
      Boolean(candidate) &&
      (identities.has(candidate) ||
        [...identities].some((identity) =>
          value.toLowerCase().includes(identity),
        ))
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return [
    record.participantUuid,
    record.providerParticipantUuid,
    record.providerUuid,
    record.providerAthleteUuid,
    record.providerTimingUuid,
    record.providerRecordId,
    record.bib,
    record.bibNumber,
  ].some((candidate) => identities.has(normalized(candidate)));
}

function isParticipantLiveTimingQuery(
  queryKey: QueryKey,
  scope: LiveTimingParticipantScope,
): boolean {
  const eventId = normalized(scope.eventId);
  const queryEventId =
    queryKey[0] === "tracking"
      ? normalized(queryKey[2])
      : normalized(queryKey[1]);
  if (!eventId || queryEventId !== eventId) return false;
  const identities = new Set(
    [scope.participantUuid, scope.providerParticipantUuid, scope.bib]
      .map(normalized)
      .filter(Boolean),
  );
  if (identities.size === 0) return false;
  const providerEventUuid = normalized(scope.providerEventUuid);
  if (
    queryKey[0] === "mobile-live-participant" ||
    queryKey[0] === "canonical-athlete"
  ) {
    return (
      (!providerEventUuid || normalized(queryKey[2]) === providerEventUuid) &&
      matchesIdentity(queryKey[3], identities)
    );
  }
  if (queryKey[0] === "tracking" && queryKey[1] === "athlete-detail") {
    return (
      normalized(queryKey[2]) === eventId &&
      matchesIdentity(queryKey[3], identities)
    );
  }
  if (queryKey[0] === "canonical-live" && queryKey[3] === "athlete") {
    return matchesIdentity(queryKey[4], identities);
  }
  return false;
}

/**
 * Refresh only cached athlete views whose identity is present in a canonical
 * change or timing push. This deliberately excludes other athletes in the
 * same event.
 */
export function invalidateLiveTimingParticipant(
  client: QueryClient,
  scope: LiveTimingParticipantScope,
  refetchType: LiveTimingRefetchType = "active",
) {
  return client.invalidateQueries({
    predicate: ({ queryKey }) => isParticipantLiveTimingQuery(queryKey, scope),
    refetchType,
  });
}

/** Refresh active live-tracking observers after the native app resumes. */
export function invalidateActiveLiveTimingQueries(client: QueryClient) {
  return client.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === "mobile-live-participant" ||
      queryKey[0] === "canonical-athlete" ||
      queryKey[0] === "canonical-live" ||
      (queryKey[0] === "tracking" &&
        [
          "athlete-detail",
          "athlete-search",
          "leaderboard",
          "participants",
        ].includes(String(queryKey[1]))),
    refetchType: "active",
  });
}

/** Event-level fallback for a push without a participant identity. */
export function invalidateLiveTimingEvent(
  client: QueryClient,
  eventId: string,
) {
  const normalizedEventId = normalized(eventId);
  return client.invalidateQueries({
    predicate: ({ queryKey }) => {
      const queryEventId =
        queryKey[0] === "tracking"
          ? normalized(queryKey[2])
          : normalized(queryKey[1]);
      return (
        queryEventId === normalizedEventId &&
        (queryKey[0] === "mobile-live-participant" ||
          queryKey[0] === "canonical-athlete" ||
          queryKey[0] === "canonical-live" ||
          (queryKey[0] === "tracking" &&
            [
              "athlete-detail",
              "athlete-search",
              "leaderboard",
              "participants",
            ].includes(String(queryKey[1]))))
      );
    },
    refetchType: "active",
  });
}

/**
 * Centralized React Query invalidation helpers. Use these instead of inlining
 * invalidateQueries calls so cache invalidation stays consistent.
 */
export const queryInvalidation = {
  events: () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.events.list }),
  eventTracking: (eventId: string) =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.events.tracking(eventId),
    }),
  leaderboard: (eventId: string) =>
    queryClient.invalidateQueries({
      queryKey: ["tracking", "leaderboard", eventId],
    }),
  athleteSearch: (eventId: string) =>
    queryClient.invalidateQueries({
      queryKey: ["tracking", "athlete-search", eventId],
    }),
  athleteDetail: (eventId: string) =>
    queryClient.invalidateQueries({
      queryKey: ["tracking", "athlete-detail", eventId],
    }),
  courseMap: (eventId: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.courseMap(eventId) }),
  profile: (uid: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.profile(uid) }),
  /** Invalidate every live-tracking query for an event (leaderboard/search/detail/course). */
  tracking: (eventId: string) => {
    void queryInvalidation.leaderboard(eventId);
    void queryInvalidation.athleteSearch(eventId);
    void queryInvalidation.athleteDetail(eventId);
    void queryInvalidation.courseMap(eventId);
  },
  clearAll: () => queryClient.clear(),
};
