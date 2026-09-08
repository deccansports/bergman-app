import type { CourseGeometry, LatLng } from "@/core/types";
import { env } from "@/core/constants/env";

import { parseGpxTrack, simplifyPath } from "./gpx";
import { recordMapDiagnostic } from "./devInstrumentation";

export type CourseMapSelection = {
  ticketId?: string;
  subCategoryId?: string;
  contestId?: string;
  contestName?: string;
  providerEventUuid?: string;
  participantUuid?: string;
  bookingId?: string;
  providerUuid?: string;
  providerAthleteUuid?: string;
  providerTimingUuid?: string;
  providerRecordId?: string;
  /** Geometry-only discipline filter; never changes race timing/distances. */
  allowedSegments?: readonly ("swim" | "bike" | "run")[];
};

const BERGMAN_102_COURSE_PATTERN = /(?:^|[^a-z0-9])102(?:[^a-z0-9]|$)/i;

type LegConfig = {
  segment: string;
  gpxUrl: string;
  distanceKm?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function providerEventUuidFromSelection(
  selection?: CourseMapSelection,
): string | undefined {
  const direct = text(selection?.providerEventUuid);
  if (direct) return direct;
  for (const identity of [
    selection?.participantUuid,
    selection?.bookingId,
    selection?.providerUuid,
    selection?.providerAthleteUuid,
    selection?.providerTimingUuid,
    selection?.providerRecordId,
  ]) {
    const inferred = text(identity).match(/^race:([^:]+):/i)?.[1];
    if (inferred) return inferred;
  }
  return undefined;
}

/** Stable dependency token for configured course assets only. Live timing and
 * participant changes must not invalidate parsed geometry. */
export function courseAssetMetadataVersion(config: unknown): string {
  const assets: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (/\.gpx(?:$|[?#])/i.test(value) || /gpx(?:urls?)?$/i.test(path)) {
        assets.push(`${path}=${value}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([key, item]) => visit(item, path ? `${path}.${key}` : key));
  };
  visit(config, "");
  return assets.sort().join("|") || "no-course-assets";
}

export type CourseGeometryOwner = "pending" | "canonical" | "fallback";

export function hasConfiguredGpxAsset(value: unknown): boolean {
  if (typeof value === "string") return /\.gpx(?:$|[?#])/i.test(value);
  if (Array.isArray(value)) return value.some(hasConfiguredGpxAsset);
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some(
    hasConfiguredGpxAsset,
  );
}

/**
 * Selects one geometry owner only after the provider-scoped course request has
 * settled. Transport/error states stay pending, so event metadata cannot race
 * ahead and start fallback GPX work. A successful canonical response without
 * a usable GPX asset is a definitive geometry miss and may use the configured
 * category fallback.
 */
export function courseGeometryOwner(
  canonicalCourse: unknown,
  courseRequestSucceeded: boolean,
): CourseGeometryOwner {
  if (!courseRequestSucceeded) return "pending";
  if (canonicalCourse === null) return "fallback";

  const response = asRecord(canonicalCourse);
  if (
    response.available === false ||
    response.canonicalCourseMissing === true ||
    [
      "canonical_build_incomplete",
      "canonical_course_missing",
      "canonical_contest_missing",
      "unavailable",
    ].includes(text(response.state).toLowerCase())
  ) {
    return "fallback";
  }

  return hasConfiguredGpxAsset(response) ? "canonical" : "fallback";
}

function normalized(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function finitePositive(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeGpxUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol === "http:" &&
      parsed.hostname === "raw.githubusercontent.com"
    ) {
      parsed.protocol = "https:";
    }
    return parsed.toString();
  } catch {
    return raw.startsWith("http://raw.githubusercontent.com/")
      ? raw.replace(/^http:\/\//i, "https://")
      : raw;
  }
}

function ticketCandidates(ticket: Record<string, unknown>): string[] {
  return [
    ticket.id,
    ticket.ticketId,
    ticket.ticketDefinitionId,
    ticket.contestId,
    ticket.contestUuid,
    ticket.providerContestUuid,
    ticket.mappedContestId,
    ticket.mappedContestUuid,
    ticket.ticketName,
    ticket.name,
    ticket.label,
  ]
    .map(normalized)
    .filter(Boolean);
}

function selectionCandidates(selection?: CourseMapSelection): string[] {
  const canonicalContestUuid = [
    selection?.participantUuid,
    selection?.bookingId,
    selection?.providerUuid,
    selection?.providerAthleteUuid,
    selection?.providerTimingUuid,
    selection?.providerRecordId,
  ]
    .map((identity) => text(identity).match(/^race:[^:]+:([^:]+):/i)?.[1])
    .find(Boolean);
  return [
    selection?.ticketId,
    selection?.contestId,
    canonicalContestUuid,
    selection?.contestName,
  ]
    .map(normalized)
    .filter(Boolean);
}

function ticketFamilyMatchScore(
  ticket: Record<string, unknown>,
  requested: string[],
): number {
  let score = 0;
  for (const candidate of ticketCandidates(ticket)) {
    // Feibot creates one contest per ticket sub-category (for example
    // "Bergman Swimathon Blr - 4 Km"), while the saved GPX belongs to the
    // parent ticket ("Bergman Swimathon Blr"). Prefer the longest matching
    // parent label so a generic ticket can never beat a more specific one.
    if (
      candidate.length >= 8 &&
      requested.some(
        (value) => value.startsWith(candidate) || candidate.startsWith(value),
      )
    ) {
      score = Math.max(score, candidate.length);
    }
  }
  return score;
}

function readTicketDefinitions(
  root: Record<string, unknown>,
): Record<string, unknown>[] {
  const courseMapsEnvelope = asRecord(root.courseMaps);
  const raw = Array.isArray(root.ticketDefinitions)
    ? root.ticketDefinitions
    : Array.isArray(courseMapsEnvelope.ticketDefinitions)
      ? courseMapsEnvelope.ticketDefinitions
      : [];
  return raw.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

/**
 * Resolves the event's BERGMAN 102 ticket as a geometry-only master course.
 * The returned identity must never be used for athlete timing, distances, or
 * race-flow selection; those remain scoped to the athlete's actual contest.
 */
export function resolveBergman102MasterCourseSelection(
  config: unknown,
): CourseMapSelection | undefined {
  const envelope = asRecord(config);
  const canonicalMap = asRecord(envelope.map);
  const root =
    Array.isArray(canonicalMap.contests) ||
    Array.isArray(canonicalMap.ticketDefinitions)
      ? canonicalMap
      : envelope;

  const ticket = readTicketDefinitions(root).find((candidate) =>
    [candidate.ticketName, candidate.name, candidate.label]
      .map(text)
      .some((label) => BERGMAN_102_COURSE_PATTERN.test(label)),
  );
  if (ticket) {
    return {
      ticketId:
        text(ticket.id ?? ticket.ticketId ?? ticket.ticketDefinitionId) ||
        undefined,
      contestId:
        text(
          ticket.providerContestUuid ?? ticket.contestUuid ?? ticket.contestId,
        ) || undefined,
      contestName:
        text(ticket.ticketName ?? ticket.name ?? ticket.label) || undefined,
    };
  }

  const contest = (
    Array.isArray(root.contests) ? root.contests.map(asRecord) : []
  ).find((candidate) =>
    [candidate.displayName, candidate.contestName, candidate.name]
      .map(text)
      .some((label) => BERGMAN_102_COURSE_PATTERN.test(label)),
  );
  if (!contest) return undefined;
  return {
    ticketId: text(contest.bergmanTicketId ?? contest.ticketId) || undefined,
    contestId:
      text(contest.providerContestUuid ?? contest.contestUuid ?? contest.id) ||
      undefined,
    contestName:
      text(contest.displayName ?? contest.contestName ?? contest.name) ||
      undefined,
  };
}

function selectTicket(
  root: Record<string, unknown>,
  tickets: Record<string, unknown>[],
  selection?: CourseMapSelection,
): Record<string, unknown> | undefined {
  const requested = selectionCandidates(selection);
  if (requested.length > 0) {
    const exact = tickets.find((ticket) =>
      ticketCandidates(ticket).some((candidate) =>
        requested.includes(candidate),
      ),
    );
    if (exact) return exact;
    const familyMatch = tickets
      .map((ticket) => ({
        ticket,
        score: ticketFamilyMatchScore(ticket, requested),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (familyMatch) return familyMatch.ticket;
    // A tracked athlete is an explicit course scope. Never fall back to an
    // arbitrary event ticket because that can combine another contest's GPX
    // and elevation data with the selected athlete. A one-ticket event is the
    // exception: Feibot search rows may only expose the provider contest UUID,
    // while the saved Bergman course is keyed by the ticket ID. There is no
    // alternate course to select in that case.
    if (tickets.length === 1) return tickets[0];
    return undefined;
  }

  const primaryId = normalized(
    root.primaryTicketId ?? asRecord(root.courseMaps).primaryTicketId,
  );
  if (primaryId) {
    const primary = tickets.find((ticket) =>
      ticketCandidates(ticket).includes(primaryId),
    );
    if (primary) return primary;
  }
  return tickets[0];
}

function selectCanonicalContest(
  root: Record<string, unknown>,
  selection?: CourseMapSelection,
): Record<string, unknown> | undefined {
  const contests = Array.isArray(root.contests)
    ? root.contests.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const requested = selectionCandidates(selection);
  if (requested.length > 0) {
    const exact = contests.find((contest) =>
      [
        contest.providerContestUuid,
        contest.contestUuid,
        contest.id,
        contest.bergmanTicketId,
        contest.displayName,
        contest.contestName,
        contest.name,
      ]
        .map(normalized)
        .some((candidate) => requested.includes(candidate)),
    );
    if (exact) return exact;
    return undefined;
  }
  return contests[0];
}

/** Select a distance-specific map before using the parent ticket fallback.
 * Feibot contest labels commonly include the distance (for example, “2 Km”),
 * so the same scoped selection candidates also identify the saved Bergman
 * subcategory without inventing a cross-category route. */
function selectSubCategory(
  ticket: Record<string, unknown>,
  selection?: CourseMapSelection,
): Record<string, unknown> | undefined {
  const rows = Array.isArray(ticket.subCategories)
    ? ticket.subCategories.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  if (!rows.length) return undefined;

  const requested = [
    selection?.subCategoryId,
    ...selectionCandidates(selection),
  ]
    .map(normalized)
    .filter(Boolean);
  if (!requested.length) return undefined;

  return rows
    .map((subcategory) => {
      const candidates = [subcategory.id, subcategory.name, subcategory.label]
        .map(normalized)
        .filter(Boolean);
      const score = candidates.reduce((best, candidate) => {
        if (requested.includes(candidate))
          return Math.max(best, 10_000 + candidate.length);
        if (
          candidate.length >= 2 &&
          requested.some(
            (value) => value.includes(candidate) || candidate.includes(value),
          )
        ) {
          return Math.max(best, candidate.length);
        }
        return best;
      }, 0);
      return { subcategory, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.subcategory;
}

function addLeg(
  legs: LegConfig[],
  segment: string,
  gpxUrl: unknown,
  distanceKm?: unknown,
) {
  const url = normalizeGpxUrl(gpxUrl);
  if (!url) return;
  legs.push({ segment, gpxUrl: url, distanceKm: finitePositive(distanceKm) });
}

/**
 * Reads GPX URLs only from the selected ticket definition. Race Flow split
 * arrays and legacy `courseMaps.*Splits` fields are deliberately ignored.
 */
export function extractCourseConfig(
  config: unknown,
  selection?: CourseMapSelection,
): { name?: string; ticketId?: string; legs: LegConfig[] } {
  const envelope = asRecord(config);
  const canonicalMap = asRecord(envelope.map);
  const root =
    Array.isArray(canonicalMap.contests) ||
    Array.isArray(canonicalMap.ticketDefinitions)
      ? canonicalMap
      : envelope;
  const tickets = readTicketDefinitions(root);
  const ticket = selectTicket(root, tickets, selection);
  if (!ticket) {
    const contest = selectCanonicalContest(root, selection);
    if (!contest) return { legs: [] };
    const legs: LegConfig[] = [];
    for (const value of Array.isArray(contest.legs) ? contest.legs : []) {
      const leg = asRecord(value);
      const urls = Array.isArray(leg.gpxUrls) ? leg.gpxUrls : [];
      addLeg(
        legs,
        text(leg.type ?? leg.key ?? leg.legType) || "course",
        leg.gpxUrl ?? urls[0],
        leg.distanceKm,
      );
    }
    const allowed = new Set(selection?.allowedSegments ?? []);
    return {
      name:
        text(contest.displayName ?? contest.contestName ?? contest.name) ||
        undefined,
      ticketId:
        text(
          contest.bergmanTicketId ??
            contest.providerContestUuid ??
            contest.contestUuid ??
            contest.id,
        ) || undefined,
      legs:
        allowed.size > 0
          ? legs.filter((leg) =>
              allowed.has(
                (/swim/i.test(leg.segment)
                  ? "swim"
                  : /bike|cycle/i.test(leg.segment)
                    ? "bike"
                    : "run") as "swim" | "bike" | "run",
              ),
            )
          : legs,
    };
  }

  const subCategory = selectSubCategory(ticket, selection);
  // A distance map is only used when the tracked athlete/contest resolves to
  // that subcategory. Parent ticket assets remain the explicit fallback.
  const maps = asRecord(subCategory?.courseMaps ?? ticket.courseMaps);
  const legs: LegConfig[] = [];
  addLeg(legs, "swim", maps.swimGpxUrl, maps.swimDistance);
  addLeg(legs, "bike", maps.bikeGpxUrl, maps.bikeDistance);

  if (normalizeGpxUrl(maps.runGpxUrl)) {
    addLeg(legs, "run", maps.runGpxUrl, maps.runDistance);
  } else {
    addLeg(legs, "run1", maps.run1GpxUrl, maps.run1Distance);
    addLeg(legs, "run2", maps.run2GpxUrl, maps.run2Distance);
  }

  const allowed = new Set(selection?.allowedSegments ?? []);
  const selectedLegs =
    allowed.size > 0
      ? legs.filter((leg) =>
          allowed.has(
            (/swim/i.test(leg.segment)
              ? "swim"
              : /bike|cycle/i.test(leg.segment)
                ? "bike"
                : "run") as "swim" | "bike" | "run",
          ),
        )
      : legs;
  return {
    name:
      text(subCategory?.name ?? ticket.ticketName ?? ticket.name) || undefined,
    ticketId: text(ticket.id ?? ticket.ticketId) || undefined,
    legs: selectedLegs,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

const parsedGpxByUrl = new Map<string, Promise<LatLng[]>>();

function cachedGpxTrack(
  url: string,
  fetchText: (url: string) => Promise<string>,
): Promise<LatLng[]> {
  const cached = parsedGpxByUrl.get(url);
  if (cached) return cached;
  recordMapDiagnostic("gpxLoad", "new-gpx-url");
  const proxyUrl = `${env.mobileApiBaseUrl.replace(/\/$/, "")}/api/proxy-gpx?url=${encodeURIComponent(url)}`;
  const candidates = url.includes("/api/proxy-gpx?") ? [url] : [proxyUrl, url];
  const pending = (async () => {
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        recordMapDiagnostic("gpxRequest", "gpx-network-request");
        const xml = await fetchText(candidate);
        recordMapDiagnostic("gpxParse", "gpx-parse-attempt");
        const parsed = parseGpxTrack(xml);
        if (parsed.length > 1) return parsed;
        lastError = new Error(
          `GPX contained ${parsed.length} usable track point(s).`,
        );
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("GPX course could not be loaded.");
  })();
  parsedGpxByUrl.set(url, pending);
  void pending.catch(() => {
    if (parsedGpxByUrl.get(url) === pending) parsedGpxByUrl.delete(url);
  });
  return pending;
}

/** Fetches and parses only the selected ticket's GPX routes. Marker placement
 * is performed later from `timingPointDisplayConfig.points`.
 */
export async function resolveCourseGeometry(
  config: unknown,
  fetchText: (url: string) => Promise<string>,
  selection?: CourseMapSelection,
): Promise<CourseGeometry | undefined> {
  const { name, ticketId, legs } = extractCourseConfig(config, selection);
  if (legs.length === 0) return undefined;

  const routes = await Promise.all(
    legs.map(async (leg) => {
      try {
        const parsed = await cachedGpxTrack(leg.gpxUrl, fetchText);
        const simplified = simplifyPath(parsed);
        if (process.env.NODE_ENV !== "production") {
          console.info("[course-geometry] GPX parsed", {
            segment: leg.segment,
            points: parsed.length,
            simplifiedPoints: simplified.length,
          });
        }
        return { parsed, simplified, loadError: false };
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (process.env.NODE_ENV !== "production") {
          console.warn("[course-geometry] GPX fetch failed", {
            segment: leg.segment,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return {
          parsed: [] as LatLng[],
          simplified: [] as LatLng[],
          loadError: true,
        };
      }
    }),
  );

  const geometryLegs = legs.map<CourseGeometry["legs"][number]>(
    (leg, index) => ({
      segment: leg.segment,
      path: routes[index].simplified,
      elevationPath: routes[index].parsed,
      gpxUrl: leg.gpxUrl,
      loadError: routes[index].loadError,
      distanceKm: leg.distanceKm,
    }),
  );

  return {
    contestId: ticketId,
    name,
    legs: geometryLegs,
    markers: [],
  };
}
