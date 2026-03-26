
// functions/src/live/recalculateETA.ts
import type { Split } from '../types';

export function recalculateETA(splits: Split[], totalDistanceKm: number) {
  if (splits.length < 2) return null;

  const last = splits[splits.length - 1];
  const prev = splits[splits.length - 2];

  // Guard against undefined timestamps
  if (last.absoluteTimestamp === undefined || prev.absoluteTimestamp === undefined) {
    return null;
  }

  const distanceDelta = last.distance - prev.distance;
  const timeDelta = last.absoluteTimestamp - prev.absoluteTimestamp;

  if (distanceDelta <= 0 || timeDelta <= 0) return null;

  const paceSecPerKm = timeDelta / distanceDelta;
  const remainingKm = Math.max(totalDistanceKm - last.distance, 0);

  return {
    paceSecPerKm,
    etaFinishUTC: Date.now() + remainingKm * paceSecPerKm * 1000
  };
}
