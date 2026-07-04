// src/components/live-tracking/MapViewer.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GoogleMap, Polyline, Marker, InfoWindow, useJsApiLoader } from '@react-google-maps/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Waves, ChevronsRight, Bike, Footprints, Flag } from 'lucide-react';
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
  const [activeSplitMarker, setActiveSplitMarker] = useState<string | null>(null);
  const [gpxPaths, setGpxPaths] = useState<GpxPath[]>([]);
  const [isGpxLoading, setIsGpxLoading] = useState(true);

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

      return [...(route.splitPoints || [])]
        .filter((splitPoint) => Number.isFinite(Number(splitPoint.distance)))
        .sort((a, b) => Number(a.distance || 0) - Number(b.distance || 0))
        .map((splitPoint, splitIndex) => {
          const position = interpolatePositionFromPaths([{ path: path.path }], Number(splitPoint.distance || 0));
          if (!position) return null;
          const kind = inferSplitMarkerKind(route, splitPoint, splitIndex, routeIndex, routes.length);
          return {
            id: `${routeIndex}-${splitIndex}-${splitPoint.id || splitPoint.name || kind}`,
            kind,
            label: String(splitPoint.name || splitPoint.id || kind).trim() || kind,
            distanceKm: Number(splitPoint.distance || 0),
            position,
            details: formatSplitDetails(splitPoint, kind, route?.type),
          } as RouteMarker;
        })
        .filter((marker): marker is RouteMarker => Boolean(marker));
    });
  }, [gpxPaths, routes]);

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

    if (trackingStatus.isOverdueForNextSplit && trackingStatus.lastRecordedSplit && gpxPaths.length > 0) {
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
  }, []);

  useEffect(() => {
    if (!map) return;
  
    const bounds = new window.google.maps.LatLngBounds();
    let hasPoints = false;
  
    // Always calculate bounds based on GPX paths or tracked athletes
    if (gpxPaths.length > 0) {
      gpxPaths.forEach((p, index) => {
        const isVisible = !visibleRouteIndices?.length || visibleRouteIndices.includes(index);
        if (!isVisible || !p.path.length) return;
        p.path.forEach(point => bounds.extend(point));
        hasPoints = true;
      });
    } else if (trackedAthletes.length > 0) {
      trackedAthletes.forEach(athlete => {
        const position = getAthletePosition(athlete);
        if (position) {
          bounds.extend(position);
          hasPoints = true;
        }
      });
    }
  
    // If we have a focused athlete, pan and zoom to them.
    if (focusedAthlete) {
        const position = getAthletePosition(focusedAthlete);
        if (position) {
            map.panTo(position);
            map.setZoom(15);
            setActiveInfoWindow(focusedAthlete.id);
        }
    } 
    // If no focused athlete, fit the map to the calculated bounds.
    else if (hasPoints && !bounds.isEmpty()) {
      map.fitBounds(bounds);
      const currentZoom = map.getZoom();
      // Prevent excessive zooming on a single point or very small area
      if (currentZoom && currentZoom > 16) {
        map.setZoom(16);
      }
      setActiveInfoWindow(null);
    }
  
  }, [map, gpxPaths, trackedAthletes, focusedAthlete, getAthletePosition, visibleRouteIndices]);
  

  const athletesToDisplay = focusedAthlete ? [focusedAthlete] : trackedAthletes;
  
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
                        onClick={() => setActiveSplitMarker(marker.id)}
                        icon={{
                          path: google.maps.SymbolPath.CIRCLE,
                          scale: marker.kind === 'start' || marker.kind === 'finish' ? 11 : 9,
                          fillColor: iconMeta.color,
                          fillOpacity: 0.95,
                          strokeColor: '#ffffff',
                          strokeWeight: 2,
                        }}
                        label={{
                          text: iconMeta.emoji,
                          color: '#ffffff',
                          fontSize: '12px',
                          fontWeight: '700',
                        }}
                      />
                      {activeSplitMarker === marker.id && (
                        <InfoWindow position={marker.position} onCloseClick={() => setActiveSplitMarker(null)}>
                          <div className="min-w-[220px] space-y-1 p-1 text-sm">
                            <div className="font-semibold">{iconMeta.emoji} {marker.label}</div>
                            {marker.details.map((detail) => (
                              <div key={detail} className="text-xs text-slate-700">{detail}</div>
                            ))}
                          </div>
                        </InfoWindow>
                      )}
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
                    icon={{
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: 9,
                      fillColor: color,
                      fillOpacity: 0.95,
                      strokeColor: '#ffffff',
                      strokeWeight: 2,
                    }}
                    label={{
                      text: point.shortName || point.displayName || `${pointIndex + 1}`,
                      color: '#ffffff',
                      fontSize: '10px',
                      fontWeight: '700',
                    }}
                  />
                );
              })}
            {athletesToDisplay.map(athlete => {
              const position = getAthletePosition(athlete);
              const trackingStatus = getTrackingStatus(athlete);
              const icon: google.maps.Icon = {
                url: athlete.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(athlete.name)}&background=0D8ABC&color=fff&size=40`,
                scaledSize: new window.google.maps.Size(36, 36),
                anchor: new window.google.maps.Point(18, 18),
                origin: new window.google.maps.Point(0, 0),
              };

              return position && (
                <React.Fragment key={athlete.id}>
                    <Marker 
                        position={position} 
                        icon={icon}
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
