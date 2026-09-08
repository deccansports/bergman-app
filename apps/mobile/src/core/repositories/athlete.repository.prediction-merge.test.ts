import assert from "node:assert/strict";
import test from "node:test";

import type { AthleteModalResponse } from "@/core/types";
import { mergeAthleteOnlySnapshot } from "./athletePredictionMerge";

function snapshot(
  overrides: Partial<AthleteModalResponse>,
): AthleteModalResponse {
  return {
    success: true,
    eventId: "test-event",
    athlete: {
      id: "participant-1002",
      bib: "1002",
      name: "Dinesh Cr",
      estimatedFinish: "22:44:03",
      prediction: { finishTimeLabel: "05:24:00" },
    },
    participantLive: {
      estimatedFinishTime: "22:44:03",
      etaFinishClock: "22:44:03",
      etaNextSplit: "19:14:03",
      predictedPaceSecondsPerKm: 420,
    },
    nextSplitPrediction: {
      checkpoint: "Swim Finish",
    },
    ...overrides,
  };
}

test("accepted Run Finish clears stale prediction fields during athlete-only merge", () => {
  const full = snapshot({});
  const refresh = snapshot({
    athlete: {
      id: "participant-1002",
      bib: "1002",
      name: "Dinesh Cr",
    },
    participantLive: {
      resolvedRaceState: {
        status: "FINISHED",
        splits: [
          {
            splitKey: "run_finish",
            accepted: true,
            elapsedSeconds: 6_000,
            readAt: "2026-09-01T13:40:00Z",
          },
        ],
      },
    },
    nextSplitPrediction: undefined,
  });

  const merged = mergeAthleteOnlySnapshot(full, refresh);
  assert.equal(merged.athlete.estimatedFinish, undefined);
  assert.equal(merged.athlete.prediction, null);
  assert.equal(merged.participantLive?.estimatedFinishTime, undefined);
  assert.equal(merged.participantLive?.etaFinishClock, undefined);
  assert.equal(merged.participantLive?.etaNextSplit, undefined);
  assert.equal(merged.participantLive?.predictedPaceSecondsPerKm, undefined);
  assert.equal(merged.nextSplitPrediction, undefined);
  assert.equal(
    (merged.participantLive?.resolvedRaceState?.splits as unknown[])?.length,
    1,
  );
});
