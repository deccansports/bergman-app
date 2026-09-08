import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repository = fs.readFileSync(
  path.join(
    process.cwd(),
    "apps/mobile/src/core/repositories/participantLive.repository.ts",
  ),
  "utf8",
);
const athleteRepository = fs.readFileSync(
  path.join(
    process.cwd(),
    "apps/mobile/src/core/repositories/athlete.repository.ts",
  ),
  "utf8",
);
const apiClient = fs.readFileSync(
  path.join(process.cwd(), "apps/mobile/src/core/services/api/client.ts"),
  "utf8",
);
const courseRepository = fs.readFileSync(
  path.join(
    process.cwd(),
    "apps/mobile/src/core/repositories/course.repository.ts",
  ),
  "utf8",
);
const leaderboardRepository = fs.readFileSync(
  path.join(
    process.cwd(),
    "apps/mobile/src/core/repositories/leaderboard.repository.ts",
  ),
  "utf8",
);
const acceptedEvidence = fs.readFileSync(
  path.join(
    process.cwd(),
    "apps/mobile/src/core/repositories/acceptedSplitEvidence.ts",
  ),
  "utf8",
);
const liveScreen = fs.readFileSync(
  path.join(
    process.cwd(),
    "apps/mobile/src/features/events/components/LiveTrackScreen.tsx",
  ),
  "utf8",
);
const trackingMappers = fs.readFileSync(
  path.join(process.cwd(), "apps/mobile/src/features/tracking/mappers.ts"),
  "utf8",
);

test("participant live repository uses the Worker and never api-mobile or auth", () => {
  assert.match(repository, /liveTrackingEdgeBaseUrl/);
  assert.match(repository, /\/v1\/live-participant\//);
  assert.doesNotMatch(
    repository,
    /env\.mobileApiBaseUrl|getOptionalFirebaseIdToken|SecureStore\.|headers:\s*\{[^}]*Authorization/s,
  );
});

test("direct reads emit complete mobileLive diagnostics and an unambiguous source", () => {
  for (const field of [
    "eventId",
    "providerEventUuid",
    "participantUuid",
    "key",
    "canonicalBuildVersion",
    "previousCanonicalBuildVersion",
    "timingVersion",
    "previousTimingVersion",
    "liveRevision",
    "previousLiveRevision",
    "comparatorDecision",
    "comparatorReason",
    "responseBytes",
    "durationMs",
    "cacheStatus",
    "reason",
  ]) {
    assert.match(repository, new RegExp(`\\b${field}\\b`));
  }
  assert.match(repository, /\[MOBILE_LIVE_READ\]/);
  assert.match(repository, /x-bergman-athlete-source/);
  assert.match(repository, /\[MOBILE_LIVE_SOURCE\][\s\S]*readSource/);
  assert.match(
    repository,
    /recordLivePerformance\("mobileLiveReads"\);[\s\S]*await fetch\(/,
  );
});

test("ETag 304 and unchanged versions preserve object identity", () => {
  assert.match(repository, /if-none-match/);
  assert.match(repository, /response\.status === 304 && cached/);
  assert.match(repository, /return cached\.participant/);
  assert.match(
    repository,
    /compareParticipantLiveVersions\([\s\S]*participant,[\s\S]*existing\?\.participant/,
  );
  assert.match(repository, /comparison\.decision === "reuse_existing"/);
});

test("athlete-only query has one owner and uses the compact canonical Worker read", () => {
  assert.match(apiClient, /webApi = authenticatedApi\(env\.webAppBaseUrl\)/);
  assert.match(
    athleteRepository,
    /Routine live tracking reads[\s\S]*directly from canonical KV/,
  );
  assert.match(
    athleteRepository,
    /\/api\/live\/events\/\$\{encodeURIComponent\(eventId\)\}\/canonical\/athlete/,
  );
  assert.match(athleteRepository, /webApi\.json<unknown>\(endpoint\.url/);
  assert.match(athleteRepository, /await getParticipantLive\(/);
  assert.match(athleteRepository, /participantLiveAsCanonicalEnvelope\(/);
  assert.match(courseRepository, /webApi\.json<CourseIndexResponse>/);
  assert.match(courseRepository, /webApi\.json<CourseMapResponse>/);
  assert.match(
    leaderboardRepository,
    /webApi\.json<LegacyLeaderboardResponse>/,
  );
  assert.equal(
    (liveScreen.match(/queryKeys\.mobileLiveParticipant\(/g) || []).length,
    0,
  );
  assert.equal(
    (liveScreen.match(/queryKeys\.canonicalAthlete\(/g) || []).length,
    2,
  );
  assert.equal(
    (liveScreen.match(/useQuery<AthleteModalResponse>/g) || []).length,
    1,
  );
  assert.match(liveScreen, /\[mobile-live-query\]/);
  assert.doesNotMatch(liveScreen, /"ATHLETE_CHANGED"/);
});

test("acceptedSplitCount excludes pending presentation rows", () => {
  const diagnostic = athleteRepository.slice(
    athleteRepository.indexOf("acceptedSplitCount:"),
    athleteRepository.indexOf(
      "overallRank:",
      athleteRepository.indexOf("acceptedSplitCount:"),
    ),
  );
  assert.match(diagnostic, /filter\(hasAcceptedSplitEvidence\)/);
  assert.doesNotMatch(diagnostic, /resolved\.splits\.length/);
  assert.match(acceptedEvidence, /split\.accepted === false/);
  assert.doesNotMatch(acceptedEvidence, /"COMPLETED"/);
  assert.match(trackingMappers, /hasAcceptedSplitEvidence\(split\)/);
  assert.doesNotMatch(
    trackingMappers.slice(
      trackingMappers.indexOf("function isAcceptedMobileSplit"),
      trackingMappers.indexOf("function acceptedMobileSplits"),
    ),
    /ACCEPTED_MOBILE_SPLIT_STATUSES|"COMPLETED"/,
  );
});

test("compact transport owns one bounded participant request without course fan-out", () => {
  assert.doesNotMatch(
    repository,
    /setInterval|setTimeout|Date\.now\(\).*fetch/,
  );
  assert.equal((repository.match(/\bfetch\(/g) || []).length, 1);
  assert.match(athleteRepository, /getParticipantLive\(/);
  assert.doesNotMatch(
    repository,
    /\/canonical\/(?:course|participants|leaderboard)|\/gpx(?:\/|\?)/,
  );
});

test("all participant-retaining repository caches have the same bounded limit", () => {
  assert.match(
    athleteRepository,
    /const MAX_ATHLETE_REPOSITORY_CACHE_ENTRIES = 50/,
  );
  assert.match(
    athleteRepository,
    /canonicalSnapshotCache\.size > MAX_ATHLETE_REPOSITORY_CACHE_ENTRIES/,
  );
  assert.match(
    athleteRepository,
    /athleteOnlyCache\.size > MAX_ATHLETE_REPOSITORY_CACHE_ENTRIES/,
  );
  assert.match(
    athleteRepository,
    /if \(target === oldestKey\) canonicalSnapshotPointer\.delete\(alias\)/,
  );
});
