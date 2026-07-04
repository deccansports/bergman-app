'use server';

import { getFirestoreInstance } from '../firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { LibraryVideo, VideoCategory } from '../types/videoLibrary';
import { extractYouTubeId } from '../utils/youtube';

const VIDEO_COLLECTION = 'videoLibrary';

function toIso(value: any) {
  if (!value) return new Date(0).toISOString();
  if (typeof value === 'string') return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  return new Date(value).toISOString();
}

function normalizeVideoDoc(id: string, data: any): LibraryVideo {
  return {
    id,
    youtubeId: String(data.youtubeId || ''),
    title: String(data.title || 'Untitled'),
    description: data.description ?? null,
    category: (data.category || 'other') as VideoCategory,
    isFeatured: !!data.isFeatured,
    scheduledFor: data.scheduledFor ?? null,
    thumbnailUrl: data.thumbnailUrl ?? `https://i.ytimg.com/vi/${data.youtubeId}/hqdefault.jpg`,
    addedAt: toIso(data.addedAt),
    updatedAt: toIso(data.updatedAt),
    addedByUid: data.addedByUid ?? null,
    cloudflareVideoUid: data.cloudflareVideoUid ?? data.videoUid ?? data.recordingUid ?? null,
    eventId: data.eventId ?? null,
    cameraId: data.cameraId ?? null,
  };
}

export async function listLibraryVideos(opts: { featuredOnly?: boolean; category?: VideoCategory } = {}): Promise<LibraryVideo[]> {
  const db = getFirestoreInstance();
  let q: FirebaseFirestore.Query = db.collection(VIDEO_COLLECTION);
  if (opts.featuredOnly) q = q.where('isFeatured', '==', true);
  if (opts.category) q = q.where('category', '==', opts.category);

  const snap = await q.get();
  const items = snap.docs.map((d) => normalizeVideoDoc(d.id, d.data()));

  items.sort((a, b) => {
    if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
  });

  return items;
}

export async function getFeaturedLibraryVideo(): Promise<LibraryVideo | null> {
  const videos = await listLibraryVideos({ featuredOnly: true });
  return videos[0] || null;
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
      video: normalizeVideoDoc(ref.id, { ...payload, addedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
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

export async function bulkDeleteLibraryVideos(ids: string[]): Promise<{ success: boolean; message: string; deletedCount?: number }> {
  try {
    const uniqueIds = Array.from(new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (uniqueIds.length === 0) {
      return { success: false, message: 'No videos selected.' };
    }

    const db = getFirestoreInstance();
    let deletedCount = 0;

    for (let i = 0; i < uniqueIds.length; i += 400) {
      const batch = db.batch();
      const chunk = uniqueIds.slice(i, i + 400);
      for (const id of chunk) {
        batch.delete(db.collection(VIDEO_COLLECTION).doc(id));
      }
      await batch.commit();
      deletedCount += chunk.length;
    }

    return { success: true, message: `Deleted ${deletedCount} video${deletedCount === 1 ? '' : 's'}.`, deletedCount };
  } catch (e: any) {
    console.error('[bulkDeleteLibraryVideos] failed:', e);
    return { success: false, message: e?.message || 'Failed to delete videos' };
  }
}

export async function deleteFilteredLibraryVideos(opts: {
  featuredOnly?: boolean;
  category?: VideoCategory | 'all';
  olderThanDays?: number;
  keepFeatured?: boolean;
} = {}): Promise<{ success: boolean; message: string; deletedCount?: number }> {
  try {
    const db = getFirestoreInstance();
    let q: FirebaseFirestore.Query = db.collection(VIDEO_COLLECTION);

    if (opts.featuredOnly) {
      q = q.where('isFeatured', '==', true);
    } else if (opts.keepFeatured) {
      q = q.where('isFeatured', '==', false);
    }

    if (opts.category && opts.category !== 'all') {
      q = q.where('category', '==', opts.category);
    }

    const snap = await q.get();
    const cutoffMs = Number(opts.olderThanDays || 0) > 0 ? Date.now() - (Number(opts.olderThanDays) * 24 * 60 * 60 * 1000) : null;
    const docs = snap.docs.filter((doc) => {
      if (!cutoffMs) return true;
      const data = doc.data() as any;
      const addedAt = data.addedAt;
      const ts = typeof addedAt?.toDate === 'function' ? addedAt.toDate().getTime() : new Date(addedAt || 0).getTime();
      return Number.isFinite(ts) && ts <= cutoffMs;
    });

    if (docs.length === 0) {
      return { success: true, message: 'No videos matched the cleanup filter.', deletedCount: 0 };
    }

    let deletedCount = 0;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + 400);
      for (const doc of chunk) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      deletedCount += chunk.length;
    }

    return { success: true, message: `Deleted ${deletedCount} filtered video${deletedCount === 1 ? '' : 's'}.`, deletedCount };
  } catch (e: any) {
    console.error('[deleteFilteredLibraryVideos] failed:', e);
    return { success: false, message: e?.message || 'Failed to delete filtered videos' };
  }
}
