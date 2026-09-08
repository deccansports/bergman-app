import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCanonicalSplitCutoff,
  recalculateAthleteSnapshot,
} from "./snapshot";

const startAt = "2026-09-05T02:32:29.000Z";
const at = (seconds: number) =>
  new Date(Date.parse(startAt) + seconds * 1000).toISOString();

function split(
  key: string,
  order: number,
  options: Record<string, unknown> = {},
) {
  return {
    key,
    providerSplitId: key,
    providerTimingPointId: "shared",
    displayName:
      key === "checkpoint" ? "2 KM" : key === "finish" ? "Finish" : "Start",
    order,
    required: true,
    isStart: key === "start",
    isRaceStart: key === "start",
    isFinish: key === "finish",
    isRaceFinish: key === "finish",
    legType: "swim",
    cumulativeDistanceKm: order * 2,
    distanceInLegKm: order * 2,
    minimumSegmentSeconds: key === "finish" ? 900 : 0,
    ...options,
  };
}

function read(key: string, seconds: number) {
  return {
    readId: key,
    participantUuid: "participant",
    providerParticipantUuid: "provider-participant",
    contestUuid: "contest-4km",
    providerSplitId: key,
    providerTimingPointId: "shared",
    splitKey: key,
    splitName: key,
    elapsedSeconds: seconds,
    overallElapsedSeconds: seconds,
    legElapsedSeconds: seconds,
    segmentElapsedSeconds: seconds,
    timeOfDay: null,
    timestamp: at(seconds),
    occurredAt: at(seconds),
    receivedAt: at(seconds),
    passNumber: seconds === 0 ? 1 : key === "checkpoint" ? 2 : 3,
    status: "official",
    source: "final",
  };
}

function fixture(
  checkpointSeconds: number,
  finishSeconds: number | null,
  optional = false,
) {
  const checkpoint = split("checkpoint", 2, { required: !optional });
  const contest: any = {
    providerContestUuid: "contest-4km",
    providerEventUuid: "provider-event",
    displayName: "4 KM",
    raceType: "swimathon",
    timezone: "UTC",
    totalDistanceKm: 4,
    startConfiguration: {
      mode: "CHIP",
      timingReorderBufferMs: 0,
      dnsGraceMinutes: 60,
      strictFinalCutoff: true,
    },
    cutoffs: { checkpoint: 4500 },
    splits: [split("start", 1), checkpoint, split("finish", 3)],
    legs: [
      {
        key: "swim",
        type: "swim",
        displayName: "Swim",
        order: 1,
        startSplitKey: "start",
        finishSplitKey: "finish",
        distanceKm: 4,
        cutoffSeconds: null,
        splits: [],
      },
    ],
    transitions: [],
    sections: [],
  };
  const snapshot: any = {
    schemaVersion: 1,
    eventId: "event",
    buildVersion: "build",
    updatedAt: at(finishSeconds ?? checkpointSeconds),
    contestUuid: "contest-4km",
    courseVersion: 1,
    timingVersion: 1,
    leaderboardVersion: 1,
    identity: {
      participantUuid: "participant",
      providerParticipantUuid: "provider-participant",
      bib: "4110",
    },
    bergmanIdentity: {},
    raceState: { status: "running", statusSource: null },
    startTiming: {
      officialStartTime: startAt,
      chipStartDetectionTime: startAt,
      startTimeSource: "CHIP",
      startTimeLocked: true,
      startStatus: "ON_COURSE",
    },
    reads: {
      start: read("start", 0),
      checkpoint: read("checkpoint", checkpointSeconds),
      finish: finishSeconds === null ? null : read("finish", finishSeconds),
    },
    calculated: {},
    splits: [],
    sections: [],
    splitRankings: {},
    overallRanking: {},
    location: null,
    versions: {
      course: 1,
      participant: 1,
      timing: 1,
      profile: 1,
      leaderboard: 1,
    },
  };
  return { contest, snapshot, checkpoint };
}

test("split cutoff is inclusive at exactly 4500 seconds", () => {
  const { contest, checkpoint } = fixture(4500, null);
  const decision = evaluateCanonicalSplitCutoff({
    contest,
    candidateSplit: checkpoint,
    candidateRead: read("checkpoint", 4500) as any,
    baselineTimestamp: startAt,
  });
  assert.equal(decision.accepted, true);
  assert.equal(decision.exceededBySeconds, null);
});

test("split cutoff rejects one second over", () => {
  const { contest, checkpoint } = fixture(4501, null);
  const decision = evaluateCanonicalSplitCutoff({
    contest,
    candidateSplit: checkpoint,
    candidateRead: read("checkpoint", 4501) as any,
    baselineTimestamp: startAt,
  });
  assert.equal(decision.accepted, false);
  assert.equal(decision.reason, "split_cutoff_exceeded");
  assert.equal(decision.exceededBySeconds, 1);
});

test("Bib 4110 mandatory cutoff failure remains DNF while retaining later Finish evidence", () => {
  const { contest, snapshot } = fixture(4583, 4625);
  const result = recalculateAthleteSnapshot(snapshot, contest, at(4625));
  assert.equal(result.reads.checkpoint?.status, "invalid");
  assert.equal(
    result.reads.checkpoint?.canonicalValidationReason,
    "SPLIT_CUTOFF_EXCEEDED",
  );
  assert.equal(result.reads.checkpoint?.cutoffElapsedSeconds, 4583);
  assert.equal(result.reads.checkpoint?.cutoffExceededBySeconds, 83);
  assert.equal(result.reads.finish?.status, "official");
  assert.equal(result.raceState.resolved?.status, "DNF");
  assert.equal(
    result.raceState.resolved?.statusReason,
    "CHECKPOINT_CUTOFF_EXCEEDED",
  );
  assert.equal(result.raceState.resolved?.finalSplitAccepted, false);
  assert.equal(result.raceState.resolved?.overallRank, null);
});

test("optional split cutoff does not automatically DNF or block a later valid Finish", () => {
  const { contest, snapshot } = fixture(4501, 6000, true);
  const result = recalculateAthleteSnapshot(snapshot, contest, at(6000));
  assert.equal(result.reads.checkpoint?.status, "invalid");
  assert.equal(result.raceState.resolved?.status, "FINISHED");
  assert.equal(result.raceState.resolved?.finalSplitAccepted, true);
});

test("contest without a split cutoff retains normal progression", () => {
  const { contest, snapshot } = fixture(4583, 6000);
  contest.cutoffs = {};
  const result = recalculateAthleteSnapshot(snapshot, contest, at(6000));
  assert.equal(result.reads.checkpoint?.status, "official");
  assert.equal(result.raceState.resolved?.status, "FINISHED");
});
