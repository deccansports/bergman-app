import assert from "node:assert/strict";
import test from "node:test";

import {
  hasAcceptedSplitEvidence,
  // @ts-expect-error Node strip-types requires an explicit extension.
} from "./acceptedSplitEvidence.ts";

test("pre-start scheduled Start is not accepted timing evidence", () => {
  assert.equal(
    hasAcceptedSplitEvidence({
      splitKey: "start",
      status: "COMPLETED",
      accepted: false,
      readAt: "2026-09-06T03:00:00.000Z",
    }),
    false,
  );
});

test("a timestamp without canonical acceptance is not timing evidence", () => {
  assert.equal(
    hasAcceptedSplitEvidence({
      splitKey: "start",
      readAt: "2026-09-06T03:00:00.000Z",
    }),
    false,
  );
});

test("an accepted canonical read counts exactly once", () => {
  assert.equal(
    hasAcceptedSplitEvidence({
      splitKey: "start",
      status: "VALID",
      accepted: true,
      readAt: "2026-09-06T03:00:04.000Z",
    }),
    true,
  );
});
