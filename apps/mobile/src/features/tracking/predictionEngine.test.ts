import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalPredictionState,
  type AcceptedPredictionSplit,
  type PredictionCoursePoint,
  type PredictionRaceState,
} from "./predictionEngine";

const course: PredictionCoursePoint[] = [
  point("start", "Start", 0, 0, "SWIM"),
  point("swim_finish", "Swim Finish", 10, 1.5, "SWIM"),
  point("bike_start", "Bike Start", 20, 1.5, "T1"),
  point("bike_1", "BIKE 1", 30, 21.5, "BIKE"),
  point("bike_finish", "Bike Finish", 40, 41.5, "BIKE"),
  point("run_start", "Run Start", 50, 41.5, "T2"),
  point("run_1", "RUN 1", 60, 46.5, "RUN"),
  point("run_finish", "Run Finish", 70, 51.5, "RUN"),
];

function point(
  key: string,
  label: string,
  sequence: number,
  cumulativeDistanceKm: number,
  sport: string,
): PredictionCoursePoint {
  return {
    key,
    matchKeys: [key, label],
    label,
    sequence,
    cumulativeDistanceKm,
    sport,
  };
}

function accepted(
  key: string,
  elapsedSeconds: number,
  acceptedTimestamp = Date.parse("2026-09-01T12:00:00Z") +
    elapsedSeconds * 1_000,
): AcceptedPredictionSplit {
  const configured = course.find((candidate) => candidate.key === key);
  return {
    keys: [key],
    elapsedSeconds,
    acceptedTimestamp,
    cumulativeDistanceKm: configured?.cumulativeDistanceKm,
  };
}

function build(
  raceState: PredictionRaceState,
  acceptedSplits: AcceptedPredictionSplit[],
  selectedCourse = course,
) {
  return buildCanonicalPredictionState({
    raceState,
    course: selectedCourse,
    acceptedSplits,
    totalDistanceKm: selectedCourse.at(-1)?.cumulativeDistanceKm,
    paceModel: {
      secondsPerKmBySport: { swim: 1_800, bike: 180, run: 420 },
      transitionSeconds: 120,
    },
  });
}

test("A-B: accepted Start predicts Swim Finish, and accepted Swim Finish is never predicted again", () => {
  const atStart = build("ACTIVE", [accepted("start", 0)]);
  assert.equal(atStart.nextCheckpoint?.key, "swim_finish");
  assert.ok(
    atStart.remainingCheckpoints.some((item) => item.key === "run_finish"),
  );

  const afterSwim = build("ACTIVE", [
    accepted("start", 0),
    accepted("swim_finish", 2_700),
  ]);
  assert.equal(afterSwim.nextCheckpoint?.key, "bike_start");
  assert.ok(
    !afterSwim.remainingCheckpoints.some((item) => item.key === "swim_finish"),
  );
});

test("pre-race configured Start does not activate prediction without an accepted read", () => {
  const result = build("NOT_STARTED", []);

  assert.equal(result.raceState, "NOT_STARTED");
  assert.equal(result.latestAcceptedSplitKey, undefined);
  assert.equal(result.nextCheckpoint, undefined);
  assert.equal(result.projectedFinishTimestamp, undefined);
  assert.deepEqual(result.remainingCheckpoints, []);
  assert.equal(result.predictionSuppressed, true);
  assert.equal(result.suppressionReason, "not_started");
});

test("C-E: Bike Finish, Run Start, and RUN 1 expose only their ordered Run remainder", () => {
  const bikeFinish = build("ACTIVE", [accepted("bike_finish", 8_000)]);
  assert.deepEqual(
    bikeFinish.remainingCheckpoints.map((item) => item.key),
    ["run_start", "run_1", "run_finish"],
  );
  assert.deepEqual(
    build("ACTIVE", [accepted("run_start", 8_120)]).remainingCheckpoints.map(
      (item) => item.key,
    ),
    ["run_1", "run_finish"],
  );
  assert.deepEqual(
    build("ACTIVE", [accepted("run_1", 10_000)]).remainingCheckpoints.map(
      (item) => item.key,
    ),
    ["run_finish"],
  );
});

test("F-H: terminal accepted Run Finish suppresses prediction and forces zero remaining distance", () => {
  const courseWithOptionalPostFinish = [
    ...course,
    point("recovery_exit", "Recovery Exit", 80, 51.5, "OTHER"),
  ];
  const result = build(
    "NOT_STARTED",
    [accepted("run_finish", 12_000)],
    courseWithOptionalPostFinish,
  );
  assert.equal(result.raceState, "FINISHED");
  assert.equal(result.remainingDistanceKm, 0);
  assert.deepEqual(result.remainingCheckpoints, []);
  assert.equal(result.nextCheckpoint, undefined);
  assert.equal(result.projectedFinishTimestamp, undefined);
  assert.equal(result.predictionSuppressed, true);
  assert.equal(result.suppressionReason, "terminal");

  const statusFinished = build("FINISHED", [accepted("run_1", 10_000)]);
  assert.equal(statusFinished.remainingDistanceKm, 0);
  assert.equal(statusFinished.projectedFinishTimestamp, undefined);
  assert.equal(statusFinished.suppressionReason, "finished");
});

test("I, M, N: duplicates and missing optional reads never reset accepted progression to Start", () => {
  const result = build("NOT_STARTED", [
    accepted("bike_finish", 8_100),
    accepted("start", 0),
    accepted("bike_finish", 8_000),
  ]);
  assert.equal(result.raceState, "ACTIVE");
  assert.equal(result.latestAcceptedSplitKey, "bike_finish");
  assert.deepEqual(
    result.remainingCheckpoints.map((item) => item.key),
    ["run_start", "run_1", "run_finish"],
  );
});

test("J-K: Run checkpoints remain present and zero-distance transitions use transition duration", () => {
  const bikeFinish = accepted("bike_finish", 8_000);
  const result = build("ACTIVE", [bikeFinish]);
  assert.equal(
    result.nextCheckpoint?.expectedTimestamp,
    (bikeFinish.acceptedTimestamp ?? 0) + 120_000,
  );
  assert.ok(result.remainingCheckpoints.some((item) => item.key === "run_1"));
  assert.ok(
    result.remainingCheckpoints.some((item) => item.key === "run_finish"),
  );
});

test("L: each contest predicts from its own canonical split structure", () => {
  const swimathon = [
    point("start", "Start", 0, 0, "SWIM"),
    point("lap_1", "Lap 1", 10, 1, "SWIM"),
    point("finish", "Finish", 20, 2, "SWIM"),
  ];
  const result = build(
    "ACTIVE",
    [{ ...accepted("start", 0), cumulativeDistanceKm: 0 }],
    swimathon,
  );
  assert.deepEqual(
    result.remainingCheckpoints.map((item) => item.key),
    ["lap_1", "finish"],
  );
});

test("O: canonical course order wins over provider payload order", () => {
  const result = build("ACTIVE", [
    accepted("run_start", 9_000),
    accepted("swim_finish", 2_700),
    accepted("bike_finish", 8_000),
    accepted("start", 0),
  ]);
  assert.equal(result.latestAcceptedSplitKey, "run_start");
  assert.deepEqual(
    result.remainingCheckpoints.map((item) => item.key),
    ["run_1", "run_finish"],
  );
});

test("sport-aware pacing uses Swim, Bike, transition, and Run models independently", () => {
  const start = accepted("start", 0);
  const result = build("ACTIVE", [start]);
  const swimFinish = result.remainingCheckpoints.find(
    (item) => item.key === "swim_finish",
  );
  const bikeStart = result.remainingCheckpoints.find(
    (item) => item.key === "bike_start",
  );
  const bikeOne = result.remainingCheckpoints.find(
    (item) => item.key === "bike_1",
  );
  const runOne = result.remainingCheckpoints.find(
    (item) => item.key === "run_1",
  );
  assert.equal(swimFinish?.expectedElapsedSeconds, 2_700);
  assert.equal(bikeStart?.expectedElapsedSeconds, 2_820);
  assert.equal(bikeOne?.expectedElapsedSeconds, 6_420);
  assert.ok(
    (runOne?.expectedElapsedSeconds ?? 0) >
      (bikeOne?.expectedElapsedSeconds ?? 0),
  );
});

test("multi-pass courses release only the expected canonical pass, not the shared physical mat", () => {
  const multiPassCourse = [
    {
      ...point("bike_mat_pass_1", "Bike mat Pass 1", 10, 17.4, "BIKE"),
      matchKeys: ["shared-bike-mat", "Bike mat Pass 1"],
    },
    {
      ...point("bike_mat_pass_2", "Bike mat Pass 2", 20, 27.4, "BIKE"),
      matchKeys: ["shared-bike-mat", "Bike mat Pass 2"],
    },
    point("finish", "Finish", 30, 37.4, "BIKE"),
  ];
  const passOneOnly = build(
    "ACTIVE",
    [
      {
        keys: ["bike_mat_pass_1", "shared-bike-mat"],
        sequence: 10,
        elapsedSeconds: 3_000,
        cumulativeDistanceKm: 17.4,
      },
    ],
    multiPassCourse,
  );
  assert.equal(passOneOnly.latestAcceptedSplitKey, "bike_mat_pass_1");
  assert.equal(passOneOnly.nextCheckpoint?.key, "bike_mat_pass_2");

  const passTwo = build(
    "ACTIVE",
    [
      {
        keys: ["bike_mat_pass_2", "shared-bike-mat"],
        sequence: 20,
        elapsedSeconds: 4_692,
        cumulativeDistanceKm: 27.4,
      },
    ],
    multiPassCourse,
  );
  assert.equal(passTwo.latestAcceptedSplitKey, "bike_mat_pass_2");
  assert.equal(passTwo.nextCheckpoint?.key, "finish");
});

test("prediction metadata cannot create a split or advance the canonical leg", () => {
  const atBikeOne = build("ACTIVE", [accepted("bike_1", 6_000)]);
  assert.equal(atBikeOne.latestAcceptedSplitKey, "bike_1");
  assert.equal(atBikeOne.nextCheckpoint?.key, "bike_finish");
  assert.equal(atBikeOne.raceState, "ACTIVE");
  assert.ok(
    !atBikeOne.remainingCheckpoints.some(
      (checkpoint) => checkpoint.key === "bike_1",
    ),
  );
  assert.ok(
    atBikeOne.remainingCheckpoints.some(
      (checkpoint) => checkpoint.key === "bike_finish",
    ),
  );
});
