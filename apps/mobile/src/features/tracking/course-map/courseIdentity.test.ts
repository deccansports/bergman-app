import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types test runner requires the explicit .ts extension.
import { immutableCourseIdentity } from "./courseIdentity.ts";

const base = {
  eventId: "event-a",
  providerEventUuid: "provider-a",
  contestId: "contest-a",
  contestName: "1 Km",
  courseVersion: 1,
  geometry: {
    legs: [
      {
        segment: "swim",
        gpxUrl: "https://example.test/1k.gpx",
        path: [
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 },
        ],
      },
    ],
    markers: [],
  },
};

test("live athlete and watchlist refresh state cannot change course identity", () => {
  const before = immutableCourseIdentity(base);
  const liveRefresh = {
    ...base,
    athletePosition: { lat: 12.9, lng: 77.6 },
    currentSplit: "SWIM FINISH",
    watchlistResponse: { refreshedAt: 123456789 },
    canonicalBuildTimestamp: "2026-08-30T17:23:56+05:30",
  };
  const after = immutableCourseIdentity(liveRefresh);
  assert.equal(after, before);
});

test("contest, course version, and GPX identity rebuild the course", () => {
  const before = immutableCourseIdentity(base);
  assert.notEqual(
    immutableCourseIdentity({ ...base, contestId: "contest-b" }),
    before,
  );
  assert.notEqual(
    immutableCourseIdentity({ ...base, courseVersion: 2 }),
    before,
  );
  assert.notEqual(
    immutableCourseIdentity({
      ...base,
      geometry: {
        ...base.geometry,
        legs: [
          { ...base.geometry.legs[0], gpxUrl: "https://example.test/2k.gpx" },
        ],
      },
    }),
    before,
  );
});
