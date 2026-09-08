import assert from "node:assert/strict";
import test from "node:test";

import { buildCanonicalLeaderboards } from "./leaderboards.ts";

const PROVIDER = "6ueOOKHs";
const OTHER_PROVIDER = "other-provider";
const CONTEST = "1QkaizPT";
const OTHER_CONTEST = "2qwc3RDn";
const ALL_SWIMATHON_CONTESTS = [CONTEST, OTHER_CONTEST, "3P2SrGwr", "7Yc3etJU"];

const splits = [
  { key: "start", displayName: "Start", order: 1, cumulativeDistanceKm: 0, rankingEnabled: true, isStart: true, providerTimingPointId: "shared-start", passNumber: 1 },
  { key: "loop-1", displayName: "Loop 1", order: 2, cumulativeDistanceKm: 0.25, rankingEnabled: true, providerTimingPointId: "shared-loop", passNumber: 1 },
  { key: "loop-2", displayName: "Loop 2", order: 3, cumulativeDistanceKm: 0.5, rankingEnabled: true, providerTimingPointId: "shared-loop", passNumber: 2 },
  { key: "finish", displayName: "Finish", order: 4, cumulativeDistanceKm: 0.5, rankingEnabled: true, isFinish: true, providerTimingPointId: "shared-start", passNumber: 2 },
];

const contest = {
  providerEventUuid: PROVIDER,
  providerContestUuid: CONTEST,
  displayName: "Kids 500 m",
  timezone: "Asia/Kolkata",
  startConfiguration: { mode: "CHIP" },
  legs: [],
  transitions: [],
  cutoffs: {},
  splits,
};

function read(bib: string, key: string, elapsedSeconds: number, status = "official") {
  const split = splits.find((candidate) => candidate.key === key)!;
  return {
    readId: `${bib}:${key}`,
    status,
    source: "feibot",
    elapsedSeconds,
    officialElapsedSeconds: elapsedSeconds,
    chipElapsedSeconds: elapsedSeconds,
    timestamp: new Date(Date.parse("2026-09-05T03:30:00.000Z") + elapsedSeconds * 1_000).toISOString(),
    occurredAt: new Date(Date.parse("2026-09-05T03:30:00.000Z") + elapsedSeconds * 1_000).toISOString(),
    providerTimingPointId: split.providerTimingPointId,
    passNumber: split.passNumber,
  };
}

function athlete(options: {
  bib: string;
  status: string;
  completed?: Array<[string, number]>;
  gender?: string | null;
  age?: string | null;
  contestUuid?: string;
  providerEventUuid?: string;
}) {
  const reads = Object.fromEntries(splits.map((split) => [split.key, null])) as Record<string, any>;
  for (const [key, elapsed] of options.completed || []) reads[key] = read(options.bib, key, elapsed);
  const last = (options.completed || []).at(-1);
  return {
    eventId: "event-1",
    buildVersion: "build-1",
    providerEventUuid: options.providerEventUuid ?? PROVIDER,
    providerContestUuid: options.contestUuid ?? CONTEST,
    contestUuid: options.contestUuid ?? CONTEST,
    identity: {
      participantUuid: `participant-${options.bib}`,
      providerParticipantUuid: `provider-participant-${options.bib}`,
      bib: options.bib,
      displayName: `Athlete ${options.bib}`,
      genderKey: options.gender ?? null,
      ageGroupKey: options.age ?? null,
      clubName: null,
      countryCode: null,
      photoUrl: null,
      trackingVisibility: "PUBLIC",
    },
    bergmanIdentity: {},
    raceState: {
      status: options.status,
      currentLegType: options.status === "finished" ? "run" : "swim",
      distanceCompletedKm: last ? splits.find((split) => split.key === last[0])?.cumulativeDistanceKm ?? 0 : 0,
      resolved: options.status === "finished" ? { officialTimingMode: "CHIP", officialResultElapsedMs: (last?.[1] ?? 0) * 1_000 } : {},
    },
    reads,
    splits: [],
    sections: [],
    calculated: { overallSeconds: options.status === "finished" ? last?.[1] ?? null : null },
    overallRanking: {},
    splitRankings: {},
    versions: { course: 1, participant: 1, timing: 1, profile: 1, leaderboard: 1 },
    location: null,
  } as any;
}

function build(rows: any[], leaderboardVersion = 1) {
  return buildCanonicalLeaderboards({
    eventId: "event-1",
    buildVersion: "build-1",
    leaderboardVersion,
    course: {
      eventId: "event-1",
      buildVersion: "build-1",
      contests: [
        contest,
        { ...contest, providerContestUuid: OTHER_CONTEST, displayName: "1 km" },
      ],
    } as any,
    snapshots: rows,
    updatedAt: "2026-09-05T04:00:00.000Z",
  });
}

const fixture = [
  athlete({ bib: "101", status: "not_started", gender: "male", age: "under-12" }),
  athlete({ bib: "102", status: "not_started", gender: "female", age: "under-12" }),
  athlete({ bib: "103", status: "swimming", completed: [["start", 0]], gender: "male", age: "under-12" }),
  athlete({ bib: "104", status: "swimming", completed: [["start", 0], ["loop-1", 400]], gender: "female", age: "under-12" }),
  athlete({ bib: "105", status: "finished", completed: [["start", 0], ["loop-1", 390], ["loop-2", 700], ["finish", 1_000]], gender: "male", age: "under-12" }),
  athlete({ bib: "106", status: "finished", completed: [["start", 0], ["loop-1", 395], ["loop-2", 705], ["finish", 1_000]], gender: "female", age: "under-12" }),
  athlete({ bib: "107", status: "dnf", completed: [["start", 0], ["loop-1", 450]], gender: "male", age: "under-12" }),
  athlete({ bib: "108", status: "disqualified", completed: [["start", 0], ["loop-1", 380]], gender: "female", age: "under-12" }),
];

test("pre-start is an intentional empty canonical leaderboard", () => {
  const waitingChip = athlete({ bib: "100", status: "waiting_chip_start", gender: "male", age: "under-12" });
  const artifacts = build([waitingChip, ...fixture.slice(0, 2)]);
  const overall = artifacts.leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")!;
  assert.equal(overall.entries.length, 0);
});

test("only accepted reads create timing evidence or split placement", () => {
  const pending = athlete({ bib: "114", status: "swimming", completed: [["start", 0], ["loop-1", 300]] });
  pending.reads.start.status = "pending";
  pending.reads["loop-1"].status = "rejected";
  pending.calculated.overallSeconds = 300;
  const artifacts = build([pending]);
  assert.equal(artifacts.leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")?.entries.length, 0);
  assert.equal(artifacts.splitLeaderboards.find((board) => board.contestUuid === CONTEST && board.splitKey === "loop-1" && board.mode === "overall")?.entries.length, 0);
});

test("eight-athlete fixture ranks finishers then canonical progress with deterministic equal-time tie", () => {
  const artifacts = build(fixture);
  const overall = artifacts.leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")!;
  assert.deepEqual(overall.entries.map((entry) => entry.bib), ["105", "106", "104", "103"]);
  assert.deepEqual(overall.entries.map((entry) => entry.rank), [1, 2, 3, 4]);
  assert.deepEqual(overall.entries.slice(0, 2).map((entry) => entry.elapsedSeconds), [1_000, 1_000]);
  assert.equal(overall.entries.some((entry) => ["101", "102", "107", "108"].includes(entry.bib)), false);
});

test("gender and age aggregates retain their own official rank scope", () => {
  const artifacts = build(fixture);
  const male = artifacts.leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "gender" && board.qualifier === "male")!;
  const female = artifacts.leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "gender" && board.qualifier === "female")!;
  const age = artifacts.leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "age" && board.qualifier === "under-12")!;
  assert.deepEqual(male.entries.map((entry) => [entry.bib, entry.rank]), [["105", 1], ["103", 2]]);
  assert.deepEqual(female.entries.map((entry) => [entry.bib, entry.rank]), [["106", 1], ["104", 2]]);
  assert.deepEqual(age.entries.map((entry) => entry.bib), ["105", "106", "104", "103"]);
  assert.deepEqual(
    ["105", "106", "104", "103"].map((bib) => [
      bib,
      artifacts.snapshots.find((snapshot) => snapshot.identity.bib === bib)?.overallRanking.ageGroupRank,
    ]),
    [["105", 1], ["106", 1], ["104", 2], ["103", 2]],
  );
});

test("contest and provider isolation are case-insensitive without changing authoritative UUID casing", () => {
  const lowerCaseContest = athlete({ bib: "109", status: "swimming", completed: [["start", 0]], contestUuid: CONTEST.toLowerCase() });
  const otherContest = athlete({ bib: "201", status: "finished", completed: [["start", 0], ["finish", 900]], contestUuid: OTHER_CONTEST });
  const otherProvider = athlete({ bib: "110", status: "finished", completed: [["start", 0], ["finish", 800]], providerEventUuid: OTHER_PROVIDER });
  const artifacts = build([lowerCaseContest, otherContest, otherProvider]);
  const board = artifacts.leaderboards.find((entry) => entry.contestUuid === CONTEST && entry.mode === "overall")!;
  assert.equal(board.contestUuid, CONTEST);
  assert.deepEqual(board.entries.map((entry) => entry.bib), ["109"]);
  assert.deepEqual(
    artifacts.leaderboards.find((entry) => entry.contestUuid === OTHER_CONTEST && entry.mode === "overall")?.entries.map((entry) => entry.bib),
    ["201"],
  );
});

test("all four Bengaluru Swimathon contests produce independent mixed-case aggregates", () => {
  const rows = ALL_SWIMATHON_CONTESTS.map((contestUuid, index) =>
    athlete({
      bib: String(300 + index),
      status: "swimming",
      completed: [["start", 0], ["loop-1", 300 + index]],
      contestUuid,
      providerEventUuid: PROVIDER,
    }),
  );
  const artifacts = buildCanonicalLeaderboards({
    eventId: "event-1",
    buildVersion: "build-1",
    leaderboardVersion: 1,
    course: {
      eventId: "event-1",
      buildVersion: "build-1",
      contests: ALL_SWIMATHON_CONTESTS.map((providerContestUuid) => ({
        ...contest,
        providerContestUuid,
        displayName: providerContestUuid,
      })),
    } as any,
    snapshots: rows,
  });
  for (const [index, contestUuid] of ALL_SWIMATHON_CONTESTS.entries()) {
    const board = artifacts.leaderboards.find((candidate) =>
      candidate.contestUuid === contestUuid && candidate.mode === "overall"
    );
    assert.ok(board);
    assert.equal(board.contestUuid, contestUuid);
    assert.deepEqual(board.entries.map((entry) => entry.bib), [String(300 + index)]);
  }
});

test("finished status without an accepted final split is rejected as inconsistent", () => {
  const inconsistent = athlete({ bib: "111", status: "finished", completed: [["start", 0], ["loop-1", 400]] });
  const board = build([inconsistent]).leaderboards.find((entry) => entry.contestUuid === CONTEST && entry.mode === "overall")!;
  assert.equal(board.entries.length, 0);
});

test("official CHIP result time is the finish ranking basis", () => {
  const slowerCalculated = athlete({ bib: "112", status: "finished", completed: [["start", 0], ["finish", 1_010]] });
  slowerCalculated.calculated.overallSeconds = 2_000;
  slowerCalculated.raceState.resolved.officialResultElapsedMs = 990_000;
  const other = athlete({ bib: "113", status: "finished", completed: [["start", 0], ["finish", 1_000]] });
  const board = build([other, slowerCalculated]).leaderboards.find((entry) => entry.contestUuid === CONTEST && entry.mode === "overall")!;
  assert.deepEqual(board.entries.map((entry) => [entry.bib, entry.elapsedSeconds]), [["112", 990], ["113", 1_000]]);
});

test("split keys and pass numbers keep a reused physical timing point isolated", () => {
  const artifacts = build(fixture);
  const firstPass = artifacts.splitLeaderboards.find((board) => board.contestUuid === CONTEST && board.splitKey === "loop-1" && board.mode === "overall")!;
  const secondPass = artifacts.splitLeaderboards.find((board) => board.contestUuid === CONTEST && board.splitKey === "loop-2" && board.mode === "overall")!;
  assert.deepEqual(firstPass.entries.map((entry) => entry.bib), ["105", "106", "104", "107"]);
  assert.deepEqual(secondPass.entries.map((entry) => entry.bib), ["105", "106"]);
});

test("a corrected accepted read reranks only the affected contest aggregate", () => {
  const before = build(fixture, 1);
  const corrected = structuredClone(fixture);
  corrected[5].reads.finish = read("106", "finish", 990, "corrected");
  corrected[5].calculated.overallSeconds = 990;
  corrected[5].raceState.resolved.officialResultElapsedMs = 990_000;
  const after = build(corrected, 2);
  const beforeBoard = before.leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")!;
  const afterBoard = after.leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")!;
  assert.deepEqual(beforeBoard.entries.slice(0, 2).map((entry) => entry.bib), ["105", "106"]);
  assert.deepEqual(afterBoard.entries.slice(0, 2).map((entry) => entry.bib), ["106", "105"]);
  assert.equal(after.manifests.find((manifest) => manifest.contestUuid === CONTEST)?.leaderboardVersion, 2);
});

test("removed finish evidence and a corrected terminal status immediately change eligibility", () => {
  const finisher = athlete({ bib: "115", status: "finished", completed: [["start", 0], ["finish", 900]] });
  assert.deepEqual(
    build([finisher]).leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")?.entries.map((row) => row.bib),
    ["115"],
  );

  const removed = structuredClone(finisher);
  removed.reads.finish = null;
  assert.equal(
    build([removed], 2).leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")?.entries.length,
    0,
  );

  const correctedStatus = structuredClone(finisher);
  correctedStatus.raceState.status = "dnf";
  correctedStatus.raceState.statusSource = "MANUAL_OVERRIDE";
  assert.equal(
    build([correctedStatus], 3).leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")?.entries.length,
    0,
  );
});

test("confirmed cutoff, DNS, DNF and DSQ never enter the overall ranked board", () => {
  const cutoff = athlete({ bib: "116", status: "dnf", completed: [["start", 0], ["loop-1", 420]] });
  cutoff.raceState.statusSource = "AUTO_CUTOFF_RULE";
  cutoff.raceState.statusReason = "CONFIRMED_CUTOFF";
  const dns = athlete({ bib: "117", status: "dns", completed: [["start", 0]] });
  const dnf = athlete({ bib: "118", status: "dnf", completed: [["start", 0]] });
  const dsq = athlete({ bib: "119", status: "disqualified", completed: [["start", 0]] });
  const overall = build([cutoff, dns, dnf, dsq]).leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")!;
  assert.equal(overall.entries.length, 0);
  const firstSplit = build([cutoff, dns, dnf, dsq]).splitLeaderboards.find((board) => board.contestUuid === CONTEST && board.splitKey === "start" && board.mode === "overall")!;
  assert.deepEqual(firstSplit.entries.map((row) => row.bib), ["116", "118"]);
});

test("finish result stays frozen until accepted official timing changes", () => {
  const finisher = athlete({ bib: "120", status: "finished", completed: [["start", 0], ["finish", 1_100]] });
  const presentationOnly = structuredClone(finisher);
  presentationOnly.calculated.overallSeconds = 99;
  presentationOnly.raceState.distanceCompletedKm = 999;
  const before = build([finisher]).leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")!.entries[0];
  const after = build([presentationOnly], 2).leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")!.entries[0];
  assert.equal(before.elapsedSeconds, 1_100);
  assert.equal(after.elapsedSeconds, 1_100);
});

test("a corrected official elapsed caused by start-time correction reranks without changing buildVersion", () => {
  const first = athlete({ bib: "121", status: "finished", completed: [["start", 0], ["finish", 1_000]] });
  const second = athlete({ bib: "122", status: "finished", completed: [["start", 0], ["finish", 1_010]] });
  const corrected = structuredClone(second);
  corrected.reads.finish.officialElapsedSeconds = 990;
  corrected.reads.finish.chipElapsedSeconds = 990;
  corrected.raceState.resolved.officialResultElapsedMs = 990_000;
  const before = build([first, second], 4).leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")!;
  const after = build([first, corrected], 5).leaderboards.find((board) => board.contestUuid === CONTEST && board.mode === "overall")!;
  assert.deepEqual(before.entries.map((row) => row.bib), ["121", "122"]);
  assert.deepEqual(after.entries.map((row) => row.bib), ["122", "121"]);
  assert.equal(after.buildVersion, before.buildVersion);
});
