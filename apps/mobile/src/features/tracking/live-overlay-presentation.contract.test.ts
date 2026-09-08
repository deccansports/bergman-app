import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mappers = readFileSync(new URL('./mappers.ts', import.meta.url), 'utf8');
const liveMapCard = readFileSync(
  new URL('./athlete-detail/components/cards/LiveMapCard.tsx', import.meta.url),
  'utf8',
);

function functionSource(name: string, nextName: string): string {
  const start = mappers.indexOf(`function ${name}`);
  const end = mappers.indexOf(`function ${nextName}`, start);
  assert(start >= 0 && end > start, `${name} source was not found`);
  return mappers.slice(start, end);
}

test('split timeline and race sections use accepted live timing overlays', () => {
  const timeline = functionSource('mapTimeline', 'mapDerivedRaceTiming');
  const derivedTiming = functionSource('mapDerivedRaceTiming', 'mapTrack');

  assert.match(timeline, /const reachedEntries = acceptedMobileSplits\(res\)/);
  assert.doesNotMatch(timeline, /const reachedEntries = \(res\.athlete\?\.splits/);
  assert.match(derivedTiming, /reads: acceptedMobileSplits\(res\)/);
});

test('progress cannot remain at zero after an accepted split', () => {
  const progress = functionSource('mapRaceProgress', 'mapLivePosition');

  assert.match(progress, /const latestAcceptedDistance = acceptedMobileSplits\(res\)/);
  assert.match(progress, /latestAcceptedDistance/);
  assert.match(progress, /resolvedProgress > 0 \|\| covered <= 0/);
});

test('live native-map rendering is throttled independently of timing refresh', () => {
  assert.match(liveMapCard, /const LIVE_MAP_TICK_MS = 3_000/);
  assert.match(liveMapCard, /liveTickMs: LIVE_MAP_TICK_MS/);
});
