import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("an event rejected by the public event source cannot start canonical socket or athlete polling", async () => {
  const screen = await readFile(
    new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    screen,
    /const liveTrackingResolved =\s*!eventQuery\.isLoading && !eventQuery\.isError && Boolean\(eventQuery\.event\)/,
  );
  assert.match(
    screen,
    /useCanonicalChangeSocket\([\s\S]*liveTrackingResolved[\s\S]*eventScreen\.pollingEnabled/,
  );
  assert.match(screen, /eventQuery\.isError \? \([\s\S]*Event unavailable/);
});
