import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV, putKV } from '@/lib/cloudflare/kv';

function normalize(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeLookup(value: unknown): string {
  return normalize(value).toLowerCase();
}

function isGenericContestName(value: unknown): boolean {
  return /^contest-\d+$/i.test(normalize(value));
}

type LegMapping = {
  leg_index: number;
  leg_name: string;
  display_order: number;
  enabled: boolean;
  km_marking?: number | null;
  cutoff_type?: 'cumulative' | 'overall' | 'none' | null;
  cutoff_value?: number | null;
  uuid?: string;
  first_split_uuid?: string | null;
  last_split_uuid?: string | null;
  metadata?: Record<string, any>;
};

type SplitMapping = {
  split_index: number;
  split_name: string;
  custom_display_name?: string;
  contest_uuid?: string;
  timing_point_id: string;
  timing_point_name: string;
  leg_index: number;
  assigned_leg?: string;
  display_order: number;
  distance?: number | null;
  split_type?: string | null;
  visibility?: 'visible' | 'hidden';
  km_marking?: number | null;
  cutoff_type?: 'cumulative' | 'overall' | 'none' | null;
  cutoff_value?: number | null;
  metadata?: Record<string, any>;
};

type LegSplitMappingConfig = {
  event_id: string;
  contest_id: string;
  contest_uuid?: string;
  contest_name: string;
  legs: LegMapping[];
  splits: SplitMapping[];
  updated_at: string;
  updated_by: string;
  version: string;
};

type RaceFlowSection = {
  leg_index: number;
  leg_name: string;
  display_order: number;
  splits: SplitMapping[];
};

function buildRaceFlowTimeline(config: LegSplitMappingConfig) {
  const legs = [...(config.legs || [])].sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
  const splits = [...(config.splits || [])].sort((a, b) => {
    const legOrderA = Number(a.leg_index || 0);
    const legOrderB = Number(b.leg_index || 0);
    if (legOrderA !== legOrderB) return legOrderA - legOrderB;
    return Number(a.display_order || a.split_index || 0) - Number(b.display_order || b.split_index || 0);
  });

  const sections: RaceFlowSection[] = legs.map((leg) => ({
    leg_index: leg.leg_index,
    leg_name: leg.leg_name,
    display_order: leg.display_order,
    splits: splits
      .filter((split) => Number(split.leg_index || 0) === Number(leg.leg_index || 0))
      .sort((a, b) => Number(a.display_order || a.split_index || 0) - Number(b.display_order || b.split_index || 0)),
  }));

  return {
    event_id: config.event_id,
    contest_id: config.contest_id,
    contest_name: config.contest_name,
    legs,
    splits,
    sections,
    updated_at: config.updated_at,
    updated_by: config.updated_by,
    version: config.version,
  };
}

function toLegMapping(row: any, fallbackIndex: number): LegMapping {
  return {
    leg_index: Number(row?.leg_index ?? row?.index ?? row?.order ?? row?.sequence ?? fallbackIndex),
    leg_name: normalize(row?.leg_name ?? row?.name ?? row?.label ?? row?.type ?? `LEG ${fallbackIndex + 1}`),
    display_order: Number(row?.display_order ?? row?.order ?? row?.sequence ?? row?.index ?? fallbackIndex),
    enabled: row?.enabled !== false,
    km_marking: row?.km_marking ?? row?.kmMarking ?? row?.metadata?.km_marking ?? row?.metadata?.kmMarking ?? null,
    cutoff_type: row?.cutoff_type ?? row?.cutoffType ?? row?.metadata?.cutoff_type ?? row?.metadata?.cutoffType ?? 'none',
    cutoff_value: row?.cutoff_value ?? row?.cutoffValue ?? row?.metadata?.cutoff_value ?? row?.metadata?.cutoffValue ?? null,
    uuid: normalize(row?.uuid ?? row?.legUuid ?? row?.leg_uuid ?? '' ) || undefined,
    first_split_uuid: normalize(row?.first_split_uuid ?? row?.firstSplitUuid ?? row?.configuration?.first_split_uuid ?? row?.configuration?.firstSplitUuid ?? '') || null,
    last_split_uuid: normalize(row?.last_split_uuid ?? row?.lastSplitUuid ?? row?.configuration?.last_split_uuid ?? row?.configuration?.lastSplitUuid ?? '') || null,
    metadata: {
      ...(row?.metadata || {}),
      km_marking: row?.km_marking ?? row?.kmMarking ?? row?.metadata?.km_marking ?? row?.metadata?.kmMarking ?? null,
      cutoff_type: row?.cutoff_type ?? row?.cutoffType ?? row?.metadata?.cutoff_type ?? row?.metadata?.cutoffType ?? 'none',
      cutoff_value: row?.cutoff_value ?? row?.cutoffValue ?? row?.metadata?.cutoff_value ?? row?.metadata?.cutoffValue ?? null,
    },
  };
}

function toSplitMapping(row: any, fallbackIndex: number): SplitMapping {
  const importedName = normalize(row?.split_name ?? row?.splitName ?? row?.name ?? row?.label ?? row?.displayName ?? row?.shortName ?? `SPLIT ${fallbackIndex + 1}`);
  const importedLeg = normalize(row?.leg ?? row?.split_type ?? row?.type ?? row?.raw?.leg ?? row?.raw?.type ?? '');
  const splitIndex = Number(row?.split_index ?? row?.index ?? row?.order ?? fallbackIndex + 1);
  const customDisplayName = normalize(row?.custom_display_name ?? row?.display_name ?? row?.split_name ?? row?.splitName ?? row?.name ?? row?.label ?? importedName);
  return {
    split_index: splitIndex,
    split_name: customDisplayName,
    custom_display_name: customDisplayName,
    contest_uuid: normalize(row?.contest_uuid ?? row?.contestUuid ?? row?.configuration?.contest_uuid ?? row?.configuration?.contestUuid ?? '' ) || undefined,
    timing_point_id: normalize(row?.timing_point_id ?? row?.timingPointId ?? row?.timingPointUuid ?? row?.timing_point_uuid ?? row?.timingPointUUID ?? ''),
    timing_point_name: normalize(row?.timing_point_name ?? row?.timingPointName ?? row?.timingPointLabel ?? row?.timingPoint?.name ?? row?.timingPoint?.label ?? ''),
    leg_index: Number(row?.leg_index ?? row?.legIndex ?? row?.leg_order ?? row?.legOrder ?? 0),
    assigned_leg: normalize(row?.assigned_leg ?? row?.assignedLeg ?? row?.leg_name ?? row?.legName ?? row?.split_type ?? row?.type ?? '') || undefined,
    display_order: Number(row?.display_order ?? row?.order ?? row?.index ?? splitIndex),
    distance: row?.distance ?? row?.distanceKm ?? row?.distance_km ?? null,
    split_type: normalize(row?.split_type ?? row?.type ?? row?.leg ?? ''),
    visibility: (row?.visibility === 'hidden' ? 'hidden' : 'visible'),
    km_marking: row?.km_marking ?? row?.kmMarking ?? row?.distance ?? row?.distanceKm ?? row?.distance_km ?? null,
    cutoff_type: row?.cutoff_type ?? row?.cutoffType ?? row?.metadata?.cutoff_type ?? row?.metadata?.cutoffType ?? 'none',
    cutoff_value: row?.cutoff_value ?? row?.cutoffValue ?? row?.metadata?.cutoff_value ?? row?.metadata?.cutoffValue ?? null,
    metadata: {
      ...(row?.metadata || {}),
      imported_split_name: importedName,
      imported_leg: importedLeg,
    },
  };
}

async function loadLegIndex(eventId: string, contestId?: string): Promise<LegMapping[]> {
  try {
    const data = await getKV<any>(`live:event:${eventId}:leg:index`, 'leg-split-mapping');
    const targetContest = normalize(contestId);
    const byContest = data?.byContest && typeof data.byContest === 'object' ? data.byContest : null;

    let sourceRows: any[] = [];
    if (byContest && targetContest) {
      const matchedKey = Object.keys(byContest).find((key) => normalizeLookup(key) === normalizeLookup(targetContest));
      sourceRows = matchedKey && Array.isArray(byContest[matchedKey])
        ? byContest[matchedKey]
        : [];
    }
    if (sourceRows.length === 0) {
      sourceRows = Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : Array.isArray(data?.legs) ? data.legs : [];
    }

    if (targetContest && sourceRows.length > 0) {
      const filtered = sourceRows.filter((leg: any) => {
        const contestFromRow = normalize(leg?.contestUuid ?? leg?.contest_uuid ?? leg?.configuration?.contest_uuid ?? '');
        return contestFromRow && normalizeLookup(contestFromRow) === normalizeLookup(targetContest);
      });
      if (filtered.length > 0) sourceRows = filtered;
    }

    const resolved = sourceRows.map((leg: any, index: number) => toLegMapping(leg, index));
    const byName = new Map<string, LegMapping>();
    for (const leg of resolved) {
      const key = normalizeLookup(leg.leg_name);
      if (!key) continue;
      const existing = byName.get(key);
      if (!existing || leg.display_order < existing.display_order) {
        byName.set(key, leg);
      }
    }
    return Array.from(byName.values()).sort((a, b) => a.display_order - b.display_order);
  } catch (error) {
    console.warn(`[LEG SPLIT MAPPING] Failed to load leg index for event ${eventId}:`, error);
    return [];
  }
}

async function loadSplitIndex(eventId: string, contestId?: string): Promise<SplitMapping[]> {
  try {
    const data = await getKV<any>(`live:event:${eventId}:split:index`, 'leg-split-mapping');
    const targetContest = normalize(contestId);

    let sourceRows: any[] = [];
    const byContest = data?.byContest && typeof data.byContest === 'object' ? data.byContest : null;
    if (byContest && targetContest) {
      const matchedKey = Object.keys(byContest).find((key) => normalizeLookup(key) === normalizeLookup(targetContest));
      const contestEntry = matchedKey ? byContest[matchedKey] : null;
      sourceRows = Array.isArray(contestEntry?.splits)
        ? contestEntry.splits
        : Array.isArray(contestEntry)
          ? contestEntry
          : [];
    }

    if (sourceRows.length === 0 && targetContest && data && typeof data === 'object') {
      const directRows = data[targetContest] || data[normalizeLookup(targetContest)] || null;
      sourceRows = Array.isArray(directRows)
        ? directRows
        : Array.isArray((directRows as any)?.splits)
          ? (directRows as any).splits
          : [];
    }

    if (sourceRows.length === 0) {
      sourceRows = Array.isArray(data)
        ? data
        : Array.isArray(data?.splits)
          ? data.splits
          : Array.isArray(data?.list)
            ? data.list
            : [];
    }

    if (targetContest && sourceRows.length > 0) {
      const filtered = sourceRows.filter((split: any) => {
        const contestFromRow = normalize(split?.contestUuid ?? split?.contest_uuid ?? split?.raw?.contest_uuid ?? split?.raw?.contestUuid ?? '');
        return contestFromRow && normalizeLookup(contestFromRow) === normalizeLookup(targetContest);
      });
      if (filtered.length > 0) sourceRows = filtered;
    }

    return sourceRows
      .map((split: any, index: number) => toSplitMapping(split, index))
      .sort((a, b) => a.split_index - b.split_index);
  } catch (error) {
    console.warn(`[LEG SPLIT MAPPING] Failed to load split index for event ${eventId}:`, error);
    return [];
  }
}

function inferSplitLegToken(split: SplitMapping): string {
  const text = normalize(`${split.split_name} ${split.timing_point_name} ${split.split_type} ${split.metadata?.imported_leg || ''}`);
  if (!text) return '';
  if (/\b(bike\s*start|t1|transition\s*1|swim\s*finish)\b/i.test(text)) return 't1';
  if (/\b(bike\s*finish|t2\s*start|transition\s*2|run\s*start|bike\s*finish\s*\/\s*t2\s*start|t2\s*end)\b/i.test(text)) return 't2';
  if (/\b(swim\s*start|swim)\b/i.test(text)) return 'swim';
  if (/\b(bike|cycle)\b/i.test(text)) return 'bike';
  if (/\b(run)\b/i.test(text)) return 'run';
  return '';
}

function resolveLegIndexFromToken(token: string, legIndexByName: Record<string, number>, fallback: number): number {
  const normalized = normalizeLookup(token);
  if (!normalized) return fallback;

  const candidate = Object.entries(legIndexByName).find(([nameKey]) => {
    const key = normalizeLookup(nameKey);
    if (!key) return false;
    if (key === normalized) return true;
    if (normalized === 't1' && (key.includes('t1') || key.includes('transition1'))) return true;
    if (normalized === 't2' && (key.includes('t2') || key.includes('transition2'))) return true;
    if (normalized === 'swim' && key.includes('swim')) return true;
    if (normalized === 'bike' && key.includes('bike')) return true;
    if (normalized === 'run' && key.includes('run')) return true;
    return false;
  });

  return candidate ? Number(candidate[1]) : fallback;
}

async function loadContests(eventId: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const contestMapping = await getKV<any>(`live:event:${eventId}:contest:mapping`, 'leg-split-mapping').catch(() => null);
    const contestIndex = await getKV<any>(`live:event:${eventId}:contest:index`, 'leg-split-mapping').catch(() => null);
    const importSummary = await getKV<any>(`live:event:${eventId}:import-summary:latest`, 'leg-split-mapping').catch(() => null);

    const mappingObject = contestMapping?.mapping && typeof contestMapping.mapping === 'object'
      ? contestMapping.mapping
      : contestMapping && typeof contestMapping === 'object'
        ? contestMapping
        : {};

    const contestIndexObject = contestIndex && typeof contestIndex === 'object'
      ? contestIndex
      : {};

    const importedContests = Array.isArray(importSummary?.importedContests)
      ? importSummary.importedContests
      : [];

    const deduped = new Map<string, { id: string; name: string }>();

    for (const contest of importedContests) {
      const id = normalize(contest?.feibotContestUuid ?? contest?.contestUuid ?? contest?.uuid ?? contest?.id ?? '');
      const mappedName = normalize(
        contest?.selectedBergmanContestName ||
        contest?.bergmanContestName ||
        contest?.bergmanCategoryName ||
        contest?.feibotContestName ||
        contest?.contestName ||
        contest?.name ||
        ''
      );
      if (!id || !mappedName || isGenericContestName(mappedName) || deduped.has(id)) continue;
      deduped.set(id, { id, name: mappedName });
    }

    for (const row of Object.values(mappingObject as Record<string, any>)) {
      const id = normalize(row?.feibotContestUuid ?? row?.contestUuid ?? row?.uuid ?? row?.id ?? '');
      const name = normalize(
        row?.selectedBergmanContestName ||
        row?.bergmanContestName ||
        row?.bergmanCategoryName ||
        row?.feibotContestName ||
        ''
      );
      if (!id || !name || isGenericContestName(name) || deduped.has(id)) continue;
      deduped.set(id, { id, name });
    }

    for (const contest of Object.values(contestIndexObject as Record<string, any>)) {
      const id = normalize(contest?.contestUuid ?? contest?.uuid ?? contest?.id ?? '');
      const name = normalize(contest?.contestName ?? contest?.name ?? contest?.label ?? '');
      if (!id || !name || isGenericContestName(name) || deduped.has(id)) continue;
      deduped.set(id, { id, name });
    }

    return Array.from(deduped.values());
  } catch (error) {
    console.warn(`[LEG SPLIT MAPPING] Failed to load contests:`, error);
    return [];
  }
}

async function loadSavedMapping(
  eventId: string,
  contestId: string,
): Promise<LegSplitMappingConfig | null> {
  try {
    const contestCandidates = Array.from(new Set([
      contestId,
      normalizeLookup(contestId),
      contestId.toUpperCase(),
    ].filter(Boolean)));

    for (const contestCandidate of contestCandidates) {
      const kvKey = `live:event:${eventId}:contest:${contestCandidate}:leg-split-mapping`;
      const data = await getKV<LegSplitMappingConfig>(kvKey, 'leg-split-mapping').catch(() => null);
      if (data) return data;
    }

    return null;
  } catch (error) {
    console.warn(`[LEG SPLIT MAPPING] Failed to load saved mapping:`, error);
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const eventId = req.nextUrl.searchParams.get('eventId')?.trim() || '';
    const contestId = req.nextUrl.searchParams.get('contestId')?.trim() || '';

    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const [importedLegs, importedSplits, contests, savedMapping] = await Promise.all([
      loadLegIndex(eventId, contestId || undefined),
      loadSplitIndex(eventId, contestId || undefined),
      loadContests(eventId),
      contestId ? loadSavedMapping(eventId, contestId) : Promise.resolve(null),
    ]);

    // Get event name from Firestore
    let eventName = eventId;
    try {
      const db = getFirestoreInstance();
      const eventSnap = await db.collection('events').doc(eventId).get();
      if (eventSnap.exists) {
        const eventData = eventSnap.data() || {};
        eventName = normalize(eventData.name || eventData.eventName || eventId);
      }
    } catch (err) {
      // Fallback to eventId
    }

    const hasSavedMapping = Boolean(
      contestId
      && savedMapping
      && Array.isArray(savedMapping.legs)
      && savedMapping.legs.length > 0
      && Array.isArray(savedMapping.splits)
      && savedMapping.splits.length > 0,
    );
    const legs = hasSavedMapping
      ? (Array.isArray(savedMapping?.legs) ? savedMapping!.legs : []).map((leg: any, index: number) => toLegMapping(leg, index))
      : importedLegs;
    const splits = hasSavedMapping
      ? (Array.isArray(savedMapping?.splits) ? savedMapping!.splits : []).map((split: any, index: number) => toSplitMapping(split, index))
      : importedSplits;

    const legIndexByName = legs.reduce<Record<string, number>>((acc, leg) => {
      const key = normalizeLookup(leg.leg_name);
      if (!key) return acc;
      acc[key] = leg.leg_index;
      return acc;
    }, {});
    const normalizeLegToken = (value: unknown) => {
      const token = normalizeLookup(value);
      if (!token) return '';
      if (token.includes('swim')) return 'swim';
      if (token.includes('t1') || token.includes('transition1')) return 't1';
      if (token.includes('bike') || token.includes('cycle')) return 'bike';
      if (token.includes('t2') || token.includes('transition2')) return 't2';
      if (token.includes('run')) return 'run';
      return token;
    };

    const sortedImportedSplits = [...splits].sort((a, b) => a.split_index - b.split_index);
    const splitPositionByUuid = new Map<string, number>();
    sortedImportedSplits.forEach((split, index) => {
      const splitUuid = normalize(split?.timing_point_id || split?.metadata?.split_uuid || split?.metadata?.feibotSplitUuid || split?.metadata?.imported_split_uuid || split?.split_index || index + 1);
      splitPositionByUuid.set(normalizeLookup(splitUuid), index);
    });

    const legRanges = [...legs].sort((a, b) => a.display_order - b.display_order).map((leg) => {
      const startUuid = normalize(leg.first_split_uuid || leg.metadata?.first_split_uuid || '');
      const endUuid = normalize(leg.last_split_uuid || leg.metadata?.last_split_uuid || '');
      return {
        leg,
        start: startUuid ? splitPositionByUuid.get(normalizeLookup(startUuid)) ?? null : null,
        end: endUuid ? splitPositionByUuid.get(normalizeLookup(endUuid)) ?? null : null,
      };
    });

    const sortedLegs = [...legs].sort((a, b) => a.display_order - b.display_order);
    const resolvedSplits = splits.map((split, index) => {
      if (split.leg_index > 0) return { ...split, assigned_leg: split.assigned_leg || split.split_type || undefined };
      const splitUuid = normalize(split?.timing_point_id || split?.metadata?.split_uuid || split?.metadata?.feibotSplitUuid || split?.metadata?.imported_split_uuid || '');
      const splitPos = splitUuid ? splitPositionByUuid.get(normalizeLookup(splitUuid)) ?? index : index;

      const matchedLegByRange = legRanges.find(({ start, end }) => {
        if (start === null || end === null) return false;
        return splitPos >= start && splitPos <= end;
      })?.leg || null;

      if (matchedLegByRange) {
        return { ...split, leg_index: matchedLegByRange.leg_index, assigned_leg: matchedLegByRange.leg_name, split_type: matchedLegByRange.leg_name };
      }

      const importedLeg = normalizeLegToken(split.metadata?.imported_leg || split.split_type || split.metadata?.raw_leg || '');
      const inferredToken = inferSplitLegToken(split) || importedLeg;
      if (!inferredToken) return split;
      const resolvedLegIndex = resolveLegIndexFromToken(inferredToken, legIndexByName, split.leg_index || 0);
      const resolvedLeg = sortedLegs.find((leg) => leg.leg_index === resolvedLegIndex) || null;
      return resolvedLeg
        ? { ...split, leg_index: resolvedLeg.leg_index, assigned_leg: resolvedLeg.leg_name, split_type: resolvedLeg.leg_name }
        : split;
    });

    const resolvedSplitsWithFallback = (() => {
      if (sortedLegs.length === 0) return resolvedSplits;
      const next = [...resolvedSplits].sort((a, b) => a.split_index - b.split_index);
      const hasExplicitLegAssignment = next.some((split) => split.leg_index > 0);
      if (!hasExplicitLegAssignment) {
        const chunkSize = Math.max(1, Math.ceil(next.length / sortedLegs.length));
        return next.map((split, index) => {
          const leg = sortedLegs[Math.min(sortedLegs.length - 1, Math.floor(index / chunkSize))];
          return leg ? { ...split, leg_index: leg.leg_index, assigned_leg: leg.leg_name, split_type: leg.leg_name } : split;
        });
      }

      let currentLegIndex = next.find((split) => split.leg_index > 0)?.leg_index || sortedLegs[0].leg_index;
      return next.map((split) => {
        if (split.leg_index > 0) {
          currentLegIndex = split.leg_index;
          return split;
        }
        if (currentLegIndex > 0) {
          const leg = sortedLegs.find((item) => item.leg_index === currentLegIndex) || null;
          return leg ? { ...split, leg_index: currentLegIndex, assigned_leg: leg.leg_name, split_type: leg.leg_name } : { ...split, leg_index: currentLegIndex };
        }
        return split;
      });
    })();

    const sortedSplits = [...resolvedSplitsWithFallback].sort((a, b) => a.split_index - b.split_index);

    return NextResponse.json({
      success: true,
      event_id: eventId,
      event_name: eventName,
      contest_id: contestId,
      legs: sortedLegs,
      splits: sortedSplits,
      contests,
      saved_mapping: savedMapping || null,
      diagnostics: {
        imported_legs: importedLegs.length,
        imported_splits: importedSplits.length,
        total_legs: sortedLegs.length,
        total_splits: sortedSplits.length,
        has_saved_mapping: hasSavedMapping,
        source: hasSavedMapping ? 'saved_mapping' : 'imported_index',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to load mapping' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const eventId = normalize(body?.event_id ?? body?.eventId ?? '');
    const contestId = normalize(body?.contest_id ?? body?.contestId ?? '');
    const contestName = normalize(body?.contest_name ?? body?.contestName ?? '');
    const legs = Array.isArray(body?.legs) ? body.legs : [];
    const splits = Array.isArray(body?.splits) ? body.splits : [];
    const updatedBy = normalize(body?.updated_by ?? body?.updatedBy ?? 'admin-ui');

    if (!eventId || !contestId) {
      return NextResponse.json(
        { success: false, message: 'eventId and contestId are required' },
        { status: 400 }
      );
    }

    const kvKey = `live:event:${eventId}:contest:${contestId}:leg-split-mapping`;
    const contest_uuid = contestId;
    const config: LegSplitMappingConfig = {
      event_id: eventId,
      contest_id: contestId,
      contest_uuid,
      contest_name: contestName,
      legs: legs.map((leg: any) => ({
        leg_index: Number(leg?.leg_index ?? 0),
        leg_name: normalize(leg?.leg_name ?? ''),
        display_order: Number(leg?.display_order ?? 0),
        enabled: leg?.enabled !== false,
        km_marking: leg?.km_marking ?? leg?.metadata?.km_marking ?? null,
        cutoff_type: leg?.cutoff_type ?? leg?.metadata?.cutoff_type ?? 'none',
        cutoff_value: leg?.cutoff_value ?? leg?.metadata?.cutoff_value ?? null,
        metadata: {
          ...(leg?.metadata || {}),
          km_marking: leg?.km_marking ?? leg?.metadata?.km_marking ?? null,
          cutoff_type: leg?.cutoff_type ?? leg?.metadata?.cutoff_type ?? 'none',
          cutoff_value: leg?.cutoff_value ?? leg?.metadata?.cutoff_value ?? null,
        },
      })),
      splits: splits.map((split: any) => ({
        contest_uuid,
        split_index: Number(split?.split_index ?? 0),
        split_name: normalize(split?.custom_display_name ?? split?.split_name ?? ''),
        custom_display_name: normalize(split?.custom_display_name ?? split?.split_name ?? ''),
        timing_point_id: normalize(split?.timing_point_id ?? ''),
        timing_point_name: normalize(split?.timing_point_name ?? ''),
        leg_index: Number(split?.leg_index ?? 0),
        assigned_leg: normalize(split?.assigned_leg ?? split?.leg_name ?? split?.split_type ?? ''),
        display_order: Number(split?.display_order ?? split?.split_index ?? 0),
        distance: split?.distance ?? null,
        split_type: normalize(split?.split_type ?? ''),
        visibility: split?.visibility === 'hidden' ? 'hidden' : 'visible',
        km_marking: split?.km_marking ?? split?.metadata?.km_marking ?? split?.distance ?? null,
        cutoff_type: split?.cutoff_type ?? split?.metadata?.cutoff_type ?? 'none',
        cutoff_value: split?.cutoff_value ?? split?.metadata?.cutoff_value ?? null,
        metadata: {
          ...(split?.metadata || {}),
          contest_uuid,
          custom_display_name: normalize(split?.custom_display_name ?? split?.split_name ?? ''),
          assigned_leg: normalize(split?.assigned_leg ?? split?.leg_name ?? split?.split_type ?? ''),
          km_marking: split?.km_marking ?? split?.metadata?.km_marking ?? split?.distance ?? null,
          cutoff_type: split?.cutoff_type ?? split?.metadata?.cutoff_type ?? 'none',
          cutoff_value: split?.cutoff_value ?? split?.metadata?.cutoff_value ?? null,
        },
      })),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
      version: '1.0',
    };

    // Save mapping to contest-scoped KV
    await putKV(kvKey, config, 'leg-split-mapping');

    // Persist official race flow into timing configuration snapshots (single source for UI consumers).
    const raceFlowTimeline = buildRaceFlowTimeline(config);
    const timingConfigurationKeys = [
      `event:${eventId}:timingConfiguration`,
      `live:event:${eventId}:timingConfiguration`,
    ];
    const raceFlowContestKeys = Array.from(new Set([
      contestId,
      contestId.toLowerCase(),
      contestName,
      contestName.toLowerCase(),
    ].map((value) => normalize(value)).filter(Boolean)));

    await Promise.all(timingConfigurationKeys.map(async (timingKey) => {
      const current = (await getKV<any>(timingKey, 'leg-split-mapping').catch(() => null)) || {};

      const nextLegSplitMappingsByContest = {
        ...(current?.legSplitMappingsByContest && typeof current.legSplitMappingsByContest === 'object' ? current.legSplitMappingsByContest : {}),
      } as Record<string, any>;
      const nextRaceFlowByContest = {
        ...(current?.raceFlowByContest && typeof current.raceFlowByContest === 'object' ? current.raceFlowByContest : {}),
      } as Record<string, any>;
      const nextRaceFlowTimelineByContest = {
        ...(current?.raceFlowTimelineByContest && typeof current.raceFlowTimelineByContest === 'object' ? current.raceFlowTimelineByContest : {}),
      } as Record<string, any>;

      for (const key of raceFlowContestKeys) {
        nextLegSplitMappingsByContest[key] = config;
        nextRaceFlowByContest[key] = raceFlowTimeline;
        nextRaceFlowTimelineByContest[key] = raceFlowTimeline;
      }

      await putKV(timingKey, {
        ...(current && typeof current === 'object' ? current : {}),
        eventId,
        source: normalize(current?.source || 'cloud') || 'cloud',
        provider: normalize(current?.provider || 'feibot') || 'feibot',
        legSplitMappingsByContest: nextLegSplitMappingsByContest,
        legSplitMappingUpdatedAt: config.updated_at,
        raceFlowByContest: nextRaceFlowByContest,
        raceFlowTimelineByContest: nextRaceFlowTimelineByContest,
        raceFlowTimelineUpdatedAt: config.updated_at,
        updatedAt: config.updated_at,
      }, 'leg-split-mapping');
    }));

    // Also save to Firestore for persistence
    const db = getFirestoreInstance();
    const docRef = db.collection('events')
      .doc(eventId)
      .collection('liveTracking')
      .doc('legSplitMapping');
    
    await docRef.set({ ...config, contest_id: contestId }, { merge: true });

    console.log('[LEG SPLIT MAPPING] Mapping saved', {
      event_id: eventId,
      contest_id: contestId,
      legs: config.legs.length,
      splits: config.splits.length,
      persisted_to: ['event_timing_configuration', 'live_event_timing_configuration'],
    });

    return NextResponse.json({
      success: true,
      message: 'Mapping saved successfully',
      config,
    });
  } catch (error) {
    console.error('[LEG SPLIT MAPPING] Error saving mapping:', error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to save mapping' },
      { status: 500 }
    );
  }
}
