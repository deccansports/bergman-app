// src/lib/types/announcement.ts
export type AnnouncementType = 'global' | 'athlete' | 'club';
export type AnnouncementPriority = 'low' | 'medium' | 'high';

export interface Announcement {
  id: string;
  title: string;
  message: string;
  type: AnnouncementType;
  targetEventId?: string | null;
  priority: AnnouncementPriority;
  isTicker: boolean;
  tickerSpeedSeconds?: number | null;
  isModal: boolean;
  linkUrl?: string | null;
  startDate: string; // ISO
  endDate: string; // ISO
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  createdBy: string;
}

export interface AnnouncementFormInput {
  title: string;
  message: string;
  type: AnnouncementType;
  priority: AnnouncementPriority;
  isTicker: boolean;
  tickerSpeedSeconds?: number | null;
  isModal: boolean;
  linkUrl?: string | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
  targetEventId?: string | null;
}
