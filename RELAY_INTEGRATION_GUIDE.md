# Relay System Integration Guide

## 🔗 Integration Overview

This guide shows how to integrate the relay system with existing Bergman systems: payments, invoicing, emails, admin, and results.

---

## 1. Payment System Integration

### Current State
```
createEventTicketOrderAction(formData)
├── Creates RegistrationAttempt
├── Initiates Razorpay payment
└── Webhook updates payment status
```

### Integration Required

**Modify**: Payment action to detect relay registrations

```typescript
// src/lib/actions/paymentActions.ts

export async function handleRelayPaymentAction(relayTeamId: string, amountPaisa: number) {
  try {
    // 1. Fetch relay team
    const relayResult = await getRelayTeamRegistrationAction(relayTeamId);
    if (!relayResult.success) return error;
    
    const team = relayResult.team;
    
    // 2. Create Razorpay order (same as individual)
    const razorpayOrder = await createRazorpayOrder({
      amount: amountPaisa,
      currency: 'INR',
      receipt: `relay-${relayTeamId}`,
      description: `Relay Team: ${team.teamName}`
    });
    
    // 3. Update relay team with order details
    await updateRelayTeamPayment(relayTeamId, {
      razorpayOrderId: razorpayOrder.id,
      status: 'PaymentInitiated'
    });
    
    return { success: true, orderId: razorpayOrder.id };
  } catch (e) {
    return { success: false, message: e.message };
  }
}
```

**Webhook Handler**: Update `/api/webhooks/razorpay`

```typescript
// Check if relay or individual
if (registration.relayTeamId) {
  // Handle relay payment
  await updateRelayTeamPaymentStatus(registration.relayTeamId, 'PaymentCaptured');
} else {
  // Handle individual payment (existing logic)
  await updateRegistrationAttempt(registration.id, 'PaymentCaptured');
}
```

---

## 2. Invoice System Integration

### Current State
```
invoiceActions.ts
├── Fetch participant details
├── Generate Zoho invoice
└── Send via email
```

### Integration Required

**Add Relay Invoice Generation**:

```typescript
// src/lib/actions/invoiceActions.ts

export async function generateRelayTeamInvoiceAction(relayTeamId: string) {
  try {
    const relayResult = await getRelayTeamRegistrationAction(relayTeamId);
    if (!relayResult.success) return error;
    
    const team = relayResult.team;
    
    // 1. Prepare invoice data
    const invoiceData = {
      customer_name: team.teamName,
      line_items: [
        {
          item_name: 'Relay Team Registration',
          description: `Team: ${team.teamName}\nParticipants:\n1. ${team.participants[0].name} (${team.participants[0].role})\n2. ${team.participants[1].name} (${team.participants[1].role})\n3. ${team.participants[2].name} (${team.participants[2].role})`,
          quantity: 1,
          rate: team.amountPaidPaisa / 100  // Convert paisa to rupees
        }
      ],
      custom_fields: [
        { label: 'Team Bib', value: team.teamBib },
        { label: 'Event', value: team.eventName },
        { label: 'Participants', value: team.participants.map(p => `${p.name} (${p.role})`).join(', ') }
      ]
    };
    
    // 2. Create Zoho invoice
    const zohoResponse = await zohoClient.post('/invoices', invoiceData);
    
    // 3. Send to all 3 participants
    const sendPromises = team.participants.map(p =>
      sendInvoiceEmail(p.email, zohoResponse.invoice_id, team.teamName)
    );
    
    await Promise.all(sendPromises);
    
    // 4. Update relay team with invoice ID
    await updateRelayTeamInvoice(relayTeamId, zohoResponse.invoice_id);
    
    return { success: true, invoiceId: zohoResponse.invoice_id };
  } catch (e) {
    return { success: false, message: e.message };
  }
}
```

---

## 3. Email Communication Integration

### Current State
```
emailActions.ts
├── Registration confirmation
├── Payment receipts
└── Reminders
```

### Integration Required

**Add Relay Team Emails**:

```typescript
// src/lib/actions/emailActions.ts

export async function sendRelayTeamConfirmationEmailAction(relayTeamId: string) {
  try {
    const relayResult = await getRelayTeamRegistrationAction(relayTeamId);
    if (!relayResult.success) return error;
    
    const team = relayResult.team;
    
    // Send confirmation to all 3 participants
    const emailPromises = team.participants.map((participant, idx) => {
      const roleEmoji = { swim: '🏊', bike: '🚴', run: '🏃' }[participant.role];
      
      return sendEmail({
        to: participant.email,
        subject: `Team Registration Confirmed – ${team.teamName}`,
        template: 'relay-confirmation',
        data: {
          participantName: participant.name,
          teamName: team.teamName,
          role: participant.role,
          roleEmoji,
          teamBib: team.teamBib,
          participantBib: participant.bib,
          eventName: team.eventName,
          eventDate: team.eventDate,
          teamMembers: team.participants.map((p, i) => ({
            order: i + 1,
            name: p.name,
            role: p.role,
            bib: p.bib
          }))
        }
      });
    });
    
    await Promise.all(emailPromises);
    return { success: true, message: 'Emails sent to all 3 participants' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}
```

**Email Template**: `templates/relay-confirmation.html`

```html
<h2>Team Registration Confirmed – {{ teamName }}</h2>

<p>Hi {{ participantName }},</p>

<p>You are registered in Relay Team: <strong>{{ teamName }}</strong></p>

<h3>Your Role</h3>
<p><strong>{{ roleEmoji }} {{ role | uppercase }}</strong></p>

<h3>Team Details</h3>
<ul>
  <li><strong>Team Bib:</strong> {{ teamBib }}</li>
  <li><strong>Your Bib:</strong> {{ participantBib }}</li>
  <li><strong>Event:</strong> {{ eventName }}</li>
  <li><strong>Date:</strong> {{ eventDate | date: 'PPP' }}</li>
</ul>

<h3>Team Members</h3>
<table>
  <tr>
    <th>Role</th>
    <th>Name</th>
    <th>Bib</th>
  </tr>
  {% for member in teamMembers %}
  <tr>
    <td>{{ member.role | uppercase }}</td>
    <td>{{ member.name }}</td>
    <td>{{ member.bib }}</td>
  </tr>
  {% endfor %}
</table>

<p>Thank you for registering! We look forward to seeing you at the event.</p>
```

---

## 4. Admin Dashboard Integration

### Current State
```
/admin/dashboard
├── Participants tab
├── Results tab
└── Analytics
```

### Integration Required

**Add Relay Teams Tab**:

```typescript
// src/app/admin/dashboard/page.tsx

<Tabs>
  <TabsList>
    <TabsTrigger value="registrations">Individual Registrations</TabsTrigger>
    <TabsTrigger value="relay-teams">Relay Teams (NEW)</TabsTrigger>
    <TabsTrigger value="results">Results</TabsTrigger>
  </TabsList>
  
  {/* Existing individual registrations */}
  <TabsContent value="registrations">
    <RegistrationsList />
  </TabsContent>
  
  {/* NEW: Relay teams management */}
  <TabsContent value="relay-teams">
    <RelayAdminPanel eventId={selectedEventId} />
  </TabsContent>
  
  <TabsContent value="results">
    <ResultsViewer />
  </TabsContent>
</Tabs>
```

---

## 5. Results Display Integration

### Current State
```
/results/[eventId]
├── Individual leaderboard
└── Category breakdowns
```

### Integration Required

**Add Relay Team Results**:

```typescript
// src/app/results/[eventId]/page.tsx

const [raceFormat, setRaceFormat] = useState<'individual' | 'relay' | 'both'>('both');

return (
  <div className="space-y-6">
    {/* Filter by race format */}
    <Tabs value={raceFormat} onValueChange={setRaceFormat}>
      <TabsList>
        <TabsTrigger value="individual">Individual</TabsTrigger>
        <TabsTrigger value="relay">Relay Teams</TabsTrigger>
      </TabsList>
      
      <TabsContent value="individual">
        <IndividualLeaderboard />
      </TabsContent>
      
      <TabsContent value="relay">
        <RelayLeaderboardView teams={relayResults} />
      </TabsContent>
    </Tabs>
  </div>
);
```

**Data Fetching**:

```typescript
// Fetch both individual and relay results
const [individuals, relayTeams] = await Promise.all([
  getPublicResultsAction(eventId),
  getRelayTeamResultsAction(eventId)
]);
```

---

## 6. Timing System Integration

### Current State
```
/api/timing/finish-line
├── Parse bib
├── Record time
└── Update status
```

### Integration Required

**Update Finish Line Handler**:

```typescript
// src/app/api/timing/finish-line/route.ts

import { parseRelayBib } from '@/lib/utils/relayTimingUtils';

export async function POST(req: Request) {
  const { bib, athleteName, legTime, timestamp } = await req.json();
  
  // 1. Detect if relay or individual
  const relayInfo = parseRelayBib(bib);
  
  if (relayInfo.isRelay) {
    // 2a. Process as relay athlete
    const result = await processRelayAthleteResultAction(
      eventId,
      bib,
      athleteName,
      legTime,
      timestamp
    );
    
    return Response.json(result);
  } else {
    // 2b. Process as individual (existing logic)
    const result = await processIndividualResultAction(...);
    
    return Response.json(result);
  }
}
```

---

## 7. Live Tracking Integration

### Current State
```
/live/[eventId]
├── Live leaderboard (scrolling)
├── Live map (GPS tracking)
└── Athlete search
```

### Integration Required

**Add Relay Team Tracking**:

```typescript
// src/components/live-tracking/LiveTrackingClientPage.tsx

const [formatFilter, setFormatFilter] = useState<'individual' | 'relay' | 'all'>('all');

// Fetch both individual and relay data
const athletes = formatFilter === 'individual' 
  ? individualAthletes
  : formatFilter === 'relay'
    ? relayAthletes
    : [...individualAthletes, ...relayAthletes];

// Relay team progress
const relayProgress = relayTeams.map(team => ({
  teamBib: team.teamBib,
  teamName: team.teamName,
  currentLeg: team.currentLeg,  // 'swim' | 'bike' | 'run' | 'finished'
  legStatus: team.legStatus,    // { swim, bike, run }
  totalTime: team.totalTimeRun
}));
```

---

## 8. Club Integration

### Current State
```
Club Dashboard
├── Members
├── Event Registrations
└── Rankings
```

### Integration Required

**Add Relay Team Points to Club**:

```typescript
// src/lib/actions/clubActions.ts

export async function syncRelayTeamToClubAction(relayTeamId: string) {
  try {
    const relayResult = await getRelayTeamRegistrationAction(relayTeamId);
    if (!relayResult.success) return error;
    
    const team = relayResult.team;
    if (!team.clubId) return { success: true };  // Not affiliated with club
    
    // 1. Get club
    const club = await getClubAction(team.clubId);
    
    // 2. Add team to club's members
    await updateClubRelayTeams(team.clubId, {
      teamName: team.teamName,
      relayTeamId: team.id,
      participants: team.participants.map(p => ({
        name: p.name,
        role: p.role,
        email: p.email
      })),
      addedAt: new Date().toISOString()
    });
    
    // 3. Update club stats
    await updateClubStats(team.clubId, {
      relayTeamsCount: club.relayTeamsCount + 1,
      totalMembers: club.totalMembers + 3  // 3 new members
    });
    
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}
```

---

## 9. Analytics Integration

### Current State
```
Analytics Dashboard
├── Registration trends
├── Revenue tracking
└── Attendance metrics
```

### Integration Required

**Add Relay Analytics**:

```typescript
// src/lib/actions/analyticsActions.ts

export async function getRelayAnalyticsAction(eventId: string, dateRange: DateRange) {
  const teams = await getRelayTeamsForEventAction(eventId);
  
  const analytics = {
    totalRelayTeams: teams.length,
    totalRelayAthletes: teams.length * 3,
    completedTeams: teams.filter(t => t.status === 'Completed').length,
    dnfTeams: teams.filter(t => t.status === 'DNF').length,
    dnsTeams: teams.filter(t => t.status === 'DNS').length,
    averageTeamTime: calculateAverage(teams.map(t => t.totalTime).filter(Boolean)),
    medianTeamTime: calculateMedian(teams.map(t => t.totalTime).filter(Boolean)),
    revenuePaisa: teams.reduce((sum, t) => sum + t.amountPaidPaisa, 0),
    byClub: groupByClub(teams)
  };
  
  return analytics;
}
```

---

## 10. Testing Integration

### End-to-End Flow Test

```typescript
describe('Relay Team Complete Flow', () => {
  it('should handle relay registration → payment → invoice → results', async () => {
    // 1. Create relay team
    const relayResult = await createRelayTeamRegistrationAction(
      formData,
      'user@example.com',
      'user-123',
      'User Name'
    );
    expect(relayResult.success).toBe(true);
    const relayTeamId = relayResult.relayTeamId;
    
    // 2. Process payment
    const paymentResult = await handleRelayPaymentAction(
      relayTeamId,
      300000  // ₹3000 for team
    );
    expect(paymentResult.success).toBe(true);
    
    // 3. Generate invoice
    const invoiceResult = await generateRelayTeamInvoiceAction(relayTeamId);
    expect(invoiceResult.success).toBe(true);
    
    // 4. Send confirmation emails
    const emailResult = await sendRelayTeamConfirmationEmailAction(relayTeamId);
    expect(emailResult.success).toBe(true);
    
    // 5. Process athlete timing
    const swimResult = await processRelayAthleteResultAction(
      eventId, 'R101-S', 'Swimmer', 1800, timestamp
    );
    expect(swimResult.success).toBe(true);
    
    // 6. Verify results
    const results = await getRelayTeamResultsAction(eventId);
    expect(results.results).toContainEqual(
      expect.objectContaining({ teamBib: 'R101' })
    );
  });
});
```

---

## 11. Migration Checklist

Before going live with relay teams:

- [ ] Update payment flow to accept relayTeamId
- [ ] Create invoice generation for relay teams
- [ ] Configure email templates for relay confirmations
- [ ] Add relay teams tab to admin dashboard
- [ ] Update results display with relay leaderboard
- [ ] Modify finish-line timing API to detect relay bibs
- [ ] Add relay tracking to live event page
- [ ] Update club management to include relay teams
- [ ] Add relay analytics to dashboard
- [ ] Create Firestore indexes for relay queries
- [ ] Test complete end-to-end flow
- [ ] Write user documentation for relay registration
- [ ] Train admins on relay management
- [ ] Create contingency plans (participant replacement, DNF handling)
- [ ] Monitor first relay event for issues

---

## 12. Troubleshooting Common Issues

### Issue: Bib Not Recognized as Relay
**Cause**: Bib format incorrect (not matching R###-X)
**Solution**: Validate bib format before processing
```typescript
if (!parseRelayBib(bib).isRelay) {
  throw new Error(`Invalid relay bib format: ${bib}`);
}
```

### Issue: Invoice Sent to Wrong Email
**Cause**: Fetching wrong email field
**Solution**: Always use participant.email, not buyerEmail
```typescript
await sendEmail({ to: participant.email, ... });
```

### Issue: Team Total Time Not Calculated
**Cause**: Not all 3 legs recorded
**Solution**: Check status update logic
```typescript
if (allLegsFinished) {
  totalTime = sum(legTimes);
}
```

### Issue: Admin Panel Shows Duplicate Teams
**Cause**: Query not filtering by eventId
**Solution**: Always include eventId in queries
```typescript
.where('eventId', '==', eventId)
```

---

## Summary

The relay system integrates seamlessly with existing Bergman infrastructure:
- ✅ Reuses payment system (same Razorpay flow)
- ✅ Extends invoice generation (multi-participant support)
- ✅ Enhances email system (team confirmations)
- ✅ Adds admin functionality (team management)
- ✅ Expands results display (team leaderboards)
- ✅ Improves timing system (bib detection)
- ✅ Enriches live tracking (team progress)
- ✅ Extends club features (team membership)
- ✅ Enhances analytics (relay metrics)

All integration points are clearly documented and provide concrete code examples.

---

**Integration Guide Complete**
**Last Updated**: April 1, 2026
