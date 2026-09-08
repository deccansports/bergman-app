import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const liveScreen = readFileSync(
  resolve(process.cwd(), "src/features/events/components/LiveTrackScreen.tsx"),
  "utf8",
);
const watchlist = readFileSync(
  resolve(
    process.cwd(),
    "src/features/tracking/watchlist/hooks/useWatchlist.ts",
  ),
  "utf8",
);
const repository = readFileSync(
  resolve(
    process.cwd(),
    "src/core/repositories/trackingSubscription.repository.ts",
  ),
  "utf8",
);
const athleteRepository = readFileSync(
  resolve(process.cwd(), "src/core/repositories/athlete.repository.ts"),
  "utf8",
);
const trackedIdentity = readFileSync(
  resolve(
    process.cwd(),
    "src/features/tracking/legacyTrackedAthleteIdentity.ts",
  ),
  "utf8",
);

test("resolved canonical identity remains stable while only the selected row owns full detail", () => {
  assert.doesNotMatch(
    liveScreen,
    /const trackedAthleteDetailQueries = useQueries\(/,
  );
  assert.match(
    liveScreen,
    /const response = trackedAthleteLiveQueries\[index\]\?\.data/,
  );
  assert.match(
    liveScreen,
    /const selectedMappedDetail = useMemo\([\s\S]*mapAthleteDetail\(selectedAthleteResponseWithRanks\)/,
  );
  assert.match(liveScreen, /trackedSummaryDetails\[index\]/);
  assert.match(liveScreen, /participantUuid: selectedParticipantUuid/);
  assert.match(
    liveScreen,
    /providerEventUuid: normalizedSelectedProviderEventUuid/,
  );
});

test("canonical resolution replaces temporary selection and watchlist identities", () => {
  assert.match(liveScreen, /reconcileCanonicalAthlete\(canonical\)/);
  assert.match(
    liveScreen,
    /setSelectedTrackedKey\(stableAthleteKey\(canonical, id\)\)/,
  );
  assert.match(watchlist, /id: participantUuid \|\|/);
  assert.match(watchlist, /watchlistItemId:[\s\S]*persisted\.watchlistItemId/);
});

test("persisted provider identities are revalidated through exact selected-BIB scope resolution", () => {
  assert.match(
    trackedIdentity,
    /const bib = text\(athlete\.bib\);[\s\S]*return \{ value: bib, mode: "bib", kind: "bib" \}/,
  );
  const identityQuery = liveScreen.slice(
    liveScreen.indexOf("const selectedIdentityQuery = useQuery"),
    liveScreen.indexOf("const selectedDetailAthlete"),
  );
  assert.match(identityQuery, /repositories\.athlete\.search/);
  assert.match(
    identityQuery,
    /identityHydrationBudget\.includes\(fullDetailIndex\)/,
  );
  assert.match(identityQuery, /staleTime: 5 \* 60_000/);
  assert.match(identityQuery, /refetchOnMount: false/);
  assert.match(identityQuery, /refetchOnReconnect: false/);
});

test("watchlist removal uses exact backend identity and restores UI on failure", () => {
  assert.match(repository, /resolveWatchlistDeleteItemId\(input\)/);
  assert.match(
    watchlist,
    /await unsubscribeTrackedAthlete\(\s*existing,\s*eventId,?\s*\)/,
  );
  assert.match(watchlist, /storeReplaceAthletes\(before\)/);
  assert.match(liveScreen, /if \(!removed && removingSelected\)/);
  assert.match(
    liveScreen,
    /backendDeleteStatus: removed \? 200 : "failed_or_not_found"/,
  );
  assert.match(liveScreen, /\[tracking-close\]\[REQUEST\]/);
  assert.match(
    liveScreen,
    /onClose=\{\(\) => \{\s*void removeTrackedAthlete\(selectedTrackedRow\.athlete\);\s*\}\}/,
  );
  assert.match(liveScreen, /accessibilityLabel=\{`Untrack \$\{name\}`\}/);
});

test("course scope survives transient identity loss without changing map ownership", () => {
  assert.match(liveScreen, /retainedCourseScopeRef/);
  assert.match(
    liveScreen,
    /candidateContestId \?\? previousScope\?\.contestId/,
  );
  assert.match(
    liveScreen,
    /candidateProviderEventUuid \?\? retainedCourseScope\?\.providerEventUuid/,
  );
  assert.match(liveScreen, /getOrBuildCourseModel\(courseIdentity/);
});

test("accepted finish normalizes nested and top-level lifecycle consistently", () => {
  assert.match(
    athleteRepository,
    /if \(finished\) \{[\s\S]*mergedHotResolvedState\.status = "FINISHED"/,
  );
  assert.match(
    athleteRepository,
    /activeManualTerminalStatus \?\? \(finished \? "FINISHED" : null\)/,
  );
  assert.match(athleteRepository, /status: resultStatus/);
  assert.match(
    liveScreen,
    /\[mobile-live-query\][\s\S]*bib:[\s\S]*participantUuid:/,
  );
});
