# Finish Line LED Display - Process Documentation

## Overview
The Finish Line LED Display is a real-time display system that shows live finisher updates on LED screens at race events.

## System Architecture

### 1. Data Flow
```
Race Event (liveAthletes) 
    ↓
Cloud Function (pushFinishLineEntry) 
    ↓
Firestore (finish_line_feed/{eventId}/entries) 
    ↓
LED Display HTML Page (finish_line_led.html) 
    ↓
Real-time Firestore Listener
    ↓
LED Screen Display
```

### 2. Components

#### Cloud Function: pushFinishLineEntry
- **Location**: `src/functions/src/pushFinishLineEntry.ts`
- **Trigger**: When athlete status changes to "Finished" in `events/{eventId}/liveAthletes/{bib}`
- **Process**:
  1. Detects when an athlete's status changes to "Finished"
  2. Fetches athlete data from liveAthletes collection
  3. Looks up additional data (country, club) from users collection
  4. Creates finisher entry with:
     - BIB number
     - Athlete name
     - Finish time (formatted as HH:MM:SS)
     - Ticket name (category)
     - Age group
     - Country
     - Club name
     - Gender
     - Timestamp
  5. Writes entry to `finish_line_feed/{eventId}/entries`
  6. Maintains max 6 finishers in feed (auto-deletes oldest)

#### LED Display Page
- **Location**: `public/finish_line_led.html`
- **Type**: Client-side HTML/JavaScript
- **Features**:
  - Real-time updates via Firestore `onSnapshot` listener
  - Responsive design for different LED screen sizes
  - Demo mode for testing
  - Sponsor banner support

#### Admin Configuration
- **Location**: `src/components/admin/FinishLedTab.tsx`
- **Purpose**: Generate shareable links for LED displays
- **Parameters**:
  - `eventId`: Event to display
  - `w`: Width in pixels (default: 8 feet = 28,800 pixels)
  - `h`: Height in pixels (default: 2 feet = 7,200 pixels)
  - `demo`: Enable demo mode for testing

## Data Sources

### Current Implementation: Firestore Only
✅ **Pros**:
- Real-time updates
- No delay
- Automatic sync
- Works offline with Firestore SDK

❌ **Cons**:
- No fallback if Firestore is down
- Direct dependency on Firestore

### Recommended: Add KV Cache Layer
To make this more resilient, we should:

1. **Cache recent finishers in KV**:
   ```typescript
   // After writing to Firestore
   await putKV(`finish_line_feed:${eventId}:latest`, finisher, actionName);
   ```

2. **Update LED HTML to read from KV if Firestore fails**:
   ```javascript
   // Fallback to KV if Firestore unavailable
   const kvResponse = await fetch(`/api/kv-get?key=finish_line_feed:${eventId}:latest`);
   const fallbackData = await kvResponse.json();
   ```

## Current Status

✅ **Working**:
- Cloud Function triggers correctly on athlete finish
- Firestore real-time updates work
- LED display shows finishers in real-time
- Demo mode functional
- Admin link generation working

⚠️ **Improvements Needed**:
1. **Add KV fallback cache** for resilience
2. **Add error handling** if Firestore connection drops
3. **Cache finisher list in KV** for instant load
4. **Add retry logic** for failed Firestore queries

## Integration with KV

### Recommended Changes

1. **Update Cloud Function**:
   ```typescript
   // Add to pushFinishLineEntry.ts after Firestore write
   const kvService = require('./kv-service'); // Create this
   await kvService.cacheFinsher(eventId, newEntry);
   ```

2. **Create KV Service**:
   ```typescript
   // functions/src/kv-service.ts
   export async function cacheFinisher(eventId, finisher) {
     const key = `finish_line_feed:${eventId}:latest`;
     const kvUrl = process.env.KV_URL;
     const kvToken = process.env.KV_TOKEN;
     
     await fetch(`${kvUrl}/finish_line_feed`, {
       method: 'PUT',
       headers: { 'Authorization': `Bearer ${kvToken}` },
       body: JSON.stringify({ [key]: finisher })
     });
   }
   ```

3. **Update LED HTML**:
   ```javascript
   // Add KV fallback to finish_line_led.html
   async function getLatestFinisher(eventId) {
     try {
       // Try Firestore first (real-time)
       return await firestoreQuery();
     } catch (e) {
       // Fallback to KV (cached)
       const res = await fetch(`/api/kv/finish_line_feed:${eventId}:latest`);
       return await res.json();
     }
   }
   ```

## Testing

### Demo Mode
- URL: `http://localhost:3000/finish_line_led.html?demo=true`
- Shows mock finisher data
- No Firebase required

### Live Mode
- URL: `http://localhost:3000/finish_line_led.html?eventId=EVENTID`
- Reads from Firestore
- Real-time updates

## Recommendations

| Priority | Item | Impact |
|----------|------|--------|
| 🔴 High | Add KV cache fallback | Prevents LED blackout if Firestore down |
| 🔴 High | Add retry logic | Improves reliability |
| 🟡 Medium | Cache finisher list | Faster initial page load |
| 🟡 Medium | Add error messages | Better debugging |
| 🟢 Low | Add performance metrics | Monitor real-time latency |

## Summary

✅ **Current System**: Fully functional, Firestore-based real-time display
⚠️ **Improvement**: Add KV cache layer for resilience
🎯 **Status**: Ready for production with recommended enhancements
