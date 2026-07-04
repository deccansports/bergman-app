// src/lib/types/analytics.ts
import type { BankDetails } from './volunteer';

export interface AdminAthleteAnalytics {
  totalAthletes: number;
  totalClubsWithAthletes: number;
  signupsToday: number;
  signupsThisWeek: number;
  uniqueAthletesInRaceResults: number;
}

export interface RetentionStats {
  year: number;
  totalAthletesPrevious: number;
  returningAthletes: number;
  dropOffAthletes: number;
  retentionRate: number;
}

export interface CrossEventComparison {
  eventAId: string;
  eventBId: string;
  totalA: number;
  totalB: number;
  overlapCount: number;
  overlapPercentage: number;
  repeatedAthletes: { name: string; email: string; bibA?: string; bibB?: string }[];
}

export interface OverviewMetrics {
  todaysRegistrations: number;
  totalRegistrations: number;
  totalSales: number; 
  todaysRefunds: number; 
  totalFreeRegistrations: number;
  recentTransactions: any[];
  totalRefunds: number;
}

export interface FinancialSummary {
  totalRevenue: number;
  totalOnlineRevenue: number;
  totalOfflineRevenue: number;
  totalTax: number;
  totalFees: number;
  netRevenue: number;
  totalTransactions: number;
}

export interface CancellationEntry {
  id: string;
  userId: string;
  eventId: string;
  participantDocId?: string;
  participantEmail: string;
  participantName: string | null;
  eventName: string;
  eventDate: string;
  currency?: string;                    // 'INR' | 'USD'
  originalAmountPaidPaisa: number;      // paisa for INR, cents for USD
  calculatedRefundAmountPaisa: number;  // paisa for INR, cents for USD
  sourcePaymentId?: string | null;
  sourcePaymentMethod?: string | null;
  sourceInvoiceId?: string | null;
  sourceInvoiceNumber?: string | null;
  refundMode?: 'manual' | 'razorpay_calculated' | 'razorpay_custom' | 'stripe_calculated' | 'stripe_custom' | null;
  refundedAmountPaisa?: number | null;
  refundDestination?: string | null;
  stripeCreditNoteId?: string | null;
  stripeCreditNoteNumber?: string | null;
  stripeCreditNoteStatus?: 'created' | 'failed' | 'skipped' | null;
  stripeCreditNoteError?: string | null;
  zohoCreditNoteId?: string | null;
  zohoCreditNoteNumber?: string | null;
  zohoCreditNoteStatus?: 'created' | 'failed' | 'skipped' | null;
  zohoCreditNoteError?: string | null;
  refundPolicyApplied: string;
  requestedAt: string;
  status: 'Requested' | 'Processing' | 'Refunded' | 'Denied';
  bankDetails: BankDetails | null;
  gstOriginallyPaid: 'Yes' | 'No' | null;
  originalProcessingFeePaidPaisa: number | null;
  createdAt: string;
  updatedAt: string;
  adminNotes: string | null;
  refundInitiatedDate: string | null;
  refundProcessedAt: string | null;
  refundTransactionId: string | null;
  refundRrn?: string | null;
}

export interface GlobalServiceFees {
  Triathlon: ServiceFeeConfig;
  Duathlon: ServiceFeeConfig;
  Swimming: ServiceFeeConfig;
  Marathon: ServiceFeeConfig;
  Cycling: ServiceFeeConfig;
  Other: ServiceFeeConfig;
}

export interface ServiceFeeConfig {
  deferralFeePaisa: number;
  categoryChangeFeePaisa: number;
  deferralFeeUsdCents?: number;       // USD deferral fee, e.g. 5000 = $50
  categoryChangeFeeUsdCents?: number; // USD category-change fee, e.g. 5000 = $50
  minimumAgeYears?: number;
}

export interface CancellationStats {
  totalRequests: number;
  pendingRequests: number;
  processingRefunds: number;
  totalRefundedAmountPaisa: number;
  deniedRequests: number;
}

export interface ActiveCancellationInfo {
  cancellationId: string;
  eventName: string;
  requestedAt: string;
  status: 'Requested' | 'Processing' | 'Refunded' | 'Denied';
  expectedRefundAmountPaisa: number;
  gstOriginallyPaid?: string | null;
  refundInitiatedDate?: string | null;
  refundTransactionId?: string | null;
  refundMode?: 'manual' | 'razorpay_calculated' | 'razorpay_custom' | 'stripe_calculated' | 'stripe_custom' | null;
  refundDestination?: string | null;
  refundedAmountPaisa?: number | null;
  refundProcessedAt?: string | null;
  refundRrn?: string | null;
}

export interface RepeatedAthleteInfo {
  name: string;
  email: string;
  bibA?: string | null;
  bibB?: string | null;
}

export interface ComparisonStats {
  overlapCount: number;
  overlapPercentage: number;
  totalA: number;
  totalB: number;
  repeatedAthletes: RepeatedAthleteInfo[];
}
