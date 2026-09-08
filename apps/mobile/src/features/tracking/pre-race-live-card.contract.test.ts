import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);
const timelineSource = readFileSync(
  new URL(
    "./athlete-detail/components/cards/TimelineCard.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("NOT_STARTED live cards suppress zero elapsed and finish clocks", () => {
  assert.match(source, /detail\?\.header\.status === "notStarted"/);
  assert.match(source, /preRace\s*\? undefined/);
  assert.match(source, /if \(preRace\) return "--:--:--"/);
  assert.match(
    source,
    /raceTiming\?\.overallTimeSeconds != null &&[\s\S]*raceTiming\.overallTimeSeconds > 0/,
  );
  assert.match(source, /!preRace && displayedElapsedTime/);
  assert.match(
    timelineSource,
    /selectProgressiveSplitTableRows\(splits, \{ notStarted, finished \}\)/,
  );
  assert.doesNotMatch(timelineSource, /resolvedTiming\.overallTimeSeconds/);
});

test("tracking banner requires accepted on-course timing evidence", () => {
  assert.match(
    source,
    /hasCanonicalOnCourseTrackedAthlete = watchedRows\.some\([\s\S]*canRunAthleteRaceClock/,
  );
  assert.match(
    source,
    /!resultsMode && !hasCanonicalOnCourseTrackedAthlete[\s\S]*"LIVE TRACKING"/,
  );
  assert.match(
    source,
    /trackedCount > 0 && hasOnCourseAthlete[\s\S]*"LIVE · ATHLETES ON COURSE"/,
  );
});
