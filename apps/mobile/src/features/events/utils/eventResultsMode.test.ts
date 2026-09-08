import assert from "node:assert/strict";
import test from "node:test";

import { eventUsesResultsMode } from "./eventResultsMode";

test("completed events use official results for leaderboard and tracked athletes", () => {
  assert.equal(eventUsesResultsMode("completed"), true);
  assert.equal(eventUsesResultsMode("upcoming", { status: "COMPLETED" }), true);
});

test("published result flags use results mode even when event status is stale", () => {
  assert.equal(eventUsesResultsMode("live", { resultsPublished: true }), true);
});

test("live and upcoming events remain on canonical live timing", () => {
  assert.equal(eventUsesResultsMode("live"), false);
  assert.equal(eventUsesResultsMode("upcoming"), false);
});
