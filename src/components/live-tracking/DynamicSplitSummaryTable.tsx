"use client";

import { useMemo, useState } from 'react';
import { formatSecondsToHMS } from '@/lib/utils';
import type { DynamicSplitSummaryTableProps } from './split-modal/types';
import { buildSplitModalModel, formatDistance, formatPace, formatSpeed, formatTimeOfDay, getPointDisplayLabel } from './split-modal/utils';

const FALLBACK = 'Waiting...';
const rankText = (value: number | null | undefined) => (Number.isFinite(Number(value)) && Number(value) > 0 ? String(value) : FALLBACK);

const getLegAccentClasses = (theme?: string) => {
  if (theme === 'swim') return 'border-blue-500/40 bg-blue-500/10 text-blue-300';
  if (theme === 'bike') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (theme === 'run') return 'border-red-500/40 bg-red-500/10 text-red-300';
  return 'border-white/10 bg-slate-950/70 text-white';
};

const splitStateClass = (state: string) => {
  if (state === 'completed') return 'text-emerald-200';
  if (state === 'current') return 'border-l-2 border-l-sky-400 bg-sky-950/25 pl-3 text-slate-50';
  return 'text-slate-400';
};

const splitIndicator = (state: string) => {
  if (state === 'completed') return <span className="inline-flex h-4 w-4 items-center justify-center text-emerald-400">✓</span>;
  if (state === 'current') return <span className="inline-flex h-4 w-4 items-center justify-center text-sky-300">●</span>;
  return <span className="inline-flex h-4 w-4 items-center justify-center text-slate-500">○</span>;
};

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 font-mono text-xs font-semibold text-white">{value || FALLBACK}</div>
    </div>
  );
}

function ProgressBar({ label, value }: { label: string; value: number }) {
  const safeValue = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span>{label}</span>
        <span className="font-mono text-[11px] text-slate-200">{safeValue}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800">
        <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

function SplitSectionCard({
  title,
  metricLabel,
  rows,
  athlete,
  sectionTheme,
  primaryMetricValue,
  secondaryMetricValue,
  reachedCount,
  waitingLabel,
}: {
  title: string;
  metricLabel: 'Pace' | 'Speed' | 'Elapsed Time';
  rows: any[];
  athlete: any;
  sectionTheme: string;
  primaryMetricValue: string;
  secondaryMetricValue?: string;
  reachedCount: number;
  waitingLabel: string;
}) {
  const metricHeading = sectionTheme === 'transition' ? 'Elapsed Time' : sectionTheme === 'bike' ? 'Avg Speed' : 'Avg Pace';

  const renderMetric = (row: any) => {
    if (!row.reached || row.splitSeconds === null) return waitingLabel;
    if (metricLabel === 'Speed') return formatSpeed(row.avgSpeedKph || null);
    if (metricLabel === 'Elapsed Time') return formatSecondsToHMS(row.splitSeconds);
    return formatPace(row.splitSeconds && row.distanceKm ? row.splitSeconds / row.distanceKm : null);
  };

  return (
    <section className={`overflow-hidden rounded-2xl border ${getLegAccentClasses(sectionTheme)}`}>
      <div className="border-b border-white/10 bg-slate-950 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-bold uppercase tracking-wide ${sectionTheme === 'swim' ? 'text-blue-300' : sectionTheme === 'bike' ? 'text-emerald-300' : sectionTheme === 'run' ? 'text-red-300' : 'text-white'}`}>
              {title}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <SummaryCard label={sectionTheme === 'transition' ? 'Elapsed Time' : 'Section Time'} value={primaryMetricValue || FALLBACK} />
              {sectionTheme !== 'transition' ? <SummaryCard label={metricHeading} value={secondaryMetricValue || FALLBACK} /> : null}
              <SummaryCard label="Points" value={`${reachedCount}/${rows.length}`} />
            </div>
          </div>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full border-separate border-spacing-0 text-left">
          <thead className="sticky top-0 z-10 bg-slate-950/95 text-[10px] uppercase tracking-[0.18em] text-slate-400">
            <tr>
              {['Split', 'Distance', 'Split Time', 'Elapsed Time', 'Pace / Speed', 'Position', 'Gap'].map((header) => (
                <th key={header} className="border-b border-white/10 px-3 py-2 font-semibold">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isCurrent = row.state === 'current';
              const isCompleted = row.state === 'completed';
              const rowBg = isCurrent ? 'bg-sky-500/10' : isCompleted ? 'bg-emerald-500/5' : 'bg-transparent';
              const gapText = row.rankDelta !== null ? `${row.rankDelta > 0 ? '+' : ''}${row.rankDelta}` : waitingLabel;
              const positionText = row.pointRank !== null && row.pointRank !== undefined ? `#${row.pointRank}` : (isCurrent ? '▶' : isCompleted ? '✓' : '○');

              return (
                <tr key={`${title}-${row.point.id}-${row.index}`} className={`border-b border-white/5 ${rowBg}`}>
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${isCurrent ? 'bg-sky-500 text-white' : isCompleted ? 'bg-emerald-500 text-white' : 'bg-white/10 text-slate-300'}`}>
                        {positionText}
                      </div>
                      <div className="min-w-0">
                        <div className={`truncate text-sm font-semibold ${isCurrent ? 'text-sky-100' : isCompleted ? 'text-emerald-100' : 'text-slate-200'}`}>
                          {getPointDisplayLabel(row.point, row.index)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top font-mono text-xs text-slate-200">{formatDistance(row.distanceKm ?? null)}</td>
                  <td className="px-3 py-3 align-top font-mono text-xs text-slate-200">{row.reached && row.splitSeconds !== null ? formatSecondsToHMS(row.splitSeconds) : waitingLabel}</td>
                  <td className="px-3 py-3 align-top font-mono text-xs text-slate-200">{row.cumulativeSeconds !== null ? formatSecondsToHMS(row.cumulativeSeconds) : waitingLabel}</td>
                  <td className="px-3 py-3 align-top font-mono text-xs text-slate-200">{renderMetric(row)}</td>
                  <td className="px-3 py-3 align-top font-mono text-xs text-slate-200">{positionText}</td>
                  <td className="px-3 py-3 align-top font-mono text-xs text-slate-200">{gapText}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked rows */}
      <div className="space-y-2 p-3 md:hidden">
        {rows.map((row) => {
          const isCurrent = row.state === 'current';
          const isCompleted = row.state === 'completed';
          const metricText = renderMetric(row);
          const positionText = row.pointRank !== null && row.pointRank !== undefined ? `#${row.pointRank}` : (isCurrent ? '▶' : isCompleted ? '✓' : '○');
          return (
            <div key={`${title}-${row.point.id}-${row.index}`} className={`rounded-xl border px-3 py-3 ${isCurrent ? 'border-sky-400/40 bg-sky-500/10' : isCompleted ? 'border-emerald-400/30 bg-emerald-500/5' : 'border-white/10 bg-white/5'}`}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isCurrent ? 'bg-sky-500 text-white' : isCompleted ? 'bg-emerald-500 text-white' : 'bg-white/10 text-slate-300'}`}>
                  {isCurrent ? '▶' : isCompleted ? '✓' : '○'}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <div className="truncate text-sm font-semibold text-white">{getPointDisplayLabel(row.point, row.index)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    <MobileCell label="Distance" value={formatDistance(row.distanceKm ?? null)} />
                    <MobileCell label="Split Time" value={row.reached && row.splitSeconds !== null ? formatSecondsToHMS(row.splitSeconds) : waitingLabel} />
                    <MobileCell label="Elapsed" value={row.cumulativeSeconds !== null ? formatSecondsToHMS(row.cumulativeSeconds) : waitingLabel} />
                    <MobileCell label={metricHeading} value={metricText} />
                    <MobileCell label="Position" value={positionText} />
                    <MobileCell label="Gap" value={row.rankDelta !== null ? `${row.rankDelta > 0 ? '+' : ''}${row.rankDelta}` : waitingLabel} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MobileCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/10 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 font-mono text-[11px] font-semibold text-slate-100">{value || FALLBACK}</div>
    </div>
  );
}

function SectionTimeline({
  section,
  athleteStartTime,
  waitingLabel,
}: {
  section: any;
  athleteStartTime?: number | null;
  waitingLabel: string;
}) {
  const metricLabel: 'Pace' | 'Speed' | 'Elapsed Time' = section.theme === 'transition' ? 'Elapsed Time' : section.theme === 'bike' ? 'Speed' : 'Pace';
  const title = String(section.label || section.theme || 'SECTION').toUpperCase();
  return (
    <SplitSectionCard
      title={title}
      metricLabel={metricLabel}
      rows={section.rows}
      athlete={{ startTime: athleteStartTime }}
      sectionTheme={section.theme}
      primaryMetricValue={section.primaryMetricValue}
      secondaryMetricValue={section.secondaryMetricValue || section.paceText}
      reachedCount={section.reachedCount}
      waitingLabel={waitingLabel}
    />
  );
}

export default function DynamicSplitSummaryTable(props: DynamicSplitSummaryTableProps) {
  const { athlete, timingConfiguration, participant, participantsByBib, isLoading } = props;
  const showDebugPanel = Boolean(
    (athlete as any)?.isAdmin
    || (participant as any)?.isAdmin
    || (typeof window !== 'undefined' && window.location.pathname.includes('/admin')),
  );
  const model = useMemo(
    () => buildSplitModalModel({ athlete, timingConfiguration, participant, participantsByBib, ticketDef: props.ticketDef }),
    [athlete, timingConfiguration, participant, participantsByBib, props.ticketDef],
  );

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border border-white/10 bg-slate-950/40 p-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="h-12 animate-pulse rounded-lg bg-white/5" />
          <div className="h-12 animate-pulse rounded-lg bg-white/5" />
          <div className="h-12 animate-pulse rounded-lg bg-white/5" />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-lg bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  if (model.noContestAssigned) {
    return <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-400">Unable to resolve contest.</div>;
  }

  if (!model.splitDebug.validation.contestExists || !model.splitDebug.validation.splitsFound || model.timingPoints.length === 0) {
    return <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-300">No split configuration found for this contest.</div>;
  }

  const waitingLabel = model.isNotStarted ? '—' : FALLBACK;

  const currentRow = model.currentPoint;
  const raceStatus = model.lifecycleLabel || (model.isNotStarted ? 'Registered · Waiting for Start' : (model.athleteStatus || FALLBACK));
  const currentLeg = model.isFinished
    ? 'FINISHED'
    : model.isNotStarted
    ? 'Not Started'
    : (model.currentSection?.label ? String(model.currentSection.label).toUpperCase() : '—');
  const currentSplit = model.isNotStarted ? '-' : (model.currentSection?.label || (currentRow ? getPointDisplayLabel(currentRow.point, currentRow.index) : '—'));
  const visibleSections = model.sections.filter((section) => section.rows.length > 0);
  const progressStages = visibleSections.map((section, index) => {
    const reached = section.rows.filter((row) => row.reached).length;
    const total = section.rows.length;
    const pct = total > 0 ? Math.round((reached / total) * 100) : 0;
    const label = section.theme === 'finish' ? 'Finish' : String(section.theme || section.label || `Stage ${index + 1}`).toUpperCase();
    return { key: `${section.key}-${index}`, label, pct };
  });

  const reachedRows = model.rows.filter((row) => row.reached && row.distanceKm !== null);
  const distanceCovered = reachedRows.length ? Math.max(...reachedRows.map((row) => Number(row.distanceKm || 0))) : 0;
  const totalDistance = Number(model.totalDistanceKm || 0);
  const distanceRemaining = Math.max(0, totalDistance - distanceCovered);
  const gpsLat = Number((athlete as any)?.lat ?? (athlete as any)?.liveTracking?.lat ?? (participant as any)?.lat ?? NaN);
  const gpsLng = Number((athlete as any)?.lng ?? (athlete as any)?.liveTracking?.lng ?? (participant as any)?.lng ?? NaN);
  const gpsPositionText = Number.isFinite(gpsLat) && Number.isFinite(gpsLng) ? `${gpsLat.toFixed(5)}, ${gpsLng.toFixed(5)}` : FALLBACK;
  const currentSpeedKph = Number(
    (athlete as any)?.currentSpeedKph
    ?? (athlete as any)?.speed
    ?? (athlete as any)?.liveTracking?.speed
    ?? (participant as any)?.currentSpeedKph
    ?? NaN,
  );
  const currentSpeedText = model.isNotStarted
    ? '-'
    : (Number.isFinite(currentSpeedKph) && currentSpeedKph > 0 ? formatSpeed(currentSpeedKph) : FALLBACK);
  const lastTimingPointRow = [...model.rows].filter((row) => row.reached).sort((a, b) => Number(a.cumulativeSeconds || 0) - Number(b.cumulativeSeconds || 0)).pop();
  const lastTimingPointText = model.isNotStarted ? '—' : (lastTimingPointRow ? getPointDisplayLabel(lastTimingPointRow.point, lastTimingPointRow.index) : '—');
  const lastUpdatedRaw = Number((athlete as any)?.lastUpdateTime ?? (participant as any)?.lastUpdateTime ?? NaN);
  const lastUpdatedDate = Number.isFinite(lastUpdatedRaw) && lastUpdatedRaw > 0
    ? new Date(lastUpdatedRaw > 1_000_000_000_000 ? lastUpdatedRaw : lastUpdatedRaw * 1000)
    : null;
  const lastUpdatedText = lastUpdatedDate && !Number.isNaN(lastUpdatedDate.getTime()) ? lastUpdatedDate.toLocaleString() : FALLBACK;
  const officialRaceTimeText = model.officialRaceTimeSeconds !== null && model.officialRaceTimeSeconds !== undefined
    ? formatSecondsToHMS(model.officialRaceTimeSeconds)
    : waitingLabel;
  const athleteRaceTimeText = model.chipRaceTimeSeconds !== null && model.chipRaceTimeSeconds !== undefined
    ? formatSecondsToHMS(model.chipRaceTimeSeconds)
    : waitingLabel;

  return (
    <div className="w-full max-w-full min-w-0 space-y-2 overflow-x-hidden">
      <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">Race Overview</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-5">
          <SummaryCard label="Race Status" value={raceStatus} />
          <SummaryCard label="Current Leg" value={currentLeg || FALLBACK} />
          <SummaryCard label="Current Split" value={currentSplit || FALLBACK} />
          <SummaryCard label="Official Race Time" value={officialRaceTimeText} />
          <SummaryCard label="Athlete Race Time" value={athleteRaceTimeText} />
          <SummaryCard label="Overall Rank" value={model.isNotStarted ? waitingLabel : (Number.isFinite(Number(model.rankSummary.overall)) && Number(model.rankSummary.overall) > 0 ? rankText(model.rankSummary.overall) : waitingLabel)} />
          <SummaryCard label="Category Rank" value={model.isNotStarted ? waitingLabel : (Number.isFinite(Number(model.rankSummary.category)) && Number(model.rankSummary.category) > 0 ? rankText(model.rankSummary.category) : waitingLabel)} />
          <SummaryCard label="Gender Rank" value={model.isNotStarted ? waitingLabel : (Number.isFinite(Number(model.rankSummary.gender)) && Number(model.rankSummary.gender) > 0 ? rankText(model.rankSummary.gender) : waitingLabel)} />
          <SummaryCard label="Estimated Finish" value={model.estimatedFinishText && model.estimatedFinishText !== '—' ? model.estimatedFinishText : waitingLabel} />
          <SummaryCard label="Average Speed" value={model.isNotStarted ? waitingLabel : formatSpeed(model.overallAverageSpeed || null)} />
          <SummaryCard label="Average Pace" value={model.isNotStarted ? waitingLabel : formatPace(model.overallAveragePace || null)} />
        </div>
      </div>

      {visibleSections.map((section, index) => (
        <SectionTimeline
          key={`${section.key}-${index}`}
          section={section}
          athleteStartTime={athlete?.startTime}
          waitingLabel={waitingLabel}
        />
      ))}

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">Progress</h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {progressStages.length > 0 ? progressStages.map((stage) => (
            <ProgressBar key={stage.key} label={stage.label} value={stage.pct} />
          )) : <div className="text-xs text-slate-400">No progress stages available for this contest.</div>}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">Current Position</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <SummaryCard label="Distance Covered" value={formatDistance(distanceCovered)} />
          <SummaryCard label="Distance Remaining" value={formatDistance(distanceRemaining)} />
          <SummaryCard label="Current Speed" value={currentSpeedText} />
          <SummaryCard label="Last Timing Point" value={lastTimingPointText} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <span>GPS: {gpsPositionText === FALLBACK ? FALLBACK : gpsPositionText}</span>
          <span>•</span>
          <span>Updated: {model.isNotStarted ? waitingLabel : lastUpdatedText}</span>
        </div>
      </div>

      {showDebugPanel ? (
      <details className="w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40" open={false}>
        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold tracking-[0.2em] text-slate-300">DEBUG</summary>
        <div className="space-y-2 border-t border-white/10 px-3 py-3 text-xs text-slate-300">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="rounded border border-white/10 bg-white/[0.03] p-2"><div className="text-slate-400">Contest UUID</div><div className="font-mono break-all">{model.splitDebug.contestUuid || '—'}</div></div>
            <div className="rounded border border-white/10 bg-white/[0.03] p-2"><div className="text-slate-400">Contest Name</div><div>{model.splitDebug.contestName || '—'}</div></div>
            <div className="rounded border border-white/10 bg-white/[0.03] p-2"><div className="text-slate-400">Split Source</div><div>{model.splitDebug.splitSource || 'KV'}</div></div>
            <div className="rounded border border-white/10 bg-white/[0.03] p-2"><div className="text-slate-400">Participant UUID</div><div className="font-mono break-all">{String((athlete as any)?.participant_uuid || (athlete as any)?.participantUuid || (athlete as any)?.liveTracking?.participantUuid || '—')}</div></div>
            <div className="rounded border border-white/10 bg-white/[0.03] p-2"><div className="text-slate-400">Provider</div><div>{String((timingConfiguration as any)?.provider || (athlete as any)?.liveTracking?.provider || 'feibot')}</div></div>
            <div className="rounded border border-white/10 bg-white/[0.03] p-2"><div className="text-slate-400">Total Splits Loaded</div><div>{model.splitDebug.splitCount}</div></div>
            <div className="rounded border border-white/10 bg-white/[0.03] p-2"><div className="text-slate-400">Course Distance</div><div>{model.splitDebug.courseDistanceKm.toFixed(2)} km</div></div>
            <div className="rounded border border-white/10 bg-white/[0.03] p-2"><div className="text-slate-400">Event Config Version</div><div>{model.splitDebug.eventConfigurationVersion || '—'}</div></div>
            <div className="rounded border border-white/10 bg-white/[0.03] p-2 md:col-span-3"><div className="text-slate-400">Last Synced</div><div>{model.splitDebug.lastSynced || '—'}</div></div>
          </div>

          <div className="rounded border border-white/10 bg-white/[0.03] p-2">
            <div className="mb-1 text-slate-400">Validation</div>
            <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
              <div>Contest UUID found: {model.splitDebug.validation.contestUuidFound ? 'Yes' : 'No'}</div>
              <div>Contest exists: {model.splitDebug.validation.contestExists ? 'Yes' : 'No'}</div>
              <div>Splits found: {model.splitDebug.validation.splitsFound ? 'Yes' : 'No'}</div>
              <div>Sorted by distance: {model.splitDebug.validation.sortedByDistance ? 'Yes' : 'No'}</div>
              <div>Course distance calculated: {model.splitDebug.validation.courseDistanceCalculated ? 'Yes' : 'No'}</div>
              <div>Missing timing points: {model.splitDebug.missingTimingPointCount}</div>
            </div>
          </div>

          {model.splitDebug.logs.length > 0 ? (
            <div className="rounded border border-white/10 bg-white/[0.03] p-2">
              <div className="mb-1 text-slate-400">Logs</div>
              <ul className="list-disc space-y-1 pl-5">
                {model.splitDebug.logs.map((log, idx) => <li key={`log-${idx}`}>{log}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="rounded border border-white/10 bg-white/[0.03] p-2">
            <div className="mb-1 text-slate-400">Loaded Splits</div>
            <div className="space-y-1">
              {model.splitDebug.splits.map((split, idx) => (
                <div key={`${split.splitUuid || split.name}-${idx}`} className="grid grid-cols-1 gap-1 rounded border border-white/10 px-2 py-1 md:grid-cols-[1.2fr_1fr_120px_1fr]">
                  <div>{split.name}</div>
                  <div className="font-mono break-all text-slate-400">{split.splitUuid || '—'}</div>
                  <div>{split.distanceKm !== null ? `${split.distanceKm.toFixed(2)} km` : '—'}</div>
                  <div className="font-mono break-all text-slate-400">{split.timingPointUuid || '—'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </details>
      ) : null}
    </div>
  );
}
