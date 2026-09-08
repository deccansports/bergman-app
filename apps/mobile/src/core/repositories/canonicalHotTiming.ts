type Row = Record<string, unknown>;

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}

function text(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function splitIdentity(value: unknown): string | undefined {
  const split = record(value);
  return text(
    split.splitKey ??
      split.key ??
      split.canonicalSplitKey ??
      split.splitUuid ??
      split.providerSplitId,
  );
}

function positiveRank(value: unknown): unknown {
  const parsed = Number(String(value ?? "").replace(/^#/, ""));
  return Number.isFinite(parsed) && parsed > 0 ? value : undefined;
}

function mergeSplitRanking(configuredValue: unknown, hotValue: unknown) {
  const configured = record(configuredValue);
  const hot = record(hotValue);
  const merged = { ...configured, ...hot };
  for (const key of [
    "overallRank",
    "genderRank",
    "ageGroupRank",
    "categoryRank",
    "clubRank",
    "rank",
    "overall",
  ]) {
    merged[key] = positiveRank(hot[key]) ?? positiveRank(configured[key]);
  }
  const compact = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  );
  return Object.keys(compact).length > 0 ? compact : undefined;
}

export function mergeCanonicalSplitsWithHotTiming(input: {
  configuredSplits: unknown[];
  hotSplits: unknown[];
  timingMode?: string;
}): Row[] {
  const timingMode = String(input.timingMode || "CHIP")
    .trim()
    .toUpperCase();
  const hotByKey = new Map(
    input.hotSplits
      .map((value) => [splitIdentity(value), record(value)] as const)
      .filter((entry): entry is [string, Row] => Boolean(entry[0])),
  );

  return input.configuredSplits.map((value) => {
    const configured = record(value);
    const key = splitIdentity(configured);
    const hot = key ? hotByKey.get(key) : undefined;
    if (!hot) return configured;
    const readAt = text(
      hot.readAt ?? hot.acceptedAt ?? hot.detectedAt ?? hot.timestamp,
    );
    const hotStatus = String(
      hot.status ?? hot.timingStatus ?? hot.resultStatus ?? "",
    )
      .trim()
      .toUpperCase();
    const accepted =
      hot.accepted === true ||
      hot.isAccepted === true ||
      ["VALID", "OFFICIAL", "CONFIRMED", "CORRECTED"].includes(hotStatus) ||
      // The compact participant Worker serializes accepted passages as
      // COMPLETED. Require its timestamp as evidence so a presentation-only
      // configured COMPLETED row can never become an accepted timing read.
      (hotStatus === "COMPLETED" && Boolean(readAt));
    const chipSeconds = Number(hot.chipSeconds ?? hot.chipTime);
    const gunSeconds = Number(hot.gunSeconds ?? hot.gunTime);
    const providerElapsed = Number(
      hot.overallElapsedSeconds ?? hot.elapsedSeconds ?? hot.cumulativeSeconds,
    );
    const officialElapsed =
      timingMode === "CHIP" && Number.isFinite(chipSeconds)
        ? chipSeconds
        : timingMode === "GUN" && Number.isFinite(gunSeconds)
          ? gunSeconds
          : Number.isFinite(providerElapsed)
            ? providerElapsed
            : undefined;
    const ranking = mergeSplitRanking(configured.ranking, hot.ranking);
    const overallRank =
      positiveRank(hot.overallRank ?? hot.rank) ??
      positiveRank(configured.overallRank ?? configured.rank) ??
      positiveRank(record(ranking).overallRank ?? record(ranking).rank);

    return {
      ...configured,
      ...hot,
      splitKey: key,
      name:
        text(configured.name ?? configured.displayName) ??
        text(hot.name ?? hot.splitName),
      displayName:
        text(configured.displayName ?? configured.name) ??
        text(hot.splitName ?? hot.name),
      legType: text(configured.legType) ?? text(hot.legType ?? hot.leg),
      order: configured.order ?? hot.order,
      readAt,
      timeOfDay: text(hot.timeOfDay) ?? readAt,
      elapsedSeconds: officialElapsed,
      overallElapsedSeconds: officialElapsed,
      segmentElapsedSeconds:
        hot.segmentElapsedSeconds ?? hot.splitSeconds ?? hot.legTime,
      status: accepted ? "COMPLETED" : configured.status,
      progressStatus: accepted ? "COMPLETED" : configured.progressStatus,
      accepted,
      isAccepted: accepted,
      // Hot participant timing owns accepted timestamps and elapsed values,
      // but a timing-only row commonly carries `ranking: null`. Never let it
      // erase the canonical leaderboard projection already on the snapshot.
      ranking,
      overallRank,
    };
  });
}

export function resolveAcceptedChipStart(input: {
  hotResolved?: unknown;
  hotLive?: unknown;
  hotStartEvidence?: unknown;
  snapshotStartTiming?: unknown;
}): string | undefined {
  const resolved = record(input.hotResolved);
  const live = record(input.hotLive);
  const evidence = record(input.hotStartEvidence);
  const start = record(input.snapshotStartTiming);
  return text(
    resolved.acceptedChipStartAt ??
      resolved.acceptedStartAt ??
      resolved.chipStartAt ??
      live.acceptedStartAt ??
      live.chipStartTimestamp ??
      evidence.acceptedTimestamp ??
      start.chipStartDetectionTime ??
      start.acceptedChipStartTime ??
      start.chipStartTime,
  );
}
