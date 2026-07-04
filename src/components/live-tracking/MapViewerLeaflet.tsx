// src/components/live-tracking/MapViewerLeaflet.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Waves, ChevronsRight, Bike, Footprints, Flag } from 'lucide-react';
import type { LiveAthlete, Split, CustomSplitPoint } from '@/lib/types';
import ElevationProfileChart from './ElevationProfileChart';
import { interpolatePositionFromPaths } from '@/lib/utils';

// Fix Leaflet default icon issue in Next.js
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const getInitials = (name?: string | null) => {
    if (!name) return '';
    const names = name?.split(' ') ?? [];
    if (names.length > 1) { return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase(); }
    return name?.substring(0, 2).toUpperCase() ?? '';
};

const LegIcon = ({ leg }: { leg: Split['segment'] }) => {
  switch (leg) {
    case 'SWIM': return <Waves className="h-3 w-3 text-white" />;
    case 'T1': case 'T2': return <ChevronsRight className="h-3 w-3 text-white" />;
    case 'BIKE': return <Bike className="h-3 w-3 text-white" />;
    case 'RUN': return <Footprints className="h-3 w-3 text-white" />;
    case 'RUN1': return <Footprints className="h-3 w-3 text-white" />;
    case 'RUN2': return <Footprints className="h-3 w-3 text-white" />;
    case 'FINISHED': return <Flag className="h-3 w-3 text-white" />;
    default: return null;
  }
};

export interface GpxPath {
    path: { lat: number; lng: number }[];
    color: string;
    elevationData: { distance: number; elevation: number }[];
    kmMarkers: { pos: { lat: number; lng: number }; label: string }[];
}

interface MapViewerProps {
  routes: { url: string; color: string; type?: string; assetKey?: string; splitPoints?: CustomSplitPoint[] }[];
  trackedAthletes: LiveAthlete[];
  focusedAthlete: LiveAthlete | null;
  containerStyle?: React.CSSProperties;
  showKmMarkers?: boolean;
  visibleRouteIndices?: number[];
  onGpxDataLoaded?: (gpxPaths: GpxPath[]) => void;
}

// Parse GPX file and extract path data
const parseGpxData = async (gpxUrl: string, color: string): Promise<GpxPath | null> => {
  try {
    const response = await fetch(gpxUrl);
    const text = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'text/xml');
    
    const trkpts = xmlDoc.querySelectorAll('trkpt');
    if (!trkpts.length) return null;

    const path: { lat: number; lng: number }[] = [];
    const elevationData: { distance: number; elevation: number }[] = [];
    const kmMarkers: { pos: { lat: number; lng: number }; label: string }[] = [];

    let totalDistance = 0;
    let lastPos: { lat: number; lng: number } | null = null;
    let lastKmMarker = 0;

    const calculateDistance = (
      lat1: number,
      lng1: number,
      lat2: number,
      lng2: number
    ): number => {
      const R = 6371; // Earth radius in km
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    trkpts.forEach((trkpt) => {
      const lat = parseFloat(trkpt.getAttribute('lat') || '0');
      const lng = parseFloat(trkpt.getAttribute('lon') || '0');
      const eleNode = trkpt.querySelector('ele');
      const elevation = eleNode ? parseFloat(eleNode.textContent || '0') : 0;

      const pos = { lat, lng };
      path.push(pos);

      if (lastPos) {
        totalDistance += calculateDistance(lastPos.lat, lastPos.lng, lat, lng);
      }
      lastPos = pos;

      if (totalDistance - lastKmMarker >= 1) {
        kmMarkers.push({
          pos,
          label: `${Math.floor(totalDistance)} km`,
        });
        lastKmMarker = totalDistance;
      }

      elevationData.push({
        distance: totalDistance,
        elevation,
      });
    });

    return { path, color, elevationData, kmMarkers };
  } catch (err) {
    console.error('Failed to parse GPX:', err);
    return null;
  }
};

// Map bounds fitter component
const MapBoundsFitter: React.FC<{ gpxPaths: GpxPath[] }> = ({ gpxPaths }) => {
  const map = useMap();

  useEffect(() => {
    if (!gpxPaths || gpxPaths.length === 0 || !map) return;

    const bounds = L.latLngBounds([]);
    gpxPaths.forEach((path) => {
      if (path.path && path.path.length > 0) {
        path.path.forEach((pt) => {
          bounds.extend([pt.lat, pt.lng]);
        });
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [gpxPaths, map]);

  return null;
};

export default function MapViewer({
  routes,
  trackedAthletes,
  focusedAthlete,
  containerStyle,
  showKmMarkers = true,
  visibleRouteIndices,
  onGpxDataLoaded,
}: MapViewerProps) {
  // All hooks must be called in the same order on every render
  const [gpxPaths, setGpxPaths] = useState<GpxPath[]>([]);
  const [isGpxLoading, setIsGpxLoading] = useState(true);

  const getLastRecordedSplit = useCallback((athlete: LiveAthlete) => {
    const sorted = [...(athlete.splits || [])]
      .filter((s) => typeof s.time === 'number' && s.time > 0)
      .sort((a, b) => (a.time || 0) - (b.time || 0));
    return sorted[sorted.length - 1] || null;
  }, []);

  const getTrackingStatus = useCallback(
    (athlete: LiveAthlete) => {
      const nowSec = Date.now() / 1000;
      const lastRecordedSplit = getLastRecordedSplit(athlete);
      const isOverdueForNextSplit =
        athlete.status === 'On Course' &&
        typeof athlete.etaNextSplitUTC === 'number' &&
        athlete.etaNextSplitUTC > 0 &&
        nowSec > athlete.etaNextSplitUTC;

      return {
        lastRecordedSplit,
        isOverdueForNextSplit,
        sinceLabel: athlete.lastUpdateTime
          ? new Date(athlete.lastUpdateTime).toLocaleTimeString()
          : 'unknown time',
      };
    },
    [getLastRecordedSplit]
  );

  const getAthletePosition = useCallback(
    (athlete: LiveAthlete) => {
      const trackingStatus = getTrackingStatus(athlete);

      if (
        trackingStatus.isOverdueForNextSplit &&
        trackingStatus.lastRecordedSplit &&
        gpxPaths.length > 0
      ) {
        return interpolatePositionFromPaths(
          gpxPaths,
          trackingStatus.lastRecordedSplit.distance || 0
        );
      }

      // 1. Prioritize live predicted location
      if (athlete.predictedLocation) {
        return athlete.predictedLocation;
      }
      // 2. If historical, interpolate position based on progress
      if (
        gpxPaths.length > 0 &&
        typeof athlete.courseProgress === 'number' &&
        athlete.courseProgress > 0
      ) {
        return interpolatePositionFromPaths(gpxPaths, athlete.courseProgress);
      }

      // 3. Default to first waypoint
      return gpxPaths[0]?.path?.[0] || null;
    },
    [getTrackingStatus, gpxPaths]
  );

  // Load all GPX files
  useEffect(() => {
    if (!routes || routes.length === 0) {
      setIsGpxLoading(false);
      setGpxPaths([]);
      return;
    }

    (async () => {
      setIsGpxLoading(true);
      const paths: GpxPath[] = [];

      for (const route of routes) {
        const gpxPath = await parseGpxData(route.url, route.color);
        if (gpxPath) {
          paths.push(gpxPath);
        } else {
          paths.push({ path: [], color: route.color, elevationData: [], kmMarkers: [] });
        }
      }

      setGpxPaths(paths);
      onGpxDataLoaded?.(paths);
      setIsGpxLoading(false);
    })();
  }, [routes, onGpxDataLoaded]);

  const visiblePaths = useMemo(() => {
    if (!visibleRouteIndices?.length) return gpxPaths;
    return gpxPaths.filter((_, idx) => visibleRouteIndices.includes(idx));
  }, [gpxPaths, visibleRouteIndices]);

  const defaultCenter: [number, number] = [40.7128, -74.006]; // NYC fallback

  // Always render the component, even while loading
  if (isGpxLoading) {
    return (
      <div
        style={containerStyle}
        className="relative w-full bg-muted rounded-lg flex items-center justify-center"
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <MapContainer
      center={defaultCenter as [number, number]}
      zoom={13}
      style={{ ...containerStyle, height: containerStyle?.height || '500px', width: '100%' }}
      className="rounded-lg overflow-hidden"
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
        crossOrigin="anonymous"
      />

      <MapBoundsFitter gpxPaths={visiblePaths} />

      {/* Render routes */}
      {visiblePaths.map((path, idx) => (
        <React.Fragment key={idx}>
          {path.path.length > 1 && (
            <Polyline
              positions={path.path.map((pt) => [pt.lat, pt.lng] as [number, number])}
              pathOptions={{ color: path.color, weight: 5, opacity: 0.8 }}
            />
          )}

          {/* KM Markers */}
          {showKmMarkers &&
            path.kmMarkers.map((marker, idx) => (
              <Marker key={`km-${idx}`} position={[marker.pos.lat, marker.pos.lng] as [number, number]}>
                <Popup>{marker.label}</Popup>
              </Marker>
            ))}
        </React.Fragment>
      ))}

      {/* Render tracked athletes */}
      {trackedAthletes.map((athlete) => {
        const pos = getAthletePosition(athlete);
        if (!pos) return null;

        const lastSplit = getLastRecordedSplit(athlete);
        const trackingStatus = getTrackingStatus(athlete);
        const athleteKey = athlete.name || `athlete-${athlete.id}`;

        return (
          <Marker
            key={athleteKey}
            position={[pos.lat, pos.lng] as [number, number]}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-bold">{athlete.name}</p>
                <p>{athlete.status}</p>
                {lastSplit && <p>{lastSplit.segment}: {lastSplit.time?.toFixed(0)}s</p>}
                <p className="text-xs text-gray-500">{trackingStatus.sinceLabel}</p>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
