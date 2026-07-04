# Cache & Ghost Registration Cleanup Guide

## Problem
After running a global system rebuild and cache clear, ghost entries were still appearing in the athlete dashboard. Example:
```
Event: BERGMAN OZAR PUNE 2026
Date: 03 Oct this is ghost entry 2026  ← CORRUPTED
Ticket: BERGMAN SWIMATHON - 1 Km
```

The issue occurs in:
- **Cloudflare KV Cache** - Contains stale/corrupted registration data (the source)
  - `event:{eventId}:index` - Lists participants for each event
  - `event:{eventId}:participant:{bookingId}` - Contains participant details
  - `user:{userId}:events:index` - Lists registrations per user

---

## Solution Overview

### New Functions Added

#### 1. **`cleanupGhostRegistrationsAction()`** - PRIMARY SOLUTION ✅ NOW READS FROM KV
**Purpose**: Removes ghost and corrupted registrations directly from KV cache

**What it does**:
- ✅ Reads all `event:*:index` entries from KV
- ✅ Fetches full participant data from `event:{eventId}:participant:{bookingId}`
- ✅ Identifies invalid entries (missing data, corrupted dates, etc.)
- ✅ Detects corrupted event date strings (containing "ghost")
- ✅ Removes corrupted registrations from KV
- ✅ Updates event indices and user registration indices
- ✅ Generates detailed report of cleaned entries

**Data Source**: 
```
KV Structure:
├─ event:{eventId}:index (array of summary entries)
├─ event:{eventId}:participant:{bookingId} (full participant data)
└─ user:{userId}:events:index (user's registration references)
```

**Returns**:
```typescript
{
  success: boolean;
  timestamp: string;
  duration: number;
  summary: {
    totalEventsScanned: number;
    ghostRegistrationsRemoved: number;
    invalidEntriesFound: string[];
    corruptedEntriesFound: string[];
  };
  report: string;
}
```

**Example Report Output**:
```
═══════════════════════════════════════════════════════════
         GHOST REGISTRATION CLEANUP REPORT
═══════════════════════════════════════════════════════════

📅 Timestamp: 2026-03-27T13:45:00.000Z
⏱️  Duration: 2450ms

📊 SCAN SUMMARY:
  ├─ Total Events Scanned: 25
  ├─ Ghost Registrations Removed: 3
  ├─ Invalid Entries Found: 5
  └─ Corrupted Entries Found: 2

🗑️  INVALID ENTRIES REMOVED:
  • evt_123/BMIN123: Missing name or email
  • evt_789/BMIN456: Invalid ticket status
  
⚠️  CORRUPTED ENTRIES REMOVED:
  • evt_345/BMIN678: Corrupted event date (contains "ghost")
  
🔄 USER INDICES UPDATED: 3

═══════════════════════════════════════════════════════════
```

---

#### 2. **`autoClearCacheAction()`** - AUTOMATIC CACHE CLEANING
**Purpose**: Automatically clears stale cache and ghost entries from KV

**Features**:
- Removes ghost user entries (no matching Firestore user)
- Removes ghost club entries (no matching Firestore club)
- Clears orphaned event entries
- Removes temporary system entries
- Tracks specific ghost IDs and entry details

**Returns**:
```typescript
{
  success: boolean;
  timestamp: string;
  duration: number;
  summary: {
    totalEntriesCleared: number;
    ghostEntriesRemoved: number;
  };
  ghostUserIds: string[];
  ghostClubIds: string[];
  clearedEventEntries: string[];
  clearedSystemEntries: {
    tempEntries: string[];
    lockEntries: string[];
    syncEntries: string[];
    queueEntries: string[];
  };
  report: string;
}
```

---

#### 3. **`getCacheClearanceReportAction()`** - VIEW LATEST REPORT
**Purpose**: Retrieve the latest cache clearance report

**Returns**: Last auto-clear report with summary and current cache state

---

#### 4. **`generateCacheHealthReportAction()`** - HEALTH CHECK
**Purpose**: Generate comprehensive cache health report with recommendations

**Returns**:
```typescript
{
  success: boolean;
  report: string;
  healthStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
}
```

**Detects**:
- High cache volume (> 10,000 entries)
- Recent ghost entries
- Stale auto-clear history
- Missing registration timestamps

---

## Implementation Steps

### Step 1: Execute Ghost Cleanup from Firestore
```typescript
import { cleanupGhostRegistrationsAction } from '@/lib/actions';

// In your admin dashboard/API route
const result = await cleanupGhostRegistrationsAction();

if (result.success) {
  console.log(`✅ Cleaned ${result.summary.ghostRegistrationsRemoved} ghost registrations`);
  console.log(result.report); // Display detailed report
}
```

### Step 2: Verify Data Quality
```typescript
// Check cache health
const health = await generateCacheHealthReportAction();
console.log(health.report);
console.log(`Status: ${health.healthStatus}`);
```

### Step 3: Clear Cache Layer
```typescript
// Clean KV cache of stale entries
const clearResult = await autoClearCacheAction();
console.log(`Cleared ${clearResult.summary.totalEntriesCleared} cache entries`);
```

### Step 4: Rebuild Cache
```typescript
// Sync from Firestore to KV
const syncResult = await masterSyncCacheAction();
console.log(`Rebuilt ${syncResult.details.dataRebuilt} cache entries`);
```

---

## What Gets Cleaned

### KV Cleanup (`cleanupGhostRegistrationsAction`) ✅ PRIMARY
Reads from and cleans:
- **`event:{eventId}:index`** - Removes entries referencing corrupted participants
- **`event:{eventId}:participant:{bookingId}`** - Deletes ghost/corrupted participant records
- **`user:{userId}:events:index`** - Removes dead registration references

Removes entries where:
- Participant data missing from KV
- Required fields missing (name, email)
- Invalid ticket status
- Registration timestamp missing
- Event date corrupted (contains "ghost")

---

## Complete Rebuild Sequence

### For Production (Comprehensive)
```typescript
// 1. Clean up corrupted KV entries (reads from KV)
const ghostCleanup = await cleanupGhostRegistrationsAction();
console.log('✅ KV cleanup:', ghostCleanup.summary.ghostRegistrationsRemoved);

// 2. Check health
const health = await generateCacheHealthReportAction();
console.log('📊 Health Status:', health.healthStatus);

// 3. Clear old cache (KV-wide cleanup)
const autoClear = await autoClearCacheAction();
console.log('🗑️  Cleared:', autoClear.summary.totalEntriesCleared);

// 4. Final verification
const stats = await getCacheStatsAction();
console.log('📈 Final stats:', stats.stats);
```

**Note**: We focus on KV cleanup first since that's where the actual issue is. No Firestore cleanup needed since KV is the source of truth for athlete registrations.

---

## API Endpoint Integration

Add to your admin API routes:
```typescript
// src/app/api/admin/cleanup-ghosts/route.ts
import { cleanupGhostRegistrationsAction } from '@/lib/actions';

export async function POST(request: Request) {
  try {
    const result = await cleanupGhostRegistrationsAction();
    return Response.json({ success: result.success, ...result });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
```

---

## Monitoring & Scheduling

### Recommended Schedule
- **Ghost Cleanup**: Weekly (removes source corruptions)
- **Auto Clear**: Every 6 hours (clears KV cache)
- **Health Report**: Daily (monitor status)
- **Master Sync**: Monthly (full cache rebuild)

### Using Cloud Scheduler (Google Cloud)
```bash
# Run ghost cleanup weekly
gcloud scheduler jobs create http cleanup-ghosts \
  --schedule="0 2 * * 0" \
  --uri="https://your-domain.com/api/admin/cleanup-ghosts" \
  --http-method=POST \
  --oidc-service-account-email=your-service-account@your-project.iam.gserviceaccount.com
```

---

## Troubleshooting

### Issue: Ghost entries still appear after cleanup
**Solution**: Run `cleanupGhostRegistrationsAction()` again - some entries may be regenerated if the source issue isn't fixed

### Issue: Cache sizes still too large
**Solution**: Check `generateCacheHealthReportAction()` output for recommendations

### Issue: Users report missing registrations
**Solution**: This may be intentional (if they were ghost entries). Check the cleanup report to verify.

---

## Detection Criteria for Ghost Entries

An entry is considered "ghost" if it has:
1. **Corrupted date string** - Contains "ghost" or malformed
2. **Missing critical data** - No name, email, or registration time
3. **Invalid status** - Status not in ['Active', 'Confirmed', 'Deferred', 'Cancelled', 'Pending']
4. **Orphaned reference** - Points to deleted event/user/club
5. **Missing timestamps** - No `registeredAt` or `createdAt`

---

## Reports & Analytics

### Cache Clearance Report
Available via `getCacheClearanceReportAction()` - shows:
- Cleared entries by type (users, clubs, events)
- Ghost entry IDs removed
- System entries cleaned up
- Last cleanup timestamp

### Health Report
Available via `generateCacheHealthReportAction()` - includes:
- Current cache metrics
- Issues detected
- Actionable recommendations
- Health status (Healthy/Warning/Critical)

---

## Files Modified
- ✅ `src/lib/actions/cacheManagementActions.ts` - Added 7 new functions
- ✅ `src/lib/actions/index.ts` - Exported all cache management functions
