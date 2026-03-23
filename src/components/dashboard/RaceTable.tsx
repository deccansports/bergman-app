// src/components/dashboard/RaceTable.tsx
"use client";

import type { RaceResult } from '@/lib/types';
import React, { useState, useMemo } from 'react'; // Added React for JSX
import { useRouter } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Search, ArrowUpDown, CheckCircle2, XCircle, AlertCircle, CalendarDays,
  MapPin, Clock, BarChart3, Users, User as UserIconLucide, Hash, Mail, Smartphone,
  Tag, ShieldCheck, SwatchBook, ChevronsUpDown, Hourglass, Bike as BikeIcon, Waves,
  PersonStanding, Footprints, Goal, Info, HelpCircle, CheckSquare, Layers3,
  TrendingUp, FilterX, Download
} from 'lucide-react';
import Image from 'next/image';
import { hmsToSeconds, formatSecondsToHMS, isTriathlonEvent, isDuathlonEvent, normalizeStatus } from '@/lib/utils';
import { calculatePointsForResult } from '@/lib/pointsCalculator';
import { cn } from "@/lib/utils"; // Import the cn utility function
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';


interface RaceTableProps {
  races?: RaceResult[];
  allAthleteRaces?: RaceResult[]; // Used for context if needed, though new point system might not use it
}

type RaceStatusFilter = 'all' | 'Finished' | 'DNF' | 'DNS' | 'DNQ';
type SortKey = keyof RaceResult | 'points' | null;
type SortDirection = 'asc' | 'desc';


const NotApplicableSpan = () => <span className="text-muted-foreground text-xs">N/A</span>;

const getStatusVariant = (status: ReturnType<typeof normalizeStatus>): "default" | "destructive" | "secondary" | "outline" => {
  switch (status) {
    case 'Finished': return 'default';
    case 'DNF': return 'destructive';
    case 'DNS': return 'secondary';
    case 'DNQ': return 'secondary';
    default: return 'outline';
  }
};

const RaceStatusIcon = ({ status }: { status: ReturnType<typeof normalizeStatus> }) => {
    let IconComponent: React.ElementType = Info;
    let iconClass = "text-muted-foreground";

    switch (status) {
        case 'Finished':
         IconComponent = CheckCircle2;
         iconClass = "text-accent";
         break;
        case 'DNF':
         IconComponent = XCircle;
         iconClass = "text-destructive";
         break;
        case 'DNS':
         IconComponent = AlertCircle;
         iconClass = "text-yellow-500";
         break;
        case 'DNQ':
         IconComponent = HelpCircle;
         iconClass = "text-orange-600";
         break;
    }
    return <IconComponent className={`h-4 w-4 inline-block mr-1.5 ${iconClass}`} />;
};

const formatOptionalTime = (timeString?: string | null): string | React.ReactElement => {
    if (!timeString || String(timeString).trim() === '' || String(timeString).toUpperCase() === 'N/A') {
        return <NotApplicableSpan />;
    }
    const seconds = hmsToSeconds(timeString);
    if (seconds === 0 && !['0', '0:00', '00:00:00', '00:00'].includes(timeString.trim())) {
        return <NotApplicableSpan />;
    }
    if (seconds === Infinity) {
        return <NotApplicableSpan />;
    }
    const formattedTime = formatSecondsToHMS(seconds);
    if (formattedTime === 'N/A') {
        return <NotApplicableSpan />;
    }
    return formattedTime;
};


export function RaceTable({ races = [], allAthleteRaces = [] }: RaceTableProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<RaceStatusFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('raceDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleViewCertificate = (race: RaceResult) => {
    const slug = race.customSlug || race.eventId;
    if (slug && race.bibNumber) {
        router.push(`/results?eventSlug=${slug}&bib=${race.bibNumber}`);
    } else {
        console.error("Could not generate certificate link: Missing slug or bib number.", race);
    }
  };

  const filteredAndSortedRaces = useMemo(() => {
    const currentRaces = Array.isArray(races) ? races : [];

    const tabFiltered = currentRaces.filter(race => {
       if (activeTab === 'all') return true;
       return normalizeStatus(race.status) === activeTab;
    });

    const searchFiltered = tabFiltered.filter(race => {
        const term = searchTerm.toLowerCase();
        const searchFields = [
            race.bibNumber, race.name, race.mobile, race.email,
            race.registrationStatus, race.status, race.category, race.gender,
            race.raceCategory, race.location, race.eventCategory,
            race.raceDate ? new Date(race.raceDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : ''
        ];
        return searchFields.some(field => field?.toString().toLowerCase().includes(term));
      });

      const racesWithPoints = searchFiltered.map(race => {
        let pointsForThisRace: number | null = null;
        if (normalizeStatus(race.status) === 'Finished' && race.chipTime) {
          // No longer need fastestChipTimeSecondsForEvent for bracket system
          pointsForThisRace = calculatePointsForResult(race);
        }
        return {
         ...race,
         points: pointsForThisRace,
        };
      });

     return racesWithPoints.sort((a, b) => {
        if (!sortKey) return 0;
        let valA: any;
        let valB: any;

        if (sortKey === 'points') {
          valA = a.points;
          valB = b.points;
        } else {
          valA = a[sortKey as keyof RaceResult];
          valB = b[sortKey as keyof RaceResult];
        }

        if (sortKey === 'points') {
            if (valA === null || valA === undefined) valA = sortDirection === 'asc' ? Infinity : -Infinity;
            if (valB === null || valB === undefined) valB = sortDirection === 'asc' ? Infinity : -Infinity;
        }


        switch (sortKey) {
          case 'raceDate':
            const dateA = valA && typeof valA === 'string' ? new Date(valA).getTime() : (sortDirection === 'asc' ? Infinity : -Infinity);
            const dateB = valB && typeof valB === 'string' ? new Date(valB).getTime() : (sortDirection === 'asc' ? Infinity : -Infinity);
            valA = isNaN(dateA) ? (sortDirection === 'asc' ? Infinity : -Infinity) : dateA;
            valB = isNaN(dateB) ? (sortDirection === 'asc' ? Infinity : -Infinity) : dateB;
            break;
          case 'oRank':
          case 'cRank':
          case 'gRank':
            valA = valA !== undefined && valA !== null && !isNaN(Number(valA)) && String(valA).trim() !== '' ? Number(valA) : Infinity;
            valB = valB !== undefined && valB !== null && !isNaN(Number(valB)) && String(valB).trim() !== '' ? Number(valB) : Infinity;
            break;
          case 'swim':
          case 't1':
          case 'bike':
          case 't2':
          case 'run':
          case 'run1':
          case 'run2':
          case 'chipTime':
            valA = hmsToSeconds(valA as string | undefined);
            valB = hmsToSeconds(valB as string | undefined);
            break;
          default:
            valA = String(valA ?? '').toLowerCase();
            valB = String(valB ?? '').toLowerCase();
            if (valA === '' && valB !== '') return 1;
            if (valB === '' && valA !== '') return -1;
        }

        let comparison = 0;
        if (valA < valB) comparison = -1;
        else if (valA > valB) comparison = 1;
        return sortDirection === 'asc' ? comparison : comparison * -1;
      });
  }, [races, activeTab, searchTerm, sortKey, sortDirection]);

  const finishedCount = useMemo(() => (Array.isArray(races) ? races : []).filter(r => normalizeStatus(r.status) === 'Finished').length, [races]);
  const dnfCount = useMemo(() => (Array.isArray(races) ? races : []).filter(r => normalizeStatus(r.status) === 'DNF').length, [races]);
  const dnqCount = useMemo(() => (Array.isArray(races) ? races : []).filter(r => normalizeStatus(r.status) === 'DNQ').length, [races]);
  const dnsCount = useMemo(() => (Array.isArray(races) ? races : []).filter(r => normalizeStatus(r.status) === 'DNS').length, [races]);

  const visibleColumns = useMemo(() => {
    const actualRaces = Array.isArray(filteredAndSortedRaces) ? filteredAndSortedRaces : [];
    const tri = actualRaces.some(r => isTriathlonEvent(r.eventCategory));
    const dua = actualRaces.some(r => isDuathlonEvent(r.eventCategory));
    return {
      showSwim: tri,
      showRun1: dua,
      showT1: tri || dua,
      showBike: tri || dua,
      showT2: tri || dua,
      showRun: tri, // Only show "Run" for Tri
      showRun2: dua // Only show "Run 2" for Dua
    };
  }, [filteredAndSortedRaces]);

  const SortableHeader = ({ columnKey, label, icon: Icon, className = '' }: { columnKey: SortKey, label: string, icon?: React.ElementType, className?: string }) => {
     const handleSort = (key: SortKey) => {
       if (key === sortKey) {
         setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
       } else {
         setSortKey(key);
         setSortDirection('asc');
       }
     };
     return (
        <TableHead className={cn("cursor-pointer hover:bg-muted/50 whitespace-nowrap p-2 h-10 text-xs", className)} onClick={() => handleSort(columnKey)}>
          <div className="flex items-center gap-1.5">
            {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
            <span>{label}</span>
            {sortKey === columnKey ? (
              <ArrowUpDown className={`h-3 w-3 ${sortDirection === 'desc' ? '' : 'rotate-180 transform'}`} />
            ) : (
              <ChevronsUpDown className="h-3 w-3 opacity-30" />
            )}
          </div>
        </TableHead>
     );
  };

  if (!Array.isArray(races) || races.length === 0) {
    return (
      <div className="text-center py-12">
        <h3 className="text-2xl font-semibold text-foreground mb-2">No Races Yet!</h3>
        <p className="text-muted-foreground">It looks like you haven&apos;t participated in any races, or we couldn&apos;t find your data.</p>
        <p className="text-sm text-muted-foreground mt-1">If you believe this is an error, please contact <a href="mailto:info@bergmantri.com" className="text-primary underline hover:no-underline">info@bergmantri.com</a>.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as RaceStatusFilter)} className="w-full md:w-auto">
          <ScrollArea className="w-full whitespace-nowrap">
            <TabsList className="inline-flex">
              <TabsTrigger value="all" className="data-[state=active]:text-primary data-[state=active]:border-primary/50 data-[state=active]:shadow-sm">
                   All ({races.length})
              </TabsTrigger>
              <TabsTrigger value="Finished" className="data-[state=active]:text-accent data-[state=active]:border-accent/50 data-[state=active]:shadow-sm">
                Finished ({finishedCount})
              </TabsTrigger>
              <TabsTrigger value="DNF" className="data-[state=active]:text-destructive data-[state=active]:border-destructive/50 data-[state=active]:shadow-sm">
                DNF ({dnfCount})
              </TabsTrigger>
               <TabsTrigger value="DNQ" className="data-[state=active]:text-orange-600 data-[state=active]:border-orange-500/50 data-[state=active]:shadow-sm">
                DNQ ({dnqCount})
              </TabsTrigger>
              <TabsTrigger value="DNS" className="data-[state=active]:text-yellow-600 data-[state=active]:border-yellow-500/50 data-[state=active]:shadow-sm">
                DNS ({dnsCount})
              </TabsTrigger>
            </TabsList>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </Tabs>
        <div className="relative w-full sm:w-auto sm:min-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search races (name, location, bib...)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 w-full"
            aria-label="Search races"
          />
        </div>
      </div>

      {filteredAndSortedRaces.length > 0 ? (
        <div className="rounded-md border shadow-sm overflow-x-auto">
           <Table className="min-w-[2000px] sm:min-w-full">
            <TableHeader className="bg-muted/50 sticky top-0 z-10">
              <TableRow>
                <SortableHeader columnKey="raceDate" label="Date" icon={CalendarDays} className="w-[110px]" />
                <SortableHeader columnKey="raceCategory" label="Race Type" icon={Goal} className="w-[140px]" />
                <SortableHeader columnKey="location" label="Location" icon={MapPin} className="w-[170px]" />
                <SortableHeader columnKey="status" label="Status" icon={Tag} className="w-[100px]" />
                <SortableHeader columnKey="chipTime" label="Chip Time" icon={Clock} className="w-[110px]" />
                <SortableHeader columnKey="points" label="Points" icon={TrendingUp} className="w-[80px]" />
                <SortableHeader columnKey="oRank" label="Overall Rank" icon={BarChart3} className="w-[110px]" />
                <SortableHeader columnKey="gRank" label="Gen Rank" icon={UserIconLucide} className="w-[90px]" />
                <SortableHeader columnKey="cRank" label="Cat Rank" icon={Users} className="w-[90px]" />
                
                {visibleColumns.showSwim && (
                    <SortableHeader columnKey="swim" label="Swim" icon={Waves} className="w-[90px]" />
                )}
                {visibleColumns.showRun1 && (
                    <SortableHeader columnKey="run1" label="Run 1" icon={Footprints} className="w-[90px]" />
                )}
                {visibleColumns.showT1 && (
                    <SortableHeader columnKey="t1" label="T1" icon={Hourglass} className="w-[90px]" />
                )}
                {visibleColumns.showBike && (
                    <SortableHeader columnKey="bike" label="Bike" icon={BikeIcon} className="w-[90px]" />
                )}
                {visibleColumns.showT2 && (
                    <SortableHeader columnKey="t2" label="T2" icon={Hourglass} className="w-[90px]" />
                 )}
                 {visibleColumns.showRun && (
                    <SortableHeader columnKey="run" label="Run" icon={PersonStanding} className="w-[90px]" />
                 )}
                 {visibleColumns.showRun2 && (
                    <SortableHeader columnKey="run2" label="Run 2" icon={Footprints} className="w-[90px]" />
                 )}
                 <SortableHeader columnKey="bibNumber" label="Bib" icon={Hash} className="w-[70px]" />
                 <SortableHeader columnKey="category" label="Athlete Cat" icon={SwatchBook} className="w-[130px]" />
                 <TableHead className="w-[120px]">Certificate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedRaces.map((race, index) => {
                const raceStatus = normalizeStatus(race.status);
                const points = race.points;
                const displayPoints = typeof points === 'number' && !isNaN(points) ? points : <NotApplicableSpan />;

                return (
                    <TableRow key={`${race.bibNumber}-${race.raceDate}-${index}`} className="hover:bg-muted/30 text-xs">
                        <TableCell className="whitespace-nowrap p-2">
                           {race.raceDate ? new Date(race.raceDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : <NotApplicableSpan />}
                        </TableCell>
                        <TableCell className="p-2">{race.raceCategory}</TableCell>
                        <TableCell className="whitespace-nowrap p-2">{race.location}</TableCell>
                        <TableCell className="p-2">
                            <Badge
                                variant={getStatusVariant(raceStatus)}
                                className={cn(
                                    "capitalize text-[10px] px-1.5 py-0.5 leading-tight flex items-center w-fit",
                                    raceStatus === 'Finished' && 'bg-accent text-accent-foreground hover:bg-accent/90',
                                    raceStatus === 'DNF' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
                                    raceStatus === 'DNS' && 'text-yellow-700 bg-yellow-100 border-yellow-200',
                                    raceStatus === 'DNQ' && 'text-orange-700 bg-orange-100 border-orange-200',
                                     !['Finished', 'DNF', 'DNS', 'DNQ'].includes(raceStatus) && 'bg-gray-200 text-gray-700 border-gray-300'
                                )}
                            >
                                <RaceStatusIcon status={raceStatus} />
                                {raceStatus === 'Unknown' ? 'Unknown' : raceStatus}
                            </Badge>
                        </TableCell>
                        <TableCell className="font-mono font-semibold p-2">{formatOptionalTime(race.chipTime)}</TableCell>
                        <TableCell className="font-semibold text-accent p-2">
                          {typeof points === 'number' && !isNaN(points) ? points : <NotApplicableSpan />}
                        </TableCell>
                        <TableCell className="p-2">{normalizeStatus(race.status) === 'Finished' ? race.oRank || <NotApplicableSpan /> : <NotApplicableSpan />}</TableCell>
                        <TableCell className="p-2">{normalizeStatus(race.status) === 'Finished' ? race.gRank || <NotApplicableSpan /> : <NotApplicableSpan />}</TableCell>
                        <TableCell className="p-2">{normalizeStatus(race.status) === 'Finished' ? race.cRank || <NotApplicableSpan /> : <NotApplicableSpan />}</TableCell>
                        
                        {visibleColumns.showSwim && <TableCell className="font-mono p-2">{formatOptionalTime(race.swim)}</TableCell>}
                        {visibleColumns.showRun1 && <TableCell className="font-mono p-2">{formatOptionalTime(race.run1)}</TableCell>}
                        {visibleColumns.showT1 && <TableCell className="font-mono p-2">{formatOptionalTime(race.t1)}</TableCell>}
                        {visibleColumns.showBike && <TableCell className="font-mono p-2">{formatOptionalTime(race.bike)}</TableCell>}
                        {visibleColumns.showT2 && <TableCell className="font-mono p-2">{formatOptionalTime(race.t2)}</TableCell>}
                        {visibleColumns.showRun && <TableCell className="font-mono p-2">{formatOptionalTime(race.run)}</TableCell>}
                        {visibleColumns.showRun2 && <TableCell className="font-mono p-2">{formatOptionalTime(race.run2)}</TableCell>}
                        <TableCell className="font-mono p-2">{race.bibNumber}</TableCell>
                        <TableCell className="p-2">{race.category}</TableCell>
                        <TableCell className="text-center p-2">
                            {raceStatus === 'Finished' ? (
                                <Button size="xs" variant="outline" onClick={() => handleViewCertificate(race)}>
                                    <Download className="h-3 w-3 mr-1" /> View
                                </Button>
                            ) : (
                                <NotApplicableSpan />
                            )}
                        </TableCell>
                    </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-10 col-span-full">
          <FilterX className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-xl font-medium text-muted-foreground">No races match your current filters.</p>
           <p className="text-sm text-muted-foreground mt-1">If you believe this is an error, please contact <a href="mailto:info@bergmantri.com" className="text-primary underline hover:no-underline">info@bergmantri.com</a>.</p>
        </div>
      )}
      <div className="mt-6 text-sm text-muted-foreground text-center border-t pt-4">
        <p>If you think your timing or race data is incorrect, please inform our support tech team at <a href="mailto:info@bergmantri.com" className="text-primary underline hover:no-underline">info@bergmantri.com</a>. They will verify and update accordingly.</p>
      </div>
    </div>
  );
}
