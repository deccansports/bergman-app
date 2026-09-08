import assert from "node:assert/strict";
import test from "node:test";

import {
  distanceToFraction,
  estimatedDistanceKm,
} from "../engine/interpolation";
import { buildCumulativePath, positionAtFraction } from "../engine/geo";

const path = buildCumulativePath([
  { lat: 12.9, lng: 77.5 },
  { lat: 12.9, lng: 77.6 },
]);

test("prediction advances the marker away from course start between timing mats", () => {
  const distanceKm = estimatedDistanceKm(
    {
      anchorKm: 0,
      anchorTimeSec: 0,
      nextKm: 1,
      paceSecPerKm: 600,
      totalKm: 1,
    },
    300,
  );
  const position = positionAtFraction(path, distanceToFraction(distanceKm, 1));
  assert.equal(distanceKm, 0.5);
  assert.ok(position.lng > path.points[0].lng);
  assert.ok(position.lng < path.points[1].lng);
});

test("a newly accepted split re-anchors projection before prediction resumes", () => {
  const distanceKm = estimatedDistanceKm(
    {
      anchorKm: 2,
      anchorTimeSec: 1_200,
      nextKm: 3,
      paceSecPerKm: 600,
      totalKm: 4,
    },
    0,
  );
  assert.equal(distanceKm, 2);
  assert.equal(distanceToFraction(distanceKm, 4), 0.5);
});

test("500 m, 1 km, 2 km and 4 km courses use their own total distance", () => {
  for (const totalKm of [0.5, 1, 2, 4]) {
    assert.equal(distanceToFraction(totalKm / 2, totalKm), 0.5);
    assert.equal(distanceToFraction(totalKm, totalKm), 1);
  }
});
