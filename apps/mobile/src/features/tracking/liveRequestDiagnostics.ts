import { isLiveDiagnosticsEnabled } from "@/core/services/performance/liveDiagnosticsPolicy";
import { recordLivePerformance } from "./livePerformanceDiagnostics";

type RequestKind =
  | "eventDetails"
  | "tracking"
  | "watchlist"
  | "courseIndex"
  | "courseMap"
  | "gpx"
  | "athleteDetail"
  | "leaderboard"
  | "officialResults"
  | "other";

type Counters = {
  requests: Record<RequestKind, number>;
  responseCharacters: Record<RequestKind, number>;
  responseBytes: Record<RequestKind, number>;
  authenticated401s: number;
  course400s: number;
  leaderboard404s: number;
  activeAthleteDetails: number;
  maxActiveAthleteDetails: number;
  activeLeaderboards: number;
  maxActiveLeaderboards: number;
};

const emptyKinds = (): Record<RequestKind, number> => ({
  eventDetails: 0,
  tracking: 0,
  watchlist: 0,
  courseIndex: 0,
  courseMap: 0,
  gpx: 0,
  athleteDetail: 0,
  leaderboard: 0,
  officialResults: 0,
  other: 0,
});

const counters: Counters = {
  requests: emptyKinds(),
  responseCharacters: emptyKinds(),
  responseBytes: emptyKinds(),
  authenticated401s: 0,
  course400s: 0,
  leaderboard404s: 0,
  activeAthleteDetails: 0,
  maxActiveAthleteDetails: 0,
  activeLeaderboards: 0,
  maxActiveLeaderboards: 0,
};

type DiagnosticWindow = {
  maxActiveAthleteDetails: number;
  maxActiveLeaderboards: number;
};

const activeDiagnosticWindows = new Set<DiagnosticWindow>();

function requestKind(url: string): RequestKind {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url.split("?")[0];
    }
  })();
  if (/\/api\/watchlist\/?$/i.test(path)) return "watchlist";
  if (/\/api\/events\/[^/]+\/tracking\/?$/i.test(path)) return "tracking";
  if (/\/api\/live\/course-index\//i.test(path)) return "courseIndex";
  if (/\/api\/live\/course-map\//i.test(path)) return "courseMap";
  if (/\.gpx$/i.test(path)) return "gpx";
  if (/athlete-modal|canonical\/athlete/i.test(path)) return "athleteDetail";
  if (/leaderboard/i.test(path)) return "leaderboard";
  if (/\/api\/results\/[^/]+\/?$/i.test(path)) return "officialResults";
  if (/\/api\/events\/[^/]+\/?$/i.test(path)) return "eventDetails";
  return "other";
}

export function recordLiveRequestStart(url: string): RequestKind {
  const kind = requestKind(url);
  if (!isLiveDiagnosticsEnabled) return kind;
  counters.requests[kind] += 1;
  if (kind === "athleteDetail") {
    recordLivePerformance("athleteDetailRequests");
    counters.activeAthleteDetails += 1;
    counters.maxActiveAthleteDetails = Math.max(
      counters.maxActiveAthleteDetails,
      counters.activeAthleteDetails,
    );
    for (const window of activeDiagnosticWindows) {
      window.maxActiveAthleteDetails = Math.max(
        window.maxActiveAthleteDetails,
        counters.activeAthleteDetails,
      );
    }
  }
  if (kind === "leaderboard") {
    counters.activeLeaderboards += 1;
    counters.maxActiveLeaderboards = Math.max(
      counters.maxActiveLeaderboards,
      counters.activeLeaderboards,
    );
    for (const window of activeDiagnosticWindows) {
      window.maxActiveLeaderboards = Math.max(
        window.maxActiveLeaderboards,
        counters.activeLeaderboards,
      );
    }
  }
  return kind;
}

export function recordLiveRequestFinish(
  kind: RequestKind,
  status: number | "ERR",
  _contentLength?: string | null,
): void {
  if (!isLiveDiagnosticsEnabled) return;
  if (kind === "athleteDetail") {
    counters.activeAthleteDetails = Math.max(
      0,
      counters.activeAthleteDetails - 1,
    );
  }
  if (kind === "leaderboard") {
    counters.activeLeaderboards = Math.max(0, counters.activeLeaderboards - 1);
  }
  if (status === 401) counters.authenticated401s += 1;
  if (status === 400 && (kind === "courseIndex" || kind === "courseMap")) {
    counters.course400s += 1;
  }
  if (status === 404 && kind === "leaderboard") counters.leaderboard404s += 1;
}

export function recordLiveResponsePayload(url: string, payload: string): void {
  if (!isLiveDiagnosticsEnabled) return;
  const kind = requestKind(url);
  counters.responseCharacters[kind] += payload.length;
  counters.responseBytes[kind] += new TextEncoder().encode(payload).byteLength;
  if (kind === "athleteDetail") {
    recordLivePerformance(
      "athleteDetailBytes",
      new TextEncoder().encode(payload).byteLength,
    );
  }
}

export function snapshotLiveRequestDiagnostics(): Counters {
  return {
    ...counters,
    requests: { ...counters.requests },
    responseCharacters: { ...counters.responseCharacters },
    responseBytes: { ...counters.responseBytes },
  };
}

export function startLiveRequestDiagnosticWindow(
  durationMs = 60_000,
): () => void {
  if (!isLiveDiagnosticsEnabled) return () => undefined;
  const baseline = snapshotLiveRequestDiagnostics();
  const window: DiagnosticWindow = {
    maxActiveAthleteDetails: counters.activeAthleteDetails,
    maxActiveLeaderboards: counters.activeLeaderboards,
  };
  activeDiagnosticWindows.add(window);
  const timer = setTimeout(() => {
    activeDiagnosticWindows.delete(window);
    const current = snapshotLiveRequestDiagnostics();
    const deltaKinds = (
      record: Record<RequestKind, number>,
      prior: Record<RequestKind, number>,
    ) =>
      Object.fromEntries(
        Object.keys(record).map((key) => [
          key,
          record[key as RequestKind] - prior[key as RequestKind],
        ]),
      );
    console.info("[live-requests:one-minute]", {
      durationMs,
      requests: deltaKinds(current.requests, baseline.requests),
      responseCharacters: deltaKinds(
        current.responseCharacters,
        baseline.responseCharacters,
      ),
      responseBytes: deltaKinds(current.responseBytes, baseline.responseBytes),
      authenticated401s: current.authenticated401s - baseline.authenticated401s,
      course400s: current.course400s - baseline.course400s,
      leaderboard404s: current.leaderboard404s - baseline.leaderboard404s,
      maxSimultaneousAthleteDetails: window.maxActiveAthleteDetails,
      maxSimultaneousLeaderboards: window.maxActiveLeaderboards,
    });
  }, durationMs);
  return () => {
    clearTimeout(timer);
    activeDiagnosticWindows.delete(window);
  };
}
