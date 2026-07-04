// src/components/live-tracking/BergmanSplitTable.tsx
"use client";

import React, { useMemo } from 'react';
import { formatSecondsToHMS } from '@/lib/utils';
import type { LiveAthlete, TicketDefinition } from '@/lib/types';
import { buildSplitModalModel, formatPace, formatSpeed, getPointDisplayLabel } from './split-modal/utils';

interface BergmanSplitTableProps {
  athlete: LiveAthlete;
  ticketDef?: TicketDefinition | null;
}

const FALLBACK = '—';

const themeLabel = (theme?: string | null) => String(theme || '').trim().toUpperCase() || 'SPLITS';

export default function BergmanSplitTable({ athlete, ticketDef }: BergmanSplitTableProps) {
  const model = useMemo(
    () => buildSplitModalModel({ athlete, timingConfiguration: null, participant: null, participantsByBib: {}, ticketDef: ticketDef || null }),
    [athlete, ticketDef],
  );

  const sections = model.sections.filter((section) => section.rows.length > 0 && section.theme !== 'transition');

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Race Status</div>
            <div className="mt-1 text-sm font-semibold text-white">{model.currentStatusLabel || FALLBACK}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Current Leg</div>
            <div className="mt-1 text-sm font-semibold text-white">{model.currentSection?.theme ? themeLabel(model.currentSection.theme) : FALLBACK}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Current Split</div>
            <div className="mt-1 text-sm font-semibold text-white">{model.currentPoint ? getPointDisplayLabel(model.currentPoint.point, model.currentPoint.index) : FALLBACK}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Overall Time</div>
            <div className="mt-1 text-sm font-semibold text-white">{model.totalRaceTimeSeconds ? formatSecondsToHMS(model.totalRaceTimeSeconds) : FALLBACK}</div>
          </div>
        </div>
      </div>

      {sections.map((section) => {
        const metricLabel = section.theme === 'bike' ? 'Speed' : 'Pace';
        return (
          <details key={section.key} className="rounded-2xl border border-white/10 bg-slate-950/50" open={section === sections[0]}>
            <summary className="cursor-pointer list-none px-3 py-3 text-sm font-semibold tracking-[0.2em] text-white">
              {themeLabel(section.theme)}
            </summary>
            <div className="border-t border-white/10 p-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="px-2 py-2">Split</th>
                      <th className="px-2 py-2">Time</th>
                      <th className="px-2 py-2">Elapsed</th>
                      <th className="px-2 py-2">{metricLabel}</th>
                      <th className="px-2 py-2">Rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => {
                      const elapsedText = row.cumulativeSeconds !== null ? formatSecondsToHMS(row.cumulativeSeconds) : FALLBACK;
                      const metricText = row.reached && row.splitSeconds !== null
                        ? (metricLabel === 'Speed'
                          ? formatSpeed(row.avgSpeedKph || null)
                          : formatPace(row.splitSeconds && row.distanceKm ? row.splitSeconds / row.distanceKm : null))
                        : FALLBACK;
                      return (
                        <tr key={`${section.key}-${row.point.id}-${row.index}`} className="border-t border-white/10 text-slate-200">
                          <td className="px-2 py-2">
                            <span className={row.state === 'current' ? 'font-semibold text-sky-200' : ''}>{getPointDisplayLabel(row.point, row.index)}</span>
                          </td>
                          <td className="px-2 py-2 font-mono">{row.reached && row.cumulativeSeconds !== null ? formatSecondsToHMS(row.cumulativeSeconds) : FALLBACK}</td>
                          <td className="px-2 py-2 font-mono">{elapsedText}</td>
                          <td className="px-2 py-2 font-mono">{metricText}</td>
                          <td className="px-2 py-2">{Number.isFinite(Number(row.pointRank)) && Number(row.pointRank) > 0 ? String(row.pointRank) : FALLBACK}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
