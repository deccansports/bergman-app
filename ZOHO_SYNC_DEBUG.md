# Zoho Sync 400 Error - Debug & Fix Summary

## Issue Identified
**Status Code:** 400 Bad Request  
**Participant:** Debashis Sahu (ID: MI925nv0FINnABx4wpwBTDSUipc2)  
**Booking ID:** BMINH2JDG  
**Amount:** ₹3,120.00 (312000 paise)

## Root Cause Analysis

A 400 error from Zoho typically indicates **invalid request payload validation failure**. Possible causes:

1. **Missing Required Fields**
   - `customer_id` not found or invalid
   - `line_items` array empty or malformed
   - Invalid field values for B2C vs B2B invoicing

2. **Field Validation Issues**
   - Line item rates are invalid (negative, zero, or wrong format)
   - `gst_treatment` mismatch (consumer vs business_gst)
   - `is_inclusive_tax` flag inconsistent with line items
   - HSN/SAC codes for B2B invoices might be invalid

3. **Data Type Mismatches**
   - Numeric fields as strings instead of floats
   - Date format incorrect (should be YYYY-MM-DD)
   - Boolean fields passed as strings

## Fixes Applied

### 1. **Enhanced Logging** (`src/lib/actions/invoiceActions.ts`)
- Added detailed console logging for B2B and B2C invoice payloads
- Logs full JSON structure before sending to Zoho
- Captures error code, message, and full error object
- Provides booking ID and participant context in error messages

**Example log output:**
```
[Zoho Sync B2C] Creating invoice for BMINH2JDG: {
  "customer_id": "834747000001556127",
  "reference_number": "BMINH2JDG",
  "date": "2026-03-26",
  "gst_treatment": "consumer",
  "is_inclusive_tax": true,
  "line_items": [...]
}
```

### 2. **Payload Validation** (`src/lib/zoho/invoice.ts`)
Added strict validation before API call:
- ✅ `customer_id` is required
- ✅ `reference_number` is required
- ✅ `line_items` must be non-empty array
- ✅ Each line item must have `name`, `rate`, and `quantity`

Catches validation errors **before** sending to Zoho API:
```typescript
if (!item.name) throw new Error(`Zoho Invoice Error: line_item[${index}] missing name.`);
if (item.rate === undefined) throw new Error(`Zoho Invoice Error: line_item[${index}] missing rate.`);
```

### 3. **Improved Error Context** (`src/lib/actions/invoiceActions.ts`)
Enhanced catch block captures:
- Error code from Zoho API
- Original error message
- Full error object for inspection
- Stores detailed error in Firestore for audit trail

## Debugging Tools Created

### `debugZohoSyncAction(eventId, participantId)`
Manually trigger Zoho sync with detailed diagnostics:
```typescript
const result = await debugZohoSyncAction('4cEm8JPYbpupoFRMDLc1', 'MI925nv0FINnABx4wpwBTDSUipc2');
// Returns: { success, message, details: { syncResult, currentZohoError, bookingId, ... } }
```

**What it checks:**
- Participant data exists
- Pricing breakdown is populated
- Previous sync errors
- All required fields present

### `testZohoConnectionAction()`
Verify Zoho API credentials and connectivity:
```typescript
const connection = await testZohoConnectionAction();
// Returns: { success, message, details: { orgId, contactsCount, ... } }
```

**Useful for:**
- Verifying API keys are valid
- Testing org ID configuration
- Checking if Zoho API is reachable

### `retryFailedZohoSyncsAction(eventId)`
Batch retry all failed syncs for an event:
```typescript
const retry = await retryFailedZohoSyncsAction('4cEm8JPYbpupoFRMDLc1');
// Returns: { success, message, details: { retried, success, failed, errors } }
```

**Automatically:**
- Finds all participants with `zohoSynced: false`
- Attempts sync (up to 10 at a time)
- Logs individual successes and failures
- Safe to run multiple times (idempotent)

## Next Steps to Diagnose

### If you're still seeing the 400 error:

1. **Check the logs** - New detailed logging will show the exact payload being sent
2. **Run diagnostic** - Execute:
   ```typescript
   const debug = await debugZohoSyncAction(eventId, participantId);
   console.log(debug);
   ```
3. **Verify Zoho connection** - Execute:
   ```typescript
   const test = await testZohoConnectionAction();
   ```
4. **Check field values** - Verify:
   - All prices are properly formatted (paise → rupees division)
   - Customer exists in Zoho (should auto-create if missing)
   - GST fields match B2B/B2C classification
   - HSN/SAC codes are valid (if B2B)

## Key Fixes Summary

| Issue | Fix |
|-------|-----|
| Silent failures | Added comprehensive logging at every step |
| Invalid payload | Added validation before API call |
| Cryptic errors | Enhanced error messages with context |
| Hard to retry | Added batch retry action |
| No diagnostics | Added debug actions for manual testing |

## Testing

All changes compile successfully:
- ✅ `npm run lint` - No ESLint errors
- ✅ `npm run typecheck` - TypeScript passes
- ✅ `npm run build` - Build succeeds

---

**Note:** The participant record shows `zohoSyncError: "Request failed with status code 400"` - the new logging will help identify exactly which field in the payload is causing this validation failure.
