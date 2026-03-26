// src/lib/pricingEngine.ts
import type { PricingInput, PricingBreakdown } from './types';

// Helper function to round to the nearest paisa/cent
function roundToSmallestUnit(n: number) {
  return Math.round(n);
}

/**
 * PRODUCTION PRICING ENGINE
 * Calculates itemized breakdown and applies whole-rupee rounding for INR.
 */
export function calculatePricing(input: PricingInput): PricingBreakdown {
  const { 
    basePrice, 
    discount = 0, 
    gatewayRate, 
    platformFeeBase, 
    taxEnabled, 
    gstRate,
    currency,
  } = input;

  const basePricePaisa = basePrice;
  const discountPaisa = discount;
  const platformFeePaisa = platformFeeBase;

  // Step 1: Effective Base Price after discount
  const netTicketValue = Math.max(0, basePricePaisa - discountPaisa);
  
  // Step 2: Event GST (calculated on the discounted price)
  const eventGST = taxEnabled ? roundToSmallestUnit(netTicketValue * gstRate) : 0;
  
  // Step 3: Platform Fee GST
  const platformGST = taxEnabled ? roundToSmallestUnit(platformFeePaisa * gstRate) : 0;

  // Step 4: Processing Fee (Calculated on the NetTicketValue)
  const processingFeeBase = roundToSmallestUnit(netTicketValue * gatewayRate);
  
  // Step 5: Processing Fee GST
  const processingGST = taxEnabled ? roundToSmallestUnit(processingFeeBase * gstRate) : 0;
  
  // Step 6: Raw Total (Sum of all components before rounding)
  const rawTotalPayable = netTicketValue + eventGST + platformFeePaisa + platformGST + processingFeeBase + processingGST;
  
  // Step 7: Apply Whole Rupee Rounding for INR
  // Rule: >= 0.50 round up, < 0.50 round down
  let finalTotalPayable = rawTotalPayable;
  let roundingAdjustment = 0;

  if (currency === 'INR') {
    finalTotalPayable = Math.round(rawTotalPayable / 100) * 100;
    roundingAdjustment = finalTotalPayable - rawTotalPayable;
  }
  
  return {
    base: basePricePaisa,
    discount: discountPaisa,
    eventGST,
    platformFeeBase: platformFeePaisa,
    platformGST,
    processingFeeBase,
    processingGST,
    roundingAdjustment,
    totalPayable: Math.max(0, finalTotalPayable),
    currency,
    gstRate,
    version: "v3.0.0",
  };
}
