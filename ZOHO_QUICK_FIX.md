# ⚡ Zoho OAuth 400 Error - Quick Fix Card

## 🔴 Error Occurs
```
[Zoho Sync Fatal] Error Code: 400
Refresh token expired or invalid
```

## 🟢 Quick Fix (5 minutes)

### Step 1: Diagnose
```bash
# Online (deployed app)
Visit: https://your-app.com/api/zoho-diagnose

# OR Local (no deployment needed)
node zoho-diagnose.js
```

### Step 2: Read the Result
- **"Refresh token expired"** → Go to Step 3A
- **"Client ID/Secret invalid"** → Go to Step 3B
- **"Cannot connect"** → Check internet
- **"Missing env vars"** → Add to apphosting.yaml

### Step 3A: Refresh Token Expired
1. Open: https://accounts.zoho.in/
2. Log in with your Zoho account
3. Go to: Connected Apps → Your OAuth App
4. Click: Re-authorize or Refresh
5. Copy the new **refresh_token**
6. Update `ZOHO_REFRESH_TOKEN` in apphosting.yaml
7. Deploy (or restart server)
8. Test payment sync again

### Step 3B: Invalid Client Credentials
1. Open: https://accounts.zoho.in/
2. Go to: Developer Console → API Credentials
3. Find: Your OAuth Client Application
4. Copy:
   - **Client ID** → `ZOHO_CLIENT_ID`
   - **Client Secret** → `ZOHO_CLIENT_SECRET`
5. Update apphosting.yaml
6. Deploy (or restart server)
7. Test payment sync again

## 🔍 Status Check

**After fixing**, verify by running:
```bash
node zoho-diagnose.js
# Expected: ✓ All checks passed!
```

Or visit diagnostic endpoint:
```
GET https://your-app.com/api/zoho-diagnose
# Expected: { "status": "SUCCESS", ... }
```

## 📋 Checklist

- [ ] Ran `/api/zoho-diagnose`
- [ ] Identified specific error type
- [ ] Followed corresponding fix steps
- [ ] Updated apphosting.yaml if needed
- [ ] Deployed changes
- [ ] Verified with `/api/zoho-diagnose`
- [ ] Payment sync works now

## 🆘 If Still Failing

**Check these in order:**

1. **Environment Variables Exist?**
   ```bash
   echo $ZOHO_CLIENT_ID    # Should show a value
   echo $ZOHO_REFRESH_TOKEN  # Should show a value (partial)
   ```

2. **Zoho Account Active?**
   - Log into https://accounts.zoho.in/
   - Verify you have Books API access

3. **Token Recent?**
   - If refreshing token older than 6 months, get a new one
   - Re-authorize the app: https://accounts.zoho.in/

4. **Network Issues?**
   - Can you reach https://accounts.zoho.in/?
   - Can you reach https://www.zohoapis.in/?

5. **Contact Support**
   - Email Zoho Support with diagnostic output
   - Include: Error code, timestamp, refresh_token (first 15 chars)

## 📞 Quick Links

| Resource | Link |
|----------|------|
| Diagnostic Endpoint | `https://your-app.com/api/zoho-diagnose` |
| Local Test Script | Run: `node zoho-diagnose.js` |
| Zoho OAuth Login | https://accounts.zoho.in/ |
| Zoho Support | https://support.zoho.com/ |
| Full Guide | See: `ZOHO_OAUTH_TROUBLESHOOTING.md` |
| Fix Summary | See: `ZOHO_FIX_SUMMARY.md` |

## ⏱️ Time to Fix

| Error Type | Time | Complexity |
|-----------|------|-----------|
| Expired Token | 5 min | Easy ✅ |
| Bad Credentials | 5 min | Easy ✅ |
| API Down | 10 min | Medium ⏳ |
| Network Issue | 15 min | Medium ⏳ |
| Account Issue | 30 min | Hard ❌ |

---

**Made by**: Auto-generated Zoho OAuth diagnostic system
**Updated**: 2026
**Status**: Production ready ✅
