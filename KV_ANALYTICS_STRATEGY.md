# KV Analytics Metrics Strategy

## Overview
The Overview Tab (Registration Overview) now uses **Cloudflare KV exclusively** to fetch aggregated registration metrics. This eliminates Firestore `collectionGroup` queries that were causing FAILED_PRECONDITION errors.

## KV Data Structure

### Metrics Keys
Aggregated metrics are stored with these KV keys:

```
analytics:country:{IN|US}:metrics
analytics:event:{eventId}:metrics
```

### Metrics Content
Each metrics key stores a JSON object with:
```json
{
  "totalRegistrations": 124,
  "todaysRegistrations": 2,
  "totalSales": 1175255.79,
  "totalFreeRegistrations": 0,
  "totalRefunds": 0.00,
  "recentTransactions": [
    {
      "id": "...",
      "name": "Himangshu Hatimuria",
      "email": "himangshu4@gmail.com",
      "eventName": "BERGMAN BENGALURU 2026",
      "registeredAt": "2026-03-27T18:02:00Z",
      "amountPaidPaisa": 1551000,
      "ticketStatus": "Active"
    },
    ...
  ],
  "lastUpdated": "2026-03-27T18:30:00Z"
}
```

## How Sync Works

### 1. **Automatic Sync During Data Sync Job**
When an admin runs "Sync Data" → "Participants":
- Participants are synced to KV
- Country-level metrics are computed and cached
- Event-level metrics are computed and cached
- All in one job

### 2. **Manual Refresh Button**
Admin can click the **Refresh** button next to the event selector:
- **For Countries (India/USA):** Fetches all events in that country, aggregates metrics, caches to KV
- **For Specific Events:** Fetches participants for that event, computes metrics, caches to KV
- Updates KV and refreshes the UI

### 3. **Auto-Sync on Missing Data**
If metrics are not found in KV:
- The UI shows "Loading..." placeholder
- Computation runs in the background (non-blocking)
- On next refresh, the computed metrics are displayed
- User is not blocked from seeing the UI

## Implementation Details

### Function: `getEventRegistrationOverviewMetricsAction`
**File:** `src/lib/actions/analyticsActions.ts`

**Flow:**
1. Try to fetch metrics from KV
2. If not found:
   - Return placeholder (0s)
   - Trigger background computation
3. If found:
   - Return cached metrics immediately

**No Firestore queries** - Ever!

### Function: `computeCountryRegistrationMetricsAction`
**File:** `src/lib/actions/analyticsActions.ts`

**What it does:**
1. Queries Firestore for events in specified country
2. Queries Firestore for participants in those events
3. Queries Firestore for cancellations in those events
4. Aggregates the data
5. Stores result in KV with key: `analytics:country:{country}:metrics`

**Triggered by:**
- Manual sync job (for participants)
- Manual refresh button click
- Auto-sync when data missing from KV

### Function: `computeEventRegistrationMetricsAction`
**File:** `src/lib/actions/analyticsActions.ts`

**What it does:**
- Same as country version, but for single event
- Stores in KV with key: `analytics:event:{eventId}:metrics`

## When to Sync

### Automatic Sync
- ✅ After participant registration
- ✅ After participant deletion
- ✅ After category changes
- ✅ During "Sync Data" admin job

### Manual Sync
- Click the **Refresh** button in Overview Tab
- Takes ~5-30 seconds depending on participant count

### Auto-Sync on Demand
- First view of Overview Tab with missing data triggers auto-sync
- Shows "Loading..." while computing
- No manual action needed

## Performance Impact

| Scenario | Before | After |
|----------|--------|-------|
| Open Overview Tab (cached) | 1000ms (Firestore query) | 50ms (KV fetch) |
| Open Overview Tab (no cache) | ❌ Error | 50ms (return placeholder) + background sync |
| Refresh metrics | 1000ms | ~20 seconds (compute + store) |

## Troubleshooting

### "No recent registrations found"
- Sync may not have run yet
- Click the **Refresh** button to manually trigger

### Metrics show 0s
- KV cache is computing in background
- Refresh the page in 10-30 seconds
- Or click the **Refresh** button manually

### Stale data (old numbers)
- Last sync may be old
- Click **Refresh** button to update from current data

## Future Enhancements

1. **Scheduled Job:** Set up a cron job to auto-sync metrics every hour
2. **Change Hooks:** Trigger metrics sync on participant registration/deletion
3. **Event Expiry:** Clear old event metrics from KV after 6 months
4. **Metrics History:** Store daily snapshots for trend analysis
