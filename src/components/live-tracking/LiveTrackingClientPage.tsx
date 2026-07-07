
// src/components/live-tracking/LiveTrackingClientPage.tsx
"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Search,
  Map as MapIcon,
  List as ListIcon,
  Loader2,
  ArrowLeft,
  X,
  PlusCircle,
  FilterX,
  Pause,
  FastForward,
  Rewind,
  TrendingUp,
  Eye,
  UserRound,
  ArrowRight,
  Play,
  Users,
  History as HistoryIcon,
} from 'lucide-react';
import type { EventCalendarEntry, LiveAthlete, EventParticipant, TicketDefinition, CustomSplitPoint, RaceResult, Status, Leg, Split } from '@/lib/types';
import MapViewer, { type GpxPath } from '@/components/live-tracking/MapViewer';
import LeaderboardView from '@/components/live-tracking/LeaderboardView';
import BergmanTrackerCard from '@/components/live-tracking/BergmanTrackerCard'; 
import AthleteLiveModalPro from '@/components/live-tracking/AthleteLiveModalPro';
import { AthleteSearchInput } from '@/components/live-tracking/AthleteSearchInput';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isDuathlonEvent, isTriathlonEvent, normalizeStatus, hmsToSeconds, formatSecondsToHMS, isTicketHidden } from '@/lib/utils';
import { cn } from "@/lib/utils";
import { useToast } from '@/hooks/use-toast';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import ElevationProfileChart from './ElevationProfileChart';
import { TimingConfigurationProvider } from '@/components/live-tracking/TimingConfigurationContext';
import { fetchJsonCached } from '@/lib/liveTrackingRequestCache';
import { getPublicFinalResultsAction } from '@/lib/actions/publicResultActions';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import type { ResolvedTimingConfiguration } from '@/lib/timingConfiguration';
import { applyPredictionEngine } from '@/lib/live-tracking/predictionEngine';
import { getAthleteRegisteredEventsAction, updateLiveTrackingPrivacyAction } from '@/lib/actions/userActions';
import LiveTrackingPrivacyCard from '@/components/dashboard/LiveTrackingPrivacyCard';
import { useAuth } from '@/context/AuthContext';
import { maskAnonymousAthlete, maskPrivateAthlete } from '@/lib/liveTrackingPrivacy';
import CloudflareHlsPlayer from '@/components/broadcast/CloudflareHlsPlayer';
import { type ReplayIndex, type ReplayVideoRecord } from '@/lib/live-tracking/replay';
import { getPlaybackUrl } from '@/lib/cloudflare/stream';


const gpxAssetConfig = {
  swimGpxUrl: { color: '#0ea5e9', type: 'swim' }, // sky-500
  bikeGpxUrl: { color: '#22c55e', type: 'bike' }, // green-500
  runGpxUrl: { color: '#f97316', type: 'run' },  // orange-500
  run1GpxUrl: { color: '#f97316', type: 'run' }, // orange-500
  run2GpxUrl: { color: '#f59e0b', type: 'run' }, // amber-500
};

type CourseRoute = {
  url: string;
  color: string;
  type: string;
  assetKey: string;
  splitPoints: CustomSplitPoint[];
  routeScope: 'ticket' | 'subCategory';
  ticketId: string;
  subCategoryId?: string | null;
  contestKey?: string | null;
};

interface LiveTrackingClientPageProps {
  initialEventDetails: EventCalendarEntry;
  isPastEvent: boolean;
  initialLiveData?: LiveAthlete[];
  isLiveTrackingPublic?: boolean;
  initialReplayIndex?: ReplayIndex | null;
}

type ViewerRole = 'ATHLETE' | 'SPECTATOR';

const VIEWER_ROLE_STORAGE_KEY_PREFIX = 'liveTrackingRole';

function getDisplayStatus(status: string | null | undefined) {
  const normalized = normalizeStatus(status || '');
  const upper = String(normalized || '').trim().toUpperCase();
  if (upper === 'REGISTERED' || upper === 'REGISTRATION' || upper === 'PENDING') return 'Not Started';
  if (upper === 'ON COURSE') return 'Started';
  if (upper === 'NOT STARTED') return 'Not Started';
  return normalized || 'Not Started';
}

function isCancelledOrInactiveStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return false;
  return (
    status.includes('cancel')
    || status.includes('refund')
    || status.includes('void')
    || status.includes('inactive')
    || status.includes('rejected')
  );
}

function isActiveAthlete(athlete: LiveAthlete | Record<string, any>) {
  const row = athlete as any;
  return !isCancelledOrInactiveStatus(row?.registrationStatus || row?.ticketStatus || row?.status);
}

function isPlaceholderContestLabel(value: unknown) {
  return /^contest\s*\d+$/i.test(String(value ?? '').trim());
}

function isInternalAgeGroupIdLabel(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^sub[-_]/i.test(text) || /^[0-9a-f]{8}-[0-9a-f-]{12,}$/i.test(text)) return true;
  const looksHuman = /(under|open|junior|senior|master|youth|adult|men|male|women|female|\d{1,2}\s*[+\-]|\d{1,2}\s*to\s*\d{1,2})/i.test(text) || /\s/.test(text);
  if (looksHuman) return false;
  return /^[A-Za-z0-9]{7,}$/.test(text) && /[A-Z]/.test(text) && /[a-z]/.test(text);
}

function sanitizeAgeGroupLabel(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (isPlaceholderContestLabel(text)) return '';
  if (isInternalAgeGroupIdLabel(text)) return '';
  return text;
}

function normalizeAthleteFullName(row: Record<string, any>) {
  const fullName = String(
    row?.fullName
    || row?.name
    || [row?.firstName, row?.lastName].filter(Boolean).join(' ')
    || row?.athleteName
    || '',
  ).trim();
  return fullName || 'Unknown Athlete';
}

function resolveSearchEntryNameParts(entry: Record<string, any>) {
  const firstName = String(
    entry?.firstName
    || entry?.provider?.firstName
    || entry?.registration?.firstName
    || '',
  ).trim();
  const lastName = String(
    entry?.lastName
    || entry?.provider?.lastName
    || entry?.registration?.lastName
    || '',
  ).trim();

  const fullName = normalizeAthleteFullName({
    fullName: entry?.fullName || entry?.name || entry?.athleteName || entry?.provider?.name || entry?.registration?.name || entry?.registration?.athleteName,
    firstName,
    lastName,
    athleteName: entry?.athleteName || entry?.provider?.name || entry?.registration?.name,
  });

  return {
    fullName,
    firstName: firstName || null,
    lastName: lastName || null,
  };
}

function normalizeAthleteInitials(fullName: string) {
  const initials = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return initials || 'AT';
}

function dedupeAthletes(rows: LiveAthlete[]) {
  const byKey = new Map<string, LiveAthlete>();

  const mergeAthleteRows = (existing: LiveAthlete, incoming: LiveAthlete) => {
    const merged = { ...existing } as LiveAthlete;
    for (const [key, value] of Object.entries(incoming || {})) {
      if (value !== null && value !== undefined && value !== '') {
        (merged as any)[key] = value;
      }
    }

    if (!(merged as any).country) {
      (merged as any).country = (incoming as any)?.country || (existing as any)?.country || (existing as any)?.registration?.country || (incoming as any)?.registration?.country || null;
    }

    if (!(merged as any).fullName) {
      (merged as any).fullName = (incoming as any)?.fullName || (existing as any)?.fullName || (incoming as any)?.name || (existing as any)?.name || null;
    }

    if (!(merged as any).name) {
      (merged as any).name = (merged as any).fullName || (incoming as any)?.name || (existing as any)?.name || null;
    }

    return merged;
  };

  for (const row of rows) {
    const anyRow = row as any;
    const bib = String(anyRow?.bib || anyRow?.bibNumber || '').trim();
    const contestKey = String(
      anyRow?.contestUuid
      || anyRow?.contest_uuid
      || anyRow?.providerContestUuid
      || anyRow?.ticketId
      || anyRow?.liveTracking?.contestUuid
      || '',
    ).trim();
    const key = bib
      ? `bib:${bib.toLowerCase()}${contestKey ? `:${contestKey.toLowerCase()}` : ''}`
      : String(
          anyRow?.participantUuid
          || anyRow?.participant_uuid
          || anyRow?.providerTimingUuid
          || anyRow?.provider_timing_uuid
          || anyRow?.providerParticipantUuid
          || anyRow?.athleteUid
          || anyRow?.id
          || anyRow?.name
          || '',
        ).trim();
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, row);
      continue;
    }

    const existing = byKey.get(key)!;
    const existingScore = Object.values(existing || {}).filter((value) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)).length;
    const nextScore = Object.values(row || {}).filter((value) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)).length;
    const merged = mergeAthleteRows(existing, row);
    if (nextScore > existingScore) {
      byKey.set(key, merged);
      continue;
    }

    if (!(existing as any).country && (row as any).country) {
      byKey.set(key, merged);
    }
  }
  return Array.from(byKey.values());
}

function getAthleteStableId(row: LiveAthlete | Record<string, any>) {
  const anyRow = row as any;
  const bib = String(anyRow?.bib || anyRow?.bibNumber || '').trim();
  const contestKey = String(anyRow?.contestUuid || anyRow?.contest_uuid || anyRow?.providerContestUuid || anyRow?.ticketId || anyRow?.liveTracking?.contestUuid || '').trim();
  if (bib) {
    return `bib:${bib.toLowerCase()}${contestKey ? `:${contestKey.toLowerCase()}` : ''}`;
  }

  const participantUuid = String(anyRow?.participantUuid || anyRow?.participant_uuid || anyRow?.providerParticipantUuid || anyRow?.liveTracking?.participantUuid || '').trim().toLowerCase();
  if (participantUuid) return `participant:${participantUuid}`;

  const providerTimingUuid = String(anyRow?.providerTimingUuid || anyRow?.provider_timing_uuid || anyRow?.timingUuid || anyRow?.timing_uuid || '').trim().toLowerCase();
  if (providerTimingUuid) return `timing:${providerTimingUuid}`;

  const athleteUid = String(anyRow?.athleteUid || anyRow?.bergmanAthleteId || '').trim().toLowerCase();
  if (athleteUid) return `athlete:${athleteUid}`;

  const existingId = String(anyRow?.id || '').trim();
  if (existingId) return existingId;

  const name = String(anyRow?.name || anyRow?.fullName || '').trim().toLowerCase();
  return `name:${name || 'unknown'}`;
}

function normalizeContestLabel(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeDateKeyValue(value?: string | null) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.includes('T') ? normalized.slice(0, 10) : normalized;
}

export default function LiveTrackingClientPage({ initialEventDetails, isPastEvent, initialLiveData = [], isLiveTrackingPublic = true, initialReplayIndex = null }: LiveTrackingClientPageProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, firebaseUserFromAuth, fetchUserProfile } = useAuth();
  const [eventDetails] = useState(initialEventDetails);
  const [courseConfig, setCourseConfig] = useState<any | null>(null);
  const [liveData, setLiveData] = useState<LiveAthlete[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [trackedAthleteIds, setTrackedAthleteIds] = useState<Set<string>>(new Set());
  const [trackedAthleteStore, setTrackedAthleteStore] = useState<Map<string, LiveAthlete>>(new Map());
  const [timingConfiguration, setTimingConfiguration] = useState<ResolvedTimingConfiguration | null>(null);
  const [searchParticipants, setSearchParticipants] = useState<Record<string, any>[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchBy, setSearchBy] = useState<'bib' | 'name' | 'email'>('bib');
  const [searchResults, setSearchResults] = useState<LiveAthlete[]>([]);
  const [searchSuggestions, setSearchSuggestions] = useState<LiveAthlete[]>([]);
  const [selectedAthleteForModal, setSelectedAthleteForModal] = useState<LiveAthlete | null>(null);
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [viewerRole, setViewerRole] = useState<ViewerRole | null>(null);
  const [viewerRoleReady, setViewerRoleReady] = useState(false);
  const [showRoleChooser, setShowRoleChooser] = useState(true);
  const [athleteRegistrationState, setAthleteRegistrationState] = useState<'idle' | 'checking' | 'registered' | 'not_registered'>('idle');
  const [hasEnteredTracking, setHasEnteredTracking] = useState(false);
  const [focusedAthlete, setFocusedAthlete] = useState<LiveAthlete | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [expandedRouteKey, setExpandedRouteKey] = useState<string | null>(null);
  const [elevationData, setElevationData] = useState<GpxPath[]>([]);
  const [replayIndex, setReplayIndex] = useState<ReplayIndex | null>(initialReplayIndex);
  const [selectedReplayUid, setSelectedReplayUid] = useState<string | null>(initialReplayIndex?.videos?.[0]?.uid || null);
  const viewerRoleStorageKey = useMemo(() => `${VIEWER_ROLE_STORAGE_KEY_PREFIX}:${eventDetails.id}`, [eventDetails.id]);

  const replayVideos = useMemo<ReplayVideoRecord[]>(() => Array.isArray(replayIndex?.videos) ? replayIndex.videos : [], [replayIndex]);
  const selectedReplayVideo = useMemo(() => replayVideos.find((video) => video.uid === selectedReplayUid) || replayVideos[0] || null, [replayVideos, selectedReplayUid]);
  const selectedReplayStreamUrl = selectedReplayVideo?.uid ? getPlaybackUrl(selectedReplayVideo.uid) : '';
  
  // Replay Mode State
  const [isReplayMode, setIsReplayMode] = useState(isPastEvent);
  const [replayTime, setReplayTime] = useState(0); // Current replay time in seconds from race start
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [isReplaying, setIsReplaying] = useState(false);
  const replayIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [predictionNowSec, setPredictionNowSec] = useState<number>(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    try {
      const savedRole = window.localStorage.getItem(viewerRoleStorageKey) || window.localStorage.getItem(VIEWER_ROLE_STORAGE_KEY_PREFIX) || window.localStorage.getItem('bergman-live-tracking-viewer-role');
      if (savedRole === 'ATHLETE' || savedRole === 'SPECTATOR') {
        setViewerRole(savedRole);
        setActiveTab(savedRole === 'ATHLETE' ? 'search' : 'leaderboard');
        setShowRoleChooser(false);
        setHasEnteredTracking(savedRole === 'SPECTATOR');
      }
    } catch {
      // Ignore storage failures and fall back to the role picker.
    } finally {
      setViewerRoleReady(true);
    }
  }, [viewerRoleStorageKey]);

  useEffect(() => {
    if (!eventDetails?.id) return;
    let active = true;
    const loadReplay = async () => {
      try {
        const res = await fetch(`/api/live/replay/${encodeURIComponent(eventDetails.id)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => null);
        if (!active || !res.ok || !data?.success) return;
        const nextIndex = data?.data?.replay || null;
        setReplayIndex(nextIndex);
        setSelectedReplayUid((current) => current || nextIndex?.videos?.[0]?.uid || null);
      } catch {
        // keep initial replay data if fetch fails
      }
    };

    void loadReplay();
    const interval = window.setInterval(() => { void loadReplay(); }, 45000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [eventDetails?.id]);

  const handleViewerRoleSelect = useCallback((role: ViewerRole) => {
    setViewerRole(role);
    setShowRoleChooser(false);
    setActiveTab(role === 'ATHLETE' ? 'search' : 'leaderboard');
    setHasEnteredTracking(true);
    setAthleteRegistrationState(role === 'ATHLETE' ? 'checking' : 'idle');
    try {
      window.localStorage.setItem(viewerRoleStorageKey, role);
      window.localStorage.setItem(VIEWER_ROLE_STORAGE_KEY_PREFIX, role);
    } catch {
      // Ignore storage failures.
    }
  }, [viewerRoleStorageKey]);

  const handleAthleteStart = useCallback(() => {
    handleViewerRoleSelect('ATHLETE');
    if (!currentUser?.uid && !currentUser?.email) {
      const slug = eventDetails.customSlug || eventDetails.id;
      router.push(`/login?redirect=${encodeURIComponent(`/live-tracking/${slug}`)}`);
    }
  }, [currentUser?.email, currentUser?.uid, eventDetails.id, eventDetails.customSlug, handleViewerRoleSelect, router]);

  const handleChangeRole = useCallback(() => {
    setViewerRole(null);
    setShowRoleChooser(true);
    setHasEnteredTracking(false);
    setAthleteRegistrationState('idle');
    setSelectedAthleteForModal(null);
    setFocusedAthlete(null);
    try {
      window.localStorage.removeItem(viewerRoleStorageKey);
      window.localStorage.removeItem(VIEWER_ROLE_STORAGE_KEY_PREFIX);
      window.localStorage.removeItem('bergman-live-tracking-viewer-role');
    } catch {
      // Ignore storage failures.
    }
  }, [viewerRoleStorageKey]);

  useEffect(() => {
    let active = true;
    const checkAthleteRegistration = async () => {
      if (viewerRole !== 'ATHLETE') {
        if (active) setAthleteRegistrationState('idle');
        return;
      }
      if (!currentUser?.uid && !currentUser?.email) {
        if (active) setAthleteRegistrationState('idle');
        return;
      }

      if (active) setAthleteRegistrationState('checking');
      const result = await getAthleteRegisteredEventsAction(currentUser.uid || '', currentUser.email || null).catch(() => null);
      if (!active) return;

      const registered = Boolean(result?.success && Array.isArray(result.events) && result.events.some((event) => String(event?.eventId || event?.id || '').trim() === String(initialEventDetails.id || '').trim()));
      setAthleteRegistrationState(registered ? 'registered' : 'not_registered');
      setHasEnteredTracking(registered ? false : true);
    };

    void checkAthleteRegistration();
    return () => { active = false; };
  }, [currentUser?.email, currentUser?.uid, initialEventDetails.id, viewerRole]);

  const canShowMainTracking = viewerRole === 'SPECTATOR' || (viewerRole === 'ATHLETE' && athleteRegistrationState === 'registered' && hasEnteredTracking);
  const showAthleteGate = viewerRole === 'ATHLETE' && (athleteRegistrationState === 'registered' || athleteRegistrationState === 'not_registered');

  useEffect(() => {
    let active = true;
    const loadToken = async () => {
      if (!firebaseUserFromAuth) {
        if (active) setAuthToken(null);
        return;
      }
      try {
        const token = await firebaseUserFromAuth.getIdToken();
        if (active) setAuthToken(token);
      } catch {
        if (active) setAuthToken(null);
      }
    };

    void loadToken();
    return () => { active = false; };
  }, [firebaseUserFromAuth]);

  const authHeaders = useMemo<Record<string, string>>(() => (authToken ? { Authorization: `Bearer ${authToken}` } : ({} as Record<string, string>)), [authToken]);

  // Load participant index for new search engine
  useEffect(() => {
    let active = true;
    const loadParticipants = async () => {
      try {
        const response = await fetch(`/api/live/participants/${encodeURIComponent(eventDetails.id)}?kvOnly=1`, {
          method: 'GET',
          cache: 'no-store',
          headers: authHeaders,
        });
        const payload = await response.json().catch(() => null);
        if (active && Array.isArray(payload?.participants)) {
          setSearchParticipants(payload.participants);
        }
      } catch (error) {
        console.error('Failed to load participant index:', error);
        if (active) setSearchParticipants([]);
      }
    };

    if (eventDetails.id && Object.keys(authHeaders).length > 0) {
      void loadParticipants();
    }
    return () => { active = false; };
  }, [eventDetails.id, authHeaders]);

  useEffect(() => {
    if (isReplayMode || eventDetails.liveDataSource !== 'timing_partner') return;
    const timer = window.setInterval(() => {
      setPredictionNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [eventDetails.liveDataSource, isReplayMode]);

  const contestByUuid = useMemo(() => timingConfiguration?.contestByUuid || {}, [timingConfiguration?.contestByUuid]);

  const ageGroupByUuid = useMemo<Record<string, any>>(() => {
    const map: Record<string, any> = {};
    const append = (row: any) => {
      const uuid = String(row?.uuid || row?.UUID || row?.id || row?.ageGroupUuid || row?.age_group_uuid || '').trim();
      if (!uuid) return;
      map[uuid.toLowerCase()] = row;
    };

    (Array.isArray(timingConfiguration?.ageGroups) ? timingConfiguration.ageGroups : []).forEach(append);
    if (timingConfiguration?.ageGroupsByContest && typeof timingConfiguration.ageGroupsByContest === 'object') {
      Object.values(timingConfiguration.ageGroupsByContest).forEach((value) => {
        if (Array.isArray(value)) value.forEach(append);
      });
    }

    return map;
  }, [timingConfiguration]);

  const resolveAgeGroupDisplay = useCallback((row: any) => {
    const name = String(row?.name || row?.label || row?.displayName || row?.ageGroup || row?.code || '').trim();
    if (name && !/^[0-9a-f-]{8,}$/i.test(name)) return name;
    const fromAge = Number(row?.fromAge ?? row?.from_age);
    const toAge = Number(row?.toAge ?? row?.to_age);
    if (Number.isFinite(fromAge) && Number.isFinite(toAge)) return `Under ${toAge}`;
    if (Number.isFinite(fromAge) && !Number.isFinite(toAge)) return `${fromAge}+`;
    if (!Number.isFinite(fromAge) && Number.isFinite(toAge)) return `Under ${toAge}`;
    return name || '';
  }, []);

  const getContestLabel = useCallback((athlete: LiveAthlete | Record<string, any>) => {
    const row = athlete as any;
    const contestUuid = String(row?.contestUuid || row?.contest_uuid || row?.providerContestUuid || row?.liveTracking?.contestUuid || '').trim();
    const contest = contestUuid ? (contestByUuid as any)?.[contestUuid.toLowerCase()] : null;
    const subCategoryName = String(
      row?.subCategoryName
      || row?.selectedSubCategory
      || row?.registration?.selectedSubCategory
      || row?.provider?.subCategoryName
      || row?.provider?.selectedSubCategory
      || '',
    ).trim();
    const resolved = normalizeContestLabel(
      contest?.contestName
      || contest?.contest?.contestName
      || contest?.contest?.Name
      || contest?.contest?.name
      || row?.contestName
      || row?.contest_name
      || row?.providerContestName
      || subCategoryName
      || row?.category,
    );
    return isPlaceholderContestLabel(resolved) ? normalizeContestLabel(subCategoryName || row?.providerContestName || contest?.contest?.contestName || 'Unmapped') : resolved || 'Unmapped';
  }, [contestByUuid]);

  const getAgeGroupLabel = useCallback((athlete: LiveAthlete | Record<string, any>) => {
    const row = athlete as any;
    const ageGroupUuid = String(row?.ageGroupUuid || row?.age_group_uuid || row?.provider?.ageGroupUuid || row?.provider?.age_group_uuid || '').trim();
    const ageGroupNameFromIndex = ageGroupUuid ? resolveAgeGroupDisplay((ageGroupByUuid as any)?.[ageGroupUuid.toLowerCase()]) : '';

    const candidates = [
      row?.ageGroupName,
      row?.age_group_name,
      row?.ageGroup,
      row?.provider?.ageGroupName,
      row?.provider?.age_group_name,
      row?.registration?.ageGroup,
      ageGroupNameFromIndex,
    ];

    const resolved = candidates
      .map((value) => sanitizeAgeGroupLabel(value))
      .find((value) => !!value);
    return resolved || 'Not Assigned';
  }, [ageGroupByUuid, resolveAgeGroupDisplay]);

  const normalizeVisibleAthlete = useCallback((athlete: LiveAthlete) => {
    const contestUuid = String(athlete.contestUuid || athlete.contest_uuid || athlete.providerContestUuid || athlete.liveTracking?.contestUuid || '').trim() || null;
    const incomingCategory = String((athlete as any)?.category || athlete.providerContestName || athlete.contestName || '').trim();
    const resolvedContestLabel = contestUuid ? getContestLabel(athlete) : '';
    const contestLabel = resolvedContestLabel && !isPlaceholderContestLabel(resolvedContestLabel)
      ? resolvedContestLabel
      : (incomingCategory && !isPlaceholderContestLabel(incomingCategory) ? incomingCategory : 'Unmapped');
    const fullName = normalizeAthleteFullName(athlete as any);
    const genderRaw = String((athlete as any)?.gender || (athlete as any)?.registration?.gender || (athlete as any)?.provider?.gender || '').trim().toLowerCase();
    const gender = genderRaw.startsWith('f') ? 'Female' : genderRaw.startsWith('m') ? 'Male' : String((athlete as any)?.gender || 'Unknown');
    const resolvedCountry = String(
      (athlete as any)?.country
      || (athlete as any)?.countryCode
      || (athlete as any)?.country_code
      || (athlete as any)?.countryName
      || (athlete as any)?.countryAtRace
      || (athlete as any)?.nationality
      || (athlete as any)?.registration?.country
      || (athlete as any)?.registration?.countryCode
      || (athlete as any)?.registration?.country_code
      || (athlete as any)?.registration?.countryName
      || (athlete as any)?.registration?.countryAtRace
      || (athlete as any)?.provider?.country
      || (athlete as any)?.provider?.countryCode
      || (athlete as any)?.provider?.countryName
      || '',
    ).trim() || null;
    const resolvedClub = String(
      (athlete as any)?.clubName
      || (athlete as any)?.club
      || (athlete as any)?.club_name
      || (athlete as any)?.team
      || (athlete as any)?.teamName
      || (athlete as any)?.registration?.clubName
      || (athlete as any)?.registration?.club
      || (athlete as any)?.registration?.club_name
      || (athlete as any)?.registration?.teamName
      || '',
    ).trim() || null;
    return {
      ...athlete,
      id: getAthleteStableId(athlete),
      fullName,
      name: fullName,
      firstName: String((athlete as any)?.firstName || fullName.split(/\s+/)[0] || '').trim() || null,
      lastName: String((athlete as any)?.lastName || fullName.split(/\s+/).slice(1).join(' ') || '').trim() || null,
      initials: normalizeAthleteInitials(fullName),
      contestUuid,
      contest_uuid: contestUuid,
      providerContestUuid: contestUuid || athlete.providerContestUuid || null,
      contestName: contestLabel,
      contest_name: contestLabel,
      providerContestName: contestLabel,
      category: contestLabel,
      gender,
      country: resolvedCountry,
      countryCode: resolvedCountry,
      countryName: resolvedCountry,
      country_code: resolvedCountry,
      countryAtRace: resolvedCountry,
      clubName: resolvedClub,
      club: resolvedClub,
      ageGroup: getAgeGroupLabel(athlete),
      ageGroupName: getAgeGroupLabel(athlete),
      age_group_name: getAgeGroupLabel(athlete),
    } as LiveAthlete;
  }, [getAgeGroupLabel, getContestLabel]);

  // Filters are now managed here
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [genderFilter, setGenderFilter] = useState('all');
  const [ticketFilter, setTicketFilter] = useState<string>('all');
  const contestFilterInitializedForEventRef = useRef<string | null>(null);
  const [selectedRaceDayKey, setSelectedRaceDayKey] = useState<string | null>(null);
  
  // When ticket filter changes, reset category filter to 'all'
  const handleTicketFilterChange = useCallback((newTicketFilter: string) => {
    setTicketFilter(newTicketFilter);
    setCategoryFilter('all');
    if (newTicketFilter && newTicketFilter !== 'all') {
      setSelectedTicketId(newTicketFilter);
      setFocusedAthlete(null);
    }
  }, []);

  const [notificationPermission, setNotificationPermission] = useState('default');
  const prevLiveDataRef = useRef<Map<string, LiveAthlete>>(new Map());

  const allSplitsForReplay = useMemo(() => {
    if (!isReplayMode) return [];
    return initialLiveData.flatMap(a => a.splits.map(s => ({ ...s, athleteId: a.id }))).sort((a, b) => a.time - b.time);
  }, [isReplayMode, initialLiveData]);

  const maxReplayTime = useMemo(() => allSplitsForReplay[allSplitsForReplay.length - 1]?.time || 0, [allSplitsForReplay]);

  const replayData = useMemo(() => {
    if (!isReplayMode) return liveData;
    
    return initialLiveData.map(athlete => {
      const splitsBeforeOrAtReplayTime = athlete.splits.filter(s => s.time <= replayTime);
      
      const lastSplit = splitsBeforeOrAtReplayTime[splitsBeforeOrAtReplayTime.length - 1];
      const originalStatus = normalizeStatus(athlete.status) as Status;
      const isTerminalStatus = ['Finished', 'DNF', 'DNS', 'DNQ'].includes(originalStatus);

      let status: Status = isTerminalStatus ? originalStatus : 'Not Started';
      let leg: Leg | 'NOT_STARTED' | 'FINISHED' = originalStatus === 'Finished'
        ? 'FINISHED'
        : ((athlete.leg as Leg | 'NOT_STARTED' | 'FINISHED') || 'NOT_STARTED');

      if (lastSplit) {
          leg = lastSplit.segment as Leg;
          status = leg === 'FINISHED' ? 'Finished' : 'On Course';
      } else if (!isTerminalStatus) {
          leg = 'NOT_STARTED';
          status = 'Not Started';
      }
      
      return normalizeVisibleAthlete({
          ...athlete,
          splits: splitsBeforeOrAtReplayTime,
          status,
          leg,
          lastUpdateTime: replayTime
      });
    });
  }, [isReplayMode, replayTime, initialLiveData, liveData, normalizeVisibleAthlete]);

  useEffect(() => {
    if (isReplaying && isReplayMode) {
      replayIntervalRef.current = setInterval(() => {
        setReplayTime(prevTime => {
          const nextTime = prevTime + replaySpeed;
          if (nextTime >= maxReplayTime) {
            setIsReplaying(false);
            return maxReplayTime;
          }
          return nextTime;
        });
      }, 1000);
    } else {
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
      }
    }
    return () => {
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
      }
    };
  }, [isReplaying, isReplayMode, replaySpeed, maxReplayTime]);

  const handleSliderChange = (value: number[]) => {
    setReplayTime(value[0]);
  };

  const toggleReplay = () => {
    if (replayTime >= maxReplayTime) {
        setReplayTime(0); // Restart if at the end
    }
    setIsReplaying(!isReplaying);
  };
  
  const handleSpeedChange = () => {
    const speeds = [1, 5, 10, 50, 100];
    const currentIndex = speeds.indexOf(replaySpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    setReplaySpeed(speeds[nextIndex]);
  };

  useEffect(() => {
    if (isReplayMode) {
      setIsFetching(false);
      setLiveData(dedupeAthletes(initialLiveData.map(normalizeVisibleAthlete).filter((row) => isActiveAthlete(row))));
      return;
    }

    // Always fetch from live:events tracking endpoint as the single source of truth.
    let isMounted = true;
    let pollTimer: number | null = null;

    const canPollNow = () => {
      if (typeof document === 'undefined') return true;
      const visible = !document.hidden && document.visibilityState === 'visible';
      const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      return visible && focused;
    };

    const fetchData = async () => {
      if (!isMounted || !canPollNow()) return;
      try {
        const trackingResponse = await fetch(`/api/events/${encodeURIComponent(eventDetails.id)}/tracking`, { cache: 'no-store', headers: authHeaders });
        const trackingPayload = await trackingResponse.json().catch(() => null);
        const result = trackingResponse.ok
          ? { success: true, participants: Array.isArray(trackingPayload?.participants) ? trackingPayload.participants : [] }
          : { success: false, participants: [] as any[] };
        if (isMounted) {
          if (result.success) {
            setLiveData(dedupeAthletes(result.participants.map((row: any) => normalizeVisibleAthlete(row)).filter((row: any) => isActiveAthlete(row))));
          } else {
            setLiveData([]);
          }
          setIsFetching(false);
        }
      } catch (error) {
        if (isMounted) {
          console.error("Error fetching live athletes:", error);
          toast({ variant: 'destructive', title: 'Live Data Error', description: 'Could not connect to live athlete data.' });
          setLiveData([]);
          setIsFetching(false);
        }
      }
    };

    const scheduleNextPoll = () => {
      if (!isMounted) return;
      if (pollTimer) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(async () => {
        await fetchData();
        scheduleNextPoll();
      }, 12000);
    };

    const onVisibilityChange = () => {
      if (!isMounted) return;
      if (canPollNow()) {
        void fetchData();
      }
    };

    void fetchData();
    scheduleNextPoll();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      isMounted = false;
      if (pollTimer) window.clearTimeout(pollTimer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, [authHeaders, eventDetails.id, isReplayMode, initialLiveData, normalizeVisibleAthlete, toast]);

  useEffect(() => {
    let isMounted = true;
    const loadTimingConfiguration = async (options?: { force?: boolean }) => {
      try {
        const resolved = await fetchJsonCached<ResolvedTimingConfiguration>(`timingConfiguration:${eventDetails.id}`, async () => {
          const response = await fetch(`/api/live/course-index/${encodeURIComponent(eventDetails.id)}`, { cache: 'no-store' });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.message || `Request failed with HTTP ${response.status}`);
          }
          const timingPayload = payload?.timingConfiguration || payload?.courseIndex || payload;
          const contestIndex = timingPayload?.contestIndex && typeof timingPayload.contestIndex === 'object' ? timingPayload.contestIndex : {};
          return {
            eventId: payload.eventId || eventDetails.id,
            source: timingPayload.source || payload.source,
            course: {
              legs: Array.isArray(timingPayload?.course?.legs) ? timingPayload.course.legs : Array.isArray(timingPayload.legs) ? timingPayload.legs : [],
              timingPoints: Array.isArray(timingPayload?.course?.timingPoints) ? timingPayload.course.timingPoints : Array.isArray(timingPayload.timingPoints) ? timingPayload.timingPoints : [],
              splits: Array.isArray(timingPayload?.course?.splits) ? timingPayload.course.splits : Array.isArray(timingPayload.splits) ? timingPayload.splits : [],
              contests: Array.isArray(timingPayload?.course?.contests) ? timingPayload.course.contests : Array.isArray(timingPayload.contests) ? timingPayload.contests : [],
            },
            contests: Array.isArray(timingPayload.contests) ? timingPayload.contests : [],
            timingPoints: Array.isArray(timingPayload.timingPoints) ? timingPayload.timingPoints : [],
            splits: Array.isArray(timingPayload.splits) ? timingPayload.splits : [],
            devices: Array.isArray(timingPayload.devices) ? timingPayload.devices : [],
            legs: Array.isArray(timingPayload.legs) ? timingPayload.legs : [],
            ageGroups: Array.isArray(timingPayload.ageGroups) ? timingPayload.ageGroups : [],
            contestIndex,
            contestByUuid: timingPayload?.contestByUuid && typeof timingPayload.contestByUuid === 'object' ? timingPayload.contestByUuid : {},
            contestByName: timingPayload?.contestByName && typeof timingPayload.contestByName === 'object' ? timingPayload.contestByName : {},
            splitsByContest: timingPayload?.splitsByContest && typeof timingPayload.splitsByContest === 'object' ? timingPayload.splitsByContest : {},
            timingPointsByContest: timingPayload?.timingPointsByContest && typeof timingPayload.timingPointsByContest === 'object' ? timingPayload.timingPointsByContest : {},
            ageGroupsByContest: timingPayload?.ageGroupsByContest && typeof timingPayload.ageGroupsByContest === 'object' ? timingPayload.ageGroupsByContest : {},
            legSplitMappingsByContest: timingPayload?.legSplitMappingsByContest && typeof timingPayload.legSplitMappingsByContest === 'object' ? timingPayload.legSplitMappingsByContest : {},
            legSplitMappingUpdatedAt: timingPayload?.legSplitMappingUpdatedAt || null,
            raceFlowByContest: timingPayload?.raceFlowByContest && typeof timingPayload.raceFlowByContest === 'object' ? timingPayload.raceFlowByContest : {},
            raceFlowTimelineByContest: timingPayload?.raceFlowTimelineByContest && typeof timingPayload.raceFlowTimelineByContest === 'object' ? timingPayload.raceFlowTimelineByContest : {},
            raceFlowTimelineUpdatedAt: timingPayload?.raceFlowTimelineUpdatedAt || null,
            importedAt: timingPayload.importedAt || payload.importedAt || null,
            provider: timingPayload.provider || payload.provider || null,
          } as ResolvedTimingConfiguration;
        }, { force: options?.force === true });
        if (!isMounted) return;
        setTimingConfiguration(resolved);
      } catch {
        if (isMounted) setTimingConfiguration(null);
      }
    };

    void loadTimingConfiguration();
    const refreshTimer = window.setInterval(() => {
      void loadTimingConfiguration({ force: true });
    }, 60000);

    return () => {
      isMounted = false;
      window.clearInterval(refreshTimer);
    };
  }, [eventDetails.id]);

  useEffect(() => {
    let isMounted = true;
    const loadCourseConfig = async () => {
      try {
        const resolved = await fetchJsonCached<any>(`courseConfig:${eventDetails.id}`, async () => {
          const response = await fetch(`/api/live/course-config?eventId=${encodeURIComponent(eventDetails.id)}`, { cache: 'no-store' });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.error || payload?.message || `Request failed with HTTP ${response.status}`);
          }
          return payload;
        });
        if (isMounted) setCourseConfig(resolved);
      } catch {
        if (isMounted) setCourseConfig(null);
      }
    };

    void loadCourseConfig();
    return () => {
      isMounted = false;
    };
  }, [eventDetails.id]);

  const ticketDefinitions = useMemo(() => {
    // Build a subCategories lookup from eventDetails (always has the complete ticket schema)
    const subCategoriesById = new Map<string, any[]>();
    if (Array.isArray(eventDetails.ticketDefinitions)) {
      for (const t of eventDetails.ticketDefinitions as any[]) {
        const id = String(t?.id || '').trim();
        const subs = Array.isArray(t?.subCategories) ? t.subCategories : [];
        if (id && subs.length > 0) subCategoriesById.set(id, subs);
      }
    }

    const raw: any[] = Array.isArray(courseConfig?.ticketDefinitions) && courseConfig.ticketDefinitions.length > 0
      ? courseConfig.ticketDefinitions
      : Array.isArray(eventDetails.ticketDefinitions) ? eventDetails.ticketDefinitions : [];

    // Normalize isHidden and always carry subCategories (courseConfig may omit them)
    return raw.map((ticket: any) => ({
      ...ticket,
      isHidden: isTicketHidden(ticket),
      subCategories:
        subCategoriesById.get(String(ticket?.id || '').trim())
        ?? (Array.isArray(ticket?.subCategories) ? ticket.subCategories : []),
    }));
  }, [courseConfig?.ticketDefinitions, eventDetails.ticketDefinitions]);

  const getTicketDateKey = useCallback((ticket: TicketDefinition | Record<string, any>) => normalizeDateKeyValue(String((ticket as any)?.eventDate || '')), []);

  const getContestDisplayDateKey = useCallback((ticket: TicketDefinition | Record<string, any>) => String((ticket as any)?.eventDate || '').trim(), []);

  const normalizeContestText = useCallback((value: unknown) => String(value ?? '').trim().toLowerCase(), []);

  const parseContestDistanceScore = useCallback((value: unknown) => {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return -1;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(km|kms|mtrs|mtr|m)/i);
    if (!match) return -1;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return -1;
    const unit = match[2].toLowerCase();
    if (unit === 'm' || unit === 'mtr' || unit === 'mtrs') return amount / 1000;
    return amount;
  }, []);

  const normalizeRouteSplitPoint = useCallback((split: Record<string, any>, fallbackIndex: number) => {
    const distanceValue = Number(
      split?.distance
      ?? split?.distanceKm
      ?? split?.distance_km
      ?? split?.DistanceFromStart
      ?? split?.distanceFromStart
      ?? split?.meters
      ?? split?.Meter
      ?? split?.distance_m
      ?? 0,
    );
    return {
      id: String(split?.id || split?.uuid || split?.splitUuid || split?.name || split?.label || `split-${fallbackIndex + 1}`),
      name: String(split?.name || split?.displayName || split?.label || split?.title || split?.id || `Split ${fallbackIndex + 1}`),
      distance: Number.isFinite(distanceValue) ? distanceValue : 0,
      leg: String(split?.leg || split?.leg_name || split?.legName || split?.mappedToBergmanLeg || split?.legIndex || '').trim() || undefined,
      order: Number(split?.order ?? split?.display_order ?? split?.split_index ?? fallbackIndex + 1) || fallbackIndex + 1,
      visibility: String(split?.visibility || split?.visible || 'visible').trim().toLowerCase(),
      splitType: String(split?.split_type || split?.splitType || split?.type || '').trim() || undefined,
    } as CustomSplitPoint & Record<string, any>;
  }, []);

  const resolveAthleteTicketIdentity = useCallback((athlete: LiveAthlete | Record<string, any>) => {
    const row = athlete as any;
    const directTicketId = String(
      row?.ticketId
      || row?.registration?.ticketId
      || row?.registration?.ticket_id
      || row?.provider?.ticketId
      || row?.provider?.ticket_id
      || row?.liveTracking?.ticketId
      || '',
    ).trim();
    const directSubCategoryId = String(
      row?.subCategoryId
      || row?.selectedSubCategoryId
      || row?.registration?.subCategoryId
      || row?.registration?.selectedSubCategoryId
      || row?.provider?.subCategoryId
      || '',
    ).trim();
    const directSubCategoryName = String(
      row?.selectedSubCategory
      || row?.subCategoryName
      || row?.registration?.selectedSubCategory
      || row?.registration?.subCategoryName
      || row?.provider?.selectedSubCategory
      || row?.provider?.subCategoryName
      || '',
    ).trim().toLowerCase();
    if (directTicketId) {
      if (directSubCategoryId) {
        return { ticketId: directTicketId, subCategoryId: directSubCategoryId };
      }

      if (directSubCategoryName) {
        const directTicket = (ticketDefinitions || []).find((ticket) => String(ticket?.id || '').trim() === directTicketId);
        const directTicketSubs = Array.isArray((directTicket as any)?.subCategories) ? (directTicket as any).subCategories : [];
        const byName = directTicketSubs.find((item: any) => {
          const labels = [item?.id, item?.name, item?.title, item?.label]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean);
          return labels.some((label) => label === directSubCategoryName || directSubCategoryName.includes(label) || label.includes(directSubCategoryName));
        });
        if (byName?.id) {
          return { ticketId: directTicketId, subCategoryId: String(byName.id).trim() };
        }
      }

      return { ticketId: directTicketId, subCategoryId: null };
    }

    const contestName = String(row?.contestName || row?.contest_name || row?.category || row?.providerContestName || '').trim().toLowerCase();
    if (!contestName) return { ticketId: '', subCategoryId: null };

    const athleteDistanceKm = parseContestDistanceScore(contestName);

    for (const ticket of ticketDefinitions || []) {
      const ticketName = String(ticket?.ticketName || ticket?.name || '').trim().toLowerCase();
      const ticketId = String(ticket?.id || '').trim();
      if (!ticketId) continue;
      if (ticketName && contestName.includes(ticketName)) {
        const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
        if (subCategories.length === 0) return { ticketId, subCategoryId: null };

        const matchByDirectSubCategoryName = directSubCategoryName
          ? subCategories.find((item: any) => {
              const subLabels = [item?.id, item?.name, item?.title, item?.label]
                .map((value) => String(value || '').trim().toLowerCase())
                .filter(Boolean);
              return subLabels.some((label) => label === directSubCategoryName || directSubCategoryName.includes(label) || label.includes(directSubCategoryName));
            })
          : null;
        if (matchByDirectSubCategoryName?.id) {
          return { ticketId, subCategoryId: String(matchByDirectSubCategoryName.id).trim() };
        }

        const matchByLabel = subCategories.find((item: any) => {
          const subLabels = [item?.id, item?.name, item?.title, item?.label].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
          return subLabels.some((label) => contestName.includes(label) || label.includes(contestName));
        });
        if (matchByLabel?.id) {
          return { ticketId, subCategoryId: String(matchByLabel.id).trim() };
        }

        if (athleteDistanceKm >= 0) {
          const distanceMatchedSub = subCategories.find((item: any) => {
            const subLabels = [item?.name, item?.title, item?.label].map((value) => String(value || '').trim()).filter(Boolean);
            const subDistance = Math.max(
              ...subLabels.map((label) => parseContestDistanceScore(label)),
              parseContestDistanceScore(item?.distanceLabel || item?.distance || ''),
            );
            return subDistance >= 0 && Math.abs(subDistance - athleteDistanceKm) < 0.001;
          });
          if (distanceMatchedSub?.id) {
            return { ticketId, subCategoryId: String(distanceMatchedSub.id).trim() };
          }
        }

        const sub = subCategories.find((item: any) => {
          const subLabels = [item?.id, item?.name, item?.title, item?.label].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
          if (subLabels.some((label) => contestName.includes(label))) return true;

          const athleteAge = normalizeContestText(
            row?.ageGroupName
            || row?.age_group_name
            || row?.ageGroup
            || row?.provider?.ageGroupName
            || row?.provider?.age_group_name
            || row?.registration?.ageGroup
            || '',
          );
          if (!athleteAge) return false;

          const ageGroups = Array.isArray(item?.applicableAgeGroups)
            ? item.applicableAgeGroups
            : typeof item?.applicableAgeGroups === 'string'
              ? String(item.applicableAgeGroups).split(',').map((s: string) => s.trim()).filter(Boolean)
              : [];
          return ageGroups.some((group: any) => normalizeContestText(group) === athleteAge);
        });
        return { ticketId, subCategoryId: String(sub?.id || '').trim() || null };
      }
    }

    return { ticketId: '', subCategoryId: null };
  }, [ticketDefinitions, normalizeContestText, parseContestDistanceScore]);

  const buildRoutesFromCourseMaps = useCallback((params: {
    ticketId: string;
    courseMaps: any;
    routeScope: 'ticket' | 'subCategory';
    subCategoryId?: string | null;
    contestKey?: string | null;
    contestKeyCandidates?: string[];
  }) => {
    const routes: CourseRoute[] = [];
    const gpxKeys = Object.keys(gpxAssetConfig) as (keyof typeof gpxAssetConfig)[];
    const contestKeyCandidates = [
      ...(Array.isArray(params.contestKeyCandidates) ? params.contestKeyCandidates : []),
      params.contestKey,
      params.ticketId,
      String(params.ticketId || '').toLowerCase(),
    ].map((value) => String(value || '').trim()).filter(Boolean);

    let matchedContestKey: string | null = null;
    let splitMappingForContest: any = null;
    for (const key of contestKeyCandidates) {
      const mapping = (timingConfiguration as any)?.raceFlowByContest?.[key]
        || (timingConfiguration as any)?.raceFlowByContest?.[key.toLowerCase?.() ?? key]
        || (timingConfiguration as any)?.raceFlowTimelineByContest?.[key]
        || (timingConfiguration as any)?.raceFlowTimelineByContest?.[key.toLowerCase?.() ?? key]
        || (timingConfiguration as any)?.legSplitMappingsByContest?.[key]
        || (timingConfiguration as any)?.legSplitMappingsByContest?.[key.toLowerCase?.() ?? key]
        || null;
      if (mapping) {
        matchedContestKey = key;
        splitMappingForContest = mapping;
        break;
      }
    }

    const routeLegFromAssetKey = (assetKey: keyof typeof gpxAssetConfig) => {
      if (assetKey === 'swimGpxUrl') return 'swim';
      if (assetKey === 'bikeGpxUrl') return 'bike';
      if (assetKey === 'run1GpxUrl') return 'run1';
      if (assetKey === 'run2GpxUrl') return 'run2';
      return 'run';
    };

    const mappingLegLabels = new Map<number, string>();
    const mappingLegs = Array.isArray(splitMappingForContest?.legs) ? splitMappingForContest.legs : [];
    mappingLegs.forEach((leg: any, index: number) => {
      const label = String(leg?.leg_name || leg?.legName || leg?.name || leg?.label || '').trim().toLowerCase();
      if (label) mappingLegLabels.set(index + 1, label);
    });

    const getRouteSplitsFromTimingConfig = (assetKey: keyof typeof gpxAssetConfig) => {
      if (!splitMappingForContest) return [] as CustomSplitPoint[];
      const leg = routeLegFromAssetKey(assetKey);
      const splitRows = Array.isArray(splitMappingForContest?.splits) ? splitMappingForContest.splits : [];
      const mapped = splitRows
        .filter((split: any) => String(split?.visibility || 'visible').toLowerCase() !== 'hidden')
        .filter((split: any) => {
          const splitLegIndex = Number(split?.leg_index || split?.legIndex || 0);
          const mappedLegLabel = mappingLegLabels.get(splitLegIndex) || '';
          const splitLegLabel = String(split?.leg || split?.leg_name || split?.legName || split?.split_type || '').trim().toLowerCase();
          return !splitLegIndex || mappedLegLabel === leg || splitLegLabel === leg || splitLegLabel.includes(leg);
        })
        .sort((a: any, b: any) => {
          const legOrderA = Number(a?.leg_index || a?.legIndex || 0);
          const legOrderB = Number(b?.leg_index || b?.legIndex || 0);
          if (legOrderA !== legOrderB) return legOrderA - legOrderB;
          return Number(a?.display_order || a?.split_index || a?.order || 0) - Number(b?.display_order || b?.split_index || b?.order || 0);
        })
        .map((split: any, index: number) => normalizeRouteSplitPoint(split, index));

      return mapped;
    };

    gpxKeys.forEach(assetKey => {
      const url = params.courseMaps?.[assetKey];
      if (typeof url !== 'string' || !url) return;
      const contestSplits = getRouteSplitsFromTimingConfig(assetKey);
      // Only use timing configuration splits (Legs & Splits).
      // Do not read imported splits from Course Maps for timeline/markers.
      const splitPoints = [...contestSplits]
        .filter((split, index, all) => {
          const id = String((split as any)?.id || (split as any)?.uuid || (split as any)?.name || (split as any)?.label || index).toLowerCase();
          return all.findIndex((candidate, candidateIndex) => String((candidate as any)?.id || (candidate as any)?.uuid || (candidate as any)?.name || (candidate as any)?.label || candidateIndex).toLowerCase() === id) === index;
        })
        .sort((a, b) => Number(a.distance || 0) - Number(b.distance || 0));
      routes.push({
        url,
        color: (gpxAssetConfig as any)[assetKey]?.color || '#8884d8',
        type: (gpxAssetConfig as any)[assetKey]?.type || 'bike',
        assetKey,
        splitPoints,
        routeScope: params.routeScope,
        ticketId: params.ticketId,
        subCategoryId: params.subCategoryId || null,
        contestKey: matchedContestKey || params.contestKey || null,
      });
    });
    return routes;
  }, [normalizeRouteSplitPoint, timingConfiguration]);

  const ticketToCourseMap = useMemo(() => {
    const map = new Map<string, CourseRoute[]>();
    ticketDefinitions.forEach((ticket: TicketDefinition) => {
      if (!ticket) return;
      const ticketRoutes = buildRoutesFromCourseMaps({
        ticketId: ticket.id,
        courseMaps: ticket.courseMaps,
        routeScope: 'ticket',
        contestKey: ticket.id,
        contestKeyCandidates: [
          String((ticket as any)?.contestUuid || '').trim(),
          String((ticket as any)?.contest_uuid || '').trim(),
          String((ticket as any)?.providerContestUuid || '').trim(),
          String((ticket as any)?.contestId || '').trim(),
          String((ticket as any)?.contest_id || '').trim(),
        ],
      });
      map.set(ticket.id, ticketRoutes);

      const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
      subCategories.forEach((subCategory: any) => {
        const subCategoryId = String(subCategory?.id || '').trim();
        if (!subCategoryId) return;
        const subRoutes = buildRoutesFromCourseMaps({
          ticketId: ticket.id,
          courseMaps: subCategory?.courseMaps || ticket.courseMaps,
          routeScope: 'subCategory',
          subCategoryId,
          contestKey: `${ticket.id}:${subCategoryId}`,
          contestKeyCandidates: [
            String(subCategory?.contestUuid || '').trim(),
            String(subCategory?.contest_uuid || '').trim(),
            String(subCategory?.providerContestUuid || '').trim(),
            String(subCategory?.contestId || '').trim(),
            String(subCategory?.contest_id || '').trim(),
            String((ticket as any)?.contestUuid || '').trim(),
            String((ticket as any)?.contest_uuid || '').trim(),
            String((ticket as any)?.providerContestUuid || '').trim(),
            String((ticket as any)?.contestId || '').trim(),
            String((ticket as any)?.contest_id || '').trim(),
          ],
        });
        if (subRoutes.length > 0) {
          map.set(`${ticket.id}:${subCategoryId}`, subRoutes);
        }
      });
    });
    return map;
  }, [ticketDefinitions, buildRoutesFromCourseMaps]);

  const contestFilterOptions = useMemo(() => {
    const options: Array<{ key: string; label: string; ticket: TicketDefinition; dateKey: string; order: number; subCategoryId?: string | null }> = [];

    for (const ticket of ticketDefinitions || []) {
      if (!ticket || ticket.isHidden) continue;
      const ticketId = String(ticket.id || '').trim();
      if (!ticketId) continue;

      const ticketRoutes = ticketToCourseMap.get(ticketId);
      const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
      const ticketDateKey = getTicketDateKey(ticket);
      const ticketLabel = String(ticket.ticketName || '').trim();

      const hasMappedParentRoute = !!(ticketRoutes && ticketRoutes.length > 0);
      const mappedSubCategories = subCategories
        .map((subCategory: any) => {
          const subCategoryId = String(subCategory?.id || '').trim();
          if (!subCategoryId) return null;
          const key = `${ticketId}:${subCategoryId}`;
          return {
            key,
            label: `${ticketLabel} - ${String(subCategory?.name || subCategory?.title || subCategory?.label || 'Sub Category').trim()}`,
            ticket,
            dateKey: getContestDisplayDateKey(subCategory) || ticketDateKey,
            order: Number(subCategory?.order ?? ticket.order ?? 0),
            subCategoryId,
          };
        })
        .filter(Boolean) as Array<{ key: string; label: string; ticket: TicketDefinition; dateKey: string; order: number; subCategoryId: string }>;

      if (mappedSubCategories.length > 0) {
        options.push(...mappedSubCategories);
        continue;
      }

      if (hasMappedParentRoute && subCategories.length === 0) {
        options.push({
          key: ticketId,
          label: ticketLabel,
          ticket,
          dateKey: ticketDateKey,
          order: Number(ticket.order || 0),
          subCategoryId: null,
        });
      }
    }

    return options.sort((a, b) => {
      const distanceA = parseContestDistanceScore(a.label);
      const distanceB = parseContestDistanceScore(b.label);
      const aHasDistance = distanceA >= 0;
      const bHasDistance = distanceB >= 0;

      if (aHasDistance && bHasDistance && distanceA !== distanceB) return distanceB - distanceA;
      if (aHasDistance !== bHasDistance) return aHasDistance ? -1 : 1;
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label);
    });
  }, [getContestDisplayDateKey, getTicketDateKey, parseContestDistanceScore, ticketDefinitions, ticketToCourseMap]);

  const availableRaceDays = useMemo(() => {
    const days = contestFilterOptions.map((option) => option.dateKey).filter(Boolean);
    return Array.from(new Set(days)).sort((a, b) => new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime());
  }, [contestFilterOptions]);

  const selectedRaceContestOptions = useMemo(() => {
    if (availableRaceDays.length === 0) return contestFilterOptions;
    if (!selectedRaceDayKey) return contestFilterOptions.filter((option) => !option.dateKey || option.dateKey === '');
    return contestFilterOptions.filter((option) => option.dateKey === selectedRaceDayKey);
  }, [availableRaceDays.length, contestFilterOptions, selectedRaceDayKey]);

  const selectedRaceContestKeys = useMemo(() => new Set(selectedRaceContestOptions.map((option) => option.key)), [selectedRaceContestOptions]);

  const selectedRaceTicketDefinitions = useMemo(() => {
    const byTicketId = new Map<string, TicketDefinition & { subCategories?: any[] }>();
    for (const option of selectedRaceContestOptions) {
      const ticketId = String(option.ticket?.id || '').trim();
      if (!ticketId) continue;
      const existing = byTicketId.get(ticketId) || { ...option.ticket, subCategories: [] as any[] };
      const isSubCategoryContest = Boolean(option.subCategoryId);
      if (isSubCategoryContest) {
        const sourceSubCategories = Array.isArray((option.ticket as any)?.subCategories) ? (option.ticket as any).subCategories : [];
        const mappedSub = sourceSubCategories.find((sub: any) => String(sub?.id || '').trim() === option.subCategoryId) || null;
        if (mappedSub) {
          existing.subCategories = [...(existing.subCategories || []), mappedSub];
        }
      } else {
        existing.subCategories = [];
      }
      byTicketId.set(ticketId, existing);
    }

    return Array.from(byTicketId.values()).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }, [selectedRaceContestOptions]);

  const getAthleteContestFilterKey = useCallback((athlete: LiveAthlete | Record<string, any>) => {
    const identity = resolveAthleteTicketIdentity(athlete);
    if (identity.ticketId) {
      const ticket = ticketDefinitions.find((item: TicketDefinition) => String(item?.id || '').trim() === identity.ticketId);
      const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
      if (identity.subCategoryId) {
        return `${identity.ticketId}:${identity.subCategoryId}`;
      }

      const contestLabel = String(
        (athlete as any)?.contestName
        || (athlete as any)?.contest_name
        || (athlete as any)?.category
        || (athlete as any)?.providerContestName
        || '',
      ).trim().toLowerCase();

      if (subCategories.length > 0 && contestLabel) {
        const matchedSub = subCategories.find((sub: any) => {
          const subLabels = [sub?.id, sub?.name, sub?.title, sub?.label].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
          if (subLabels.some((label) => contestLabel.includes(label) || label.includes(contestLabel))) return true;

          const athleteAge = normalizeContestText(
            (athlete as any)?.ageGroupName
            || (athlete as any)?.age_group_name
            || (athlete as any)?.ageGroup
            || (athlete as any)?.provider?.ageGroupName
            || (athlete as any)?.provider?.age_group_name
            || (athlete as any)?.registration?.ageGroup
            || '',
          );
          if (!athleteAge) return false;
          const ageGroups = Array.isArray(sub?.applicableAgeGroups)
            ? sub.applicableAgeGroups
            : typeof sub?.applicableAgeGroups === 'string'
              ? String(sub.applicableAgeGroups).split(',').map((s: string) => s.trim()).filter(Boolean)
              : [];
          return ageGroups.some((group: any) => normalizeContestText(group) === athleteAge);
        });
        if (matchedSub?.id) {
          return `${identity.ticketId}:${String(matchedSub.id).trim()}`;
        }
      }

      return identity.ticketId;
    }

    const contestLabel = String(
      (athlete as any)?.contestName
      || (athlete as any)?.contest_name
      || (athlete as any)?.category
      || (athlete as any)?.providerContestName
      || '',
    ).trim().toLowerCase();
    if (!contestLabel) return '';

    const matched = contestFilterOptions.find((option) => {
      const ticketName = String(option.ticket?.ticketName || '').trim().toLowerCase();
      const label = String(option.label || '').trim().toLowerCase();
      const subCategoryId = String(option.subCategoryId || '').trim().toLowerCase();
      return [ticketName, label, subCategoryId].some((value) => value && (contestLabel === value || contestLabel.includes(value) || value.includes(contestLabel)));
    });

    return matched?.key || '';
  }, [contestFilterOptions, normalizeContestText, resolveAthleteTicketIdentity, ticketDefinitions]);

  const getAthleteWatchlistKey = useCallback((athlete: LiveAthlete | Record<string, any>) => {
    return getAthleteStableId(athlete as any);
  }, []);

  const focusAthleteOnCorrectRaceDay = useCallback((athlete: LiveAthlete) => {
    const athleteKey = getAthleteContestFilterKey(athlete);
    if (!athleteKey) return;
    const matchedOption = contestFilterOptions.find((option) => option.key === athleteKey);
    if (matchedOption?.dateKey) {
      setSelectedRaceDayKey(matchedOption.dateKey);
    }
  }, [contestFilterOptions, getAthleteContestFilterKey]);

  const isAthleteOnSelectedRaceDay = useCallback((athlete: LiveAthlete | Record<string, any>) => {
    if (selectedRaceContestKeys.size === 0) return true;
    const key = getAthleteContestFilterKey(athlete);
    return !!key && selectedRaceContestKeys.has(key);
  }, [getAthleteContestFilterKey, selectedRaceContestKeys]);

  useEffect(() => {
    if (contestFilterOptions.length === 0) {
      setSelectedRaceDayKey(null);
      return;
    }
    if (selectedRaceDayKey && availableRaceDays.includes(selectedRaceDayKey)) return;

    const todayKey = normalizeDateKeyValue(new Date().toISOString());
    const preferredDay = availableRaceDays.includes(todayKey) ? todayKey : availableRaceDays[0] || contestFilterOptions[0]?.dateKey || null;
    setSelectedRaceDayKey(preferredDay);
  }, [availableRaceDays, contestFilterOptions, selectedRaceDayKey]);

  useEffect(() => {
    if (selectedRaceContestOptions.length === 0) return;
    const firstKey = selectedRaceContestOptions[0]?.key || null;
    if (!firstKey) return;
    if (contestFilterInitializedForEventRef.current !== eventDetails.id) {
      contestFilterInitializedForEventRef.current = eventDetails.id;
      setTicketFilter('all');
      setCategoryFilter('all');
      return;
    }
    if (ticketFilter !== 'all' && !selectedRaceContestKeys.has(ticketFilter)) {
      setTicketFilter('all');
      setCategoryFilter('all');
    }
    if (ticketFilter !== 'all' && selectedRaceContestKeys.has(ticketFilter)) {
      setSelectedTicketId(ticketFilter);
    }
  }, [eventDetails.id, selectedRaceContestKeys, selectedRaceContestOptions, ticketFilter]);

  const baseVisibleAthletes = useMemo(
    () => dedupeAthletes((isReplayMode ? replayData : liveData)
      .map((athlete) => normalizeVisibleAthlete(athlete))
      .filter((row) => isActiveAthlete(row))
      .filter((row) => isAthleteOnSelectedRaceDay(row))),
    [isReplayMode, replayData, liveData, normalizeVisibleAthlete, isAthleteOnSelectedRaceDay],
  );

  const activePredictionIds = useMemo(() => {
    const ids = new Set<string>();
    trackedAthleteIds.forEach((id) => ids.add(id));
    if (focusedAthlete) ids.add(getAthleteStableId(focusedAthlete));
    if (selectedAthleteForModal) ids.add(getAthleteStableId(selectedAthleteForModal));
    return ids;
  }, [focusedAthlete, selectedAthleteForModal, trackedAthleteIds]);

  const visibleAthletes = useMemo(() => {
    if (isReplayMode || eventDetails.liveDataSource !== 'timing_partner') return baseVisibleAthletes;
    return dedupeAthletes(baseVisibleAthletes.map((athlete) => {
      const athleteId = getAthleteStableId(athlete);
      const shouldPredict = activePredictionIds.has(athleteId);
      if (!shouldPredict) return athlete;
      return applyPredictionEngine({ athlete, nowSec: predictionNowSec, timingConfiguration });
    }));
  }, [activePredictionIds, baseVisibleAthletes, eventDetails.liveDataSource, isReplayMode, predictionNowSec, timingConfiguration]);

  const publicSearchableAthletes = useMemo(
    () => visibleAthletes.filter((athlete) => (athlete as any)?.searchVisible !== false),
    [visibleAthletes],
  );

  const publicMapAthletes = useMemo(
    () => visibleAthletes.filter((athlete) => (athlete as any)?.mapVisible !== false),
    [visibleAthletes],
  );

  const currentAthleteRecord = useMemo(() => {
    const uid = String(currentUser?.uid || '').trim().toLowerCase();
    const email = String(currentUser?.email || '').trim().toLowerCase();
    if (!uid && !email) return null;

    return visibleAthletes.find((athlete) => {
      const row = athlete as any;
      const athleteUid = String(row?.athleteUid || row?.bergmanAthleteId || row?.userId || '').trim().toLowerCase();
      const rowEmail = String(row?.email || row?.registration?.email || '').trim().toLowerCase();
      return (uid && athleteUid === uid) || (email && rowEmail === email);
    }) || null;
  }, [currentUser?.email, currentUser?.uid, visibleAthletes]);

  const handlePrivacyChange = useCallback(async (nextPrivacy: 'PUBLIC' | 'ANONYMOUS' | 'PRIVATE') => {
    if (!currentUser?.uid) return;

    const result = await updateLiveTrackingPrivacyAction(currentUser.uid, nextPrivacy);
    if (!result.success) {
      toast({ variant: 'destructive', title: 'Unable to save privacy', description: result.message });
      return;
    }

    const applyNextVisibility = (row: LiveAthlete): LiveAthlete => {
      const nextBase = {
        ...row,
        privacy: nextPrivacy,
        trackingVisibility: nextPrivacy,
        liveTrackingPrivacy: nextPrivacy,
        registration: {
          ...(row as any)?.registration || {},
          liveTrackingPrivacy: nextPrivacy,
          trackingVisibility: nextPrivacy,
        },
      } as LiveAthlete;

      if (nextPrivacy === 'PRIVATE') return maskPrivateAthlete(nextBase) as unknown as LiveAthlete;
      if (nextPrivacy === 'ANONYMOUS') return maskAnonymousAthlete(nextBase) as unknown as LiveAthlete;
      return nextBase;
    };

    setLiveData((prev) => prev.map((row) => {
      const athleteUid = String((row as any)?.athleteUid || (row as any)?.bergmanAthleteId || '').trim().toLowerCase();
      const rowEmail = String((row as any)?.email || (row as any)?.registration?.email || '').trim().toLowerCase();
      const uid = String(currentUser.uid || '').trim().toLowerCase();
      const email = String(currentUser.email || '').trim().toLowerCase();
      if (!((uid && athleteUid === uid) || (email && rowEmail === email))) return row;
      return applyNextVisibility(row);
    }) as LiveAthlete[]);

    setTrackedAthleteStore((prev) => {
      const next = new Map(prev);
      prev.forEach((row, key) => {
        const athleteUid = String((row as any)?.athleteUid || (row as any)?.bergmanAthleteId || '').trim().toLowerCase();
        const rowEmail = String((row as any)?.email || (row as any)?.registration?.email || '').trim().toLowerCase();
        const uid = String(currentUser.uid || '').trim().toLowerCase();
        const email = String(currentUser.email || '').trim().toLowerCase();
        if ((uid && athleteUid === uid) || (email && rowEmail === email)) {
          next.set(key, applyNextVisibility(row));
        }
      });
      return next;
    });

    setSelectedAthleteForModal((prev) => {
      if (!prev) return prev;
      const athleteUid = String((prev as any)?.athleteUid || (prev as any)?.bergmanAthleteId || '').trim().toLowerCase();
      const rowEmail = String((prev as any)?.email || (prev as any)?.registration?.email || '').trim().toLowerCase();
      const uid = String(currentUser.uid || '').trim().toLowerCase();
      const email = String(currentUser.email || '').trim().toLowerCase();
      return ((uid && athleteUid === uid) || (email && rowEmail === email)) ? applyNextVisibility(prev) : prev;
    });

    setFocusedAthlete((prev) => {
      if (!prev) return prev;
      const athleteUid = String((prev as any)?.athleteUid || (prev as any)?.bergmanAthleteId || '').trim().toLowerCase();
      const rowEmail = String((prev as any)?.email || (prev as any)?.registration?.email || '').trim().toLowerCase();
      const uid = String(currentUser.uid || '').trim().toLowerCase();
      const email = String(currentUser.email || '').trim().toLowerCase();
      return ((uid && athleteUid === uid) || (email && rowEmail === email)) ? applyNextVisibility(prev) : prev;
    });

    if (firebaseUserFromAuth && fetchUserProfile) {
      await fetchUserProfile(firebaseUserFromAuth);
    }

    toast({ title: 'Live tracking updated', description: result.message });
  }, [currentUser?.email, currentUser?.uid, fetchUserProfile, firebaseUserFromAuth, toast]);

  const leaderboardReady = Boolean(timingConfiguration && contestFilterOptions.length > 0 && courseConfig);

  const handleGpxDataLoaded = useCallback((gpxPaths: GpxPath[]) => {
    setElevationData(gpxPaths);
  }, []);

  // Convert raw participant data to LiveAthlete format for display
  const convertSearchResultToLiveAthlete = useCallback((entry: Record<string, any>): LiveAthlete => {
    const nameParts = resolveSearchEntryNameParts(entry || {});
    return {
      id: String(entry?.bergmanAthleteId || entry?.provider?.providerUuid || entry?.participantUuid || `participant-${Math.random()}`),
      bib: String(entry?.bib || '').trim() || 'N/A',
      name: nameParts.fullName,
      fullName: nameParts.fullName,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      initials: normalizeAthleteInitials(nameParts.fullName),
      category: String(entry?.category || entry?.contestName || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
      ageGroup: String(entry?.ageGroupName || entry?.age_group_name || entry?.registration?.ageGroup || entry?.ageGroup || 'Not Assigned').trim() || 'Not Assigned',
      ageGroupName: String(entry?.ageGroupName || entry?.age_group_name || entry?.registration?.ageGroup || entry?.ageGroup || 'Not Assigned').trim() || 'Not Assigned',
      age_group_name: String(entry?.ageGroupName || entry?.age_group_name || entry?.registration?.ageGroup || entry?.ageGroup || 'Not Assigned').trim() || 'Not Assigned',
      gender: (() => {
        const raw = String(entry?.gender || entry?.registration?.gender || entry?.provider?.gender || '').trim().toLowerCase();
        if (raw.startsWith('f')) return 'Female';
        if (raw.startsWith('m')) return 'Male';
        return 'Not Assigned';
      })(),
      status: getDisplayStatus(String(entry?.live?.status || entry?.registration?.status || 'Not Started')),
      leg: String(entry?.live?.currentSplit || 'NOT_STARTED'),
      splits: [],
      startTime: null,
      lastUpdateTime: Date.now(),
      ticketId: String(entry?.registration?.ticketId || '').trim() || null,
      courseProgress: 0,
      clubName: String(entry?.club || entry?.provider?.club || entry?.registration?.club || '').trim() || null,
      country: String(entry?.country || entry?.countryCode || entry?.country_code || entry?.countryName || entry?.countryAtRace || entry?.nationality || entry?.registration?.country || entry?.registration?.countryCode || entry?.registration?.countryName || entry?.registration?.countryAtRace || entry?.registration?.nationality || entry?.provider?.country || entry?.provider?.countryCode || entry?.provider?.countryName || entry?.provider?.countryAtRace || entry?.provider?.nationality || '').trim() || null,
      countryCode: String(entry?.countryCode || entry?.country_code || entry?.country || entry?.registration?.countryCode || entry?.provider?.countryCode || '').trim() || null,
      countryName: String(entry?.countryName || entry?.countryAtRace || entry?.country || entry?.registration?.countryName || entry?.registration?.countryAtRace || entry?.provider?.countryName || entry?.provider?.countryAtRace || '').trim() || null,
      countryAtRace: String(entry?.countryAtRace || entry?.countryName || entry?.country || '').trim() || null,
      nationality: String(entry?.nationality || entry?.registration?.nationality || entry?.provider?.nationality || '').trim() || null,
      athleteUid: String(entry?.bergmanAthleteId || '').trim() || null,
      participantUuid: String(entry?.provider?.providerUuid || entry?.bergmanAthleteId || entry?.participantUuid || '').trim() || null,
      participant_uuid: String(entry?.provider?.providerUuid || entry?.bergmanAthleteId || entry?.participantUuid || '').trim() || null,
      contestUuid: String(entry?.provider?.contestUuid || '').trim() || null,
      contest_uuid: String(entry?.provider?.contestUuid || '').trim() || null,
      providerContestUuid: String(entry?.provider?.contestUuid || '').trim() || null,
      providerContestName: String(entry?.contestName || entry?.category || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
      contestName: String(entry?.contestName || entry?.category || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
      contest_name: String(entry?.contestName || entry?.category || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
      registrationStatus: String(entry?.registration?.status || '').trim() || null,
      liveTracking: {
        provider: String(entry?.provider?.provider || 'feibot').trim() || 'feibot',
        participantUuid: String(entry?.provider?.providerUuid || entry?.bergmanAthleteId || entry?.participantUuid || '').trim() || null,
        contestUuid: String(entry?.provider?.contestUuid || '').trim() || null,
        contestName: String(entry?.provider?.contestName || entry?.category || '').trim() || null,
        bib: String(entry?.bib || '').trim() || null,
        chip: String(entry?.chip || entry?.provider?.chip || '').trim() || null,
      },
      email: String(entry?.registration?.email || entry?.email || '').trim() || null,
    } as LiveAthlete;
  }, [getContestLabel]);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      toast({ variant: 'destructive', title: 'Invalid Search', description: 'Please enter a BIB number or name.' });
      return;
    }
    setHasSearched(true);
    setIsSearching(true);

    // KV-only athlete search (no Firestore search path).
    try {
      const response = await fetch(`/api/live/athlete-master-search/${encodeURIComponent(eventDetails.id)}?q=${encodeURIComponent(searchTerm.trim())}&mode=${encodeURIComponent(searchBy)}&kvOnly=1`, {
        method: 'GET',
        cache: 'no-store',
        headers: authHeaders,
      });
      const payload = await response.json().catch(() => null);
      const matches = Array.isArray(payload?.matches) ? payload.matches : [];
      if (response.ok && matches.length > 0) {
        const mapped: LiveAthlete[] = matches.map((entry: any, index: number) => {
          const nameParts = resolveSearchEntryNameParts(entry || {});
          return {
            id: String(entry?.bergmanAthleteId || entry?.provider?.providerUuid || `master-${index + 1}`),
            bib: String(entry?.bib || '').trim() || 'N/A',
            name: nameParts.fullName,
            fullName: nameParts.fullName,
            firstName: nameParts.firstName,
            lastName: nameParts.lastName,
            initials: normalizeAthleteInitials(nameParts.fullName),
            category: String(entry?.category || entry?.contestName || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
            ageGroup: String(entry?.ageGroupName || entry?.age_group_name || entry?.registration?.ageGroup || entry?.ageGroup || 'Not Assigned').trim() || 'Not Assigned',
            ageGroupName: String(entry?.ageGroupName || entry?.age_group_name || entry?.registration?.ageGroup || entry?.ageGroup || 'Not Assigned').trim() || 'Not Assigned',
            age_group_name: String(entry?.ageGroupName || entry?.age_group_name || entry?.registration?.ageGroup || entry?.ageGroup || 'Not Assigned').trim() || 'Not Assigned',
            gender: (() => {
              const raw = String(entry?.gender || entry?.registration?.gender || entry?.provider?.gender || '').trim().toLowerCase();
              if (raw.startsWith('f')) return 'Female';
              if (raw.startsWith('m')) return 'Male';
              return 'Not Assigned';
            })(),
            status: getDisplayStatus(String(entry?.live?.status || entry?.registration?.status || 'Not Started')),
            leg: String(entry?.live?.currentSplit || 'NOT_STARTED'),
            splits: [],
            startTime: null,
            lastUpdateTime: Date.now(),
            ticketId: String(entry?.registration?.ticketId || '').trim() || null,
            courseProgress: 0,
            clubName: String(entry?.club || entry?.provider?.club || entry?.registration?.club || '').trim() || null,
            country: String(entry?.country || entry?.countryCode || entry?.country_code || entry?.countryName || entry?.countryAtRace || entry?.nationality || entry?.registration?.country || entry?.registration?.countryCode || entry?.registration?.countryName || entry?.registration?.countryAtRace || entry?.registration?.nationality || entry?.provider?.country || entry?.provider?.countryCode || entry?.provider?.countryName || entry?.provider?.countryAtRace || entry?.provider?.nationality || '').trim() || null,
            countryCode: String(entry?.countryCode || entry?.country_code || entry?.country || entry?.registration?.countryCode || entry?.provider?.countryCode || '').trim() || null,
            countryName: String(entry?.countryName || entry?.countryAtRace || entry?.country || entry?.registration?.countryName || entry?.registration?.countryAtRace || entry?.provider?.countryName || entry?.provider?.countryAtRace || '').trim() || null,
            countryAtRace: String(entry?.countryAtRace || entry?.countryName || entry?.country || '').trim() || null,
            nationality: String(entry?.nationality || entry?.registration?.nationality || entry?.provider?.nationality || '').trim() || null,
            athleteUid: String(entry?.bergmanAthleteId || '').trim() || null,
            participantUuid: String(entry?.provider?.providerUuid || entry?.bergmanAthleteId || '').trim() || null,
            participant_uuid: String(entry?.provider?.providerUuid || entry?.bergmanAthleteId || '').trim() || null,
            contestUuid: String(entry?.provider?.contestUuid || '').trim() || null,
            contest_uuid: String(entry?.provider?.contestUuid || '').trim() || null,
            providerContestUuid: String(entry?.provider?.contestUuid || '').trim() || null,
            providerContestName: String(entry?.contestName || entry?.category || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
            contestName: String(entry?.contestName || entry?.category || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
            contest_name: String(entry?.contestName || entry?.category || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
            registrationStatus: String(entry?.registration?.status || '').trim() || null,
            liveTracking: {
              provider: String(entry?.provider?.provider || 'feibot').trim() || 'feibot',
              participantUuid: String(entry?.provider?.providerUuid || entry?.bergmanAthleteId || '').trim() || null,
              contestUuid: String(entry?.provider?.contestUuid || '').trim() || null,
              contestName: String(entry?.provider?.contestName || entry?.category || '').trim() || null,
              bib: String(entry?.bib || '').trim() || null,
              chip: String(entry?.chip || entry?.provider?.chip || '').trim() || null,
            },
            email: String(entry?.registration?.email || entry?.email || '').trim() || null,
          } as LiveAthlete;
        }).map((row: any) => normalizeVisibleAthlete(row)).filter((row: any) => isActiveAthlete(row));
        if (mapped.length === 1) {
          addAthleteToPersonalWatch(mapped[0]);
          toast({ title: 'Added to Watchlist', description: `${mapped[0].name} added from live KV index.` });
          setIsSearching(false);
          return;
        }
        setSearchResults(dedupeAthletes(mapped));
        toast({ title: 'Athlete Found', description: 'Loaded from live KV index.' });
      } else {
        setSearchResults([]);
        toast({ variant: 'destructive', title: 'Not Found', description: `No data found for "${searchTerm}".` });
      }
    } catch {
      setSearchResults([]);
      toast({ variant: 'destructive', title: 'Not Found', description: `No data found for "${searchTerm}".` });
    }
    setIsSearching(false);
  };
  
  const clearSearch = () => {
    setSearchTerm('');
    setHasSearched(false);
    setSearchResults([]);
    setSearchSuggestions([]);
  };

  function addAthleteToPersonalWatch(athlete: LiveAthlete) {
    focusAthleteOnCorrectRaceDay(athlete);
    handleToggleTrackAthlete(athlete);
    clearSearch();
  }

  // Sync tracked IDs to canonical live IDs when visibleAthletes updates.
  // This fixes ghost entries where an athlete was stored with a placeholder ID
  // (e.g. "participant:abc" from master-index) but live data resolves to "bib:1234:xyz".
  useEffect(() => {
    if (visibleAthletes.length === 0) return;
    setTrackedAthleteIds((prevIds) => {
      if (prevIds.size === 0) return prevIds;
      const migrations: Array<{ oldId: string; newId: string }> = [];
      prevIds.forEach((trackedId) => {
        // We need the stored athlete — read it from the store directly via functional updater below
        // Here we only detect if the live data has a canonical match
        const liveMatch = visibleAthletes.find((a) => getAthleteStableId(a) === trackedId);
        if (liveMatch) return; // Already canonical — no migration needed
      });
      if (migrations.length === 0) return prevIds;
      const next = new Set(prevIds);
      migrations.forEach(({ oldId, newId }) => { next.delete(oldId); next.add(newId); });
      return next;
    });

    setTrackedAthleteStore((prevStore) => {
      if (prevStore.size === 0) return prevStore;
      let changed = false;
      const next = new Map(prevStore);
      prevStore.forEach((stored, trackedId) => {
        // Skip if already has a canonical live match by exact ID
        if (visibleAthletes.some((a) => getAthleteStableId(a) === trackedId)) return;
        // Try to find live athlete by bib / uid / participantUuid
        const storedBib = String(stored.bib || '').trim().toLowerCase();
        const storedUid = String((stored as any).athleteUid || (stored as any).bergmanAthleteId || '').trim().toLowerCase();
        const storedPuid = String((stored as any).participantUuid || (stored as any).participant_uuid || (stored as any).liveTracking?.participantUuid || '').trim().toLowerCase();
        const liveMatch = visibleAthletes.find((a) => {
          if (storedBib && storedBib !== 'n/a' && String(a.bib || '').trim().toLowerCase() === storedBib) return true;
          if (storedUid) { const aUid = String((a as any).athleteUid || (a as any).bergmanAthleteId || '').trim().toLowerCase(); if (aUid && aUid === storedUid) return true; }
          if (storedPuid) { const aPuid = String((a as any).participantUuid || (a as any).participant_uuid || (a as any).liveTracking?.participantUuid || '').trim().toLowerCase(); if (aPuid && aPuid === storedPuid) return true; }
          return false;
        });
        if (!liveMatch) return;
        const newId = getAthleteStableId(liveMatch);
        if (newId === trackedId) return;
        // Migrate: remove old placeholder key, add canonical live key
        next.delete(trackedId);
        if (!next.has(newId)) next.set(newId, { ...liveMatch, id: newId });
        changed = true;
      });
      return changed ? next : prevStore;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAthletes]);

  useEffect(() => {
    setHasSearched(false);
    setSearchResults([]);
    setSearchSuggestions([]);
  }, [searchBy]);

  useEffect(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      setSearchSuggestions([]);
      return;
    }

    const abortController = new AbortController();
    const runKvSuggestions = async () => {
      try {
        const response = await fetch(`/api/live/athlete-master-search/${encodeURIComponent(eventDetails.id)}?q=${encodeURIComponent(searchTerm.trim())}&mode=${encodeURIComponent(searchBy)}&kvOnly=1`, {
          method: 'GET',
          cache: 'no-store',
          headers: authHeaders,
          signal: abortController.signal,
        });
        const payload = await response.json().catch(() => null);
        const matches = Array.isArray(payload?.matches) ? payload.matches : [];
        const mapped: LiveAthlete[] = matches.map((entry: any, index: number) => ({
          id: String(entry?.bergmanAthleteId || entry?.provider?.providerUuid || `master-suggest-${index + 1}`),
          bib: String(entry?.bib || '').trim() || 'N/A',
          ...(() => {
            const nameParts = resolveSearchEntryNameParts(entry || {});
            return {
              name: nameParts.fullName,
              fullName: nameParts.fullName,
              firstName: nameParts.firstName,
              lastName: nameParts.lastName,
              initials: normalizeAthleteInitials(nameParts.fullName),
            };
          })(),
          category: String(entry?.category || entry?.contestName || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
          ageGroup: String(entry?.ageGroupName || entry?.age_group_name || entry?.registration?.ageGroup || entry?.ageGroup || 'Not Assigned').trim() || 'Not Assigned',
          ageGroupName: String(entry?.ageGroupName || entry?.age_group_name || entry?.registration?.ageGroup || entry?.ageGroup || 'Not Assigned').trim() || 'Not Assigned',
          age_group_name: String(entry?.ageGroupName || entry?.age_group_name || entry?.registration?.ageGroup || entry?.ageGroup || 'Not Assigned').trim() || 'Not Assigned',
          gender: (() => {
            const raw = String(entry?.gender || entry?.registration?.gender || entry?.provider?.gender || '').trim().toLowerCase();
            if (raw.startsWith('f')) return 'Female';
            if (raw.startsWith('m')) return 'Male';
            return 'Not Assigned';
          })(),
          status: getDisplayStatus(String(entry?.live?.status || entry?.registration?.status || 'Not Started')),
          leg: String(entry?.live?.currentSplit || 'NOT_STARTED'),
          splits: [],
          startTime: null,
          lastUpdateTime: Date.now(),
          ticketId: String(entry?.registration?.ticketId || '').trim() || null,
          courseProgress: 0,
          clubName: String(entry?.club || entry?.provider?.club || entry?.registration?.club || '').trim() || null,
          country: String(entry?.country || entry?.countryCode || entry?.country_code || entry?.countryName || entry?.countryAtRace || entry?.nationality || entry?.registration?.country || entry?.registration?.countryCode || entry?.registration?.countryName || entry?.registration?.countryAtRace || entry?.registration?.nationality || entry?.provider?.country || entry?.provider?.countryCode || entry?.provider?.countryName || entry?.provider?.countryAtRace || entry?.provider?.nationality || '').trim() || null,
          countryCode: String(entry?.countryCode || entry?.country_code || entry?.country || entry?.registration?.countryCode || entry?.provider?.countryCode || '').trim() || null,
          countryName: String(entry?.countryName || entry?.countryAtRace || entry?.country || entry?.registration?.countryName || entry?.registration?.countryAtRace || entry?.provider?.countryName || entry?.provider?.countryAtRace || '').trim() || null,
          countryAtRace: String(entry?.countryAtRace || entry?.countryName || entry?.country || '').trim() || null,
          nationality: String(entry?.nationality || entry?.registration?.nationality || entry?.provider?.nationality || '').trim() || null,
          athleteUid: String(entry?.bergmanAthleteId || '').trim() || null,
          participantUuid: String(entry?.provider?.providerUuid || entry?.bergmanAthleteId || '').trim() || null,
          participant_uuid: String(entry?.provider?.providerUuid || entry?.bergmanAthleteId || '').trim() || null,
          contestUuid: String(entry?.provider?.contestUuid || '').trim() || null,
          contest_uuid: String(entry?.provider?.contestUuid || '').trim() || null,
          providerContestUuid: String(entry?.provider?.contestUuid || '').trim() || null,
          providerContestName: String(entry?.contestName || entry?.category || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
          contestName: String(entry?.contestName || entry?.category || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
          contest_name: String(entry?.contestName || entry?.category || getContestLabel(entry) || 'Unmapped').trim() || 'Unmapped',
          registrationStatus: String(entry?.registration?.status || '').trim() || null,
          liveTracking: {
            provider: String(entry?.provider?.provider || 'feibot').trim() || 'feibot',
            participantUuid: String(entry?.provider?.providerUuid || entry?.bergmanAthleteId || '').trim() || null,
            contestUuid: String(entry?.provider?.contestUuid || '').trim() || null,
            contestName: String(entry?.provider?.contestName || entry?.category || '').trim() || null,
            bib: String(entry?.bib || '').trim() || null,
            chip: String(entry?.chip || entry?.provider?.chip || '').trim() || null,
          },
          email: String(entry?.registration?.email || entry?.email || '').trim() || null,
        })).map((row: any) => normalizeVisibleAthlete(row)).filter((row: any) => isActiveAthlete(row));

        setSearchSuggestions(dedupeAthletes(mapped).slice(0, 8));
      } catch {
        if (!abortController.signal.aborted) {
          setSearchSuggestions([]);
        }
      }
    };

    const debounce = setTimeout(() => {
      void runKvSuggestions();
    }, 200);

    return () => {
      clearTimeout(debounce);
      abortController.abort();
    };
  }, [searchTerm, searchBy, authHeaders, eventDetails.id, getContestLabel, normalizeVisibleAthlete]);

  const trackedAthleteRankById = useMemo(() => {
    const rankMap = new Map<string, number>();
    visibleAthletes.forEach((athlete, index) => {
      rankMap.set(getAthleteStableId(athlete), Number(athlete.rank || index + 1));
    });
    return rankMap;
  }, [visibleAthletes]);

  const trackedAthletes = useMemo(() => {
    if (trackedAthleteIds.size === 0) return [];
    const dataToFilter = visibleAthletes;
    const deduped = new Map<string, LiveAthlete>();
    Array.from(trackedAthleteIds)
      .map((trackedId) => {
        const stored = trackedAthleteStore.get(trackedId);
        const liveMatch = dataToFilter.find((athlete) =>
          getAthleteStableId(athlete) === trackedId ||
          (!!stored?.bib && athlete.bib === stored.bib) ||
          (!!stored?.athleteUid && athlete.athleteUid === stored.athleteUid),
        );
        return liveMatch || stored || null;
      })
      .filter((athlete): athlete is LiveAthlete => athlete !== null)
      .forEach((athlete) => {
        const key = getAthleteWatchlistKey(athlete);
        if (!deduped.has(key)) deduped.set(key, athlete);
      });
    return Array.from(deduped.values());
  }, [visibleAthletes, trackedAthleteIds, trackedAthleteStore, getAthleteWatchlistKey])
    .sort((a, b) => {
      const aRank = trackedAthleteRankById.get(getAthleteStableId(a)) ?? Number.MAX_SAFE_INTEGER;
      const bRank = trackedAthleteRankById.get(getAthleteStableId(b)) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return String(a.bib || a.name || '').localeCompare(String(b.bib || b.name || ''));
    });

  const activeWatchlistContestKey = useMemo(() => {
    if (selectedTicketId && selectedTicketId !== 'all') return selectedTicketId;
    if (ticketFilter && ticketFilter !== 'all') return ticketFilter;
    return null;
  }, [selectedTicketId, ticketFilter]);

  const watchedAthletesOnActiveContest = useMemo(() => {
    if (!activeWatchlistContestKey) return trackedAthletes;
    return trackedAthletes.filter((athlete) => {
      const contestKey = getAthleteContestFilterKey(athlete);
      return Boolean(contestKey) && (
        contestKey === activeWatchlistContestKey
        || contestKey.startsWith(`${activeWatchlistContestKey}:`)
        || activeWatchlistContestKey.startsWith(`${contestKey}:`)
      );
    });
  }, [activeWatchlistContestKey, getAthleteContestFilterKey, trackedAthletes]);

  const hiddenWatchlistCount = Math.max(0, trackedAthletes.length - watchedAthletesOnActiveContest.length);
  
  const athletesToDisplayOnMap = useMemo(() => {
    if (focusedAthlete && (focusedAthlete as any)?.mapVisible !== false) return [focusedAthlete];
    const source = watchedAthletesOnActiveContest.length > 0 ? watchedAthletesOnActiveContest : trackedAthletes;
    if (source.length === 0) return [];
    return source.filter((athlete) => (athlete as any)?.mapVisible !== false);
  }, [focusedAthlete, watchedAthletesOnActiveContest, trackedAthletes]);

  const eventCategoryDateSummary = useMemo(() => {
    const getOrdinal = (day: number) => {
      const mod100 = day % 100;
      if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
      const mod10 = day % 10;
      if (mod10 === 1) return `${day}st`;
      if (mod10 === 2) return `${day}nd`;
      if (mod10 === 3) return `${day}rd`;
      return `${day}th`;
    };
    const formatMonthYear = (date: Date) => {
      const month = date.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }).replace(/\.?$/, '');
      const normalizedMonth = month === 'Sep' ? 'Sept' : month;
      return `${normalizedMonth} ${date.getUTCFullYear()}`;
    };

    const formatDateLabel = (date: Date) => `${getOrdinal(date.getUTCDate())} ${formatMonthYear(date)}`;

    const dateKeys = (ticketDefinitions || [])
      .map((ticket: TicketDefinition) => {
        const dateRaw = String(ticket?.eventDate || '').trim();
        return normalizeDateKeyValue(dateRaw);
      })
      .filter(Boolean)
      .sort((a: string, b: string) => new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime());

    const uniqueDateKeys = Array.from(new Set(dateKeys));
    if (uniqueDateKeys.length === 0) return '';

    const dates = uniqueDateKeys
      .map((key) => ({ key, date: new Date(`${key}T00:00:00Z`) }))
      .filter((item) => !Number.isNaN(item.date.getTime()));

    if (dates.length === 0) return eventDetails?.eventDate ? formatDateLabel(new Date(`${normalizeDateKeyValue(String(eventDetails.eventDate))}T00:00:00Z`)) : 'Date TBD';
    if (dates.length === 1) {
      return formatDateLabel(dates[0].date);
    }

    const sameMonthYear = dates.every((item) => item.date.getUTCMonth() === dates[0].date.getUTCMonth() && item.date.getUTCFullYear() === dates[0].date.getUTCFullYear());
    if (sameMonthYear) {
      const dayLabels = dates.map((item) => getOrdinal(item.date.getUTCDate()));
      const joinedDays = dayLabels.length === 2
        ? `${dayLabels[0]} & ${dayLabels[1]}`
        : `${dayLabels.slice(0, -1).join(', ')} & ${dayLabels[dayLabels.length - 1]}`;
      const monthYear = formatMonthYear(dates[0].date);
      return `${joinedDays} ${monthYear}`;
    }

    return dates
      .map((item) => formatDateLabel(item.date))
      .join(' • ');
  }, [ticketDefinitions, eventDetails?.eventDate]);

  const mapTimingPointMarkers = useMemo(() => {
    const mergedContestPoints = Array.isArray((timingConfiguration as any)?.timingPointsByContest)
      ? Object.values((timingConfiguration as any).timingPointsByContest).flatMap((points) => Array.isArray(points) ? points : [])
      : Object.values((timingConfiguration as any)?.timingPointsByContest || {}).flatMap((points) => Array.isArray(points) ? points : []);

    const points = [
      ...(Array.isArray((timingConfiguration as any)?.course?.timingPoints) ? (timingConfiguration as any).course.timingPoints : []),
      ...(Array.isArray(timingConfiguration?.timingPoints) ? timingConfiguration.timingPoints : []),
      ...mergedContestPoints,
    ]
      .filter((point, index, all) => {
        const id = String(point?.id || point?.providerId || point?.providerCode || point?.displayName || point?.shortName || index).trim().toLowerCase();
        return id && all.findIndex((candidate, candidateIndex) => {
          const candidateId = String(candidate?.id || candidate?.providerId || candidate?.providerCode || candidate?.displayName || candidate?.shortName || candidateIndex).trim().toLowerCase();
          return candidateId === id;
        }) === index;
      })
      .slice()
      .sort((a, b) => a.order - b.order)
      .filter((point) => Number.isFinite(Number(point?.latitude)) && Number.isFinite(Number(point?.longitude)));

    if (points.length === 0) return [];

    const athlete = focusedAthlete || trackedAthletes[0] || null;
    const completed = new Set<string>();
    const currentToken = String(athlete?.splits?.[athlete.splits.length - 1]?.rawSplitLabel || athlete?.leg || '').trim().toLowerCase();
    (athlete?.splits || []).forEach((split) => {
      const token = String(split?.rawSplitLabel || split?.name || split?.segment || '').trim().toLowerCase();
      if (!token) return;
      completed.add(token);
    });

    return points.map((point) => {
      const tokenCandidates = [point.id, point.providerId, point.providerCode, point.displayName, point.shortName]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
      const isCurrent = currentToken && tokenCandidates.some((token) => token === currentToken || currentToken.includes(token) || token.includes(currentToken));
      const isCompleted = tokenCandidates.some((token) => completed.has(token));
      const status: 'completed' | 'current' | 'upcoming' = isCurrent ? 'current' : isCompleted ? 'completed' : 'upcoming';
      return {
        ...point,
        status,
      };
    });
  }, [timingConfiguration, focusedAthlete, trackedAthletes]);

  useEffect(() => {
    if (ticketDefinitions && ticketDefinitions.length > 0) {
      for (const ticket of ticketDefinitions) {
        const ticketRoutes = ticketToCourseMap.get(ticket.id);
        if (ticketRoutes && ticketRoutes.length > 0) {
          setSelectedTicketId(ticket.id);
          return;
        }
        const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
        for (const subCategory of subCategories) {
          const subCategoryId = String(subCategory?.id || '').trim();
          if (!subCategoryId) continue;
          const subRoutes = ticketToCourseMap.get(`${ticket.id}:${subCategoryId}`);
          if (subRoutes && subRoutes.length > 0) {
            setSelectedTicketId(`${ticket.id}:${subCategoryId}`);
            return;
          }
        }
      }
    }
  }, [ticketDefinitions, ticketToCourseMap]);

  const getTicketDefinitionForAthlete = useCallback((athlete?: LiveAthlete | null) => {
    if (!athlete?.ticketId) return undefined;
    return ticketDefinitions?.find((td: TicketDefinition) => td.id === athlete.ticketId);
  }, [ticketDefinitions]);

  const resolveAthleteSubCategoryId = useCallback((athlete?: LiveAthlete | null) => {
    if (!athlete?.ticketId) return null;
    const ticketDef = getTicketDefinitionForAthlete(athlete);
    const subCategories = Array.isArray((ticketDef as any)?.subCategories) ? (ticketDef as any).subCategories : [];
    if (subCategories.length === 0) return null;

    const directId = String(
      (athlete as any)?.subCategoryId
      || (athlete as any)?.registration?.subCategoryId
      || (athlete as any)?.provider?.subCategoryId
      || '',
    ).trim();
    if (directId && subCategories.some((sub: any) => String(sub?.id || '').trim() === directId)) {
      return directId;
    }

    const candidateName = String(
      (athlete as any)?.selectedSubCategory
      || (athlete as any)?.subCategoryName
      || (athlete as any)?.registration?.selectedSubCategory
      || (athlete as any)?.provider?.subCategoryName
      || '',
    ).trim().toLowerCase();
    if (!candidateName) return directId || null;

    const matched = subCategories.find((sub: any) => {
      const labels = [sub?.id, sub?.name, sub?.title, sub?.label]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
      if (labels.includes(candidateName)) return true;

      const athleteAge = normalizeContestText(
        (athlete as any)?.ageGroupName
        || (athlete as any)?.age_group_name
        || (athlete as any)?.ageGroup
        || (athlete as any)?.registration?.ageGroup
        || (athlete as any)?.provider?.ageGroupName
        || (athlete as any)?.provider?.age_group_name
        || '',
      );
      if (!athleteAge) return false;
      const ageGroups = Array.isArray(sub?.applicableAgeGroups)
        ? sub.applicableAgeGroups
        : typeof sub?.applicableAgeGroups === 'string'
          ? String(sub.applicableAgeGroups).split(',').map((s: string) => s.trim()).filter(Boolean)
          : [];
      return ageGroups.some((group: any) => normalizeContestText(group) === athleteAge);
    });
    return String(matched?.id || directId || '').trim() || null;
  }, [getTicketDefinitionForAthlete, normalizeContestText]);

  const isSwimOnlyContestForAthlete = useCallback((athlete?: LiveAthlete | null) => {
    if (!athlete) return false;
    const ticketDef = getTicketDefinitionForAthlete(athlete);
    const text = String(
      ticketDef?.ticketCategory
      || ticketDef?.name
      || ticketDef?.ticketName
      || athlete.category
      || athlete.contestName
      || athlete.ticketName
      || '',
    ).toLowerCase();
    return text.includes('swim') && !text.includes('triathlon') && !text.includes('duathlon') && !text.includes('aquathlon');
  }, [getTicketDefinitionForAthlete]);
  
  const mapRoutes = useMemo(() => {
      if (focusedAthlete && focusedAthlete.ticketId) {
          const athleteSubCategory = String(resolveAthleteSubCategoryId(focusedAthlete) || '').trim();
          const swimOnly = isSwimOnlyContestForAthlete(focusedAthlete);
          if (athleteSubCategory) {
            const subCategoryRoutes = ticketToCourseMap.get(`${focusedAthlete.ticketId}:${athleteSubCategory}`);
            if (subCategoryRoutes && subCategoryRoutes.length > 0) {
              return swimOnly ? subCategoryRoutes.filter((route) => route.type === 'swim' || route.assetKey === 'swimGpxUrl') : subCategoryRoutes;
            }
          }
          const fallbackRoutes = ticketToCourseMap.get(focusedAthlete.ticketId) || [];
          return swimOnly ? fallbackRoutes.filter((route) => route.type === 'swim' || route.assetKey === 'swimGpxUrl') : fallbackRoutes;
      }
      if (!selectedTicketId) return [];
      const routes = ticketToCourseMap.get(selectedTicketId);
      if (!routes) return [];
      // De-duplicate routes
      return Array.from(new Set(routes.map(r => JSON.stringify(r)))).map(s => JSON.parse(s));
  }, [selectedTicketId, focusedAthlete, ticketToCourseMap, resolveAthleteSubCategoryId, isSwimOnlyContestForAthlete]);

  const selectedRouteSplitGroups = useMemo(() => {
    const baseGroups = mapRoutes.length ? mapRoutes
      .map((route, routeIndex) => ({
        key: `${route.ticketId}:${route.subCategoryId || 'base'}:${route.assetKey}:${routeIndex}`,
        label: String(
          route.assetKey === 'swimGpxUrl' ? 'SWIM'
          : route.assetKey === 'bikeGpxUrl' ? 'BIKE'
          : route.assetKey === 'run1GpxUrl' ? 'RUN 1'
          : route.assetKey === 'run2GpxUrl' ? 'RUN 2'
          : route.type || route.assetKey || `Route ${routeIndex + 1}`,
        ).toUpperCase(),
        type: route.type,
        color: route.color,
        splitPoints: Array.isArray(route.splitPoints)
          ? [...route.splitPoints]
              .filter((split) => split && Number.isFinite(Number(split.distance)))
              .sort((a, b) => Number(a.distance || 0) - Number(b.distance || 0))
          : [],
      }))
      .filter((group) => group.splitPoints.length > 0)
      : [];

    const groupsByLabel = new Set(baseGroups.map((group) => group.label.replace(/\s+/g, '').toLowerCase()));

    const contestKeyCandidates = [
      focusedAthlete ? getAthleteContestFilterKey(focusedAthlete) : '',
      ...mapRoutes.map((route) => String(route.contestKey || '').trim()),
      selectedTicketId,
      String(selectedTicketId || '').toLowerCase(),
    ].map((value) => String(value || '').trim()).filter(Boolean);

    const splitMappingForContest = contestKeyCandidates
      .map((key) => (timingConfiguration as any)?.raceFlowByContest?.[key]
        || (timingConfiguration as any)?.raceFlowByContest?.[key.toLowerCase?.() ?? key]
        || (timingConfiguration as any)?.raceFlowTimelineByContest?.[key]
        || (timingConfiguration as any)?.raceFlowTimelineByContest?.[key.toLowerCase?.() ?? key]
        || (timingConfiguration as any)?.legSplitMappingsByContest?.[key]
        || (timingConfiguration as any)?.legSplitMappingsByContest?.[key.toLowerCase?.() ?? key]
        || null)
      .find(Boolean) || null;

    if (!splitMappingForContest) {
      if (!baseGroups.length) return [] as Array<{
        key: string;
        label: string;
        type: string;
        color: string;
        splitPoints: CustomSplitPoint[];
      }>;
      return baseGroups;
    }

    const mappingLegLabels = new Map<number, string>();
    const mappingLegs = Array.isArray(splitMappingForContest?.legs) ? splitMappingForContest.legs : [];
    mappingLegs.forEach((leg: any, index: number) => {
      const label = String(leg?.leg_name || leg?.legName || leg?.name || leg?.label || '').trim();
      if (label) mappingLegLabels.set(index + 1, label);
    });

    const splitRows = Array.isArray(splitMappingForContest?.splits) ? splitMappingForContest.splits : [];
    const grouped = new Map<string, { label: string; splitPoints: CustomSplitPoint[] }>();
    splitRows
      .filter((split: any) => String(split?.visibility || 'visible').toLowerCase() !== 'hidden')
      .forEach((split: any, index: number) => {
        const legIndex = Number(split?.leg_index || split?.legIndex || 0);
        const legLabel = String(mappingLegLabels.get(legIndex) || split?.leg || split?.leg_name || split?.legName || split?.split_type || 'LEG').trim().toUpperCase();
        if (!legLabel) return;
        const normalizedLegKey = legLabel.replace(/\s+/g, '').toLowerCase();
        const existing = grouped.get(normalizedLegKey) || { label: legLabel, splitPoints: [] as CustomSplitPoint[] };
        existing.splitPoints.push(normalizeRouteSplitPoint(split, index));
        grouped.set(normalizedLegKey, existing);
      });

    const timingOnlyGroups = Array.from(grouped.entries())
      .filter(([normalizedLegKey]) => !groupsByLabel.has(normalizedLegKey))
      .map(([normalizedLegKey, group], index) => ({
        key: `timing:${normalizedLegKey}:${index}`,
        label: group.label,
        type: normalizedLegKey,
        color: '#64748b',
        splitPoints: group.splitPoints.sort((a, b) => Number(a.distance || 0) - Number(b.distance || 0)),
      }))
      .filter((group) => group.splitPoints.length > 0);

    return [...baseGroups, ...timingOnlyGroups] as Array<{
      key: string;
      label: string;
      type: string;
      color: string;
      splitPoints: CustomSplitPoint[];
    }>;
  }, [focusedAthlete, getAthleteContestFilterKey, mapRoutes, normalizeRouteSplitPoint, selectedTicketId, timingConfiguration]);

  useEffect(() => {
    if (!selectedRouteSplitGroups.length) {
      setExpandedRouteKey(null);
      return;
    }
    if (!expandedRouteKey || !selectedRouteSplitGroups.some((group) => group.key === expandedRouteKey)) {
      setExpandedRouteKey(selectedRouteSplitGroups[0].key);
    }
  }, [expandedRouteKey, selectedRouteSplitGroups]);

  const isSwimOnlyFocused = useMemo(() => isSwimOnlyContestForAthlete(focusedAthlete), [focusedAthlete, isSwimOnlyContestForAthlete]);
  const shouldShowElevation = useMemo(() => !isSwimOnlyFocused && mapRoutes.some((route) => route.type !== 'swim'), [isSwimOnlyFocused, mapRoutes]);

  const elevationAthleteMarkersByRoute = useMemo(() => {
    type ElevationAthleteMarker = {
      progress: number;
      label: string;
      color?: string;
      athleteName?: string;
    };

    const athletes = athletesToDisplayOnMap;
    if (mapRoutes.length === 0 || athletes.length === 0) return [] as ElevationAthleteMarker[][];

    const getTicketDef = (ticketId?: string | null) => ticketDefinitions?.find((td: TicketDefinition) => td.id === ticketId);
    const getLegKey = (routeType: string, athlete: LiveAthlete): Leg | 'NOT_STARTED' | 'FINISHED' => {
      const isDua = isDuathlonEvent(athlete.ticketName || athlete.category);
      if (routeType === 'swim') return 'SWIM';
      if (routeType === 'bike') return 'BIKE';
      if (routeType === 'run') {
        if (isDua) {
          return athlete.leg === 'RUN1' ? 'RUN1' : athlete.leg === 'RUN2' ? 'RUN2' : 'RUN2';
        }
        return 'RUN';
      }
      return athlete.leg as Leg;
    };

    const getRouteProgressKm = (athlete: LiveAthlete, routeType: string, routeIndex: number) => {
      const ticketDef = getTicketDef(athlete.ticketId);
      const cm: any = ticketDef?.courseMaps || {};
      const isDua = isDuathlonEvent(athlete.ticketName || athlete.category);
      const swimDistance = Number(cm.swimDistance || 0);
      const bikeDistance = Number(cm.bikeDistance || 0);
      const runDistance = Number(cm.runDistance || 0);
      const run1Distance = Number(cm.run1Distance || 0);
      const run2Distance = Number(cm.run2Distance || runDistance || 0);
      const totalProgress = Math.max(0, Number(athlete.courseProgress || 0));
      const leg = athlete.status === 'Finished' ? 'FINISHED' : (athlete.leg || 'NOT_STARTED');

      if (athlete.status === 'Not Started') return 0;

      if (!isDua) {
        if (routeType === 'swim') return Math.min(swimDistance, totalProgress);
        if (routeType === 'bike') return leg === 'SWIM' || leg === 'T1' || leg === 'NOT_STARTED' ? null : Math.max(0, Math.min(bikeDistance, totalProgress - swimDistance));
        if (routeType === 'run') return (leg === 'RUN' || leg === 'T2' || leg === 'FINISHED' || athlete.status === 'Finished') ? Math.max(0, Math.min(runDistance, totalProgress - swimDistance - bikeDistance)) : null;
        return null;
      }

      if (routeType === 'bike') {
        if (leg === 'RUN1' || leg === 'T1' || leg === 'NOT_STARTED') return null;
        return Math.max(0, Math.min(bikeDistance, totalProgress - run1Distance));
      }

      if (routeType === 'run') {
        if (routeIndex === 0 && mapRoutes.filter(r => r.type === 'run').length > 1) {
          if (leg === 'RUN1' || leg === 'T1') return Math.min(run1Distance, totalProgress);
          if (athlete.status === 'Finished' || leg === 'BIKE' || leg === 'T2' || leg === 'RUN2' || leg === 'FINISHED') return run1Distance;
          return null;
        }
        if (leg === 'RUN2' || leg === 'FINISHED' || athlete.status === 'Finished' || leg === 'T2') {
          return Math.max(0, Math.min(run2Distance, totalProgress - run1Distance - bikeDistance));
        }
        return null;
      }

      return null;
    };

    const runRouteSeen = { count: 0 };

    return mapRoutes.map((route) => {
      const routeIdxForType = route.type === 'run' ? runRouteSeen.count++ : 0;
      return athletes
        .map((athlete): ElevationAthleteMarker | null => {
          const progress = getRouteProgressKm(athlete, route.type, routeIdxForType);
          if (progress === null || progress === undefined) return null;
          const athleteName = String(athlete?.name || (athlete as any)?.fullName || athlete?.bib || '').trim();
          const initials = athleteName
            ? athleteName.split(/\s+/).filter(Boolean).map((n) => n[0]).slice(0, 2).join('').toUpperCase()
            : 'AT';
          return {
            progress,
            label: focusedAthlete ? String(athlete?.bib || athleteName || '—') : initials,
            color: route.color,
            athleteName,
          };
        })
        .filter((m): m is ElevationAthleteMarker => m !== null);
    });
  }, [athletesToDisplayOnMap, mapRoutes, ticketDefinitions, focusedAthlete]);

  const handleToggleTrackAthlete = (athlete: LiveAthlete) => {
    if (typeof window !== 'undefined' && 'Notification' in window && notificationPermission === 'default') {
        Notification.requestPermission().then(setNotificationPermission);
    }
    
    const athleteId = getAthleteStableId(athlete);
    const athleteWatchKey = getAthleteWatchlistKey(athlete);
    // Precompute athlete fields for fallback matching
    const aBib = String(athlete.bib || '').trim().toLowerCase();
    const aUid = String((athlete as any).athleteUid || (athlete as any).bergmanAthleteId || '').trim().toLowerCase();
    const aPuid = String((athlete as any).participantUuid || (athlete as any).participant_uuid || (athlete as any).liveTracking?.participantUuid || '').trim().toLowerCase();
    setTrackedAthleteIds(prev => {
      const newSet = new Set(prev);
      const matchingIds = Array.from(newSet).filter((trackedId) => {
        if (trackedId === athleteId) return true;
        const tracked = trackedAthleteStore.get(trackedId);
        if (!tracked) return false;
        if (getAthleteWatchlistKey(tracked) === athleteWatchKey) return true;
        // Fallback: same real bib number (not N/A placeholder)
        const tBib = String(tracked.bib || '').trim().toLowerCase();
        if (aBib && aBib !== 'n/a' && tBib && tBib !== 'n/a' && aBib === tBib) return true;
        // Fallback: same athleteUid / bergmanAthleteId
        const tUid = String((tracked as any).athleteUid || (tracked as any).bergmanAthleteId || '').trim().toLowerCase();
        if (aUid && tUid && aUid === tUid) return true;
        // Fallback: same participantUuid
        const tPuid = String((tracked as any).participantUuid || (tracked as any).participant_uuid || (tracked as any).liveTracking?.participantUuid || '').trim().toLowerCase();
        if (aPuid && tPuid && aPuid === tPuid) return true;
        return false;
      });

      if (matchingIds.length > 0) {
        matchingIds.forEach((trackedId) => newSet.delete(trackedId));
        setFocusedAthlete((prevFocused) => {
          if (!prevFocused) return prevFocused;
          const focusedId = getAthleteStableId(prevFocused);
          return focusedId === athleteId || getAthleteWatchlistKey(prevFocused) === athleteWatchKey ? null : prevFocused;
        });
        setTrackedAthleteStore((prevStore) => {
          const next = new Map(prevStore);
          matchingIds.forEach((trackedId) => next.delete(trackedId));
          return next;
        });
        toast({ title: 'Athlete Untracked', description: `${athlete.name} removed from your tracking list.` });
      } else {
        newSet.add(athleteId);
        setTrackedAthleteStore((prevStore) => {
          const next = new Map(prevStore);
          next.set(athleteId, { ...athlete, id: athleteId });
          return next;
        });
        toast({ title: 'Athlete Tracked!', description: `${athlete.name} added to your personal tracking list.` });
      }
      return newSet;
    });
  };

  const handleViewOnMap = (athleteId: string) => {
    const dataToSearch = visibleAthletes;
    const athlete = dataToSearch.find(a => getAthleteStableId(a) === athleteId) || trackedAthletes.find(a => getAthleteStableId(a) === athleteId);
    if (athlete && (athlete as any)?.mapVisible !== false) {
      setFocusedAthlete(athlete);
      setActiveTab('map');
    }
  };

  const selectedAthleteTicketDef = useMemo(() => {
    return getTicketDefinitionForAthlete(selectedAthleteForModal);
  }, [selectedAthleteForModal, getTicketDefinitionForAthlete]);

  // Keep modal data fresh as live polling updates athlete rows
  useEffect(() => {
    if (!selectedAthleteForModal) return;
    const source = visibleAthletes;
    const latest = source.find(a => a.id === selectedAthleteForModal.id)
      || source.find(a => a.bib === selectedAthleteForModal.bib);
    if (!latest) return;

    const changed = JSON.stringify(latest.splits || []) !== JSON.stringify(selectedAthleteForModal.splits || [])
      || latest.status !== selectedAthleteForModal.status
      || latest.lastUpdateTime !== selectedAthleteForModal.lastUpdateTime;

    if (changed) {
      setSelectedAthleteForModal(latest);
    }
  }, [selectedAthleteForModal, visibleAthletes]);

  if (!isLiveTrackingPublic) {
    return (
      <TimingConfigurationProvider
        value={{
          eventId: eventDetails.id,
          timingConfiguration,
          loading: isFetching && !timingConfiguration,
          refresh: async () => Promise.resolve(),
        }}
      >
      <>
        <div className="container mx-auto py-8 px-4 text-left">
          <Card className="mb-4 border-none shadow-xl text-left">
            <CardHeader className="text-left">
              <Button variant="outline" size="sm" onClick={() => router.push('/tracking')} className="absolute top-4 left-4 text-xs h-8 rounded-lg"><ArrowLeft className="h-4 w-4 mr-1.5"/>Back to Events</Button>
              <div className="mx-auto mt-2 flex items-center justify-center">
                <Image src="/bwshop.png" alt="Bergman logo" width={780} height={780} className="h-[180px] w-[180px] object-contain" priority />
              </div>
              <CardTitle className="text-center pt-8 text-2xl font-black uppercase italic tracking-tighter text-primary">
                {eventDetails?.eventName || 'Live Tracking'}
              </CardTitle>
              <div className="mx-auto mt-4 flex w-full max-w-2xl flex-col items-center gap-1 text-center">
                <p className="text-sm font-black uppercase tracking-[0.28em] text-muted-foreground">
                  Dates
                </p>
                {eventCategoryDateSummary ? (
                  <CardDescription className="text-center font-bold text-[11px] text-muted-foreground">
                    {eventCategoryDateSummary}
                  </CardDescription>
                ) : null}
              </div>
            </CardHeader>
          </Card>

          <Card className="border-none bg-slate-950 shadow-xl text-left text-white">
            <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.28em] text-slate-400">Live Tracking Status</div>
                <div className="mt-1 text-lg font-bold text-white">Tracking is closed</div>
                <p className="mt-1 text-sm text-slate-300">
                  This event is not open for public live tracking yet. The page will switch to spectator and athlete entry once it becomes public.
                </p>
              </div>
              <Badge className="w-fit bg-slate-700 text-slate-100">Closed</Badge>
            </CardContent>
          </Card>
        </div>
      </>
      </TimingConfigurationProvider>
    );
  }

  return (
    <TimingConfigurationProvider
      value={{
        eventId: eventDetails.id,
        timingConfiguration,
        loading: isFetching && !timingConfiguration,
        refresh: async () => Promise.resolve(),
      }}
    >
    <>
      <div className="container mx-auto py-8 px-4 text-left">
        <Card className="mb-4 border-none shadow-xl text-left">
          <CardHeader className="text-left">
            <Button variant="outline" size="sm" onClick={() => router.push('/tracking')} className="absolute top-4 left-4 text-xs h-8 rounded-lg"><ArrowLeft className="h-4 w-4 mr-1.5"/>Back to Events</Button>
            <div className="mx-auto mt-2 flex items-center justify-center">
              <Image src="/bwshop.png" alt="Bergman logo" width={780} height={780} className="h-[180px] w-[180px] object-contain" priority />
            </div>
            <CardTitle className="text-center pt-8 text-2xl font-black uppercase italic tracking-tighter text-primary">
              {eventDetails?.eventName || 'Live Tracking'}
            </CardTitle>
            <div className="mx-auto mt-4 flex w-full max-w-2xl flex-col items-center gap-1 text-center">
              <p className="text-sm font-black uppercase tracking-[0.28em] text-muted-foreground">
                Dates
              </p>
              {eventCategoryDateSummary ? (
                <CardDescription className="text-center font-bold text-[11px] text-muted-foreground">
                  {eventCategoryDateSummary}
                </CardDescription>
              ) : null}
            </div>
          </CardHeader>
        </Card>

        {!isLiveTrackingPublic ? (
          <Card className="mb-4 border-none bg-slate-950 shadow-xl text-left text-white">
            <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.28em] text-slate-400">Live Tracking Status</div>
                <div className="mt-1 text-lg font-bold text-white">Yet to open</div>
                <p className="mt-1 text-sm text-slate-300">This event is closed for public viewing right now. Live tracking will appear here once it is opened.</p>
              </div>
              <Badge className="w-fit bg-slate-700 text-slate-100">Closed</Badge>
            </CardContent>
          </Card>
        ) : null}

        {viewerRole === 'ATHLETE' && currentUser && athleteRegistrationState === 'registered' && (
          <div className="mb-4 space-y-4">
            <LiveTrackingPrivacyCard athlete={currentAthleteRecord} onPrivacyChange={handlePrivacyChange} />
            {!hasEnteredTracking && (
              <Card className="border-none shadow-xl text-left">
                <CardContent className="flex flex-wrap items-center gap-3 p-6">
                  <Button onClick={() => setHasEnteredTracking(true)}>Enter Live Tracking</Button>
                  <Button variant="outline" onClick={handleChangeRole}>Change Role</Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {!viewerRoleReady ? (
          <Card className="mb-4 border-none shadow-xl text-left">
            <CardContent className="flex items-center justify-center py-14">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm font-semibold uppercase tracking-widest">Preparing live tracking…</span>
              </div>
            </CardContent>
          </Card>
        ) : showRoleChooser ? (
          <Card className="mb-4 border-none shadow-xl overflow-hidden text-left">
            <CardContent className="grid gap-6 p-0 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="relative flex min-h-[420px] flex-col justify-between bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-8 text-white">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(34,197,94,0.10),transparent_30%)]" />
                <div className="relative z-10 space-y-6">
                  <div className="inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-[0.3em] text-slate-200">
                    Public live tracking
                  </div>
                  <div>
                    <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Welcome to Bergman Live Tracking</h1>
                    <p className="mt-4 max-w-2xl text-sm text-slate-300 sm:text-base">
                      Follow every athlete live with official timing updates, live maps, leaderboards, race progress, and predictions.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-300">Who are you today?</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => handleViewerRoleSelect('SPECTATOR')}
                        className="group flex min-h-[190px] flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white/10"
                      >
                        <div>
                          <div className="mb-3 inline-flex rounded-full bg-primary/10 p-3 text-primary ring-1 ring-primary/15">
                            <Eye className="h-6 w-6" />
                          </div>
                          <div className="text-sm font-black uppercase tracking-widest text-white">I’m a Spectator</div>
                          <p className="mt-2 text-sm text-slate-300">
                            I want to follow the race, search athletes, view live leaderboards and maps.
                          </p>
                        </div>
                        <div className="mt-4 flex items-center justify-between text-xs font-black uppercase tracking-widest text-primary">
                          <span>Continue as Spectator</span>
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={handleAthleteStart}
                        className="group flex min-h-[190px] flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white/10"
                      >
                        <div>
                          <div className="mb-3 inline-flex rounded-full bg-primary/10 p-3 text-primary ring-1 ring-primary/15">
                            <UserRound className="h-6 w-6" />
                          </div>
                          <div className="text-sm font-black uppercase tracking-widest text-white">I’m Racing Today</div>
                          <p className="mt-2 text-sm text-slate-300">
                            I’m participating in this event and want to manage my live tracking privacy.
                          </p>
                        </div>
                        <div className="mt-4 flex items-center justify-between text-xs font-black uppercase tracking-widest text-primary">
                          <span>Continue as Athlete</span>
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="relative z-10 text-xs font-medium text-slate-400">You can change this later.</div>
              </div>

              <div className="flex flex-col justify-between gap-6 border-t border-border bg-card p-8 text-foreground lg:border-l lg:border-t-0">
                <div className="space-y-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground">What you can do here</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {['Leaderboard', 'Search', 'Live Map', 'Athlete Tracking', 'Live Cameras', 'Results', 'Race Progress', 'Predictions'].map((feature) => (
                      <div key={feature} className="rounded-2xl border border-border bg-muted/20 px-4 py-3 text-sm font-semibold">
                        {feature}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                  Spectator mode opens instantly. Athlete mode will ask you to sign in, then confirm registration and privacy.
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="space-y-4">

        {viewerRole === 'ATHLETE' && !currentUser && (
          <Card className="mb-4 border-none shadow-xl text-left">
            <CardHeader className="border-b bg-primary/5 text-left">
              <CardTitle className="text-lg font-black uppercase tracking-tight text-left">Are you racing today?</CardTitle>
              <CardDescription className="text-left">Sign in to manage your Live Tracking Privacy.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <p className="text-sm text-muted-foreground">
                After login, Bergman will check whether you are registered for this event before showing live tracking controls.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <a href={`/login?redirect=${encodeURIComponent(`/live-tracking/${eventDetails.customSlug || eventDetails.id}`)}`}>Open Login</a>
                </Button>
                <Button variant="outline" onClick={() => handleViewerRoleSelect('SPECTATOR')}>
                  Continue as Spectator
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {viewerRole === 'ATHLETE' && currentUser && athleteRegistrationState === 'checking' && (
          <Card className="mb-4 border-none shadow-xl text-left">
            <CardContent className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm font-semibold uppercase tracking-widest">Checking your registration…</span>
              </div>
            </CardContent>
          </Card>
        )}

        {viewerRole === 'ATHLETE' && currentUser && athleteRegistrationState === 'not_registered' && (
          <Card className="mb-4 border-none shadow-xl text-left">
            <CardHeader className="border-b bg-amber-500/10 text-left">
              <CardTitle className="text-lg font-black uppercase tracking-tight text-left">You are not registered for this event.</CardTitle>
              <CardDescription className="text-left">You can continue as a spectator or switch role.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => handleViewerRoleSelect('SPECTATOR')}>Continue as Spectator</Button>
                <Button variant="outline" onClick={handleChangeRole}>Change Role</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {showAthleteGate && currentUser && athleteRegistrationState === 'not_registered' && (
          <div className="mb-4 space-y-4">
            <Card className="border-none shadow-xl text-left">
              <CardHeader className="border-b bg-primary/5 text-left">
                <CardTitle className="text-lg font-black uppercase tracking-tight text-left">You are not registered for this event.</CardTitle>
                <CardDescription className="text-left">You can continue as a spectator or switch role.</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => handleViewerRoleSelect('SPECTATOR')}>Continue as Spectator</Button>
                  <Button variant="outline" onClick={handleChangeRole}>Change Role</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className={cn('space-y-4', !canShowMainTracking ? 'hidden' : '')}>

        {replayVideos.length > 0 ? (
          <Card className="mb-4 border-emerald-500/20 bg-emerald-500/5 shadow-sm">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-700 dark:text-emerald-300">Race Replay Available</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{replayVideos.length} video{replayVideos.length === 1 ? '' : 's'} ready for replay — independent of Live Sync.</div>
              </div>
              <Badge className="bg-emerald-600 text-white">Replay Ready</Badge>
            </CardContent>
          </Card>
        ) : null}
        
        {isReplayMode && (
            <Card className="mb-4 border border-border bg-card p-4 text-card-foreground shadow-lg text-left">
                <div className="flex flex-col sm:flex-row items-center gap-4 text-left">
                    <div className="flex items-center gap-2 text-left">
                  <Button size="icon" onClick={toggleReplay} className="bg-background text-foreground hover:bg-muted">
                            {isReplaying ? <Pause className="h-5 w-5"/> : <Play className="h-5 w-5"/>}
                        </Button>
                  <Button size="icon" variant="outline" onClick={handleSpeedChange} className="border-border hover:bg-muted">
                           <span className="text-xs font-semibold">{replaySpeed}x</span>
                        </Button>
                    </div>
                    <div className="w-full flex-grow flex items-center gap-3 text-left">
                   <span className="text-xs font-mono text-muted-foreground">{formatSecondsToHMS(replayTime)}</span>
                        <Slider
                            value={[replayTime]}
                            onValueChange={handleSliderChange}
                            max={maxReplayTime}
                            step={1}
                            className="w-full"
                        />
                   <span className="text-xs font-mono text-muted-foreground">{formatSecondsToHMS(maxReplayTime)}</span>
                    </div>
                </div>
            </Card>
        )}

        {availableRaceDays.length > 1 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-left">
            <span className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground">Race Day</span>
            {availableRaceDays.map((dayKey) => {
              const isActive = selectedRaceDayKey === dayKey;
              const day = new Date(`${dayKey}T00:00:00Z`);
              const label = Number.isNaN(day.getTime())
                ? dayKey
                : day.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
              return (
                <Button
                  key={dayKey}
                  type="button"
                  size="sm"
                  variant={isActive ? 'default' : 'outline'}
                  onClick={() => {
                    setSelectedRaceDayKey(dayKey);
                    setCategoryFilter('all');
                    const firstOption = contestFilterOptions.find((option) => option.dateKey === dayKey);
                    if (firstOption) setTicketFilter(firstOption.key);
                  }}
                  className={cn(
                    'h-8 rounded-full px-3 text-[10px] font-black uppercase tracking-widest',
                    isActive ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-muted',
                  )}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full text-left">
          <TabsList className="mb-4 grid h-auto w-full grid-cols-1 gap-2 overflow-visible rounded-xl border border-border/50 bg-muted/50 p-2 sm:grid-cols-4 sm:gap-1 sm:p-1">
            <TabsTrigger value="leaderboard" className="w-full justify-center rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest leading-tight py-2 px-3 sm:py-0"><ListIcon className="h-4 w-4"/>Leaderboard</TabsTrigger>
            <TabsTrigger value="search" className="w-full justify-center rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest leading-tight py-2 px-3 sm:py-0"><Users className="h-4 w-4"/>Search & Track</TabsTrigger>
            <TabsTrigger value="map" className="w-full justify-center rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest leading-tight py-2 px-3 sm:py-0"><MapIcon className="h-4 w-4"/>Live Map</TabsTrigger>
            <TabsTrigger value="replay" className="w-full justify-center rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest leading-tight py-2 px-3 sm:py-0"><Play className="h-4 w-4"/>Replay</TabsTrigger>
            </TabsList>
            <TabsContent value="replay" className="mt-6 pb-6 animate-in fade-in duration-500 text-left space-y-4">
              {replayVideos.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-6 text-sm text-muted-foreground">No replay videos are attached to this event yet.</CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
                  <Card className="overflow-hidden border-border/60 shadow-sm">
                    <CardContent className="p-0">
                      <div className="relative aspect-video bg-black">
                        {selectedReplayStreamUrl ? (
                          <CloudflareHlsPlayer
                            src={selectedReplayStreamUrl}
                            title={selectedReplayVideo?.title || 'Replay'}
                            className="h-full w-full object-contain bg-black"
                            showControls
                            dvrWindowHours={12}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-slate-300">Select a replay to watch.</div>
                        )}
                      </div>
                      <div className="space-y-2 p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">Selected Replay</div>
                        <div className="text-lg font-black">{selectedReplayVideo?.title || 'Replay'}</div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full border border-border px-2 py-1">{selectedReplayVideo?.status || 'unknown'}</span>
                          <span className="rounded-full border border-border px-2 py-1">Duration {selectedReplayVideo?.duration ? formatSecondsToHMS(Math.round(selectedReplayVideo.duration)) : '—'}</span>
                          <span className="rounded-full border border-border px-2 py-1">Created {selectedReplayVideo?.createdAt ? new Date(selectedReplayVideo.createdAt).toLocaleString() : '—'}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="overflow-hidden border-border/60 shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2"><HistoryIcon className="h-5 w-5 text-primary" />Recent Videos</CardTitle>
                      <CardDescription>Newest first.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 max-h-[42rem] overflow-auto">
                      {replayVideos.map((video) => {
                        const isActive = video.uid === selectedReplayVideo?.uid;
                        const playbackUrl = video.uid ? getPlaybackUrl(video.uid) : '';
                        return (
                          <button
                            key={video.uid}
                            type="button"
                            onClick={() => setSelectedReplayUid(video.uid)}
                            className={cn('w-full rounded-2xl border p-3 text-left transition', isActive ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-muted/30')}
                          >
                            <div className="flex gap-3">
                              <div className="relative h-20 w-32 overflow-hidden rounded-xl border bg-black shrink-0">
                                {video.thumbnail ? <Image src={video.thumbnail} alt={video.title} fill className="object-cover" unoptimized /> : null}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge className={String(video.status).toLowerCase().includes('live') ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}>{String(video.status).toLowerCase().includes('live') ? 'LIVE' : 'Replay'}</Badge>
                                  <span className="text-xs text-muted-foreground">{video.duration ? formatSecondsToHMS(Math.round(video.duration)) : '—'}</span>
                                </div>
                                <div className="mt-1 truncate font-semibold">{video.title}</div>
                                <div className="mt-1 text-[11px] text-muted-foreground">{video.createdAt ? new Date(video.createdAt).toLocaleString() : '—'}</div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelectedReplayUid(video.uid); }}>
                                    Play
                                  </Button>
                                  {playbackUrl ? <Button size="sm" variant="ghost" asChild><a href={playbackUrl} target="_blank" rel="noreferrer">Open</a></Button> : null}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>
            <TabsContent value="map" className="mt-10 pb-6 animate-in fade-in duration-500 text-left">
                <div className="mb-4 space-y-2 text-left">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Displaying Route Path:</p>
                    <div className="flex flex-wrap gap-2 text-left">
                        {selectedRaceContestOptions.filter((option) => !option.ticket?.isHidden).map((option) => {
                          const isActive = selectedTicketId === option.key && !focusedAthlete;
                          return (
                            <Button
                              key={option.key}
                              variant={isActive ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => { setSelectedTicketId(option.key); setTicketFilter(option.key); setFocusedAthlete(null); }}
                              className={cn(
                                'h-8 rounded-lg font-bold text-[10px] uppercase tracking-widest',
                                isActive ? 'bg-primary hover:bg-primary/90 text-white border-none' : 'bg-background text-foreground hover:bg-muted',
                              )}
                            >
                              {option.label}
                            </Button>
                          );
                        })}
                    </div>
                    {selectedRouteSplitGroups.length > 0 && (
                      <div className="mt-4 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground">Race Flow Timeline Preview</div>
                            <div className="text-sm font-semibold text-foreground">Tap a leg to see which kilometres are included in each split.</div>
                          </div>
                          <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest">
                            {selectedRouteSplitGroups.length} legs
                          </Badge>
                        </div>

                        <div className="space-y-3">
                          {selectedRouteSplitGroups.map((group) => {
                            const isOpen = expandedRouteKey === group.key;
                            return (
                              <div key={group.key} className="rounded-2xl border border-border bg-background">
                                <button
                                  type="button"
                                  onClick={() => setExpandedRouteKey(isOpen ? null : group.key)}
                                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[10px] font-black text-white" style={{ backgroundColor: group.color }}>
                                      {group.label.slice(0, 2)}
                                    </span>
                                    <div>
                                      <div className="text-sm font-black uppercase tracking-widest">{group.label}</div>
                                      <div className="text-xs text-muted-foreground">{group.splitPoints.length} splits</div>
                                    </div>
                                  </div>
                                  <Badge variant="secondary" className="rounded-full">{isOpen ? 'Collapse' : 'Expand'}</Badge>
                                </button>

                                {isOpen && (
                                  <div className="border-t border-border px-4 py-4">
                                    <div className="flex flex-wrap gap-2">
                                      {group.splitPoints.map((split, index) => {
                                        const currentKm = Number(split.distance || 0);
                                        const previousKm = index > 0 ? Number(group.splitPoints[index - 1]?.distance || 0) : 0;
                                        const splitLabel = String(split.name || split.id || `Split ${index + 1}`).trim();
                                        const kmRange = index === 0
                                          ? `0-${currentKm.toFixed(1)} km`
                                          : `${previousKm.toFixed(1)}-${currentKm.toFixed(1)} km`;

                                        return (
                                          <button
                                            key={`${group.key}-${split.id || index}`}
                                            type="button"
                                            onClick={() => setExpandedRouteKey(group.key)}
                                            className="group flex flex-col items-start gap-1 rounded-2xl border border-border bg-muted/20 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                                          >
                                            <div className="text-xs font-black uppercase tracking-widest text-foreground">{splitLabel}</div>
                                            <div className="text-[10px] text-muted-foreground">Imported split point</div>
                                            <div className="inline-flex rounded-full bg-background px-2 py-1 text-[10px] font-bold text-primary ring-1 ring-primary/10">
                                              {kmRange}
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                     {focusedAthlete && (
                        <div className="pt-2 text-left">
                        <Button variant="secondary" size="sm" onClick={() => setFocusedAthlete(null)} className="h-8 rounded-lg font-bold text-[10px] uppercase tracking-widest bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-200 dark:hover:bg-orange-900/50">
                                <X className="h-3 w-3 mr-2" />
                                Exit Focus Mode
                            </Button>
                        </div>
                    )}
                </div>
                <div className="rounded-2xl overflow-hidden border shadow-2xl bg-muted/20">
                    <MapViewer 
                        routes={mapRoutes}
                        trackedAthletes={athletesToDisplayOnMap}
                        focusedAthlete={focusedAthlete}
                      timingPoints={mapTimingPointMarkers}
                        onGpxDataLoaded={handleGpxDataLoaded}
                    />
                </div>
                 {shouldShowElevation && elevationData.length > 0 && (
                  <Card className="mt-6 border-none shadow-xl overflow-hidden text-left">
                    <CardHeader className="bg-muted/30 p-4 text-left border-b">
                      <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2 text-left">
                          <TrendingUp className="h-4 w-4 text-primary" /> Elevation Dynamics
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                      {elevationData.map((path, index) => {
                        const routeInfo = mapRoutes[index];
                        // ONLY SHOW ELEVATION FOR NON-SWIM LEGS
                        if (routeInfo?.type === 'swim') return null;
                        return (
                            <div key={index}>
                               <ElevationProfileChart
                                 data={path.elevationData}
                                 strokeColor={path.color}
                                 height={120}
                                 athleteProgress={focusedAthlete ? undefined : replayData[0]?.courseProgress}
                                 athleteMarkers={elevationAthleteMarkersByRoute[index] || []}
                               />
                            </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}
            </TabsContent>
            <TabsContent value="leaderboard" className="mt-6 pb-6 animate-in fade-in duration-500 text-left">
               {!leaderboardReady || isFetching ? (
                    <div className="space-y-4 py-6 text-left">
                      <div className="h-10 w-52 animate-pulse rounded-xl bg-muted/70" />
                      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <div key={index} className="grid grid-cols-[64px_minmax(0,1fr)_160px_120px_120px_120px_40px] gap-4 border-b border-border px-4 py-4 last:border-b-0">
                            <div className="h-4 rounded bg-muted/70" />
                            <div className="h-4 rounded bg-muted/70" />
                            <div className="h-4 rounded bg-muted/70" />
                            <div className="h-4 rounded bg-muted/70" />
                            <div className="h-4 rounded bg-muted/70" />
                            <div className="h-4 rounded bg-muted/70" />
                            <div className="h-4 rounded bg-muted/70" />
                          </div>
                        ))}
                      </div>
                    </div>
                ) : (
                    <LeaderboardView 
                        athletes={visibleAthletes} 
                        onAthleteSelect={setSelectedAthleteForModal} 
                        tickets={selectedRaceTicketDefinitions} 
                        contestByUuid={timingConfiguration?.contestByUuid || {}}
                        ageGroupByUuid={ageGroupByUuid}
                        categoryFilter={categoryFilter}
                        setCategoryFilter={setCategoryFilter}
                        genderFilter={genderFilter}
                        setGenderFilter={setGenderFilter}
                        ticketFilter={ticketFilter}
                        setTicketFilter={handleTicketFilterChange}
                        getAthleteContestFilterKey={getAthleteContestFilterKey}
                    />
                )}
            </TabsContent>
              <TabsContent value="search" className="mt-6 pb-6 animate-in fade-in duration-500 text-left space-y-8">
                <Card className="mb-6 border border-primary/10 shadow-xl text-left">
                    <CardHeader className="text-left border-b bg-muted/30">
                        <CardTitle className="text-lg font-black uppercase tracking-tight text-left">Athlete Finder</CardTitle>
                        <CardDescription className="text-left">Search by name, bib, email, or chip - results appear instantly.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 text-left">
                      {searchParticipants.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground flex flex-col items-center gap-3">
                          <Loader2 className="h-10 w-10 animate-spin opacity-50" />
                          <p className="font-semibold">Loading athlete index...</p>
                        </div>
                      ) : (
                        <AthleteSearchInput
                          participants={searchParticipants}
                          onAthleteSelected={(athlete) => {
                            // Convert search result to LiveAthlete format and show in modal
                            const liveAthlete = convertSearchResultToLiveAthlete(athlete);
                            setSelectedAthleteForModal(liveAthlete);
                            addAthleteToPersonalWatch(liveAthlete);
                          }}
                          maxSuggestions={15}
                          placeholder="Search by name, bib, email, or chip..."
                          includeDebugInfo={false}
                        />
                      )}
                         {hasSearched && searchResults.length === 0 && !isSearching && (
                            <div className="text-center py-12 text-muted-foreground flex flex-col items-center gap-3 text-left">
                                <FilterX className="h-10 w-10 opacity-30"/>
                                <p className="font-bold uppercase text-[10px] tracking-widest text-left">No matches found for &quot;{searchTerm}&quot;</p>
                            </div>
                         )}
                        {searchResults.length > 0 && (
                            <div className="mt-8 space-y-4 text-left">
                                <div className="flex justify-between items-center text-left">
                                  <h4 className="font-black text-[10px] uppercase tracking-widest text-primary text-left">Search Results</h4>
                                  <button onClick={clearSearch} className="text-[10px] font-black uppercase text-muted-foreground hover:text-primary transition-colors text-left underline underline-offset-4">Clear</button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-left">
                                    {searchResults.map(athlete => (
                                        <div
                                          key={`search-${athlete.id}`}
                                          role="button"
                                          tabIndex={0}
                                          onClick={() => handleToggleTrackAthlete(athlete)}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                              event.preventDefault();
                                              handleToggleTrackAthlete(athlete);
                                            }
                                          }}
                                          className="flex items-center justify-between p-4 rounded-xl border-2 border-primary/10 bg-primary/5 hover:border-primary/30 transition-all cursor-pointer text-left"
                                        >
                                            <div className="text-left">
                                                <p className="font-black uppercase text-sm leading-tight text-left">{athlete.name}</p>
                                                <div className="flex items-center gap-2 mt-1 text-left">
                                                    <Badge variant="outline" className="h-4 text-[9px] font-black font-mono border-primary/20 text-primary">BIB {athlete.bib}</Badge>
                                                    <span className="text-[9px] font-bold text-muted-foreground uppercase text-left">{athlete.category}</span>
                                                </div>
                                              <div className="mt-1 space-y-0.5">
                                                {athlete.ageGroup ? <p className="text-[10px] font-semibold text-muted-foreground">Age Group: {athlete.ageGroup}</p> : null}
                                                {athlete.clubName ? <p className="text-[10px] font-semibold text-muted-foreground">Representing Club: {athlete.clubName}</p> : null}
                                                <p className="text-[10px] font-semibold text-primary">{getDisplayStatus(athlete.status)}</p>
                                                {Array.isArray(athlete.splits) && athlete.splits.length > 0 ? (
                                                  <p className="text-[10px] font-semibold text-muted-foreground">
                                                    Latest Split: {String(athlete.splits[athlete.splits.length - 1]?.name || athlete.splits[athlete.splits.length - 1]?.rawSplitLabel || athlete.splits[athlete.splits.length - 1]?.segment || 'N/A')}
                                                  </p>
                                                ) : null}
                                              </div>
                                            </div>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                handleToggleTrackAthlete(athlete);
                                                clearSearch();
                                              }}
                                              className="h-9 w-9 rounded-full bg-background text-foreground shadow-sm border border-border p-0 hover:bg-primary hover:text-primary-foreground transition-all"
                                              aria-label={`Add ${athlete.name} to Bergman tracker`}
                                            >
                                                <PlusCircle className="h-5 w-5"/>
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </CardContent>
                    </Card>
                    <Card className="border-none shadow-xl text-left overflow-hidden">
                    <CardHeader className="text-left border-b bg-primary/5">
                        <CardTitle className="text-lg font-black uppercase tracking-tight text-left">
                          Personal Watchlist ({trackedAthletes.length})
                        </CardTitle>
                        <CardDescription className="text-left">Selected athletes for real-time map visualization and progress cards.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar text-left">
                        {hiddenWatchlistCount > 0 && activeWatchlistContestKey ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                            Your watchlist contains athletes from multiple contests. Showing {watchedAthletesOnActiveContest.length} of {trackedAthletes.length} watched athletes ({hiddenWatchlistCount} belong to other contests).
                          </div>
                        ) : null}
                        {isFetching && trackedAthletes.length === 0 && trackedAthleteIds.size > 0 ? (
                           <div className="flex flex-col justify-center items-center py-12 gap-3 text-left">
                               <Loader2 className="h-8 w-8 animate-spin text-primary" />
                               <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Synchronizing Watchlist...</p>
                           </div>
                        ) : trackedAthletes.length > 0 ? (
                           <div className="grid grid-cols-1 gap-4 text-left">
                               {trackedAthletes.map(athlete => (
                                <BergmanTrackerCard 
                                    key={athlete.id} 
                                    data={athlete}
                                  timingConfiguration={timingConfiguration}
                                  ticketDef={getTicketDefinitionForAthlete(athlete)}
                                    onViewMap={handleViewOnMap} 
                                    onRemove={() => handleToggleTrackAthlete(athlete)} 
                                    onSelect={() => setSelectedAthleteForModal(athlete)}
                                />
                                ))}
                           </div>
                        ) : (
                           <div className="text-center py-16 text-muted-foreground flex flex-col items-center gap-4 text-left">
                               <Users className="h-12 w-12 opacity-20" />
                               <p className="font-bold uppercase text-[10px] tracking-widest max-w-[200px] text-left">Your watchlist is empty. Add athletes using the finder above.</p>
                           </div>
                        )}
                    </CardContent>
                </Card>

                    <Card className="mt-6 border-none shadow-xl text-left overflow-hidden md:hidden">
                  <CardHeader className="text-left border-b bg-muted/30">
                    <CardTitle className="text-lg font-black uppercase tracking-tight text-left flex items-center gap-2">
                      <MapIcon className="h-4 w-4" /> Live Map
                    </CardTitle>
                    <CardDescription className="text-left">Map preview for the athletes you are tracking.</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="h-[420px] overflow-hidden">
                      <MapViewer
                        routes={mapRoutes}
                        trackedAthletes={athletesToDisplayOnMap}
                        focusedAthlete={focusedAthlete}
                        timingPoints={mapTimingPointMarkers}
                        onGpxDataLoaded={handleGpxDataLoaded}
                      />
                    </div>
                  </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
        </div>

        {viewerRole && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-sm">
            <div className="text-muted-foreground">
              Current view: <span className="font-semibold uppercase text-foreground">{viewerRole === 'ATHLETE' ? 'Athlete' : 'Spectator'}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleChangeRole} className="rounded-full">
              Change Role
            </Button>
          </div>
        )}
        </div>
      </div>

      <AthleteLiveModalPro
        athlete={selectedAthleteForModal}
        open={!!selectedAthleteForModal}
        onClose={() => setSelectedAthleteForModal(null)}
        ticketDef={selectedAthleteTicketDef}
        ticketDefinitions={ticketDefinitions}
        eventId={eventDetails.id}
        bookingId=""
      />
    </>
    </TimingConfigurationProvider>
  );
}
