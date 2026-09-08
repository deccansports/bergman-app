export type AuthTimingStage =
  | "AUTH_RESTORE_START"
  | "AUTH_RESTORE_COMPLETE"
  | "TOKEN_READY"
  | "AUTHENTICATED_STATE_SET"
  | "LOGIN_OVERLAY_HIDDEN";

type AuthTimeline = {
  flowId: number;
  reason: string;
  startedAt: number;
  previousAt: number;
  seenStages: Set<AuthTimingStage>;
};

let flowSequence = 0;
let activeTimeline: AuthTimeline | null = null;
let authenticatedAt: number | null = null;

function nowMs(): number {
  return Date.now();
}

export function beginAuthTimeline(
  reason: "cold_start" | "login" | "restore_fallback",
  details: Record<string, unknown> = {},
) {
  const now = nowMs();
  if (!activeTimeline || reason === "login") {
    flowSequence += 1;
    activeTimeline = {
      flowId: flowSequence,
      reason,
      startedAt: now,
      previousAt: now,
      seenStages: new Set<AuthTimingStage>(),
    };
  }
  logAuthTiming("AUTH_RESTORE_START", {
    ...details,
    reason,
    reusedFlow: activeTimeline.startedAt !== now,
  });
  return activeTimeline.flowId;
}

export function logAuthTiming(
  stage: AuthTimingStage,
  details: Record<string, unknown> = {},
) {
  if (!activeTimeline) {
    flowSequence += 1;
    const now = nowMs();
    activeTimeline = {
      flowId: flowSequence,
      reason: "implicit",
      startedAt: now,
      previousAt: now,
      seenStages: new Set<AuthTimingStage>(),
    };
  }
  if (stage !== "AUTH_RESTORE_START" && activeTimeline.seenStages.has(stage)) {
    return;
  }
  activeTimeline.seenStages.add(stage);
  const now = nowMs();
  const elapsedMs = Math.max(0, now - activeTimeline.startedAt);
  const sincePreviousStageMs = Math.max(0, now - activeTimeline.previousAt);
  activeTimeline.previousAt = now;
  if (stage === "AUTHENTICATED_STATE_SET") authenticatedAt = now;
  if (process.env.NODE_ENV !== "production") {
    console.info(stage, {
      flowId: activeTimeline.flowId,
      flowReason: activeTimeline.reason,
      elapsedMs,
      sincePreviousStageMs,
      at: new Date(now).toISOString(),
      ...details,
    });
  }
}

export function authAuthenticatedAt(): number | null {
  return authenticatedAt;
}

export function logDashboardTiming(
  stage: "DASHBOARD_FETCH_START" | "DASHBOARD_FETCH_COMPLETE",
  startedAt: number,
  details: Record<string, unknown> = {},
) {
  if (process.env.NODE_ENV === "production") return;
  const now = nowMs();
  console.info(stage, {
    elapsedMs: Math.max(0, now - startedAt),
    sinceAuthenticatedMs:
      authenticatedAt === null ? null : Math.max(0, now - authenticatedAt),
    at: new Date(now).toISOString(),
    ...details,
  });
}

export function resetAuthDiagnosticsForLogout() {
  activeTimeline = null;
  authenticatedAt = null;
}
