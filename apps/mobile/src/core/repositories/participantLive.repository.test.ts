import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PARTICIPANT_LIVE_CACHE_ENTRIES,
  compareParticipantLiveVersions,
  getParticipantLive,
  participantLiveAsCanonicalEnvelope,
  participantLiveRepositoryCacheKeysForTests,
  resetParticipantLiveRepositoryForTests,
} from "./participantLive.repository";

const participant = {
  schemaVersion: 1 as const,
  eventId: "event-1",
  providerEventUuid: "ProviderABC",
  participantUuid: "race:providerabc:contest:4121",
  providerParticipantUuid: "p-1",
  contestUuid: "contest",
  providerContestUuid: "contest",
  bib: "4121",
  displayName: "Athlete",
  ageGroup: "31-40",
  visibility: "PUBLIC" as const,
  status: "ON_COURSE",
  eventTimezone: "Asia/Kolkata",
  serverNow: "2026-09-03T10:10:00.000Z",
  gunStartAt: null,
  chipStartAt: null,
  waveStartAt: null,
  acceptedStartAt: null,
  officialStartAt: null,
  finishAt: null,
  currentLeg: "swim",
  currentSectionKey: "swim",
  currentSplitKey: "start",
  nextSplitKey: "finish",
  splits: [],
  progress: {},
  rank: { overall: null, gender: null, ageGroup: null, club: null },
  timing: {},
  cutoff: null,
  location: null,
  timingVersion: 3,
  leaderboardVersion: 5,
  liveRevision: 3,
  canonicalBuildVersion: "build-1",
  updatedAt: "2026-09-03T10:00:00.000Z",
};

test("direct repository sends no authorization and 304 preserves object identity", async () => {
  resetParticipantLiveRepositoryForTests();
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  let count = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const headers = init?.headers as Record<string, string>;
    calls.push({ url: String(input), headers });
    count += 1;
    return count === 1
      ? new Response(JSON.stringify(participant), {
          status: 200,
          headers: { etag: '"mlp-build-1-3-5-3"' },
        })
      : new Response(null, {
          status: 304,
          headers: { etag: '"mlp-build-1-3-5-3"' },
        });
  }) as typeof fetch;
  try {
    const first = await getParticipantLive(
      "event-1",
      "ProviderABC",
      participant.participantUuid,
    );
    const second = await getParticipantLive(
      "event-1",
      "ProviderABC",
      participant.participantUuid,
    );
    assert.equal(first, second);
    assert.equal(calls.length, 2);
    assert.match(
      calls[0].url,
      /^https:\/\/api\.bergmantri\.com\/v1\/live-participant\//,
    );
    assert.equal("Authorization" in calls[0].headers, false);
    assert.equal(calls[1].headers["if-none-match"], '"mlp-build-1-3-5-3"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent callers share one in-flight participant request", async () => {
  resetParticipantLiveRepositoryForTests();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    await Promise.resolve();
    return new Response(JSON.stringify(participant), { status: 200 });
  }) as typeof fetch;
  try {
    const [left, right] = await Promise.all([
      getParticipantLive("event-1", "ProviderABC", participant.participantUuid),
      getParticipantLive("event-1", "ProviderABC", participant.participantUuid),
    ]);
    assert.equal(calls, 1);
    assert.equal(left, right);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("compact participant age group reaches the canonical mobile envelope", () => {
  const envelope = participantLiveAsCanonicalEnvelope(participant) as {
    data: {
      identity: { ageGroupKey: string | null };
      participantLive: {
        identity: { ageGroup: string | null; ageGroupName: string | null };
      };
    };
  };
  assert.equal(envelope.data.identity.ageGroupKey, "31-40");
  assert.deepEqual(envelope.data.participantLive.identity, {
    participantUuid: participant.participantUuid,
    providerParticipantUuid: participant.providerParticipantUuid,
    bib: "4121",
    displayName: "Athlete",
    ageGroup: "31-40",
    ageGroupName: "31-40",
  });
});

test("direct MobileLive preserves timing mode and authoritative start fields", () => {
  const envelope = participantLiveAsCanonicalEnvelope({
    ...participant,
    timing: { mode: "GUN", hasStarted: true },
    gunStartAt: "2026-09-03T02:15:00.000Z",
  }) as {
    data: {
      startTiming: Record<string, unknown>;
      raceState: { resolved: Record<string, unknown> };
      participantLive: { startTiming: Record<string, unknown> };
    };
  };
  assert.equal(envelope.data.startTiming.officialTimingMode, "GUN");
  assert.equal(envelope.data.startTiming.hasAcceptedStart, true);
  assert.equal(
    envelope.data.raceState.resolved.gunStartAt,
    "2026-09-03T02:15:00.000Z",
  );
  assert.deepEqual(
    envelope.data.participantLive.startTiming,
    envelope.data.startTiming,
  );
});

test("legacy projection without leaderboard revision is normalized to zero", async () => {
  resetParticipantLiveRepositoryForTests();
  const originalFetch = globalThis.fetch;
  const { leaderboardVersion: _omitted, ...legacy } = participant;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(legacy), { status: 200 })) as typeof fetch;
  try {
    const result = await getParticipantLive(
      "event-1",
      "ProviderABC",
      participant.participantUuid,
    );
    assert.equal(result.leaderboardVersion, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("version comparator rejects an older canonical build and older timing", () => {
  const active = {
    ...participant,
    canonicalBuildVersion: "2026-09-03T163800.363Z-8754f0",
    timingVersion: 4,
    liveRevision: 7,
  };
  assert.deepEqual(
    compareParticipantLiveVersions(
      {
        ...active,
        canonicalBuildVersion: "2026-09-03T150000.000Z-old001",
      },
      active,
    ),
    { decision: "reuse_existing", reason: "stale_canonical_build" },
  );
  assert.deepEqual(
    compareParticipantLiveVersions({ ...active, timingVersion: 3 }, active),
    { decision: "reuse_existing", reason: "stale_timing_version" },
  );
});

test("a stale HTTP response cannot replace a newer cached participant", async () => {
  resetParticipantLiveRepositoryForTests();
  const active = {
    ...participant,
    canonicalBuildVersion: "2026-09-03T163800.363Z-8754f0",
    timingVersion: 4,
    liveRevision: 7,
  };
  const stale = {
    ...participant,
    canonicalBuildVersion: "2026-09-03T150000.000Z-old001",
    timingVersion: 1,
    liveRevision: 1,
  };
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify(calls === 1 ? active : stale), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    const first = await getParticipantLive(
      "event-1",
      "ProviderABC",
      participant.participantUuid,
    );
    const second = await getParticipantLive(
      "event-1",
      "ProviderABC",
      participant.participantUuid,
    );
    assert.equal(second, first);
    assert.equal(second.canonicalBuildVersion, active.canonicalBuildVersion);
    assert.equal(second.timingVersion, 4);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("participant cache is a bounded LRU across repeated athlete switches", async () => {
  resetParticipantLiveRepositoryForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const participantUuid = decodeURIComponent(
      String(input).split("/").at(-1)!,
    );
    const suffix = participantUuid.split(":").at(-1)!;
    return new Response(
      JSON.stringify({
        ...participant,
        participantUuid,
        providerParticipantUuid: `provider-${suffix}`,
        bib: suffix,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const firstUuid = "race:providerabc:contest:1000";
    for (
      let index = 0;
      index < MAX_PARTICIPANT_LIVE_CACHE_ENTRIES;
      index += 1
    ) {
      await getParticipantLive(
        "event-1",
        "ProviderABC",
        `race:providerabc:contest:${1000 + index}`,
      );
    }
    // Refresh the oldest entry; the next insert must evict the second-oldest.
    await getParticipantLive("event-1", "ProviderABC", firstUuid);
    await getParticipantLive(
      "event-1",
      "ProviderABC",
      "race:providerabc:contest:9999",
    );

    const keys = participantLiveRepositoryCacheKeysForTests();
    assert.equal(keys.length, MAX_PARTICIPANT_LIVE_CACHE_ENTRIES);
    assert.ok(keys.some((key) => key.endsWith(":1000")));
    assert.ok(!keys.some((key) => key.endsWith(":1001")));
    assert.ok(keys.some((key) => key.endsWith(":9999")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
