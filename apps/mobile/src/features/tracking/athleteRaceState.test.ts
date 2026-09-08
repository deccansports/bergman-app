import assert from "node:assert/strict";
import test from "node:test";

import type { AthleteModalResponse } from "@/core/types";
import { mapAthleteDetail, resolveAthleteRaceState } from "./mappers";

function response(value: Partial<AthleteModalResponse>): AthleteModalResponse {
  return {
    success: true,
    eventId: "event",
    visibility: "PUBLIC",
    athlete: { id: "athlete", bib: "1", name: "Athlete" },
    ...value,
  } as AthleteModalResponse;
}

test("accepted progression cannot resolve to Not Started", () => {
  const state = resolveAthleteRaceState(
    response({
      athlete: {
        id: "athlete",
        bib: "1",
        name: "Athlete",
        status: "WAITING_CHIP_START",
      },
      participantLive: {
        resolvedRaceState: { status: "WAITING_CHIP_START" },
        splits: [
          {
            splitKey: "run_start",
            name: "Run Start",
            status: "VALID",
            readAt: "2026-09-01T03:00:00.000Z",
            elapsedSeconds: 3600,
          },
        ],
      },
    }),
  );
  assert.equal(state.status, "live");
});

test("a raw FINISHED flag without an official accepted result stays active", () => {
  const state = resolveAthleteRaceState(
    response({
      athlete: { id: "athlete", bib: "1", name: "Athlete" },
      participantLive: {
        resolvedRaceState: { status: "FINISHED" },
        splits: [
          {
            splitKey: "bike_finish",
            name: "Bike Finish",
            status: "VALID",
            readAt: "2026-09-01T04:00:00.000Z",
            elapsedSeconds: 7200,
          },
        ],
      },
    }),
  );
  assert.equal(state.status, "live");
});

test("canonical FINISHED with a finish timestamp stops the live clock even when the configured finish split identity is unavailable", () => {
  const canonicalFinished = response({
    athlete: { id: "athlete", bib: "1", name: "Athlete" },
    participantLive: {
      resolvedRaceState: {
        status: "FINISHED",
        finishAt: "2026-09-01T05:13:17.000Z",
        finalElapsedMs: 12_557_000,
      },
      splits: [
        {
          splitKey: "provider_terminal_42",
          name: "Timing Point 42",
          status: "VALID",
          readAt: "2026-09-01T05:13:17.000Z",
          elapsedSeconds: 12_557,
        },
      ],
    },
  });
  const state = resolveAthleteRaceState(canonicalFinished);
  assert.equal(state.status, "finished");

  const detail = mapAthleteDetail(canonicalFinished);
  assert.equal(detail.header.status, "finished");
  assert.equal(detail.result?.chipTime, "03:29:17");
});

test("an official FINISHED result resolves to Finished", () => {
  const state = resolveAthleteRaceState(
    response({
      athlete: { id: "athlete", bib: "1", name: "Athlete" },
      result: { status: "FINISHED", chipTime: "01:02:03" },
    }),
  );
  assert.equal(state.status, "finished");
});

test("a zero finish placeholder is not official finish evidence", () => {
  const state = resolveAthleteRaceState(
    response({
      athlete: { id: "athlete", bib: "1", name: "Athlete" },
      participantLive: {
        resolvedRaceState: { status: "FINISHED" },
        splits: [
          {
            splitKey: "bike_finish",
            name: "Bike Finish",
            status: "VALID",
            readAt: "2026-09-01T04:00:00.000Z",
            elapsedSeconds: 7200,
          },
        ],
      },
      result: { status: "FINISHED", chipTime: "00:00:00" },
    }),
  );
  assert.equal(state.status, "live");
});
