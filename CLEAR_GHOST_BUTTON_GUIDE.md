# Clear Ghost Entries Button - Admin Dashboard

## Location
**Admin Dashboard** → **Data Sync Tab** → **Master Sync Section**

## Button Details

### Visual
- **Label**: Clear Ghost Entries
- **Icon**: Wand2 (magic wand icon)
- **Color**: Violet/Purple (`bg-violet-100 text-violet-700`)
- **Location**: Below "Manual Clear Cache" button in Master Sync card

### Functionality
Directly calls `cleanupGhostRegistrationsAction()` to:
1. Read from all `event:*:index` in KV
2. Fetch participant data from KV
3. Identify corrupted/ghost registrations
4. Remove ghost entries from KV
5. Update event and user indices

## Usage Workflow

### Step 1: Navigate to Admin Dashboard
- Go to Admin Dashboard
- Click "Data Sync" tab

### Step 2: Locate Master Sync Section
Look for the "Master Sync" card (bottom right of sync controls)

### Step 3: Click "Clear Ghost Entries" Button
- Button appears below "Manual Clear Cache"
- Click to start ghost cleanup

### Step 4: Monitor in Sync Log
The sync log will show:
```
[HH:MM:SS] 🧹 Starting Ghost Registration Cleanup from KV...
[HH:MM:SS] ✅ Ghost Cleanup Complete
[HH:MM:SS]    📊 Total Events Scanned: 25
[HH:MM:SS]    🗑️  Ghost Registrations Removed: 3
[HH:MM:SS]    ⏱️  Duration: 2450ms
```

## UI Layout

```
Master Sync Section
├─ Manual Clear Cache [Red Button]
│  └─ "Fixes ghost entries"
├─ Clear Ghost Entries [Violet Button] ← NEW
│  └─ "Removes corrupted registrations"
└─ Info: "Removes corrupted registrations"
```

## Toast Notifications

### Success
```
Title: "Ghost Cleanup Complete"
Message: "Removed X ghost entries from KV cache"
```

### Error
```
Title: "Cleanup Failed"
Message: [Error details]
```

## What Gets Cleaned

- **Missing KV Data**: Index references ghost entries not in KV
- **Invalid Fields**: Missing name/email
- **Corrupted Dates**: Event date containing "ghost" string
- **Invalid Status**: Ticket status not valid
- **Missing Timestamps**: No registeredAt/createdAt

## Safety Features

✅ **Safe to Run**
- Only removes corrupted/invalid entries
- Preserves all valid data
- Can run multiple times
- Non-destructive to athlete records

✅ **Rollback Capable**
- Updates stored in KV metadata
- Can review cleanup report
- User indices updated with dead links removed

## Performance

- **Duration**: ~2-3 seconds typical
- **Events Scanned**: All events
- **Participants Checked**: 1000+
- **Log Output**: Detailed progress in sync log

## Related Buttons

In same Master Sync section:
- **Manual Clear Cache** - Full global rebuild (slower, more comprehensive)
- **Clear Ghost Entries** - Ghost cleanup only (faster, focused)

## Differences from Manual Clear Cache

| Feature | Clear Ghost Entries | Manual Clear Cache |
|---------|-------------------|-------------------|
| Data Source | KV Only | Global rebuild |
| Speed | ~2-3 sec | ~10+ sec |
| Scope | Ghost entries | Everything |
| Use When | Specific ghost issues | Full reset needed |
| Frequency | Weekly (safe) | Monthly (heavier) |

## Integration Points

### Data Flow
```
Button Click
    ↓
cleanupGhostRegistrationsAction()
    ├─ Read: event:*:index
    ├─ Fetch: event:eventId:participant:*
    ├─ Check: Validity & corruption
    ├─ Delete: Ghost entries
    └─ Update: Indices
    ↓
Sync Log Output
    ↓
Toast Notification
```

### API Calls
- `cleanupGhostRegistrationsAction()` - Main cleanup function
- Logs updates to UI sync log in real-time
- Toast notification on completion

## Troubleshooting

### Button is disabled?
- Another sync is running
- Wait for current operation to complete
- Check sync log for status

### No entries removed?
- No ghost entries found (good!)
- Run again to verify
- Check sync log for details

### Ghost entries still appear after cleanup?
- Run "Manual Clear Cache" instead
- Check if new ghosts are being created
- Review cleanup report for details

## Code Components

### Button Component
```tsx
<Button 
  variant="secondary" 
  size="sm" 
  onClick={handleCleanupGhosts} 
  disabled={isFullRebuilding} 
  className="w-full font-black text-[9px] uppercase tracking-widest h-9"
>
  <Wand2 className="mr-1.5 h-3 w-3"/>
  Clear Ghost Entries
</Button>
```

### Handler Function
```tsx
const handleCleanupGhosts = async () => {
  addLog("🧹 Starting Ghost Registration Cleanup from KV...");
  const res = await cleanupGhostRegistrationsAction();
  // Process results and show notifications
};
```

## Admin Checklist

- [ ] Navigate to Admin Dashboard Data Sync tab
- [ ] Find Master Sync section
- [ ] Click "Clear Ghost Entries" button
- [ ] Monitor sync log for completion
- [ ] Verify toast notification shows success
- [ ] Check athlete dashboard - no ghost entries?
- [ ] Note duration and entries removed in logs
