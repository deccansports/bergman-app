import assert from "node:assert/strict";
import test from "node:test";

import {
  identityHydrationIndexes,
  TRACKED_IDENTITY_HYDRATION_CONCURRENCY,
  // @ts-expect-error Node strip-types tests require the explicit extension.
} from "./identityHydrationBudget.ts";

test("a large watchlist hydrates only the selected identity", () => {
  assert.equal(TRACKED_IDENTITY_HYDRATION_CONCURRENCY, 1);
  assert.deepEqual(identityHydrationIndexes(23, 5), [5]);
  assert.deepEqual(identityHydrationIndexes(23, -1), []);
});
