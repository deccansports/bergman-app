import { useCallback, useEffect, useMemo } from "react";
import { Alert } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { repositories } from "@/core/repositories";
import { useSession } from "@/core/auth/session";
import { queryKeys } from "@/core/services/query/queryKeys";
import { promptTrackedAthleteNotifications } from "@/core/services/notifications";
import { useWatchlistStore, type TrackedAthlete } from "@/core/store";
import { recordLivePerformance } from "@/features/tracking/livePerformanceDiagnostics";

type ResolvedAthlete = {
  id: string;
  watchlistItemId?: string;
  participantUuid?: string;
  provider?: string;
  providerEventUuid?: string;
  bib: string;
  name: string;
  eventId?: string;
  category?: string;
  ageGroup?: string;
  club?: string;
  photoUrl?: string;
  email?: string;
  providerUuid?: string;
  providerAthleteUuid?: string;
  providerTimingUuid?: string;
  providerRecordId?: string;
  athleteUid?: string;
  bookingId?: string;
  contestId?: string;
  contestUuid?: string;
  providerContestUuid?: string;
  canonicalContestUuid?: string;
  providerContestId?: string;
  ticketId?: string;
  raceDate?: string;
  trackingVisibility?: string;
  liveTrackingPrivacy?: string;
  privacy?: string;
  liveTrackingVisibility?: string;
  searchVisible?: boolean;
  mapVisible?: boolean;
  modalVisible?: boolean;
  anonymous?: boolean;
  viewerCanSeeIdentity?: boolean;
  privacyMasked?: boolean;
  status?: string;
  currentLeg?: string;
  currentSplit?: string;
  latestSplit?: string;
  latestSplitTime?: string;
  elapsedTime?: string | number;
  rank?: number | string;
  progressPercent?: number;
  updatedAt?: string;
  participantLive?: Record<string, unknown>;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanContestLabel(value: unknown): string {
  const textValue = text(value);
  if (!textValue) return "";
  if (/^sub-\d+$/i.test(textValue)) return "";
  return textValue;
}

function isPublicTrackableParticipant(
  participant: Record<string, unknown>,
): boolean {
  const registration =
    participant.registration && typeof participant.registration === "object"
      ? (participant.registration as Record<string, unknown>)
      : undefined;
  const visibility = text(
    participant.trackingVisibility ??
      participant.liveTrackingPrivacy ??
      participant.privacy ??
      participant.liveTrackingVisibility ??
      participant.visibility ??
      registration?.trackingVisibility ??
      registration?.liveTrackingPrivacy,
  ).toUpperCase();
  if (
    participant.viewerCanSeeIdentity === true ||
    participant.privacyMasked === false
  ) {
    return (
      participant.searchVisible !== false &&
      participant.mapVisible !== false &&
      participant.modalVisible !== false
    );
  }
  if (
    visibility === "ANONYMOUS" ||
    visibility === "ANON" ||
    visibility === "PRIVATE" ||
    visibility === "OFFICIALS_ONLY" ||
    participant.anonymous === true
  ) {
    return false;
  }
  return (
    participant.searchVisible !== false &&
    participant.mapVisible !== false &&
    participant.modalVisible !== false
  );
}

function resolveFromRoster(
  eventId: string | undefined,
  ids: string[],
  roster: Record<string, unknown>[],
) {
  if (!eventId || roster.length === 0) return [];
  const wanted = new Set(ids.map((value) => value.trim()).filter(Boolean));
  return roster
    .filter((participant) => {
      if (!isPublicTrackableParticipant(participant)) return false;
      const provider =
        participant.provider && typeof participant.provider === "object"
          ? (participant.provider as Record<string, unknown>)
          : undefined;
      const candidateIds = [
        text(participant.participantUuid),
        text(participant.providerUuid),
        text(participant.providerAthleteUuid),
        text(participant.providerTimingUuid),
        text(participant.providerRecordId),
        text(participant.bookingId),
        text(participant.athleteUid),
        text(provider?.providerUuid),
        text(participant.bib),
      ].filter(Boolean);
      return candidateIds.some((value) => wanted.has(value));
    })
    .map((participant) => {
      const provider =
        participant.provider && typeof participant.provider === "object"
          ? (participant.provider as Record<string, unknown>)
          : undefined;
      return {
        id:
          text(participant.participantUuid) ||
          text(participant.providerUuid) ||
          text(participant.providerAthleteUuid) ||
          text(participant.providerRecordId) ||
          text(participant.bookingId) ||
          text(provider?.providerUuid) ||
          text(participant.bib),
        participantUuid: text(participant.participantUuid) || undefined,
        provider: text(provider?.provider) || "feibot",
        providerEventUuid:
          text(participant.providerEventUuid) ||
          text(participant.participantUuid).match(/^race:([^:]+):/i)?.[1] ||
          undefined,
        bib: text(participant.bib),
        name:
          text(participant.displayName) ||
          text(participant.name) ||
          text(participant.fullName) ||
          `Bib ${text(participant.bib)}`,
        eventId,
        category:
          cleanContestLabel(participant.contestName) ||
          cleanContestLabel(participant.providerContestName) ||
          cleanContestLabel(participant.ageGroupName) ||
          cleanContestLabel(participant.ageGroup),
        ageGroup:
          text(participant.ageGroup) ||
          text(participant.ageGroupName) ||
          text(participant.categoryName) ||
          undefined,
        club: text(participant.club) || text(participant.clubName),
        photoUrl:
          text(participant.profilePhotoUrl) ||
          text(participant.photoUrl) ||
          text(participant.photoURL) ||
          text(participant.avatarUrl) ||
          text(participant.displayPhoto) ||
          undefined,
        email: text(participant.email) || undefined,
        providerUuid:
          text(participant.providerUuid) ||
          text(participant.participantUuid) ||
          text(participant.providerAthleteUuid) ||
          text(participant.providerRecordId) ||
          text(participant.bookingId) ||
          text(provider?.providerUuid) ||
          undefined,
        providerAthleteUuid: text(participant.providerAthleteUuid) || undefined,
        providerTimingUuid: text(participant.providerTimingUuid) || undefined,
        athleteUid: text(participant.athleteUid) || undefined,
        providerRecordId: text(participant.providerRecordId) || undefined,
        bookingId: text(participant.bookingId) || undefined,
        contestId:
          text(participant.contestId) ||
          text(participant.contestUuid) ||
          text(participant.providerContestUuid) ||
          undefined,
        contestUuid: text(participant.contestUuid) || undefined,
        providerContestUuid: text(participant.providerContestUuid) || undefined,
        canonicalContestUuid:
          text(participant.canonicalContestUuid) ||
          text(participant.providerContestUuid) ||
          text(participant.contestUuid) ||
          undefined,
        providerContestId: text(participant.providerContestId) || undefined,
        ticketId: text(participant.ticketId) || undefined,
        trackingVisibility: text(participant.trackingVisibility) || undefined,
        liveTrackingPrivacy: text(participant.liveTrackingPrivacy) || undefined,
        privacy: text(participant.privacy) || undefined,
        liveTrackingVisibility:
          text(participant.liveTrackingVisibility) || undefined,
        searchVisible: participant.searchVisible !== false,
        mapVisible: participant.mapVisible !== false,
        modalVisible: participant.modalVisible !== false,
        viewerCanSeeIdentity: participant.viewerCanSeeIdentity === true,
        privacyMasked: participant.privacyMasked === true,
        anonymous:
          participant.viewerCanSeeIdentity === true
            ? false
            : participant.anonymous === true,
        status: text(participant.status) || undefined,
        currentLeg: text(participant.currentLeg) || undefined,
        currentSplit: text(participant.currentSplit) || undefined,
        latestSplit: text(participant.latestSplit) || undefined,
        latestSplitTime: text(participant.latestSplitTime) || undefined,
        elapsedTime:
          typeof participant.elapsedTime === "string" ||
          typeof participant.elapsedTime === "number"
            ? participant.elapsedTime
            : undefined,
        rank:
          typeof participant.rank === "string" ||
          typeof participant.rank === "number"
            ? participant.rank
            : undefined,
        progressPercent: Number.isFinite(Number(participant.progressPercent))
          ? Number(participant.progressPercent)
          : undefined,
        updatedAt:
          text(participant.updatedAt) ||
          text(participant.lastSeen) ||
          undefined,
        participantLive:
          participant.participantLive &&
          typeof participant.participantLive === "object" &&
          !Array.isArray(participant.participantLive)
            ? (participant.participantLive as Record<string, unknown>)
            : undefined,
      };
    }) satisfies ResolvedAthlete[];
}

function resolveAthleteId(athlete: Partial<ResolvedAthlete>): string {
  return (
    text(athlete.athleteUid) ||
    text(athlete.providerAthleteUuid) ||
    text(athlete.participantUuid) ||
    text(athlete.providerUuid) ||
    text(athlete.providerRecordId) ||
    text(athlete.bookingId) ||
    text(athlete.id) ||
    text(athlete.bib)
  );
}

function resolveContestId(athlete: Partial<ResolvedAthlete>): string {
  return (
    text(athlete.contestId) ||
    text(athlete.contestUuid) ||
    text(athlete.providerContestUuid) ||
    text(athlete.providerContestId) ||
    text(athlete.category)
  );
}

function matchesResolvedAthleteId(
  athlete: Partial<ResolvedAthlete>,
  id: string,
  eventId?: string,
): boolean {
  if (eventId && text(athlete.eventId) !== text(eventId)) return false;
  const candidate = text(id).replace(`${text(eventId)}:`, "");
  return [
    athlete.id,
    athlete.bib,
    athlete.athleteUid,
    athlete.participantUuid,
    athlete.providerUuid,
    athlete.providerAthleteUuid,
    athlete.providerTimingUuid,
    athlete.providerRecordId,
    athlete.bookingId,
  ]
    .map(text)
    .filter(Boolean)
    .includes(candidate);
}

function athleteIdentityValues(athlete: Partial<ResolvedAthlete>): string[] {
  return [
    athlete.id,
    athlete.bib,
    athlete.athleteUid,
    athlete.participantUuid,
    athlete.providerUuid,
    athlete.providerAthleteUuid,
    athlete.providerTimingUuid,
    athlete.providerRecordId,
    athlete.bookingId,
  ]
    .map(text)
    .filter(Boolean);
}

function dedupeResolvedAthletes(
  athletes: ResolvedAthlete[],
  fallbackEventId?: string,
): ResolvedAthlete[] {
  const rows: ResolvedAthlete[] = [];
  for (const athlete of athletes) {
    const event = text(athlete.eventId || fallbackEventId).toLowerCase();
    const identities = new Set(
      athleteIdentityValues(athlete).map(
        (value) => `${event}:${value.toLowerCase()}`,
      ),
    );
    const existingIndex = rows.findIndex((row) => {
      if (text(row.eventId || fallbackEventId).toLowerCase() !== event)
        return false;
      const identityMatch = athleteIdentityValues(row).some((value) =>
        identities.has(`${event}:${value.toLowerCase()}`),
      );
      if (identityMatch) return true;
      const sameName =
        text(row.name).toLowerCase() === text(athlete.name).toLowerCase();
      const oneSideIsLegacy =
        isPlaceholderBib(row.bib) || isPlaceholderBib(athlete.bib);
      return Boolean(sameName && text(row.name) && oneSideIsLegacy);
    });
    if (existingIndex < 0) {
      rows.push(athlete);
      continue;
    }
    const existing = rows[existingIndex];
    const preferIncoming =
      isPlaceholderBib(existing.bib) && !isPlaceholderBib(athlete.bib);
    const preferred = preferIncoming ? athlete : existing;
    const fallback = preferIncoming ? existing : athlete;
    rows[existingIndex] = Object.fromEntries(
      Object.entries({ ...fallback, ...preferred }).filter(
        ([, value]) => value !== undefined && value !== null && value !== "",
      ),
    ) as ResolvedAthlete;
  }
  return rows;
}

/**
 * A roster/search row may resolve identity, but the persisted subscription row
 * owns the exact backend item ID needed for deletion. Canonical identity wins;
 * the backend item ID and any otherwise-missing identity labels are retained.
 */
export function mergeCanonicalWatchlistAthlete(
  persisted: ResolvedAthlete,
  canonical: ResolvedAthlete,
): ResolvedAthlete {
  const participantUuid = text(canonical.participantUuid);
  return Object.fromEntries(
    Object.entries({
      ...persisted,
      ...canonical,
      id: participantUuid || text(canonical.id) || text(persisted.id),
      participantUuid: participantUuid || persisted.participantUuid,
      watchlistItemId:
        text(persisted.watchlistItemId) ||
        text(canonical.watchlistItemId) ||
        undefined,
    }).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  ) as ResolvedAthlete;
}

async function subscribeTrackedAthlete(
  athlete: Partial<ResolvedAthlete>,
  fallbackEventId?: string,
) {
  const athleteId = resolveAthleteId(athlete);
  const eventId = text(athlete.eventId) || fallbackEventId;
  if (!athleteId || !eventId) return;
  await repositories.trackingSubscriptions.subscribe({
    eventId,
    athleteId,
    bib: text(athlete.bib) || null,
    contestId: resolveContestId(athlete) || null,
    name: text(athlete.name) || null,
    category: text(athlete.category) || null,
    ageGroup: text(athlete.ageGroup) || null,
    club: text(athlete.club) || null,
    photoUrl: text(athlete.photoUrl) || null,
    participantUuid: text(athlete.participantUuid) || null,
    provider: text(athlete.provider) || "feibot",
    providerEventUuid:
      text(athlete.providerEventUuid) ||
      text(athlete.participantUuid).match(/^race:([^:]+):/i)?.[1] ||
      null,
    providerUuid: text(athlete.providerUuid) || null,
    providerAthleteUuid: text(athlete.providerAthleteUuid) || null,
    providerTimingUuid: text(athlete.providerTimingUuid) || null,
    providerRecordId: text(athlete.providerRecordId) || null,
    athleteUid: text(athlete.athleteUid) || null,
    bookingId: text(athlete.bookingId) || null,
    contestUuid: text(athlete.contestUuid) || null,
    providerContestUuid: text(athlete.providerContestUuid) || null,
    canonicalContestUuid:
      text(athlete.canonicalContestUuid) ||
      text(athlete.providerContestUuid) ||
      text(athlete.contestUuid) ||
      null,
    providerContestId: text(athlete.providerContestId) || null,
    ticketId: text(athlete.ticketId) || null,
    raceDate: text(athlete.raceDate) || null,
    status: text(athlete.status) || null,
    currentLeg: text(athlete.currentLeg) || null,
    currentSplit: text(athlete.currentSplit) || null,
    latestSplit: text(athlete.latestSplit) || null,
    latestSplitTime: text(athlete.latestSplitTime) || null,
    elapsedTime: athlete.elapsedTime ?? null,
    rank: athlete.rank ?? null,
    progressPercent: athlete.progressPercent ?? null,
    updatedAt: text(athlete.updatedAt) || null,
  });
}

function bibFromWatchlistId(value: unknown): string {
  const raw = text(value);
  const tagged = raw.match(/(?:^|:)bib:([^:]+)/i)?.[1];
  if (tagged) return text(tagged);
  const legacyRaceBib = raw.match(/(?:^|:)race:[^:]+:[^:]+:(\d+)$/i)?.[1];
  return text(legacyRaceBib);
}

function isPlaceholderBib(value: unknown): boolean {
  const candidate = text(value);
  return !candidate || /^(?:participant|athlete|timing):/i.test(candidate);
}

function eventFromWatchlistId(value: unknown): string {
  const raw = text(value);
  const marker = raw.toLowerCase().lastIndexOf(":bib:");
  return marker > 0 ? raw.slice(0, marker) : "";
}

function usableWatchlistName(value: unknown, compositeId: string): string {
  const candidate = text(value);
  if (!candidate || candidate === compositeId) return "";
  if (/^bib\s+.+:bib:/i.test(candidate)) return "";
  return candidate;
}

export function trackedAthleteFromSubscription(
  value: unknown,
): TrackedAthlete | null {
  if (!value || typeof value !== "object") return null;
  const outer = value as Record<string, unknown>;
  const nested =
    outer.athlete && typeof outer.athlete === "object"
      ? (outer.athlete as Record<string, unknown>)
      : {};
  const row = { ...outer, ...nested };
  const compositeId = text(outer.id);
  const rawBib = text(row.bib) || text(row.bibNumber);
  const parsedBib =
    bibFromWatchlistId(rawBib) ||
    (!isPlaceholderBib(rawBib) ? rawBib : "") ||
    bibFromWatchlistId(row.athleteId) ||
    bibFromWatchlistId(compositeId);
  const rawAthleteId = text(row.athleteId);
  const genericAthleteId = bibFromWatchlistId(rawAthleteId)
    ? `bib:${bibFromWatchlistId(rawAthleteId)}`
    : rawAthleteId;
  const taggedBibId =
    parsedBib && /(?:^|:)bib:/i.test(compositeId) ? `bib:${parsedBib}` : "";
  const id =
    (parsedBib ? `bib:${parsedBib}` : "") ||
    (text(nested.id) && text(nested.id) !== compositeId
      ? text(nested.id)
      : "") ||
    genericAthleteId ||
    text(row.participantUuid) ||
    text(row.providerAthleteUuid) ||
    text(row.providerUuid) ||
    taggedBibId ||
    parsedBib;
  if (!id) return null;
  // Never surface an opaque participant/provider identity as a race number.
  // The canonical roster can fill this later; an unknown BIB must stay blank.
  const bib = parsedBib;
  const name =
    usableWatchlistName(row.name, compositeId) ||
    usableWatchlistName(row.displayName, compositeId) ||
    usableWatchlistName(row.fullName, compositeId) ||
    usableWatchlistName(outer.label, compositeId) ||
    (bib ? `Bib ${bib}` : "Athlete");
  const athleteUid = text(row.athleteUid);
  return {
    id,
    // Keep the opaque account-watchlist key. It can differ from the current
    // roster identity after a provider import or bib normalization.
    watchlistItemId: compositeId || undefined,
    bib,
    name,
    eventId:
      text(row.eventId) || eventFromWatchlistId(compositeId) || undefined,
    category:
      text(row.contestName) ||
      text(row.providerContestName) ||
      text(row.contest) ||
      text(row.ticketName) ||
      text(row.category) ||
      undefined,
    ageGroup:
      text(row.ageGroup) ||
      text(row.ageGroupName) ||
      text(row.categoryName) ||
      undefined,
    club: text(row.club) || text(row.clubName) || undefined,
    photoUrl:
      text(row.profilePhotoUrl) ||
      text(row.photoUrl) ||
      text(row.photoURL) ||
      text(row.avatarUrl) ||
      text(row.displayPhoto) ||
      undefined,
    email: text(row.email) || undefined,
    participantUuid: text(row.participantUuid) || undefined,
    provider: text(row.provider) || "feibot",
    providerEventUuid:
      text(row.providerEventUuid) ||
      text(row.participantUuid).match(/^race:([^:]+):/i)?.[1] ||
      undefined,
    providerUuid: text(row.providerUuid) || undefined,
    providerAthleteUuid: text(row.providerAthleteUuid) || undefined,
    providerTimingUuid: text(row.providerTimingUuid) || undefined,
    providerRecordId: text(row.providerRecordId) || undefined,
    // A generic `athleteId` may be `bib:1001`; it is not a Firebase UID.
    athleteUid: athleteUid || undefined,
    bookingId: text(row.bookingId) || undefined,
    contestId: text(row.contestId) || undefined,
    contestUuid: text(row.contestUuid) || undefined,
    providerContestUuid: text(row.providerContestUuid) || undefined,
    canonicalContestUuid:
      text(row.canonicalContestUuid) ||
      text(row.providerContestUuid) ||
      text(row.contestUuid) ||
      undefined,
    providerContestId: text(row.providerContestId) || undefined,
    ticketId: text(row.ticketId) || undefined,
    raceDate: text(row.raceDate) || undefined,
    trackingVisibility: text(row.trackingVisibility) || undefined,
    liveTrackingPrivacy: text(row.liveTrackingPrivacy) || undefined,
    privacy: text(row.privacy) || undefined,
    liveTrackingVisibility: text(row.liveTrackingVisibility) || undefined,
    searchVisible: row.searchVisible !== false,
    mapVisible: row.mapVisible !== false,
    modalVisible: row.modalVisible !== false,
    viewerCanSeeIdentity: row.viewerCanSeeIdentity === true,
    privacyMasked: row.privacyMasked === true,
    anonymous:
      row.viewerCanSeeIdentity === true ? false : row.anonymous === true,
    status: text(row.status) || undefined,
    currentLeg: text(row.currentLeg) || undefined,
    currentSplit: text(row.currentSplit) || undefined,
    latestSplit: text(row.latestSplit) || undefined,
    latestSplitTime: text(row.latestSplitTime) || undefined,
    elapsedTime:
      typeof row.elapsedTime === "string" || typeof row.elapsedTime === "number"
        ? row.elapsedTime
        : undefined,
    rank:
      typeof row.rank === "string" || typeof row.rank === "number"
        ? row.rank
        : undefined,
    progressPercent: Number.isFinite(Number(row.progressPercent))
      ? Number(row.progressPercent)
      : undefined,
    updatedAt: text(row.updatedAt) || text(row.lastSeen) || undefined,
    participantLive:
      row.participantLive &&
      typeof row.participantLive === "object" &&
      !Array.isArray(row.participantLive)
        ? (row.participantLive as Record<string, unknown>)
        : undefined,
  };
}

async function unsubscribeTrackedAthlete(
  athlete: Partial<ResolvedAthlete>,
  fallbackEventId?: string,
) {
  const athleteId = resolveAthleteId(athlete);
  const eventId = text(athlete.eventId) || fallbackEventId;
  if (!athleteId || !eventId) {
    throw new Error(
      "A complete tracked-athlete identity is required for removal.",
    );
  }
  return repositories.trackingSubscriptions.unsubscribe({
    eventId,
    athleteId,
    watchlistItemId: text(athlete.watchlistItemId) || undefined,
    participantUuid: text(athlete.participantUuid) || undefined,
    providerUuid:
      text(athlete.providerUuid) ||
      text(athlete.providerAthleteUuid) ||
      text(athlete.providerTimingUuid) ||
      undefined,
    contestUuid:
      text(athlete.providerContestUuid) ||
      text(athlete.contestUuid) ||
      undefined,
    bib: text(athlete.bib) || undefined,
  });
}

/** Account watchlist with an optimistic Secure Store cache for offline use. */
export function useWatchlist(
  eventId?: string,
  roster: Record<string, unknown>[] = [],
) {
  const queryClient = useQueryClient();
  const athletes = useWatchlistStore((s) => s.athletes);
  const hydrated = useWatchlistStore((s) => s.hydrated);
  const storeToggle = useWatchlistStore((s) => s.toggle);
  const storeAddAthlete = useWatchlistStore((s) => s.addAthlete);
  const storeReplaceAthletes = useWatchlistStore((s) => s.replaceAthletes);
  const storeIsWatched = useWatchlistStore((s) => s.isWatched);
  useEffect(() => {
    recordLivePerformance("watchlistStoreUpdates");
  }, [athletes, hydrated]);
  const isAuthenticated = useSession((s) => s.status === "authenticated");
  const userId = useSession((s) => s.user?.uid);
  const resolvedAthletes = useMemo(() => {
    if (!eventId) return athletes;
    const eventAthletes = athletes.filter(
      (athlete) => text(athlete.eventId) === eventId,
    );
    if (roster.length === 0)
      return dedupeResolvedAthletes(eventAthletes, eventId);

    const eventIds = eventAthletes.flatMap((athlete) =>
      athleteIdentityValues(athlete).flatMap((value) => {
        const parsedBib = bibFromWatchlistId(value);
        return parsedBib ? [value, parsedBib] : [value];
      }),
    );
    const rosterAthletes = resolveFromRoster(eventId, eventIds, roster).map(
      (canonical) => {
        const persisted = eventAthletes.find(
          (candidate) =>
            matchesResolvedAthleteId(
              candidate,
              resolveAthleteId(canonical),
              eventId,
            ) ||
            (text(candidate.bib) &&
              text(candidate.bib) === text(canonical.bib)),
        );
        return persisted
          ? mergeCanonicalWatchlistAthlete(persisted, canonical)
          : canonical;
      },
    );
    // Once the event roster is available, only reconciled canonical athletes
    // may be rendered. Persisted subscription rows are identity hints, not a
    // second athlete source; appending them caused duplicate and "Unmapped"
    // cards when historical IDs survived a participant rebuild.
    return dedupeResolvedAthletes(rosterAthletes, eventId);
  }, [athletes, eventId, roster]);

  const reconcileAfterMutation = useCallback(
    async (mutation: Promise<void>) => {
      try {
        await mutation;
        if (isAuthenticated && userId) {
          // Mutations are the only membership update path. Keep the single
          // session-owned query cache aligned with the optimistic store without
          // issuing another GET.
          queryClient.setQueryData(
            queryKeys.accountWatchlist(userId),
            useWatchlistStore.getState().athletes,
          );
        }
        return true;
      } catch (error) {
        console.warn("[watchlist] synchronization failed", error);
        Alert.alert(
          "Watchlist synchronization error",
          "Your selection is saved on this device. Notification synchronization will retry when the connection is available.",
        );
        return false;
      }
    },
    [isAuthenticated, queryClient, userId],
  );

  const addAthlete = useCallback(
    (athlete: ResolvedAthlete) => {
      const wasEmpty = useWatchlistStore.getState().athletes.length === 0;
      const resolvedId = resolveAthleteId(athlete) || text(athlete.bib);
      if (!resolvedId) return;
      const localAthlete: ResolvedAthlete = {
        ...athlete,
        id: resolvedId,
        bib:
          bibFromWatchlistId(athlete.bib) ||
          (!isPlaceholderBib(athlete.bib) ? text(athlete.bib) : ""),
        name:
          text(athlete.name) ||
          (text(athlete.bib) ? `Bib ${text(athlete.bib)}` : "Athlete"),
        eventId: text(athlete.eventId) || eventId,
        providerUuid:
          text(athlete.providerUuid) ||
          text(athlete.participantUuid) ||
          text(athlete.providerTimingUuid) ||
          undefined,
      };
      storeAddAthlete(localAthlete);
      // Public tracking is intentionally device-local. Only an authenticated
      // account owns server watchlist membership and push subscriptions.
      if (isAuthenticated) {
        void reconcileAfterMutation(
          subscribeTrackedAthlete(localAthlete, eventId),
        );
        if (wasEmpty) void promptTrackedAthleteNotifications();
      }
    },
    [eventId, isAuthenticated, reconcileAfterMutation, storeAddAthlete],
  );

  const reconcileCanonicalAthlete = useCallback(
    (canonical: ResolvedAthlete) => {
      const participantUuid = text(canonical.participantUuid);
      if (!participantUuid) return;
      const before = useWatchlistStore.getState().athletes;
      const index = before.findIndex(
        (candidate) =>
          matchesResolvedAthleteId(candidate, participantUuid, eventId) ||
          (text(candidate.eventId) === text(eventId) &&
            text(candidate.bib) === text(canonical.bib)),
      );
      if (index < 0) return;
      const existing = before[index];
      if (
        text(existing.id) === participantUuid &&
        text(existing.participantUuid) === participantUuid &&
        text(existing.providerEventUuid) ===
          text(canonical.providerEventUuid) &&
        text(existing.providerContestUuid) ===
          text(canonical.providerContestUuid)
      ) {
        return;
      }
      const next = [...before];
      next[index] = mergeCanonicalWatchlistAthlete(
        existing as ResolvedAthlete,
        { ...canonical, eventId: text(canonical.eventId) || eventId },
      );
      storeReplaceAthletes(next);
      if (isAuthenticated && userId) {
        queryClient.setQueryData(queryKeys.accountWatchlist(userId), next);
      }
    },
    [eventId, isAuthenticated, queryClient, storeReplaceAthletes, userId],
  );

  const toggle = useCallback(
    async (id: string): Promise<boolean> => {
      const before = useWatchlistStore.getState().athletes;
      const existing = before.find((athlete) =>
        matchesResolvedAthleteId(athlete, id, eventId),
      );
      if (!existing) return false;

      if (isAuthenticated && userId) {
        // Prevent a GET that began before this mutation from committing an
        // older account watchlist after DELETE succeeds.
        await queryClient.cancelQueries({
          queryKey: queryKeys.accountWatchlist(userId),
          exact: true,
        });
      }

      // Membership disappears from both Zustand and React Query before the
      // DELETE starts. A stale detail/search cache is never a visibility owner.
      const removedLocally = await storeToggle(id, eventId);
      if (!removedLocally) return false;
      const optimistic = useWatchlistStore.getState().athletes;
      if (isAuthenticated && userId) {
        queryClient.setQueryData(
          queryKeys.accountWatchlist(userId),
          optimistic,
        );
      }
      // A public-session watchlist has no backend subscription to delete.
      if (!isAuthenticated) return true;
      try {
        const remainingSubscriptions = await unsubscribeTrackedAthlete(
          existing,
          eventId,
        );
        const deletedItemId = text(existing.watchlistItemId);
        const existingIdentities = new Set(athleteIdentityValues(existing));
        const confirmedAthletes = remainingSubscriptions
          .map(trackedAthleteFromSubscription)
          .filter((row): row is NonNullable<typeof row> => Boolean(row));
        if (
          remainingSubscriptions.some(
            (subscription) =>
              Boolean(deletedItemId) && text(subscription.id) === deletedItemId,
          ) ||
          confirmedAthletes.some(
            (candidate) =>
              text(candidate.eventId) === text(existing.eventId || eventId) &&
              athleteIdentityValues(candidate).some((value) =>
                existingIdentities.has(value),
              ),
          )
        ) {
          throw new Error(
            "The backend did not remove the requested watchlist item.",
          );
        }
        // The DELETE response is the authoritative remaining account
        // watchlist. Persist it before reporting success so a cold restart
        // cannot hydrate the athlete that was just removed.
        await storeReplaceAthletes(confirmedAthletes);
        if (isAuthenticated && userId) {
          queryClient.setQueryData(
            queryKeys.accountWatchlist(userId),
            remainingSubscriptions,
          );
        }
        return true;
      } catch (error) {
        // A genuine DELETE failure restores the exact pre-mutation collection;
        // no invalidation/refetch window can flash an older server snapshot.
        await storeReplaceAthletes(before);
        if (isAuthenticated && userId) {
          queryClient.setQueryData(queryKeys.accountWatchlist(userId), before);
        }
        console.warn("[watchlist] removal synchronization failed", error);
        Alert.alert(
          "Could not remove athlete",
          "The tracking list was restored. Please check your connection and try again.",
        );
        return false;
      }
    },
    [
      eventId,
      isAuthenticated,
      queryClient,
      storeReplaceAthletes,
      storeToggle,
      userId,
    ],
  );

  return {
    ids: resolvedAthletes.map((athlete) => athlete.id),
    athletes: resolvedAthletes as ResolvedAthlete[],
    hydrated,
    toggle,
    addAthlete,
    reconcileCanonicalAthlete,
    isWatched: (id: string) => storeIsWatched(id, eventId),
  };
}
