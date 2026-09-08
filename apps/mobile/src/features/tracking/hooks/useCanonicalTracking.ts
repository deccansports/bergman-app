import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  CanonicalTrackingRepository,
  resolveCanonicalAvailability,
  type CanonicalAthleteLookup,
  type CanonicalParticipantIndex,
} from "@/core/repositories/canonicalTracking.repository";
import { queryKeys } from "@/core/services/query/queryKeys";

const activeVersions = new Map<string, string>();
const CANONICAL_PARTICIPANT_RECOVERY_INTERVAL_MS = 30_000;
const participantCacheKey = (
  eventId: string,
  providerEventUuid: string | undefined,
  activeVersion: string,
) =>
  `bergman:canonical-participants:${eventId}:${providerEventUuid || "event-wide"}:${activeVersion}`;

export function useCanonicalAvailability(
  eventId: string,
  enabled = true,
  providerEventUuid?: string,
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [
      ...queryKeys.canonical.availability(eventId),
      providerEventUuid || "scope-required",
    ],
    queryFn: ({ signal }) =>
      resolveCanonicalAvailability(eventId, signal, providerEventUuid),
    enabled: enabled && Boolean(eventId) && Boolean(providerEventUuid),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!eventId || !query.data) return;
    if (!query.data.ready) {
      const unavailableReason = query.data.reason;
      if (
        unavailableReason === "visibility_disabled" ||
        unavailableReason === "connection_removed"
      ) {
        const normalizedProviderScope = String(
          providerEventUuid ?? "",
        ).toLowerCase();
        const scopeKey = `${eventId}:${providerEventUuid || ""}`;
        const previous = activeVersions.get(scopeKey);
        queryClient.removeQueries({
          predicate: ({ queryKey }) =>
            queryKey[0] === "canonical-live" &&
            queryKey[1] === eventId &&
            queryKey[2] !== "availability" &&
            (unavailableReason === "visibility_disabled" ||
              (Boolean(previous) && queryKey[2] === previous) ||
              queryKey.some(
                (part) =>
                  normalizedProviderScope &&
                  String(part).toLowerCase() === normalizedProviderScope,
              )),
        });
        queryClient.removeQueries({
          predicate: ({ queryKey }) => {
            if (queryKey[0] === "tracking" && queryKey[1] === "participants")
              return queryKey[2] === eventId;
            if (queryKey[0] === "tracking" && queryKey[1] === "athlete-search")
              return queryKey[2] === eventId;
            if (
              (queryKey[0] === "mobile-live-participant" ||
                queryKey[0] === "canonical-athlete") &&
              queryKey[1] === eventId
            )
              return (
                unavailableReason === "visibility_disabled" ||
                String(queryKey[2] ?? "").toLowerCase() ===
                  normalizedProviderScope
              );
            if (queryKey[0] === "tracking" && queryKey[1] === "course-map")
              return (
                queryKey[2] === eventId &&
                (unavailableReason === "visibility_disabled" ||
                  queryKey.some(
                    (part) =>
                      String(part).toLowerCase() === normalizedProviderScope,
                  ))
              );
            return false;
          },
        });
        queryClient.removeQueries({
          queryKey: ["tracking", "athlete-detail", eventId],
        });
        if (previous) {
          void AsyncStorage.removeItem(
            participantCacheKey(eventId, providerEventUuid, previous),
          ).catch(() => undefined);
        }
        activeVersions.delete(scopeKey);
      }
      return;
    }
    const scopeKey = `${eventId}:${providerEventUuid || ""}`;
    const previous = activeVersions.get(scopeKey);
    if (previous && previous !== query.data.activeVersion) {
      queryClient.removeQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === "canonical-live" &&
          queryKey[1] === eventId &&
          queryKey[2] === previous,
      });
    }
    activeVersions.set(scopeKey, query.data.activeVersion);
  }, [eventId, providerEventUuid, query.data, queryClient]);

  return query;
}

export function useCanonicalParticipants(
  eventId: string,
  activeVersion: string | undefined,
  enabled: boolean,
  polling: boolean,
  providerEventUuid?: string,
) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: [
      ...queryKeys.canonical.participants(eventId, activeVersion ?? "pending"),
      providerEventUuid || "event-wide",
    ],
    queryFn: async ({ signal }) => {
      const storageKey = participantCacheKey(
        eventId,
        providerEventUuid,
        activeVersion as string,
      );
      const cached = await AsyncStorage.getItem(storageKey).catch(() => null);
      if (cached) {
        try {
          return JSON.parse(cached) as CanonicalParticipantIndex;
        } catch {
          /* fetch and repair below */
        }
      }
      const result = await CanonicalTrackingRepository.getCanonicalParticipants(
        eventId,
        signal,
        providerEventUuid,
      );
      if (result.activeVersion !== activeVersion) {
        queryClient.removeQueries({
          predicate: ({ queryKey }) =>
            queryKey[0] === "canonical-live" &&
            queryKey[1] === eventId &&
            queryKey[2] === activeVersion,
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.canonical.availability(eventId),
        });
        throw new Error("CANONICAL_ACTIVE_VERSION_CHANGED");
      }
      await AsyncStorage.setItem(storageKey, JSON.stringify(result.data)).catch(
        () => undefined,
      );
      return result.data;
    },
    enabled: enabled && Boolean(eventId) && Boolean(activeVersion),
    staleTime: 750,
    // The participant index is a large event-wide artifact. Canonical-change
    // notifications drive normal updates; this remains recovery-only polling.
    refetchInterval: polling
      ? CANONICAL_PARTICIPANT_RECOVERY_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
    retry: false,
  });
}

function lookupIdentity(lookup: CanonicalAthleteLookup): string {
  const [key, value] = Object.entries(lookup)[0];
  return `${key}:${value}`;
}

export function useCanonicalAthlete(
  eventId: string,
  activeVersion: string | undefined,
  lookup: CanonicalAthleteLookup | undefined,
  enabled: boolean,
  polling: boolean,
) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.canonical.athlete(
      eventId,
      activeVersion ?? "pending",
      lookup ? lookupIdentity(lookup) : "missing",
    ),
    queryFn: async ({ signal }) => {
      if (!lookup) throw new Error("CANONICAL_ATHLETE_LOOKUP_REQUIRED");
      const result = await CanonicalTrackingRepository.getCanonicalAthlete(
        eventId,
        lookup,
        signal,
      );
      if (result.activeVersion !== activeVersion) {
        queryClient.removeQueries({
          predicate: ({ queryKey }) =>
            queryKey[0] === "canonical-live" &&
            queryKey[1] === eventId &&
            queryKey[2] === activeVersion,
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.canonical.availability(eventId),
        });
        throw new Error("CANONICAL_ACTIVE_VERSION_CHANGED");
      }
      return result.data;
    },
    enabled:
      enabled && Boolean(eventId) && Boolean(activeVersion) && Boolean(lookup),
    staleTime: 750,
    // Canonical-change notifications are the fast path. Keep this recovery
    // read aligned with the bounded live-athlete fallback instead of churning
    // the JS/native bridge once per second on the map screen.
    refetchInterval: polling ? 10_000 : false,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
    retry: false,
  });
}

export function useCanonicalLeaderboardManifest(
  eventId: string,
  contestUuid: string | undefined,
  enabled: boolean,
  providerEventUuid?: string,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.canonical.leaderboardManifest(
        eventId,
        contestUuid ?? "missing",
      ),
      providerEventUuid || "scope-required",
    ],
    queryFn: async ({ signal }) => {
      if (!contestUuid) throw new Error("CANONICAL_CONTEST_UUID_REQUIRED");
      const result =
        await CanonicalTrackingRepository.getCanonicalLeaderboardManifest(
          eventId,
          contestUuid,
          signal,
          providerEventUuid,
        );
      return result.data;
    },
    enabled:
      enabled &&
      Boolean(eventId) &&
      Boolean(contestUuid) &&
      Boolean(providerEventUuid),
    staleTime: 60_000,
    retry: false,
  });
}
