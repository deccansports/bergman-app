// src/components/events/CourseMapDialog.tsx
"use client";

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { EventCalendarEntry, TicketDefinition, CustomSplitPoint } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import MapViewer, { type GpxPath } from '@/components/live-tracking/MapViewer';
import ElevationProfileChart from '@/components/live-tracking/ElevationProfileChart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from '@/components/ui/button';
import { Map as MapIcon, Download, Waves, Bike, Footprints, FileDown, Loader2, Mountain, Gauge, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';

const gpxAssetConfig = {
  swimGpxUrl: { color: '#0ea5e9', type: 'swim', icon: Waves, descriptionKey: 'swimDescription' },
  bikeGpxUrl: { color: '#22c55e', type: 'bike', icon: Bike, descriptionKey: 'bikeDescription' },
  runGpxUrl: { color: '#f97316', type: 'run', icon: Footprints, descriptionKey: 'runDescription' },
  run1GpxUrl: { color: '#f97316', type: 'run1', icon: Footprints, descriptionKey: 'run1Description' },
  run2GpxUrl: { color: '#f59e0b', type: 'run2', icon: Footprints, descriptionKey: 'run2Description' },
};

const MapViewerLeaflet = dynamic(() => import('@/components/live-tracking/MapViewerLeaflet'), {
  ssr: false,
});

interface CourseMapDialogProps {
  event: EventCalendarEntry;
  isOpen: boolean;
  onClose: () => void;
  ticketId?: string | null; 
}

export default function CourseMapDialog({ event, isOpen, onClose, ticketId }: CourseMapDialogProps) {
  const { toast } = useToast();
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isLeafletMapReady, setIsLeafletMapReady] = useState(false);
  const mapCaptureRef = React.useRef<HTMLDivElement | null>(null);
  const leafletMapCaptureRef = React.useRef<HTMLDivElement | null>(null);

  const ticketsWithMaps = useMemo(() => {
    return (event.ticketDefinitions || []).filter(td => 
      !td.isHidden && (
        td.courseMaps?.swimGpxUrl || 
        td.courseMaps?.bikeGpxUrl || 
        td.courseMaps?.runGpxUrl ||
        td.courseMaps?.run1GpxUrl ||
        td.courseMaps?.run2GpxUrl
      )
    );
  }, [event.ticketDefinitions]);

  const [selectedTicket, setSelectedTicket] = useState<TicketDefinition | null>(() => {
    if (ticketId) {
      return ticketsWithMaps.find(t => t.id === ticketId) || ticketsWithMaps[0] || null;
    }
    return ticketsWithMaps[0] || null;
  });
  const [selectedLegIndex, setSelectedLegIndex] = useState(0);

  const [elevationData, setElevationData] = useState<GpxPath[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const nextTicket = ticketId
      ? ticketsWithMaps.find(t => t.id === ticketId) || ticketsWithMaps[0] || null
      : ticketsWithMaps[0] || null;
    setSelectedTicket(nextTicket);
  }, [isOpen, ticketId, ticketsWithMaps, event.id]);

  useEffect(() => {
    setElevationData([]);
  }, [selectedTicket?.id]);

  useEffect(() => {
    setSelectedLegIndex(0);
    setIsLeafletMapReady(false);
  }, [selectedTicket?.id]);

  const onGpxDataLoaded = useCallback((gpxPaths: GpxPath[]) => {
    setElevationData(gpxPaths);
  }, []);

  const mapRoutes = useMemo(() => {
    if (!selectedTicket?.courseMaps) return [];
    const gpxKeys = Object.keys(gpxAssetConfig) as (keyof typeof gpxAssetConfig)[];
    return gpxKeys
        .map(assetKey => {
            const url = (selectedTicket.courseMaps as any)?.[assetKey];
            const descKey = (gpxAssetConfig as any)[assetKey]?.descriptionKey;
            const description = (selectedTicket.courseMaps as any)?.[descKey];
            if (url) {
                return { 
                  url, 
                  assetKey,
                  color: (gpxAssetConfig as any)[assetKey]?.color || '#8884d8',
                  type: (gpxAssetConfig as any)[assetKey]?.type || 'bike',
                  icon: (gpxAssetConfig as any)[assetKey]?.icon || Download,
                  description: description || null
                };
            }
            return null;
        })
        .filter((route): route is { url: string; assetKey: keyof typeof gpxAssetConfig; color: string; type: string, icon: React.ElementType, description: string | null } => route !== null);
  }, [selectedTicket]);

  useEffect(() => {
    if (!mapRoutes.length) {
      setSelectedLegIndex(0);
      return;
    }
    if (selectedLegIndex >= mapRoutes.length) {
      setSelectedLegIndex(0);
    }
  }, [mapRoutes, selectedLegIndex]);

  const selectedRoute = mapRoutes[selectedLegIndex] || null;

  const formatLegLabel = useCallback((type: string) => {
    if (type === 'run1') return 'Run 1';
    if (type === 'run2') return 'Run 2';
    return type.charAt(0).toUpperCase() + type.slice(1);
  }, []);

  const resolveDistanceForLeg = useCallback((route: { type: string; assetKey: keyof typeof gpxAssetConfig }, idx: number) => {
    const maps = selectedTicket?.courseMaps;
    if (!maps) return null;

    const fromTicket = route.assetKey === 'swimGpxUrl' ? maps.swimDistance
      : route.assetKey === 'bikeGpxUrl' ? maps.bikeDistance
      : route.assetKey === 'runGpxUrl' ? maps.runDistance
      : route.assetKey === 'run1GpxUrl' ? maps.run1Distance
      : route.assetKey === 'run2GpxUrl' ? maps.run2Distance
      : null;

    if (typeof fromTicket === 'number' && Number.isFinite(fromTicket) && fromTicket > 0) return fromTicket;

    const fromGpx = elevationData[idx]?.elevationData?.slice(-1)[0]?.distance;
    if (typeof fromGpx === 'number' && Number.isFinite(fromGpx) && fromGpx > 0) return fromGpx;
    return null;
  }, [selectedTicket, elevationData]);

  const resolveLoopsForLeg = useCallback((routeType: string) => {
    if (!selectedTicket) return null;
    if (routeType === 'swim') return selectedTicket.swimLoops ?? null;
    if (routeType === 'bike') return selectedTicket.bikeLoops ?? null;
    if (routeType === 'run' || routeType === 'run1' || routeType === 'run2') return selectedTicket.runLoops ?? null;
    return null;
  }, [selectedTicket]);

  const getElevationStats = useCallback((gpxPath: GpxPath | undefined | null) => {
    if (!gpxPath?.elevationData?.length) return null;
    const points = gpxPath.elevationData;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < points.length; i++) {
      const delta = points[i].elevation - points[i - 1].elevation;
      if (delta > 0) gain += delta;
      else loss += Math.abs(delta);
    }
    const elevations = points.map(p => p.elevation);
    return {
      gain,
      loss,
      min: Math.min(...elevations),
      max: Math.max(...elevations),
    };
  }, []);

  const getElevationInsights = useCallback((gpxPath: GpxPath | undefined | null) => {
    if (!gpxPath?.elevationData?.length) return null;

    const points = gpxPath.elevationData;
    const totalDistanceKm = points[points.length - 1]?.distance || 0;
    if (!totalDistanceKm || totalDistanceKm <= 0) return null;

    const stats = getElevationStats(gpxPath);
    if (!stats) return null;

    // More robust grading: use per-segment slope distribution to avoid false "flat" labels.
    const absSlopes: number[] = [];
    let steepSegments = 0;
    let mediumSegments = 0;
    let flatSegments = 0;

    for (let i = 1; i < points.length; i++) {
      const deltaEle = points[i].elevation - points[i - 1].elevation;
      const deltaDistKm = Math.max(points[i].distance - points[i - 1].distance, 0);
      const deltaDistM = deltaDistKm * 1000;
      if (!deltaDistM || deltaDistM < 1) continue;

      const slopePercent = Math.abs((deltaEle / deltaDistM) * 100);
      absSlopes.push(slopePercent);

      if (slopePercent >= 6) steepSegments++;
      else if (slopePercent >= 3) mediumSegments++;
      else if (slopePercent < 2) flatSegments++;
    }

    if (!absSlopes.length) return null;

    const sorted = [...absSlopes].sort((a, b) => a - b);
    const p90Slope = sorted[Math.floor((sorted.length - 1) * 0.9)] || 0;
    const maxSlope = sorted[sorted.length - 1] || 0;
    const avgGradePercent = (stats.gain / (totalDistanceKm * 1000)) * 100;
    const steepShare = steepSegments / absSlopes.length;
    const mediumShare = mediumSegments / absSlopes.length;
    const flatShare = flatSegments / absSlopes.length;

    let gradeLabel = 'Flat & Fast';
    let gradeColor = '#059669';
    let gradeBg = '#ecfdf5';
    let gradeBorder = '#a7f3d0';
    let paceLabel = 'High speed potential';
    let paceColor = '#059669';

    if (p90Slope >= 6 || steepShare >= 0.2 || maxSlope >= 10) {
      gradeLabel = 'Tough climbing grade';
      gradeColor = '#dc2626';
      gradeBg = '#fef2f2';
      gradeBorder = '#fecaca';
      paceLabel = 'Reduced speed, manage effort';
      paceColor = '#dc2626';
    } else if (p90Slope >= 4 || mediumShare >= 0.35 || avgGradePercent >= 2.0) {
      gradeLabel = 'Medium rolling grade';
      gradeColor = '#2563eb';
      gradeBg = '#eff6ff';
      gradeBorder = '#bfdbfe';
      paceLabel = 'Moderate speed profile';
      paceColor = '#2563eb';
    } else if (p90Slope >= 2.5 || mediumShare >= 0.2 || avgGradePercent >= 1.2) {
      gradeLabel = 'Light rolling grade';
      gradeColor = '#ea580c';
      gradeBg = '#fff7ed';
      gradeBorder = '#fed7aa';
      paceLabel = 'Mostly fast, watch rollers';
      paceColor = '#ea580c';
    } else if (flatShare < 0.6 && p90Slope >= 2.0) {
      gradeLabel = 'Light rolling grade';
      gradeColor = '#ea580c';
      gradeBg = '#fff7ed';
      gradeBorder = '#fed7aa';
      paceLabel = 'Mostly fast, watch rollers';
      paceColor = '#ea580c';
    }

    return {
      avgGradePercent,
      p90Slope,
      maxSlope,
      steepShare,
      mediumShare,
      flatShare,
      totalDistanceKm,
      gain: stats.gain,
      loss: stats.loss,
      min: stats.min,
      max: stats.max,
      gradeLabel,
      gradeColor,
      gradeBg,
      gradeBorder,
      paceLabel,
      paceColor,
    };
  }, [getElevationStats]);

  const formatDuration = useCallback((minutes: number | null) => {
    if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return 'N/A';
    const rounded = Math.round(minutes);
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    if (h <= 0) return `${m} min`;
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  }, []);

  const estimateLegDurationMinutes = useCallback((
    routeType: string,
    distanceKm: number | null,
    insights?: {
      avgGradePercent: number;
      p90Slope: number;
    } | null
  ) => {
    if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;

    // Baseline average athlete assumptions
    // Swim: ~2:15/100m, Bike: ~27 km/h, Run: ~7:00 min/km
    if (routeType === 'swim') {
      const minutesPerKm = 22.5;
      return distanceKm * minutesPerKm;
    }

    const isBike = routeType === 'bike';
    const isRun = routeType === 'run' || routeType === 'run1' || routeType === 'run2';

    if (isBike) {
      const baseSpeedKmh = 27;
      const baseMinutes = (distanceKm / baseSpeedKmh) * 60;
      const avgGrade = insights?.avgGradePercent ?? 0;
      const p90 = insights?.p90Slope ?? 0;
      const terrainFactor = 1 + Math.min(0.75, avgGrade * 0.09 + p90 * 0.035);
      return baseMinutes * terrainFactor;
    }

    if (isRun) {
      const basePaceMinPerKm = 7;
      const baseMinutes = distanceKm * basePaceMinPerKm;
      const avgGrade = insights?.avgGradePercent ?? 0;
      const p90 = insights?.p90Slope ?? 0;
      const terrainFactor = 1 + Math.min(0.95, avgGrade * 0.14 + p90 * 0.045);
      return baseMinutes * terrainFactor;
    }

    return null;
  }, []);

  const getEstimatedPaceLabel = useCallback((
    routeType: string,
    distanceKm: number | null,
    estimatedMinutes: number | null
  ) => {
    if (
      estimatedMinutes === null ||
      !Number.isFinite(estimatedMinutes) ||
      estimatedMinutes <= 0 ||
      distanceKm === null ||
      !Number.isFinite(distanceKm) ||
      distanceKm <= 0
    ) {
      return 'N/A';
    }

    if (routeType === 'swim') {
      const minPer100m = estimatedMinutes / (distanceKm * 10);
      const mins = Math.floor(minPer100m);
      const secs = Math.round((minPer100m - mins) * 60);
      return `${mins}:${secs.toString().padStart(2, '0')} /100m`;
    }

    if (routeType === 'bike') {
      const kmh = distanceKm / (estimatedMinutes / 60);
      return `${kmh.toFixed(1)} km/h`;
    }

    const minPerKm = estimatedMinutes / distanceKm;
    const mins = Math.floor(minPerKm);
    const secs = Math.round((minPerKm - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')} /km`;
  }, []);

  const buildRouteDiagramDataUrlForLeg = useCallback((routeIndex: number) => {
    const loopColors = ['#22c55e', '#f97316', '#0ea5e9', '#a855f7', '#ec4899'];
    
    const gpx = elevationData[routeIndex];
    const routeMeta = mapRoutes[routeIndex];
    if (!gpx?.path?.length || !routeMeta) return null;

    const loops = resolveLoopsForLeg(routeMeta.type) || 1;

    const allPoints = gpx.path;
    const minLat = Math.min(...allPoints.map((p) => p.lat));
    const maxLat = Math.max(...allPoints.map((p) => p.lat));
    const minLng = Math.min(...allPoints.map((p) => p.lng));
    const maxLng = Math.max(...allPoints.map((p) => p.lng));
    const latRange = Math.max(maxLat - minLat, 0.000001);
    const lngRange = Math.max(maxLng - minLng, 0.000001);

    const width = 1800;
    const height = 1000;
    const pad = 70;
    const drawW = width - pad * 2;
    const drawH = height - pad * 2;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#0b1220');
    bg.addColorStop(1, '#111827');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const x = pad + (drawW * i) / 10;
      const y = pad + (drawH * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, pad + drawH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + drawW, y);
      ctx.stroke();
    }

    const project = (pt: { lat: number; lng: number }) => {
      const x = pad + ((pt.lng - minLng) / lngRange) * drawW;
      const y = pad + (1 - (pt.lat - minLat) / latRange) * drawH;
      return { x, y };
    };

    const routeColor = gpx.color || routeMeta.color || '#38bdf8';
    
    if (loops > 1) {
      for (let loopNum = 0; loopNum < loops; loopNum++) {
        const loopColor = loopColors[loopNum % loopColors.length];
        const opacity = 1 - loopNum * 0.15;
        
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 * opacity})`;
        ctx.lineWidth = 9;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        gpx.path.forEach((pt, i) => {
          const p = project(pt);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();

        ctx.strokeStyle = loopColor;
        ctx.lineWidth = 5 - loopNum * 0.3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        gpx.path.forEach((pt, i) => {
          const p = project(pt);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 9;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      gpx.path.forEach((pt, i) => {
        const p = project(pt);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      ctx.strokeStyle = routeColor;
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      gpx.path.forEach((pt, i) => {
        const p = project(pt);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    const sampleEvery = Math.max(20, Math.floor(gpx.path.length / 18));
    ctx.fillStyle = routeColor;
    gpx.path.forEach((pt, idx) => {
      if (idx % sampleEvery !== 0) return;
      const p = project(pt);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    const start = project(gpx.path[0]);
    const end = project(gpx.path[gpx.path.length - 1]);
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(start.x, start.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(end.x, end.y, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText(`${formatLegLabel(routeMeta.type)} Route${loops > 1 ? ` (${loops}x)` : ''}`, pad, 52);
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`${event.eventName} • ${selectedTicket?.ticketName || 'Ticket'}`, pad, 84);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('START', start.x + 14, start.y - 8);
    ctx.fillText('FINISH', end.x + 14, end.y - 8);

    if (loops > 1) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
      ctx.font = 'bold 16px sans-serif';
      for (let i = 0; i < loops; i++) {
        const color = loopColors[i % loopColors.length];
        ctx.fillStyle = color;
        ctx.fillRect(pad + 20 + i * 60, height - 40, 50, 24);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`Loop ${i + 1}`, pad + 27 + i * 60, height - 20);
      }
    }

    return canvas.toDataURL('image/png');
  }, [elevationData, mapRoutes, formatLegLabel, event.eventName, selectedTicket?.ticketName, resolveLoopsForLeg]);

  const buildElevationDiagramDataUrlForLeg = useCallback((routeIndex: number) => {
    const gpx = elevationData[routeIndex];
    if (!gpx?.elevationData?.length) return null;
    const terrainInsights = getElevationInsights(gpx);

    const points = gpx.elevationData;
    const width = 1800;
    const height = 520;
    const padX = 90;
    const padY = 70;
    const drawW = width - padX * 2;
    const drawH = height - padY * 2;

    const minDist = Math.min(...points.map((p) => p.distance));
    const maxDist = Math.max(...points.map((p) => p.distance));
    const minEle = Math.min(...points.map((p) => p.elevation));
    const maxEle = Math.max(...points.map((p) => p.elevation));
    const distRange = Math.max(maxDist - minDist, 0.000001);
    const eleRange = Math.max(maxEle - minEle, 0.000001);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#111827');
    bg.addColorStop(1, '#0f172a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.24)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padY + (drawH * i) / 5;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(padX + drawW, y);
      ctx.stroke();
    }

    const project = (p: { distance: number; elevation: number }) => {
      const x = padX + ((p.distance - minDist) / distRange) * drawW;
      const y = padY + (1 - (p.elevation - minEle) / eleRange) * drawH;
      return { x, y };
    };

    const lineColor = terrainInsights?.paceColor || gpx.color || '#f59e0b';

    // Fill area under profile with terrain gradient (red -> route color -> green)
    const areaGradient = ctx.createLinearGradient(0, padY, 0, padY + drawH);
    areaGradient.addColorStop(0, 'rgba(220, 38, 38, 0.35)');
    areaGradient.addColorStop(0.45, `${lineColor}66`);
    areaGradient.addColorStop(1, 'rgba(22, 163, 74, 0.25)');

    ctx.beginPath();
    points.forEach((p, i) => {
      const pt = project(p);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    const last = project(points[points.length - 1]);
    const first = project(points[0]);
    ctx.lineTo(last.x, padY + drawH);
    ctx.lineTo(first.x, padY + drawH);
    ctx.closePath();
    ctx.fillStyle = areaGradient;
    ctx.fill();

    // Outer glow
    ctx.beginPath();
    points.forEach((p, i) => {
      const pt = project(p);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 7;
    ctx.stroke();

    // Colored outline gradient
    const strokeGradient = ctx.createLinearGradient(0, padY, 0, padY + drawH);
    strokeGradient.addColorStop(0, '#dc2626');
    strokeGradient.addColorStop(0.45, lineColor);
    strokeGradient.addColorStop(1, '#16a34a');
    ctx.beginPath();
    points.forEach((p, i) => {
      const pt = project(p);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.strokeStyle = strokeGradient;
    ctx.lineWidth = 3.8;
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('Elevation Profile', padX, 40);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px sans-serif';
    ctx.fillText(`${minEle.toFixed(0)}m`, 18, padY + drawH);
    ctx.fillText(`${maxEle.toFixed(0)}m`, 18, padY + 6);
    ctx.fillText(`${maxDist.toFixed(1)} km`, padX + drawW - 80, height - 18);

    return canvas.toDataURL('image/png');
  }, [elevationData, getElevationInsights]);

  const handleDownloadPdf = useCallback(async (routeIndex: number) => {
    if (!selectedTicket || !mapRoutes.length || !mapRoutes[routeIndex]) {
      toast({ variant: 'destructive', title: 'Error', description: 'Select a course with map data first.' });
      return;
    }

    try {
      setIsGeneratingPdf(true);

      const route = mapRoutes[routeIndex];
      const legName = formatLegLabel(route.type);
      const distanceKm = resolveDistanceForLeg(route, routeIndex);
      const loops = resolveLoopsForLeg(route.type);
      const stats = route.type === 'swim' ? null : getElevationStats(elevationData[routeIndex]);
      const insights = route.type === 'swim' ? null : getElevationInsights(elevationData[routeIndex]);
      const estimatedMinutes = estimateLegDurationMinutes(route.type, distanceKm, insights);
      const estimatedDurationLabel = formatDuration(estimatedMinutes);
      const estimatedPaceLabel = getEstimatedPaceLabel(route.type, distanceKm, estimatedMinutes);

      let mapImageDataUrl: string | null = null;

      // Wait for Leaflet GPX load and render
      let retries = 0;
      while (!isLeafletMapReady && retries < 10) {
        await new Promise(resolve => setTimeout(resolve, 200));
        retries++;
      }

      await new Promise(resolve => setTimeout(resolve, 700));

      // Try Leaflet/OpenStreetMap capture for all legs (including swim)
      if (leafletMapCaptureRef.current) {
        // Capture the actual leaflet surface, not just wrapper
        const leafletSurface = leafletMapCaptureRef.current.querySelector('.leaflet-container') as HTMLElement | null;
        try {
          mapImageDataUrl = await toPng(leafletSurface || leafletMapCaptureRef.current, {
            cacheBust: true,
            pixelRatio: 1.5,
          });

          // Guard against invalid/empty captures
          if (!mapImageDataUrl || mapImageDataUrl.length < 5000) {
            mapImageDataUrl = null;
          }
        } catch (err) {
          console.warn('Failed to capture Leaflet map for', legName, ':', err);
          mapImageDataUrl = null;
        }
      }

      // If Leaflet capture failed or not available, use canvas fallback
      if (!mapImageDataUrl) {
        mapImageDataUrl = buildRouteDiagramDataUrlForLeg(routeIndex);
      }

      if (!mapImageDataUrl) {
        toast({ variant: 'destructive', title: 'Map unavailable', description: `${legName} map data is not ready yet.` });
        return;
      }

      const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const left = 10;
      const right = pageWidth - 10;

      doc.setFillColor(15, 23, 42);
      doc.roundedRect(left, 8, right - left, 26, 2, 2, 'F');

      doc.setTextColor(248, 250, 252);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(`${legName.toUpperCase()} COURSE MAP`, left + 4, 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(203, 213, 225);
      doc.text(`${event.eventName} • ${selectedTicket.ticketName}`, left + 4, 24);

      // Stats in separate boxes for clean one-line readability
      const statsTop = 38;
      const statsWidth = right - left;
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(left, statsTop, statsWidth, 28, 2, 2, 'F');

      const rowGap = 2;
      const colGap = 2;
      const innerLeft = left + 2;
      const innerRight = right - 2;
      const innerWidth = innerRight - innerLeft;
      const boxH = 11;
      const row1Y = statsTop + 2;
      const row2Y = row1Y + boxH + rowGap;

      const row1BoxW = (innerWidth - colGap * 3) / 4;
      const row2BoxW = (innerWidth - colGap) / 2;

      const drawStatBox = (x: number, y: number, w: number, label: string, value: string) => {
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(x, y, w, boxH, 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.2);
        doc.setTextColor(71, 85, 105);
        doc.text(label, x + 2, y + 4);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.2);
        doc.setTextColor(15, 23, 42);
        doc.text(value, x + 2, y + 8.7);
      };

      drawStatBox(innerLeft + (row1BoxW + colGap) * 0, row1Y, row1BoxW, 'Distance', typeof distanceKm === 'number' ? `${distanceKm.toFixed(2)} km` : 'N/A');
      drawStatBox(innerLeft + (row1BoxW + colGap) * 1, row1Y, row1BoxW, 'Loops', typeof loops === 'number' && loops > 0 ? loops.toString() : 'N/A');
      drawStatBox(innerLeft + (row1BoxW + colGap) * 2, row1Y, row1BoxW, 'Gain', stats ? `${stats.gain.toFixed(0)} m` : 'N/A');
      drawStatBox(innerLeft + (row1BoxW + colGap) * 3, row1Y, row1BoxW, 'Loss', stats ? `${stats.loss.toFixed(0)} m` : 'N/A');

      drawStatBox(innerLeft, row2Y, row2BoxW, 'Avg Time', estimatedDurationLabel);
      drawStatBox(innerLeft + row2BoxW + colGap, row2Y, row2BoxW, 'Avg Pace', estimatedPaceLabel);

      const mapTop = 71;
      // Keep room for elevation block on page 1
      const maxMapHeightForElevation = Math.max(52, 196 - mapTop);
      const mapHeight = Math.min(96, maxMapHeightForElevation);
      doc.addImage(mapImageDataUrl, 'PNG', left, mapTop, right - left, mapHeight);

      const elevationImageDataUrl = route.type === 'swim' ? null : buildElevationDiagramDataUrlForLeg(routeIndex);

      if (elevationImageDataUrl) {
        const elevationTop = mapTop + mapHeight + 6;
        const maxElevationHeight = Math.max(40, 242 - elevationTop);
        const elevationHeight = Math.min(70, maxElevationHeight);
        doc.addImage(elevationImageDataUrl, 'PNG', left, elevationTop, right - left, elevationHeight);
      }

      if (insights) {
        const hexToRgb = (hex: string) => {
          const safe = hex.replace('#', '');
          if (safe.length !== 6) return [15, 23, 42] as const;
          const r = Number.parseInt(safe.slice(0, 2), 16);
          const g = Number.parseInt(safe.slice(2, 4), 16);
          const b = Number.parseInt(safe.slice(4, 6), 16);
          return [r, g, b] as const;
        };

        doc.setFillColor(248, 250, 252);
        doc.roundedRect(left, 246, right - left, 32, 2, 2, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(15, 23, 42);
        doc.text('Elevation meaning', left + 3, 252.5);

        const gradeColor = hexToRgb(insights.gradeColor);
        const paceColor = hexToRgb(insights.paceColor);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.6);
        doc.setTextColor(71, 85, 105);
        doc.text('Grade:', left + 3, 258.5);
        doc.setTextColor(gradeColor[0], gradeColor[1], gradeColor[2]);
        doc.setFont('helvetica', 'bold');
        doc.text(`${insights.gradeLabel} (${insights.avgGradePercent.toFixed(2)}%)`, left + 17, 258.5);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text('Speed impact:', left + 3, 264.5);
        doc.setTextColor(paceColor[0], paceColor[1], paceColor[2]);
        doc.setFont('helvetica', 'bold');
        doc.text(insights.paceLabel, left + 24, 264.5);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text('Red: tough climbing  •  Blue/Orange: rolling/medium  •  Green: flatter & faster', left + 3, 271.5);
        doc.text(`P90 slope ${insights.p90Slope.toFixed(1)}%  •  gain ${insights.gain.toFixed(0)}m  •  loss ${insights.loss.toFixed(0)}m`, left + 3, 276.2);
      }

      doc.setTextColor(100, 116, 139);
      doc.setFontSize(8.5);
      doc.text('Bergman Athlete Hub • Sport Dynamic Layout', left, 286);

      const safeEvent = event.eventName.replace(/[^a-z0-9]+/gi, '_');
      const safeTicket = selectedTicket.ticketName.replace(/[^a-z0-9]+/gi, '_');
      const safeLeg = legName.replace(/[^a-z0-9]+/gi, '_');
      doc.save(`${safeEvent}_${safeTicket}_${safeLeg}_course_map.pdf`);

      toast({ title: 'PDF Downloaded', description: `${legName} course map PDF generated successfully.` });
    } catch (error) {
      console.error('Failed to generate course map PDF:', error);
      toast({
        variant: 'destructive',
        title: 'PDF generation failed',
        description: 'Could not generate course map PDF. Please try again.',
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [selectedTicket, mapRoutes, toast, event.eventName, formatLegLabel, resolveDistanceForLeg, resolveLoopsForLeg, getElevationStats, getElevationInsights, estimateLegDurationMinutes, formatDuration, getEstimatedPaceLabel, elevationData, buildRouteDiagramDataUrlForLeg, buildElevationDiagramDataUrlForLeg, isLeafletMapReady]);

  const handleDownloadGpx = (url: string | null | undefined, leg: string) => {
    if (!url) {
      toast({ variant: 'destructive', title: 'Error', description: 'No GPX file available.' });
      return;
    }
    const downloadUrl = `/api/proxy-gpx?url=${encodeURIComponent(url)}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', `${event.eventName}_${selectedTicket?.ticketName}_${leg}.gpx`.replace(/ /g, '_'));
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl w-full h-[90vh] flex flex-col p-0 text-left">
        <DialogHeader className="p-6 pb-4 border-b flex-shrink-0 text-left">
            <DialogTitle className="text-2xl font-bold flex items-center gap-2 text-left">
                <MapIcon className="h-6 w-6 text-primary"/> Course Maps: {event.eventName}
            </DialogTitle>
            <DialogDescription className="text-left">
                Select a ticket category to view its course map, elevation profile, and specific leg descriptions.
            </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1">
            <div className="grid md:grid-cols-2 p-6 gap-8 text-left">
                {/* Left Column */}
                <div className="space-y-6 flex flex-col text-left">
                    <div className="space-y-2 text-left">
                        <h4 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground text-left">Select a Category</h4>
                        <Select
                            value={selectedTicket?.id || ''}
                            onValueChange={(ticketId) => {
                            const newTicket = ticketsWithMaps.find(t => t.id === ticketId);
                            setSelectedTicket(newTicket || null);
                            }}
                        >
                            <SelectTrigger className="w-full h-11 text-base font-bold text-left">
                            <SelectValue placeholder="Select a ticket category..." />
                            </SelectTrigger>
                            <SelectContent className="text-left">
                            {ticketsWithMaps.map(ticket => (
                                <SelectItem key={ticket.id} value={ticket.id}>{ticket.ticketName}</SelectItem>
                            ))}
                            </SelectContent>
                        </Select>
                    </div>
                    
                    {selectedTicket && (
                        <div className="space-y-6 animate-in fade-in duration-500 text-left">
                            {mapRoutes.map((route, i) => (
                                (() => {
                                  const routePath = elevationData[i];
                                  const routeDistanceKm = resolveDistanceForLeg(route, i);
                                  const routeInsights = route.type === 'swim' ? null : getElevationInsights(routePath);
                                  const routeEstimatedMinutes = estimateLegDurationMinutes(route.type, routeDistanceKm, routeInsights);
                                  const routeEstimatedPace = getEstimatedPaceLabel(route.type, routeDistanceKm, routeEstimatedMinutes);

                                  return (
                                <div
                                  key={i}
                                  className={`p-4 rounded-xl border bg-muted/20 relative overflow-hidden group text-left cursor-pointer transition-all ${selectedLegIndex === i ? 'ring-2 ring-primary border-primary/50 bg-primary/5' : ''}`}
                                  onClick={() => setSelectedLegIndex(i)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setSelectedLegIndex(i);
                                    }
                                  }}
                                >
                                    <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: route.color }} />
                                    <div className="flex items-center justify-start gap-3 mb-2 text-left">
                                        <route.icon className="h-5 w-5" style={{ color: route.color }} />
                                        <h5 className="font-bold uppercase tracking-tight text-sm text-left">{route.type} Leg</h5>
                                        {selectedLegIndex === i && <Badge className="ml-auto">Selected</Badge>}
                                    </div>
                                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line text-left">
                                        {route.description || `Follow the marked ${route.type} route. Ensure you are familiar with the course before race day.`}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground mt-2">
                                      Avg athlete time: <span className="font-bold text-foreground">{formatDuration(routeEstimatedMinutes)}</span>
                                    </p>
                                    <p className="text-[11px] text-muted-foreground mt-1">
                                      Avg pace: <span className="font-bold text-foreground">{routeEstimatedPace}</span>
                                    </p>
                                    <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="mt-3 h-8 text-[10px] font-black uppercase tracking-widest px-0 hover:bg-transparent hover:text-primary text-left"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDownloadGpx(route.url, route.type);
                                        }}
                                    >
                                        <Download className="mr-1.5 h-3 w-3" /> Download GPX
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="mt-1 h-8 text-[10px] font-black uppercase tracking-widest px-0 hover:bg-transparent hover:text-primary text-left"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedLegIndex(i);
                                        // Wait for state update and re-render before generating PDF
                                        setTimeout(() => handleDownloadPdf(i), 50);
                                      }}
                                      disabled={isGeneratingPdf}
                                    >
                                      {isGeneratingPdf ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <FileDown className="mr-1.5 h-3 w-3" />} Download PDF
                                    </Button>
                                </div>
                                  );
                                })()
                            ))}
                        </div>
                    )}
                </div>

                {/* Right Column */}
                <div className="space-y-4 text-left">
                    {selectedTicket ? (
                    <>
                        <div ref={mapCaptureRef} className="rounded-2xl overflow-hidden border shadow-xl bg-background text-left">
                          <MapViewer
                            routes={mapRoutes}
                            trackedAthletes={[]}
                            focusedAthlete={null}
                            showKmMarkers={!selectedRoute || !['bike', 'run', 'run1', 'run2'].includes(selectedRoute.type)}
                            visibleRouteIndices={selectedRoute ? [selectedLegIndex] : undefined}
                            onGpxDataLoaded={onGpxDataLoaded}
                            containerStyle={{ height: '400px', width: '100%' }}
                          />
                        </div>
                        <div className="grid grid-cols-1 gap-6 text-left">
                        {(() => {
                          if (!selectedRoute) return null;
                          const selectedPath = elevationData[selectedLegIndex];
                          const selectedDistanceKm = resolveDistanceForLeg(selectedRoute, selectedLegIndex);
                          const selectedInsights = selectedRoute.type === 'swim' ? null : getElevationInsights(selectedPath);
                          const selectedEstimatedMinutes = estimateLegDurationMinutes(selectedRoute.type, selectedDistanceKm, selectedInsights);
                          const selectedEstimatedPace = getEstimatedPaceLabel(selectedRoute.type, selectedDistanceKm, selectedEstimatedMinutes);

                          return (
                            <div className="p-4 border rounded-xl bg-background shadow-sm text-left">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Average athlete expected time</p>
                              <p className="text-lg font-extrabold tracking-tight text-primary mt-1">{formatDuration(selectedEstimatedMinutes)}</p>
                              <p className="text-[11px] text-muted-foreground mt-1">
                                Avg pace: <span className="font-bold text-foreground">{selectedEstimatedPace}</span>
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-1">
                                Based on distance and terrain toughness for this leg.
                              </p>
                            </div>
                          );
                        })()}

                        {selectedRoute?.type === 'swim' ? (
                          <div className="p-4 border rounded-xl bg-background shadow-sm text-left">
                            <p className="text-sm text-muted-foreground">No elevation profile for swim leg.</p>
                          </div>
                        ) : (
                          (() => {
                            const selectedPath = elevationData[selectedLegIndex];
                            if (!selectedRoute || !selectedPath) {
                              return (
                                <div className="p-4 border rounded-xl bg-background shadow-sm text-left">
                                  <p className="text-sm text-muted-foreground">Loading elevation profile...</p>
                                </div>
                              );
                            }
                            const insights = getElevationInsights(selectedPath);
                            return (
                              <div className="p-4 border rounded-xl bg-background shadow-sm space-y-3 text-left">
                                  <h4 className="font-bold text-center text-xs uppercase tracking-widest text-muted-foreground flex items-center justify-center gap-2 text-left">
                                      {selectedRoute.icon && <selectedRoute.icon className="h-3 w-3" style={{ color: selectedRoute.color }} />}
                                      {selectedRoute.type} Elevation Profile
                                  </h4>

                                  {insights && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                                      <div
                                        className="rounded-lg border p-2"
                                        style={{ backgroundColor: insights.gradeBg, borderColor: insights.gradeBorder }}
                                      >
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                          <Mountain className="h-3 w-3" /> Grade
                                        </p>
                                        <p className="text-xs font-bold" style={{ color: insights.gradeColor }}>{insights.gradeLabel}</p>
                                        <p className="text-[11px] text-muted-foreground">Avg climb {insights.avgGradePercent.toFixed(2)}% • P90 slope {insights.p90Slope.toFixed(1)}%</p>
                                      </div>

                                      <div className="rounded-lg border p-2 bg-slate-50 border-slate-200">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                          <Gauge className="h-3 w-3" /> Speed impact
                                        </p>
                                        <p className="text-xs font-bold" style={{ color: insights.paceColor }}>{insights.paceLabel}</p>
                                        <p className="text-[11px] text-muted-foreground">Gain {insights.gain.toFixed(0)}m • Loss {insights.loss.toFixed(0)}m</p>
                                      </div>
                                    </div>
                                  )}

                                  <ElevationProfileChart data={selectedPath.elevationData} strokeColor={insights?.paceColor || selectedPath.color} height={120} />

                                  <div className="rounded-lg border bg-muted/30 p-2 text-left">
                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                                      <Info className="h-3 w-3" /> What this means
                                    </p>
                                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                                      <span className="font-semibold text-red-600">Red</span>: tough climbing, slower pace expected.{' '}
                                      <span className="font-semibold text-blue-600">Blue/Orange</span>: medium or rolling terrain, controlled pacing helps.{' '}
                                      <span className="font-semibold text-emerald-600">Green</span>: flatter route, better speed potential.
                                    </p>
                                  </div>
                              </div>
                            );
                          })()
                        )}
                        </div>
                    </>
                    ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground border-2 border-dashed rounded-2xl py-20 text-left">
                        <MapIcon className="h-12 w-12 opacity-20 mb-4" />
                        <p className="font-medium text-left">Select a ticket to see the map.</p>
                    </div>
                    )}
                </div>
            </div>
        </ScrollArea>

        {/* Hidden Leaflet map for PDF capture - positioned off-screen instead of display:none */}
        <div 
          ref={leafletMapCaptureRef} 
          style={{ 
            width: '800px', 
            height: '600px', 
            position: 'fixed', 
            top: '0', 
            left: '0',
            opacity: 0,
            pointerEvents: 'none',
            zIndex: -9999
          }}
        >
          {selectedTicket && (
            <MapViewerLeaflet
              routes={mapRoutes}
              trackedAthletes={[]}
              focusedAthlete={null}
              containerStyle={{ height: '600px', width: '800px' }}
              showKmMarkers={!selectedRoute || !['bike', 'run', 'run1', 'run2'].includes(selectedRoute.type)}
              visibleRouteIndices={selectedRoute ? [selectedLegIndex] : undefined}
              onGpxDataLoaded={() => setIsLeafletMapReady(true)}
            />
          )}
        </div>

        <DialogFooter className="p-4 border-t flex-shrink-0 text-left">
            <DialogClose asChild><Button variant="outline" className="rounded-xl font-bold uppercase text-xs text-left">Close Maps</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
