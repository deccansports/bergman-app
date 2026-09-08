import type { TimelineSplit } from "../../../mappers";

function isRaceStart(row: TimelineSplit): boolean {
  const label = String(row.splitLabel || row.name || "")
    .trim()
    .toUpperCase();
  return /^(?:RACE |SWIM )?START$/.test(label);
}

/**
 * Final presentation boundary for Live Split Flow. The mapper normally
 * supplies an already-progressive array; this guard prevents a malformed or
 * legacy caller from expanding configured future checkpoints in the table.
 */
export function selectProgressiveSplitTableRows(
  splits: readonly TimelineSplit[] | null | undefined,
  options: { notStarted?: boolean; finished?: boolean } = {},
): TimelineSplit[] {
  if (!Array.isArray(splits) || splits.length === 0) return [];

  if (options.finished) {
    const accepted = splits.filter((row) => row.state === "completed");
    return accepted.length === splits.length
      ? (splits as TimelineSplit[])
      : accepted;
  }

  if (options.notStarted) {
    const start = splits.find(isRaceStart);
    if (!start) return [];
    const presentationStart =
      start.state === "upcoming" && start.expected !== true
        ? start
        : { ...start, state: "upcoming" as const, expected: false };
    return [presentationStart];
  }

  const accepted = splits.filter((row) => row.state === "completed");
  const next = splits.find(
    (row) => row.state === "current" || row.expected === true,
  );
  const visible =
    next && !accepted.includes(next) ? [...accepted, next] : accepted;
  if (
    visible.length === splits.length &&
    visible.every((row, index) => row === splits[index])
  ) {
    return splits as TimelineSplit[];
  }
  return visible;
}

export function buildLiveSplitTableDiagnostic(
  splits: readonly TimelineSplit[],
  context: {
    participantUuid?: string;
    canonicalVersion?: string;
    status?: string;
  },
) {
  return {
    participantUuid: context.participantUuid || null,
    canonicalVersion: context.canonicalVersion || null,
    status: context.status || "live",
    source: "progressive_timeline" as const,
    rowCount: splits.length,
    rows: splits.map((row, sequence) => ({
      splitKey: row.key,
      label: row.splitLabel || row.name,
      accepted: row.state === "completed",
      awaiting: row.state !== "completed",
      sequence,
    })),
  };
}
