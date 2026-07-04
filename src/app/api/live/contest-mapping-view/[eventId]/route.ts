import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV, putKV } from '@/lib/cloudflare/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeKey(value: unknown) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function flattenBergmanOptions(eventData: any) {
  const tickets = Array.isArray(eventData?.ticketDefinitions) ? eventData.ticketDefinitions : [];
  const options: Array<{
    bergmanContestId: string;
    bergmanContestName: string;
    ticketId?: string | null;
    ticketName?: string | null;
    subTicketId?: string | null;
    subTicketName?: string | null;
    subCategoryId?: string | null;
    subCategoryName?: string | null;
    categoryType?: string | null;
    distance?: string | null;
  }> = [];

  for (const ticket of tickets) {
    const ticketId = normalize(ticket?.id || ticket?.ticketId);
    const ticketName = normalize(ticket?.ticketName || ticket?.name || ticket?.displayName || ticketId);
    const subCategories = Array.isArray(ticket?.subCategories) ? ticket.subCategories : [];
    if (subCategories.length === 0 && ticketId && ticketName) {
      options.push({
        bergmanContestId: ticketId,
        bergmanContestName: ticketName,
        ticketId,
        ticketName,
        subTicketId: null,
        subTicketName: null,
        subCategoryId: null,
        subCategoryName: null,
        categoryType: normalize(ticket?.category || ticket?.type || null) || null,
        distance: normalize(ticket?.distance || null) || null,
      });
    }

    for (const sub of subCategories) {
      const subId = normalize(sub?.id || sub?.subCategoryId || sub?.uuid || '');
      const subName = normalize(sub?.name || sub?.subCategoryName || sub?.label || '');
      if (!subId && !subName) continue;
      options.push({
        bergmanContestId: `${ticketId}:${subId || subName}`,
        bergmanContestName: `${ticketName}${subName ? ` → ${subName}` : ''}`,
        ticketId,
        ticketName,
        subTicketId: subId || null,
        subTicketName: subName || null,
        subCategoryId: subId || null,
        subCategoryName: subName || null,
        categoryType: normalize(ticket?.category || ticket?.type || null) || null,
        distance: normalize(sub?.distance || ticket?.distance || null) || null,
      });
    }
  }

  const deduped = new Map<string, (typeof options)[number]>();
  for (const option of options) {
    const key = normalizeKey(option.bergmanContestId || option.bergmanContestName);
    if (!key) continue;
    if (!deduped.has(key)) deduped.set(key, option);
  }
  return Array.from(deduped.values());
}

function normalizeContestRows(value: any) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.contests) ? value.contests : [];
  return rows.map((row: any, index: number) => ({
    index,
    feibotContestUuid: normalize(row?.contestUuid || row?.contest_uuid || row?.uuid || row?.id || `contest-${index + 1}`),
    feibotContestName: normalize(row?.contestName || row?.contest_name || row?.name || row?.label || `Contest ${index + 1}`),
    distance: normalize(row?.distance || row?.distanceKm || row?.distance_m || null) || null,
    categoryType: normalize(row?.category || row?.type || row?.discipline || null) || null,
    splitCount: Array.isArray(row?.splits) ? row.splits.length : Number(row?.splitCount || 0) || 0,
    timingPointCount: Array.isArray(row?.timingPoints) ? row.timingPoints.length : Number(row?.timingPointCount || 0) || 0,
    raw: row,
  }));
}

function scoreAutoMatch(contest: { feibotContestName: string; distance: string | null; categoryType: string | null }, option: { bergmanContestName: string; distance?: string | null; categoryType?: string | null }) {
  const contestName = normalizeKey(contest.feibotContestName);
  const optionName = normalizeKey(option.bergmanContestName);
  if (!contestName || !optionName) return 0;
  if (contestName === optionName) return 100;
  if (contestName.includes(optionName) || optionName.includes(contestName)) return 98;

  let score = 0;
  const contestTokens = new Set(contestName.match(/[a-z0-9]+/g) || []);
  const optionTokens = new Set(optionName.match(/[a-z0-9]+/g) || []);
  const overlap = [...contestTokens].filter((token) => optionTokens.has(token)).length;
  const union = new Set([...contestTokens, ...optionTokens]).size || 1;
  score += Math.round((overlap / union) * 75);

  const contestDistance = normalizeKey(contest.distance);
  const optionDistance = normalizeKey(option.distance);
  if (contestDistance && optionDistance && contestDistance === optionDistance) score += 15;

  const contestCategory = normalizeKey(contest.categoryType);
  const optionCategory = normalizeKey(option.categoryType);
  if (contestCategory && optionCategory && contestCategory === optionCategory) score += 10;

  return Math.min(100, score);
}

async function loadContestIndex(eventId: string) {
  const liveIndex = await getKV<any>(`live:event:${eventId}:contest:index`, 'contest-mapping-view');
  const eventIndex = await getKV<any>(`event:${eventId}:contest:index`, 'contest-mapping-view');
  const importSummary = await getKV<any>(`live:event:${eventId}:import-summary:latest`, 'contest-mapping-view').catch(() => null);
  const importedContests = Array.isArray(importSummary?.importedContests) ? importSummary.importedContests : [];
  const source = Array.isArray(liveIndex) && liveIndex.length > 0
    ? liveIndex
    : Array.isArray(eventIndex) && eventIndex.length > 0
      ? eventIndex
      : importedContests;
  return { source, liveIndex, eventIndex, importSummary };
}

async function loadContestMapping(eventId: string) {
  const kvMapping = await getKV<any>(`live:event:${eventId}:contest:mapping`, 'contest-mapping-view');
  const firestore = await getFirestoreInstance().collection('events').doc(eventId).collection('liveTracking').doc('contestMapping').get().catch(() => null);
  const firestoreMapping = firestore?.exists ? firestore.data() : null;
  return kvMapping || firestoreMapping || null;
}

async function loadTimingConfigurationSnapshot(eventId: string) {
  const direct = await getKV<any>(`event:${eventId}:timingConfiguration`, 'contest-mapping-view').catch(() => null);
  if (direct) return direct;
  return getKV<any>(`live:event:${eventId}:timingConfiguration`, 'contest-mapping-view').catch(() => null);
}

async function loadSplitsDashboardEnabled(eventId: string): Promise<boolean> {
  const flag = await getKV<any>(`event:${eventId}:splits:dashboard:enabled`, 'contest-mapping-view').catch(() => null);
  return Boolean(flag?.enabled);
}

function buildTimingCountLookup(snapshot: any) {
  const raw = snapshot?.timingConfiguration || snapshot?.timings || snapshot || {};
  const byUuid: Record<string, { splitCount: number; timingPointCount: number }> = {};
  const byName: Record<string, { splitCount: number; timingPointCount: number }> = {};

  const mergeCounts = (existing: { splitCount: number; timingPointCount: number } | undefined, next: { splitCount: number; timingPointCount: number }) => ({
    splitCount: Math.max(Number(existing?.splitCount || 0), Number(next.splitCount || 0)),
    timingPointCount: Math.max(Number(existing?.timingPointCount || 0), Number(next.timingPointCount || 0)),
  });

  const assign = (contestUuid: unknown, contestName: unknown, splitCountRaw: unknown, timingPointCountRaw: unknown) => {
    const splitCount = Number(splitCountRaw ?? 0) || 0;
    const timingPointCount = Number(timingPointCountRaw ?? 0) || 0;
    const uuidKey = normalizeKey(contestUuid);
    const nameKey = normalizeKey(contestName);
    const payload = { splitCount, timingPointCount };
    if (uuidKey) byUuid[uuidKey] = mergeCounts(byUuid[uuidKey], payload);
    if (nameKey) byName[nameKey] = mergeCounts(byName[nameKey], payload);
  };

  const contestByUuid = raw?.contestByUuid && typeof raw.contestByUuid === 'object' ? raw.contestByUuid : {};
  for (const contest of Object.values(contestByUuid as Record<string, any>)) {
    const splitCount = Array.isArray(contest?.splits)
      ? contest.splits.length
      : Number(contest?.splitsCount ?? contest?.splitCount ?? contest?.statistics?.splitCount ?? 0) || 0;
    const timingPointCount = Array.isArray(contest?.timingPoints)
      ? contest.timingPoints.length
      : Number(contest?.timingPointsCount ?? contest?.timingPointCount ?? contest?.statistics?.timingPointCount ?? 0) || 0;
    assign(contest?.contestUuid || contest?.uuid || contest?.id, contest?.contestName || contest?.name, splitCount, timingPointCount);
  }

  const timingPointsByContest = raw?.timingPointsByContest && typeof raw.timingPointsByContest === 'object' ? raw.timingPointsByContest : {};
  const splitsByContest = raw?.splitsByContest && typeof raw.splitsByContest === 'object' ? raw.splitsByContest : {};
  for (const [contestUuid, points] of Object.entries(timingPointsByContest as Record<string, any>)) {
    const splitCount = Array.isArray((splitsByContest as any)?.[contestUuid]) ? (splitsByContest as any)[contestUuid].length : 0;
    const timingPointCount = Array.isArray(points) ? points.length : 0;
    assign(contestUuid, '', splitCount, timingPointCount);
  }

  const contests = safeArray<any>(raw?.contests);
  for (const contest of contests) {
    const splitCount = Array.isArray(contest?.splits)
      ? contest.splits.length
      : Number(contest?.splitsCount ?? contest?.splitCount ?? contest?.statistics?.splitCount ?? 0) || 0;
    const timingPointCount = Array.isArray(contest?.timingPoints)
      ? contest.timingPoints.length
      : Number(contest?.timingPointsCount ?? contest?.timingPointCount ?? contest?.statistics?.timingPointCount ?? 0) || 0;
    assign(contest?.contestUuid || contest?.uuid || contest?.id, contest?.contestName || contest?.name, splitCount, timingPointCount);
  }

  // Fallback path: infer timing-point contest counts via split references
  // when timing points do not carry direct contest UUIDs.
  const splitToContest: Record<string, string> = {};
  const addSplitContest = (splitKeyRaw: unknown, contestKeyRaw: unknown) => {
    const splitKey = normalizeKey(splitKeyRaw);
    const contestKey = normalize(contestKeyRaw);
    if (!splitKey || !contestKey) return;
    if (!splitToContest[splitKey]) splitToContest[splitKey] = contestKey;
  };

  const allSplits = safeArray<any>(raw?.splits);
  for (const split of allSplits) {
    const contestUuid = normalize(split?.contestUuid || split?.contest_uuid || split?.contestId || split?.contest_id || split?.contest || '');
    addSplitContest(split?.splitUuid || split?.split_uuid || split?.id || split?.split_id || split?.uuid, contestUuid);
  }

  for (const [contestUuid, splitRows] of Object.entries(splitsByContest as Record<string, any>)) {
    if (!Array.isArray(splitRows)) continue;
    for (const split of splitRows) {
      addSplitContest(split?.splitUuid || split?.split_uuid || split?.id || split?.split_id || split?.uuid, contestUuid);
    }
  }

  const inferredTimingPointCountsByContest: Record<string, number> = {};
  const allTimingPoints = safeArray<any>(raw?.timingPoints);
  for (const point of allTimingPoints) {
    const directContest = normalize(point?.contestUuid || point?.contest_uuid || point?.contestId || point?.contest_id || point?.contest || '');
    const splitRef = normalize(point?.splitUuid || point?.split_uuid || point?.splitId || point?.split_id || point?.split || '');
    const contestUuid = directContest || splitToContest[normalizeKey(splitRef)] || '';
    if (!contestUuid) continue;
    const key = normalizeKey(contestUuid);
    inferredTimingPointCountsByContest[key] = Number(inferredTimingPointCountsByContest[key] || 0) + 1;
  }

  for (const [contestKey, count] of Object.entries(inferredTimingPointCountsByContest)) {
    const existing = byUuid[contestKey] || { splitCount: 0, timingPointCount: 0 };
    byUuid[contestKey] = {
      splitCount: existing.splitCount,
      timingPointCount: Math.max(existing.timingPointCount, Number(count || 0)),
    };
  }

  return { byUuid, byName };
}

function resolveTimingCounts(contest: { feibotContestUuid: string; feibotContestName: string; splitCount: number; timingPointCount: number }, lookup: { byUuid: Record<string, { splitCount: number; timingPointCount: number }>; byName: Record<string, { splitCount: number; timingPointCount: number }> }) {
  const uuidMatch = lookup.byUuid[normalizeKey(contest.feibotContestUuid)] || null;
  if (uuidMatch) return { splitCount: uuidMatch.splitCount, timingPointCount: uuidMatch.timingPointCount, source: 'uuid' as const };
  const nameMatch = lookup.byName[normalizeKey(contest.feibotContestName)] || null;
  if (nameMatch) return { splitCount: nameMatch.splitCount, timingPointCount: nameMatch.timingPointCount, source: 'name' as const };
  return { splitCount: Number(contest.splitCount || 0), timingPointCount: Number(contest.timingPointCount || 0), source: 'import' as const };
}

async function loadBergmanContestData(eventId: string) {
  const db = getFirestoreInstance();
  const eventSnap = await db.collection('events').doc(eventId).get();
  const eventData = eventSnap.exists ? (eventSnap.data() || {}) : {};
  const ticketDefinitionsSnap = await db.collection('events').doc(eventId).collection('ticketDefinitions').get().catch(() => null);
  const ticketDefinitions = ticketDefinitionsSnap && !ticketDefinitionsSnap.empty
    ? ticketDefinitionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    : safeArray<any>(eventData?.ticketDefinitions).map((row) => ({ ...row }));
  const ticketSubCategoryCount = ticketDefinitions.reduce((sum, ticket) => sum + (Array.isArray(ticket?.subCategories) ? ticket.subCategories.length : 0), 0);
  const bergmanEventData = {
    ...eventData,
    ticketDefinitions,
  };
  const bergmanOptions = flattenBergmanOptions(bergmanEventData);
  console.log('[contest-mapping-view] bergman ticket definitions loaded', {
    eventId,
    eventExists: eventSnap.exists,
    source: ticketDefinitionsSnap && !ticketDefinitionsSnap.empty ? 'events/{eventId}/ticketDefinitions' : 'events/{eventId}.ticketDefinitions',
    ticketDefinitionsCount: ticketDefinitions.length,
    subCategoryCount: ticketSubCategoryCount,
    bergmanContestOptionsCount: bergmanOptions.length,
  });
  return {
    eventData: bergmanEventData,
    bergmanOptions,
    ticketDefinitionsCount: ticketDefinitions.length,
    subCategoryCount: ticketSubCategoryCount,
  };
}

export async function GET(_req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalize(params?.eventId);
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const [{ source: contestRows, liveIndex, eventIndex, importSummary }, savedMapping, bergman, timingSnapshot, splitsEnabledForAthleteDashboard] = await Promise.all([
      loadContestIndex(eventId),
      loadContestMapping(eventId),
      loadBergmanContestData(eventId),
      loadTimingConfigurationSnapshot(eventId),
      loadSplitsDashboardEnabled(eventId),
    ]);

    const importedContests = normalizeContestRows(contestRows);
    const timingLookup = buildTimingCountLookup(timingSnapshot || {});
    const mappingByUuid: Record<string, any> = {};
    const suggestions: Record<string, any> = {};
    const duplicates: Record<string, string[]> = {};
    const duplicateNames: Record<string, string[]> = {};
    const seenUuids = new Set<string>();
    const seenNames = new Map<string, string[]>();

    for (const contest of importedContests) {
      const uuidKey = normalizeKey(contest.feibotContestUuid);
      const nameKey = normalizeKey(contest.feibotContestName);
      if (seenUuids.has(uuidKey)) {
        if (!duplicates[contest.feibotContestUuid]) duplicates[contest.feibotContestUuid] = [];
        duplicates[contest.feibotContestUuid].push(contest.feibotContestName);
      } else {
        seenUuids.add(uuidKey);
      }
      if (!seenNames.has(nameKey)) seenNames.set(nameKey, []);
      seenNames.get(nameKey)!.push(contest.feibotContestUuid);
    }
    for (const [key, rows] of seenNames.entries()) {
      if (rows.length > 1) {
        duplicateNames[key] = rows;
      }
    }

    const existing = savedMapping && typeof savedMapping === 'object' ? savedMapping : {};
    const mappingObject = existing?.mapping && typeof existing.mapping === 'object'
      ? existing.mapping
      : (existing?.ticketsById && typeof existing.ticketsById === 'object' ? existing.ticketsById : (existing || {}));
    const contestMappingObject: Record<string, any> = {};

    if (existing?.contestToTicket && typeof existing.contestToTicket === 'object' && existing?.ticketsById && typeof existing.ticketsById === 'object') {
      for (const [contestUuid, mappingId] of Object.entries(existing.contestToTicket as Record<string, string>)) {
        const detail = (existing.ticketsById as Record<string, any>)[mappingId];
        if (!detail) continue;
        contestMappingObject[contestUuid] = {
          feibotContestUuid: contestUuid,
          feibotContestName: normalize(detail?.feibotContestName || detail?.contestName || ''),
          bergmanContestId: normalize(detail?.bergmanContestId || detail?.ticketId || detail?.mappingId || mappingId),
          bergmanContestName: normalize(detail?.bergmanContestName || detail?.bergmanCategoryName || detail?.ticketName || detail?.displayName || ''),
          ticketId: normalize(detail?.ticketId || detail?.bergmanCategoryId || ''),
          subTicketId: normalize(detail?.subTicketId || detail?.bergmanSubCategoryId || detail?.subCategoryId || '') || null,
          bergmanCategoryId: normalize(detail?.bergmanCategoryId || detail?.ticketId || ''),
          bergmanCategoryName: normalize(detail?.bergmanCategoryName || detail?.ticketName || ''),
          bergmanSubCategoryId: normalize(detail?.bergmanSubCategoryId || detail?.subCategoryId || '') || null,
          bergmanSubCategoryName: normalize(detail?.bergmanSubCategoryName || detail?.subCategoryName || '') || null,
          status: normalize(detail?.status || (detail?.contestUuid ? 'mapped' : 'unmapped')) || 'unmapped',
          matchConfidence: Number(detail?.confidence || 100),
          matchMethod: normalize(detail?.matchMethod || 'manual') || 'manual',
          autoMapped: Boolean(detail?.autoMapped),
          updatedAt: normalize(detail?.updatedAt || detail?.mappedAt || null) || null,
        };
      }
    }
    const mappingLookup = new Map<string, any>();
    for (const option of bergman.bergmanOptions) {
      const key = normalizeKey(option.bergmanContestId);
      if (key) mappingLookup.set(key, option);
    }

    let timingCountsResolvedByUuid = 0;
    let timingCountsResolvedByName = 0;
    const mappedRows = importedContests.map((contest: any) => {
      const timingCounts = resolveTimingCounts(contest, timingLookup);
      if (timingCounts.source === 'uuid') timingCountsResolvedByUuid += 1;
      if (timingCounts.source === 'name') timingCountsResolvedByName += 1;
      const saved = contestMappingObject[contest.feibotContestUuid] || mappingObject[contest.feibotContestUuid] || mappingObject[normalizeKey(contest.feibotContestUuid)] || null;
      let bestOption: any = null;
      let bestScore = 0;
      for (const option of bergman.bergmanOptions) {
        const score = scoreAutoMatch(contest, option);
        if (score > bestScore) {
          bestScore = score;
          bestOption = option;
        }
      }

      const autoMatched = !saved && bestOption && bestScore > 95 ? bestOption : null;
      const selected = saved || autoMatched || null;
  const bergmanContestId = selected?.bergmanContestId || selected?.ticketId || null;
  const bergmanContestName = selected?.bergmanContestName || selected?.ticketName || null;
  const ticketId = normalize(selected?.ticketId || selected?.bergmanCategoryId || '') || null;
  const subTicketId = normalize(selected?.subTicketId || selected?.bergmanSubCategoryId || '') || null;
  const resolvedOption = bergmanContestId ? mappingLookup.get(normalizeKey(bergmanContestId)) || null : null;
  const status = bergmanContestId ? (resolvedOption ? 'mapped' : 'invalid') : 'unmapped';
      const matchMethod = saved ? 'manual' : autoMatched ? 'auto-exact' : bestScore > 95 ? 'auto-fuzzy' : 'manual';

      mappingByUuid[contest.feibotContestUuid] = bergmanContestId
        ? {
            feibotContestUuid: contest.feibotContestUuid,
            feibotContestName: contest.feibotContestName,
            bergmanContestId,
            bergmanContestName,
    ticketId,
    subTicketId,
    bergmanCategoryId: ticketId,
    bergmanCategoryName: selected?.bergmanCategoryName || selected?.ticketName || null,
    bergmanSubCategoryId: subTicketId,
    bergmanSubCategoryName: selected?.subTicketName || selected?.subCategoryName || null,
    status,
            matchConfidence: bestScore,
            matchMethod,
            autoMapped: Boolean(autoMatched),
            updatedAt: selected?.updatedAt || saved?.updatedAt || null,
          }
        : null;

      if (autoMatched) {
        suggestions[contest.feibotContestUuid] = {
          bergmanContestId,
          bergmanContestName,
          matchConfidence: bestScore,
          matchMethod,
        };
      }

      return {
        feibotContestUuid: contest.feibotContestUuid,
        feibotContestName: contest.feibotContestName,
        distance: contest.distance,
        categoryType: contest.categoryType,
        splitCount: timingCounts.splitCount,
        timingPointCount: timingCounts.timingPointCount,
        bergmanContestId,
        bergmanContestName,
        ticketId,
        subTicketId,
        bergmanCategoryId: ticketId,
        bergmanCategoryName: selected?.bergmanCategoryName || selected?.ticketName || null,
        bergmanSubCategoryId: subTicketId,
        bergmanSubCategoryName: selected?.subTicketName || selected?.subCategoryName || null,
        status,
        matchConfidence: bestScore,
        matchMethod,
        autoMapped: Boolean(autoMatched),
      };
    });

    const importedCount = importedContests.length;
    const mappedCount = mappedRows.filter((row: any) => row.status === 'mapped').length;
    const unmappedCount = importedCount - mappedCount;
    const lastImported = normalize((existing as any)?.lastImportedAt || (liveIndex as any)?.updatedAt || (eventIndex as any)?.updatedAt || null) || null;
    const eventTimingPointCount = Array.isArray(timingSnapshot?.timingPoints)
      ? timingSnapshot.timingPoints.length
      : Array.isArray((timingSnapshot as any)?.course?.timingPoints)
        ? (timingSnapshot as any).course.timingPoints.length
        : 0;
    const totalMappedTimingPoints = importedContests.reduce((sum: number, row: any) => sum + Number(row?.timingPointCount || 0), 0);

    console.log('[contest-mapping-view] response summary', {
      eventId,
      importedCount,
      mappedCount,
      unmappedCount,
      bergmanContestOptionsCount: bergman.bergmanOptions.length,
      ticketDefinitionsCount: bergman.ticketDefinitionsCount,
      subCategoryCount: bergman.subCategoryCount,
      timingCountsResolvedByUuid,
      timingCountsResolvedByName,
      timingCountsFromImport: importedCount - timingCountsResolvedByUuid - timingCountsResolvedByName,
      eventTimingPointCount,
      totalMappedTimingPoints,
      sampleResponse: {
        success: true,
        importedContests: mappedRows.slice(0, 2).map((row: any) => ({
          feibotContestUuid: row.feibotContestUuid,
          feibotContestName: row.feibotContestName,
          splitCount: row.splitCount,
          timingPointCount: row.timingPointCount,
          bergmanContestId: row.bergmanContestId,
          bergmanContestName: row.bergmanContestName,
        })),
        bergmanContestOptions: bergman.bergmanOptions.slice(0, 3),
      },
    });

    return NextResponse.json({
      success: true,
      eventId,
      importedContests: mappedRows,
      bergmanContestOptions: bergman.bergmanOptions,
      mapping: mappingByUuid,
      suggestions,
      splitsEnabledForAthleteDashboard,
      diagnostics: {
        importedCount,
        mappedCount,
        unmappedCount,
        lastImported,
        source: 'live:event:contest:index',
        eventTimingPointCount,
        totalMappedTimingPoints,
        liveIndexCount: Array.isArray(liveIndex) ? liveIndex.length : 0,
        eventIndexCount: Array.isArray(eventIndex) ? eventIndex.length : 0,
        importSummaryCount: Array.isArray(importSummary?.importedContests) ? importSummary.importedContests.length : 0,
        sourceCount: importedContests.length,
        cloudUuid: normalize((existing as any)?.cloudUuid || (existing as any)?.eventUuid || (eventIndex as any)?.[0]?.feibotEventUuid || null) || null,
        legacyUuid: normalize((existing as any)?.legacyUuid || null) || null,
        mappingVersion: normalize((existing as any)?.version || (existing as any)?.updatedAt || null) || null,
        duplicateUuids: Object.keys(duplicates).length > 0 ? duplicates : null,
        duplicateNames: Object.keys(duplicateNames).length > 0 ? duplicateNames : null,
        droppedContests: importedContests.length - mappedRows.length,
        ticketDefinitionsCount: bergman.ticketDefinitionsCount,
        subCategoryCount: bergman.subCategoryCount,
        bergmanContestOptionsCount: bergman.bergmanOptions.length,
        timingCountsResolvedByUuid,
        timingCountsResolvedByName,
        timingCountsFromImport: importedCount - timingCountsResolvedByUuid - timingCountsResolvedByName,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to load contest mapping view' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalize(params?.eventId);
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const mappings = Array.isArray(body?.mappings) ? body.mappings : [];
    const bergman = await loadBergmanContestData(eventId);
    const eventData = bergman.eventData as any || {};
    const bergmanOptions = bergman.bergmanOptions;
    const optionLookup = new Map(bergmanOptions.map((option) => [normalizeKey(option.bergmanContestId), option]));
    const usedBergmanKeys = new Map<string, string>();
    const invalidRows: string[] = [];

    const mappingObject: Record<string, any> = {};
    for (const row of mappings) {
      const feibotContestUuid = normalize(row?.feibotContestUuid || row?.contestUuid || row?.uuid || '');
      if (!feibotContestUuid) continue;
      const ticketId = normalize(row?.ticketId || row?.bergmanCategoryId || row?.bergmanContestTicketId || '');
      const subTicketId = normalize(row?.subTicketId || row?.bergmanSubCategoryId || row?.subCategoryId || '');
      const candidateKey = normalize(row?.bergmanContestId || row?.mappingId || (ticketId ? `${ticketId}:${subTicketId || 'base'}` : ''));
      const selectedOption = optionLookup.get(normalizeKey(candidateKey)) || optionLookup.get(normalizeKey(ticketId && subTicketId ? `${ticketId}:${subTicketId}` : ticketId)) || null;
      const bergmanContestId = normalize(selectedOption?.bergmanContestId || candidateKey || '');
      const bergmanContestName = normalize(selectedOption?.bergmanContestName || row?.bergmanContestName || row?.bergmanCategoryName || '');
      if (!bergmanContestId || !bergmanContestName || !ticketId) continue;
      const duplicateKey = normalizeKey(bergmanContestId);
      if (duplicateKey) {
        const existingFeibot = usedBergmanKeys.get(duplicateKey);
        if (existingFeibot && existingFeibot !== feibotContestUuid) {
          invalidRows.push(`${bergmanContestName} → ${existingFeibot} and ${feibotContestUuid}`);
          continue;
        }
        usedBergmanKeys.set(duplicateKey, feibotContestUuid);
      }

      mappingObject[feibotContestUuid] = {
        feibotContestUuid,
        feibotContestName: normalize(row?.feibotContestName || ''),
        feibotEventUuid: normalize(body?.feibotEventUuid || eventData?.feibotEventUuid || eventData?.cloudEventUuid || ''),
        ticketId,
        subTicketId: subTicketId || null,
        bergmanCategoryId: ticketId,
        bergmanCategoryName: normalize(selectedOption?.ticketName || row?.bergmanCategoryName || ''),
        bergmanSubCategoryId: subTicketId || null,
        bergmanSubCategoryName: normalize(selectedOption?.subTicketName || row?.bergmanSubCategoryName || ''),
        bergmanContestId,
        bergmanContestName,
        status: 'mapped',
        matchConfidence: Number(row?.matchConfidence || 100),
        matchMethod: normalize(row?.matchMethod || 'manual') || 'manual',
        autoMapped: Boolean(row?.autoMapped),
        mappedAt: new Date().toISOString(),
        mappedBy: normalize(body?.updatedBy || body?.mappedBy || 'admin-ui') || 'admin-ui',
        updatedAt: new Date().toISOString(),
      };
    }

    if (invalidRows.length > 0) {
      return NextResponse.json({ success: false, message: `Duplicate Bergman mappings are not allowed: ${invalidRows.join('; ')}` }, { status: 409 });
    }

    const payload = {
      eventId,
      mapping: mappingObject,
      version: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'contest-mapping-view',
    };

    const mappedCount = Object.keys(mappingObject).length;
    const splitsDashboardFlag = {
      enabled: mappedCount > 0,
      mappedCount,
      updatedAt: new Date().toISOString(),
      updatedBy: normalize(body?.updatedBy || 'admin-ui') || 'admin-ui',
    };

    await Promise.all([
      putKV(`live:event:${eventId}:contest:mapping`, payload, 'contest-mapping-view'),
      getFirestoreInstance().collection('events').doc(eventId).collection('liveTracking').doc('contestMapping').set(payload, { merge: true }),
      putKV(`event:${eventId}:splits:dashboard:enabled`, splitsDashboardFlag, 'contest-mapping-view'),
    ]);

    return NextResponse.json({ success: true, mapping: mappingObject, count: Object.keys(mappingObject).length, splitsEnabledForAthleteDashboard: mappedCount > 0, payload });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to save contest mapping' }, { status: 500 });
  }
}
