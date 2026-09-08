import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Android and iOS use the same native Mapbox source/layer renderer", async () => {
  const source = await readFile(
    new URL("./components/CourseMapView.native.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /from "@rnmapbox\/maps"/);
  assert.match(source, /<ShapeSource id=\{COURSE_SOURCE_ID\}/);
  assert.match(source, /<ShapeSource id=\{DISTANCE_SOURCE_ID\}/);
  assert.match(source, /id=\{ATHLETE_SOURCE_ID\}/);
  assert.equal(source.match(/<MarkerView/g)?.length, 1);
  assert.doesNotMatch(source, /PointAnnotation|react-native-maps/);
  assert.match(source, /panEnabled: true/);
  assert.match(source, /pinchPanEnabled: true/);
  assert.match(source, /maxBounds=\{explorationBounds \?\? undefined\}/);
});

test("a missing public token never falls back to blocked OpenStreetMap tiles", async () => {
  const source = await readFile(
    new URL("./components/CourseMapView.native.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN/);
  assert.match(source, /EXPO_PUBLIC_MAPBOX_TOKEN/);
  assert.match(source, /if \(!MAPBOX_TOKEN\)/);
  assert.match(source, /if \(!MAPBOX_TOKEN\)[\s\S]*<UnavailableMap/);
  assert.doesNotMatch(source, /<CourseTrackCanvas/);
});
