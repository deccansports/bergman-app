import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementRef,
} from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Constants from "expo-constants";
import { Image } from "expo-image";
import Mapbox, {
  Camera,
  CircleLayer,
  LineLayer,
  MapView,
  MarkerView,
  ShapeSource,
  SymbolLayer,
} from "@rnmapbox/maps";

import { useTheme } from "@/core/theme";
import { formatCutoffSummary, getInitials } from "@/core/utils";
import { Button, Card, Icon, Text } from "@/shared/components";
import { recordLivePerformance } from "@/features/tracking/livePerformanceDiagnostics";
import { buildCourseTransitionConnectors } from "../mappers";
import {
  ATHLETE_SOURCE_ID,
  athleteSourceSignature,
  buildAthleteGeoJson,
  buildCourseGeoJson,
  buildDistanceGeoJson,
  buildLandmarkGeoJson,
  COURSE_COLORS,
  COURSE_SOURCE_ID,
  DISTANCE_SOURCE_ID,
  LANDMARK_SOURCE_ID,
  overviewZoomLevel,
  paddedCourseBounds,
} from "../mapboxCourseLayers";
import {
  recordLiveAthletePosition,
  recordLiveMapCameraCommand,
  recordLiveMapCameraMode,
  recordLiveMapGesture,
  recordMapDiagnostic,
} from "../devInstrumentation";
import {
  cameraCommandAllowed,
  constrainCameraCenter,
  courseReferencePoint,
  radiusBounds,
  type LiveMapCameraMode,
} from "../liveMapCamera";
import type { CourseMapViewProps } from "./CourseMapView";
import type { TrackAthlete } from "./CourseTrackCanvas";

const MAPBOX_TOKEN = String(
  process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ??
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN ??
    Constants.expoConfig?.extra?.mapboxPublicAccessToken ??
    "",
).trim();

if (MAPBOX_TOKEN) Mapbox.setAccessToken(MAPBOX_TOKEN);

const COURSE_LINE_WIDTH = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  1.4,
  12,
  2,
  16,
  3.4,
  20,
  5,
] as const;

const COURSE_COLOR = [
  "match",
  ["get", "discipline"],
  "swim",
  COURSE_COLORS.swim,
  "bike",
  COURSE_COLORS.bike,
  "run",
  COURSE_COLORS.run,
  "transition",
  COURSE_COLORS.transition,
  COURSE_COLORS.other,
] as const;

const DISCIPLINE_COLOR = [
  "match",
  ["get", "discipline"],
  "swim",
  COURSE_COLORS.swim,
  "bike",
  COURSE_COLORS.bike,
  "run",
  COURSE_COLORS.run,
  COURSE_COLORS.other,
] as const;

const SELECTED_STATE = [
  "boolean",
  ["feature-state", "selected"],
  false,
] as const;

function mapStyleUrl(mapType: CourseMapViewProps["mapType"]): string {
  if (mapType === "satellite") return Mapbox.StyleURL.Satellite;
  if (mapType === "hybrid") return Mapbox.StyleURL.SatelliteStreet;
  if (mapType === "terrain") return Mapbox.StyleURL.Outdoors;
  return Mapbox.StyleURL.Light;
}

function selectedAthleteId(
  athletes: NonNullable<CourseMapViewProps["athletes"]>,
): string | null {
  const selected = athletes.find((athlete) => athlete.selected);
  return selected ? String(selected.id ?? selected.bib ?? selected.name) : null;
}

function sameAthleteMarkers(
  previous: NonNullable<CourseMapViewProps["athletes"]>,
  next: NonNullable<CourseMapViewProps["athletes"]>,
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((athlete, index) => {
    const candidate = next[index];
    return (
      candidate != null &&
      athlete.id === candidate.id &&
      athlete.name === candidate.name &&
      athlete.bib === candidate.bib &&
      athlete.selected === candidate.selected &&
      athlete.position.lat === candidate.position.lat &&
      athlete.position.lng === candidate.position.lng &&
      athlete.heading === candidate.heading
    );
  });
}

function sameMapPreferences(
  previous: CourseMapViewProps["mapPreferences"],
  next: CourseMapViewProps["mapPreferences"],
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return (
    previous.showRoute === next.showRoute &&
    previous.showSplitPoints === next.showSplitPoints &&
    previous.showDistanceLabels === next.showDistanceLabels &&
    previous.showAthleteLabels === next.showAthleteLabels &&
    previous.showAidStations === next.showAidStations
  );
}

/** Mapbox owns coordinate presentation. A React animation loop here crossed
 * the JS/native boundary dozens of times for each timing update and starved
 * gestures on physical iOS and Android devices. */
const SelectedAthleteMarker = memo(
  function SelectedAthleteMarker({ athlete }: { athlete: TrackAthlete }) {
    recordLivePerformance("mapMarkerRenders");
    const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);

    return (
      <MarkerView
        id="bergman-selected-athlete-marker"
        coordinate={[athlete.position.lng, athlete.position.lat]}
        anchor={{ x: 0.5, y: 0.72 }}
        allowOverlap
      >
        <View style={styles.athleteMarker}>
          <View style={styles.athleteMarkerIdentity}>
            {athlete.photoUrl && failedPhotoUrl !== athlete.photoUrl ? (
              <Image
                source={{ uri: athlete.photoUrl }}
                style={styles.athleteMarkerAvatar}
                contentFit="cover"
                onError={() => setFailedPhotoUrl(athlete.photoUrl ?? null)}
              />
            ) : (
              <Text style={styles.athleteMarkerInitials}>
                {getInitials(athlete.name) || "A"}
              </Text>
            )}
          </View>
          <View style={styles.athleteMarkerBib}>
            <Text style={styles.athleteMarkerBibText}>
              {String(athlete.bib || "—")}
            </Text>
          </View>
        </View>
      </MarkerView>
    );
  },
  (previous, next) =>
    previous.athlete.id === next.athlete.id &&
    previous.athlete.name === next.athlete.name &&
    previous.athlete.bib === next.athlete.bib &&
    previous.athlete.photoUrl === next.athlete.photoUrl &&
    previous.athlete.position.lat === next.athlete.position.lat &&
    previous.athlete.position.lng === next.athlete.position.lng,
);

function UnavailableMap({
  fullBleed,
  refreshError,
  onRetry,
}: Pick<CourseMapViewProps, "fullBleed" | "refreshError" | "onRetry">) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: fullBleed ? 1 : undefined,
        width: "100%",
        minHeight: fullBleed ? "100%" : 240,
        alignItems: "center",
        justifyContent: "center",
        padding: theme.spacing.base,
        backgroundColor: theme.colors.surfaceSunken,
      }}
    >
      <Card style={{ width: "100%", maxWidth: 420, gap: theme.spacing.sm }}>
        <Text variant="headline">Course map unavailable</Text>
        <Text variant="bodySmall" color="textMuted">
          {refreshError
            ? "The course could not be downloaded. Please retry."
            : "No course geometry is configured for this contest."}
        </Text>
        {onRetry ? (
          <Button label="Retry course map" size="sm" onPress={onRetry} />
        ) : null}
      </Card>
    </View>
  );
}

function CourseMapViewComponent({
  map,
  athletes = [],
  cutoffMinutes,
  cutoffs,
  compact = false,
  fullBleed = false,
  loading = false,
  refreshError = false,
  controlsOffsetTop = 112,
  controlsOffsetRight = 12,
  bottomSafeArea = 0,
  mapPreferences,
  showMapControls = true,
  mapType = "standard",
  onMapTypeChange,
  mapDimension = "3d",
  followSelectedAthlete = true,
  onAthletePress,
  onRetry,
}: CourseMapViewProps) {
  recordLivePerformance("mapRenders");
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const cameraRef = useRef<ElementRef<typeof Camera>>(null);
  const mapRef = useRef<MapView>(null);
  const lastFitKeyRef = useRef<string | null>(null);
  const previousSelectedIdRef = useRef<string | null>(null);
  const cameraModeRef = useRef<LiveMapCameraMode>("INITIAL_FIT");
  const gestureActiveRef = useRef(false);
  const lastFollowMoveRef = useRef({
    athleteId: "",
    lat: Number.NaN,
    lng: Number.NaN,
    at: 0,
  });
  const [followEnabled, setFollowEnabled] = useState(false);
  const [cameraMode, setCameraModeState] =
    useState<LiveMapCameraMode>("INITIAL_FIT");
  const [styleRevision, setStyleRevision] = useState(0);
  const currentZoomRef = useRef(12);
  const cutoffSummary = formatCutoffSummary(cutoffMinutes, cutoffs);

  const validAthletes = useMemo(
    () =>
      athletes.filter(
        (athlete) =>
          Number.isFinite(athlete.position.lat) &&
          Number.isFinite(athlete.position.lng) &&
          Math.abs(athlete.position.lat) <= 90 &&
          Math.abs(athlete.position.lng) <= 180,
      ),
    [athletes],
  );
  const activeAthleteId = selectedAthleteId(validAthletes);
  const activeAthlete = activeAthleteId
    ? validAthletes.find(
        (athlete) =>
          String(athlete.id ?? athlete.bib ?? athlete.name) === activeAthleteId,
      )
    : undefined;
  const setCameraMode = useCallback(
    (mode: LiveMapCameraMode, reason: string) => {
      if (cameraModeRef.current === mode) return;
      cameraModeRef.current = mode;
      setCameraModeState(mode);
      recordLiveMapCameraMode({
        mode,
        reason,
        selectedParticipantUuid: activeAthleteId,
      });
    },
    [activeAthleteId],
  );

  const transitionPaths = useMemo(
    () => buildCourseTransitionConnectors(map?.legs ?? []),
    [map?.legs],
  );
  const courseShape = useMemo(
    () => buildCourseGeoJson(map?.legs ?? [], transitionPaths),
    [map?.legs, transitionPaths],
  );
  const distanceShape = useMemo(
    () => buildDistanceGeoJson(map?.markers ?? []),
    [map?.markers],
  );
  const landmarkShape = useMemo(
    () => buildLandmarkGeoJson(map?.markers ?? []),
    [map?.markers],
  );

  // Selection is Mapbox feature-state, not source data. A selection-only
  // change therefore does not rebuild the athlete ShapeSource.
  const sourceSignature = athleteSourceSignature(validAthletes);
  const athleteShape = useMemo(
    () => buildAthleteGeoJson(validAthletes),
    // The semantic signature deliberately avoids rebuilding the ShapeSource
    // for selection-only object/array changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceSignature],
  );

  const courseBounds = map ? paddedCourseBounds(map) : null;
  const eventReference = useMemo(
    () => (map ? courseReferencePoint(map) : null),
    [map],
  );
  const explorationBounds = useMemo(
    () => (eventReference ? radiusBounds(eventReference) : null),
    [eventReference],
  );
  const overviewZoom = map
    ? overviewZoomLevel(map, width, height, bottomSafeArea)
    : 12;
  const minimumZoom = 3;
  const cameraPadding = useMemo(
    () => ({
      paddingTop: 92,
      paddingRight: 32,
      paddingBottom: Math.min(Math.max(bottomSafeArea + 20, 48), height * 0.42),
      paddingLeft: 32,
    }),
    [bottomSafeArea, height],
  );

  const fitCourse = useCallback(
    (animated = true, reason: "initial_fit" | "course_fit" = "course_fit") => {
      if (!courseBounds) return;
      const allowed = cameraCommandAllowed(cameraModeRef.current, reason);
      recordLiveMapCameraCommand({
        command: "fitBounds",
        reason: allowed ? reason : "user_controlled",
        mode: cameraModeRef.current,
        allowed,
      });
      if (!allowed) return;
      recordMapDiagnostic("fitToCoordinates", "mapbox-course-fit");
      cameraRef.current?.fitBounds(
        courseBounds.ne,
        courseBounds.sw,
        [
          cameraPadding.paddingTop,
          cameraPadding.paddingRight,
          cameraPadding.paddingBottom,
          cameraPadding.paddingLeft,
        ],
        animated ? 450 : 0,
      );
    },
    [cameraPadding, courseBounds],
  );

  const focusAthlete = useCallback(
    (animated = true, explicit = true) => {
      if (!activeAthlete) return;
      if (explicit) setCameraMode("ATHLETE_FOCUS", "explicit_athlete_focus");
      const mode = explicit ? "ATHLETE_FOCUS" : cameraModeRef.current;
      const reason = explicit ? "athlete_focus" : "follow";
      const allowed = cameraCommandAllowed(mode, reason);
      recordLiveMapCameraCommand({
        command: "setCamera",
        reason: allowed ? reason : "user_controlled",
        mode,
        allowed,
      });
      if (!allowed) return;
      setFollowEnabled(true);
      recordLiveAthletePosition("LIVE_ATHLETE_FOLLOW", {
        participantUuid: activeAthlete.id ?? null,
        cameraMode: mode,
        following: true,
        reason,
      });
      cameraRef.current?.setCamera({
        centerCoordinate: [
          activeAthlete.position.lng,
          activeAthlete.position.lat,
        ],
        zoomLevel: currentZoomRef.current,
        heading: activeAthlete.heading ?? 0,
        pitch: mapDimension === "3d" ? 45 : 0,
        padding: cameraPadding,
        animationMode: animated ? "easeTo" : "none",
        animationDuration: animated ? 500 : 0,
      });
    },
    [activeAthlete, cameraPadding, mapDimension, setCameraMode],
  );

  useEffect(() => {
    recordMapDiagnostic("liveMapMount", "native-mapbox-course-map-mounted");
    return () =>
      recordMapDiagnostic(
        "liveMapUnmount",
        "native-mapbox-course-map-unmounted",
      );
  }, []);

  useEffect(() => {
    recordMapDiagnostic("courseSourceUpdate", "mapbox-course-shape-changed");
  }, [courseShape]);

  useEffect(() => {
    recordMapDiagnostic("routeLayerUpdate", "mapbox-route-layer-changed");
  }, [courseShape, mapPreferences?.showRoute]);

  useEffect(() => {
    if (validAthletes.length > 0) {
      recordMapDiagnostic("markerUpdate", "mapbox-athlete-source-update");
    }
  }, [sourceSignature, validAthletes.length]);

  useEffect(() => {
    if (styleRevision === 0 || !mapRef.current) return;
    const previous = previousSelectedIdRef.current;
    if (previous && previous !== activeAthleteId) {
      void mapRef.current.setFeatureState(
        previous,
        { selected: false },
        ATHLETE_SOURCE_ID,
      );
    }
    if (activeAthleteId) {
      void mapRef.current.setFeatureState(
        activeAthleteId,
        { selected: true },
        ATHLETE_SOURCE_ID,
      );
    }
    previousSelectedIdRef.current = activeAthleteId;
  }, [activeAthleteId, sourceSignature, styleRevision]);

  useEffect(() => {
    if (styleRevision === 0 || !courseBounds || !map) return;
    const key = `${map.name}:${map.mergedPath.length}:${width}:${height}`;
    if (lastFitKeyRef.current === key) return;
    lastFitKeyRef.current = key;
    if (cameraModeRef.current === "USER_CONTROLLED") return;
    setCameraMode("INITIAL_FIT", "first_course_style_load");
    fitCourse(false, "initial_fit");
  }, [
    courseBounds,
    fitCourse,
    height,
    map,
    setCameraMode,
    styleRevision,
    width,
  ]);

  useEffect(() => {
    if (
      !followEnabled ||
      !followSelectedAthlete ||
      cameraModeRef.current !== "ATHLETE_FOCUS" ||
      styleRevision === 0 ||
      !activeAthleteId ||
      !activeAthlete
    )
      return;
    const previous = lastFollowMoveRef.current;
    const now = Date.now();
    const moved =
      previous.athleteId !== activeAthleteId ||
      Math.abs(previous.lat - activeAthlete.position.lat) > 0.000005 ||
      Math.abs(previous.lng - activeAthlete.position.lng) > 0.000005;
    if (!moved || now - previous.at < 750) return;
    lastFollowMoveRef.current = {
      athleteId: activeAthleteId,
      lat: activeAthlete.position.lat,
      lng: activeAthlete.position.lng,
      at: now,
    };
    const allowed = cameraCommandAllowed(cameraModeRef.current, "follow");
    recordLiveMapCameraCommand({
      command: "moveTo",
      reason: allowed ? "athlete_follow" : "user_controlled",
      mode: cameraModeRef.current,
      allowed,
    });
    if (!allowed) return;
    recordLiveAthletePosition("LIVE_ATHLETE_FOLLOW", {
      participantUuid: activeAthleteId,
      cameraMode: cameraModeRef.current,
      following: true,
      reason: "predicted_position_update",
    });
    cameraRef.current?.moveTo(
      [activeAthlete.position.lng, activeAthlete.position.lat],
      450,
    );
  }, [
    activeAthlete,
    activeAthleteId,
    followEnabled,
    followSelectedAthlete,
    styleRevision,
  ]);

  if (loading) {
    return (
      <Card>
        <Text variant="body" color="textMuted">
          Loading course map…
        </Text>
      </Card>
    );
  }

  if (!map?.hasGeometry || !map.bounds || map.mergedPath.length < 2) {
    return (
      <UnavailableMap
        fullBleed={fullBleed}
        refreshError={refreshError}
        onRetry={onRetry}
      />
    );
  }

  if (!MAPBOX_TOKEN) {
    return (
      <UnavailableMap fullBleed={fullBleed} refreshError onRetry={onRetry} />
    );
  }

  const showRoute = mapPreferences?.showRoute ?? true;
  const showDistance = mapPreferences?.showDistanceLabels ?? true;
  const showSplits = mapPreferences?.showSplitPoints ?? true;
  const showAthleteLabels = mapPreferences?.showAthleteLabels ?? true;

  const mapContent = (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        styleURL={mapStyleUrl(mapType)}
        projection="mercator"
        scrollEnabled
        zoomEnabled
        pitchEnabled
        rotateEnabled
        compassEnabled
        scaleBarEnabled={false}
        attributionEnabled
        logoEnabled
        requestDisallowInterceptTouchEvent
        gestureSettings={{
          panEnabled: true,
          pinchPanEnabled: true,
          pinchZoomEnabled: true,
          doubleTapToZoomInEnabled: true,
          doubleTouchToZoomOutEnabled: true,
          pitchEnabled: true,
          rotateEnabled: true,
        }}
        onCameraChanged={(state) => {
          currentZoomRef.current = state.properties.zoom;
          const [longitude, latitude] = state.properties.center;
          if (state.gestures.isGestureActive && !gestureActiveRef.current) {
            gestureActiveRef.current = true;
            setCameraMode("USER_CONTROLLED", "manual_gesture");
            setFollowEnabled(false);
            recordLiveAthletePosition("LIVE_ATHLETE_FOLLOW", {
              participantUuid: activeAthleteId,
              cameraMode: "USER_CONTROLLED",
              following: false,
              reason: "manual_gesture",
            });
            recordLiveMapGesture("START", {
              cameraMode: "USER_CONTROLLED",
              latitude,
              longitude,
              zoom: state.properties.zoom,
            });
          }
        }}
        onMapIdle={(state) => {
          if (!gestureActiveRef.current || !eventReference) return;
          gestureActiveRef.current = false;
          const [longitude, latitude] = state.properties.center;
          const result = constrainCameraCenter(eventReference, {
            lat: latitude,
            lng: longitude,
          });
          recordLiveMapGesture("END", {
            latitude,
            longitude,
            zoom: state.properties.zoom,
            distanceFromEventCenterKm: result.distanceKm,
            constrained: result.constrained,
          });
          if (result.constrained) {
            recordLiveMapCameraCommand({
              command: "setCamera",
              reason: "boundary",
              mode: cameraModeRef.current,
              allowed: true,
            });
            cameraRef.current?.setCamera({
              centerCoordinate: [result.center.lng, result.center.lat],
              zoomLevel: state.properties.zoom,
              animationMode: "easeTo",
              animationDuration: 180,
            });
          }
        }}
        onDidFinishLoadingStyle={() =>
          setStyleRevision((current) => current + 1)
        }
      >
        <Camera
          ref={cameraRef}
          minZoomLevel={minimumZoom}
          maxZoomLevel={20}
          maxBounds={explorationBounds ?? undefined}
          defaultSettings={
            courseBounds
              ? {
                  bounds: courseBounds,
                  padding: cameraPadding,
                  pitch: mapDimension === "3d" ? 45 : 0,
                  heading: 0,
                }
              : undefined
          }
        />

        <ShapeSource id={COURSE_SOURCE_ID} shape={courseShape}>
          <LineLayer
            id="bergman-course-lines"
            style={{
              visibility: showRoute ? "visible" : "none",
              lineColor: COURSE_COLOR as never,
              lineWidth: COURSE_LINE_WIDTH as never,
              lineCap: "round",
              lineJoin: "round",
              lineOpacity: 0.9,
            }}
          />
        </ShapeSource>

        <ShapeSource id={DISTANCE_SOURCE_ID} shape={distanceShape}>
          <CircleLayer
            id="bergman-major-distance-circles"
            filter={["==", ["get", "major"], true] as never}
            style={{
              visibility: showDistance ? "visible" : "none",
              circleColor: DISCIPLINE_COLOR as never,
              circleRadius: [
                "interpolate",
                ["linear"],
                ["zoom"],
                8,
                8,
                18,
                11,
              ] as never,
              circleStrokeColor: "#FFFFFF",
              circleStrokeWidth: 1.5,
            }}
          />
          <SymbolLayer
            id="bergman-major-distance-numbers"
            filter={["==", ["get", "major"], true] as never}
            style={{
              visibility: showDistance ? "visible" : "none",
              textField: ["get", "number"] as never,
              textColor: "#FFFFFF",
              textSize: [
                "interpolate",
                ["linear"],
                ["zoom"],
                8,
                9,
                18,
                11,
              ] as never,
              textFont: ["Open Sans Bold", "Arial Unicode MS Bold"],
              textAllowOverlap: false,
              textIgnorePlacement: false,
              textOptional: false,
              symbolSortKey: 20,
            }}
          />
          <CircleLayer
            id="bergman-minor-distance-circles"
            minZoomLevel={Math.min(18, overviewZoom + 2.5)}
            filter={["==", ["get", "major"], false] as never}
            style={{
              visibility: showDistance ? "visible" : "none",
              circleColor: DISCIPLINE_COLOR as never,
              circleRadius: 3,
              circleOpacity: 0.72,
              circleStrokeColor: "#FFFFFF",
              circleStrokeWidth: 1,
            }}
          />
        </ShapeSource>

        <ShapeSource id={LANDMARK_SOURCE_ID} shape={landmarkShape}>
          <CircleLayer
            id="bergman-landmark-circles"
            style={{
              visibility: showSplits ? "visible" : "none",
              circleColor: [
                "match",
                ["get", "kind"],
                "start",
                "#16A34A",
                "finish",
                "#111827",
                "transition",
                "#7C3AED",
                DISCIPLINE_COLOR,
              ] as never,
              circleRadius: [
                "match",
                ["get", "kind"],
                "start",
                10,
                "finish",
                11,
                "transition",
                7,
                8,
              ] as never,
              circleStrokeColor: "#FFFFFF",
              circleStrokeWidth: 2,
            }}
          />
          <CircleLayer
            id="bergman-timing-point-inner-rings"
            filter={["==", ["get", "kind"], "timing"] as never}
            style={{
              visibility: showSplits ? "visible" : "none",
              circleColor: "#FFFFFF",
              circleRadius: 4.5,
              circleStrokeColor: DISCIPLINE_COLOR as never,
              circleStrokeWidth: 1,
            }}
          />
          <CircleLayer
            id="bergman-timing-point-centers"
            filter={["==", ["get", "kind"], "timing"] as never}
            style={{
              visibility: showSplits ? "visible" : "none",
              circleColor: DISCIPLINE_COLOR as never,
              circleRadius: 1.5,
            }}
          />
          <SymbolLayer
            id="bergman-landmark-symbols"
            style={{
              visibility: showSplits ? "visible" : "none",
              textField: [
                "match",
                ["get", "kind"],
                "start",
                "S",
                "finish",
                "F",
                "transition",
                "T",
                "",
              ] as never,
              textColor: "#FFFFFF",
              textSize: 10,
              textFont: ["Open Sans Bold", "Arial Unicode MS Bold"],
              textAllowOverlap: true,
              symbolSortKey: 40,
            }}
          />
        </ShapeSource>

        <ShapeSource
          id={ATHLETE_SOURCE_ID}
          shape={athleteShape}
          hitbox={{ width: 44, height: 44 }}
          onPress={(event) => {
            const index = Number(event.features[0]?.properties?.athleteIndex);
            if (Number.isInteger(index) && validAthletes[index]) {
              onAthletePress?.(validAthletes[index], index);
            }
          }}
        >
          <CircleLayer
            id="bergman-athlete-circles"
            filter={["==", ["get", "role"], "athlete"] as never}
            style={{
              circleColor: ["get", "color"] as never,
              circleRadius: 5.5,
              circleStrokeColor: "#FFFFFF",
              circleStrokeWidth: 1.5,
              circleOpacity: ["case", SELECTED_STATE, 0, 1] as never,
            }}
          />
          <SymbolLayer
            id="bergman-athlete-labels"
            filter={["==", ["get", "role"], "athlete"] as never}
            style={{
              textField: showAthleteLabels ? (["get", "label"] as never) : "",
              textColor: "#FFFFFF",
              textOpacity: ["case", SELECTED_STATE, 0, 1] as never,
              textSize: 9,
              textFont: ["Open Sans Bold", "Arial Unicode MS Bold"],
              textHaloColor: "#334155",
              textHaloWidth: 2,
              textAllowOverlap: false,
              textIgnorePlacement: false,
              symbolSortKey: 60,
            }}
          />
        </ShapeSource>
        {activeAthlete ? (
          <SelectedAthleteMarker athlete={activeAthlete} />
        ) : null}
      </MapView>

      <View
        pointerEvents="box-none"
        style={[
          styles.mapButtons,
          { top: controlsOffsetTop, right: controlsOffsetRight },
        ]}
      >
        {activeAthlete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refocus selected athlete"
            onPress={() => focusAthlete(true, true)}
            style={[
              styles.mapButton,
              {
                backgroundColor:
                  cameraMode === "ATHLETE_FOCUS" ? "#111827" : "#FFFFFF",
              },
            ]}
          >
            <Icon
              name="user"
              size={15}
              colorValue={
                cameraMode === "ATHLETE_FOCUS" ? "#FFFFFF" : "#111827"
              }
            />
            <Text
              variant="caption"
              style={{
                color: cameraMode === "ATHLETE_FOCUS" ? "#FFFFFF" : "#111827",
                fontWeight: "900",
              }}
            >
              ATHLETE
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fit complete course"
          onPress={() => {
            setFollowEnabled(false);
            setCameraMode("COURSE_FIT", "explicit_course_fit");
            fitCourse(true, "course_fit");
          }}
          style={[styles.mapButton, { backgroundColor: "#FFFFFF" }]}
        >
          <Icon name="maximize" size={15} colorValue="#111827" />
          <Text variant="caption" style={styles.mapButtonText}>
            COURSE
          </Text>
        </Pressable>
        {showMapControls && onMapTypeChange ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change map style"
            onPress={() =>
              onMapTypeChange(mapType === "standard" ? "satellite" : "standard")
            }
            style={[styles.mapButton, { backgroundColor: "#FFFFFF" }]}
          >
            <Icon name="map" size={15} colorValue="#111827" />
          </Pressable>
        ) : null}
      </View>

      {refreshError ? (
        <View pointerEvents="none" style={styles.refreshNotice}>
          <Text variant="caption" color="textSecondary">
            Map refresh failed. Showing the last saved course.
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (fullBleed) {
    return (
      <View style={{ flex: 1, width: "100%", minHeight: "100%" }}>
        {mapContent}
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={[styles.mapWrap, { borderRadius: theme.radius.large }]}>
        {mapContent}
      </View>
      {compact ? null : (
        <Card>
          <Text variant="body" color="textSecondary">
            {map.legs.map((leg) => leg.label).join(" → ")}
          </Text>
        </Card>
      )}
      {compact || cutoffSummary.length === 0 ? null : (
        <Card
          style={{
            gap: theme.spacing.xs,
            backgroundColor: theme.colors.surfaceElevated,
          }}
        >
          <Text variant="headline">Cutoff</Text>
          {cutoffSummary.map((line) => (
            <Text key={line} variant="bodySmall" color="textSecondary">
              {line}
            </Text>
          ))}
        </Card>
      )}
    </View>
  );
}

export const CourseMapView = memo(
  CourseMapViewComponent,
  (previous, next) =>
    previous.map === next.map &&
    previous.loading === next.loading &&
    previous.refreshError === next.refreshError &&
    previous.compact === next.compact &&
    previous.fullBleed === next.fullBleed &&
    previous.mapType === next.mapType &&
    previous.mapDimension === next.mapDimension &&
    previous.bottomSafeArea === next.bottomSafeArea &&
    previous.followSelectedAthlete === next.followSelectedAthlete &&
    previous.cutoffMinutes === next.cutoffMinutes &&
    previous.cutoffs === next.cutoffs &&
    sameMapPreferences(previous.mapPreferences, next.mapPreferences) &&
    sameAthleteMarkers(previous.athletes ?? [], next.athletes ?? []),
);
CourseMapView.displayName = "CourseMapView";

const styles = StyleSheet.create({
  mapWrap: { height: 300, overflow: "hidden" },
  mapButtons: {
    position: "absolute",
    alignItems: "flex-end",
    gap: 8,
    zIndex: 20,
    elevation: 20,
  },
  mapButton: {
    minHeight: 38,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.16)",
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  mapButtonText: { color: "#111827", fontWeight: "900" },
  athleteMarker: {
    width: 42,
    alignItems: "center",
  },
  athleteMarkerIdentity: {
    width: 34,
    height: 34,
    borderRadius: 7,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  athleteMarkerAvatar: { width: 30, height: 30 },
  athleteMarkerInitials: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  athleteMarkerBib: {
    minWidth: 38,
    maxWidth: 54,
    height: 17,
    marginTop: -2,
    paddingHorizontal: 4,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#FFFFFF",
  },
  athleteMarkerBibText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
  },
  refreshNotice: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
});
