// src/lib/types/waitlist.ts

export type WaitlistEntryStatus =
  | 'pending'
  | 'invited'
  | 'code_sent'
  | 'registered'
  | 'expired'
  | 'cancelled';

export type WaitlistCodeStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface WaitlistForm {
  id: string;
  eventId: string;
  eventName: string;
  slug: string;
  isActive: boolean;
  allowedTicketIds?: string[] | null;
  waitlistOpenAt?: string | null;
  waitlistCloseAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface WaitlistEntry {
  id: string;
  formId: string;
  eventId: string;
  eventName: string;
  ticketId?: string | null;
  ticketName?: string | null;
  athleteName: string;
  email: string;
  mobile: string;
  message?: string | null;
  status: WaitlistEntryStatus;
  codeId?: string | null;
  code?: WaitlistCode | null;
  invitedAt?: string | null;
  codeSentAt?: string | null;
  registeredAt?: string | null;
  lastStatusNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WaitlistCode {
  id: string;
  code: string;
  eventId: string;
  eventName: string;
  ticketId?: string | null;
  ticketName?: string | null;
  allowedTicketIds?: string[] | null;
  email: string;
  athleteName: string;
  entryId?: string | null;
  status: WaitlistCodeStatus;
  expiresAt?: string | null;
  usageLimit: number;
  usageCount: number;
  usedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
  lastSentAt?: string | null;
  usedByAttemptId?: string | null;
  usedByParticipantId?: string | null;
}

export interface WaitlistCodeValidationResult {
  success: boolean;
  message: string;
  code?: WaitlistCode;
}
