// src/app/live/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, Radio, VideoOff } from 'lucide-react';
import Image from 'next/image';
import type { BroadcastCamera } from '@/lib/types/broadcast';
import { getPlaybackUrl } from '@/lib/cloudflare/stream';
import CloudflareHlsPlayer, { type CloudflareHlsDiagnostics } from '@/components/broadcast/CloudflareHlsPlayer';

type FeaturedVideo = {
    youtubeId: string;
    title: string;
    description: string | null;
    category: string;
    thumbnailUrl: string | null;
    addedAt: string;
} | null;

type StreamTile = {
    cameraId: string;
    name: string;
    eventId: string;
    playbackUid: string;
    playbackUrl: string;
    webRTCPlaybackUrl?: string;
    rtmpsPlaybackUrl?: string;
    assignedLocation?: string | null;
    priority: number;
    viewerCount: number;
    liveSince: string | null;
    streamDurationSeconds: number | null;
};

function toStream(camera: BroadcastCamera): StreamTile | null {
    const liveInputUid = String(camera?.cloudflare?.liveInputUid || '').trim();
    const rawPlaybackUid = String(camera?.cloudflare?.playbackUid || '').trim();
    const playbackUid = rawPlaybackUid && rawPlaybackUid !== liveInputUid ? rawPlaybackUid : '';
    const playbackUrl = String(camera?.cloudflare?.playbackUrl || camera?.cloudflare?.webRTCPlaybackUrl || camera?.cloudflare?.rtmpsPlaybackUrl || '').trim();
    if (!playbackUid && !playbackUrl) return null;
    return {
        cameraId: camera.cameraId,
        name: camera.name || 'Live Camera',
        eventId: camera.eventId,
        playbackUid,
        playbackUrl,
        webRTCPlaybackUrl: String(camera?.cloudflare?.webRTCPlaybackUrl || '').trim() || undefined,
        rtmpsPlaybackUrl: String(camera?.cloudflare?.rtmpsPlaybackUrl || '').trim() || undefined,
        assignedLocation: camera.assignedLocation || null,
        priority: Number(camera.priority || 0),
        viewerCount: Number(camera.viewerCount || camera.cloudflare?.currentViewers || 0),
        liveSince: String(camera.lastStreamStartedAt || camera.lastConnectedAt || '').trim() || null,
        streamDurationSeconds: Number.isFinite(Number(camera.cloudflare?.durationSeconds)) ? Number(camera.cloudflare?.durationSeconds) : null,
    };
}

export default function LiveDisplayPage() {
    const [streams, setStreams] = useState<StreamTile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [featuredVideo, setFeaturedVideo] = useState<FeaturedVideo>(null);
    const playerRef = useRef<HTMLVideoElement | null>(null);
    const [diagnostics, setDiagnostics] = useState<CloudflareHlsDiagnostics | null>(null);

    useEffect(() => {
        const q = query(collection(db, 'broadcastCameras'), where('status', '==', 'live'));
        const unsub = onSnapshot(
            q,
            (snap) => {
                const next = snap.docs
                    .map((d) => ({ cameraId: d.id, ...(d.data() || {}) } as BroadcastCamera))
                    .map(toStream)
                    .filter((v): v is StreamTile => Boolean(v))
                    .sort((a, b) => a.priority - b.priority);

                setStreams(next);
                setIsLoading(false);
            },
            (err) => {
                console.error('[live] broadcast snapshot error:', err);
                setIsLoading(false);
            }
        );

        return () => unsub();
    }, []);

    useEffect(() => {
        let active = true;
        const loadFeatured = async () => {
            try {
                const res = await fetch('/api/public/videos/featured', { cache: 'no-store' });
                const data = await res.json().catch(() => null);
                if (!active || !res.ok || !data?.success) return;
                setFeaturedVideo(data?.data?.video || null);
            } catch {
                if (active) setFeaturedVideo(null);
            }
        };

        void loadFeatured();
        return () => {
            active = false;
        };
    }, []);

    const firstStream = useMemo(() => streams[0] || null, [streams]);
    const activeStreamSrc = firstStream?.playbackUid ? getPlaybackUrl(firstStream.playbackUid) : '';
    const totalViewers = useMemo(() => streams.reduce((sum, stream) => sum + Number(stream.viewerCount || 0), 0), [streams]);
    const liveSinceLabel = useMemo(() => {
        if (!firstStream?.liveSince) return null;
        const started = new Date(firstStream.liveSince);
        if (Number.isNaN(started.getTime())) return null;
        return started.toLocaleString();
    }, [firstStream?.liveSince]);

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

    if (isLoading) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-black text-white">
                <Loader2 className="h-16 w-16 animate-spin text-primary" />
            </div>
        );
    }

    if (!firstStream) {
        const featuredVideoEmbedUrl = featuredVideo?.youtubeId
            ? `https://www.youtube.com/embed/${encodeURIComponent(featuredVideo.youtubeId)}?autoplay=1&mute=1&controls=1&rel=0&modestbranding=1&playsinline=1`
            : '';
        return (
            <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
                {featuredVideoEmbedUrl ? (
                    <iframe
                        src={featuredVideoEmbedUrl}
                        title={featuredVideo?.title || 'Featured highlight'}
                        className="h-full w-full border-0 bg-black"
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                    />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center bg-black p-6 text-center text-white">
                        <Image src="/bwshop.png" alt="Bergman Logo" width={380} height={210} className="object-contain" />
                    </div>
                )}

                {!featuredVideoEmbedUrl ? null : (
                    <div className="pointer-events-none absolute left-4 bottom-4 max-w-md rounded-2xl bg-black/65 p-4 backdrop-blur-sm">
                        <div className="text-xs uppercase tracking-[0.3em] text-cyan-300">Featured Highlight</div>
                        <div className="mt-1 text-lg font-bold text-white">{featuredVideo?.title || 'Featured video'}</div>
                        <div className="mt-1 text-sm text-slate-300">{featuredVideo?.description || 'Latest featured video from the Bergman library.'}</div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
            <CloudflareHlsPlayer
                ref={playerRef}
                src={activeStreamSrc}
                title={firstStream.name}
                className="h-full w-full object-contain bg-black"
                showControls
                dvrWindowHours={4}
                showDiagnostics
                onDiagnosticsChange={setDiagnostics}
            />

            <div className="absolute right-4 top-4">
                <button
                    type="button"
                    onClick={() => void goLive()}
                    className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-400"
                >
                    Go Live
                </button>
            </div>

            <div className="pointer-events-none absolute left-4 top-4 rounded-lg bg-black/60 px-3 py-2 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-red-200">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-400" /> LIVE
                </div>
                <p className="mt-1 text-sm text-white">{firstStream.name}</p>
                {firstStream.assignedLocation ? <p className="text-xs text-slate-300">{firstStream.assignedLocation}</p> : null}
                {liveSinceLabel ? <p className="text-xs text-slate-300">Live since {liveSinceLabel}</p> : null}
                <p className="text-xs text-slate-300">Viewers {firstStream.viewerCount > 0 ? firstStream.viewerCount : '—'}</p>
                {firstStream.streamDurationSeconds ? <p className="text-xs text-slate-300">Stream length {Math.floor(firstStream.streamDurationSeconds / 60)}m {firstStream.streamDurationSeconds % 60}s</p> : null}
                {diagnostics && diagnostics.latencyMs !== null ? <p className="text-xs text-slate-300">Latency: {Math.max(0, Math.round(diagnostics.latencyMs || 0))} ms</p> : null}
            </div>

            <div className="pointer-events-none absolute right-4 bottom-4 rounded-lg bg-black/60 px-3 py-2 text-xs text-slate-300 backdrop-blur-sm">
                Total viewers {totalViewers > 0 ? totalViewers : '—'}
                {firstStream?.streamDurationSeconds ? <span className="ml-3">Duration {Math.max(0, Math.round(firstStream.streamDurationSeconds / 60))} min</span> : null}
            </div>

            {streams.length > 1 ? (
                <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg bg-black/60 px-3 py-2 text-xs text-slate-300 backdrop-blur-sm">
                    {streams.length} live cameras available
                </div>
            ) : null}
        </div>
    );
}
