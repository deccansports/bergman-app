// src/lib/types/liveStreaming.ts

export type LiveFeedType = 'youtube' | 'black' | 'message';

export interface LiveControl {
  activeFeedType: LiveFeedType;
  youtubeVideoId?: string | null;
  message?: string | null;
  source?: 'manual' | 'auto-detect' | 'override';
  updatedAt: string;
}

export interface LiveStreamSettings {
  channelId?: string | null;
  channelHandle?: string | null;
  autoDetectEnabled: boolean;
  manualOverrideVideoId?: string | null;
  pollIntervalSeconds: number;
  apiKeyConfigured: boolean;
  updatedAt: string;
}

export type VideoCategory = 'highlight' | 'race' | 'training' | 'interview' | 'promo' | 'other';

export interface LibraryVideo {
  id: string;
  youtubeId: string;
  title: string;
  description?: string | null;
  category: VideoCategory;
  isFeatured: boolean;
  scheduledFor?: string | null;
  thumbnailUrl?: string | null;
  addedAt: string;
  updatedAt: string;
  addedByUid?: string | null;
}

export interface YouTubeLiveStatus {
  isLive: boolean;
  videoId: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  channelId: string | null;
  fetchedAt: string;
  source: 'cache' | 'live' | 'override';
  error?: string;
}
