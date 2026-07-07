"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Copy, ExternalLink, Radio, Share2, Volume2 } from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { PublicBroadcastCamera, PublicBroadcastEvent, PublicBroadcastFeaturedVideo } from '@/lib/broadcast/public';
import { getPlaybackUrl } from '@/lib/cloudflare/stream';
import CloudflareHlsPlayer, { type CloudflareHlsDiagnostics, type CloudflareHlsTimelineMarker } from '@/components/broadcast/CloudflareHlsPlayer';

type AthleteOverlay = {
  athlete?: { name?: string; bibNumber?: string; raceCategory?: string; clubName?: string };
  postRace?: { ranks?: { overallRank?: number | null; genderRank?: number | null; categoryRank?: number | null }; timingBreakdown?: { chipTime?: string | null } };
  history?: Array<{ eventName?: string; category?: string; finishTime?: string | null; position?: number | null }>;
};

function slugify(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cameraSlug(camera: PublicBroadcastCamera) {
  return slugify(camera.name || camera.cameraType || camera.cameraId);
}

export default function PublicBroadcastPortal({
  event,
  cameras,
  sponsors,
  featuredVideo,
  initialCameraSlug,
}: {
  event: PublicBroadcastEvent;
  cameras: PublicBroadcastCamera[];
  sponsors: Array<{ name: string; logoUrl: string; website?: string | null }>;
  featuredVideo?: PublicBroadcastFeaturedVideo | null;
  initialCameraSlug?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bib = searchParams.get('bib') || '';
  const [athlete, setAthlete] = useState<AthleteOverlay | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>(() => initialCameraSlug || cameraSlug(cameras.find((camera) => camera.status === 'live') || cameras[0] || { name: '', cameraType: '', cameraId: '' } as any));
  const [isLoadingAthlete, setIsLoadingAthlete] = useState(false);
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const [diagnostics, setDiagnostics] = useState<CloudflareHlsDiagnostics | null>(null);

  const selectedCamera = useMemo(() => {
    return cameras.find((camera) => cameraSlug(camera) === selectedSlug) || cameras.find((camera) => camera.status === 'live' || camera.status === 'recording') || cameras[0] || null;
  }, [cameras, selectedSlug]);

  const activePlaybackUid = selectedCamera?.playbackUid || selectedCamera?.liveInputUid || null;
  const activeStreamUrl = activePlaybackUid ? getPlaybackUrl(activePlaybackUid) : '';
  const featuredVideoEmbedUrl = featuredVideo?.youtubeId
    ? `https://www.youtube.com/embed/${encodeURIComponent(featuredVideo.youtubeId)}?autoplay=1&mute=1&controls=1&rel=0&modestbranding=1&playsinline=1`
    : '';
  const isLive = cameras.some((camera) => camera.status === 'live' || camera.status === 'recording');
  const hasReplay = cameras.some((camera) => Boolean(camera.recordingUid) && Boolean(camera.playbackUid));
  const showGoLive = isLive && Boolean(activeStreamUrl);
  const liveSinceLabel = useMemo(() => {
    const raw = selectedCamera?.lastStreamStartedAt || selectedCamera?.lastConnectedAt || null;
    if (!raw) return null;
    const started = new Date(raw);
    if (Number.isNaN(started.getTime())) return null;
    return started.toLocaleString();
  }, [selectedCamera?.lastConnectedAt, selectedCamera?.lastStreamStartedAt]);

  const timelineMarkers = useMemo<CloudflareHlsTimelineMarker[]>(() => {
    const rawTimingPoints = Array.isArray((event as any)?.liveTrackingHub?.timingPoints)
      ? (event as any).liveTrackingHub.timingPoints
      : [];

    const labels = [
      { label: '🏊 Swim Start', percent: 0 },
      { label: '🚴 Bike Start', percent: 33 },
      { label: '🏃 Run Start', percent: 66 },
      { label: '🏁 Finish', percent: 100 },
    ] satisfies Array<{ label: string; percent: number }>;

    if (!Array.isArray(rawTimingPoints) || rawTimingPoints.length === 0) {
      return labels.map((item) => ({ label: item.label, percent: item.percent }));
    }

    const resolved = labels.map((item, index) => {
      const point = rawTimingPoints.find((row: any) => {
        const text = String(row?.displayName || row?.shortName || row?.name || row?.label || row?.leg || '').toLowerCase();
        return item.label.toLowerCase().includes('swim') ? text.includes('swim') :
          item.label.toLowerCase().includes('bike') ? text.includes('bike') :
          item.label.toLowerCase().includes('run') ? text.includes('run') :
          text.includes('finish');
      });

      return {
        label: point ? String(point?.displayName || point?.shortName || point?.name || item.label) : item.label,
        percent: item.percent,
      } as CloudflareHlsTimelineMarker;
    });

    return resolved;
  }, [event]);

  const goLive = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      const liveEdge = player.seekable.length > 0 ? player.seekable.end(player.seekable.length - 1) : player.duration;
      if (Number.isFinite(liveEdge) && liveEdge > 0) {
        player.currentTime = liveEdge;
      }
      await player.play();
    } catch {
      try {
        player.muted = true;
        const liveEdge = player.seekable.length > 0 ? player.seekable.end(player.seekable.length - 1) : player.duration;
        if (Number.isFinite(liveEdge) && liveEdge > 0) {
          player.currentTime = liveEdge;
        }
        await player.play();
      } catch {
        // no-op
      }
    }
  }, []);

  useEffect(() => {
    if (!bib) {
      setAthlete(null);
      return;
    }

    const controller = new AbortController();
    const load = async () => {
      setIsLoadingAthlete(true);
      try {
        const res = await fetch(`/api/athlete-journey?eventId=${encodeURIComponent(event.id)}&bibNumber=${encodeURIComponent(bib)}`, { cache: 'no-store', signal: controller.signal });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.message || 'Failed to load athlete overlay');
        setAthlete(payload?.data || null);
      } catch {
        setAthlete(null);
      } finally {
        setIsLoadingAthlete(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [bib, event.id]);

  useEffect(() => {
    if (initialCameraSlug) setSelectedSlug(initialCameraSlug);
  }, [initialCameraSlug]);

  const copyLink = async (url: string) => {
    await navigator.clipboard.writeText(url);
  };

  const shareUrl = typeof window === 'undefined' ? '' : window.location.href;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="relative border-b border-white/10 bg-slate-950/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            {event.finishLedLogoUrl ? (
              <Image src={event.finishLedLogoUrl} alt={event.eventName} width={64} height={64} className="rounded-full object-contain" />
            ) : null}
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Bergman Broadcast</div>
              <h1 className="text-xl font-black md:text-2xl">{event.eventName}</h1>
              <div className="text-sm text-slate-300">{event.eventDate ? new Date(event.eventDate).toLocaleDateString() : 'Event date unavailable'}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-semibold ${isLive ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-100'}`}>
              <Radio className="h-4 w-4" /> {isLive ? 'LIVE NOW' : hasReplay ? 'ENDED' : 'WAITING'}
            </span>
            <span className="rounded-full border border-white/10 px-3 py-1 text-slate-300">{cameras.filter((camera) => camera.status === 'live' || camera.status === 'recording').length} Live Cameras</span>
            <span className="rounded-full border border-white/10 px-3 py-1 text-slate-300">{cameras.reduce((sum, camera) => sum + Number(camera.viewerCount || camera.currentViewers || 0), 0)} Viewers</span>
            {liveSinceLabel ? <span className="rounded-full border border-white/10 px-3 py-1 text-slate-300">Live since {liveSinceLabel}</span> : null}
            {shareUrl ? (
              <button className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-slate-200 hover:bg-white/5" onClick={() => void copyLink(shareUrl)}>
                <Copy className="h-4 w-4" /> Copy Link
              </button>
            ) : null}
            {shareUrl ? (
              <Link href={shareUrl} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-slate-200 hover:bg-white/5" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> Open
              </Link>
            ) : null}
            <button className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-slate-200 hover:bg-white/5">
              <Share2 className="h-4 w-4" /> Share
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl">
            <div className="relative aspect-video bg-black">
              {activeStreamUrl ? (
                <CloudflareHlsPlayer
                  ref={playerRef}
                  src={activeStreamUrl}
                  title={selectedCamera?.name || event.eventName}
                  className="h-full w-full object-contain bg-black"
                  showControls
                  dvrWindowHours={4}
                  timelineMarkers={timelineMarkers}
                  onDiagnosticsChange={setDiagnostics}
                />
              ) : featuredVideoEmbedUrl ? (
                <iframe
                  src={featuredVideoEmbedUrl}
                  title={featuredVideo?.title || 'Featured highlight'}
                  className="h-full w-full border-0 bg-black"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-black p-8 text-center">
                  <Image src="/bwshop.png" alt="Bergman Logo" width={360} height={200} className="mx-auto object-contain" />
                </div>
              )}

              {showGoLive ? (
                <div className="absolute right-4 top-4">
                  <button
                    type="button"
                    onClick={() => void goLive()}
                    className="pointer-events-auto rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-400"
                  >
                    Go Live
                  </button>
                </div>
              ) : null}

              {athlete?.athlete?.name ? (
                <div className="pointer-events-none absolute bottom-4 left-4 max-w-md rounded-2xl bg-black/65 p-4 backdrop-blur">
                  <div className="text-xs uppercase tracking-[0.3em] text-yellow-300">Athlete Deep Link</div>
                  <div className="mt-1 text-xl font-black">{athlete.athlete.name}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-200">
                    <div>Bib: {athlete.athlete.bibNumber || bib}</div>
                    <div>Category: {athlete.athlete.raceCategory || '—'}</div>
                    <div>Club: {athlete.athlete.clubName || '—'}</div>
                    <div>Current Rank: {athlete.postRace?.ranks?.overallRank ?? '—'}</div>
                  </div>
                </div>
              ) : bib && isLoadingAthlete ? (
                <div className="pointer-events-none absolute bottom-4 left-4 rounded-2xl bg-black/65 px-4 py-3 text-sm text-slate-200">Loading athlete overlay…</div>
              ) : null}

              {!activeStreamUrl && featuredVideo ? (
                <div className="pointer-events-none absolute right-4 bottom-4 max-w-md rounded-2xl bg-black/65 p-4 text-left backdrop-blur">
                  <div className="text-xs uppercase tracking-[0.3em] text-cyan-300">Featured Highlight</div>
                  <div className="mt-1 text-lg font-bold text-white">{featuredVideo.title}</div>
                  <div className="mt-1 text-sm text-slate-300">{featuredVideo.description || 'Latest featured video from the Bergman library.'}</div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Camera</div>
              <div className="mt-2 text-lg font-bold text-white">{selectedCamera?.name || 'Default Camera'}</div>
              <div className="text-sm text-slate-300">{selectedCamera?.assignedLocation || selectedCamera?.cameraType || 'Camera'}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Viewers</div>
              <div className="mt-2 text-lg font-bold text-white">{Number(selectedCamera?.viewerCount || selectedCamera?.currentViewers || 0) || '—'}</div>
              {liveSinceLabel ? <div className="text-sm text-slate-300">Live since {liveSinceLabel}</div> : null}
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Latency</div>
              <div className="mt-2 text-lg font-bold text-white">{diagnostics?.latencyMs !== null && diagnostics?.latencyMs !== undefined ? `${Math.max(0, Math.round(diagnostics.latencyMs || 0))} ms` : '—'}</div>
              <div className="text-sm text-slate-300">Low-latency HLS</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Recovery</div>
              <div className="mt-2 text-lg font-bold text-white">{diagnostics?.recoveryCount ?? 0}</div>
              <div className="text-sm text-slate-300">Bandwidth {diagnostics?.bandwidthKbps ? `${diagnostics.bandwidthKbps} kbps` : '—'}</div>
            </div>
          </div>

          {sponsors.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Sponsor Banner</div>
              <div className="flex flex-wrap items-center gap-4">
                {sponsors.map((sponsor) => (
                  <div key={sponsor.name} className="flex items-center gap-3">
                    {sponsor.logoUrl ? <Image src={sponsor.logoUrl} alt={sponsor.name} width={90} height={30} className="h-8 w-auto object-contain" /> : null}
                    <span className="text-sm text-slate-200">{sponsor.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cameras.map((camera) => {
              const slug = cameraSlug(camera);
              const isActive = slug === selectedSlug;
              const cameraUrl = `${typeof window === 'undefined' ? '' : window.location.origin}/live/${encodeURIComponent(event.customSlug || event.id)}/${encodeURIComponent(slug)}`;
              return (
                <button
                  key={camera.cameraId}
                  onClick={() => {
                    setSelectedSlug(slug);
                    router.replace(`/live/${encodeURIComponent(event.customSlug || event.id)}/${encodeURIComponent(slug)}${bib ? `?bib=${encodeURIComponent(bib)}` : ''}`);
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${isActive ? 'border-emerald-400 bg-emerald-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold">{camera.name}</div>
                      <div className="text-xs text-slate-400">{camera.assignedLocation || camera.cameraType}</div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${(camera.status === 'live' || camera.status === 'recording') ? 'bg-emerald-500 text-white' : camera.status === 'waiting_for_stream' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-200'}`}>
                      {camera.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                    <Volume2 className="h-3.5 w-3.5" /> {camera.viewerCount} viewers
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">{cameraUrl}</div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Event Status</div>
            <div className="mt-2 text-2xl font-black">{isLive ? 'LIVE NOW' : hasReplay ? 'ENDED' : 'WAITING'}</div>
            <div className="mt-1 text-sm text-slate-300">{event.description || 'Public broadcast portal powered by BERGMAN Stream.'}</div>
              <div className="mt-2 text-sm text-slate-200">Current viewers: {cameras.reduce((sum, camera) => sum + Number(camera.viewerCount || camera.currentViewers || 0), 0) || '—'}</div>
            {!isLive && !hasReplay ? <div className="mt-2 text-xs text-slate-400">Broadcast has not started yet.</div> : null}
            {!isLive && hasReplay ? <div className="mt-2 text-xs text-slate-400">Broadcast has ended. Replay available where recording exists.</div> : null}
          </div>

        </aside>
      </div>
    </div>
  );
}
