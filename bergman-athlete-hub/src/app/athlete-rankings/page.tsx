
"use client";

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { getAthleteRankingData, getLegacyAthletesAction } from '@/lib/actions/rankingActions';
import type { AthleteRankingEntry, RankedAthlete, LegacyAthlete } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, CalendarDays, FilterX, User as UserIconLucide, Users as UsersIcon, Filter, Building, Rocket, Trophy, Award, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import Image from 'next/image';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { getOrdinal } from '@/lib/utils';
import LegacyAthleteDisplayCard from '@/components/rankings/LegacyAthleteDisplayCard';
import { Skeleton } from '@/components/ui/skeleton';
import { AppHeader } from '@/components/layout/AppHeader';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

const MIN_ATHLETE_RANKING_YEAR = 2023;

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

const getInitials = (name?: string | null) => {
    if (!name) return '';
    const names = name?.split(' ') ?? [];
    if (names.length > 1) { return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase(); }
    return name?.substring(0, 2).toUpperCase() ?? '';
};


function AthleteRankingsDisplay() {
  const [allRankings, setAllRankings] = useState<AthleteRankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [legacyAthletes, setLegacyAthletes] = useState<LegacyAthlete[]>([]);
  const [loadingLegacy, setLoadingLegacy] = useState(true);
  const [errorLegacy, setErrorLegacy] = useState<string | null>(null);

  const currentActualYear = new Date().getFullYear();

  const [selectedYear, setSelectedYear] = useState<string>(() => {
    const defaultInitialYear = (currentActualYear < MIN_ATHLETE_RANKING_YEAR) ? MIN_ATHLETE_RANKING_YEAR : currentActualYear;
    return defaultInitialYear.toString();
  });

  const [rankingYearToDisplay, setRankingYearToDisplay] = useState<number>(parseInt(selectedYear, 10));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAgeCategory, setSelectedAgeCategory] = useState<string>('all');
  const [selectedGender, setSelectedGender] = useState<string>('all');

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    const maxYear = currentActualYear;
    const startYear = Math.min(maxYear, Math.max(currentActualYear, MIN_ATHLETE_RANKING_YEAR));

    for (let y = startYear; y >= MIN_ATHLETE_RANKING_YEAR; y--) {
      years.add(y.toString());
    }
    if (MIN_ATHLETE_RANKING_YEAR <= currentActualYear) {
        years.add(currentActualYear.toString());
    }
    years.add(MIN_ATHLETE_RANKING_YEAR.toString());

    let sortedYears = Array.from(new Set(years))
      .map(y => parseInt(y,10))
      .filter(yearNum => yearNum <= maxYear && yearNum >= MIN_ATHLETE_RANKING_YEAR)
      .sort((a,b) => b - a)
      .map(String);

    if (sortedYears.length === 0) {
        sortedYears = [MIN_ATHLETE_RANKING_YEAR.toString()];
    }
    return Array.from(new Set(sortedYears)); 
  }, [currentActualYear]);


  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    } else if (availableYears.length === 0 && selectedYear !== MIN_ATHLETE_RANKING_YEAR.toString()){
      setSelectedYear(MIN_ATHLETE_RANKING_YEAR.toString());
    }
  }, [availableYears, selectedYear]);


  useEffect(() => {
    async function fetchRankingsAndLegacy() {
      setLoading(true); setLoadingLegacy(true);
      setError(null); setErrorLegacy(null);
      const yearToFetch = parseInt(selectedYear, 10);

      const rankingsPromise = getAthleteRankingData({ year: yearToFetch })
        .then(result => {
          if (result.success && result.rankings) {
            setAllRankings(result.rankings);
            setRankingYearToDisplay(result.rankingYear || yearToFetch);
          } else {
            setError(result.message || "Failed to load athlete rankings.");
            setAllRankings([]); setRankingYearToDisplay(yearToFetch);
          }
        }).catch(e => {
          setError(e.message || "An unexpected error occurred.");
          setAllRankings([]); setRankingYearToDisplay(yearToFetch);
        }).finally(() => setLoading(false));

      const legacyPromise = getLegacyAthletesAction()
        .then(result => {
          if (result.success && result.legacyAthletes) {
            setLegacyAthletes(result.legacyAthletes);
          } else {
            setErrorLegacy(result.message || "Failed to load legacy athletes.");
            setLegacyAthletes([]);
          }
        }).catch(e => {
          setErrorLegacy(e.message || "An unexpected error occurred.");
          setLegacyAthletes([]);
        }).finally(() => setLoadingLegacy(false));

      await Promise.all([rankingsPromise, legacyPromise]);
    }
    if (selectedYear) fetchRankingsAndLegacy();
  }, [selectedYear]);

  const uniqueAgeCategories = useMemo(() => {
    const normalizeCategory = (cat: string | null | undefined): string => {
        return (cat || 'Unknown').replace(/\s/g, '');
    };
    if (!allRankings || allRankings.length === 0) return ['all'];
    const categories = new Set<string>();
    allRankings.forEach(ranking => {
        const normalizedCategory = normalizeCategory(ranking.ageCategory);
        if (normalizedCategory !== 'Unknown') {
            categories.add(normalizedCategory);
        }
    });

    const getFirstNumber = (s: string) => {
        if (!s) return 999;
        if (s.toLowerCase().includes('above')) {
            return parseInt(s.replace(/[^0-9]/g, ''), 10) || 999;
        }
        const match = s.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 999;
    };

    const sortedCategories = Array.from(categories).sort((a, b) => {
        const numA = getFirstNumber(a);
        const numB = getFirstNumber(b);
        return numA - numB;
    });
    
    return ['all', ...sortedCategories];
  }, [allRankings]);

  const uniqueGenders = useMemo(() => {
    if (!allRankings || allRankings.length === 0) return ['all'];
    const genders = new Set<string>();
    allRankings.forEach(ranking => {
      if (ranking.gender && typeof ranking.gender === 'string' && ranking.gender.trim() !== '') {
        const normalizedGender = ranking.gender.trim().charAt(0).toUpperCase() + ranking.gender.trim().slice(1).toLowerCase();
        if (normalizedGender === 'Male' || normalizedGender === 'Female') {
            genders.add(normalizedGender);
        }
      }
    });
    return ['all', ...Array.from(genders).sort()];
  }, [allRankings]);

  const overallRankedAthletes = useMemo((): RankedAthlete[] => {
    return [...allRankings].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0) || a.name.localeCompare(b.name)).map((athlete, index) => ({ ...athlete, overallRankCalculated: index + 1 }));
  }, [allRankings]);
  
  const top3Male = useMemo(() => overallRankedAthletes.filter(a => a.gender === 'Male').slice(0, 3), [overallRankedAthletes]);
  const top3Female = useMemo(() => overallRankedAthletes.filter(a => a.gender === 'Female').slice(0, 3), [overallRankedAthletes]);

  const isAnyFilterActive = useMemo(() => searchTerm || selectedAgeCategory !== 'all' || selectedGender !== 'all', [searchTerm, selectedAgeCategory, selectedGender]);
  const showPodium = !isAnyFilterActive;

  const groupedAndFilteredRankings = useMemo(() => {
    const normalizeAgeCategory = (cat: string | null | undefined): string => {
        if (!cat) return 'UnknownCategory';
        return cat.replace(/\s/g, '');
    };
    const normalizeGender = (gender: string | null | undefined): 'Male' | 'Female' | 'Other' => {
        const g = (gender || 'Other').trim().toLowerCase();
        if (g === 'male') return 'Male';
        if (g === 'female') return 'Female';
        return 'Other';
    };

    let athletesToProcess = overallRankedAthletes.map(athlete => ({
      ...athlete,
      normalizedAgeCategory: normalizeAgeCategory(athlete.ageCategory),
      normalizedGender: normalizeGender(athlete.gender),
    }));

    if (selectedGender !== 'all') {
      athletesToProcess = athletesToProcess.filter(athlete => athlete.normalizedGender === selectedGender);
    }
    if (searchTerm) {
      athletesToProcess = athletesToProcess.filter(athlete =>
        athlete.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (athlete.clubName && athlete.clubName.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }
    if (selectedAgeCategory !== 'all') {
      athletesToProcess = athletesToProcess.filter(athlete => athlete.normalizedAgeCategory === selectedAgeCategory);
    }

    if (isAnyFilterActive) {
      return { 'Search Results': athletesToProcess.sort((a, b) => (a.overallRankCalculated || Infinity) - (b.overallRankCalculated || Infinity)) };
    }

    const grouped: Record<string, RankedAthlete[]> = {};
    athletesToProcess.forEach(athlete => {
      if (athlete.normalizedGender === 'Other' || athlete.normalizedAgeCategory === 'UnknownCategory') return;
      const groupKey = `${athlete.normalizedAgeCategory} ${athlete.normalizedGender}`;
      if (!grouped[groupKey]) grouped[groupKey] = [];
      grouped[groupKey].push(athlete);
    });
    
    for (const group in grouped) {
      grouped[group].sort((a, b) => (a.categoryRank || Infinity) - (b.categoryRank || Infinity));
      grouped[group] = grouped[group].slice(0, 5);
    }
    
    const getFirstNumber = (s: string) => {
        if (!s) return 999;
        if (s.toLowerCase().includes('above')) {
            return parseInt(s.replace(/[^0-9]/g, ''), 10) || 999;
        }
        const match = s.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 999;
    };

    const sortedGroupKeys = Object.keys(grouped).sort((a, b) => {
        const [ageA, genderA] = a.split(' ');
        const [ageB, genderB] = b.split(' ');
        const numA = getFirstNumber(ageA);
        const numB = getFirstNumber(ageB);
        if (numA !== numB) return numA - numB;

        const genderOrder = { 'Male': 1, 'Female': 2 };
        const orderA = genderOrder[genderA as 'Male' | 'Female'] || 99;
        const orderB = genderOrder[genderB as 'Male' | 'Female'] || 99;
        return orderA - orderB;
    });

    const sortedGrouped: Record<string, RankedAthlete[]> = {};
    sortedGroupKeys.forEach(key => {
        sortedGrouped[key] = grouped[key];
    });

    return sortedGrouped;
  }, [overallRankedAthletes, searchTerm, selectedAgeCategory, selectedGender, isAnyFilterActive]);


  const PodiumCard = ({ athlete, rank }: { athlete: RankedAthlete; rank: number }) => (
    <Card className={cn(
      "text-center transition-all duration-300 transform hover:-translate-y-2 relative overflow-hidden group/podium",
      rank === 1 && "bg-gradient-to-br from-yellow-300 via-amber-400 to-yellow-500 shadow-yellow-500/30 shadow-lg scale-105",
      rank === 2 && "bg-gradient-to-br from-slate-300 via-slate-400 to-slate-500 shadow-lg",
      rank === 3 && "bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 shadow-lg"
    )}>
       <div className="absolute inset-0 bg-black/10 group-hover/podium:bg-black/20 transition-colors duration-300"></div>
       <CardHeader className="relative pt-6 pb-2 items-center text-white">
            <div className={cn("absolute -top-6 -right-6 w-20 h-20 rounded-full flex items-center justify-center font-extrabold text-5xl opacity-20",
              rank === 1 && "bg-yellow-500/50 text-yellow-900",
              rank === 2 && "bg-slate-500/50 text-slate-900",
              rank === 3 && "bg-amber-700/50 text-amber-900"
            )}>{rank}</div>
            <Avatar className="w-24 h-24 border-4 border-white/50 shadow-lg">
                <AvatarImage src={(athlete as any).photoURL} alt={athlete.name}/>
                <AvatarFallback className="bg-slate-700 text-slate-200 text-3xl">{getInitials(athlete.name)}</AvatarFallback>
            </Avatar>
            <CardTitle className="text-xl mt-2 text-shadow-md">{getCountryFlagEmoji(athlete.country)} {athlete.name}</CardTitle>
            <CardDescription className="text-white/80">{athlete.clubName || 'Unaffiliated'}</CardDescription>
        </CardHeader>
        <CardContent className="relative pb-4">
            <p className="text-4xl font-bold text-white text-shadow-lg">{athlete.totalPoints}</p>
            <p className="text-xs text-white/80 uppercase tracking-widest">Total Points</p>
        </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col">
       <AppHeader />
      <main className="container mx-auto py-8 px-4 flex-grow">
        {loadingLegacy ? <Skeleton className="h-64 w-full rounded-xl mb-8" /> : errorLegacy ? ( <Card className="mb-8 border-destructive bg-destructive/10"><CardHeader><CardTitle className="text-destructive flex items-center gap-2"><Trophy className="h-6 w-6"/> Legacy Athlete Status</CardTitle></CardHeader><CardContent><p className="text-sm text-destructive-foreground">Error loading legacy athlete data: {errorLegacy}</p></CardContent></Card> ) : legacyAthletes.length > 0 ? ( <LegacyAthleteDisplayCard legacyAthletes={legacyAthletes} /> ) : ( <Card className="mb-8 border-primary/30 bg-primary/5"><CardHeader><CardTitle className="text-primary flex items-center gap-2"><Trophy className="h-6 w-6"/> Bergman Legacy Athletes</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">No athletes currently meet the Legacy criteria (3 finishes over 3 consecutive years). Keep racing to achieve this honor!</p></CardContent></Card> )}
        
        <Card className="shadow-xl rounded-xl overflow-hidden border-t-4 border-accent">
          <CardHeader className="bg-accent/5 text-center py-6">
            <UsersIcon className="h-12 w-12 text-accent mx-auto mb-3" />
            <CardTitle className="text-3xl font-bold text-accent">Athlete Rankings - India</CardTitle>
            <CardDescription className="text-lg text-muted-foreground mt-1">Displaying rankings for {rankingYearToDisplay}</CardDescription>
          </CardHeader>
          <CardContent className="p-4 md:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 items-center">
              <div className="w-full"><Select value={selectedYear} onValueChange={setSelectedYear} disabled={loading || availableYears.length === 0}><SelectTrigger className="w-full"><CalendarDays className="mr-2 h-4 w-4 opacity-70" /><SelectValue placeholder="Select Year" /></SelectTrigger><SelectContent>{availableYears.length > 0 ? availableYears.map(year => (<SelectItem key={year} value={year}>{year}</SelectItem>)): <SelectItem value={MIN_ATHLETE_RANKING_YEAR.toString()} disabled>No years available</SelectItem>}</SelectContent></Select></div>
              <div className="w-full"><Select value={selectedGender} onValueChange={setSelectedGender} disabled={loading || uniqueGenders.length <= 1}><SelectTrigger className="w-full"><Filter className="mr-2 h-4 w-4 opacity-70" /><SelectValue placeholder="Gender" /></SelectTrigger><SelectContent>{uniqueGenders.map(gender => (<SelectItem key={gender} value={gender}>{gender === 'all' ? 'All Genders' : gender}</SelectItem>))}</SelectContent></Select></div>
              <div className="w-full"><Select value={selectedAgeCategory} onValueChange={setSelectedAgeCategory} disabled={loading || uniqueAgeCategories.length <= 1}><SelectTrigger className="w-full"><Filter className="mr-2 h-4 w-4 opacity-70" /><SelectValue placeholder="Age Category" /></SelectTrigger><SelectContent>{uniqueAgeCategories.map(category => (<SelectItem key={category} value={category}>{category === 'all' ? 'All Age Categories' : category}</SelectItem>))}</SelectContent></Select></div>
              <div className="relative w-full"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" /><Input type="search" placeholder="Search athlete or club..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 w-full" aria-label="Search athlete name or club" disabled={loading} /></div>
            </div>

            {loading ? <div className="flex flex-col items-center justify-center py-20"><Loader2 className="h-12 w-12 animate-spin text-accent" /><p className="mt-4 text-muted-foreground">Loading Athlete Rankings for {selectedYear}...</p></div>
            : error ? <div className="text-center py-20 text-destructive"><p className="text-lg font-semibold">Error loading rankings:</p><p className="text-sm">{error}</p></div>
            : (
              <div className="space-y-8">
                {showPodium && (top3Male.length > 0 || top3Female.length > 0) && (
                  <div className="space-y-10">
                    <div className="text-center">
                      <h3 className="text-2xl font-bold text-foreground">Top Bergman Athletes {rankingYearToDisplay}</h3>
                      <p className="text-muted-foreground italic">&quot;The body achieves what the mind believes.&quot;</p>
                    </div>
                    {top3Male.length > 0 && (
                        <>
                        <h4 className="text-xl font-bold text-center text-foreground -mb-6">Top Male</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                          {top3Male.map((athlete, i) => <PodiumCard key={`male-podium-${i}`} athlete={athlete} rank={i+1}/>)}
                        </div>
                        </>
                    )}
                    {top3Female.length > 0 && (
                        <>
                        <h4 className="text-xl font-bold text-center text-foreground -mb-6 mt-12">Top Female</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end mt-10">
                          {top3Female.map((athlete, i) => <PodiumCard key={`female-podium-${i}`} athlete={athlete} rank={i+1}/>)}
                        </div>
                        </>
                    )}
                  </div>
                )}
                {Object.keys(groupedAndFilteredRankings).length > 0 ? (
                  Object.entries(groupedAndFilteredRankings).map(([groupKey, athletes]) => (
                    <Card key={groupKey} className="rounded-lg border shadow-sm">
                      <CardHeader className="bg-muted/30"><CardTitle className="text-xl font-semibold text-primary">{groupKey}</CardTitle><CardDescription>Rankings for {rankingYearToDisplay}{selectedGender !== 'all' && ` (Gender: ${selectedGender})`}{searchTerm && `, searching for "${searchTerm}"`}.</CardDescription></CardHeader>
                      <CardContent className="p-0"><div className="overflow-x-auto"><Table>
                            <TableHeader><TableRow><TableHead className="w-[100px] text-center font-semibold text-foreground">Overall Rank</TableHead><TableHead className="w-[100px] text-center font-semibold text-foreground">Rank in Cat.</TableHead><TableHead className="font-semibold text-foreground min-w-[200px]">Athlete Name</TableHead><TableHead className="font-semibold text-foreground">Gender</TableHead><TableHead className="font-semibold text-foreground">Affiliated Club</TableHead><TableHead className="text-right font-semibold text-foreground">Total Points</TableHead><TableHead className="text-right font-semibold text-foreground">Races</TableHead></TableRow></TableHeader>
                            <TableBody>
                              {athletes.map((athlete) => (<TableRow key={athlete.athleteId} className="hover:bg-accent/5">
                                    <TableCell className="font-medium text-center text-foreground">{athlete.overallRankCalculated || 'N/A'}</TableCell>
                                    <TableCell className="font-medium text-center text-foreground">{athlete.categoryRank && athlete.totalInCategory ? `${athlete.categoryRank}${getOrdinal(athlete.categoryRank)} / ${athlete.totalInCategory}` : (athlete.categoryRank ? `${athlete.categoryRank}${getOrdinal(athlete.categoryRank)}` : 'N/A')}</TableCell>
                                    <TableCell className="font-semibold text-primary">
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-8 w-8">
                                                <AvatarImage src={(athlete as any).photoURL} alt={athlete.name}/>
                                                <AvatarFallback>{getInitials(athlete.name)}</AvatarFallback>
                                            </Avatar>
                                            <span className="mr-1">{getCountryFlagEmoji(athlete.country)}</span>{athlete.name}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{athlete.gender || 'N/A'}</TableCell>
                                     <TableCell className="text-muted-foreground">{athlete.clubName ? (<div className="flex items-center gap-1.5"><Building className="h-3.5 w-3.5 text-muted-foreground/70"/>{athlete.clubName}</div>) : <span className="text-xs">N/A</span>}</TableCell>
                                    <TableCell className="text-right font-bold text-accent">{athlete.totalPoints}</TableCell>
                                    <TableCell className="text-right text-muted-foreground">{athlete.racesFinished}</TableCell>
                                  </TableRow>)
                               )}
                            </TableBody>
                          </Table></div></CardContent>
                    </Card>
                  ))
                ) : (
                  <Card className="my-6 bg-primary/5 border-primary/20 shadow-md"><CardContent className="p-8 text-center"><FilterX className="h-16 w-16 text-primary mx-auto mb-4 opacity-70" /><p className="text-xl font-semibold text-primary mb-2">No athletes match your current filters.</p><p className="text-muted-foreground mb-4">Try different search terms or broaden your filters to see results.</p><Button asChild variant="default" className="bg-accent hover:bg-accent/90 text-accent-foreground"><Link href="https://www.bergmantri.com" target="_blank" rel="noopener noreferrer"><Rocket className="mr-2 h-5 w-5" /> Register for a Race</Link></Button></CardContent></Card>
                )}
              </div>
            )}
             <p className="text-center mt-6 text-sm text-muted-foreground">Overall Rank is based on total points among all athletes for the selected Year. Rank in Category is within the specific Age Group for that gender. Club affiliation shown is based on current records and might not reflect affiliation at the time of past races.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function FullPageLoader() {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="mt-2 text-muted-foreground">Loading Rankings...</p>
        </div>
    )
}

export default function AthleteRankingsPageContainer() {
    return (
        <Suspense fallback={<FullPageLoader />}>
            <AthleteRankingsDisplay />
        </Suspense>
    )
}
    


  