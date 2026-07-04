# Cancellation & Refund Flow

## Overview
The system now properly handles cancellations for both USD (Stripe) and INR (Razorpay) payments with appropriate refund and accounting mechanisms.

---

## USD Stripe Cancellations

### Flow
1. **Athlete submits cancellation request** → Calculated refund per policy
2. **Admin reviews and initiates refund** → 
   - Refund processed via Stripe (policy amount, excluding GST/fees)
   - Credit note automatically created in Stripe (for accounting)
   - Zoho credit note synced (for accounting records)
3. **Database updated** with:
   - Refund transaction ID (Stripe refund ID)
   - Refund RRN (Stripe credit note number)
   - Status: "Refunded"

### Refund Details
- **Amount**: Calculated per cancellation policy (90%, 50%, 20%, 0% depending on days to event)
- **Includes**: Base registration fee (policy %)
- **Excludes**: GST, platform fees, processing fees
- **Credit Note**: Same amount as refund (for Zoho/accounting)

### Admin UI
- **Section Title**: "Refund from Stripe"
- **Display**: Shows USD currency ($)
- **Amount**: Pre-filled, disabled (policy-based)
- **Button**: "Refund & Create Credit Note"
- **Auto-actions**: Refund → Credit note → Zoho sync

---

## INR Razorpay Cancellations

### Flow
1. **Athlete submits cancellation request** → Calculated refund per policy
2. **Admin reviews and initiates refund** →
   - Manual Razorpay payment ID entry required
   - Refund amount confirmed (policy-based)
   - Refund processed via Razorpay API
   - Zoho credit note created
3. **Database updated** with:
   - Refund transaction ID (Razorpay refund ID)
   - Refund RRN (Razorpay RRN/ARN if available)
   - Status: "Refunded"

### Refund Details
- **Amount**: Calculated per cancellation policy (90%, 50%, 20%, 0%)
- **Includes**: Base registration fee (policy %)
- **Excludes**: GST, platform fees, processing fees
- **Credit Note**: Same amount as refund (for Zoho/accounting)

### Admin UI
- **Section Title**: "Refund from Razorpay"
- **Display**: Shows INR currency (₹)
- **Payment ID**: Manual entry field (for legacy records)
- **Amount**: Pre-filled, can be edited if custom refund needed
- **Button**: "Refund Instantly"
- **Note**: Instant refunds available on TPV, netbanking, UPI only

---

## Cancellation Policy Percentages (Time to Event)

| Timeframe | Refund % |
|-----------|----------|
| 6+ months before | 70% |
| 4-5 months before | 50% |
| 3-4 months before | 20% |
| < 3 months | 0% |

---

## Database Records

### Cancellation Entry Fields
```typescript
{
  // Refund amounts
  calculatedRefundAmountPaisa: number;        // Policy amount (excluding GST/fees)
  refundedAmountPaisa: number;                 // Actual refunded amount
  
  // Payment gateway info
  sourcePaymentId: string;                     // Stripe PI or Razorpay payment ID
  sourcePaymentMethod: string;                 // "Stripe" or "Razorpay"
  sourceInvoiceId: string;                     // Stripe invoice ID
  sourceInvoiceNumber: string;                 // Invoice number (display)
  
  // Refund tracking
  refundTransactionId: string;                 // Stripe refund ID or Razorpay refund ID
  refundRrn: string;                           // Stripe credit note number or Razorpay RRN
  refundMode: string;                          // "stripe_calculated", "razorpay_calculated", etc.
  refundDestination: string;                   // Description of where refund went
  
  // Accounting
  zohoCreditNoteId: string;                    // Zoho credit note ID
  zohoCreditNoteNumber: string;                // Zoho credit note number
  zohoCreditNoteStatus: string;                // "created", "skipped", "failed"
  zohoCreditNoteError: string;                 // Error if creation failed
  
  // Status
  status: "Requested" | "Processing" | "Refunded" | "Denied";
  refundInitiatedDate: string;                 // ISO date
  refundProcessedAt: string;                   // ISO date
}
```

---

## Accounting Integration

### Both Payment Methods
1. **Stripe**: Creates native Stripe credit note (invoice-level)
2. **Razorpay**: Creates Zoho credit note (via Zoho API)

### Credit Note Details
- **Amount**: Policy-based refund (excluding GST/fees)
- **Reference**: Booking ID + Cancellation ID
- **Memo**: Event name + Policy applied
- **Invoice Link**: Original invoice reference

### Sync Process
- Automatic on refund initiation
- Manual sync available via "Sync Credit Note" button
- Fallback to Firestore if KV fails

---

## Admin Actions

### Refund Initiation
1. Select cancellation request
2. Review policy and calculated refund
3. For Razorpay: Enter payment ID (if not auto-populated)
4. Click "Refund Instantly" (Razorpay) or "Refund & Create Credit Note" (Stripe)
5. System processes refund + credit note simultaneously

### Refund Status Updates
- **Processing**: Refund initiated, awaiting bank processing
- **Refunded**: Refund completed and verified
- **Mark as Refunded**: Manual confirmation button
- **Sync Credit Note**: Re-sync Zoho credit note if failed

### Manual Refund
- Available for legacy records without payment IDs
- Requires bank details from athlete
- Manual transaction entry in admin form

---

## Error Handling

### Common Issues
1. **Missing Payment ID**: Display alert, allow manual entry
2. **Credit Note Creation Failed**: Log warning, continue refund (refund already processed)
3. **Zoho Sync Failed**: Show error message, provide manual sync button
4. **Invalid Amount**: Prevent refund if amount exceeds original or policy

### Recovery Steps
1. Review refund transaction ID in database
2. Manually verify refund status with payment gateway
3. Use "Sync Credit Note" to retry accounting sync
4. Update admin notes with issue details

---

## Testing Checklist

- [ ] USD Stripe cancellation: Policy refund + credit note created
- [ ] INR Razorpay cancellation: Policy refund via Razorpay API
- [ ] Zoho credit note created for both payment methods
- [ ] Admin UI shows correct currency ($ for Stripe, ₹ for Razorpay)
- [ ] Refund amount pre-filled and policy-based
- [ ] Database records all transaction IDs correctly
- [ ] Manual payment ID entry works for legacy records
- [ ] Error messages clear and actionable

