import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner needs the extension.
import { resolveCanonicalCutoffPresentation } from "./canonicalCutoff.ts";

test("countdown crossing zero honors mat grace then mirrors canonical auto cutoff", () => {
  const cutoff = {
    deadlineAt: Date.parse("2026-09-03T10:00:00.000Z"),
    checkpointLabel: "Bike 80 Km",
    state: "SAFE" as const,
  };
  assert.deepEqual(
    resolveCanonicalCutoffPresentation(
      cutoff,
      Date.parse("2026-09-03T08:47:17.000Z"),
    ),
    { remainingSeconds: 4_363, label: "CUTOFF IN 01:12:43", confirmed: false },
  );
  assert.deepEqual(
    resolveCanonicalCutoffPresentation(
      cutoff,
      Date.parse("2026-09-03T10:00:01.000Z"),
    ),
    { remainingSeconds: -1, label: "MAT GRACE 00:01:59", confirmed: false },
  );
  assert.deepEqual(
    resolveCanonicalCutoffPresentation(
      cutoff,
      Date.parse("2026-09-03T10:02:00.000Z"),
    ),
    { remainingSeconds: -120, label: "CUTOFF", confirmed: true },
  );
});

test("canonical confirmation renders CUTOFF immediately", () => {
  const result = resolveCanonicalCutoffPresentation(
    {
      deadlineAt: Date.parse("2026-09-03T10:00:00.000Z"),
      checkpointLabel: "Bike 80 Km",
      state: "CONFIRMED_CUTOFF",
    },
    Date.parse("2026-09-03T10:00:01.000Z"),
  );
  assert.equal(result.confirmed, true);
  assert.equal(result.label, "CUTOFF");
});
