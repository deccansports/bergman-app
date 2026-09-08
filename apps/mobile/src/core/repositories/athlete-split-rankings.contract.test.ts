import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canonical athlete refresh merges split rankings before race-flow mapping", async () => {
  const source = await readFile(
    new URL("./athlete.repository.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /snapshot\.splitRankings/);
  assert.match(
    source,
    /Object\.entries\(asRecord\(snapshot\.splitRankings\)\)/,
  );
  assert.match(source, /const splitRankingByKey = new Map/);
  assert.match(
    source,
    /const snapshotCanonicalSplits = unrankedCanonicalSplits\.map/,
  );
  assert.match(
    source,
    /const canonicalSplits = mergeCanonicalSplitsWithHotTiming/,
  );
  assert.match(source, /ranking\.overallRank \?\?[\s\S]*?ranking\.rank/);
  assert.match(source, /ranking: \{ \.\.\.ranking, \.\.\.existingRanking \}/);
  assert.match(source, /finish\.readAt/);
  assert.match(source, /hotOverallRanking\.categoryRank/);
  assert.match(source, /snapshotOverallRanking\.categoryRank/);
  assert.match(
    source,
    /value != null && Number\.isFinite\(value\) && value > 0/,
  );
});

test("canonical athlete refresh preserves Feibot START evidence and clears stale DNS", async () => {
  const source = await readFile(
    new URL("./athlete.repository.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /startTiming\.chipStartDetectionTime/);
  assert.match(source, /startTiming\.acceptedReadId/);
  assert.match(source, /startTiming\.startPassageId/);
  assert.match(source, /const normalizedStartTiming = \{/);
  assert.match(source, /resolvedRaceState: mergedHotResolvedState/);
  assert.match(
    source,
    /canonicalAcceptedStart &&[\s\S]*?toUpperCase\(\) === "DNS"[\s\S]*?mergedHotResolvedState\.status = "ON_COURSE"/,
  );
});
