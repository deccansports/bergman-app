import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("signed-in watchlist mutations do not fail when optional device identity storage is unavailable", async () => {
  const source = await readFile(
    new URL("./trackingSubscription.repository.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /async function optionalPushDeviceId\(\): Promise<string \| undefined> \{[\s\S]*try \{[\s\S]*getPersistedPushDeviceId\(\)[\s\S]*\} catch \{[\s\S]*return undefined;/);
  assert.match(source, /const deviceId = await optionalPushDeviceId\(\);/);
  assert.match(source, /\.\.\.\(deviceId \? \{ deviceId \} : \{\}\)/);
  assert.match(source, /const deviceQuery = deviceId[\s\S]*\? `\?deviceId=\$\{encodeURIComponent\(deviceId\)\}`[\s\S]*: ""/);
});
