# Bergman Live Tracking Rebuild - Progress

## Phase 1: Feibot API Connection ✅ COMPLETE

**Status:** Implemented and Validated

**New Files Created:**
- `src/lib/feibot-integration/types.ts` - Complete type definitions for the entire system
- `src/lib/feibot-integration/credentials.ts` - Firestore-based credential management with encryption
- `src/lib/feibot-integration/api-client.ts` - HMAC-SHA256 authenticated API client
- `src/lib/feibot-integration/index.ts` - Public API exports
- `src/app/api/feibot/connections/route.ts` - Credential management endpoints
- `src/app/api/feibot/health/[connectionId]/route.ts` - Health check endpoint

**Architecture:**

```
Bergman Admin
     ↓
POST /api/feibot/connections
     ↓
Firestore: feibotConnections
  ├─ accountId
  ├─ encryptedAccessKey (AES-256-GCM)
  ├─ encryptedSecretKey (AES-256-GCM)
  ├─ status (active|inactive|failed|testing)
  └─ lastSuccessfulConnection, failureCount, etc.
     ↓
GET /api/feibot/health/{connectionId}
     ↓
Decrypt credentials → Test Feibot API → Update status
     ↓
Return health info to admin
```

**Key Features:**
- ✅ Credentials encrypted at rest (AES-256-GCM via liveTrackingSecret)
- ✅ HMAC-SHA256 authentication (X-Feibot-AK, X-Feibot-Timestamp, X-Feibot-Signature)
- ✅ Connection status tracking (active/inactive/failed/testing)
- ✅ Failure recording and consecutive failure counting
- ✅ Health check endpoint with diagnostics

**TypeScript Validation:** ✅ No errors

---

## Phase 2: Event Configuration Import (NEXT)

**Files to Create:**
- `src/lib/feibot-integration/event-config.ts` - Event config import logic
- `src/app/api/feibot/events/[eventUuid]/config/route.ts` - Fetch & import endpoint
- KV archival utilities

**What It Will Do:**
1. Fetch timingRulesGet from Feibot
2. Archive raw response to Cloudflare KV: `live:{eventUuid}:raw:{timestamp}`
3. Parse contests, splits, devices, categories, age groups
4. Store parsed config in Firestore: `events.{eventId}.feibotConfig`
5. Return to admin panel for display

---

## Phase 3: Contest Mapping (AFTER Phase 2)

Create UI to map Feibot contests to Bergman events

---

## Phase 4: Split Mapping (AFTER Phase 3)

Map Feibot splits to Bergman checkpoints

---

## Phase 5: Participant Mapping (AFTER Phase 4)

Map registrations to Feibot participants

---

## Phase 6: Live Sync Engine (AFTER Phase 5)

Continuous synchronization of live data

---

## Phase 7: Raw Data Archival & Recovery (PARALLEL)

Complete historical archive and replay support

---

## Files to Delete/Replace

**Old Integration Code (should be removed during Phase 2 cleanup):**

Directories to evaluate for deletion:
- `src/lib/live-tracking/` - Some files reusable, some old
- `src/app/api/live/` - Multiple endpoints need migration
- `cloudflare/live-tracking-worker/` - Old worker code

The new system (`src/lib/feibot-integration/`) is completely separate and doesn't depend on the old code yet.

---

## Next Action

**Execute Phase 2:** Run the Phase 2 implementation script
