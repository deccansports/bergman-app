# Cloudflare Stream RTMPS Ingest Debugging Guide

## Issue Summary
Valid Cloudflare Live Inputs disconnect immediately after OBS connects successfully. Cloudflare never reports `connected=true` or creates playback recordings.

---

## Diagnostic Tools Available

### 1. **Pre-Flight Live Input Diagnostics**
When you reveal stream key credentials in the admin panel:
- **Endpoint**: `POST /api/broadcast/live-input` with `action: "reveal_key"`
- **What it checks**:
  - Fetches fresh Live Input state from Cloudflare
  - Compares 4 copies of the stream key: Firestore encrypted, Firestore decrypted, Cloudflare API, UI value
  - SHA-256 hashes all four to detect any mutation
  - Verifies Live Input is `enabled=true`
  - Returns complete RTMP/SRT/WebRTC publish lifecycle

**Check the response for**:
```json
{
  "preFlightDiagnostics": {
    "keyComparison": {
      "matches": {
        "cloudflareVsFirestoreDecrypted": true,  // Must be TRUE
        "cloudflareVsUI": true,                  // Must be TRUE
        "allThreeMatch": true                     // Must be TRUE
      }
    },
    "liveInputState": {
      "enabled": true,                           // Must be TRUE
      "connected": false,                        // Expected before ingest
      "status": null                             // Expected before ingest
    }
  }
}
```

### 2. **Token Scope Verification**
- **Endpoint**: `GET /api/broadcast/debug/token-scopes`
- **What it checks**:
  - Token verification status (active/inactive/expired)
  - Stream Read access
  - Account Read access
  - Probable Edit permissions

**Expected output**:
```
✓ Stream Read: YES
✓ Account Read: YES
✓ Likely has Edit permissions
✓ Token is active
```

### 3. **Live Input State Observer**
- **Endpoint**: `GET /api/broadcast/debug/cloudflare?liveInputUid=<uid>&observe=true&observeSeconds=30`
- **What it does**:
  - Polls the Live Input every second for 30 seconds
  - Records when `connected` transitions from false → true
  - Logs `status`, `lastSeen`, `lastError` changes
  - Shows if Cloudflare ever receives the encoder connection

**Expected during OBS ingest**:
```
Second 1: connected=null → should transition to true within 5-10 seconds
Second 5-15: connected=true, status=live
```

---

## Manual Cloudflare Dashboard Test

### Step 1: Create a Test Live Input
1. Go to [Cloudflare Dashboard → Stream → Live Inputs](https://dash.cloudflare.com/?to=/:account/stream/inputs)
2. Click **"Create Input"**
3. Name it `test-manual-gopro-ingest`
4. Set:
   - **Recording** → Automatic
   - **Access Control** → Public
5. Click **Create**
6. Copy the **RTMPS URL** and **Stream Key**

### Step 2: Test in OBS with Manual Live Input
1. In OBS, go to **Settings → Stream**
2. Set:
   - **Service**: Custom
   - **Server**: `rtmps://live.cloudflare.com:443/live/`
   - **Stream Key**: `<paste from dashboard>`
3. Click **Start Streaming**
4. Watch the OBS logs:
   - ✓ "Connection to rtmps://... successful" → good sign
   - ✗ Immediate disconnect → potential Live Input issue

### Step 3: Monitor in Cloudflare Dashboard
While OBS is streaming:
1. Go back to your Live Input in the dashboard
2. Refresh (F5)
3. Look for:
   - **Status**: Should show "Ready" or "Live"
   - **Connected**: Should show "Yes"
   - **Last Seen**: Should show a recent timestamp
4. Click **"View Playback"** → should load a preview

### Step 4: Compare Results
- **Manual Live Input works** → Issue is specific to programmatic creation
- **Manual Live Input also fails** → Issue is token permissions or Cloudflare account configuration

---

## Programmatic Live Input Test (App-Created)

### Step 1: Create via Admin Panel
1. Go to `/broadcast` in your app
2. Select an event
3. Click **"Add Camera"**
4. Fill in details and click **"Create"**
5. Click **"Reveal Key"** on the created camera

### Step 2: Compare Output
In the browser console, check:
```json
{
  "preFlightDiagnostics": {
    "liveInputState": {
      "enabled": true,
      "connected": false
    },
    "keyComparison": {
      "matches": {
        "allThreeMatch": true
      }
    }
  }
}
```

### Step 3: Test with Same Credentials
Use the exact same credentials (server + key) in OBS and monitor via `/api/broadcast/debug/cloudflare?observe=true`

---

## Debugging Checklist

- [ ] **Pre-Flight Check**: All 4 key copies match
- [ ] **Live Input State**: `enabled=true`
- [ ] **Token Scopes**: All permissions verified as ✓
- [ ] **OBS Logs**: "Connection successful" appears
- [ ] **Live Input Observer**: No connection transitions within 30 seconds
- [ ] **Manual Dashboard Test**: Works/Fails (circle one)
- [ ] **Cloudflare Account**: Has active Stream subscription
- [ ] **API Token**: Expires on `<date>` (check not expired)

---

## Key Investigation Areas

### If only programmatic Live Inputs fail:
- Cloudflare may have an undocumented field requirement for programmatically created inputs
- Check if the Live Input needs to be "activated" or "warmup" before accepting RTMP
- Verify that `recording.mode: "automatic"` doesn't have side effects

### If all Live Inputs fail (manual + programmatic):
- API token may not have full Stream Edit permissions
- Cloudflare account may have Stream disabled or not subscribed
- Firewall/geo-blocking on your network to Cloudflare RTMP servers

### If connection succeeds but immediately drops:
- Cloudflare may be enforcing a handshake timeout
- RTMP encoder may not be sending audio/video frames within expected window
- Look for `lastError` field in Live Input state

---

## Next Steps

1. Run the **Pre-Flight Diagnostics** and share the `keyComparison` and `liveInputState` output
2. Run **Token Scope Verification** and confirm all checks pass
3. Test **Manual Dashboard Creation** and report if it works
4. Run **Live Input Observer** during OBS connection and share the timeline
5. Check Cloudflare account plan (Stream must be enabled)

