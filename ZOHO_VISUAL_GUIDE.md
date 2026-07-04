# 🔧 Zoho OAuth Error Diagnosis - Visual Guide

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     BERGMAN ATHLETE HUB                             │
│                   Payment Sync Process                              │
└────────────────────┬────────────────────────────────────────────────┘
                     │
    ┌────────────────┴────────────────┐
    │                                 │
    ▼                                 ▼
  SUCCESS                          FAILURE (400)
    │                                 │
    ✅ Invoice                   [Zoho Sync Fatal]
       created                        │
    │                                 ▼
    ✅ Payment                   🆘 Generic Error?
       applied                    [No longer!]
    │                                 │
    ✅ WhatsApp                  ▼──────────────────────────────┐
       sent                       Now you get:                   │
    │                            ✅ Specific error type          │
    ▼                            ✅ Root cause identified         │
[END]                            ✅ Fix suggestion provided      │
                                 ✅ Diagnostic endpoint link    │
                                        │
                                        ▼
                            Visit: /api/zoho-diagnose
                                        │
                        ┌───────────────┼───────────────┐
                        │               │               │
                    ✅ SUCCESS      🚫 EXPIRED       🚫 BAD CREDS
                        │            TOKEN           │
                        │             │               │
                   All checks      Re-authorize   Update creds
                   passed          at Zoho        in apphosting
                        │             │               │
                        ▼             ▼               ▼
                   ✅ Zoho          ✅ Zoho         ✅ Zoho
                   Ready            Ready           Ready
                        │             │               │
                        └─────────┬───┴───────────────┘
                                  │
                                  ▼
                            Payment Sync
                           Retries & Works
                                  │
                                  ▼
                            ✅ Invoice Created
                            ✅ Payment Applied
```

## Error Detection Tree

```
┌─────────────────────────────────┐
│ getZohoAccessToken() called     │
└────────────────┬────────────────┘
                 │
      ┌──────────┴──────────┐
      │                     │
      ▼                     ▼
   ✅ SUCCESS         ❌ ERROR (400)
      │                     │
      │              ┌──────┴──────┐
      │              │             │
      │              ▼             ▼
      │         invalid_grant  invalid_client
      │              │             │
      │              ▼             ▼
      │         Token              Client ID
      │         Expired            or Secret
      │         or Invalid         Invalid
      │              │             │
      │              ▼             ▼
      │    Fix: Re-authorize   Fix: Update
      │    at Zoho accounts    credentials
      │              │             │
      └──────────┬───┴─────────────┘
                 │
                 ▼
        ✅ Zoho API Call
           Succeeds
```

## File Interaction Map

```
Payment Sync Flow:
═════════════════

syncPaymentToZohoAction()
  │
  ├─→ zohoFetch() [fetch.ts]
  │   ├─→ try getZohoAccessToken() [token.ts]
  │   │   ├─→ Validate env vars
  │   │   ├─→ POST to Zoho OAuth endpoint
  │   │   └─→ Enhanced error detection
  │   │       ├─→ invalid_grant? → "Token expired"
  │   │       ├─→ invalid_client? → "Bad credentials"
  │   │       └─→ Other? → "OAuth error"
  │   │
  │   └─→ Error caught in zohoFetch()
  │       ├─→ Detect 400 status
  │       ├─→ Check for auth failure
  │       └─→ Throw with better message
  │
  └─→ Error caught in invoiceActions
      ├─→ Log with diagnostic hint
      └─→ Return with suggestion to run /api/zoho-diagnose


Diagnostic Flow:
════════════════

User visits: /api/zoho-diagnose
  │
  ├─→ Validate env vars
  │   ├─→ ZOHO_CLIENT_ID ✓
  │   ├─→ ZOHO_CLIENT_SECRET ✓
  │   ├─→ ZOHO_REFRESH_TOKEN ✓
  │   ├─→ ZOHO_API_DOMAIN ✓
  │   └─→ ZOHO_ORG_ID ✓
  │
  ├─→ Test token refresh
  │   └─→ Catch 400 errors
  │       ├─→ invalid_grant? → Suggest re-auth
  │       ├─→ invalid_client? → Suggest credential check
  │       └─→ Other? → Suggest API check
  │
  ├─→ Test API call (if token succeeds)
  │   └─→ Check organizations list
  │
  └─→ Return specific diagnosis + suggested action
```

## Error Messages: Before vs After

### Before Enhancement ❌
```
[Zoho Sync Fatal] Error Code: 400, Message: Request failed with status code 400
[Zoho Sync Fatal] Full Error: { "error": "invalid_grant" }

🤔 What now? No idea where the problem is.
```

### After Enhancement ✅
```
[Zoho Sync Fatal] Participant ID: w26Yrm3YfBwm6ZXTEhsq
[Zoho Sync Fatal] Error Code: 400, Message: [Zoho] Refresh token expired or invalid. Please re-authorize the app.
💡 DIAGNOSTIC: Zoho refresh token likely expired. Run: /api/zoho-diagnose

👉 Next step is clear:
   1. Visit /api/zoho-diagnose
   2. It will confirm token is expired
   3. Follow the fix: Re-authorize at Zoho
   4. Retry payment sync
```

## Diagnostic Endpoint Response Examples

### ✅ Success Response
```json
{
  "status": "SUCCESS",
  "envDump": {
    "ZOHO_CLIENT_ID": "1000...",
    "ZOHO_ORG_ID": "60013782026",
    "ZOHO_API_DOMAIN": "https://www.zohoapis.in"
  },
  "tokenScope": "ZohoBooks.FullAccess.ALL",
  "orgResponse": [
    {
      "id": "60013782026",
      "name": "Bergman Athlete Hub"
    }
  ]
}
```

### 🚫 Expired Token Response
```json
{
  "status": "FAILED",
  "diagnosis": "Refresh token expired or invalid",
  "suggestedAction": "Re-authorize the Zoho app at https://accounts.zoho.in/",
  "httpStatus": 400,
  "zohoError": {
    "error": "invalid_grant",
    "error_description": "Refresh token has been revoked or expired."
  }
}
```

### 🚫 Bad Credentials Response
```json
{
  "status": "FAILED",
  "diagnosis": "Client ID or Secret is invalid",
  "suggestedAction": "Verify ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in environment variables",
  "httpStatus": 400,
  "zohoError": {
    "error": "invalid_client",
    "error_description": "The client ID supplied is invalid."
  }
}
```

### 🚫 Missing Env Vars Response
```json
{
  "status": "ERROR",
  "reason": "Missing environment variables",
  "missingEnvVars": ["ZOHO_CLIENT_SECRET", "ZOHO_ORG_ID"],
  "suggestedAction": "Add these variables to apphosting.yaml"
}
```

## Decision Tree: How to Fix

```
    Got a Zoho 400 error?
           │
           ▼
    Run /api/zoho-diagnose
           │
       ┌───┴───┬─────────────┬──────────────┐
       │       │             │              │
    SUCCESS MISSING      EXPIRED       BAD CREDS
       │      VARS       TOKEN         │
       │       │             │         │
       ▼       ▼             ▼         ▼
    ✅ All   ❌ Add    ❌ Go to    ❌ Check
       ok    env       Zoho &      creds
            vars     re-auth      in Zoho
             │         │          console
             │         │          │
             ▼         ▼          ▼
          Redeploy  Copy new   Copy
          app       token      correct
             │      │          ID/Secret
             │      ▼          │
             │    Update      ▼
             │    apphosting  Update
             │         │      apphosting
             │         ▼      │
             └────┬────────┬──┘
                  │        │
                  ▼        ▼
              Redeploy   Redeploy
              app        app
                  │        │
                  └────┬───┘
                       │
                       ▼
              Test payment sync
                       │
                ┌──────┴──────┐
                │             │
                ✅ WORKS      ❌ STILL FAILS
                │             │
             SUCCESS     Check:
                        - Internet
                        - Zoho status
                        - Cloud logs
                        - Ask Zoho
```

## Timeline: Fix Duration by Error Type

```
Error Type              Time to Fix    Complexity    Manual Steps
────────────────────────────────────────────────────────────────
Expired Token              5 min          Easy          3-4
Invalid Credentials        5 min          Easy          3-4
Missing Env Vars           5 min          Easy          1-2
Network Timeout           10 min          Medium        2-3
Rate Limited             Variable        Easy          1
Zoho Account Issue        30+ min         Hard          5+
Server Down              15-60 min       Medium        1
────────────────────────────────────────────────────────────────
AVERAGE                    ~7 min         Easy          3-4
```

## Component Interaction Sequence

```
Participant Registers Payment
    │
    ▼
syncPaymentToZohoAction(eventId, participantId)
    │
    ├──→ Fetch participant from Firestore
    │
    ├──→ Fetch registration from Firestore
    │
    ├──→ zohoFetch("/invoices", { ... })
    │   │
    │   └──→ getZohoAccessToken()
    │       │
    │       ├──→ Check: ZOHO_CLIENT_ID exists? ✓
    │       ├──→ Check: ZOHO_CLIENT_SECRET exists? ✓
    │       ├──→ Check: ZOHO_REFRESH_TOKEN exists? ✓
    │       │
    │       └──→ POST https://accounts.zoho.in/oauth/v2/token
    │           │
    │           ├──→ Status 200? → Return token ✓
    │           │
    │           └──→ Status 400?
    │               │
    │               ├──→ error = "invalid_grant"?
    │               │    └──→ Throw "[Zoho] Refresh token expired..."
    │               │
    │               ├──→ error = "invalid_client"?
    │               │    └──→ Throw "[Zoho] Client ID or Secret invalid..."
    │               │
    │               └──→ Other error?
    │                    └──→ Throw generic message
    │
    ├──→ Error caught in zohoFetch()
    │   │
    │   └──→ Check: is 400 auth error?
    │       └──→ Throw "Zoho authentication failed..."
    │
    ├──→ Error caught in invoiceActions()
    │   │
    │   └──→ Log "[Zoho Sync Fatal] ... 💡 Run /api/zoho-diagnose"
    │   └──→ Update participant.zohoSyncError
    │   └──→ Return error response
    │
    └──→ User sees error + diagnostic hint
        │
        ├──→ Visits /api/zoho-diagnose endpoint
        │   │
        │   ├──→ Validates all env vars
        │   ├──→ Tests token refresh
        │   ├──→ Tests API call
        │   └──→ Returns specific diagnosis
        │
        └──→ Follows suggested fix
            │
            └──→ Re-run payment sync
                │
                └──→ ✅ Success!
```

## Color Legend

```
✅ SUCCESS           - Operation completed as expected
❌ ERROR/FAILURE     - Expected error that was handled
🚫 BLOCKED           - Request was blocked (auth, rate limit, etc.)
⏳ PENDING           - Operation in progress or awaiting action
💡 DIAGNOSTIC HINT   - Helpful information for troubleshooting
👉 ACTION REQUIRED   - User needs to take a specific action
⚠️  WARNING           - Potential issue, not critical yet
🔴 CRITICAL          - System down or major failure
🟢 WORKING           - System functioning normally
```

## Quick Glance: Where to Look for Different Issues

| Issue | Look Here |
|-------|-----------|
| Error happens | Server logs: `[Zoho Sync Fatal]` |
| Want to diagnose | Visit: `/api/zoho-diagnose` |
| Test locally | Run: `node zoho-diagnose.js` |
| Learn how to fix | Read: `ZOHO_OAUTH_TROUBLESHOOTING.md` |
| Need quick steps | See: `ZOHO_QUICK_FIX.md` |
| Token refresh code | Check: `src/lib/zoho/token.ts` |
| API wrapper code | Check: `src/lib/zoho/fetch.ts` |
| Payment sync code | Check: `src/lib/actions/invoiceActions.ts` |

---

**Created**: 2026
**Purpose**: Visual guide for Zoho OAuth 400 error diagnosis
**Audience**: Developers, DevOps, Support
**Format**: Diagrams + Examples
