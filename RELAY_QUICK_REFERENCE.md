# Relay System Quick Reference

## Quick Start

### For Users: Register a Relay Team

1. Go to event registration page
2. Select **Relay Team (3 Athletes)**
3. Choose your ticket type
4. Fill Team Details:
   - Team Name: "Bergman Warriors"
5. Add 3 Participants:
   - Participant 1: Swimmer (🏊)
   - Participant 2: Cyclist (🚴)
   - Participant 3: Runner (🏃)
6. Prefill option: Click "Pre-fill from my profile" for first participant
7. Copy option: Use "Copy from Swim" to reuse details across all participants
8. Agree to Rules & Waiver
9. Proceed to Payment

### For Admins: Manage Relay Teams

1. Go to Admin Dashboard → Relay Teams
2. Filter by event
3. View all teams registered
4. Click **Edit** to change a participant:
   - Replace with another athlete
   - Update contact info
   - Bib stays the same
5. Send confirmation emails if updated

### For Timing: Record Athlete Results

**Detect relay athletes by bib format**:
- `R101-S` → Swimmer, team R101
- `R101-B` → Cyclist, team R101  
- `R101-R` → Runner, team R101

```typescript
import { parseRelayBib } from '@/lib/utils/relayTimingUtils';

const info = parseRelayBib('R101-S');
if (info.isRelay) {
  // Process as relay: info.teamBib = 'R101', info.role = 'swim'
}
```

---

## Key Functions

### Actions (Server)

**Registration**:
```typescript
createRelayTeamRegistrationAction(formData, email, userId, userName)
generateRelayBibsAction(eventId)
getRelayTeamRegistrationAction(relayTeamId)
getRelayTeamsForEventAction(eventId)
updateRelayTeamParticipantAction(relayTeamId, role, participant)
```

**Timing**:
```typescript
processRelayAthleteResultAction(eventId, athleteBib, name, legTime, timestamp)
getRelayTeamByBibAction(eventId, teamBib)
getRelayTeamProgressAction(eventId, teamBib)
getRelayTeamResultsAction(eventId)
```

### Utilities

```typescript
parseRelayBib(bib)              // "R101-S" → { isRelay, teamBib, role }
isRelayBib(bib)                 // true/false
getRoleLabel(role)              // "swim" → "🏊 Swim"
roleToSegment(role)             // "swim" → "SWIM"
calculateRelayTeamTime(legTimes) // { swim, bike, run } → total seconds
getRelayTeamBibs(teamBib)       // "R101" → { swim, bike, run }
```

### Components

```typescript
<RelayRegistrationForm />        // Multi-step form for team registration
<RelayLeaderboardView teams={} />// Display relay results with splits
<RelayAdminPanel eventId="" />   // Admin team management interface
```

---

## Data Model

### RelayTeamRegistration
```typescript
{
  id: string
  eventId: string
  teamName: string
  teamBib: string                    // "R101"
  participants: [swim, bike, run]    // Exactly 3
  status: 'pending' | 'Completed' | 'DNF' | 'DNS'
  totalTime?: number                 // seconds
  completedAt?: string
  createdAt: string
  updatedAt: string
}
```

### RelayTeamParticipant
```typescript
{
  role: 'swim' | 'bike' | 'run'
  name: string
  email: string
  mobile?: string
  dob?: string
  gender?: 'Male' | 'Female' | 'Other'
  bloodGroup?: string
  tshirtSize?: string
  bib?: string                       // "R101-S"
  finishTime?: number                // seconds
  status?: 'Finished' | 'DNF' | 'DNS'
}
```

---

## Bib Format Reference

### Generation Pattern
- Team 1: `R101` (swimmer: `R101-S`, cyclist: `R101-B`, runner: `R101-R`)
- Team 2: `R102` (swimmer: `R102-S`, cyclist: `R102-B`, runner: `R102-R`)
- Team N: `R10N` (swimmer: `R10N-S`, cyclist: `R10N-B`, runner: `R10N-R`)

### Detection
```
Bib: "R101-S"
├─ Is Relay? YES
├─ Team Bib: "R101"
└─ Role: "swim" (S = swimmer, B = bike, R = run)
```

---

## Time Calculation

### Individual Leg Times
- Swim leg: 1800 seconds (30 min)
- T1 (transition): 120 seconds (2 min)
- Bike leg: 4200 seconds (70 min)
- T2 (transition): 60 seconds (1 min)
- Run leg: 2100 seconds (35 min)

### Team Total
```
Total = Swim + Bike + Run
      = 1800 + 4200 + 2100
      = 8100 seconds
      = 2h 15m 0s
```

---

## Firestore Collections

### Collection: `relayTeamRegistrations`
```
relayTeamRegistrations/
├── relay-001/
│   ├── teamName: "Bergman Warriors"
│   ├── teamBib: "R101"
│   ├── participants: [...]
│   ├── totalTime: 8100
│   └── status: "Completed"
├── relay-002/
│   └── ...
```

### Indexes Required
- `eventId` + `teamBib` (unique per event)
- `eventId` + `status` + `totalTime` (for leaderboard sorting)
- `eventId` + `createdAt` (for admin panel)

---

## Testing with Curl

### Create Relay Team
```bash
curl -X POST http://localhost:3000/api/relay/create-team \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "event-001",
    "ticketId": "ticket-001",
    "teamName": "Test Team",
    "participants": [
      {
        "role": "swim",
        "name": "Swimmer",
        "email": "swim@test.com"
      },
      ...
    ]
  }'
```

### Process Relay Timing
```bash
curl -X POST http://localhost:3000/api/timing/relay-finish \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "event-001",
    "athleteBib": "R101-S",
    "athleteName": "Vaibhav",
    "legTime": 1800,
    "timestamp": "2026-03-24T07:30:00Z"
  }'
```

---

## Common Errors & Solutions

### Error: "Invalid relay bib format"
**Cause**: Bib doesn't match `R###-X` pattern
**Solution**: Ensure bib is like "R101-S" (team number + dash + role letter)

### Error: "Relay team not found"
**Cause**: Team bib doesn't exist in event
**Solution**: Check eventId and teamBib are correct, verify team was registered

### Error: "Validation failed: Email must be unique"
**Cause**: Two participants have same email
**Solution**: Each of 3 athletes must have different email

### Error: "Exactly 3 participants required"
**Cause**: Form submitted with < 3 participants
**Solution**: Fill all 3 participant sections (Swim, Bike, Run)

---

## Integration Checklist

- [ ] Updated event registration page with relay option
- [ ] RelayRegistrationForm component integrated
- [ ] Relay actions exported in `index.ts`
- [ ] Timing detection updated to handle relay bibs
- [ ] Admin panel configured for relay management
- [ ] Leaderboard updated to show relay teams
- [ ] Payment flow updated for team registration
- [ ] Invoice system updated for relay teams
- [ ] Email notifications configured for relay participants
- [ ] Firestore indexes created
- [ ] Tests written and passing
- [ ] Documentation reviewed and complete

---

## Support Resources

📖 **Full Documentation**: See `RELAY_SYSTEM_DOCUMENTATION.md`
💻 **Source Code**: 
- Types: `src/lib/types/registration.ts`
- Actions: `src/lib/actions/relay*.ts`
- Components: `src/components/relay/`
- Utilities: `src/lib/utils/relayTimingUtils.ts`

---

**Version**: 1.0
**Last Updated**: April 1, 2026
