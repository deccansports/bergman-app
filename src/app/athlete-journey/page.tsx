"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Maximize2, Minimize2 } from 'lucide-react';
import type { ResolvedTimingConfiguration } from '@/lib/timingConfiguration';

type JourneyMode = 'pre' | 'post';

type JourneyData = {
  branding: {
    eventName: string;
    logoUrl: string;
    sponsors: Array<{ id: string; name: string; logoUrl: string; order?: number }>;
  };
  athlete: {
    name: string;
    bibNumber: string;
    raceCategory: string;
    clubName: string;
    clubAthletesRacing: number;
  };
  preRace: {
    eventName: string;
    triVector: { swimKm: number; bikeKm: number; runKm: number };
    countdownDays: number | null;
    emotionalLine: string;
    bel: { status: 'Active' | 'Returning' | 'New Athlete'; totalRacesCompleted: number; currentSeasonRanking: number | null };
    legacyRecognition: string;
    smartMessage: string;
  };
  postRace: {
    status: string;
    finishHero: string;
    timingBreakdown: { swim: string | null; t1: string | null; bike: string | null; t2: string | null; run: string | null; chipTime: string | null };
    comparison: { previousTime: string | null; currentTime: string | null; improvement: string; personalBest: string | null };
    ranks: { categoryRank: number | string | null; genderRank: number | string | null; overallRank: number | string | null };
    evolutionInsight: string;
    emotionalMessage: string;
  };
  history: Array<{ eventName: string; year: number | null; category: string; finishTime: string | null; position: number | string | null; status: string }>;
};

export default function AthleteJourneyPage() {
  const hiddenNotFoundMessage = 'Athlete not found for this BIB in selected event.';
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<JourneyMode>('pre');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [bibNumber, setBibNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [timingConfiguration, setTimingConfiguration] = useState<ResolvedTimingConfiguration | null>(null);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const hasAutoSearchedFromQuery = useRef(false);

  useEffect(() => {
    const queryEvent = String(searchParams.get('eventId') || '');
    const queryBib = String(searchParams.get('bib') || searchParams.get('bibNumber') || '');
    const queryMode = String(searchParams.get('mode') || '').toLowerCase();
    const forcedModeFromPath: JourneyMode | null = pathname.endsWith('/result') ? 'post' : pathname.endsWith('/race') ? 'pre' : null;

    if (queryEvent) setSelectedEventId(queryEvent);
    if (queryBib) setBibNumber(queryBib);
    if (forcedModeFromPath) {
      setMode(forcedModeFromPath);
    } else if (queryMode === 'post' || queryMode === 'pre') {
      setMode(queryMode as JourneyMode);
    }
  }, [searchParams, pathname]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsBrowserFullscreen(Boolean(document.fullscreenElement));
    };

    onFullscreenChange();
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const handleView = useCallback(async () => {
    if (!selectedEventId || !bibNumber.trim()) return;
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/athlete-journey?eventId=${encodeURIComponent(selectedEventId)}&bibNumber=${encodeURIComponent(bibNumber.trim())}`);
      const data = await res.json();
      if (!data?.success || !data?.data) {
        const apiMessage = String(data?.message || 'No athlete record found for this BIB.');
        setJourney(null);
        setError(apiMessage === hiddenNotFoundMessage ? '' : apiMessage);
        return;
      }
      setJourney(data.data as JourneyData);
    } catch {
      setJourney(null);
      setError('Failed to load athlete dashboard.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedEventId, bibNumber]);

  useEffect(() => {
    const loadTimingConfiguration = async () => {
      if (!selectedEventId) return;
      try {
        const res = await fetch(`/api/live/course-index/${encodeURIComponent(selectedEventId)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) {
          const timingPayload = data?.timingConfiguration || data?.courseIndex || data;
          const contestIndex = timingPayload?.contestIndex && typeof timingPayload.contestIndex === 'object' ? timingPayload.contestIndex : {};
          setTimingConfiguration({
            eventId: data.eventId || selectedEventId,
            source: timingPayload.source || data.source,
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
            importedAt: timingPayload.importedAt || null,
            provider: timingPayload.provider || null,
          });
        }
      } catch {
        setTimingConfiguration(null);
      }
    };

    void loadTimingConfiguration();
  }, [selectedEventId]);

  useEffect(() => {
    if (hasAutoSearchedFromQuery.current) return;

    const queryEvent = String(searchParams.get('eventId') || '').trim();
    const queryBib = String(searchParams.get('bib') || searchParams.get('bibNumber') || '').trim();
    if (!queryEvent || !queryBib) return;
    if (!selectedEventId || !bibNumber.trim()) return;
    if (selectedEventId !== queryEvent || bibNumber.trim() !== queryBib) return;

    hasAutoSearchedFromQuery.current = true;
    void handleView();
  }, [searchParams, selectedEventId, bibNumber, handleView]);

  const belBadgeClass = useMemo(() => {
    if (!journey) return 'bg-slate-100 text-slate-700';
    if (journey.preRace.bel.status === 'Active') return 'bg-emerald-100 text-emerald-800';
    if (journey.preRace.bel.status === 'Returning') return 'bg-yellow-100 text-yellow-800';
    return 'bg-rose-100 text-rose-800';
  }, [journey]);

  const belTier = useMemo(() => {
    const rank = journey?.preRace?.bel?.currentSeasonRanking;
    const racesCompleted = Number(journey?.preRace?.bel?.totalRacesCompleted || 0);
    if (rank === null || rank === undefined || Number(rank) <= 0) {
      return racesCompleted > 0 ? 'Provisional' : 'No Tier';
    }
    const numericRank = Number(rank);
    if (numericRank <= 3) return 'Gold';
    if (numericRank <= 8) return 'Silver';
    if (numericRank <= 18) return 'Bronze';
    return racesCompleted > 0 ? 'Provisional' : 'No Tier';
  }, [journey]);

  const belTierClass = useMemo(() => {
    if (belTier === 'Gold') return 'bg-amber-400/20 text-amber-200 border-amber-300/40';
    if (belTier === 'Silver') return 'bg-slate-300/20 text-slate-200 border-slate-300/40';
    if (belTier === 'Bronze') return 'bg-orange-400/20 text-orange-200 border-orange-300/40';
    if (belTier === 'Provisional') return 'bg-violet-400/20 text-violet-200 border-violet-300/40';
    return 'bg-slate-700/40 text-slate-200 border-slate-500/40';
  }, [belTier]);

  const belProgressInfo = useMemo(() => {
    const racesCompleted = Number(journey?.preRace?.bel?.totalRacesCompleted || 0);
    const rank = Number(journey?.preRace?.bel?.currentSeasonRanking || 0);
    const validRank = rank > 0 ? rank : null;

    const toBronze = validRank ? Math.max(rank - 18, 0) : null;
    const toSilver = validRank ? Math.max(rank - 8, 0) : null;
    const toGold = validRank ? Math.max(rank - 3, 0) : null;
    const finishesNeeded = Math.max(2 - racesCompleted, 0);

    const nextTarget = finishesNeeded > 0
      ? `Complete ${finishesNeeded} more finish${finishesNeeded > 1 ? 'es' : ''} to unlock final BEL tiering.`
      : belTier === 'Gold'
      ? 'You are in Gold tier. Maintain top-3 ranking to retain elite status.'
      : belTier === 'Silver'
      ? `Reach rank 3 for Gold (${toGold} position${toGold === 1 ? '' : 's'} up).`
      : belTier === 'Bronze'
      ? `Reach rank 8 for Silver (${toSilver} position${toSilver === 1 ? '' : 's'} up).`
      : validRank
      ? `Reach rank 18 for Bronze (${toBronze} position${toBronze === 1 ? '' : 's'} up).`
      : 'Get an official ranking to start BEL tier progression.';

    const benefits = [
      'Provisional BEL reward discount: 5%.',
      'After 2 completed finishes, you become eligible for final tier placement.',
      'Tier movement uses season ranking: Bronze (≤18), Silver (≤8), Gold (≤3).',
    ];

    return { nextTarget, benefits };
  }, [journey, belTier]);

  const belTierProgress = useMemo(() => {
    const racesCompleted = Number(journey?.preRace?.bel?.totalRacesCompleted || 0);
    const rankRaw = Number(journey?.preRace?.bel?.currentSeasonRanking || 0);
    const validRank = rankRaw > 0 ? rankRaw : null;
    const finishesNeeded = Math.max(2 - racesCompleted, 0);
    const eligibleForFinalTier = finishesNeeded === 0;
    const finishProgressPercent = Math.max(0, Math.min((racesCompleted / 2) * 100, 100));

    const computeRankProgress = (targetRank: number) => {
      if (!validRank) return 0;
      if (validRank <= targetRank) return 100;
      return Math.max(0, Math.min((targetRank / validRank) * 100, 99));
    };

    const tiers = [
      { name: 'Bronze', targetRank: 18, barClass: 'from-orange-500/90 to-amber-400/90', textClass: 'text-orange-200' },
      { name: 'Silver', targetRank: 8, barClass: 'from-slate-300/90 to-zinc-100/90', textClass: 'text-slate-100' },
      { name: 'Gold', targetRank: 3, barClass: 'from-amber-400/90 to-yellow-200/90', textClass: 'text-amber-100' },
    ].map((tier) => {
      const positionsUp = validRank ? Math.max(validRank - tier.targetRank, 0) : null;
      const achieved = Boolean(validRank && validRank <= tier.targetRank);
      const progress = achieved ? 100 : computeRankProgress(tier.targetRank);
      const detail = !eligibleForFinalTier
        ? `Locked until ${finishesNeeded} more finish${finishesNeeded === 1 ? '' : 'es'} (minimum 2).`
        : !validRank
        ? 'Waiting for official season ranking.'
        : achieved
        ? `Achieved at rank ${validRank}.`
        : `${positionsUp} position${positionsUp === 1 ? '' : 's'} to move up (target rank ≤ ${tier.targetRank}).`;

      return {
        ...tier,
        achieved,
        progress,
        detail,
      };
    });

    return {
      racesCompleted,
      finishesNeeded,
      eligibleForFinalTier,
      finishProgressPercent,
      validRank,
      tiers,
    };
  }, [journey]);

  const pageTitle = mode === 'pre' ? 'My Race Dashboard' : 'My Finish Result';
  const isScreenMode = useMemo(() => {
    const raw = String(searchParams.get('screen') || searchParams.get('kiosk') || searchParams.get('presentation') || '').toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }, [searchParams]);

  const toggleBrowserFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // no-op: browser may block fullscreen if not triggered by user interaction
    }
  }, []);

  const toggleScreenMode = useCallback((enabled: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (enabled) params.set('screen', '1');
    else params.delete('screen');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  const parseFinishTimeToSeconds = useCallback((value: string | null | undefined) => {
    if (!value) return null;
    const normalized = String(value).trim().toUpperCase();
    if (!normalized || normalized === 'DNS' || normalized === 'DNF' || normalized === 'DSQ') return null;

    const parts = normalized.split(':').map((p) => Number(p));
    if (parts.some((p) => Number.isNaN(p))) return null;

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return null;
  }, []);

  const formatSecondsAsHms = useCallback((seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, []);

  const chartPoints = useMemo(() => {
    if (!journey?.history?.length) return [] as Array<{
      x: number;
      y: number;
      yearLabel: string;
      finishLabel: string;
      rankLabel: string;
      eventName: string;
      seconds: number;
    }>;

    const usable = journey.history
      .map((h) => ({
        year: h.year ?? 0,
        eventName: h.eventName,
        finish: h.finishTime,
        position: h.position,
        seconds: parseFinishTimeToSeconds(h.finishTime),
      }))
      .filter((h) => h.seconds !== null)
      .sort((a, b) => a.year - b.year) as Array<{
      year: number;
      eventName: string;
      finish: string | null;
      position: number | string | null;
      seconds: number;
    }>;

    if (usable.length === 0) return [];

    const minSec = Math.min(...usable.map((u) => u.seconds));
    const maxSec = Math.max(...usable.map((u) => u.seconds));
    const range = Math.max(maxSec - minSec, 1);

    return usable.map((item, idx) => {
      const x = usable.length === 1 ? 50 : (idx / (usable.length - 1)) * 100;
      const y = 12 + ((item.seconds - minSec) / range) * 76;
      return {
        x,
        y,
        yearLabel: item.year ? String(item.year) : '—',
        finishLabel: item.finish || formatSecondsAsHms(item.seconds),
        rankLabel: item.position !== null && item.position !== undefined ? String(item.position) : '—',
        eventName: item.eventName,
        seconds: item.seconds,
      };
    });
  }, [journey, parseFinishTimeToSeconds, formatSecondsAsHms]);

  const chartPolyline = useMemo(() => chartPoints.map((p) => `${p.x},${p.y}`).join(' '), [chartPoints]);
  const chartAreaPath = useMemo(() => {
    if (chartPoints.length < 2) return '';
    const first = chartPoints[0];
    const last = chartPoints[chartPoints.length - 1];
    return `M ${first.x} 88 L ${chartPolyline} L ${last.x} 88 Z`;
  }, [chartPoints, chartPolyline]);

  const sponsorTicker = journey?.branding?.sponsors || [];
  const raceDistanceCompact = journey
    ? (timingConfiguration?.timingPoints?.length
        ? `${timingConfiguration.timingPoints.length} timing points`
        : `${journey.preRace.triVector.swimKm}/${journey.preRace.triVector.bikeKm}/${journey.preRace.triVector.runKm}`)
    : '';
  const hasTimingData = useMemo(() => {
    if (!journey) return false;
    const t = journey.postRace.timingBreakdown;
    return Boolean(t.swim || t.t1 || t.bike || t.t2 || t.run || t.chipTime);
  }, [journey]);
  const effectivePostStatus = useMemo(() => {
    if (!journey) return '';
    return hasTimingData ? journey.postRace.status : 'DNS';
  }, [journey, hasTimingData]);
  const isPostFinisher = useMemo(() => {
    return String(effectivePostStatus || '').toLowerCase() === 'finisher';
  }, [effectivePostStatus]);

  const timingPointLabels = useMemo(() => {
    const points = timingConfiguration?.timingPoints || [];
    return points
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((point) => point.displayName || point.providerCode || point.id)
      .filter(Boolean);
  }, [timingConfiguration]);

  return (
    <div className="h-screen w-full overflow-hidden bg-gradient-to-br from-slate-950 via-[#041228] to-slate-950 text-left text-white">
      <div className="h-full mx-auto max-w-[1920px] px-3 py-2 flex flex-col gap-2">
        <div className="rounded-2xl border border-cyan-400/40 bg-gradient-to-r from-[#0a1730] via-[#0f2b56] to-[#0a1730] p-3 shadow-[0_0_30px_rgba(34,211,238,0.18)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg md:text-2xl font-black tracking-tight">Athlete Journey Engine</h1>
              <p className="text-[10px] md:text-xs text-slate-200 uppercase tracking-widest">DATA + EMOTION + IDENTITY</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={journey?.branding?.logoUrl || '/Bmlogowhite.png'}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/Bmlogowhite.png';
              }}
              alt="Event logo"
              className="h-8 md:h-12 w-auto object-contain"
            />
          </div>
        </div>

        <Card className="border-cyan-400/40 bg-gradient-to-r from-slate-900/95 to-[#0c1f3e]/90 shadow-[0_0_20px_rgba(34,211,238,0.12)]">
          <CardContent className="py-1.5">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-slate-200 text-[11px]">BIB Number</Label>
                <Input value={bibNumber} onChange={(e) => setBibNumber(e.target.value)} placeholder="e.g. 1204" className="h-8 bg-slate-800/90 border-cyan-500/40 text-white placeholder:text-slate-400" />
              </div>
              <div className="flex items-end gap-2 flex-wrap justify-end">
                <Button onClick={() => void handleView()} disabled={!selectedEventId || !bibNumber.trim() || isLoading} className="h-8 px-3 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-black font-black shadow-lg shadow-cyan-500/30">
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                </Button>
                {!isScreenMode ? (
                  <Button onClick={() => toggleScreenMode(true)} variant="outline" className="h-8 border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/10">
                    Enter Screen Mode
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => toggleScreenMode(false)}
                      variant="outline"
                      className="h-8 px-3 border-white/90 bg-white text-sky-400 hover:bg-slate-100 hover:text-sky-500 font-semibold"
                    >
                      Exit Screen Mode
                    </Button>
                    <Button onClick={() => void toggleBrowserFullscreen()} className="h-8 px-3 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-black font-black shadow-lg shadow-cyan-500/30">
                      {isBrowserFullscreen ? <Minimize2 className="h-4 w-4 mr-1" /> : <Maximize2 className="h-4 w-4 mr-1" />}
                      {isBrowserFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                    </Button>
                  </>
                )}
              </div>
            </div>
            {!isScreenMode ? <p className="text-[11px] text-slate-300 mt-1">{pageTitle} · Event is controlled by admin link.</p> : null}
            {!selectedEventId ? <p className="text-xs text-amber-300 mt-1">Missing eventId in URL. Open using admin-generated link.</p> : null}
            {error && error !== hiddenNotFoundMessage ? <p className="text-sm text-rose-300 mt-1">{error}</p> : null}
          </CardContent>
        </Card>

        <div className="flex-1 min-h-0 overflow-hidden">
          {!journey && !isLoading ? (
            <Card className="h-full border-cyan-400/30 bg-slate-900/70">
              <CardContent className="h-full flex items-center justify-center text-center text-slate-300">Enter your BIB to unlock your athlete journey.</CardContent>
            </Card>
          ) : null}

          {journey ? (
            <div className={`${mode === 'pre' ? 'grid grid-cols-1 xl:grid-cols-[2.2fr_1fr] gap-2 items-start' : 'h-full grid grid-cols-1 xl:grid-cols-[2.2fr_1fr] gap-2'}`}>
              <div className="min-h-0 overflow-hidden space-y-2 pr-1">
                <Card className="h-[170px] border-cyan-300/40 bg-gradient-to-r from-[#0d1d3d] via-[#1f3f70] to-[#0d1d3d] shadow-[0_0_35px_rgba(59,130,246,0.18)]">
                  <CardHeader className="pb-2 pt-3">
                    <CardTitle className="text-xl md:text-3xl font-black text-white truncate">{journey.athlete.name}</CardTitle>
                    <CardDescription className="text-slate-200 text-xs md:text-sm">{journey.athlete.raceCategory} · {raceDistanceCompact}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2 pt-0 pb-3">
                    <Badge className="bg-gradient-to-r from-indigo-950 to-slate-900 border border-cyan-400/40 text-white text-sm md:text-base px-3 py-1.5 shadow-md">🏁 Racing for: {journey.athlete.clubName}</Badge>
                    <Badge className="bg-gradient-to-r from-cyan-700 to-blue-700 text-white text-sm md:text-base px-3 py-1.5 shadow-md">👥 Club Athletes Racing: {journey.athlete.clubAthletesRacing}</Badge>
                  </CardContent>
                </Card>

                {mode === 'pre' ? (
                  <div className="space-y-2 min-h-0">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 min-h-0">
                      <Card className="h-full border-cyan-300/40 bg-gradient-to-br from-slate-900 to-[#112747] text-white">
                        <CardHeader className="pb-1 pt-3"><CardTitle className="text-sm text-cyan-300">RACE CATEGORY</CardTitle></CardHeader>
                        <CardContent className="pt-0 pb-3 flex flex-col gap-2">
                          <div className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 p-3">
                            <div className="text-base md:text-xl font-black text-cyan-100 leading-tight break-words">{journey.athlete.raceCategory}</div>
                          </div>
                          <div className="rounded-xl border border-cyan-400/30 bg-slate-800/70 p-2.5 md:p-3 mt-auto">
                            <div className="text-[10px] uppercase tracking-widest text-cyan-300 mb-1.5">Distance</div>
                            {timingPointLabels.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {timingPointLabels.slice(0, 10).map((label, index) => (
                                  <span key={`${label}-${index}`} className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] md:text-xs font-bold text-cyan-100">
                                    {label}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] md:text-xs font-bold text-cyan-100">{journey.preRace.triVector.swimKm}K Swim</span>
                                <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] md:text-xs font-bold text-cyan-100">{journey.preRace.triVector.bikeKm}K Bike</span>
                                <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] md:text-xs font-bold text-cyan-100">{journey.preRace.triVector.runKm}K Run</span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="h-full bg-gradient-to-br from-[#1d1b4b] via-[#0f2f58] to-[#1b4332] text-white border-cyan-400/40">
                        <CardContent className="h-full py-3 text-center space-y-1.5 flex flex-col justify-center">
                          <div className="text-lg md:text-2xl font-black tracking-wide">I AM RACING BERGMAN</div>
                          <div className="text-[40px] md:text-[40px] leading-none font-black uppercase tracking-wider text-orange-600 drop-shadow-[0_0_14px_rgba(194,65,12,0.9)]">BIB {journey.athlete.bibNumber}</div>
                        </CardContent>
                      </Card>
                    </div>

                    <Card className="h-[280px] flex flex-col border-cyan-400/40 bg-gradient-to-br from-slate-900 to-[#10233f] text-white">
                      <CardHeader className="pb-1 pt-3"><CardTitle className="text-sm text-cyan-300">History / Comparison</CardTitle></CardHeader>
                      <CardContent className="flex-1 min-h-0 overflow-hidden pb-3">
                        <div className="h-full grid grid-cols-1 xl:grid-cols-[1.45fr_1fr] gap-2">
                          <div className="h-full rounded-lg border border-slate-700/80 bg-slate-900/50 p-2">
                            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-cyan-300">Past Races</div>
                            {journey.history.length === 0 ? (
                              <p className="text-xs text-slate-300">No prior race history yet.</p>
                            ) : (
                              <div className="flex gap-2 overflow-x-auto pb-1">
                                {journey.history.slice(0, 8).map((h, idx) => (
                                  <div key={`${h.eventName}-${idx}`} className="min-w-[240px] rounded-lg border border-slate-700 bg-slate-900/80 p-2">
                                    <div className="font-semibold text-white text-xs truncate">{h.eventName} {h.year ? `(${h.year})` : ''}</div>
                                    <div className="text-[11px] text-slate-300 truncate">{h.category}</div>
                                    <div className="text-[11px] text-slate-300">{h.finishTime || h.status} · Pos: {h.position || '—'}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="h-full rounded-lg border border-cyan-400/30 bg-slate-900/70 p-2.5">
                            <div className="mb-1.5 flex items-center justify-between">
                              <span className="text-[11px] uppercase tracking-widest text-cyan-300">Progress Graph</span>
                              <span className="text-[11px] text-slate-400">Past Events</span>
                            </div>

                            {chartPoints.length >= 2 ? (
                              <div className="space-y-1.5">
                                <svg viewBox="0 0 100 100" className="w-full h-32">
                                  <defs>
                                    <linearGradient id="raceLineGradient" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse">
                                      <stop offset="0%" stopColor="rgba(14,165,233,1)" />
                                      <stop offset="50%" stopColor="rgba(34,211,238,1)" />
                                      <stop offset="100%" stopColor="rgba(56,189,248,1)" />
                                    </linearGradient>
                                    <linearGradient id="raceAreaGradient" x1="0" y1="12" x2="0" y2="88" gradientUnits="userSpaceOnUse">
                                      <stop offset="0%" stopColor="rgba(34,211,238,0.28)" />
                                      <stop offset="100%" stopColor="rgba(34,211,238,0.03)" />
                                    </linearGradient>
                                    <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
                                      <feGaussianBlur stdDeviation="1.2" result="blur" />
                                      <feMerge>
                                        <feMergeNode in="blur" />
                                        <feMergeNode in="SourceGraphic" />
                                      </feMerge>
                                    </filter>
                                  </defs>

                                  {[24, 40, 56, 72, 88].map((y) => (
                                    <line key={`grid-${y}`} x1="0" y1={y} x2="100" y2={y} stroke="rgba(148,163,184,0.18)" strokeWidth="0.6" strokeDasharray="1.8 1.8" />
                                  ))}

                                  <line x1="0" y1="88" x2="100" y2="88" stroke="rgba(148,163,184,0.35)" strokeWidth="0.8" />
                                  <line x1="0" y1="12" x2="100" y2="12" stroke="rgba(148,163,184,0.2)" strokeWidth="0.8" />

                                  <path d={chartAreaPath} fill="url(#raceAreaGradient)" />
                                  <polyline
                                    fill="none"
                                    stroke="url(#raceLineGradient)"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    points={chartPolyline}
                                    filter="url(#lineGlow)"
                                  />

                                  {chartPoints.map((p, idx) => (
                                    <g key={`${p.yearLabel}-${idx}`}>
                                      <circle cx={p.x} cy={p.y} r="3" fill="rgba(6,182,212,0.25)" />
                                      <circle cx={p.x} cy={p.y} r="1.8" fill="rgba(125,211,252,1)" stroke="rgba(34,211,238,1)" strokeWidth="0.5" />
                                      <text x={p.x} y={95} textAnchor="middle" fill="rgba(186,230,253,0.95)" fontSize="4.2">{p.yearLabel}</text>
                                    </g>
                                  ))}
                                </svg>
                                <div className="grid grid-cols-1 gap-1">
                                  {chartPoints.map((p, idx) => (
                                    <div key={`legend-pre-${p.yearLabel}-${idx}`} className="text-[11px] text-slate-300 truncate">
                                      <span className="inline-flex items-center rounded-full bg-cyan-500/15 border border-cyan-400/30 px-1.5 py-0.5 mr-1.5 text-cyan-300 font-semibold">{p.yearLabel}</span>
                                      {p.finishLabel} · Pos: {p.rankLabel}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400">Graph appears after at least 2 timed race results.</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <div className="space-y-2 min-h-0 overflow-hidden">
                    <Card className="bg-gradient-to-r from-[#052e16] via-[#14532d] to-[#052e16] border border-emerald-300/40 text-white shadow-[0_0_25px_rgba(16,185,129,0.2)]">
                      <CardContent className="py-3 text-center space-y-1.5">
                        {isPostFinisher ? (
                          <>
                            <Badge variant="default">✅ Finisher</Badge>
                            <div className="text-lg md:text-2xl font-black tracking-wide">🏁 YOU ARE A FINISHER</div>
                          </>
                        ) : (
                          <>
                            <Badge variant="destructive">{effectivePostStatus || 'STATUS'}</Badge>
                            <div className="text-lg md:text-2xl font-black tracking-wide">🏁 {effectivePostStatus || 'RACE STATUS'}</div>
                          </>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="border-cyan-300/50 bg-gradient-to-br from-[#061326] via-[#0b2142] to-[#123764] text-white shadow-[0_0_30px_rgba(34,211,238,0.2)]">
                      <CardHeader className="pb-1 pt-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm md:text-base font-black tracking-wide text-cyan-100">Timing Breakdown</CardTitle>
                          {!hasTimingData ? <Badge className="bg-amber-400/20 text-amber-200 border border-amber-300/40">Provisional</Badge> : null}
                        </div>
                        <CardDescription className="text-cyan-100/80 text-[11px]">Race splits and official chip timing</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2 pb-3">
                        {timingPointLabels.length > 0 ? (
                          <div className="rounded-xl border border-cyan-300/20 bg-white/5 p-2.5">
                            <div className="text-[11px] uppercase tracking-widest text-cyan-200/80 mb-1">Timing Configuration</div>
                            <div className="flex flex-wrap gap-1.5">
                              {timingPointLabels.map((label, index) => (
                                <span key={`tp-${index}-${label}`} className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold text-cyan-100">
                                  {label}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                          <div className="rounded-xl border border-cyan-300/30 bg-white/10 p-2.5 backdrop-blur-sm"><div className="text-[11px] uppercase tracking-widest text-cyan-200/80">Swim</div><div className="mt-0.5 text-base font-black">{journey.postRace.timingBreakdown.swim || '—'}</div></div>
                          <div className="rounded-xl border border-cyan-300/30 bg-white/10 p-2.5 backdrop-blur-sm"><div className="text-[11px] uppercase tracking-widest text-cyan-200/80">T1</div><div className="mt-0.5 text-base font-black">{journey.postRace.timingBreakdown.t1 || '—'}</div></div>
                          <div className="rounded-xl border border-cyan-300/30 bg-white/10 p-2.5 backdrop-blur-sm"><div className="text-[11px] uppercase tracking-widest text-cyan-200/80">Bike</div><div className="mt-0.5 text-base font-black">{journey.postRace.timingBreakdown.bike || '—'}</div></div>
                          <div className="rounded-xl border border-cyan-300/30 bg-white/10 p-2.5 backdrop-blur-sm"><div className="text-[11px] uppercase tracking-widest text-cyan-200/80">T2</div><div className="mt-0.5 text-base font-black">{journey.postRace.timingBreakdown.t2 || '—'}</div></div>
                          <div className="rounded-xl border border-cyan-300/30 bg-white/10 p-2.5 backdrop-blur-sm"><div className="text-[11px] uppercase tracking-widest text-cyan-200/80">Run</div><div className="mt-0.5 text-base font-black">{journey.postRace.timingBreakdown.run || '—'}</div></div>
                          <div className="rounded-xl border border-cyan-300/50 bg-gradient-to-br from-cyan-500/30 to-blue-500/30 p-2.5"><div className="text-[11px] uppercase tracking-widest text-cyan-100">Chip Time</div><div className="mt-0.5 text-base font-black text-white">{journey.postRace.timingBreakdown.chipTime || '—'}</div></div>
                        </div>
                        {!hasTimingData ? <div className="rounded-xl border border-amber-300/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100">These are not final results. Official results will be published after verification.</div> : null}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>

              <div
                className={`${mode === 'pre' ? 'min-h-0 overflow-hidden self-start xl:h-[650px]' : 'min-h-0 overflow-hidden space-y-2 self-start'}`}
              >
                <Card className={`${mode === 'pre' ? 'h-full flex flex-col' : 'min-h-[250px]'} border-cyan-400/40 bg-gradient-to-br from-slate-900 to-[#0f2444] text-white`}>
                  <CardHeader className="pb-1 pt-3"><CardTitle className="text-sm text-cyan-300">BEL Status</CardTitle></CardHeader>
                  <CardContent className="pb-2">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-center">
                      <div className="space-y-1 text-xs text-slate-100 leading-tight">
                        <Badge className={belBadgeClass}>{journey.preRace.bel.status}</Badge>
                        <p>Total races completed: <strong>{journey.preRace.bel.totalRacesCompleted}</strong></p>
                        <p>Current season ranking: <strong>{journey.preRace.bel.currentSeasonRanking ?? 'N/A'}</strong></p>
                      </div>
                      <div className="rounded-lg border border-cyan-300/40 bg-cyan-500/10 px-3 py-2 text-center min-w-[150px]">
                        <span className="text-[10px] uppercase tracking-widest text-cyan-200">BEL Tier</span>
                        <div><Badge className={`mt-1.5 border text-sm md:text-base px-3 py-1 font-black tracking-wide ${belTierClass}`}>{belTier}</Badge></div>
                      </div>
                    </div>

                    <div className="mt-2 rounded-lg border border-cyan-400/25 bg-cyan-500/10 p-2">
                      <div className="text-[10px] uppercase tracking-widest text-cyan-200 mb-1">BEL Progress Path</div>
                      <p className="text-[11px] text-slate-100 mb-1.5 leading-tight">{belProgressInfo.nextTarget}</p>
                      <ul className="space-y-0.5">
                        {belProgressInfo.benefits.map((benefit, idx) => (
                          <li key={`bel-benefit-${idx}`} className="text-[10px] text-slate-200 leading-tight">• {benefit}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-2 rounded-lg border border-cyan-400/25 bg-slate-900/60 p-2 space-y-1.5">
                      <div className="text-[10px] uppercase tracking-widest text-cyan-200">Tier Progress Tracker</div>

                      <div className="rounded-md border border-violet-300/30 bg-violet-500/10 p-1.5">
                        <div className="flex items-center justify-between gap-2 text-[10px] text-violet-100 leading-tight">
                          <span>Final tier eligibility (2 finishes required)</span>
                          <span className="font-semibold">{belTierProgress.racesCompleted}/2</span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-700/70">
                          <div
                            className="h-full bg-gradient-to-r from-violet-400 to-fuchsia-300 transition-all duration-500"
                            style={{ width: `${belTierProgress.finishProgressPercent}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-violet-100/90 leading-tight">
                          {belTierProgress.eligibleForFinalTier
                            ? 'Eligible for final tier placement.'
                            : `${belTierProgress.finishesNeeded} more finish${belTierProgress.finishesNeeded === 1 ? '' : 'es'} needed to unlock final tiering.`}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        {belTierProgress.tiers.map((tier) => (
                          <div key={`tier-progress-${tier.name}`} className="rounded-md border border-cyan-400/20 bg-slate-800/60 p-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-[11px] font-semibold ${tier.textClass}`}>{tier.name}</span>
                              <span className="text-[10px] text-slate-300">Target rank ≤ {tier.targetRank}</span>
                            </div>

                            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-700/80">
                              <div
                                className={`h-full bg-gradient-to-r ${tier.barClass} transition-all duration-500`}
                                style={{ width: `${tier.progress}%` }}
                              />
                            </div>

                            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] leading-tight">
                              <span className="text-slate-300">Progress: {Math.round(tier.progress)}%</span>
                              <span className={tier.achieved ? 'text-emerald-300' : 'text-slate-300'}>{tier.achieved ? 'Achieved' : 'In progress'}</span>
                            </div>
                            <p className="mt-0.5 text-[10px] text-slate-200 leading-tight">{tier.detail}</p>
                          </div>
                        ))}
                      </div>

                      <p className="text-[10px] text-slate-400 leading-tight">
                        Current ranking: <strong>{belTierProgress.validRank ?? 'Pending'}</strong> · Lower rank number means better placement.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {mode === 'post' ? (
                  <Card className="border-cyan-400/40 bg-gradient-to-br from-slate-900 to-[#10233f] text-white">
                    <CardHeader className="pb-1 pt-3"><CardTitle className="text-sm text-cyan-300">History / Comparison</CardTitle></CardHeader>
                    <CardContent className="space-y-1.5 text-xs md:text-sm text-slate-100 overflow-hidden pb-3">
                      <p>Previous: <strong>{journey.postRace.comparison.previousTime || '—'}</strong></p>
                      <p>Current: <strong>{journey.postRace.comparison.currentTime || '—'}</strong></p>
                      <p>Improvement: <strong>{journey.postRace.comparison.improvement}</strong></p>
                      <p>PB: <strong>{journey.postRace.comparison.personalBest || 'N/A'}</strong></p>
                      <p>Category Rank: <strong>{journey.postRace.ranks.categoryRank || '—'}</strong></p>
                      <p>Gender Rank: <strong>{journey.postRace.ranks.genderRank || '—'}</strong></p>
                      <p>Overall Rank: <strong>{journey.postRace.ranks.overallRank || '—'}</strong></p>
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className={`relative overflow-hidden rounded-xl border border-cyan-400/30 bg-slate-950/95 text-white ${isScreenMode ? 'py-5 md:py-6' : 'py-4 md:py-5'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/apple-touch-icon.png" alt="Left logo" className={`absolute left-3 top-1/2 -translate-y-1/2 object-contain z-20 ${isScreenMode ? 'h-14 w-14 md:h-16 md:w-16' : 'h-10 w-10 md:h-12 md:w-12'}`} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/swimbikerun.png" alt="Right logo" className={`absolute right-3 top-1/2 -translate-y-1/2 w-auto object-contain z-20 ${isScreenMode ? 'h-14 md:h-16' : 'h-10 md:h-12'}`} />
            <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-slate-950 to-transparent z-10" />
            <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-slate-950 to-transparent z-10" />

            {sponsorTicker.length > 0 ? (
              <div className={`animate-[marquee_28s_linear_infinite] whitespace-nowrap flex items-center ${isScreenMode ? 'gap-10 px-28 md:px-32' : 'gap-8 px-24 md:px-28'}`}>
                {[...sponsorTicker, ...sponsorTicker].map((sponsor, idx) => (
                  <div key={`${sponsor.id}-${idx}`} className={`inline-flex items-center rounded-full border border-yellow-400/40 bg-white/5 ${isScreenMode ? 'gap-4 px-5 py-3.5' : 'gap-3 px-4 py-2.5'}`}>
                    {sponsor.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sponsor.logoUrl} alt={sponsor.name || 'Sponsor'} className={`w-auto object-contain ${isScreenMode ? 'h-10 md:h-12' : 'h-8 md:h-9'}`} />
                    ) : null}
                    <span className={`${isScreenMode ? 'text-base md:text-lg' : 'text-sm md:text-base'} font-semibold tracking-wide`}>{sponsor.name || 'Sponsor'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center text-slate-300 ${isScreenMode ? 'text-base md:text-lg px-28 md:px-32' : 'text-sm md:text-base px-24 md:px-28'}`}>Sponsors coming soon</div>
            )}

            <style jsx>{`
              @keyframes marquee {
                0% { transform: translateX(0%); }
                100% { transform: translateX(-50%); }
              }
            `}</style>
          </div>
      </div>
    </div>
  );
}
