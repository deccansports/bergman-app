import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repository = readFileSync(
  new URL("./events.repository.ts", import.meta.url),
  "utf8",
);

test("optional announcements use a bounded network-failure cooldown", () => {
  assert.match(
    repository,
    /PUBLIC_ANNOUNCEMENTS_NETWORK_COOLDOWN_MS = 30 \* 1000/,
  );
  assert.match(repository, /if \(signal\?\.aborted\) throw error/);
  assert.match(repository, /status === 429 \|\| status == null/);
  assert.match(
    repository,
    /lastPublicAnnouncementsResponse = \{ key, value: emptyValue \}/,
  );
});

