import assert from 'node:assert/strict';
import test from 'node:test';

import { createLeaderboardSingleFlight, normalizeFeibotLeaderboardPayload } from './feibot-leaderboard.ts';

const row = (bib: string, rank: number) => ({
  Bib: bib,
  UUID: `athlete-${bib}`,
  Name: `Athlete ${bib}`,
  Nation: 'IND',
  Team: 'BERGMAN',
  Rank: rank,
  ChipTimeFromStartFormated: '00:10:00',
  GunTimeFromStartFormated: '00:10:05',
});

const config = (overrides: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => ({
  configKey: String(overrides.configKey ?? 'cfg-start'),
  config: {
    contest: 'contest-a',
    contestName: 'Test',
    split: 'split-start',
    splitName: 'Start',
    splitDistance: 0,
    splitResultField: 'chip',
    states: 'live',
    ...overrides,
  },
  data,
  updatedAt: '2026-09-05T00:00:00.000Z',
});

test('normalizes male-only, female-only and combined rows without recalculating rank', () => {
  const normalized = normalizeFeibotLeaderboardPayload({
    event_uuid: 'event-a',
    leaderboard: [
      config({}, { leaderBoard_male: [row('101', 7)], leaderBoard_female: [] }),
      config({ configKey: 'cfg-finish', split: 'split-finish', splitName: 'Finish' }, {
        leaderBoard_female: [row('102', 3)],
        leaderBoard_male: [row('103', 4)],
      }),
    ],
  });
  assert.equal(normalized.configCount, 2);
  assert.equal(normalized.maleRows, 2);
  assert.equal(normalized.femaleRows, 1);
  assert.equal(normalized.totalRows, 3);
  assert.equal(normalized.leaderboards[0].rows[0].rank, 7);
  assert.deepEqual(normalized.leaderboards.map((board) => board.providerSplitUuid), ['split-start', 'split-finish']);
});

test('handles empty data, missing arrays and missing data without crashing', () => {
  for (const data of [{}, { leaderBoard_male: [] }, null]) {
    const entry = config({}, data ?? undefined as any);
    if (data === null) delete (entry as any).data;
    const normalized = normalizeFeibotLeaderboardPayload({ leaderboard: [entry] }, 'event-a');
    assert.equal(normalized.providerEventUuid, 'event-a');
    assert.equal(normalized.totalRows, 0);
    assert.deepEqual(normalized.leaderboards[0].rows, []);
  }
});

test('keeps contests and splits in separate configurations', () => {
  const normalized = normalizeFeibotLeaderboardPayload({
    leaderboard: [
      config({ contest: 'contest-a', split: 'start' }, { leaderBoard_male: [row('101', 1)] }),
      config({ configKey: 'cfg-b', contest: 'contest-b', split: 'finish' }, { leaderBoard_female: [row('201', 1)] }),
    ],
  });
  assert.deepEqual(normalized.leaderboards.map(({ providerContestUuid, providerSplitUuid }) => ({ providerContestUuid, providerSplitUuid })), [
    { providerContestUuid: 'contest-a', providerSplitUuid: 'start' },
    { providerContestUuid: 'contest-b', providerSplitUuid: 'finish' },
  ]);
});

test('coalesces simultaneous provider requests and retains a short-lived shared result', async () => {
  let loads = 0;
  let clock = 1_000;
  const cache = createLeaderboardSingleFlight<{ rows: number }>(10_000, () => clock);
  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { rows: 4 };
  };
  const results = await Promise.all(Array.from({ length: 25 }, () => cache.get('event:provider', loader)));
  assert.equal(loads, 1);
  assert.ok(results.every((result) => result.value.rows === 4));
  assert.equal((await cache.get('event:provider', loader)).cacheHit, true);
  assert.equal(loads, 1);
  clock += 10_001;
  assert.equal((await cache.get('event:provider', loader)).cacheHit, false);
  assert.equal(loads, 2);
});
