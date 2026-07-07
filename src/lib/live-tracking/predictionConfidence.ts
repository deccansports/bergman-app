export type PredictionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type PredictionSourceKind =
  | 'LIVE_GPS'
  | 'OFFICIAL_TIMING'
  | 'HISTORICAL_ATHLETE'
  | 'CONTEST_AVERAGE'
  | 'DEFAULT_CONTEST'
  | 'WAITING_OFFICIAL';

export function predictionConfidenceScore(source: PredictionSourceKind) {
  switch (source) {
    case 'LIVE_GPS':
      return 100;
    case 'OFFICIAL_TIMING':
      return 95;
    case 'HISTORICAL_ATHLETE':
      return 80;
    case 'CONTEST_AVERAGE':
      return 65;
    case 'DEFAULT_CONTEST':
      return 50;
    default:
      return 40;
  }
}

export function predictionConfidenceLevel(source: PredictionSourceKind): PredictionConfidence {
  const score = predictionConfidenceScore(source);
  if (score >= 90) return 'HIGH';
  if (score >= 65) return 'MEDIUM';
  return 'LOW';
}

export function predictionStatusLabel(source: PredictionSourceKind) {
  switch (source) {
    case 'LIVE_GPS':
      return '🟢 Live GPS';
    case 'OFFICIAL_TIMING':
      return '🟢 Official Timing';
    case 'HISTORICAL_ATHLETE':
      return '🟡 Predicted from last timing point';
    case 'CONTEST_AVERAGE':
      return '🟠 Predicted using contest average';
    case 'DEFAULT_CONTEST':
      return '🟠 Predicted using default pace';
    default:
      return '🔴 Waiting for official timing';
  }
}
