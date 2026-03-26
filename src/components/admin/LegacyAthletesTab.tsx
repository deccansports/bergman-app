// src/components/admin/LegacyAthletesTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { LegacyAthlete, RetentionStats } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Trophy, Star, Download, ShieldAlert, CalendarDays, MapPin, Search, Award, TrendingUp, UserMinus, UserCheck, ArrowRight } from 'lucide-react';
import { getLegacyAthletesAction } from '@/lib/actions';
import { _computeRetentionStats } from '@/lib/actions/analyticsActions';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from '@/components/ui/separator';
import { cn, getOrdinal, toTitleCase } from '@/lib/utils';
import * as XLSX from 'xlsx';

export default function LegacyAthletesTab() {
  const { toast } = useToast();
  const [legacyAthletes, setLegacyAthletes] = useState<LegacyAthlete[]>([]);
  const [retention, setRetention] = useState<RetentionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAthlete, setSelectedAthlete] = useState<LegacyAthlete | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const currentYear = new Date().getFullYear();

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [legacyRes, retentionRes] = await Promise.all([
        getLegacyAthletesAction(),
        _computeRetentionStats(currentYear)
      ]);
      if (legacyRes.success) setLegacyAthletes(legacyRes.legacyAthletes || []);
      if (retentionRes.success) setRetention(retentionRes.stats || null);
    } finally {
      setIsLoading(false);
    }
  }, [currentYear]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredLegacy = useMemo(() => {
    if (!searchTerm) return legacyAthletes;
    const lower = searchTerm.toLowerCase();
    return legacyAthletes.filter(a => a.name.toLowerCase().includes(lower) || a.email.toLowerCase().includes(lower));
  }, [legacyAthletes, searchTerm]);

  const handleExport = () => {
    if (filteredLegacy.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(filteredLegacy.map(a => ({
        'Athlete': a.name,
        'Email': a.email,
        'Achievement': a.achievementYears,
        'Consecutive Years': a.totalYears,
        'Races': a.contributingRaces?.length || 0
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Legacy Roster");
    XLSX.writeFile(workbook, `Bergman_Legacy_Roster_${currentYear}.xlsx`);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 text-left">
      
      {/* RETENTION DASHBOARD */}
      <Card className="border-none shadow-xl bg-slate-950 text-white overflow-hidden text-left relative">
          <div className="absolute top-0 right-0 w-64 h-64 bg-orange-600/10 rounded-full blur-3xl -mr-32 -mt-32"></div>
          <CardHeader className="p-8 pb-4 text-left">
              <div className="flex items-center gap-3 mb-2 text-left">
                  <div className="p-2 bg-orange-600 rounded-lg"><TrendingUp className="h-5 w-5 text-white" /></div>
                  <CardTitle className="text-2xl font-black uppercase italic tracking-tighter text-left">Athlete Retention Dashboard</CardTitle>
              </div>
              <CardDescription className="text-slate-400 font-medium text-left">Tracking the {currentYear} season return rate vs. previous season.</CardDescription>
          </CardHeader>
          <CardContent className="p-8 pt-4 space-y-8 text-left">
              {isLoading ? <div className="h-32 flex items-center justify-center"><Loader2 className="animate-spin text-orange-500" /></div> : (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-left">
                      <div className="space-y-1 text-left">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Last Year Field</p>
                          <p className="text-3xl font-black text-left">{retention?.totalAthletesPrevious || 0}</p>
                      </div>
                      <div className="space-y-1 text-left">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Returning This Year</p>
                          <p className="text-3xl font-black text-green-500 text-left">{retention?.returningAthletes || 0}</p>
                      </div>
                      <div className="space-y-1 text-left">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Lost (Drop-off)</p>
                          <p className="text-3xl font-black text-red-500 text-left">{retention?.dropOffAthletes || 0}</p>
                      </div>
                      <div className="bg-white/5 p-4 rounded-2xl border border-white/10 text-center">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Retention Rate</p>
                          <p className="text-4xl font-black text-orange-500 italic tracking-tighter">{retention?.retentionRate.toFixed(1)}%</p>
                      </div>
                  </div>
              )}
          </CardContent>
      </Card>

      <Card className="border-none shadow-xl text-left overflow-hidden">
        <CardHeader className="bg-primary/5 border-b p-6 text-left flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="text-left">
            <CardTitle className="flex items-center gap-2 text-xl font-black uppercase italic tracking-tighter text-left">
              <Award className="h-6 w-6 text-primary" />
              Legacy Roster Management
            </CardTitle>
            <CardDescription className="text-left font-medium">Athletes with 3+ years of consecutive Bergman finishes.</CardDescription>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" size="sm" onClick={handleExport} disabled={filteredLegacy.length === 0} className="rounded-lg h-9 font-bold text-[10px] uppercase tracking-widest">
                  <Download className="mr-2 h-4 w-4" /> Export Roster
              </Button>
              <div className="relative w-full sm:w-64 text-left">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search legends..." className="pl-8 h-9 text-xs rounded-lg" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 text-left">
            <div className="rounded-none border-t overflow-x-auto text-left shadow-inner">
                <Table>
                    <TableHeader className="bg-muted/30">
                        <TableRow className="h-10 text-[10px] font-black uppercase tracking-widest">
                            <TableHead className="pl-6 text-left">Athlete Identity</TableHead>
                            <TableHead className="text-left">Achievement Window</TableHead>
                            <TableHead className="text-center">Consecutive Years</TableHead>
                            <TableHead className="text-center">Verified Finishes</TableHead>
                            <TableHead className="text-right pr-6">History</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? <TableRow><TableCell colSpan={5} className="text-center p-12"><Loader2 className="animate-spin h-8 w-8 text-primary mx-auto"/></TableCell></TableRow>
                        : filteredLegacy.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-16 text-muted-foreground italic">No legacy athletes found.</TableCell></TableRow>
                        : filteredLegacy.map((a, idx) => (
                            <TableRow key={idx} className="hover:bg-muted/5 transition-colors text-left group">
                                <TableCell className="pl-6 py-4 text-left">
                                    <div className="font-black uppercase text-sm leading-tight text-left">{a.name}</div>
                                    <div className="text-[10px] font-bold text-muted-foreground lowercase text-left">{a.email}</div>
                                </TableCell>
                                <TableCell className="text-left">
                                    <Badge variant="secondary" className="bg-primary/5 text-primary border-primary/20 font-black h-5 text-[10px] uppercase">
                                        {a.achievementYears}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                    <div className="flex items-center justify-center gap-1.5 font-black text-slate-600 italic">
                                        <Trophy className="h-3.5 w-3.5 text-orange-500" />
                                        {a.totalYears} Years
                                    </div>
                                </TableCell>
                                <TableCell className="text-center">
                                    <span className="font-mono font-bold text-slate-400">{a.contributingRaces?.length || 0}</span>
                                </TableCell>
                                <TableCell className="text-right pr-6 text-left">
                                    <Button variant="ghost" size="sm" onClick={() => { setSelectedAthlete(a); setIsDialogOpen(true); }} className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary transition-all p-0">
                                        <ArrowRight className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </CardContent>
      </Card>

      {selectedAthlete && (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-lg bg-slate-950 border-white/10 text-white p-0 overflow-hidden">
            <DialogHeader className="p-6 bg-white/5 border-b border-white/10 text-left">
              <DialogTitle className="text-2xl font-black uppercase italic tracking-tighter text-orange-500 text-left">Legacy Profile</DialogTitle>
              <DialogDescription className="text-slate-400 font-medium text-left">
                Full competition history for <strong>{toTitleCase(selectedAthlete.name)}</strong>.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] p-6 text-left">
                <div className="space-y-4 text-left">
                    {selectedAthlete.contributingRaces?.sort((a,b) => new Date(b.raceDate).getTime() - new Date(a.raceDate).getTime()).map((race, i) => (
                        <div key={i} className="p-4 rounded-xl border border-white/10 bg-white/5 space-y-2 text-left group hover:border-orange-500/50 transition-colors">
                            <div className="flex justify-between items-start text-left">
                                <h5 className="font-black uppercase text-sm tracking-tight group-hover:text-orange-500 transition-colors text-left">{race.raceName}</h5>
                                <Badge className="bg-primary/20 text-primary border-none text-[9px] font-black h-4">{race.year}</Badge>
                            </div>
                            <div className="flex items-center gap-4 text-[10px] font-bold uppercase text-slate-500 tracking-widest text-left">
                                <div className="flex items-center gap-1.5 text-left"><CalendarDays className="h-3 w-3"/> {race.raceDate}</div>
                                <div className="flex items-center gap-1.5 text-left"><MapPin className="h-3 w-3"/> {race.location}</div>
                                <div className="flex items-center gap-1.5 text-left text-orange-500"><Star className="h-3 w-3 fill-orange-500"/> {race.pointsEarned} Pts</div>
                            </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>
            <DialogFooter className="p-4 border-t border-white/10 bg-black/40 text-left">
              <Button variant="ghost" onClick={() => setIsDialogOpen(false)} className="text-slate-400 hover:text-white font-bold uppercase text-xs tracking-widest">
                Close Profile
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
