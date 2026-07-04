# 🚀 Live Tracking Integration Guide
**March 27, 2026**

---

## 📡 How to Use Live Tracking

### For Frontend Developers (Map Component)

#### 1. Fetch Live Positions Every 5 Seconds
```typescript
// src/components/LiveMap.tsx
import { useEffect, useState } from 'react';

export default function LiveMap({ eventId }: { eventId: string }) {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPositions = async () => {
      try {
        const res = await fetch(
          `https://api.bergmantri.com/live/positions?eventId=${eventId}`
        );
        const data = await res.json();
        setPositions(data.positions || []);
      } catch (err) {
        console.error('Failed to fetch positions:', err);
      }
    };

    fetchPositions();
    const interval = setInterval(fetchPositions, 5000); // 5-second poll

    return () => clearInterval(interval);
  }, [eventId]);

  return (
    <div>
      <h2>Live Athletes: {positions.length}</h2>
      {/* Render map with positions */}
    </div>
  );
}
```

#### 2. Show Real-Time Leaderboard
```typescript
// src/components/LiveLeaderboard.tsx
export default function LiveLeaderboard({ eventId }: { eventId: string }) {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      const res = await fetch(
        `https://api.bergmantri.com/live/leaderboard?eventId=${eventId}`
      );
      const data = await res.json();
      setLeaderboard(data.leaderboard || []);
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 10000); // 10-second poll

    return () => clearInterval(interval);
  }, [eventId]);

  return (
    <table>
      <thead>
        <tr>
          <th>Position</th>
          <th>Bib</th>
          <th>Distance</th>
          <th>Checkpoint</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {leaderboard.map((entry, idx) => (
          <tr key={entry.bibNumber}>
            <td>{idx + 1}</td>
            <td>{entry.bibNumber}</td>
            <td>{entry.distance.toFixed(2)} km</td>
            <td>{entry.checkpoint}</td>
            <td>{new Date(entry.timestamp).toLocaleTimeString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

---

### For Timing Company Integration

#### 1. Setup Webhook
Configure your timing system to POST to:
```
https://api.bergmantri.com/timing/ingest
Content-Type: application/json

{
  "eventId": "{EVENT_ID}",
  "bibNumber": "{BIB}",
  "timestamp": "{ISO_TIMESTAMP}",
  "lat": {LAT},
  "lng": {LNG},
  "speed": {SPEED_KMH},
  "distance": {DISTANCE_KM},
  "checkpoint": "{CHECKPOINT_NAME}"
}
```

#### 2. Example Payload
```json
{
  "eventId": "bergman-spring-2026",
  "bibNumber": "101",
  "timestamp": "2026-04-15T06:45:23Z",
  "lat": 18.5204,
  "lng": 73.8567,
  "speed": 28.5,
  "distance": 12.5,
  "checkpoint": "bike_20km"
}
```

#### 3. Checkpoint Examples
```
SWIM_START
SWIM_FINISH (750m mark)
TRANSITION_1
BIKE_10KM
BIKE_20KM
BIKE_30KM
BIKE_40KM
TRANSITION_2
RUN_5KM
RUN_10KM
FINISH
```

---

### For Admin Dashboard

The admin can view live sync feed in the dashboard:

```
Admin Dashboard → Live Sync Feed Tab
  ├─ Real-time events from Firestore
  ├─ Filter by type (participant, event, user, registration)
  ├─ See sync status (success/error)
  └─ Monitor KV cache updates
```

---

## 🔄 Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    EVENT DAY (LIVE TRACKING)                    │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  Timing Company  │
│  (GPS/Beacon)    │
└────────┬─────────┘
         │
         │ POST /timing/ingest
         ▼
    ┌─────────────────────────────────────┐
    │  Cloudflare Worker                  │
    │  - Store athlete position           │
    │  - Update leaderboard (sorted)      │
    │  - KV write: <10ms                  │
    └────────┬────────────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌──────────────┐  ┌──────────────┐
│ KV Position  │  │ KV Leaderboard
│ (lat/lng)    │  │ (sorted)
└──────┬───────┘  └───────┬──────┘
       │                  │
       │ (poll every 5s) │ (poll every 10s)
       │                  │
       ▼                  ▼
┌─────────────────────────────────────┐
│  Frontend                           │
│  ├─ Live Map (GoogleMaps)          │
│  ├─ Leaderboard (live update)      │
│  └─ Athlete Details                │
└─────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│              REGISTRATION (KV SYNC - BACKGROUND)                │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐
│  Firestore   │
│  (participant
│   created)   │
└────────┬─────┘
         │
    Trigger
    onDocumentWritten
         │
         ▼
    ┌─────────────────────┐
    │  Firebase Function  │
    │  syncToKV.ts        │
    │  (Cloud Run)        │
    └──────────┬──────────┘
               │
               │ POST /sync/webhook
               │ (x-api-key header)
               │
               ▼
    ┌──────────────────────────────────────┐
    │  Cloudflare Worker                   │
    │  - /sync/webhook                     │
    │  - Update athlete index              │
    │  - Store in KV                       │
    └──────────┬───────────────────────────┘
               │
               ▼
    ┌──────────────────────────────────────┐
    │  KV                                  │
    │  ├─ athlete:email:{email}           │
    │  ├─ athlete:uid:{uid}               │
    │  └─ event:{eventId}:participant:{}  │
    └──────────────────────────────────────┘
               │
               │ (for API queries)
               │
               ▼
    ┌──────────────────────────────────────┐
    │  Frontend                            │
    │  GET /athlete/upcoming               │
    │  GET /athlete/all                    │
    │  (instant, <50ms)                    │
    └──────────────────────────────────────┘
```

---

## 🎯 Use Cases

### 1. Live Event Map
```typescript
// Show all athletes on map in real-time
const positions = await fetch('/live/positions?eventId=bergman-spring');
// Update every 5 seconds
```

### 2. Top 10 Leaderboard
```typescript
// Show current leaders
const leaderboard = await fetch('/live/leaderboard?eventId=bergman-spring');
// Update every 10 seconds
```

### 3. Individual Athlete Tracking
```typescript
// Share tracking link during race
// https://app.bergmantri.com/live/athlete?bibNumber=101&eventId=bergman-spring
```

### 4. Broadcasting to Spectators
```typescript
// Website shows live race progress
// /live/positions → GoogleMaps with athlete markers
// /live/leaderboard → Real-time results
```

---

## ⚡ Performance Tips

### Frontend
- **Poll interval:** 5-10 seconds (not faster)
- **Cache positions:** Store locally, only update changed athletes
- **Lazy load map:** Load map component only on race day

### Timing Company
- **Batch updates:** Send updates every 5-10 seconds (not per second)
- **Include all fields:** bibNumber, eventId, distance, checkpoint
- **Use timestamps:** Server timestamp (UTC)

### Leaderboard
- **Sorting:** Worker sorts by distance DESC (closest to finish = top)
- **Max size:** Keep recent 1000 entries per event
- **Cleanup:** Auto-expire entries after race ends

---

## 🧪 Testing

### Test Timing Ingest
```bash
# Post a single athlete position
curl -X POST https://api.bergmantri.com/timing/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "test-event",
    "bibNumber": "101",
    "timestamp": "'$(date -u +'%Y-%m-%dT%H:%M:%SZ')'",
    "lat": 18.5204,
    "lng": 73.8567,
    "speed": 25,
    "distance": 10.5,
    "checkpoint": "bike_10km"
  }'

# Check leaderboard
curl https://api.bergmantri.com/live/leaderboard?eventId=test-event

# Check positions
curl https://api.bergmantri.com/live/positions?eventId=test-event
```

### Test Sync
```bash
# Sync a participant
curl -X POST https://api.bergmantri.com/sync/webhook \
  -H "x-api-key: your-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "participant",
    "data": {
      "eventId": "test-event",
      "bookingId": "BRG001",
      "email": "user@example.com",
      "name": "Test User",
      "bibNumber": "101"
    }
  }'

# Verify athlete index
curl https://api.bergmantri.com/athlete/upcoming?email=user@example.com
```

---

## 📋 Checklist

- [ ] Worker deployed to Cloudflare
- [ ] Environment variables set (SYNC_SECRET)
- [ ] Firebase Functions deployed
- [ ] Timing company connected to /timing/ingest
- [ ] Frontend map component fetches /live/positions
- [ ] Frontend leaderboard component fetches /live/leaderboard
- [ ] Admin can see live sync feed
- [ ] Test with mock data
- [ ] Performance acceptable (<100ms response)

---

**Next Steps:**
1. Deploy worker.js to Cloudflare
2. Update timing company endpoint
3. Create map component with live positions
4. Create leaderboard component
5. Run test race with live tracking
