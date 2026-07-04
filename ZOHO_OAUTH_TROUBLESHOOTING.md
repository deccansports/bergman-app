# Zoho OAuth 400 Error Troubleshooting Guide

## Error Symptoms
```
[Zoho Sync Fatal] Error Code: 400
Error in getZohoAccessToken() when refreshing OAuth token
```

## Root Causes (In Order of Likelihood)

### 1. **Refresh Token Expired** (Most Common)
- **Error**: `invalid_grant` in Zoho response
- **Cause**: Zoho refresh tokens expire after long periods of inactivity (typically 6+ months)
- **Fix**: 
  1. Visit: https://accounts.zoho.in/
  2. Log in with your Zoho account
  3. Navigate to "Connected Apps" or OAuth settings
  4. Re-authorize the Books application
  5. Copy the new refresh token
  6. Update `ZOHO_REFRESH_TOKEN` in apphosting.yaml
  7. Deploy the changes

### 2. **Invalid Client Credentials**
- **Error**: `invalid_client` in Zoho response
- **Cause**: ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET is incorrect or missing
- **Fix**:
  1. Log in to Zoho: https://accounts.zoho.in/
  2. Go to Developer Console → API Credentials
  3. Find your OAuth client application
  4. Verify and copy the correct:
     - Client ID
     - Client Secret
  5. Update both in apphosting.yaml:
     ```yaml
     - variable: ZOHO_CLIENT_ID
       secret: <correct-client-id>
     - variable: ZOHO_CLIENT_SECRET
       secret: <correct-client-secret>
     ```
  6. Deploy the changes

### 3. **Missing Environment Variables**
- **Error**: "Zoho OAuth credentials not configured"
- **Cause**: One or more of the required env vars are not set
- **Required Vars**:
  - `ZOHO_CLIENT_ID`
  - `ZOHO_CLIENT_SECRET`
  - `ZOHO_REFRESH_TOKEN`
  - `ZOHO_API_DOMAIN` (typically: https://www.zohoapis.in)
  - `ZOHO_ORG_ID` (typically: 60013782026)
- **Fix**: Ensure all vars are set in apphosting.yaml

### 4. **Zoho API Service Issue**
- **Error**: Timeout or 503 error
- **Cause**: Zoho API is temporarily unavailable
- **Fix**: Wait a few minutes and try again

## How to Diagnose the Issue

### Step 1: Run the Diagnostic Endpoint
Visit: `https://your-app.com/api/zoho-diagnose`

This endpoint will:
- ✅ Check all required environment variables
- ✅ Attempt to refresh the Zoho OAuth token
- ✅ Validate the token by calling Zoho API
- ✅ Provide specific error diagnosis and suggested fix

### Step 2: Analyze the Response

If successful:
```json
{
  "status": "SUCCESS",
  "tokenScope": "ZohoBooks.FullAccess.ALL",
  "orgResponse": [
    {
      "id": "60013782026",
      "name": "Bergman..."
    }
  ]
}
```

If failed, look for the `diagnosis` field:
- **"Refresh token expired or invalid"** → Re-authorize the app
- **"Client ID or Secret is invalid"** → Check credentials
- **"Cannot connect to Zoho API"** → Check internet/DNS
- **"Request timeout"** → Zoho is slow/down

### Step 3: View Detailed Logs
Check cloud logs for detailed error messages:
- `[Zoho Token]` logs in token.ts
- `[Zoho Diagnose]` logs in diagnose endpoint
- Look for specific error codes: `invalid_grant`, `invalid_client`, etc.

## Refresh Token Authorization Flow (Manual Re-auth)

If the refresh token has expired, you need to manually authorize:

1. **Get OAuth Authorization Code**:
   ```
   https://accounts.zoho.in/oauth/v2/auth?response_type=code
   &client_id=YOUR_CLIENT_ID
   &scope=ZohoBooks.FullAccess.ALL
   &redirect_uri=https://your-app.com/callback
   &state=security-state-string
   ```

2. **User logs in** and grants permissions

3. **Exchange code for tokens**:
   ```bash
   curl -X POST https://accounts.zoho.in/oauth/v2/token \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=AUTH_CODE_FROM_STEP_2" \
     -d "redirect_uri=https://your-app.com/callback"
   ```

4. **Extract and save the refresh_token** from the response

5. **Update apphosting.yaml** with the new refresh token

## Prevention

- **Monitor Token Age**: Refresh tokens can expire after 6-12 months of inactivity
- **Schedule Periodic Auth**: Plan for re-authorization every 6 months
- **Keep Credentials Secure**: Don't commit secrets to version control
- **Use Secrets Manager**: Store Zoho credentials in Cloud Secret Manager, not in .env files

## Related Files

- [src/lib/zoho/token.ts](src/lib/zoho/token.ts) - Token refresh logic with enhanced error handling
- [src/lib/zoho/fetch.ts](src/lib/zoho/fetch.ts) - Zoho API wrapper with 400 error detection
- [src/app/api/zoho-diagnose/route.ts](src/app/api/zoho-diagnose/route.ts) - Diagnostic endpoint
- [apphosting.yaml](apphosting.yaml) - Environment variables configuration

## Error Codes Reference

| Code | Meaning | Action |
|------|---------|--------|
| `invalid_grant` | Refresh token expired/invalid | Re-authorize app |
| `invalid_client` | Client ID/Secret wrong | Check credentials |
| `invalid_scope` | Scope not authorized | Re-authorize with proper scope |
| 401 | Unauthorized (access token invalid) | Automatic retry will refresh token |
| 400 | Bad request | Check request parameters |
| 429 | Rate limit exceeded | Implement backoff (already done) |
| 503 | Service unavailable | Retry after delay |

## Contact Zoho Support

If the issue persists after checking above:
1. Visit: https://support.zoho.com/
2. Provide error code and diagnostic output
3. Include the refresh token (first 15 chars) in the report
