import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import type { LeaderboardRow } from "../../../core/types";
import {
  buildLeaderboardSplitColumns,
  isAcceptedLeaderboardSplit,
  rankLeaderboardRowsAtSplit,
} from "./leaderboardSplitProjection";

const accepted = (
  splitKey: string,
  displayName: string,
  order: number,
  elapsedSeconds: number,
  legType: string,
) => ({
  splitKey,
  key: splitKey,
  displayName,
  order,
  legType,
  readAt: `2026-09-06T06:${String(order).padStart(2, "0")}:00.000Z`,
  elapsedSeconds,
  timingStatus: "accepted",
});

const pending = (
  splitKey: string,
  displayName: string,
  order: number,
  legType: string,
) => ({
  splitKey,
  key: splitKey,
  displayName,
  order,
  legType,
  readAt: null,
  elapsedSeconds: null,
});

const triathlonSplits = [
  pending("swim_start", "Swim Start", 1, "swim"),
  pending("swim_finish", "Swim Finish", 2, "swim"),
  pending("bike_start", "Bike Start", 3, "bike"),
  pending("bike_1", "Bike 1", 4, "bike"),
  pending("bike_finish", "Bike Finish", 5, "bike"),
  pending("run_start", "Run Start", 6, "run"),
  pending("run_finish", "Run Finish", 7, "run"),
];

const row = (
  bib: string,
  splits: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
) => ({
  rank: 1,
  athleteId: `race:6qtff6cr:k9jmboom:${bib}`,
  participantUuid: `race:6qtff6cr:k9jmboom:${bib}`,
  providerEventUuid: "6QTff6CR",
  providerContestUuid: "k9jmBOom",
  contestUuid: "k9jmBOom",
  contest: "Bergman 102 Triathlon",
  name: `Athlete ${bib}`,
  displayName: `Athlete ${bib}`,
  bib,
  status: "ON_COURSE",
  splits,
  ...overrides,
});

test("live response split fields survive repository row mapping", () => {
  const raw = row("1001", [
    accepted("swim_start", "Swim Start", 1, 0, "swim"),
    accepted("swim_finish", "Swim Finish", 2, 900, "swim"),
  ]) as unknown as LeaderboardRow;
  const mapper = readFileSync(
    resolve(process.cwd(), "apps/mobile/src/features/tracking/mappers.ts"),
    "utf8",
  );
  assert.match(mapper, /export function mapLeaderboardRows[\s\S]*row: raw/);
  const mappedRow = { row: raw as unknown as Record<string, unknown> };
  const mappedSplits = mappedRow.row.splits;
  assert.deepEqual(mappedSplits, raw.splits);
});

test("athlete with no accepted split stays out of split standings", () => {
  const pendingRow = row("1001", triathlonSplits);
  assert.equal(
    rankLeaderboardRowsAtSplit([pendingRow], {
      key: "swim_finish",
      label: "Swim Finish",
      order: 2,
    }).length,
    0,
  );
  assert.equal(isAcceptedLeaderboardSplit(triathlonSplits[1]), false);
});

test("one accepted split renders the first split value", () => {
  const athlete = row("1001", [
    accepted("swim_start", "Swim Start", 1, 0, "swim"),
  ]);
  const standings = rankLeaderboardRowsAtSplit([athlete], {
    key: "swim_start",
    label: "Swim Start",
    order: 1,
  });
  assert.equal(standings.length, 1);
  assert.equal(standings[0].elapsedSeconds, 0);
});

test("start zero and the next split remain independent leaderboard values", () => {
  const athlete = row("1001", [
    accepted("swim_start", "Swim Start", 1, 0, "swim"),
    accepted("swim_finish", "Swim Finish", 2, 1024, "swim"),
  ]);
  const start = rankLeaderboardRowsAtSplit([athlete], {
    key: "swim_start",
    label: "Swim Start",
    order: 1,
  });
  const finish = rankLeaderboardRowsAtSplit([athlete], {
    key: "swim_finish",
    label: "Swim Finish",
    order: 2,
  });
  assert.equal(start[0].elapsedSeconds, 0);
  assert.equal(finish[0].elapsedSeconds, 1024);
});

test("multiple and finished accepted splits produce complete progression", () => {
  const splits = triathlonSplits.map((split, index) =>
    accepted(
      String(split.splitKey),
      String(split.displayName),
      Number(split.order),
      index * 600,
      String(split.legType),
    ),
  );
  const athlete = row("1001", splits, { status: "FINISHED" });
  const columns = buildLeaderboardSplitColumns(triathlonSplits, [athlete]);
  const progression = columns
    .filter((column) => !column.transitionFromKey)
    .map((column) => rankLeaderboardRowsAtSplit([athlete], column).length);
  assert.deepEqual(progression, [1, 1, 1, 1, 1, 1, 1]);
});

test("triathlon ordering inserts T1 and T2 only between canonical boundaries", () => {
  const columns = buildLeaderboardSplitColumns(triathlonSplits, []);
  assert.deepEqual(
    columns.map((column) => column.label),
    [
      "Swim Start",
      "Swim Finish",
      "T1",
      "Bike Start",
      "Bike 1",
      "Bike Finish",
      "T2",
      "Run Start",
      "Run Finish",
    ],
  );
});

test("swimathon ordering remains swim-only without synthetic transitions", () => {
  const columns = buildLeaderboardSplitColumns(
    [
      pending("swim_start", "Start", 1, "swim"),
      pending("swim_1km", "1 Km", 2, "swim"),
      pending("swim_finish", "Finish", 3, "swim"),
    ],
    [],
  );
  assert.deepEqual(
    columns.map((column) => column.label),
    ["Start", "1 Km", "Finish"],
  );
  assert.equal(
    columns.some((column) => column.key.startsWith("transition:")),
    false,
  );
});

test("synthetic transition uses accepted boundary difference", () => {
  const athlete = row("1001", [
    accepted("swim_finish", "Swim Finish", 2, 900, "swim"),
    accepted("bike_start", "Bike Start", 3, 1020, "bike"),
  ]);
  const t1 = buildLeaderboardSplitColumns(triathlonSplits, [athlete]).find(
    (column) => column.key === "transition:t1",
  );
  assert.ok(t1);
  assert.equal(
    rankLeaderboardRowsAtSplit([athlete], t1)[0].elapsedSeconds,
    120,
  );
});

test("provider and contest filters cannot mix split standings", () => {
  const correct = row("1001", [
    accepted("swim_finish", "Swim Finish", 2, 900, "swim"),
  ]);
  const otherProvider = row(
    "3001",
    [accepted("swim_finish", "Swim Finish", 2, 700, "swim")],
    {
      participantUuid: "race:1xajvfm0:4fqqihgd:3001",
      providerEventUuid: "1xajVfM0",
      providerContestUuid: "4FgqiHGd",
      contestUuid: "4FgqiHGd",
    },
  );
  const standings = rankLeaderboardRowsAtSplit(
    [otherProvider, correct],
    { key: "swim_finish", label: "Swim Finish", order: 2 },
    { providerEventUuid: "6QTff6CR", contestUuid: "k9jmBOom" },
  );
  assert.deepEqual(
    standings.map((entry) => entry.row.bib),
    ["1001"],
  );
});

test("screen consumes canonical split aggregates and has no tracking or athlete-detail owner", () => {
  const screen = readFileSync(
    resolve(
      process.cwd(),
      "apps/mobile/src/features/tracking/leaderboard/components/LeaderboardScreen.tsx",
    ),
    "utf8",
  );
  assert.match(screen, /liveLeaderboardRows/);
  assert.match(screen, /const splitLeaderboardQuery = useLeaderboard/);
  assert.match(screen, /split: effectiveSplitKey/);
  assert.doesNotMatch(screen, /rankLeaderboardRowsAtSplit/);
  assert.doesNotMatch(screen, /useEventTracking/);
  assert.doesNotMatch(
    screen,
    /useAthleteDetail|getDetail\(|canonicalAthlete\(/,
  );
  assert.doesNotMatch(screen, /repositories\.results/);
});

test("mobile repository requests the provider/contest/split aggregate without client N+1", () => {
  const repository = readFileSync(
    resolve(process.cwd(), "apps/mobile/src/core/repositories/leaderboard.repository.ts"),
    "utf8",
  );
  assert.match(repository, /\/api\/live\/leaderboard/);
  assert.match(repository, /query\.set\("split", filters\.split\)/);
  assert.doesNotMatch(repository, /versionedAthleteSnapshotKey|participantLive:index/);
});
