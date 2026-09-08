import assert from "node:assert/strict";
import test from "node:test";

import type { AthleteModalResponse } from "@/core/types";
import { mapAthleteDetail } from "./mappers";

test("finished result exposes canonical rank cards and per-split ranks", () => {
  const response = {
    success: true,
    eventId: "tImWYZAi99k8ILwxrTSO",
    visibility: "PUBLIC",
    athlete: {
      id: "participant-1001",
      participantUuid: "participant-1001",
      bib: "1001",
      name: "Shashank Agrawal",
      ageGroupName: "16-30",
      status: "finished",
    },
    result: {
      status: "FINISHED",
      officialTime: "01:39:52",
      chipTime: "01:39:52",
      overallRank: 2,
      categoryRank: 1,
      splits: [
        {
          label: "Run Finish",
          time: "01:39:52",
          rank: 2,
          leg: "run",
        },
      ],
    },
  } as AthleteModalResponse;

  const detail = mapAthleteDetail(response);
  assert.deepEqual(detail.result?.ranks, [
    { label: "Overall", value: "2" },
    { label: "Age Group", value: "1" },
  ]);
  assert.equal(detail.result?.splits[0]?.rank, "2");
});

test("uploaded result rows retain official times and fill canonical split details", () => {
  const split = (
    splitKey: string,
    name: string,
    order: number,
    cumulativeDistanceKm: number,
    assignedLeg: string,
    elapsedSeconds: number,
    rank: number,
  ) => ({
    splitKey,
    name,
    order,
    cumulativeDistanceKm,
    assignedLeg,
    legId: assignedLeg.toLowerCase(),
    elapsedSeconds,
    rank,
    accepted: true,
    readAt: new Date(
      Date.parse("2026-09-06T01:30:00.000Z") + elapsedSeconds * 1_000,
    ).toISOString(),
  });
  const canonicalSplits = [
    split("start", "Start", 0, 0, "SWIM", 0, 1),
    split("swim_finish", "Swim Finish", 10, 1.5, "SWIM", 3_890, 30),
    split("bike_start", "Bike Start", 20, 1.5, "T1", 4_415, 28),
    split("bike_finish", "Bike Finish", 30, 41.5, "BIKE", 18_159, 35),
    split("run_start", "Run Start", 40, 41.5, "T2", 18_394, 34),
    split("run_finish", "Run Finish", 50, 51.5, "RUN", 22_000, 31),
  ];
  const response = {
    success: true,
    eventId: "event-2026",
    visibility: "PUBLIC",
    athlete: {
      id: "participant-2003",
      participantUuid: "participant-2003",
      bib: "2003",
      name: "Official Athlete",
      status: "finished",
    },
    participantLive: {
      resolvedRaceState: {
        status: "FINISHED",
        currentSplit: "run_finish",
        totalDistanceKm: 51.5,
        splits: canonicalSplits,
      },
    },
    timingConfiguration: {
      splits: canonicalSplits,
    },
    result: {
      status: "FINISHED",
      chipTime: "06:06:40",
      splits: [
        { label: "Swim", time: "01:04:50", leg: "swim" },
        { label: "T1", time: "00:08:45", leg: "t1" },
        { label: "Bike", time: "03:49:04", leg: "bike" },
        { label: "T2", time: "00:03:55", leg: "t2" },
        { label: "Run", time: "01:00:06", leg: "run" },
      ],
      provisional: false,
    },
  } as unknown as AthleteModalResponse;

  const rows = mapAthleteDetail(response).result?.splits;

  assert.deepEqual(
    rows?.map((row) => row.segmentTime),
    ["01:04:50", "00:08:45", "03:49:04", "00:03:55", "01:00:06"],
  );
  assert.deepEqual(
    rows?.map((row) => row.rank),
    ["30", "28", "35", "34", "31"],
  );
  assert.ok(rows?.every((row) => row.timeOfDay && row.timeOfDay !== "—"));
});
