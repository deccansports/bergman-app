import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = (relative: string) =>
  readFileSync(resolve(process.cwd(), relative), "utf8");

const liveTrackScreen = source(
  "apps/mobile/src/features/events/components/LiveTrackScreen.tsx",
);
const mapper = source("apps/mobile/src/features/tracking/mappers.ts");
const watchlist = source(
  "apps/mobile/src/features/tracking/watchlist/hooks/useWatchlist.ts",
);
const leaderboard = source(
  "apps/mobile/src/features/tracking/leaderboard/components/LeaderboardScreen.tsx",
);
const dashboard = source(
  "apps/mobile/src/features/dashboard/components/AthleteDashboardScreen.tsx",
);
const profileRepository = source(
  "apps/mobile/src/core/repositories/profile.repository.ts",
);

test("Hide details collapses presentation without removing the tracked athlete", () => {
  const hideHandler = liveTrackScreen.match(
    /onExpand=\{\(\) => \{[\s\S]*?setAthleteExpanded\(false\);[\s\S]*?setSheetMode\("full"\);[\s\S]*?\}\}/,
  )?.[0];

  assert.ok(hideHandler, "expected the expanded-panel Hide details handler");
  assert.doesNotMatch(hideHandler, /removeTrackedAthlete/);
  assert.doesNotMatch(hideHandler, /setSelectedTrackedKey\(null\)/);
});

test("public search and watchlist hide anonymous athletes and legacy hidden aliases", () => {
  assert.match(
    liveTrackScreen,
    /visibility === "ANONYMOUS"[\s\S]*visibility === "PRIVATE"/,
  );
  assert.match(
    watchlist,
    /visibility === "ANONYMOUS"[\s\S]*visibility === "PRIVATE"/,
  );
});

test("privacy settings expose only Public and Anonymous, with Hide represented by Anonymous", () => {
  assert.match(
    profileRepository,
    /TrackingVisibility = ['"]PUBLIC['"] \| ['"]ANONYMOUS['"]/,
  );
  assert.match(dashboard, /onChange\(enabled \? "PUBLIC" : "ANONYMOUS"\)/);
  assert.match(
    dashboard,
    /Your race remains visible while identity details are hidden\./,
  );
  assert.doesNotMatch(dashboard, /onChange\([^\n]*"PRIVATE"/);
});

test("anonymous detail mapping masks every direct identity field", () => {
  assert.match(mapper, /name: anonymous[\s\S]*"Anonymous Athlete"/);
  assert.match(mapper, /email: anonymous[\s\S]*\? undefined/);
  assert.match(mapper, /athleteUid: anonymous[\s\S]*\? undefined/);
  assert.match(mapper, /colorSeed: anonymous[\s\S]*"anonymous-athlete"/);
  assert.match(mapper, /bib: anonymous \? DASH/);
  assert.match(
    mapper,
    /id: isAnonymous \? "anonymous-athlete" : \(a\.id \?\? a\.bib \?\? ""\)/,
  );
  assert.match(mapper, /const club = anonymous[\s\S]*\? undefined/);
  assert.match(mapper, /const country = anonymous[\s\S]*\? undefined/);
  assert.match(mapper, /const location = anonymous[\s\S]*\? undefined/);
  assert.match(mapper, /const photo = anonymous[\s\S]*\? undefined/);
});

test("anonymous leaderboard rows retain standings but cannot open identity", () => {
  assert.match(leaderboard, /onPress=\{anonymous \? undefined : onPress\}/);
  assert.match(
    leaderboard,
    /anonymous \? "Identity protected" : identity\.bib/,
  );
  assert.match(leaderboard, /uri=\{anonymous \? undefined : item\.avatarUri\}/);
});
