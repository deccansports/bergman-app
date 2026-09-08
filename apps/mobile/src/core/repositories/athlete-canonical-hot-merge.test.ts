import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCanonicalAthleteRefresh } from "./athlete.repository";

const configuredSplits = [
  {
    splitKey: "swim_start",
    displayName: "Swim Start",
    legType: "swim",
    order: 1,
    status: "CURRENT",
  },
  {
    splitKey: "swim_finish",
    displayName: "Swim Finish",
    legType: "swim",
    order: 2,
    status: "PENDING",
  },
  {
    splitKey: "bike_start",
    displayName: "Bike Start",
    legType: "bike",
    order: 3,
    status: "PENDING",
  },
  {
    splitKey: "bike_checkpoint_4",
    displayName: "Bike 1",
    legType: "bike",
    order: 4,
    status: "PENDING",
  },
  {
    splitKey: "bike_finish",
    displayName: "Bike Finish",
    legType: "bike",
    order: 5,
    status: "PENDING",
  },
  {
    splitKey: "run_start",
    displayName: "Run Start",
    legType: "run",
    order: 6,
    status: "PENDING",
  },
  {
    splitKey: "run_checkpoint_7",
    displayName: "Run 1",
    legType: "run",
    order: 7,
    status: "PENDING",
  },
  {
    splitKey: "run_finish",
    displayName: "Run Finish",
    legType: "run",
    order: 8,
    status: "PENDING",
  },
];

function response(participantUuid: string, participantLive: unknown) {
  return {
    success: true,
    eventId: "tImWYZAi99k8ILwxrTSO",
    activeVersion: "build-1",
    data: {
      buildVersion: "build-1",
      contestUuid: "5JUm5wtI",
      identity: {
        participantUuid,
        providerParticipantUuid: `provider-${participantUuid}`,
        bib: participantUuid.endsWith("1001") ? "1001" : "1027",
        displayName: participantUuid.endsWith("1001")
          ? "Athlete 1001"
          : "Athlete 1027",
        trackingVisibility: "PUBLIC",
      },
      bergmanIdentity: {},
      raceState: {
        status: "not_started",
        resolved: {
          status: "WAITING_CHIP_START",
          timingMode: "CHIP",
          hasStarted: false,
          splits: configuredSplits,
          currentSplit: configuredSplits[0],
          nextExpectedSplit: configuredSplits[0],
        },
      },
      startTiming: {
        startTimeSource: "CHIP",
        officialStartTime: "2026-08-31T13:13:00.000Z",
      },
      splits: configuredSplits,
      sections: [],
      participantLive,
    },
  };
}

test("BIB 1001 Start, Swim Finish, and Bike Start override stale base and preserve the eight-split flow", () => {
  const participantUuid = "race:4tegxjmx:5jum5wti:1001";
  const result = normalizeCanonicalAthleteRefresh(
    "tImWYZAi99k8ILwxrTSO",
    response(participantUuid, {
      participantUuid,
      status: "On Course",
      currentLeg: "BIKE",
      currentSplit: "BIKE START",
      chipStartTimestamp: "2026-08-31T13:13:03.000Z",
      timingVersion: 1,
      resolvedRaceState: {
        status: "ON_COURSE",
        timingMode: "CHIP",
        hasAcceptedStart: true,
        acceptedStartAt: "2026-08-31T13:13:03.000Z",
        officialElapsedMs: 1493000,
        currentLeg: "BIKE",
        lastCompletedSplit: {
          splitKey: "bike_start",
          name: "Bike Start",
          order: 3,
          readAt: "2026-08-31T13:37:56.000Z",
        },
        nextExpectedSplit: {
          splitKey: "bike_checkpoint_4",
          name: "Bike 1",
          order: 4,
        },
      },
      splits: [
        {
          splitKey: "swim_start",
          accepted: true,
          readAt: "2026-08-31T13:13:03.000Z",
          chipTime: 0,
          gunTime: 3,
        },
        {
          splitKey: "swim_finish",
          accepted: true,
          readAt: "2026-08-31T13:30:07.000Z",
          chipTime: 1024,
          gunTime: 1027,
        },
        {
          splitKey: "bike_start",
          accepted: true,
          readAt: "2026-08-31T13:37:56.000Z",
          chipTime: 1493,
          gunTime: 1496,
        },
      ],
    }),
  );

  assert.equal(result?.athlete?.status, "ON_COURSE");
  assert.equal(result?.athlete?.currentLegName, "BIKE");
  assert.equal(result?.athlete?.elapsedTime, "00:24:53");
  assert.equal(result?.participantLive?.currentSplit, "BIKE START");
  assert.equal(result?.participantLive?.startTime, "2026-08-31T13:13:03.000Z");
  assert.equal(result?.participantLive?.splits?.length, 8);
  assert.equal(result?.participantLive?.splits?.[0]?.elapsedSeconds, 0);
  assert.equal(result?.participantLive?.splits?.[0]?.status, "COMPLETED");
  assert.equal(result?.participantLive?.splits?.[1]?.elapsedSeconds, 1024);
  assert.equal(result?.participantLive?.splits?.[1]?.status, "COMPLETED");
  assert.equal(result?.participantLive?.splits?.[2]?.elapsedSeconds, 1493);
  assert.equal(result?.participantLive?.splits?.[2]?.status, "COMPLETED");
  assert.equal(result?.participantLive?.splits?.[3]?.status, "PENDING");
  assert.equal(
    (
      result?.participantLive?.resolvedRaceState?.nextExpectedSplit as
        { splitKey?: string } | undefined
    )?.splitKey,
    "bike_checkpoint_4",
  );
});

test("BIB 1027 without local accepted evidence remains waiting", () => {
  const participantUuid = "race:4tegxjmx:5jum5wti:1027";
  const result = normalizeCanonicalAthleteRefresh(
    "tImWYZAi99k8ILwxrTSO",
    response(participantUuid, {
      participantUuid,
      status: "Not Started",
      currentSplit: "Start",
      timingVersion: 0,
      splits: [],
    }),
  );

  assert.equal(result?.athlete?.status, "Not Started");
  assert.equal(
    result?.participantLive?.resolvedRaceState?.status,
    "WAITING_CHIP_START",
  );
  assert.equal(result?.participantLive?.startTime, undefined);
  assert.equal(result?.participantLive?.splits?.length, 8);
  assert.equal(result?.participantLive?.splits?.[0]?.status, "CURRENT");
});

test("finished hot state rejects zero aggregate time and restores current ranks", () => {
  const participantUuid = "race:4tegxjmx:5jum5wti:1001";
  const elapsedByKey: Record<string, number> = {
    swim_start: 0,
    swim_finish: 959,
    bike_start: 1_386,
    bike_checkpoint_4: 3_613,
    bike_finish: 4_490,
    run_start: 4_561,
    run_checkpoint_7: 5_608,
    run_finish: 5_992,
  };
  const completedSplits = configuredSplits.map((split) => ({
    ...split,
    status: "COMPLETED",
    accepted: true,
    elapsedSeconds: elapsedByKey[split.splitKey],
    chipTime: elapsedByKey[split.splitKey],
    readAt: new Date(
      Date.parse("2026-08-31T17:20:03.000Z") +
        elapsedByKey[split.splitKey] * 1_000,
    ).toISOString(),
  }));
  const raw = response(participantUuid, {
    participantUuid,
    rankingScope: "CONTEST",
    rankingContestUuid: "5JUm5wtI",
    status: "finished",
    overallRanking: { overallRank: 1, genderRank: 1, ageGroupRank: 1 },
    resolvedRaceState: {
      status: "FINISHED",
      officialResultElapsedMs: 0,
      splits: completedSplits,
    },
    splits: completedSplits,
  }) as any;
  raw.data.raceState = {
    status: "finished",
    elapsedSeconds: 0,
    resolved: {
      status: "FINISHED",
      officialResultElapsedMs: 0,
      splits: completedSplits,
    },
  };
  raw.data.calculated = { overallSeconds: 0 };
  raw.data.overallRanking = {
    overallRank: null,
    genderRank: null,
    ageGroupRank: null,
  };
  raw.data.splitRankings = Object.fromEntries(
    completedSplits.map((split, index) => [
      split.splitKey,
      { splitKey: split.splitKey, overallRank: index + 1 },
    ]),
  );
  raw.data.participantLive.splits = completedSplits.map((split) => ({
    ...split,
    ranking: null,
    overallRank: null,
  }));
  const completedSections: Array<[string, string, number]> = [
    ["swim", "leg", 959],
    ["t1", "transition", 427],
    ["bike", "leg", 3_104],
    ["t2", "transition", 71],
    ["run", "leg", 1_431],
  ];
  raw.data.sections = completedSections.map(
    ([key, sectionType, durationSeconds], index) => ({
      key,
      displayName: String(key).toUpperCase(),
      sectionType,
      legType: key,
      order: index + 1,
      durationSeconds,
    }),
  );

  const result = normalizeCanonicalAthleteRefresh("tImWYZAi99k8ILwxrTSO", raw);

  assert.equal(result?.result?.chipTime, "01:39:52");
  assert.equal(result?.result?.officialTime, "01:39:52");
  assert.equal(result?.result?.overallRank, 1);
  assert.equal(result?.result?.genderRank, 1);
  assert.equal(result?.result?.categoryRank, 1);
  assert.deepEqual(
    (result?.result?.splits ?? []).map((split) => split.rank),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );

  delete raw.data.participantLive.rankingScope;
  delete raw.data.participantLive.rankingContestUuid;
  raw.data.participantLive.overallRank = 165;
  raw.data.participantLive.genderRank = 46;
  raw.data.participantLive.ageGroupRank = 44;
  raw.data.overallRanking = {
    overallRank: 7,
    genderRank: 3,
    ageGroupRank: 2,
  };
  const legacyRanks = normalizeCanonicalAthleteRefresh(
    "tImWYZAi99k8ILwxrTSO",
    raw,
  );
  assert.equal(legacyRanks?.result?.overallRank, 7);
  assert.equal(legacyRanks?.result?.genderRank, 3);
  assert.equal(legacyRanks?.result?.categoryRank, 2);
});

test("manual DNQ outranks accepted finish timing in every mobile status field", () => {
  const participantUuid = "race:4tegxjmx:5jum5wti:1001";
  const completedSplits = configuredSplits.map((split, index) => ({
    ...split,
    status: "COMPLETED",
    accepted: true,
    elapsedSeconds: index * 300,
    readAt: new Date(
      Date.parse("2026-08-31T17:20:03.000Z") + index * 300_000,
    ).toISOString(),
  }));
  const raw = response(participantUuid, {
    participantUuid,
    status: "DNQ",
    statusSource: "MANUAL_OVERRIDE",
    overallRank: null,
    genderRank: null,
    ageGroupRank: null,
    resolvedRaceState: {
      status: "DNQ",
      statusSource: "MANUAL_OVERRIDE",
      finalSplitAccepted: true,
      splits: completedSplits,
    },
    splits: completedSplits,
  }) as any;
  raw.data.raceState = {
    status: "finished",
    resolved: {
      status: "FINISHED",
      finalSplitAccepted: true,
      splits: completedSplits,
    },
  };
  raw.data.splits = completedSplits;
  raw.data.overallRanking = {
    overallRank: 1,
    genderRank: 1,
    ageGroupRank: 1,
  };

  const result = normalizeCanonicalAthleteRefresh("tImWYZAi99k8ILwxrTSO", raw);

  assert.equal(result?.athlete?.status, "DNQ");
  assert.equal(result?.athlete?.lifecycleLabel, "DNQ");
  assert.equal(result?.participantLive?.status, "DNQ");
  assert.equal(result?.participantLive?.resolvedRaceState?.status, "DNQ");
  assert.equal(result?.result?.status, "DNQ");
  assert.equal(result?.result?.overallRank, undefined);
  assert.equal(result?.result?.genderRank, undefined);
  assert.equal(result?.result?.categoryRank, undefined);
  assert.equal(result?.result?.splits?.at(-1)?.time, "00:35:00");
});
