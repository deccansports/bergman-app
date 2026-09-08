export type LeaderboardSplitColumn = {
  key: string;
  label: string;
  order: number;
  transitionFromKey?: string;
  transitionToKey?: string;
  transitionFromLabel?: string;
  transitionToLabel?: string;
};

export type RankedLeaderboardSplitRow = {
  row: Record<string, unknown>;
  split?: Record<string, unknown>;
  elapsedSeconds: number;
  rank: number;
  previousRank: number | null;
  positionDelta: number | null;
};

const text = (value: unknown) => String(value ?? "").trim();
const normalized = (value: unknown) => text(value).toLowerCase();

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object",
      )
    : [];
}

export function leaderboardSplitKey(row: Record<string, unknown>): string {
  return normalized(
    row.key ??
      row.splitKey ??
      row.canonicalCode ??
      row.splitUuid ??
      row.uuid ??
      row.id ??
      row.displayName ??
      row.name ??
      row.label,
  );
}

export function leaderboardSplitLabel(row: Record<string, unknown>): string {
  return text(
    row.splitName ??
      row.displayName ??
      row.name ??
      row.label ??
      row.timingPointName ??
      "Split",
  );
}

function seconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  const candidate = text(value);
  if (!candidate) return null;
  if (/^\d+(?:\.\d+)?$/.test(candidate)) return Number(candidate);
  const parts = candidate.split(":").map(Number);
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((part) => !Number.isFinite(part))
  ) {
    return null;
  }
  const [hours, minutes, remainder] =
    parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return hours * 3600 + minutes * 60 + remainder;
}

export function leaderboardSplitElapsedSeconds(
  split: Record<string, unknown>,
): number | null {
  for (const value of [
    split.cumulativeElapsedSeconds,
    split.cumulativeTimeSeconds,
    split.raceTimeSeconds,
    split.elapsedSeconds,
    split.cumulativeElapsedTime,
    split.cumulativeTime,
    split.raceTime,
    split.elapsedTime,
    split.timeSec,
    split.time,
  ]) {
    const parsed = seconds(value);
    if (parsed != null) return parsed;
  }
  return null;
}

export function isAcceptedLeaderboardSplit(
  split: Record<string, unknown>,
): boolean {
  const acceptedTimestamp = text(
    split.readAt ??
      split.acceptedAt ??
      split.acceptedTimestamp ??
      split.absoluteTimestamp ??
      split.timestamp ??
      split.timeOfDay,
  );
  const acceptedStatus = normalized(
    split.status ?? split.decision ?? split.timingStatus,
  );
  return (
    leaderboardSplitElapsedSeconds(split) != null &&
    (Boolean(acceptedTimestamp) ||
      split.accepted === true ||
      acceptedStatus === "accepted")
  );
}

export function leaderboardRowSplits(
  row: Record<string, unknown>,
): Record<string, unknown>[] {
  const result =
    row.result && typeof row.result === "object"
      ? (row.result as Record<string, unknown>)
      : undefined;
  return records(row.splits ?? result?.splits);
}

function semanticColumnKey(column: LeaderboardSplitColumn): string {
  return (
    normalized(column.label)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || column.key
  );
}

export function buildLeaderboardSplitColumns(
  configuredSplits: Record<string, unknown>[],
  leaderboardRows: Record<string, unknown>[],
): LeaderboardSplitColumn[] {
  const candidates = [
    ...configuredSplits.map((split, index) => ({
      key: leaderboardSplitKey(split),
      label: leaderboardSplitLabel(split),
      order: Number(split.order ?? index + 1),
    })),
    ...leaderboardRows.flatMap((row) =>
      leaderboardRowSplits(row).map((split, index) => ({
        key: leaderboardSplitKey(split),
        label: leaderboardSplitLabel(split),
        order: Number(split.order ?? index + 1),
      })),
    ),
  ];
  const unique = new Map<string, LeaderboardSplitColumn>();
  for (const candidate of candidates) {
    if (!candidate.key) continue;
    const identity = semanticColumnKey(candidate);
    if (!unique.has(identity)) unique.set(identity, candidate);
  }
  const ordered = [...unique.values()].sort(
    (left, right) =>
      left.order - right.order || left.label.localeCompare(right.label),
  );
  const boundary = (label: string) =>
    ordered.find(
      (column) => normalized(column.label).replace(/[_-]+/g, " ") === label,
    );
  const withTransitions = [...ordered];
  const addTransition = (
    key: string,
    label: string,
    from: LeaderboardSplitColumn | undefined,
    to: LeaderboardSplitColumn | undefined,
  ) => {
    if (!from || !to) return;
    withTransitions.push({
      key,
      label,
      order: (from.order + to.order) / 2,
      transitionFromKey: from.key,
      transitionToKey: to.key,
      transitionFromLabel: from.label,
      transitionToLabel: to.label,
    });
  };
  addTransition(
    "transition:t1",
    "T1",
    boundary("swim finish"),
    boundary("bike start"),
  );
  addTransition(
    "transition:t2",
    "T2",
    boundary("bike finish"),
    boundary("run start"),
  );
  return withTransitions.sort(
    (left, right) =>
      left.order - right.order || left.label.localeCompare(right.label),
  );
}

function rowIdentity(row: Record<string, unknown>): string {
  return text(
    row.participantUuid ??
      row.providerParticipantUuid ??
      row.athleteId ??
      row.bib ??
      row.bibNumber,
  );
}

function rowMatchesScope(
  row: Record<string, unknown>,
  providerEventUuid?: string,
  contestUuid?: string,
): boolean {
  const participantUuid = text(row.participantUuid);
  const participantProvider = participantUuid.match(/^race:([^:]+):/i)?.[1];
  const rowProvider = normalized(
    row.providerEventUuid ?? row.feibotEventUuid ?? participantProvider,
  );
  const rowContest = normalized(
    row.providerContestUuid ?? row.contestUuid ?? row.canonicalContestUuid,
  );
  return (
    (!providerEventUuid ||
      !rowProvider ||
      rowProvider === normalized(providerEventUuid)) &&
    (!contestUuid || !rowContest || rowContest === normalized(contestUuid))
  );
}

function matchingSplit(
  row: Record<string, unknown>,
  key: string | undefined,
  label: string | undefined,
) {
  return leaderboardRowSplits(row).find(
    (split) =>
      (key && leaderboardSplitKey(split) === normalized(key)) ||
      (label && normalized(leaderboardSplitLabel(split)) === normalized(label)),
  );
}

export function rankLeaderboardRowsAtSplit(
  rows: Record<string, unknown>[],
  column: LeaderboardSplitColumn,
  scope: { providerEventUuid?: string; contestUuid?: string } = {},
): RankedLeaderboardSplitRow[] {
  const scopedRows = rows.filter((row) =>
    rowMatchesScope(row, scope.providerEventUuid, scope.contestUuid),
  );
  const previousRanks = new Map<string, number>();
  if (column.transitionFromKey) {
    scopedRows
      .flatMap((row) => {
        const from = matchingSplit(
          row,
          column.transitionFromKey,
          column.transitionFromLabel,
        );
        const elapsed =
          from && isAcceptedLeaderboardSplit(from)
            ? leaderboardSplitElapsedSeconds(from)
            : null;
        const identity = rowIdentity(row);
        return elapsed == null || !identity ? [] : [{ identity, elapsed }];
      })
      .sort((left, right) => left.elapsed - right.elapsed)
      .forEach((entry, index) => previousRanks.set(entry.identity, index + 1));
  }

  return scopedRows
    .flatMap((row) => {
      const split = matchingSplit(row, column.key, column.label);
      const from = column.transitionFromKey
        ? matchingSplit(
            row,
            column.transitionFromKey,
            column.transitionFromLabel,
          )
        : undefined;
      const to = column.transitionToKey
        ? matchingSplit(row, column.transitionToKey, column.transitionToLabel)
        : undefined;
      let elapsed: number | null = null;
      if (column.transitionFromKey) {
        const fromSeconds =
          from && isAcceptedLeaderboardSplit(from)
            ? leaderboardSplitElapsedSeconds(from)
            : null;
        const toSeconds =
          to && isAcceptedLeaderboardSplit(to)
            ? leaderboardSplitElapsedSeconds(to)
            : null;
        elapsed =
          fromSeconds != null && toSeconds != null && toSeconds >= fromSeconds
            ? toSeconds - fromSeconds
            : null;
      } else if (split && isAcceptedLeaderboardSplit(split)) {
        elapsed = leaderboardSplitElapsedSeconds(split);
      }
      return elapsed == null ? [] : [{ row, split, elapsed }];
    })
    .sort((left, right) => left.elapsed - right.elapsed)
    .map((entry, index) => {
      const previousRank = previousRanks.get(rowIdentity(entry.row)) ?? null;
      const rank = index + 1;
      return {
        row: entry.row,
        split: entry.split,
        elapsedSeconds: entry.elapsed,
        rank,
        previousRank,
        positionDelta:
          previousRank == null ? null : previousRank - rank || null,
      };
    });
}
