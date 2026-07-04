# Feibot Config Loading Fix - Complete Guide

## Problem 1: Timing Rules Sync Failing
The timing rules sync was failing with:
```json
{
  "endpoint": "https://apicn.feibot.com/eventConfigFile/timingRulesGet?event_uuid=missing",
  "httpStatus": 400,
  "authentication": "FAILED"
}
```

The `event_uuid` parameter was being passed as "missing" instead of the actual Cloud API Event UUID.

## Problem 2: Health Check Showing Missing Credentials
Even with correct Access Key and Secret Key saved, health-check was showing:
```json
{
  "key": "accessKey",
  "status": "FAIL",
  "message": "Missing"
}
```

## Root Cause Analysis

### Issue 1: Config Structure Mismatch
The `loadFeibotProviderConfig()` function wasn't checking for the new V2 config structure where credentials are stored at `feibotConfig.cloud.eventUuid`.

### Issue 2: KV Sync Gap
The provider-config endpoint saved to **Firestore only** but didn't sync to **Cloudflare Workers KV**. The health-check and contest-mapping endpoints read from KV, not Firestore.

```
Firestore (saved by provider-config endpoint)
    ↓
Cloudflare Workers KV (read by health-check and contest-mapping) ✗ MISSING!
```

## Solutions Applied

### Fix 1: Updated Config Lookup Order
Updated `src/lib/live-tracking/feibotClient.ts` to check the V2 structure first:
```typescript
eventUuid:
  config?.providerConfig?.eventUuid ||
  config?.feibotConfig?.cloud?.eventUuid ||  // ✅ NOW CHECKS V2
  config?.feibotConfig?.eventUuid ||
  config?.eventUuid ||
  "",
```

### Fix 2: Added KV Sync to Provider Config Endpoint
Updated `src/app/api/live/provider-config/[eventId]/route.ts` to sync credentials to KV:
```typescript
// After Firestore save
const kvConfig = {
  provider: 'feibot',
  feibotConfig: {
    accessKey,
    secretKey: encryptedSecret,
    eventUuid: cloudEventUuid,
    apiBaseUrl,
    cloud: { /* ... */ },
    score: { /* ... */ },
  },
};

await putKV(`event:${eventId}:config`, kvConfig, 'api-contest-mapping');
await putKV(`live:event:${eventId}:config`, kvConfig, 'api-contest-mapping');
```

## Data Flow (Now Fixed)

```
Admin Panel (LiveTrackingHub.tsx)
    ↓ [Save button clicked]
Provider Config Endpoint (PUT)
    ↓ [Saves to Firestore]
    ├→ Firestore (events.liveTrackingHub)
    ↓
    └→ Cloudflare Workers KV ✅ NOW SYNCED
        ├→ event:{eventId}:config
        └→ live:event:{eventId}:config
           ↓ [Read by]
           ├→ Health Check Endpoint (reads credentials)
           └→ Contest Mapping Sync (reads timing rules)
```

## Two Different Event UUIDs - Important!

**Cloud API Event UUID** (used for timing rules, participants, results):
- Used with Feibot Cloud API for authentication
- Stored at: `feibotConfig.cloud.eventUuid`
- Example: `7BvuefrS`
- Used in: `/eventConfigFile/timingRulesGet?event_uuid=7BvuefrS`

**Public Score Event UUID** (used only for public score pages):
- Different from Cloud API UUID
- Used to generate public URLs for race scoreboard
- Stored at: `feibotConfig.score.eventUuid`
- Example: `4s48GdoY`
- URLs:
  - Overview: `https://score.feibot.com/?id=4s48GdoY`
  - Progress: `https://score.feibot.com/onlineDateQuery/index.html#/progress/event?event_uuid=4s48GdoY`

## What You Need to Do

1. **Go to Admin Panel** → Live Tracking → Provider Configuration
2. **Enter credentials:**
   - Cloud API Event UUID: `7BvuefrS`
   - Access Key: `fbwb_account_184815e8c0250b37266f693d6555ac7c`
   - Secret Key: `j5gqKsFrLEwTuCtLbm62ozNBQ4NuPC2vY6pCo79vLak`
   - Public Score Event ID: `4s48GdoY`
3. **Click "Save" button** next to each field to persist changes (saves to both Firestore + KV)
4. **Click "Test Connection"** to verify the Feibot API is now reachable
5. **Monitor Contest Sync Result** - should now show:
   - Access Key: ✅ PASS (shows "Configured")
   - Secret Key: ✅ PASS (shows "Configured")
   - Signature: ✅ PASS (shows "Key material available")
   - Event Configuration: ✅ PASS (timing rules fetched successfully)

## Expected Health Check Response (Before Fix)
```json
{
  "success": false,
  "checks": [
    { "key": "accessKey", "status": "FAIL", "message": "Missing" },
    { "key": "secretKey", "status": "FAIL", "message": "Missing" }
  ]
}
```

## Expected Health Check Response (After Fix)
```json
{
  "success": true,
  "checks": [
    { "key": "accessKey", "status": "PASS", "message": "Configured" },
    { "key": "secretKey", "status": "PASS", "message": "Configured" },
    { "key": "timestamp", "status": "PASS", "message": "1782893180" },
    { "key": "signature", "status": "PASS", "message": "Key material available" },
    { "key": "authentication", "status": "PASS", "message": "Connected" },
    { "key": "eventConfiguration", "status": "PASS", "message": "...timing rules fetched..." }
  ]
}
```

## Files Modified
- ✅ `src/app/api/live/provider-config/[eventId]/route.ts` - Added KV sync + import getKV/putKV
- ✅ `src/lib/live-tracking/feibotClient.ts` - Updated config lookup order for V2 structure
- ✅ `src/components/admin/LiveTrackingHub.tsx` - Added Save buttons for quick config updates

## Verification Checklist
- [ ] Cloud API Event UUID saved to database
- [ ] Access Key saved to database
- [ ] Secret Key saved to database
- [ ] Public Score Event UUID saved to database
- [ ] KV entries created: `event:{eventId}:config` and `live:event:{eventId}:config`
- [ ] Test Connection shows all checks PASS
- [ ] Health check response includes credentials
- [ ] Timing Rules request shows correct event_uuid in URL
- [ ] Contest sync completes without authentication errors

## Feibot API Reference
**Timing Rules Endpoint:**
```
GET /eventConfigFile/timingRulesGet?event_uuid=XXXXXXXX
Host: https://apicn.feibot.com

HMAC Signature: GET/eventConfigFile/timingRulesGet{timestamp}event_uuid=XXXXXXXX
Headers:
  X-Feibot-AK: {accessKey}
  X-Feibot-Timestamp: {timestamp}
  X-Feibot-Signature: {hmacSignature}
```

Response includes: `event_uuid`, `timing_rules.contests[]`, `timing_rules.splits[]`, `timing_rules.devices[]`, etc.

## Notes
- The provider-config endpoint now syncs to BOTH Firestore and Cloudflare Workers KV
- Health-check endpoint reads from KV (now populated)
- Contest-mapping endpoint reads from KV (now populated)
- All existing callers work unchanged - they just now get the correct credentials from KV
- KV entries use namespace: `api-contest-mapping`
- Secrets are encrypted before storing to Firestore but decrypted when loading from KV for immediate use
