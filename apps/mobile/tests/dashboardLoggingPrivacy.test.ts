import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/core/repositories/mobile.repository.ts", import.meta.url),
  "utf8",
);

test("dashboard development logging never prints the raw or mapped profile payload", () => {
  assert.doesNotMatch(
    source,
    /debugModel\(["']\[mobile\.repository\] \/api\/dashboard["']/,
  );
  assert.match(source, /debugDashboardSummary\(dashboard\)/);
});

test("dashboard summary is restricted to aggregate counts and presence flags", () => {
  const summary = source.match(
    /function debugDashboardSummary[\s\S]*?\n}\n/,
  )?.[0];

  assert.ok(summary);
  assert.doesNotMatch(
    summary,
    /dashboard\.(?:athlete\?\.)?(?:email|mobile|phone|name|address|photo|profile|bib|bookingId)\b/i,
  );
  assert.match(summary, /registrationCount/);
  assert.match(summary, /recentResultCount/);
  assert.match(summary, /liveRaceStatusPresent/);
});
