import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/core/auth/session";
import {
  repositories,
  type AthleteSearchMode,
  type LeaderboardFilters,
} from "@/core/repositories";
import { inferAthleteSearchMode } from "@/core/repositories/athlete.repository";
import { httpText } from "@/core/services/api/http";
import { queryKeys } from "@/core/services/query/queryKeys";
import type { ApiError, AthleteSearchMatch } from "@/core/types";
import type { AthleteSummary } from "@/features/tracking/mappers";
import {
  normalizeProviderContestUuid,
  normalizeProviderEventUuid,
} from "@/features/tracking/providerScope";

import {
  courseAssetMetadataVersion,
  courseGeometryOwner,
  hasConfiguredGpxAsset,
  providerEventUuidFromSelection,
  resolveCourseGeometry,
} from "../course-map/courseConfig";
import type { CourseMapSelection } from "../course-map/courseConfig";
import { mapAthleteMatches, mapLeaderboardRows } from "../mappers";
import { normalizeLeaderboardScopes } from "../leaderboard/leaderboardScope";
import { leaderboardRefetchIntervalMs } from "./leaderboardRequestOwnership";
import { TRACKING_INTERVALS } from "./trackingKeys";
import {
  useCanonicalAvailability,
  useCanonicalParticipants,
} from "./useCanonicalTracking";

type RetainedLeaderboard = {
  rows: ReturnType<typeof mapLeaderboardRows>;
  timingVersion: number;
  leaderboardVersion: number;
  updatedAtMs: number;
};

const retainedLiveLeaderboards = new Map<string, RetainedLeaderboard>();

function compactQueryFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function leaderboardRevision(input: {
  timingVersion?: number;
  leaderboardVersion?: number;
  updatedAt?: string;
  timestamp?: string;
}) {
  return {
    timingVersion: Number(input.timingVersion ?? 0),
    leaderboardVersion: Number(input.leaderboardVersion ?? 0),
    updatedAtMs: Date.parse(input.updatedAt || input.timestamp || "") || 0,
  };
}

function isOlderLeaderboardRevision(
  incoming: ReturnType<typeof leaderboardRevision>,
  current: RetainedLeaderboard,
) {
  if (incoming.timingVersion !== current.timingVersion)
    return incoming.timingVersion < current.timingVersion;
  if (incoming.leaderboardVersion !== current.leaderboardVersion)
    return incoming.leaderboardVersion < current.leaderboardVersion;
  return incoming.updatedAtMs <= current.updatedAtMs;
}
type ParticipantRecord = Record<string, unknown> & {
  participantUuid?: string;
  athleteUid?: string;
  providerUuid?: string;
  providerAthleteUuid?: string;
  providerTimingUuid?: string;
  providerRecordId?: string;
  bookingId?: string;
  bib?: string;
  bibNumber?: string;
  name?: string;
  nameLower?: string;
  fullName?: string;
  displayName?: string;
  contestName?: string;
  providerContestName?: string;
  contestUuid?: string;
  providerContestUuid?: string;
  ageGroup?: string;
  ageGroupName?: string;
  gender?: string;
  city?: string;
  state?: string;
  country?: string;
  club?: string;
  clubName?: string;
  photoUrl?: string | null;
  photoURL?: string | null;
  profilePhotoUrl?: string | null;
  avatarUrl?: string | null;
  displayPhoto?: string | null;
  email?: string;
};

type OfficialResultRecord = Record<string, unknown> & {
  athleteUid?: string;
  bibNumber?: string;
  bib?: string;
  displayName?: string;
  name?: string;
  fullName?: string;
  profilePhotoUrl?: string | null;
  photoUrl?: string | null;
  photoURL?: string | null;
  contest?: string | null;
  contestName?: string | null;
  category?: string | null;
  ageGroup?: string | null;
  gender?: string | null;
  chipTime?: string | null;
  overallTime?: string | null;
  overallRank?: number | string | null;
  genderRank?: number | string | null;
  categoryRank?: number | string | null;
  cRank?: number | string | null;
  gRank?: number | string | null;
  oRank?: number | string | null;
  pointsAwarded?: number | string | null;
  status?: string | null;
  raceDate?: string | null;
  splits?: { label?: string; time?: string }[] | null;
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

function hasValidEventId(value: unknown): value is string {
  const eventId = String(value ?? "").trim();
  return Boolean(eventId && eventId !== "undefined" && eventId !== "null");
}

function shouldRetryLiveRequest(failureCount: number, error: unknown): boolean {
  const status = (error as ApiError | undefined)?.status;
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 422
  )
    return false;
  if (
    status != null &&
    status !== 408 &&
    status !== 429 &&
    ![500, 502, 503, 504].includes(status)
  )
    return false;
  if (error instanceof Error && error.message === "EVENT_ID_REQUIRED")
    return false;
  return failureCount < 2;
}

function cleanContestLabel(value: unknown): string {
  const textValue = text(value);
  if (!textValue) return "";
  if (/^sub-\d+$/i.test(textValue)) return "";
  return textValue;
}

function uniqueKey(
  value: Record<string, unknown> & {
    participantUuid?: string;
    providerUuid?: string;
    providerAthleteUuid?: string;
    providerTimingUuid?: string;
    providerRecordId?: string;
    bookingId?: string;
    athleteUid?: string;
    bib?: string;
    contestUuid?: string;
    contestName?: string;
    category?: string;
    providerContestUuid?: string;
    providerContestName?: string;
    name?: string;
    displayName?: string;
    fullName?: string;
  },
): string {
  const bib = firstText(value.bib, value.bibNumber);
  const contest = firstText(
    value.contestName,
    value.providerContestName,
    value.category,
    value.contestUuid,
    value.providerContestUuid,
  );
  const name = firstText(value.name, value.displayName, value.fullName);
  return (
    (bib && contest ? `bib:${bib}:contest:${contest}` : "") ||
    (bib && name ? `bib:${bib}:name:${name.toLowerCase()}` : "") ||
    firstText(
      value.participantUuid,
      value.providerUuid,
      value.providerRecordId,
      value.bookingId,
      value.athleteUid,
    ) ||
    firstText(value.bib) ||
    JSON.stringify(value)
  );
}

function isLikelyParticipantRecord(value: unknown): value is ParticipantRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as ParticipantRecord;
  return Boolean(
    firstText(
      record.participantUuid,
      record.providerUuid,
      record.providerAthleteUuid,
      record.providerTimingUuid,
      record.providerRecordId,
      record.bookingId,
      record.athleteUid,
      record.bib,
      record.bibNumber,
      record.name,
      record.displayName,
      record.fullName,
      record.email,
    ),
  );
}

function normalizeParticipantResponse(res: unknown): ParticipantRecord[] {
  const visited = new Set<unknown>();
  const collect = (value: unknown, depth = 0): ParticipantRecord[] => {
    if (!value || depth > 5 || visited.has(value)) return [];
    if (typeof value === "object") visited.add(value);
    if (Array.isArray(value))
      return value.flatMap((item) => collect(item, depth + 1));
    if (isLikelyParticipantRecord(value)) return [value];
    if (typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const preferred = [
      record.participants,
      record.matches,
      record.data,
      record.rows,
      record.items,
      record.list,
      record.athletes,
      record.byUuid,
      record.byBib,
      record.byContest,
      record.byParticipantUuid,
      record.byAthleteUid,
    ];
    const preferredRows = preferred.flatMap((item) => collect(item, depth + 1));
    if (preferredRows.length > 0) return preferredRows;
    return Object.values(record).flatMap((item) => collect(item, depth + 1));
  };
  return collect(res);
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nestedData(value: unknown): Record<string, unknown> {
  const root = payloadRecord(value);
  return root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? (root.data as Record<string, unknown>)
    : {};
}

function booleanField(value: unknown, key: string): boolean | undefined {
  const root = payloadRecord(value);
  const data = nestedData(value);
  if (typeof root[key] === "boolean") return root[key] as boolean;
  if (typeof data[key] === "boolean") return data[key] as boolean;
  return undefined;
}

function stringField(value: unknown, key: string): string {
  const root = payloadRecord(value);
  const data = nestedData(value);
  return firstText(root[key], data[key]);
}

function isVisibilityDisabledPayload(value: unknown): boolean {
  return (
    stringField(value, "source") === "visibility_lock" ||
    booleanField(value, "publicAthleteVisibility") === false ||
    booleanField(value, "visibilityEnabled") === false
  );
}

function isDataPendingPayload(value: unknown): boolean {
  return (
    booleanField(value, "publicAthleteVisibility") === true &&
    stringField(value, "source") === "no_data"
  );
}

function searchRowsFromContract(
  res: unknown,
  mode: AthleteSearchMode = "name",
  query = "",
): AthleteSearchMatch[] {
  const data = nestedData(res);
  if (
    stringField(res, "source") === "visibility_lock" ||
    booleanField(res, "publicAthleteVisibility") === false ||
    booleanField(res, "visibilityEnabled") === false
  )
    return [];
  const rows = Array.isArray(data.rows)
    ? (data.rows as AthleteSearchMatch[])
    : [];
  if (mode !== "bib") return rows;

  const normalizedQuery = String(query).trim().toLowerCase();
  return rows.filter((athlete) => {
    return (
      String(athlete.bib ?? athlete.bibNumber ?? "")
        .trim()
        .toLowerCase() === normalizedQuery
    );
  });
}

type AthleteSearchQueryResult = {
  rows: AthleteSummary[];
  state: "found" | "not-found" | "visibility-disabled";
  visibilityVersion?: number;
};

function dedupeByPriority<T extends Record<string, unknown>>(items: T[]): T[] {
  const unique = new Map<string, T>();
  for (const item of items) {
    const key = uniqueKey(
      item as Record<string, unknown> & {
        providerUuid?: string;
        providerTimingUuid?: string;
        providerRecordId?: string;
        participantUuid?: string;
        bookingId?: string;
        athleteUid?: string;
        bib?: string;
        contestUuid?: string;
      },
    );
    if (!unique.has(key)) {
      unique.set(key, item);
      continue;
    }
    unique.set(key, { ...unique.get(key), ...item });
  }
  return [...unique.values()];
}

function normalizeOfficialSummary(
  result: OfficialResultRecord,
): AthleteSummary {
  const bib = firstText(result.bib, result.bibNumber, result.athleteUid);
  return {
    id: firstText(result.athleteUid, result.bib, result.bibNumber, bib),
    bib,
    name:
      firstText(result.displayName, result.name, result.fullName) ||
      `Bib ${bib}`,
    category:
      cleanContestLabel(
        firstText(
          result.contestName,
          result.contest,
          result.ageGroup,
          result.category,
        ),
      ) || undefined,
    club: firstText(result.club, result.clubName),
    photoUrl:
      firstText(
        result.profilePhotoUrl,
        result.photoUrl,
        result.photoURL,
        result.avatarUrl,
        result.displayPhoto,
      ) || undefined,
    athleteUid: firstText(result.athleteUid) || undefined,
    status: result.status
      ? String(result.status).toLowerCase().includes("finish")
        ? "finished"
        : String(result.status).toLowerCase().includes("live")
          ? "live"
          : "notStarted"
      : "finished",
  };
}

export function useParticipants(
  eventId: string,
  enabled = true,
  polling = enabled,
  providerEventUuid?: string,
) {
  const sessionStatus = useSession((state) => state.status);
  const accessToken = useSession((state) => state.accessToken);
  const authReady =
    sessionStatus === "guest" ||
    (sessionStatus === "authenticated" && Boolean(accessToken));
  const availability = useCanonicalAvailability(
    eventId,
    enabled && authReady,
    providerEventUuid,
  );
  const canonicalReady = availability.data?.ready === true;
  const activeVersion =
    availability.data?.ready === true
      ? availability.data.activeVersion
      : undefined;
  const canonicalQuery = useCanonicalParticipants(
    eventId,
    activeVersion,
    enabled && authReady && canonicalReady,
    polling,
    providerEventUuid,
  );
  const fallbackAllowed =
    !providerEventUuid ||
    (availability.data?.ready === false &&
      ["build_missing", "build_incomplete", "network"].includes(
        availability.data.reason,
      ));
  const legacyQuery = useQuery({
    queryKey: queryKeys.participants(eventId),
    queryFn: async ({ signal }) => {
      const res = await repositories.tracking.getParticipants(eventId, signal);
      const rawParticipants =
        isVisibilityDisabledPayload(res) || isDataPendingPayload(res)
          ? []
          : normalizeParticipantResponse(res);
      const participants = dedupeByPriority(rawParticipants);
      if (process.env.NODE_ENV !== "production") {
        console.log("[participants] response summary", {
          eventId,
          source: payloadRecord(res).source ?? null,
          rawParticipantCount: rawParticipants.length,
          uniqueParticipantCount: participants.length,
          providerUuidCount: new Set(
            participants
              .map((participant) => participant.providerUuid)
              .filter(Boolean),
          ).size,
        });
      }
      return participants;
    },
    staleTime: 0,
    enabled: enabled && authReady && Boolean(eventId) && fallbackAllowed,
  });
  if (!canonicalReady) return legacyQuery;
  const rows =
    canonicalQuery.data?.participants ?? canonicalQuery.data?.rows ?? [];
  const participants = dedupeByPriority(
    rows.map(
      (row) =>
        ({
          ...row,
          bib: text(row.bib),
          bibNumber: text(row.bib),
          name: firstText(row.displayName, row.name),
          fullName: firstText(row.displayName, row.name),
          providerUuid: row.providerParticipantUuid ?? row.providerUuid,
          providerAthleteUuid: row.providerParticipantUuid ?? row.providerUuid,
          providerTimingUuid: row.providerParticipantUuid ?? row.providerUuid,
          participantUuid: row.participantUuid,
          providerEventUuid:
            row.providerEventUuid ??
            row.participantUuid?.match(/^race:([^:]+):/i)?.[1] ??
            providerEventUuid,
          ageGroup: firstText(row.ageGroupKey, row.ageGroup),
          ageGroupName: firstText(row.ageGroupKey, row.ageGroup),
          photoUrl: row.photoUrl,
          photoURL: row.photoUrl,
          profilePhotoUrl: row.photoUrl,
          avatarUrl: row.photoUrl,
          displayPhoto: row.photoUrl,
        }) as ParticipantRecord,
    ),
  );
  return { ...canonicalQuery, data: participants };
}

export function useEventResults(eventId: string, enabled = true) {
  const normalizedEventId = text(Array.isArray(eventId) ? eventId[0] : eventId);
  const validEventId = hasValidEventId(normalizedEventId);
  const resolvedEventId = validEventId ? normalizedEventId : "disabled";
  return useQuery({
    queryKey: queryKeys.eventResults(resolvedEventId),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      const rows = await repositories.results.getEventResults(
        resolvedEventId,
        signal,
      );
      if (process.env.NODE_ENV !== "production") {
        console.log("[FinishedEvent]", {
          eventId: resolvedEventId,
          source: `results:${resolvedEventId}`,
          loadedAthletes: rows.length,
        });
      }
      return rows as OfficialResultRecord[];
    },
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
    gcTime: 30 * 60 * 1000,
    retry: shouldRetryLiveRequest,
    enabled: enabled && validEventId,
  });
}

/**
 * React Query hooks for live tracking. Flow: Screen → these hooks → Repository →
 * production BERGMAN endpoints (or mock behind EXPO_PUBLIC_USE_LIVE_API).
 *
 * Polling pauses in the background (AppState → focusManager), when the screen is
 * unfocused (`focused=false`), and when the race is finished (`isLive=false`).
 */

export function useLiveEvents(enabled = true) {
  return useQuery({
    queryKey: queryKeys.events.list,
    queryFn: ({ signal }) => repositories.events.getLiveEvents(signal),
    staleTime: TRACKING_INTERVALS.eventsStaleMs,
    enabled,
  });
}

export type PollingOptions = {
  enabled?: boolean;
  /** Screen is focused. */
  focused?: boolean;
  /** Race is currently live (polling stops when finished). */
  isLive?: boolean;
  /** Replay mode active (live polling pauses). */
  replay?: boolean;
  /** A healthy canonical socket owns change notification and invalidation. */
  socketHealthy?: boolean;
};

function shouldPoll({
  focused = true,
  isLive = true,
  replay = false,
}: PollingOptions): boolean {
  return focused && isLive && !replay;
}

export function useLeaderboard(
  eventId: string,
  filters?: LeaderboardFilters,
  options: PollingOptions = {},
  source: "auto" | "live" | "results" = "auto",
) {
  const { enabled = true } = options;
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  const resolvedSource = source === "auto" ? "live" : source;
  const resolvedProviderEventUuid = normalizeProviderEventUuid(
    filters?.providerEventUuid,
  );
  const resolvedContestUuid = normalizeProviderContestUuid(
    filters?.contestUuid ?? filters?.contest,
  );
  const liveScopeResolved = Boolean(
    resolvedProviderEventUuid && resolvedContestUuid,
  );
  const resultsQuery = useEventResults(
    resolvedEventId,
    enabled && validEventId && resolvedSource === "results",
  );

  const query = useQuery({
    queryKey: queryKeys.leaderboard(resolvedEventId, filters),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      if (
        resolvedSource === "results" ||
        (!shouldPoll(options) && resolvedSource !== "live")
      ) {
        const rows =
          resultsQuery.data ??
          (await repositories.results.getEventResults(resolvedEventId, signal));
        if (process.env.NODE_ENV !== "production") {
          console.log("[Finished Leaderboard]", {
            eventId: resolvedEventId,
            source: `results:${resolvedEventId}`,
            resultsLoaded: rows.length,
          });
        }
        return rows;
      }

      if (resolvedSource === "live") {
        if (process.env.NODE_ENV !== "production") {
          console.log("[leaderboard-runtime][REQUEST]", {
            eventId: resolvedEventId,
            providerEventUuid: resolvedProviderEventUuid,
            contestUuid: resolvedContestUuid,
          });
        }
        const res = await repositories.leaderboard.getLeaderboard(
          resolvedEventId,
          filters,
          signal,
        );
        const rows = mapLeaderboardRows(res.athletes ?? []);
        const retentionKey = [
          resolvedEventId,
          resolvedProviderEventUuid,
          resolvedContestUuid,
          filters?.split ?? "overall",
          filters?.ageGroup ?? "all",
          filters?.gender ?? "All",
        ].join(":");
        const incomingRevision = leaderboardRevision(res);
        const retained = retainedLiveLeaderboards.get(retentionKey);
        const staleEmptyRejected = Boolean(
          rows.length === 0 &&
          retained &&
          retained.rows.length > 0 &&
          isOlderLeaderboardRevision(incomingRevision, retained),
        );
        const effectiveRows = staleEmptyRejected ? retained!.rows : rows;
        if (!staleEmptyRejected) {
          retainedLiveLeaderboards.set(retentionKey, {
            rows,
            ...incomingRevision,
          });
        }
        if (process.env.NODE_ENV !== "production") {
          console.log("[leaderboard-runtime][RESPONSE]", {
            eventId: resolvedEventId,
            providerEventUuid: resolvedProviderEventUuid,
            contestUuid: resolvedContestUuid,
            apiRowCount: res.athletes?.length ?? 0,
            mappedRowCount: rows.length,
            effectiveRowCount: effectiveRows.length,
            activeVersion: res.activeVersion ?? res.buildVersion ?? null,
            timingVersion: res.timingVersion ?? null,
            leaderboardVersion: res.leaderboardVersion ?? null,
            emptyReason: res.emptyReason ?? null,
            staleEmptyRejected,
            diagnostics: res.diagnostics ?? null,
          });
          console.log("[leaderboard:diagnostic]", {
            eventId: resolvedEventId,
            providerEventUuid: resolvedProviderEventUuid || null,
            contestUuid: resolvedContestUuid || null,
            stage: "api_and_mapper",
            apiRowCount: res.athletes?.length ?? 0,
            mappedRowCount: rows.length,
            mapperDroppedCount: Math.max(
              0,
              (res.athletes?.length ?? 0) - rows.length,
            ),
            source: res.source ?? null,
            firstRowFields: res.athletes?.[0]
              ? Object.keys(res.athletes[0]).filter(
                  (field) => !/(email|token|secret)/i.test(field),
                )
              : [],
          });
        }
        return effectiveRows;
      }

      return [];
    },
    refetchInterval: (query) => {
      const rows = Array.isArray(query.state.data) ? query.state.data : [];
      if (resolvedSource !== "live") return false;
      return leaderboardRefetchIntervalMs({
        focused: options.focused ?? true,
        isLive: options.isLive ?? true,
        replay: options.replay,
        socketHealthy: options.socketHealthy,
        rowCount: rows.length,
        fallbackIntervalMs: TRACKING_INTERVALS.leaderboardRefetchMs,
      });
    },
    staleTime: TRACKING_INTERVALS.staleMs,
    retry: shouldPoll(options) ? shouldRetryLiveRequest : false,
    enabled:
      enabled &&
      validEventId &&
      (resolvedSource !== "live" || liveScopeResolved),
  });

  return query;
}

export function useLeaderboardScopes(
  eventId: string,
  event: Record<string, unknown> | null | undefined,
  enabled = true,
) {
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  return useQuery({
    queryKey: queryKeys.leaderboardScopes(resolvedEventId),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      const eventScopes = normalizeLeaderboardScopes(resolvedEventId, event);
      if (eventScopes.length > 0) return eventScopes;
      const payload = await repositories.leaderboard.getLeaderboardScopes(
        resolvedEventId,
        signal,
      );
      return normalizeLeaderboardScopes(resolvedEventId, payload);
    },
    enabled: enabled && validEventId && Boolean(event),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: shouldRetryLiveRequest,
  });
}

export function useAthleteSearch(
  eventId: string,
  q: string,
  mode: AthleteSearchMode = "name",
  enabled = true,
  source: "auto" | "live" | "results" = "auto",
) {
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  const queryText = q.trim();
  const resolvedSource = source === "auto" ? "live" : source;
  const resultsQuery = useEventResults(
    resolvedEventId,
    enabled && validEventId && resolvedSource === "results",
  );
  const inferredMode = inferAthleteSearchMode(queryText, mode);
  const queryReady = isAthleteSearchQueryReady(queryText, inferredMode);
  const searchRequestSequenceRef = useRef(0);
  const latestSearchRequestRef = useRef("");
  const liveSearchQuery = useQuery<AthleteSearchQueryResult>({
    queryKey: queryKeys.athleteSearch(resolvedEventId, queryText, inferredMode),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      const requestId = `${resolvedEventId}:${++searchRequestSequenceRef.current}`;
      const requestKey = [resolvedEventId, inferredMode, queryText].join(":");
      latestSearchRequestRef.current = requestKey;
      const startedAt = Date.now();
      if (process.env.NODE_ENV !== "production") {
        console.log("[ATHLETE_SEARCH_REQUEST]", {
          eventId: resolvedEventId,
          query: queryText,
          mode: inferredMode,
          requestId,
          reason: "debounced_or_submitted",
          debounceMs: 350,
          endpoint: `/api/live/events/${resolvedEventId}/search`,
          kvOnly: 1,
        });
      }
      const res = await repositories.athlete.search(
        resolvedEventId,
        queryText,
        inferredMode,
        signal,
      );
      const visibilityDisabled =
        res.publicAthleteVisibility === false ||
        res.visibilityEnabled === false ||
        res.source === "visibility_lock";
      const rows = visibilityDisabled
        ? []
        : mapAthleteMatches(
            searchRowsFromContract(
              {
                data: {
                  rows: res.matches,
                  source: res.source,
                  publicAthleteVisibility: res.publicAthleteVisibility,
                  visibilityEnabled: res.visibilityEnabled,
                },
              },
              inferredMode,
              queryText,
            ),
          );
      const state = visibilityDisabled
        ? "visibility-disabled"
        : rows.length > 0
          ? "found"
          : "not-found";

      if (process.env.NODE_ENV !== "production") {
        console.log("[ATHLETE_SEARCH_RESPONSE]", {
          query: queryText,
          requestId,
          resultCount: rows.length,
          durationMs: Date.now() - startedAt,
          acceptedAsLatest: latestSearchRequestRef.current === requestKey,
        });
      }
      return { rows, state, visibilityVersion: res.visibilityVersion };
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: false,
    enabled: enabled && validEventId && queryReady && resolvedSource === "live",
  });
  const results = useMemo(() => {
    const query = queryText;
    if (!query) return [];
    if (resolvedSource === "live" && (!enabled || !queryReady)) return [];
    if (resolvedSource === "results") {
      return (resultsQuery.data ?? [])
        .filter((result) => {
          const haystack = [
            result.bib,
            result.bibNumber,
            result.displayName,
            result.name,
            result.fullName,
            result.contest,
            result.contestName,
            result.ageGroup,
            result.category,
          ]
            .map((value) => text(value).toLowerCase())
            .join(" ");
          return haystack.includes(query.toLowerCase());
        })
        .map(normalizeOfficialSummary);
    }
    return liveSearchQuery.data?.rows ?? [];
  }, [
    enabled,
    queryReady,
    liveSearchQuery.data,
    queryText,
    resultsQuery.data,
    resolvedSource,
  ]);
  const state =
    resolvedSource === "live" && (!enabled || !queryReady)
      ? "idle"
      : resolvedSource === "live" &&
          liveSearchQuery.data?.state === "visibility-disabled"
        ? "visibility-disabled"
        : queryText && !liveSearchQuery.isFetching && results.length === 0
          ? "not-found"
          : results.length > 0
            ? "found"
            : "idle";

  return {
    data: results,
    rows: results,
    count: results.length,
    state,
    isFetching:
      resolvedSource === "results"
        ? resultsQuery.isFetching
        : liveSearchQuery.isFetching,
    isLoading:
      resolvedSource === "results"
        ? resultsQuery.isLoading
        : liveSearchQuery.isLoading,
    isError:
      resolvedSource === "results"
        ? resultsQuery.isError
        : liveSearchQuery.isError,
    refetch:
      resolvedSource === "results"
        ? resultsQuery.refetch
        : liveSearchQuery.refetch,
  };
}

export function isAthleteSearchQueryReady(
  query: string,
  mode: AthleteSearchMode,
): boolean {
  const value = query.trim();
  if (!value) return false;
  if (mode === "bib" || /^\d+$/.test(value)) return value.length >= 3;
  return value.length >= 2;
}

export function useAthleteDetail(
  eventId: string,
  params: {
    bib?: string;
    bookingId?: string;
    providerUuid?: string;
    providerAthleteUuid?: string;
    providerTimingUuid?: string;
    providerRecordId?: string;
    participantUuid?: string;
    providerEventUuid?: string;
    athleteUid?: string;
    email?: string;
    providerContestUuid?: string;
    courseVersion?: string;
    activeVersion?: string;
  },
  options: PollingOptions = {},
  source: "auto" | "live" | "results" = "auto",
) {
  const { enabled = true } = options;
  const normalizedParams = useMemo(
    () => ({
      bib: firstText(params.bib) || undefined,
      athleteUid: firstText(params.athleteUid) || undefined,
      bookingId: firstText(params.bookingId) || undefined,
      providerUuid: firstText(params.providerUuid) || undefined,
      providerAthleteUuid: firstText(params.providerAthleteUuid) || undefined,
      providerTimingUuid: firstText(params.providerTimingUuid) || undefined,
      providerRecordId: firstText(params.providerRecordId) || undefined,
      participantUuid: firstText(params.participantUuid) || undefined,
      providerEventUuid: firstText(params.providerEventUuid) || undefined,
      email: firstText(params.email) || undefined,
      providerContestUuid: firstText(params.providerContestUuid) || undefined,
      courseVersion: firstText(params.courseVersion) || undefined,
      activeVersion: firstText(params.activeVersion) || undefined,
    }),
    [
      params.activeVersion,
      params.athleteUid,
      params.bib,
      params.bookingId,
      params.courseVersion,
      params.email,
      params.participantUuid,
      params.providerEventUuid,
      params.providerAthleteUuid,
      params.providerContestUuid,
      params.providerRecordId,
      params.providerTimingUuid,
      params.providerUuid,
    ],
  );
  const resolvedSource = source === "auto" ? "live" : source;
  const key =
    normalizedParams.bib ??
    normalizedParams.athleteUid ??
    normalizedParams.bookingId ??
    normalizedParams.providerUuid ??
    normalizedParams.email ??
    normalizedParams.participantUuid ??
    normalizedParams.providerAthleteUuid ??
    normalizedParams.providerTimingUuid ??
    normalizedParams.providerRecordId ??
    "";
  const detailQueryKey = useMemo(
    () => queryKeys.athleteDetail(eventId, normalizedParams),
    [eventId, normalizedParams],
  );
  const query = useQuery({
    queryKey: detailQueryKey,
    queryFn: async ({ signal }) => {
      const mode = resolvedSource === "results" ? "results" : "live";
      return repositories.athlete.getDetail(
        eventId,
        normalizedParams,
        signal,
        mode,
        resolvedSource === "live" ? "athleteOnly" : "full",
      );
    },
    staleTime: resolvedSource === "live" ? 0 : 30_000,
    gcTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: (failureCount, error) => {
      const status = (error as unknown as ApiError | undefined)?.status ?? null;
      if (
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        status === 409
      )
        return false;
      return failureCount < 1;
    },
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    refetchInterval:
      resolvedSource === "live" && shouldPoll(options)
        ? TRACKING_INTERVALS.athleteDetailRefetchMs
        : false,
    enabled: enabled && Boolean(eventId) && Boolean(key),
  });

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!eventId && !key) return;
    console.log("[athlete-detail] query status", {
      eventId,
      status: query.status,
      isLoading: query.isLoading,
      isError: query.isError,
      hasData: Boolean(query.data),
      error: query.error,
    });
  }, [
    eventId,
    key,
    query.data,
    query.error,
    query.isError,
    query.isLoading,
    query.status,
  ]);

  return query;
}

export function useCourseMap(
  eventId: string,
  enabled = true,
  providerEventUuid?: string,
  providerContestUuid?: string,
) {
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  const sessionStatus = useSession((state) => state.status);
  const sessionUid = useSession((state) => state.user?.uid);
  // Admin-only APIs intentionally return 404 to unauthenticated callers. On a
  // cold launch Firebase can still be restoring the user when this screen
  // mounts; querying during that window cached a false "no course" result for
  // an hour. Wait for auth resolution and keep public/account course caches
  // isolated so a guest response can never hide an admin-visible GPX.
  const accessScope =
    sessionStatus === "authenticated"
      ? `account:${sessionUid || "authenticated"}`
      : sessionStatus;
  return useQuery({
    queryKey: [
      ...queryKeys.courseMap(resolvedEventId),
      accessScope,
      normalizeProviderEventUuid(providerEventUuid) || "event-wide",
      normalizeProviderContestUuid(providerContestUuid) || "contest-wide",
    ],
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      try {
        return await repositories.course.getCourseMapResources(
          resolvedEventId,
          signal,
          providerEventUuid,
          providerContestUuid,
        );
      } catch (error) {
        if ((error as ApiError | undefined)?.status === 404) {
          if (process.env.NODE_ENV !== "production") {
            console.log("[event-course-index] using ticket course fallback", {
              eventId: resolvedEventId,
            });
          }
          return null;
        }
        throw error;
      }
    },
    // Course resources are immutable for the lifetime of an app session.
    // Explicit Retry remains available when an operator publishes a new course.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: shouldRetryLiveRequest,
    enabled:
      enabled &&
      validEventId &&
      sessionStatus !== "loading" &&
      Boolean(providerEventUuid),
  });
}

/**
 * Real course geometry for the live map: reads the event's course config from
 * the backend (Firestore-backed course maps) and resolves the per-leg GPX into
 * polylines + markers. Static per event → cached aggressively. Returns null
 * when the event has no GPX configured (falls back to the text/summary view).
 */
export function useCourseGeometry(
  eventId: string,
  fallbackConfig?: Record<string, unknown> | null,
  enabled = true,
  selection?: CourseMapSelection,
  source: "canonical" | "event-config" = "canonical",
) {
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  const providerEventUuid = providerEventUuidFromSelection(selection);
  const resourcesQuery = useCourseMap(
    resolvedEventId,
    enabled && source === "canonical",
    providerEventUuid,
    selection?.contestId,
  );
  const courseMapVersion = useMemo(() => {
    const canonicalMap =
      resourcesQuery.data?.courseMap?.map &&
      typeof resourcesQuery.data.courseMap.map === "object"
        ? (resourcesQuery.data.courseMap.map as Record<string, unknown>)
        : {};
    return JSON.stringify({
      activeVersion: resourcesQuery.data?.courseMap?.activeVersion,
      courseVersion: canonicalMap.courseVersion,
      canonicalContests: (Array.isArray(canonicalMap.contests)
        ? canonicalMap.contests
        : []
      ).map((value) => {
        const contest =
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
        return {
          id: contest.providerContestUuid ?? contest.contestUuid ?? contest.id,
          courseVersion: contest.courseVersion,
          legs: (Array.isArray(contest.legs) ? contest.legs : []).map(
            (legValue) => {
              const leg =
                legValue &&
                typeof legValue === "object" &&
                !Array.isArray(legValue)
                  ? (legValue as Record<string, unknown>)
                  : {};
              return {
                key: leg.key ?? leg.type,
                gpxUrl: leg.gpxUrl,
                gpxUrls: leg.gpxUrls,
                geometryStatus: leg.geometryStatus,
              };
            },
          ),
        };
      }),
      tickets: (
        (resourcesQuery.data?.courseMap?.ticketDefinitions as
          Record<string, unknown>[] | undefined) ?? []
      ).map((ticket) => {
        const maps =
          ticket.courseMaps && typeof ticket.courseMaps === "object"
            ? (ticket.courseMaps as Record<string, unknown>)
            : {};
        return {
          id: ticket.id,
          name: ticket.ticketName ?? ticket.name,
          swim: maps.swimGpxUrl,
          bike: maps.bikeGpxUrl,
          run: maps.runGpxUrl,
          run1: maps.run1GpxUrl,
          run2: maps.run2GpxUrl,
          subCategories: Array.isArray(ticket.subCategories)
            ? ticket.subCategories.map((subCategory) => {
                const subMaps =
                  subCategory &&
                  typeof subCategory === "object" &&
                  !Array.isArray(subCategory) &&
                  (subCategory as Record<string, unknown>).courseMaps &&
                  typeof (subCategory as Record<string, unknown>).courseMaps ===
                    "object"
                    ? ((subCategory as Record<string, unknown>)
                        .courseMaps as Record<string, unknown>)
                    : {};
                const subCategoryRecord =
                  subCategory &&
                  typeof subCategory === "object" &&
                  !Array.isArray(subCategory)
                    ? (subCategory as Record<string, unknown>)
                    : {};
                return {
                  id: subCategoryRecord.id,
                  name: subCategoryRecord.name,
                  swim: subMaps.swimGpxUrl,
                  bike: subMaps.bikeGpxUrl,
                  run: subMaps.runGpxUrl,
                  run1: subMaps.run1GpxUrl,
                  run2: subMaps.run2GpxUrl,
                };
              })
            : [],
        };
      }),
    });
  }, [resourcesQuery.data?.courseMap]);
  const canonicalCourseVersion = useMemo(
    () =>
      JSON.stringify(
        (
          (resourcesQuery.data?.courseIndex?.contests as
            Record<string, unknown>[] | undefined) ?? []
        ).map((contest) => ({
          id: contest.id ?? contest.contestId ?? contest.providerContestUuid,
          ticketId: contest.bergmanTicketId,
          legs: (Array.isArray(contest.legs) ? contest.legs : []).map(
            (value) => {
              const leg =
                value && typeof value === "object" && !Array.isArray(value)
                  ? (value as Record<string, unknown>)
                  : {};
              return {
                key: leg.key ?? leg.type ?? leg.legType,
                distanceKm: leg.distanceKm,
                gpxUrl: leg.gpxUrl,
                gpxUrls: leg.gpxUrls,
                geometryStatus: leg.geometryStatus,
              };
            },
          ),
        })),
      ),
    [resourcesQuery.data?.courseIndex?.contests],
  );
  const fallbackCourseVersion = useMemo(
    () => courseAssetMetadataVersion(fallbackConfig),
    [fallbackConfig],
  );
  const selectionKey = [
    firstText(selection?.ticketId),
    firstText(selection?.contestId),
    firstText(selection?.contestName),
    [...(selection?.allowedSegments ?? [])].sort().join(","),
  ].join(":");
  const geometryOwner =
    source === "event-config"
      ? "event-config"
      : courseGeometryOwner(
          resourcesQuery.data?.courseMap ??
            (resourcesQuery.data === null ? null : undefined),
          resourcesQuery.isSuccess,
        );
  return useQuery({
    queryKey: [
      ...queryKeys.courseMap(resolvedEventId),
      "geometry-v5-source-owned",
      source,
      selectionKey,
      normalizeProviderEventUuid(providerEventUuid) || "event-wide",
      normalizeProviderContestUuid(selection?.contestId) || "contest-wide",
      compactQueryFingerprint(courseMapVersion),
      compactQueryFingerprint(canonicalCourseVersion),
      compactQueryFingerprint(fallbackCourseVersion),
      geometryOwner,
    ],
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      if (source === "event-config") {
        const geometry = fallbackConfig
          ? await resolveCourseGeometry(
              fallbackConfig,
              (url) => httpText(url, signal),
              selection,
            )
          : undefined;
        return geometry
          ? Object.assign(geometry, {
              courseResolutionSource: "event_master_gpx" as const,
              canonicalCourseMissing: false,
            })
          : null;
      }
      if (geometryOwner === "canonical") {
        const geometry = await resolveCourseGeometry(
          resourcesQuery.data?.courseMap,
          (url) => httpText(url, signal),
          selection,
        );
        return geometry
          ? Object.assign(geometry, {
              courseResolutionSource: "canonical" as const,
              canonicalCourseMissing: false,
            })
          : null;
      }

      const fallbackGeometry = fallbackConfig
        ? await resolveCourseGeometry(
            fallbackConfig,
            (url) => httpText(url, signal),
            selection,
          )
        : undefined;
      const resolved = fallbackGeometry
        ? Object.assign(fallbackGeometry, {
            courseResolutionSource: hasConfiguredGpxAsset(fallbackConfig)
              ? ("fallback_gpx" as const)
              : ("fallback_config" as const),
            canonicalCourseMissing: true,
          })
        : null;
      if (process.env.NODE_ENV !== "production") {
        console.log("[course-geometry] fallback", {
          eventId: resolvedEventId,
          providerEventUuid: normalizeProviderEventUuid(providerEventUuid),
          providerContestUuid: normalizeProviderContestUuid(
            selection?.contestId,
          ),
          courseResolutionSource:
            resolved?.courseResolutionSource ?? "unavailable",
          canonicalCourseMissing: true,
          apiGeometry: false,
          canonicalGeometry: false,
          fallbackProvided: Boolean(fallbackConfig),
          fallbackGeometry: Boolean(fallbackGeometry),
        });
      }
      return resolved;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: shouldRetryLiveRequest,
    enabled:
      enabled &&
      validEventId &&
      (source === "event-config"
        ? Boolean(fallbackConfig)
        : geometryOwner === "canonical" ||
          (geometryOwner === "fallback" && Boolean(fallbackConfig))),
  });
}
