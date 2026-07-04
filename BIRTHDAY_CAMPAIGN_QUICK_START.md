# 🚀 Birthday Campaign - Quick Deployment Guide

## One-Time Setup (5 minutes)

### 1️⃣ Get Your Cloudflare Account ID
```bash
# From Cloudflare Dashboard:
# Account Home → Copy Account ID from sidebar
```

### 2️⃣ Update wrangler.toml
```bash
nano wrangler.toml

# Change this line:
# account_id = ""
# To:
# account_id = "your-cloudflare-account-id"
```

### 3️⃣ Set Worker Environment Variables
In Cloudflare Dashboard → Workers & Pages → Settings → Environment Variables:

```
SYNC_SECRET = your-secret-bearer-token
API_BASE_URL = https://bergman.live
ENVIRONMENT = production
```

### 4️⃣ Deploy
```bash
wrangler deploy --env production
```

### 5️⃣ Verify Cron Scheduled
```bash
wrangler cron list --env production

# Output should show:
# ✓ Cron 30 4 * * * (04:30 UTC = 10:00 IST)
# ✓ Cron 35 4 * * * (04:35 UTC = 10:05 IST)
```

---

## Daily Monitoring

### Check if Campaign Ran
```bash
# In Cloudflare Dashboard:
# Workers & Pages → Your Worker → Logs
# Filter: [CRON] at 10:00 IST

# Look for: "Birthday campaign completed"
```

### View Campaign Results
```
Firestore → birthdayCampaignRuns collection
- Filter by today's date
- Check "status" field (should be "success")
- View "emailSent" and "whatsappSent" counts
```

---

## Manual Test

```bash
# Force run campaign now (for testing)
curl -X POST https://bergman.live/api/jobs/birthday-campaign-daily?force=1 \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"

# Expected response:
{
  "success": true,
  "message": "Daily birthday campaigns completed...",
  "stats": {
    "birthdayToday": 2,
    "emailSent": 2,
    "whatsappSent": 2
  }
}
```

---

## Cron Schedule Reference

| Time | IST | UTC | Purpose |
|------|-----|-----|---------|
| 10:00 IST | 10:00 | 04:30 | Primary birthday campaign |
| 10:05 IST | 10:05 | 04:35 | Backup (if 1st fails) |

The campaign will:
1. Find all users with birthday TODAY
2. Create 15% coupon (30 days valid)
3. Send Email + WhatsApp
4. Record results in Firestore

---

## Key Files

| File | Purpose |
|------|---------|
| `wrangler.toml` | Worker config + cron schedule |
| `worker.js` | Cron handler |
| `src/app/api/jobs/birthday-campaign-daily/route.ts` | Campaign API |
| `src/lib/actions/birthdayCampaignActions.ts` | Campaign logic (KV + IST) |

---

## Troubleshooting Quick Links

**Cron not running?**
- Check SYNC_SECRET is set in Worker environment
- Check API_BASE_URL is correct
- Check Worker logs for errors

**No birthdays found?**
- Run manual test with ?force=1
- Check user DOB format (ISO YYYY-MM-DD)
- Verify timezone (now uses IST)

**Emails failing?**
- Check Brevo template 257
- Verify Brevo has credits

**WhatsApp failing?**
- Check user mobile numbers
- Check Aisensy campaign 'birthday'

---

## One-Command Deploy

```bash
# Deploy everything
wrangler deploy --env production

# Verify
wrangler cron list --env production
```

Done! ✅ Birthday campaign now runs daily at 10:00 IST
