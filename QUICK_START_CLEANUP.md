# Ghost Cleanup - Quick Start Guide

## 🚀 Quick Start (2 Minutes)

### 1. Run Ghost Cleanup
```typescript
import { cleanupGhostRegistrationsAction } from '@/lib/actions';

const result = await cleanupGhostRegistrationsAction();
console.log(result.report);
```

### 2. Expected Output
```
═══════════════════════════════════════════════════════════
         GHOST REGISTRATION CLEANUP REPORT
═══════════════════════════════════════════════════════════
📊 SCAN SUMMARY:
  ├─ Total Events Scanned: 25
  ├─ Ghost Registrations Removed: 3
  ├─ Invalid Entries Found: 5
  └─ Corrupted Entries Found: 2
═══════════════════════════════════════════════════════════
```

### 3. Verify
```typescript
// Check health
const health = await generateCacheHealthReportAction();
console.log(health.healthStatus); // Should be "HEALTHY"
```

---

## 📊 Complete Workflow (5 Minutes)

```typescript
import { 
  cleanupGhostRegistrationsAction,
  autoClearCacheAction,
  generateCacheHealthReportAction,
  getCacheStatsAction 
} from '@/lib/actions';

// Step 1: Clean ghosts from KV
console.log('🔧 Step 1: Cleaning ghost registrations...');
const cleanup = await cleanupGhostRegistrationsAction();
console.log(`   ✅ Removed ${cleanup.summary.ghostRegistrationsRemoved} ghost entries`);

// Step 2: Clear stale cache
console.log('🧹 Step 2: Clearing stale cache...');
const autoClear = await autoClearCacheAction();
console.log(`   ✅ Cleared ${autoClear.summary.totalEntriesCleared} cache entries`);

// Step 3: Check health
console.log('📊 Step 3: Checking cache health...');
const health = await generateCacheHealthReportAction();
console.log(`   ✅ Status: ${health.healthStatus}`);

// Step 4: View stats
console.log('📈 Step 4: Current stats...');
const stats = await getCacheStatsAction();
console.log(`   ✅ Total entries: ${stats.stats.totalEntries}`);

console.log('\n✨ Cleanup complete!');
```

---

## 🎯 What Gets Fixed

### Before Cleanup
- ❌ Ghost entries in athlete dashboard
- ❌ Corrupted event dates
- ❌ Invalid registrations showing up
- ❌ Orphaned cache entries

### After Cleanup
- ✅ Only valid registrations visible
- ✅ Correct event dates
- ✅ Clean cache state
- ✅ Better performance

---

## 📁 KV Keys Affected

### Reads From:
```
event:*:index                          → Event participant lists
event:{eventId}:participant:{bid}      → Full participant data
user:{userId}:events:index             → User registration lists
```

### Deletes From:
```
event:{eventId}:participant:{ghost-bid}   ✅ Removed
Updates:
event:{eventId}:index                     ✅ Updated
user:{userId}:events:index                ✅ Updated
```

---

## ⚡ Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Scan 25 events | ~500ms | List KV keys |
| Check 1000+ registrations | ~1-2s | Fetch participant data |
| Write updates | ~500ms | Update indices |
| **Total** | **~2-3s** | Very fast! |

---

## 🔍 Ghost Detection

Removed if:
- Missing from KV
- No name/email
- Invalid status
- Date contains "ghost"
- No timestamp

---

## 📅 Schedule

```
Every Sunday 02:00 UTC:
  cleanupGhostRegistrationsAction()
  
Every 6 hours:
  autoClearCacheAction()
  
Every day 09:00 UTC:
  generateCacheHealthReportAction()
```

---

## 🛠️ Troubleshooting

### Q: Ghost entries still showing?
**A**: Run cleanup again - new ghosts may be created if source issue continues

### Q: How long does it take?
**A**: ~2-3 seconds for typical dataset (25 events, 1000+ participants)

### Q: Is it safe to run?
**A**: Yes! Only removes corrupted/invalid entries. Valid data is preserved.

### Q: Can I run multiple times?
**A**: Yes! Safe to run as often as needed. Second run will find fewer entries.

---

## 📞 Support Documents

- 📖 [Full Guide](./CACHE_GHOST_CLEANUP_GUIDE.md)
- 🎨 [Visual Guide](./GHOST_CLEANUP_VISUAL_GUIDE.md)
- 📋 [KV Structure](./KV_DATA_STRUCTURE.md)
- 📝 [Implementation Details](./IMPLEMENTATION_COMPLETE.md)

---

## ✅ Checklist

- [ ] Run `cleanupGhostRegistrationsAction()`
- [ ] Verify cleanup report shows removed entries
- [ ] Check athlete dashboard - no ghost entries?
- [ ] Run `generateCacheHealthReportAction()` - status HEALTHY?
- [ ] View cache stats - reasonable number of entries?
- [ ] Set up weekly schedule in Cloud Scheduler
- [ ] Add monitoring for health checks

---

## Code Example for API Endpoint

```typescript
// src/app/api/admin/cleanup-ghosts/route.ts
import { cleanupGhostRegistrationsAction } from '@/lib/actions';

export async function POST(request: Request) {
  try {
    const result = await cleanupGhostRegistrationsAction();
    
    return Response.json({
      success: result.success,
      ghostsRemoved: result.summary.ghostRegistrationsRemoved,
      eventsScanned: result.summary.totalEventsScanned,
      duration: result.duration,
      report: result.report,
    });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
```

---

## 🎉 You're Done!

The ghost cleanup system is now implemented and ready to use.

**Next**: Deploy, run cleanup, and verify athlete dashboard is clean!
