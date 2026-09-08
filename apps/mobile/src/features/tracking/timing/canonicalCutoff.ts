export type CanonicalCutoffRuntime = {
  deadlineAt: number;
  checkpointLabel: string;
  state: "UPCOMING" | "SAFE" | "AT_RISK" | "MISSED" | "CONFIRMED_CUTOFF";
};

export const CUTOFF_MAT_GRACE_SECONDS = 120;

function clock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return [Math.floor(safe / 3_600), Math.floor((safe % 3_600) / 60), safe % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

/**
 * Mirror the canonical auto-cutoff boundary locally so a stale network payload
 * cannot leave the card "ON COURSE" after the configured mat grace expires.
 * The deadline and grace are canonical inputs; this helper never changes them.
 */
export function resolveCanonicalCutoffPresentation(
  cutoff: CanonicalCutoffRuntime | undefined,
  serverCorrectedNowMs: number,
): {
  remainingSeconds: number | null;
  label: string | null;
  confirmed: boolean;
} {
  if (!cutoff) return { remainingSeconds: null, label: null, confirmed: false };
  const remainingSeconds = Math.floor(
    (cutoff.deadlineAt - serverCorrectedNowMs) / 1_000,
  );
  if (cutoff.state === "CONFIRMED_CUTOFF") {
    return { remainingSeconds, label: "CUTOFF", confirmed: true };
  }
  if (remainingSeconds <= 0) {
    const graceRemainingSeconds = CUTOFF_MAT_GRACE_SECONDS + remainingSeconds;
    if (graceRemainingSeconds > 0) {
      return {
        remainingSeconds,
        label: `MAT GRACE ${clock(graceRemainingSeconds)}`,
        confirmed: false,
      };
    }
    return { remainingSeconds, label: "CUTOFF", confirmed: true };
  }
  return {
    remainingSeconds,
    label: `CUTOFF IN ${clock(remainingSeconds)}`,
    confirmed: false,
  };
}
