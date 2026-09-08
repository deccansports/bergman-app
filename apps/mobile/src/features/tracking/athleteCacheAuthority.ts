type AthleteStateRecord = Record<string, unknown>;

function normalizedRaceState(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function raceStateRank(value: unknown): number {
  const state = normalizedRaceState(value);
  if (/FINISH|COMPLETE/.test(state)) return 3;
  if (/ACTIVE|ON_COURSE|SWIM|BIKE|RUN|TRANSITION/.test(state)) return 2;
  if (/NOT_STARTED|REGISTERED|READY|WAITING/.test(state)) return 1;
  return 0;
}

function stateOf(value: AthleteStateRecord): unknown {
  return value.raceState ?? value.status ?? value.lifecycleStatus;
}

/**
 * Lightweight/socket summaries may enrich a participant, but cannot erase
 * stronger accepted progress already held for that same canonical identity.
 */
export function mergeAthleteStateWithoutRegression<
  T extends AthleteStateRecord,
>(current: T, incoming: AthleteStateRecord): T {
  const currentRank = raceStateRank(stateOf(current));
  const incomingRank = raceStateRank(stateOf(incoming));
  const currentProgress = Number(current.progressPercent);
  const incomingProgress = Number(incoming.progressPercent);
  const stateRegressed = currentRank > 0 && incomingRank < currentRank;
  const progressRegressed =
    Number.isFinite(currentProgress) &&
    (!Number.isFinite(incomingProgress) || incomingProgress < currentProgress);
  const currentParticipantUuid = String(current.participantUuid ?? "").trim();
  const incomingParticipantUuid = String(incoming.participantUuid ?? "").trim();
  const identityRegressed = Boolean(
    currentParticipantUuid &&
    (!incomingParticipantUuid ||
      incomingParticipantUuid !== currentParticipantUuid),
  );
  if (!stateRegressed && !progressRegressed && !identityRegressed) {
    return { ...current, ...incoming } as T;
  }
  const protectedFields = {
    status: current.status,
    raceState: current.raceState,
    lifecycleStatus: current.lifecycleStatus,
    currentLeg: current.currentLeg,
    currentSplit: current.currentSplit,
    latestSplit: current.latestSplit,
    latestSplitTime: current.latestSplitTime,
    elapsedTime: current.elapsedTime,
    progressPercent: current.progressPercent,
    acceptedSplitCount: current.acceptedSplitCount,
    latestAcceptedSplitKey: current.latestAcceptedSplitKey,
    latestAcceptedSequence: current.latestAcceptedSequence,
    participantUuid: current.participantUuid,
    providerEventUuid: current.providerEventUuid,
    providerContestUuid: current.providerContestUuid,
    canonicalContestUuid: current.canonicalContestUuid,
    contestUuid: current.contestUuid,
    contestId: current.contestId,
    courseIdentity: current.courseIdentity,
    courseVersion: current.courseVersion,
    result: current.result,
    finishAt: current.finishAt,
    finishTime: current.finishTime,
  };
  return Object.fromEntries(
    Object.entries({ ...current, ...incoming, ...protectedFields }).filter(
      ([, value]) => value !== undefined,
    ),
  ) as T;
}
