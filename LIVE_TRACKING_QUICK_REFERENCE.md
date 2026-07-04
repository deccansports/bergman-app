# Bergman Live Tracking Platform V2 - Quick Reference

## 🚀 Quick Start (10 Minutes)

### 1. Access Admin Panel
```
Navigate to: /admin/dashboard
Click: "Live Tracking & Results" tab
```

### 2. Select Event
```
Dropdown at top: Select your event
System loads existing config
```

### 3. Configure Provider (Tab 2)
```
Select: Feibot (or Racemap/RaceResult)
Enter: Access Key, Secret Key, Event UUID
Click: "Test Connection" ✓
Click: "Save Hub"
```

### 4. Review Timing Points (Tab 4)
```
Auto-populated from provider
Adjust as needed
Click: "Save Hub"
```

### 5. Launch Event
```
Go to: /tracking/{eventId}
Should see live leaderboard
Real-time athlete updates flowing
```

---

## 📊 Admin Panel Tabs

| Tab | Purpose | Action |
|-----|---------|--------|
| 1. Dashboard | Monitor health | Read-only metrics |
| 2. Provider | Configure Feibot/Racemap | Enter credentials |
| 3. Race Config | Define categories | Add race categories |
| 4. Timing Points | Map checkpoints | Review & adjust |
| 5. Leaderboard Rules | Select modes | Check/uncheck |
| 6. Live Operations | Watch feed | Real-time monitor |
| 7. Athlete Search | Find athletes | Search & view timeline |
| 8. Results Center | Manage results | Import, publish, export |
| 9. Replay | Configure replay | Set speeds & storage |
| 10. Monitoring | System health | Check error rates |
| 11. Logs | Audit trail | Review all actions |
| 12. API Tester | Debug endpoints | Test & inspect JSON |

---

## 🔑 Environment Variables

```bash
NEXT_PUBLIC_LIVE_TRACKING_EDGE_API_BASE=https://worker-subdomain.workers.dev
LIVE_TRACKING_INTERNAL_TOKEN=your-secret-token
FEIBOT_ACCESS_KEY=your-key
FEIBOT_SECRET_KEY=your-secret
```

---

## 📍 URLs

| Page | URL | Purpose |
|------|-----|---------|
| Admin Panel | `/admin/dashboard` | Event configuration |
| Live Tracking | `/tracking/{eventId}` | Public leaderboard |
| Athlete Detail | `/athletes/{athleteId}` | Individual athlete |
| Results | `/results` | All results & categories |
| Replay | `/replay/{eventId}` | Race replay player |

---

## ⚙️ Configuration Workflow

### Feibot Setup
```
1. Tab 2: Select "Feibot"
2. Get from https://feibot.com:
   - Access Key
   - Secret Key
   - Event UUID
3. Paste into form
4. Click "Test Connection"
5. Should see: ✓ Connected
6. Click "Import Timing Rules"
7. Click "Save Hub"
```

### Racemap Setup
```
1. Tab 2: Select "Racemap"
2. Get from https://racemap.com:
   - API Key
   - Event ID
   - API URL
3. Paste into form
4. Click "Test Connection"
5. Click "Save Hub"
```

### Race Categories
```
1. Tab 3: "Add Category"
2. Enter:
   - Name: "BERGMAN 102"
   - Type: "triathlon"
   - Swim: 1.9 km
   - Bike: 90 km
   - Run: 21.1 km
3. Click "Save"
```

### Leaderboard Modes
```
1. Tab 5: Uncheck modes you don't want
2. Keep checked:
   ✓ Overall
   ✓ Male / Female
   ✓ Age Group
   ✓ Club
3. Set display count: 25
4. Click "Save Hub"
```

---

## 🔍 During Live Event

### Monitor
- Tab 1: Dashboard metrics
- Tab 10: Monitoring health
- Tab 11: Logs for issues

### Search Athletes
- Tab 7: Search by bib/name
- View current split & rank
- See last detection time

### Fix Issues
- Sync not updating? Tab 3: Check sync schedule
- Provider down? Tab 2: Test connection
- Leaderboard slow? Tab 1: Check cache hit rate

### Emergency: Timing Correction
```
1. Tab 7: Find athlete
2. Identify timing issue
3. Tab 8: Submit correction with:
   - Original time
   - Corrected time
   - Reason
   - Evidence URL
4. Status: Pending
5. Race director approves
6. Status: Applied
7. Leaderboards recalculate
```

---

## 📤 Post-Event Workflow

### Publish Results
```
1. Tab 8: "Import Results"
2. System syncs from provider
3. Review athlete count
4. Click "Publish Results"
5. Public sees results
```

### Generate Certificates
```
1. Tab 8: "Generate Certificates"
2. Select format: PDF/PNG
3. Click "Generate"
4. System creates files
5. Optional: Send via email
```

### Export Data
```
1. Tab 8: "Export CSV"
2. Choose format
3. Download file
4. Use for analytics/processing
```

### View Analytics
```
1. Tab 9: "Analytics"
2. See:
   - Participation %
   - Geographic breakdown
   - Popular search terms
   - Top athletes
```

---

## 🔒 Security

### Feibot Signing
```
All requests signed with HMAC-SHA256:

Header: X-Feibot-Signature
= HMAC-SHA256(
    secret_key,
    METHOD + PATH + TIMESTAMP + NONCE + BODY
  )
```

### Internal API Token
```
Header: X-Bergman-Internal-Token: {token}

Used for:
- Cloudflare worker config retrieval
- Admin APIs
- Inter-service communication
```

### Rate Limiting
```
Per IP: 1000 requests/minute
Per user: 10000 requests/minute
Burst capacity: Cloudflare scales automatically
```

---

## 📊 Metrics to Monitor

| Metric | Target | Action if Low |
|--------|--------|---------------|
| Cache Hit Rate | 95%+ | Wait for warm cache |
| API Latency | <100ms | Check provider status |
| Sync Delay | <10 sec | Increase sync frequency |
| KV Reads | 50k+/sec | Upgrade Cloudflare plan |
| Error Rate | <1% | Check Tab 11 logs |

---

## 🆘 Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Provider red X | Wrong credentials | Verify in Tab 2 |
| Leaderboard not updating | Sync disabled | Tab 3: Set to 30 sec |
| Slow load | Cache cold | Wait 5 minutes |
| Athletes not found | Search index stale | Tab 1: Refresh Athletes |
| High errors | Provider down | Check Feibot status |

---

## 📞 Support Checklist

```
❑ Check Tab 11 (Logs) for errors
❑ Check Tab 12 (API Tester) - run endpoint
❑ Check Tab 10 (Monitoring) - worker health
❑ Check Feibot status page
❑ Verify network connectivity
❑ Hard refresh browser (Ctrl+Shift+R)
❑ Clear browser cache
❑ Try incognito window
❑ Check Cloudflare worker logs
❑ Contact: support@bergmanathletes.com
```

---

## 🎯 Key Concepts

### KV Cache
- Ultra-fast reads (50k+/sec)
- Expires after event
- Populated by Cloudflare worker

### Durable Objects
- One per event
- Manages race state
- Orchestrates syncs

### R2 Storage
- Historical data
- Replay datasets
- Archive for 30 days

### Provider Abstraction
- Frontend never knows provider type
- Easy to swap providers
- All data normalized

### Sync Jobs
- Cloudflare cron triggers
- Feibot → KV/R2
- Automatic leaderboard calc

---

## 🚢 Deployment

### Deploy Worker
```bash
cd cloudflare/live-tracking-worker
wrangler publish
```

### Deploy App
```bash
npm run build
firebase deploy --only apphosting
```

### Verify
```bash
npm run typecheck
npm run lint
npm run build
```

---

## 📚 Full Documentation

For complete details see: `LIVE_TRACKING_PLATFORM_V2_GUIDE.md`

Sections covered:
- Architecture & design
- Setup & installation
- Configuration step-by-step
- Admin workflows
- Public pages features
- Provider integration
- Monitoring & alerting
- Troubleshooting guide
- API reference
- Performance targets

---

**Version:** 2.0  
**Last Updated:** June 24, 2026  
**Status:** Ready for Production

Access via: `/admin/dashboard` → Live Tracking & Results
