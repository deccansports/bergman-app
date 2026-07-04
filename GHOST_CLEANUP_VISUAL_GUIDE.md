# Ghost Entry Removal - Visual Process Flow

## The Problem
```
┌─────────────────────────────────────┐
│     ATHLETE DASHBOARD               │
│  Shows: BERGMAN OZAR PUNE 2026      │
│  Date: 03 Oct [this is ghost] 2026  │ ← CORRUPTED
│  ❌ Data corruption visible         │
└─────────────────────────────────────┘
         ↓ Data comes from
┌─────────────────────────────────────┐
│  CLOUDFLARE KV (Source of Truth)    │
│  ├─ event:{eventId}:index           │
│  ├─ event:{eventId}:participant:*   │
│  └─ Contains corrupted records ❌   │
│  Root cause is here ⚠️              │
└─────────────────────────────────────┘
```

---

## Solution Architecture

### Before: Multi-Layer Problem
```
┌────────────────────────────────────────┐
│ GLOBAL REBUILD (Cache Clear)           │
│ - Clears KV Cache ✅                   │
│ - Leaves Firestore corrupted ❌        │
└────────────────────────────────────────┘
     ↓
┌────────────────────────────────────────┐
│ ATHLETE DASHBOARD STILL SHOWS GHOSTS   │
│ Because Firestore still corrupted      │
│ Cache rebuilds from corrupted source   │
└────────────────────────────────────────┘
```

### After: KV-Based Cleanup
```
┌──────────────────────────────────────────────────────┐
│ STEP 1: cleanupGhostRegistrationsAction()           │
│ ├─ Read event:*:index from KV                       │
│ ├─ Fetch event:eventId:participant:* from KV        │
│ ├─ Identify corrupted entries in KV ✅              │
│ ├─ DELETE ghost entries from KV ✅                  │
│ └─ Update event indices & user indices              │
└──────────────────────────────────────────────────────┘
     ↓
┌──────────────────────────────────────────────────────┐
│ STEP 2: autoClearCacheAction()                      │
│ ├─ Remove stale user/club/event cache entries       │
│ ├─ Clean orphaned entries from KV                   │
│ └─ Remove temp/lock entries                         │
└──────────────────────────────────────────────────────┘
     ↓
┌────────────────────────────────────────┐
│ ATHLETE DASHBOARD - CLEAN! ✅          │
│ - No ghost entries                     │
│ - Correct dates                        │
│ - Valid registrations only             │
└────────────────────────────────────────┘
```

---

## Data Flow After Cleanup

### What Gets Removed FROM KV

#### FROM event:{eventId}:index
```
event:{eventId}:index: [
  ✅ {bookingId: "BMIN01PLF", name: "Valid Name", ...},
  ✅ {bookingId: "BMIN04XVJ", name: "Valid Name", ...},
  ❌ {bookingId: "GHOST123", name: "", ...}  ← REMOVED
]
```

#### FROM event:{eventId}:participant:{bookingId}
```
event:{eventId}:participant:BMIN01PLF → ✅ Valid participant (kept)
event:{eventId}:participant:GHOST123 → ❌ Deleted from KV
```

#### Invalid Entry Indicators:
- Participant data missing from KV
- Name or email field missing/empty
- Invalid ticket status
- Event date contains "ghost"
- Registration timestamp missing


---

## Execution Timeline

```
TIME    ACTION                          STATUS              AFFECTED
════════════════════════════════════════════════════════════════════════
13:00   cleanupGhostRegistrationsAction  READING FROM KV
        ├─ List event:*:index keys      IN PROGRESS
        ├─ Fetch participant data       IN PROGRESS
        ├─ Check 1,200+ registrations   IN PROGRESS
        └─ Remove 3 ghosts              ✅ DONE            KV Cache
13:02
13:02   autoClearCacheAction             CLEARING KV        
        ├─ Remove stale entries         ✅ DONE            KV Cache
        └─ Clean orphaned entries       ✅ DONE            KV Cache
13:03
13:03   generateCacheHealthReportAction  VERIFY
        └─ Status: HEALTHY ✅           ✅ DONE
```

---

## Detection Logic

### How Ghost Entries Are Identified

```
PARTICIPANT RECORD
├─ Check: eventDate field
│  ├─ ❌ Missing → GHOST
│  ├─ ❌ Contains "ghost" → GHOST  
│  └─ ✅ Valid ISO string → Continue
├─ Check: Required fields
│  ├─ ❌ No name → GHOST
│  ├─ ❌ No email → GHOST
│  └─ ✅ Present → Continue
├─ Check: Registration timestamp
│  ├─ ❌ No registeredAt/createdAt → GHOST
│  └─ ✅ Present → Continue
├─ Check: Ticket status
│  ├─ ❌ Invalid status → GHOST
│  └─ ✅ Valid → Continue
└─ Result: ✅ VALID ENTRY
```

---

## Report Structure

### Ghost Cleanup Report
```
═══════════════════════════════════════════════════════════
         GHOST REGISTRATION CLEANUP REPORT
═══════════════════════════════════════════════════════════

📅 Timestamp: 2026-03-27T13:45:00.000Z
⏱️  Duration: 2450ms

📊 SCAN SUMMARY:
  ├─ Total Events Scanned: 25
  ├─ Ghost Registrations Removed: 3        ← Key metric
  ├─ Invalid Entries Found: 5
  └─ Corrupted Entries Found: 2

🗑️  INVALID ENTRIES REMOVED:
  • evt_123/part_456: Missing name or email
  • evt_789/part_012: Invalid ticket status

⚠️  CORRUPTED ENTRIES REMOVED:
  • evt_345/part_678: Corrupted event date in participant record

🔄 USER INDICES UPDATED: 3

═══════════════════════════════════════════════════════════
```

### Cache Clearance Report
```
═════════════════════════════════════════════════════════════
           CACHE CLEARANCE REPORT - SUMMARY
═════════════════════════════════════════════════════════════

📅 Last Clearance: 2026-03-27T13:05:00.000Z
⏱️  Duration: 450ms
⏲️  Next Scheduled: 2026-03-27T19:05:00.000Z

📊 CLEARANCE STATISTICS:
  ├─ Total Entries Cleared: 25
  ├─ Ghost Entries Removed: 8              ← Stale cache
  ├─ Ghost User IDs Removed: 3
  └─ Ghost Club IDs Removed: 2

💾 CURRENT CACHE STATE:
  ├─ User Entries: 450
  ├─ Club Entries: 25
  ├─ Event Entries: 1,200
  ├─ System Entries: 40
  └─ Total Entries: 1,715 (was 1,740)

═════════════════════════════════════════════════════════════
```

---

## Before/After Comparison

### BEFORE Cleanup
```
┌──────────────────────────────────────┐
│ USER DASHBOARD - ATHLETE VIEW         │
├──────────────────────────────────────┤
│ UPCOMING REGISTRATIONS               │
├──────────────────────────────────────┤
│ Event: BERGMAN OZAR PUNE 2026        │
│ Date: 03 Oct [this is ghost] 2026    │ ❌ CORRUPTED
│ Ticket: BERGMAN SWIMATHON - 1 Km    │
│ BIB: 3102                            │
│ [Actions...]                         │
│                                      │
│ Event: BERGMAN BENGALURU 2026        │
│ Date: 05 Sep 2026                    │
│ Ticket: BERGMAN SWIMATHON BLR-1 Km   │
│ BIB: 3102                            │
│ [Actions...]                         │
└──────────────────────────────────────┘
    ↓ After cleanup ↓
┌──────────────────────────────────────┐
│ USER DASHBOARD - ATHLETE VIEW         │
├──────────────────────────────────────┤
│ UPCOMING REGISTRATIONS               │
├──────────────────────────────────────┤
│ Event: BERGMAN BENGALURU 2026        │
│ Date: 05 Sep 2026                    │ ✅ VALID
│ Ticket: BERGMAN SWIMATHON BLR-1 Km   │
│ BIB: 3102                            │
│ [Actions...]                         │
└──────────────────────────────────────┘
```

---

## Recommended Cleanup Schedule

```
┌─────────────────────────────────────────────────────┐
│ AUTOMATED MAINTENANCE SCHEDULE                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Every 6 hours:                                      │
│ ├─ autoClearCacheAction()      [KV Cache cleanup]  │
│ └─ Duration: ~30 seconds                            │
│                                                     │
│ Every day (02:00 UTC):                              │
│ ├─ generateCacheHealthReportAction() [Check health]│
│ └─ Duration: ~2 minutes                             │
│                                                     │
│ Every week (Sunday 02:00 UTC):                      │
│ ├─ cleanupGhostRegistrationsAction()  [Firestore]  │
│ └─ Duration: ~5 minutes (depends on volume)         │
│                                                     │
│ Every month (1st at 03:00 UTC):                     │
│ ├─ masterSyncCacheAction()      [Full rebuild]     │
│ └─ Duration: ~10 minutes (full sync)                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Success Indicators

✅ Ghost cleanup successful when:
- `cleanupGhostRegistrationsAction()` returns `success: true`
- No "ghost" entries found in health report
- Athlete dashboard shows only valid registrations
- Cache health status = HEALTHY
- No corrupted date strings visible

⚠️ Check again if:
- Ghost entries reappear (indicates source corruption)
- Cache health = WARNING or CRITICAL
- User reports missing valid registrations (may need manual review)
