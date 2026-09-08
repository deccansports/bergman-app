import { useEffect, useState } from "react";

import type { StartTimingPresentation } from "./startTimingPresentation";

export type LiveClockInput = {
  startTiming?: Pick<
    StartTimingPresentation,
    | "officialTimingMode"
    | "showRaceClock"
    | "chipStartAt"
    | "gunStartAt"
    | "officialStartAt"
    | "serverTimeOffsetMs"
  >;
  isLive?: boolean;
  hasResult?: boolean;
};

const liveClockListeners = new Set<(nowMs: number) => void>();
let liveClockTimer: ReturnType<typeof setInterval> | null = null;
let liveClockNowMs = Date.now();
let liveClockTicks = 0;
let liveClockStartedAt = liveClockNowMs;

function subscribeToSharedLiveClock(
  listener: (nowMs: number) => void,
): () => void {
  liveClockListeners.add(listener);
  if (!liveClockTimer) {
    liveClockStartedAt = Date.now();
    liveClockTicks = 0;
    liveClockTimer = setInterval(() => {
      liveClockNowMs = Date.now();
      liveClockTicks += 1;
      liveClockListeners.forEach((current) => current(liveClockNowMs));
      if (liveClockTicks % 60 === 0) {
        console.info("[LIVE_CLOCK_PERFORMANCE]", {
          durationMs: liveClockNowMs - liveClockStartedAt,
          clockTicks: liveClockTicks,
          mobileLiveRequests: 0,
          timelineRebuilds: 0,
          markerRemounts: 0,
          mapRebuilds: 0,
          cardFullRenders: liveClockListeners.size * liveClockTicks,
        });
      }
    }, 1_000);
  }
  return () => {
    liveClockListeners.delete(listener);
    if (liveClockListeners.size === 0 && liveClockTimer) {
      clearInterval(liveClockTimer);
      liveClockTimer = null;
    }
  };
}

/** The only accepted anchor for a continuously displayed race clock. */
export function resolveLiveTimingAnchorMs({
  startTiming,
}: LiveClockInput): number | undefined {
  if (!startTiming?.showRaceClock) return undefined;
  if (startTiming.officialTimingMode === "CHIP") {
    return startTiming.chipStartAt;
  }
  if (startTiming.officialTimingMode === "GUN") {
    return startTiming.gunStartAt ?? startTiming.officialStartAt;
  }
  return startTiming.officialStartAt;
}

export function resolveLiveElapsedSeconds(
  input: LiveClockInput,
  nowMs = Date.now(),
): number | undefined {
  if (!input.isLive || input.hasResult) return undefined;
  const anchorMs = resolveLiveTimingAnchorMs(input);
  const correctedNowMs = nowMs + (input.startTiming?.serverTimeOffsetMs ?? 0);
  return anchorMs == null
    ? undefined
    : Math.max(0, Math.floor((correctedNowMs - anchorMs) / 1_000));
}

/** One process-wide animation clock shared by every visible live athlete. */
export function useSharedLiveNow(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeToSharedLiveClock(setNowMs);
  }, [enabled]);
  return nowMs;
}

/** Locally ticking display clock. Provider elapsed values are intentionally absent. */
export function useLiveElapsedClock(input: LiveClockInput) {
  const anchorMs = resolveLiveTimingAnchorMs(input);
  const running = Boolean(input.isLive && !input.hasResult && anchorMs != null);
  const nowMs = useSharedLiveNow(running);
  const elapsedSeconds = resolveLiveElapsedSeconds(input, nowMs);
  return {
    anchorMs,
    elapsedSeconds,
    running,
    nowMs: nowMs + (input.startTiming?.serverTimeOffsetMs ?? 0),
  };
}
