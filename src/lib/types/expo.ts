// src/lib/types/expo.ts

export type ExpoCurrencyMode = 'INR' | 'USD' | 'BOTH';
export type ExpoStatus = 'draft' | 'published' | 'closed';

export type ExpoStallStatus =
  | 'available'
  | 'reserved'
  | 'pending_payment'
  | 'booked'
  | 'blocked'
  | 'cancelled'
  | 'refunded';

export type ExpoBookingStatus = 'pending' | 'reserved' | 'paid' | 'cancelled' | 'refunded';

export interface ExpoMetrics {
  totalStalls: number;
  availableStalls: number;
  reservedStalls: number;
  bookedStalls: number;
  pendingPayments: number;
  revenueCollected: number;
  expectedRevenue: number;
  exhibitorsCount: number;
}

export interface ExpoRecord {
  id: string;
  eventId: string;
  expoName: string;
  venue?: string | null;
  hallName?: string | null;
  expoStartDate?: string | null;
  expoEndDate?: string | null;
  bookingOpensAt?: string | null;
  bookingClosesAt?: string | null;
  currencyMode: ExpoCurrencyMode;
  paymentGateway?: string | null;
  invoiceProvider?: string | null;
  status: ExpoStatus;
  layout?: {
    fileName?: string | null;
    fileUrl?: string | null;
    fileType?: 'png' | 'jpg' | 'jpeg' | 'pdf' | null;
    uploadedAt?: string | null;
  } | null;
  metrics: ExpoMetrics;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ExpoStallType {
  id: string;
  expoId: string;
  eventId: string;
  name: string;
  width: number;
  height: number;
  area: number;
  currency: 'INR' | 'USD';
  price: number;
  electricityIncluded?: boolean;
  furnitureIncluded?: boolean;
  internetIncluded?: boolean;
  description?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ExpoStall {
  id: string;
  expoId: string;
  eventId: string;
  stallNumber: string;
  stallTypeId?: string | null;
  sizeLabel?: string | null;
  price: number;
  currency: 'INR' | 'USD';
  status: ExpoStallStatus;
  position: { x: number; y: number };
  width: number;
  height: number;
  rotation: number;
  locked?: boolean;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}
