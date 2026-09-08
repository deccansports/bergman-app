import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [screen, diagnostics, mapper, socket] = await Promise.all([
  readFile(new URL("../events/components/LiveTrackScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("./livePerformanceDiagnostics.ts", import.meta.url), "utf8"),
  readFile(new URL("./mappers.ts", import.meta.url), "utf8"),
  readFile(new URL("./hooks/useCanonicalChangeSocket.ts", import.meta.url), "utf8"),
]);

test("the interpolation clock is isolated below LiveTrackScreen", () => {
  const leaf = screen.slice(
    screen.indexOf("const LivePredictedCourseMap"),
    screen.indexOf("export function LiveTrackScreen"),
  );
  const owner = screen.slice(screen.indexOf("export function LiveTrackScreen"));
  assert.match(leaf, /useSharedLiveNow\(predictionRunning\)/);
  assert.match(leaf, /buildAthletes\(predictionNowMs\)/);
  assert.doesNotMatch(owner, /useSharedLiveNow\(mapPredictionRunning\)/);

  const projection = owner.slice(
    owner.indexOf("const buildMapAthletes = useCallback"),
    owner.indexOf("const elevationSelectedMapAthlete ="),
  );
  assert.doesNotMatch(
    projection,
    /repositories\.|fetch\(|refetch\(|useCanonicalChangeSocket|mapCourseMap|parseGpx/,
  );
});

test("identity and timeline work are revision keyed and cache-hit logs are absent", () => {
  assert.match(screen, /trackedAthleteIdentityFingerprint\(/);
  assert.match(
    screen,
    /legacyTrackedAthleteLookup\(persistedSelectedAthlete\)[\s\S]*\[persistedSelectedIdentityFingerprint\]/,
  );
  assert.match(
    screen,
    /resolvedTrackedAthleteForLiveState\([\s\S]*\[persistedSelectedIdentityFingerprint, selectedIdentityQuery\.data\]/,
  );
  assert.doesNotMatch(screen, /IDENTITY_CACHE_HIT/);
  assert.doesNotMatch(mapper, /LIVE_TIMELINE_CACHE_HIT/);
  assert.match(mapper, /recordLivePerformance\("timelineCacheReads"\)/);
});

test("switch diagnostics are request scoped and include every required delta", () => {
  assert.match(screen, /startAthleteSwitchDerivationStats\(/);
  assert.match(
    diagnostics,
    /clearTimeout\(activeAthleteSwitchWindow\.timer\)[\s\S]*emitAthleteSwitchDerivationStats\(activeAthleteSwitchWindow\)/,
  );
  assert.match(diagnostics, /commitAthleteSwitchDerivationStats/);
  assert.match(diagnostics, /renderToCommitMs:/);
  assert.match(diagnostics, /totalSwitchMs:/);
  assert.match(diagnostics, /settleObservationMs:/);
  assert.doesNotMatch(diagnostics, /settleMs = 750/);
  for (const field of [
    "participantUuid",
    "selectionDispatchMs",
    "selectedAthleteLookupMs",
    "identityResolutionMs",
    "queryCacheLookupMs",
    "courseResolutionMs",
    "timelineLookupMs",
    "predictionMappingMs",
    "identityResolutions",
    "timelineBuilds",
    "timelineCacheReads",
    "mobileLiveReads",
    "courseResolutions",
    "predictionCalculations",
    "cardRenders",
    "mapMarkerUpdates",
    "socketCreates",
    "socketCloses",
    "mapRenderCount",
    "mapMarkerRenderCount",
    "modalRenderCount",
    "splitTableRenderCount",
    "liveTrackScreenRenderCount",
    "watchlistStoreUpdates",
  ]) {
    assert.match(diagnostics, new RegExp(`${field}[,:]`));
  }
});

test("selected athlete and course ownership use stable keyed lookups", () => {
  assert.match(screen, /const trackedIndexByKey = useMemo/);
  assert.match(screen, /trackedIndexByKey\.get\(selectedTrackedKey\)/);
  assert.match(screen, /const watchedIndexByKey = useMemo/);
  assert.match(screen, /watchedIndexByKey\.get\(selectedTrackedKey\)/);
  assert.match(screen, /const mapGeometrySelection = useMemo<CourseMapSelection>/);
  assert.match(
    screen,
    /bergman102MasterSelection[\s\S]*\? "event-master"[\s\S]*mapGeometrySelection\.allowedSegments/,
  );
});

test("socket ownership remains event plus provider scoped", () => {
  const hookCall = screen.match(
    /const canonicalSocket = useCanonicalChangeSocket\([\s\S]*?\n  \);/,
  );
  assert.ok(hookCall);
  assert.match(hookCall[0], /id,[\s\S]*normalizedSelectedProviderEventUuid/);
  assert.doesNotMatch(
    hookCall[0].slice(0, hookCall[0].indexOf("{")),
    /selectedParticipantUuid|bib|contest/,
  );
  assert.doesNotMatch(socket, /queryKey.*participantUuid/);
});

test("late response guard remains selected-participant scoped", () => {
  assert.match(
    screen,
    /responseMatchesSelectedParticipant\([\s\S]*responseParticipantUuid,[\s\S]*selectedParticipantUuid/,
  );
  assert.match(
    screen,
    /!sameAthleteSelection\(currentSelectedAthlete, responseIdentity\)[\s\S]*ignored stale athlete response[\s\S]*return;/,
  );
});
