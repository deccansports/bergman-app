// src/app/terms-and-conditions/page.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'; 
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export default function TermsAndConditionsPage() {
  const router = useRouter();
  const termsContent = `
Bergman Race Rules & Regulations

**General Rules**
The Organisers reserve the right to limit or refuse participation at their discretion.
Participants may be removed from the race if deemed physically unfit to continue.
The Organisers may modify rules and regulations without prior notice.
The race route may be changed with advance notice to participants.
It is the participant’s responsibility to be familiar with all rules and avoid any violations.
Entries and bib numbers are non-transferable and non-refundable under any circumstances.
The Organisers reserve the right to cancel any offline registration without notice. In such cases, the paid amount will be refunded.

**Cancellation Policy**
6+ months before the event: 70% refund (excluding GST and processing charges).
4 months before the event: 50% refund (excluding GST).
3 months before the event: 20% refund (excluding GST).
2 months or less before the event: No refund.
Post-registration confirmation or within 6 months of the event: Only 70% refund (excluding GST).

**Deferral, Transfer & Category Change Policy**
All deferral, transfer, or category change requests must be made at least 60 days prior to the event via the official form.
Deferral to the next year’s event will require paying the entry fee difference if applicable.
Once approved, no further deferral or transfer requests will be accepted.
Deferral is valid for 1 year from the original event date.
Charges:
- Deferral / Name Transfer / Category Change: ₹2,499
- Category change (lower to higher): ₹2,499 + fee difference + GST
- Category change (higher to lower): ₹2,499 (No refund of fee difference)

**Weather Disclaimer**
In case of bad weather, the Organisers may:
- Delay the race start
- Shorten or modify the course
- Cancel the event entirely (No refund applicable)
If swimming conditions are unsafe, the swim leg may be replaced with a run.
Use of banned substances is prohibited. Random doping tests may be conducted.
Outside support, including hydration/nutrition refills outside aid stations, is not allowed.
Respect for volunteers, spectators, and staff is mandatory.
Littering outside of designated bins is strictly prohibited.
Athletes are responsible for their own progress and must not assist others unless pre-approved by the Event Director. Violators will be disqualified.
No nudity outside changing areas; headphones are not permitted at any point during the race.
Participants must be familiar with the course and follow the marked route at all times.

**Race Entry Rules**
Open to participants of all nationalities.
On-the-spot entries are not accepted.
Participants must be 18 years of age or older on race day.
Entries are non-transferable to other participants or future events.
No switching between race distances is allowed.
Any participant found providing false information or using someone else’s identity will be disqualified and banned from future events.
The Organisers reserve the right to reschedule or cancel the event due to force majeure or hazardous conditions (no refunds).
The Organisers are not liable for errors in entry details submitted by participants.
Bib swapping is strictly prohibited. Offenders will be disqualified and banned.

**Athlete Check-in Rules**
Participants must check in during allocated times and attend the mandatory race briefing.
Bicycles must be racked within designated time slots. Failure to do so will result in disqualification.
The timing chip must be worn on the left ankle throughout the race.
Lost or malfunctioning chips are the participant’s responsibility.
Race numbers must be visible and unaltered.

**Bike Check-in**
Bike check-in is only permitted during assigned time slots.
Helmets are mandatory during bike check-in and will be inspected for safety (smart helmets not allowed).
Bikes must have the official sticker and be racked in the designated spot.
You may leave helmets and bike shoes attached to the bike. Other gear must be brought on race morning.

**Bike Check-out**
- Bicycles must be picked up within the specified time slot after the race finishes.
- The athlete must present their bib number to retrieve their bike.
- The organizers are not responsible for bikes not collected within the designated time.

**Swimming Rules**
Proper swimming attire or trisuit must be worn; no coverage past elbows or knees.
Swim caps provided by the organisers are mandatory.
Goggles are allowed; no fins, paddles, snorkels, or aids.
Wetsuits:
- Compulsory below 21°C
- Optional up to 23°C
- Not allowed beyond 23°C
Support crews are prohibited. Receiving outside help will lead to disqualification.
Only participants and officials are allowed on the swim course.
Swimmers needing help should raise an arm; once assisted, they must retire from the race.

**Cycling Rules**
No support vehicles or pacers allowed.
Participants must follow all traffic laws unless instructed by race officials.
Headphones and bare torso are not permitted.
Drafting is prohibited (14 meters or 7 bike lengths).
Helmets must be worn from the time the bike is unracked until it is racked back.

**Running Rules**
Runners must always wear their race numbers clearly visible at the front of the body.
No support vehicles or pacers are allowed.
Athletes must stay on the designated path throughout the course.
No bare torsos or headphones allowed.

---

Terms and Conditions – Bergman Triathlon
1. Registration
By registering for Bergman Triathlon, you agree to abide by all event rules, regulations, and decisions made by the organizers.
Registrations are accepted on a first-come, first-served basis and are only confirmed upon successful payment.
You must be 18 years of age or older on race day to participate.
All information submitted during registration must be accurate and truthful.
Bib number and registration are non-transferable and non-refundable, except as per the deferral/cancellation policies outlined below.
2. Code of Conduct
Participants must follow race instructions, maintain sportsmanship, and treat volunteers, officials, and fellow athletes with respect.
Use of banned substances or outside assistance during the race will result in disqualification.
3. Rights Reserved
The organizers reserve the right to:
- Modify or cancel the event due to unforeseen circumstances (weather, safety, force majeure).
- Amend rules and policies at any time without prior notice.
- Disqualify participants for non-compliance with the rules or for misconduct.
`;

  return (
    <div className="container mx-auto py-12 px-4 max-w-4xl">
      <Card className="max-w-3xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-primary">Terms and Conditions – Bergman Triathlon</CardTitle>
           <CardDescription className="text-md text-muted-foreground pt-1">Read the terms carefully before participating.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[60vh] pr-4">
            <div className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none text-foreground">
              {termsContent.split('\n').map((paragraph, index) => {
                const trimmed = paragraph.trim();
                if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
                  return <h2 key={index} className="font-semibold text-xl mt-6 mb-3 text-primary">{trimmed.substring(2, trimmed.length - 2)}</h2>;
                } else if (trimmed.match(/^\d+\.\s/)) { 
                  return <h3 key={index} className="font-medium text-lg mt-4 mb-1.5">{trimmed}</h3>;
                } else if (trimmed.match(/^- /)) { 
                  return <li key={index} className="ml-6 list-disc my-1">{trimmed.substring(1).trim()}</li>;
                }
                return <p key={index} className="my-2.5 leading-relaxed">{trimmed || <br />}</p>;
              })}
            </div>
          </ScrollArea>
        </CardContent>
         <CardFooter className="border-t pt-6">
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
