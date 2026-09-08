import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCanonicalCourse } from './course-normalizer';

test('saved race-flow labels and KM markers override invalid provider distances', () => {
  const course = normalizeCanonicalCourse({
    eventId: 'event-1',
    buildVersion: 'build-1',
    source: 'feibot_cloud',
    timezone: 'Asia/Kolkata',
    contestMappings: [{
      providerContestUuid: 'contest-new',
      bergmanTicketId: 'ticket-1',
      displayName: 'Test 1',
      raceType: 'swimathon',
      configuredRaceDistanceKm: 1.9,
      splitMappings: [
        { canonicalCode: 'swim_start', providerSplitId: 'start', order: 1, displayName: 'START', cumulativeDistanceKm: 0 },
        { canonicalCode: 'swim_checkpoint_1', providerSplitId: 'checkpoint', order: 2, displayName: 'Swim 1 km', cumulativeDistanceKm: 1 },
        { canonicalCode: 'swim_finish', providerSplitId: 'finish', order: 3, displayName: 'FINISH', cumulativeDistanceKm: 1.9 },
      ],
    }],
    timingRules: {
      legs: [{ leg_uuid: 'leg-swim', contest_uuid: 'contest-new', leg_name: 'SWIM', order: 1 }],
      splits: [
        { split_uuid: 'start', contest_uuid: 'contest-new', leg_uuid: 'leg-swim', split_name: 'Provider Start', order: 2, distanceFromStartKm: 5, timing_point_uuid: 'tp-start' },
        { split_uuid: 'checkpoint', contest_uuid: 'contest-new', leg_uuid: 'leg-swim', split_name: 'Provider Checkpoint', order: 3, distanceFromStartKm: 1, timing_point_uuid: 'tp-checkpoint' },
        { split_uuid: 'finish', contest_uuid: 'contest-new', leg_uuid: 'leg-swim', split_name: 'Provider Finish', order: 1, distanceFromStartKm: 0, timing_point_uuid: 'tp-finish' },
      ],
    },
  });

  const contest = course.contests[0];
  assert.equal(course.validation.valid, true);
  assert.deepEqual(contest.splits.map((split) => split.displayName), ['START', 'Swim 1 km', 'FINISH']);
  assert.deepEqual(contest.splits.map((split) => split.cumulativeDistanceKm), [0, 1, 1.9]);
  assert.equal(contest.totalDistanceKm, 1.9);
});

test('canonical contest preserves authoritative provider connection race date', () => {
  const course = normalizeCanonicalCourse({
    eventId: '4cEm8JPYbpupoFRMDLc1',
    buildVersion: 'build-race-date',
    source: 'feibot_cloud',
    contestMappings: [{
      providerEventUuid: '6ueOOKHs',
      providerContestUuid: '2qwc3RDn',
      bergmanTicketId: 'ticket-swimathon',
      raceDate: '2026-09-05',
      raceType: 'swimathon',
      configuredRaceDistanceKm: 1,
    }],
    timingRules: { legs: [], splits: [] },
  });

  assert.equal(course.contests[0].providerEventUuid, '6ueOOKHs');
  assert.equal(course.contests[0].raceDate, '2026-09-05');
});

test('shared timing points resolve by provider split and configured triathlon distances', () => {
  const splitMappings = [
    ['swim_start', '4uscdYgh', 'shared-start-finish', 1, 'Start'],
    ['swim_finish', '4RSDJfEL', 'shared-transition-1', 2, 'Swim Finish'],
    ['bike_start', '3BoGq8U9', 'shared-transition-1', 3, 'Bike Start'],
    ['bike_finish', '3c3jrd9F', 'shared-transition-2', 4, 'Bike Finish'],
    ['run_start', '4R4DBz6h', 'shared-transition-2', 5, 'Run Start'],
    ['run_finish', '4DBMkLxV', 'shared-start-finish', 6, 'Run Finish'],
  ].map(([canonicalCode, providerSplitId, providerTimingPointId, order, displayName]) => ({
    canonicalCode: String(canonicalCode), providerSplitId: String(providerSplitId),
    providerTimingPointId: String(providerTimingPointId), order: Number(order), displayName: String(displayName),
    readSelectionRule: 'first' as const,
  }));
  const course = normalizeCanonicalCourse({
    eventId: 'event-triathlon', buildVersion: 'build-triathlon', source: 'feibot_cloud', timezone: 'Asia/Kolkata',
    contestMappings: [{
      providerContestUuid: 'contest-1', bergmanTicketId: 'ticket-1', raceType: 'triathlon',
      configuredRaceDistanceKm: 52, legDistancesKm: { swim: 2, bike: 40, run: 10 }, splitMappings,
    }],
    timingRules: { splits: splitMappings.map((mapping, index) => ({
      split_uuid: mapping.providerSplitId, contest_uuid: 'contest-1', split_name: mapping.providerSplitId,
      split_index: index + 1, timing_point_uuid: mapping.providerTimingPointId, DistanceFromStart: index * 1000,
    })) },
  });
  const contest = course.contests[0];
  assert.equal(course.validation.valid, true);
  assert.deepEqual(contest.splits.map((split) => split.key), ['swim_start', 'swim_finish', 'bike_start', 'bike_finish', 'run_start', 'run_finish']);
  assert.deepEqual(contest.splits.map((split) => split.displayName), ['Start', 'Swim Finish', 'Bike Start', 'Bike Finish', 'Run Start', 'Run Finish']);
  assert.deepEqual(contest.splits.map((split) => split.cumulativeDistanceKm), [0, 2, 2, 42, 42, 52]);
  assert.deepEqual(contest.splits.map((split) => split.isRaceStart), [true, false, false, false, false, false]);
  assert.deepEqual(contest.splits.map((split) => split.isLegStart), [true, false, true, false, true, false]);
  assert.deepEqual(contest.splits.map((split) => split.isRaceFinish), [false, false, false, false, false, true]);
  assert.deepEqual(contest.splits.map((split) => split.isLegFinish), [false, true, false, true, false, true]);
  assert.deepEqual(contest.splits.map((split) => split.isStart), [true, false, false, false, false, false]);
  assert.deepEqual(contest.splits.map((split) => split.isFinish), [false, false, false, false, false, true]);
  assert.deepEqual(contest.sections.map((section) => section.key), ['swim', 't1', 'bike', 't2', 'run']);
});

test('explicit leg GPX ownership does not depend on URL filename', () => {
  const codes = ['swim_start', 'swim_finish', 'bike_start', 'bike_finish', 'run_start', 'run_finish'];
  const splitMappings = codes.map((canonicalCode, index) => ({
    canonicalCode,
    providerSplitId: `split-${index + 1}`,
    providerTimingPointId: `point-${index + 1}`,
    order: index + 1,
  }));
  const sharedRoute = 'https://maps.example.com/BERGMAN_OT_BENGALURU.gpx';
  const course = normalizeCanonicalCourse({
    eventId: 'event-gpx', buildVersion: 'build-gpx', source: 'feibot_cloud',
    contestMappings: [{
      providerContestUuid: 'contest-gpx', bergmanTicketId: 'ticket-gpx', raceType: 'triathlon',
      configuredRaceDistanceKm: 52, splitMappings,
      gpxUrls: ['https://maps.example.com/SWIM.gpx', sharedRoute],
      gpxUrlsByLeg: {
        swim: ['https://maps.example.com/SWIM.gpx'],
        bike: [sharedRoute],
        run: [sharedRoute],
      },
    }],
    timingRules: { splits: splitMappings.map((mapping, index) => ({
      split_uuid: mapping.providerSplitId,
      contest_uuid: 'contest-gpx',
      split_name: mapping.canonicalCode,
      split_index: index + 1,
      timing_point_uuid: mapping.providerTimingPointId,
    })) },
  });

  assert.deepEqual(course.contests[0].legs.map((leg) => leg.gpxUrls), [
    ['https://maps.example.com/SWIM.gpx'],
    [sharedRoute],
    [sharedRoute],
  ]);
  assert.equal(course.validation.warnings.some((warning) => warning.code === 'gpx_missing'), false);
});

test('triathlon checkpoints use leg distance while cumulative race distance remains monotonic', () => {
  const definitions = [
    ['swim_start', 'Start', 0], ['swim_1_km', 'Swim 1 km', 1], ['swim_finish', 'Swim Finish', 2],
    ['bike_start', 'Bike Start', 0], ['bike_10_km', 'Bike 10 km', 10], ['bike_20_km', 'Bike 20 km', 20],
    ['bike_30_km', 'Bike 30 km', 30], ['bike_finish', 'Bike 40 km / Finish', 40],
    ['run_start', 'Run Start', 0], ['run_2_5_km', 'Run 2.5 km', 2.5], ['run_5_km', 'Run 5 km', 5],
    ['run_7_5_km', 'Run 7.5 km', 7.5], ['run_finish', 'Run 10 km / Finish', 10],
  ] as const;
  const splitMappings = definitions.map(([canonicalCode, displayName, distanceInLegKm], index) => ({
    canonicalCode,
    displayName,
    distanceInLegKm,
    providerSplitId: `split-${index + 1}`,
    providerTimingPointId: `tp-${index + 1}`,
    order: index + 1,
    readSelectionRule: 'first' as const,
  }));
  const course = normalizeCanonicalCourse({
    eventId: 'event-checkpoints', buildVersion: 'build-checkpoints', source: 'feibot_cloud', timezone: 'Asia/Kolkata',
    contestMappings: [{
      providerContestUuid: 'contest-checkpoints', bergmanTicketId: 'ticket-checkpoints', raceType: 'triathlon',
      configuredRaceDistanceKm: 52, legDistancesKm: { swim: 2, bike: 40, run: 10 }, splitMappings,
    }],
    timingRules: { splits: splitMappings.map((mapping, index) => ({
      split_uuid: mapping.providerSplitId,
      contest_uuid: 'contest-checkpoints',
      split_name: mapping.displayName,
      split_index: index + 1,
      timing_point_uuid: mapping.providerTimingPointId,
      // Deliberately invalid provider distance: mapping must remain authoritative.
      DistanceFromStart: index * 1000,
      DistanceFromStartUnit: 'kilometers',
    })) },
  });

  const contest = course.contests[0];
  assert.equal(course.validation.valid, true);
  assert.deepEqual(contest.splits.map((split) => split.distanceInLegKm), [
    0, 1, 2, 0, 10, 20, 30, 40, 0, 2.5, 5, 7.5, 10,
  ]);
  assert.deepEqual(contest.splits.map((split) => split.cumulativeDistanceKm), [
    0, 1, 2, 2, 12, 22, 32, 42, 42, 44.5, 47, 49.5, 52,
  ]);
});

test('canonical contest aliases consume splits and legs from legacy provider contest UUIDs', () => {
  const course = normalizeCanonicalCourse({
    eventId: 'event-alias',
    buildVersion: 'build-alias',
    source: 'feibot_cloud',
    contestMappings: [{
      providerContestUuid: 'contest-canonical',
      legacyContestIds: ['contest-provider-current'],
      bergmanTicketId: 'ticket-alias',
      raceType: 'swimathon',
      configuredRaceDistanceKm: 1,
      splitMappings: [
        { canonicalCode: 'swim_start', providerSplitId: 'start', order: 1, cumulativeDistanceKm: 0 },
        { canonicalCode: 'swim_finish', providerSplitId: 'finish', order: 2, cumulativeDistanceKm: 1 },
      ],
    }],
    timingRules: {
      legs: [{ leg_uuid: 'leg-swim', contest_uuid: 'contest-provider-current', leg_name: 'SWIM', order: 1 }],
      splits: [
        { split_uuid: 'start', contest_uuid: 'contest-provider-current', leg_uuid: 'leg-swim', split_name: 'Start', order: 1 },
        { split_uuid: 'finish', contest_uuid: 'contest-provider-current', leg_uuid: 'leg-swim', split_name: 'Finish', order: 2 },
      ],
    },
  });

  assert.equal(course.contests[0]?.providerContestUuid, 'contest-canonical');
  assert.deepEqual(course.contests[0]?.splits.map((split) => split.providerSplitId), ['start', 'finish']);
  assert.equal(course.validation.valid, true);
});

test('keeps provider names immutable while applying display overrides and preserves timing point ID plus UUID', () => {
  const course = normalizeCanonicalCourse({
    eventId: 'event-provider-fields', buildVersion: 'build-provider-fields', source: 'feibot_cloud',
    contestMappings: [{
      providerContestUuid: 'contest-provider', bergmanTicketId: 'ticket-provider', raceType: 'swimathon', configuredRaceDistanceKm: 1,
      splitMappings: [
        { canonicalCode: 'swim_start', providerSplitId: 'provider-start', displayName: 'Start Arch', cumulativeDistanceKm: 0, order: 1 },
        { canonicalCode: 'swim_finish', providerSplitId: 'provider-finish', displayName: 'Finish Arch', cumulativeDistanceKm: 1, order: 2 },
      ],
    }],
    timingRules: { splits: [
      { split_uuid: 'provider-start', contest_uuid: 'contest-provider', split_name: 'Feibot Swim Start', timing_point_uuid: '5fD3OAat', timing_point_id: 1, order: 1 },
      { split_uuid: 'provider-finish', contest_uuid: 'contest-provider', split_name: 'Feibot Swim Finish', timing_point_uuid: '5fD3OAat', timing_point_id: 1, order: 2 },
    ] },
  });

  assert.deepEqual(course.contests[0].splits.map((split) => split.displayName), ['Start Arch', 'Finish Arch']);
  assert.deepEqual(course.contests[0].splits.map((split) => split.providerName), ['Feibot Swim Start', 'Feibot Swim Finish']);
  assert.deepEqual(course.contests[0].splits.map((split) => split.providerTimingPointUuid), ['5fD3OAat', '5fD3OAat']);
  assert.deepEqual(course.contests[0].splits.map((split) => split.providerTimingPointNumericId), ['1', '1']);
  assert.equal(course.validation.valid, true);
  assert.ok(course.validation.warnings.some((warning) => warning.code === 'shared_timing_point_unresolved_nonfatal'));
});

test('canonical split identity includes Bergman event, Feibot event, contest, and split UUID', () => {
  const course = normalizeCanonicalCourse({
    eventId: 'bergman-event',
    buildVersion: 'build-1',
    source: 'feibot_cloud',
    timingRules: {
      legs: [{ UUID: 'leg-1', ContestUUID: 'contest-1', Name: 'Run', Order: 1 }],
      splits: [{ UUID: 'split-1', ContestUUID: 'contest-1', LegUUID: 'leg-1', Name: 'Start', Order: 1, TimingPointUUID: 'point-1' }],
    },
    contestMappings: [{
      providerEventUuid: 'provider-event',
      providerContestUuid: 'contest-1',
      bergmanTicketId: 'ticket-1',
      raceType: 'running',
      configuredRaceDistanceKm: 10,
    }],
  });

  const split = course.contests[0].splits[0];
  assert.equal(course.contests[0].providerEventUuid, 'provider-event');
  assert.equal(split.bergmanEventId, 'bergman-event');
  assert.equal(split.providerEventUuid, 'provider-event');
  assert.equal(split.contestUuid, 'contest-1');
  assert.equal(split.splitUuid, 'split-1');
  assert.equal(split.canonicalIdentityKey, 'bergman-event:provider-event:contest-1:split-1');
});

test('preserves complete Feibot timing-rule metadata without presentation overrides', () => {
  const providerRow = {
    UUID: 'split-1', ContestUUID: 'contest-1', Name: 'Split 1', split_index: 7,
    TimingPointUUID: 'point-1', CalculatedTimingPointUsePassNum: 2, UsePassNumMode: 'auto',
    DistanceFromStart: 15, DistanceFromStartUnit: 'kilometers', SplitLength: 10, SplitLengthUnit: 'kilometers',
    TypeOfTimeLimit: 'RaceTime', RaceTimeLimitMin: 1_500_000_000_000, RaceTimeLimitMax: 15_000_000_000_000,
    NaturalTimeLimitMin: '0001-01-01T00:00:00Z', NaturalTimeLimitMax: '0001-01-01T00:00:00Z',
    CalculatedEffectiveTimeLimits: { default: { TimeMin: '2026-08-30T00:25:00Z', TimeMax: '2026-08-30T04:10:00Z' } },
    TimeLimitSet: { default: [] }, SpeedLimitMin: 0, SpeedLimitMax: 10, SpeedLimitUnit: 'mps', Must: true,
  };
  const course = normalizeCanonicalCourse({
    eventId: 'event-1', buildVersion: 'build-1', source: 'feibot_cloud',
    contestMappings: [{
      providerEventUuid: 'provider-event', providerContestUuid: 'contest-1', bergmanTicketId: 'ticket-1',
      raceType: 'running', configuredRaceDistanceKm: 15,
      splitMappings: [{ canonicalCode: 'run_start', providerSplitId: 'split-1', displayName: 'Custom display', order: 99 }],
    }],
    timingRules: { splits: [providerRow] },
  });
  const split = course.contests[0].splits[0];
  assert.equal(split.displayName, 'Custom display');
  assert.equal(split.providerName, 'Split 1');
  assert.equal(split.providerSplitUuid, 'split-1');
  assert.equal(split.providerSplitIndex, 7);
  assert.equal(split.providerPassMode, 'auto');
  assert.equal(split.providerDistanceFromStart, 15);
  assert.equal(split.providerSplitLength, 10);
  assert.equal(split.timeLimitMinRaw, '1500000000000');
  assert.equal(split.timeLimitMaxRaw, '15000000000000');
  assert.equal(split.timeLimitMinMs, 1_500_000);
  assert.equal(split.timeLimitMaxMs, 15_000_000);
  assert.equal(split.timeLimitReference, 'race_start');
  assert.equal(split.speedLimitMax, 10);
  assert.deepEqual(split.providerRaw, providerRow);
});

test('explicit provider mapping preserves Bike Start, misspelled Bike Finish, and Run Start on one mat', () => {
  const definitions = [
    ['swim_start', '7UwNEBbi', 'SWIM START', 'SWIM', '5cdao43D'],
    ['swim_finish', '5KwWuQf2', 'SWIM FINISH', 'SWIM', '5cdao43D'],
    ['bike_start', 'YyUiM4CR', 'BIKE START', 'BIKE', '5dkeky0q'],
    ['bike_checkpoint_4', '3vsul8SF', 'BIKE 1', 'BIKE', '3iBvugtq'],
    ['bike_finish', '35FzZtIw', 'BIKE FINISHI', 'BIKE', '5dkeky0q'],
    ['run_start', '4a3yDTZG', 'RUN START', 'RUN', '5dkeky0q'],
    ['run_checkpoint_7', '63TZnRew', 'RUN 1', 'RUN', '3iU6t9Gx'],
    ['run_finish', '1ojwaAmi', 'RUN FINISH', 'RUN', '5cdao43D'],
  ] as const;
  const course = normalizeCanonicalCourse({
    eventId: 'tImWYZAi99k8ILwxrTSO', buildVersion: 'local-regression', source: 'feibot_cloud',
    contestMappings: [{
      providerEventUuid: '4teGxjmX', providerContestUuid: '5JUm5wtI', bergmanTicketId: 'test-ticket',
      raceType: 'triathlon', configuredRaceDistanceKm: 18.7,
      splitMappings: definitions.map(([canonicalCode, providerSplitId, name], index) => ({
        canonicalCode, providerSplitId, displayName: name, order: index + 1,
      })),
    }],
    timingRules: { splits: definitions.map(([, UUID, Name, assignedLeg, TimingPointUUID], index) => ({
      UUID, ContestUUID: '5JUm5wtI', Name, assignedLeg, split_index: index + 1,
      TimingPointUUID, CalculatedTimingPointUsePassNum: 1,
    })) },
  });
  const keys = course.contests[0].splits.map((split) => split.key);
  assert.equal(course.validation.valid, true);
  assert.ok(keys.includes('bike_start'));
  assert.ok(keys.includes('bike_finish'));
  assert.ok(keys.includes('run_start'));
  assert.deepEqual(
    course.contests[0].splits.filter((split) => split.providerTimingPointId === '5dkeky0q').map((split) => split.key),
    ['bike_start', 'bike_finish', 'run_start'],
  );
});

test('a provider structural Bike Finish boundary overrides a misspelled provider name', () => {
  const providerSplits = [
    ['7UwNEBbi', 'SWIM START', 'leg-swim', '5cdao43D', 1],
    ['5KwWuQf2', 'SWIM FINISH', 'leg-swim', '5cdao43D', 2],
    ['YyUiM4CR', 'BIKE START', 'leg-bike', '5dkeky0q', 2],
    ['3vsul8SF', 'BIKE 4 KM', 'leg-bike', 'bike-checkpoint', 3],
    ['35FzZtIw', 'BIKE FINISHI', 'leg-bike', '5dkeky0q', 4],
    ['4a3yDTZG', 'RUN START', 'leg-run', '5dkeky0q', 5],
    ['63TZnRew', 'RUN 7 KM', 'leg-run', 'run-checkpoint', 6],
    ['1ojwaAmi', 'RUN FINISH', 'leg-run', '5cdao43D', 7],
  ] as const;
  const course = normalizeCanonicalCourse({
    eventId: 'tImWYZAi99k8ILwxrTSO', buildVersion: 'local-boundary-regression', source: 'feibot_cloud',
    contestMappings: [{
      providerEventUuid: '4teGxjmX', providerContestUuid: '5JUm5wtI', bergmanTicketId: 'test-ticket',
      raceType: 'triathlon', configuredRaceDistanceKm: 18,
      legDistancesKm: { swim: 1, bike: 10, run: 7 },
    }],
    timingRules: {
      legs: [
        { leg_uuid: 'leg-swim', contest_uuid: '5JUm5wtI', leg_name: 'SWIM', start_split_uuid: '7UwNEBbi', end_split_uuid: '5KwWuQf2', order: 1 },
        { leg_uuid: 'leg-bike', contest_uuid: '5JUm5wtI', leg_name: 'BIKE', start_split_uuid: 'YyUiM4CR', end_split_uuid: '35FzZtIw', order: 2 },
        { leg_uuid: 'leg-run', contest_uuid: '5JUm5wtI', leg_name: 'RUN', start_split_uuid: '4a3yDTZG', end_split_uuid: '1ojwaAmi', order: 3 },
      ],
      splits: providerSplits.map(([UUID, Name, LegUUID, TimingPointUUID, split_index]) => ({ UUID, Name, LegUUID, ContestUUID: '5JUm5wtI', TimingPointUUID, split_index, CalculatedTimingPointUsePassNum: 1 })),
    },
  });
  const contest = course.contests[0];
  const bikeFinish = contest.splits.find((split) => split.providerSplitUuid === '35FzZtIw');
  assert.equal(course.validation.valid, true);
  assert.deepEqual(bikeFinish && {
    providerSplitUuid: bikeFinish.providerSplitUuid,
    providerSplitIndex: bikeFinish.providerSplitIndex,
    key: bikeFinish.key,
    canonicalCode: bikeFinish.canonicalCode,
    providerTimingPointId: bikeFinish.providerTimingPointId,
    passNumber: bikeFinish.passNumber,
    legType: bikeFinish.legType,
    isLegFinish: bikeFinish.isLegFinish,
    isRaceFinish: bikeFinish.isRaceFinish,
  }, {
    providerSplitUuid: '35FzZtIw', providerSplitIndex: 4, key: 'bike_finish', canonicalCode: 'bike_finish',
    providerTimingPointId: '5dkeky0q', passNumber: 1, legType: 'bike', isLegFinish: true, isRaceFinish: false,
  });
  assert.deepEqual(contest.legs.find((leg) => leg.type === 'bike')?.finishSplitKey, 'bike_finish');
  assert.deepEqual(contest.transitions.find((transition) => transition.type === 't2')?.startSplitKey, 'bike_finish');
  assert.deepEqual(contest.splits.filter((split) => split.providerTimingPointId === '5dkeky0q').map((split) => split.key), [
    'bike_start', 'bike_finish', 'run_start',
  ]);
});
