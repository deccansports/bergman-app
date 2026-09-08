import {
  normalizeProviderContestUuid,
  normalizeProviderEventUuid,
} from "@/features/tracking/providerScope";

export type LeaderboardScopeRow = Record<string, unknown> & {
  providerEventUuid: string;
  requestedContestUuid: string;
  canonicalContestUuid: string;
  providerContestUuid: string;
  legacyContestIds: string[];
  displayName: string;
  resolutionSource: "event_context" | "canonical_course_index" | "contest_mapping";
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function resolveCanonicalContestUuid(
  _eventId: string,
  _providerEventUuid: string,
  requestedContestUuid: string,
  configuredCanonicalContestUuid?: unknown,
): string {
  return text(configuredCanonicalContestUuid) || requestedContestUuid;
}

function rowsFromPayload(payload: unknown): {
  rows: unknown[];
  resolutionSource: LeaderboardScopeRow["resolutionSource"];
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { rows: [], resolutionSource: "event_context" };
  }
  const response = payload as Record<string, unknown>;
  const event =
    response.event && typeof response.event === "object"
      ? (response.event as Record<string, unknown>)
      : response;
  const raw =
    event.raw && typeof event.raw === "object"
      ? (event.raw as Record<string, unknown>)
      : undefined;
  for (const candidate of [
    event.contests,
    raw?.contests,
    event.liveContests,
    raw?.liveContests,
  ]) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return {
        rows: candidate,
        resolutionSource:
          event === response && response.success === true
            ? "canonical_course_index"
            : "event_context",
      };
    }
  }
  return {
    rows: Array.isArray(response.importedContests)
      ? response.importedContests
      : [],
    resolutionSource: "contest_mapping",
  };
}

export function normalizeLeaderboardScopes(
  eventId: string,
  payload: unknown,
): LeaderboardScopeRow[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const { rows: rawRows, resolutionSource } = rowsFromPayload(payload);
  const unique = new Map<string, LeaderboardScopeRow>();

  for (const value of rawRows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const providerEventUuid = text(
      row.providerEventUuid ?? row.feibotEventUuid ?? row.eventUuid,
    );
    const requestedContestUuid = text(
      row.requestedContestUuid ??
        row.feibotContestUuid ??
        row.providerContestUuid ??
        row.contestUuid,
    );
    if (!providerEventUuid || !requestedContestUuid) continue;
    const canonicalContestUuid = resolveCanonicalContestUuid(
      eventId,
      providerEventUuid,
      requestedContestUuid,
      row.canonicalContestUuid,
    );
    const displayName = text(
      row.displayName ??
        row.feibotContestName ??
        row.contestName ??
        row.bergmanContestName ??
        canonicalContestUuid,
    );
    const key = `${normalizeProviderEventUuid(providerEventUuid)}:${normalizeProviderContestUuid(canonicalContestUuid)}`;
    if (unique.has(key)) continue;
    unique.set(key, {
      ...row,
      providerEventUuid,
      feibotEventUuid: providerEventUuid,
      requestedContestUuid,
      canonicalContestUuid,
      providerContestUuid: canonicalContestUuid,
      contestUuid: canonicalContestUuid,
      legacyContestIds:
        normalizeProviderContestUuid(requestedContestUuid) ===
        normalizeProviderContestUuid(canonicalContestUuid)
          ? []
          : [requestedContestUuid],
      displayName,
      resolutionSource,
      contestName: displayName,
      name: displayName,
    });
  }

  return [...unique.values()];
}
