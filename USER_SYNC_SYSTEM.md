# User Sync & KV Cache System - Implementation Guide

## Problem Statement
Users were signing in via Google during event registration but not being created in the Firestore users collection, only existing in KV cache. This caused issues when trying to access user data later.

## Solution Overview
Implemented a comprehensive user sync system with three main components:

### 1. **User Creation from Participants** 
When users register for events but don't have a user account, automatically create one from their participant data.

### 2. **KV Cache Synchronization**
Sync all users to Cloudflare KV cache with rate limiting to prevent 429 errors and improve performance.

### 3. **ID Proof Synchronization**
Sync ID proofs from event participants to user profiles for ID reuse in future registrations.

---

## Implementation Details

### **File 1: src/lib/actions/userSyncActions.ts** (NEW - 322 lines)

Core user synchronization functions with rate limiting:

#### Functions:

1. **`syncSingleUserToKVAction(userId: string)`**
   - Syncs a single user to KV cache
   - Key: `user:{uid}:profile`
   - Returns: Success status

2. **`syncAllUsersToKVAction(options?)`** ⭐ Main Function
   - Syncs all Firestore users to KV with batching
   - Parameters:
     - `batchSize` (default 10): Process N users per batch
     - `delayMs` (default 500): Delay between batches
     - `maxUsers`: Limit total users to sync
   - Returns: Detailed sync report with error tracking
   - Features:
     - Automatic rate limit detection (429 errors)
     - Exponential backoff on throttling
     - Batch processing to prevent timeouts
     - Error aggregation and logging

3. **`getUserFromKVAction(userId: string)`**
   - Read user from KV cache
   - Useful for quick lookups

4. **`getUserWithKVFallbackAction(userId: string)`** ⭐ Important
   - Tries Firestore first, falls back to KV
   - Returns: User + source (firestore or kv)
   - Use case: Handle users in KV but not Firestore

5. **`createUserFromRegistrationAction(userData: Partial<User>)`** ⭐ Key
   - Creates new user account in Firestore
   - Auto-syncs to KV immediately
   - Validates email and UID required
   - Sets default role: 'athlete'

6. **`getUserSyncStatusAction()`**
   - Returns: Total users in Firestore, KV sync count, sync percentage
   - Useful for monitoring sync health

---

### **File 2: src/lib/actions/idSyncActions.ts** (ENHANCED)

Added new function to idSyncActions:

#### New Function:

**`syncUsersFromParticipantsAction()`** ⭐ Critical
- Creates user accounts for all participants without accounts
- Scans all event participants across all events
- Matches by UID first, then email
- Skips if user already exists
- Copies ID proof if available from participant
- Returns: Detailed report with creation count

**Usage flow:**
```
Participants in event records
  ↓ (no matching user in Firestore)
Create user from participant data
  ↓
Copy ID proof URL if available
  ↓
User now available in Firestore and ready for future registrations
```

---

### **File 3: src/components/admin/DataSyncUserTab.tsx** (NEW - 460 lines)

Admin UI for managing user synchronization with three tabs:

#### Tab 1: **Sync All Users to KV**
- Real-time status dashboard (Firestore users, KV synced, %)
- Rate limiting controls:
  - Batch size (default 10)
  - Delay between batches in ms (default 500)
  - Max users to process (optional)
- Progress bar showing sync percentage
- Detailed results with error tracking
- Copy results to clipboard

#### Tab 2: **Create Missing User Accounts**
- Scans all event participants
- Creates accounts for those registered but without user document
- Shows: Created, Skipped, Errors
- One-click operation with confirmation

#### Tab 3: **Sync Participant ID Proofs**
- Copies ID proof URLs from participant records to user profiles
- Only updates users without existing IDs
- Shows: Synced, Skipped, Errors
- One-click operation with confirmation

#### Features:
- Tabbed interface for organization
- Loading states and spinners
- Confirmation dialogs for destructive operations
- Detailed results with JSON export
- Alert messages for rate limiting info
- Copy results button for debugging

---

### **File 4: src/components/admin/DataSyncTab.tsx** (MODIFIED)

- Added import for `DataSyncUserTab`
- Integrated `DataSyncUserTab` component at the bottom
- Flows naturally with existing data sync options

---

## Data Flow Diagram

```
User Registration Flow:
┌─────────────────────────┐
│ User signs in via Google│
│ during event registration
└──────────┬──────────────┘
           │
           ↓
┌─────────────────────────────────┐
│ Check if user exists in Firestore
│ (might only exist in KV)
└──────────┬──────────────────────┘
           │
    ┌──────┴──────┐
    │             │
   YES            NO
    │             │
    ↓             ↓
┌────────┐   ┌──────────────────┐
│ Proceed│   │ Use getUserWithKV │
│ normally   │ FallbackAction    │
└────────┘   │ (reads from KV)   │
             └────────┬─────────┘
                      │
                      ↓
            ┌──────────────────┐
            │ If still missing: │
            │ createUserFromReg │
            │ istrationAction   │
            └────────┬─────────┘
                     │
                     ↓
            ┌──────────────────┐
            │ User created and  │
            │ synced to KV      │
            └──────────────────┘
```

---

## Key Features

### ✅ Rate Limiting
- Default: Batch size 10, delay 500ms
- Automatic detection of 429 errors
- Exponential backoff (2x delay)
- Prevents overwhelming Cloudflare API

### ✅ Fallback System
- `getUserWithKVFallbackAction` handles:
  - Users in Firestore (primary source)
  - Users only in KV cache (fallback)
  - Creates user on-demand if needed

### ✅ Backward Compatibility
- Works with existing user structures
- Doesn't break existing auth flows
- Gracefully handles missing users

### ✅ Monitoring
- Sync status dashboard
- Error tracking and reporting
- Detailed logs with timestamps
- Copy-paste friendly JSON export

---

## Usage Examples

### 1. Sync All Users to KV (Admin)
```
Go to: Admin Dashboard → Data Sync → Sync All Users to KV
- Click "Check Status" to see current sync %
- Adjust batch size/delay if needed
- Click "Sync All Users to KV"
- Monitor progress and errors
```

### 2. Create Missing User Accounts
```
Go to: Admin Dashboard → Data Sync → Create Missing Users
- Reviews all event participants
- Creates accounts for registered-but-missing users
- Auto-copies ID proofs if available
- Shows final count of created/skipped/errors
```

### 3. Sync Participant IDs
```
Go to: Admin Dashboard → Data Sync → Sync Participant IDs
- Copies ID proof URLs from participants to user profiles
- Enables ID reuse in future registrations
- Only updates users without existing IDs
```

### 4. In Application Code
```typescript
// Get user with KV fallback
const result = await getUserWithKVFallbackAction(userId);
if (result.success) {
  const user = result.user; // From Firestore or KV
  const source = result.source; // 'firestore' or 'kv'
}

// Create user from registration
const created = await createUserFromRegistrationAction({
  uid: googleUser.uid,
  email: googleUser.email,
  name: googleUser.displayName,
  mobile: participantMobile,
});
```

---

## Configuration

### Recommended Rate Limiting Settings

**Default (Safe)**
```
Batch Size: 10
Delay: 500ms
Expected time for 1000 users: ~50 seconds
```

**Fast (Risk of 429)**
```
Batch Size: 20
Delay: 250ms
Expected time for 1000 users: ~12 seconds
⚠️ Monitor for rate limit errors
```

**Conservative (Very Safe)**
```
Batch Size: 5
Delay: 1000ms
Expected time for 1000 users: ~200 seconds
✅ Safest option, no errors expected
```

---

## Database Schema Updates

### User Document (KV Key: `user:{uid}:profile`)
```json
{
  "id": "string",
  "uid": "string",
  "email": "string",
  "name": "string",
  "mobile": "string | null",
  "clubId": "string | null",
  "idProofUrl": "string | null",
  "createdAt": "ISO date",
  "updatedAt": "ISO date",
  "role": "athlete | club | volunteer | admin",
  "isAdmin": boolean,
  "isVolunteer": boolean
}
```

---

## Error Handling

All functions include comprehensive error handling:
- Try-catch blocks with detailed error messages
- Graceful degradation (don't fail on single record errors)
- Batch-level error tracking
- Rate limit detection and retry logic
- Error aggregation in results

---

## Testing Checklist

- [ ] Check status shows correct user counts
- [ ] Sync KV with small batch (5 users) - verify all synced
- [ ] Test rate limiting with large batch - should handle gracefully
- [ ] Create missing users - verify accounts created in Firestore
- [ ] Sync IDs - verify ID proofs copied to user profiles
- [ ] Read synced user via KV - verify data matches Firestore
- [ ] Test fallback with user in KV but not Firestore
- [ ] Copy results - verify valid JSON in clipboard

---

## Monitoring & Maintenance

### Regular Tasks
1. **Weekly**: Check sync status from admin dashboard
2. **Monthly**: Run full user sync to KV (off-peak hours)
3. **After major registration events**: Create missing users

### Red Flags
- Sync % below 90% - indicates KV cache falling behind
- High error count during sync - check Cloudflare status
- 429 errors appearing - reduce batch size or increase delay
- Users in KV but not Firestore - indicates async issue

---

## Files Modified/Created

### New Files
- ✅ `src/lib/actions/userSyncActions.ts` (322 lines)
- ✅ `src/components/admin/DataSyncUserTab.tsx` (460 lines)

### Modified Files
- ✅ `src/lib/actions/idSyncActions.ts` - Added `syncUsersFromParticipantsAction`
- ✅ `src/components/admin/DataSyncTab.tsx` - Integrated DataSyncUserTab

### Validation Status
- ✅ TypeScript: 0 errors
- ✅ ESLint: 0 warnings
- ✅ Build: Successful

---

## Future Enhancements

1. **Scheduled Syncs**: Automatic daily/hourly user sync to KV
2. **Analytics**: Track sync performance over time
3. **Alerts**: Notify on sync failures or low sync %
4. **Bidirectional Sync**: Update Firestore from KV for emergency recovery
5. **Batch Operations**: Bulk edit users in admin dashboard
6. **User Migration**: Move users between clubs/tiers via batch operations
