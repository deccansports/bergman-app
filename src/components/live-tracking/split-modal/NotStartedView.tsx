import { Clock, Route } from 'lucide-react';
import type { LiveAthlete } from '@/lib/types';
import { MetricCard } from './presentation';
import type { SplitModalModel } from './types';
import { formatDistance, getPointDisplayLabel, resolveAthleteAgeGroup } from './utils';

const formatStartTime = (startTime?: number | null) => {
  if (!startTime || startTime <= 0) return '—';
  return new Date(startTime * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function NotStartedView({ athlete, model }: { athlete: LiveAthlete; model: SplitModalModel }) {
  const profile = model.participantProfile;
  const ageGroupText = profile.ageGroup === '—' ? 'Not assigned' : profile.ageGroup;

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-slate-300">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white">
          <Clock className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-white">Not Started</h3>
          <p className="mt-1 text-sm text-slate-400">Race timing will appear after crossing the start mat.</p>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-[0.24em] text-slate-400">Splits</div>
        <div className="space-y-2">
          {model.rows.map((row) => (
            <div key={`planned-${row.point.id}-${row.index}`} className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
              <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{getPointDisplayLabel(row.point, row.index)}</div>
                <div className="text-[11px] text-slate-400">Split {row.index + 1}</div>
                </div>
                <div className="shrink-0 text-sm font-mono text-slate-200">{formatDistance(row.distanceKm)}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 lg:grid-cols-4">
                <div><span className="text-slate-500">Status:</span> Not started</div>
                <div><span className="text-slate-500">Passing:</span> —</div>
                <div><span className="text-slate-500">Elapsed:</span> —</div>
                <div><span className="text-slate-500">Rank:</span> —</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid w-full max-w-full min-w-0 grid-cols-2 gap-2 lg:grid-cols-3">
        <MetricCard label="Category" value={profile.category || '—'} />
        <MetricCard label="Gender" value={profile.gender || '—'} />
        <MetricCard label="Age Group" value={ageGroupText} />
        <MetricCard label="Course Distance" value={formatDistance(model.totalDistanceKm)} />
        <MetricCard label="Start Time" value={formatStartTime(profile.startTime)} subLabel={<span className="inline-flex items-center gap-1"><Route className="h-3.5 w-3.5" />{model.timingPoints.length} splits ready</span>} />
      </div>
    </div>
  );
}
