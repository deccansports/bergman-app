import type { AthleteModalResponse } from "@/core/types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasAcceptedTerminalTiming(value: AthleteModalResponse): boolean {
  const live = record(value.participantLive);
  const resolved = record(live.resolvedRaceState);
  const rows = [
    ...(Array.isArray(resolved.splits) ? resolved.splits : []),
    ...(Array.isArray(live.splits) ? live.splits : []),
    ...(Array.isArray(value.athlete?.splits) ? value.athlete.splits : []),
  ];
  return rows.some((item) => {
    const row = record(item);
    const status = String(
      row.progressStatus ?? row.status ?? row.timingStatus ?? "",
    ).toUpperCase();
    const accepted =
      row.accepted === true ||
      row.isAccepted === true ||
      row.valid === true ||
      ["ACCEPTED", "COMPLETED", "OFFICIAL", "VALID"].includes(status);
    const key = String(
      row.splitKey ?? row.canonicalSplitKey ?? row.key ?? row.name ?? "",
    )
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return (
      accepted &&
      (key === "finish" ||
        key.includes("racefinish") ||
        key.includes("runfinish"))
    );
  });
}

export function mergeAthleteOnlySnapshot(
  full: AthleteModalResponse,
  refresh: AthleteModalResponse,
): AthleteModalResponse {
  const fullLive = record(full.participantLive);
  const refreshLive = record(refresh.participantLive);
  const fullResolved = record(fullLive.resolvedRaceState);
  const refreshResolved = record(refreshLive.resolvedRaceState);
  const merged: AthleteModalResponse = {
    ...full,
    ...refresh,
    athlete: {
      ...full.athlete,
      ...refresh.athlete,
      splits: Array.isArray(refresh.athlete?.splits)
        ? refresh.athlete.splits
        : full.athlete.splits,
      summary: refresh.athlete?.summary ?? full.athlete.summary,
    },
    result: refresh.result ?? full.result,
    participantLive: {
      ...fullLive,
      ...refreshLive,
      resolvedRaceState: {
        ...fullResolved,
        ...refreshResolved,
        splits: Array.isArray(refreshResolved.splits)
          ? refreshResolved.splits
          : fullResolved.splits,
      },
    },
    contestContext: full.contestContext,
    contestDefinition: full.contestDefinition,
    timingConfiguration: full.timingConfiguration,
    courseIndex: full.courseIndex,
    activeVersion: refresh.activeVersion ?? full.activeVersion,
    courseVersion: refresh.courseVersion ?? full.courseVersion,
  };
  if (!hasAcceptedTerminalTiming(merged)) return merged;

  // Once an accepted terminal read is present, stale predictive fields from
  // an older full response must not survive structural sharing.
  merged.athlete = {
    ...merged.athlete,
    estimatedFinish: undefined,
    prediction: null,
  };
  merged.participantLive = {
    ...merged.participantLive,
    etaNextSplit: undefined,
    etaNextSplitCountdownSec: undefined,
    etaFinishClock: undefined,
    estimatedFinishTime: undefined,
    predictedPaceSecondsPerKm: undefined,
  };
  merged.nextSplitPrediction = undefined;
  return merged;
}
