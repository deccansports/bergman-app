"use client";

import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Circle, Minus } from 'lucide-react';
import { cn, formatSecondsToHMS } from '@/lib/utils';
import type { SectionThemeKey, TimingRow } from './types';
import { formatDistance, formatSpeed, formatTimeOfDay, getPointDisplayLabel, getSplitAverage } from './utils';
import { getThemeClasses, iconForPoint } from './presentation';

export default function TimingPointCard({ row, theme, isCurrent, showConnector, startTime }: { row: TimingRow; theme: SectionThemeKey; isCurrent: boolean; showConnector: boolean; startTime?: number | null }) {
  const themeClasses = getThemeClasses(theme);
  const statusLabel = row.state === 'completed' ? 'Completed' : row.state === 'current' ? 'Current split' : row.state === 'missed' ? 'Missed' : 'Future';
  const metricLabel = theme === 'transition' ? 'Elapsed' : theme === 'bike' ? 'Speed' : 'Pace';
  const timeText = row.reached && row.splitSeconds !== null ? formatSecondsToHMS(row.splitSeconds) : '—';
  const clockText = row.reached && row.cumulativeSeconds !== null && startTime ? formatTimeOfDay(startTime + row.cumulativeSeconds) : '—';
  const rankText = row.pointRank !== null ? `#${row.pointRank}` : '—';
  const paceText = row.splitSeconds !== null ? row.avgSpeedKph !== null && theme === 'bike' ? formatSpeed(row.avgSpeedKph) : getSplitAverage(theme, row.splitSeconds, row.distanceKm, null) : '—';

  return (
    <motion.div
      layout
      initial={false}
      animate={isCurrent ? { scale: 1.01 } : { scale: 1 }}
      transition={{ duration: 0.18 }}
      className={cn('w-full max-w-full min-w-0 overflow-hidden rounded-2xl border p-3 sm:p-3.5 shadow-sm backdrop-blur', isCurrent ? 'border-white/25 bg-white/10 ring-2 ring-offset-0' : row.state === 'missed' ? 'border-orange-500/30 bg-orange-500/10' : row.state === 'future' ? 'border-white/10 bg-white/[0.03]' : 'border-white/10 bg-white/5')}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '1px 120px' }}
    >
      <div className="flex min-w-0 gap-3">
        <div className="flex flex-col items-center pt-0.5">
          <motion.div
            animate={isCurrent ? { scale: [1, 1.1, 1] } : { scale: 1 }}
            transition={isCurrent ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
            className={cn('flex h-10 w-10 items-center justify-center rounded-full border text-white shadow-md', row.state === 'future' ? 'border-white/10 bg-slate-700/70 text-slate-300' : themeClasses.dot, isCurrent && 'ring-4 ring-white/10')}
          >
            {iconForPoint(row.point)}
          </motion.div>
          {showConnector ? <div className={cn('mt-1 h-full w-px flex-1 rounded-full', row.state === 'future' ? 'bg-white/10' : themeClasses.dot)} /> : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className={cn('truncate text-[15px] font-semibold', row.state === 'future' ? 'text-slate-400' : 'text-white')}>{getPointDisplayLabel(row.point, row.index)}</div>
              {row.point.shortName && row.point.shortName !== row.point.displayName ? <div className="mt-0.5 text-[11px] text-slate-400">{row.point.shortName}</div> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', themeClasses.pill)}>{statusLabel}</span>
              {isCurrent ? <span className="rounded-full border border-white/20 bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white">LIVE</span> : null}
              {row.isFastest ? <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">FASTEST SEGMENT</span> : null}
              {row.rankDelta !== null ? (
                <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', row.rankDelta > 0 ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : row.rankDelta < 0 ? 'border-rose-500/30 bg-rose-500/15 text-rose-300' : 'border-white/20 bg-white/10 text-white')}>
                  {row.rankDelta > 0 ? <><ArrowUpRight className="mr-1 inline h-3.5 w-3.5" />{row.rankDelta}</> : row.rankDelta < 0 ? <><ArrowDownRight className="mr-1 inline h-3.5 w-3.5" />{Math.abs(row.rankDelta)}</> : <><Minus className="mr-1 inline h-3.5 w-3.5" />0</>}
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-3 grid w-full max-w-full min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-300 lg:grid-cols-5">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Distance</div>
              <div className="truncate font-mono text-sm font-semibold text-white">{formatDistance(row.distanceKm)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Time</div>
              <div className="truncate font-mono text-sm font-semibold text-white">{timeText}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Clock</div>
              <div className="truncate font-mono text-sm font-semibold text-white">{clockText}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{metricLabel}</div>
              <div className="truncate font-mono text-sm font-semibold text-white">{paceText}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Rank</div>
              <div className="truncate font-mono text-sm font-semibold text-white">{rankText}</div>
            </div>
          </div>

          {row.reached && row.state === 'current' ? (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-300">
              <Circle className="h-3 w-3 fill-current text-white" />
              <span>Current point</span>
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
