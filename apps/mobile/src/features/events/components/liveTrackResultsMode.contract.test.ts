import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("completed live-tracking screens switch detail and cache scope to results", async () => {
  const source = await readFile(
    new URL("./LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /eventUsesResultsMode\(/);
  assert.match(source, /liveTrackingEnabled === true && !eventHasFinished/);
  assert.match(source, /resultsMode \? "results" : "live"/);
  assert.match(source, /resultsMode \? "full" : "athleteOnly"/);
  assert.match(
    source,
    /trackedForEvent\.map\([\s\S]*?queryKeys\.canonicalAthlete\([\s\S]*?athleteDataSource[\s\S]*?"athleteOnly"/,
  );
  assert.doesNotMatch(source, /queryKeys\.mobileLiveParticipant\(/);
});

test("tracked athlete labels do not repeat contest as age group", async () => {
  const source = await readFile(
    new URL("./LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /rawCategory\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /contest\?\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /row\.athlete\.ageGroup/);
});
