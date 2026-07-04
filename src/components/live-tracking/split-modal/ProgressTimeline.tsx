"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { formatSecondsToHMS } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { SplitModalModel } from './types';
import { MetricCard, iconForTheme, getThemeClasses } from './presentation';
import { formatDistance, formatPace, formatSpeed, getRankChip } from './utils';

export function SummaryMetrics({ model }: { model: SplitModalModel }) {
  return (
    <div className="grid w-full max-w-full min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
      <MetricCard label="Current Status" value={model.athleteStatus} subLabel={model.currentStatusLabel} />
      <MetricCard label="Current Speed" value={model.currentSpeedText} subLabel={model.currentSection?.label || '—'} />
      <MetricCard label="Estimated Finish" value={model.estimatedFinishText} subLabel={model.isFinished ? 'Finalized' : 'Projected from live timing'} />
      <MetricCard label="Gap to Leader" value={model.gapToLeaderText} subLabel={model.rankSummary.overall === 1 ? 'Leading' : `Rank ${getRankChip(model.rankSummary.overall)}`} />
    </div>
  );
}

export default function ProgressTimeline({ model }: { model: SplitModalModel }) {
  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-3 shadow-lg shadow-black/5 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Progress</div>
          <div className="text-sm font-semibold text-white">Split overview</div>
        </div>
        <div className="text-xs text-slate-400">{model.completedRows} / {model.rows.length} completed</div>
      </div>

      <div className="w-full max-w-full overflow-x-auto pb-1">
        <div className="flex min-w-max items-center gap-2">
          {model.sectionTimeline.map(({ section, state }, idx) => {
            const active = state === 'current';
            const completed = state === 'completed';
            const missed = state === 'missed';
            const classes = getThemeClasses(section.theme);
            return (
              <React.Fragment key={section.key}>
                <div className="flex min-w-[64px] shrink-0 flex-col items-center text-center sm:min-w-[80px]">
                  <motion.div
                    animate={active ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                    transition={active ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
                    className={cn('flex h-8 w-8 items-center justify-center rounded-full border text-white shadow-md', completed ? classes.dot : missed ? 'bg-orange-500' : 'bg-slate-700 text-slate-300', active && 'ring-4 ring-white/10')}
                  >
                    {iconForTheme(section.theme)}
                  </motion.div>
                  <div className="mt-1 line-clamp-1 max-w-full text-[10px] font-medium text-slate-200">{section.label}</div>
                </div>
                {idx !== model.sectionTimeline.length - 1 ? <div className={cn('h-0.5 min-w-[28px] flex-1 rounded-full', completed ? classes.dot : 'bg-white/10')} /> : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
