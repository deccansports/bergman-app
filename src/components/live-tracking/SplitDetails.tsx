
// src/components/live-tracking/SplitDetails.tsx
"use client";

import React, { useMemo } from 'react';
import type { LiveAthlete, Split, TicketDefinition, CustomSplitPoint, Leg } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Waves, ChevronsRight, Bike, Footprints, Flag } from 'lucide-react';
import { formatSecondsToHMS } from '@/lib/utils';
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

        const mainTimeSec = (athlete.summary as any)?.[leg]
            ?? rawSplits.find(s => (s.segment || '').toUpperCase() === leg)?.time;
    
    const mainTimeDisplay = mainTimeSec !== undefined && mainTimeSec !== null ? formatSecondsToHMS(mainTimeSec) : '--:--:--';
    const avgPace = getPace(mainTimeSec, distanceKm, legType);
    
        const customSplitsSource = useMemo(() => {
            const source = leg === 'BIKE'
                ? (ticketDef?.courseMaps?.bikeSplits || [])
                : leg === 'RUN1'
                    ? (ticketDef?.courseMaps?.run1Splits || [])
                    : leg === 'RUN2'
                        ? ((ticketDef?.courseMaps?.run2Splits || ticketDef?.courseMaps?.runSplits || []))
                        : leg === 'RUN'
                            ? (ticketDef?.courseMaps?.runSplits || [])
                            : (leg === 'SWIM' ? (ticketDef?.courseMaps?.swimSplits || []) : []);

            return [...source].sort((a, b) => Number(a?.distance || 0) - Number(b?.distance || 0));
        }, [leg, ticketDef]);

        const detailsRows = useMemo(() => {
            const findSplit = (def: CustomSplitPoint) => {
                const rawId = (def.id || '').toUpperCase();
                return rawSplits.find((s: any) =>
                    (s.rawSplitLabel || '').toUpperCase() === rawId
                    || (s.segment || '').toUpperCase() === rawId
                    || (s.name || '').toUpperCase() === rawId
                    || (s.name || '').toUpperCase() === (def.name || '').toUpperCase()
                );
            };

            let prevDistance = 0;
            let prevTime = 0;

            return customSplitsSource.map((def: CustomSplitPoint) => {
                const splitData = findSplit(def);
                const cumulative = splitData?.time as number | undefined;
                const splitElapsed = (typeof cumulative === 'number' && cumulative > 0 && cumulative >= prevTime)
                    ? cumulative - prevTime
                    : undefined;
                const deltaDistance = Math.max(0, (Number(def.distance) || 0) - prevDistance);
                const speedKph = (splitElapsed && splitElapsed > 0 && deltaDistance > 0)
                    ? (deltaDistance / (splitElapsed / 3600))
                    : undefined;

                const row = {
                    id: def.id,
                    name: def.name,
                    distance: Number(def.distance) || 0,
                    splitElapsed,
                    cumulative,
                    speedKph,
                    timeOfDay: (splitData && typeof splitData.absoluteTimestamp === 'number' && isFinite(splitData.absoluteTimestamp))
                        ? formatDateFns(new Date(splitData.absoluteTimestamp * 1000), 'p')
                        : '—',
                };

                if (typeof cumulative === 'number' && cumulative > 0) {
                    prevTime = cumulative;
                    prevDistance = Number(def.distance) || prevDistance;
                }

                return row;
            });
        }, [customSplitsSource, rawSplits]);

    return (
        <Card className="bg-slate-800/50 border-slate-700">
                        <CardHeader className="p-3 bg-slate-700/30 sm:p-4">
                                <CardTitle className="flex items-center justify-between gap-3 text-base font-semibold text-white sm:text-lg">
                    <div className="flex items-center gap-2">
                                                <LegIcon leg={leg} />
                                                <span className="truncate">{label}</span>
                    </div>
                                        {distanceKm ? <span className="shrink-0 text-xs font-normal text-slate-400 sm:text-sm">{distanceKm.toFixed(1)} km</span> : null}
                </CardTitle>
            </CardHeader>
            {legType !== 'transition' ? (
                                <CardContent className="p-3 text-sm sm:p-4">
                                        <div className="mb-3 flex items-start justify-between gap-3 sm:items-center">
                                                <div className="min-w-0">
                            <p className="text-slate-400 text-xs">Time</p>
                                                        <p className="font-bold font-mono text-2xl text-white sm:text-3xl">{mainTimeDisplay}</p>
                        </div>
                                                <div className="shrink-0 text-right">
                            <p className="text-slate-400 text-xs text-right">Avg Pace</p>
                                                        <p className="font-semibold font-mono text-xl text-slate-300 text-right sm:text-2xl">{avgPace}</p>
                        </div>
                    </div>

                                        {(customSplitsSource && customSplitsSource.length > 0) ? (
                                                <>
                                                 <div className="space-y-2 md:hidden">
                                                        {detailsRows.map((row) => {
                                                                return (
                                                                    <div key={row.id} className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-2.5 text-xs text-slate-300">
                                                                        <div className="flex items-start justify-between gap-2">
                                                                            <div className="min-w-0">
                                                                                <div className="truncate font-medium text-slate-100">{row.name} <span className="text-slate-400">({row.distance}km)</span></div>
                                                                            </div>
                                                                            <div className="shrink-0 text-right font-mono text-[11px] text-slate-400">{row.timeOfDay}</div>
                                                                        </div>
                                                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                                                            <div>
                                                                                <div className="text-[10px] uppercase tracking-wide text-slate-500">Split Time</div>
                                                                                <div className="font-mono text-xs text-slate-100">{row.splitElapsed ? formatSecondsToHMS(row.splitElapsed) : '—'}</div>
                                                                            </div>
                                                                            <div>
                                                                                <div className="text-[10px] uppercase tracking-wide text-slate-500">Cumulative</div>
                                                                                <div className="font-mono text-xs text-slate-100">{row.cumulative ? formatSecondsToHMS(row.cumulative) : '—'}</div>
                                                                            </div>
                                                                            <div>
                                                                                <div className="text-[10px] uppercase tracking-wide text-slate-500">Avg Speed</div>
                                                                                <div className="font-mono text-xs text-slate-100">{row.speedKph ? `${row.speedKph.toFixed(1)} km/h` : '—'}</div>
                                                                            </div>
                                                                            <div>
                                                                                <div className="text-[10px] uppercase tracking-wide text-slate-500">Clock</div>
                                                                                <div className="font-mono text-xs text-slate-100">{row.timeOfDay}</div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                        })}
                                                 </div>

                                                 <div className="hidden md:block">
                                                 <Table>
                            <TableHeader>
                                <TableRow className="border-slate-600">
                                    <TableHead className="h-8 text-xs text-slate-400">Split</TableHead>
                                    <TableHead className="h-8 text-xs text-right text-slate-400">Split Time</TableHead>
                                    <TableHead className="h-8 text-xs text-right text-slate-400">Cumulative</TableHead>
                                    <TableHead className="h-8 text-xs text-right text-slate-400">Avg Speed</TableHead>
                                    <TableHead className="h-8 text-xs text-right text-slate-400">Time of Day</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                               {detailsRows.map((row) => {
                                   return (
                                       <TableRow key={row.id} className="text-xs border-slate-700/50">
                                           <TableCell className="text-slate-300 py-1">{row.name} ({row.distance}km)</TableCell>
                                           <TableCell className="text-right font-mono text-slate-300 py-1">{row.splitElapsed ? formatSecondsToHMS(row.splitElapsed) : '—'}</TableCell>
                                           <TableCell className="text-right font-mono text-slate-300 py-1">{row.cumulative ? formatSecondsToHMS(row.cumulative) : '—'}</TableCell>
                                           <TableCell className="text-right font-mono text-slate-300 py-1">{row.speedKph ? `${row.speedKph.toFixed(1)} km/h` : '—'}</TableCell>
                                           <TableCell className="text-right font-mono text-slate-300 py-1">{row.timeOfDay}</TableCell>
                                       </TableRow>
                                   );
                               })}
                            </TableBody>
                         </Table>
                         </div>
                        </>
                    ) : (
                        <p className="text-center text-slate-500 text-xs py-2">No custom splits for this leg.</p>
                    )}
                </CardContent>
            ) : (
                 <CardContent className="p-3 text-sm sm:p-4">
                    <div className="flex justify-center items-center">
                        <div>
                            <p className="text-slate-400 text-xs">Time</p>
                            <p className="font-bold font-mono text-2xl text-white sm:text-3xl">{mainTimeDisplay}</p>
                        </div>
                    </div>
                </CardContent>
            )}
        </Card>
    );
};

export default SplitDetails;
