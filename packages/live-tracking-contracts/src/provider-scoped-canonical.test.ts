import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  eventManifestKey,
  providerScopedCanonicalKey,
  providerScopedLiveKey,
  canonicalIncrementalParticipantKey,
  versionedAthleteSnapshotKey,
  versionedCourseKey,
} from './storage-keys';

const eventId = '4cEm8JPYbpupoFRMDLc1';
const triathlonUuid = '6QTff6CR';
const swimathonUuid = '1xajVfM0';

test('provider UUIDs receive separate immutable canonical namespaces', () => {
  const sourceManifest = eventManifestKey(eventId);
  const triathlonManifest = providerScopedCanonicalKey(eventId, triathlonUuid, sourceManifest);
  const swimathonManifest = providerScopedCanonicalKey(eventId, swimathonUuid, sourceManifest);

  assert.notEqual(triathlonManifest, swimathonManifest);
  assert.equal(triathlonManifest, `live:event:${eventId}:feibot:${triathlonUuid}:canonical:manifest`);
  assert.equal(swimathonManifest, `live:event:${eventId}:feibot:${swimathonUuid}:canonical:manifest`);
  assert.equal(
    providerScopedCanonicalKey(eventId, triathlonUuid, versionedCourseKey(eventId, 'build-a')),
    `live:event:${eventId}:feibot:${triathlonUuid}:canonical:v:build-a:course`,
  );
});

test('live timing state is isolated by provider UUID', () => {
  const triathlonState = providerScopedLiveKey(eventId, triathlonUuid, 'participantLive:athlete-1');
  const swimathonState = providerScopedLiveKey(eventId, swimathonUuid, 'participantLive:athlete-1');

  assert.notEqual(triathlonState, swimathonState);
  assert.match(triathlonState, /:feibot:6QTff6CR:participantLive:athlete-1$/);
  assert.match(swimathonState, /:feibot:1xajVfM0:participantLive:athlete-1$/);
});

test('canonical participant records use participant UUID inside event and provider scope', () => {
  const participantUuid = 'race:6ueookhs:7yc3etju:4121';
  const contestUuid = '7Yc3etJU';
  const versioned = providerScopedCanonicalKey(
    eventId,
    triathlonUuid,
    versionedAthleteSnapshotKey(eventId, 'build-a', participantUuid),
  );
  const incremental = providerScopedCanonicalKey(
    eventId,
    triathlonUuid,
    canonicalIncrementalParticipantKey(
      eventId,
      triathlonUuid,
      contestUuid,
      participantUuid,
    ),
  );

  assert.equal(
    versioned,
    `live:event:${eventId}:feibot:${triathlonUuid}:canonical:v:build-a:athlete:race%3A6ueookhs%3A7yc3etju%3A4121`,
  );
  assert.equal(
    incremental,
    `live:event:${eventId}:feibot:${triathlonUuid}:canonical:incremental:participant:${triathlonUuid}:${contestUuid}:race%3A6ueookhs%3A7yc3etju%3A4121`,
  );
});

test('incremental publication chooses canonical participant UUID rather than mutable bib or chip', async () => {
  const source = await readFile(
    resolve(process.cwd(), 'packages/live-tracking-contracts/src/incremental-publication.ts'),
    'utf8',
  );
  const stableId = source.slice(
    source.indexOf('function participantStableId'),
    source.indexOf('function parseManifest'),
  );
  assert.match(stableId, /return snapshot\.identity\.participantUuid/);
  assert.doesNotMatch(stableId, /return snapshot\.identity\.bib/);
  assert.doesNotMatch(stableId, /return snapshot\.identity\.chipCode/);
});
