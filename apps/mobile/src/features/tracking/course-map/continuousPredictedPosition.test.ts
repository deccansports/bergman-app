import assert from "node:assert/strict";
import test from "node:test";

import {
  checkpointBoundedPosition,
  conservativePaceSecPerKm,
  distanceToFraction,
  type TrackSeed,
} from "../engine/interpolation";
import { buildCumulativePath, positionAtFraction } from "../engine/geo";

const seed = (overrides: Partial<TrackSeed> = {}): TrackSeed => ({
  anchorKm: 20,
  anchorTimeSec: 2_280,
  nextKm: 30,
  paceSecPerKm: 108,
  totalKm: 40,
  ...overrides,
});

test("NOT_STARTED stays exactly at course start without accepted evidence", () => {
  assert.deepEqual(checkpointBoundedPosition({ raceState: "NOT_STARTED" }), {
    distanceKm: 0,
    interpolatedKm: 0,
    waitingSeconds: 0,
    state: "NOT_STARTED",
  });
});

test("START-only holds unless a canonical pace model already exists", () => {
  const hold = checkpointBoundedPosition({
    raceState: "ACTIVE",
    seed: seed({ anchorKm: 0, anchorTimeSec: 0, paceSecPerKm: 0 }),
    currentRaceElapsedSec: 300,
  });
  assert.equal(hold.distanceKm, 0);

  const configured = conservativePaceSecPerKm({
    sectionPaces: [],
    canonicalPaceSecPerKm: 600,
  });
  assert.equal(configured.source, "canonical_model");
  assert.equal(configured.paceSecPerKm, 600);
});

test("recent accepted sections use the conservative hierarchy", () => {
  assert.deepEqual(conservativePaceSecPerKm({ sectionPaces: [120] }), {
    paceSecPerKm: 120,
    source: "elapsed_section",
    confidence: "MEDIUM",
  });
  assert.equal(
    conservativePaceSecPerKm({ sectionPaces: [120, 108] }).paceSecPerKm,
    108,
  );
  assert.equal(
    conservativePaceSecPerKm({ sectionPaces: [120, 108, 96] }).paceSecPerKm,
    104,
  );
});

test("07:47 projection advances from the 20 km 07:38 anchor on course", () => {
  const projected = checkpointBoundedPosition({
    raceState: "ACTIVE",
    seed: seed(),
    currentRaceElapsedSec: 2_820,
  });
  assert.equal(projected.distanceKm, 25);
  assert.equal(projected.state, "INTERPOLATING");

  const path = buildCumulativePath([
    { lat: 12.9, lng: 77.5 },
    { lat: 12.9, lng: 77.6 },
  ]);
  const coordinate = positionAtFraction(
    path,
    distanceToFraction(projected.distanceKm, 40),
  );
  assert.ok(coordinate.lng > 77.5 && coordinate.lng < 77.6);
});

test("new canonical split re-anchors exactly and corrections can move backward", () => {
  const splitC = checkpointBoundedPosition({
    raceState: "ACTIVE",
    seed: seed({ anchorKm: 25, anchorTimeSec: 2_880 }),
    currentRaceElapsedSec: 2_880,
  });
  assert.equal(splitC.distanceKm, 25);

  const corrected = checkpointBoundedPosition({
    raceState: "ACTIVE",
    seed: seed({ anchorKm: 18, anchorTimeSec: 2_880 }),
    currentRaceElapsedSec: 2_880,
  });
  assert.equal(corrected.distanceKm, 18);
});

test("transitions hold and FINISHED clamps exactly at finish", () => {
  const transition = checkpointBoundedPosition({
    raceState: "ACTIVE",
    seed: seed({
      anchorKm: 1,
      anchorTimeSec: 600,
      nextKm: 1,
      paceSecPerKm: 0,
    }),
    currentRaceElapsedSec: 900,
  });
  assert.equal(transition.distanceKm, 1);

  const finished = checkpointBoundedPosition({
    raceState: "FINISHED",
    seed: seed(),
  });
  assert.equal(finished.distanceKm, 40);
  assert.equal(finished.state, "FINISHED");
});

test("prediction never crosses the next timing mat or total distance", () => {
  const projected = checkpointBoundedPosition({
    raceState: "ACTIVE",
    seed: seed({ nextKm: 25, totalKm: 25 }),
    currentRaceElapsedSec: 20_000,
  });
  assert.equal(projected.distanceKm, 25);
  assert.equal(projected.state, "AWAITING_CHECKPOINT_CONFIRMATION");
});

test("1, 5, 10 and 20 athletes remain pure local O(n) projections", () => {
  for (const count of [1, 5, 10, 20]) {
    const positions = Array.from({ length: count }, (_, index) =>
      checkpointBoundedPosition({
        raceState: "ACTIVE",
        seed: seed({ anchorKm: index / 10 }),
        currentRaceElapsedSec: 2_283,
      }),
    );
    assert.equal(positions.length, count);
    assert.ok(positions.every((position) => position.distanceKm >= 0));
  }
});
