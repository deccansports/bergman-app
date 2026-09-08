import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./CourseMapView.native.tsx", import.meta.url),
  "utf8",
);

test("non-selected athletes render through one GeoJSON source and Mapbox layers", () => {
  assert.match(source, /shape=\{athleteShape\}/);
  assert.match(source, /id="bergman-athlete-circles"/);
  assert.match(source, /id="bergman-athlete-labels"/);
  assert.doesNotMatch(source, /PointAnnotation|<Marker(?:\s|>)/);
});

test("selected identity uses feature-state instead of rebuilding source data", () => {
  assert.match(source, /Selection is Mapbox feature-state/);
  assert.match(source, /setFeatureState\([\s\S]*ATHLETE_SOURCE_ID/);
  assert.match(source, /\["feature-state", "selected"\]/);
  assert.match(source, /athleteSourceSignature\(validAthletes\)/);
});

test("exactly one selected athlete marker has avatar fallback, initials and BIB", () => {
  assert.equal(source.match(/<MarkerView/g)?.length, 1);
  assert.doesNotMatch(source, /<SelectedAthleteMarker\s+key=/);
  assert.match(
    source,
    /athlete\.photoUrl && failedPhotoUrl !== athlete\.photoUrl/,
  );
  assert.match(source, /getInitials\(athlete\.name\)/);
  assert.match(source, /String\(athlete\.bib \|\| "—"\)/);
  assert.match(
    source,
    /onError=\{\(\) => setFailedPhotoUrl\(athlete\.photoUrl \?\? null\)\}/,
  );
  assert.match(source, /borderRadius: 7/);
  const courseIndex = source.indexOf("bergman-course-lines");
  const distanceIndex = source.indexOf("bergman-major-distance-circles");
  const landmarkIndex = source.indexOf("bergman-landmark-circles");
  const athleteIndex = source.indexOf("bergman-athlete-circles");
  assert.ok(courseIndex < distanceIndex);
  assert.ok(distanceIndex < landmarkIndex);
  assert.ok(landmarkIndex < athleteIndex);
});

test("manual gestures suspend follow and ATHLETE restores it", () => {
  assert.match(
    source,
    /state\.gestures\.isGestureActive && !gestureActiveRef\.current[\s\S]*setFollowEnabled\(false\)/,
  );
  assert.match(source, /accessibilityLabel="Refocus selected athlete"/);
  assert.match(source, />\s*ATHLETE\s*</);
});

test("course bounds do not lock exploration and athlete switches do not auto-focus", () => {
  assert.match(source, /maxBounds=\{explorationBounds \?\? undefined\}/);
  assert.match(source, /const minimumZoom = 3/);
  assert.match(source, /setCameraMode\("USER_CONTROLLED", "manual_gesture"\)/);
  assert.doesNotMatch(
    source,
    /\[activeAthleteId, followSelectedAthlete, styleRevision\]/,
  );
});

test("selected marker updates without a React animation loop or camera ownership", () => {
  const markerSource = source.match(
    /const SelectedAthleteMarker = memo[\s\S]*?\n\);\n\nfunction UnavailableMap/,
  )?.[0];
  assert.ok(markerSource);
  assert.doesNotMatch(markerSource, /requestAnimationFrame|setCoordinate/);
  assert.match(
    markerSource,
    /coordinate=\{\[athlete\.position\.lng, athlete\.position\.lat\]\}/,
  );
  assert.match(
    source,
    /cameraCommandAllowed\(cameraModeRef\.current, "follow"\)/,
  );
});

test("course and distance styling are native zoom expressions", () => {
  assert.match(source, /const COURSE_LINE_WIDTH = \[[\s\S]*\["zoom"\]/);
  assert.match(source, /lineWidth: COURSE_LINE_WIDTH/);
  assert.match(source, /textAllowOverlap: false/);
  assert.match(source, /textField: \["get", "number"\]/);
});
