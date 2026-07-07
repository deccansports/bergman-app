export function smoothEta(previousEtaUtc: number | null | undefined, newEtaUtc: number | null | undefined, weightNew = 0.3) {
  const next = Number(newEtaUtc || 0);
  if (!Number.isFinite(next) || next <= 0) return null;
  const prev = Number(previousEtaUtc || 0);
  if (!Number.isFinite(prev) || prev <= 0) return Math.round(next);
  const alpha = Math.max(0.05, Math.min(0.95, weightNew));
  return Math.round(prev * (1 - alpha) + next * alpha);
}

export function countdownToEta(etaUtc: number | null | undefined, nowSec: number) {
  const eta = Number(etaUtc || 0);
  if (!Number.isFinite(eta) || eta <= 0) return null;
  return Math.max(0, Math.round(eta - nowSec));
}
