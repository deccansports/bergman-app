import assert from "node:assert/strict";
import test from "node:test";

import type { AthleteModalResponse } from "@/core/types";
import {
  mapAthleteDetail,
  resolveOfficialRaceDurationSeconds,
} from "./mappers";
import { snapshotLivePerformance } from "./livePerformanceDiagnostics";
import type { AthleteRaceTiming } from "./timing";

const configuredSplits = [
  splitConfig("start", "Start", 0, 0, "SWIM"),
  splitConfig("swim_finish", "Swim Finish", 10, 1.5, "SWIM"),
  splitConfig("bike_start", "Bike Start", 20, 1.5, "T1"),
  splitConfig("bike_1", "BIKE 1", 30, 21.5, "BIKE"),
  splitConfig("bike_finish", "Bike Finish", 40, 41.5, "BIKE"),
  splitConfig("run_start", "Run Start", 50, 41.5, "T2"),
  splitConfig("run_1", "RUN 1", 60, 46.5, "RUN"),
  splitConfig("run_finish", "Run Finish", 70, 51.5, "RUN"),
];

function splitConfig(
  splitKey: string,
  name: string,
  order: number,
  cumulativeDistanceKm: number,
  assignedLeg: string,
) {
  const legId =
    assignedLeg === "SWIM"
      ? "swim"
      : assignedLeg === "BIKE"
        ? "bike"
        : assignedLeg === "RUN"
          ? "run"
          : assignedLeg === "T1"
            ? "bike"
            : "run";
  return { splitKey, name, order, cumulativeDistanceKm, assignedLeg, legId };
}

const elapsedByKey: Record<string, number> = {
  start: 0,
  swim_finish: 978,
  bike_start: 1_397,
  bike_1: 3_624,
  bike_finish: 4_501,
  run_start: 4_573,
  run_1: 5_618,
  run_finish: 6_000,
};

function acceptedSplit(splitKey: string, elapsedSeconds: number) {
  const configured = configuredSplits.find(
    (split) => split.splitKey === splitKey,
  );
  return {
    splitKey,
    name: configured?.name,
    legType: configured?.assignedLeg,
    cumulativeDistanceKm: configured?.cumulativeDistanceKm,
    elapsedSeconds,
    accepted: true,
    readAt: new Date(
      Date.parse("2026-09-01T12:00:00Z") + elapsedSeconds * 1_000,
    ).toISOString(),
  };
}

function response(
  lastAcceptedKey: string,
  acceptedKeys: string[],
): AthleteModalResponse {
  return {
    success: true,
    eventId: "test-event",
    athlete: {
      id: "participant-1002",
      participantUuid: "participant-1002",
      providerEventUuid: "provider-test-event",
      bib: "1002",
      name: "Dinesh Cr",
      contestName: "Test 1",
      ageGroup: "M30-34",
      visibility: "PUBLIC",
      providerContestUuid: "contest-triathlon",
      status: "waiting_chip_start",
    },
    participantLive: {
      resolvedRaceState: {
        status: "WAITING_CHIP_START",
        currentLeg: "RUN",
        currentSplit: lastAcceptedKey,
        totalDistanceKm: 51.5,
        splits: acceptedKeys.map((key) =>
          acceptedSplit(key, elapsedByKey[key]),
        ),
      },
    },
    contestContext: {
      contest: { providerContestUuid: "contest-triathlon", name: "Test 1" },
      splits: configuredSplits,
    },
    timingConfiguration: {
      legs: [
        {
          id: "swim",
          name: "Swim",
          type: "SWIM",
          order: 1,
          distanceKm: 1.5,
          startSplitKey: "start",
          finishSplitKey: "swim_finish",
        },
        {
          id: "bike",
          name: "Bike",
          type: "BIKE",
          order: 2,
          distanceKm: 40,
          startSplitKey: "bike_start",
          finishSplitKey: "bike_finish",
        },
        {
          id: "run",
          name: "Run",
          type: "RUN",
          order: 3,
          distanceKm: 10,
          startSplitKey: "run_start",
          finishSplitKey: "run_finish",
        },
      ],
      splits: configuredSplits,
    } as unknown as AthleteModalResponse["timingConfiguration"],
  };
}

test("BIB 1002 at accepted Run Finish has no stale Swim/Bike prediction", () => {
  const detail = mapAthleteDetail(
    response(
      "run_finish",
      configuredSplits.map((split) => split.splitKey),
    ),
  );
  assert.equal(detail.header.status, "finished");
  assert.equal(detail.header.category, "M30-34");
  assert.equal(detail.result?.statusLabel, "Finished");
  assert.equal(detail.result?.officialTime, "01:40:00");
  assert.equal(detail.result?.progressPercent, 100);
  const sectionDurations = detail.result?.sections?.map(
    (section) => section.duration,
  );
  assert.ok(sectionDurations?.includes("00:16:18"));
  assert.ok(sectionDurations?.includes("00:06:59"));
  assert.ok(sectionDurations?.includes("00:51:44"));
  assert.ok(sectionDurations?.includes("00:01:12"));
  assert.ok(sectionDurations?.includes("00:23:47"));
  assert.equal(detail.nextSplit, undefined);
  assert.deepEqual(detail.predictedCheckpoints, []);
  assert.equal(detail.prediction, undefined);
  assert.equal(detail.predictionState?.raceState, "FINISHED");
  assert.equal(detail.predictionState?.suppressed, true);
  assert.equal(detail.predictionState?.nextCheckpoint, null);
  assert.deepEqual(detail.predictionState?.remainingCheckpoints, []);
  assert.equal(detail.predictionState?.projectedFinish, null);
  assert.equal(detail.predictionState?.remainingDistanceKm, 0);
});

test("zero provider finish placeholder falls back to canonical overall time", () => {
  const payload = response(
    "run_finish",
    configuredSplits.map((split) => split.splitKey),
  );
  payload.result = {
    status: "FINISHED",
    chipTime: "00:00:00",
    officialTime: "00:00:00",
  };

  const detail = mapAthleteDetail(payload);

  assert.equal(detail.header.status, "finished");
  assert.equal(detail.raceTiming?.overallTimeSeconds, 6_000);
  assert.equal(detail.result?.officialTime, "01:40:00");
  assert.equal(detail.result?.chipTime, "01:40:00");
});

test("completed sections recover the total when the aggregate finish is zero", () => {
  const durations = [959, 427, 3_104, 71, 1_431];
  const raceTiming = {
    overallTimeSeconds: 0,
    warnings: [],
    sections: durations.map((durationSeconds, index) => ({
      type: index === 1 || index === 3 ? "transition" : "leg",
      id: `section-${index}`,
      title: `Section ${index}`,
      status: "completed",
      durationSeconds,
      averageMetric: null,
      rows: [],
    })),
  } as AthleteRaceTiming;

  assert.equal(
    resolveOfficialRaceDurationSeconds({
      raceTiming,
      terminalElapsedSeconds: 0,
    }),
    5_992,
  );
});

test("NOT_STARTED athlete with configured swimstart has no active prediction", () => {
  const payload = response("start", []);
  payload.athlete.status = "NOT_STARTED";
  payload.participantLive = {
    resolvedRaceState: {
      status: "NOT_STARTED",
      officialDistanceKm: 0,
      totalDistanceKm: 51.5,
      splits: [],
    },
  };

  const detail = mapAthleteDetail(payload);

  assert.equal(detail.header.status, "notStarted");
  assert.equal(detail.nextSplit, undefined);
  assert.deepEqual(detail.predictedCheckpoints, []);
  assert.equal(detail.prediction, undefined);
  assert.equal(detail.predictionState?.raceState, "NOT_STARTED");
  assert.equal(detail.predictionState?.suppressed, true);
  assert.equal(detail.predictionState?.suppressionReason, "not_started");
});

test("admin DNQ remains a terminal DNQ presentation state", () => {
  const payload = response("finish", []);
  payload.athlete.status = "DNQ";
  payload.result = {
    status: "DNQ",
    splits: [],
  };
  payload.participantLive = {
    resolvedRaceState: {
      status: "DNQ",
      statusSource: "MANUAL_OVERRIDE",
      splits: [],
    },
  };

  const detail = mapAthleteDetail(payload);

  assert.equal(detail.header.status, "dnq");
  assert.equal(detail.header.statusLabel, "DNQ");
  assert.equal(detail.result?.statusLabel, "DNQ");
  assert.deepEqual(detail.result?.ranks, []);
});

test("pre-race projection exposes only Start with the configured expected time", () => {
  const payload = response("start", []);
  payload.athlete.status = "NOT_STARTED";
  payload.participantLive = {
    resolvedRaceState: {
      status: "NOT_STARTED",
      officialTimingMode: "GUN",
      gunStartAt: "2026-09-01T12:30:00.000Z",
      officialDistanceKm: 0,
      totalDistanceKm: 51.5,
      splits: [],
    },
  };

  const detail = mapAthleteDetail(payload);

  assert.equal(detail.timeline.length, 1, JSON.stringify(detail.timeline));
  assert.equal(detail.timeline[0]?.splitLabel, "START");
  assert.equal(detail.timeline[0]?.expected, true);
  assert.notEqual(detail.timeline[0]?.timeOfDayLabel, "—");
});

test("live mapper keeps official history and only the next Run prediction", () => {
  const detail = mapAthleteDetail(
    response("bike_finish", [
      "start",
      "swim_finish",
      "bike_start",
      "bike_1",
      "bike_finish",
    ]),
  );
  assert.deepEqual(
    detail.predictedCheckpoints?.map((checkpoint) => checkpoint.checkpoint),
    ["Run Start"],
  );
  assert.equal(detail.nextSplit?.checkpoint, "Run Start");
  assert.deepEqual(
    detail.timeline.map((split) => split.splitLabel),
    [
      "START",
      "SWIM FINISH",
      "BIKE START",
      "BIKE 1",
      "BIKE FINISH",
      "RUN START",
    ],
  );
  assert.equal(detail.timeline.at(-1)?.expected, true);
  assert.equal(detail.timeline.at(-1)?.state, "current");
});

test("actual mapper predicts only Run Finish after RUN 1", () => {
  const detail = mapAthleteDetail(
    response("run_1", [
      "start",
      "swim_finish",
      "bike_start",
      "bike_1",
      "bike_finish",
      "run_start",
      "run_1",
    ]),
  );
  assert.deepEqual(
    detail.predictedCheckpoints?.map((checkpoint) => checkpoint.checkpoint),
    ["Run Finish"],
  );
  assert.equal(detail.timeline.length, configuredSplits.length);
  assert.equal(detail.timeline.at(-1)?.expected, true);
});

test("accepted Run Start advances prediction and marker anchor to RUN 1", () => {
  const detail = mapAthleteDetail(
    response("run_start", [
      "start",
      "swim_finish",
      "bike_start",
      "bike_1",
      "bike_finish",
      "run_start",
    ]),
  );
  assert.equal(detail.nextSplit?.checkpoint, "RUN 1");
  assert.deepEqual(
    detail.predictedCheckpoints?.map((checkpoint) => checkpoint.checkpoint),
    ["RUN 1"],
  );
  assert.equal(detail.timeline.at(-1)?.splitLabel, "RUN 1");
  assert.equal(detail.timeline.at(-1)?.expected, true);
  assert.equal(detail.track?.seed.anchorKm, 41.5);
  assert.equal(detail.track?.seed.nextKm, 46.5);
});

test("finished athlete exposes complete official split history without an expected row", () => {
  const detail = mapAthleteDetail(
    response(
      "run_finish",
      configuredSplits.map((split) => split.splitKey),
    ),
  );

  assert.equal(detail.timeline.length, configuredSplits.length);
  assert.ok(detail.timeline.every((split) => split.state === "completed"));
  assert.ok(detail.timeline.every((split) => split.expected === false));
});

test("unchanged heartbeat reuses the complete participant presentation", () => {
  const payload = response("bike_1", [
    "start",
    "swim_finish",
    "bike_start",
    "bike_1",
  ]);
  payload.activeVersion = "version-heartbeat-1";
  const first = mapAthleteDetail(payload);
  const heartbeat = structuredClone(payload);
  (heartbeat.participantLive as Record<string, unknown>).heartbeatAt =
    "2026-09-01T12:10:01.000Z";
  const second = mapAthleteDetail(heartbeat);

  assert.strictEqual(second, first);
  assert.strictEqual(second.timeline, first.timeline);
});

test("thirty warm switches across six athletes reuse timelines without rebuilding", () => {
  const athletes = Array.from({ length: 6 }, (_, index) => {
    const payload = response("bike_1", [
      "start",
      "swim_finish",
      "bike_start",
      "bike_1",
    ]);
    const suffix = String(index + 1);
    payload.athlete.id = `participant-switch-${suffix}`;
    payload.athlete.participantUuid = `participant-switch-${suffix}`;
    payload.athlete.bib = `switch-${suffix}`;
    payload.activeVersion = "stable-switch-version";
    return payload;
  });

  const warmed = athletes.map((payload) => mapAthleteDetail(payload));
  const before = snapshotLivePerformance();
  const selected = Array.from({ length: 30 }, (_, index) => {
    const athleteIndex = index % athletes.length;
    const detail = mapAthleteDetail(structuredClone(athletes[athleteIndex]));
    assert.strictEqual(detail, warmed[athleteIndex]);
    return detail.header.bib;
  });
  const after = snapshotLivePerformance();

  assert.equal(selected.length, 30);
  assert.equal(after.timelineDerivations - before.timelineDerivations, 0);
  assert.equal(after.timelineCacheReads - before.timelineCacheReads, 0);
  assert.equal(after.athleteDetailRequests - before.athleteDetailRequests, 0);
  assert.equal(after.courseResolutions - before.courseResolutions, 0);
  assert.equal(after.gpxRequests - before.gpxRequests, 0);
  assert.equal(after.gpxParses - before.gpxParses, 0);
  assert.equal(after.socketCreates - before.socketCreates, 0);
  assert.equal(after.socketCloses - before.socketCloses, 0);
});

test("canonical version change invalidates a finished presentation cache", () => {
  const payload = response(
    "run_finish",
    configuredSplits.map((split) => split.splitKey),
  );
  payload.activeVersion = "version-finished-1";
  const first = mapAthleteDetail(payload);
  const corrected = structuredClone(payload);
  corrected.activeVersion = "version-finished-2";
  const second = mapAthleteDetail(corrected);

  assert.notStrictEqual(second, first);
  assert.equal(second.header.status, "finished");
});

test("prediction view model does not fabricate timing across an unpaced transition", () => {
  const detail = mapAthleteDetail(
    response("bike_finish", [
      "start",
      "swim_finish",
      "bike_start",
      "bike_1",
      "bike_finish",
    ]),
  );
  assert.equal(detail.nextSplit?.estimatedTimeOfDay, "—");
  assert.equal(detail.nextSplit?.estimatedRaceElapsed, "—");
  assert.equal(detail.prediction, undefined);
});

test("live map and prediction initialize from canonical server time and next ETA", () => {
  const payload = response("start", ["start"]);
  payload.athlete.status = "ON_COURSE";
  payload.participantLive = {
    resolvedRaceState: {
      status: "ON_COURSE",
      currentLeg: "SWIM",
      currentSplit: "start",
      officialDistanceKm: 0,
      totalDistanceKm: 51.5,
      predictedPaceSecondsPerKm: 1_800,
      serverNow: "2026-09-01T12:29:11.000Z",
      etaNextSplit: "2026-09-01T12:45:11.000Z",
      estimatedFinishTime: "2026-09-01T12:45:11.000Z",
      splits: [acceptedSplit("start", 0)],
    },
  };

  const detail = mapAthleteDetail(payload);

  assert.equal(detail.nextSplit?.estimatedTimeOfDay, "12:45:11");
  assert.equal(detail.nextSplit?.estimatedRaceElapsed, "00:45:11");
  assert.equal(detail.track?.initialLiveClockSec, 1_751);
  assert.equal(
    detail.track?.predictedArrivalAt,
    Date.parse("2026-09-01T12:45:11.000Z"),
  );
});
