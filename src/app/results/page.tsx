
// src/app/results/page.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { 
  getDistinctEventsFromResultsAction, 
  getPublicFinalResultsAction,
  getEventDetailsWithTicketsAction,
  getAthleteRankingData
} from '@/lib/actions';
import type { RaceResult, EventCalendarEntry, TicketDefinition, RankedAthlete } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { 
  Loader2, Search, Trophy, Download, ArrowLeft, FilterX, CalendarDays, Award, Star, Info, Hash, Mail, User, RefreshCw, Filter
} from 'lucide-react';
import { normalizeStatus, formatSecondsToHMS, hmsToSeconds, getOrdinal, isTriathlonEvent, isDuathlonEvent, formatOptionalTime, cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import FinisherCertificate from '@/components/results/FinisherCertificate';

function ResultsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [events, setEvents] = useState<{ id: string; name: string; date: string | null; customSlug: string | null }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchBy, setSearchBy] = useState<'bib' | 'name' | 'email'>('bib');
  const [results, setResults] = useState<RaceResult[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  
  // Certificate View States
  const [viewingResult, setViewingResult] = useState<RaceResult | null>(null);
  const [eventDetails, setEventDetails] = useState<EventCalendarEntry | null>(null);
  const [totalYearlyPoints, setTotalYearlyPoints] = useState<number | null>(null);
  const [isLoadingCertificateData, setIsLoadingCertificateData] = useState(false);

  const loadCertificateData = useCallback(async (athlete: RaceResult, eventId: string) => {
    setIsLoadingCertificateData(true);
    try {
      const [detailsRes, rankingRes] = await Promise.all([
        getEventDetailsWithTicketsAction(eventId),
        athlete.raceDate ? getAthleteRankingData({ year: new Date(athlete.raceDate).getFullYear() }) : Promise.resolve({ success: false, rankings: [] as RankedAthlete[] })
      ]);

      if (detailsRes.success && detailsRes.event) {
        setEventDetails(detailsRes.event);
      }

      if (rankingRes.success && rankingRes.rankings) {
        const ranking = rankingRes.rankings.find(r => 
          r.athleteId === athlete.athleteUid || 
          (r.email && athlete.email && r.email.toLowerCase() === athlete.email.toLowerCase())
        );
        setTotalYearlyPoints(ranking?.totalPoints || null);
      }

      setViewingResult(athlete);
    } catch (e) {
      console.error("Error loading certificate context:", e);
    } finally {
      setIsLoadingCertificateData(false);
    }
  }, []);

  const handleDirectView = useCallback(async (eventId: string, bib: string) => {
    setIsLoadingCertificateData(true);
    try {
      const res = await getPublicFinalResultsAction(eventId, [bib]);
      if (res.success && res.participants && res.participants.length > 0) {
        await loadCertificateData(res.participants[0], eventId);
      }
    } finally {
      setIsLoadingCertificateData(false);
    }
  }, [loadCertificateData]);

  // 1. Load available events with results (Latest First)
  useEffect(() => {
    setIsLoadingEvents(true);
    getDistinctEventsFromResultsAction().then(result => {
      if (result.success && result.events) {
        setEvents(result.events);
        
        // Handle URL parameters for direct certificate view
        const eventSlug = searchParams.get('eventSlug');
        const bib = searchParams.get('bib');
        
        const targetEvent = result.events.find(e => e.customSlug === eventSlug || e.id === eventSlug);
        if (targetEvent) {
          setSelectedEventId(targetEvent.id);
          if (bib) {
            handleDirectView(targetEvent.id, bib);
          }
        } else if (result.events.length > 0) {
            setSelectedEventId(result.events[0].id);
        }
      }
      setIsLoadingEvents(false);
    });
  }, [searchParams, handleDirectView]);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedEventId) return;
    setIsSearching(true);
    setHasSearched(true);
    try {
      const res = await getPublicFinalResultsAction(selectedEventId, null, { term: searchTerm, by: searchBy as any });
      if (res.success && res.participants) {
        setResults(res.participants);
      } else {
        setResults([]);
      }
    } finally {
      setIsSearching(false);
    }
  };

  const visibleColumns = useMemo(() => {
    const tri = results.some(r => isTriathlonEvent(r.eventCategory || r.raceCategory));
    const dua = results.some(r => isDuathlonEvent(r.eventCategory || r.raceCategory));
    return {
      showSwim: tri,
      showRun1: dua,
      showT1: tri || dua,
      showBike: tri || dua,
      showT2: tri || dua,
      showRun: tri,
      showRun2: dua
    };
  }, [results]);

  if (viewingResult) {
    const ticketDef = eventDetails?.ticketDefinitions?.find(t => t.id === viewingResult.ticketId);
    return (
      <FinisherCertificate 
        athlete={viewingResult} 
        eventName={eventDetails?.eventName || viewingResult.eventName || 'Bergman Event'}
        eventSlug={eventDetails?.customSlug || eventDetails?.id}
        ticketDef={ticketDef}
        totalYearlyPoints={totalYearlyPoints}
        onBack={() => setViewingResult(null)}
      />
    );
  }

  return (
    <div className="container mx-auto py-12 px-4 max-w-7xl text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10 text-left">
        <div className="space-y-2 text-left">
          <h1 className="text-4xl font-black uppercase italic tracking-tighter text-primary text-left">Official Race Results</h1>
          <p className="text-muted-foreground font-medium text-left">Find your splits and download certificates from any Bergman event.</p>
        </div>
      </div>

      <div className="space-y-8 text-left">
        {/* HORIZONTAL FILTERS */}
        <Card className="border-none shadow-xl overflow-hidden bg-primary/5">
          <CardHeader className="pb-4 border-b border-primary/10">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-primary text-left flex items-center gap-2">
                <Search className="h-4 w-4" /> Query Race Database
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end text-left">
              
              <div className="md:col-span-4 space-y-2 text-left">
                <Label className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2">
                    <CalendarDays className="h-3 w-3" /> 1. Select Race Edition*
                </Label>
                <Select value={selectedEventId || ''} onValueChange={setSelectedEventId} disabled={isLoadingEvents}>
                  <SelectTrigger className="h-11 rounded-xl bg-background border-none shadow-sm font-bold">
                    <SelectValue placeholder={isLoadingEvents ? "Loading..." : "Choose event..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name} ({e.date ? format(parseISO(e.date), 'yyyy') : 'TBD'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-2 space-y-2 text-left">
                <Label className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2">
                    <Filter className="h-3 w-3" /> Search By
                </Label>
                <Select value={searchBy} onValueChange={(v: any) => setSearchBy(v)}>
                  <SelectTrigger className="h-11 rounded-xl bg-background border-none shadow-sm font-bold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bib">BIB Number</SelectItem>
                    <SelectItem value="name">Athlete Name</SelectItem>
                    <SelectItem value="email">Email Address</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-4 space-y-2 text-left">
                <Label className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2">
                    {searchBy === 'bib' ? <Hash className="h-3 w-3" /> : searchBy === 'email' ? <Mail className="h-3 w-3" /> : <User className="h-3 w-3" />}
                    Enter {searchBy === 'bib' ? 'BIB' : searchBy === 'email' ? 'Email' : 'Name'}
                </Label>
                <Input
                  placeholder={searchBy === 'bib' ? "e.g., 101" : "Type to search..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-11 rounded-xl border-none shadow-sm bg-background font-bold"
                />
              </div>

              <div className="md:col-span-2 text-left">
                <Button 
                    type="submit" 
                    className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase tracking-widest text-xs shadow-lg shadow-primary/20"
                    disabled={isSearching || !selectedEventId || !searchTerm}
                >
                  {isSearching ? <Loader2 className="animate-spin h-4 w-4" /> : <Search className="mr-2 h-4 w-4" />}
                  Find Result
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* RESULTS TABLE */}
        <Card className="border-none shadow-2xl rounded-2xl overflow-hidden bg-card">
          <CardContent className="p-0">
            <div className="overflow-x-auto text-left">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="h-12 border-b text-[10px] font-black uppercase tracking-widest">
                    <TableHead className="pl-6">BIB</TableHead>
                    <TableHead>Athlete</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Chip Time</TableHead>
                    {visibleColumns.showSwim && <TableHead>Swim</TableHead>}
                    {visibleColumns.showRun1 && <TableHead>Run 1</TableHead>}
                    <TableHead>T1</TableHead>
                    <TableHead>Bike</TableHead>
                    <TableHead>T2</TableHead>
                    {visibleColumns.showRun && <TableHead>Run</TableHead>}
                    {visibleColumns.showRun2 && <TableHead>Run 2</TableHead>}
                    <TableHead className="text-right pr-6">Certificate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isSearching ? (
                    <TableRow>
                      <TableCell colSpan={15} className="h-48 text-center">
                        <Loader2 className="animate-spin h-10 w-10 text-primary mx-auto" />
                        <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Searching records...</p>
                      </TableCell>
                    </TableRow>
                  ) : results.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={15} className="h-64 text-center">
                        <div className="max-w-xs mx-auto space-y-3 opacity-40">
                            <FilterX className="h-12 w-12 mx-auto" />
                            <p className="text-sm font-bold uppercase tracking-tight">
                                {hasSearched ? "No matching records found." : "Enter a BIB or Name to retrieve results."}
                            </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    results.map((r) => {
                      const resStatus = normalizeStatus(r.status);
                      const isFinished = resStatus === 'Finished';
                      return (
                        <TableRow key={r.docId} className="h-16 hover:bg-primary/5 transition-colors border-border/50 text-xs">
                          <TableCell className="pl-6 font-mono font-bold text-primary">{r.bibNumber}</TableCell>
                          <TableCell className="font-black uppercase tracking-tight">{r.name}</TableCell>
                          <TableCell className="font-bold text-slate-500">{r.category}</TableCell>
                          <TableCell>
                            <Badge variant={isFinished ? 'default' : 'destructive'} className="text-[9px] uppercase font-black px-2 h-5">
                                {resStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono font-bold text-lg text-foreground italic">{isFinished ? formatOptionalTime(r.chipTime) : '—'}</TableCell>
                          {visibleColumns.showSwim && <TableCell className="font-mono text-slate-400">{formatOptionalTime(r.swim)}</TableCell>}
                          {visibleColumns.showRun1 && <TableCell className="font-mono text-slate-400">{formatOptionalTime(r.run1)}</TableCell>}
                          <TableCell className="font-mono text-slate-400">{formatOptionalTime(r.t1)}</TableCell>
                          <TableCell className="font-mono text-slate-400">{formatOptionalTime(r.bike)}</TableCell>
                          <TableCell className="font-mono text-slate-400">{formatOptionalTime(r.t2)}</TableCell>
                          {visibleColumns.showRun && <TableCell className="font-mono text-slate-400">{formatOptionalTime(r.run)}</TableCell>}
                          {visibleColumns.showRun2 && <TableCell className="font-mono text-slate-400">{formatOptionalTime(r.run2)}</TableCell>}
                          <TableCell className="text-right pr-6">
                            {isFinished ? (
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="rounded-xl h-9 px-4 font-black uppercase text-[10px] tracking-widest border-primary/20 hover:bg-primary hover:text-white transition-all group"
                                onClick={() => loadCertificateData(r, selectedEventId!)}
                                disabled={isLoadingCertificateData}
                              >
                                {isLoadingCertificateData ? <Loader2 className="h-3 w-3 animate-spin"/> : <Download className="mr-2 h-3 w-3 group-hover:scale-110" />}
                                Download
                              </Button>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-300 uppercase">Unavailable</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        
        <div className="flex flex-col md:flex-row items-start gap-4 p-6 bg-muted/30 rounded-2xl border border-dashed text-left">
            <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="text-[10px] font-medium text-muted-foreground uppercase leading-relaxed text-left">
                <p className="font-black text-foreground mb-1 text-left">Timing Audit Policy</p>
                Race results are verified by the timing official. If you believe there is a data discrepancy or your BIB is missing, please contact the support team at <a href="mailto:info@bergmantri.com" className="text-primary hover:underline">info@bergmantri.com</a> with your booking ID.
            </div>
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={
        <div className="flex h-screen w-full items-center justify-center bg-background">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
    }>
      <ResultsPageContent />
    </Suspense>
  );
}
