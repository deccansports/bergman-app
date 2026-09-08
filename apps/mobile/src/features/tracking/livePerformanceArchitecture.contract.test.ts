import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  diagnostics,
  liveScreen,
  mapDiagnostics,
  nativeMap,
  canvasMap,
  interpolation,
  socketRegistry,
] = await Promise.all([
  readFile(new URL("./livePerformanceDiagnostics.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("./course-map/devInstrumentation.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "./course-map/components/CourseMapView.native.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("./course-map/components/CourseTrackCanvas.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("./engine/interpolation.ts", import.meta.url), "utf8"),
  readFile(
    new URL("./hooks/canonicalSocketRegistry.ts", import.meta.url),
    "utf8",
  ),
]);

test("one development report covers the requested live performance counters", () => {
  for (const counter of [
    "liveTrackMounts",
    "liveTrackUnmounts",
    "socketCreates",
    "socketOpens",
    "socketCloses",
    "reconnectTimers",
    "athleteDetailRequests",
    "athleteDetailBytes",
    "courseModelBuilds",
    "gpxParses",
    "queryInvalidations",
    "cardRenders",
    "timelineDerivations",
    "timelineCacheReads",
    "identityResolutions",
    "predictionCalculations",
    "athletePositionDerivations",
    "courseResolutions",
    "cameraModeTransitions",
    "cameraGestureEvents",
    "participantRevisionChanges",
    "athleteSearchRequests",
    "athleteSearchAborts",
    "athleteSearchSingleFlightHits",
  ]) {
    assert.match(diagnostics, new RegExp(counter));
  }
  assert.match(diagnostics, /\[performance:live-track\]/);
  assert.match(diagnostics, /\[LIVE_TRACK_DERIVATION_STATS\]/);
  assert.match(diagnostics, /ATHLETE_SWITCH_DERIVATION_STATS/);
  assert.match(liveScreen, /startLivePerformanceWindow\(60_000\)/);
  assert.match(socketRegistry, /recordLivePerformance\("socketCreates"\)/);
  assert.match(mapDiagnostics, /recordLivePerformance\("courseModelBuilds"\)/);
});

test("camera mode diagnostics record transitions, not repeated gestures in the same mode", () => {
  assert.match(nativeMap, /if \(cameraModeRef\.current === mode\) return;/);
  assert.match(canvasMap, /if \(mode === "USER_CONTROLLED"\) return;/);
  assert.match(canvasMap, /enterUserControlledMode\("canvas_wheel_zoom"\)/);
  assert.match(
    nativeMap,
    /if \(cameraModeRef\.current === "USER_CONTROLLED"\) return;[\s\S]*setCameraMode\("INITIAL_FIT"/,
  );
});

test("athlete marker projection uses one local clock and cached course geometry", () => {
  assert.match(
    liveScreen,
    /getOrBuildCourseModel\(`\$\{courseIdentity\}:cumulative-path-v1`/,
  );
  const markerProjection = liveScreen.slice(
    liveScreen.indexOf("const buildMapAthletes = useCallback"),
    liveScreen.indexOf("const elevationSelectedMapAthlete ="),
  );
  assert.match(markerProjection, /mapPredictionNowMs/);
  assert.match(markerProjection, /resolveLiveElapsedSeconds/);
  assert.match(markerProjection, /checkpointBoundedPosition/);
  assert.match(markerProjection, /coursePathModel/);
  assert.doesNotMatch(markerProjection, /buildCumulativePath\(/);
  assert.doesNotMatch(
    markerProjection,
    /courseQuery\.refetch|geometryQuery\.refetch|requestSelectedAthleteRefresh|api\./,
  );
  const mapLeaf = liveScreen.slice(
    liveScreen.indexOf("const LivePredictedCourseMap"),
    liveScreen.indexOf("export function LiveTrackScreen"),
  );
  const screenOwner = liveScreen.slice(liveScreen.indexOf("export function LiveTrackScreen"));
  assert.match(mapLeaf, /useSharedLiveNow\(predictionRunning\)/);
  assert.doesNotMatch(screenOwner, /useSharedLiveNow\(mapPredictionRunning\)/);
});

test("checkpoint waiting is local-only and exposes canonical position diagnostics", () => {
  assert.match(interpolation, /AWAITING_CHECKPOINT_CONFIRMATION/);
  assert.doesNotMatch(
    interpolation,
    /fetch\(|axios|refetch|WebSocket|parseGpx/i,
  );

  const markerProjection = liveScreen.slice(
    liveScreen.indexOf("const buildMapAthletes = useCallback"),
    liveScreen.indexOf("const elevationAthlete ="),
  );
  for (const field of [
    "latestOfficialSplitKey",
    "latestOfficialKm",
    "latestOfficialAt",
    "nextCheckpointKey",
    "nextCheckpointKm",
    "interpolatedKm",
    "predictedArrivalAt",
    "waitingSince",
    "waitingSeconds",
    "paceSource",
    "projectionState",
  ]) {
    assert.match(markerProjection, new RegExp(`${field}(?:\\s*:|\\s*[,}])`));
  }

  const compactProgress = liveScreen.slice(
    liveScreen.indexOf("function CompactRaceProgress"),
    liveScreen.indexOf("function TrackedAthleteListCard"),
  );
  assert.match(compactProgress, /Awaiting timing confirmation/);
  assert.match(compactProgress, /useContinuousElapsedSeconds/);
  assert.doesNotMatch(
    compactProgress,
    /courseQuery\.refetch|geometryQuery\.refetch|requestSelectedAthleteRefresh|api\.|fetch\(/,
  );
});

test("tracked list rows render official progress without creating one prediction timer per athlete", () => {
  const trackedListCard = liveScreen.slice(
    liveScreen.indexOf("function TrackedAthleteListCard"),
    liveScreen.indexOf("export function LiveTrackScreen"),
  );
  assert.doesNotMatch(trackedListCard, /setInterval\(/);
  assert.doesNotMatch(trackedListCard, /setPredictionNow/);
  assert.match(trackedListCard, /progress=\{progress\?\.progress \?\? 0\}/);
});
