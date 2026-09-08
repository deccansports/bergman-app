import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAndPublishCanonicalEventVersion } from './complete-build';
import { normalizeCanonicalCourse } from './course-normalizer';
import { buildStatusKey, buildValidationKey, canonicalBuildSummaryKey, eventManifestKey } from './storage-keys';

test('required participant document failure retains the previous active manifest', async () => {
  const values = new Map<string, string>();
  let failParticipantWrite = true;
  const store = {
    async get(key: string) { return values.get(key) ?? null; },
    async put(key: string, value: string) {
      if (failParticipantWrite && key.includes(':participant:race%3A') && !key.endsWith(':splits')) {
        failParticipantWrite = false;
        throw new Error('synthetic participant document write failure');
      }
      values.set(key, value);
    },
  };
  const eventId = 'event-1';
  const buildVersion = 'build-failed';
  const providerEventUuid = '6ueOOKHs';
  const previousManifest = {
    schemaVersion: 1,
    eventId,
    activeVersion: 'build-previous',
    completeBuildValid: true,
  };
  values.set(eventManifestKey(eventId), JSON.stringify(previousManifest));
  const course = normalizeCanonicalCourse({
    eventId,
    buildVersion,
    source: 'feibot_cloud',
    contestMappings: [{
      providerEventUuid,
      providerContestUuid: '2qwc3RDn',
      bergmanTicketId: 'ticket-1',
      raceType: 'swimathon',
      configuredRaceDistanceKm: 1,
      splitMappings: [
        { canonicalCode: 'swim_start', providerSplitId: 'start', order: 1, distanceInLegKm: 0 },
        { canonicalCode: 'swim_finish', providerSplitId: 'finish', order: 2, distanceInLegKm: 1 },
      ],
    }],
    timingRules: { splits: [
      { split_uuid: 'start', contest_uuid: '2qwc3RDn', split_name: 'START', order: 1 },
      { split_uuid: 'finish', contest_uuid: '2qwc3RDn', split_name: 'FINISH', order: 2 },
    ] },
  });

  await assert.rejects(buildAndPublishCanonicalEventVersion({
    store,
    eventId,
    buildVersion,
    providerEventUuid,
    course,
    participants: [{
      participantUuid: 'race:6ueookhs:2qwc3rdn:3001',
      providerParticipantUuid: 'participant-3001',
      providerEventUuid,
      contestUuid: '2qwc3RDn',
      bib: '3001',
      displayName: 'Athlete 3001',
    }],
    source: 'feibot_cloud',
    publishMobileLive: false,
  }), /synthetic participant document write failure/);

  const status = JSON.parse(values.get(buildStatusKey(eventId, buildVersion))!);
  const validation = JSON.parse(values.get(buildValidationKey(eventId, buildVersion))!);
  const summary = JSON.parse(values.get(canonicalBuildSummaryKey(eventId, buildVersion))!);
  assert.deepEqual({ status: status.status, providerEventUuid: status.providerEventUuid, failureCodes: status.failureCodes }, {
    status: 'failed', providerEventUuid, failureCodes: ['canonical_build_exception'],
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.providerEventUuid, providerEventUuid);
  assert.equal(validation.errors[0].code, 'canonical_build_exception');
  assert.equal(summary.providerEventUuid, providerEventUuid);
  assert.deepEqual(summary.failureCodes, ['canonical_build_exception']);
  assert.deepEqual(JSON.parse(values.get(eventManifestKey(eventId))!), previousManifest);
});
