// src/components/admin/AthleteInsightsTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Loader2, Users, BarChart3, TrendingUp, Download, Globe, Repeat, Target, Layers3, ArrowRight } from 'lucide-react';
import { getGlobalParticipantStatsAction, compareEventParticipantsAction } from '@/lib/actions/analyticsActions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { User, EventCalendarEntry, CrossEventComparison } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import * as XLSX from 'xlsx';

interface GlobalStats {
  totalAthletes: number;
  clubAffiliatedAthletes: number;
  athletesInUpcomingEvents: number;
}

interface AthleteInsightsTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function AthleteInsightsTab({ events, isLoadingEvents }: AthleteInsightsTabProps) {
  const { toast } = useToast();
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // State for comparison feature
  const [eventA, setEventA] = useState<string | null>(null);
  const [eventB, setEventB] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CrossEventComparison | null>(null);
  const [isComparing, setIsComparing] = useState(false);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getGlobalParticipantStatsAction();
      if (result.success && result.stats) {
        setStats(result.stats);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleCompare = async () => {
    if (!eventA || !eventB) return;
    if (eventA === eventB) {
      toast({ variant: 'destructive', description: 'Please select two different events.' });
      return;
    }
    setIsComparing(true);
    try {
      const result = await compareEventParticipantsAction(eventA, eventB);
      if (result.success && result.stats) {
        setComparison(result.stats);
        toast({ title: 'Comparison Complete' });
      }
    } finally {
      setIsComparing(false);
    }
  };

  const handleDownload = () => {
    if (!comparison?.repeatedAthletes.length) return;
    const eventAName = events.find(e => e.id === eventA)?.eventName || 'Event A';
    const eventBName = events.find(e => e.id === eventB)?.eventName || 'Event B';
    const worksheet = XLSX.utils.json_to_sheet(comparison.repeatedAthletes.map(a => ({
        Name: a.name,
        Email: a.email,
        [`BIB (${eventAName})`]: a.bibA,
        [`BIB (${eventBName})`]: a.bibB,
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Repeated Athletes");
    XLSX.writeFile(workbook, `Loyalty_Overlap_${eventAName}_vs_${eventBName}.xlsx`);
  };

  const sortedEvents = useMemo(() => {
      return [...events].sort((a,b) => new Date(b.eventDate!).getTime() - new Date(a.eventDate!).getTime());
  }, [events]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 text-left">
      <Card className="border-none shadow-xl">
        <CardHeader className="bg-primary/5 text-left border-b">
          <CardTitle className="flex items-center gap-2 text-2xl font-black uppercase italic tracking-tighter text-left">
            <BarChart3 className="h-6 w-6 text-primary"/>
            Ecosystem Insights
          </CardTitle>
          <CardDescription className="text-left font-medium">Platform-wide participation and loyalty snapshots.</CardDescription>
        </CardHeader>
        <CardContent className="pt-8">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>
          ) : stats ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <Card className="bg-muted/20 border-none shadow-sm group hover:bg-primary/5 transition-all">
                <CardHeader className="p-6">
                  <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4"><Globe className="h-6 w-6 text-primary"/></div>
                  <CardTitle className="text-4xl font-black text-primary tracking-tighter">{stats.totalAthletes}</CardTitle>
                  <CardDescription className="font-bold uppercase text-[10px] tracking-widest mt-2">Active Athlete Profiles</CardDescription>
                </CardHeader>
              </Card>
              <Card className="bg-muted/20 border-none shadow-sm group hover:bg-orange-50 transition-all">
                <CardHeader className="p-6">
                  <div className="mx-auto h-12 w-12 rounded-2xl bg-orange-100 flex items-center justify-center mb-4"><Users className="h-6 w-6 text-orange-600"/></div>
                  <CardTitle className="text-4xl font-black text-orange-600 tracking-tighter">{stats.clubAffiliatedAthletes}</CardTitle>
                  <CardDescription className="font-bold uppercase text-[10px] tracking-widest mt-2">Club Affiliated Athletes</CardDescription>
                </CardHeader>
              </Card>
              <Card className="bg-muted/20 border-none shadow-sm group hover:bg-green-50 transition-all">
                <CardHeader className="p-6">
                  <div className="mx-auto h-12 w-12 rounded-2xl bg-green-100 flex items-center justify-center mb-4"><TrendingUp className="h-6 w-6 text-green-600"/></div>
                  <CardTitle className="text-4xl font-black text-green-600 tracking-tighter">{stats.athletesInUpcomingEvents}</CardTitle>
                  <CardDescription className="font-bold uppercase text-[10px] tracking-widest mt-2">In Upcoming Races</CardDescription>
                </CardHeader>
              </Card>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-none shadow-xl overflow-hidden text-left">
          <CardHeader className="bg-muted/30 border-b p-6 text-left">
            <CardTitle className="flex items-center gap-2 text-xl font-black uppercase italic tracking-tighter text-left">
                <Repeat className="h-5 w-5 text-primary"/> Cross-Event Participation Analysis
            </CardTitle>
            <CardDescription className="text-left font-medium">Compare two events to identify returning participants and event-to-event loyalty.</CardDescription>
          </CardHeader>
          <CardContent className="p-8 space-y-8 text-left">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-end text-left">
                  <div className="space-y-2 text-left">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Original Event (A)</Label>
                      <Select onValueChange={setEventA} disabled={isLoadingEvents} value={eventA || undefined}>
                          <SelectTrigger className="h-11 rounded-xl bg-muted/20 border-none font-bold"><SelectValue placeholder="Select reference event..." /></SelectTrigger>
                          <SelectContent>{sortedEvents.map(e => <SelectItem key={`a-${e.id}`} value={e.id}>{e.eventName}</SelectItem>)}</SelectContent>
                      </Select>
                  </div>
                  <div className="space-y-2 text-left">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Comparison Event (B)</Label>
                      <Select onValueChange={setEventB} disabled={isLoadingEvents} value={eventB || undefined}>
                          <SelectTrigger className="h-11 rounded-xl bg-muted/20 border-none font-bold"><SelectValue placeholder="Select target event..." /></SelectTrigger>
                          <SelectContent>{sortedEvents.map(e => <SelectItem key={`b-${e.id}`} value={e.id}>{e.eventName}</SelectItem>)}</SelectContent>
                      </Select>
                  </div>
              </div>
              
              <Button onClick={handleCompare} disabled={isComparing || !eventA || !eventB} className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase tracking-widest shadow-xl shadow-primary/20">
                  {isComparing ? <Loader2 className="mr-3 h-5 w-5 animate-spin"/> : <Repeat className="mr-3 h-5 w-5" />}
                  Analyze Participation Overlap
              </Button>

              {comparison && (
                  <div className="space-y-8 animate-in slide-in-from-top-4 duration-500 text-left pt-4 border-t">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                          <Card className="bg-slate-900 text-white border-none shadow-lg rounded-2xl">
                              <CardHeader className="p-5 pb-2"><CardTitle className="text-3xl font-black italic tracking-tighter text-orange-500">{comparison.overlapCount}</CardTitle><CardDescription className="text-[9px] uppercase font-bold text-slate-400">Repeated Athletes</CardDescription></CardHeader>
                          </Card>
                          <Card className="bg-slate-900 text-white border-none shadow-lg rounded-2xl">
                              <CardHeader className="p-5 pb-2"><CardTitle className="text-2xl font-black italic tracking-tighter">{comparison.overlapPercentage.toFixed(1)}%</CardTitle><CardDescription className="text-[9px] uppercase font-bold text-slate-400">Loyalty Rate (A → B)</CardDescription></CardHeader>
                              <CardContent className="px-5 pb-4"><Progress value={comparison.overlapPercentage} className="h-1 bg-white/10" /></CardContent>
                          </Card>
                          <Card className="bg-slate-900 text-white border-none shadow-lg rounded-2xl">
                              <CardHeader className="p-5 pb-2"><CardTitle className="text-2xl font-black italic tracking-tighter">{comparison.totalA + comparison.totalB - comparison.overlapCount}</CardTitle><CardDescription className="text-[9px] uppercase font-bold text-slate-400">Total Unique Reach</CardDescription></CardHeader>
                          </Card>
                      </div>

                      <div className="space-y-4 text-left">
                          <div className="flex justify-between items-center text-left">
                              <h4 className="font-black text-sm uppercase tracking-tight flex items-center gap-2">
                                  <Users className="h-4 w-4 text-primary" /> Overlap Roster
                              </h4>
                              <Button onClick={handleDownload} variant="outline" size="sm" className="rounded-lg font-bold text-[10px] uppercase h-8 px-4">
                                  <Download className="mr-2 h-3.5 w-3.5" /> Export Overlap List
                              </Button>
                          </div>
                          <div className="rounded-2xl border overflow-hidden shadow-inner text-left">
                              <Table>
                                  <TableHeader className="bg-muted/50">
                                      <TableRow className="h-10 text-[10px] font-black uppercase">
                                          <TableHead className="pl-6 text-left">Athlete Name</TableHead>
                                          <TableHead className="text-left">Email Address</TableHead>
                                          <TableHead className="text-right">BIB (A)</TableHead>
                                          <TableHead className="text-right pr-6">BIB (B)</TableHead>
                                      </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                      {comparison.repeatedAthletes.map((a, i) => (
                                          <TableRow key={i} className="h-12 hover:bg-muted/5 text-xs text-left">
                                              <TableCell className="pl-6 font-bold uppercase text-left">{a.name}</TableCell>
                                              <TableCell className="text-muted-foreground lowercase text-left">{a.email}</TableCell>
                                              <TableCell className="text-right font-mono font-bold text-slate-400">{a.bibA || '—'}</TableCell>
                                              <TableCell className="text-right pr-6 font-mono font-bold text-primary">{a.bibB || '—'}</TableCell>
                                          </TableRow>
                                      ))}
                                  </TableBody>
                              </Table>
                          </div>
                      </div>
                  </div>
              )}
          </CardContent>
      </Card>
    </div>
  );
}
