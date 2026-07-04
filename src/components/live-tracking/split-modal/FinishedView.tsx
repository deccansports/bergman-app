import { Flag, Trophy } from 'lucide-react';
import { MetricCard } from './presentation';
import type { SplitModalModel } from './types';
import { formatDistance, formatPace, formatSpeed, getRankChip } from './utils';

export default function FinishedView({ model }: { model: SplitModalModel }) {
  return (
    <div className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-5 text-slate-200">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/10 text-amber-300">
          <Trophy className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">Athlete finished the race</h3>
          <p className="mt-1 text-sm text-slate-400">All recorded timing sections are locked in and shown below with final section summaries.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <MetricCard label="Final Status" value={<span className="inline-flex items-center gap-1"><Flag className="h-3.5 w-3.5" />Finished</span>} />
        <MetricCard label="Overall Rank" value={getRankChip(model.rankSummary.overall)} />
        <MetricCard label="Distance" value={formatDistance(model.totalDistanceKm)} />
        <MetricCard label={model.currentSection?.theme === 'bike' ? 'Average Speed' : 'Average Pace'} value={model.currentSection?.theme === 'bike' ? formatSpeed(model.overallAverageSpeed) : formatPace(model.overallAveragePace, '/km')} />
      </div>
    </div>
  );
}
