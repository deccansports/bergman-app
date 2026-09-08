import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);

test("tracked-card fallback cache is invalidated when compact canonical data arrives", () => {
  assert.match(source, /response \? athletePresentationFingerprint\(response\) : "pending"/);
  assert.match(source, /responseMatchesSelectedParticipant[\s\S]*mapAthleteDetail\(response as AthleteModalResponse\)/);
});
