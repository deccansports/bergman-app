# 🔧 Fix Club Dashboard - Manual Sync Guide

## Problem
Club dashboard still showing:
- `TBD` for event dates
- `Unknown Ticket` for ticket names

## Root Cause
The KV cache was populated before the code fix. It needs to be refreshed with the new data from Firestore.

## Solution: Manual Club Sync

### Step 1: Find Your Club ID

1. Go to your club dashboard
2. Look at the URL: `https://bergman.live/club-dashboard/CLUB_ID`
3. Copy the `CLUB_ID` (looks like: `AgeC53KUjCCUxZW6IYHK`)

### Step 2: Trigger the Sync

Run this curl command (replace `CLUB_ID` with your actual club ID):

```bash
curl -X POST "https://api.bergmantri.com/api/admin/sync-club-upcoming?clubId=AgeC53KUjCCUxZW6IYHK"
```

Or if you're testing locally:

```bash
curl -X POST "http://localhost:9003/api/admin/sync-club-upcoming?clubId=AgeC53KUjCCUxZW6IYHK"
```

### Step 3: Verify the Sync

Expected response:
```json
{
  "success": true,
  "message": "Club AgeC53KUjCCUxZW6IYHK upcoming athletes synced to KV",
  "clubId": "AgeC53KUjCCUxZW6IYHK"
}
```

### Step 4: Refresh Your Dashboard

1. Go to your club dashboard
2. Refresh the page (Cmd+R or Ctrl+R)
3. Event dates and ticket names should now show correctly!

---

## What This Does

The sync endpoint:
1. ✅ Reads all club members from Firestore
2. ✅ For each member, loads their upcoming event registrations from KV
3. ✅ Copies **eventDate**, **eventName**, **ticketName**, **ticketId** to the club's upcoming list
4. ✅ Stores the complete data back to KV
5. ✅ Club dashboard now displays correct information

---

## Example

### Before Sync
```
Athlete: Vaibhav
Ticket: Unknown Ticket
Date: TBD
```

### After Sync
```
Athlete: Vaibhav
Ticket: Premium
Date: 2026-04-15
```

---

## For Multiple Clubs

If you need to sync all clubs:

```bash
# Get all club IDs
curl http://localhost:9003/api/admin/clubs-list

# Then run sync for each club
curl -X POST "http://localhost:9003/api/admin/sync-club-upcoming?clubId=ID1"
curl -X POST "http://localhost:9003/api/admin/sync-club-upcoming?clubId=ID2"
curl -X POST "http://localhost:9003/api/admin/sync-club-upcoming?clubId=ID3"
```

---

## Why This Happened

1. Old KV data was cached with incomplete event information
2. Code fix was deployed to copy eventDate & ticketName
3. But old KV data wasn't automatically refreshed
4. Solution: Manually trigger sync to refresh with new code

---

## Going Forward

After this sync, any **new registrations** will automatically have complete event data because the code fix is in place. This manual sync is only needed this one time to clean up the old cached data.

---

**Status**: ✅ Simple 1-command fix  
**Time**: < 1 minute  
**Result**: Event dates and ticket names will display correctly
