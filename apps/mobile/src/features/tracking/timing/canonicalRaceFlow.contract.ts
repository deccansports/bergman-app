import type { AthleteModalResponse } from "@/core/types";
import { buildCanonicalRaceFlow } from "./canonicalRaceFlow";
import { buildAthleteRaceSections } from "./raceSections";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error(`Canonical race-flow contract failed: ${message}`);
}

const split = (
  key: string,
  displayName: string,
  legType: string,
  order: number,
  km: number,
) => ({ key, displayName, legType, order, cumulativeDistanceKm: km });
const accepted = (
  splitKey: string,
  elapsedSeconds: number,
  extra: Record<string, unknown> = {},
) => ({
  splitKey,
  elapsedSeconds,
  status: "VALID",
  readAt: new Date(Date.UTC(2026, 7, 8, 10, 0, elapsedSeconds)).toISOString(),
  ...extra,
});

export function runCanonicalRaceFlowContract(): true {
  const definitions = [
    split("swim-start", "Swim Start", "SWIM", 1, 0),
    split("swim-finish", "Swim Finish", "SWIM", 2, 2),
    split("bike-start", "Bike Start", "BIKE", 3, 2),
    split("bike-20", "Bike 20 Km", "BIKE", 4, 22),
    split("bike-40", "Bike 40 Km", "BIKE", 5, 42),
    split("bike-60", "Bike 60 Km", "BIKE", 6, 62),
    split("bike-finish", "Bike Finish", "BIKE", 7, 82),
    split("run-start", "Run Start", "RUN", 8, 82),
    split("run-5", "Run 5 Km", "RUN", 9, 87),
    split("run-10", "Run 10 Km", "RUN", 10, 92),
    split("run-15", "Run 15 Km", "RUN", 11, 97),
    split("run-finish", "Run Finish", "RUN", 12, 102),
  ];
  const legs = [
    { key: "SWIM", legType: "SWIM", order: 1 },
    { key: "BIKE", legType: "BIKE", order: 3 },
    { key: "RUN", legType: "RUN", order: 5 },
  ];
  const transitions = [
    {
      key: "T1",
      order: 2,
      startSplitKey: "swim-finish",
      finishSplitKey: "bike-start",
    },
    {
      key: "T2",
      order: 4,
      startSplitKey: "bike-finish",
      finishSplitKey: "run-start",
    },
  ];
  const sections = [
    { key: "SWIM", order: 1 },
    { key: "T1", order: 2 },
    { key: "BIKE", order: 3 },
    { key: "T2", order: 4 },
    { key: "RUN", order: 5 },
  ];
  const response = {
    success: true,
    eventId: "event-1",
    activeVersion: "v1",
    courseVersion: "course-1",
    athlete: {
      participantUuid: "p1",
      providerContestUuid: "contest-1",
      status: "LIVE",
      summary: { t1Seconds: 60 },
      splits: [
        accepted("swim-finish", 3600, { sectionSeconds: 3600 }),
        accepted("bike-start", 3660),
        accepted("bike-20", 5400, { checkpointRank: 2 }),
        accepted("bike-finish", 9000),
        accepted("run-start", 9060),
      ],
    },
    contestContext: {
      contest: {
        providerContestUuid: "contest-1",
        splits: definitions,
        legs,
        transitions,
        sections,
      },
    },
  } as unknown as AthleteModalResponse;
  const timing = buildCanonicalRaceFlow(response);
  assert(timing, "valid contest must build");
  assert(
    timing.sections.map((row) => row.shortLabel).join(",") === "SW,T1,BK,T2,RN",
    "section order",
  );
  assert(
    timing.sections.every((section) =>
      section.rows.every((row) => row.name !== "TRANSITION"),
    ),
    "no synthetic transition rows",
  );
  const bike = timing.sections.find((section) => section.shortLabel === "BK");
  assert(
    bike?.rows.map((row) => row.name).join(",") ===
      "Bike Start,Bike 20 Km,Bike 40 Km,Bike 60 Km,Bike Finish",
    "canonical split order",
  );
  assert(
    bike.rows[1].distanceInLegKm === 20 && bike.rows[3].distanceInLegKm === 60,
    "leg-specific Bike KM labels",
  );
  assert(bike.rows[1].rank === "#2", "exact split-key timing join");
  const swim = timing.sections.find((section) => section.shortLabel === "SW");
  assert(
    swim?.rows[1].cumulativeDistanceKm === bike.rows[0].cumulativeDistanceKm,
    "equal-KM boundaries are preserved",
  );
  assert(
    timing.sections.find((section) => section.shortLabel === "T1")
      ?.durationSeconds === 60,
    "T1 accepted boundary duration",
  );
  assert(
    timing.sections.find((section) => section.shortLabel === "T2")
      ?.durationSeconds === 60,
    "T2 boundary fallback",
  );
  assert(
    !timing.sections.some((section) => section.title === "Race Timing"),
    "no extra Race Timing section",
  );

  const cumulativeSummaryRegression = {
    ...response,
    athlete: {
      ...response.athlete,
      status: "FINISHED",
      // These are deliberately cumulative checkpoint values from the legacy
      // summary and must not become individual leg durations.
      summary: {
        swimSeconds: 995,
        t1Seconds: 1484,
        bikeSeconds: 9484,
        t2Seconds: 9693,
        runSeconds: 15693,
        overallSeconds: 15693,
      },
      splits: [
        accepted("swim-start", 151),
        accepted("swim-finish", 995),
        accepted("bike-start", 1484),
        accepted("bike-20", 3484),
        accepted("bike-40", 5484),
        accepted("bike-60", 7484),
        accepted("bike-finish", 9484),
        accepted("run-start", 9693),
        accepted("run-5", 11193),
        accepted("run-10", 12693),
        accepted("run-15", 14193),
        accepted("run-finish", 15693),
      ],
    },
  } as unknown as AthleteModalResponse;
  const regressionFlow = buildCanonicalRaceFlow(cumulativeSummaryRegression);
  assert(
    regressionFlow?.sections.find((section) => section.shortLabel === "SW")
      ?.durationSeconds === 844,
    "Swim is finish minus start",
  );
  assert(
    regressionFlow?.sections.find((section) => section.shortLabel === "T1")
      ?.durationSeconds === 489,
    "T1 is Bike Start minus Swim Finish",
  );
  assert(
    regressionFlow?.sections.find((section) => section.shortLabel === "BK")
      ?.durationSeconds === 8000,
    "Bike is Bike Finish minus Bike Start",
  );
  assert(
    regressionFlow?.sections.find((section) => section.shortLabel === "T2")
      ?.durationSeconds === 209,
    "T2 is Run Start minus Bike Finish",
  );
  assert(
    regressionFlow?.sections.find((section) => section.shortLabel === "RN")
      ?.durationSeconds === 6000,
    "Run is Run Finish minus Run Start",
  );
  assert(
    regressionFlow?.overallTimeSeconds === 15693,
    "Total remains continuous race elapsed",
  );
  const regressionBike = regressionFlow?.sections.find(
    (section) => section.shortLabel === "BK",
  );
  assert(
    regressionBike?.rows[0].metric == null,
    "Bike Start has no speed at zero leg distance/time",
  );
  assert(
    regressionBike?.averageMetric === "36.0 km/h",
    "Bike average uses bike distance divided by Bike Finish minus Bike Start",
  );
  assert(
    regressionBike?.rows[0].splitDurationSeconds === 489,
    "Bike Start split time is the immediately previous accepted checkpoint interval (T1)",
  );
  assert(
    regressionBike?.rows[1].splitDurationSeconds === 2000,
    "Bike 20 split time is not cumulative bike time",
  );
  assert(
    regressionBike?.rows[1].metric === "36.0 km/h",
    "Bike checkpoint speed uses the checkpoint segment only",
  );
  assert(
    regressionBike?.rows[2].splitDurationSeconds === 2000,
    "Bike 40 split time uses Bike 20 as previous accepted checkpoint",
  );
  const regressionSwim = regressionFlow?.sections.find(
    (section) => section.shortLabel === "SW",
  );
  assert(
    regressionSwim?.rows[1].splitDurationSeconds === 844,
    "Swim Finish split time uses Swim Start",
  );
  assert(
    regressionSwim?.rows[1].metric === "0:42 /100m",
    "Swim checkpoint uses min/100m",
  );
  const regressionRun = regressionFlow?.sections.find(
    (section) => section.shortLabel === "RN",
  );
  assert(
    regressionRun?.rows[1].distanceInLegKm === 5,
    "Run checkpoint uses leg-specific distance",
  );
  assert(
    regressionRun?.rows[1].metric === "5:00 /km",
    "Run checkpoint uses min/km",
  );
  assert(
    regressionRun?.rows.at(-1)?.splitDurationSeconds === 1500,
    "Finish retains immediate checkpoint split time",
  );
  assert(
    regressionFlow?.sections.flatMap((section) => section.rows).length ===
      definitions.length,
    "finished athlete preserves every configured checkpoint",
  );

  const notStartedFlow = buildCanonicalRaceFlow({
    ...response,
    athlete: { ...response.athlete, status: "NOT_STARTED", splits: [] },
  } as unknown as AthleteModalResponse);
  assert(
    notStartedFlow?.sections.flatMap((section) => section.rows).length ===
      definitions.length,
    "not-started athlete shows the full configured schema",
  );
  assert(
    notStartedFlow.sections
      .flatMap((section) => section.rows)
      .every(
        (row) => row.status === "missing" && row.splitDurationSeconds == null,
      ),
    "not-started checkpoints await accepted reads",
  );

  const missingCheckpointFlow = buildCanonicalRaceFlow({
    ...cumulativeSummaryRegression,
    athlete: {
      ...cumulativeSummaryRegression.athlete,
      splits: (cumulativeSummaryRegression.athlete.splits ?? []).filter(
        (row) => row.splitKey !== "bike-40",
      ),
    },
  } as unknown as AthleteModalResponse);
  const bikeWithMissingCheckpoint = missingCheckpointFlow?.sections.find(
    (section) => section.shortLabel === "BK",
  );
  assert(
    bikeWithMissingCheckpoint?.status === "completed",
    "accepted Bike Finish completes the leg even if an intermediate read is missing",
  );
  assert(
    bikeWithMissingCheckpoint?.rows.find((row) => row.key === "bike-40")
      ?.status === "missing",
    "missing configured checkpoint remains awaiting",
  );
  assert(
    bikeWithMissingCheckpoint?.rows.find((row) => row.key === "bike-60")
      ?.splitDurationSeconds === 4000,
    "next accepted checkpoint uses immediately previous accepted read",
  );

  const dnfFlow = buildCanonicalRaceFlow({
    ...response,
    athlete: {
      ...response.athlete,
      status: "DNF",
      splits: [accepted("swim-start", 0), accepted("swim-finish", 844)],
    },
  } as unknown as AthleteModalResponse);
  assert(dnfFlow, "DNF flow builds from canonical configuration");
  assert(
    dnfFlow.sections.every((section) => section.status === "dnf"),
    "DNF is explicit across the detailed flow",
  );
  assert(
    dnfFlow.sections.find((section) => section.shortLabel === "SW")?.rows[1]
      .status === "valid",
    "DNF preserves accepted checkpoint reads",
  );

  const missingFinish = {
    ...response,
    athlete: {
      ...response.athlete,
      summary: {},
      splits: [accepted("swim-finish", 100)],
    },
  } as AthleteModalResponse;
  const pendingT1 = buildCanonicalRaceFlow(missingFinish)?.sections.find(
    (section) => section.shortLabel === "T1",
  );
  assert(
    pendingT1?.status === "in_progress" && pendingT1.durationSeconds == null,
    "missing transition finish boundary",
  );

  const mismatch = {
    ...response,
    athlete: { ...response.athlete, providerContestUuid: "other-contest" },
  } as AthleteModalResponse;
  assert(
    buildCanonicalRaceFlow(mismatch) === undefined,
    "contest mismatch rejection",
  );
  const negative = {
    ...response,
    athlete: {
      ...response.athlete,
      summary: {},
      splits: [accepted("swim-finish", 100), accepted("bike-start", 90)],
    },
  } as AthleteModalResponse;
  assert(
    buildCanonicalRaceFlow(negative)?.sections.find(
      (section) => section.shortLabel === "T1",
    )?.durationSeconds == null,
    "negative transition rejection",
  );

  const sparseProviderContext = {
    ...response,
    contestContext: {
      contest: { providerContestUuid: "contest-1" },
      splits: [definitions[4]],
      legs: [{ key: "BIKE", legType: "BIKE", order: 3 }],
      transitions: [],
    },
    timingConfiguration: {
      raceFlowByContest: {
        "contest-1": {
          splits: definitions,
          legs,
          transitions,
          sections,
        },
      },
    },
  } as unknown as AthleteModalResponse;
  const restored = buildCanonicalRaceFlow(sparseProviderContext);
  assert(
    restored?.sections.map((section) => section.shortLabel).join(",") ===
      "SW,T1,BK,T2,RN",
    "saved Race Flow replaces sparse provider context",
  );
  assert(
    restored.sections.reduce(
      (count, section) => count + section.rows.length,
      0,
    ) === definitions.length,
    "all saved split rows render",
  );

  const testOneDefinitions = definitions
    .filter((row) =>
      [
        "swim-start",
        "swim-finish",
        "bike-start",
        "bike-finish",
        "run-start",
        "run-finish",
      ].includes(row.key),
    )
    .map((row) =>
      row.key === "swim-start" ? { ...row, displayName: "Start" } : row,
    );
  const markerHeavyResponse = {
    ...response,
    contestContext: {
      contest: { providerContestUuid: "contest-1" },
      splits: definitions,
      legs,
      transitions,
      sections,
    },
    timingConfiguration: {
      raceFlowByContest: {
        "contest-1": {
          splits: testOneDefinitions,
          legs,
          transitions,
          sections,
        },
      },
    },
  } as unknown as AthleteModalResponse;
  const markerSafeFlow = buildCanonicalRaceFlow(markerHeavyResponse);
  assert(
    markerSafeFlow?.sections
      .flatMap((section) => section.rows)
      .map((row) => row.name)
      .join(",") ===
      "Start,Swim Finish,Bike Start,Bike Finish,Run Start,Run Finish",
    "provider and GPX marker rows never expand the saved Test 1 Race Flow",
  );

  const providerUuidDefinitions = [
    split("swim_start", "4uscdYgh", "SWIM", 1, 0),
    split("swim_finish", "4RSDJfEL", "SWIM", 2, 2),
    split("bike_start", "3BoGq8U9", "BIKE", 3, 2),
    split("bike_finish", "3c3jrd9F", "BIKE", 4, 42),
    split("run_start", "4R4DBz6h", "RUN", 5, 42),
    split("run_finish", "4DBMkLxV", "RUN", 6, 52),
  ].map((row) => ({ ...row, providerSplitId: row.displayName }));
  const uuidResponse = {
    ...response,
    athlete: { ...response.athlete, splits: [] },
    contestContext: {
      contest: {
        providerContestUuid: "contest-1",
        splits: providerUuidDefinitions,
        legs,
        transitions,
        sections,
      },
    },
  } as unknown as AthleteModalResponse;
  const uuidFlow = buildCanonicalRaceFlow(uuidResponse);
  assert(
    uuidFlow?.sections
      .flatMap((section) => section.rows)
      .map((row) => row.name)
      .join(",") ===
      "Start,Swim Finish,Bike Start,Bike Finish,Run Start,Run Finish",
    "provider UUIDs are never spectator labels",
  );
  assert(
    uuidFlow.sections
      .flatMap((section) => section.rows)
      .map((row) => row.cumulativeDistanceKm)
      .join(",") === "0,2,2,42,42,52",
    "Bergman cumulative distances",
  );

  const corruptedProviderSplits = [
    {
      splitKey: "run_start",
      providerSplitId: "4uscdYgh",
      displayName: "Start",
      legType: "run",
      order: 1,
      cumulativeDistanceKm: 0,
    },
    {
      splitKey: "run_start",
      providerSplitId: "3BoGq8U9",
      displayName: "Bike Start",
      legType: "run",
      order: 2,
      cumulativeDistanceKm: 0,
    },
    {
      splitKey: "run_start",
      providerSplitId: "4R4DBz6h",
      displayName: "Run Start",
      legType: "run",
      order: 3,
      cumulativeDistanceKm: 0,
    },
    {
      splitKey: "run_finish",
      providerSplitId: "4RSDJfEL",
      displayName: "Swim Finish",
      legType: "run",
      order: 4,
      cumulativeDistanceKm: 52,
    },
    {
      splitKey: "run_finish",
      providerSplitId: "3c3jrd9F",
      displayName: "Bike Finish",
      legType: "run",
      order: 5,
      cumulativeDistanceKm: 52,
    },
    {
      splitKey: "run_finish",
      providerSplitId: "4DBMkLxV",
      displayName: "Run Finish",
      legType: "run",
      order: 6,
      cumulativeDistanceKm: 52,
    },
  ];
  const repairedResponse = {
    ...response,
    athlete: { ...response.athlete, splits: corruptedProviderSplits },
    ticketDefinition: {
      ticketCategory: "Triathlon",
      courseMaps: { swimDistance: 2, bikeDistance: 40, runDistance: 10 },
    },
    contestContext: {
      contest: {
        providerContestUuid: "contest-1",
        splits: corruptedProviderSplits,
      },
      splits: corruptedProviderSplits,
      legs: [{ key: "run", legType: "RUN", order: 1 }],
      transitions: [],
      sections: [{ key: "RUN", type: "RUN", order: 1 }],
    },
  } as unknown as AthleteModalResponse;
  const unrepairedFlow = buildCanonicalRaceFlow(repairedResponse);
  assert(
    unrepairedFlow?.sections.map((section) => section.shortLabel).join(",") ===
      "RN",
    "ticket distances never synthesize a global six-boundary triathlon schema",
  );

  const otherContest = {
    ...response,
    athlete: {
      ...response.athlete,
      providerContestUuid: "contest-2",
      splits: [],
    },
    contestContext: {
      contest: {
        providerContestUuid: "contest-2",
        splits: [
          split("swim-start-2", "Swim Start", "SWIM", 1, 0),
          split("swim-finish-2", "Swim Finish", "SWIM", 2, 1),
        ],
        legs: [{ key: "SWIM", legType: "SWIM", order: 1 }],
        sections: [{ key: "SWIM", order: 1 }],
      },
    },
  } as unknown as AthleteModalResponse;
  const isolated = buildCanonicalRaceFlow(otherContest);
  assert(
    isolated?.sections.flatMap((section) => section.rows).length === 2,
    "provider/contest schema remains isolated",
  );
  assert(
    !isolated.sections
      .flatMap((section) => section.rows)
      .some((row) => row.name.includes("Bike")),
    "another contest cannot inherit triathlon checkpoints",
  );

  const bib3001SwimFlow = buildCanonicalRaceFlow({
    eventId: "4cEm8JPYbpupoFRMDLc1",
    athlete: {
      id: "race:6ueookhs:2qwc3rdn:3001",
      participantUuid: "race:6ueookhs:2qwc3rdn:3001",
      providerContestUuid: "2qwc3RDn",
      bib: "3001",
      name: "Karthick Shanmuga Sundaram",
      status: "waiting_chip_start",
      splits: [],
    },
    contestContext: {
      contest: {
        providerContestUuid: "2qwc3RDn",
        contestUuid: "2qwc3RDn",
      },
      splits: [
        {
          splitKey: "swim_start",
          displayName: "Start",
          legType: "swim",
          order: 1,
          status: "missing",
        },
        {
          splitKey: "swim_finish",
          displayName: "Swim Finish",
          legType: "swim",
          order: 2,
          status: "missing",
        },
      ],
      legs: [
        {
          key: "swim",
          displayName: "Swim",
          sectionType: "leg",
          legType: "swim",
          order: 1,
          startSplitKey: "swim_start",
          finishSplitKey: "swim_finish",
        },
      ],
      transitions: [],
      sections: [
        {
          key: "swim",
          displayName: "Swim",
          sectionType: "leg",
          legType: "swim",
          order: 1,
        },
      ],
    },
  } as unknown as AthleteModalResponse);
  assert(
    bib3001SwimFlow?.sections.length === 1 &&
      bib3001SwimFlow.sections[0]?.shortLabel === "SW" &&
      bib3001SwimFlow.sections[0]?.title === "Swim",
    "BIB 3001 single-sport flow renders Swim instead of generic TP / Race Timing",
  );
  assert(
    bib3001SwimFlow.sections[0]?.rows
      .map((row) => row.name)
      .join(",") === "Start,Swim Finish",
    "BIB 3001 flow preserves both configured swim checkpoints",
  );

  const fallbackTiming = buildAthleteRaceSections({
    legs: [
      {
        id: "swim",
        name: "Swim",
        type: "swim",
        order: 1,
        distanceKm: 2,
        startSplitKey: "swim-start",
        finishSplitKey: "swim-finish",
      },
      {
        id: "bike",
        name: "Bike",
        type: "bike",
        order: 2,
        distanceKm: 40,
        startSplitKey: "bike-start",
        finishSplitKey: "bike-finish",
      },
    ],
    splits: [
      {
        key: "swim-start",
        name: "Swim Start",
        legId: "swim",
        distanceInLegKm: 0,
        order: 1,
      },
      {
        key: "swim-finish",
        name: "Swim Finish",
        legId: "swim",
        distanceInLegKm: 2,
        order: 2,
      },
      {
        key: "bike-start",
        name: "Bike Start",
        legId: "bike",
        distanceInLegKm: 0,
        order: 3,
      },
      {
        key: "bike-20",
        name: "Bike 20 Km",
        legId: "bike",
        distanceInLegKm: 20,
        order: 4,
      },
      {
        key: "bike-finish",
        name: "Bike Finish",
        legId: "bike",
        distanceInLegKm: 40,
        order: 5,
      },
    ],
    reads: [
      accepted("swim-start", 0),
      accepted("swim-finish", 800),
      accepted("bike-start", 860),
      { ...accepted("bike-20", 1460), status: "PENDING" },
      accepted("bike-finish", 2060),
    ],
    athleteStatus: "FINISHED",
  });
  const fallbackBike = fallbackTiming.sections.find(
    (section) => section.legType === "bike",
  );
  assert(
    fallbackBike?.rows.map((row) => row.name).join(",") ===
      "Bike Start,Bike 20 Km,Bike Finish",
    "fallback canonical timing config also preserves every sport checkpoint",
  );
  assert(
    fallbackBike.rows[1].status !== "valid" &&
      fallbackBike.rows[1].splitDurationSeconds == null,
    "unaccepted provider timing never becomes an athlete split",
  );
  assert(
    fallbackBike.rows[2].splitDurationSeconds === 1200,
    "fallback flow skips unaccepted reads when finding the previous accepted checkpoint",
  );
  return true;
}
