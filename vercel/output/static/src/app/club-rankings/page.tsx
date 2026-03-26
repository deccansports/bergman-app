// src/app/club-rankings/page.tsx
"use client";

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { getClubRankingData } from '@/lib/actions/clubActions';
import type { ClubRankingEntry, ClubAthleteContribution } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, CalendarDays, FilterX, Building, Instagram, Facebook, ChevronDown, Users, Star, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { AppHeader } from '@/components/layout/AppHeader';
import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from '@/components/ui/dialog';

const MIN_RANKING_YEAR_PUBLIC = 2023;

const clubPolicyContent = `
**1. Purpose of Club Rankings**
To encourage club-based participation, reward collective performance, and build a healthy, competitive ecosystem.

**2. Eligible Events for Club Rankings**
Only Triathlon events (Bergman 113, 102, Olympic) contribute to club points.

**3. Athlete–Club Affiliation Rules**
- An athlete must be officially affiliated with a club via their Athlete Dashboard.
- An athlete can only be affiliated with one club at a time.
- Club affiliation is governed by a **Club Affiliation Date**.

**4. Point Attribution Policy**
- Race points are attributed to a club only if the athlete’s club affiliation date is on or before the race completion date.
- **No points are assigned retroactively.** If an athlete joins a club after a race, points from that race will not count.

**5. Club Points Calculation**
- Club Points are the sum of points earned by all eligible affiliated athletes.
- **Best-Result Rule:** To maintain fairness, only an athlete's best 2 results per season count toward club rankings.

**6. Tie-Breaker Rules**
If clubs have equal points, ranks are decided by:
1. Higher number of podium finishes (Top 3).
2. Higher number of event winners.
3. Higher number of participating athletes.

**7. Fair Play & Adjustments**
The Bergman Race Committee reserves the right to adjust points in cases of modified race formats or rule violations to preserve fairness and integrity.
`;


const countryNameToCode: { [key: string]: string } = {
    'India': 'IN', 'United States': 'US', 'USA / Canada': 'US', 'United Kingdom': 'GB', 'Canada': 'CA',
    'Australia': 'AU', 'Germany': 'DE', 'France': 'FR', 'Singapore': 'SG', 'United Arab Emirates': 'AE',
    'Afghanistan': 'AF', 'Brazil': 'BR', 'China': 'CN', 'Egypt': 'EG', 'Japan': 'JP',
    'Mexico': 'MX', 'Nigeria': 'NG', 'Russia': 'RU', 'South Africa': 'ZA', 'Other': 'XX'
};

const getCountryFlagEmoji = (countryName?: string | null): string => {
    if (!countryName) return '';
    const countryCode = countryNameToCode[countryName];
    if (!countryCode || countryCode === 'XX') return '';
    return String.fromCodePoint(...Array.from(countryCode.toUpperCase()).map(c => 0x1F1A5 + c.charCodeAt(0)));
};

function ClubRankingsDisplay() {
  const [allRankings, setAllRankings] = useState<ClubRankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openAccordionItem, setOpenAccordionItem] = useState<string | null>(null);

  const currentActualYear = new Date().getFullYear();

  const [selectedYear, setSelectedYear] = useState<string>(() => {
    const defaultInitialYear = (currentActualYear < MIN_RANKING_YEAR_PUBLIC) ? MIN_RANKING_YEAR_PUBLIC : currentActualYear;
    return defaultInitialYear.toString();
  });

  const [rankingYearToDisplay, setRankingYearToDisplay] = useState<number>(parseInt(selectedYear, 10));
  const [searchTerm, setSearchTerm] = useState('');

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    const maxYear = currentActualYear;
    const startYear = Math.min(maxYear, Math.max(currentActualYear, MIN_RANKING_YEAR_PUBLIC));

    for (let y = startYear; y >= MIN_RANKING_YEAR_PUBLIC; y--) {
      years.add(y.toString());
    }
    if (MIN_RANKING_YEAR_PUBLIC <= currentActualYear) {
        years.add(currentActualYear.toString());
    }
    years.add(MIN_RANKING_YEAR_PUBLIC.toString());
    
    let sortedYears = Array.from(years)
      .map(y => parseInt(y,10))
      .filter(yearNum => yearNum <= maxYear && yearNum >= MIN_RANKING_YEAR_PUBLIC)
      .sort((a,b) => b - a)
      .map(String);

    if (sortedYears.length === 0) { 
        sortedYears = [MIN_RANKING_YEAR_PUBLIC.toString()];
    }
    return Array.from(new Set(sortedYears)); 
  }, [currentActualYear]);


   useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    } else if (availableYears.length === 0 && selectedYear !== MIN_RANKING_YEAR_PUBLIC.toString()){
      setSelectedYear(MIN_RANKING_YEAR_PUBLIC.toString());
    }
  }, [availableYears, selectedYear]);


  useEffect(() => {
    async function fetchRankings() {
      setLoading(true);
      setError(null);
      const yearToFetch = parseInt(selectedYear, 10);
      try {
        const result = await getClubRankingData({ year: yearToFetch }); 
        if (result.success && result.rankings) {
          setAllRankings(result.rankings);
          setRankingYearToDisplay(result.rankingYear || yearToFetch);
        } else {
          const errorMessage = result.message || "Failed to load club rankings.";
          setError(errorMessage);
          setAllRankings([]);
          setRankingYearToDisplay(result.rankingYear || yearToFetch);
        }
      } catch (e: any) {
        const clientErrorMessage = e.message || "An unexpected error occurred while fetching rankings.";
        setError(clientErrorMessage);
        setAllRankings([]);
        setRankingYearToDisplay(yearToFetch);
      } finally {
        setLoading(false);
      }
    }
    if(selectedYear) {
        fetchRankings();
    }
  }, [selectedYear]);

  const filteredRankings = useMemo(() => {
    let currentRankings = allRankings
      .map((club, index) => ({
        ...club,
        overallRankCalculated: club.overallRankCalculated ?? index + 1,
      }));

    if (!searchTerm) {
      return currentRankings;
    }
    const lowerSearchTerm = searchTerm.toLowerCase();
    return currentRankings.filter(club =>
      club.clubName.toLowerCase().includes(lowerSearchTerm) ||
      (club.coachName && club.coachName.toLowerCase().includes(lowerSearchTerm))
    );
  }, [allRankings, searchTerm]);
  
  const top3Clubs = useMemo(() => filteredRankings.filter(c => c.overallRankCalculated <= 3).sort((a,b) => (a.overallRankCalculated || 4) - (b.overallRankCalculated || 4)), [filteredRankings]);
  const otherClubs = useMemo(() => filteredRankings.filter(c => c.overallRankCalculated > 3), [filteredRankings]);


  const handleToggleAccordion = (clubId: string) => {
    setOpenAccordionItem(prevOpenId => (prevOpenId === clubId ? null : clubId));
  };
  
  const ContributorDetails = ({ club }: { club: ClubRankingEntry }) => (
    <div className="p-4 bg-primary/5 border-t border-border">
      {(club.contributingAthleteDetails && club.contributingAthleteDetails.length > 0) ? (
        <>
          <h4 className="text-sm font-semibold mb-2 text-primary flex items-center gap-1.5"><Users className="h-4 w-4"/>Top Contributing Athletes (max 5 shown):</h4>
          <div className="overflow-x-auto rounded-md border bg-background shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Athlete</TableHead>
                  <TableHead className="text-xs text-right">Points Contributed</TableHead>
                  <TableHead className="text-xs text-right">Races Finished</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {club.contributingAthleteDetails.map(athlete => (
                  <TableRow key={athlete.athleteUid} className="text-xs">
                    <TableCell className="py-1.5 px-2">{athlete.athleteName}</TableCell>
                    <TableCell className="py-1.5 px-2 text-right font-medium text-accent">{athlete.pointsContributed}</TableCell>
                    <TableCell className="py-1.5 px-2 text-right">{athlete.racesFinished}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-2">No specific athlete contributions to display for this club in {rankingYearToDisplay}.</p>
      )}
    </div>
  );

  return (
    <main className="container mx-auto py-8 px-4 flex-grow">
        <Card className="shadow-xl rounded-xl overflow-hidden border-t-4 border-primary">
          <CardHeader className="bg-primary/5 text-center">
            <div className="flex justify-center items-center gap-3">
              <Trophy className="h-12 w-12 text-primary" />
              <div className="flex flex-col items-center">
                <CardTitle className="text-3xl font-bold text-primary">Club Rankings</CardTitle>
                <CardDescription className="text-lg text-muted-foreground">
                  {rankingYearToDisplay} Standings
                </CardDescription>
              </div>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="link" size="sm" className="mx-auto mt-2 text-xs h-auto p-1"><HelpCircle className="mr-1.5 h-3.5 w-3.5" /> How are rankings calculated?</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>Club Ranking Policy</DialogTitle>
                </DialogHeader>
                <div className="prose prose-sm max-w-none text-foreground whitespace-pre-line py-4">
                  {clubPolicyContent}
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button>Close</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-4 md:p-6">
            <div className="flex flex-col sm:flex-row gap-4 mb-6 items-center">
              <div className="w-full sm:w-auto sm:min-w-[180px]">
                <Select value={selectedYear} onValueChange={setSelectedYear} disabled={loading || availableYears.length === 0}>
                  <SelectTrigger className="w-full">
                    <CalendarDays className="mr-2 h-4 w-4 opacity-70" />
                    <SelectValue placeholder="Select Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableYears.length > 0 ? availableYears.map(year => (
                      <SelectItem key={year} value={year}>{year}</SelectItem>
                    )) : <SelectItem value={MIN_RANKING_YEAR_PUBLIC.toString()} disabled>No years available</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div className="relative w-full sm:flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search club name or coach..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-full"
                  aria-label="Search club name or coach"
                  disabled={loading}
                />
              </div>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="mt-4 text-muted-foreground">Loading Club Rankings for {selectedYear}...</p>
              </div>
            ) : error ? (
              <div className="text-center py-20 text-destructive">
                <p className="text-lg font-semibold">Error loading rankings:</p>
                <p className="text-sm">{error}</p>
              </div>
            ) : filteredRankings.length > 0 ? (
            <>
              {top3Clubs.length > 0 && !searchTerm && (
                <div className="mb-12">
                  <h3 className="text-2xl font-bold text-center mb-6 text-foreground">Top 3 Clubs - {rankingYearToDisplay}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                      {top3Clubs.map((club) => {
                        const rank = club.overallRankCalculated;
                        const isOpen = openAccordionItem === club.clubId;
                        return (
                          <div key={club.clubId}>
                              <Card 
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => handleToggleAccordion(club.clubId)}
                                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleToggleAccordion(club.clubId)}
                                  className={cn(
                                    "text-center transition-all duration-300 transform hover:-translate-y-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary relative overflow-hidden group/podium",
                                    rank === 1 && "bg-gradient-to-br from-yellow-300 via-amber-400 to-yellow-500 shadow-yellow-500/30 shadow-lg scale-105",
                                    rank === 2 && "bg-gradient-to-br from-gray-300 via-gray-400 to-gray-500 shadow-lg",
                                    rank === 3 && "bg-gradient-to-br from-amber-500 via-yellow-600 to-amber-700 shadow-lg"
                                  )}
                                  aria-expanded={isOpen}
                                  aria-controls={`club-details-${club.clubId}-podium`}
                              >
                                   <div className="absolute inset-0 bg-black/10 group-hover/podium:bg-black/20 transition-colors duration-300"></div>
                                   <CardHeader className="relative pt-6 pb-2 items-center text-white">
                                       <div className={cn("absolute -top-6 -right-6 w-20 h-20 rounded-full flex items-center justify-center font-extrabold text-5xl opacity-20",
                                           rank === 1 && "bg-yellow-500/50 text-yellow-900",
                                           rank === 2 && "bg-slate-500/50 text-slate-900",
                                           rank === 3 && "bg-amber-700/50 text-amber-900"
                                       )}>{rank}</div>
                                       <Avatar className="w-20 h-20 border-4 border-white/50 shadow-lg">
                                           <AvatarImage src={club.logoUrl || undefined} alt={`${club.clubName} logo`}/>
                                           <AvatarFallback className="bg-slate-700 text-slate-200 text-3xl">
                                             <Building />
                                           </AvatarFallback>
                                       </Avatar>
                                       <CardTitle className="text-xl mt-2 text-shadow-md">{getCountryFlagEmoji(club.country)} {club.clubName}</CardTitle>
                                       <CardDescription className="text-white/80">{club.coachName}</CardDescription>
                                   </CardHeader>
                                   <CardContent className="relative pb-4">
                                       <p className="text-4xl font-bold text-white text-shadow-lg">{club.totalPoints}</p>
                                       <p className="text-xs text-white/80 uppercase tracking-widest">Total Points</p>
                                   </CardContent>
                              </Card>
                              {isOpen && <ContributorDetails club={club} />}
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}
              
              {otherClubs.length > 0 && (
                <div className="rounded-lg border shadow-sm max-h-[70vh] overflow-y-auto mt-8">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0 z-10">
                      <TableRow className="hover:bg-muted/80">
                        <TableHead className="w-[70px] text-center font-semibold text-foreground">Rank</TableHead>
                        <TableHead className="w-[70px] text-center font-semibold text-foreground">Logo</TableHead>
                        <TableHead className="font-semibold text-foreground min-w-[200px]">Club Name</TableHead>
                        <TableHead className="font-semibold text-foreground min-w-[150px]">Coach</TableHead>
                        <TableHead className="text-right font-semibold text-foreground">Total Points ({rankingYearToDisplay})</TableHead>
                        <TableHead className="text-right font-semibold text-foreground">Athletes</TableHead>
                        <TableHead className="text-right font-semibold text-foreground">Races</TableHead>
                        <TableHead className="text-center font-semibold text-foreground">Socials</TableHead>
                        <TableHead className="w-[50px] text-center font-semibold text-foreground">Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {otherClubs.map((club, index) => (
                        <React.Fragment key={club.clubId}>
                          <TableRow className={`even:bg-muted/20 hover:bg-primary/5 transition-colors ${openAccordionItem === club.clubId ? 'bg-primary/10' : ''}`}>
                            <TableCell className="font-bold text-lg text-center text-muted-foreground">{club.overallRankCalculated}</TableCell>
                            <TableCell className="p-2 text-center">
                              {club.logoUrl ? (
                                <Avatar className="h-10 w-10 inline-flex border">
                                  <AvatarImage src={club.logoUrl} alt={`${club.clubName} logo`}/>
                                  <AvatarFallback><Building /></AvatarFallback>
                                </Avatar>
                              ) : (
                                <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center text-muted-foreground inline-flex border"><Building className="h-5 w-5" /></div>
                              )}
                            </TableCell>
                            <TableCell><div className="font-semibold text-foreground flex items-center gap-2">{club.clubName}</div></TableCell>
                            <TableCell className="text-sm text-muted-foreground">{club.coachName || 'N/A'}</TableCell>
                            <TableCell className="text-right font-bold text-accent text-lg">{club.totalPoints}</TableCell>
                            <TableCell className="text-right">{club.contributingAthletes}</TableCell>
                            <TableCell className="text-right">{club.racesFinishedByMembers}</TableCell>
                            <TableCell className="text-center">
                              <div className="flex items-center justify-center gap-2">
                                {club.instagramUrl && <a href={club.instagramUrl} target="_blank" rel="noopener noreferrer" className="text-pink-600 hover:text-pink-700" title="Instagram"><Instagram size={18} /></a>}
                                {club.facebookUrl && <a href={club.facebookUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:text-blue-800" title="Facebook"><Facebook size={18} /></a>}
                                {(!club.instagramUrl && !club.facebookUrl) && <span className="text-xs text-muted-foreground">-</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <Button variant="ghost" size="sm" onClick={() => handleToggleAccordion(club.clubId)} className="p-1 hover:bg-muted rounded-md" aria-expanded={openAccordionItem === club.clubId} aria-controls={`club-details-${club.clubId}`}><ChevronDown className={`h-5 w-5 transition-transform duration-200 ${openAccordionItem === club.clubId ? 'rotate-180 text-primary' : 'text-muted-foreground'}`} /></Button>
                            </TableCell>
                          </TableRow>
                          {openAccordionItem === club.clubId && (
                            <TableRow id={`club-details-${club.clubId}`} className="bg-muted/10"><TableCell colSpan={9} className="p-0">
                                <ContributorDetails club={club} />
                            </TableCell></TableRow>
                          )}
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
            ) : (
              <div className="text-center py-20">
                <FilterX className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <p className="text-xl font-semibold text-muted-foreground">
                  {searchTerm ? 'No clubs match your search.' : `No club ranking data available for ${rankingYearToDisplay} yet.`}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {searchTerm ? 'Try a different search term.' : 'Clubs will appear here once they accumulate points for the selected year.'}
                </p>
              </div>
            )}
             <p className="text-center mt-6 text-sm text-muted-foreground">
              Points are only awarded to a club if the athlete was affiliated with the club on or before the race date. Points are not transferred if an athlete changes clubs after the race.
            </p>
          </CardContent>
        </Card>
      </main>
  )
}

// Full page component
export default function ClubRankingsPage() {
    return (
        <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col">
            <AppHeader />
            <Suspense fallback={
                <div className="flex flex-col items-center justify-center flex-grow">
                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    <p className="mt-2 text-muted-foreground">Loading Rankings...</p>
                </div>
            }>
                <ClubRankingsDisplay />
            </Suspense>
        </div>
    );
}
