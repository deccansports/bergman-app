import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authoritativeRaceParticipantUuid,
  buildCanonicalParticipantDocument,
  buildCanonicalParticipantSplitsDocument,
  buildCanonicalParticipants,
  hasOrphanedEffectiveStart,
  resolveCanonicalSnapshotTimingVersion,
  reassembleCanonicalAthleteSnapshot,
  writeCanonicalParticipantArtifacts,
} from './participant-builder';
import {
  versionedAthleteSnapshotKey,
  versionedParticipantIndexKey,
  versionedParticipantKey,
  versionedParticipantSplitsKey,
} from './storage-keys';

test('authoritative participant identity isolates identical bibs and provider UUIDs across Feibot events', () => {
  const common = {
    providerContestUuid: 'contest-1',
    contestUuid: 'contest-1',
    bib: '101',
    participantUuid: 'provider-row-1',
    providerParticipantUuid: 'provider-row-1',
  };
  assert.equal(authoritativeRaceParticipantUuid({ ...common, providerEventUuid: '6QTff6CR' }), 'race:6qtff6cr:contest1:101');
  assert.equal(authoritativeRaceParticipantUuid({ ...common, providerEventUuid: '1xajVfM0' }), 'race:1xajvfm0:contest1:101');
  assert.notEqual(
    authoritativeRaceParticipantUuid({ ...common, providerEventUuid: '6QTff6CR' }),
    authoritativeRaceParticipantUuid({ ...common, providerEventUuid: '1xajVfM0' }),
  );
});

test('detects a synthetic START whose downstream anchor was removed by a course rebuild', () => {
  assert.equal(hasOrphanedEffectiveStart({
    start: {
      readId: 'participant:bike-start:123:2026-08-08T06:04:01.000Z:effective-start',
    } as any,
    bikeStart: null,
  }, 'participant:bike-start:123:2026-08-08T06:04:01.000Z'), true);
});

test('keeps a synthetic START while its accepted downstream anchor is retained', () => {
  const anchor = 'participant:bike-start:123:2026-08-08T06:04:01.000Z';
  assert.equal(hasOrphanedEffectiveStart({
    start: { readId: `${anchor}:effective-start` } as any,
    bikeStart: { readId: anchor } as any,
}, anchor), false);
});

test('canonical timing builds advance the athlete timing generation', () => {
  const existing = {
    timingVersion: 7,
    versions: { timing: 7 },
  } as any;

  assert.equal(resolveCanonicalSnapshotTimingVersion(existing, 8), 8);
  assert.equal(resolveCanonicalSnapshotTimingVersion(existing, 6), 7);
  assert.equal(resolveCanonicalSnapshotTimingVersion(null, 3), 3);
});

test('verifies large snapshot builds in bounded batches', async () => {
  const values = new Map<string, string>();
  let putCount = 0;
  let putsBeforeFirstVersionedSnapshotVerification: number | null = null;
  const store = {
    async get(key: string) {
      const value = values.get(key) ?? null;
      if (
        value !== null
        && key.includes(':v:build-1:athlete:')
        && putsBeforeFirstVersionedSnapshotVerification === null
      ) {
        putsBeforeFirstVersionedSnapshotVerification = putCount;
      }
      return value;
    },
    async put(key: string, value: string) {
      putCount += 1;
      values.set(key, value);
    },
  };
  const snapshots = Array.from({ length: 60 }, (_, index) => ({
    eventId: 'event-1',
    buildVersion: 'build-1',
    identity: { participantUuid: `participant-${index + 1}` },
  }));

  const result = await writeCanonicalParticipantArtifacts(store, {
    index: {
      eventId: 'event-1',
      buildVersion: 'build-1',
      rows: [],
      participantCount: snapshots.length,
    },
    snapshots,
    aliases: [],
    reverseIndexes: {},
  } as any);

  assert.equal(result.verifiedSnapshotCount, snapshots.length);
  assert.equal(result.missingSnapshotCount, 0);
  assert.ok(putsBeforeFirstVersionedSnapshotVerification !== null);
  assert.ok(putsBeforeFirstVersionedSnapshotVerification <= 75);
});

test('uses bulk writes for versioned participant artifacts while keeping the index publish-last', async () => {
  const values = new Map<string, string>();
  const writes: string[][] = [];
  const store = {
    async get(key: string) { return values.get(key) ?? null; },
    async put(key: string, value: string) {
      writes.push([key]);
      values.set(key, value);
    },
    async putMany(entries: Array<{ key: string; value: string }>) {
      writes.push(entries.map((entry) => entry.key));
      entries.forEach(({ key, value }) => values.set(key, value));
    },
  };
  const snapshots = Array.from({ length: 30 }, (_, index) => ({
    eventId: 'event-bulk',
    buildVersion: 'build-bulk',
    identity: { participantUuid: `participant-${index + 1}` },
  }));

  await writeCanonicalParticipantArtifacts(store, {
    index: {
      eventId: 'event-bulk',
      buildVersion: 'build-bulk',
      rows: [],
      participantCount: snapshots.length,
    },
    snapshots,
    aliases: [],
    reverseIndexes: {},
  } as any);

  assert.equal(writes.filter((batch) => batch.length > 1).length, 2);
  assert.equal(writes.at(-1)?.[0], versionedParticipantIndexKey('event-bulk', 'build-bulk'));
});

test('publishes and verifies one participant and split document per athlete before the index', async () => {
  const values = new Map<string, string>();
  const writes: string[] = [];
  const store = {
    async get(key: string) { return values.get(key) ?? null; },
    async put(key: string, value: string) {
      writes.push(key);
      values.set(key, value);
    },
  };
  const eventId = 'event-305';
  const buildVersion = 'build-305';
  const snapshots = Array.from({ length: 305 }, (_, index) => {
    const participantUuid = `race:provider-a:contest-a:${index + 1}`;
    return {
      schemaVersion: 1,
      eventId,
      providerEventUuid: 'provider-a',
      buildVersion,
      updatedAt: '2026-09-04T13:56:31.852Z',
      identity: { participantUuid },
      reads: { finish: { readId: `read-${index + 1}`, participantUuid } },
      splits: [{ splitKey: 'finish', displayName: 'Finish', bib: String(index + 1) }],
    } as any;
  });

  const result = await writeCanonicalParticipantArtifacts(store, {
    index: {
      schemaVersion: 1,
      eventId,
      buildVersion,
      updatedAt: '2026-09-04T13:56:31.852Z',
      rows: [],
      participantCount: snapshots.length,
    },
    snapshots,
    aliases: [],
    reverseIndexes: {},
  } as any);

  assert.equal(result.verifiedSnapshotCount, 305);
  assert.equal(result.missingSnapshotCount, 0);
  for (const snapshot of snapshots) {
    const participantUuid = snapshot.identity.participantUuid;
    const participant = JSON.parse(values.get(versionedParticipantKey(eventId, buildVersion, participantUuid))!);
    const splits = JSON.parse(values.get(versionedParticipantSplitsKey(eventId, buildVersion, participantUuid))!);
    assert.equal(participant.participantUuid, participantUuid);
    assert.equal(Object.prototype.hasOwnProperty.call(participant.participant, 'reads'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(participant.participant, 'splits'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(participant.participant.raceState?.resolved || {}, 'splits'), false);
    assert.equal(splits.participantUuid, participantUuid);
    assert.equal(splits.reads.finish.participantUuid, participantUuid);
    assert.equal(splits.splits.length, 1);
  }
  const indexKey = versionedParticipantIndexKey(eventId, buildVersion);
  assert.ok(writes.indexOf(versionedAthleteSnapshotKey(eventId, buildVersion, snapshots[0].identity.participantUuid)) < writes.indexOf(indexKey));
  assert.ok(writes.indexOf(versionedParticipantKey(eventId, buildVersion, snapshots[0].identity.participantUuid)) < writes.indexOf(indexKey));
  assert.ok(writes.indexOf(versionedParticipantSplitsKey(eventId, buildVersion, snapshots[0].identity.participantUuid)) < writes.indexOf(indexKey));
});

test('never reassembles participant identity with splits from another build or athlete', () => {
  const snapshot = {
    schemaVersion: 1,
    eventId: 'event-1',
    providerEventUuid: 'provider-a',
    buildVersion: 'build-a',
    updatedAt: '2026-09-04T13:56:31.852Z',
    identity: { participantUuid: 'race:provider-a:contest-a:4002' },
    raceState: { resolved: { splits: [{ splitKey: 'finish' }] } },
    reads: { finish: { participantUuid: 'race:provider-a:contest-a:4002' } },
    splits: [{ splitKey: 'finish' }],
  } as any;
  const participant = buildCanonicalParticipantDocument(snapshot);
  const splits = buildCanonicalParticipantSplitsDocument(snapshot);
  assert.equal(reassembleCanonicalAthleteSnapshot(participant, splits)?.identity.participantUuid, snapshot.identity.participantUuid);
  assert.equal(reassembleCanonicalAthleteSnapshot(participant, { ...splits, buildVersion: 'build-b' }), null);
  assert.equal(reassembleCanonicalAthleteSnapshot(participant, { ...splits, participantUuid: 'race:provider-a:contest-a:5001' }), null);
});

test('four mapped provider contests produce one immutable snapshot for each of 292 participants', async () => {
  const distribution = [
    ['7Yc3etJU', 85],
    ['2qwc3RDn', 83],
    ['3P2SrGwr', 106],
    ['1QkaizPT', 18],
  ] as const;
  const course = {
    schemaVersion: 1,
    eventId: '4cEm8JPYbpupoFRMDLc1',
    buildVersion: 'dry-run-build',
    updatedAt: '2026-09-03T16:02:39.583Z',
    source: 'feibot_cloud',
    provider: 'feibot',
    timezone: 'Asia/Kolkata',
    courseVersion: 1,
    contests: distribution.map(([providerContestUuid]) => ({
      providerEventUuid: '6ueOOKHs',
      providerContestUuid,
      bergmanTicketId: 'UGO2et4uP4h5ya64NazE',
      legacyContestIds: [],
      displayName: `Mapped ${providerContestUuid}`,
      raceType: 'swimathon',
      timezone: 'Asia/Kolkata',
      courseVersion: 1,
      configuredRaceDistanceKm: 1,
      totalDistanceKm: 1,
      gpxUrls: [],
      cutoffs: {},
      legs: [],
      transitions: [],
      sections: [],
      splits: [],
    })),
    validation: {
      schemaVersion: 1,
      eventId: '4cEm8JPYbpupoFRMDLc1',
      buildVersion: 'dry-run-build',
      updatedAt: '2026-09-03T16:02:39.583Z',
      valid: true,
      errors: [],
      warnings: [],
    },
  } as any;
  const participants = distribution.flatMap(([providerContestUuid, count], contestIndex) => (
    Array.from({ length: count }, (_, index) => {
      const bib = providerContestUuid === '2qwc3RDn' && index === 0
        ? '3001'
        : `${contestIndex + 1}${String(index + 1).padStart(3, '0')}`;
      return {
        providerEventUuid: '6ueOOKHs',
        providerContestUuid,
        contestUuid: providerContestUuid,
        canonicalContestUuid: providerContestUuid,
        participantUuid: `race:6ueookhs:${providerContestUuid.toLowerCase()}:${bib}`,
        providerParticipantUuid: `provider-${providerContestUuid}-${bib}`,
        bib,
        displayName: `Athlete ${bib}`,
      };
    })
  ));

  const artifacts = await buildCanonicalParticipants({
    eventId: '4cEm8JPYbpupoFRMDLc1',
    buildVersion: 'dry-run-build',
    course,
    participants,
    timingVersion: 0,
    updatedAt: '2026-09-03T16:02:39.583Z',
  });

  assert.equal(participants.length, 292);
  assert.equal(artifacts.index.participantCount, 292);
  assert.equal(artifacts.snapshots.length, 292);
  assert.equal(new Set(artifacts.snapshots.map((row) => row.identity.participantUuid)).size, 292);
  assert.ok(artifacts.snapshots.some((row) => (
    row.identity.participantUuid === 'race:6ueookhs:2qwc3rdn:3001'
    && row.providerEventUuid === '6ueOOKHs'
    && row.providerContestUuid === '2qwc3RDn'
  )));
});
