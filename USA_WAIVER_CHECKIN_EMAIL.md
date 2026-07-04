# USA Event Waiver Check-in Email - Feature Implementation

**Date:** April 19, 2026  
**Feature:** Send USA-specific waiver check-in email (template #259) for USA event participants  
**Status:** ✅ Implemented

## Overview

When a participant's waiver is checked in for a USA-based event, the system now automatically sends a comprehensive waiver check-in email (Brevo template #259) that includes:

- ✅ Check-in confirmation
- ✅ USA Event Waiver & Release of Liability (legal document)
- ✅ Cancellation, Refund & Deferral policies
- ✅ Return policy for race kit
- ✅ Media consent agreement
- ✅ Digital signature confirmation

## Implementation Details

### Files Modified

#### 1. `/src/lib/auth/authConfig.ts`
- **Added:** `waiverCheckedInUsaTemplateId: 259` to Brevo configuration
- **Purpose:** Maps template ID 259 for USA-specific waiver emails

```typescript
waiverCheckedInUsaTemplateId: 259, // USA Event Waiver Check-in Email with Waiver & Refund Policy
```

#### 2. `/src/lib/auth/brevoService.ts`
- **Updated:** `sendWaiverCheckedInEmail()` function to detect USA events
- **Logic:** 
  - Checks if participant's country matches USA patterns: `'usa'`, `'us'`, `'united states'`, `'united states of america'`
  - Routes to USA template (#259) if USA event detected
  - Falls back to India template (#188) for non-USA events
  - Logs routing decision for debugging

```typescript
// Detect USA event
const isUSA = (value?: string | null) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'usa' || v === 'us' || v === 'united states' || v === 'united states of america';
};

const isUsaEvent = isUSA(country);
const templateId = isUsaEvent ? config.brevo.waiverCheckedInUsaTemplateId : config.brevo.waiverCheckedInTemplateId;
```

### Trigger Point

Waiver check-in email is sent from: `/src/app/api/volunteer-checkin/verify-otp/route.ts`

**When triggered:**
1. Volunteer verifies participant OTP at check-in
2. Participant record is updated with `checkInStatus: 'CheckedIn'`
3. `sendWaiverCheckedInEmail()` is called with participant & event data
4. **USA check:** Country field is evaluated
5. **Template selection:** Appropriate Brevo template is chosen
6. **Email sent:** Check-in confirmation with applicable policies

### Email Template Variables

The email template receives these parameters:

```javascript
{
  name: athleteName,              // e.g., "John Doe"
  eventname: eventName,           // e.g., "Bergman USA 2026"
  ticket: ticketName,             // e.g., "Olympic Distance"
  eventdate: formattedEventDate,  // e.g., "Apr 20, 2026"
  address: address,               // Participant address
  phone: mobileNumber,            // Participant phone
  email: recipientEmail,          // Participant email
  emergencynumber: emergencyContact,
  emergency_contact: emergencyContact,
  day: checkinDay,                // e.g., "19th"
  date: checkinDate,              // e.g., "April, 2026"
  time: checkinTime,              // e.g., "3:45 PM"
  organizer_name: organizerName,  // Event organizer
  organizer_address: organizerAddress,
  company_description: organizerCompanyDescription,
  country: country,               // "USA" or "India"
  EVENT_NAME: eventName,
}
```

## Email Content (Template #259)

### Sections Included

1. **Header**
   - Bergman USA logo with accent bar
   - "Check-in Successful" badge
   - Participant name and event confirmation

2. **Details Strip**
   - Race category
   - Event date
   - Kit status (Collect Now ✅)

3. **Race Day Motivation**
   - Inspirational message
   - Safety reminder
   - Encouragement for race day

4. **Participant Information Box**
   - Name, event, category, date
   - Email and phone

5. **USA Event Waiver & Release of Liability** ⚖️
   - Acknowledgment of inherent risks
   - Release clause for event organizers
   - California Civil Code §1542 waiver
   - Indemnification agreement
   - Physical fitness certification
   - Emergency medical consent

6. **Return, Refund & Cancellation Policy**
   - Refund policy table (90% within 48h → No refund 2+ months before)
   - Deferral policy ($25 base fee, 1-year validity, 60-day minimum notice)
   - Category change policy ($25 Triathlon, $5 Swimathon)
   - No show & force majeure clause
   - Processing timeline (15 working days)

7. **Media Consent & Acknowledgement**
   - Permission for photography, video, name usage
   - Legal binding confirmation

8. **Digital Signature Box**
   - Signed by participant name
   - Date signed (check-in date)
   - E-SIGN Act compliance statement

9. **Call-to-Action**
   - Link to bergmantri.com
   - Motivational footer

10. **Footer**
    - Bergman USA branding
    - Contact email: info@bergmantri.com
    - Website: bergmantri.com
    - Copyright notice

## How It Works

### Flow Diagram

```
Volunteer Check-in
    ↓
OTP Verification → /volunteer-checkin/verify-otp
    ↓
Participant record updated (CheckedIn)
    ↓
sendWaiverCheckedInEmail() called
    ↓
Country field evaluated
    ↓
↙─────────────────────────────────────────────────↘
USA Country                              Non-USA Country
    ↓                                          ↓
Template #259                            Template #188
(USA + Waiver + Policies)               (India standard)
    ↓                                          ↓
Email sent to participant
    ↓
WhatsApp confirmation (optional)
```

## Testing Checklist

- ✅ TypeScript compilation passes (`npm run typecheck`)
- ✅ No breaking changes to existing code
- ✅ Backwards compatible with India events
- ✅ Country detection logic tested
- ✅ Template routing verified

### Manual Testing Steps

1. **Set up test event** with `country: 'USA'` or `country: 'US'`
2. **Register participant** with USA event
3. **Generate OTP** for waiver check-in
4. **Verify OTP** via `/volunteer-checkin/verify-otp` endpoint
5. **Check logs** for: `[sendWaiverCheckedInEmail] Sending waiver check-in email... IsUSA: true, TemplateId: 259`
6. **Verify email received** with full USA waiver and policies
7. **Check India event** to confirm template #188 still used for non-USA

### Expected Log Output

For USA events:
```
[sendWaiverCheckedInEmail] Sending waiver check-in email to participant@example.com. IsUSA: true, TemplateId: 259
```

For India events:
```
[sendWaiverCheckedInEmail] Sending waiver check-in email to participant@example.com. IsUSA: false, TemplateId: 188
```

## Country Detection Logic

The system recognizes USA by these patterns (case-insensitive):
- `'usa'`
- `'us'`
- `'united states'`
- `'united states of america'`

Examples:
- ✅ `'USA'` → Detected as USA
- ✅ `'us'` → Detected as USA
- ✅ `'United States'` → Detected as USA
- ✅ `'UNITED STATES OF AMERICA'` → Detected as USA
- ❌ `'India'` → Not USA, uses template #188
- ❌ `'UK'` → Not USA, uses template #188
- ❌ `null` or empty → Defaults to India

## Brevo Template Configuration

**Template ID:** 259  
**Name:** USA Event Waiver Check-in Email  
**Type:** Dynamic HTML email template  
**Recipient:** Waiver check-in participants from USA events  
**Variables Required:** 24 (name, eventname, ticket, eventdate, address, phone, email, etc.)

## Benefits

1. **Legal Compliance** ⚖️
   - USA-specific legal waiver and liability release
   - California Civil Code §1542 compliance
   - Documented electronic acceptance

2. **Clear Policies** 📋
   - Transparent refund structure ($100 → $0 based on timing)
   - Deferral options with clear fees
   - Category change pricing
   - No-show policies

3. **Better UX** 👥
   - Participants understand all policies at check-in
   - Professional branding with Bergman orange theme
   - Mobile-responsive design
   - Clear sections and visual hierarchy

4. **Risk Mitigation** 🛡️
   - Indemnification clause protects organizers
   - Emergency medical consent documented
   - Participants acknowledge inherent risks
   - Media release permissions included

## Future Enhancements

- [ ] Multi-language support (Spanish waiver for Hispanic participants)
- [ ] State-specific waivers (some states have different requirements)
- [ ] Dynamic policy templates based on event type
- [ ] WhatsApp version of USA waiver summary
- [ ] Admin dashboard to track waiver acceptances

## Compatibility

- ✅ Works with existing India event waivers (template #188)
- ✅ No changes to database schema
- ✅ Backwards compatible with old participant records
- ✅ Integrates with existing OTP verification flow
- ✅ Compatible with Brevo dynamic email system

## Related Files

- [src/app/api/volunteer-checkin/verify-otp/route.ts](src/app/api/volunteer-checkin/verify-otp/route.ts) - OTP verification endpoint
- [src/lib/auth/brevoService.ts](src/lib/auth/brevoService.ts) - Email sending service
- [src/lib/auth/authConfig.ts](src/lib/auth/authConfig.ts) - Configuration file
- [src/components/volunteer/WaiverCheckinTab.tsx](src/components/volunteer/WaiverCheckinTab.tsx) - UI component

## Support

For issues or questions:
- 📧 Email: info@bergmantri.com
- 🐛 Debug logs available in server terminal
- 📊 Brevo dashboard for email delivery tracking
