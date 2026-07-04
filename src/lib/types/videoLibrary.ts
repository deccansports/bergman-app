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
  cloudflareVideoUid?: string | null;
  eventId?: string | null;
  cameraId?: string | null;
}
