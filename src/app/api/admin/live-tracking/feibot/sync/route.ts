import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { putKV } from '@/lib/cloudflare/kv';
import { callFeibotAPIWithCredentialFallback } from '@/lib/feibot-integration/api-client';
import { syncFeibotCloudEventInfo } from '@/lib/feibot-integration/cloud-event-sync';
import { syncFeibotLiveTimingToKv } from '@/lib/feibot-integration/live-timing-worker';
import { getEventFeibotUuids, getFeibotRuntimeSecretsAsyncForEvent, resolveFeibotRuntimeEventUuid } from '@/lib/feibot-integration/secure-credentials';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SyncAction = 'config' | 'participants' | 'live-results' | 'leaderboard' | 'race-progress' | 'final-results' | 'everything';

type StepResult = {
  key: string;
  ok: boolean;
  status: 'success' | 'warning' | 'error';
  durationMs: number;
  importedRecords: number;
  warning?: string | null;
  error?: string | null;
  lastSync: string;
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function countRecords(value: any): number {
  if (Array.isArray(value)) return value.length;
  if (value && Array.isArray(value?.data)) return value.data.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 400): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === attempts - 1) break;
      const delay = baseDelayMs * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function resolveDownloadPayload(value: any) {
  const downloadUrl = normalize(value?.download_url || value?.downloadUrl || value?.url || '');
  if (!downloadUrl) return value;
  const response = await fetch(downloadUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to download Feibot payload (${response.status})`);
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    return response.json();
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function runApiStep(params: {
  eventId: string;
  eventUuid: string;
  apiBaseUrl?: string;
  path: string;
  kvSuffix: string;
  label: string;
}) {
  const startedAt = Date.now();
  const runtimeSecrets = await getFeibotRuntimeSecretsAsyncForEvent({
    eventId: params.eventId,
    eventUuid: params.eventUuid,
    credentialType: 'auto',
  });

  console.log('[FEIBOT SYNC][Upstream Request]', {
    eventId: params.eventId,
    eventUuid: params.eventUuid,
    path: params.path,
    credentialSource: runtimeSecrets.resolvedCredentialSource || runtimeSecrets.source,
    selectedMode: runtimeSecrets.selectedMode || null,
    selectedCredentialType: runtimeSecrets.selectedCredentialType || null,
    actualCredentialType: runtimeSecrets.actualCredentialType || null,
    credentialBoundEventUuid: runtimeSecrets.eventUuid || null,
    accessKeyPrefix: runtimeSecrets.accessKey?.substring(0, 20) || null,
  });

  const response = await withRetry(async () => {
    const result = await callFeibotAPIWithCredentialFallback<any>(
      params.path,
      {
        method: 'GET',
        query: { event_uuid: params.eventUuid },
      },
      {
        eventId: params.eventId,
        apiBaseUrl: runtimeSecrets.apiBaseUrl,
        credentialType: runtimeSecrets.credentialType,
      },
    );

    if (!result.ok) {
      const shouldRetry = result.status === 429 || result.status >= 500;
      const error = new Error(`${params.label} failed with HTTP ${result.status}`);
      (error as any).retryable = shouldRetry;
      throw error;
    }

    return result;
  });

  const resolved = await resolveDownloadPayload(response.data);
  const importedRecords = countRecords(resolved);
  const nowIso = new Date().toISOString();

  const payload = {
    eventId: params.eventId,
    eventUuid: params.eventUuid,
    source: 'feibot-cloud-api',
    endpoint: params.path,
    syncedAt: nowIso,
    importedRecords,
    diagnostics: response.diagnostics,
    data: resolved,
  };

  await putKV(`live:event:${params.eventId}:provider:${params.kvSuffix}`, payload, '[admin/feibot/sync]');

  let workerWarning: string | null = null;
  let workerImported = 0;
  let workerStatus: 'success' | 'warning' = 'success';
  if (params.kvSuffix === 'live-results') {
    try {
      const workerResult = await syncFeibotLiveTimingToKv({
        eventId: params.eventId,
        eventUuid: params.eventUuid,
        apiBaseUrl: params.apiBaseUrl || runtimeSecrets.apiBaseUrl,
        sourcePayload: resolved,
        triggeredBy: 'admin-sync:live-results',
      });
      workerImported = Number(workerResult.updatedParticipants || 0);
      if (workerResult.warning) {
        workerWarning = workerResult.warning;
        workerStatus = 'warning';
      }
    } catch (error: any) {
      workerWarning = `Live timing worker failed: ${error?.message || 'unknown error'}`;
      workerStatus = 'warning';
    }
  }

  return {
    key: params.kvSuffix,
    ok: true,
    status: workerStatus,
    durationMs: Date.now() - startedAt,
    importedRecords: Math.max(importedRecords, workerImported),
    warning: workerWarning,
    error: null,
    lastSync: nowIso,
  } as StepResult;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const eventId = normalize(body?.eventId);
    const action = normalize(body?.action || 'everything').toLowerCase() as SyncAction;
    const manualEventUuid = normalize(body?.eventUuid);

    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required.' }, { status: 400 });
    }

    const { eventUuid: cloudEventUuid } = await getEventFeibotUuids(eventId);

    const runtime = await getFeibotRuntimeSecretsAsyncForEvent({
      eventId,
      eventUuid: manualEventUuid || undefined,
      credentialType: 'auto',
    });
    const resolvedRuntime = resolveFeibotRuntimeEventUuid({
      endpoint: '/api/admin/live-tracking/feibot/sync',
      credentialType: runtime.credentialType,
      credentialBoundEventUuid: runtime.eventUuid || null,
      cloudEventUuid,
      manualEventUuid,
      requestedEventUuid: manualEventUuid,
    });
    const eventUuid = resolvedRuntime.resolvedEventUuid || runtime.eventUuid || manualEventUuid || cloudEventUuid;
    if (!eventUuid) {
      return NextResponse.json({ success: false, message: 'Feibot event UUID is not configured for this event.' }, { status: 400 });
    }
    const baseUrl = normalize(runtime.apiBaseUrl || 'https://apicn.feibot.com') || 'https://apicn.feibot.com';

    console.log('[FEIBOT SYNC][Resolved Runtime]', {
      eventId,
      eventUuid,
      resolvedEventUuid: resolvedRuntime.resolvedEventUuid || null,
      cloudEventUuid,
      manualEventUuid: manualEventUuid || null,
      credentialSource: runtime.resolvedCredentialSource || runtime.source,
      selectedMode: runtime.selectedMode || null,
      selectedCredentialType: runtime.selectedCredentialType || null,
      actualCredentialType: runtime.actualCredentialType || null,
      credentialBoundEventUuid: runtime.eventUuid || null,
      accessKeyPrefix: runtime.accessKey?.substring(0, 20) || null,
    });

    const nowIso = new Date().toISOString();
    const steps: StepResult[] = [];

    const runConfigStep = async () => {
      const startedAt = Date.now();
      const result = await syncFeibotCloudEventInfo({
        eventId,
        eventUuid,
        triggeredBy: `admin-sync:${action}`,
      });
      if (!result.success) {
        return {
          key: 'config',
          ok: false,
          status: 'error',
          durationMs: Date.now() - startedAt,
          importedRecords: 0,
          warning: null,
          error: String((result as any)?.errorReport?.reason || 'Config sync failed'),
          lastSync: new Date().toISOString(),
        } as StepResult;
      }

      const contestsCount = Number((result as any)?.snapshot?.contestsCount || 0);
      return {
        key: 'config',
        ok: true,
        status: 'success',
        durationMs: Date.now() - startedAt,
        importedRecords: contestsCount,
        warning: null,
        error: null,
        lastSync: new Date().toISOString(),
      } as StepResult;
    };

    if (action === 'config') {
      const configStep = await runConfigStep();
      steps.push(configStep);
      if (!configStep.ok) {
        return NextResponse.json(
          {
            success: false,
            eventId,
            action,
            message: configStep.error || 'Timing rules import failed.',
            error: 'Timing rules import failed; sync aborted before writing dashboard data.',
            diagnostics: {
              eventUuid,
              resolvedEventUuid: eventUuid,
              apiBaseUrl: baseUrl,
            },
            steps,
          },
          { status: 502 },
        );
      }
    }

    const runStepMap: Record<Exclude<SyncAction, 'everything'>, () => Promise<StepResult>> = {
      config: runConfigStep,
      participants: () => runApiStep({ eventId, eventUuid, apiBaseUrl: baseUrl, path: '/temporary/participantsGetAll', kvSuffix: 'participants', label: 'Participants sync' }),
      'live-results': () => runApiStep({ eventId, eventUuid, apiBaseUrl: baseUrl, path: '/temporary/temporary_ResultDataGetAll', kvSuffix: 'live-results', label: 'Live results sync' }),
      leaderboard: () => runApiStep({ eventId, eventUuid, apiBaseUrl: baseUrl, path: '/api/leaderboardQuery', kvSuffix: 'leaderboard', label: 'Leaderboard sync' }),
      'race-progress': () => runApiStep({ eventId, eventUuid, apiBaseUrl: baseUrl, path: '/api/processQuery', kvSuffix: 'race-progress', label: 'Race progress sync' }),
      'final-results': () => runApiStep({ eventId, eventUuid, apiBaseUrl: baseUrl, path: '/finishResultGetAll', kvSuffix: 'final-results', label: 'Final results sync' }),
    };

    const runOrder: Array<Exclude<SyncAction, 'everything'>> = action === 'everything'
      ? ['config', 'participants', 'live-results', 'leaderboard', 'race-progress', 'final-results']
      : action === 'config'
        ? []
        : [action as Exclude<SyncAction, 'everything'>];

    for (const stepName of runOrder) {
      try {
        steps.push(await runStepMap[stepName]());
      } catch (error: any) {
        steps.push({
          key: stepName,
          ok: false,
          status: 'error',
          durationMs: 0,
          importedRecords: 0,
          warning: null,
          error: error?.message || `${stepName} failed`,
          lastSync: new Date().toISOString(),
        });
      }
    }

    const successCount = steps.filter((step) => step.ok).length;
    const errorCount = steps.filter((step) => !step.ok).length;
    const warningCount = steps.filter((step) => step.status === 'warning').length;

    const dashboard = {
      eventId,
      action,
      source: 'feibot-cloud-api',
      lastSync: nowIso,
      successCount,
      errorCount,
      warningCount,
      importedRecords: steps.reduce((sum, step) => sum + Number(step.importedRecords || 0), 0),
      steps,
      updatedAt: nowIso,
    };

    if (action === 'config' && steps.some((step) => step.key === 'config' && !step.ok)) {
      return NextResponse.json(
        {
          success: false,
          eventId,
          action,
          message: 'Timing rules import failed; sync aborted before writing dashboard data.',
          diagnostics: {
            eventUuid,
            resolvedEventUuid: eventUuid,
            apiBaseUrl: baseUrl,
          },
          steps,
        },
        { status: 502 },
      );
    }

    await putKV(`live:event:${eventId}:provider:sync-dashboard`, dashboard, '[admin/feibot/sync]');

    const db = getFirestoreInstance();
    await db.collection('liveTracking').doc(eventId).set({
      feibotSyncDashboard: {
        ...dashboard,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({
      success: errorCount === 0,
      eventId,
      action,
      dashboard,
      message: errorCount === 0 ? 'Feibot sync completed.' : 'Feibot sync completed with errors.',
    }, { status: errorCount === 0 ? 200 : 207 });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || 'Failed to run Feibot sync.' }, { status: 500 });
  }
}
