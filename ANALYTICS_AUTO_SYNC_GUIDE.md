# Auto-Sync Analytics Metrics to KV

## Overview

This document describes the automated analytics metrics sync system that keeps KV Cache updated with real-time participant data for upcoming events.

## What It Does

- **Automatic**: Runs every 5 minutes via Cloud Scheduler
- **Smart**: Only syncs upcoming events (saves resources)
- **Comprehensive**: Updates country metrics (India/USA) and per-event metrics
- **Resilient**: Handles failures gracefully, continues on partial errors

## Architecture

### Components

1. **Analytics Compute Action** (`src/lib/actions/analyticsActions.ts`)
   - `computeCountryRegistrationMetricsAction(country)`: Fetches live participant data from Firestore, computes metrics, stores in KV
   - `computeEventRegistrationMetricsAction(eventId)`: Same for individual events
   - Metrics computed: `totalRegistrations`, `todaysRegistrations`, `totalSales`, `totalFreeRegistrations`, `totalRefunds`, `recentTransactions`

2. **Admin Sync Endpoint** (`src/app/api/admin/analytics-sync/route.ts`)
   - **Method**: POST
   - **Auth**: Bearer token (ANALYTICS_SYNC_SECRET)
   - **Query Params**:
     - `type`: 'all' | 'country' | 'event' (default: 'all')
     - `country`: 'IN' | 'US' (only if type='country')
     - `eventId`: specific event id (only if type='event')
   - **Response**: Success status, results for each synced item, errors list

3. **Periodic Job** (`src/app/api/jobs/analytics-sync-periodic/route.ts`)
   - **Method**: GET
   - **Trigger**: Cloud Scheduler (every 5 minutes)
   - **Auth**: Bearer token (SECRET_KEY)
   - **Behavior**: Calls admin sync endpoint with `type=all`

4. **Admin UI Button** (`src/components/admin/OverviewTab.tsx`)
   - **Label**: Zap icon (⚡)
   - **Color**: Amber
   - **Behavior**: Triggers analytics-sync endpoint manually
   - **Shows**: Spinner while syncing

### KV Cache Structure

Metrics are stored with these keys:

```
analytics:overview_metrics:all-in       // India all-events
analytics:overview_metrics:all-us       // USA all-events
analytics:overview_metrics:{eventId}    // Specific event
```

Each value contains:
```json
{
  "totalRegistrations": number,
  "todaysRegistrations": number,
  "totalSales": number,
  "totalFreeRegistrations": number,
  "totalRefunds": number,
  "recentTransactions": [{id, name, email, eventName, registeredAt, amountPaidPaisa, ticketStatus}]
}
```

## Setup

### 1. Environment Variables

Add to your Firebase App Hosting secrets:

```
ANALYTICS_SYNC_SECRET: [unique-random-secret-key]
```

Reference in `apphosting.yaml`:
```yaml
  - variable: ANALYTICS_SYNC_SECRET
    secret: ANALYTICS_SYNC_SECRET
    availability:
      - BUILD
      - RUNTIME
```

### 2. Cloud Scheduler Job

Create a scheduled job in your Firebase project:

#### Via Google Cloud Console

1. Go to Cloud Scheduler in your Firebase project
2. Create new job:
   - **Name**: `analytics-sync-periodic`
   - **Description**: Auto-sync analytics metrics to KV
   - **Frequency**: `*/5 * * * *` (every 5 minutes)
   - **Timezone**: Your preferred timezone

3. Configure execution:
   - **HTTP method**: GET
   - **URL**: `https://your-app-hosting-domain.com/api/jobs/analytics-sync-periodic`
   - **Auth header**: Add OIDC token for your service account (or Bearer token)

#### Via Command Line (gcloud)

```bash
# Set variables
PROJECT_ID="your-firebase-project-id"
REGION="us-central1"
APP_HOSTING_DOMAIN="your-app-hosting-domain.com"
SECRET_KEY="your-secret-key"

# Create job
gcloud scheduler jobs create http analytics-sync-periodic \
  --project=$PROJECT_ID \
  --location=$REGION \
  --schedule="*/5 * * * *" \
  --uri="https://${APP_HOSTING_DOMAIN}/api/jobs/analytics-sync-periodic" \
  --http-method=GET \
  --headers="Authorization=Bearer ${SECRET_KEY}" \
  --oidc-service-account-email=your-service-account@${PROJECT_ID}.iam.gserviceaccount.com \
  --oidc-token-audience="https://${APP_HOSTING_DOMAIN}/api/jobs/analytics-sync-periodic"
```

### 3. Manual Sync

**Manual trigger** via admin dashboard:
- Go to **Overview** tab in admin panel
- Click the **⚡ Zap** button (right of refresh button)
- Wait for "Analytics Synced" toast

**Manual trigger** via API:
```bash
curl -X POST "https://your-domain.com/api/admin/analytics-sync?type=all" \
  -H "Authorization: Bearer $ANALYTICS_SYNC_SECRET" \
  -H "Content-Type: application/json"
```

## Troubleshooting

### Sync not running
- Check Cloud Scheduler job status in Google Cloud Console
- Verify `ANALYTICS_SYNC_SECRET` is set in Firebase App Hosting secrets
- Check Cloud Logs for `/api/jobs/analytics-sync-periodic`

### Metrics stale
- KV cache TTL defaults to 24 hours
- Manual refresh: Click ⚡ button in admin panel
- Or trigger from API: `POST /api/admin/analytics-sync?type=all`

### Partial failures
- Admin endpoint returns 207 (Multi-Status) on partial success
- Check `errors` array in response for which items failed
- Individual items can be retried by specifying `type=event&eventId=xxx`

### High error rate
- Check Firestore quota usage
- Check KV namespace availability
- Verify all env vars are set correctly
- Look at detailed logs in Cloud Logs

## Performance

- **Time per event**: ~200-500ms (Firestore query + KV write)
- **Time for all**: ~2-5 seconds for typical load (50-100 upcoming events)
- **Concurrency**: No locks; Cloud Scheduler prevents overlap via job timeout
- **Cost**: Negligible (1 Firestore read per event, 1 KV write per item)

## Future Enhancements

1. **Event-triggered sync**: Fire metrics update when participant registers
2. **Real-time notifications**: Webhook to frontend when metrics update
3. **Selective sync**: Only sync events with registration changes
4. **Batching**: Group multiple events into single request to reduce API calls

## Related Files

- [analyticsActions.ts](src/lib/actions/analyticsActions.ts) - Metric computation logic
- [admin/analytics-sync/route.ts](src/app/api/admin/analytics-sync/route.ts) - Sync endpoint
- [jobs/analytics-sync-periodic/route.ts](src/app/api/jobs/analytics-sync-periodic/route.ts) - Scheduled job
- [OverviewTab.tsx](src/components/admin/OverviewTab.tsx) - Admin UI
