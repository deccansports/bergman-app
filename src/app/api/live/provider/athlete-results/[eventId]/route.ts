import { NextRequest, NextResponse } from 'next/server';
import { callFeibotAPI } from '@/lib/feibot-integration/api-client';
import { getKV } from '@/lib/cloudflare/kv';
import { loadParticipantPublicView } from '@/lib/liveTrackingParticipantStore';
import { liveResultIndexKvKey, liveResultKvKey, liveResultsKvKey } from '@/lib/live-tracking/storageKeys';
import type { Split } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CacheEntry = {
  expiresAt: number;
  payload: any;
};

type ProviderUnavailableContext = {
  eventId: string;
  participantUuid: string | null;
  contestUuid: string | null;
  endpoint: string | null;
  status: number;
  message: string;
  providerMessage?: string | null;
};

const ATHLETE_RESULTS_CACHE_TTL_MS = 30_000;
const LIVE_RESULTS_KV_KEYS = (eventId: string) => [
  `event:${eventId}:liveResults`,
  `live:event:${eventId}:liveResults`,
  `event:${eventId}:results`,
  `live:event:${eventId}:results`,
];
const athleteResultsCache = new Map<string, CacheEntry>();

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeLower(value: unknown) {
  return normalize(value).toLowerCase();
}

function parseSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value >= 0 ? value : null;

  const text = normalize(value);
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : null;
  }

  const parts = text.split(':').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function parseTimestamp(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    return n > 1_000_000_000_000 ? Math.round(n / 1000) : Math.round(n);
  }
  const iso = normalize(value);
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.round(ms / 1000);
}

function extractRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const direct = [payload.data, payload.results, payload.rows, payload.list, payload.items, payload.participants];
  for (const candidate of direct) {
    if (Array.isArray(candidate)) return candidate;
  }

  const nested = [payload.data, payload.result, payload.payload, payload.response];
  for (const child of nested) {
    const rows = extractRows(child);
    if (rows.length > 0) return rows;
  }

  return [];
}

function getRowBib(row: any) {
  return normalize(row?.bib ?? row?.bib_no ?? row?.bibNumber ?? row?.number ?? row?.no);
}

function getRowParticipantUuid(row: any) {
  return normalize(
    row?.participant_uuid ?? row?.participantUuid ?? row?.uuid ?? row?.participant_id ?? row?.participantId,
  );
}

function getRowContestUuid(row: any) {
  return normalize(row?.contest_uuid ?? row?.contestUuid ?? row?.contestUUID ?? row?.contest_id ?? row?.contestId);
}

function normalizeSegment(value: unknown) {
  const raw = normalize(value).toUpperCase();
  if (!raw) return '';
  if (raw === 'TRANSITION1') return 'T1';
  if (raw === 'TRANSITION2') return 'T2';
  if (raw === 'FINISHED') return 'FINISH';
  return raw;
}

function buildStructuredSplits(row: any): Split[] {
  const source = Array.isArray(row?.splits)
    ? row.splits
    : Array.isArray(row?.timing_points)
      ? row.timing_points
      : Array.isArray(row?.timingPoints)
        ? row.timingPoints
        : [];

  if (!Array.isArray(source) || source.length === 0) return [];

  const normalized = source
    .map((entry: any, index: number) => {
      const segment = normalizeSegment(
        entry?.segment ?? entry?.name ?? entry?.label ?? entry?.point ?? entry?.split ?? entry?.code,
      ) || `SPLIT_${index + 1}`;
      const time = parseSeconds(entry?.time ?? entry?.elapsed ?? entry?.elapsed_seconds ?? entry?.result ?? entry?.value);
      if (time === null || time < 0) return null;

      return {
        id: normalize(entry?.id ?? entry?.uuid ?? entry?.splitUuid ?? `${segment}-${index + 1}`),
        uuid: normalize(entry?.uuid ?? entry?.id),
        splitUuid: normalize(entry?.splitUuid ?? entry?.uuid ?? entry?.id),
        providerId: normalize(entry?.providerId ?? entry?.id ?? entry?.uuid) || null,
        providerCode: normalize(entry?.code ?? entry?.label ?? entry?.name) || null,
        segment,
        name: normalize(entry?.name ?? entry?.label ?? entry?.point) || segment,
        label: normalize(entry?.label ?? entry?.name ?? entry?.point) || segment,
        distance: Number(entry?.distance ?? entry?.distanceKm ?? entry?.km ?? 0) || 0,
        time,
        absoluteTimestamp: parseTimestamp(entry?.timestamp ?? entry?.time_at ?? entry?.updatedAt ?? entry?.createdAt),
        rawSplitLabel: normalize(entry?.rawSplitLabel ?? entry?.label ?? entry?.name ?? entry?.point ?? segment),
      } as Split;
    })
    .filter((row): row is Split => Boolean(row))
    .sort((a, b) => (a.time || 0) - (b.time || 0));

  return normalized;
}

function buildFallbackSplits(row: any): Split[] {
  const keys: Array<{ segment: string; value: unknown }> = [
    { segment: 'SWIM', value: row?.swim ?? row?.swim_time ?? row?.swimTime },
    { segment: 'RUN1', value: row?.run1 ?? row?.run_1 ?? row?.run1_time },
    { segment: 'T1', value: row?.t1 ?? row?.transition1 ?? row?.transition_1_time },
    { segment: 'BIKE', value: row?.bike ?? row?.bike_time ?? row?.bikeTime ?? row?.cycle_time },
    { segment: 'T2', value: row?.t2 ?? row?.transition2 ?? row?.transition_2_time },
    { segment: 'RUN', value: row?.run ?? row?.run_time ?? row?.runTime },
    { segment: 'RUN2', value: row?.run2 ?? row?.run_2 ?? row?.run2_time },
    { segment: 'FINISH', value: row?.finish_time ?? row?.finishTime ?? row?.official_time ?? row?.chip_time ?? row?.total_time },
  ];

  return keys
    .map(({ segment, value }, index) => {
      const seconds = parseSeconds(value);
      if (seconds === null || seconds <= 0) return null;
      return {
        id: `${segment}-${index + 1}`,
        providerId: null,
        providerCode: segment,
        segment,
        name: segment,
        label: segment,
        distance: 0,
        time: seconds,
        rawSplitLabel: segment,
      } as Split;
    })
    .filter((entry): entry is Split => Boolean(entry));
}

function normalizeStatus(value: unknown) {
  const raw = normalizeLower(value);
  if (!raw) return 'Unknown';
  if (raw === 'finished' || raw === 'finish' || raw === 'complete' || raw === 'completed' || raw === 'ok') return 'Finished';
  if (raw === 'dnf' || raw === 'did_not_finish') return 'DNF';
  if (raw === 'dns' || raw === 'did_not_start') return 'DNS';
  if (raw === 'dnq' || raw === 'dq' || raw === 'disqualified') return 'DNQ';
  return raw.toUpperCase();
}

function buildEmptyTimingResponse(params: {
  eventId: string;
  athlete: any;
  providerMessage?: string | null;
  source: string;
}) {
  return {
    success: true,
    providerAvailable: false,
    liveAvailable: false,
    splitsAvailable: false,
    athlete: params.athlete,
    timing: null,
    message: params.providerMessage || 'Live timing is currently unavailable.',
    source: params.source,
    cacheHit: false,
    eventId: params.eventId,
  };
}

async function loadCachedLiveResult(eventId: string, params: { bib?: string | null; participantUuid?: string | null; contestUuid?: string | null }) {
  const index = await getKV<any>(liveResultIndexKvKey(eventId), 'api-athlete-results').catch(() => null);
  const results = await getKV<any>(liveResultsKvKey(eventId), 'api-athlete-results').catch(() => null);

  const lookupKeys = [
    normalize(params.participantUuid),
    normalize(params.bib).replace(/^0+/, ''),
  ].filter(Boolean) as string[];

  let resolvedId = '';
  for (const key of lookupKeys) {
    resolvedId = normalize(
      index?.byProviderAthleteId?.[key]
      || index?.byAthleteUid?.[key]
      || index?.byBookingId?.[key]
      || index?.byBib?.[key]
      || '',
    );
    if (resolvedId) break;
  }

  let cachedRow = null;
  if (resolvedId) {
    cachedRow = await getKV<any>(liveResultKvKey(eventId, resolvedId), 'api-athlete-results').catch(() => null);
  }

  if (!cachedRow && Array.isArray(results)) {
    const bibKey = normalize(params.bib).replace(/^0+/, '');
    const participantKey = normalize(params.participantUuid);
    const contestKey = normalize(params.contestUuid);
    cachedRow = results.find((row: any) => {
      const rowBib = normalize(getRowBib(row)).replace(/^0+/, '');
      const rowParticipant = normalize(getRowParticipantUuid(row));
      const rowContest = normalize(getRowContestUuid(row));
      return (
        (!bibKey || rowBib === bibKey)
        && (!participantKey || rowParticipant === participantKey)
        && (!contestKey || !rowContest || rowContest === contestKey)
      );
    }) || null;
  }

  if (!cachedRow) return null;

  const splits = buildStructuredSplits(cachedRow);
  const fallbackSplits = splits.length > 0 ? splits : buildFallbackSplits(cachedRow);
  return {
    success: true,
    providerAvailable: true,
    liveAvailable: true,
    splitsAvailable: fallbackSplits.length > 0,
    timing: {
      status: normalizeStatus(cachedRow?.status ?? cachedRow?.result_status ?? cachedRow?.race_status),
      splits: fallbackSplits,
      rawResult: cachedRow,
      source: 'kv',
    },
    message: 'Live timing loaded from KV.',
    source: 'kv',
    cacheHit: true,
  };
}

async function updateProviderState(eventId: string, patch: Record<string, any>) {
  try {
    const payload = {
      ...(patch || {}),
      updatedAt: new Date().toISOString(),
    };
    await Promise.all([
      getKV(`event:${eventId}:providerState`, 'api-athlete-results').then(() => null),
      getKV(`live:event:${eventId}:providerState`, 'api-athlete-results').then(() => null),
    ]);
    const { putKV } = await import('@/lib/cloudflare/kv');
    await putKV(`event:${eventId}:providerState`, payload, 'api-athlete-results');
    await putKV(`live:event:${eventId}:providerState`, payload, 'api-athlete-results');
  } catch {
    // best effort only
  }
}

function extractTimingFromCachedLiveResults(cache: any, participantUuid: string, contestUuid: string | null, bib: string) {
  const rows = extractRows(cache);
  const bibKey = normalizeLower(bib).replace(/^0+/, '');
  const participantKey = normalizeLower(participantUuid);
  const contestKey = normalizeLower(contestUuid);

  const matchingRow = rows.find((row: any) => {
    const rowBib = normalizeLower(getRowBib(row)).replace(/^0+/, '');
    const rowParticipant = normalizeLower(getRowParticipantUuid(row));
    const rowContest = normalizeLower(getRowContestUuid(row));
    const bibOk = !bibKey || rowBib === bibKey;
    const participantOk = !participantKey || rowParticipant === participantKey;
    const contestOk = !contestKey || !rowContest || rowContest === contestKey;
    return bibOk && participantOk && contestOk;
  });

  if (!matchingRow) return null;
  const splits = buildStructuredSplits(matchingRow);
  const fallbackSplits = splits.length > 0 ? splits : buildFallbackSplits(matchingRow);
  return {
    success: true,
    providerAvailable: true,
    liveAvailable: true,
    splitsAvailable: fallbackSplits.length > 0,
    timing: {
      status: normalizeStatus(matchingRow?.status ?? matchingRow?.result_status ?? matchingRow?.race_status),
      splits: fallbackSplits,
      rawResult: matchingRow,
      source: 'cache',
    },
    message: 'Live timing loaded from cache.',
    source: 'cache',
    cacheHit: true,
  };
}

async function fetchResults(eventUuid: string, accessKey: string, secretKey: string, apiBaseUrl: string) {
  const query = `event_uuid=${encodeURIComponent(eventUuid)}`;
  const paths = [
    `/temporary/temporary_ResultDataGetAll?${query}`,
    `/resultQueryService/queryLatestResults?${query}`,
    `/resultQueryService/queryFinishedResults?${query}`,
    `/leaderboardQueryService/queryLeaderboard?${query}`,
    `/api/leaderboardQuery?${query}`,
  ];

  let lastResponse: any = null;
  let lastPath: string | null = null;
  for (const path of paths) {
    const [rawPath, rawQuery = ''] = path.split('?');
    const query: Record<string, string> = {};
    const search = new URLSearchParams(rawQuery);
    for (const [k, v] of search.entries()) query[k] = v;

    const response = await callFeibotAPI<any>(
      {
        accountId: 'athlete-results',
        accessKey,
        secretKey,
        apiBaseUrl,
      },
      rawPath,
      {
        method: 'GET',
        query,
      },
    );
    lastResponse = response;
    lastPath = path;
    if (!response.ok) continue;
    const rows = extractRows(response.data);
    if (rows.length > 0) {
      return {
        ok: true,
        path,
        url: `${apiBaseUrl.replace(/\/$/, '')}${path}`,
        rows,
        raw: response.data,
      };
    }
  }

  return {
    ok: false,
    path: lastPath,
    url: null,
    rows: [] as any[],
    raw: lastResponse?.data || null,
    status: Number(lastResponse?.status || 0),
  };
}

async function loadPhase1ProviderConfig(eventId: string) {
  const kvConfig =
    (await getKV<Record<string, any>>(`event:${eventId}:provider-config`, 'api-athlete-results')) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:provider-config`, 'api-athlete-results')) ||
    (await getKV<Record<string, any>>(`event:${eventId}:config`, 'api-athlete-results')) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:config`, 'api-athlete-results')) ||
    {};

  const feibotConfig = kvConfig?.feibotConfig || {};
  const cloudConfig = feibotConfig?.cloud || {};
  const providerConfig = kvConfig?.providerConfig || {};
  const accessKey = normalize(process.env.FEIBOT_ACCESS_KEY || providerConfig?.accessKey || feibotConfig?.accessKey || cloudConfig?.accessKey);
  const secretKey = normalize(process.env.FEIBOT_SECRET_KEY || providerConfig?.secretKey || feibotConfig?.secretKey || cloudConfig?.secretKey);
  const eventUuid = normalize(providerConfig?.eventUuid || feibotConfig?.eventUuid || cloudConfig?.eventUuid);
  const apiBaseUrl = normalize(process.env.FEIBOT_API_BASE_URL || providerConfig?.apiBaseUrl || feibotConfig?.apiBaseUrl || cloudConfig?.apiBaseUrl || 'https://apicn.feibot.com') || 'https://apicn.feibot.com';

  return { accessKey, secretKey, eventUuid, apiBaseUrl };
}

async function resolveMappedParticipantUuid(params: {
  eventId: string;
  bib?: string;
  contestUuid?: string;
  participantUuid?: string;
}) {
  const directParticipantUuid = normalize(params.participantUuid);
  if (directParticipantUuid) {
    return {
      participantUuid: directParticipantUuid,
      mappingSource: 'query.participantUuid',
      mapping: null as any,
    };
  }

  const bib = normalize(params.bib);
  if (!bib) {
    return {
      participantUuid: '',
      mappingSource: 'none',
      mapping: null as any,
    };
  }

  const mappingRoot = (await getKV<Record<string, any>>(`event:${params.eventId}:participant-mapping`, 'api-athlete-results')) || {};
  const byBib = (mappingRoot?.byBib || mappingRoot) as Record<string, any>;
  const mappingByProviderRoot = (await getKV<Record<string, any>>(`event:${params.eventId}:participant-mapping-by-provider`, 'api-athlete-results')) || {};
  const byProvider = (mappingByProviderRoot?.byProvider || mappingByProviderRoot) as Record<string, any>;

  const compactBib = bib.replace(/^0+/, '');
  const mappedByBib = byBib[bib] || byBib[compactBib] || null;

  let resolvedMapping = mappedByBib;
  if (!resolvedMapping && params.contestUuid) {
    const targetContest = normalizeLower(params.contestUuid);
    for (const key of Object.keys(byProvider || {})) {
      const row = byProvider[key];
      const rowBib = normalize(row?.bib || row?.bibNumber).replace(/^0+/, '');
      const rowContest = normalizeLower(row?.contestUuid || row?.contestUUID || row?.contest_uuid);
      if (rowBib && rowBib === compactBib && (!targetContest || rowContest === targetContest)) {
        resolvedMapping = row;
        break;
      }
    }
  }

  const mappedParticipantUuid = normalize(
    resolvedMapping?.providerParticipantUuid ||
    resolvedMapping?.participantUuid ||
    resolvedMapping?.participant_uuid ||
    resolvedMapping?.feibotParticipantUUID ||
    resolvedMapping?.providerUuid ||
    '',
  );

  return {
    participantUuid: mappedParticipantUuid,
    mappingSource: resolvedMapping ? 'kv.participant-mapping' : 'none',
    mapping: resolvedMapping || null,
  };
}

async function resolveNormalizedAthleteRecord(params: {
  eventId: string;
  bib: string;
  contestUuid: string | null;
  participantUuid: string | null;
  participantsIndex: Record<string, any> | null;
}) {
  const participantRows = Array.isArray((params.participantsIndex as any)?.participants)
    ? (params.participantsIndex as any).participants
    : Object.values(((params.participantsIndex as any)?.byUuid || (params.participantsIndex as any)?.byBib || {}) as Record<string, any>);

  const bibCompact = params.bib.replace(/^0+/, '');
  const direct = participantRows.find((row: any) => {
    const rowBib = normalize(row?.bib || row?.bibNumber || row?.providerBib).replace(/^0+/, '');
    const rowUuid = normalize(row?.participantUuid || row?.participant_uuid || row?.uuid || row?.providerUuid);
    return (!!bibCompact && rowBib === bibCompact) || (!!params.participantUuid && rowUuid === params.participantUuid);
  }) || null;

  const mappedResolution = direct
    ? { participantUuid: normalize(direct?.participantUuid || direct?.participant_uuid || direct?.uuid || ''), mappingSource: 'participant-index', mapping: direct }
    : await resolveMappedParticipantUuid({ eventId: params.eventId, bib: params.bib, contestUuid: params.contestUuid || undefined, participantUuid: params.participantUuid || undefined });

  const resolvedParticipantUuid = normalize(mappedResolution.participantUuid || direct?.participantUuid || direct?.participant_uuid || direct?.uuid || '');
  const rowContestUuid = normalize(direct?.contestUuid || direct?.contest_uuid || params.contestUuid || mappedResolution.mapping?.contestUuid || '');
  const rowContestName = normalize(direct?.contestName || direct?.contest_name || mappedResolution.mapping?.contestName || '');

  return {
    athlete: direct || {
      bib: params.bib || null,
      bibNumber: params.bib || null,
      participantUuid: resolvedParticipantUuid || null,
      contestUuid: rowContestUuid || null,
      contestName: rowContestName || null,
    },
    mappingSource: mappedResolution.mappingSource,
    resolvedParticipantUuid,
    contestUuid: rowContestUuid || null,
    contestName: rowContestName || null,
  };
}

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalize(params?.eventId);
    const bib = normalize(req.nextUrl.searchParams.get('bib'));
    const contestUuid = normalize(req.nextUrl.searchParams.get('contestUuid'));
    const participantUuid = normalize(req.nextUrl.searchParams.get('participantUuid'));

    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }
    if (!bib && !participantUuid) {
      return NextResponse.json({ success: false, message: 'bib or participantUuid is required' }, { status: 400 });
    }

    const normalizedAthlete = await resolveNormalizedAthleteRecord({
      eventId,
      bib,
      contestUuid: contestUuid || null,
      participantUuid: participantUuid || null,
      participantsIndex: await getKV<Record<string, any>>(`live:event:${eventId}:participant:index`, 'api-athlete-results').catch(() => null),
    });

    const cacheKey = `${eventId}:${contestUuid || normalizedAthlete.contestUuid || 'none'}:${bib || 'none'}:${normalizedAthlete.resolvedParticipantUuid || 'none'}`;
    const now = Date.now();
    const cached = athleteResultsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return NextResponse.json({ ...cached.payload, cacheHit: true });
    }

    const participantView = await loadParticipantPublicView(eventId, {
      bookingId: null,
      bib: bib || null,
      athleteUid: participantUuid || null,
      providerParticipantUuid: participantUuid || null,
      email: null,
    });

    const cachedLiveResult = await loadCachedLiveResult(eventId, {
      bib: bib || null,
      participantUuid: participantUuid || normalizedAthlete.resolvedParticipantUuid || null,
      contestUuid: contestUuid || normalizedAthlete.contestUuid || null,
    });

    const athleteRecord = participantView?.merged || participantView?.participantLive || normalizedAthlete.athlete;
    const liveTiming = participantView?.participantLive || cachedLiveResult?.timing || null;
    const timingSource = liveTiming || athleteRecord;
    const splits = Array.isArray(timingSource?.splits) && timingSource.splits.length > 0
      ? timingSource.splits
      : buildStructuredSplits(timingSource?.rawResult || timingSource).length > 0
        ? buildStructuredSplits(timingSource?.rawResult || timingSource)
        : buildFallbackSplits(timingSource?.rawResult || timingSource);

    const responsePayload = {
      success: true,
      providerAvailable: true,
      liveAvailable: true,
      splitsAvailable: splits.length > 0,
      eventId,
      athlete: athleteRecord,
      bib: bib || null,
      participantUuid: participantView?.merged?.participantUuid || participantView?.merged?.providerParticipantUuid || participantView?.bookingId || participantUuid || null,
      contestUuid: participantView?.contestUuid || contestUuid || null,
      mappingSource: participantView ? 'kv' : normalizedAthlete.mappingSource,
      mappedProviderParticipantUuid: participantView?.merged?.participantUuid || participantView?.merged?.providerParticipantUuid || participantUuid || null,
      endpoint: null,
      endpointUrl: null,
      providerCount: splits.length,
      matchedCount: splits.length,
      found: Boolean(liveTiming),
      status: normalizeStatus(timingSource?.status ?? timingSource?.result_status ?? timingSource?.race_status),
      resolvedBib: normalize(timingSource?.bib || bib || null) || null,
      resolvedParticipantUuid: normalize(timingSource?.participantUuid || timingSource?.participant_uuid || participantUuid || null) || null,
      resolvedContestUuid: normalize(timingSource?.contestUuid || timingSource?.contest_uuid || contestUuid || null) || null,
      splits,
      rawResult: timingSource || null,
      rawPayloadSample: timingSource || null,
      cacheHit: false,
      message: splits.length > 0 ? 'Live timing loaded from KV.' : 'Waiting for live timing.',
    };

    console.log('[athlete-results]', {
      eventId,
      bib: bib || null,
      contestUuid: contestUuid || null,
      providerParticipantUuid: participantUuid || null,
      requestUrl: null,
      httpStatus: 200,
      providerResponse: {
        matchedCount: splits.length,
        found: Boolean(liveTiming),
        status: responsePayload.status,
      },
    });

    athleteResultsCache.set(cacheKey, {
      expiresAt: Date.now() + ATHLETE_RESULTS_CACHE_TTL_MS,
      payload: responsePayload,
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('[athlete-results][error]', {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({
      success: true,
      providerAvailable: false,
      liveAvailable: false,
      splitsAvailable: false,
      athlete: null,
      timing: null,
      message: 'Live timing is currently unavailable.',
    });
  }
}
