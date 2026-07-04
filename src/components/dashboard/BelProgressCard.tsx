"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Medal, Target, Trophy } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { getBelSeasonLeaderboardAction } from "@/lib/actions";
import type { BelRankedAthlete } from "@/lib/actions/eliteLeagueActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

// BEL season = current year (since BEL data accumulates throughout the race year)
const getBelSeason = (): number => {
  return new Date().getFullYear();
};

type BelTier = "Gold" | "Silver" | "Bronze" | "Provisional" | "No Tier";

const VALID_BEL_TIERS: BelTier[] = ["Gold", "Silver", "Bronze", "Provisional", "No Tier"];

function getBelTier(athlete: BelRankedAthlete | null): BelTier {
  if (!athlete) return "No Tier";
  const raw = (athlete as any).belTier as string;
  if (VALID_BEL_TIERS.includes(raw as BelTier)) return raw as BelTier;
  // Legacy 'Unranked' or any unrecognised value → No Tier
  return "No Tier";
}

function getBelDiscountByTier(tier: BelTier): number {
  if (tier === "Gold") return 20;
  if (tier === "Silver") return 15;
  if (tier === "Bronze") return 10;
  if (tier === "Provisional") return 5;
  return 0;
}

export default function BelProgressCard() {
  const { currentUser } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [athlete, setAthlete] = useState<BelRankedAthlete | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(getBelSeason());

  // Generate list of available seasons starting from 2025 onwards
  const currentYear = useMemo(() => getBelSeason(), []);
  const availableSeasons = useMemo(() => Array.from(
    { length: currentYear - 2025 + 1 },
    (_, i) => currentYear - i
  ).sort(), [currentYear]);

  const currentUid = currentUser?.uid || '';
  const currentEmail = String(currentUser?.email || '').toLowerCase().trim();
  const currentMobile = String((currentUser as any)?.mobile || '').replace(/\D/g, '');
  const currentMobileLast10 = currentMobile.length >= 10 ? currentMobile.slice(-10) : currentMobile;

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!currentUid) {
        setAthlete(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      console.log(`[BelProgressCard] Fetching BEL data for season ${selectedSeason}, athlete ${currentUid}`);
      const result = await getBelSeasonLeaderboardAction(selectedSeason);
      if (!mounted) return;

      console.log(`[BelProgressCard] Result for season ${selectedSeason}:`, {
        source: result.source,
        rankingsCount: result.rankings?.length || 0,
        message: result.message,
      });

      const myEntry = result.rankings?.find((entry) => {
        const entryEmail = String(entry.email || '').toLowerCase().trim();
        const entryMobile = String(entry.mobile || '').replace(/\D/g, '');
        const entryMobileLast10 = entryMobile.length >= 10 ? entryMobile.slice(-10) : entryMobile;
        return (
          entry.athleteId === currentUid ||
          (!!currentEmail && entryEmail === currentEmail) ||
          (!!currentMobileLast10 && entryMobileLast10 === currentMobileLast10)
        );
      }) || null;

      // If current season has no entry, auto-fallback to the latest previous season that has data.
      if (!myEntry && selectedSeason === currentYear) {
        for (const season of availableSeasons) {
          if (season === selectedSeason) continue;
          const older = await getBelSeasonLeaderboardAction(season);
          const olderEntry = older.rankings?.find((entry) => {
            const entryEmail = String(entry.email || '').toLowerCase().trim();
            const entryMobile = String(entry.mobile || '').replace(/\D/g, '');
            const entryMobileLast10 = entryMobile.length >= 10 ? entryMobile.slice(-10) : entryMobile;
            return (
              entry.athleteId === currentUid ||
              (!!currentEmail && entryEmail === currentEmail) ||
              (!!currentMobileLast10 && entryMobileLast10 === currentMobileLast10)
            );
          }) || null;
          if (olderEntry) {
            if (!mounted) return;
            setSelectedSeason(season);
            setAthlete(olderEntry);
            setIsLoading(false);
            return;
          }
        }
      }
      console.log(`[BelProgressCard] Athlete entry for ${selectedSeason}:`, myEntry ? `Found - Tier: ${myEntry.belTier}` : 'Not found');
      
      setAthlete(myEntry);
      setIsLoading(false);
    }

    load();
    return () => {
      mounted = false;
    };
  }, [availableSeasons, currentEmail, currentMobileLast10, currentUid, currentYear, selectedSeason]);

  const summary = useMemo(() => {
    const tier = getBelTier(athlete);
    const rewardDiscountPercent = getBelDiscountByTier(tier);
    const starts = athlete?.racesFinished || 0;
    const minStarts = 2;
    const startsProgress = Math.min(100, (starts / minStarts) * 100);
    const points = athlete?.totalPoints || 0;
    const nextTierRank = tier === "Gold" ? 3 : tier === "Silver" ? 8 : tier === "Bronze" ? 18 : 18;
    const pointsLabel = athlete ? `${points} season points` : "No BEL points yet";

    return {
      tier,
      rewardDiscountPercent,
      starts,
      startsProgress,
      points,
      pointsLabel,
      nextTierRank,
    };
  }, [athlete]);

  if (isLoading) {
    return <Card className="h-56 animate-pulse" />;
  }

  return (
    <Card className="border border-slate-800 shadow-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white overflow-hidden">
      <CardHeader className="border-b border-white/10 bg-black/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-primary text-primary-foreground">BEL {selectedSeason}</Badge>
              <select 
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(Number(e.target.value))}
                className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white hover:bg-slate-700 cursor-pointer"
              >
                {availableSeasons.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
            </div>
            <CardTitle className="flex items-center gap-2 text-2xl font-black tracking-tight">
              <Trophy className="h-6 w-6 text-primary" /> Bergman Elite League Progress
            </CardTitle>
            <CardDescription className="text-slate-100/90">
              Your season status for BEL recognition.
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-primary/50 text-primary bg-slate-950/70 font-semibold">
            {summary.tier}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 p-6">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-slate-200">BEL Status</p>
            <p className="mt-2 text-2xl font-black text-primary">{summary.tier}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-slate-200">Total Points</p>
            <p className="mt-2 text-2xl font-black">{summary.points}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-slate-200">Overall Rank</p>
            <p className="mt-2 text-2xl font-black">{athlete?.overallRank || "—"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-slate-200">Category Rank</p>
            <p className="mt-2 text-2xl font-black">{athlete?.categoryRank || "—"}</p>
          </div>
        </div>

        <div className="rounded-xl border border-primary/40 bg-primary/10 p-4">
          <p className="text-xs font-black uppercase tracking-widest text-slate-200">BEL Reward</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {summary.rewardDiscountPercent > 0
              ? `${summary.rewardDiscountPercent}% Auto Apply Discount on eligible registrations`
              : 'No BEL reward discount unlocked yet'}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-200">Eligibility Progress</p>
              <p className="text-sm text-slate-100/90">Minimum 2 starts required for final BEL ranking.</p>
            </div>
            <div className="text-right text-sm font-bold text-white">{summary.starts} / 2 starts</div>
          </div>
          <Progress value={summary.startsProgress} className="h-2 bg-white/10" />
          <div className="flex flex-wrap gap-3 text-xs text-slate-100/90">
            <span className="inline-flex items-center gap-1"><Target className="h-3.5 w-3.5 text-primary" /> {summary.pointsLabel}</span>
            <span className="inline-flex items-center gap-1"><Medal className="h-3.5 w-3.5 text-primary" /> {athlete ? `${athlete.ageCategory || 'Open'} category` : 'Race to enter BEL standings'}</span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col sm:flex-row gap-3 p-6 pt-0">
        <Button asChild className="w-full sm:flex-1 bg-white text-slate-950 hover:bg-slate-200 font-black uppercase tracking-widest text-xs">
          <Link href="/elite-league">
            View BEL Details <ExternalLink className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="w-full sm:w-auto border-white/30 bg-slate-900 text-white hover:bg-slate-800 font-black uppercase tracking-widest text-[10px]">
          <Link href="/athlete-rankings">
            Open Rankings
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
