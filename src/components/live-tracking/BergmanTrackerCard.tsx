// src/components/live-tracking/BergmanTrackerCard.tsx
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import type { LiveAthlete, Status, Leg, Split } from '@/lib/types';
import type { ResolvedTimingConfiguration } from '@/lib/timingConfiguration';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Waves, ChevronsRight, Bike, Footprints, Flag, Clock, MapPin, User as UserIcon, Building, ShieldCheck, AlertTriangle, TrendingUp, LocateFixed, Route, Hourglass, X } from 'lucide-react';
import { isDuathlonEvent, formatSecondsToHMS, hmsToSeconds, isValidImageUrl, getInitials, normalizeStatus } from '@/lib/utils';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";
import { buildSplitModalModel } from './split-modal/utils';

const countryNameToCode: Record<string, string> = {
  india: 'IN',
  'united states': 'US',
  'usa / canada': 'US',
  usa: 'US',
  us: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  canada: 'CA',
  australia: 'AU',
  germany: 'DE',
  france: 'FR',
  singapore: 'SG',
  'united arab emirates': 'AE',
  uae: 'AE',
};

const iso3ToIso2CountryCode: Record<string, string> = {
  IND: 'IN',
  USA: 'US',
  GBR: 'GB',
  CAN: 'CA',
  AUS: 'AU',
  DEU: 'DE',
  FRA: 'FR',
  SGP: 'SG',
  ARE: 'AE',
};

function resolveCountryCode(value?: string | null) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  const upper = normalized.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;

  if (/^[A-Z]{3}$/.test(upper) && iso3ToIso2CountryCode[upper]) {
    return iso3ToIso2CountryCode[upper];
  }

  const lowered = normalized.toLowerCase();
  if (countryNameToCode[lowered]) return countryNameToCode[lowered];

  const trailingCountry = lowered.includes(',') ? lowered.split(',').pop()?.trim() || '' : '';
  if (trailingCountry && countryNameToCode[trailingCountry]) return countryNameToCode[trailingCountry];

  return '';
}

const getCountryFlagEmoji = (country?: string | null) => {
  if (!country) return '';
  const code = resolveCountryCode(country);
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...Array.from(code).map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
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

const getStatusBadgeVariant = (status: Status) => {
  switch (status) {
    case 'Finished': return 'default';
    case 'On Course': return 'secondary';
    case 'Not Started': return 'outline';
    default: return 'destructive';
  }
}

const findSplit = (splits: Split[] | null | undefined, segment: string): Split | undefined => {
  return Array.isArray(splits) ? splits.find((s) => s.segment === segment) : undefined;
};

const getLegTime = (athlete: LiveAthlete, leg: Leg): number | undefined => {
    const summaryTime = (athlete.summary as any)?.[leg];
    if (summaryTime) {
        return summaryTime;
    }

  const splits = Array.isArray(athlete.splits) ? athlete.splits : [];

    if (athlete.startTime === null || athlete.startTime === undefined) {
    const legSplit = findSplit(splits, leg);
        if (legSplit?.time && legSplit.time > 0) return legSplit.time;
    const athleteAsRaceResult = { splits, ...splits.reduce((acc, s) => ({ ...acc, [s.segment.toLowerCase()]: formatSecondsToHMS(s.time) }), {}) } as any;
        const timeStr = athleteAsRaceResult[leg.toLowerCase()];
        if (timeStr) return hmsToSeconds(timeStr);
        return undefined;
    }
    
  const legSplit = findSplit(splits, leg);
    if (!legSplit?.time) return undefined;

    const prevLeg: Leg | undefined = leg === 'T1' ? (isDuathlonEvent(athlete.category) ? 'RUN1' : 'SWIM')
        : leg === 'BIKE' ? 'T1'
        : leg === 'T2' ? 'BIKE'
        : leg === 'RUN' ? 'T2'
        : leg === 'RUN2' ? 'T2'
        : undefined;

    if (prevLeg) {
      const prevLegSplit = findSplit(splits, prevLeg);
        if (prevLegSplit?.time) {
            return legSplit.time - prevLegSplit.time;
        }
    }
    
    return legSplit.time - athlete.startTime;
};


const RaceProgressBar: React.FC<{
  athlete: LiveAthlete;
  stages: Array<{ label: string; value: string; state: 'completed' | 'current' | 'future' | 'missed' }>;
  totalProgressPercentage: number;
}> = ({ athlete, stages, totalProgressPercentage }) => {
  const segments = stages.length > 0 ? stages : [{ label: 'SWIM', value: '--:--', state: 'future' as const }];

    return (
        <div className="w-full pt-2">
             <div className="flex justify-between items-center mb-1">
        {segments.map((segment, i) => {
          const isCompleted = athlete.status === 'Finished' || segment.state === 'completed';
          const isCurrent = athlete.status !== 'Finished' && segment.state === 'current';
                    return (
                        <div key={i} className="z-10 flex flex-col items-center flex-1">
               <span className={`text-xs font-medium mb-1 ${isCurrent || isCompleted ? 'text-primary' : 'text-muted-foreground'}`}>{segment.label}</span>
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-colors duration-300 ${
                                isCompleted ? 'bg-primary border-primary' : isCurrent ? 'bg-background border-primary scale-110' : 'bg-background border-border'
                            }`}>
                <LegIcon leg={(segment.label as Leg) || 'NOT_STARTED'} className={`h-4 w-4 transition-colors duration-300 ${isCompleted ? 'text-primary-foreground' : isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
                            </div>
                            <p className="font-mono text-[10px] mt-1 text-muted-foreground">
                {segment.value || '--:--'}
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
  timingConfiguration?: ResolvedTimingConfiguration | null;
  ticketDef?: any;
  onViewMap?: (athleteId: string) => void;
  onRemove: (id: string) => void, 
  onSelect: (athlete: LiveAthlete) => void
}

export default function BergmanTrackerCard({ data, timingConfiguration, ticketDef, onViewMap, onRemove, onSelect }: BergmanTrackerCardProps) {
  const [now, setNow] = useState(new Date());
  const countryFlag = useMemo(() => {
    const countryValue = String(
      (data as any)?.country
      || (data as any)?.countryCode
      || (data as any)?.country_code
      || (data as any)?.countryISO
      || (data as any)?.countryIso
      || (data as any)?.country_iso
      || (data as any)?.countryIso2
      || (data as any)?.country_iso2
      || (data as any)?.countryIso3
      || (data as any)?.country_iso3
      || (data as any)?.countryName
      || (data as any)?.countryAtRace
      || (data as any)?.nationality
      || (data as any)?.registration?.country
      || (data as any)?.registration?.countryCode
      || (data as any)?.registration?.country_code
      || (data as any)?.registration?.countryName
      || (data as any)?.registration?.countryAtRace
      || (data as any)?.registration?.nationality
      || (data as any)?.provider?.country
      || (data as any)?.provider?.countryCode
      || (data as any)?.provider?.country_code
      || (data as any)?.provider?.countryName
      || (data as any)?.provider?.countryAtRace
      || (data as any)?.provider?.nationality
      || (data as any)?.nationality
      || '',
    ).trim();
    return getCountryFlagEmoji(countryValue || null);
  }, [data]);

  const isOpaqueId = (value: unknown) => {
    const text = String(value ?? '').trim();
    return Boolean(text) && (/^[a-z0-9_-]{6,}$/i.test(text) || /^[A-Za-z0-9]{8,}$/.test(text));
  };

  const resolvedContestName = useMemo(() => {
    const candidates = [data.contestName, data.category, (data as any)?.subCategoryName, (data as any)?.selectedSubCategory, (data as any)?.provider?.contestName, (data as any)?.providerContestName]
      .map((value) => String(value || '').trim())
      .filter((value) => value && !isOpaqueId(value));
    return candidates[0] || 'Unmapped';
  }, [data]);

  const resolvedAgeGroupLabel = useMemo(() => {
    const candidates = [
      (data as any)?.ageGroupName,
      data.ageGroup,
      (data as any)?.provider?.ageGroupName,
      (data as any)?.provider?.age_group_name,
    ].map((value) => String(value || '').trim()).filter((value) => value && !isOpaqueId(value));
    return candidates[0] || 'Not Assigned';
  }, [data]);

  const effectiveStatus = useMemo<Status>(() => {
    const normalized = normalizeStatus(data.status || '');
    const hasProgress = Number(data.courseProgress || 0) > 0 || Number(data.startTime || 0) > 0 || (Array.isArray(data.splits) && data.splits.length > 0);
    if (normalized === 'Finished' || normalized === 'DNF' || normalized === 'DNS' || normalized === 'DNQ') {
      return normalized as Status;
    }
    if (normalized === 'On Course' || hasProgress) return 'On Course';
    if (normalized === 'Not Started' || normalized.toLowerCase() === 'registered' || normalized.toLowerCase() === 'registration') return 'Not Started';
    return 'Not Started';
  }, [data]);

  const displayStatusLabel = useMemo(() => {
    const raw = normalizeStatus(data.status || '').trim().toLowerCase();
    if (effectiveStatus === 'On Course') return 'Started';
    if (raw === 'regular' || raw === 'registered' || raw === 'registration') return 'Registered';
    if (raw === 'dns') return 'Did Not Start';
    if (raw === 'dnf') return 'Did Not Finish';
    if (raw === 'deferred') return 'Deferred';
    if (raw === 'transferred') return 'Transferred';
    if (raw === 'cancelled' || raw === 'canceled') return 'Cancelled';
    return effectiveStatus;
  }, [effectiveStatus, data.status]);

  useEffect(() => {
    if (effectiveStatus === 'On Course') {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }
  }, [effectiveStatus]);
  
  const elapsedTime = useMemo(() => {
    if (effectiveStatus === 'Finished') {
        const finishSeconds = data.summary?.FINISHED;
        if (typeof finishSeconds === 'number') return formatSecondsToHMS(finishSeconds);
    }
    
    if (data.startTime && data.startTime > 0 && effectiveStatus === 'On Course') {
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
  }, [data, now, effectiveStatus]);
  
  const finishTime = useMemo(() => {
    const finishSeconds = data.summary?.FINISHED;
    if (effectiveStatus === 'Finished' && typeof finishSeconds === 'number') {
      return formatSecondsToHMS(finishSeconds);
    }
    return null;
  }, [data, effectiveStatus]);

  const validAvatarUrl = data && isValidImageUrl(data.avatarUrl) ? data.avatarUrl : undefined;

  const progressModel = useMemo(() => {
    try {
      return buildSplitModalModel({
        athlete: data,
        timingConfiguration: timingConfiguration || null,
        ticketDef: ticketDef || null,
      } as any);
    } catch {
      return null;
    }
  }, [data, timingConfiguration, ticketDef]);

  const ticketCategoryText = String(ticketDef?.ticketCategory || ticketDef?.name || ticketDef?.ticketName || '').toLowerCase();
  const athleteCategoryText = String(data.category || data.contestName || data.ticketName || '').toLowerCase();
  const isSwimOnlyContest = useMemo(() => {
    const text = `${ticketCategoryText} ${athleteCategoryText}`;
    return text.includes('swim') && !text.includes('triathlon') && !text.includes('duathlon') && !text.includes('aquathlon');
  }, [athleteCategoryText, ticketCategoryText]);

  const watchlistStages = useMemo(() => {
    if (!progressModel) return [] as Array<{ label: string; value: string; state: 'completed' | 'current' | 'future' | 'missed' }>;
    const stageMap = new Map<string, { label: string; value: string; state: 'completed' | 'current' | 'future' | 'missed' }>();
    progressModel.sectionTimeline
      .filter((row) => row.section.theme !== 'transition')
      .forEach((row) => {
        const theme = String(row.section.theme || row.section.label || '').toLowerCase();
        const label = theme.includes('swim') ? 'SWIM' : theme.includes('bike') ? 'BIKE' : theme.includes('run') ? 'RUN' : theme.includes('finish') ? 'FINISH' : String(row.section.label || row.section.theme || '').toUpperCase();
        if (isSwimOnlyContest && !['SWIM', 'FINISH'].includes(label)) return;
        if (!label) return;
        if (!stageMap.has(label)) {
          stageMap.set(label, {
            label,
            value: row.section.primaryMetricValue || '--:--',
            state: row.state,
          });
        }
      });

    const stages = Array.from(stageMap.values());
    if (stages.length > 0) return stages;

    const isDua = isDuathlonEvent(data.category);
    const fallback = isSwimOnlyContest ? ['SWIM', 'FINISH'] : isDua ? ['RUN1', 'T1', 'BIKE', 'T2', 'RUN2'] : ['SWIM', 'T1', 'BIKE', 'T2', 'RUN'];
    return fallback.map((label) => ({
      label,
      value: (() => {
        const t = getLegTime(data, label as Leg);
        return t !== undefined ? formatSecondsToHMS(t) : '--:--';
      })(),
      state: 'future' as const,
    }));
  }, [progressModel, data, isSwimOnlyContest]);

  const totalProgressPercentage = useMemo(() => {
    if (!progressModel) return Math.max(0, Math.min(100, Number(data.legProgressPct || 0)));
    if (progressModel.isFinished) return 100;
    const totalRows = progressModel.sections.reduce((sum, section) => sum + section.rows.length, 0);
    const reachedRows = progressModel.sections.reduce((sum, section) => sum + section.rows.filter((row) => row.reached).length, 0);
    if (totalRows <= 0) return Math.max(0, Math.min(100, Number(data.legProgressPct || 0)));
    return Math.max(0, Math.min(100, (reachedRows / totalRows) * 100));
  }, [progressModel, data.legProgressPct]);

  return (
    <Card className="bg-card text-card-foreground cursor-pointer transition-colors hover:bg-accent/50" onClick={() => onSelect(data)}>
      <CardHeader className="p-3 flex flex-row items-start justify-between">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src={validAvatarUrl} />
            <AvatarFallback>{getInitials(data.name)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-sm">{data.name}</p>
              {countryFlag ? (
                <span className="inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-[11px] leading-none" aria-label="Country flag">
                  {countryFlag}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">BIB: {data.bib}</p>
              <p className="text-xs text-muted-foreground">Age Group: {resolvedAgeGroupLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              {data.clubName && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-100">
                  <Building className="h-3 w-3" />
                  Proudly representing {data.clubName}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">Contest: {resolvedContestName}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onViewMap && (
             <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onViewMap(data.id);}}>
               <MapPin className="h-4 w-4 text-blue-600" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); onRemove(data.id); }}
            aria-label={`Remove ${data.name} from watchlist`}
            title="Remove from watchlist"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs space-y-3">
        {effectiveStatus === 'Finished' ? (
          <div className="text-center p-4 my-2 bg-green-100/50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-sm font-semibold text-green-700 dark:text-green-300">Finished!</p>
            <p className="text-4xl font-bold font-mono text-green-800 dark:text-green-200 tracking-tighter">{finishTime}</p>
          </div>
        ) : effectiveStatus === 'On Course' ? (
          <div className="text-center p-4 my-2 bg-blue-100/50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg h-[90px] flex flex-col justify-center">
             <LiveDataTicker data={data} elapsedTime={elapsedTime}/>
          </div>
        ) : (
          <div className="text-center p-4 my-2">
            <Badge variant={getStatusBadgeVariant(effectiveStatus)} className="text-xs">{displayStatusLabel}</Badge>
          </div>
        )}
        
        <RaceProgressBar 
          athlete={data} 
          stages={watchlistStages}
          totalProgressPercentage={totalProgressPercentage}
        />
        
        {effectiveStatus === 'On Course' && data.cutoffStatus && data.cutoffStatus !== 'N/A' && (
          <div className={`p-2 rounded-md border text-center ${String(data.cutoffStatus) === 'Within Cutoff' || String(data.cutoffStatus) === 'On Track' ? 'bg-green-50 border-green-100' : String(data.cutoffStatus) === 'Missed Cutoff' ? 'bg-red-50 border-red-100' : 'bg-orange-50 border-orange-100'}`}>
            {(String(data.cutoffStatus) === 'Within Cutoff' || String(data.cutoffStatus) === 'On Track') ? (
              <p className="font-semibold text-sm text-green-700 flex items-center justify-center gap-1"><ShieldCheck className="h-4 w-4"/>Within Cutoff</p>
            ) : String(data.cutoffStatus) === 'Missed Cutoff' ? (
               <p className="font-semibold text-sm text-red-700 flex items-center justify-center gap-1"><AlertTriangle className="h-4 w-4"/>Missed Cutoff</p>
            ) : (
               <p className="font-semibold text-sm text-orange-700 flex items-center justify-center gap-1"><AlertTriangle className="h-4 w-4"/>Approaching Cutoff</p>
            )}
            <p className="text-muted-foreground text-[10px]">Cutoff Status</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
