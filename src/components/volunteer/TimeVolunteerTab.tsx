// src/components/volunteer/TimeVolunteerTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { LiveAthlete, EventCalendarEntry } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { getLiveTimingDataAction } from '@/lib/actions';
import { formatSecondsToHMS, normalizeStatus } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Clock, Search as SearchIcon, RefreshCw, AlertTriangle } from 'lucide-react';
import { getEventDetailsWithTicketsAction } from '@/lib/actions';
import { Input } from '@/components/ui/input';
import AthleteDetailModal from '@/components/live-tracking/AthleteDetailModal';

interface TimeVolunteerTabProps {
  eventId: string;
}

export default function TimeVolunteerTab({ eventId }: TimeVolunteerTabProps) {
  const { toast } = useToast();
  const [liveData, setLiveData] = useState<LiveAthlete[]>([]);
  const [eventDetails, setEventDetails] = useState<EventCalendarEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAthlete, setSelectedAthlete] = useState<LiveAthlete | null>(null);
  const [now, setNow] = useState(new Date());

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
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: `Failed to fetch data: ${e.message}` });
    }
    setIsLoading(false);
  }, [eventId, toast]);

  useEffect(() => {
    fetchLiveAndEventData();
    // Refresh elapsed time every second, but not the whole dataset
    const timer = setInterval(() => setNow(new Date()), 1000); 
    return () => clearInterval(timer);
  }, [fetchLiveAndEventData]);

  const { totalParticipants, onCourseCount, finishedCount, dnfCount } = useMemo(() => {
    const total = liveData.length;
    const onCourse = liveData.filter(p => p.status === 'On Course').length;
    const finished = liveData.filter(p => p.status === 'Finished').length;
    const dnf = liveData.filter(p => p.status.startsWith('DNF')).length;
    return { totalParticipants: total, onCourseCount: onCourse, finishedCount: finished, dnfCount: dnf };
  }, [liveData]);
  
  const { dnfAthletes, otherAthletes } = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const filtered = liveData.filter(athlete =>
        !term || 
        athlete.name.toLowerCase().includes(term) ||
        athlete.bib.toLowerCase().includes(term)
    );
    const dnf = filtered.filter(athlete => athlete.status.startsWith('DNF')).sort((a,b) => (b.lastUpdateTime || 0) - (a.lastUpdateTime || 0));
    const others = filtered.filter(athlete => !athlete.status.startsWith('DNF')).sort((a,b) => (a.startTime || 0) - (b.startTime || 0));
    return { dnfAthletes: dnf, otherAthletes: others };
  }, [liveData, searchTerm]);


  const renderAthleteRow = (athlete: LiveAthlete) => {
    const elapsedTime = (athlete.status === 'Not Started' || !athlete.startTime) ? '00:00:00' : formatSecondsToHMS((now.getTime()/1000) - athlete.startTime);
    const status = normalizeStatus(athlete.status);
    
    return (
        <TableRow key={athlete.id} className={status.startsWith('DNF') ? 'bg-destructive/10' : ''}>
            <TableCell className="font-mono">{athlete.bib}</TableCell>
            <TableCell>{athlete.name}</TableCell>
            <TableCell><Badge variant="secondary">{athlete.leg}</Badge></TableCell>
            <TableCell className="font-mono">{elapsedTime}</TableCell>
            <TableCell>
                <Button variant="link" className={`h-auto p-0 ${status.startsWith('DNF') ? 'text-destructive font-bold' : 'text-green-600'}`} onClick={() => setSelectedAthlete(athlete)}>
                  {status}
                </Button>
            </TableCell>
        </TableRow>
    );
  };

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
            <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary"/>Time Volunteer Dashboard</CardTitle>
            <CardDescription>Monitor athlete progress against cutoff times in real-time.</CardDescription>
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
                placeholder="Search by name or BIB..."
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
                        <TableHead>Current Leg</TableHead>
                        <TableHead>Elapsed Time</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? <TableRow><TableCell colSpan={5} className="text-center"><Loader2 className="animate-spin my-4 mx-auto"/></TableCell></TableRow>
                    : (
                      <>
                        {dnfAthletes.length > 0 && (
                          <TableRow className="bg-destructive/20 hover:bg-destructive/30">
                            <TableCell colSpan={5} className="font-semibold text-destructive flex items-center gap-2"><AlertTriangle className="h-5 w-5" />DNF Athletes ({dnfAthletes.length})</TableCell>
                          </TableRow>
                        )}
                        {dnfAthletes.map(athlete => renderAthleteRow(athlete))}
                        {otherAthletes.length > 0 && dnfAthletes.length > 0 && (
                          <TableRow className="bg-muted/50 hover:bg-muted/60">
                             <TableCell colSpan={5} className="font-semibold text-muted-foreground">Other Athletes ({otherAthletes.length})</TableCell>
                          </TableRow>
                        )}
                        {otherAthletes.map(athlete => renderAthleteRow(athlete))}
                        {(dnfAthletes.length === 0 && otherAthletes.length === 0) && (
                           <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No data available.</TableCell></TableRow>
                        )}
                      </>
                    )}
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
