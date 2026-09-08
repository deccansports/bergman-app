import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liveScreen = readFileSync(
  new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);
const courseScreen = readFileSync(
  new URL("./components/CourseMapScreen.tsx", import.meta.url),
  "utf8",
);
const nativeMap = readFileSync(
  new URL("./components/CourseMapView.native.tsx", import.meta.url),
  "utf8",
);
const courseConfig = readFileSync(
  new URL("./courseConfig.ts", import.meta.url),
  "utf8",
);
const elevationPanel = readFileSync(
  new URL("./components/ElevationProfilePanel.tsx", import.meta.url),
  "utf8",
);
const trackingQueries = readFileSync(
  new URL("../hooks/useTrackingQueries.ts", import.meta.url),
  "utf8",
);

test("the immutable BERGMAN 102 selection owns shared map geometry even with no tracked athlete", () => {
  const geometryCall = liveScreen.match(
    /const geometryQuery = useCourseGeometry\(([\s\S]*?)\);/,
  );
  assert(geometryCall);
  assert.doesNotMatch(
    geometryCall[1],
    /mapAthlete|watchlist|currentSplit|elapsed|leaderboard|participantLive|markerPosition/i,
  );
  assert.match(geometryCall[1], /mapGeometrySelection/);
  assert.match(
    geometryCall[1],
    /bergman102MasterSelection \|\|[\s\S]*fallbackCourseAthlete &&[\s\S]*selectedCourseKind !== "unknown"/,
  );
  assert.match(
    liveScreen,
    /const fallbackCourseAthlete =\s*mapAthlete \?\? verifiedAutoTrackAthlete/,
  );
  assert.match(
    liveScreen,
    /configuredBergman102MasterSelection\s*\?\?\s*resolveBergman102MasterCourseSelection\(courseQuery\.data\?\.courseMap\)/,
  );
  assert.match(
    liveScreen,
    /eventQuery\.event &&[\s\S]*selectedProviderEventUuid &&[\s\S]*!configuredBergman102MasterSelection/,
  );
  assert.doesNotMatch(
    liveScreen,
    /\.\.\.master,\s*providerEventUuid:\s*selectedProviderEventUuid/,
  );
  assert.match(
    liveScreen,
    /const mapGeometrySelection = useMemo<CourseMapSelection>\([\s\S]*bergman102MasterSelection[\s\S]*allowedSegments: allowedGeometrySegments[\s\S]*: courseSelection/,
  );
  assert.match(
    liveScreen,
    /bergman102MasterSelection \? "event-config" : "canonical"/,
  );
  assert.match(
    liveScreen,
    /const elevationGeometryQuery = useCourseGeometry\([\s\S]*courseSelection/,
  );
  assert.match(liveScreen, /\[courseIdentity\]/);
  assert.match(
    trackingQueries,
    /selection\?\.allowedSegments[\s\S]*sort\(\)\.join\(","\)/,
  );
});

test("master geometry identity excludes selected contest timing ownership", () => {
  assert.match(
    liveScreen,
    /providerEventUuid:\s*bergman102MasterSelection\s*\?\s*undefined\s*:\s*normalizedSelectedProviderEventUuid/,
  );
  assert.match(
    liveScreen,
    /const displayCourseVersion = bergman102MasterSelection\s*\?\s*undefined\s*:\s*courseVersion/,
  );
  assert.match(
    liveScreen,
    /const displayTimingConfig = bergman102MasterSelection\s*\?\s*undefined\s*:\s*timingDisplayConfig/,
  );
  assert.match(
    liveScreen,
    /bergman102MasterSelection\s*\?\s*undefined\s*:\s*courseQuery\.data\?\.timingConfiguration/,
  );
});

test("GPX parsing is cached once per URL for the app session", () => {
  assert.match(courseConfig, /const parsedGpxByUrl = new Map/);
  assert.match(courseConfig, /const cached = parsedGpxByUrl\.get\(url\)/);
  assert.match(courseConfig, /parsedGpxByUrl\.set\(url, pending\)/);
});

test("native viewport fit identity excludes athletes", () => {
  const viewportKey = nativeMap.match(/const key = `\$\{map\.name\}([^;]+);/);
  assert(viewportKey);
  assert.doesNotMatch(viewportKey[1], /athlete|selected/i);
  assert.match(nativeMap, /lastFitKeyRef\.current === key/);
  assert.doesNotMatch(nativeMap, /position\.lat[\s\S]{0,120}lastFitKeyRef/);
});

test("live map camera padding uses the measured athlete-card safe area", () => {
  assert.match(liveScreen, /const \[compactCardHeight, setCompactCardHeight\]/);
  assert.match(
    liveScreen,
    /onLayout=\{\(event\) => \{[\s\S]*nativeEvent\.layout\.height/,
  );
  assert.match(liveScreen, /bottomSafeArea=\{[\s\S]*compactCardHeight \+ 24/);
  assert.match(nativeMap, /Math\.max\(bottomSafeArea \+ 20, 48\)/);
  assert.doesNotMatch(nativeMap, /paddingBottom:\s*300/);
});

test("course category and elevation work require explicit button presses", () => {
  assert.match(courseScreen, /onPress=\{\(\) => \{\s*setSelectedCourseId/);
  assert.doesNotMatch(courseScreen, /selectedMapAthlete/);
  assert.match(
    courseScreen,
    /accessibilityLabel=\{[\s\S]*Load course elevation/,
  );
  assert.match(
    courseScreen,
    /\{elevationOpen \? \([\s\S]*<CombinedElevationProfile/,
  );
  assert.match(elevationPanel, /buildElevationProfiles\(geometry, cacheKey\)/);
});
