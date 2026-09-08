import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./mappers.ts", import.meta.url), "utf8");

test("accepted timing cannot remain waiting-to-start behind a stale snapshot", () => {
  const start = source.indexOf("function hasStartedEvidence");
  const end = source.indexOf("export function resolveAthleteRaceState", start);
  const body = source.slice(start, end);

  assert.match(body, /if \(hasReachedSplit\(res\)\) return true/);
});

test("accepted canonical finish outranks stale waiting or on-course state", () => {
  const start = source.indexOf("export function resolveAthleteRaceState");
  const end = source.indexOf("export function mapLeaderboardRows", start);
  const body = source.slice(start, end);

  assert.match(body, /hasPublishedOfficialFinish\(res\)/);
  assert.match(body, /hasCanonicalTerminalTimestamp\(res\)/);
  assert.match(
    body,
    /!\["DNF", "DNS", "DNQ", "DSQ"\]\.includes\(canonicalTimingState\)/,
  );
  assert.ok(
    body.indexOf("hasPublishedOfficialFinish(res)") <
      body.indexOf('canonicalTimingState === "WAITING_CHIP_START"'),
  );
  assert.match(
    body,
    /canonicalTimingState === "FINISHED"[\s\S]*hasStartedEvidence\(res\)[\s\S]*status: "live"/,
  );
});

test("accepted timing does not override an explicit admin DNS", () => {
  const start = source.indexOf("export function resolveAthleteRaceState");
  const end = source.indexOf("export function mapLeaderboardRows", start);
  const body = source.slice(start, end);
  assert.match(body, /canonicalStatusSource !== "MANUAL_OVERRIDE"/);
  assert.match(body, /\["DNF", "DNS", "DNQ", "DSQ"\]\.includes\(canonicalTimingState\)/);
});
