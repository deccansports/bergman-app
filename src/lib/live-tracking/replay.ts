import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import { eventReplayKvKey, liveEventReplayKvKey } from '@/lib/live-tracking/storageKeys';
import { listStreamVideos } from '@/lib/cloudflare/stream';

export type ReplayVideoRecord = {
  uid: string;
  title: string;
  status: string;
  duration: number;
  thumbnail: string | null;
  playback: string | null;
  inputId: string | null;
  createdAt: string;
  uploadedAt: string | null;
  modifiedAt: string | null;
  eventId?: string | null;
  cameraId?: string | null;
  source?: 'cloudflare';
  attachedAt?: string | null;
};

export type ReplayIndex = {
  eventId: string;
  videos: ReplayVideoRecord[];
  lastSyncAt: string | null;
  lastCloudflareRefreshAt: string | null;
  diagnostics: {
    videosFound: number;
    readyVideos: number;
    liveVideos: number;
    missingVideos: number;
  };
};

function uniqByUid(videos: ReplayVideoRecord[]) {
  const map = new Map<string, ReplayVideoRecord>();
  for (const video of videos || []) {
    const uid = String(video?.uid || '').trim();
    if (!uid) continue;
    map.set(uid, video);
  }
  return Array.from(map.values());
}

function sortNewestFirst(videos: ReplayVideoRecord[]) {
  return [...videos].sort((a, b) => {
    const aTime = new Date(a.createdAt || a.uploadedAt || a.modifiedAt || 0).getTime();
    const bTime = new Date(b.createdAt || b.uploadedAt || b.modifiedAt || 0).getTime();
    return bTime - aTime;
  });
}

function normalizeReplayDoc(data: any): ReplayVideoRecord {
  const uid = String(data?.uid || data?.videoUid || data?.cloudflareVideoUid || '').trim();
  const createdAt = String(data?.createdAt || data?.created || data?.uploadedAt || data?.uploaded || data?.modifiedAt || data?.modified || new Date().toISOString());
  return {
    uid,
    title: String(data?.title || data?.meta?.name || data?.publicDetails?.title || uid || 'Untitled').trim(),
    status: String(data?.status?.state || data?.status || (data?.readyToStream ? 'ready' : '') || '').trim() || 'unknown',
    duration: Number(data?.duration || 0) || 0,
    thumbnail: String(data?.thumbnail || data?.thumbnailUrl || '').trim() || null,
    playback: String(data?.playback?.hls || data?.playback || data?.hlsUrl || data?.dashUrl || '').trim() || null,
    inputId: String(data?.liveInput || data?.liveInputId || data?.inputId || '').trim() || null,
    createdAt,
    uploadedAt: String(data?.uploadedAt || data?.uploaded || '').trim() || null,
    modifiedAt: String(data?.modifiedAt || data?.modified || '').trim() || null,
    source: 'cloudflare',
  };
}

async function readReplayIndex(eventId: string): Promise<ReplayIndex | null> {
  const canonical = await getKV<ReplayIndex>(eventReplayKvKey(eventId), 'replay-index-read').catch(() => null);
  if (canonical?.eventId && Array.isArray(canonical.videos)) return canonical;
  const mirror = await getKV<ReplayIndex>(liveEventReplayKvKey(eventId), 'replay-index-read').catch(() => null);
  if (mirror?.eventId && Array.isArray(mirror.videos)) return mirror;
  return null;
}

export async function loadReplayIndex(eventId: string): Promise<ReplayIndex | null> {
  const indexed = await readReplayIndex(eventId);
  if (indexed) {
    return {
      ...indexed,
      videos: sortNewestFirst(uniqByUid(indexed.videos || [])),
    };
  }

  // Best-effort fallback: look for replay docs if KV has not been initialized yet.
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('videoLibrary').where('eventId', '==', eventId).get();
    const videos = snap.docs.map((doc) => normalizeReplayDoc({ uid: doc.id, ...(doc.data() || {}) }));
    if (!videos.length) return null;
    return {
      eventId,
      videos: sortNewestFirst(uniqByUid(videos)),
      lastSyncAt: null,
      lastCloudflareRefreshAt: null,
      diagnostics: {
        videosFound: videos.length,
        readyVideos: videos.filter((video) => String(video.status).toLowerCase().includes('ready') || String(video.status).toLowerCase().includes('complete')).length,
        liveVideos: videos.filter((video) => String(video.status).toLowerCase().includes('live')).length,
        missingVideos: 0,
      },
    };
  } catch {
    return null;
  }
}

export async function syncReplayIndexFromCloudflare(eventId: string): Promise<ReplayIndex | null> {
  const existing = (await readReplayIndex(eventId)) || { eventId, videos: [], lastSyncAt: null, lastCloudflareRefreshAt: null, diagnostics: { videosFound: 0, readyVideos: 0, liveVideos: 0, missingVideos: 0 } };
  const cloudflare = await listStreamVideos({ limit: 1000, type: 'live' }).catch(() => ({ items: [], total: 0 }));
  const available = Array.isArray(cloudflare.items) ? cloudflare.items.map((video: any) => normalizeReplayDoc(video)) : [];
  const attachedByUid = new Map((existing.videos || []).map((video) => [String(video.uid || '').trim(), video]));

  const merged = uniqByUid([
    ...(existing.videos || []).map((video) => {
      const current = available.find((item) => item.uid === video.uid) || null;
      return current ? { ...video, ...current, eventId, source: 'cloudflare' as const } : video;
    }),
    ...available.filter((video) => attachedByUid.has(video.uid)).map((video) => ({ ...video, eventId, attachedAt: attachedByUid.get(video.uid)?.attachedAt || new Date().toISOString() })),
  ]);

  const diagnostics = {
    videosFound: merged.length,
    readyVideos: merged.filter((video) => String(video.status).toLowerCase().includes('ready') || String(video.status).toLowerCase().includes('complete')).length,
    liveVideos: merged.filter((video) => String(video.status).toLowerCase().includes('live')).length,
    missingVideos: Math.max(0, (existing.videos || []).length - merged.length),
  };

  const next: ReplayIndex = {
    eventId,
    videos: sortNewestFirst(merged),
    lastSyncAt: new Date().toISOString(),
    lastCloudflareRefreshAt: new Date().toISOString(),
    diagnostics,
  };

  await Promise.all([
    putKV(eventReplayKvKey(eventId), next, 'replay-index-sync').catch(() => null),
    putKV(liveEventReplayKvKey(eventId), next, 'replay-index-sync').catch(() => null),
  ]);

  return next;
}

export async function attachReplayVideoToEvent(eventId: string, video: Partial<ReplayVideoRecord> & { uid: string }) {
  const current = (await readReplayIndex(eventId)) || {
    eventId,
    videos: [],
    lastSyncAt: null,
    lastCloudflareRefreshAt: null,
    diagnostics: { videosFound: 0, readyVideos: 0, liveVideos: 0, missingVideos: 0 },
  };

  const nextVideo: ReplayVideoRecord = {
    uid: String(video.uid || '').trim(),
    title: String(video.title || 'Untitled').trim(),
    status: String(video.status || 'unknown').trim(),
    duration: Number(video.duration || 0) || 0,
    thumbnail: video.thumbnail ?? null,
    playback: video.playback ?? null,
    inputId: video.inputId ?? null,
    createdAt: String(video.createdAt || new Date().toISOString()),
    uploadedAt: video.uploadedAt ?? null,
    modifiedAt: video.modifiedAt ?? null,
    eventId,
    cameraId: video.cameraId ?? null,
    source: 'cloudflare',
    attachedAt: new Date().toISOString(),
  };

  const merged = sortNewestFirst(uniqByUid([nextVideo, ...(current.videos || []).filter((item) => item.uid !== nextVideo.uid)]));
  const next: ReplayIndex = {
    ...current,
    eventId,
    videos: merged,
    lastSyncAt: new Date().toISOString(),
    diagnostics: {
      videosFound: merged.length,
      readyVideos: merged.filter((item) => String(item.status).toLowerCase().includes('ready') || String(item.status).toLowerCase().includes('complete')).length,
      liveVideos: merged.filter((item) => String(item.status).toLowerCase().includes('live')).length,
      missingVideos: 0,
    },
  };

  await Promise.all([
    putKV(eventReplayKvKey(eventId), next, 'replay-index-attach').catch(() => null),
    putKV(liveEventReplayKvKey(eventId), next, 'replay-index-attach').catch(() => null),
  ]);

  return next;
}

export function replayIndexSummary(index: ReplayIndex | null) {
  return {
    videosFound: index?.diagnostics?.videosFound || 0,
    readyVideos: index?.diagnostics?.readyVideos || 0,
    liveVideos: index?.diagnostics?.liveVideos || 0,
    missingVideos: index?.diagnostics?.missingVideos || 0,
    lastSyncAt: index?.lastSyncAt || null,
    lastCloudflareRefreshAt: index?.lastCloudflareRefreshAt || null,
  };
}
