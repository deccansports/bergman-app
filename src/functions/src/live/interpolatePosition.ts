
// functions/src/live/interpolatePosition.ts
export function interpolatePosition(
  lastKnownDistance: number,
  lastTimestamp: number, // in milliseconds
  paceSecPerKm: number
): number {
  if (!paceSecPerKm || paceSecPerKm <= 0) return lastKnownDistance;

  const elapsedSec = (Date.now() - lastTimestamp) / 1000;
  const deltaKm = elapsedSec / paceSecPerKm;

  return Math.max(lastKnownDistance + deltaKm, lastKnownDistance);
}
