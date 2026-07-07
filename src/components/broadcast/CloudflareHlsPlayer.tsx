"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Loader2, AlertTriangle, Radio, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';

export type CloudflareHlsDiagnostics = {
  status: 'idle' | 'loading' | 'playing' | 'buffering' | 'recovering' | 'error';
  source: string;
  latencyMs: number | null;
  bufferAheadMs: number | null;
  readyState: number;
  networkState: number;
  stalled: boolean;
  recoveryCount: number;
  bandwidthKbps: number | null;
  level: number | null;
  lastError: string | null;
  updatedAt: string;
};

export type CloudflareHlsTimelineMarker = {
  label: string;
  icon?: React.ReactNode;
  secondsFromStart?: number | null;
  percent?: number | null;
  timestamp?: number | string | Date | null;
};

type Props = {
  src: string;
  title: string;
  className?: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  showControls?: boolean;
  seekStepSeconds?: number;
  lowLatency?: boolean;
  dvrWindowHours?: 1 | 2 | 4 | 12 | number;
  timelineMarkers?: CloudflareHlsTimelineMarker[];
  showDiagnostics?: boolean;
  onDiagnosticsChange?: (diagnostics: CloudflareHlsDiagnostics | null) => void;
};

const DEFAULT_DIAGNOSTICS: CloudflareHlsDiagnostics = {
  status: 'idle',
  source: '',
  latencyMs: null,
  bufferAheadMs: null,
  readyState: 0,
  networkState: 0,
  stalled: false,
  recoveryCount: 0,
  bandwidthKbps: null,
  level: null,
  lastError: null,
  updatedAt: new Date(0).toISOString(),
};

function formatLatency(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.max(0, Math.round(value))} ms`;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function formatClock(seconds: number) {
  const safe = Math.max(0, seconds);
  return new Date(safe * 1000).toISOString().slice(11, 19);
}

function formatBehind(seconds: number) {
  const safe = Math.max(0, seconds);
  return safe < 60 ? `${Math.round(safe)}s Behind Live` : `${formatDuration(safe)} Behind Live`;
}

const CloudflareHlsPlayer = forwardRef<HTMLVideoElement, Props>(function CloudflareHlsPlayer(
  {
    src,
    title,
    className,
    poster,
    autoPlay = true,
    muted = true,
    controls = false,
    showControls = false,
    seekStepSeconds = 10,
    lowLatency = true,
    dvrWindowHours = 4,
    timelineMarkers = [],
    showDiagnostics = false,
    onDiagnosticsChange,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const recoveryCountRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const wasPlayingBeforeScrubRef = useRef(false);
  const [diagnostics, setDiagnostics] = useState<CloudflareHlsDiagnostics | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineState, setTimelineState] = useState({
    seekableStart: 0,
    seekableEnd: 0,
    currentTime: 0,
    liveEdge: 0,
    behindLiveSec: 0,
    dvrWindowSec: 0,
    canSeek: false,
  });

  useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement, []);

  const applyDiagnostics = (next: CloudflareHlsDiagnostics | null) => {
    setDiagnostics(next);
    onDiagnosticsChange?.(next);
  };

  const destroyHls = () => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  };

  const seekRelative = (deltaSeconds: number, resumePlayback = true) => {
    const video = videoRef.current;
    if (!video) return;
    const seekableStart = video.seekable.length > 0 ? video.seekable.start(0) : 0;
    const seekableEnd = video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : (Number.isFinite(video.duration) ? video.duration : Number(video.currentTime || 0));
    const maxRewind = Math.max(0, Number(dvrWindowHours || 0) * 3600);
    const minSeek = maxRewind > 0 ? Math.max(seekableStart, seekableEnd - maxRewind) : seekableStart;
    const maxSeek = seekableEnd || minSeek;
    const target = Math.min(Math.max(minSeek, Number(video.currentTime || 0) + deltaSeconds), maxSeek);
    video.currentTime = target;
    if (resumePlayback) {
      void video.play().catch(() => undefined);
    }
  };

  const seekToLive = (resumePlayback = true) => {
    const video = videoRef.current;
    if (!video) return;
    const liveEdge = video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : Number(video.duration || video.currentTime || 0);
    if (Number.isFinite(liveEdge) && liveEdge > 0) {
      video.currentTime = liveEdge;
    }
    if (resumePlayback) {
      void video.play().catch(() => undefined);
    }
  };

  const seekToAbsolute = (targetSeconds: number, resumePlayback = true) => {
    const video = videoRef.current;
    if (!video) return;
    const seekableStart = video.seekable.length > 0 ? video.seekable.start(0) : 0;
    const seekableEnd = video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : (Number.isFinite(video.duration) ? video.duration : targetSeconds);
    const maxRewind = Math.max(0, Number(dvrWindowHours || 0) * 3600);
    const minSeek = maxRewind > 0 ? Math.max(seekableStart, seekableEnd - maxRewind) : seekableStart;
    video.currentTime = Math.min(Math.max(minSeek, targetSeconds), seekableEnd || targetSeconds);
    if (resumePlayback) {
      void video.play().catch(() => undefined);
    }
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) {
      destroyHls();
      applyDiagnostics(null);
      return;
    }

    destroyHls();
    recoveryCountRef.current = 0;
    applyDiagnostics({ ...DEFAULT_DIAGNOSTICS, source: src, status: 'loading', updatedAt: new Date().toISOString() });
    setTimelineState((prev) => ({ ...prev, seekableStart: 0, seekableEnd: 0, currentTime: 0, liveEdge: 0, behindLiveSec: 0, dvrWindowSec: 0, canSeek: false }));

    let cancelled = false;
    let monitorTimer: number | null = null;

    const updateFromVideo = (status: CloudflareHlsDiagnostics['status']) => {
      if (cancelled) return;
      if (isScrubbingRef.current) {
        const hls = hlsRef.current;
        const seekableEnd = video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : null;
        const seekableStart = video.seekable.length > 0 ? video.seekable.start(0) : null;
        const currentTime = Number(video.currentTime || 0);
        const liveEdge = seekableEnd ?? currentTime;
        const behindLiveSec = Math.max(0, liveEdge - currentTime);
        const bufferAheadMs = video.buffered.length > 0 ? Math.max(0, (video.buffered.end(video.buffered.length - 1) - currentTime) * 1000) : null;
        applyDiagnostics({
          status,
          source: src,
          latencyMs: seekableEnd !== null ? Math.max(0, (seekableEnd - currentTime) * 1000) : null,
          bufferAheadMs,
          readyState: video.readyState,
          networkState: video.networkState,
          stalled: false,
          recoveryCount: recoveryCountRef.current,
          bandwidthKbps: hls?.bandwidthEstimate ? Math.round(hls.bandwidthEstimate / 1000) : null,
          level: typeof hls?.currentLevel === 'number' && hls.currentLevel >= 0 ? hls.currentLevel : null,
          lastError: diagnostics?.lastError || null,
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      const seekableEnd = video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : null;
      const seekableStart = video.seekable.length > 0 ? video.seekable.start(0) : null;
      const bufferedEnd = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : null;
      const currentTime = Number(video.currentTime || 0);
      const latencyMs = seekableEnd !== null ? Math.max(0, (seekableEnd - currentTime) * 1000) : null;
      const bufferAheadMs = bufferedEnd !== null ? Math.max(0, (bufferedEnd - currentTime) * 1000) : null;
      const stalled = lastTimeRef.current !== null && Math.abs(currentTime - lastTimeRef.current) < 0.05 && !video.paused;
      lastTimeRef.current = currentTime;
      const hls = hlsRef.current;
      const bandwidthKbps = hls?.bandwidthEstimate ? Math.round(hls.bandwidthEstimate / 1000) : null;
      const level = typeof hls?.currentLevel === 'number' && hls.currentLevel >= 0 ? hls.currentLevel : null;
      const liveEdge = seekableEnd ?? currentTime;
      const behindLiveSec = Math.max(0, liveEdge - currentTime);
      const dvrWindowSec = seekableStart !== null && seekableEnd !== null ? Math.max(0, seekableEnd - seekableStart) : 0;
      const canSeek = Boolean(seekableEnd !== null && seekableStart !== null && seekableEnd > seekableStart + 0.25);

      setTimelineState({
        seekableStart: seekableStart ?? 0,
        seekableEnd: seekableEnd ?? liveEdge,
        currentTime,
        liveEdge,
        behindLiveSec,
        dvrWindowSec,
        canSeek,
      });

      applyDiagnostics({
        status,
        source: src,
        latencyMs,
        bufferAheadMs,
        readyState: video.readyState,
        networkState: video.networkState,
        stalled,
        recoveryCount: recoveryCountRef.current,
        bandwidthKbps,
        level,
        lastError: diagnostics?.lastError || null,
        updatedAt: new Date().toISOString(),
      });
    };

    const attachNativeSource = () => {
      video.src = src;
      if (autoPlay) {
        void video.play().catch(() => undefined);
      }
    };

    const tryAutoplay = () => {
      if (!autoPlay) return;
      void video.play().catch(async () => {
        try {
          video.muted = true;
          await video.play();
        } catch {
          // ignore autoplay rejections
        }
      });
    };

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: lowLatency,
        enableWorker: true,
        capLevelToPlayerSize: true,
        maxBufferLength: 8,
        backBufferLength: 30,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
        maxLiveSyncPlaybackRate: 1.5,
        fragLoadingRetryDelay: 1000,
        manifestLoadingRetryDelay: 1000,
        levelLoadingRetryDelay: 1000,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (!cancelled) hls.loadSource(src);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!cancelled) {
          tryAutoplay();
          updateFromVideo('playing');
        }
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => updateFromVideo('playing'));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled) return;
        const fatal = Boolean(data?.fatal);
        const errorText = data?.details || data?.type || 'HLS error';
        applyDiagnostics({
          ...(diagnostics || DEFAULT_DIAGNOSTICS),
          source: src,
          status: fatal ? 'error' : 'recovering',
          lastError: String(errorText),
          recoveryCount: recoveryCountRef.current,
          updatedAt: new Date().toISOString(),
        });

        if (!fatal) return;

        recoveryCountRef.current += 1;
        applyDiagnostics({
          ...(diagnostics || DEFAULT_DIAGNOSTICS),
          source: src,
          status: 'recovering',
          lastError: String(errorText),
          recoveryCount: recoveryCountRef.current,
          updatedAt: new Date().toISOString(),
        });

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }

        destroyHls();
        attachNativeSource();
      });
      attachNativeSource();
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      attachNativeSource();
    } else {
      applyDiagnostics({
        ...DEFAULT_DIAGNOSTICS,
        source: src,
        status: 'error',
        lastError: 'This browser cannot play HLS streams.',
        updatedAt: new Date().toISOString(),
      });
    }

    monitorTimer = window.setInterval(() => {
      if (cancelled) return;
      updateFromVideo(video.paused ? 'buffering' : 'playing');
    }, 5000);

    const handleWaiting = () => updateFromVideo('buffering');
    const handlePlaying = () => updateFromVideo('playing');
    const handlePause = () => {
      setIsPlaying(false);
      updateFromVideo('buffering');
    };
    const handlePlay = () => {
      setIsPlaying(true);
      updateFromVideo('playing');
    };
    const handleTimeUpdate = () => {
      updateFromVideo(video.paused ? 'buffering' : 'playing');
    };
    const handleError = () => {
      const mediaError = video.error?.message || video.error?.code;
      applyDiagnostics({
        ...(diagnostics || DEFAULT_DIAGNOSTICS),
        source: src,
        status: 'error',
        lastError: mediaError ? String(mediaError) : 'Playback error',
        recoveryCount: recoveryCountRef.current,
        updatedAt: new Date().toISOString(),
      });
    };

    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
  video.addEventListener('pause', handlePause);
  video.addEventListener('play', handlePlay);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('error', handleError);

    return () => {
      cancelled = true;
      if (monitorTimer) window.clearInterval(monitorTimer);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('error', handleError);
      destroyHls();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, autoPlay, lowLatency]);

  const behindLiveSec = timelineState.behindLiveSec;
  const isBehindLive = behindLiveSec > 2.5;
  const activeStatusLabel = isBehindLive ? `Watching ${formatBehind(behindLiveSec)}` : 'LIVE';

  const resolvedMarkers = useMemo(() => {
    const seekableStart = timelineState.seekableStart;
    const seekableEnd = timelineState.seekableEnd;
    const windowStart = seekableEnd > seekableStart && Number.isFinite(seekableEnd) ? Math.max(seekableStart, seekableEnd - Math.max(0, Number(dvrWindowHours || 0) * 3600)) : seekableStart;
    const windowSize = Math.max(1, seekableEnd - windowStart);

    return timelineMarkers
      .map((marker, index) => {
        const icon = marker.icon || null;
        let target: number | null = null;
        if (Number.isFinite(Number(marker.secondsFromStart))) {
          target = Number(marker.secondsFromStart);
        } else if (Number.isFinite(Number(marker.percent))) {
          target = windowStart + (Math.max(0, Math.min(100, Number(marker.percent))) / 100) * windowSize;
        } else if (marker.timestamp !== null && marker.timestamp !== undefined) {
          const ts = new Date(marker.timestamp as any).getTime();
          if (Number.isFinite(ts)) target = ts / 1000;
        }
        if (target === null || !Number.isFinite(target)) return null;
        if (target < windowStart - 1 || target > seekableEnd + 1) return null;
        return { ...marker, icon, target, key: `${marker.label}-${index}` };
      })
      .filter(Boolean) as Array<{ label: string; icon: React.ReactNode | null; target: number; key: string }>;
  }, [dvrWindowHours, timelineMarkers, timelineState.seekableEnd, timelineState.seekableStart]);

  const timelinePercent = useMemo(() => {
    if (!timelineState.canSeek) return 100;
    const span = Math.max(1, timelineState.seekableEnd - timelineState.seekableStart);
    return Math.max(0, Math.min(100, ((timelineState.currentTime - timelineState.seekableStart) / span) * 100));
  }, [timelineState]);

  const behindLabel = isBehindLive ? formatBehind(behindLiveSec) : 'LIVE';
  const liveEdgeLabel = timelineState.liveEdge > 0 ? formatClock(timelineState.liveEdge) : '—';
  const viewerLabel = timelineState.currentTime > 0 ? formatClock(timelineState.currentTime) : '—';

  const statusChip = useMemo(() => {
    if (!diagnostics || diagnostics.status === 'idle') {
      return <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200"><Loader2 className="h-3 w-3 animate-spin" /> Loading</span>;
    }
    if (diagnostics.status === 'error') {
      return <span className="inline-flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1 text-xs text-red-200"><AlertTriangle className="h-3 w-3" /> Playback issue</span>;
    }
    if (diagnostics.status === 'recovering') {
      return <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/20 px-3 py-1 text-xs text-amber-200"><Loader2 className="h-3 w-3 animate-spin" /> Recovering</span>;
    }
    if (diagnostics.status === 'buffering') {
      return <span className="inline-flex items-center gap-2 rounded-full bg-blue-500/20 px-3 py-1 text-xs text-blue-200"><Radio className="h-3 w-3" /> Buffering</span>;
    }
    return <span className="inline-flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1 text-xs text-red-200"><span className="h-2 w-2 animate-pulse rounded-full bg-red-400" /> LIVE</span>;
  }, [diagnostics]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-black">
      <video
        ref={videoRef}
        title={title}
        poster={poster}
        autoPlay={autoPlay}
        muted={muted}
        controls={controls}
        playsInline
        preload="metadata"
        className={className || 'h-full w-full object-contain bg-black'}
      />

      <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2 text-white">
        <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${isBehindLive ? 'bg-amber-500/20 text-amber-100' : 'bg-red-500/20 text-red-100'}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${isBehindLive ? 'bg-amber-400' : 'animate-pulse bg-red-400'}`} />
          {activeStatusLabel}
        </div>
        <div className="rounded-full bg-black/50 px-3 py-1 text-xs text-slate-200 backdrop-blur">Live edge {liveEdgeLabel}</div>
        {isBehindLive ? <div className="rounded-full bg-black/50 px-3 py-1 text-xs text-slate-200 backdrop-blur">Viewer position {viewerLabel}</div> : null}
      </div>

      {showControls ? (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-3 pt-6 text-white">
          <div className="space-y-3">
            <div className="relative h-8">
              <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-white/15 shadow-inner" />
              <div
                className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-emerald-400/80"
                style={{ width: `${timelinePercent}%` }}
              />
              {resolvedMarkers.map((marker) => {
                const span = Math.max(1, timelineState.seekableEnd - timelineState.seekableStart);
                const markerPercent = Math.max(0, Math.min(100, ((marker.target - timelineState.seekableStart) / span) * 100));
                return (
                  <button
                    key={marker.key}
                    type="button"
                    onClick={() => seekToAbsolute(marker.target)}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${markerPercent}%` }}
                    aria-label={marker.label}
                    title={marker.label}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/70 text-[11px] text-white shadow-lg backdrop-blur">
                      {marker.icon || '●'}
                    </span>
                  </button>
                );
              })}
              <input
                type="range"
                min={timelineState.seekableStart}
                max={Math.max(timelineState.seekableEnd, timelineState.seekableStart + 1)}
                step="0.1"
                value={Math.min(Math.max(timelineState.currentTime, timelineState.seekableStart), Math.max(timelineState.seekableEnd, timelineState.seekableStart + 1))}
                disabled={!timelineState.canSeek}
                onPointerDown={() => {
                  const video = videoRef.current;
                  wasPlayingBeforeScrubRef.current = Boolean(video && !video.paused);
                  isScrubbingRef.current = true;
                  video?.pause();
                }}
                onPointerUp={() => {
                  isScrubbingRef.current = false;
                  if (wasPlayingBeforeScrubRef.current) {
                    void videoRef.current?.play().catch(() => undefined);
                  }
                }}
                onInput={(e) => {
                  const next = Number((e.currentTarget as HTMLInputElement).value);
                  if (Number.isFinite(next)) seekToAbsolute(next, false);
                }}
                onChange={(e) => {
                  const next = Number((e.currentTarget as HTMLInputElement).value);
                  if (Number.isFinite(next)) seekToAbsolute(next, false);
                }}
                className="absolute inset-x-0 top-1/2 h-8 w-full -translate-y-1/2 cursor-pointer appearance-none bg-transparent opacity-0"
                aria-label="Live timeline"
              />
              <div
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-500 shadow-lg shadow-red-500/40"
                style={{ left: `${timelinePercent}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => seekRelative(-seekStepSeconds)}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-3 text-white transition hover:bg-white/20"
                  aria-label={`Rewind ${seekStepSeconds} seconds`}
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>{seekStepSeconds}s</span>
                </button>
                <button
                  type="button"
                  onClick={togglePlayback}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-emerald-500 px-4 text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  <span>{isPlaying ? 'Pause' : 'Play'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => seekRelative(seekStepSeconds)}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-3 text-white transition hover:bg-white/20"
                  aria-label={`Forward ${seekStepSeconds} seconds`}
                >
                  <RotateCw className="h-4 w-4" />
                  <span>{seekStepSeconds}s</span>
                </button>
                {isBehindLive ? (
                  <button
                    type="button"
                    onClick={() => seekToLive()}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-red-500 px-4 text-white transition hover:bg-red-400"
                    aria-label="Go Live"
                  >
                    <Radio className="h-4 w-4" />
                    <span>Go Live</span>
                  </button>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                <span className="rounded-full bg-black/40 px-3 py-1 backdrop-blur">DVR {formatDuration(Math.max(timelineState.dvrWindowSec, Number(dvrWindowHours || 0) * 3600))}</span>
                <span className="rounded-full bg-black/40 px-3 py-1 backdrop-blur">{isBehindLive ? behindLabel : '🔴 LIVE'}</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px] text-slate-300">
              <span>Seek within the DVR window; click markers to jump to race milestones.</span>
              <span>{timelineState.canSeek ? 'Drag the playhead back or return to live at any time.' : 'Live-only playback'}</span>
            </div>
          </div>
        </div>
      ) : null}

      {showDiagnostics && diagnostics ? (
        <div className="pointer-events-none absolute left-3 top-3 space-y-2 rounded-xl bg-black/60 px-3 py-2 text-[11px] text-slate-100 backdrop-blur">
          <div className="flex items-center gap-2">{statusChip}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-200/90">
            <span>Latency</span><span className="text-right font-semibold">{formatLatency(diagnostics.latencyMs)}</span>
            <span>Buffer</span><span className="text-right font-semibold">{formatLatency(diagnostics.bufferAheadMs)}</span>
            <span>Bandwidth</span><span className="text-right font-semibold">{diagnostics.bandwidthKbps ? `${diagnostics.bandwidthKbps} kbps` : '—'}</span>
            <span>Recovery</span><span className="text-right font-semibold">{diagnostics.recoveryCount}</span>
          </div>
          {diagnostics.lastError ? <div className="max-w-[22rem] text-red-200">{diagnostics.lastError}</div> : null}
        </div>
      ) : null}
    </div>
  );
});

export default CloudflareHlsPlayer;
