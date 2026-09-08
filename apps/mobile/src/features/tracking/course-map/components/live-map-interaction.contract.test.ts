import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nativeMap = readFileSync(
  new URL("./CourseMapView.native.tsx", import.meta.url),
  "utf8",
);
const webMap = readFileSync(
  new URL("./CourseTrackCanvas.tsx", import.meta.url),
  "utf8",
);
const liveScreen = readFileSync(
  new URL("../../../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);

test("native gestures own the camera until an explicit focus or fit action", () => {
  assert.match(nativeMap, /scrollEnabled/);
  assert.match(nativeMap, /zoomEnabled/);
  assert.match(nativeMap, /pitchEnabled\n/);
  assert.match(nativeMap, /rotateEnabled\n/);
  assert.match(
    nativeMap,
    /setCameraMode\("USER_CONTROLLED", "manual_gesture"\)/,
  );
  assert.match(
    nativeMap,
    /cameraCommandAllowed\(cameraModeRef\.current, "follow"\)/,
  );
  assert.match(
    nativeMap,
    /reason: allowed \? "athlete_follow" : "user_controlled"/,
  );
  assert.match(
    nativeMap,
    /setCameraMode\("COURSE_FIT", "explicit_course_fit"\)/,
  );
  assert.match(
    nativeMap,
    /setCameraMode\("ATHLETE_FOCUS", "explicit_athlete_focus"\)/,
  );
});

test("web compatibility map accepts drag and wheel gestures without network ownership", () => {
  assert.match(webMap, /PanResponder\.create/);
  assert.match(webMap, /onPanResponderMove/);
  assert.match(webMap, /onWheel:/);
  assert.match(webMap, /constrainCameraCenter\(eventReference, candidate\)/);
  assert.doesNotMatch(webMap, /fetch\([^)]*camera/i);
});

test("marker source priority is live, bounded timing prediction, canonical, last-known, then start", () => {
  assert.match(
    liveScreen,
    /const positionSource[^=]*=\s*directGpsPosition[\s\S]*\? "live_location"[\s\S]*\? "canonical_finish"[\s\S]*\? "transition_hold"[\s\S]*estimatedCourseDistanceKm > latestOfficialKm[\s\S]*\? "timing_interpolated"[\s\S]*\? "canonical_split"[\s\S]*\? "last_known"[\s\S]*: "course_start"/,
  );
  assert.match(
    liveScreen,
    /directGpsPosition \?\?[\s\S]*currentLegPosition \?\?[\s\S]*configuredCoursePosition \?\?[\s\S]*fractionPosition \?\?[\s\S]*courseStart/,
  );
});

test("marker updates do not run a JS animation loop or enter camera APIs", () => {
  const markerComponent = nativeMap.match(
    /const SelectedAthleteMarker = memo[\s\S]*?\n\);\n\nfunction UnavailableMap/,
  )?.[0];
  assert.ok(markerComponent);
  assert.doesNotMatch(markerComponent, /requestAnimationFrame|setCoordinate/);
  assert.match(
    markerComponent,
    /coordinate=\{\[athlete\.position\.lng, athlete\.position\.lat\]\}/,
  );
  assert.doesNotMatch(markerComponent, /fitBounds|setCamera|moveTo|flyTo/);
});
