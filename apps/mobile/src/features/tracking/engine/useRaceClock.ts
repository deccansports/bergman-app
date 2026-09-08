import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

import type { ReplaySpeed } from "@/shared/components";
import { useSharedLiveNow } from "@/features/tracking/timing/liveElapsed";

export type RaceClockMode = "live" | "replay";

export type UseRaceClockOptions = {
  mode: RaceClockMode;
  /** Screen focused — live ticking pauses when false (battery friendly). */
  focused?: boolean;
  /** Replay only. */
  playing?: boolean;
  speed?: ReplaySpeed;
  /** Replay clock upper bound (seconds). */
  durationSec?: number;
  /** Live visual interpolation cadence. Official split polling is separate. */
  liveTickMs?: number;
  /** Changes only when a newer official timing anchor replaces the prior one. */
  liveAnchorKey?: string;
  /** Server-derived seconds already elapsed since the current accepted anchor. */
  initialLiveClockSec?: number;
};

const LIVE_TICK_MS = 1000;
const REPLAY_TICK_MS = 250;

/**
 * Drives the tracking clock used by the interpolation engine.
 *
 * - `live`: a monotonic "seconds since anchor" counter advancing 1s at a time
 *   while focused (paused in background/blur and under Reduce Motion).
 * - `replay`: advances by `speed` while playing, clamped to `durationSec`, and
 *   can be scrubbed via `setClockSec`.
 *
 * Returns the current clock plus a setter (for the replay scrubber) so all
 * timing logic stays here rather than in components.
 */
export function useRaceClock({
  mode,
  focused = true,
  playing = false,
  speed = 1,
  durationSec = 0,
  liveTickMs = LIVE_TICK_MS,
  liveAnchorKey,
  initialLiveClockSec = 0,
}: UseRaceClockOptions): {
  clockSec: number;
  setClockSec: (value: number) => void;
} {
  const reducedMotion = useReducedMotion();
  const normalizedInitialLiveClockSec =
    Number.isFinite(initialLiveClockSec) && initialLiveClockSec > 0
      ? initialLiveClockSec
      : 0;
  const [clockSec, setClockSec] = useState(normalizedInitialLiveClockSec);
  const liveEnabled = mode === "live" && focused && !reducedMotion;
  const sharedNowMs = useSharedLiveNow(liveEnabled);
  const liveBaseline = useRef({
    key: `${liveAnchorKey ?? ""}:${normalizedInitialLiveClockSec}`,
    startedAtMs: sharedNowMs,
    initialSeconds: normalizedInitialLiveClockSec,
  });
  const nextLiveKey = `${liveAnchorKey ?? ""}:${normalizedInitialLiveClockSec}`;
  if (liveBaseline.current.key !== nextLiveKey) {
    liveBaseline.current = {
      key: nextLiveKey,
      startedAtMs: sharedNowMs,
      initialSeconds: normalizedInitialLiveClockSec,
    };
  }

  useEffect(() => {
    if (mode === "live") return;

    // replay
    if (!playing) return;
    const step = (speed * REPLAY_TICK_MS) / 1000;
    const id = setInterval(() => {
      setClockSec((c) => {
        const next = c + step;
        return durationSec > 0 && next >= durationSec ? durationSec : next;
      });
    }, REPLAY_TICK_MS);
    return () => clearInterval(id);
  }, [mode, focused, reducedMotion, playing, speed, durationSec, liveTickMs]);

  const sharedLiveSeconds =
    liveBaseline.current.initialSeconds +
    Math.max(0, sharedNowMs - liveBaseline.current.startedAtMs) / 1_000;
  return {
    clockSec: mode === "live" ? sharedLiveSeconds : clockSec,
    setClockSec,
  };
}
