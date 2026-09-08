import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("live search selection preserves the candidate provider and contest scope", async () => {
  const source = await readFile(
    new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const providerEventUuid = firstText\([\s\S]*item\.providerEventUuid[\s\S]*participantUuid\.match/,
  );
  assert.match(
    source,
    /canonicalContestUuid: firstText\([\s\S]*item\.canonicalContestUuid[\s\S]*item\.providerContestUuid/,
  );
  assert.match(source, /providerEventUuid: athlete\.providerEventUuid/);
  assert.match(source, /providerContestUuid: athlete\.providerContestUuid/);
  assert.match(source, /participantUuid: athlete\.participantUuid/);
  assert.match(
    source,
    /providerContestUuid:[\s\S]*athlete\.providerContestUuid \?\?[\s\S]*athlete\.canonicalContestUuid/,
  );
});
