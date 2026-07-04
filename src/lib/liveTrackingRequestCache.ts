type CacheEntry<T> = {
  value?: T;
  promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<any>>();

export async function fetchJsonCached<T>(cacheKey: string, loader: () => Promise<T>, options?: { force?: boolean }): Promise<T> {
  const existing = cache.get(cacheKey);
  if (!options?.force) {
    if (existing && 'value' in existing && existing.value !== undefined) return existing.value as T;
    if (existing?.promise) return existing.promise as Promise<T>;
  }

  const promise = loader()
    .then((value) => {
      cache.set(cacheKey, { value });
      return value;
    })
    .catch((error) => {
      const current = cache.get(cacheKey);
      if (current?.promise === promise) cache.delete(cacheKey);
      throw error;
    });

  cache.set(cacheKey, { promise });
  return promise;
}

export function invalidateJsonCache(prefix: string) {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
