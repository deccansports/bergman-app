"use client";

import { useMemo } from 'react';
import { formatSecondsToHMS } from '@/lib/utils';
import type { DynamicSplitSummaryTableProps } from './split-modal/types';
import { buildSplitModalModel, formatDistance, formatPace, formatSpeed, formatTimeOfDay, getPointDisplayLabel } from './split-modal/utils';

const FALLBACK = 'Waiting...';
const rankText = (value: number | null | undefined) => (Number.isFinite(Number(value)) && Number(value) > 0 ? String(value) : FALLBACK);

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
  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/70 overflow-hidden">
      <div className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold uppercase tracking-wide text-white">{title}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
              <SummaryCard label={sectionTheme === 'transition' ? 'Elapsed Time' : 'Section Time'} value={primaryMetricValue || FALLBACK} />
              {sectionTheme !== 'transition' ? <SummaryCard label={sectionTheme === 'bike' ? 'Average Speed' : 'Average Pace'} value={secondaryMetricValue || FALLBACK} /> : null}
              <SummaryCard label="Overall Rank" value={rankText((rows[0] as any)?.overallRank)} />
              <SummaryCard label="Category Rank" value={rankText((rows[0] as any)?.categoryRank)} />
              <SummaryCard label="Gender Rank" value={rankText((rows[0] as any)?.genderRank)} />
            </div>
          </div>
          <div className="flex-none rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Points</div>
            <div className="font-mono text-xs text-white">{reachedCount}/{rows.length}</div>
          </div>
        </div>
      </div>

      <div className="px-4">
        {rows.map((row) => {
          const isCurrent = row.state === 'current';
          const isCompleted = row.state === 'completed';
          const elapsedText = row.cumulativeSeconds !== null ? formatSecondsToHMS(row.cumulativeSeconds) : waitingLabel;
          const timeText = row.reached && row.cumulativeSeconds !== null && athlete.startTime
            ? formatTimeOfDay((athlete.startTime || 0) + row.cumulativeSeconds)
            : waitingLabel;
          const metricText = row.reached && row.splitSeconds !== null
            ? (metricLabel === 'Speed'
              ? formatSpeed(row.avgSpeedKph || null)
              : metricLabel === 'Elapsed Time'
                ? formatSecondsToHMS(row.splitSeconds)
                : formatPace(row.splitSeconds && row.distanceKm ? row.splitSeconds / row.distanceKm : null))
            : waitingLabel;

          return (
            <div key={`${title}-${row.point.id}-${row.index}`} className={`border-b border-white/5 py-3 ${splitStateClass(row.state)}`}>
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex-none">{splitIndicator(row.state)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className={`text-sm font-semibold ${isCurrent ? 'text-sky-200' : isCompleted ? 'text-emerald-200' : 'text-slate-300'}`}>
                      {getPointDisplayLabel(row.point, row.index)}
                    </div>
                    {isCurrent ? <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">Current Checkpoint</span> : null}
                  </div>

                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-wide text-slate-400">
                    <span>Status: <span className="text-slate-200">{String(row.state || waitingLabel).toUpperCase()}</span></span>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Distance</div>
                      <div className={`font-mono text-xs ${isCurrent ? 'text-slate-50' : 'text-slate-200'}`}>{formatDistance(row.distanceKm ?? null)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Time</div>
                      <div className={`font-mono text-xs ${isCurrent ? 'text-slate-50' : 'text-slate-200'}`}>{timeText}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Elapsed</div>
                      <div className={`font-mono text-xs ${isCurrent ? 'text-slate-50' : 'text-slate-200'}`}>{elapsedText}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">{metricLabel}</div>
                      <div className={`font-mono text-xs ${isCurrent ? 'text-slate-50' : 'text-slate-200'}`}>{metricText || FALLBACK}</div>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Gap</div>
                      <div className={`font-mono text-xs ${isCurrent ? 'text-slate-50' : 'text-slate-200'}`}>{row.rankDelta !== null ? `+${row.rankDelta}` : waitingLabel}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Rank</div>
                      <div className={`font-mono text-xs ${isCurrent ? 'text-slate-50' : 'text-slate-200'}`}>{row.pointRank !== null ? `#${row.pointRank}` : waitingLabel}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Status</div>
                      <div className={`font-mono text-xs ${isCurrent ? 'text-slate-50' : 'text-slate-200'}`}>{String(row.state || FALLBACK).toUpperCase()}</div>
                    </div>
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

  const waitingLabel = model.isNotStarted ? 'Waiting for Start' : FALLBACK;

  const currentRow = model.currentPoint;
  const raceStatus = model.isNotStarted ? 'Registered · Waiting for Start' : (model.athleteStatus || FALLBACK);
  const currentLeg = model.isFinished
    ? 'FINISHED'
    : model.isNotStarted
    ? 'Not Started'
    : (model.currentSection?.label ? String(model.currentSection.label).toUpperCase() : '—');
  const currentSplit = model.isNotStarted ? 'Waiting for Start' : (model.currentSection?.label || (currentRow ? getPointDisplayLabel(currentRow.point, currentRow.index) : '—'));
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
    ? 'Waiting for Start'
    : (Number.isFinite(currentSpeedKph) && currentSpeedKph > 0 ? formatSpeed(currentSpeedKph) : FALLBACK);
  const lastTimingPointRow = [...model.rows].filter((row) => row.reached).sort((a, b) => Number(a.cumulativeSeconds || 0) - Number(b.cumulativeSeconds || 0)).pop();
  const lastTimingPointText = model.isNotStarted ? '—' : (lastTimingPointRow ? getPointDisplayLabel(lastTimingPointRow.point, lastTimingPointRow.index) : '—');
  const lastUpdatedRaw = Number((athlete as any)?.lastUpdateTime ?? (participant as any)?.lastUpdateTime ?? NaN);
  const lastUpdatedDate = Number.isFinite(lastUpdatedRaw) && lastUpdatedRaw > 0
    ? new Date(lastUpdatedRaw > 1_000_000_000_000 ? lastUpdatedRaw : lastUpdatedRaw * 1000)
    : null;
  const lastUpdatedText = lastUpdatedDate && !Number.isNaN(lastUpdatedDate.getTime()) ? lastUpdatedDate.toLocaleString() : FALLBACK;

  return (
    <div className="w-full max-w-full min-w-0 space-y-2 overflow-x-hidden">
      <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">Race Overview</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-5">
          <SummaryCard label="Race Status" value={raceStatus} />
          <SummaryCard label="Current Leg" value={currentLeg || FALLBACK} />
          <SummaryCard label="Current Split" value={currentSplit || FALLBACK} />
          <SummaryCard label="Overall Time" value={model.totalRaceTimeSeconds ? formatSecondsToHMS(model.totalRaceTimeSeconds) : waitingLabel} />
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
