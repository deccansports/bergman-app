import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("broadcast polling and render timers stop when the route loses focus", async () => {
  const source = await readFile(
    new URL("./EventBroadcastScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /useEventScreenInitialization/);
  assert.match(source, /refetchInterval: eventScreen\.focused \? 5000 : false/);
  assert.match(source, /refetchIntervalInBackground: false/);
  assert.match(source, /enabled: Boolean\(normalizedEventId && eventScreen\.focused\)/);
  assert.match(source, /if \(!eventScreen\.focused\) return undefined;/);
});
