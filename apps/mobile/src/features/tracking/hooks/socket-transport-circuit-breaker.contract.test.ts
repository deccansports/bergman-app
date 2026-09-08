import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./canonicalSocketRegistry.ts", import.meta.url),
  "utf8",
);
const policy = await readFile(
  new URL("./socketReconnectPolicy.ts", import.meta.url),
  "utf8",
);

test("unavailable WebSocket transport stops retrying and leaves HTTP fallback active", () => {
  assert.match(policy, /MAX_CONSECUTIVE_TRANSPORT_FAILURES = 3/);
  assert.match(source, /transport_retry_exhausted_http_fallback/);
  assert.match(source, /transport_cooldown_http_fallback/);
  assert.match(policy, /TRANSPORT_FAILURE_COOLDOWN_MS = 60_000/);
  assert.match(
    source,
    /nextSocketReconnectDecision\([\s\S]*entry\.circuit\.probeInFlight/,
  );
  assert.match(source, /connect\(entry, "cooldown_probe"\)/);
  assert.doesNotMatch(source, /cooldown_recovery/);
});

test("an OPEN transport is not considered recovered before traffic proves health", () => {
  const onOpen = source.slice(
    source.indexOf("socket.onopen"),
    source.indexOf("socket.onmessage"),
  );
  const markFresh = source.slice(
    source.indexOf("function markFresh"),
    source.indexOf("function scheduleReconnect"),
  );
  assert.doesNotMatch(onOpen, /circuit\.attempts = 0/);
  assert.match(markFresh, /entry\.circuit\.attempts = 0/);
});

test("foreground, network recovery, and remount cannot bypass cooldown", () => {
  assert.match(
    source,
    /const subscriptionKey = `\$\{input\.eventId\}:\$\{providerEventUuid\}`/,
  );
  assert.match(source, /const transportCircuits = new Map/);
  assert.match(source, /if \(entry\.circuit\.cooldownUntil > now\)/);
  assert.doesNotMatch(source, /transportFailureCooldowns/);
  assert.doesNotMatch(source, /isRecoveryAttempt/);
  assert.match(source, /\[canonical-socket\] CIRCUIT_STATE/);
});
