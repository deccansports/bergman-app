import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("large canonical participant index uses recovery polling instead of one-second polling", async () => {
  const source = await readFile(
    new URL("./useCanonicalTracking.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /CANONICAL_PARTICIPANT_RECOVERY_INTERVAL_MS = 30_000/);
  assert.match(
    source,
    /refetchInterval: polling\s*\? CANONICAL_PARTICIPANT_RECOVERY_INTERVAL_MS\s*: false/,
  );
  assert.match(source, /refetchIntervalInBackground: false/);
});

test("athlete-detail recovery polling is bounded while socket updates remain the fast path", async () => {
  const [keys, queries, canonical] = await Promise.all([
    readFile(new URL("./trackingKeys.ts", import.meta.url), "utf8"),
    readFile(new URL("./useTrackingQueries.ts", import.meta.url), "utf8"),
    readFile(new URL("./useCanonicalTracking.ts", import.meta.url), "utf8"),
  ]);

  assert.match(keys, /athleteDetailRefetchMs: 12000/);
  assert.doesNotMatch(keys, /athleteDetailRefetchMs: 1000/);
  assert.match(queries, /TRACKING_INTERVALS\.athleteDetailRefetchMs/);
  assert.match(canonical, /refetchInterval: polling \? 10_000 : false/);
  assert.doesNotMatch(canonical, /refetchInterval: polling \? 1_000 : false/);
});

test("canonical availability uses the lightweight status artifact instead of downloading course geometry", async () => {
  const source = await readFile(
    new URL(
      "../../../core/repositories/canonicalTracking.repository.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /getCanonicalStatus/);
  assert.match(source, /canonical\/status/);
  assert.match(source, /resolveCanonicalAvailability[\s\S]*getCanonicalStatus/);
});

test("tracked athlete splits use the UUID-scoped lightweight path before optional resources", async () => {
  const [repository, screen, worker] = await Promise.all([
    readFile(
      new URL(
        "../../../core/repositories/athlete.repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../../features/events/components/LiveTrackScreen.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../../../../../cloudflare/live-tracking-worker/src/canonical-read-routes.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(repository, /providerEventUuid[\s\S]*\^race:\(\[\^:\]\+\):\/i/);
  assert.match(
    repository,
    /bib: participantUuid \|\| providerUuid \? undefined : normalized\.bib/,
  );
  assert.match(
    screen,
    /const courseQuery = useCourseMap\([\s\S]*eventQuery\.event &&[\s\S]*selectedProviderEventUuid &&[\s\S]*!configuredBergman102MasterSelection/,
  );
  assert.match(
    screen,
    /initialLoading: Boolean\([\s\S]*isSelected &&[\s\S]*!timingUnavailable &&[\s\S]*!sourceHasData &&[\s\S]*!hasRenderableDetail/,
  );
  assert.match(
    worker,
    /const athleteOnly = url\.searchParams\.get\(["']athleteOnly["']\) === ["']1["']/,
  );
  assert.match(worker, /let course = athleteOnly[\s\S]*\? null/);
});

test("unchanged UUID-scoped participant indexes restore from persistent cache without a network download", async () => {
  const [hook, courseRepository] = await Promise.all([
    readFile(new URL("./useCanonicalTracking.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../../core/repositories/course.repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(
    hook,
    /bergman:canonical-participants:\$\{eventId\}:\$\{providerEventUuid \|\| ["']event-wide["']\}:\$\{activeVersion\}/,
  );
  assert.ok(
    hook.indexOf("AsyncStorage.getItem(storageKey)") <
      hook.indexOf("CanonicalTrackingRepository.getCanonicalParticipants"),
  );
  assert.match(
    hook,
    /AsyncStorage\.setItem\(storageKey, JSON\.stringify\(result\.data\)\)/,
  );
  assert.match(courseRepository, /PROVIDER_EVENT_UUID_REQUIRED/);
  assert.doesNotMatch(courseRepository, /if \(providerEventUuid\) throw error/);
});

test("multi-UUID athlete navigation preserves scope and deterministic error semantics", async () => {
  const [repository, worker, queries, mapper, watchlist] = await Promise.all([
    readFile(
      new URL(
        "../../../core/repositories/athlete.repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../../../../../cloudflare/live-tracking-worker/src/canonical-read-routes.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("./useTrackingQueries.ts", import.meta.url), "utf8"),
    readFile(new URL("../mappers.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../watchlist/hooks/useWatchlist.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    repository,
    /normalized\.participantUuid[\s\S]*\[normalized\.bookingId, normalized\.providerUuid\]\.find\(\(value\) =>[\s\S]*\/\^race:\/i/,
  );
  assert.match(
    repository,
    /participantUuid\?\.match\(\/\^race:\(\[\^:\]\+\):\/i\)/,
  );
  assert.match(worker, /state: ["']canonical_scope_required["']/);
  assert.match(worker, /\[CANONICAL ATHLETE SCOPE\]/);
  assert.match(
    worker,
    /providerScopedCanonicalKey\(eventId, providerEventUuid/,
  );
  assert.match(worker, /live:event:\$\{eventId\}:participant:index/);
  assert.match(worker, /resolveCanonicalProviderScope/);
  assert.match(
    queries,
    /status === 400[\s\S]*status === 409[\s\S]*return false/,
  );
  assert.match(
    mapper,
    /category: m\.contestName \?\? m\.contest \?\? m\.category/,
  );
  assert.match(watchlist, /providerEventUuid:/);
  assert.match(watchlist, /canonicalContestUuid:/);
});
