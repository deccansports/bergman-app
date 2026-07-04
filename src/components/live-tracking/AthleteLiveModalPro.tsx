"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Loader2, Activity, Trophy, Clock, MapPin, Waves, ChevronsRight, Bike, Footprints, Flag, AlertTriangle, CalendarSearch, User as UserIcon, Target, Meh, Rocket, Star, LocateFixed, Route, Hourglass, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn, formatSecondsToHMS, hmsToSeconds, getInitials } from "@/lib/utils";
import { motion } from "framer-motion";
import type { LiveAthlete, Split, Leg, Status, TicketDefinition, EventCalendarEntry, CustomSplitPoint } from '@/lib/types';
import type { ResolvedTimingConfiguration } from '@/lib/timingConfiguration';
import Link from 'next/link';
import { getCalendarEventsAction } from '@/lib/actions';
import EventDisplayCard from '@/components/events/EventDisplayCard';
import DynamicSplitSummaryTable from './DynamicSplitSummaryTable';
import { useTimingConfigurationContext } from './TimingConfigurationContext';
import { fetchJsonCached } from '@/lib/liveTrackingRequestCache';
import { buildSplitModalModel } from './split-modal/utils';

// ============================================
// TYPES
// ============================================

type Athlete = {
  bookingId: string;
  bibNumber: string;
  name?: string;
  lat?: number;
  lng?: number;
  distance?: number;
  speed?: number;
  rank?: number;
  checkpoint?: string;
  timestamp?: string;
};

const countryNameToCode: { [key: string]: string } = {
    'India': 'IN', 'United States': 'US', 'USA / Canada': 'US', 'United Kingdom': 'GB', 'Canada': 'CA',
    'Australia': 'AU', 'Germany': 'DE', 'France': 'FR', 'Singapore': 'SG', 'United Arab Emirates': 'AE',
    'Afghanistan': 'AF', 'Brazil': 'BR', 'China': 'CN', 'Egypt': 'EG', 'Japan': 'JP',
    'Mexico': 'MX', 'Nigeria': 'NG', 'Russia': 'RU', 'South Africa': 'ZA', 'Other': 'XX'
};

const getCountryFlagEmoji = (countryName?: string | null): string => {
  if (!countryName) return '';
  const normalized = String(countryName).trim();
  const countryCode = normalized.length === 2 ? normalized.toUpperCase() : countryNameToCode[normalized];
    if (!countryCode || countryCode === 'XX') return '';
    return String.fromCodePoint(...Array.from(countryCode.toUpperCase()).map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
};

const formatCountdownDuration = (targetDate: Date) => {
  const diffMs = targetDate.getTime() - Date.now();
  if (diffMs <= 0) return 'Started';
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatScheduledStart = (targetDate: Date | null) => {
  if (!targetDate || Number.isNaN(targetDate.getTime())) return null;
  return targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDistanceValue = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const rounded = Math.round(numeric * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} km`;
};

const getSectionDistanceKm = (section: any) => {
  const values = Array.isArray(section?.rows)
    ? section.rows.map((row: any) => Number(row?.distanceKm ?? row?.distance ?? 0)).filter((value: number) => Number.isFinite(value) && value >= 0)
    : [];
  if (values.length === 0) return null;
  return Math.max(...values);
};

const normalizeDistanceKm = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric === 0) return 0;
  return numeric >= 1000 ? numeric / 1000 : numeric;
};

const getSplitDistanceKm = (split: any) => {
  const candidates = [
    split?.cumulativeDistance,
    split?.cumulative_distance,
    split?.distanceFromStart,
    split?.distance_from_start,
    split?.distanceKm,
    split?.distance_km,
    split?.DistanceFromStart,
    split?.distance,
  ];
  for (const candidate of candidates) {
    const km = normalizeDistanceKm(candidate);
    if (km !== null) return km;
  }
  return null;
};

const inferLegTheme = (leg: any) => {
  const token = String(leg?.name || leg?.label || leg?.type || leg?.sport || '').toLowerCase();
  if (token.includes('swim')) return 'swim';
  if (token.includes('bike') || token.includes('cycle')) return 'bike';
  if (token.includes('run')) return 'run';
  return 'other';
};

const computeCourseMetricsFromContest = (contest: any) => {
  const splits = Array.isArray(contest?.splits) ? contest.splits : [];
  const timingPoints = Array.isArray(contest?.timingPoints) ? contest.timingPoints : [];
  const legs = Array.isArray(contest?.legs) ? contest.legs : [];

  const orderedSplits = splits
    .map((split: any, index: number) => ({ split, index }))
    .sort((a: { split: any; index: number }, b: { split: any; index: number }) => {
      const aOrder = Number(a.split?.order ?? a.split?.Order ?? a.split?.index ?? a.split?.Index ?? a.index + 1) || (a.index + 1);
      const bOrder = Number(b.split?.order ?? b.split?.Order ?? b.split?.index ?? b.split?.Index ?? b.index + 1) || (b.index + 1);
      return aOrder - bOrder;
    })
    .map((entry: { split: any; index: number }) => entry.split);

  const splitDistanceByUuid: Record<string, number> = {};
  let totalDistanceKm = 0;
  for (const split of orderedSplits) {
    const splitUuid = String(split?.splitUuid || split?.uuid || split?.UUID || split?.id || '').trim().toLowerCase();
    const distanceKm = getSplitDistanceKm(split);
    if (distanceKm !== null) totalDistanceKm = Math.max(totalDistanceKm, distanceKm);
    if (splitUuid && distanceKm !== null) splitDistanceByUuid[splitUuid] = distanceKm;
  }

  const orderedLegs = [...legs].sort((a: any, b: any) => {
    const aOrder = Number(a?.order ?? a?.sequence ?? a?.sequence_no ?? a?.index ?? 0) || 0;
    const bOrder = Number(b?.order ?? b?.sequence ?? b?.sequence_no ?? b?.index ?? 0) || 0;
    return aOrder - bOrder;
  });

  const segmentTotals = { swim: 0, bike: 0, run: 0 };
  let previousEnd = 0;
  for (const leg of orderedLegs) {
    const firstSplitUuid = String(leg?.firstSplitUuid || leg?.first_split_uuid || '').trim().toLowerCase();
    const lastSplitUuid = String(leg?.lastSplitUuid || leg?.last_split_uuid || '').trim().toLowerCase();
    const firstDistance = firstSplitUuid ? splitDistanceByUuid[firstSplitUuid] : undefined;
    const lastDistance = lastSplitUuid ? splitDistanceByUuid[lastSplitUuid] : undefined;
    const fallbackEnd = orderedSplits.reduce((max: number, split: any) => {
      const splitLegUuid = String(split?.legUuid || split?.leg_uuid || split?.leg?.uuid || split?.leg?.UUID || '').trim().toLowerCase();
      const legUuid = String(leg?.uuid || leg?.legUuid || '').trim().toLowerCase();
      if (!splitLegUuid || !legUuid || splitLegUuid !== legUuid) return max;
      const distance = getSplitDistanceKm(split);
      return distance !== null ? Math.max(max, distance) : max;
    }, 0);
    const endDistance = Number.isFinite(lastDistance as number) ? Number(lastDistance) : fallbackEnd;
    const startDistance = Number.isFinite(firstDistance as number) ? Number(firstDistance) : previousEnd;
    const legDistance = Math.max(0, endDistance - startDistance);
    const theme = inferLegTheme(leg);
    if (theme === 'swim') segmentTotals.swim += legDistance;
    if (theme === 'bike') segmentTotals.bike += legDistance;
    if (theme === 'run') segmentTotals.run += legDistance;
    previousEnd = Math.max(previousEnd, endDistance);
  }

  const firstCheckpointName = String(
    timingPoints[0]?.displayName || timingPoints[0]?.shortName || timingPoints[0]?.name || timingPoints[0]?.label ||
    orderedSplits[0]?.name || orderedSplits[0]?.label ||
    '',
  ).trim() || 'SWIM START';

  return {
    swimDistanceKm: segmentTotals.swim,
    bikeDistanceKm: segmentTotals.bike,
    runDistanceKm: segmentTotals.run,
    totalDistanceKm,
    firstCheckpointName,
  };
};

const LegIcon = ({ leg, className }: { leg: Leg | 'NOT_STARTED' | 'FINISHED'; className?: string }) => {
    const baseClass = "h-4 w-4";
    switch (leg) {
        case 'SWIM': return <Waves className={cn(baseClass, "text-blue-500", className)} />;
        case 'T1': case 'T2': return <ChevronsRight className={cn(baseClass, "text-gray-500", className)} />;
        case 'BIKE': return <Bike className={cn(baseClass, "text-green-600", className)} />;
        case 'RUN': case 'RUN1': case 'RUN2': return <Footprints className={cn(baseClass, "text-orange-600", className)} />;
        case 'FINISH': case 'FINISHED': return <Flag className={cn(baseClass, "text-black", className)} />;
        default: return <Clock className={cn(baseClass, "text-gray-400", className)} />;
    }
};

const isDuathlonEvent = (category?: string) => category?.toLowerCase().includes('duathlon') ?? false;

const getLegTime = (athlete: LiveAthlete, leg: Leg): number | undefined => {
    const summaryTime = (athlete.summary as any)?.[leg];
    if (summaryTime) return summaryTime;
    
    if (athlete.startTime === null || athlete.startTime === undefined || athlete.startTime === 0) {
        const legSplit = athlete.splits.find(s => s.segment === leg);
        if (legSplit?.time && legSplit.time > 0) return legSplit.time;
        return undefined;
    }
    
    const legSplit = athlete.splits.find(s => s.segment === leg);
    if (!legSplit?.time) return undefined;

    const prevLeg: Leg | undefined = leg === 'T1' ? (isDuathlonEvent(athlete.category) ? 'RUN1' : 'SWIM')
        : leg === 'BIKE' ? 'T1'
        : leg === 'T2' ? 'BIKE'
        : leg === 'RUN' ? 'T2'
        : leg === 'RUN2' ? 'T2'
        : undefined;

    if (prevLeg) {
        const prevLegSplit = athlete.splits.find(s => s.segment === prevLeg);
        if (prevLegSplit?.time) {
            return legSplit.time - prevLegSplit.time;
        }
    }
    
    return legSplit.time - athlete.startTime;
};

const renderAthleteDetailSkeleton = () => (
  <div className="space-y-3 p-3 sm:p-4">
    <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-4">
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="h-14 w-14 animate-pulse rounded-full bg-white/10 sm:h-16 sm:w-16" />
        <div className="flex-1 space-y-3">
          <div className="h-6 w-2/3 animate-pulse rounded-lg bg-white/10" />
          <div className="h-4 w-1/2 animate-pulse rounded-lg bg-white/10" />
          <div className="h-4 w-3/4 animate-pulse rounded-lg bg-white/10" />
        </div>
      </div>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <div className="h-28 animate-pulse rounded-2xl bg-white/5" />
      <div className="h-28 animate-pulse rounded-2xl bg-white/5" />
    </div>
    <div className="h-8 w-40 animate-pulse rounded-lg bg-white/10" />
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-2xl bg-white/5" />
      ))}
    </div>
  </div>
);

interface UpcomingEventsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

function UpcomingEventsModal({ isOpen, onClose }: UpcomingEventsModalProps) {
    const [events, setEvents] = useState<EventCalendarEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if(isOpen) {
            setIsLoading(true);
            getCalendarEventsAction().then(result => {
                if(result.success && result.events) {
                    const upcoming = result.events.filter(e => !e.eventDate || new Date(e.eventDate) >= new Date());
                    setEvents(upcoming.slice(0, 6));
                }
            }).finally(() => setIsLoading(false));
        }
    }, [isOpen]);
    
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><CalendarSearch className="h-6 w-6 text-primary"/>Find Your Next Race</DialogTitle>
                    <DialogDescription>Your comeback is just one race away. Register for an upcoming event!</DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    {isLoading ? <Loader2 className="mx-auto h-8 w-8 animate-spin"/> : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto p-1">
                            {events.length > 0 ? events.map(event => (
                                <EventDisplayCard key={event.id} event={event} />
                            )) : <p>No upcoming events found. Check back soon!</p>}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

const RaceProgressBar: React.FC<{
    athlete: LiveAthlete;
  timingConfiguration?: ResolvedTimingConfiguration | null;
  participant?: Record<string, any> | null;
  participantsByBib?: Record<string, any>;
  ticketDef?: TicketDefinition | null;
}> = ({ athlete, timingConfiguration, participant, participantsByBib, ticketDef }) => {
  const model = useMemo(
    () => buildSplitModalModel({ athlete, timingConfiguration, participant, participantsByBib, ticketDef }),
    [athlete, timingConfiguration, participant, participantsByBib, ticketDef],
  );

  const stages = useMemo(() => {
    return model.sections.filter((section) => section.rows.length > 0);
  }, [model.sections]);

  const getCutoffLabel = (sectionTheme: string) => {
    const cutoffs = ticketDef?.cutoffs;
    if (!cutoffs) return 'No Cutoff';
    if (cutoffs.mode === 'overall') {
      return cutoffs.overall ? `Cutoff: ${cutoffs.overall}` : 'No Cutoff';
    }

    const theme = sectionTheme.toLowerCase();
    const value = theme.includes('swim')
      ? cutoffs.swim
      : theme.includes('bike')
        ? cutoffs.bike
        : theme.includes('run 1') || theme.includes('run1')
          ? cutoffs.run1
          : theme.includes('run 2') || theme.includes('run2')
            ? cutoffs.run2
            : theme.includes('run')
              ? cutoffs.run
              : null;
    return value ? `Cutoff: ${value}` : 'No Cutoff';
  };

  const stageStateByKey = useMemo(() => {
    const stateMap = new Map<string, 'completed' | 'current' | 'future' | 'missed'>();
    model.sectionTimeline.forEach((row) => stateMap.set(row.section.key, row.state));
    return stateMap;
  }, [model.sectionTimeline]);

  const totalRows = stages.reduce((sum, section) => sum + section.rows.length, 0);
  const reachedRows = stages.reduce((sum, section) => sum + section.rows.filter((row) => row.reached).length, 0);
  const totalProgressPercentage = model.isFinished
    ? 100
    : totalRows > 0
    ? Math.min(100, Math.max(0, (reachedRows / totalRows) * 100))
    : 0;

  const sectionToLeg = (section: { theme: string; label: string }): Leg | 'NOT_STARTED' => {
    const token = `${section.theme} ${section.label}`.toLowerCase();
    if (token.includes('swim')) return 'SWIM';
    if (token.includes('bike') || token.includes('cycle')) return 'BIKE';
    if (token.includes('t1')) return 'T1';
    if (token.includes('t2')) return 'T2';
    if (token.includes('run 1') || token.includes('run1')) return 'RUN1';
    if (token.includes('run 2') || token.includes('run2')) return 'RUN2';
    if (token.includes('run')) return 'RUN';
    if (token.includes('finish')) return 'FINISH';
    return 'NOT_STARTED';
  };

    return (
        <div className="w-full pt-2">
             <div className="flex justify-between items-center mb-1">
        {stages.map((stage, i) => {
          const state = stageStateByKey.get(stage.key) || 'future';
          const isCompleted = model.isFinished || state === 'completed';
          const isCurrent = !model.isNotStarted && state === 'current';
          const stageLabel = stage.theme === 'finish' ? 'FINISH' : String(stage.label || stage.theme || `STAGE ${i + 1}`).toUpperCase();
          const cutoffLabel = getCutoffLabel(stageLabel);
                    return (
                        <div key={i} className="z-10 flex flex-col items-center flex-1">
               <span className={`text-xs font-medium mb-1 ${isCurrent || isCompleted ? 'text-primary' : 'text-muted-foreground'}`}>{stageLabel}</span>
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-colors duration-300 ${
                                isCompleted ? 'bg-primary border-primary' : isCurrent ? 'bg-background border-primary scale-110' : 'bg-background border-border'
                            }`}>
                <LegIcon leg={sectionToLeg({ theme: stage.theme, label: stage.label })} className={`h-4 w-4 transition-colors duration-300 ${isCompleted ? 'text-primary-foreground' : isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
                            </div>
                            <p className="font-mono text-[10px] mt-1 text-muted-foreground">
                {stage.primaryMetricValue || '--:--'}
                            </p>
                            <p className="text-[10px] mt-0.5 text-muted-foreground text-center leading-tight max-w-[88px]">
                              {cutoffLabel}
                            </p>
                        </div>
                    );
                })}
            </div>
            <div className="relative w-full h-2 mt-1">
                <div className="absolute top-1/2 left-4 right-4 h-1 bg-slate-700 rounded-full -translate-y-1/2" />
                <motion.div 
                  className="absolute top-1/2 left-4 h-1 bg-yellow-400 rounded-full -translate-y-1/2"
                  initial={{ width: 0 }}
                  animate={{ width: `calc(${totalProgressPercentage}% - 8px)` }}
                  transition={{ duration: 0.5, ease: "easeInOut" }}
                />
                <motion.div 
                    className="absolute top-1/2 z-20"
                    initial={{ left: '16px' }}
                    animate={{ left: `calc(${totalProgressPercentage}% - 8px)` }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                >
                    <div className="w-4 h-4 bg-yellow-400 border-2 border-slate-900 rounded-full -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
                        <UserIcon className="h-2 w-2 text-background" />
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

const StatusMessage = ({ status, name, finishTime, onFindRaceClick, missedCutoffInfo, elapsedTime }: { status: Status; name: string; finishTime?: string | null, onFindRaceClick: () => void, missedCutoffInfo?: { segment: string; yourTime: string; cutoff: string } | null, elapsedTime: string }) => {
    if (status === 'Finished') {
        return (
            <div className="text-center p-4 bg-green-900/50 rounded-lg border border-green-700 space-y-2">
                <Trophy className="h-10 w-10 text-yellow-400 mx-auto" />
                <h4 className="font-bold text-lg text-yellow-300">Congratulations, {name}!</h4>
                <p className="text-sm text-green-200">You conquered the course. An incredible achievement!</p>
                {finishTime && (
                    <div className="pt-2">
                        <p className="text-sm text-yellow-200/80">Finish Time</p>
                        <p className="text-3xl sm:text-5xl font-bold font-mono text-yellow-300 tracking-tighter">{finishTime}</p>
                    </div>
                )}
            </div>
        );
    }
    if (status.startsWith('DNF') || status === 'DNQ' || status === 'DNS') {
        let message = "Every race is a lesson. Rest up, learn, and come back stronger. The next finish line awaits you!";
        if (missedCutoffInfo) {
            message = `You missed the cutoff time for the ${missedCutoffInfo.segment} segment. Your time was ${missedCutoffInfo.yourTime} against a cutoff of ${missedCutoffInfo.cutoff}. Focus on this area, and you&apos;ll crush it next time!`;
        }
        return (
            <div className="text-center p-4 bg-red-900/50 rounded-lg border border-red-700">
                <Target className="h-10 w-10 text-red-300 mx-auto mb-2" />
                <h4 className="font-bold text-lg text-red-200">A Tough Day Out There ({status})</h4>
                <p className="text-sm text-red-200 mt-2">{message}</p>
                 <div id="find-next-race-btn-wrapper" className="mt-4">
                    <Button size="sm" className="bg-yellow-400 text-slate-900 hover:bg-yellow-300" onClick={onFindRaceClick}>
                        <Rocket className="mr-2 h-4 w-4"/> Find Your Next Race
                    </Button>
                </div>
            </div>
        );
    }
     if (status === 'On Course') {
        return (
            <div className="text-center p-4 bg-blue-900/50 rounded-lg border border-blue-700 space-y-2">
                <p className="text-sm text-blue-200/80">Elapsed Time</p>
                <p className="text-4xl sm:text-5xl font-bold font-mono text-white tracking-tighter">{elapsedTime}</p>
            </div>
        );
    }
    return (
        <div className="text-center p-4 bg-gray-800/50 rounded-lg border border-gray-600">
            <Meh className="h-10 w-10 text-gray-300 mx-auto mb-2" />
            <h4 className="font-bold text-lg text-gray-200">Not Yet Started</h4>
            <p className="text-sm text-gray-300">The race hasn&apos;t begun for this athlete, or results are not yet available.</p>
        </div>
    );
};

// ============================================
// MAIN COMPONENT
// ============================================

interface AthleteLiveModalProProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  bookingId: string;
  // Detail modal props (optional)
  athlete?: LiveAthlete | null;
  ticketDef?: TicketDefinition | null;
  ticketDefinitions?: TicketDefinition[] | null;
  timingConfiguration?: ResolvedTimingConfiguration | null;
}

export default function AthleteLiveModalPro({
  open,
  onClose,
  eventId,
  bookingId,
  athlete: detailAthlete,
  ticketDef,
  ticketDefinitions,
  timingConfiguration: timingConfigurationProp,
}: AthleteLiveModalProProps) {
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [hydratedDetailAthlete, setHydratedDetailAthlete] = useState<LiveAthlete | null>(null);
  const [timingConfiguration, setTimingConfiguration] = useState<ResolvedTimingConfiguration | null>(null);
  const [isTimingConfigurationLoading, setIsTimingConfigurationLoading] = useState(false);
  const [isDetailHydrating, setIsDetailHydrating] = useState(false);
  const [participantsByBib, setParticipantsByBib] = useState<Record<string, any>>({});
  const prevPos = useRef<{ lat: number; lng: number } | null>(null);
  const athleteRef = useRef<Athlete | null>(null);
  const detailHydratedRef = useRef<string | null>(null);
  const hasHydratedDetailRef = useRef(false);
  const detailScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const detailScrollTopRef = useRef(0);
  const detailScrollRestoreTokenRef = useRef(0);
  const detailAthleteKeyRef = useRef<string | null>(null);
  const timingConfigurationContext = useTimingConfigurationContext();

  const getDetailViewport = useCallback(() => {
    if (!detailScrollAreaRef.current) return null;
    return detailScrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
  }, []);

  const stripTransientDetailFields = useCallback((value: any) => {
    if (!value || typeof value !== 'object') return value;
    const clone: Record<string, any> = Array.isArray(value) ? { ...value } : { ...value };
    delete clone.updatedAt;
    delete clone.updated_at;
    delete clone.lastUpdated;
    delete clone.last_updated;
    delete clone.lastSynced;
    delete clone.last_synced;
    delete clone.refreshedAt;
    delete clone.refreshed_at;
    delete clone.fetchedAt;
    delete clone.fetched_at;
    if (clone.participantLive && typeof clone.participantLive === 'object') {
      const liveClone = { ...clone.participantLive } as Record<string, any>;
      delete liveClone.updatedAt;
      delete liveClone.updated_at;
      delete liveClone.lastUpdated;
      delete liveClone.last_updated;
      delete liveClone.lastSynced;
      delete liveClone.last_synced;
      delete liveClone.fetchedAt;
      delete liveClone.fetched_at;
      delete liveClone.timestamp;
      clone.participantLive = liveClone;
    }
    return clone;
  }, []);

  const restoreDetailScrollPosition = useCallback((preferredTop?: number) => {
    const targetTop = Math.max(0, Number(preferredTop ?? detailScrollTopRef.current ?? 0) || 0);
    if (targetTop <= 0) return;

    detailScrollRestoreTokenRef.current += 1;
    const token = detailScrollRestoreTokenRef.current;

    const applyRestore = () => {
      if (token !== detailScrollRestoreTokenRef.current) return;
      const viewport = getDetailViewport();
      if (!viewport) return;
      viewport.scrollTop = targetTop;
      detailScrollTopRef.current = targetTop;
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyRestore();
        window.setTimeout(applyRestore, 32);
      });
    });
  }, [getDetailViewport]);

  // Use either passed athlete or fetch from API
  const isDetailMode = !!detailAthlete;
  const activeDetailAthlete = hydratedDetailAthlete || detailAthlete || null;
  const resolvedTicketDef = useMemo(() => {
    if (ticketDef) return ticketDef;
    const defs = Array.isArray(ticketDefinitions) ? ticketDefinitions : [];
    const athleteSource: any = activeDetailAthlete || detailAthlete || null;
    if (!athleteSource || defs.length === 0) return null;

    const ticketId = String(
      athleteSource?.ticketId ||
      athleteSource?.ticket_id ||
      athleteSource?.registration?.ticketId ||
      '',
    ).trim();
    if (ticketId) {
      const exact = defs.find((row) => String(row?.id || '').trim() === ticketId);
      if (exact) return exact;
    }

    const subCategoryId = String(
      athleteSource?.subCategoryId ||
      athleteSource?.selectedSubCategoryId ||
      athleteSource?.sub_category_id ||
      '',
    ).trim();
    if (subCategoryId) {
      const bySubCategory = defs.find((row: any) =>
        Array.isArray(row?.subCategories) && row.subCategories.some((sub: any) => String(sub?.id || '').trim() === subCategoryId),
      );
      if (bySubCategory) return bySubCategory;
    }

    const compact = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const athleteLabels = [
      athleteSource?.ticketName,
      athleteSource?.contestName,
      athleteSource?.contest_name,
      athleteSource?.category,
      athleteSource?.registration?.ticketName,
    ].map(compact).filter(Boolean);

    if (athleteLabels.length === 0) return null;

    return defs.find((row: any) => {
      const candidateLabels = [
        row?.ticketName,
        row?.name,
        row?.displayName,
        ...(Array.isArray(row?.subCategories) ? row.subCategories.map((sub: any) => sub?.name) : []),
      ].map(compact).filter(Boolean);

      return athleteLabels.some((athleteLabel) =>
        candidateLabels.some((candidateLabel) => candidateLabel === athleteLabel || candidateLabel.includes(athleteLabel) || athleteLabel.includes(candidateLabel)),
      );
    }) || null;
  }, [activeDetailAthlete, detailAthlete, ticketDef, ticketDefinitions]);

  const splitModel = useMemo(() => {
    if (!isDetailMode) return null;
    const modelAthlete = (hydratedDetailAthlete || detailAthlete || null) as LiveAthlete | null;
    if (!modelAthlete) return null;

    const bibKey = String((modelAthlete as any)?.bib || (modelAthlete as any)?.bibNumber || '').trim();
    const participantSource = bibKey && participantsByBib[bibKey] ? participantsByBib[bibKey] : modelAthlete;

    return buildSplitModalModel({
      athlete: modelAthlete,
      timingConfiguration,
      participant: participantSource || null,
      participantsByBib,
      ticketDef: resolvedTicketDef,
    });
  }, [isDetailMode, hydratedDetailAthlete, detailAthlete, timingConfiguration, participantsByBib, resolvedTicketDef]);

  const resolvedContest = useMemo(() => {
    const contestUuid = String(
      (activeDetailAthlete as any)?.contestUuid
      || (activeDetailAthlete as any)?.contest_uuid
      || splitModel?.participantProfile?.contestUuid
      || '',
    ).trim();
    const contestName = String(
      (activeDetailAthlete as any)?.contestName
      || (activeDetailAthlete as any)?.contest_name
      || splitModel?.participantProfile?.contestName
      || '',
    ).trim();
    const timingIndex = timingConfiguration?.contestIndex || timingConfiguration?.contestByUuid || timingConfiguration?.contestLookup || {};
    const contest = contestUuid
      ? timingIndex[contestUuid]
        || timingIndex[contestUuid.toLowerCase()]
        || timingConfiguration?.contestByName?.[contestName.toLowerCase()]
        || timingConfiguration?.contestByUuid?.[contestUuid]
        || null
      : null;
    return contest || null;
  }, [activeDetailAthlete, splitModel?.participantProfile?.contestUuid, splitModel?.participantProfile?.contestName, timingConfiguration]);

  useEffect(() => {
    athleteRef.current = athlete;
  }, [athlete]);

  useEffect(() => {
    const currentDetailKey = detailAthlete
      ? `${eventId}:${String((detailAthlete as any)?.id || (detailAthlete as any)?.athleteUid || detailAthlete?.bib || bookingId || '').trim()}`
      : null;

    if (!open || !isDetailMode || !detailAthlete) {
      setHydratedDetailAthlete(null);
      setIsDetailHydrating(false);
      detailHydratedRef.current = null;
      hasHydratedDetailRef.current = false;
      detailScrollTopRef.current = 0;
      detailScrollRestoreTokenRef.current += 1;
      detailAthleteKeyRef.current = null;
      return;
    }

    if (detailAthleteKeyRef.current !== currentDetailKey) {
      detailAthleteKeyRef.current = currentDetailKey;
      setHydratedDetailAthlete(null);
      setIsDetailHydrating(true);
      detailHydratedRef.current = null;
      hasHydratedDetailRef.current = false;
      detailScrollTopRef.current = 0;
      detailScrollRestoreTokenRef.current += 1;
      return;
    }
  }, [open, isDetailMode, detailAthlete, eventId, bookingId]);

  useEffect(() => {
    if (!open || !isDetailMode) return;
    const viewport = getDetailViewport();
    if (!viewport) return;
    const onScroll = () => {
      detailScrollTopRef.current = viewport.scrollTop;
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
    };
  }, [open, isDetailMode, getDetailViewport]);

  useLayoutEffect(() => {
    if (!open || !isDetailMode) return;
    const viewport = getDetailViewport();
    if (!viewport) return;
    if (detailScrollTopRef.current <= 0) return;
    viewport.scrollTop = detailScrollTopRef.current;
  }, [open, isDetailMode, hydratedDetailAthlete, isDetailHydrating, getDetailViewport]);

  useEffect(() => {
    if (!open || !isDetailMode) return;
    restoreDetailScrollPosition();
  }, [open, isDetailMode, hydratedDetailAthlete, isDetailHydrating, restoreDetailScrollPosition]);

  useEffect(() => {
    if (!open || !isDetailMode || !detailAthlete) return;

    const athleteKey = `${eventId}:${String((detailAthlete as any)?.id || (detailAthlete as any)?.athleteUid || detailAthlete?.bib || bookingId || '').trim()}`;
    let pollTimer: number | null = null;

    let cancelled = false;
    const hydrate = async (force = false) => {
      if (!force && detailHydratedRef.current === athleteKey) return;
      if (typeof document !== 'undefined' && (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus()))) return;
      if (!hasHydratedDetailRef.current) {
        setIsDetailHydrating(true);
      }
      try {
        const lookupBib = String((detailAthlete as any)?.bib || '').trim();
        const lookupAthleteUid = String((detailAthlete as any)?.athleteUid || '').trim();
        const lookupBookingId = String((detailAthlete as any)?.bookingId || (detailAthlete as any)?.id || bookingId || '').trim();

        const query = new URLSearchParams();
        if (lookupBib) query.set('bib', lookupBib);
        if (lookupAthleteUid) query.set('athleteUid', lookupAthleteUid);
        if (lookupBookingId) query.set('bookingId', lookupBookingId);

        const contextResponse = await fetch(
          `/api/live/athlete-modal/${encodeURIComponent(eventId)}?${query.toString()}`,
          { cache: 'no-store' },
        ).catch(() => null);

        const contextPayload = contextResponse ? await contextResponse.json().catch(() => null) : null;
        const matched = contextPayload?.success ? (contextPayload?.athlete || null) : null;
        if (!matched || cancelled) return;

        const contextContestUuid = String(
          contextPayload?.contestContext?.contest?.contestUuid
          || contextPayload?.contestContext?.contest?.uuid
          || contextPayload?.contestContext?.contest?.id
          || '',
        ).trim();
        const contextContestLegs = Array.isArray(contextPayload?.contestContext?.legs) ? contextPayload.contestContext.legs : [];
        const contextContestSplits = Array.isArray(contextPayload?.contestContext?.splits) ? contextPayload.contestContext.splits : [];
        const contextContestTimingPoints = Array.isArray(contextPayload?.contestContext?.timingPoints) ? contextPayload.contestContext.timingPoints : [];

        const contextTiming = contextPayload?.timingConfiguration || null;
        if (contextTiming && !cancelled) {
          const timingPayload = contextTiming?.timings || contextTiming?.timingConfiguration || contextTiming;
          setTimingConfiguration({
            eventId: contextPayload?.eventId || eventId,
            source: timingPayload.source || contextTiming.source || 'cloud',
            course: {
              legs: Array.isArray(timingPayload?.course?.legs) ? timingPayload.course.legs : Array.isArray(timingPayload.legs) ? timingPayload.legs : [],
              timingPoints: Array.isArray(timingPayload?.course?.timingPoints) ? timingPayload.course.timingPoints : Array.isArray(timingPayload.timingPoints) ? timingPayload.timingPoints : [],
              splits: Array.isArray(timingPayload?.course?.splits) ? timingPayload.course.splits : Array.isArray(timingPayload.splits) ? timingPayload.splits : [],
              contests: Array.isArray(timingPayload?.course?.contests) ? timingPayload.course.contests : Array.isArray(timingPayload.contests) ? timingPayload.contests : [],
            },
            contests: Array.isArray(timingPayload?.contests) ? timingPayload.contests : [],
            timingPoints: Array.isArray(timingPayload?.timingPoints) ? timingPayload.timingPoints : [],
            splits: Array.isArray(timingPayload?.splits) ? timingPayload.splits : [],
            devices: Array.isArray(timingPayload?.devices) ? timingPayload.devices : [],
            legs: Array.isArray(timingPayload?.legs) ? timingPayload.legs : [],
            ageGroups: Array.isArray(timingPayload?.ageGroups) ? timingPayload.ageGroups : [],
            splitsByContest: {
              ...(timingPayload?.splitsByContest || {}),
              ...(contextContestUuid && contextContestSplits.length > 0 ? { [contextContestUuid]: contextContestSplits } : {}),
            },
            timingPointsByContest: {
              ...(timingPayload?.timingPointsByContest || {}),
              ...(contextContestUuid && contextContestTimingPoints.length > 0 ? { [contextContestUuid]: contextContestTimingPoints } : {}),
            },
            legsByContest: {
              ...(timingPayload?.legsByContest || {}),
              ...(contextContestUuid && contextContestLegs.length > 0 ? { [contextContestUuid]: contextContestLegs } : {}),
            },
            legIndex: {
              byContest: {
                ...(timingPayload?.legIndex?.byContest || {}),
                ...(contextContestUuid && contextContestLegs.length > 0 ? { [contextContestUuid]: contextContestLegs } : {}),
              },
              byUuid: {
                ...(timingPayload?.legIndex?.byUuid || {}),
                ...Object.fromEntries(
                  contextContestLegs
                    .map((row: any) => {
                      const uuid = String(row?.uuid || row?.legUuid || row?.leg_uuid || row?.configuration?.uuid || '').trim();
                      return uuid ? [uuid.toLowerCase(), row] : null;
                    })
                    .filter(Boolean) as Array<[string, any]>,
                ),
              },
              list: Array.isArray(timingPayload?.legIndex?.list)
                ? [...timingPayload.legIndex.list, ...contextContestLegs]
                : contextContestLegs,
            },
            importedAt: timingPayload?.importedAt || contextTiming?.importedAt || null,
            provider: timingPayload?.provider || contextTiming?.provider || 'feibot',
            splitSource: contextTiming?.splitSource || contextTiming?.sourceLabel || 'KV',
            sourceLabel: contextTiming?.sourceLabel || 'KV:eventTimingConfiguration',
            version: contextTiming?.version || contextTiming?.configVersion || contextTiming?.timing_rules?.version || null,
            updatedAt: contextTiming?.updatedAt || contextTiming?.importedAt || null,
            lastSynced: contextTiming?.lastSynced || contextTiming?.updatedAt || contextTiming?.importedAt || null,
            contestContext: contextPayload?.contestContext || null,
          } as any);
        }

        const matchedSplits = Array.isArray(matched?.splits) ? matched.splits : [];
        const finalContestUuid = String(
          matched?.contest_uuid ||
          matched?.contestUuid ||
          matched?.liveTracking?.contestUuid ||
          detailAthlete?.contest_uuid ||
          detailAthlete?.contestUuid ||
          '',
        ).trim() || null;

        const finalContestName = String(
          matched?.contest_name ||
          matched?.contestName ||
          matched?.liveTracking?.contestName ||
          detailAthlete?.contest_name ||
          detailAthlete?.contestName ||
          '',
        ).trim() || null;

        const finalContestUuidKey = finalContestUuid || '';

        const snapshotContestUuid = String(
          contextTiming?.contestUuid ||
          contextTiming?.contestIndex?.[finalContestUuidKey]?.contestUuid ||
          finalContestUuid ||
          '',
        ).trim() || null;
        const availableContestUuids = Object.keys(contextTiming?.splitsByContest || contextTiming?.contestIndex || {});
        const contestSplitsFromSnapshot = Array.isArray(contextTiming?.splitsByContest?.[finalContestUuidKey])
          ? contextTiming.splitsByContest[finalContestUuidKey]
          : Array.isArray(contextTiming?.contestIndex?.[finalContestUuidKey]?.splits)
            ? contextTiming.contestIndex[finalContestUuidKey].splits
            : [];
        console.log('[AthleteModal][contest-split-selection]', {
          athleteContestUuid: finalContestUuid,
          athleteContestName: finalContestName,
          athleteBib: String((matched as any)?.bib || detailAthlete?.bib || ''),
          mappedContestUuid: String((matched as any)?.contestUuid || (matched as any)?.contest_uuid || ''),
          availableContests: availableContestUuids,
          selectedSplitCount: contestSplitsFromSnapshot.length,
          selectedSplits: contestSplitsFromSnapshot,
          snapshotContestUuid,
        });

        const providerParticipantUuid = String((matched as any)?.participant_uuid || (matched as any)?.participantUuid || '').trim() || null;

        const byBib = matched?.bib
          ? {
              [String(matched.bib).trim()]: matched,
              [String(matched.bib).trim().replace(/^0+/, '')]: matched,
            }
          : {};
        setParticipantsByBib(byBib);

        const providerLiveAvailable = true;
        const providerTimingMessage: string | null = null;

        const mergedAgeGroup = String(
          matched?.ageGroup ||
          matched?.ageCategory ||
          matched?.registration?.subCategoryName ||
          matched?.registration?.ageGroup ||
          matched?.registration?.selectedSubCategory ||
          detailAthlete?.ageGroup ||
          '',
        ).trim() || null;

        const mergedCountry = String(
          matched?.country ||
          matched?.countryCode ||
          matched?.country_code ||
          matched?.countryName ||
          matched?.countryAtRace ||
          matched?.registration?.country ||
          matched?.registration?.countryCode ||
          matched?.registration?.country_code ||
          matched?.nationality ||
          (detailAthlete as any)?.country ||
          (detailAthlete as any)?.countryAtRace ||
          '',
        ).trim() || null;

        const mergedAvatarUrl = String(
          matched?.avatarUrl ||
          matched?.avatar_url ||
          matched?.photoUrl ||
          matched?.photo_url ||
          matched?.profilePhoto ||
          matched?.profile_photo ||
          matched?.image ||
          matched?.imageUrl ||
          matched?.avatar ||
          matched?.registration?.avatarUrl ||
          matched?.registration?.photoUrl ||
          (detailAthlete as any)?.avatarUrl ||
          (detailAthlete as any)?.photoUrl ||
          (detailAthlete as any)?.profilePhoto ||
          '',
        ).trim() || null;

        const mergedAthlete = {
          ...detailAthlete,
          ...matched,
          ticketId: String((matched as any)?.ticketId || (detailAthlete as any)?.ticketId || '').trim() || null,
          subCategoryId: String((matched as any)?.subCategoryId || (detailAthlete as any)?.subCategoryId || '').trim() || null,
          contest_uuid: finalContestUuid,
          contestUuid: finalContestUuid,
          contest_name: finalContestName,
          contestName: finalContestName,
          providerParticipantUuid,
          providerLiveAvailable,
          providerTimingMessage,
          mappingSource: String((matched as any)?.mappingSource || '').trim() || 'merged-athlete-context',
          ageGroup: mergedAgeGroup,
          country: mergedCountry,
          avatarUrl: mergedAvatarUrl,
          photoUrl: mergedAvatarUrl,
          profilePhoto: mergedAvatarUrl,
          status: matched?.status || detailAthlete?.status,
          splits: matchedSplits,
        } as LiveAthlete;

        console.log('========== ATHLETE DETAILS ==========');
        console.log({
          athleteBib: String((mergedAthlete as any)?.bib || detailAthlete?.bib || ''),
          ticketId: String((mergedAthlete as any)?.ticketId || ''),
          subCategoryId: String((mergedAthlete as any)?.subCategoryId || ''),
          resolvedContestUuid: String((mergedAthlete as any)?.contestUuid || (mergedAthlete as any)?.contest_uuid || ''),
          resolvedContestName: String((mergedAthlete as any)?.contestName || (mergedAthlete as any)?.contest_name || ''),
          mappingSource: String((mergedAthlete as any)?.mappingSource || ''),
        });

        const viewportBeforeUpdate = getDetailViewport();
        const previousScrollTop = viewportBeforeUpdate?.scrollTop ?? detailScrollTopRef.current;
        detailScrollTopRef.current = previousScrollTop;
        setHydratedDetailAthlete((prev) => {
          const prevComparable = stripTransientDetailFields(prev);
          const nextComparable = stripTransientDetailFields(mergedAthlete);
          if (prevComparable && JSON.stringify(prevComparable) === JSON.stringify(nextComparable)) return prev;
          return mergedAthlete;
        });
        hasHydratedDetailRef.current = true;
        restoreDetailScrollPosition(previousScrollTop);
        const contestSplits = Array.isArray(contextPayload?.contestContext?.splits) ? contextPayload.contestContext.splits : [];
        const contestTimingPoints = Array.isArray(contextPayload?.contestContext?.timingPoints) ? contextPayload.contestContext.timingPoints : [];
        console.log('[AthleteModal][debug]', {
          contestUuid: finalContestUuid,
          contestName: finalContestName,
          providerParticipantUuid,
          splitCount: contestSplitsFromSnapshot.length,
          timingPointCount: contestTimingPoints.length,
          pollingInterval: '5000ms',
          lastUpdated: new Date().toISOString(),
          dataSource: 'KV',
        });
        detailHydratedRef.current = athleteKey;
      } catch {
        // best-effort hydration
      } finally {
        if (!cancelled) setIsDetailHydrating(false);
      }
    };

    void hydrate();
    pollTimer = window.setInterval(() => {
      void hydrate(true);
    }, 5000);

    return () => {
      cancelled = true;
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
    };
  }, [bookingId, detailAthlete, eventId, getDetailViewport, isDetailMode, open]);

  useEffect(() => {
    const sharedTimingConfiguration = timingConfigurationProp || timingConfigurationContext?.timingConfiguration || null;
    if (sharedTimingConfiguration) {
      setTimingConfiguration(sharedTimingConfiguration);
      setIsTimingConfigurationLoading(false);
      return;
    }
    if (!open || !eventId) return;
    if (timingConfiguration) return;
    let cancelled = false;
    const loadTimingConfiguration = async (options?: { showLoading?: boolean }) => {
      const cacheKey = `bergman:timingConfiguration:${eventId}`;
      if (options?.showLoading) {
        setIsTimingConfigurationLoading(true);
      }
      try {
        if (typeof window !== 'undefined') {
          const cached = window.sessionStorage.getItem(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed === 'object') {
              setTimingConfiguration(parsed);
              return;
            }
          }
        }

        const resolvedTimingConfiguration = await fetchJsonCached<ResolvedTimingConfiguration>(`timingConfiguration:${eventId}`, async () => {
          const response = await fetch(`/api/live/athlete-modal/${encodeURIComponent(eventId)}?bookingId=${encodeURIComponent(bookingId)}`, { cache: 'no-store' });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.message || `Request failed with HTTP ${response.status}`);
          }
          const timingPayload = payload?.timingConfiguration || payload?.courseIndex || payload?.timings || payload;
          const contestIndex = timingPayload?.contestIndex && typeof timingPayload.contestIndex === 'object' ? timingPayload.contestIndex : {};
          return {
            eventId: payload.eventId || eventId,
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
            importedAt: timingPayload.importedAt || payload.importedAt || null,
            provider: timingPayload.provider || payload.provider || null,
          } as ResolvedTimingConfiguration;
        });

        setTimingConfiguration(resolvedTimingConfiguration);
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(cacheKey, JSON.stringify(resolvedTimingConfiguration));
        }
      } catch {
        if (!cancelled) setTimingConfiguration(null);
      } finally {
        if (options?.showLoading && !cancelled) setIsTimingConfigurationLoading(false);
      }
    };

    void loadTimingConfiguration({ showLoading: true });
    const refreshTimer = window.setInterval(() => {
      void loadTimingConfiguration();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [open, eventId, bookingId, timingConfigurationProp, timingConfigurationContext?.timingConfiguration, timingConfiguration]);

  // ============================================
  // 🔥 AUTO FETCH (REALTIME) - For live mode
  // ============================================
  useEffect(() => {
    if (!open || isDetailMode) return;

    const fetchData = async () => {
      try {
        const res = await fetch(
          `/api/live/athlete?eventId=${eventId}&bookingId=${bookingId}`
        );
        const data = await res.json();

        prevPos.current = athleteRef.current
          ? { lat: athleteRef.current.lat || 0, lng: athleteRef.current.lng || 0 }
          : null;

        setAthlete(data);
        setLoading(false);
      } catch (err) {
        console.error(err);
      }
    };

    fetchData();

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus()))) return;
      void fetchData();
    }, 5000);
    return () => clearInterval(interval);
  }, [open, eventId, bookingId, isDetailMode]);

  // Update timer for detail mode
  useEffect(() => {
    if (open && isDetailMode && activeDetailAthlete?.status === 'On Course') {
      const timer = setInterval(() => setNow(new Date()), 1000);
      return () => clearInterval(timer);
    }
  }, [open, isDetailMode, activeDetailAthlete?.status]);

  // Use detail athlete if available, otherwise use fetched athlete
  const displayAthlete = isDetailMode ? detailAthlete : athlete;

  // ============================================
  // 🔥 MAP URL (smooth) - For live mode
  // ============================================
  const liveAthlete = athlete as Athlete | null;
  const mapUrl = !isDetailMode && liveAthlete?.lat && liveAthlete?.lng
    ? `https://maps.google.com/maps?q=${liveAthlete.lat},${liveAthlete.lng}&z=15&output=embed`
    : "";

  // ============================================
  // 🔥 PROGRESS %
  // ============================================
  const progress = Math.min(((liveAthlete?.distance as number) || 0) / 90 * 100, 100);

  const effectiveStatus = useMemo<Status>(() => {
    if (!isDetailMode || !activeDetailAthlete) return 'Not Started';
    if (splitModel?.isFinished) return 'Finished';
    if (splitModel?.isNotStarted) return 'Not Started';
    if (splitModel?.athleteStatus && splitModel.athleteStatus !== 'Not Yet Started') return splitModel.athleteStatus as Status;
    const finishedFromSummary = typeof activeDetailAthlete.summary?.FINISHED === 'number' && activeDetailAthlete.summary.FINISHED > 0;
    const finishedFromSplit = (activeDetailAthlete.splits || []).some(s => s.segment === 'FINISH' || s.segment === 'FINISHED');

    if (activeDetailAthlete.status === 'Finished' || finishedFromSummary || finishedFromSplit) return 'Finished';
    if (activeDetailAthlete.status === 'Not Started' && (activeDetailAthlete.splits || []).length > 0) return 'On Course';
    return activeDetailAthlete.status as Status;
  }, [isDetailMode, activeDetailAthlete, splitModel]);

  // Detail mode computations
  const elapsedTime = useMemo(() => {
    if (!isDetailMode || !activeDetailAthlete) return 'Waiting...';

    if (splitModel?.totalRaceTimeSeconds && effectiveStatus === 'Finished') {
      return formatSecondsToHMS(splitModel.totalRaceTimeSeconds);
    }

    const finishFromSummary = activeDetailAthlete.summary?.FINISHED ?? activeDetailAthlete.summary?.FINISH;
    if (effectiveStatus === 'Finished') {
      if (typeof finishFromSummary === 'number' && finishFromSummary > 0) return formatSecondsToHMS(finishFromSummary);
      const finishSplit = (activeDetailAthlete.splits || []).find(s => s.segment === 'FINISH' || s.segment === 'FINISHED');
      if (finishSplit?.time && finishSplit.time > 0) return formatSecondsToHMS(finishSplit.time);
    }

    if (activeDetailAthlete.startTime && activeDetailAthlete.startTime > 0 && effectiveStatus === 'On Course') {
      const elapsed = (now.getTime() / 1000) - activeDetailAthlete.startTime;
        return formatSecondsToHMS(elapsed > 0 ? elapsed : 0);
    }
    
    if (activeDetailAthlete.splits && activeDetailAthlete.splits.length > 0) {
      const lastSplit = activeDetailAthlete.splits[activeDetailAthlete.splits.length - 1];
        if (lastSplit && lastSplit.time > 0) {
        if (activeDetailAthlete.startTime === 0) return formatSecondsToHMS(lastSplit.time);
        }
    }

    return 'Waiting...';
  }, [activeDetailAthlete, now, isDetailMode, effectiveStatus, splitModel]);

  const missedCutoffInfo = useMemo(() => {
    if (!isDetailMode || !activeDetailAthlete?.status.startsWith('DNF') || !activeDetailAthlete?.cutoffReason || !resolvedTicketDef?.cutoffs) {
        return null;
    }
    
    const cutoffs = resolvedTicketDef.cutoffs;
    let segmentLabel = activeDetailAthlete.cutoffReason.replace('_CUTOFF', '');
    let cutoffTimeStr: string | null | undefined = null;
    let athleteTimeSeconds: number | undefined = undefined;

    if (cutoffs.mode === 'segment') {
        switch(segmentLabel) {
            case 'SWIM': 
                cutoffTimeStr = cutoffs.swim;
                athleteTimeSeconds = activeDetailAthlete.summary?.SWIM || undefined;
                break;
            case 'BIKE':
                cutoffTimeStr = cutoffs.bike;
                athleteTimeSeconds = activeDetailAthlete.summary?.BIKE || undefined;
                break;
            case 'RUN':
                cutoffTimeStr = cutoffs.run;
                athleteTimeSeconds = activeDetailAthlete.summary?.RUN || undefined;
                break;
        }
    } else if (cutoffs.mode === 'overall') {
        cutoffTimeStr = cutoffs.overall;
            athleteTimeSeconds = activeDetailAthlete.summary?.FINISH || activeDetailAthlete.summary?.FINISHED || undefined;
    }

    if (cutoffTimeStr && athleteTimeSeconds) {
         return {
            segment: segmentLabel,
            yourTime: formatSecondsToHMS(athleteTimeSeconds),
            cutoff: cutoffTimeStr,
         };
    }
    return null;
  }, [activeDetailAthlete, resolvedTicketDef, isDetailMode]);

  const finishTime = useMemo(() => {
    if (!isDetailMode || !activeDetailAthlete) return null;
    const finishSeconds = activeDetailAthlete?.summary?.FINISHED ?? activeDetailAthlete?.summary?.FINISH;
    if (effectiveStatus === 'Finished' && typeof finishSeconds === 'number') {
      return formatSecondsToHMS(finishSeconds);
    }
    const finishSplit = (activeDetailAthlete.splits || []).find(s => s.segment === 'FINISH' || s.segment === 'FINISHED');
    if (effectiveStatus === 'Finished' && finishSplit?.time) return formatSecondsToHMS(finishSplit.time);
    return null;
  }, [activeDetailAthlete, isDetailMode, effectiveStatus]);

  const nextSplitPrediction = useMemo(() => {
    if (!isDetailMode || !activeDetailAthlete || effectiveStatus === 'Finished') return null;

    type Point = { id: string; label: string; cumulativeKm: number; segment: Leg | 'START' | 'FINISH' };
    const cm: any = resolvedTicketDef?.courseMaps || ticketDef?.courseMaps || {};
    const isDuaLocal = isDuathlonEvent(activeDetailAthlete.ticketName || activeDetailAthlete.category);
    const swimDistance = Number(cm.swimDistance || 0);
    const bikeDistance = Number(cm.bikeDistance || 0);
    const runDistance = Number(cm.runDistance || 0);
    const run1Distance = Number(cm.run1Distance || 0);
    const run2Distance = Number(cm.run2Distance || runDistance || 0);

    const points: Point[] = [{ id: 'START', label: 'Start', cumulativeKm: 0, segment: 'START' }];
    const addCustom = (arr: CustomSplitPoint[] = [], prefix: string, baseKm: number, segment: Leg) => {
      arr.forEach((p) => {
        const d = Number(p.distance || 0);
        points.push({ id: (p.id || `${prefix}_${d}`).toUpperCase(), label: p.name || p.id || `${prefix} ${d} km`, cumulativeKm: Math.max(0, baseKm + d), segment });
      });
    };

    if (isDuaLocal) {
      addCustom(cm.run1Splits || [], 'RUN1', 0, 'RUN1');
      points.push({ id: 'RUN1_END', label: 'Run 1 End', cumulativeKm: run1Distance, segment: 'RUN1' });
      addCustom(cm.bikeSplits || [], 'BIKE', run1Distance, 'BIKE');
      points.push({ id: 'BIKE_END', label: 'Bike End', cumulativeKm: run1Distance + bikeDistance, segment: 'BIKE' });
      addCustom((cm.run2Splits || cm.runSplits || []), 'RUN2', run1Distance + bikeDistance, 'RUN2');
      points.push({ id: 'FINISH', label: 'Finish', cumulativeKm: run1Distance + bikeDistance + run2Distance, segment: 'FINISH' });
    } else {
      addCustom(cm.swimSplits || [], 'SWIM', 0, 'SWIM');
      points.push({ id: 'SWIM_EXIT', label: 'Swim Exit', cumulativeKm: swimDistance, segment: 'SWIM' });
      addCustom(cm.bikeSplits || [], 'BIKE', swimDistance, 'BIKE');
      points.push({ id: 'BIKE_END', label: 'Bike End', cumulativeKm: swimDistance + bikeDistance, segment: 'BIKE' });
      addCustom(cm.runSplits || [], 'RUN', swimDistance + bikeDistance, 'RUN');
      points.push({ id: 'FINISH', label: 'Finish', cumulativeKm: swimDistance + bikeDistance + runDistance, segment: 'FINISH' });
    }

    const splitsSorted = [...(activeDetailAthlete.splits || [])]
      .filter(s => typeof s.time === 'number' && s.time > 0)
      .sort((a, b) => (a.time || 0) - (b.time || 0));
    if (splitsSorted.length === 0) return null;

    const lastSplit = splitsSorted[splitsSorted.length - 1];
    const matchIdx = points.findIndex(p => p.id === ((lastSplit.rawSplitLabel || '').toUpperCase()));
    const currentIndex = matchIdx >= 0 ? matchIdx : Math.max(0, points.findIndex(p => p.segment === (lastSplit.segment as any)));
    const next = points[currentIndex + 1] || points[points.length - 1];
    if (!next || next.id === 'FINISH' && (lastSplit.segment === 'FINISH' || lastSplit.segment === 'FINISHED')) return null;

    const paceSamples: number[] = [];
    for (let i = 1; i < splitsSorted.length; i++) {
      const prev = splitsSorted[i - 1];
      const curr = splitsSorted[i];
      const dt = (curr.time || 0) - (prev.time || 0);
      const dd = (curr.distance || 0) - (prev.distance || 0);
      if (dt > 0 && dd > 0) paceSamples.push(dt / dd);
    }

    const robustPace = (() => {
      if (paceSamples.length > 0) {
        const recent = paceSamples.slice(-5).sort((a, b) => a - b);
        const mid = Math.floor(recent.length / 2);
        return recent[mid];
      }
      if (activeDetailAthlete.predictedPaceSecPerKm && activeDetailAthlete.predictedPaceSecPerKm > 0) return activeDetailAthlete.predictedPaceSecPerKm;
      const lastDistance = Number(lastSplit.distance || 0);
      if (lastDistance > 0) return (lastSplit.time || 0) / lastDistance;
      return null;
    })();

    if (!robustPace || robustPace <= 0) return null;

    const currentKm = Math.max(0, Number(lastSplit.distance || 0));
    const remainKm = Math.max(0, next.cumulativeKm - currentKm);
    const etaDeltaSec = remainKm * robustPace;
    const etaElapsedSec = Math.round((lastSplit.time || 0) + etaDeltaSec);
    const etaAbsSec = activeDetailAthlete.startTime && activeDetailAthlete.startTime > 0
      ? activeDetailAthlete.startTime + etaElapsedSec
      : Math.floor(Date.now() / 1000) + Math.round(etaDeltaSec);

    const confidence = paceSamples.length >= 4 ? 'High' : paceSamples.length >= 2 ? 'Medium' : 'Low';

    return {
      label: next.label,
      etaElapsedSec,
      etaLocal: new Date(etaAbsSec * 1000),
      remainKm,
      paceSecPerKm: robustPace,
      confidence,
      basedOn: paceSamples.length > 0 ? `${Math.min(5, paceSamples.length)} split deltas (median)` : (activeDetailAthlete.predictedPaceSecPerKm ? 'predicted pace model' : 'overall observed average'),
    };
  }, [isDetailMode, activeDetailAthlete, effectiveStatus, ticketDef]);

  const raceStartAt = useMemo(() => {
    if (!isDetailMode || !activeDetailAthlete) return null;
    const candidates: Array<number | string | null | undefined> = [
      (resolvedContest as any)?.startTime,
      (resolvedContest as any)?.start_time,
      splitModel?.participantProfile?.contestEtd,
      splitModel?.participantProfile?.startTime,
      activeDetailAthlete?.startTime,
      (activeDetailAthlete as any)?.startTimestamp,
      (activeDetailAthlete as any)?.raceStartTime,
      (activeDetailAthlete as any)?.eventStartTime,
      (activeDetailAthlete as any)?.eventStartAt,
      (activeDetailAthlete as any)?.startDateTime,
      (activeDetailAthlete as any)?.eventDate,
    ];

    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === '') continue;
      if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
        const millis = candidate > 1_000_000_000_000 ? candidate : candidate * 1000;
        const date = new Date(millis);
        if (!Number.isNaN(date.getTime())) return date;
      }
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (!trimmed) continue;
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric) && numeric > 0) {
          const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
          const date = new Date(millis);
          if (!Number.isNaN(date.getTime())) return date;
        }
        const date = new Date(trimmed);
        if (!Number.isNaN(date.getTime())) return date;
      }
    }

    return null;
  }, [isDetailMode, activeDetailAthlete, resolvedContest, splitModel]);

  const isBeforeRace = useMemo(() => {
    if (!isDetailMode || !activeDetailAthlete) return false;
    const hasSplits = Array.isArray(activeDetailAthlete?.splits) && activeDetailAthlete.splits.length > 0;
    if (effectiveStatus === 'On Course' || effectiveStatus === 'Finished') return false;
    if (hasSplits) return false;
    return true;
  }, [isDetailMode, activeDetailAthlete, effectiveStatus]);

  const splitTimeline = useMemo(() => {
    if (!activeDetailAthlete) return [] as Array<{ id: string; name: string; reached: boolean; elapsedSec: number | null }>;

    const normalizeKey = (value: any) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const splitKeyCandidates = (split: any) => [
      split?.splitUuid,
      split?.uuid,
      split?.providerId,
      split?.providerCode,
      split?.rawSplitLabel,
      split?.splitName,
      split?.name,
      split?.label,
      split?.id,
    ]
      .map((value) => normalizeKey(value))
      .filter(Boolean);

    const athleteSplits = Array.isArray(activeDetailAthlete?.splits) ? activeDetailAthlete.splits : [];
    const reachedByKey = new Map<string, { elapsedSec: number | null }>();
    for (const split of athleteSplits) {
      const elapsedSec = typeof split?.time === 'number' && Number.isFinite(split.time) ? Number(split.time) : null;
      for (const key of splitKeyCandidates(split)) {
        if (!reachedByKey.has(key)) reachedByKey.set(key, { elapsedSec });
      }
    }

    const contestUuid = String((activeDetailAthlete as any)?.contestUuid || (activeDetailAthlete as any)?.contest_uuid || '').trim();
    const scopedSplits = contestUuid && timingConfiguration?.contestIndex && typeof timingConfiguration.contestIndex === 'object'
      ? timingConfiguration.contestIndex[contestUuid]?.splits
      : null;

    const definedSplits = Array.isArray(scopedSplits)
      ? scopedSplits
      : contestUuid && Array.isArray(timingConfiguration?.splitsByContest?.[contestUuid])
        ? timingConfiguration?.splitsByContest?.[contestUuid]
        : Array.isArray(timingConfiguration?.splits)
          ? timingConfiguration.splits
          : [];

    const orderedDefinedSplits = [...definedSplits].sort((a: any, b: any) => {
      const distanceA = Number(a?.distance ?? a?.cumulativeKm ?? a?.km ?? a?.order ?? 0);
      const distanceB = Number(b?.distance ?? b?.cumulativeKm ?? b?.km ?? b?.order ?? 0);
      if (Number.isFinite(distanceA) && Number.isFinite(distanceB) && distanceA !== distanceB) return distanceA - distanceB;
      const orderA = Number(a?.order ?? 0);
      const orderB = Number(b?.order ?? 0);
      if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) return orderA - orderB;
      return String(a?.name || a?.label || a?.id || '').localeCompare(String(b?.name || b?.label || b?.id || ''));
    });

    if (!orderedDefinedSplits.length) {
      return [...athleteSplits]
        .filter((split) => typeof split?.time === 'number' && split.time >= 0)
        .sort((a, b) => Number(a?.time || 0) - Number(b?.time || 0))
        .map((split, index) => ({
          id: String(split?.splitUuid || split?.uuid || split?.id || `split-${index + 1}`).trim() || `split-${index + 1}`,
          name: String(split?.label || split?.name || split?.rawSplitLabel || split?.segment || `Split ${index + 1}`).trim() || `Split ${index + 1}`,
          reached: true,
          elapsedSec: typeof split?.time === 'number' ? Number(split.time) : null,
        }));
    }

    return orderedDefinedSplits
      .map((row: any, index: number) => {
        const id = String(row?.splitUuid || row?.uuid || row?.id || row?.providerId || row?.providerCode || `split-${index + 1}`).trim() || `split-${index + 1}`;
        const name = String(row?.splitName || row?.name || row?.label || row?.raw?.name || row?.raw?.label || `Split ${index + 1}`).trim() || `Split ${index + 1}`;
        const keys = splitKeyCandidates(row);
        const reachedEntry = keys.map((key) => reachedByKey.get(key)).find(Boolean) || null;
        return {
          id,
          name,
          reached: Boolean(reachedEntry),
          elapsedSec: reachedEntry?.elapsedSec ?? null,
        };
      })
      .filter((row) => Boolean(row.name));
  }, [timingConfiguration, activeDetailAthlete]);

  if (!open) return null;

  // ============================================
  // DETAIL MODE (for AthleteDetailModal usage)
  // ============================================
  if (isDetailMode && activeDetailAthlete) {
    const validAvatarUrl = String(
      (activeDetailAthlete as any)?.avatarUrl ||
      (activeDetailAthlete as any)?.avatar_url ||
      (activeDetailAthlete as any)?.photoUrl ||
      (activeDetailAthlete as any)?.photo_url ||
      (activeDetailAthlete as any)?.profilePhoto ||
      (activeDetailAthlete as any)?.profile_photo ||
      (activeDetailAthlete as any)?.imageUrl ||
      (activeDetailAthlete as any)?.image ||
      (activeDetailAthlete as any)?.avatar ||
      (activeDetailAthlete as any)?.registration?.avatarUrl ||
      (activeDetailAthlete as any)?.registration?.photoUrl ||
      '',
    ).trim() || undefined;
    const resolvedCountry =
      (activeDetailAthlete as any)?.country ||
      (activeDetailAthlete as any)?.countryCode ||
      (activeDetailAthlete as any)?.country_code ||
      (activeDetailAthlete as any)?.countryName ||
      (activeDetailAthlete as any)?.countryAtRace ||
      (activeDetailAthlete as any)?.registration?.country ||
      (activeDetailAthlete as any)?.registration?.countryCode ||
      (activeDetailAthlete as any)?.registration?.country_code ||
      (activeDetailAthlete as any)?.nationality ||
      null;
    const resolvedCity = String((activeDetailAthlete as any)?.city || (activeDetailAthlete as any)?.registration?.city || '').trim();
    const resolvedState = String((activeDetailAthlete as any)?.state || (activeDetailAthlete as any)?.registration?.state || '').trim();
    const resolvedClub = String((activeDetailAthlete as any)?.clubName || (activeDetailAthlete as any)?.club || (activeDetailAthlete as any)?.registration?.clubName || '').trim();
    const resolvedCategory = String((activeDetailAthlete as any)?.category || (activeDetailAthlete as any)?.registration?.raceCategory || (activeDetailAthlete as any)?.contestName || '').trim();
    const resolvedRegistrationStatus = String((activeDetailAthlete as any)?.registrationStatus || (activeDetailAthlete as any)?.registration?.status || '').trim();
    const flagEmoji = getCountryFlagEmoji(resolvedCountry);
    const detailReadyAthlete = hydratedDetailAthlete || (!isDetailHydrating ? activeDetailAthlete : null);
    const detailReady = Boolean(detailReadyAthlete && !isTimingConfigurationLoading);
    const renderAthlete = detailReadyAthlete || activeDetailAthlete;
    const detailParticipant = renderAthlete || activeDetailAthlete;
    const participantLive = (renderAthlete as any)?.participantLive || null;
    const currentSection = splitModel?.currentSection || null;
    const currentPoint = splitModel?.currentPoint || null;
    const currentRank = splitModel?.rankSummary || { overall: null, gender: null, category: null };
    const contestSplits = Array.isArray((resolvedContest as any)?.splits) ? (resolvedContest as any).splits : [];
    const contestTimingPoints = Array.isArray((resolvedContest as any)?.timingPoints) ? (resolvedContest as any).timingPoints : [];
    const courseMaps = (resolvedTicketDef as any)?.courseMaps || (ticketDef as any)?.courseMaps || {};
    const splitNameByUuid = (contestSplits as any[]).reduce((acc: Record<string, string>, row: any) => {
      const key = String(row?.splitUuid || row?.uuid || row?.UUID || row?.id || '').trim().toLowerCase();
      const label = String(row?.splitName || row?.name || row?.label || row?.raw?.name || row?.raw?.label || '').trim();
      if (key && label) acc[key] = label;
      return acc;
    }, {} as Record<string, string>);
    const timingPointNameByUuid = (contestTimingPoints as any[]).reduce((acc: Record<string, string>, row: any) => {
      const key = String(row?.canonicalUuid || row?.providerId || row?.uuid || row?.UUID || row?.id || '').trim().toLowerCase();
      const label = String(row?.displayName || row?.shortName || row?.name || row?.label || '').trim();
      if (key && label) acc[key] = label;
      return acc;
    }, {} as Record<string, string>);
    const courseMetrics = computeCourseMetricsFromContest(resolvedContest || null);
    const courseOverview = {
      swim: normalizeDistanceKm(courseMaps.swimDistance) ?? Number(courseMetrics.swimDistanceKm || 0),
      bike: normalizeDistanceKm(courseMaps.bikeDistance) ?? Number(courseMetrics.bikeDistanceKm || 0),
      run: normalizeDistanceKm(courseMaps.runDistance ?? courseMaps.run2Distance ?? courseMaps.run1Distance) ?? Number(courseMetrics.runDistanceKm || 0),
      run1: normalizeDistanceKm(courseMaps.run1Distance) ?? 0,
      run2: normalizeDistanceKm(courseMaps.run2Distance) ?? 0,
    };
    const courseTotalDistanceKm = Number(
      (courseOverview.swim || 0)
      + (courseOverview.bike || 0)
      + (courseOverview.run || 0)
      + (courseOverview.run1 || 0)
      + (courseOverview.run2 || 0)
      || splitModel?.totalDistanceKm
      || 0,
    ) || 0;
    const raceNotStarted = isBeforeRace || Boolean(splitModel?.isNotStarted);
    const hasTimingReads = Boolean(
      participantLive?.lastTimingPointUuid
      || participantLive?.last_timing_point_uuid
      || participantLive?.currentSplitUuid
      || participantLive?.current_split_uuid
      || participantLive?.elapsed
      || participantLive?.elapsedSeconds
      || Number(participantLive?.distanceCovered || participantLive?.distance_completed || 0) > 0,
    );
    const isRegisteredWaiting = raceNotStarted || !hasTimingReads;
    const currentSplitUuid = String(participantLive?.currentSplitUuid || participantLive?.current_split_uuid || '').trim().toLowerCase();
    const lastTimingPointUuid = String(participantLive?.lastTimingPointUuid || participantLive?.last_timing_point_uuid || '').trim().toLowerCase();
    const resolvedCurrentSplitName = currentSplitUuid
      ? (splitNameByUuid[currentSplitUuid] || null)
      : null;
    const resolvedLastTimingPointName = lastTimingPointUuid
      ? (timingPointNameByUuid[lastTimingPointUuid] || null)
      : null;
    const liveDistanceCovered = isRegisteredWaiting
      ? 0
      : (Number(participantLive?.distanceCovered ?? participantLive?.distance_completed ?? currentPoint?.distanceKm ?? 0) || 0);
    const liveDistanceRemaining = isRegisteredWaiting
      ? courseTotalDistanceKm
      : (Number(participantLive?.distanceRemaining ?? participantLive?.distance_remaining ?? Math.max(0, courseTotalDistanceKm - liveDistanceCovered)) || 0);
    const liveCurrentLeg = isRegisteredWaiting
      ? 'Not Started'
      : (String(currentSection?.label || participantLive?.currentLeg || participantLive?.lastLegName || '').trim() || null);
    const liveCurrentSplit = isRegisteredWaiting
      ? 'Waiting for Start'
      : (String(currentSection?.label || resolvedCurrentSplitName || participantLive?.currentSplit || participantLive?.expectedNextSplit || currentPoint?.point?.displayName || currentPoint?.point?.shortName || '').trim() || null);
    const liveLastTimingPoint = isRegisteredWaiting
      ? '—'
      : (resolvedLastTimingPointName || String(participantLive?.lastTimingPointName || participantLive?.lastTimingPoint || '').trim() || '—');
    const liveAverageSpeed = Number(participantLive?.averageSpeed ?? participantLive?.speed ?? splitModel?.overallAverageSpeed ?? NaN);
    const liveAveragePace = Number(participantLive?.averagePace ?? participantLive?.pace ?? splitModel?.overallAveragePace ?? NaN);
    const liveOverallRank = isRegisteredWaiting ? null : (participantLive?.overallRank ?? currentRank.overall ?? null);
    const liveContestRank = isRegisteredWaiting ? null : (participantLive?.contestRank ?? currentRank.category ?? null);
    const liveGenderRank = isRegisteredWaiting ? null : (participantLive?.genderRank ?? currentRank.gender ?? null);
    const liveAgeGroupRank = isRegisteredWaiting ? null : (participantLive?.ageGroupRank ?? splitModel?.rankSummary.category ?? null);
    const courseCutoffs = (resolvedContest as any)?.cutoffs || (resolvedTicketDef as any)?.cutoffs || null;
    const swimDistance = Number(courseOverview.swim || 0);
    const bikeDistance = Number(courseOverview.bike || 0);
    const runDistance = Number(courseOverview.run || 0);
    const waitingText = 'Waiting for Start';
    const gpsLat = Number(participantLive?.lat ?? participantLive?.latitude ?? NaN);
    const gpsLng = Number(participantLive?.lng ?? participantLive?.longitude ?? NaN);
    const currentGpsText = Number.isFinite(gpsLat) && Number.isFinite(gpsLng) ? `${gpsLat.toFixed(5)}, ${gpsLng.toFixed(5)}` : 'Not Available';
    const currentSpeedText = isRegisteredWaiting
      ? '0 km/h'
      : (Number.isFinite(liveAverageSpeed) && liveAverageSpeed > 0 ? `${liveAverageSpeed.toFixed(2)} km/h` : waitingText);
    const scheduledStartText = formatScheduledStart(raceStartAt);

    return (
      <>
        <Dialog open={open} onOpenChange={onClose}>
          <DialogContent onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()} className="flex h-[80dvh] w-[96vw] max-w-[960px] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 p-0 text-slate-50 shadow-2xl selection:bg-sky-300 selection:text-slate-950 [-webkit-tap-highlight-color:transparent] sm:max-w-[960px] dark:border-slate-700 dark:bg-slate-950">
            <div className="relative flex flex-1 min-h-0 w-full max-w-full min-w-0 flex-col overflow-hidden bg-slate-950 text-slate-50 selection:bg-sky-300 selection:text-slate-950">
              <DialogClose className="absolute right-3 top-3 z-50 rounded-full border border-white/15 bg-slate-950/80 p-2 text-slate-200 shadow-lg transition hover:bg-slate-800 hover:text-white">
                <span className="sr-only">Close</span>
                ×
              </DialogClose>
              <DialogHeader className="flex-none border-b border-gray-700 p-3 pr-12 sm:p-4">
                {detailReady ? (
                  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    <Avatar className="h-14 w-14 border-2 border-primary/50 sm:h-16 sm:w-16">
                      <AvatarImage src={validAvatarUrl} alt={renderAthlete?.name || 'Athlete'} />
                      <AvatarFallback className="bg-primary/20 text-primary text-lg font-semibold sm:text-xl">{getInitials(renderAthlete?.name || 'Athlete')}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl text-yellow-400 sm:text-2xl">
                        <span className="min-w-0 truncate">{renderAthlete?.name || 'Athlete'}</span>
                        {flagEmoji ? (
                          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-sm leading-none shadow-sm">
                            {flagEmoji}
                          </span>
                        ) : null}
                        <span className="font-mono text-base text-slate-400 sm:text-lg">({renderAthlete?.bib || '—'})</span>
                      </DialogTitle>
                      <DialogDescription className="space-y-1 break-words text-xs text-gray-300 sm:text-sm">
                        <div>{renderAthlete?.gender || '—'} ·</div>
                        <div>
                          {resolvedCategory || 'Category pending'}
                          {resolvedRegistrationStatus ? ` · ${resolvedRegistrationStatus}` : ''}
                        </div>
                        {resolvedClub && (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-slate-900 shadow-sm dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-slate-100 sm:text-xs">
                              Proudly representing {resolvedClub}
                            </span>
                          </div>
                        )}
                        {(resolvedCity || resolvedState || resolvedCountry) && (
                          <div>{[resolvedCity, resolvedState, resolvedCountry].filter(Boolean).join(', ')}</div>
                        )}
                      </DialogDescription>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    <div className="h-14 w-14 animate-pulse rounded-full bg-white/10 sm:h-16 sm:w-16" />
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="h-6 w-2/3 animate-pulse rounded-lg bg-white/10" />
                      <div className="h-4 w-1/2 animate-pulse rounded-lg bg-white/10" />
                      <div className="h-4 w-3/4 animate-pulse rounded-lg bg-white/10" />
                    </div>
                  </div>
                )}
              </DialogHeader>
              <ScrollArea ref={detailScrollAreaRef} className="flex-1 min-h-0 w-full max-w-full min-w-0">
                <div className="w-full max-w-full min-w-0 space-y-3 overflow-hidden p-3 sm:p-4">
                {!detailReady ? renderAthleteDetailSkeleton() : (
                  <>
                {isBeforeRace ? (
                  <Card className="border-slate-700 bg-slate-800/50">
                    <CardHeader className="p-3">
                      <CardTitle className="text-sm font-semibold text-emerald-300">Race Status</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 p-3 text-sm text-slate-200">
                      <div className="rounded-md border border-emerald-700/60 bg-emerald-950/20 p-3">
                        <div className="font-semibold">🟢 Registered · Waiting for Start</div>
                        <div className="mt-1 text-xs text-slate-300">Timing has not started yet. Live tracking will begin once this athlete crosses the start timing point.</div>
                      </div>
                      {raceStartAt && scheduledStartText ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                            <div className="text-xs text-slate-400">Race Starts In</div>
                            <div className="font-semibold text-white">{formatCountdownDuration(raceStartAt)}</div>
                          </div>
                          <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                            <div className="text-xs text-slate-400">Scheduled Start</div>
                            <div className="font-semibold text-white">{scheduledStartText}</div>
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}

                <div className="grid gap-3 lg:grid-cols-2">
                  <Card className="border-slate-700 bg-slate-800/50">
                    <CardHeader className="p-3">
                      <CardTitle className="text-sm font-semibold text-yellow-300">Course Overview</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 p-3 text-xs sm:grid-cols-3">
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Swim</div>
                        <div className="font-semibold text-white">{formatDistanceValue(swimDistance) || waitingText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Bike</div>
                        <div className="font-semibold text-white">{formatDistanceValue(bikeDistance) || waitingText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Run</div>
                        <div className="font-semibold text-white">{formatDistanceValue(runDistance) || waitingText}</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-slate-700 bg-slate-800/50">
                    <CardHeader className="p-3">
                      <CardTitle className="text-sm font-semibold text-cyan-300">Current Position</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 p-3 text-xs sm:grid-cols-2">
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Distance Covered</div>
                        <div className="font-semibold text-white">{formatDistanceValue(liveDistanceCovered) || waitingText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Distance Remaining</div>
                        <div className="font-semibold text-white">{formatDistanceValue(liveDistanceRemaining) || waitingText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Current Leg</div>
                        <div className="font-semibold text-white">{liveCurrentLeg || waitingText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Current Split</div>
                        <div className="font-semibold text-white">{liveCurrentSplit || waitingText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Last Timing Point</div>
                        <div className="font-semibold text-white">{liveLastTimingPoint || waitingText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Current GPS</div>
                        <div className="font-semibold text-white">{currentGpsText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Current Speed</div>
                        <div className="font-semibold text-white">{currentSpeedText}</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-slate-700 bg-slate-800/50">
                    <CardHeader className="p-3">
                      <CardTitle className="text-sm font-semibold text-violet-300">Rankings</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 p-3 text-xs sm:grid-cols-2">
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Overall Rank</div>
                        <div className="font-semibold text-white">{Number.isFinite(Number(liveOverallRank)) && Number(liveOverallRank) > 0 ? `#${liveOverallRank}` : waitingText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Contest Rank</div>
                        <div className="font-semibold text-white">{Number.isFinite(Number(liveContestRank)) && Number(liveContestRank) > 0 ? `#${liveContestRank}` : waitingText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Gender Rank</div>
                        <div className="font-semibold text-white">{Number.isFinite(Number(liveGenderRank)) && Number(liveGenderRank) > 0 ? `#${liveGenderRank}` : waitingText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Age Group Rank</div>
                        <div className="font-semibold text-white">{Number.isFinite(Number(liveAgeGroupRank)) && Number(liveAgeGroupRank) > 0 ? `#${liveAgeGroupRank}` : waitingText}</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-slate-700 bg-slate-800/50">
                    <CardHeader className="p-3">
                      <CardTitle className="text-sm font-semibold text-orange-300">Cutoffs</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 p-3 text-xs sm:grid-cols-2">
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Current Cutoff</div>
                        <div className="font-semibold text-white">{String(participantLive?.cutoffReason || courseCutoffs?.mode || waitingText)}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Cutoff Status</div>
                        <div className="font-semibold text-white">{String(participantLive?.cutoffStatus || waitingText)}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Time Remaining</div>
                        <div className="font-semibold text-white">{participantLive?.estimatedFinish ? 'Calculated' : waitingText}</div>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                        <div className="text-slate-400">Status</div>
                        <div className="font-semibold text-white">{participantLive?.dnf ? '🔴 DNF' : participantLive?.cutoffStatus || 'Within Cutoff'}</div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {missedCutoffInfo ? (
                  <Card className="bg-orange-950/30 border-orange-700/60">
                    <CardContent className="p-3 text-xs text-orange-200">
                      Cutoff missed at {missedCutoffInfo.segment}: athlete {missedCutoffInfo.yourTime} vs cutoff {missedCutoffInfo.cutoff}.
                    </CardContent>
                  </Card>
                ) : null}

                {nextSplitPrediction && (
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="p-3">
                      <CardTitle className="text-sm font-semibold text-yellow-300">Next Split Prediction (Robust)</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                          <p className="text-slate-400">Next Checkpoint</p>
                          <p className="font-semibold text-white mt-1">{nextSplitPrediction.label}</p>
                        </div>
                        <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                          <p className="text-slate-400">ETA (Time of Day)</p>
                          <p className="font-semibold text-white mt-1">{nextSplitPrediction.etaLocal.toLocaleTimeString()}</p>
                        </div>
                        <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                          <p className="text-slate-400">ETA (Elapsed)</p>
                          <p className="font-mono text-white mt-1">{formatSecondsToHMS(nextSplitPrediction.etaElapsedSec)}</p>
                        </div>
                        <div className="rounded-md border border-slate-700 bg-slate-900/50 p-2">
                          <p className="text-slate-400">Remaining Distance</p>
                          <p className="font-mono text-white mt-1">{nextSplitPrediction.remainKm.toFixed(2)} km</p>
                        </div>
                      </div>
                      <div className="mt-3 text-[11px] text-slate-400 space-y-1">
                        <p>Model pace: <span className="font-mono text-slate-200">{formatSecondsToHMS(nextSplitPrediction.paceSecPerKm)}/km</span></p>
                        <p>Confidence: <span className="text-slate-200">{nextSplitPrediction.confidence}</span> · Basis: <span className="text-slate-200">{nextSplitPrediction.basedOn}</span></p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {(effectiveStatus === 'On Course' || effectiveStatus === 'Finished') && (
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="p-3">
                      <CardTitle className="text-lg font-semibold text-yellow-300">Race Progress</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3">
                      <RaceProgressBar
                        athlete={activeDetailAthlete}
                        timingConfiguration={timingConfiguration}
                        participant={participantsByBib[String(detailParticipant?.bib || '').trim()] || detailParticipant || null}
                        participantsByBib={participantsByBib}
                        ticketDef={resolvedTicketDef}
                      />
                    </CardContent>
                  </Card>
                )}

                <div className="w-full max-w-full min-w-0 space-y-3 pt-2">
                  {timingConfiguration?.splitsEnabledForAthleteDashboard ? (
                    <>
                      <h3 className="font-semibold text-base sm:text-lg text-yellow-300">Splits Summary</h3>
                      <DynamicSplitSummaryTable
                        athlete={detailParticipant}
                        timingConfiguration={timingConfiguration}
                        participant={participantsByBib[String(detailParticipant?.bib || '').trim()] || detailParticipant || null}
                        participantsByBib={participantsByBib}
                        ticketDef={resolvedTicketDef}
                        isLoading={!detailReady}
                      />
                    </>
                  ) : null}
                </div>
                </>
                )}
                </div>
              </ScrollArea>
            <DialogFooter className="flex-none border-t border-gray-700 bg-slate-900/95 p-3 sm:p-4">
              <Button onClick={onClose} variant="secondary">Close</Button>
            </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
        <UpcomingEventsModal isOpen={isEventModalOpen} onClose={() => setIsEventModalOpen(false)} />
      </>
    );
  }

  // ============================================
  // LIVE MODE (original AthleteLiveModalPro)
  // ============================================
  const liveResolvedCountry = (liveAthlete as any)?.country || (liveAthlete as any)?.countryAtRace || (liveAthlete as any)?.registration?.country || (liveAthlete as any)?.nationality || null;
  const liveFlagEmoji = getCountryFlagEmoji(liveResolvedCountry);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-4xl max-h-[calc(100dvh-1rem)] p-0 overflow-hidden rounded-2xl flex flex-col bg-slate-950 text-slate-50 selection:bg-sky-300 selection:text-slate-950 [-webkit-tap-highlight-color:transparent] dark:bg-slate-950 dark:text-slate-50">

        {/* ========================= */}
        {/* 🔥 MAP */}
        {/* ========================= */}
        <div className="h-[240px] sm:h-[320px] bg-black relative shrink-0">

          {loading ? (
            <div className="flex items-center justify-center h-full text-white">
              <Loader2 className="animate-spin" />
            </div>
          ) : (
            mapUrl && (
              <iframe
                width="100%"
                height="100%"
                loading="lazy"
                src={mapUrl}
                style={{ border: "none" }}
              />
            )
          )}

          {/* LIVE badge */}
          <div className="absolute top-3 left-3 bg-red-600 px-3 py-1 text-white text-xs rounded-full font-bold animate-pulse">
            LIVE
          </div>

          {/* Bib */}
          <div className="absolute bottom-3 left-3 bg-black/70 px-3 py-1 rounded text-white font-mono text-lg">
            #{liveAthlete?.bibNumber}
          </div>
        </div>

        {/* ========================= */}
        {/* 🔥 CONTENT */}
        {/* ========================= */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 bg-gradient-to-br from-slate-950 to-slate-900 text-slate-50 space-y-4">

          {/* HEADER */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-bold sm:text-2xl">
                  {liveAthlete?.name || "Athlete"}
                </h2>
                {liveFlagEmoji ? (
                  <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-sm shadow-sm">
                    {liveFlagEmoji}
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-gray-500">
                {liveAthlete?.checkpoint || "On Course"}
              </p>
            </div>

            <div className="text-right">
              <p className="text-xs text-gray-500">Last Update</p>
              <p className="font-medium text-sm">
                {formatTime(liveAthlete?.timestamp)}
              </p>
            </div>
          </div>

          {/* ========================= */}
          {/* 🔥 STATS */}
          {/* ========================= */}
          <div className="grid grid-cols-4 gap-3">

            <StatCard
              icon={<Activity className="w-4 h-4" />}
              label="Distance"
              value={`${((liveAthlete?.distance as number) || 0).toFixed(1)} km`}
            />

            <StatCard
              icon={<Clock className="w-4 h-4" />}
              label="Speed"
              value={`${((liveAthlete?.speed as number) || 0).toFixed(1)} km/h`}
            />

            <StatCard
              icon={<Trophy className="w-4 h-4" />}
              label="Rank"
              value={`#${liveAthlete?.rank || "--"}`}
            />

            <StatCard
              icon={<MapPin className="w-4 h-4" />}
              label="Status"
              value="Live"
            />
          </div>

          {/* ========================= */}
          {/* 🔥 PROGRESS BAR */}
          {/* ========================= */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium">Race Progress</span>
              <span className="font-semibold">{progress.toFixed(1)}%</span>
            </div>

            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* ========================= */}
          {/* 🔥 SPLITS / TIMELINE */}
          {/* ========================= */}
          <div className="border-t pt-3">
            <h3 className="text-sm font-semibold mb-2">
              Live Details
            </h3>

            <div className="space-y-2 text-sm">
              <Row label="Checkpoint" value={liveAthlete?.checkpoint || "On Course"} />
              <Row label="Latitude" value={(liveAthlete?.lat as number)?.toFixed(4)} />
              <Row label="Longitude" value={(liveAthlete?.lng as number)?.toFixed(4)} />
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// 🔥 STAT CARD
// ============================================

function StatCard({ icon, label, value }: any) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/95 shadow-sm p-3 text-center text-slate-50">
      <div className="text-slate-400 flex justify-center mb-1">
        {icon}
      </div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-bold text-sm text-slate-50">{value}</div>
    </div>
  );
}

// ============================================
// 🔥 ROW
// ============================================

function Row({ label, value }: any) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{value || "--"}</span>
    </div>
  );
}

// ============================================
// 🔥 TIME FORMAT
// ============================================

function formatTime(ts?: string) {
  if (!ts) return "--";
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "--";
  }
}

