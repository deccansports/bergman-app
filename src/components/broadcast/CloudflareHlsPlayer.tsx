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
    showDiagnostics = false,
    onDiagnosticsChange,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const recoveryCountRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<CloudflareHlsDiagnostics | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

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

  const seekRelative = (deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = Math.min(Math.max(0, Number(video.currentTime || 0) + deltaSeconds), duration > 0 ? duration : Number.MAX_SAFE_INTEGER);
    video.currentTime = target;
    void video.play().catch(() => undefined);
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

    let cancelled = false;
    let monitorTimer: number | null = null;

    const updateFromVideo = (status: CloudflareHlsDiagnostics['status']) => {
      if (cancelled) return;
      const seekableEnd = video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : null;
      const bufferedEnd = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : null;
      const currentTime = Number(video.currentTime || 0);
      const latencyMs = seekableEnd !== null ? (seekableEnd - currentTime) * 1000 : null;
      const bufferAheadMs = bufferedEnd !== null ? Math.max(0, (bufferedEnd - currentTime) * 1000) : null;
      const stalled = lastTimeRef.current !== null && Math.abs(currentTime - lastTimeRef.current) < 0.05 && !video.paused;
      lastTimeRef.current = currentTime;
      const hls = hlsRef.current;
      const bandwidthKbps = hls?.bandwidthEstimate ? Math.round(hls.bandwidthEstimate / 1000) : null;
      const level = typeof hls?.currentLevel === 'number' && hls.currentLevel >= 0 ? hls.currentLevel : null;

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
    video.addEventListener('error', handleError);

    return () => {
      cancelled = true;
      if (monitorTimer) window.clearInterval(monitorTimer);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('error', handleError);
      destroyHls();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, autoPlay, lowLatency]);

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
    return <span className="inline-flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1 text-xs text-red-200"><span className="h-2 w-2 animate-pulse rounded-full bg-red-400" /> Live</span>;
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

      {showControls ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 py-3 text-white">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => seekRelative(-seekStepSeconds)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label={`Rewind ${seekStepSeconds} seconds`}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={togglePlayback}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => seekRelative(seekStepSeconds)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label={`Forward ${seekStepSeconds} seconds`}
            >
              <RotateCw className="h-4 w-4" />
            </button>
          </div>

          <div className="rounded-full bg-black/40 px-3 py-1 text-[11px] font-medium text-slate-200 backdrop-blur">
            Tap play / pause or skip by {seekStepSeconds}s
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
