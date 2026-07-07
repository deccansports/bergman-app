// src/components/admin/LiveStreamingTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useTransition } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Tv, Play, Power, RotateCcw, AlertTriangle, Copy, ExternalLink, Loader2,
    MessageSquare, Video, Radio, Star, StarOff, Trash2, RefreshCw, Plus, Settings,
} from 'lucide-react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { Textarea } from '../ui/textarea';
import Image from 'next/image';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
    getLiveStreamSettings,
    updateLiveStreamSettings,
    listLibraryVideos,
    addLibraryVideo,
    updateLibraryVideo,
    deleteLibraryVideo,
    fetchYouTubeLiveStatus,
} from '@/lib/actions/liveStreamingActions';
import { extractYouTubeId } from '@/lib/utils/youtube';
import type {
    LibraryVideo,
    LiveStreamSettings,
    VideoCategory,
    YouTubeLiveStatus,
    LiveControl,
} from '@/lib/types/liveStreaming';

const VIDEO_CATEGORIES: VideoCategory[] = ['highlight', 'race', 'training', 'interview', 'promo', 'other'];

export default function LiveStreamingTab() {
    const { toast } = useToast();

    // ─── Live screen control ─────────────────────────────────────────────
    const [currentControl, setCurrentControl] = useState<LiveControl | null>(null);
    const [isLoadingControl, setIsLoadingControl] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [youtubeUrl, setYoutubeUrl] = useState('');
    const [customMessage, setCustomMessage] = useState('');
    const [publicLink, setPublicLink] = useState('');
    const [lastKnownVideoId, setLastKnownVideoId] = useState<string | null>(null);

    // ─── YouTube settings + auto-detect ─────────────────────────────────
    const [settings, setSettings] = useState<LiveStreamSettings | null>(null);
    const [autoStatus, setAutoStatus] = useState<YouTubeLiveStatus | null>(null);
    const [isPending, startTransition] = useTransition();
    const [draftChannelId, setDraftChannelId] = useState('');
    const [draftHandle, setDraftHandle] = useState('');
    const [draftOverride, setDraftOverride] = useState('');
    const [draftPoll, setDraftPoll] = useState(60);

    // ─── Video library ───────────────────────────────────────────────────
    const [videos, setVideos] = useState<LibraryVideo[]>([]);
    const [isLoadingVideos, setIsLoadingVideos] = useState(true);
    const [newVideoUrl, setNewVideoUrl] = useState('');
    const [newVideoTitle, setNewVideoTitle] = useState('');
    const [newVideoDesc, setNewVideoDesc] = useState('');
    const [newVideoCategory, setNewVideoCategory] = useState<VideoCategory>('highlight');
    const [newVideoFeatured, setNewVideoFeatured] = useState(false);

    useEffect(() => {
        setPublicLink(`${window.location.origin}/live`);
    }, []);

    useEffect(() => {
        const controlDocRef = doc(db, 'liveControl', 'current');
        const unsubscribe = onSnapshot(controlDocRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data() as LiveControl;
                setCurrentControl(data);
                if (data.youtubeVideoId) setLastKnownVideoId(data.youtubeVideoId);
            } else {
                setCurrentControl(null);
            }
            setIsLoadingControl(false);
        });
        return () => unsubscribe();
    }, []);

    const reloadSettings = useCallback(async () => {
        const s = await getLiveStreamSettings();
        setSettings(s);
        setDraftChannelId(s.channelId || '');
        setDraftHandle(s.channelHandle || '');
        setDraftOverride(s.manualOverrideVideoId || '');
        setDraftPoll(s.pollIntervalSeconds || 60);
    }, []);

    const reloadVideos = useCallback(async () => {
        setIsLoadingVideos(true);
        try {
            const list = await listLibraryVideos();
            setVideos(list);
        } finally {
            setIsLoadingVideos(false);
        }
    }, []);

    const refreshAutoStatus = useCallback(async (force = false) => {
        try {
            const s = await fetchYouTubeLiveStatus({ force });
            setAutoStatus(s);
        } catch (e: any) {
            console.warn('[LiveStreamingTab] auto-status failed:', e?.message);
        }
    }, []);

    useEffect(() => {
        reloadSettings();
        reloadVideos();
        refreshAutoStatus();
    }, [reloadSettings, reloadVideos, refreshAutoStatus]);

    // ─── Live screen actions ────────────────────────────────────────────
    const updateLiveScreen = async (
        payload: Partial<Omit<LiveControl, 'updatedAt'>>,
        successMessage?: string
    ) => {
        setIsSaving(true);
        try {
            const controlDocRef = doc(db, 'liveControl', 'current');
            const updatePayload: LiveControl = {
                activeFeedType: payload.activeFeedType ?? currentControl?.activeFeedType ?? 'black',
                youtubeVideoId: payload.youtubeVideoId !== undefined ? payload.youtubeVideoId : currentControl?.youtubeVideoId ?? null,
                message: payload.message !== undefined ? payload.message : currentControl?.message ?? null,
                source: payload.source ?? 'manual',
                updatedAt: new Date().toISOString(),
            };
            await setDoc(controlDocRef, updatePayload);
            toast({
                title: 'Live screen updated',
                description: successMessage || `Now showing: ${updatePayload.activeFeedType.toUpperCase()}`,
            });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Update failed', description: error?.message });
        } finally {
            setIsSaving(false);
        }
    };

    const handleShowVideo = () => {
        const videoId = extractYouTubeId(youtubeUrl);
        if (!videoId) {
            toast({ variant: 'destructive', title: 'Invalid URL', description: 'Could not find a valid YouTube Video ID.' });
            return;
        }
        updateLiveScreen({ activeFeedType: 'youtube', youtubeVideoId: videoId, source: 'manual' });
    };

    const handleShowMessage = () => {
        if (!customMessage.trim()) {
            toast({ variant: 'destructive', title: 'Invalid Message', description: 'Custom message cannot be empty.' });
            return;
        }
        updateLiveScreen({ activeFeedType: 'message', message: customMessage.trim(), youtubeVideoId: null, source: 'manual' });
    };

    const handleBlackScreen = () =>
        updateLiveScreen({ activeFeedType: 'black', youtubeVideoId: null, message: null, source: 'manual' });

    const handleRestoreLast = () => {
        if (lastKnownVideoId) {
            updateLiveScreen({ activeFeedType: 'youtube', youtubeVideoId: lastKnownVideoId, source: 'manual' });
        } else {
            toast({ description: 'No previous video feed to restore.' });
        }
    };

    const handlePushAutoToScreen = () => {
        if (!autoStatus?.videoId) {
            toast({ variant: 'destructive', title: 'No live video detected' });
            return;
        }
        updateLiveScreen(
            { activeFeedType: 'youtube', youtubeVideoId: autoStatus.videoId, source: 'auto-detect' },
            `Pushed auto-detected stream: ${autoStatus.title || autoStatus.videoId}`
        );
    };

    // ─── Settings actions ──────────────────────────────────────────────
    const handleSaveSettings = (autoToggle?: boolean) =>
        startTransition(async () => {
            const payload: Partial<LiveStreamSettings> = {
                channelId: draftChannelId,
                channelHandle: draftHandle,
                manualOverrideVideoId: draftOverride,
                pollIntervalSeconds: Number(draftPoll) || 60,
            };
            if (typeof autoToggle === 'boolean') payload.autoDetectEnabled = autoToggle;
            const res = await updateLiveStreamSettings(payload);
            if (res.success) {
                toast({ title: 'Settings saved' });
                if (res.settings) setSettings(res.settings);
                refreshAutoStatus(true);
            } else {
                toast({ variant: 'destructive', title: 'Save failed', description: res.message });
            }
        });

    const handleToggleAutoDetect = (next: boolean) =>
        startTransition(async () => {
            const res = await updateLiveStreamSettings({ autoDetectEnabled: next });
            if (res.success && res.settings) {
                setSettings(res.settings);
                toast({ title: `Auto-detect ${next ? 'enabled' : 'disabled'}` });
                refreshAutoStatus(true);
            } else {
                toast({ variant: 'destructive', title: 'Toggle failed', description: res.message });
            }
        });

    // ─── Library actions ──────────────────────────────────────────────
    const handleAddVideo = () =>
        startTransition(async () => {
            const res = await addLibraryVideo({
                youtubeUrlOrId: newVideoUrl,
                title: newVideoTitle,
                description: newVideoDesc,
                category: newVideoCategory,
                isFeatured: newVideoFeatured,
            });
            if (res.success) {
                toast({ title: 'Video added' });
                setNewVideoUrl('');
                setNewVideoTitle('');
                setNewVideoDesc('');
                setNewVideoFeatured(false);
                reloadVideos();
            } else {
                toast({ variant: 'destructive', title: 'Add failed', description: res.message });
            }
        });

    const handleToggleFeatured = (v: LibraryVideo) =>
        startTransition(async () => {
            const res = await updateLibraryVideo(v.id, { isFeatured: !v.isFeatured });
            if (res.success) {
                toast({ title: v.isFeatured ? 'Unfeatured' : 'Marked as featured' });
                reloadVideos();
            } else {
                toast({ variant: 'destructive', title: 'Update failed', description: res.message });
            }
        });

    const handleDeleteVideo = (v: LibraryVideo) =>
        startTransition(async () => {
            if (!confirm(`Delete "${v.title}"? This cannot be undone.`)) return;
            const res = await deleteLibraryVideo(v.id);
            if (res.success) {
                toast({ title: 'Video removed' });
                reloadVideos();
            } else {
                toast({ variant: 'destructive', title: 'Delete failed', description: res.message });
            }
        });

    const handlePushVideoToScreen = (v: LibraryVideo) =>
        updateLiveScreen({ activeFeedType: 'youtube', youtubeVideoId: v.youtubeId, source: 'manual' }, `Now showing: ${v.title}`);

    const copyToClipboard = (text: string) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        toast({ title: 'Link copied!' });
    };

    return (
        <div className="space-y-6">
            {/* ─── Row 1: Stream control + Live preview ─────────────────────────── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-1">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-primary" />Stream Control</CardTitle>
                            <CardDescription>Push any YouTube video to the public big screen.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="youtube-url">YouTube URL or Video ID</Label>
                                <Input id="youtube-url" value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/live/... or 11-char ID" />
                            </div>
                            <Button onClick={handleShowVideo} disabled={isSaving || !youtubeUrl} className="w-full">
                                {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Play className="mr-2 h-4 w-4" />}
                                Show on Screen
                            </Button>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" />Custom Message</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Textarea value={customMessage} onChange={(e) => setCustomMessage(e.target.value)} placeholder="e.g., Race paused due to weather. Updates to follow." />
                            <Button onClick={handleShowMessage} disabled={isSaving || !customMessage} className="w-full" variant="secondary">Display Message</Button>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />Emergency Controls</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <Button className="w-full bg-destructive hover:bg-destructive/90" onClick={handleBlackScreen} disabled={isSaving}>
                                <Power className="h-4 w-4 mr-2" /> BLACK SCREEN
                            </Button>
                            <Button className="w-full" variant="outline" onClick={handleRestoreLast} disabled={isSaving}>
                                <RotateCcw className="h-4 w-4 mr-2" /> RESTORE LAST FEED
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                <div className="lg:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><Tv className="h-5 w-5 text-primary" />Live Screen Preview</CardTitle>
                            <CardDescription>What viewers see at <code className="px-1 bg-muted rounded">/live</code>. Updates automatically.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="relative aspect-video bg-black rounded-lg overflow-hidden border">
                                {isLoadingControl ? (
                                    <Loader2 className="animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                                ) : currentControl?.activeFeedType === 'youtube' && currentControl.youtubeVideoId ? (
                                    <iframe
                                        src={`https://www.youtube.com/embed/${currentControl.youtubeVideoId}?autoplay=1&mute=1&controls=0`}
                                        allow="autoplay; encrypted-media"
                                        allowFullScreen
                                        className="w-full h-full"
                                    />
                                ) : currentControl?.activeFeedType === 'message' && currentControl.message ? (
                                    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 p-4 text-center">
                                        <h2 className="text-3xl font-bold text-yellow-400">{currentControl.message}</h2>
                                    </div>
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center bg-black p-4 text-center">
                                        <Image src="/Bmlogowhite.png" alt="Bergman Logo" width={200} height={66} className="h-auto w-auto object-contain" style={{ width: 'auto', height: 'auto' }} />
                                        <p className="text-slate-400 mt-4 text-lg">LIVE SCREEN STANDBY</p>
                                    </div>
                                )}
                            </div>
                            <div className="mt-4 space-y-2">
                                <Label>Public Live Screen URL</Label>
                                <div className="flex gap-2">
                                    <Input readOnly value={publicLink} />
                                    <Button variant="outline" onClick={() => copyToClipboard(publicLink)}><Copy className="h-4 w-4" /></Button>
                                    <Button asChild><Link href={publicLink} target="_blank"><ExternalLink className="h-4 w-4" /></Link></Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* ─── Row 2: YouTube auto-detect ──────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Radio className="h-5 w-5 text-red-500" />YouTube Channel Auto-Detect</CardTitle>
                    <CardDescription>
                        Automatically detect when your channel goes live. Polled every <strong>{settings?.pollIntervalSeconds ?? 60}s</strong> with a KV cache to protect your YouTube API quota.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    {!settings?.apiKeyConfigured && (
                        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <span><code>YOUTUBE_API_KEY</code> is not set on the server. Auto-detect will not work until it is added.</span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="channel-id">YouTube Channel ID</Label>
                            <Input id="channel-id" value={draftChannelId} onChange={(e) => setDraftChannelId(e.target.value)} placeholder="UCxxxxxxxxxxxxxxxxxx" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="channel-handle">Channel Handle (optional)</Label>
                            <Input id="channel-handle" value={draftHandle} onChange={(e) => setDraftHandle(e.target.value)} placeholder="@bergmantri" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="manual-override">Manual Override Video ID</Label>
                            <Input id="manual-override" value={draftOverride} onChange={(e) => setDraftOverride(e.target.value)} placeholder="Pin a specific live video (optional)" />
                            <p className="text-[11px] text-muted-foreground">If set, this overrides the auto-detected channel stream.</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="poll-interval">Poll interval (seconds)</Label>
                            <Input id="poll-interval" type="number" min={15} max={600} value={draftPoll} onChange={(e) => setDraftPoll(Number(e.target.value) || 60)} />
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
                        <div className="flex items-center gap-3">
                            <Switch checked={!!settings?.autoDetectEnabled} onCheckedChange={handleToggleAutoDetect} disabled={isPending} />
                            <div>
                                <p className="text-sm font-semibold">Auto-detect channel live status</p>
                                <p className="text-xs text-muted-foreground">When ON, /live falls back to the channel&apos;s current live video.</p>
                            </div>
                        </div>
                        <Button onClick={() => handleSaveSettings()} disabled={isPending}>
                            {isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Settings className="mr-2 h-4 w-4" />}
                            Save Settings
                        </Button>
                    </div>

                    <Separator />

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="rounded-lg border p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold">Current detection status</p>
                                <Button size="xs" variant="outline" onClick={() => refreshAutoStatus(true)}>
                                    <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                                </Button>
                            </div>
                            <div className="mt-3 space-y-1 text-sm">
                                <p>
                                    <span className="text-muted-foreground">State: </span>
                                    {autoStatus?.isLive ? (
                                        <Badge className="bg-red-500 hover:bg-red-500">🔴 LIVE</Badge>
                                    ) : (
                                        <Badge variant="secondary">Offline</Badge>
                                    )}
                                </p>
                                {autoStatus?.title && <p><span className="text-muted-foreground">Title:</span> {autoStatus.title}</p>}
                                {autoStatus?.videoId && <p className="font-mono text-[11px]">{autoStatus.videoId}</p>}
                                {autoStatus?.source && <p className="text-[11px] text-muted-foreground">Source: {autoStatus.source}</p>}
                                {autoStatus?.error && <p className="text-[11px] text-destructive">{autoStatus.error}</p>}
                            </div>
                            {autoStatus?.isLive && autoStatus.videoId && (
                                <Button size="sm" className="mt-3 w-full" onClick={handlePushAutoToScreen}>
                                    <Play className="mr-2 h-3 w-3" /> Push to Live Screen
                                </Button>
                            )}
                        </div>

                        <div className="rounded-lg border p-4">
                            <p className="text-sm font-semibold mb-2">Auto-detect preview</p>
                            <div className="aspect-video w-full overflow-hidden rounded bg-black">
                                {autoStatus?.videoId ? (
                                    <iframe
                                        src={`https://www.youtube.com/embed/${autoStatus.videoId}?autoplay=0&mute=1`}
                                        allow="autoplay; encrypted-media"
                                        allowFullScreen
                                        className="h-full w-full"
                                    />
                                ) : (
                                    <div className="flex h-full items-center justify-center text-xs text-slate-500">No live stream detected</div>
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ─── Row 3: Video library ──────────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-primary" />Video Library</CardTitle>
                    <CardDescription>
                        Add YouTube videos that show on the public <Link className="underline" href="/videos" target="_blank">/videos</Link> page. Featured videos appear first.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/40 p-4 md:grid-cols-12">
                        <div className="space-y-1 md:col-span-4">
                            <Label htmlFor="new-video-url">YouTube URL / ID</Label>
                            <Input id="new-video-url" value={newVideoUrl} onChange={(e) => setNewVideoUrl(e.target.value)} placeholder="https://youtu.be/..." />
                        </div>
                        <div className="space-y-1 md:col-span-3">
                            <Label htmlFor="new-video-title">Title</Label>
                            <Input id="new-video-title" value={newVideoTitle} onChange={(e) => setNewVideoTitle(e.target.value)} placeholder="e.g., Ironman 2026 Highlights" />
                        </div>
                        <div className="space-y-1 md:col-span-3">
                            <Label htmlFor="new-video-desc">Description (optional)</Label>
                            <Input id="new-video-desc" value={newVideoDesc} onChange={(e) => setNewVideoDesc(e.target.value)} placeholder="Short caption" />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                            <Label>Category</Label>
                            <Select value={newVideoCategory} onValueChange={(v) => setNewVideoCategory(v as VideoCategory)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {VIDEO_CATEGORIES.map((c) => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="md:col-span-12 flex flex-wrap items-center gap-3">
                            <label className="flex items-center gap-2 text-sm">
                                <Switch checked={newVideoFeatured} onCheckedChange={setNewVideoFeatured} />
                                Mark as featured
                            </label>
                            <Button onClick={handleAddVideo} disabled={isPending || !newVideoUrl || !newVideoTitle} className="ml-auto">
                                {isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                                Add Video
                            </Button>
                        </div>
                    </div>

                    {isLoadingVideos ? (
                        <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : videos.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">No videos yet. Add one above.</p>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {videos.map((v) => (
                                <div key={v.id} className="overflow-hidden rounded-lg border bg-card">
                                    <div className="relative aspect-video w-full bg-black">
                                        {v.thumbnailUrl && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={v.thumbnailUrl} alt={v.title} className="h-full w-full object-cover" />
                                        )}
                                        {v.isFeatured && (
                                            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-yellow-500 px-2 py-0.5 text-[10px] font-bold uppercase text-black">
                                                <Star className="h-3 w-3" /> Featured
                                            </span>
                                        )}
                                        <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                                            {v.category}
                                        </span>
                                    </div>
                                    <div className="space-y-2 p-3">
                                        <p className="line-clamp-2 text-sm font-semibold" title={v.title}>{v.title}</p>
                                        <p className="font-mono text-[10px] text-muted-foreground">{v.youtubeId}</p>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <Button size="xs" variant="outline" onClick={() => handlePushVideoToScreen(v)}>
                                                <Play className="h-3 w-3 mr-1" /> Push
                                            </Button>
                                            <Button size="xs" variant="outline" onClick={() => handleToggleFeatured(v)} disabled={isPending}>
                                                {v.isFeatured ? <StarOff className="h-3 w-3" /> : <Star className="h-3 w-3" />}
                                            </Button>
                                            <Button size="xs" variant="outline" asChild>
                                                <Link href={`https://youtu.be/${v.youtubeId}`} target="_blank"><ExternalLink className="h-3 w-3" /></Link>
                                            </Button>
                                            <Button size="xs" variant="outline" className="ml-auto text-destructive hover:bg-destructive/10" onClick={() => handleDeleteVideo(v)} disabled={isPending}>
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
