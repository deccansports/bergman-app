import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { invalidateLiveTimingParticipant } from "@/core/services/query/queryInvalidation";
import { queryKeys } from "@/core/services/query/queryKeys";
import { normalizeProviderEventUuid } from "@/features/tracking/providerScope";
import { recordLivePerformance } from "@/features/tracking/livePerformanceDiagnostics";
import { mergeAthleteStateWithoutRegression } from "@/features/tracking/athleteCacheAuthority";
import {
  subscribeCanonicalSocket,
  type CanonicalChangeEvent,
  type CanonicalSocketLease,
  type CanonicalSocketRecoveryReason,
} from "./canonicalSocketRegistry";

export type CanonicalAthleteQueryReason =
  | "INITIAL_LOAD"
  | "SOCKET_PARTICIPANT_CHANGE"
  | "MANUAL_REFRESH"
  | "FOREGROUND_RECOVERY"
  | "NETWORK_RECOVERY"
  | "SOCKET_DISCONNECTED_FALLBACK";

type CanonicalChangeSocketOptions = {
  selectedParticipantUuid?: string;
  onAthleteInvalidated?: (
    reason: CanonicalAthleteQueryReason,
  ) => Promise<unknown> | unknown;
};

function identityMatches(value: unknown, participantUuid: string): boolean {
  if (!value || typeof value !== "object") return false;
  const identity = value as Record<string, unknown>;
  const athlete =
    identity.athlete &&
    typeof identity.athlete === "object" &&
    !Array.isArray(identity.athlete)
      ? (identity.athlete as Record<string, unknown>)
      : {};
  return [
    identity.participantUuid,
    identity.providerUuid,
    identity.providerAthleteUuid,
    identity.providerTimingUuid,
    identity.providerRecordId,
    identity.athleteId,
    athlete.participantUuid,
    athlete.providerUuid,
    athlete.providerAthleteUuid,
    athlete.providerTimingUuid,
    athlete.providerRecordId,
    athlete.athleteId,
  ].some((candidate) => String(candidate ?? "").trim() === participantUuid);
}

function patchParticipantSummary(
  value: Record<string, unknown>,
  delta: Record<string, unknown>,
): Record<string, unknown> {
  const existingLive =
    value.participantLive &&
    typeof value.participantLive === "object" &&
    !Array.isArray(value.participantLive)
      ? (value.participantLive as Record<string, unknown>)
      : {};
  const resolved =
    delta.resolvedRaceState &&
    typeof delta.resolvedRaceState === "object" &&
    !Array.isArray(delta.resolvedRaceState)
      ? (delta.resolvedRaceState as Record<string, unknown>)
      : {};
  const lastSplit =
    resolved.lastCompletedSplit &&
    typeof resolved.lastCompletedSplit === "object" &&
    !Array.isArray(resolved.lastCompletedSplit)
      ? (resolved.lastCompletedSplit as Record<string, unknown>)
      : {};
  const incoming = {
    ...value,
    status: resolved.status ?? delta.status ?? value.status,
    currentLeg: resolved.currentLeg ?? delta.currentLeg ?? value.currentLeg,
    currentSplit:
      (resolved.currentSplit as Record<string, unknown> | undefined)?.name ??
      delta.currentSplit ??
      value.currentSplit,
    latestSplit: lastSplit.name ?? value.latestSplit,
    latestSplitTime:
      lastSplit.readAt ?? lastSplit.acceptedAt ?? value.latestSplitTime,
    elapsedTime:
      resolved.officialRaceElapsedMs ??
      resolved.liveOverallElapsedMs ??
      value.elapsedTime,
    progressPercent:
      Number(resolved.officialProgressRatio) >= 0
        ? Number(resolved.officialProgressRatio) * 100
        : value.progressPercent,
    updatedAt: resolved.updatedAt ?? delta.lastSeen ?? value.updatedAt,
    participantLive: mergeAthleteStateWithoutRegression(existingLive, delta),
  };
  return mergeAthleteStateWithoutRegression(value, incoming);
}

function patchParticipantLive(
  current: unknown,
  delta: Record<string, unknown>,
): unknown {
  if (!current || typeof current !== "object" || Array.isArray(current))
    return current;
  const record = current as Record<string, unknown>;
  const existing =
    record.participantLive && typeof record.participantLive === "object"
      ? (record.participantLive as Record<string, unknown>)
      : {};
  return {
    ...record,
    participantLive: mergeAthleteStateWithoutRegression(existing, delta),
  };
}

function patchParticipantRows(
  current: unknown,
  participantUuid: string,
  providerParticipantUuid: string | null | undefined,
  delta: Record<string, unknown>,
): unknown {
  const matches = (value: unknown) =>
    identityMatches(value, participantUuid) ||
    Boolean(
      providerParticipantUuid &&
      identityMatches(value, providerParticipantUuid),
    );
  if (Array.isArray(current)) {
    return current.map((row) =>
      matches(row) && row && typeof row === "object"
        ? (() => {
            const record = row as Record<string, unknown>;
            const nested =
              record.athlete &&
              typeof record.athlete === "object" &&
              !Array.isArray(record.athlete)
                ? patchParticipantSummary(
                    record.athlete as Record<string, unknown>,
                    delta,
                  )
                : undefined;
            return {
              ...patchParticipantSummary(record, delta),
              ...(nested ? { athlete: nested } : {}),
            };
          })()
        : row,
    );
  }
  if (!current || typeof current !== "object") return current;
  const record = current as Record<string, unknown>;
  const rowsKey = Array.isArray(record.rows)
    ? "rows"
    : Array.isArray(record.participants)
      ? "participants"
      : null;
  if (!rowsKey) return record;
  return {
    ...record,
    [rowsKey]: patchParticipantRows(
      record[rowsKey],
      participantUuid,
      providerParticipantUuid,
      delta,
    ),
  };
}

let canonicalSocketConsumerSequence = 0;

/**
 * React consumer for the provider-scoped socket registry. Transport identity
 * is event + provider only; participant identity is mutable message-filter
 * state and therefore cannot recreate the WebSocket.
 */
export function useCanonicalChangeSocket(
  eventId: string,
  providerEventUuid?: string,
  enabled = true,
  options: CanonicalChangeSocketOptions = {},
): {
  isConnected: boolean;
  isHealthy: boolean;
  health: "disabled" | "degraded" | "healthy";
} {
  const queryClient = useQueryClient();
  const normalizedProviderEventUuid =
    normalizeProviderEventUuid(providerEventUuid);
  const [health, setHealth] = useState<"disabled" | "degraded" | "healthy">(
    enabled ? "degraded" : "disabled",
  );
  const leaseRef = useRef<CanonicalSocketLease | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const consumerIdRef = useRef<string | undefined>(undefined);
  if (!consumerIdRef.current) {
    canonicalSocketConsumerSequence += 1;
    consumerIdRef.current = `canonical-consumer-${canonicalSocketConsumerSequence}`;
  }

  useEffect(() => {
    if (!enabled || !eventId || !normalizedProviderEventUuid) {
      setHealth("disabled");
      return;
    }

    const selectedParticipantUuid = () =>
      String(optionsRef.current.selectedParticipantUuid ?? "").trim();
    const selectedAthleteKey = () => {
      const participantUuid = selectedParticipantUuid();
      return participantUuid
        ? queryKeys.canonicalAthlete(
            eventId,
            normalizedProviderEventUuid,
            participantUuid,
          )
        : null;
    };
    const reconcileShared = async () => {
      recordLivePerformance("queryInvalidations", 3);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.canonical.availability(eventId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["tracking", "leaderboard", eventId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["canonical-live-rankings", eventId],
        }),
      ]);
    };
    const refreshSelectedAthlete = async (
      reason:
        | "SOCKET_PARTICIPANT_CHANGE"
        | "FOREGROUND_RECOVERY"
        | "NETWORK_RECOVERY",
    ) => {
      const athleteKey = selectedAthleteKey();
      if (!athleteKey || !optionsRef.current.onAthleteInvalidated) return;
      recordLivePerformance("queryInvalidations");
      await queryClient.invalidateQueries({
        queryKey: athleteKey,
        exact: true,
        refetchType: "none",
      });
      await optionsRef.current.onAthleteInvalidated(reason);
    };
    const onRecovery = (reason: CanonicalSocketRecoveryReason) => {
      void Promise.all([reconcileShared(), refreshSelectedAthlete(reason)]);
    };
    const onMessage = (change: CanonicalChangeEvent) => {
      const invalidations: Promise<unknown>[] = [];
      if (change.type === "canonical_change") {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: queryKeys.canonical.availability(eventId),
          }),
        );
      }
      if (
        change.type === "leaderboard_changed" ||
        change.type === "canonical_change"
      ) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: ["canonical-live-rankings", eventId],
          }),
          queryClient.invalidateQueries({
            queryKey: ["tracking", "leaderboard", eventId],
          }),
        );
      }
      if (change.contestUuid && change.type !== "participant_changed") {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: queryKeys.canonical.leaderboardManifest(
              eventId,
              change.contestUuid,
            ),
          }),
        );
      }
      if (change.participantUuid || change.providerParticipantUuid) {
        const activeParticipantUuid = selectedParticipantUuid();
        const athleteKey = selectedAthleteKey();
        const isSelectedParticipant =
          change.participantUuid === activeParticipantUuid ||
          change.providerParticipantUuid === activeParticipantUuid;
        invalidations.push(
          invalidateLiveTimingParticipant(queryClient, {
            eventId,
            providerEventUuid: normalizedProviderEventUuid,
            participantUuid: change.participantUuid,
            providerParticipantUuid: change.providerParticipantUuid,
          }),
        );
        if (change.type === "participant_changed" && change.delta) {
          if (isSelectedParticipant && athleteKey) {
            queryClient.setQueryData(athleteKey, (current) =>
              patchParticipantLive(
                current,
                change.delta as Record<string, unknown>,
              ),
            );
          }
          queryClient.setQueriesData(
            {
              predicate: ({ queryKey }) =>
                queryKey[0] === "tracking" &&
                queryKey[1] === "athlete-search" &&
                queryKey[2] === eventId,
            },
            (current) =>
              patchParticipantRows(
                current,
                change.participantUuid || "",
                change.providerParticipantUuid,
                change.delta as Record<string, unknown>,
              ),
          );
          queryClient.setQueriesData(
            {
              predicate: ({ queryKey }) =>
                queryKey[0] === "tracking" &&
                queryKey[1] === "account-watchlist",
            },
            (current) =>
              patchParticipantRows(
                current,
                change.participantUuid || "",
                change.providerParticipantUuid,
                change.delta as Record<string, unknown>,
              ),
          );
        }
        if (isSelectedParticipant) {
          invalidations.push(
            refreshSelectedAthlete("SOCKET_PARTICIPANT_CHANGE"),
          );
        }
      }
      recordLivePerformance("queryInvalidations", invalidations.length);
      void Promise.all(invalidations);
    };

    const lease = subscribeCanonicalSocket({
      eventId,
      providerEventUuid: normalizedProviderEventUuid,
      consumerId: consumerIdRef.current!,
      participantUuid: optionsRef.current.selectedParticipantUuid,
      onHealth: setHealth,
      onMessage,
      onRecovery,
    });
    leaseRef.current = lease;
    return () => {
      leaseRef.current = null;
      lease.release("effect_disposed");
    };
  }, [enabled, eventId, normalizedProviderEventUuid, queryClient]);

  useEffect(() => {
    leaseRef.current?.updateParticipantUuid(options.selectedParticipantUuid);
  }, [options.selectedParticipantUuid]);

  const isHealthy = health === "healthy";
  return { isConnected: isHealthy, isHealthy, health };
}
