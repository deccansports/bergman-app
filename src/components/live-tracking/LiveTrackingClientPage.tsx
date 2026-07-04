
// src/components/live-tracking/LiveTrackingClientPage.tsx
"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Search, 
  Map as MapIcon, 
  List as ListIcon, 
  Loader2, 
  ArrowLeft, 
  Users, 
  X, 
  PlusCircle, 
  FilterX, 
  Play, 
  Pause, 
  FastForward, 
  Rewind,
  TrendingUp
} from 'lucide-react';
import type { EventCalendarEntry, LiveAthlete, EventParticipant, TicketDefinition, CustomSplitPoint, RaceResult, Status, Leg, Split } from '@/lib/types';
import MapViewer, { type GpxPath } from '@/components/live-tracking/MapViewer';
import LeaderboardView from '@/components/live-tracking/LeaderboardView';
import BergmanTrackerCard from '@/components/live-tracking/BergmanTrackerCard'; 
import AthleteLiveModalPro from '@/components/live-tracking/AthleteLiveModalPro';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isDuathlonEvent, isTriathlonEvent, normalizeStatus, hmsToSeconds, formatSecondsToHMS } from '@/lib/utils';
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
};

interface LiveTrackingClientPageProps {
  initialEventDetails: EventCalendarEntry;
  isPastEvent: boolean;
  initialLiveData?: LiveAthlete[];
}

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
    const contestKey = String(row?.contestUuid || row?.contest_uuid || row?.providerContestUuid || row?.ticketId || row?.liveTracking?.contestUuid || '').trim();
    const key = String(
      row?.participantUuid
      || row?.participant_uuid
      || row?.athleteUid
      || row?.id
                                                    || [row?.bib, contestKey, (row as any)?.registration?.subCategoryId || (row as any)?.subCategoryId || (row as any)?.selectedSubCategory || '']
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join('|')
      || row?.name
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
  const contestUuid = String(anyRow?.contestUuid || anyRow?.contest_uuid || anyRow?.providerContestUuid || anyRow?.liveTracking?.contestUuid || '').trim().toLowerCase();
  const contestName = String(anyRow?.contestName || anyRow?.contest_name || anyRow?.category || anyRow?.providerContestName || '').trim().toLowerCase();
  if (bib) {
    return `bib:${bib}|contest:${contestUuid || contestName || 'na'}`;
  }

  const participantUuid = String(anyRow?.participantUuid || anyRow?.participant_uuid || anyRow?.providerParticipantUuid || anyRow?.liveTracking?.participantUuid || '').trim().toLowerCase();
  if (participantUuid) return `participant:${participantUuid}`;

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

export default function LiveTrackingClientPage({ initialEventDetails, isPastEvent, initialLiveData = [] }: LiveTrackingClientPageProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { firebaseUserFromAuth } = useAuth();
  const [eventDetails] = useState(initialEventDetails);
  const [courseConfig, setCourseConfig] = useState<any | null>(null);
  const [liveData, setLiveData] = useState<LiveAthlete[]>(initialLiveData);
  const [isFetching, setIsFetching] = useState(initialLiveData.length === 0);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [trackedAthleteIds, setTrackedAthleteIds] = useState<Set<string>>(new Set());
  const [trackedAthleteStore, setTrackedAthleteStore] = useState<Map<string, LiveAthlete>>(new Map());
  const [timingConfiguration, setTimingConfiguration] = useState<ResolvedTimingConfiguration | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchBy, setSearchBy] = useState<'bib' | 'name' | 'email'>('bib');
  const [searchResults, setSearchResults] = useState<LiveAthlete[]>([]);
  const [searchSuggestions, setSearchSuggestions] = useState<LiveAthlete[]>([]);
  const [selectedAthleteForModal, setSelectedAthleteForModal] = useState<LiveAthlete | null>(null);
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [focusedAthlete, setFocusedAthlete] = useState<LiveAthlete | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [elevationData, setElevationData] = useState<GpxPath[]>([]);
  
  // Replay Mode State
  const [isReplayMode, setIsReplayMode] = useState(isPastEvent);
  const [replayTime, setReplayTime] = useState(0); // Current replay time in seconds from race start
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [isReplaying, setIsReplaying] = useState(false);
  const replayIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

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
  }, [contestByUuid, ageGroupByUuid, resolveAgeGroupDisplay]);

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

    // For 'participants' source (From Registrations), use the pre-loaded data
    if (eventDetails.liveDataSource === 'participants') {
      setIsFetching(false);
      setLiveData(dedupeAthletes(initialLiveData.map(normalizeVisibleAthlete).filter((row) => isActiveAthlete(row))));
      return;
    }

    // For 'timing_partner', fetch live updates
    if (eventDetails.liveDataSource === 'timing_partner') {
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
            if (result.success && result.participants) {
              setLiveData(dedupeAthletes(result.participants.map((row: any) => normalizeVisibleAthlete(row)).filter((row: any) => isActiveAthlete(row))));
            }
            setIsFetching(false);
          }
        } catch (error) {
          if (isMounted) {
            console.error("Error fetching live athletes:", error);
            toast({ variant: 'destructive', title: 'Live Data Error', description: 'Could not connect to live athlete data.' });
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
    }

    // For other sources or disabled tracking
    setIsFetching(false);
    setLiveData(dedupeAthletes(initialLiveData.map(normalizeVisibleAthlete).filter((row) => isActiveAthlete(row))));
  }, [authHeaders, eventDetails.id, eventDetails.liveDataSource, isReplayMode, initialLiveData, normalizeVisibleAthlete, toast]);

  useEffect(() => {
    let isMounted = true;
    const loadTimingConfiguration = async () => {
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
            splitsEnabledForAthleteDashboard: Boolean(payload?.splitsEnabledForAthleteDashboard ?? timingPayload?.splitsEnabledForAthleteDashboard),
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
            importedAt: timingPayload.importedAt || payload.importedAt || null,
            provider: timingPayload.provider || payload.provider || null,
          } as ResolvedTimingConfiguration;
        });
        if (!isMounted) return;
        setTimingConfiguration(resolved);
      } catch {
        if (isMounted) setTimingConfiguration(null);
      }
    };

    void loadTimingConfiguration();
    return () => {
      isMounted = false;
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
    if (Array.isArray(courseConfig?.ticketDefinitions) && courseConfig.ticketDefinitions.length > 0) {
      return courseConfig.ticketDefinitions;
    }
    return Array.isArray(eventDetails.ticketDefinitions) ? eventDetails.ticketDefinitions : [];
  }, [courseConfig?.ticketDefinitions, eventDetails.ticketDefinitions]);

  const getTicketDateKey = useCallback((ticket: TicketDefinition | Record<string, any>) => normalizeDateKeyValue(String((ticket as any)?.eventDate || eventDetails?.eventDate || '')), [eventDetails?.eventDate]);

  const getContestDisplayDateKey = useCallback((ticket: TicketDefinition | Record<string, any>) => String((ticket as any)?.eventDate || eventDetails?.eventDate || '').trim(), [eventDetails?.eventDate]);

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
    if (directTicketId) {
      return { ticketId: directTicketId, subCategoryId: directSubCategoryId || null };
    }

    const contestName = String(row?.contestName || row?.contest_name || row?.category || row?.providerContestName || '').trim().toLowerCase();
    if (!contestName) return { ticketId: '', subCategoryId: null };

    for (const ticket of ticketDefinitions || []) {
      const ticketName = String(ticket?.ticketName || ticket?.name || '').trim().toLowerCase();
      const ticketId = String(ticket?.id || '').trim();
      if (!ticketId) continue;
      if (ticketName && contestName.includes(ticketName)) {
        const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
        if (subCategories.length === 0) return { ticketId, subCategoryId: null };
        const sub = subCategories.find((item: any) => {
          const subLabels = [item?.id, item?.name, item?.title, item?.label].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
          return subLabels.some((label) => contestName.includes(label));
        });
        return { ticketId, subCategoryId: String(sub?.id || '').trim() || null };
      }
    }

    return { ticketId: '', subCategoryId: null };
  }, [ticketDefinitions]);

  const buildRoutesFromCourseMaps = useCallback((params: {
    ticketId: string;
    courseMaps: any;
    routeScope: 'ticket' | 'subCategory';
    subCategoryId?: string | null;
  }) => {
    const routes: CourseRoute[] = [];
    const gpxKeys = Object.keys(gpxAssetConfig) as (keyof typeof gpxAssetConfig)[];
    gpxKeys.forEach(assetKey => {
      const url = params.courseMaps?.[assetKey];
      if (typeof url !== 'string' || !url) return;
      const splitPoints = assetKey === 'swimGpxUrl'
        ? (params.courseMaps?.swimSplits || [])
        : assetKey === 'bikeGpxUrl'
          ? (params.courseMaps?.bikeSplits || [])
          : assetKey === 'run1GpxUrl'
            ? (params.courseMaps?.run1Splits || [])
            : assetKey === 'run2GpxUrl'
              ? (params.courseMaps?.run2Splits || params.courseMaps?.runSplits || [])
              : (params.courseMaps?.runSplits || []);
      routes.push({
        url,
        color: (gpxAssetConfig as any)[assetKey]?.color || '#8884d8',
        type: (gpxAssetConfig as any)[assetKey]?.type || 'bike',
        assetKey,
        splitPoints,
        routeScope: params.routeScope,
        ticketId: params.ticketId,
        subCategoryId: params.subCategoryId || null,
      });
    });
    return routes;
  }, []);

  const ticketToCourseMap = useMemo(() => {
    const map = new Map<string, CourseRoute[]>();
    ticketDefinitions.forEach((ticket: TicketDefinition) => {
      if (!ticket) return;
      const ticketRoutes = buildRoutesFromCourseMaps({
        ticketId: ticket.id,
        courseMaps: ticket.courseMaps,
        routeScope: 'ticket',
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
          const routes = ticketToCourseMap.get(key);
          if (!routes || routes.length === 0) return null;
          return {
            key,
            label: `${ticketLabel} – ${String(subCategory?.name || subCategory?.title || subCategory?.label || 'Sub Category').trim()}`,
            ticket,
            dateKey: getContestDisplayDateKey(subCategory) || ticketDateKey,
            order: Number(ticket.order || 0),
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
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label);
    });
  }, [getContestDisplayDateKey, getTicketDateKey, ticketDefinitions, ticketToCourseMap]);

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
      return identity.subCategoryId ? `${identity.ticketId}:${identity.subCategoryId}` : identity.ticketId;
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
  }, [contestFilterOptions, resolveAthleteTicketIdentity]);

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
      setTicketFilter(firstKey);
      setCategoryFilter('all');
      return;
    }
    if (!selectedRaceContestKeys.has(ticketFilter)) {
      setTicketFilter(firstKey);
      setCategoryFilter('all');
    }
  }, [eventDetails.id, selectedRaceContestKeys, selectedRaceContestOptions, ticketFilter]);

  const visibleAthletes = useMemo(
    () => dedupeAthletes((isReplayMode ? replayData : liveData)
      .map((athlete) => normalizeVisibleAthlete(athlete))
      .filter((row) => isActiveAthlete(row))
      .filter((row) => isAthleteOnSelectedRaceDay(row))),
    [isReplayMode, replayData, liveData, normalizeVisibleAthlete, isAthleteOnSelectedRaceDay],
  );

  const publicSearchableAthletes = useMemo(
    () => visibleAthletes.filter((athlete) => (athlete as any)?.searchVisible !== false),
    [visibleAthletes],
  );

  const publicMapAthletes = useMemo(
    () => visibleAthletes.filter((athlete) => (athlete as any)?.mapVisible !== false),
    [visibleAthletes],
  );

  const leaderboardReady = Boolean(timingConfiguration && contestFilterOptions.length > 0 && courseConfig);

  const handleGpxDataLoaded = useCallback((gpxPaths: GpxPath[]) => {
    setElevationData(gpxPaths);
  }, []);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      toast({ variant: 'destructive', title: 'Invalid Search', description: 'Please enter a BIB number or name.' });
      return;
    }
    setHasSearched(true);
    setIsSearching(true);
    
    const dataToSearch = publicSearchableAthletes;
    
    const results = dataToSearch.filter(athlete => {
      if (!isActiveAthlete(athlete)) return false;
        if (searchBy === 'bib') {
            return athlete.bib.toLowerCase() === term;
        }
        if (searchBy === 'name') {
            return athlete.name.toLowerCase().includes(term);
        }
        if (searchBy === 'email') {
          return String((athlete as any)?.email || (athlete as any)?.registration?.email || '').toLowerCase().includes(term);
        }
        return false;
    });

    if (results.length > 0) {
      if (results.length === 1) {
        handleToggleTrackAthlete(results[0]);
        clearSearch();
        setIsSearching(false);
        toast({ title: 'Added to Watchlist', description: `${results[0].name} added to Personal Watchlist.` });
        return;
      }
      setSearchResults(results);
      setIsSearching(false);
      return;
    }

    // Fallback to Athlete Master Index so registered athletes are searchable before race start.
    try {
      const response = await fetch(`/api/live/athlete-master-search/${encodeURIComponent(eventDetails.id)}?q=${encodeURIComponent(searchTerm.trim())}&mode=${encodeURIComponent(searchBy)}`, {
        method: 'GET',
        cache: 'no-store',
        headers: authHeaders,
      });
      const payload = await response.json().catch(() => null);
      const matches = Array.isArray(payload?.matches) ? payload.matches : [];
      if (response.ok && matches.length > 0) {
        const mapped: LiveAthlete[] = matches.map((entry: any, index: number) => ({
          id: String(entry?.bergmanAthleteId || entry?.provider?.providerUuid || `master-${index + 1}`),
          bib: String(entry?.bib || '').trim() || 'N/A',
          name: String(entry?.fullName || [entry?.firstName, entry?.lastName].filter(Boolean).join(' ') || 'Unknown Athlete'),
          fullName: String(entry?.fullName || [entry?.firstName, entry?.lastName].filter(Boolean).join(' ') || 'Unknown Athlete'),
          firstName: String(entry?.firstName || '').trim() || null,
          lastName: String(entry?.lastName || '').trim() || null,
          initials: normalizeAthleteInitials(String(entry?.fullName || [entry?.firstName, entry?.lastName].filter(Boolean).join(' ') || 'Unknown Athlete')),
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
          clubName: String(entry?.club || '').trim() || null,
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
        if (mapped.length === 1) {
          handleToggleTrackAthlete(mapped[0]);
          clearSearch();
          toast({ title: 'Added to Watchlist', description: `${mapped[0].name} added to Personal Watchlist.` });
          setIsSearching(false);
          return;
        }
        setSearchResults(dedupeAthletes(mapped));
        toast({ title: 'Athlete Found', description: 'Loaded from Athlete Master Index.' });
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

    const source = publicSearchableAthletes.filter((row) => isActiveAthlete(row));
    const suggestions = source
      .filter((athlete) => {
        if (searchBy === 'bib') {
          return String(athlete.bib || '').toLowerCase().includes(term);
        }
        if (searchBy === 'email') {
          return String((athlete as any)?.email || (athlete as any)?.registration?.email || '').toLowerCase().includes(term);
        }
        return String(athlete.name || '').toLowerCase().includes(term);
      })
      .slice(0, 8);

    setSearchSuggestions(suggestions);
  }, [searchTerm, searchBy, isReplayMode, publicSearchableAthletes, authHeaders]);

  const trackedAthletes = useMemo(() => {
    if (trackedAthleteIds.size === 0) return [];
    const dataToFilter = visibleAthletes;
    return Array.from(trackedAthleteIds)
      .map((trackedId) => {
        const stored = trackedAthleteStore.get(trackedId);
        const liveMatch = dataToFilter.find((athlete) =>
          getAthleteStableId(athlete) === trackedId ||
          (!!stored?.bib && athlete.bib === stored.bib) ||
          (!!stored?.athleteUid && athlete.athleteUid === stored.athleteUid),
        );
        return liveMatch || stored || null;
      })
      .filter((athlete): athlete is LiveAthlete => athlete !== null);
  }, [visibleAthletes, trackedAthleteIds, trackedAthleteStore]);
  
  const athletesToDisplayOnMap = useMemo(() => {
    if (focusedAthlete && (focusedAthlete as any)?.mapVisible !== false) return [focusedAthlete];
    if (trackedAthletes.length === 0) return [];
    return trackedAthletes.filter((athlete) => (athlete as any)?.mapVisible !== false);
  }, [focusedAthlete, trackedAthletes]);

  const eventCategoryDateSummary = useMemo(() => {
    const fallbackDate = String(eventDetails?.eventDate || '').trim();
    const getOrdinal = (day: number) => {
      const mod100 = day % 100;
      if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
      const mod10 = day % 10;
      if (mod10 === 1) return `${day}st`;
      if (mod10 === 2) return `${day}nd`;
      if (mod10 === 3) return `${day}rd`;
      return `${day}th`;
    };

    const dateKeys = (ticketDefinitions || [])
      .map((ticket: TicketDefinition) => {
        const dateRaw = String(ticket?.eventDate || fallbackDate).trim();
        return normalizeDateKeyValue(dateRaw);
      })
      .filter(Boolean)
      .sort((a: string, b: string) => new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime());

    const uniqueDateKeys = Array.from(new Set(dateKeys));
    if (uniqueDateKeys.length === 0) return '';

    const dates = uniqueDateKeys
      .map((key) => ({ key, date: new Date(`${key}T00:00:00Z`) }))
      .filter((item) => !Number.isNaN(item.date.getTime()));

    if (dates.length === 0) return 'Date TBD';
    if (dates.length === 1) {
      const d = dates[0].date;
      return `${getOrdinal(d.getUTCDate())} ${d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
    }

    const sameMonthYear = dates.every((item) => item.date.getUTCMonth() === dates[0].date.getUTCMonth() && item.date.getUTCFullYear() === dates[0].date.getUTCFullYear());
    if (sameMonthYear) {
      const dayLabels = dates.map((item) => getOrdinal(item.date.getUTCDate()));
      const joinedDays = dayLabels.length === 2
        ? `${dayLabels[0]} & ${dayLabels[1]}`
        : `${dayLabels.slice(0, -1).join(', ')} & ${dayLabels[dayLabels.length - 1]}`;
      const monthYear = dates[0].date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return `${joinedDays} ${monthYear}`;
    }

    return dates
      .map((item) => `${getOrdinal(item.date.getUTCDate())} ${item.date.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })}`)
      .join(' • ');
  }, [ticketDefinitions, eventDetails?.eventDate]);

  const mapTimingPointMarkers = useMemo(() => {
    const points = (timingConfiguration?.timingPoints || [])
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
      return labels.includes(candidateName);
    });
    return String(matched?.id || directId || '').trim() || null;
  }, [getTicketDefinitionForAthlete]);

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
    setTrackedAthleteIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(athleteId)) {
        newSet.delete(athleteId);
        setFocusedAthlete((prevFocused) => {
          if (!prevFocused) return prevFocused;
          const focusedId = getAthleteStableId(prevFocused);
          return focusedId === athleteId ? null : prevFocused;
        });
        setTrackedAthleteStore((prevStore) => {
          const next = new Map(prevStore);
          next.delete(athleteId);
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
            <CardTitle className="text-center pt-8 text-2xl font-black uppercase italic tracking-tighter text-primary">
              {eventDetails?.eventName || 'Live Tracking'}
            </CardTitle>
            <div className="mx-auto mt-4 flex w-full max-w-2xl flex-col items-center gap-1 text-center">
              <p className="text-sm font-black uppercase tracking-[0.28em] text-muted-foreground">
                {eventDetails.eventName || 'Live Tracking'}
              </p>
              {eventCategoryDateSummary ? (
                <CardDescription className="text-center font-bold text-[11px] text-muted-foreground">
                  {eventCategoryDateSummary}
                </CardDescription>
              ) : null}
            </div>
          </CardHeader>
        </Card>
        
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
            <TabsList className="grid w-full grid-cols-3 bg-muted/50 p-1 rounded-xl border border-border/50">
                <TabsTrigger value="leaderboard" className="rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest"><ListIcon className="h-4 w-4"/>Leaderboard</TabsTrigger>
                <TabsTrigger value="search" className="rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest"><Users className="h-4 w-4"/>Search & Track</TabsTrigger>
                <TabsTrigger value="map" className="rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest"><MapIcon className="h-4 w-4"/>Live Map</TabsTrigger>
            </TabsList>
            <TabsContent value="map" className="mt-4 animate-in fade-in duration-500 text-left">
                <div className="mb-4 space-y-2 text-left">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Displaying Route Path:</p>
                    <div className="flex flex-wrap gap-2 text-left">
                        {selectedRaceContestOptions.map((option) => {
                          const isActive = selectedTicketId === option.key && !focusedAthlete;
                          return (
                            <Button
                              key={option.key}
                              variant={isActive ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => { setSelectedTicketId(option.key); setFocusedAthlete(null); }}
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
            <TabsContent value="leaderboard" className="mt-4 animate-in fade-in duration-500 text-left">
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
                    />
                )}
            </TabsContent>
            <TabsContent value="search" className="mt-4 animate-in fade-in duration-500 text-left space-y-6">
                 <Card className="border-none shadow-xl text-left">
                    <CardHeader className="text-left border-b bg-muted/30">
                        <CardTitle className="text-lg font-black uppercase tracking-tight text-left">Athlete Finder</CardTitle>
                        <CardDescription className="text-left">Identify athletes to track their progress on the map.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 text-left">
                         <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 text-left">
                            <Select value={searchBy} onValueChange={(v) => setSearchBy(v as any)}>
                                <SelectTrigger className="w-full sm:w-[140px] h-11 rounded-xl font-bold text-left shadow-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="text-left">
                                    <SelectItem value="bib" className="font-bold text-left">BIB #</SelectItem>
                                    <SelectItem value="name" className="font-bold text-left">Athlete Name</SelectItem>
                                    <SelectItem value="email" className="font-bold text-left">Email</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="relative flex-grow text-left">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input 
                                    placeholder={`Search by ${searchBy}...`} 
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="h-11 rounded-xl pl-10 bg-muted/20 border-none font-bold placeholder:font-normal text-left"
                                />
                                {searchTerm.trim().length > 0 && searchSuggestions.length > 0 ? (
                                  <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl border bg-background shadow-xl">
                                    {searchSuggestions.map((athlete) => (
                                      <button
                                        key={`suggestion-${athlete.id}-${athlete.bib}`}
                                        type="button"
                                        className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted/60"
                                        onClick={() => {
                                          setSearchTerm(searchBy === 'bib' ? String(athlete.bib || '') : String(athlete.name || ''));
                                          setSearchResults([athlete]);
                                          setHasSearched(true);
                                          setSearchSuggestions([]);
                                          handleToggleTrackAthlete(athlete);
                                        }}
                                      >
                                        <span className="font-semibold">{athlete.name}</span>
                                        <span className="font-mono text-muted-foreground">BIB {athlete.bib}</span>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                            </div>
                            <Button type="submit" disabled={isSearching} className="h-11 px-8 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase tracking-widest text-xs shadow-lg shadow-primary/20 text-left">
                                {isSearching ? <Loader2 className="animate-spin h-4 w-4" /> : <Search className="h-4 w-4 mr-2" />}
                                Search
                            </Button>
                        </form>
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
                        <CardTitle className="text-lg font-black uppercase tracking-tight text-left">Personal Watchlist ({trackedAthletes.length})</CardTitle>
                        <CardDescription className="text-left">Selected athletes for real-time map visualization.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar text-left">
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
            </TabsContent>
        </Tabs>
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
