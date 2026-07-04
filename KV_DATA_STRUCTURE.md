# KV Data Structure Reference

## Overview
Event registration data is stored in Cloudflare KV with this structure:

---

## Event Index Structure

### Key Pattern: `event:{eventId}:index`

**Type**: Array of registration summaries

**Content**:
```json
[
  {
    "bookingId": "BMIN01PLF",
    "name": "Participant Name",
    "bibNumber": "4101",
    "ticketName": "BERGMAN SWIMATHON BLR - 4 KM",
    "gender": "Male",
    "category": "31-40"
  },
  {
    "bookingId": "BMINORGVF",
    "name": "MAYUR KAMDAR",
    "bibNumber": "2406",
    "ticketName": "BERGMAN OLYMPIC TRIATHLON",
    "gender": "Male",
    "category": "41-50"
  }
  // ... more participants
]
```

**Purpose**: 
- Quick lookup of all participants in an event
- Summary data for event dashboard
- Reference for loading full participant details

---

## Participant Data Structure

### Key Pattern: `event:{eventId}:participant:{bookingId}`

**Type**: Full participant object

**Content**:
```json
{
  "id": "88oNaix4AEOHEXaHAgJf",
  "bookingId": "BMIN01PLF",
  "name": "Participant Name",
  "email": "participant@example.com",
  "mobile": "+919373781327",
  "dob": "1982-07-07",
  "gender": "Female",
  "bloodGroup": "O+",
  "tshirtSize": "40",
  "emergencyContactNumber": "9820673915",
  "address": "162, Ananda Nilayam, 13th Main",
  "city": "Bangalore",
  "state": "KA",
  "pincode": "560102",
  "country": "India",
  "eventId": "4cEm8JPYbpupoFRMDLc1",
  "eventName": "BERGMAN BENGALURU 2026",
  "eventDate": "2026-09-05",
  "ticketId": "UGO2et4uP4h5ya64NazE",
  "ticketName": "BERGMAN SWIMATHON BLR - 4 KM",
  "ticketStatus": "Active",
  "bibNumber": "4101",
  "ageCategory": "31-40",
  "registeredAt": "2026-03-12T13:13:47.249Z",
  "createdAt": "2026-03-12T13:13:47.249Z",
  "pricingBreakdown": {
    "base": 249900,
    "discount": 0,
    "eventGST": 44982,
    "platformFeeBase": 2000,
    "platformGST": 360,
    "processingFeeBase": 12495,
    "processingGST": 2249,
    "totalPayable": 312000,
    "currency": "INR",
    "gstRate": 0.18,
    "version": "v3.0.0"
  },
  "amountPaidPaisa": 312000,
  "isDeferral": false,
  "deferralId": null,
  "selectedSubCategory": null,
  "billingType": "personal",
  "businessName": "",
  "gstin": "",
  "agreedRules": true,
  "agreedWaiver": true,
  "agreedCutoff": true,
  "consentPromotions": true,
  "zohoSynced": true,
  "invoiceNumber": "INV-000453",
  "updatedAt": "2026-03-24T17:14:11.032Z"
}
```

**Purpose**:
- Complete participant information
- Used by athlete dashboard to display registration details
- Payment and billing information
- Event-specific preferences and categories

---

## User Registration Index Structure

### Key Pattern: `user:{userId}:events:index`

**Type**: Array of event registration references

**Content**:
```json
[
  {
    "eventId": "4cEm8JPYbpupoFRMDLc1",
    "bookingId": "BMIN01PLF",
    "eventName": "BERGMAN BENGALURU 2026",
    "eventDate": "2026-09-05",
    "ticketName": "BERGMAN SWIMATHON BLR - 4 KM",
    "bibNumber": "4101"
  },
  {
    "eventId": "abc123def456",
    "bookingId": "BMIN02XYZ",
    "eventName": "BERGMAN PUNE 2026",
    "eventDate": "2026-10-03",
    "ticketName": "BERGMAN SWIMATHON - 1 Km",
    "bibNumber": "3102"
  }
  // ... more registrations for this user
]
```

**Purpose**:
- Athlete dashboard - "Your Upcoming Registrations" 
- Quick lookup of user's registrations
- Event-specific details for UI display

---

## Key Naming Conventions

### Event Level
```
event:{eventId}:index                          → List of participants
event:{eventId}:participant:{bookingId}        → Full participant data
event:{eventId}:info                           → Event metadata (optional)
```

### User Level
```
user:{userId}:events:index                     → User's registrations
user:{userId}:profile                          → User profile (optional)
```

### System Level
```
system:cache:sync:metadata                     → Master sync metadata
system:cache:auto-clear:metadata               → Auto-clear history
system:ghost-cleanup:latest-report             → Cleanup reports
```

---

## Ghost Entry Detection in KV

An entry is considered "ghost" when reading from KV if:

1. **Missing from KV entirely**
   - `event:{eventId}:participant:{bookingId}` doesn't exist
   - But index entry references it

2. **Incomplete data**
   - Missing `name` field
   - Missing `email` field
   - Null or empty critical fields

3. **Corrupted data**
   - `eventDate` contains "ghost" string
   - Invalid `ticketStatus` (not in: Active, Confirmed, Deferred, Cancelled, Pending)

4. **Missing timestamps**
   - No `registeredAt` or `createdAt` field

---

## Cleanup Operations on KV

### `cleanupGhostRegistrationsAction()` Operations

**Reads**:
- `event:*:index` - All event indices
- `event:{eventId}:participant:{bookingId}` - Full participant data
- `user:{userId}:events:index` - User registration indices

**Deletes**:
- `event:{eventId}:participant:{bookingId}` - Corrupted participant entries
- Updates `event:{eventId}:index` - Removes dead references
- Updates `user:{userId}:events:index` - Removes dead references

**Example**:
```
Before cleanup:
event:4cEm8JPYbpupoFRMDLc1:index = [
  {bookingId: "BMIN01PLF", name: "Valid", ...},
  {bookingId: "GHOST123", name: "", ...}  ← Will be removed
]

After cleanup:
event:4cEm8JPYbpupoFRMDLc1:index = [
  {bookingId: "BMIN01PLF", name: "Valid", ...}
]

Deleted:
event:4cEm8JPYbpupoFRMDLc1:participant:GHOST123 ✅ Removed
```

---

## Performance Notes

- **Event Indices**: Small (~50-500 entries per event)
- **Participant Data**: Large (~10-50KB per entry)
- **User Indices**: Varies by user (~5-20 entries per user)

**Cleanup Performance**:
- Reading 25 events: ~500ms
- Checking 1,200+ participants: ~1-2 seconds
- Writing updates: ~500ms total
- Total operation: ~2-3 seconds

---

## Integration with System

### Data Flow
```
User Registration → Firestore → KV Cache → Athlete Dashboard
                                   ↓
                    cleanupGhostRegistrations reads/writes here
```

### Validation Chain
```
cleanupGhostRegistrations (removes ghost entries from KV)
                ↓
autoClearCache (removes stale KV entries)
                ↓
generateCacheHealthReport (verifies data quality)
                ↓
Athlete Dashboard (displays clean data)
```

---

## Testing & Verification

### Check event index:
```bash
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{accountId}/storage/kv/namespaces/{namespaceId}/keys?prefix=event:4cEm8JPYbpupoFRMDLc1:index"
```

### Check specific participant:
```bash
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{accountId}/storage/kv/namespaces/{namespaceId}/values/event:4cEm8JPYbpupoFRMDLc1:participant:BMIN01PLF"
```

### Check cleanup report:
```bash
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{accountId}/storage/kv/namespaces/{namespaceId}/values/system:ghost-cleanup:latest-report"
```
