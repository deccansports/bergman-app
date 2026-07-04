# Feibot Credential UI: Before and After

## BEFORE: Single Mixed Credential Card

```
┌────────────────────────────────────────────────────────┐
│ Feibot credentials                                      │
│ Secrets are sent only to the backend...                │
├────────────────────────────────────────────────────────┤
│                                                          │
│ Account                    API base URL                 │
│ [feibot ..................] [https://apicn.feibot.com] │
│ Locked to documented host                              │
│                                                          │
│ Access Key                                              │
│ [Enter Access Key ..........................]          │
│                                                          │
│ Secret Key                                              │
│ [Enter Secret Key ..........................]          │
│                                                          │
│ Bergman upcoming event                  [Refresh]      │
│ [Select event                           ]              │
│                                                          │
│ [Save] [Test] [Refresh Status] [Discover]             │
│                                                          │
│ ⚠️ PROBLEM: Mixed credentials in one card             │
│    - Unclear which AK/SK is for event vs account      │
│    - Validation results conflated                       │
│    - Hard to see which credential type is failing      │
│    - Confusing UX for admins                           │
│                                                          │
└────────────────────────────────────────────────────────┘
```

---

## AFTER: Dual Independent Credential Cards

### Card Layout (Side by Side):

```
┌──────────────────────────────────┬──────────────────────────────────┐
│  AK-EVENT                         │  AK-ACCOUNT                      │
│  (Event Credentials)              │  (Account Credentials)           │
├──────────────────────────────────┼──────────────────────────────────┤
│                                   │                                  │
│ [✓ Connected]                     │ [✓ Connected]                    │
│                                   │                                  │
│ Event-scoped credentials          │ Account-scoped credentials       │
│ generated after opening a         │ with access to all events        │
│ specific event in Feibot.         │ owned by the Feibot account.     │
│                                   │                                  │
│ Access Key                        │ Account ID                       │
│ [.........................]       │ [feibot ................]        │
│                                   │                                  │
│ Secret Key                        │ Access Key                       │
│ [.........................]       │ [.........................]     │
│                                   │                                  │
│ Event UUID                        │ Secret Key                       │
│ ┌─────────────────────────┐       │ [.........................]     │
│ │ 4cEm8JPYbpupoFRMDLc1    │       │                                  │
│ └─────────────────────────┘       │ API Base URL                     │
│                                   │ ┌─────────────────────────┐     │
│ [Save Event] [Test]               │ │ https://apicn.feibot.   │     │
│                                   │ │ com                     │     │
│ ✓ Authentication PASS             │ └─────────────────────────┘     │
│ ✓ Event UUID Access PASS          │                                  │
│ ✓ Timing Rules API PASS           │ [Save Account] [Test]           │
│ ✓ Participants API PASS           │                                  │
│ ✓ Live Results API PASS           │ ✓ Authentication PASS           │
│                                   │ ✓ Events List API PASS          │
│ Bound to Event:                   │ ✓ Timing Rules API PASS         │
│ 4cEm8JPYbpupoFRMDLc1              │ ✓ Participants API PASS         │
│                                   │ ✓ Live Results API PASS         │
│ Last Auth:                        │                                  │
│ Today at 2:34 PM                  │ Accessible Events:              │
│                                   │ 47                              │
│                                   │                                  │
│                                   │ Last Auth:                      │
│                                   │ Today at 2:34 PM                │
│                                   │                                  │
└──────────────────────────────────┴──────────────────────────────────┘
```

---

## Comparison Table

| Aspect | Before | After |
|--------|--------|-------|
| **Credential Organization** | Mixed in one card | Separate cards |
| **Clarity** | Confusing (AK/SK for what?) | Clear (Event vs Account labeled) |
| **Validation** | Single result | Independent per credential |
| **Error Messages** | Generic | Specific to credential type |
| **Status Display** | One status | Separate status per card |
| **Failed Event Credential View** | Can't tell Account status | Can immediately see Account works |
| **Failed Account Credential View** | Can't tell Event status | Can immediately see Event works |
| **Admin Experience** | Confusing troubleshooting | Clear diagnosis |
| **Visual Space** | Cramped | Organized, readable |
| **Descriptions** | None | Detailed per card |

---

## Error Scenario: Event Credential Fails

### BEFORE:
```
┌────────────────────────────────────────────┐
│ Feibot credentials                          │
├────────────────────────────────────────────┤
│ ⚠️ Error: Unauthorized (401)               │
│                                             │
│ [Cannot tell if Event or Account failed]   │
│ [No way to test credentials separately]    │
│ [Need to try saving/testing again blindly] │
│                                             │
└────────────────────────────────────────────┘
```

### AFTER:
```
┌──────────────────────────┬──────────────────────────┐
│ AK-EVENT                 │ AK-ACCOUNT               │
├──────────────────────────┼──────────────────────────┤
│ ⚠️ Unauthorized (401)    │ ✓ Connected              │
│ Event credential failed  │                          │
│                          │ Account credential is    │
│ ✗ Authentication FAIL    │ working fine             │
│                          │                          │
│ [Clear problem isolated] │ [Clear fallback works]   │
│                          │                          │
└──────────────────────────┴──────────────────────────┘
```

**Admin immediately knows**:
1. Event credential is the problem
2. Account credential works fine
3. Fallback will automatically engage
4. Focus troubleshooting on event credential

---

## Feature: Credential Usage Card

```
┌─────────────────────────────────────────────────────┐
│ Credential Usage                                    │
│ Shows which credential type is being used          │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Timing Rules API                        ┌─────────┐│
│ /eventConfigFile/timingRulesGet        │Auto Mode││
│                                         └─────────┘│
│                                                     │
│ Participants API                        ┌─────────┐│
│ /temporary/participantsGetAll           │Auto Mode││
│                                         └─────────┘│
│                                                     │
│ Live Results API                        ┌─────────┐│
│ /temporary/temporary_ResultDataGetAll   │Auto Mode││
│                                         └─────────┘│
│                                                     │
│ ⓘ Auto Mode: System tries Event credentials       │
│   first. On 401/403 auth failures, automatically   │
│   retries once with Account credentials. This      │
│   ensures seamless fallback without manual         │
│   intervention.                                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Summary of Improvements

### ✅ Reduced Confusion
- Two credential types now have completely separate sections
- Descriptions clearly explain when to use each type
- No mixing of Event and Account credentials

### ✅ Better Diagnostics
- Validate each credential type independently
- See exactly which credential is failing
- Understand fallback behavior clearly

### ✅ Improved Admin Experience
- Clear visual separation
- Dedicated error messages
- Specific validation checks per credential type
- Status badges show connection state at a glance

### ✅ Simplified Troubleshooting
- If Event credentials fail, you immediately see Account status
- If Account credentials work, you know fallback is available
- Each credential has its own test button
- Each credential has its own save button

### ✅ Professional Appearance
- Well-organized, side-by-side layout
- Clear badges and status indicators
- Detailed validation check displays
- Comprehensive documentation in UI

---

## Testing the New UI

### Test Event Credential:
1. Fill in Access Key and Secret Key for event credential
2. Click "Test Connection" on AK-EVENT card
3. Verify validation checks appear only on that card
4. Account card remains unaffected

### Test Account Credential:
1. Fill in Access Key and Secret Key for account credential
2. Click "Test Connection" on AK-ACCOUNT card
3. Verify validation checks appear only on that card
4. Event card remains unaffected

### Test Independent Failures:
1. Use invalid Event AK/SK, valid Account AK/SK
2. Event card shows failures, Account shows success
3. Admin immediately knows Event is the issue
4. Save both and verify automatic fallback works

### View Credential Usage:
1. Scroll to "Credential Usage" card
2. See all three API endpoints listed
3. All show "Auto Mode" operation
4. Read the explanation of fallback behavior
