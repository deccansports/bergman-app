export const DEFAULT_OVERDUE_FREEZE_SEC = 20 * 60;

export function clampPredictedDistance(params: {
  previousDistanceKm: number | null;
  nextDistanceKm: number;
  minDistanceKm: number;
  maxDistanceKm: number;
}) {
  const previous = Number(params.previousDistanceKm || 0);
  const boundedNext = Math.max(params.minDistanceKm, Math.min(params.maxDistanceKm, params.nextDistanceKm));
  // never reverse and never jitter backwards
  return Math.max(previous, boundedNext);
}

export function shouldFreezePrediction(params: {
  nowSec: number;
  etaNextSplitUtc: number | null | undefined;
  freezeThresholdSec?: number | null;
}) {
  const eta = Number(params.etaNextSplitUtc || 0);
  if (!Number.isFinite(eta) || eta <= 0) return false;
  const threshold = Number(params.freezeThresholdSec || DEFAULT_OVERDUE_FREEZE_SEC);
  const safeThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_OVERDUE_FREEZE_SEC;
  return params.nowSec > eta + safeThreshold;
}
