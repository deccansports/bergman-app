# Quick Reference: Analytics Auto-Sync

## What's New?

Overview metrics in KV now automatically update with latest participant data.

## Three Sync Methods

| Method | How | When | Latency |
|--------|-----|------|---------|
| **Manual (UI)** | Click ⚡ button in Overview tab | On-demand | Instant |
| **Auto (Scheduler)** | Cloud Scheduler job | Every 5 minutes | 5 mins max |
| **Event (Existing)** | Click ↻ refresh in Overview tab | On-demand per event | Instant |

## Dashboard Changes

### New Button
- **Location**: Admin → Overview tab (right of refresh button)
- **Icon**: ⚡ (lightning/zap)
- **Color**: Amber (#b45309)
- **Behavior**: 
  - Click → syncs all upcoming event metrics
  - Shows spinner while syncing
  - Toast feedback on completion
  - Button disables during sync

## KV Cache Keys

After sync, these keys are updated:

```
analytics:overview_metrics:all-in      // India (all upcoming events)
analytics:overview_metrics:all-us      // USA (all upcoming events)
analytics:overview_metrics:{eventId}   // Specific event
```

Each contains latest metrics from Firestore.

## Setup Checklist

### For Testing (Done Immediately)
- [x] Click ⚡ button in admin Overview tab
- [x] See "Analytics Synced" toast
- [x] Verify KV cache updated

### For Production (Cloud Scheduler)
1. Add `ANALYTICS_SYNC_SECRET` to Firebase secrets (if not same as SECRET_KEY)
2. Create Cloud Scheduler job:
   - **URL**: `https://your-domain/api/jobs/analytics-sync-periodic`
   - **Schedule**: `*/5 * * * *`
   - **Auth**: Bearer token (ANALYTICS_SYNC_SECRET)
3. Test with `curl` or Cloud Logs

## API Endpoints

**Manual Sync**
```bash
curl -X POST "https://your-domain/api/admin/analytics-sync?type=all" \
  -H "Authorization: Bearer $ANALYTICS_SYNC_SECRET"
```

**Scheduled Job** (Cloud Scheduler)
```bash
GET https://your-domain/api/jobs/analytics-sync-periodic
Authorization: Bearer SECRET_KEY
```

## What Gets Synced

- Athlete analytics snapshot
- Global participant stats
- Retention stats (current year)
- Country metrics (India/USA)
- Per-event metrics (upcoming only)

## Troubleshooting

| Issue | Check |
|-------|-------|
| Button doesn't work | Is ANALYTICS_SYNC_SECRET in Firebase secrets? |
| Still see stale data | Click ⚡ again or check KV TTL (24h default) |
| Scheduler not running | Check Cloud Logs and scheduler status |
| Partial failures | Check response errors array; retry specific items |

## Files Changed

- `src/app/api/admin/analytics-sync/route.ts` (new)
- `src/app/api/jobs/analytics-sync-periodic/route.ts` (new)
- `src/components/admin/OverviewTab.tsx` (updated)
- `apphosting.yaml` (updated)

## Next: Try It Now

1. Go to Admin → Overview tab
2. Click ⚡ button
3. See toast: "Analytics Synced"
4. Metrics in KV refreshed!

---

See [ANALYTICS_AUTO_SYNC_GUIDE.md](ANALYTICS_AUTO_SYNC_GUIDE.md) for detailed setup.
