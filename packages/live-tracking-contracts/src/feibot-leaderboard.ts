export type FeibotLiveLeaderboardRow = {
  providerParticipantUuid: string;
  bib: string;
  displayName: string;
  nation: string | null;
  team: string | null;
  rank: number | null;
  chipTime: string | null;
  gunTime: string | null;
  gender: 'female' | 'male';
};

export type FeibotLiveLeaderboard = {
  configKey: string;
  providerContestUuid: string;
  contestName: string;
  providerSplitUuid: string;
  splitName: string;
  splitDistance: number | null;
  splitResultField: string | null;
  states: string | null;
  updatedAt: string | null;
  rows: FeibotLiveLeaderboardRow[];
};

export type NormalizedFeibotLeaderboardResponse = {
  providerEventUuid: string;
  leaderboards: FeibotLiveLeaderboard[];
  configCount: number;
  maleRows: number;
  femaleRows: number;
  totalRows: number;
  updatedAt: string | null;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function optionalText(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function configRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    : [];
}

function normalizeRow(row: Record<string, unknown>, gender: 'female' | 'male'): FeibotLiveLeaderboardRow {
  return {
    providerParticipantUuid: text(row.UUID ?? row.uuid ?? row.athlete_id ?? row.athleteId),
    bib: text(row.Bib ?? row.bib ?? row.bibNumber),
    displayName: text(row.Name ?? row.name),
    nation: optionalText(row.Nation ?? row.nation),
    team: optionalText(row.Team ?? row.team),
    rank: finiteNumber(row.Rank ?? row.rank),
    chipTime: optionalText(row.ChipTimeFromStartFormated ?? row.chipTimeFromStartFormatted ?? row.chipTime),
    gunTime: optionalText(row.GunTimeFromStartFormated ?? row.gunTimeFromStartFormatted ?? row.gunTime),
    gender,
  };
}

/**
 * Normalizes Feibot's leaderboardQuery response without combining configs.
 * Each config identifies a distinct contest/split ranking and retains the
 * provider-supplied rank. Missing gender arrays are intentionally empty.
 */
export function normalizeFeibotLeaderboardPayload(
  payload: unknown,
  requestedProviderEventUuid = '',
): NormalizedFeibotLeaderboardResponse {
  const root = payload && typeof payload === 'object' ? payload as Record<string, any> : {};
  const configs = configRows(root.leaderboard ?? root.data?.leaderboard);
  let maleRows = 0;
  let femaleRows = 0;

  const leaderboards = configs.map((entry) => {
    const config = entry.config && typeof entry.config === 'object'
      ? entry.config as Record<string, unknown>
      : {};
    const data = entry.data && typeof entry.data === 'object'
      ? entry.data as Record<string, unknown>
      : {};
    const female = configRows(data.leaderBoard_female).map((row) => normalizeRow(row, 'female'));
    const male = configRows(data.leaderBoard_male).map((row) => normalizeRow(row, 'male'));
    femaleRows += female.length;
    maleRows += male.length;
    return {
      configKey: text(entry.configKey),
      providerContestUuid: text(config.contest),
      contestName: text(config.contestName),
      providerSplitUuid: text(config.split),
      splitName: text(config.splitName),
      splitDistance: finiteNumber(config.splitDistance),
      splitResultField: optionalText(config.splitResultField),
      states: optionalText(config.states),
      updatedAt: optionalText(entry.updatedAt),
      rows: [...female, ...male],
    } satisfies FeibotLiveLeaderboard;
  });

  const updatedAt = leaderboards
    .map((entry) => entry.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    providerEventUuid: text(root.event_uuid ?? root.eventUuid ?? requestedProviderEventUuid),
    leaderboards,
    configCount: leaderboards.length,
    maleRows,
    femaleRows,
    totalRows: maleRows + femaleRows,
    updatedAt,
  };
}

export function countFeibotLeaderboardRows(payload: unknown): number {
  return normalizeFeibotLeaderboardPayload(payload).totalRows;
}

export function createLeaderboardSingleFlight<T>(ttlMs: number, now: () => number = Date.now) {
  const recent = new Map<string, { expiresAt: number; value: T }>();
  const inFlight = new Map<string, Promise<T>>();
  return {
    async get(key: string, loader: () => Promise<T>): Promise<{ value: T; cacheHit: boolean }> {
      const cached = recent.get(key);
      if (cached && cached.expiresAt > now()) return { value: cached.value, cacheHit: true };
      const pending = inFlight.get(key);
      if (pending) return { value: await pending, cacheHit: true };
      const promise = loader();
      inFlight.set(key, promise);
      try {
        const value = await promise;
        recent.set(key, { expiresAt: now() + Math.max(0, ttlMs), value });
        return { value, cacheHit: false };
      } finally {
        inFlight.delete(key);
      }
    },
    clear() {
      recent.clear();
      inFlight.clear();
    },
  };
}
