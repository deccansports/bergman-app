import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (relative: string) =>
  readFileSync(resolve(process.cwd(), relative), "utf8");

const screen = read(
  "apps/mobile/src/features/tracking/leaderboard/components/LeaderboardScreen.tsx",
);
const repository = read(
  "apps/mobile/src/core/repositories/leaderboard.repository.ts",
);
const queries = read(
  "apps/mobile/src/features/tracking/hooks/useTrackingQueries.ts",
);
const socket = read(
  "apps/mobile/src/features/tracking/hooks/useCanonicalChangeSocket.ts",
);
const socketRegistry = read(
  "apps/mobile/src/features/tracking/hooks/canonicalSocketRegistry.ts",
);
const route = read("src/app/api/live/leaderboard/[eventId]/route.ts");
const canonicalRanking = read(
  "packages/live-tracking-contracts/src/leaderboards.ts",
);

test("A. Test 1 live timing is projected through the normalized mobile leaderboard path", () => {
  assert.match(route, /live-leaderboard/);
  assert.doesNotMatch(route, /buildCanonicalLeaderboards\(/);
  assert.match(repository, /\/api\/live\/leaderboard/);
  assert.doesNotMatch(repository, /leaderboardQuery|apicn\.feibot\.com/);
  assert.match(queries, /mapLeaderboardRows\(res\.athletes \?\? \[\]\)/);
});

test("B. All ages retains unknown or null age groups", () => {
  assert.match(route, /if \(ageGroup\) query\.set\("ageGroup", ageGroup\)/);
  assert.match(screen, /selectedAgeGroup === "all" \|\|/);
});

test("C. All athletes retains unknown or null gender", () => {
  assert.match(route, /gender\.toLowerCase\(\) !== "all"/);
  assert.match(queries, /filters\?\.gender \?\? "All"/);
});

test("D. Finished athletes with canonical elapsed timing remain rankable", () => {
  assert.doesNotMatch(canonicalRanking, /OVERALL_EXCLUDED[^\n]*finished/);
  assert.match(canonicalRanking, /aFinished && bFinished/);
  assert.match(canonicalRanking, /officialFinishElapsedSeconds/);
});

test("E. Active athletes with accepted timing remain rankable", () => {
  assert.match(canonicalRanking, /hasLeaderboardTimingEvidence/);
  assert.doesNotMatch(canonicalRanking, /OVERALL_EXCLUDED[^\n]*active/);
  assert.match(canonicalRanking, /lastCompleted\(snapshot, contest\)/);
});

test("F. Wrong-contest rows are excluded before ranking and rendering", () => {
  assert.match(repository, /contestId/);
  assert.match(repository, /providerEventUuid/);
  assert.match(canonicalRanking, /snapshotBelongsToContest/);
  assert.match(screen, /contest === normalizedKey\(selectedContest\.label\)/);
});

test("G. Manual Refresh refetches the currently rendered live source", () => {
  assert.match(
    screen,
    /const requests:[\s\S]*usesOfficialResults[\s\S]*refetchLiveLeaderboard/,
  );
});

test("H. Canonical or leaderboard version changes invalidate the live query", () => {
  assert.match(socket, /change\.type === "leaderboard_changed"/);
  assert.match(socket, /queryKey: \["tracking", "leaderboard", eventId\]/);
  assert.match(socketRegistry, /entry\.entityVersions\.set/);
});

test("I. A new accepted split can reorder live standings", () => {
  assert.match(canonicalRanking, /const splitOrder =/);
  assert.match(canonicalRanking, /const distance =/);
  assert.match(canonicalRanking, /const time =/);
});

test("J. Empty state is driven by the final scoped and filtered row set", () => {
  assert.match(screen, /data=\{paginatedEntries\}/);
  assert.match(screen, /ListEmptyComponent=/);
  assert.match(screen, /modeFilteredEntries\.length/);
});

test("K. An older empty response cannot replace retained non-empty rows", () => {
  assert.match(queries, /retainedLiveLeaderboards/);
  assert.match(queries, /rows\.length === 0/);
  assert.match(queries, /retained\.rows\.length > 0/);
  assert.match(
    queries,
    /isOlderLeaderboardRevision\(incomingRevision, retained\)/,
  );
  assert.match(
    queries,
    /const effectiveRows = staleEmptyRejected \? retained!\.rows : rows/,
  );
});

test("L. Mobile uses one normalized endpoint and never calls Feibot or legacy result routes", () => {
  assert.match(repository, /\/api\/live\/leaderboard/);
  assert.doesNotMatch(
    repository,
    /getCanonicalOverallLeaderboard|leaderboardQuery|apicn\.feibot\.com/,
  );
  assert.match(screen, /Leaderboard will appear when timing begins/);
  assert.match(screen, /No accepted official timing evidence is available/);
});

test("M. Finished canonical fallback exposes loading and route errors", () => {
  assert.match(screen, /usesOfficialResults[\s\S]*: query\.isLoading/);
  assert.match(screen, /usesOfficialResults[\s\S]*: query\.isError/);
  assert.doesNotMatch(screen, /isLive && query\.(?:isLoading|isError)/);
  assert.doesNotMatch(screen, /No race timing data available/);
});

test("N. Athlete-detail rank fallback requests only the selected athlete row", () => {
  assert.match(
    repository,
    /query\.set\("participantUuid", filters\.participantUuid\)/,
  );
  assert.match(repository, /query\.set\("bib", filters\.bib\)/);
  assert.match(route, /const athletes = selectedAthleteOnly/);
  assert.match(route, /total: allAthletes\.length/);
});

test("O. Course-map cache identity uses compact fingerprints", () => {
  assert.match(queries, /function compactQueryFingerprint/);
  assert.match(queries, /compactQueryFingerprint\(courseMapVersion\)/);
  assert.match(queries, /compactQueryFingerprint\(canonicalCourseVersion\)/);
  assert.match(queries, /compactQueryFingerprint\(fallbackCourseVersion\)/);
});
