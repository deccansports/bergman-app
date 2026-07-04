"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getBelSeasonContentAction, type BelPageContent } from "@/lib/actions/eliteLeagueActions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Trophy, Sparkles, CheckCircle2, AlertTriangle, Waves, Footprints } from "lucide-react";

function BenefitLine({ text, provisional = false }: { text: string; provisional?: boolean }) {
  const normalized = text.toLowerCase();

  if (provisional) {
    return (
      <li className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <span>{text}</span>
      </li>
    );
  }

  if (normalized.includes('swim cap')) {
    return (
      <li className="flex items-start gap-2">
        <Waves className="h-4 w-4 text-cyan-500 shrink-0 mt-0.5" />
        <span>{text}</span>
      </li>
    );
  }

  if (normalized.includes('line up') || normalized.includes('lineup')) {
    return (
      <li className="flex items-start gap-2">
        <Footprints className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
        <span>{text}</span>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
      <span>{text}</span>
    </li>
  );
}

export default function EliteLeaguePage() {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<BelPageContent | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      const result = await getBelSeasonContentAction(2025);
      if (!mounted) return;
      setContent(result.content);
      setLoading(false);
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading || !content) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-14">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading Bergman Elite League content…</span>
        </div>
      </div>
    );
  }

  const publicRecognitionTiers = [
    { tier: "🥇 Elite Gold", rule: "Top performers in each age group" },
    { tier: "🥈 Elite Silver", rule: "Strong and consistent athletes" },
    { tier: "🥉 Elite Bronze", rule: "Emerging competitive athletes" },
  ];

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 sm:py-10 space-y-8">
      <Card className="relative overflow-hidden rounded-2xl border-primary/30 bg-gradient-to-br from-primary/20 via-orange-500/10 to-background shadow-xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.18),transparent_48%)]" />
        <CardHeader className="relative space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-primary text-primary-foreground hover:bg-primary font-bold">BEL {content.season}</Badge>
          </div>
          <CardTitle className="text-3xl sm:text-4xl font-black uppercase italic tracking-tight">🏆 Bergman Elite League (BEL)</CardTitle>
          <CardDescription className="text-base sm:text-lg text-foreground/80">Elevating Performance. Recognizing Consistency.</CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="official" className="w-full">
        <TabsList className="grid w-full grid-cols-1 sm:grid-cols-2 h-auto gap-2 rounded-2xl bg-primary/5 border border-primary/20 p-2">
          <TabsTrigger value="official" className="rounded-xl border border-primary/20 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-black uppercase tracking-wide">League Information</TabsTrigger>
          <TabsTrigger value="tiers" className="rounded-xl border border-primary/20 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-black uppercase tracking-wide">Recognition Tiers</TabsTrigger>
        </TabsList>

        <TabsContent value="official" className="mt-4">
          <Card className="rounded-2xl border-primary/20 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl font-black uppercase italic tracking-tight"><Sparkles className="h-5 w-5 text-primary" /> League Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm sm:text-base leading-7">
              <p>
                The Bergman Elite League (BEL) is the official annual ranking system of Bergman, designed to
                recognize athletes who demonstrate outstanding performance, consistency, and commitment across
                Bergman events.
              </p>
              <p className="font-medium">BEL is not something you apply for — it is earned through racing.</p>

              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
                <p className="font-semibold mb-2">🚀 How It Works</p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>📊 Points are awarded based on finish position, event category, and participation level.</li>
                  <li>🏁 Only an athlete’s best performances contribute to their final ranking.</li>
                  <li>📅 Rankings are calculated across the full season (January to December).</li>
                </ul>
                <p className="mt-3 text-muted-foreground">
                  At the end of the season, athletes are ranked within their age group and gender categories, as
                  well as on the overall leaderboard.
                </p>
              </div>

              <div className="rounded-2xl border border-primary/20 bg-background p-4 sm:p-5 shadow-sm">
                <p className="font-semibold mb-2">📊 Rankings & Categories</p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>🌍 Overall Rankings</li>
                  <li>🚹 Male Categories</li>
                  <li>🚺 Female Categories</li>
                  <li>🎂 Age Group Categories (e.g., 16–30, 31–40, 41–50, 51+)</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
                <p className="font-semibold mb-2">Each athlete’s ranking includes:</p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Total Points</li>
                  <li>Number of Race Starts</li>
                  <li>Category Rank</li>
                  <li>Overall Rank</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-primary/20 bg-background p-4 sm:p-5 shadow-sm">
                <p className="font-semibold mb-2">🔁 Annual Cycle</p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>BEL operates on a calendar year basis.</li>
                  <li>Rankings reset every year.</li>
                  <li>Athlete status is re-evaluated annually based on performance.</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-primary/20 bg-background p-4 sm:p-5 shadow-sm">
                <p className="font-semibold mb-2">🎯 Why It Matters</p>
                <p className="mb-2 text-muted-foreground">
                  The Bergman Elite League is more than just rankings — it’s a platform that celebrates dedication,
                  discipline, and the spirit of endurance sport.
                </p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>🎁 Tier-Based Auto Apply Discounts: Gold 20%, Silver 15%, Bronze 10%, Provisional 5%</li>
                  <li>🎟️ Priority access to Bib Collection</li>
                  <li>🏁 Recognition on race day and digital platforms</li>
                  <li>🏆 Official Bergman Elite status</li>
                  <li>📢 Featured athlete highlights</li>
                  <li>🚀 Priority Lineup on Race Day</li>
                  <li>🏊 BEL SWIM CAP</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 to-orange-500/10 p-4 sm:p-5">
                <p className="font-semibold">🔥 Compete. Improve. Rise.</p>
                <p className="mt-1 text-muted-foreground">
                  Whether you’re aiming for your first podium or striving to stay at the top, the Bergman Elite League
                  gives every athlete a reason to race harder, train smarter, and stay consistent.
                </p>
                <p className="mt-3 font-medium">🚀 Join the League</p>
                <p className="text-sm text-muted-foreground">Race. Perform. Earn your place.</p>
                <p className="text-sm">👉 Participate in Bergman events and start building your ranking today.</p>
                <div className="mt-3">
                  <Button asChild className="font-bold uppercase tracking-wide text-xs">
                    <Link href="/races">Go to Events & Register</Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tiers" className="mt-4">
          <Card className="rounded-2xl border-primary/20 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl font-black uppercase italic tracking-tight"><Trophy className="h-5 w-5 text-primary" /> Bergman Recognition Tiers</CardTitle>
              <CardDescription>Top athletes in each category are awarded Bergman Elite League status.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {publicRecognitionTiers.map((tier) => (
                <div key={tier.tier} className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex items-start justify-between gap-3">
                  <p className="font-semibold">{tier.tier}</p>
                  <p className="text-muted-foreground text-right">{tier.rule}</p>
                </div>
              ))}
              <div className="rounded-2xl border border-primary/20 p-4 text-sm text-muted-foreground bg-background">
                These tiers reflect not just peak performance, but consistency across races.
              </div>

              <div className="rounded-2xl border border-primary/20 p-4 sm:p-5 bg-background shadow-sm">
                <p className="font-semibold mb-2">🥇 Gold Benefits</p>
                <ul className="space-y-2 text-sm">
                  <BenefitLine text="🎁 20% Auto Apply Discount on eligible registrations" />
                  <BenefitLine text="🎟️ Priority access to Bib Collection" />
                  <BenefitLine text="🏁 Recognition on race day and digital platforms" />
                  <BenefitLine text="🏆 Official Bergman Elite status Gold" />
                  <BenefitLine text="📢 Featured athlete highlights" />
                  <BenefitLine text="BEL Swim Cap" />
                  <BenefitLine text="Priority lineup on Race Day" />
                </ul>
              </div>

              <div className="rounded-2xl border border-primary/20 p-4 sm:p-5 bg-background shadow-sm">
                <p className="font-semibold mb-2">🥈 Silver Benefits</p>
                <ul className="space-y-2 text-sm">
                  <BenefitLine text="🎁 15% Auto Apply Discount on eligible registrations" />
                  <BenefitLine text="🎟️ Priority access to Bib Collection" />
                  <BenefitLine text="🏁 Recognition on race day and digital platforms" />
                  <BenefitLine text="🏆 Official Bergman Elite status Silver" />
                  <BenefitLine text="📢 Featured athlete highlights" />
                  <BenefitLine text="BEL Swim Cap" />
                  <BenefitLine text="Line up after Gold" />
                </ul>
              </div>

              <div className="rounded-2xl border border-primary/20 p-4 sm:p-5 bg-background shadow-sm">
                <p className="font-semibold mb-2">🥉 Bronze Benefits</p>
                <ul className="space-y-2 text-sm">
                  <BenefitLine text="🎁 Bronze: 10% Auto Apply Discount on eligible registrations" />
                  <BenefitLine text="🏁 Recognition on race day and digital platforms" />
                  <BenefitLine text="🏆 Official Bergman Elite status Bronze" />
                  <BenefitLine text="📢 Featured athlete highlights" />
                  <BenefitLine text="Line up after Silver tier" />
                </ul>
              </div>

              <div className="rounded-2xl border border-amber-300/40 p-4 sm:p-5 bg-amber-50/40 shadow-sm">
                <p className="font-semibold mb-2">⚠️ Provisional Status (Not Bronze)</p>
                <ul className="space-y-2 text-sm">
                  <BenefitLine provisional text="Provisional athletes are athletes with fewer than 2 valid starts and at least 499 earned points." />
                  <BenefitLine provisional text="A 5% BEL tier reward discount is applied in Provisional status." />
                  <BenefitLine provisional text="Athletes below 499 BEL points remain in No Tier (normal tier) until they qualify." />
                  <BenefitLine provisional text="Provisional does not receive Bronze tier race-day lineup or badge privileges." />
                  <BenefitLine provisional text="Complete at least 2 finishes to become eligible for final BEL tiering." />
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
