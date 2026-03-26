// src/lib/types/whatsapp.ts

export interface CampaignLogEntry {
  id: string;
  recipientEmail?: string;
  recipientMobile?: string;
  recipientName: string;
  subject?: string;
  templateName?: string;
  eventId: string;
  eventName: string;
  ticketNames?: string;
  sentAt: string;
  status: 'Success' | 'Failed';
  sentBy: string;
  error?: string;
}

export interface ScheduledWhatsAppCampaign {
  id: string;
  campaignName: string;
  templateName: string;
  scheduledAt: string;
  status: 'scheduled' | 'sent' | 'cancelled' | 'draft' | 'processing';
  createdAt: string;
  updatedAt: string;
}
