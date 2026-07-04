# Feibot Config and Signature Fix - Complete Implementation

## Three Critical Fixes Applied

### Fix 1: Config Structure Mismatch (feibotClient.ts)
**Problem:** `eventUuid` loading from wrong config path  
**Solution:** Check V2 structure `feibotConfig.cloud.eventUuid`

```typescript
eventUuid:
  config?.providerConfig?.eventUuid ||
  config?.feibotConfig?.cloud?.eventUuid ||  // ✅ NOW CHECKS V2
  config?.feibotConfig?.eventUuid ||
  config?.eventUuid ||
  "",
```

### Fix 2: KV Sync Gap (provider-config endpoint)
**Problem:** Credentials saved to Firestore only, not synced to KV  
**Solution:** Sync config to Cloudflare Workers KV after save

```typescript
await putKV(`event:${eventId}:config`, kvConfig, 'api-contest-mapping');
await putKV(`live:event:${eventId}:config`, kvConfig, 'api-contest-mapping');
```

### Fix 3: Signature Details Not Returned (feibotClient.ts)
**Problem:** Admin panel showing "Unix Timestamp: —", "String To Sign: —", "Signature Length: —"  
**Solution:** Return signature details from `feibotRequest()` and include in sync response

**Before:**
```typescript
return {
  ok: response.ok,
  status: response.status,
  text,
  data,
};
```

**After:**
```typescript
return {
  ok: response.ok,
  status: response.status,
  text,
  data,
  timestamp,           // ✅ NEW
  stringToSign,        // ✅ NEW
  signature,           // ✅ NEW
  signatureLength,     // ✅ NEW
};
```

## Data Flow (Now Complete)

```
Admin Panel
    ↓
Provider Config Endpoint (PUT)
    ├→ Saves to Firestore ✅
    └→ Syncs to KV ✅
         ↓
    Health Check (reads from KV) ✅
    Contest Mapping Sync (reads from KV)
         ├→ Call feibotRequest()
         │  ├→ Build HMAC signature ✅
         │  ├→ Send X-Feibot-* headers ✅
         │  └→ Return signature details ✅
         └→ Capture in sync response
            ├→ timestamp
            ├→ stringToSign
            └→ signatureLength
                ↓
            Display in admin panel ✅
```

## Files Modified

### 1. `src/lib/live-tracking/feibotClient.ts`
- ✅ Added checks for `config?.feibotConfig?.cloud?.*` structure
- ✅ Modified `feibotRequest()` to return signature details

### 2. `src/app/api/live/provider-config/[eventId]/route.ts`
- ✅ Added import: `import { getKV, putKV } from '@/lib/cloudflare/kv'`
- ✅ Added KV sync after Firestore save

### 3. `src/app/api/live/contest-mapping/[eventId]/route.ts`
- ✅ Added signature details to sync response `compare` object:
  - `timestamp`
  - `stringToSign`
  - `signatureLength`

### 4. `src/components/admin/LiveTrackingHub.tsx`
- ✅ Added Save buttons for Access Key and Secret Key
- ✅ Added Save button for Public Score Event ID

## Expected Results

### After Credentials Saved
```json
{
  "accessKey": "fbwb_account_184815e8c0250b37266f693d6555ac7c",
  "secretKey": "j5gqKsFrLEwTuCtLbm62ozNBQ4NuPC2vY6pCo79vLak",
  "eventUuid": "7BvuefrS",
  "scoreEventUuid": "4s48GdoY"
}
```

### After Test Connection
Health Check shows all PASS ✅

### After Contest Sync
```json
{
  "lastApiCall": {
    "endpoint": "timingRulesGet",
    "status": 200,
    "success": true,
    "durationMs": 234,
    "baseUrl": "https://apicn.feibot.com",
    "requestUrl": "/eventConfigFile/timingRulesGet",
    "path": "/eventConfigFile/timingRulesGet",
    "query": "event_uuid=7BvuefrS",
    "unixTimestamp": 1782893180,
    "stringToSign": "GET/eventConfigFile/timingRulesGet1782893180event_uuid=7BvuefrS",
    "signatureLength": 64,
    "eventUuid": "7BvuefrS"
  }
}
```

## HMAC Signature Format

**String to Sign:**
```
{METHOD}{PATH}{TIMESTAMP}{SORTED_QUERY_STRING}{BODY}
```

**Example:**
```
GET/eventConfigFile/timingRulesGet1782893180event_uuid=7BvuefrS
```

**Result (Hex SHA256):**
```
64 character hex string
```

**Headers:**
```
X-Feibot-AK: fbwb_account_184815e8c0250b37266f693d6555ac7c
X-Feibot-Timestamp: 1782893180
X-Feibot-Signature: {64-char-hex-string}
```

## Verification

1. ✅ Cloud API Event UUID: `7BvuefrS`
2. ✅ Access Key: `fbwb_account_184815e8c0250b37266f693d6555ac7c`
3. ✅ Secret Key: `j5gqKsFrLEwTuCtLbm62ozNBQ4NuPC2vY6pCo79vLak`
4. ✅ Public Score Event ID: `4s48GdoY`
5. ✅ Save all fields
6. ✅ Test Connection shows PASS
7. ✅ Last API Call shows Unix Timestamp and Signature Length
8. ✅ Contest Sync completes with HTTP 200

## Testing Checklist

- [ ] Config saved to Firestore (visible in Firebase Console)
- [ ] Config synced to KV (visible in Cloudflare Workers KV)
- [ ] Health check endpoint shows all credentials PASS
- [ ] Contest mapping sync shows correct timestamp and signature
- [ ] Admin panel displays "Unix Timestamp: 1782893180" (not "—")
- [ ] Admin panel displays "String To Sign: GET/eventConfigFile..." (not "—")
- [ ] Admin panel displays "Signature Length: 64" (not "—")
- [ ] HTTP status shows 200 (success)
- [ ] Duration shows actual milliseconds (not 0 ms)
