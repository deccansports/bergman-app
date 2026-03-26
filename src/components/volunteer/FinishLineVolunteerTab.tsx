// src/components/volunteer/FinishLineVolunteerTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { LiveAthlete, EventCalendarEntry } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { getLiveTimingDataAction } from '@/lib/actions';
import { formatSecondsToHMS } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Award, Search as SearchIcon, RefreshCw } from 'lucide-react';
import { getEventDetailsWithTicketsAction } from '@/lib/actions';
import { Input } from '@/components/ui/input';
import AthleteDetailModal from '@/components/live-tracking/AthleteDetailModal';

interface FinishLineVolunteerTabProps {
  eventId: string;
}

export default function FinishLineVolunteerTab({ eventId }: FinishLineVolunteerTabProps) {
  const { toast } = useToast();
  const [liveData, setLiveData] = useState<LiveAthlete[]>([]);
  const [eventDetails, setEventDetails] = useState<EventCalendarEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAthlete, setSelectedAthlete] = useState<LiveAthlete | null>(null);

  const fetchLiveAndEventData = useCallback(async (isManualRefresh = false) => {
    if(!isManualRefresh) setIsLoading(true);
    try {
      const [liveResult, eventResult] = await Promise.all([
        getLiveTimingDataAction(eventId, 'live'),
        getEventDetailsWithTicketsAction(eventId)
      ]);

      if (liveResult.success && liveResult.participants) {
        setLiveData(liveResult.participants);
      }
      if (eventResult.success && eventResult.event) {
        setEventDetails(eventResult.event);
      }
      if(isManualRefresh) {
        toast({ title: "Data Refreshed", description: "The latest race data has been loaded." });
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      toast({ variant: 'destructive', title: 'Error', description: `Failed to fetch data: ${errMsg}` });
    }
    setIsLoading(false);
  }, [eventId, toast]);

  useEffect(() => {
    fetchLiveAndEventData();
    const interval = setInterval(fetchLiveAndEventData, 30000); // Keep auto-refresh for finish line
    return () => clearInterval(interval);
  }, [fetchLiveAndEventData]);

  const { totalParticipants, onCourseCount, finishedCount, dnfCount, approachingAthletes } = useMemo(() => {
    const total = liveData.length;
    const onCourse = liveData.filter(p => p.status === 'On Course').length;
    const finished = liveData.filter(p => p.status === 'Finished').length;
    const dnf = liveData.filter(p => p.status.startsWith('DNF')).length;
    const approaching = liveData
        .filter(p => p.status === 'On Course' && p.etaFinishUTC)
        .sort((a, b) => (a.etaFinishUTC || Infinity) - (b.etaFinishUTC || Infinity))
        .slice(0, 10);
    return { totalParticipants: total, onCourseCount: onCourse, finishedCount: finished, dnfCount: dnf, approachingAthletes: approaching };
  }, [liveData]);
  
  const filteredApproachingAthletes = useMemo(() => {
      if (!searchTerm) return approachingAthletes;
      return approachingAthletes.filter(athlete =>
        athlete.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        athlete.bib.toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [approachingAthletes, searchTerm]);

  const selectedAthleteTicketDef = useMemo(() => {
    if (!selectedAthlete || !selectedAthlete.ticketId) return undefined;
    return eventDetails?.ticketDefinitions?.find(td => td.id === selectedAthlete.ticketId);
  }, [selectedAthlete, eventDetails]);

  return (
    <>
    <Card>
      <CardHeader>
         <div className="flex justify-between items-start">
          <div>
            <CardTitle className="flex items-center gap-2"><Award className="h-5 w-5 text-primary"/>Finish Line Announcer</CardTitle>
            <CardDescription>View athletes approaching the finish line to announce their names.</CardDescription>
          </div>
          <Button onClick={() => fetchLiveAndEventData(true)} disabled={isLoading} variant="outline" size="sm">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl">{isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto"/> : totalParticipants}</CardTitle><CardDescription className="text-xs">Total</CardDescription></CardHeader></Card>
            <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl text-blue-600">{isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto"/> : onCourseCount}</CardTitle><CardDescription className="text-xs">On Course</CardDescription></CardHeader></Card>
            <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl text-green-600">{isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto"/> : finishedCount}</CardTitle><CardDescription className="text-xs">Finished</CardDescription></CardHeader></Card>
            <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl text-red-600">{isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto"/> : dnfCount}</CardTitle><CardDescription className="text-xs">DNF</CardDescription></CardHeader></Card>
        </div>
        <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
                placeholder="Search approaching athletes..."
                value={searchTerm}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                className="pl-9"
            />
        </div>
         <div className="rounded-md border overflow-auto max-h-[70vh]">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>BIB</TableHead>
                        <TableHead>Athlete</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Predicted Finish Time</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? <TableRow><TableCell colSpan={5} className="text-center"><Loader2 className="animate-spin my-4 mx-auto"/></TableCell></TableRow>
                    : filteredApproachingAthletes.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No athletes currently approaching the finish line.</TableCell></TableRow>
                    : filteredApproachingAthletes.map(athlete => (
                        <TableRow key={athlete.id} className="text-lg">
                            <TableCell className="font-mono font-bold text-primary">{athlete.bib}</TableCell>
                            <TableCell className="font-semibold">{athlete.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{athlete.category}</TableCell>
                            <TableCell className="font-mono">
                                {athlete.etaFinishUTC && athlete.startTime ? formatSecondsToHMS(new Date(athlete.etaFinishUTC * 1000).getTime()/1000 - athlete.startTime) : 'N/A'}
                            </TableCell>
                            <TableCell>
                                <Badge className="bg-green-600 text-white animate-pulse">Approaching</Badge>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
         </div>
      </CardContent>
    </Card>
    <AthleteDetailModal 
        isOpen={!!selectedAthlete}
        onClose={() => setSelectedAthlete(null)}
        athlete={selectedAthlete}
        ticketDef={selectedAthleteTicketDef}
    />
    </>
  );
}
