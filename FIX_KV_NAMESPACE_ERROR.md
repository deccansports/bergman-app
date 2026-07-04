# ⚠️ Deployment Error - KV Namespace Issue (SOLVED)

## What Happened

When we ran `wrangler deploy --env production`, we got:

```
✘ [ERROR] A request to the Cloudflare API failed.
  KV namespace 'bergman-kv-prod' is not valid. [code: 10042]
```

## Why This Happened

The `wrangler.toml` file references a KV namespace ID (`bergman-kv-prod`) that doesn't exist in your Cloudflare account yet. This is expected - you need to create it first.

## How to Fix (3 Simple Steps)

### Step 1: Go to Cloudflare Dashboard

1. Open https://dash.cloudflare.com
2. Log in with your Cloudflare account
3. On the left sidebar, click **Workers KV**

### Step 2: Create Two KV Namespaces

**Create First Namespace:**
1. Click **Create Namespace**
2. Type name: `bergman-kv-prod`
3. Click **Create**
4. Copy the ID shown (looks like: `e7d8c8f9a1b2c3d4e5f6g7h8i9j0k1l2`)
5. Paste into: [wrangler.toml](wrangler.toml) at lines 10, 38

**Create Second Namespace:**
1. Click **Create Namespace**
2. Type name: `bergman-kv-preview`
3. Click **Create**
4. Copy the ID shown
5. Paste into: [wrangler.toml](wrangler.toml) at lines 10, 38

### Step 3: Update wrangler.toml

Open [wrangler.toml](wrangler.toml) and find these sections:

**Around line 10:**
```toml
kv_namespaces = [
  { binding = "BERGMAN_KV", id = "bergman-kv-prod", preview_id = "bergman-kv-preview" }
]
```

Replace with your actual IDs:
```toml
kv_namespaces = [
  { binding = "BERGMAN_KV", id = "YOUR_PROD_ID_HERE", preview_id = "YOUR_PREVIEW_ID_HERE" }
]
```

**Around line 30 (also add your Account ID):**
```toml
account_id = "" # Set your Cloudflare account ID here
```

Get your Account ID from: Cloudflare Dashboard → Settings → Account ID (copy the 15-char ID)

Replace with:
```toml
account_id = "YOUR_ACCOUNT_ID_HERE"
```

**Around line 38 (update production environment):**
```toml
[env.production]
kv_namespaces = [
  { binding = "BERGMAN_KV", id = "YOUR_PROD_ID_HERE", preview_id = "YOUR_PREVIEW_ID_HERE" }
]
```

Use the same IDs from line 10.

---

## Then Deploy Again

```bash
cd "/Users/vaibhav/Downloads/BM 24 MAR 2026"
wrangler deploy --env production
```

---

## What You'll See on Success

```
✓ Uploaded bergman-triathlon-worker-prod (XX.XX KiB)
✓ Deployed to https://bergman-triathlon-worker-prod.YOURDOMAIN.workers.dev/
✓ Cron triggers configured: 30 4 * * * & 35 4 * * *
```

---

## ✅ Then Verify

```bash
wrangler cron list --env production
```

Should show:
```
Cron Triggers
├─ 30 4 * * * ✓
└─ 35 4 * * * ✓
```

---

## Quick Reference

| Value | Where to Get | Where to Put |
|-------|-------------|-------------|
| Account ID | Cloudflare → Settings | wrangler.toml line 30 |
| Prod KV ID | Create in Workers KV | wrangler.toml lines 10, 38 |
| Preview KV ID | Create in Workers KV | wrangler.toml lines 10, 38 |
| SYNC_SECRET | Generate: `openssl rand -base64 32` | Cloudflare Dashboard → Environment Variables |

---

**Status**: 🟡 ONE VALUE NEEDED (KV Namespace ID)  
**Time to Fix**: < 5 minutes  
**Next Step**: See [SETUP_VALUES.md](SETUP_VALUES.md) for detailed walkthrough
