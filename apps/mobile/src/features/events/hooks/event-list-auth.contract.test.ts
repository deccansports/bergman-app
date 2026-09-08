import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const hooks = read("./useEvents.ts");
const repository = read("../../../core/repositories/events.repository.ts");
const firebase = read("../../../core/auth/firebase.ts");
const client = read("../../../core/services/api/client.ts");

test("authenticated event list waits for a restored bearer token", () => {
  assert.match(hooks, /const accessToken = useSession/);
  assert.match(
    hooks,
    /sessionStatus === "authenticated" && Boolean\(accessToken\)/,
  );
});

test("Android cold restore can use the cached Firebase-derived bearer", () => {
  assert.match(firebase, /const session = useSession\.getState\(\)/);
  assert.match(
    firebase,
    /session\.status === ['"]authenticated['"] \? session\.accessToken : null/,
  );
  assert.match(
    client,
    /if \(refreshedToken\) return withToken\(refreshedToken\)/,
  );
});

test("authenticated event list verifies network before account cache", () => {
  const preferNetwork = repository.indexOf("if (options?.preferNetwork)");
  const cachedReturn = repository.indexOf("if (cachedEvents.length > 0)");
  assert(preferNetwork >= 0);
  assert(cachedReturn > preferNetwork);
  assert.match(
    repository,
    /if \(options\?\.preferNetwork\) \{[\s\S]*await networkRequest;[\s\S]*writeCachedEventList\(events, cacheScope\)/,
  );
});
