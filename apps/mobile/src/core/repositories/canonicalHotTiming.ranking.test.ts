import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner needs the explicit extension.
import { mergeCanonicalSplitsWithHotTiming } from "./canonicalHotTiming.ts";

test("timing-only hot split cannot erase canonical ranking", () => {
  const [merged] = mergeCanonicalSplitsWithHotTiming({
    configuredSplits: [
      {
        splitKey: "run_finish",
        ranking: { overallRank: 2, ageGroupRank: 1 },
        overallRank: 2,
      },
    ],
    hotSplits: [
      {
        splitKey: "run_finish",
        status: "COMPLETED",
        accepted: true,
        readAt: "2026-08-30T18:59:55+05:30",
        ranking: null,
        overallRank: null,
      },
    ],
  });
  assert.equal(merged.overallRank, 2);
  assert.deepEqual(merged.ranking, { overallRank: 2, ageGroupRank: 1 });
});

test("newer positive hot ranking may advance the canonical projection", () => {
  const [merged] = mergeCanonicalSplitsWithHotTiming({
    configuredSplits: [{ splitKey: "run_finish", ranking: { overallRank: 2 } }],
    hotSplits: [{ splitKey: "run_finish", ranking: { overallRank: 3 } }],
  });
  assert.equal((merged.ranking as Record<string, unknown>).overallRank, 3);
  assert.equal(merged.overallRank, 3);
});
