import assert from "node:assert/strict";
import test from "node:test";

import {
  athleteSearchSingleFlightKey,
  resetAthleteSearchSingleFlightForTests,
  runAthleteSearchSingleFlight,
  snapshotAthleteSearchDiagnostics,
  // @ts-expect-error Node strip-types requires an explicit extension.
} from "./searchSingleFlight.ts";

test("identical event, mode and query share one repository request", async () => {
  resetAthleteSearchSingleFlightForTests();
  const key = athleteSearchSingleFlightKey("event-1", "BIB", " 0201 ");
  let calls = 0;
  const request = async () => {
    calls += 1;
    await Promise.resolve();
    return { participantUuid: "race:provider:contest:201" };
  };
  const [left, right] = await Promise.all([
    runAthleteSearchSingleFlight(key, request),
    runAthleteSearchSingleFlight(key, request),
  ]);
  assert.equal(calls, 1);
  assert.equal(left, right);
});

test("query identity normalizes mode, case and whitespace", () => {
  assert.equal(
    athleteSearchSingleFlightKey("event-1", "BIB", "  ABC "),
    athleteSearchSingleFlightKey("event-1", "bib", "abc"),
  );
});

test("query identity isolates provider scope and kv-only policy", () => {
  assert.notEqual(
    athleteSearchSingleFlightKey("event-1", "bib", "201", "provider-a", true),
    athleteSearchSingleFlightKey("event-1", "bib", "201", "provider-b", true),
  );
  assert.notEqual(
    athleteSearchSingleFlightKey("event-1", "bib", "201", "event-wide", true),
    athleteSearchSingleFlightKey("event-1", "bib", "201", "event-wide", false),
  );
});

test("single-flight diagnostics distinguish owners, hits and caller aborts", async () => {
  resetAthleteSearchSingleFlightForTests();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const key = athleteSearchSingleFlightKey("event-1", "bib", "4121");
  const owner = runAthleteSearchSingleFlight(key, () => pending);
  const controller = new AbortController();
  const follower = runAthleteSearchSingleFlight(
    key,
    () => Promise.resolve(),
    controller.signal,
  );
  controller.abort();
  await assert.rejects(follower, { name: "AbortError" });
  release();
  await owner;
  assert.deepEqual(snapshotAthleteSearchDiagnostics(), {
    requests: 1,
    aborts: 1,
    singleFlightHits: 1,
  });
});
