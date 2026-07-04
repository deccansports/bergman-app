# Invoice Sync Debugging - Enhanced Logging Trace

**Date:** April 19, 2026  
**Issue:** Invoice not created after registration and payment capture  
**Status:** ✅ Enhanced logging added for debugging

## Problem Statement

Registrations complete successfully and payments are captured, but invoices are not being created in Zoho. The flow appears to be:

1. ✅ Registration form submitted
2. ✅ Payment initiated via Razorpay
3. ✅ Payment captured (`POST /dashboard?payment=processing&type=registration`)
4. ❌ **Invoice NOT created** (no invoice in Zoho, no email sent)

## Root Cause Investigation

The issue could occur at multiple points in the pipeline. Enhanced logging has been added to trace the entire flow:

### 1. **Razorpay Webhook** → Registration Finalization
- File: `/src/app/api/webhooks/razorpay/route.ts`
- Trigger: `payment.captured` webhook event
- Action: Mark attempt as `PaymentCaptured`, call `submitPublicEventRegistrationAction`

### 2. **Finalization Engine** → Participant Creation  
- File: `/src/lib/registrationEngine/finalizeRegistration.ts`
- Trigger: Called with `registrationAttemptId`
- Action: Create participant record, trigger invoice sync

### 3. **Zoho Sync Routing** → Currency Detection
- File: `/src/lib/registrationEngine/zohoSync.ts`
- Trigger: `syncRegistrationToZoho()` called after participant created
- Decision Point: Route to Zoho (INR) or Stripe (USD)

### 4. **Invoice Actions** → Zoho API Calls
- File: `/src/lib/actions/invoiceActions.ts`
- Trigger: `syncPaymentToZohoAction()` called for Zoho invoices
- Action: Create invoice in Zoho, apply payment, deliver notifications

## Enhanced Logging Points

### Phase 1: Razorpay Webhook Processing

```typescript
// File: /src/app/api/webhooks/razorpay/route.ts

console.log(`${actionName} 🔥 Processing attempt: ${registrationAttemptId}`);

// After fetching attempt from Firestore:
console.log(`${actionName} Fetched attempt:`, JSON.stringify(attemptData, null, 2));

// When updating status:
console.log(`${actionName} ℹ️ Updating attempt status to PaymentCaptured...`);
console.log(`${actionName} ✅ Status updated to PaymentCaptured`);

// When calling finalization:
console.log(`${actionName} 🚀 Calling submitPublicEventRegistrationAction(${registrationAttemptId})...`);
console.log(`${actionName} Result:`, JSON.stringify(result, null, 2));

// On success:
console.log(`${actionName} ✅ Participant created: ${result.participantId}, Booking: ${result.bookingId}`);
console.log(`${actionName} ✅ Registration completed successfully`);
```

**Expected Log Output:**
```
[Razorpay Webhook] 🔥 Processing attempt: order_xxx
[Razorpay Webhook] Fetched attempt: { "eventId": "bmpo2026", "participantId": null, "status": "PaymentInitiated", ... }
[Razorpay Webhook] ℹ️ Updating attempt status to PaymentCaptured...
[Razorpay Webhook] ✅ Status updated to PaymentCaptured
[Razorpay Webhook] 🚀 Calling submitPublicEventRegistrationAction(order_xxx)...
[Razorpay Webhook] ✅ Participant created: participant_123, Booking: BMINXXXXX
[Razorpay Webhook] ✅ Registration completed successfully
```

### Phase 2: Invoice Sync Routing Decision

```typescript
// File: /src/lib/registrationEngine/zohoSync.ts

console.log(`[${actionName}] Participant data:`, JSON.stringify({
  zohoSynced: participant?.zohoSynced,
  invoiceId: participant?.invoiceId,
  currency: participant?.pricingBreakdown?.currency,
  country: participant?.country
}, null, 2));

console.log(`[${actionName}] 🔍 Routing Decision:`);
console.log(`[${actionName}] - PaymentCurrency: "${paymentCurrency}"`);
console.log(`[${actionName}] - IsExplicitlyUSD: ${isExplicitlyUSD}`);
console.log(`[${actionName}] - IsExplicitlyNonINR: ${isExplicitlyNonINR}`);
console.log(`[${actionName}] - EventCountry: ${eventData?.country}`);
console.log(`[${actionName}] - ParticipantCountry: ${participant?.country}`);
console.log(`[${actionName}] - UseStripeInvoice: ${useStripeInvoice}`);

// Then routes to appropriate system:
console.log(`[${actionName}] 📊 Routing to Stripe invoice...`);  // OR
console.log(`[${actionName}] 🚀 Routing to Zoho invoice sync...`);
```

**Expected Log Output:**
```
[syncRegistrationToZoho] Participant data: {
  "zohoSynced": false,
  "invoiceId": null,
  "currency": "INR",
  "country": "India"
}
[syncRegistrationToZoho] 🔍 Routing Decision:
[syncRegistrationToZoho] - PaymentCurrency: "INR"
[syncRegistrationToZoho] - IsExplicitlyUSD: false
[syncRegistrationToZoho] - IsExplicitlyNonINR: false
[syncRegistrationToZoho] - EventCountry: India
[syncRegistrationToZoho] - ParticipantCountry: India
[syncRegistrationToZoho] - UseStripeInvoice: false
[syncRegistrationToZoho] 🚀 Routing to Zoho invoice sync for registration attempt order_xxx
```

### Phase 3: Zoho Invoice Creation

```typescript
// File: /src/lib/actions/invoiceActions.ts

console.log(`[${actionName}] 🚀 Starting Zoho sync for participant ${participantId} in event ${eventId}`);
console.log(`[${actionName}] Participant loaded: ${reg.name}, bookingId: ${reg.bookingId}, zohoSynced: ${reg.zohoSynced}`);
console.log(`[${actionName}] Checking invoice routing strategy...`);
console.log(`[${actionName}] Currency check: paymentCurrency="${paymentCurrency}", isInrPayment=${isInrPayment}`);

// If already synced:
console.log(`[${actionName}] ℹ️ Invoice already synced (idempotent): ${reg.invoiceNumber || reg.invoiceId}`);

// If recovering existing:
console.log(`[${actionName}] Checking for existing invoice by reference: ${bookingId}`);
console.log(`[${actionName}] ✅ Found existing invoice: ${existingInvoice.invoice_number}`);

// When creating new invoice:
console.log(`[Zoho Sync B2B] Creating invoice for ${bookingId}:`, JSON.stringify(payload, null, 2));
// OR
console.log(`[Zoho Sync B2C] Creating invoice for ${bookingId}:`, JSON.stringify(b2cPayload, null, 2));

// On success:
console.log(`[Zoho Sync] Invoice ${invoice.invoice_number} created and participant updated for ${bookingId}.`);
```

## Logging Levels & Icons

| Icon | Meaning | Action |
|------|---------|--------|
| 🔥 | Critical Event | Processing has started - key milestone |
| 🚀 | Forward Progress | System is progressing through pipeline |
| ✅ | Success | Step completed successfully |
| ⚠️ | Warning | Potential issue or duplicate/idempotent |
| ℹ️ | Info | Informational status update |
| ❌ | Error | Something failed (check message) |
| 🔍 | Investigation | Showing detailed decision data |
| 📊 | Routing | Choosing between systems (Stripe vs Zoho) |

## Common Failure Scenarios & Diagnostics

### Scenario 1: Webhook Not Triggered

**Symptoms:**
- No logs from Razorpay webhook
- Participant not created
- Status stays at `PaymentInitiated`

**Check:**
1. Razorpay webhook configuration in dashboard
2. Network connectivity to webhook URL
3. RAZORPAY_WEBHOOK_SECRET environment variable set
4. Check Razorpay event logs for `payment.captured` events

**Logs to Look For:**
- None from `[Razorpay Webhook]` means webhook didn't fire

### Scenario 2: Webhook Fired But Finalization Failed

**Symptoms:**
- Logs show: `[Razorpay Webhook] 🔥 Processing attempt: order_xxx`
- But then no `✅ Participant created` log
- Error in webhook processing

**Check:**
1. Look for error in webhook response
2. Verify `registrationAttemptId` exists in Firestore
3. Check Firebase permissions
4. Look for error logs from `submitPublicEventRegistrationAction`

**Logs to Look For:**
```
[Razorpay Webhook] ❌ CRITICAL ERROR: ...
// or
[Razorpay Webhook] Result: { "success": false, "message": "..." }
```

### Scenario 3: Participant Created But Invoice Sync Failed

**Symptoms:**
- Logs show: `✅ Participant created: participant_123`
- But no invoice created in Zoho
- No email sent to participant

**Check:**
1. Look for Zoho routing logs
2. Check currency/country fields on participant
3. Verify Zoho API credentials
4. Check if invoices are being created in Stripe instead

**Logs to Look For:**
```
[syncRegistrationToZoho] 🔍 Routing Decision:
[syncRegistrationToZoho] - UseStripeInvoice: false
[syncRegistrationToZoho] 🚀 Routing to Zoho invoice sync...
[syncPaymentToZohoAction] 🚀 Starting Zoho sync...
[Zoho Sync] Invoice INV-xxx created and participant updated
```

### Scenario 4: Currency Routing Issue

**Symptoms:**
- Participant has empty or missing currency
- Invoice going to Stripe instead of Zoho
- No Zoho invoice created

**Check:**
1. Verify `pricingBreakdown.currency` is set to 'INR'
2. Verify event country is 'India' or blank
3. Check routing decision logs for UseStripeInvoice value

**Logs to Look For:**
```
[syncRegistrationToZoho] - PaymentCurrency: ""
[syncRegistrationToZoho] - UseStripeInvoice: true  // ❌ Should be false for India
[syncRegistrationToZoho] 📊 Routing to Stripe invoice...  // ❌ Wrong!
```

## How to Debug Invoice Sync Issues

### Step 1: Check Razorpay Webhook
1. Open server logs (terminal running `npm run dev`)
2. Look for logs starting with `[Razorpay Webhook]`
3. Verify payment was captured (should see `PaymentCaptured`)

### Step 2: Check Finalization
1. Look for `[finalizeRegistration]` logs
2. Verify participant was created (`✅ Invoice sync started for participant`)
3. Check if `🚀 Starting invoice sync` appears

### Step 3: Check Zoho Routing
1. Look for `[syncRegistrationToZoho]` logs
2. Verify routing decision (should show `UseStripeInvoice: false` for India)
3. Check if `🚀 Routing to Zoho` or `📊 Routing to Stripe` was chosen

### Step 4: Check Zoho Invoice Creation
1. Look for `[syncPaymentToZohoAction]` or `[Zoho Sync]` logs
2. Verify invoice was created (`Invoice INV-xxx created`)
3. Check for any Zoho API errors (403, 401, etc.)

### Step 5: Check Email Delivery
1. Look for `[sendWaiverCheckedInEmail]` or `[sendInvoiceEmailBrevoAction]` logs
2. Verify email was sent to participant

### Step 6: Verify in Zoho Dashboard
1. Go to Zoho Books
2. Search for invoice by booking ID (e.g., `BMINXXXXX`)
3. Check if invoice was created and payment was applied

## To Enable Full Debug Logging

Add this to `.env.local`:

```bash
DEBUG=syncRegistrationToZoho,syncPaymentToZohoAction,finalizeRegistration,Razorpay*
```

Then restart: `npm run dev`

## Production Deployment Note

⚠️ These logs are comprehensive and helpful for debugging but may impact performance. Consider:
- Reducing log verbosity in production
- Using structured logging with severity levels
- Sending logs to a centralized logging service
- Setting up alerts for ❌ and ⚠️ level logs

## Related Documentation

- [Invoice Sync Fix (April 19)](INVOICE_SYNC_FIX_APRIL_19.md)
- [USA Waiver Check-in Email](USA_WAIVER_CHECKIN_EMAIL.md)
- [Razorpay Webhook Route](src/app/api/webhooks/razorpay/route.ts)
- [Finalization Engine](src/lib/registrationEngine/finalizeRegistration.ts)
- [Zoho Sync](src/lib/registrationEngine/zohoSync.ts)
- [Invoice Actions](src/lib/actions/invoiceActions.ts)
