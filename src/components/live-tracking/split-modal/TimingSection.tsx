import { cn } from '@/lib/utils';
import type { SectionGroup } from './types';
import { RankingChip, getThemeClasses, iconForTheme } from './presentation';
import TimingPointCard from './TimingPointCard';
import { formatDistance } from './utils';

export default function TimingSection({ section, currentIndex, startTime }: { section: SectionGroup; currentIndex: number; startTime?: number | null }) {
  const themeClasses = getThemeClasses(section.theme);
  const isCurrentSection = section.rows.some((row) => row.index === currentIndex);
  const sectionDistance = section.rows.reduce((sum, row) => Math.max(sum, Number(row.distanceKm || 0)), 0);

  return (
    <section className={cn('w-full max-w-full min-w-0 overflow-hidden rounded-3xl border bg-slate-950/70 shadow-lg', themeClasses.accent, isCurrentSection && 'ring-2 ring-white/10')} style={{ contentVisibility: 'auto', containIntrinsicSize: '1px 500px' }}>
      <div className={cn('bg-gradient-to-r px-4 py-3 sm:px-5', themeClasses.accent)}>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-white shadow-sm', themeClasses.dot)}>
              {iconForTheme(section.theme)}
            </div>
            <div className="min-w-0">
              <div className={cn('text-[10px] uppercase tracking-[0.28em]', themeClasses.text)}>Section</div>
              <h3 className="mt-0.5 truncate text-lg font-semibold text-white">{section.label}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span>{section.primaryMetricValue}</span>
                <span>•</span>
                <span>{section.paceText}</span>
                <span>•</span>
                <span>{formatDistance(sectionDistance)}</span>
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5 sm:justify-end">
            {section.summaryChips.map((chip) => <RankingChip key={`${section.key}-${chip.label}`} label={chip.label} value={chip.value} />)}
          </div>
        </div>
      </div>

      <div className="w-full max-w-full min-w-0 space-y-2 p-3 sm:p-4">
        {section.rows.map((row, index) => (
          <TimingPointCard key={`${section.key}-${row.point.id}-${row.index}`} row={row} theme={section.theme} isCurrent={row.index === currentIndex} showConnector={index !== section.rows.length - 1} startTime={startTime} />
        ))}
      </div>
    </section>
  );
}
