import { isLiveDiagnosticsEnabled } from "@/core/services/performance/liveDiagnosticsPolicy";
import {
  completeIosAthleteSwitch,
  startIosLiveDiagnosticWindow,
  startIosAthleteSwitch,
} from "@/core/services/performance/iosLiveDiagnostics";
import { snapshotAthleteSearchDiagnostics } from "@/core/repositories/searchSingleFlight";

export type LivePerformanceCounter =
  | "liveTrackMounts"
  | "liveTrackUnmounts"
  | "socketCreates"
  | "socketOpens"
  | "socketCloses"
  | "reconnectTimers"
  | "athleteDetailRequests"
  | "mobileLiveReads"
  | "athleteDetailBytes"
  | "courseModelBuilds"
  | "gpxParses"
  | "queryInvalidations"
  | "cardRenders"
  | "timelineDerivations"
  | "timelineCacheReads"
  | "identityResolutions"
  | "predictionCalculations"
  | "athletePositionDerivations"
  | "courseResolutions"
  | "cameraModeTransitions"
  | "cameraGestureEvents"
  | "participantRevisionChanges"
  | "predictedMarkerUpdates"
  | "gpxRequests"
  | "mapRenders"
  | "mapMarkerRenders"
  | "modalRenders"
  | "splitTableRenders"
  | "liveTrackScreenRenders"
  | "selectorExecutions"
  | "queryObserverUpdates"
  | "watchlistStoreUpdates"
  | "memoMisses"
  | "collectionScans";

export type AthleteSwitchPhase =
  | "selectionDispatchMs"
  | "selectedAthleteLookupMs"
  | "identityResolutionMs"
  | "queryCacheLookupMs"
  | "courseResolutionMs"
  | "timelineLookupMs"
  | "predictionMappingMs";

const counters: Record<LivePerformanceCounter, number> = {
  liveTrackMounts: 0,
  liveTrackUnmounts: 0,
  socketCreates: 0,
  socketOpens: 0,
  socketCloses: 0,
  reconnectTimers: 0,
  athleteDetailRequests: 0,
  mobileLiveReads: 0,
  athleteDetailBytes: 0,
  courseModelBuilds: 0,
  gpxParses: 0,
  queryInvalidations: 0,
  cardRenders: 0,
  timelineDerivations: 0,
  timelineCacheReads: 0,
  identityResolutions: 0,
  predictionCalculations: 0,
  athletePositionDerivations: 0,
  courseResolutions: 0,
  cameraModeTransitions: 0,
  cameraGestureEvents: 0,
  participantRevisionChanges: 0,
  predictedMarkerUpdates: 0,
  gpxRequests: 0,
  mapRenders: 0,
  mapMarkerRenders: 0,
  modalRenders: 0,
  splitTableRenders: 0,
  liveTrackScreenRenders: 0,
  selectorExecutions: 0,
  queryObserverUpdates: 0,
  watchlistStoreUpdates: 0,
  memoMisses: 0,
  collectionScans: 0,
};
let trackedAthletesGauge = 0;

export function setTrackedAthletePerformanceCount(count: number): void {
  if (!isLiveDiagnosticsEnabled) return;
  trackedAthletesGauge = Math.max(0, Math.floor(count));
}

export function recordLivePerformance(
  counter: LivePerformanceCounter,
  amount = 1,
): void {
  if (!isLiveDiagnosticsEnabled) return;
  counters[counter] += amount;
}

export function snapshotLivePerformance(): Readonly<
  Record<LivePerformanceCounter, number>
> {
  return { ...counters };
}

let athleteSwitchGeneration = 0;
type AthleteSwitchWindow = {
  participantUuid: string;
  generation: number;
  startedAt: number;
  baseline: Readonly<Record<LivePerformanceCounter, number>>;
  phases: Partial<Record<AthleteSwitchPhase, number>>;
  committedAt: number | null;
  layoutCompletedAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
};
let activeAthleteSwitchWindow: AthleteSwitchWindow | null = null;

function emitAthleteSwitchDerivationStats(window: AthleteSwitchWindow): void {
  const current = snapshotLivePerformance();
  const delta = (counter: LivePerformanceCounter) =>
    current[counter] - window.baseline[counter];
  console.info("ATHLETE_SWITCH_DERIVATION_STATS", {
    participantUuid: window.participantUuid,
    generation: window.generation,
    identityResolutions: delta("identityResolutions"),
    timelineBuilds: delta("timelineDerivations"),
    timelineCacheReads: delta("timelineCacheReads"),
    mobileLiveReads: delta("mobileLiveReads"),
    courseResolutions: delta("courseResolutions"),
    predictionCalculations: delta("predictionCalculations"),
    cardRenders: delta("cardRenders"),
    mapRenderCount: delta("mapRenders"),
    mapMarkerRenderCount: delta("mapMarkerRenders"),
    modalRenderCount: delta("modalRenders"),
    splitTableRenderCount: delta("splitTableRenders"),
    liveTrackScreenRenderCount: delta("liveTrackScreenRenders"),
    selectorExecutions: delta("selectorExecutions"),
    queryObserverUpdates: delta("queryObserverUpdates"),
    watchlistStoreUpdates: delta("watchlistStoreUpdates"),
    memoMisses: delta("memoMisses"),
    collectionScans: delta("collectionScans"),
    mapMarkerUpdates: delta("predictedMarkerUpdates"),
    socketCreates: delta("socketCreates"),
    socketCloses: delta("socketCloses"),
    selectionDispatchMs: window.phases.selectionDispatchMs ?? null,
    selectedAthleteLookupMs: window.phases.selectedAthleteLookupMs ?? null,
    identityResolutionMs: window.phases.identityResolutionMs ?? null,
    queryCacheLookupMs: window.phases.queryCacheLookupMs ?? null,
    courseResolutionMs: window.phases.courseResolutionMs ?? null,
    timelineLookupMs: window.phases.timelineLookupMs ?? null,
    predictionMappingMs: window.phases.predictionMappingMs ?? null,
    renderToCommitMs:
      window.committedAt == null ? null : window.committedAt - window.startedAt,
    totalSwitchMs:
      window.layoutCompletedAt == null
        ? null
        : window.layoutCompletedAt - window.startedAt,
    settleObservationMs: Date.now() - window.startedAt,
    committed: window.committedAt != null,
  });
}

/**
 * Emits one settled, request-scoped switch report. Overlapping rapid switches
 * remain individually attributable without putting logs in render functions.
 */
export function startAthleteSwitchDerivationStats(
  participantUuid: string,
  settleMs = 2_000,
  source = "tracking_selection",
  bib?: string | null,
): number | null {
  if (!isLiveDiagnosticsEnabled || !participantUuid) return null;
  startIosAthleteSwitch(participantUuid, source, bib);
  if (activeAthleteSwitchWindow) {
    if (activeAthleteSwitchWindow.timer) {
      clearTimeout(activeAthleteSwitchWindow.timer);
    }
    emitAthleteSwitchDerivationStats(activeAthleteSwitchWindow);
  }
  athleteSwitchGeneration += 1;
  const window: AthleteSwitchWindow = {
    participantUuid,
    generation: athleteSwitchGeneration,
    startedAt: Date.now(),
    baseline: snapshotLivePerformance(),
    phases: {},
    committedAt: null,
    layoutCompletedAt: null,
    timer: null,
  };
  activeAthleteSwitchWindow = window;
  window.timer = setTimeout(() => {
    if (activeAthleteSwitchWindow?.generation !== window.generation) return;
    emitAthleteSwitchDerivationStats(window);
    activeAthleteSwitchWindow = null;
  }, settleMs);
  return window.generation;
}

export function recordAthleteSwitchPhase(
  generation: number | null,
  phase: AthleteSwitchPhase,
  durationMs: number,
): void {
  if (
    !isLiveDiagnosticsEnabled ||
    generation == null ||
    activeAthleteSwitchWindow?.generation !== generation
  ) {
    return;
  }
  activeAthleteSwitchWindow.phases[phase] =
    (activeAthleteSwitchWindow.phases[phase] ?? 0) + Math.max(0, durationMs);
}

export function measureActiveAthleteSwitchPhase<T>(
  phase: AthleteSwitchPhase,
  action: () => T,
): T {
  if (!isLiveDiagnosticsEnabled || !activeAthleteSwitchWindow) return action();
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  try {
    return action();
  } finally {
    const completedAt = globalThis.performance?.now?.() ?? Date.now();
    recordAthleteSwitchPhase(
      activeAthleteSwitchWindow?.generation ?? null,
      phase,
      completedAt - startedAt,
    );
  }
}

/** Marks the first React commit containing the requested participant. */
export function commitAthleteSwitchDerivationStats(
  participantUuid: string,
): void {
  if (!isLiveDiagnosticsEnabled || !participantUuid) return;
  const window = activeAthleteSwitchWindow;
  if (
    !window ||
    window.participantUuid.toLowerCase() !== participantUuid.toLowerCase() ||
    window.committedAt != null
  ) {
    return;
  }
  window.committedAt = Date.now();
  const complete = () => {
    if (activeAthleteSwitchWindow?.generation !== window.generation) return;
    window.layoutCompletedAt = Date.now();
    completeIosAthleteSwitch(participantUuid);
    if (window.timer) clearTimeout(window.timer);
    // Let layout/native props settle, but keep this separate from totalSwitchMs.
    window.timer = setTimeout(() => {
      if (activeAthleteSwitchWindow?.generation !== window.generation) return;
      emitAthleteSwitchDerivationStats(window);
      activeAthleteSwitchWindow = null;
    }, 50);
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(complete));
  } else {
    setTimeout(complete, 0);
  }
}

/** One compact, development-only report shared by requests, sockets and maps. */
export function startLivePerformanceWindow(durationMs = 60_000): () => void {
  if (!isLiveDiagnosticsEnabled) return () => undefined;
  const stopIosDiagnosticWindow = startIosLiveDiagnosticWindow(durationMs);
  const baseline = snapshotLivePerformance();
  const searchBaseline = snapshotAthleteSearchDiagnostics();
  const timer = setTimeout(() => {
    const current = snapshotLivePerformance();
    const delta = Object.fromEntries(
      Object.entries(current).map(([key, value]) => [
        key,
        value - baseline[key as LivePerformanceCounter],
      ]),
    );
    const searchCurrent = snapshotAthleteSearchDiagnostics();
    console.info("[performance:live-track]", {
      durationMs,
      ...delta,
      athleteSearchRequests: searchCurrent.requests - searchBaseline.requests,
      athleteSearchAborts: searchCurrent.aborts - searchBaseline.aborts,
      athleteSearchSingleFlightHits:
        searchCurrent.singleFlightHits - searchBaseline.singleFlightHits,
    });
    console.info("[LIVE_TRACK_DERIVATION_STATS]", {
      durationMs,
      timelineDerivations: delta.timelineDerivations,
      timelineCacheReads: delta.timelineCacheReads,
      identityResolutions: delta.identityResolutions,
      predictionCalculations: delta.predictionCalculations,
      athletePositionDerivations: delta.athletePositionDerivations,
      courseResolutions: delta.courseResolutions,
      participantRevisionChanges: delta.participantRevisionChanges,
    });
    console.info("[PREDICTED_POSITION_PERFORMANCE]", {
      durationMs,
      trackedAthletes: trackedAthletesGauge,
      markerUpdates: delta.predictedMarkerUpdates,
      mobileLiveRequests: delta.mobileLiveReads,
      athleteSearchRequests: searchCurrent.requests - searchBaseline.requests,
      gpxRequests: delta.gpxRequests,
      gpxParses: delta.gpxParses,
      courseModelBuilds: delta.courseModelBuilds,
      socketReconnects: delta.reconnectTimers,
    });
  }, durationMs);
  return () => {
    clearTimeout(timer);
    stopIosDiagnosticWindow();
  };
}
