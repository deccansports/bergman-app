export type SplitMappingContestEntry = {
  enabledSplitUuids: string[];
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export type SplitMapping = {
  eventId: string;
  contests: Record<string, SplitMappingContestEntry>;
  version?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  source?: string;
};

export function normalize(value: unknown) {
  return String(value ?? '').trim();
}

export function normalizeSplitKey(value: unknown) {
  return normalize(value).toLowerCase();
}

export function extractSplitUuid(split: any): string {
  return normalize(
    split?.splitUuid ||
    split?.split_uuid ||
    split?.UUID ||
    split?.uuid ||
    split?.id ||
    split?.providerId ||
    split?.provider_id ||
    '',
  );
}

export function extractContestUuid(contest: any): string {
  return normalize(
    contest?.contestUuid ||
    contest?.contest_uuid ||
    contest?.uuid ||
    contest?.UUID ||
    contest?.id ||
    contest?.contest?.contestUuid ||
    contest?.contest?.uuid ||
    contest?.contest?.id ||
    '',
  );
}

export function normalizeSplitMapping(eventId: string, raw: any): SplitMapping {
  const contestsRaw = raw?.contests && typeof raw.contests === 'object' ? raw.contests : {};
  const contests: Record<string, SplitMappingContestEntry> = {};
  for (const [contestUuid, entry] of Object.entries(contestsRaw as Record<string, any>)) {
    const key = normalize(contestUuid);
    if (!key) continue;
    const enabledSplitUuids = Array.isArray(entry?.enabledSplitUuids)
      ? entry.enabledSplitUuids.map((value: unknown) => normalize(value)).filter(Boolean)
      : [];
    contests[key] = {
      enabledSplitUuids: Array.from(new Set(enabledSplitUuids)),
      updatedAt: normalize(entry?.updatedAt) || null,
      updatedBy: normalize(entry?.updatedBy) || null,
    };
  }
  return {
    eventId,
    contests,
    version: normalize(raw?.version) || null,
    updatedAt: normalize(raw?.updatedAt) || null,
    updatedBy: normalize(raw?.updatedBy) || null,
    source: normalize(raw?.source) || 'split-mapping',
  };
}

/**
 * Returns the set of enabled split UUIDs for a contest, or `null` when the admin
 * has not configured any split mapping for that contest. A `null` result means
 * "no splits should be shown on the athlete dashboard".
 */
export function getEnabledSplitSet(mapping: SplitMapping | null | undefined, contestUuid: string | null | undefined): Set<string> | null {
  const key = normalize(contestUuid);
  if (!mapping || !key) return null;
  const entry = mapping.contests?.[key]
    || Object.entries(mapping.contests || {}).find(([contestKey]) => normalizeSplitKey(contestKey) === normalizeSplitKey(key))?.[1];
  if (!entry || !Array.isArray(entry.enabledSplitUuids)) return null;
  return new Set(entry.enabledSplitUuids.map((value) => normalizeSplitKey(value)));
}

function filterContestSplits(contest: any, mapping: SplitMapping | null | undefined) {
  if (!contest || typeof contest !== 'object') return contest;
  const contestUuid = extractContestUuid(contest);
  const enabled = getEnabledSplitSet(mapping, contestUuid);
  const splits = Array.isArray(contest?.splits) ? contest.splits : [];
  const filtered = enabled === null
    ? []
    : splits.filter((split: any) => enabled.has(normalizeSplitKey(extractSplitUuid(split))));
  return {
    ...contest,
    splits: filtered,
    splitCount: filtered.length,
  };
}

/**
 * Produces a copy of the course index with each contest's splits restricted to
 * the splits the admin explicitly mapped to the athlete dashboard. Contests with
 * no mapping entry are stripped of all splits so the athlete modal shows nothing.
 */
export function applySplitMappingToCourseIndex<T extends Record<string, any>>(courseIndex: T, mapping: SplitMapping | null | undefined): T {
  if (!courseIndex || typeof courseIndex !== 'object') return courseIndex;
  const filterFn = (contest: any) => filterContestSplits(contest, mapping);
  const mapObject = (obj: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, filterFn(value)]));
  };

  const contestsSource = Array.isArray(courseIndex.contests)
    ? courseIndex.contests
    : Object.values(courseIndex.byContest || {});

  return {
    ...courseIndex,
    contests: contestsSource.map(filterFn),
    byContest: mapObject(courseIndex.byContest),
    contestLookup: mapObject(courseIndex.contestLookup),
  } as T;
}

function isEnabledSplit(split: any, enabled: Set<string>) {
  return enabled.has(normalizeSplitKey(extractSplitUuid(split)));
}

function filterSplitArray(splits: any, enabled: Set<string>) {
  if (!Array.isArray(splits)) return splits;
  return splits.filter((split: any) => isEnabledSplit(split, enabled));
}

/**
 * Client-safe filter for a resolved timing configuration. Restricts every split
 * collection to the splits the admin mapped to the athlete dashboard, keyed per
 * contest. Contests without a mapping entry have all splits removed so the
 * athlete modal renders no split summary.
 *
 * Timing points, legs, age groups and devices are left untouched so map markers
 * and other views keep working; only the split summary is affected.
 */
export function filterTimingConfigurationSplits<T extends Record<string, any>>(timingConfiguration: T | null | undefined, mapping: SplitMapping | null | undefined): T | null | undefined {
  if (!timingConfiguration || typeof timingConfiguration !== 'object') return timingConfiguration;

  const contestUuidOfSplit = (split: any) => normalizeSplitKey(
    split?.contestUuid || split?.contest_uuid || split?.ContestUUID || split?.contestUUID || split?.contest_id || split?.contestId || split?.contest || '',
  );

  const enabledCache = new Map<string, Set<string> | null>();
  const enabledForContest = (contestUuid: string) => {
    const key = normalizeSplitKey(contestUuid);
    if (enabledCache.has(key)) return enabledCache.get(key)!;
    const set = getEnabledSplitSet(mapping, contestUuid);
    enabledCache.set(key, set);
    return set;
  };

  const filterContestKeyedSplits = (obj: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    const next: Record<string, any> = {};
    for (const [contestKey, splits] of Object.entries(obj)) {
      const enabled = enabledForContest(contestKey);
      next[contestKey] = enabled === null ? [] : filterSplitArray(splits, enabled);
    }
    return next;
  };

  const filterContestCollection = (obj: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    const next: Record<string, any> = {};
    for (const [contestKey, contest] of Object.entries(obj as Record<string, any>)) {
      next[contestKey] = filterContestSplits(contest, mapping);
    }
    return next;
  };

  const filterContestArray = (arr: any) => {
    if (!Array.isArray(arr)) return arr;
    return arr.map((contest: any) => filterContestSplits(contest, mapping));
  };

  const filterFlatSplits = (splits: any) => {
    if (!Array.isArray(splits)) return splits;
    return splits.filter((split: any) => {
      const enabled = enabledForContest(contestUuidOfSplit(split));
      return enabled !== null && isEnabledSplit(split, enabled);
    });
  };

  const source = timingConfiguration as any;
  const next: Record<string, any> = { ...source };

  if (source.contests) next.contests = filterContestArray(source.contests);
  if (source.contestIndex) next.contestIndex = filterContestCollection(source.contestIndex);
  if (source.contestByUuid) next.contestByUuid = filterContestCollection(source.contestByUuid);
  if (source.contestByName) next.contestByName = filterContestCollection(source.contestByName);
  if (source.splitsByContest) next.splitsByContest = filterContestKeyedSplits(source.splitsByContest);
  if (source.splits) next.splits = filterFlatSplits(source.splits);
  if (source.course && typeof source.course === 'object') {
    next.course = {
      ...source.course,
      splits: filterFlatSplits(source.course.splits),
      contests: filterContestArray(source.course.contests),
    };
  }

  if (source.splitIndex && typeof source.splitIndex === 'object') {
    const splitIndex = source.splitIndex;
    next.splitIndex = {
      ...splitIndex,
      contestsByUuid: filterContestCollection(splitIndex.contestsByUuid),
      contestLookup: filterContestCollection(splitIndex.contestLookup),
      byContest: filterContestKeyedSplits(splitIndex.byContest),
      splitsByContest: filterContestKeyedSplits(splitIndex.splitsByContest),
      contests: filterContestArray(splitIndex.contests),
      splitByUuid: splitIndex.splitByUuid && typeof splitIndex.splitByUuid === 'object'
        ? Object.fromEntries(
            Object.entries(splitIndex.splitByUuid).filter(([, split]: [string, any]) => {
              const enabled = enabledForContest(contestUuidOfSplit(split));
              return enabled !== null && isEnabledSplit(split, enabled);
            }),
          )
        : splitIndex.splitByUuid,
    };
  }

  return next as T;
}
