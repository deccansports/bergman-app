// src/app/rewards/page.tsx
"use client";

import React from 'react';
import { Trophy, Star, Zap, ShieldCheck, CheckCircle2, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export default function RewardsPage() {
  const currentYear = new Date().getFullYear();

  return (
    <main className="bg-background text-left">
      {/* HERO SECTION */}
      <header className="hero bg-gradient-to-br from-slate-900 via-slate-800 to-black text-white py-24 md:py-32 px-6 text-center">
        <div className="container mx-auto">
          <Badge className="bg-accent/20 text-accent border-accent/50 px-4 py-1 mb-6 font-black uppercase tracking-widest text-[10px]">
            The Bergman ecosystem
          </Badge>
          <h1 className="text-4xl md:text-7xl font-black italic tracking-tighter text-white mb-6 uppercase">
            Community Prestige
          </h1>
          <p className="max-w-2xl mx-auto text-lg md:text-xl text-slate-300 leading-relaxed font-medium">
            Climb the ranks, gain community recognition, and unlock exclusive visibility through your performance.
          </p>
        </div>
      </header>

      {/* CORE INFO */}
      <section className="py-20 px-6">
        <div className="container mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-6 text-left">
              <h2 className="text-3xl font-black uppercase italic tracking-tight text-foreground text-left">Race. Rank. Reign.</h2>
              <p className="text-muted-foreground text-lg leading-relaxed text-left">
                The Bergman series operates on an exclusive <strong>Prestige System</strong> that rewards participation and top-tier performance with community status and priority.
              </p>
              <p className="text-muted-foreground text-lg leading-relaxed text-left">
                Accumulate points through consistent finishes, podium placements, and long-distance events to earn your spot on the global spotlight.
              </p>
              <div className="pt-4 text-left">
                <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground h-14 px-8 rounded-xl font-black uppercase tracking-widest transition-all text-left">
                  <Link href="/dashboard">View My Rank <ArrowRight className="ml-2 h-5 w-5"/></Link>
                </Button>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-left">
              <Card className="bg-secondary/40 border-none shadow-xl rounded-3xl p-6 text-left">
                <div className="h-12 w-12 bg-primary/20 rounded-xl flex items-center justify-center mb-4"><Zap className="text-primary h-6 w-6"/></div>
                <h3 className="font-black uppercase tracking-tight mb-2 text-left">Race Finishes</h3>
                <p className="text-sm text-muted-foreground text-left">+100 Base points for crossing the finish line</p>
              </Card>
              <Card className="bg-secondary/40 border-none shadow-xl rounded-3xl p-6 text-left">
                <div className="h-12 w-12 bg-primary/20 rounded-xl flex items-center justify-center mb-4"><Star className="text-primary h-6 w-6"/></div>
                <h3 className="font-black uppercase tracking-tight mb-2 text-left">Endurance Bonus</h3>
                <p className="text-sm text-muted-foreground text-left">+100 Extra points for conquering Long Distance (113, 226, or Half)</p>
              </Card>
              <Card className="bg-secondary/40 border-none shadow-xl rounded-3xl p-6 text-left">
                <div className="h-12 w-12 bg-primary/20 rounded-xl flex items-center justify-center mb-4"><Trophy className="text-primary h-6 w-6"/></div>
                <h3 className="font-black uppercase tracking-tight mb-2 text-left">Top Performance</h3>
                <p className="text-sm text-muted-foreground text-left">+200 for a Podium Finish, or +150 for finishing in the Top 10%</p>
              </Card>
              <Card className="bg-secondary/40 border-none shadow-xl rounded-3xl p-6 text-left">
                <div className="h-12 w-12 bg-primary/20 rounded-xl flex items-center justify-center mb-4"><ShieldCheck className="text-primary h-6 w-6"/></div>
                <h3 className="font-black uppercase tracking-tight mb-2 text-left">Loyalty Bonus</h3>
                <p className="text-sm text-muted-foreground text-left">+50 bonus points when competing in multiple races within the season.</p>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* RULES / BADGES */}
      <section className="py-20 px-6 bg-muted/20">
        <div className="container mx-auto max-w-4xl">
          <div className="bg-card text-card-foreground p-10 md:p-16 rounded-[3rem] shadow-2xl relative overflow-hidden text-left border border-border">
            <h2 className="text-3xl font-black uppercase italic tracking-tight mb-8 relative z-10 text-left">Recognition Rules</h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6 relative z-10 text-left">
              <li className="flex gap-3 text-left"><CheckCircle2 className="h-5 w-5 text-accent shrink-0"/> <span className="text-sm font-bold text-left">Points compound incrementally per race in a single season</span></li>
              <li className="flex gap-3 text-left"><CheckCircle2 className="h-5 w-5 text-accent shrink-0"/> <span className="text-sm font-bold text-left">All calculations happen automatically using verified Chip Time data</span></li>
              <li className="flex gap-3 text-left"><CheckCircle2 className="h-5 w-5 text-accent shrink-0"/> <span className="text-sm font-bold text-left">Your overall rank is continuously displayed on your central Dashboard</span></li>
              <li className="flex gap-3 text-left"><CheckCircle2 className="h-5 w-5 text-accent shrink-0"/> <span className="text-sm font-bold text-left">Top earners are featured on our Homepage Spotlight</span></li>
            </ul>
          </div>
        </div>
      </section>

      {/* CALL TO ACTION */}
      <section className="py-24 bg-gradient-to-t from-background to-secondary/30 px-6 text-center">
        <div className="container mx-auto">
          <h2 className="text-4xl md:text-6xl font-black italic tracking-tighter text-foreground mb-6 uppercase">Join the Elite.</h2>
          <p className="max-w-2xl mx-auto text-lg text-muted-foreground mb-10 font-medium">
            Join the endurance ecosystem. Log your times, ascend the leaderboards, and carve out your legacy.
          </p>
          <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground h-16 px-12 rounded-2xl font-black uppercase tracking-widest text-lg shadow-xl shadow-primary/20 transition-all text-left">
            <Link href="/races" className="text-left">Register for the Next Event</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
