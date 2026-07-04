"use client";

import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import NextImage from 'next/image';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Download, FileUp, Flag, MapPinned, Mountain, PlusCircle, Trash2, Trophy, Upload } from 'lucide-react';
import { GoogleMap, MarkerF, PolylineF, useJsApiLoader } from '@react-google-maps/api';
import { jsPDF } from 'jspdf';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import type { EventCalendarEntry } from '@/lib/types';
import { saveEventMapperPdfForAthletesAction } from '@/lib/actions/eventMapperActions';

interface EventMapperProTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

type MarkerType =
  | 'water_station'
  | 'timing_mat'
  | 'bike_tech_stationary'
  | 'bike_tech_moving'
  | 'medical'
  | 'ambulance'
  | 'aid_station'
  | 'custom';

interface RoutePoint {
  lat: number;
  lng: number;
  ele: number;
  km: number;
}

interface MarkerPoint {
  id: string;
  type: MarkerType;
  km: number;
  label: string;
  notes?: string;
  color: string;
}

type KmMarkerMode = 'none' | '1' | '2' | '5' | '10' | 'custom';
type SportType = 'swim' | 'bike' | 'run';

interface LogoAsset {
  id: string;
  name: string;
  dataUrl: string;
}

const markerTypeLabel: Record<MarkerType, string> = {
  water_station: 'Water Station',
  timing_mat: 'Timing Mat',
  bike_tech_stationary: 'Bike Tech (Stationary)',
  bike_tech_moving: 'Bike Tech (Moving)',
  medical: 'Medical',
  ambulance: 'Ambulance',
  aid_station: 'Aid Station',
  custom: 'Custom',
};

const markerDefaults: Record<MarkerType, string> = {
  water_station: '#0ea5e9',
  timing_mat: '#7c3aed',
  bike_tech_stationary: '#f59e0b',
  bike_tech_moving: '#ea580c',
  medical: '#dc2626',
  ambulance: '#ef4444',
  aid_station: '#22c55e',
  custom: '#334155',
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseGpx(content: string): RoutePoint[] {
  const parser = new DOMParser();
  const xml = parser.parseFromString(content, 'application/xml');
  const parseError = xml.getElementsByTagName('parsererror');
  if (parseError.length) throw new Error('Invalid GPX file format');

  const nodes = Array.from(xml.getElementsByTagName('trkpt'));
  if (!nodes.length) throw new Error('No track points found in GPX');

  const out: RoutePoint[] = [];
  let cumulative = 0;
  let prev: { lat: number; lng: number } | null = null;

  for (const n of nodes) {
    const lat = Number(n.getAttribute('lat'));
    const lng = Number(n.getAttribute('lon'));
    const eleNode = n.getElementsByTagName('ele')[0];
    const ele = eleNode ? Number(eleNode.textContent || '0') : 0;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    if (prev) {
      cumulative += haversineKm(prev.lat, prev.lng, lat, lng);
    }

    out.push({ lat, lng, ele: Number.isFinite(ele) ? ele : 0, km: cumulative });
    prev = { lat, lng };
  }

  if (out.length < 2) throw new Error('Route is too small to render');
  return out;
}

function parseKmCsv(value: string): number[] {
  const unique = new Set<number>();
  value
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .forEach((v) => unique.add(Number(v.toFixed(2))));
  return Array.from(unique).sort((a, b) => a - b);
}

export default function EventMapperProTab({ events, isLoadingEvents }: EventMapperProTabProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [route, setRoute] = useState<RoutePoint[]>([]);
  const [markers, setMarkers] = useState<MarkerPoint[]>([]);
  const [newType, setNewType] = useState<MarkerType>('water_station');
  const [newKm, setNewKm] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newColor, setNewColor] = useState(markerDefaults.water_station);
  const [annotation, setAnnotation] = useState('Hydration every 5 km. Technical support available through bike segment.');
  const [error, setError] = useState<string | null>(null);
  const [kmMarkerMode, setKmMarkerMode] = useState<KmMarkerMode>('5');
  const [customKmInput, setCustomKmInput] = useState('1,2,5,10');
  const [turnaroundInput, setTurnaroundInput] = useState('');
  const [sportType, setSportType] = useState<SportType>('bike');
  const [buoyColor, setBuoyColor] = useState('#f59e0b');
  const [showRealMap, setShowRealMap] = useState(true);
  const [eventLogo, setEventLogo] = useState<LogoAsset | null>(null);
  const [sponsorLogos, setSponsorLogos] = useState<LogoAsset[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  // ── Logo placement (canvas-coordinate transforms; canvas is 1400×820) ──
  // Drag/resize on the on-screen overlay drives these; the draw routine and PDF
  // (which embeds the rendered canvas image) honour them automatically.
  const MAP_W = 1400;
  const MAP_H = 820;
  type LogoTransform = { x: number; y: number; w: number; h: number };
  const [eventLogoTransform, setEventLogoTransform] = useState<LogoTransform>({
    x: MAP_W - 90 - 24, y: 18, w: 90, h: 50,
  });
  const [sponsorTransforms, setSponsorTransforms] = useState<Record<string, LogoTransform>>({});
  const mapPreviewWrapperRef = useRef<HTMLDivElement | null>(null);

  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const elevationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const elevationWrapperRef = useRef<HTMLDivElement | null>(null);

  // Live km scrubber – drives both the elevation chart tooltip & the map hover marker.
  const [hoverKm, setHoverKm] = useState<number | null>(null);

  const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
  const { isLoaded: isGoogleMapLoaded, loadError: googleMapLoadError } = useJsApiLoader({
    id: 'event-mapper-pro-map',
    googleMapsApiKey,
    libraries: ['geometry'],
  });

  // ── Route drawing (Ride-with-GPS style) ──
  type DrawMode = 'off' | 'snap' | 'free';
  type RoutingMode = 'walking' | 'cycling' | 'driving';
  const [drawMode, setDrawMode] = useState<DrawMode>('off');
  const [routingMode, setRoutingMode] = useState<RoutingMode>('cycling');
  const [waypoints, setWaypoints] = useState<{ lat: number; lng: number }[]>([]);
  const [isRouting, setIsRouting] = useState(false);

  useEffect(() => {
    if (!selectedEventId && events.length) {
      setSelectedEventId(events[0].id);
    }
  }, [events, selectedEventId]);

  useEffect(() => {
    setNewColor(markerDefaults[newType]);
  }, [newType]);

  const routeStats = useMemo(() => {
    if (!route.length) return null;
    const totalKm = route[route.length - 1].km;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < route.length; i++) {
      const d = route[i].ele - route[i - 1].ele;
      if (d > 0) gain += d;
      else loss += Math.abs(d);
    }
    return {
      totalKm,
      gain,
      loss,
      minEle: Math.min(...route.map(p => p.ele)),
      maxEle: Math.max(...route.map(p => p.ele)),
    };
  }, [route]);

  const kmMarkerSet = useMemo(() => {
    if (!routeStats) return [];

    const max = routeStats.totalKm;
    if (kmMarkerMode === 'none') return [];

    if (kmMarkerMode === 'custom') {
      return parseKmCsv(customKmInput).filter((km) => km > 0 && km <= max);
    }

    const step = Number(kmMarkerMode);
    if (!Number.isFinite(step) || step <= 0) return [];

    const out: number[] = [];
    for (let km = step; km <= Math.floor(max); km += step) {
      out.push(km);
    }
    return out;
  }, [routeStats, kmMarkerMode, customKmInput]);

  const turnaroundMarkers = useMemo(() => {
    if (!routeStats) return [];
    const max = routeStats.totalKm;
    return parseKmCsv(turnaroundInput).filter((km) => km >= 0 && km <= max);
  }, [routeStats, turnaroundInput]);

  const googlePath = useMemo(() => route.map((p) => ({ lat: p.lat, lng: p.lng })), [route]);

  const mapCenter = useMemo(() => {
    if (!route.length) return { lat: 18.5204, lng: 73.8567 };
    const mid = route[Math.floor(route.length / 2)];
    return { lat: mid.lat, lng: mid.lng };
  }, [route]);

  const routeBounds = useMemo(() => {
    if (!route.length) return null;
    return {
      minLat: Math.min(...route.map(p => p.lat)),
      maxLat: Math.max(...route.map(p => p.lat)),
      minLng: Math.min(...route.map(p => p.lng)),
      maxLng: Math.max(...route.map(p => p.lng)),
    };
  }, [route]);

  const projectPoint = useCallback((lat: number, lng: number, w: number, h: number) => {
    if (!routeBounds) return { x: 0, y: 0 };
    const pad = 40;
    const spanLat = Math.max(0.00001, routeBounds.maxLat - routeBounds.minLat);
    const spanLng = Math.max(0.00001, routeBounds.maxLng - routeBounds.minLng);
    const nx = (lng - routeBounds.minLng) / spanLng;
    const ny = 1 - (lat - routeBounds.minLat) / spanLat;
    return {
      x: pad + nx * (w - pad * 2),
      y: pad + ny * (h - pad * 2),
    };
  }, [routeBounds]);

  const getRoutePointAtKm = useCallback((km: number): RoutePoint | null => {
    if (!route.length) return null;
    if (km <= 0) return route[0];
    const end = route[route.length - 1].km;
    if (km >= end) return route[route.length - 1];

    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1];
      const b = route[i];
      if (km >= a.km && km <= b.km) {
        const t = (km - a.km) / Math.max(0.000001, b.km - a.km);
        return {
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lng + (b.lng - a.lng) * t,
          ele: a.ele + (b.ele - a.ele) * t,
          km,
        };
      }
    }

    return null;
  }, [route]);

  // Closest km along the route to an arbitrary lat/lng (used by the map hover handler).
  const findNearestKmTo = useCallback((lat: number, lng: number): { km: number; distKm: number } | null => {
    if (!route.length) return null;
    let bestKm = route[0].km;
    let bestDist = Number.POSITIVE_INFINITY;
    // Sub-sample very dense routes to keep mousemove cheap.
    const step = Math.max(1, Math.floor(route.length / 1500));
    for (let i = 0; i < route.length; i += step) {
      const p = route[i];
      const d = haversineKm(lat, lng, p.lat, p.lng);
      if (d < bestDist) {
        bestDist = d;
        bestKm = p.km;
      }
    }
    return { km: bestKm, distKm: bestDist };
  }, [route]);

  function buildGoogleStaticMapUrl(): string | null {
    if (!googleMapsApiKey || !route.length) return null;

    const sampledRoute = route.filter((_, index) => index % Math.max(1, Math.ceil(route.length / 90)) === 0);
    const routePath = sampledRoute
      .map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)
      .join('|');

    const params = new URLSearchParams();
    params.set('size', '1280x720');
    params.set('scale', '2');
    params.set('maptype', 'roadmap');
    params.set('key', googleMapsApiKey);
    params.append('path', `weight:6|color:0x06b6d4ff|${routePath}`);

    const start = route[0];
    const finish = route[route.length - 1];

    params.append('markers', `color:green|label:S|${start.lat},${start.lng}`);
    params.append('markers', `color:red|label:F|${finish.lat},${finish.lng}`);

    kmMarkerSet.forEach((km) => {
      const pt = getRoutePointAtKm(km);
      if (!pt) return;
      params.append('markers', `color:blue|label:${Math.round(km) % 10}|${pt.lat},${pt.lng}`);
    });

    turnaroundMarkers.forEach((km) => {
      const pt = getRoutePointAtKm(km);
      if (!pt) return;
      params.append('markers', `color:orange|label:T|${pt.lat},${pt.lng}`);
    });

    markers.forEach((m) => {
      const pt = getRoutePointAtKm(m.km);
      if (!pt) return;
      params.append('markers', `color:red|label:${(m.label || 'M').charAt(0).toUpperCase()}|${pt.lat},${pt.lng}`);
    });

    return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
  }

  async function fetchGoogleMapImageDataUrl(): Promise<string | null> {
    const url = buildGoogleStaticMapUrl();
    if (!url) return null;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  const drawMapCanvas = useCallback(async () => {
    const canvas = mapCanvasRef.current;
    if (!canvas || !route.length) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.45, '#f8fafc');
    bg.addColorStop(1, '#eef2f7');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(100,116,139,0.14)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const path = new Path2D();
    route.forEach((p, i) => {
      const { x, y } = projectPoint(p.lat, p.lng, w, h);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });

    ctx.strokeStyle = '#dbeafe';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);

    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 7;
    ctx.stroke(path);

    if (routeStats) {
      kmMarkerSet.forEach((km) => {
        const pt = getRoutePointAtKm(km);
        if (!pt) return;
        const { x, y } = projectPoint(pt.lat, pt.lng, w, h);

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(km), x, y + 0.5);
      });
    }

    turnaroundMarkers.forEach((km) => {
      const p = getRoutePointAtKm(km);
      if (!p) return;
      const { x, y } = projectPoint(p.lat, p.lng, w, h);

      ctx.fillStyle = buoyColor;
      ctx.beginPath();
      ctx.moveTo(x, y - 14);
      ctx.lineTo(x + 12, y + 10);
      ctx.lineTo(x - 12, y + 10);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.font = '700 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('T', x, y + 5);

      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Turnaround ${km.toFixed(1)} km`, x + 14, y + 3);
    });

    const drawMarkerIcon = (x: number, y: number, type: MarkerType, color: string) => {
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;

      if (type === 'water_station') {
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 2, y - 5, 4, 10);
      } else if (type === 'timing_mat') {
        ctx.fillRect(x - 10, y - 4, 20, 8);
        ctx.strokeRect(x - 10, y - 4, 20, 8);
      } else if (type === 'medical' || type === 'ambulance') {
        ctx.fillRect(x - 9, y - 9, 18, 18);
        ctx.strokeRect(x - 9, y - 9, 18, 18);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 2, y - 6, 4, 12);
        ctx.fillRect(x - 6, y - 2, 12, 4);
      } else if (type === 'bike_tech_stationary' || type === 'bike_tech_moving') {
        ctx.beginPath();
        ctx.moveTo(x - 10, y + 6);
        ctx.lineTo(x - 3, y - 6);
        ctx.lineTo(x + 4, y + 6);
        ctx.lineTo(x + 10, y -6);
        ctx.stroke();
      } else if (type === 'aid_station') {
        ctx.beginPath();
        ctx.moveTo(x, y - 10);
        ctx.lineTo(x + 10, y);
        ctx.lineTo(x, y + 10);
        ctx.lineTo(x - 10, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    };

    markers.forEach((m) => {
      const p = getRoutePointAtKm(m.km);
      if (!p) return;
      const { x, y } = projectPoint(p.lat, p.lng, w, h);
      drawMarkerIcon(x, y, m.type, m.color);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${m.label} (${m.km.toFixed(1)} km)`, x + 12, y - 8);
    });

    const start = route[0];
    const finish = route[route.length - 1];
    const s = projectPoint(start.lat, start.lng, w, h);
    const f = projectPoint(finish.lat, finish.lng, w, h);

    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(f.x, f.y, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('START', s.x + 12, s.y + 4);
    ctx.fillText('FINISH', f.x + 12, f.y + 4);

    ctx.fillStyle = '#0f172a';
    ctx.font = '600 22px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Bergman Event Mapper Pro Route Map', 28, 36);

    ctx.fillStyle = '#0369a1';
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillText('Endurance • Precision • Race Day Ready', 28, 56);

    const loadImage = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('logo load failed'));
        image.src = src;
      });

    if (eventLogo?.dataUrl) {
      try {
        const img = await loadImage(eventLogo.dataUrl);
        const t = eventLogoTransform;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.drawImage(img, t.x + 2, t.y + 2, Math.max(1, t.w - 4), Math.max(1, t.h - 4));
      } catch {
        // Ignore logo load failures
      }
    }

    if (sponsorLogos.length) {
      for (const logo of sponsorLogos.slice(0, 8)) {
        const t = sponsorTransforms[logo.id];
        if (!t) continue;
        try {
          const img = await loadImage(logo.dataUrl);
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillRect(t.x, t.y, t.w, t.h);
          ctx.drawImage(img, t.x + 2, t.y + 2, Math.max(1, t.w - 4), Math.max(1, t.h - 4));
        } catch {
          // Ignore logo load failures
        }
      }
    }
  }, [route, routeStats, kmMarkerSet, turnaroundMarkers, markers, eventLogo, sponsorLogos, eventLogoTransform, sponsorTransforms, buoyColor, getRoutePointAtKm, projectPoint]);

  const drawElevationCanvas = useCallback(() => {
    const canvas = elevationCanvasRef.current;
    if (!canvas || !route.length || !routeStats) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const pad = 34;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad + ((h - pad * 2) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
    }

    if (sportType !== 'swim') {
      const eleSpan = Math.max(1, routeStats.maxEle - routeStats.minEle);
      const kmTotal = Math.max(1, routeStats.totalKm);

      const line = new Path2D();
      route.forEach((p, i) => {
        const x = pad + (p.km / kmTotal) * (w - pad * 2);
        const y = h - pad - ((p.ele - routeStats.minEle) / eleSpan) * (h - pad * 2);
        if (i === 0) line.moveTo(x, y);
        else line.lineTo(x, y);
      });

      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 3;
      ctx.stroke(line);
    }

    ctx.fillStyle = '#111827';
    ctx.font = '600 14px Inter, system-ui, sans-serif';
    ctx.fillText('Elevation Profile', 14, 20);

    ctx.font = '11px Inter, system-ui, sans-serif';
    if (sportType === 'swim') {
      ctx.fillText('Elevation profile not shown for swim routes', 14, h - 8);
    } else {
      ctx.fillText(`Min ${routeStats.minEle.toFixed(0)}m`, 14, h - 8);
      ctx.fillText(`Max ${routeStats.maxEle.toFixed(0)}m`, w - 92, h - 8);
      ctx.fillText(`${routeStats.totalKm.toFixed(2)} km`, w - 84, 20);
    }

    // ── Live km scrubber (driven by mouse hover on the chart OR the map) ──
    if (hoverKm != null && sportType !== 'swim') {
      const kmTotal = Math.max(1, routeStats.totalKm);
      const eleSpan = Math.max(1, routeStats.maxEle - routeStats.minEle);
      const clampedKm = Math.max(0, Math.min(kmTotal, hoverKm));
      const x = pad + (clampedKm / kmTotal) * (w - pad * 2);
      const pt = getRoutePointAtKm(clampedKm);

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, h - pad);
      ctx.stroke();
      ctx.setLineDash([]);

      if (pt) {
        const y = h - pad - ((pt.ele - routeStats.minEle) / eleSpan) * (h - pad * 2);
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inline label inside the canvas (the HTML overlay handles the rich tooltip).
        const txt = `${clampedKm.toFixed(2)} km · ${pt.ele.toFixed(0)} m`;
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        const tw = ctx.measureText(txt).width + 12;
        let bx = x + 10;
        if (bx + tw > w - 6) bx = x - 10 - tw;
        const by = Math.max(pad + 4, y - 26);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.fillRect(bx, by, tw, 20);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(txt, bx + 6, by + 14);
      }
    }
  }, [route, routeStats, sportType, hoverKm, getRoutePointAtKm]);

  useEffect(() => {
    void drawMapCanvas();
    drawElevationCanvas();
  }, [drawMapCanvas, drawElevationCanvas]);

  async function onGpxUpload(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const points = parseGpx(text);
      setRoute(points);
      setFileName(file.name);
    } catch (e: any) {
      setError(e.message || 'Failed to parse GPX file');
      setRoute([]);
    }
  }

  // ── Build a RoutePoint[] from an array of LatLng (no elevation, but distances ok)
  function latLngsToRoute(latLngs: { lat: number; lng: number }[]): RoutePoint[] {
    if (!latLngs.length) return [];
    let cumulative = 0;
    let prev: { lat: number; lng: number } | null = null;
    const out: RoutePoint[] = [];
    for (const p of latLngs) {
      if (prev) cumulative += haversineKm(prev.lat, prev.lng, p.lat, p.lng);
      out.push({ lat: p.lat, lng: p.lng, ele: 0, km: cumulative });
      prev = p;
    }
    return out;
  }

  // Reverse-geocode-free Directions call. Snaps every consecutive pair of
  // waypoints to the road network so the polyline follows real streets/paths.
  async function rebuildRouteFromWaypoints(pts: { lat: number; lng: number }[], snap: boolean) {
    if (pts.length < 2) {
      setRoute(pts.length === 1 ? latLngsToRoute(pts) : []);
      return;
    }
    if (!snap || typeof window === 'undefined' || !window.google?.maps) {
      setRoute(latLngsToRoute(pts));
      return;
    }

    setIsRouting(true);
    try {
      const svc = new window.google.maps.DirectionsService();
      const travelMap: Record<RoutingMode, google.maps.TravelMode> = {
        walking: window.google.maps.TravelMode.WALKING,
        cycling: window.google.maps.TravelMode.BICYCLING,
        driving: window.google.maps.TravelMode.DRIVING,
      };

      // Google allows up to 25 waypoints per request — chunk if needed.
      const all: { lat: number; lng: number }[] = [];
      const CHUNK = 23; // leave room for origin + destination per leg
      for (let i = 0; i < pts.length - 1; i += CHUNK) {
        const slice = pts.slice(i, Math.min(pts.length, i + CHUNK + 1));
        const origin = slice[0];
        const destination = slice[slice.length - 1];
        const middle = slice.slice(1, -1).map((p) => ({ location: p, stopover: false }));

        // eslint-disable-next-line no-await-in-loop
        const res = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
          svc.route(
            {
              origin,
              destination,
              waypoints: middle,
              travelMode: travelMap[routingMode],
              optimizeWaypoints: false,
            },
            (r, status) => {
              if (status === 'OK' && r) resolve(r);
              else reject(new Error(`Directions failed: ${status}`));
            },
          );
        });

        const path = res.routes[0]?.overview_path || [];
        for (const ll of path) all.push({ lat: ll.lat(), lng: ll.lng() });
      }

      setRoute(latLngsToRoute(all));
      setFileName(`Drawn route (${pts.length} waypoints)`);
    } catch (e: any) {
      setError(e.message || 'Could not snap to roads');
      // Fallback: straight lines
      setRoute(latLngsToRoute(pts));
    } finally {
      setIsRouting(false);
    }
  }

  function addWaypoint(lat: number, lng: number) {
    setWaypoints((prev) => {
      const next = [...prev, { lat, lng }];
      void rebuildRouteFromWaypoints(next, drawMode === 'snap');
      return next;
    });
  }

  function undoLastWaypoint() {
    setWaypoints((prev) => {
      const next = prev.slice(0, -1);
      void rebuildRouteFromWaypoints(next, drawMode === 'snap');
      return next;
    });
  }

  function clearDrawnRoute() {
    setWaypoints([]);
    setRoute([]);
    setFileName('');
  }

  function exportRouteAsGpx() {
    if (!route.length) return;
    const name = (fileName || 'BergmanRoute').replace(/\.gpx$/i, '');
    const head = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Bergman Event Mapper Pro" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>${name}</name><trkseg>`;
    const body = route.map((p) => `    <trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.ele}</ele></trkpt>`).join('\n');
    const tail = `\n  </trkseg></trk>\n</gpx>\n`;
    const blob = new Blob([head + '\n' + body + tail], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.gpx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function moveWaypoint(index: number, lat: number, lng: number) {
    setWaypoints((prev) => {
      const next = prev.map((w, i) => (i === index ? { lat, lng } : w));
      void rebuildRouteFromWaypoints(next, drawMode === 'snap');
      return next;
    });
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read image'));
      reader.readAsDataURL(file);
    });
  }

  async function onEventLogoUpload(file: File) {
    const dataUrl = await fileToDataUrl(file);
    setEventLogo({ id: crypto.randomUUID(), name: file.name, dataUrl });
  }

  async function onSponsorLogoUpload(files: FileList | null) {
    if (!files || !files.length) return;
    const uploads: LogoAsset[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      const dataUrl = await fileToDataUrl(file);
      uploads.push({ id: crypto.randomUUID(), name: file.name, dataUrl });
    }
    setSponsorLogos((prev) => {
      const next = [...prev, ...uploads].slice(0, 8);
      // Seed default transforms for any sponsor that doesn't have one yet.
      setSponsorTransforms((tprev) => {
        const out = { ...tprev };
        next.forEach((logo, idx) => {
          if (!out[logo.id]) {
            out[logo.id] = { x: 28 + idx * 84, y: MAP_H - 52, w: 78, h: 34 };
          }
        });
        return out;
      });
      return next;
    });
  }

  function addMarker() {
    const km = Number(newKm);
    if (!routeStats || !Number.isFinite(km) || km < 0 || km > routeStats.totalKm) return;

    const marker: MarkerPoint = {
      id: crypto.randomUUID(),
      type: newType,
      km,
      label: newLabel.trim() || markerTypeLabel[newType],
      notes: newNotes.trim() || undefined,
      color: newColor,
    };

    setMarkers((prev) => [...prev, marker].sort((a, b) => a.km - b.km));
    setNewKm('');
    setNewLabel('');
    setNewNotes('');
  }

  function removeMarker(id: string) {
    setMarkers((prev) => prev.filter((m) => m.id !== id));
  }

  async function exportPdf() {
    const mapCanvas = mapCanvasRef.current;
    const elevationCanvas = elevationCanvasRef.current;
    if (!mapCanvas || !elevationCanvas || !routeStats) return;

    setIsExporting(true);

    try {
      const eventName = events.find((e) => e.id === selectedEventId)?.eventName || 'Race Event';
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const PW = 210;
      const PH = 297;
      const M = 10; // margin
      const IW = PW - M * 2; // inner width

      // ── colour palette (matches reference dark triathlon UI) ──────────────
      type RGB = [number, number, number];
      const DARK:   RGB = [13,  17,  23];
      const CARD:   RGB = [22,  27,  34];
      const BORDER: RGB = [48,  54,  61];
      const TXT:    RGB = [230, 237, 243];
      const MUTED:  RGB = [139, 148, 158];
      const CYAN:   RGB = [0,   180, 216];
      const ORANGE: RGB = [244, 162, 97];
      const RED:    RGB = [230, 57,  70];
      const GREEN:  RGB = [162, 215, 41];
      const PINK:   RGB = [247, 37,  133];

      const sf = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
      const sd = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
      const st = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
      const fr = (x: number, y: number, w: number, h: number, s = 'F') => doc.rect(x, y, w, h, s as any);

      // ── HERO ──────────────────────────────────────────────────────────────
      sf(DARK); fr(0, 0, PW, 46, 'F');
      // top gradient band
      sf(CYAN); fr(0, 0, PW, 1.2, 'F');
      sf([0, 84, 101] as RGB); fr(0, 1.2, PW, 0.6, 'F');

      // badge
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      st(MUTED);
      doc.text('OFFICIAL COURSE DOCUMENT  ·  BERGMAN EVENT MAPPER PRO', PW / 2, 9, { align: 'center' });

      // event title
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      st(TXT);
      doc.text(eventName, PW / 2, 19, { align: 'center' });

      // sub-line
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      st(MUTED);
      doc.text(`${routeStats.totalKm.toFixed(2)} km Route  ·  ${markers.length} Waypoint${markers.length !== 1 ? 's' : ''}`, PW / 2, 26, { align: 'center' });

      // pills row
      const pillDefs: Array<{ label: string; color: RGB }> = [
        { label: `${routeStats.totalKm.toFixed(1)} km`, color: CYAN },
        { label: `+${routeStats.gain.toFixed(0)} m Gain`, color: GREEN },
        { label: `-${routeStats.loss.toFixed(0)} m Loss`, color: RED },
        { label: `${markers.length} Markers`, color: ORANGE },
      ];
      const pillW = 40;
      const pillGap = 3;
      const pillsTotal = pillDefs.length * pillW + (pillDefs.length - 1) * pillGap;
      let pillX = (PW - pillsTotal) / 2;
      pillDefs.forEach((p) => {
        sf(CARD); sd(BORDER);
        doc.setLineWidth(0.3);
        doc.roundedRect(pillX, 29, pillW, 9, 2, 2, 'FD');
        sf(p.color); doc.circle(pillX + 4, 33.5, 1.4, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        st(TXT);
        doc.text(p.label, pillX + 7.5, 34.8);
        pillX += pillW + pillGap;
      });

      // event logo
      if (eventLogo?.dataUrl) {
        try { doc.addImage(eventLogo.dataUrl, 'PNG', PW - 36, 4, 26, 11); } catch { /* ignore */ }
      }

      // ── STATS BAR ────────────────────────────────────────────────────────
      const SBY = 46;
      const SBH = 15;
      const statDefs: Array<{ label: string; value: string; color: RGB }> = [
        { label: 'Route Distance', value: `${routeStats.totalKm.toFixed(2)} km`, color: CYAN },
        { label: 'Elevation Gain', value: `+${routeStats.gain.toFixed(0)} m`,    color: GREEN },
        { label: 'Elevation Loss', value: `-${routeStats.loss.toFixed(0)} m`,    color: RED },
        { label: 'Min Elevation',  value: `${routeStats.minEle.toFixed(0)} m`,   color: ORANGE },
        { label: 'Max Elevation',  value: `${routeStats.maxEle.toFixed(0)} m`,   color: PINK },
        { label: 'Waypoints',      value: String(markers.length),                color: MUTED },
      ];
      const cw = PW / statDefs.length;
      sf(BORDER); fr(0, SBY, PW, 0.4, 'F');
      statDefs.forEach((s, i) => {
        if (i > 0) { sf(BORDER); fr(i * cw, SBY, 0.4, SBH, 'F'); }
        sf(CARD); fr(i * cw + 0.4, SBY, cw - 0.4, SBH, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
        st(s.color);
        doc.text(s.value, i * cw + cw / 2, SBY + 7, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
        st(MUTED);
        doc.text(s.label.toUpperCase(), i * cw + cw / 2, SBY + 12, { align: 'center' });
      });
      sf(BORDER); fr(0, SBY + SBH, PW, 0.4, 'F');

      // ── SECTION HEADER helper ─────────────────────────────────────────────
      let curY = SBY + SBH + 6;

      const sectionHeader = (iconText: string, title: string, color: RGB, badge?: string): number => {
        // icon disc
        sf(color); doc.circle(M + 4, curY + 4, 4, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
        st(DARK);
        doc.text(iconText, M + 4, curY + 5.2, { align: 'center' });
        // title
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        st(color);
        doc.text(title, M + 10, curY + 5.5);
        if (badge) {
          sf(CARD); sd(BORDER);
          doc.setLineWidth(0.25);
          doc.roundedRect(PW - M - 34, curY, 34, 8, 1.5, 1.5, 'FD');
          doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
          st(MUTED);
          doc.text(badge, PW - M - 17, curY + 5, { align: 'center' });
        }
        curY += 11;
        return curY;
      };

      // ── COURSE MAP ───────────────────────────────────────────────────────
      sectionHeader('M', 'Course Route Map', CYAN, `${routeStats.totalKm.toFixed(1)} km`);

      // Use custom plain map canvas for PDF export (no Google map download)
      const mapImg = mapCanvas.toDataURL('image/png', 1);
      const mapH = 78;
      sf(CARD); sd(BORDER);
      doc.setLineWidth(0.35);
      doc.roundedRect(M, curY, IW, mapH, 2, 2, 'FD');
      doc.addImage(mapImg, 'PNG', M + 0.5, curY + 0.5, IW - 1, mapH - 1);
      curY += mapH + 5;

      // Sporty icon legend (stations, timing, turnarounds, etc.)
      const markerTypeCounts = markers.reduce((acc, marker) => {
        acc[marker.type] = (acc[marker.type] || 0) + 1;
        return acc;
      }, {} as Partial<Record<MarkerType, number>>);

      const legendCatalog: Array<{ key: MarkerType | 'turnaround'; label: string; color: RGB; glyph: string; count: number }> = [
        { key: 'timing_mat', label: 'Timing', color: [124, 58, 237], glyph: 'T', count: markerTypeCounts.timing_mat || 0 },
        { key: 'water_station', label: 'Water', color: [14, 165, 233], glyph: 'W', count: markerTypeCounts.water_station || 0 },
        { key: 'aid_station', label: 'Aid', color: [34, 197, 94], glyph: 'A', count: markerTypeCounts.aid_station || 0 },
        { key: 'medical', label: 'Medical', color: [220, 38, 38], glyph: 'M', count: markerTypeCounts.medical || 0 },
        { key: 'ambulance', label: 'Ambulance', color: [239, 68, 68], glyph: 'AM', count: markerTypeCounts.ambulance || 0 },
        { key: 'bike_tech_stationary', label: 'Bike Tech', color: [245, 158, 11], glyph: 'B', count: markerTypeCounts.bike_tech_stationary || 0 },
        { key: 'bike_tech_moving', label: 'Mobile Tech', color: [234, 88, 12], glyph: 'MB', count: markerTypeCounts.bike_tech_moving || 0 },
        { key: 'custom', label: 'Custom', color: [51, 65, 85], glyph: 'C', count: markerTypeCounts.custom || 0 },
        {
          key: 'turnaround',
          label: 'Turn Around',
          color: [
            parseInt(buoyColor.slice(1, 3), 16),
            parseInt(buoyColor.slice(3, 5), 16),
            parseInt(buoyColor.slice(5, 7), 16),
          ],
          glyph: 'U',
          count: turnaroundMarkers.length,
        },
      ];

      const legendItems = legendCatalog.filter((item) => item.count > 0);
      if (legendItems.length > 0) {
        sectionHeader('S', 'Stations & Icons', ORANGE);

        const chipW = 36;
        const chipH = 8;
        const chipGap = 2;
        const perRow = Math.max(1, Math.floor((IW + chipGap) / (chipW + chipGap)));

        legendItems.forEach((item, index) => {
          const col = index % perRow;
          const row = Math.floor(index / perRow);
          const x = M + col * (chipW + chipGap);
          const y = curY + row * (chipH + chipGap);

          sf(CARD); sd(BORDER);
          doc.setLineWidth(0.22);
          doc.roundedRect(x, y, chipW, chipH, 1.5, 1.5, 'FD');

          sf(item.color);
          doc.circle(x + 3.5, y + chipH / 2, 1.8, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(5.2);
          st(DARK);
          doc.text(item.glyph, x + 3.5, y + chipH / 2 + 1, { align: 'center' });

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(5.6);
          st(TXT);
          doc.text(item.label, x + 7, y + 3.2);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(5.2);
          st(MUTED);
          doc.text(`${item.count}`, x + 7, y + 6.2);
        });

        const legendRows = Math.ceil(legendItems.length / perRow);
        curY += legendRows * (chipH + chipGap) + 2;
      }

      if (sportType !== 'swim') {
        // ── ELEVATION CHART ──────────────────────────────────────────────────
        sectionHeader('E', 'Elevation Profile', ORANGE);

        const EH = 28; // chart inner height
        const EPX = 16; // x-padding inside box
        const EPY = 5;  // y-padding inside box
        const boxH = EH + EPY * 2;
        sf(CARD); sd(BORDER);
        doc.setLineWidth(0.3);
        doc.roundedRect(M, curY, IW, boxH, 2, 2, 'FD');

        const cLeft = M + EPX;
        const cRight = M + IW - 4;
        const cTop = curY + EPY;
        const cBot = cTop + EH;
        const cChartW = cRight - cLeft;

        doc.setLineWidth(0.15);
        sd(BORDER);
        for (let gi = 0; gi <= 4; gi++) {
          const gy = cTop + (EH * gi) / 4;
          doc.line(cLeft, gy, cRight, gy);
        }

        const eleSpan = Math.max(1, routeStats.maxEle - routeStats.minEle);
        const kmTotal = Math.max(1, routeStats.totalKm);
        const step = Math.max(1, Math.ceil(route.length / 120));
        const sPts = route.filter((_, i) => i % step === 0).map(p => ({
          x: cLeft + (p.km / kmTotal) * cChartW,
          y: cBot - ((p.ele - routeStats.minEle) / eleSpan) * EH,
        }));

        if (sPts.length >= 2) {
          doc.setLineWidth(0.22);
          doc.setDrawColor(252, 211, 77);
          for (let i = 0; i < sPts.length; i += 2) {
            doc.line(sPts[i].x, cBot, sPts[i].x, sPts[i].y);
          }

          doc.setLineWidth(0.7);
          sd(ORANGE);
          for (let i = 1; i < sPts.length; i++) {
            doc.line(sPts[i-1].x, sPts[i-1].y, sPts[i].x, sPts[i].y);
          }
        }

        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
        st(MUTED);
        doc.text(`${routeStats.minEle.toFixed(0)}m`, M + 1, cBot);
        doc.text(`${routeStats.maxEle.toFixed(0)}m`, M + 1, cTop + 3);

        const kmTickValues: number[] = [0];
        for (let km = 5; km < kmTotal; km += 5) {
          kmTickValues.push(Number(km.toFixed(1)));
        }
        if (!kmTickValues.some((v) => Math.abs(v - kmTotal) < 0.2)) {
          kmTickValues.push(Number(kmTotal.toFixed(1)));
        }

        doc.setLineWidth(0.15);
        sd(MUTED);
        kmTickValues.forEach((km, index) => {
          const x = cLeft + (km / kmTotal) * cChartW;
          doc.line(x, cBot, x, cBot + 1.4);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(5.2);
          st(MUTED);
          const label = index === kmTickValues.length - 1 ? `${km.toFixed(1)} km` : `${Math.round(km)}k`;
          doc.text(label, x, cBot + 3.6, { align: 'center' });
        });

        curY += boxH + 5;
      }

      // ── INFRASTRUCTURE TABLE ─────────────────────────────────────────────
      const allRows = [
        ...markers.map((m, i) => ({
          num: String(i + 1),
          type: markerTypeLabel[m.type],
          km: `${m.km.toFixed(1)} km`,
          label: m.label,
          notes: m.notes || '—',
          colorHex: m.color,
        })),
        ...turnaroundMarkers.map((km, i) => ({
          num: `T${i + 1}`,
          type: 'Turnaround',
          km: `${km.toFixed(1)} km`,
          label: 'Turnaround Point',
          notes: 'Athletes reverse direction here',
          colorHex: buoyColor,
        })),
      ];

      if (allRows.length > 0) {
        sectionHeader('I', 'Race Infrastructure', RED, `${allRows.length} point${allRows.length !== 1 ? 's' : ''}`);

        // table header row
        sf(CARD); sd(BORDER);
        doc.setLineWidth(0.25);
        fr(M, curY, IW, 7, 'F');
        const tcols = [
          { label: '#',        x: M + 2,   fw: 8  },
          { label: 'TYPE',     x: M + 10,  fw: 38 },
          { label: 'KM',       x: M + 48,  fw: 22 },
          { label: 'LABEL',    x: M + 70,  fw: 58 },
          { label: 'NOTES',    x: M + 128, fw: 70 },
        ];
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
        st(MUTED);
        tcols.forEach(c => doc.text(c.label, c.x, curY + 4.8));
        sd(BORDER); doc.line(M, curY + 7, M + IW, curY + 7);
        curY += 7;

        const hexRgb = (h: string): RGB => {
          const n = parseInt(h.replace('#',''), 16);
          return [n >> 16 & 255, n >> 8 & 255, n & 255];
        };

        allRows.forEach((row, ri) => {
          if (curY > 268) return;
          const rh = 6;
          sf(ri % 2 === 0 ? CARD : DARK);
          fr(M, curY, IW, rh, 'F');

          doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
          st(TXT); doc.text(row.num, tcols[0].x, curY + 4);

          // colour dot
          try { sf(hexRgb(row.colorHex)); } catch { sf(MUTED); }
          doc.circle(tcols[1].x + 1.5, curY + 3, 1.4, 'F');

          doc.setFont('helvetica', 'normal');
          st(TXT); doc.text(row.type, tcols[1].x + 5, curY + 4);
          st(CYAN); doc.text(row.km, tcols[2].x, curY + 4);
          st(TXT); doc.text(row.label, tcols[3].x, curY + 4);
          st(MUTED); doc.text(row.notes, tcols[4].x, curY + 4);

          doc.setLineWidth(0.1); sd(BORDER);
          doc.line(M, curY + rh, M + IW, curY + rh);
          curY += rh;
        });
        curY += 5;
      }

      // ── ANNOTATIONS ──────────────────────────────────────────────────────
      if (annotation?.trim() && curY < 260) {
        sectionHeader('N', 'Notes & Annotations', MUTED);
        const noteLines = doc.splitTextToSize(annotation, IW - 10);
        const noteH = Math.min(noteLines.length * 4.2 + 6, 30);
        sf(CARD); sd(BORDER);
        doc.setLineWidth(0.3);
        doc.roundedRect(M, curY, IW, noteH, 1.5, 1.5, 'FD');
        // left accent bar
        sf(CYAN); fr(M, curY, 1.5, noteH, 'F');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        st(TXT);
        doc.text(noteLines.slice(0, 6), M + 5, curY + 5);
        curY += noteH + 4;
      }

      // ── FOOTER ───────────────────────────────────────────────────────────
      const FY = PH - 16;
      sf(CARD); fr(0, FY, PW, 16, 'F');
      sd(BORDER); doc.setLineWidth(0.35);
      doc.line(0, FY, PW, FY);

      // sponsor logos
      if (sponsorLogos.length) {
        let sx = M;
        for (const logo of sponsorLogos.slice(0, 6)) {
          try { doc.addImage(logo.dataUrl, 'PNG', sx, FY + 3, 16, 7); sx += 19; } catch { /* ignore */ }
        }
      }

      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      st(TXT);
      doc.text('Bergman Event Mapper Pro', PW / 2, FY + 7.5, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
      st(MUTED);
      doc.text(
        `Generated by Bergman Event Mapper Pro  ·  Course map from certified GPX data  ·  For official use only`,
        PW / 2, FY + 12.5, { align: 'center' }
      );
      doc.setFontSize(5.5);
      st(MUTED);
      doc.text('Page 1', PW - M, FY + 12.5, { align: 'right' });

      const safeEvent = eventName.replace(/[^a-z0-9\-_]+/gi, '_');
      doc.save(`${safeEvent}_EventMapperPro.pdf`);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border shadow-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPinned className="h-5 w-5" /> Bergman Event Mapper Pro
          </CardTitle>
          <CardDescription>
            Upload GPX, design race infrastructure overlays, and export a professional Ironman-style PDF route map.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>GPX Processing Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!!googleMapLoadError && (
            <Alert variant="destructive">
              <AlertTitle>Google Maps failed to load</AlertTitle>
              <AlertDescription>Check NEXT_PUBLIC_GOOGLE_MAPS_API_KEY and browser internet access.</AlertDescription>
            </Alert>
          )}

          {!googleMapsApiKey && (
            <Alert>
              <AlertTitle>Google Maps API key not configured</AlertTitle>
              <AlertDescription>
                Real map preview is disabled. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable Google Maps.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Event</Label>
              <Select
                value={selectedEventId || undefined}
                onValueChange={(v) => setSelectedEventId(v)}
                disabled={isLoadingEvents || events.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingEvents ? 'Loading events...' : 'Select event'} />
                </SelectTrigger>
                <SelectContent>
                  {events.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>GPX Upload</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="file"
                  accept=".gpx,application/gpx+xml,application/xml,text/xml"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onGpxUpload(file);
                  }}
                  className="max-w-md"
                />
                {fileName && <Badge variant="secondary" className="gap-1"><FileUp className="h-3 w-3" />{fileName}</Badge>}
                <span className="mx-1 text-xs text-muted-foreground">— or —</span>
                <Button
                  type="button"
                  variant={drawMode !== 'off' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    if (!showRealMap) setShowRealMap(true);
                    setDrawMode(drawMode === 'off' ? 'snap' : 'off');
                  }}
                >
                  {drawMode !== 'off' ? '✓ Drawing on map' : '✏️ Draw route on map'}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Upload a GPX file from your device, or click <strong>Draw route on map</strong> and tap on roads to build a route in the browser (Ride-with-GPS style).
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>KM Marker Display</Label>
              <Select value={kmMarkerMode} onValueChange={(v) => setKmMarkerMode(v as KmMarkerMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Do not show</SelectItem>
                  <SelectItem value="1">Every 1 km</SelectItem>
                  <SelectItem value="2">Every 2 km</SelectItem>
                  <SelectItem value="5">Every 5 km</SelectItem>
                  <SelectItem value="10">Every 10 km</SelectItem>
                  <SelectItem value="custom">Custom list</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Custom KM markers</Label>
              <Input
                value={customKmInput}
                onChange={(e) => setCustomKmInput(e.target.value)}
                disabled={kmMarkerMode !== 'custom'}
                placeholder="1,2,5,10"
              />
            </div>

            <div className="space-y-2">
              <Label>Turnaround markers (KM)</Label>
              <Input
                value={turnaroundInput}
                onChange={(e) => setTurnaroundInput(e.target.value)}
                placeholder="e.g. 21.1,42.2"
              />
            </div>
          </div>

          {routeStats && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Route Distance</p><p className="text-lg font-semibold">{routeStats.totalKm.toFixed(2)} km</p></CardContent></Card>
              <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Elevation Gain</p><p className="text-lg font-semibold">{routeStats.gain.toFixed(0)} m</p></CardContent></Card>
              <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Elevation Loss</p><p className="text-lg font-semibold">{routeStats.loss.toFixed(0)} m</p></CardContent></Card>
              <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Markers</p><p className="text-lg font-semibold">{markers.length}</p></CardContent></Card>
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Mountain className="h-4 w-4" />
              <h3 className="font-semibold">Race Infrastructure Markers</h3>
            </div>

            <div className="grid gap-3 md:grid-cols-6">
              <div className="space-y-2 md:col-span-2">
                <Label>Type</Label>
                <Select value={newType} onValueChange={(v) => setNewType(v as MarkerType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(markerTypeLabel).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>KM Point</Label>
                <Input value={newKm} onChange={(e) => setNewKm(e.target.value)} placeholder="e.g. 12.5" />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Label</Label>
                <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Aid 1" />
              </div>

              <div className="space-y-2">
                <Label>Icon Color</Label>
                <Input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="p-1 h-10" />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Optional station notes" />
              </div>
              <div className="flex items-end">
                <Button onClick={addMarker} disabled={!routeStats} className="w-full md:w-auto">
                  <PlusCircle className="mr-2 h-4 w-4" /> Add Marker
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {markers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No markers yet.</p>
              ) : (
                <div className="space-y-2">
                  {markers.map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded border p-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: m.color }} />
                        <span className="font-medium">{markerTypeLabel[m.type]}</span>
                        <span className="text-muted-foreground">{m.km.toFixed(1)} km</span>
                        <span>{m.label}</span>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeMarker(m.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <Separator />

          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-300" />
              <h3 className="font-semibold">Branding • Event & Sponsors</h3>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Event Logo</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onEventLogoUpload(file);
                  }}
                />
                {eventLogo && (
                  <div className="flex items-center justify-between rounded border bg-background p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <NextImage
                        src={eventLogo.dataUrl}
                        alt={eventLogo.name}
                        width={48}
                        height={32}
                        unoptimized
                        className="h-8 w-12 rounded object-contain bg-white"
                      />
                      <span>{eventLogo.name}</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setEventLogo(null)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Sponsor Logos (up to 8)</Label>
                <Input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => void onSponsorLogoUpload(e.target.files)}
                />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {sponsorLogos.map((logo) => (
                    <div key={logo.id} className="relative rounded border bg-background p-1">
                      <NextImage
                        src={logo.dataUrl}
                        alt={logo.name}
                        width={120}
                        height={56}
                        unoptimized
                        className="h-14 w-full rounded object-contain bg-white"
                      />
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[10px]"
                        onClick={() => setSponsorLogos((prev) => prev.filter((l) => l.id !== logo.id))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Custom Annotation</Label>
            <Textarea
              value={annotation}
              onChange={(e) => setAnnotation(e.target.value)}
              rows={3}
              placeholder="Add athlete instructions, safety notes, transition guidance, cut-off reminders, etc."
            />
          </div>

          {showRealMap && !!googleMapsApiKey && isGoogleMapLoaded && (route.length > 1 || drawMode !== 'off' || waypoints.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Flag className="h-4 w-4 text-cyan-300" /> Real Map Preview
                </Label>
                <Button variant="outline" size="sm" onClick={() => setShowRealMap(false)}>Hide map</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Hover the route to see the live km mark · Click anywhere on (or near) the route to auto-fill the “Km” field below for the next marker.
              </p>

              {/* ── Draw Route toolbar (Ride-with-GPS style) ── */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2 text-sm">
                <span className="font-semibold">Draw Route:</span>
                <Button
                  size="sm"
                  variant={drawMode === 'snap' ? 'default' : 'outline'}
                  onClick={() => setDrawMode(drawMode === 'snap' ? 'off' : 'snap')}
                >
                  {drawMode === 'snap' ? '✓ Snap to Roads (drawing)' : 'Snap to Roads'}
                </Button>
                <Button
                  size="sm"
                  variant={drawMode === 'free' ? 'default' : 'outline'}
                  onClick={() => setDrawMode(drawMode === 'free' ? 'off' : 'free')}
                >
                  {drawMode === 'free' ? '✓ Free Draw (drawing)' : 'Free Draw'}
                </Button>
                <Select value={routingMode} onValueChange={(v) => {
                  const m = v as RoutingMode;
                  setRoutingMode(m);
                  if (drawMode === 'snap' && waypoints.length >= 2) {
                    void rebuildRouteFromWaypoints(waypoints, true);
                  }
                }}>
                  <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cycling">🚴 Cycling</SelectItem>
                    <SelectItem value="walking">🏃 Running / Walk</SelectItem>
                    <SelectItem value="driving">🚗 Driving</SelectItem>
                  </SelectContent>
                </Select>
                <span className="ml-2 text-xs text-muted-foreground">
                  {waypoints.length} waypoint{waypoints.length !== 1 ? 's' : ''}
                  {isRouting && ' • routing…'}
                  {routeStats && ` • ${routeStats.totalKm.toFixed(2)} km`}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={undoLastWaypoint} disabled={!waypoints.length}>Undo</Button>
                  <Button size="sm" variant="ghost" onClick={clearDrawnRoute} disabled={!waypoints.length && !route.length}>Clear</Button>
                  <Button size="sm" variant="outline" onClick={exportRouteAsGpx} disabled={!route.length}>
                    <Download className="mr-1 h-3 w-3" /> GPX
                  </Button>
                </div>
              </div>
              {drawMode !== 'off' && (
                <p className="rounded border-l-4 border-cyan-500 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100">
                  ✏️ Drawing mode — click on the map to drop waypoints. Drag any waypoint to fine-tune.
                  {drawMode === 'snap' ? ' Roads are snapped automatically.' : ' Straight lines are drawn between points.'}
                </p>
              )}
              <div className="overflow-hidden rounded-xl border border-slate-700">
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '520px' }}
                  center={mapCenter}
                  zoom={12}
                  onMouseMove={(e) => {
                    const ll = e.latLng;
                    if (!ll) return;
                    const hit = findNearestKmTo(ll.lat(), ll.lng());
                    if (!hit) return;
                    // Show only when the cursor is reasonably close to the route
                    // (≤ 2 km away). Beyond that, hide so the marker doesn't drift.
                    if (hit.distKm > 2) {
                      setHoverKm(null);
                    } else {
                      setHoverKm(hit.km);
                    }
                  }}
                  onClick={(e) => {
                    const ll = e.latLng;
                    if (!ll) return;
                    // Draw mode → add a waypoint and re-route.
                    if (drawMode !== 'off') {
                      addWaypoint(ll.lat(), ll.lng());
                      return;
                    }
                    const hit = findNearestKmTo(ll.lat(), ll.lng());
                    if (!hit || hit.distKm > 2) return;
                    // One-click placement: pre-fill the "Add marker" form with this km.
                    setNewKm(hit.km.toFixed(2));
                  }}
                  options={{
                    disableDefaultUI: false,
                    streetViewControl: false,
                    mapTypeControl: true,
                    mapTypeControlOptions: typeof window !== 'undefined' && window.google?.maps
                      ? {
                          style: window.google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
                          mapTypeIds: ['roadmap', 'hybrid', 'satellite', 'terrain'],
                        }
                      : undefined,
                    zoomControl: true,
                    fullscreenControl: true,
                    styles: [
                      // ── Base canvas ──────────────────────────────────────
                      { elementType: 'geometry', stylers: [{ color: '#f5f1e6' }] },           // warm paper
                      { elementType: 'labels.text.fill', stylers: [{ color: '#1f2937' }] },
                      { elementType: 'labels.text.stroke', stylers: [{ color: '#fffaf0' }, { weight: 3 }] },

                      // ── Road hierarchy (clear visual difference) ─────────
                      // Highways – warm orange like printed maps
                      { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#fbbf24' }] },
                      { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#92400e' }, { weight: 1.2 }] },
                      { featureType: 'road.highway.controlled_access', elementType: 'geometry.fill', stylers: [{ color: '#f59e0b' }] },
                      // Arterials – yellow
                      { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#fde68a' }] },
                      { featureType: 'road.arterial', elementType: 'geometry.stroke', stylers: [{ color: '#a16207' }] },
                      // Local side roads – white with grey casing (the key bit you wanted)
                      { featureType: 'road.local', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
                      { featureType: 'road.local', elementType: 'geometry.stroke', stylers: [{ color: '#9ca3af' }] },
                      // Unclassified / service / tracks
                      { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
                      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#cbd5e1' }] },

                      // ── Road labels (so streets are identifiable) ────────
                      { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
                      { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#7c2d12' }] },
                      { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#78350f' }] },
                      { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#374151' }] },

                      // ── Water ────────────────────────────────────────────
                      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#a5c7e6' }] },
                      { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#1e3a8a' }] },

                      // ── Landscape ────────────────────────────────────────
                      { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f5f1e6' }] },
                      { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#e8efe2' }] },
                      { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#eee9da' }] },

                      // ── POI / parks (only parks visible, no clutter) ─────
                      { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
                      { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: '#cfe9c0' }] },
                      { featureType: 'poi.park', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },

                      // ── Transit hidden ───────────────────────────────────
                      { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },

                      // ── Admin labels (only city names) ───────────────────
                      { featureType: 'administrative.neighborhood', elementType: 'labels', stylers: [{ visibility: 'off' }] },
                      { featureType: 'administrative.land_parcel', elementType: 'labels', stylers: [{ visibility: 'off' }] },
                      { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#374151' }] },
                      { featureType: 'administrative.locality', elementType: 'labels.text.stroke', stylers: [{ color: '#fffaf0' }, { weight: 3 }] },
                      { featureType: 'administrative.province', elementType: 'labels', stylers: [{ visibility: 'off' }] },
                      { featureType: 'administrative.country', elementType: 'labels', stylers: [{ visibility: 'off' }] },
                    ],
                  }}
                >
                  <PolylineF
                    path={googlePath}
                    options={{
                      strokeColor: '#22d3ee',
                      strokeOpacity: 1,
                      strokeWeight: 5,
                    }}
                  />

                  {/* Drawn-route waypoints (draggable) */}
                  {waypoints.map((w, idx) => {
                    const isStart = idx === 0;
                    const isEnd = idx === waypoints.length - 1 && waypoints.length > 1;
                    const wpIcon = typeof window !== 'undefined' && window.google?.maps
                      ? {
                          path: window.google.maps.SymbolPath.CIRCLE,
                          scale: isStart || isEnd ? 9 : 6,
                          fillColor: isStart ? '#22c55e' : isEnd ? '#ef4444' : '#0ea5e9',
                          fillOpacity: 1,
                          strokeColor: '#ffffff',
                          strokeWeight: 2,
                        }
                      : undefined;
                    return (
                      <MarkerF
                        key={`wp-${idx}`}
                        position={w}
                        icon={wpIcon}
                        draggable
                        zIndex={8000 + idx}
                        onDragEnd={(e) => {
                          const ll = e.latLng;
                          if (!ll) return;
                          moveWaypoint(idx, ll.lat(), ll.lng());
                        }}
                        title={isStart ? 'Start' : isEnd ? 'Finish' : `Waypoint ${idx + 1}`}
                        label={{
                          text: isStart ? 'S' : isEnd ? 'F' : String(idx + 1),
                          color: '#ffffff',
                          fontWeight: '700',
                          fontSize: '10px',
                        }}
                      />
                    );
                  })}

                  {hoverKm != null && (() => {
                    const pt = getRoutePointAtKm(hoverKm);
                    if (!pt) return null;
                    const hoverIcon = typeof window !== 'undefined' && window.google?.maps
                      ? {
                          path: window.google.maps.SymbolPath.CIRCLE,
                          scale: 9,
                          fillColor: '#ef4444',
                          fillOpacity: 1,
                          strokeColor: '#ffffff',
                          strokeWeight: 3,
                        }
                      : undefined;
                    return (
                      <MarkerF
                        key="hover-km-marker"
                        position={{ lat: pt.lat, lng: pt.lng }}
                        icon={hoverIcon}
                        zIndex={9999}
                        clickable
                        onClick={() => setNewKm(pt.km.toFixed(2))}
                        label={{
                          text: `${pt.km.toFixed(2)} km`,
                          color: '#7f1d1d',
                          fontWeight: '700',
                          fontSize: '12px',
                          className: 'event-mapper-hover-label',
                        }}
                        title={`${pt.km.toFixed(2)} km · ${pt.ele.toFixed(0)} m`}
                      />
                    );
                  })()}

                  {kmMarkerSet.map((km) => {
                    const pt = getRoutePointAtKm(km);
                    if (!pt) return null;
                    return (
                      <MarkerF
                        key={`km-${km}`}
                        position={{ lat: pt.lat, lng: pt.lng }}
                        label={{ text: String(km), color: '#111827', fontWeight: '700' }}
                        title={`${km} km`}
                      />
                    );
                  })}

                  {turnaroundMarkers.map((km, index) => {
                    const pt = getRoutePointAtKm(km);
                    if (!pt) return null;
                    return (
                      <MarkerF
                        key={`turnaround-${index}-${km}`}
                        position={{ lat: pt.lat, lng: pt.lng }}
                        label={{ text: 'T', color: '#7c2d12', fontWeight: '700' }}
                        title={`Turnaround • ${km.toFixed(1)} km`}
                      />
                    );
                  })}

                  {markers.map((m) => {
                    const pt = getRoutePointAtKm(m.km);
                    if (!pt) return null;

                    if (m.type === 'water_station') {
                      const waterIcon = typeof window !== 'undefined' && window.google?.maps
                        ? {
                            path: window.google.maps.SymbolPath.CIRCLE,
                            scale: 8,
                            fillColor: '#0ea5e9',
                            fillOpacity: 1,
                            strokeColor: '#ffffff',
                            strokeWeight: 2,
                          }
                        : undefined;

                      return (
                        <MarkerF
                          key={m.id}
                          position={{ lat: pt.lat, lng: pt.lng }}
                          title={`Hydration • ${m.km.toFixed(1)} km • ${m.label}`}
                          label={{
                            text: m.label || 'Hydration',
                            color: '#0c4a6e',
                            fontWeight: '700',
                            fontSize: '11px',
                          }}
                          icon={waterIcon}
                        />
                      );
                    }

                    return (
                      <MarkerF
                        key={m.id}
                        position={{ lat: pt.lat, lng: pt.lng }}
                        title={`${markerTypeLabel[m.type]} • ${m.km.toFixed(1)} km • ${m.label}`}
                        label={{ text: m.label.slice(0, 1).toUpperCase(), color: '#111827', fontWeight: '700' }}
                      />
                    );
                  })}
                </GoogleMap>
              </div>
            </div>
          )}

          {showRealMap && (!googleMapsApiKey || !isGoogleMapLoaded) && (
            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              Real map is not available yet. Configure Google Maps API key to enable this section.
            </div>
          )}

          {!showRealMap && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setShowRealMap(true)}>Show real map</Button>
            </div>
          )}

          <div className="overflow-auto rounded-lg border border-slate-700 bg-slate-950/40 p-2">
            <div ref={mapPreviewWrapperRef} className="relative w-full" style={{ aspectRatio: `${MAP_W} / ${MAP_H}` }}>
              <canvas ref={mapCanvasRef} width={MAP_W} height={MAP_H} className="absolute inset-0 h-full w-full rounded" />

              {/* Drag/resize overlays — coordinates stored in canvas px, projected via % */}
              {eventLogo && (
                <LogoOverlay
                  label="Event"
                  transform={eventLogoTransform}
                  mapW={MAP_W}
                  mapH={MAP_H}
                  wrapperRef={mapPreviewWrapperRef}
                  onChange={setEventLogoTransform}
                />
              )}
              {sponsorLogos.map((logo) => {
                const t = sponsorTransforms[logo.id];
                if (!t) return null;
                return (
                  <LogoOverlay
                    key={logo.id}
                    label={logo.name.length > 14 ? logo.name.slice(0, 12) + '…' : logo.name}
                    transform={t}
                    mapW={MAP_W}
                    mapH={MAP_H}
                    wrapperRef={mapPreviewWrapperRef}
                    onChange={(nt) => setSponsorTransforms((prev) => ({ ...prev, [logo.id]: nt }))}
                  />
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Drag any logo to reposition • drag the bottom-right corner handle to resize • PDF export uses these positions.
            </p>
          </div>
          <div
            ref={elevationWrapperRef}
            className="relative overflow-auto rounded-lg border border-slate-700 bg-slate-950/40 p-2"
            onMouseMove={(e) => {
              const canvas = elevationCanvasRef.current;
              if (!canvas || !routeStats) return;
              const rect = canvas.getBoundingClientRect();
              const xRel = e.clientX - rect.left;
              const padCss = (34 / canvas.width) * rect.width;
              const usable = Math.max(1, rect.width - padCss * 2);
              const ratio = Math.max(0, Math.min(1, (xRel - padCss) / usable));
              setHoverKm(ratio * routeStats.totalKm);
            }}
            onMouseLeave={() => setHoverKm(null)}
          >
            <canvas ref={elevationCanvasRef} width={1400} height={260} className="h-auto w-full rounded" />
            {hoverKm != null && routeStats && (() => {
              const canvas = elevationCanvasRef.current;
              const wrapper = elevationWrapperRef.current;
              if (!canvas || !wrapper) return null;
              const pt = getRoutePointAtKm(Math.max(0, Math.min(routeStats.totalKm, hoverKm)));
              if (!pt) return null;
              const rect = canvas.getBoundingClientRect();
              const wRect = wrapper.getBoundingClientRect();
              const padCss = (34 / canvas.width) * rect.width;
              const usable = Math.max(1, rect.width - padCss * 2);
              const left = (rect.left - wRect.left) + padCss + (pt.km / routeStats.totalKm) * usable;
              return (
                <div
                  className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900/95 px-2 py-1 text-[11px] font-semibold text-white shadow-lg"
                  style={{ left, top: 4 }}
                >
                  {pt.km.toFixed(2)} km · {pt.ele.toFixed(0)} m
                </div>
              );
            })()}
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void exportPdf()} disabled={!routeStats || isExporting}>
              <Download className="mr-2 h-4 w-4" /> {isExporting ? 'Preparing Custom Map PDF...' : 'Export Professional PDF'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Draggable + resizable logo overlay (canvas-coordinate transform).
// Stores positions in CANVAS pixels so the rendered canvas (and the PDF that
// embeds it) match exactly what the user sees on screen.
// ────────────────────────────────────────────────────────────────────────────
interface LogoOverlayProps {
  label: string;
  transform: { x: number; y: number; w: number; h: number };
  mapW: number;
  mapH: number;
  wrapperRef: React.RefObject<HTMLDivElement>;
  onChange: (next: { x: number; y: number; w: number; h: number }) => void;
}

function LogoOverlay({ label, transform, mapW, mapH, wrapperRef, onChange }: LogoOverlayProps) {
  const dragRef = useRef<{
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
    rectW: number;
    rectH: number;
  } | null>(null);

  const startInteraction = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...transform },
      rectW: rect.width,
      rectH: rect.height,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dxPx = e.clientX - d.startX;
    const dyPx = e.clientY - d.startY;
    // Convert CSS pixel deltas → canvas-space pixel deltas.
    const dx = (dxPx / d.rectW) * mapW;
    const dy = (dyPx / d.rectH) * mapH;
    if (d.mode === 'move') {
      const x = Math.max(0, Math.min(mapW - d.orig.w, d.orig.x + dx));
      const y = Math.max(0, Math.min(mapH - d.orig.h, d.orig.y + dy));
      onChange({ x, y, w: d.orig.w, h: d.orig.h });
    } else {
      const w = Math.max(24, Math.min(mapW - d.orig.x, d.orig.w + dx));
      const h = Math.max(16, Math.min(mapH - d.orig.y, d.orig.h + dy));
      onChange({ x: d.orig.x, y: d.orig.y, w, h });
    }
  };

  const endInteraction = (e: React.PointerEvent) => {
    dragRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  return (
    <div
      className="group absolute cursor-move rounded border-2 border-cyan-400/60 bg-cyan-300/5 transition hover:border-cyan-300 hover:bg-cyan-300/10"
      style={{
        left: `${(transform.x / mapW) * 100}%`,
        top: `${(transform.y / mapH) * 100}%`,
        width: `${(transform.w / mapW) * 100}%`,
        height: `${(transform.h / mapH) * 100}%`,
      }}
      onPointerDown={(e) => startInteraction(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      title={`${label} — drag to move, drag corner to resize`}
    >
      <span className="pointer-events-none absolute -top-5 left-0 rounded bg-cyan-500 px-1.5 py-px text-[10px] font-bold uppercase text-white opacity-0 shadow group-hover:opacity-100">
        {label} · {Math.round(transform.w)}×{Math.round(transform.h)}
      </span>
      <div
        className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-cyan-500 shadow"
        onPointerDown={(e) => startInteraction(e, 'resize')}
        onPointerMove={onPointerMove}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
      />
    </div>
  );
}
