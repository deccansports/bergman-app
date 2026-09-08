import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types test runner requires the explicit .ts extension.
import { resolveStartTimingPresentation } from "./startTimingPresentation.ts";
import {
  resolveLiveElapsedSeconds,
  resolveLiveTimingAnchorMs,
  // @ts-expect-error Node's strip-types test runner requires the explicit .ts extension.
} from "./liveElapsed.ts";

test("CHIP athlete waits for accepted START without DNS, clocks, cutoff, or raw ISO", () => {
  const presentation = resolveStartTimingPresentation({
    officialTimingMode: "CHIP",
    status: "WAITING_CHIP_START",
    gunStartAt: "2026-08-10T13:30:00+05:30",
    chipStartAt: null,
    officialStartAt: null,
    hasAcceptedStart: false,
    eventTimezone: "Asia/Kolkata",
  });

  assert.equal(presentation.statusLabel, "WAITING TO START");
  assert.equal(presentation.waitingForChipStart, true);
  assert.match(presentation.gunStartLabel ?? "", /^1:30:00\s*pm$/i);
  assert.equal(presentation.chipStartAt, undefined);
  assert.equal(presentation.officialStartAt, undefined);
  assert.equal(presentation.officialStartLabel, undefined);
  assert.equal(presentation.showRaceClock, false);
  assert.equal(presentation.showCutoffClock, false);
  assert.doesNotMatch(JSON.stringify(presentation), /2026-08-10T13:30:00/);
  assert.notEqual(presentation.statusLabel, "DNS");
});

test("accepted CHIP START becomes the official start and activates net timing", () => {
  const chipStartAt = "2026-08-10T13:37:24+05:30";
  const presentation = resolveStartTimingPresentation({
    officialTimingMode: "CHIP",
    status: "ON_COURSE",
    gunStartAt: "2026-08-10T13:30:00+05:30",
    chipStartAt,
    // A stale gun-derived value must not override the accepted chip start.
    officialStartAt: "2026-08-10T13:30:00+05:30",
    hasAcceptedStart: true,
    eventTimezone: "Asia/Kolkata",
  });

  assert.equal(presentation.waitingForChipStart, false);
  assert.equal(presentation.officialStartAt, Date.parse(chipStartAt));
  assert.equal(presentation.officialStartAt, presentation.chipStartAt);
  assert.match(presentation.chipStartLabel ?? "", /^1:37:24\s*pm$/i);
  assert.equal(presentation.showRaceClock, true);
  assert.equal(presentation.showCutoffClock, true);
});

test("CHIP timing never uses the contest gun time as an athlete start", () => {
  const presentation = resolveStartTimingPresentation({
    officialTimingMode: "CHIP",
    status: "ON_COURSE",
    gunStartAt: "2026-08-10T13:30:00+05:30",
    chipStartAt: null,
    officialStartAt: "2026-08-10T13:30:00+05:30",
    // A partially synced provider row can mark the athlete started before the
    // accepted START timestamp is available. It must not start a clock.
    hasAcceptedStart: true,
    eventTimezone: "Asia/Kolkata",
  });

  assert.equal(presentation.chipStartAt, undefined);
  assert.equal(presentation.officialStartAt, undefined);
  assert.equal(presentation.showRaceClock, false);
});

test("started GUN timing runs from gunStartAt when officialStartAt is absent", () => {
  const gunStartAt = "2026-09-05T03:00:00.000Z";
  const presentation = resolveStartTimingPresentation({
    officialTimingMode: "GUN",
    status: "ON_COURSE",
    gunStartAt,
    officialStartAt: null,
    hasAcceptedStart: true,
    eventTimezone: "Asia/Kolkata",
  });

  assert.equal(presentation.showRaceClock, true);
  assert.equal(presentation.gunStartAt, Date.parse(gunStartAt));
  assert.equal(
    resolveLiveTimingAnchorMs({ startTiming: presentation }),
    Date.parse(gunStartAt),
  );
});

test("live CHIP and GUN clocks use only their mode-specific anchors", () => {
  const chipStart = Date.parse("2026-08-30T17:10:22+05:30");
  const gunStart = Date.parse("2026-08-30T17:10:00+05:30");
  const chipTiming = {
    officialTimingMode: "CHIP" as const,
    showRaceClock: true,
    chipStartAt: chipStart,
  };
  const gunTiming = {
    officialTimingMode: "GUN" as const,
    showRaceClock: true,
    gunStartAt: gunStart,
  };

  assert.equal(
    resolveLiveTimingAnchorMs({ startTiming: chipTiming }),
    chipStart,
  );
  for (const [nowText, expected] of [
    ["2026-08-30T17:23:56+05:30", 13 * 60 + 34],
    ["2026-08-30T17:41:22+05:30", 31 * 60],
    ["2026-08-30T18:14:24+05:30", 64 * 60 + 2],
  ] as const) {
    assert.equal(
      resolveLiveElapsedSeconds(
        { startTiming: chipTiming, isLive: true },
        Date.parse(nowText),
      ),
      expected,
    );
  }
  assert.equal(resolveLiveTimingAnchorMs({ startTiming: gunTiming }), gunStart);
  assert.equal(
    resolveLiveElapsedSeconds(
      { startTiming: gunTiming, isLive: true },
      Date.parse("2026-08-30T17:23:56+05:30"),
    ),
    836,
  );
});

test("gun and chip clocks remain independent at 3s, 1m, and 10m offsets", () => {
  const gunStart = Date.parse("2026-09-03T07:45:00.000Z");
  const now = Date.parse("2026-09-03T08:45:00.000Z");
  for (const offsetSeconds of [3, 60, 600]) {
    const chipStart = gunStart + offsetSeconds * 1_000;
    assert.equal(
      resolveLiveElapsedSeconds(
        {
          isLive: true,
          startTiming: {
            officialTimingMode: "CHIP",
            showRaceClock: true,
            chipStartAt: chipStart,
            serverTimeOffsetMs: 0,
          },
        },
        now,
      ),
      3_600 - offsetSeconds,
    );
    assert.equal(
      resolveLiveElapsedSeconds(
        {
          isLive: true,
          startTiming: {
            officialTimingMode: "GUN",
            showRaceClock: true,
            gunStartAt: gunStart,
            serverTimeOffsetMs: 0,
          },
        },
        now,
      ),
      3_600,
    );
  }
});

test("device clock skew is corrected from canonical serverNow", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-09-03T10:05:00.000Z");
  try {
    const presentation = resolveStartTimingPresentation({
      officialTimingMode: "CHIP",
      status: "ON_COURSE",
      chipStartAt: "2026-09-03T09:00:00.000Z",
      officialStartAt: "2026-09-03T09:00:00.000Z",
      serverNow: "2026-09-03T10:00:00.000Z",
      hasAcceptedStart: true,
    });
    assert.equal(presentation.serverTimeOffsetMs, -300_000);
    assert.equal(
      resolveLiveElapsedSeconds(
        { isLive: true, startTiming: presentation },
        Date.parse("2026-09-03T10:05:00.000Z"),
      ),
      3_600,
    );
  } finally {
    Date.now = originalNow;
  }
});
