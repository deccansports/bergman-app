import React from 'react';
import { Bike, Flag, Footprints, MapPin, TimerReset, Waves } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResolvedTimingPoint } from '@/lib/timingConfiguration';
import type { PointState, SectionThemeKey } from './types';
import { getTheme } from './utils';

export const getThemeClasses = (theme: SectionThemeKey) => {
  switch (theme) {
    case 'swim': return { accent: 'from-sky-500/20 to-sky-500/5 border-sky-500/30', pill: 'bg-sky-500/15 text-sky-300 border-sky-500/30', dot: 'bg-sky-500', text: 'text-sky-300' };
    case 'bike': return { accent: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30', pill: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-500', text: 'text-emerald-300' };
    case 'run': return { accent: 'from-orange-500/20 to-orange-500/5 border-orange-500/30', pill: 'bg-orange-500/15 text-orange-300 border-orange-500/30', dot: 'bg-orange-500', text: 'text-orange-300' };
    case 'transition': return { accent: 'from-violet-500/20 to-violet-500/5 border-violet-500/30', pill: 'bg-violet-500/15 text-violet-300 border-violet-500/30', dot: 'bg-violet-500', text: 'text-violet-300' };
    case 'finish': return { accent: 'from-amber-500/20 to-amber-500/5 border-amber-500/30', pill: 'bg-amber-500/15 text-amber-300 border-amber-500/30', dot: 'bg-amber-500', text: 'text-amber-300' };
    default: return { accent: 'from-slate-500/15 to-slate-500/5 border-slate-500/20', pill: 'bg-slate-500/15 text-slate-200 border-slate-500/20', dot: 'bg-slate-500', text: 'text-slate-200' };
  }
};

export const iconForTheme = (theme: SectionThemeKey) => {
  switch (theme) {
    case 'swim': return <Waves className="h-4 w-4" />;
    case 'bike': return <Bike className="h-4 w-4" />;
    case 'run': return <Footprints className="h-4 w-4" />;
    case 'transition': return <TimerReset className="h-4 w-4" />;
    case 'finish': return <Flag className="h-4 w-4" />;
    default: return <MapPin className="h-4 w-4" />;
  }
};

export const iconForPoint = (point: ResolvedTimingPoint) => iconForTheme(getTheme(point));

export const getStateBadgeClass = (theme: SectionThemeKey, state: PointState) => {
  const classes = getThemeClasses(theme);
  if (state === 'current') return 'border-white/20 bg-white/15 text-white';
  if (state === 'completed') return classes.pill;
  if (state === 'missed') return 'border-orange-500/30 bg-orange-500/15 text-orange-300';
  return 'border-white/10 bg-white/[0.03] text-slate-400';
};

export function MetricCard({ label, value, subLabel, className }: { label: string; value: React.ReactNode; subLabel?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 shadow-sm backdrop-blur', className)}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-1 min-w-0 truncate text-sm font-semibold text-white">{value}</div>
      {subLabel ? <div className="mt-0.5 min-w-0 truncate text-[11px] text-slate-400">{subLabel}</div> : null}
    </div>
  );
}

export function RankingChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white">
      <span className="shrink-0 uppercase tracking-[0.18em] text-slate-300">{label}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}
