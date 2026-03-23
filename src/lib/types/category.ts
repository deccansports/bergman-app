// src/lib/types/category.ts

export type CategoryChangeStatus =
  | 'PendingPayment'
  | 'Processing'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export interface CategoryZohoSync {
  status: 'pending' | 'success' | 'failed' | 'skipped';
  retries: number;
  error?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  lastAttempt?: string;
}

export interface CategoryParticipant {
  pricingBreakdown?: {
    base?: number;
    discount?: number;
  };
  basePricePaisa?: number | null;
  couponDiscountPaisa?: number | null;
  amountPaidPaisa?: number | null;
  ticketName?: string;
  ticketId?: string | null;
  eventName?: string;
}

export interface CategoryTicket {
  id: string;
  ticketName: string;
  price: number | null;
}

export interface CategoryChangeEntry {
  id: string;
  userId: string;
  participantId: string;
  eventId: string;
  participantName: string;
  participantEmail: string;
  fromTicketId: string | null;
  fromTicketName: string | null;
  toTicketId: string | null;
  toTicketName: string | null;
  actualPaidPaisa: number;
  newTicketPricePaisa: number;
  upgradeAmountPaisa: number;
  serviceFeePaisa: number;
  totalPaidPaisa: number;
  paymentId: string | null;
  zohoSync?: CategoryZohoSync;
  status: CategoryChangeStatus;
  createdAt: any;
  updatedAt?: any;
}
