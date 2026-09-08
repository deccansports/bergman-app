// Socket events are primary. This is only bounded recovery for a missed or
// unhealthy stream while an on-course athlete detail screen remains active.
export const LIVE_ATHLETE_FALLBACK_MS = 10_000;
export const NOT_STARTED_ATHLETE_FALLBACK_MS = 30_000;
export const SOCKET_HEARTBEAT_INTERVAL_MS = 10_000;
export const SOCKET_HEARTBEAT_STALE_MS = 25_000;
export const SOCKET_HEALTH_CHECK_MS = 5_000;

const TERMINAL_STATUSES = new Set([
  "FINISHED",
  "DNS",
  "DNF",
  "DNQ",
  "DSQ",
  "DISQUALIFIED",
]);

export function canonicalAthleteStatus(data: unknown): string {
  const direct = typeof data === "string" ? data : "";
  const root =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const canonicalData =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : {};
  const athlete =
    root.athlete && typeof root.athlete === "object"
      ? (root.athlete as Record<string, unknown>)
      : {};
  const participantLive =
    root.participantLive && typeof root.participantLive === "object"
      ? (root.participantLive as Record<string, unknown>)
      : {};
  const resolvedRaceState =
    participantLive.resolvedRaceState &&
    typeof participantLive.resolvedRaceState === "object"
      ? (participantLive.resolvedRaceState as Record<string, unknown>)
      : {};
  const status = String(
    direct ||
      resolvedRaceState.status ||
      participantLive.status ||
      root.status ||
      athlete.status ||
      canonicalData.status ||
      "",
  )
    .trim()
    .toUpperCase();
  if (status === "LIVE" || status === "ON_COURSE") return "ACTIVE";
  if (status === "NOTSTARTED") return "NOT_STARTED";
  return status;
}

export function athleteDetailFallbackInterval(
  data: unknown,
  socketHealthy: boolean,
): number | false {
  if (socketHealthy) return false;
  const status = canonicalAthleteStatus(data);
  if (TERMINAL_STATUSES.has(status)) return false;
  if (
    status === "NOT_STARTED" ||
    status === "UPCOMING" ||
    status === "WAITING_CHIP_START" ||
    status === "WAITING_GUN_START" ||
    !status
  ) {
    return NOT_STARTED_ATHLETE_FALLBACK_MS;
  }
  return LIVE_ATHLETE_FALLBACK_MS;
}

export function isSocketHeartbeatFresh(input: {
  readyState: number;
  openReadyState: number;
  lastMessageAt: number;
  now: number;
  staleAfterMs?: number;
}): boolean {
  return (
    input.readyState === input.openReadyState &&
    input.lastMessageAt > 0 &&
    input.now - input.lastMessageAt <=
      (input.staleAfterMs ?? SOCKET_HEARTBEAT_STALE_MS)
  );
}

export function createSingleFlightRefetch<T>(
  refetch: () => Promise<T>,
): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const request = Promise.resolve().then(refetch);
    inFlight = request;
    void request.then(
      () => {
        if (inFlight === request) inFlight = null;
      },
      () => {
        if (inFlight === request) inFlight = null;
      },
    );
    return request;
  };
}

function supersededSelectionError(): Error {
  const error = new Error("Athlete selection was superseded.");
  error.name = "AbortError";
  return error;
}

/** Serialize reads across distinct athlete query keys and keep only the latest queued selection. */
export function createSelectedAthleteRequestCoordinator<T>() {
  type Pending = {
    key: string;
    request: (signal: AbortSignal) => Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
  };
  let active: {
    key: string;
    controller: AbortController;
    promise: Promise<T>;
  } | null = null;
  let queued: Pending | null = null;

  const start = (pending: Pending) => {
    const controller = new AbortController();
    const promise = Promise.resolve().then(() =>
      pending.request(controller.signal),
    );
    active = { key: pending.key, controller, promise };
    void promise.then(pending.resolve, pending.reject).finally(() => {
      if (active?.promise !== promise) return;
      active = null;
      const next = queued;
      queued = null;
      if (next) start(next);
    });
  };

  return (key: string, request: (signal: AbortSignal) => Promise<T>) => {
    if (active?.key === key && !active.controller.signal.aborted && !queued) {
      return active.promise;
    }
    return new Promise<T>((resolve, reject) => {
      if (!active) {
        start({ key, request, resolve, reject });
        return;
      }
      active.controller.abort();
      if (queued) queued.reject(supersededSelectionError());
      queued = { key, request, resolve, reject };
    });
  };
}
