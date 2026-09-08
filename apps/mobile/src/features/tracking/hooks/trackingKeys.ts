export { queryKeys } from '@/core/services/query/queryKeys';

/** Poll/cache intervals mirroring the web app (see docs/WEB_APP_ANALYSIS §4). */
export const TRACKING_INTERVALS = {
  trackingRefetchMs: 12000,
  leaderboardRefetchMs: 5000,
  // A socket change refreshes a selected live athlete immediately. This is
  // only the degraded-transport fallback, so polling every second needlessly
  // remounted heavy map/detail trees on Android and starved interactions.
  athleteDetailRefetchMs: 12000,
  replayRefetchMs: 45000,
  staleMs: 4000,
  eventsStaleMs: 30 * 60 * 1000,
  courseStaleMs: 60 * 60 * 1000,
} as const;
