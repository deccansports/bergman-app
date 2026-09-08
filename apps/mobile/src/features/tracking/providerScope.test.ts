import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types test runner requires the explicit .ts extension.
import { immutableCourseIdentity } from "./course-map/courseIdentity.ts";
import {
  normalizeProviderContestUuid,
  normalizeProviderEventUuid,
  // @ts-expect-error Node's strip-types test runner requires the explicit .ts extension.
} from "./providerScope.ts";

test("upper, lower, and mixed-case provider UUIDs share one course identity", () => {
  const identity = (providerEventUuid: string) =>
    immutableCourseIdentity({
      eventId: "event-a",
      providerEventUuid: normalizeProviderEventUuid(providerEventUuid),
      contestId: "contest-a",
      courseVersion: 1,
      geometry: { legs: [], markers: [] },
    });

  assert.equal(identity("4teGxjmX"), identity("4TEGXJMX"));
  assert.equal(identity("4teGxjmX"), identity("4tegxjmx"));
  assert.equal(normalizeProviderEventUuid(" 4TeGxJmX "), "4tegxjmx");
  assert.equal(normalizeProviderContestUuid(" 4FgqiHGd "), "4fgqihgd");
});
