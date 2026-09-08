import assert from "node:assert/strict";
import test from "node:test";

import type { TimelineSplit } from "../../../mappers";
import { selectProgressiveSplitTableRows } from "./progressiveSplitTable";

function row(
  key: string,
  label: string,
  state: TimelineSplit["state"] = "upcoming",
  extra: Partial<TimelineSplit> = {},
): TimelineSplit {
  return {
    key,
    name: label,
    splitLabel: label,
    segment: label.includes("BIKE")
      ? "BIKE"
      : label.includes("RUN")
        ? "RUN"
        : "SWIM",
    state,
    timeLabel: state === "completed" ? "00:10:00" : "—",
    timeOfDayLabel: state === "completed" ? "09:10:00" : "—",
    ...extra,
  };
}

test("500 m and 4 km pre-start tables render Start only", () => {
  const fiveHundred = [row("start", "START"), row("finish", "FINISH")];
  const fourKm = [
    row("start", "START"),
    row("lap-1", "LAP 1"),
    row("lap-2", "LAP 2"),
    row("lap-3", "LAP 3"),
    row("finish", "FINISH"),
  ];

  assert.deepEqual(
    selectProgressiveSplitTableRows(fiveHundred, { notStarted: true }).map(
      (item) => item.key,
    ),
    ["start"],
  );
  assert.deepEqual(
    selectProgressiveSplitTableRows(fourKm, { notStarted: true }).map(
      (item) => item.key,
    ),
    ["start"],
  );

  const mappedStart = row("start", "START", "current", { expected: true });
  const renderedStart = selectProgressiveSplitTableRows([mappedStart], {
    notStarted: true,
  })[0];
  assert.equal(renderedStart?.state, "upcoming");
  assert.equal(renderedStart?.expected, false);
});

test("active tables retain accepted history and exactly one current checkpoint", () => {
  const start = row("start", "START", "completed");
  const lapOne = row("lap-1", "LAP 1", "current", { expected: true });
  const finish = row("finish", "FINISH");
  assert.deepEqual(
    selectProgressiveSplitTableRows([start, lapOne, finish]).map(
      (item) => item.key,
    ),
    ["start", "lap-1"],
  );

  const acceptedLap = row("lap-1", "LAP 1", "completed");
  const currentFinish = row("finish", "FINISH", "current", { expected: true });
  assert.deepEqual(
    selectProgressiveSplitTableRows([start, acceptedLap, currentFinish]).map(
      (item) => item.key,
    ),
    ["start", "lap-1", "finish"],
  );
});

test("a 28-split race renders 1 row before start and 6 after five accepted reads", () => {
  const configured = Array.from({ length: 28 }, (_, index) =>
    row(
      `split-${index}`,
      index === 0 ? "START" : index === 27 ? "FINISH" : `SPLIT ${index}`,
    ),
  );
  assert.equal(
    selectProgressiveSplitTableRows(configured, { notStarted: true }).length,
    1,
  );

  const progressive = configured.map((item, index) =>
    index < 5
      ? row(item.key, item.name, "completed")
      : index === 5
        ? row(item.key, item.name, "current", { expected: true })
        : item,
  );
  const visible = selectProgressiveSplitTableRows(progressive);
  assert.equal(visible.length, 6);
  assert.equal(
    visible.some((item) => item.key === "split-27"),
    false,
  );
});

test("transitions and finish remain hidden until accepted or current", () => {
  const progressive = [
    row("start", "START", "completed"),
    row("swim-finish", "SWIM FINISH", "completed"),
    row("t1", "T1"),
    row("bike-start", "BIKE START"),
    row("finish", "FINISH"),
  ];
  assert.deepEqual(
    selectProgressiveSplitTableRows(progressive).map((item) => item.key),
    ["start", "swim-finish"],
  );

  progressive[2] = row("t1", "T1", "current", { expected: true });
  assert.deepEqual(
    selectProgressiveSplitTableRows(progressive).map((item) => item.key),
    ["start", "swim-finish", "t1"],
  );
});

test("future Finish is absent until it becomes the single next checkpoint", () => {
  const start = row("start", "START", "completed");
  const lap = row("lap-1", "LAP 1", "current", { expected: true });
  const finish = row("finish", "FINISH");
  assert.equal(
    selectProgressiveSplitTableRows([start, lap, finish]).some(
      (item) => item.key === "finish",
    ),
    false,
  );

  const currentFinish = row("finish", "FINISH", "current", {
    expected: true,
  });
  assert.equal(
    selectProgressiveSplitTableRows([start, currentFinish]).at(-1)?.key,
    "finish",
  );
});

test("Swimathon and triathlon progressive inputs retain their own ordered rows", () => {
  const swimathon = [
    row("start", "START", "completed", { segment: "SWIM" }),
    row("lap", "LAP 1", "current", { segment: "SWIM", expected: true }),
    row("finish", "SWIM FINISH", "upcoming", { segment: "SWIM" }),
  ];
  const triathlon = [
    row("start", "START", "completed", { segment: "SWIM" }),
    row("swim-finish", "SWIM FINISH", "completed", { segment: "SWIM" }),
    row("t1", "T1", "current", { segment: "T1", expected: true }),
    row("bike-start", "BIKE START", "upcoming", { segment: "BIKE" }),
  ];
  assert.deepEqual(
    selectProgressiveSplitTableRows(swimathon).map((item) => item.key),
    ["start", "lap"],
  );
  assert.deepEqual(
    selectProgressiveSplitTableRows(triathlon).map((item) => item.key),
    ["start", "swim-finish", "t1"],
  );
});

test("finished tables contain accepted history only and preserve cutoff metadata", () => {
  const finish = row("finish", "FINISH", "completed", {
    cutoffLabel: "Overall cutoff • 01:15:00",
  });
  const future = row("future", "FUTURE");
  const input = [row("start", "START", "completed"), finish, future];
  const visible = selectProgressiveSplitTableRows(input, { finished: true });
  assert.deepEqual(
    visible.map((item) => item.key),
    ["start", "finish"],
  );
  assert.equal(visible[1]?.cutoffLabel, "Overall cutoff • 01:15:00");
});

test("safe heartbeat input preserves the array and row identities", () => {
  const start = row("start", "START", "completed");
  const current = row("lap-1", "LAP 1", "current", { expected: true });
  const input = [start, current];
  const visible = selectProgressiveSplitTableRows(input);
  assert.strictEqual(visible, input);
  assert.strictEqual(visible[0], start);
  assert.strictEqual(visible[1], current);
});

test("missing or malformed progressive input fails closed", () => {
  assert.deepEqual(selectProgressiveSplitTableRows(undefined), []);
  assert.deepEqual(selectProgressiveSplitTableRows(null), []);
  assert.deepEqual(
    selectProgressiveSplitTableRows([row("lap", "LAP 1")], {
      notStarted: true,
    }),
    [],
  );
  assert.deepEqual(
    selectProgressiveSplitTableRows([
      row("start", "START"),
      row("finish", "FINISH"),
    ]),
    [],
  );
});
