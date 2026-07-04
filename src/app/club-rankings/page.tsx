// src/app/club-rankings/page.tsx
"use client";

import React, { useEffect, useState, useMemo, Suspense, useCallback } from 'react';
import { getClubRankingData, getClubContributorsAction } from '@/lib/actions/clubActions';
import type { ClubRankingEntry, ClubAthleteContribution } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, CalendarDays, FilterX, Building, Info, Trophy, ChevronDown, Instagram, Facebook, Mail, Users as UsersIcon, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { cn, getCountryFlagEmoji, isValidImageUrl, getOrdinal } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

const MIN_RANKING_YEAR_PUBLIC = 2023;

function ClubRankingsDisplay() {
  const [allRankings, setAllRankings] = useState<ClubRankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openAccordionItem, setOpenAccordionItem] = useState<string | null>(null);
  const [contributorsMap, setContributorsMap] = useState<Record<string, ClubAthleteContribution[]>>({});
  const [loadingContributors, setLoadingContributors] = useState<Record<string, boolean>>({});

  const currentActualYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<string>(currentActualYear.toString());
  const [rankingYearToDisplay, setRankingYearToDisplay] = useState<number>(currentActualYear);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<string>('all');

  const availableYears = useMemo(() => {
    const years = [];
    for (let y = currentActualYear; y >= MIN_RANKING_YEAR_PUBLIC; y--) years.push(y.toString());
    return Array.from(new Set(years)); 
  }, [currentActualYear]);

  const fetchRankings = useCallback(async (year: number) => {
    setLoading(true);
    setError(null);
    setContributorsMap({});
    setOpenAccordionItem(null);
    
    try {
      const result = await getClubRankingData({ year }); 
      if (result.success && result.rankings) {
        setAllRankings(result.rankings);
        setRankingYearToDisplay(result.rankingYear || year);
      } else {
        setError(result.message || "Failed to load club rankings.");
        setAllRankings([]);
      }
    } catch (e: any) {
      setError(e.message || "An unexpected error occurred.");
      setAllRankings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if(selectedYear) fetchRankings(parseInt(selectedYear, 10));
  }, [selectedYear, fetchRankings]);

  const filteredRankings = useMemo(() => {
    let list = selectedCountry === 'all' ? allRankings : allRankings.filter(club => club.country === selectedCountry);
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      list = list.filter(club => 
        club.clubName.toLowerCase().includes(lowerTerm) || 
        (club.coachName && club.coachName.toLowerCase().includes(lowerTerm)) ||
        (club.city && club.city.toLowerCase().includes(lowerTerm)) ||
        (club.state && club.state.toLowerCase().includes(lowerTerm))
      );
    }
    return list;
  }, [allRankings, searchTerm, selectedCountry]);
  
  const top3Clubs = useMemo(() => filteredRankings.filter(c => c.overallRank && c.overallRank <= 3).sort((a,b) => (a.overallRank || 4) - (b.overallRank || 4)), [filteredRankings]);
  const otherClubs = useMemo(() => filteredRankings.filter(c => !top3Clubs.some(topClub => topClub.clubId === c.clubId)), [filteredRankings, top3Clubs]);

  const handleToggleAccordion = async (clubId: string) => {
    if (openAccordionItem === clubId) {
        setOpenAccordionItem(null);
        return;
    }
    setOpenAccordionItem(clubId);
    if (contributorsMap[clubId]) return;

    setLoadingContributors(prev => ({ ...prev, [clubId]: true }));
    try {
        const result = await getClubContributorsAction(clubId, rankingYearToDisplay);
        if (result.success && result.contributors) {
            setContributorsMap(prev => ({ ...prev, [clubId]: result.contributors! }));
        }
    } finally {
        setLoadingContributors(prev => ({ ...prev, [clubId]: false }));
    }
  };
  
  const ContributorDetails = ({ club }: { club: ClubRankingEntry }) => {
    const clubContributors = contributorsMap[club.clubId];
    const isLoading = loadingContributors[club.clubId];

    return (
        <div className="p-6 bg-primary/5 border-t border-border animate-in slide-in-from-top-2 text-left">
            <h4 className="font-black uppercase tracking-widest text-xs mb-4 text-primary flex items-center gap-2 text-left">
                <UsersIcon className="h-4 w-4" /> All Contributing Athletes ({rankingYearToDisplay})
            </h4>
            {isLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8 text-primary"/></div>
            ) : (clubContributors && clubContributors.length > 0) ? (
                <div className="rounded-2xl border bg-background shadow-xl overflow-hidden text-left">
                    <ScrollArea className="h-64 w-full text-left">
                        <Table>
                        <TableHeader className="bg-muted/50 sticky top-0 z-10">
                            <TableRow>
                            <TableHead className="text-[10px] font-black uppercase tracking-widest text-left">Athlete</TableHead>
                            <TableHead className="text-[10px] font-black uppercase tracking-widest text-right">Points Contributed</TableHead>
                            <TableHead className="text-[10px] font-black uppercase tracking-widest text-right">Races Finished</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {clubContributors.map((athlete, idx) => (
                            <TableRow key={idx} className="hover:bg-muted/20 text-left">
                                <TableCell className="py-3 font-bold uppercase tracking-tight text-sm text-left">{athlete.athleteName}</TableCell>
                                <TableCell className="py-3 text-right font-black text-primary text-base italic">{athlete.pointsContributed}</TableCell>
                                <TableCell className="py-3 text-right font-mono font-bold text-slate-500">{athlete.racesFinished}</TableCell>
                            </TableRow>
                            ))}
                        </TableBody>
                        </Table>
                        <ScrollBar orientation="vertical" />
                    </ScrollArea>
                </div>
            ) : (
                <p className="text-sm font-medium text-muted-foreground text-center py-10 italic">No specific athlete contributions found for the {rankingYearToDisplay} season.</p>
            )}
        </div>
    );
  };

  return (
    <div className="container mx-auto py-8 px-4 text-center">
        <Card className="shadow-xl rounded-xl overflow-hidden border-t-4 border-primary">
          <CardHeader className="bg-primary/5 text-center">
            <div className="flex justify-center items-center gap-3">
              <Trophy className="h-12 w-12 text-primary" />
              <div className="flex flex-col items-center text-center">
                <CardTitle className="text-3xl font-black uppercase italic tracking-tighter text-primary text-center">Club Rankings {rankingYearToDisplay}</CardTitle>
                <CardDescription className="text-lg font-bold text-muted-foreground text-center">Global Season Standings</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 md:p-6 text-center">
            <div className="flex flex-col sm:flex-row gap-4 mb-8 items-center justify-center text-center">
              <Select value={selectedYear} onValueChange={setSelectedYear} disabled={loading}>
                <SelectTrigger className="w-full sm:w-[180px] h-11 rounded-xl font-bold"><CalendarDays className="mr-2 h-4 w-4 text-primary"/><SelectValue placeholder="Select Year"/></SelectTrigger>
                <SelectContent>{availableYears.map(year => (<SelectItem key={year} value={year}>{year} Season</SelectItem>))}</SelectContent>
              </Select>
              <div className="relative w-full sm:flex-1 text-center">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="Search club name, coach or location..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 w-full h-11 rounded-xl border-none bg-muted/30 font-bold" disabled={loading} />
              </div>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20"><Loader2 className="h-12 w-12 animate-spin text-primary"/><p className="mt-4 text-muted-foreground font-bold uppercase tracking-widest text-xs">Synchronizing standings...</p></div>
            ) : error ? (
              <div className="text-center py-20 text-destructive font-black uppercase text-sm tracking-widest">Error: {error}</div>
            ) : filteredRankings.length > 0 ? (
            <>
              {top3Clubs.length > 0 && !searchTerm && (
                <div className="mb-12 text-center">
                  <h3 className="text-2xl font-black uppercase italic tracking-tighter text-center mb-10 text-slate-400">Season Podium</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-end">
                      {top3Clubs.map((club) => {
                        const rank = club.overallRank!;
                        const isOpen = openAccordionItem === club.clubId;
                        const validLogo = isValidImageUrl(club.logoUrl) ? club.logoUrl : null;
                        const locationStr = [club.city, club.state].filter(Boolean).join(', ');

                        return (
                          <div key={club.clubId} className="flex flex-col text-left">
                              <Card 
                                role="button" 
                                tabIndex={0} 
                                onClick={() => handleToggleAccordion(club.clubId)} 
                                className={cn(
                                    "text-center transition-all duration-500 transform hover:-translate-y-2 cursor-pointer focus:outline-none ring-offset-2 relative overflow-hidden group/podium shadow-2xl rounded-3xl", 
                                    rank === 1 && "bg-gradient-to-br from-yellow-400 via-amber-500 to-yellow-600 ring-4 ring-yellow-400/30 scale-105", 
                                    rank === 2 && "bg-gradient-to-br from-slate-300 via-slate-400 to-slate-500", 
                                    rank === 3 && "bg-gradient-to-br from-amber-600 via-orange-700 to-amber-800"
                                )}
                              >
                                   <div className="absolute inset-0 bg-black/10 group-hover/podium:bg-black/20 transition-colors duration-300" />
                                   <CardHeader className="relative pt-8 pb-4 items-center text-white text-center">
                                       <div className={cn("absolute -top-6 -right-6 w-20 h-20 rounded-full flex items-center justify-center font-black text-5xl opacity-20", rank === 1 && "text-yellow-900", rank === 2 && "text-slate-900", rank === 3 && "text-amber-900")}>{rank}</div>
                                         <Avatar className="w-24 h-24 !rounded-2xl border-4 border-white/60 shadow-2xl bg-white/95">
                                           <AvatarImage src={validLogo || undefined} alt={club.clubName} className="object-contain p-3" />
                                           <AvatarFallback className="!rounded-2xl text-2xl bg-slate-100 text-slate-400"><Building /></AvatarFallback>
                                       </Avatar>
                                       <CardTitle className="text-xl mt-4 text-white font-black uppercase tracking-tight leading-tight group-hover:text-white transition-colors text-left">{getCountryFlagEmoji(club.country)} {club.clubName}</CardTitle>
                                       <CardDescription className="text-white/80 font-bold uppercase text-[10px] tracking-[0.2em] flex flex-col gap-1 items-center">
                                           <span>{club.coachName}</span>
                                           {locationStr && (
                                               <span className="flex items-center gap-1 opacity-70"><MapPin className="h-2.5 w-2.5"/> {locationStr}</span>
                                           )}
                                       </CardDescription>
                                   </CardHeader>
                                   <CardContent className="relative pb-8 space-y-4 text-left">
                                        <div className="text-center">
                                            <p className="text-5xl font-black text-white italic tracking-tighter drop-shadow-lg">{club.totalPoints}</p>
                                            <p className="text-[10px] font-black text-white/60 uppercase tracking-[0.3em] mt-1">Season Points</p>
                                        </div>
                                        <div className="flex justify-around text-white/90 pt-2">
                                            <div className="text-center"><p className="font-black text-lg leading-none">{club.athleteCount}</p><p className="text-[8px] uppercase font-bold tracking-widest mt-1 text-center">Squad</p></div>
                                            <div className="text-center"><p className="font-black text-lg leading-none">{club.eventCount}</p><p className="text-[8px] uppercase font-bold tracking-widest mt-1 text-center">Races</p></div>
                                        </div>
                                        
                                        <div className="flex items-center justify-center gap-4 pt-4 border-t border-white/10">
                                            {club.instagramUrl && <a href={club.instagramUrl} target="_blank" rel="noreferrer" className="text-white/70 hover:text-white transition-colors" onClick={(e) => e.stopPropagation()}><Instagram className="h-5 w-5"/></a>}
                                            {club.facebookUrl && <a href={club.facebookUrl} target="_blank" rel="noreferrer" className="text-white/70 hover:text-white transition-colors" onClick={(e) => e.stopPropagation()}><Facebook className="h-5 w-5"/></a>}
                                            {club.email && <a href={`mailto:${club.email}`} className="text-white/70 hover:text-white transition-colors" onClick={(e) => e.stopPropagation()}><Mail className="h-5 w-5"/></a>}
                                        </div>
                                   </CardContent>
                              </Card>
                              {isOpen && <ContributorDetails club={club} />}
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}
              
              <div className="rounded-2xl border shadow-xl max-h-[70vh] overflow-y-auto mt-8 bg-card text-left">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-[80px] text-center font-black uppercase text-[10px] tracking-widest">Rank</TableHead>
                      <TableHead className="w-[80px] text-center font-black uppercase text-[10px] tracking-widest text-left">Logo</TableHead>
                      <TableHead className="font-black uppercase tracking-tight text-sm text-foreground text-left">Club Identity</TableHead>
                      <TableHead className="font-black uppercase text-[10px] tracking-widest text-left">Location</TableHead>
                      <TableHead className="text-right font-black uppercase text-[10px] tracking-widest">Total Points</TableHead>
                      <TableHead className="text-right font-black uppercase text-[10px] tracking-widest">Athletes</TableHead>
                      <TableHead className="text-right font-black uppercase text-[10px] tracking-widest">Races</TableHead>
                      <TableHead className="font-black uppercase text-[10px] tracking-widest text-center">Socials</TableHead>
                      <TableHead className="w-[100px] text-right font-black uppercase text-[10px] tracking-widest pr-6">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {otherClubs.map((club) => {
                      const isOpen = openAccordionItem === club.clubId;
                      const validLogo = isValidImageUrl(club.logoUrl) ? club.logoUrl : null;
                      const locationStr = [club.city, club.state].filter(Boolean).join(', ');

                      return (
                        <React.Fragment key={club.clubId}>
                          <TableRow className={cn("hover:bg-primary/5 transition-colors cursor-pointer border-border/50 text-left", isOpen && "bg-primary/5")}>
                            <TableCell className="text-center">
                              {club.overallRank ? (
                                <span className="font-black text-lg italic text-slate-400">{club.overallRank}</span>
                              ) : (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="outline" className="cursor-help text-destructive border-destructive/30 uppercase font-black text-[9px] h-5 tracking-tighter">Unranked</Badge>
                                    </TooltipTrigger>
                                    <TooltipContent className="bg-slate-900 text-white border-slate-800 text-xs p-3 rounded-xl shadow-2xl text-left">
                                      <p className="flex items-center gap-2 text-left"><Info className="h-4 w-4 text-orange-500"/> Minimum 3 contributing athletes required for an official rank.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </TableCell>
                            <TableCell className="p-2 text-center">
                              <Avatar className="h-12 w-12 !rounded-xl border border-border/60 bg-white shadow-sm">
                                <AvatarImage src={validLogo || undefined} className="object-contain p-1.5" />
                                <AvatarFallback className="!rounded-xl text-xs bg-muted"><Building /></AvatarFallback>
                                </Avatar>
                            </TableCell>
                            <TableCell onClick={() => handleToggleAccordion(club.clubId)} className="text-left">
                                <div className="font-black uppercase tracking-tight text-sm text-foreground flex items-center gap-2 text-left">
                                    {getCountryFlagEmoji(club.country)} {club.clubName}
                                </div>
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5 text-left">{club.coachName || 'N/A'}</div>
                            </TableCell>
                            <TableCell className="text-left">
                                {locationStr ? (
                                    <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1.5 text-left">
                                        <MapPin className="h-3 w-3 text-primary" /> {locationStr}
                                    </span>
                                ) : <span className="text-slate-300 text-xs">—</span>}
                            </TableCell>
                            <TableCell className="text-right font-black text-primary text-xl italic tracking-tighter">{club.totalPoints}</TableCell>
                            <TableCell className="text-right font-bold text-slate-500">{club.athleteCount}</TableCell>
                            <TableCell className="text-right font-bold text-slate-500">{club.eventCount}</TableCell>
                            <TableCell>
                                <div className="flex items-center justify-center gap-3">
                                    {club.instagramUrl && <a href={club.instagramUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-pink-600 transition-colors" onClick={(e) => e.stopPropagation()}><Instagram className="h-4 w-4"/></a>}
                                    {club.facebookUrl && <a href={club.facebookUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-blue-600 transition-colors" onClick={(e) => e.stopPropagation()}><Facebook className="h-4 w-4"/></a>}
                                    {club.email && <a href={`mailto:${club.email}`} className="text-muted-foreground hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}><Mail className="h-4 w-4"/></a>}
                                    {!club.instagramUrl && !club.facebookUrl && !club.email && <span className="text-xs text-muted-foreground">—</span>}
                                </div>
                            </TableCell>
                            <TableCell className="text-right pr-6">
                                <Button variant="ghost" size="sm" onClick={() => handleToggleAccordion(club.clubId)} className="h-8 w-8 p-0 rounded-full hover:bg-primary/10 hover:text-primary transition-all">
                                    <ChevronDown className={cn("h-5 w-5 transition-transform duration-300", isOpen && "rotate-180")} />
                                </Button>
                            </TableCell>
                          </TableRow>
                          {isOpen && (<TableRow className="bg-muted/10 border-none"><TableCell colSpan={9} className="p-0"><ContributorDetails club={club} /></TableCell></TableRow>)}
                        </React.Fragment>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
            ) : (
              <div className="text-center py-24 text-muted-foreground flex flex-col items-center gap-4">
                  <FilterX className="h-16 w-16 opacity-20" />
                  <p className="text-xl font-black uppercase tracking-widest italic">No club data recorded for {selectedYear}.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
  )
}

export default function ClubRankingsPage() {
    return (
      <main className="text-left">
        <Suspense fallback={<div className="flex flex-col items-center justify-center flex-grow min-h-screen text-left"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
            <ClubRankingsDisplay />
        </Suspense>
      </main>
    );
}
