# Troubleshooting Club Duplicates Not Showing

## Quick Diagnostic Checklist

### Step 1: Verify Data in Firestore
- [ ] Go to Admin Dashboard → Club Merge Tool
- [ ] Click **"View All Clubs"** button
- [ ] Alert should show: `Total clubs in Firestore: 59` (or your current count)
- [ ] Check browser console (F12 → Console tab) for the full club list

**Expected**: Should see 59 clubs with duplicates like:
- "trifitzone" (ID: AgeC53KUjCCUxZW6IYHK)
- "trifit zone" (ID: 12V54wmUeawY1UYrfTDW)

**If you see fewer clubs**: Data may have been synced/cleaned up already

---

### Step 2: Run Debug Analysis
- [ ] Click **"Debug"** button in Club Merge Tool
- [ ] Alert shows summary numbers
- [ ] Open browser console (F12) to see detailed breakdown
- [ ] Look for log messages showing duplicate groups

**Expected Console Output**:
```
=== CLUBS DEBUG START ===
[STEP 1] Found 59 total documents in Firestore
[STEP 2] Found 2 duplicate name groups:
  Duplicate 1: "trifitzone"
    1. ID: AgeC53KUjCCUxZW6IYHK, Coach: ..., City: ...
    2. ID: 12V54wmUeawY1UYrfTDW, Coach: ..., City: ...
```

---

### Step 3: Test Scan Function
- [ ] Click **"Scan for Duplicates"** button
- [ ] Wait for scan to complete
- [ ] Check browser console for logs showing what was found
- [ ] Look for duplicate groups in the UI

**Browser Console Should Show**:
```
[ClubMergeTab] Scanning for duplicates...
[ClubMergeTab] Response: { ... }
[ClubMergeTab] Found duplicate groups: [...]
```

**UI Should Show**: Duplicate groups in a table below the buttons

---

## What Each Button Tells You

### "View All Clubs" Results
| Result | Interpretation |
|--------|-----------------|
| Shows 59 clubs | ✅ Firestore has your duplicates |
| Shows 57 clubs | ℹ️ Duplicates may have been merged |
| Shows different number | ⚠️ Check Firestore manually |

### "Debug" Results
| Result | Interpretation |
|--------|-----------------|
| Found duplicate name groups > 0 | ✅ Duplicates detected |
| Found duplicate name groups = 0 | ℹ️ No duplicates by exact name |
| Error | ❌ Check server logs |

### "Scan for Duplicates" Results
| Result | Interpretation |
|--------|-----------------|
| Shows duplicate groups in UI | ✅ Everything working! |
| No groups shown but Debug found them | ⚠️ UI parsing issue |
| No groups shown and Debug empty | ℹ️ Duplicates already merged |

---

## Browser Console Commands

If buttons don't work, try these direct commands in browser console:

```javascript
// See all clubs
fetch('/api/admin/clubs-list', { cache: 'no-store' })
  .then(r => r.json())
  .then(d => { 
    console.log('Total clubs:', d.total_clubs);
    console.log('Duplicate groups:', d.duplicate_name_groups);
    console.log('Details:', d);
  })

// See debug info
fetch('/api/admin/clubs-debug', { cache: 'no-store' })
  .then(r => r.json())
  .then(d => {
    console.log('Summary:', d.summary);
    console.log('Duplicates:', d.duplicate_names);
  })

// See scan results
fetch('/api/admin/clubs-duplicates', { cache: 'no-store' })
  .then(r => r.json())
  .then(d => {
    console.log('By name:', d.details.byName);
    console.log('By coach:', d.details.byCoach);
  })

// Run full verification script
const script = document.createElement('script');
script.src = '/verify-clubs.js';
document.head.appendChild(script);
```

---

## Common Issues & Solutions

### Issue: "No duplicates found" but you know they exist

**Possible Causes**:
1. **Duplicates were already merged** → Check Firestore directly
2. **Data synced from KV differently** → Check club IDs in Firestore
3. **Whitespace/capitalization differences** → Check exact name in Firestore

**Solution**:
- Run Debug button
- Check exact club names in console output
- Look for case differences: "Trifitzone" vs "trifitzone"
- Look for whitespace: "Trifit zone" vs "Trifit  zone"

### Issue: Button clicks do nothing

**Possible Causes**:
1. **Network error** → Check browser console for fetch errors
2. **API not deployed** → Check if endpoints exist
3. **Authentication issue** → Check if logged in as admin

**Solution**:
- Open browser console (F12)
- Try commands above manually
- Check for error messages
- Share console errors

### Issue: Scan works but UI shows nothing

**Possible Causes**:
1. **Response format mismatch** → API returns data but UI doesn't parse it
2. **React state not updating** → Check for state management issues
3. **CSS hiding elements** → Check with browser inspector

**Solution**:
- Check console logs - does "Found duplicate groups" log show?
- Check if response has `details.byName` property
- Inspect elements (right-click → Inspect) to see if they're hidden

---

## Server Logs

Check these locations in server logs for detailed information:

```
[Clubs List API] Total docs in Firestore: X
[Clubs Debug API] Found X clubs in Firestore
[Clubs Duplicates API] Found X clubs in Firestore
```

Each should show the same total. If different, indicates data inconsistency.

---

## When to Escalate

If after checking all above:
- All endpoints show duplicates exist (59 clubs)
- Debug shows duplicate groups
- But "Scan" doesn't show them in UI

Then it's a **UI component parsing issue** and needs code review of how ClubMergeTab handles the response.

## Quick Status Check

Run this single command to get a status summary:

```javascript
Promise.all([
  fetch('/api/admin/clubs-list', { cache: 'no-store' }).then(r => r.json()),
  fetch('/api/admin/clubs-debug', { cache: 'no-store' }).then(r => r.json()),
  fetch('/api/admin/clubs-duplicates', { cache: 'no-store' }).then(r => r.json())
]).then(([list, debug, dups]) => {
  console.log('=== CLUB STATUS CHECK ===');
  console.log(`List endpoint: ${list.total_clubs} clubs`);
  console.log(`Debug endpoint: ${debug.summary.total_clubs} clubs`);
  console.log(`Dups endpoint: ${dups.totalClubs} clubs`);
  console.log(`Name duplicates: ${debug.summary.duplicate_name_groups}`);
  if (list.total_clubs === 59) console.log('✅ Duplicates still in Firestore');
  else console.log('⚠️ Duplicate count lower - may have been merged');
});
```
