import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./LiveTrackScreen.tsx", import.meta.url), "utf8");

test("hiding expanded athlete details does not dismiss the split table's tracker", () => {
  const panelStart = source.indexOf("{hasExpandedAthlete ? (");
  const callbackStart = source.indexOf("onExpand={() => {", panelStart);
  const callbackEnd = source.indexOf("}}", callbackStart) + 2;
  const callback = source.slice(callbackStart, callbackEnd);

  assert.match(callback, /setAthleteExpanded\(false\)/);
  assert.match(callback, /setSheetMode\("full"\)/);
  assert.doesNotMatch(callback, /setSheetMode\("collapsed"\)/);
  assert.doesNotMatch(callback, /setSelectedTrackedKey\(/);
});
