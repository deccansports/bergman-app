
// src/components/dashboard/PastRaces.tsx
"use client";

import React, { useMemo } from 'react';
import type { RaceResult } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { History, Trophy, Award, BarChart3, Waves, Bike, Footprints, ChevronsRight } from 'lucide-react';
import { formatSecondsToHMS, hmsToSeconds, normalizeStatus, isTriathlonEvent, isDuathlonEvent, formatOptionalTime } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

interface PastRacesProps {
  races?: RaceResult[];
}

export default function PastRaces({ races = [] }: PastRacesProps) {
  const router = useRouter();
  
  const pastRaces = useMemo(() => {
    return races.filter(race => {
      if (!race.raceDate) return false;
      try {
        return new Date(race.raceDate) < new Date();
      } catch {
        return false;
      }
    }).sort((a, b) => new Date(b.raceDate!).getTime() - new Date(a.raceDate!).getTime());
  }, [races]);

  const handleViewCertificate = (race: RaceResult) => {
    // Use customSlug if available, otherwise fall back to eventId.
    const slug = race.customSlug || race.eventId;
    if (slug && race.bibNumber) {
        router.push(`/results?eventSlug=${slug}&bib=${race.bibNumber}`);
    } else {
        // You might want to show a toast message here if the slug is not available
        console.error("Could not generate certificate link: Missing slug or bib number.", race);
    }
  };
  
  const hasTriathlon = useMemo(() => pastRaces.some(r => isTriathlonEvent(r.eventCategory)), [pastRaces]);
  const hasDuathlon = useMemo(() => pastRaces.some(r => isDuathlonEvent(r.eventCategory)), [pastRaces]);


  if (pastRaces.length === 0) {
    return null; // Don't render anything if there are no past races
  }

  return (
    <Card className="shadow-lg border-blue-500/20 bg-blue-500/5">
      <CardHeader>
        <CardTitle className="text-2xl font-bold tracking-tight text-blue-700 flex items-center gap-2">
          <History className="h-6 w-6" />
          Your Past Races
        </CardTitle>
        <CardDescription>A log of your completed races and performance history.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>BIB</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Chip Time</TableHead>
                {hasTriathlon && <TableHead>Swim</TableHead>}
                {hasDuathlon && <TableHead>Run 1</TableHead>}
                <TableHead>T1</TableHead>
                <TableHead>Bike</TableHead>
                <TableHead>T2</TableHead>
                {hasTriathlon && <TableHead>Run</TableHead>}
                {hasDuathlon && <TableHead>Run 2</TableHead>}
                <TableHead>Ranks</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pastRaces.map((race, index) => {
                const status = normalizeStatus(race.status);
                const isFinished = status === 'Finished';
                return (
                  <TableRow key={race.docId || index}>
                    <TableCell className="font-medium">
                        {race.eventName}
                        <p className="text-xs text-muted-foreground">{race.ticketName || race.raceCategory}</p>
                    </TableCell>
                    <TableCell>{race.bibNumber}</TableCell>
                    <TableCell>{race.raceDate ? format(parseISO(race.raceDate), 'MMM dd, yyyy') : 'N/A'}</TableCell>
                    <TableCell>
                      <Badge variant={isFinished ? 'default' : 'destructive'}>{status}</Badge>
                    </TableCell>
                    <TableCell className="font-mono font-semibold">
                      {isFinished && race.chipTime ? formatSecondsToHMS(hmsToSeconds(race.chipTime)) : 'N/A'}
                    </TableCell>
                    {hasTriathlon && <TableCell className="font-mono">{formatOptionalTime(race.swim)}</TableCell>}
                    {hasDuathlon && <TableCell className="font-mono">{formatOptionalTime(race.run1)}</TableCell>}
                    <TableCell className="font-mono">{formatOptionalTime(race.t1)}</TableCell>
                    <TableCell className="font-mono">{formatOptionalTime(race.bike)}</TableCell>
                    <TableCell className="font-mono">{formatOptionalTime(race.t2)}</TableCell>
                    {hasTriathlon && <TableCell className="font-mono">{formatOptionalTime(race.run)}</TableCell>}
                    {hasDuathlon && <TableCell className="font-mono">{formatOptionalTime(race.run2)}</TableCell>}
                    <TableCell className="text-xs">
                        {isFinished ? (
                            <div className="flex flex-col gap-1">
                                <span className="flex items-center gap-1.5"><BarChart3 className="h-3 w-3" />O: {race.oRank || 'N/A'}</span>
                                <span className="flex items-center gap-1.5"><Trophy className="h-3 w-3" />G: {race.gRank || 'N/A'}</span>
                                <span className="flex items-center gap-1.5"><Award className="h-3 w-3" />C: {race.cRank || 'N/A'}</span>
                            </div>
                        ) : 'N/A'}
                    </TableCell>
                    <TableCell className="text-right">
                       {isFinished && (
                         <Button variant="outline" size="sm" onClick={() => handleViewCertificate(race)}>View Certificate</Button>
                       )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
