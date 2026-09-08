import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("minimizing the map card restores the full map while Track reopens detail", async () => {
  const source = await readFile(
    new URL("./LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function CompactMapAthleteCard(");
  const end = source.indexOf("function MapSettingsToggle(", start);
  const card = source.slice(start, end);

  assert.match(card, /detail\?\.raceProgress\?\.progress/);
  assert.match(card, /detail\?\.raceProgress\?\.legLabel/);
  assert.match(card, /<CompactRaceProgress/);
  assert.match(card, /raceTiming=\{detail\?\.raceTiming\}/);
  assert.match(card, /contest=\{contest\}/);
  assert.match(
    card,
    /raceCategory=\{row\.raceCategory \|\| detail\?\.header\.raceCategory\}/,
  );
  assert.match(card, /if \(minimized\)/);
  assert.match(card, /<RaceStartCountdown/);
  assert.match(
    card,
    /finished[\s\S]*\? "FINISH TIME"[\s\S]*: effectiveTerminalNonFinish[\s\S]*: "LIVE ELAPSED"/,
  );
  assert.match(card, /accessibilityLabel="Hide athlete card"/);
  assert.match(card, /onPress=\{onMinimize\}/);
  assert.doesNotMatch(source, /compactCardMinimized/);
  assert.match(source, /minimized=\{false\}/);
  assert.match(
    source,
    /onMinimize=\{\(\) => \{[\s\S]*setCompactCardDismissed\(true\);/,
  );
  assert.match(
    source,
    /bottomSafeArea=\{[\s\S]*compactCardDismissed[\s\S]*\? 0/,
  );
  assert.match(
    source,
    /if \(compactCardDismissed && selectedTrackedRow\) \{[\s\S]*setCompactCardDismissed\(false\);[\s\S]*setSheetMode\("collapsed"\);/,
  );
  assert.doesNotMatch(card, /Restore live tracking card for/);
});
