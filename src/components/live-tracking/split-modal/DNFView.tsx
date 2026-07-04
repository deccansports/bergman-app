import { AlertTriangle, Route } from 'lucide-react';
import { MetricCard } from './presentation';
import type { SplitModalModel } from './types';
import { formatDistance, getRankChip } from './utils';

export default function DNFView({ model }: { model: SplitModalModel }) {
  return (
    <div className="rounded-3xl border border-orange-500/20 bg-orange-500/5 p-5 text-slate-200">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-500/25 bg-orange-500/10 text-orange-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">Athlete did not finish</h3>
          <p className="mt-1 text-sm text-slate-400">Recorded splits remain visible. Unreached splits are marked as missed to keep the race path clear.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <MetricCard label="Status" value={model.athleteStatus} />
        <MetricCard label="Overall Rank" value={getRankChip(model.rankSummary.overall)} />
        <MetricCard label="Distance Reached" value={formatDistance(model.rows.filter((row) => row.reached).reduce((sum, row) => Math.max(sum, Number(row.distanceKm || 0)), 0))} />
        <MetricCard label="Sections" value={String(model.sections.length)} subLabel={<span className="inline-flex items-center gap-1"><Route className="h-3.5 w-3.5" />Course progression retained</span>} />
      </div>
    </div>
  );
}
