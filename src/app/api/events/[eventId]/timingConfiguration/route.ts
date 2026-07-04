import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { buildResolvedTimingConfiguration } from '@/lib/timingConfiguration';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import { loadSplitIndex, rebuildSplitIndexInKv } from '@/lib/splitIndex';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest) {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  const token = req.headers.get('x-bergman-internal-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return token === expectedToken;
}

async function loadEventRecord(eventId: string) {
  const db = getFirestoreInstance();
  const eventRef = db.collection('events').doc(eventId);
  const eventSnap = await eventRef.get();
  if (eventSnap.exists) return { ref: eventRef, data: serializeValue(eventSnap.data() || {}) || {} };

  const legacyRef = db.collection('eventCalendar').doc(eventId);
  const legacySnap = await legacyRef.get();
  if (legacySnap.exists) return { ref: legacyRef, data: serializeValue(legacySnap.data() || {}) || {} };

  return null;
}

async function loadTimingSnapshot(eventId: string) {
  const snapshot = (await getKV<Record<string, any>>(`event:${eventId}:timingConfiguration`, 'api-timing-configuration')) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:timingConfiguration`, 'api-timing-configuration')) ||
    null;

  if (!snapshot) return null;

  return {
    ...snapshot,
    source: snapshot?.source || snapshot?.provider || 'feibot',
    eventId,
  };
}

async function loadSplitIndexSnapshot(eventId: string) {
  return loadSplitIndex(eventId);
}

async function loadContestIndexSnapshot(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`event:${eventId}:contestIndex`, 'api-timing-configuration')) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:contestIndex`, 'api-timing-configuration')) ||
    null
  );
}

async function loadTimingPointIndexSnapshot(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`event:${eventId}:timingPointIndex`, 'api-timing-configuration')) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:timingPointIndex`, 'api-timing-configuration')) ||
    null
  );
}

async function loadAgeGroupIndexSnapshot(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`event:${eventId}:ageGroupIndex`, 'api-timing-configuration')) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:ageGroupIndex`, 'api-timing-configuration')) ||
    null
  );
}

function collectTimingCollections(source: Record<string, any> | null | undefined) {
  const timingRoot = source?.timings || source?.timing_rules || source?.timingConfiguration || source || {};
  const courseRoot = timingRoot?.course || source?.course || {};
  return {
    contests: Array.isArray(timingRoot?.contests) ? timingRoot.contests : Array.isArray(courseRoot?.contests) ? courseRoot.contests : [],
    timingPoints: Array.isArray(timingRoot?.timingPoints)
      ? timingRoot.timingPoints
      : Array.isArray(timingRoot?.timing_points)
        ? timingRoot.timing_points
        : Array.isArray(courseRoot?.timingPoints)
          ? courseRoot.timingPoints
          : Array.isArray(courseRoot?.timing_points)
            ? courseRoot.timing_points
            : [],
    splits: Array.isArray(timingRoot?.splits) ? timingRoot.splits : Array.isArray(courseRoot?.splits) ? courseRoot.splits : [],
    devices: Array.isArray(timingRoot?.devices) ? timingRoot.devices : Array.isArray(courseRoot?.devices) ? courseRoot.devices : [],
    legs: Array.isArray(timingRoot?.legs) ? timingRoot.legs : Array.isArray(courseRoot?.legs) ? courseRoot.legs : [],
    ageGroups: Array.isArray(timingRoot?.ageGroups) ? timingRoot.ageGroups : Array.isArray(courseRoot?.ageGroups) ? courseRoot.ageGroups : [],
  };
}

function buildTimingConfigFromEvent(data: Record<string, any>) {
  const liveTrackingHub = data?.liveTrackingHub || data?.liveTracking || {};
  const cloud = data?.timingConfiguration?.cloud || data?.liveTimingConfig?.timingConfiguration?.cloud || null;
  const manual = data?.timingConfiguration?.manual || null;
  const categoryTimingConfiguration = data?.liveTrackingHub?.categoryTimingConfiguration || liveTrackingHub?.categoryTimingConfiguration || [];
  const stored = data?.timingConfiguration || data?.liveTimingConfig?.timingConfiguration || null;
  const overrides = data?.timingConfigurationOverrides || {};
  const directTimingSource =
    data?.timing_rules ||
    data?.timingConfiguration ||
    data?.liveTimingConfig?.timingConfiguration ||
    data?.liveTrackingHub?.feibotConfig?.timingConfiguration ||
    data?.liveTrackingHub?.feibotConfig?.timingRules ||
    data?.course ||
    null;
  const normalizedDirectTimingSource = directTimingSource ? collectTimingCollections(directTimingSource) : null;

  const applyOverrides = (config: any) => {
    const pointOverrides = overrides?.timingPoints && typeof overrides.timingPoints === 'object' ? overrides.timingPoints : {};
    const points = (Array.isArray(config?.timingPoints) ? config.timingPoints : []).map((point: any) => {
      const byId = pointOverrides?.[String(point?.id || '')] || null;
      const byProvider = pointOverrides?.[String(point?.providerId || point?.providerCode || '')] || null;
      const override = byId || byProvider;
      if (!override || typeof override !== 'object') return point;
      return {
        ...point,
        ...override,
        latitude: Number(override?.latitude ?? point?.latitude ?? 0),
        longitude: Number(override?.longitude ?? point?.longitude ?? 0),
      };
    });
    return {
      ...config,
      timingPoints: points,
      course: {
        ...(config?.course || {}),
        timingPoints: points,
      },
    };
  };

  return applyOverrides({
    source: stored?.source || liveTrackingHub?.feibotConfig?.timingRuleSource || data?.liveTimingConfig?.timingRuleSource || 'feibot',
    eventId: data?.eventId || null,
    contests: Array.isArray(stored?.contests) ? stored.contests : normalizedDirectTimingSource?.contests || [],
    timingPoints: Array.isArray(stored?.timingPoints) ? stored.timingPoints : normalizedDirectTimingSource?.timingPoints || [],
    splits: Array.isArray(stored?.splits) ? stored.splits : normalizedDirectTimingSource?.splits || [],
    devices: Array.isArray(stored?.devices) ? stored.devices : normalizedDirectTimingSource?.devices || [],
    legs: Array.isArray(stored?.legs) ? stored.legs : normalizedDirectTimingSource?.legs || [],
    ageGroups: Array.isArray(stored?.ageGroups) ? stored.ageGroups : normalizedDirectTimingSource?.ageGroups || [],
    contestIndex: stored?.contestIndex || (normalizedDirectTimingSource as any)?.contestIndex || {},
    contestByUuid: stored?.contestByUuid || (normalizedDirectTimingSource as any)?.contestByUuid || {},
    contestByName: stored?.contestByName || (normalizedDirectTimingSource as any)?.contestByName || {},
    splitsByContest: stored?.splitsByContest || (normalizedDirectTimingSource as any)?.splitsByContest || {},
    timingPointsByContest: stored?.timingPointsByContest || (normalizedDirectTimingSource as any)?.timingPointsByContest || {},
    ageGroupsByContest: stored?.ageGroupsByContest || (normalizedDirectTimingSource as any)?.ageGroupsByContest || {},
    importedAt: stored?.importedAt || data?.timingConfiguration?.importedAt || null,
    provider: stored?.provider || 'feibot',
    course: stored?.course || (normalizedDirectTimingSource as any)?.course || { legs: [], timingPoints: [], splits: [], contests: [] },
  } as any);
}

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = String(params.eventId || '').trim();
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });

    const snapshot = await loadTimingSnapshot(eventId);
    if (snapshot) {
      let splitIndex = await loadSplitIndexSnapshot(eventId);
      let contestIndex = await loadContestIndexSnapshot(eventId);
      let timingPointIndex = await loadTimingPointIndexSnapshot(eventId);
      let ageGroupIndex = await loadAgeGroupIndexSnapshot(eventId);
      const snapshotData = snapshot as any;
      const resolvedTimingConfiguration = buildResolvedTimingConfiguration({
        eventId,
        cloud: snapshotData,
        sourceHint: snapshotData?.source || snapshotData?.provider || 'feibot',
        importedAt: snapshotData?.importedAt || null,
        provider: snapshotData?.provider || 'feibot',
      });
      console.log('[timingConfiguration API] snapshot', {
        eventId,
        topLevelKeys: Object.keys(snapshotData),
        contestCount: Array.isArray(resolvedTimingConfiguration?.contests) ? resolvedTimingConfiguration.contests.length : 0,
        splitCount: Array.isArray(resolvedTimingConfiguration?.splits) ? resolvedTimingConfiguration.splits.length : 0,
        timingPointCount: Array.isArray(resolvedTimingConfiguration?.timingPoints) ? resolvedTimingConfiguration.timingPoints.length : 0,
      });

      const hasDerivedIndexes = Boolean(
        Number(splitIndex?.splitCount || 0) > 0 &&
        contestIndex && Object.keys(contestIndex).length > 0 &&
        timingPointIndex && Object.keys(timingPointIndex).length > 0 &&
        ageGroupIndex && Object.keys(ageGroupIndex).length > 0,
      );

      if (!hasDerivedIndexes) {
        const timingPayload = (snapshotData?.timingConfiguration || snapshotData) as any;
        console.warn('[timingConfiguration API] derived indexes missing, rebuilding from canonical snapshot', {
          eventId,
          hasSplitIndex: Boolean(splitIndex),
          contestIndexSize: contestIndex ? Object.keys(contestIndex).length : 0,
          timingPointIndexSize: timingPointIndex ? Object.keys(timingPointIndex).length : 0,
          ageGroupIndexSize: ageGroupIndex ? Object.keys(ageGroupIndex).length : 0,
        });

        const rebuildResult = await rebuildSplitIndexInKv({
          eventId,
          timingConfiguration: timingPayload,
          provider: String(snapshotData?.provider || timingPayload?.provider || 'feibot'),
          generatedBy: 'api-timing-configuration-repair',
          syncType: 'timing-configuration-repair',
          sourceVersion: String(snapshotData?.version || timingPayload?.version || snapshotData?.updatedAt || ''),
        });

        console.log('[timingConfiguration API] derived indexes rebuilt', {
          eventId,
          rebuildStatus: rebuildResult.status,
        });

        splitIndex = await loadSplitIndexSnapshot(eventId);
        contestIndex = await loadContestIndexSnapshot(eventId);
        timingPointIndex = await loadTimingPointIndexSnapshot(eventId);
        ageGroupIndex = await loadAgeGroupIndexSnapshot(eventId);
      }

      console.log('[timingConfiguration API] derived index counts', {
        eventId,
        contestIndex: contestIndex ? Object.keys(contestIndex).length : 0,
        splitIndex: splitIndex?.splitCount || 0,
        timingPointIndex: timingPointIndex ? Object.keys(timingPointIndex).length : 0,
        ageGroupIndex: ageGroupIndex ? Object.keys(ageGroupIndex).length : 0,
      });

      const responseTimingConfiguration = resolvedTimingConfiguration;
      const contests = responseTimingConfiguration?.contestIndex && typeof responseTimingConfiguration.contestIndex === 'object'
        ? Object.values(responseTimingConfiguration.contestIndex)
        : Array.isArray(responseTimingConfiguration?.contests)
          ? responseTimingConfiguration.contests
          : [];
      for (const contest of contests as any[]) {
        const contestUuid = String(contest?.contestUuid || contest?.UUID || contest?.uuid || contest?.id || '').trim() || 'unknown';
        const contestName = String(contest?.contestName || contest?.name || contest?.label || 'Unknown Contest').trim();
        const expectedSplitCount = Number(contest?.splitsCount ?? (Array.isArray(contest?.splits) ? contest.splits.length : 0));
        const expectedTimingPointCount = Number(contest?.timingPointsCount ?? (Array.isArray(contest?.timingPoints) ? contest.timingPoints.length : 0));
        const savedSplitCount = Array.isArray(contest?.splits) ? contest.splits.length : 0;
        const savedTimingPointCount = Array.isArray(contest?.timingPoints) ? contest.timingPoints.length : 0;

        const row = {
          contest: contestName,
          contestUuid,
          splitCount: savedSplitCount,
          timingPointCount: savedTimingPointCount,
          expectedCount: {
            splits: expectedSplitCount,
            timingPoints: expectedTimingPointCount,
          },
          savedCount: {
            splits: savedSplitCount,
            timingPoints: savedTimingPointCount,
          },
        };

        if (savedSplitCount < expectedSplitCount || savedTimingPointCount < expectedTimingPointCount) {
          console.warn('[timingConfiguration API] contest warning', row);
        } else {
          console.log('[timingConfiguration API] contest', row);
        }
      }
      return NextResponse.json({
        success: true,
        eventId,
        ...snapshotData,
        timings: responseTimingConfiguration,
        timingConfiguration: responseTimingConfiguration,
        splitIndex,
        ageGroupIndex,
        ...responseTimingConfiguration,
      });
    }

    return NextResponse.json({ success: false, message: 'Timing configuration snapshot not found' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to load timing configuration' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    if (!isAuthorized(req)) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ success: false, message: 'Timing configuration is read-only and must be imported from Feibot.' }, { status: 405 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to save timing configuration' }, { status: 500 });
  }
}
