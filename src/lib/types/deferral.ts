
// src/lib/types/deferral.ts
import type { ReminderInfo } from './index';

export type DeferralStatus = 'Pending' | 'Used' | 'Expired' | 'TBD' | 'Confirmed' | 'Pending Ticket Selection' | 'Pending Upgrade Payment' | 'ProcessingConfirmation' | 'RevokedByAdmin' | 'Processing';

export interface DeferralEntry {
  id: string;
  userId: string;
  participantEmail: string;
  participantName?: string | null;
  originalEventName: string;
  originalEventId: string;
  originalEventDate: string | null;
  originalTicketId?: string | null;
  originalTicketName?: string | null;
  deferralDate: string | null;
  status: DeferralStatus;
  expiryDate: string | null; 
  notes?: string | null;
  paymentId?: string | null;
  originalTransactionId?: string | null;
  originalAmountPaidPaisa?: number | null;
  estimatedOriginalBasePricePaisa?: number | null;
  totalAmountPaidPaisa?: number | null; // Service fee paid for the deferral
  amountDueForUpgradePaisa?: number | null;
  upgradePaymentOrderId?: string | null;
  upgradePaymentStatus?: 'Pending' | 'Paid' | 'NotRequired' | 'Paid (Demo)';
  upgradeInvoiceId?: string | null;
  invoiceNumber?: string | null;
  invoiceId?: string | null;
  zohoSyncStatus?: 'pending' | 'success' | 'failed';
  zohoSyncError?: string | null;
  zohoSyncRetries?: number;
  code: string | null;
  deferredToEventId?: string | null;
  deferredToEventName?: string | null;
  deferredToTicketId?: string | null;
  deferredToTicketName?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  remindersSent?: {
    email: ReminderInfo;
    whatsapp: ReminderInfo;
  };
}

export interface ActiveDeferralInfo {
  deferralId: string;
  participantName?: string | null;
  originalEventName: string;
  originalEventId?: string | null;
  originalEventDate: string | null;
  originalTicketId?: string | null;
  originalAmountPaidPaisa?: number | null;
  estimatedOriginalBasePricePaisa?: number | null;
  status: DeferralStatus;
  deferralDate: string | null;
  expiryDate: string | null; 
  deferredToEventId?: string | null;
  deferredToEventName?: string | null;
  deferredToTicketId?: string | null;
  deferredToTicketName?: string | null;
  amountDueForUpgradePaisa?: number | null;
  upgradePaymentOrderId?: string | null;
  upgradePaymentStatus?: 'Pending' | 'Paid' | 'NotRequired' | 'Paid (Demo)' | null;
  code?: string | null;
}

export interface DeferralStats {
  totalDeferrals: number;
  pendingDeferrals: number;
  completedDeferrals: number;
  expiredDeferrals: number;
  deniedRequests: number;
}
