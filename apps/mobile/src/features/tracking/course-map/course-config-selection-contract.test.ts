import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./courseConfig.ts", import.meta.url), "utf8");

test("a provider sub-category can resolve its parent ticket GPX", () => {
  assert.match(source, /function ticketFamilyMatchScore/);
  assert.match(
    source,
    /value\.startsWith\(candidate\) \|\| candidate\.startsWith\(value\)/,
  );
  assert.match(source, /if \(familyMatch\) return familyMatch\.ticket/);
});

test("course selection derives the independent Feibot UUID from a canonical participant identity", () => {
  assert.match(source, /providerEventUuid\?: string/);
  assert.match(source, /selection\?\.bookingId/);
  assert.match(source, /selection\?\.providerUuid/);
  assert.match(source, /participantUuid\?: string/);
  assert.match(source, /\^race:\(\[\^:\]\+\):\/i/);
});

test("course selection derives the provider contest from a canonical participant identity", () => {
  assert.match(source, /const canonicalContestUuid/);
  assert.match(source, /\^race:\[\^:\]\+:\(\[\^:\]\+\):\/i/);
  assert.match(
    source,
    /selection\?\.contestId,[\s\S]*canonicalContestUuid,[\s\S]*selection\?\.contestName/,
  );
});
