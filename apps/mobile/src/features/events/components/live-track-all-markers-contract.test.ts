import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screenSource = readFileSync(
  new URL("./LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);

test("the live map builds markers for every tracked athlete", () => {
  assert.match(
    screenSource,
    /const mapped = watchedRows\.flatMap\(\(\{ athlete, detail \}\) => \{/,
  );
  assert.doesNotMatch(
    screenSource,
    /const rowsForMap = explicitlySelectedTrackedRow/,
  );
});

test("only the explicitly selected tracked athlete receives selected marker state", () => {
  assert.match(screenSource, /selected: selectedMapAthleteKey === stableId/);
  assert.match(
    screenSource,
    /const selectedMapAthleteKey = selectedTrackedRow[\s\S]*stableAthleteKey\(selectedTrackedRow\.athlete, id\)/,
  );
  assert.match(screenSource, /selectedMapAthleteKey,\s*watchedRows,/);
});

test("map projection uses the canonical active sport leg over a stale boundary segment", () => {
  assert.match(
    screenSource,
    /section\.type === "leg" && section\.status === "in_progress"/,
  );
  assert.match(
    screenSource,
    /activeSection\?\.legType,[\s\S]*detail\?\.raceProgress\?\.legLabel,[\s\S]*detail\?\.track\?\.currentLeg/,
  );
  assert.match(
    screenSource,
    /const legStartKm =[\s\S]*Math\.min\(\.\.\.sectionDistances\)/,
  );
  assert.match(screenSource, /estimatedCourseDistanceKm - legStartKm/);
});

test("the initial compact-card athlete is also selected on the map", () => {
  assert.match(
    screenSource,
    /if \(selectedTrackedKey \|\| compactCardDismissed \|\| !watchedRows\.length\)/,
  );
  assert.match(
    screenSource,
    /setSelectedTrackedKey\(\s*stableAthleteKey\(watchedRows\[initialIndex\]\.athlete, id\),/,
  );
});

test("only the selected athlete owns bounded degraded recovery polling", () => {
  assert.match(screenSource, /athleteDetailFallbackInterval/);
  assert.match(screenSource, /selectedAthleteRaceStatus/);
  assert.match(
    screenSource,
    /requestSelectedAthleteRefresh\("SOCKET_DISCONNECTED_FALLBACK"\)/,
  );
  assert.match(
    screenSource,
    /const trackedSummaryDetails = useMemo\([\s\S]*trackedAthleteFallbackDetail/,
  );
  assert.doesNotMatch(
    screenSource,
    /const trackedAthleteDetailQueries = useQueries\(/,
  );
  assert.equal(
    (
      screenSource.match(
        /requestSelectedAthleteRefresh\("SOCKET_DISCONNECTED_FALLBACK"\)/g,
      ) ?? []
    ).length,
    1,
  );
  assert.match(
    screenSource,
    /notifyOnChangeProps: \["data", "error", "isPlaceholderData"\]/,
  );
});

test("the covered native map remains mounted while its live updates pause", () => {
  assert.match(
    screenSource,
    /athleteExpanded && sheetMode === "full" && selectedTrackedRow/,
  );
  assert.match(screenSource, /if \(fullAthleteDetailOpen\) return \[\]/);
  assert.match(
    screenSource,
    /eventScreen\.focused &&[\s\S]*!fullAthleteDetailOpen/,
  );
  assert.doesNotMatch(screenSource, /testID="live-track-map-suspended"/);
});

test("the compact map card hides a provider zero clock masquerading as pace", () => {
  assert.match(screenSource, /function compactPaceLabel/);
  assert.match(
    screenSource,
    /A provider zero clock is elapsed-time fallback data/,
  );
  assert.match(screenSource, /if \(\/\^0\{1,2\}:00/);
  assert.match(screenSource, /\{pace \? \(/);
});

test("the large leaderboard is loaded only while full athlete details are open", () => {
  assert.match(screenSource, /athleteExpanded &&\s*sheetMode === "full"/);
  assert.match(screenSource, /refetchInterval: false/);
});

test("the notification bell registers the device instead of toggling local state", () => {
  assert.match(screenSource, /enableTrackedAthleteNotifications\(\)/);
  assert.doesNotMatch(
    screenSource,
    /onToggleNotifications=\{\(\) =>\s*setNotificationsEnabled\(\(value\) => !value\)/,
  );
});

test("live elapsed clocks use the shared clock between canonical responses", () => {
  assert.match(screenSource, /function useContinuousElapsedSeconds/);
  assert.match(screenSource, /canonicalElapsedSeconds,/);
  assert.match(screenSource, /useSharedLiveNow\(hasRunningAthlete\)/);
  assert.doesNotMatch(
    screenSource,
    /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1_000\)/,
  );
  assert.match(
    screenSource,
    /useLiveElapsedClock\(\{ startTiming, isLive: running \}\)/,
  );
});

test("canonical changes invalidate tracked athletes and re-anchor Race Time without polling", () => {
  assert.match(screenSource, /useCanonicalChangeSocket\(\s*id,/);
  assert.match(screenSource, /canonicalElapsedSeconds: canonicalLiveElapsed/);
  assert.match(screenSource, /re-anchors immediately when a/);
});

test("the selected athlete has a compact bottom map card", () => {
  assert.match(screenSource, /function CompactMapAthleteCard/);
  assert.match(screenSource, /LIVE ELAPSED/);
  assert.match(screenSource, /FINISH TIME/);
  assert.match(screenSource, /Share\.share/);
  assert.match(
    screenSource,
    /sheetMode === "collapsed" &&\s*selectedTrackedRow &&\s*!compactCardDismissed/,
  );
});
