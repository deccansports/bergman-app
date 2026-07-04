import type { BroadcastCamera } from '@/lib/types/broadcast';

function toRad(v: number) {
  return (v * Math.PI) / 180;
}

export function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const aa = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(aa));
}

export function findNearestActiveCamera(params: {
  athleteLat?: number | null;
  athleteLng?: number | null;
  cameras: BroadcastCamera[];
}) {
  const { athleteLat, athleteLng, cameras } = params;
  if (!Number.isFinite(Number(athleteLat)) || !Number.isFinite(Number(athleteLng))) return null;

  const active = cameras.filter((c) => c.status === 'live' && Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude)));
  if (active.length === 0) return null;

  const anchor = { lat: Number(athleteLat), lng: Number(athleteLng) };
  const nearest = active
    .map((camera) => ({ camera, distanceMeters: haversineDistanceMeters(anchor, { lat: Number(camera.latitude), lng: Number(camera.longitude) }) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];

  if (!nearest) return null;
  const withinCoverage = Number.isFinite(Number(nearest.camera.coverageRadius))
    ? nearest.distanceMeters <= Number(nearest.camera.coverageRadius)
    : true;

  return {
    camera: nearest.camera,
    distanceMeters: nearest.distanceMeters,
    withinCoverage,
    etaSeconds: Math.round(nearest.distanceMeters / 3.5),
  };
}
