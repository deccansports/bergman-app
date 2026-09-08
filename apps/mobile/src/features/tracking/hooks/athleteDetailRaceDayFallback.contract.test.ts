import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// @ts-expect-error Node's strip-types test runner requires the explicit .ts extension.
import * as refreshPolicy from "./athleteDetailRefreshPolicy.ts";

const {
  athleteDetailFallbackInterval,
  createSelectedAthleteRequestCoordinator,
  createSingleFlightRefetch,
  isSocketHeartbeatFresh,
  LIVE_ATHLETE_FALLBACK_MS,
  NOT_STARTED_ATHLETE_FALLBACK_MS,
  SOCKET_HEARTBEAT_STALE_MS,
} = refreshPolicy;

const liveAthlete = (status: string) => ({ athlete: { status } });

test("A: a healthy socket owns updates and installs zero interval athlete polling", () => {
  assert.equal(athleteDetailFallbackInterval(liveAthlete("LIVE"), true), false);
  assert.equal(
    athleteDetailFallbackInterval(liveAthlete("NOT_STARTED"), true),
    false,
  );
});

test("A2: ten minutes of healthy idle state schedules no athlete-detail fallback request", () => {
  for (let second = 0; second <= 10 * 60; second += 1) {
    assert.equal(
      athleteDetailFallbackInterval(liveAthlete("LIVE"), true),
      false,
    );
  }
});

test("B: a selected-participant timing notification targets the exact canonical key and one serialized refetch", async () => {
  const [socket, screen] = await Promise.all([
    readFile(new URL("./useCanonicalChangeSocket.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    socket,
    /queryKeys\.canonicalAthlete\([\s\S]*normalizedProviderEventUuid,[\s\S]*participantUuid/,
  );
  assert.match(socket, /exact: true,[\s\S]*refetchType: "none"/);
  assert.match(
    socket,
    /isSelectedParticipant[\s\S]*refreshSelectedAthlete\("SOCKET_PARTICIPANT_CHANGE"\)/,
  );
  assert.match(screen, /createSingleFlightRefetch/);
  assert.match(screen, /onAthleteInvalidated: requestSelectedAthleteRefresh/);
});

test("C: degraded LIVE uses bounded 10-second fallback, pre-start uses 30 seconds, and FINISHED never continuously polls", () => {
  assert.equal(
    athleteDetailFallbackInterval(liveAthlete("LIVE"), false),
    LIVE_ATHLETE_FALLBACK_MS,
  );
  assert.equal(LIVE_ATHLETE_FALLBACK_MS, 10_000);
  assert.equal(
    athleteDetailFallbackInterval(liveAthlete("NOT_STARTED"), false),
    NOT_STARTED_ATHLETE_FALLBACK_MS,
  );
  assert.equal(NOT_STARTED_ATHLETE_FALLBACK_MS, 30_000);
  assert.equal(
    athleteDetailFallbackInterval(
      { data: { status: "waiting_chip_start" } },
      false,
    ),
    NOT_STARTED_ATHLETE_FALLBACK_MS,
  );
  assert.equal(
    athleteDetailFallbackInterval(liveAthlete("FINISHED"), false),
    false,
  );
  assert.equal(athleteDetailFallbackInterval(liveAthlete("DNQ"), false), false);
  assert.equal(
    athleteDetailFallbackInterval(
      {
        athlete: { status: "NOT_STARTED" },
        participantLive: { resolvedRaceState: { status: "ON_COURSE" } },
      },
      false,
    ),
    LIVE_ATHLETE_FALLBACK_MS,
  );
});

test("D2: close diagnostics retain the actual CloseEvent code and reason", async () => {
  const socket = await readFile(
    new URL("./canonicalSocketRegistry.ts", import.meta.url),
    "utf8",
  );
  assert.match(socket, /socket\.onclose = \(event\)/);
  assert.match(socket, /closeCode: event\.code/);
  assert.match(socket, /closeReason: event\.reason/);
  assert.doesNotMatch(socket, /transport_close_\$\{socket\.readyState\}/);
});

test("D: stale heartbeat degrades an OPEN socket", () => {
  assert.equal(
    isSocketHeartbeatFresh({
      readyState: 1,
      openReadyState: 1,
      lastMessageAt: 1_000,
      now: 1_000 + SOCKET_HEARTBEAT_STALE_MS + 1,
    }),
    false,
  );
  assert.equal(
    isSocketHeartbeatFresh({
      readyState: 1,
      openReadyState: 1,
      lastMessageAt: 1_000,
      now: 1_001,
    }),
    true,
  );
});

test("E: reconnect reconciles immediately and healthy state removes the fallback owner", async () => {
  const [socket, registry, screen] = await Promise.all([
    readFile(new URL("./useCanonicalChangeSocket.ts", import.meta.url), "utf8"),
    readFile(new URL("./canonicalSocketRegistry.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    registry,
    /entry\.needsRecovery = false;[\s\S]*notifyRecovery\(entry, "NETWORK_RECOVERY"\)/,
  );
  assert.match(registry, /notifyRecovery\(entry, "FOREGROUND_RECOVERY"\)/);
  assert.match(socket, /refreshSelectedAthlete\(reason\)/);
  assert.match(
    screen,
    /athleteDetailFallbackInterval\([\s\S]*canonicalSocket\.isHealthy/,
  );
  assert.match(screen, /return \(\) => clearInterval\(timer\)/);
});

test("G: UI route identity cannot become socket or canonical query provider scope", async () => {
  const screen = await readFile(
    new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.match(screen, /providerScope: normalizedSelectedProviderEventUuid/);
  assert.match(
    screen,
    /useCanonicalChangeSocket\([\s\S]*normalizedSelectedProviderEventUuid/,
  );
  assert.match(
    screen,
    /queryKeys\.canonicalAthlete\([\s\S]*normalizedSelectedProviderEventUuid/,
  );
  assert.doesNotMatch(
    screen,
    /useCanonicalChangeSocket\([\s\S]{0,180}selectedTrackedKey/,
  );
});

test("F: simultaneous triggers share one athlete-detail request", async () => {
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const refetch = createSingleFlightRefetch(async () => {
    calls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await gate;
    active -= 1;
    return calls;
  });

  const requests = Array.from({ length: 50 }, () => refetch());
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(maximumActive, 1);
  release?.();
  await Promise.all(requests);
  assert.equal(calls, 1);
  assert.equal(maximumActive, 1);
});

test("F2: fifty rapid athlete switches keep max simultaneous detail requests at one", async () => {
  const coordinate = createSelectedAthleteRequestCoordinator<string>();
  let active = 0;
  let maximumActive = 0;
  const requests = Array.from({ length: 50 }, (_, index) =>
    coordinate(`athlete-${index}`, async (signal) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
      if (signal.aborted) {
        throw Object.assign(new Error("superseded"), { name: "AbortError" });
      }
      return `athlete-${index}`;
    }).catch((error: Error) => error.name),
  );
  const results = await Promise.all(requests);
  assert.equal(maximumActive, 1);
  assert.equal(results.at(-1), "athlete-49");
});

test("F3: A to B to A drops the superseded B request and reconciles the final A", async () => {
  const coordinate = createSelectedAthleteRequestCoordinator<string>();
  let active = 0;
  let maximumActive = 0;
  const run = (key: string) =>
    coordinate(key, async (signal) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (signal.aborted) {
        throw Object.assign(new Error("superseded"), { name: "AbortError" });
      }
      return key;
    }).catch((error: Error) => error.name);
  const firstA = run("A");
  const b = run("B");
  const finalA = run("A");
  assert.deepEqual(await Promise.all([firstA, b, finalA]), [
    "AbortError",
    "AbortError",
    "A",
  ]);
  assert.equal(maximumActive, 1);
});

test("G: A to B to A navigation reuses the warm exact query without selection invalidation", async () => {
  const screen = await readFile(
    new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(screen, /selectedAthleteSelectionRef/);
  assert.doesNotMatch(
    screen,
    /requestSelectedAthleteRefresh\("ATHLETE_CHANGED"\)/,
  );
  assert.doesNotMatch(screen, /reason === "ATHLETE_CHANGED"/);
  assert.match(screen, /staleTime: Infinity/);
  assert.match(screen, /refetchOnMount: false/);
  assert.match(
    screen,
    /selectedAthleteQuery\.refetch\(\{ cancelRefetch: false \}\)/,
  );
});

test("G2: navigation reset cannot issue an athlete-only request without provider and participant identity", async () => {
  const [screen, repository] = await Promise.all([
    readFile(
      new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../../core/repositories/athlete.repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(
    screen,
    /enabled: Boolean\([\s\S]*normalizedSelectedProviderEventUuid[\s\S]*selectedParticipantUuid/,
  );
  assert.match(
    screen,
    /selectedAthleteRefetchRef\.current =[\s\S]*normalizedSelectedProviderEventUuid && selectedParticipantUuid[\s\S]*: null/,
  );
  assert.match(
    repository,
    /requestType === "athleteOnly"[\s\S]*!providerEventUuid \|\| !participantUuid[\s\S]*CANONICAL_ATHLETE_IDENTITY_REQUIRED/,
  );
});

test("H: FINISHED disables only fallback polling and still accepts selected-participant corrections", async () => {
  const socket = await readFile(
    new URL("./useCanonicalChangeSocket.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    athleteDetailFallbackInterval(liveAthlete("FINISHED"), false),
    false,
  );
  assert.match(
    socket,
    /if \(isSelectedParticipant\) \{[\s\S]*refreshSelectedAthlete\("SOCKET_PARTICIPANT_CHANGE"\)/,
  );
});

test("H2: no warm canonical athlete navigation issues a redundant detail read", async () => {
  const source = await readFile(
    new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /requestSelectedAthleteRefresh\("ATHLETE_CHANGED"\)/,
  );
  assert.doesNotMatch(source, /reason === "ATHLETE_CHANGED"/);
  assert.match(source, /onAthleteInvalidated: requestSelectedAthleteRefresh/);
  assert.match(source, /SOCKET_DISCONNECTED_FALLBACK/);
});
