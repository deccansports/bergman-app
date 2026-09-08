import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPreCanonicalAthletePresentation,
  buildTrackedAthleteSummaryPresentation,
  // @ts-expect-error Node strip-types tests require the explicit extension.
} from "./preCanonicalPresentation.ts";

test("identity-only presentation performs no timing or prediction projection", () => {
  const detail = buildPreCanonicalAthletePresentation({
    id: "race:1xajvfm0:2z0u7pwv:4121",
    bib: "4121",
    name: "Vaibhav",
  });
  assert.equal(detail.header.statusLabel, "LOADING LIVE TIMING…");
  assert.equal(detail.predictionState, undefined);
  assert.equal(detail.prediction, undefined);
  assert.equal(detail.nextSplit, undefined);
  assert.equal(detail.raceProgress, undefined);
  assert.deepEqual(detail.timeline, []);
  assert.equal(detail.lifecycle.predictionStatus, undefined);
  assert.notEqual(detail.lifecycle.label, "no_course");
});

test("tracked summary preserves known race state without deriving timing", () => {
  const detail = buildTrackedAthleteSummaryPresentation({
    id: "race:6ueookhs:7yc3etju:3001",
    bib: "3001",
    name: "Karthick Shanmugam",
    category: "Bergman Swimathon Blr - 1 Km",
    status: "NOT_STARTED",
    progressPercent: 0,
  });

  assert.equal(detail.header.status, "notStarted");
  assert.equal(detail.header.statusLabel, "NOT STARTED");
  assert.equal(detail.lifecycle.label, "NOT STARTED");
  assert.equal(detail.raceProgress?.progress, 0);
  assert.equal(detail.prediction, undefined);
  assert.deepEqual(detail.timeline, []);
});

test("participantLive race state outranks a stale watchlist status", () => {
  const detail = buildTrackedAthleteSummaryPresentation({
    id: "race:6ueookhs:1qkaizpt:4121",
    bib: "4121",
    name: "Vaibhav",
    status: "NOT_STARTED",
    participantLive: {
      status: "ON_COURSE",
      resolvedRaceState: {
        status: "ON_COURSE",
        currentLeg: "SWIM",
        officialProgressRatio: 0.25,
      },
    },
  });

  assert.equal(detail.header.status, "live");
  assert.equal(detail.lifecycle.label, "LIVE");
  assert.equal(detail.raceProgress?.legLabel, "SWIM");
  assert.equal(detail.raceProgress?.progress, 0.25);
});
