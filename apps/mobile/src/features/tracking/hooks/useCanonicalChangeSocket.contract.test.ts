import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mobile canonical stream targets existing React Query keys and reconciles lifecycle changes", async () => {
  const source = await readFile(
    new URL("./useCanonicalChangeSocket.ts", import.meta.url),
    "utf8",
  );
  const registry = await readFile(
    new URL("./canonicalSocketRegistry.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    registry,
    /new WebSocket\([\s\S]*socketUrl\(entry\.eventId, entry\.providerEventUuid\)/,
  );
  assert.match(
    registry,
    /providerEventUuid=.*encodeURIComponent\(providerEventUuid\)/,
  );
  assert.match(registry, /AppState\.addEventListener\([\s\S]*["']change["']/);
  assert.match(source, /queryKeys\.canonicalAthlete\([\s\S]*participantUuid/);
  assert.match(source, /["']tracking["'], ["']leaderboard["'], eventId/);
  assert.match(source, /queryKeys\.canonical\.availability\(eventId\)/);
  assert.match(registry, /socket\.onclose = null/);
  assert.match(registry, /entry\.socket !== socket/);
  assert.match(source, /exact: true,[\s\S]*refetchType: ["']none["']/);
  assert.match(registry, /sequence <= entry\.lastSequence/);
  assert.match(source, /change\.type === ["']participant_changed["']/);
  assert.match(source, /queryClient\.setQueriesData/);
  assert.match(source, /patchParticipantLive/);
  assert.match(source, /SOCKET_PARTICIPANT_CHANGE/);
  assert.match(source, /NETWORK_RECOVERY/);
  assert.doesNotMatch(source, /SOCKET_RECOVERY/);
  assert.match(registry, /isSocketHeartbeatFresh/);
  for (const lifecycle of [
    "SOCKET_CONNECTING",
    "SOCKET_CONNECTED",
    "SOCKET_HEARTBEAT",
    "SOCKET_DEGRADED",
    "SOCKET_RECONNECTING",
    "SOCKET_CLOSED",
  ]) {
    assert.match(registry, new RegExp(lifecycle));
  }
  assert.match(registry, /lastHeartbeatAt/);
  assert.match(registry, /lastMessageAt/);
  assert.match(source, /normalizedProviderEventUuid/);
  assert.match(source, /const optionsRef = useRef\(options\)/);
  assert.match(source, /leaseRef\.current\?\.updateParticipantUuid/);
  assert.doesNotMatch(source, /new WebSocket/);
  assert.doesNotMatch(
    source,
    /\[\s*enabled,[\s\S]*queryClient,[\s\S]*selectedParticipantUuid[\s\S]*\]\);/,
  );
});

test("socket heartbeat updates health only and owns no network invalidation", async () => {
  const source = await readFile(
    new URL("./useCanonicalChangeSocket.ts", import.meta.url),
    "utf8",
  );
  const registry = await readFile(
    new URL("./canonicalSocketRegistry.ts", import.meta.url),
    "utf8",
  );
  const heartbeat = registry.match(
    /if \(message\.data === "pong"\) \{([\s\S]*?)\n\s*\}/,
  );
  assert.ok(heartbeat);
  assert.match(heartbeat[1], /markFresh\(entry, "heartbeat"\)/);
  assert.match(heartbeat[1], /return/);
  assert.doesNotMatch(
    heartbeat[1],
    /invalidate|refetch|watchlist|athlete-detail|proxy-gpx|fetch\(/i,
  );
  assert.match(registry, /if \(!entry\.needsRecovery\) return;/);
});
