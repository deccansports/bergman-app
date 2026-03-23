
// src/components/live-tracking/SplitDetails.tsx
"use client";

import React from 'react';
import type { LiveAthlete, Split, TicketDefinition, CustomSplitPoint, Leg } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Waves, ChevronsRight, Bike, Footprints, Flag } from 'lucide-react';
import { formatSecondsToHMS, hmsToSeconds, isDuathlonEvent } from '@/lib/utils';
import { cn } from "@/lib/utils";
import { format as formatDateFns } from 'date-fns';


interface SplitDetailsProps {
    leg: Leg;
    label: string;
    distanceKm: number | null | undefined;
    rawSplits: any[]; // Now receives raw reads
    athlete: LiveAthlete;
    ticketDef?: TicketDefinition | null;
}

const LegIcon = ({ leg, className }: { leg: string; className?: string }) => {
    const defaultClass = "h-5 w-5 text-yellow-400"; // Base size
    switch (leg) {
        case 'SWIM': return <Waves className={cn(defaultClass, className)} />;
        case 'T1': case 'T2': return <ChevronsRight className={cn(defaultClass, className)} />;
        case 'BIKE': return <Bike className={cn(defaultClass, className)} />;
        case 'RUN': case 'RUN1': case 'RUN2': return <Footprints className={cn(defaultClass, className)} />;
        case 'FINISHED': return <Flag className={cn(defaultClass, className)} />;
        default: return null;
    }
};

const getPace = (timeSeconds: number | null | undefined, distanceKm: number | null | undefined, leg: 'swim' | 'bike' | 'run' | 'transition'): string => {
    if (leg === 'transition' || !timeSeconds || timeSeconds <= 0 || !distanceKm || distanceKm <= 0) return '—';
    
    if (leg === 'swim') {
        const pacePer100m = timeSeconds / (distanceKm * 10);
        return `${formatSecondsToHMS(pacePer100m)} /100m`;
    }
    if (leg === 'bike') {
        const hours = timeSeconds / 3600;
        const speedKph = distanceKm / hours;
        return `${speedKph.toFixed(1)} km/h`;
    }
    if (leg === 'run') {
        const pacePerKm = timeSeconds / distanceKm;
        return `${formatSecondsToHMS(pacePerKm)} /km`;
    }
    return '—';
};


const SplitDetails: React.FC<SplitDetailsProps> = ({ leg, label, distanceKm, rawSplits, athlete, ticketDef }) => {
    const legType = (leg.toLowerCase().includes('run') ? 'run' : leg.toLowerCase().includes('bike') ? 'bike' : leg.toLowerCase().includes('t') ? 'transition' : 'swim') as 'swim' | 'bike' | 'run' | 'transition';

    const mainTimeSec = (athlete.summary as any)?.[leg];
    
    const mainTimeDisplay = mainTimeSec !== undefined && mainTimeSec !== null ? formatSecondsToHMS(mainTimeSec) : '--:--:--';
    const avgPace = getPace(mainTimeSec, distanceKm, legType);
    
    const customSplitsSource = leg === 'BIKE' 
        ? ticketDef?.courseMaps?.bikeSplits 
        : (leg === 'RUN' || leg === 'RUN1' || leg === 'RUN2' ? ticketDef?.courseMaps?.runSplits : (leg === 'SWIM' ? ticketDef?.courseMaps?.swimSplits : []));

    const findSplitByName = (name: string) => rawSplits.find(s => s.rawSplitLabel === name || s.segment === name || s.name === name);

    return (
        <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="p-3 bg-slate-700/30">
                <CardTitle className="text-lg font-semibold flex items-center justify-between text-white">
                    <div className="flex items-center gap-2">
                        <LegIcon leg={leg} /> {label}
                    </div>
                    {distanceKm && <span className="text-sm font-normal text-slate-400">{distanceKm.toFixed(1)} km</span>}
                </CardTitle>
            </CardHeader>
            {legType !== 'transition' ? (
                <CardContent className="p-3 text-sm">
                    <div className="flex justify-between items-center mb-3">
                        <div>
                            <p className="text-slate-400 text-xs">Time</p>
                            <p className="font-bold font-mono text-3xl text-white">{mainTimeDisplay}</p>
                        </div>
                        <div>
                            <p className="text-slate-400 text-xs text-right">Avg Pace</p>
                            <p className="font-semibold font-mono text-2xl text-slate-300 text-right">{avgPace}</p>
                        </div>
                    </div>

                    {(customSplitsSource && customSplitsSource.length > 0) ? (
                         <Table>
                            <TableHeader>
                                <TableRow className="border-slate-600">
                                    <TableHead className="h-8 text-xs text-slate-400">Split</TableHead>
                                    <TableHead className="h-8 text-xs text-right text-slate-400">Time of Day</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                               {customSplitsSource.map((splitDef: CustomSplitPoint) => {
                                   const splitData = findSplitByName(splitDef.name);
                                   const timeOfDay = (splitData && typeof splitData.absoluteTimestamp === 'number' && isFinite(splitData.absoluteTimestamp)) ? formatDateFns(new Date(splitData.absoluteTimestamp * 1000), 'p') : '—';
                                   return (
                                       <TableRow key={splitDef.id} className="text-xs border-slate-700/50">
                                           <TableCell className="text-slate-300 py-1">{splitDef.name} ({splitDef.distance}km)</TableCell>
                                           <TableCell className="text-right font-mono text-slate-300 py-1">{timeOfDay}</TableCell>
                                       </TableRow>
                                   );
                               })}
                            </TableBody>
                        </Table>
                    ) : (
                        <p className="text-center text-slate-500 text-xs py-2">No custom splits for this leg.</p>
                    )}
                </CardContent>
            ) : (
                 <CardContent className="p-3 text-sm">
                    <div className="flex justify-center items-center">
                        <div>
                            <p className="text-slate-400 text-xs">Time</p>
                            <p className="font-bold font-mono text-3xl text-white">{mainTimeDisplay}</p>
                        </div>
                    </div>
                </CardContent>
            )}
        </Card>
    );
};

export default SplitDetails;
