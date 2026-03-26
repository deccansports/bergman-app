// src/components/live-tracking/BergmanTrackerCard.tsx
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import type { LiveAthlete, Status, Leg, Split } from '@/lib/types';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Waves, ChevronsRight, Bike, Footprints, Flag, Clock, MapPin, User as UserIcon, Building, ShieldCheck, AlertTriangle, TrendingUp, LocateFixed, Route, Hourglass } from 'lucide-react';
import { isDuathlonEvent, formatSecondsToHMS, hmsToSeconds, isValidImageUrl, getInitials } from '@/lib/utils';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";

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

const getStatusBadgeVariant = (status: Status) => {
  switch (status) {
    case 'Finished': return 'default';
    case 'On Course': return 'secondary';
    case 'Not Started': return 'outline';
    default: return 'destructive';
  }
}

const findSplit = (splits: Split[], segment: string): Split | undefined => {
  return splits.find(s => s.segment === segment);
};

const getLegTime = (athlete: LiveAthlete, leg: Leg): number | undefined => {
    const summaryTime = (athlete.summary as any)?.[leg];
    if (summaryTime) {
        return summaryTime;
    }

    if (athlete.startTime === null || athlete.startTime === undefined) {
        const legSplit = findSplit(athlete.splits, leg);
        if (legSplit?.time && legSplit.time > 0) return legSplit.time;
        const athleteAsRaceResult = { splits: athlete.splits, ...athlete.splits.reduce((acc, s) => ({...acc, [s.segment.toLowerCase()]: formatSecondsToHMS(s.time)}), {}) } as any; 
        const timeStr = athleteAsRaceResult[leg.toLowerCase()];
        if (timeStr) return hmsToSeconds(timeStr);
        return undefined;
    }
    
    const legSplit = findSplit(athlete.splits, leg);
    if (!legSplit?.time) return undefined;

    const prevLeg: Leg | undefined = leg === 'T1' ? (isDuathlonEvent(athlete.category) ? 'RUN1' : 'SWIM')
        : leg === 'BIKE' ? 'T1'
        : leg === 'T2' ? 'BIKE'
        : leg === 'RUN' ? 'T2'
        : leg === 'RUN2' ? 'T2'
        : undefined;

    if (prevLeg) {
        const prevLegSplit = findSplit(athlete.splits, prevLeg);
        if (prevLegSplit?.time) {
            return legSplit.time - prevLegSplit.time;
        }
    }
    
    return legSplit.time - athlete.startTime;
};


const RaceProgressBar: React.FC<{
    athlete: LiveAthlete;
    leg: Leg | 'NOT_STARTED';
    progress: number; // 0 to 100
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
                <div className="absolute top-1/2 left-4 right-4 h-1 bg-muted rounded-full -translate-y-1/2" />
                <motion.div 
                  className="absolute top-1/2 left-4 h-1 bg-primary rounded-full -translate-y-1/2"
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
                    <div className="w-4 h-4 bg-yellow-400 border-2 border-background rounded-full -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
                        <UserIcon className="h-2 w-2 text-background" />
                    </div>
                </motion.div>
            </div>
        </div>
    );
};


interface LiveDataTickerProps {
  data: LiveAthlete;
  elapsedTime: string;
}

const LiveDataTicker = ({ data, elapsedTime }: LiveDataTickerProps) => {
    const stats = [
        { icon: Clock, label: 'Elapsed Time', value: elapsedTime },
        { icon: Route, label: data.status === 'Finished' ? 'Total Dist.' : 'Dist. Covered', value: `${(data.courseProgress || 0).toFixed(2)} km` },
        { icon: LocateFixed, label: 'Current Pace', value: data.predictedPaceSecPerKm ? `${Math.floor(data.predictedPaceSecPerKm / 60)}:${String(Math.round(data.predictedPaceSecPerKm % 60)).padStart(2, '0')} /km` : '-' },
        { icon: Hourglass, label: 'ETA Next Split', value: data.etaNextSplitUTC && data.startTime ? formatSecondsToHMS(new Date(data.etaNextSplitUTC * 1000).getTime()/1000 - data.startTime) : '-' },
        { icon: Flag, label: 'ETA Finish', value: data.etaFinishUTC && data.startTime ? formatSecondsToHMS(new Date(data.etaFinishUTC * 1000).getTime()/1000 - data.startTime) : '-' },
    ].filter(s => s.value !== '-');

    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if(stats.length <= 1) return;
        const interval = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % stats.length);
        }, 3000);
        return () => clearInterval(interval);
    }, [stats.length]);

    if (stats.length === 0) return null;

    const currentStat = stats[currentIndex];

    return (
        <motion.div
            key={currentIndex}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center"
        >
            <p className="font-bold text-lg text-primary">{currentStat.value}</p>
            <p className="text-muted-foreground text-xs flex items-center gap-1"><currentStat.icon className="h-3 w-3" />{currentStat.label}</p>
        </motion.div>
    );
};

interface BergmanTrackerCardProps {
  data: LiveAthlete, 
  onViewMap?: (athleteId: string) => void;
  onRemove: (id: string) => void, 
  onSelect: (athlete: LiveAthlete) => void
}

export default function BergmanTrackerCard({ data, onViewMap, onRemove, onSelect }: BergmanTrackerCardProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (data.status === 'On Course') {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }
  }, [data.status]);
  
  const elapsedTime = useMemo(() => {
    if (data.status === 'Finished') {
        const finishSeconds = data.summary?.FINISHED;
        if (typeof finishSeconds === 'number') return formatSecondsToHMS(finishSeconds);
    }
    
    if (data.startTime && data.startTime > 0 && data.status === 'On Course') {
        const elapsed = (now.getTime() / 1000) - data.startTime;
        return formatSecondsToHMS(elapsed > 0 ? elapsed : 0);
    }
    
    // Fallback for historical DNF/DNS etc.
    if (data.splits && data.splits.length > 0) {
        const lastSplit = data.splits[data.splits.length - 1];
        if (lastSplit && lastSplit.time > 0) {
            // If the time is a cumulative time for a historical event, it's the elapsed time.
            if(data.startTime === 0) return formatSecondsToHMS(lastSplit.time);
        }
    }

    return '00:00:00';
  }, [data, now]);
  
  const finishTime = useMemo(() => {
    const finishSeconds = data.summary?.FINISHED;
    if (data.status === 'Finished' && typeof finishSeconds === 'number') {
      return formatSecondsToHMS(finishSeconds);
    }
    return null;
  }, [data]);

  const validAvatarUrl = data && isValidImageUrl(data.avatarUrl) ? data.avatarUrl : undefined;

  return (
    <Card className="bg-gray-50 cursor-pointer hover:bg-gray-100" onClick={() => onSelect(data)}>
      <CardHeader className="p-3 flex flex-row items-start justify-between">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src={validAvatarUrl} />
            <AvatarFallback>{getInitials(data.name)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold text-sm">{data.name}</p>
            <div className="flex items-center gap-2">
                <p className="text-xs text-gray-500">BIB: {data.bib}</p>
                {data.clubName && <p className="text-xs text-gray-500 flex items-center gap-1"><Building className="h-3 w-3"/>{data.clubName}</p>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onViewMap && (
             <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onViewMap(data.id);}}>
               <MapPin className="h-4 w-4 text-blue-600" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onRemove(data.id);}} className="h-6 w-6">
            <X className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs space-y-3">
        {data.status === 'Finished' ? (
          <div className="text-center p-4 my-2 bg-green-100/50 border border-green-200 rounded-lg">
            <p className="text-sm font-semibold text-green-700">Finished!</p>
            <p className="text-4xl font-bold font-mono text-green-800 tracking-tighter">{finishTime}</p>
          </div>
        ) : data.status === 'On Course' ? (
          <div className="text-center p-4 my-2 bg-blue-100/50 border border-blue-200 rounded-lg h-[90px] flex flex-col justify-center">
             <LiveDataTicker data={data} elapsedTime={elapsedTime}/>
          </div>
        ) : (
          <div className="text-center p-4 my-2">
            <Badge variant={getStatusBadgeVariant(data.status as Status)} className="text-xs">{data.status}</Badge>
          </div>
        )}
        
        <RaceProgressBar 
          athlete={data} 
          leg={data.leg as Leg | 'NOT_STARTED'} 
          progress={data.legProgressPct || 0} 
          category={data.category} 
          splits={data.splits || []} 
          startTime={data.startTime} 
        />
        
        {data.status === 'On Course' && data.cutoffStatus && data.cutoffStatus !== 'N/A' && (
            <div className={`p-2 rounded-md border text-center ${data.cutoffStatus === 'On Track' ? 'bg-green-50 border-green-100' : 'bg-orange-50 border-orange-100'}`}>
                {data.cutoffStatus === 'On Track' ? (
                    <p className="font-semibold text-sm text-green-700 flex items-center justify-center gap-1"><ShieldCheck className="h-4 w-4"/>On Track</p>
                ) : (
                     <p className="font-semibold text-sm text-orange-700 flex items-center justify-center gap-1"><AlertTriangle className="h-4 w-4"/>May Miss Cutoff</p>
                )}
                <p className="text-muted-foreground text-[10px]">Cutoff Status</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
};
