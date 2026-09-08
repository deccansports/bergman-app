import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repository = readFileSync(
  new URL("../../core/repositories/athlete.repository.ts", import.meta.url),
  "utf8",
);
const hooks = readFileSync(
  new URL("./hooks/useTrackingQueries.ts", import.meta.url),
  "utf8",
);
const screen = readFileSync(
  new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);

test("live search uses the authoritative App Hosting endpoint without a failed edge probe", () => {
  assert.doesNotMatch(
    repository,
    /api\.bergmantri\.com\/v1\/events\/.*\/search/,
  );
  assert.match(repository, /\/api\/live\/events\/.*\/search/);
});

test("remote search waits for a useful query and live tracking debounces typing", () => {
  assert.match(hooks, /mode === "bib"[\s\S]*value\.length >= 3/);
  assert.match(hooks, /queryReady &&[\s\S]*resolvedSource === "live"/);
  assert.match(screen, /useDebouncedValue\(search, 350\)/);
  assert.match(
    screen,
    /onSubmitEditing=\{\(\) =>\s*setSubmittedSearch\(search\.trim\(\)\)/,
  );
  assert.match(
    repository,
    /params: \{ q, mode: inferredMode, kvOnly: 1 \},[\s\S]*signal,/,
  );
  assert.match(
    repository,
    /athleteSearchSingleFlightKey\([\s\S]*"event-wide",[\s\S]*true/,
  );
});

test("numeric local search is exact and selection has one coordinated detail owner", () => {
  assert.match(
    screen,
    /normalizeBib\(athlete\.bib \?\? athlete\.bibNumber\) === normalizeBib\(query\)/,
  );
  assert.equal(
    (screen.match(/const selectedAthleteQuery = useQuery(?:<[^>]+>)?\(/g) ?? [])
      .length,
    1,
  );
  assert.match(screen, /createSelectedAthleteRequestCoordinator/);
  assert.match(
    screen,
    /selectedAthleteResponseWithRanks &&[\s\S]*!selectedAthleteQuery\.isPlaceholderData/,
  );
});
