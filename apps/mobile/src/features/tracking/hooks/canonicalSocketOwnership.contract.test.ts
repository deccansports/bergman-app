import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hook = await readFile(
  new URL("./useCanonicalChangeSocket.ts", import.meta.url),
  "utf8",
);
const registry = await readFile(
  new URL("./canonicalSocketRegistry.ts", import.meta.url),
  "utf8",
);
const track = await readFile(
  new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);
const leaders = await readFile(
  new URL("../leaderboard/components/LeaderboardScreen.tsx", import.meta.url),
  "utf8",
);

test("initial live tracking mount acquires one provider-scoped socket", () => {
  assert.match(
    registry,
    /const socketRegistry = new Map<string, RegistryEntry>/,
  );
  assert.match(registry, /connect\(entry, "initial"\)/);
  assert.match(registry, /entry\.socket &&[\s\S]*WebSocket\.CONNECTING/);
});

test("selected participant is mutable message-filter state, not transport identity", () => {
  assert.match(hook, /leaseRef\.current\?\.updateParticipantUuid/);
  assert.match(
    hook,
    /\[enabled, eventId, normalizedProviderEventUuid, queryClient\]/,
  );
  assert.doesNotMatch(
    hook,
    /\[enabled, eventId, normalizedProviderEventUuid, queryClient, options\.selectedParticipantUuid\]/,
  );
});

test("twenty arrow selections update the filter without creating a socket", () => {
  const update = registry.slice(
    registry.indexOf("updateParticipantUuid(participantUuid?: string)"),
    registry.indexOf('release(reason = "effect_disposed")'),
  );
  assert.match(update, /current\.participantUuid =/);
  assert.doesNotMatch(update, /connect\(|new WebSocket|closeSocket/);
});

test("card minimized, hidden, and restored are absent from socket dependencies", () => {
  assert.doesNotMatch(
    hook,
    /athleteExpanded|card|compact|hidden|trackedCount|minimized/i,
  );
});

test("Track and Leaders retain ownership while sibling event tabs are blurred", () => {
  assert.match(
    track,
    /useCanonicalChangeSocket\([\s\S]*eventScreen\.queryEnabled/,
  );
  assert.match(
    leaders,
    /useCanonicalChangeSocket\([\s\S]*eventScreen\.queryEnabled[\s\S]*isLive/,
  );
});

test("leaderboard selection and contest changes do not define socket identity", () => {
  const call = leaders.slice(
    leaders.indexOf("const canonicalSocket = useCanonicalChangeSocket"),
    leaders.indexOf("const scopedFilters"),
  );
  assert.match(call, /id,[\s\S]*leaderboardProviderEventUuid/);
  assert.doesNotMatch(
    call,
    /leaderboardContestUuid|contestKey|selectedSplitKey/,
  );
});

test("provider and event changes remain transport dependencies", () => {
  assert.match(
    hook,
    /\[enabled, eventId, normalizedProviderEventUuid, queryClient\]/,
  );
  assert.match(
    registry,
    /const subscriptionKey = `\$\{input\.eventId\}:\$\{providerEventUuid\}`/,
  );
});

test("multiple consumers attach by ref count and cannot create parallel sockets", () => {
  assert.match(
    registry,
    /entry\.consumers\.set\(input\.consumerId, consumer\)/,
  );
  assert.match(
    registry,
    /entry\.socket &&[\s\S]*entry\.socket\.readyState === WebSocket\.OPEN[\s\S]*entry\.socket\.readyState === WebSocket\.CONNECTING/,
  );
  assert.match(registry, /return;/);
});

test("one consumer cannot close a socket still owned by another", () => {
  assert.match(
    registry,
    /if \(entry\.consumers\.size > 0\) \{[\s\S]*logDisposeDecision\(entry, false, "remaining_consumers"\)[\s\S]*return;/,
  );
});

test("final release closes exactly through the final-consumer decision", () => {
  assert.match(registry, /CANONICAL_SOCKET_RELEASE_GRACE_MS = 1_000/);
  assert.match(registry, /disposeEntry\(entry, "final_consumer_released"\)/);
  assert.match(registry, /if \(entry\.disposed\) return;/);
});

test("unhealthy transport still uses the bounded reconnect circuit", () => {
  assert.match(registry, /nextSocketReconnectDecision/);
  assert.match(registry, /transport_retry_exhausted_http_fallback/);
  assert.match(registry, /scheduleCooldownProbe\(entry\)/);
});

test("owner and disposal logs expose ref-count decisions", () => {
  assert.match(registry, /\[CANONICAL_SOCKET_OWNER\]/);
  assert.match(
    registry,
    /consumerId,[\s\S]*refCount:[\s\S]*participantUuid:[\s\S]*reason/,
  );
  assert.match(registry, /\[CANONICAL_SOCKET_DISPOSE_DECISION\]/);
  assert.match(registry, /remainingConsumers:[\s\S]*closeSocket,[\s\S]*reason/);
});
