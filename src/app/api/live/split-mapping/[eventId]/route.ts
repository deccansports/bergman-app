import { NextRequest, NextResponse } from 'next/server';
import { loadCourseIndex } from '@/lib/courseIndex';
import {
  extractContestUuid,
  extractSplitUuid,
  getEnabledSplitSet,
  loadSplitMapping,
  normalize,
  normalizeSplitKey,
  saveSplitMapping,
  type SplitMapping,
  type SplitMappingContestEntry,
} from '@/lib/live-tracking/splitMapping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeDistanceKm(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric === 0) return 0;
  return numeric >= 1000 ? numeric / 1000 : numeric;
}

function getSplitDistanceKm(split: any): number | null {
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

function getSplitName(split: any, index: number): string {
  return (
    normalize(split?.Name || split?.name || split?.Label || split?.label || split?.splitName || split?.split_name) ||
    `Split ${index + 1}`
  );
}

function getContestName(contest: any): string {
  return normalize(contest?.contestName || contest?.name || contest?.contest?.contestName || contest?.contest?.name) || extractContestUuid(contest);
}

function collectContests(courseIndex: any): any[] {
  if (!courseIndex || typeof courseIndex !== 'object') return [];
  if (Array.isArray(courseIndex.contests) && courseIndex.contests.length > 0) return courseIndex.contests;
  if (courseIndex.byContest && typeof courseIndex.byContest === 'object') return Object.values(courseIndex.byContest);
  return [];
}

export async function GET(_req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalize(params?.eventId);
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const [courseIndex, mapping] = await Promise.all([
      loadCourseIndex(eventId),
      loadSplitMapping(eventId),
    ]);

    const contestsRaw = collectContests(courseIndex);
    const seen = new Set<string>();
    const contests = contestsRaw
      .map((contest: any) => {
        const contestUuid = extractContestUuid(contest);
        if (!contestUuid) return null;
        const dedupeKey = normalizeSplitKey(contestUuid);
        if (seen.has(dedupeKey)) return null;
        seen.add(dedupeKey);

        const enabledSet = getEnabledSplitSet(mapping, contestUuid);
        const splits = safeArray<any>(contest?.splits)
          .map((split: any, index: number) => {
            const splitUuid = extractSplitUuid(split);
            if (!splitUuid) return null;
            return {
              splitUuid,
              name: getSplitName(split, index),
              distanceKm: getSplitDistanceKm(split),
              leg: normalize(split?.TypeOfSport || split?.typeOfSport || split?.leg || split?.legName) || null,
              order: Number(split?.Order ?? split?.order ?? split?.Index ?? split?.index ?? index + 1) || index + 1,
              enabled: enabledSet ? enabledSet.has(normalizeSplitKey(splitUuid)) : false,
            };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => (a.order - b.order));

        return {
          contestUuid,
          contestName: getContestName(contest),
          configured: enabledSet !== null,
          splitCount: splits.length,
          enabledCount: splits.filter((split: any) => split.enabled).length,
          splits,
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      success: true,
      eventId,
      contests,
      mapping: mapping || null,
      diagnostics: {
        courseIndexLoaded: Boolean(courseIndex),
        contestCount: contests.length,
        mappedContestCount: contests.filter((contest: any) => contest.configured).length,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to load split mapping' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalize(params?.eventId);
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const updatedBy = normalize(body?.updatedBy || body?.mappedBy || 'admin-ui') || 'admin-ui';

    const contestEntries: Record<string, SplitMappingContestEntry> = {};

    const ingestContest = (contestUuid: string, enabledSplitUuids: unknown) => {
      const key = normalize(contestUuid);
      if (!key) return;
      const list = Array.isArray(enabledSplitUuids)
        ? Array.from(new Set(enabledSplitUuids.map((value) => normalize(value)).filter(Boolean)))
        : [];
      contestEntries[key] = {
        enabledSplitUuids: list,
        updatedAt: new Date().toISOString(),
        updatedBy,
      };
    };

    if (body?.contests && typeof body.contests === 'object' && !Array.isArray(body.contests)) {
      for (const [contestUuid, entry] of Object.entries(body.contests as Record<string, any>)) {
        ingestContest(contestUuid, Array.isArray(entry) ? entry : entry?.enabledSplitUuids);
      }
    }

    if (Array.isArray(body?.contests)) {
      for (const entry of body.contests) {
        ingestContest(normalize(entry?.contestUuid || entry?.contest_uuid || entry?.uuid), entry?.enabledSplitUuids || entry?.splits);
      }
    }

    if (Array.isArray(body?.mappings)) {
      for (const entry of body.mappings) {
        ingestContest(normalize(entry?.contestUuid || entry?.contest_uuid || entry?.uuid), entry?.enabledSplitUuids || entry?.splits);
      }
    }

    const mapping: SplitMapping = {
      eventId,
      contests: contestEntries,
    };
    const saved = await saveSplitMapping(eventId, mapping);

    return NextResponse.json({
      success: true,
      eventId,
      mapping: saved,
      count: Object.keys(contestEntries).length,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to save split mapping' }, { status: 500 });
  }
}
