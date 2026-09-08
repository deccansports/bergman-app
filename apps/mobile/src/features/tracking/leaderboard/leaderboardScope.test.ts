import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeLeaderboardScopes,
  resolveCanonicalContestUuid,
} from "./leaderboardScope";

const eventId = "4cEm8JPYbpupoFRMDLc1";
const payload = {
  importedContests: [
    {
      feibotEventUuid: "6QTff6CR",
      feibotContestUuid: "k9jmBOom",
      feibotContestName: "Bergman 102 Triathlon",
    },
    {
      feibotEventUuid: "6QTff6CR",
      feibotContestUuid: "6mDRe5lS",
      canonicalContestUuid: "4QZknKwP",
      feibotContestName: "Bergman Olympic Triathlon",
    },
    {
      feibotEventUuid: "1xajVfM0",
      feibotContestUuid: "4FgqiHGd",
      feibotContestName: "Bergman Swimathon Blr - 1 Km",
    },
  ],
};

test("Bengaluru leaderboard scopes preserve provider and canonical contest identity", () => {
  const scopes = normalizeLeaderboardScopes(eventId, payload);
  assert.deepEqual(
    scopes.map((scope) => [
      scope.providerEventUuid,
      scope.requestedContestUuid,
      scope.canonicalContestUuid,
    ]),
    [
      ["6QTff6CR", "k9jmBOom", "k9jmBOom"],
      ["6QTff6CR", "6mDRe5lS", "4QZknKwP"],
      ["1xajVfM0", "4FgqiHGd", "4FgqiHGd"],
    ],
  );
});

test("canonical contest identity comes from authoritative scope data", () => {
  assert.equal(
    resolveCanonicalContestUuid(eventId, "6QTff6CR", "6mdre5ls", "4QZknKwP"),
    "4QZknKwP",
  );
  assert.equal(
    resolveCanonicalContestUuid("another-event", "6QTff6CR", "6mdre5ls"),
    "6mdre5ls",
  );
  assert.equal(
    resolveCanonicalContestUuid(eventId, "1xajVfM0", "6mdre5ls"),
    "6mdre5ls",
  );
});

test("event context contests are preferred without a mapping request", () => {
  const scopes = normalizeLeaderboardScopes(eventId, {
    contests: [
      {
        providerEventUuid: "1xajVfM0",
        providerContestUuid: "4FgqiHGd",
        canonicalContestUuid: "4FgqiHGd",
        name: "1 Km Swimathon",
      },
    ],
  });
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0]?.resolutionSource, "event_context");
  assert.equal(scopes[0]?.providerEventUuid, "1xajVfM0");
});

test("public canonical course-index scopes resolve every contest without admin auth", () => {
  const scopes = normalizeLeaderboardScopes(eventId, {
    success: true,
    eventId,
    providerEventUuid: "6ueOOKHs",
    contests: [
      {
        providerEventUuid: "6ueOOKHs",
        providerContestUuid: "1QkaizPT",
        displayName: "Bergman Swimathon Blr - Kids 500 Mtrs",
      },
      {
        providerEventUuid: "6ueOOKHs",
        providerContestUuid: "7Yc3etJU",
        displayName: "Bergman Swimathon Blr - 4 Km",
      },
    ],
  });

  assert.deepEqual(
    scopes.map((scope) => [
      scope.providerEventUuid,
      scope.canonicalContestUuid,
      scope.resolutionSource,
    ]),
    [
      ["6ueOOKHs", "1QkaizPT", "canonical_course_index"],
      ["6ueOOKHs", "7Yc3etJU", "canonical_course_index"],
    ],
  );
});

test("switching 102 to Olympic to Swimathon never mixes provider scope", () => {
  const scopes = normalizeLeaderboardScopes(eventId, payload);
  const sequence = [scopes[0], scopes[1], scopes[2], scopes[0]];
  assert.deepEqual(
    sequence.map(
      (scope) => `${scope?.providerEventUuid}:${scope?.canonicalContestUuid}`,
    ),
    [
      "6QTff6CR:k9jmBOom",
      "6QTff6CR:4QZknKwP",
      "1xajVfM0:4FgqiHGd",
      "6QTff6CR:k9jmBOom",
    ],
  );
});

test("invalid or incomplete mapping rows keep the query genuinely unresolved", () => {
  assert.deepEqual(normalizeLeaderboardScopes(eventId, {}), []);
  assert.deepEqual(
    normalizeLeaderboardScopes(eventId, {
      importedContests: [{ feibotContestUuid: "k9jmBOom" }],
    }),
    [],
  );
});
