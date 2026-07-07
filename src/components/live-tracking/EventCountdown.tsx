"use client";

import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';

// ─── types ────────────────────────────────────────────────────────────────────

export type CountdownLifecycleState =
  | 'UPCOMING'
  | 'RACE_DAY'
  | 'FINAL_MINUTE'
  | 'OFFICIAL_STARTED'
  | 'WAITING_CHIP'
  | 'CHIP_STARTED'
  | 'LIVE_RACING'
  | 'FINISHED';

interface EventCountdownProps {
  /** Official gun/wave start as a JS Date (or null if unknown). */
  officialStartAt: Date | null;
  /** Athlete chip start as a JS Date (or null for page-level countdown). */
  chipStartAt?: Date | null;
  /** Pre-computed lifecycle state from split model (athlete modal only). */
  splitModelLifecycle?: string | null;
  /** Official race elapsed seconds from split model (athlete modal only). */
  officialRaceTimeSeconds?: number | null;
  /** Chip race elapsed seconds from split model (athlete modal only). */
  chipRaceTimeSeconds?: number | null;
  /** Whether to show the athlete timers panel (chip vs official). */
  showAthleteTimers?: boolean;
  /** Extra class applied to the root card. */
  className?: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number) {
  return String(Math.floor(n)).padStart(2, '0');
}

function hms(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

function formatDayClock(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatFullDate(date: Date) {
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

function formatShortTime(date: Date) {
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).toUpperCase();
}

function useTickingNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function deriveLifecycle(
  nowMs: number,
  officialMs: number | null,
  chipMs: number | null,
  splitModelLifecycle: string | null | undefined,
): CountdownLifecycleState {
  // If the split model already computed the state with live timing data, trust it
  if (splitModelLifecycle) {
    const map: Record<string, CountdownLifecycleState> = {
      UPCOMING: 'UPCOMING',
      OFFICIAL_STARTED_WAITING_CHIP: 'WAITING_CHIP',
      CHIP_STARTED: 'CHIP_STARTED',
      LIVE_RACING: 'LIVE_RACING',
      FINISHED: 'FINISHED',
    };
    if (map[splitModelLifecycle]) return map[splitModelLifecycle];
  }

  if (!officialMs) return 'UPCOMING';

  const diffSec = (officialMs - nowMs) / 1000;
  if (diffSec > 86400) return 'UPCOMING';           // > 1 day away
  if (diffSec > 60) return 'RACE_DAY';              // same day, > 1 min away
  if (diffSec > 0) return 'FINAL_MINUTE';            // < 1 min away
  if (!chipMs) return 'OFFICIAL_STARTED';            // race started, no chip yet (page-level)
  return 'LIVE_RACING';
}

// ─── sub-renders ──────────────────────────────────────────────────────────────

function Chip({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center rounded-xl border px-4 py-3 min-w-[64px]',
      accent
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
        : 'border-white/10 bg-white/5 text-slate-100',
    )}>
      <div className="font-mono text-xl font-black tabular-nums sm:text-2xl">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  );
}

function TimerBlock({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
      <div className="font-mono text-2xl font-black tabular-nums text-white sm:text-3xl">{value}</div>
      {sublabel ? <div className="text-[10px] text-slate-500">{sublabel}</div> : null}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function EventCountdown({
  officialStartAt,
  chipStartAt,
  splitModelLifecycle,
  officialRaceTimeSeconds,
  chipRaceTimeSeconds,
  showAthleteTimers = false,
  className,
}: EventCountdownProps) {
  const nowMs = useTickingNow();

  const officialMs = officialStartAt ? officialStartAt.getTime() : null;
  const chipMs = chipStartAt ? chipStartAt.getTime() : null;

  const lifecycle = useMemo(
    () => deriveLifecycle(nowMs, officialMs, chipMs, splitModelLifecycle),
    [nowMs, officialMs, chipMs, splitModelLifecycle],
  );

  // computed values
  const remainingMs = officialMs ? Math.max(0, officialMs - nowMs) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);

  const elapsedOfficialSec = useMemo(() => {
    if (typeof officialRaceTimeSeconds === 'number' && officialRaceTimeSeconds > 0) {
      return officialRaceTimeSeconds;
    }
    if (!officialMs) return 0;
    return Math.max(0, Math.floor((nowMs - officialMs) / 1000));
  }, [officialRaceTimeSeconds, officialMs, nowMs]);

  const elapsedChipSec = useMemo(() => {
    if (typeof chipRaceTimeSeconds === 'number' && chipRaceTimeSeconds > 0) {
      return chipRaceTimeSeconds;
    }
    if (!chipMs) return 0;
    return Math.max(0, Math.floor((nowMs - chipMs) / 1000));
  }, [chipRaceTimeSeconds, chipMs, nowMs]);

  // ── FINISHED ────────────────────────────────────────────────────────────────
  if (lifecycle === 'FINISHED') {
    return (
      <div className={cn('rounded-2xl border border-emerald-700/40 bg-emerald-950/30 p-4', className)}>
        <div className="flex items-center gap-2">
          <span className="text-base">🏁</span>
          <span className="text-sm font-black uppercase tracking-widest text-emerald-300">Race Finished</span>
        </div>
        {showAthleteTimers && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <TimerBlock label="Official Race Time" value={hms(elapsedOfficialSec)} />
            <TimerBlock label="Athlete Race Time" value={elapsedChipSec > 0 ? hms(elapsedChipSec) : '—'} />
          </div>
        )}
      </div>
    );
  }

  // ── LIVE RACING ─────────────────────────────────────────────────────────────
  if (lifecycle === 'LIVE_RACING') {
    return (
      <div className={cn('rounded-2xl border border-sky-700/40 bg-sky-950/20 p-4', className)}>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-400" />
          </span>
          <span className="text-sm font-black uppercase tracking-widest text-sky-300">Live Racing</span>
        </div>
        {showAthleteTimers && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <TimerBlock label="Official Race Time" value={hms(elapsedOfficialSec)} />
            <TimerBlock label="Athlete Race Time" value={elapsedChipSec > 0 ? hms(elapsedChipSec) : '00:00:00'} />
          </div>
        )}
        {!showAthleteTimers && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <TimerBlock label="Official Race Time" value={hms(elapsedOfficialSec)} />
          </div>
        )}
      </div>
    );
  }

  // ── CHIP_STARTED / WAITING_CHIP (athlete modal states) ───────────────────
  if (lifecycle === 'CHIP_STARTED' || lifecycle === 'WAITING_CHIP') {
    const waiting = lifecycle === 'WAITING_CHIP';
    const officialCountdownSec = officialMs ? Math.max(0, Math.ceil((officialMs - nowMs) / 1000)) : 0;
    const showOfficialCountdown = waiting && officialCountdownSec > 0;
    return (
      <div className={cn('rounded-2xl border p-4', waiting ? 'border-orange-700/40 bg-orange-950/20' : 'border-sky-700/40 bg-sky-950/20', className)}>
        <div className="flex items-center gap-2">
          <span className="text-base">{waiting ? '⏳' : '🏊'}</span>
          <span className={cn('text-sm font-black uppercase tracking-widest', waiting ? 'text-orange-300' : 'text-sky-300')}>
            {waiting ? 'Waiting for Chip Start' : 'Chip Started'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <TimerBlock label={showOfficialCountdown ? 'Official Start In' : 'Official Race Time'} value={showOfficialCountdown ? hms(officialCountdownSec) : hms(elapsedOfficialSec)} />
          <TimerBlock
            label="Athlete Race Time"
            value={waiting ? '00:00:00' : hms(elapsedChipSec)}
            sublabel={waiting ? 'Waiting for chip start' : undefined}
          />
        </div>
      </div>
    );
  }

  // ── OFFICIAL_STARTED (page-level, no chip info) ──────────────────────────
  if (lifecycle === 'OFFICIAL_STARTED') {
    return (
      <div className={cn('rounded-2xl border border-emerald-700/40 bg-slate-950 p-4', className)}>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <span className="text-sm font-black uppercase tracking-widest text-emerald-300">🏁 Race Started</span>
        </div>
        <div className="mt-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Official Race Time</div>
          <div className="mt-1 font-mono text-3xl font-black tabular-nums text-emerald-300 sm:text-4xl">
            {hms(elapsedOfficialSec)}
          </div>
        </div>
      </div>
    );
  }

  // ── FINAL_MINUTE ────────────────────────────────────────────────────────────
  if (lifecycle === 'FINAL_MINUTE') {
    const isCritical = remainingSec <= 10;
    return (
      <div className={cn('rounded-2xl border p-4', isCritical ? 'border-red-700/60 bg-red-950/30' : 'border-amber-700/40 bg-slate-950', className)}>
        <div className="flex items-center gap-2">
          <span className="text-base">🏁</span>
          <span className={cn('text-sm font-black uppercase tracking-widest', isCritical ? 'text-red-300 animate-pulse' : 'text-amber-300')}>
            Race Starting Soon
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-1">
          <span className={cn('font-mono text-4xl font-black tabular-nums sm:text-5xl', isCritical ? 'text-red-300 animate-pulse' : 'text-amber-300')}>
            {hms(remainingSec)}
          </span>
        </div>
        {officialStartAt && (
          <div className="mt-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-300">Official Start</span>
            {' · '}
            {formatShortTime(officialStartAt)}
            {' · '}
            <span className="font-mono text-slate-300">{formatDayClock(new Date(nowMs))}</span>
            {' now'}
          </div>
        )}
      </div>
    );
  }

  // ── RACE_DAY (same day, > 1 min) ────────────────────────────────────────
  if (lifecycle === 'RACE_DAY') {
    return (
      <div className={cn('rounded-2xl border border-sky-700/40 bg-slate-950 p-4', className)}>
        <div className="flex items-center gap-2">
          <span className="text-base">🏁</span>
          <span className="text-sm font-black uppercase tracking-widest text-sky-300">Event Countdown</span>
        </div>
        <div className="mt-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Race Starts In</div>
          <div className="mt-1 font-mono text-4xl font-black tabular-nums text-white sm:text-5xl">
            {hms(remainingSec)}
          </div>
        </div>
        {officialStartAt && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            <div>
              <span className="font-semibold text-slate-300">Official Start</span>
              {' · '}
              {formatShortTime(officialStartAt)}
            </div>
            <div>
              <span className="font-semibold text-slate-300">Current Time</span>
              {' · '}
              <span className="font-mono text-slate-300">{formatDayClock(new Date(nowMs))}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── UPCOMING (> 24 h away) ──────────────────────────────────────────────
  const days = Math.floor(remainingSec / 86400);
  const hours = Math.floor((remainingSec % 86400) / 3600);
  const minutes = Math.floor((remainingSec % 3600) / 60);
  const seconds = remainingSec % 60;

  if (!officialStartAt) return null;

  return (
    <div className={cn('rounded-2xl border border-slate-700 bg-slate-950 p-4', className)}>
      <div className="flex items-center gap-2">
        <span className="text-base">🏁</span>
        <span className="text-sm font-black uppercase tracking-widest text-slate-300">Event Countdown</span>
      </div>
      <div className="mt-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Race Starts In</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {days > 0 && <Chip label="Days" value={String(days)} />}
          <Chip label="Hours" value={pad2(hours)} />
          <Chip label="Minutes" value={pad2(minutes)} />
          <Chip label="Seconds" value={pad2(seconds)} accent />
        </div>
      </div>
      <div className="mt-3 text-xs text-slate-400">
        <span className="font-semibold text-slate-300">Official Start</span>
        {' · '}
        {formatFullDate(officialStartAt)}
        {' • '}
        {formatShortTime(officialStartAt)}
      </div>
    </div>
  );
}
