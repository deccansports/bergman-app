import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanonicalContestCourse } from './contracts';
import { applyBergmanCutoffMappingToContest } from './course-cutoff-overlay';

const contest = {
  providerContestUuid: '2km',
  cutoffs: { swim: 999, overall: 999 },
  legs: [{ type: 'swim', order: 1, cutoffSeconds: 999 }],
  splits: [
    { key: 'swim_start', providerSplitId: 'start', providerTimingPointId: 'mat-a' },
    { key: 'swim_finish', providerSplitId: 'finish', providerTimingPointId: 'mat-b' },
  ],
} as unknown as CanonicalContestCourse;

test('BERGMAN overall leg cutoff replaces provider cutoff values', () => {
  const updated = applyBergmanCutoffMappingToContest(contest, {
    contest_id: '2km',
    legs: [{ leg_index: 1, leg_name: 'SWIM', cutoff_type: 'overall', cutoff_value: '01:15:00' }],
    splits: [],
  });
  assert.deepEqual(updated.cutoffs, { overall: 4500 });
  assert.equal(updated.legs[0].cutoffSeconds, 4500);
});

test('changing or removing BERGMAN cutoff never retains a stale provider value', () => {
  const changed = applyBergmanCutoffMappingToContest(contest, {
    legs: [{ leg_index: 1, leg_name: 'SWIM', cutoff_type: 'cumulative', cutoff_value: 3600 }],
  });
  assert.deepEqual(changed.cutoffs, { swim: 3600 });
  const removed = applyBergmanCutoffMappingToContest(changed, {
    legs: [{ leg_index: 1, leg_name: 'SWIM', cutoff_type: 'none', cutoff_value: null }],
  });
  assert.deepEqual(removed.cutoffs, {});
  assert.equal(removed.legs[0].cutoffSeconds, null);
});

test('intentional intermediate checkpoint cutoff uses canonical split identity', () => {
  const updated = applyBergmanCutoffMappingToContest(contest, {
    legs: [{ leg_index: 1, leg_name: 'SWIM', cutoff_type: 'none', cutoff_value: null }],
    splits: [{ split_uuid: 'start', cutoff_type: 'cumulative', cutoff_value: '00:25:00' }],
  });
  assert.equal(updated.cutoffs.swim_start, 1500);
});
