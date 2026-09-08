import { useQueries, useQuery } from "@tanstack/react-query";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Alert,
  AppState,
  FlatList,
  PanResponder,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  type LayoutChangeEvent,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { repositories, type AthleteSearchMode } from "@/core/repositories";
import type { AthleteModalResponse } from "@/core/types";
import { useSession } from "@/core/auth/session";
import { queryKeys } from "@/core/services/query/queryKeys";
import { isLiveDiagnosticsEnabled } from "@/core/services/performance/liveDiagnosticsPolicy";
import {
  disableTrackedAthleteNotifications,
  enableTrackedAthleteNotifications,
  trackedAthleteNotificationsEnabled,
} from "@/core/services/notifications";
import { useTheme } from "@/core/theme";
import { formatCutoffSummary, getInitials } from "@/core/utils";
import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Avatar,
  Icon,
  SearchBar,
  Skeleton,
  Text,
} from "@/shared/components";
import { useDebouncedValue } from "@/shared/hooks";
import { useWatchlist } from "@/features/tracking/watchlist/hooks/useWatchlist";
import { normalizeProviderEventUuid } from "@/features/tracking/providerScope";
import {
  useAthleteSearch,
  useCourseGeometry,
  useCourseMap,
  useEventResults,
  useCanonicalChangeSocket,
} from "@/features/tracking/hooks";
import type { CanonicalAthleteQueryReason } from "@/features/tracking/hooks/useCanonicalChangeSocket";
import {
  athletePresentationFingerprint,
  mapAthleteDetail,
  scheduledStartFromTicket,
  type AthleteDetailViewModel,
  type AthleteHeaderView,
  type TimelineSplit,
} from "@/features/tracking/mappers";
import {
  courseStageLabels,
  resolveCourseKind,
  resolveCourseKindFromSections,
} from "@/features/tracking/courseKind";
import { resolveAthletePhoto } from "@/features/tracking/athletePhoto";
import { mapCourseMap } from "@/features/tracking/course-map/mappers";
import {
  resolveBergman102MasterCourseSelection,
  type CourseMapSelection,
} from "@/features/tracking/course-map/courseConfig";
import {
  recordLiveMapStartupComplete,
  recordMapDiagnostic,
  startLiveMapDiagnosticWindow,
} from "@/features/tracking/course-map/devInstrumentation";
import { immutableCourseIdentity } from "@/features/tracking/course-map/courseIdentity";
import { getOrBuildCourseModel } from "@/features/tracking/course-map/courseModelCache";
import { startLiveRequestDiagnosticWindow } from "@/features/tracking/liveRequestDiagnostics";
import {
  commitAthleteSwitchDerivationStats,
  measureActiveAthleteSwitchPhase,
  recordLivePerformance,
  recordAthleteSwitchPhase,
  setTrackedAthletePerformanceCount,
  startAthleteSwitchDerivationStats,
  startLivePerformanceWindow,
} from "@/features/tracking/livePerformanceDiagnostics";
import {
  legacyTrackedAthleteLookup,
  resolveLegacyTrackedAthlete,
  resolvedTrackedAthleteForLiveState,
} from "@/features/tracking/legacyTrackedAthleteIdentity";
import { identityHydrationIndexes } from "@/features/tracking/identityHydrationBudget";
import { buildTrackedAthleteSummaryPresentation } from "@/features/tracking/preCanonicalPresentation";
import {
  CourseMapView,
  type CourseMapViewProps,
  type MapLayerPreferences,
} from "@/features/tracking/course-map/components/CourseMapView";
import {
  ElevationProfilePanel,
  type ElevationAthleteMarker,
} from "@/features/tracking/course-map/components/ElevationProfilePanel";
import type { TrackAthlete } from "@/features/tracking/course-map/components/CourseTrackCanvas";
import {
  buildCumulativePath,
  estimatedDistanceKm,
  distanceToFraction,
  positionAtFraction,
  checkpointBoundedPosition,
} from "@/features/tracking/engine";
import { preferFreshestAthleteResponse } from "@/features/tracking/timing/freshness";
import {
  responseMatchesSelectedParticipant,
  requiresLegacyIdentityLookup,
  selectionAfterTrackedAthleteRemoval,
} from "@/features/tracking/trackingSelection";
import {
  athleteDetailFallbackInterval,
  createSelectedAthleteRequestCoordinator,
  createSingleFlightRefetch,
} from "@/features/tracking/hooks/athleteDetailRefreshPolicy";
import {
  resolveLiveElapsedSeconds,
  resolveLiveTimingAnchorMs,
  useLiveElapsedClock,
  useSharedLiveNow,
} from "@/features/tracking/timing/liveElapsed";
import { resolveCanonicalCutoffPresentation } from "@/features/tracking/timing/canonicalCutoff";
import {
  CourseOverviewCard,
  CutoffCard,
  OfficialResultsCard,
  PredictionCard,
  RankingCard,
  RaceStartCountdown,
  TimelineCard,
} from "@/features/tracking/athlete-detail/components/cards";

import { useEvent } from "../hooks/useEvents";
import { useEventScreenInitialization } from "../hooks/useEventScreenInitialization";
import { eventUsesResultsMode } from "../utils/eventResultsMode";

type SheetMode = "collapsed" | "medium" | "full";

const BERGMAN_MARK = require("../../../../assets/images/favicon.png");
const MAP_TYPE_OPTIONS =
  Platform.OS === "ios"
    ? (["standard", "satellite", "hybrid"] as const)
    : (["standard", "satellite", "hybrid", "terrain"] as const);

type SearchHit = {
  id: string;
  participantUuid?: string;
  providerEventUuid?: string;
  bib: string;
  name: string;
  email?: string;
  category?: string;
  ageGroup?: string;
  club?: string;
  photoUrl?: string;
  contestUuid?: string;
  contestId?: string;
  providerContestUuid?: string;
  canonicalContestUuid?: string;
  providerContestId?: string;
  ticketId?: string;
  providerUuid?: string;
  providerAthleteUuid?: string;
  providerTimingUuid?: string;
  providerRecordId?: string;
  athleteUid?: string;
  bookingId?: string;
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
  elapsedTime?: string;
  rank?: number | string;
  progressPercent?: number;
  updatedAt?: string;
  participantLive?: Record<string, unknown>;
};

type TrackedCard = {
  athlete: SearchHit;
  detail?: ReturnType<typeof mapAthleteDetail>;
  cutoffs?: SegmentCutoffs;
  raceCategory?: string;
  timingUnavailable?: boolean;
  initialLoading?: boolean;
  refreshing?: boolean;
};

type SegmentCutoffs = {
  mode?: string;
  swim?: string;
  bike?: string;
  run?: string;
};

function elapsedLabelSeconds(value: unknown): number | null {
  const textValue = String(value ?? "").trim();
  if (!textValue || textValue === "—" || textValue === "-") return null;
  const parts = textValue.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number.isFinite(parts[0]) ? parts[0] : null;
}

function compareTrackedCardsByOfficialRaceState(
  a: TrackedCard,
  b: TrackedCard,
) {
  const metrics = (row: TrackedCard) => {
    const status = String(row.detail?.header.status || "").toLowerCase();
    const finished = status === "finished";
    const completed = (row.detail?.timeline || []).filter(
      (split) => split.state === "completed",
    );
    const last = completed.at(-1);
    return {
      finished,
      completedCount: completed.length,
      elapsed: elapsedLabelSeconds(last?.elapsedTimeLabel || last?.timeLabel),
      officialProgress: Number(row.detail?.raceProgress?.progress || 0),
    };
  };
  const am = metrics(a);
  const bm = metrics(b);
  if (am.finished !== bm.finished) return am.finished ? -1 : 1;
  if (am.completedCount !== bm.completedCount)
    return bm.completedCount - am.completedCount;
  if (am.elapsed !== bm.elapsed)
    return (
      (am.elapsed ?? Number.MAX_SAFE_INTEGER) -
      (bm.elapsed ?? Number.MAX_SAFE_INTEGER)
    );
  if (am.officialProgress !== bm.officialProgress)
    return bm.officialProgress - am.officialProgress;
  return String(a.athlete.bib || a.athlete.name).localeCompare(
    String(b.athlete.bib || b.athlete.name),
    undefined,
    { numeric: true },
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveAthleteTicket(
  eventValue: unknown,
  athlete: SearchHit,
  contestName?: string,
  contestValue?: unknown,
): Record<string, unknown> | undefined {
  const event = record(eventValue);
  const raw = record(event.raw);
  const entries = [
    event.ticketDefinitions,
    event.contests,
    raw.ticketDefinitions,
    raw.contests,
  ]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map(record);
  const canonicalContest = record(contestValue);
  const requested = [
    athlete.ticketId,
    athlete.contestId,
    athlete.contestUuid,
    athlete.providerContestUuid,
    athlete.providerContestId,
    athlete.category,
    contestName,
    canonicalContest.bergmanTicketId,
    canonicalContest.ticketId,
    canonicalContest.id,
    canonicalContest.contestId,
    canonicalContest.contestUuid,
    canonicalContest.providerContestUuid,
    canonicalContest.displayName,
    canonicalContest.name,
    canonicalContest.contestName,
  ]
    .map(normalizeContestKey)
    .filter((value) => value !== "unknown-contest");
  return entries.find((entry) =>
    [
      entry.id,
      entry.ticketId,
      entry.contestId,
      entry.contestUuid,
      entry.providerContestUuid,
      entry.ticketName,
      entry.name,
      entry.contestName,
      entry.label,
    ]
      .map(normalizeContestKey)
      .some(
        (candidate) =>
          candidate !== "unknown-contest" && requested.includes(candidate),
      ),
  );
}

function resolveAthleteCutoffs(
  eventValue: unknown,
  athlete: SearchHit,
): SegmentCutoffs | undefined {
  const match = resolveAthleteTicket(eventValue, athlete);
  const configured = record(match?.cutoffs);
  if (Object.keys(configured).length === 0) return undefined;
  return {
    mode: firstText(configured.mode) || undefined,
    swim: firstText(configured.swim) || undefined,
    bike: firstText(configured.bike) || undefined,
    run: firstText(configured.run) || undefined,
  };
}

function athleteDetailIdentity(athlete: Partial<SearchHit>) {
  return {
    bib: athlete.bib,
    athleteUid: athlete.athleteUid,
    bookingId: athlete.bookingId,
    providerUuid: athlete.providerUuid,
    email: athlete.email,
    participantUuid: athlete.participantUuid,
    providerEventUuid:
      athlete.providerEventUuid ??
      athlete.participantUuid?.match(/^race:([^:]+):/i)?.[1],
    providerAthleteUuid: athlete.providerAthleteUuid,
    providerTimingUuid: athlete.providerTimingUuid,
    providerRecordId: athlete.providerRecordId,
    providerContestUuid:
      athlete.providerContestUuid ?? athlete.canonicalContestUuid,
  };
}

function trackedAthleteIdentityFingerprint(
  eventId: string,
  athlete: Partial<SearchHit> | null | undefined,
): string {
  const participantUuid = firstText(athlete?.participantUuid);
  const providerEventUuid = firstText(
    athlete?.providerEventUuid,
    participantUuid.match(/^race:([^:]+):/i)?.[1],
  );
  if (participantUuid) {
    return [eventId, providerEventUuid, participantUuid].join(":");
  }
  // Legacy watchlist rows do not yet have a canonical participant UUID. Keep
  // their recovery key scoped until the first canonical identity is resolved.
  return [
    eventId,
    providerEventUuid,
    "legacy",
    firstText(
      athlete?.canonicalContestUuid,
      athlete?.providerContestUuid,
      athlete?.contestUuid,
      athlete?.contestId,
    ),
    firstText(athlete?.bib, athlete?.id),
  ].join(":");
}

function trackedAthleteFallbackDetail(athlete: SearchHit, eventId: string) {
  return buildTrackedAthleteSummaryPresentation({
    id: firstText(athlete.id, athlete.bib, `${eventId}:identity`),
    participantUuid: athlete.participantUuid,
    bib: athlete.bib,
    name: athlete.name,
    category: athlete.category,
    ageGroup: athlete.ageGroup,
    club: athlete.club,
    photoUrl: athlete.photoUrl,
    raceDate: athlete.raceDate,
    status: athlete.status,
    currentLeg: athlete.currentLeg,
    progressPercent: athlete.progressPercent,
    participantLive: athlete.participantLive,
  });
}

function trackedAthleteSummaryFingerprint(athlete: SearchHit, eventId: string) {
  return JSON.stringify([
    eventId,
    athlete.id,
    athlete.participantUuid,
    athlete.providerEventUuid,
    athlete.providerContestUuid,
    athlete.bib,
    athlete.name,
    athlete.category,
    athlete.ageGroup,
    athlete.club,
    athlete.photoUrl,
    athlete.status,
    athlete.currentLeg,
    athlete.currentSplit,
    athlete.latestSplit,
    athlete.latestSplitTime,
    athlete.elapsedTime,
    athlete.rank,
    athlete.progressPercent,
    athlete.updatedAt,
    athlete.participantLive,
  ]);
}

function isCanonicalBuildUnavailable(error: unknown): boolean {
  const details = record(error);
  const status = Number(details.status);
  const message = firstText(details.message, details.userMessage, details.code);
  return (
    status === 404 &&
    /canonical_build_missing|no canonical live-tracking build is published/i.test(
      message,
    )
  );
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSearchText(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeBib(value: unknown): string {
  const normalized = text(value);
  return /^\d+$/.test(normalized)
    ? normalized.replace(/^0+(?=\d)/, "")
    : normalized.toLowerCase();
}

function athleteMatchesSearch(
  athlete: Record<string, unknown>,
  queryValue: unknown,
): boolean {
  const query = normalizeSearchText(queryValue);
  if (!query) return false;
  if (/^\d+$/.test(query)) {
    return (
      normalizeBib(athlete.bib ?? athlete.bibNumber) === normalizeBib(query)
    );
  }
  return [
    athlete.name,
    athlete.displayName,
    athlete.fullName,
    athlete.contestName,
    athlete.category,
  ].some((value) => normalizeSearchText(value).includes(query));
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finishSplitRequestKey(response?: AthleteModalResponse): string {
  if (!response) return "";
  const athlete = recordValue(response.athlete);
  const live = recordValue(response.participantLive);
  const context = recordValue(response.contestContext);
  const sources = [live.splits, athlete.splits, context.splits];
  const splits = sources.flatMap((value) =>
    Array.isArray(value) ? value.map(recordValue) : [],
  );
  const finish = [...splits]
    .reverse()
    .find((split) =>
      /(^|[_\s-])(finish|finished|final)([_\s-]|$)/i.test(
        firstText(
          split.canonicalCode,
          split.splitKey,
          split.displayName,
          split.name,
          split.label,
        ),
      ),
    );
  return finish
    ? firstText(
        finish.providerSplitUuid,
        finish.provider_split_uuid,
        finish.splitUuid,
        finish.split_uuid,
        finish.uuid,
        finish.UUID,
        finish.splitKey,
      )
    : "";
}

function hasTerminalNonFinishStatus(response?: AthleteModalResponse): boolean {
  if (!response) return false;
  const athlete = recordValue(response.athlete);
  const result = recordValue(response.result);
  const live = recordValue(response.participantLive);
  const resolved = recordValue(live.resolvedRaceState);
  return [resolved.status, live.status, result.status, athlete.status].some(
    (value) => /^(DNF|DNS|DNQ|DSQ)$/i.test(firstText(value)),
  );
}

function leaderboardRowMatchesAthlete(
  row: Record<string, unknown>,
  participantUuid: string,
  bib: string,
): boolean {
  const rowParticipantUuid = firstText(
    row.participantUuid,
    row.providerParticipantUuid,
    row.athleteId,
  ).toLowerCase();
  if (participantUuid && rowParticipantUuid === participantUuid.toLowerCase())
    return true;
  return Boolean(
    bib &&
    firstText(row.bib, row.bibNumber).replace(/^0+/, "") ===
      bib.replace(/^0+/, ""),
  );
}

function isPublicTrackableAthlete(value: Record<string, unknown>): boolean {
  const registration =
    value.registration && typeof value.registration === "object"
      ? (value.registration as Record<string, unknown>)
      : undefined;
  const visibility = firstText(
    value.trackingVisibility,
    value.liveTrackingPrivacy,
    value.privacy,
    value.liveTrackingVisibility,
    value.visibility,
    registration?.trackingVisibility,
    registration?.liveTrackingPrivacy,
  ).toUpperCase();
  if (value.viewerCanSeeIdentity === true || value.privacyMasked === false) {
    return (
      value.searchVisible !== false &&
      value.mapVisible !== false &&
      value.modalVisible !== false
    );
  }
  if (
    visibility === "ANONYMOUS" ||
    visibility === "ANON" ||
    visibility === "PRIVATE" ||
    visibility === "OFFICIALS_ONLY" ||
    value.anonymous === true
  ) {
    return false;
  }
  return (
    value.searchVisible !== false &&
    value.mapVisible !== false &&
    value.modalVisible !== false
  );
}

function normalizeContestKey(value: unknown): string {
  return (
    firstText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown-contest"
  );
}

function stableAthleteKey(
  athlete: Partial<SearchHit>,
  fallbackEventId?: string,
): string {
  const event = normalizeContestKey(firstText(fallbackEventId));
  const providerEvent = normalizeContestKey(
    firstText(
      athlete.providerEventUuid,
      athlete.participantUuid?.match(/^race:([^:]+):/i)?.[1],
    ),
  );
  const raceDate = normalizeContestKey(athlete.raceDate);
  const contest = normalizeContestKey(
    firstText(
      athlete.ticketId,
      athlete.contestId,
      athlete.contestUuid,
      athlete.providerContestUuid,
      athlete.providerContestId,
      athlete.category,
    ),
  );
  const participant = normalizeContestKey(
    firstText(
      athlete.participantUuid,
      athlete.providerAthleteUuid,
      athlete.providerUuid,
      athlete.providerTimingUuid,
      athlete.providerRecordId,
      athlete.athleteUid,
    ),
  );
  const bib = normalizeBib(athlete.bib);
  if (
    event !== "unknown-contest" &&
    providerEvent !== "unknown-contest" &&
    participant !== "unknown-contest"
  ) {
    return [event, providerEvent, participant].join(":");
  }
  if (event !== "unknown-contest" && contest !== "unknown-contest" && bib) {
    return [
      event,
      raceDate !== "unknown-contest" ? raceDate : "",
      contest !== "unknown-contest" ? contest : "",
      `bib-${bib}`,
    ]
      .filter(Boolean)
      .join(":");
  }
  if (
    event !== "unknown-contest" &&
    contest !== "unknown-contest" &&
    participant !== "unknown-contest"
  ) {
    return [
      event,
      raceDate !== "unknown-contest" ? raceDate : "",
      contest,
      participant,
    ]
      .filter(Boolean)
      .join(":");
  }
  const booking = normalizeContestKey(athlete.bookingId);
  if (event !== "unknown-contest" && booking !== "unknown-contest") {
    return [
      event,
      raceDate !== "unknown-contest" ? raceDate : "",
      "booking",
      booking,
    ]
      .filter(Boolean)
      .join(":");
  }
  return normalizeContestKey(athlete.id);
}

function sameAthleteIdentity(
  left: Partial<SearchHit>,
  right: Partial<SearchHit>,
): boolean {
  const identityValues = (athlete: Partial<SearchHit>) =>
    [
      athlete.bookingId,
      athlete.athleteUid,
      athlete.participantUuid,
      athlete.providerAthleteUuid,
      athlete.providerUuid,
      athlete.providerTimingUuid,
      athlete.providerRecordId,
    ]
      .map(normalizeContestKey)
      .filter((value) => value !== "unknown-contest");
  const leftValues = identityValues(left);
  const rightValues = new Set(identityValues(right));
  if (leftValues.some((value) => rightValues.has(value))) return true;
  // Two explicit canonical identities that do not match are never the same
  // athlete, even if separate provider events reuse a BIB.
  if (leftValues.length > 0 && rightValues.size > 0) return false;
  const leftBib = normalizeBib(left.bib);
  const rightBib = normalizeBib(right.bib);
  const leftProviderEvent = normalizeProviderEventUuid(
    firstText(left.providerEventUuid),
  );
  const rightProviderEvent = normalizeProviderEventUuid(
    firstText(right.providerEventUuid),
  );
  return Boolean(
    leftBib &&
    leftBib === rightBib &&
    (!leftProviderEvent ||
      !rightProviderEvent ||
      leftProviderEvent === rightProviderEvent),
  );
}

function sameAthleteSelection(
  left: Partial<SearchHit>,
  right: Partial<SearchHit>,
): boolean {
  if (sameAthleteIdentity(left, right)) return true;
  const leftBib = normalizeBib(left.bib);
  const rightBib = normalizeBib(right.bib);
  return Boolean(leftBib && leftBib === rightBib);
}

function displayHeader(detail: AthleteDetailViewModel): AthleteHeaderView {
  if (!detail.isAnonymous) return detail.header;
  return {
    ...detail.header,
    name: "Anonymous Athlete",
    photo: undefined,
    category: undefined,
    gender: undefined,
    club: undefined,
    countryFlag: undefined,
    location: undefined,
    registrationStatus: undefined,
    colorSeed: "anonymous-athlete",
  };
}

function mergeSearchResults(...groups: SearchHit[][]): SearchHit[] {
  const merged: SearchHit[] = [];
  const identityIndex = new Map<string, number>();
  const identityKeys = (athlete: SearchHit) => {
    const keys = [
      athlete.bib ? `bib:${normalizeSearchText(athlete.bib)}` : "",
      athlete.participantUuid
        ? `participant:${normalizeContestKey(athlete.participantUuid)}`
        : "",
      athlete.providerAthleteUuid
        ? `provider-athlete:${normalizeContestKey(athlete.providerAthleteUuid)}`
        : "",
      athlete.providerUuid
        ? `provider:${normalizeContestKey(athlete.providerUuid)}`
        : "",
      athlete.providerTimingUuid
        ? `timing:${normalizeContestKey(athlete.providerTimingUuid)}`
        : "",
      athlete.providerRecordId
        ? `record:${normalizeContestKey(athlete.providerRecordId)}`
        : "",
      athlete.bookingId
        ? `booking:${normalizeContestKey(athlete.bookingId)}`
        : "",
      athlete.athleteUid
        ? `athlete:${normalizeContestKey(athlete.athleteUid)}`
        : "",
    ];
    return [...new Set(keys.filter(Boolean))];
  };
  for (const group of groups) {
    for (const athlete of group) {
      const keys = identityKeys(athlete);
      const existingIndex = keys
        .map((key) => identityIndex.get(key))
        .find((index): index is number => index !== undefined);
      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];
        merged[existingIndex] = {
          ...athlete,
          ...existing,
          club: existing.club || athlete.club,
          photoUrl: existing.photoUrl || athlete.photoUrl,
          category: existing.category || athlete.category,
        };
        identityKeys(merged[existingIndex]).forEach((key) =>
          identityIndex.set(key, existingIndex),
        );
        continue;
      }
      const index = merged.length;
      merged.push(athlete);
      keys.forEach((key) => identityIndex.set(key, index));
    }
  }
  return merged;
}

function sheetHeightFor(mode: SheetMode): number {
  if (mode === "collapsed") return 230;
  if (mode === "medium") return 390;
  if (mode === "full") return 620;
  return 0;
}

function searchHitFromRaw(item: any): SearchHit {
  const provider =
    item?.provider && typeof item.provider === "object" ? item.provider : {};
  // Generic `id` is commonly a participant UUID/document ID, not a BIB.
  const bib = firstText(
    item.bib,
    item.bibNumber,
    item.bibNo,
    item.raceNumber,
    item.startNumber,
    item.number,
  );
  const participantUuid = firstText(item.participantUuid);
  const providerEventUuid = firstText(
    item.providerEventUuid,
    item.eventUuid,
    participantUuid.match(/^race:([^:]+):/i)?.[1],
  );
  const providerUuid = firstText(item.providerUuid, provider.providerUuid);
  const providerAthleteUuid = firstText(item.providerAthleteUuid);
  const providerTimingUuid = firstText(item.providerTimingUuid);
  const providerRecordId = firstText(item.providerRecordId);
  const bookingId = firstText(item.bookingId);
  const athleteUid = firstText(item.athleteUid);
  const email = firstText(item.email);
  const category = firstText(
    item.category,
    item.contest,
    item.contestName,
    item.providerContestName,
    item.ageGroupName,
  );
  const id = firstText(
    participantUuid,
    providerUuid,
    providerAthleteUuid,
    providerTimingUuid,
    providerRecordId,
    bookingId,
    athleteUid,
    bib && category ? `bib:${bib}:contest:${category}` : undefined,
    bib,
  );
  return {
    id,
    participantUuid,
    providerEventUuid,
    bib,
    name: firstText(item.name, item.displayName, item.fullName) || `Bib ${bib}`,
    email,
    category,
    ageGroup: firstText(item.ageGroup, item.ageGroupName, item.categoryName),
    club: firstText(item.club, item.clubName),
    photoUrl: firstText(
      item.photoUrl,
      item.profilePhotoUrl,
      item.photoURL,
      item.displayPhoto,
    ),
    contestUuid: firstText(item.contestUuid),
    contestId: firstText(item.contestId),
    providerContestUuid: firstText(item.providerContestUuid),
    canonicalContestUuid: firstText(
      item.canonicalContestUuid,
      item.providerContestUuid,
      item.contestUuid,
    ),
    providerContestId: firstText(item.providerContestId),
    ticketId: firstText(item.ticketId),
    providerUuid,
    providerAthleteUuid,
    providerTimingUuid,
    providerRecordId,
    athleteUid,
    bookingId,
    raceDate: firstText(item.raceDate, item.eventDate, item.date),
    trackingVisibility: firstText(item.trackingVisibility),
    liveTrackingPrivacy: firstText(item.liveTrackingPrivacy),
    privacy: firstText(item.privacy),
    liveTrackingVisibility: firstText(item.liveTrackingVisibility),
    searchVisible: item.searchVisible !== false,
    mapVisible: item.mapVisible !== false,
    modalVisible: item.modalVisible !== false,
    viewerCanSeeIdentity: item.viewerCanSeeIdentity === true,
    privacyMasked: item.privacyMasked === true,
    anonymous:
      item.viewerCanSeeIdentity === true ? false : item.anonymous === true,
    status: firstText(item.status, item.timingState) || undefined,
    currentLeg: firstText(item.currentLeg) || undefined,
    currentSplit: firstText(item.currentSplit) || undefined,
    latestSplit: firstText(item.latestSplit) || undefined,
    latestSplitTime: firstText(item.latestSplitTime) || undefined,
    elapsedTime: firstText(item.elapsedTime) || undefined,
    rank: item.rank,
    progressPercent: Number.isFinite(Number(item.progressPercent))
      ? Number(item.progressPercent)
      : undefined,
    updatedAt: firstText(item.updatedAt, item.lastSeen) || undefined,
    participantLive:
      item.participantLive && typeof item.participantLive === "object"
        ? item.participantLive
        : undefined,
  };
}

const SearchResultCard = memo(function SearchResultCard({
  athlete,
  onPress,
  isTracked,
  photoUrl,
  resultsMode = false,
}: {
  athlete: SearchHit;
  onPress: () => void;
  isTracked: boolean;
  photoUrl?: string;
  resultsMode?: boolean;
}) {
  const theme = useTheme();
  return (
    <Card
      style={{
        gap: theme.spacing.sm,
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: isTracked
          ? "rgba(46,116,214,0.38)"
          : "rgba(46,116,214,0.14)",
        backgroundColor: "#FFFFFF",
        shadowColor: "#2E74D6",
        shadowOpacity: isTracked ? 0.12 : 0.06,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 2,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 54,
            height: 54,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${theme.colors.accentSecondary}14`,
            borderWidth: 1,
            borderColor: isTracked
              ? theme.colors.accentSecondary
              : "rgba(46,116,214,0.16)",
            overflow: "hidden",
          }}
        >
          {photoUrl ? (
            <Avatar name={athlete.name} uri={photoUrl} size={54} />
          ) : (
            <Text
              variant="headline"
              style={{ color: theme.colors.accentSecondary }}
            >
              {getInitials(athlete.name)}
            </Text>
          )}
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Text
              variant="headline"
              numberOfLines={1}
              style={{ flexShrink: 1 }}
            >
              {athlete.name}
            </Text>
            {isTracked ? (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 999,
                  backgroundColor: "rgba(46,116,214,0.10)",
                  borderWidth: 1,
                  borderColor: "rgba(46,116,214,0.22)",
                }}
              >
                <Text
                  variant="caption"
                  style={{
                    color: theme.colors.accentSecondary,
                    fontWeight: "900",
                  }}
                >
                  ADDED
                </Text>
              </View>
            ) : null}
          </View>
          <Text variant="bodySmall" color="textMuted" numberOfLines={2}>
            Bib {athlete.bib}
            {athlete.club ? ` · ${athlete.club}` : ""}
            {athlete.category ? ` · ${athlete.category}` : ""}
          </Text>
        </View>
      </View>
      <Button
        label={
          resultsMode
            ? isTracked
              ? "Open Result"
              : "View Result"
            : isTracked
              ? "Show Athlete"
              : "Add to Tracking"
        }
        variant={isTracked ? "secondary" : "primary"}
        size="sm"
        fullWidth
        onPress={onPress}
      />
    </Card>
  );
});

function FloatingLauncher({
  count,
  onPress,
  top = 84,
}: {
  count: number;
  onPress: () => void;
  top?: number;
}) {
  const theme = useTheme();
  const pulse = useSharedValue(0);
  const hasTrackedAthletes = count > 0;

  useEffect(() => {
    if (!hasTrackedAthletes) {
      pulse.value = 0;
      return undefined;
    }
    pulse.value = withRepeat(
      withTiming(1, {
        duration: 1500,
        easing: Easing.inOut(Easing.cubic),
      }),
      -1,
      true,
    );
    return undefined;
  }, [hasTrackedAthletes, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.035 }],
    opacity: hasTrackedAthletes ? 0.7 + pulse.value * 0.3 : 1,
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: "absolute",
          left: theme.spacing.base,
          top,
          zIndex: 32,
          elevation: 32,
          ...(Platform.OS === "web"
            ? ({ boxShadow: "0 12px 24px rgba(15,23,42,0.26)" } as any)
            : {
                shadowColor: "#000",
                shadowOpacity: 0.26,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 8 },
                elevation: 10,
              }),
        },
      ]}
    >
      {hasTrackedAthletes ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: -4,
              top: -4,
              right: -4,
              bottom: -4,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.55)",
              backgroundColor: "rgba(46,116,214,0.18)",
            },
            pulseStyle,
          ]}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open tracked athletes panel"
        onPress={onPress}
        style={({ pressed }) => [
          {
            height: 52,
            minWidth: 62,
            borderRadius: 18,
            paddingHorizontal: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor: "#2E74D6",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.28)",
          },
          pressed ? { transform: [{ scale: 0.97 }] } : null,
        ]}
      >
        <Icon name="user" size={20} colorValue="#FFFFFF" />
        <Text variant="label" style={{ color: "#FFFFFF", fontWeight: "900" }}>
          Track
        </Text>
        {hasTrackedAthletes ? (
          <View
            style={{
              position: "absolute",
              top: -8,
              right: -8,
              minWidth: 24,
              height: 24,
              borderRadius: 12,
              paddingHorizontal: 6,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#00D4FF",
              borderWidth: 2,
              borderColor: "#FFFFFF",
            }}
          >
            <Text
              variant="caption"
              style={{ color: "#00111F", fontWeight: "900" }}
            >
              {count}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function CompactTrackedCarousel({
  rows,
  selectedIndex,
  onSelect,
  onOpen,
  onRemove,
  onSearch,
}: {
  rows: TrackedCard[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onRemove: (index: number) => void;
  onSearch: () => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const carouselRef = useRef<FlatList<TrackedCard>>(null);
  const initialPage = Math.max(0, Math.min(selectedIndex, rows.length - 1));
  const [page, setPage] = useState(initialPage);
  const hasRunningAthlete = rows.some(
    ({ detail }) => !detail?.result && detail?.header.status === "live",
  );
  const nowMs = useSharedLiveNow(hasRunningAthlete);
  const cardWidth = Math.max(240, width - 48);
  const cardStep = cardWidth + theme.spacing.sm;

  useEffect(() => {
    const bounded = Math.max(0, Math.min(selectedIndex, rows.length - 1));
    const timer = setTimeout(() => {
      setPage(bounded);
      carouselRef.current?.scrollToIndex({
        index: bounded,
        animated: true,
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [cardStep, rows.length, selectedIndex]);

  const goToPage = (nextPage: number) => {
    const bounded = Math.max(0, Math.min(nextPage, rows.length - 1));
    setPage(bounded);
    onSelect(bounded);
    carouselRef.current?.scrollToIndex({ index: bounded, animated: true });
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: theme.spacing.base,
        zIndex: 40,
        elevation: 40,
      }}
    >
      <View
        style={{
          marginHorizontal: theme.spacing.sm,
          borderRadius: theme.radius.xl,
          backgroundColor: "rgba(24,24,24,0.96)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.14)",
          paddingVertical: theme.spacing.sm,
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: theme.spacing.md,
            marginBottom: theme.spacing.xs,
          }}
        >
          <Text
            variant="caption"
            style={{ color: "#FFFFFF", fontWeight: "900" }}
          >
            {rows.length} TRACKED
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous tracked athlete"
              disabled={page === 0}
              onPress={() => goToPage(page - 1)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                opacity: page === 0 ? 0.35 : 1,
                backgroundColor: "rgba(255,255,255,0.10)",
              }}
            >
              <Icon name="chevronLeft" size={17} colorValue="#FFFFFF" />
            </Pressable>
            <Text
              variant="caption"
              style={{ color: "#D4D4D4", minWidth: 34, textAlign: "center" }}
            >
              {rows.length > 0 ? page + 1 : 0}/{rows.length}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next tracked athlete"
              disabled={page >= rows.length - 1}
              onPress={() => goToPage(page + 1)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                opacity: page >= rows.length - 1 ? 0.35 : 1,
                backgroundColor: "rgba(255,255,255,0.10)",
              }}
            >
              <Icon name="chevronRight" size={17} colorValue="#FFFFFF" />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search athletes"
            onPress={onSearch}
            hitSlop={8}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 10,
              height: 30,
              borderRadius: 15,
              backgroundColor: "rgba(255,255,255,0.10)",
            }}
          >
            <Icon name="search" size={15} colorValue="#FFFFFF" />
            <Text
              variant="caption"
              style={{ color: "#FFFFFF", fontWeight: "800" }}
            >
              Search
            </Text>
          </Pressable>
        </View>

        <FlatList
          ref={carouselRef}
          data={rows}
          extraData={nowMs}
          keyExtractor={({ athlete }, index) =>
            stableAthleteKey(athlete, String(index))
          }
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews={Platform.OS !== "web"}
          getItemLayout={(_, index) => ({
            length: cardStep,
            offset: cardStep * index,
            index,
          })}
          contentOffset={{ x: initialPage * cardStep, y: 0 }}
          onContentSizeChange={() => {
            const bounded = Math.max(
              0,
              Math.min(selectedIndex, rows.length - 1),
            );
            carouselRef.current?.scrollToIndex({
              index: bounded,
              animated: false,
            });
          }}
          onScrollToIndexFailed={({ index }) => {
            carouselRef.current?.scrollToOffset({
              offset: index * cardStep,
              animated: false,
            });
          }}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          directionalLockEnabled
          decelerationRate="fast"
          snapToInterval={cardStep}
          snapToAlignment="start"
          disableIntervalMomentum
          onMomentumScrollEnd={(event) => {
            const nextPage = Math.round(
              event.nativeEvent.contentOffset.x / cardStep,
            );
            const bounded = Math.max(0, Math.min(nextPage, rows.length - 1));
            setPage(bounded);
            onSelect(bounded);
          }}
          contentContainerStyle={{
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.sm,
          }}
          renderItem={({
            item: { athlete, detail, cutoffs, raceCategory },
            index,
          }) => {
            recordLivePerformance("cardRenders");
            const header = detail ? displayHeader(detail) : null;
            const name = header?.name || athlete.name;
            const bib = header?.bib || athlete.bib;
            const contest = header?.contest || athlete.category;
            const category = header?.category;
            const status = detail?.result
              ? detail.result.statusLabel || "Finished"
              : detail?.lifecycle.label ||
                header?.statusLabel ||
                "Waiting to Start";
            return (
              <View
                key={stableAthleteKey(athlete, String(index))}
                style={{
                  width: cardWidth,
                  minHeight: 112,
                  borderRadius: theme.radius.large,
                  overflow: "hidden",
                  backgroundColor: "#242424",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.14)",
                }}
              >
                <View
                  accessible
                  focusable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${name}`}
                  onStartShouldSetResponder={() => true}
                  onResponderRelease={() => onOpen(index)}
                  style={{
                    flex: 1,
                    minHeight: 205,
                    padding: theme.spacing.md,
                    paddingRight: 40,
                    gap: theme.spacing.md,
                    backgroundColor: "transparent",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: theme.spacing.sm,
                    }}
                  >
                    <Avatar
                      name={name}
                      uri={header?.photo || athlete.photoUrl}
                      colorSeed={header?.colorSeed || athlete.id}
                      size={58}
                      bordered
                    />
                    <View style={{ flex: 1, gap: 5 }}>
                      <Text
                        variant="headline"
                        style={{ color: "#FFFFFF" }}
                        numberOfLines={1}
                      >
                        {name} {header?.countryFlag || ""}
                      </Text>
                      <Text
                        variant="bodySmall"
                        style={{ color: "#E2E2E2" }}
                        numberOfLines={1}
                      >
                        {[contest, category, bib ? `Bib ${bib}` : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                      <Text
                        variant="bodySmall"
                        style={{ color: "#BDBDBD", fontWeight: "700" }}
                        numberOfLines={1}
                      >
                        {status}
                      </Text>
                    </View>
                  </View>
                  {!detail?.result &&
                  /not\s*started|waiting|awaiting\s*start/i.test(status) ? (
                    <RaceStartCountdown
                      scheduledStart={detail?.header.scheduledStart}
                      startTiming={detail?.startTiming}
                      participantUuid={athlete.participantUuid}
                      contestUuid={
                        athlete.providerContestUuid ?? athlete.contestUuid
                      }
                    />
                  ) : null}
                  <CompactRaceProgress
                    contest={contest || ""}
                    raceCategory={raceCategory || detail?.header.raceCategory}
                    raceTiming={detail?.raceTiming}
                    legLabel={detail?.raceProgress?.legLabel || status}
                    progress={detail?.raceProgress?.progress ?? 0}
                    finished={Boolean(
                      detail?.result &&
                      /finish|complete/i.test(detail.result.statusLabel),
                    )}
                    resultStatus={detail?.result?.statusLabel}
                    resultSplits={detail?.result?.splits}
                    timeline={detail?.timeline}
                    finishTime={detail?.result?.chipTime}
                    elapsedTime={
                      detail?.result?.chipTime ||
                      (() => {
                        const seconds = resolveLiveElapsedSeconds(
                          {
                            startTiming: detail?.startTiming,
                            isLive: canRunAthleteRaceClock(detail),
                          },
                          nowMs,
                        );
                        return seconds == null
                          ? undefined
                          : formatElapsedClock(seconds);
                      })()
                    }
                    clockRunning={canRunAthleteRaceClock(detail)}
                    activeCutoff={detail?.activeCutoff}
                    startTiming={detail?.startTiming}
                    predictionTrack={detail?.track}
                    waitingToStart={Boolean(
                      detail?.startTiming?.waitingForChipStart,
                    )}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Untrack ${name}`}
                  onPress={() => onRemove(index)}
                  hitSlop={8}
                  style={{
                    position: "absolute",
                    top: 7,
                    right: 7,
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(0,0,0,0.42)",
                  }}
                >
                  <Text
                    variant="headline"
                    style={{ color: "#FFFFFF", fontSize: 15, lineHeight: 16 }}
                  >
                    ×
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />
      </View>
    </View>
  );
}

function CourseMapHeader({
  title,
  notificationsEnabled,
  settingsOpen,
  onToggleNotifications,
  onToggleSettings,
}: {
  title: string;
  notificationsEnabled: boolean;
  settingsOpen: boolean;
  onToggleNotifications: () => void;
  onToggleSettings: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        top: 10,
        zIndex: 40,
        elevation: 40,
      }}
    >
      <View
        style={{
          height: 58,
          borderRadius: 20,
          paddingHorizontal: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderWidth: 1,
          borderColor: "rgba(46,116,214,0.18)",
          backgroundColor: "rgba(255,255,255,0.92)",
          ...(Platform.OS === "web"
            ? ({ boxShadow: "0 12px 24px rgba(15,23,42,0.16)" } as any)
            : {
                shadowColor: "#000",
                shadowOpacity: 0.16,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 8 },
                elevation: 10,
              }),
        }}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: "rgba(46,116,214,0.16)",
            backgroundColor: "#EFF7FF",
          }}
        >
          <Image
            source={BERGMAN_MARK}
            style={{ width: 38, height: 38 }}
            contentFit="cover"
          />
        </View>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text
            variant="caption"
            color="textMuted"
            style={{ fontWeight: "900", letterSpacing: 0.7 }}
          >
            BERGMAN
          </Text>
          <Text
            variant="headline"
            numberOfLines={1}
            style={{ maxWidth: "100%" }}
          >
            {title || "Live Tracking"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: notificationsEnabled }}
          accessibilityLabel={
            notificationsEnabled
              ? "Turn race notifications off"
              : "Turn race notifications on"
          }
          onPress={onToggleNotifications}
          style={{
            width: 38,
            height: 38,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: notificationsEnabled
              ? "rgba(46,116,214,0.12)"
              : theme.colors.surfaceSunken,
            borderWidth: 1,
            borderColor: notificationsEnabled
              ? "rgba(46,116,214,0.22)"
              : theme.colors.border,
          }}
        >
          <Icon
            name={notificationsEnabled ? "bell" : "bellOff"}
            size={18}
            color={notificationsEnabled ? "accent" : "textMuted"}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open map settings"
          onPress={onToggleSettings}
          style={{
            width: 38,
            height: 38,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: settingsOpen
              ? "rgba(0,212,255,0.14)"
              : theme.colors.surfaceSunken,
            borderWidth: 1,
            borderColor: settingsOpen
              ? "rgba(0,212,255,0.24)"
              : theme.colors.border,
          }}
        >
          <Icon
            name="settings"
            size={18}
            color={settingsOpen ? "accentSecondary" : "textMuted"}
          />
        </Pressable>
      </View>
    </View>
  );
}

function EventStatusBanner({ label }: { label: string }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        top: 76,
        zIndex: 34,
        elevation: 34,
        alignItems: "center",
      }}
    >
      <View
        style={{
          borderRadius: 999,
          paddingHorizontal: 12,
          paddingVertical: 6,
          backgroundColor: "rgba(46,116,214,0.92)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.22)",
        }}
      >
        <Text
          variant="caption"
          style={{ color: "#FFFFFF", fontWeight: "900", letterSpacing: 0.6 }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

function CompactMapAthleteCard({
  row,
  eventName,
  index,
  total,
  minimized,
  onOpen,
  onClose,
  onMinimize,
  onPrevious,
  onNext,
  onLayout,
}: {
  row: TrackedCard;
  eventName?: string;
  index: number;
  total: number;
  minimized: boolean;
  onOpen: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const detail = row.detail;
  const header = detail ? displayHeader(detail) : null;
  const name = header?.name || row.athlete.name;
  const bib = header?.bib || row.athlete.bib;
  const contest = header?.contest || row.athlete.category || "Race";
  const ageGroup = header?.category || row.athlete.ageGroup;
  const terminalResultStatus = firstText(
    detail?.result?.statusLabel,
  ).toUpperCase();
  const terminalNonFinish = ["DNF", "DNS", "DNQ", "DSQ"].includes(
    terminalResultStatus,
  );
  const finished = Boolean(
    detail?.result && /finish|complete/i.test(detail.result.statusLabel),
  );
  const statusText = firstText(
    terminalNonFinish ? terminalResultStatus : undefined,
    detail?.header.status,
    detail?.header.statusLabel,
    detail?.lifecycle.label,
    row.athlete.status,
  );
  const notStarted =
    !finished &&
    (!detail ||
      /not[\s_-]*started|waiting|awaiting|registered|upcoming/i.test(
        statusText,
      ));
  const scheduledStart = firstText(
    detail?.header.scheduledStart,
    (row.athlete as Record<string, unknown>).scheduledStart,
    (row.athlete as Record<string, unknown>).startTime,
  );
  const raceClockRunning = !terminalNonFinish && canRunAthleteRaceClock(detail);
  const canonicalElapsed = parseElapsedClock(detail?.result?.chipTime);
  const { elapsedSeconds, nowMs: raceClockNowMs } = useContinuousElapsedSeconds(
    {
      running: raceClockRunning,
      canonicalElapsedSeconds: canonicalElapsed,
      startTiming: detail?.startTiming,
    },
  );
  const timeLabel = notStarted
    ? "--:--:--"
    : detail?.result?.chipTime ||
      (elapsedSeconds != null
        ? formatElapsedClock(elapsedSeconds)
        : "--:--:--");
  const cutoffPresentation = resolveCanonicalCutoffPresentation(
    detail?.activeCutoff,
    raceClockNowMs,
  );
  const cutoffTerminal = cutoffPresentation.confirmed;
  const effectiveTerminalNonFinish = terminalNonFinish || cutoffTerminal;
  const effectiveTerminalStatus = cutoffTerminal ? "DNF" : terminalResultStatus;
  const showCutoffCountdown =
    !notStarted &&
    !finished &&
    !terminalNonFinish &&
    cutoffPresentation.remainingSeconds != null &&
    Boolean(cutoffPresentation.label);
  const pace = compactPaceLabel(
    detail?.result?.averagePace ||
      metricValue(detail?.liveStats, "Average Pace") ||
      metricValue(detail?.liveStats, "Avg Pace") ||
      metricValue(detail?.liveStats, "Pace") ||
      detail?.prediction?.paceLabel ||
      "",
  );
  const photo = resolveAthletePhoto(
    {
      email: header?.email ?? row.athlete.email,
      athleteUid: header?.athleteUid ?? row.athlete.athleteUid,
      photoUrl: header?.photo ?? row.athlete.photoUrl,
    },
    null,
  );
  const categoryLine = [
    contest,
    ageGroup && ageGroup !== contest ? ageGroup : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const canonicalProgress = finished
    ? 1
    : Math.max(0, Math.min(1, Number(detail?.raceProgress?.progress) || 0));
  const progressLabel = finished
    ? "Finished"
    : effectiveTerminalNonFinish
      ? effectiveTerminalStatus
      : notStarted
        ? "Waiting to start"
        : firstText(detail?.raceProgress?.legLabel, statusText, "On course");
  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          const horizontalDistance = Math.abs(gestureState.dx);
          const verticalDistance = Math.abs(gestureState.dy);
          const switchingAthlete =
            total > 1 &&
            horizontalDistance >= 45 &&
            horizontalDistance > verticalDistance * 1.5;
          const hidingCard =
            gestureState.dy >= 32 &&
            verticalDistance > horizontalDistance * 1.25;
          return switchingAthlete || hidingCard;
        },
        onPanResponderTerminationRequest: () => true,
        onShouldBlockNativeResponder: () => false,
        onPanResponderRelease: (_, gestureState) => {
          const horizontalDistance = Math.abs(gestureState.dx);
          const verticalDistance = Math.abs(gestureState.dy);
          const draggedDown =
            gestureState.dy >= 48 &&
            verticalDistance > horizontalDistance * 1.25;
          const flickedDown =
            gestureState.dy >= 24 &&
            gestureState.vy >= 0.65 &&
            verticalDistance > horizontalDistance;
          if (draggedDown || flickedDown) {
            onMinimize();
            return;
          }
          if (
            horizontalDistance < 45 ||
            horizontalDistance <= verticalDistance * 1.5
          )
            return;
          if (gestureState.dx < 0) onNext();
          else onPrevious();
        },
      }),
    [onMinimize, onNext, onPrevious, total],
  );

  if (minimized) {
    return (
      <View
        onLayout={onLayout}
        {...swipeResponder.panHandlers}
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: 12,
          zIndex: 52,
          elevation: 52,
          borderRadius: 18,
          padding: 10,
          gap: 8,
          backgroundColor: "rgba(31,31,33,0.97)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.14)",
          shadowColor: "#000000",
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          <Avatar
            name={name}
            uri={photo ?? header?.photo ?? row.athlete.photoUrl}
            colorSeed={row.athlete.id}
            size={36}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                color: "#FFFFFF",
                fontSize: 16,
                lineHeight: 20,
                fontWeight: "700",
              }}
            >
              {name}
            </Text>
            <Text
              variant="caption"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ color: "#C4CAD3", fontWeight: "600" }}
            >
              {[bib ? `BIB ${bib}` : "", categoryLine]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          {total > 1 ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous tracked athlete"
                onPress={onPrevious}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,255,255,0.10)",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 21 }}>‹</Text>
              </Pressable>
              <Text variant="caption" style={{ color: "#C4CAD3" }}>
                {index + 1}/{total}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next tracked athlete"
                onPress={onNext}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,255,255,0.10)",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 21 }}>›</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {notStarted ? (
          <RaceStartCountdown
            scheduledStart={scheduledStart || undefined}
            startTiming={detail?.startTiming}
            participantUuid={row.athlete.participantUuid}
            contestUuid={
              row.athlete.providerContestUuid ?? row.athlete.contestUuid
            }
          />
        ) : (
          <View
            style={{
              minHeight: 48,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 11,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: "rgba(255,255,255,0.07)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.14)",
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 7 }}
            >
              <Icon name="clock" size={17} colorValue="#FFFFFF" />
              <View>
                <Text variant="caption" style={{ color: "#C4CAD3" }}>
                  {finished
                    ? "FINISH TIME"
                    : effectiveTerminalNonFinish
                      ? effectiveTerminalStatus
                      : "LIVE ELAPSED"}
                </Text>
                <Text
                  variant="headline"
                  style={{ color: "#FFFFFF", fontSize: 18 }}
                >
                  {timeLabel}
                </Text>
              </View>
            </View>
            {pace ? (
              <Text variant="bodySmall" style={{ color: "#D1D5DB" }}>
                {pace}
              </Text>
            ) : null}
          </View>
        )}

        <CompactRaceProgress
          contest={contest}
          raceCategory={row.raceCategory || detail?.header.raceCategory}
          raceTiming={detail?.raceTiming}
          legLabel={
            cutoffTerminal
              ? "CUTOFF"
              : detail?.raceProgress?.legLabel || progressLabel
          }
          progress={canonicalProgress}
          finished={finished}
          resultStatus={cutoffTerminal ? "DNF" : detail?.result?.statusLabel}
          resultSplits={detail?.result?.splits}
          timeline={detail?.timeline}
          finishTime={detail?.result?.chipTime}
          elapsedTime={notStarted ? undefined : timeLabel}
          clockRunning={raceClockRunning && !cutoffTerminal}
          activeCutoff={detail?.activeCutoff}
          startTiming={detail?.startTiming}
          predictionTrack={detail?.track}
          waitingToStart={notStarted}
        />
      </View>
    );
  }

  return (
    <View
      onLayout={onLayout}
      {...swipeResponder.panHandlers}
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 52,
        elevation: 52,
        borderRadius: 20,
        padding: 14,
        gap: 12,
        backgroundColor: "rgba(31,31,33,0.97)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        shadowColor: "#000000",
        shadowOpacity: 0.3,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hide athlete card"
        accessibilityHint="Tap or drag down to hide the card"
        onPress={onMinimize}
        hitSlop={10}
        style={{
          width: 44,
          height: 12,
          alignSelf: "center",
          marginTop: -6,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 44,
            height: 5,
            borderRadius: 999,
            backgroundColor: "#E11D48",
          }}
        />
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open live tracking for ${name}`}
          onPress={onOpen}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Avatar
            name={name}
            uri={photo ?? header?.photo ?? row.athlete.photoUrl}
            colorSeed={row.athlete.id}
            size={58}
          />
          <View style={{ flex: 1, gap: 3 }}>
            <Text
              variant="headline"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                color: "#FFFFFF",
                fontSize: 16,
                lineHeight: 20,
                fontWeight: "700",
              }}
            >
              {name}
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
                minWidth: 0,
              }}
            >
              {bib ? (
                <View
                  style={{
                    flexShrink: 0,
                    borderRadius: 999,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    backgroundColor: "rgba(255,255,255,0.18)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.34)",
                  }}
                >
                  <Text
                    variant="caption"
                    style={{
                      color: "#FFFFFF",
                      fontSize: 12,
                      lineHeight: 15,
                      fontWeight: "800",
                    }}
                  >
                    BIB {bib}
                  </Text>
                </View>
              ) : null}
              <Text
                variant="bodySmall"
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{
                  minWidth: 0,
                  flex: 1,
                  color: "#D1D5DB",
                  fontSize: 15,
                  lineHeight: 19,
                  fontWeight: "500",
                }}
              >
                {categoryLine}
              </Text>
            </View>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Share ${name} tracking`}
          onPress={() => {
            void Share.share({
              message: `${name}${bib ? ` · Bib ${bib}` : ""}${eventName ? ` · ${eventName}` : ""}\n${finished ? `Finish time: ${timeLabel}` : effectiveTerminalNonFinish ? `${effectiveTerminalStatus}: ${timeLabel}` : notStarted ? "Race not started" : `Live elapsed: ${timeLabel}`}`,
            });
          }}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.10)",
          }}
        >
          <Icon name="share" size={19} colorValue="#FFFFFF" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Untrack ${name}`}
          onPress={onClose}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.45)",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 24, lineHeight: 25 }}>
            ×
          </Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${name} race progress details`}
        onPress={onOpen}
      >
        <CompactRaceProgress
          contest={contest}
          raceCategory={row.raceCategory || detail?.header.raceCategory}
          raceTiming={detail?.raceTiming}
          legLabel={
            cutoffTerminal
              ? "CUTOFF"
              : detail?.raceProgress?.legLabel || progressLabel
          }
          progress={canonicalProgress}
          finished={finished}
          resultStatus={cutoffTerminal ? "DNF" : detail?.result?.statusLabel}
          resultSplits={detail?.result?.splits}
          timeline={detail?.timeline}
          finishTime={detail?.result?.chipTime}
          elapsedTime={notStarted ? undefined : timeLabel}
          clockRunning={raceClockRunning && !cutoffTerminal}
          activeCutoff={detail?.activeCutoff}
          startTiming={detail?.startTiming}
          predictionTrack={detail?.track}
          waitingToStart={notStarted}
        />
      </Pressable>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous tracked athlete"
          accessibilityState={{ disabled: total < 2 }}
          disabled={total < 2}
          onPress={onPrevious}
          hitSlop={8}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.10)",
            opacity: total < 2 ? 0.4 : 1,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 25, lineHeight: 28 }}>
            ‹
          </Text>
        </Pressable>
        {notStarted ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${name} start time details`}
            onPress={onOpen}
            style={{ flex: 1, minWidth: 0 }}
          >
            <RaceStartCountdown
              scheduledStart={scheduledStart || undefined}
              startTiming={detail?.startTiming}
            />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${name} live timing details`}
            onPress={onOpen}
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              minHeight: 58,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.14)",
              backgroundColor: "rgba(255,255,255,0.07)",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
                flex: 1,
                minWidth: 0,
              }}
            >
              <Icon name="clock" size={18} colorValue="#FFFFFF" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodySmall" style={{ color: "#D1D5DB" }}>
                  {finished
                    ? "Finish Time"
                    : effectiveTerminalNonFinish
                      ? effectiveTerminalStatus
                      : "Live Elapsed"}
                </Text>
                <Text
                  variant="headline"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.62}
                  style={{
                    color: "#FFFFFF",
                    fontSize: 18,
                    width: "100%",
                    flexShrink: 1,
                  }}
                >
                  {timeLabel}
                </Text>
                {showCutoffCountdown ? (
                  <Text
                    variant="caption"
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    style={{
                      color:
                        cutoffPresentation.confirmed ||
                        (cutoffPresentation.remainingSeconds ?? 1) <= 0
                          ? "#FF8A98"
                          : "#F4C56A",
                      fontWeight: "900",
                      width: "100%",
                      flexShrink: 1,
                    }}
                  >
                    {detail?.activeCutoff?.checkpointLabel.toUpperCase()} ·{" "}
                    {cutoffPresentation.label}
                  </Text>
                ) : null}
              </View>
            </View>
            {pace ? (
              <Text
                variant="body"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                style={{
                  color: "#D1D5DB",
                  textAlign: "right",
                  flexShrink: 1,
                  maxWidth: "40%",
                }}
              >
                {pace}
              </Text>
            ) : null}
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next tracked athlete"
          accessibilityState={{ disabled: total < 2 }}
          disabled={total < 2}
          onPress={onNext}
          hitSlop={8}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.10)",
            opacity: total < 2 ? 0.4 : 1,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 25, lineHeight: 28 }}>
            ›
          </Text>
        </Pressable>
      </View>
      {total > 1 ? (
        <Text
          variant="caption"
          style={{ color: "#9CA3AF", textAlign: "center", marginTop: -5 }}
        >
          {index + 1} of {total} tracked athletes
        </Text>
      ) : null}
    </View>
  );
}

function MapSettingsToggle({
  label,
  value,
  onPress,
}: {
  label: string;
  value: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        paddingVertical: 6,
      }}
    >
      <Text
        variant="bodySmall"
        color="textSecondary"
        style={{ fontWeight: "800", flex: 1 }}
      >
        {label}
      </Text>
      <View
        style={{
          width: 42,
          height: 24,
          borderRadius: 999,
          padding: 2,
          backgroundColor: value
            ? theme.colors.accent
            : theme.colors.surfaceSunken,
          borderWidth: 1,
          borderColor: value ? theme.colors.accent : theme.colors.border,
        }}
      >
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: theme.colors.surface,
            alignSelf: value ? "flex-end" : "flex-start",
          }}
        />
      </View>
    </Pressable>
  );
}

function metricValue(
  items: { label: string; value: string }[] | undefined,
  label: string,
): string {
  return firstText(
    items?.find((item) => item.label.toLowerCase() === label.toLowerCase())
      ?.value,
  );
}

function compactPaceLabel(value: string): string | null {
  const normalized = firstText(value);
  if (!normalized || normalized === "—" || /^-+(?::-+)*$/.test(normalized))
    return null;
  // A provider zero clock is elapsed-time fallback data, not a pace. Showing
  // it beside Live Elapsed creates an unexplained second race clock.
  if (/^0{1,2}:00(?::00)?$/.test(normalized)) return null;
  return normalized;
}

export function eventStatusLabel(
  status?: string,
  trackedCount = 0,
  hasOnCourseAthlete = false,
): string {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "finished") return "EVENT COMPLETE · RESULTS PROVISIONAL";
  if (normalized === "live")
    return trackedCount > 0 && hasOnCourseAthlete
      ? "LIVE · ATHLETES ON COURSE"
      : "LIVE TRACKING";
  if (normalized === "upcoming" || normalized === "scheduled")
    return "RACE NOT STARTED";
  if (normalized === "results") return "OFFICIAL RESULTS PUBLISHED";
  return trackedCount > 0 ? "TRACKING · WATCHLIST ACTIVE" : "LIVE TRACKING";
}

function indiaDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function raceDateKey(value: unknown): string | null {
  const raw = firstText(value);
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/)?.[1];
  if (isoDate) return isoDate;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : indiaDateKey(new Date(parsed));
}

function scheduledRaceFamilyToday(schedule: unknown): string | null {
  if (!Array.isArray(schedule)) return null;
  const today = indiaDateKey();
  const disciplines = schedule.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (firstText(row.date, row.eventDate, row.raceDate) !== today) return [];
    const values = row.disciplines ?? row.events ?? row.categories;
    return Array.isArray(values) ? values.map((value) => firstText(value)) : [];
  });
  const raceDisciplines = disciplines.filter(
    (value) => !isAgeGroupLabel(value),
  );
  const hasSwimathon = raceDisciplines.some((value) =>
    value.toLowerCase().includes("swimathon"),
  );
  const hasTriathlon = raceDisciplines.some((value) =>
    /triathlon|relay/i.test(value),
  );
  if (hasSwimathon && hasTriathlon) return "SWIMATHON & TRIATHLON";
  if (hasSwimathon) return "SWIMATHON";
  if (hasTriathlon) return "TRIATHLON";
  return raceDisciplines[0]?.toUpperCase() || null;
}

function hasRaceScheduledToday(schedule: unknown): boolean {
  if (!Array.isArray(schedule)) return false;
  const today = indiaDateKey();
  return schedule.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return firstText(row.date, row.eventDate, row.raceDate) === today;
  });
}

function isAgeGroupLabel(value: unknown): boolean {
  const label = firstText(value).toLowerCase();
  if (!label) return false;
  return (
    /^(?:age\s*group\s*)?(?:under\s*)?\d+\s*(?:-|to|and under|and above|\+|above)?\s*\d*$/.test(
      label,
    ) || /^(?:above|under)\s+\d+$/.test(label)
  );
}

function SelectedAthletePanel({
  row,
  eventName,
  index,
  total,
  expanded,
  onPrevious,
  onNext,
  onExpand,
  onViewMap,
  onRemove,
}: {
  row?: TrackedCard;
  eventName?: string;
  index: number;
  total: number;
  expanded: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onExpand: () => void;
  onViewMap: () => void;
  onRemove: () => void;
}) {
  recordLivePerformance("modalRenders");
  const theme = useTheme();
  const liveElapsed = useOfficialRaceElapsedLabel(row?.detail);
  useEffect(() => {
    if (!row?.detail || !isLiveDiagnosticsEnabled) return;
    console.debug("[prediction-runtime][CARD]", {
      bib: row.detail.header.bib,
      status: row.detail.header.status,
      hasResult: Boolean(row.detail.result),
      predictionState: row.detail.predictionState,
      renderedPrediction:
        row.detail.header.status !== "finished" &&
        row.detail.predictionState?.suppressed !== true,
    });
  }, [row?.detail]);
  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          const horizontalDistance = Math.abs(gestureState.dx);
          const verticalDistance = Math.abs(gestureState.dy);
          return (
            total > 1 &&
            horizontalDistance >= 45 &&
            horizontalDistance > verticalDistance * 1.5
          );
        },
        onPanResponderTerminationRequest: () => true,
        onShouldBlockNativeResponder: () => false,
        onPanResponderRelease: (_, gestureState) => {
          const horizontalDistance = Math.abs(gestureState.dx);
          const verticalDistance = Math.abs(gestureState.dy);
          if (
            horizontalDistance < 45 ||
            horizontalDistance <= verticalDistance * 1.5
          )
            return;
          if (gestureState.dx < 0) onNext();
          else onPrevious();
        },
      }),
    [onNext, onPrevious, total],
  );
  if (!row) {
    return (
      <EmptyState
        title="No athletes tracked"
        description="You aren’t tracking any athletes yet. Search for an athlete to start tracking."
      />
    );
  }

  const { athlete, detail, raceCategory } = row;
  if (row.initialLoading) {
    return (
      <View style={{ gap: theme.spacing.sm }}>
        <Card
          accessibilityLabel="Loading live tracking"
          style={{
            backgroundColor: "#242424",
            borderColor: "rgba(255,255,255,0.10)",
            gap: 12,
          }}
        >
          <Text variant="headline" style={{ color: "#FFFFFF" }}>
            Loading live tracking…
          </Text>
          <Text variant="bodySmall" style={{ color: "#C4CAD3" }}>
            Assembling athlete, course, official timing, rankings, and map data.
          </Text>
          <Skeleton height={18} radius={9} />
          <Skeleton height={90} radius={14} />
          <Skeleton height={160} radius={14} />
        </Card>
      </View>
    );
  }
  if (!detail || row.timingUnavailable) {
    return (
      <View style={{ gap: theme.spacing.sm }}>
        <View
          {...swipeResponder.panHandlers}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Button
            label="‹"
            variant="ghost"
            size="sm"
            disabled={total < 2}
            onPress={onPrevious}
          />
          <View
            style={{
              width: 104,
              height: 5,
              borderRadius: 999,
              backgroundColor: theme.colors.border,
            }}
          />
          <Button
            label="›"
            variant="ghost"
            size="sm"
            disabled={total < 2}
            onPress={onNext}
          />
        </View>
        <Card
          style={{
            backgroundColor: "#202020",
            borderColor: "rgba(255,255,255,0.08)",
            gap: theme.spacing.md,
            shadowOpacity: 0.14,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Avatar
              name={athlete.name}
              uri={athlete.photoUrl}
              size={58}
              bordered
            />
            <View style={{ flex: 1, gap: 3 }}>
              <Text variant="headline" style={{ color: "#FFFFFF" }}>
                {athlete.name || `Bib ${athlete.bib}`}
              </Text>
              <Text variant="bodySmall" style={{ color: "#D2D2D2" }}>
                {[athlete.category, `Bib ${athlete.bib}`]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <Button label="×" variant="ghost" size="sm" onPress={onRemove} />
          </View>
          <Text variant="label" style={{ color: "#FFFFFF" }}>
            {row.timingUnavailable
              ? "Timing configuration pending"
              : "Awaiting start"}
          </Text>
          <Text variant="caption" style={{ color: "#9FA6B2" }}>
            {row.timingUnavailable
              ? "Live race flow will appear after this event’s timing build is published."
              : "Live timing details are updating in the background."}
          </Text>
          {!row.timingUnavailable ? (
            <CompactRaceProgress
              contest={athlete.category || ""}
              raceCategory={raceCategory}
              raceTiming={detail?.raceTiming}
              legLabel="Not Started"
              progress={0}
            />
          ) : null}
        </Card>
      </View>
    );
  }

  if (detail.isPrivate) {
    return (
      <View style={{ gap: theme.spacing.sm }}>
        <EmptyState
          title="Tracking unavailable"
          description="This athlete uses Anonymous live tracking and is hidden from public athlete details."
        />
        <Button label="Untrack" size="sm" variant="ghost" onPress={onRemove} />
      </View>
    );
  }

  const header = displayHeader(detail);
  const finished = detail.header.status === "finished";
  const terminalOutcome =
    finished ||
    Boolean(
      detail.result &&
      /\b(?:dnf|dns|dnq|dsq)\b/i.test(detail.result.statusLabel),
    );
  const { clockRunning: raceClockRunning, elapsedTime: finishTime } =
    liveElapsed;
  const averagePace =
    detail.result?.averagePace ||
    metricValue(detail.liveStats, "Average Pace") ||
    metricValue(detail.liveStats, "Average Speed") ||
    metricValue(detail.liveStats, "Current Speed");
  const status = terminalOutcome
    ? detail.result?.statusLabel || (finished ? "Finished" : header.statusLabel)
    : header.statusLabel || "Tracking";
  const resolvedHeaderPhoto =
    resolveAthletePhoto(
      {
        email: row?.athlete.email ?? header.email,
        athleteUid: row?.athlete.athleteUid ?? header.athleteUid,
        photoUrl: header.photo ?? row?.athlete.photoUrl,
      },
      null,
    ) ?? header.photo;
  const resolvedHeader = { ...header, photo: resolvedHeaderPhoto };
  const isNotStarted =
    !terminalOutcome &&
    (detail.header.status === "notStarted" ||
      /not\s*started|waiting|awaiting\s*start/i.test(
        detail.lifecycle.label || header.statusLabel || "",
      ));

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        {...swipeResponder.panHandlers}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Button
          label="‹"
          variant="ghost"
          size="sm"
          disabled={total < 2}
          onPress={onPrevious}
        />
        <View style={{ alignItems: "center", gap: 5 }}>
          <View
            style={{
              width: 104,
              height: 5,
              borderRadius: 999,
              backgroundColor: "#FFFFFF",
            }}
          />
          <Text
            variant="caption"
            style={{ color: "#D4D4D4", fontWeight: "800" }}
          >
            {index + 1} / {total}
          </Text>
        </View>
        <Button
          label="›"
          variant="ghost"
          size="sm"
          disabled={total < 2}
          onPress={onNext}
        />
      </View>

      <Card
        onPress={expanded ? undefined : onExpand}
        style={{
          backgroundColor: "#242424",
          borderColor: "rgba(255,255,255,0.10)",
          gap: theme.spacing.md,
          shadowOpacity: 0.18,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              expanded ? "Hide details" : "Show athlete details"
            }
            onPress={onExpand}
            hitSlop={8}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 2,
            }}
          >
            <Text
              variant="caption"
              style={{ color: "#FFFFFF", fontWeight: "900" }}
            >
              {expanded ? "Hide" : "Details"}
            </Text>
            <Icon
              name={expanded ? "chevronDown" : "chevronDown"}
              size={14}
              colorValue="#FFFFFF"
            />
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Badge
              label={status}
              variant={
                /\b(dnf|dns|dnq|dsq)\b/i.test(status)
                  ? "danger"
                  : finished
                    ? "finished"
                    : "neutral"
              }
            />
            {row.refreshing ? (
              <Text variant="caption" style={{ color: "#9FA6B2" }}>
                Refreshing…
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Untrack ${header.name}`}
              onPress={(event) => {
                event.stopPropagation();
                onRemove();
              }}
              hitSlop={8}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(225,18,42,0.14)",
                borderWidth: 1,
                borderColor: "rgba(225,18,42,0.42)",
              }}
            >
              <Text
                variant="headline"
                style={{ color: "#FF4D5E", fontSize: 17, lineHeight: 18 }}
              >
                ×
              </Text>
            </Pressable>
          </View>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.md,
          }}
        >
          <Avatar
            name={resolvedHeader.name}
            uri={resolvedHeader.photo}
            colorSeed={resolvedHeader.colorSeed || resolvedHeader.bib}
            size={68}
            bordered
          />
          <View style={{ flex: 1, gap: 6 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <Text
                variant="title"
                style={{ color: "#FFFFFF", flexShrink: 1 }}
                numberOfLines={2}
              >
                {header.name}
              </Text>
              {header.countryFlag ? (
                <Text variant="headline" style={{ color: "#FFFFFF" }}>
                  {header.countryFlag}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {[
                `BIB: ${header.bib || "—"}`,
                header.category ? `AGE GROUP: ${header.category}` : null,
              ]
                .filter((label): label is string => Boolean(label))
                .map((label) => (
                  <View
                    key={label}
                    style={{
                      alignSelf: "flex-start",
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: "rgba(255,255,255,0.14)",
                    }}
                  >
                    <Text
                      variant="label"
                      style={{ color: "#FFFFFF", fontWeight: "900" }}
                    >
                      {label}
                    </Text>
                  </View>
                ))}
            </View>
            {header.contest ? (
              <Text
                variant="bodySmall"
                style={{ color: "#D2D2D2" }}
                numberOfLines={2}
              >
                Contest: {header.contest}
              </Text>
            ) : null}
            {header.club ? (
              <View
                style={{
                  alignSelf: "flex-start",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 7,
                  maxWidth: "100%",
                  paddingHorizontal: 11,
                  paddingVertical: 7,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "rgba(61,214,140,0.46)",
                  backgroundColor: "rgba(61,214,140,0.14)",
                }}
              >
                <Icon name="medal" size={15} colorValue="#3DD68C" />
                <Text
                  variant="caption"
                  numberOfLines={2}
                  style={{
                    flexShrink: 1,
                    color: "#B8F7D8",
                    fontWeight: "900",
                    letterSpacing: 0.2,
                  }}
                >
                  Proudly representing {header.club}
                </Text>
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show athlete on map"
            onPress={onViewMap}
            hitSlop={8}
            style={{
              width: 38,
              height: 38,
              borderRadius: 13,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.10)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.16)",
            }}
          >
            <Icon name="location" size={18} colorValue="#FFFFFF" />
          </Pressable>
        </View>

        {!expanded ? (
          <View style={{ gap: 4 }}>
            <Text
              variant="bodySmall"
              style={{ color: "#FFFFFF", fontWeight: "800" }}
            >
              {isNotStarted
                ? "Awaiting start"
                : terminalOutcome
                  ? "Finish Time"
                  : "Current Time"}{" "}
              {isNotStarted ? "" : finishTime || "—"}
            </Text>
            {!isNotStarted ? (
              <Text variant="bodySmall" style={{ color: "#FFFFFF" }}>
                {averagePace ||
                  detail.header.statusLabel ||
                  "Awaiting timing data"}
              </Text>
            ) : null}
          </View>
        ) : null}

        {isNotStarted ? (
          <RaceStartCountdown
            scheduledStart={header.scheduledStart}
            startTiming={detail.startTiming}
            participantUuid={row.athlete.participantUuid}
            contestUuid={
              row.athlete.providerContestUuid ?? row.athlete.contestUuid
            }
          />
        ) : null}

        {!isNotStarted && !terminalOutcome ? (
          <CompactLiveTimingSummary detail={detail} />
        ) : null}

        {!expanded || !terminalOutcome ? (
          <CompactRaceProgress
            contest={header.contest || row.athlete.category || ""}
            raceCategory={raceCategory || header.raceCategory}
            raceTiming={detail.raceTiming}
            legLabel={detail.raceProgress?.legLabel || status}
            progress={detail.raceProgress?.progress ?? 0}
            finished={finished}
            resultStatus={detail.result?.statusLabel}
            resultSplits={detail.result?.splits}
            timeline={detail.timeline}
            finishTime={detail.result?.chipTime}
            elapsedTime={finishTime}
            clockRunning={raceClockRunning}
            activeCutoff={detail.activeCutoff}
            startTiming={detail.startTiming}
            predictionTrack={detail.track}
            waitingToStart={Boolean(detail.startTiming?.waitingForChipStart)}
          />
        ) : null}

        {expanded ? (
          <View style={{ gap: theme.spacing.sm }}>
            {terminalOutcome && detail.result ? (
              <OfficialResultsCard
                header={header}
                result={detail.result}
                eventName={eventName}
              />
            ) : (
              <>
                <TimelineCard
                  splits={detail.timeline}
                  contest={[header.contest, row.athlete.category]
                    .filter(Boolean)
                    .join(" ")}
                  raceCategory={[
                    raceCategory,
                    header.raceCategory,
                    ...(detail.raceTiming?.sections ?? [])
                      .filter((section) => section.type === "leg")
                      .flatMap((section) => [section.legType, section.title]),
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  legLabel={
                    detail.raceTiming?.sections.find(
                      (section) => section.status === "in_progress",
                    )?.title ??
                    detail.raceTiming?.sections.find(
                      (section) => section.type === "leg",
                    )?.title ??
                    detail.raceProgress?.legLabel
                  }
                  notStarted={isNotStarted}
                  finished={detail.hasOfficialResults}
                  participantUuid={detail.participantUuid}
                  canonicalVersion={detail.canonicalVersion}
                  status={detail.header.status}
                />
                {detail.header.status !== "finished" &&
                detail.predictionState?.suppressed !== true &&
                (detail.prediction ||
                  detail.nextSplit ||
                  detail.predictedCheckpoints?.length) ? (
                  <PredictionCard
                    nextSplit={detail.nextSplit}
                    projected={detail.prediction}
                    checkpoints={detail.predictedCheckpoints}
                    predictionState={detail.predictionState}
                    bib={detail.header.bib}
                  />
                ) : null}
                {detail.rankings.length > 0 ? (
                  <RankingCard rankings={detail.rankings} />
                ) : null}
                {detail.courseOverview.length > 0 ? (
                  <CourseOverviewCard items={detail.courseOverview} />
                ) : null}
                {detail.cutoffs.length > 0 ? (
                  <CutoffCard
                    cutoffs={detail.cutoffs}
                    status={detail.livePosition?.cutoffStatus}
                  />
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function parseElapsedClock(value?: string): number | null {
  const parts = String(value ?? "")
    .trim()
    .split(":")
    .map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN))
    return null;
  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return hours * 3600 + minutes * 60 + seconds;
}

function formatElapsedClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function canRunAthleteRaceClock(detail?: AthleteDetailViewModel): boolean {
  return Boolean(
    detail &&
    detail.header.status === "live" &&
    resolveLiveTimingAnchorMs({ startTiming: detail.startTiming }) != null,
  );
}

function useContinuousElapsedSeconds({
  running,
  canonicalElapsedSeconds,
  startTiming,
}: {
  running: boolean;
  canonicalElapsedSeconds: number | null;
  startTiming?: AthleteDetailViewModel["startTiming"];
}) {
  const clock = useLiveElapsedClock({ startTiming, isLive: running });
  return {
    elapsedSeconds:
      clock.elapsedSeconds ?? (!running ? canonicalElapsedSeconds : null),
    nowMs: clock.nowMs,
  };
}

/** The card, rail, and map sheet must all show the same accepted race clock. */
function useOfficialRaceElapsedLabel(detail?: AthleteDetailViewModel): {
  clockRunning: boolean;
  elapsedTime?: string;
} {
  const clockRunning = canRunAthleteRaceClock(detail);
  const { elapsedSeconds } = useContinuousElapsedSeconds({
    running: clockRunning,
    canonicalElapsedSeconds: null,
    startTiming: detail?.startTiming,
  });

  return {
    clockRunning,
    elapsedTime:
      detail?.header.status === "notStarted"
        ? undefined
        : detail?.result?.chipTime
          ? detail.result.chipTime
          : elapsedSeconds != null
            ? formatElapsedClock(elapsedSeconds)
            : undefined,
  };
}

function CompactLiveTimingSummary({
  detail,
}: {
  detail?: AthleteDetailViewModel;
}) {
  if (!detail) return null;
  return <CompactLiveTimingSummaryContent detail={detail} />;
}

function CompactLiveTimingSummaryContent({
  detail,
}: {
  detail: AthleteDetailViewModel;
}) {
  const [activeMetric, setActiveMetric] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );
  const [pauseUntil, setPauseUntil] = useState(0);
  const metricTranslateX = useSharedValue(0);
  const metricOpacity = useSharedValue(1);
  const timeline = detail?.timeline ?? [];
  const reachedRows = timeline.filter((row) => {
    const elapsed = parseElapsedClock(row.elapsedTimeLabel || row.timeLabel);
    return row.state !== "upcoming" && elapsed != null;
  });
  const lastReached = reachedRows[reachedRows.length - 1];
  const lastIndex = lastReached ? timeline.indexOf(lastReached) : -1;
  const nextRow =
    lastIndex >= 0
      ? timeline
          .slice(lastIndex + 1)
          .find(
            (row) =>
              row.state === "upcoming" ||
              parseElapsedClock(row.elapsedTimeLabel || row.timeLabel) == null,
          )
      : timeline[0];
  const running = canRunAthleteRaceClock(detail);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const motionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    const appSubscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
    });
    return () => {
      mounted = false;
      motionSubscription.remove();
      appSubscription.remove();
    };
  }, []);

  const completedElapsed =
    parseElapsedClock(detail.result?.chipTime) ??
    detail.raceTiming?.overallTimeSeconds ??
    parseElapsedClock(lastReached?.elapsedTimeLabel || lastReached?.timeLabel);
  const canonicalLiveElapsed = completedElapsed;
  const { elapsedSeconds: continuousElapsedSeconds } =
    useContinuousElapsedSeconds({
      running,
      canonicalElapsedSeconds: canonicalLiveElapsed,
      startTiming: detail.startTiming,
    });
  const elapsedSeconds = continuousElapsedSeconds ?? completedElapsed ?? 0;
  const predictedElapsed = parseElapsedClock(
    detail.nextSplit?.estimatedRaceElapsed,
  );
  const canonicalEtaRemaining = parseElapsedClock(
    detail.nextSplit?.estimatedRemaining,
  );
  const etaRemaining =
    canonicalEtaRemaining != null
      ? canonicalEtaRemaining
      : predictedElapsed != null
        ? Math.max(0, predictedElapsed - elapsedSeconds)
        : null;
  const coveredLabel =
    detail.raceProgress?.coveredLabel?.replace(/\s+done$/i, "") || "—";
  const remainingValue = Number(
    detail.raceProgress?.remainingLabel?.match(/[\d.]+/)?.[0],
  );
  const coveredValue = Number(coveredLabel.match(/[\d.]+/)?.[0]);
  // The interpolation seed is anchored to official cumulative race elapsed,
  // not to the time this component happened to render. That keeps movement
  // continuous across polling/re-renders and re-anchors immediately when a
  // newer official split (for example Run Start) arrives.
  const trackElapsedSeconds = detail.track
    ? Math.max(0, elapsedSeconds - detail.track.seed.anchorTimeSec)
    : 0;
  const locallyEstimatedDistance = detail.track
    ? estimatedDistanceKm(detail.track.seed, trackElapsedSeconds)
    : null;
  const displayedCoveredValue = Math.max(
    Number.isFinite(coveredValue) ? coveredValue : 0,
    locallyEstimatedDistance ?? 0,
  );
  const totalValue =
    detail.track?.totalKm && detail.track.totalKm > 0
      ? detail.track.totalKm
      : Number.isFinite(coveredValue) && Number.isFinite(remainingValue)
        ? coveredValue + remainingValue
        : null;
  const displayedProgress =
    totalValue && totalValue > 0
      ? `${Math.min(100, Math.max(0, (displayedCoveredValue / totalValue) * 100)).toFixed(0)}%`
      : detail.raceProgress?.percentLabel || "—";
  const predictedFinish =
    detail.prediction?.estimatedTimeOfDay ||
    detail.nextSplit?.estimatedTimeOfDay ||
    "Waiting for split";
  const finished = Boolean(
    detail.result && /finish|complete/i.test(detail.result.statusLabel),
  );
  const notStarted = !finished && detail.header.status !== "live";
  const nextName =
    detail.nextSplit?.checkpoint || nextRow?.splitLabel || nextRow?.name || "—";
  const remainingLabel =
    detail.nextSplit?.remaining || detail.raceProgress?.remainingLabel || "—";
  const projectedDuration = detail.prediction?.estimatedRaceElapsed;
  const lastSplitName = lastReached?.splitLabel || lastReached?.name || "START";
  const lastSplitElapsed =
    lastReached?.elapsedTimeLabel || lastReached?.timeLabel || "—";
  const averagePace =
    detail.result?.averagePace ||
    metricValue(detail.liveStats, "Average Pace") ||
    metricValue(detail.liveStats, "Avg Pace") ||
    detail.prediction?.paceLabel ||
    "—";
  const startTiming = detail.startTiming;
  const waitingForChipStart = Boolean(startTiming?.waitingForChipStart);
  const officialTimingMode = startTiming?.officialTimingMode ?? "GUN";
  const metrics = finished
    ? [
        {
          label: "FINISH TIME",
          value: detail.result?.chipTime || formatElapsedClock(elapsedSeconds),
          secondary: "OFFICIAL",
        },
        {
          label: "FINISHED",
          value: detail.result?.finishTimeOfDay || "—",
          secondary: "TIME OF DAY",
        },
        {
          label: "DISTANCE",
          value:
            totalValue != null ? `${totalValue.toFixed(2)} KM` : coveredLabel,
          secondary: "OFFICIAL",
        },
        { label: "OVERALL PACE", value: averagePace, secondary: "FINAL" },
        {
          label: "OVERALL",
          value: metricValue(detail.rankings, "Overall") || "—",
          secondary: metricValue(detail.rankings, "Age Group")
            ? `AGE GROUP ${metricValue(detail.rankings, "Age Group")}`
            : "FINAL RANK",
        },
      ]
    : notStarted
      ? [
          {
            label: "STATUS",
            value: waitingForChipStart ? "WAITING TO START" : "NOT STARTED",
            secondary: waitingForChipStart
              ? "WAITING FOR CHIP START"
              : "WAITING FOR START",
          },
          {
            label: "GUN START",
            value: startTiming?.gunStartLabel || "—",
            secondary: "EVENT CLOCK · INFORMATIONAL",
          },
          {
            label: "START TYPE",
            value:
              officialTimingMode === "CHIP" ? "CHIP START" : officialTimingMode,
            secondary: "FIRST VALID MAT PASSAGE",
          },
          { label: "NEXT", value: "START", secondary: "CHECKPOINT" },
        ]
      : [
          {
            label:
              officialTimingMode === "CHIP" ? "NET TIME" : "OFFICIAL RACE TIME",
            value: formatElapsedClock(elapsedSeconds),
            secondary: "LIVE",
          },
          ...(officialTimingMode === "CHIP" && startTiming?.chipStartLabel
            ? [
                {
                  label: "CHIP START",
                  value: startTiming.chipStartLabel,
                  secondary: "ACCEPTED START MAT",
                },
              ]
            : []),
          {
            label: "LAST SPLIT",
            value: lastSplitName,
            secondary: lastSplitElapsed,
          },
          {
            label: "NEXT",
            value: nextName,
            secondary:
              etaRemaining != null
                ? `ETA IN ${formatElapsedClock(etaRemaining)}`
                : remainingLabel,
          },
          {
            label: "EST. FINISH",
            value: predictedFinish,
            secondary: projectedDuration || "WAITING FOR SPLIT",
          },
          {
            label: "DISTANCE · EST.",
            value:
              totalValue != null
                ? `${displayedCoveredValue.toFixed(2)} / ${totalValue.toFixed(2)} KM`
                : coveredLabel,
            secondary: displayedProgress,
          },
        ];

  const metricCount = metrics.length;
  const safeActiveMetric = Math.min(activeMetric, Math.max(0, metricCount - 1));

  useEffect(() => {
    if (!appActive || reduceMotion || metricCount < 2) return undefined;
    const timer = setInterval(() => {
      if (Date.now() < pauseUntil) return;
      setActiveMetric((current) => (current + 1) % metricCount);
    }, 3_500);
    return () => clearInterval(timer);
  }, [appActive, metricCount, pauseUntil, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      metricTranslateX.value = 0;
      metricOpacity.value = 1;
      return;
    }
    metricTranslateX.value = 18;
    metricOpacity.value = 0.65;
    metricTranslateX.value = withTiming(0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
    metricOpacity.value = withTiming(1, { duration: 260 });
  }, [metricOpacity, metricTranslateX, reduceMotion, safeActiveMetric]);

  const metricAnimatedStyle = useAnimatedStyle(() => ({
    opacity: metricOpacity.value,
    transform: [{ translateX: metricTranslateX.value }],
  }));
  const selectMetric = useCallback(
    (index: number) => {
      setPauseUntil(Date.now() + 5_000);
      setActiveMetric((index + metricCount) % metricCount);
    },
    [metricCount],
  );
  const metricSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 18 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx < -30) selectMetric(safeActiveMetric + 1);
          else if (gesture.dx > 30) selectMetric(safeActiveMetric - 1);
        },
      }),
    [safeActiveMetric, selectMetric],
  );
  const metric = metrics[safeActiveMetric] ?? metrics[0];

  return (
    <View
      {...metricSwipeResponder.panHandlers}
      accessibilityLabel={`${metric?.label || "Live metric"}: ${metric?.value || "Unavailable"}`}
      style={{
        height: 112,
        justifyContent: "center",
        alignItems: "center",
        gap: 9,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={[
          { alignItems: "center", justifyContent: "center", gap: 3 },
          metricAnimatedStyle,
        ]}
      >
        <Text
          variant="caption"
          style={{ color: "#8F98A6", fontWeight: "900", fontSize: 10 }}
        >
          {metric?.label}
        </Text>
        <Text
          variant="headline"
          style={{ color: "#FFFFFF", fontWeight: "900", textAlign: "center" }}
          numberOfLines={1}
        >
          {metric?.value}
        </Text>
        <Text
          variant="caption"
          style={{ color: "#C4CAD3", fontWeight: "800", textAlign: "center" }}
          numberOfLines={1}
        >
          {metric?.secondary}
        </Text>
      </Animated.View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {metrics.map((item, index) => (
          <View
            key={`${item.label}-${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Show ${item.label}`}
            accessible
            focusable
            onStartShouldSetResponder={() => true}
            onResponderRelease={() => selectMetric(index)}
            hitSlop={8}
          >
            <View
              style={{
                width: index === safeActiveMetric ? 16 : 6,
                height: 6,
                borderRadius: 999,
                backgroundColor:
                  index === safeActiveMetric ? "#EF1738" : "#596272",
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function CompactRaceProgress({
  contest,
  raceCategory,
  raceTiming,
  legLabel,
  progress,
  finished = false,
  resultStatus,
  resultSplits = [],
  timeline = [],
  finishTime,
  elapsedTime,
  clockRunning = false,
  activeCutoff,
  startTiming,
  predictionTrack,
  waitingToStart = false,
}: {
  contest: string;
  raceCategory?: string;
  raceTiming?: AthleteDetailViewModel["raceTiming"];
  legLabel: string;
  progress: number;
  finished?: boolean;
  resultStatus?: string;
  resultSplits?: { label: string; value: string }[];
  timeline?: TimelineSplit[];
  finishTime?: string;
  elapsedTime?: string;
  clockRunning?: boolean;
  activeCutoff?: AthleteDetailViewModel["activeCutoff"];
  startTiming?: AthleteDetailViewModel["startTiming"];
  predictionTrack?: AthleteDetailViewModel["track"];
  waitingToStart?: boolean;
}) {
  const canonicalElapsedSeconds = parseElapsedClock(elapsedTime);
  const { elapsedSeconds: continuousElapsedSeconds, nowMs: predictionNow } =
    useContinuousElapsedSeconds({
      running: clockRunning,
      canonicalElapsedSeconds,
      startTiming,
    });
  // The mapper has already resolved the one accepted canonical anchor. Do not
  // independently select a keyframe here: corrections/removals must move both
  // the map and compact rail back to that same authoritative seed.
  const movementSeed = predictionTrack?.seed;
  const projectionElapsedSeconds =
    continuousElapsedSeconds != null
      ? continuousElapsedSeconds
      : movementSeed
        ? movementSeed.anchorTimeSec
        : undefined;
  const boundedPrediction = predictionTrack
    ? checkpointBoundedPosition({
        seed: movementSeed,
        currentRaceElapsedSec: projectionElapsedSeconds,
        raceState: finished
          ? "FINISHED"
          : clockRunning
            ? "ACTIVE"
            : "NOT_STARTED",
        latestOfficialAt: predictionTrack.anchorTimestamp,
        expectedArrivalElapsedSec: predictionTrack.predictedArrivalElapsedSec,
        expectedArrivalAt: predictionTrack.predictedArrivalAt,
      })
    : undefined;
  const effectiveProgress = useMemo(() => {
    const canonicalProgress = Math.max(0, Math.min(1, progress));
    if (finished) return 1;
    if (!clockRunning || !predictionTrack || !(predictionTrack.totalKm > 0)) {
      return canonicalProgress;
    }
    // The interpolation seed is tied to the last accepted split's cumulative
    // race elapsed. Drive it from the live race clock so polling, rerenders,
    // reopening the sheet, and app resume cannot reset movement back to the
    // Bike/Run start node. The final keyframe is official timing evidence; it
    // is only the prediction anchor and never marks the next split complete.
    const predictedDistance =
      boundedPrediction?.distanceKm ?? predictionTrack.seed.anchorKm;
    return Math.max(
      canonicalProgress,
      distanceToFraction(predictedDistance, predictionTrack.totalKm),
    );
  }, [
    boundedPrediction?.distanceKm,
    clockRunning,
    finished,
    predictionTrack,
    progress,
  ]);
  const normalizedLeg = normalizeSearchText(legLabel);
  const preRace =
    !finished &&
    !clockRunning &&
    (waitingToStart || /notstarted|waiting|awaiting/.test(normalizedLeg));
  const courseKind = resolveCourseKindFromSections(
    raceTiming?.sections,
    raceCategory,
    contest,
  );
  const stages = courseStageLabels(courseKind);
  // The compact race card communicates sport legs plus configured transition
  // boundaries. Detailed timing checkpoints remain in Live Split Flow.
  const displayStages = stages.map((stage) => ({
    key: stage,
    label: stage,
    value: "",
    state: "upcoming" as const,
  }));
  const isDnf = /\bdnf\b|did not finish/i.test(resultStatus ?? "");
  const isDns = /\bdns\b|did not start/i.test(resultStatus ?? "");
  const sportStages = stages.filter((stage) =>
    /^(?:SWIM|BIKE|RUN|RUN1|RUN2)$/.test(stage),
  );
  const timelineRowsForStage = (stage: string) =>
    timeline.filter((split) => {
      const identity = normalizeSearchText(
        `${split.segment} ${split.name} ${split.splitLabel}`,
      );
      if (stage === "BIKE") return /\b(?:bike|cycle)\b/.test(identity);
      if (stage === "SWIM") {
        return (
          /\bswim\b/.test(identity) ||
          (/\bstart\b/.test(identity) &&
            !/\b(?:bike|cycle|run)\b/.test(identity))
        );
      }
      if (stage === "RUN") return /\brun\b/.test(identity);
      return identity.includes(stage.toLowerCase());
    });
  let completedBoundaryIndex = 0;
  for (const stage of sportStages) {
    const rowsForStage = timelineRowsForStage(stage);
    const finishRow = rowsForStage.find((split) =>
      /finish/i.test(`${split.name} ${split.splitLabel}`),
    );
    const completed = finishRow
      ? finishRow.state === "completed"
      : rowsForStage.length > 1 &&
        rowsForStage.every((split) => split.state === "completed");
    if (!completed) break;
    const sportIndex = stages.indexOf(stage);
    completedBoundaryIndex = Math.min(stages.length - 1, sportIndex + 1);
  }
  const labelIndex = stages.findIndex((stage) =>
    normalizedLeg.includes(stage.toLowerCase()),
  );
  const officialBoundaryProgress =
    stages.length > 1
      ? Math.min(
          1,
          Math.max(completedBoundaryIndex, labelIndex) / (stages.length - 1),
        )
      : finished
        ? 1
        : 0;
  const configuredStageDistanceEndpoints = sportStages.map((stage) => {
    const values = timelineRowsForStage(stage)
      .map((split) =>
        Number(String(split.distanceLabel || "").match(/\d+(?:\.\d+)?/)?.[0]),
      )
      .filter((value) => Number.isFinite(value) && value > 0);
    return values.length ? Math.max(...values) : null;
  });
  const endpointsLookCumulative = Boolean(
    predictionTrack &&
    predictionTrack.totalKm > 0 &&
    configuredStageDistanceEndpoints.every(
      (distance) => distance != null && distance > 0,
    ) &&
    configuredStageDistanceEndpoints.every(
      (distance, index, all) =>
        index === 0 || Number(distance) >= Number(all[index - 1]),
    ) &&
    Math.abs(
      Number(configuredStageDistanceEndpoints.at(-1)) - predictionTrack.totalKm,
    ) /
      predictionTrack.totalKm <=
      0.1,
  );
  const configuredStageDistances = endpointsLookCumulative
    ? configuredStageDistanceEndpoints.map(
        (distance, index, all) =>
          Number(distance) - (index > 0 ? Number(all[index - 1]) : 0),
      )
    : configuredStageDistanceEndpoints;
  const configuredTotalDistance = configuredStageDistances.reduce<number>(
    (total, distance) => total + (distance ?? 0),
    0,
  );
  const stageDistancesAreUsable =
    predictionTrack &&
    predictionTrack.totalKm > 0 &&
    configuredStageDistances.every(
      (distance) => distance != null && distance > 0,
    ) &&
    configuredTotalDistance > 0 &&
    Math.abs(configuredTotalDistance - predictionTrack.totalKm) /
      predictionTrack.totalKm <=
      0.1;
  const visualPredictionProgress = (() => {
    if (!stageDistancesAreUsable || stages.length <= 1 || !predictionTrack)
      return effectiveProgress;
    const estimatedCourseDistance = effectiveProgress * predictionTrack.totalKm;
    let distanceBeforeStage = 0;
    for (let index = 0; index < configuredStageDistances.length; index += 1) {
      const stageDistance = configuredStageDistances[index] ?? 0;
      if (
        estimatedCourseDistance <= distanceBeforeStage + stageDistance ||
        index === configuredStageDistances.length - 1
      ) {
        const fractionWithinStage =
          stageDistance > 0
            ? Math.max(
                0,
                Math.min(
                  1,
                  (estimatedCourseDistance - distanceBeforeStage) /
                    stageDistance,
                ),
              )
            : 0;
        const displayStageIndex = stages.indexOf(sportStages[index]);
        const nextBoundaryIndex =
          index === configuredStageDistances.length - 1
            ? stages.length - 1
            : Math.max(
                displayStageIndex + 1,
                stages.indexOf(sportStages[index + 1]) - 1,
              );
        const displaySpan = Math.max(1, nextBoundaryIndex - displayStageIndex);
        return Math.min(
          1,
          (displayStageIndex + fractionWithinStage * displaySpan) /
            (stages.length - 1),
        );
      }
      distanceBeforeStage += stageDistance;
    }
    return effectiveProgress;
  })();
  const visualProgress = preRace
    ? 0
    : Math.max(visualPredictionProgress, officialBoundaryProgress);
  // Estimated location may move an athlete between official timing points, but
  // it must never promote the race state into a transition or the next sport.
  // In particular, Swim -> T1 requires an accepted Swim Finish read. Using
  // `legLabel` or predicted distance here made the compact rail mark T1 while
  // its own next-checkpoint card still correctly showed Swim Finish.
  const lastConfirmedTimelineSplit = [...timeline]
    .reverse()
    .find((split) => split.state === "completed");
  const officialStageIndexFromTimeline = (() => {
    const identity = normalizeSearchText(
      `${lastConfirmedTimelineSplit?.segment} ${lastConfirmedTimelineSplit?.splitLabel} ${lastConfirmedTimelineSplit?.name}`,
    );
    if (!identity) return -1;
    if (/\brun\b/.test(identity) && /\bfinish\b/.test(identity))
      return stages.indexOf("FINISH");
    if (/\brun\b/.test(identity)) return stages.indexOf("RUN");
    if (/\b(?:bike|cycle)\b/.test(identity) && /\bfinish\b/.test(identity))
      return stages.indexOf("T2");
    if (/\b(?:bike|cycle)\b/.test(identity)) return stages.indexOf("BIKE");
    if (/\bswim\b/.test(identity) && /\bfinish\b/.test(identity))
      return stages.indexOf("T1");
    if (/\bswim\b/.test(identity) || /\bstart\b/.test(identity))
      return stages.indexOf("SWIM");
    return -1;
  })();
  const activeIndex = finished
    ? stages.length - 1
    : Math.max(0, completedBoundaryIndex, officialStageIndexFromTimeline);
  const splitTimeForStage = (stage: string): string => {
    if (preRace) return "--:--:--";
    if (stage === "FINISH") {
      const finishSeconds = parseElapsedClock(finishTime);
      if (finishSeconds != null && finishSeconds > 0) return finishTime!;
      return raceTiming?.overallTimeSeconds != null &&
        raceTiming.overallTimeSeconds > 0
        ? formatElapsedClock(raceTiming.overallTimeSeconds)
        : "--:--:--";
    }
    const aliases: Record<string, string[]> = {
      SWIM: ["swim"],
      T1: ["t1", "transition 1", "transition1"],
      BIKE: ["bike", "cycle"],
      T2: ["t2", "transition 2", "transition2"],
      RUN: ["run"],
    };
    const canonicalSection = raceTiming?.sections.find((section) => {
      const identity = normalizeSearchText(
        `${section.shortLabel || ""} ${section.title} ${section.legType || ""}`,
      );
      return (aliases[stage] ?? [stage.toLowerCase()]).some(
        (alias) => identity === alias || identity.includes(alias),
      );
    });
    if (canonicalSection?.durationSeconds != null) {
      return formatElapsedClock(canonicalSection.durationSeconds);
    }
    const match = resultSplits.find((split) => {
      const label = normalizeSearchText(split.label);
      return (aliases[stage] ?? [stage.toLowerCase()]).some(
        (alias) => label === alias || label.includes(alias),
      );
    });
    return match?.value || "--:--";
  };
  const hasOfficialTime = (stage: string) =>
    !["", "--:--", "--:--:--", "—", "dnf", "dns", "dsq"].includes(
      splitTimeForStage(stage).trim().toLowerCase(),
    );
  // Athlete status and cutoff checkpoint are canonical. The card must not
  // infer a DNF stage by comparing locally configured display strings.
  const resolvedActiveIndex = activeIndex;
  const movingStage = stages[resolvedActiveIndex] ?? "RUN";
  const movingIcon =
    movingStage === "SWIM"
      ? "swim"
      : movingStage === "BIKE"
        ? "bike"
        : movingStage === "RUN"
          ? "run"
          : "flag";
  const raceElapsedSeconds = continuousElapsedSeconds;
  const displayedElapsedTime = preRace
    ? undefined
    : raceElapsedSeconds != null
      ? formatElapsedClock(raceElapsedSeconds)
      : elapsedTime;
  const cutoffPresentation = resolveCanonicalCutoffPresentation(
    activeCutoff,
    predictionNow,
  );
  const cutoffRemainingSeconds = cutoffPresentation.remainingSeconds;
  const cutoffConfirmed = cutoffPresentation.confirmed;
  const cutoffAwaitingAuthority =
    cutoffRemainingSeconds != null &&
    cutoffRemainingSeconds <= 0 &&
    !cutoffConfirmed;
  const positionConfidenceLabel = (() => {
    if (preRace || finished || !predictionTrack) return undefined;
    const acceptedAt = predictionTrack.anchorTimestamp;
    if (acceptedAt == null) return "Estimated position · timing-derived";
    const ageSeconds = Math.max(
      0,
      Math.floor((predictionNow - acceptedAt) / 1_000),
    );
    if (ageSeconds < 60) return "Timing confirmed just now";
    return `Estimated position · last timing read ${Math.floor(ageSeconds / 60)}m ago`;
  })();
  const awaitingCheckpoint =
    boundedPrediction?.state === "AWAITING_CHECKPOINT_CONFIRMATION";
  const waitingClockLabel = boundedPrediction
    ? `${String(Math.floor(boundedPrediction.waitingSeconds / 60)).padStart(2, "0")}:${String(boundedPrediction.waitingSeconds % 60).padStart(2, "0")}`
    : "00:00";
  const expectedCheckpointLabel = firstText(
    predictionTrack?.nextCheckpointLabel,
    predictionTrack?.nextCheckpointKey,
    "next checkpoint",
  );

  return (
    <View style={{ gap: 9 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Text
          variant="caption"
          numberOfLines={2}
          style={{
            color: "#AEB6C3",
            fontWeight: "900",
            letterSpacing: 0.6,
            flex: 1,
            minWidth: 0,
          }}
        >
          {finished ? "RACE PROGRESS · CUMULATIVE TIMES" : "RACE PROGRESS"}
        </Text>
        {!preRace && displayedElapsedTime ? (
          <View
            style={{
              alignItems: "flex-end",
              gap: 1,
              maxWidth: "58%",
              minWidth: 0,
              flexShrink: 1,
              paddingHorizontal: 9,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.10)",
            }}
          >
            <View
              style={{
                width: "100%",
                minWidth: 0,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 6,
              }}
            >
              <Text
                variant="caption"
                style={{ color: "#AEB6C3", fontWeight: "800", flexShrink: 1 }}
              >
                {resultStatus ? "TOTAL" : "ELAPSED"}
              </Text>
              <Text
                variant="label"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.62}
                style={{
                  color: "#FFFFFF",
                  fontWeight: "900",
                  flexShrink: 1,
                  minWidth: 0,
                }}
              >
                {displayedElapsedTime}
              </Text>
            </View>
            {!resultStatus && activeCutoff && cutoffRemainingSeconds != null ? (
              <Text
                variant="caption"
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                style={{
                  color:
                    cutoffAwaitingAuthority || cutoffConfirmed
                      ? "#FF8A98"
                      : "#F4C56A",
                  fontWeight: "900",
                  textAlign: "right",
                  width: "100%",
                  flexShrink: 1,
                }}
              >
                {activeCutoff.checkpointLabel.toUpperCase()} ·{" "}
                {cutoffPresentation.label}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {isDnf ? (
        <Text variant="caption" style={{ color: "#FF8A98", fontWeight: "900" }}>
          {cutoffConfirmed
            ? `CUTOFF AT ${activeCutoff?.checkpointLabel || "CHECKPOINT"}`
            : "DNF · OFFICIAL RACE STATUS"}
        </Text>
      ) : null}
      {isDns ? (
        <Text variant="caption" style={{ color: "#FFB4BE", fontWeight: "900" }}>
          DNS · ATHLETE DID NOT START
        </Text>
      ) : null}
      {positionConfidenceLabel ? (
        <Text variant="caption" style={{ color: "#AEB6C3", fontWeight: "700" }}>
          {positionConfidenceLabel}
        </Text>
      ) : null}
      {awaitingCheckpoint ? (
        <View
          accessibilityLabel={`Expected at ${expectedCheckpointLabel}. Awaiting timing confirmation ${waitingClockLabel}`}
          style={{
            gap: 2,
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 10,
            backgroundColor: "rgba(46,116,214,0.18)",
            borderWidth: 1,
            borderColor: "rgba(82,151,255,0.52)",
          }}
        >
          <Text variant="label" style={{ color: "#FFFFFF", fontWeight: "900" }}>
            Expected at {expectedCheckpointLabel}
          </Text>
          <Text
            variant="caption"
            style={{ color: "#C9D8EF", fontWeight: "800" }}
          >
            Awaiting timing confirmation · {waitingClockLabel}
          </Text>
        </View>
      ) : null}
      <View
        style={{
          position: "relative",
          flexDirection: "row",
          alignItems: "flex-start",
        }}
      >
        {displayStages.length > 1 &&
        visualProgress > 0 &&
        visualProgress < 1 ? (
          <View
            pointerEvents="none"
            accessibilityLabel={`Estimated race progress ${Math.round(visualProgress * 100)} percent`}
            style={{
              position: "absolute",
              left: `${50 / displayStages.length + visualProgress * (100 - 100 / displayStages.length)}%`,
              top: 19,
              width: 23,
              height: 23,
              marginLeft: -11.5,
              borderRadius: 999,
              backgroundColor: "#FFFFFF",
              borderWidth: 2,
              borderColor: "#E1122A",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 4,
            }}
          >
            <Icon name={movingIcon} size={14} colorValue="#E1122A" />
          </View>
        ) : null}
        {displayStages.map((displayStage, index) => {
          const stage = displayStage.label;
          const segmentProgress =
            index < displayStages.length - 1
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    visualProgress * (displayStages.length - 1) - index,
                  ),
                )
              : 0;
          const previousSegmentProgress =
            index > 0
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    visualProgress * (displayStages.length - 1) - (index - 1),
                  ),
                )
              : 0;
          const rightConnectorProgress = Math.max(
            0,
            Math.min(1, segmentProgress * 2),
          );
          const leftConnectorProgress = Math.max(
            0,
            Math.min(1, previousSegmentProgress * 2 - 1),
          );
          const completed = finished || index < resolvedActiveIndex;
          const current =
            !finished && !preRace && !isDns && index === resolvedActiveIndex;
          return (
            <View
              key={displayStage.key}
              style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 6 }}
            >
              <Text
                variant="caption"
                style={{
                  color: current || completed ? "#FFFFFF" : "#8F98A6",
                  fontWeight: "900",
                  fontSize: 10,
                }}
              >
                {stage}
              </Text>
              <View
                style={{
                  position: "relative",
                  width: "100%",
                  height: 26,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {index > 0 ? (
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      left: 0,
                      right: "50%",
                      marginRight: 13,
                      top: 11.5,
                      height: 3,
                      backgroundColor: "#4B5563",
                      overflow: "hidden",
                      zIndex: 1,
                    }}
                  >
                    <View
                      style={{
                        width: `${leftConnectorProgress * 100}%`,
                        height: "100%",
                        backgroundColor: "#E1122A",
                      }}
                    />
                  </View>
                ) : null}
                {index < displayStages.length - 1 ? (
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      left: "50%",
                      right: 0,
                      marginLeft: 13,
                      top: 11.5,
                      height: 3,
                      backgroundColor: "#4B5563",
                      overflow: "hidden",
                      zIndex: 1,
                    }}
                  >
                    <View
                      style={{
                        width: `${rightConnectorProgress * 100}%`,
                        height: "100%",
                        backgroundColor: "#E1122A",
                      }}
                    />
                  </View>
                ) : null}
                <View
                  style={{
                    position: "relative",
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 2,
                    backgroundColor: current
                      ? "#E1122A"
                      : completed
                        ? "#9F1239"
                        : "#242424",
                    borderWidth: 2,
                    borderColor: current || completed ? "#FF5A6B" : "#6B7280",
                  }}
                >
                  {stage === "SWIM" ? (
                    <Icon name="swim" size={15} colorValue="#FFFFFF" />
                  ) : stage === "BIKE" ? (
                    <Icon name="bike" size={15} colorValue="#FFFFFF" />
                  ) : stage === "RUN" ? (
                    <Icon name="run" size={15} colorValue="#FFFFFF" />
                  ) : stage === "T1" || stage === "T2" ? (
                    <Icon name="transition" size={15} colorValue="#FFFFFF" />
                  ) : /finish/i.test(stage) ? (
                    <Icon name="flag" size={15} colorValue="#FFFFFF" />
                  ) : (
                    <Text
                      variant="caption"
                      style={{
                        color: "#FFFFFF",
                        fontWeight: "900",
                        fontSize: 9,
                      }}
                    >
                      {String(index + 1)}
                    </Text>
                  )}
                </View>
              </View>
              <Text
                variant="caption"
                style={{
                  color: completed || current ? "#FFFFFF" : "#8F98A6",
                  fontSize: 9,
                  fontWeight: completed ? "800" : "500",
                }}
              >
                {isDnf && current && !hasOfficialTime(stage)
                  ? "DNF"
                  : displayStage.value || splitTimeForStage(stage)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TrackedAthleteListCard({
  row,
  onOpen,
  onRemove,
}: {
  row: TrackedCard;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const header = row.detail ? displayHeader(row.detail) : null;
  const name = header?.name || row.athlete.name;
  const bib = header?.bib || row.athlete.bib;
  const contest = header?.contest || row.athlete.category;
  const rawCategory = firstText(header?.category, row.athlete.ageGroup);
  const category =
    rawCategory &&
    rawCategory.trim().toLowerCase() !== contest?.trim().toLowerCase()
      ? rawCategory
      : row.athlete.ageGroup;
  const finished = row.detail?.header.status === "finished";
  const terminalOutcome =
    finished ||
    Boolean(
      row.detail?.result &&
      /\b(?:dnf|dns|dnq|dsq)\b/i.test(row.detail.result.statusLabel),
    );
  const status = terminalOutcome
    ? row.detail?.result?.statusLabel || "Finished"
    : row.timingUnavailable
      ? "TIMING DATA PENDING"
      : row.detail?.lifecycle.label ||
        header?.statusLabel ||
        "Waiting to Start";
  const progress = row.detail?.raceProgress;
  const isNotStarted =
    !terminalOutcome && /not\s*started|waiting|awaiting\s*start/i.test(status);

  return (
    <View
      style={{
        minHeight: 118,
        borderRadius: theme.radius.large,
        overflow: "hidden",
        backgroundColor: "#242424",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
      }}
    >
      <View
        style={{
          flex: 1,
          minHeight: 210,
          paddingVertical: theme.spacing.md,
          // The close button occupies the top-right corner. Reserve the same
          // amount on the left so the athlete identity and progress content
          // remain visually centered within the card.
          paddingLeft: 48,
          paddingRight: 48,
          gap: theme.spacing.md,
          backgroundColor: "transparent",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${name}`}
          onPress={onOpen}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.md,
          }}
        >
          <Avatar
            name={name}
            uri={header?.photo || row.athlete.photoUrl}
            colorSeed={header?.colorSeed || row.athlete.id}
            size={62}
            bordered
          />
          <View style={{ flex: 1, gap: 5 }}>
            <Text
              variant="headline"
              style={{ color: "#FFFFFF" }}
              numberOfLines={1}
            >
              {name} {header?.countryFlag || ""}
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: "#FFFFFF" }}
              numberOfLines={2}
            >
              {[contest, category, bib ? `Bib ${bib}` : ""]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: "#BDBDBD", fontWeight: "800" }}
              numberOfLines={1}
            >
              {status}
            </Text>
          </View>
        </Pressable>
        {row.timingUnavailable ? (
          <View
            style={{
              borderRadius: theme.radius.medium,
              padding: theme.spacing.md,
              gap: 4,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.10)",
            }}
          >
            <Text variant="label" style={{ color: "#FFFFFF" }}>
              Timing configuration pending
            </Text>
            <Text variant="caption" style={{ color: "#AEB6C2" }}>
              Race progress will appear after the event timing build is
              published.
            </Text>
          </View>
        ) : (
          <>
            {isNotStarted ? (
              <RaceStartCountdown
                scheduledStart={header?.scheduledStart}
                startTiming={row.detail?.startTiming}
                participantUuid={row.athlete.participantUuid}
                contestUuid={
                  row.athlete.providerContestUuid ?? row.athlete.contestUuid
                }
              />
            ) : null}
            {!isNotStarted ? (
              <CompactLiveTimingSummary detail={row.detail} />
            ) : null}
            <CompactRaceProgress
              contest={contest || ""}
              raceCategory={row.raceCategory || row.detail?.header.raceCategory}
              raceTiming={row.detail?.raceTiming}
              legLabel={progress?.legLabel || status}
              progress={progress?.progress ?? 0}
              finished={Boolean(
                row.detail?.result &&
                /finish|complete/i.test(row.detail.result.statusLabel),
              )}
              resultStatus={row.detail?.result?.statusLabel}
              resultSplits={row.detail?.result?.splits}
              timeline={row.detail?.timeline}
              finishTime={row.detail?.result?.chipTime}
              elapsedTime={row.detail?.result?.chipTime}
              clockRunning={canRunAthleteRaceClock(row.detail)}
              activeCutoff={row.detail?.activeCutoff}
              startTiming={row.detail?.startTiming}
              predictionTrack={row.detail?.track}
              waitingToStart={Boolean(
                row.detail?.startTiming?.waitingForChipStart,
              )}
            />
          </>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Untrack ${name}`}
        onPress={onRemove}
        hitSlop={8}
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(225,18,42,0.14)",
          borderWidth: 1,
          borderColor: "rgba(225,18,42,0.42)",
        }}
      >
        <Text
          variant="headline"
          style={{ color: "#FF4D5E", fontSize: 17, lineHeight: 18 }}
        >
          ×
        </Text>
      </Pressable>
    </View>
  );
}

type LivePredictedCourseMapProps = Omit<CourseMapViewProps, "athletes"> & {
  predictionRunning: boolean;
  buildAthletes: (nowMs: number) => TrackAthlete[];
};

/** The one-second interpolation subscription terminates at this leaf. */
const LivePredictedCourseMap = memo(function LivePredictedCourseMap({
  predictionRunning,
  buildAthletes,
  ...mapProps
}: LivePredictedCourseMapProps) {
  const predictionNowMs = useSharedLiveNow(predictionRunning);
  const athletes = useMemo(
    () => buildAthletes(predictionNowMs),
    [buildAthletes, predictionNowMs],
  );
  return <CourseMapView {...mapProps} athletes={athletes} />;
});

export function LiveTrackScreen() {
  recordLivePerformance("liveTrackScreenRenders");
  const liveTrackMountId = useId();
  const theme = useTheme();
  const routeParams = useLocalSearchParams<{
    eventId?: string;
    email?: string;
    bib?: string;
    athleteUid?: string;
    bookingId?: string;
    participantUuid?: string;
    providerEventUuid?: string;
    providerUuid?: string;
    providerAthleteUuid?: string;
    providerTimingUuid?: string;
    providerRecordId?: string;
    providerContestUuid?: string;
    contestUuid?: string;
    ticketId?: string;
    name?: string;
    category?: string;
    club?: string;
    photoUrl?: string;
    profilePhotoUrl?: string;
    photoURL?: string;
    displayPhoto?: string;
  }>();
  const eventScreen = useEventScreenInitialization();
  const id = eventScreen.eventId;
  const routeKey = `event:${id || "pending"}:track`;
  useEffect(() => {
    if (isLiveDiagnosticsEnabled) {
      recordLivePerformance("liveTrackMounts");
      console.info("LIVE_TRACK_MOUNT", {
        instanceId: liveTrackMountId,
        eventId: id,
        routeKey,
      });
    }
    return () => {
      if (isLiveDiagnosticsEnabled) {
        recordLivePerformance("liveTrackUnmounts");
        console.info("LIVE_TRACK_UNMOUNT", {
          instanceId: liveTrackMountId,
          eventId: id,
          routeKey,
          reason: "route_or_component_disposed",
        });
      }
    };
    // This is component-instance instrumentation. Event/athlete changes must
    // never create a second mount lifecycle for the same instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const autoTrackAthlete = useMemo<SearchHit | null>(() => {
    const bib = firstText(routeParams.bib);
    const athleteUid = firstText(routeParams.athleteUid);
    const bookingId = firstText(routeParams.bookingId);
    const participantUuid = firstText(routeParams.participantUuid);
    const providerEventUuid =
      firstText(routeParams.providerEventUuid) ||
      participantUuid?.match(/^race:([^:]+):/i)?.[1] ||
      firstText(routeParams.bookingId)?.match(/^race:([^:]+):/i)?.[1];
    const providerUuid = firstText(routeParams.providerUuid);
    const providerAthleteUuid = firstText(routeParams.providerAthleteUuid);
    const providerTimingUuid = firstText(routeParams.providerTimingUuid);
    const providerRecordId = firstText(routeParams.providerRecordId);
    const email = firstText(routeParams.email);
    const providerContestUuid = firstText(routeParams.providerContestUuid);
    const contestUuid = firstText(routeParams.contestUuid);
    const ticketId = firstText(routeParams.ticketId);
    const hasIdentity = Boolean(
      bib ||
      athleteUid ||
      bookingId ||
      email ||
      participantUuid ||
      providerUuid ||
      providerAthleteUuid ||
      providerTimingUuid ||
      providerRecordId,
    );
    if (!hasIdentity) return null;
    const category = firstText(routeParams.category);
    return {
      id: firstText(
        participantUuid,
        providerUuid,
        providerAthleteUuid,
        providerTimingUuid,
        providerRecordId,
        bookingId,
        athleteUid,
        bib && category ? `bib:${bib}:contest:${category}` : undefined,
        bib,
      ),
      participantUuid: participantUuid || undefined,
      providerEventUuid: providerEventUuid || undefined,
      bib,
      name: firstText(routeParams.name) || (bib ? `Bib ${bib}` : "Athlete"),
      email,
      category: category || undefined,
      club: firstText(routeParams.club) || undefined,
      photoUrl:
        firstText(
          routeParams.photoUrl,
          routeParams.profilePhotoUrl,
          routeParams.photoURL,
          routeParams.displayPhoto,
        ) || undefined,
      contestUuid: contestUuid || undefined,
      contestId: undefined,
      providerContestUuid: providerContestUuid || undefined,
      providerContestId: undefined,
      ticketId: ticketId || undefined,
      providerUuid: providerUuid || undefined,
      providerAthleteUuid: providerAthleteUuid || undefined,
      providerTimingUuid: providerTimingUuid || undefined,
      providerRecordId: providerRecordId || undefined,
      athleteUid: athleteUid || undefined,
      bookingId: bookingId || undefined,
      raceDate: undefined,
    };
  }, [
    routeParams.athleteUid,
    routeParams.bib,
    routeParams.bookingId,
    routeParams.category,
    routeParams.club,
    routeParams.displayPhoto,
    routeParams.name,
    routeParams.email,
    routeParams.participantUuid,
    routeParams.providerEventUuid,
    routeParams.photoURL,
    routeParams.photoUrl,
    routeParams.profilePhotoUrl,
    routeParams.providerAthleteUuid,
    routeParams.providerContestUuid,
    routeParams.providerRecordId,
    routeParams.providerTimingUuid,
    routeParams.providerUuid,
    routeParams.contestUuid,
    routeParams.ticketId,
  ]);

  const eventQuery = useEvent(id);
  const eventHasFinished = eventUsesResultsMode(
    eventQuery.event?.status,
    eventQuery.event?.raw as Record<string, unknown> | undefined,
  );
  // A stale liveTrackingEnabled flag must not keep a completed/results event
  // on provisional canonical rows after official results are available.
  const canonicalLiveEnabled =
    eventQuery.event?.liveTrackingEnabled === true && !eventHasFinished;
  const eventResultsQuery = useEventResults(
    id,
    eventScreen.queryEnabled && eventHasFinished && !canonicalLiveEnabled,
  );
  // The live overview always owns one event-level base course. Athlete and
  // category updates are overlays and must never change this query scope.
  const resultsMode =
    !canonicalLiveEnabled &&
    (eventHasFinished || (eventResultsQuery.data?.length ?? 0) > 0);
  const athleteDataSource: "live" | "results" = resultsMode
    ? "results"
    : "live";
  const athleteRoster = useMemo<Record<string, unknown>[]>(() => {
    const rows =
      resultsMode && Array.isArray(eventResultsQuery.data)
        ? (eventResultsQuery.data as Record<string, unknown>[])
        : [];
    return rows.filter(isPublicTrackableAthlete);
  }, [eventResultsQuery.data, resultsMode]);
  const liveTrackingResolved =
    !eventQuery.isLoading && !eventQuery.isError && Boolean(eventQuery.event);
  const liveTrackingDataPending = false;
  const publicAthleteVisibilityEnabled = useMemo(() => {
    const payload = (eventQuery.event?.raw ?? eventQuery.event) as
      Record<string, unknown> | undefined;
    if (!payload) return true;
    if (
      payload.state === "visibility-disabled" ||
      payload.source === "visibility_lock"
    )
      return false;
    if (
      payload.visibilityEnabled === false ||
      payload.publicAthleteVisibility === false
    )
      return false;
    return true;
  }, [eventQuery.event]);
  const athleteInteractionsEnabled =
    liveTrackingResolved &&
    (resultsMode ||
      (publicAthleteVisibilityEnabled && !liveTrackingDataPending));
  const {
    athletes: rawWatchlistAthletes,
    hydrated: watchlistHydrated,
    addAthlete,
    toggle: storeToggleWatchlist,
    reconcileCanonicalAthlete,
  } = useWatchlist(id, athleteRoster);
  type ScreenTrackedAthlete = SearchHit & {
    eventId?: string;
    watchlistItemId?: string;
    providerUuid?: string;
    athleteUid?: string;
    bookingId?: string;
    contestId?: string;
    contestUuid?: string;
    providerContestUuid?: string;
    providerContestId?: string;
    ticketId?: string;
  };
  const watchlistAthletes = useMemo<ScreenTrackedAthlete[]>(() => {
    const rows = (rawWatchlistAthletes as ScreenTrackedAthlete[]).filter(
      (athlete) =>
        isPublicTrackableAthlete(athlete as unknown as Record<string, unknown>),
    );
    return rows.reduce<ScreenTrackedAthlete[]>((unique, athlete) => {
      const existingIndex = unique.findIndex((existing) =>
        sameAthleteIdentity(existing, athlete),
      );
      if (existingIndex < 0) {
        unique.push(athlete);
        return unique;
      }
      const existing = unique[existingIndex];
      unique[existingIndex] = Object.fromEntries(
        Object.entries({ ...athlete, ...existing }).filter(
          ([, value]) => value !== undefined && value !== null && value !== "",
        ),
      ) as ScreenTrackedAthlete;
      return unique;
    }, []);
  }, [rawWatchlistAthletes]);

  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [resultsSearchOpen, setResultsSearchOpen] = useState(false);
  const debounced = useDebouncedValue(search, 350);
  const effectiveSearch =
    submittedSearch && submittedSearch === search.trim()
      ? submittedSearch
      : debounced;
  const searchEnabled = effectiveSearch.trim().length > 0;
  const hasLocalSearchMatch = useMemo(() => {
    const query = normalizeSearchText(effectiveSearch);
    if (!query) return false;
    return athleteRoster.some((athlete) =>
      athleteMatchesSearch(athlete as Record<string, unknown>, query),
    );
  }, [athleteRoster, effectiveSearch]);
  const athleteSearch = useAthleteSearch(
    id,
    effectiveSearch,
    "name" as AthleteSearchMode,
    eventScreen.queryEnabled &&
      searchEnabled &&
      athleteInteractionsEnabled &&
      !hasLocalSearchMatch,
    athleteDataSource,
  );
  const verifiedAutoTrackAthlete = useMemo<SearchHit | null>(() => {
    if (!autoTrackAthlete) return null;
    return isPublicTrackableAthlete(
      autoTrackAthlete as unknown as Record<string, unknown>,
    )
      ? autoTrackAthlete
      : null;
  }, [autoTrackAthlete]);
  const remoteSearchResults = useMemo(
    () =>
      mergeSearchResults(
        (athleteSearch.data ?? [])
          .filter((athlete) =>
            isPublicTrackableAthlete(
              athlete as unknown as Record<string, unknown>,
            ),
          )
          .map(searchHitFromRaw),
      ),
    [athleteSearch.data],
  );
  const localSearchResults = useMemo(() => {
    const query = normalizeSearchText(search);
    if (!query) return [];
    return athleteRoster
      .filter((athlete) =>
        athleteMatchesSearch(athlete as Record<string, unknown>, query),
      )
      .slice(0, 12)
      .map(searchHitFromRaw);
  }, [athleteRoster, search]);
  const searchResults = useMemo(() => {
    return mergeSearchResults(localSearchResults, remoteSearchResults);
  }, [localSearchResults, remoteSearchResults]);

  const trackedForEvent = useMemo(() => {
    if (!athleteInteractionsEnabled) return [];
    const seen = new Set<string>();
    return watchlistAthletes.filter((athlete) => {
      if (athlete.eventId && athlete.eventId !== id) return false;
      const key = stableAthleteKey(athlete, id);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [id, athleteInteractionsEnabled, watchlistAthletes]);
  const trackedIndexByKey = useMemo(() => {
    const index = new Map<string, number>();
    trackedForEvent.forEach((athlete, athleteIndex) => {
      index.set(stableAthleteKey(athlete, id), athleteIndex);
    });
    return index;
  }, [id, trackedForEvent]);

  const trackedResultIndex = useCallback(
    (athlete: Partial<SearchHit>) =>
      trackedForEvent.findIndex((tracked) =>
        sameAthleteIdentity(tracked, athlete),
      ),
    [trackedForEvent],
  );
  const visibleSearchResults = useMemo(
    () => searchResults.filter((athlete) => trackedResultIndex(athlete) < 0),
    [searchResults, trackedResultIndex],
  );

  // Open map-first. Search and full athlete timing are mounted only when the
  // user opens the tracker panel, so a slow athlete endpoint cannot cover or
  // delay the cached course render.
  const [sheetMode, setSheetMode] = useState<SheetMode>("collapsed");
  const [selectedTrackedIndex, setSelectedTrackedIndex] = useState(0);
  const [selectedTrackedKey, setSelectedTrackedKey] = useState<string | null>(
    null,
  );
  const selectedTrackedAthleteRef = useRef<ScreenTrackedAthlete | null>(null);
  const autoTrackKeyRef = useRef<string | null>(null);
  const [compactCardDismissed, setCompactCardDismissed] = useState(false);
  const [compactCardHeight, setCompactCardHeight] = useState(0);
  const [athleteExpanded, setAthleteExpanded] = useState(false);
  const [elevationOpen, setElevationOpen] = useState(false);
  const [elevationSnapshotNowMs, setElevationSnapshotNowMs] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationEnablePending, setNotificationEnablePending] =
    useState(false);
  const [headerSettingsOpen, setHeaderSettingsOpen] = useState(false);
  const [mapType, setMapType] = useState<
    "standard" | "satellite" | "hybrid" | "terrain"
  >("standard");
  const [mapDimension, setMapDimension] = useState<"2d" | "3d">("2d");
  const [mapPreferences, setMapPreferences] = useState<MapLayerPreferences>({
    showRoute: true,
    showSplitPoints: true,
    showDistanceLabels: true,
    showAthleteLabels: true,
    showAidStations: true,
  });
  const removeTrackedAthlete = useCallback(
    async (athlete: ScreenTrackedAthlete) => {
      const participantKey = stableAthleteKey(athlete, id);
      const trackedKeys = trackedForEvent.map((row) =>
        stableAthleteKey(row, id),
      );
      const selectedBefore = selectedTrackedKey;
      const selectedIndexBefore = selectedTrackedIndex;
      const expandedBefore = athleteExpanded;
      const next = selectionAfterTrackedAthleteRemoval(
        trackedKeys,
        selectedBefore,
        participantKey,
      );
      const removingSelected = selectedBefore === participantKey;
      const nextSelectedAthlete = trackedForEvent.find(
        (row) => stableAthleteKey(row, id) === next.nextSelectedKey,
      );

      if (isLiveDiagnosticsEnabled) {
        console.info("[tracking-close][REQUEST]", {
          participantUuid: athlete.participantUuid ?? null,
          bib: athlete.bib,
          watchlistItemId: athlete.watchlistItemId ?? null,
          participantKey,
          trackedCountBefore: trackedKeys.length,
        });
      }

      if (removingSelected) {
        selectedTrackedAthleteRef.current = nextSelectedAthlete ?? null;
        setSelectedTrackedKey(next.nextSelectedKey);
        setSelectedTrackedIndex(Math.max(0, next.nextSelectedIndex));
        setAthleteExpanded(false);
        if (!next.nextSelectedKey) setCompactCardDismissed(true);
      }

      const mutationIdentity = firstText(
        athlete.participantUuid,
        athlete.providerAthleteUuid,
        athlete.providerUuid,
        athlete.athleteUid,
        athlete.bookingId,
        athlete.id,
        athlete.bib,
      );
      const removed = await storeToggleWatchlist(mutationIdentity);
      if (!removed && removingSelected) {
        selectedTrackedAthleteRef.current = athlete;
        setSelectedTrackedKey(selectedBefore);
        setSelectedTrackedIndex(selectedIndexBefore);
        setAthleteExpanded(expandedBefore);
        setCompactCardDismissed(false);
      }
      if (isLiveDiagnosticsEnabled) {
        console.info("[tracking-close]", {
          participantUuid: athlete.participantUuid ?? null,
          bib: athlete.bib,
          trackedCountBefore: trackedKeys.length,
          trackedCountAfter: removed
            ? next.remainingKeys.length
            : trackedKeys.length,
          selectedBefore,
          selectedAfter: removed ? next.nextSelectedKey : selectedBefore,
          nextSelectedParticipantUuid: removed
            ? (nextSelectedAthlete?.participantUuid ?? next.nextSelectedKey)
            : selectedBefore,
          backendDeleteStatus: removed ? 200 : "failed_or_not_found",
          cardVisibleAfter: Boolean(
            removed ? next.nextSelectedKey : selectedBefore,
          ),
          liveTrackMountId,
        });
      }
    },
    [
      athleteExpanded,
      id,
      liveTrackMountId,
      selectedTrackedIndex,
      selectedTrackedKey,
      storeToggleWatchlist,
      trackedForEvent,
    ],
  );
  useEffect(() => {
    let active = true;
    void trackedAthleteNotificationsEnabled().then((enabled) => {
      if (active) setNotificationsEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, []);
  const handleNotificationToggle = useCallback(async () => {
    if (notificationEnablePending) return;
    if (notificationsEnabled) {
      setNotificationEnablePending(true);
      try {
        await disableTrackedAthleteNotifications();
        setNotificationsEnabled(false);
      } finally {
        setNotificationEnablePending(false);
      }
      return;
    }
    setNotificationEnablePending(true);
    try {
      const enabled = await enableTrackedAthleteNotifications();
      setNotificationsEnabled(enabled);
      if (!enabled) {
        Alert.alert(
          "Notifications Not Enabled",
          "Allow notifications in your device settings, then tap the bell again. Push notifications require a physical device and an internet connection.",
        );
      }
    } catch (error) {
      console.warn(
        "[push] enabling tracked-athlete notifications failed",
        error,
      );
      Alert.alert(
        "Notification Setup Failed",
        "The device could not be registered for push notifications. Please check your connection and try again.",
      );
    } finally {
      setNotificationEnablePending(false);
    }
  }, [notificationEnablePending, notificationsEnabled]);
  useEffect(() => {
    // Auth bootstrap temporarily clears account rows until the authoritative
    // watchlist is ready. Preserve the user's selected UUID through that
    // window instead of falling back to whichever account athlete arrives
    // first.
    if (!watchlistHydrated) return;
    if (!selectedTrackedKey) return;
    const selectedIndex = trackedForEvent.findIndex(
      (athlete) => stableAthleteKey(athlete, id) === selectedTrackedKey,
    );
    if (selectedIndex >= 0) {
      selectedTrackedAthleteRef.current = trackedForEvent[selectedIndex];
      return;
    }

    const equivalentIndex = selectedTrackedAthleteRef.current
      ? trackedForEvent.findIndex((athlete) =>
          sameAthleteSelection(athlete, selectedTrackedAthleteRef.current!),
        )
      : -1;

    // Canonical reconciliation can replace a temporary BIB key without
    // changing the selected athlete. Promote that equivalent row first. Only
    // fall back to another athlete when the selected identity was truly
    // removed; card-order indexes are not watchlist-order indexes.
    const resetSelection = setTimeout(() => {
      if (equivalentIndex >= 0) {
        const equivalent = trackedForEvent[equivalentIndex];
        selectedTrackedAthleteRef.current = equivalent;
        setSelectedTrackedKey(stableAthleteKey(equivalent, id));
        return;
      }
      setAthleteExpanded(false);
      if (trackedForEvent.length === 0) {
        setSelectedTrackedIndex(0);
        setSelectedTrackedKey(null);
        selectedTrackedAthleteRef.current = null;
        return;
      }
      const fallback = trackedForEvent[0];
      selectedTrackedAthleteRef.current = fallback;
      setSelectedTrackedIndex(0);
      setSelectedTrackedKey(stableAthleteKey(fallback, id));
    }, 0);
    return () => clearTimeout(resetSelection);
  }, [id, selectedTrackedKey, trackedForEvent, watchlistHydrated]);
  const routedAthleteKey = verifiedAutoTrackAthlete
    ? stableAthleteKey(verifiedAutoTrackAthlete, id)
    : null;
  const routedSelectionPending = Boolean(
    routedAthleteKey && autoTrackKeyRef.current !== routedAthleteKey,
  );
  const routedTrackedIndex =
    routedSelectionPending && verifiedAutoTrackAthlete
      ? trackedForEvent.findIndex((athlete) =>
          sameAthleteIdentity(athlete, verifiedAutoTrackAthlete),
        )
      : -1;
  const requestedTrackedIndex = useMemo(
    () =>
      measureActiveAthleteSwitchPhase("selectedAthleteLookupMs", () => {
        recordLivePerformance("selectorExecutions");
        return selectedTrackedKey
          ? (trackedIndexByKey.get(selectedTrackedKey) ?? -1)
          : routedTrackedIndex;
      }),
    [routedTrackedIndex, selectedTrackedKey, trackedIndexByKey],
  );
  const fullDetailIndex = requestedTrackedIndex;
  const authStatus = useSession((state) => state.status);
  const authReady = authStatus !== "loading";
  const persistedSelectedAthlete =
    fullDetailIndex >= 0 ? trackedForEvent[fullDetailIndex] : undefined;
  const persistedSelectedIdentityFingerprint =
    trackedAthleteIdentityFingerprint(id, persistedSelectedAthlete);
  const selectedIdentityLookup = useMemo(
    () => {
      return measureActiveAthleteSwitchPhase("identityResolutionMs", () => {
        if (!persistedSelectedAthlete) return null;
        // Canonical watchlist rows already carry their immutable lookup identity.
        // Re-entering a warm row must not rerun legacy BIB identity derivation.
        if (
          !requiresLegacyIdentityLookup(
            persistedSelectedAthlete.participantUuid,
          )
        ) {
          return null;
        }
        recordLivePerformance("identityResolutions");
        return legacyTrackedAthleteLookup(persistedSelectedAthlete);
      });
    },
    // Watchlist presentation objects may be recreated by unrelated updates.
    // Identity resolution is owned by the effective provider/participant key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persistedSelectedIdentityFingerprint],
  );
  const identityHydrationBudget = identityHydrationIndexes(
    trackedForEvent.length,
    fullDetailIndex,
  );
  // Identity hydration is deliberately selection-driven: one BIB lookup at a
  // time, then one canonical detail request. A 23-row watchlist therefore
  // cannot fan out into 23 startup searches/details.
  const selectedIdentityQuery = useQuery({
    queryKey: [
      "live-tracking",
      "selected-identity",
      id,
      selectedIdentityLookup?.kind ?? "canonical",
      selectedIdentityLookup?.value ??
        persistedSelectedAthlete?.participantUuid ??
        "none",
    ],
    queryFn: async ({ signal }) => {
      if (!selectedIdentityLookup || !persistedSelectedAthlete) return null;
      if (isLiveDiagnosticsEnabled) {
        console.info("IDENTITY_RECOVERY_LOOKUP", {
          eventId: id,
          mode: selectedIdentityLookup.mode,
          kind: selectedIdentityLookup.kind,
          query: selectedIdentityLookup.value,
        });
      }
      const response = await repositories.athlete.search(
        id,
        selectedIdentityLookup.value,
        selectedIdentityLookup.mode,
        signal,
      );
      return resolveLegacyTrackedAthlete(
        persistedSelectedAthlete,
        response.matches.map(searchHitFromRaw),
        selectedIdentityLookup,
      );
    },
    enabled: Boolean(
      eventScreen.queryEnabled &&
      athleteInteractionsEnabled &&
      selectedIdentityLookup &&
      persistedSelectedAthlete &&
      identityHydrationBudget.includes(fullDetailIndex) &&
      authReady,
    ),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const resolvedSelectedIdentity = useMemo(
    () =>
      resolvedTrackedAthleteForLiveState(
        persistedSelectedAthlete,
        selectedIdentityQuery.data,
      ),
    // Do not rerun legacy identity resolution for presentation-only watchlist
    // object changes or animation-clock renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persistedSelectedIdentityFingerprint, selectedIdentityQuery.data],
  );
  useEffect(() => {
    if (!resolvedSelectedIdentity || !selectedIdentityQuery.data) return;
    reconcileCanonicalAthlete({
      ...(resolvedSelectedIdentity as ScreenTrackedAthlete),
      eventId: id,
    });
  }, [
    id,
    reconcileCanonicalAthlete,
    resolvedSelectedIdentity,
    selectedIdentityQuery.data,
  ]);
  const selectedDetailAthlete = resolvedSelectedIdentity ?? undefined;
  const mapAthlete =
    requestedTrackedIndex >= 0
      ? requestedTrackedIndex === fullDetailIndex
        ? selectedDetailAthlete
        : trackedForEvent[requestedTrackedIndex]
      : undefined;
  // A verified route/search athlete may be viewed without joining the
  // watchlist. Its public contest identity can scope the course presentation,
  // but it must not become a tracked athlete or start a canonical detail owner.
  const fallbackCourseAthlete =
    mapAthlete ?? verifiedAutoTrackAthlete ?? undefined;
  const candidateProviderEventUuid =
    fallbackCourseAthlete?.providerEventUuid ??
    fallbackCourseAthlete?.participantUuid?.match(/^race:([^:]+):/i)?.[1];
  const candidateContestId =
    fallbackCourseAthlete?.providerContestUuid ??
    fallbackCourseAthlete?.contestUuid ??
    fallbackCourseAthlete?.contestId;
  const retainedCourseScopeRef = useRef<{
    eventId: string;
    providerEventUuid: string;
    contestId?: string;
    contestName?: string;
  } | null>(null);
  if (candidateProviderEventUuid) {
    const previousScope =
      retainedCourseScopeRef.current?.eventId === id
        ? retainedCourseScopeRef.current
        : null;
    retainedCourseScopeRef.current = {
      eventId: id,
      providerEventUuid: candidateProviderEventUuid,
      contestId: candidateContestId ?? previousScope?.contestId,
      contestName:
        fallbackCourseAthlete?.category ?? previousScope?.contestName,
    };
  } else if (retainedCourseScopeRef.current?.eventId !== id) {
    retainedCourseScopeRef.current = null;
  }
  const retainedCourseScope = retainedCourseScopeRef.current;
  const selectedProviderEventUuid =
    candidateProviderEventUuid ?? retainedCourseScope?.providerEventUuid;
  const normalizedSelectedProviderEventUuid = normalizeProviderEventUuid(
    selectedProviderEventUuid,
  );
  const selectedContestId =
    candidateContestId ?? retainedCourseScope?.contestId;
  const selectedContestName =
    fallbackCourseAthlete?.category ?? retainedCourseScope?.contestName;
  const courseSelection = useMemo(
    () => ({
      providerEventUuid: selectedProviderEventUuid,
      contestId: selectedContestId,
      contestName: selectedContestName,
      ticketId: fallbackCourseAthlete?.ticketId,
    }),
    [
      fallbackCourseAthlete?.ticketId,
      selectedContestId,
      selectedContestName,
      selectedProviderEventUuid,
    ],
  );
  const fallbackCourseConfig = useMemo<Record<string, unknown> | null>(() => {
    const event = eventQuery.event;
    if (!event) return null;
    const raw =
      event.raw && typeof event.raw === "object" && !Array.isArray(event.raw)
        ? (event.raw as Record<string, unknown>)
        : {};
    return {
      ...raw,
      ticketDefinitions: event.ticketDefinitions ?? raw.ticketDefinitions,
      mapsSplitsConfig: event.mapsSplitsConfig ?? raw.mapsSplitsConfig,
    };
  }, [eventQuery.event]);
  const configuredBergman102MasterSelection = useMemo(
    () => resolveBergman102MasterCourseSelection(fallbackCourseConfig),
    [fallbackCourseConfig],
  );
  const courseQuery = useCourseMap(
    id,
    Boolean(
      eventQuery.event &&
      !eventQuery.isLoading &&
      selectedProviderEventUuid &&
      !configuredBergman102MasterSelection,
    ),
    selectedProviderEventUuid,
    selectedContestId,
  );
  const bergman102MasterSelection = useMemo(() => {
    const master =
      configuredBergman102MasterSelection ??
      resolveBergman102MasterCourseSelection(courseQuery.data?.courseMap);
    // The BERGMAN 102 map is event display geometry. It must not inherit the
    // selected athlete's provider: switching between provider/contest scopes
    // changes timing ownership, but not the physical master route.
    return master ?? null;
  }, [configuredBergman102MasterSelection, courseQuery.data?.courseMap]);
  // Geometry is a display asset, not race configuration. BERGMAN events that
  // expose the 102 ticket use its Swim/Bike/Run tracks as one stable map while
  // every athlete continues to use their own contest timing and distances.
  const selectedCourseKind = resolveCourseKind(
    selectedContestName,
    selectedDetailAthlete?.category,
  );
  const allowedGeometrySegments = useMemo(
    () =>
      selectedCourseKind === "swim"
        ? (["swim"] as const)
        : selectedCourseKind === "bike"
          ? (["bike"] as const)
          : selectedCourseKind === "run"
            ? (["run"] as const)
            : selectedCourseKind === "duathlon"
              ? (["bike", "run"] as const)
              : (["swim", "bike", "run"] as const),
    [selectedCourseKind],
  );
  const mapGeometrySelection = useMemo<CourseMapSelection>(
    () =>
      bergman102MasterSelection
        ? {
            ...bergman102MasterSelection,
            allowedSegments: allowedGeometrySegments,
          }
        : courseSelection,
    [allowedGeometrySegments, bergman102MasterSelection, courseSelection],
  );
  const geometryQuery = useCourseGeometry(
    id,
    fallbackCourseConfig,
    Boolean(
      bergman102MasterSelection ||
      (fallbackCourseAthlete &&
        selectedCourseKind !== "unknown" &&
        selectedProviderEventUuid),
    ),
    mapGeometrySelection,
    bergman102MasterSelection ? "event-config" : "canonical",
  );
  const categoryCanHaveElevation = selectedCourseKind !== "swim";
  // Elevation is deliberately separate from shared map geometry and remains
  // lazy/category-scoped. Opening it may resolve the selected contest's GPX;
  // switching cards alone never downloads another elevation profile.
  const elevationGeometryQuery = useCourseGeometry(
    id,
    fallbackCourseConfig,
    Boolean(
      selectedProviderEventUuid && elevationOpen && categoryCanHaveElevation,
    ),
    courseSelection,
  );
  const courseResolutionDiagnosticRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isLiveDiagnosticsEnabled || geometryQuery.isLoading) return;
    const geometry = geometryQuery.data as
      | (Record<string, unknown> & {
          courseResolutionSource?: string;
          canonicalCourseMissing?: boolean;
        })
      | null
      | undefined;
    const diagnosticKey = [
      id,
      bergman102MasterSelection
        ? "event-master"
        : normalizedSelectedProviderEventUuid,
      normalizeContestKey(
        mapGeometrySelection.contestId ?? mapGeometrySelection.ticketId,
      ),
      [...(mapGeometrySelection.allowedSegments ?? [])].sort().join(","),
      geometry?.courseResolutionSource ?? "unavailable",
    ].join(":");
    if (courseResolutionDiagnosticRef.current === diagnosticKey) return;
    courseResolutionDiagnosticRef.current = diagnosticKey;
    recordLivePerformance("courseResolutions");
    console.info("[course-resolution]", {
      eventId: id,
      providerEventUuid: normalizedSelectedProviderEventUuid,
      providerContestUuid: normalizeContestKey(selectedContestId),
      courseResolutionSource: geometry?.courseResolutionSource ?? "unavailable",
      canonicalCourseMissing: geometry?.canonicalCourseMissing ?? true,
    });
  }, [
    bergman102MasterSelection,
    geometryQuery.data,
    geometryQuery.isLoading,
    id,
    mapGeometrySelection.allowedSegments,
    mapGeometrySelection.contestId,
    mapGeometrySelection.ticketId,
    normalizedSelectedProviderEventUuid,
    selectedContestId,
  ]);
  const courseVersion =
    (
      (courseQuery.data?.courseMap as Record<string, unknown> | undefined)
        ?.map as Record<string, unknown> | undefined
    )?.courseVersion ??
    (courseQuery.data?.courseMap as Record<string, unknown> | undefined)
      ?.courseVersion ??
    (courseQuery.data?.courseIndex as Record<string, unknown> | undefined)
      ?.courseVersion;
  const timingDisplayConfig =
    courseQuery.data?.timingConfiguration?.timingPointDisplayConfig;
  const displayCourseVersion = bergman102MasterSelection
    ? undefined
    : courseVersion;
  const displayTimingConfig = bergman102MasterSelection
    ? undefined
    : timingDisplayConfig;
  const courseIdentity = useMemo(
    () =>
      immutableCourseIdentity({
        eventId: id,
        providerEventUuid: bergman102MasterSelection
          ? undefined
          : normalizedSelectedProviderEventUuid,
        contestId: bergman102MasterSelection
          ? "bergman-102-master"
          : (mapGeometrySelection.contestId ?? mapGeometrySelection.ticketId),
        contestName: bergman102MasterSelection
          ? "BERGMAN 102 master course"
          : mapGeometrySelection.contestName,
        courseVersion: displayCourseVersion,
        geometry: geometryQuery.data,
        timingDisplayConfig: displayTimingConfig,
      }),
    [
      bergman102MasterSelection,
      displayCourseVersion,
      displayTimingConfig,
      geometryQuery.data,
      id,
      mapGeometrySelection.contestId,
      mapGeometrySelection.contestName,
      mapGeometrySelection.ticketId,
      normalizedSelectedProviderEventUuid,
    ],
  );
  const courseMap = useMemo(
    () =>
      measureActiveAthleteSwitchPhase("courseResolutionMs", () =>
        getOrBuildCourseModel(courseIdentity, () => {
          if (!geometryQuery.data) return undefined;
          recordMapDiagnostic("courseModelBuild", "immutable-course-identity");
          return mapCourseMap(
            courseQuery.data?.courseIndex,
            geometryQuery.data ?? undefined,
            {
              id:
                mapGeometrySelection.contestId ?? mapGeometrySelection.ticketId,
              name: mapGeometrySelection.contestName,
            },
            // Contest timing definitions remain authoritative in each athlete's
            // canonical detail/progress engine. They do not rebuild the shared
            // BERGMAN 102 display model when the selected athlete changes.
            bergman102MasterSelection
              ? undefined
              : courseQuery.data?.timingConfiguration,
          );
        }),
      ),
    // Deliberately exclude live athlete/watchlist/query response objects.
    // Only immutable category/provider/geometry/timing-display identity can
    // rebuild the course model supplied to the native map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseIdentity],
  );
  const coursePathModel = useMemo(
    () =>
      getOrBuildCourseModel(`${courseIdentity}:cumulative-path-v1`, () => {
        if (
          !courseMap?.hasGeometry ||
          !courseMap.bounds ||
          courseMap.mergedPath.length < 2
        ) {
          return undefined;
        }
        const cumulativePath = buildCumulativePath(courseMap.mergedPath);
        const legPaths = courseMap.legs
          .filter((leg) => leg.path.length > 1)
          .map((leg) => ({ leg, path: buildCumulativePath(leg.path) }));
        return {
          cumulativePath,
          legPaths,
          mappedCourseMeters: legPaths.reduce(
            (total, entry) => total + entry.path.totalMeters,
            0,
          ),
        };
      }),
    // The course model cache owns this immutable derived geometry across route
    // remounts. Athlete, watchlist, split, socket and clock state are excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseIdentity],
  );
  const hasElevationCourse = categoryCanHaveElevation;
  useEffect(() => {
    if (!hasElevationCourse) setElevationOpen(false);
  }, [hasElevationCourse]);
  const liveMapStartedAtRef = useRef(Date.now());
  const liveMapStartupRecordedRef = useRef(false);
  useEffect(() => {
    if (!courseMap?.hasGeometry || liveMapStartupRecordedRef.current) return;
    liveMapStartupRecordedRef.current = true;
    recordLiveMapStartupComplete(liveMapStartedAtRef.current);
  }, [courseMap?.hasGeometry]);
  useEffect(() => startLiveMapDiagnosticWindow(60_000), []);
  useEffect(() => startLiveRequestDiagnosticWindow(60_000), []);
  useEffect(() => startLivePerformanceWindow(60_000), []);

  const selectedDetailIdentity = useMemo(
    () => athleteDetailIdentity(selectedDetailAthlete ?? {}),
    [selectedDetailAthlete],
  );
  const selectedDetailHasIdentity = Boolean(
    selectedDetailIdentity.bib ||
    selectedDetailIdentity.athleteUid ||
    selectedDetailIdentity.bookingId ||
    selectedDetailIdentity.providerUuid ||
    selectedDetailIdentity.email ||
    selectedDetailIdentity.participantUuid ||
    selectedDetailIdentity.providerAthleteUuid ||
    selectedDetailIdentity.providerTimingUuid ||
    selectedDetailIdentity.providerRecordId,
  );
  const selectedParticipantUuid = firstText(
    selectedDetailIdentity.participantUuid,
    selectedDetailAthlete?.participantUuid,
  );
  const athleteQueryPendingReasonRef = useRef<{
    reason: CanonicalAthleteQueryReason;
    invalidatedAt: number;
  } | null>(null);
  const athleteQueryPreviousFetchRef = useRef(new Map<string, number>());
  const selectedAthleteRefetchRef = useRef<(() => Promise<unknown>) | null>(
    null,
  );
  const liveTrackMountedRef = useRef(false);
  useEffect(() => {
    liveTrackMountedRef.current = true;
    return () => {
      liveTrackMountedRef.current = false;
    };
  }, []);
  const recordAthleteInvalidation = useCallback(
    (reason: CanonicalAthleteQueryReason) => {
      athleteQueryPendingReasonRef.current = {
        reason,
        invalidatedAt: Date.now(),
      };
    },
    [],
  );
  const [singleFlightAthleteRefetch] = useState(() =>
    createSingleFlightRefetch(async () => {
      const refetch = selectedAthleteRefetchRef.current;
      return refetch ? refetch() : undefined;
    }),
  );
  const [selectedAthleteRequestCoordinator] = useState(() =>
    createSelectedAthleteRequestCoordinator<
      Awaited<ReturnType<typeof repositories.athlete.getDetail>>
    >(),
  );
  const requestSelectedAthleteRefresh = useCallback(
    (reason: CanonicalAthleteQueryReason) => {
      recordAthleteInvalidation(reason);
      return singleFlightAthleteRefetch();
    },
    [recordAthleteInvalidation, singleFlightAthleteRefetch],
  );
  const canonicalSocket = useCanonicalChangeSocket(
    id,
    normalizedSelectedProviderEventUuid,
    Boolean(
      id &&
      liveTrackingResolved &&
      normalizedSelectedProviderEventUuid &&
      eventScreen.queryEnabled,
    ),
    {
      selectedParticipantUuid,
      onAthleteInvalidated: requestSelectedAthleteRefresh,
    },
  );
  // Every visible tracked card owns one participant-scoped canonical read via
  // the same web endpoint as the browser. Sharing the same query key with the
  // selected detail owner lets React Query dedupe that read automatically.
  const trackedAthleteLiveQueries = useQueries({
    queries: trackedForEvent.map((athlete) => {
      const participantUuid = firstText(athlete.participantUuid);
      const providerEventUuid = normalizeProviderEventUuid(
        firstText(
          athlete.providerEventUuid,
          participantUuid.match(/^race:([^:]+):/i)?.[1],
        ),
      );
      return {
        queryKey: [
          ...queryKeys.canonicalAthlete(id, providerEventUuid, participantUuid),
          athleteDataSource,
        ],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          repositories.athlete.getDetail(
            id,
            athleteDetailIdentity(athlete),
            signal,
            "live",
            "athleteOnly",
            "initial_load",
          ),
        enabled: Boolean(
          !resultsMode &&
          eventScreen.queryEnabled &&
          athleteInteractionsEnabled &&
          providerEventUuid &&
          participantUuid,
        ),
        staleTime: Infinity,
        gcTime: 10 * 60_000,
        refetchInterval: false as const,
        refetchIntervalInBackground: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        notifyOnChangeProps: ["data", "error"] as ("data" | "error")[],
      };
    }),
  });
  const trackedAthleteLiveRevision = trackedAthleteLiveQueries
    .map((query) => query.dataUpdatedAt)
    .join(":");
  const selectedAthleteQuery = useQuery<AthleteModalResponse>({
    queryKey: [
      ...queryKeys.canonicalAthlete(
        id,
        normalizedSelectedProviderEventUuid,
        selectedParticipantUuid,
      ),
      athleteDataSource,
    ],
    queryFn: ({ signal, queryKey }) => {
      const requestAt = Date.now();
      const stableQueryKey = JSON.stringify(queryKey);
      const previousFetchAt =
        athleteQueryPreviousFetchRef.current.get(stableQueryKey) ?? null;
      const pending = athleteQueryPendingReasonRef.current;
      let reason: CanonicalAthleteQueryReason;
      if (pending) {
        reason = pending.reason;
      } else if (!previousFetchAt) {
        // A new query key is a cold participant load, not an invalidation.
        // Merely selecting an already-cached participant must never create an
        // ATHLETE_CHANGED refresh path.
        reason = "INITIAL_LOAD";
      } else if (!canonicalSocket.isConnected) {
        reason = "SOCKET_DISCONNECTED_FALLBACK";
      } else {
        // A connected, unchanged athlete can only arrive here through an
        // explicit refetch call. Every automatic invalidation sets its reason
        // before React Query executes this function.
        reason = "MANUAL_REFRESH";
      }
      athleteQueryPendingReasonRef.current = null;
      athleteQueryPreviousFetchRef.current.set(stableQueryKey, requestAt);
      if (isLiveDiagnosticsEnabled) {
        console.info(
          resultsMode ? "[results-athlete-query]" : "[mobile-live-query]",
          {
            bib: selectedDetailAthlete?.bib ?? null,
            participantUuid: selectedParticipantUuid,
            queryKey,
            reason,
            socketConnected: canonicalSocket.isConnected,
            isFocused: eventScreen.focused,
            isMounted: liveTrackMountedRef.current,
            stale: !previousFetchAt || Boolean(pending),
            invalidatedAt: pending?.invalidatedAt ?? null,
            previousFetchAt,
            // This is a UI/navigation selection key only. Provider ownership is
            // the normalized value in queryKey/providerScope below.
            navigationRouteKey: `${id}:${selectedParticipantUuid || "none"}`,
            providerScope: normalizedSelectedProviderEventUuid,
          },
        );
      }
      return selectedAthleteRequestCoordinator(
        stableQueryKey,
        (coordinatorSignal) => {
          const mobileLiveReason =
            reason === "SOCKET_PARTICIPANT_CHANGE"
              ? "socket_invalidated"
              : reason === "FOREGROUND_RECOVERY" ||
                  reason === "NETWORK_RECOVERY"
                ? "foreground"
                : reason === "MANUAL_REFRESH"
                  ? "manual_refresh"
                  : reason === "SOCKET_DISCONNECTED_FALLBACK"
                    ? "poll"
                    : "initial_load";
          const controller = new AbortController();
          const abort = () => controller.abort();
          signal.addEventListener("abort", abort, { once: true });
          coordinatorSignal.addEventListener("abort", abort, { once: true });
          return repositories.athlete
            .getDetail(
              id,
              selectedDetailIdentity,
              controller.signal,
              resultsMode ? "results" : "live",
              resultsMode ? "full" : "athleteOnly",
              mobileLiveReason,
            )
            .finally(() => {
              signal.removeEventListener("abort", abort);
              coordinatorSignal.removeEventListener("abort", abort);
            });
        },
      ).then((response) => response as AthleteModalResponse);
    },
    enabled: Boolean(
      eventScreen.queryEnabled &&
      athleteInteractionsEnabled &&
      selectedDetailAthlete &&
      selectedDetailHasIdentity &&
      normalizedSelectedProviderEventUuid &&
      selectedParticipantUuid &&
      (resultsMode ? authReady : true),
    ),
    placeholderData: selectedDetailAthlete
      ? {
          success: true,
          eventId: id,
          visibility: "PUBLIC" as const,
          liveTrackingVisibility: "PUBLIC" as const,
          athlete: {
            id:
              selectedDetailAthlete.athleteUid ||
              selectedDetailAthlete.providerUuid ||
              selectedDetailAthlete.id,
            bib: selectedDetailAthlete.bib,
            participantUuid: selectedParticipantUuid,
            providerUuid: selectedParticipantUuid,
            providerEventUuid: normalizedSelectedProviderEventUuid,
            providerContestUuid: selectedContestId,
            contestUuid: selectedContestId,
            name: selectedDetailAthlete.name,
            fullName: selectedDetailAthlete.name,
            displayName: selectedDetailAthlete.name,
            category: selectedDetailAthlete.category,
            ageGroup: selectedDetailAthlete.ageGroup,
            ageGroupName: selectedDetailAthlete.ageGroup,
            contest: selectedDetailAthlete.category,
            contestName: selectedDetailAthlete.category,
            club: selectedDetailAthlete.club,
            clubName: selectedDetailAthlete.club,
            displayClub: selectedDetailAthlete.club,
            photoURL: selectedDetailAthlete.photoUrl ?? null,
            displayPhoto: selectedDetailAthlete.photoUrl ?? null,
            profilePhotoUrl: selectedDetailAthlete.photoUrl,
            visibility: "PUBLIC" as const,
            liveTrackingVisibility: "PUBLIC" as const,
            status: selectedDetailAthlete.status || "NOT_STARTED",
            lifecycleLabel: "Loading live timing…",
            eventDate: selectedDetailAthlete.raceDate,
          },
          contestContext: {
            contest: {
              providerContestUuid:
                selectedDetailAthlete.providerContestUuid ??
                selectedDetailAthlete.contestUuid ??
                selectedDetailAthlete.contestId,
              contestUuid:
                selectedDetailAthlete.contestUuid ??
                selectedDetailAthlete.providerContestUuid ??
                selectedDetailAthlete.contestId,
              name: selectedDetailAthlete.category,
              contestName: selectedDetailAthlete.category,
            },
          },
          timingConfiguration: courseQuery.data?.timingConfiguration,
        }
      : undefined,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    // The selected-athlete single-flight owner below controls degraded
    // fallback polling. Healthy sockets never install an interval.
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    notifyOnChangeProps: ["data", "error", "isPlaceholderData"],
    structuralSharing: (current, incoming) =>
      preferFreshestAthleteResponse(current, incoming),
  });
  const selectedAthleteResponse = useMemo(() => {
    return measureActiveAthleteSwitchPhase("queryCacheLookupMs", () => {
      recordLivePerformance("queryObserverUpdates");
      const response = selectedAthleteQuery.data;
      const athlete = response?.athlete as Record<string, unknown> | undefined;
      const responseParticipantUuid = firstText(athlete?.participantUuid);
      return responseMatchesSelectedParticipant(
        responseParticipantUuid,
        selectedParticipantUuid,
      )
        ? response
        : undefined;
    });
  }, [selectedAthleteQuery.data, selectedParticipantUuid]);
  const selectedFinishSplitKey = useMemo(
    () => finishSplitRequestKey(selectedAthleteResponse),
    [selectedAthleteResponse],
  );
  const selectedAthleteCanHaveRank = !hasTerminalNonFinishStatus(
    selectedAthleteResponse,
  );
  const selectedAthleteBib = firstText(
    recordValue(selectedAthleteResponse?.athlete).bib,
    selectedDetailAthlete?.bib,
  );
  const athleteRankingsQuery = useQuery({
    queryKey: [
      ...queryKeys.leaderboard(id, {
        providerEventUuid: normalizedSelectedProviderEventUuid,
        contestUuid: selectedContestId,
        split: selectedFinishSplitKey,
        participantUuid: selectedParticipantUuid,
        bib: selectedAthleteBib,
      }),
      "athlete-detail-ranks",
    ],
    queryFn: ({ signal }) =>
      repositories.leaderboard.getLeaderboard(
        id,
        {
          providerEventUuid: normalizedSelectedProviderEventUuid,
          contestUuid: selectedContestId,
          split: selectedFinishSplitKey,
          gender: "All",
          limit: 500,
          participantUuid: selectedParticipantUuid,
          bib: selectedAthleteBib,
        },
        signal,
      ),
    enabled: Boolean(
      athleteExpanded &&
      selectedAthleteResponse &&
      normalizedSelectedProviderEventUuid &&
      selectedContestId &&
      selectedFinishSplitKey &&
      selectedAthleteCanHaveRank,
    ),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const selectedAthleteResponseWithRanks = useMemo(() => {
    if (!selectedAthleteResponse) return undefined;
    const athlete = recordValue(selectedAthleteResponse.athlete);
    const bib = firstText(athlete.bib, selectedDetailAthlete?.bib);
    const rankingRow = athleteRankingsQuery.data?.athletes?.find((candidate) =>
      leaderboardRowMatchesAthlete(
        candidate as Record<string, unknown>,
        selectedParticipantUuid,
        bib,
      ),
    ) as Record<string, unknown> | undefined;
    if (!rankingRow) return selectedAthleteResponse;
    const participantLive = recordValue(
      selectedAthleteResponse.participantLive,
    );
    const result = recordValue(selectedAthleteResponse.result);
    const canonicalRank = (...values: unknown[]) =>
      values.find((value) => {
        const parsed = Number(String(value ?? "").replace(/^#/, ""));
        return Number.isFinite(parsed) && parsed > 0;
      });
    // The canonical athlete snapshot is authoritative. The Finish board is a
    // compatibility fallback only when a canonical rank is still absent.
    const overallRank = canonicalRank(
      result.overallRank,
      athlete.overallRank,
      rankingRow.overallRank,
      rankingRow.rank,
    );
    const genderRank = canonicalRank(
      result.genderRank,
      athlete.genderRank,
      rankingRow.genderRank,
    );
    const ageGroupRank = canonicalRank(
      result.categoryRank,
      result.ageGroupRank,
      athlete.ageGroupRank,
      rankingRow.ageGroupRank,
      rankingRow.categoryRank,
    );
    const rankingPace = [
      rankingRow.paceDisplay,
      rankingRow.pace,
      rankingRow.speed,
    ]
      .map((value) => firstText(value))
      .find((value) => value && value !== "—");
    const withFinishRank = (value: unknown) =>
      Array.isArray(value)
        ? value.map((candidate) => {
            const split = recordValue(candidate);
            const splitKey = firstText(
              split.providerSplitUuid,
              split.provider_split_uuid,
              split.splitUuid,
              split.split_uuid,
              split.uuid,
              split.UUID,
              split.splitKey,
            );
            return splitKey.toLowerCase() ===
              selectedFinishSplitKey.toLowerCase()
              ? {
                  ...split,
                  rank: overallRank ?? split.rank,
                  overallRank: overallRank ?? split.overallRank,
                  genderRank: genderRank ?? split.genderRank,
                  ageGroupRank: ageGroupRank ?? split.ageGroupRank,
                  paceSpeed: split.paceSpeed ?? rankingPace,
                }
              : candidate;
          })
        : value;
    return {
      ...selectedAthleteResponse,
      athlete: {
        ...athlete,
        overallRank: overallRank ?? athlete.overallRank,
        genderRank: genderRank ?? athlete.genderRank,
        ageGroupRank: ageGroupRank ?? athlete.ageGroupRank,
        splits: withFinishRank(athlete.splits),
      },
      participantLive: {
        ...participantLive,
        overallRank: overallRank ?? participantLive.overallRank,
        genderRank: genderRank ?? participantLive.genderRank,
        ageGroupRank: ageGroupRank ?? participantLive.ageGroupRank,
        splits: withFinishRank(participantLive.splits),
      },
      result: selectedAthleteResponse.result
        ? {
            ...selectedAthleteResponse.result,
            overallRank:
              overallRank ?? selectedAthleteResponse.result.overallRank,
            genderRank: genderRank ?? selectedAthleteResponse.result.genderRank,
            categoryRank:
              ageGroupRank ?? selectedAthleteResponse.result.categoryRank,
            averagePace:
              selectedAthleteResponse.result.averagePace ?? rankingPace,
            splits: withFinishRank(selectedAthleteResponse.result.splits),
          }
        : selectedAthleteResponse.result,
    } as AthleteModalResponse;
  }, [
    athleteRankingsQuery.data?.athletes,
    selectedAthleteResponse,
    selectedDetailAthlete?.bib,
    selectedFinishSplitKey,
    selectedParticipantUuid,
  ]);
  const selectedMappedDetail = useMemo(
    () =>
      measureActiveAthleteSwitchPhase("timelineLookupMs", () =>
        selectedAthleteResponseWithRanks &&
        !selectedAthleteQuery.isPlaceholderData
          ? mapAthleteDetail(selectedAthleteResponseWithRanks)
          : selectedDetailAthlete
            ? trackedAthleteFallbackDetail(selectedDetailAthlete, id)
            : undefined,
      ),
    [
      id,
      selectedAthleteQuery.isPlaceholderData,
      selectedAthleteResponseWithRanks,
      selectedDetailAthlete,
    ],
  );
  const trackedSummaryDetailCacheRef = useRef(
    new Map<
      string,
      {
        fingerprint: string;
        detail: ReturnType<typeof trackedAthleteFallbackDetail>;
      }
    >(),
  );
  const trackedSummaryDetails = useMemo(() => {
    const cache = trackedSummaryDetailCacheRef.current;
    const activeKeys = new Set<string>();
    const details = trackedForEvent.map((athlete, index) => {
      const key = stableAthleteKey(athlete, id);
      const response = trackedAthleteLiveQueries[index]?.data as
        AthleteModalResponse | undefined;
      // The persisted watchlist row paints immediately, but the compact
      // participant snapshot is authoritative once it arrives. Include its
      // semantic revision in this outer cache key so the initial fallback
      // cannot permanently hide canonical age group/start/split fields.
      const fingerprint = [
        trackedAthleteSummaryFingerprint(athlete, id),
        response ? athletePresentationFingerprint(response) : "pending",
      ].join("\u001e");
      activeKeys.add(key);
      const cached = cache.get(key);
      if (cached?.fingerprint === fingerprint) return cached.detail;
      const responseParticipantUuid = firstText(
        (response?.athlete as Record<string, unknown> | undefined)
          ?.participantUuid,
      );
      const detail = responseMatchesSelectedParticipant(
        responseParticipantUuid,
        athlete.participantUuid,
      )
        ? mapAthleteDetail(response as AthleteModalResponse)
        : trackedAthleteFallbackDetail(athlete, id);
      cache.set(key, { fingerprint, detail });
      return detail;
    });
    for (const key of cache.keys()) {
      if (!activeKeys.has(key)) cache.delete(key);
    }
    return details;
    // dataUpdatedAt is the stable revision boundary; query observer object
    // recreation must not rebuild every card presentation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, trackedAthleteLiveRevision, trackedForEvent]);
  selectedAthleteRefetchRef.current =
    normalizedSelectedProviderEventUuid && selectedParticipantUuid
      ? () => selectedAthleteQuery.refetch({ cancelRefetch: false })
      : null;
  useEffect(() => {
    const response = selectedAthleteResponse;
    const athlete = response?.athlete as Record<string, unknown> | undefined;
    const participantUuid = firstText(
      athlete?.participantUuid,
      athlete?.providerUuid,
    );
    if (!response || !athlete || !participantUuid) return;
    const currentSelectedAthlete = selectedTrackedKey
      ? trackedForEvent.find(
          (candidate) => stableAthleteKey(candidate, id) === selectedTrackedKey,
        )
      : undefined;
    const responseIdentity: ScreenTrackedAthlete = {
      id: participantUuid,
      participantUuid,
      providerUuid: participantUuid,
      providerEventUuid: firstText(
        athlete.providerEventUuid,
        normalizedSelectedProviderEventUuid,
      ),
      bib: firstText(athlete.bib),
      name: firstText(athlete.displayName, athlete.fullName, athlete.name),
    };
    if (
      !currentSelectedAthlete ||
      !sameAthleteSelection(currentSelectedAthlete, responseIdentity)
    ) {
      if (isLiveDiagnosticsEnabled) {
        console.info("[tracking-selection] ignored stale athlete response", {
          selectedBib: currentSelectedAthlete?.bib ?? null,
          selectedParticipantUuid:
            currentSelectedAthlete?.participantUuid ?? null,
          responseBib: responseIdentity.bib || null,
          responseParticipantUuid: participantUuid,
        });
      }
      return;
    }
    const canonical: ScreenTrackedAthlete = {
      ...currentSelectedAthlete,
      id: participantUuid,
      participantUuid,
      providerUuid: participantUuid,
      providerEventUuid: firstText(
        athlete.providerEventUuid,
        normalizedSelectedProviderEventUuid,
      ),
      providerContestUuid: firstText(
        athlete.providerContestUuid,
        athlete.contestUuid,
        selectedContestId,
      ),
      bib: firstText(athlete.bib, selectedDetailAthlete?.bib),
      name: firstText(
        athlete.displayName,
        athlete.fullName,
        athlete.name,
        selectedDetailAthlete?.name,
      ),
      status: firstText(athlete.status, selectedDetailAthlete?.status),
      eventId: id,
    };
    reconcileCanonicalAthlete(canonical);
    selectedTrackedAthleteRef.current = canonical;
    setSelectedTrackedKey(stableAthleteKey(canonical, id));
  }, [
    id,
    normalizedSelectedProviderEventUuid,
    reconcileCanonicalAthlete,
    selectedAthleteResponse,
    selectedContestId,
    selectedTrackedKey,
    trackedForEvent,
  ]);
  useEffect(() => {
    if (!selectedAthleteResponse || !isLiveDiagnosticsEnabled) return;
    const detail = selectedMappedDetail;
    if (!detail) return;
    console.debug("[prediction-runtime][QUERY]", {
      bib: detail.header.bib,
      participantUuid: selectedAthleteResponse.athlete?.participantUuid ?? null,
      status: detail.header.status,
      predictionState: detail.predictionState,
      hasResult: Boolean(detail.result),
      ranks: detail.result?.ranks ?? [],
      rankedSplitCount:
        detail.result?.splits.filter((split) => Boolean(split.rank)).length ??
        0,
      activeVersion: selectedAthleteResponse.activeVersion,
      courseVersion: selectedAthleteResponse.courseVersion,
    });
    console.info("LIVE_TRACK_RENDER", {
      participantId: selectedAthleteResponse.athlete?.participantUuid ?? null,
      canonicalVersion: selectedAthleteResponse.activeVersion ?? null,
    });
  }, [selectedAthleteResponse, selectedMappedDetail]);
  const selectedAthleteRaceStatus = useMemo(
    () => selectedMappedDetail?.header.status ?? "notStarted",
    [selectedMappedDetail],
  );
  const selectedAthleteFallbackMs = athleteDetailFallbackInterval(
    selectedAthleteRaceStatus,
    canonicalSocket.isHealthy,
  );
  useEffect(() => {
    if (
      !eventScreen.pollingEnabled ||
      resultsMode ||
      selectedAthleteFallbackMs === false
    ) {
      return;
    }
    const timer = setInterval(() => {
      void requestSelectedAthleteRefresh("SOCKET_DISCONNECTED_FALLBACK");
    }, selectedAthleteFallbackMs);
    return () => clearInterval(timer);
  }, [
    eventScreen.pollingEnabled,
    requestSelectedAthleteRefresh,
    resultsMode,
    selectedAthleteFallbackMs,
  ]);

  const watchedRows = useMemo<TrackedCard[]>(
    () =>
      trackedForEvent
        .map((persistedAthlete, index) => {
          const isSelected = index === fullDetailIndex;
          const athlete =
            isSelected && selectedDetailAthlete
              ? selectedDetailAthlete
              : persistedAthlete;
          // Only the selected athlete owns canonical full detail. Every other
          // card renders the lightweight watchlist/socket summary, preventing
          // N tracked athletes from constructing complete future timelines.
          const response = isSelected ? selectedAthleteResponse : undefined;
          const canonicalResponse = response as
            NonNullable<typeof selectedAthleteResponse> | undefined;
          const sourceHasData = Boolean(response);
          const timingUnavailable = isSelected
            ? isCanonicalBuildUnavailable(selectedAthleteQuery.error)
            : false;
          const rawDetail = isSelected
            ? (selectedMappedDetail ?? trackedSummaryDetails[index])
            : trackedSummaryDetails[index];
          const hasRenderableDetail = Boolean(rawDetail);
          const ticket = resolveAthleteTicket(
            eventQuery.event,
            athlete,
            rawDetail.header.contest,
            canonicalResponse?.contestDefinition ??
              canonicalResponse?.contestContext?.contest,
          );
          const scheduledStart = scheduledStartFromTicket(
            athlete as unknown as Record<string, unknown>,
            ticket ?? {},
          );
          const ticketName = firstText(
            ticket?.ticketName,
            ticket?.name,
            ticket?.contestName,
          );
          const ticketRaceCategory = firstText(
            ticket?.ticketCategory,
            ticket?.raceCategory,
            ticket?.category,
          );
          const baseDetail =
            scheduledStart || ticketName || ticketRaceCategory
              ? {
                  ...rawDetail,
                  header: {
                    ...rawDetail.header,
                    contest: ticketName || rawDetail.header.contest,
                    raceCategory:
                      ticketRaceCategory || rawDetail.header.raceCategory,
                    scheduledStart:
                      scheduledStart || rawDetail.header.scheduledStart,
                  },
                }
              : rawDetail;
          const detail = baseDetail;
          return {
            athlete,
            // The tracked-athlete fallback already contains identity and an
            // initial timing view. Render it immediately; official splits
            // replace it as soon as the lightweight request completes.
            initialLoading: Boolean(
              isSelected &&
              !timingUnavailable &&
              !sourceHasData &&
              !hasRenderableDetail,
            ),
            // Background polling is silent. A visible loading state is reserved
            // for the initial load or an explicit user refresh.
            refreshing: false,
            cutoffs: resolveAthleteCutoffs(eventQuery.event, athlete),
            raceCategory:
              firstText(
                ticket?.ticketCategory,
                ticket?.raceCategory,
                ticket?.category,
                detail.header.raceCategory,
              ) || undefined,
            timingUnavailable,
            detail,
          };
        })
        .sort(compareTrackedCardsByOfficialRaceState),
    [
      eventQuery.event,
      fullDetailIndex,
      id,
      selectedAthleteResponse,
      selectedAthleteQuery.error,
      selectedDetailAthlete,
      selectedMappedDetail,
      trackedForEvent,
      trackedSummaryDetails,
    ],
  );
  useEffect(() => {
    setTrackedAthletePerformanceCount(watchedRows.length);
  }, [watchedRows.length]);
  useEffect(() => {
    // The compact card falls back to the first tracked row before an athlete
    // has been explicitly picked. Make that same row the map selection so a
    // background marker never appears to be the athlete currently on the
    // card. Keep an intentional card dismissal unselected.
    if (selectedTrackedKey || compactCardDismissed || !watchedRows.length) {
      return;
    }
    const initialIndex = Math.min(selectedTrackedIndex, watchedRows.length - 1);
    setSelectedTrackedIndex(initialIndex);
    setSelectedTrackedKey(
      stableAthleteKey(watchedRows[initialIndex].athlete, id),
    );
  }, [
    compactCardDismissed,
    id,
    selectedTrackedIndex,
    selectedTrackedKey,
    watchedRows,
  ]);
  const previousFinishStateRef = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    const previous = previousFinishStateRef.current;
    const next = new Map<string, boolean>();
    watchedRows.forEach((row, index) => {
      const key = stableAthleteKey(row.athlete, id);
      const finished = Boolean(
        row.detail?.result &&
        /finish|complete/i.test(row.detail.result.statusLabel),
      );
      next.set(key, finished);
      if (
        notificationsEnabled &&
        previous.has(key) &&
        previous.get(key) === false &&
        finished
      ) {
        const publicName = row.detail?.isAnonymous
          ? "Anonymous Athlete"
          : row.detail?.header.name || row.athlete.name;
        Alert.alert(
          `🏁 ${publicName} has finished!`,
          [
            `Finish Time: ${row.detail?.result?.officialTime || row.detail?.result?.chipTime || "—"}`,
            row.detail?.result?.ranks
              .map((rank) => `${rank.label}: #${rank.value}`)
              .join(" · "),
          ]
            .filter(Boolean)
            .join("\n"),
          row.detail?.isAnonymous
            ? [{ text: "Close", style: "cancel" }]
            : [
                {
                  text: "View Result",
                  onPress: () => {
                    selectedTrackedAthleteRef.current = row.athlete;
                    setSelectedTrackedIndex(index);
                    setSelectedTrackedKey(key);
                    setAthleteExpanded(true);
                    setSheetMode("full");
                  },
                },
                { text: "Close", style: "cancel" },
              ],
        );
      }
    });
    previousFinishStateRef.current = next;
  }, [id, notificationsEnabled, watchedRows]);
  const alreadyTrackedMatch = useMemo(() => {
    if (!searchEnabled) return null;
    const query = normalizeSearchText(effectiveSearch);
    if (!query) return null;
    const index = watchedRows.findIndex(({ athlete, detail }) =>
      [
        athlete.name,
        athlete.bib,
        detail?.header.name,
        detail?.header.bib,
        detail?.header.contest,
      ]
        .filter(Boolean)
        .some((value) => normalizeSearchText(value).includes(query)),
    );
    if (index < 0) return null;
    return { index, athlete: watchedRows[index].athlete };
  }, [effectiveSearch, searchEnabled, watchedRows]);
  const cutoffSummary = useMemo(
    () =>
      formatCutoffSummary(
        eventQuery.event?.cutoffMinutes,
        eventQuery.event?.cutoffs,
      ),
    [eventQuery.event?.cutoffMinutes, eventQuery.event?.cutoffs],
  );

  const toggleMapPreference = useCallback((key: keyof MapLayerPreferences) => {
    setMapPreferences((current) => ({ ...current, [key]: !current[key] }));
  }, []);
  useEffect(() => {
    if (!liveTrackingResolved || athleteInteractionsEnabled) return;
    const resetTimer = setTimeout(() => {
      setSearch("");
      setSelectedTrackedIndex(0);
      setSelectedTrackedKey(null);
      setAthleteExpanded(false);
      setElevationOpen(false);
      setSheetMode("full");
    }, 0);
    return () => clearTimeout(resetTimer);
  }, [athleteInteractionsEnabled, liveTrackingResolved]);
  const focusAthleteOnMap = useCallback(
    (index: number) => {
      if (!watchedRows.length) return;
      const bounded = Math.max(0, Math.min(index, watchedRows.length - 1));
      const nextAthlete = watchedRows[bounded].athlete;
      const nextKey = stableAthleteKey(nextAthlete, id);
      if (nextKey !== selectedTrackedKey) {
        startAthleteSwitchDerivationStats(
          firstText(nextAthlete.participantUuid, nextAthlete.id),
          2_000,
          "map_focus",
          nextAthlete.bib,
        );
        selectedTrackedAthleteRef.current = nextAthlete;
        setSelectedTrackedIndex(bounded);
        setSelectedTrackedKey(nextKey);
      }
      setAthleteExpanded(false);
      setElevationOpen(false);
      // Map focus is the primary tracking experience. Collapse the athlete
      // sheet completely so the selected marker and nearby course geometry
      // use the full viewport; the compact Track launcher restores details.
      setSheetMode("collapsed");
    },
    [id, selectedTrackedKey, watchedRows],
  );

  const selectTrackedAthlete = useCallback(
    (index: number) => {
      if (!watchedRows.length) return;
      const bounded = Math.max(0, Math.min(index, watchedRows.length - 1));
      const nextAthlete = watchedRows[bounded].athlete;
      const nextKey = stableAthleteKey(nextAthlete, id);
      if (nextKey === selectedTrackedKey) return;
      const switchStartedAt = Date.now();
      const switchGeneration = startAthleteSwitchDerivationStats(
        firstText(nextAthlete.participantUuid, nextAthlete.id),
        2_000,
        "direct_selection",
        nextAthlete.bib,
      );
      // Direct card and map-marker taps need the same synchronous identity
      // lock as arrow navigation. Without it, reconciliation can restore the
      // athlete the user was trying to leave before React commits the new key.
      selectedTrackedAthleteRef.current = nextAthlete;
      setSelectedTrackedIndex(bounded);
      setSelectedTrackedKey(nextKey);
      setElevationOpen(false);
      recordAthleteSwitchPhase(
        switchGeneration,
        "selectionDispatchMs",
        Date.now() - switchStartedAt,
      );
      if (isLiveDiagnosticsEnabled) {
        console.info("[tracking-selection] direct", {
          toBib: nextAthlete.bib,
          toParticipantUuid: nextAthlete.participantUuid ?? null,
          nextIndex: bounded,
          total: watchedRows.length,
        });
      }
    },
    [id, selectedTrackedKey, watchedRows],
  );

  const watchedIndexByKey = useMemo(() => {
    recordLivePerformance("collectionScans");
    const index = new Map<string, number>();
    watchedRows.forEach((row, rowIndex) => {
      index.set(stableAthleteKey(row.athlete, id), rowIndex);
    });
    return index;
  }, [id, watchedRows]);
  const keyedSelectedIndex = selectedTrackedKey
    ? (watchedIndexByKey.get(selectedTrackedKey) ?? -1)
    : -1;
  const safeSelectedTrackedIndex = watchedRows.length
    ? keyedSelectedIndex >= 0
      ? keyedSelectedIndex
      : Math.min(selectedTrackedIndex, watchedRows.length - 1)
    : 0;
  const selectedTrackedRow =
    selectedTrackedKey && keyedSelectedIndex >= 0
      ? watchedRows[keyedSelectedIndex]
      : undefined;
  const committedParticipantUuid = firstText(
    selectedTrackedRow?.athlete.participantUuid,
    selectedTrackedRow?.athlete.id,
  );
  useLayoutEffect(() => {
    commitAthleteSwitchDerivationStats(committedParticipantUuid);
  }, [committedParticipantUuid]);
  const selectAdjacentTrackedAthlete = useCallback(
    (direction: -1 | 1) => {
      if (watchedRows.length < 2) return;
      const currentIndex = selectedTrackedKey
        ? (watchedIndexByKey.get(selectedTrackedKey) ?? -1)
        : -1;
      const fromIndex =
        currentIndex >= 0 ? currentIndex : safeSelectedTrackedIndex;
      const nextIndex =
        (fromIndex + direction + watchedRows.length) % watchedRows.length;
      const nextAthlete = watchedRows[nextIndex].athlete;
      const nextKey = stableAthleteKey(nextAthlete, id);
      const switchStartedAt = Date.now();
      const switchGeneration = startAthleteSwitchDerivationStats(
        firstText(nextAthlete.participantUuid, nextAthlete.id),
        2_000,
        direction < 0 ? "previous_arrow" : "next_arrow",
        nextAthlete.bib,
      );
      // Lock the intended identity before React Query or watchlist
      // reconciliation can deliver a late response for the previous row.
      selectedTrackedAthleteRef.current = nextAthlete;
      setSelectedTrackedIndex(nextIndex);
      setSelectedTrackedKey(nextKey);
      setElevationOpen(false);
      recordAthleteSwitchPhase(
        switchGeneration,
        "selectionDispatchMs",
        Date.now() - switchStartedAt,
      );
      if (isLiveDiagnosticsEnabled) {
        console.info("[tracking-selection] arrow", {
          direction: direction < 0 ? "previous" : "next",
          fromParticipantUuid:
            selectedTrackedRow?.athlete.participantUuid ?? null,
          toBib: nextAthlete.bib,
          toParticipantUuid: nextAthlete.participantUuid ?? null,
          nextIndex,
          total: watchedRows.length,
        });
      }
    },
    [
      id,
      safeSelectedTrackedIndex,
      selectedTrackedKey,
      selectedTrackedRow?.athlete.participantUuid,
      watchedIndexByKey,
      watchedRows,
    ],
  );
  const trackingCardVisibilityDiagnosticRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isLiveDiagnosticsEnabled) return;
    const renderedParticipantUuid = firstText(
      selectedTrackedRow?.athlete.participantUuid,
    );
    const participantIsTracked = Boolean(
      selectedTrackedKey && keyedSelectedIndex >= 0,
    );
    const shouldRenderCard = Boolean(
      selectedTrackedKey && participantIsTracked && selectedTrackedRow,
    );
    const liveRevision = firstText(
      (
        selectedAthleteResponse?.participantLive as
          Record<string, unknown> | undefined
      )?.liveRevision,
      selectedAthleteResponse?.activeVersion,
    );
    const diagnostic = {
      selectedParticipantUuid: selectedParticipantUuid || null,
      participantIsTracked,
      selectedAthleteExists: Boolean(selectedTrackedRow),
      mobileLiveCached: Boolean(selectedAthleteResponse),
      mobileLiveQueryStatus: selectedAthleteQuery.status,
      shouldRenderCard,
      liveRevision: liveRevision || null,
    };
    const fingerprint = JSON.stringify(diagnostic);
    if (trackingCardVisibilityDiagnosticRef.current !== fingerprint) {
      trackingCardVisibilityDiagnosticRef.current = fingerprint;
      console.info("[tracking-card-visibility]", diagnostic);
    }
    if (
      selectedParticipantUuid &&
      renderedParticipantUuid &&
      selectedParticipantUuid !== renderedParticipantUuid
    ) {
      console.error("[live-track] SELECTED_ATHLETE_IDENTITY_MISMATCH", {
        selectedParticipantUuid,
        renderedParticipantUuid,
        selectedTrackedKey,
      });
    }
  }, [
    keyedSelectedIndex,
    selectedAthleteResponse,
    selectedParticipantUuid,
    selectedTrackedKey,
    selectedTrackedRow,
  ]);
  const fullAthleteDetailOpen = Boolean(
    athleteExpanded && sheetMode === "full" && selectedTrackedRow,
  );
  // The card has a safe index fallback while watchlist data is hydrating.
  // Use that resolved row for marker selection too; otherwise the card can
  // name one athlete while the map keeps a stale or missing selection key.
  const selectedMapAthleteKey = selectedTrackedRow
    ? stableAthleteKey(selectedTrackedRow.athlete, id)
    : null;
  const headerTitle = eventQuery.event?.name || "Live Tracking";
  const scheduledRaceToday = scheduledRaceFamilyToday(
    eventQuery.event?.disciplineSchedule,
  );
  const raceScheduledToday = hasRaceScheduledToday(
    eventQuery.event?.disciplineSchedule,
  );
  const selectedTicketToday = selectedTrackedRow
    ? resolveAthleteTicket(
        eventQuery.event,
        selectedTrackedRow.athlete,
        selectedTrackedRow.detail?.header.contest,
      )
    : undefined;
  const selectedRaceDate = firstText(
    selectedTrackedRow?.athlete.raceDate,
    selectedTrackedRow?.detail?.header.eventDate,
    selectedTicketToday?.eventDate,
    selectedTicketToday?.raceDate,
    selectedTicketToday?.date,
  );
  const selectedRaceScheduledToday = selectedTrackedRow
    ? raceDateKey(selectedRaceDate) === indiaDateKey()
    : raceScheduledToday;
  const activeContestToday = [
    selectedTrackedRow?.detail?.header.contest,
    selectedTicketToday?.ticketName,
    selectedTicketToday?.name,
    selectedTicketToday?.contestName,
    watchedRows[0]?.detail?.header.contest,
    selectedTrackedRow?.athlete.category,
    watchedRows[0]?.athlete.category,
  ]
    .map((value) => firstText(value))
    .find((value) => value && !isAgeGroupLabel(value));
  const hasCanonicalOnCourseTrackedAthlete = watchedRows.some(({ detail }) =>
    canRunAthleteRaceClock(detail),
  );
  const statusBannerLabel =
    !resultsMode && !hasCanonicalOnCourseTrackedAthlete
      ? "LIVE TRACKING"
      : selectedRaceScheduledToday && !resultsMode
        ? `${activeContestToday || scheduledRaceToday || "RACE"} · LIVE TODAY`
        : eventStatusLabel(
            resultsMode &&
              (eventQuery.event?.raw?.resultsPublished === true ||
                eventQuery.event?.raw?.officialResultsPublished === true ||
                String(
                  eventQuery.event?.raw?.resultState || "",
                ).toUpperCase() === "PUBLISHED")
              ? "results"
              : resultsMode
                ? "finished"
                : canonicalLiveEnabled
                  ? "live"
                  : eventQuery.event?.status,
            watchedRows.length,
            hasCanonicalOnCourseTrackedAthlete,
          );

  const mapPredictionRunning = Boolean(
    eventScreen.focused &&
    !resultsMode &&
    !fullAthleteDetailOpen &&
    watchedRows.some(
      ({ detail }) =>
        detail?.header.status === "live" &&
        detail.track &&
        detail.startTiming.showRaceClock,
    ),
  );
  // The map leaf owns the wall-clock subscription. This callback is stable
  // between canonical/watchlist/course changes, so interpolation ticks cannot
  // rerender LiveTrackScreen or revisit identity/timeline derivation.
  const buildMapAthletes = useCallback(
    (mapPredictionNowMs: number): TrackAthlete[] => {
      return measureActiveAthleteSwitchPhase("predictionMappingMs", () => {
        if (fullAthleteDetailOpen) return [];
        if (!coursePathModel) return [];
        const { cumulativePath, legPaths, mappedCourseMeters } =
          coursePathModel;
        const positionOnConfiguredCourse = (
          distanceKm: number,
          totalKm: number,
        ) => {
          if (!(mappedCourseMeters > 0) || !(totalKm > 0)) return undefined;
          let remainingMeters =
            Math.min(1, Math.max(0, distanceKm / totalKm)) * mappedCourseMeters;
          for (const entry of legPaths) {
            if (remainingMeters <= entry.path.totalMeters) {
              return positionAtFraction(
                entry.path,
                entry.path.totalMeters > 0
                  ? remainingMeters / entry.path.totalMeters
                  : 0,
              );
            }
            remainingMeters -= entry.path.totalMeters;
          }
          const finalPath = legPaths.at(-1)?.path;
          return finalPath ? positionAtFraction(finalPath, 1) : undefined;
        };
        const positionOnCurrentLeg = (
          detail: AthleteDetailViewModel | undefined,
          estimatedCourseDistanceKm: number,
        ) => {
          const activeSection = detail?.raceTiming?.sections.find(
            (section) =>
              section.type === "leg" && section.status === "in_progress",
          );
          const legKey = firstText(
            activeSection?.legType,
            activeSection?.id,
            activeSection?.title,
            detail?.raceProgress?.legLabel,
            detail?.track?.currentLeg,
          ).toLowerCase();
          const sectionDistances = (activeSection?.rows ?? [])
            .map((row) => Number(row.cumulativeDistanceKm))
            .filter((distance) => Number.isFinite(distance));
          const legStartKm =
            sectionDistances.length > 0 ? Math.min(...sectionDistances) : 0;
          const configuredLegTotal =
            sectionDistances.length > 1
              ? Math.max(...sectionDistances) - legStartKm
              : 0;
          const legTotal =
            Number(detail?.track?.currentLegDistanceKm) || configuredLegTotal;
          if (!legKey || !(legTotal > 0) || !detail?.track) return undefined;
          // Never reuse a server-side estimated leg distance here. The bounded
          // canonical course distance is the sole geographic projection, otherwise
          // a stale estimate can visually carry the marker beyond the next mat.
          const legDistance = Math.max(
            0,
            estimatedCourseDistanceKm - legStartKm,
          );
          const entry = legPaths.find(({ leg }) => {
            const segment = String(leg.segment || "").toLowerCase();
            return (
              segment === legKey ||
              segment.includes(legKey) ||
              legKey.includes(segment)
            );
          });
          return entry
            ? positionAtFraction(
                entry.path,
                Math.min(1, Math.max(0, legDistance / legTotal)),
              )
            : undefined;
        };
        // The ref-backed cache intentionally persists split fingerprints between
        // renders so each new official timing read resets interpolation once.
        const mapped = watchedRows.flatMap(({ athlete, detail }) => {
          recordLivePerformance("athletePositionDerivations");
          recordLivePerformance("predictionCalculations");
          const stableId = stableAthleteKey(athlete, id);
          const isFinished =
            detail?.header.status === "finished" ||
            /finish|complete/i.test(detail?.result?.statusLabel ?? "");
          const isPending = !Boolean(
            isFinished || detail?.liveLocation || detail?.track,
          );
          const resolvedPhoto = resolveAthletePhoto(
            {
              email: detail?.header.email ?? athlete.email,
              athleteUid: detail?.header.athleteUid ?? athlete.athleteUid,
              photoUrl: detail?.header.photo ?? athlete.photoUrl,
            },
            null,
          );
          let progressFraction = isFinished ? 1 : 0;
          let estimatedCourseDistanceKm = isFinished
            ? Number(detail?.track?.totalKm || 0)
            : 0;
          let latestOfficialKm = 0;
          let elapsedSinceAnchorMs = 0;
          let projectionState: TrackAthlete["projectionState"] = isFinished
            ? "FINISHED"
            : "NOT_STARTED";
          let projectedArrivalAt: number | undefined;
          let waitingSince: number | undefined;
          let waitingSeconds = 0;
          if (detail?.track) {
            const officialAnchor = {
              distanceKm: detail.track.seed.anchorKm,
              timeSec: detail.track.seed.anchorTimeSec,
            };
            latestOfficialKm = detail.track.seed.anchorKm;
            const liveElapsedSeconds = resolveLiveElapsedSeconds(
              {
                startTiming: detail.startTiming,
                isLive: detail.header.status === "live",
                hasResult: detail.hasOfficialResults,
              },
              mapPredictionNowMs,
            );
            const projection = checkpointBoundedPosition({
              seed: detail.track.seed,
              currentRaceElapsedSec: liveElapsedSeconds,
              raceState: isFinished
                ? "FINISHED"
                : detail.header.status === "live"
                  ? "ACTIVE"
                  : "NOT_STARTED",
              latestOfficialAt: detail.track.anchorTimestamp,
              expectedArrivalElapsedSec:
                detail.track.predictedArrivalElapsedSec,
              expectedArrivalAt: detail.track.predictedArrivalAt,
            });
            projectionState = projection.state;
            projectedArrivalAt = projection.predictedArrivalAt;
            waitingSince = projection.waitingSince;
            waitingSeconds = projection.waitingSeconds;
            elapsedSinceAnchorMs = Math.max(
              0,
              ((liveElapsedSeconds ?? officialAnchor.timeSec) -
                officialAnchor.timeSec) *
                1_000,
            );
            const distanceKm = projection.distanceKm;
            estimatedCourseDistanceKm = distanceKm;
            progressFraction = distanceToFraction(
              distanceKm,
              detail.track.totalKm,
            );
          }
          const directGpsPosition =
            !resultsMode && detail?.liveLocationSource === "GPS"
              ? detail.liveLocation
              : undefined;
          const currentLegPosition = positionOnCurrentLeg(
            detail,
            estimatedCourseDistanceKm,
          );
          const configuredCoursePosition = positionOnConfiguredCourse(
            estimatedCourseDistanceKm,
            Number(detail?.track?.totalKm || 0),
          );
          const fractionPosition = positionAtFraction(
            cumulativePath,
            progressFraction,
          );
          const courseStart = cumulativePath.points[0];
          const position =
            directGpsPosition ??
            currentLegPosition ??
            configuredCoursePosition ??
            fractionPosition ??
            courseStart;
          if (!position) return [];
          const positionSource: TrackAthlete["positionSource"] =
            directGpsPosition
              ? "live_location"
              : isFinished
                ? "canonical_finish"
                : detail?.track?.paceSource === "transition_hold" ||
                    (detail?.track && !(detail.track.seed.paceSecPerKm > 0))
                  ? "transition_hold"
                  : detail?.track &&
                      estimatedCourseDistanceKm > latestOfficialKm
                    ? "timing_interpolated"
                    : detail?.track
                      ? "canonical_split"
                      : detail?.liveLocation
                        ? "last_known"
                        : "course_start";
          return [
            {
              id: stableId,
              position,
              name: detail?.header.name ?? athlete.name,
              bib: detail?.header.bib ?? athlete.bib,
              photoUrl:
                resolvedPhoto ?? detail?.header.photo ?? athlete.photoUrl,
              colorSeed: detail?.header.colorSeed ?? athlete.id,
              selected: selectedMapAthleteKey === stableId,
              isPending,
              progressFraction,
              status: detail?.header.status,
              currentLeg: detail?.raceProgress?.legLabel,
              estimatedDistanceKm: estimatedCourseDistanceKm,
              totalDistanceKm: detail?.track?.totalKm,
              lastOfficialLabel: detail?.track
                ? `${detail.track.seed.anchorKm.toFixed(1)} km`
                : undefined,
              nextCheckpointLabel: detail?.nextSplit?.checkpoint,
              awaitingCheckpointConfirmation: Boolean(
                detail?.track &&
                projectionState === "AWAITING_CHECKPOINT_CONFIRMATION",
              ),
              positionSource,
              timingVersion: detail?.canonicalVersion ?? null,
              liveRevision: detail?.liveRevision ?? null,
              predictionState: detail?.predictionState?.raceState,
              anchorSplitKey: detail?.track?.anchorSplitKey,
              anchorDistanceKm: latestOfficialKm,
              anchorTimestamp: detail?.track?.anchorTimestamp,
              predictedPace: detail?.track?.seed.paceSecPerKm,
              elapsedSinceAnchorMs,
              serverTimeSource: detail?.track?.serverTimeSource,
              confidence: detail?.track?.predictionConfidence,
              latestOfficialSplitKey: detail?.track?.anchorSplitKey,
              latestOfficialKm,
              latestOfficialAt: detail?.track?.anchorTimestamp,
              nextCheckpointKey: detail?.track?.nextCheckpointKey,
              nextCheckpointKm: detail?.track?.nextCheckpointKm,
              interpolatedKm: estimatedCourseDistanceKm,
              predictedArrivalAt: projectedArrivalAt,
              waitingSince,
              waitingSeconds,
              paceSource: detail?.track?.paceSource,
              projectionState,
            },
          ];
        });
        return mapped;
      });
    },
    [
      coursePathModel,
      fullAthleteDetailOpen,
      id,
      resultsMode,
      selectedMapAthleteKey,
      watchedRows,
    ],
  );
  const elevationSelectedMapAthlete = useMemo(
    () =>
      elevationOpen
        ? (buildMapAthletes(elevationSnapshotNowMs).find(
            (athlete) => athlete.selected,
          ) ?? null)
        : null,
    [buildMapAthletes, elevationOpen, elevationSnapshotNowMs],
  );
  const elevationAthlete = useMemo<ElevationAthleteMarker | null>(() => {
    const detail = selectedTrackedRow?.detail;
    if (!detail?.track || !elevationSelectedMapAthlete) return null;
    const sportSections = (detail.raceTiming?.sections ?? []).filter(
      (candidate) =>
        candidate.type === "leg" &&
        /bike|run/i.test(
          firstText(candidate.legType, candidate.id, candidate.title),
        ),
    );
    const section =
      sportSections.find((candidate) => candidate.status === "in_progress") ??
      [...sportSections]
        .reverse()
        .find((candidate) => candidate.status === "completed");
    if (!section) return null;
    const routeIdentity = firstText(section.legType, section.id, section.title);
    const routeSegment = /bike/i.test(routeIdentity)
      ? "bike"
      : /run\s*2|run2/i.test(routeIdentity)
        ? "run2"
        : /run\s*1|run1/i.test(routeIdentity)
          ? "run1"
          : "run";
    const configuredDistances = section.rows
      .map((row) => row.cumulativeDistanceKm)
      .filter(
        (distance): distance is number =>
          typeof distance === "number" && Number.isFinite(distance),
      );
    if (configuredDistances.length === 0) return null;
    const legStartKm = Math.min(...configuredDistances);
    return {
      routeSegment,
      // Both map and elevation use the same continuously interpolated course
      // distance. Shared zero-distance boundaries still stop at the mat.
      distanceKm: Math.max(
        0,
        Math.min(
          Number(detail.track.currentLegDistanceKm) || Number.POSITIVE_INFINITY,
          Number(elevationSelectedMapAthlete.estimatedDistanceKm || 0) -
            legStartKm,
        ),
      ),
      label: getInitials(
        detail.header.name ?? selectedTrackedRow?.athlete.name,
      ),
      color: "#E11D48",
    };
  }, [elevationSelectedMapAthlete, selectedTrackedRow]);
  useEffect(() => {
    // Route params can outlive a Feibot event replacement and may point at an
    // old or newly-anonymous participant. Only auto-track after the active
    // canonical search endpoint verifies the bib and public visibility.
    const routedAthlete = verifiedAutoTrackAthlete;
    if (!routedAthlete || !id || !athleteInteractionsEnabled) return;
    const key = stableAthleteKey(routedAthlete, id);
    if (!key || autoTrackKeyRef.current === key) return;
    const existingIndex = watchedRows.findIndex((row) =>
      sameAthleteIdentity(row.athlete, routedAthlete),
    );
    const timeout = setTimeout(() => {
      autoTrackKeyRef.current = key;
      if (existingIndex >= 0) {
        selectedTrackedAthleteRef.current = watchedRows[existingIndex].athlete;
        const existingKey = stableAthleteKey(
          watchedRows[existingIndex].athlete,
          id,
        );
        setSelectedTrackedIndex(existingIndex);
        setSelectedTrackedKey(existingKey);
        setSearch("");
        setElevationOpen(false);
        setAthleteExpanded(false);
        setSheetMode("collapsed");
        return;
      }
      // Route navigation is view-only. Tracking membership changes are owned
      // exclusively by the explicit Track button/mutation; merely opening an
      // athlete must never POST /api/watchlist.
      setSelectedTrackedIndex(0);
      setSelectedTrackedKey(null);
      setSearch("");
      setElevationOpen(false);
      setAthleteExpanded(false);
      setSheetMode("collapsed");
    }, 0);
    return () => clearTimeout(timeout);
  }, [athleteInteractionsEnabled, id, verifiedAutoTrackAthlete, watchedRows]);

  const panelVisible = sheetMode !== "collapsed";
  const showPanel = panelVisible && !elevationOpen;
  const hasExpandedAthlete = fullAthleteDetailOpen;
  const showAthleteSearch =
    sheetMode === "full" &&
    (resultsMode ? resultsSearchOpen : !hasExpandedAthlete);
  // Nested event tabs stay mounted so their state is preserved. Render no
  // native map, sheets, animated clocks, or athlete cards while Track is
  // blurred; those children otherwise continue doing JS/UI work during the
  // next tab's transition.
  if (!eventScreen.focused) return null;
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top", "left", "right"]}
    >
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ flex: 1 }}>
          <LivePredictedCourseMap
            map={courseMap}
            loading={courseQuery.isLoading || geometryQuery.isLoading}
            predictionRunning={mapPredictionRunning}
            buildAthletes={buildMapAthletes}
            cutoffMinutes={eventQuery.event?.cutoffMinutes}
            cutoffs={eventQuery.event?.cutoffs}
            fullBleed
            refreshError={
              courseQuery.isError ||
              geometryQuery.isError ||
              courseQuery.isRefetchError ||
              geometryQuery.isRefetchError
            }
            onRetry={() => {
              void courseQuery.refetch();
              void geometryQuery.refetch();
            }}
            controlsOffsetTop={154}
            controlsOffsetRight={12}
            bottomSafeArea={
              showPanel
                ? sheetHeightFor(sheetMode)
                : compactCardDismissed
                  ? 0
                  : compactCardHeight + 24
            }
            mapPreferences={mapPreferences}
            showMapControls={false}
            mapType={mapType}
            onMapTypeChange={setMapType}
            mapDimension={mapDimension}
            onMapDimensionChange={setMapDimension}
            followSelectedAthlete
            onAthletePress={(athlete) => {
              let index = watchedRows.findIndex(
                (row) => stableAthleteKey(row.athlete, id) === athlete.id,
              );
              if (index < 0) {
                index = watchedRows.findIndex((row) =>
                  sameAthleteSelection(row.athlete, athlete),
                );
              }
              if (index >= 0) selectTrackedAthlete(index);
            }}
          />
          <CourseMapHeader
            title={headerTitle}
            notificationsEnabled={notificationsEnabled}
            settingsOpen={headerSettingsOpen}
            onToggleNotifications={() => void handleNotificationToggle()}
            onToggleSettings={() => setHeaderSettingsOpen((value) => !value)}
          />
          <EventStatusBanner label={statusBannerLabel} />
          {headerSettingsOpen ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close map settings"
              onPress={() => setHeaderSettingsOpen(false)}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          {headerSettingsOpen ? (
            <Card
              style={{
                position: "absolute",
                right: 12,
                top: 76,
                zIndex: 42,
                elevation: 42,
                width: 214,
                gap: 8,
                padding: 10,
                backgroundColor: "rgba(255,255,255,0.94)",
                borderColor: "rgba(15,23,42,0.1)",
              }}
            >
              <Text
                variant="caption"
                color="textMuted"
                style={{ fontWeight: "900", letterSpacing: 0.5 }}
              >
                MAP SETTINGS
              </Text>
              <MapSettingsToggle
                label="Course Route"
                value={mapPreferences.showRoute}
                onPress={() => toggleMapPreference("showRoute")}
              />
              <MapSettingsToggle
                label="Split Points"
                value={mapPreferences.showSplitPoints}
                onPress={() => toggleMapPreference("showSplitPoints")}
              />
              <MapSettingsToggle
                label="KM Markers"
                value={mapPreferences.showDistanceLabels}
                onPress={() => toggleMapPreference("showDistanceLabels")}
              />
              <MapSettingsToggle
                label="Athlete Labels"
                value={mapPreferences.showAthleteLabels}
                onPress={() => toggleMapPreference("showAthleteLabels")}
              />
              <MapSettingsToggle
                label={`Map Dimension · ${mapDimension === "3d" ? "3D" : "2D"}`}
                value={mapDimension === "3d"}
                onPress={() =>
                  setMapDimension((current) => (current === "3d" ? "2d" : "3d"))
                }
              />
              <View
                style={{
                  height: 1,
                  backgroundColor: "rgba(15,23,42,0.08)",
                  marginVertical: 2,
                }}
              />
              <Text
                variant="caption"
                color="textMuted"
                style={{ fontWeight: "900", letterSpacing: 0.4 }}
              >
                MAP STYLE
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {MAP_TYPE_OPTIONS.map((option) => (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityState={{ selected: mapType === option }}
                    onPress={() => setMapType(option)}
                    style={{
                      paddingHorizontal: 9,
                      paddingVertical: 7,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor:
                        mapType === option
                          ? theme.colors.accent
                          : theme.colors.border,
                      backgroundColor:
                        mapType === option
                          ? `${theme.colors.accent}16`
                          : theme.colors.surfaceSunken,
                    }}
                  >
                    <Text
                      variant="caption"
                      style={{
                        color: theme.colors.textPrimary,
                        fontWeight: "800",
                        textTransform: "capitalize",
                      }}
                    >
                      {option}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {hasElevationCourse ? (
                <Button
                  label="Elevation"
                  size="sm"
                  variant={elevationOpen ? "primary" : "secondary"}
                  onPress={() => {
                    if (elevationOpen) {
                      setElevationOpen(false);
                    } else {
                      setElevationSnapshotNowMs(Date.now());
                      setElevationOpen(true);
                    }
                    setSheetMode("collapsed");
                    setHeaderSettingsOpen(false);
                  }}
                />
              ) : null}
            </Card>
          ) : null}
          {elevationOpen && hasElevationCourse ? (
            <ElevationProfilePanel
              geometry={elevationGeometryQuery.data}
              cacheKey={JSON.stringify({
                eventId: id,
                providerEventUuid: normalizedSelectedProviderEventUuid,
                contestId: selectedContestId,
                contestName: selectedContestName,
              })}
              loading={elevationGeometryQuery.isLoading}
              error={elevationGeometryQuery.isError}
              athlete={elevationAthlete}
              onRetry={() => void elevationGeometryQuery.refetch()}
              onClose={() => setElevationOpen(false)}
            />
          ) : null}
        </View>

        <BottomSheet
          inline
          visible={showPanel}
          onClose={() => {
            setCompactCardDismissed(false);
            setSheetMode("collapsed");
          }}
          height={sheetHeightFor(sheetMode)}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              gap: theme.spacing.md,
              paddingTop: 2,
              paddingBottom: Math.max(theme.spacing.lg, 24),
            }}
            nestedScrollEnabled
            scrollEnabled
            keyboardDismissMode="on-drag"
            scrollEventThrottle={16}
            overScrollMode="always"
            removeClippedSubviews={false}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator
          >
            <View style={{ gap: theme.spacing.xs }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    variant="headline"
                    style={{ color: theme.colors.textPrimary }}
                  >
                    {resultsMode ? "Official Results" : "Live Athletes"}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {resultsMode
                      ? "Search uploaded finish and split results"
                      : "Positions are estimated between official timing points"}
                  </Text>
                </View>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  {resultsMode && !resultsSearchOpen ? (
                    <Button
                      label="Search"
                      size="sm"
                      variant="secondary"
                      onPress={() => setResultsSearchOpen(true)}
                    />
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close tracker panel"
                    onPress={() => {
                      setAthleteExpanded(false);
                      selectedTrackedAthleteRef.current =
                        watchedRows[0]?.athlete ?? null;
                      setSelectedTrackedIndex(0);
                      setSelectedTrackedKey(
                        watchedRows[0]
                          ? stableAthleteKey(watchedRows[0].athlete, id)
                          : null,
                      );
                      setCompactCardDismissed(false);
                      setSheetMode("collapsed");
                    }}
                    hitSlop={6}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#F4F8FF",
                      borderWidth: 1,
                      borderColor: "rgba(46,116,214,0.18)",
                      shadowColor: "#2E74D6",
                      shadowOpacity: 0.12,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: 1,
                    }}
                  >
                    <Text
                      variant="headline"
                      style={{ color: "#E1122A", lineHeight: 18, fontSize: 16 }}
                    >
                      ×
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {showAthleteSearch ? (
              <Card
                style={{
                  gap: theme.spacing.xs,
                  padding: theme.spacing.sm,
                  backgroundColor: "#F7FAFF",
                  borderColor: "rgba(46,116,214,0.18)",
                  shadowOpacity: 0.06,
                }}
              >
                <SearchBar
                  value={search}
                  onChangeText={(value) => {
                    setSearch(value);
                    setSubmittedSearch("");
                    setElevationOpen(false);
                    if (value.trim().length > 0 && sheetMode !== "full")
                      setSheetMode("full");
                  }}
                  onClear={() => {
                    setSearch("");
                    setSubmittedSearch("");
                  }}
                  onSubmitEditing={() => setSubmittedSearch(search.trim())}
                  placeholder={
                    resultsMode
                      ? "Search official results by name or bib"
                      : "Search athlete by name or bib"
                  }
                  dense
                />
                {resultsMode ? (
                  <Button
                    label="Close Search"
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      setSearch("");
                      setResultsSearchOpen(false);
                    }}
                  />
                ) : null}
              </Card>
            ) : null}

            {eventQuery.isError ? (
              <EmptyState
                title="Event unavailable"
                description="This event is no longer available in the public event calendar."
              />
            ) : !resultsMode &&
              liveTrackingResolved &&
              !publicAthleteVisibilityEnabled ? (
              <EmptyState
                title="Live tracking unavailable"
                description="Athlete tracking is currently unavailable."
              />
            ) : liveTrackingResolved && liveTrackingDataPending ? (
              <EmptyState
                title="Live tracking is being prepared"
                description="Athlete data is yet to be mapped. Please check again later."
              />
            ) : showAthleteSearch && searchEnabled ? (
              <View style={{ gap: theme.spacing.sm }}>
                <View style={{ minHeight: 96, gap: theme.spacing.sm }}>
                  {athleteSearch.isFetching ? (
                    <Text variant="bodySmall" color="textMuted">
                      Searching...
                    </Text>
                  ) : null}
                  {visibleSearchResults.length > 0 ? (
                    visibleSearchResults.slice(0, 8).map((athlete) => {
                      const watchedIndex = trackedResultIndex(athlete);
                      const watched = watchedIndex >= 0;
                      const resolvedPhoto = resolveAthletePhoto(
                        {
                          email: athlete.email,
                          athleteUid: athlete.athleteUid,
                          photoUrl: athlete.photoUrl,
                        },
                        null,
                      );
                      return (
                        <SearchResultCard
                          key={stableAthleteKey(athlete, id)}
                          athlete={athlete}
                          isTracked={watched}
                          photoUrl={resolvedPhoto}
                          resultsMode={resultsMode}
                          onPress={() => {
                            if (watched) {
                              const existingIndex = watchedRows.findIndex(
                                (row) =>
                                  sameAthleteIdentity(row.athlete, athlete),
                              );
                              if (existingIndex >= 0) {
                                selectTrackedAthlete(existingIndex);
                              }
                              setAthleteExpanded(false);
                              setSearch("");
                              setResultsSearchOpen(false);
                              setElevationOpen(false);
                              // Keeping the sheet visible gives immediate
                              // feedback for an already-tracked athlete and
                              // avoids an apparent navigation freeze.
                              setSheetMode("full");
                              return;
                            }
                            const trackedAthlete: ScreenTrackedAthlete = {
                              id: athlete.id,
                              bib: athlete.bib,
                              name: athlete.name,
                              eventId: id,
                              email: athlete.email,
                              category: athlete.category,
                              ageGroup: athlete.ageGroup,
                              club: athlete.club,
                              photoUrl: athlete.photoUrl,
                              providerUuid: athlete.providerUuid,
                              providerAthleteUuid: athlete.providerAthleteUuid,
                              providerTimingUuid: athlete.providerTimingUuid,
                              providerRecordId: athlete.providerRecordId,
                              participantUuid: athlete.participantUuid,
                              providerEventUuid: athlete.providerEventUuid,
                              athleteUid: athlete.athleteUid,
                              bookingId: athlete.bookingId,
                              raceDate: athlete.raceDate,
                              contestId: athlete.contestId,
                              contestUuid: athlete.contestUuid,
                              providerContestUuid: athlete.providerContestUuid,
                              canonicalContestUuid:
                                athlete.canonicalContestUuid,
                              providerContestId: athlete.providerContestId,
                              ticketId: athlete.ticketId,
                              trackingVisibility: athlete.trackingVisibility,
                              liveTrackingPrivacy: athlete.liveTrackingPrivacy,
                              privacy: athlete.privacy,
                              liveTrackingVisibility:
                                athlete.liveTrackingVisibility,
                              searchVisible: athlete.searchVisible,
                              mapVisible: athlete.mapVisible,
                              modalVisible: athlete.modalVisible,
                              anonymous: athlete.anonymous,
                            };
                            addAthlete(trackedAthlete);
                            selectedTrackedAthleteRef.current = trackedAthlete;
                            setSelectedTrackedIndex(0);
                            setSelectedTrackedKey(
                              stableAthleteKey(athlete, id),
                            );
                            setAthleteExpanded(false);
                            setSearch("");
                            setResultsSearchOpen(false);
                            setElevationOpen(false);
                            // Keep the tracker open while its first canonical
                            // detail request starts. The persisted search row
                            // renders immediately and is upgraded in place when
                            // authoritative timing arrives.
                            setSheetMode("full");
                          }}
                        />
                      );
                    })
                  ) : !athleteSearch.isFetching ? (
                    alreadyTrackedMatch ? (
                      <Card
                        style={{
                          gap: theme.spacing.sm,
                          borderRadius: theme.radius.xl,
                          borderWidth: 1,
                          borderColor: "rgba(46,116,214,0.18)",
                          backgroundColor: "#FFFFFF",
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 12,
                          }}
                        >
                          <Avatar
                            name={alreadyTrackedMatch.athlete.name}
                            uri={resolveAthletePhoto(
                              {
                                email: alreadyTrackedMatch.athlete.email,
                                athleteUid:
                                  alreadyTrackedMatch.athlete.athleteUid,
                                photoUrl: alreadyTrackedMatch.athlete.photoUrl,
                              },
                              null,
                            )}
                            size={48}
                            bordered
                          />
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text variant="headline" numberOfLines={1}>
                              {alreadyTrackedMatch.athlete.name}
                            </Text>
                            <Text
                              variant="bodySmall"
                              color="textMuted"
                              numberOfLines={1}
                            >
                              Bib {alreadyTrackedMatch.athlete.bib}
                              {alreadyTrackedMatch.athlete.club
                                ? ` · ${alreadyTrackedMatch.athlete.club}`
                                : ""}
                              {alreadyTrackedMatch.athlete.category
                                ? ` · ${alreadyTrackedMatch.athlete.category}`
                                : ""}
                            </Text>
                            <Text
                              variant="caption"
                              style={{
                                color: theme.colors.accentSecondary,
                                fontWeight: "800",
                              }}
                            >
                              Already watching · open from Active Track
                            </Text>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Untrack athlete"
                            onPress={(event) => {
                              event.stopPropagation();
                              void removeTrackedAthlete(
                                alreadyTrackedMatch.athlete,
                              );
                            }}
                            hitSlop={8}
                            style={{
                              paddingHorizontal: 10,
                              height: 30,
                              borderRadius: 999,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: "rgba(46,116,214,0.10)",
                              borderWidth: 1,
                              borderColor: "rgba(46,116,214,0.20)",
                            }}
                          >
                            <Text
                              variant="caption"
                              style={{
                                color: theme.colors.accentSecondary,
                                fontWeight: "900",
                              }}
                            >
                              Untrack
                            </Text>
                          </Pressable>
                        </View>
                      </Card>
                    ) : athleteSearch.isError ? (
                      <ErrorState
                        title="Athlete search unavailable"
                        description="The athlete search took too long. Please try again."
                        onRetry={() => {
                          void athleteSearch.refetch();
                        }}
                      />
                    ) : (
                      <EmptyState
                        title="No athletes found"
                        description={`No athletes match “${effectiveSearch}”.`}
                      />
                    )
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={{ gap: theme.spacing.xs }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    variant="caption"
                    color="textMuted"
                    style={{ letterSpacing: 0.6, textTransform: "uppercase" }}
                  >
                    {resultsMode ? "Selected results" : "Active track"}
                  </Text>
                </View>
                {watchedRows.length > 0 ? (
                  <Badge
                    label={`${watchedRows.length} tracked`}
                    variant="live"
                  />
                ) : null}
              </View>
              {hasExpandedAthlete ? (
                <SelectedAthletePanel
                  row={selectedTrackedRow}
                  eventName={eventQuery.event?.name}
                  index={safeSelectedTrackedIndex}
                  total={watchedRows.length}
                  expanded
                  onPrevious={() => selectAdjacentTrackedAthlete(-1)}
                  onNext={() => selectAdjacentTrackedAthlete(1)}
                  onExpand={() => {
                    // This callback is the expanded panel's "Hide details"
                    // action. It must not dismiss the tracker or replace the
                    // current athlete: doing either unmounts the split table
                    // immediately after a tap.
                    setAthleteExpanded(false);
                    setSheetMode("full");
                  }}
                  onViewMap={() => {
                    if (!athleteInteractionsEnabled) return;
                    focusAthleteOnMap(safeSelectedTrackedIndex);
                  }}
                  onRemove={() => {
                    if (!selectedTrackedRow) return;
                    void removeTrackedAthlete(selectedTrackedRow.athlete);
                  }}
                />
              ) : watchedRows.length > 0 ? (
                <View style={{ gap: theme.spacing.sm }}>
                  {watchedRows.map((row, index) => (
                    <TrackedAthleteListCard
                      key={stableAthleteKey(row.athlete, String(index))}
                      row={row}
                      onOpen={() => {
                        selectTrackedAthlete(index);
                        setAthleteExpanded(true);
                        setSheetMode("full");
                      }}
                      onRemove={() => void removeTrackedAthlete(row.athlete)}
                    />
                  ))}
                </View>
              ) : (
                <EmptyState
                  title={
                    resultsMode ? "No result selected" : "No athletes tracked"
                  }
                  description={
                    resultsMode
                      ? "Search the uploaded results and select an athlete to view their finish and splits."
                      : "Search for an athlete to start tracking."
                  }
                />
              )}
            </View>

            {hasExpandedAthlete && cutoffSummary.length > 0 ? (
              <Card
                style={{
                  gap: theme.spacing.xs,
                  backgroundColor: "#F7FAFF",
                  borderColor: "rgba(46,116,214,0.16)",
                }}
              >
                <Text variant="headline">Cutoff summary</Text>
                <View style={{ gap: 6 }}>
                  {cutoffSummary.map((line) => (
                    <Text key={line} variant="bodySmall" color="textSecondary">
                      {line}
                    </Text>
                  ))}
                </View>
              </Card>
            ) : null}
          </ScrollView>
        </BottomSheet>

        {sheetMode === "collapsed" &&
        selectedTrackedRow &&
        !compactCardDismissed ? (
          <CompactMapAthleteCard
            row={selectedTrackedRow}
            eventName={eventQuery.event?.name}
            index={safeSelectedTrackedIndex}
            total={watchedRows.length}
            minimized={false}
            onOpen={() => {
              selectTrackedAthlete(safeSelectedTrackedIndex);
              setAthleteExpanded(true);
              setElevationOpen(false);
              setHeaderSettingsOpen(false);
              setSheetMode("full");
            }}
            onClose={() => {
              void removeTrackedAthlete(selectedTrackedRow.athlete);
            }}
            onMinimize={() => {
              // Full-map mode keeps query/cache/socket ownership intact while
              // removing the athlete overlay from the map viewport.
              // Keep the selected athlete, query cache, and socket ownership
              // intact; only dismiss this presentation overlay. The floating
              // Track launcher remains available to reopen the athlete sheet.
              setCompactCardDismissed(true);
            }}
            onPrevious={() => selectAdjacentTrackedAthlete(-1)}
            onNext={() => selectAdjacentTrackedAthlete(1)}
            onLayout={(event) => {
              const measured = Math.ceil(event.nativeEvent.layout.height);
              setCompactCardHeight((current) =>
                current === measured ? current : measured,
              );
            }}
          />
        ) : null}

        {sheetMode === "collapsed" ? (
          <FloatingLauncher
            count={watchedRows.length}
            top={112}
            onPress={() => {
              // Full map -> compact selected-athlete card. Tapping the compact
              // card then opens the existing full tracker sheet.
              if (compactCardDismissed && selectedTrackedRow) {
                selectTrackedAthlete(safeSelectedTrackedIndex);
                setCompactCardDismissed(false);
                setAthleteExpanded(false);
                setElevationOpen(false);
                setHeaderSettingsOpen(false);
                setSheetMode("collapsed");
                return;
              }
              setAthleteExpanded(false);
              setElevationOpen(false);
              setHeaderSettingsOpen(false);
              setSheetMode("full");
            }}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

export default LiveTrackScreen;
