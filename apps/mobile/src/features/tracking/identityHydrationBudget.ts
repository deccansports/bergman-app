/** Only the selected watchlist row may resolve identity/full detail. */
export const TRACKED_IDENTITY_HYDRATION_CONCURRENCY = 1;

export function identityHydrationIndexes(
  trackedCount: number,
  selectedIndex: number,
): number[] {
  if (trackedCount <= 0 || selectedIndex < 0 || selectedIndex >= trackedCount) {
    return [];
  }
  return [selectedIndex];
}
