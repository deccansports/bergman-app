import type { LiveAthlete } from '@/lib/types';
import type { PredictionSourceKind } from './predictionConfidence';

export type PredictionLeg = 'SWIM' | 'T1' | 'BIKE' | 'T2' | 'RUN' | 'RUN1' | 'RUN2';

export type LegPredictionModel = {
  leg: PredictionLeg;
  paceSecPerKm: number;
  source: PredictionSourceKind;
  sourceDetail: string;
  transitionDurationSec?: number;
};

function toNum(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function secPerKmFromSpeedKmh(speedKmh: number | null) {
  if (!speedKmh || speedKmh <= 0) return null;
  return 3600 / speedKmh;
}

function resolveLegToken(athlete: LiveAthlete, fallbackSegment?: string): PredictionLeg {
  const legRaw = String((athlete as any)?.leg || fallbackSegment || '').trim().toUpperCase();
  if (legRaw.includes('SWIM')) return 'SWIM';
  if (legRaw === 'T1') return 'T1';
  if (legRaw.includes('BIKE')) return 'BIKE';
  if (legRaw === 'T2') return 'T2';
  if (legRaw === 'RUN1') return 'RUN1';
  if (legRaw === 'RUN2') return 'RUN2';
  return 'RUN';
}

export function resolveLegPredictionModel(params: {
  athlete: LiveAthlete;
  observedPaceSecPerKm: number | null;
  fallbackSegment?: string;
}): LegPredictionModel {
  const { athlete, observedPaceSecPerKm, fallbackSegment } = params;
  const leg = resolveLegToken(athlete, fallbackSegment);

  const livePace = toNum((athlete as any)?.predictedPaceSecPerKm ?? (athlete as any)?.pace ?? (athlete as any)?.averagePace ?? (athlete as any)?.participantLive?.pace ?? (athlete as any)?.participantLive?.averagePace);
  const liveSpeed = toNum((athlete as any)?.speed ?? (athlete as any)?.averageSpeed ?? (athlete as any)?.participantLive?.speed ?? (athlete as any)?.participantLive?.averageSpeed);
  const livePaceFromSpeed = secPerKmFromSpeedKmh(liveSpeed);

  // Historical athlete-specific candidates
  const historicalSwimPer100m = toNum((athlete as any)?.swimPaceSecPer100m ?? (athlete as any)?.averageSwimPaceSecPer100m ?? (athlete as any)?.history?.swimPaceSecPer100m);
  const historicalBikeSpeed = toNum((athlete as any)?.bikeSpeedKmh ?? (athlete as any)?.averageBikeSpeedKmh ?? (athlete as any)?.history?.bikeSpeedKmh);
  const historicalRunPace = toNum((athlete as any)?.runPaceSecPerKm ?? (athlete as any)?.averageRunPaceSecPerKm ?? (athlete as any)?.history?.runPaceSecPerKm);
  const historicalT1 = toNum((athlete as any)?.t1DurationSec ?? (athlete as any)?.averageT1Sec ?? (athlete as any)?.history?.t1DurationSec);
  const historicalT2 = toNum((athlete as any)?.t2DurationSec ?? (athlete as any)?.averageT2Sec ?? (athlete as any)?.history?.t2DurationSec);

  // Contest averages
  const contestSwimPer100m = toNum((athlete as any)?.contestAverageSwimPaceSecPer100m ?? (athlete as any)?.contest?.swimPaceSecPer100m);
  const contestBikeSpeed = toNum((athlete as any)?.contestAverageBikeSpeedKmh ?? (athlete as any)?.contest?.bikeSpeedKmh);
  const contestRunPace = toNum((athlete as any)?.contestAverageRunPaceSecPerKm ?? (athlete as any)?.contest?.runPaceSecPerKm);
  const contestT1 = toNum((athlete as any)?.contestAverageT1Sec ?? (athlete as any)?.contest?.t1Sec);
  const contestT2 = toNum((athlete as any)?.contestAverageT2Sec ?? (athlete as any)?.contest?.t2Sec);

  if (leg === 'T1' || leg === 'T2') {
    const transitionDurationSec = leg === 'T1'
      ? (historicalT1 ?? contestT1 ?? 180)
      : (historicalT2 ?? contestT2 ?? 150);

    const source: PredictionSourceKind = (leg === 'T1' ? historicalT1 : historicalT2)
      ? 'HISTORICAL_ATHLETE'
      : (leg === 'T1' ? contestT1 : contestT2)
        ? 'CONTEST_AVERAGE'
        : 'DEFAULT_CONTEST';

    // transitions are modeled as short duration equivalent with tiny pseudo distance
    return {
      leg,
      paceSecPerKm: Math.max(60, transitionDurationSec),
      source,
      sourceDetail: source === 'HISTORICAL_ATHLETE' ? `${leg} historical transition` : source === 'CONTEST_AVERAGE' ? `${leg} contest average transition` : `${leg} default transition`,
      transitionDurationSec,
    };
  }

  if (livePace && livePace > 0) {
    return { leg, paceSecPerKm: livePace, source: 'OFFICIAL_TIMING', sourceDetail: 'latest official timing model' };
  }
  if (livePaceFromSpeed && livePaceFromSpeed > 0) {
    return { leg, paceSecPerKm: livePaceFromSpeed, source: 'OFFICIAL_TIMING', sourceDetail: 'latest official speed model' };
  }
  if (observedPaceSecPerKm && observedPaceSecPerKm > 0) {
    return { leg, paceSecPerKm: observedPaceSecPerKm, source: 'OFFICIAL_TIMING', sourceDetail: 'observed split deltas' };
  }

  if (leg === 'SWIM') {
    if (historicalSwimPer100m && historicalSwimPer100m > 0) {
      return { leg, paceSecPerKm: historicalSwimPer100m * 10, source: 'HISTORICAL_ATHLETE', sourceDetail: 'historical swim pace (sec/100m)' };
    }
    if (contestSwimPer100m && contestSwimPer100m > 0) {
      return { leg, paceSecPerKm: contestSwimPer100m * 10, source: 'CONTEST_AVERAGE', sourceDetail: 'contest average swim pace' };
    }
    return { leg, paceSecPerKm: 1400, source: 'DEFAULT_CONTEST', sourceDetail: 'default swim pace (2:20/100m)' };
  }

  if (leg === 'BIKE') {
    if (historicalBikeSpeed && historicalBikeSpeed > 0) {
      return { leg, paceSecPerKm: 3600 / historicalBikeSpeed, source: 'HISTORICAL_ATHLETE', sourceDetail: 'historical bike speed' };
    }
    if (contestBikeSpeed && contestBikeSpeed > 0) {
      return { leg, paceSecPerKm: 3600 / contestBikeSpeed, source: 'CONTEST_AVERAGE', sourceDetail: 'contest average bike speed' };
    }
    return { leg, paceSecPerKm: 3600 / 29, source: 'DEFAULT_CONTEST', sourceDetail: 'default bike speed 29 km/h' };
  }

  if (historicalRunPace && historicalRunPace > 0) {
    return { leg, paceSecPerKm: historicalRunPace, source: 'HISTORICAL_ATHLETE', sourceDetail: 'historical run pace' };
  }
  if (contestRunPace && contestRunPace > 0) {
    return { leg, paceSecPerKm: contestRunPace, source: 'CONTEST_AVERAGE', sourceDetail: 'contest average run pace' };
  }
  return { leg, paceSecPerKm: 340, source: 'DEFAULT_CONTEST', sourceDetail: 'default run pace 5:40/km' };
}
