# Bergman Live Tracking Worker

This worker powers the enterprise live tracking hub.

## Storage design

### Firestore
Keep admin configuration only:
- event config
- provider config
- sync engine config
- timing point mapping
- leaderboard rules
- replay and monitoring settings

### Cloudflare KV
Use for hot reads:
- athlete live state
- leaderboard cache
- search index
- last known athlete position
- overview summary

### Cloudflare R2
Use for durable history:
- raw timing reads
- historical tracking data
- replay packages
- leaderboard snapshots
- analytics exports

### Durable Objects
Use for:
- live race state
- active athlete counters
- live leaderboard calculations
- race status and transitions

## Public API
- GET /v1/events/:eventId/overview
- GET /v1/events/:eventId/athletes?mode=live|history
- GET /v1/events/:eventId/leaderboard?mode=overall&limit=25
- GET /v1/events/:eventId/timings
- GET /v1/events/:eventId/replay
- GET /v1/events/:eventId/monitoring
- GET /v1/events/:eventId/logs

## Admin API
- POST /v1/events/:eventId/provider/test
- POST /v1/events/:eventId/sync/participants
- POST /v1/events/:eventId/sync/results
- POST /v1/events/:eventId/sync/leaderboard

## KV keys
- live:event:{eventId}:athletes
- live:event:{eventId}:leaderboard:{mode}:{limit}
- live:event:{eventId}:overview
- live:event:{eventId}:timings
- live:event:{eventId}:monitoring

## R2 folders
- event/{eventId}/raw/
- event/{eventId}/results/
- event/{eventId}/leaderboards/
- event/{eventId}/replay/
- event/{eventId}/analytics/
