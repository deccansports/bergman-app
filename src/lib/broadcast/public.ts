import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue } from '@/lib/utils';
import { cloudflareBroadcastProvider, getPlaybackIframeUrl, getPlaybackUrl } from '@/lib/cloudflare/stream';
import { loadEventLiveCameras } from '@/lib/broadcast/liveCameras';
import { getFeaturedLibraryVideo } from '@/lib/actions/videoLibraryActions';

export type PublicBroadcastEvent = {
  id: string;
  eventName: string;
  eventDate: string | null;
  customSlug: string | null;
  photoUrl: string | null;
  finishLedLogoUrl: string | null;
  description: string | null;
};

export type PublicBroadcastFeaturedVideo = {
  youtubeId: string;
  title: string;
  description: string | null;
  category: string;
  thumbnailUrl: string | null;
  addedAt: string;
};

export type PublicBroadcastCamera = {
  cameraId: string;
  eventId: string;
  name: string;
  cameraType: string;
  status: string;
  priority: number;
  assignedLocation: string | null;
  liveInputUid?: string | null;
  playbackUid: string | null;
  playbackUrl: string | null;
  iframeUrl?: string | null;
  rtmpsPlaybackUrl?: string | null;
  webRTCPlaybackUrl?: string | null;
  recordingUid?: string | null;
  thumbnailUrl?: string | null;
  previewThumbnail: string | null;
  viewerCount: number;
  latency: number;
  currentViewers?: number | null;
  lastConnectedAt?: string | null;
  lastStreamStartedAt?: string | null;
};

export async function resolveEventBySlug(eventSlug: string): Promise<PublicBroadcastEvent | null> {
  const slug = String(eventSlug || '').trim();
  if (!slug) return null;

  const db = getFirestoreInstance();
  const byDoc = await db.collection('events').doc(slug).get();
  if (byDoc.exists) {
    const data = serializeValue(byDoc.data() || {}) as any;
    return {
      id: byDoc.id,
      eventName: String(data.eventName || data.name || 'Untitled Event'),
      eventDate: data.eventDate || null,
      customSlug: String(data.customSlug || data.pageSlug || byDoc.id || '').trim() || null,
      photoUrl: String(data.photoUrl || data.bannerUrl || data.eventBannerUrl || '').trim() || null,
      finishLedLogoUrl: String(data.finishLedLogoUrl || data.logoUrl || '').trim() || null,
      description: String(data.description || '').trim() || null,
    };
  }

  const fields = ['customSlug', 'pageSlug', 'slug'];
  for (const field of fields) {
    const snap = await db.collection('events').where(field as any, '==', slug).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      const data = serializeValue(doc.data() || {}) as any;
      return {
        id: doc.id,
        eventName: String(data.eventName || data.name || 'Untitled Event'),
        eventDate: data.eventDate || null,
        customSlug: String(data.customSlug || data.pageSlug || doc.id || '').trim() || null,
        photoUrl: String(data.photoUrl || data.bannerUrl || data.eventBannerUrl || '').trim() || null,
        finishLedLogoUrl: String(data.finishLedLogoUrl || data.logoUrl || '').trim() || null,
        description: String(data.description || '').trim() || null,
      };
    }
  }

  const legacy = await db.collection('eventCalendar').doc(slug).get();
  if (legacy.exists) {
    const data = serializeValue(legacy.data() || {}) as any;
    return {
      id: legacy.id,
      eventName: String(data.eventName || data.name || 'Untitled Event'),
      eventDate: data.eventDate || null,
      customSlug: String(data.customSlug || data.pageSlug || legacy.id || '').trim() || null,
      photoUrl: String(data.photoUrl || data.bannerUrl || data.eventBannerUrl || '').trim() || null,
      finishLedLogoUrl: String(data.finishLedLogoUrl || data.logoUrl || '').trim() || null,
      description: String(data.description || '').trim() || null,
    };
  }

  return null;
}

export async function loadPublicBroadcastData(eventSlug: string) {
  const event = await resolveEventBySlug(eventSlug);
  if (!event) return null;

  const db = getFirestoreInstance();
  const [cameras, sessionSnap, settingsSnap, sponsorsSnap, featuredVideo] = await Promise.all([
    loadEventLiveCameras(db, event.id),
    db.collection('broadcastSessions').doc(event.id).get(),
    db.collection('broadcastSettings').doc(event.id).get(),
    db.collection('events').doc(event.id).collection('sponsors').orderBy('order', 'asc').get().catch(async () => db.collection('events').doc(event.id).collection('sponsors').get()),
    getFeaturedLibraryVideo().catch(() => null),
  ]);

  const publicCameras = await Promise.all(cameras.map(async (camera) => {
    const data = serializeValue(camera || {}) as any;
    const liveInputUid = String(data?.cloudflare?.liveInputUid || '').trim() || null;
    const rawPlaybackUid = String(data?.cloudflare?.playbackUid || '').trim() || null;
    const isLiveCamera = ['live', 'recording', 'stopping'].includes(String(data?.status || '').trim().toLowerCase());
    const playbackUid = rawPlaybackUid && rawPlaybackUid !== liveInputUid ? rawPlaybackUid : null;
    const playbackSourceUid = playbackUid || (isLiveCamera ? liveInputUid : null);
    let playbackUrl = String(data?.cloudflare?.playbackUrl || data?.cloudflare?.webRTCPlaybackUrl || data?.cloudflare?.rtmpsPlaybackUrl || '').trim() || (playbackSourceUid ? getPlaybackUrl(playbackSourceUid) : null);
    let rtmpsPlaybackUrl = String(data?.cloudflare?.rtmpsPlaybackUrl || '').trim() || null;
    let webRTCPlaybackUrl = String(data?.cloudflare?.webRTCPlaybackUrl || '').trim() || null;

    if ((!playbackUrl || !rtmpsPlaybackUrl || !webRTCPlaybackUrl) && liveInputUid) {
      try {
        const liveInput = await cloudflareBroadcastProvider.getLiveInput(liveInputUid);
        const liveInputPlaybackUid = String(
          liveInput?.video?.uid ||
          liveInput?.currentVideo?.uid ||
          liveInput?.playback?.uid ||
          liveInput?.recording?.uid ||
          liveInput?.stream?.uid ||
          ''
        ).trim() || null;
        const resolvedPlaybackUid = liveInputPlaybackUid || playbackSourceUid;
        playbackUrl = playbackUrl || String(liveInput?.manifest?.url || liveInput?.playback?.url || liveInput?.webRTCPlayback?.url || liveInput?.rtmpsPlayback?.url || '').trim() || null;
        if (!playbackUrl && resolvedPlaybackUid) playbackUrl = getPlaybackUrl(resolvedPlaybackUid);
        rtmpsPlaybackUrl = rtmpsPlaybackUrl || String(liveInput?.rtmpsPlayback?.url || '').trim() || null;
        webRTCPlaybackUrl = webRTCPlaybackUrl || String(liveInput?.webRTCPlayback?.url || '').trim() || null;
      } catch {
        // Best-effort fallback only.
      }
    }

    const viewerLookupId = playbackSourceUid || null;
    const fallbackViewers = Number(data.viewerCount || data?.cloudflare?.currentViewers || 0);
    const viewerCount = viewerLookupId ? await cloudflareBroadcastProvider.getViewerCounts(viewerLookupId) : fallbackViewers;

    return {
      cameraId: String(camera?.cameraId || '').trim(),
      eventId: event.id,
      name: String(data.name || 'Camera'),
      cameraType: String(data.cameraType || 'custom'),
      status: String(data.status || 'offline'),
      priority: Number(data.priority || 0),
      assignedLocation: String(data.assignedLocation || '').trim() || null,
      liveInputUid,
      playbackUid: playbackSourceUid,
      playbackUrl,
      rtmpsPlaybackUrl,
      webRTCPlaybackUrl,
      recordingUid: String(data?.cloudflare?.recordingUid || '').trim() || null,
      thumbnailUrl: String(data?.cloudflare?.thumbnailUrl || '').trim() || null,
      previewThumbnail: String(data.previewThumbnail || '').trim() || null,
      viewerCount: Number.isFinite(Number(viewerCount)) ? Number(viewerCount) : fallbackViewers,
      latency: Number(data.latency || 0),
      currentViewers: Number.isFinite(Number(data?.cloudflare?.currentViewers)) ? Number(data?.cloudflare?.currentViewers) : null,
      lastConnectedAt: String(data.lastConnectedAt || '').trim() || null,
      lastStreamStartedAt: String(data.lastStreamStartedAt || '').trim() || null,
      iframeUrl: playbackSourceUid ? getPlaybackIframeUrl(playbackSourceUid) : null,
    } satisfies PublicBroadcastCamera;
  }));

  publicCameras.sort((a, b) => a.priority - b.priority);

  const sponsors = sponsorsSnap.docs.map((doc) => ({
    id: doc.id,
    name: String(doc.data()?.name || '').trim(),
    logoUrl: String(doc.data()?.logoUrl || '').trim(),
    website: String(doc.data()?.website || '').trim() || null,
    order: Number(doc.data()?.order ?? 0),
  })).filter((s) => s.name || s.logoUrl);

  const session = sessionSnap.exists ? serializeValue(sessionSnap.data() || {}) : null;
  const settings = settingsSnap.exists ? serializeValue(settingsSnap.data() || {}) : null;

  return {
    event,
    cameras: publicCameras,
    sponsors,
    featuredVideo: featuredVideo ? {
      youtubeId: featuredVideo.youtubeId,
      title: featuredVideo.title,
      description: featuredVideo.description ?? null,
      category: featuredVideo.category,
      thumbnailUrl: featuredVideo.thumbnailUrl ?? null,
      addedAt: featuredVideo.addedAt,
    } : null,
    session,
    settings,
    summary: {
      liveCameras: publicCameras.filter((c) => c.status === 'live' || c.status === 'recording').length,
      offlineCameras: publicCameras.filter((c) => c.status !== 'live' && c.status !== 'recording').length,
      viewerCount: publicCameras.reduce((sum, c) => sum + Number(c.viewerCount || 0), 0),
    },
  };
}
