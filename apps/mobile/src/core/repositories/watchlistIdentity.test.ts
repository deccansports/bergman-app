import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner needs the explicit extension.
import { resolveWatchlistDeleteItemId } from "./watchlistIdentity.ts";

test("BIB 1007 canonical reconciliation still deletes the persisted backend item", () => {
  assert.equal(
    resolveWatchlistDeleteItemId({
      eventId: "tImWYZAi99k8ILwxrTSO",
      athleteId: "canonical-participant-1007",
      watchlistItemId: "tImWYZAi99k8ILwxrTSO:race:4tegxjmx:5jum5wti:1007",
    }),
    "tImWYZAi99k8ILwxrTSO:race:4tegxjmx:5jum5wti:1007",
  );
});

test("new canonical subscriptions retain the deterministic fallback identity", () => {
  assert.equal(
    resolveWatchlistDeleteItemId({
      eventId: "event",
      athleteId: "canonical-participant",
    }),
    "event:canonical-participant",
  );
});
