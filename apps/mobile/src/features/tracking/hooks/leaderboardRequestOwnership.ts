export type LeaderboardMinuteOwnershipInput = {
  eventPhase: "live" | "finished";
  socketHealthy: boolean;
  liveRowCount: number;
  durationMs?: number;
  fallbackIntervalMs?: number;
};

export function leaderboardRefetchIntervalMs(input: {
  focused: boolean;
  isLive: boolean;
  replay?: boolean;
  socketHealthy?: boolean;
  rowCount: number;
  fallbackIntervalMs: number;
}): number | false {
  if (
    !input.focused ||
    !input.isLive ||
    input.replay === true ||
    input.socketHealthy === true ||
    input.rowCount <= 0
  ) {
    return false;
  }
  return input.fallbackIntervalMs;
}

export function leaderboardMinuteOwnership(
  input: LeaderboardMinuteOwnershipInput,
) {
  const durationMs = input.durationMs ?? 60_000;
  const fallbackIntervalMs = input.fallbackIntervalMs ?? 5_000;
  const live = input.eventPhase === "live";
  const interval = leaderboardRefetchIntervalMs({
    focused: true,
    isLive: live,
    socketHealthy: input.socketHealthy,
    rowCount: input.liveRowCount,
    fallbackIntervalMs,
  });
  const fallbackRequests = interval ? Math.floor(durationMs / interval) : 0;

  return {
    liveLeaderboardRequests: live ? 1 + fallbackRequests : 0,
    officialResultsRequests: live ? 0 : 1,
    trackingRequests: 0,
    athleteDetailRequests: 0,
    maxConcurrentLeaderboardRequests: live ? 1 : 0,
  };
}
