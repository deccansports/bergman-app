"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Eye, Loader2, Monitor, Plus, Radio, RefreshCw, Settings2, StopCircle, Trash2, Copy, KeyRound, RotateCw, MapPin } from 'lucide-react';
import type { EventCalendarEntry } from '@/lib/types';
import type { BroadcastCamera, BroadcastCameraStatus, BroadcastCameraType, BroadcastCourseLocation } from '@/lib/types/broadcast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { authenticatedFetch } from '@/lib/api/authenticatedFetch';
import { CLOUDFLARE_RTMPS_SERVER, getPlaybackUrl } from '@/lib/cloudflare/stream';
import CloudflareHlsPlayer from '@/components/broadcast/CloudflareHlsPlayer';
import VideoLibraryTab from '@/components/admin/VideoLibraryTab';
import { getBroadcastCourseLocations, getDefaultCoverageRadiusForCameraType } from '@/lib/broadcast/courseLocations';

interface BroadcastCenterTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents?: boolean;
  initialEventId?: string;
}

type SessionPayload = {
  summary?: {
    liveCameras: number;
    offlineCameras: number;
    currentViewers: number;
    averageLatency: number;
    recordingEnabledCount: number;
  };
  session?: {
    active?: boolean;
    layout?: 'single' | '2' | '4' | '9' | 'auto';
    selectedCameraIds?: string[];
  } | null;
  settings?: Record<string, any> | null;
};

type CameraHealthPayload = {
  connectionState?: string;
  cameraStatus?: BroadcastCameraStatus;
  message?: string;
  health?: {
    cloudflareStatus?: string;
    liveInputStatus?: string;
    connection?: string;
    signal?: number | null;
    recordingStatus?: string;
    currentViewers?: number;
    peakViewers?: number;
    averageViewers?: number;
    bitrate?: number;
    fps?: number;
    protocol?: string;
    recordingMode?: string;
    duration?: number | null;
    latency?: number;
    lastConnected?: string | null;
    lastDisconnected?: string | null;
    healthScore?: number;
    lastHealthCheck?: string;
  };
  diagnostics?: {
    endpoint?: string;
    httpStatus?: number;
    code?: string;
    message?: string;
    requestId?: string | null;
    cloudflareErrorCode?: number | null;
    cloudflareErrorMessage?: string | null;
  } | null;
  obsTest?: {
    ok?: boolean;
    failedStage?: string | null;
    stages?: Array<{ key: string; label: string; ok: boolean }>;
  };
};

type PlaybackValidationPayload = {
  status?: 'ready' | 'waiting' | 'error' | 'offline';
  statusLabel?: string;
  message?: string;
  playbackSource?: 'Live Input' | 'Recorded Video' | 'Pending';
  livePlayback?: 'Ready' | 'Pending';
  recording?: 'Ready' | 'Pending';
  replay?: 'Ready' | 'Pending';
  playbackUid?: string | null;
  playbackUrl?: string | null;
  recordingVideoUid?: string | null;
  associated?: boolean;
  httpStatus?: number;
};

type ProvisioningPayload = {
  version: string;
  provider: string;
  cameraName: string;
  liveInputUid: string | null;
  rtmpsServer: string;
  encryptedStreamKey: string;
  configurationVersion: string;
  timestamp: string;
};

type RtmpCompatibilityDebug = {
  goproModel?: string;
  server?: string;
  key?: string;
  combinedUrl?: string;
  validation?: {
    valid?: boolean;
    pattern?: string;
    prefix?: string;
    uidSuffix?: string;
    separator?: string;
    streamKeyLength?: number;
    uidLength?: number;
    sha256?: {
      uid?: string;
      streamKey?: string;
      prefix?: string;
      uidSuffix?: string;
    };
    warnings?: string[];
  };
  lengths?: {
    server?: number;
    key?: number;
    combined?: number;
  };
  protocol?: string;
  port?: string;
  fieldModes?: {
    separateFields?: {
      server?: string;
      streamKey?: string;
    };
    singleUrl?: string;
  };
};

type HealthCheckMode = 'manual' | 'background';

type NewCameraForm = {
  name: string;
  cameraType: BroadcastCameraType;
  recordingEnabled: boolean;
  assignedLocation: string;
  courseLocationId: string;
  locationMode: 'fixed' | 'mobile';
  latitude: string;
  longitude: string;
  coverageRadius: string;
  priority: string;
  playbackDelay: string;
  overlayTheme: string;
  recordingQuality: string;
};

const DEFAULT_NEW_CAMERA: NewCameraForm = {
  name: '',
  cameraType: 'custom',
  recordingEnabled: true,
  assignedLocation: '',
  courseLocationId: '',
  locationMode: 'fixed',
  latitude: '',
  longitude: '',
  coverageRadius: '',
  priority: '0',
  playbackDelay: '',
  overlayTheme: 'classic',
  recordingQuality: '1080p',
};

const statusTone: Record<BroadcastCameraStatus, string> = {
  offline: 'bg-slate-600 text-white',
  waiting_for_stream: 'bg-blue-600 text-white',
  connecting: 'bg-amber-500 text-black',
  live: 'bg-emerald-500 text-white',
  stopping: 'bg-orange-600 text-white',
  archived: 'bg-indigo-600 text-white',
  authentication_failed: 'bg-red-700 text-white',
  invalid_stream_key: 'bg-red-600 text-white',
  connection_timed_out: 'bg-orange-600 text-white',
  signal_lost: 'bg-yellow-600 text-black',
  recording: 'bg-violet-600 text-white',
  error: 'bg-rose-700 text-white',
  disabled: 'bg-zinc-500 text-white',
};

function formatStatus(status: BroadcastCameraStatus) {
  if (status === 'stopping') return 'Stopping';
  if (status === 'archived') return 'Archived';
  if (status === 'waiting_for_stream') return 'Waiting for Stream';
  if (status === 'authentication_failed') return 'Authentication Failed';
  if (status === 'invalid_stream_key') return 'Invalid Stream Key';
  if (status === 'connection_timed_out') return 'Connection Timed Out';
  if (status === 'signal_lost') return 'Signal Lost';
  if (status === 'recording') return 'Recording';
  if (status === 'error') return 'Error';
  if (status === 'live') return 'Live';
  if (status === 'offline') return 'Offline';
  if (status === 'connecting') return 'Connecting';
  return 'Disabled';
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function maskStreamKey(value: string) {
  const text = String(value || '').trim();
  if (!text) return '••••••••••••';
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}••••••${text.slice(-4)}`;
}

function formatCompactUid(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return 'Pending';
  if (text.length <= 12) return text;
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function formatRecordingMode(value?: string | null) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 'Off';
  return text.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatPlaybackSource(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return 'Pending';
  return text;
}

function getDashboardPollIntervalMs(cameras: BroadcastCamera[]) {
  if (!Array.isArray(cameras) || cameras.length === 0) return 5000;
  if (cameras.some((camera) => camera.status === 'connecting')) return 2000;
  if (cameras.some((camera) => camera.status === 'waiting_for_stream')) return 5000;
  if (cameras.some((camera) => camera.status === 'live' || camera.status === 'recording')) return 10000;
  if (cameras.every((camera) => camera.status === 'archived')) return 0;
  return 10000;
}

function getCameraHealthPollIntervalMs(status?: BroadcastCameraStatus | null) {
  if (!status) return 5000;
  if (status === 'archived') return 0;
  if (status === 'connecting') return 2000;
  if (status === 'waiting_for_stream') return 5000;
  if (status === 'live' || status === 'recording') return 10000;
  return 10000;
}

function resolveCameraRtmpsServer(camera: BroadcastCamera | null) {
  const raw = String(camera?.cloudflare?.rtmpsUrl || '').trim();
  if (!raw) return CLOUDFLARE_RTMPS_SERVER;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'rtmps:') return CLOUDFLARE_RTMPS_SERVER;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    const basePath = parsed.pathname || '/live/';
    const pathname = basePath.endsWith('/') ? basePath : `${basePath}/`;
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return raw;
  }
}

function buildGoProRtmpUrl(server: string, key: string) {
  const s = String(server || '').trim();
  const k = String(key || '').trim();
  if (!s || !k) return '';
  const normalizedServer = s.endsWith('/') ? s : `${s}/`;
  return `${normalizedServer}${k}`;
}

function getPreviewSrc(camera: BroadcastCamera) {
  const liveInputUid = String(camera?.cloudflare?.liveInputUid || '').trim();
  const playbackUid = String(camera?.cloudflare?.playbackUid || '').trim();
  const uid = playbackUid || liveInputUid;
  return uid ? getPlaybackUrl(uid) : '';
}

function needsRuntimeRefresh(camera: BroadcastCamera) {
  if (!(camera.status === 'live' || camera.status === 'recording')) return false;
  if (!camera.lastHealthCheckAt) return true;
  if (!Number.isFinite(Number(camera.latency)) || Number(camera.latency) <= 0) return true;
  if (camera.signal === null || camera.signal === undefined) return true;
  if (!camera.cloudflare?.playbackUrl && !camera.cloudflare?.webRTCPlaybackUrl && !camera.cloudflare?.rtmpsPlaybackUrl && !camera.cloudflare?.playbackUid) return true;
  const last = new Date(camera.lastHealthCheckAt).getTime();
  if (!Number.isFinite(last)) return true;
  return Date.now() - last > 15000;
}

export default function BroadcastCenterTab({ events, isLoadingEvents = false, initialEventId }: BroadcastCenterTabProps) {
  const { toast } = useToast();
  const { firebaseUserFromAuth } = useAuth();
  const [selectedEventId, setSelectedEventId] = useState(initialEventId || events[0]?.id || '');
  const [cameras, setCameras] = useState<BroadcastCamera[]>([]);
  const [courseLocations, setCourseLocations] = useState<BroadcastCourseLocation[]>([]);
  const [session, setSession] = useState<SessionPayload>({});
  const [isLoading, setIsLoading] = useState(false);
  const [layout, setLayout] = useState<'single' | '2' | '4' | '9' | 'auto'>('auto');

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newCamera, setNewCamera] = useState<NewCameraForm>(DEFAULT_NEW_CAMERA);
  const [isSaving, setIsSaving] = useState(false);

  const [activeCamera, setActiveCamera] = useState<BroadcastCamera | null>(null);
  const [revealedKey, setRevealedKey] = useState('');
  const [isLoadingKey, setIsLoadingKey] = useState(false);
  const [revealExpiresAt, setRevealExpiresAt] = useState<number | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [cameraHealth, setCameraHealth] = useState<CameraHealthPayload | null>(null);
  const [isValidatingPlayback, setIsValidatingPlayback] = useState(false);
  const [playbackValidation, setPlaybackValidation] = useState<PlaybackValidationPayload | null>(null);
  const [isLoadingProvisioning, setIsLoadingProvisioning] = useState(false);
  const [provisioningPayload, setProvisioningPayload] = useState<ProvisioningPayload | null>(null);
  const [rtmpDebug, setRtmpDebug] = useState<RtmpCompatibilityDebug | null>(null);

  const fetchAllInFlightRef = useRef<Promise<void> | null>(null);
  const requestInFlightRef = useRef<Map<string, Promise<any>>>(new Map());
  const lastStatusByCameraRef = useRef<Map<string, BroadcastCameraStatus>>(new Map());
  const camerasRef = useRef<BroadcastCamera[]>([]);
  const activeCameraRef = useRef<BroadcastCamera | null>(null);
  const dashboardTimer = useRef<number | null>(null);
  const cameraTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedEventId && events[0]?.id) setSelectedEventId(events[0].id);
  }, [events, selectedEventId]);

  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  useEffect(() => {
    activeCameraRef.current = activeCamera;
  }, [activeCamera]);

  useEffect(() => {
    if (!revealExpiresAt) return;
    const timer = window.setInterval(() => {
      if (!revealExpiresAt) return;
      if (Date.now() >= revealExpiresAt) {
        setRevealedKey('');
        setRevealExpiresAt(null);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [revealExpiresAt]);

  useEffect(() => {
    if (newCamera.cameraType !== 'custom' && newCamera.locationMode !== 'mobile' && !newCamera.courseLocationId && courseLocations[0]?.id) {
      setNewCamera((s) => ({ ...s, courseLocationId: courseLocations[0].id, assignedLocation: courseLocations[0].name }));
    }
  }, [courseLocations, newCamera.cameraType, newCamera.locationMode, newCamera.courseLocationId]);

  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId) || null, [events, selectedEventId]);

  const requestWithAuth = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!firebaseUserFromAuth) throw new Error('Authentication failed.');
    return authenticatedFetch(input, init, firebaseUserFromAuth);
  }, [firebaseUserFromAuth]);

  const updateCameraLocally = useCallback((cameraId: string, patch: Partial<BroadcastCamera>) => {
    const applyPatch = (camera: BroadcastCamera) => ({
      ...camera,
      ...patch,
      cloudflare: patch.cloudflare
        ? {
            ...(camera.cloudflare || {}),
            ...(patch.cloudflare || {}),
          }
        : camera.cloudflare,
    });

    setCameras((prev) => prev.map((camera) => (camera.cameraId === cameraId ? applyPatch(camera) : camera)));
    setActiveCamera((prev) => (prev && prev.cameraId === cameraId ? applyPatch(prev) : prev));

    if (patch.status) {
      lastStatusByCameraRef.current.set(cameraId, patch.status);
    }
  }, []);

  const runDeduped = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
    const existing = requestInFlightRef.current.get(key);
    if (existing) return existing as Promise<T>;
    const next = fn().finally(() => {
      requestInFlightRef.current.delete(key);
    });
    requestInFlightRef.current.set(key, next);
    return next;
  }, []);

  const notifyStatusTransition = useCallback((camera: BroadcastCamera, nextStatus: BroadcastCameraStatus, mode: HealthCheckMode) => {
    const previous = lastStatusByCameraRef.current.get(camera.cameraId);
    lastStatusByCameraRef.current.set(camera.cameraId, nextStatus);
    if (mode !== 'manual') return;
    if (!previous || previous === nextStatus) return;

    if (nextStatus === 'live' || nextStatus === 'recording') {
      toast({ title: 'Broadcast Started', description: `${camera.name} is now live.` });
      return;
    }
    if (previous === 'waiting_for_stream' && nextStatus === 'connecting') {
      toast({ title: 'Camera Connected', description: `${camera.name} is connecting to Cloudflare.` });
      return;
    }
    if ((previous === 'live' || previous === 'recording') && (nextStatus === 'offline' || nextStatus === 'archived' || nextStatus === 'stopping')) {
      toast({ title: 'Broadcast Ended', description: `${camera.name} stream ended.` });
      return;
    }

    toast({ title: 'Camera Status Updated', description: `${camera.name}: ${formatStatus(previous)} → ${formatStatus(nextStatus)}` });
  }, [toast]);

  const testConnection = useCallback(async (camera: BroadcastCamera, options?: { mode?: HealthCheckMode; action?: 'test_connection' | 'status' }) => {
    const mode = options?.mode || 'manual';
    const action = options?.action || 'test_connection';
    const silent = mode === 'background';
    const requestKey = `broadcast:live-input:${action}:${camera.cameraId}`;
    setIsTestingConnection(true);
    try {
      const res = await runDeduped(requestKey, () => requestWithAuth('/api/broadcast/live-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, cameraId: camera.cameraId }),
      }));
      const data = await res.json().catch(() => null);
      if (!res.ok && !data?.details) throw new Error(data?.error || 'Connection test failed');
      setCameraHealth((data?.data || data?.details || null) as CameraHealthPayload | null);

      const dataPatch = data?.data || {};
      updateCameraLocally(camera.cameraId, {
        status: dataPatch.cameraStatus || camera.status,
        viewerCount: Number(dataPatch.viewerCount ?? camera.viewerCount ?? 0),
        latency: Number(dataPatch.health?.latency ?? camera.latency ?? 0),
        signal: dataPatch.health?.signal ?? camera.signal ?? null,
        healthScore: Number(dataPatch.health?.healthScore ?? camera.healthScore ?? 0),
        lastConnectedAt: dataPatch.health?.lastConnected ?? camera.lastConnectedAt ?? null,
        lastDisconnectedAt: dataPatch.health?.lastDisconnected ?? camera.lastDisconnectedAt ?? null,
        lastHealthCheckAt: dataPatch.health?.lastHealthCheck ?? camera.lastHealthCheckAt ?? null,
        cloudflare: {
          playbackUid: dataPatch.playback?.playbackUid ?? camera.cloudflare?.playbackUid ?? null,
          playbackUrl: dataPatch.playback?.playbackUrl ?? camera.cloudflare?.playbackUrl ?? null,
          playbackIframeUrl: dataPatch.playback?.iframeUrl ?? camera.cloudflare?.playbackIframeUrl ?? null,
          webRTCPlaybackUrl: dataPatch.playback?.playbackUrl ?? camera.cloudflare?.webRTCPlaybackUrl ?? null,
          rtmpsPlaybackUrl: camera.cloudflare?.rtmpsPlaybackUrl ?? null,
          videoUid: dataPatch.playback?.videoUid ?? camera.cloudflare?.videoUid ?? null,
          recordingUid: dataPatch.playback?.recordingUid ?? camera.cloudflare?.recordingUid ?? null,
          thumbnailUrl: dataPatch.playback?.thumbnailUrl ?? camera.cloudflare?.thumbnailUrl ?? null,
          durationSeconds: dataPatch.playback?.durationSeconds ?? camera.cloudflare?.durationSeconds ?? null,
          recordingMode: dataPatch.health?.recordingMode ?? camera.cloudflare?.recordingMode ?? null,
          bitrate: dataPatch.health?.bitrate ?? camera.cloudflare?.bitrate ?? null,
          fps: dataPatch.health?.fps ?? camera.cloudflare?.fps ?? null,
          protocol: dataPatch.health?.protocol ?? camera.cloudflare?.protocol ?? null,
          currentViewers: dataPatch.health?.currentViewers ?? camera.cloudflare?.currentViewers ?? null,
          peakViewers: dataPatch.health?.peakViewers ?? camera.cloudflare?.peakViewers ?? null,
          averageViewers: dataPatch.health?.averageViewers ?? camera.cloudflare?.averageViewers ?? null,
          uptime: dataPatch.health?.duration ?? camera.cloudflare?.uptime ?? null,
        },
      });

      if (data?.data?.cameraStatus) {
        notifyStatusTransition(camera, data.data.cameraStatus as BroadcastCameraStatus, mode);
      }
      if (!silent && !res.ok) {
        toast({ variant: 'destructive', title: 'Connection issue detected', description: data?.error || 'Cloudflare test failed.' });
      } else if (!silent) {
        toast({ title: 'Connection test complete', description: data?.data?.message || 'Cloudflare status refreshed.' });
      }
    } catch (error) {
      if (!silent) {
        toast({ variant: 'destructive', title: 'Connection test failed', description: error instanceof Error ? error.message : 'Unknown error' });
      }
    } finally {
      setIsTestingConnection(false);
    }
  }, [notifyStatusTransition, requestWithAuth, runDeduped, toast, updateCameraLocally]);

  const fetchDashboardCameras = useCallback(async (mode: HealthCheckMode = 'background') => {
    if (!selectedEventId) return;
    if (!firebaseUserFromAuth) return;
    try {
      if (fetchAllInFlightRef.current) {
        await fetchAllInFlightRef.current;
        return;
      }

      fetchAllInFlightRef.current = (async () => {
        const camRes = await runDeduped(`broadcast:cameras:${selectedEventId}`, () => requestWithAuth(`/api/broadcast/cameras?eventId=${encodeURIComponent(selectedEventId)}`, { cache: 'no-store' }));
        const camData = await camRes.json().catch(() => null);

        const nextCameras = Array.isArray(camData?.data?.cameras) ? camData.data.cameras : [];
        setCameras(nextCameras);
        camerasRef.current = nextCameras;
        for (const camera of nextCameras) {
          if (camera?.cameraId && camera?.status) {
            lastStatusByCameraRef.current.set(camera.cameraId, camera.status);
          }
        }

        const refreshTargets = nextCameras.filter((camera: BroadcastCamera) => needsRuntimeRefresh(camera));
        await Promise.all(refreshTargets.map((camera: BroadcastCamera) => testConnection(camera, { mode: 'background', action: 'status' }).catch(() => null)));

        const currentActive = activeCameraRef.current;
        if (currentActive) {
          const latestActive = nextCameras.find((camera: BroadcastCamera) => camera.cameraId === currentActive.cameraId);
          if (latestActive) {
            setActiveCamera((prev) => {
              if (!prev || prev.cameraId !== latestActive.cameraId) return prev;
              const merged = {
                ...prev,
                ...latestActive,
                cloudflare: {
                  ...(prev.cloudflare || {}),
                  ...(latestActive.cloudflare || {}),
                },
              };
              return JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged;
            });
          }
        }

        setCourseLocations(Array.isArray(camData?.data?.courseLocations) ? camData.data.courseLocations : getBroadcastCourseLocations());
      })();

      await fetchAllInFlightRef.current;
    } catch (error: any) {
      if (mode === 'manual') {
        toast({ variant: 'destructive', title: 'Broadcast load failed', description: error?.message || 'Authentication failed.' });
      }
    } finally {
      fetchAllInFlightRef.current = null;
    }
  }, [firebaseUserFromAuth, requestWithAuth, runDeduped, selectedEventId, testConnection, toast]);

  const fetchSessionSnapshot = useCallback(async () => {
    if (!selectedEventId || !firebaseUserFromAuth) return;
    try {
      const sessionRes = await runDeduped(`broadcast:session:${selectedEventId}`, () => requestWithAuth(`/api/broadcast/session?eventId=${encodeURIComponent(selectedEventId)}`, { cache: 'no-store' }));
      const sessionData = await sessionRes.json().catch(() => null);
      setSession(sessionData?.data || {});
      if (sessionData?.data?.session?.layout) setLayout(sessionData.data.session.layout);
    } catch {
      // Session snapshot is non-critical for polling architecture.
    }
  }, [firebaseUserFromAuth, requestWithAuth, runDeduped, selectedEventId]);

  const fetchAll = useCallback(async (mode: HealthCheckMode = 'background') => {
    if (mode === 'manual') setIsLoading(true);
    try {
      await Promise.all([
        fetchDashboardCameras(mode),
        fetchSessionSnapshot(),
      ]);
    } finally {
      if (mode === 'manual') setIsLoading(false);
    }
  }, [fetchDashboardCameras, fetchSessionSnapshot]);

  useEffect(() => {
    void fetchAll('background');
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;

    const clearDashboardTimer = () => {
      if (dashboardTimer.current) {
        window.clearTimeout(dashboardTimer.current);
        dashboardTimer.current = null;
      }
    };

    const scheduleNext = (ms: number) => {
      clearDashboardTimer();
      dashboardTimer.current = window.setTimeout(run, ms);
    };

    const run = async () => {
      if (cancelled) return;
      if (document.hidden) {
        scheduleNext(1000);
        return;
      }

      await fetchDashboardCameras('background');
      if (cancelled) return;

      const nextInterval = getDashboardPollIntervalMs(camerasRef.current);
      if (!nextInterval) {
        clearDashboardTimer();
        return;
      }

      scheduleNext(nextInterval);
    };

    const initialInterval = getDashboardPollIntervalMs(camerasRef.current);
    if (initialInterval) {
      scheduleNext(initialInterval);
    }

    return () => {
      cancelled = true;
      clearDashboardTimer();
    };
  }, [activeCamera?.cameraId, fetchDashboardCameras, firebaseUserFromAuth, selectedEventId]);

  const stats = {
    live: cameras.filter((c) => c.status === 'live' || c.status === 'recording').length,
    offline: cameras.filter((c) => c.status !== 'live' && c.status !== 'recording').length,
    viewers: cameras.reduce((sum, c) => sum + Number(c.viewerCount || 0), 0),
    avgLatency: cameras.length > 0 ? Math.round(cameras.reduce((sum, c) => sum + Number(c.latency || 0), 0) / cameras.length) : 0,
  };

  const healthFallback: NonNullable<CameraHealthPayload['health']> | null = activeCamera ? {
    cloudflareStatus: activeCamera.status || '—',
    liveInputStatus: activeCamera.status === 'live' || activeCamera.status === 'recording' ? 'Live' : formatStatus(activeCamera.status),
    connection: activeCamera.status === 'live' || activeCamera.status === 'recording' ? 'Excellent' : 'Offline',
    signal: Number(activeCamera.signal ?? 0),
    recordingStatus: formatRecordingMode(activeCamera.cloudflare?.recordingMode || 'off'),
    currentViewers: Number(activeCamera.viewerCount || 0),
    peakViewers: Number(activeCamera.viewerCount || 0),
    averageViewers: Number(activeCamera.viewerCount || 0),
    bitrate: Number(activeCamera.cloudflare?.bitrate || 0),
    fps: Number(activeCamera.cloudflare?.fps || 0),
    protocol: String(activeCamera.cloudflare?.protocol || 'RTMP'),
    recordingMode: activeCamera.cloudflare?.recordingMode || 'off',
    duration: Number(activeCamera.cloudflare?.durationSeconds || 0) || null,
    latency: Number(activeCamera.latency || 0),
    lastConnected: activeCamera.lastConnectedAt || null,
    lastDisconnected: activeCamera.lastDisconnectedAt || null,
    healthScore: Number(activeCamera.healthScore || 0),
  } : null;

  const saveSessionLayout = async (nextLayout: 'single' | '2' | '4' | '9' | 'auto') => {
    if (!selectedEventId) return;
    setLayout(nextLayout);
    await requestWithAuth('/api/broadcast/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: selectedEventId,
        action: 'update_session',
        active: true,
        layout: nextLayout,
        selectedCameraIds: cameras.filter((c) => c.status === 'live').map((c) => c.cameraId),
      }),
    }).catch(() => null);
  };

  const handleCreateCamera = async () => {
    if (!selectedEventId || !newCamera.name.trim()) {
      toast({ variant: 'destructive', title: 'Camera name required' });
      return;
    }

    const selectedLocation = courseLocations.find((location) => location.id === newCamera.courseLocationId) || null;
    const requiresManualCoordinates = newCamera.locationMode === 'mobile' || !selectedLocation;
    if (requiresManualCoordinates) {
      if (!String(newCamera.latitude || '').trim() || !String(newCamera.longitude || '').trim() || !String(newCamera.coverageRadius || '').trim()) {
        toast({ variant: 'destructive', title: 'Coordinates required', description: 'Latitude, longitude and coverage radius are required when no course location is selected or when creating a custom/mobile camera.' });
        return;
      }
    }

    setIsSaving(true);
    try {
      const useFixedLocation = newCamera.locationMode === 'fixed' && !!selectedLocation;
      const latitude = useFixedLocation ? selectedLocation?.latitude : (newCamera.latitude ? Number(newCamera.latitude) : null);
      const longitude = useFixedLocation ? selectedLocation?.longitude : (newCamera.longitude ? Number(newCamera.longitude) : null);
      const coverageRadius = useFixedLocation ? (Number(newCamera.coverageRadius || selectedLocation?.coverageRadius || getDefaultCoverageRadiusForCameraType(newCamera.cameraType)) || null) : (newCamera.coverageRadius ? Number(newCamera.coverageRadius) : null);

      const res = await requestWithAuth('/api/broadcast/cameras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: selectedEventId,
          provider: 'cloudflare',
          name: newCamera.name.trim(),
          cameraType: newCamera.cameraType,
          locationMode: newCamera.locationMode,
          courseLocationId: newCamera.courseLocationId || null,
          assignedLocation: selectedLocation?.name || newCamera.assignedLocation.trim() || null,
          latitude,
          longitude,
          coverageRadius,
          priority: Number(newCamera.priority || 0),
          playbackDelay: newCamera.playbackDelay ? Number(newCamera.playbackDelay) : null,
          overlayTheme: newCamera.overlayTheme || null,
          recordingQuality: newCamera.recordingQuality || null,
          recordingEnabled: newCamera.recordingEnabled,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error?.message || 'Failed to create camera');

      toast({ title: 'Camera created', description: 'Live input generated in Cloudflare and saved to Firestore.' });
      if (data?.data?.camera?.cameraId) {
        setCameras((prev) => [data.data.camera as BroadcastCamera, ...prev]);
      }
      setNewCamera(DEFAULT_NEW_CAMERA);
      setIsAddOpen(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Create camera failed', description: error?.message || 'Authentication failed.' });
    } finally {
      setIsSaving(false);
    }
  };

  const updateCameraStatus = async (camera: BroadcastCamera, status: BroadcastCameraStatus) => {
    const res = await requestWithAuth('/api/broadcast/cameras', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameraId: camera.cameraId, status }),
    }).catch(() => null);
    if (!res) return;
    updateCameraLocally(camera.cameraId, { status });
  };

  const deleteCamera = async (camera: BroadcastCamera) => {
    if (!confirm(`Delete camera ${camera.name}?`)) return;
    const res = await requestWithAuth(`/api/broadcast/cameras?cameraId=${encodeURIComponent(camera.cameraId)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      toast({ variant: 'destructive', title: 'Delete failed', description: data?.error?.message || 'Unknown error' });
      return;
    }
    toast({ title: 'Camera deleted', description: 'Cloudflare live input removed too.' });
    if (activeCamera?.cameraId === camera.cameraId) {
      setActiveCamera(null);
      setRevealedKey('');
    }
    setCameras((prev) => prev.filter((item) => item.cameraId !== camera.cameraId));
  };

  const deleteRecordingVideo = async (camera: BroadcastCamera) => {
    const videoUid = String(playbackValidation?.recordingVideoUid || camera.cloudflare?.videoUid || camera.cloudflare?.recordingUid || '').trim();
    if (!videoUid) {
      toast({ variant: 'destructive', title: 'No Cloudflare video found', description: 'This camera does not currently have a recording to delete.' });
      return;
    }

    if (!confirm(`Delete Cloudflare recording ${formatCompactUid(videoUid)}? This cannot be undone.`)) return;

    try {
      const res = await requestWithAuth('/api/broadcast/videos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUid,
          cameraId: camera.cameraId,
          eventId: camera.eventId || selectedEventId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error?.message || 'Unable to delete Cloudflare video');
      }

      toast({ title: 'Cloudflare video deleted', description: `Removed ${formatCompactUid(videoUid)} from Stream.` });
      updateCameraLocally(camera.cameraId, {
        cloudflare: {
          ...(camera.cloudflare || {}),
          videoUid: null,
          recordingUid: null,
          playbackUid: camera.cloudflare?.playbackUid === videoUid ? null : camera.cloudflare?.playbackUid ?? null,
          playbackUrl: camera.cloudflare?.playbackUid === videoUid ? null : camera.cloudflare?.playbackUrl ?? null,
        },
      });

      if (activeCamera?.cameraId === camera.cameraId) {
        setPlaybackValidation((current) => current ? { ...current, recordingVideoUid: null, recording: 'Pending', replay: 'Pending' } : current);
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Delete recording failed', description: error instanceof Error ? error.message : 'Unknown error' });
    }
  };

  const revealKey = async (camera: BroadcastCamera) => {
    const approved = confirm('Reveal stream key for 30 seconds? This value is sensitive.');
    if (!approved) return;

    setIsLoadingKey(true);
    try {
      const res = await requestWithAuth('/api/broadcast/live-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reveal_key', cameraId: camera.cameraId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Could not reveal key');
      const streamKey = String(data?.data?.streamKey || '');
      const expiresInSeconds = Number(data?.data?.expiresInSeconds || 30) || 30;
      setRevealedKey(streamKey);
      setRevealExpiresAt(Date.now() + expiresInSeconds * 1000);
      setRtmpDebug((data?.data?.debug || null) as RtmpCompatibilityDebug | null);
      toast({ title: 'Stream key revealed', description: `Visible for ${expiresInSeconds} seconds.` });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Reveal key failed', description: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsLoadingKey(false);
    }
  };

  const validatePlayback = useCallback(async (camera: BroadcastCamera, options?: { mode?: HealthCheckMode }) => {
    const mode = options?.mode || 'manual';
    const silent = mode === 'background';
    const requestKey = `broadcast:live-input:playback:${camera.cameraId}`;
    setIsValidatingPlayback(true);
    try {
      const res = await runDeduped(requestKey, () => requestWithAuth('/api/broadcast/live-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate_playback', cameraId: camera.cameraId }),
      }));
      const data = await res.json().catch(() => null);
      if (!data?.success) throw new Error(data?.error || 'Playback validation failed');
      setPlaybackValidation((data?.data || null) as PlaybackValidationPayload | null);
      if (!silent) {
        toast({ title: 'Playback validation complete', description: data?.data?.statusLabel || 'Validation complete.' });
      }
    } catch (error) {
      if (!silent) {
        toast({ variant: 'destructive', title: 'Playback validation failed', description: error instanceof Error ? error.message : 'Unknown error' });
      }
    } finally {
      setIsValidatingPlayback(false);
    }
  }, [requestWithAuth, runDeduped, toast]);

  const loadProvisioningPayload = useCallback(async (camera: BroadcastCamera) => {
    setIsLoadingProvisioning(true);
    try {
      const res = await requestWithAuth('/api/broadcast/live-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'provisioning_payload', cameraId: camera.cameraId }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) throw new Error(data?.error || 'Failed to build provisioning payload');
      setProvisioningPayload((data?.data?.payload || null) as ProvisioningPayload | null);
    } catch (error) {
      setProvisioningPayload(null);
      toast({ variant: 'destructive', title: 'Provisioning payload failed', description: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsLoadingProvisioning(false);
    }
  }, [requestWithAuth, toast]);

  const rotateKey = async (camera: BroadcastCamera) => {
    setIsLoadingKey(true);
    try {
      const res = await requestWithAuth('/api/broadcast/live-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate_key', cameraId: camera.cameraId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Could not rotate key');
      setRevealedKey('');
      setRevealExpiresAt(null);
      setRtmpDebug(null);
      toast({ title: 'Stream key rotated', description: 'Cloudflare live input regenerated.' });
      updateCameraLocally(camera.cameraId, {
        status: 'waiting_for_stream',
        cloudflare: {
          liveInputUid: String(data?.data?.liveInputUid || ''),
          rtmpsUrl: String(data?.data?.rtmpsServer || camera.cloudflare?.rtmpsUrl || ''),
          playbackUid: null,
          playbackUrl: null,
          webRTCPlaybackUrl: camera.cloudflare?.webRTCPlaybackUrl ?? null,
          rtmpsPlaybackUrl: camera.cloudflare?.rtmpsPlaybackUrl ?? null,
          videoUid: null,
          recordingUid: null,
          thumbnailUrl: null,
          durationSeconds: null,
        },
      });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Rotate key failed', description: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsLoadingKey(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({ variant: 'destructive', title: `Failed to copy ${label}` });
    }
  };

  const qrPayload = useMemo(() => {
    if (!provisioningPayload) return '';
    return JSON.stringify(provisioningPayload);
  }, [provisioningPayload]);

  const activeRtmpsServer = useMemo(() => resolveCameraRtmpsServer(activeCamera), [activeCamera]);
  const activeGoProRtmpUrl = useMemo(() => buildGoProRtmpUrl(activeRtmpsServer, revealedKey), [activeRtmpsServer, revealedKey]);
  const publicLiveUrl = useMemo(() => {
    if (!selectedEvent) return '';
    const slug = String(selectedEvent.customSlug || selectedEvent.id || '').trim();
    return slug ? `/live/${encodeURIComponent(slug)}` : '';
  }, [selectedEvent]);
  const activeRtmpDebug = useMemo(() => {
    const server = rtmpDebug?.server || activeRtmpsServer;
    const key = rtmpDebug?.key || revealedKey;
    const combinedUrl = rtmpDebug?.combinedUrl || activeGoProRtmpUrl;
    return {
      goproModel: rtmpDebug?.goproModel || (String((activeCamera as any)?.customMetadata?.goproModel || activeCamera?.cameraType || 'unknown').trim() || 'unknown'),
      server,
      key,
      combinedUrl,
      protocol: rtmpDebug?.protocol || 'rtmps',
      port: rtmpDebug?.port || '443',
      lengths: {
        server: rtmpDebug?.lengths?.server ?? server.length,
        key: rtmpDebug?.lengths?.key ?? key.length,
        combined: rtmpDebug?.lengths?.combined ?? combinedUrl.length,
      },
      validation: rtmpDebug?.validation || null,
      fieldModes: rtmpDebug?.fieldModes || {
        separateFields: { server, streamKey: key },
        singleUrl: combinedUrl,
      },
    };
  }, [activeCamera, activeGoProRtmpUrl, activeRtmpsServer, revealedKey, rtmpDebug]);

  useEffect(() => {
    if (!activeCamera) return;
    void loadProvisioningPayload(activeCamera);
    void validatePlayback(activeCamera, { mode: 'background' });
  }, [activeCamera, loadProvisioningPayload, validatePlayback]);

  useEffect(() => {
    let cancelled = false;

    const clearCameraTimer = () => {
      if (cameraTimer.current) {
        window.clearTimeout(cameraTimer.current);
        cameraTimer.current = null;
      }
    };

    const scheduleNext = (ms: number) => {
      clearCameraTimer();
      cameraTimer.current = window.setTimeout(run, ms);
    };

    const run = async () => {
      if (cancelled) return;
      const current = activeCameraRef.current;
      if (!current) {
        clearCameraTimer();
        return;
      }

      if (document.hidden) {
        scheduleNext(1000);
        return;
      }

      await testConnection(current, { mode: 'background', action: 'status' });
      if (cancelled) return;
      scheduleNext(10000);
    };

    if (activeCameraRef.current && selectedEventId && firebaseUserFromAuth) {
      scheduleNext(10000);
    }

    return () => {
      cancelled = true;
      clearCameraTimer();
    };
  }, [activeCamera?.cameraId, firebaseUserFromAuth, selectedEventId, testConnection]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-xl">Broadcast</CardTitle>
              <CardDescription>Production-ready Bergman Broadcast Center powered by Cloudflare Stream Live Inputs.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedEventId} onValueChange={setSelectedEventId} disabled={isLoadingEvents}>
                <SelectTrigger className="w-[300px]"><SelectValue placeholder="Select event" /></SelectTrigger>
                <SelectContent>
                  {events.map((event) => (
                    <SelectItem key={event.id} value={event.id}>{event.eventName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => void fetchAll('manual')} disabled={isLoading}><RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />Refresh</Button>
              <Button onClick={() => setIsAddOpen(true)} disabled={!selectedEventId}><Plus className="mr-2 h-4 w-4" />Add Camera</Button>
              {selectedEventId ? (
                <Button asChild variant="secondary">
                  <Link href={`/admin/events/${encodeURIComponent(selectedEventId)}/broadcast`}>Event → Broadcast</Link>
                </Button>
              ) : null}
              {publicLiveUrl ? (
                <Button asChild variant="outline">
                  <Link href={publicLiveUrl} target="_blank" rel="noreferrer">Open Public Live</Link>
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Event</div><div className="font-semibold line-clamp-2">{selectedEvent?.eventName || '—'}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Live Cameras</div><div className="text-xl font-semibold">{stats.live}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Non-Live States</div><div className="text-xl font-semibold">{stats.offline}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Current Viewers</div><div className="text-xl font-semibold">{stats.viewers}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Avg Latency</div><div className="text-xl font-semibold">{stats.avgLatency} ms</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Event Status</div><div className="font-semibold">{session?.session?.active ? 'Live' : 'Standby'}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Multi View</CardTitle>
          <CardDescription>Switch between preview layouts for production operations.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[
            { id: 'single', label: 'Single View' },
            { id: '2', label: '2 Cameras' },
            { id: '4', label: '4 Cameras' },
            { id: '9', label: '9 Cameras' },
            { id: 'auto', label: 'Auto' },
          ].map((item) => (
            <Button key={item.id} variant={layout === item.id ? 'default' : 'outline'} onClick={() => void saveSessionLayout(item.id as any)}>
              <Monitor className="mr-2 h-4 w-4" />{item.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Video Library</CardTitle>
          <CardDescription>Cloudflare Stream recordings and library management are available here only.</CardDescription>
        </CardHeader>
        <CardContent>
          <VideoLibraryTab />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cameras.map((camera) => (
          <Card key={camera.cameraId} className="rounded-2xl">
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{camera.name}</CardTitle>
                <Badge className={statusTone[camera.status]}>{formatStatus(camera.status)}</Badge>
              </div>
              <CardDescription className="flex items-center gap-2 text-xs">
                <Camera className="h-3.5 w-3.5" /> {camera.cameraType.toUpperCase()}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {camera.status === 'live' || camera.status === 'recording' ? (
                getPreviewSrc(camera) ? (
                  <div className="aspect-video overflow-hidden rounded-xl border bg-black">
                    <CloudflareHlsPlayer
                      src={getPreviewSrc(camera)}
                      title={`${camera.name} live preview`}
                      className="h-full w-full object-contain bg-black"
                    />
                  </div>
                ) : (
                  <div className="aspect-video rounded-xl border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">
                    Live stream connected, waiting for playback URL…
                  </div>
                )
              ) : (
              <div className="aspect-video rounded-xl border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">
                {camera.previewThumbnail ? (
                  <Image src={camera.previewThumbnail} alt={camera.name} width={640} height={360} unoptimized className="h-full w-full rounded-xl object-cover" />
                ) : (
                  'Preview Thumbnail'
                )}
              </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border p-2"><div className="text-muted-foreground">Signal</div><div className="font-medium">{Number(camera.signal || 0)}%</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground">Recording</div><div className="font-medium">{camera.recordingEnabled ? 'Enabled' : 'Disabled'}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground">Latency</div><div className="font-medium">{Number(camera.latency || 0)} ms</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground">Viewers</div><div className="font-medium">{Number(camera.viewerCount || 0)}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground">Battery</div><div className="font-medium">{camera.battery ?? '—'}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground">Location</div><div className="font-medium line-clamp-1">{camera.assignedLocation || '—'}</div></div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setActiveCamera(camera)}><Eye className="mr-2 h-4 w-4" />Preview</Button>
                <Button size="sm" variant="outline" onClick={() => setActiveCamera(camera)}><Settings2 className="mr-2 h-4 w-4" />Settings</Button>
                <Button size="sm" variant="outline" onClick={() => void updateCameraStatus(camera, 'live')}><Radio className="mr-2 h-4 w-4" />Start</Button>
                <Button size="sm" variant="outline" onClick={() => void updateCameraStatus(camera, 'offline')}><StopCircle className="mr-2 h-4 w-4" />Stop</Button>
                <Button size="sm" variant="destructive" onClick={() => void deleteCamera(camera)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Camera</DialogTitle>
            <DialogDescription>Create a Cloudflare Live Input and attach it to a predefined course location or mobile camera.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 md:col-span-2">
              <div>
                <Label>Camera Name</Label>
                <Input value={newCamera.name} onChange={(e) => setNewCamera((s) => ({ ...s, name: e.target.value }))} placeholder="Finish Camera" />
              </div>

              <div>
                <Label>Camera Type</Label>
                <Select
                  value={newCamera.cameraType}
                  onValueChange={(value) => {
                    const nextType = value as BroadcastCameraType;
                    setNewCamera((s) => ({
                      ...s,
                      cameraType: nextType,
                      coverageRadius: s.coverageRadius || String(getDefaultCoverageRadiusForCameraType(nextType)),
                    }));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="finish">Finish Line</SelectItem>
                    <SelectItem value="swim">Swim Start</SelectItem>
                    <SelectItem value="stage">Stage</SelectItem>
                    <SelectItem value="swim_exit">Swim Exit</SelectItem>
                    <SelectItem value="transition">Transition</SelectItem>
                    <SelectItem value="transition_entry">Transition Entry</SelectItem>
                    <SelectItem value="transition_exit">Transition Exit</SelectItem>
                    <SelectItem value="bike">Bike Course</SelectItem>
                    <SelectItem value="bike_turnaround">Bike Turnaround</SelectItem>
                    <SelectItem value="run">Run Course</SelectItem>
                    <SelectItem value="aid_station">Aid Station</SelectItem>
                    <SelectItem value="awards">Awards Stage</SelectItem>
                    <SelectItem value="medical">Medical</SelectItem>
                    <SelectItem value="interview">Interview</SelectItem>
                    <SelectItem value="expo">Expo</SelectItem>
                    <SelectItem value="mobile">Mobile Camera</SelectItem>
                    <SelectItem value="drone">Drone</SelectItem>
                    <SelectItem value="motorcycle">Motorcycle</SelectItem>
                    <SelectItem value="lead_vehicle">Lead Vehicle</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Assign To Course Location</Label>
                <Select
                  value={newCamera.courseLocationId}
                  onValueChange={(value) => {
                    const nextLocationId = value === 'none' ? '' : value;
                    const selected = courseLocations.find((location) => location.id === value) || null;
                    setNewCamera((s) => ({
                      ...s,
                      courseLocationId: nextLocationId,
                      assignedLocation: selected?.name || '',
                      latitude: selected && s.locationMode === 'fixed' ? String(selected.latitude) : s.latitude,
                      longitude: selected && s.locationMode === 'fixed' ? String(selected.longitude) : s.longitude,
                      coverageRadius: selected && s.locationMode === 'fixed' ? String(selected.coverageRadius) : s.coverageRadius,
                    }));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select a course location" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {courseLocations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between rounded border p-3">
                <div className="text-sm">
                  <div className="font-medium">Recording Enabled</div>
                  <div className="text-muted-foreground text-xs">Store stream recordings automatically.</div>
                </div>
                <Switch checked={newCamera.recordingEnabled} onCheckedChange={(checked) => setNewCamera((s) => ({ ...s, recordingEnabled: checked }))} />
              </div>
            </div>

            <div className="md:col-span-2">
              <details className="rounded-lg border bg-muted/20 p-3">
                <summary className="cursor-pointer text-sm font-semibold">Advanced Settings</summary>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>Location Mode</Label>
                    <Select value={newCamera.locationMode} onValueChange={(value) => setNewCamera((s) => ({ ...s, locationMode: value === 'mobile' ? 'mobile' : 'fixed' }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed</SelectItem>
                        <SelectItem value="mobile">Mobile</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Camera Priority</Label>
                    <Input value={newCamera.priority} onChange={(e) => setNewCamera((s) => ({ ...s, priority: e.target.value }))} placeholder="0" type="number" />
                  </div>
                  <div>
                    <Label>Latitude {newCamera.cameraType === 'custom' || newCamera.locationMode === 'mobile' || newCamera.courseLocationId === 'none' ? '(required)' : '(auto-filled)'}</Label>
                    <Input value={newCamera.latitude} onChange={(e) => setNewCamera((s) => ({ ...s, latitude: e.target.value }))} placeholder="12.9716" disabled={newCamera.cameraType !== 'custom' && newCamera.locationMode !== 'mobile' && newCamera.courseLocationId !== 'none'} />
                  </div>
                  <div>
                    <Label>Longitude {newCamera.cameraType === 'custom' || newCamera.locationMode === 'mobile' || newCamera.courseLocationId === 'none' ? '(required)' : '(auto-filled)'}</Label>
                    <Input value={newCamera.longitude} onChange={(e) => setNewCamera((s) => ({ ...s, longitude: e.target.value }))} placeholder="77.5946" disabled={newCamera.cameraType !== 'custom' && newCamera.locationMode !== 'mobile' && newCamera.courseLocationId !== 'none'} />
                  </div>
                  <div>
                    <Label>Coverage Radius (m)</Label>
                    <Input value={newCamera.coverageRadius} onChange={(e) => setNewCamera((s) => ({ ...s, coverageRadius: e.target.value }))} placeholder="150" disabled={newCamera.cameraType !== 'custom' && newCamera.locationMode !== 'mobile' && newCamera.courseLocationId !== 'none'} />
                  </div>
                  <div>
                    <Label>Playback Delay (sec)</Label>
                    <Input value={newCamera.playbackDelay} onChange={(e) => setNewCamera((s) => ({ ...s, playbackDelay: e.target.value }))} placeholder="0" type="number" />
                  </div>
                  <div>
                    <Label>Overlay Theme</Label>
                    <Input value={newCamera.overlayTheme} onChange={(e) => setNewCamera((s) => ({ ...s, overlayTheme: e.target.value }))} placeholder="classic" />
                  </div>
                  <div>
                    <Label>Recording Quality</Label>
                    <Input value={newCamera.recordingQuality} onChange={(e) => setNewCamera((s) => ({ ...s, recordingQuality: e.target.value }))} placeholder="1080p" />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Custom Metadata</Label>
                    <Input value={newCamera.assignedLocation} onChange={(e) => setNewCamera((s) => ({ ...s, assignedLocation: e.target.value }))} placeholder="Finish Arch / custom label" />
                  </div>
                </div>
              </details>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateCamera} disabled={isSaving}>{isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Create Camera</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!activeCamera} onOpenChange={(open) => {
        if (!open) {
          setActiveCamera(null);
          setRevealedKey('');
          setRevealExpiresAt(null);
          setRtmpDebug(null);
          setCameraHealth(null);
          setPlaybackValidation(null);
          setProvisioningPayload(null);
        }
      }}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-auto">
          {activeCamera ? (
            <>
              <DialogHeader>
                <DialogTitle>{activeCamera.name}</DialogTitle>
                <DialogDescription>Camera details, provisioning and Cloudflare runtime status.</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 md:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Camera Information</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Camera ID</span><span className="font-mono text-xs">{activeCamera.cameraId}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>{activeCamera.cameraType}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge className={statusTone[activeCamera.status]}>{formatStatus(activeCamera.status)}</Badge></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Viewers</span><span>{Number(activeCamera.viewerCount || 0)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Latency</span><span>{Number(activeCamera.latency || 0)} ms</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Signal</span><span>{Number(activeCamera.signal || 0)}%</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Recording</span><span>{activeCamera.recordingEnabled ? 'Enabled' : 'Disabled'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Location</span><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{activeCamera.assignedLocation || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span>{activeCamera.provider}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Recording Mode</span><span>{formatRecordingMode(cameraHealth?.health?.recordingMode || healthFallback?.recordingMode || activeCamera.cloudflare?.recordingMode || 'off')}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Last Connected</span><span>{formatDateTime(activeCamera.lastConnectedAt)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Last Stream Started</span><span>{formatDateTime(activeCamera.lastStreamStartedAt)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Last Stream Ended</span><span>{formatDateTime(activeCamera.lastStreamEndedAt)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Last Health Check</span><span>{formatDateTime(activeCamera.lastHealthCheckAt)}</span></div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-sm">Cloudflare Stream Provisioning</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Live Input UID</span><span className="font-mono text-xs">{activeCamera.cloudflare?.liveInputUid || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Playback Source</span><span>{formatPlaybackSource(playbackValidation?.playbackSource || (activeCamera.cloudflare?.videoUid ? 'Recorded Video' : activeCamera.cloudflare?.liveInputUid ? 'Live Input' : 'Pending'))}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Recording Video UID</span><span className="font-mono text-xs">{formatCompactUid(playbackValidation?.recordingVideoUid || activeCamera.cloudflare?.videoUid || activeCamera.cloudflare?.recordingUid || null)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Live Playback</span><span>{playbackValidation?.livePlayback || (activeCamera.cloudflare?.liveInputUid ? 'Ready' : 'Pending')}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Recording</span><span>{playbackValidation?.recording || (activeCamera.cloudflare?.videoUid ? 'Ready' : 'Pending')}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Replay</span><span>{playbackValidation?.replay || (activeCamera.cloudflare?.videoUid ? 'Ready' : 'Pending')}</span></div>
                    {(playbackValidation?.recordingVideoUid || activeCamera.cloudflare?.videoUid || activeCamera.cloudflare?.recordingUid) ? (
                      <div className="pt-2">
                        <Button variant="destructive" className="w-full" onClick={() => void deleteRecordingVideo(activeCamera)}>
                          <Trash2 className="mr-2 h-4 w-4" />Delete from Cloudflare
                        </Button>
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">RTMPS Server</div>
                      <div className="rounded border p-2 font-mono text-xs break-all">{activeRtmpsServer}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">Stream Key</div>
                      <div className="rounded border p-2 font-mono text-xs break-all">
                        {revealedKey ? revealedKey : 'Hidden until you click “Reveal Stream Key”'}
                      </div>
                    </div>
                    {revealExpiresAt ? (
                      <div className="text-xs text-amber-600">Stream key visible for {Math.max(0, Math.ceil((revealExpiresAt - Date.now()) / 1000))}s</div>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => void copyText(activeRtmpsServer, 'RTMPS Server')}><Copy className="mr-2 h-4 w-4" />Copy Server</Button>
                      <Button size="sm" variant="outline" onClick={() => void copyText(revealedKey || '', 'Stream Key')} disabled={!revealedKey}><Copy className="mr-2 h-4 w-4" />Copy Stream Key</Button>
                      <Button size="sm" variant="outline" onClick={() => void copyText(activeGoProRtmpUrl, 'GoPro RTMP URL')} disabled={!revealedKey}><Copy className="mr-2 h-4 w-4" />Copy GoPro URL</Button>
                    </div>
                    <div className="rounded border p-2 text-xs text-muted-foreground">
                      GoPro Quik may show only one field: ENTER YOUR RTMP URL. In that case use &quot;Copy GoPro URL&quot; (server + key combined).
                    </div>
                    <div className="rounded border p-3 text-xs space-y-1">
                      <div className="font-semibold">RTMP Compatibility Investigation</div>
                      {!revealedKey ? (
                        <div className="text-amber-600 font-medium">Reveal the stream key first to run compatibility validation.</div>
                      ) : (
                        <>
                          <div>Cloudflare Credential Pattern Detected: <span className="font-semibold">{activeRtmpDebug.validation?.valid ? 'YES' : 'NO'}</span></div>
                          <div>Pattern: <span className="font-mono break-all">{activeRtmpDebug.validation?.pattern || 'unknown'}</span></div>
                          <div>Token: <span className="font-mono break-all">{activeRtmpDebug.validation?.prefix || '—'}</span></div>
                          <div>Separator: <span className="font-mono">{activeRtmpDebug.validation?.separator || '—'}</span></div>
                          <div>UID: <span className="font-mono break-all">{activeRtmpDebug.validation?.uidSuffix || '—'}</span></div>
                          <div>Lengths: Token:{activeRtmpDebug.validation?.prefix?.length ?? 0} | Separator:{activeRtmpDebug.validation?.separator ? 1 : 0} | UID:{activeRtmpDebug.validation?.uidLength ?? 0} | Total:{activeRtmpDebug.validation?.streamKeyLength ?? 0}</div>
                          {activeRtmpDebug.validation?.valid ? (
                            <div className="text-emerald-600 font-medium">This credential format was returned directly by Cloudflare.</div>
                          ) : null}
                        </>
                      )}
                      <div>GoPro model: <span className="font-mono break-all">{activeRtmpDebug.goproModel || 'unknown'}</span></div>
                      <div>Protocol: <span className="font-mono">{activeRtmpDebug.protocol}</span> | Port: <span className="font-mono">{activeRtmpDebug.port}</span></div>
                      <div>Server: <span className="font-mono break-all">{activeRtmpDebug.server}</span></div>
                      <div>Stream Key: <span className="font-mono break-all">{activeRtmpDebug.key}</span></div>
                      <div>Combined URL: <span className="font-mono break-all">{activeRtmpDebug.combinedUrl}</span></div>
                      <div>Lengths: server {activeRtmpDebug.lengths.server}, key {activeRtmpDebug.lengths.key}, combined {activeRtmpDebug.lengths.combined}</div>
                      <div>Separate fields: <span className="font-mono break-all">{activeRtmpDebug.fieldModes.separateFields?.server || ''}</span> / <span className="font-mono break-all">{activeRtmpDebug.fieldModes.separateFields?.streamKey || ''}</span></div>
                      <div>Single RTMP URL: <span className="font-mono break-all">{activeRtmpDebug.fieldModes.singleUrl || ''}</span></div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => {
                  setActiveCamera(null);
                  setRevealedKey('');
                  setRevealExpiresAt(null);
                  setRtmpDebug(null);
                  setCameraHealth(null);
                  setPlaybackValidation(null);
                  setProvisioningPayload(null);
                }}>Close</Button>
              </DialogFooter>

              <Card>
                <CardHeader><CardTitle className="text-sm">Stream Health</CardTitle><CardDescription>Live Cloudflare diagnostics and connection status.</CardDescription></CardHeader>
                <CardContent className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Cloudflare Status</div><div className="font-medium">{String(cameraHealth?.health?.cloudflareStatus || healthFallback?.cloudflareStatus || '—')}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Connection</div><div className="font-medium">{cameraHealth?.health?.connection || healthFallback?.connection || 'Offline'}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Signal</div><div className="font-medium">{cameraHealth?.health?.signal ?? healthFallback?.signal ?? '—'}%</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Current Bitrate</div><div className="font-medium">{Number(cameraHealth?.health?.bitrate ?? healthFallback?.bitrate ?? 0).toLocaleString()} kbps</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">FPS</div><div className="font-medium">{Number(cameraHealth?.health?.fps ?? healthFallback?.fps ?? 0)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Protocol</div><div className="font-medium">{cameraHealth?.health?.protocol || healthFallback?.protocol || 'RTMP'}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Recording</div><div className="font-medium">{formatRecordingMode(cameraHealth?.health?.recordingMode || healthFallback?.recordingMode || activeCamera.cloudflare?.recordingMode || 'off')}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Viewers</div><div className="font-medium">{cameraHealth?.health?.currentViewers ?? healthFallback?.currentViewers ?? 0}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Duration</div><div className="font-medium">{Number(cameraHealth?.health?.duration ?? healthFallback?.duration ?? 0).toLocaleString()} s</div></div>
                  <div className="rounded border p-2 md:col-span-2 xl:col-span-4"><div className="text-muted-foreground text-xs">Connection Quality</div><div className="font-semibold">{cameraHealth?.health?.connection || healthFallback?.connection || 'Offline'}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Last Connected</div><div className="font-medium">{formatDateTime(cameraHealth?.health?.lastConnected || healthFallback?.lastConnected || null)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Last Disconnected</div><div className="font-medium">{formatDateTime(cameraHealth?.health?.lastDisconnected || healthFallback?.lastDisconnected || null)}</div></div>
                    <div className="rounded border p-2 md:col-span-2 xl:col-span-4"><div className="text-muted-foreground text-xs">Live Playback URL</div><div className="font-mono text-xs break-all">{activeCamera.cloudflare?.playbackUid || activeCamera.cloudflare?.liveInputUid ? getPlaybackUrl(String(activeCamera.cloudflare?.playbackUid || activeCamera.cloudflare?.liveInputUid || '')) : '—'}</div></div>
                </CardContent>
              </Card>

              {cameraHealth?.diagnostics ? (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Cloudflare Diagnostics</CardTitle></CardHeader>
                  <CardContent className="grid gap-2 text-sm md:grid-cols-2">
                    <div className="rounded border p-2"><div className="text-muted-foreground text-xs">HTTP Status</div><div className="font-medium">{cameraHealth.diagnostics.httpStatus || '—'}</div></div>
                    <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Error Code</div><div className="font-medium">{cameraHealth.diagnostics.code || '—'}</div></div>
                    <div className="rounded border p-2 md:col-span-2"><div className="text-muted-foreground text-xs">Message</div><div className="font-medium">{cameraHealth.diagnostics.message || cameraHealth.diagnostics.cloudflareErrorMessage || '—'}</div></div>
                    <div className="rounded border p-2"><div className="text-muted-foreground text-xs">API Endpoint</div><div className="font-mono text-xs break-all">{cameraHealth.diagnostics.endpoint || '—'}</div></div>
                    <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Request ID</div><div className="font-mono text-xs">{cameraHealth.diagnostics.requestId || '—'}</div></div>
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader><CardTitle className="text-sm">Playback Validation</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><span className="font-semibold">{playbackValidation?.statusLabel || '—'}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Playback Source</span><span>{playbackValidation?.playbackSource || (activeCamera.cloudflare?.videoUid ? 'Recorded Video' : activeCamera.cloudflare?.liveInputUid ? 'Live Input' : 'Pending')}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Live Playback</span><span>{playbackValidation?.livePlayback || (activeCamera.cloudflare?.liveInputUid ? 'Ready' : 'Pending')}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Recording</span><span>{playbackValidation?.recording || (activeCamera.cloudflare?.videoUid ? 'Ready' : 'Pending')}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Replay</span><span>{playbackValidation?.replay || (activeCamera.cloudflare?.videoUid ? 'Ready' : 'Pending')}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Recording Video UID</span><span className="font-mono text-xs">{formatCompactUid(playbackValidation?.recordingVideoUid || activeCamera.cloudflare?.videoUid || activeCamera.cloudflare?.recordingUid || null)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Associated to Live Input</span><span>{playbackValidation?.associated ? 'Yes' : 'No'}</span></div>
                  <div className="rounded border p-2 text-xs">{playbackValidation?.message || 'Run validation to check readiness.'}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">OBS Test</CardTitle><CardDescription>Exact stage-based readiness check for encoder and playback.</CardDescription></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Overall</span><span className="font-semibold">{cameraHealth?.obsTest?.ok ? 'Pass' : 'Fail'}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Failing Stage</span><span>{cameraHealth?.obsTest?.failedStage || '—'}</span></div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {(cameraHealth?.obsTest?.stages || []).map((stage) => (
                      <div key={stage.key} className={`rounded border p-2 ${stage.ok ? 'border-emerald-200' : 'border-red-200'}`}>
                        <div className="text-muted-foreground text-xs">{stage.label}</div>
                        <div className={`font-medium ${stage.ok ? 'text-emerald-600' : 'text-red-600'}`}>{stage.ok ? '✓ Pass' : '✗ Fail'}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">QR Code Provisioning</CardTitle><CardDescription>Versioned provisioning object with encrypted key (no plaintext secrets).</CardDescription></CardHeader>
                <CardContent className="flex flex-col items-center gap-3">
                  <Image
                    alt="Camera QR"
                    width={220}
                    height={220}
                    unoptimized
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrPayload || '{}')}`}
                    className="h-[220px] w-[220px] rounded border"
                  />
                  <div className="w-full rounded border p-2 font-mono text-xs break-all">{qrPayload || 'Loading provisioning payload...'}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Provisioning Guide (GoPro MAX)</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1">
                  <div>1. Connect the GoPro MAX to Wi-Fi or a mobile hotspot.</div>
                  <div>2. Open GoPro Quik.</div>
                  <div>3. Select RTMP Streaming.</div>
                  <div>4. If GoPro shows one RTMP URL field, paste: <span className="font-mono text-xs">{activeGoProRtmpUrl || 'Reveal Stream Key first, then copy GoPro URL'}</span></div>
                  <div>5. If GoPro shows separate fields, use Server: <span className="font-mono text-xs">{activeRtmpsServer}</span> and Stream Key from &quot;Reveal Stream Key&quot;.</div>
                  <div>6. Select 1080p.</div>
                  <div>7. Tap Go Live.</div>
                  <div>8. Return to Broadcast Dashboard and verify status is Live.</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">OBS Test Mode</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Server</div><div className="font-mono text-xs break-all">{activeRtmpsServer}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Stream Key</div><div className="font-mono text-xs break-all">{revealedKey ? revealedKey : 'Reveal stream key to test in OBS'}</div></div>
                  <div className="rounded border p-2 text-xs">Recommended: 1080p • 30 FPS • 4–6 Mbps</div>
                </CardContent>
              </Card>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void testConnection(activeCamera)} disabled={isTestingConnection}>{isTestingConnection ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Test Connection</Button>
                <Button variant="outline" onClick={() => void validatePlayback(activeCamera)} disabled={isValidatingPlayback}>{isValidatingPlayback ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Validate Playback</Button>
                <Button variant="outline" onClick={() => void loadProvisioningPayload(activeCamera)} disabled={isLoadingProvisioning}>{isLoadingProvisioning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Refresh Provisioning</Button>
                <Button variant="outline" onClick={() => void revealKey(activeCamera)} disabled={isLoadingKey}><KeyRound className="mr-2 h-4 w-4" />Reveal Stream Key</Button>
                <Button variant="outline" onClick={() => void rotateKey(activeCamera)} disabled={isLoadingKey}><RotateCw className="mr-2 h-4 w-4" />Rotate Stream Key</Button>
                {(playbackValidation?.recordingVideoUid || activeCamera.cloudflare?.videoUid || activeCamera.cloudflare?.recordingUid) ? (
                  <Button variant="destructive" onClick={() => void deleteRecordingVideo(activeCamera)}>
                    <Trash2 className="mr-2 h-4 w-4" />Delete Recording
                  </Button>
                ) : null}
                <Button variant="destructive" onClick={() => void deleteCamera(activeCamera)}><Trash2 className="mr-2 h-4 w-4" />Delete Camera</Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
