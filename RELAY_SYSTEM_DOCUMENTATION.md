# Relay Team System Implementation Guide

## Overview

The Bergman relay team system allows teams of 3 athletes (Swimmer, Cyclist, Runner) to register as a single unit for events. Each athlete maintains individual timing, bibs, and results, while the team's total result is the combined time of all three legs.

## Key Features

✅ **Three-Athlete Teams**: Exactly 3 athletes per team (Swim, Bike, Run)
✅ **Individual Timing**: Each athlete has unique bib and timing chip
✅ **Team Results**: Combined leaderboard showing team names and splits
✅ **Admin Management**: Replace participants, manage team assignments
✅ **Smart Bibs**: Automatic relay bib generation (R101, R102, etc.)
✅ **Payment Integration**: Single payment for entire team
✅ **Invoicing**: Team-based invoices with all 3 athlete details
✅ **Communications**: Automated emails to all 3 participants

---

## Data Structure

### Firestore Collections

#### `relayTeamRegistrations/{relayTeamId}`
```json
{
  "teamName": "Bergman Warriors",
  "teamBib": "R101",
  "eventId": "event-2026-01",
  "eventName": "Bergman Triathlon 2026",
  "ticketId": "ticket-001",
  "ticketName": "Advanced",
  
  "participants": [
    {
      "role": "swim",
      "name": "Vaibhav",
      "email": "vaibhav@example.com",
      "mobile": "8390288857",
      "dob": "1992-01-30",
      "gender": "Male",
      "bib": "R101-S",
      "finishTime": 1800,  // seconds
      "finishTimestamp": "2026-03-24T07:30:00Z",
      "status": "Finished"
    },
    {
      "role": "bike",
      "name": "Cyclist Name",
      "email": "bike@example.com",
      "bib": "R101-B",
      "finishTime": 4200,
      "status": "Finished"
    },
    {
      "role": "run",
      "name": "Runner Name",
      "email": "run@example.com",
      "bib": "R101-R",
      "finishTime": 2100,
      "status": "Finished"
    }
  ],
  
  "createdByUid": "user-123",
  "createdByName": "Vaibhav",
  "createdByEmail": "vaibhav@example.com",
  "clubId": "club-001",
  
  "amountPaidPaisa": 300000,  // 3000 INR for team
  "transactionId": "txn-abc123",
  "razorpayOrderId": "order-xyz789",
  
  "status": "Completed",  // pending | PaymentInitiated | Completed | DNF | DNS
  "totalTime": 8100,      // sum of all legs in seconds
  "completedAt": "2026-03-24T07:32:00Z",
  
  "createdAt": "2026-01-15T10:00:00Z",
  "updatedAt": "2026-03-24T07:32:00Z"
}
```

---

## Registration Flow

### 1. Frontend: Ticket Type Selection
```
Event Page
├── Select Ticket Type
│   ├── Individual ← traditional single athlete
│   └── Relay Team ← NEW 3-athlete option
└── Proceed based on type
```

### 2. Frontend: Team Details Entry
```
Relay Registration Form (Step 1)
├── Team Name: "Bergman Warriors"
└── [Next]
```

### 3. Frontend: Participant Entry
```
Relay Registration Form (Step 2)
├── Participant 1: Swim
│   ├── Name, Email, Mobile
│   ├── DOB, Gender, Blood Group
│   └── T-Shirt Size, Emergency Contact
├── Participant 2: Bike
│   └── [Same fields]
│   └── [Copy from Swim button]
├── Participant 3: Run
│   └── [Same fields]
│   └── [Copy from Swim button]
└── Agreements
    ├── ☐ Agree to Rules
    ├── ☐ Agree to Waiver
    └── ☐ Consent to Promotions
```

### 4. Backend: Create Relay Team Registration
```
createRelayTeamRegistrationAction(formData)
├── Validate 3 participants, unique emails
├── Generate team bib: R101 (auto-increment)
├── Generate participant bibs:
│   ├── R101-S (Swimmer)
│   ├── R101-B (Cyclist)
│   └── R101-R (Runner)
├── Save to relayTeamRegistrations collection
└── Return teamBib & relayTeamId
```

### 5. Payment
```
Checkout
├── Team Name: Bergman Warriors
├── Price: ₹3000 (for 3 athletes)
├── Participants: 3 listed
└── [Pay Now]
```

### 6. Invoice Generation
```
Invoice
├── Team: Bergman Warriors
├── Participants:
│   ├── 1. Vaibhav – Swim
│   ├── 2. XYZ – Bike
│   └── 3. ABC – Run
├── Amount: ₹3000
└── [Generated + sent to all 3 emails]
```

---

## BIB Generation & Timing Detection

### Bib Format

**Team Bib**: `R###` (e.g., R101, R102)
- Unique per relay team per event
- Auto-increment starting from R101

**Individual Bibs**: `R###-X` (e.g., R101-S)
- `R101-S` → Swimmer (Swim leg)
- `R101-B` → Cyclist (Bike leg)
- `R101-R` → Runner (Run leg)

### Backend Timing Detection

**In your timing API (e.g., `/api/timing/finish-line`):**

```typescript
import { parseRelayBib } from '@/lib/utils/relayTimingUtils';

const bibInfo = parseRelayBib(bib); // "R101-S"

if (bibInfo.isRelay) {
  // It's a relay athlete
  const { teamBib, role } = bibInfo;
  
  // Route to relay timing
  await processRelayAthleteResultAction(
    eventId,
    bib,           // "R101-S"
    athleteName,
    legTime,       // seconds
    timestamp
  );
} else {
  // Individual athlete, use existing logic
  await processIndividualResult(...);
}
```

---

## Timing System Updates

### Process Relay Athlete Timing

**Action**: `processRelayAthleteResultAction()`

```typescript
processRelayAthleteResultAction(
  eventId: 'event-2026-01',
  athleteBib: 'R101-S',  // Swimmer finished
  athleteName: 'Vaibhav',
  legTime: 1800,         // 30 minutes in seconds
  timestamp: '2026-03-24T07:30:00Z'
)
```

**Logic**:
1. Parse bib → Extract team (R101) and role (swim)
2. Find relay team in Firestore
3. Find participant with role=swim
4. Update participant with finishTime=1800
5. Check if all 3 legs are finished
6. If all done:
   - Calculate totalTime = sum of 3 legs
   - Set team status = "Completed"
   - Update team in Firestore
7. Return success message

### Team Total Calculation

```
Team Total Time = Swim + Bike + Run
                = 1800 + 4200 + 2100
                = 8100 seconds
                = 2 hours 15 minutes
```

---

## Leaderboard Integration

### Individual Athlete Leaderboard
```
Rank | Name         | Current Leg | Status
-----|--------------|-------------|--------
1    | John Athlete | Bike        | In Progress
2    | Jane Athlete | Run         | In Progress
```

### Relay Team Leaderboard (NEW)
```
Rank | Team              | Swim     | Bike     | Run      | Total
-----|-------------------|----------|----------|----------|----------
1    | Bergman Warriors  | 00:30:00 | 01:10:00 | 00:35:00 | 02:15:00
2    | Dream Team        | 00:32:00 | 01:08:00 | 00:38:00 | 02:18:00
3    | Speed Demons      | 00:31:00 | 01:12:00 | 00:40:00 | 02:23:00
```

---

## Admin Panel: Manage Relay Teams

### View All Relay Teams

```
Relay Teams (5)

Team: Bergman Warriors
Bib: R101
Status: Completed
Created: Mar 15, 2026

├── 🏊 Swim – Vaibhav (R101-S) [Edit]
│   Email: vaibhav@example.com
│   Mobile: 8390288857
│
├── 🚴 Bike – Rider Name (R101-B) [Edit]
│   Email: bike@example.com
│
└── 🏃 Run – Runner Name (R101-R) [Edit]
    Email: run@example.com
```

### Edit Participant (Replacement)

**Scenario**: Swimmer gets injured, need to replace

```
Dialog: Edit Participant

Current: Vaibhav (R101-S)
[Bib R101-S will remain unchanged]

New Name: [Replacement Athlete Name]
New Email: [replacement@example.com]
New Mobile: [9876543210]
New DOB: [2000-01-01]

[Save Changes]
```

**Action**: `updateRelayTeamParticipantAction()`
- Bib stays same (R101-S)
- Personal details updated
- Auto-send email to new participant

---

## API Endpoints

### 1. Generate Relay Bibs
```
POST /api/relay/generate-bibs
Body: { eventId: 'event-001' }
Response: {
  success: true,
  teamBib: 'R101',
  participantBibs: {
    swim: 'R101-S',
    bike: 'R101-B',
    run: 'R101-R'
  }
}
```

### 2. Create Relay Team
```
POST /api/relay/create-team
Body: {
  eventId, ticketId, teamName,
  participants: [swim, bike, run]
}
Response: {
  success: true,
  relayTeamId: 'relay-123',
  teamBib: 'R101'
}
```

### 3. Get Relay Teams
```
GET /api/relay/teams?eventId=event-001
Response: {
  success: true,
  teams: [{...}, {...}]
}
```

### 4. Process Relay Timing
```
POST /api/timing/relay-finish
Body: {
  eventId, athleteBib: 'R101-S',
  athleteName, legTime, timestamp
}
Response: {
  success: true,
  teamBib: 'R101',
  role: 'swim',
  message: '...'
}
```

### 5. Get Team Progress
```
GET /api/relay/progress?eventId=event-001&teamBib=R101
Response: {
  success: true,
  currentLeg: 'bike',  // Currently racing
  legStatus: {
    swim: { status: 'Finished', time: 1800 },
    bike: { status: 'In Progress' },
    run: { status: 'Pending' }
  },
  totalTimeRun: 1800
}
```

---

## Communications

### Confirmation Email (All 3 Participants)

```
Subject: Team Registration Confirmed – Bergman Warriors

Hi [Participant Name],

You are registered in Relay Team: BERGMAN WARRIORS
Role: [Swim / Bike / Run]

Team Details:
├── Team Bib: R101
├── Team Members:
│   ├── 🏊 Vaibhav (Swim)
│   ├── 🚴 Rider Name (Bike)
│   └── 🏃 Runner Name (Run)
└── Event: Bergman Triathlon 2026

Your Bib: R101-[S/B/R]

Your role is crucial to the team's success. Make sure to:
- Check in at race headquarters
- Wear your assigned timing chip
- Be ready at your transition point

Event Details:
Date: March 24, 2026
Time: 7:00 AM
Location: Bergman Track

Questions? Contact: events@bergmantri.com

Team Tracking:
View live progress: https://bergmantri.com/live?team=R101

Good luck!
```

### Pre-Race Reminders

- 7 days before: "Register for your team's event"
- 3 days before: "Confirm team members are ready"
- 1 day before: "Check your gear, confirm bib numbers"
- 2 hours before: "Check in at race headquarters"

---

## Edge Cases & Solutions

### 1. Participant Replacement (Before Race)
**Problem**: Swimmer gets injured day before race
**Solution**:
1. Admin opens relay team in admin panel
2. Clicks "Edit" on swimmer
3. Enters new swimmer details
4. System updates Firestore
5. New swimmer email sent with bib R101-S
6. Old swimmer removed from team

### 2. Athlete DNS (Did Not Start)
**Problem**: Biker doesn't show up race day
**Solution**:
- Timing system records DNF for bike leg
- Team status changes to "DNF"
- Team removed from rankings
- Notification sent to team

### 3. One Leg DNF (Did Not Finish)
**Problem**: Runner doesn't finish the run
**Solution**:
- Timing system marks run as DNF
- Team status becomes DNF
- Only completed legs shown in results
- Total time not calculated

### 4. Team Payment Refund
**Problem**: Team wants to cancel after registration
**Solution**:
- Admin refunds payment via Razorpay
- Team status set to "Refunded"
- Invoice marked void
- Confirmation email sent to all 3

### 5. Same Person in Multiple Roles
**Problem**: Athlete registers as both swimmer AND cyclist
**Validation**:
- Check for duplicate emails across team
- Block with error: "Email must be unique"
- UI prevents duplicate selection

---

## Testing Checklist

- [ ] Relay registration form works (3 participants)
- [ ] Team bib auto-generates (R101, R102, etc.)
- [ ] Individual bibs generated (R101-S, R101-B, R101-R)
- [ ] Validation enforces 3 unique participants
- [ ] Payment processes for relay team
- [ ] Invoice includes all 3 athletes
- [ ] Email sent to all 3 participants
- [ ] Admin can view all relay teams
- [ ] Admin can edit participant details
- [ ] Timing system recognizes relay bibs
- [ ] Individual leg times recorded correctly
- [ ] Team total time calculated
- [ ] Relay leaderboard displays
- [ ] Transition logic works (ski → bike → run)
- [ ] DNF handling for relay teams
- [ ] Team replacement works

---

## File Structure

```
src/
├── lib/
│   ├── types/
│   │   └── registration.ts (RelayTeamRegistration, RelayTeamParticipant)
│   ├── utils/
│   │   └── relayTimingUtils.ts (parseRelayBib, getRoleLabel, etc.)
│   └── actions/
│       ├── relayRegistrationActions.ts (CRUD)
│       └── relayTimingActions.ts (Timing processing)
├── components/
│   └── relay/
│       ├── RelayRegistrationForm.tsx (Frontend form)
│       ├── RelayLeaderboardView.tsx (Results display)
│       └── RelayAdminPanel.tsx (Admin management)
└── app/
    ├── event-registration/[eventId]/
    │   └── page.tsx (Updated with relay option)
    └── api/
        └── relay/
            ├── create-team/route.ts
            ├── get-teams/route.ts
            └── ...
```

---

## Next Steps

1. **Payment Integration**: Link relay registration to payment flow
2. **Invoice Generation**: Update Zoho to generate relay invoices
3. **Email Automation**: Send confirmation + reminder emails
4. **Live Tracking**: Show relay team progress on live map
5. **Results Display**: Update results pages to show relay teams
6. **Club Integration**: Attribute relay points to clubs
7. **Analytics**: Track relay vs individual participation

---

## Support & Documentation

For questions about:
- **Registration**: See `RelayRegistrationForm.tsx`
- **Timing**: See `relayTimingActions.ts`
- **Bibs**: See `relayTimingUtils.ts`
- **Admin**: See `RelayAdminPanel.tsx`
- **Types**: See `registration.ts`

---

**Last Updated**: April 1, 2026
**Version**: 1.0 - Initial Implementation
