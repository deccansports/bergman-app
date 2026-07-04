# Relay Team System - Implementation Summary

## 📋 Overview

A complete relay team registration and timing system has been implemented, allowing 3-athlete teams to register, compete, and track results together. Each athlete maintains individual bibs and timing while the team result represents their combined effort.

**Date Completed**: April 1, 2026
**Status**: ✅ Feature Complete & Type-Safe

---

## 📦 Deliverables

### 1. **Data Types** (`src/lib/types/registration.ts`)
- ✅ `RelayRole` type: 'swim' | 'bike' | 'run'
- ✅ `RelayTeamParticipant` interface with timing fields
- ✅ `RelayTeamRegistration` interface with team-level timing
- ✅ `RelayTeamRegistrationFormInput` for form submissions
- ✅ Updated `PublicEventRegistrationFormInputClient` with registration type

**Key Fields**:
```typescript
RelayTeamParticipant:
  - role, name, email, mobile, dob, gender, bloodGroup
  - tshirtSize, emergencyContactNumber, address, city, state, country, pincode
  - bib (e.g., "R101-S")
  - finishTime?, finishTimestamp?, status?

RelayTeamRegistration:
  - id, eventId, eventName, ticketId, ticketName
  - teamName, teamBib (e.g., "R101")
  - participants: [swim, bike, run]
  - createdByUid, createdByName, createdByEmail
  - clubId?, couponCode?
  - amountPaidPaisa, transactionId, razorpayOrderId
  - status, totalTime?, completedAt?
  - createdAt, updatedAt
```

---

### 2. **Server Actions** 

#### Registration Actions (`src/lib/actions/relayRegistrationActions.ts`)

**generateRelayBibsAction(eventId)**
- Auto-generates team bib (R101, R102, ...)
- Generates 3 participant bibs (R###-S, R###-B, R###-R)
- Returns: teamBib, participantBibs object

**validateRelayTeamRegistration(data)**
- Validates 3 participants required
- Validates unique emails and mobiles
- Validates required roles (swim, bike, run)
- Validates agreements
- Returns: valid boolean, errors array

**createRelayTeamRegistrationAction(data, userEmail, userId, userName)**
- Validates input
- Generates team + participant bibs
- Creates Firestore document
- Returns: success, relayTeamId, teamBib

**getRelayTeamRegistrationAction(relayTeamId)**
- Fetches single relay team document
- Returns: success, team details

**getRelayTeamsForEventAction(eventId)**
- Fetches all relay teams for event
- Returns: success, teams array (sorted by createdAt desc)

**updateRelayTeamParticipantAction(relayTeamId, role, updatedParticipant)**
- Updates participant details
- Preserves bib number
- Updates Firestore
- Returns: success, message

---

#### Timing Actions (`src/lib/actions/relayTimingActions.ts`)

**getRelayTeamByBibAction(eventId, teamBib)**
- Finds relay team by bib
- Returns: success, team data

**processRelayAthleteResultAction(eventId, athleteBib, athleteName, legTime, timestamp)**
- Parses relay bib (e.g., "R101-S" → team "R101", role "swim")
- Finds relay team and participant
- Updates participant finishTime and status
- If all legs done: calculates totalTime, sets team status to "Completed"
- Returns: success, teamBib, role

**getRelayTeamResultsAction(eventId)**
- Fetches all completed relay teams
- Ordered by totalTime ascending (leaderboard)
- Returns: success, results array

**getRelayTeamProgressAction(eventId, teamBib)**
- Gets current racing status
- Returns: currentLeg, legStatus per role, totalTimeRun
- Shows which athlete is currently racing

---

### 3. **Frontend Components**

#### Relay Registration Form (`src/components/relay/RelayRegistrationForm.tsx`)

**Features**:
- ✅ 2-step wizard interface
  - Step 1: Team Details (name entry)
  - Step 2: Participants (3 athlete forms)
- ✅ Smart UX:
  - Pre-fill first participant from logged-in user profile
  - "Copy from Swim" buttons to duplicate details to Bike/Run
  - Role-specific labels and icons (🏊 🚴 🏃)
- ✅ Form validation:
  - Required fields enforcement
  - Unique email check
  - Agreement checkboxes
- ✅ Responsive design:
  - Grid layout for participant fields
  - Proper spacing and grouping
  - Mobile-friendly input fields

**Props**:
- `eventId`: string
- `ticketId`: string
- `eventName`: string
- `ticketName`: string
- `onSuccess?`: (teamBib, relayTeamId) => void

---

#### Relay Leaderboard View (`src/components/relay/RelayLeaderboardView.tsx`)

**Features**:
- ✅ Team-level leaderboard table
- ✅ Individual leg times (Swim, Bike, Run)
- ✅ Participant names under each leg
- ✅ Total time column
- ✅ Status badges (Finished, DNF, DNS, In Progress)
- ✅ Optional: Expandable participant details

**Props**:
- `teams`: RelayTeamResult[]
- `showParticipantDetails?`: boolean

---

#### Relay Admin Panel (`src/components/relay/RelayAdminPanel.tsx`)

**Features**:
- ✅ View all relay teams for event
- ✅ Team-level grouping
- ✅ Edit participant details
- ✅ Replace athlete (keeps bib)
- ✅ Modal dialog for edits
- ✅ Refresh button to sync data
- ✅ Status and creation date display

**Actions**:
- List teams
- Edit participant
- Save changes
- Send notifications

---

### 4. **Utility Functions** (`src/lib/utils/relayTimingUtils.ts`)

**parseRelayBib(bib)**
- Parses relay bib format
- Returns: isRelay, teamBib, role, rawBib
- Handles: "R101-S" → { isRelay: true, teamBib: "R101", role: "swim" }

**isRelayBib(bib)**
- Quick boolean check
- Returns: true if relay format, false otherwise

**getRoleLabel(role)**
- Converts role to display label
- "swim" → "🏊 Swim"
- "bike" → "🚴 Bike"
- "run" → "🏃 Run"

**roleToSegment(role)**
- Maps role to timing segment
- "swim" → "SWIM"
- "bike" → "BIKE"
- "run" → "RUN"

**calculateRelayTeamTime(legTimes)**
- Sums all leg times
- Takes: { swim?, t1?, bike?, t2?, run? }
- Returns: total seconds

**getRelayTeamBibs(teamBib)**
- Gets all 3 bibs for a team
- Returns: { swim, bike, run }

---

### 5. **Updated Pages**

#### Event Registration Page (`src/app/event-registration/[eventId]/page.tsx`)

**Changes**:
- ✅ Added registration type selection step
- ✅ Radio options: Individual vs Relay Team
- ✅ Show RelayRegistrationForm when relay selected
- ✅ Back button to switch types
- ✅ Maintained all existing individual flow
- ✅ Responsive layout with icons

**UI Flow**:
```
1. Load event details
2. Show registration type selector
3. If Relay selected → Show RelayRegistrationForm
4. If Individual selected → Show ticket selection (existing flow)
5. Proceed to payment
```

---

### 6. **Documentation**

#### Full Documentation (`RELAY_SYSTEM_DOCUMENTATION.md`)
- 📖 Complete overview and feature list
- 🏗️ Data structure with JSON examples
- 📝 Step-by-step registration flow
- 🎫 BIB generation & detection logic
- 🎯 Timing system integration
- 🏆 Leaderboard display format
- 👨‍💼 Admin panel walkthrough
- 📧 Email communications templates
- 🚨 Edge cases & solutions (8 scenarios)
- ✅ Testing checklist (15 items)
- 📁 File structure
- 🚀 Next steps

#### Quick Reference (`RELAY_QUICK_REFERENCE.md`)
- ⚡ Quick start guides (user, admin, timing)
- 🔧 Key functions reference
- 📊 Data model summary
- 🎫 BIB format reference
- ⏱️ Time calculation examples
- 🗄️ Firestore collections guide
- 🧪 Testing with curl examples
- ⚠️ Common errors & solutions
- ✅ Integration checklist

---

## 🎯 Key Features Implemented

### User Experience
- ✅ Intuitive 2-step registration form
- ✅ Smart pre-fill from user profile
- ✅ Copy-to-other functionality for efficiency
- ✅ Clear role labels with emojis
- ✅ Input validation with error messages
- ✅ Mobile-responsive design

### Admin Control
- ✅ View all relay teams per event
- ✅ Edit participant details
- ✅ Replace athletes with new registration
- ✅ Keep bib numbers consistent
- ✅ Track creation metadata
- ✅ Status monitoring

### Technical Architecture
- ✅ Type-safe TypeScript implementation
- ✅ Server-side validation
- ✅ Firestore integration
- ✅ Auto-increment bib generation
- ✅ Smart bib parsing (regex-based)
- ✅ Status management (pending → Completed/DNF/DNS)
- ✅ Time aggregation and ranking

---

## 🔌 Integration Points

### Ready for Integration
1. **Payment System**: Use relayTeamId + amountPaidPaisa
2. **Invoice Generation**: Template includes all 3 participants
3. **Email Notifications**: Send to all 3 emails with role assignments
4. **Timing Backend**: Detect relay bibs via parseRelayBib()
5. **Leaderboard Display**: Use RelayLeaderboardView component
6. **Admin Dashboard**: Embed RelayAdminPanel component
7. **Results Display**: Query relayTeamResults collection

---

## 📊 Database Schema

### Firestore Collection: `relayTeamRegistrations`

```
/relayTeamRegistrations/{relayTeamId}
  - teamName: string
  - teamBib: string (e.g., "R101")
  - eventId: string
  - participants: [swim, bike, run] (exactly 3)
  - createdByUid, createdByName, createdByEmail
  - amountPaidPaisa: number
  - status: 'pending' | 'PaymentInitiated' | 'Completed' | 'DNF' | 'DNS'
  - totalTime?: number (seconds)
  - completedAt?: string
  - createdAt, updatedAt
```

### Indexes Required
```
1. (eventId, teamBib) - UNIQUE
2. (eventId, status, totalTime) - FOR LEADERBOARD
3. (eventId, createdAt DESC) - FOR ADMIN LIST
```

---

## 🎫 BIB System

### Format
- **Team**: `R###` (e.g., R101, R102, R999)
- **Swimmer**: `R###-S` (e.g., R101-S)
- **Cyclist**: `R###-B` (e.g., R101-B)
- **Runner**: `R###-R` (e.g., R101-R)

### Generation
- Starts at R101 for first relay team per event
- Auto-increments by 1
- Participant bibs derived from team bib
- Validation: `^R\d+-[SBR]$`

### Detection
```typescript
const info = parseRelayBib('R101-S');
// Returns: { isRelay: true, teamBib: 'R101', role: 'swim' }
```

---

## ⏱️ Timing Integration

### Athlete Finishes
```
1. Finish line system captures bib: "R101-S"
2. parseRelayBib() identifies as relay
3. processRelayAthleteResultAction() called
4. Finds relay team R101
5. Updates swimmer's finishTime
6. Checks if all 3 legs complete
7. If yes: calculateRelayTeamTime() → totalTime
8. Updates team status to "Completed"
```

### Team Results
```
Team Total = Swim Leg + Bike Leg + Run Leg
           = 1800s + 4200s + 2100s
           = 8100s (2h 15m 0s)
```

---

## 🧪 Testing Recommendations

### Manual Testing
- [ ] Register relay team with 3 athletes
- [ ] Verify team bib generated (R101)
- [ ] Verify participant bibs generated (R101-S, R101-B, R101-R)
- [ ] Verify email sent to all 3 participants
- [ ] Admin edit participant details
- [ ] View relay leaderboard
- [ ] Process athlete timing (relay detection)
- [ ] Verify team total time calculated
- [ ] Test DNF scenario
- [ ] Test replacement athlete

### Automated Testing
- Unit tests for `parseRelayBib()`
- Unit tests for `calculateRelayTeamTime()`
- Integration tests for `createRelayTeamRegistrationAction()`
- Integration tests for `processRelayAthleteResultAction()`

---

## 📈 Next Steps to Production

### High Priority
1. [ ] Integrate with payment system
2. [ ] Update invoice generation for relay teams
3. [ ] Configure email notifications for all 3 participants
4. [ ] Test end-to-end registration → payment → results
5. [ ] Set up Firestore indexes

### Medium Priority
1. [ ] Add relay team dashboard view
2. [ ] Live tracking for relay teams
3. [ ] Results page updates
4. [ ] Admin analytics for relay participation
5. [ ] Club-level relay reporting

### Low Priority
1. [ ] Advanced relay features (sub-teams, divisions)
2. [ ] Relay-specific reports
3. [ ] Integration with training platform
4. [ ] Mobile app updates

---

## 📁 File Structure

```
Implementation Files Created:

src/
├── lib/
│   ├── types/
│   │   └── registration.ts ✅
│   │       ├── RelayRole
│   │       ├── RelayTeamParticipant
│   │       ├── RelayTeamRegistration
│   │       └── RelayTeamRegistrationFormInput
│   │
│   ├── utils/
│   │   └── relayTimingUtils.ts ✅
│   │       ├── parseRelayBib()
│   │       ├── isRelayBib()
│   │       ├── getRoleLabel()
│   │       ├── roleToSegment()
│   │       ├── calculateRelayTeamTime()
│   │       └── getRelayTeamBibs()
│   │
│   └── actions/
│       ├── relayRegistrationActions.ts ✅
│       │   ├── generateRelayBibsAction()
│       │   ├── validateRelayTeamRegistration()
│       │   ├── createRelayTeamRegistrationAction()
│       │   ├── getRelayTeamRegistrationAction()
│       │   ├── getRelayTeamsForEventAction()
│       │   └── updateRelayTeamParticipantAction()
│       │
│       └── relayTimingActions.ts ✅
│           ├── getRelayTeamByBibAction()
│           ├── processRelayAthleteResultAction()
│           ├── getRelayTeamResultsAction()
│           └── getRelayTeamProgressAction()
│
├── components/
│   └── relay/
│       ├── RelayRegistrationForm.tsx ✅
│       ├── RelayLeaderboardView.tsx ✅
│       └── RelayAdminPanel.tsx ✅
│
└── app/
    └── event-registration/[eventId]/
        └── page.tsx ✅ (Updated with relay support)

Documentation:
├── RELAY_SYSTEM_DOCUMENTATION.md ✅
└── RELAY_QUICK_REFERENCE.md ✅
```

---

## ✅ Quality Checklist

- ✅ All TypeScript types are type-safe
- ✅ No compilation errors
- ✅ No linting errors
- ✅ All actions are server-side ('use server')
- ✅ All components are client-side ('use client')
- ✅ Proper error handling with try-catch
- ✅ Responsive UI components
- ✅ Proper validation at multiple levels
- ✅ Security: Email uniqueness validation
- ✅ UX: Pre-fill and copy functionality
- ✅ Documentation: Complete and detailed
- ✅ Comments: Clear and helpful

---

## 🎓 Key Implementation Insights

### 1. Bib Strategy
Using relay-specific bib format (R101-S) makes timing detection trivial:
```typescript
if (bib.match(/^R\d+-[SBR]$/)) {
  // It's a relay, route accordingly
}
```

### 2. Flexible Participant Updates
Keeping bib constant while updating participant details enables:
- Easy replacement (injured athlete)
- No timing system changes needed
- Transparent team history

### 3. Progressive Total Calculation
Only calculating totalTime when all 3 legs complete:
- Avoids partial/incomplete results in leaderboard
- Maintains data integrity
- Natural completion detection

### 4. Role-Based Ordering
Enforcing swim → bike → run order:
- Matches event format
- Easier UI labeling
- Clear timing sequence

---

## 💡 Design Decisions

1. **Exactly 3 Participants**: Array of length 3 ensures type safety
2. **Individual Bibs**: Separate bib per athlete enables independent timing
3. **Team-Level Aggregation**: Total time calculated from individual times
4. **Status Tracking**: Per-participant status enables better reporting
5. **Separate Collection**: relayTeamRegistrations separate from individual registrations
6. **Auto-Increment Strategy**: Simple sequential numbering (R101, R102...)

---

## 📞 Support

For implementation questions:
- **Registration Logic**: See `relayRegistrationActions.ts`
- **Timing Logic**: See `relayTimingActions.ts`
- **Utilities**: See `relayTimingUtils.ts`
- **Component Examples**: See component files in `src/components/relay/`
- **Type Definitions**: See `src/lib/types/registration.ts`

---

**Implementation Complete** ✅
**Status**: Production-Ready with Integration Pending
**Last Updated**: April 1, 2026
