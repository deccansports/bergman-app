function normalize(value: unknown) {
  return String(value ?? '').trim();
}

export function buildTimingConfigurationFromCourseIndex(courseIndex: any) {
  const contests = Array.isArray(courseIndex?.contests)
    ? courseIndex.contests
    : Object.values(courseIndex?.byContest || {});
  const contestIndex: Record<string, any> = {};
  const contestByName: Record<string, any> = {};
  const splitsByContest: Record<string, any[]> = {};
  const timingPointsByContest: Record<string, any[]> = {};
  const ageGroupsByContest: Record<string, any[]> = {};
  const devicesByContest: Record<string, any[]> = {};
  const legsByContest: Record<string, any[]> = {};
  const timingPointIndex: Record<string, any> = {};

  for (const contest of contests) {
    const contestKey = normalize(contest?.contestUuid || contest?.uuid || contest?.id);
    const contestKeyLower = contestKey.toLowerCase();
    const contestNameKey = normalize(contest?.contestName || contest?.name || '').toLowerCase();
    contestIndex[contestKey] = contest;
    contestIndex[contestKeyLower] = contest;
    if (contestNameKey) contestByName[contestNameKey] = contest;
    splitsByContest[contestKey] = Array.isArray(contest?.splits) ? contest.splits : [];
    splitsByContest[contestKeyLower] = splitsByContest[contestKey];
    timingPointsByContest[contestKey] = Array.isArray(contest?.timingPoints) ? contest.timingPoints : [];
    timingPointsByContest[contestKeyLower] = timingPointsByContest[contestKey];
    ageGroupsByContest[contestKey] = Array.isArray(contest?.ageGroups) ? contest.ageGroups : [];
    ageGroupsByContest[contestKeyLower] = ageGroupsByContest[contestKey];
    devicesByContest[contestKey] = Array.isArray(contest?.devices) ? contest.devices : [];
    devicesByContest[contestKeyLower] = devicesByContest[contestKey];
    legsByContest[contestKey] = Array.isArray(contest?.legs) ? contest.legs : [];
    legsByContest[contestKeyLower] = legsByContest[contestKey];

    for (const point of Array.isArray(contest?.timingPoints) ? contest.timingPoints : []) {
      const pointKey = normalize(point?.id || point?.uuid || point?.canonicalUuid || '');
      if (pointKey) timingPointIndex[pointKey] = point;
    }
  }

  const flatSplits = contests.flatMap((contest: any) => Array.isArray(contest?.splits) ? contest.splits : []);
  const flatTimingPoints = contests.flatMap((contest: any) => Array.isArray(contest?.timingPoints) ? contest.timingPoints : []);
  const flatAgeGroups = contests.flatMap((contest: any) => Array.isArray(contest?.ageGroups) ? contest.ageGroups : []);
  const flatDevices = contests.flatMap((contest: any) => Array.isArray(contest?.devices) ? contest.devices : []);
  const flatLegs = contests.flatMap((contest: any) => Array.isArray(contest?.legs) ? contest.legs : []);

  return {
    eventId: courseIndex?.eventId || null,
    source: 'cloud' as const,
    provider: courseIndex?.provider || 'feibot',
    updatedAt: courseIndex?.updatedAt || null,
    course: {
      legs: flatLegs,
      timingPoints: flatTimingPoints,
      splits: flatSplits,
      contests,
    },
    contests,
    contestIndex,
    contestByUuid: contestIndex,
    contestByName,
    splits: flatSplits,
    timingPoints: flatTimingPoints,
    ageGroups: flatAgeGroups,
    devices: flatDevices,
    legs: flatLegs,
    splitsByContest,
    timingPointsByContest,
    ageGroupsByContest,
    legsByContest,
    devicesByContest,
    timingPointIndex,
    cutoffs: courseIndex?.cutoffs || null,
    splitIndex: {
      contestsByUuid: contestIndex,
      byContest: splitsByContest,
      splitsByContest,
      splitByUuid: Object.fromEntries(
        flatSplits
          .map((split: any) => [normalize(split?.splitUuid || split?.uuid || split?.id || '').toLowerCase(), split] as [string, any])
          .filter(([key]: [string, any]) => Boolean(key)),
      ),
      contests,
      contestLookup: contestIndex,
    },
    ageGroupIndex: {
      byContest: ageGroupsByContest,
      list: flatAgeGroups,
    },
    legIndex: {
      byContest: legsByContest,
      list: flatLegs,
    },
    deviceIndex: {
      byContest: devicesByContest,
      list: flatDevices,
    },
    splitSource: 'KV',
    sourceLabel: 'KV:courseIndex',
  };
}
