import { isLiveDiagnosticsEnabled } from "@/core/services/performance/liveDiagnosticsPolicy";
import { recordLivePerformance } from "../livePerformanceDiagnostics";

type CounterName =
  | "courseModelBuild"
  | "gpxLoad"
  | "gpxRequest"
  | "gpxParse"
  | "fitToCoordinates"
  | "cameraCommand"
  | "liveMapMount"
  | "liveMapUnmount"
  | "markerUpdate"
  | "markerCreate"
  | "markerRemove"
  | "markerPositionUpdate"
  | "markerAnimationFrame"
  | "courseSourceUpdate"
  | "routeLayerUpdate"
  | "elevationAnalysis";

const counters: Record<CounterName, number> = {
  courseModelBuild: 0,
  gpxLoad: 0,
  gpxRequest: 0,
  gpxParse: 0,
  fitToCoordinates: 0,
  cameraCommand: 0,
  liveMapMount: 0,
  liveMapUnmount: 0,
  markerUpdate: 0,
  markerCreate: 0,
  markerRemove: 0,
  markerPositionUpdate: 0,
  markerAnimationFrame: 0,
  courseSourceUpdate: 0,
  routeLayerUpdate: 0,
  elevationAnalysis: 0,
};

let initialRenderMs: number | null = null;

/** Development-only, aggregate map diagnostics. Never includes athlete data. */
export function recordMapDiagnostic(
  name: CounterName,
  reason: string,
  emitLog = true,
): void {
  if (!isLiveDiagnosticsEnabled) return;
  counters[name] += 1;
  if (name === "courseModelBuild") recordLivePerformance("courseModelBuilds");
  if (name === "gpxParse") recordLivePerformance("gpxParses");
  if (name === "gpxRequest") recordLivePerformance("gpxRequests");
  if (name === "markerUpdate") recordLivePerformance("predictedMarkerUpdates");
  if (emitLog) {
    console.info("[live-map:diagnostic]", {
      reason,
      counters: { ...counters },
    });
  }
}

export function recordLiveMapCameraMode(details: {
  mode: string;
  reason: string;
  selectedParticipantUuid?: string | null;
}): void {
  if (!isLiveDiagnosticsEnabled) return;
  recordLivePerformance("cameraModeTransitions");
  console.info("[LIVE_MAP_CAMERA_MODE]", details);
}

export function recordLiveMapGesture(
  phase: "START" | "END",
  details: Record<string, unknown>,
): void {
  if (!isLiveDiagnosticsEnabled) return;
  recordLivePerformance("cameraGestureEvents");
  console.info(`[LIVE_MAP_GESTURE_${phase}]`, details);
}

export function recordLiveMapCameraCommand(details: {
  command: string;
  reason: string;
  mode: string;
  allowed: boolean;
}): void {
  if (!isLiveDiagnosticsEnabled) return;
  counters.cameraCommand += 1;
  console.info("[LIVE_MAP_CAMERA_COMMAND]", details);
}

export function recordLiveAthletePosition(
  label:
    | "LIVE_ATHLETE_POSITION"
    | "LIVE_ATHLETE_MARKER_UPDATE"
    | "LIVE_ATHLETE_FOLLOW",
  details: Record<string, unknown>,
): void {
  if (!isLiveDiagnosticsEnabled) return;
  console.info(`[${label}]`, details);
}

export function getMapDiagnosticsForTests(): Readonly<typeof counters> {
  return counters;
}

export function recordLiveMapStartupComplete(startedAtMs: number): void {
  if (!isLiveDiagnosticsEnabled || initialRenderMs != null) return;
  initialRenderMs = Math.max(0, Date.now() - startedAtMs);
  console.info("[live-map:startup]", {
    initialRenderMs,
    uniqueGpxLoads: counters.gpxLoad,
    gpxRequests: counters.gpxRequest,
    gpxParses: counters.gpxParse,
    elevationRequests: counters.elevationAnalysis,
    mapMounts: counters.liveMapMount,
    geometryBuilds: counters.courseModelBuild,
  });
}

export function startLiveMapDiagnosticWindow(durationMs = 60_000): () => void {
  if (!isLiveDiagnosticsEnabled) return () => undefined;
  const baseline = { ...counters };
  const timer = setTimeout(() => {
    const delta = Object.fromEntries(
      Object.entries(counters).map(([key, value]) => [
        key,
        value - baseline[key as CounterName],
      ]),
    );
    console.info("[live-map:one-minute]", { durationMs, delta });
  }, durationMs);
  return () => clearTimeout(timer);
}
