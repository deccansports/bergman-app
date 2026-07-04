type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const valueCache = new Map<string, CacheEntry<unknown>>();
const promiseCache = new Map<string, Promise<unknown>>();

export async function getCachedServerValue<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const cached = valueCache.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inFlight = promiseCache.get(key) as Promise<T> | undefined;
  if (inFlight) return inFlight;

  const pending = (async () => {
    try {
      const value = await loader();
      valueCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      promiseCache.delete(key);
    }
  })();

  promiseCache.set(key, pending);
  return pending;
}

export function invalidateServerCache(keyPrefix: string): void {
  for (const key of Array.from(valueCache.keys())) {
    if (key.startsWith(keyPrefix)) valueCache.delete(key);
  }
  for (const key of Array.from(promiseCache.keys())) {
    if (key.startsWith(keyPrefix)) promiseCache.delete(key);
  }
}

export function clearServerCache(): void {
  valueCache.clear();
  promiseCache.clear();
}
