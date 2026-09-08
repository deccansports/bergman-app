import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryPath = new URL(
  "../../core/repositories/canonicalTracking.repository.ts",
  import.meta.url,
);
const hookPath = new URL("./hooks/useCanonicalTracking.ts", import.meta.url);

test("removed Feibot scope cannot use build-missing or last-known-course fallbacks", async () => {
  const repository = await readFile(repositoryPath, "utf8");
  assert.match(
    repository,
    /error\.status === 404 &&[\s\S]*error\.state === "no_active_feibot_connection"[\s\S]*reason: "connection_removed"/,
  );
  assert.match(
    repository,
    /error\.state === "no_active_feibot_connection"[\s\S]*lastKnownGoodCourses\.delete\(cacheKey\)[\s\S]*throw error/,
  );
});

test("removed scope evicts persisted and in-memory derived data without clearing the watchlist", async () => {
  const hook = await readFile(hookPath, "utf8");
  assert.match(hook, /unavailableReason === "connection_removed"/);
  assert.match(hook, /AsyncStorage\.removeItem\([\s\S]*participantCacheKey/);
  assert.match(hook, /activeVersions\.delete\(scopeKey\)/);
  assert.match(hook, /queryKey\[0\] === "mobile-live-participant"/);
  assert.match(hook, /queryKey\[1\] === "athlete-search"/);
  assert.doesNotMatch(hook, /account-watchlist/);
});
