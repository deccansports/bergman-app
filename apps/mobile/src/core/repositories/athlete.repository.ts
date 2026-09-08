import { api, webApi } from "@/core/services/api";
import type {
  AthleteModalResponse,
  AthleteSearchMatch,
  AthleteSearchResponse,
  Split,
} from "@/core/types";
import { getInitials } from "@/core/utils/avatar";
import { getCountryDisplayName } from "@/core/utils/format";

import {
  mergeCanonicalSplitsWithHotTiming,
  resolveAcceptedChipStart,
} from "./canonicalHotTiming";
import { mergeAthleteOnlySnapshot } from "./athletePredictionMerge";
import {
  getParticipantLive,
  participantLiveAsCanonicalEnvelope,
  type MobileLiveReadReason,
} from "./participantLive.repository";
import { hasAcceptedSplitEvidence } from "./acceptedSplitEvidence";
import {
  athleteSearchSingleFlightKey,
  runAthleteSearchSingleFlight,
} from "./searchSingleFlight";

export type AthleteSearchMode =
  | "bib"
  | "name"
  | "club"
  | "country"
  | "email"
  | "bookingId"
  | "athleteUid"
  | "providerUuid";
export type AthleteDetailParams = {
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
};

export type AthleteDetailSource = "live" | "results";
export type AthleteDetailRequestType = "full" | "athleteOnly";

export function inferAthleteSearchMode(
  query: string,
  fallback: AthleteSearchMode = "name",
): AthleteSearchMode {
  const value = query.trim();
  if (!value) return fallback;
  if (/^\d+$/.test(value)) return "bib";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "email";
  return "name";
}

function toText(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

type ManualTerminalStatus = "DNS" | "DNF" | "DNQ" | "DSQ";

function manualTerminalStatus(
  ...values: Array<Record<string, unknown>>
): ManualTerminalStatus | null {
  for (const value of values) {
    const source = toText(value.statusSource)?.toUpperCase();
    if (source !== "MANUAL_OVERRIDE") continue;
    const raw = toText(value.status ?? value.timingState)?.toUpperCase();
    const status = raw === "DISQUALIFIED" || raw === "DQ" ? "DSQ" : raw;
    if (["DNS", "DNF", "DNQ", "DSQ"].includes(status ?? "")) {
      return status as ManualTerminalStatus;
    }
  }
  return null;
}

function toNumberOrString(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function resolveCountryName(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = getCountryDisplayName(toText(value));
    if (text) return text;
  }
  return undefined;
}

function normalizeContestSplits(value: unknown): Split[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      segment:
        toText(record.segment) || toText(record.label) || `S${index + 1}`,
      name: toText(record.name) || toText(record.label),
      distance:
        typeof record.distance === "number" && Number.isFinite(record.distance)
          ? record.distance
          : Number(record.distance ?? 0) || 0,
      time:
        typeof record.time === "number" && Number.isFinite(record.time)
          ? record.time
          : Number(record.time ?? 0) || 0,
      absoluteTimestamp:
        typeof record.absoluteTimestamp === "number" &&
        Number.isFinite(record.absoluteTimestamp)
          ? record.absoluteTimestamp
          : undefined,
    };
  });
}

function normalizeOfficialSplits(
  value: unknown,
): { label: string; time: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      const label =
        toText(record.label) ||
        toText(record.segment) ||
        toText(record.name) ||
        `S${index + 1}`;
      const time = toText(record.time) || "";
      return time ? { label, time } : null;
    })
    .filter((item): item is { label: string; time: string } => Boolean(item));
}

function buildOfficialSplitsFromPayload(
  payload: Record<string, unknown>,
): { label: string; time: string }[] {
  const direct = normalizeOfficialSplits(payload.splits);
  if (direct.length > 0) return direct;

  const run1 = toText(payload.run1 ?? payload.run_1);
  const run2 = toText(payload.run2 ?? payload.run_2);
  if (run1 || run2) {
    return [
      { label: "Run 1", time: run1 },
      { label: "T1", time: toText(payload.t1) },
      { label: "Bike", time: toText(payload.bike) },
      { label: "T2", time: toText(payload.t2) },
      { label: "Run 2", time: run2 },
    ].filter((item): item is { label: string; time: string } =>
      Boolean(item.time),
    );
  }

  const fallback = [
    { label: "Swim", time: toText(payload.swim) },
    { label: "T1", time: toText(payload.t1) },
    { label: "Bike", time: toText(payload.bike) },
    { label: "T2", time: toText(payload.t2) },
    { label: "Run", time: toText(payload.run) },
  ].filter((item): item is { label: string; time: string } =>
    Boolean(item.time),
  );

  return fallback;
}

function normalizeAthleteSearchResponse(
  eventId: string,
  q: string,
  mode: string,
  raw: unknown,
): AthleteSearchResponse {
  const payload =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : {};
  const source = Array.isArray(data.rows)
    ? data
    : payload.rows && Array.isArray(payload.rows)
      ? payload
      : data;
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const mappedCandidates = rows.map((row) => ({
    raw: row && typeof row === "object" ? (row as Record<string, unknown>) : {},
    mapped: normalizeAthleteSearchRow(row),
  }));
  let normalized = mappedCandidates
    .map(({ mapped }) => mapped)
    .filter((row): row is AthleteSearchMatch => Boolean(row));
  if (mode.toLowerCase() === "bib") {
    const requestedBib = normalizeBibForComparison(q);
    normalized = normalized.filter(
      (row) => normalizeBibForComparison(row.bib) === requestedBib,
    );
    if (process.env.NODE_ENV !== "production") {
      const diagnostics =
        payload.diagnostics && typeof payload.diagnostics === "object"
          ? (payload.diagnostics as Record<string, unknown>)
          : {};
      console.log(
        "[athlete-search] sanitized candidate trace",
        mappedCandidates.map(({ raw: candidate, mapped }) => {
          const candidateBib = candidate.bib ?? candidate.bibNumber;
          const normalizedBib = normalizeBibForComparison(candidateBib);
          return {
            bib: candidateBib ?? null,
            normalizedBib,
            participantUuid: toText(candidate.participantUuid) ?? null,
            providerEventUuid: toText(candidate.providerEventUuid) ?? null,
            providerContestUuid: toText(candidate.providerContestUuid) ?? null,
            canonicalContestUuid:
              toText(candidate.canonicalContestUuid) ?? null,
            providerParticipantUuid:
              toText(candidate.providerParticipantUuid) ?? null,
            athleteUid: toText(candidate.athleteUid) ?? null,
            displayName:
              toText(
                candidate.displayName ?? candidate.name ?? candidate.fullName,
              ) ?? null,
            sourceIndexKey: toText(diagnostics.sourceKey) ?? null,
            accepted: Boolean(
              mapped && normalizeBibForComparison(mapped.bib) === requestedBib,
            ),
            rejectionReason: !mapped
              ? "mapper_rejected"
              : normalizeBibForComparison(mapped.bib) !== requestedBib
                ? "strict_bib_mismatch"
                : null,
          };
        }),
      );
    }
  }
  const rawCount = rows.length;
  const count =
    mode.toLowerCase() === "bib"
      ? normalized.length
      : typeof source.total === "number"
        ? source.total
        : rawCount;
  const publicAthleteVisibility =
    typeof source.publicAthleteVisibility === "boolean"
      ? source.publicAthleteVisibility
      : typeof payload.publicAthleteVisibility === "boolean"
        ? payload.publicAthleteVisibility
        : undefined;
  const visibilityEnabled =
    typeof source.visibilityEnabled === "boolean"
      ? source.visibilityEnabled
      : typeof payload.visibilityEnabled === "boolean"
        ? payload.visibilityEnabled
        : undefined;
  const visibilityVersion =
    typeof source.visibilityVersion === "number"
      ? source.visibilityVersion
      : typeof payload.visibilityVersion === "number"
        ? payload.visibilityVersion
        : undefined;
  const responseVisibilitySource = source.source;
  const visibilitySource =
    typeof responseVisibilitySource === "string"
      ? responseVisibilitySource
      : undefined;

  return {
    success: payload.success !== false,
    eventId: toText(source.eventId ?? payload.eventId) || eventId,
    q: toText(source.q ?? payload.q) || q,
    mode: toText(source.mode ?? payload.mode) || mode,
    totalIndex: count,
    matches:
      publicAthleteVisibility === false ||
      visibilityEnabled === false ||
      visibilitySource === "visibility_lock"
        ? []
        : normalized,
    publicAthleteVisibility,
    visibilityEnabled,
    visibilityVersion,
    source: toText(source.source ?? payload.source),
  };
}

function normalizeBibForComparison(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) return normalized.toLowerCase();
  return normalized.replace(/^0+(?=\d)/, "");
}

type AthleteSearchRawRow = Record<string, unknown>;

function normalizeAthleteSearchRow(raw: unknown): AthleteSearchMatch | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as AthleteSearchRawRow;
  const mapping =
    row.mapping &&
    typeof row.mapping === "object" &&
    !Array.isArray(row.mapping)
      ? (row.mapping as AthleteSearchRawRow)
      : {};
  const provider =
    row.provider &&
    typeof row.provider === "object" &&
    !Array.isArray(row.provider)
      ? (row.provider as AthleteSearchRawRow)
      : {};
  const rawMeta =
    row.raw && typeof row.raw === "object" && !Array.isArray(row.raw)
      ? (row.raw as AthleteSearchRawRow)
      : {};

  const name = toText(row.name) || toText(row.fullName) || "";
  const bib = String(
    (row as { bib?: unknown; bibNumber?: unknown }).bib ??
      (row as { bibNumber?: unknown }).bibNumber ??
      "",
  ).trim();
  const participantOrProviderId =
    toText(row.participantUuid) ||
    toText(row.providerUuid) ||
    toText(row.providerAthleteUuid) ||
    toText(row.providerTimingUuid) ||
    toText(row.providerRecordId) ||
    toText(provider.providerUuid) ||
    toText(row.bookingId) ||
    toText(row.athleteUid) ||
    toText(row.uid);
  const providerUuid =
    toText(row.providerParticipantUuid) ||
    toText(row.providerUuid) ||
    toText(row.providerTimingUuid) ||
    toText(row.participantUuid) ||
    toText(provider.providerUuid) ||
    toText(row.providerAthleteUuid) ||
    toText(row.providerRecordId);
  const isBibLike = bib.length > 0;
  const isValid =
    (isBibLike || Boolean(participantOrProviderId)) && name.length > 0;
  if (!isValid) return null;

  const normalizedProviderName =
    typeof row.provider === "string"
      ? row.provider
      : toText(provider.provider) || "feibot";

  const resolvedContestUuid =
    toText(row.contestUuid) ||
    toText(row.contest_uuid) ||
    toText(row.providerContestUuid) ||
    toText(mapping.contestUuid);
  const contestUuid = resolvedContestUuid;

  const clubName = toText(row.clubName) || toText(row.club) || null;
  const resolvedPhoto =
    toText(row.profilePhotoUrl) ||
    toText(row.photoUrl) ||
    toText(row.photoURL) ||
    toText(row.avatarUrl) ||
    toText(row.displayPhoto) ||
    "";

  return {
    id:
      toText(row.id) ||
      toText(row.bookingId) ||
      toText(row.uid) ||
      (toText(row.participantUuid)
        ? `cloud:${toText(row.participantUuid)}`
        : ""),
    // Provider/participant UUIDs are timing identities, not Firebase user IDs.
    athleteUid: toText(row.athleteUid) || toText(row.uid) || undefined,
    name,
    fullName: toText(row.fullName) || name,
    initials: toText(row.initials) || getInitials(name),
    bib: String(
      (row as { bib?: unknown }).bib ??
        (row as { bibNumber?: unknown }).bibNumber ??
        "",
    ),
    bibNumber: String(
      (row as { bibNumber?: unknown }).bibNumber ??
        (row as { bib?: unknown }).bib ??
        "",
    ),
    chip:
      toText(row.chip) ||
      toText(row.chipNumber) ||
      toText(rawMeta.chip_code) ||
      null,
    chipNumber:
      toText(row.chipNumber) ||
      toText(row.chip) ||
      toText(rawMeta.chip_code) ||
      null,
    category:
      toText(row.category) ||
      toText(row.contestName) ||
      toText(row.providerContestName) ||
      "",
    contestName:
      toText(row.contestName) ||
      toText(row.category) ||
      toText(row.providerContestName) ||
      "",
    contestUuid,
    contest_uuid: contestUuid,
    ageGroup:
      toText(row.ageGroup) ||
      toText(row.ageGroupName) ||
      toText(mapping.ageGroupName) ||
      "",
    ageGroupUuid:
      toText(row.ageGroupUuid) ||
      toText(row.providerAgeGroupUuid) ||
      toText(mapping.ageGroupUuid) ||
      "",
    gender: toText(row.gender) || "",
    country: toText(row.country) || "",
    countryCode: toText(row.countryCode) || "",
    clubName,
    club: toText(row.club),
    photoURL: resolvedPhoto || null,
    photoUrl: resolvedPhoto || null,
    avatarUrl: resolvedPhoto || null,
    displayPhoto: resolvedPhoto || null,
    profilePhotoUrl: resolvedPhoto || undefined,
    status: toText(row.status) || "Not Started",
    leg: toText(row.leg) || "NOT_STARTED",
    splits: Array.isArray(row.splits) ? row.splits : [],
    currentSplit: row.currentSplit ?? null,
    provider: {
      mapped: true,
      provider: normalizedProviderName,
      providerUuid: providerUuid || null,
      contestUuid: contestUuid || null,
    },
    liveTrackingPrivacy: toText(row.liveTrackingPrivacy) || "PUBLIC",
    trackingVisibility: toText(row.trackingVisibility) || "PUBLIC",
    privacy: toText(row.privacy) || "PUBLIC",
    searchVisible: row.searchVisible !== false,
    mapVisible: row.mapVisible !== false,
    modalVisible: row.modalVisible !== false,
    participantUuid: toText(row.participantUuid) || undefined,
    providerEventUuid:
      toText(row.providerEventUuid) ||
      toText(row.eventUuid) ||
      toText(rawMeta.event_uuid) ||
      toText(row.participantUuid)?.match(/^race:([^:]+):/i)?.[1] ||
      undefined,
    providerAthleteUuid: toText(row.providerAthleteUuid) || undefined,
    providerParticipantUuid:
      toText(row.providerParticipantUuid) || providerUuid || undefined,
    providerContestUuid:
      toText(row.providerContestUuid) || contestUuid || undefined,
    canonicalContestUuid:
      toText(row.canonicalContestUuid) || contestUuid || undefined,
    providerTimingUuid: toText(row.providerTimingUuid) || undefined,
    providerRecordId: toText(row.providerRecordId) || undefined,
    providerUuid: providerUuid || undefined,
    bookingId: toText(row.bookingId) || undefined,
    email: toText(row.email) || undefined,
    contest: toText(row.contestName) || toText(row.category) || "",
    ageGroupName: toText(row.ageGroupName) || toText(row.ageGroup) || undefined,
    displayName: toText(row.displayName) || name,
    visibility: undefined,
    liveTrackingVisibility: undefined,
  };
}

function resolveLookupValue(params: AthleteDetailParams): string {
  return (
    params.bib?.trim() ||
    params.athleteUid?.trim() ||
    params.bookingId?.trim() ||
    params.providerUuid?.trim() ||
    params.email?.trim() ||
    params.participantUuid?.trim() ||
    params.providerAthleteUuid?.trim() ||
    params.providerTimingUuid?.trim() ||
    params.providerRecordId?.trim() ||
    ""
  );
}

function normalizeLookupParams(
  params: AthleteDetailParams,
): AthleteDetailParams {
  return {
    bib: params.bib?.trim() || undefined,
    athleteUid: params.athleteUid?.trim() || undefined,
    bookingId: params.bookingId?.trim() || undefined,
    providerUuid: params.providerUuid?.trim() || undefined,
    email: params.email?.trim() || undefined,
    participantUuid: params.participantUuid?.trim() || undefined,
    providerEventUuid: params.providerEventUuid?.trim() || undefined,
    providerAthleteUuid: params.providerAthleteUuid?.trim() || undefined,
    providerTimingUuid: params.providerTimingUuid?.trim() || undefined,
    providerRecordId: params.providerRecordId?.trim() || undefined,
    providerContestUuid: params.providerContestUuid?.trim() || undefined,
    courseVersion: params.courseVersion?.trim() || undefined,
    activeVersion: params.activeVersion?.trim() || undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function scopedContestValue(
  mapValue: unknown,
  contestUuid: string | undefined,
): unknown {
  if (!contestUuid) return undefined;
  const entries = Object.entries(asRecord(mapValue));
  return entries.find(
    ([key]) => key.trim().toLowerCase() === contestUuid.toLowerCase(),
  )?.[1];
}

function richerRows(...values: unknown[]): Record<string, unknown>[] {
  return values
    .map(recordArray)
    .reduce<Record<string, unknown>[]>(
      (best, rows) => (rows.length > best.length ? rows : best),
      [],
    );
}

function savedRaceFlow(
  timingConfiguration: Record<string, unknown>,
  contestUuid: string | undefined,
): Record<string, unknown> {
  return [
    scopedContestValue(
      timingConfiguration.raceFlowTimelineByContest,
      contestUuid,
    ),
    scopedContestValue(timingConfiguration.raceFlowByContest, contestUuid),
    scopedContestValue(
      timingConfiguration.legSplitMappingsByContest,
      contestUuid,
    ),
    scopedContestValue(
      timingConfiguration.legSplitMappingByContest,
      contestUuid,
    ),
  ]
    .map(asRecord)
    .reduce<Record<string, unknown>>((best, candidate) => {
      const bestSplitCount = recordArray(best.splits).length;
      const candidateSplitCount = recordArray(candidate.splits).length;
      return candidateSplitCount > bestSplitCount ? candidate : best;
    }, {});
}

function normalizeLiveAthleteResponse(
  eventId: string,
  raw: unknown,
): AthleteModalResponse {
  const envelope = asRecord(raw);
  const data =
    Object.keys(asRecord(envelope.data)).length > 0
      ? asRecord(envelope.data)
      : envelope;
  const athlete = asRecord(data.athlete ?? envelope.athlete);
  const participantLive = asRecord(
    data.participantLive ?? envelope.participantLive ?? athlete.participantLive,
  );
  const participantIdentity = asRecord(participantLive.identity);
  const registration = asRecord(
    data.registration ?? envelope.registration ?? athlete.registration,
  );
  const profile = asRecord(data.profile ?? envelope.profile ?? athlete.profile);
  const athletePhoto =
    toText(athlete.profilePhotoUrl) ||
    toText(athlete.photoUrl) ||
    toText(athlete.photoURL) ||
    toText(athlete.avatarUrl) ||
    toText(athlete.displayPhoto) ||
    toText(participantIdentity.profilePhotoUrl) ||
    toText(participantIdentity.photoUrl) ||
    toText(participantIdentity.photoURL) ||
    toText(participantIdentity.avatarUrl) ||
    toText(profile.profilePhotoUrl) ||
    toText(profile.photoUrl) ||
    toText(profile.photoURL) ||
    toText(registration.profilePhotoUrl) ||
    toText(registration.photoUrl) ||
    toText(registration.photoURL);
  const athleteClub =
    toText(athlete.clubName) ||
    toText(athlete.club) ||
    toText(athlete.displayClub) ||
    toText(profile.clubName) ||
    toText(profile.club) ||
    toText(registration.clubName) ||
    toText(registration.club) ||
    toText(participantIdentity.clubName) ||
    toText(participantIdentity.club);
  const context = asRecord(data.contestContext ?? envelope.contestContext);
  const contestDefinition =
    data.contestDefinition ?? envelope.contestDefinition ?? context.contest;
  const contest = context.contest ?? contestDefinition;
  const contestRecord = asRecord(contestDefinition ?? contest);
  const timingConfiguration = asRecord(
    data.timingConfiguration ?? envelope.timingConfiguration,
  );
  const contestUuid = toText(
    participantLive.contestUuid ??
      athlete.contestUuid ??
      athlete.contest_uuid ??
      athlete.providerContestUuid ??
      contestRecord.providerContestUuid ??
      contestRecord.contestUuid ??
      contestRecord.uuid ??
      contestRecord.id,
  );
  const splitsByContest = asRecord(timingConfiguration.splitsByContest);
  const legsByContest = asRecord(timingConfiguration.legsByContest);
  const savedFlow = savedRaceFlow(timingConfiguration, contestUuid);
  const configuredSplits = richerRows(
    context.splits,
    contestRecord.splits,
    contestUuid ? splitsByContest[contestUuid] : undefined,
    scopedContestValue(timingConfiguration.splitsByContest, contestUuid),
    savedFlow.splits,
  );
  const configuredLegs = richerRows(
    context.legs,
    contestRecord.legs,
    contestUuid ? legsByContest[contestUuid] : undefined,
    scopedContestValue(timingConfiguration.legsByContest, contestUuid),
    savedFlow.legs,
  );
  const configuredTransitions = richerRows(
    context.transitions,
    contestRecord.transitions,
    scopedContestValue(timingConfiguration.transitionsByContest, contestUuid),
    savedFlow.transitions,
  );
  const configuredSections = richerRows(
    context.sections,
    contestRecord.sections,
    savedFlow.sections,
  );
  const athleteSplits = Array.isArray(athlete.splits)
    ? athlete.splits
    : Array.isArray(data.athleteSplits)
      ? data.athleteSplits
      : [];
  return {
    ...envelope,
    ...data,
    success: envelope.success !== false,
    eventId: toText(envelope.eventId ?? data.eventId) || eventId,
    athlete: {
      ...athlete,
      club: athleteClub || athlete.club,
      clubName: athleteClub || athlete.clubName,
      displayClub: athleteClub || athlete.displayClub,
      photoUrl: athletePhoto || athlete.photoUrl,
      photoURL: athletePhoto || athlete.photoURL || null,
      avatarUrl: athletePhoto || athlete.avatarUrl,
      displayPhoto: athletePhoto || athlete.displayPhoto || null,
      profilePhotoUrl: athletePhoto || athlete.profilePhotoUrl,
      splits: athleteSplits,
    } as AthleteModalResponse["athlete"],
    participantLive: participantLive as AthleteModalResponse["participantLive"],
    contestContext: {
      ...context,
      contest,
      splits: configuredSplits as Record<string, unknown>[],
      legs: configuredLegs,
      transitions: configuredTransitions,
      sections: configuredSections,
    },
    contestDefinition,
    timingConfiguration:
      timingConfiguration as AthleteModalResponse["timingConfiguration"],
    activeVersion: toText(envelope.activeVersion ?? data.activeVersion),
    courseVersion: toText(
      data.courseVersion ?? asRecord(contest).courseVersion,
    ),
  } as AthleteModalResponse;
}

export function normalizeCanonicalAthleteRefresh(
  eventId: string,
  raw: unknown,
): AthleteModalResponse | null {
  const envelope = asRecord(raw);
  const snapshot = asRecord(envelope.data);
  const identity = asRecord(snapshot.identity);
  const bergmanIdentity = asRecord(snapshot.bergmanIdentity);
  const raceState = asRecord(snapshot.raceState);
  const resolved = asRecord(raceState.resolved);
  const hotLive = asRecord(snapshot.participantLive);
  const hotResolved = asRecord(hotLive.resolvedRaceState);
  const activeManualTerminalStatus = manualTerminalStatus(
    hotResolved,
    hotLive,
    resolved,
    raceState,
  );
  const hotStartEvidence = asRecord(hotLive.startEvidence);
  // Mutable participantLive may contain a newer processed Feibot START than
  // the version-pinned snapshot. Prefer those individual timing fields while
  // retaining the immutable snapshot as the complete fallback.
  const startTiming = {
    ...asRecord(snapshot.startTiming),
    ...asRecord(hotLive.startTiming),
  };
  if (
    !toText(identity.providerParticipantUuid ?? identity.participantUuid) ||
    !toText(identity.bib)
  ) {
    return null;
  }
  const participantUuid = toText(
    identity.participantUuid ?? identity.providerParticipantUuid,
  );
  const providerUuid = toText(
    identity.providerParticipantUuid ?? identity.participantUuid,
  );
  const contestUuid = toText(snapshot.contestUuid) || undefined;
  const hotRankingScope = toText(hotLive.rankingScope)?.toUpperCase();
  const hotRankingContestUuid = toText(
    hotLive.rankingContestUuid ?? hotLive.contestUuid,
  )?.toLowerCase();
  const hotRanksAreContestScoped = Boolean(
    hotRankingScope === "CONTEST" &&
    hotRankingContestUuid &&
    contestUuid &&
    hotRankingContestUuid === contestUuid.toLowerCase(),
  );
  const canonicalEventName =
    toText(snapshot.eventName ?? identity.eventName) || undefined;
  const canonicalContestName =
    toText(snapshot.contestName ?? identity.contestName) || undefined;
  const resolvedSplits = Array.isArray(resolved.splits) ? resolved.splits : [];
  const calculatedSplitRows = Array.isArray(snapshot.splits)
    ? snapshot.splits
    : [];
  const calculatedSplitByKey = new Map(
    calculatedSplitRows
      .map((value) => {
        const split = asRecord(value);
        return [toText(split.splitKey ?? split.key), split] as const;
      })
      .filter(([key]) => Boolean(key)),
  );
  // Resolved state owns completion/current/finish semantics; calculated rows
  // own segment pace/speed. Merge them by the canonical split key so the
  // compact tracker and the detailed split flow consume the same result.
  const unrankedCanonicalSplits =
    resolvedSplits.length > 0
      ? resolvedSplits.map((value) => {
          const split = asRecord(value);
          const calculated = calculatedSplitByKey.get(
            toText(split.splitKey ?? split.key),
          );
          return calculated ? { ...calculated, ...split } : split;
        })
      : calculatedSplitRows;
  const splitRankingRows = Array.isArray(snapshot.splitRankings)
    ? snapshot.splitRankings
    : Object.entries(asRecord(snapshot.splitRankings)).map(
        ([splitKey, value]) => ({ splitKey, ...asRecord(value) }),
      );
  const splitRankingByKey = new Map(
    splitRankingRows
      .map((value) => {
        const ranking = asRecord(value);
        return [
          toText(
            ranking.splitKey ??
              ranking.key ??
              ranking.canonicalSplitKey ??
              ranking.providerSplitId,
          ),
          ranking,
        ] as const;
      })
      .filter(([key]) => Boolean(key)),
  );
  const snapshotCanonicalSplits = unrankedCanonicalSplits.map((value) => {
    const split = asRecord(value);
    const splitKey = toText(
      split.splitKey ??
        split.key ??
        split.canonicalSplitKey ??
        split.providerSplitId,
    );
    const ranking = splitRankingByKey.get(splitKey);
    if (!ranking) return split;
    const existingRanking = asRecord(split.ranking);
    return {
      ...split,
      overallRank:
        split.overallRank ??
        ranking.overallRank ??
        ranking.rank ??
        ranking.overall,
      ranking: { ...ranking, ...existingRanking },
    };
  });
  const timingModeForSplits = (
    toText(
      hotResolved.officialTimingMode ??
        hotResolved.timingMode ??
        hotStartEvidence.timingMode ??
        asRecord(snapshot.startTiming).startTimeSource,
    ) ?? "CHIP"
  ).toUpperCase();
  const hotSplits = (Array.isArray(hotLive.splits) ? hotLive.splits : []).map(
    (value) => {
      if (hotRanksAreContestScoped) return value;
      const {
        ranking: _ranking,
        overallRank: _overallRank,
        rank: _rank,
        genderRank: _genderRank,
        ageGroupRank: _ageGroupRank,
        categoryRank: _categoryRank,
        clubRank: _clubRank,
        ...timingOnly
      } = asRecord(value);
      return timingOnly;
    },
  );
  // The immutable snapshot supplies the complete configured race flow. The
  // provider-scoped participantLive row supplies mutable accepted timing.
  // Merge them by canonical split identity so a hot update changes timing
  // state without dropping pending rows from the detailed split table.
  const canonicalSplits = mergeCanonicalSplitsWithHotTiming({
    configuredSplits: snapshotCanonicalSplits,
    hotSplits,
    timingMode: timingModeForSplits,
  });
  const canonicalSections = Array.isArray(snapshot.sections)
    ? snapshot.sections
    : [];
  // Canonical sections contain both sport legs and transitions. Keeping the
  // whole array under `legs` causes T1/T2 to be rebuilt as sport legs, so the
  // mobile split flow can incorrectly show "Not Started" after the preceding
  // finish boundary has already been accepted. Preserve the canonical section
  // types and expose transitions through their dedicated collection.
  const canonicalLegs = canonicalSections.filter((value) => {
    const section = asRecord(value);
    return (
      (toText(section.sectionType ?? section.type) ?? "").toLowerCase() !==
      "transition"
    );
  });
  const canonicalTransitions = canonicalSections.filter((value) => {
    const section = asRecord(value);
    return (
      (toText(section.sectionType ?? section.type) ?? "").toLowerCase() ===
      "transition"
    );
  });
  const eventTimezone =
    toText(resolved.eventTimezone) ||
    toText(snapshot.eventTimezone) ||
    (toText(identity.countryCode)?.toUpperCase() === "IN"
      ? "Asia/Kolkata"
      : "UTC");
  const startTimeSource = toText(
    startTiming.startTimeSource ??
      hotResolved.officialTimingMode ??
      hotResolved.timingMode ??
      hotStartEvidence.timingMode,
  )?.toUpperCase();
  const acceptedStartAt = resolveAcceptedChipStart({
    hotResolved,
    hotLive,
    hotStartEvidence,
    snapshotStartTiming: startTiming,
  });
  const canonicalAcceptedStart = Boolean(
    resolved.hasStarted === true ||
    resolved.hasAcceptedStart === true ||
    hotResolved.hasStarted === true ||
    hotResolved.hasAcceptedStart === true ||
    toText(startTiming.acceptedReadId) ||
    toText(startTiming.startPassageId),
  );
  // The canonical snapshot stores Feibot START evidence in `startTiming`,
  // while the mobile view model historically looked only inside
  // `resolvedRaceState`. Bridge both contracts here so an accepted START mat
  // passage cannot be lost when a stale hot participant row still says DNS.
  const normalizedStartTiming = {
    ...startTiming,
    officialTimingMode:
      toText(startTiming.officialTimingMode) || startTimeSource || undefined,
    mode: toText(startTiming.mode) || startTimeSource || undefined,
    acceptedChipStartAt:
      acceptedStartAt || toText(startTiming.acceptedChipStartAt) || undefined,
    acceptedStartAt:
      acceptedStartAt || toText(startTiming.acceptedStartAt) || undefined,
    chipStartAt:
      // A CHIP clock is anchored only by an accepted START read. The contest
      // gun time is useful configuration, but it is never an athlete chip
      // start and must not be promoted into the mobile compatibility model.
      acceptedStartAt || undefined,
    startReaderAt: acceptedStartAt || undefined,
    officialStartAt:
      toText(
        hotResolved.officialStartAt ??
          hotResolved.officialGunStartAt ??
          hotStartEvidence.officialTimestamp ??
          hotLive.officialGunStartAt ??
          startTiming.officialStartTime,
      ) || undefined,
    hasAcceptedStart: canonicalAcceptedStart,
    status: toText(startTiming.startStatus) || undefined,
  };
  const athleteStartTime = toText(
    resolved.athleteStartTime ??
      raceState.startedAt ??
      raceState.startTime ??
      startTiming.chipStartDetectionTime ??
      startTiming.acceptedChipStartTime ??
      startTiming.chipStartTime ??
      (startTimeSource === "CHIP" ? undefined : startTiming.officialStartTime),
  );
  // `participantLive.resolvedRaceState` is the mutable, processed timing
  // overlay. Do not let a version-pinned pre-start snapshot keep the compact
  // tracked card at 00:00:00 after an accepted START or split arrives.
  const resolvedElapsedSeconds =
    Number(
      hotResolved.officialElapsedMs ??
        hotResolved.liveOverallElapsedMs ??
        hotResolved.officialRaceElapsedMs ??
        hotResolved.athleteElapsedMs ??
        resolved.officialElapsedMs ??
        resolved.liveOverallElapsedMs ??
        resolved.officialRaceElapsedMs ??
        resolved.athleteElapsedMs,
    ) / 1000;
  const liveElapsedSeconds =
    Number.isFinite(resolvedElapsedSeconds) && resolvedElapsedSeconds >= 0
      ? resolvedElapsedSeconds
      : Number(raceState.elapsedSeconds);
  const officialDistanceKm =
    Number(resolved.officialDistanceKm ?? raceState.distanceCompletedKm) || 0;
  const totalDistanceKm =
    Number(
      resolved.totalDistanceKm ??
        raceState.totalDistanceKm ??
        asRecord(snapshot.calculated).totalDistanceKm,
    ) || 0;
  const distanceRemainingKm = Number.isFinite(
    Number(resolved.distanceRemainingKm),
  )
    ? Math.max(0, Number(resolved.distanceRemainingKm))
    : totalDistanceKm > 0
      ? Math.max(0, totalDistanceKm - officialDistanceKm)
      : 0;
  const estimatedProgressRatio =
    Number(
      resolved.estimatedProgressRatio ??
        raceState.estimatedProgressRatio ??
        raceState.progressRatio,
    ) || 0;
  const compatibilityResolvedStateBase =
    Object.keys(resolved).length > 0
      ? resolved
      : {
          status: raceState.status,
          currentLeg: raceState.currentLegType,
          athleteStartTime,
          athleteElapsedMs: Number.isFinite(liveElapsedSeconds)
            ? liveElapsedSeconds * 1000
            : undefined,
          officialDistanceKm,
          estimatedDistanceKm: officialDistanceKm,
          totalDistanceKm,
          distanceRemainingKm,
          estimatedProgressRatio,
          splits: canonicalSplits,
          eventTimezone,
        };
  const existingChipStartAt = toText(
    compatibilityResolvedStateBase.chipStartAt,
  );
  const configuredOfficialStartAt = toText(startTiming.officialStartTime);
  const hasExplicitStartRead = Boolean(
    acceptedStartAt ||
    toText(startTiming.acceptedReadId) ||
    toText(startTiming.startPassageId),
  );
  // Older app responses can already contain the historical bad mapping where
  // `chipStartAt` was copied from the contest gun time. Preserve a real
  // accepted chip timestamp, but discard an unconfirmed exact gun-time copy.
  const existingChipStartIsUnconfirmedGunTime =
    startTimeSource === "CHIP" &&
    !hasExplicitStartRead &&
    existingChipStartAt &&
    configuredOfficialStartAt
      ? Date.parse(existingChipStartAt) ===
        Date.parse(configuredOfficialStartAt)
      : false;
  const compatibilityResolvedStatus = toText(
    compatibilityResolvedStateBase.status ??
      compatibilityResolvedStateBase.timingState,
  )?.toUpperCase();
  const compatibilityResolvedState = {
    ...compatibilityResolvedStateBase,
    officialTimingMode:
      compatibilityResolvedStateBase.officialTimingMode ??
      compatibilityResolvedStateBase.timingMode ??
      normalizedStartTiming.officialTimingMode,
    timingMode:
      compatibilityResolvedStateBase.timingMode ??
      normalizedStartTiming.officialTimingMode,
    hasStarted:
      canonicalAcceptedStart || compatibilityResolvedStateBase.hasStarted,
    hasAcceptedStart:
      canonicalAcceptedStart || compatibilityResolvedStateBase.hasAcceptedStart,
    acceptedChipStartAt:
      compatibilityResolvedStateBase.acceptedChipStartAt ??
      normalizedStartTiming.acceptedChipStartAt,
    acceptedStartAt:
      compatibilityResolvedStateBase.acceptedStartAt ??
      normalizedStartTiming.acceptedStartAt,
    chipStartAt:
      (existingChipStartIsUnconfirmedGunTime
        ? undefined
        : compatibilityResolvedStateBase.chipStartAt) ??
      normalizedStartTiming.chipStartAt,
    startReaderAt:
      compatibilityResolvedStateBase.startReaderAt ??
      normalizedStartTiming.startReaderAt,
    officialStartAt:
      compatibilityResolvedStateBase.officialStartAt ??
      normalizedStartTiming.officialStartAt,
    athleteStartTime:
      compatibilityResolvedStateBase.athleteStartTime ??
      (canonicalAcceptedStart ? athleteStartTime : undefined),
    athleteStartTimeUtc:
      compatibilityResolvedStateBase.athleteStartTimeUtc ??
      (canonicalAcceptedStart ? athleteStartTime : undefined),
    status:
      canonicalAcceptedStart &&
      compatibilityResolvedStatus === "DNS" &&
      activeManualTerminalStatus !== "DNS"
        ? "ON_COURSE"
        : compatibilityResolvedStateBase.status,
    startTiming: {
      ...normalizedStartTiming,
      ...asRecord(compatibilityResolvedStateBase.startTiming),
    },
  };
  const mergedHotResolvedState: Record<string, unknown> = {
    ...compatibilityResolvedState,
    ...hotResolved,
    startTiming: {
      ...normalizedStartTiming,
      ...asRecord(compatibilityResolvedState.startTiming),
      ...asRecord(hotResolved.startTiming),
    },
    splits: canonicalSplits,
  };
  if (
    canonicalAcceptedStart &&
    activeManualTerminalStatus !== "DNS" &&
    toText(
      mergedHotResolvedState.status ?? mergedHotResolvedState.timingState,
    )?.toUpperCase() === "DNS"
  ) {
    mergedHotResolvedState.status = "ON_COURSE";
    mergedHotResolvedState.timingState = "ON_COURSE";
    mergedHotResolvedState.hasStarted = true;
    mergedHotResolvedState.hasAcceptedStart = true;
  }
  const contestDefinition = {
    providerContestUuid: contestUuid,
    contestUuid,
    splits: canonicalSplits,
    sections: canonicalSections,
    legs: canonicalLegs,
    transitions: canonicalTransitions,
  };
  const orderedCanonicalSplits = [...canonicalSplits].sort(
    (left, right) =>
      Number(asRecord(left).order || 0) - Number(asRecord(right).order || 0),
  );
  const configuredFinishSplit =
    orderedCanonicalSplits.find((value) => asRecord(value).isFinish === true) ??
    orderedCanonicalSplits.at(-1);
  const configuredFinishKey = toText(
    asRecord(configuredFinishSplit).splitKey ??
      asRecord(configuredFinishSplit).key ??
      asRecord(configuredFinishSplit).providerSplitId,
  );
  const finishSplit = configuredFinishKey
    ? canonicalSplits.find((value) => {
        const split = asRecord(value);
        const key = toText(
          split.splitKey ?? split.key ?? split.providerSplitId,
        );
        return (
          key === configuredFinishKey &&
          ["COMPLETED", "VALID", "OFFICIAL", "CONFIRMED"].includes(
            (toText(split.status) ?? "").toUpperCase(),
          ) &&
          Boolean(toText(split.readAt ?? split.timestamp ?? split.timeOfDay))
        );
      })
    : undefined;
  // Fail closed on stale/corrupt provider status. Mobile only enters the
  // finished result view when the terminal configured split has accepted
  // timestamp evidence; Swim Finish and Bike Finish are intermediate points.
  const finished =
    !activeManualTerminalStatus &&
    Boolean(finishSplit) &&
    ((toText(resolved.status) ?? "").toUpperCase() === "FINISHED" ||
      (toText(raceState.status) ?? "").toLowerCase() === "finished");
  // Accepted canonical finish evidence owns lifecycle state everywhere in the
  // mobile payload. Do not leave a stale hot WAITING_CHIP_START value nested
  // beside a FINISHED result: consumers and diagnostics must see one state.
  if (finished) {
    mergedHotResolvedState.status = "FINISHED";
    mergedHotResolvedState.timingState = "FINISHED";
    mergedHotResolvedState.currentLeg = "FINISHED";
    mergedHotResolvedState.hasStarted = true;
    mergedHotResolvedState.hasAcceptedStart = true;
    mergedHotResolvedState.finalSplitAccepted = true;
  } else if (activeManualTerminalStatus) {
    mergedHotResolvedState.status = activeManualTerminalStatus;
    mergedHotResolvedState.timingState = activeManualTerminalStatus;
    mergedHotResolvedState.statusSource = "MANUAL_OVERRIDE";
  }
  const finish = asRecord(finishSplit);
  const sectionDurations = canonicalSections.map((value) =>
    Number(asRecord(value).durationSeconds),
  );
  const completedSectionTotal =
    sectionDurations.length > 0 &&
    sectionDurations.every((value) => Number.isFinite(value) && value >= 0)
      ? sectionDurations.reduce((total, value) => total + value, 0)
      : 0;
  const elapsedSeconds =
    [
      resolved.officialResultElapsedMs != null
        ? Number(resolved.officialResultElapsedMs) / 1000
        : null,
      resolved.officialElapsedMs != null
        ? Number(resolved.officialElapsedMs) / 1000
        : null,
      resolved.finalElapsedMs != null
        ? Number(resolved.finalElapsedMs) / 1000
        : null,
      Number(finish.elapsedSeconds),
      Number(asRecord(snapshot.calculated).overallSeconds),
      Number(raceState.elapsedSeconds),
      completedSectionTotal,
    ].find(
      (value): value is number =>
        value != null && Number.isFinite(value) && value > 0,
    ) ?? 0;
  const gunStart = Date.parse(
    toText(resolved.gunStartTimeUtc ?? resolved.gunStartTime) ?? "",
  );
  const finishAt = Date.parse(toText(finish.readAt ?? finish.timestamp) ?? "");
  const canonicalGunSeconds = Number(resolved.gunElapsedMs) / 1000;
  const gunElapsedSeconds =
    Number.isFinite(canonicalGunSeconds) && canonicalGunSeconds >= 0
      ? canonicalGunSeconds
      : Number.isFinite(gunStart) && Number.isFinite(finishAt)
        ? Math.max(0, Math.round((finishAt - gunStart) / 1000))
        : undefined;
  const formatHms = (seconds: number | undefined) => {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0)
      return undefined;
    const whole = Math.floor(seconds);
    return [
      Math.floor(whole / 3600),
      Math.floor((whole % 3600) / 60),
      whole % 60,
    ]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  };
  const timingMode = (
    toText(resolved.officialResultBasis ?? resolved.timingMode) ?? "CHIP"
  ).toUpperCase();
  const chipTime = formatHms(elapsedSeconds);
  const gunTime = formatHms(gunElapsedSeconds);
  const formatTimeOfDay = (value: unknown) => {
    const candidate = toText(value);
    if (!candidate) return undefined;
    // Preserve a provider-formatted clock label. Convert absolute timestamps
    // into the event timezone so the card never substitutes elapsed time for
    // the actual finish time of day.
    if (!candidate.includes("T")) return candidate;
    const timestamp = Date.parse(candidate);
    if (!Number.isFinite(timestamp)) return candidate;
    try {
      return new Intl.DateTimeFormat("en-IN", {
        timeZone: eventTimezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(timestamp);
    } catch {
      return candidate;
    }
  };
  const formatPace = (seconds: number, suffix: string) => {
    const rounded = Math.round(seconds);
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")} ${suffix}`;
  };
  const resultSections = canonicalSections.map((value) => {
    const section = asRecord(value);
    const type =
      toText(section.sectionType) === "transition"
        ? ("transition" as const)
        : ("leg" as const);
    const key = toText(section.key) || `section-${Number(section.order) || 0}`;
    const label =
      toText(section.displayName) || key.replace(/_/g, " ").toUpperCase();
    const durationSeconds = Number(section.durationSeconds);
    const metricValue = Number(section.averageMetric);
    const leg = (toText(section.legType) ?? key).toLowerCase();
    const metric =
      type === "transition" || !Number.isFinite(metricValue) || metricValue <= 0
        ? undefined
        : leg.includes("swim")
          ? formatPace(metricValue, "/100m")
          : leg.includes("bike")
            ? `${metricValue.toFixed(1)} km/h`
            : leg.includes("run")
              ? formatPace(metricValue, "/km")
              : undefined;
    return {
      key,
      label,
      type,
      duration: formatHms(durationSeconds) ?? "—",
      metric,
    };
  });
  const sectionMetricByLeg = new Map(
    resultSections.flatMap((section, index) => {
      if (section.type !== "leg" || !section.metric) return [];
      const sourceSection = asRecord(canonicalSections[index]);
      const leg = (toText(sourceSection.legType) ?? section.key)
        .toLowerCase()
        .replace(/\d+$/, "");
      return [[leg, section.metric] as const];
    }),
  );
  const completedSplitRecords = canonicalSplits
    .map((value) => asRecord(value))
    .filter((split) =>
      ["COMPLETED", "VALID", "OFFICIAL", "CONFIRMED"].includes(
        (toText(split.status) ?? "").toUpperCase(),
      ),
    );
  const finalCompletedOrderByLeg = new Map<string, number>();
  completedSplitRecords.forEach((split) => {
    const leg = (toText(split.legType) ?? "").toLowerCase();
    const order = Number(split.order);
    if (!leg || !Number.isFinite(order)) return;
    finalCompletedOrderByLeg.set(
      leg,
      Math.max(finalCompletedOrderByLeg.get(leg) ?? -Infinity, order),
    );
  });
  const resultSplits = completedSplitRecords.map((split) => {
    const leg = (toText(split.legType) ?? "").toLowerCase();
    const order = Number(split.order);
    const isLegFinish = Boolean(
      leg &&
      Number.isFinite(order) &&
      finalCompletedOrderByLeg.get(leg) === order,
    );
    return {
      label:
        toText(split.name ?? split.displayName ?? split.splitKey) ?? "Split",
      time: formatHms(Number(split.elapsedSeconds)) ?? "—",
      timeOfDay:
        formatTimeOfDay(split.timeOfDay ?? split.readAt ?? split.timestamp) ??
        undefined,
      segmentTime:
        formatHms(
          Number(split.segmentElapsedSeconds ?? split.sectionSeconds),
        ) ?? undefined,
      // Canonical section calculations already contain the official
      // sport-specific average. Older split projections omit
      // paceSpeedLabel, so use the completed leg metric at its finish row.
      // Start/transition boundaries intentionally remain blank.
      paceSpeed:
        toText(split.paceSpeedLabel ?? split.metric) ??
        (isLegFinish ? sectionMetricByLeg.get(leg) : undefined),
      rank: toNumberOrString(
        asRecord(split.ranking).overallRank ??
          asRecord(split.ranking).rank ??
          asRecord(split.ranking).overall ??
          split.overallRank ??
          split.rank,
      ),
      leg: toText(split.legType) ?? undefined,
      distanceKm: Number.isFinite(Number(split.distanceKm))
        ? Number(split.distanceKm)
        : undefined,
    };
  });
  const sportSections = resultSections.filter(
    (section) => section.type === "leg",
  );
  // A whole-triathlon min/km number mixes swim, transitions, bike and run and
  // is not a valid sport metric. Preserve an overall metric only for a true
  // single-sport contest, using that sport's configured canonical section.
  const averagePace =
    new Set(sportSections.map((section) => section.key.replace(/\d+$/, "")))
      .size === 1
      ? sportSections[0]?.metric
      : toText(
          resolved.averagePaceLabel ??
            resolved.averagePace ??
            resolved.overallPaceLabel,
        );
  const snapshotRankings = asRecord(snapshot.rankings);
  const resolvedRankings = asRecord(resolved.rankings);
  const snapshotOverallRanking = asRecord(snapshot.overallRanking);
  const snapshotFinalSummary = asRecord(snapshot.finalSummary);
  const hotRankings = hotRanksAreContestScoped
    ? asRecord(hotLive.rankings)
    : {};
  const hotResolvedRankings = hotRanksAreContestScoped
    ? asRecord(hotResolved.rankings)
    : {};
  const hotOverallRanking = hotRanksAreContestScoped
    ? asRecord(hotLive.overallRanking)
    : {};
  const hotFinalSummary = hotRanksAreContestScoped
    ? asRecord(hotLive.finalSummary)
    : {};
  const positiveRank = (...values: unknown[]) => {
    for (const value of values) {
      const parsed = Number(String(value ?? "").replace(/^#/, ""));
      if (Number.isFinite(parsed) && parsed > 0) return toNumberOrString(value);
    }
    return undefined;
  };
  const resultStatus =
    activeManualTerminalStatus ?? (finished ? "FINISHED" : null);
  const result =
    resultStatus && (activeManualTerminalStatus || (finishSplit && chipTime))
      ? {
          status: resultStatus,
          chipTime,
          gunTime,
          finishTimeOfDay:
            formatTimeOfDay(
              resolved.finishTimeOfDay ??
                finish.timeOfDay ??
                finish.readAt ??
                finish.timestamp,
            ) ?? undefined,
          officialTime: timingMode === "GUN" ? (gunTime ?? chipTime) : chipTime,
          officialTimeBasis:
            timingMode === "GUN" ? ("GUN" as const) : ("CHIP" as const),
          averagePace,
          sections: resultSections,
          overallRank: finished
            ? positiveRank(
                hotOverallRanking.overallRank,
                hotFinalSummary.overallRank,
                hotRanksAreContestScoped ? hotLive.overallRank : null,
                hotRanksAreContestScoped ? hotResolved.finalRank : null,
                hotRanksAreContestScoped ? hotResolved.overallRank : null,
                hotRankings.overallRank,
                hotResolvedRankings.overallRank,
                snapshotOverallRanking.overallRank,
                resolvedRankings.overallRank,
                snapshotRankings.overallRank,
                snapshot.overallRank,
                snapshot.finalRank,
                snapshot.rank,
                snapshotFinalSummary.overallRank,
              )
            : undefined,
          genderRank: finished
            ? positiveRank(
                hotOverallRanking.genderRank,
                hotFinalSummary.genderRank,
                hotRanksAreContestScoped ? hotLive.genderRank : null,
                hotRanksAreContestScoped ? hotResolved.genderRank : null,
                hotRankings.genderRank,
                hotResolvedRankings.genderRank,
                snapshotOverallRanking.genderRank,
                resolvedRankings.genderRank,
                snapshotRankings.genderRank,
                snapshot.genderRank,
                snapshotFinalSummary.genderRank,
              )
            : undefined,
          categoryRank: finished
            ? positiveRank(
                hotOverallRanking.ageGroupRank,
                hotOverallRanking.categoryRank,
                hotFinalSummary.ageGroupRank,
                hotFinalSummary.categoryRank,
                hotRanksAreContestScoped ? hotLive.ageGroupRank : null,
                hotRanksAreContestScoped ? hotLive.categoryRank : null,
                hotRanksAreContestScoped ? hotResolved.ageGroupRank : null,
                hotRanksAreContestScoped ? hotResolved.categoryRank : null,
                hotRankings.ageGroupRank,
                hotRankings.categoryRank,
                hotResolvedRankings.ageGroupRank,
                hotResolvedRankings.categoryRank,
                snapshotOverallRanking.ageGroupRank,
                snapshotOverallRanking.categoryRank,
                resolvedRankings.ageGroupRank,
                resolvedRankings.categoryRank,
                snapshotRankings.ageGroupRank,
                snapshotRankings.categoryRank,
                snapshot.ageGroupRank,
                snapshot.categoryRank,
                snapshotFinalSummary.ageGroupRank,
                snapshotFinalSummary.categoryRank,
              )
            : undefined,
          splits: resultSplits,
          progressPercent: 100,
          cutoffStatus: toText(resolved.cutoffStatus) ?? undefined,
          cutoffTime:
            Number.isFinite(Number(resolved.finishCutoffSeconds)) &&
            Number(resolved.finishCutoffSeconds) > 0
              ? formatHms(Number(resolved.finishCutoffSeconds))
              : undefined,
          provisional: true,
        }
      : undefined;
  return {
    success: envelope.success !== false,
    eventId: toText(envelope.eventId) || eventId,
    viewerCanSeeIdentity: snapshot.viewerCanSeeIdentity === true,
    privacyMasked: snapshot.privacyMasked === true,
    activeVersion: toText(envelope.activeVersion),
    courseVersion: toText(snapshot.courseVersion),
    visibility: toText(identity.trackingVisibility) || "PUBLIC",
    liveTrackingVisibility: toText(identity.trackingVisibility) || "PUBLIC",
    result,
    athlete: {
      id: participantUuid,
      participantUuid,
      providerUuid,
      providerEventUuid:
        toText(snapshot.providerEventUuid) ||
        participantUuid?.match(/^race:([^:]+):/i)?.[1] ||
        undefined,
      bib: toText(identity.bib),
      name: toText(identity.displayName) || `Bib ${toText(identity.bib)}`,
      fullName: toText(identity.displayName) || `Bib ${toText(identity.bib)}`,
      ageGroup: toText(identity.ageGroupKey) || undefined,
      ageGroupName: toText(identity.ageGroupKey) || undefined,
      gender: toText(identity.genderKey) || undefined,
      club: toText(identity.clubName) || undefined,
      clubName: toText(identity.clubName) || undefined,
      country: toText(identity.countryCode) || undefined,
      photoUrl: toText(identity.photoUrl) || null,
      photoURL: toText(identity.photoUrl) || null,
      viewerCanSeeIdentity: snapshot.viewerCanSeeIdentity === true,
      privacyMasked: snapshot.privacyMasked === true,
      athleteUid: toText(bergmanIdentity.firebaseUid) || undefined,
      bookingId: toText(bergmanIdentity.bookingId) || undefined,
      ticketId: toText(bergmanIdentity.ticketId) || undefined,
      contestUuid,
      providerContestUuid: contestUuid,
      eventName: canonicalEventName,
      customSlug:
        toText(
          snapshot.customSlug ?? snapshot.eventSlug ?? snapshot.event_slug,
        ) || undefined,
      eventSlug:
        toText(
          snapshot.eventSlug ?? snapshot.event_slug ?? snapshot.customSlug,
        ) || undefined,
      contestName: canonicalContestName,
      status: activeManualTerminalStatus
        ? activeManualTerminalStatus
        : finished
          ? "finished"
          : toText(
              hotResolved.status ??
                hotLive.status ??
                resolved.status ??
                raceState.status,
            ) || "not_started",
      lifecycleLabel: activeManualTerminalStatus
        ? activeManualTerminalStatus
        : finished
          ? "Finished"
          : toText(
              hotResolved.status ??
                hotLive.status ??
                resolved.status ??
                raceState.status,
            ) || "not_started",
      currentLegName: finished
        ? "FINISHED"
        : toText(
            hotResolved.currentLeg ??
              hotLive.currentLeg ??
              resolved.currentLeg ??
              raceState.currentLegType,
          ) || undefined,
      currentSplitName:
        toText(
          hotLive.currentSplit ??
            asRecord(hotResolved.currentSplit).name ??
            asRecord(hotResolved.lastCompletedSplit).name ??
            asRecord(resolved.currentSplit).name ??
            asRecord(resolved.lastCompletedSplit).name,
        ) || undefined,
      distanceCoveredKm:
        Number(resolved.officialDistanceKm ?? raceState.distanceCompletedKm) ||
        0,
      distanceRemainingKm,
      currentPace: Number.isFinite(Number(resolved.predictedPaceSecondsPerKm))
        ? formatHms(Number(resolved.predictedPaceSecondsPerKm))
        : undefined,
      averagePace: Number.isFinite(Number(resolved.predictedPaceSecondsPerKm))
        ? formatHms(Number(resolved.predictedPaceSecondsPerKm))
        : undefined,
      elapsedTime: formatHms(liveElapsedSeconds),
      estimatedFinish: toText(resolved.estimatedFinishTime) || undefined,
      splits: canonicalSplits,
      summary: snapshot.calculated,
    },
    participantLive: {
      ...hotLive,
      contestUuid,
      eventName: canonicalEventName,
      contestName: canonicalContestName,
      eventTimezone,
      status: activeManualTerminalStatus
        ? activeManualTerminalStatus
        : finished
          ? "finished"
          : toText(
              hotResolved.status ??
                hotLive.status ??
                resolved.status ??
                raceState.status,
            ) || undefined,
      currentLeg: finished
        ? "FINISHED"
        : toText(
            hotResolved.currentLeg ??
              hotLive.currentLeg ??
              resolved.currentLeg ??
              raceState.currentLegType,
          ) || undefined,
      currentSplit:
        toText(
          hotLive.currentSplit ??
            asRecord(hotResolved.currentSplit).name ??
            asRecord(hotResolved.lastCompletedSplit).name ??
            asRecord(resolved.currentSplit).name ??
            asRecord(resolved.lastCompletedSplit).name,
        ) || undefined,
      distanceCoveredKm: officialDistanceKm,
      estimatedDistanceKm:
        Number(resolved.estimatedDistanceKm) || officialDistanceKm,
      totalDistanceKm,
      distanceRemainingKm,
      estimatedProgressRatio,
      etaNextSplit: toText(resolved.etaNextSplit) || undefined,
      estimatedFinishTime: toText(resolved.estimatedFinishTime) || undefined,
      etaFinishClock: toText(resolved.estimatedFinishTime) || undefined,
      predictedPaceSecondsPerKm:
        Number(resolved.predictedPaceSecondsPerKm) || undefined,
      predictedSpeedKmh: Number(resolved.predictedSpeedKmh) || undefined,
      averagePaceLabel: Number.isFinite(
        Number(resolved.predictedPaceSecondsPerKm),
      )
        ? formatHms(Number(resolved.predictedPaceSecondsPerKm))
        : undefined,
      currentSpeedKmh: Number(resolved.predictedSpeedKmh) || undefined,
      averageSpeedKmh: Number(resolved.predictedSpeedKmh) || undefined,
      predictionSource: toText(resolved.predictionSource) || undefined,
      predictionConfidence: toText(resolved.predictionConfidence) || undefined,
      startTime:
        acceptedStartAt ||
        toText(hotLive.startTime) ||
        athleteStartTime ||
        undefined,
      startTiming: normalizedStartTiming,
      resolvedRaceState: mergedHotResolvedState,
      splits: canonicalSplits,
    },
    contestDefinition,
    contestContext: {
      contest: contestDefinition,
      splits: canonicalSplits,
      sections: canonicalSections,
      legs: canonicalLegs,
      transitions: canonicalTransitions,
    },
  } as AthleteModalResponse;
}

function enrichCanonicalAthleteWithCourse(
  response: AthleteModalResponse,
  rawCourse: unknown,
): AthleteModalResponse {
  const envelope = asRecord(rawCourse);
  const course = asRecord(envelope.data);
  const contests = Array.isArray(course.contests)
    ? course.contests.map(asRecord)
    : [];
  const participantContestUuid = toText(
    response.athlete?.providerContestUuid ??
      response.athlete?.contestUuid ??
      asRecord(response.contestContext?.contest).providerContestUuid,
  );
  const contest = contests.find((entry) => {
    const identities = [
      entry.providerContestUuid,
      entry.contestUuid,
      entry.id,
      ...(Array.isArray(entry.legacyContestIds) ? entry.legacyContestIds : []),
    ]
      .map(toText)
      .filter(Boolean);
    return Boolean(
      participantContestUuid && identities.includes(participantContestUuid),
    );
  });
  if (!contest) return response;

  const contestUuid = toText(
    contest.providerContestUuid ??
      contest.contestUuid ??
      participantContestUuid,
  );
  const contestName = toText(contest.displayName ?? contest.name);
  const ticketId = toText(contest.bergmanTicketId);
  const courseSplits = Array.isArray(contest.splits)
    ? contest.splits.map(asRecord)
    : [];
  const splitByKey = new Map(
    courseSplits.map((split) => [toText(split.key ?? split.splitKey), split]),
  );
  const enrichSplit = (value: unknown) => {
    const split = asRecord(value);
    const definition = splitByKey.get(toText(split.splitKey ?? split.key));
    if (!definition) return split;
    const displayName = toText(
      definition.displayName ??
        definition.name ??
        split.displayName ??
        split.name,
    );
    return {
      ...definition,
      ...split,
      displayName,
      name: displayName,
    };
  };
  // Course definitions and athlete timing results are separate contracts.
  // Never replace accepted athlete timing rows with definition-only rows when
  // the full canonical course arrives after the athlete snapshot.
  const dynamicSplits =
    courseSplits.length > 0
      ? courseSplits
      : Array.isArray(response.contestContext?.splits)
        ? response.contestContext.splits.map(asRecord)
        : [];
  const athleteTimingSplits = Array.isArray(response.athlete?.splits)
    ? response.athlete.splits.map(enrichSplit)
    : [];
  const participantTimingSplits = Array.isArray(
    response.participantLive?.splits,
  )
    ? response.participantLive.splits.map(enrichSplit)
    : athleteTimingSplits;
  const dynamicSections = Array.isArray(response.contestContext?.sections)
    ? response.contestContext.sections.map((value) => {
        const section = asRecord(value);
        return {
          ...section,
          rows: Array.isArray(section.rows)
            ? section.rows.map(enrichSplit)
            : section.rows,
        };
      })
    : Array.isArray(contest.sections)
      ? contest.sections
      : [];
  const contestDefinition = {
    ...contest,
    id: contestUuid,
    contestUuid,
    providerContestUuid: contestUuid,
    name: contestName,
    contestName,
    splits: dynamicSplits,
    sections: dynamicSections,
  };

  return {
    ...response,
    activeVersion: toText(envelope.activeVersion) ?? response.activeVersion,
    courseVersion: toText(contest.courseVersion) ?? response.courseVersion,
    athlete: {
      ...response.athlete,
      contestUuid,
      providerContestUuid: contestUuid,
      contest: contestName,
      contestName,
      ticketId: ticketId ?? response.athlete?.ticketId,
      splits: athleteTimingSplits,
    },
    participantLive: response.participantLive
      ? {
          ...response.participantLive,
          contestUuid,
          splits: participantTimingSplits,
        }
      : response.participantLive,
    contestDefinition,
    contestContext: {
      ...response.contestContext,
      contest: contestDefinition,
      splits: dynamicSplits,
      legs: Array.isArray(contest.legs)
        ? contest.legs
        : response.contestContext?.legs,
      sections: dynamicSections,
      transitions: Array.isArray(contest.transitions)
        ? contest.transitions
        : response.contestContext?.transitions,
    },
    courseIndex: course as AthleteModalResponse["courseIndex"],
  };
}

const canonicalSnapshotCache = new Map<string, AthleteModalResponse>();
const canonicalSnapshotPointer = new Map<string, string>();
const athleteOnlyCache = new Map<
  string,
  { expiresAt: number; response: AthleteModalResponse }
>();
const MAX_ATHLETE_REPOSITORY_CACHE_ENTRIES = 50;
const inFlightAthleteRequests = new Map<
  string,
  Promise<AthleteModalResponse>
>();

function snapshotLookupKey(eventId: string, lookupKey: string): string {
  return `${eventId}:${lookupKey}`;
}

function cacheCanonicalSnapshot(
  eventId: string,
  lookupKey: string,
  response: AthleteModalResponse,
) {
  const athlete = asRecord(response.athlete);
  const contest = asRecord(
    response.contestContext?.contest ?? response.contestDefinition,
  );
  const fullKey = [
    eventId,
    toText(
      athlete.providerContestUuid ??
        contest.providerContestUuid ??
        contest.contestUuid,
    ) ?? "contest",
    toText(athlete.participantUuid ?? athlete.providerUuid ?? lookupKey) ??
      lookupKey,
    response.activeVersion ?? "active-version",
    response.courseVersion ?? "course-version",
  ].join(":");
  canonicalSnapshotCache.delete(fullKey);
  canonicalSnapshotCache.set(fullKey, response);
  const aliases = [
    lookupKey,
    toText(athlete.bib),
    toText(athlete.participantUuid),
    toText(athlete.providerUuid),
    toText(athlete.providerAthleteUuid),
    toText(athlete.providerTimingUuid),
    toText(athlete.bookingId),
    toText(athlete.athleteUid),
  ].filter((value): value is string => Boolean(value));
  aliases.forEach((alias) =>
    canonicalSnapshotPointer.set(snapshotLookupKey(eventId, alias), fullKey),
  );
  while (canonicalSnapshotCache.size > MAX_ATHLETE_REPOSITORY_CACHE_ENTRIES) {
    const oldestKey = canonicalSnapshotCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    canonicalSnapshotCache.delete(oldestKey);
    for (const [alias, target] of canonicalSnapshotPointer) {
      if (target === oldestKey) canonicalSnapshotPointer.delete(alias);
    }
  }
}

function readCachedCanonicalSnapshot(
  eventId: string,
  lookupKey: string,
): AthleteModalResponse | undefined {
  const fullKey = canonicalSnapshotPointer.get(
    snapshotLookupKey(eventId, lookupKey),
  );
  if (!fullKey) return undefined;
  const cached = canonicalSnapshotCache.get(fullKey);
  if (cached) {
    canonicalSnapshotCache.delete(fullKey);
    canonicalSnapshotCache.set(fullKey, cached);
  }
  return cached;
}

function cacheAthleteOnlyResponse(
  key: string,
  response: AthleteModalResponse,
): void {
  athleteOnlyCache.delete(key);
  athleteOnlyCache.set(key, { expiresAt: Date.now() + 250, response });
  while (athleteOnlyCache.size > MAX_ATHLETE_REPOSITORY_CACHE_ENTRIES) {
    const oldestKey = athleteOnlyCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    athleteOnlyCache.delete(oldestKey);
  }
}

function readCachedSnapshotForParams(
  eventId: string,
  params: AthleteDetailParams,
): AthleteModalResponse | undefined {
  for (const lookupKey of [
    params.participantUuid,
    params.providerUuid,
    params.providerAthleteUuid,
    params.providerTimingUuid,
    params.providerRecordId,
    params.athleteUid,
    params.bookingId,
    params.bib,
  ]) {
    if (!lookupKey) continue;
    const cached = readCachedCanonicalSnapshot(eventId, lookupKey);
    if (cached) return cached;
  }
  return undefined;
}

function requestIdentity(params: AthleteDetailParams): string {
  return firstDefinedIdentity(params) || "unknown";
}

function firstDefinedIdentity(params: AthleteDetailParams): string {
  return (
    params.participantUuid ??
    params.providerUuid ??
    params.providerAthleteUuid ??
    params.providerTimingUuid ??
    params.providerRecordId ??
    params.athleteUid ??
    params.bookingId ??
    params.bib ??
    ""
  );
}

function modalDiagnostics(response: AthleteModalResponse) {
  const context = asRecord(response.contestContext);
  return {
    providerContestUuid: toText(
      response.athlete?.providerContestUuid ??
        asRecord(context.contest).providerContestUuid,
    ),
    activeVersion: response.activeVersion,
    courseVersion: response.courseVersion,
    splitCount: Array.isArray(context.splits) ? context.splits.length : 0,
    legCount: Array.isArray(context.legs) ? context.legs.length : 0,
    transitionCount: Array.isArray(context.transitions)
      ? context.transitions.length
      : 0,
  };
}

function normalizeOfficialAthleteResponse(
  eventId: string,
  identifier: string,
  raw: unknown,
): AthleteModalResponse {
  const envelope =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const payload = (envelope.result ??
    envelope.data ??
    envelope.athlete ??
    raw) as Record<string, unknown>;
  const athleteName = toText(
    payload.name ?? payload.displayName ?? payload.fullName,
  );
  const athleteCategory = toText(
    payload.category ?? payload.ageGroup ?? payload.raceCategory,
  );
  const athleteClub = toText(
    payload.club ?? payload.clubName ?? payload.clubNameAtRace,
  );
  const athleteGender = toText(payload.gender);
  const athleteUid =
    toText(
      payload.athleteUid ?? payload.athleteId ?? payload.id ?? identifier,
    ) || identifier;
  const finishTime = toText(
    payload.chipTime ?? payload.overallTime ?? payload.finishTime,
  );
  const athleteCountry = resolveCountryName(
    payload.countryAtRace,
    payload.country,
    payload.countryName,
    payload.nationality,
    payload.countryCode,
  );

  return {
    success: true,
    eventId,
    result: {
      status: toText(payload.status ?? payload.statusNormalized ?? "FINISHED"),
      chipTime: finishTime || undefined,
      overallRank: toNumberOrString(
        payload.overallRank ??
          payload.overallPosition ??
          payload.oRank ??
          payload.rank,
      ),
      genderRank: toNumberOrString(payload.genderRank ?? payload.gRank),
      categoryRank: toNumberOrString(payload.categoryRank ?? payload.cRank),
      splits: buildOfficialSplitsFromPayload(payload),
      club: athleteClub || undefined,
      points: toNumberOrString(payload.pointsAwarded ?? payload.points),
      location:
        toText(payload.location ?? payload.city ?? payload.state) || undefined,
      eventCategory:
        toText(
          payload.eventCategory ?? payload.contest ?? payload.contestName,
        ) || undefined,
      raceCategory:
        toText(payload.raceCategory ?? payload.category ?? athleteCategory) ||
        undefined,
      raceDate:
        toText(payload.raceDate ?? payload.date ?? payload.eventDate) ||
        undefined,
      // This endpoint is backed by the uploaded results KV. Once a row is
      // returned from it, the mobile result is published rather than live
      // canonical/provisional timing.
      provisional: false,
    },
    athlete: {
      id: athleteUid,
      bib: toText(payload.bib ?? payload.bibNumber) || identifier,
      name: athleteName || `Bib ${identifier}`,
      fullName: athleteName || `Bib ${identifier}`,
      category: athleteCategory || undefined,
      ageGroupName: athleteCategory || undefined,
      gender: athleteGender || undefined,
      club: athleteClub || undefined,
      clubName: athleteClub || undefined,
      contest: toText(payload.contest ?? payload.eventCategory) || undefined,
      contestName:
        toText(payload.contestName ?? payload.raceCategory) || undefined,
      country: athleteCountry || undefined,
      city: toText(payload.city) || undefined,
      state: toText(payload.state) || undefined,
      photoURL:
        toText(
          payload.profilePhotoUrl ??
            payload.photoUrl ??
            payload.photoURL ??
            payload.avatarUrl ??
            payload.displayPhoto,
        ) || null,
      photoUrl:
        toText(
          payload.profilePhotoUrl ??
            payload.photoUrl ??
            payload.photoURL ??
            payload.avatarUrl ??
            payload.displayPhoto,
        ) || null,
      avatarUrl:
        toText(
          payload.profilePhotoUrl ??
            payload.photoUrl ??
            payload.photoURL ??
            payload.avatarUrl ??
            payload.displayPhoto,
        ) || null,
      registrationStatus: toText(payload.status ?? "FINISHED") || undefined,
      ticketId: toText(payload.ticketId ?? payload.ticket_id) || undefined,
      ticketName:
        toText(
          payload.ticketName ?? payload.ticket_name ?? payload.raceCategory,
        ) || undefined,
      visibility: "PUBLIC",
      liveTrackingVisibility: "PUBLIC",
      displayName: athleteName || `Bib ${identifier}`,
      displayPhoto:
        toText(
          payload.profilePhotoUrl ??
            payload.photoUrl ??
            payload.photoURL ??
            payload.avatarUrl ??
            payload.displayPhoto,
        ) || null,
      profilePhotoUrl:
        toText(
          payload.profilePhotoUrl ??
            payload.photoUrl ??
            payload.photoURL ??
            payload.avatarUrl ??
            payload.displayPhoto,
        ) || undefined,
      displayClub: athleteClub || undefined,
      displayCountry: athleteCountry || undefined,
      displayLocation:
        toText(payload.location ?? payload.city ?? payload.state) || undefined,
      status: "finished",
      lifecycleLabel: "Finished",
      eventName: toText(payload.eventName ?? payload.eventTitle) || undefined,
      eventDate: toText(payload.eventDate ?? payload.raceDate) || undefined,
      customSlug:
        toText(payload.customSlug ?? payload.eventSlug ?? payload.event_slug) ||
        undefined,
      eventSlug:
        toText(payload.eventSlug ?? payload.event_slug ?? payload.customSlug) ||
        undefined,
      scheduledStart: toText(payload.scheduledStart) || undefined,
      currentLegName: undefined,
      currentSplitName: undefined,
      distanceCoveredKm: undefined,
      distanceRemainingKm: undefined,
      currentPace: undefined,
      averagePace: undefined,
      elapsedTime: finishTime || undefined,
      estimatedFinish: undefined,
      overallRank: toNumberOrString(
        payload.oRank ?? payload.overallRank ?? payload.rank,
      ),
      genderRank: toNumberOrString(payload.gRank ?? payload.genderRank),
      ageGroupRank: toNumberOrString(payload.cRank ?? payload.categoryRank),
      clubRank: toNumberOrString(payload.clubRank),
      prediction: null,
    },
    participantLive: undefined,
    courseOverview: undefined,
    cutoffs: [],
    nextSplitPrediction: undefined,
    contestContext: {
      splits: normalizeContestSplits(payload.splits),
    },
    timingConfiguration: undefined,
    courseIndex: undefined,
  } satisfies AthleteModalResponse;
}

async function loadLiveAthleteDetail(
  eventId: string,
  params: AthleteDetailParams,
  signal?: AbortSignal,
  requestType: AthleteDetailRequestType = "full",
  mobileLiveReason: MobileLiveReadReason = "initial_load",
): Promise<AthleteModalResponse> {
  const normalized = normalizeLookupParams(params);
  const lookupKey = resolveLookupValue(normalized);
  const requestedProviderUuid =
    normalized.providerUuid ??
    normalized.providerAthleteUuid ??
    normalized.providerTimingUuid ??
    normalized.providerRecordId;
  // race:<event>:<contest>:<bib> is Bergman's canonical participant ID, not a
  // Feibot provider UUID. Historical navigation state can retain an ID from a
  // previous Feibot event; sending it as providerUuid makes lookup prefer the
  // stale alias over the current bib. Bib remains stable across a relink.
  const providerUuid =
    requestedProviderUuid && !/^race:/i.test(requestedProviderUuid)
      ? requestedProviderUuid
      : undefined;
  const canonicalIdentity =
    normalized.participantUuid ??
    ([normalized.bookingId, normalized.providerUuid].find((value) =>
      /^race:/i.test(value || ""),
    ) ||
      undefined);
  const participantUuid =
    canonicalIdentity &&
    !(
      /^race:/i.test(canonicalIdentity) &&
      normalized.bib &&
      !canonicalIdentity
        .toLowerCase()
        .endsWith(`:${normalized.bib.toLowerCase()}`)
    )
      ? canonicalIdentity
      : undefined;
  const bookingId =
    normalized.bookingId && !/^race:/i.test(normalized.bookingId)
      ? normalized.bookingId
      : undefined;
  const providerEventUuid =
    normalized.providerEventUuid ??
    participantUuid?.match(/^race:([^:]+):/i)?.[1];
  if (
    requestType === "athleteOnly" &&
    (!eventId.trim() || !providerEventUuid || !participantUuid)
  ) {
    throw new Error("CANONICAL_ATHLETE_IDENTITY_REQUIRED");
  }
  const requestParams = {
    // A direct canonical participant ID is sufficient. Sending bib as well
    // makes the Worker perform an unnecessary alias KV lookup first.
    bib: participantUuid || providerUuid ? undefined : normalized.bib,
    providerEventUuid,
    providerUuid,
    participantUuid,
    athleteUid: normalized.athleteUid,
    bookingId,
    athleteOnly: requestType === "athleteOnly" ? 1 : undefined,
  };
  const inFlightKey = `${eventId}:${requestIdentity(normalized)}:${requestType}`;
  const shortCached = athleteOnlyCache.get(inFlightKey);
  if (
    requestType === "athleteOnly" &&
    shortCached &&
    shortCached.expiresAt > Date.now()
  ) {
    return shortCached.response;
  }
  const existing = inFlightAthleteRequests.get(inFlightKey);
  if (existing) return existing;

  const request = (async () => {
    const started = Date.now();
    try {
      // Full modal hydration can use the web read. Routine live tracking reads
      // the compact participant projection directly from canonical KV.
      const endpoints = [
        {
          url: `/api/live/events/${encodeURIComponent(eventId)}/canonical/athlete`,
          // The public canonical athlete response is small, but a cold App
          // Hosting/KV read can legitimately exceed the former 3.5s cutoff.
          // There is no legacy fallback for this authoritative request, so an
          // early abort left the split-less placeholder on screen forever.
          timeoutMs: 8_000,
          canonical: true,
        },
      ];
      const canonicalCourseRequest =
        requestType === "full"
          ? webApi
              .json<unknown>(
                `/api/live/course-index/${encodeURIComponent(eventId)}`,
                {
                  params: providerEventUuid ? { providerEventUuid } : undefined,
                  signal,
                  timeoutMs: 3_500,
                },
              )
              .catch(() => null)
          : Promise.resolve(null);
      let raw: unknown =
        requestType === "athleteOnly"
          ? participantLiveAsCanonicalEnvelope(
              await getParticipantLive(
                eventId,
                providerEventUuid!,
                participantUuid!,
                signal,
                mobileLiveReason,
              ),
            )
          : undefined;
      let canonicalRefresh = requestType === "athleteOnly";
      let lastError: unknown;
      for (const endpoint of raw ? [] : endpoints) {
        try {
          raw = await webApi.json<unknown>(endpoint.url, {
            params: requestParams,
            signal,
            timeoutMs: endpoint.timeoutMs,
          });
          canonicalRefresh = endpoint.canonical;
          lastError = undefined;
          break;
        } catch (error) {
          if (signal?.aborted) throw error;
          // A slow connection must not trigger a second, much larger modal
          // request after the canonical request already consumed its timeout.
          if (
            endpoint.canonical &&
            (error as { name?: string } | undefined)?.name === "AbortError"
          ) {
            throw error;
          }
          lastError = error;
        }
      }
      if (lastError) throw lastError;
      let normalizedResponse = canonicalRefresh
        ? (normalizeCanonicalAthleteRefresh(eventId, raw) ??
          normalizeLiveAthleteResponse(eventId, raw))
        : normalizeLiveAthleteResponse(eventId, raw);
      if (canonicalRefresh && requestType === "full") {
        normalizedResponse = enrichCanonicalAthleteWithCourse(
          normalizedResponse,
          await canonicalCourseRequest,
        );
      }
      const cachedFull = readCachedSnapshotForParams(eventId, normalized);
      const response =
        requestType === "athleteOnly" && cachedFull
          ? mergeAthleteOnlySnapshot(cachedFull, normalizedResponse)
          : normalizedResponse;
      if (process.env.NODE_ENV !== "production") {
        const live = asRecord(response.participantLive);
        const resolved = asRecord(live.resolvedRaceState);
        console.debug("[prediction-runtime][API]", {
          eventId,
          bib: response.athlete?.bib,
          requestType,
          status:
            resolved.status ??
            response.result?.status ??
            response.athlete?.status,
          acceptedSplitCount: Array.isArray(resolved.splits)
            ? resolved.splits.filter(hasAcceptedSplitEvidence).length
            : 0,
          overallRank: response.result?.overallRank ?? null,
          genderRank: response.result?.genderRank ?? null,
          categoryRank: response.result?.categoryRank ?? null,
          rankedSplitCount:
            response.result?.splits?.filter((split) => split.rank != null)
              .length ?? 0,
          legacyEstimatedFinish:
            response.athlete?.estimatedFinish ?? live.estimatedFinishTime,
          legacyNextSplit: response.nextSplitPrediction?.checkpoint,
        });
      }
      cacheCanonicalSnapshot(eventId, lookupKey, response);
      if (requestType === "athleteOnly") {
        // Live athletes poll frequently. A five-second local cache could return
        // the same pre-split snapshot across several polls.
        cacheAthleteOnlyResponse(inFlightKey, response);
      }

      if (process.env.NODE_ENV !== "production") {
        const details = modalDiagnostics(response);
        if (requestType === "full")
          console.log("[MobileAthleteModal] Full load", {
            eventId,
            bib: response.athlete?.bib,
            providerUuid,
            participantUuid:
              response.athlete?.participantUuid ?? normalized.participantUuid,
            ...details,
            durationMs: Date.now() - started,
          });
        else
          console.log("[MobileAthleteModal] Athlete refresh", {
            eventId,
            participantUuid:
              response.athlete?.participantUuid ?? normalized.participantUuid,
            status:
              response.athlete?.status ??
              response.athlete?.lifecycleLabel ??
              response.result?.status,
            currentLeg:
              response.athlete?.currentLegName ??
              response.participantLive?.currentLeg,
            currentSplit:
              response.athlete?.currentSplitName ??
              response.participantLive?.currentSplit,
            durationMs: Date.now() - started,
          });
      }

      return response;
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message =
        error instanceof Error
          ? error.message
          : String((error as { message?: unknown })?.message ?? "");
      if (
        /SNAPSHOT_NOT_READY|profile is rebuilding/i.test(message) ||
        (requestType === "athleteOnly" && (status == null || status >= 500))
      ) {
        const cached = readCachedSnapshotForParams(eventId, normalized);
        if (cached) return cached;
      }
      if (status === 404) {
        if (
          process.env.NODE_ENV !== "production" &&
          requestType !== "athleteOnly"
        ) {
          console.log("[athlete-detail] public API 404", {
            eventId,
            lookupKey,
          });
        }
      }
      throw error;
    }
  })();
  inFlightAthleteRequests.set(inFlightKey, request);
  try {
    return await request;
  } finally {
    if (inFlightAthleteRequests.get(inFlightKey) === request)
      inFlightAthleteRequests.delete(inFlightKey);
  }
}

async function loadResultsAthleteDetail(
  eventId: string,
  params: AthleteDetailParams,
  signal?: AbortSignal,
): Promise<AthleteModalResponse> {
  const normalized = normalizeLookupParams(params);
  const bib = resolveLookupValue(normalized);
  if (!bib) {
    return loadLiveAthleteDetail(eventId, normalized, signal);
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[athlete-detail] results lookup", {
      eventId,
      bib,
      lookupKey: bib,
    });
  }

  try {
    const raw = await api.json<Record<string, unknown>>(
      `/api/results/${eventId}/${bib}`,
      { signal },
    );
    const normalized = normalizeOfficialAthleteResponse(eventId, bib, raw);
    if (process.env.NODE_ENV !== "production") {
      console.log("[athlete-detail] participant resolved", {
        eventId,
        bib,
        source: "official-results",
      });
    }
    return normalized;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404) {
      if (process.env.NODE_ENV !== "production") {
        console.log("[athlete-detail] results 404", { eventId, bib });
      }
      return loadLiveAthleteDetail(eventId, params, signal);
    }
    throw error;
  }
}

export interface IAthleteRepository {
  search(
    eventId: string,
    q: string,
    mode?: AthleteSearchMode,
    signal?: AbortSignal,
  ): Promise<AthleteSearchResponse>;
  getDetail(
    eventId: string,
    params: AthleteDetailParams,
    signal?: AbortSignal,
    source?: AthleteDetailSource,
    requestType?: AthleteDetailRequestType,
    mobileLiveReason?: MobileLiveReadReason,
  ): Promise<AthleteModalResponse>;
}

export const ProductionAthleteRepository: IAthleteRepository = {
  async search(eventId, q, mode = "bib", signal) {
    const inferredMode = inferAthleteSearchMode(q, mode);
    const singleFlightKey = athleteSearchSingleFlightKey(
      eventId,
      inferredMode,
      q,
      "event-wide",
      true,
    );
    return runAthleteSearchSingleFlight(
      singleFlightKey,
      async () => {
        // App Hosting owns the event-wide, multi-provider search contract. The
        // legacy edge probe is not CORS-accessible on web and made every keystroke
        // wait for a guaranteed network exception before this request.
        const endpoints = [
          {
            url: `/api/live/events/${encodeURIComponent(eventId)}/search`,
            // App Hosting may need to hydrate a cold provider-scoped KV index.
            // Do not cancel a correct exact match at the previous 3.5s boundary.
            timeoutMs: 8_000,
          },
        ] as const;
        let payload: unknown;
        let lastError: unknown;
        for (const endpoint of endpoints) {
          try {
            payload = await webApi.json<unknown>(endpoint.url, {
              params: { q, mode: inferredMode, kvOnly: 1 },
              timeoutMs: endpoint.timeoutMs,
              signal,
            });
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (lastError) throw lastError;
        const response = normalizeAthleteSearchResponse(
          eventId,
          q,
          inferredMode,
          payload,
        );
        if (process.env.NODE_ENV !== "production") {
          console.log("[athlete-search] strict result", {
            eventId,
            q,
            mode: inferredMode,
            kvOnly: true,
            state: response.matches.length > 0 ? "found" : "not-found",
            count: response.matches.length,
          });
        }
        return response;
      },
      signal,
    );
  },
  async getDetail(
    eventId,
    params,
    signal,
    source = "live",
    requestType = "full",
    mobileLiveReason = "initial_load",
  ): Promise<AthleteModalResponse> {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        requestType === "athleteOnly"
          ? "[mobile-live-shared-state] request"
          : "[athlete-detail] request",
        {
          eventId,
          participantUuid: params.participantUuid,
          source: source === "results" ? "results" : "upcoming/live",
          hasFallbackIdentity: Boolean(
            params.providerUuid ||
            params.athleteUid ||
            params.bookingId ||
            params.bib,
          ),
        },
      );
    }
    if (source === "results") {
      return loadResultsAthleteDetail(eventId, params, signal);
    }

    return loadLiveAthleteDetail(
      eventId,
      params,
      signal,
      requestType,
      mobileLiveReason,
    );
  },
};
