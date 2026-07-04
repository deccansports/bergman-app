# Ignored Tickets & Auth Fix Implementation Complete

## Summary
Implemented three critical features to improve Contest Mapping reliability and data accuracy:

1. **Ignored Tickets Feature** - Allow admins to exclude unused categories from coverage calculation
2. **Contest Sync Auth Fix** - Properly handle HTTP 401 failures without masking them as success
3. **Athlete Tracking Fix** - Load and display athlete data from Bergman registrations as fallback

---

## 1. Ignored Tickets Feature

### Backend Changes (`/src/app/api/live/contest-mapping/[eventId]/route.ts`)

#### 1.1 Auto-Mapping Skip Logic (Lines ~76-99)
**File**: `autoMapTicketByPriority()`
```typescript
if (savedEntry?.ignored === true) {
  return {
    contest: null,
    confidence: 0,
    mappingType: 'ignored' as const,
    reason: 'Ticket is ignored by admin',
  };
}
```
- **Impact**: Skips auto-mapping for ignored tickets
- **Behavior**: Never overwrites `ignored=true` status
- **Persistence**: Ignored state preserved across syncs

#### 1.2 Mapping UI Response (Lines ~1082-1123)
**File**: `buildMappingsForUi()`
```typescript
const isIgnored = savedEntry?.ignored === true;
return {
  ...mapping,
  ignored: isIgnored,
  liveTrackingEnabled: !isIgnored && !!contest,
  status: isIgnored ? 'ignored' : (contest ? 'mapped' : 'missing'),
  mode: isIgnored ? 'ignored' : ...,
}
```
- **New Fields**:
  - `ignored: boolean` - Whether ticket is ignored by admin
  - `liveTrackingEnabled: boolean` - Whether to enable live tracking (not ignored + has contest)
  - `status` now includes 'ignored' value
- **UI Display**: Ready for row coloring (green/gray/red)

#### 1.3 Coverage Calculation Update (Lines ~1145-1155)
**Formula Change**: Required = Total Leaf Tickets - Ignored Tickets
```typescript
const totalLeafTickets = mappings.length;
const ignoredTickets = mappings.filter((row) => row.ignored === true).length;
const requiredTickets = totalLeafTickets - ignoredTickets;
const mappedTickets = mappings.filter((row) => !!row.contestUuid && row.ignored !== true).length;
const missingTickets = requiredTickets - mappedTickets;
const coverage = requiredTickets > 0 ? Math.round((mappedTickets / requiredTickets) * 100) : 0;
```
- **Impact**: Ignored tickets don't reduce coverage percentage
- **Benefit**: Accurate coverage metrics only for active categories

#### 1.4 Response Metrics Update (Lines ~1190-1204)
**New Summary Fields**:
```typescript
mappingSummary: {
  leafTickets: totalLeafTickets,
  ignored: ignoredTickets,        // NEW
  required: requiredTickets,      // NEW
  mapped: mappedTickets,
  missing: missingTickets,
  coverage,
  requiredText: '${mapped} Mapped, ${ignored} Ignored, ${manual} Manual, ${auto} Auto, ${missing} Missing',
}
```
- **Frontend Ready**: UI can display new metrics

#### 1.5 Ignored State Persistence in PUT (Lines ~1310-1315)
**Preserve Ignored Flag During Save**:
```typescript
// Load existing mappings to preserve ignored state
const savedMappings = await getKV<Record<string, any>>(
  `event:${eventId}:ticketMappings`, 
  'api-contest-mapping'
);
const savedTicketsById = (savedMappings as any)?.ticketsById || {};

// Preserve ignored status
const isIgnored = savedTicketsById[ticket.mappingId]?.ignored === true;

// Save with ignored field
ticketsById[ticket.mappingId] = {
  ...fields,
  ignored: isIgnored,
  status: isIgnored ? 'ignored' : (contestUuid ? 'mapped' : 'missing'),
}
```
- **Behavior**: Ignored status survives sync operations
- **Protection**: Never overwritten by auto-map or imports

---

## 2. Contest Sync Authentication Fix

### Problem
HTTP 401/403 auth failures were:
- Writing cached contests to KV (incorrect)
- Claiming success in response (dangerous)
- Masking real authentication issues

### Solution: Separate Auth Failures from Other Failures

**File**: `syncContestsFromFeibot()` (Lines ~827-928)

#### 2.1 HTTP 401/403 Handling (NEW - Lines ~837-857)
```typescript
// MODE 1: AUTHENTICATION FAILURE - Do NOT write to KV
if (providerResponse?.status === 401 || providerResponse?.status === 403) {
  const httpStatus = Number(providerResponse?.status);
  const cachedContests = extractContestsFromConfig(config);

  return {
    contests: cachedContests,
    config,
    sync: {
      authentication: 'AUTHENTICATION_FAILED',
      httpStatus,
      contestApi: 'SKIPPED_AUTH_FAILURE',
      kvWrite: 'SKIPPED',  // KEY: Never write to KV
      reason: `HTTP ${httpStatus}: Authentication failed. Using cached contests.`,
      cacheStatus: {
        usingCache: true,
        cachedContestCount: cachedContests.length,
        lastSyncedAt: config?.lastContestSync?.syncedAt || null,
        message: 'Using contests from last successful sync due to authentication failure',
      },
    },
  };
}
```
- **KV Protection**: `kvWrite: 'SKIPPED'` - Never writes on auth failure
- **Cache Status**: Clear indication of auth vs cache
- **Transparency**: Admin can see auth issue

#### 2.2 Other Failures Handling (Lines ~860-928)
```typescript
// MODE 2: OTHER FAILURES - Try fallback, write to KV if successful
if (!providerResponse?.ok) {
  // Tries fallback sources
  // Only writes to KV if fallback succeeds
  authentication: 'UNKNOWN_FAILURE',  // Distinguish from auth failures
}
```
- **Fallback**: Tries alternate contest sources
- **Safe Write**: Only writes if data is valid
- **Clear Status**: Different status from auth failures

#### 2.3 Successful Sync (Lines ~965+)
```typescript
// MODE 3: HTTP 200 - Normal successful sync
// Write to KV, update lastContestSync timestamp
```
- **KV Write**: `kvWrite: 'PASS'`
- **Timestamp**: `lastContestSync` updated
- **Success**: Contests from Feibot API

### Response Structure
```typescript
sync: {
  authentication: 'AUTHENTICATION_FAILED' | 'UNKNOWN_FAILURE' | 'PASS',
  httpStatus: number,
  kvWrite: 'PASS' | 'SKIPPED' | 'FAILED',
  cacheStatus: {
    usingCache: true,
    cachedContestCount: number,
    lastSyncedAt: ISO string,
    message: string,
  },
}
```

---

## 3. Athlete Tracking Data Fix

### Problem
LiveTrackingHub displayed "No athletes found" even when athletes registered.

### Root Cause
`getLiveTimingDataAction()` returned empty array when:
- No live timing data yet (liveAthletes collection empty)
- No Cloudflare edge data
- No fallback to registrations

### Solution: Load Bergman Participants as Fallback

**File**: `/src/lib/actions/ingestActions.ts` (Lines ~247-363)

#### 3.1 Load Chain (Priority Order)
1. **Cloudflare Edge API** (real-time live data)
2. **Firestore liveAthletes** (processed timing data)
3. **Bergman Participants** (NEW - registrations as fallback)

#### 3.2 Bergman Participants Fallback (Lines ~287-310)
```typescript
// Fallback to loading Bergman participants if no live data exists
const adminDb2 = getFirestoreInstance();
const bergmanSnapshot = await adminDb2
  .collection('events')
  .doc(eventId)
  .collection('participants')
  .get();

if (!bergmanSnapshot.empty) {
  participants = bergmanSnapshot.docs.map(doc => {
    const data = serializeValue({ id: doc.id, ...doc.data() }) as any;
    return {
      id: doc.id,
      bib: String(data.bibNumber || data.bib || '—'),
      name: String(data.name || data.firstName || '—'),
      status: 'On Course' as Status,
      leg: 'NOT_STARTED' as Leg,
      summary: {},
      splits: [],
      courseProgress: 0,
    } as LiveAthlete;
  });
}
```

#### 3.3 Status & Message
```typescript
return {
  success: true,
  message: 'Athletes loaded from Bergman registrations (no live data yet).',
  participants
}
```
- **Clear Status**: Admin knows data source
- **Complete Display**: Athlete list shows all registrations
- **Ready for Tracking**: As live data arrives, real-time updates take over

---

## Testing Checklist

### Ignored Tickets
- [ ] Create ticket mapping
- [ ] Mark ticket as "ignored" via UI button (next sprint)
- [ ] Verify coverage % excludes ignored tickets
- [ ] Run auto-map, confirm ignored tickets aren't mapped
- [ ] Verify ignored status persists after sync
- [ ] Verify UI shows gray color for ignored rows

### Contest Sync Auth Fix
- [ ] Test with valid credentials (HTTP 200) - should write KV ✓
- [ ] Test with invalid credentials (HTTP 401) - should NOT write KV, show cache ✓
- [ ] Verify response.sync.kvWrite shows correct status
- [ ] Verify response.sync.cacheStatus shown on auth failure
- [ ] Check logs show authentication failure clearly

### Athlete Tracking
- [ ] Clear liveAthletes collection in Firestore
- [ ] Navigate to LiveTrackingHub
- [ ] Verify "No athletes found" no longer shows (replaced with Bergman data)
- [ ] Verify athlete list shows registered participants
- [ ] Verify search/filter works on Bergman data
- [ ] Test that real-time data takes over when liveAthletes data arrives

---

## Files Modified

1. **`/src/app/api/live/contest-mapping/[eventId]/route.ts`** (1475 lines)
   - Added ignored ticket handling to `autoMapTicketByPriority()`
   - Updated `buildMappingsForUi()` with ignored status
   - Fixed coverage calculation formula (Required = Total - Ignored)
   - Updated GET response metrics
   - Updated PUT endpoint to preserve ignored flags
   - Separated HTTP 401/403 auth failure handling in `syncContestsFromFeibot()`
   - Added `cacheStatus` field for auth failures

2. **`/src/lib/actions/ingestActions.ts`** (363 lines)
   - Updated `getLiveTimingDataAction()` to load Bergman participants as fallback
   - Added conditional return when liveAthletes found
   - Added bergman fallback collection query

---

## Next Steps (UI Implementation)

### LiveTrackingHub Updates Needed
1. Display new metrics: `mappingSummary.ignored`, `mappingSummary.required`
2. Add row coloring:
   - Green: `status === 'mapped'`
   - Gray: `status === 'ignored'`
   - Red: `status === 'missing'`
3. Add "Ignore" / "Restore" buttons per row
4. Add warning banner when `sync.cacheStatus.usingCache === true`
5. Update summary display with ignored count

---

## Data Structure Changes

### Ticket Mapping Object
```typescript
{
  mappingId: string,
  displayName: string,
  contestUuid: string | null,
  ignored: boolean,  // NEW
  liveTrackingEnabled: boolean,  // NEW
  status: 'mapped' | 'ignored' | 'missing',  // Updated
  ...other fields
}
```

### Coverage Calculation
```typescript
// OLD (INCORRECT)
coverage = Math.round((mapped / total) * 100)

// NEW (CORRECT)
coverage = Math.round((mapped / (total - ignored)) * 100)
```

### Sync Response
```typescript
{
  sync: {
    authentication: 'AUTHENTICATION_FAILED' | 'UNKNOWN_FAILURE' | 'PASS',
    kvWrite: 'PASS' | 'SKIPPED',
    cacheStatus: {
      usingCache: boolean,
      cachedContestCount: number,
      lastSyncedAt: ISO string,
      message: string,
    },
  }
}
```

---

## Risk Assessment

### Low Risk Changes ✓
- Ignored flag doesn't affect existing data
- Coverage formula more accurate
- Auth fix is clearly separated logic

### Protection Measures
- `ignored` status persists in KV
- Auth failures clearly labeled
- Fallback data source maintains athlete display
- All changes backward compatible

---

## Deployment Notes

1. **No Database Migration Required** - New fields optional, defaults work
2. **Backward Compatible** - Old configs still work
3. **Graceful Degradation** - Falls back to Bergman data if needed
4. **Safe to Deploy** - Auth fix prevents data corruption

