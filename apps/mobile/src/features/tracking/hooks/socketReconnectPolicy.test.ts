import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner needs the explicit extension.
import { nextSocketReconnectDecision } from "./socketReconnectPolicy.ts";

test("transport failures use two bounded retries before cooldown", () => {
  assert.deepEqual(nextSocketReconnectDecision(0, 1_000), {
    kind: "retry",
    attempts: 1,
    delayMs: 1_000,
  });
  assert.deepEqual(nextSocketReconnectDecision(1, 1_000), {
    kind: "retry",
    attempts: 2,
    delayMs: 2_000,
  });
  assert.deepEqual(nextSocketReconnectDecision(2, 1_000), {
    kind: "cooldown",
    attempts: 3,
    delayMs: 60_000,
    until: 61_000,
  });
});

test("a failed cooldown probe returns directly to cooldown", () => {
  assert.deepEqual(nextSocketReconnectDecision(3, 70_000, true), {
    kind: "cooldown",
    attempts: 4,
    delayMs: 60_000,
    until: 130_000,
  });
});

test("three minutes of failed transport creates only initial, two retries, and two probes", () => {
  const windowEnd = 180_000;
  let now = 0;
  let failures = 0;
  let socketCreates = 1;
  for (;;) {
    const decision = nextSocketReconnectDecision(failures, now);
    failures = decision.attempts;
    if (decision.kind === "retry") {
      now += decision.delayMs;
      socketCreates += 1;
      continue;
    }
    now = decision.until;
    break;
  }
  while (now < windowEnd) {
    socketCreates += 1;
    const failedProbe = nextSocketReconnectDecision(failures, now, true);
    assert.equal(failedProbe.kind, "cooldown");
    failures = failedProbe.attempts;
    now = failedProbe.kind === "cooldown" ? failedProbe.until : windowEnd;
  }
  assert.equal(socketCreates, 5);
});
