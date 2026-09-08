import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const timelineSource = readFileSync(
  new URL("./TimelineCard.tsx", import.meta.url),
  "utf8",
);

const exportedTimelineCard = timelineSource.slice(
  timelineSource.indexOf("export function TimelineCard"),
);

test("LIVE SPLIT FLOW renders only the progressive timeline presentation", () => {
  assert.match(
    exportedTimelineCard,
    /selectProgressiveSplitTableRows\(splits, \{ notStarted, finished \}\)/,
  );
  assert.match(
    exportedTimelineCard,
    /groupSections\(visibleSplits, raceCategory, contest, legLabel\)/,
  );
  assert.doesNotMatch(exportedTimelineCard, /<LegProgress/);
  assert.doesNotMatch(exportedTimelineCard, /raceTiming\?\.sections/);
  assert.doesNotMatch(exportedTimelineCard, /raceTiming/);
  assert.doesNotMatch(exportedTimelineCard, /DerivedRaceTiming/);
  assert.doesNotMatch(exportedTimelineCard, /configured(?:Splits|Rows)/i);
});

test("a generic START row is assigned to the configured sport leg", () => {
  assert.match(timelineSource, /const firstConfiguredLeg: LegKey =/);
  assert.match(
    timelineSource,
    /configuredLeg === "other" \? firstConfiguredLeg : configuredLeg/,
  );
  assert.match(timelineSource, /courseKind === "triathlon"[\s\S]*\? "swim"/);
  assert.match(timelineSource, /courseKind === "duathlon"[\s\S]*\? "run"/);
});

test("single-discipline pre-start rows use the selected athlete leg label", () => {
  assert.match(
    timelineSource,
    /resolveCourseKind\(raceCategory, contest, legLabel\)/,
  );
  assert.match(exportedTimelineCard, /legLabel\?: string/);
});

test("renderer diagnostics identify the canonical athlete and exact visible rows", () => {
  assert.match(exportedTimelineCard, /LIVE_SPLIT_TABLE_RENDER/);
  assert.match(
    exportedTimelineCard,
    /buildLiveSplitTableDiagnostic\(visibleSplits/,
  );
  assert.match(exportedTimelineCard, /participantUuid,/);
  assert.match(exportedTimelineCard, /canonicalVersion,/);
});

test("legacy complete-course timing renderer is absent", () => {
  assert.doesNotMatch(timelineSource, /function DerivedRaceTiming/);
  assert.doesNotMatch(timelineSource, /function DerivedRaceSectionCard/);
  assert.doesNotMatch(timelineSource, /function timingPointStatus/);
});
