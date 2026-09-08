import assert from "node:assert/strict";
import test from "node:test";

import { buildCanonicalLeaderboards } from "./leaderboards.ts";

const contest = {
  providerContestUuid: "5JUm5wtI",
  displayName: "Test 1",
  timezone: "Asia/Kolkata",
  startConfiguration: { mode: "CHIP" },
  legs: [],
  cutoffs: {},
  splits: [
    {
      key: "start",
      displayName: "Start",
      order: 1,
      cumulativeDistanceKm: 0,
      rankingEnabled: true,
      isStart: true,
    },
    {
      key: "swim-finish",
      displayName: "Swim Finish",
      order: 2,
      cumulativeDistanceKm: 1,
      rankingEnabled: true,
    },
    {
      key: "bike-start",
      displayName: "Bike Start",
      order: 3,
      cumulativeDistanceKm: 1,
      rankingEnabled: true,
    },
    {
      key: "bike-1",
      displayName: "BIKE 1",
      order: 4,
      cumulativeDistanceKm: 11,
      rankingEnabled: true,
    },
    {
      key: "finish",
      displayName: "Finish",
      order: 5,
      cumulativeDistanceKm: 21,
      rankingEnabled: true,
      isFinish: true,
    },
  ],
  transitions: [],
};

function snapshot(options: {
  bib: string;
  participantUuid: string;
  status: string;
  completed: Array<[string, number]>;
  contestUuid?: string;
  visibility?: string;
}) {
  const reads = Object.fromEntries(
    contest.splits.map((split) => [split.key, null]),
  ) as Record<string, unknown>;
  for (const [key, elapsedSeconds] of options.completed) {
    reads[key] = {
      readId: `${options.bib}:${key}`,
      status: "official",
      source: "FEIBOT_PROCESSED",
      elapsedSeconds,
      timestamp: new Date(
        Date.parse("2026-08-30T11:40:00.000Z") + elapsedSeconds * 1000,
      ).toISOString(),
    };
  }
  return {
    identity: {
      participantUuid: options.participantUuid,
      providerParticipantUuid: `provider-${options.bib}`,
      bib: options.bib,
      displayName: `Athlete ${options.bib}`,
      trackingVisibility: options.visibility ?? "PUBLIC",
    },
    contestUuid: options.contestUuid ?? contest.providerContestUuid,
    raceState: {
      status: options.status,
      distanceCompletedKm: options.completed.length,
      currentLegType: options.status === "finished" ? "finish" : "bike",
    },
    reads,
    splits: [],
    splitRankings: {},
    overallRanking: {},
    sections: [],
    location: null,
    bergmanIdentity: {},
    versions: {
      course: 1,
      participant: 1,
      timing: 1,
      profile: 1,
      leaderboard: 1,
    },
    calculated: {
      overallSeconds:
        options.status === "finished" ? options.completed.at(-1)?.[1] : null,
    },
  } as any;
}

test("live board keeps athlete 1027-shaped on-course data and orders finished first", () => {
  const athlete1027 = snapshot({
    bib: "1027",
    participantUuid: "race:4tegxjmx:5jum5wti:1027",
    status: "running",
    completed: [
      ["start", 0],
      ["swim-finish", 600],
      ["bike-start", 650],
      ["bike-1", 1_200],
    ],
  });
  const finisher = snapshot({
    bib: "1028",
    participantUuid: "race:4tegxjmx:5jum5wti:1028",
    status: "finished",
    completed: [
      ["start", 0],
      ["swim-finish", 550],
      ["bike-start", 600],
      ["bike-1", 1_100],
      ["finish", 2_000],
    ],
  });
  const otherContest = snapshot({
    bib: "1029",
    participantUuid: "race:4tegxjmx:other:1029",
    contestUuid: "other",
    status: "running",
    completed: [["start", 0]],
  });
  const artifacts = buildCanonicalLeaderboards({
    eventId: "tImWYZAi99k8ILwxrTSO",
    buildVersion: "test-build",
    course: { contests: [contest] } as any,
    snapshots: [athlete1027, finisher, otherContest],
  });
  const board = artifacts.leaderboards.find(
    (entry) => entry.mode === "overall",
  );
  assert.deepEqual(
    board?.entries.map((entry) => entry.bib),
    ["1028", "1027"],
  );
  assert.equal(
    board?.entries.find((entry) => entry.bib === "1027")?.lastSplitKey,
    "bike-1",
  );
  assert.equal(
    board?.entries.some((entry) => entry.bib === "1029"),
    false,
  );
});

test("true empty board remains empty without accepted timing evidence", () => {
  const waiting = snapshot({
    bib: "1030",
    participantUuid: "race:4tegxjmx:5jum5wti:1030",
    status: "not_started",
    completed: [],
  });
  const artifacts = buildCanonicalLeaderboards({
    eventId: "tImWYZAi99k8ILwxrTSO",
    buildVersion: "test-build",
    course: { contests: [contest] } as any,
    snapshots: [waiting],
  });
  assert.equal(
    artifacts.leaderboards.find((entry) => entry.mode === "overall")?.entries
      .length,
    0,
  );
});

test("12-athlete fixture ranks accepted evidence once across overall, gender, age, passes, corrections, and contest scope", () => {
  const passContest = {
    ...contest,
    providerContestUuid: "contest-a",
    splits: [
      contest.splits[0],
      { ...contest.splits[3], key: "bike-loop-1", order: 2, providerTimingPointId: "shared-bike-reader", passNumber: 1 },
      { ...contest.splits[3], key: "bike-loop-2", order: 3, providerTimingPointId: "shared-bike-reader", passNumber: 2 },
      { ...contest.splits[4], order: 4 },
    ],
  };
  const otherContest = { ...passContest, providerContestUuid: "contest-b" };
  const make = (bib: string, contestUuid: string, status: string, completed: Array<[string, number]>, genderKey: string, ageGroupKey: string) => {
    const athlete = snapshot({ bib, participantUuid: `race:provider:${contestUuid}:${bib}`, contestUuid, status, completed });
    athlete.identity.genderKey = genderKey;
    athlete.identity.ageGroupKey = ageGroupKey;
    athlete.reads = Object.fromEntries([...passContest.splits, ...contest.splits].map((split) => [split.key, null]));
    for (const [key, elapsedSeconds] of completed) {
      athlete.reads[key] = {
        readId: `${bib}:${key}`,
        status: "official",
        source: "FEIBOT_PROCESSED",
        elapsedSeconds,
        officialElapsedSeconds: elapsedSeconds,
        timestamp: new Date(Date.parse("2026-08-30T11:40:00.000Z") + elapsedSeconds * 1000).toISOString(),
      };
    }
    athlete.calculated.overallSeconds = status === "finished" ? completed.at(-1)?.[1] : null;
    return athlete;
  };
  const athletes = [
    make("1001", "contest-a", "finished", [["start", 0], ["bike-loop-1", 1200], ["bike-loop-2", 2400], ["finish", 3600]], "male", "m30-34"),
    make("1002", "contest-a", "finished", [["start", 0], ["bike-loop-1", 1150], ["bike-loop-2", 2300], ["finish", 3480]], "male", "m30-34"),
    make("1003", "contest-a", "finished", [["start", 0], ["bike-loop-1", 1250], ["bike-loop-2", 2450], ["finish", 3700]], "female", "f30-34"),
    make("1004", "contest-a", "finished", [["start", 0], ["bike-loop-1", 1260], ["bike-loop-2", 2460], ["finish", 3700]], "female", "f30-34"),
    make("1005", "contest-a", "running", [["start", 0], ["bike-loop-1", 1000], ["bike-loop-2", 2000]], "male", "m40-44"),
    make("1006", "contest-a", "running", [["start", 0], ["bike-loop-1", 1500]], "female", "f40-44"),
    make("1007", "contest-a", "dnf", [["start", 0], ["bike-loop-1", 1400]], "male", "m40-44"),
    make("1008", "contest-a", "disqualified", [["start", 0]], "female", "f40-44"),
    make("2001", "contest-b", "finished", [["start", 0], ["bike-loop-1", 1100], ["bike-loop-2", 2200], ["finish", 3300]], "male", "m30-34"),
    make("2002", "contest-b", "running", [["start", 0], ["bike-loop-1", 900], ["bike-loop-2", 1800]], "female", "f30-34"),
    make("2003", "contest-b", "dns", [], "female", "f40-44"),
    make("2004", "contest-b", "finished", [["start", 0], ["bike-loop-1", 800]], "male", "m40-44"),
  ];
  athletes.find((athlete) => athlete.identity.bib === "1007")!.raceState = {
    ...athletes.find((athlete) => athlete.identity.bib === "1007")!.raceState,
    statusSource: "AUTO_CUTOFF_RULE",
    statusReason: "CONFIRMED_CUTOFF",
  };
  const build = (rows: any[], version: number) => buildCanonicalLeaderboards({
    eventId: "race-operations-fixture",
    buildVersion: "fixture-build",
    course: { contests: [passContest, otherContest] } as any,
    snapshots: rows,
    leaderboardVersion: version,
    updatedAt: "2026-09-03T16:00:00.000Z",
  });
  const first = build(athletes, 20);
  const board = first.leaderboards.find((row) => row.contestUuid === "contest-a" && row.mode === "overall");
  assert.deepEqual(board?.entries.map((row) => row.bib), ["1002", "1001", "1003", "1004", "1005", "1006"]);
  assert.deepEqual(
    first.leaderboards.find((row) => row.contestUuid === "contest-a" && row.mode === "gender" && row.qualifier === "male")?.entries.map((row) => row.bib),
    ["1002", "1001", "1005"],
  );
  assert.deepEqual(
    first.leaderboards.find((row) => row.contestUuid === "contest-a" && row.mode === "age" && row.qualifier === "m30-34")?.entries.map((row) => row.bib),
    ["1002", "1001"],
  );
  assert.equal(board?.entries.some((row) => row.bib.startsWith("2")), false);
  assert.deepEqual(
    first.splitLeaderboards.find((row) => row.contestUuid === "contest-a" && row.splitKey === "bike-loop-2" && row.mode === "overall")?.entries.map((row) => row.bib),
    ["1005", "1002", "1001", "1003", "1004"],
  );
  assert.equal(first.snapshots.find((row) => row.identity.bib === "1002")?.leaderboardVersion, 20);

  const corrected = athletes.map((athlete) => {
    if (athlete.identity.bib !== "1001") return athlete;
    return {
      ...athlete,
      timingVersion: 2,
      versions: { ...athlete.versions, timing: 2 },
      reads: { ...athlete.reads, finish: { ...athlete.reads.finish, elapsedSeconds: 3400, officialElapsedSeconds: 3400 } },
      calculated: { ...athlete.calculated, overallSeconds: 3400 },
    };
  });
  const correctedBoard = build(corrected, 21).leaderboards.find((row) => row.contestUuid === "contest-a" && row.mode === "overall");
  assert.deepEqual(correctedBoard?.entries.slice(0, 2).map((row) => row.bib), ["1001", "1002"]);
  const correctedAthlete = build(corrected, 21).snapshots.find((row) => row.identity.bib === "1001");
  assert.equal(correctedAthlete?.timingVersion, 2);
  assert.equal(correctedAthlete?.leaderboardVersion, 21);
});
