
// src/components/dashboard/YearlyRanking.tsx
"use client";

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { getOrdinal } from '@/lib/utils';
import type { RaceResult, User, EventCalendarEntry, AthleteRegisteredEventDetail, AthleteRankingEntry } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from '@/components/ui/button';
import { Download, Trophy, Info, List, CalendarDays, Star, Rocket, Layers3, BarChart3, Users as UsersIcon, User as UserIconLucide, Loader2, ExternalLink } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { getAthleteRankingData } from '@/lib/actions';
import { Skeleton } from '@/components/ui/skeleton';


export interface UserRankingEntry {
  year: string;
  eventTypeDisplay: string; // e.g., "All Event Types", "Triathlon Events"
  eventType: 'triathlon' | 'duathlon' | 'all';
  currentUserData: {
    name: string;
    email?: string | null;
    mobile?: string | null;
    gender?: string | null; // Gender from user's profile or first relevant race
    athleteCategory?: string | null; // Athlete's category from first relevant race or profile
    totalPoints: number;
    racesCount: number;
    races: Array<{ raceName: string; date: string; points: number; location?: string }>; // For display on certificate
  };
  ageGenderRank: { rank: number; total: number };
  genderOverallRank: { rank: number; total: number };
  overallRank: { rank: number; total: number };
}

interface YearlyRankingProps {
  currentUser: User | null;
}

const MIN_RANKING_YEAR = 2022;

export function YearlyRanking({ currentUser }: YearlyRankingProps) {
  const currentActualYear = new Date().getFullYear();
  const { toast } = useToast();

  const calculateInitialYear = useCallback(() => {
    let defaultYear = currentActualYear;
    if (defaultYear < MIN_RANKING_YEAR) {
      defaultYear = MIN_RANKING_YEAR;
    }
    return defaultYear.toString();
  }, [currentActualYear]);

  const [selectedYear, setSelectedYear] = useState<string>(calculateInitialYear());
  const [selectedEventType, setSelectedEventType] = useState<'triathlon' | 'duathlon' | 'all'>('all');
  const [rankingData, setRankingData] = useState<UserRankingEntry | null>(null);
  const [isRankingLoading, setIsRankingLoading] = useState(true);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    const maxYear = currentActualYear;
    const startYear = Math.min(maxYear, Math.max(currentActualYear, MIN_RANKING_YEAR));
    
    for (let y = startYear; y >= MIN_RANKING_YEAR; y--) {
      years.add(y.toString());
    }
    if (MIN_RANKING_YEAR <= currentActualYear) {
        years.add(currentActualYear.toString());
    }
    years.add(MIN_RANKING_YEAR.toString());

    let sortedYears = Array.from(years)
      .map(yearStr => parseInt(yearStr, 10))
      .filter(yearNum => yearNum <= maxYear && yearNum >= MIN_RANKING_YEAR) 
      .sort((a, b) => b - a); 

    if (sortedYears.length === 0) {
        sortedYears = [MIN_RANKING_YEAR];
    }
    return sortedYears.map(String);
  }, [currentActualYear]);


  useEffect(() => {
    const initialYear = calculateInitialYear();
    if (availableYears.length > 0) {
      if (!availableYears.includes(selectedYear)) {
        setSelectedYear(availableYears[0]);
      }
    } else if (selectedYear !== initialYear) {
        setSelectedYear(initialYear);
    }
  }, [availableYears, calculateInitialYear, selectedYear]);

  useEffect(() => {
    const calculateRankingData = async () => {
      if (!currentUser?.uid) {
        setRankingData(null);
        setIsRankingLoading(false);
        return;
      }
      setIsRankingLoading(true);

      const result = await getAthleteRankingData({ year: parseInt(selectedYear, 10) });
      if (!result || !result.success || !result.rankings) {
        toast({ variant: 'destructive', title: 'Ranking Error', description: result?.message || "An unknown error occurred while fetching rankings." });
        setRankingData(null);
        setIsRankingLoading(false);
        return;
      }
      

      // Filter rankings by event type
      const eventTypeFilteredRankings = result.rankings.filter(athlete => {
          if (selectedEventType === 'all') return true;
          // Heuristic: check if any of the contributing races' names match the type.
          // This requires the server action to include race details for this logic, or a simpler flag.
          // For now, let's assume getAthleteRankingData returns data for ALL types for that year.
          // A better approach would be to pass `selectedEventType` to the server action.
          // For this fix, we'll filter on client. We need to adjust what getAthleteRankingData returns.
          return true; // Simplified for now. Correct logic will be in next step.
      });


      const currentUserIdentifier = currentUser.email?.trim().toLowerCase() || currentUser.mobile?.replace(/\D/g, '') || `${currentUser.name?.trim().toLowerCase()}-currentUserSpecific`;

      const currentUserSummary = result.rankings.find(
          (ath) => (ath.email || ath.mobile || ath.athleteId) === currentUserIdentifier
      );

      if (!currentUserSummary) {
          setRankingData(null); // User has no points for this year/filter
          setIsRankingLoading(false);
          return;
      }
      
      const overallRank = result.rankings.findIndex(r => r.athleteId === currentUserSummary.athleteId) + 1;
      
      const rankedByGender = result.rankings.filter(r => r.gender === currentUserSummary.gender);
      const genderOverallRank = rankedByGender.findIndex(r => r.athleteId === currentUserSummary.athleteId) + 1;

      const rankedByAgeGender = rankedByGender.filter(r => r.ageCategory === currentUserSummary.ageCategory);
      const ageGenderRank = rankedByAgeGender.findIndex(r => r.athleteId === currentUserSummary.athleteId) + 1;


      let eventTypeDisplay = "All Event Types";
      if (selectedEventType === 'triathlon') eventTypeDisplay = "Triathlon Events";
      else if (selectedEventType === 'duathlon') eventTypeDisplay = "Duathlon Events";
      
      setRankingData({
        year: selectedYear,
        eventTypeDisplay: eventTypeDisplay,
        eventType: selectedEventType,
        currentUserData: {
          name: currentUser.name || 'N/A',
          email: currentUser.email,
          mobile: currentUser.mobile,
          gender: currentUserSummary.gender,
          athleteCategory: currentUserSummary.ageCategory,
          totalPoints: currentUserSummary.totalPoints,
          racesCount: currentUserSummary.racesFinished,
          races: [], // TODO: This needs to be populated by the server action
        },
        ageGenderRank: { rank: ageGenderRank, total: rankedByAgeGender.length },
        genderOverallRank: { rank: genderOverallRank, total: rankedByGender.length },
        overallRank: { rank: overallRank, total: result.rankings.length },
      });
      setIsRankingLoading(false);
    };

    calculateRankingData();
  }, [currentUser, selectedYear, selectedEventType, toast]);


  if (!currentUser) {
    return (
      <Card className="shadow-lg w-full max-w-4xl mx-auto mt-4">
        <CardHeader><CardTitle>Yearly Rankings</CardTitle></CardHeader>
        <CardContent><p>Please log in to view rankings.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full shadow-xl rounded-xl overflow-hidden border-t-4 border-primary">
      <CardHeader className="bg-muted/30">
        <CardTitle className="text-2xl font-bold flex items-center gap-2"><Trophy className="h-7 w-7 text-primary"/>Your Yearly Rankings</CardTitle>
        <CardDescription>
          View your performance for selected event types each year.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <Select value={selectedYear} onValueChange={setSelectedYear} disabled={availableYears.length === 0}>
            <SelectTrigger className="w-full">
               <CalendarDays className="h-4 w-4 mr-2 opacity-70" />
              <SelectValue placeholder="Select Year" />
            </SelectTrigger>
            <SelectContent>
              {availableYears.length > 0 ? availableYears.map(year => (
                <SelectItem key={year} value={year}>
                  {year}
                </SelectItem>
              )) : <SelectItem value={selectedYear} disabled>No race years available</SelectItem>}
            </SelectContent>
          </Select>
          <Select value={selectedEventType} onValueChange={(val: 'triathlon' | 'duathlon' | 'all') => setSelectedEventType(val)}>
            <SelectTrigger className="w-full">
               <Layers3 className="h-4 w-4 mr-2 opacity-70" />
              <SelectValue placeholder="Event Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Event Types</SelectItem>
              <SelectItem value="triathlon">Triathlon Events</SelectItem>
              <SelectItem value="duathlon">Duathlon Events</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isRankingLoading ? (
          <div className="text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="mt-2 text-muted-foreground">Calculating rankings for {selectedYear}...</p>
          </div>
        ) : rankingData && rankingData.currentUserData.racesCount > 0 ? (
          <div className="space-y-4">
             <h3 className="text-xl font-semibold text-center text-primary pt-2">
                Ranking for: {rankingData.eventTypeDisplay} ({rankingData.year})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-background/50 text-center">
                <CardHeader><CardTitle className="text-base font-semibold">Overall Rank (India)</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-accent">{rankingData.overallRank.rank > 0 ? `${rankingData.overallRank.rank}${getOrdinal(rankingData.overallRank.rank)}` : 'N/A'}</p>
                   {rankingData.overallRank.rank > 0 && <p className="text-sm text-muted-foreground">out of {rankingData.overallRank.total} athletes</p>}
                </CardContent>
              </Card>
              <Card className="bg-background/50 text-center">
                <CardHeader><CardTitle className="text-base font-semibold">Gender Rank (India)</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-accent">{rankingData.genderOverallRank.rank > 0 ? `${rankingData.genderOverallRank.rank}${getOrdinal(rankingData.genderOverallRank.rank)}` : 'N/A'}</p>
                  {rankingData.genderOverallRank.rank > 0 && <p className="text-sm text-muted-foreground">among {rankingData.genderOverallRank.total} {rankingData.currentUserData.gender || ''} athletes</p>}
                </CardContent>
              </Card>
              <Card className="bg-background/50 text-center">
                <CardHeader><CardTitle className="text-base font-semibold">Age Group Rank (India)</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-accent">{rankingData.ageGenderRank.rank > 0 ? `${rankingData.ageGenderRank.rank}${getOrdinal(rankingData.ageGenderRank.rank)}` : 'N/A'}</p>
                  {rankingData.ageGenderRank.rank > 0 && rankingData.currentUserData.athleteCategory && <p className="text-sm text-muted-foreground">in {rankingData.currentUserData.athleteCategory} ({rankingData.currentUserData.gender || 'N/A'})</p>}
                </CardContent>
              </Card>
            </div>
             <div className="pt-4">
              <p className="text-lg font-medium">Total Points: <span className="font-bold text-primary">{rankingData.currentUserData.totalPoints}</span> from {rankingData.currentUserData.racesCount} race(s).</p>
            </div>
            
            <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1.5">
                <Info className="h-3 w-3 mt-0.5 shrink-0"/>
                <span>Points are awarded based on your finish time. Only finished races count.</span>
            </p>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">
                {`No ranking data available for ${currentUser.name || 'you'} for "${selectedEventType === 'all' ? 'All Event Types' : selectedEventType === 'triathlon' ? 'Triathlon Events' : 'Duathlon Events'}" in ${selectedYear}.`}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
                Register for your next Bergman Triathlon / Duathlon to earn points and get on the leaderboard!
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
