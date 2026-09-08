import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const screen = await readFile(
  new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);

test("tracking presentation has exactly full, compact-athlete, and full-map states", () => {
  assert.match(screen, /visible=\{showPanel\}/);
  assert.match(
    screen,
    /sheetMode === "collapsed" &&[\s\S]*selectedTrackedRow &&[\s\S]*!compactCardDismissed[\s\S]*<CompactMapAthleteCard/,
  );
  assert.match(
    screen,
    /onMinimize=\{\(\) => \{[\s\S]*setCompactCardDismissed\(true\)/,
  );
  assert.match(
    screen,
    /if \(compactCardDismissed && selectedTrackedRow\)[\s\S]*setCompactCardDismissed\(false\)[\s\S]*setSheetMode\("collapsed"\)[\s\S]*return;/,
  );
  assert.doesNotMatch(screen, /compactCardMinimized|setCompactCardMinimized/);
});

test("compact mode owns one selected athlete and previous-next navigation", () => {
  const compact = screen.slice(
    screen.indexOf("function CompactMapAthleteCard"),
    screen.indexOf("function MapSettingsToggle"),
  );
  assert.match(compact, /row: TrackedCard/);
  assert.match(compact, /accessibilityLabel="Previous tracked athlete"/);
  assert.match(compact, /accessibilityLabel="Next tracked athlete"/);
  assert.match(compact, /\{index \+ 1\} of \{total\}/);
});

test("compact card has a red handle and downward drag hides it", () => {
  const compact = screen.slice(
    screen.indexOf("function CompactMapAthleteCard"),
    screen.indexOf("function MapSettingsToggle"),
  );
  assert.match(compact, /accessibilityLabel="Hide athlete card"/);
  assert.match(compact, /backgroundColor: "#E11D48"/);
  assert.match(
    compact,
    /gestureState\.dy >= 48[\s\S]*gestureState\.vy >= 0\.65[\s\S]*onMinimize\(\)/,
  );
  assert.match(
    compact,
    /horizontalDistance > verticalDistance \* 1\.5[\s\S]*gestureState\.dy >= 32/,
  );
});
