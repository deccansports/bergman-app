import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const source = (relative: string) => readFile(resolve(process.cwd(), relative), "utf8");

test("mobile leaderboard maps scoped course and row age groups into filters", async () => {
  const [leaderboard, trackingQueries] = await Promise.all([
    source("apps/mobile/src/features/tracking/leaderboard/components/LeaderboardScreen.tsx"),
    source("apps/mobile/src/features/tracking/hooks/useTrackingQueries.ts"),
  ]);

  assert.match(
    leaderboard,
    /row\.ageGroupKey,[\s\S]*row\.ageGroup,[\s\S]*row\.ageGroupName/,
  );
  assert.match(
    trackingQueries,
    /ageGroup: firstText\(row\.ageGroupKey, row\.ageGroup\)/,
  );
  assert.match(
    trackingQueries,
    /ageGroupName: firstText\(row\.ageGroupKey, row\.ageGroup\)/,
  );
  assert.match(leaderboard, /const courseQuery = useCourseMap\(/);
  assert.match(
    leaderboard,
    /const ageGroupManifestQuery = useCanonicalLeaderboardManifest\(/,
  );
  assert.match(
    leaderboard,
    /ageGroupManifestQuery\.data\?\.available\?\.ageGroups/,
  );
  assert.match(
    leaderboard,
    /addConfiguredGroups\(selectedConfiguredContest\.ageGroups\)/,
  );
  assert.match(leaderboard, /typeof group === ["']string["']/);
  assert.match(leaderboard, /for \(const row of leaderboardRows\)/);
});

test("scoped canonical manifest keeps real splits and age groups available", async () => {
  const [leaderboard, canonicalRepository] = await Promise.all([
    source("apps/mobile/src/features/tracking/leaderboard/components/LeaderboardScreen.tsx"),
    source("apps/mobile/src/core/repositories/canonicalTracking.repository.ts"),
  ]);

  assert.match(leaderboard, /leaderboardProviderEventUuid/);
  assert.match(leaderboard, /row\.displayName/);
  assert.match(leaderboard, /buildLeaderboardSplitColumns/);
  assert.match(leaderboard, /liveLeaderboardRows/);
  assert.match(leaderboard, /\{splitOptions\.length > 0 \? \(/);
  assert.match(
    leaderboard,
    /effectiveSplitKey === "overall"\s*\? leaderboardEntries\s*:\s*splitLeaderboardEntries/,
  );
  assert.match(
    canonicalRepository,
    /params\.set\(["']providerEventUuid["'], providerEventUuid\)/,
  );
});

test("live leaderboard reads one normalized provider-scoped endpoint with embedded privacy", async () => {
  const [leaderboard, repository] = await Promise.all([
    source("apps/mobile/src/features/tracking/leaderboard/components/LeaderboardScreen.tsx"),
    source("apps/mobile/src/core/repositories/leaderboard.repository.ts"),
  ]);

  assert.doesNotMatch(leaderboard, /trackingPayload|liveAthleteDataReady/);
  assert.match(
    leaderboard,
    /usesOfficialResults = Boolean\([\s\S]*isFinished[\s\S]*finishedResultsQuery\.data\?\.length/,
  );
  assert.doesNotMatch(
    leaderboard,
    /leaderboardQueryEnabled = Boolean\([\s\S]*!isFinished/,
  );
  assert.match(repository, /\/api\/live\/leaderboard/);
  assert.match(repository, /providerEventUuid/);
  assert.match(repository, /contestUuid: contestId/);
  assert.doesNotMatch(repository, /leaderboardQuery|apicn\.feibot\.com/);
  assert.doesNotMatch(repository, /\/api\/events\/\$\{eventId\}\/tracking/);
});

test("finished events retain scope discovery while canonical rows remain the fallback", async () => {
  const leaderboard = await source("apps/mobile/src/features/tracking/leaderboard/components/LeaderboardScreen.tsx");
  assert.match(
    leaderboard,
    /useLeaderboardScopes\([\s\S]*Boolean\(id && eventScreen\.focused\),/,
  );
  assert.match(
    leaderboard,
    /A results upload can lag the event status transition/,
  );
});
