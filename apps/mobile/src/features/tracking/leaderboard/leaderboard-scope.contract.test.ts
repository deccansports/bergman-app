import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = (relative: string) =>
  readFileSync(resolve(process.cwd(), relative), "utf8");
const screen = source(
  "apps/mobile/src/features/tracking/leaderboard/components/LeaderboardScreen.tsx",
);
const repository = source(
  "apps/mobile/src/core/repositories/leaderboard.repository.ts",
);
const route = source("src/app/api/live/leaderboard/[eventId]/route.ts");
const courseIndexRoute = source(
  "src/app/api/live/course-index/[eventId]/route.ts",
);
const mobileApiWorker = source("cloudflare/bergman-mobile-api/src/index.ts");

test("overall mobile leaderboard sends provider-event and contest scope", () => {
  assert.match(screen, /providerEventUuid: leaderboardProviderEventUuid/);
  assert.match(screen, /contestUuid: leaderboardContestUuid/);
  assert.match(
    repository,
    /const providerEventUuid = String\(filters\.providerEventUuid/,
  );
  assert.match(
    repository,
    /const contestId = String\([\s\S]*filters\.contestUuid \?\? filters\.contest/,
  );
  assert.match(
    repository,
    /providerEventUuid,[\s\S]*\/api\/live\/leaderboard\//,
  );
});

test("scope discovery is non-circular and course metadata is requested only after resolution", () => {
  assert.match(screen, /useLeaderboardScopes/);
  assert.match(screen, /requestedScope/);
  assert.match(
    screen,
    /useCourseMap\([\s\S]*leaderboardProviderEventUuid \|\| undefined,[\s\S]*leaderboardContestUuid \|\| undefined/,
  );
  assert.match(screen, /LEADERBOARD_SCOPE_RESOLVED/);
  assert.match(
    repository,
    /\/api\/live\/course-index\/\$\{encodeURIComponent\(eventId\)\}\?scopeOnly=1/,
  );
  assert.doesNotMatch(repository, /contest-mapping-view/);
  assert.match(courseIndexRoute, /scopeOnly/);
  assert.match(courseIndexRoute, /compactContestScopes/);
  assert.match(mobileApiWorker, /course-index\/\$\{eventId\}\$\{url\.search\}/);
});

test("viewer-aware leaderboard reads the normalized provider-scoped live endpoint", () => {
  assert.match(route, /LIVE_TRACKING_WORKER_URL/);
  assert.match(route, /live-leaderboard/);
  assert.match(route, /providerEventUuid/);
  assert.match(route, /contestUuid: contest/);
  assert.doesNotMatch(
    route,
    /versionedParticipantIndexKey|versionedAthleteSnapshotKey/,
  );
});

test("viewer-aware leaderboard preserves privacy masking before mobile mapping", () => {
  assert.match(route, /isPublicAthleteVisibilityEnabledForRequest/);
  assert.match(route, /payload\.athletes/);
  assert.doesNotMatch(repository, /leaderboardQuery|apicn\.feibot\.com/);
});

test("an upcoming event renders an explicit pre-race leaderboard state", () => {
  assert.match(screen, /const isUpcoming = event\?\.status === "upcoming"/);
  assert.match(screen, /Leaderboard opens on race day/);
  assert.match(
    screen,
    /Live standings will appear after athletes begin recording official timing splits/,
  );
});
