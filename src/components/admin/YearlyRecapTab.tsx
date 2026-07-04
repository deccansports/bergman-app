// src/components/admin/YearlyRecapTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { RankedAthlete, ClubRankingEntry, RaceResult } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Award, Mail, Send, CalendarDays, TestTube2, Search, Trophy, Building, History, Star, TrendingUp, Info, ChevronDown, ChevronUp, Sparkles, User as UserIcon } from 'lucide-react';
import { getAthleteRankingData, sendYearlyRecapEmailAction, getClubRankingData } from '@/lib/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getOrdinal, formatSecondsToHMS, hmsToSeconds, cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Badge } from '../ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

const MIN_YEAR = 2023;

function StatsSummary({ rankings, clubs, year }: { rankings: RankedAthlete[], clubs: ClubRankingEntry[], year: string }) {
    const stats = useMemo(() => {
        const totalPoints = rankings.reduce((sum, r) => sum + r.totalPoints, 0);
        const topMale = rankings.filter(r => r.gender === 'Male')[0];
        const topFemale = rankings.filter(r => r.gender === 'Female')[0];
        const topClub = clubs[0];

        return { totalPoints, topMale, topFemale, topClub };
    }, [rankings, clubs]);

    return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
            <Card className="bg-primary/5 border-none shadow-md group hover:bg-primary transition-all">
                <CardHeader className="p-4"><CardTitle className="text-2xl font-black group-hover:text-white transition-colors">{stats.totalPoints.toLocaleString()}</CardTitle><CardDescription className="text-[9px] uppercase font-black tracking-widest group-hover:text-white/70 transition-colors">Total Season Points</CardDescription></CardHeader>
            </Card>
            <Card className="bg-amber-50 border-none shadow-md">
                <CardHeader className="p-4"><CardTitle className="text-base font-black text-amber-700 truncate">{stats.topMale?.name || 'N/A'}</CardTitle><CardDescription className="text-[9px] uppercase font-black tracking-widest text-amber-600">Leader (Male)</CardDescription></CardHeader>
            </Card>
            <Card className="bg-pink-50 border-none shadow-md">
                <CardHeader className="p-4"><CardTitle className="text-base font-black text-pink-700 truncate">{stats.topFemale?.name || 'N/A'}</CardTitle><CardDescription className="text-[9px] uppercase font-black tracking-widest text-pink-600">Leader (Female)</CardDescription></CardHeader>
            </Card>
            <Card className="bg-blue-50 border-none shadow-md">
                <CardHeader className="p-4"><CardTitle className="text-base font-black text-blue-700 truncate">{stats.topClub?.clubName || 'N/A'}</CardTitle><CardDescription className="text-[9px] uppercase font-black tracking-widest text-blue-600">Top Overall Club</CardDescription></CardHeader>
            </Card>
        </div>
    );
}

function AthleteRecap({ rankings, year, isLoading }: { rankings: RankedAthlete[], year: string, isLoading: boolean }) {
  const { toast } = useToast();
  const [isSending, setIsSending] = useState<string | null>(null);
  const [isSendingAll, setIsSendingAll] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleSendRecap = async (athlete: RankedAthlete) => {
    setIsSending(athlete.athleteId);
    const result = await sendYearlyRecapEmailAction(athlete, parseInt(year, 10));
    if (result.success) toast({ title: 'Recap Delivered', description: `Sent to ${athlete.email}` });
    else toast({ variant: 'destructive', title: 'Error', description: result.message });
    setIsSending(null);
  };

  const filteredAthletes = useMemo(() => {
    if (!searchTerm) return rankings;
    const term = searchTerm.toLowerCase();
    return rankings.filter(athlete => athlete.name.toLowerCase().includes(term) || athlete.email?.toLowerCase().includes(term));
  }, [rankings, searchTerm]);

  const handleSendToAll = async () => {
    if(!confirm(`BROADCAST ALERT: You are about to send yearly recaps to ${filteredAthletes.length} athletes. Proceed?`)) return;
    setIsSendingAll(true);
    let successCount = 0, errorCount = 0;
    for (const athlete of filteredAthletes) {
        if (!athlete.email) continue;
        const result = await sendYearlyRecapEmailAction(athlete, parseInt(year, 10));
        if (result.success) successCount++;
        else errorCount++;
    }
    toast({ title: 'Broadcast Complete', description: `Success: ${successCount} | Failed: ${errorCount}`, duration: 7000 });
    setIsSendingAll(false);
  };

  const handleSendTestRecap = async () => {
    if (!testEmail) return;
    setIsSendingTest(true);
    const testAthleteData: RankedAthlete = {
      athleteId: 'test-uid', name: 'Sandbox Athlete', email: testEmail, mobile: '+910000000000',
      clubName: 'Bergman United', country: 'India', totalPoints: 1240, racesFinished: 3, 
      overallRank: 8, gender: 'Male', ageCategory: '31-40', categoryRank: 2, totalInCategory: 45, races: [],
    };
    const result = await sendYearlyRecapEmailAction(testAthleteData, parseInt(year, 10), true);
    if (result.success) toast({ title: 'Sandbox Delivery Successful' });
    setIsSendingTest(false);
  };

  return (
    <div className="space-y-6 text-left">
        <div className="flex flex-col sm:flex-row gap-4 items-center text-left">
            <div className="relative flex-grow w-full sm:w-auto text-left"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Filter athlete name or email..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-11 rounded-xl border-muted font-bold text-sm"/></div>
            <Button onClick={handleSendToAll} disabled={isLoading || isSendingAll || filteredAthletes.length === 0} className="rounded-xl h-11 px-8 font-black uppercase tracking-widest text-[10px] bg-primary shadow-xl shadow-primary/20">
                {isSendingAll ? <Loader2 className="animate-spin h-4 w-4 mr-2"/> : <Mail className="h-4 w-4 mr-2"/>}
                Broadcast Season Recaps ({filteredAthletes.length})
            </Button>
        </div>

        <div className="p-6 border-2 border-dashed rounded-2xl bg-muted/20 flex flex-col sm:flex-row gap-6 items-center justify-between text-left">
            <div className="text-left"><h4 className="font-black uppercase text-[10px] tracking-widest text-primary flex items-center gap-2 text-left"><TestTube2 className="h-3.5 w-3.5"/>Broadcast Sandbox</h4><p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">Send a test recap to verify content mapping and layout.</p></div>
            <div className="flex gap-2 w-full sm:w-auto text-left"><Input type="email" placeholder="test.recipient@email.com" value={testEmail} onChange={e => setTestEmail(e.target.value)} disabled={isSendingTest} className="h-10 text-xs rounded-xl bg-background font-bold"/><Button onClick={handleSendTestRecap} disabled={isSendingTest || !testEmail} variant="secondary" className="h-10 text-[10px] font-black uppercase tracking-widest px-6 rounded-xl">{isSendingTest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Send Test'}</Button></div>
        </div>

        <div className="rounded-2xl border overflow-hidden text-left shadow-inner bg-card">
            <Table>
                <TableHeader className="bg-muted/30">
                    <TableRow className="h-12 text-[10px] font-black uppercase tracking-widest border-b">
                        <TableHead className="pl-6 text-left">Rank</TableHead>
                        <TableHead className="text-left">Athlete Identity</TableHead>
                        <TableHead className="text-center">Finishes</TableHead>
                        <TableHead className="text-right">Season Points</TableHead>
                        <TableHead className="text-right pr-6">Action</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? <TableRow><TableCell colSpan={5} className="text-center p-12"><Loader2 className="animate-spin h-10 w-10 mx-auto text-primary" /></TableCell></TableRow> 
                    : filteredAthletes.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic font-medium">No ranked athletes found for the {year} season.</TableCell></TableRow> 
                    : filteredAthletes.map((a) => {
                        const isOpen = expandedId === a.athleteId;
                        return (
                        <React.Fragment key={a.athleteId}>
                            <TableRow className={cn("hover:bg-primary/5 transition-all cursor-pointer text-left h-16 group", isOpen && "bg-primary/5")} onClick={() => setExpandedId(isOpen ? null : a.athleteId)}>
                                <TableCell className="pl-6 font-black italic text-primary text-lg">{a.overallRank}</TableCell>
                                <TableCell className="text-left">
                                    <div className="font-black text-sm uppercase leading-tight group-hover:text-primary transition-colors">{a.name}</div>
                                    <div className="text-[10px] font-bold text-muted-foreground lowercase">{a.email}</div>
                                </TableCell>
                                <TableCell className="text-center font-black text-slate-500 uppercase text-[10px]">{a.racesFinished} Events</TableCell>
                                <TableCell className="text-right font-black text-xl italic text-primary tracking-tighter pr-4">{a.totalPoints}</TableCell>
                                <TableCell className="text-right pr-6">
                                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full hover:bg-primary hover:text-white" onClick={(e) => { e.stopPropagation(); handleSendRecap(a); }} disabled={isSending === a.athleteId || isSendingAll}>
                                        {isSending === a.athleteId ? <Loader2 className="animate-spin h-4 w-4"/> : <Send className="h-4 w-4" />}
                                    </Button>
                                </TableCell>
                            </TableRow>
                            {isOpen && (
                                <TableRow className="bg-primary/5 border-none"><TableCell colSpan={5} className="p-6 border-none text-left">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in slide-in-from-top-2 duration-500 text-left">
                                        <div className="space-y-4 text-left">
                                            <h5 className="font-black text-[10px] uppercase tracking-widest text-primary flex items-center gap-2 text-left"><Sparkles className="h-3.5 w-3.5"/> Recipient Parameters</h5>
                                            <div className="space-y-2 text-xs font-bold uppercase text-left">
                                                <div className="flex justify-between border-b pb-1"><span>Category Rank</span><span className="text-primary">{a.categoryRank}{getOrdinal(a.categoryRank)} ({a.ageCategory})</span></div>
                                                <div className="flex justify-between border-b pb-1"><span>Gender Rank</span><span className="text-primary">{a.genderOverallRank?.rank}{getOrdinal(a.genderOverallRank?.rank || 0)}</span></div>
                                                <div className="flex justify-between border-b pb-1"><span>Affiliation</span><span className="text-primary">{a.clubName || 'Independent'}</span></div>
                                            </div>
                                        </div>
                                        <div className="space-y-4 text-left">
                                            <h5 className="font-black text-[10px] uppercase tracking-widest text-primary flex items-center gap-2 text-left"><History className="h-3.5 w-3.5"/> Points Manifest</h5>
                                            <div className="max-h-32 overflow-y-auto space-y-1 text-[10px] font-black uppercase text-left pr-2 custom-scrollbar">
                                                {a.races?.map((r, i) => (<div key={i} className="flex justify-between border-b border-primary/10 py-1.5 text-left"><span>{r.eventName || r.raceCategory}</span><span className="text-primary">{r.pointsAwarded} PTS</span></div>))}
                                            </div>
                                        </div>
                                    </div>
                                </TableCell></TableRow>
                            )}
                        </React.Fragment>
                    )})}
                </TableBody>
            </Table>
        </div>
    </div>
  );
}

function ClubRecap({ rankings, year, isLoading }: { rankings: ClubRankingEntry[], year: string, isLoading: boolean }) {
  const { toast } = useToast();
  const [isSending, setIsSending] = useState<string | null>(null);
  const [isSendingAll, setIsSendingAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleSendClubRecap = async (club: ClubRankingEntry) => {
    setIsSending(club.clubId);
    const result = await sendYearlyRecapEmailAction(club, parseInt(year, 10));
    if (result.success) toast({ title: 'Recap Delivered', description: `Sent to owner of ${club.clubName}` });
    else toast({ variant: 'destructive', title: 'Error', description: result.message });
    setIsSending(null);
  };

  const filteredClubs = useMemo(() => {
    if (!searchTerm) return rankings;
    const term = searchTerm.toLowerCase();
    return rankings.filter(club => club.clubName.toLowerCase().includes(term) || club.coachName?.toLowerCase().includes(term));
  }, [rankings, searchTerm]);

  const handleSendToAll = async () => {
    if(!confirm(`BROADCAST ALERT: You are about to send yearly recaps to all ${filteredClubs.length} clubs. Continue?`)) return;
    setIsSendingAll(true);
    let count = 0;
    for (const club of filteredClubs) {
        if (!club.email) continue;
        const result = await sendYearlyRecapEmailAction(club, parseInt(year, 10));
        if (result.success) count++;
    }
    toast({ title: 'Broadcast Finished', description: `Sent to ${count} club owners.` });
    setIsSendingAll(false);
  };

  return (
    <div className="space-y-6 text-left">
        <div className="flex flex-col sm:flex-row gap-4 items-center text-left">
            <div className="relative flex-grow w-full sm:w-auto text-left"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Filter club name or coach..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-11 rounded-xl border-muted font-bold text-sm"/></div>
            <Button onClick={handleSendToAll} disabled={isLoading || isSendingAll || filteredClubs.length === 0} className="rounded-xl h-11 px-8 font-black uppercase tracking-widest text-[10px] bg-primary shadow-xl shadow-primary/20">
                {isSendingAll ? <Loader2 className="animate-spin h-4 w-4 mr-2"/> : <Building className="h-4 w-4 mr-2"/>}
                Send All Club Summaries ({filteredClubs.length})
            </Button>
        </div>
        <div className="rounded-2xl border overflow-hidden text-left shadow-inner bg-card">
            <Table>
                <TableHeader className="bg-muted/30">
                    <TableRow className="h-12 text-[10px] font-black uppercase tracking-widest border-b">
                        <TableHead className="pl-6 text-left">Rank</TableHead>
                        <TableHead className="text-left">Club Identity</TableHead>
                        <TableHead className="text-center">Squad Size</TableHead>
                        <TableHead className="text-right">Total Points</TableHead>
                        <TableHead className="text-right pr-6">Action</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? <TableRow><TableCell colSpan={5} className="text-center p-12"><Loader2 className="animate-spin h-10 w-10 mx-auto text-primary" /></TableCell></TableRow> 
                    : filteredClubs.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic font-medium">No ranked clubs found for {year}.</TableCell></TableRow> 
                    : filteredClubs.map((c) => {
                        const isOpen = expandedId === c.clubId;
                        return (
                        <React.Fragment key={c.clubId}>
                            <TableRow className={cn("hover:bg-primary/5 transition-all cursor-pointer text-left h-16 group", isOpen && "bg-primary/5")} onClick={() => setExpandedId(isOpen ? null : c.clubId)}>
                                <TableCell className="pl-6 font-black italic text-primary text-lg">{c.overallRank || '—'}</TableCell>
                                <TableCell className="text-left">
                                    <div className="font-black text-sm uppercase leading-tight group-hover:text-primary transition-colors">{c.clubName}</div>
                                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Coach {c.coachName}</div>
                                </TableCell>
                                <TableCell className="text-center font-black text-slate-500 uppercase text-[10px]">{c.athleteCount} Athletes</TableCell>
                                <TableCell className="text-right font-black text-xl italic text-primary tracking-tighter pr-4">{c.totalPoints}</TableCell>
                                <TableCell className="text-right pr-6">
                                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full hover:bg-primary hover:text-white" onClick={(e) => { e.stopPropagation(); handleSendClubRecap(c); }} disabled={isSending === c.clubId || isSendingAll || !c.email}>
                                        {isSending === c.clubId ? <Loader2 className="animate-spin h-4 w-4"/> : <Send className="h-4 w-4" />}
                                    </Button>
                                </TableCell>
                            </TableRow>
                            {isOpen && (
                                <TableRow className="bg-primary/5 border-none"><TableCell colSpan={5} className="p-6 border-none text-left">
                                    <div className="space-y-4 text-left animate-in slide-in-from-top-2 duration-500">
                                        <h5 className="font-black text-[10px] uppercase tracking-widest text-primary flex items-center gap-2 text-left"><Star className="h-3.5 w-3.5"/> Top Squad Performers</h5>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-left">
                                            {c.contributingAthleteDetails?.slice(0, 6).map((ath, idx) => (
                                                <div key={idx} className="p-3 border rounded-xl bg-background flex justify-between items-center shadow-sm text-left">
                                                    <span className="text-[10px] font-black uppercase truncate leading-none">{ath.athleteName}</span>
                                                    <Badge variant="secondary" className="text-[9px] font-black h-4 px-1.5">{ath.pointsContributed} PTS</Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </TableCell></TableRow>
                            )}
                        </React.Fragment>
                    )})}
                </TableBody>
            </Table>
        </div>
    </div>
  );
}

export default function YearlyRecapTab() {
    const { toast } = useToast();
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState<string>(currentYear.toString());
    const [activeTab, setActiveTab] = useState('athlete');
    
    const [athleteRankings, setAthleteRankings] = useState<RankedAthlete[]>([]);
    const [clubRankings, setClubRankings] = useState<ClubRankingEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const availableYears = useMemo(() => {
        const years = [];
        for (let y = currentYear; y >= MIN_YEAR; y--) years.push(y.toString());
        return years;
    }, [currentYear]);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        const y = parseInt(selectedYear, 10);
        try {
            const [aRes, cRes] = await Promise.all([
                getAthleteRankingData({ year: y }),
                getClubRankingData({ year: y })
            ]);
            if (aRes.success) setAthleteRankings(aRes.rankings || []);
            if (cRes.success) setClubRankings(cRes.rankings || []);
        } catch (e: any) {
            toast({ variant: 'destructive', description: 'Failed to load session data.' });
        } finally {
            setIsLoading(false);
        }
    }, [selectedYear, toast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    return (
        <Card className="border-none shadow-xl text-left">
            <CardHeader className="bg-primary/5 pb-6 text-left border-b">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-left">
                    <div className="text-left">
                        <CardTitle className="flex items-center gap-2 text-2xl font-black uppercase italic tracking-tighter text-left">
                            <Award className="h-6 w-6 text-primary" />
                            Season Recap Studio
                        </CardTitle>
                        <CardDescription className="text-left font-medium">Generate and broadcast annual performance summaries to the community.</CardDescription>
                    </div>
                    <div className="flex items-center gap-3 bg-background p-1.5 rounded-xl border border-border/50 shadow-sm shrink-0 text-left">
                        <CalendarDays className="h-4 w-4 text-primary ml-2 shrink-0" />
                        <Select onValueChange={setSelectedYear} value={selectedYear} disabled={isLoading}>
                            <SelectTrigger className="w-[140px] border-none shadow-none font-bold text-sm h-9">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="text-left">
                                {availableYears.map(y => <SelectItem key={y} value={y}>{y} Season</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-10 pt-8 text-left">
                
                <StatsSummary rankings={athleteRankings} clubs={clubRankings} year={selectedYear} />

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full text-left">
                    <TabsList className="bg-muted/50 p-1 rounded-xl mb-8 border border-border/50">
                        <TabsTrigger value="athlete" className="flex-1 gap-2 font-bold uppercase text-[10px] tracking-widest h-9"><UserIcon className="h-4 w-4"/>Athlete Recaps</TabsTrigger>
                        <TabsTrigger value="club" className="flex-1 gap-2 font-bold uppercase text-[10px] tracking-widest h-9"><Trophy className="h-4 w-4"/>Club Recaps</TabsTrigger>
                    </TabsList>

                    <TabsContent value="athlete" className="animate-in slide-in-from-left-4 duration-500 text-left">
                        <AthleteRecap rankings={athleteRankings} year={selectedYear} isLoading={isLoading} />
                    </TabsContent>

                    <TabsContent value="club" className="animate-in slide-in-from-right-4 duration-500 text-left">
                        <ClubRecap rankings={clubRankings} year={selectedYear} isLoading={isLoading} />
                    </TabsContent>
                </Tabs>
            </CardContent>
            <CardFooter className="bg-muted/30 border-t py-4 text-left">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 text-left">
                    <Info className="h-3.5 w-3.5 text-primary"/>
                    Broadcasts utilize BergTechno dynamic templates. Test your layout before sending mass summaries.
                </p>
            </CardFooter>
        </Card>
    );
}
