import type { LatLng } from "@/core/types";
import type { CourseMapViewModel } from "./mappers";

import { haversineMeters } from "../engine/geo";

export const LIVE_MAP_MAX_RADIUS_KM = 100;

export type LiveMapCameraMode =
  "INITIAL_FIT" | "USER_CONTROLLED" | "ATHLETE_FOCUS" | "COURSE_FIT";

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function courseReferencePoint(
  map: Pick<CourseMapViewModel, "mergedPath" | "bounds">,
): LatLng | null {
  const start = map.mergedPath.find(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
  );
  if (start) return { lat: start.lat, lng: start.lng };
  if (!map.bounds) return null;
  return {
    lat: (map.bounds.minLat + map.bounds.maxLat) / 2,
    lng: (map.bounds.minLng + map.bounds.maxLng) / 2,
  };
}

export function distanceFromReferenceKm(
  reference: LatLng,
  center: LatLng,
): number {
  return haversineMeters(reference, center) / 1_000;
}

function initialBearingRadians(from: LatLng, to: LatLng): number {
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  return Math.atan2(
    Math.sin(deltaLng) * Math.cos(toLat),
    Math.cos(fromLat) * Math.sin(toLat) -
      Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng),
  );
}

function destinationPoint(
  from: LatLng,
  bearingRadians: number,
  distanceMeters: number,
): LatLng {
  const angularDistance = distanceMeters / EARTH_RADIUS_M;
  const fromLat = toRadians(from.lat);
  const fromLng = toRadians(from.lng);
  const lat = Math.asin(
    Math.sin(fromLat) * Math.cos(angularDistance) +
      Math.cos(fromLat) * Math.sin(angularDistance) * Math.cos(bearingRadians),
  );
  const lng =
    fromLng +
    Math.atan2(
      Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(fromLat),
      Math.cos(angularDistance) - Math.sin(fromLat) * Math.sin(lat),
    );
  return {
    lat: toDegrees(lat),
    lng: ((toDegrees(lng) + 540) % 360) - 180,
  };
}

export function constrainCameraCenter(
  reference: LatLng,
  candidate: LatLng,
  maximumRadiusKm = LIVE_MAP_MAX_RADIUS_KM,
): { center: LatLng; constrained: boolean; distanceKm: number } {
  const distanceKm = distanceFromReferenceKm(reference, candidate);
  if (!Number.isFinite(distanceKm) || distanceKm <= maximumRadiusKm) {
    return { center: candidate, constrained: false, distanceKm };
  }
  return {
    center: destinationPoint(
      reference,
      initialBearingRadians(reference, candidate),
      maximumRadiusKm * 1_000,
    ),
    constrained: true,
    distanceKm,
  };
}

export function radiusBounds(
  reference: LatLng,
  radiusKm = LIVE_MAP_MAX_RADIUS_KM,
): { ne: [number, number]; sw: [number, number] } {
  const north = destinationPoint(reference, 0, radiusKm * 1_000);
  const east = destinationPoint(reference, Math.PI / 2, radiusKm * 1_000);
  const south = destinationPoint(reference, Math.PI, radiusKm * 1_000);
  const west = destinationPoint(reference, -Math.PI / 2, radiusKm * 1_000);
  return {
    ne: [east.lng, north.lat],
    sw: [west.lng, south.lat],
  };
}

export function cameraCommandAllowed(
  mode: LiveMapCameraMode,
  command:
    "initial_fit" | "athlete_focus" | "course_fit" | "follow" | "boundary",
): boolean {
  if (command === "boundary") return true;
  if (command === "initial_fit") return mode === "INITIAL_FIT";
  if (command === "athlete_focus") return mode === "ATHLETE_FOCUS";
  if (command === "course_fit") return mode === "COURSE_FIT";
  return mode === "ATHLETE_FOCUS";
}
