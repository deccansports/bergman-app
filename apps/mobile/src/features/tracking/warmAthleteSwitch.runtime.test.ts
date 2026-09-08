import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient } from "@tanstack/react-query";

import {
  requiresLegacyIdentityLookup,
  responseMatchesSelectedParticipant,
} from "./trackingSelection";

const EVENT_ID = "event-runtime";
const PROVIDER_EVENT_UUID = "provider-runtime";
const participantIds = Array.from(
  { length: 6 },
  (_, index) => `participant-${index + 1}`,
);

const mobileLiveKey = (participantUuid: string) => [
  "mobile-live-participant",
  EVENT_ID,
  PROVIDER_EVENT_UUID,
  participantUuid,
  "v1",
  "live",
];

const snapshot = (participantUuid: string, revision = 0) => ({
  athlete: { participantUuid },
  canonicalBuildVersion: "stable-build",
  timingVersion: 0,
  liveRevision: revision,
});

test("thirty warm arrow switches across six cached participants perform no selection reads", async () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: 10 * 60_000,
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
  let mobileLiveReads = 0;
  let identityDerivations = 0;
  let socketCreates = 0;
  let socketCloses = 0;
  let gpxRequests = 0;
  let gpxParses = 0;

  for (const participantUuid of participantIds) {
    client.setQueryData(
      mobileLiveKey(participantUuid),
      snapshot(participantUuid),
    );
  }

  for (let index = 0; index < 30; index += 1) {
    const participantUuid = participantIds[index % participantIds.length];
    if (requiresLegacyIdentityLookup(participantUuid)) identityDerivations += 1;
    const selected = await client.fetchQuery({
      queryKey: mobileLiveKey(participantUuid),
      staleTime: Infinity,
      queryFn: async () => {
        mobileLiveReads += 1;
        return snapshot(participantUuid);
      },
    });
    assert.equal(selected.athlete.participantUuid, participantUuid);
  }

  assert.equal(mobileLiveReads, 0);
  assert.equal(identityDerivations, 0);
  assert.equal(socketCreates, 0);
  assert.equal(socketCloses, 0);
  assert.equal(gpxRequests, 0);
  assert.equal(gpxParses, 0);
  client.clear();
});

test("one hundred next and previous switches use constant-time cached selection", () => {
  const rows = participantIds.map((participantUuid) => ({ participantUuid }));
  const indexByParticipant = new Map(
    rows.map((row, index) => [row.participantUuid, index]),
  );
  let selectedParticipantUuid = participantIds[0];
  let identityDerivations = 0;
  let timelineBuilds = 0;
  let courseBuilds = 0;
  let arrayScans = 0;
  const startedAt = performance.now();

  for (let switchIndex = 0; switchIndex < 100; switchIndex += 1) {
    const currentIndex = indexByParticipant.get(selectedParticipantUuid);
    assert.notEqual(currentIndex, undefined);
    const direction = switchIndex < 50 ? 1 : -1;
    const nextIndex =
      ((currentIndex as number) + direction + rows.length) % rows.length;
    selectedParticipantUuid = rows[nextIndex].participantUuid;
    assert.equal(
      indexByParticipant.get(selectedParticipantUuid),
      nextIndex,
    );
  }

  const durationMs = performance.now() - startedAt;
  assert.equal(identityDerivations, 0);
  assert.equal(timelineBuilds, 0);
  assert.equal(courseBuilds, 0);
  assert.equal(arrayScans, 0);
  assert.ok(durationMs < 150, `warm selection took ${durationMs} ms`);
  assert.equal(selectedParticipantUuid, participantIds[0]);
});

test("one cold participant selection performs exactly one participant-scoped read", async () => {
  const client = new QueryClient();
  const participantUuid = "participant-cold";
  let mobileLiveReads = 0;
  let activeRequests = 0;
  let maximumConcurrentRequests = 0;
  const select = () =>
    client.fetchQuery({
      queryKey: mobileLiveKey(participantUuid),
      staleTime: Infinity,
      queryFn: async () => {
        mobileLiveReads += 1;
        activeRequests += 1;
        maximumConcurrentRequests = Math.max(
          maximumConcurrentRequests,
          activeRequests,
        );
        await Promise.resolve();
        activeRequests -= 1;
        return snapshot(participantUuid);
      },
    });

  const [first, second] = await Promise.all([select(), select()]);
  assert.equal(mobileLiveReads, 1);
  assert.equal(maximumConcurrentRequests, 1);
  assert.strictEqual(first, second);
  client.clear();
});

test("a late previous-athlete response cannot become the selected athlete", () => {
  const selectedParticipantUuid = "participant-2";
  assert.equal(
    responseMatchesSelectedParticipant(
      "participant-1",
      selectedParticipantUuid,
    ),
    false,
  );
  assert.equal(
    responseMatchesSelectedParticipant(
      "PARTICIPANT-2",
      selectedParticipantUuid,
    ),
    true,
  );
});

test("a participant-scoped socket revision can refresh only the affected cached participant", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const affectedParticipantUuid = participantIds[1];
  let affectedReads = 0;
  let unrelatedReads = 0;

  for (const participantUuid of participantIds) {
    client.setQueryData(
      mobileLiveKey(participantUuid),
      snapshot(participantUuid),
    );
  }
  await client.invalidateQueries({
    queryKey: mobileLiveKey(affectedParticipantUuid),
    exact: true,
    refetchType: "none",
  });

  const affected = await client.fetchQuery({
    queryKey: mobileLiveKey(affectedParticipantUuid),
    staleTime: 0,
    queryFn: async () => {
      affectedReads += 1;
      return snapshot(affectedParticipantUuid, 1);
    },
  });
  const unrelated = await client.fetchQuery({
    queryKey: mobileLiveKey(participantIds[0]),
    staleTime: Infinity,
    queryFn: async () => {
      unrelatedReads += 1;
      return snapshot(participantIds[0], 1);
    },
  });

  assert.equal(affectedReads, 1);
  assert.equal(affected.liveRevision, 1);
  assert.equal(unrelatedReads, 0);
  assert.equal(unrelated.athlete.participantUuid, participantIds[0]);
  client.clear();
});
