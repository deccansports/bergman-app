import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("prediction uses cumulative race distance so Run checkpoints remain after Bike", async () => {
  const source = await readFile(
    new URL("./mappers.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /record\.cumulativeDistanceKm \?\?[\s\S]*record\.cumulativeRaceDistanceKm \?\?[\s\S]*record\.overallDistanceKm \?\?[\s\S]*record\.km_marking/,
  );
});

test("prediction timing and map pace come only from the shared web canonical response", async () => {
  const source = await readFile(
    new URL("./mappers.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /sectionPaces: \[\],[\s\S]*canonicalPaceSecPerKm: canonicalPace/,
  );
  assert.match(
    source,
    /expectedTimestamp: serverNextExpectedAt \?\? undefined/,
  );
  assert.match(
    source,
    /projectedFinishTimestamp: serverFinishExpectedAt \?\? undefined/,
  );
  assert.doesNotMatch(source, /function buildPredictionPaceModel\(/);
});
