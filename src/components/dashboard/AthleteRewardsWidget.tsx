// src/components/dashboard/AthleteRewardsWidget.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
    Trophy, Star, Zap, Clock, ChevronRight, 
    TrendingUp, Award, CheckCircle2, Info, History,
    Waves, Bike, Footprints, ArrowRight
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getAthleteRankingData } from '@/lib/actions/athleteRankingActions';
import { PERFORMANCE_REWARDS, getRewardTierByPoints } from '@/lib/rewardsEngine';
import type { RankedAthlete } from '@/lib/types';
import { cn, formatSecondsToHMS, hmsToSeconds, getOrdinal } from '@/lib/utils';
import Link from 'next/link';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';

export default function AthleteRewardsWidget() {
  const { currentUser } = useAuth();
  const [rankingData, setRankingData] = useState<RankedAthlete | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const currentYear = new Date().getFullYear();
  const rewardSeason = currentYear - 1; // Rewards are based on last year's performance

  useEffect(() => {
    if (currentUser?.uid) {
      setIsLoading(true);
      getAthleteRankingData({ year: rewardSeason }).then(res => {
        if (res.success && res.rankings) {
          const myData = res.rankings.find(r => r.athleteId === currentUser.uid);
          setRankingData(myData || null);
        }
        setIsLoading(false);
      });
    }
  }, [currentUser?.uid, rewardSeason]);

  const stats = useMemo(() => {
    const points = rankingData?.totalPoints || 0;
    const tier = getRewardTierByPoints(points);
    const nextTierIndex = PERFORMANCE_REWARDS.findIndex(r => r.tier === tier.tier) + 1;
    const nextTier = nextTierIndex < PERFORMANCE_REWARDS.length ? PERFORMANCE_REWARDS[nextTierIndex] : null;
    
    let progress = 100;
    let pointsToNext = 0;
    
    if (nextTier) {
        const range = nextTier.minPoints - tier.minPoints;
        const currentProgress = points - tier.minPoints;
        progress = Math.min(100, Math.max(0, (currentProgress / range) * 100));
        pointsToNext = nextTier.minPoints - points;
    }

    return { points, tier, nextTier, progress, pointsToNext };
  }, [rankingData]);

  if (isLoading) return <Card className="shadow-lg animate-pulse h-64" />;

  // Only show if they actually have points or a tier, or if they are a new athlete
  const hasHistory = (rankingData?.races?.length || 0) > 0;

  return (
    <Card className="border-none shadow-2xl bg-slate-950 text-white overflow-hidden relative text-left">
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -mr-32 -mt-32"></div>
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-orange-600/5 rounded-full blur-3xl -ml-24 -mb-24"></div>
      
      <CardHeader className="p-6 md:p-8 border-b border-white/5 text-left relative z-10">
        <div className="flex justify-between items-start text-left">
            <div className="space-y-1 text-left">
                <Badge variant="outline" className="text-primary border-primary/30 font-black uppercase tracking-widest text-[9px] px-2 h-5">
                    Bergman Rewards Status
                </Badge>
                <CardTitle className="text-2xl md:text-3xl font-black uppercase italic tracking-tighter text-left">
                    {stats.tier.label}
                </CardTitle>
            </div>
            <div className="text-right">
                <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Points ({rewardSeason})</p>
                <p className="text-3xl font-black italic text-primary tracking-tighter">{stats.points}</p>
            </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 md:p-8 space-y-8 relative z-10 text-left">
        {/* REWARD SUMMARY */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center text-left">
            <div className="space-y-4 text-left">
                <div className="flex items-center gap-4 text-left">
                    <div className={cn("h-14 w-14 rounded-2xl flex items-center justify-center shadow-xl shrink-0 border-2 border-white/10", stats.tier.color.replace('text-', 'bg-'))}>
                        <Award className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-left">
                        <p className="text-2xl font-black text-white italic tracking-tighter leading-none text-left">
                            {stats.tier.discountPercent}% OFF
                        </p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 text-left">
                            On all {currentYear} Race Entries
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-tighter text-left">
                    <Clock className="h-3.5 w-3.5 text-primary" />
                    Valid until 31 Dec {currentYear}
                </div>
            </div>

            <div className="space-y-3 text-left">
                <div className="flex justify-between items-end text-left">
                    <div className="text-left">
                        <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Season Progress</p>
                        <p className="text-xs font-bold text-white mt-0.5">{stats.points} / {stats.nextTier?.minPoints || 'MAX'} PTS</p>
                    </div>
                    {stats.nextTier && (
                        <p className="text-[9px] font-black uppercase text-primary italic text-left">
                            {stats.pointsToNext} pts to {stats.nextTier.tier} ({stats.nextTier.discountPercent}%)
                        </p>
                    )}
                </div>
                <Progress value={stats.progress} className="h-2 bg-white/5" />
            </div>
        </div>

        {/* POINTS HISTORY TOGGLE */}
        {hasHistory && (
            <div className="space-y-4 pt-4 border-t border-white/5 text-left">
                <Button 
                    variant="ghost" 
                    className="p-0 h-auto hover:bg-transparent text-slate-400 hover:text-white group transition-colors font-bold uppercase text-[10px] tracking-widest text-left"
                    onClick={() => setShowHistory(!showHistory)}
                >
                    <History className="mr-2 h-3 w-3" />
                    {showHistory ? 'Hide' : 'View'} Contributing Races
                    <ChevronRight className={cn("ml-1 h-3 w-3 transition-transform", showHistory && "rotate-90")} />
                </Button>

                {showHistory && (
                    <div className="space-y-2 animate-in slide-in-from-top-2 duration-300 text-left">
                        {rankingData?.races.map((race, idx) => (
                            <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 text-left">
                                <div className="text-left">
                                    <p className="text-xs font-black uppercase italic tracking-tight text-white text-left">{race.eventName || race.raceCategory}</p>
                                    <p className="text-[9px] font-bold text-slate-500 uppercase text-left">{race.raceDate} • {race.location}</p>
                                </div>
                                <div className="text-right">
                                    <Badge variant="outline" className="font-black text-[10px] border-primary/30 text-primary">
                                        +{race.pointsAwarded} PTS
                                    </Badge>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )}
      </CardContent>

      <CardFooter className="p-6 md:p-8 pt-0 flex flex-col sm:flex-row gap-4 items-center text-left relative z-10">
          <Button asChild className="w-full sm:flex-1 bg-white text-slate-950 hover:bg-slate-200 font-black uppercase tracking-widest h-12 rounded-xl text-xs">
              <Link href="/races">
                  Register With Your Reward <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
          </Button>
          <Button asChild variant="outline" className="w-full sm:w-auto bg-white text-slate-950 border-none hover:bg-slate-200 font-black uppercase tracking-widest h-12 rounded-xl text-[10px]">
              <Link href="/rewards">
                  Learn More
              </Link>
          </Button>
      </CardFooter>
    </Card>
  );
}
