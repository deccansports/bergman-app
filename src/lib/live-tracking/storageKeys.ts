export const LIVE_TRACKING_KV_PREFIX = 'live:event';
export const LIVE_TRACKING_R2_PREFIX = 'event';

export function liveAthleteKvKey(eventId: string, bib: string) {
  return `live:event:${eventId}:athlete:${bib}`;
}

export function liveAthleteIndexKvKey(eventId: string) {
  return `live:event:${eventId}:athletes`;
}

export function liveLeaderboardKvKey(eventId: string, mode: string, limit: number) {
  return `live:event:${eventId}:leaderboard:${mode}:${limit}`;
}

export function liveOverviewKvKey(eventId: string) {
  return `live:event:${eventId}:overview`;
}

export function liveTimingsKvKey(eventId: string) {
  return `live:event:${eventId}:timings`;
}

export function liveMonitoringKvKey(eventId: string) {
  return `live:event:${eventId}:monitoring`;
}

export function liveRawReadsR2Key(eventId: string, date: string, hourMinuteBucket: string) {
  return `${LIVE_TRACKING_R2_PREFIX}/${eventId}/raw/${date}/${hourMinuteBucket}.json`;
}

export function liveResultsSnapshotR2Key(eventId: string, snapshotName: string) {
  return `${LIVE_TRACKING_R2_PREFIX}/${eventId}/results/${snapshotName}.json`;
}

export function liveLeaderboardSnapshotR2Key(eventId: string, snapshotName: string) {
  return `${LIVE_TRACKING_R2_PREFIX}/${eventId}/leaderboards/${snapshotName}.json`;
}

export function liveReplayR2Key(eventId: string, replayName: string) {
  return `${LIVE_TRACKING_R2_PREFIX}/${eventId}/replay/${replayName}.json`;
}

export function liveAnalyticsR2Key(eventId: string, exportName: string) {
  return `${LIVE_TRACKING_R2_PREFIX}/${eventId}/analytics/${exportName}.json`;
}
