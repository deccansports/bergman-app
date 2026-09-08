export function createSingleFlight<TKey extends string, TResult>(
  request: (key: TKey) => Promise<TResult>,
): (key: TKey) => Promise<TResult> {
  const inFlight = new Map<TKey, Promise<TResult>>();
  return (key) => {
    const current = inFlight.get(key);
    if (current) return current;
    const pending = request(key).finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
    inFlight.set(key, pending);
    return pending;
  };
}

/** Observe shared work without letting one unmounted consumer cancel it for all. */
export function observeSharedRequest<TResult>(
  request: Promise<TResult>,
  signal?: AbortSignal,
): Promise<TResult> {
  if (!signal) return request;
  if (signal.aborted) {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    return Promise.reject(error);
  }
  return new Promise<TResult>((resolve, reject) => {
    const abort = () => {
      cleanup();
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      reject(error);
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    request.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
