const inFlightSearches = new Map<string, Promise<unknown>>();
const diagnostics = { requests: 0, aborts: 0, singleFlightHits: 0 };

function abortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Aborted", "AbortError");
  }
  return Object.assign(new Error("Aborted"), { name: "AbortError" });
}

function withCallerAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    diagnostics.aborts += 1;
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      diagnostics.aborts += 1;
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

export function athleteSearchSingleFlightKey(
  eventId: string,
  mode: string,
  query: string,
  providerScope = "event-wide",
  kvOnly = true,
): string {
  return [
    eventId.trim(),
    providerScope.trim().toLowerCase(),
    mode.trim().toLowerCase(),
    query.trim().toLowerCase(),
    kvOnly ? "kv-only" : "any-source",
  ].join(":");
}

export function runAthleteSearchSingleFlight<T>(
  key: string,
  request: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const active = inFlightSearches.get(key) as Promise<T> | undefined;
  if (active) {
    diagnostics.singleFlightHits += 1;
    return withCallerAbort(active, signal);
  }
  diagnostics.requests += 1;
  const owner = request();
  inFlightSearches.set(key, owner);
  const release = () => {
    if (inFlightSearches.get(key) === owner) inFlightSearches.delete(key);
  };
  void owner.then(release, release);
  return withCallerAbort(owner, signal);
}

export function snapshotAthleteSearchDiagnostics(): Readonly<
  typeof diagnostics
> {
  return { ...diagnostics };
}

export function resetAthleteSearchSingleFlightForTests(): void {
  inFlightSearches.clear();
  diagnostics.requests = 0;
  diagnostics.aborts = 0;
  diagnostics.singleFlightHits = 0;
}
