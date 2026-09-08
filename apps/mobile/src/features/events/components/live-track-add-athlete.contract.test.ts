import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./LiveTrackScreen.tsx", import.meta.url), "utf8");

test("adding a tracked athlete keeps the tracker panel visible while detail loads", () => {
  const addStart = source.indexOf("const trackedAthlete: ScreenTrackedAthlete");
  const addEnd =
    source.indexOf('setSheetMode("full");', addStart) +
    'setSheetMode("full");'.length;
  const addHandler = source.slice(addStart, addEnd);

  assert.match(addHandler, /setSelectedTrackedKey\(/);
  assert.match(addHandler, /setSheetMode\("full"\)/);
  assert.doesNotMatch(addHandler, /setSheetMode\("collapsed"\)/);
});
