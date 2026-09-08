import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCanonicalMinimumSegmentGap,
} from "./snapshot";
import type { CanonicalSplit, CanonicalTimingRead } from "./contracts";

const at = (clock: string) => `2026-09-05T${clock}+05:30`;
const split = (key: string, order: number, minimumSegmentSeconds?: number | null) =>
  ({ key, order, minimumSegmentSeconds } as CanonicalSplit);
const read = (key: string, clock: string) => ({
  splitKey: key,
  timestamp: at(clock),
  occurredAt: at(clock),
  elapsedSeconds: 0,
  status: "official",
  readId: `${key}:${clock}`,
} as CanonicalTimingRead);

function run(clocks: string[], thresholds = [0, 900, 900]) {
  const course = [split("start", 1, thresholds[0]), split("2km", 2, thresholds[1]), split("finish", 3, thresholds[2])];
  const accepted: CanonicalTimingRead[] = [];
  const rejected: CanonicalTimingRead[] = [];
  for (const clock of [...clocks].sort((a, b) => at(a).localeCompare(at(b)))) {
    const candidateSplit = course[accepted.length];
    if (!candidateSplit) break;
    const candidate = read(candidateSplit.key, clock);
    const decision = evaluateCanonicalMinimumSegmentGap({
      previousSplit: accepted.length ? course[accepted.length - 1] : null,
      previousRead: accepted.at(-1) ?? null,
      candidateSplit,
      candidateRead: candidate,
    });
    (decision.accepted ? accepted : rejected).push(candidate);
  }
  return { accepted, rejected, finished: accepted.at(-1)?.splitKey === "finish" };
}

test("1 duplicate after intermediate split is rejected and later finish accepted", () => {
  const result = run(["07:19:31", "08:25:50", "08:26:20", "09:31:10"]);
  assert.deepEqual(result.accepted.map((entry) => entry.timestamp), [at("07:19:31"), at("08:25:50"), at("09:31:10")]);
  assert.equal(result.rejected[0].timestamp, at("08:26:20"));
});

test("2 normal athlete accepts every split", () => assert.equal(run(["07:15:00", "08:10:00", "09:05:00"]).rejected.length, 0));

test("3 multiple short duplicate passages are rejected", () => {
  const result = run(["07:00:00", "08:00:00", "08:00:10", "08:00:30", "08:02:00", "08:55:00"]);
  assert.equal(result.rejected.length, 3);
  assert.equal(result.finished, true);
});

test("4 rejected passage does not advance the expected cursor", () => {
  const result = run(["07:00:00", "08:00:00", "08:00:30", "09:00:00"]);
  assert.equal(result.rejected[0].splitKey, "finish");
  assert.equal(result.accepted.at(-1)?.timestamp, at("09:00:00"));
});

test("5 first shared-point passage satisfies mandatory 2km, not finish", () => {
  const result = run(["07:00:00", "08:00:00"]);
  assert.deepEqual(result.accepted.map((entry) => entry.splitKey), ["start", "2km"]);
  assert.equal(result.finished, false);
});

test("6 absent threshold preserves previous behaviour", () => assert.equal(run(["07:00:00", "07:00:01", "07:00:02"], [0, 0, 0]).finished, true));

test("7 null threshold preserves previous behaviour", () => {
  const decision = evaluateCanonicalMinimumSegmentGap({ previousSplit: split("a", 1), previousRead: read("a", "08:00:00"), candidateSplit: split("b", 2, null), candidateRead: read("b", "08:00:01") });
  assert.equal(decision.accepted, true);
});

test("8 legitimate fast athlete at the threshold is accepted", () => assert.equal(run(["07:00:00", "07:15:00", "07:30:00"]).finished, true));

test("9 different discipline thresholds are evaluated per candidate split", () => {
  const previous = read("swim", "08:00:00");
  for (const [key, minimum, time, expected] of [["bike", 600, "08:09:59", false], ["run", 300, "08:05:00", true]] as const) {
    assert.equal(evaluateCanonicalMinimumSegmentGap({ previousSplit: split("swim", 1), previousRead: previous, candidateSplit: split(key, 2, minimum), candidateRead: read(key, time) }).accepted, expected);
  }
});

test("10 out-of-order arrival rebuild is timestamp deterministic", () => {
  const result = run(["09:31:10", "08:26:20", "08:25:50", "07:19:31"]);
  assert.deepEqual(result.accepted.map((entry) => entry.timestamp), [at("07:19:31"), at("08:25:50"), at("09:31:10")]);
});

test("11 impossible processed finish cannot replace later raw finish", () => {
  const result = run(["07:19:31", "08:25:50", "08:26:20", "09:31:10"]);
  assert.equal(result.accepted.at(-1)?.timestamp, at("09:31:10"));
});

test("12 rejected finish produces no finish notification eligibility", () => {
  const invalidOnly = run(["07:19:31", "08:25:50", "08:26:20"]);
  const repaired = run(["07:19:31", "08:25:50", "08:26:20", "09:31:10"]);
  assert.equal(Number(invalidOnly.finished) + Number(repaired.finished), 1);
});

test("13 rejected finish is excluded from final ranking eligibility", () => {
  assert.equal(run(["07:19:31", "08:25:50", "08:26:20"]).finished, false);
  assert.equal(run(["07:19:31", "08:25:50", "09:31:10"]).finished, true);
});

test("14 replay is idempotent", () => {
  const input = ["07:19:31", "08:25:50", "08:26:20", "09:31:10"];
  assert.deepEqual(run(input), run(input));
});
