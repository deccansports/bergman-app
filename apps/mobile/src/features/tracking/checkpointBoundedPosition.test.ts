import assert from "node:assert/strict";
import test from "node:test";

import { checkpointBoundedPosition } from "./engine/interpolation";
import { snapshotLivePerformance } from "./livePerformanceDiagnostics";

const anchorAt = Date.parse("2026-09-03T08:40:00+05:30");
const segment = {
  anchorKm: 17.4,
  anchorTimeSec: 3_000,
  nextKm: 27.4,
  paceSecPerKm: 150,
  totalKm: 60,
};

test("marker interpolates between accepted A and expected B, then cannot exceed B", () => {
  const moving = checkpointBoundedPosition({
    seed: segment,
    currentRaceElapsedSec: 3_750,
    raceState: "ACTIVE",
    latestOfficialAt: anchorAt,
  });
  assert.equal(moving.state, "INTERPOLATING");
  assert.equal(moving.distanceKm, 22.4);

  const overdue = checkpointBoundedPosition({
    seed: segment,
    currentRaceElapsedSec: 9_999,
    raceState: "ACTIVE",
    latestOfficialAt: anchorAt,
  });
  assert.equal(overdue.state, "AWAITING_CHECKPOINT_CONFIRMATION");
  assert.equal(overdue.distanceKm, 27.4);
  assert.ok(overdue.distanceKm <= segment.nextKm);
});

test("waiting duration advances from the local clock without changing canonical anchor", () => {
  const atArrival = checkpointBoundedPosition({
    seed: segment,
    currentRaceElapsedSec: 4_500,
    raceState: "ACTIVE",
    latestOfficialAt: anchorAt,
  });
  const later = checkpointBoundedPosition({
    seed: segment,
    currentRaceElapsedSec: 4_654,
    raceState: "ACTIVE",
    latestOfficialAt: anchorAt,
  });
  assert.equal(atArrival.waitingSeconds, 0);
  assert.equal(later.waitingSeconds, 154);
  assert.equal(later.distanceKm, segment.nextKm);
  assert.equal(segment.anchorKm, 17.4);
});

test("real checkpoint evidence immediately re-anchors and applies its new evidence pace", () => {
  const confirmedB = checkpointBoundedPosition({
    seed: {
      anchorKm: 27.4,
      anchorTimeSec: 4_692,
      nextKm: 37.4,
      paceSecPerKm: 210,
      totalKm: 60,
    },
    currentRaceElapsedSec: 4_692,
    raceState: "ACTIVE",
    latestOfficialAt: Date.parse("2026-09-03T09:08:12+05:30"),
  });
  assert.equal(confirmedB.state, "INTERPOLATING");
  assert.equal(confirmedB.distanceKm, 27.4);
  assert.equal(confirmedB.waitingSeconds, 0);
  assert.equal(confirmedB.predictedArrivalElapsedSec, 6_792);
});

test("split correction or removal safely re-anchors to the remaining accepted checkpoint", () => {
  const corrected = checkpointBoundedPosition({
    seed: segment,
    currentRaceElapsedSec: 3_000,
    raceState: "ACTIVE",
    latestOfficialAt: anchorAt,
  });
  assert.equal(corrected.distanceKm, 17.4);
  assert.equal(corrected.state, "INTERPOLATING");
});

test("predicted finish coordinate remains awaiting until accepted finish evidence exists", () => {
  const finishSeed = {
    anchorKm: 49,
    anchorTimeSec: 10_000,
    nextKm: 50,
    paceSecPerKm: 300,
    totalKm: 50,
  };
  const predicted = checkpointBoundedPosition({
    seed: finishSeed,
    currentRaceElapsedSec: 10_400,
    raceState: "ACTIVE",
  });
  assert.equal(predicted.distanceKm, 50);
  assert.equal(predicted.state, "AWAITING_CHECKPOINT_CONFIRMATION");

  const accepted = checkpointBoundedPosition({
    seed: finishSeed,
    currentRaceElapsedSec: 10_400,
    raceState: "FINISHED",
  });
  assert.equal(accepted.state, "FINISHED");
});

test("an expected zero-distance transition can wait without advancing the leg", () => {
  const transition = checkpointBoundedPosition({
    seed: {
      anchorKm: 1.5,
      anchorTimeSec: 2_700,
      nextKm: 1.5,
      paceSecPerKm: 0,
      totalKm: 50,
    },
    currentRaceElapsedSec: 2_900,
    expectedArrivalElapsedSec: 2_820,
    raceState: "ACTIVE",
  });
  assert.equal(transition.distanceKm, 1.5);
  assert.equal(transition.waitingSeconds, 80);
  assert.equal(transition.state, "AWAITING_CHECKPOINT_CONFIRMATION");
});

test("sixty one-second interpolation ticks move then clamp without changing evidence", () => {
  const performanceBefore = snapshotLivePerformance();
  const started = {
    anchorKm: 5,
    anchorTimeSec: 600,
    nextKm: 5.5,
    paceSecPerKm: 60,
    totalKm: 10,
  };
  const ticks = Array.from({ length: 61 }, (_, second) =>
    checkpointBoundedPosition({
      seed: started,
      currentRaceElapsedSec: started.anchorTimeSec + second,
      raceState: "ACTIVE",
      latestOfficialAt: anchorAt,
    }),
  );
  assert.ok(ticks[1].distanceKm > ticks[0].distanceKm);
  assert.equal(ticks[30].distanceKm, started.nextKm);
  assert.equal(ticks[60].distanceKm, started.nextKm);
  assert.equal(ticks[60].waitingSeconds, 30);
  assert.ok(
    ticks.every(
      (tick, index) =>
        index === 0 || tick.distanceKm >= ticks[index - 1].distanceKm,
    ),
  );

  const reanchored = checkpointBoundedPosition({
    seed: {
      anchorKm: started.nextKm,
      anchorTimeSec: 660,
      nextKm: 6.5,
      paceSecPerKm: 90,
      totalKm: 10,
    },
    currentRaceElapsedSec: 661,
    raceState: "ACTIVE",
    latestOfficialAt: anchorAt + 60_000,
  });
  assert.equal(reanchored.state, "INTERPOLATING");
  assert.equal(reanchored.waitingSeconds, 0);
  assert.ok(reanchored.distanceKm > started.nextKm);

  const performanceAfter = snapshotLivePerformance();
  for (const counter of [
    "athleteDetailRequests",
    "courseResolutions",
    "gpxRequests",
    "gpxParses",
    "courseModelBuilds",
    "socketCreates",
    "socketCloses",
    "timelineDerivations",
    "identityResolutions",
  ] as const) {
    assert.equal(performanceAfter[counter] - performanceBefore[counter], 0);
  }
});
