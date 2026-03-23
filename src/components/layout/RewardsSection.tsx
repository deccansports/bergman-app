
// src/components/layout/RewardsSection.tsx
"use client";

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PERFORMANCE_REWARDS } from '@/lib/rewardsEngine';
import { cn } from '@/lib/utils';
import { Zap, Star, ArrowRight, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';

export default function RewardsSection() {
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;

  return (
    <section className="w-full py-12 md:py-24 bg-slate-50 dark:bg-slate-900/50">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col md:flex-row items-end justify-between mb-12 gap-4 text-left">
          <div className="text-left space-y-2">
            <Badge variant="outline" className="text-primary font-black uppercase tracking-widest px-3 py-1 border-primary/20">
              Loyalty Program
            </Badge>
            <h2 className="text-3xl font-black uppercase italic tracking-tighter sm:text-5xl text-left">
              Performance Rewards
            </h2>
            <p className="max-w-[700px] text-muted-foreground md:text-lg font-medium text-left">
              Your results on the course unlock savings at the checkout. Accumulate points in {previousYear} to earn automatic discounts on every {currentYear} race.
            </p>
          </div>
          <Button asChild variant="ghost" className="font-bold uppercase text-xs tracking-widest group">
            <Link href="/rewards" className="flex items-center">
              View Full Policy <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
          {PERFORMANCE_REWARDS.map((tier, index) => (
            <motion.div
              key={tier.tier}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className={cn(
                "border-none shadow-xl rounded-3xl h-full transition-all duration-300 group hover:scale-105",
                tier.discountPercent > 0 ? "bg-white dark:bg-slate-900 ring-2 ring-primary/10" : "bg-white/50 dark:bg-slate-900/50 grayscale opacity-70"
              )}>
                <CardHeader className="text-center pt-8 pb-4">
                  <div className={cn(
                    "text-4xl font-black italic tracking-tighter mb-2 transition-transform group-hover:scale-110",
                    tier.color
                  )}>
                    {tier.discountPercent}%
                  </div>
                  <CardTitle className="font-black uppercase text-[10px] tracking-[0.2em]">{tier.label}</CardTitle>
                </CardHeader>
                <CardContent className="text-center pb-8 space-y-4">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-xs font-bold text-muted-foreground uppercase">Requirement</span>
                    <Badge variant="secondary" className="font-black font-mono">
                      {tier.minPoints}{tier.maxPoints < 10000 ? `–${tier.maxPoints}` : '+'} PTS
                    </Badge>
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase leading-tight">
                    {tier.discountPercent === 0 
                      ? "Earn points to level up" 
                      : `Save ${tier.discountPercent}% on all race entries`}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="mt-16 p-8 bg-primary rounded-[2.5rem] shadow-2xl shadow-primary/20 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-32 -mt-32"></div>
            <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative z-10">
                <div className="flex items-center gap-6 text-left">
                    <div className="h-16 w-16 bg-white/20 rounded-2xl flex items-center justify-center shrink-0 border border-white/20">
                        <TrendingUp className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-left space-y-1">
                        <h3 className="text-2xl font-black uppercase italic tracking-tighter leading-none">Race More. Pay Less.</h3>
                        <p className="text-sm font-medium text-blue-50/80">Points earned during the {previousYear} season will unlock rewards for all {currentYear} races.</p>
                    </div>
                </div>
                <Button asChild size="lg" className="bg-white text-primary hover:bg-blue-50 h-14 px-8 rounded-xl font-black uppercase tracking-widest shrink-0">
                    <Link href="/athlete-rankings">Check My Points <Star className="ml-2 h-4 w-4 fill-primary" /></Link>
                </Button>
            </div>
        </div>
      </div>
    </section>
  );
}
