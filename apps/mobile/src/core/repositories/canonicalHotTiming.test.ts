import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeCanonicalSplitsWithHotTiming,
  resolveAcceptedChipStart,
} from "./canonicalHotTiming";

const configured = [
  {
    splitKey: "swim_start",
    displayName: "Swim Start",
    order: 1,
    status: "CURRENT",
  },
  {
    splitKey: "swim_finish",
    displayName: "Swim Finish",
    order: 2,
    status: "PENDING",
  },
  {
    splitKey: "bike_start",
    displayName: "Bike Start",
    order: 3,
    status: "PENDING",
  },
  {
    splitKey: "bike_checkpoint_4",
    displayName: "BIKE 1",
    order: 4,
    status: "PENDING",
  },
  {
    splitKey: "bike_finish",
    displayName: "Bike Finish",
    order: 5,
    status: "PENDING",
  },
  {
    splitKey: "run_start",
    displayName: "Run Start",
    order: 6,
    status: "PENDING",
  },
  {
    splitKey: "run_checkpoint_7",
    displayName: "RUN 1",
    order: 7,
    status: "PENDING",
  },
  {
    splitKey: "run_finish",
    displayName: "Run Finish",
    order: 8,
    status: "PENDING",
  },
];

test("hot CHIP start updates its configured row without dropping pending splits", () => {
  const rows = mergeCanonicalSplitsWithHotTiming({
    configuredSplits: configured,
    hotSplits: [
      {
        splitKey: "swim_start",
        accepted: true,
        readAt: "2026-08-31T13:13:03.000Z",
        chipTime: 0,
        gunTime: 3,
      },
    ],
    timingMode: "CHIP",
  });

  assert.equal(rows.length, 8);
  assert.deepEqual(
    rows.map((row) => row.splitKey),
    configured.map((row) => row.splitKey),
  );
  assert.equal(rows[0].status, "COMPLETED");
  assert.equal(rows[0].elapsedSeconds, 0);
  assert.equal(rows[0].timeOfDay, "2026-08-31T13:13:03.000Z");
  assert.equal(rows[1].status, "PENDING");
  assert.equal(rows[1].readAt, undefined);
});

test("CHIP and GUN modes select the correct accepted timing basis", () => {
  const hotSplits = [
    {
      splitKey: "swim_finish",
      accepted: true,
      chipTime: 1024,
      gunTime: 1027,
    },
  ];
  const chip = mergeCanonicalSplitsWithHotTiming({
    configuredSplits: configured,
    hotSplits,
    timingMode: "CHIP",
  });
  const gun = mergeCanonicalSplitsWithHotTiming({
    configuredSplits: configured,
    hotSplits,
    timingMode: "GUN",
  });
  assert.equal(chip[1].elapsedSeconds, 1024);
  assert.equal(gun[1].elapsedSeconds, 1027);
});

test("timestamped compact Worker COMPLETED split remains accepted", () => {
  const rows = mergeCanonicalSplitsWithHotTiming({
    configuredSplits: configured,
    hotSplits: [
      {
        splitKey: "swim_start",
        status: "COMPLETED",
        readAt: "2026-09-04T18:20:11.000Z",
        elapsedSeconds: 0,
      },
    ],
    timingMode: "CHIP",
  });

  assert.equal(rows[0].accepted, true);
  assert.equal(rows[0].isAccepted, true);
  assert.equal(rows[0].status, "COMPLETED");
  assert.equal(rows[0].readAt, "2026-09-04T18:20:11.000Z");
});

test("configured-only COMPLETED row without timing evidence is not accepted", () => {
  const rows = mergeCanonicalSplitsWithHotTiming({
    configuredSplits: configured,
    hotSplits: [{ splitKey: "swim_start", status: "COMPLETED" }],
    timingMode: "CHIP",
  });

  assert.equal(rows[0].accepted, false);
  assert.equal(rows[0].isAccepted, false);
});

test("accepted start resolution is athlete-local and never borrows another row", () => {
  assert.equal(
    resolveAcceptedChipStart({
      hotLive: {
        participantUuid: "race:4tegxjmx:5jum5wti:1001",
        chipStartTimestamp: "2026-08-31T13:13:03.000Z",
      },
    }),
    "2026-08-31T13:13:03.000Z",
  );
  assert.equal(
    resolveAcceptedChipStart({
      hotLive: {
        participantUuid: "race:4tegxjmx:5jum5wti:1027",
      },
    }),
    undefined,
  );
});
