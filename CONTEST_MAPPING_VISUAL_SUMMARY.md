# Contest Mapping Redesign - Visual Summary

## 🎯 The Problem (Before)

```
╔════════════════════════════════════════════════════════════════╗
║                    OLD CONTEST MAPPING                         ║
╚════════════════════════════════════════════════════════════════╝

EVENT: BERGMAN TRIATHLON 2026
├── BERGMAN OLYMPIC TRIATHLON (203 athletes)
│   └── Mapped to: BERGMAN OLYMPIC TRIATHLON ✓
├── BERGMAN 102 TRIATHLON (122 athletes)
│   └── Mapped to: BERGMAN 102 TRIATHLON ✓
├── BERGMAN SWIMATHON BLR (241 total registrations)
│   ├── Kids 500 (18 registered, 0 imported) → 0 athletes shown ❌
│   ├── 1 Km (62 registered, 0 imported) → 0 athletes shown ❌
│   ├── 2 Km (104 registered, 0 imported) → 0 athletes shown ❌
│   └── 4 Km (57 registered, 0 imported) → 0 athletes shown ❌
├── BERGMAN OLYMPIC TRIATHLON CIVIL (hidden, 0 athletes)
│   └── Auto-matched to: BERGMAN OLYMPIC TRIATHLON (fuzzy 89%)
│       ⚠️  WRONG: These are different products!
└── BERGMAN CIVIL RELAY OT (hidden, 0 athletes)
    └── No auto-match found

COVERAGE DISPLAY:
┌─────────────────┐
│ Mapped: 2       │ ← Only required rows with athletes
│ Required: 2     │ ← Only rows with athletes > 0
│ Missing: 0      │ ← Not counting CIVIL or RELAY
│ Coverage: 100%  │ ← Misleading! Missing 2 tickets!
└─────────────────┘

PROBLEM: Says 100% but 2 tickets unmapped!
```

---

## ✨ The Solution (After)

```
╔════════════════════════════════════════════════════════════════╗
║                  NEW CONTEST MAPPING                           ║
╚════════════════════════════════════════════════════════════════╝

EVENT: BERGMAN TRIATHLON 2026
├── BERGMAN OLYMPIC TRIATHLON (203 athletes) [Firestore count ✓]
│   └── Mapped to: BERGMAN OLYMPIC TRIATHLON ✓ [manual]
├── BERGMAN 102 TRIATHLON (122 athletes) [Firestore count ✓]
│   └── Mapped to: BERGMAN 102 TRIATHLON ✓ [auto - exact match]
├── BERGMAN SWIMATHON BLR (241 total registrations) [Firestore count ✓]
│   ├── Kids 500 (18 athletes) [from registrations] → Kids 500 ✓ [auto - normalized]
│   ├── 1 Km (62 athletes) [from registrations] → Swim 1 Km ✓ [auto - normalized]
│   ├── 2 Km (104 athletes) [from registrations] → Swim 2 Km ✓ [auto - normalized]
│   └── 4 Km (57 athletes) [from registrations] → Swim 4 Km ✓ [auto - normalized]
├── BERGMAN OLYMPIC TRIATHLON CIVIL (0 athletes) [from registrations]
│   └── Fuzzy match 89% < 95% → REQUIRES MANUAL MAPPING ⚠️
│       Reason: Different product, not auto-matched
└── BERGMAN CIVIL RELAY OT (0 athletes) [from registrations]
    └── No match found → REQUIRES MANUAL MAPPING ⚠️
        Reason: Concept doesn't exist in Feibot

COVERAGE DISPLAY:
┌──────────────────────────────────────────┐
│ Leaf Tickets:  8                         │ ← All tickets
│ Mapped:        6                         │
│ Manual:        2                         │ ← Manually set
│ Auto:          4                         │ ← Priority-matched
│ Missing:       2                         │ ← CIVIL, RELAY
│ Coverage:      75% (6/8)                 │ ← Correct!
└──────────────────────────────────────────┘

VALIDATION STATUS:
✓ All Tickets Mapped: NO  ← False
✓ Full Coverage: NO       ← False  
✓ Ready for Import: NO    ← False

STATUS: ⚠️  COMPLETE CONTEST MAPPING FIRST
Button: [✗ Save Mapping] disabled
```

---

## 📊 Key Metrics Comparison

```
┌─────────────────────────────────────────────────────────────────┐
│                          OLD vs NEW                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  COVERAGE CALCULATION                                           │
│  ──────────────────────────────────────────────────────────────│
│  OLD:  (Mapped / Required Rows with Athletes) × 100%            │
│        (2 / 2) × 100% = 100% ❌ Misleading                     │
│                                                                   │
│  NEW:  (Mapped / Total Leaf Tickets) × 100%                     │
│        (6 / 8) × 100% = 75% ✅ Accurate                        │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│  ATHLETE COUNT SOURCE                                           │
│  ──────────────────────────────────────────────────────────────│
│  OLD:  Mix of Feibot imported + KV cache                        │
│        Shows 0 for swimathon (not imported yet) ❌              │
│                                                                   │
│  NEW:  Bergman registrations only                               │
│        Shows 18,62,104,57 for swimathon ✅                     │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│  AUTO-MATCHING                                                  │
│  ──────────────────────────────────────────────────────────────│
│  OLD:  Fuzzy >80% (can create false matches)                    │
│        "CIVIL" → "OLYMPIC" (89% similar) ❌                     │
│                                                                   │
│  NEW:  7-tier priority (fuzzy >95% only as tier 6)              │
│        Requires exact/normalized first ✅                       │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│  REQUIRED TICKETS                                               │
│  ──────────────────────────────────────────────────────────────│
│  OLD:  Only rows with athletes > 0                              │
│        Can ignore zero-athlete tickets ❌                        │
│                                                                   │
│  NEW:  ALL leaf tickets (zero-athletes included)                │
│        Must map every race category ✅                          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow (After)

```
BERGMAN DATABASE
┌─────────────────────┐
│ events/{eventId}    │
│ /ticketDefinitions  │
│ /participants       │ ← REGISTRATION COUNT SOURCE
│ /providerParticipants
└─────────────────────┘
         ↓
    API ROUTE
┌─────────────────────────────────────────────────────────┐
│ /live/contest-mapping/[eventId]                         │
│                                                           │
│ 1. Load ALL leaf tickets (no filtering)                 │
│ 2. Count registrations by ticketId                      │
│ 3. Load contests from KV                                │
│ 4. Apply auto-map priority:                             │
│    a) Saved UUID                                        │
│    b) Contest Binding                                   │
│    c) Provider UUID                                     │
│    d) Exact Name                                        │
│    e) Normalized Name                                   │
│    f) Fuzzy >95%                                        │
│    g) Manual Required                                   │
│ 5. Calculate metrics (ALL tickets)                      │
│ 6. Build debug panel                                    │
└─────────────────────────────────────────────────────────┘
         ↓
    UI DISPLAY
┌─────────────────────────────────────────────────────────┐
│ Contest Mapping Dashboard                               │
│                                                           │
│ Metrics: 8 Leaf, 6 Mapped, 2 Manual, 4 Auto, 2 Missing │
│ Coverage: 75%                                            │
│ Status: ⚠️  Requires manual mapping                     │
│                                                           │
│ [✗ Save Mapping] (disabled until 100% coverage)        │
└─────────────────────────────────────────────────────────┘
         ↓
PARTICIPANT IMPORT (ONLY after 100% coverage)
```

---

## 🎨 Auto-Mapping Decision Tree

```
                    TICKET TO MAP
                          |
                          ▼
        ┌─────────────────────────────────┐
        │ 1. Check Saved UUID             │
        └─────────────────────────────────┘
                          |
              ┌───────────┴───────────┐
              ▼ YES                    ▼ NO
            MAPPED                     |
            (100% conf)                ▼
                          ┌─────────────────────────────────┐
                          │ 2. Check Contest Binding        │
                          └─────────────────────────────────┘
                                      |
                          ┌───────────┴───────────┐
                          ▼ YES                    ▼ NO
                        MAPPED                     |
                        (100% conf)                ▼
                                    ┌─────────────────────────────────┐
                                    │ 3. Check Provider UUID          │
                                    └─────────────────────────────────┘
                                                    |
                                        ┌───────────┴───────────┐
                                        ▼ YES                    ▼ NO
                                      MAPPED                     |
                                      (100% conf)                ▼
                                                ┌─────────────────────────────────┐
                                                │ 4. Try Exact Name Match         │
                                                │    (case-insensitive)           │
                                                └─────────────────────────────────┘
                                                                |
                                                    ┌───────────┴───────────┐
                                                    ▼ YES                    ▼ NO
                                                  MAPPED                     |
                                                  (100% conf)                ▼
                                                            ┌─────────────────────────────────┐
                                                            │ 5. Try Normalized Name          │
                                                            │    (cleaned text comparison)    │
                                                            └─────────────────────────────────┘
                                                                            |
                                                                ┌───────────┴───────────┐
                                                                ▼ YES                    ▼ NO
                                                              MAPPED                     |
                                                              (95% conf)                ▼
                                                                        ┌─────────────────────────────────┐
                                                                        │ 6. Try Fuzzy Match              │
                                                                        │    (>95% similarity required)   │
                                                                        └─────────────────────────────────┘
                                                                                        |
                                                                            ┌───────────┴───────────┐
                                                                            ▼ YES                    ▼ NO
                                                                          MAPPED                     |
                                                              ┌─ (88-95% conf)                      ▼
                                                              │     ┌─────────────────────────────────┐
                                                              │     │ 7. Manual Mapping Required      │
                                                              │     │    (No automatic match)         │
                                                              │     └─────────────────────────────────┘
                                                              │                   |
                                                              │     ┌─────────────┘
                                                              │     ▼
                                                              └──► MISSING
                                                                   (0% conf)
                                                                   Type: manual
```

---

## 📋 Dashboard State Transitions

```
INITIAL STATE (After Sync)
┌──────────────────────────┐
│ Leaf Tickets: 8          │
│ Mapped: 0                │
│ Missing: 8               │
│ Coverage: 0%             │
│ Status: ⚠️  Incomplete  │
│ Button: [Auto Map]       │
└──────────────────────────┘
         ↓ (Click Auto Map)

AFTER AUTO-MAPPING
┌──────────────────────────┐
│ Leaf Tickets: 8          │
│ Mapped: 6                │  ← 4 exact/norm + 2 prev saved
│ Missing: 2               │  ← CIVIL, RELAY
│ Coverage: 75%            │
│ Status: ⚠️  Incomplete  │
│ Button: [Save Mapping]   │
└──────────────────────────┘
     ↓ (Manual mapping needed)

AFTER MANUAL MAPPING
┌──────────────────────────┐
│ Leaf Tickets: 8          │
│ Mapped: 8                │  ← All mapped
│ Missing: 0               │
│ Coverage: 100%           │
│ Status: ✅ Complete    │
│ Button: [Save Mapping]   │
└──────────────────────────┘
     ↓ (Click Save Mapping)

SAVED STATE
┌──────────────────────────┐
│ Leaf Tickets: 8          │
│ Mapped: 8                │
│ Missing: 0               │
│ Coverage: 100%           │
│ Status: ✅ Ready       │
│ Button: [Import Enabled] │
└──────────────────────────┘
```

---

## 🎓 Why This Matters

### For Admins
```
OLD: "Mapping is 100% complete"
     But 2 tickets aren't mapped!
     ❌ Confusing & Error-prone

NEW: "Mapping is 75% complete, 2 tickets missing"
     Exact ticket names listed
     ✅ Clear & Actionable
```

### For Athletes
```
OLD: Swimathon shows 0 athletes (shows 0 before import)
     ❌ Looks like nobody registered

NEW: Swimathon shows 241 total (18+62+104+57)
     ✅ Shows actual registration interest
```

### For System
```
OLD: Could import with incomplete mapping
     Live tracking might fail to find contests
     ❌ Runtime errors possible

NEW: Must complete 100% before import
     KV structure guaranteed to have all mappings
     ✅ Reliable, predictable data
```

---

## ✅ Before-After Checklist

| Item | Before | After |
|------|--------|-------|
| Coverage shows % of | Required rows only | ALL leaf tickets |
| Swimathon athletes | 0 (not imported) | Actual count (18,62,104,57) |
| CIVIL ticket | Auto-matched to OLYMPIC | Requires manual mapping |
| Hidden tickets | Excluded from mapping | Included & required |
| Fuzzy matching | >80% sufficient | >95% only (tier 6) |
| Complete button | Enables at 100% required | Disables until 100% all |
| Coverage display | "100%" (misleading) | "75%" (accurate) |
| Import gate | "If required rows ok" | "If ALL tickets ok" |

