import { webApi } from "@/core/services/api";
import type { LeaderboardResponse } from "@/core/types";

export type LeaderboardFilters = {
  contest?: string;
  contestUuid?: string;
  providerEventUuid?: string;
  ageGroup?: string;
  gender?: "Male" | "Female" | "All";
  split?: string;
  limit?: number;
  participantUuid?: string;
  bib?: string;
};

export interface ILeaderboardRepository {
  getLeaderboardScopes(
    eventId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  getLeaderboard(
    eventId: string,
    filters?: LeaderboardFilters,
    signal?: AbortSignal,
  ): Promise<LeaderboardResponse>;
}

type LegacyLeaderboardResponse = LeaderboardResponse & {
  data?: {
    athletes?: LeaderboardResponse["athletes"];
    rows?: LeaderboardResponse["athletes"];
  };
  leaderboard?: {
    rows?: LeaderboardResponse["athletes"];
    athletes?: LeaderboardResponse["athletes"];
  };
  rows?: LeaderboardResponse["athletes"];
};

export function normalizeLeaderboardResponse(
  response: LegacyLeaderboardResponse,
  fallbackSource: string,
): LeaderboardResponse {
  const athletes = Array.isArray(response.athletes)
    ? response.athletes
    : Array.isArray(response.data?.athletes)
      ? response.data.athletes
      : Array.isArray(response.leaderboard?.rows)
        ? response.leaderboard.rows
        : Array.isArray(response.leaderboard?.athletes)
          ? response.leaderboard.athletes
          : Array.isArray(response.data?.rows)
            ? response.data.rows
            : Array.isArray(response.rows)
              ? response.rows
              : [];
  return {
    ...response,
    athletes,
    count: Number(
      response.count ?? response.data?.athletes?.length ?? athletes.length,
    ),
    source: response.source || fallbackSource,
  };
}

export const ProductionLeaderboardRepository: ILeaderboardRepository = {
  async getLeaderboardScopes(eventId, signal) {
    return webApi.json<Record<string, unknown>>(
      `/api/live/course-index/${encodeURIComponent(eventId)}?scopeOnly=1`,
      { signal },
    );
  },

  async getLeaderboard(eventId, filters = {}, signal) {
    const contestId = String(
      filters.contestUuid ?? filters.contest ?? "",
    ).trim();
    const providerEventUuid = String(filters.providerEventUuid ?? "").trim();
    if (!contestId || !providerEventUuid) {
      throw new Error("CANONICAL_LEADERBOARD_SCOPE_REQUIRED");
    }

    const query = new URLSearchParams({
      providerEventUuid,
      contestUuid: contestId,
      limit: String(filters.limit ?? 100),
    });
    if (filters.ageGroup) query.set("ageGroup", filters.ageGroup);
    if (filters.gender && filters.gender !== "All")
      query.set("gender", filters.gender);
    if (filters.split) query.set("split", filters.split);
    if (filters.participantUuid)
      query.set("participantUuid", filters.participantUuid);
    if (filters.bib) query.set("bib", filters.bib);
    const response = await webApi.json<LegacyLeaderboardResponse>(
      `/api/live/leaderboard/${encodeURIComponent(eventId)}?${query.toString()}`,
      { signal },
    );
    return normalizeLeaderboardResponse(response, "live_leaderboard");
  },
};
