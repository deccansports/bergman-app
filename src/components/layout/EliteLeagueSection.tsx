"use client";

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Crown, Medal, ShieldCheck, ArrowRight, Trophy, CheckCircle2, AlertTriangle, Waves, Footprints } from 'lucide-react';
import { motion } from 'framer-motion';

const tiers = [
  {
    modalTitle: '🥇 Gold Benefits',
    title: 'Gold',
    discount: '20%',
    description: 'Top-tier BEL athletes unlock the highest automatic registration savings.',
    icon: Crown,
    className: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    benefits: [
      '🎁 20% Auto Apply Discount on eligible registrations',
      '🎟️ Priority access to Bib Collection',
      '🏁 Recognition on race day and digital platforms',
      '🏆 Official Bergman Elite status Gold',
      '📢 Featured athlete highlights',
      'BEL Swim Cap',
      'Priority lineup on Race Day',
    ],
  },
  {
    modalTitle: '🥈 Silver Benefits',
    title: 'Silver',
    discount: '15%',
    description: 'Consistent performance across the season keeps you in the elite rewards lane.',
    icon: Medal,
    className: 'bg-slate-50 border-slate-200 text-slate-700',
    benefits: [
      '🎁 15% Auto Apply Discount on eligible registrations',
      '🎟️ Priority access to Bib Collection',
      '🏁 Recognition on race day and digital platforms',
      '🏆 Official Bergman Elite status Silver',
      '📢 Featured athlete highlights',
      'BEL Swim Cap',
      'Line up after Gold',
    ],
  },
  {
    modalTitle: '🥉 Bronze Benefits',
    title: 'Bronze',
    discount: '10%',
    description: 'Build momentum, score points, and secure your season reward advantage.',
    icon: ShieldCheck,
    className: 'bg-amber-50 border-amber-200 text-amber-700',
    benefits: [
      '🎁 10% Auto Apply Discount on eligible registrations',
      '🏁 Recognition on race day and digital platforms',
      '🏆 Official Bergman Elite status Bronze',
      '📢 Featured athlete highlights',
      'Line up after Silver tier',
    ],
  },
  {
    modalTitle: '⚠️ Provisional Status (Not Bronze)',
    title: 'Provisional',
    discount: '5%',
    description: 'New BEL athletes get an immediate provisional benefit while building qualification points.',
    icon: ShieldCheck,
    className: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    benefits: [
      'Provisional athletes are athletes with fewer than 2 valid starts and at least 499 earned points.',
      'A 5% BEL tier reward discount is applied in Provisional status.',
      'Athletes below 499 BEL points remain in No Tier (normal tier) until they qualify.',
      'Provisional does not receive Bronze tier race-day lineup or badge privileges.',
      'Complete at least 2 finishes to become eligible for final BEL tiering.',
    ],
    isProvisional: true,
  },
];

function BenefitIcon({ item, isProvisional }: { item: string; isProvisional?: boolean }) {
  const text = item.toLowerCase();
  if (isProvisional) return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />;
  if (text.includes('swim cap')) return <Waves className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />;
  if (text.includes('line up') || text.includes('lineup')) return <Footprints className="h-4 w-4 text-orange-300 shrink-0 mt-0.5" />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />;
}

export default function EliteLeagueSection() {
  return (
    <section className="w-full py-12 md:py-24 bg-white dark:bg-slate-950">
      <div className="container px-4 md:px-6">
        <div className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white shadow-2xl overflow-hidden relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.22),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_28%)]" />
          <div className="relative z-10 p-6 md:p-10 lg:p-12">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-10 text-left">
              <div className="space-y-3 text-left max-w-3xl">
                <Badge className="bg-white/10 text-white border-white/15 font-black uppercase tracking-widest px-3 py-1">
                  Bergman Elite League (BEL)
                </Badge>
                <h2 className="text-3xl sm:text-5xl font-black uppercase italic tracking-tighter text-left">
                  Bergman Elite League (BEL) Benefits.
                </h2>
                <p className="text-sm md:text-lg text-slate-300 font-medium max-w-2xl text-left">
                  The Bergman Elite League (BEL) is now the official rewards framework. Climb tiers through race performance and receive automatic checkout discounts for the next season.
                </p>
              </div>
              <Button asChild size="lg" className="bg-orange-600 hover:bg-orange-700 text-white font-black uppercase tracking-widest rounded-xl h-12 md:h-14 px-6 md:px-8 shrink-0">
                <Link href="/elite-league">
                  Explore BEL <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              {tiers.map((tier, index) => {
                const Icon = tier.icon;
                return (
                  <motion.div
                    key={tier.title}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <Dialog>
                      <Card className="h-full rounded-3xl border-white/10 bg-white/5 backdrop-blur-sm text-white shadow-xl">
                        <CardContent className="p-6 text-left space-y-4 h-full flex flex-col">
                          <div className="flex items-center justify-between gap-3">
                            <div className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border ${tier.className}`}>
                              <Icon className="h-6 w-6" />
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Auto Benefit</p>
                              <p className="text-3xl font-black italic tracking-tighter text-orange-400">{tier.discount}</p>
                            </div>
                          </div>
                          <div>
                            <h3 className="text-xl font-black uppercase tracking-tight">{tier.title}</h3>
                            <p className="mt-2 text-sm text-slate-300 font-medium">{tier.description}</p>
                          </div>

                          <div className="pt-2 mt-auto">
                            <DialogTrigger asChild>
                              <Button variant="outline" className="w-full border-white/25 bg-white/10 text-white hover:bg-white/20 font-black uppercase tracking-widest text-[10px]">
                                View Benefits
                              </Button>
                            </DialogTrigger>
                          </div>
                        </CardContent>
                      </Card>

                      <DialogContent className="sm:max-w-2xl bg-slate-950 border-slate-800 text-white text-left">
                        <DialogHeader>
                          <DialogTitle className="text-2xl font-black uppercase tracking-tight text-left">
                            {tier.modalTitle}
                          </DialogTitle>
                          <DialogDescription className="text-slate-300 text-left">
                            {tier.title} tier benefit details and race-day privileges.
                          </DialogDescription>
                        </DialogHeader>

                        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-left">
                          <p className="text-xs font-black uppercase tracking-widest text-slate-400">Auto Benefit</p>
                          <p className="text-3xl font-black italic tracking-tighter text-orange-400 mt-1">{tier.discount}</p>
                        </div>

                        <div className="space-y-3 max-h-[46vh] overflow-y-auto pr-1 text-left">
                          {tier.benefits.map((item: string) => (
                            <div key={item} className="flex items-start gap-2 text-sm text-slate-200 text-left">
                              <BenefitIcon item={item} isProvisional={tier.isProvisional} />
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>

                        <DialogFooter className="text-left">
                          <DialogClose asChild>
                            <Button className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700 text-white font-black uppercase tracking-widest text-xs">
                              Close
                            </Button>
                          </DialogClose>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </motion.div>
                );
              })}
            </div>

            <div className="mt-8 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
              <Trophy className="h-5 w-5 text-orange-400 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-300 font-medium text-left">
                BEL discounts auto-apply at registration: Gold 20%, Silver 15%, Bronze 10%, Provisional 5%.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
