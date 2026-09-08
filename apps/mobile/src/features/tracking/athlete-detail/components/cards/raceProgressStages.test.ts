import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner requires an explicit extension.
import { isAcceptedStageFinishBoundary } from "./raceProgressStages.ts";

test("START activates swim but cannot complete the swim leg", () => {
  assert.equal(isAcceptedStageFinishBoundary("SWIM", "swim START"), false);
  assert.equal(isAcceptedStageFinishBoundary("SWIM", "swim SWIM FINISH"), true);
});

test("transition stages complete only at the following sport start", () => {
  assert.equal(isAcceptedStageFinishBoundary("T1", "SWIM FINISH"), false);
  assert.equal(isAcceptedStageFinishBoundary("T1", "BIKE START"), true);
  assert.equal(isAcceptedStageFinishBoundary("T2", "BIKE FINISH"), false);
  assert.equal(isAcceptedStageFinishBoundary("T2", "RUN START"), true);
});
