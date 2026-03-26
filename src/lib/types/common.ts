// src/lib/types/common.ts

export interface ReminderInfo {
  count: number;
  dates: string[];
}

export type PricingInput = {
  basePrice: number;              // Event / service base fee (in paisa)
  discount?: number;              // Coupon / credit (in paisa)
  
  // These parameters are determined by the event's currency (INR vs USD)
  gatewayRate: number;            // e.g., 0.05 for 5% (INR) or 0.03 for 3% (USD)
  platformFeeBase: number;        // e.g. 2000 for ₹20 (INR) or 0 for USD
  taxEnabled: boolean;            // true for INR, false for USD
  gstRate: number;                // 0.18 for INR, 0 for USD
  currency: 'INR' | 'USD';
};

export interface PricingBreakdown {
  base: number;
  discount: number;
  eventGST: number;
  platformFeeBase: number;
  platformGST: number;
  processingFeeBase: number;
  processingGST: number;
  roundingAdjustment: number;     // Difference between itemized total and rounded total (in paisa)
  totalPayable: number;
  currency: "INR" | "USD";
  gstRate: number;
  version: string;
}

export interface FeeDetails {
  basePricePaisa: number;
  deferralCreditPaisa: number;
  couponDiscountPaisa: number;
  eventBasePaisa: number;
  eventGstPaisa: number;
  processingFeeBasePaisa: number;
  processingGST: number;
  platformFeeBasePaisa: number;
  platformGST: number;
  roundingAdjustmentPaisa: number; // Added for UI and logging
  totalPayablePaisa: number;
}

export type Leg = 'SWIM' | 'T1' | 'BIKE' | 'T2' | 'RUN' | 'RUN1' | 'RUN2' | 'FINISH' | 'FINISHED';
export type Status = 'Not Started' | 'On Course' | 'Finished' | 'DNF' | 'DNQ' | 'DNS' | 'Unknown';
