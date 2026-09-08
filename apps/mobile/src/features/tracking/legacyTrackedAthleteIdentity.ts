export type TrackedAthleteIdentity = {
  id?: string;
  participantUuid?: string;
  providerEventUuid?: string;
  providerContestUuid?: string;
  canonicalContestUuid?: string;
  contestUuid?: string;
  bib?: string;
  name?: string;
  email?: string;
  athleteUid?: string;
  bookingId?: string;
  providerUuid?: string;
  providerAthleteUuid?: string;
  providerTimingUuid?: string;
  providerRecordId?: string;
  [key: string]: unknown;
};

export type TrackedAthleteLookup = {
  value: string;
  mode: "bib" | "name" | "email";
  kind: "bib" | "email" | "opaque" | "name";
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedBib(value: unknown): string {
  const valueText = text(value);
  return /^\d+$/.test(valueText)
    ? valueText.replace(/^0+(?=\d)/, "")
    : valueText.toLowerCase();
}

function normalizedIdentity(value: unknown): string {
  return text(value).toLowerCase();
}

function identityValues(value: TrackedAthleteIdentity): string[] {
  return [
    value.participantUuid,
    value.providerUuid,
    value.providerAthleteUuid,
    value.providerTimingUuid,
    value.providerRecordId,
    value.athleteUid,
    value.bookingId,
    value.id,
  ]
    .map(normalizedIdentity)
    .filter(Boolean);
}

export function hasCanonicalTrackedAthleteIdentity(
  athlete: TrackedAthleteIdentity | null | undefined,
): boolean {
  if (!athlete) return false;
  const participantUuid = text(athlete.participantUuid);
  const providerEventUuid =
    text(athlete.providerEventUuid) ||
    participantUuid.match(/^race:([^:]+):/i)?.[1] ||
    "";
  return Boolean(participantUuid && providerEventUuid);
}

export function hasCurrentCanonicalTrackedAthleteIdentity(
  athlete: TrackedAthleteIdentity | null | undefined,
): boolean {
  return Boolean(
    hasCanonicalTrackedAthleteIdentity(athlete) &&
    text(athlete?.canonicalContestUuid),
  );
}

export function legacyTrackedAthleteLookup(
  athlete: TrackedAthleteIdentity | null | undefined,
): TrackedAthleteLookup | null {
  if (!athlete) return null;

  // Exact search/canonical responses persist this three-part identity. Once it
  // exists, repeating a BIB lookup cannot improve scope and only adds latency.
  if (hasCurrentCanonicalTrackedAthleteIdentity(athlete)) return null;

  // A persisted race:* identity proves only that the row was canonical when it
  // was saved. Provider events can be replaced while the Bergman event and BIB
  // stay the same, leaving an otherwise well-formed historical identity in the
  // account watchlist. Re-resolve by exact BIB against the active UUID-scoped
  // canonical indexes before using the stored provider scope for live reads.
  const bib = text(athlete.bib);
  if (bib) return { value: bib, mode: "bib", kind: "bib" };

  if (hasCanonicalTrackedAthleteIdentity(athlete)) return null;

  const email = text(athlete.email);
  if (email) return { value: email, mode: "email", kind: "email" };

  const opaque = [
    athlete.providerUuid,
    athlete.providerAthleteUuid,
    athlete.providerTimingUuid,
    athlete.providerRecordId,
    athlete.athleteUid,
    athlete.bookingId,
    athlete.id,
  ]
    .map(text)
    .find(
      (value) =>
        value &&
        !/^bib:/i.test(value) &&
        value.toLowerCase() !== text(athlete.name).toLowerCase(),
    );
  if (opaque) return { value: opaque, mode: "name", kind: "opaque" };

  const name = text(athlete.name);
  return name && name.toLowerCase() !== "athlete"
    ? { value: name, mode: "name", kind: "name" }
    : null;
}

export function resolveLegacyTrackedAthlete<T extends TrackedAthleteIdentity>(
  athlete: T,
  candidates: TrackedAthleteIdentity[],
  lookup: TrackedAthleteLookup,
): (T & TrackedAthleteIdentity) | null {
  const matches = candidates.filter((candidate) => {
    if (!hasCanonicalTrackedAthleteIdentity(candidate)) return false;
    if (lookup.kind === "bib") {
      return normalizedBib(candidate.bib) === normalizedBib(lookup.value);
    }
    if (lookup.kind === "email") {
      return (
        normalizedIdentity(candidate.email) === normalizedIdentity(lookup.value)
      );
    }
    if (lookup.kind === "opaque") {
      const wanted = new Set(identityValues(athlete));
      return identityValues(candidate).some((value) => wanted.has(value));
    }
    return (
      normalizedIdentity(candidate.name) === normalizedIdentity(lookup.value)
    );
  });

  // A name is not a stable identity. Only hydrate it when the event-wide
  // search proves it is unique; otherwise require the user to select a row.
  if (matches.length !== 1) return null;
  const canonical = matches[0];
  return Object.fromEntries(
    Object.entries({ ...athlete, ...canonical }).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  ) as T & TrackedAthleteIdentity;
}

/**
 * A BIB-bearing persisted row is not live-canonical until its selected lookup
 * has resolved. This keeps historical provider UUIDs out of all live owners.
 */
export function resolvedTrackedAthleteForLiveState<
  T extends TrackedAthleteIdentity,
>(
  athlete: T | null | undefined,
  resolved: TrackedAthleteIdentity | null | undefined,
): (T & TrackedAthleteIdentity) | null {
  if (!athlete) return null;
  const lookup = legacyTrackedAthleteLookup(athlete);
  if (!lookup)
    return hasCanonicalTrackedAthleteIdentity(athlete) ? athlete : null;
  if (!resolved || !hasCanonicalTrackedAthleteIdentity(resolved)) return null;
  const resolvedBib = normalizedBib(resolved.bib);
  if (lookup.kind === "bib" && resolvedBib !== normalizedBib(lookup.value)) {
    return null;
  }
  return resolved as T & TrackedAthleteIdentity;
}
