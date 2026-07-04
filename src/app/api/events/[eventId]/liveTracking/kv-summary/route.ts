import { NextRequest, NextResponse } from 'next/server';
import { getKV } from '@/lib/cloudflare/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function countRows(value: any): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.rows)) return value.rows.length;
  if (Array.isArray(value?.items)) return value.items.length;
  if (Array.isArray(value?.data)) return value.data.length;
  if (Array.isArray(value?.participants)) return value.participants.length;
  if (value?.byUuid && typeof value.byUuid === 'object') return Object.keys(value.byUuid).length;
  if (value?.byBib && typeof value.byBib === 'object') return Object.keys(value.byBib).length;
  if (value?.byProvider && typeof value.byProvider === 'object') return Object.keys(value.byProvider).length;
  if (typeof value?.count === 'number') return value.count;
  if (typeof value?.total === 'number') return value.total;
  if (typeof value?.importedCount === 'number') return value.importedCount;
  if (typeof value?.importedRecords === 'number') return value.importedRecords;
  return 0;
}

function extractRows(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.participants)) return value.participants;
  if (value?.byUuid && typeof value.byUuid === 'object') return Object.values(value.byUuid);
  if (value?.byBib && typeof value.byBib === 'object') return Object.values(value.byBib);
  if (value?.byProvider && typeof value.byProvider === 'object') return Object.values(value.byProvider);
  if (value?.byProviderUuid && typeof value.byProviderUuid === 'object') return Object.values(value.byProviderUuid);

  const nestedCandidates = [value?.data, value?.payload, value?.raw, value?.upstream, value?.metadata];
  for (const candidate of nestedCandidates) {
    const nested = extractRows(candidate);
    if (nested.length > 0) return nested;
  }

  if (value && typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      const nested = extractRows(nestedValue);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

function rowKeys(row: any): string[] {
  const normalize = (value: unknown) => String(value ?? '').trim();
  const compact = (value: unknown) => normalize(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return [
    row?.bookingId,
    row?.id,
    row?.bib,
    row?.bibNumber,
    row?.participantUuid,
    row?.participant_uuid,
    row?.providerParticipantUuid,
    row?.providerParticipantUuid,
    row?.providerUuid,
    row?.uuid,
    row?.chip,
    row?.chipCode,
  ]
    .map(compact)
    .filter(Boolean);
}

function oneToOneMatchCounts(leftRows: any[], rightRows: any[]) {
  const rightKeyToIndices = new Map<string, number[]>();
  rightRows.forEach((row, index) => {
    for (const key of rowKeys(row)) {
      const list = rightKeyToIndices.get(key) || [];
      list.push(index);
      rightKeyToIndices.set(key, list);
    }
  });

  const usedRight = new Set<number>();
  let matched = 0;

  for (const leftRow of leftRows) {
    const keys = rowKeys(leftRow);
    let found = false;
    for (const key of keys) {
      const candidates = rightKeyToIndices.get(key) || [];
      const available = candidates.find((index) => !usedRight.has(index));
      if (available !== undefined) {
        usedRight.add(available);
        matched++;
        found = true;
        break;
      }
    }
    if (!found) continue;
  }

  return {
    matched,
    unmatchedLeft: Math.max(0, leftRows.length - matched),
    unmatchedRight: Math.max(0, rightRows.length - usedRight.size),
  };
}

function lastUpdated(value: any): string | null {
  if (!value) return null;
  const candidates = [
    value.updatedAt,
    value.generatedAt,
    value.importedAt,
    value.lastUpdated,
    value.lastSync,
    value.timestamp,
    value.createdAt,
  ];
  for (const candidate of candidates) {
    const text = normalize(candidate);
    if (text) return text;
  }
  return null;
}

function statusFromExistsAndCount(exists: boolean, count: number) {
  if (!exists) return 'FAIL';
  return count > 0 ? 'PASS' : 'WARNING';
}

function detectDuplicates(rows: any[], field: string) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const value = normalize(row?.[field]);
    if (!value) continue;
    map.set(value, (map.get(value) || 0) + 1);
  }
  const duplicates = Array.from(map.entries()).filter(([, count]) => count > 1);
  return {
    status: duplicates.length === 0 ? 'PASS' : 'FAIL',
    count: duplicates.length,
    affected: duplicates.map(([value, count]) => ({ value, count })),
  };
}

export async function GET(_req: NextRequest, { params }: { params: { eventId: string } }) {
  const eventId = normalize(params?.eventId);
  if (!eventId) {
    return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
  }

  const [
    config,
    timingConfiguration,
    contestIndex,
    participantIndex,
    providerParticipantIndex,
    feibotParticipantIndex,
    providerParticipantsEvent,
    providerParticipantsLive,
    providerIndexEvent,
    providerIndexLive,
    providerSyncParticipantsEvent,
    providerSyncParticipantsLive,
    splitIndex,
    timingPointIndex,
    leaderboards,
  ] = await Promise.all([
    getKV<any>(`event:${eventId}:config`, 'kv-summary'),
    getKV<any>(`event:${eventId}:timingConfiguration`, 'kv-summary'),
    getKV<any>(`event:${eventId}:contestIndex`, 'kv-summary'),
    getKV<any>(`event:${eventId}:participant:index`, 'kv-summary'),
    getKV<any>(`event:${eventId}:providerParticipantIndex`, 'kv-summary'),
    getKV<any>(`event:${eventId}:feibot:participant:index`, 'kv-summary'),
    getKV<any>(`event:${eventId}:providerParticipants`, 'kv-summary'),
    getKV<any>(`live:event:${eventId}:providerParticipants`, 'kv-summary'),
    getKV<any>(`event:${eventId}:providerIndex`, 'kv-summary'),
    getKV<any>(`live:event:${eventId}:providerIndex`, 'kv-summary'),
    getKV<any>(`event:${eventId}:provider:participants`, 'kv-summary'),
    getKV<any>(`live:event:${eventId}:provider:participants`, 'kv-summary'),
    getKV<any>(`event:${eventId}:splitIndex`, 'kv-summary'),
    getKV<any>(`event:${eventId}:timingPointIndex`, 'kv-summary'),
    getKV<any>(`event:${eventId}:leaderboards`, 'kv-summary'),
  ]);

  const participantRows = extractRows(participantIndex);
  const providerSources = [
    feibotParticipantIndex,
    providerParticipantIndex,
    providerIndexEvent,
    providerIndexLive,
    providerParticipantsEvent,
    providerParticipantsLive,
    providerSyncParticipantsEvent,
    providerSyncParticipantsLive,
  ];

  const providerRows = providerSources
    .map((source) => extractRows(source))
    .find((rows) => Array.isArray(rows) && rows.length > 0) || [];

  const participantCount = participantRows.length || countRows(participantIndex);
  const providerLinkedCount = providerRows.length || providerSources.map((source) => countRows(source)).find((count) => count > 0) || 0;
  const matchedCounts = oneToOneMatchCounts(participantRows, providerRows);
  const bergmanUpdatedAt = lastUpdated(participantIndex);
  const feibotUpdatedAt =
    lastUpdated(feibotParticipantIndex)
    || lastUpdated(providerParticipantIndex)
    || lastUpdated(providerIndexEvent)
    || lastUpdated(providerIndexLive)
    || lastUpdated(providerParticipantsEvent)
    || lastUpdated(providerParticipantsLive)
    || lastUpdated(providerSyncParticipantsEvent)
    || lastUpdated(providerSyncParticipantsLive);

  const diagnostics = {
    duplicateBookingIds: detectDuplicates(participantRows, 'bookingId'),
    duplicateBibs: detectDuplicates(participantRows, 'bib'),
    duplicateChips: detectDuplicates(participantRows, 'chip'),
    duplicateProviderUuids: detectDuplicates(participantRows, 'providerParticipantUuid'),
    duplicateEmails: detectDuplicates(participantRows, 'email'),
    duplicateMobiles: detectDuplicates(participantRows, 'mobile'),
    missingContestUuid: {
      status: participantRows.some((row: any) => !normalize(row?.contestUuid || row?.providerContestUuid)) ? 'FAIL' : 'PASS',
      count: participantRows.filter((row: any) => !normalize(row?.contestUuid || row?.providerContestUuid)).length,
    },
    missingProviderUuid: {
      status: participantRows.some((row: any) => !normalize(row?.providerParticipantUuid || row?.participantUuid || row?.providerUuid)) ? 'FAIL' : 'PASS',
      count: participantRows.filter((row: any) => !normalize(row?.providerParticipantUuid || row?.participantUuid || row?.providerUuid)).length,
    },
    missingTicketMapping: {
      status: participantRows.some((row: any) => !normalize(row?.ticketId || row?.ticketName)) ? 'WARN' : 'PASS',
      count: participantRows.filter((row: any) => !normalize(row?.ticketId || row?.ticketName)).length,
    },
    missingSplitMapping: {
      status: timingConfiguration && splitIndex ? 'PASS' : 'FAIL',
      count: timingConfiguration && splitIndex ? 0 : 1,
    },
  };

  const validation = [
    { key: 'config', label: 'event:{eventId}:config', exists: !!config, count: countRows(config), lastUpdated: lastUpdated(config), status: statusFromExistsAndCount(!!config, countRows(config)) },
    { key: 'timingConfiguration', label: 'event:{eventId}:timingConfiguration', exists: !!timingConfiguration, count: countRows(timingConfiguration), lastUpdated: lastUpdated(timingConfiguration), status: statusFromExistsAndCount(!!timingConfiguration, countRows(timingConfiguration)) },
    { key: 'contestIndex', label: 'event:{eventId}:contestIndex', exists: !!contestIndex, count: countRows(contestIndex), lastUpdated: lastUpdated(contestIndex), status: statusFromExistsAndCount(!!contestIndex, countRows(contestIndex)) },
    { key: 'participantIndex', label: 'event:{eventId}:participant:index', exists: !!participantIndex, count: participantCount, lastUpdated: bergmanUpdatedAt, status: statusFromExistsAndCount(!!participantIndex, participantCount) },
    {
      key: 'providerParticipantIndex',
      label: 'event:{eventId}:feibot:participant:index (plus providerParticipants/providerIndex/provider:participants fallbacks)',
      exists: providerSources.some(Boolean),
      count: providerLinkedCount,
      lastUpdated: feibotUpdatedAt,
      status: statusFromExistsAndCount(providerSources.some(Boolean), providerLinkedCount),
    },
    { key: 'splitIndex', label: 'event:{eventId}:splitIndex', exists: !!splitIndex, count: countRows(splitIndex), lastUpdated: lastUpdated(splitIndex), status: statusFromExistsAndCount(!!splitIndex, countRows(splitIndex)) },
    { key: 'timingPointIndex', label: 'event:{eventId}:timingPointIndex', exists: !!timingPointIndex, count: countRows(timingPointIndex), lastUpdated: lastUpdated(timingPointIndex), status: statusFromExistsAndCount(!!timingPointIndex, countRows(timingPointIndex)) },
    { key: 'leaderboards', label: 'event:{eventId}:leaderboards', exists: !!leaderboards, count: countRows(leaderboards), lastUpdated: lastUpdated(leaderboards), status: statusFromExistsAndCount(!!leaderboards, countRows(leaderboards)) },
  ];

  const readinessChecks = [
    { label: 'Provider', ok: !!config?.provider || !!config?.feibotConfig || providerLinkedCount > 0 },
    { label: 'Timing Rules', ok: !!timingConfiguration },
    { label: 'Contest Mapping', ok: !!contestIndex },
    { label: 'Participants Imported', ok: participantCount > 0 },
    { label: 'Provider UUID Linked', ok: providerLinkedCount > 0 && providerLinkedCount >= participantCount },
    { label: 'Split Index Built', ok: !!splitIndex },
    { label: 'Timing Point Index Built', ok: !!timingPointIndex },
    { label: 'Leaderboards Built', ok: !!leaderboards },
    { label: 'Results Imported', ok: false },
    { label: 'Live Sync Started', ok: false },
    { label: 'Replay Enabled', ok: Boolean(config?.trackingConfig?.enableReplayMode) },
    { label: 'Public Tracking Enabled', ok: Boolean(config?.trackingConfig?.enabled ?? true) },
  ];

  const readinessScore = Math.round((readinessChecks.filter((item) => item.ok).length / readinessChecks.length) * 100);

  return NextResponse.json({
    success: true,
    eventId,
    readinessScore,
    summary: {
      bergmanParticipants: participantCount,
      feibotParticipants: providerLinkedCount,
      matchedParticipants: matchedCounts.matched,
      unmatchedBergman: matchedCounts.unmatchedLeft,
      unmatchedProvider: matchedCounts.unmatchedRight,
      bergmanSource: `event:${eventId}:participant:index`,
      feibotSource: `event:${eventId}:feibot:participant:index | event/live:event:${eventId}:providerParticipants | event/live:event:${eventId}:providerIndex | event/live:event:${eventId}:provider:participants`,
      bergmanUpdatedAt,
      feibotUpdatedAt,
      contests: countRows(contestIndex),
      splits: countRows(splitIndex),
      timingPoints: countRows(timingPointIndex),
      leaderboards: countRows(leaderboards),
    },
    validation,
    diagnostics,
    readinessChecks,
    testedAt: new Date().toISOString(),
  });
}
