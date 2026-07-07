// src/components/live-tracking/MapViewer.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GoogleMap, Polyline, Marker, InfoWindow, useJsApiLoader, OverlayView } from '@react-google-maps/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Waves, ChevronsRight, Bike, Footprints, Flag, Clock } from 'lucide-react';
import type { LiveAthlete, Split, CustomSplitPoint } from '@/lib/types';
import ElevationProfileChart from './ElevationProfileChart';
import { interpolatePositionFromPaths } from '@/lib/utils'; // NEW IMPORT
import { GOOGLE_MAPS_LIBRARIES } from '@/lib/googleMaps';

const getInitials = (name?: string | null) => {
    if (!name) return '';
    const names = name?.split(' ') ?? [];
    if (names.length > 1) { return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase(); }
    return name?.substring(0, 2).toUpperCase() ?? '';
};

const getLegIcon = (leg?: string | null) => {
    const legUpper = String(leg || '').toUpperCase();
    if (/SWIM/.test(legUpper)) return '🏊';
    if (/BIKE/.test(legUpper)) return '🚴';
    if (/RUN|FOOTPRINTS/.test(legUpper)) return '🏃';
    if (/T[12]|TRANSITION/.test(legUpper)) return '🔄';
    if (/FINISH|FINISHED/.test(legUpper)) return '🏁';
    if (/START|NOT.STARTED/.test(legUpper)) return '⏳';
    return '⏳';
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

type SplitMarkerKind = 'start' | 'swim' | 'bike' | 'run' | 'transition' | 'finish';

type RouteSplitPoint = CustomSplitPoint & {
  leg?: string | null;
  splitType?: string | null;
  markerType?: string | null;
  timingPoint?: string | null;
  timingPointId?: string | null;
  device?: string | null;
  cutoff?: string | null;
  cutoffTime?: string | null;
  cutoffMinutes?: number | null;
  order?: number | null;
};

type RouteMarker = {
  id: string;
  kind: SplitMarkerKind;
  label: string;
  distanceKm: number | null;
  position: google.maps.LatLngLiteral;
  details: string[];
};

const SPLIT_ICON_BY_KIND: Record<SplitMarkerKind, { emoji: string; color: string }> = {
  start: { emoji: '🟢', color: '#16a34a' },
  swim: { emoji: '🏊', color: '#0ea5e9' },
  bike: { emoji: '🚴', color: '#22c55e' },
  run: { emoji: '🏃', color: '#f97316' },
  transition: { emoji: '🔄', color: '#8b5cf6' },
  finish: { emoji: '🏁', color: '#eab308' },
};

function buildClockMarkerIcon(color: string, scale = 30): google.maps.Icon {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="21" fill="white" stroke="${color}" stroke-width="4" />
      <circle cx="32" cy="32" r="2.75" fill="#111827" />
      <path d="M32 20V32L39.5 36.5" stroke="#111827" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M24 14.5H40" stroke="#111827" stroke-width="2.4" stroke-linecap="round" opacity="0.75" />
    </svg>
  `;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(scale, scale),
    anchor: new window.google.maps.Point(scale / 2, scale / 2),
  };
}

function inferSplitMarkerKind(route: { type?: string; assetKey?: string }, splitPoint: RouteSplitPoint, splitIndex: number, routeIndex: number, routeCount: number): SplitMarkerKind {
  const text = [
    splitPoint?.splitType,
    splitPoint?.markerType,
    splitPoint?.leg,
    splitPoint?.name,
    splitPoint?.id,
    route?.assetKey,
    route?.type,
  ].map((value) => String(value || '').trim().toLowerCase()).join(' ');

  if (/finish/.test(text) || (routeIndex === routeCount - 1 && /finish|end/.test(text))) return 'finish';
  if (/transition|t1|t2/.test(text)) return 'transition';
  if (routeIndex === 0 && splitIndex === 0 && (/start/.test(text) || Number(splitPoint.distance || 0) <= 0)) return 'start';
  if (/swim/.test(text) || route?.type === 'swim') return 'swim';
  if (/bike/.test(text) || route?.type === 'bike') return 'bike';
  if (/run/.test(text) || route?.type === 'run') return 'run';
  return routeIndex === 0 ? 'start' : 'transition';
}

function formatSplitDetails(splitPoint: RouteSplitPoint, kind: SplitMarkerKind, routeType?: string) {
  const distanceKm = Number(splitPoint?.distance || 0);
  const timingPoint = String(splitPoint.timingPoint || splitPoint.timingPointId || '').trim();
  const device = String(splitPoint.device || '').trim();
  const cutoff = String(splitPoint.cutoff || splitPoint.cutoffTime || '').trim();

  return [
    `Leg: ${String(splitPoint.leg || routeType || kind).toUpperCase()}`,
    `Distance: ${Number.isFinite(distanceKm) ? `${distanceKm.toFixed(2)} km` : '—'}`,
    `Timing point/device: ${timingPoint || device || '—'}`,
    `Cutoff: ${cutoff || '—'}`,
  ];
}

function parseDistanceKm(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim();
  if (!text) return NaN;
  const normalized = text.replace(/,/g, '.');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}


export interface GpxPath {
    path: google.maps.LatLngLiteral[];
    color: string;
    elevationData: { distance: number; elevation: number }[];
    kmMarkers: { pos: google.maps.LatLngLiteral; label: string }[];
}

interface MapViewerProps {
  routes: { url: string; color: string; type?: string; assetKey?: string; splitPoints?: RouteSplitPoint[] }[];
  trackedAthletes: LiveAthlete[];
  focusedAthlete: LiveAthlete | null;
  timingPoints?: Array<{
    id: string;
    displayName?: string;
    shortName?: string;
    latitude: number;
    longitude: number;
    markerType?: string;
    icon?: string;
    status?: 'completed' | 'current' | 'upcoming' | 'missed';
    visible?: boolean;
  }>;
  mapOptions?: google.maps.MapOptions;
  containerStyle?: React.CSSProperties;
  showKmMarkers?: boolean;
  visibleRouteIndices?: number[];
  onGpxDataLoaded?: (gpxPaths: GpxPath[]) => void;
}

export default function MapViewer({ routes, trackedAthletes, focusedAthlete, timingPoints = [], mapOptions, containerStyle, showKmMarkers = true, visibleRouteIndices, onGpxDataLoaded }: MapViewerProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [activeInfoWindow, setActiveInfoWindow] = useState<string | null>(null);
  const [gpxPaths, setGpxPaths] = useState<GpxPath[]>([]);
  const [isGpxLoading, setIsGpxLoading] = useState(true);
  const hasUserAdjustedViewportRef = useRef(false);

  const routeSplitMarkers = useMemo(() => {
    if (!gpxPaths.length || !routes.length) return [] as RouteMarker[][];

    const hasCustomSplits = routes.some((route) => Array.isArray(route.splitPoints) && route.splitPoints.length > 0);

    return gpxPaths.map((path, routeIndex) => {
      const route = routes[routeIndex];
      if (!route || !path.path.length) return [] as RouteMarker[];

      const start = path.path[0];
      const end = path.path[path.path.length - 1];

      if (!hasCustomSplits) {
        const markers: RouteMarker[] = [];
        if (routeIndex === 0) {
          markers.push({
            id: `default-${routeIndex}-start`,
            kind: 'start',
            label: 'Start',
            distanceKm: 0,
            position: start,
            details: ['Leg: START', 'Distance: 0.00 km', 'Timing point/device: —', 'Cutoff: —'],
          });
        }
        if (routeIndex < routes.length - 1) {
          const transitionLabel = routeIndex === 0 ? 'T1' : routeIndex === 1 ? 'T2' : `T${routeIndex + 1}`;
          markers.push({
            id: `default-${routeIndex}-transition`,
            kind: 'transition',
            label: transitionLabel,
            distanceKm: null,
            position: end,
            details: [`Leg: ${transitionLabel}`, 'Distance: —', 'Timing point/device: —', 'Cutoff: —'],
          });
        }
        if (routeIndex === routes.length - 1) {
          markers.push({
            id: `default-${routeIndex}-finish`,
            kind: 'finish',
            label: 'Finish',
            distanceKm: null,
            position: end,
            details: ['Leg: FINISH', 'Distance: —', 'Timing point/device: —', 'Cutoff: —'],
          });
        }
        return markers;
      }

      const customMarkers = [...(route.splitPoints || [])]
        .filter((splitPoint) => Number.isFinite(parseDistanceKm((splitPoint as any).distance ?? (splitPoint as any).distanceKm ?? (splitPoint as any).DistanceFromStart ?? (splitPoint as any).distanceFromStart ?? (splitPoint as any).meters)))
        .sort((a, b) => parseDistanceKm((a as any).distance ?? (a as any).distanceKm ?? (a as any).DistanceFromStart ?? (a as any).distanceFromStart ?? (a as any).meters) - parseDistanceKm((b as any).distance ?? (b as any).distanceKm ?? (b as any).DistanceFromStart ?? (b as any).distanceFromStart ?? (b as any).meters))
        .map((splitPoint, splitIndex) => {
          const distanceKm = parseDistanceKm((splitPoint as any).distance ?? (splitPoint as any).distanceKm ?? (splitPoint as any).DistanceFromStart ?? (splitPoint as any).distanceFromStart ?? (splitPoint as any).meters);
          const position = interpolatePositionFromPaths([{ path: path.path }], distanceKm);
          // Still create marker even if position interpolation fails - use start + some offset
          const finalPosition = position || (path.path.length > 0 ? path.path[Math.min(Math.floor((distanceKm / 100) * path.path.length), path.path.length - 1)] : null);
          if (!finalPosition) return null;
          const kind = inferSplitMarkerKind(route, splitPoint, splitIndex, routeIndex, routes.length);
          return {
            id: `${routeIndex}-${splitIndex}-${splitPoint.id || splitPoint.name || kind}`,
            kind,
            label: String(splitPoint.name || splitPoint.id || kind).trim() || kind,
            distanceKm,
            position: finalPosition,
            details: formatSplitDetails(splitPoint, kind, route?.type),
          } as RouteMarker;
        })
        .filter((marker): marker is RouteMarker => Boolean(marker));

      // Always surface race anchors even when custom split points are configured.
      const hasStart = customMarkers.some((marker) => marker.kind === 'start');
      const hasFinish = customMarkers.some((marker) => marker.kind === 'finish');

      if (routeIndex === 0 && !hasStart) {
        customMarkers.unshift({
          id: `forced-${routeIndex}-start`,
          kind: 'start',
          label: 'Start',
          distanceKm: 0,
          position: start,
          details: ['Leg: START', 'Distance: 0.00 km', 'Timing point/device: —', 'Cutoff: —'],
        });
      }

      if (routeIndex === routes.length - 1 && !hasFinish) {
        customMarkers.push({
          id: `forced-${routeIndex}-finish`,
          kind: 'finish',
          label: 'Finish',
          distanceKm: null,
          position: end,
          details: ['Leg: FINISH', 'Distance: —', 'Timing point/device: —', 'Cutoff: —'],
        });
      }

      return customMarkers;
    });
  }, [gpxPaths, routes]);

  const athleteMarkerPalette = useMemo(() => [
    '#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0f766e', '#db2777', '#4f46e5', '#ca8a04', '#0891b2',
  ], []);

  const getAthleteMarkerIcon = useCallback((athlete: LiveAthlete, index: number): google.maps.Icon | google.maps.Symbol => {
    const fallbackKey = String(athlete.id || athlete.athleteUid || athlete.bib || athlete.name || index);
    const hash = Array.from(fallbackKey).reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 0);
    const color = athleteMarkerPalette[hash % athleteMarkerPalette.length] || '#2563eb';
    return {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 13,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeOpacity: 1,
      strokeWeight: 2.5,
    };
  }, [athleteMarkerPalette]);

  const buildAthleteMarkerSvg = useCallback((athlete: LiveAthlete, index: number, currentLeg?: string | null): string => {
    const fallbackKey = String(athlete.id || athlete.athleteUid || athlete.bib || athlete.name || index);
    const hash = Array.from(fallbackKey).reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 0);
    const color = athleteMarkerPalette[hash % athleteMarkerPalette.length] || '#2563eb';
    const initials = getInitials(athlete.name);
    const legEmoji = getLegIcon(currentLeg);
    
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="72" height="96" viewBox="0 0 72 96">
        <!-- Marker pin shape -->
        <defs>
          <linearGradient id="athleteGrad${index}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:${color};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${color}cc;stop-opacity:1" />
          </linearGradient>
        </defs>
        <path d="M 36 0 C 54 0 68 14 68 32 C 68 32 36 96 36 96 C 36 96 4 32 4 32 C 4 14 18 0 36 0 Z" fill="url(#athleteGrad${index})" stroke="white" stroke-width="2"/>
        
        <!-- Avatar circle background -->
        <circle cx="36" cy="30" r="20" fill="white" stroke="${color}" stroke-width="2"/>
        
        <!-- Athlete initials or placeholder -->
        <text x="36" y="35" font-family="Arial, sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="${color}">${initials || 'A'}</text>
        
        <!-- Leg icon overlay -->
        <circle cx="50" cy="16" r="12" fill="${color}" stroke="white" stroke-width="1.5"/>
        <text x="50" y="22" font-family="Arial, sans-serif" font-size="16" text-anchor="middle" dominant-baseline="middle">${legEmoji}</text>
      </svg>
    `;
    
    return svg;
  }, [athleteMarkerPalette]);

  const getLastRecordedSplit = useCallback((athlete: LiveAthlete) => {
    const sorted = [...(athlete.splits || [])]
      .filter(s => typeof s.time === 'number' && s.time > 0)
      .sort((a, b) => (a.time || 0) - (b.time || 0));
    return sorted[sorted.length - 1] || null;
  }, []);

  const getTrackingStatus = useCallback((athlete: LiveAthlete) => {
    const nowSec = Date.now() / 1000;
    const lastRecordedSplit = getLastRecordedSplit(athlete);
    const isOverdueForNextSplit = athlete.status === 'On Course'
      && typeof athlete.etaNextSplitUTC === 'number'
      && athlete.etaNextSplitUTC > 0
      && nowSec > athlete.etaNextSplitUTC;

    return {
      lastRecordedSplit,
      isOverdueForNextSplit,
      sinceLabel: athlete.lastUpdateTime
        ? new Date(athlete.lastUpdateTime).toLocaleTimeString()
        : 'unknown time',
    };
  }, [getLastRecordedSplit]);

  const getAthletePosition = useCallback((athlete: LiveAthlete) => {
    const trackingStatus = getTrackingStatus(athlete);
    const hasPredictionFeed = Boolean(
      athlete.predictedLocation
      || (typeof athlete.courseProgress === 'number' && athlete.courseProgress > 0)
      || ((athlete as any)?.participantLive && Number((athlete as any)?.participantLive?.distanceCovered || 0) > 0),
    );

    if (trackingStatus.isOverdueForNextSplit && trackingStatus.lastRecordedSplit && gpxPaths.length > 0 && !hasPredictionFeed) {
      return interpolatePositionFromPaths(gpxPaths, trackingStatus.lastRecordedSplit.distance || 0);
    }

    // 1. Prioritize live predicted location
    if (athlete.predictedLocation) {
        return athlete.predictedLocation;
    }
    // 2. If historical, interpolate position based on progress
    if (gpxPaths.length > 0 && typeof athlete.courseProgress === 'number' && athlete.courseProgress > 0) {
        return interpolatePositionFromPaths(gpxPaths, athlete.courseProgress);
    }
    // 3. If not started, put them at the start
    if (athlete.status === 'Not Started' && gpxPaths.length > 0 && gpxPaths[0].path.length > 0) {
        return gpxPaths[0].path[0];
    }
    // 4. Fallback if no data is available
    return null;
  }, [gpxPaths, getTrackingStatus]);

  const getCurrentAthleteSegment = useCallback((athlete: LiveAthlete) => {
    const splits = athlete.splits || [];
    if (!splits.length) return null;
    const sorted = [...splits].sort((a, b) => (a.time || 0) - (b.time || 0));
    for (let i = sorted.length - 1; i >= 0; i--) {
      const split = sorted[i];
      if (split.time && split.time > 0) {
        return split.segment || split.name;
      }
    }
    return null;
  }, []);

  useEffect(() => {
    const fetchAllGpx = async () => {
      if (!routes || routes.length === 0) {
        setGpxPaths([]);
        setIsGpxLoading(false);
        if (onGpxDataLoaded) onGpxDataLoaded([]);
        return;
      }
      setIsGpxLoading(true);
      const fetchedPaths = await Promise.all(
        routes.map(async (route) => {
          try {
            const baseUrl = window.location.origin;
            const proxyUrl = `${baseUrl}/api/proxy-gpx?url=${encodeURIComponent(route.url)}`;
            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error(`Failed to fetch GPX via proxy: ${response.statusText}`);
            const gpxText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(gpxText, "application/xml");
            const trackpoints = xmlDoc.getElementsByTagName('trkpt');
            if (trackpoints.length === 0) {
              return { path: [], color: route.color, elevationData: [], kmMarkers: [] };
            }

            let totalDistance = 0;
            const elevationData: { distance: number; elevation: number }[] = [];
            const path: google.maps.LatLngLiteral[] = [];
            const kmMarkers: { pos: google.maps.LatLngLiteral; label: string }[] = [];
            let nextKm = 10;

            for (let i = 0; i < trackpoints.length; i++) {
                const lat = parseFloat(trackpoints[i].getAttribute('lat')!);
                const lng = parseFloat(trackpoints[i].getAttribute('lon')!);
                const eleEl = trackpoints[i].getElementsByTagName('ele')[0];
                const elevation = eleEl ? parseFloat(eleEl.textContent || '0') : 0;
                
                const currentPoint = { lat, lng };
                path.push(currentPoint);

                if (i > 0) {
                    const prevPoint = path[path.length - 2];
                    totalDistance += google.maps.geometry.spherical.computeDistanceBetween(
                        new window.google.maps.LatLng(prevPoint),
                        new window.google.maps.LatLng(currentPoint)
                    );
                }
                
                elevationData.push({ distance: totalDistance / 1000, elevation });

                if (showKmMarkers && totalDistance / 1000 >= nextKm) {
                    kmMarkers.push({ pos: currentPoint, label: `${nextKm}km` });
                    nextKm += 10;
                }
            }

            return { path, color: route.color, elevationData, kmMarkers };
          } catch (error) {
            console.error("Error parsing GPX:", route.url, error);
            return { path: [], color: route.color, elevationData: [], kmMarkers: [] };
          }
        })
      );
      setGpxPaths(fetchedPaths as GpxPath[]);
      if (onGpxDataLoaded) onGpxDataLoaded(fetchedPaths as GpxPath[]);
      setIsGpxLoading(false);
    };

    fetchAllGpx();
  }, [routes, showKmMarkers, onGpxDataLoaded]);
  
  const onMapLoad = useCallback((mapInstance: google.maps.Map) => {
    setMap(mapInstance);
    mapInstance.addListener('zoom_changed', () => {
      hasUserAdjustedViewportRef.current = true;
    });
    mapInstance.addListener('dragstart', () => {
      hasUserAdjustedViewportRef.current = true;
    });
  }, []);

  useEffect(() => {
    // Re-enable one-time auto-fit when route context changes.
    hasUserAdjustedViewportRef.current = false;
  }, [gpxPaths, focusedAthlete?.id, visibleRouteIndices]);

  useEffect(() => {
    if (!map) return;

    const bounds = new window.google.maps.LatLngBounds();
    let hasPoints = false;

    if (gpxPaths.length > 0) {
      gpxPaths.forEach((p, index) => {
        const isVisible = !visibleRouteIndices?.length || visibleRouteIndices.includes(index);
        if (!isVisible || !p.path.length) return;
        p.path.forEach((point) => bounds.extend(point));
        hasPoints = true;
      });
    }

    trackedAthletes.forEach((athlete) => {
      const position = getAthletePosition(athlete);
      if (position) {
        bounds.extend(position);
        hasPoints = true;
      }
    });

    if (focusedAthlete) {
      setActiveInfoWindow(focusedAthlete.id);
    }

    if (hasPoints && !bounds.isEmpty() && !hasUserAdjustedViewportRef.current) {
      map.fitBounds(bounds);
      const currentZoom = map.getZoom();
      if (currentZoom && currentZoom > 16) {
        map.setZoom(16);
      }
    }

  }, [map, gpxPaths, trackedAthletes, focusedAthlete, getAthletePosition, visibleRouteIndices]);


  const athletesToDisplay = trackedAthletes;
  
  const finalContainerStyle = containerStyle || { height: '600px', width: '100%' };

  if (loadError) {
    return <div className="text-center p-4 bg-destructive/10 text-destructive font-medium rounded-md">Error loading Google Maps. Please check your API key and internet connection.</div>
  }

  return (
      <div style={finalContainerStyle} className="bg-gray-200 rounded-md">
        {!isLoaded || isGpxLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="ml-2">Loading Map & Routes...</p>
          </div>
        ) : (
          <GoogleMap
            mapContainerClassName="w-full h-full rounded-md"
            onLoad={onMapLoad}
            options={mapOptions || { mapTypeControl: false, streetViewControl: false, fullscreenControl: true }}
          >
            {gpxPaths.map((p, index) => {
              const isVisible = !visibleRouteIndices?.length || visibleRouteIndices.includes(index);
              if (!isVisible || !p.path.length) return null;
              const markers = routeSplitMarkers[index] || [];
              return (
              <React.Fragment key={index}>
                <Polyline path={p.path} options={{ strokeColor: p.color, strokeWeight: 4, strokeOpacity: 0.8 }} />
                {markers.map((marker) => {
                  const iconMeta = SPLIT_ICON_BY_KIND[marker.kind];
                  return (
                    <React.Fragment key={marker.id}>
                      <Marker
                        position={marker.position}
                        title={`${marker.label} · ${marker.distanceKm != null ? `${marker.distanceKm.toFixed(2)} km` : 'route marker'}`}
                        clickable={false}
                        icon={buildClockMarkerIcon(iconMeta.color, marker.kind === 'start' || marker.kind === 'finish' ? 34 : 30)}
                      />
                    </React.Fragment>
                  );
                })}
                {showKmMarkers && p.kmMarkers.map((marker, markerIndex) => (
                     <Marker
                        key={`km-${index}-${markerIndex}`}
                        position={marker.pos}
                        label={{ text: marker.label, color: '#333', fontSize: '10px', fontWeight: 'bold' }}
                        icon={{
                            path: google.maps.SymbolPath.CIRCLE,
                            scale: 6,
                            fillColor: '#FFFFFF',
                            fillOpacity: 0.8,
                            strokeColor: '#555',
                            strokeWeight: 1,
                        }}
                     />
                ))}
              </React.Fragment>
            )})}
            {timingPoints
              .filter((point) => point?.visible !== false)
              .filter((point) => Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)))
              .map((point, pointIndex) => {
                const lat = Number(point.latitude);
                const lng = Number(point.longitude);
                const status = point.status || 'upcoming';
                const color = status === 'completed' ? '#16a34a' : status === 'current' ? '#2563eb' : status === 'missed' ? '#dc2626' : '#6b7280';
                return (
                  <Marker
                    key={`timing-point-${point.id || pointIndex}`}
                    position={{ lat, lng }}
                    title={point.displayName || point.shortName || `Timing Point ${pointIndex + 1}`}
                      icon={buildClockMarkerIcon(color, 36)}
                  />
                );
              })}
            {athletesToDisplay.map((athlete, index) => {
              const position = getAthletePosition(athlete);
              const trackingStatus = getTrackingStatus(athlete);
              const currentSegment = getCurrentAthleteSegment(athlete);
              const markerSvg = buildAthleteMarkerSvg(athlete, index, currentSegment);

              return position && (
                <React.Fragment key={athlete.id}>
                    <Marker 
                        position={position} 
                        icon={{
                          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(markerSvg)}`,
                          scaledSize: new window.google.maps.Size(44, 56),
                          anchor: new window.google.maps.Point(22, 56),
                        }}
                        onClick={() => setActiveInfoWindow(athlete.id)}
                    />
                    {activeInfoWindow === athlete.id && (
                      <InfoWindow position={position} onCloseClick={() => setActiveInfoWindow(null)}>
                        <div className="min-w-[240px] space-y-1.5 p-1">
                          <div className="font-semibold text-sm">{athlete.name}</div>
                          <div className="text-xs text-slate-600">BIB {athlete.bib} · {athlete.status}</div>
                          {trackingStatus.isOverdueForNextSplit ? (
                            <div className="text-xs text-amber-700 font-medium">
                              👉 No recent timing update. Athlete is currently at last recorded checkpoint (since {trackingStatus.sinceLabel}).
                            </div>
                          ) : athlete.predictedLocation ? (
                            <div className="text-xs text-blue-700 font-medium">
                              Predicted moving position between timing checkpoints.
                            </div>
                          ) : (
                            <div className="text-xs text-slate-600">
                              Last recorded checkpoint is being displayed.
                            </div>
                          )}
                          {trackingStatus.lastRecordedSplit && (
                            <div className="text-xs text-slate-700">
                              Last checkpoint: {trackingStatus.lastRecordedSplit.name || trackingStatus.lastRecordedSplit.rawSplitLabel || trackingStatus.lastRecordedSplit.segment}
                            </div>
                          )}
                        </div>
                      </InfoWindow>
                    )}
                    {(Array.isArray(athlete.splits) ? athlete.splits : []).map((split, idx) => (
                        split.position && (
                            <Marker
                                key={`${athlete.id}-split-${idx}`}
                                position={split.position}
                                icon={{
                                    path: google.maps.SymbolPath.CIRCLE,
                                    scale: 5,
                                    fillColor: '#FFD700', // Gold color for split points
                                    fillOpacity: 1,
                                    strokeColor: 'white',
                                    strokeWeight: 1,
                                }}
                                label={{ text: split.name || split.segment, color: '#333', fontSize: '9px', fontWeight: 'bold', className: 'map-split-label' }}
                            />
                        )
                    ))}
                </React.Fragment>
              )
            })}
          </GoogleMap>
        )}
      </div>
  );
}
