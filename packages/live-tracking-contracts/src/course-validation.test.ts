import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCanonicalCourse } from './course-validation.ts';

const eventId = '4cEm8JPYbpupoFRMDLc1';
const providerEventUuid = '4teGxjmX';
const providerContestUuid = '5JUm5wtI';

function split(key: string, providerSplitId: string, providerTimingPointId: string, passNumber: number, order: number, displayName: string) {
  return {
    key, providerSplitId, providerTimingPointId, displayName, order, legType: 'custom', distanceInLegKm: 0, cumulativeDistanceKm: order,
    readSelectionRule: 'pass_number', passNumber, rankingEnabled: true, required: true,
    bergmanEventId: eventId, providerEventUuid, contestUuid: providerContestUuid, splitUuid: providerSplitId,
    canonicalIdentityKey: [eventId, providerEventUuid, providerContestUuid, providerSplitId].join(':').toLowerCase(),
  };
}

function bundle(splits: any[], overrides: Record<string, unknown> = {}) {
  return {
    eventId, buildVersion: 'candidate-build', updatedAt: '2026-08-30T00:00:00.000Z',
    contests: [{ providerEventUuid, providerContestUuid, bergmanTicketId: 'ticket-102', raceType: 'custom', configuredRaceDistanceKm: 0, legs: [], transitions: [], splits, ...overrides }],
  } as any;
}

test('allows Start and Swim Finish to reuse physical mat 5cdao43D:1', () => {
  const validation = validateCanonicalCourse(bundle([
    split('start', '6B4YCRSR', '5cdao43D', 1, 1, 'Start'),
    split('swim_finish', '5uWrsE8G', '5cdao43D', 1, 2, 'Swim Finish'),
  ]));
  assert.equal(validation.errors.some((entry) => entry.code === 'timing_point_pass_collision'), false);
  assert.equal(validation.errors.some((entry) => entry.code === 'duplicate_provider_split_identity_conflict'), false);
  assert.equal(validation.valid, true);
  assert.ok(validation.warnings.some((entry) => entry.code === 'shared_timing_point_pass_reuse'));
});

test('allows Bike Start, Bike Finish, and Run Start to reuse physical mat 5dkeky0q:1', () => {
  const validation = validateCanonicalCourse(bundle([
    split('bike_start', '2NxWtBhw', '5dkeky0q', 1, 3, 'Bike Start'),
    split('bike_finish', '6BgYz0w5', '5dkeky0q', 1, 4, 'Bike Finish'),
    split('run_start', 'haWQl07z', '5dkeky0q', 1, 5, 'Run Start'),
  ]));
  assert.equal(validation.errors.some((entry) => entry.code === 'timing_point_pass_collision'), false);
  assert.equal(validation.valid, true);
  assert.ok(validation.warnings.some((entry) => entry.code === 'shared_timing_point_pass_reuse'));
});

test('rejects duplicate provider split identity only when definitions conflict', () => {
  const validation = validateCanonicalCourse(bundle([
    split('bike_start', '2NxWtBhw', '5dkeky0q', 1, 3, 'Bike Start'),
    split('bike_start_duplicate', '2NxWtBhw', 'other-mat', 1, 4, 'Bike Start corrected'),
  ]));
  assert.ok(validation.errors.some((entry) => entry.code === 'duplicate_provider_split_identity_conflict'));
});

test('allows the same physical tuple in different contests', () => {
  const first = bundle([split('start', '6B4YCRSR', '5cdao43D', 1, 1, 'Start')]);
  const second = bundle([split('start', 'other-provider-split', '5cdao43D', 1, 1, 'Start')], { providerContestUuid: 'another-contest', bergmanTicketId: 'another-ticket' });
  const validation = validateCanonicalCourse({ ...first, contests: [...first.contests, ...second.contests] });
  assert.equal(validation.errors.some((entry) => entry.code === 'timing_point_pass_collision'), false);
  assert.equal(validation.errors.some((entry) => entry.code === 'duplicate_provider_split_identity_conflict'), false);
});

test('allows the same physical tuple in different provider events', () => {
  const first = bundle([split('start', '6B4YCRSR', '5cdao43D', 1, 1, 'Start')]);
  const second = bundle([split('start', '6B4YCRSR', '5cdao43D', 1, 1, 'Start')], { providerEventUuid: 'other-feibot-event', bergmanTicketId: 'other-event-ticket' });
  const validation = validateCanonicalCourse({ ...first, contests: [...first.contests, ...second.contests] });
  assert.equal(validation.errors.some((entry) => entry.code === 'timing_point_pass_collision'), false);
  assert.equal(validation.errors.some((entry) => entry.code === 'duplicate_provider_split_identity_conflict'), false);
});

test('a genuinely missing triathlon Bike Finish remains a fatal required boundary error', () => {
  const required = [
    split('swim_start', 'swim-start', 'start-finish', 1, 1, 'Swim Start'),
    split('swim_finish', 'swim-finish', 'start-finish', 1, 2, 'Swim Finish'),
    split('bike_start', 'bike-start', 'transition', 1, 3, 'Bike Start'),
    split('run_start', 'run-start', 'transition', 1, 4, 'Run Start'),
    split('run_finish', 'run-finish', 'start-finish', 1, 5, 'Run Finish'),
  ];
  const validation = validateCanonicalCourse(bundle(required, { raceType: 'triathlon' }));
  assert.ok(validation.errors.some((entry) => (
    entry.code === 'required_boundary_missing'
    && entry.path === 'splits.bike_finish'
  )));
  assert.equal(validation.valid, false);
});

test('rejects a leg finish that points at a semantic checkpoint', () => {
  const validation = validateCanonicalCourse(bundle([
    { ...split('bike_start', 'bike-start', 'bike-start-mat', 1, 1, 'Bike Start'), legType: 'bike', canonicalCode: 'bike_start', isLegStart: true },
    { ...split('bike_checkpoint_5', 'bike-checkpoint', 'bike-finish-mat', 1, 2, 'Bike checkpoint'), legType: 'bike', canonicalCode: 'bike_checkpoint_5', isLegFinish: false },
  ], {
    legs: [{ key: 'bike', type: 'bike', order: 1, displayName: 'Bike', startSplitKey: 'bike_start', finishSplitKey: 'bike_checkpoint_5', distanceKm: 10, gpxUrls: [], geometryStatus: 'missing', geometrySource: 'none', estimated: true, cutoffSeconds: null }],
  }));
  assert.ok(validation.errors.some((entry) => entry.code === 'leg_finish_boundary_inconsistent'));
});
