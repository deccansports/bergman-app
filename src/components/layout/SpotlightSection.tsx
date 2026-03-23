// src/components/layout/SpotlightSection.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import Link from 'next/link';
import { ArrowRight, Trophy, Award, Users, Loader2, Building } from 'lucide-react';
import type { RankedAthlete, ClubRankingEntry, LegacyAthlete } from '@/lib/types';
import { getAthleteRankingData, getClubRankingData, getLegacyAthletesAction } from '@/lib/actions';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials, getCountryFlagEmoji, cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';


const SpotlightCard = ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <div className={cn("p-4 bg-background/50 rounded-lg border border-border shadow-md backdrop-blur-sm", className)}>
        {children}
    </div>
);

const AthleteSpotlightCard = ({ athlete, rank }: { athlete: RankedAthlete, rank: number }) => {
    const borderClass = 'border-primary/50 shadow-sm';
    
    return (
        <SpotlightCard className={cn("flex flex-col items-center text-center relative transition-transform hover:scale-105", borderClass)}>
            <span className="font-bold text-3xl text-accent mt-2 bg-background px-2 rounded-full border">{rank}</span>
            <Avatar className={cn("w-20 h-20 mt-2 border-4", borderClass)}>
                <AvatarImage src={athlete.photoURL || undefined} alt={athlete.name}/>
                <AvatarFallback className="text-xl bg-muted">{getInitials(athlete.name)}</AvatarFallback>
            </Avatar>
            <p className="mt-2 font-semibold text-foreground">{getCountryFlagEmoji(athlete.country)} {athlete.name}</p>
            <p className="text-xs text-muted-foreground">{athlete.clubName || 'Unaffiliated'}</p>
            <p className="mt-2 font-bold text-lg text-primary">{athlete.totalPoints} pts</p>
        </SpotlightCard>
    );
};

const ClubSpotlightCard = ({ club, rank }: { club: ClubRankingEntry, rank: number }) => {
    const isTop = rank === 1;
    const borderClass = isTop ? 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)]' : 'border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]';
    const badgeBg = isTop ? 'bg-amber-500 text-black' : 'bg-blue-500 text-white';
    
    return (
        <SpotlightCard className={cn("flex flex-col items-center text-center relative transition-transform hover:scale-105", borderClass)}>
            <div className={cn("absolute -top-3 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest z-10", badgeBg)}>
                {isTop ? 'Champions' : 'Top Squad'}
            </div>
            <span className="font-bold text-3xl text-accent mt-2 bg-background px-2 rounded-full border">{rank}</span>
            <Avatar className={cn("w-20 h-20 mt-2 border-4", borderClass)}>
                <AvatarImage src={club.logoUrl || undefined} alt={club.clubName}/>
                <AvatarFallback className="text-xl bg-muted"><Building /></AvatarFallback>
            </Avatar>
            <p className="mt-2 font-semibold text-foreground">{getCountryFlagEmoji(club.country)} {club.clubName}</p>
            <p className="text-xs text-muted-foreground">{club.coachName || 'Team Captain'}</p>
            <p className="mt-2 font-bold text-lg text-primary">{club.totalPoints} pts</p>
        </SpotlightCard>
    );
};

const LegacySpotlightCard = ({ athlete }: { athlete: LegacyAthlete }) => (
     <SpotlightCard className="flex flex-col items-center text-center">
        <Award className="h-10 w-10 text-yellow-400 fill-yellow-400 -mt-9 bg-background p-1.5 rounded-full border"/>
        <p className="mt-3 font-semibold text-foreground">{athlete.name}</p>
        <p className="text-xs text-muted-foreground">Legacy Athlete</p>
        <p className="mt-2 font-bold text-lg text-yellow-500">{athlete.achievementYears}</p>
    </SpotlightCard>
);


interface SpotlightSectionProps {
    initialTopAthletes: { male: RankedAthlete[]; female: RankedAthlete[] };
    initialTopClubs: ClubRankingEntry[];
    legacyAthletes: LegacyAthlete[];
}

export default function SpotlightSection({ initialTopAthletes, initialTopClubs, legacyAthletes: initialLegacyAthletes }: SpotlightSectionProps) {
  const currentYear = new Date().getFullYear();
  const { toast } = useToast();
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [topAthletes, setTopAthletes] = useState(initialTopAthletes);
  const [topClubs, setTopClubs] = useState(initialTopClubs);
  const [legacyAthletes, setLegacyAthletes] = useState(initialLegacyAthletes);
  const [isRankingLoading, setIsRankingLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('athletes');

  const availableYears = useMemo(() => {
    const years = [];
    for (let y = currentYear; y >= 2023; y--) {
        years.push(y.toString());
    }
    return years;
  }, [currentYear]);

  useEffect(() => {
    const isInitialYear = selectedYear === currentYear.toString();
    if (isInitialYear && initialTopAthletes.male.length > 0) {
      setTopAthletes(initialTopAthletes);
      setTopClubs(initialTopClubs);
      setLegacyAthletes(initialLegacyAthletes);
      return;
    }

    const fetchSpotlightData = async () => {
      setIsRankingLoading(true);
      const yearNum = parseInt(selectedYear, 10);
      
      try {
        const [athleteResult, clubResult, legacyResult] = await Promise.all([
            getAthleteRankingData({ year: yearNum }),
            getClubRankingData({ year: yearNum }),
            getLegacyAthletesAction({ year: yearNum })
        ]);
  
        if (athleteResult.success && athleteResult.rankings) {
            setTopAthletes({
                male: athleteResult.rankings.filter(a => a.gender === 'Male').slice(0, 3),
                female: athleteResult.rankings.filter(a => a.gender === 'Female').slice(0, 3)
            });
        } else {
            setTopAthletes({ male: [], female: [] });
        }
  
        if (clubResult.success && clubResult.rankings) {
            setTopClubs(clubResult.rankings.filter(c => c.overallRank).slice(0, 3));
        } else {
            setTopClubs([]);
        }

        if (legacyResult.success && legacyResult.legacyAthletes) {
            setLegacyAthletes(legacyResult.legacyAthletes);
        } else {
            setLegacyAthletes([]);
        }

      } catch (error) {
        setTopAthletes({ male: [], female: [] });
        setTopClubs([]);
        setLegacyAthletes([]);
      } finally {
        setIsRankingLoading(false);
      }
    };

    fetchSpotlightData();
  }, [selectedYear, currentYear, initialTopAthletes, initialTopClubs, initialLegacyAthletes]);

  const getLinkProps = () => {
    switch (activeTab) {
      case 'clubs': return { href: '/club-rankings', text: 'Club' };
      case 'legacy': return { href: '/athlete-rankings', text: 'Athlete' };
      case 'athletes': default: return { href: '/athlete-rankings', text: 'Athlete' };
    }
  };
  const linkProps = getLinkProps();
  
  return (
    <section className="w-full py-12 md:py-24 lg:py-32 bg-muted/40 text-left">
        <div className="container px-4 md:px-6">
              <div className="flex flex-col items-center justify-center space-y-4 text-center mb-12">
                  <div className="flex items-center gap-4">
                    <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl">Community Spotlight</h2>
                      <Select value={selectedYear} onValueChange={setSelectedYear}>
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="Year" />
                        </SelectTrigger>
                        <SelectContent>
                            {availableYears.map(year => (
                                <SelectItem key={year} value={year}>{year}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                  </div>
                  <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed text-center">
                      Celebrating our top-performing athletes, clubs, and enduring legends.
                  </p>
              </div>
              
              <Tabs defaultValue="athletes" className="w-full" onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-3 mb-8">
                      <TabsTrigger value="athletes"><Users className="mr-2 h-4 w-4"/>Top Athletes</TabsTrigger>
                      <TabsTrigger value="clubs"><Trophy className="mr-2 h-4 w-4"/>Top Clubs</TabsTrigger>
                      <TabsTrigger value="legacy"><Award className="mr-2 h-4 w-4"/>Legacy Athletes</TabsTrigger>
                  </TabsList>
                  
                  {isRankingLoading ? (
                    <div className="flex justify-center items-center h-64">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : (
                    <>
                      <TabsContent value="athletes" className="text-left">
                          <div className="text-left">
                              <h3 className="text-2xl font-bold text-center mb-6">Top Male Athletes</h3>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                  {topAthletes.male.map((athlete, i) => <AthleteSpotlightCard key={athlete.athleteId} athlete={athlete} rank={i + 1} />)}
                              </div>
                          </div>
                          <div className="mt-12 text-left">
                              <h3 className="text-2xl font-bold text-center mb-6">Top Female Athletes</h3>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                  {topAthletes.female.map((athlete, i) => <AthleteSpotlightCard key={athlete.athleteId} athlete={athlete} rank={i + 1} />)}
                              </div>
                          </div>
                      </TabsContent>
                      <TabsContent value="clubs" className="text-left">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                               {topClubs.map((club, i) => <ClubSpotlightCard key={club.clubId} club={club} rank={i + 1} />)}
                          </div>
                      </TabsContent>
                      <TabsContent value="legacy" className="text-left">
                           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                               {legacyAthletes.length > 0 ? legacyAthletes.map((athlete) => (
                                   <LegacySpotlightCard key={athlete.email} athlete={athlete} />
                               )) : (
                                   <div className="col-span-full text-center py-12 text-muted-foreground italic">
                                       No legacy athletes found for the {selectedYear} season.
                                   </div>
                               )}
                           </div>
                      </TabsContent>
                    </>
                  )}
              </Tabs>
              
               <div className="text-center mt-12">
                <Button asChild>
                  <Link href={linkProps.href}>
                    View Full {linkProps.text} Rankings
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
        </div>
    </section>
  );
}
