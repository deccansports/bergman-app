// src/components/volunteer/TimeVolunteerTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { LiveAthlete, EventCalendarEntry } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { getLiveTimingDataAction } from '@/lib/actions';
import { formatSecondsToHMS, normalizeStatus, isFinalRaceStatus } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Clock, Search as SearchIcon, RefreshCw, AlertTriangle, ShieldAlert } from 'lucide-react';
import { getEventDetailsWithTicketsAction } from '@/lib/actions';
import { Input } from '@/components/ui/input';
import AthleteLiveModalPro from '@/components/live-tracking/AthleteLiveModalPro';

interface TimeVolunteerTabProps {
  eventId: string;
}

function textOf(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function getCurrentSplit(athlete: LiveAthlete) {
  return textOf((athlete as any).currentSplit, athlete.leg, '—');
}

function getNextSplit(athlete: LiveAthlete) {
  return textOf((athlete as any).expectedNextSplit, '—');
}

function getNextCutoff(athlete: LiveAthlete) {
  return textOf((athlete as any).nextCutoffLabel, athlete.cutoffStatus, 'Watch');
}

function getTimeRemainingSeconds(athlete: LiveAthlete, nowSec: number) {
  const cutoffUtc = Number((athlete as any).nextCutoffUTC || (athlete as any).cutoffUTC || 0);
  if (Number.isFinite(cutoffUtc) && cutoffUtc > 0) return cutoffUtc - nowSec;
  const etaNext = Number(athlete.etaNextSplitUTC || 0);
  if (Number.isFinite(etaNext) && etaNext > 0) return etaNext - nowSec;
  return null;
}

function getVolunteerStatus(athlete: LiveAthlete, remaining: number | null) {
  const base = normalizeStatus(athlete.status);
  if (base === 'Finished') return 'Finished';
  if (remaining === null) return textOf(athlete.cutoffStatus, 'Watch');
  if (remaining < 0 || base.startsWith('DN')) return 'Missed';
  if (remaining <= 300) return 'Critical';
  if (remaining <= 600) return 'Warning';
  return 'Safe';
}

function statusTone(status: string) {
  const s = status.toLowerCase();
  if (s.includes('miss')) return 'bg-red-600 text-white';
  if (s.includes('critical')) return 'bg-orange-500 text-white';
  if (s.includes('warning')) return 'bg-yellow-500 text-black';
  if (s.includes('safe')) return 'bg-emerald-600 text-white';
  if (s.includes('finished')) return 'bg-slate-700 text-white';
  return 'bg-slate-200 text-slate-900';
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

  const cutoffWatchAthletes = useMemo(() => {
    const nowSec = now.getTime() / 1000;
    const term = searchTerm.toLowerCase();

    const scoreForStatus = (status: string, remaining: number | null) => {
      if (status === 'Missed') return 0;
      if (status === 'Critical') return 1;
      if (status === 'Warning') return 2;
      if (status === 'Safe') return 3;
      return 4;
    };

    return liveData
      .filter((athlete) => {
        const status = normalizeStatus(athlete.status);
        if (status === 'Not Started' || status === 'Finished') return false;
        if (term && ![athlete.name, athlete.bib, athlete.category, athlete.ageGroup, status, getCurrentSplit(athlete), getNextSplit(athlete), getNextCutoff(athlete)].some((value) => String(value || '').toLowerCase().includes(term))) return false;
        return true;
      })
      .map((athlete) => {
        const rawRemaining = getTimeRemainingSeconds(athlete, nowSec);
        const status = getVolunteerStatus(athlete, rawRemaining);
        return { athlete, status, remaining: rawRemaining };
      })
      .sort((a, b) => scoreForStatus(a.status, a.remaining) - scoreForStatus(b.status, b.remaining) || (a.remaining ?? Number.MAX_SAFE_INTEGER) - (b.remaining ?? Number.MAX_SAFE_INTEGER));
  }, [liveData, now, searchTerm]);

  const selectedAthleteTicketDef = useMemo(() => {
    if (!selectedAthlete || !selectedAthlete.ticketId) return undefined;
    return eventDetails?.ticketDefinitions?.find((td) => td.id === selectedAthlete.ticketId);
  }, [selectedAthlete, eventDetails]);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />Time Volunteer Dashboard</CardTitle>
              <CardDescription>Cutoff-only monitoring using official timing data.</CardDescription>
            </div>
            <Button onClick={() => void fetchLiveAndEventData(true)} disabled={isLoading} variant="outline" size="sm">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Card className="border-orange-200 bg-orange-50/40 dark:bg-orange-950/10">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-300">
                <AlertTriangle className="h-5 w-5" /> Cutoff Watch
              </CardTitle>
              <CardDescription>Only athletes with a live timing or cutoff concern are listed here.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search bib or name..." className="pl-9" />
              </div>

              <div className="overflow-x-auto rounded-2xl border bg-background">
                <table className="min-w-[1100px] w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                    <tr className="text-left text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      <th className="px-4 py-3">Bib</th>
                      <th className="px-4 py-3">Athlete</th>
                      <th className="px-4 py-3">Contest</th>
                      <th className="px-4 py-3">Current Leg</th>
                      <th className="px-4 py-3">Last Official Split</th>
                      <th className="px-4 py-3">Next Cutoff</th>
                      <th className="px-4 py-3">Time Remaining</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cutoffWatchAthletes.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No athletes are currently at cutoff risk.</td>
                      </tr>
                    ) : cutoffWatchAthletes.map(({ athlete, status, remaining }) => (
                      <tr key={athlete.id} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => setSelectedAthlete(athlete)}>
                        <td className="px-4 py-3 font-mono font-semibold">{athlete.bib}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{athlete.name}</div>
                          <div className="text-xs text-muted-foreground">{athlete.category}</div>
                        </td>
                        <td className="px-4 py-3">{athlete.contestName || eventDetails?.customSlug || '—'}</td>
                        <td className="px-4 py-3">{textOf(athlete.leg, '—')}</td>
                        <td className="px-4 py-3">{getCurrentSplit(athlete)}</td>
                        <td className="px-4 py-3">{getNextCutoff(athlete)}</td>
                        <td className="px-4 py-3 font-mono">{remaining === null ? '—' : `${remaining < 0 ? '-' : ''}${formatSecondsToHMS(Math.abs(remaining))}`}</td>
                        <td className="px-4 py-3"><Badge className={statusTone(status)}>{status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" /> Athlete Details</CardTitle>
              <CardDescription>Tap an athlete to inspect cutoff timing details.</CardDescription>
            </CardHeader>
            <CardContent>
              {selectedAthlete ? (
                <div className="grid gap-3 rounded-2xl border bg-muted/20 p-4 md:grid-cols-2 xl:grid-cols-4">
                  <div><div className="text-xs text-muted-foreground">Bib</div><div className="font-black">{selectedAthlete.bib}</div></div>
                  <div><div className="text-xs text-muted-foreground">Current Leg</div><div className="font-black">{textOf(selectedAthlete.leg, '—')}</div></div>
                  <div><div className="text-xs text-muted-foreground">Last Official Split</div><div className="font-black">{getCurrentSplit(selectedAthlete)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Next Cutoff</div><div className="font-black">{getNextCutoff(selectedAthlete)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Official Time</div><div className="font-black">{selectedAthlete.startTime ? new Date(selectedAthlete.startTime * 1000).toLocaleTimeString() : '—'}</div></div>
                  <div><div className="text-xs text-muted-foreground">Current Elapsed</div><div className="font-black">{selectedAthlete.startTime ? formatSecondsToHMS((now.getTime() / 1000) - selectedAthlete.startTime) : '—'}</div></div>
                  <div><div className="text-xs text-muted-foreground">Time Remaining</div><div className="font-black">{selectedAthlete ? `${(getTimeRemainingSeconds(selectedAthlete, now.getTime() / 1000) || 0) < 0 ? '-' : ''}${formatSecondsToHMS(Math.abs(getTimeRemainingSeconds(selectedAthlete, now.getTime() / 1000) || 0))}` : '—'}</div></div>
                  <div><div className="text-xs text-muted-foreground">Status</div><Badge className={selectedAthlete ? statusTone(getVolunteerStatus(selectedAthlete, getTimeRemainingSeconds(selectedAthlete, now.getTime() / 1000))) : 'bg-slate-200 text-slate-900'}>{selectedAthlete ? getVolunteerStatus(selectedAthlete, getTimeRemainingSeconds(selectedAthlete, now.getTime() / 1000)) : '—'}</Badge></div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">Select an athlete to view cutoff details.</div>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <AthleteLiveModalPro
        open={!!selectedAthlete}
        onClose={() => setSelectedAthlete(null)}
        athlete={selectedAthlete}
        ticketDef={selectedAthleteTicketDef}
        eventId=""
        bookingId=""
      />
    </>
  );
}
