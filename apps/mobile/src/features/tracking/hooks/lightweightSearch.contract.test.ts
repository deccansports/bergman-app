import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

test("mobile public search requests the lightweight KV projection", () => {
  const repository = read("../../../core/repositories/athlete.repository.ts");
  assert.match(repository, /kvOnly:\s*1/);
});

test("watchlist GET does not rebuild watcher indexes", () => {
  const route = read("../../../../../../cloudflare/bergman-mobile-api/src/routes/watchlist.ts");
  const getHandler = route.match(/watchlistRoutes\.get\([\s\S]*?\n\}\);/);
  assert.ok(getHandler);
  assert.doesNotMatch(getHandler[0], /refreshWatcherIndex|synchronizeWatcherIndex/);
  assert.match(getHandler[0], /lookupCount:\s*1/);
});

test("legacy tracking roster has no participant timing fanout on its active path", () => {
  const route = read("../../../../../../src/app/api/events/[eventId]/tracking/route.ts");
  const lightweightBlock = route.match(/This endpoint is a lightweight discovery roster[\s\S]*?return new Response\(body/);
  assert.ok(lightweightBlock);
  assert.match(lightweightBlock[0], /timingLookupMs:\s*0/);
  assert.match(lightweightBlock[0], /let kvReadCount = 0/);
  assert.match(lightweightBlock[0], /providerParticipants/);
  assert.doesNotMatch(lightweightBlock[0], /loadParticipantTiming|timingByIndex/);
});
