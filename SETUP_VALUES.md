# 🔧 QUICK SETUP - Fill In These Values

## 1️⃣ Get Your Cloudflare Account ID

Go to: https://cloudflare.com/a/account/login
Then: Settings → Account ID (copy the 15-character ID)

```
Your Account ID: ___________________________
```

---

## 2️⃣ Create KV Namespaces

Go to: https://dash.cloudflare.com → Workers KV

**Create First Namespace:**
- Name: `bergman-kv-prod`
- Copy the ID shown after creation

```
Production KV ID: ___________________________
```

**Create Second Namespace:**
- Name: `bergman-kv-preview`
- Copy the ID shown after creation

```
Preview KV ID: ___________________________
```

---

## 3️⃣ Generate SYNC_SECRET

Run this in terminal:
```bash
openssl rand -base64 32
```

Copy the output:
```
SYNC_SECRET: ___________________________
```

---

## 4️⃣ Update wrangler.toml

Edit [wrangler.toml](wrangler.toml) and replace:

**Line 30:**
```toml
account_id = "YOUR_ACCOUNT_ID_HERE"
```
→ Replace with your Account ID from Step 1

**Lines 10-12:**
```toml
kv_namespaces = [
  { binding = "BERGMAN_KV", id = "YOUR_PROD_ID_HERE", preview_id = "YOUR_PREVIEW_ID_HERE" }
]
```
→ Replace with IDs from Step 2

**Lines 38-40:**
```toml
[env.production]
kv_namespaces = [
  { binding = "BERGMAN_KV", id = "YOUR_PROD_ID_HERE", preview_id = "YOUR_PREVIEW_ID_HERE" }
]
```
→ Replace with same IDs from Step 2

---

## 5️⃣ Set Environment Variables

Go to: https://dash.cloudflare.com → Workers → bergman-triathlon-worker-prod → Settings → Environment Variables

**Add these variables:**

| Name | Value | Type |
|------|-------|------|
| SYNC_SECRET | (paste from Step 3) | Secret |
| API_BASE_URL | https://bergman.live | Plain Text |
| ENVIRONMENT | production | Plain Text |

---

## 6️⃣ Deploy

Run:
```bash
cd "/Users/vaibhav/Downloads/BM 24 MAR 2026"
wrangler deploy --env production
```

---

## ✅ Verify

```bash
# Check if deployed
wrangler cron list --env production

# Should show:
# Cron Triggers
# ├─ 30 4 * * * ✓
# └─ 35 4 * * * ✓
```

---

**That's it!** Birthday campaign will run automatically daily at 10:00 IST 🎉
