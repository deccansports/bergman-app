import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);

test("main live map rebuilds only from immutable course identity", () => {
  assert.match(
    source,
    /const courseIdentity = useMemo\([\s\S]*immutableCourseIdentity\(/,
  );
  assert.match(source, /\[courseIdentity\]/);
  assert.match(source, /getOrBuildCourseModel\(courseIdentity/);
  assert.doesNotMatch(
    source,
    /\[courseQuery\.data, geometryQuery\.data, mapAthlete\]/,
  );
});

test("live map identity excludes athlete progress and canonical snapshots", () => {
  const identity = source.match(/immutableCourseIdentity\(\{([\s\S]*?)\}\),/);
  assert(identity);
  assert.doesNotMatch(
    identity[1],
    /mapAthlete\.|progress|split|elapsed|canonical/i,
  );
  assert.match(
    identity[1],
    /providerEventUuid: bergman102MasterSelection[\s\S]*normalizedSelectedProviderEventUuid/,
  );
  assert.match(identity[1], /contestId:[\s\S]*mapGeometrySelection\.contestId/);
  assert.match(
    identity[1],
    /contestName: bergman102MasterSelection[\s\S]*mapGeometrySelection\.contestName/,
  );
  assert.match(identity[1], /geometry: geometryQuery\.data/);
});

test("main live geometry is provider and category scoped and the map remains mounted", () => {
  assert.match(
    source,
    /const courseQuery = useCourseMap\([\s\S]*selectedProviderEventUuid/,
  );
  assert.match(
    source,
    /const geometryQuery = useCourseGeometry\([\s\S]*bergman102MasterSelection \|\|[\s\S]*fallbackCourseAthlete &&[\s\S]*selectedCourseKind !== "unknown"[\s\S]*selectedProviderEventUuid[\s\S]*mapGeometrySelection/,
  );
  assert.match(
    source,
    /eventQuery\.event &&[\s\S]*selectedProviderEventUuid &&[\s\S]*!configuredBergman102MasterSelection/,
  );
  const mapView = source.match(/<CourseMapView[\s\S]*?\/>/);
  assert(mapView);
  assert.doesNotMatch(mapView[0], /\bkey=/);
  assert.doesNotMatch(source, /testID="live-track-map-suspended"/);
});
