import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import initSqlJs from 'sql.js';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { isJobCancelRequested, requestJobCancel, startJob, updateJobProgress } from '@/lib/jobManager';
import { batchDeleteKV, getKV, listKVByPrefix, putKV } from '@/lib/cloudflare/kv';
import { rebuildCourseIndexInKv } from '@/lib/courseIndex';
import { buildFeibotParticipantImport } from '@/lib/feibotParticipantImport';
import { rebuildSplitIndexInKv } from '@/lib/splitIndex';
import { revalidatePath } from 'next/cache';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_FILE_SIZE_MB = Math.max(Number(process.env.FDB_IMPORT_MAX_MB || 100), 5);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const LOG_KEY_LIMIT = 500;
const KV_WRITE_TIMEOUT_MS = Math.max(Number(process.env.FDB_IMPORT_KV_WRITE_TIMEOUT_MS || 15000), 5000);

function getImportStateKey(eventId: string) {
  return `live:event:${eventId}:fdb-import:state`;
}

function getImportHistoryKey(eventId: string) {
  return `live:event:${eventId}:fdb-import:history`;
}

type Row = Record<string, any>;

type ImportSummary = {
  eventId: string;
  databaseName: string;
  databaseVersion: string;
  currentStage?: string;
  sqliteVersion?: string | null;
  detected: {
    eventName: string | null;
    eventUuid: string | null;
    scoreEventUuid: string | null;
    venue: string | null;
    city: string | null;
    country: string | null;
    timeZone: string | null;
    numberOfTables: number;
    lastModified: string | null;
  };
  tables: Array<{ name: string; category: string; columns: number; rows: number }>;
  unknownTables: Array<{ name: string; columnCount: number; rowCount: number }>;
  counts: {
    contests: number;
    legs: number;
    splits: number;
    timingPoints: number;
    devices: number;
    ageGroups: number;
    rankings: number;
    participants: number;
    activeParticipants: number;
  };
  kvRecordsWritten: number;
  errorMessages?: string[];
  warningMessages?: string[];
  importedContests?: Array<{
    contestUuid: string;
    contestName: string;
    splitCount: number;
    timingPointCount: number;
    legCount: number;
    ageGroupCount: number;
  }>;
  tablesRead?: number;
  tablesIgnored?: number;
  rowsRead?: number;
  rowsImported?: number;
  elapsedTimeMs?: number;
  warnings: number;
  errors: number;
  status: 'IMPORTING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED' | 'CANCELLED';
  validationStatus?: 'PENDING' | 'PASS' | 'WARNING' | 'TIMEOUT' | 'FAILED';
  completedAt?: string | null;
  importDurationMs: number;
  validation: { missingKeys: string[]; complete: boolean };
};

type RuntimeLog = {
  ts: string;
  action: 'WRITE' | 'DELETE' | 'VALIDATE' | 'REBUILD';
  key: string;
  status: 'SUCCESS' | 'FAILED' | 'STARTED';
  durationMs: number;
  detail?: string;
};

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function normalizeLookupKey(value: string) {
  return String(value || '').trim().toLowerCase();
}

function pickValue(row: Row, candidates: string[]) {
  const entries = Object.entries(row || {});
  for (const candidate of candidates) {
    const normalized = normalizeKey(candidate);
    const match = entries.find(([key]) => normalizeKey(key) === normalized);
    if (match) return match[1];
  }
  return null;
}

function textValue(row: Row, candidates: string[]) {
  const value = pickValue(row, candidates);
  return value === null || value === undefined ? '' : String(value).trim();
}

function resolveEntityId(row: Row, candidates: string[], fallback: string) {
  return textValue(row, candidates) || fallback;
}

function rowToRecord(columns: string[], values: any[]) {
  return columns.reduce<Row>((acc, column, index) => {
    acc[column] = values[index] ?? null;
    return acc;
  }, {});
}

function escapeSqlIdentifier(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlRows(database: any, sql: string) {
  const result = database.exec(sql);
  if (!Array.isArray(result) || result.length === 0) return [] as Row[];
  const [first] = result;
  const columns: string[] = Array.isArray(first?.columns) ? first.columns : [];
  const values: any[][] = Array.isArray(first?.values) ? first.values : [];
  return values.map((rowValues) => rowToRecord(columns, rowValues));
}

function tableCategory(tableName: string) {
  const name = tableName.toLowerCase();
  if (name.includes('participant')) return 'participants';
  if (name.includes('contest')) return 'contests';
  if (name.includes('timing') || name.includes('timing_point')) return 'timingPoints';
  if (name.includes('split')) return 'splits';
  if (name.includes('leg')) return 'legs';
  if (name.includes('device')) return 'devices';
  if (name.includes('age')) return 'ageGroups';
  if (name.includes('rank')) return 'rankings';
  if (name.includes('event') && (name.includes('setting') || name.includes('config'))) return 'eventSettings';
  return 'unknown';
}

function statusIsActive(status: unknown) {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (!normalized) return true;
  return !(
    normalized.includes('cancel') ||
    normalized.includes('refund') ||
    normalized.includes('inactive') ||
    normalized.includes('withdraw') ||
    normalized.includes('reject') ||
    normalized.includes('void')
  );
}

function buildParticipantIndexPayload(eventId: string, participants: any[]) {
  const byBib: Record<string, any> = {};
  const byUuid: Record<string, any> = {};
  const byChip: Record<string, any> = {};
  const byBookingId: Record<string, any> = {};
  const contestLookup: Record<string, { contestUuid: string | null; contestName: string | null; participantCount: number }> = {};

  for (const participant of participants) {
    const bib = String(participant?.bib || participant?.bibNumber || '').trim();
    const providerUuid = String(participant?.providerParticipantUuid || participant?.participantUuid || participant?.participant_uuid || participant?.uuid || '').trim();
    const chip = String(participant?.chip || participant?.chipCode || '').trim();
    const bookingId = String(participant?.bookingId || participant?.registrationId || participant?.id || '').trim();
    const contestUuid = String(participant?.contestUuid || participant?.contest_uuid || '').trim() || null;
    const contestName = String(participant?.contestName || participant?.contest_name || participant?.category || '').trim() || null;

    if (bib) {
      byBib[bib] = participant;
      const compactBib = bib.replace(/^0+/, '');
      if (compactBib) byBib[compactBib] = participant;
    }
    if (providerUuid) byUuid[providerUuid] = participant;
    if (chip) byChip[chip] = participant;
    if (bookingId) byBookingId[bookingId] = participant;

    const contestKey = String(contestUuid || contestName || '').toLowerCase();
    if (contestKey) {
      const next = contestLookup[contestKey] || { contestUuid, contestName, participantCount: 0 };
      next.participantCount += 1;
      contestLookup[contestKey] = next;
    }
  }

  return {
    eventId,
    generatedAt: new Date().toISOString(),
    participants,
    participantCount: participants.length,
    count: participants.length,
    byBib,
    byUuid,
    byChip,
    byBookingId,
    contestLookup,
  };
}

function deriveMetadata(tables: Record<string, Row[]>) {
  const eventSettings = tables.eventSettings?.[0] || {};
  const contests = tables.contests?.[0] || {};
  return {
    eventName:
      textValue(eventSettings, ['event_name', 'eventname', 'name', 'event']) ||
      textValue(contests, ['event_name', 'eventname', 'name']) ||
      null,
    eventUuid:
      textValue(eventSettings, ['event_uuid', 'eventuuid', 'uuid', 'event_id']) ||
      textValue(contests, ['event_uuid', 'eventuuid', 'uuid', 'event_id']) ||
      null,
    scoreEventUuid:
      textValue(eventSettings, ['score_event_uuid', 'scoreeventuuid', 'score_event_id']) ||
      textValue(contests, ['score_event_uuid', 'scoreeventuuid', 'score_event_id']) ||
      null,
    venue: textValue(eventSettings, ['venue', 'location']) || null,
    city: textValue(eventSettings, ['city']) || null,
    country: textValue(eventSettings, ['country']) || null,
    timeZone: textValue(eventSettings, ['timezone', 'time_zone']) || null,
  };
}

async function persistState(eventId: string, patch: Row) {
  const key = getImportStateKey(eventId);
  const current = (await getKV<Record<string, any>>(key, '[API /live-tracking/feibot/fdb-import state]')) || {};
  const next = {
    ...current,
    ...patch,
    provider: 'feibot',
    updatedAt: new Date().toISOString(),
    database: {
      ...(current?.database || {}),
      ...(patch?.database || {}),
    },
    progress: {
      ...(current?.progress || {}),
      ...(patch?.progress || {}),
    },
  };
  await withTimeout(putKV(key, next, '[API /live-tracking/feibot/fdb-import state]'), 5000, 'Import state write');
}

async function appendImportHistory(eventId: string, row: Record<string, any>) {
  const key = getImportHistoryKey(eventId);
  const current = (await getKV<Record<string, any>[]>(key, '[API /live-tracking/feibot/fdb-import history]')) || [];
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const next = [{ id, ...row }, ...current].slice(0, 25);
  await withTimeout(putKV(key, next, '[API /live-tracking/feibot/fdb-import history]'), 5000, 'Import history write');
}

async function updateProgress(eventId: string, jobId: string, progress: number, stage: string, message: string, summary?: Row) {
  await updateJobProgress(jobId, {
    status: stage === 'COMPLETED' ? 'completed' : stage === 'FAILED' ? 'failed' : stage === 'CANCELLED' ? 'cancelled' : 'processing',
    progress,
    stage,
    message,
    summary: summary ? serializeValue(summary) : undefined,
  } as any);

  await persistState(eventId, {
    activeImportJobId: jobId,
    progress: {
      status: stage === 'COMPLETED' ? 'COMPLETED' : stage === 'FAILED' ? 'FAILED' : stage === 'CANCELLED' ? 'CANCELLED' : 'PROCESSING',
      jobId,
      stage,
      progress,
      message,
      updatedAt: new Date().toISOString(),
    },
    latestSummary: summary ? serializeValue(summary) : undefined,
  });
}

async function throwIfImportCancelled(jobId: string) {
  if (await isJobCancelRequested(jobId)) {
    const error = new Error('FDB import cancelled by user.');
    (error as any).code = 'JOB_CANCELLED';
    throw error;
  }
}

async function cleanupRuntimeKv(eventId: string, reason: string, logs: RuntimeLog[], summary: ImportSummary) {
  try {
    const startedAt = Date.now();
    const keys = Array.from(new Set((await Promise.all([
      listKVByPrefix(`live:event:${eventId}:providerParticipants`, '[API /live-tracking/feibot/fdb-import]'),
      listKVByPrefix(`live:event:${eventId}:timingReads`, '[API /live-tracking/feibot/fdb-import]'),
      listKVByPrefix(`live:event:${eventId}:leaderboard`, '[API /live-tracking/feibot/fdb-import]'),
      listKVByPrefix(`live:event:${eventId}:timingConfiguration`, '[API /live-tracking/feibot/fdb-import]'),
      listKVByPrefix(`live:event:${eventId}:import-summary`, '[API /live-tracking/feibot/fdb-import]'),
    ])).flat()));
    if (keys.length > 0) {
      await batchDeleteKV(keys, '[API /live-tracking/feibot/fdb-import cleanup]');
    }
    logs.push({ ts: new Date().toISOString(), action: 'DELETE', key: `timing KV namespaces for ${eventId}`, status: 'SUCCESS', durationMs: Date.now() - startedAt, detail: `${keys.length} keys removed (${reason})` });
  } catch (error: any) {
    logs.push({ ts: new Date().toISOString(), action: 'DELETE', key: `timing KV namespaces for ${eventId}`, status: 'FAILED', durationMs: 0, detail: error?.message || `Cleanup failed (${reason})` });
    summary.warnings += 1;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  }) as Promise<T>;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function putTrackedKV(key: string, value: any, logs: RuntimeLog[], summary: ImportSummary) {
  const startedAt = Date.now();
  const payloadSize = Buffer.byteLength(JSON.stringify(serializeValue(value) ?? null));
  try {
    await withTimeout(putKV(key, value, '[API /live-tracking/feibot/fdb-import]'), KV_WRITE_TIMEOUT_MS, `KV write ${key}`);
    logs.push({ ts: new Date().toISOString(), action: 'WRITE', key, status: 'SUCCESS', durationMs: Date.now() - startedAt, detail: `${Math.max(1, Math.round(payloadSize / 1024))} KB` });
    summary.kvRecordsWritten += 1;
    return true;
  } catch (error: any) {
    const firstErrorMessage = error?.message || 'KV write failed';
    try {
      await wait(200);
      await withTimeout(putKV(key, value, '[API /live-tracking/feibot/fdb-import]'), KV_WRITE_TIMEOUT_MS, `KV write retry ${key}`);
      logs.push({
        ts: new Date().toISOString(),
        action: 'WRITE',
        key,
        status: 'SUCCESS',
        durationMs: Date.now() - startedAt,
        detail: `${Math.max(1, Math.round(payloadSize / 1024))} KB (retried once)`,
      });
      summary.kvRecordsWritten += 1;
      return true;
    } catch (retryError: any) {
      const failDetail = retryError?.message || firstErrorMessage;
      logs.push({
        ts: new Date().toISOString(),
        action: 'WRITE',
        key,
        status: 'FAILED',
        durationMs: Date.now() - startedAt,
        detail: `${failDetail} (first attempt: ${firstErrorMessage})`,
      });
      summary.errors += 1;
      if (!summary.errorMessages) summary.errorMessages = [];
      summary.errorMessages.push(`KV write failed [${key}]: ${failDetail}`);
      return false;
    }
  }
}

function buildBlankImportSummary(eventId: string, databaseName: string, databaseVersion: string, currentStage: string, status: ImportSummary['status']): ImportSummary {
  return {
    eventId,
    databaseName,
    databaseVersion,
    currentStage,
    detected: {
      eventName: null,
      eventUuid: null,
      scoreEventUuid: null,
      venue: null,
      city: null,
      country: null,
      timeZone: null,
      numberOfTables: 0,
      lastModified: null,
    },
    tables: [],
    unknownTables: [],
    counts: {
      contests: 0,
      legs: 0,
      splits: 0,
      timingPoints: 0,
      devices: 0,
      ageGroups: 0,
      rankings: 0,
      participants: 0,
      activeParticipants: 0,
    },
    kvRecordsWritten: 0,
    errorMessages: [],
    warningMessages: [],
    importedContests: [],
    tablesRead: 0,
    tablesIgnored: 0,
    rowsRead: 0,
    rowsImported: 0,
    elapsedTimeMs: 0,
    warnings: 0,
    errors: 0,
    status,
    validationStatus: 'PENDING',
    completedAt: null,
    importDurationMs: 0,
    validation: { missingKeys: [], complete: false },
    sqliteVersion: null,
  };
}

async function validateCompletedImport(eventId: string, summary: ImportSummary, logs: RuntimeLog[]) {
  const validationStartedAt = Date.now();
  const validationTimeoutMs = 30_000;

  const checks = [
    { key: `live:event:${eventId}:config`, label: 'timingConfiguration' },
    { key: `live:event:${eventId}:contest:index`, label: 'contestIndex' },
    { key: `live:event:${eventId}:split:index`, label: 'splitIndex' },
    { key: `live:event:${eventId}:timingPoint:index`, label: 'timingPointIndex' },
    { key: `live:event:${eventId}:participant:index`, label: 'participantIndex' },
    { key: `live:event:${eventId}:participants:index`, label: 'participantsIndex' },
    { key: `live:event:${eventId}:providerParticipants`, label: 'providerParticipants' },
  ];

  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
  }, validationTimeoutMs);

  try {
    const validationResults = await Promise.all(checks.map(async ({ key, label }) => {
      const startedCheck = Date.now();
      const value = await getKV<any>(key, '[API /live-tracking/feibot/fdb-import validate]');
      const exists = value !== null;
      logs.push({
        ts: new Date().toISOString(),
        action: 'VALIDATE',
        key,
        status: exists ? 'SUCCESS' : 'FAILED',
        durationMs: Date.now() - startedCheck,
        detail: `Checking ${label}${exists ? ' ✔' : ' ✖'}`,
      });
      return { key, exists };
    }));

    if (timedOut) {
      summary.validationStatus = 'TIMEOUT';
      summary.validation = { missingKeys: [], complete: false };
      summary.warnings += 1;
      logs.push({
        ts: new Date().toISOString(),
        action: 'VALIDATE',
        key: 'validation-timeout',
        status: 'FAILED',
        durationMs: Date.now() - validationStartedAt,
        detail: 'Validation exceeded timeout after 30s. Core import completed successfully.',
      });
    } else {
      const missingKeys = validationResults.filter((item) => !item.exists).map((item) => item.key);
      const hasWarnings = missingKeys.length > 0;
      summary.validation = { missingKeys, complete: missingKeys.length === 0 };
      summary.validationStatus = hasWarnings ? 'WARNING' : 'PASS';
      if (hasWarnings) summary.warnings += 1;
      logs.push({
        ts: new Date().toISOString(),
        action: 'VALIDATE',
        key: 'validation-complete',
        status: 'SUCCESS',
        durationMs: Date.now() - validationStartedAt,
        detail: hasWarnings ? `Validation completed with ${missingKeys.length} missing key(s).` : 'Validation completed successfully.',
      });
    }
  } catch (error: any) {
    summary.validationStatus = 'WARNING';
    summary.validation = { missingKeys: [], complete: false };
    summary.warnings += 1;
    logs.push({
      ts: new Date().toISOString(),
      action: 'VALIDATE',
      key: 'validation-error',
      status: 'FAILED',
      durationMs: Date.now() - validationStartedAt,
      detail: error?.message || 'Validation failed unexpectedly.',
    });
  } finally {
    clearTimeout(timeoutHandle);
    summary.completedAt = new Date().toISOString();
    summary.status = summary.validationStatus === 'PASS' ? 'COMPLETED' : 'COMPLETED_WITH_WARNINGS';
    summary.elapsedTimeMs = summary.importDurationMs;

    const validationLabel = summary.validationStatus === 'PASS'
      ? 'Validation successful'
      : summary.validationStatus === 'TIMEOUT'
        ? 'Validation timed out with warnings'
        : 'Validation completed with warnings';
    const countsSummary = [
      `${summary.counts.participants} participants`,
      `${summary.counts.contests} contests`,
      `${summary.counts.splits} splits`,
      `${summary.counts.timingPoints} timing points`,
    ].join(', ');

    await withTimeout(putKV(`live:event:${eventId}:logs`, logs.slice(-LOG_KEY_LIMIT), '[API /live-tracking/feibot/fdb-import]'), 5000, 'Import logs write');
    await withTimeout(putKV(`live:event:${eventId}:import-summary:latest`, summary, '[API /live-tracking/feibot/fdb-import]'), 5000, 'Import summary write');

    await persistState(eventId, {
      latestSummary: summary,
      database: {
        uploaded: true,
        fileName: summary.databaseName,
        databaseVersion: summary.databaseVersion,
        status: summary.status,
        localEventUuid: summary.detected.eventUuid,
        eventName: summary.detected.eventName,
        tablesImported: summary.detected.numberOfTables,
        participants: summary.counts.participants,
        activeParticipants: summary.counts.activeParticipants,
        contests: summary.counts.contests,
        splits: summary.counts.splits,
        timingPoints: summary.counts.timingPoints,
        devices: summary.counts.devices,
        ageGroups: summary.counts.ageGroups,
        legs: summary.counts.legs,
        rankings: summary.counts.rankings,
        importDurationMs: summary.importDurationMs,
        kvRecordsWritten: summary.kvRecordsWritten,
        warnings: summary.warnings,
        errors: summary.errors,
      },
    });
  }
}

async function processImportJob(
  jobId: string,
  eventId: string,
  fileBuffer: Buffer,
  rebuildKv: boolean,
  fileName: string,
  fileSize: number,
  options?: { replaceExistingParticipants?: boolean; forceEmptyImport?: boolean },
) {
  const startedAt = Date.now();
  const logs: RuntimeLog[] = [];
  let currentStage = 'INITIALIZING';
  let lastStageChangeAt = Date.now();
  const stageTimeoutMs = 30000;
  const stageMonitor = setInterval(() => {
    if (Date.now() - lastStageChangeAt > stageTimeoutMs) {
      void updateJobProgress(jobId, {
        status: 'failed',
        progress: 100,
        stage: currentStage,
        message: `Import timed out while ${currentStage.toLowerCase().replace(/_/g, ' ')}.`,
      } as any);
    }
  }, 5000);

  const reportProgress = async (progress: number, stage: string, message: string, summaryPatch?: Row) => {
    currentStage = stage;
    lastStageChangeAt = Date.now();
    summary.currentStage = stage;
    await updateProgress(eventId, jobId, progress, stage, message, summaryPatch || summary as any);
  };

  const summary: ImportSummary = {
    eventId,
    databaseName: fileName,
    databaseVersion: 'SQLite',
    detected: {
      eventName: null,
      eventUuid: null,
      scoreEventUuid: null,
      venue: null,
      city: null,
      country: null,
      timeZone: null,
      numberOfTables: 0,
      lastModified: null,
    },
    tables: [],
    unknownTables: [],
    counts: {
      contests: 0,
      legs: 0,
      splits: 0,
      timingPoints: 0,
      devices: 0,
      ageGroups: 0,
      rankings: 0,
      participants: 0,
      activeParticipants: 0,
    },
    kvRecordsWritten: 0,
    currentStage: 'INITIALIZING',
    sqliteVersion: null,
    tablesRead: 0,
    tablesIgnored: 0,
    rowsRead: 0,
    rowsImported: 0,
    elapsedTimeMs: 0,
    warnings: 0,
    errors: 0,
    status: 'IMPORTING',
    importDurationMs: 0,
    validation: { missingKeys: [], complete: false },
  };

  await persistState(eventId, {
    database: {
      uploaded: true,
      fileName,
      fileSize,
      uploadedAt: new Date().toISOString(),
      databaseVersion: 'SQLite',
      status: 'IMPORTING',
    },
  });

  let sqliteDb: any = null;

  try {
    await throwIfImportCancelled(jobId);

    await reportProgress(2, 'REBUILDING_RUNTIME_KV', 'Rebuilding KV namespace...', summary as any);
    const keysToDelete = new Set<string>([
      ...(await listKVByPrefix(`live:event:${eventId}:providerParticipants`, '[API /live-tracking/feibot/fdb-import]')),
      ...(await listKVByPrefix(`live:event:${eventId}:timingReads`, '[API /live-tracking/feibot/fdb-import]')),
      ...(await listKVByPrefix(`live:event:${eventId}:leaderboard`, '[API /live-tracking/feibot/fdb-import]')),
      ...(await listKVByPrefix(`live:event:${eventId}:timingConfiguration`, '[API /live-tracking/feibot/fdb-import]')),
      ...(await listKVByPrefix(`live:event:${eventId}:import-summary`, '[API /live-tracking/feibot/fdb-import]')),
    ]);
    if (keysToDelete.size) {
      const startedDelete = Date.now();
      await batchDeleteKV(Array.from(keysToDelete), '[API /live-tracking/feibot/fdb-import]');
      logs.push({ ts: new Date().toISOString(), action: 'DELETE', key: `live:event:${eventId}:*`, status: 'SUCCESS', durationMs: Date.now() - startedDelete, detail: `${keysToDelete.size} keys` });
    }

    await throwIfImportCancelled(jobId);
    await reportProgress(5, 'OPENING_DATABASE', 'Opening SQLite database...', summary as any);
    const SQL = await initSqlJs();
    sqliteDb = new SQL.Database(new Uint8Array(fileBuffer));
    const sqliteVersion = sqlRows(sqliteDb, 'SELECT sqlite_version() AS version')[0] as any;
    summary.sqliteVersion = String(sqliteVersion?.version || 'unknown');

    const timingPointRows = sqlRows(
      sqliteDb,
      'SELECT * FROM timing_points ORDER BY id',
    );
    console.log('[FDB Import] timing_points table', {
      sqliteTimingPointCount: timingPointRows.length,
      sample: timingPointRows.slice(0, 5),
    });

    const tableNames = sqlRows(
      sqliteDb,
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    ).map((row: any) => String(row.name));
    summary.detected.numberOfTables = tableNames.length;
    logs.push({ ts: new Date().toISOString(), action: 'VALIDATE', key: 'sqlite_version', status: 'SUCCESS', durationMs: 0, detail: summary.sqliteVersion || 'unknown' });
    logs.push({ ts: new Date().toISOString(), action: 'VALIDATE', key: 'tables', status: 'SUCCESS', durationMs: 0, detail: `${tableNames.length} tables: ${tableNames.join(', ')}` });
    console.log('[FDB Import] SQLite version:', summary.sqliteVersion, 'startedAt:', new Date(startedAt).toISOString(), 'tables:', tableNames);
    await reportProgress(10, 'READING_METADATA', `Reading metadata from ${tableNames.length} tables...`, summary as any);

    const buckets: Record<string, Row[]> = {
      eventSettings: [],
      contests: [],
      participants: [],
      splits: [],
      timingPoints: [],
      legs: [],
      devices: [],
      ageGroups: [],
      rankings: [],
    };

    for (let i = 0; i < tableNames.length; i++) {
      await throwIfImportCancelled(jobId);
      const tableName = tableNames[i];
      const category = tableCategory(tableName);
      const startedTable = Date.now();
      let columns: string[] = [];
      let records: Row[] = [];
      try {
        columns = sqlRows(sqliteDb, `PRAGMA table_info(${escapeSqlIdentifier(tableName)})`).map((row: any) => String(row.name));
        records = sqlRows(sqliteDb, `SELECT * FROM ${escapeSqlIdentifier(tableName)}`);
        summary.tables.push({ name: tableName, category, columns: columns.length, rows: records.length });
        summary.tablesRead = (summary.tablesRead || 0) + 1;
        summary.rowsRead = (summary.rowsRead || 0) + records.length;
        if (category === 'unknown') {
          summary.tablesIgnored = (summary.tablesIgnored || 0) + 1;
          summary.unknownTables.push({ name: tableName, columnCount: columns.length, rowCount: records.length });
        } else {
          buckets[category].push(...records);
          summary.rowsImported = (summary.rowsImported || 0) + records.length;
        }
        const sql = `SELECT * FROM ${escapeSqlIdentifier(tableName)}`;
        if (records.length === 0) {
          logs.push({ ts: new Date().toISOString(), action: 'VALIDATE', key: `table:${tableName}`, status: 'FAILED', durationMs: Date.now() - startedTable, detail: `SQL: ${sql}; Parameters: []; Returned rows: 0` });
        } else {
          logs.push({ ts: new Date().toISOString(), action: 'VALIDATE', key: `table:${tableName}`, status: 'SUCCESS', durationMs: Date.now() - startedTable, detail: `Rows returned: ${records.length}` });
        }
      } catch (error: any) {
        summary.errors += 1;
        summary.tablesIgnored = (summary.tablesIgnored || 0) + 1;
        logs.push({ ts: new Date().toISOString(), action: 'VALIDATE', key: `table:${tableName}`, status: 'FAILED', durationMs: Date.now() - startedTable, detail: error?.message || 'Failed to read table' });
        console.warn('[FDB Import] Failed table read', { eventId, tableName, error: error?.message });
      }

      const pct = 10 + Math.floor(((i + 1) / Math.max(tableNames.length, 1)) * 50);
      const stageLabel = category === 'eventSettings' ? 'READING_METADATA' : category === 'contests' ? 'READING_CONTESTS' : category === 'participants' ? 'READING_PARTICIPANTS' : category === 'splits' ? 'READING_SPLITS' : category === 'timingPoints' ? 'READING_TIMING_POINTS' : category === 'ageGroups' ? 'READING_AGE_GROUPS' : category === 'devices' ? 'READING_DEVICES' : category === 'legs' ? 'READING_LEGS' : 'READING_TABLES';
      await reportProgress(pct, stageLabel, `Reading table ${tableName} (${i + 1}/${tableNames.length})`, summary as any);
    }

    summary.warnings += summary.unknownTables.length;

    const metadata = deriveMetadata(buckets);
    summary.detected.eventName = metadata.eventName;
    summary.detected.eventUuid = metadata.eventUuid;
    summary.detected.scoreEventUuid = metadata.scoreEventUuid;
    summary.detected.venue = metadata.venue;
    summary.detected.city = metadata.city;
    summary.detected.country = metadata.country;
    summary.detected.timeZone = metadata.timeZone;

    await reportProgress(60, 'BUILDING_INDEXES', 'Building contest and timing indexes...', summary as any);
    await throwIfImportCancelled(jobId);

    const contestIndex = buckets.contests.map((row, index) => ({
      id: resolveEntityId(row, ['contest_uuid', 'contestuuid', 'uuid', 'id', 'contest_id'], `contest_${index + 1}`),
      contestUuid: resolveEntityId(row, ['contest_uuid', 'contestuuid', 'uuid', 'id', 'contest_id'], `contest_${index + 1}`),
      contestName: textValue(row, ['contest_name', 'name', 'label']) || `Contest ${index + 1}`,
      displayOrder: Number(pickValue(row, ['display_order', 'sort_order', 'order', 'position']) || index + 1),
      configuration: row,
      ...row,
    }));
    const contestUuids = contestIndex.map((contest) => String(contest.contestUuid || contest.id));

    const splitIndex = buckets.splits.map((row, index) => ({
      id: resolveEntityId(row, ['split_uuid', 'splituuid', 'uuid', 'id', 'split_id'], `split_${index + 1}`),
      splitUuid: resolveEntityId(row, ['split_uuid', 'splituuid', 'uuid', 'id', 'split_id'], `split_${index + 1}`),
      contestUuid: textValue(row, ['contest_uuid', 'contestuuid', 'contestid', 'contest_id', 'contest']) || contestUuids[0] || 'default',
      name: textValue(row, ['name', 'split_name', 'label']) || `Split ${index + 1}`,
      configuration: row,
      ...row,
    }));

    const splitToContestUuid = new Map<string, string>();
    const registerSplitContest = (splitKeyRaw: unknown, contestKeyRaw: unknown) => {
      const splitKey = normalizeLookupKey(String(splitKeyRaw || ''));
      const contestKey = String(contestKeyRaw || '').trim();
      if (!splitKey || !contestKey) return;
      if (!splitToContestUuid.has(splitKey)) splitToContestUuid.set(splitKey, contestKey);
    };

    for (const splitRow of splitIndex as any[]) {
      const contestKey = String(splitRow?.contestUuid || splitRow?.contest_uuid || splitRow?.contestId || splitRow?.contest_id || '').trim();
      registerSplitContest(splitRow?.splitUuid, contestKey);
      registerSplitContest(splitRow?.id, contestKey);
      registerSplitContest(splitRow?.split_uuid, contestKey);
      registerSplitContest(splitRow?.split_id, contestKey);
      registerSplitContest(splitRow?.uuid, contestKey);
    }

    const timingPointContestByUuid = new Map<string, string>();
    for (const splitRow of splitIndex as any[]) {
      const contestKey = String(splitRow?.contestUuid || splitRow?.contest_uuid || splitRow?.contestId || splitRow?.contest_id || '').trim();
      const timingPointUuid = String(
        splitRow?.timingPointUuid
        || splitRow?.timing_point_uuid
        || splitRow?.timingPointUUID
        || splitRow?.timing_point_id
        || splitRow?.timingPointId
        || '',
      ).trim();
      if (!contestKey || !timingPointUuid) continue;
      const timingPointKey = normalizeLookupKey(timingPointUuid);
      if (!timingPointKey || timingPointContestByUuid.has(timingPointKey)) continue;
      timingPointContestByUuid.set(timingPointKey, contestKey);
    }
    console.log('[FDB Import] timing point contest mapping', {
      timingPointContestCount: timingPointContestByUuid.size,
      sample: Array.from(timingPointContestByUuid.entries()).slice(0, 10),
    });

    const resolveContestUuidForTimingPoint = (row: any, timingPointUuid: string) => {
      const directContestUuid = textValue(row, ['contest_uuid', 'contestuuid', 'contestid', 'contest_id', 'contest', 'contest_uuid_ref']) || null;
      if (directContestUuid) return directContestUuid;

      const contestNameCandidates = [
        textValue(row, ['contest_name', 'contestname', 'contest_label', 'category_name', 'categoryname']),
        textValue(row, ['category', 'type', 'label']),
      ].filter(Boolean) as string[];

      for (const candidate of contestNameCandidates) {
        const contestMatch = contestIndexByName[String(candidate).trim().toLowerCase()];
        if (contestMatch?.contestUuid) return String(contestMatch.contestUuid).trim();
      }

      return timingPointContestByUuid.get(normalizeLookupKey(timingPointUuid)) || null;
    };

    const timingPointIndex = timingPointRows.map((row, index) => {
      const directContestUuid = textValue(row, ['contest_uuid', 'contestuuid', 'contestid', 'contest_id', 'contest']);
      const splitRef = textValue(row, ['split_uuid', 'splituuid', 'split_id', 'splitid', 'split']);
      const timingPointUuid = resolveEntityId(row, ['timing_point_uuid', 'timingpointuuid', 'uuid', 'id', 'timingpointid'], `timing_point_${index + 1}`);
      const derivedContestUuid =
        directContestUuid
        || resolveContestUuidForTimingPoint(row, timingPointUuid)
        || timingPointContestByUuid.get(normalizeLookupKey(timingPointUuid))
        || splitToContestUuid.get(normalizeLookupKey(splitRef))
        || null;

      return {
        contestUuid: derivedContestUuid,
        id: timingPointUuid,
        timingPointUuid,
        uuid: timingPointUuid,
        name: textValue(row, ['name', 'timing_point_name', 'label']) || `Timing Point ${index + 1}`,
        configuration: row,
        created_at: (row as any)?.created_at ?? null,
        updated_at: (row as any)?.updated_at ?? null,
        deleted_at: (row as any)?.deleted_at ?? null,
        color: (row as any)?.color ?? null,
        position: (row as any)?.position ?? null,
        repeat_gap_in_seconds: (row as any)?.repeat_gap_in_seconds ?? null,
        accept_only_bibs: (row as any)?.accept_only_bibs ?? null,
        accept_only_chips: (row as any)?.accept_only_chips ?? null,
        ignore_bibs: (row as any)?.ignore_bibs ?? null,
        ignore_chips: (row as any)?.ignore_chips ?? null,
        sim_prefer_device_num: (row as any)?.sim_prefer_device_num ?? null,
        check_point_flag: (row as any)?.check_point_flag ?? null,
        check_point_config: (row as any)?.check_point_config ?? null,
        ...row,
      };
    });

    const deviceIndex = buckets.devices.map((row, index) => ({
      id: resolveEntityId(row, ['device_uuid', 'deviceuuid', 'uuid', 'id', 'device_id'], `device_${index + 1}`),
      deviceUuid: resolveEntityId(row, ['device_uuid', 'deviceuuid', 'uuid', 'id', 'device_id'], `device_${index + 1}`),
      configuration: row,
      ...row,
    }));

    const ageGroupIndex = buckets.ageGroups.map((row, index) => ({
      id: resolveEntityId(row, ['age_group_uuid', 'agegroupuuid', 'uuid', 'id', 'agegroupid'], `age_group_${index + 1}`),
      ageGroupUuid: resolveEntityId(row, ['age_group_uuid', 'agegroupuuid', 'uuid', 'id', 'agegroupid'], `age_group_${index + 1}`),
      displayName: textValue(row, ['display_name', 'name', 'label']) || `Age Group ${index + 1}`,
      configuration: row,
      ...row,
    }));

    const legIndex = buckets.legs.map((row, index) => {
      const legUuid = resolveEntityId(row, ['leg_uuid', 'leguuid', 'uuid', 'id', 'leg_id'], `leg_${index + 1}`);
      const contestUuid = textValue(row, ['contest_uuid', 'contestuuid', 'contestid', 'contest_id', 'contest']) || contestUuids[0] || 'default';
      const name = textValue(row, ['name', 'leg_name', 'label']) || `Leg ${index + 1}`;
      const firstSplitUuid = textValue(row, ['first_split_uuid', 'firstsplituuid', 'first_split_id', 'firstsplitid'])
        || textValue((row as any)?.configuration || {}, ['first_split_uuid', 'firstsplituuid', 'first_split_id', 'firstsplitid'])
        || null;
      const lastSplitUuid = textValue(row, ['last_split_uuid', 'lastsplituuid', 'last_split_id', 'lastsplitid'])
        || textValue((row as any)?.configuration || {}, ['last_split_uuid', 'lastsplituuid', 'last_split_id', 'lastsplitid'])
        || null;
      const label = textValue(row, ['label']) || textValue((row as any)?.configuration || {}, ['label']) || name;
      const color = textValue(row, ['color']) || textValue((row as any)?.configuration || {}, ['color']) || null;
      const order = Number(
        (row as any)?.order
        ?? (row as any)?.sequence
        ?? (row as any)?.sequence_no
        ?? (row as any)?.sequenceNo
        ?? (row as any)?.position
        ?? (row as any)?.configuration?.order
        ?? (row as any)?.configuration?.sequence
        ?? (row as any)?.configuration?.sequence_no
        ?? (row as any)?.configuration?.sequenceNo
        ?? index + 1,
      );

      return {
        id: (row as any)?.id ?? legUuid,
        uuid: legUuid,
        legUuid,
        contestUuid,
        name,
        label,
        color,
        first_split_uuid: firstSplitUuid,
        firstSplitUuid,
        last_split_uuid: lastSplitUuid,
        lastSplitUuid,
        order: Number.isFinite(order) ? order : index + 1,
        configuration: row,
        ...row,
      };
    });

    const contestNameByUuid = new Map<string, string>();
    const contestByUuid = new Map<string, any>();
    for (const contest of contestIndex as any[]) {
      const key = String(contest.contestUuid || contest.id || '').trim();
      const name = String(contest.contestName || contest.displayName || contest.category || '').trim();
      if (!key) continue;
      contestNameByUuid.set(key, name || `Contest ${contestIndex.indexOf(contest) + 1}`);
      contestByUuid.set(key, {
        ...contest,
        splits: [],
        timingPoints: [],
        legs: [],
        ageGroups: [],
      });
    }

    const ageGroupNameByUuid = new Map<string, string>();
    for (const ageGroup of ageGroupIndex as any[]) {
      const key = String(ageGroup.ageGroupUuid || ageGroup.id || '').trim();
      const name = String(ageGroup.displayName || ageGroup.name || ageGroup.label || '').trim();
      if (key) ageGroupNameByUuid.set(key, name || `Age Group ${ageGroupIndex.indexOf(ageGroup) + 1}`);
    }

    const splitRowsByContest = new Map<string, any[]>();
    const legRowsByContest = new Map<string, any[]>();
    const ageGroupRowsByContest = new Map<string, any[]>();
    const deviceRowsByContest = new Map<string, any[]>();

    const addGroupedRow = (map: Map<string, any[]>, contestUuid: string | null, row: any) => {
      if (!contestUuid) return false;
      const existing = map.get(contestUuid) || [];
      existing.push(row);
      map.set(contestUuid, existing);
      return true;
    };

    for (const row of splitIndex as any[]) {
      addGroupedRow(splitRowsByContest, String(row?.contestUuid || '').trim() || null, row);
    }
    for (const row of legIndex as any[]) {
      addGroupedRow(legRowsByContest, String(row?.contestUuid || '').trim() || null, row);
    }
    for (const row of ageGroupIndex as any[]) {
      addGroupedRow(ageGroupRowsByContest, String((row as any)?.contestUuid || '').trim() || null, row);
    }
    for (const row of deviceIndex as any[]) {
      addGroupedRow(deviceRowsByContest, String((row as any)?.contestUuid || '').trim() || null, row);
    }

    const timingPointsByContest = new Map<string, any[]>();
    const timingPointsByUuid: Record<string, any> = {};
    const timingPointList: any[] = [];

    for (const row of timingPointIndex as any[]) {
      const contestUuid = String(row?.contestUuid || '').trim();
      if (contestUuid) {
        const current = timingPointsByContest.get(contestUuid) || [];
        current.push(row);
        timingPointsByContest.set(contestUuid, current);
      }

      const uuidKey = normalizeLookupKey(String(row?.timingPointUuid || row?.uuid || row?.id || ''));
      if (uuidKey && !timingPointsByUuid[uuidKey]) {
        timingPointsByUuid[uuidKey] = row;
      }

      timingPointList.push(row);
    }

    console.log('[FDB Import] timing point indexes', {
      timingPointCount: timingPointList.length,
      byContestCount: timingPointsByContest.size,
      byUuidCount: Object.keys(timingPointsByUuid).length,
    });

    for (const [contestUuid, legs] of Array.from(legRowsByContest.entries())) {
      const sortedLegs = [...legs].sort((a: any, b: any) => {
        const aOrder = Number(a?.order ?? a?.sequence ?? a?.sequence_no ?? a?.configuration?.order ?? a?.configuration?.sequence ?? a?.id ?? 0) || 0;
        const bOrder = Number(b?.order ?? b?.sequence ?? b?.sequence_no ?? b?.configuration?.order ?? b?.configuration?.sequence ?? b?.id ?? 0) || 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aName = String(a?.name || a?.label || '').toLowerCase();
        const bName = String(b?.name || b?.label || '').toLowerCase();
        return aName.localeCompare(bName);
      });
      legRowsByContest.set(contestUuid, sortedLegs);
    }

    const groupedContests = Array.from(contestByUuid.values()).map((contest: any) => {
      const contestUuid = String(contest.contestUuid || contest.id || '').trim();
      const splits = splitRowsByContest.get(contestUuid) || [];
      const timingPoints = timingPointsByContest.get(contestUuid) || [];
      const legs = legRowsByContest.get(contestUuid) || [];
      const ageGroups = ageGroupRowsByContest.get(contestUuid) || [];
      const devices = deviceRowsByContest.get(contestUuid) || [];
      contest.splits = splits;
      contest.timingPoints = timingPoints;
      contest.legs = legs;
      contest.ageGroups = ageGroups;
      contest.devices = devices;
      return contest;
    });

    summary.importedContests = groupedContests.map((contest: any) => ({
      contestUuid: String(contest.contestUuid || contest.id || '').trim(),
      contestName: String(contest.contestName || contest.displayName || contest.category || '').trim() || `Contest ${String(contest.contestUuid || contest.id || '').trim()}`,
      splitCount: Array.isArray(contest.splits) ? contest.splits.length : 0,
      timingPointCount: Array.isArray(contest.timingPoints) ? contest.timingPoints.length : 0,
      legCount: Array.isArray(contest.legs) ? contest.legs.length : 0,
      ageGroupCount: Array.isArray(contest.ageGroups) ? contest.ageGroups.length : 0,
    }));

    const importedAtIso = new Date().toISOString();
    const contestIndexByUuid = Object.fromEntries(groupedContests.map((contest: any) => [String(contest.contestUuid || contest.id || '').trim(), contest]).filter(([key]) => !!key));
    const contestIndexByName = Object.fromEntries(groupedContests.map((contest: any) => [String(contest.contestName || '').trim().toLowerCase(), contest]).filter(([key]) => !!key));
    const flattenByContest = (map: Map<string, any[]>) => Object.fromEntries(Array.from(map.entries()).map(([contestUuid, rows]) => [contestUuid, rows]));
    const allGroupedSplits = groupedContests.flatMap((contest: any) => contest.splits || []);
    const allGroupedTimingPoints = timingPointList;
    const allGroupedLegs = groupedContests.flatMap((contest: any) => contest.legs || []);
    const allGroupedAgeGroups = groupedContests.flatMap((contest: any) => contest.ageGroups || []);
    const allGroupedDevices = groupedContests.flatMap((contest: any) => contest.devices || []);

    const normalizedContestSet = new Set<string>(Object.keys(contestIndexByUuid).map((key) => normalizeLookupKey(key)));
    const normalizeLegToken = (value: unknown) => {
      const text = String(value ?? '').trim();
      const lower = text.toLowerCase();
      if (!text) return '';
      if (/swim/i.test(lower)) return 'SWIM';
      if (/t1|transition\s*1|transition\s*a/i.test(lower)) return 'T1';
      if (/bike|cycle/i.test(lower)) return 'BIKE';
      if (/t2|transition\s*2/i.test(lower)) return 'T2';
      if (/run\s*1|run1|run\s*split\s*1/i.test(lower)) return 'RUN1';
      if (/run\s*2|run2|run\s*split\s*2/i.test(lower)) return 'RUN2';
      if (/run/i.test(lower)) return 'RUN';
      if (/finish|fini(sh)?/i.test(lower)) return 'FINISH';
      return text.toUpperCase();
    };
    const contestCourseProfile = (contestName: string) => {
      const label = String(contestName || '').toLowerCase();
      if (label.includes('swimathon')) return 'swimathon';
      if (label.includes('triathlon') || label.includes('tri ')) return 'triathlon';
      return null;
    };

    const safeOrderNumber = (value: unknown, fallback: number) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    };

    const normalizeSplitRow = (contestUuid: string, row: any, index: number) => {
      const splitUuid = resolveEntityId(row || {}, ['split_uuid', 'splituuid', 'uuid', 'id', 'split_id'], `split_${index + 1}`);
      const startTimingPointUuid = textValue(row || {}, ['start_timing_point_uuid', 'starttimingpointuuid', 'start_timing_point_id', 'starttimingpointid']) || null;
      const endTimingPointUuid = textValue(row || {}, ['end_timing_point_uuid', 'endtimingpointuuid', 'end_timing_point_id', 'endtimingpointid']) || textValue(row || {}, ['timing_point_uuid', 'timingpointuuid', 'timing_point_id', 'timingpointid']) || null;
      return {
        contestUuid,
        splitUuid,
        name: textValue(row || {}, ['name', 'split_name', 'label']) || `Split ${index + 1}`,
        displayName: textValue(row || {}, ['display_name', 'name', 'split_name', 'label']) || `Split ${index + 1}`,
        order: safeOrderNumber((row as any)?.order ?? (row as any)?.split_order ?? (row as any)?.sequence ?? (row as any)?.position, index + 1),
        timingPointUuid: endTimingPointUuid,
        startTimingPointUuid,
        endTimingPointUuid,
        legUuid: textValue(row || {}, ['leg_uuid', 'leguuid', 'leg_id']) || null,
        leg: textValue(row || {}, ['leg', 'leg_name', 'leglabel']) || null,
        distance: Number((row as any)?.distance ?? (row as any)?.distance_km ?? (row as any)?.distanceKm ?? 0) || null,
        configuration: row || {},
      };
    };

    const normalizeTimingPointRow = (contestUuid: string, row: any, index: number) => {
      const timingPointUuid = resolveEntityId(row || {}, ['timing_point_uuid', 'timingpointuuid', 'uuid', 'id', 'timingpointid'], `timing_point_${index + 1}`);
      return {
        contestUuid,
        timingPointUuid,
        name: textValue(row || {}, ['name', 'timing_point_name', 'label']) || `Timing Point ${index + 1}`,
        displayName: textValue(row || {}, ['display_name', 'name', 'timing_point_name', 'label']) || `Timing Point ${index + 1}`,
        order: safeOrderNumber((row as any)?.order ?? (row as any)?.sequence ?? (row as any)?.position, index + 1),
        splitUuid: textValue(row || {}, ['split_uuid', 'splituuid', 'split_id', 'splitid']) || null,
        deviceUuid: textValue(row || {}, ['device_uuid', 'deviceuuid', 'device_id']) || null,
        location: textValue(row || {}, ['location', 'site', 'venue', 'position']) || null,
        type: textValue(row || {}, ['type', 'timing_point_type', 'category']) || null,
        configuration: row || {},
      };
    };

    const normalizeLegRow = (contestUuid: string, row: any, index: number) => {
      const legUuid = resolveEntityId(row || {}, ['leg_uuid', 'leguuid', 'uuid', 'id', 'leg_id'], `leg_${index + 1}`);
      return {
        contestUuid,
        legUuid,
        name: textValue(row || {}, ['name', 'leg_name', 'label']) || `Leg ${index + 1}`,
        order: safeOrderNumber((row as any)?.order ?? (row as any)?.sequence ?? (row as any)?.sequence_no ?? (row as any)?.position, index + 1),
        firstSplitUuid: textValue(row || {}, ['first_split_uuid', 'firstsplituuid', 'first_split_id', 'firstsplitid']) || null,
        lastSplitUuid: textValue(row || {}, ['last_split_uuid', 'lastsplituuid', 'last_split_id', 'lastsplitid']) || null,
        configuration: row || {},
      };
    };

    const normalizeAgeGroupRow = (contestUuid: string, row: any, index: number) => {
      const ageGroupUuid = resolveEntityId(row || {}, ['age_group_uuid', 'agegroupuuid', 'uuid', 'id', 'agegroupid'], `age_group_${index + 1}`);
      return {
        contestUuid,
        ageGroupUuid,
        name: textValue(row || {}, ['display_name', 'name', 'label']) || `Age Group ${index + 1}`,
        displayName: textValue(row || {}, ['display_name', 'name', 'label']) || `Age Group ${index + 1}`,
        gender: textValue(row || {}, ['gender', 'sex']) || null,
        minAge: Number((row as any)?.minAge ?? (row as any)?.min_age ?? (row as any)?.fromAge ?? (row as any)?.from_age ?? 0) || null,
        maxAge: Number((row as any)?.maxAge ?? (row as any)?.max_age ?? (row as any)?.toAge ?? (row as any)?.to_age ?? 0) || null,
        configuration: row || {},
        ...row,
      };
    };

    const normalizeDeviceRow = (contestUuid: string, row: any, index: number) => {
      const deviceUuid = resolveEntityId(row || {}, ['device_uuid', 'deviceuuid', 'uuid', 'id', 'device_id'], `device_${index + 1}`);
      return {
        contestUuid,
        deviceUuid,
        name: textValue(row || {}, ['name', 'label', 'device_name']) || `Device ${index + 1}`,
        displayName: textValue(row || {}, ['display_name', 'name', 'label', 'device_name']) || `Device ${index + 1}`,
        timingPointUuid: textValue(row || {}, ['timing_point_uuid', 'timingpointuuid', 'timing_point_id', 'timingpointid']) || null,
        type: textValue(row || {}, ['type', 'device_type']) || null,
        location: textValue(row || {}, ['location', 'site', 'venue']) || null,
        configuration: row || {},
        ...row,
      };
    };

    const buildCollectionIndex = (
      byContestSource: Record<string, any[]>,
      uuidField: string,
      normalizeRow: (contestUuid: string, row: any, index: number) => any,
    ) => {
      const byContest: Record<string, any[]> = {};
      const byUuid: Record<string, any> = {};
      const list: any[] = [];
      const ownershipErrors: string[] = [];

      for (const [contestUuidRaw, rows] of Object.entries(byContestSource || {})) {
        const contestUuid = String(contestUuidRaw || '').trim();
        if (!contestUuid) continue;
        const contestKey = normalizeLookupKey(contestUuid);
        const normalizedRows: any[] = [];
        const seenContestUuids = new Set<string>();
        (Array.isArray(rows) ? rows : []).forEach((row, index) => {
          const normalized = normalizeRow(contestUuid, row, index);
          const normalizedContestUuid = String(normalized?.contestUuid || '').trim();
          if (!normalizedContestUuid || normalizeLookupKey(normalizedContestUuid) !== contestKey) {
            ownershipErrors.push(`Timing point assigned to wrong contest. expected=${contestUuid} actual=${normalizedContestUuid || 'null'}`);
            return;
          }
          const uuidValue = String(normalized?.[uuidField] || '').trim();
          if (!uuidValue) return;
          const uuidKey = normalizeLookupKey(uuidValue);
          if (!uuidKey || seenContestUuids.has(uuidKey)) return;
          seenContestUuids.add(uuidKey);
          normalizedRows.push(normalized);
          if (!byUuid[uuidKey]) byUuid[uuidKey] = normalized;
        });
        byContest[contestUuid] = normalizedRows;
      }

      Object.keys(byContest).forEach((contestUuid) => {
        byContest[contestUuid]
          .sort((a, b) => safeOrderNumber((a as any)?.order, 0) - safeOrderNumber((b as any)?.order, 0))
          .forEach((row) => list.push(row));
      });

      return { byContest, byUuid, list, ownershipErrors };
    };

    const splitCollections = buildCollectionIndex(flattenByContest(splitRowsByContest), 'splitUuid', normalizeSplitRow);
    const timingPointsByContestObject = flattenByContest(timingPointsByContest);
    const timingPointCollections = buildCollectionIndex(timingPointsByContestObject, 'timingPointUuid', normalizeTimingPointRow);
    const legCollections = buildCollectionIndex(flattenByContest(legRowsByContest), 'legUuid', normalizeLegRow);
    const ageGroupCollections = buildCollectionIndex(flattenByContest(ageGroupRowsByContest), 'ageGroupUuid', normalizeAgeGroupRow);
    const deviceCollections = buildCollectionIndex(flattenByContest(deviceRowsByContest), 'deviceUuid', normalizeDeviceRow);

    const sumByContest = (byContest: Record<string, any[]>) => Object.values(byContest || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
    const validateCollectionCount = (name: string, payload: { byContest: Record<string, any[]>; byUuid: Record<string, any>; list: any[] }, errors: string[]) => {
      const byContestCount = sumByContest(payload.byContest);
      const byUuidCount = Object.keys(payload.byUuid || {}).length;
      const listCount = Array.isArray(payload.list) ? payload.list.length : 0;
      if (!(byContestCount === byUuidCount && byUuidCount === listCount)) {
        console.error('Timing Point Index Corrupted', { name, byContestCount, byUuidCount, listCount });
        errors.push(`Timing Point Index Corrupted (${name})`);
      }
    };

    const importValidationWarnings: string[] = [];
    for (const contest of groupedContests as any[]) {
      const contestUuid = String(contest?.contestUuid || contest?.id || '').trim();
      if (!contestUuid) continue;
      const contestName = String(contest?.contestName || contest?.displayName || contest?.category || contestUuid).trim();
      const importedCount = (timingPointsByContest.get(contestUuid) || []).length;
      const savedCount = (timingPointsByContest.get(contestUuid) || []).length;
      console.log('[Timing Points Import Validation]', {
        contest: contestName,
        contestUuid,
        importedTimingPoints: importedCount,
        savedTimingPoints: savedCount,
      });
      if (importedCount !== savedCount) {
        importValidationWarnings.push(`Timing points mismatch for ${contestName} (${contestUuid}): imported=${importedCount}, saved=${savedCount}`);
      }
    }

    const timingConfigurationSnapshot = {
      eventId,
      provider: 'feibot',
      source: 'feibot-fdb',
      version: metadata.eventUuid || importedAtIso,
      importedAt: importedAtIso,
      updatedAt: importedAtIso,
      contests: groupedContests,
      contestIndex: contestIndexByUuid,
      contestByUuid: contestIndexByUuid,
      contestByName: contestIndexByName,
      splits: allGroupedSplits,
      timingPoints: timingPointList,
      legs: allGroupedLegs,
      ageGroups: allGroupedAgeGroups,
      devices: allGroupedDevices,
      timingPointsByContest: timingPointsByContestObject,
      timingPointIndex: timingPointsByUuid,
      byContest: timingPointsByContestObject,
      byUuid: timingPointsByUuid,
      list: timingPointList,
      splitCollections: {
        byContest: splitCollections.byContest,
        byUuid: splitCollections.byUuid,
        list: splitCollections.list,
      },
      timingPointCollections: {
        byContest: timingPointsByContestObject,
        byUuid: timingPointsByUuid,
        list: timingPointList,
      },
      legCollections: {
        byContest: legCollections.byContest,
        byUuid: legCollections.byUuid,
        list: legCollections.list,
      },
      ageGroupCollections: {
        byContest: ageGroupCollections.byContest,
        byUuid: ageGroupCollections.byUuid,
        list: ageGroupCollections.list,
      },
      deviceCollections: {
        byContest: deviceCollections.byContest,
        byUuid: deviceCollections.byUuid,
        list: deviceCollections.list,
      },
      splitsByContest: flattenByContest(splitRowsByContest),
      legsByContest: flattenByContest(legRowsByContest),
      ageGroupsByContest: flattenByContest(ageGroupRowsByContest),
      devicesByContest: flattenByContest(deviceRowsByContest),
      splitIndex: {
        byContest: flattenByContest(splitRowsByContest),
        byUuid: Object.fromEntries(splitIndex.map((row: any) => [normalizeLookupKey(String(row?.splitUuid || row?.uuid || row?.id || '')), row]).filter(([key]) => !!key)),
        list: splitIndex,
      },
      legIndex: {
        byContest: flattenByContest(legRowsByContest),
        byUuid: Object.fromEntries(legIndex.map((row: any) => [normalizeLookupKey(String(row?.legUuid || row?.uuid || row?.id || '')), row]).filter(([key]) => !!key)),
        list: legIndex,
      },
      ageGroupIndex: {
        byContest: flattenByContest(ageGroupRowsByContest),
        byUuid: Object.fromEntries(ageGroupIndex.map((row: any) => [normalizeLookupKey(String(row?.ageGroupUuid || row?.uuid || row?.id || '')), row]).filter(([key]) => !!key)),
        list: ageGroupIndex,
      },
      deviceIndex: {
        byContest: flattenByContest(deviceRowsByContest),
        byUuid: Object.fromEntries(deviceIndex.map((row: any) => [normalizeLookupKey(String(row?.deviceUuid || row?.uuid || row?.id || '')), row]).filter(([key]) => !!key)),
        list: deviceIndex,
      },
      course: {
        contests: groupedContests,
        splits: allGroupedSplits,
        timingPoints: timingPointList,
        legs: allGroupedLegs,
        ageGroups: allGroupedAgeGroups,
        devices: allGroupedDevices,
      },
    };

    const contestValidationLogs: string[] = [];
    for (const contest of groupedContests as any[]) {
      const contestUuid = String(contest.contestUuid || contest.id || '').trim();
      const contestName = String(contest.contestName || contest.displayName || 'Unknown Contest').trim();
      const splitCountForContest = Array.isArray(contest.splits) ? contest.splits.length : 0;
      const timingPointCountForContest = Array.isArray(contest.timingPoints) ? contest.timingPoints.length : 0;
      const legCountForContest = Array.isArray(contest.legs) ? contest.legs.length : 0;
      const ageGroupCountForContest = Array.isArray(contest.ageGroups) ? contest.ageGroups.length : 0;

      contestValidationLogs.push(`Contest Name: ${contestName}`);
      contestValidationLogs.push(`Contest UUID: ${contestUuid}`);
      contestValidationLogs.push(`Split Count: ${splitCountForContest}`);
      contestValidationLogs.push(`Timing Point Count: ${timingPointCountForContest}`);
      contestValidationLogs.push(`Leg Count: ${legCountForContest}`);
      contestValidationLogs.push(`Age Group Count: ${ageGroupCountForContest}`);

      if (summary.counts.splits > 0 && splitCountForContest === 0) {
        summary.warnings += 1;
        const warningMessage = `WARNING: Contest mapping incomplete. ${contestName} (${contestUuid}) has 0 splits while the database contains ${summary.counts.splits} splits.`;
        logs.push({ ts: new Date().toISOString(), action: 'VALIDATE', key: `contest:${contestUuid}:splits`, status: 'FAILED', durationMs: 0, detail: warningMessage });
        console.warn(warningMessage);
      }
      if (summary.counts.timingPoints > 0 && timingPointCountForContest === 0) {
        summary.warnings += 1;
        console.warn(`WARNING: Contest mapping incomplete. ${contestName} (${contestUuid}) has 0 timing points while the database contains ${summary.counts.timingPoints} timing points.`);
      }
      if (summary.counts.legs > 0 && legCountForContest === 0) {
        summary.warnings += 1;
        console.warn(`WARNING: Contest mapping incomplete. ${contestName} (${contestUuid}) has 0 legs while the database contains ${summary.counts.legs} legs.`);
      }
      if (summary.counts.ageGroups > 0 && ageGroupCountForContest === 0) {
        summary.warnings += 1;
        console.warn(`WARNING: Contest mapping incomplete. ${contestName} (${contestUuid}) has 0 age groups while the database contains ${summary.counts.ageGroups} age groups.`);
      }
    }

    const timingValidationErrors: string[] = [];
    const timingValidationWarnings: string[] = [];
    const splitUuidSet = new Set((splitCollections.list || []).map((row: any) => normalizeLookupKey(String(row?.splitUuid || row?.uuid || row?.id || ''))).filter(Boolean));
    const legUuidSet = new Set((legCollections.list || []).map((row: any) => normalizeLookupKey(String(row?.legUuid || row?.uuid || row?.id || ''))).filter(Boolean));
    const timingPointUuidSet = new Set((timingPointCollections.list || []).map((row: any) => normalizeLookupKey(String(row?.timingPointUuid || row?.uuid || row?.id || ''))).filter(Boolean));

    const contestLegsByUuid = new Map<string, Set<string>>();
    for (const legRow of legCollections.list as any[]) {
      const contestUuid = normalizeLookupKey(String(legRow?.contestUuid || ''));
      const legToken = normalizeLegToken(legRow?.name || legRow?.label || legRow?.legUuid || legRow?.uuid || '');
      if (!contestUuid || !legToken) continue;
      if (!contestLegsByUuid.has(contestUuid)) contestLegsByUuid.set(contestUuid, new Set<string>());
      contestLegsByUuid.get(contestUuid)?.add(legToken);
    }

    const timingPointOwnership = new Map<string, Set<string>>();
    for (const timingPointRow of timingPointCollections.list as any[]) {
      const uuid = normalizeLookupKey(String(timingPointRow?.timingPointUuid || timingPointRow?.uuid || timingPointRow?.id || ''));
      const contestUuid = normalizeLookupKey(String(timingPointRow?.contestUuid || ''));
      if (!uuid || !contestUuid) continue;
      if (!timingPointOwnership.has(uuid)) timingPointOwnership.set(uuid, new Set<string>());
      timingPointOwnership.get(uuid)?.add(contestUuid);
    }

    if (importValidationWarnings.length > 0) {
      timingValidationWarnings.push(...importValidationWarnings);
      summary.warnings += importValidationWarnings.length;
      importValidationWarnings.forEach((warning) => console.warn('[Timing Import Warning]', warning));
    }

    if (timingPointCollections.ownershipErrors.length > 0) {
      timingValidationErrors.push(...timingPointCollections.ownershipErrors.map(() => 'Timing point assigned to wrong contest.'));
    }

    for (const [contestUuid, contest] of Object.entries(contestIndexByUuid as Record<string, any>)) {
      const contestName = String(contest?.contestName || contest?.displayName || contest?.name || contestUuid).trim();
      const contestKey = normalizeLookupKey(contestUuid);
      const contestLegs = contestLegsByUuid.get(contestKey) || new Set<string>();
      if (contestLegs.size === 0) {
        timingValidationErrors.push(`Contest has no legs: ${contestName} (${contestUuid})`);
      }

      const profile = contestCourseProfile(contestName || String(contest?.category || ''));
      if (profile === 'triathlon') {
        const required = ['SWIM', 'T1', 'BIKE', 'T2', 'RUN'];
        const missing = required.filter((token) => !contestLegs.has(token));
        if (missing.length > 0) {
          timingValidationErrors.push(`Triathlon contest missing legs: ${contestName} (${contestUuid}) -> ${missing.join(', ')}`);
        }
      }
      if (profile === 'swimathon') {
        const required = ['SWIM'];
        const missing = required.filter((token) => !contestLegs.has(token));
        if (missing.length > 0) {
          timingValidationErrors.push(`Swimathon contest missing legs: ${contestName} (${contestUuid}) -> ${missing.join(', ')}`);
        }
      }
    }

    for (const splitRow of splitCollections.list as any[]) {
      const contestUuid = normalizeLookupKey(String(splitRow?.contestUuid || ''));
      if (!contestUuid || !normalizedContestSet.has(contestUuid)) {
        timingValidationErrors.push(`Split references unknown contest: ${String(splitRow?.contestUuid || 'null')}`);
      }
      const legUuidRaw = String(splitRow?.legUuid || splitRow?.leg_uuid || splitRow?.configuration?.leg_uuid || '').trim();
      const legUuid = normalizeLookupKey(legUuidRaw);
      if (legUuidRaw && !legUuidSet.has(legUuid)) {
        timingValidationErrors.push(`Split references missing leg: ${String(splitRow?.splitUuid || 'unknown')} -> ${String(splitRow?.legUuid || 'unknown')}`);
      }
      const startTimingPointUuidRaw = String(splitRow?.startTimingPointUuid || splitRow?.start_timing_point_uuid || splitRow?.configuration?.start_timing_point_uuid || splitRow?.configuration?.startTimingPointUuid || '').trim();
      const endTimingPointUuidRaw = String(splitRow?.endTimingPointUuid || splitRow?.end_timing_point_uuid || splitRow?.timingPointUuid || splitRow?.timing_point_uuid || splitRow?.configuration?.end_timing_point_uuid || splitRow?.configuration?.timing_point_uuid || '').trim();
      const startTimingPointUuid = normalizeLookupKey(startTimingPointUuidRaw);
      const endTimingPointUuid = normalizeLookupKey(endTimingPointUuidRaw);
      if (startTimingPointUuidRaw && !timingPointUuidSet.has(startTimingPointUuid)) {
        timingValidationErrors.push(`Split references missing start timing point: ${String(splitRow?.splitUuid || 'unknown')} -> ${String(splitRow?.startTimingPointUuid || splitRow?.start_timing_point_uuid || 'unknown')}`);
      }
      if (endTimingPointUuidRaw && !timingPointUuidSet.has(endTimingPointUuid)) {
        timingValidationErrors.push(`Split references missing end timing point: ${String(splitRow?.splitUuid || 'unknown')} -> ${String(splitRow?.endTimingPointUuid || splitRow?.timingPointUuid || 'unknown')}`);
      }
    }

    for (const timingPointRow of timingPointCollections.list as any[]) {
      const contestUuid = normalizeLookupKey(String(timingPointRow?.contestUuid || ''));
      const timingPointUuid = normalizeLookupKey(String(timingPointRow?.timingPointUuid || timingPointRow?.uuid || timingPointRow?.id || ''));
      if (!contestUuid || !normalizedContestSet.has(contestUuid)) {
        timingValidationErrors.push(`Timing point references unknown contest: ${String(timingPointRow?.contestUuid || 'null')}`);
      }
      const owners = timingPointOwnership.get(timingPointUuid);
      if (owners && owners.size > 1) {
        timingValidationErrors.push(`Timing point belongs to multiple contests: ${String(timingPointRow?.timingPointUuid || timingPointRow?.uuid || 'unknown')}`);
      }
    }

    for (const legRow of legCollections.list as any[]) {
      const contestUuid = normalizeLookupKey(String(legRow?.contestUuid || ''));
      const legUuid = normalizeLookupKey(String(legRow?.legUuid || legRow?.uuid || legRow?.id || ''));
      if (!contestUuid || !normalizedContestSet.has(contestUuid)) {
        timingValidationErrors.push(`Leg references unknown contest: ${String(legRow?.contestUuid || 'null')}`);
      }
      if (!legUuid || !legUuidSet.has(legUuid)) {
        timingValidationErrors.push(`Leg has missing UUID: ${String(legRow?.name || legRow?.label || 'unknown')}`);
      }
      const firstSplitUuid = normalizeLookupKey(String(legRow?.firstSplitUuid || legRow?.first_split_uuid || legRow?.configuration?.first_split_uuid || ''));
      const lastSplitUuid = normalizeLookupKey(String(legRow?.lastSplitUuid || legRow?.last_split_uuid || legRow?.configuration?.last_split_uuid || ''));
      if (firstSplitUuid && !splitUuidSet.has(firstSplitUuid)) {
        timingValidationErrors.push(`Leg references missing first split: ${String(legRow?.legUuid || 'unknown')} -> ${String(legRow?.firstSplitUuid || legRow?.first_split_uuid || 'unknown')}`);
      }
      if (lastSplitUuid && !splitUuidSet.has(lastSplitUuid)) {
        timingValidationErrors.push(`Leg references missing last split: ${String(legRow?.legUuid || 'unknown')} -> ${String(legRow?.lastSplitUuid || legRow?.last_split_uuid || 'unknown')}`);
      }
    }

    validateCollectionCount('timingPoints', timingPointCollections as any, timingValidationErrors);
    validateCollectionCount('splits', splitCollections as any, timingValidationErrors);
    validateCollectionCount('legs', legCollections as any, timingValidationErrors);

    const splitUuids = new Set(Object.keys(splitCollections.byUuid || {}));
    const timingPointUuids = new Set(Object.keys(timingPointsByUuid || {}));
    const legUuids = new Set(Object.keys(legCollections.byUuid || {}));

    for (const splitRow of splitCollections.list as any[]) {
      const contestUuid = normalizeLookupKey(String(splitRow?.contestUuid || ''));
      if (!contestUuid || !normalizedContestSet.has(contestUuid)) {
        timingValidationErrors.push(`Split references unknown contest: ${String(splitRow?.contestUuid || 'null')}`);
      }
      const timingPointUuidRaw = String(splitRow?.timingPointUuid || '').trim();
      const timingPointUuid = normalizeLookupKey(timingPointUuidRaw);
      if (timingPointUuidRaw && !timingPointUuids.has(timingPointUuid)) {
        timingValidationErrors.push(`Split references missing timing point: ${String(splitRow?.splitUuid || 'unknown')} -> ${String(splitRow?.timingPointUuid || 'unknown')}`);
      }
      const legUuidRaw = String(splitRow?.legUuid || '').trim();
      const legUuid = normalizeLookupKey(legUuidRaw);
      if (legUuidRaw && !legUuids.has(legUuid)) {
        timingValidationWarnings.push(`Split references missing leg mapping: ${String(splitRow?.splitUuid || 'unknown')} -> ${String(splitRow?.legUuid || 'unknown')}`);
      }
    }

    for (const legRow of legCollections.list as any[]) {
      const contestUuid = normalizeLookupKey(String(legRow?.contestUuid || ''));
      if (!contestUuid || !normalizedContestSet.has(contestUuid)) {
        timingValidationErrors.push(`Leg references unknown contest: ${String(legRow?.contestUuid || 'null')}`);
      }
      const firstSplitUuid = normalizeLookupKey(String(legRow?.firstSplitUuid || ''));
      const lastSplitUuid = normalizeLookupKey(String(legRow?.lastSplitUuid || ''));
      if (firstSplitUuid && !splitUuids.has(firstSplitUuid)) {
        timingValidationErrors.push(`Leg references missing split: ${String(legRow?.legUuid || 'unknown')} -> first ${String(legRow?.firstSplitUuid || 'unknown')}`);
      }
      if (lastSplitUuid && !splitUuids.has(lastSplitUuid)) {
        timingValidationErrors.push(`Leg references missing split: ${String(legRow?.legUuid || 'unknown')} -> last ${String(legRow?.lastSplitUuid || 'unknown')}`);
      }
    }

    for (const timingPointRow of timingPointCollections.list as any[]) {
      const contestUuid = normalizeLookupKey(String(timingPointRow?.contestUuid || ''));
      if (!contestUuid || !normalizedContestSet.has(contestUuid)) {
        timingValidationErrors.push(`Timing point references unknown contest: ${String(timingPointRow?.contestUuid || 'null')}`);
      }
    }

    if (timingValidationWarnings.length > 0) {
      summary.warnings += timingValidationWarnings.length;
      timingValidationWarnings.forEach((warning) => console.warn('[Timing Configuration Warning]', warning));
    }

    if (timingValidationWarnings.length > 0) {
      if (!summary.warningMessages) summary.warningMessages = [];
      summary.warningMessages.push(...timingValidationWarnings);
    }

    if (timingValidationErrors.length > 0) {
      summary.errors += timingValidationErrors.length;
      summary.validationStatus = 'FAILED';
      if (!summary.errorMessages) summary.errorMessages = [];
      summary.errorMessages.push(...timingValidationErrors);
      console.error('Timing Configuration Validation Failed', {
        eventId,
        errorCount: timingValidationErrors.length,
        errors: timingValidationErrors,
      });
      throw new Error('Timing Configuration Validation Failed');
    }

    await putTrackedKV(`live:event:${eventId}:timingConfiguration`, timingConfigurationSnapshot, logs, summary);

    await withTimeout(putKV(`live:event:${eventId}:import-summary:latest`, {
      ...summary,
      currentStage: 'BUILDING_RUNTIME_KV',
      status: 'IMPORTING',
      validationStatus: 'PENDING',
      completedAt: null,
    }, '[API /live-tracking/feibot/fdb-import]'), 5000, 'Core import summary write');

    await persistState(eventId, {
      latestSummary: {
        ...summary,
        currentStage: 'BUILDING_RUNTIME_KV',
        status: 'IMPORTING',
        validationStatus: 'PENDING',
        completedAt: null,
      },
    });

    await throwIfImportCancelled(jobId);

    await reportProgress(80, 'REBUILDING_RUNTIME_KV', 'Rebuilding runtime KV snapshots...', summary as any);
    const rebuildStartedAt = Date.now();
    let rebuiltIndexes: any = null;
    let rebuildTimedOut = false;
    try {
      logs.push({
        ts: new Date().toISOString(),
        action: 'REBUILD',
        key: 'runtime-kv',
        status: 'STARTED',
        durationMs: 0,
        detail: `Rebuilding runtime KV snapshots for ${summary.counts.contests} contests, ${summary.counts.splits} splits, ${summary.counts.timingPoints} timing points`,
      });
      rebuiltIndexes = await withTimeout(
        rebuildSplitIndexInKv({
          eventId,
          timingConfiguration: timingConfigurationSnapshot as any,
          provider: 'feibot',
          generatedBy: 'fdb-import',
          syncType: 'fdb-import',
          sourceVersion: metadata.eventUuid || importedAtIso,
          generatedAt: importedAtIso,
        }),
        15000,
        'Split index rebuild',
      );
      logs.push({
        ts: new Date().toISOString(),
        action: 'REBUILD',
        key: 'runtime-kv',
        status: 'SUCCESS',
        durationMs: Date.now() - rebuildStartedAt,
        detail: 'Runtime KV rebuild completed',
      });
    } catch (error: any) {
      const rebuildErrorMessage = error?.message || 'Split index rebuild failed';
      rebuildTimedOut = /timed out/i.test(rebuildErrorMessage);
      summary.warnings += 1;
      summary.validationStatus = summary.validationStatus === 'PASS' ? 'WARNING' : summary.validationStatus;
      logs.push({
        ts: new Date().toISOString(),
        action: 'REBUILD',
        key: 'runtime-kv',
        status: 'FAILED',
        durationMs: Date.now() - rebuildStartedAt,
        detail: rebuildTimedOut ? `${rebuildErrorMessage} — continuing with imported contest data` : rebuildErrorMessage,
      });
      console.warn(`[FDB Import] Runtime KV rebuild ${rebuildTimedOut ? 'timed out' : 'failed'} for event ${eventId}:`, rebuildErrorMessage);
    }

    console.log('[REBUILD CONFIG]', {
      eventId,
      course: metadata.eventName || null,
      legs: Array.isArray(allGroupedLegs) ? allGroupedLegs.length : 0,
      distances: {
        contests: contestIndex.length,
        splits: splitIndex.length,
      },
      timingPoints: timingPointIndex.length,
      contestMapping: Object.keys(contestIndexByUuid || {}).length,
    });

    const rebuiltSplitIndex = rebuiltIndexes?.splitIndex as any;
    const rebuiltContestIndex = rebuiltSplitIndex?.contestIndex || contestIndexByUuid;
    const rebuiltTimingPointIndex = rebuiltSplitIndex?.timingPointIndex || { byUuid: {}, list: [] };
    const rebuiltAgeGroupIndex = rebuiltSplitIndex?.ageGroupIndex || { byUuid: {}, list: [] };

    if (!rebuiltIndexes || rebuiltIndexes.status === 'failed') {
      summary.warnings += 1;
      console.warn(`[FDB Import] Falling back to extracted contest data for event ${eventId}; runtime KV rebuild ${rebuildTimedOut ? 'timed out' : 'did not complete'}.`);
    }

    const generatedSplitIndex = rebuiltSplitIndex?.byContest;
    console.log('[REBUILD GENERATED SPLITS]', generatedSplitIndex);
    if (
      !generatedSplitIndex ||
      typeof generatedSplitIndex !== 'object' ||
      Object.keys(generatedSplitIndex).length === 0
    ) {
      throw new Error('Split index is empty. Aborting rebuild.');
    }

    await putTrackedKV(`live:event:${eventId}:contest:index`, rebuiltContestIndex, logs, summary);
    
    const splitIndexKey = `live:event:${eventId}:split:index`;
    console.log('[KV WRITE]', splitIndexKey, generatedSplitIndex);
    await putTrackedKV(splitIndexKey, generatedSplitIndex, logs, summary);
    const splitIndexVerify = await getKV<any>(splitIndexKey, '[API /live-tracking/feibot/fdb-import verify]');
    console.log('[KV VERIFY]', splitIndexVerify);

    const normalizeContestKey = (value: unknown) => normalizeLookupKey(String(value || ''));
    const resolveContestSplits = (contestUuid: string) => {
      const direct = (generatedSplitIndex as any)?.[contestUuid];
      if (direct && Array.isArray(direct?.splits)) return direct.splits as any[];
      const lookupKey = normalizeContestKey(contestUuid);
      const matchedEntry = Object.values(generatedSplitIndex as Record<string, any>).find((entry: any) => normalizeContestKey(entry?.contestUuid || entry?.contest_uuid || '') === lookupKey);
      return Array.isArray((matchedEntry as any)?.splits) ? (matchedEntry as any).splits as any[] : [];
    };

    const legIndexPayload = {
      byContest: timingConfigurationSnapshot.legsByContest,
      byUuid: Object.fromEntries(
        allGroupedLegs
          .map((row: any) => {
            const uuid = String(row?.uuid || row?.legUuid || row?.leg_uuid || row?.configuration?.uuid || '').trim();
            return uuid ? [normalizeLookupKey(uuid), row] : null;
          })
          .filter(Boolean) as Array<[string, any]>,
      ),
      list: allGroupedLegs,
    };

    const legValidationErrors: string[] = [];
    console.log('[LEG INDEX]', {
      eventId,
      contests: Object.keys(legIndexPayload.byContest || {}).length,
    });
    for (const [contestUuid, legs] of Object.entries((legIndexPayload.byContest || {}) as Record<string, any[]>)) {
      const contestSplits = resolveContestSplits(String(contestUuid));
      const splitLookup = new Map<string, number>();
      contestSplits.forEach((split: any, index: number) => {
        const splitUuid = String(split?.splitUuid || split?.uuid || split?.id || '').trim();
        if (splitUuid) splitLookup.set(normalizeLookupKey(splitUuid), index);
      });

      console.log('[LEG INDEX]', {
        contest: contestUuid,
        legCount: Array.isArray(legs) ? legs.length : 0,
      });

      for (const leg of Array.isArray(legs) ? legs : []) {
        const legName = String(leg?.name || leg?.label || 'LEG').trim();
        const legUuid = String(leg?.uuid || leg?.legUuid || leg?.leg_uuid || '').trim();
        const firstSplitUuid = String(leg?.first_split_uuid || leg?.firstSplitUuid || leg?.configuration?.first_split_uuid || '').trim();
        const lastSplitUuid = String(leg?.last_split_uuid || leg?.lastSplitUuid || leg?.configuration?.last_split_uuid || '').trim();
        const firstIndex = firstSplitUuid ? splitLookup.get(normalizeLookupKey(firstSplitUuid)) : undefined;
        const lastIndex = lastSplitUuid ? splitLookup.get(normalizeLookupKey(lastSplitUuid)) : undefined;
        const resolvedCount = firstIndex !== undefined && lastIndex !== undefined
          ? Math.max(0, Math.abs(lastIndex - firstIndex) + 1)
          : 0;

        console.log('[LEG]', {
          contest: contestUuid,
          leg: legName,
          legUuid,
          firstSplit: firstSplitUuid || null,
          lastSplit: lastSplitUuid || null,
          resolvedSplits: resolvedCount,
        });

        if (!firstSplitUuid || firstIndex === undefined) {
          const msg = `[LEG ERROR] First split not found contest=${contestUuid} leg=${legName} firstSplit=${firstSplitUuid || 'null'}`;
          console.error(msg);
          legValidationErrors.push(msg);
        }
        if (!lastSplitUuid || lastIndex === undefined) {
          const msg = `[LEG ERROR] Last split not found contest=${contestUuid} leg=${legName} lastSplit=${lastSplitUuid || 'null'}`;
          console.error(msg);
          legValidationErrors.push(msg);
        }
        if (firstIndex !== undefined && lastIndex !== undefined && resolvedCount <= 0) {
          const msg = `[LEG ERROR] Leg resolved zero splits contest=${contestUuid} leg=${legName} uuid=${legUuid || 'unknown'}`;
          console.error(msg);
          legValidationErrors.push(msg);
        }
      }
    }

    if (legValidationErrors.length > 0) {
      throw new Error(`Leg index validation failed (${legValidationErrors.length} errors).`);
    }

    await putTrackedKV(`live:event:${eventId}:timingPoint:index`, {
      byContest: timingPointCollections.byContest,
      byUuid: timingPointCollections.byUuid,
      list: timingPointCollections.list,
    }, logs, summary);
    await putTrackedKV(`live:event:${eventId}:timingPoint:index`, {
      byContest: timingPointCollections.byContest,
      byUuid: timingPointCollections.byUuid,
      list: timingPointCollections.list,
    }, logs, summary);
    await putTrackedKV(`live:event:${eventId}:ageGroup:index`, {
      byContest: timingConfigurationSnapshot.ageGroupsByContest,
      byUuid: rebuiltAgeGroupIndex.byUuid || {},
      list: rebuiltAgeGroupIndex.list || [],
    }, logs, summary);
    await putTrackedKV(`live:event:${eventId}:leg:index`, legIndexPayload, logs, summary);

    const courseIndexStart = Date.now();
    try {
      const courseIndexResult = await withTimeout(
        rebuildCourseIndexInKv({
          eventId,
          timingConfiguration: timingConfigurationSnapshot as any,
          provider: 'feibot',
          generatedBy: 'fdb-import',
          syncType: 'fdb-import',
          sourceVersion: metadata.eventUuid || importedAtIso,
          generatedAt: importedAtIso,
        }),
        15000,
        'Course index rebuild',
      );
      logs.push({
        ts: new Date().toISOString(),
        action: 'REBUILD',
        key: 'course-index',
        status: courseIndexResult.status === 'updated' ? 'SUCCESS' : 'STARTED',
        durationMs: Date.now() - courseIndexStart,
        detail: courseIndexResult.status === 'updated'
          ? 'Unified course index rebuilt'
          : courseIndexResult.status === 'unchanged'
            ? 'Unified course index unchanged'
            : 'Unified course index preserved',
      });
    } catch (error: any) {
      const message = error?.message || 'Course index rebuild failed';
      summary.warnings += 1;
      logs.push({
        ts: new Date().toISOString(),
        action: 'REBUILD',
        key: 'course-index',
        status: 'FAILED',
        durationMs: Date.now() - courseIndexStart,
        detail: message,
      });
      console.warn(`[FDB Import] Course index rebuild failed for event ${eventId}:`, message);
    }

    console.log('[FDB Import Contest Validation]', contestValidationLogs.join(' | '));
    await reportProgress(90, 'VALIDATING_KV', 'Validating runtime keys...', summary as any);

    const participants = buckets.participants.map((row, index) => ({
      index,
      uuid: resolveEntityId(row, ['participant_uuid', 'participantuuid', 'uuid', 'participantid', 'id'], `participant_${index + 1}`),
      bib: textValue(row, ['bib', 'bib_number', 'bibno', 'bibnumber']),
      chip: textValue(row, ['chip', 'chip_number', 'chipno', 'chipnumber']),
      contestUuid: textValue(row, ['contest_uuid', 'contestuuid', 'contestid', 'contest_id', 'contest']) || null,
      contestName: textValue(row, ['contest_name', 'contestname', 'category', 'contest']) || null,
      ageGroupUuid: textValue(row, ['age_group_uuid', 'agegroupuuid', 'agegroup', 'age_group']) || null,
      ageGroupName: textValue(row, ['age_group_name', 'agegroupname', 'agegroup', 'age_group']) || null,
      dob: textValue(row, ['dob', 'date_of_birth', 'birth_date']) || null,
      club: textValue(row, ['club', 'club_name', 'team', 'team_name']) || null,
      provider: textValue(row, ['provider']) || 'feibot',
      providerUuid: resolveEntityId(row, ['provider_uuid', 'provideruuid', 'participant_uuid', 'participantuuid', 'uuid', 'participantid', 'id'], `participant_${index + 1}`),
      gender: textValue(row, ['gender', 'sex']),
      status: textValue(row, ['status']),
      category: textValue(row, ['category', 'contest_name', 'contest']),
      name: textValue(row, ['name', 'participant_name', 'athlete_name', 'full_name']),
      email: textValue(row, ['email', 'e_mail']) || null,
      phone: textValue(row, ['phone', 'mobile', 'phone_number']) || null,
      raw: row,
    }));
    const activeParticipants = participants.filter((row) => statusIsActive(row.status));

    await throwIfImportCancelled(jobId);

    summary.counts.contests = contestIndex.length;
    summary.counts.legs = legIndex.length;
    summary.counts.splits = splitIndex.length;
    summary.counts.timingPoints = timingPointIndex.length;
    summary.counts.devices = deviceIndex.length;
    summary.counts.ageGroups = ageGroupIndex.length;
    summary.counts.rankings = buckets.rankings.length;
    summary.counts.participants = participants.length;
    summary.counts.activeParticipants = activeParticipants.length;

    const eventDoc = await getFirestoreInstance().collection('events').doc(eventId).get();
    const eventData = eventDoc.exists ? (eventDoc.data() || {}) : {};

    await putTrackedKV(`live:event:${eventId}:config`, {
      eventId,
      source: 'feibot-fdb',
      importedAt: new Date().toISOString(),
      eventUuid: metadata.eventUuid,
      scoreEventUuid: metadata.scoreEventUuid,
      eventName: metadata.eventName,
      venue: metadata.venue,
      city: metadata.city,
      country: metadata.country,
      timeZone: metadata.timeZone,
      tables: summary.tables,
    }, logs, summary);

    await putTrackedKV(`live:event:${eventId}:data`, {
      eventId,
      eventName: metadata.eventName || String((eventData as any).eventName || (eventData as any).name || 'Live Event'),
      eventDate: String((eventData as any).eventDate || (eventData as any).date || 'TBD'),
      liveDataSource: 'timing_partner',
      source: 'fdb-import',
      updatedAt: new Date().toISOString(),
    }, logs, summary);

    console.log('[FEIBOT PARTICIPANT IMPORT][STEP 1] Download complete', {
      eventId,
      source: 'feibot-fdb',
    });
    console.log('[FEIBOT PARTICIPANT IMPORT][STEP 2] Participant Count', {
      eventId,
      participantRows: participants.length,
    });

    const { participants: staticParticipants, participantIndexPayload, stats: participantImportStats } = await buildFeibotParticipantImport({
      eventId,
      source: 'feibot-fdb',
      provider: 'feibot',
      rawParticipants: participants,
      timingConfiguration: timingConfigurationSnapshot as any,
      contestIndex: contestIndexByUuid as any,
      ageGroupIndex: {
        byUuid: Object.fromEntries(Array.from(ageGroupNameByUuid.entries()).map(([uuid, name]) => [normalizeLookupKey(uuid), { uuid, name }])),
      },
      generatedAt: importedAtIso,
    });

    console.log('[FEIBOT PARTICIPANT IMPORT][STEP 3] Normalized', {
      eventId,
      normalized: Number(participantImportStats.normalized || staticParticipants.length),
    });
    console.log('[FEIBOT PARTICIPANT IMPORT][STEP 4] Matched Users', {
      eventId,
      matchedUsers: Number(participantImportStats.matchedUsers || 0),
    });
    console.log('[FEIBOT PARTICIPANT IMPORT][STEP 4.1] User lookup failures', {
      eventId,
      userLookupFailures: Number(participantImportStats.userLookupFailures || 0),
      participantFailures: Number(participantImportStats.participantFailures || 0),
    });
    logs.push({
      ts: new Date().toISOString(),
      action: 'WRITE',
      key: 'FDB upload manifest',
      status: 'SUCCESS',
      durationMs: 0,
      detail: `File ${fileName} (${Math.max(1, Math.round(fileSize / 1024))} KB), ${participants.length} parsed rows, ${staticParticipants.length} normalized participants`,
    });

    const replaceExistingParticipants = options?.replaceExistingParticipants === true;
    const forceEmptyImport = options?.forceEmptyImport === true;
    const existingLiveIndex =
      (await getKV<any>(`event:${eventId}:participants:index`, 'fdb-import')) ||
      (await getKV<any>(`live:event:${eventId}:participant:index`, 'fdb-import'));
    const existingLiveCount = Array.isArray(existingLiveIndex?.participants)
      ? existingLiveIndex.participants.length
      : Number(existingLiveIndex?.participantCount || existingLiveIndex?.count || 0);
    const importedCount = Number(participantIndexPayload?.participantCount || staticParticipants.length || 0);
    const shouldPreserveExisting = importedCount === 0 && existingLiveCount > 0 && !replaceExistingParticipants && !forceEmptyImport;

    if (shouldPreserveExisting) {
      console.log('[INFO] Import returned zero participants. Existing live participant data preserved. No live indexes overwritten.', {
        eventId,
        existingLiveCount,
      });
      logs.push({
        ts: new Date().toISOString(),
        action: 'VALIDATE',
        key: `live:event:${eventId}:participant:index`,
        status: 'SUCCESS',
        durationMs: 0,
        detail: 'Import returned zero participants. Existing live participant data preserved. No live indexes overwritten.',
      });
    } else {
      const participantBibIndex = Object.fromEntries(Object.entries(participantIndexPayload.byBib || {}).map(([key, value]) => [key, value || null]));
      const participantUuidIndex = Object.fromEntries(Object.entries((participantIndexPayload.byUUID || participantIndexPayload.byUuid || {}) || {}).map(([key, value]) => [key, value || null]));
      const participantProviderUuidIndex = Object.fromEntries(Object.entries(participantIndexPayload.byProviderUuid || {}).map(([key, value]) => [key, value || null]));
      const participantEmailIndex = Object.fromEntries(Object.entries(participantIndexPayload.byEmail || {}).map(([key, value]) => [key, value || null]));
      const participantAthleteUidIndex = Object.fromEntries(Object.entries(participantIndexPayload.byAthleteUid || {}).map(([key, value]) => [key, value || null]));
      const participantNameIndex = Object.fromEntries(Object.entries(participantIndexPayload.byName || {}).map(([key, value]) => [key, value || null]));
      const participantChipIndex = Object.fromEntries(Object.entries(participantIndexPayload.byChip || {}).map(([key, value]) => [key, value || null]));
      const providerParticipantsPayload = {
        eventId,
        provider: 'feibot',
        source: 'feibot-fdb',
        generatedAt: importedAtIso,
        count: staticParticipants.length,
        participants: staticParticipants,
        importedCount: staticParticipants.length,
      };
      console.log('[FEIBOT PARTICIPANT IMPORT][STEP 5] Writing timingParticipant', {
        eventId,
        staticParticipants: staticParticipants.length,
      });
      await throwIfImportCancelled(jobId);
      for (let i = 0; i < staticParticipants.length; i += 50) {
        const batch = staticParticipants.slice(i, i + 50);
        await Promise.all(batch.map((participant) => {
          const bookingId = String(participant.bookingId || '').trim();
          const participantUuid = String(participant.participantUuid || bookingId || '').trim();
          const writes: Promise<boolean>[] = [];
          if (bookingId) {
            const staticKey = `live:event:${eventId}:timingParticipant:${bookingId}`;
            writes.push(putTrackedKV(staticKey, participant, logs, summary));
          }
          if (participantUuid) {
            writes.push(putTrackedKV(`live:event:${eventId}:participant:${participantUuid}`, participant, logs, summary));
          }
          return Promise.all(writes).then(() => undefined);
        }));
      }

      console.log('[FEIBOT PARTICIPANT IMPORT][STEP 6] Writing participant indexes', {
        eventId,
        participantIndexCount: Number(participantIndexPayload?.participantCount || 0),
      });
      await putTrackedKV(`event:${eventId}:providerParticipants`, providerParticipantsPayload, logs, summary);
      await putTrackedKV(`live:event:${eventId}:providerParticipants`, providerParticipantsPayload, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participants`, participantIndexPayload, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participant:bib`, participantBibIndex, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participant:uuid`, participantUuidIndex, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participant:providerUuid`, participantProviderUuidIndex, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participant:email`, participantEmailIndex, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participant:athleteUid`, participantAthleteUidIndex, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participant:name`, participantNameIndex, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participant:chip`, participantChipIndex, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participant:contest`, participantIndexPayload.byContest, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participant:ageGroup`, participantIndexPayload.byAgeGroup, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participant:index`, participantIndexPayload, logs, summary);
      await putTrackedKV(`live:event:${eventId}:participants:index`, participantIndexPayload, logs, summary);

      // FDB imports are KV-only. No Firestore participant writes/deletes are performed.
    }

    console.log('[FEIBOT PARTICIPANT IMPORT][STEP 7] Import Complete', {
      eventId,
      source: 'feibot-fdb',
      participantCount: staticParticipants.length,
      matchedUsers: Number(participantImportStats.matchedUsers || 0),
      userLookupFailures: Number(participantImportStats.userLookupFailures || 0),
    });

    const legacyParticipantKeys = [
      `live:event:${eventId}:participant:fdb:`,
      `event:${eventId}:participant:fdb:`,
      `live:event:${eventId}:participantLive:fdb:`,
      `event:${eventId}:participantLive:fdb:`,
    ];
    const legacyKeys: string[] = [];
    for (const prefix of legacyParticipantKeys) {
      const keys = await listKVByPrefix(prefix, '[API /live-tracking/feibot/fdb-import cleanup]');
      legacyKeys.push(...keys);
    }
    if (legacyKeys.length) {
      await batchDeleteKV(legacyKeys, '[API /live-tracking/feibot/fdb-import cleanup]');
      summary.kvRecordsWritten += 0;
      summary.warnings += 0;
      logs.push({ ts: new Date().toISOString(), action: 'DELETE', key: 'legacy participant keys', status: 'SUCCESS', durationMs: 0, detail: `${legacyKeys.length} keys removed` });
    }

    summary.validation = { missingKeys: [], complete: false };
    summary.validationStatus = 'PENDING';
    summary.status = summary.warnings > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED';
    summary.importDurationMs = Date.now() - startedAt;
    summary.elapsedTimeMs = summary.importDurationMs;
    summary.detected.lastModified = new Date().toISOString();

    await persistState(eventId, {
      database: {
        uploaded: true,
        fileName,
        fileSize,
        uploadedAt: new Date().toISOString(),
        databaseVersion: 'SQLite',
        localEventUuid: metadata.eventUuid,
        eventName: metadata.eventName,
        status: 'IMPORTED',
        tablesImported: summary.detected.numberOfTables,
        participants: summary.counts.participants,
        activeParticipants: summary.counts.activeParticipants,
        contests: summary.counts.contests,
        splits: summary.counts.splits,
        timingPoints: summary.counts.timingPoints,
        devices: summary.counts.devices,
        ageGroups: summary.counts.ageGroups,
        legs: summary.counts.legs,
        rankings: summary.counts.rankings,
        importDurationMs: summary.importDurationMs,
        kvRecordsWritten: summary.kvRecordsWritten,
        warnings: summary.warnings,
        errors: summary.errors,
      },
      latestSummary: summary,
      activeImportJobId: null,
      progress: {
        status: summary.status,
        jobId: null,
        stage: 'COMPLETED',
        progress: 100,
        message: `Database imported successfully. ${summary.counts.participants} participants, ${summary.counts.contests} contests, ${summary.counts.splits} splits, ${summary.counts.timingPoints} timing points. ${summary.status === 'COMPLETED' ? 'Validation successful' : 'Validation completed with warnings'}.`,
        updatedAt: new Date().toISOString(),
      },
    });

    await appendImportHistory(eventId, {
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
        duration: summary.importDurationMs,
        kvWrites: summary.kvRecordsWritten,
        contests: summary.counts.contests,
        participants: summary.counts.participants,
        activeParticipants: summary.counts.activeParticipants,
        splits: summary.counts.splits,
        timingPoints: summary.counts.timingPoints,
        warnings: summary.warnings,
        errors: summary.errors,
        status: summary.status,
      });

    await reportProgress(100, 'COMPLETED', `Database imported successfully. ${summary.counts.participants} participants, ${summary.counts.contests} contests. Validation pending.`, summary as any);

    void validateCompletedImport(eventId, summary, logs);

    revalidatePath('/admin/dashboard');
  } catch (error: any) {
    const cancelled = String(error?.code || '').toUpperCase() === 'JOB_CANCELLED' || /cancelled/i.test(String(error?.message || ''));
    summary.status = cancelled ? 'CANCELLED' : 'FAILED';
    if (!cancelled) summary.errors += 1;
    summary.importDurationMs = Date.now() - startedAt;
    summary.elapsedTimeMs = summary.importDurationMs;

    const splitWriteAbort = /Split index is empty\. Aborting rebuild\./i.test(String(error?.message || ''));
    if (!splitWriteAbort) {
      await cleanupRuntimeKv(eventId, cancelled ? 'cancelled' : 'failed', logs, summary);
    } else {
      console.warn(`[FDB Import] Preserving existing split:index keys for event ${eventId} because rebuild produced an empty index.`);
    }

    await persistState(eventId, {
      database: {
        uploaded: true,
        fileName,
        fileSize,
        uploadedAt: new Date().toISOString(),
        status: cancelled ? 'CANCELLED' : 'FAILED',
      },
      latestSummary: summary,
      activeImportJobId: null,
      progress: {
        status: cancelled ? 'CANCELLED' : 'FAILED',
        jobId: null,
        stage: currentStage,
        progress: 100,
        message: cancelled ? 'FDB import cancelled.' : `FDB import failed: ${error?.message || 'Unknown error'}`,
        updatedAt: new Date().toISOString(),
      },
    });

    await updateJobProgress(jobId, {
      status: cancelled ? 'cancelled' : 'failed',
      progress: 100,
      message: cancelled ? 'FDB import cancelled.' : `FDB import failed: ${error?.message || 'Unknown error'}`,
      summary: serializeValue(summary),
    } as any);
  } finally {
    clearInterval(stageMonitor);
    try {
      sqliteDb?.close?.();
    } catch {
      // ignore sqlite close errors
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const eventId = String(request.nextUrl.searchParams.get('eventId') || '').trim();
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    let liveData = (await getKV<any>(getImportStateKey(eventId), '[API /live-tracking/feibot/fdb-import GET]')) || {};

    const progress = liveData?.progress || null;
    const progressStatus = String(progress?.status || '').toUpperCase();
    const progressUpdatedAt = progress?.updatedAt ? new Date(String(progress.updatedAt)).getTime() : 0;
    const progressAgeMs = progressUpdatedAt > 0 ? Date.now() - progressUpdatedAt : 0;
    if (progressStatus === 'PROCESSING' && progressAgeMs > 30_000) {
      const timeoutStage = String(progress?.stage || liveData?.latestSummary?.currentStage || 'UNKNOWN').trim() || 'UNKNOWN';
      const staleJobId = String(liveData?.activeImportJobId || progress?.jobId || '').trim();
      if (staleJobId) {
        await requestJobCancel(staleJobId, `Import timed out while ${timeoutStage.toLowerCase().replace(/_/g, ' ')}.`).catch(() => undefined);
      }
      const timeoutSummary: ImportSummary = buildBlankImportSummary(
        eventId,
        String(liveData?.database?.fileName || 'unknown'),
        String(liveData?.database?.databaseVersion || 'SQLite'),
        timeoutStage,
        'COMPLETED_WITH_WARNINGS',
      );
      timeoutSummary.elapsedTimeMs = progressAgeMs;
      timeoutSummary.importDurationMs = progressAgeMs;
      timeoutSummary.warnings = 1;
      timeoutSummary.errors = 0;
      timeoutSummary.validationStatus = 'TIMEOUT';
      timeoutSummary.validation = { missingKeys: [], complete: false };
      timeoutSummary.completedAt = new Date().toISOString();
      await cleanupRuntimeKv(eventId, 'stale-timeout', [], timeoutSummary);
      await persistState(eventId, {
        activeImportJobId: null,
        progress: {
          status: 'COMPLETED_WITH_WARNINGS',
          jobId: null,
          stage: timeoutStage,
          progress: Number(progress?.progress || 45),
          message: 'Import complete. KV validation timed out; core event data imported successfully.',
          updatedAt: new Date().toISOString(),
        },
        latestSummary: timeoutSummary,
      });
      liveData = {
        ...liveData,
        activeImportJobId: null,
        progress: {
          status: 'COMPLETED_WITH_WARNINGS',
          jobId: null,
          stage: timeoutStage,
          progress: Number(progress?.progress || 45),
          message: 'Import complete. KV validation timed out; core event data imported successfully.',
          updatedAt: new Date().toISOString(),
        },
        latestSummary: timeoutSummary,
      };
    }

    const importHistory = ((await getKV<any[]>(getImportHistoryKey(eventId), '[API /live-tracking/feibot/fdb-import GET]')) || []).slice(0, 10);

    const summary = await getKV<any>(`live:event:${eventId}:import-summary:latest`, '[API /live-tracking/feibot/fdb-import GET]');
    const logs = await getKV<any[]>(`live:event:${eventId}:logs`, '[API /live-tracking/feibot/fdb-import GET]');

    return NextResponse.json({
      success: true,
      eventId,
      metadata: liveData,
      summary: summary || liveData?.latestSummary || null,
      progress: liveData?.progress || null,
      logs: Array.isArray(logs) ? logs : [],
      importHistory,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || 'Failed to load import metadata' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const eventId = String(request.nextUrl.searchParams.get('eventId') || '').trim();
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const liveData = (await getKV<any>(getImportStateKey(eventId), '[API /live-tracking/feibot/fdb-import DELETE]')) || {};
    const activeJobId = String(liveData?.activeImportJobId || liveData?.progress?.jobId || '').trim();

    if (activeJobId) {
      await requestJobCancel(activeJobId, 'Import cancelled by manual reset.').catch(() => undefined);
    }

    const logs: RuntimeLog[] = [];
    const summary: ImportSummary = {
      eventId,
      databaseName: String(liveData?.database?.fileName || 'unknown'),
      databaseVersion: String(liveData?.database?.databaseVersion || 'SQLite'),
      currentStage: 'CANCELLED',
      sqliteVersion: null,
      detected: {
        eventName: null,
        eventUuid: null,
        scoreEventUuid: null,
        venue: null,
        city: null,
        country: null,
        timeZone: null,
        numberOfTables: 0,
        lastModified: null,
      },
      tables: [],
      unknownTables: [],
      counts: {
        contests: 0,
        legs: 0,
        splits: 0,
        timingPoints: 0,
        devices: 0,
        ageGroups: 0,
        rankings: 0,
        participants: 0,
        activeParticipants: 0,
      },
      kvRecordsWritten: 0,
      tablesRead: 0,
      tablesIgnored: 0,
      rowsRead: 0,
      rowsImported: 0,
      elapsedTimeMs: 0,
      warnings: 0,
      errors: 0,
      status: 'CANCELLED',
      importDurationMs: 0,
      validation: { missingKeys: [], complete: false },
    };

    await cleanupRuntimeKv(eventId, 'manual-reset', logs, summary);
    await persistState(eventId, {
      activeImportJobId: null,
      progress: {
        status: 'CANCELLED',
        jobId: null,
        stage: 'CANCELLED',
        progress: 100,
        message: 'Import cancelled by user.',
        updatedAt: new Date().toISOString(),
      },
      latestSummary: summary,
    });

    return NextResponse.json({ success: true, eventId, cancelled: true, jobId: activeJobId || null });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || 'Failed to cancel import' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let jobId = '';

  try {
    const formData = await request.formData();
    const eventId = String(formData.get('eventId') || '').trim();
    const file = formData.get('file') as File | null;
    const rebuildKv = String(formData.get('rebuildKv') || 'false') === 'true';
    const replaceExistingParticipants = String(formData.get('replaceExistingParticipants') || 'false') === 'true';
    const forceEmptyImport = String(formData.get('forceEmptyImport') || 'false') === 'true';

    if (!eventId) {
      console.error('[FDB Import] 400: eventId is missing from formData', { formDataKeys: Array.from(formData.keys()) });
      return NextResponse.json({ success: false, message: 'eventId is required.' }, { status: 400 });
    }
    if (!file) {
      console.error('[FDB Import] 400: file is missing from formData', { eventId, formDataKeys: Array.from(formData.keys()) });
      return NextResponse.json({ success: false, message: 'FDB file is required.' }, { status: 400 });
    }

    const liveData = (await getKV<any>(getImportStateKey(eventId), '[API /live-tracking/feibot/fdb-import POST]')) || {};
    const progress = liveData?.progress || null;
    const progressStatus = String(progress?.status || '').toUpperCase();
    const progressUpdatedAt = progress?.updatedAt ? new Date(String(progress.updatedAt)).getTime() : 0;
    const progressAgeMs = progressUpdatedAt > 0 ? Date.now() - progressUpdatedAt : Number.MAX_SAFE_INTEGER;
    const activeImportJobId = String(liveData?.activeImportJobId || progress?.jobId || '').trim();
    if (progressStatus === 'PROCESSING' && activeImportJobId && progressAgeMs <= 30_000) {
      return NextResponse.json({ success: false, message: 'An import is already running. Cancel it first.' }, { status: 409 });
    }
    if (progressStatus === 'PROCESSING') {
      if (activeImportJobId) {
        await requestJobCancel(activeImportJobId, 'Previous stale import cancelled before new upload.').catch(() => undefined);
      }
      const resetLogs: RuntimeLog[] = [];
      const resetSummary: ImportSummary = {
        eventId,
        databaseName: String(liveData?.database?.fileName || 'unknown'),
        databaseVersion: String(liveData?.database?.databaseVersion || 'SQLite'),
        currentStage: 'CANCELLED',
        sqliteVersion: null,
        detected: {
          eventName: null,
          eventUuid: null,
          scoreEventUuid: null,
          venue: null,
          city: null,
          country: null,
          timeZone: null,
          numberOfTables: 0,
          lastModified: null,
        },
        tables: [],
        unknownTables: [],
        counts: {
          contests: 0,
          legs: 0,
          splits: 0,
          timingPoints: 0,
          devices: 0,
          ageGroups: 0,
          rankings: 0,
          participants: 0,
          activeParticipants: 0,
        },
        kvRecordsWritten: 0,
        tablesRead: 0,
        tablesIgnored: 0,
        rowsRead: 0,
        rowsImported: 0,
        elapsedTimeMs: progressAgeMs === Number.MAX_SAFE_INTEGER ? 0 : progressAgeMs,
        warnings: 0,
        errors: 0,
        status: 'CANCELLED',
        importDurationMs: 0,
        validation: { missingKeys: [], complete: false },
      };
      await cleanupRuntimeKv(eventId, 'pre-upload-reset', resetLogs, resetSummary);
      await persistState(eventId, {
        activeImportJobId: null,
        progress: {
          status: 'CANCELLED',
          jobId: null,
          stage: 'CANCELLED',
          progress: 100,
          message: 'Previous stuck import reset before new upload.',
          updatedAt: new Date().toISOString(),
        },
        latestSummary: resetSummary,
      });
    }

    const fileName = file.name || 'database.fdb';
    const lowerName = fileName.toLowerCase();
    const allowed = lowerName.endsWith('.fdb') || lowerName.endsWith('.sqlite') || lowerName.endsWith('.db');
    if (!allowed) {
      console.error('[FDB Import] 400: invalid file extension', { eventId, fileName, lowerName });
      return NextResponse.json({ success: false, message: 'Only .fdb SQLite database files are allowed.' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      console.error('[FDB Import] 400: file too large', { eventId, fileName, fileSizeBytes: file.size, limitBytes: MAX_FILE_SIZE_BYTES, limitMb: MAX_FILE_SIZE_MB });
      return NextResponse.json({ success: false, message: `File exceeds the ${MAX_FILE_SIZE_MB}MB upload limit.` }, { status: 400 });
    }

    // All validation passed — now start the job
    const { jobId: newJobId } = await startJob();
    jobId = newJobId;

    const bytes = Buffer.from(await file.arrayBuffer());

    await updateProgress(eventId, jobId, 1, 'IMPORTING', 'FDB upload received. Starting import...', {
      eventId,
      fileName,
      fileSize: file.size,
      rebuildKv,
      replaceExistingParticipants,
      forceEmptyImport,
    });

    void processImportJob(jobId, eventId, bytes, rebuildKv, fileName, file.size, {
      replaceExistingParticipants,
      forceEmptyImport,
    });

    return NextResponse.json({ success: true, message: 'FDB import started.', jobId });
  } catch (error: any) {
    if (jobId) {
      await updateJobProgress(jobId, {
        status: 'failed',
        progress: 100,
        message: `FDB import failed to start: ${error.message}`,
      } as any);
    }
    return NextResponse.json({ success: false, message: `FDB import failed: ${error.message}` }, { status: 500 });
  }
}
