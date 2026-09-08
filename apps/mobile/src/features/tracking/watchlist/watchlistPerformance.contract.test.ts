import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const watchlistScreen = read("./components/WatchlistScreen.tsx");
const liveScreen = read("../../events/components/LiveTrackScreen.tsx");
const authProvider = read("../../../core/auth/AuthProvider.tsx");
const socket = read("../hooks/useCanonicalChangeSocket.ts");
const workerProjection = read(
  "../../../../../../cloudflare/bergman-mobile-api/src/services/watchlist.service.ts",
);

test("watchlist cards render from the lightweight account collection without an event roster query", () => {
  assert.match(watchlistScreen, /useWatchlist\(\s*searchEvent\?\.id,?\s*\)/);
  assert.doesNotMatch(
    watchlistScreen,
    /useParticipants|useCanonicalParticipants/,
  );
  assert.match(authProvider, /queryKeys\.accountWatchlist/);
  assert.match(authProvider, /staleTime: 0/);
  assert.match(authProvider, /prepareAccount\(userId\)/);
});

test("watchlist list is virtualized and rows are memoized for larger collections", () => {
  assert.match(watchlistScreen, /const WatchlistAthleteRow = memo/);
  assert.match(watchlistScreen, /<FlatList/);
  assert.match(watchlistScreen, /initialNumToRender=\{6\}/);
  assert.match(watchlistScreen, /windowSize=\{7\}/);
  assert.doesNotMatch(watchlistScreen, /athletes\.map\(/);
});

test("watchlist cards own no athlete detail, socket, map, GPX, or elevation work", () => {
  assert.doesNotMatch(
    watchlistScreen,
    /useCanonicalChangeSocket|useCourseMap|useCourseGeometry|CourseMapView|ElevationProfile|\.gpx/i,
  );
});

test("watchlist hydration retains compact participant scope and socket summaries", () => {
  assert.match(workerProjection, /const athlete =[\s\S]*item\.athlete/);
  assert.match(
    workerProjection,
    /const value = item\[field\] \?\? athlete\[field\]/,
  );
  assert.match(socket, /queryKey\[1\] === "account-watchlist"/);
  assert.match(socket, /patchParticipantSummary/);
});

test("live tracked carousel virtualizes cards instead of mounting the entire collection", () => {
  const carousel = liveScreen.slice(
    liveScreen.indexOf("function CompactTrackedCarousel"),
    liveScreen.indexOf("function CourseMapHeader"),
  );
  assert.match(carousel, /<FlatList/);
  assert.match(carousel, /initialNumToRender=\{2\}/);
  assert.match(carousel, /windowSize=\{3\}/);
  assert.doesNotMatch(carousel, /rows\.map\(/);
});

test("live tracking reads one lightweight participant KV object per tracked card without a full-event load", () => {
  assert.equal(
    (
      liveScreen.match(
        /const selectedAthleteQuery = useQuery(?:<[^>]+>)?\(/g,
      ) ?? []
    ).length,
    1,
  );
  assert.equal(
    (
      liveScreen.match(/const canonicalSocket = useCanonicalChangeSocket\(/g) ??
      []
    ).length,
    1,
  );
  assert.match(liveScreen, /const trackedAthleteLiveQueries = useQueries\(/);
  assert.match(
    liveScreen,
    /trackedForEvent\.map\([\s\S]*queryKeys\.canonicalAthlete\([\s\S]*"athleteOnly"/,
  );
  assert.doesNotMatch(liveScreen, /useParticipants|useCanonicalParticipants/);
  assert.match(liveScreen, /identityHydrationIndexes\(/);
  assert.match(
    liveScreen,
    /selectedAthleteResponseWithRanks &&[\s\S]*!selectedAthleteQuery\.isPlaceholderData/,
  );
  assert.doesNotMatch(
    liveScreen,
    /optimisticTrackedAthletes|removedTrackedKeys/,
  );
  assert.match(
    liveScreen,
    /const trackedSummaryDetails = useMemo\([\s\S]*trackedAthleteFallbackDetail/,
  );
  assert.match(
    liveScreen,
    /buildTrackedAthleteSummaryPresentation\([\s\S]*participantLive: athlete\.participantLive/,
  );
});

test("development trace reports collection visibility without participant identity", () => {
  assert.match(watchlistScreen, /\[tracking-performance\]/);
  assert.match(watchlistScreen, /trackedCount: athletes\.length/);
  assert.doesNotMatch(
    watchlistScreen,
    /\[tracking-performance\][\s\S]{0,400}participantUuid|\[tracking-performance\][\s\S]{0,400}\bbib\b/,
  );
});
