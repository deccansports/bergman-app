"use client";

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Image from 'next/image';
import { ExternalLink, Loader2, RefreshCw, Search, Star, StarOff, Trash2, Video } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  addLibraryVideo,
  bulkDeleteLibraryVideos,
  deleteFilteredLibraryVideos,
  deleteLibraryVideo,
  listLibraryVideos,
  updateLibraryVideo,
} from '@/lib/actions/videoLibraryActions';
import { authenticatedFetch } from '@/lib/api/authenticatedFetch';
import type { LibraryVideo, VideoCategory } from '@/lib/types/videoLibrary';

type CloudflareStreamVideo = {
  uid: string;
  title: string;
  status: string;
  duration: number;
  thumbnail: string | null;
  preview: string | null;
  hlsUrl: string | null;
  dashUrl: string | null;
  created: string;
  uploaded: string | null;
  modified: string | null;
  creator: string | null;
  liveInputId: string | null;
  readyToStream: boolean;
  requireSignedURLs: boolean;
  size: number;
};

const VIDEO_CATEGORIES: Array<'all' | VideoCategory> = ['all', 'highlight', 'race', 'training', 'interview', 'promo', 'other'];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export default function VideoLibraryTab() {
  const { toast } = useToast();
  const { firebaseUserFromAuth } = useAuth();
  const [isPending, startTransition] = useTransition();
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<'all' | VideoCategory>('all');
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [cleanupDays, setCleanupDays] = useState(30);

  const [cloudflareVideos, setCloudflareVideos] = useState<CloudflareStreamVideo[]>([]);
  const [cloudflareSelectedIds, setCloudflareSelectedIds] = useState<string[]>([]);
  const [cloudflareSelectedUid, setCloudflareSelectedUid] = useState<string | null>(null);
  const [cloudflareSearch, setCloudflareSearch] = useState('');
  const [isLoadingCloudflare, setIsLoadingCloudflare] = useState(false);

  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [newVideoTitle, setNewVideoTitle] = useState('');
  const [newVideoDescription, setNewVideoDescription] = useState('');
  const [newVideoCategory, setNewVideoCategory] = useState<VideoCategory>('highlight');
  const [newVideoFeatured, setNewVideoFeatured] = useState(false);

  const loadVideos = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listLibraryVideos({
        featuredOnly: featuredOnly || undefined,
        category: filterCategory === 'all' ? undefined : filterCategory,
      });
      setVideos(list);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to load videos', description: error?.message });
    } finally {
      setIsLoading(false);
    }
  }, [featuredOnly, filterCategory, toast]);

  const loadCloudflareVideos = useCallback(async () => {
    if (!firebaseUserFromAuth) {
      setCloudflareVideos([]);
      setIsLoadingCloudflare(false);
      return;
    }

    setIsLoadingCloudflare(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '1000');
      if (cloudflareSearch.trim()) params.set('search', cloudflareSearch.trim());

      const res = await authenticatedFetch(`/api/broadcast/videos?${params.toString()}`, { cache: 'no-store' }, firebaseUserFromAuth);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error?.message || 'Failed to load Cloudflare videos');
      }

      const list = Array.isArray(data?.data?.videos) ? data.data.videos : [];
      setCloudflareVideos(list);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Cloudflare load failed', description: error?.message });
    } finally {
      setIsLoadingCloudflare(false);
    }
  }, [cloudflareSearch, firebaseUserFromAuth, toast]);

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  useEffect(() => {
    void loadCloudflareVideos();
  }, [loadCloudflareVideos]);

  const filteredVideos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return videos.filter((video) => {
      if (!q) return true;
      return [video.title, video.description || '', video.youtubeId, video.category].join(' ').toLowerCase().includes(q);
    });
  }, [search, videos]);

  const selectedVideo = useMemo(() => videos.find((video) => video.id === selectedVideoId) || filteredVideos[0] || null, [filteredVideos, selectedVideoId, videos]);

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const selectAllVisible = () => {
    setSelectedIds(filteredVideos.map((video) => video.id));
  };

  const clearSelection = () => setSelectedIds([]);

  const toggleCloudflareSelection = (uid: string) => {
    setCloudflareSelectedIds((current) => (current.includes(uid) ? current.filter((item) => item !== uid) : [...current, uid]));
  };

  const selectAllCloudflareVisible = () => {
    setCloudflareSelectedIds(cloudflareVideos.map((video) => video.uid));
  };

  const clearCloudflareSelection = () => setCloudflareSelectedIds([]);

  const handleAddVideo = () => {
    startTransition(async () => {
      const res = await addLibraryVideo({
        youtubeUrlOrId: newVideoUrl,
        title: newVideoTitle,
        description: newVideoDescription,
        category: newVideoCategory,
        isFeatured: newVideoFeatured,
      });
      if (res.success) {
        toast({ title: 'Video added', description: res.message });
        setNewVideoUrl('');
        setNewVideoTitle('');
        setNewVideoDescription('');
        setNewVideoFeatured(false);
        await loadVideos();
      } else {
        toast({ variant: 'destructive', title: 'Add failed', description: res.message });
      }
    });
  };

  const handleToggleFeatured = (video: LibraryVideo) => {
    startTransition(async () => {
      const res = await updateLibraryVideo(video.id, { isFeatured: !video.isFeatured });
      if (res.success) {
        toast({ title: video.isFeatured ? 'Removed from featured' : 'Marked as featured' });
        await loadVideos();
      } else {
        toast({ variant: 'destructive', title: 'Update failed', description: res.message });
      }
    });
  };

  const handleDeleteVideo = (video: LibraryVideo) => {
    startTransition(async () => {
      const ok = window.confirm(`Delete "${video.title}"? This cannot be undone.`);
      if (!ok) return;
      const res = await deleteLibraryVideo(video.id);
      if (res.success) {
        toast({ title: 'Video deleted' });
        setSelectedIds((current) => current.filter((id) => id !== video.id));
        await loadVideos();
      } else {
        toast({ variant: 'destructive', title: 'Delete failed', description: res.message });
      }
    });
  };

  const handleDeleteFromCloudflare = (video: LibraryVideo) => {
    startTransition(async () => {
      const videoUid = String(video.cloudflareVideoUid || '').trim();
      if (!videoUid) {
        toast({ variant: 'destructive', title: 'No Cloudflare video UID', description: 'This item is not linked to a Cloudflare recording.' });
        return;
      }

      const ok = window.confirm(`Delete Cloudflare video ${videoUid}? This cannot be undone.`);
      if (!ok) return;

      try {
        const res = await authenticatedFetch('/api/broadcast/videos', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoUid,
            eventId: video.eventId,
            cameraId: video.cameraId,
          }),
        }, firebaseUserFromAuth);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          throw new Error(data?.error?.message || 'Unable to delete Cloudflare video');
        }

        toast({ title: 'Cloudflare video deleted', description: videoUid });
        await loadVideos();
      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Cloudflare delete failed', description: error?.message || 'Unknown error' });
      }
    });
  };

  const handleDeleteCloudflareVideo = (video: CloudflareStreamVideo) => {
    startTransition(async () => {
      const ok = window.confirm(`Delete Cloudflare video ${video.uid}? This cannot be undone.`);
      if (!ok) return;

      try {
        const res = await authenticatedFetch('/api/broadcast/videos', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUid: video.uid }),
        }, firebaseUserFromAuth);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          throw new Error(data?.error?.message || 'Unable to delete Cloudflare video');
        }

        toast({ title: 'Cloudflare video deleted', description: video.uid });
        setCloudflareSelectedIds((current) => current.filter((uid) => uid !== video.uid));
        if (cloudflareSelectedUid === video.uid) setCloudflareSelectedUid(null);
        await loadCloudflareVideos();
      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Cloudflare delete failed', description: error?.message || 'Unknown error' });
      }
    });
  };

  const handleBulkDeleteCloudflare = () => {
    startTransition(async () => {
      if (cloudflareSelectedIds.length === 0) return;
      const ok = window.confirm(`Delete ${cloudflareSelectedIds.length} Cloudflare video${cloudflareSelectedIds.length === 1 ? '' : 's'}?`);
      if (!ok) return;

      let deleted = 0;
      for (const uid of cloudflareSelectedIds) {
        const res = await authenticatedFetch('/api/broadcast/videos', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUid: uid }),
        }, firebaseUserFromAuth);
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) deleted += 1;
      }

      toast({ title: 'Cloudflare cleanup complete', description: `Deleted ${deleted} video${deleted === 1 ? '' : 's'}.` });
      clearCloudflareSelection();
      setCloudflareSelectedUid(null);
      await loadCloudflareVideos();
    });
  };

  const handleBulkDelete = () => {
    startTransition(async () => {
      if (selectedIds.length === 0) return;
      const ok = window.confirm(`Delete ${selectedIds.length} selected video${selectedIds.length === 1 ? '' : 's'}?`);
      if (!ok) return;
      const res = await bulkDeleteLibraryVideos(selectedIds);
      if (res.success) {
        toast({ title: 'Bulk delete complete', description: res.message });
        clearSelection();
        await loadVideos();
      } else {
        toast({ variant: 'destructive', title: 'Bulk delete failed', description: res.message });
      }
    });
  };

  const handleDeleteFiltered = () => {
    startTransition(async () => {
      const ok = window.confirm('Delete all videos matching the current filters?');
      if (!ok) return;
      const res = await deleteFilteredLibraryVideos({
        featuredOnly: featuredOnly || undefined,
        category: filterCategory,
      });
      if (res.success) {
        toast({ title: 'Filtered delete complete', description: res.message });
        clearSelection();
        await loadVideos();
      } else {
        toast({ variant: 'destructive', title: 'Filtered delete failed', description: res.message });
      }
    });
  };

  const handleCleanup = () => {
    startTransition(async () => {
      const ok = window.confirm(`Delete unfeatured videos older than ${cleanupDays} days?`);
      if (!ok) return;
      const res = await deleteFilteredLibraryVideos({
        keepFeatured: true,
        olderThanDays: cleanupDays,
      });
      if (res.success) {
        toast({ title: 'Cleanup complete', description: res.message });
        await loadVideos();
      } else {
        toast({ variant: 'destructive', title: 'Cleanup failed', description: res.message });
      }
    });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-primary" />Cloudflare Stream Library</CardTitle>
            <CardDescription>Fetch videos directly from the Cloudflare account, select items, and delete selected videos from Stream.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" value={cloudflareSearch} onChange={(e) => setCloudflareSearch(e.target.value)} placeholder="Search Cloudflare videos by title or UID..." />
              </div>
              <Button variant="outline" onClick={() => void loadCloudflareVideos()} disabled={isLoadingCloudflare}>
                <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingCloudflare ? 'animate-spin' : ''}`} />Refresh Cloudflare
              </Button>
              <Button variant="outline" onClick={selectAllCloudflareVisible} disabled={cloudflareVideos.length === 0}>Select all</Button>
              <Button variant="outline" onClick={clearCloudflareSelection} disabled={cloudflareSelectedIds.length === 0}>Clear selection</Button>
              <Button variant="destructive" onClick={handleBulkDeleteCloudflare} disabled={cloudflareSelectedIds.length === 0 || isPending}>
                <Trash2 className="mr-2 h-4 w-4" />Delete selected
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span>{cloudflareVideos.length} loaded</span>
              <span>{cloudflareSelectedIds.length} selected</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoadingCloudflare ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : cloudflareVideos.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">No Cloudflare videos loaded.</div>
            ) : (
              <div className="max-h-[430px] overflow-y-auto overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b bg-muted/95 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                    <tr>
                      <th className="px-4 py-3"><input type="checkbox" checked={cloudflareSelectedIds.length > 0 && cloudflareSelectedIds.length === cloudflareVideos.length} onChange={(e) => (e.target.checked ? selectAllCloudflareVisible() : clearCloudflareSelection())} /></th>
                      <th className="px-4 py-3">Video</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cloudflareVideos.map((video) => {
                      const isSelected = cloudflareSelectedIds.includes(video.uid);
                      const isActive = cloudflareSelectedUid === video.uid;
                      return (
                        <tr key={video.uid} className={`${isActive ? 'bg-primary/5' : ''} border-b last:border-0`}>
                          <td className="px-4 py-3 align-top">
                            <input type="checkbox" checked={isSelected} onChange={() => toggleCloudflareSelection(video.uid)} />
                          </td>
                          <td className="px-4 py-3 align-top">
                            <button type="button" className="flex items-center gap-3 text-left" onClick={() => setCloudflareSelectedUid(video.uid)}>
                              <div className="relative h-16 w-28 overflow-hidden rounded-lg border bg-black">
                                {video.thumbnail ? <Image src={video.thumbnail} alt={video.title} fill className="object-cover" unoptimized /> : null}
                              </div>
                              <div className="space-y-1">
                                <div className="font-semibold line-clamp-2">{video.title}</div>
                                <div className="font-mono text-[11px] text-muted-foreground">{video.uid}</div>
                              </div>
                            </button>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex flex-wrap gap-2">
                              <Badge variant={video.readyToStream ? 'default' : 'secondary'}>{video.status}</Badge>
                              {video.requireSignedURLs ? <Badge variant="outline">Signed URLs</Badge> : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top">{formatDate(video.created)}</td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => setCloudflareSelectedUid(video.uid)}>Select</Button>
                              <Button size="sm" variant="outline" asChild>
                                <a href={video.preview || video.hlsUrl || '#'} target="_blank" rel="noreferrer">
                                  <ExternalLink className="mr-2 h-4 w-4" />Open
                                </a>
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => handleDeleteCloudflareVideo(video)}>
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-primary" />Video Library</CardTitle>
            <CardDescription>Manage published recordings with search, selection, bulk delete, filtered delete, and automatic cleanup.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-12">
              <div className="space-y-1 lg:col-span-4">
                <Label>YouTube URL / ID</Label>
                <Input value={newVideoUrl} onChange={(e) => setNewVideoUrl(e.target.value)} placeholder="https://youtu.be/..." />
              </div>
              <div className="space-y-1 lg:col-span-3">
                <Label>Title</Label>
                <Input value={newVideoTitle} onChange={(e) => setNewVideoTitle(e.target.value)} placeholder="Race highlight reel" />
              </div>
              <div className="space-y-1 lg:col-span-3">
                <Label>Description</Label>
                <Input value={newVideoDescription} onChange={(e) => setNewVideoDescription(e.target.value)} placeholder="Short description" />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <Label>Category</Label>
                <Select value={newVideoCategory} onValueChange={(value) => setNewVideoCategory(value as VideoCategory)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VIDEO_CATEGORIES.filter((value): value is VideoCategory => value !== 'all').map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="lg:col-span-12 flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={newVideoFeatured} onChange={(e) => setNewVideoFeatured(e.target.checked)} />
                  Featured
                </label>
                <Button onClick={handleAddVideo} disabled={isPending || !newVideoUrl || !newVideoTitle}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Add Video
                </Button>
                <Button variant="outline" onClick={() => void loadVideos()} disabled={isLoading}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />Refresh
                </Button>
              </div>
            </div>

            <Separator />

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, ID, description..." />
              </div>
              <Select value={filterCategory} onValueChange={(value) => setFilterCategory(value as 'all' | VideoCategory)}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  {VIDEO_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>{category === 'all' ? 'All categories' : category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant={featuredOnly ? 'default' : 'outline'} onClick={() => setFeaturedOnly((current) => !current)}>
                <Star className="mr-2 h-4 w-4" />{featuredOnly ? 'Featured only' : 'All videos'}
              </Button>
              <Button variant="outline" onClick={selectAllVisible} disabled={filteredVideos.length === 0}>Select all</Button>
              <Button variant="outline" onClick={clearSelection} disabled={selectedIds.length === 0}>Clear selection</Button>
              <Button variant="destructive" onClick={handleBulkDelete} disabled={selectedIds.length === 0 || isPending}>
                <Trash2 className="mr-2 h-4 w-4" />Delete selected
              </Button>
              <Button variant="destructive" onClick={handleDeleteFiltered} disabled={filteredVideos.length === 0 || isPending}>
                <Trash2 className="mr-2 h-4 w-4" />Delete filtered
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span>{filteredVideos.length} shown</span>
              <span>{selectedIds.length} selected</span>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-muted-foreground">Auto cleanup</span>
                <Input type="number" min={7} max={3650} value={cleanupDays} onChange={(e) => setCleanupDays(Number(e.target.value) || 30)} className="w-24" />
                <Button variant="outline" onClick={handleCleanup} disabled={isPending}>Run cleanup</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : filteredVideos.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">No videos match the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3"><input type="checkbox" checked={selectedIds.length > 0 && selectedIds.length === filteredVideos.length} onChange={(e) => (e.target.checked ? selectAllVisible() : clearSelection())} /></th>
                      <th className="px-4 py-3">Video</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Added</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVideos.map((video) => {
                      const isSelected = selectedIds.includes(video.id);
                      const isActive = selectedVideo?.id === video.id;
                      return (
                        <tr key={video.id} className={`${isActive ? 'bg-primary/5' : ''} border-b last:border-0`}>
                          <td className="px-4 py-3 align-top">
                            <input type="checkbox" checked={isSelected} onChange={() => toggleSelection(video.id)} />
                          </td>
                          <td className="px-4 py-3 align-top">
                            <button type="button" className="flex items-center gap-3 text-left" onClick={() => setSelectedVideoId(video.id)}>
                              <div className="relative h-16 w-28 overflow-hidden rounded-lg border bg-black">
                                {video.thumbnailUrl ? <Image src={video.thumbnailUrl} alt={video.title} fill className="object-cover" unoptimized /> : null}
                              </div>
                              <div className="space-y-1">
                                <div className="font-semibold line-clamp-2">{video.title}</div>
                                <div className="font-mono text-[11px] text-muted-foreground">{video.youtubeId}</div>
                              </div>
                            </button>
                          </td>
                          <td className="px-4 py-3 align-top capitalize">{video.category}</td>
                          <td className="px-4 py-3 align-top">{formatDate(video.addedAt)}</td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex flex-wrap gap-2">
                              {video.isFeatured ? <Badge className="bg-yellow-500 text-black hover:bg-yellow-500"><Star className="mr-1 h-3 w-3" />Featured</Badge> : <Badge variant="secondary">Standard</Badge>}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => handleToggleFeatured(video)}>
                                {video.isFeatured ? <StarOff className="mr-2 h-4 w-4" /> : <Star className="mr-2 h-4 w-4" />}
                                {video.isFeatured ? 'Unfeature' : 'Feature'}
                              </Button>
                              <Button size="sm" variant="outline" asChild>
                                <a href={`https://youtu.be/${video.youtubeId}`} target="_blank" rel="noreferrer">
                                  <ExternalLink className="mr-2 h-4 w-4" />Open
                                </a>
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => handleDeleteVideo(video)}>
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 h-fit">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Selected Cloudflare video</CardTitle>
            <CardDescription>Details for the video selected from the Cloudflare account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {cloudflareSelectedUid ? (() => {
              const selected = cloudflareVideos.find((video) => video.uid === cloudflareSelectedUid) || null;
              if (!selected) {
                return <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">Select a Cloudflare video to inspect details.</div>;
              }
              return (
                <>
                  <div className="relative aspect-video overflow-hidden rounded-xl border bg-black">
                    {selected.thumbnail ? <Image src={selected.thumbnail} alt={selected.title} fill className="object-cover" unoptimized /> : null}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="font-semibold">{selected.title}</div>
                    <div className="text-muted-foreground">{selected.status}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">UID: {selected.uid}</div>
                    <div className="text-xs text-muted-foreground">Created {formatDate(selected.created)} • Duration {selected.duration ? `${selected.duration}s` : '—'}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <a href={selected.preview || selected.hlsUrl || '#'} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" />Open source
                      </a>
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDeleteCloudflareVideo(selected)}>
                      <Trash2 className="mr-2 h-4 w-4" />Delete from Cloudflare
                    </Button>
                  </div>
                </>
              );
            })() : (
              <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">Select a Cloudflare video to inspect details.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Selected video</CardTitle>
            <CardDescription>Preview and metadata for the currently highlighted item.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedVideo ? (
              <>
                <div className="relative aspect-video overflow-hidden rounded-xl border bg-black">
                  {selectedVideo.thumbnailUrl ? <Image src={selectedVideo.thumbnailUrl} alt={selectedVideo.title} fill className="object-cover" unoptimized /> : null}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="font-semibold">{selectedVideo.title}</div>
                  <div className="text-muted-foreground">{selectedVideo.description || 'No description available.'}</div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{selectedVideo.category}</Badge>
                    {selectedVideo.isFeatured ? <Badge className="bg-yellow-500 text-black hover:bg-yellow-500">Featured</Badge> : <Badge variant="outline">Standard</Badge>}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{selectedVideo.youtubeId}</div>
                  {selectedVideo.cloudflareVideoUid ? <div className="font-mono text-[11px] text-muted-foreground">Cloudflare UID: {selectedVideo.cloudflareVideoUid}</div> : null}
                  <div className="text-xs text-muted-foreground">Added {formatDate(selectedVideo.addedAt)} • Updated {formatDate(selectedVideo.updatedAt)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={`https://youtu.be/${selectedVideo.youtubeId}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />Open source
                    </a>
                  </Button>
                  {selectedVideo.cloudflareVideoUid ? (
                    <Button size="sm" variant="outline" onClick={() => handleDeleteFromCloudflare(selectedVideo)}>
                      <Trash2 className="mr-2 h-4 w-4" />Delete from Cloudflare
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => handleToggleFeatured(selectedVideo)}>
                    {selectedVideo.isFeatured ? <StarOff className="mr-2 h-4 w-4" /> : <Star className="mr-2 h-4 w-4" />}
                    {selectedVideo.isFeatured ? 'Unfeature' : 'Feature'}
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">Select a video to inspect details.</div>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
