import { NextRequest, NextResponse } from 'next/server';
import { getKV } from '@/lib/cloudflare/kv';
import { loadParticipantPublicView } from '@/lib/liveTrackingParticipantStore';
import { canAccessPrivateLiveTracking, getParticipantLiveTrackingPrivacy, resolveLiveTrackingAccess } from '@/lib/liveTrackingPrivacy';
import { applySplitMappingToCourseIndex, getEnabledSplitSet, loadSplitMapping } from '@/lib/live-tracking/splitMapping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalize(value: unknown) {
  return String(value ?? '').trim();
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

    const rawCourseIndex = await getKV<any>(`live:event:${eventId}:course:index`, 'api-live-athlete-modal');
    if (!rawCourseIndex || typeof rawCourseIndex !== 'object') {
      return NextResponse.json({ success: false, eventId, message: 'Course configuration missing' }, { status: 500 });
    }

    // Only expose splits that an admin has explicitly mapped to the athlete
    // dashboard. Contests without a saved split mapping surface no splits at all.
    const splitMapping = await loadSplitMapping(eventId).catch(() => null);
    const enabledSplitSet = getEnabledSplitSet(splitMapping, resolved.contestUuid);
    const courseIndex = applySplitMappingToCourseIndex(rawCourseIndex, splitMapping);

    const contestContext = extractContestRelatedRows(resolved.contestUuid, courseIndex);
    if (!contestContext?.contest) {
      return NextResponse.json({ success: false, eventId, message: 'Course configuration missing' }, { status: 500 });
    }

    const timingConfiguration = buildTimingConfigurationFromCourseIndex(courseIndex);
    const splitDashboard = {
      configured: enabledSplitSet !== null,
      enabledCount: enabledSplitSet ? enabledSplitSet.size : 0,
      visibleSplitCount: Array.isArray(contestContext?.splits) ? contestContext.splits.length : 0,
    };
    const courseSummary = summarizeContestCourse(contestContext.contest);
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
      contestContext,
      contestDefinition: contestContext.contest,
      timingConfiguration,
      courseIndex,
      splitDashboard,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to resolve athlete modal context' }, { status: 500 });
  }
}
