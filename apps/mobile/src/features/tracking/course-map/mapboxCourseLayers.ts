import type { Feature, FeatureCollection, LineString, Point } from "geojson";

import type { TrackAthlete } from "./components/CourseTrackCanvas";
import type {
  CourseLegView,
  CourseMapViewModel,
  CourseMarkerView,
} from "./mappers";

export const COURSE_COLORS = {
  swim: "#0EA5E9",
  bike: "#F5821F",
  run: "#DC2626",
  transition: "#64748B",
  other: "#334155",
} as const;

export const COURSE_SOURCE_ID = "bergman-course-source";
export const DISTANCE_SOURCE_ID = "bergman-distance-source";
export const LANDMARK_SOURCE_ID = "bergman-landmark-source";
export const ATHLETE_SOURCE_ID = "bergman-athlete-source";

type Discipline = keyof typeof COURSE_COLORS;

type CourseProperties = {
  id: string;
  discipline: Discipline;
  transition: boolean;
};

type MarkerProperties = {
  id: string;
  discipline: Discipline;
  label: string;
  number: string;
  kind: CourseMarkerView["kind"];
  major: boolean;
};

type AthleteProperties = {
  id: string;
  role: "athlete";
  athleteIndex: number;
  bib: string;
  label: string;
  color: string;
};

const validCoordinate = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

export function disciplineForSegment(segment: string | undefined): Discipline {
  const value = String(segment ?? "")
    .trim()
    .toLowerCase();
  if (value.includes("swim")) return "swim";
  if (value.includes("bike") || value.includes("cycl")) return "bike";
  if (value.includes("run")) return "run";
  if (value.includes("transition") || /^t\d*$/.test(value)) return "transition";
  return "other";
}

function lineFeature(
  id: string,
  discipline: Discipline,
  coordinates: [number, number][],
  transition = false,
): Feature<LineString, CourseProperties> | null {
  const valid = coordinates.filter(([lng, lat]) => validCoordinate(lat, lng));
  if (valid.length < 2) return null;
  return {
    type: "Feature",
    id,
    properties: { id, discipline, transition },
    geometry: { type: "LineString", coordinates: valid },
  };
}

export function buildCourseGeoJson(
  legs: CourseLegView[],
  transitionPaths: {
    id: string;
    path: { lat: number; lng: number }[];
  }[],
): FeatureCollection<LineString, CourseProperties> {
  const features = legs.flatMap((leg) => {
    const feature = lineFeature(
      leg.id,
      disciplineForSegment(leg.segment),
      leg.path.map((point) => [point.lng, point.lat]),
    );
    return feature ? [feature] : [];
  });
  for (const connector of transitionPaths) {
    const feature = lineFeature(
      connector.id,
      "transition",
      connector.path.map((point) => [point.lng, point.lat]),
      true,
    );
    if (feature) features.push(feature);
  }
  return { type: "FeatureCollection", features };
}

function isDistanceMarker(marker: CourseMarkerView): boolean {
  return (
    marker.distanceKm != null &&
    (marker.sourceId?.startsWith("gpx-distance-") === true ||
      (marker.source === "geometry" && marker.kind === "timing"))
  );
}

export function majorDistanceInterval(segment: string | undefined): number {
  const discipline = disciplineForSegment(segment);
  if (discipline === "swim") return 1;
  if (discipline === "bike") return 10;
  if (discipline === "run") return 5;
  return Number.POSITIVE_INFINITY;
}

function distanceNumber(marker: CourseMarkerView): string {
  const distance = marker.distanceKm ?? 0;
  return Number.isInteger(distance)
    ? String(distance)
    : distance.toFixed(1).replace(/\.0$/, "");
}

function markerFeature(
  marker: CourseMarkerView,
): Feature<Point, MarkerProperties> | null {
  if (!validCoordinate(marker.position.lat, marker.position.lng)) return null;
  const discipline = disciplineForSegment(marker.segment);
  const interval = majorDistanceInterval(marker.segment);
  const distance = marker.distanceKm ?? 0;
  const nearestInterval = Math.round(distance / interval) * interval;
  const major =
    Number.isFinite(interval) && Math.abs(distance - nearestInterval) < 0.01;
  return {
    type: "Feature",
    id: marker.id,
    properties: {
      id: marker.id,
      discipline,
      label: marker.label,
      number: distanceNumber(marker),
      kind: marker.kind,
      major,
    },
    geometry: {
      type: "Point",
      coordinates: [marker.position.lng, marker.position.lat],
    },
  };
}

export function buildDistanceGeoJson(
  markers: CourseMarkerView[],
): FeatureCollection<Point, MarkerProperties> {
  return {
    type: "FeatureCollection",
    features: markers.flatMap((marker) => {
      if (!isDistanceMarker(marker)) return [];
      const feature = markerFeature(marker);
      return feature ? [feature] : [];
    }),
  };
}

export function buildLandmarkGeoJson(
  markers: CourseMarkerView[],
): FeatureCollection<Point, MarkerProperties> {
  return {
    type: "FeatureCollection",
    features: markers.flatMap((marker) => {
      if (isDistanceMarker(marker)) return [];
      const feature = markerFeature(marker);
      return feature ? [feature] : [];
    }),
  };
}

function athleteColor(seed: string): string {
  const palette = ["#2563EB", "#7C3AED", "#0891B2", "#059669", "#C2410C"];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function athleteSourceSignature(athletes: TrackAthlete[]): string {
  return athletes
    .map((athlete, index) =>
      [
        athlete.id ?? athlete.bib ?? athlete.name ?? index,
        athlete.position.lat,
        athlete.position.lng,
        athlete.bib ?? "",
        athlete.name,
        athlete.colorSeed ?? "",
      ].join(":"),
    )
    .join("|");
}

export function buildAthleteGeoJson(
  athletes: TrackAthlete[],
): FeatureCollection<Point, AthleteProperties> {
  return {
    type: "FeatureCollection",
    features: athletes.flatMap((athlete, athleteIndex) => {
      if (!validCoordinate(athlete.position.lat, athlete.position.lng))
        return [];
      const id = String(
        athlete.id ?? athlete.bib ?? athlete.name ?? athleteIndex,
      );
      const bib = String(athlete.bib ?? "").trim();
      const fallback = athlete.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("");
      const properties = {
        id,
        athleteIndex,
        bib,
        label: bib || fallback || "ATHLETE",
        color: athleteColor(athlete.colorSeed ?? athlete.name ?? id),
      };
      const coordinates = [athlete.position.lng, athlete.position.lat];
      return [
        {
          type: "Feature" as const,
          id,
          properties: {
            ...properties,
            role: "athlete" as const,
          },
          geometry: {
            type: "Point" as const,
            coordinates,
          },
        },
      ];
    }),
  };
}

export function paddedCourseBounds(map: CourseMapViewModel): {
  ne: [number, number];
  sw: [number, number];
} | null {
  const bounds = map.bounds;
  if (!bounds) return null;
  const latitudeSpan = Math.max(bounds.maxLat - bounds.minLat, 0.002);
  const longitudeSpan = Math.max(bounds.maxLng - bounds.minLng, 0.002);
  const latitudePadding = latitudeSpan * 0.35;
  const longitudePadding = longitudeSpan * 0.35;
  return {
    ne: [bounds.maxLng + longitudePadding, bounds.maxLat + latitudePadding],
    sw: [bounds.minLng - longitudePadding, bounds.minLat - latitudePadding],
  };
}

function mercatorY(latitude: number): number {
  const radians = (Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

export function overviewZoomLevel(
  map: CourseMapViewModel,
  width: number,
  height: number,
  bottomSafeArea: number,
): number {
  const bounds = map.bounds;
  if (!bounds) return 12;
  const usableWidth = Math.max(160, width - 64);
  const usableHeight = Math.max(
    160,
    height - Math.min(bottomSafeArea, height * 0.42) - 112,
  );
  const longitudeFraction = Math.max(
    (bounds.maxLng - bounds.minLng) / 360,
    1e-7,
  );
  const latitudeFraction = Math.max(
    Math.abs(mercatorY(bounds.maxLat) - mercatorY(bounds.minLat)) /
      (2 * Math.PI),
    1e-7,
  );
  const longitudeZoom = Math.log2(usableWidth / 512 / longitudeFraction);
  const latitudeZoom = Math.log2(usableHeight / 512 / latitudeFraction);
  return Math.max(3, Math.min(18, Math.min(longitudeZoom, latitudeZoom)));
}
