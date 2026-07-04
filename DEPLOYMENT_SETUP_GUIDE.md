# 🚀 Cloudflare Worker Deployment Setup Guide

## ⚠️ Current Issue

The deployment failed because:
1. **KV Namespace ID mismatch** - The wrangler.toml references `bergman-kv-prod` but this ID may not exist in your Cloudflare account
2. **Missing Cloudflare Account ID** - wrangler.toml has empty `account_id`
3. **Missing SYNC_SECRET** - Birthday campaign auth token not set

---

## ✅ Step-by-Step Setup

### Step 1: Get Your Cloudflare Account ID

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click your profile → **Settings**
3. Look for **Account ID** (15-character alphanumeric)
4. Copy it

### Step 2: Create or Identify Your KV Namespace

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **Workers KV** in left sidebar
3. Click **Create Namespace**
   - Name: `bergman-kv-prod` (for production)
   - Click **Create**
4. You'll see an ID that looks like: `e7d8c8f9a1b2c3d4e5f6g7h8i9j0k1l2`
5. Copy this ID

### Step 3: Create Preview KV Namespace

1. In the same **Workers KV** page
2. Click **Create Namespace** again
   - Name: `bergman-kv-preview`
   - Click **Create**
3. Copy this ID as well

### Step 4: Update wrangler.toml

Open [wrangler.toml](wrangler.toml) and update:

```toml
# Line 30: Add your Cloudflare account ID
account_id = "YOUR_CLOUDFLARE_ACCOUNT_ID_HERE"

# Lines 9-12: Update KV namespace IDs
kv_namespaces = [
  { 
    binding = "BERGMAN_KV", 
    id = "YOUR_PROD_KV_ID_HERE", 
    preview_id = "YOUR_PREVIEW_KV_ID_HERE" 
  }
]

# Lines 37-39: Update production environment KV IDs
[env.production]
kv_namespaces = [
  { 
    binding = "BERGMAN_KV", 
    id = "YOUR_PROD_KV_ID_HERE", 
    preview_id = "YOUR_PREVIEW_KV_ID_HERE" 
  }
]
```

### Step 5: Set Environment Variables in Cloudflare

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers**
2. Find **bergman-triathlon-worker-prod** in the list
3. Click it → **Settings** → **Environment Variables**
4. Add these variables:

| Variable | Value | Type |
|----------|-------|------|
| `SYNC_SECRET` | Your secure random token (e.g., `sk_live_abc123xyz789...`) | Secret |
| `API_BASE_URL` | `https://bergman.live` | Plain Text |
| `ENVIRONMENT` | `production` | Plain Text |

**Generate SYNC_SECRET:**
```bash
# Generate a secure random token (run this in your terminal)
openssl rand -base64 32
```

Copy the output and use it as SYNC_SECRET.

### Step 6: Deploy

Run:
```bash
cd "/Users/vaibhav/Downloads/BM 24 MAR 2026"
wrangler deploy --env production
```

Expected output:
```
✓ Uploaded bergman-triathlon-worker-prod (XX.XX KiB)
✓ Deployed to https://bergman-triathlon-worker-prod.YOURDOMAIN.workers.dev/
```

### Step 7: Verify Cron Triggers

Run:
```bash
wrangler cron list --env production
```

Expected output:
```
Cron Triggers
├─ 30 4 * * * (10:00 IST) ✓
└─ 35 4 * * * (10:05 IST) ✓
```

### Step 8: Verify Birthday Campaign Endpoint

Your Next.js backend should have this endpoint:
```
POST https://bergman.live/api/jobs/birthday-campaign-daily
Authorization: Bearer {SYNC_SECRET}
```

Make sure it exists and responds with:
```json
{
  "success": true,
  "message": "Birthday campaign executed",
  "count": 12
}
```

---

## 🔍 Troubleshooting

### KV Namespace Error: "not valid [code: 10042]"
**Solution:** 
- Verify KV namespace ID exists in Cloudflare dashboard
- Ensure both prod and preview namespaces are created
- Update wrangler.toml with correct IDs

### Account ID Error
**Solution:**
- Copy Account ID from Cloudflare dashboard (Settings)
- Update wrangler.toml line 30
- Must be 15-character alphanumeric

### Deployment Fails with "Unauthorized"
**Solution:**
- Check if SYNC_SECRET is set in Cloudflare Worker environment
- Verify it matches the value your Next.js backend expects
- Check that environment variables are set in "Settings" → "Environment Variables"

### Cron Not Triggering
**Solution:**
1. Verify cron triggers are listed: `wrangler cron list --env production`
2. Check Cloudflare Worker logs at 10:00 IST daily
3. Verify `/api/jobs/birthday-campaign-daily` endpoint exists and is accessible
4. Test manually with:
   ```bash
   curl -X POST https://bergman.live/api/jobs/birthday-campaign-daily \
     -H "Authorization: Bearer YOUR_SYNC_SECRET" \
     -H "Content-Type: application/json"
   ```

---

## 📊 Configuration Summary

### What You'll Have After Setup

✅ Cloudflare Worker deployed with:
- API routes: /health, /sync/webhook, /athlete/*, /debug/*, /timing/*, /live/*
- Scheduled cron triggers at 10:00 IST & 10:05 IST daily
- KV namespace for edge caching
- Environment variables for secure access

✅ Birthday Campaign:
- Runs automatically daily at 10:00 IST
- Backup trigger at 10:05 IST if first fails
- Sends emails via Brevo
- Sends WhatsApp via Aisensy
- Creates 15% off birthday coupons

✅ Data Flow:
```
Daily 10:00 IST
    ↓
Cloudflare scheduled() handler
    ↓
Calls POST /api/jobs/birthday-campaign-daily
    ↓
Next.js backend processes birthdays
    ↓
Loads user profiles from KV cache (3-4x faster)
    ↓
Sends emails + WhatsApp
    ↓
Logs results to Firestore
```

---

## 🧪 Testing

### Manual Test (After Deployment)

```bash
# 1. Test worker is deployed
curl https://bergman-triathlon-worker-prod.workers.dev/health

# 2. Expected response
{
  "status": "ok"
}

# 3. Test birthday campaign endpoint manually
curl -X POST https://bergman.live/api/jobs/birthday-campaign-daily \
  -H "Authorization: Bearer YOUR_SYNC_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'

# 4. Monitor logs in Cloudflare dashboard
# Workers → bergman-triathlon-worker-prod → Logs
```

### Monitor Cron Execution

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **Workers** → **bergman-triathlon-worker-prod**
3. Click **Logs** tab
4. Filter for `[CRON]` prefix
5. View daily execution at 10:00 IST

---

## 📝 Checklist Before Go-Live

- [ ] Account ID added to wrangler.toml
- [ ] KV namespace prod ID added to wrangler.toml
- [ ] KV namespace preview ID added to wrangler.toml
- [ ] SYNC_SECRET generated and set in Cloudflare
- [ ] API_BASE_URL set to https://bergman.live
- [ ] ENVIRONMENT set to "production"
- [ ] Deployed successfully: `wrangler deploy --env production`
- [ ] Cron triggers verified: `wrangler cron list --env production`
- [ ] /health endpoint responds with {"status":"ok"}
- [ ] /api/jobs/birthday-campaign-daily endpoint exists
- [ ] Test birthday campaign manual execution succeeded
- [ ] Monitor logs show [CRON] entries at 10:00 IST

---

## 🎉 Success Indicators

Once deployed, you'll see:

✅ **In Cloudflare Logs** (10:00 IST daily):
```
[CRON] Scheduled event triggered: 2026-04-01T04:30:00Z
[CRON] Birthday campaign result: {"success": true, "count": 12}
```

✅ **In Firestore**:
- `birthdayCampaignRuns` collection
- New document each day with results
- Status: "success" or "failed"

✅ **In User Emails**:
- Birthday campaign emails received
- Subject: "Happy Birthday! 🎉 - 15% Off Your Next Race"

✅ **In User WhatsApp**:
- Automated birthday message
- Birthday coupon code included

---

**Status**: ✅ READY TO DEPLOY  
**Last Updated**: April 1, 2026  
**Next Step**: Follow Step 1 above to get your Cloudflare Account ID
