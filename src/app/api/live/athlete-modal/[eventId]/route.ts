import { NextRequest, NextResponse } from 'next/server';
import { getKV } from '@/lib/cloudflare/kv';
import { loadParticipantPublicView } from '@/lib/liveTrackingParticipantStore';
import { canAccessPrivateLiveTracking, getParticipantLiveTrackingPrivacy, resolveLiveTrackingAccess } from '@/lib/liveTrackingPrivacy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeKey(value: unknown) {
  return normalize(value).toLowerCase();
}

function asObject(value: any) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeDistanceKm(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric === 0) return 0;
  return numeric >= 1000 ? numeric / 1000 : numeric;
}

function getSplitDistanceKm(split: any) {
  const candidates = [
    split?.cumulativeDistance,
    split?.cumulative_distance,
    split?.distanceFromStart,
    split?.distance_from_start,
    split?.distanceKm,
    split?.distance_km,
    split?.DistanceFromStart,
    split?.distance,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDistanceKm(candidate);
    if (normalized !== null) return normalized;
  }
  return null;
}

function getLegTheme(leg: any) {
  const token = String(leg?.name || leg?.label || leg?.type || leg?.sport || '').toLowerCase();
  if (token.includes('swim')) return 'swim';
  if (token.includes('bike') || token.includes('cycle')) return 'bike';
  if (token.includes('run')) return 'run';
  return 'other';
}

function summarizeContestCourse(contest: any) {
  const splits = Array.isArray(contest?.splits) ? contest.splits : [];
  const legs = Array.isArray(contest?.legs) ? contest.legs : [];
  const timingPoints = Array.isArray(contest?.timingPoints) ? contest.timingPoints : [];

  const orderedSplits = splits
    .map((split: any, index: number) => ({ split, index }))
    .sort((a: { split: any; index: number }, b: { split: any; index: number }) => {
      const aOrder = Number(a.split?.order ?? a.split?.Order ?? a.split?.index ?? a.split?.Index ?? a.index + 1) || (a.index + 1);
      const bOrder = Number(b.split?.order ?? b.split?.Order ?? b.split?.index ?? b.split?.Index ?? b.index + 1) || (b.index + 1);
      return aOrder - bOrder;
    })
    .map((entry: { split: any; index: number }) => entry.split);

  const splitDistanceByUuid: Record<string, number> = {};
  let totalDistanceKm = 0;
  for (const split of orderedSplits) {
    const splitUuid = normalize(split?.splitUuid || split?.uuid || split?.UUID || split?.id || '');
    const distanceKm = getSplitDistanceKm(split);
    if (distanceKm !== null) totalDistanceKm = Math.max(totalDistanceKm, distanceKm);
    if (splitUuid && distanceKm !== null) splitDistanceByUuid[splitUuid.toLowerCase()] = distanceKm;
  }

  const orderedLegs = [...legs].sort((a: any, b: any) => {
    const aOrder = Number(a?.order ?? a?.sequence ?? a?.sequence_no ?? a?.index ?? 0) || 0;
    const bOrder = Number(b?.order ?? b?.sequence ?? b?.sequence_no ?? b?.index ?? 0) || 0;
    return aOrder - bOrder;
  });

  const segmentTotals = { swim: 0, bike: 0, run: 0 };
  let previousEnd = 0;
  for (const leg of orderedLegs) {
    const firstSplitUuid = normalize(leg?.firstSplitUuid || leg?.first_split_uuid || '');
    const lastSplitUuid = normalize(leg?.lastSplitUuid || leg?.last_split_uuid || '');
    const fallbackMax = orderedSplits.reduce((max: number, split: any) => {
      const splitLegUuid = normalize(split?.legUuid || split?.leg_uuid || split?.leg?.uuid || split?.leg?.UUID || '');
      if (!splitLegUuid || splitLegUuid.toLowerCase() !== normalize(leg?.uuid || leg?.legUuid || '').toLowerCase()) return max;
      const distance = getSplitDistanceKm(split);
      return distance !== null ? Math.max(max, distance) : max;
    }, 0);
    const firstDistance = firstSplitUuid ? splitDistanceByUuid[firstSplitUuid.toLowerCase()] : undefined;
    const lastDistance = lastSplitUuid ? splitDistanceByUuid[lastSplitUuid.toLowerCase()] : undefined;
    const endDistance = Number.isFinite(lastDistance as number) ? Number(lastDistance) : fallbackMax;
    const startDistance = Number.isFinite(firstDistance as number) ? Number(firstDistance) : previousEnd;
    const legDistance = Math.max(0, endDistance - startDistance);
    const theme = getLegTheme(leg);
    if (theme === 'swim') segmentTotals.swim += legDistance;
    if (theme === 'bike') segmentTotals.bike += legDistance;
    if (theme === 'run') segmentTotals.run += legDistance;
    previousEnd = Math.max(previousEnd, endDistance);
  }

  return {
    swimDistanceKm: segmentTotals.swim,
    bikeDistanceKm: segmentTotals.bike,
    runDistanceKm: segmentTotals.run,
    totalDistanceKm,
    legCount: orderedLegs.length,
    splitCount: orderedSplits.length,
    timingPointCount: timingPoints.length,
    firstTimingPointName: normalize(timingPoints[0]?.displayName || timingPoints[0]?.shortName || timingPoints[0]?.name || timingPoints[0]?.label || '') || null,
  };
}

function extractContestRelatedRows(contestUuid: string | null, courseIndex: any) {
  if (!contestUuid) {
    return { contest: null, splits: [], timingPoints: [], ageGroups: [], devices: [] };
  }

  const contestIndex = asObject(courseIndex?.byContest || courseIndex?.contestLookup || {});

  const target = normalize(contestUuid).toLowerCase();
  const contest = contestIndex[target] || contestIndex[contestUuid] || contestIndex[target.toUpperCase()] || null;

  return {
    contest,
    splits: asObject(contest)?.splits || [],
    timingPoints: asObject(contest)?.timingPoints || [],
    ageGroups: asObject(contest)?.ageGroups || [],
    devices: asObject(contest)?.devices || Object.values(asObject(contest)?.lookup?.deviceByUuid || {}),
    legs: asObject(contest)?.legs || [],
  };
}

async function loadContestMapping(eventId: string) {
  return getKV<any>(`live:event:${eventId}:contest:mapping`, 'api-live-athlete-modal').catch(() => null);
}

function resolveContestMappingEntry(savedMapping: any, contestUuid: string | null) {
  const target = normalize(contestUuid);
  if (!target || !savedMapping || typeof savedMapping !== 'object') return null;

  const targetLower = target.toLowerCase();
  const mappingObject = savedMapping?.mapping && typeof savedMapping.mapping === 'object'
    ? savedMapping.mapping
    : savedMapping?.ticketsById && typeof savedMapping.ticketsById === 'object'
      ? savedMapping.ticketsById
      : savedMapping;

  const direct = mappingObject?.[target] || mappingObject?.[targetLower] || null;
  if (direct) return direct;

  if (savedMapping?.contestToTicket && typeof savedMapping.contestToTicket === 'object' && savedMapping?.ticketsById && typeof savedMapping.ticketsById === 'object') {
    const mappingId = savedMapping.contestToTicket[target] || savedMapping.contestToTicket[targetLower] || null;
    if (mappingId && savedMapping.ticketsById[mappingId]) return savedMapping.ticketsById[mappingId];
  }

  for (const [key, value] of Object.entries(mappingObject as Record<string, any>)) {
    if (normalizeKey(key) === targetLower) return value;
    if (normalizeKey((value as any)?.feibotContestUuid || (value as any)?.contestUuid || (value as any)?.uuid) === targetLower) return value;
  }

  return null;
}

function isMappedContestEntry(entry: any) {
  if (!entry || typeof entry !== 'object') return false;
  const status = normalize(entry?.status || (entry?.bergmanContestId || entry?.ticketId ? 'mapped' : '')).toLowerCase();
  if (status === 'unmapped' || status === 'invalid') return false;
  return Boolean(entry?.bergmanContestId || entry?.ticketId || entry?.bergmanCategoryId || entry?.mappingId || status === 'mapped');
}

function sanitizeContestForAthlete(contest: any) {
  if (!contest || typeof contest !== 'object') return contest;
  return {
    ...contest,
    splits: [],
    timingPoints: [],
    lookup: {
      ...(contest.lookup || {}),
      splitByUuid: {},
      timingPointByUuid: {},
    },
  };
}

function buildTimingConfigurationFromCourseIndex(courseIndex: any) {
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

  return {
    eventId: courseIndex?.eventId || null,
    source: 'cloud' as const,
    provider: courseIndex?.provider || 'feibot',
    updatedAt: courseIndex?.updatedAt || null,
    course: {
      legs: contests.flatMap((contest: any) => Array.isArray(contest?.legs) ? contest.legs : []),
      timingPoints: contests.flatMap((contest: any) => Array.isArray(contest?.timingPoints) ? contest.timingPoints : []),
      splits: contests.flatMap((contest: any) => Array.isArray(contest?.splits) ? contest.splits : []),
      contests,
    },
    contests,
    contestIndex,
    contestByUuid: contestIndex,
    contestByName,
    splits: contests.flatMap((contest: any) => Array.isArray(contest?.splits) ? contest.splits : []),
    timingPoints: contests.flatMap((contest: any) => Array.isArray(contest?.timingPoints) ? contest.timingPoints : []),
    ageGroups: contests.flatMap((contest: any) => Array.isArray(contest?.ageGroups) ? contest.ageGroups : []),
    devices: contests.flatMap((contest: any) => Array.isArray(contest?.devices) ? contest.devices : []),
    legs: contests.flatMap((contest: any) => Array.isArray(contest?.legs) ? contest.legs : []),
    splitsByContest,
    timingPointsByContest,
    ageGroupsByContest,
    legsByContest,
    devicesByContest,
    timingPointIndex,
    splitSource: 'KV',
    sourceLabel: 'KV:courseIndex',
    splitIndex: {
      contestsByUuid: contestIndex,
      byContest: splitsByContest,
      splitsByContest,
      splitByUuid: Object.fromEntries(contests.flatMap((contest: any) => (Array.isArray(contest?.splits) ? contest.splits : []).map((split: any) => [normalize(split?.splitUuid || split?.uuid || split?.id || '').toLowerCase(), split]))),
      contests,
      contestLookup: contestIndex,
    },
    ageGroupIndex: {
      byContest: ageGroupsByContest,
      list: contests.flatMap((contest: any) => Array.isArray(contest?.ageGroups) ? contest.ageGroups : []),
    },
    legIndex: {
      byContest: legsByContest,
      list: contests.flatMap((contest: any) => Array.isArray(contest?.legs) ? contest.legs : []),
    },
    deviceIndex: {
      byContest: devicesByContest,
      list: contests.flatMap((contest: any) => Array.isArray(contest?.devices) ? contest.devices : []),
    },
  };
}

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalize(params?.eventId);
    const bib = normalize(req.nextUrl.searchParams.get('bib'));
    const providerUuid = normalize(req.nextUrl.searchParams.get('providerUuid'));
    const athleteUid = normalize(req.nextUrl.searchParams.get('athleteUid'));
    const bookingId = normalize(req.nextUrl.searchParams.get('bookingId'));
    const access = await resolveLiveTrackingAccess(req);

    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }
    if (!bib && !athleteUid && !providerUuid && !bookingId) {
      return NextResponse.json({ success: false, message: 'bib, providerUuid, athleteUid, or bookingId is required' }, { status: 400 });
    }

    console.log('[AthleteModal] Lookup Request', { eventId, bib, providerUuid, athleteUid, bookingId: bookingId || null });
    console.log('[AthleteModal] participant:index loaded', { eventId, source: `live:event:${eventId}:participant:index` });

    const resolved = await loadParticipantPublicView(eventId, {
      bookingId,
      bib,
      athleteUid,
      providerParticipantUuid: providerUuid,
    });
    if (!resolved) {
      void fetch(`${req.nextUrl.origin}/api/live/athlete-master-search/${encodeURIComponent(eventId)}`, {
        method: 'POST',
        headers: { 'x-bergman-internal-token': req.headers.get('x-bergman-internal-token') || '' },
      }).catch(() => null);

      return NextResponse.json({ success: false, eventId, message: 'Athlete profile is rebuilding. Please try again shortly.' }, { status: 404 });
    }

    console.log('[AthleteModal] identity resolved', {
      eventId,
      resolvedBookingId: resolved?.bookingId || null,
      contestUuid: resolved?.contestUuid || null,
      contestName: resolved?.contestName || null,
    });

    const privacy = getParticipantLiveTrackingPrivacy(resolved?.merged || resolved?.participant || null);
    if (privacy === 'PRIVATE' && !canAccessPrivateLiveTracking(resolved?.merged || resolved?.participant || null, access)) {
      return NextResponse.json({ success: false, eventId, message: 'This athlete has chosen not to share live tracking.' }, { status: 403 });
    }

    console.log('[AthleteModal] timingParticipant loaded', { eventId, resolvedBookingId: resolved.bookingId || null, loaded: Boolean(resolved.participant) });
    console.log('[AthleteModal] participantLive loaded', { eventId, resolvedBookingId: resolved.bookingId || null, loaded: Boolean(resolved.participantLive) });

    const courseIndex = await getKV<any>(`live:event:${eventId}:course:index`, 'api-live-athlete-modal');
    if (!courseIndex || typeof courseIndex !== 'object') {
      return NextResponse.json({ success: false, eventId, message: 'Course configuration missing' }, { status: 500 });
    }

    const contestContext = extractContestRelatedRows(resolved.contestUuid, courseIndex);
    if (!contestContext?.contest) {
      return NextResponse.json({ success: false, eventId, message: 'Course configuration missing' }, { status: 500 });
    }

    const savedContestMapping = await loadContestMapping(eventId);
    const contestMappingEntry = resolveContestMappingEntry(savedContestMapping, resolved.contestUuid);
    const courseSummary = summarizeContestCourse(contestContext.contest);
    const splitMappingReady = Boolean(
      isMappedContestEntry(contestMappingEntry)
      && courseSummary.splitCount > 0
      && courseSummary.timingPointCount > 0,
    );
    const timingConfiguration = splitMappingReady ? buildTimingConfigurationFromCourseIndex(courseIndex) : null;
    const athleteContestContext = splitMappingReady
      ? contestContext
      : {
          ...contestContext,
          contest: sanitizeContestForAthlete(contestContext.contest),
          splits: [],
          timingPoints: [],
          legs: [],
        };
    const timingStarted = Boolean(
      resolved?.participantLive?.startTime
      || resolved?.participantLive?.start_time
      || resolved?.participantLive?.lastTimingPoint
      || resolved?.participantLive?.lastTimingPointName
      || resolved?.participant?.startTime
      || resolved?.participant?.start_time,
    );
    const currentSplitName = normalize(
      resolved?.participantLive?.currentSplit
      || resolved?.participantLive?.nextSplit
      || resolved?.participantLive?.expectedNextSplit
      || '',
    ) || null;
    const currentLegName = timingStarted
      ? normalize(resolved?.participantLive?.currentLeg || resolved?.participantLive?.lastLegName || '') || null
      : 'Not Started';
    const distanceCoveredKm = timingStarted
      ? Number(resolved?.participantLive?.distanceCovered ?? resolved?.participantLive?.distance_completed ?? 0) || 0
      : 0;
    const distanceRemainingKm = Math.max(0, Number(courseSummary.totalDistanceKm || 0) - distanceCoveredKm);
    const currentCheckpoint = timingStarted ? currentSplitName : null;

    console.log('[AthleteModal] course:index loaded', {
      eventId,
      loaded: Boolean(courseIndex),
      contestUuid: resolved.contestUuid || null,
      contestName: normalize((contestContext as any)?.contest?.contestName || (contestContext as any)?.contest?.name || '') || null,
      swimDistanceKm: courseSummary.swimDistanceKm,
      bikeDistanceKm: courseSummary.bikeDistanceKm,
      runDistanceKm: courseSummary.runDistanceKm,
      totalDistanceKm: courseSummary.totalDistanceKm,
      legCount: courseSummary.legCount,
      splitCount: courseSummary.splitCount,
      timingPointCount: courseSummary.timingPointCount,
      splitMappingReady,
      contestMappingSaved: Boolean(contestMappingEntry),
      currentLeg: currentLegName,
      currentSplit: timingStarted ? currentSplitName : 'Waiting for Start',
      currentCheckpoint: currentCheckpoint || '—',
      distanceRemainingKm,
    });

    return NextResponse.json({
      success: true,
      eventId,
      athlete: {
        ...resolved.merged,
        profile: null,
        registration: resolved.participant,
        participantLive: resolved.participantLive,
      },
      contestContext: athleteContestContext,
      contestDefinition: athleteContestContext.contest,
      timingConfiguration,
      courseIndex: splitMappingReady ? courseIndex : null,
      splitMapping: {
        ready: splitMappingReady,
        status: splitMappingReady ? 'mapped' : contestMappingEntry ? 'incomplete' : 'pending',
        contestMapped: Boolean(contestMappingEntry && isMappedContestEntry(contestMappingEntry)),
        splitCount: splitMappingReady ? courseSummary.splitCount : 0,
        timingPointCount: splitMappingReady ? courseSummary.timingPointCount : 0,
        message: splitMappingReady
          ? 'Split mapping is ready.'
          : 'Split mapping is not available for this athlete yet.',
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to resolve athlete modal context' }, { status: 500 });
  }
}
