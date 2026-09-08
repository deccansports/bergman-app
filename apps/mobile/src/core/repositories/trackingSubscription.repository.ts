import {
  authenticatedJson,
  optionalAuthenticatedJson,
} from "@/core/auth/authenticatedFetch";
import { getPersistedPushDeviceId } from "@/core/services/pushDeviceIdentity";

import { resolveWatchlistDeleteItemId } from "./watchlistIdentity";

export type TrackingSubscriptionInput = {
  [key: string]: unknown;
  /** Preserved server-side watchlist ID for legacy or normalized athletes. */
  watchlistItemId?: string | null;
  eventId?: string | null;
  athleteId: string;
  bib?: string | null;
  contestId?: string | null;
  name?: string | null;
  category?: string | null;
  ageGroup?: string | null;
  club?: string | null;
  photoUrl?: string | null;
  participantUuid?: string | null;
  providerUuid?: string | null;
  providerAthleteUuid?: string | null;
  providerTimingUuid?: string | null;
  providerRecordId?: string | null;
  athleteUid?: string | null;
  bookingId?: string | null;
  contestUuid?: string | null;
  providerContestUuid?: string | null;
  providerContestId?: string | null;
  ticketId?: string | null;
  raceDate?: string | null;
  email?: string | null;
  status?: string | null;
  currentLeg?: string | null;
  currentSplit?: string | null;
  latestSplit?: string | null;
  latestSplitTime?: string | null;
  elapsedTime?: string | number | null;
  rank?: number | string | null;
  progressPercent?: number | null;
  updatedAt?: string | null;
};

export type TrackingSubscriptionRecord = TrackingSubscriptionInput & {
  id?: string | null;
};

type TrackingSubscriptionRemovalInput = Pick<
  TrackingSubscriptionInput,
  | "eventId"
  | "athleteId"
  | "watchlistItemId"
  | "participantUuid"
  | "providerUuid"
  | "contestUuid"
  | "bib"
>;

export interface ITrackingSubscriptionRepository {
  list(): Promise<TrackingSubscriptionRecord[]>;
  subscribe(input: TrackingSubscriptionInput): Promise<void>;
  unsubscribe(
    input: TrackingSubscriptionRemovalInput,
  ): Promise<TrackingSubscriptionRecord[]>;
}

/**
 * The server requires a device ID only for guest watchlists. A signed-in
 * account is authenticated by its Firebase token, so a transient Secure Store
 * failure must not prevent its watchlist mutation from reaching the server.
 */
async function optionalPushDeviceId(): Promise<string | undefined> {
  try {
    const deviceId = await getPersistedPushDeviceId();
    return deviceId || undefined;
  } catch {
    return undefined;
  }
}

async function bodyFor(input: TrackingSubscriptionInput) {
  const eventId = String(input.eventId ?? "").trim();
  const athleteId = String(input.athleteId ?? "").trim();
  const deviceId = await optionalPushDeviceId();
  return {
    id: `${eventId}:${athleteId}`,
    type: "live-athlete",
    eventId,
    athleteId,
    label: input.name || input.bib || athleteId,
    ...(deviceId ? { deviceId } : {}),
    athlete: {
      ...input,
      eventId,
      athleteId,
      id: athleteId,
    },
  };
}

function rowsFromResponse(payload: unknown): TrackingSubscriptionRecord[] {
  if (Array.isArray(payload)) return payload as TrackingSubscriptionRecord[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const rows =
    record.subscriptions ?? record.watchlist ?? record.items ?? record.data;
  if (Array.isArray(rows)) return rows as TrackingSubscriptionRecord[];
  if (rows && typeof rows === "object") {
    const nested = rows as Record<string, unknown>;
    const nestedRows = nested.subscriptions ?? nested.watchlist ?? nested.items;
    if (Array.isArray(nestedRows))
      return nestedRows as TrackingSubscriptionRecord[];
  }
  return [];
}

let listRequest: Promise<TrackingSubscriptionRecord[]> | null = null;

export const ProductionTrackingSubscriptionRepository: ITrackingSubscriptionRepository =
  {
    async list() {
      if (listRequest) return listRequest;
      listRequest = authenticatedJson<unknown>("/api/watchlist")
        .then(rowsFromResponse)
        .finally(() => {
          listRequest = null;
        });
      return listRequest;
    },

    async subscribe(input) {
      if (!input.eventId || !input.athleteId) return;
      await optionalAuthenticatedJson("/api/watchlist", {
        method: "POST",
        body: await bodyFor(input),
      });
    },

    async unsubscribe(input) {
      if (!input.eventId || !input.athleteId) {
        throw new Error("A complete tracked-athlete identity is required for removal.");
      }
      // The roster may normalize a saved entry to a bib, while older account
      // records were created with a provider UUID. Delete the persisted item
      // ID when available instead of reconstructing a different identifier.
      const itemId = resolveWatchlistDeleteItemId(input);
      const deviceId = await optionalPushDeviceId();
      const deviceQuery = deviceId
        ? `?deviceId=${encodeURIComponent(deviceId)}`
        : "";
      const payload = await optionalAuthenticatedJson<unknown>(
        `/api/watchlist/${encodeURIComponent(itemId)}${deviceQuery}`,
        {
          method: "DELETE",
          body: {
            eventId: input.eventId,
            participantUuid: input.participantUuid || null,
            providerUuid: input.providerUuid || null,
            contestUuid: input.contestUuid || null,
            bib: input.bib || null,
          },
        },
      );
      return rowsFromResponse(payload);
    },
  };
