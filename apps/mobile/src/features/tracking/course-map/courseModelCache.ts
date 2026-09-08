const MAX_CACHED_COURSE_MODELS = 24;

const courseModels = new Map<string, unknown>();

/**
 * Session cache for immutable course models. React memoization is intentionally
 * not the owner: it is lost on a route remount and used to rebuild the same
 * geometry even though the GPX parser cache still has the underlying points.
 */
export function getOrBuildCourseModel<T>(identity: string, build: () => T): T {
  if (courseModels.has(identity)) {
    const cached = courseModels.get(identity) as T;
    // Refresh insertion order so the cap behaves as a small LRU.
    courseModels.delete(identity);
    courseModels.set(identity, cached);
    return cached;
  }
  const model = build();
  courseModels.set(identity, model);
  while (courseModels.size > MAX_CACHED_COURSE_MODELS) {
    const oldest = courseModels.keys().next().value as string | undefined;
    if (!oldest) break;
    courseModels.delete(oldest);
  }
  return model;
}

export function clearCourseModelCacheForTests(): void {
  courseModels.clear();
}
