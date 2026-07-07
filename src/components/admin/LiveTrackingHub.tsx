"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, ExternalLink, FileText, KeyRound, Loader2, MapPinned, Plus, RefreshCw, Route, Ruler, ShieldCheck, Sparkles, Trash2, Wifi, XCircle, AlertCircle } from 'lucide-react';
import LiveTrackingAdminTab from '@/components/admin/LiveTrackingAdminTab';
import FeibotSyncRebuildCard from '@/components/admin/FeibotSyncRebuildCard';
import FeibotCredentialCards from '@/components/admin/FeibotCredentialCards';
import { ContestMappingPanel } from '@/components/admin/ContestMappingPanel';
import { LegSplitMappingAdmin } from '@/components/admin/LegSplitMappingAdmin';
import CourseMapDialog from '@/components/events/CourseMapDialog';
import { updateTicketDefinitionAction } from '@/lib/actions/ticketActions';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { fetchJsonCached, invalidateJsonCache } from '@/lib/liveTrackingRequestCache';

type CredentialStatus = {
  configured?: boolean;
  source?: 'env' | 'firestore' | 'none';
  encryptionEnabled?: boolean;
  account?: string | null;
  accessKey?: string | null;
  secretKey?: string | null;
  eventUuid?: string | null;
  linkedEventUuid?: string | null;
  cloudEventUuid?: string | null;
  credentialBoundEventUuid?: string | null;
  runtimeEventUuid?: string | null;
  storedBoundEventUuid?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  version?: number;
  lastAuthResult?: string | null;
  lastAuthAt?: string | null;
};

type FeibotEvent = {
  event_uuid: string;
  score_event_uuid?: string | null;
  name: string;
  event_date?: string | null;
};

type BergmanUpcomingEvent = {
  id: string;
  name: string;
  date: string | null;
  status: 'upcoming' | 'live' | 'completed';
  isUpcoming: boolean;
  customSlug?: string | null;
};

type DiagnosticCheck = {
  key: string;
  label: string;
  status: 'PASS' | 'WARNING' | 'FAIL';
  httpStatus: number;
  message?: string;
};

type ProviderConfig = {
  success?: boolean;
  message?: string;
  config?: {
    trackingConfig?: {
      enabled?: boolean;
      showOnHomepage?: boolean;
    };
    feibotConfig?: {
      hasCredentials?: boolean;
      credentialsSource?: string;
      eventUuid?: string;
      resolvedEventUuid?: string;
      legacyEventUuid?: string;
      apiBaseUrl?: string;
      cloud?: { eventUuid?: string; apiBaseUrl?: string; hasCredentials?: boolean; authenticated?: boolean; lastVerifiedAt?: string };
      score?: { eventUuid?: string; overviewUrl?: string; progressUrl?: string; available?: boolean };
      timingRuleSource?: string;
    };
    providerState?: {
      provider?: string;
      status?: string;
      authentication?: string;
      configurationSource?: string;
      timingRulesImported?: boolean;
      participantsImported?: boolean;
      resultsImported?: boolean;
      updatedAt?: string;
    };
  };
};

type CourseSplit = {
  id: string;
  name: string;
  distance: number;
};

type CourseSplitDraft = {
  id: string;
  name: string;
  distance: string;
};

type CourseMapDetails = {
  swimGpxUrl?: string | null;
  bikeGpxUrl?: string | null;
  runGpxUrl?: string | null;
  run1GpxUrl?: string | null;
  run2GpxUrl?: string | null;
  swimDistance?: number | null;
  bikeDistance?: number | null;
  runDistance?: number | null;
  run1Distance?: number | null;
  run2Distance?: number | null;
  swimDescription?: string | null;
  bikeDescription?: string | null;
  runDescription?: string | null;
  run1Description?: string | null;
  run2Description?: string | null;
  swimSplits?: CourseSplit[];
  bikeSplits?: CourseSplit[];
  runSplits?: CourseSplit[];
  run1Splits?: CourseSplit[];
  run2Splits?: CourseSplit[];
  cutoffs?: {
    mode?: 'overall' | 'segment';
    overall?: string | null;
    swim?: string | null;
    bike?: string | null;
    run?: string | null;
    run1?: string | null;
    run2?: string | null;
  } | null;
  generatedPdfUrl?: string | null;
  generatedPdfName?: string | null;
  generatedPdfUpdatedAt?: string | null;
};

type CourseConfig = {
  success?: boolean;
  eventId?: string;
  courseMaps?: {
    swimSplits?: CourseSplit[];
    bikeSplits?: CourseSplit[];
    runSplits?: CourseSplit[];
  };
  ticketDefinitions?: Array<{
    id: string;
    ticketName: string;
    ticketCategory?: string | null;
    description?: string | null;
    order?: number | null;
    cutoffs?: {
      mode?: 'overall' | 'segment';
      overall?: string | null;
      swim?: string | null;
      bike?: string | null;
      run?: string | null;
      run1?: string | null;
      run2?: string | null;
    } | null;
    courseMaps?: CourseMapDetails | null;
  }>;
};

type TimingRulesResponse = {
  success?: boolean;
  timingRules?: {
    contests?: any[];
    splits?: any[];
    timingPoints?: any[];
    ageGroups?: any[];
    legs?: any[];
  };
};

type CourseAssetField = 'swimGpxUrl' | 'bikeGpxUrl' | 'runGpxUrl' | 'run1GpxUrl' | 'run2GpxUrl';
type CourseDistanceField = 'swimDistance' | 'bikeDistance' | 'runDistance' | 'run1Distance' | 'run2Distance';
type CourseDescriptionField = 'swimDescription' | 'bikeDescription' | 'runDescription' | 'run1Description' | 'run2Description';
type CourseSplitField = 'swimSplits' | 'bikeSplits' | 'runSplits' | 'run1Splits' | 'run2Splits';

type CourseAssetLabel = {
  field: CourseAssetField;
  label: string;
  descriptionField: CourseDescriptionField;
  distanceField: CourseDistanceField;
  splitField: CourseSplitField;
};

const COURSE_ASSET_FIELDS: CourseAssetLabel[] = [
  { field: 'swimGpxUrl', label: 'Swim', descriptionField: 'swimDescription', distanceField: 'swimDistance', splitField: 'swimSplits' },
  { field: 'bikeGpxUrl', label: 'Bike', descriptionField: 'bikeDescription', distanceField: 'bikeDistance', splitField: 'bikeSplits' },
  { field: 'runGpxUrl', label: 'Run', descriptionField: 'runDescription', distanceField: 'runDistance', splitField: 'runSplits' },
  { field: 'run1GpxUrl', label: 'Run 1', descriptionField: 'run1Description', distanceField: 'run1Distance', splitField: 'run1Splits' },
  { field: 'run2GpxUrl', label: 'Run 2', descriptionField: 'run2Description', distanceField: 'run2Distance', splitField: 'run2Splits' },
];

const DEFAULT_SPLIT_INTERVALS: Record<CourseSplitField, string> = {
  swimSplits: '0.5',
  bikeSplits: '10',
  runSplits: '2.5',
  run1Splits: '2.5',
  run2Splits: '2.5',
};

const KM_SCALE = 1000;

function formatKmValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function buildAutoSplitDrafts(splitField: CourseSplitField, label: string, legDistanceKm: number, intervalKm: number): CourseSplitDraft[] {
  const distanceScaled = Math.round(legDistanceKm * KM_SCALE);
  const intervalScaled = Math.round(intervalKm * KM_SCALE);
  if (distanceScaled <= 0 || intervalScaled <= 0) return [];

  const rows: CourseSplitDraft[] = [];
  let step = intervalScaled;

  while (step < distanceScaled) {
    const km = step / KM_SCALE;
    rows.push({
      id: `${splitField}-${step}`,
      name: `${label} ${formatKmValue(km)} km`,
      distance: formatKmValue(km),
    });
    step += intervalScaled;
  }

  const finalKm = distanceScaled / KM_SCALE;
  rows.push({
    id: `${splitField}-${distanceScaled}`,
    name: `${label} ${formatKmValue(finalKm)} km`,
    distance: formatKmValue(finalKm),
  });

  return rows;
}

function normalizeCourseMapUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const blobMatch = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  if (blobMatch) {
    const [, owner, repo, branch, filePath] = blobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  const refsHeadsMatch = raw.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/refs\/heads\/([^/]+)\/(.+)$/i);
  if (refsHeadsMatch) {
    const [, owner, repo, branch, filePath] = refsHeadsMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  return raw;
}

function inferCourseProfile(ticket: any): 'swimathon' | 'triathlon' | 'duathlon' | 'run-only' {
  const name = String(ticket?.ticketName || ticket?.name || ticket?.category || '').toLowerCase();
  if (name.includes('duathlon')) return 'duathlon';
  if (name.includes('triathlon') || name.includes('tri ')) return 'triathlon';
  if (name.includes('swimathon') || name.includes('open water')) return 'swimathon';
  if (name.includes('run') && !name.includes('tri')) return 'run-only';
  return 'triathlon';
}

const DEFAULT_API_BASE_URL = 'https://apicn.feibot.com';

function statusTone(status: string | boolean | undefined) {
  if (status === true || status === 'PASS' || status === 'connected' || status === 'verified' || status === 'success' || status === 'ready' || status === 'active') {
    return 'default' as const;
  }
  if (status === 'WARNING' || status === 'warning') return 'secondary' as const;
  return 'outline' as const;
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatRelative(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffDays = Math.max(0, Math.round((Date.now() - date.getTime()) / 86400000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1d ago';
  return `${diffDays}d ago`;
}

function formatDistance(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(Number.isInteger(Number(value)) ? 0 : 1)} km`;
}

function formatDistanceDraft(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '';
  return String(value);
}

function createSplitDraftRows(rows?: CourseSplit[] | null): CourseSplitDraft[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map((row, index) => ({
    id: String(row?.id || `${row?.name || 'split'}-${index}`),
    name: String(row?.name || ''),
    distance: row?.distance === null || row?.distance === undefined || Number.isNaN(Number(row?.distance)) ? '' : String(row.distance),
  }));
}

function createEmptySplitDraft(prefix: string): CourseSplitDraft {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: `${prefix}-${suffix}`,
    name: '',
    distance: '',
  };
}

function normalizeSplitDraftRows(rows: CourseSplitDraft[]): CourseSplit[] {
  return rows
    .map((row, index) => {
      const name = String(row?.name || '').trim();
      const distance = Number(String(row?.distance || '').trim());
      if (!name || !Number.isFinite(distance) || distance <= 0) return null;

      return {
        id: String(row?.id || `${name}-${index}`),
        name,
        distance,
      };
    })
    .filter((row): row is CourseSplit => Boolean(row));
}

export default function LiveTrackingHub() {
  const [credentials, setCredentials] = useState<CredentialStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'setup' | 'contest_mapping' | 'leg_split_mapping' | 'course_maps' | 'feibot_sync' | 'upload_results'>('setup');
  const [events, setEvents] = useState<FeibotEvent[]>([]);
  const [selectedEventUuid, setSelectedEventUuid] = useState('');
  const [bergmanEventId, setBergmanEventId] = useState('');
  const [upcomingEvents, setUpcomingEvents] = useState<BergmanUpcomingEvent[]>([]);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [courseConfig, setCourseConfig] = useState<CourseConfig | null>(null);
  const [timingRules, setTimingRules] = useState<TimingRulesResponse | null>(null);
  const [account, setAccount] = useState('feibot');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingUpcomingEvents, setLoadingUpcomingEvents] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [loadingCourseConfig, setLoadingCourseConfig] = useState(false);
  const [loadingTimingRules, setLoadingTimingRules] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [enablingLiveTracking, setEnablingLiveTracking] = useState(false);
  const [disablingLiveTracking, setDisablingLiveTracking] = useState(false);
  const [eventDiscoverySupported, setEventDiscoverySupported] = useState<boolean | null>(null);
  const [manualEventUuid, setManualEventUuid] = useState('');
  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);
  const [bergmanParticipantCount, setBergmanParticipantCount] = useState<number | null>(null);
  const [feibotParticipantCount, setFeibotParticipantCount] = useState<number | null>(null);
  const [matchedParticipantCount, setMatchedParticipantCount] = useState<number | null>(null);
  const [unmatchedBergmanCount, setUnmatchedBergmanCount] = useState<number | null>(null);
  const [unmatchedProviderCount, setUnmatchedProviderCount] = useState<number | null>(null);
  const [bergmanSummaryUpdatedAt, setBergmanSummaryUpdatedAt] = useState<string | null>(null);
  const [feibotParticipantsUpdatedAt, setFeibotParticipantsUpdatedAt] = useState<string | null>(null);
  const [courseMapDrafts, setCourseMapDrafts] = useState<Partial<Record<CourseAssetField, string>>>({});
  const [courseDistanceDrafts, setCourseDistanceDrafts] = useState<Record<CourseDistanceField, string>>({
    swimDistance: '',
    bikeDistance: '',
    runDistance: '',
    run1Distance: '',
    run2Distance: '',
  });
  const [courseDescriptionDrafts, setCourseDescriptionDrafts] = useState<Record<CourseDescriptionField, string>>({
    swimDescription: '',
    bikeDescription: '',
    runDescription: '',
    run1Description: '',
    run2Description: '',
  });
  const [courseSplitDrafts, setCourseSplitDrafts] = useState<Record<CourseSplitField, CourseSplitDraft[]>>({
    swimSplits: [],
    bikeSplits: [],
    runSplits: [],
    run1Splits: [],
    run2Splits: [],
  });
  const [splitIntervalDrafts, setSplitIntervalDrafts] = useState<Record<CourseSplitField, string>>(DEFAULT_SPLIT_INTERVALS);
  const [courseMapSavingField, setCourseMapSavingField] = useState<CourseAssetField | null>(null);
  const [courseMapUploadingField, setCourseMapUploadingField] = useState<CourseAssetField | null>(null);
  const [courseMapPreviewOpen, setCourseMapPreviewOpen] = useState(false);
  const [selectedCourseTicketId, setSelectedCourseTicketId] = useState('');
  const [courseCutoffModeDraft, setCourseCutoffModeDraft] = useState<'overall' | 'segment'>('overall');
  const [courseCutoffDrafts, setCourseCutoffDrafts] = useState<{
    overall: string;
    swim: string;
    bike: string;
    run: string;
    run1: string;
    run2: string;
  }>({ overall: '', swim: '', bike: '', run: '', run1: '', run2: '' });
  const [fdbFile, setFdbFile] = useState<File | null>(null);
  const [fdbImportJobId, setFdbImportJobId] = useState<string | null>(null);
  const [fdbImportStatus, setFdbImportStatus] = useState<'idle' | 'uploading' | 'processing' | 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled'>('idle');
  const [fdbImportProgress, setFdbImportProgress] = useState(0);
  const [fdbImportStage, setFdbImportStage] = useState<string | null>(null);
  const [fdbImportMessage, setFdbImportMessage] = useState<string | null>(null);
  const [fdbImportSummary, setFdbImportSummary] = useState<any>(null);
  const [fdbMetadata, setFdbMetadata] = useState<any>(null);
  const [fdbImportLogs, setFdbImportLogs] = useState<any[]>([]);
  const [splitMappings, setSplitMappings] = useState<Record<string, any> | null>(null);
  const [splitMappingSummary, setSplitMappingSummary] = useState<{ importedCount: number; mappedCount: number; unmappedCount: number } | null>(null);
  const [loadingSplitMappings, setLoadingSplitMappings] = useState(false);
  const [eventUuidTestLoading, setEventUuidTestLoading] = useState(false);
  const [eventUuidTestResult, setEventUuidTestResult] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventUuidTestAbortRef = useRef<AbortController | null>(null);
  const eventUuidTestInFlightRef = useRef(false);
  const lockedApiBaseUrl = DEFAULT_API_BASE_URL;

  const selectedEvent = useMemo(
    () => events.find((event) => event.event_uuid === selectedEventUuid) || null,
    [events, selectedEventUuid],
  );

  const resolvedEventUuid = useMemo(() => selectedEventUuid.trim() || manualEventUuid.trim(), [manualEventUuid, selectedEventUuid]);

  const readiness = useMemo(() => {
    const hasCreds = Boolean(credentials?.configured);
    const hasSelectedEvent = Boolean(selectedEventUuid);
    const hasBergmanEvent = Boolean(bergmanEventId.trim());
    const authOk = credentials?.lastAuthResult === 'success' || credentials?.lastAuthResult === 'verified';
    return {
      ready: hasCreds && hasSelectedEvent && hasBergmanEvent && authOk,
      hasCreds,
      hasSelectedEvent,
      hasBergmanEvent,
      authOk,
    };
  }, [bergmanEventId, credentials?.configured, credentials?.lastAuthResult, selectedEventUuid]);

  const isBergmanEventLinked = Boolean(credentials?.configured && bergmanEventId.trim() && selectedEventUuid && credentials?.lastAuthResult === 'success');

  const loadProviderConfig = useCallback(async (eventId: string) => {
    if (!eventId) return;
    try {
      const data = await fetchJsonCached<any>(`providerConfig:${eventId}`, async () => {
        const response = await fetch(`/api/live/provider-config/${encodeURIComponent(eventId)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || `Request failed with HTTP ${response.status}`);
        }
        return payload;
      });
      setProviderConfig(data);

      const savedEventUuid = String(
        data?.config?.feibotConfig?.cloud?.eventUuid ||
        data?.config?.feibotConfig?.eventUuid ||
        '',
      ).trim();

      if (savedEventUuid) {
        setSelectedEventUuid(savedEventUuid);
        setManualEventUuid((prev) => (String(prev || '').trim() ? prev : savedEventUuid));
      }
    } catch (err) {
      setProviderConfig(null);
      setError(err instanceof Error ? err.message : 'Failed to load provider configuration.');
    }
  }, []);

  const loadEvents = useCallback(async (eventIdInput?: string) => {
    const eventId = String(eventIdInput || bergmanEventId.trim() || '').trim();
    if (!eventId) {
      setEvents([]);
      setEventDiscoverySupported(null);
      return;
    }

    setLoadingEvents(true);
    try {
      const data = await fetchJsonCached<any>(`providerEvents:${eventId}`, async () => {
        const response = await fetch(`/api/live/provider/events?eventId=${encodeURIComponent(eventId)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || `Request failed with HTTP ${response.status}`);
        }
        return payload;
      });

      setEvents(Array.isArray(data?.events) ? data.events : []);
      setEventDiscoverySupported(Boolean(data?.authenticated || data?.credentialsValid || (Array.isArray(data?.events) && data.events.length > 0)));
    } catch (err) {
      setEvents([]);
      setEventDiscoverySupported(false);
      setError(err instanceof Error ? err.message : 'Failed to load Feibot events.');
    } finally {
      setLoadingEvents(false);
    }
  }, [bergmanEventId]);

  const loadProviderDatabase = useCallback(async (eventIdInput?: string) => {
    const eventId = String(eventIdInput || bergmanEventId.trim() || '').trim();
    if (!eventId) return;

    try {
      await fetchJsonCached<any>(`providerDatabase:${eventId}`, async () => {
        const response = await fetch(`/api/live/provider-database/${encodeURIComponent(eventId)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || `Request failed with HTTP ${response.status}`);
        }
        return payload;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load provider database metadata.');
    }
  }, [bergmanEventId]);

  const loadStatus = useCallback(async () => {
    const eventId = bergmanEventId.trim();
    if (!eventId) return;

    setLoadingStatus(true);
    try {
      await Promise.all([
        loadProviderConfig(eventId),
        loadProviderDatabase(eventId),
      ]);
    } finally {
      setLoadingStatus(false);
    }
  }, [bergmanEventId, loadProviderConfig, loadProviderDatabase]);

  const loadUpcomingEvents = useCallback(async () => {
    setLoadingUpcomingEvents(true);
    try {
      const result = await getCalendarEventsAction();
      if (result?.success && Array.isArray(result.events)) {
        setUpcomingEvents(
          result.events.map((event: any) => ({
            id: String(event?.id || ''),
            name: String(event?.eventName || event?.name || event?.id || ''),
            date: event?.eventDate ? String(event.eventDate) : null,
            status: (event?.status as 'upcoming' | 'live' | 'completed') || 'upcoming',
            isUpcoming: true,
            customSlug: event?.customSlug || null,
          })),
        );
      }
    } catch {
      // non-critical; silently ignore
    } finally {
      setLoadingUpcomingEvents(false);
    }
  }, []);

  const loadCredentials = useCallback(async (eventId: string) => {
    if (!eventId) return;
    try {
      const [data, credentialStatus] = await Promise.all([
        fetchJsonCached<any>(`credentials:${eventId}`, async () => {
          const response = await fetch(`/api/live/provider-config/${encodeURIComponent(eventId)}`, { cache: 'no-store' });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.message || `Request failed with HTTP ${response.status}`);
          }
          return payload;
        }),
        fetchJsonCached<any>(`credentialStatus:${eventId}`, async () => {
          const response = await fetch(`/api/live/provider/credentials?eventId=${encodeURIComponent(eventId)}`, { cache: 'no-store' });
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(payload?.message || payload?.error || `Request failed with HTTP ${response.status}`);
          }
          return payload;
        }),
      ]);

      const feibot = data?.config?.feibotConfig || {};
      const providerState = data?.config?.providerState || {};
      const cloudAuthenticated = Boolean(feibot?.cloud?.authenticated);
      const providerVerified = providerState.authentication === 'verified' || providerState.status === 'connected';
      setCredentials((prev) => ({
        ...(prev || {}),
        configured: Boolean(feibot.hasCredentials ?? credentialStatus?.configured ?? credentialStatus?.eventCredentialConfigured ?? prev?.configured),
        source: (credentialStatus?.source as any) || (feibot.credentialsSource as any) || prev?.source || 'none',
        encryptionEnabled: Boolean(credentialStatus?.encryptionEnabled ?? prev?.encryptionEnabled ?? true),
        eventUuid: feibot.eventUuid || credentialStatus?.eventUuid || prev?.eventUuid || null,
        linkedEventUuid: credentialStatus?.linkedEventUuid || prev?.linkedEventUuid || null,
        cloudEventUuid: credentialStatus?.cloudEventUuid || prev?.cloudEventUuid || null,
        credentialBoundEventUuid: credentialStatus?.credentialBoundEventUuid || prev?.credentialBoundEventUuid || null,
        runtimeEventUuid: credentialStatus?.runtimeEventUuid || prev?.runtimeEventUuid || null,
        lastAuthResult: providerVerified || cloudAuthenticated ? 'success' : credentialStatus?.lastAuthResult || prev?.lastAuthResult || null,
        lastAuthAt: credentialStatus?.lastAuthAt || prev?.lastAuthAt || null,
        updatedAt: providerState.updatedAt || credentialStatus?.updatedAt || prev?.updatedAt || null,
      }));
    } catch {
      // non-critical
    }
  }, []);

  const loadSplitMappings = useCallback(async (eventId: string) => {
    if (!eventId) {
      setSplitMappings(null);
      setSplitMappingSummary(null);
      return;
    }

    setLoadingSplitMappings(true);
    try {
      const data = await fetchJsonCached<any>(`splitMappingSummary:${eventId}`, async () => {
        const response = await fetch(`/api/live/split-mapping-view/${encodeURIComponent(eventId)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || `Request failed with HTTP ${response.status}`);
        }
        return payload;
      });

      const mappedRows = Array.isArray(data?.splitMappings) ? data.splitMappings : [];
      setSplitMappings(mappedRows.length ? ({ rows: mappedRows } as any) : null);
      setSplitMappingSummary({
        importedCount: Number(data?.summary?.importedCount || 0),
        mappedCount: Number(data?.summary?.mappedCount || 0),
        unmappedCount: Number(data?.summary?.unmappedCount || 0),
      });
    } catch {
      setSplitMappings(null);
      setSplitMappingSummary(null);
    } finally {
      setLoadingSplitMappings(false);
    }
  }, []);

  // ── On mount: load upcoming Bergman events for the event selector ──────────
  useEffect(() => {
    void loadUpcomingEvents();
  }, [loadUpcomingEvents]);

  // ── When bergmanEventId changes: load all event-specific data ────────────
  useEffect(() => {
    const eventId = bergmanEventId.trim();
    if (!eventId) return;
    void loadStatus();
    void loadCredentials(eventId);
    void loadSplitMappings(eventId);
    void loadCourseConfig(eventId);
    void loadFdbMetadata(eventId);
    void loadSelectedEventCounts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bergmanEventId]);

  const loadCourseConfig = useCallback(async (eventId: string) => {
    if (!eventId) {
      setCourseConfig(null);
      return;
    }

    setLoadingCourseConfig(true);
    try {
      const data = await fetchJsonCached<any>(`courseConfig:${eventId}`, async () => {
        const response = await fetch(`/api/live/course-config?eventId=${encodeURIComponent(eventId)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || payload?.message || `Request failed with HTTP ${response.status}`);
        }
        return payload;
      });
      setCourseConfig(data);
    } catch (err) {
      setCourseConfig(null);
      setError(err instanceof Error ? err.message : 'Failed to load course configuration.');
    } finally {
      setLoadingCourseConfig(false);
    }
  }, []);

  const loadTimingRules = useCallback(async (eventUuid: string) => {
    if (!eventUuid || !credentials?.configured) {
      setTimingRules(null);
      return;
    }

    setLoadingTimingRules(true);
    try {
      const params = new URLSearchParams();
      if (bergmanEventId.trim()) params.set('eventId', bergmanEventId.trim());
      params.set('eventUuid', eventUuid);
      const data = await fetchJsonCached<any>(`timingRules:${bergmanEventId.trim()}:${eventUuid}`, async () => {
        const response = await fetch(`/api/live/provider/timing-rules?${params.toString()}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || `Request failed with HTTP ${response.status}`);
        }
        return payload;
      });
      setTimingRules(data);
    } catch (err) {
      setTimingRules(null);
      setError(err instanceof Error ? err.message : 'Failed to load Feibot timing rules.');
    } finally {
      setLoadingTimingRules(false);
    }
  }, [bergmanEventId, credentials?.configured]);

  const loadSelectedEventCounts = useCallback(async () => {
    if (!bergmanEventId.trim()) {
      setBergmanParticipantCount(null);
      setFeibotParticipantCount(null);
      setMatchedParticipantCount(null);
      setUnmatchedBergmanCount(null);
      setUnmatchedProviderCount(null);
      setBergmanSummaryUpdatedAt(null);
      setFeibotParticipantsUpdatedAt(null);
      return;
    }

    setLoadingCounts(true);
    try {
      const bergmanData = await fetchJsonCached<any>(`kvSummary:${bergmanEventId.trim()}`, async () => {
        const bergmanResponse = await fetch(`/api/events/${encodeURIComponent(bergmanEventId.trim())}/liveTracking/kv-summary`, { cache: 'no-store' });
        const payload = await bergmanResponse.json().catch(() => null);
        if (!bergmanResponse.ok || !payload?.success) {
          throw new Error(payload?.message || `Request failed with HTTP ${bergmanResponse.status}`);
        }
        return payload;
      });
      if (bergmanData?.success) {
        const summary = bergmanData?.summary || {};
        setBergmanParticipantCount(Number(summary?.bergmanParticipants ?? 0));
        setFeibotParticipantCount(Number(summary?.feibotParticipants ?? 0));
        setMatchedParticipantCount(Number(summary?.matchedParticipants ?? 0));
        setUnmatchedBergmanCount(Number(summary?.unmatchedBergman ?? 0));
        setUnmatchedProviderCount(Number(summary?.unmatchedProvider ?? 0));
        setBergmanSummaryUpdatedAt(summary?.bergmanUpdatedAt || bergmanData?.testedAt || null);
        setFeibotParticipantsUpdatedAt(summary?.feibotUpdatedAt || null);
      } else {
        setBergmanParticipantCount(null);
        setFeibotParticipantCount(null);
        setMatchedParticipantCount(null);
        setUnmatchedBergmanCount(null);
        setUnmatchedProviderCount(null);
        setBergmanSummaryUpdatedAt(null);
        setFeibotParticipantsUpdatedAt(null);
      }
    } finally {
      setLoadingCounts(false);
    }
  }, [bergmanEventId]);

  const loadFdbMetadata = useCallback(async (eventId: string) => {
    if (!eventId) {
      setFdbMetadata(null);
      setFdbImportSummary(null);
      setFdbImportMessage(null);
      setFdbImportStage(null);
      setFdbImportProgress(0);
      setFdbImportStatus('idle');
      setFdbImportLogs([]);
      return;
    }

    try {
      const data = await fetchJsonCached<any>(`fdbMetadata:${eventId}`, async () => {
        const response = await fetch(`/api/admin/live-tracking/feibot/fdb-import?eventId=${encodeURIComponent(eventId)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || `Request failed with HTTP ${response.status}`);
        }
        return payload;
      }, { force: true });

      setFdbMetadata(data.metadata || null);
      setFdbImportSummary(data.summary || data.metadata?.latestSummary || null);
      setFdbImportLogs(Array.isArray(data.logs) ? data.logs : []);
      const resumedJobId = String(data?.metadata?.activeImportJobId || data?.progress?.jobId || '').trim();
      if (resumedJobId) {
        setFdbImportJobId(resumedJobId);
      } else if (String(data?.progress?.status || '').toUpperCase() !== 'PROCESSING') {
        setFdbImportJobId(null);
      }
      if (data?.metadata?.database?.localEventUuid) {
        const localEventUuid = String(data.metadata.database.localEventUuid || '').trim();
        if (localEventUuid) {
          setSelectedEventUuid((prev) => (String(prev || '').trim() ? prev : localEventUuid));
        }
      }

      const progress = data.progress || data.metadata?.progress || null;
      if (progress) {
        const nextStatus = String(progress.status || '').toUpperCase();
        setFdbImportStage(String(progress.stage || data.summary?.currentStage || '').trim() || null);
        if (nextStatus === 'COMPLETED' || nextStatus === 'COMPLETED_WITH_WARNINGS') {
          setFdbImportStatus(nextStatus === 'COMPLETED_WITH_WARNINGS' ? 'completed_with_warnings' : 'completed');
          setFdbImportProgress(100);
          setFdbImportJobId(null);
        } else if (nextStatus === 'FAILED') {
          setFdbImportStatus('failed');
          setFdbImportProgress(Number(progress.progress || 100));
          setFdbImportJobId(null);
        } else if (nextStatus === 'CANCELLED') {
          setFdbImportStatus('cancelled');
          setFdbImportProgress(Number(progress.progress || 100));
          setFdbImportJobId(null);
        } else if (nextStatus) {
          setFdbImportStatus('processing');
          setFdbImportProgress(Number(progress.progress || 0));
        }
        setFdbImportMessage(progress.message || null);
      }
    } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load FDB import metadata.');
      }
    }, []);

  useEffect(() => {
    if (fdbImportStatus !== 'processing' || !bergmanEventId.trim()) return;

    const interval = setInterval(() => {
      void loadFdbMetadata(bergmanEventId.trim());
    }, 5000);

    return () => clearInterval(interval);
  }, [bergmanEventId, fdbImportJobId, fdbImportStatus, loadFdbMetadata]);

  const handleCancelFdbImport = useCallback(async () => {
    if (!bergmanEventId.trim()) return;

    try {
      const response = fdbImportJobId
        ? await fetch(`/api/admin/upload-status/${fdbImportJobId}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'cancel' }),
          })
        : await fetch(`/api/admin/live-tracking/feibot/fdb-import?eventId=${encodeURIComponent(bergmanEventId.trim())}`, {
            method: 'DELETE',
          });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Cancellation failed with HTTP ${response.status}`);
      }
      setFdbImportStatus('cancelled');
      setFdbImportStage('Cancelled');
      setFdbImportMessage('Import cancelled by user.');
      setFdbImportJobId(null);
      invalidateJsonCache(`fdbMetadata:${bergmanEventId.trim()}`);
      void loadFdbMetadata(bergmanEventId.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel FDB import.');
    }
  }, [bergmanEventId, fdbImportJobId, loadFdbMetadata]);

  const handleSaveCredentials = useCallback(async () => {
    setSavingCredentials(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch('/api/admin/live-tracking/feibot/save-credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessKey,
          secretKey,
          account,
            apiBaseUrl: lockedApiBaseUrl,
            eventUuid: resolvedEventUuid,
          eventId: bergmanEventId.trim(),
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setChecks(Array.isArray(data?.checks) ? data.checks : []);
        throw new Error(data?.message || `Request failed with HTTP ${response.status}`);
      }

      setMessage(data.message || 'Credentials saved successfully.');
      setChecks(Array.isArray(data?.checks) ? data.checks : []);
      setCredentials((prev) => ({
        ...(prev || {}),
        configured: true,
        source: 'firestore',
        encryptionEnabled: true,
        eventUuid: data?.primaryEventUuid || resolvedEventUuid || prev?.eventUuid || null,
        lastAuthResult: 'success',
        lastAuthAt: new Date().toISOString(),
      }));
      setSelectedEventUuid(String(data?.primaryEventUuid || resolvedEventUuid || '').trim());
      setAccessKey('');
      setSecretKey('');

      invalidateJsonCache('providerCredentials');
      invalidateJsonCache('providerEvents');
      await Promise.all([loadStatus(), loadEvents()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials.');
    } finally {
      setSavingCredentials(false);
    }
  }, [accessKey, account, bergmanEventId, loadEvents, loadStatus, lockedApiBaseUrl, resolvedEventUuid, secretKey]);

  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch('/api/live/provider/verify-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'feibot',
          eventUuid: resolvedEventUuid || credentials?.eventUuid || undefined,
          eventId: bergmanEventId.trim() || undefined,
          scoreEventUuid: selectedEvent?.score_event_uuid || undefined,
            apiBaseUrl: lockedApiBaseUrl,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || `Request failed with HTTP ${response.status}`);
      }

      setMessage(data.message || 'Connection verified.');
      setCredentials((prev) => ({ ...(prev || {}), lastAuthResult: 'success', lastAuthAt: new Date().toISOString() }));
      invalidateJsonCache('providerCredentials');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify connection.');
    } finally {
      setTestingConnection(false);
    }
  }, [bergmanEventId, credentials?.eventUuid, loadStatus, lockedApiBaseUrl, resolvedEventUuid, selectedEvent?.score_event_uuid]);

  const handleTestEventUuid = useCallback(async (eventUuidOverride?: string) => {
    if (eventUuidTestInFlightRef.current) {
      eventUuidTestAbortRef.current?.abort();
    }

    const localEventUuid = String(
      eventUuidOverride
      || fdbImportSummary?.detected?.eventUuid
      || fdbMetadata?.database?.localEventUuid
      || resolvedEventUuid
      || '',
    ).trim();

    if (!bergmanEventId.trim() && !localEventUuid) {
      setError('Set an event or import an FDB before testing the event link.');
      return;
    }

    setEventUuidTestLoading(true);
    setEventUuidTestResult(null);
    setError(null);
    eventUuidTestInFlightRef.current = true;

    const abortController = new AbortController();
    eventUuidTestAbortRef.current = abortController;

    console.log('[Test Event] Started');

    try {
      const params = new URLSearchParams();
      if (bergmanEventId.trim()) params.set('eventId', bergmanEventId.trim());
      if (localEventUuid) params.set('eventUuid', localEventUuid);
      params.set('source', 'admin-test-event-button');

      console.log('[Test Event] Calling Feibot...');
      const response = await fetch(`/api/live-tracking/feibot/test-event?${params.toString()}`, {
        cache: 'no-store',
        headers: {
          'x-test-event-source': 'admin-test-event-button',
        },
        signal: abortController.signal,
      });
      const data = await response.json().catch(() => null);
      setEventUuidTestResult(data);
      console.log(`[Test Event] HTTP ${response.status}`);

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || `Event link verification failed with HTTP ${response.status}`);
      }

      setMessage('✓ Event link valid. Timing rules loaded successfully.');
      if (bergmanEventId.trim()) {
        await Promise.all([
          loadStatus(),
          loadSelectedEventCounts(),
          loadFdbMetadata(bergmanEventId.trim()),
        ]);
      }
    } catch (err) {
      if ((err as any)?.name === 'AbortError') {
        console.log('[Test Event] Aborted');
        return;
      }
      setError(err instanceof Error ? err.message : 'Event link verification failed.');
    } finally {
      console.log('[Test Event] Completed');
      if (eventUuidTestAbortRef.current === abortController) {
        eventUuidTestAbortRef.current = null;
      }
      eventUuidTestInFlightRef.current = false;
      setEventUuidTestLoading(false);
    }
  }, [bergmanEventId, fdbImportSummary?.detected?.eventUuid, fdbMetadata?.database?.localEventUuid, loadFdbMetadata, loadSelectedEventCounts, loadStatus, resolvedEventUuid]);

  useEffect(() => {
    return () => {
      eventUuidTestAbortRef.current?.abort();
      eventUuidTestAbortRef.current = null;
      eventUuidTestInFlightRef.current = false;
    };
  }, []);

  const handleSaveProviderConfig = useCallback(async (eventUuidOverride?: string) => {
    const eventUuid = String(eventUuidOverride || resolvedEventUuid || '').trim();
    if (!bergmanEventId.trim() || !eventUuid) return;

    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/live/provider-config/${encodeURIComponent(bergmanEventId.trim())}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'feibot',
          config: {
            provider: 'feibot',
            feibotConfig: {
              eventUuid,
              apiBaseUrl: lockedApiBaseUrl,
              cloud: {
                eventUuid,
                apiBaseUrl: lockedApiBaseUrl,
              },
              score: {
                eventUuid: selectedEvent?.score_event_uuid || '',
                overviewUrl: '',
                progressUrl: '',
                available: Boolean(selectedEvent?.score_event_uuid),
              },
              timingRuleSource: 'cloud',
            },
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || `Request failed with HTTP ${response.status}`);
      }

      setProviderConfig(data);
      setSelectedEventUuid(eventUuid);
      setManualEventUuid('');
      setMessage(data.message || 'Event linked successfully.');
      invalidateJsonCache(`providerConfig:${bergmanEventId.trim()}`);
      invalidateJsonCache(`courseConfig:${bergmanEventId.trim()}`);
      invalidateJsonCache(`timingRules:${bergmanEventId.trim()}:${eventUuid}`);
      invalidateJsonCache(`kvSummary:${bergmanEventId.trim()}`);
      await Promise.all([
        loadProviderConfig(bergmanEventId.trim()),
        loadCourseConfig(bergmanEventId.trim()),
        loadTimingRules(eventUuid),
        loadSelectedEventCounts(),
        loadProviderDatabase(bergmanEventId.trim()),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save provider configuration.');
    }
  }, [bergmanEventId, loadCourseConfig, loadProviderConfig, loadProviderDatabase, loadSelectedEventCounts, loadTimingRules, lockedApiBaseUrl, resolvedEventUuid, selectedEvent?.score_event_uuid]);

  const handleEnableLiveTracking = useCallback(async () => {
    if (!bergmanEventId.trim() || !selectedEventUuid) return;
    setEnablingLiveTracking(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/live/start-sync/${encodeURIComponent(bergmanEventId.trim())}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventUuid: selectedEventUuid,
          scoreEventUuid: selectedEvent?.score_event_uuid || '',
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || `Request failed with HTTP ${response.status}`);
      }

      setMessage(data.message || 'Live tracking enabled.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable live tracking.');
    } finally {
      setEnablingLiveTracking(false);
    }
  }, [bergmanEventId, loadStatus, selectedEvent?.score_event_uuid, selectedEventUuid]);

  const handleSaveCourseMapUrl = useCallback(async (field: CourseAssetField) => {
    const activeTicket = courseConfig?.ticketDefinitions?.find((ticket) => ticket.id === selectedCourseTicketId) || courseConfig?.ticketDefinitions?.find((ticket) => Boolean(ticket?.courseMaps)) || courseConfig?.ticketDefinitions?.[0] || null;
    if (!bergmanEventId.trim() || !activeTicket?.id) return;
    const nextValue = normalizeCourseMapUrl(courseMapDrafts[field]);

    setCourseMapSavingField(field);
    setMessage(null);
    setError(null);

    try {
      const payload = {
        courseMaps: {
          ...(activeTicket.courseMaps || {}),
          [field]: nextValue || null,
        },
      } as any;

      const result = await updateTicketDefinitionAction(bergmanEventId.trim(), activeTicket.id, payload);
      if (!result.success) {
        throw new Error(result.message || 'Failed to save course map URL.');
      }

      setMessage(`${COURSE_ASSET_FIELDS.find((item) => item.field === field)?.label || 'Course map'} URL saved.`);
      await loadCourseConfig(bergmanEventId.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save course map URL.');
    } finally {
      setCourseMapSavingField(null);
    }
  }, [bergmanEventId, courseConfig?.ticketDefinitions, courseMapDrafts, loadCourseConfig, selectedCourseTicketId]);

  const handleUploadCourseMapAsset = useCallback(async (field: CourseAssetField, file: File) => {
    const activeTicket = courseConfig?.ticketDefinitions?.find((ticket) => ticket.id === selectedCourseTicketId) || courseConfig?.ticketDefinitions?.find((ticket) => Boolean(ticket?.courseMaps)) || courseConfig?.ticketDefinitions?.[0] || null;
    if (!bergmanEventId.trim() || !activeTicket?.id) return;
    setCourseMapUploadingField(field);
    setMessage(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', field);
      formData.append('eventId', bergmanEventId.trim());
      formData.append('ticketId', activeTicket.id);

      const response = await fetch('/api/admin/upload-event-asset', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || `Upload failed with HTTP ${response.status}`);
      }

      setMessage(`${COURSE_ASSET_FIELDS.find((item) => item.field === field)?.label || 'Course map'} GPX uploaded successfully.`);
      await loadCourseConfig(bergmanEventId.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload GPX file.');
    } finally {
      setCourseMapUploadingField(null);
    }
  }, [bergmanEventId, courseConfig?.ticketDefinitions, loadCourseConfig, selectedCourseTicketId]);

  const handleSaveCourseMapConfig = useCallback(async () => {
    const activeTicket = courseConfig?.ticketDefinitions?.find((ticket) => ticket.id === selectedCourseTicketId) || courseConfig?.ticketDefinitions?.find((ticket) => Boolean(ticket?.courseMaps)) || courseConfig?.ticketDefinitions?.[0] || null;
    if (!bergmanEventId.trim() || !activeTicket?.id) return;

    setMessage(null);
    setError(null);

    try {
      const normalizedSplitDrafts: Record<CourseSplitField, CourseSplit[]> = {
        swimSplits: normalizeSplitDraftRows(courseSplitDrafts.swimSplits || []),
        bikeSplits: normalizeSplitDraftRows(courseSplitDrafts.bikeSplits || []),
        runSplits: normalizeSplitDraftRows(courseSplitDrafts.runSplits || []),
        run1Splits: normalizeSplitDraftRows(courseSplitDrafts.run1Splits || []),
        run2Splits: normalizeSplitDraftRows(courseSplitDrafts.run2Splits || []),
      };

      const activeProfile = inferCourseProfile(activeTicket as any);
      const splitAssets: CourseAssetLabel[] = (() => {
        if (activeProfile === 'swimathon') {
          return COURSE_ASSET_FIELDS.filter((asset) => asset.field === 'swimGpxUrl');
        }

        if (activeProfile === 'duathlon') {
          const order = ['run1GpxUrl', 'bikeGpxUrl', 'run2GpxUrl', 'runGpxUrl'];
          return COURSE_ASSET_FIELDS
            .filter((asset) => order.includes(asset.field))
            .sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
        }

        if (activeProfile === 'run-only') {
          return COURSE_ASSET_FIELDS.filter((asset) => ['runGpxUrl', 'run1GpxUrl', 'run2GpxUrl'].includes(asset.field));
        }

        return COURSE_ASSET_FIELDS.filter((asset) => ['swimGpxUrl', 'bikeGpxUrl', 'runGpxUrl'].includes(asset.field));
      })();

      const resolveLegDistanceLocal = (distanceField: CourseDistanceField) => {
        const draft = String(courseDistanceDrafts[distanceField] || '').trim();
        if (draft) {
          const value = Number(draft);
          return Number.isFinite(value) ? value : 0;
        }

        const existing = Number((activeTicket.courseMaps as any)?.[distanceField]);
        return Number.isFinite(existing) ? existing : 0;
      };

      const splitValidationErrors: string[] = [];
      const toleranceKm = 0.001;
      let cumulativeOffsetKm = 0;

      for (const asset of splitAssets) {
        const legDistanceKm = resolveLegDistanceLocal(asset.distanceField);
        if (!Number.isFinite(legDistanceKm) || legDistanceKm <= 0) continue;

        const legSplits = normalizedSplitDrafts[asset.splitField] || [];
        if (legSplits.length === 0) {
          splitValidationErrors.push(`${asset.label}: missing split checkpoints. Expected final checkpoint at ${formatKmValue(legDistanceKm)} km (cumulative ${formatKmValue(cumulativeOffsetKm + legDistanceKm)} km).`);
          cumulativeOffsetKm += legDistanceKm;
          continue;
        }

        let previousDistance = 0;
        for (let index = 0; index < legSplits.length; index += 1) {
          const split = legSplits[index];
          const distance = Number(split.distance || 0);

          if (!Number.isFinite(distance) || distance <= 0) {
            splitValidationErrors.push(`${asset.label}: split ${index + 1} has invalid distance.`);
            continue;
          }

          if (distance <= previousDistance + toleranceKm) {
            splitValidationErrors.push(`${asset.label}: split ${index + 1} distance ${formatKmValue(distance)} km is not strictly increasing.`);
          }

          if (distance > legDistanceKm + toleranceKm) {
            splitValidationErrors.push(`${asset.label}: split ${index + 1} distance ${formatKmValue(distance)} km exceeds leg distance ${formatKmValue(legDistanceKm)} km.`);
          }

          previousDistance = distance;
        }

        const finalDistanceKm = Number(legSplits[legSplits.length - 1]?.distance || 0);
        const expectedCumulativeKm = cumulativeOffsetKm + legDistanceKm;
        const actualCumulativeKm = cumulativeOffsetKm + finalDistanceKm;

        if (Math.abs(finalDistanceKm - legDistanceKm) > toleranceKm) {
          splitValidationErrors.push(`${asset.label}: final checkpoint mismatch. Expected ${formatKmValue(legDistanceKm)} km for leg (cumulative ${formatKmValue(expectedCumulativeKm)} km) but got ${formatKmValue(finalDistanceKm)} km (cumulative ${formatKmValue(actualCumulativeKm)} km).`);
        }

        cumulativeOffsetKm += legDistanceKm;
      }

      if (splitValidationErrors.length) {
        throw new Error(`Split validation failed:\n- ${splitValidationErrors.join('\n- ')}`);
      }

      const payload: any = {
        courseMaps: {
          ...(activeTicket.courseMaps || {}),
          swimGpxUrl: normalizeCourseMapUrl(courseMapDrafts.swimGpxUrl) || null,
          bikeGpxUrl: normalizeCourseMapUrl(courseMapDrafts.bikeGpxUrl) || null,
          runGpxUrl: normalizeCourseMapUrl(courseMapDrafts.runGpxUrl) || null,
          run1GpxUrl: normalizeCourseMapUrl(courseMapDrafts.run1GpxUrl) || null,
          run2GpxUrl: normalizeCourseMapUrl(courseMapDrafts.run2GpxUrl) || null,
          swimDistance: String(courseDistanceDrafts.swimDistance || '').trim() ? Number(courseDistanceDrafts.swimDistance) : null,
          bikeDistance: String(courseDistanceDrafts.bikeDistance || '').trim() ? Number(courseDistanceDrafts.bikeDistance) : null,
          runDistance: String(courseDistanceDrafts.runDistance || '').trim() ? Number(courseDistanceDrafts.runDistance) : null,
          run1Distance: String(courseDistanceDrafts.run1Distance || '').trim() ? Number(courseDistanceDrafts.run1Distance) : null,
          run2Distance: String(courseDistanceDrafts.run2Distance || '').trim() ? Number(courseDistanceDrafts.run2Distance) : null,
          swimDescription: String(courseDescriptionDrafts.swimDescription || '').trim() || null,
          bikeDescription: String(courseDescriptionDrafts.bikeDescription || '').trim() || null,
          runDescription: String(courseDescriptionDrafts.runDescription || '').trim() || null,
          run1Description: String(courseDescriptionDrafts.run1Description || '').trim() || null,
          run2Description: String(courseDescriptionDrafts.run2Description || '').trim() || null,
          swimSplits: normalizedSplitDrafts.swimSplits,
          bikeSplits: normalizedSplitDrafts.bikeSplits,
          runSplits: normalizedSplitDrafts.runSplits,
          run1Splits: normalizedSplitDrafts.run1Splits,
          run2Splits: normalizedSplitDrafts.run2Splits,
        },
        cutoffs: {
          mode: courseCutoffModeDraft,
          overall: String(courseCutoffDrafts.overall || '').trim() || null,
          swim: String(courseCutoffDrafts.swim || '').trim() || null,
          bike: String(courseCutoffDrafts.bike || '').trim() || null,
          run: String(courseCutoffDrafts.run || '').trim() || null,
          run1: String(courseCutoffDrafts.run1 || '').trim() || null,
          run2: String(courseCutoffDrafts.run2 || '').trim() || null,
        },
      };

      const result = await updateTicketDefinitionAction(bergmanEventId.trim(), activeTicket.id, payload);
      if (!result.success) {
        throw new Error(result.message || 'Failed to save course map configuration.');
      }

      setMessage('Course map configuration saved.');
      await loadCourseConfig(bergmanEventId.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save course map configuration.');
    }
  }, [bergmanEventId, courseConfig?.ticketDefinitions, courseCutoffDrafts, courseCutoffModeDraft, courseDescriptionDrafts, courseDistanceDrafts, courseMapDrafts, courseSplitDrafts, loadCourseConfig, selectedCourseTicketId]);

  const handleStartFdbImport = useCallback(async () => {
    if (!bergmanEventId.trim() || !fdbFile) {
      setError('Select a Bergman event and choose an .fdb file first.');
      return;
    }

    setFdbImportStatus('uploading');
    setFdbImportProgress(0);
    setFdbImportStage('Uploading');
    setFdbImportMessage(null);
    setFdbImportSummary(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('eventId', bergmanEventId.trim());
      formData.append('file', fdbFile);
      formData.append('rebuildKv', 'false');

      const response = await fetch('/api/admin/live-tracking/feibot/fdb-import', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || `FDB import failed with HTTP ${response.status}`);
      }

      setFdbImportJobId(String(data.jobId));
      setFdbImportStatus('processing');
      setFdbImportMessage('FDB import queued. Parsing SQLite...');
    } catch (err) {
      setFdbImportStatus('failed');
      setError(err instanceof Error ? err.message : 'Failed to start FDB import.');
    }
  }, [bergmanEventId, fdbFile]);

  const handleRebuildFdbKv = useCallback(async () => {
    if (!bergmanEventId.trim() || !fdbFile) {
      setError('Select a Bergman event and choose an .fdb file first.');
      return;
    }

    setFdbImportStatus('uploading');
    setFdbImportProgress(0);
    setFdbImportStage('Uploading');
    setFdbImportMessage('Rebuilding KV from the FDB file...');
    setFdbImportSummary(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('eventId', bergmanEventId.trim());
      formData.append('file', fdbFile);
      formData.append('rebuildKv', 'true');

      const response = await fetch('/api/admin/live-tracking/feibot/fdb-import', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || `FDB rebuild failed with HTTP ${response.status}`);
      }

      setFdbImportJobId(String(data.jobId));
      setFdbImportStatus('processing');
      setFdbImportMessage('KV rebuild queued.');
    } catch (err) {
      setFdbImportStatus('failed');
      setError(err instanceof Error ? err.message : 'Failed to start KV rebuild.');
    }
  }, [bergmanEventId, fdbFile]);

  const quickLinks = bergmanEventId.trim()
    ? [
        { label: 'Live tracking', href: `/live-tracking/${encodeURIComponent(bergmanEventId.trim())}` },
        { label: 'Public tracking', href: `/live-tracking/${encodeURIComponent(bergmanEventId.trim())}` },
        { label: 'Results', href: `/results/${encodeURIComponent(bergmanEventId.trim())}` },
      ]
    : [];

  const provider = providerConfig?.config?.feibotConfig;
  const providerState = providerConfig?.config?.providerState;
  const trackingEnabled = Boolean(providerConfig?.config?.trackingConfig?.enabled ?? true);
  const trackingVisibility = trackingEnabled ? 'Public' : 'Closed';

    const handleDisableLiveTracking = useCallback(async () => {
      if (!bergmanEventId.trim()) return;
      setDisablingLiveTracking(true);
      setMessage(null);
      setError(null);
      try {
        const response = await fetch(`/api/live/start-sync/${encodeURIComponent(bergmanEventId.trim())}`, {
          method: 'DELETE',
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          throw new Error(data?.message || `Request failed with HTTP ${response.status}`);
        }

        setMessage(data.message || 'Live tracking disabled.');
        invalidateJsonCache(`providerConfig:${bergmanEventId.trim()}`);
        await loadProviderConfig(bergmanEventId.trim());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to disable live tracking.');
      } finally {
        setDisablingLiveTracking(false);
      }
    }, [bergmanEventId, loadProviderConfig]);
  const linkedCloudEventUuid = String(provider?.cloud?.eventUuid || provider?.eventUuid || '').trim();
  const linkedLegacyEventUuid = String(provider?.legacyEventUuid || provider?.eventUuid || '').trim();
  const linkedResolvedEventUuid = String(provider?.resolvedEventUuid || provider?.cloud?.eventUuid || provider?.eventUuid || '').trim();
  const hasSavedCredentials = Boolean(provider?.hasCredentials || credentials?.configured);
  const authVerified =
    credentials?.lastAuthResult === 'success'
    || providerState?.authentication === 'verified'
    || providerState?.status === 'connected'
    || Boolean(provider?.cloud?.authenticated)
    || eventDiscoverySupported === true;
  const cloudConnected = Boolean(provider?.cloud?.eventUuid || selectedEventUuid);
  const publicScoreConfigured = Boolean(provider?.score?.eventUuid || selectedEventUuid);
  const connected = hasSavedCredentials && authVerified && cloudConnected;
  const selectedTicket = useMemo(
    () => {
      const tickets = courseConfig?.ticketDefinitions || [];
      if (!tickets.length) return null;
      return tickets.find((ticket) => ticket.id === selectedCourseTicketId) || tickets.find((ticket) => Boolean(ticket?.courseMaps)) || tickets[0] || null;
    },
    [courseConfig?.ticketDefinitions, selectedCourseTicketId],
  );
  const selectedCourseMaps = selectedTicket?.courseMaps || null;
  const splitMappingReady = useMemo(() => {
    if (!splitMappings) return false;

    const values = Array.isArray(splitMappings)
      ? splitMappings
      : Object.values(splitMappings as Record<string, any>);

    return values.some((mapping: any) => {
      if (!mapping) return false;
      if (Array.isArray(mapping)) return mapping.length > 0;
      if (Array.isArray(mapping?.splits)) return mapping.splits.length > 0;
      if (Array.isArray(mapping?.legs)) return mapping.legs.length > 0;
      return Boolean(mapping?.splitMappings?.length || mapping?.splits?.length || mapping?.legs?.length);
    });
  }, [splitMappings]);
  const splitMappingConfigured = Boolean(Number(splitMappingSummary?.mappedCount || 0) > 0);
  const visibleCourseAssetFields = useMemo(() => {
    if (!selectedTicket) return COURSE_ASSET_FIELDS;
    const profile = inferCourseProfile(selectedTicket as any);

    if (profile === 'swimathon') {
      return COURSE_ASSET_FIELDS.filter((asset) => asset.field === 'swimGpxUrl');
    }

    if (profile === 'duathlon') {
      const order = ['run1GpxUrl', 'bikeGpxUrl', 'run2GpxUrl', 'runGpxUrl'];
      return COURSE_ASSET_FIELDS
        .filter((asset) => order.includes(asset.field))
        .sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
    }

    if (profile === 'run-only') {
      return COURSE_ASSET_FIELDS.filter((asset) => ['runGpxUrl', 'run1GpxUrl', 'run2GpxUrl'].includes(asset.field));
    }

    return COURSE_ASSET_FIELDS.filter((asset) => ['swimGpxUrl', 'bikeGpxUrl', 'runGpxUrl'].includes(asset.field));
  }, [selectedTicket]);
  const feibotTimingSummary = timingRules?.timingRules || null;
  const selectedBergmanEventName = upcomingEvents.find((event) => event.id === bergmanEventId)?.name || bergmanEventId || 'Bergman event';
  const selectedFeibotEventUuid = selectedEventUuid.trim() || manualEventUuid.trim() || '—';
  const selectedFeibotEventName = selectedEvent?.name || (selectedFeibotEventUuid !== '—' ? 'Manual Feibot Event' : 'Not selected');
  const fdbLocalEventUuid = String(fdbImportSummary?.detected?.eventUuid || fdbMetadata?.database?.localEventUuid || '').trim();
  const fdbLatestSummary = fdbImportSummary || fdbMetadata?.latestSummary || null;
  const linkedEventUuid = linkedResolvedEventUuid || fdbLocalEventUuid || selectedEventUuid.trim() || manualEventUuid.trim() || '';
  const linkedEventName = selectedBergmanEventName;
  const hasParticipantImport = Number(feibotParticipantCount || fdbImportSummary?.counts?.participants || fdbMetadata?.database?.participants || 0) > 0;
  const linkedEventExists = Boolean(linkedEventUuid || bergmanEventId.trim());
  const canShowConnectedState = Boolean(credentials?.configured && linkedEventExists && hasParticipantImport);
  const databaseImported = Boolean(
    String(fdbLatestSummary?.status || fdbMetadata?.database?.status || '').trim().toUpperCase() === 'IMPORTED'
    || String(fdbLatestSummary?.status || '').trim().toUpperCase() === 'COMPLETED'
    || String(fdbLatestSummary?.status || '').trim().toUpperCase() === 'COMPLETED_WITH_WARNINGS'
    || Number(fdbLatestSummary?.counts?.participants || fdbMetadata?.database?.participants || 0) > 0
    || Boolean(fdbMetadata?.database?.uploadedAt || fdbLatestSummary?.completedAt || fdbMetadata?.database?.localEventUuid)
  );
  const mappedContests = useMemo(() => {
    const contests: any[] = Array.isArray(feibotTimingSummary?.contests)
      ? feibotTimingSummary.contests
      : Array.isArray(fdbImportSummary?.importedContests)
        ? fdbImportSummary.importedContests
        : [];
    const seen = new Set<string>();

    return contests
      .map((contest: any) => {
        const contestUuid = String(
          contest?.contest_uuid ??
          contest?.contestUuid ??
          contest?.contestUUID ??
          contest?.UUID ??
          contest?.uuid ??
          contest?.id ??
          '',
        ).trim();
        const contestName = String(
          contest?.contest_name ??
          contest?.contestName ??
          contest?.Name ??
          contest?.name ??
          '',
        ).trim();

        const dedupeKey = `${contestUuid || ''}::${contestName || ''}`.toLowerCase();
        if (!dedupeKey || seen.has(dedupeKey)) return null;
        seen.add(dedupeKey);

        return {
          contestUuid,
          contestName: contestName || (contestUuid ? `Contest ${contestUuid}` : 'Unnamed contest'),
        };
      })
      .filter((contest): contest is { contestUuid: string; contestName: string } => Boolean(contest));
  }, [feibotTimingSummary?.contests, fdbImportSummary?.importedContests]);

  const kvBuildReady = useMemo(() => {
    const validationComplete = Boolean(fdbImportSummary?.validation?.complete);
    const validationStatus = String(fdbImportSummary?.validationStatus || '').trim().toUpperCase();
    const importStatus = String(fdbImportSummary?.status || '').trim().toUpperCase();
    const kvRecords = Number(fdbImportSummary?.kvRecordsWritten || fdbMetadata?.database?.kvRecordsWritten || 0);

    if (validationComplete) return true;
    if (validationStatus === 'PASS' || validationStatus === 'WARNING' || validationStatus === 'TIMEOUT') return true;
    return importStatus.startsWith('COMPLETED') && kvRecords > 0;
  }, [fdbImportSummary?.status, fdbImportSummary?.validation?.complete, fdbImportSummary?.validationStatus, fdbImportSummary?.kvRecordsWritten, fdbMetadata?.database?.kvRecordsWritten]);

  const splitMappingGateReady = useMemo(() => {
    if (splitMappingReady) return true;

    const importedSplits = Number(fdbImportSummary?.counts?.splits || 0);
    const importedLegs = Number(fdbImportSummary?.counts?.legs || 0);
    const timingSplits = Array.isArray(feibotTimingSummary?.splits) ? feibotTimingSummary.splits.length : 0;
    const timingLegs = Array.isArray(feibotTimingSummary?.legs) ? feibotTimingSummary.legs.length : 0;
    const mappedContestCount = Array.isArray(mappedContests) ? mappedContests.length : 0;

    if (importedSplits > 0 || importedLegs > 0) return true;
    if (timingSplits > 0 || timingLegs > 0) return true;
    if (mappedContestCount > 0) return true;

    return Boolean(
      (selectedCourseMaps?.swimSplits?.length || 0) +
      (selectedCourseMaps?.bikeSplits?.length || 0) +
      ((selectedCourseMaps?.run2Splits?.length || 0) || (selectedCourseMaps?.runSplits?.length || 0)) > 0,
    );
  }, [fdbImportSummary?.counts?.legs, fdbImportSummary?.counts?.splits, feibotTimingSummary?.legs, feibotTimingSummary?.splits, mappedContests, selectedCourseMaps?.bikeSplits?.length, selectedCourseMaps?.run2Splits?.length, selectedCourseMaps?.runSplits?.length, selectedCourseMaps?.swimSplits?.length, splitMappingReady]);

  const updateCourseSplitDraft = useCallback((field: CourseSplitField, splitId: string, key: 'name' | 'distance', value: string) => {
    setCourseSplitDrafts((prev) => ({
      ...prev,
      [field]: (prev[field] || []).map((row) => (row.id === splitId ? { ...row, [key]: value } : row)),
    }));
  }, []);

  const resolveLegDistance = useCallback((distanceField: CourseDistanceField) => {
    const draft = String(courseDistanceDrafts[distanceField] || '').trim();
    if (draft) {
      const value = Number(draft);
      return Number.isFinite(value) ? value : 0;
    }

    const existing = Number((selectedCourseMaps as any)?.[distanceField]);
    return Number.isFinite(existing) ? existing : 0;
  }, [courseDistanceDrafts, selectedCourseMaps]);

  const autoGenerateSplitDraft = useCallback((asset: CourseAssetLabel) => {
    const legDistanceKm = resolveLegDistance(asset.distanceField);
    const intervalKm = Number(String(splitIntervalDrafts[asset.splitField] || '').trim());

    if (!Number.isFinite(legDistanceKm) || legDistanceKm <= 0) {
      setError(`${asset.label} distance must be greater than 0 to auto-generate split checkpoints.`);
      return;
    }

    if (!Number.isFinite(intervalKm) || intervalKm <= 0) {
      setError(`${asset.label} split interval must be greater than 0.`);
      return;
    }

    const rows = buildAutoSplitDrafts(asset.splitField, asset.label, legDistanceKm, intervalKm);
    setCourseSplitDrafts((prev) => ({
      ...prev,
      [asset.splitField]: rows,
    }));
    setMessage(`${asset.label} split checkpoints auto-generated.`);
    setError(null);
  }, [resolveLegDistance, splitIntervalDrafts]);

  const addCourseSplitDraft = useCallback((field: CourseSplitField) => {
    setCourseSplitDrafts((prev) => ({
      ...prev,
      [field]: [...(prev[field] || []), createEmptySplitDraft(field)],
    }));
  }, []);

  const removeCourseSplitDraft = useCallback((field: CourseSplitField, splitId: string) => {
    setCourseSplitDrafts((prev) => ({
      ...prev,
      [field]: (prev[field] || []).filter((row) => row.id !== splitId),
    }));
  }, []);

  useEffect(() => {
    if (!selectedTicket) {
      setCourseMapDrafts({});
      setCourseDistanceDrafts({ swimDistance: '', bikeDistance: '', runDistance: '', run1Distance: '', run2Distance: '' });
      setCourseDescriptionDrafts({ swimDescription: '', bikeDescription: '', runDescription: '', run1Description: '', run2Description: '' });
      setCourseSplitDrafts({ swimSplits: [], bikeSplits: [], runSplits: [], run1Splits: [], run2Splits: [] });
      setSplitIntervalDrafts(DEFAULT_SPLIT_INTERVALS);
      setCourseCutoffModeDraft('overall');
      setCourseCutoffDrafts({ overall: '', swim: '', bike: '', run: '', run1: '', run2: '' });
      return;
    }

    setSelectedCourseTicketId((prev) => (String(prev || '').trim() ? prev : String(selectedTicket.id || '').trim()));

    setCourseMapDrafts({
      swimGpxUrl: normalizeCourseMapUrl(selectedTicket.courseMaps?.swimGpxUrl),
      bikeGpxUrl: normalizeCourseMapUrl(selectedTicket.courseMaps?.bikeGpxUrl),
      runGpxUrl: normalizeCourseMapUrl(selectedTicket.courseMaps?.runGpxUrl),
      run1GpxUrl: normalizeCourseMapUrl(selectedTicket.courseMaps?.run1GpxUrl),
      run2GpxUrl: normalizeCourseMapUrl(selectedTicket.courseMaps?.run2GpxUrl),
    });
    setCourseDistanceDrafts({
      swimDistance: formatDistanceDraft(selectedTicket.courseMaps?.swimDistance),
      bikeDistance: formatDistanceDraft(selectedTicket.courseMaps?.bikeDistance),
      runDistance: formatDistanceDraft(selectedTicket.courseMaps?.runDistance),
      run1Distance: formatDistanceDraft(selectedTicket.courseMaps?.run1Distance),
      run2Distance: formatDistanceDraft(selectedTicket.courseMaps?.run2Distance),
    });
    setCourseDescriptionDrafts({
      swimDescription: selectedTicket.courseMaps?.swimDescription || '',
      bikeDescription: selectedTicket.courseMaps?.bikeDescription || '',
      runDescription: selectedTicket.courseMaps?.runDescription || '',
      run1Description: selectedTicket.courseMaps?.run1Description || '',
      run2Description: selectedTicket.courseMaps?.run2Description || '',
    });
    setCourseSplitDrafts({
      swimSplits: createSplitDraftRows(selectedTicket.courseMaps?.swimSplits),
      bikeSplits: createSplitDraftRows(selectedTicket.courseMaps?.bikeSplits),
      runSplits: createSplitDraftRows(selectedTicket.courseMaps?.runSplits),
      run1Splits: createSplitDraftRows(selectedTicket.courseMaps?.run1Splits),
      run2Splits: createSplitDraftRows(selectedTicket.courseMaps?.run2Splits),
    });
    setSplitIntervalDrafts(DEFAULT_SPLIT_INTERVALS);
    setCourseCutoffModeDraft(selectedTicket.cutoffs?.mode || 'overall');
    setCourseCutoffDrafts({
      overall: selectedTicket.cutoffs?.overall || '',
      swim: selectedTicket.cutoffs?.swim || '',
      bike: selectedTicket.cutoffs?.bike || '',
      run: selectedTicket.cutoffs?.run || '',
      run1: selectedTicket.cutoffs?.run1 || '',
      run2: selectedTicket.cutoffs?.run2 || '',
    });
  }, [selectedTicket]);

  useEffect(() => {
    if (selectedCourseTicketId) return;
    const fallbackTicket = courseConfig?.ticketDefinitions?.find((ticket) => Boolean(ticket?.courseMaps)) || courseConfig?.ticketDefinitions?.[0] || null;
    if (fallbackTicket?.id) {
      setSelectedCourseTicketId(String(fallbackTicket.id));
    }
  }, [courseConfig?.ticketDefinitions, selectedCourseTicketId]);

  const previewEvent = useMemo(() => ({
    id: bergmanEventId || 'preview',
    eventName: selectedBergmanEventName,
    ticketDefinitions: courseConfig?.ticketDefinitions || [],
  }), [bergmanEventId, courseConfig?.ticketDefinitions, selectedBergmanEventName]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
            <Sparkles className="h-3.5 w-3.5" />
            Secure Feibot credentials
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Live Tracking Hub</h2>
          <p className="max-w-2xl text-sm text-white/70">
            Store Feibot credentials on the server, discover events automatically, and unlock live tracking only after validation succeeds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusTone(credentials?.configured)} className="bg-white/10 text-white hover:bg-white/15">
            {credentials?.configured ? 'Credentials stored' : 'Not configured'}
          </Badge>
          <Badge variant="outline" className="border-white/20 text-white/80">
            {credentials?.encryptionEnabled ? 'AES-256-GCM enabled' : 'Encryption unknown'}
          </Badge>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {message ? (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {credentials?.configured && !isBergmanEventLinked ? (
        <Alert>
          <AlertDescription>
            Backend Feibot credentials are available, but this Bergman event has not been linked yet.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'setup' | 'contest_mapping' | 'leg_split_mapping' | 'course_maps' | 'feibot_sync' | 'upload_results')} className="w-full">
        <div className="sm:hidden">
          <label htmlFor="live-tracking-hub-tab-select" className="mb-2 block text-xs font-medium text-muted-foreground">
            Select section
          </label>
          <select
            id="live-tracking-hub-tab-select"
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as 'setup' | 'contest_mapping' | 'leg_split_mapping' | 'course_maps' | 'feibot_sync' | 'upload_results')}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
          >
            <option value="setup">Setup</option>
            <option value="contest_mapping">Contest Mapping</option>
            <option value="leg_split_mapping">Leg & Split Mapping</option>
            <option value="course_maps">Course Maps</option>
            <option value="feibot_sync">Feibot Sync</option>
            <option value="upload_results">Upload Results</option>
          </select>
        </div>

        <TabsList className="hidden w-full grid-cols-6 sm:grid">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="contest_mapping">Contest Mapping</TabsTrigger>
          <TabsTrigger value="leg_split_mapping">Leg & Split Mapping</TabsTrigger>
          <TabsTrigger value="course_maps">Course Maps</TabsTrigger>
          <TabsTrigger value="feibot_sync">Feibot Sync</TabsTrigger>
          <TabsTrigger value="upload_results">Upload Results</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="mt-6 space-y-6">
            {/* ===== Event Configuration ===== */}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
              <Card className="xl:col-span-1">
                <CardHeader className="pb-3">
                  <CardTitle>Event Configuration</CardTitle>
                  <CardDescription>Link your Bergman event to a Feibot event for live tracking integration.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">Bergman Event</div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void loadUpcomingEvents()}
                        disabled={loadingUpcomingEvents}
                      >
                        <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loadingUpcomingEvents ? 'animate-spin' : ''}`} />
                        Refresh upcoming events
                      </Button>
                    </div>
                    <select
                      value={bergmanEventId}
                      onChange={(e) => setBergmanEventId(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    >
                      <option value="">Select an upcoming Bergman event</option>
                      {upcomingEvents.map((event) => (
                        <option key={event.id} value={event.id}>
                          {event.name}{event.date ? ` • ${event.date}` : ''}
                        </option>
                      ))}
                    </select>
                    {!upcomingEvents.length ? (
                      <p className="text-xs text-muted-foreground">No upcoming Bergman events found yet.</p>
                    ) : null}
                  </div>

                  {events.length ? events.map((event) => {
                    const active = event.event_uuid === selectedEventUuid;
                    return (
                      <button
                        key={event.event_uuid}
                        type="button"
                        onClick={() => {
                          setSelectedEventUuid(event.event_uuid);
                          setManualEventUuid('');
                          if (bergmanEventId.trim()) {
                            void handleSaveProviderConfig(event.event_uuid);
                          }
                        }}
                        className={`w-full rounded-lg border p-3 text-left transition ${active ? 'border-slate-900 bg-slate-50' : 'hover:bg-slate-50/80'}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="font-medium">{event.name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{event.event_uuid}</div>
                            {event.score_event_uuid ? <div className="mt-1 text-xs text-muted-foreground">Score data available</div> : null}
                          </div>
                          <div className="flex items-center gap-2">
                            {active ? <Badge variant="default"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Selected</Badge> : <Badge variant="outline">Use event</Badge>}
                          </div>
                        </div>
                      </button>
                    );
                  }) : null}

                  <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                    Selected event: <span className="font-medium text-foreground">{selectedEvent?.name || linkedEventName || '—'}</span>
                    <div className="mt-1 break-all">{selectedEventUuid || manualEventUuid || 'No Feibot event selected yet.'}</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void loadEvents()} disabled={loadingEvents}>
                      {loadingEvents ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      {loadingEvents ? 'Refreshing…' : 'Refresh events'}
                    </Button>
                    <Button size="sm" onClick={() => void handleSaveProviderConfig()} disabled={!bergmanEventId.trim() || !resolvedEventUuid.trim()}>
                      Save event link
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>Readiness gates</CardTitle>
                  <CardDescription>Live tracking can only be enabled after all checks pass.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[
                    { label: 'Credentials stored', ok: readiness.hasCreds },
                    { label: 'Feibot event selected', ok: readiness.hasSelectedEvent },
                    { label: 'Bergman event ID set', ok: readiness.hasBergmanEvent },
                    { label: 'Connection verified', ok: readiness.authOk },
                    { label: 'Database imported', ok: databaseImported },
                    { label: 'Event link extracted', ok: Boolean(fdbMetadata?.database?.localEventUuid || fdbImportSummary?.detected?.eventUuid) },
                    { label: 'KV built', ok: Boolean(fdbImportSummary?.validation?.complete) },
                    { label: 'Participants imported', ok: Number(fdbImportSummary?.counts?.participants || fdbMetadata?.database?.participants || 0) > 0 },
                    { label: 'Split mapping', ok: splitMappingConfigured || splitMappingReady || Boolean((selectedCourseMaps?.swimSplits?.length || 0) + (selectedCourseMaps?.bikeSplits?.length || 0) + ((selectedCourseMaps?.run2Splits?.length || 0) || (selectedCourseMaps?.runSplits?.length || 0)) > 0) },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                      <span className="font-medium">{item.label}</span>
                      <Badge variant={item.ok ? 'default' : 'secondary'}>{item.ok ? 'Ready' : 'Pending'}</Badge>
                    </div>
                  ))}

                  <Button className="w-full" onClick={() => void handleEnableLiveTracking()} disabled={!readiness.ready || enablingLiveTracking}>
                    {enablingLiveTracking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                    {enablingLiveTracking ? 'Enabling…' : 'Enable Live Tracking'}
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => void handleDisableLiveTracking()}
                    disabled={!bergmanEventId.trim() || disablingLiveTracking || !trackingEnabled}
                  >
                    {disablingLiveTracking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    {disablingLiveTracking ? 'Disabling…' : 'Disable Live Tracking'}
                  </Button>

                  <div className="text-xs text-muted-foreground">
                    Tracking status: <span className="font-medium">{trackingVisibility}</span>
                  </div>

                  {!readiness.ready ? (
                    <p className="text-xs text-muted-foreground">
                      The enable action stays locked until credentials are saved, an event is selected, the Bergman event ID is entered, and the connection is verified.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Feibot API Credentials</h3>
              <p className="text-sm text-muted-foreground">
                Secrets are sent only to the backend. The browser never receives the Secret Key back.
              </p>
              <FeibotCredentialCards
                bergmanEventId={bergmanEventId}
                resolvedEventUuid={resolvedEventUuid}
                lockedApiBaseUrl={lockedApiBaseUrl}
                apiBaseUrl={lockedApiBaseUrl}
                credentials={credentials}
                loadStatus={async () => {
                  await loadStatus();
                  const eventId = bergmanEventId.trim();
                  if (eventId) {
                    await loadCredentials(eventId);
                    await loadSplitMappings(eventId);
                  }
                }}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Provider Status</CardTitle>
                <CardDescription>Current secure backend state.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <StatusRow label="Provider" value="Feibot" />
                <StatusRow label="Provider Status" value={connected ? '🟢 Connected' : '🟡 Configured, verification pending'} />
                <StatusRow label="Credential Source" value={credentials?.source || provider?.credentialsSource || 'feibot'} />
                <StatusRow label="Authentication" value={authVerified ? 'Verified' : 'Configured'} />
                <StatusRow label="Cloud API" value={cloudConnected ? 'Connected' : '—'} />
                <StatusRow label="Cloud Timing Rules" value={provider?.timingRuleSource || '—'} />
                <StatusRow label="Cloud API Event" value={cloudConnected ? '🟢 Connected' : '—'} />
                <StatusRow label="Active Source" value="Cloud API" />
                <StatusRow label="Public Score" value={publicScoreConfigured ? 'Configured' : '—'} />
                <StatusRow label="Last Sync" value={formatRelative(providerState?.updatedAt || credentials?.updatedAt)} />
                <StatusRow label="API Response" value={providerConfig?.message || '—'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Feibot Authentication</CardTitle>
                <CardDescription>Configured values are masked. Access Key and Secret Key are never exposed to the browser.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Access Key</div>
                  <div className="mt-1 font-medium">{credentials?.accessKey || '********************'}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Secret Key</div>
                  <div className="mt-1 font-medium">{credentials?.secretKey || '****************************'}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Source</div>
                  <div className="mt-1 font-medium">{credentials?.source || 'none'}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Encryption</div>
                  <div className="mt-1 font-medium">{credentials?.encryptionEnabled ? '🔐 AES-256-GCM' : '—'}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Last Auth</div>
                  <div className="mt-1 font-medium">{credentials?.lastAuthResult || '—'}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Connection</div>
                  <div className="mt-1 font-medium">{connected ? '🟢 Connected' : '🟡 Verification pending'}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Version</div>
                  <div className="mt-1 font-medium">{credentials?.version ?? '—'}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Validated Event Link</div>
                  <div className="mt-1 font-medium break-all">{linkedEventName}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Mapped Splits</div>
                  <div className="mt-1 font-medium">{loadingSplitMappings ? 'Loading…' : String(splitMappingSummary?.mappedCount || 0)}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Credential Usage</CardTitle>
                <CardDescription>Shows which credential type is being used for each API endpoint.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 text-sm">
                  <div className="flex items-start justify-between rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium">Timing Rules API</div>
                      <div className="text-xs text-muted-foreground mt-1">/eventConfigFile/timingRulesGet</div>
                    </div>
                    <Badge variant="outline" className="ml-2 flex-shrink-0">
                      Auto Mode
                    </Badge>
                  </div>

                  <div className="flex items-start justify-between rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium">Participants API</div>
                      <div className="text-xs text-muted-foreground mt-1">/temporary/participantsGetAll</div>
                    </div>
                    <Badge variant="outline" className="ml-2 flex-shrink-0">
                      Auto Mode
                    </Badge>
                  </div>

                  <div className="flex items-start justify-between rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium">Live Results API</div>
                      <div className="text-xs text-muted-foreground mt-1">/temporary/temporary_ResultDataGetAll</div>
                    </div>
                    <Badge variant="outline" className="ml-2 flex-shrink-0">
                      Auto Mode
                    </Badge>
                  </div>

                  <Alert className="mt-3">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      <strong>Auto Mode:</strong> System prioritizes Event credentials when configured. Event credentials are strictly validated against their stored bound Feibot Event UUID before request dispatch.
                    </AlertDescription>
                  </Alert>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick links</CardTitle>
                <CardDescription>Open the event runtime once the Bergman event ID is set.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {quickLinks.length ? quickLinks.map((item) => (
                  <Button key={item.label} asChild variant="outline" className="w-full justify-between">
                    <a href={item.href} target="_blank" rel="noreferrer">
                      {item.label}
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                )) : (
                  <div className="rounded-lg border p-3 text-sm text-muted-foreground">Enter a Bergman event ID to reveal runtime links.</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Deployment summary</CardTitle>
              <CardDescription>Firestore stores credentials securely, Feibot is validated server-side, and public runtime stays on KV.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3 text-sm">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Storage</div>
                <div className="mt-1 font-medium flex items-center gap-2"><KeyRound className="h-4 w-4 text-emerald-600" />Encrypted backend secrets</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Runtime</div>
                <div className="mt-1 font-medium flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" />Firestore writes, KV reads</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Selected Feibot Event</div>
                <div className="mt-1 font-medium break-all">{selectedFeibotEventName}</div>
                <div className="mt-1 text-xs text-muted-foreground">Linked event saved on the backend</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mapped contests</CardTitle>
              <CardDescription>Contest entries loaded from Feibot timing rules for the selected event.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <StatusRow label="Contests loaded" value={String(mappedContests.length)} />
              {mappedContests.length ? (
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-[11px] font-medium text-muted-foreground">Contest mappings</div>
                  <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-hidden">
                    {mappedContests.slice(0, 12).map((contest: { contestUuid: string; contestName: string }) => (
                      <Badge key={`${contest.contestUuid || contest.contestName}`} variant="outline" className="max-w-full truncate px-2 py-0.5 text-[11px]">
                        {contest.contestName}
                      </Badge>
                    ))}
                  </div>
                  {mappedContests.length > 12 ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">+{mappedContests.length - 12} more contests</div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-lg border px-3 py-2 text-[11px] text-muted-foreground">
                  No contest mappings loaded yet. Fetch Feibot timing rules to populate contests.
                </div>
              )}
              {(fdbLocalEventUuid || selectedBergmanEventName) ? (
                <div className="rounded-lg border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                  Bergman Event: {selectedBergmanEventName}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Feibot Event Database</CardTitle>
              <CardDescription>Import the official Feibot .fdb SQLite export and bootstrap event configuration, participants, and KV indexes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {/* Bergman event selector */}
              <div className="space-y-1.5">
                <div className="text-xs uppercase font-black tracking-widest text-muted-foreground">Bergman event</div>
                {upcomingEvents.length > 0 ? (
                  <select
                    value={bergmanEventId}
                    onChange={(e) => setBergmanEventId(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  >
                    <option value="">Select a Bergman event</option>
                    {upcomingEvents.map((event) => (
                      <option key={event.id} value={event.id}>{event.name}{event.date ? ` • ${event.date}` : ''}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    placeholder="Enter Bergman event ID (e.g. my-event-2025)"
                    value={bergmanEventId}
                    onChange={(e) => setBergmanEventId(e.target.value)}
                  />
                )}
                {bergmanEventId.trim() ? (
                  <div className="text-xs text-muted-foreground">Selected: <span className="font-medium text-foreground">{selectedBergmanEventName}</span></div>
                ) : (
                  <div className="text-xs text-amber-600">⚠ Select or enter a Bergman event ID before uploading.</div>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs uppercase font-black tracking-widest text-muted-foreground">Selected file</div>
                  <Input
                    type="file"
                    accept=".fdb,.sqlite,.db,application/octet-stream"
                    onChange={(e) => setFdbFile(e.target.files?.[0] || null)}
                  />
                  <div className="text-xs text-muted-foreground">Only SQLite database files are accepted.</div>
                </div>
                <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-2 text-xs uppercase font-black tracking-widest">
                    <span>Status</span>
                    <span>{fdbImportStatus.toUpperCase().replace(/_/g, ' ')}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{fdbImportMessage || 'Waiting for database upload...'}</p>
                  <div className="text-xs text-muted-foreground">
                    File: {fdbFile
                      ? `${fdbFile.name} • ${(fdbFile.size / (1024 * 1024)).toFixed(1)} MB`
                      : fdbMetadata?.database?.fileName
                        ? `${fdbMetadata.database.fileName} • ${((Number(fdbMetadata?.database?.fileSize || 0) || 0) / (1024 * 1024)).toFixed(1)} MB`
                        : 'No file selected'}
                  </div>
                  <div className="text-xs text-muted-foreground">Bergman Event: {selectedBergmanEventName}</div>
                  <div className="text-xs text-muted-foreground">Current Stage: {fdbImportStage || '—'}</div>
                  <div className="text-xs text-muted-foreground">Uploaded: {formatDateTime(fdbMetadata?.database?.uploadedAt)}</div>
                  <div className="text-xs text-muted-foreground">Progress: {Math.round(fdbImportProgress)}%</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void handleStartFdbImport()} disabled={!bergmanEventId.trim() || !fdbFile || (fdbImportStatus === 'processing' && !!fdbImportJobId)}>
                  {fdbImportStatus === 'processing' || fdbImportStatus === 'uploading' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Import Database
                </Button>
                <Button variant="outline" onClick={() => void handleRebuildFdbKv()} disabled={!bergmanEventId.trim() || !fdbFile || (fdbImportStatus === 'processing' && !!fdbImportJobId)}>
                  Rebuild KV
                </Button>
                <Button variant="destructive" onClick={() => void handleCancelFdbImport()} disabled={!bergmanEventId.trim() || fdbImportStatus !== 'processing'}>
                  Cancel Import
                </Button>
              </div>

              {fdbImportSummary ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                    <StatusRow label="Import Status" value={fdbImportSummary?.status === 'COMPLETED' ? '✅ Completed' : fdbImportSummary?.status === 'COMPLETED_WITH_WARNINGS' ? '⚠️ Completed with Warnings' : String(fdbImportSummary?.status || '—').replace(/_/g, ' ')} />
                    <StatusRow label="Bergman Event" value={selectedBergmanEventName} />
                    <StatusRow label="Feibot Event UUID" value={selectedFeibotEventUuid} />
                    <StatusRow label="Feibot Event Status" value={connected ? 'Connected' : 'Pending'} />
                    <StatusRow label="Provider Config" value={linkedResolvedEventUuid ? 'Saved' : 'Not saved'} />
                    <StatusRow label="File" value={fdbMetadata?.database?.fileName || fdbFile?.name || '—'} />
                    <StatusRow label="File Size" value={fdbFile ? `${(fdbFile.size / (1024 * 1024)).toFixed(1)} MB` : fdbMetadata?.database?.fileSize ? `${((Number(fdbMetadata?.database?.fileSize || 0) || 0) / (1024 * 1024)).toFixed(1)} MB` : '—'} />
                    <StatusRow label="Imported On" value={formatDateTime(fdbMetadata?.database?.uploadedAt || fdbImportSummary?.completedAt)} />
                    <StatusRow label="Import Duration" value={fdbImportSummary?.importDurationMs ? `${Math.round(fdbImportSummary.importDurationMs / 1000)} sec` : '—'} />
                    <StatusRow label="Tables" value={String(fdbImportSummary?.detected?.numberOfTables ?? 0)} />
                    <StatusRow label="Participants Imported" value={String(fdbImportSummary?.counts?.participants ?? 0)} />
                    <StatusRow label="Contests" value={String(fdbImportSummary?.counts?.contests ?? 0)} />
                    <StatusRow label="Splits Imported" value={String(fdbImportSummary?.counts?.splits ?? 0)} />
                    <StatusRow label="Timing Points Imported" value={String(fdbImportSummary?.counts?.timingPoints ?? 0)} />
                    <StatusRow label="Race Legs Imported" value={String(fdbImportSummary?.counts?.legs ?? 0)} />
                    <StatusRow label="Age Groups Imported" value={String(fdbImportSummary?.counts?.ageGroups ?? 0)} />
                    <StatusRow label="Timing Devices Imported" value={String(fdbImportSummary?.counts?.devices ?? 0)} />
                    <StatusRow label="Active participants" value={String(fdbImportSummary?.counts?.activeParticipants ?? 0)} />
                    <StatusRow label="Unknown Tables" value={String(fdbImportSummary?.unknownTables?.length ?? 0)} />
                    <StatusRow label="KV Records" value={String(fdbImportSummary?.kvRecordsWritten ?? fdbMetadata?.database?.kvRecordsWritten ?? 0)} />
                    <StatusRow label="Validation" value={fdbImportSummary?.validationStatus === 'PASS' || fdbImportSummary?.validation?.complete ? '✅ Validation Successful' : fdbImportSummary?.validationStatus === 'TIMEOUT' ? '⚠️ Validation Timed Out' : fdbImportSummary?.validationStatus === 'WARNING' ? '⚠️ Validation Completed with Warnings' : '⏳ Validating'} />
                    <StatusRow label="Warnings" value={String(fdbImportSummary?.warnings ?? fdbMetadata?.database?.warnings ?? 0)} />
                    <StatusRow label="Errors" value={String(fdbImportSummary?.errors ?? fdbMetadata?.database?.errors ?? 0)} />
                  </div>

                  {/* ── Unknown tables detail ── */}
                  {Array.isArray(fdbImportSummary?.unknownTables) && fdbImportSummary.unknownTables.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
                      <div className="text-sm font-semibold text-amber-800">⚠️ Unknown Tables ({fdbImportSummary.unknownTables.length})</div>
                      <div className="text-xs text-amber-700">These tables were present in the .fdb file but not imported (no recognized category).</div>
                      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3 max-h-36 overflow-auto">
                        {fdbImportSummary.unknownTables.map((t: any, i: number) => (
                          <div key={`${String(t?.name || i)}-${i}`} className="rounded border border-amber-200 bg-white px-2 py-1 text-xs text-amber-900">
                            <div className="font-medium break-all">{String(t?.name || 'unknown')}</div>
                            <div className="mt-0.5 text-amber-600">{Number(t?.rowCount || 0)} rows · {Number(t?.columnCount || 0)} cols</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* ── Validation missing KV keys ── */}
                  {Array.isArray(fdbImportSummary?.validation?.missingKeys) && fdbImportSummary.validation.missingKeys.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
                      <div className="text-sm font-semibold text-amber-800">⚠️ Missing KV Keys ({fdbImportSummary.validation.missingKeys.length})</div>
                      <div className="text-xs text-amber-700">These KV keys were expected after import but were not found. Re-import or Rebuild KV to fix.</div>
                      <div className="max-h-28 overflow-auto space-y-1">
                        {fdbImportSummary.validation.missingKeys.map((key: string, i: number) => (
                          <div key={`${key}-${i}`} className="rounded border border-amber-200 bg-white px-2 py-1 text-xs font-mono text-amber-900 break-all">{key}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* ── Warning messages ── */}
                  {Array.isArray(fdbImportSummary?.warningMessages) && fdbImportSummary.warningMessages.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
                      <div className="text-sm font-semibold text-amber-800">⚠️ Import Warnings ({fdbImportSummary.warningMessages.length})</div>
                      <div className="max-h-48 overflow-auto space-y-1">
                        {fdbImportSummary.warningMessages.map((msg: string, i: number) => (
                          <div key={i} className="rounded border border-amber-200 bg-white px-2 py-1 text-xs text-amber-900 break-all">{msg}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* ── Error messages ── */}
                  {(Number(fdbImportSummary?.errors ?? 0) > 0 || (Array.isArray(fdbImportSummary?.errorMessages) && fdbImportSummary.errorMessages.length > 0)) ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
                      <div className="text-sm font-semibold text-red-800">
                        ❌ Import Errors ({Number(fdbImportSummary?.errors ?? fdbMetadata?.database?.errors ?? 0)})
                      </div>
                      {Array.isArray(fdbImportSummary?.errorMessages) && fdbImportSummary.errorMessages.length > 0 ? (
                        <div className="max-h-64 overflow-auto space-y-1">
                          {fdbImportSummary.errorMessages.map((msg: string, i: number) => (
                            <div key={i} className="rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-900 break-all font-mono">{msg}</div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-red-700">
                          {Number(fdbImportSummary?.errors ?? 0)} KV write failure{Number(fdbImportSummary?.errors ?? 0) !== 1 ? 's' : ''} occurred during import. See the Runtime KV Logs below (FAILED entries) for details. These are usually Cloudflare KV timeout errors — re-running the import typically resolves them.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Event link verification</div>
                    <div className="text-xs text-muted-foreground">Linked event: {linkedEventName}</div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void handleTestEventUuid()}
                    disabled={eventUuidTestLoading || (!bergmanEventId.trim() && !selectedEventUuid.trim() && !fdbMetadata?.database?.localEventUuid)}
                  >
                    {eventUuidTestLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {eventUuidTestLoading ? 'Testing…' : 'Test Event Link'}
                  </Button>
                </div>

                {eventUuidTestResult ? (
                  <div className="space-y-2 text-xs">
                    <div className={`font-medium ${eventUuidTestResult?.success ? 'text-emerald-600' : 'text-red-600'}`}>
                      {eventUuidTestResult?.success ? '✓ Event link valid' : '❌ Event link invalid'}
                    </div>
                    <div>HTTP Status: {String(eventUuidTestResult?.httpStatus ?? '—')}</div>
                    <div>Request URL: {String(eventUuidTestResult?.diagnostics?.requestUrl || '—')}</div>
                    <div>Request Path: {String(eventUuidTestResult?.diagnostics?.requestPath || '—')}</div>
                    <div>Sorted Query: {String(eventUuidTestResult?.diagnostics?.sortedQuery || '—')}</div>
                    <div className="break-all">String To Sign: {String(eventUuidTestResult?.diagnostics?.stringToSign || '—')}</div>
                    <div className="break-all">Generated Signature: {String(eventUuidTestResult?.diagnostics?.generatedSignatureMasked || '—')}</div>
                    <div className="break-all">Response: {String(eventUuidTestResult?.rawJson || eventUuidTestResult?.message || '—').slice(0, 1000)}</div>
                  </div>
                ) : null}
              </div>

              {fdbImportLogs.length ? (
                <LogsPanel logs={fdbImportLogs} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contest_mapping" className="mt-6 space-y-6">
          <ContestMappingPanel eventId={bergmanEventId.trim()} />
        </TabsContent>

        <TabsContent value="leg_split_mapping" className="mt-6 space-y-6">
          <LegSplitMappingAdmin eventId={bergmanEventId.trim()} />
        </TabsContent>

        <TabsContent value="course_maps" className="mt-6 space-y-6">
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-3">
              <CardHeader>
                <CardTitle>Course map assets</CardTitle>
                <CardDescription>Upload GPX files or paste GPX URLs. Changes are saved back to the selected Bergman ticket configuration.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="space-y-2">
                    <div className="text-xs uppercase font-black tracking-widest text-muted-foreground">Selected Bergman event</div>
                    <select
                      value={bergmanEventId}
                      onChange={(e) => setBergmanEventId(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    >
                      <option value="">Select an event</option>
                      {upcomingEvents.map((event) => (
                        <option key={event.id} value={event.id}>{event.name}{event.date ? ` • ${event.date}` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2 md:col-span-1 xl:col-span-2">
                    <div className="text-xs uppercase font-black tracking-widest text-muted-foreground">Category</div>
                    <select
                      value={selectedTicket?.id || ''}
                      onChange={(e) => setSelectedCourseTicketId(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    >
                      <option value="">Select a category</option>
                      {(courseConfig?.ticketDefinitions || []).map((ticket) => (
                        <option key={ticket.id} value={ticket.id}>
                          {ticket.ticketName}{ticket.courseMaps ? '' : ' (no course maps yet)'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {selectedTicket ? (
                  <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs uppercase tracking-widest text-muted-foreground">Selected category</div>
                        <div className="mt-1 text-base font-semibold">{selectedTicket.ticketName}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{selectedTicket.ticketName || 'Category'} · {selectedTicket.id}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{selectedTicket.courseMaps ? 'Course maps loaded' : 'No maps saved yet'}</Badge>
                        <Button variant="ghost" onClick={() => {
                          setCourseMapDrafts({
                            swimGpxUrl: normalizeCourseMapUrl(selectedTicket.courseMaps?.swimGpxUrl),
                            bikeGpxUrl: normalizeCourseMapUrl(selectedTicket.courseMaps?.bikeGpxUrl),
                            runGpxUrl: normalizeCourseMapUrl(selectedTicket.courseMaps?.runGpxUrl),
                            run1GpxUrl: normalizeCourseMapUrl(selectedTicket.courseMaps?.run1GpxUrl),
                            run2GpxUrl: normalizeCourseMapUrl(selectedTicket.courseMaps?.run2GpxUrl),
                          });
                          setCourseDistanceDrafts({
                            swimDistance: formatDistanceDraft(selectedTicket.courseMaps?.swimDistance),
                            bikeDistance: formatDistanceDraft(selectedTicket.courseMaps?.bikeDistance),
                            runDistance: formatDistanceDraft(selectedTicket.courseMaps?.runDistance),
                            run1Distance: formatDistanceDraft(selectedTicket.courseMaps?.run1Distance),
                            run2Distance: formatDistanceDraft(selectedTicket.courseMaps?.run2Distance),
                          });
                          setCourseDescriptionDrafts({
                            swimDescription: selectedTicket.courseMaps?.swimDescription || '',
                            bikeDescription: selectedTicket.courseMaps?.bikeDescription || '',
                            runDescription: selectedTicket.courseMaps?.runDescription || '',
                            run1Description: selectedTicket.courseMaps?.run1Description || '',
                            run2Description: selectedTicket.courseMaps?.run2Description || '',
                          });
                          setCourseSplitDrafts({
                            swimSplits: createSplitDraftRows(selectedTicket.courseMaps?.swimSplits),
                            bikeSplits: createSplitDraftRows(selectedTicket.courseMaps?.bikeSplits),
                            runSplits: createSplitDraftRows(selectedTicket.courseMaps?.runSplits),
                            run1Splits: createSplitDraftRows(selectedTicket.courseMaps?.run1Splits),
                            run2Splits: createSplitDraftRows(selectedTicket.courseMaps?.run2Splits),
                          });
                          setSplitIntervalDrafts(DEFAULT_SPLIT_INTERVALS);
                          setCourseCutoffModeDraft(selectedTicket.cutoffs?.mode || 'overall');
                          setCourseCutoffDrafts({
                            overall: selectedTicket.cutoffs?.overall || '',
                            swim: selectedTicket.cutoffs?.swim || '',
                            bike: selectedTicket.cutoffs?.bike || '',
                            run: selectedTicket.cutoffs?.run || '',
                            run1: selectedTicket.cutoffs?.run1 || '',
                            run2: selectedTicket.cutoffs?.run2 || '',
                          });
                        }}>Load saved maps</Button>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                      {visibleCourseAssetFields.map((asset) => (
                        <div key={`${asset.field}-summary`} className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">{asset.label} Distance</div>
                          <div className="mt-1 font-semibold">{formatDistance((selectedCourseMaps as any)?.[asset.distanceField])}</div>
                          <div className="mt-2 text-xs text-muted-foreground whitespace-pre-line">{(selectedCourseMaps as any)?.[asset.descriptionField] || '—'}</div>
                          <div className="mt-2 text-xs break-all text-slate-600">{normalizeCourseMapUrl((selectedCourseMaps as any)?.[asset.field]) || 'No GPX URL'}</div>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                      {visibleCourseAssetFields.map((asset) => (
                        <div key={`${asset.field}-splits`} className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">{asset.label} Splits</div>
                          <div className="mt-1 text-lg font-semibold">{((selectedCourseMaps as any)?.[asset.splitField] || []).length}</div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-lg border bg-background p-3 space-y-3">
                      <div>
                        <div className="text-xs uppercase font-black tracking-widest text-muted-foreground">Segment Distances (KM)</div>
                        <div className="text-xs text-muted-foreground">Restore the old event-wise distance editor for each race category.</div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                        {visibleCourseAssetFields.map((asset) => (
                          <div key={`${asset.distanceField}-draft`} className="space-y-2">
                            <div className="text-xs font-medium text-muted-foreground">{asset.label} Distance</div>
                            <Input
                              type="number"
                              min="0"
                              step="0.1"
                              value={courseDistanceDrafts[asset.distanceField]}
                              onChange={(e) => setCourseDistanceDrafts((prev) => ({ ...prev, [asset.distanceField]: e.target.value }))}
                              placeholder="0.0"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border bg-background p-3 space-y-4">
                      <div>
                        <div className="text-xs uppercase font-black tracking-widest text-muted-foreground">Map Assets & Segment Descriptions</div>
                        <div className="text-xs text-muted-foreground">Save event-wise GPX URLs, uploads, and leg descriptions.</div>
                      </div>

                      {visibleCourseAssetFields.map((asset) => {
                        const currentUrl = String(courseMapDrafts[asset.field] || (selectedCourseMaps as any)?.[asset.field] || '');
                        const currentSplits = courseSplitDrafts[asset.splitField] || [];

                        return (
                          <div key={asset.field} className="rounded-xl border p-4 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold">{asset.label}</div>
                                <div className="text-xs text-muted-foreground">Distance: {formatDistance(courseDistanceDrafts[asset.distanceField] ? Number(courseDistanceDrafts[asset.distanceField]) : (selectedCourseMaps as any)?.[asset.distanceField])}</div>
                              </div>
                              <Badge variant="outline">{asset.field}</Badge>
                            </div>

                            <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_auto] md:items-end">
                              <div className="space-y-2">
                                <div className="text-xs uppercase font-black tracking-widest text-muted-foreground">GPX URL</div>
                                <Input
                                  value={currentUrl}
                                  onChange={(e) => setCourseMapDrafts((prev) => ({ ...prev, [asset.field]: e.target.value }))}
                                  placeholder={`Paste ${asset.label.toLowerCase()} GPX URL`}
                                />
                              </div>
                              <div className="space-y-2">
                                <div className="text-xs uppercase font-black tracking-widest text-muted-foreground">Upload GPX file</div>
                                <Input
                                  type="file"
                                  accept=".gpx,application/gpx+xml,application/xml,text/xml"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) void handleUploadCourseMapAsset(asset.field, file);
                                    e.currentTarget.value = '';
                                  }}
                                  disabled={courseMapUploadingField === asset.field}
                                />
                              </div>
                              <div className="flex flex-wrap gap-2 md:justify-end">
                                <Button variant="outline" onClick={() => void handleSaveCourseMapUrl(asset.field)} disabled={courseMapSavingField === asset.field || !bergmanEventId.trim()}>
                                  {courseMapSavingField === asset.field ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                  Save URL
                                </Button>
                                <Button variant="ghost" onClick={() => setCourseMapPreviewOpen(true)} disabled={!selectedTicket}>
                                  {courseMapUploadingField === asset.field ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                  {courseMapUploadingField === asset.field ? 'Uploading…' : 'View map'}
                                </Button>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="text-xs uppercase font-black tracking-widest text-muted-foreground">{asset.label} Description</div>
                              <Textarea
                                value={courseDescriptionDrafts[asset.descriptionField]}
                                onChange={(e) => setCourseDescriptionDrafts((prev) => ({ ...prev, [asset.descriptionField]: e.target.value }))}
                                placeholder={`Describe the ${asset.label.toLowerCase()} leg...`}
                                rows={3}
                              />
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="break-all text-muted-foreground">{currentUrl || 'No GPX URL set'}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="rounded-lg border bg-background p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs uppercase font-black tracking-widest text-muted-foreground">Cutoff mode</div>
                          <div className="text-sm font-medium">{courseCutoffModeDraft === 'segment' ? 'Cumulative / Segment' : 'Overall'}</div>
                        </div>
                        <select
                          value={courseCutoffModeDraft}
                          onChange={(e) => setCourseCutoffModeDraft(e.target.value as 'overall' | 'segment')}
                          className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                        >
                          <option value="overall">Overall</option>
                          <option value="segment">Cumulative / Segment</option>
                        </select>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <Input value={courseCutoffDrafts.overall} onChange={(e) => setCourseCutoffDrafts((prev) => ({ ...prev, overall: e.target.value }))} placeholder="Overall cutoff" />
                        <Input value={courseCutoffDrafts.swim} onChange={(e) => setCourseCutoffDrafts((prev) => ({ ...prev, swim: e.target.value }))} placeholder="Swim cutoff" />
                        <Input value={courseCutoffDrafts.bike} onChange={(e) => setCourseCutoffDrafts((prev) => ({ ...prev, bike: e.target.value }))} placeholder="Bike cutoff" />
                        <Input value={courseCutoffDrafts.run} onChange={(e) => setCourseCutoffDrafts((prev) => ({ ...prev, run: e.target.value }))} placeholder="Run cutoff" />
                        <Input value={courseCutoffDrafts.run1} onChange={(e) => setCourseCutoffDrafts((prev) => ({ ...prev, run1: e.target.value }))} placeholder="Run 1 cutoff" />
                        <Input value={courseCutoffDrafts.run2} onChange={(e) => setCourseCutoffDrafts((prev) => ({ ...prev, run2: e.target.value }))} placeholder="Run 2 cutoff" />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void handleSaveCourseMapConfig()} disabled={!bergmanEventId.trim() || !selectedTicket?.id}>Save Category Configuration</Button>
                      <Button variant="outline" onClick={() => void loadCourseConfig(bergmanEventId.trim())} disabled={!bergmanEventId.trim() || loadingCourseConfig}>Reload from saved configuration</Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border p-4 text-sm text-muted-foreground xl:col-span-3">
                    Select a Bergman event and category to edit course maps.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPinned className="h-5 w-5" />
                  Maps & Splits Configuration
                </CardTitle>
                <CardDescription>
                  Restore the original course-map view for the selected Bergman event, including GPX links, distances, descriptions, cutoffs, and split counts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid gap-3 md:grid-cols-2">
                  <StatusRow label="Selected Bergman Event" value={upcomingEvents.find((event) => event.id === bergmanEventId)?.name || bergmanEventId || '—'} />
                  <StatusRow label="Selected Feibot Event" value={selectedFeibotEventUuid} />
                  <StatusRow label="Selected Feibot Link" value={linkedEventExists ? 'Saved' : 'Not saved'} />
                  <StatusRow label="Course Config" value={loadingCourseConfig ? 'Loading…' : courseConfig?.success ? 'Loaded' : 'Not loaded'} />
                  <StatusRow
                    label="Feibot Timing Rules"
                    value={loadingTimingRules ? 'Loading…' : feibotTimingSummary ? `${feibotTimingSummary.contests?.length || 0} contests · ${feibotTimingSummary.splits?.length || 0} splits · ${feibotTimingSummary.timingPoints?.length || 0} timing points` : 'Not loaded'}
                  />
                </div>

                {selectedTicket ? (
                  <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs uppercase tracking-widest text-muted-foreground">Category</div>
                        <div className="mt-1 text-base font-semibold">{selectedTicket.ticketName}</div>
                      </div>
                      <Badge variant="outline">{selectedTicket.id}</Badge>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border bg-background p-3">
                        <div className="text-xs text-muted-foreground">Swim Distance</div>
                        <div className="mt-1 flex items-center gap-2 font-semibold"><Ruler className="h-4 w-4 text-sky-500" />{formatDistance(selectedCourseMaps?.swimDistance)}</div>
                        <div className="mt-2 text-xs text-muted-foreground whitespace-pre-line">{selectedCourseMaps?.swimDescription || '—'}</div>
                        <div className="mt-2 text-xs break-all text-slate-600">{selectedCourseMaps?.swimGpxUrl || 'No GPX URL'}</div>
                      </div>
                      <div className="rounded-lg border bg-background p-3">
                        <div className="text-xs text-muted-foreground">Bike Distance</div>
                        <div className="mt-1 flex items-center gap-2 font-semibold"><Route className="h-4 w-4 text-emerald-500" />{formatDistance(selectedCourseMaps?.bikeDistance)}</div>
                        <div className="mt-2 text-xs text-muted-foreground whitespace-pre-line">{selectedCourseMaps?.bikeDescription || '—'}</div>
                        <div className="mt-2 text-xs break-all text-slate-600">{selectedCourseMaps?.bikeGpxUrl || 'No GPX URL'}</div>
                      </div>
                      <div className="rounded-lg border bg-background p-3">
                        <div className="text-xs text-muted-foreground">Run Distance</div>
                        <div className="mt-1 flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-orange-500" />{formatDistance(selectedCourseMaps?.runDistance || selectedCourseMaps?.run2Distance)}</div>
                        <div className="mt-2 text-xs text-muted-foreground whitespace-pre-line">{selectedCourseMaps?.runDescription || '—'}</div>
                        <div className="mt-2 text-xs break-all text-slate-600">{selectedCourseMaps?.runGpxUrl || 'No GPX URL'}</div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Swim splits</div>
                        <div className="mt-1 text-lg font-semibold">{selectedCourseMaps?.swimSplits?.length || 0}</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Bike splits</div>
                        <div className="mt-1 text-lg font-semibold">{selectedCourseMaps?.bikeSplits?.length || 0}</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Run splits</div>
                        <div className="mt-1 text-lg font-semibold">{selectedCourseMaps?.runSplits?.length || 0}</div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border bg-background p-3">
                        <div className="text-xs text-muted-foreground">Cutoffs</div>
                        <div className="mt-1 text-sm font-medium">{selectedTicket.cutoffs?.mode || 'overall'}</div>
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                          <div>Overall: {selectedTicket.cutoffs?.overall || '—'}</div>
                          <div>Swim: {selectedTicket.cutoffs?.swim || '—'}</div>
                          <div>Bike: {selectedTicket.cutoffs?.bike || '—'}</div>
                          <div>Run: {selectedTicket.cutoffs?.run || '—'}</div>
                          <div>Run 1: {selectedTicket.cutoffs?.run1 || '—'}</div>
                          <div>Run 2: {selectedTicket.cutoffs?.run2 || '—'}</div>
                        </div>
                      </div>
                      <div className="rounded-lg border bg-background p-3">
                        <div className="text-xs text-muted-foreground">Course map files</div>
                        <div className="mt-2 space-y-2 text-xs break-all text-muted-foreground">
                          <div>Swim GPX: {selectedCourseMaps?.swimGpxUrl || '—'}</div>
                          <div>Bike GPX: {selectedCourseMaps?.bikeGpxUrl || '—'}</div>
                          <div>Run GPX: {selectedCourseMaps?.runGpxUrl || '—'}</div>
                          <div>Generated PDF: {selectedCourseMaps?.generatedPdfUrl || '—'}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                    No course map data found for this event yet. Load the Bergman event configuration to surface maps and distances.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Split & Leg Mapping</CardTitle>
                <CardDescription>Course splits and legs from Feibot timing rules configuration.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {feibotTimingSummary ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Swim Splits</div>
                        <div className="mt-1 text-lg font-semibold">{selectedCourseMaps?.swimSplits?.length || 0}</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Bike Splits</div>
                        <div className="mt-1 text-lg font-semibold">{selectedCourseMaps?.bikeSplits?.length || 0}</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Run Splits</div>
                        <div className="mt-1 text-lg font-semibold">{((selectedCourseMaps?.run2Splits?.length || 0) || (selectedCourseMaps?.runSplits?.length || 0))}</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Total Legs</div>
                        <div className="mt-1 text-lg font-semibold">{feibotTimingSummary?.legs?.length || 0}</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Total Contests</div>
                        <div className="font-medium">{feibotTimingSummary?.contests?.length || 0}</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Total Timing Points</div>
                        <div className="font-medium">{feibotTimingSummary?.timingPoints?.length || 0}</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border p-3 text-xs text-muted-foreground text-center">
                    Load Feibot timing rules to display split and leg mapping information.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="feibot_sync" className="mt-6 space-y-6">
          <FeibotSyncRebuildCard eventId={bergmanEventId.trim()} />
        </TabsContent>

        <TabsContent value="upload_results" className="mt-6">
          <LiveTrackingAdminTab onDataRefresh={() => {
            void loadSelectedEventCounts();
            if (bergmanEventId.trim()) {
              void loadCourseConfig(bergmanEventId.trim());
            }
          }} />
        </TabsContent>
      </Tabs>

      {courseMapPreviewOpen ? (
        <CourseMapDialog
          event={previewEvent as any}
          isOpen={courseMapPreviewOpen}
          onClose={() => setCourseMapPreviewOpen(false)}
          ticketId={selectedTicket?.id || undefined}
        />
      ) : null}
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium break-words">{value}</div>
    </div>
  );
}

function LogsPanel({ logs }: { logs: any[] }) {
  const [showFailedOnly, setShowFailedOnly] = React.useState(false);
  const failedLogs = logs.filter((l) => l?.status === 'FAILED' || l?.status === 'ERROR');
  const displayLogs = showFailedOnly ? failedLogs : [...logs].reverse();
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">
          Runtime KV Logs
          <span className="ml-2 text-xs font-normal text-muted-foreground">({logs.length} total{failedLogs.length > 0 ? `, ${failedLogs.length} failed` : ''})</span>
        </div>
        {failedLogs.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowFailedOnly((v) => !v)}
            className={`rounded px-2 py-0.5 text-xs font-medium border transition-colors ${showFailedOnly ? 'bg-red-100 border-red-300 text-red-800' : 'bg-muted border-border text-muted-foreground hover:bg-red-50 hover:border-red-200 hover:text-red-700'}`}
          >
            {showFailedOnly ? `Showing ${failedLogs.length} failed` : `Show ${failedLogs.length} failed only`}
          </button>
        ) : null}
      </div>
      <div className="space-y-0.5 text-xs max-h-80 overflow-auto font-mono">
        {displayLogs.map((log, index) => {
          const isFailed = log?.status === 'FAILED' || log?.status === 'ERROR';
          return (
            <div
              key={`${String(log?.ts || 'log')}-${index}`}
              className={`rounded px-2 py-1 ${isFailed ? 'bg-red-50 border border-red-200' : 'border border-transparent hover:bg-muted/40'}`}
            >
              <div className="grid grid-cols-12 gap-2">
                <span className="col-span-3 text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">{String(log?.ts ? new Date(log.ts).toLocaleTimeString() : '—')}</span>
                <span className="col-span-2 truncate">{String(log?.action || '—')}</span>
                <span className="col-span-5 break-all">{String(log?.key || '—')}</span>
                <span className={`col-span-2 font-semibold ${isFailed ? 'text-red-600' : 'text-emerald-600'}`}>{String(log?.status || '—')}</span>
              </div>
              {isFailed && log?.detail ? (
                <div className="mt-0.5 col-span-12 text-red-700 pl-2 break-all border-t border-red-100 pt-0.5">{String(log.detail)}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
