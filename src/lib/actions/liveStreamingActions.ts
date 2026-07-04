// src/lib/actions/liveStreamingActions.ts
'use server';

import { getFirestoreInstance } from '../firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { getKV, putKV, deleteKV } from '../cloudflare/kv';
import type {
  LiveStreamSettings,
  LibraryVideo,
  VideoCategory,
  YouTubeLiveStatus,
} from '../types/liveStreaming';

const SETTINGS_DOC = 'liveStreamSettings/main';
const VIDEO_COLLECTION = 'videoLibrary';
import { extractYouTubeId } from '../utils/youtube';

const YT_CACHE_KEY = 'live:youtube:status:v1';
const DEFAULT_POLL_SECONDS = 60;

// ────────────────────────────────────────────────────────────────────────────
// Settings
// ────────────────────────────────────────────────────────────────────────────
export async function getLiveStreamSettings(): Promise<LiveStreamSettings> {
  const db = getFirestoreInstance();
  const snap = await db.doc(SETTINGS_DOC).get();
  const data = (snap.exists ? snap.data() : {}) as Partial<LiveStreamSettings>;
  return {
    channelId: data.channelId ?? null,
    channelHandle: data.channelHandle ?? null,
    autoDetectEnabled: data.autoDetectEnabled ?? false,
    manualOverrideVideoId: data.manualOverrideVideoId ?? null,
    pollIntervalSeconds: data.pollIntervalSeconds ?? DEFAULT_POLL_SECONDS,
    apiKeyConfigured: !!process.env.YOUTUBE_API_KEY,
    updatedAt: (data as any).updatedAt
      ? (typeof (data as any).updatedAt === 'string'
          ? (data as any).updatedAt
          : new Date(((data as any).updatedAt as any).toDate?.() ?? Date.now()).toISOString())
      : new Date(0).toISOString(),
  };
}

export async function updateLiveStreamSettings(
  payload: Partial<Omit<LiveStreamSettings, 'apiKeyConfigured' | 'updatedAt'>>
): Promise<{ success: boolean; message: string; settings?: LiveStreamSettings }> {
  try {
    const db = getFirestoreInstance();
    const cleanPayload: Record<string, any> = {};

    if (payload.channelId !== undefined) cleanPayload.channelId = (payload.channelId || '').trim() || null;
    if (payload.channelHandle !== undefined) cleanPayload.channelHandle = (payload.channelHandle || '').trim() || null;
    if (payload.autoDetectEnabled !== undefined) cleanPayload.autoDetectEnabled = !!payload.autoDetectEnabled;
    if (payload.manualOverrideVideoId !== undefined) {
      cleanPayload.manualOverrideVideoId = payload.manualOverrideVideoId
        ? extractYouTubeId(payload.manualOverrideVideoId) || null
        : null;
    }
    if (payload.pollIntervalSeconds !== undefined) {
      cleanPayload.pollIntervalSeconds = Math.max(15, Math.min(600, Number(payload.pollIntervalSeconds) || DEFAULT_POLL_SECONDS));
    }
    cleanPayload.updatedAt = FieldValue.serverTimestamp();

    await db.doc(SETTINGS_DOC).set(cleanPayload, { merge: true });

    // Bust YT status cache so the new channel/override is picked up immediately.
    try { await deleteKV(YT_CACHE_KEY, 'updateLiveStreamSettings'); } catch {}

    const settings = await getLiveStreamSettings();
    return { success: true, message: 'Live stream settings updated.', settings };
  } catch (e: any) {
    console.error('[updateLiveStreamSettings] failed:', e);
    return { success: false, message: e?.message || 'Failed to update settings' };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// YouTube auto-detect (KV-cached)
// ────────────────────────────────────────────────────────────────────────────
export async function fetchYouTubeLiveStatus(opts: { force?: boolean } = {}): Promise<YouTubeLiveStatus> {
  const settings = await getLiveStreamSettings();

  // Manual override always wins.
  if (settings.manualOverrideVideoId) {
    return {
      isLive: true,
      videoId: settings.manualOverrideVideoId,
      title: 'Manual override',
      thumbnailUrl: `https://i.ytimg.com/vi/${settings.manualOverrideVideoId}/hqdefault.jpg`,
      channelId: settings.channelId ?? null,
      fetchedAt: new Date().toISOString(),
      source: 'override',
    };
  }

  if (!settings.autoDetectEnabled || !settings.channelId) {
    return {
      isLive: false,
      videoId: null,
      title: null,
      thumbnailUrl: null,
      channelId: settings.channelId ?? null,
      fetchedAt: new Date().toISOString(),
      source: 'cache',
    };
  }

  const ttlMs = Math.max(15, settings.pollIntervalSeconds || DEFAULT_POLL_SECONDS) * 1000;

  if (!opts.force) {
    const cached = await getKV<YouTubeLiveStatus>(YT_CACHE_KEY, 'fetchYouTubeLiveStatus');
    if (cached?.fetchedAt) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < ttlMs) {
        return { ...cached, source: 'cache' };
      }
    }
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return {
      isLive: false,
      videoId: null,
      title: null,
      thumbnailUrl: null,
      channelId: settings.channelId ?? null,
      fetchedAt: new Date().toISOString(),
      source: 'live',
      error: 'YOUTUBE_API_KEY not configured on server',
    };
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('channelId', settings.channelId);
    url.searchParams.set('eventType', 'live');
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '1');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`YouTube API ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    const item = data?.items?.[0];

    const status: YouTubeLiveStatus = item
      ? {
          isLive: true,
          videoId: String(item.id?.videoId || ''),
          title: String(item.snippet?.title || ''),
          thumbnailUrl: String(item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || ''),
          channelId: settings.channelId ?? null,
          fetchedAt: new Date().toISOString(),
          source: 'live',
        }
      : {
          isLive: false,
          videoId: null,
          title: null,
          thumbnailUrl: null,
          channelId: settings.channelId ?? null,
          fetchedAt: new Date().toISOString(),
          source: 'live',
        };

    await putKV(YT_CACHE_KEY, status, 'fetchYouTubeLiveStatus');
    return status;
  } catch (e: any) {
    console.error('[fetchYouTubeLiveStatus] failed:', e?.message || e);
    return {
      isLive: false,
      videoId: null,
      title: null,
      thumbnailUrl: null,
      channelId: settings.channelId ?? null,
      fetchedAt: new Date().toISOString(),
      source: 'live',
      error: e?.message || 'YouTube fetch failed',
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Video library
// ────────────────────────────────────────────────────────────────────────────
export async function listLibraryVideos(opts: { featuredOnly?: boolean; category?: VideoCategory } = {}): Promise<LibraryVideo[]> {
  const db = getFirestoreInstance();
  let q: FirebaseFirestore.Query = db.collection(VIDEO_COLLECTION);
  if (opts.featuredOnly) q = q.where('isFeatured', '==', true);
  if (opts.category) q = q.where('category', '==', opts.category);

  const snap = await q.get();
  const items = snap.docs.map((d) => {
    const data = d.data() as any;
    const toIso = (v: any) => {
      if (!v) return new Date(0).toISOString();
      if (typeof v === 'string') return v;
      if (typeof v?.toDate === 'function') return v.toDate().toISOString();
      return new Date(v).toISOString();
    };
    return {
      id: d.id,
      youtubeId: data.youtubeId,
      title: data.title || 'Untitled',
      description: data.description ?? null,
      category: (data.category || 'other') as VideoCategory,
      isFeatured: !!data.isFeatured,
      scheduledFor: data.scheduledFor ?? null,
      thumbnailUrl: data.thumbnailUrl ?? `https://i.ytimg.com/vi/${data.youtubeId}/hqdefault.jpg`,
      addedAt: toIso(data.addedAt),
      updatedAt: toIso(data.updatedAt),
      addedByUid: data.addedByUid ?? null,
    } as LibraryVideo;
  });

  // Sort: featured first, then newest first
  items.sort((a, b) => {
    if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
  });

  return items;
}

export async function addLibraryVideo(input: {
  youtubeUrlOrId: string;
  title: string;
  description?: string | null;
  category?: VideoCategory;
  isFeatured?: boolean;
  scheduledFor?: string | null;
  addedByUid?: string | null;
}): Promise<{ success: boolean; message: string; video?: LibraryVideo }> {
  try {
    const youtubeId = extractYouTubeId(input.youtubeUrlOrId);
    if (!youtubeId) {
      return { success: false, message: 'Invalid YouTube URL or video ID.' };
    }
    if (!input.title?.trim()) {
      return { success: false, message: 'Title is required.' };
    }

    const db = getFirestoreInstance();

    // Prevent dupes: same youtubeId already in library
    const dupeSnap = await db.collection(VIDEO_COLLECTION).where('youtubeId', '==', youtubeId).limit(1).get();
    if (!dupeSnap.empty) {
      return { success: false, message: 'This video is already in the library.' };
    }

    const ref = db.collection(VIDEO_COLLECTION).doc();
    const payload = {
      youtubeId,
      title: input.title.trim(),
      description: (input.description || '').trim() || null,
      category: (input.category || 'other') as VideoCategory,
      isFeatured: !!input.isFeatured,
      scheduledFor: input.scheduledFor || null,
      thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
      addedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      addedByUid: input.addedByUid || null,
    };
    await ref.set(payload);

    return {
      success: true,
      message: 'Video added to library.',
      video: {
        id: ref.id,
        youtubeId,
        title: payload.title,
        description: payload.description,
        category: payload.category,
        isFeatured: payload.isFeatured,
        scheduledFor: payload.scheduledFor,
        thumbnailUrl: payload.thumbnailUrl,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        addedByUid: payload.addedByUid,
      },
    };
  } catch (e: any) {
    console.error('[addLibraryVideo] failed:', e);
    return { success: false, message: e?.message || 'Failed to add video' };
  }
}

export async function updateLibraryVideo(
  id: string,
  patch: Partial<Pick<LibraryVideo, 'title' | 'description' | 'category' | 'isFeatured' | 'scheduledFor'>>
): Promise<{ success: boolean; message: string }> {
  try {
    if (!id) return { success: false, message: 'Video id is required' };
    const db = getFirestoreInstance();

    const cleanPatch: Record<string, any> = {};
    if (patch.title !== undefined) cleanPatch.title = String(patch.title || '').trim();
    if (patch.description !== undefined) cleanPatch.description = String(patch.description || '').trim() || null;
    if (patch.category !== undefined) cleanPatch.category = patch.category;
    if (patch.isFeatured !== undefined) cleanPatch.isFeatured = !!patch.isFeatured;
    if (patch.scheduledFor !== undefined) cleanPatch.scheduledFor = patch.scheduledFor || null;
    cleanPatch.updatedAt = FieldValue.serverTimestamp();

    await db.collection(VIDEO_COLLECTION).doc(id).update(cleanPatch);
    return { success: true, message: 'Video updated.' };
  } catch (e: any) {
    console.error('[updateLibraryVideo] failed:', e);
    return { success: false, message: e?.message || 'Failed to update video' };
  }
}

export async function deleteLibraryVideo(id: string): Promise<{ success: boolean; message: string }> {
  try {
    if (!id) return { success: false, message: 'Video id is required' };
    const db = getFirestoreInstance();
    await db.collection(VIDEO_COLLECTION).doc(id).delete();
    return { success: true, message: 'Video removed.' };
  } catch (e: any) {
    console.error('[deleteLibraryVideo] failed:', e);
    return { success: false, message: e?.message || 'Failed to delete video' };
  }
}
