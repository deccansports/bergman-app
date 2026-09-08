import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("restricted event detail uses optional Firebase authentication and auth failures remain non-retrying", async () => {
  const [repository, hook, client] = await Promise.all([
    readFile(
      new URL(
        "../../../core/repositories/events.repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("./useEvents.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../../core/services/api/client.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    repository,
    /fetchEventDetailNetwork = createSingleFlight\([\s\S]*liveApi\.json<[\s\S]*`\/api\/events\/\$\{eventId\}`/,
  );
  assert.match(
    hook,
    /return !\[401, 403, 404\]\.includes\(status \?\? -1\) && failureCount < 2/,
  );
  assert.match(client, /token && status === 401/);
  assert.doesNotMatch(client, /status === 401 \|\| status === 403/);
});
