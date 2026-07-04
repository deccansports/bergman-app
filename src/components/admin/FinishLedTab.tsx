// src/components/admin/FinishLedTab.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tv, Copy, ExternalLink, Info, Trophy, TimerReset, Pencil, Trash2, Eye, Upload, PlusCircle, Activity } from 'lucide-react';
import type { EventCalendarEntry } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { isBefore, parseISO, startOfDay } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface FinishLedTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

const PIXELS_PER_FOOT = 3600;

type LedMode = 'finishers' | 'podium';
type PodiumStyle = 'sequential' | 'full';
type ManualTimingMode = 'overall' | 'individual';
type ManualPodiumPosition = 'none' | 'winner' | 'first_runner_up' | 'second_runner_up';
type ManualAwardEntry = {
  docId: string;
  eventId: string;
  bibNumber: string;
  name: string;
  category: string;
  ageGroup: string;
  timingMode: ManualTimingMode;
  podiumPosition: ManualPodiumPosition;
  sourceLabel?: 'Auto Fetched' | 'Manually Added';
  isManualEntry?: boolean;
  finishTime?: string;
  chipTime?: string | null;
  swim?: string | null;
  t1?: string | null;
  bike?: string | null;
  t2?: string | null;
  run?: string | null;
  updatedAt?: string | null;
};

type FinishLedTracingEndpoint = {
  label: string;
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  description: string;
};

type FinishLedTracingSnapshot = {
  eventId: string;
  eventName: string;
  provider: string;
  configurationSource: string;
  hasProviderState: boolean;
  providerStateUpdatedAt: string | null;
  participantsImported: boolean;
  lastSuccessfulParticipantImport: string | null;
  endpoints: FinishLedTracingEndpoint[];
};

export default function FinishLedTab({ events, isLoadingEvents }: FinishLedTabProps) {
  const { toast } = useToast();
  const [ledMode, setLedMode] = useState<LedMode>('finishers');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string>('');
  const [baseUrl, setBaseUrl] = useState('');
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [widthFeet, setWidthFeet] = useState(8);
  const [heightFeet, setHeightFeet] = useState(2);
  const [podiumStyle, setPodiumStyle] = useState<PodiumStyle>('sequential');
  const [podiumCategories, setPodiumCategories] = useState<string[]>([]);
  const [podiumAgeGroups, setPodiumAgeGroups] = useState<string[]>([]);
  const [categoryAgeGroupsMap, setCategoryAgeGroupsMap] = useState<Record<string, string[]>>({});
  const [selectedPodiumCategory, setSelectedPodiumCategory] = useState<string>('');
  const [selectedPodiumAgeGroup, setSelectedPodiumAgeGroup] = useState<string>('');
  const [isLoadingPodiumOptions, setIsLoadingPodiumOptions] = useState(false);
  const [replayNonce, setReplayNonce] = useState<number>(0);
  const [podiumOptionsRefreshNonce, setPodiumOptionsRefreshNonce] = useState<number>(0);
  const [manualAwards, setManualAwards] = useState<ManualAwardEntry[]>([]);
  const [isLoadingManualAwards, setIsLoadingManualAwards] = useState(false);
  const [editingManualDocId, setEditingManualDocId] = useState<string | null>(null);
  const [activeManualDocId, setActiveManualDocId] = useState<string | null>(null);
  const [manualBibNumber, setManualBibNumber] = useState('');
  const [manualTimingMode, setManualTimingMode] = useState<ManualTimingMode>('overall');
  const [manualPodiumPosition, setManualPodiumPosition] = useState<ManualPodiumPosition>('none');
  const [manualOverallTime, setManualOverallTime] = useState('');
  const [manualSwim, setManualSwim] = useState('');
  const [manualT1, setManualT1] = useState('');
  const [manualBike, setManualBike] = useState('');
  const [manualT2, setManualT2] = useState('');
  const [manualRun, setManualRun] = useState('');
  const [manualAthleteName, setManualAthleteName] = useState('');
  const [manualCategory, setManualCategory] = useState('');
  const [manualAgeGroup, setManualAgeGroup] = useState('');
  const [isSavingManualEntry, setIsSavingManualEntry] = useState(false);
  const [isResolvingBib, setIsResolvingBib] = useState(false);
  const [finishLedLogoUrl, setFinishLedLogoUrl] = useState('');
  const [isUploadingFinishLedLogo, setIsUploadingFinishLedLogo] = useState(false);
  const [tracingSnapshot, setTracingSnapshot] = useState<FinishLedTracingSnapshot | null>(null);
  const [isLoadingTracing, setIsLoadingTracing] = useState(false);
  const [athleteDisplaySeconds, setAthleteDisplaySeconds] = useState(4);
  const [guestName, setGuestName] = useState('');
  const [guestDesignation, setGuestDesignation] = useState('');
  const [guests, setGuests] = useState<Array<{ name: string; designation?: string }>>([]);
  const [isLoadingGuests, setIsLoadingGuests] = useState(false);

  const upcomingEvents = useMemo(() => {
    if (!events) return [];
    const today = startOfDay(new Date());
    return events.filter(e => {
        if (!e.eventDate) return true; // Keep TBD events
        try {
            return !isBefore(parseISO(e.eventDate), today);
        } catch {
            return false;
        }
    });
  }, [events]);

  const selectedEvent = useMemo(
    () => upcomingEvents.find((e) => e.id === selectedEventId) || null,
    [upcomingEvents, selectedEventId]
  );

  const availableAgeGroupsForSelectedCategory = useMemo(() => {
    if (!selectedPodiumCategory) return podiumAgeGroups;
    return categoryAgeGroupsMap[selectedPodiumCategory] || [];
  }, [selectedPodiumCategory, categoryAgeGroupsMap, podiumAgeGroups]);

  useEffect(() => {
    setFinishLedLogoUrl(selectedEvent?.finishLedLogoUrl || '');
  }, [selectedEventId, selectedEvent?.finishLedLogoUrl]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBaseUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const loadTracing = async () => {
      if (!selectedEventId) {
        setTracingSnapshot(null);
        return;
      }

      setIsLoadingTracing(true);
      try {
        const res = await fetch(`/api/finish-line-led?eventId=${encodeURIComponent(selectedEventId)}&action=tracing`, { cache: 'no-store' });
        const data = await res.json().catch(() => null);

        if (!active) return;

        if (res.ok && data?.success && data?.tracing) {
          const tracing = data.tracing as FinishLedTracingSnapshot;
          setTracingSnapshot({
            eventId: String(tracing.eventId || selectedEventId),
            eventName: String(tracing.eventName || ''),
            provider: String(tracing.provider || 'feibot'),
            configurationSource: String(tracing.configurationSource || 'cloud_api'),
            hasProviderState: Boolean(tracing.hasProviderState),
            providerStateUpdatedAt: tracing.providerStateUpdatedAt || null,
            participantsImported: Boolean(tracing.participantsImported),
            lastSuccessfulParticipantImport: tracing.lastSuccessfulParticipantImport || null,
            endpoints: Array.isArray(tracing.endpoints) ? tracing.endpoints : [],
          });
        } else {
          setTracingSnapshot(null);
        }
      } catch (error) {
        console.error('Failed to load finish LED tracing:', error);
        if (active) setTracingSnapshot(null);
      } finally {
        if (active) setIsLoadingTracing(false);
      }
    };

    void loadTracing();

    return () => {
      active = false;
    };
  }, [selectedEventId]);

  useEffect(() => {
    const loadPodiumOptions = async () => {
      if (ledMode !== 'podium') {
        setPodiumCategories([]);
        setPodiumAgeGroups([]);
        setCategoryAgeGroupsMap({});
        setSelectedPodiumCategory('');
        setSelectedPodiumAgeGroup('');
        return;
      }

      const parseAgeGroups = (value: unknown, eventFallback: string[] = []): string[] => {
        if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
        if (typeof value === 'string') {
          const s = value.trim();
          if (!s) return [];
          if (s.toLowerCase() === 'all' || s.toLowerCase() === 'open') return eventFallback;
          return s.split(',').map(x => x.trim()).filter(Boolean);
        }
        return [];
      };

      const buildFallbackFromEventConfig = (): { categories: string[]; categoryAgeGroups: Record<string, string[]>; allAgeGroups: string[] } => {
        const ageFallback = (selectedEvent?.ageCategories || []).map(a => String(a || '').trim()).filter(Boolean);
        const map: Record<string, string[]> = {};

        const visibleSortedTickets = [...(selectedEvent?.ticketDefinitions || [])]
          .filter((ticket) => ticket && ticket.isHidden !== true)
          .sort((a, b) => Number(a?.order ?? 9999) - Number(b?.order ?? 9999));

        visibleSortedTickets.forEach((ticket) => {
          const baseName = String(ticket?.ticketName || '').trim();
          if (!baseName) return;

          const ticketAges = parseAgeGroups(ticket?.applicableAgeGroups, ageFallback);
          const subCategories = Array.isArray(ticket?.subCategories) ? ticket.subCategories : [];

          if (subCategories.length > 0) {
            subCategories.forEach((sub) => {
              const subName = String(sub?.name || '').trim();
              if (!subName) return;
              const label = `${baseName} - ${subName}`;
              const subAges = parseAgeGroups(sub?.applicableAgeGroups, ageFallback);
              map[label] = (subAges.length ? subAges : ticketAges);
            });
          } else if (!map[baseName]) {
            map[baseName] = ticketAges;
          }
        });

        const categories = Object.keys(map).sort((a, b) => a.localeCompare(b));
        const allAgeGroups = [...new Set(Object.values(map).flat().filter(Boolean))].sort((a, b) => a.localeCompare(b));
        return { categories, categoryAgeGroups: map, allAgeGroups };
      };

      if (isDemoMode) {
        const mockCategoryAgeGroups: Record<string, string[]> = {
          'Olympic Triathlon': ['18-24', '25-29', '30-34', '35-39'],
          'Bergman 113': ['18-24', '25-29', '30-34', '35-39', '40-44'],
          'Swimathon - 500m': ['U14', '14-17', '18-24'],
          'Swimathon - 1km': ['18-24', '25-29', '30-34'],
          'Swimathon - 2km': ['25-29', '30-34', '35-39'],
        };
        const categories = Object.keys(mockCategoryAgeGroups);
        const ageGroups = [...new Set(Object.values(mockCategoryAgeGroups).flat())].sort((a, b) => a.localeCompare(b));

        setPodiumCategories(categories);
        setPodiumAgeGroups(ageGroups);
        setCategoryAgeGroupsMap(mockCategoryAgeGroups);
        setSelectedPodiumCategory((prev) => (prev && categories.includes(prev) ? prev : (categories[0] || '')));
        const initialCategory = (selectedPodiumCategory && categories.includes(selectedPodiumCategory)) ? selectedPodiumCategory : (categories[0] || '');
        const initialAges = mockCategoryAgeGroups[initialCategory] || [];
        setSelectedPodiumAgeGroup((prev) => (prev && initialAges.includes(prev) ? prev : (initialAges[0] || '')));
        return;
      }

      if (!selectedEventId) {
        const fallback = buildFallbackFromEventConfig();
        setPodiumCategories(fallback.categories);
        setPodiumAgeGroups(fallback.allAgeGroups);
        setCategoryAgeGroupsMap(fallback.categoryAgeGroups);
        setSelectedPodiumCategory((prev) => (prev && fallback.categories.includes(prev) ? prev : (fallback.categories[0] || '')));
        const categoryToUse = (selectedPodiumCategory && fallback.categories.includes(selectedPodiumCategory)) ? selectedPodiumCategory : (fallback.categories[0] || '');
        const agesForCategory = fallback.categoryAgeGroups[categoryToUse] || [];
        setSelectedPodiumAgeGroup((prev) => (prev && agesForCategory.includes(prev) ? prev : (agesForCategory[0] || '')));
        return;
      }

      setIsLoadingPodiumOptions(true);
      try {
        const res = await fetch(`/api/finish-line-led?eventId=${encodeURIComponent(selectedEventId)}&action=podium-options`);
        const data = await res.json();

        const categoriesFromApi = Array.isArray(data?.categories) ? data.categories.filter(Boolean) : [];
        const ageGroupsFromApi = Array.isArray(data?.ageGroups) ? data.ageGroups.filter(Boolean) : [];
        const mapFromApiRaw = data?.categoryAgeGroups && typeof data.categoryAgeGroups === 'object'
          ? data.categoryAgeGroups as Record<string, string[]>
          : {};
        const mapFromApi: Record<string, string[]> = {};
        Object.entries(mapFromApiRaw).forEach(([k, v]) => {
          mapFromApi[String(k)] = (Array.isArray(v) ? v : []).map((x) => String(x || '').trim()).filter(Boolean);
        });

        const fallback = buildFallbackFromEventConfig();
        const categories = categoriesFromApi.length > 0 ? categoriesFromApi : fallback.categories;
        const categoryAgeGroups = Object.keys(mapFromApi).length > 0 ? mapFromApi : fallback.categoryAgeGroups;
        const ageGroups = ageGroupsFromApi.length > 0
          ? ageGroupsFromApi
          : [...new Set(Object.values(categoryAgeGroups).flat().filter(Boolean))].sort((a, b) => a.localeCompare(b));

        setPodiumCategories(categories);
        setPodiumAgeGroups(ageGroups);
        setCategoryAgeGroupsMap(categoryAgeGroups);
        setSelectedPodiumCategory((prev) => (prev && categories.includes(prev) ? prev : (categories[0] || '')));

        const categoryToUse = (selectedPodiumCategory && categories.includes(selectedPodiumCategory)) ? selectedPodiumCategory : (categories[0] || '');
        const agesForCategory = categoryAgeGroups[categoryToUse] || [];
        setSelectedPodiumAgeGroup((prev) => (prev && agesForCategory.includes(prev) ? prev : (agesForCategory[0] || '')));
      } catch (error) {
        console.error('Failed to load podium options:', error);
        toast({ title: 'Failed to load podium options', description: 'Could not fetch category/age-group options.' });
      } finally {
        setIsLoadingPodiumOptions(false);
      }
    };

    loadPodiumOptions();
  }, [selectedEventId, ledMode, toast, selectedEvent, selectedPodiumCategory, podiumOptionsRefreshNonce, isDemoMode]);

  useEffect(() => {
    const loadManualAwards = async () => {
      if (ledMode !== 'podium' || !selectedEventId || !selectedPodiumCategory || !selectedPodiumAgeGroup) {
        setManualAwards([]);
        return;
      }

      if (isDemoMode) {
        setManualAwards([
          {
            docId: 'demo-1',
            eventId: selectedEventId,
            bibNumber: '1023',
            name: 'Aditi Kulkarni',
            category: selectedPodiumCategory,
            ageGroup: selectedPodiumAgeGroup,
            timingMode: 'overall',
            podiumPosition: 'winner',
            finishTime: '02:37:14',
            chipTime: '02:37:14',
            sourceLabel: 'Auto Fetched',
            isManualEntry: false,
          },
          {
            docId: 'demo-2',
            eventId: selectedEventId,
            bibNumber: '1091',
            name: 'Nisha Rao',
            category: selectedPodiumCategory,
            ageGroup: selectedPodiumAgeGroup,
            timingMode: 'overall',
            podiumPosition: 'first_runner_up',
            finishTime: '02:38:21',
            chipTime: '02:38:21',
            sourceLabel: 'Manually Added',
            isManualEntry: true,
          },
        ]);
        return;
      }

      setIsLoadingManualAwards(true);
      try {
        const res = await fetch(
          `/api/finish-line-led?eventId=${encodeURIComponent(selectedEventId)}&action=podium-entries&category=${encodeURIComponent(selectedPodiumCategory)}&ageGroup=${encodeURIComponent(selectedPodiumAgeGroup)}`
        );
        const data = await res.json();
        const entries = Array.isArray(data?.entries) ? data.entries : [];
        setManualAwards(entries);
      } catch (error) {
        console.error('Failed to load manual awards:', error);
        toast({ title: 'Load failed', description: 'Could not load manual awards.' });
      } finally {
        setIsLoadingManualAwards(false);
      }
    };

    loadManualAwards();
  }, [ledMode, selectedEventId, selectedPodiumCategory, selectedPodiumAgeGroup, toast, isDemoMode, podiumOptionsRefreshNonce]);

  useEffect(() => {
    if (ledMode !== 'podium') return;
    if (!selectedPodiumCategory) return;
    const ageOptions = categoryAgeGroupsMap[selectedPodiumCategory] || [];
    if (ageOptions.length === 0) return;
    if (!selectedPodiumAgeGroup || !ageOptions.includes(selectedPodiumAgeGroup)) {
      setSelectedPodiumAgeGroup(ageOptions[0]);
    }
  }, [ledMode, selectedPodiumCategory, selectedPodiumAgeGroup, categoryAgeGroupsMap]);

  useEffect(() => {
    if (selectedEventId && baseUrl) {
        const url = new URL(`${baseUrl}/finish_line_led.html`);
        url.searchParams.set('eventId', selectedEventId);
        if (isDemoMode) {
            url.searchParams.set('demo', 'true');
        }
        if (widthFeet > 0) url.searchParams.set('w', String(widthFeet * PIXELS_PER_FOOT));
        if (heightFeet > 0) url.searchParams.set('h', String(heightFeet * PIXELS_PER_FOOT));

        if (ledMode === 'podium') {
          if (!selectedPodiumCategory || !selectedPodiumAgeGroup) {
            setGeneratedUrl('');
            return;
          }
          url.searchParams.set('mode', 'podium');
          url.searchParams.set('category', selectedPodiumCategory);
          url.searchParams.set('ageGroup', selectedPodiumAgeGroup);
          url.searchParams.set('style', podiumStyle);
          url.searchParams.set('athleteSeconds', String(athleteDisplaySeconds));
          if (replayNonce > 0) {
            url.searchParams.set('replay', String(replayNonce));
          }
        }

        setGeneratedUrl(url.toString());
    } else {
      setGeneratedUrl('');
    }
  }, [
    selectedEventId,
    baseUrl,
    isDemoMode,
    widthFeet,
    heightFeet,
    ledMode,
    selectedPodiumCategory,
    selectedPodiumAgeGroup,
    podiumStyle,
    athleteDisplaySeconds,
    replayNonce,
  ]);

  const copyToClipboard = () => {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(generatedUrl);
    toast({ title: 'Link Copied!', description: 'The URL has been copied to your clipboard.' });
  };

  const goToNextPodiumGroup = () => {
    if (!podiumCategories.length || !podiumAgeGroups.length) return;

    const combinations: Array<{ category: string; ageGroup: string }> = [];
    podiumCategories.forEach((category) => {
      podiumAgeGroups.forEach((ageGroup) => {
        combinations.push({ category, ageGroup });
      });
    });

    const currentIndex = combinations.findIndex(
      (c) => c.category === selectedPodiumCategory && c.ageGroup === selectedPodiumAgeGroup
    );
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % combinations.length : 0;
    const next = combinations[nextIndex];
    setSelectedPodiumCategory(next.category);
    setSelectedPodiumAgeGroup(next.ageGroup);
  };

  const isTimeLike = (value: string) => /^\d{2}:\d{2}:\d{2}$/.test(value.trim());

  const handleSaveManualEntry = async () => {
    if (!selectedEventId) {
      toast({ title: 'Select event first', description: 'Please choose an event before saving manual timing.' });
      return;
    }
    if (!manualBibNumber.trim()) {
      toast({ title: 'BIB required', description: 'Please enter athlete BIB number.' });
      return;
    }

    if (manualTimingMode === 'overall') {
      if (!isTimeLike(manualOverallTime)) {
        toast({ title: 'Invalid time format', description: 'Overall time must be HH:MM:SS.' });
        return;
      }
    } else {
      if (![manualSwim, manualT1, manualBike, manualT2, manualRun].every(isTimeLike)) {
        toast({ title: 'Invalid leg format', description: 'SWIM, T1, BIKE, T2 and RUN must all be HH:MM:SS.' });
        return;
      }
    }

    setIsSavingManualEntry(true);
    try {
      const res = await fetch('/api/finish-line-led', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'manual-podium-entry',
          docId: editingManualDocId || undefined,
          eventId: selectedEventId,
          bibNumber: manualBibNumber.trim(),
          timingMode: manualTimingMode,
          podiumPosition: manualPodiumPosition,
          overallTime: manualTimingMode === 'overall' ? manualOverallTime.trim() : undefined,
          swim: manualTimingMode === 'individual' ? manualSwim.trim() : undefined,
          t1: manualTimingMode === 'individual' ? manualT1.trim() : undefined,
          bike: manualTimingMode === 'individual' ? manualBike.trim() : undefined,
          t2: manualTimingMode === 'individual' ? manualT2.trim() : undefined,
          run: manualTimingMode === 'individual' ? manualRun.trim() : undefined,
          athleteName: manualAthleteName.trim() || undefined,
          category: (manualCategory.trim() || selectedPodiumCategory || undefined),
          ageGroup: (manualAgeGroup.trim() || selectedPodiumAgeGroup || undefined),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) {
        toast({ title: 'Save failed', description: data?.message || 'Could not save manual podium entry.' });
        return;
      }

      toast({ title: 'Manual timing saved', description: data?.message || 'Podium entry updated.' });
      setEditingManualDocId(null);
      setManualBibNumber('');
      setManualOverallTime('');
      setManualSwim('');
      setManualT1('');
      setManualBike('');
      setManualT2('');
      setManualRun('');
      setManualAthleteName('');
      setManualCategory('');
      setManualAgeGroup('');
      setManualPodiumPosition('none');
      if (data?.category) setSelectedPodiumCategory(data.category);
      if (data?.ageGroup) setSelectedPodiumAgeGroup(data.ageGroup);
      setPodiumOptionsRefreshNonce((n) => n + 1);
    } catch (error) {
      console.error('Manual podium entry error:', error);
      toast({ title: 'Save failed', description: 'Unexpected error while saving manual entry.' });
    } finally {
      setIsSavingManualEntry(false);
    }
  };

  const handleResolveBib = async () => {
    if (!selectedEventId || !manualBibNumber.trim()) return;
    setIsResolvingBib(true);
    try {
      const res = await fetch(`/api/finish-line-led?eventId=${encodeURIComponent(selectedEventId)}&action=resolve-bib&bibNumber=${encodeURIComponent(manualBibNumber.trim())}`);
      const data = await res.json();
      if (!data?.success || !data?.athlete) return;
      if (data.athlete.name) setManualAthleteName(data.athlete.name);
      if (data.athlete.category && !manualCategory.trim()) setManualCategory(data.athlete.category);
      if (data.athlete.ageGroup && !manualAgeGroup.trim()) setManualAgeGroup(data.athlete.ageGroup);
      toast({ title: 'Athlete fetched', description: `Loaded athlete details for BIB ${manualBibNumber.trim()}.` });
    } catch (error) {
      console.error('Resolve BIB failed:', error);
    } finally {
      setIsResolvingBib(false);
    }
  };

  const handleEditManualAward = (entry: ManualAwardEntry) => {
    setEditingManualDocId(entry.docId);
    setManualBibNumber(entry.bibNumber || '');
    setManualTimingMode(entry.timingMode || 'overall');
    setManualPodiumPosition(entry.podiumPosition || 'none');
    setManualOverallTime(entry.chipTime || '');
    setManualSwim(entry.swim || '');
    setManualT1(entry.t1 || '');
    setManualBike(entry.bike || '');
    setManualT2(entry.t2 || '');
    setManualRun(entry.run || '');
    setManualAthleteName(entry.name || '');
    setManualCategory(entry.category || '');
    setManualAgeGroup(entry.ageGroup || '');
  };

  const handleDeleteManualAward = async (entry: ManualAwardEntry) => {
    if (isDemoMode) {
      setManualAwards((prev) => prev.filter((e) => e.docId !== entry.docId));
      return;
    }
    if (!selectedEventId) return;
    try {
      const res = await fetch('/api/finish-line-led', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'podium-delete',
          eventId: selectedEventId,
          docId: entry.docId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        toast({ title: 'Delete failed', description: data?.message || 'Could not delete manual award.' });
        return;
      }
      if (activeManualDocId === entry.docId) {
        setActiveManualDocId(null);
      }
      toast({ title: 'Deleted', description: 'Manual award entry deleted.' });
      setPodiumOptionsRefreshNonce((n) => n + 1);
    } catch (error) {
      console.error('Delete manual award failed:', error);
      toast({ title: 'Delete failed', description: 'Unexpected error while deleting award.' });
    }
  };

  const handleShowNow = (entry: ManualAwardEntry) => {
    setActiveManualDocId(entry.docId);
    setSelectedPodiumCategory(entry.category);
    setSelectedPodiumAgeGroup(entry.ageGroup);

    if (!selectedEventId || isDemoMode) return;
    const selectedIdentifier = entry.docId || entry.bibNumber;
    fetch('/api/finish-line-led', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set-podium-current',
        eventId: selectedEventId,
        category: entry.category,
        ageGroup: entry.ageGroup,
        style: podiumStyle,
        displayMode: 'single',
        selectedDocId: selectedIdentifier,
        podiumPosition: entry.podiumPosition || 'none',
        athleteDisplaySeconds,
      }),
    }).catch((err) => console.error('set-podium-current failed', err));
  };

  const handleShowTop3 = () => {
    if (!selectedEventId || !selectedPodiumCategory || !selectedPodiumAgeGroup || isDemoMode) return;
    setActiveManualDocId(null);
    fetch('/api/finish-line-led', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set-podium-current',
        eventId: selectedEventId,
        category: selectedPodiumCategory,
        ageGroup: selectedPodiumAgeGroup,
        style: 'full',
        displayMode: 'top3',
        selectedDocId: null,
        athleteDisplaySeconds,
        replayToken: null,
      }),
    }).catch((err) => console.error('set-podium-current failed', err));
  };

  const handleShowSponsors = () => {
    if (!selectedEventId || isDemoMode) return;

    fetch('/api/finish-line-led', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set-podium-current',
        eventId: selectedEventId,
        category: selectedPodiumCategory || 'N/A',
        ageGroup: selectedPodiumAgeGroup || 'N/A',
        style: 'full',
        displayMode: 'sponsors',
        selectedDocId: null,
        athleteDisplaySeconds: 10,
        replayToken: null,
      }),
    }).catch((err) => console.error('show sponsors failed', err));
  };

  const handleAddGuest = () => {
    if (!guestName.trim()) {
      toast({ title: 'Error', description: 'Please enter guest name' });
      return;
    }
    const newGuests = [...guests, { name: guestName.trim(), designation: guestDesignation.trim() || undefined }];
    setGuests(newGuests);
    setGuestName('');
    setGuestDesignation('');
  };

  const handleRemoveGuest = (index: number) => {
    setGuests(guests.filter((_, i) => i !== index));
  };

  const handleShowGuests = () => {
    if (!selectedEventId || guests.length === 0 || isDemoMode) {
      toast({ title: 'Error', description: 'Please add at least one guest' });
      return;
    }

    fetch('/api/finish-line-led', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set-podium-current',
        eventId: selectedEventId,
        category: 'guests',
        ageGroup: 'welcome',
        style: 'full',
        displayMode: 'guests',
        guests: guests,
        selectedDocId: null,
        athleteDisplaySeconds: 5,
        replayToken: null,
      }),
    }).catch((err) => console.error('show guests failed', err));
  };

  const handleReplayAnimation = () => {
    const replayToken = String(Date.now());
    setReplayNonce(Number(replayToken));

    if (!selectedEventId || !selectedPodiumCategory || !selectedPodiumAgeGroup || isDemoMode) return;

    setActiveManualDocId(null);
    fetch('/api/finish-line-led', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set-podium-current',
        eventId: selectedEventId,
        category: selectedPodiumCategory,
        ageGroup: selectedPodiumAgeGroup,
        style: podiumStyle,
        displayMode: 'top3',
        selectedDocId: null,
        athleteDisplaySeconds,
        replayToken,
      }),
    }).catch((err) => console.error('set-podium-current failed', err));
  };

  const handleFinishLedLogoUpload = async (file: File | null) => {
    if (!file || !selectedEventId) return;

    setIsUploadingFinishLedLogo(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'finishLedLogoUrl');
    formData.append('eventId', selectedEventId);

    try {
      const response = await fetch('/api/admin/upload-event-asset', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();

      if (!response.ok || !result?.success) {
        throw new Error(result?.message || 'Logo upload failed.');
      }

      setFinishLedLogoUrl(result.downloadURL || '');
      toast({ title: 'Logo uploaded', description: 'Finish LED screen will use this logo. Default is used when no custom logo exists.' });
    } catch (error) {
      console.error('finish LED logo upload failed:', error);
      toast({ title: 'Upload failed', description: error instanceof Error ? error.message : 'Could not upload logo.' });
    } finally {
      setIsUploadingFinishLedLogo(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tv className="h-5 w-5 text-primary" />
          Finish Line LED Display
        </CardTitle>
        <CardDescription>
          Generate a link for the finish line LED screen for a specific event. This page is designed for public display and updates in real-time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={ledMode} onValueChange={(v) => setLedMode(v as LedMode)}>
            {/* Mobile: dropdown selector */}
            <div className="block sm:hidden mb-4">
              <Select value={ledMode} onValueChange={(v) => setLedMode(v as LedMode)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {ledMode === 'finishers' ? (
                      <span className="flex items-center gap-2"><Tv className="h-4 w-4" /> Finish Line LED</span>
                    ) : (
                      <span className="flex items-center gap-2"><Trophy className="h-4 w-4" /> Podium / Award Ceremony</span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="finishers">
                    <span className="flex items-center gap-2"><Tv className="h-4 w-4" /> Finish Line LED</span>
                  </SelectItem>
                  <SelectItem value="podium">
                    <span className="flex items-center gap-2"><Trophy className="h-4 w-4" /> Podium / Award Ceremony</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Desktop: tab list */}
            <TabsList className="hidden sm:grid w-full max-w-lg grid-cols-2">
              <TabsTrigger value="finishers" className="flex items-center gap-2">
                <Tv className="h-4 w-4" /> Finish Line LED
              </TabsTrigger>
              <TabsTrigger value="podium" className="flex items-center gap-2">
                <Trophy className="h-4 w-4" /> Podium / Award Ceremony
              </TabsTrigger>
            </TabsList>

            <TabsContent value="finishers" className="space-y-6 pt-4">
              <div className="space-y-2">
                <Label>1. Select an Upcoming Event</Label>
                <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents} value={selectedEventId ?? undefined}>
                  <SelectTrigger className="w-full md:w-1/2">
                    <SelectValue placeholder="Select an Event..." />
                  </SelectTrigger>
                  <SelectContent>
                    {upcomingEvents.map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                  <Label>2. Configure LED Size (in Feet)</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/50 max-w-md">
                      <div>
                          <Label htmlFor="led-width" className="text-xs text-muted-foreground">Width (ft)</Label>
                          <Input id="led-width" type="number" placeholder="Width (ft)" value={widthFeet} onChange={e => setWidthFeet(Number(e.target.value))} />
                      </div>
                      <div>
                          <Label htmlFor="led-height" className="text-xs text-muted-foreground">Height (ft)</Label>
                          <Input id="led-height" type="number" placeholder="Height (ft)" value={heightFeet} onChange={e => setHeightFeet(Number(e.target.value))} />
                      </div>
                  </div>
              </div>
            </TabsContent>

            <TabsContent value="podium" className="space-y-6 pt-4">
              <div className="border rounded-lg p-4 bg-muted/20 space-y-4">
                <div>
                  <Label className="text-sm font-semibold">Branding & Sponsor Ticker</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload an event-specific logo for the LED screen. If no custom logo is uploaded, the default Bergman logo is shown automatically. Sponsors from the Sponsors tab will scroll on the last line like a news ticker.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4 items-start">
                  <div className="rounded-lg border bg-black/30 min-h-[110px] flex items-center justify-center p-3">
                    {finishLedLogoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={finishLedLogoUrl} alt="Finish LED logo preview" className="max-h-20 max-w-full object-contain" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src="/Bmlogowhite.png" alt="Default Bergman logo" className="max-h-20 max-w-full object-contain opacity-90" />
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>Upload Screen Logo</Label>
                      <Input
                        type="file"
                        accept="image/*"
                        disabled={!selectedEventId || isUploadingFinishLedLogo}
                        onChange={(e) => void handleFinishLedLogoUpload(e.target.files?.[0] || null)}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>Current logo: {finishLedLogoUrl ? 'Custom uploaded logo' : 'Default Bergman logo'}</p>
                      <p>Sponsor ticker source: sponsors added in the Sponsors tab for this event.</p>
                    </div>
                    <div className="inline-flex items-center rounded-md border px-3 py-2 text-sm text-muted-foreground bg-background">
                      <Upload className="mr-2 h-4 w-4" />
                      {isUploadingFinishLedLogo ? 'Uploading logo...' : 'Logo updates live on the screen'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>1. Select Event</Label>
                <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents} value={selectedEventId ?? undefined}>
                  <SelectTrigger className="w-full md:w-1/2">
                    <SelectValue placeholder="Select an Event..." />
                  </SelectTrigger>
                  <SelectContent>
                    {upcomingEvents.map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>2. Race Category</Label>
                  <Select
                    value={selectedPodiumCategory || undefined}
                    onValueChange={setSelectedPodiumCategory}
                    disabled={isLoadingPodiumOptions || podiumCategories.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingPodiumOptions ? 'Loading categories...' : 'Select Category'} />
                    </SelectTrigger>
                    <SelectContent>
                      {podiumCategories.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedPodiumCategory && (
                    <div className="bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border-2 border-cyan-400/60 rounded-2xl px-4 py-2 mt-2">
                      <div className="text-sm font-semibold text-slate-900">Selected Category</div>
                      <div className="text-lg font-bold text-slate-900">{selectedPodiumCategory}</div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>3. Age Group</Label>
                  <Select
                    value={selectedPodiumAgeGroup || undefined}
                    onValueChange={setSelectedPodiumAgeGroup}
                    disabled={isLoadingPodiumOptions || availableAgeGroupsForSelectedCategory.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingPodiumOptions ? 'Loading age groups...' : 'Select Age Group'} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAgeGroupsForSelectedCategory.map((ag) => (
                        <SelectItem key={ag} value={ag}>{ag}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedPodiumAgeGroup && (
                    <div className="bg-gradient-to-br from-yellow-500/20 to-orange-600/20 border-2 border-yellow-400/60 rounded-2xl px-4 py-2 mt-2">
                      <div className="text-sm font-semibold text-slate-900">Selected Age Group</div>
                      <div className="text-lg font-bold text-slate-900">{selectedPodiumAgeGroup}</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border rounded-lg p-4 space-y-4 bg-muted/20">
                <div>
                  <Label className="text-sm font-semibold">Manual Podium Entry (BIB-linked)</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Link athlete by BIB number and enter either overall time or individual leg times (SWIM, T1, BIKE, T2, RUN).
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>BIB Number</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g. 1204"
                        value={manualBibNumber}
                        onChange={(e) => setManualBibNumber(e.target.value)}
                        onBlur={handleResolveBib}
                      />
                      <Button type="button" variant="outline" onClick={handleResolveBib} disabled={isResolvingBib || !manualBibNumber.trim() || !selectedEventId}>
                        {isResolvingBib ? '...' : 'Fetch'}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Timing Mode</Label>
                    <Select value={manualTimingMode} onValueChange={(v) => setManualTimingMode(v as ManualTimingMode)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose timing mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="overall">Overall Time</SelectItem>
                        <SelectItem value="individual">Individual Legs (with T1 & T2)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Podium Position</Label>
                    <Select value={manualPodiumPosition} onValueChange={(v) => setManualPodiumPosition(v as ManualPodiumPosition)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select podium position" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Auto (by timing)</SelectItem>
                        <SelectItem value="winner">🥇 Winner</SelectItem>
                        <SelectItem value="first_runner_up">🥈 1st Runner-Up</SelectItem>
                        <SelectItem value="second_runner_up">🥉 2nd Runner-Up</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {manualTimingMode === 'overall' ? (
                  <div className="space-y-1">
                    <Label>Overall Time (HH:MM:SS)</Label>
                    <Input
                      placeholder="e.g. 04:42:18"
                      value={manualOverallTime}
                      onChange={(e) => setManualOverallTime(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div className="space-y-1"><Label>SWIM</Label><Input placeholder="HH:MM:SS" value={manualSwim} onChange={(e) => setManualSwim(e.target.value)} /></div>
                    <div className="space-y-1"><Label>T1</Label><Input placeholder="HH:MM:SS" value={manualT1} onChange={(e) => setManualT1(e.target.value)} /></div>
                    <div className="space-y-1"><Label>BIKE</Label><Input placeholder="HH:MM:SS" value={manualBike} onChange={(e) => setManualBike(e.target.value)} /></div>
                    <div className="space-y-1"><Label>T2</Label><Input placeholder="HH:MM:SS" value={manualT2} onChange={(e) => setManualT2(e.target.value)} /></div>
                    <div className="space-y-1"><Label>RUN</Label><Input placeholder="HH:MM:SS" value={manualRun} onChange={(e) => setManualRun(e.target.value)} /></div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>Athlete Name (only if BIB not found)</Label>
                    <Input
                      placeholder="Optional manual override"
                      value={manualAthleteName}
                      onChange={(e) => setManualAthleteName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Category (fallback)</Label>
                    <Input
                      placeholder={selectedPodiumCategory || 'e.g. Olympic Triathlon'}
                      value={manualCategory}
                      onChange={(e) => setManualCategory(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Age Group (fallback)</Label>
                    <Input
                      placeholder={selectedPodiumAgeGroup || 'e.g. 30-34'}
                      value={manualAgeGroup}
                      onChange={(e) => setManualAgeGroup(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSaveManualEntry} disabled={isSavingManualEntry || !selectedEventId}>
                    {isSavingManualEntry ? 'Saving...' : editingManualDocId ? 'Update Manual Timing' : 'Save Manual Timing'}
                  </Button>
                </div>
              </div>

              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Category Athletes (Auto Fetched + Manually Added)</Label>
                  {isLoadingManualAwards && <span className="text-xs text-muted-foreground">Loading...</span>}
                </div>

                {!isLoadingManualAwards && manualAwards.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No athletes found for selected category/age group.</p>
                ) : (
                  <div className="space-y-2 max-h-[260px] overflow-auto pr-1">
                    {manualAwards.map((entry, idx) => (
                      <div key={entry.docId} className={`rounded-md border p-3 ${activeManualDocId === entry.docId ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-sm">{entry.name} · BIB {entry.bibNumber}</div>
                            <div className="text-xs text-muted-foreground">
                              {entry.category} · {entry.ageGroup} · {entry.podiumPosition === 'winner' ? '🥇 Winner' : entry.podiumPosition === 'first_runner_up' ? '🥈 1st Runner-Up' : entry.podiumPosition === 'second_runner_up' ? '🥉 2nd Runner-Up' : `Auto Rank #${idx + 1}`}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {entry.timingMode === 'overall'
                                ? `Overall: ${entry.finishTime || entry.chipTime || 'N/A'}`
                                : `SWIM ${entry.swim || 'N/A'} · T1 ${entry.t1 || 'N/A'} · BIKE ${entry.bike || 'N/A'} · T2 ${entry.t2 || 'N/A'} · RUN ${entry.run || 'N/A'}`}
                            </div>
                            <div className="text-[11px] mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-muted-foreground">
                              {entry.sourceLabel || (entry.isManualEntry ? 'Manually Added' : 'Auto Fetched')}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="outline" onClick={() => handleShowNow(entry)}>
                              <Eye className="h-3.5 w-3.5 mr-1" /> Show Single
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleEditManualAward(entry)}>
                              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => handleDeleteManualAward(entry)}>
                              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>4. Podium Display Style</Label>
                  <Select value={podiumStyle} onValueChange={(v) => setPodiumStyle(v as PodiumStyle)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select display style" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sequential">Sequential Reveal (3rd → 2nd → 1st)</SelectItem>
                      <SelectItem value="full">Full Podium Display</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>5. Athlete Display Time</Label>
                  <Input
                    type="number"
                    min={2}
                    max={30}
                    step={1}
                    value={athleteDisplaySeconds}
                    onChange={(e) => setAthleteDisplaySeconds(Math.min(30, Math.max(2, Number(e.target.value) || 4)))}
                  />
                  <p className="text-xs text-muted-foreground">Admin controls how many seconds each athlete stays on screen during sequential reveal.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>6. Ceremony Controls</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={goToNextPodiumGroup} disabled={!selectedPodiumCategory || !selectedPodiumAgeGroup}>
                      Next Category
                    </Button>
                    <Button variant="default" onClick={handleShowTop3} disabled={!selectedPodiumCategory || !selectedPodiumAgeGroup}>
                      Show Top 3
                    </Button>
                    <Button variant="outline" onClick={handleReplayAnimation} disabled={!selectedPodiumCategory || !selectedPodiumAgeGroup}>
                      <TimerReset className="mr-2 h-4 w-4" /> Replay Animation
                    </Button>
                    <Button variant="default" onClick={handleShowSponsors} disabled={!selectedEventId}>
                      Show Sponsors
                    </Button>
                  </div>
                </div>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Podium screen auto-filters by selected event, race category, and age group. Winner is highlighted with cinematic reveal flow.
                </AlertDescription>
              </Alert>
            </TabsContent>
          </Tabs>

        
        <div className="flex items-center space-x-2">
          <Switch id="demo-mode" checked={isDemoMode} onCheckedChange={setIsDemoMode} />
          <Label htmlFor="demo-mode">Enable Demo Mode</Label>
        </div>
        <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
                {isDemoMode 
                    ? "Demo mode is ON. The generated link will show sample finisher data for testing the display."
                    : "Demo mode is OFF. The generated link will show real-time finisher data from the selected event."
                }
            </AlertDescription>
        </Alert>

        {selectedEventId && (
          <div className="rounded-xl border bg-muted/30 p-4 space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Activity className="h-4 w-4" />
                  Live tracing map
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Finish Line LED is mapped to the live-tracking hub and these API endpoints.
                </p>
              </div>
              <Badge variant={tracingSnapshot?.hasProviderState ? 'default' : 'secondary'}>
                {isLoadingTracing ? 'Loading' : tracingSnapshot?.hasProviderState ? 'Tracing live' : 'Tracing standby'}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg border bg-background p-3">
                <div className="text-muted-foreground uppercase tracking-wider">Provider</div>
                <div className="mt-1 font-semibold">{tracingSnapshot?.provider || 'feibot'}</div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <div className="text-muted-foreground uppercase tracking-wider">Source</div>
                <div className="mt-1 font-semibold">{tracingSnapshot?.configurationSource || 'cloud_api'}</div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <div className="text-muted-foreground uppercase tracking-wider">Participants</div>
                <div className="mt-1 font-semibold">{tracingSnapshot?.participantsImported ? 'Imported' : 'Pending'}</div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <div className="text-muted-foreground uppercase tracking-wider">Updated</div>
                <div className="mt-1 font-semibold">{tracingSnapshot?.providerStateUpdatedAt ? new Date(tracingSnapshot.providerStateUpdatedAt).toLocaleString() : '—'}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mapped endpoints</div>
              <div className="grid gap-2">
                {(tracingSnapshot?.endpoints || []).map((endpoint) => (
                  <div key={`${endpoint.method}-${endpoint.path}`} className="rounded-lg border bg-background p-3 text-xs">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 font-semibold">
                        <Badge variant="outline" className="font-mono text-[10px]">{endpoint.method}</Badge>
                        <span>{endpoint.label}</span>
                      </div>
                      <span className="text-muted-foreground break-all">{endpoint.path}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{endpoint.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {tracingSnapshot?.lastSuccessfulParticipantImport && (
              <div className="rounded-lg border border-dashed bg-background p-3 text-xs text-muted-foreground">
                Last participant import: {new Date(tracingSnapshot.lastSuccessfulParticipantImport).toLocaleString()}
              </div>
            )}
          </div>
        )}

        {generatedUrl && (
          <div className="space-y-2 pt-4 border-t">
            <Label className="font-medium">Use This Link</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input readOnly value={generatedUrl} />
              <Button onClick={copyToClipboard} variant="outline">
                <Copy className="mr-2 h-4 w-4" /> Copy Link
              </Button>
              <Button asChild>
                <a href={generatedUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" /> Open in New Tab
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              Open this link on the computer connected to the LED screen. Ensure it is in full-screen mode for the best experience.
            </p>
          </div>
        )}

        <div className="border-t pt-4 space-y-4">
          <div className="space-y-2">
            <div className="bg-gradient-to-r from-purple-500/20 to-pink-600/20 border-2 border-purple-400/60 rounded-2xl px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">7. Guest Management</div>
              <div className="text-xs text-slate-700 mt-1">Add guest names to welcome them on the LED screen</div>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Guest Name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddGuest()}
              />
              <Input
                placeholder="Designation (optional)"
                value={guestDesignation}
                onChange={(e) => setGuestDesignation(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddGuest()}
                className="max-w-xs"
              />
              <Button variant="outline" onClick={handleAddGuest} disabled={!guestName.trim()}>
                <PlusCircle className="mr-2 h-4 w-4" /> Add +1
              </Button>
            </div>
          </div>

          {guests.length > 0 && (
            <div className="space-y-2">
              <div className="bg-gradient-to-r from-emerald-500/20 to-teal-600/20 border-2 border-emerald-400/60 rounded-2xl px-4 py-2">
                <div className="text-sm font-semibold text-slate-900">Guests ({guests.length})</div>
              </div>
              <ScrollArea className="h-32 border rounded-md p-2">
                <div className="space-y-1">
                  {guests.map((guest, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                      <div>
                        <div className="font-medium">{guest.name}</div>
                        {guest.designation && <div className="text-xs text-muted-foreground">{guest.designation}</div>}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => handleRemoveGuest(idx)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <Button variant="default" onClick={handleShowGuests} disabled={!selectedEventId || guests.length === 0} className="w-full">
                Show Guests on LED
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
