import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../../../../", import.meta.url);

async function sources() {
  return Promise.all([
    readFile(
      new URL("src/lib/feibot-integration/live-timing-worker.ts", root),
      "utf8",
    ),
    readFile(
      new URL("cloudflare/live-tracking-worker/src/index.ts", root),
      "utf8",
    ),
    readFile(
      new URL(
        "apps/mobile/src/features/tracking/hooks/useCanonicalChangeSocket.ts",
        root,
      ),
      "utf8",
    ),
    readFile(
      new URL("apps/mobile/src/core/repositories/course.repository.ts", root),
      "utf8",
    ),
  ]);
}

test("A/B/E: one timing read uses one participant delta without course or participant-index invalidation", async () => {
  const [ingestion, , socket, course] = await sources();
  assert.match(
    ingestion,
    /const scopedLiveKey = \(suffix: string\) =>[\s\S]*providerScopedLiveKey\(eventId, providerEventUuid, suffix\)/,
  );
  assert.match(ingestion, /scopedLiveKey\(`participantLive:/);
  assert.match(ingestion, /\[HOT PARTICIPANT CHANGE PUBLISHED\]/);
  assert.match(socket, /queryClient\.setQueriesData/);
  assert.match(
    socket,
    /if \(change\.type === ["']canonical_change["']\)[\s\S]*canonical\.availability/,
  );
  assert.match(
    socket,
    /change\.type === ["']leaderboard_changed["'][\s\S]*change\.type === ["']canonical_change["'][\s\S]*canonical-live-rankings/,
  );
  assert.match(
    socket,
    /change\.contestUuid && change\.type !== ["']participant_changed["']/,
  );
  assert.match(course, /PROVIDER_EVENT_UUID_REQUIRED/);
  assert.doesNotMatch(course, /if \(providerEventUuid\) throw error/);
  assert.match(ingestion, /feibot_processed_published_atomically/);
});

test("G: every Feibot mutable race artifact is UUID scoped and unchanged athletes do not write", async () => {
  const [ingestion] = await sources();
  for (const suffix of [
    "provider:live-results",
    "participant:index",
    "split:index",
    "leg:index",
    "course:index",
    "result:index",
    "results",
    "leaderboard",
    "athletes",
    "participantLive:index",
    "timingReads",
    "monitoring",
    "provider:processed-timing-audit",
  ]) {
    assert.doesNotMatch(
      ingestion,
      new RegExp(
        `live:event:\\\$\\{eventId\\}:${suffix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`,
      ),
    );
  }
  assert.match(
    ingestion,
    /providerEventUuid is required for Feibot live timing/,
  );
  assert.match(
    ingestion,
    /\[PARTICIPANTLIVE UNCHANGED\][\s\S]*participantLiveWrites: 0[\s\S]*websocketPublishes: 0/,
  );
  assert.doesNotMatch(
    ingestion,
    /fetchLiveResultsByBibs\(\{[\s\S]*bibs,[\s\S]*\}\)/,
  );
  assert.doesNotMatch(
    ingestion,
    /fetchFinishResultsByBibs\(\{[\s\S]*bibs,[\s\S]*\}\)/,
  );
  assert.doesNotMatch(
    ingestion,
    /scopedLiveKey\(["']athletes["']\)/,
    "live timing must not rebuild a provider-wide athlete payload after a participant update",
  );
});

test("H: Bengaluru Triathlon and Swimathon resolve to disjoint mutable namespaces", async () => {
  const keys = await readFile(
    new URL("packages/live-tracking-contracts/src/storage-keys.ts", root),
    "utf8",
  );
  assert.match(
    keys,
    /return `\$\{eventPrefix\(eventId\)\}:feibot:\$\{safeSegment\(providerEventUuid, 'providerEventUuid'\)\}:\$\{normalizedSuffix\}`/,
  );
  const eventId = "4cEm8JPYbpupoFRMDLc1";
  const scoped = (providerEventUuid: string) =>
    `live:event:${eventId}:feibot:${providerEventUuid}:participantLive:index`;
  const triathlon = scoped("6QTff6CR");
  const swimathon = scoped("1xajVfM0");
  assert.equal(
    triathlon,
    "live:event:4cEm8JPYbpupoFRMDLc1:feibot:6QTff6CR:participantLive:index",
  );
  assert.equal(
    swimathon,
    "live:event:4cEm8JPYbpupoFRMDLc1:feibot:1xajVfM0:participantLive:index",
  );
  assert.notEqual(triathlon, swimathon);
});

test("C/D: baseline cache is build-version keyed while genuine canonical changes reconcile it", async () => {
  const [cache, socket] = await Promise.all([
    readFile(
      new URL(
        "apps/mobile/src/features/tracking/hooks/useCanonicalTracking.ts",
        root,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "apps/mobile/src/features/tracking/hooks/useCanonicalChangeSocket.ts",
        root,
      ),
      "utf8",
    ),
  ]);
  assert.match(cache, /bergman:canonical-participants:.*activeVersion/);
  assert.ok(
    cache.indexOf("AsyncStorage.getItem(storageKey)") <
      cache.indexOf("CanonicalTrackingRepository.getCanonicalParticipants"),
  );
  assert.match(socket, /change\.type === ["']canonical_change["']/);
  assert.match(socket, /queryKeys\.canonical\.availability\(eventId\)/);
});

test("F: WebSocket and hot state retain exact Feibot UUID isolation", async () => {
  const [ingestion, worker, socket] = await sources();
  const socketRegistry = await readFile(
    new URL(
      "apps/mobile/src/features/tracking/hooks/canonicalSocketRegistry.ts",
      root,
    ),
    "utf8",
  );
  assert.match(worker, /canonicalCoordinatorName\(eventId, eventUuid\)/);
  assert.match(
    socketRegistry,
    /normalizeProviderEventUuid\(change\.providerEventUuid\) !==[\s\S]*entry\.providerEventUuid/,
  );
  assert.match(
    socketRegistry,
    /providerEventUuid=.*encodeURIComponent\(providerEventUuid\)/,
  );
  assert.match(ingestion, /providerEventUuid,/);
});
