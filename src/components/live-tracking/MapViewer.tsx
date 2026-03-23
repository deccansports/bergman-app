// src/components/live-tracking/MapViewer.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { GoogleMap, Polyline, Marker, InfoWindow, useJsApiLoader } from '@react-google-maps/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Waves, ChevronsRight, Bike, Footprints, Flag } from 'lucide-react';
import type { LiveAthlete, Split } from '@/lib/types';
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


export interface GpxPath {
    path: google.maps.LatLngLiteral[];
    color: string;
    elevationData: { distance: number; elevation: number }[];
    kmMarkers: { pos: google.maps.LatLngLiteral; label: string }[];
}

interface MapViewerProps {
  routes: { url: string; color: string; }[];
  trackedAthletes: LiveAthlete[];
  focusedAthlete: LiveAthlete | null;
  mapOptions?: google.maps.MapOptions;
  containerStyle?: React.CSSProperties;
  showKmMarkers?: boolean;
  onGpxDataLoaded?: (gpxPaths: GpxPath[]) => void;
}

export default function MapViewer({ routes, trackedAthletes, focusedAthlete, mapOptions, containerStyle, showKmMarkers = true, onGpxDataLoaded }: MapViewerProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [activeInfoWindow, setActiveInfoWindow] = useState<string | null>(null);
  const [gpxPaths, setGpxPaths] = useState<GpxPath[]>([]);
  const [isGpxLoading, setIsGpxLoading] = useState(true);

  const getAthletePosition = useCallback((athlete: LiveAthlete) => {
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
  }, [gpxPaths]);

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
            if (trackpoints.length === 0) return null;

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
            return null;
          }
        })
      );
      const validPaths = fetchedPaths.filter(p => p && p.path.length > 0) as GpxPath[];
      setGpxPaths(validPaths);
      if (onGpxDataLoaded) onGpxDataLoaded(validPaths);
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
      gpxPaths.forEach(p => p.path.forEach(point => bounds.extend(point)));
      hasPoints = true;
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
  
  }, [map, gpxPaths, trackedAthletes, focusedAthlete, getAthletePosition]);
  

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
            {gpxPaths.map((p, index) => (
              <React.Fragment key={index}>
                <Polyline path={p.path} options={{ strokeColor: p.color, strokeWeight: 4, strokeOpacity: 0.8 }} />
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
            ))}
            {athletesToDisplay.map(athlete => {
              const position = getAthletePosition(athlete);
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
                    {athlete.splits.map((split, idx) => (
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
