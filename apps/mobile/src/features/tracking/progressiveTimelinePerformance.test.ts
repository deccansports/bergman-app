import assert from "node:assert/strict";
import test from "node:test";

import {
  getVisibleLiveSplits,
  projectProgressiveTimeline,
  type TimelineSplit,
} from "./mappers";

function configuredRow(index: number): TimelineSplit {
  return {
    key: `split-${index}`,
    segment: index < 3 ? "SWIM" : index < 20 ? "BIKE" : "RUN",
    name: index === 0 ? "START" : `Split ${index}`,
    splitLabel: index === 0 ? "START" : `SPLIT ${index}`,
    timeLabel: "—",
    timeOfDayLabel: "—",
    cutoffLabel: index === 27 ? "Overall cutoff • 12:00:00" : undefined,
    state: "upcoming",
  };
}

function accept(row: TimelineSplit, seconds: number): TimelineSplit {
  return {
    ...row,
    timeLabel: `00:00:${String(seconds).padStart(2, "0")}`,
    timeOfDayLabel: `06:45:${String(seconds).padStart(2, "0")}`,
    elapsedTimeLabel: `00:00:${String(seconds).padStart(2, "0")}`,
    state: "completed",
  };
}

test("28-split NOT_STARTED athlete instantiates only the Start row", () => {
  const configured = Array.from({ length: 28 }, (_, index) =>
    configuredRow(index),
  );
  const visible = getVisibleLiveSplits(
    configured,
    [],
    "NOT_STARTED",
    "SWIM",
    "START",
  );
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.key, "split-0");
});

test("mid-race visibility scales with accepted history plus one current row", () => {
  const configured = Array.from({ length: 28 }, (_, index) =>
    configuredRow(index),
  );
  const accepted = configured.slice(0, 5).map((row, index) =>
    accept(row, index),
  );
  const canonical = [...accepted, ...configured.slice(5)];
  const visible = getVisibleLiveSplits(
    canonical,
    accepted,
    "ON_COURSE",
    "BIKE",
    "Split 5",
  );
  assert.equal(visible.length, 6);
  assert.deepEqual(
    visible.map((row) => row.key),
    configured.slice(0, 6).map((row) => row.key),
  );
});

test("accepted rows retain object identity when one new checkpoint is appended", () => {
  const configured = Array.from({ length: 28 }, (_, index) =>
    configuredRow(index),
  );
  const fiveAccepted = configured.slice(0, 5).map((row, index) =>
    accept(row, index),
  );
  const first = projectProgressiveTimeline({
    timeline: [...fiveAccepted, configured[5]],
    terminal: false,
    participantCacheKey: "event:provider:participant:version-1",
    athleteStatus: "ON_COURSE",
  });
  const sixAccepted = [...fiveAccepted, accept(configured[5], 5)];
  const second = projectProgressiveTimeline({
    timeline: [...sixAccepted, configured[6]],
    terminal: false,
    participantCacheKey: "event:provider:participant:version-1",
    athleteStatus: "ON_COURSE",
  });

  assert.equal(first.length, 6);
  assert.equal(second.length, 7);
  for (let index = 0; index < fiveAccepted.length; index += 1) {
    assert.strictEqual(second[index], first[index]);
  }
});

test("finished view contains accepted rows only and preserves cutoff labels", () => {
  const configured = Array.from({ length: 28 }, (_, index) =>
    configuredRow(index),
  );
  const accepted = configured.map((row, index) => accept(row, index));
  const finished = projectProgressiveTimeline({
    timeline: accepted,
    terminal: true,
    participantCacheKey: "event:provider:finisher:version-1",
    athleteStatus: "FINISHED",
  });
  const heartbeat = projectProgressiveTimeline({
    timeline: accepted.map((row) => ({ ...row })),
    terminal: true,
    participantCacheKey: "event:provider:finisher:version-1",
    athleteStatus: "FINISHED",
  });

  assert.equal(finished.length, 28);
  assert.ok(finished.every((row) => row.expected === false));
  assert.equal(finished.at(-1)?.cutoffLabel, "Overall cutoff • 12:00:00");
  assert.strictEqual(heartbeat[10], finished[10]);
});
