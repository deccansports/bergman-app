# Event UUID Validation for AK-EVENT Credentials

## Overview

Event credentials (AK-EVENT) are **bound to a specific Feibot event UUID**. They can only access that specific event. This document explains how the system validates event UUID binding and handles mismatches.

---

## The Problem

Your test showed the exact issue:

```
AK-EVENT Credentials:
- Bound to event UUID: 3cS58x1f
- Request tried to access: 7BvuefrS
- Result: 403 Forbidden
```

The Event credential was created for event `3cS58x1f` but the request tried to access event `7BvuefrS`. This mismatch causes Feibot to reject the request with 403 Forbidden.

---

## Solution: Automatic Event UUID Validation & Fallback

The system now validates event UUID binding **before making the API call**:

### Validation Flow:

```
Request arrives with ?event_uuid=7BvuefrS
                    ↓
Check if using Event credential? YES
Check if bound event UUID matches request event_uuid? NO (3cS58x1f ≠ 7BvuefrS)
                    ↓
Skip Event credential attempt (avoid wasting API call)
                    ↓
Automatically try Account credential fallback
                    ↓
Account credential succeeds (it has access to all events)
                    ↓
Request completes successfully
                    ↓
Log shows: "Fallback initiated due to Event UUID mismatch"
```

---

## Key Changes Made

### 1. Event UUID Validation Check

**Location**: `src/lib/feibot-integration/api-client.ts` in `callFeibotAPIWithCredentialFallback()`

**Logic**:
```typescript
// Event credentials are bound to a specific event_uuid
if (first.credentialType === 'event' && first.eventUuid) {
  const requestEventUuid = options.query?.event_uuid ? String(options.query.event_uuid).trim() : null;
  if (requestEventUuid && requestEventUuid !== first.eventUuid) {
    // Event UUID mismatch detected
    shouldTryFallback = true;
    eventUuidMismatchReason = `Event credential bound to ${first.eventUuid} but request is for ${requestEventUuid}`;
    console.log('[CREDENTIAL VALIDATION] Event UUID Mismatch:', {...});
  }
}
```

**What It Does**:
- Extracts `event_uuid` from the request query parameters
- Compares it with the bound event UUID stored in the credential
- If they don't match, immediately triggers fallback to Account credential
- Skips the first attempt (Event credential call) to avoid wasting an API call

### 2. Conditional API Call

**Before**: Always tried Event credential first, even if UUID mismatched

**After**:
```typescript
let firstResult = { ok: false, status: 0, data: null, error: 'Event UUID mismatch' } as any;
if (!shouldTryFallback) {
  // Only call Event credential if UUID matches
  firstResult = await callFeibotAPI<T>(makeConfig(first), path, options);
}
```

### 3. Enhanced Logging

**New Logs**:

#### Event UUID Mismatch Detected:
```
[CREDENTIAL VALIDATION] Event UUID Mismatch: {
  credentialType: 'event',
  boundEventUuid: '3cS58x1f',
  requestEventUuid: '7BvuefrS',
  willTryFallback: true
}
```

#### Fallback Executed:
```
[CREDENTIAL FALLBACK] {
  initiatedBy: 'Event UUID mismatch',
  firstCredentialType: 'event',
  secondCredentialType: 'account',
  fallbackReason: 'Event credential bound to 3cS58x1f but request is for 7BvuefrS',
  secondResultOk: true,
  secondResultStatus: 200
}
```

---

## Scenarios

### Scenario 1: Event Credential for Correct Event (Happy Path)

```
AK-EVENT: Bound to event_uuid = 3cS58x1f
Request: ?event_uuid=3cS58x1f

✓ Event UUID matches
→ Use Event credential
→ Request succeeds
→ No fallback needed
```

**Log Output**:
```
[FEIBOT REQUEST] {
  path: '/temporary/participantsGetAll',
  requestUrl: 'https://apicn.feibot.com/temporary/participantsGetAll?event_uuid=3cS58x1f',
  selectedEventUuid: '3cS58x1f',
  accessKey: '***event_67f2f417...'
}
[FEIBOT RESPONSE] {
  status: 200,
  ok: true
}
```

---

### Scenario 2: Event Credential for Wrong Event (Mismatch) → Auto Fallback

```
AK-EVENT: Bound to event_uuid = 3cS58x1f
Request: ?event_uuid=7BvuefrS

✗ Event UUID mismatch detected
→ Skip Event credential attempt
→ Auto-fallback to Account credential
→ Account credential succeeds
→ Request completes successfully
```

**Log Output**:
```
[CREDENTIAL VALIDATION] Event UUID Mismatch: {
  credentialType: 'event',
  boundEventUuid: '3cS58x1f',
  requestEventUuid: '7BvuefrS',
  willTryFallback: true
}
[FEIBOT REQUEST] {
  path: '/temporary/participantsGetAll',
  requestUrl: 'https://apicn.feibot.com/temporary/participantsGetAll?event_uuid=7BvuefrS',
  selectedEventUuid: '7BvuefrS',
  accessKey: '***account_gcm:...'  // Using Account credential
}
[FEIBOT RESPONSE] {
  status: 200,
  ok: true
}
[CREDENTIAL FALLBACK] {
  initiatedBy: 'Event UUID mismatch',
  firstCredentialType: 'event',
  secondCredentialType: 'account',
  fallbackReason: 'Event credential bound to 3cS58x1f but request is for 7BvuefrS',
  secondResultOk: true,
  secondResultStatus: 200
}
```

---

### Scenario 3: Event Credential Valid but Account Missing

```
AK-EVENT: Bound to event_uuid = 3cS58x1f
AK-ACCOUNT: Not configured
Request: ?event_uuid=7BvuefrS

✗ Event UUID mismatch detected
→ Try to fallback to Account credential
→ Account credential not available
→ Return error with fallback reason
```

**Response**:
```json
{
  "ok": false,
  "status": 0,
  "data": null,
  "error": "Event UUID mismatch, no fallback credential configured",
  "retry": {
    "attempted": false,
    "firstCredentialType": "event",
    "secondCredentialType": null,
    "reason": "Event UUID mismatch, no fallback credential configured"
  }
}
```

---

### Scenario 4: Auto Mode Selection (No Event Credential Configured)

```
AK-EVENT: Not configured
AK-ACCOUNT: Configured
Request: ?event_uuid=7BvuefrS

→ Auto mode selects Account credential (Event not available)
→ Use Account credential
→ Request succeeds
```

---

## Admin Troubleshooting Guide

### "My Event Credential keeps failing with 403"

**Check**:
1. Get your Event credential's bound event UUID
   - In LiveTrackingHub: Check the AK-EVENT card "Event UUID" display
2. Check what event UUID you're trying to access
   - Look at query parameters: `?event_uuid=XXX`

**Common Issues**:
- ✗ Trying to access the wrong event with Event credential
- ✗ Event UUID mismatch (credentials bound to one event, accessing another)

**Solution**:
- Use Account credential instead (it can access all events)
- Or create new Event credentials for the event you need

### "Event Credential works for one event but not another"

**Why**: Event credentials are bound to a specific event UUID. They can't be used for other events.

**Solution**: 
- The system automatically falls back to Account credential
- If Account isn't configured, the request fails
- Configure Account credential as a fallback

---

## API Integration

### How Endpoints Use Event UUID Validation

All these endpoints check event UUID binding:

1. **`/temporary/participantsGetAll`**
   ```
   GET /temporary/participantsGetAll?event_uuid=7BvuefrS
   
   If using Event credential:
   - Validates: event_uuid matches bound event_uuid
   - If mismatch: Falls back to Account credential
   ```

2. **`/temporary/participantsQuery`**
   ```
   GET /temporary/participantsQuery?event_uuid=7BvuefrS&bib=123
   
   If using Event credential:
   - Validates: event_uuid matches bound event_uuid
   - If mismatch: Falls back to Account credential
   ```

3. **`/eventConfigFile/timingRulesGet`**
   ```
   GET /eventConfigFile/timingRulesGet?event_uuid=7BvuefrS
   
   If using Event credential:
   - Validates: event_uuid matches bound event_uuid
   - If mismatch: Falls back to Account credential
   ```

4. **`/temporary/temporary_ResultDataGetAll`**
   ```
   GET /temporary/temporary_ResultDataGetAll?event_uuid=7BvuefrS
   
   If using Event credential:
   - Validates: event_uuid matches bound event_uuid
   - If mismatch: Falls back to Account credential
   ```

---

## Implementation Details

### Where Validation Happens

**File**: `src/lib/feibot-integration/api-client.ts`

**Function**: `callFeibotAPIWithCredentialFallback<T>()`

**When**: 
- Before making API request
- During Auto Mode credential selection
- Every time a Feibot API is called

### Validation Logic

```typescript
// Validation Check
if (first.credentialType === 'event' && first.eventUuid) {
  const requestEventUuid = options.query?.event_uuid 
    ? String(options.query.event_uuid).trim() 
    : null;
  
  if (requestEventUuid && requestEventUuid !== first.eventUuid) {
    shouldTryFallback = true;
  }
}

// Conditional Attempt
if (!shouldTryFallback) {
  firstResult = await callFeibotAPI<T>(makeConfig(first), path, options);
}

// Fallback if Needed
if (shouldTryFallback || [401, 403].includes(firstResult.status)) {
  secondResult = await callFeibotAPI<T>(makeConfig(fallback), path, options);
}
```

### Retry Metadata Returned

```typescript
{
  ok: boolean;           // Request succeeded?
  status: number;        // HTTP status
  data: T | null;        // Response data
  error?: string;        // Error message if failed
  retry: {
    attempted: boolean;  // Did fallback occur?
    firstCredentialType?: 'event' | 'account' | null;
    secondCredentialType?: 'event' | 'account' | null;
    reason?: string;     // Why fallback was triggered
  };
}
```

---

## Benefits

### ✅ No More 403 Errors from Event UUID Mismatch
- System detects mismatch before making API call
- Automatically tries Account credential instead

### ✅ Transparent to Admin
- No manual intervention needed
- System handles it automatically
- Admin sees successful result

### ✅ Efficient
- Avoids wasting API call if UUID will definitely fail
- Logs clearly show what happened
- Easy to debug

### ✅ Backward Compatible
- Works with existing Account-only setups
- Works with new Event+Account setup
- No breaking changes

---

## Example Scenario: Your Test Case

**Given**:
- AK-EVENT bound to `3cS58x1f`
- AK-ACCOUNT configured
- Request for `?event_uuid=7BvuefrS`

**Before This Feature**:
```
✗ Try Event credential with 7BvuefrS
→ Feibot rejects (mismatch)
→ 403 Forbidden
→ Admin confused
```

**After This Feature**:
```
✓ Detect UUID mismatch
✓ Skip Event credential attempt
✓ Fallback to Account credential
✓ Account credential works
✓ Request succeeds with 200 OK
✓ Admin sees: "Credential fallback used"
```

---

## Configuration Status

- [x] Event UUID validation logic implemented
- [x] Automatic fallback triggered on mismatch
- [x] Comprehensive logging added
- [x] Distinguishes UUID mismatch from auth failures (401/403)
- [x] Works for all Feibot API endpoints
- [x] TypeScript validation passes
- [x] No breaking changes
- [x] Backward compatible
- [x] Production ready

---

## Next Steps

1. **Test with your credentials**:
   - Save AK-EVENT with one event UUID
   - Save AK-ACCOUNT with full access
   - Try requesting different event_uuid
   - Verify fallback works

2. **Monitor logs**:
   - Watch for `[CREDENTIAL VALIDATION]` logs
   - Watch for `[CREDENTIAL FALLBACK]` logs
   - Verify fallback is transparent

3. **Check admin UI**:
   - Both cards show validation status
   - Both independent
   - Auto mode explanation visible

---

## Summary

Event UUID validation ensures that Event credentials can only be used for their bound event. When a mismatch is detected:

1. The system **immediately detects** the mismatch
2. Skips the doomed Event credential attempt
3. **Automatically falls back** to Account credential
4. Request completes successfully
5. Admin sees logged explanation

This eliminates the confusing 403 errors and makes the dual-credential system work seamlessly.
