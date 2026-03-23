
// src/components/live-tracking/AthleteDetailModal.tsx
"use client";

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import type { LiveAthlete, Split, Leg, Status, TicketDefinition, EventCalendarEntry, CustomSplitPoint } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Waves, ChevronsRight, Bike, Footprints, Flag, Trophy, Target, Meh, PlayCircle, Star, Timer, Rocket, AlertTriangle, CalendarSearch, Loader2, User as UserIcon, LocateFixed, Route, Hourglass, CheckCircle2, Clock } from 'lucide-react';
import { isDuathlonEvent, formatSecondsToHMS, hmsToSeconds, isValidImageUrl, getInitials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '../ui/scroll-area';
import Link from 'next/link';
import { getCalendarEventsAction } from '@/lib/actions';
import EventDisplayCard from '@/components/events/EventDisplayCard';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { cn } from "@/lib/utils";
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Separator } from '@/components/ui/separator';
import SplitDetails from './SplitDetails';


// Map from country names to ISO 3166-1 alpha-2 codes
const countryNameToCode: { [key: string]: string } = {
    'India': 'IN', 'United States': 'US', 'USA / Canada': 'US', 'United Kingdom': 'GB', 'Canada': 'CA',
    'Australia': 'AU', 'Germany': 'DE', 'France': 'FR', 'Singapore': 'SG', 'United Arab Emirates': 'AE',
    'Afghanistan': 'AF', 'Brazil': 'BR', 'China': 'CN', 'Egypt': 'EG', 'Japan': 'JP',
    'Mexico': 'MX', 'Nigeria': 'NG', 'Russia': 'RU', 'South Africa': 'ZA', 'Other': 'XX'
};

const getCountryFlagEmoji = (countryName?: string | null): string => {
    if (!countryName) return '';
    const countryCode = countryNameToCode[countryName];
    if (!countryCode || countryCode === 'XX') return '';
    return String.fromCodePoint(...Array.from(countryCode.toUpperCase()).map(c => 0x1F1A5 + c.charCodeAt(0)));
};

const LegIcon = ({ leg, className }: { leg: Leg | 'NOT_STARTED' | 'FINISHED'; className?: string }) => {
    const baseClass = "h-4 w-4";
    switch (leg) {
        case 'SWIM': return <Waves className={cn(baseClass, "text-blue-500", className)} />;
        case 'T1': case 'T2': return <ChevronsRight className={cn(baseClass, "text-gray-500", className)} />;
        case 'BIKE': return <Bike className={cn(baseClass, "text-green-600", className)} />;
        case 'RUN': case 'RUN1': case 'RUN2': return <Footprints className={cn(baseClass, "text-orange-600", className)} />;
        case 'FINISH':
        case 'FINISHED':
             return <Flag className={cn(baseClass, "text-black", className)} />;
        default: return <Clock className={cn(baseClass, "text-gray-400", className)} />;
    }
};

const getLegTime = (athlete: LiveAthlete, leg: Leg): number | undefined => {
    const summaryTime = (athlete.summary as any)?.[leg];
    if (summaryTime) {
        return summaryTime;
    }

    if (athlete.startTime === null || athlete.startTime === undefined || athlete.startTime === 0) {
        const legSplit = athlete.splits.find(s => s.segment === leg);
        if (legSplit?.time && legSplit.time > 0) return legSplit.time;
        const athleteAsRaceResult = { splits: athlete.splits, ...athlete.splits.reduce((acc, s) => ({...acc, [s.segment.toLowerCase()]: formatSecondsToHMS(s.time)}), {}) } as any; 
        const timeStr = athleteAsRaceResult[leg.toLowerCase()];
        if (timeStr) return hmsToSeconds(timeStr);
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

const RaceProgressBar: React.FC<{
    athlete: LiveAthlete;
    leg: Leg | 'NOT_STARTED';
    progress: number;
    category: string;
    splits: Split[];
    startTime: number | null;
}> = ({ athlete, leg, progress, category, splits, startTime }) => {
    const isDua = useMemo(() => isDuathlonEvent(category), [category]);
    
    const segments = useMemo(() => isDua ? ['RUN1', 'T1', 'BIKE', 'T2', 'RUN2'] : ['SWIM', 'T1', 'BIKE', 'T2', 'RUN'], [isDua]);
    const totalSegments = segments.length;
    
    const legMap: Record<Leg | 'NOT_STARTED', number> = {
        'NOT_STARTED': 0, 'SWIM': 0, 'RUN1': 0, 
        'T1': 1, 'BIKE': 2, 'T2': 3, 
        'RUN': 4, 'RUN2': 4, 'FINISH': 5, 'FINISHED': 5,
    };
    
    const currentSegmentIndex = legMap[leg] ?? 0;
    const progressWithinSegment = (progress || 0) / 100;
    const athletePosition = currentSegmentIndex + progressWithinSegment;
    const totalProgressPercentage = athlete.status === 'Finished' ? 100 : Math.min(100, (athletePosition / totalSegments) * 100);

    const legTimes = useMemo(() => {
        return segments.reduce((acc, segmentName) => {
            acc[segmentName as keyof typeof acc] = getLegTime(athlete, segmentName as Leg);
            return acc;
        }, {} as Record<string, number | undefined>);
    }, [athlete, segments]);

    return (
        <div className="w-full pt-2">
             <div className="flex justify-between items-center mb-1">
                {segments.map((segmentName, i) => {
                    const isCompleted = athlete.status === 'Finished' || currentSegmentIndex > i;
                    const isCurrent = currentSegmentIndex === i && athlete.status !== 'Finished';
                    const timeForLeg = legTimes[segmentName as keyof typeof legTimes];
                    return (
                        <div key={i} className="z-10 flex flex-col items-center flex-1">
                             <span className={`text-xs font-medium mb-1 ${isCurrent || isCompleted ? 'text-primary' : 'text-muted-foreground'}`}>{segmentName}</span>
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-colors duration-300 ${
                                isCompleted ? 'bg-primary border-primary' : isCurrent ? 'bg-background border-primary scale-110' : 'bg-background border-border'
                            }`}>
                                <LegIcon leg={segmentName as Leg} className={`h-4 w-4 transition-colors duration-300 ${isCompleted ? 'text-primary-foreground' : isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
                            </div>
                            <p className="font-mono text-[10px] mt-1 text-muted-foreground">
                                {timeForLeg !== undefined ? formatSecondsToHMS(timeForLeg) : '--:--'}
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

interface AthleteDetailModalProps {
  athlete: LiveAthlete | null;
  isOpen: boolean;
  onClose: () => void;
  ticketDef?: TicketDefinition | null;
}

export default function AthleteDetailModal({ athlete, isOpen, onClose, ticketDef }: AthleteDetailModalProps) {
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (isOpen && athlete?.status === 'On Course') {
      const timer = setInterval(() => setNow(new Date()), 1000);
      return () => clearInterval(timer);
    }
  }, [isOpen, athlete?.status]);

  const elapsedTime = useMemo(() => {
    if (!athlete) return '00:00:00';
    
    if (athlete.status === 'Finished') {
        const finishSeconds = athlete.summary?.FINISHED;
        if (typeof finishSeconds === 'number') return formatSecondsToHMS(finishSeconds);
    }
    
    if (athlete.startTime && athlete.startTime > 0 && athlete.status === 'On Course') {
        const elapsed = (now.getTime() / 1000) - athlete.startTime;
        return formatSecondsToHMS(elapsed > 0 ? elapsed : 0);
    }
    
    if (athlete.splits && athlete.splits.length > 0) {
        const lastSplit = athlete.splits[athlete.splits.length - 1];
        if (lastSplit && lastSplit.time > 0) {
            if (athlete.startTime === 0) return formatSecondsToHMS(lastSplit.time);
        }
    }

    return '00:00:00';
  }, [athlete, now]);

  const missedCutoffInfo = useMemo(() => {
    if (athlete?.status.startsWith('DNF') && athlete?.cutoffReason && ticketDef?.cutoffs) {
        const cutoffs = ticketDef.cutoffs;
        let segmentLabel = athlete.cutoffReason.replace('_CUTOFF', '');
        let cutoffTimeStr: string | null | undefined = null;
        let athleteTimeSeconds: number | undefined = undefined;

        if (cutoffs.mode === 'segment') {
            switch(segmentLabel) {
                case 'SWIM': 
                    cutoffTimeStr = cutoffs.swim;
                    athleteTimeSeconds = athlete.summary?.SWIM || undefined;
                    break;
                case 'BIKE':
                    cutoffTimeStr = cutoffs.bike;
                    athleteTimeSeconds = athlete.summary?.BIKE || undefined;
                    break;
                case 'RUN':
                    cutoffTimeStr = cutoffs.run;
                    athleteTimeSeconds = athlete.summary?.RUN || undefined;
                    break;
            }
        } else if (cutoffs.mode === 'overall') {
            cutoffTimeStr = cutoffs.overall;
            athleteTimeSeconds = athlete.summary?.FINISH || athlete.summary?.FINISHED || undefined;
        }

        if (cutoffTimeStr && athleteTimeSeconds) {
             return {
                segment: segmentLabel,
                yourTime: formatSecondsToHMS(athleteTimeSeconds),
                cutoff: cutoffTimeStr,
             };
        }
    }
    return null;
  }, [athlete, ticketDef]);

  const finishTime = useMemo(() => {
    const finishSeconds = athlete?.summary?.FINISHED;
    if (athlete?.status === 'Finished' && typeof finishSeconds === 'number') {
      return formatSecondsToHMS(finishSeconds);
    }
    return null;
  }, [athlete]);

  const isDua = useMemo(() => isDuathlonEvent(athlete?.ticketName), [athlete?.ticketName]);
  
  const legs = useMemo(() => {
    if (!athlete || !athlete.summary) return [];
    const resultLegs: { segment: Leg; label: string; time: number | null | undefined; distance: number | null | undefined; legType: 'swim' | 'bike' | 'run' | 'transition' }[] = [];
    const courseMaps = ticketDef?.courseMaps;

    if (isDua) {
        if (athlete.summary?.RUN1) resultLegs.push({ segment: 'RUN1', label: 'Run 1', time: athlete.summary.RUN1, distance: courseMaps?.run1Distance, legType: 'run' });
        if (athlete.summary?.T1) resultLegs.push({ segment: 'T1', label: 'T1', time: athlete.summary.T1, distance: null, legType: 'transition' });
        if (athlete.summary?.BIKE) resultLegs.push({ segment: 'BIKE', label: 'Bike', time: athlete.summary.BIKE, distance: courseMaps?.bikeDistance, legType: 'bike' });
        if (athlete.summary?.T2) resultLegs.push({ segment: 'T2', label: 'T2', time: athlete.summary.T2, distance: null, legType: 'transition' });
        if (athlete.summary?.RUN2) resultLegs.push({ segment: 'RUN2', label: 'Run 2', time: athlete.summary.RUN2, distance: courseMaps?.run2Distance, legType: 'run' });
    } else { // Default to Triathlon
        if (athlete.summary?.SWIM) resultLegs.push({ segment: 'SWIM', label: 'Swim', time: athlete.summary.SWIM, distance: courseMaps?.swimDistance, legType: 'swim' });
        if (athlete.summary?.T1) resultLegs.push({ segment: 'T1', label: 'T1', time: athlete.summary.T1, distance: null, legType: 'transition' });
        if (athlete.summary?.BIKE) resultLegs.push({ segment: 'BIKE', label: 'Bike', time: athlete.summary.BIKE, distance: courseMaps?.bikeDistance, legType: 'bike' });
        if (athlete.summary?.T2) resultLegs.push({ segment: 'T2', label: 'T2', time: athlete.summary.T2, distance: null, legType: 'transition' });
        if (athlete.summary?.RUN) resultLegs.push({ segment: 'RUN', label: 'Run', time: athlete.summary.RUN, distance: courseMaps?.runDistance, legType: 'run' });
    }
    return resultLegs;
  }, [athlete, isDua, ticketDef]);

  const flagEmoji = useMemo(() => getCountryFlagEmoji((athlete as any)?.country), [athlete]);
  const validAvatarUrl = athlete && isValidImageUrl(athlete.avatarUrl) ? athlete.avatarUrl : undefined;

  if (!isOpen || !athlete) return null;

  return (
      <>
          <Dialog open={isOpen} onOpenChange={onClose}>
              <DialogContent className="sm:max-w-xl bg-slate-900 border-gray-700 text-white p-0">
                  <DialogHeader className="p-4 border-b border-gray-700">
                      <div className="flex items-center gap-4">
                          <Avatar className="h-16 w-16 border-2 border-primary/50">
                              <AvatarImage src={validAvatarUrl} alt={athlete.name} />
                              <AvatarFallback className="bg-primary/20 text-primary text-xl font-semibold">{getInitials(athlete.name)}</AvatarFallback>
                          </Avatar>
                          <div>
                              <DialogTitle className="text-2xl text-yellow-400 flex items-center gap-2">
                                 <span>{flagEmoji} {athlete.name}</span>
                                 <span className="text-slate-400 font-mono">({athlete.bib})</span>
                              </DialogTitle>
                              <DialogDescription className="text-gray-400">{athlete.ageGroup} - {athlete.gender}</DialogDescription>
                          </div>
                      </div>
                  </DialogHeader>
                  <ScrollArea className="max-h-[70vh]">
                      <div className="p-4 space-y-4">
                          <StatusMessage status={athlete.status as Status} name={athlete.name} finishTime={finishTime} onFindRaceClick={() => setIsEventModalOpen(true)} missedCutoffInfo={missedCutoffInfo} elapsedTime={elapsedTime}/>

                           {(athlete.status === 'On Course' || athlete.status === 'Finished') && (
                                <Card className="bg-slate-800/50 border-slate-700">
                                    <CardHeader className="p-3">
                                        <CardTitle className="text-lg font-semibold text-yellow-300">Race Progress</CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-3">
                                        <RaceProgressBar
                                            athlete={athlete}
                                            category={athlete.category}
                                            leg={athlete.leg as Leg | 'NOT_STARTED'}
                                            progress={athlete.legProgressPct || 0}
                                            splits={athlete.splits}
                                            startTime={athlete.startTime}
                                        />
                                    </CardContent>
                                </Card>
                            )}

                          <div className="space-y-3 pt-4">
                             <h3 className="font-semibold text-lg text-yellow-300">Splits Summary</h3>
                             {legs.length > 0 ? (
                                <div className="space-y-1">
                                    {legs.map(leg => (
                                        <SplitDetails 
                                            key={leg.segment}
                                            leg={leg.segment as Leg}
                                            label={leg.label}
                                            distanceKm={leg.distance}
                                            rawSplits={athlete.splits || []}
                                            athlete={athlete}
                                            ticketDef={ticketDef}
                                        />
                                    ))}
                                </div>
                              ) : (
                                <p className="text-slate-400 text-sm">No splits summary available yet.</p>
                              )}
                          </div>
                      </div>
                  </ScrollArea>
                  <DialogFooter className="p-4 border-t border-gray-700">
                      <Button onClick={onClose} variant="secondary">Close</Button>
                  </DialogFooter>
              </DialogContent>
          </Dialog>
          <UpcomingEventsModal isOpen={isEventModalOpen} onClose={() => setIsEventModalOpen(false)} />
      </>
  );
}
