# Live Data Source Configuration - Implementation Guide

**Date:** March 27, 2026  
**Status:** ✅ Complete & Integrated  
**Location:** Admin Dashboard → Live Data Source Tab

---

## 📋 Overview

The Live Data Source configuration system allows event administrators to select where live tracking data comes from during events. This enables flexibility in handling different event scenarios and data collection methods.

---

## 🎯 Features

### Data Source Options

1. **From Registrations**
   - Uses participant data from KV cache
   - Key pattern: `event:{eventId}:participant:{bookingId}`
   - Shows complete participant list from registrations
   - Best for: Pre-race setup and participant management

2. **Manual Volunteer Entry**
   - Allows volunteers to manually input tracking data
   - Useful for non-automated events
   - Best for: Small events, backup tracking method

3. **From Timing Partner**
   - Real-time RFID integration
   - Receives data from timing company's API
   - Webhook endpoint: `POST /timing/ingest`
   - Best for: Large races with professional timing systems

4. **From Final Results**
   - Static post-race results display
   - Shows completed race data
   - Best for: Results viewing after event completion

5. **Disable Tracking**
   - Turns off live tracking display
   - Hides tracking from frontend
   - Best for: Events without tracking needs

---

## 🔧 Implementation Details

### Component: `LiveDataSourceTab.tsx`

**Location:** `/src/components/admin/LiveDataSourceTab.tsx`  
**Size:** 340 lines  
**Type:** React Client Component

#### Key Features:
- Radio button style selection of data sources
- Event ID input field for registrations data source
- Participant list loading with search/filter
- Real-time statistics (Total, Success, Errors)
- Save/load configuration persistence
- Visual feedback for each data source type

#### State Management:
```typescript
- selectedEventId: string              // Event to load participants from
- dataSource: DataSource               // Selected data source
- participants: Participant[]          // Loaded participant list
- filteredParticipants: Participant[]  // Search-filtered list
- searchQuery: string                  // Search input
- savedConfig: DataSourceConfig        // Current saved configuration
```

#### Participant Object Structure:
```typescript
interface Participant {
  bookingId: string;
  name: string;
  email: string;
  bibNumber?: string;
  club?: string;
  category?: string;
}
```

---

### API Endpoint: `/api/admin/live-data-source`

**Location:** `/src/app/api/admin/live-data-source/route.ts`  
**Methods:** GET, POST  
**Type:** Next.js API Route

#### GET Requests:
```
GET /api/admin/live-data-source
→ Returns current saved configuration

GET /api/admin/live-data-source?eventId=tri2026&source=registrations
→ Fetches participants from specified event
→ Returns { participants: [], count: 0 }
```

#### POST Requests:
```
POST /api/admin/live-data-source
Body: {
  source: "registrations" | "volunteer" | "timing_partner" | "final_results" | "disabled",
  eventId: "tri2026" (required for "registrations", optional for others)
}
→ Saves configuration to Firestore
→ Returns saved configuration with lastUpdated timestamp
```

#### Storage:
- Firestore collection: `admin`
- Document: `live_data_source_config`
- Fields: `source`, `eventId`, `lastUpdated`

---

## 📡 Integration with Other Systems

### Cloudflare Worker Integration

When "From Timing Partner" is selected, the worker endpoint expects:

```
POST /timing/ingest

Body: {
  eventId: "tri2026",
  bibNumber: "101",
  timestamp: "2026-04-01T06:45:00Z",
  lat: 18.5204,
  lng: 73.8567,
  speed: 28,
  distance: 12.5,
  checkpoint: "bike_20km"
}
```

### Live Tracking Display

The frontend checks this configuration to determine:
- Whether to show live tracking
- Which data source to query for positions
- How to format the leaderboard

---

## 🔄 Data Flow

### "From Registrations" Flow

```
1. Admin selects "From Registrations"
   ↓
2. Admin enters Event ID (e.g., "tri2026")
   ↓
3. Admin clicks "Load Participants"
   ↓
4. Component fetches: GET /api/admin/live-data-source?eventId=tri2026&source=registrations
   ↓
5. API retrieves from Firestore: db.collection('events').doc('tri2026')
   ↓
6. Component displays participants list with:
   - Name
   - Email
   - Bib Number (if available)
   - Category
   - Club
   - Booking ID
   ↓
7. Admin can search/filter participants
   ↓
8. Admin clicks "Save Data Source Configuration"
   ↓
9. Configuration saved to Firestore with timestamp
```

### Configuration Save Flow

```
1. Admin selects data source
2. (Optional) Selects event for "From Registrations"
3. Clicks "Save Data Source Configuration"
4. POST /api/admin/live-data-source with source + eventId
5. API saves to Firestore: admin/live_data_source_config
6. Configuration immediately available to frontend
7. Frontend queries this to determine tracking behavior
```

---

## 💾 Firestore Structure

### Configuration Document

```
Collection: admin
Document: live_data_source_config

{
  "source": "registrations",
  "eventId": "tri2026",
  "lastUpdated": "2026-03-27T10:30:00Z"
}
```

### Event Participants (for "From Registrations")

```
Collection: events
Document: tri2026

{
  "name": "Triathlon 2026",
  "participants": [
    {
      "bookingId": "BK-001",
      "name": "John Doe",
      "email": "john@example.com",
      "bibNumber": "101",
      "clubName": "Elite Cycling",
      "category": "PRO"
    },
    ...
  ]
}
```

---

## 🎨 UI Components Used

- **Card, CardHeader, CardTitle, CardDescription, CardContent** - Layout structure
- **Badge** - Display categories, club information
- **Button** - Actions (Load, Save, Clear)
- **Input** - Event ID and search fields
- **Alert, AlertTitle, AlertDescription** - Status and information displays
- **Select, SelectTrigger, SelectValue** - Dropdown selections
- **ScrollArea** - Scrollable participants list
- **Icons from lucide-react** - Visual indicators

---

## 🔐 Security Considerations

1. **Authentication**: Requires admin authentication (inherited from dashboard)
2. **Data Sensitivity**: Configuration controls what data is visible publicly
3. **API Key**: Timing partner webhook validates with x-api-key header
4. **Firestore Rules**: Data source configuration should have admin-only write permissions

### Recommended Firestore Rules:

```
match /admin/live_data_source_config {
  allow read: if request.auth.uid != null;
  allow write: if request.auth.uid != null && 
               request.auth.token.admin == true;
}
```

---

## 🚀 Usage Workflow

### Step 1: Access Live Data Source Configuration
1. Navigate to Admin Dashboard
2. Click "Live Data Source" tab
3. View current configuration status

### Step 2: Select Data Source
Click on one of the data source cards:
- From Registrations
- Manual Entry
- Timing Partner
- Final Results
- Disable Tracking

### Step 3: Configure Source (if needed)
- **For Registrations**: Enter event ID, click "Load Participants"
- **For Timing Partner**: Coordinate with timing company
- **For Manual Entry**: Prepare volunteer interface
- **For Final Results**: Prepare post-race results
- **For Disabled**: No configuration needed

### Step 4: Save Configuration
Click "Save Data Source Configuration" to persist changes

### Step 5: Verify on Frontend
- Check that live tracking displays correct data source
- Verify data is being populated correctly
- Monitor for any errors

---

## 🔄 Participant List Features

### Search Functionality
Search by:
- Name (case-insensitive)
- Email (case-insensitive)
- Bib Number
- Booking ID

### Display Information
Each participant card shows:
- Full name
- Email address
- Bib number (if available)
- Category badge
- Club badge
- Booking ID

### Pagination
- Displays all loaded participants
- Shows count (e.g., "Showing 45 of 125 participants")
- Maintains scroll position during search

---

## 📊 Configuration Alerts

### For Each Data Source:

**From Registrations:**
- Shows: "Participant list from KV"
- Action: Load and search participants

**Manual Volunteer Entry:**
- Shows: "Volunteers will be able to manually enter data"
- Action: Prepare volunteer interface

**Timing Partner:**
- Shows: "Configure your timing partner webhook"
- Displays: Webhook endpoint details
- Action: Coordinate with timing company

**Final Results:**
- Shows: "Display final race results"
- Action: Prepare results data

**Disabled:**
- Shows: "Live tracking will be hidden"
- Action: Live tracking won't appear on frontend

---

## 🐛 Troubleshooting

### "No participants found"
- **Issue**: Event ID doesn't exist or has no participants
- **Solution**: Verify event ID matches event in system
- **Debug**: Check Firestore for events collection

### "Failed to load participants"
- **Issue**: API error or network issue
- **Solution**: Check browser console for error details
- **Debug**: Verify /api/admin/live-data-source endpoint is accessible

### Configuration not saving
- **Issue**: Possible Firestore permission issue
- **Solution**: Check that user has admin role
- **Debug**: Check browser network tab for failed requests

### Timing partner not receiving webhooks
- **Issue**: Worker endpoint configuration
- **Solution**: Verify SYNC_WEBHOOK_URL environment variable
- **Debug**: Test webhook manually with curl

---

## 🔗 Related Components

- **LiveSyncFeedTab**: Shows real-time sync events
- **LiveTrackingAdminTab**: Displays live race positions
- **LiveStreamingTab**: Video streaming control

---

## 📝 Notes for Developers

1. **Future Enhancement**: Direct KV integration instead of Firestore queries
   - Currently fetches from Firestore
   - Could be updated to query Cloudflare KV directly

2. **Scaling Consideration**: For large participant lists
   - Currently loads all participants into memory
   - Consider pagination for 1000+ athletes

3. **Real-time Updates**: Configuration changes propagate immediately
   - No cache invalidation needed
   - Frontend checks on each page load

4. **Audit Trail**: Consider logging configuration changes
   - Current implementation saves timestamp
   - Could enhance with user who made change

---

## ✅ Implementation Checklist

- [x] Component created and styled
- [x] API endpoint implemented
- [x] Firestore integration
- [x] Admin dashboard integration
- [x] Data source selection UI
- [x] Participant loading and filtering
- [x] Configuration persistence
- [x] Error handling
- [x] TypeScript validation
- [x] Icon integration
- [x] Documentation complete

---

## 🎓 Key Takeaways

1. **Single Source of Truth**: Configuration stored in one Firestore document
2. **Flexible Design**: Supports multiple data sources seamlessly
3. **User-Friendly**: Clear visual interface for each data source option
4. **Searchable**: Quick participant lookup with filtering
5. **Persistent**: Configuration saved and loaded on each visit
6. **Integrated**: Part of comprehensive admin dashboard

---

**Created:** March 27, 2026  
**Last Updated:** March 27, 2026  
**Status:** ✅ Production Ready
