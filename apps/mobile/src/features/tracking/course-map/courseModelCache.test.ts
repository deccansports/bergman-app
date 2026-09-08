import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner needs the explicit extension.
const courseModelCache = await import("./courseModelCache.ts");
const clearCourseModelCacheForTests =
  courseModelCache.clearCourseModelCacheForTests;
const getOrBuildCourseModel = courseModelCache.getOrBuildCourseModel;

test("the same immutable course identity builds once across consumers", () => {
  clearCourseModelCacheForTests();
  let builds = 0;
  const first = getOrBuildCourseModel("event:provider:contest:v1:gpx", () => ({
    build: ++builds,
  }));
  const second = getOrBuildCourseModel("event:provider:contest:v1:gpx", () => ({
    build: ++builds,
  }));
  assert.equal(builds, 1);
  assert.equal(first, second);
});

test("a changed course identity builds a separate model", () => {
  clearCourseModelCacheForTests();
  let builds = 0;
  getOrBuildCourseModel("event:provider:contest:v1:gpx-a", () => ++builds);
  getOrBuildCourseModel("event:provider:contest:v2:gpx-b", () => ++builds);
  assert.equal(builds, 2);
});
