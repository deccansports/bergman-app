import type { LiveAthlete } from '@/lib/types';
import type { ResolvedTimingConfiguration } from '@/lib/timingConfiguration';
import { normalizeStatus } from '@/lib/utils';
import { predictionConfidenceLevel, predictionStatusLabel, type PredictionSourceKind } from './predictionConfidence';
import { resolveLegPredictionModel } from './predictionModels';
import { smoothEta, countdownToEta } from './predictionEta';
import { clampPredictedDistance, shouldFreezePrediction } from './predictionInterpolation';

type ContestSplitProjection = {
  uuid: string;
  label: string;
  distanceKm: number;
  order: number;
};

type PredictionState = {
  distanceKm: number | null;
  etaNextSplitUtc: number | null;
  etaFinishUtc: number | null;
  lastOfficialToken: string | null;
};

const predictionStateByAthlete = new Map<string, PredictionState>();

function athleteStateKey(athlete: LiveAthlete) {
  const bib = String((athlete as any)?.bib || '').trim();
  const contest = String((athlete as any)?.contestUuid || (athlete as any)?.contest_uuid || (athlete as any)?.contestName || '').trim().toLowerCase();
  const participantUuid = String((athlete as any)?.participantUuid || (athlete as any)?.participant_uuid || '').trim().toLowerCase();
  const athleteUid = String((athlete as any)?.athleteUid || '').trim().toLowerCase();
  return [participantUuid, athleteUid, `${bib}|${contest}`, String((athlete as any)?.id || '').trim()].find(Boolean) || `unknown:${Math.random()}`;
}

function toNum(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toUnixSeconds(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed > 1e12 ? Math.floor(parsed / 1000) : Math.floor(parsed);
}

function computeMedian(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function normalizeContestSplitProjection(row: any, fallbackOrder: number): ContestSplitProjection | null {
  const distanceKm = toNum(row?.distanceKm ?? row?.distance_km ?? row?.distance ?? row?.cumulativeDistanceKm ?? row?.cumulative_distance_km ?? row?.km);
  if (distanceKm === null || distanceKm < 0) return null;
  const order = toNum(row?.order ?? row?.sequence ?? row?.position ?? row?.index) ?? fallbackOrder;
  const label = String(row?.splitName || row?.displayName || row?.name || row?.label || row?.shortName || row?.code || `Split ${fallbackOrder + 1}`).trim();
  const uuid = String(row?.splitUuid || row?.uuid || row?.UUID || row?.id || label || `split-${fallbackOrder + 1}`).trim().toLowerCase();
  return { uuid: uuid || `split-${fallbackOrder + 1}`, label: label || `Split ${fallbackOrder + 1}`, distanceKm, order };
}

function getContestKeysFromRow(row: any) {
  return [row?.contestUuid, row?.contest_uuid, row?.contestId, row?.contest_id, row?.contestName, row?.contest_name, row?.category]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function buildContestSplitIndex(timingConfiguration: ResolvedTimingConfiguration | null) {
  const index = new Map<string, ContestSplitProjection[]>();
  if (!timingConfiguration) return index;

  const appendToContest = (contestKey: string, splitRow: any, fallbackOrder: number) => {
    const key = String(contestKey || '').trim().toLowerCase();
    if (!key) return;
    const projection = normalizeContestSplitProjection(splitRow, fallbackOrder);
    if (!projection) return;
    const current = index.get(key) || [];
    current.push(projection);
    index.set(key, current);
  };

  const appendSplitRows = (rows: any[], explicitContestKey?: string) => {
    rows.forEach((row: any, rowIndex: number) => {
      const keys = explicitContestKey ? [explicitContestKey] : getContestKeysFromRow(row);
      keys.forEach((key) => appendToContest(key, row, rowIndex));
    });
  };

  if (timingConfiguration?.splitsByContest && typeof timingConfiguration.splitsByContest === 'object') {
    Object.entries(timingConfiguration.splitsByContest).forEach(([contestKey, rows]) => {
      if (Array.isArray(rows)) appendSplitRows(rows, contestKey);
    });
  }

  if (Array.isArray(timingConfiguration?.splits)) {
    appendSplitRows(timingConfiguration.splits);
  }

  index.forEach((rows, key) => {
    const deduped = new Map<string, ContestSplitProjection>();
    rows.forEach((row) => {
      const dedupeKey = `${row.uuid}|${row.distanceKm.toFixed(3)}|${row.label.toLowerCase()}`;
      if (!deduped.has(dedupeKey)) deduped.set(dedupeKey, row);
    });
    index.set(
      key,
      Array.from(deduped.values()).sort((a, b) => {
        if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
        if (a.order !== b.order) return a.order - b.order;
        return a.label.localeCompare(b.label);
      }),
    );
  });

  return index;
}

function getContestSplitsForAthlete(athlete: LiveAthlete, timingConfiguration: ResolvedTimingConfiguration | null) {
  const contestSplitIndex = buildContestSplitIndex(timingConfiguration);
  const keys = [
    (athlete as any)?.contestUuid,
    (athlete as any)?.contest_uuid,
    (athlete as any)?.providerContestUuid,
    (athlete as any)?.contestName,
    (athlete as any)?.contest_name,
    (athlete as any)?.category,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);

  for (const key of keys) {
    const rows = contestSplitIndex.get(key);
    if (rows && rows.length > 0) return rows;
  }
  return [] as ContestSplitProjection[];
}

function detectGps(athlete: LiveAthlete, nowSec: number) {
  const lat = toNum((athlete as any)?.lat ?? (athlete as any)?.liveTracking?.lat ?? (athlete as any)?.predictedLocation?.lat);
  const lng = toNum((athlete as any)?.lng ?? (athlete as any)?.liveTracking?.lng ?? (athlete as any)?.predictedLocation?.lng);
  const locationTs = toUnixSeconds((athlete as any)?.lastLocationTime ?? (athlete as any)?.liveTracking?.lastLocationTime ?? (athlete as any)?.gpsTimestamp);
  const recent = locationTs ? nowSec - locationTs <= 30 : false;
  return Number.isFinite(lat) && Number.isFinite(lng) && recent;
}

export function applyPredictionEngine(params: {
  athlete: LiveAthlete;
  nowSec: number;
  timingConfiguration: ResolvedTimingConfiguration | null;
}): LiveAthlete {
  const { athlete, nowSec, timingConfiguration } = params;
  const normalizedStatus = normalizeStatus(String(athlete.status || ''));
  const upperStatus = String(normalizedStatus || '').trim().toUpperCase();
  const isTerminal = ['FINISHED', 'DNF', 'DNS', 'DNQ'].includes(upperStatus);
  const isNotStarted = upperStatus === 'NOT STARTED' || upperStatus === 'REGISTERED';
  if (isTerminal || isNotStarted) return athlete;

  const officialSplits = [...(Array.isArray(athlete.splits) ? athlete.splits : [])]
    .filter((split) => Number.isFinite(Number(split?.time)) && Number(split?.time) > 0)
    .sort((a, b) => Number(a.time || 0) - Number(b.time || 0));
  const lastOfficialSplit = officialSplits[officialSplits.length - 1];
  if (!lastOfficialSplit) return athlete;

  const contestSplits = getContestSplitsForAthlete(athlete, timingConfiguration);
  const lastOfficialDistanceKm = Math.max(0, Number(lastOfficialSplit.distance || 0), Number((athlete as any).courseProgress || 0));
  const nextOfficialSplit = contestSplits.find((split) => split.distanceKm > lastOfficialDistanceKm + 0.001) || null;

  const observedPaceCandidates: number[] = [];
  for (let index = 1; index < officialSplits.length; index += 1) {
    const prev = officialSplits[index - 1];
    const curr = officialSplits[index];
    const dt = Number(curr.time || 0) - Number(prev.time || 0);
    const dd = Number(curr.distance || 0) - Number(prev.distance || 0);
    if (dt > 0 && dd > 0.02) observedPaceCandidates.push(dt / dd);
  }
  const observedPace = computeMedian(observedPaceCandidates);

  const legModel = resolveLegPredictionModel({
    athlete,
    observedPaceSecPerKm: observedPace,
    fallbackSegment: String(lastOfficialSplit.segment || ''),
  });

  const contestTotalDistanceKm = contestSplits.length > 0 ? Math.max(...contestSplits.map((split) => split.distanceKm)) : 0;
  const feedDistanceTotalKm = Number((athlete as any)?.distanceCovered || 0) + Number((athlete as any)?.distanceRemaining || 0);
  const totalDistanceKm = Math.max(contestTotalDistanceKm, feedDistanceTotalKm, Number((athlete as any).courseProgress || 0), lastOfficialDistanceKm);

  const startTimeSec = Number(athlete.startTime || 0);
  const absoluteLastOfficialSec = toUnixSeconds(lastOfficialSplit.absoluteTimestamp)
    || (startTimeSec > 0 ? startTimeSec + Number(lastOfficialSplit.time || 0) : null);
  const sinceLastOfficialSec = absoluteLastOfficialSec ? Math.max(0, nowSec - absoluteLastOfficialSec) : 0;

  const stateKey = athleteStateKey(athlete);
  const previousState = predictionStateByAthlete.get(stateKey) || {
    distanceKm: null,
    etaNextSplitUtc: null,
    etaFinishUtc: null,
    lastOfficialToken: null,
  };

  const lastOfficialToken = `${String(lastOfficialSplit.segment || '').toUpperCase()}|${Number(lastOfficialSplit.time || 0)}|${Number(lastOfficialSplit.distance || 0).toFixed(3)}`;
  if (previousState.lastOfficialToken !== lastOfficialToken) {
    previousState.distanceKm = lastOfficialDistanceKm;
    previousState.etaNextSplitUtc = null;
    previousState.etaFinishUtc = null;
    previousState.lastOfficialToken = lastOfficialToken;
  }

  const predictedFromDistance = legModel.transitionDurationSec && nextOfficialSplit && Math.abs(nextOfficialSplit.distanceKm - lastOfficialDistanceKm) < 0.01
    ? lastOfficialDistanceKm
    : lastOfficialDistanceKm + (sinceLastOfficialSec / Math.max(1, legModel.paceSecPerKm));

  const checkpointGuardMax = nextOfficialSplit
    ? Math.max(lastOfficialDistanceKm, nextOfficialSplit.distanceKm - 0.005)
    : totalDistanceKm;

  const rawNextEtaUtc = nextOfficialSplit
    ? nowSec + Math.max(0, (nextOfficialSplit.distanceKm - Math.max(lastOfficialDistanceKm, predictedFromDistance)) * legModel.paceSecPerKm)
    : null;

  const freezeThresholdSec = Number((athlete as any)?.predictionFreezeThresholdSec || (athlete as any)?.participantLive?.predictionFreezeThresholdSec || 20 * 60);
  const frozen = shouldFreezePrediction({
    nowSec,
    etaNextSplitUtc: rawNextEtaUtc || previousState.etaNextSplitUtc,
    freezeThresholdSec,
  });

  const distanceCandidate = frozen
    ? Math.max(lastOfficialDistanceKm, Number(previousState.distanceKm || lastOfficialDistanceKm))
    : predictedFromDistance;

  const estimatedDistanceKm = clampPredictedDistance({
    previousDistanceKm: previousState.distanceKm,
    nextDistanceKm: distanceCandidate,
    minDistanceKm: lastOfficialDistanceKm,
    maxDistanceKm: checkpointGuardMax,
  });

  const estimatedDistanceRemainingKm = Math.max(0, totalDistanceKm - estimatedDistanceKm);
  const progressPercent = totalDistanceKm > 0 ? Math.max(0, Math.min(100, (estimatedDistanceKm / totalDistanceKm) * 100)) : Number((athlete as any)?.progressPercent || 0);

  const rawEtaFinishUtc = nowSec + (estimatedDistanceRemainingKm * legModel.paceSecPerKm);
  const smoothedEtaNextUtc = smoothEta(previousState.etaNextSplitUtc, rawNextEtaUtc, 0.3);
  const smoothedEtaFinishUtc = smoothEta(previousState.etaFinishUtc, rawEtaFinishUtc, 0.3);

  const gpsActive = detectGps(athlete, nowSec);
  const source: PredictionSourceKind = frozen
    ? 'WAITING_OFFICIAL'
    : gpsActive
      ? 'LIVE_GPS'
      : legModel.source;

  const predictionConfidence = predictionConfidenceLevel(source);
  const predictionStatus = predictionStatusLabel(source);

  const estimatedSpeedKmh = legModel.paceSecPerKm > 0 ? 3600 / legModel.paceSecPerKm : null;
  const officialCurrentSplit = String(lastOfficialSplit.rawSplitLabel || lastOfficialSplit.name || (athlete as any)?.currentSplit || '').trim();
  const expectedNextSplit = String(nextOfficialSplit?.label || (athlete as any)?.expectedNextSplit || '').trim();

  const nextSplitCountdownSec = countdownToEta(smoothedEtaNextUtc, nowSec);

  const participantLive = {
    ...((athlete as any)?.participantLive || {}),
    distanceCovered: estimatedDistanceKm,
    distanceRemaining: estimatedDistanceRemainingKm,
    progressPercent,
    speed: estimatedSpeedKmh,
    averageSpeed: estimatedSpeedKmh,
    pace: legModel.paceSecPerKm,
    averagePace: legModel.paceSecPerKm,
    currentLeg: athlete.leg,
    currentSplit: officialCurrentSplit || ((athlete as any)?.participantLive?.currentSplit || null),
    expectedNextSplit: expectedNextSplit || ((athlete as any)?.participantLive?.expectedNextSplit || null),
    etaNextSplitUTC: smoothedEtaNextUtc || (athlete.etaNextSplitUTC ?? null),
    etaFinishUTC: smoothedEtaFinishUtc || (athlete.etaFinishUTC ?? null),
    etaNextSplitCountdownSec: nextSplitCountdownSec,
    estimatedFinish: smoothedEtaFinishUtc ? new Date(smoothedEtaFinishUtc * 1000).toISOString() : ((athlete as any)?.participantLive?.estimatedFinish || null),
    predictionSource: source,
    predictionStatus,
    predictionConfidence,
    predictionSourceDetail: legModel.sourceDetail,
    predictionUpdatedAt: nowSec,
    predictionFrozen: frozen,
    predictionFrozenReason: frozen ? 'Waiting for next official timing point' : null,
    estimatedPositionUnavailable: frozen,
  };

  const nextState: PredictionState = {
    distanceKm: estimatedDistanceKm,
    etaNextSplitUtc: smoothedEtaNextUtc,
    etaFinishUtc: smoothedEtaFinishUtc,
    lastOfficialToken,
  };
  predictionStateByAthlete.set(stateKey, nextState);

  return {
    ...athlete,
    courseProgress: estimatedDistanceKm,
    predictedPaceSecPerKm: legModel.paceSecPerKm,
    etaNextSplitUTC: smoothedEtaNextUtc || athlete.etaNextSplitUTC,
    etaFinishUTC: smoothedEtaFinishUtc || athlete.etaFinishUTC,
    participantLive,
    currentSplit: officialCurrentSplit || (athlete as any)?.currentSplit,
    expectedNextSplit: expectedNextSplit || (athlete as any)?.expectedNextSplit,
    distanceCovered: estimatedDistanceKm,
    distanceRemaining: estimatedDistanceRemainingKm,
    progressPercent,
    speed: estimatedSpeedKmh,
    averageSpeed: estimatedSpeedKmh,
    pace: legModel.paceSecPerKm,
    averagePace: legModel.paceSecPerKm,
    estimatedFinish: smoothedEtaFinishUtc ? new Date(smoothedEtaFinishUtc * 1000).toISOString() : (athlete as any)?.estimatedFinish,
    predictionSource: source,
    predictionStatus,
    predictionConfidence,
    predictionSourceDetail: legModel.sourceDetail,
    predictionUpdatedAt: nowSec,
    predictionFrozen: frozen,
    predictionFrozenReason: frozen ? 'Waiting for next official timing point' : null,
  } as LiveAthlete;
}
