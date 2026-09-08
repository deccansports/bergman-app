import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { courseStageLabels, resolveCourseKindFromSections } =
  require("./courseKind.ts") as typeof import("./courseKind");

test("canonical Swim, Bike, and Run legs identify a triathlon with generic category names", () => {
  const kind = resolveCourseKindFromSections(
    [
      { type: "leg", legType: "swim", id: "swim", title: "Swim" },
      { type: "transition", id: "t1", title: "T1" },
      { type: "leg", legType: "bike", id: "bike", title: "Bike" },
      { type: "transition", id: "t2", title: "T2" },
      { type: "leg", legType: "run", id: "run", title: "Run" },
    ],
    "Test 1",
    "Test 1",
  );

  assert.equal(kind, "triathlon");
  assert.deepEqual(courseStageLabels(kind), [
    "SWIM",
    "T1",
    "BIKE",
    "T2",
    "RUN",
    "FINISH",
  ]);
});

test("display metadata remains the fallback when canonical sections are absent", () => {
  assert.equal(resolveCourseKindFromSections(undefined, "10K Running"), "run");
});
