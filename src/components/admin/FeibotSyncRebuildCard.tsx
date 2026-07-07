"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw, Shuffle, ShieldCheck, Sparkles, SquareStack, Trash2, Wifi, RadioTower, DatabaseZap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type RuntimeLog = {
  timestamp: string;
  operation: string;
  status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
};

type JsonResponse = Record<string, any> | null;

type KeyValidationRow = {
  key: string;
  exists: boolean;
  recordCount: number;
  error?: string | null;
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function countRecords(value: any): number {
  if (Array.isArray(value)) return value.length;
  if (value && Array.isArray(value?.data)) return value.data.length;
  if (value && Array.isArray(value?.participants)) return value.participants.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

function statusBadge(status: RuntimeLog['status']) {
  switch (status) {
    case 'SUCCESS': return 'default' as const;
    case 'WARNING': return 'secondary' as const;
    case 'ERROR': return 'destructive' as const;
    default: return 'outline' as const;
  }
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { text, json };
}

export default function FeibotSyncRebuildCard({ eventId }: { eventId: string }) {
  const { toast } = useToast();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<JsonResponse>(null);
  const [timingRulesResult, setTimingRulesResult] = useState<JsonResponse>(null);
  const [participantsResult, setParticipantsResult] = useState<JsonResponse>(null);
  const [rebuildResult, setRebuildResult] = useState<JsonResponse>(null);
  const [validationRows, setValidationRows] = useState<KeyValidationRow[]>([]);
  const [logs, setLogs] = useState<RuntimeLog[]>([]);
  const [cloudSyncLogs, setCloudSyncLogs] = useState<RuntimeLog[]>([]);
  const [latestTimingRulesBody, setLatestTimingRulesBody] = useState<string>('');
  const [latestTimingRulesRaw, setLatestTimingRulesRaw] = useState<any>(null);
  const [latestParticipantsRaw, setLatestParticipantsRaw] = useState<any>(null);
  const [latestStatusRaw, setLatestStatusRaw] = useState<any>(null);
  const [latestValidationRaw, setLatestValidationRaw] = useState<any>(null);
  const [autoCloudSyncEnabled, setAutoCloudSyncEnabled] = useState(false);
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<string | null>(null);
  const autoCloudSyncLockRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!eventId) return;
    try {
      const savedEnabled = localStorage.getItem(`feibot:auto-cloud-sync:${eventId}`);
      const savedLastSync = localStorage.getItem(`feibot:last-cloud-sync:${eventId}`);
      if (savedEnabled === '1') setAutoCloudSyncEnabled(true);
      if (savedLastSync) setLastCloudSyncAt(savedLastSync);
    } catch {
      // ignore localStorage errors
    }
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    try {
      localStorage.setItem(`feibot:auto-cloud-sync:${eventId}`, autoCloudSyncEnabled ? '1' : '0');
    } catch {
      // ignore localStorage errors
    }
  }, [autoCloudSyncEnabled, eventId]);

  const addLog = useCallback((operation: string, status: RuntimeLog['status'], message: string) => {
    setLogs((prev) => [
      {
        timestamp: new Date().toISOString(),
        operation,
        status,
        message,
      },
      ...prev,
    ].slice(0, 500));
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ block: 'end' });
  }, [logs]);

  const setLoading = useCallback((action: string | null) => {
    setLoadingAction(action);
  }, []);

  const callJson = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { cache: 'no-store', ...init });
    const { text, json } = await readJsonResponse(response);
    return { response, text, json };
  }, []);

  const mapCloudSyncLogToRuntimeLogs = useCallback((entry: any): RuntimeLog[] => {
    if (!entry) return [];

    const timestamp = String(entry.timestamp || new Date().toISOString());
    const action = String(entry.action || 'sync').toUpperCase();
    const summaryStatus: RuntimeLog['status'] = Number(entry.errorCount || 0) > 0
      ? 'ERROR'
      : Number(entry.warningCount || 0) > 0
        ? 'WARNING'
        : 'SUCCESS';

    const out: RuntimeLog[] = [{
      timestamp,
      operation: `[AUTO SYNC] ${action}`,
      status: summaryStatus,
      message: `Imported ${Number(entry.imported || 0)} · Lookups ${Number(entry.lookupCount || 0)} · Participants ${Number(entry.participantCount || 0)}`,
    }];

    if (entry.cleanupSummary) {
      out.push({
        timestamp,
        operation: '[RESET+SYNC] CLEANUP',
        status: Number(entry.cleanupSummary?.failed || 0) > 0 ? 'WARNING' : 'SUCCESS',
        message: `Scanned ${Number(entry.cleanupSummary?.scanned || 0)} · targeted ${Number(entry.cleanupSummary?.targeted || 0)} · deleted ${Number(entry.cleanupSummary?.deleted || 0)}`,
      });
    }

    if (Array.isArray(entry.steps)) {
      for (const step of entry.steps) {
        out.push({
          timestamp: String(step?.lastSync || timestamp),
          operation: `[${String(step?.key || 'STEP').toUpperCase()}]`,
          status: step?.status === 'error' ? 'ERROR' : step?.status === 'warning' ? 'WARNING' : 'SUCCESS',
          message: step?.error || step?.warning || `Imported ${Number(step?.importedRecords || 0)} records in ${Number(step?.durationMs || 0)}ms`,
        });
      }
    }

    return out;
  }, []);

  const refreshCloudSyncLogs = useCallback(async () => {
    if (!eventId) return;
    try {
      const { response, json } = await callJson(`/api/admin/live-tracking/feibot/sync?eventId=${encodeURIComponent(eventId)}&limit=100`);
      if (!response.ok || !json?.success) return;

      const rawLogs = Array.isArray(json?.logs) ? json.logs : [];
      const nextLogs = rawLogs.flatMap((entry: any) => mapCloudSyncLogToRuntimeLogs(entry));
      setCloudSyncLogs(nextLogs);

      const syncAt = String(json?.lastCloudSyncAt || '').trim();
      if (syncAt) setLastCloudSyncAt(syncAt);
    } catch {
      // ignore background log refresh errors
    }
  }, [callJson, eventId, mapCloudSyncLogToRuntimeLogs]);

  useEffect(() => {
    if (!eventId || !autoCloudSyncEnabled) return;

    void refreshCloudSyncLogs();
    const interval = window.setInterval(() => {
      void refreshCloudSyncLogs();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [autoCloudSyncEnabled, eventId, refreshCloudSyncLogs]);

  const refreshStatus = useCallback(async () => {
    if (!eventId) return;
    setLoading('status');
    addLog('[STATUS]', 'INFO', 'Refreshing provider status...');
    try {
      const { response, json } = await callJson(`/api/live/provider/status?eventId=${encodeURIComponent(eventId)}`);
      setProviderStatus(json);
      setLatestStatusRaw(json);
      if (!response.ok || !json?.success) {
        throw new Error(json?.message || `HTTP ${response.status}`);
      }
      addLog('[STATUS]', 'SUCCESS', 'Provider status refreshed.');
      toast({ title: 'Provider status refreshed', description: 'Latest provider state loaded.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh provider status.';
      addLog('[STATUS]', 'ERROR', message);
      toast({ title: 'Provider status failed', description: message, variant: 'destructive' });
      throw error;
    } finally {
      setLoading(null);
    }
  }, [addLog, callJson, eventId, setLoading, toast]);

  const testTimingRules = useCallback(async () => {
    if (!eventId) return;
    setLoading('timing-rules');
    addLog('[FEIBOT REQUEST]', 'INFO', 'GET /eventConfigFile/timingRulesGet');
    addLog('[FEIBOT REQUEST]', 'INFO', 'Connecting...');
    try {
      const { response, json, text } = await callJson(`/api/live/provider/timing-rules?eventId=${encodeURIComponent(eventId)}`);
      setLatestTimingRulesBody(text);
      setTimingRulesResult(json);
      setLatestTimingRulesRaw(json);
      if (!response.ok || !json?.success) {
        const providerResponse = json?.providerResponse ? `\n${String(json.providerResponse)}` : '';
        const message = `${json?.message || `HTTP ${response.status}`}${providerResponse}`;
        addLog('[FEIBOT RESPONSE]', 'ERROR', `${response.status}`);
        throw new Error(message);
      }
      const timingRules = json?.timingRules || {};
      addLog('[FEIBOT RESPONSE]', 'SUCCESS', String(response.status));
      addLog('[TIMING RULES]', 'SUCCESS', `Contests ${countRecords(timingRules.contests)} · Splits ${countRecords(timingRules.splits)} · Timing Points ${countRecords(timingRules.timingPoints)} · Legs ${countRecords(timingRules.legs)}`);
      toast({ title: 'Timing rules loaded', description: 'Feibot timing rules response captured.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load timing rules.';
      addLog('[FEIBOT RESPONSE]', 'ERROR', message);
      toast({ title: 'Timing rules failed', description: message, variant: 'destructive' });
      throw error;
    } finally {
      setLoading(null);
    }
  }, [addLog, callJson, eventId, setLoading, toast]);

  const testParticipants = useCallback(async () => {
    if (!eventId) return;
    setLoading('participants');
    addLog('[FEIBOT REQUEST]', 'INFO', 'GET /temporary/participantsGetAll');
    try {
      const { response, json } = await callJson(`/api/live/provider/participants?eventId=${encodeURIComponent(eventId)}&refresh=true&raw=1`);
      setParticipantsResult(json);
      setLatestParticipantsRaw(json);
      if (!response.ok || !json?.success) {
        throw new Error(json?.message || `HTTP ${response.status}`);
      }
      addLog('[FEIBOT RESPONSE]', 'SUCCESS', String(response.status));
      addLog('[PARTICIPANTS]', 'SUCCESS', `Participant Count ${countRecords(json?.upstream?.data || json?.participants)} · Download URL ${json?.downloadUrl || '—'}`);
      toast({ title: 'Participants API tested', description: 'Participant download URL and count captured.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to test participants API.';
      addLog('[FEIBOT RESPONSE]', 'ERROR', message);
      toast({ title: 'Participants test failed', description: message, variant: 'destructive' });
      throw error;
    } finally {
      setLoading(null);
    }
  }, [addLog, callJson, eventId, setLoading, toast]);

  const importTimingRules = useCallback(async () => {
    if (!eventId) return;
    setLoading('import');
    addLog('[IMPORT]', 'INFO', 'Connecting...');
    addLog('[IMPORT]', 'INFO', 'Downloading timing rules...');
    addLog('[IMPORT]', 'INFO', 'Parsing contests...');
    addLog('[IMPORT]', 'INFO', 'Parsing timing points...');
    addLog('[IMPORT]', 'INFO', 'Parsing legs...');
    addLog('[IMPORT]', 'INFO', 'Parsing splits...');
    addLog('[IMPORT]', 'INFO', 'Saving...');
    try {
      const { response, json } = await callJson('/api/admin/live-tracking/feibot/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, action: 'config' }),
      });
      if (!response.ok || !json?.success) {
        throw new Error(json?.message || `HTTP ${response.status}`);
      }
      addLog('[IMPORT]', 'SUCCESS', 'Done.');
      setTimingRulesResult(json);
      toast({ title: 'Timing rules imported', description: 'Feibot timing rules saved to Firestore.' });
      await refreshCloudSyncLogs();
      await refreshStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import timing rules.';
      addLog('[IMPORT]', 'ERROR', message);
      toast({ title: 'Import failed', description: message, variant: 'destructive' });
      throw error;
    } finally {
      setLoading(null);
    }
  }, [addLog, callJson, eventId, refreshCloudSyncLogs, refreshStatus, setLoading, toast]);

  const rebuildSplitIndex = useCallback(async () => {
    if (!eventId) return;
    setLoading('rebuild');
    addLog('[REBUILD]', 'INFO', 'Read Firestore timing rules');
    try {
      const { response, json } = await callJson(`/api/live/course-index/${encodeURIComponent(eventId)}`);
      setRebuildResult(json);
      setLatestValidationRaw(json);
      if (!response.ok || !json?.success) {
        throw new Error(json?.message || `HTTP ${response.status}`);
      }
      const splitCount = Number(json?.splitIndex?.splitCount || 0);
      const contestCount = Number(json?.splitIndex?.contestCount || 0);
      addLog('[REBUILD]', 'INFO', `Contest ${contestCount} loaded`);
      addLog('[REBUILD]', 'SUCCESS', `Total splits generated ${splitCount}`);
      if (splitCount <= 0) {
        addLog('[REBUILD]', 'ERROR', 'Split index is empty. Existing KV preserved.');
        throw new Error('Split index is empty. Existing KV preserved.');
      }
      addLog('[KV WRITE]', 'SUCCESS', `live:event:${eventId}:split:index`);
      addLog('[KV VERIFY]', 'SUCCESS', `${splitCount} records verified`);
      toast({ title: 'Split index rebuilt', description: `${splitCount} splits generated and verified.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rebuild split index.';
      addLog('[REBUILD]', 'ERROR', message);
      toast({ title: 'Rebuild failed', description: message, variant: 'destructive' });
      throw error;
    } finally {
      setLoading(null);
    }
  }, [addLog, callJson, eventId, setLoading, toast]);

  const validateKv = useCallback(async () => {
    if (!eventId) return;
    setLoading('validate');
    addLog('[VALIDATE]', 'INFO', 'Reading KV snapshots...');
    try {
      const [statusRes, timingRes] = await Promise.all([
        callJson(`/api/live/provider/status?eventId=${encodeURIComponent(eventId)}`),
        callJson(`/api/live/course-index/${encodeURIComponent(eventId)}`),
      ]);
      const statusJson = statusRes.json;
      const timingJson = timingRes.json;
      setProviderStatus(statusJson);
      setLatestStatusRaw(statusJson);
      setLatestValidationRaw(timingJson);

      const rows: KeyValidationRow[] = [
        {
          key: `live:event:${eventId}:config`,
          exists: Boolean(statusJson?.providerConfig),
          recordCount: countRecords(statusJson?.providerConfig),
        },
        {
          key: `live:event:${eventId}:contest:index`,
          exists: Boolean(timingJson?.contestIndex),
          recordCount: countRecords(timingJson?.contestIndex),
        },
        {
          key: `live:event:${eventId}:timingPoint:index`,
          exists: Boolean(timingJson?.timingPointIndex),
          recordCount: countRecords(timingJson?.timingPointIndex),
        },
        {
          key: `live:event:${eventId}:split:index`,
          exists: Boolean(timingJson?.splitIndex && Number(timingJson?.splitIndex?.splitCount || 0) > 0),
          recordCount: Number(timingJson?.splitIndex?.splitCount || 0),
          error: Number(timingJson?.splitIndex?.splitCount || 0) <= 0 ? 'Split index is empty' : null,
        },
      ];

      setValidationRows(rows);
      rows.forEach((row) => {
        addLog('[VALIDATE]', row.exists ? 'SUCCESS' : 'ERROR', `${row.key} · ${row.exists ? 'OK' : row.error || 'Missing'} · ${row.recordCount} records`);
      });
      toast({ title: 'KV validated', description: 'Latest KV snapshots were inspected.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate KV.';
      addLog('[VALIDATE]', 'ERROR', message);
      toast({ title: 'KV validation failed', description: message, variant: 'destructive' });
      throw error;
    } finally {
      setLoading(null);
    }
  }, [addLog, callJson, eventId, setLoading, toast]);

  const runFullRebuild = useCallback(async () => {
    setLoading('full-rebuild');
    addLog('[FULL REBUILD]', 'INFO', 'Starting full rebuild...');
    try {
      await importTimingRules();
      await rebuildSplitIndex();
      await validateKv();
      await refreshStatus();
      addLog('[FULL REBUILD]', 'SUCCESS', 'Summary complete.');
      toast({ title: 'Full rebuild completed', description: 'Timing rules imported, KV rebuilt, and status refreshed.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Full rebuild failed.';
      addLog('[FULL REBUILD]', 'ERROR', message);
      toast({ title: 'Full rebuild failed', description: message, variant: 'destructive' });
      throw error;
    } finally {
      setLoading(null);
    }
  }, [addLog, importTimingRules, rebuildSplitIndex, refreshStatus, setLoading, toast, validateKv]);

  const runManualCloudSync = useCallback(async (silent = false) => {
    if (!eventId) return;
    if (autoCloudSyncLockRef.current) return;

    autoCloudSyncLockRef.current = true;
    if (!silent) setLoading('manual-cloud-sync');
    addLog('[CLOUD SYNC]', 'INFO', 'Starting manual cloud sync...');

    try {
      const { response, json } = await callJson('/api/admin/live-tracking/feibot/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          action: 'everything',
        }),
      });

      if (!response.ok || !json?.success) {
        throw new Error(json?.message || `HTTP ${response.status}`);
      }

      const nowIso = new Date().toISOString();
      setLastCloudSyncAt(nowIso);
      try {
        localStorage.setItem(`feibot:last-cloud-sync:${eventId}`, nowIso);
      } catch {
        // ignore localStorage errors
      }

      const dashboard = json?.dashboard || {};
      const warnings = Number(dashboard?.warningCount || 0);
      const errors = Number(dashboard?.errorCount || 0);
      const participantCount = Number(json?.participantCount ?? dashboard?.participantCount ?? dashboard?.diagnostics?.imported ?? 0);
      const imported = Number(json?.imported ?? dashboard?.imported ?? participantCount ?? 0);
      const lookupCount = Number(json?.lookupCount ?? dashboard?.lookupCount ?? dashboard?.diagnostics?.lookupWrites ?? 0);
      const statusType: RuntimeLog['status'] = errors > 0 ? 'ERROR' : warnings > 0 ? 'WARNING' : 'SUCCESS';
      addLog('[CLOUD SYNC]', statusType, `Completed · Participant Count ${participantCount} · Imported ${imported} · Lookups ${lookupCount} · Warnings ${warnings} · Errors ${errors}`);

      const summary = json?.diagnostics || dashboard?.diagnostics || null;
      if (summary) {
        addLog(
          '[IMPORT SUMMARY]',
          'INFO',
          `Downloaded ${Number(summary?.downloaded || 0)} · Imported ${Number(summary?.imported || imported || 0)} · Participant KV Writes ${Number(summary?.participantKvWrites || participantCount || 0)} · Lookup Writes ${Number(summary?.lookupWrites || lookupCount || 0)} · Skipped ${Number(summary?.skipped || 0)} · Duration ${Number(summary?.durationMs || 0)}ms`,
        );
      }

      const configStep = Array.isArray(dashboard?.steps) ? dashboard.steps.find((step: any) => step?.key === 'config') : null;
      const duplicateWarning = String(configStep?.warning || '').trim();
      if (duplicateWarning) {
        addLog('[DUPLICATE CHECK]', 'WARNING', duplicateWarning);
      }

      if (!silent) {
        toast({
          title: 'Manual cloud sync completed',
          description: `Participant Count ${participantCount}${lookupCount ? ` · Lookup Writes ${lookupCount}` : ''}${warnings ? ` · ${warnings} warnings` : ''}.`,
        });
      }

      await refreshCloudSyncLogs();
      await refreshStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Manual cloud sync failed.';
      addLog('[CLOUD SYNC]', 'ERROR', message);
      if (!silent) {
        toast({ title: 'Manual cloud sync failed', description: message, variant: 'destructive' });
      }
      throw error;
    } finally {
      if (!silent) setLoading(null);
      autoCloudSyncLockRef.current = false;
    }
  }, [addLog, callJson, eventId, refreshCloudSyncLogs, refreshStatus, setLoading, toast]);

  useEffect(() => {
    if (!eventId || !autoCloudSyncEnabled) return;
    const initial = setTimeout(() => {
      void runManualCloudSync(true);
    }, 10_000);
    const interval = setInterval(() => {
      void runManualCloudSync(true);
    }, 120_000);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [autoCloudSyncEnabled, eventId, runManualCloudSync]);

  const hardResetAndFreshCloudSync = useCallback(async () => {
    if (!eventId) return;
    setLoading('hard-reset-sync');
    addLog('[RESET+SYNC]', 'INFO', 'Clearing old Feibot live:event keys...');
    try {
      const { response, json } = await callJson('/api/admin/live-tracking/feibot/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          action: 'everything',
          clearFeibotLiveEvent: true,
        }),
      });

      if (!response.ok || !json?.success) {
        throw new Error(json?.message || `HTTP ${response.status}`);
      }

      const cleanup = json?.dashboard?.cleanupSummary || null;
      if (cleanup) {
        addLog(
          '[RESET+SYNC]',
          cleanup.failed > 0 ? 'WARNING' : 'SUCCESS',
          `Cleanup scanned ${Number(cleanup.scanned || 0)} keys · targeted ${Number(cleanup.targeted || 0)} · deleted ${Number(cleanup.deleted || 0)}${Number(cleanup.failed || 0) > 0 ? ` · failed ${Number(cleanup.failed || 0)}` : ''}`,
        );
      }

      const configStep = Array.isArray(json?.dashboard?.steps)
        ? json.dashboard.steps.find((step: any) => step?.key === 'config')
        : null;

      const duplicateWarning = String(configStep?.warning || '').trim();
      if (duplicateWarning) {
        addLog('[DUPLICATE CHECK]', 'WARNING', duplicateWarning);
      } else {
        addLog('[DUPLICATE CHECK]', 'SUCCESS', 'No participant_uuid duplicates reported in cloud import step.');
      }

      addLog('[RESET+SYNC]', 'SUCCESS', 'Fresh cloud sync completed.');
      await refreshCloudSyncLogs();
      await refreshStatus();
      toast({
        title: 'Hard reset + cloud sync complete',
        description: 'Old Feibot live:event data was cleared and rebuilt from cloud.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Hard reset cloud sync failed.';
      addLog('[RESET+SYNC]', 'ERROR', message);
      toast({ title: 'Hard reset sync failed', description: message, variant: 'destructive' });
      throw error;
    } finally {
      setLoading(null);
    }
  }, [addLog, callJson, eventId, refreshCloudSyncLogs, refreshStatus, setLoading, toast]);

  const visibleRuntimeLogs = useMemo(() => {
    const combined = autoCloudSyncEnabled ? [...cloudSyncLogs, ...logs] : logs;
    const seen = new Set<string>();
    return [...combined]
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
      .filter((log) => {
        const key = `${log.timestamp}|${log.operation}|${log.status}|${log.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 500);
  }, [autoCloudSyncEnabled, cloudSyncLogs, logs]);

  const statusData = useMemo(() => providerStatus || latestStatusRaw, [latestStatusRaw, providerStatus]);

  return (
    <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-50 via-background to-background">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-5 w-5 text-emerald-600" />
          <CardTitle>Feibot Sync &amp; Rebuild</CardTitle>
          <Badge variant={statusData?.providerConnected ? 'default' : 'outline'}>
            {statusData?.providerConnected ? 'Provider Connected' : 'Provider Offline'}
          </Badge>
        </div>
        <CardDescription>
          Import timing rules, rebuild KV snapshots safely, validate the runtime keys, and inspect provider diagnostics without opening server logs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {statusData?.providerConnected === false ? (
          <Alert variant="destructive">
            <AlertDescription>Provider is not connected. Verify the event UUID, access key binding, and Feibot feature enablement.</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusTile label="Credential Source" value={normalize(statusData?.credentialSource || '—')} />
          <StatusTile label="AK Present" value={statusData?.akPresent ? 'Yes' : 'No'} />
          <StatusTile label="SK Present" value={statusData?.skPresent ? 'Yes' : 'No'} />
          <StatusTile label="Last Authentication" value={normalize(statusData?.lastAuthentication || '—')} />
          <StatusTile label="Timing Rules Available" value={statusData?.timingRulesAvailable ? 'Yes' : 'No'} />
          <StatusTile label="Participants Available" value={statusData?.participantsAvailable ? 'Yes' : 'No'} />
          <StatusTile label="Contest Count" value={String(statusData?.contestCount ?? '—')} />
          <StatusTile label="Split Count" value={String(statusData?.splitCount ?? '—')} />
        </div>

        <div className="rounded-xl border bg-background p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Cloud Sync Controls</div>
              <div className="text-xs text-muted-foreground">Auto sync is optional. You can keep it OFF and run manual sync anytime.</div>
              {autoCloudSyncEnabled ? (
                <div className="mt-1 text-xs text-emerald-600">Auto sync is ON — latest cloud sync logs will appear below.</div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={autoCloudSyncEnabled ? 'default' : 'outline'}>
                {autoCloudSyncEnabled ? 'Auto Sync: ON' : 'Auto Sync: OFF'}
              </Badge>
              <Switch checked={autoCloudSyncEnabled} onCheckedChange={setAutoCloudSyncEnabled} aria-label="Toggle Feibot auto cloud sync" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div>Last cloud sync: {lastCloudSyncAt ? new Date(lastCloudSyncAt).toLocaleString() : '—'}</div>
            <div>{autoCloudSyncEnabled ? 'Auto interval: 2 minutes' : 'Manual mode enabled'}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => { void Promise.resolve(runManualCloudSync(false)).catch(() => undefined); }}
              disabled={loadingAction === 'manual-cloud-sync'}
            >
              {loadingAction === 'manual-cloud-sync' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Manual Sync Now
            </Button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          <ActionCard
            title="Import Timing Rules"
            description="Download the latest timing rules from Feibot and save the imported snapshot into Firestore."
            loading={loadingAction === 'import'}
            action={importTimingRules}
            buttonLabel="Import Timing Rules"
            icon={<DatabaseZap className="h-4 w-4" />}
            progress={[
              'Connecting...',
              'Downloading timing rules...',
              'Parsing contests...',
              'Parsing timing points...',
              'Parsing legs...',
              'Parsing splits...',
              'Saving...',
              'Done.',
            ]}
          />

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <div className="rounded-xl border bg-background p-4 shadow-sm">
                <ActionCard
                  title="Rebuild Split Index"
                  description="Rebuild all KV split maps from Firestore timing rules only. Feibot is not called."
                  loading={loadingAction === 'rebuild'}
                  action={rebuildSplitIndex}
                  buttonLabel="Rebuild Split Index"
                  icon={<Shuffle className="h-4 w-4" />}
                  progress={[
                    'Read Firestore timing rules',
                    'Generate split index',
                    'Generate contest split maps',
                    'Generate leg split maps',
                    'Generate distance lookup',
                    'Generate split lookup',
                    'Write to KV',
                    'Verify KV',
                  ]}
                  hideActionButton
                />
              </div>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rebuild Split Index?</AlertDialogTitle>
                <AlertDialogDescription>This will rebuild the split index from Firestore timing rules and will preserve existing KV if zero splits are generated.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={(e) => { e.preventDefault(); void Promise.resolve(rebuildSplitIndex()).catch(() => undefined); }}>Confirm Rebuild</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <ActionCard
            title="Validate KV"
            description="Inspect provider and timing configuration keys, plus split index count."
            loading={loadingAction === 'validate'}
            action={validateKv}
            buttonLabel="Validate KV"
            icon={<ShieldCheck className="h-4 w-4" />}
            progress={['Reading live:event config', 'Reading contest index', 'Reading timing point index', 'Reading split index', 'Reporting status']}
          />

          <ActionCard
            title="Refresh Provider Status"
            description="Pull the latest provider health snapshot and count availability."
            loading={loadingAction === 'status'}
            action={refreshStatus}
            buttonLabel="Refresh Provider Status"
            icon={<Wifi className="h-4 w-4" />}
            progress={['Reading provider config', 'Reading credentials', 'Reading KV counts', 'Returning status']}
          />

          <ActionCard
            title="Test Timing Rules API"
            description="Call the Feibot timing-rules endpoint directly and inspect the raw JSON payload."
            loading={loadingAction === 'timing-rules'}
            action={testTimingRules}
            buttonLabel="Test Timing Rules API"
            icon={<RadioTower className="h-4 w-4" />}
            progress={['Calling /eventConfigFile/timingRulesGet', 'Capturing provider response', 'Rendering raw JSON']}
          />

          <ActionCard
            title="Test Participants API"
            description="Call participantsGetAll and inspect the returned download URL and participant count."
            loading={loadingAction === 'participants'}
            action={testParticipants}
            buttonLabel="Test Participants API"
            icon={<RefreshCw className="h-4 w-4" />}
            progress={['Calling /temporary/participantsGetAll', 'Reading download_url', 'Counting participants']}
          />

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <div className="rounded-xl border bg-background p-4 shadow-sm">
                <ActionCard
                  title="Full Rebuild"
                  description="Run import, rebuild, validate, refresh, and show a complete summary."
                  loading={loadingAction === 'full-rebuild'}
                  action={runFullRebuild}
                  buttonLabel="Full Rebuild"
                  icon={<SquareStack className="h-4 w-4" />}
                  progress={['Import Timing Rules', 'Rebuild Split Index', 'Validate KV', 'Refresh Status', 'Display summary']}
                  hideActionButton
                />
              </div>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Run Full Rebuild?</AlertDialogTitle>
                <AlertDialogDescription>This will import timing rules, rebuild KV, validate the runtime state, and refresh provider status.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={(e) => { e.preventDefault(); void Promise.resolve(runFullRebuild()).catch(() => undefined); }}>Confirm Full Rebuild</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <div className="rounded-xl border bg-background p-4 shadow-sm">
                <ActionCard
                  title="Hard Reset + Fresh Cloud Sync"
                  description="Delete existing Feibot live:event data for this event, then refetch config, participants, live-results, leaderboard, race-progress, and final-results from cloud."
                  loading={loadingAction === 'hard-reset-sync'}
                  action={hardResetAndFreshCloudSync}
                  buttonLabel="Hard Reset + Sync"
                  icon={<RefreshCw className="h-4 w-4" />}
                  progress={['List live:event Feibot keys', 'Delete old keys', 'Run cloud sync', 'Check duplicate diagnostics', 'Refresh provider status']}
                  hideActionButton
                />
              </div>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete old Feibot live:event data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action clears old Feibot live:event keys for this event and immediately rebuilds them from cloud.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={(e) => { e.preventDefault(); void Promise.resolve(hardResetAndFreshCloudSync()).catch(() => undefined); }}>Confirm Hard Reset + Sync</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <JsonViewer title="Timing Rules API Response" json={timingRulesResult} rawText={latestTimingRulesBody} countLabel={timingRulesResult?.timingRules ? `${countRecords(timingRulesResult.timingRules.contests)} contests · ${countRecords(timingRulesResult.timingRules.splits)} splits · ${countRecords(timingRulesResult.timingRules.timingPoints)} timing points · ${countRecords(timingRulesResult.timingRules.legs)} legs` : undefined} />
          <JsonViewer title="Participants API Response" json={participantsResult} rawText={participantsResult?.downloadUrl || latestParticipantsRaw ? JSON.stringify(latestParticipantsRaw || participantsResult, null, 2) : ''} countLabel={participantsResult?.downloadUrl ? 'Download URL captured' : undefined} />
          <JsonViewer title="Provider Status" json={statusData} rawText={JSON.stringify(latestStatusRaw || statusData || {}, null, 2)} countLabel={statusData ? `${String(statusData?.contestCount ?? 0)} contests · ${String(statusData?.splitCount ?? 0)} splits` : undefined} />
          <JsonViewer title="Latest Rebuild Result" json={rebuildResult} rawText={JSON.stringify(latestValidationRaw || rebuildResult || {}, null, 2)} countLabel={rebuildResult?.splitIndex ? `${String(rebuildResult?.splitIndex?.splitCount ?? 0)} splits generated` : undefined} />
        </div>

        <div className="rounded-xl border bg-background p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Runtime Logs</div>
              <div className="text-xs text-muted-foreground">Latest 500 logs</div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setLogs([])}>
              <Trash2 className="mr-2 h-4 w-4" />
              Clear
            </Button>
          </div>
          <div className="max-h-[520px] overflow-auto rounded-lg border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="p-2">Timestamp</th>
                  <th className="p-2">Operation</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {visibleRuntimeLogs.length ? visibleRuntimeLogs.map((log, index) => (
                  <tr key={`${log.timestamp}-${index}`} className="border-t">
                    <td className="p-2 font-mono whitespace-nowrap">{log.timestamp}</td>
                    <td className="p-2 font-mono">{log.operation}</td>
                    <td className="p-2"><Badge variant={statusBadge(log.status)}>{log.status}</Badge></td>
                    <td className="p-2 break-words">{log.message}</td>
                  </tr>
                )) : (
                  <tr><td className="p-4 text-muted-foreground" colSpan={4}>No runtime logs yet.</td></tr>
                )}
              </tbody>
            </table>
            <div ref={logsEndRef} />
          </div>
        </div>

        {validationRows.length ? (
          <div className="rounded-xl border bg-background p-4 space-y-3">
            <div className="text-sm font-semibold">KV Validation</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {validationRows.map((row) => (
                <div key={row.key} className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground break-all">{row.key}</div>
                  <div className="mt-1 text-sm font-medium">{row.exists ? 'Exists' : 'Missing'}</div>
                  <div className="text-xs text-muted-foreground">Record Count: {row.recordCount}</div>
                  {row.error ? <div className="mt-1 text-xs text-destructive">ERROR: {row.error}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold break-words">{value}</div>
    </div>
  );
}

function ActionCard({
  title,
  description,
  loading,
  action,
  buttonLabel,
  icon,
  progress,
  hideActionButton,
}: {
  title: string;
  description: string;
  loading: boolean;
  action: () => Promise<void> | void;
  buttonLabel: string;
  icon: React.ReactNode;
  progress: string[];
  hideActionButton?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-background p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        {progress.map((item) => <div key={item}>• {item}</div>)}
      </div>
      {!hideActionButton ? (
        <Button type="button" className="w-full" variant="outline" onClick={() => { void Promise.resolve(action()).catch(() => undefined); }} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {buttonLabel}
        </Button>
      ) : null}
    </div>
  );
}

function JsonViewer({
  title,
  json,
  rawText,
  countLabel,
}: {
  title: string;
  json: any;
  rawText?: string;
  countLabel?: string;
}) {
  const pretty = useMemo(() => {
    if (!json) return rawText || '';
    try {
      return JSON.stringify(json, null, 2);
    } catch {
      return rawText || String(json);
    }
  }, [json, rawText]);

  return (
    <div className="rounded-xl border bg-background p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {countLabel ? <div className="text-xs text-muted-foreground">{countLabel}</div> : null}
        </div>
      </div>
      <Textarea readOnly value={pretty || '—'} rows={14} className="font-mono text-xs" />
    </div>
  );
}
