# Contest Mapping Redesign - Quick Reference

## 🎯 What Changed

### Old System
- Coverage: 100% (2 mapped / 2 required rows with athletes > 0)
- Missing: BERGMAN OLYMPIC TRIATHLON CIVIL PERSONNAL, BERGMAN CIVIL RELAY OT (not counted)
- Athlete counts: 0 for swimathon (no Feibot import yet)

### New System
- Coverage: 75% (6 mapped / 8 total leaf tickets)
- Missing: 2 tickets explicitly shown as unmapped
- Athlete counts: Actual registration counts from Bergman

---

## 📊 Dashboard Metrics

**Old Display**:
```
Mapped: 2
Required: 2
Missing: 0
Coverage: 100%
```

**New Display**:
```
Leaf Tickets: 8
Mapped: 6
Manual: 2
Auto: 4
Missing: 2
Coverage: 75%
```

---

## 🔄 How It Works

### 1. Load Tickets
- **Source**: `events/{eventId}/ticketDefinitions` collection
- **Include**: ALL leaf tickets (no filtering by participant count)

### 2. Count Athletes
- **Source**: `events/{eventId}/participants` collection (Bergman registrations)
- **NOT**: Feibot imported data
- **Key**: Counts available before participant import

### 3. Auto-Map Contests
**Priority Order**:
1. Saved UUID (from previous mapping)
2. Contest Binding (explicit config)
3. Provider UUID (from Feibot)
4. Exact Name (case-insensitive match)
5. Normalized Name (cleaned text match)
6. Fuzzy Match (>95% similarity only)
7. Manual Required (no auto match found)

### 4. Calculate Coverage
```
Coverage = (Mapped Tickets / Total Leaf Tickets) × 100%
```

**NOT**: `(Mapped / Visible)` or `(Mapped / Required)`

### 5. Enable Import
Participant import is **ONLY** enabled when:
- ✅ Coverage = 100%
- ✅ Missing Tickets = 0
- ✅ All leaf tickets have valid contest UUID

---

## 🧠 Swimathon Example

### Dataset
```
BERGMAN SWIMATHON BLR
├── Kids 500 Mtrs     → 18 registrations
├── 1 Km              → 62 registrations
├── 2 Km              → 104 registrations
└── 4 Km              → 57 registrations
```

### Before Changes
- Kids 500: Athletes 0 (Feibot not synced)
- 1 Km: Athletes 0
- 2 Km: Athletes 0
- 4 Km: Athletes 0

### After Changes
- Kids 500: Athletes 18 ✅ (counted from registrations)
- 1 Km: Athletes 62 ✅
- 2 Km: Athletes 104 ✅
- 4 Km: Athletes 57 ✅

---

## 🚨 Key Differences

### AUTO-MAPPING

**Before**: 
```typescript
autoMatchTicket("BERGMAN OLYMPIC TRIATHLON CIVIL", contests)
// Could fuzzy match (>80%) to "BERGMAN OLYMPIC TRIATHLON"
// Result: FALSE MATCH ❌
```

**After**:
```typescript
autoMapTicketByPriority(ticket, contests, saved, bindings)
// Tries exact name, normalized name, then fuzzy >95%
// Won't match "CIVIL" to "OLYMPIC"
// Result: REQUIRES MANUAL MAPPING ✅
```

### COVERAGE

**Before**:
```typescript
coverage = (mapped / requiredRows) * 100
// Only counts rows with athletes > 0
// Zero-athlete rows ignored
```

**After**:
```typescript
coverage = (mapped / allLeafTickets) * 100
// Counts ALL leaf tickets
// Zero-athlete rows MUST be mapped
```

### ATHLETE COUNT

**Before**:
```typescript
// From providerParticipants or participantsIndex (KV cache)
count = participants.filter(p => p.ticketId === ticketId).length
```

**After**:
```typescript
// From Firestore participants (Bergman registrations)
count = registrations.filter(r => r.ticketId === ticketId).length
```

---

## 🛠️ API Response Changes

### mappingSummary
```typescript
// OLD
{
  totalTickets: 2,
  mapped: 2,
  missing: 0,
  coverage: 100%
}

// NEW
{
  leafTickets: 8,
  mapped: 6,
  missing: 2,
  manual: 2,
  auto: 4,
  coverage: 75%
}
```

### debugPanel (NEW)
```typescript
{
  totalLeafTickets: 8,
  mappedTickets: 6,
  missingTickets: 2,
  manualMappings: 2,
  autoMappings: 4,
  rejectedFuzzyMatches: 1,
  duplicateUuids: {},           // Conflicts to resolve
  unusedContests: [],
  unusedTickets: ["Unmapped Ticket Name"],
  validationStatus: {
    allTicketsMapped: false,     // ← Must be true for import
    fullCoverage: false,          // ← Must be true
    readyForImport: false         // ← Final check
  }
}
```

---

## ✅ Validation Checklist

Before enabling participant import, verify:

- [ ] Leaf Tickets: Count matches expected number
- [ ] Coverage: Shows 100%
- [ ] Missing: Shows 0
- [ ] Manual Mappings: User-set mappings recorded
- [ ] Auto Mappings: Priority-based matches successful
- [ ] No Duplicate UUIDs: Each contest mapped to one ticket
- [ ] All Contests Used: No unused contests in mapping
- [ ] Swimathon Athletes: Shows registration counts (not 0)
- [ ] Complete Button: Enabled only after all checks pass

---

## 🔍 Troubleshooting

### Issue: Coverage Still Shows 100% but ticket is missing
**Cause**: Old state cached in component or KV  
**Solution**: Click "Refresh" button to reload from API

### Issue: Swimathon shows 0 athletes
**Cause**: Still using old participant counting logic  
**Solution**: Check that registrations are loaded from Firestore `participants`

### Issue: Auto-mapping fuzzy matched incorrectly
**Cause**: Fuzzy matching has priority > manual review  
**Solution**: Fuzzy now requires >95% and is tier 6, only after exact/normalized fails

### Issue: Hidden tickets show in mapping
**Cause**: Zero-athlete tickets now required to map  
**Solution**: Must explicitly map or unmap - they're no longer hidden

---

## 📝 Files Modified

1. **API**: `/src/app/api/live/contest-mapping/[eventId]/route.ts`
   - New: `autoMapTicketByPriority()`
   - Changed: `loadTicketDefinitions()` to use registrations only
   - Changed: `buildMappingsForUi()` to use priority matching
   - Changed: `GET` response with debugPanel

2. **UI**: `/src/components/admin/LiveTrackingHub.tsx`
   - Changed: Metrics calculations (all tickets, not required only)
   - Changed: Dashboard display (6 metrics instead of 4)
   - Changed: Completion logic (100% of all, not required)

---

## 🎓 Learning Points

### Why count from Bergman registrations?
- Available immediately, don't need Feibot sync
- Authoritative source (Feibot is import target)
- Shows how many paid athletes per category
- Feibot might have different counts (imports, edits, etc)

### Why strict priority matching?
- Prevents false matches (CIVIL ≠ OLYMPIC)
- Explicit > Fuzzy (humans decide borderline cases)
- Saved > Auto (respects previous decisions)
- Provider > Generic (prefers specific provider data)

### Why 100% coverage required?
- Every paid race category must have contest
- Prevents admin errors/incomplete setup
- Enables consistent data flow
- KV validation checks can rely on completeness

---

## 💡 Best Practices

1. **Sync Contests First**
   - Click "Sync Contests" to get latest from Feibot
   - Ensure all contests in Feibot are available

2. **Auto-Map First**
   - Click "Auto Map" to apply priority matching
   - Review results before manual fixes

3. **Manual Mapping Second**
   - For missing tickets, select contest from dropdown
   - Use debug panel to find unused contests

4. **Verify Before Import**
   - Check coverage = 100%
   - Check missing = 0
   - Review debug panel for conflicts
   - Click "Save Mapping" to persist

5. **Enable After Setup**
   - Only after Contest Mapping Complete alert appears
   - Import participants from Feibot
   - Live tracking will use these mappings

