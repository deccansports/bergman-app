import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("selected legacy rows hydrate before the canonical detail query", async () => {
  const screen = await readFile(
    new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    screen,
    /const selectedIdentityQuery = useQuery\([\s\S]*const resolvedSelectedIdentity = useMemo\([\s\S]*resolvedTrackedAthleteForLiveState\([\s\S]*const selectedDetailAthlete = resolvedSelectedIdentity \?\? undefined/,
  );
  assert.match(screen, /const trackedAthleteLiveQueries = useQueries\(/);
  assert.match(screen, /selectedParticipantUuid/);
});

test("a cached tracked-athlete summary cannot remain behind the loading card", async () => {
  const screen = await readFile(
    new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    screen,
    /const rawDetail = isSelected[\s\S]*const hasRenderableDetail = Boolean\(rawDetail\)/,
  );
  assert.match(
    screen,
    /initialLoading: Boolean\([\s\S]*!sourceHasData &&[\s\S]*!hasRenderableDetail/,
  );
  assert.match(
    screen,
    /const detail = baseDetail;[\s\S]*initialLoading:[\s\S]*detail,/,
  );
});

test("cold exact search is not aborted at the old 3.5 second boundary", async () => {
  const repository = await readFile(
    new URL("../../core/repositories/athlete.repository.ts", import.meta.url),
    "utf8",
  );
  const searchSection = repository.slice(
    repository.indexOf("async search(eventId"),
    repository.indexOf(
      "async getDetail(",
      repository.indexOf("async search(eventId"),
    ),
  );
  assert.match(searchSection, /timeoutMs: 8_000/);
  assert.doesNotMatch(searchSection, /timeoutMs: 3_500/);
});

test("cold canonical athlete detail uses the compact direct Worker endpoint", async () => {
  const repository = await readFile(
    new URL(
      "../../core/repositories/participantLive.repository.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(repository, /\/v1\/live-participant\//);
  assert.match(repository, /const current = inFlight\.get\(cacheKey\)/);
  assert.doesNotMatch(repository, /\/canonical\/athlete/);
});

test("live event supplement uses the existing endpoint instead of a 404 probe", async () => {
  const repository = await readFile(
    new URL("../../core/repositories/events.repository.ts", import.meta.url),
    "utf8",
  );
  assert.match(repository, /`\/api\/events\/\$\{eventId\}\/live`/);
  assert.doesNotMatch(repository, /`\/api\/live\/events\/\$\{eventId\}`/);
});
