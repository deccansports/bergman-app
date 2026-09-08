import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner needs the explicit extension.
import { mergeAthleteStateWithoutRegression } from "./athleteCacheAuthority.ts";

test("a compact summary cannot downgrade FINISHED to NOT_STARTED", () => {
  const finished = {
    bib: "1001",
    participantUuid: "participant-1001",
    providerEventUuid: "4teGxjmX",
    providerContestUuid: "5JUm5wtI",
    status: "FINISHED",
    progressPercent: 100,
    acceptedSplitCount: 8,
    latestAcceptedSplitKey: "runfinish",
    finishAt: "2026-08-30T13:29:55.000Z",
    result: { status: "FINISHED", chipTime: "01:39:52" },
    name: "",
  };
  const merged = mergeAthleteStateWithoutRegression(finished, {
    bib: "1001",
    participantUuid: "",
    providerEventUuid: "",
    providerContestUuid: "unknown-contest",
    status: "NOT_STARTED",
    progressPercent: 0,
    acceptedSplitCount: 0,
    name: "Enriched identity",
  });
  assert.equal(merged.status, "FINISHED");
  assert.equal(merged.participantUuid, "participant-1001");
  assert.equal(merged.providerEventUuid, "4teGxjmX");
  assert.equal(merged.providerContestUuid, "5JUm5wtI");
  assert.deepEqual(merged.result, finished.result);
  assert.equal(merged.finishAt, finished.finishAt);
  assert.equal(merged.name, "Enriched identity");
});

test("rapid athlete switching keeps authority isolated by canonical UUID", () => {
  const states = new Map<string, Record<string, unknown>>();
  const select = (bib: string, participantUuid: string, status: string) => {
    const current = states.get(participantUuid) ?? {};
    states.set(
      participantUuid,
      mergeAthleteStateWithoutRegression(current, {
        bib,
        participantUuid,
        providerEventUuid: "4teGxjmX",
        providerContestUuid: "5JUm5wtI",
        status,
        progressPercent: status === "FINISHED" ? 100 : 0,
        acceptedSplitCount: status === "FINISHED" ? 8 : 0,
        finishAt:
          status === "FINISHED" ? "2026-08-30T19:00:03+05:30" : undefined,
      }),
    );
  };
  select("1001", "participant-1001", "FINISHED");
  select("1014", "participant-1014", "NOT_STARTED");
  select("1007", "participant-1007", "FINISHED");
  select("1001", "participant-1001", "NOT_STARTED");
  assert.equal(states.get("participant-1001")?.status, "FINISHED");
  assert.equal(states.get("participant-1001")?.acceptedSplitCount, 8);
  assert.equal(
    states.get("participant-1001")?.participantUuid,
    "participant-1001",
  );
  assert.equal(states.get("participant-1001")?.providerContestUuid, "5JUm5wtI");
  assert.equal(states.get("participant-1007")?.status, "FINISHED");
  assert.equal(states.get("participant-1007")?.acceptedSplitCount, 8);
  assert.equal(
    states.get("participant-1007")?.finishAt,
    "2026-08-30T19:00:03+05:30",
  );
  assert.equal(states.get("participant-1014")?.status, "NOT_STARTED");
});

test("track and untrack membership uses canonical UUIDs and clears the final card", () => {
  const tracked = ["participant-1001", "participant-1014", "participant-1007"];
  let selected: string | null = tracked[0];
  for (const participantUuid of [...tracked]) {
    const index = tracked.indexOf(participantUuid);
    tracked.splice(index, 1);
    if (selected === participantUuid) selected = tracked[0] ?? null;
  }
  assert.deepEqual(tracked, []);
  assert.equal(selected, null);
  assert.equal(Boolean(selected), false);
});

test("a compact summary cannot downgrade ACTIVE to NOT_STARTED", () => {
  const merged = mergeAthleteStateWithoutRegression(
    { status: "ACTIVE", currentLeg: "BIKE", progressPercent: 51 },
    { status: "NOT_STARTED", currentLeg: null, progressPercent: 0 },
  );
  assert.equal(merged.status, "ACTIVE");
  assert.equal(merged.currentLeg, "BIKE");
  assert.equal(merged.progressPercent, 51);
});

test("newer forward progress remains eligible to enrich the cache", () => {
  const merged = mergeAthleteStateWithoutRegression(
    { status: "ACTIVE", currentLeg: "BIKE", progressPercent: 51 },
    { status: "FINISHED", currentLeg: "FINISH", progressPercent: 100 },
  );
  assert.equal(merged.status, "FINISHED");
  assert.equal(merged.progressPercent, 100);
});
