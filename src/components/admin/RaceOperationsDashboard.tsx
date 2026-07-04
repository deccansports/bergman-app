'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  Clock,
  Database,
  Flag,
  RefreshCw,
  ShieldAlert,
  Users,
  Zap,
} from 'lucide-react';

interface RaceOperationsDashboardProps {
  eventId: string;
  eventName?: string;
  eventDate?: string;
  provider?: any;
  participants?: any;
  contests?: any[];
  overview?: any;
  contestMappings?: any[];
  recentActivity?: any[];
  alerts?: any;
  estimatedStart?: string;
  onRefresh?: () => void;
  onAction?: (actionId: string) => void;
  isLoading?: boolean;
}

type RacePhase = 'registration' | 'configuration' | 'import_complete' | 'waiting' | 'live' | 'finishing' | 'completed';

interface ContestMappingRow {
  ticketId?: string;
  bergmanTicket: string;
  contestUuid?: string;
  feibotContest: string;
  providerContestUuid?: string;
  status: boolean;
  ignored?: boolean;
  athletes: number;
}

const phaseLabels: Record<RacePhase, string> = {
  registration: 'Registration',
  configuration: 'Configuration',
  import_complete: 'Import Complete',
  waiting: 'Waiting For Race',
  live: 'Live',
  finishing: 'Finishing',
  completed: 'Completed',
};

const asNumber = (value: any): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const asCount = (value: any): number => {
  if (Array.isArray(value)) return value.length;
  return asNumber(value);
};

const isCompleteStatus = (value: any): boolean => {
  const s = String(value || '').trim().toLowerCase();
  return ['ok', 'pass', 'connected', 'complete', 'completed', 'enabled', 'running', 'live', 'verified', 'healthy', 'online'].includes(s);
};

const formatDateTime = (value: any): string => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
};

function to24HourTime(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match12 = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)$/i);
  if (match12) {
    let hour = Number(match12[1] || 0);
    const minute = Number(match12[2] || 0);
    const second = Number(match12[3] || 0);
    const period = String(match12[4] || '').toUpperCase();
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  }

  const match24 = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?$/);
  if (!match24) return raw;
  const hour = Number(match24[1] || 0);
  const minute = Number(match24[2] || 0);
  const second = Number(match24[3] || 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function mergeRaceDateTime(raceDate: any, startTime: any) {
  const dateRaw = String(raceDate || '').trim();
  const timeRaw = to24HourTime(String(startTime || ''));
  if (!dateRaw || !timeRaw) return null;

  const dateMatch = dateRaw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) return null;
  return `${dateMatch[1]}T${timeRaw}`;
}

const formatTimeAgo = (value: any): string => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const diff = Math.max(0, Date.now() - d.getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day ago`;
};

function getRacePhaseFromState(race: any, tracking: any, provider: any, imports: any): RacePhase {
  const raceStatus = String(race?.status || '').toLowerCase();
  if (['completed', 'complete', 'archived'].includes(raceStatus)) return 'completed';
  if (['finishing', 'closing'].includes(raceStatus)) return 'finishing';
  if (['live', 'running', 'in_progress'].includes(raceStatus) || asNumber(tracking?.readsPerMinute) > 0) return 'live';

  const hasCloudEvent = !!(provider?.cloudEventUuid || provider?.eventUuid || provider?.cloud?.eventUuid);
  const participantsImported = isCompleteStatus(imports?.participants?.status) || asNumber(imports?.participants?.count) > 0 || asNumber(provider?.cloud?.participants) > 0;
  const timingRulesImported = isCompleteStatus(imports?.timingRules?.status) || provider?.timingRulesImported;

  if (!hasCloudEvent) return 'configuration';
  if (!participantsImported) return 'import_complete';
  if (!timingRulesImported) return 'waiting';
  return 'waiting';
}

export function RaceOperationsDashboard({
  eventId,
  eventName,
  eventDate,
  provider,
  participants,
  contests = [],
  overview,
  contestMappings,
  recentActivity,
  alerts,
  estimatedStart,
  onRefresh,
  onAction,
  isLoading,
}: RaceOperationsDashboardProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    performance: false,
    provider: false,
    infrastructure: false,
    contestDetails: true,
    alerts: false,
  });

  const resolvedProvider = useMemo(() => provider || overview?.provider || {}, [overview?.provider, provider]);
  const resolvedRace = overview?.race || {};
  const resolvedParticipants = participants || overview?.participants || {};
  const resolvedTracking = overview?.tracking || {};
  const resolvedImports = overview?.imports || {};
  const resolvedTimingConfiguration = overview?.timingConfiguration || resolvedProvider?.timingConfiguration || resolvedImports?.timingRules || null;
  const resolvedSyncEngine = overview?.syncEngine || {};
  const resolvedLeaderboards = overview?.leaderboards || {};
  const resolvedReplay = overview?.replay || {};
  const resolvedPublicTracking = overview?.publicTracking || resolvedRace?.publicTracking || {};
  const resolvedCloudflare = overview?.cloudflare || {};
  const resolvedStorage = overview?.storage || {};
  const resolvedPerformance = overview?.performance || {};

  const providerName = resolvedProvider?.name || resolvedProvider?.provider || 'Unknown';
  const authenticationStatus = String(resolvedProvider?.authenticationState?.status || resolvedProvider?.authentication || '').toLowerCase();
  const authLastSuccessMs = (() => {
    const raw = resolvedProvider?.authenticationState?.lastSuccess || resolvedProvider?.lastSuccessfulAuthentication || null;
    const ms = raw ? Date.parse(String(raw)) : NaN;
    return Number.isFinite(ms) ? ms : 0;
  })();
  const authLastFailureMs = (() => {
    const raw = resolvedProvider?.authenticationState?.lastFailure || resolvedProvider?.lastFailure || null;
    const ms = raw ? Date.parse(String(raw)) : NaN;
    return Number.isFinite(ms) ? ms : 0;
  })();
  const authFailureAfterSuccess = authLastFailureMs > 0 && (authLastSuccessMs === 0 || authLastFailureMs > authLastSuccessMs);
  const authenticationDone =
    ['verified', 'pass', 'ok', 'connected'].includes(authenticationStatus)
    || (authLastSuccessMs > 0 && !authFailureAfterSuccess)
    || isCompleteStatus(resolvedProvider?.cloudApi?.status)
    || isCompleteStatus(resolvedProvider?.diagnostics?.cloudApi);
  const providerConnectedDone =
    isCompleteStatus(resolvedProvider?.status)
    || authenticationDone
    || isCompleteStatus(resolvedProvider?.cloudApi?.status)
    || isCompleteStatus(resolvedProvider?.diagnostics?.cloudApi);

  const mappingRows = useMemo<ContestMappingRow[]>(() => {
    const source =
      (Array.isArray(contestMappings) && contestMappings) ||
      (Array.isArray(resolvedParticipants?.contestMappings) && resolvedParticipants.contestMappings) ||
      (Array.isArray(overview?.participants?.contestMappings) && overview.participants.contestMappings) ||
      [];

    if (source.length > 0) {
      return source.map((row: any) => {
        const ignored = row?.ignored === true || String(row?.status || '').toLowerCase() === 'ignored' || String(row?.mode || '').toLowerCase() === 'ignored';
        const mapped = !ignored && !!(row?.mapped || row?.isMapped || row?.contestUuid || row?.feibotContest || row?.providerContest);
        const ticketId = row?.ticketId || row?.ticketUuid || '';
        const ticketName = row?.ticketName || row?.bergmanTicket || row?.registrationCategory || row?.category || ticketId || 'Unknown Ticket';
        const contestUuid = row?.contestUuid || row?.providerContestUuid || '';
        const contestName = row?.contestName || row?.feibotContest || row?.providerContest || row?.mappedContest || '';
        return {
          ticketId,
          bergmanTicket: ticketName,
          contestUuid,
          feibotContest: contestName,
          providerContestUuid: row?.providerContestUuid || contestUuid || '',
          status: mapped,
          ignored,
          athletes: asNumber(row?.athletes || row?.count || 0),
        };
      });
    }

    return (Array.isArray(contests) ? contests : []).map((c: any) => ({
      ticketId: c?.ticketId || c?.ticketUuid || '',
      bergmanTicket: c?.ticketName || c?.name || c?.category || c?.ticketId || 'Unknown Ticket',
      contestUuid: c?.contestUuid || c?.uuid || c?.providerContestUuid || '',
      feibotContest: c?.mappedContestName || c?.contestName || c?.name || '',
      providerContestUuid: c?.providerContestUuid || c?.uuid || '',
      status: !!(c?.mappedContestName || c?.contestUuid || c?.providerContestUuid),
      ignored: false,
      athletes: asNumber(c?.athletes || c?.participants || 0),
    }));
  }, [contestMappings, contests, overview?.participants?.contestMappings, resolvedParticipants?.contestMappings]);

  const actionableMappingRows = mappingRows.filter((m: ContestMappingRow) => m.ignored !== true);
  const mappedCount = actionableMappingRows.filter((m: ContestMappingRow) => m.status).length;
  const unmappedCount = Math.max(actionableMappingRows.length - mappedCount, 0);

  const participantSummary = {
    bergman: asNumber(resolvedParticipants?.registered || resolvedParticipants?.bergmanCount),
    feibot: asNumber(
      resolvedParticipants?.providerCount
      || resolvedProvider?.cloud?.participants
      || resolvedProvider?.cloudParticipants
      || resolvedParticipants?.imported
      || resolvedImports?.participants?.count,
    ),
    imported: asNumber(resolvedParticipants?.imported || resolvedImports?.participants?.count),
    matched: asNumber(resolvedParticipants?.mapped || resolvedParticipants?.mappingSummary?.mapped),
    needsReview: asNumber(resolvedParticipants?.unmatched || resolvedParticipants?.mappingSummary?.unmatched),
    duplicateBibs: asNumber(resolvedParticipants?.duplicates || resolvedParticipants?.mappingSummary?.registrationDuplicates),
    duplicateChips: asNumber(resolvedParticipants?.mappingSummary?.providerChipDuplicates),
    missingChips: asNumber(resolvedParticipants?.missingChips || resolvedParticipants?.mappingSummary?.missingChips),
  };

  const contestAthletesByUuid = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of mappingRows) {
      if (row?.ignored === true || !row?.status) continue;
      const uuid = String(row?.contestUuid || row?.providerContestUuid || '').trim();
      if (!uuid) continue;
      map[uuid] = Number(map[uuid] || 0) + asNumber(row?.athletes || 0);
    }
    return map;
  }, [mappingRows]);

  const contestConfigSummaryByUuid = useMemo(() => {
    const splitCountByContest: Record<string, number> = {};
    const ageGroupCountByContest: Record<string, number> = {};
    const ageGroupLabelsByContest: Record<string, string[]> = {};

    const getContestUuid = (row: any) => String(
      row?.ContestUUID
      || row?.contestUUID
      || row?.contestUuid
      || row?.contest_uuid
      || row?.Contest?.UUID
      || row?.Contest?.uuid
      || row?.contest?.UUID
      || row?.contest?.uuid
      || row?.contestId
      || row?.contest_id
      || '',
    ).trim();

    const pushCounts = (rows: any[], target: Record<string, number>) => {
      for (const row of rows) {
        const uuid = getContestUuid(row);
        if (!uuid) continue;
        target[uuid] = Number(target[uuid] || 0) + 1;
      }
    };

    const toAgeGroupLabel = (row: any): string | null => {
      const explicit = String(row?.name || row?.label || row?.ageGroup || row?.age_group || row?.code || '').trim();
      if (explicit) return explicit;
      const min = Number(row?.minAge ?? row?.fromAge ?? row?.ageFrom ?? row?.min ?? NaN);
      const max = Number(row?.maxAge ?? row?.toAge ?? row?.ageTo ?? row?.max ?? NaN);
      if (Number.isFinite(min) && Number.isFinite(max)) return `${min}-${max}`;
      return null;
    };

    const pushAgeGroupLabels = (rows: any[]) => {
      for (const row of rows) {
        const uuid = getContestUuid(row);
        if (!uuid) continue;
        const label = toAgeGroupLabel(row);
        if (!label) continue;
        const existing = ageGroupLabelsByContest[uuid] || [];
        if (!existing.includes(label)) ageGroupLabelsByContest[uuid] = [...existing, label];
      }
    };

    const collectRows = (source: any) => {
      const splits = [
        ...(Array.isArray(source?.splits) ? source.splits : []),
        ...(Array.isArray(source?.timing_rules?.splits) ? source.timing_rules.splits : []),
        ...(Array.isArray(source?.timings?.splits) ? source.timings.splits : []),
        ...(Array.isArray(source?.timingConfiguration?.splits) ? source.timingConfiguration.splits : []),
        ...(Array.isArray(source?.course?.splits) ? source.course.splits : []),
      ];

      const ageGroups = [
        ...(Array.isArray(source?.ageGroups) ? source.ageGroups : []),
        ...(Array.isArray(source?.timing_rules?.ageGroups) ? source.timing_rules.ageGroups : []),
        ...(Array.isArray(source?.timings?.ageGroups) ? source.timings.ageGroups : []),
        ...(Array.isArray(source?.timingConfiguration?.ageGroups) ? source.timingConfiguration.ageGroups : []),
        ...(Array.isArray(source?.course?.ageGroups) ? source.course.ageGroups : []),
      ];

      return { splits, ageGroups };
    };

    const sources = [
      overview,
      overview?.timings,
      overview?.timingConfiguration,
      overview?.imports?.timingRules,
      provider,
      resolvedProvider,
      resolvedProvider?.timings,
      resolvedProvider?.timingConfiguration,
      resolvedProvider?.cloud,
      resolvedProvider?.cloud?.timingConfiguration,
    ];

    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      const { splits, ageGroups } = collectRows(source);
      pushCounts(splits, splitCountByContest);
      pushCounts(ageGroups, ageGroupCountByContest);
      pushAgeGroupLabels(ageGroups);
    }

    return { splitCountByContest, ageGroupCountByContest, ageGroupLabelsByContest };
  }, [overview, provider, resolvedProvider]);

  const timingSnapshotByUuid = useMemo(() => {
    const contestIndex = resolvedTimingConfiguration?.contestIndex && typeof resolvedTimingConfiguration.contestIndex === 'object'
      ? resolvedTimingConfiguration.contestIndex
      : resolvedTimingConfiguration?.contestByUuid && typeof resolvedTimingConfiguration.contestByUuid === 'object'
        ? resolvedTimingConfiguration.contestByUuid
        : null;
    const contestValues = contestIndex ? Object.values(contestIndex) : [];
    const splitByContest = resolvedTimingConfiguration?.splitsByContest && typeof resolvedTimingConfiguration.splitsByContest === 'object'
      ? resolvedTimingConfiguration.splitsByContest
      : {};
    const ageGroups = Array.isArray(resolvedTimingConfiguration?.ageGroups)
      ? resolvedTimingConfiguration.ageGroups
      : [];

    const splitCountByContest: Record<string, number> = {};
    const ageGroupCountByContest: Record<string, number> = {};
    const ageGroupLabelsByContest: Record<string, string[]> = {};

    for (const contest of contestValues) {
      const contestUuid = String((contest as any)?.contestUuid || (contest as any)?.contest?.contestUuid || (contest as any)?.UUID || (contest as any)?.uuid || '').trim();
      if (!contestUuid) continue;
      splitCountByContest[contestUuid] = Array.isArray((splitByContest as any)?.[contestUuid])
        ? (splitByContest as any)[contestUuid].length
        : Array.isArray((contest as any)?.splits)
          ? (contest as any).splits.length
          : 0;
      ageGroupCountByContest[contestUuid] = ageGroups.length;
      ageGroupLabelsByContest[contestUuid] = ageGroups.map((row: any) => String(row?.name || row?.label || row?.ageGroup || row?.code || '').trim()).filter(Boolean);
    }

    return { splitCountByContest, ageGroupCountByContest, ageGroupLabelsByContest };
  }, [resolvedTimingConfiguration]);

  const readinessChecks = useMemo(() => [
    { label: 'Provider', weight: 10, done: providerConnectedDone },
    { label: 'Authentication', weight: 10, done: authenticationDone },
    { label: 'Cloud Metadata', weight: 10, done: !!(resolvedProvider?.cloudEventUuid || resolvedProvider?.eventUuid || resolvedProvider?.cloud?.eventUuid) },
    { label: 'Contest Mapping', weight: 15, done: mappingRows.length > 0 && unmappedCount === 0 },
    { label: 'Participants', weight: 15, done: isCompleteStatus(resolvedImports?.participants?.status) || participantSummary.imported > 0 },
    { label: 'Chip Assignment', weight: 10, done: participantSummary.imported > 0 && participantSummary.missingChips === 0 && participantSummary.duplicateChips === 0 },
    { label: 'Results', weight: 15, done: isCompleteStatus(resolvedImports?.results?.status) || isCompleteStatus(resolvedProvider?.resultsImported) },
    { label: 'Live Sync', weight: 10, done: isCompleteStatus(resolvedSyncEngine?.state) || asNumber(resolvedTracking?.readsPerMinute) > 0 },
    { label: 'Leaderboards', weight: 5, done: !!(resolvedLeaderboards?.overall || resolvedLeaderboards?.categories || resolvedLeaderboards?.lastUpdate) },
    { label: 'Replay', weight: 5, done: !!(resolvedReplay?.enabled || resolvedProvider?.replayEnabled) },
    { label: 'Public Tracking', weight: 5, done: !!(resolvedPublicTracking?.enabled || resolvedRace?.liveTrackingEnabled) },
  ], [authenticationDone, mappingRows.length, participantSummary.duplicateChips, participantSummary.imported, participantSummary.missingChips, providerConnectedDone, resolvedImports?.participants?.status, resolvedImports?.results?.status, resolvedLeaderboards?.categories, resolvedLeaderboards?.lastUpdate, resolvedLeaderboards?.overall, resolvedPublicTracking?.enabled, resolvedProvider?.cloud?.eventUuid, resolvedProvider?.cloudEventUuid, resolvedProvider?.eventUuid, resolvedProvider?.replayEnabled, resolvedProvider?.resultsImported, resolvedRace?.liveTrackingEnabled, resolvedReplay?.enabled, resolvedSyncEngine?.state, resolvedTracking?.readsPerMinute, unmappedCount]);

  const readiness = readinessChecks.reduce((sum, item) => sum + (item.done ? item.weight : 0), 0);
  const readinessDoneCount = readinessChecks.filter((x) => x.done).length;

  const racePhase = getRacePhaseFromState(resolvedRace, resolvedTracking, resolvedProvider, resolvedImports);

  const timeline = [
    { label: 'Registration', done: participantSummary.bergman > 0 },
    { label: 'Configuration', done: readinessChecks[0].done && readinessChecks[1].done && readinessChecks[2].done },
    { label: 'Contest Mapping', done: readinessChecks[3].done },
    { label: 'Participants', done: readinessChecks[4].done },
    { label: 'Results', done: readinessChecks[6].done },
    { label: 'Live Tracking', done: readinessChecks[7].done },
    {
      label: 'Completed',
      done:
        ['completed', 'complete', 'archived'].includes(String(resolvedRace?.status || '').toLowerCase()) ||
        (participantSummary.imported > 0 && asNumber(resolvedTracking?.finished) >= participantSummary.imported),
    },
  ];

  const nextAction = useMemo(() => {
    if (!readinessChecks[0].done) {
      return { step: 'Connect Provider', reason: 'Provider is not connected.', actionId: 'test-connection', label: 'Test Connection' };
    }
    if (!readinessChecks[1].done) {
      return { step: 'Verify Authentication', reason: 'Credentials are not verified.', actionId: 'test-connection', label: 'Verify Auth' };
    }
    if (!readinessChecks[2].done) {
      return { step: 'Import Metadata', reason: 'Cloud metadata is missing.', actionId: 'import-metadata', label: 'Import Metadata' };
    }
    if (!readinessChecks[4].done) {
      return { step: 'Import Participants', reason: 'Participants have not been imported.', actionId: 'import-participants', label: 'Import Participants' };
    }
    if (!readinessChecks[3].done) {
      return { step: 'Complete Contest Mapping', reason: `${unmappedCount} contest mapping(s) required.`, actionId: 'auto-map', label: 'Auto Map' };
    }
    if (!readinessChecks[6].done) {
      return { step: 'Import Results', reason: 'Participants imported successfully. Results have not been imported.', actionId: 'import-results', label: 'Import Results' };
    }
    if (!readinessChecks[7].done) {
      return { step: 'Start Live Sync', reason: 'Results are ready. Live sync is not running.', actionId: 'start-sync', label: 'Start Live Sync' };
    }
    return { step: 'Monitor Race', reason: 'All critical systems are ready.', actionId: 'refresh', label: 'Refresh Dashboard' };
  }, [readinessChecks, unmappedCount]);

  const alertBucket = alerts || overview?.alerts || {};
  const criticalAlerts = asNumber(alertBucket?.critical) || asNumber(alertBucket?.errors?.length);
  const warningAlerts = asNumber(alertBucket?.warnings) || asNumber(alertBucket?.warning?.length);
  const infoAlerts = asNumber(alertBucket?.information) || asNumber(alertBucket?.info?.length);

  const activityRows = (Array.isArray(recentActivity) && recentActivity) || (Array.isArray(overview?.recentActivity) ? overview.recentActivity : []);

  const systemStatusLabel = criticalAlerts > 0 ? 'Critical' : warningAlerts > 0 ? 'Warning' : 'Healthy';
  const systemStatusTone = criticalAlerts > 0 ? 'text-red-700' : warningAlerts > 0 ? 'text-amber-700' : 'text-green-700';

  const resolvedEstimatedStart = useMemo(() => {
    const raceDate = resolvedRace?.raceDate || eventDate || null;
    const startTime = resolvedRace?.startTime || null;
    const merged = mergeRaceDateTime(raceDate, startTime);
    if (merged) return merged;
    return estimatedStart || resolvedRace?.estimatedStart || raceDate || null;
  }, [estimatedStart, eventDate, resolvedRace?.estimatedStart, resolvedRace?.raceDate, resolvedRace?.startTime]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const quickActions =
    racePhase === 'live' || racePhase === 'finishing'
      ? [
          { id: 'pause-sync', label: 'Pause Sync' },
          { id: 'resume-sync', label: 'Resume Sync' },
          { id: 'generate-leaderboards', label: 'Generate Leaderboards' },
          { id: 'replay', label: 'Replay' },
          { id: 'export-reads', label: 'Export Reads' },
          { id: 'view-logs', label: 'View Logs' },
        ]
      : racePhase === 'completed'
        ? [
            { id: 'final-results', label: 'Generate Final Results' },
            { id: 'export-csv', label: 'Export CSV' },
            { id: 'export-json', label: 'Export JSON' },
            { id: 'archive-event', label: 'Archive Event' },
            { id: 'replay', label: 'Replay' },
          ]
        : [
          { id: 'sync-all', label: 'Sync All' },
            { id: 'test-connection', label: 'Test Connection' },
            { id: 'import-metadata', label: 'Import Metadata' },
            { id: 'import-participants', label: 'Import Participants' },
            { id: 'auto-map', label: 'Auto Map' },
            { id: 'import-results', label: 'Import Results' },
            { id: 'start-sync', label: 'Start Live Sync' },
          ];

  const syncStatus = String(resolvedSyncEngine?.state || resolvedTracking?.status || 'unknown');
  const pollSec = asNumber(resolvedSyncEngine?.pollingIntervalSec || resolvedSyncEngine?.intervalSec || resolvedTracking?.pollingIntervalSec);

  const liveReadsPerMinute = asNumber(resolvedTracking?.readsPerMinute);
  const liveMode = liveReadsPerMinute > 0 || ['live', 'running', 'active'].includes(String(syncStatus).toLowerCase());

  const cloudMetadata = {
    eventUuid: resolvedProvider?.cloudEventUuid || resolvedProvider?.eventUuid || resolvedProvider?.cloud?.eventUuid || '—',
    scoreEventUuid: resolvedProvider?.scoreEventUuid || resolvedProvider?.score?.eventUuid || '—',
    eventName: resolvedRace?.name || eventName || '—',
    provider: providerName,
    lastMetadataSync: resolvedProvider?.lastMetadataSync || resolvedImports?.timingRules?.updatedAt || resolvedProvider?.lastSync || null,
    version: resolvedProvider?.version || resolvedProvider?.metadataVersion || overview?.metadataVersion || '—',
    updatedAt: resolvedProvider?.updatedAt || overview?.lastUpdate || null,
  };

  const contestDetailsSource = (() => {
    const snapshotContests = resolvedTimingConfiguration?.contestIndex && typeof resolvedTimingConfiguration.contestIndex === 'object'
      ? Object.values(resolvedTimingConfiguration.contestIndex)
      : resolvedTimingConfiguration?.contestByUuid && typeof resolvedTimingConfiguration.contestByUuid === 'object'
        ? Object.values(resolvedTimingConfiguration.contestByUuid)
        : [];
    if (snapshotContests.length > 0) return snapshotContests;
    if (Array.isArray(contests) && contests.length > 0) return contests;
    return Array.isArray(resolvedProvider?.cloud?.contestsList) ? resolvedProvider.cloud.contestsList : [];
  })();

  const contestPreviewRows = useMemo(() => {
    const contestMap = resolvedTimingConfiguration?.contestByUuid && typeof resolvedTimingConfiguration.contestByUuid === 'object'
      ? resolvedTimingConfiguration.contestByUuid
      : resolvedTimingConfiguration?.contestIndex && typeof resolvedTimingConfiguration.contestIndex === 'object'
        ? resolvedTimingConfiguration.contestIndex
        : {};
    const splitByContest = resolvedTimingConfiguration?.splitsByContest && typeof resolvedTimingConfiguration.splitsByContest === 'object'
      ? resolvedTimingConfiguration.splitsByContest
      : {};
    const timingPointsByContest = resolvedTimingConfiguration?.timingPointsByContest && typeof resolvedTimingConfiguration.timingPointsByContest === 'object'
      ? resolvedTimingConfiguration.timingPointsByContest
      : {};
    const ageGroupsByContest = resolvedTimingConfiguration?.ageGroupsByContest && typeof resolvedTimingConfiguration.ageGroupsByContest === 'object'
      ? resolvedTimingConfiguration.ageGroupsByContest
      : {};

    const contestEntries = Object.values(contestMap);
    const fallbackEntries = contestDetailsSource.length > contestEntries.length
      ? contestDetailsSource
      : contestEntries.length > 0
        ? contestEntries
        : contestDetailsSource;

    return fallbackEntries.map((contest: any, index: number) => {
      const contestUuid = String(contest?.contestUuid || contest?.UUID || contest?.uuid || contest?.contest?.contestUuid || contest?.contest?.UUID || contest?.contest?.uuid || '').trim();
      const contestName = String(contest?.contestName || contest?.contest?.contestName || contest?.contest?.Name || contest?.contest?.name || contest?.name || contest?.label || `Contest ${index + 1}`).trim();
      const source = String(resolvedTimingConfiguration?.source || 'KV').trim() || 'KV';
      const splitRows = Array.isArray(splitByContest?.[contestUuid]) ? splitByContest[contestUuid] : Array.isArray(contest?.splits) ? contest.splits : [];
      const timingPointRows = Array.isArray(timingPointsByContest?.[contestUuid]) ? timingPointsByContest[contestUuid] : Array.isArray(contest?.timingPoints) ? contest.timingPoints : [];
      const ageGroupRows = Array.isArray(ageGroupsByContest?.[contestUuid]) ? ageGroupsByContest[contestUuid] : Array.isArray(contest?.ageGroups) ? contest.ageGroups : [];

      const ageGroupLabels = ageGroupRows.length > 0
        ? ageGroupRows.map((row: any) => String(row?.name || row?.label || row?.ageGroup || row?.code || row).trim()).filter(Boolean)
        : (timingSnapshotByUuid.ageGroupLabelsByContest[contestUuid] || contestConfigSummaryByUuid.ageGroupLabelsByContest[contestUuid] || []);
      const splitLabels = splitRows
        .map((row: any, splitIndex: number) => String(row?.Name || row?.name || row?.Label || row?.label || row?.segment || `Split ${splitIndex + 1}`).trim())
        .filter(Boolean);
      const timingPointLabels = timingPointRows
        .map((row: any, tpIndex: number) => String(row?.displayName || row?.shortName || row?.name || row?.label || row?.providerCode || `Timing Point ${tpIndex + 1}`).trim())
        .filter(Boolean);

      return {
        contestUuid,
        contestName,
        source,
        athletes: asNumber(contestAthletesByUuid[contestUuid] || contest?.athletes || contest?.participants || contest?.count),
        splits: splitRows.length || asNumber(contest?.splitCount || contest?.splitsCount),
        timingPoints: timingPointRows.length || asNumber(contest?.timingPointsCount),
        ageGroups: ageGroupLabels.length || ageGroupRows.length || asNumber(contest?.ageGroupsCount || contest?.ageGroupCount),
        ageGroupLabels,
        splitLabels,
        timingPointLabels,
      };
    });
  }, [contestAthletesByUuid, contestConfigSummaryByUuid.ageGroupLabelsByContest, contestDetailsSource, resolvedTimingConfiguration, timingSnapshotByUuid.ageGroupLabelsByContest]);

  return (
    <div className="space-y-4">
      <Alert className="border-blue-200 bg-blue-50">
        <Flag className="h-4 w-4 text-blue-700" />
        <AlertDescription className="text-blue-900">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <div>
              <div className="text-xs font-semibold">Current Race Status</div>
              <div className="font-semibold">{phaseLabels[racePhase]}</div>
            </div>
            <div>
              <div className="text-xs font-semibold">Next Action</div>
              <div className="font-semibold">{nextAction.label}</div>
            </div>
            <div>
              <div className="text-xs font-semibold">System</div>
              <div className={`font-semibold ${systemStatusTone}`}>{systemStatusLabel}</div>
            </div>
            <div>
              <div className="text-xs font-semibold">Estimated Start</div>
              <div className="font-semibold">{formatDateTime(resolvedEstimatedStart)}</div>
            </div>
          </div>
        </AlertDescription>
      </Alert>

      <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{eventName || resolvedRace?.name || 'Race Operations Dashboard'}</h1>
              <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
                <div>Provider: <span className="font-semibold text-gray-900">{providerName}</span></div>
                <div>Race Status: <span className="font-semibold text-gray-900">{phaseLabels[racePhase]}</span></div>
                <div>Readiness: <span className="font-semibold text-green-700">{readiness}%</span></div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => (onAction ? onAction('sync-all') : onRefresh?.())} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span className="ml-2">Sync All</span>
              </Button>
              <Button size="sm" variant="outline" onClick={onRefresh} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Race Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {timeline.map((item) => (
            <div key={item.label} className="grid grid-cols-[140px_1fr_100px] items-center gap-2">
              <span className="text-gray-700">{item.label}</span>
              <div className="h-3 overflow-hidden rounded bg-gray-200">
                <div className={`h-full ${item.done ? 'bg-emerald-500' : 'bg-gray-300'}`} style={{ width: item.done ? '100%' : '20%' }} />
              </div>
              <span className={`text-xs font-semibold ${item.done ? 'text-emerald-700' : 'text-amber-700'}`}>
                {item.done ? 'Complete' : 'Pending'}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Overall Readiness</CardTitle>
            <CardDescription>{readinessDoneCount} / {readinessChecks.length} checks complete</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="mb-2 flex items-end justify-between">
                <span className="text-3xl font-bold text-blue-600">{readiness}%</span>
                <span className="text-sm text-gray-600">Weighted score</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600" style={{ width: `${readiness}%` }} />
              </div>
            </div>

            <div className="space-y-1 text-sm">
              {readinessChecks.map((check) => (
                <div key={check.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {check.done ? <CheckCircle className="h-4 w-4 text-green-600" /> : <AlertCircle className="h-4 w-4 text-amber-600" />}
                    <span>{check.label}</span>
                  </div>
                  <span className="font-semibold">{check.weight}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next Required Action</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs text-gray-600">Current Step</div>
              <div className="text-lg font-semibold text-gray-900">{nextAction.step}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Reason</div>
              <div className="text-sm text-gray-800">{nextAction.reason}</div>
            </div>
            <Button
              onClick={() => (onAction ? onAction(nextAction.actionId) : onRefresh?.())}
              className="w-full"
            >
              {nextAction.label}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cloud Event Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <div className="rounded border p-2"><span className="text-gray-600">Cloud Event UUID</span><div className="break-all font-mono text-xs">{cloudMetadata.eventUuid}</div></div>
          <div className="rounded border p-2"><span className="text-gray-600">Score Event UUID</span><div className="break-all font-mono text-xs">{cloudMetadata.scoreEventUuid}</div></div>
          <div className="rounded border p-2"><span className="text-gray-600">Event Name</span><div className="font-medium">{cloudMetadata.eventName}</div></div>
          <div className="rounded border p-2"><span className="text-gray-600">Provider</span><div className="font-medium">{cloudMetadata.provider}</div></div>
          <div className="rounded border p-2"><span className="text-gray-600">Last Metadata Sync</span><div className="font-medium">{formatTimeAgo(cloudMetadata.lastMetadataSync)}</div></div>
          <div className="rounded border p-2"><span className="text-gray-600">Version</span><div className="font-medium">{cloudMetadata.version}</div></div>
          <div className="rounded border p-2 md:col-span-2"><span className="text-gray-600">Updated At</span><div className="font-medium">{formatDateTime(cloudMetadata.updatedAt)}</div></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contest Mapping Panel</CardTitle>
          <CardDescription>{mappingRows.length} mapping rows · {mappedCount} mapped · {unmappedCount} required</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {mappingRows.length === 0 ? (
            <Alert className="border-amber-200 bg-amber-50">
              <ShieldAlert className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-800">No mappings found. Mapping Required.</AlertDescription>
            </Alert>
          ) : (
            mappingRows.map((row: ContestMappingRow, idx: number) => (
              <div key={`${row.ticketId || row.bergmanTicket}-${idx}`} className="grid grid-cols-1 items-center gap-2 rounded border p-3 text-sm md:grid-cols-[1.2fr_26px_1.2fr_1fr_120px]">
                <div>
                  <div className="font-medium text-gray-800">{row.bergmanTicket}</div>
                  <div className="text-xs font-mono text-gray-500">{row.ticketId || '—'}</div>
                </div>
                <div className="text-center text-gray-400">↓</div>
                <div className="font-medium text-gray-800">{row.feibotContest || '—'}</div>
                <div className="font-mono text-xs text-gray-600 break-all">{row.providerContestUuid || row.contestUuid || '—'}</div>
                <div className="flex items-center justify-end gap-2">
                  {row.ignored ? (
                    <Badge variant="secondary">Ignored</Badge>
                  ) : row.status ? (
                    <Badge className="bg-emerald-600">Mapped</Badge>
                  ) : (
                    <Badge variant="destructive">Mapping Required</Badge>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="cursor-pointer hover:bg-gray-50" onClick={() => toggleSection('contestDetails')}>
          <div className="flex items-center justify-between">
            <CardTitle>Contest Details</CardTitle>
            <ChevronDown className={`h-5 w-5 transition-transform ${expandedSections.contestDetails ? 'rotate-180' : ''}`} />
          </div>
        </CardHeader>
        {expandedSections.contestDetails && (
          <CardContent className="space-y-2 text-sm">
            {contestDetailsSource.length === 0 ? (
              <div className="text-gray-600">No contest details available.</div>
            ) : (
              contestDetailsSource.map((contest: any, idx: number) => {
                const contestUuid = String(contest?.contestUuid || contest?.providerContestUuid || contest?.uuid || contest?.contest?.contestUuid || contest?.contest?.UUID || '').trim();
                const athletes = asNumber(
                  contest?.athletes
                  || contest?.participants
                  || contest?.count
                  || contestAthletesByUuid[contestUuid],
                );
                const splits = asCount(
                  contest?.splitCount
                  ?? contest?.splitsCount
                  ?? contest?.splits
                  ?? contest?.timingPoints
                  ?? contest?.points
                  ?? timingSnapshotByUuid.splitCountByContest[contestUuid]
                  ?? contestConfigSummaryByUuid.splitCountByContest[contestUuid],
                );
                const ageGroups = asCount(
                  contest?.ageGroupCount
                  ?? contest?.ageGroupsCount
                  ?? contest?.ageGroups
                  ?? contest?.ageGroupNames
                  ?? contest?.ageGroupLabels
                  ?? contest?.subCategories
                  ?? contest?.subcategories
                  ?? timingSnapshotByUuid.ageGroupCountByContest[contestUuid]
                  ?? contestConfigSummaryByUuid.ageGroupCountByContest[contestUuid],
                );
                const ageGroupLabels = (
                  Array.isArray(contest?.ageGroups) ? contest.ageGroups
                    .map((item: any) => String(item?.name || item?.label || item?.ageGroup || item || '').trim())
                    .filter(Boolean)
                  : Array.isArray(contest?.subCategories) ? contest.subCategories.map((item: any) => String(item?.name || item?.label || item || '').trim()).filter(Boolean)
                  : []
                );
                const resolvedAgeGroupLabels = ageGroupLabels.length > 0
                  ? ageGroupLabels
                  : (timingSnapshotByUuid.ageGroupLabelsByContest[contestUuid] || contestConfigSummaryByUuid.ageGroupLabelsByContest[contestUuid] || []);

                return (
                  <div key={`${contest?.name || contest?.ticketName || idx}`} className="grid grid-cols-1 gap-2 rounded border p-2 md:grid-cols-[1fr_120px_100px_120px] md:items-center">
                    <div>
                      <div className="font-medium text-gray-800">{contest?.name || contest?.contestName || contest?.ticketName || contest?.category || `Contest ${idx + 1}`}</div>
                      <div className="font-mono text-xs text-gray-500">{contestUuid || '—'}</div>
                    </div>
                    <div className="text-left md:text-right">
                      <div className="text-xs text-gray-500">Athletes</div>
                      <div className="font-semibold text-indigo-700">{athletes}</div>
                    </div>
                    <div className="text-left md:text-right">
                      <div className="text-xs text-gray-500">Splits</div>
                      <div className="font-semibold text-blue-700">{splits}</div>
                    </div>
                    <div className="text-left md:text-right">
                      <div className="text-xs text-gray-500">Age Groups</div>
                      <div className="font-semibold text-purple-700">{ageGroups}</div>
                      {resolvedAgeGroupLabels.length > 0 ? <div className="text-[10px] text-gray-500">{resolvedAgeGroupLabels.join(', ')}</div> : null}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contest Table Preview (Source: KV)</CardTitle>
          <CardDescription>Normalized timing snapshot used by athlete pages, leaderboard, search, and split rendering.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {contestPreviewRows.length === 0 ? (
            <div className="text-gray-600">No contest preview rows available from KV.</div>
          ) : (
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2 pr-3">Contest UUID</th>
                  <th className="py-2 pr-3">Contest Name</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Athletes</th>
                  <th className="py-2 pr-3">Age Groups</th>
                  <th className="py-2 pr-3">Splits</th>
                  <th className="py-2 pr-3">Timing Points</th>
                  <th className="py-2 pr-3">Rendered</th>
                </tr>
              </thead>
              <tbody>
                {contestPreviewRows.map((row: any) => (
                  <tr key={row.contestUuid} className="border-b last:border-b-0 align-top">
                    <td className="py-2 pr-3 font-mono text-xs text-gray-700">{row.contestUuid || '—'}</td>
                    <td className="py-2 pr-3 font-medium text-gray-900">{row.contestName}</td>
                    <td className="py-2 pr-3"><Badge variant="secondary">{row.source}</Badge></td>
                    <td className="py-2 pr-3 text-gray-700">{row.athletes}</td>
                    <td className="py-2 pr-3 text-gray-700">
                      <div>{row.ageGroups}</div>
                      {row.ageGroupLabels.length > 0 ? <div className="mt-1 text-xs text-gray-500">{row.ageGroupLabels.join(', ')}</div> : null}
                    </td>
                    <td className="py-2 pr-3 text-gray-700">
                      <div>{row.splits}</div>
                      {row.splitLabels.length > 0 ? <div className="mt-1 text-xs text-gray-500">{row.splitLabels.join(', ')}</div> : null}
                    </td>
                    <td className="py-2 pr-3 text-gray-700">
                      <div>{row.timingPoints}</div>
                      {row.timingPointLabels.length > 0 ? <div className="mt-1 text-xs text-gray-500">{row.timingPointLabels.join(', ')}</div> : null}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-500">
                      <div>Contest UUID → timingConfiguration.contestByUuid[{row.contestUuid || 'uuid'}]</div>
                      <div>Splits → splitsByContest[{row.contestUuid || 'uuid'}]</div>
                      <div>Timing Points → timingPointsByContest[{row.contestUuid || 'uuid'}]</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Participant Import Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            {[
              { label: 'Bergman', value: participantSummary.bergman },
              { label: 'Feibot', value: participantSummary.feibot },
              { label: 'Imported', value: participantSummary.imported },
              { label: 'Matched', value: participantSummary.matched },
              { label: 'Needs Review', value: participantSummary.needsReview },
              { label: 'Duplicate Bibs', value: participantSummary.duplicateBibs },
              { label: 'Duplicate Chips', value: participantSummary.duplicateChips },
              { label: 'Missing Chips', value: participantSummary.missingChips },
            ].map((item) => (
              <div key={item.label} className="rounded border bg-gray-50 p-2">
                <div className="text-xs text-gray-600">{item.label}</div>
                <div className="text-xl font-bold text-gray-900">{item.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Zap className="h-5 w-5" />Live Timing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!liveMode ? (
            <div className="rounded border border-blue-200 bg-blue-50 p-3 text-blue-900">
              <div className="font-semibold">Waiting For Race Start</div>
              <div className="text-xs">Estimated start: {formatDateTime(resolvedEstimatedStart)}</div>
            </div>
          ) : (
            <>
              <div className="flex justify-between"><span className="text-gray-600">Athletes Racing</span><span className="font-semibold">{asNumber(resolvedTracking?.activeAthletes)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Finished</span><span className="font-semibold">{asNumber(resolvedTracking?.finished)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">DNF</span><span className="font-semibold">{asNumber(resolvedTracking?.dnf)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">DNS</span><span className="font-semibold">{asNumber(resolvedTracking?.dns)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Last Read</span><span className="font-semibold">{formatTimeAgo(resolvedTracking?.lastRead)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Reads Per Minute</span><span className="font-semibold">{liveReadsPerMinute}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Average Delay</span><span className="font-semibold">{asNumber(resolvedTracking?.averageDelaySec || resolvedTracking?.avgDelaySec || resolvedTracking?.averageDelayMs / 1000).toFixed(1)} sec</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Last Bib</span><span className="font-semibold">{resolvedTracking?.lastBib || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Current Timing Point</span><span className="font-semibold">{resolvedTracking?.currentTimingPoint || '—'}</span></div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-5 w-5" />Live Sync Engine</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-600">Status</span><span className="font-semibold">{syncStatus}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">Polling</span><span className="font-semibold">{pollSec > 0 ? `${pollSec} sec` : '—'}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">Current Cycle</span><span className="font-semibold">#{asNumber(resolvedSyncEngine?.currentCycle || resolvedSyncEngine?.cycle)}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">Queue</span><span className="font-semibold">{asNumber(resolvedSyncEngine?.queueDepth || resolvedSyncEngine?.queue)}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">Last Success</span><span className="font-semibold">{formatTimeAgo(resolvedSyncEngine?.lastSuccessAt || resolvedSyncEngine?.lastSuccess)}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">Retries</span><span className="font-semibold">{asNumber(resolvedSyncEngine?.retries || resolvedSyncEngine?.retryCount)}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">Worker</span><span className="font-semibold">{resolvedCloudflare?.worker || 'unknown'}</span></div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activityRows.length === 0 ? (
              <div className="text-sm text-gray-600">No activity available.</div>
            ) : (
              <div className="space-y-2 text-sm">
                {activityRows.slice(0, 10).map((row: any, idx: number) => (
                  <div key={`activity-${idx}`} className="grid grid-cols-[56px_1fr] gap-3 rounded border p-2">
                    <div className="font-mono text-xs text-gray-600">{row?.time || row?.at ? formatDateTime(row.time || row.at).split(', ')[1] || formatTimeAgo(row.time || row.at) : '—'}</div>
                    <div>
                      <div className="font-medium text-gray-900">{row?.title || row?.action || row?.message || 'Activity'}</div>
                      <div className="text-xs text-gray-600">{row?.detail || row?.description || row?.meta || ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="cursor-pointer hover:bg-gray-50" onClick={() => toggleSection('alerts')}>
            <div className="flex items-center justify-between">
              <CardTitle>Live Alerts</CardTitle>
              <ChevronDown className={`h-5 w-5 transition-transform ${expandedSections.alerts ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border border-red-200 bg-red-50 p-2 text-center"><div className="text-xs text-red-700">Critical</div><div className="text-2xl font-bold text-red-700">{criticalAlerts}</div></div>
              <div className="rounded border border-amber-200 bg-amber-50 p-2 text-center"><div className="text-xs text-amber-700">Warnings</div><div className="text-2xl font-bold text-amber-700">{warningAlerts}</div></div>
              <div className="rounded border border-blue-200 bg-blue-50 p-2 text-center"><div className="text-xs text-blue-700">Information</div><div className="text-2xl font-bold text-blue-700">{infoAlerts}</div></div>
            </div>

            {expandedSections.alerts && (
              <div className="space-y-2">
                {(alertBucket?.errors || []).map((it: any, idx: number) => (
                  <div key={`err-${idx}`} className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{it?.title || it?.message || String(it)}</div>
                ))}
                {(alertBucket?.warning || []).map((it: any, idx: number) => (
                  <div key={`warn-${idx}`} className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">{it?.title || it?.message || String(it)}</div>
                ))}
                {(alertBucket?.info || []).map((it: any, idx: number) => (
                  <div key={`info-${idx}`} className="rounded border border-blue-200 bg-blue-50 p-2 text-blue-800">{it?.title || it?.message || String(it)}</div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Context-aware actions for current race phase</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {quickActions.map((action) => (
              <Button key={action.id} variant="outline" size="sm" className="text-xs" onClick={() => (onAction ? onAction(action.id) : onRefresh?.())}>
                {action.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="cursor-pointer hover:bg-gray-50" onClick={() => toggleSection('performance')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Performance</CardTitle>
            <ChevronDown className={`h-5 w-5 transition-transform ${expandedSections.performance ? 'rotate-180' : ''}`} />
          </div>
        </CardHeader>
        {expandedSections.performance && (
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Average API Response</span><span className="font-semibold">{asNumber(resolvedProvider?.lastApiCall?.responseTimeMs || resolvedPerformance?.providerResponseMs)} ms</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Worker</span><span className="font-semibold">{asNumber(resolvedPerformance?.workerResponseTimeMs || resolvedCloudflare?.workerLatencyMs)} ms</span></div>
            <div className="flex justify-between"><span className="text-gray-600">KV</span><span className="font-semibold">{asNumber(resolvedPerformance?.kvResponseTimeMs)} ms</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Cache Hit</span><span className="font-semibold">{asNumber(resolvedCloudflare?.cacheHitRate)}%</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Requests Today</span><span className="font-semibold">{asNumber(resolvedPerformance?.requestsToday)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Errors Today</span><span className="font-semibold">{asNumber(resolvedPerformance?.errorsToday)}</span></div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="cursor-pointer hover:bg-gray-50" onClick={() => toggleSection('provider')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Provider Details</CardTitle>
            <ChevronDown className={`h-5 w-5 transition-transform ${expandedSections.provider ? 'rotate-180' : ''}`} />
          </div>
        </CardHeader>
        {expandedSections.provider && (
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Provider</span><span className="font-semibold">{providerName}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Status</span><span className="font-semibold">{resolvedProvider?.status || 'unknown'}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Cloud Event UUID</span><span className="font-mono text-xs font-semibold">{cloudMetadata.eventUuid}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Authentication</span><span className="font-semibold">{authenticationStatus || 'pending'}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Last API Endpoint</span><span className="font-mono text-xs font-semibold">{resolvedProvider?.lastApiCall?.endpoint || '—'}</span></div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="cursor-pointer hover:bg-gray-50" onClick={() => toggleSection('infrastructure')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Database className="h-5 w-5" />Infrastructure</CardTitle>
            <ChevronDown className={`h-5 w-5 transition-transform ${expandedSections.infrastructure ? 'rotate-180' : ''}`} />
          </div>
        </CardHeader>
        {expandedSections.infrastructure && (
          <CardContent className="space-y-2 text-sm">
            {[
              {
                name: 'Cloudflare Worker',
                status: resolvedCloudflare?.worker || 'unknown',
                metricLabel: 'Latency',
                metricValue: `${asNumber(resolvedCloudflare?.workerLatencyMs)} ms`,
              },
              {
                name: 'KV',
                status: resolvedCloudflare?.kv || 'unknown',
                metricLabel: 'Objects',
                metricValue: `${asNumber(resolvedCloudflare?.kvObjects)}`,
              },
              {
                name: 'Durable Objects',
                status: resolvedCloudflare?.durableObject || 'unknown',
                metricLabel: 'Connections',
                metricValue: `${asNumber(resolvedCloudflare?.currentSessions)}`,
              },
              {
                name: 'Firestore',
                status: overview?.firestore?.status || 'unknown',
                metricLabel: 'Reads/Writes Today',
                metricValue: `${asNumber(overview?.firestore?.readsToday)} / ${asNumber(overview?.firestore?.writesToday)}`,
              },
              {
                name: 'Storage',
                status: 'online',
                metricLabel: 'KV/R2 Reads',
                metricValue: `${asNumber(resolvedStorage?.kvReads)} / ${asNumber(resolvedStorage?.r2Reads)}`,
              },
            ].map((row) => (
              <div key={row.name} className="grid grid-cols-[1fr_auto] items-center rounded border p-2">
                <div>
                  <div className="font-medium text-gray-900">{row.name}</div>
                  <div className="text-xs text-gray-600">{row.metricLabel}: {row.metricValue}</div>
                </div>
                <Badge variant={isCompleteStatus(row.status) ? 'default' : 'secondary'}>{String(row.status)}</Badge>
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
