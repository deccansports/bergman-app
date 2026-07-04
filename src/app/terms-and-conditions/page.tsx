import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { getServiceFeesAction } from '@/lib/actions';

const formatInr = (paisa: number) => `₹${(paisa / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatUsd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function TermsAndConditionsPage() {
  const feeRes = await getServiceFeesAction();
  const triathlonFees = feeRes.fees?.Triathlon;
  const swimathonFees = feeRes.fees?.Swimming;

  const deferralInr = formatInr(triathlonFees?.deferralFeePaisa ?? 200000);
  const deferralUsd = formatUsd(triathlonFees?.deferralFeeUsdCents ?? 5000);
  const categoryChangeInr = formatInr(triathlonFees?.categoryChangeFeePaisa ?? 200000);
  const categoryChangeUsd = formatUsd(triathlonFees?.categoryChangeFeeUsdCents ?? 5000);

  const swimDeferralInr = formatInr(swimathonFees?.deferralFeePaisa ?? 100000);
  const swimDeferralUsd = formatUsd(swimathonFees?.deferralFeeUsdCents ?? 3000);
  const swimCategoryChangeInr = formatInr(swimathonFees?.categoryChangeFeePaisa ?? 100000);
  const swimCategoryChangeUsd = formatUsd(swimathonFees?.categoryChangeFeeUsdCents ?? 3000);
  const triathlonMinAge = triathlonFees?.minimumAgeYears ?? 16;
  const swimathonMinAge = swimathonFees?.minimumAgeYears ?? 9;

  return (
    <div className="container mx-auto py-12 px-4 max-w-4xl">
      <Card className="max-w-4xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-primary">Terms and Conditions – Bergman Triathlon</CardTitle>
          <CardDescription className="text-md text-muted-foreground pt-1">Read the terms carefully before participating.</CardDescription>
        </CardHeader>

        <CardContent>
          <ScrollArea className="h-[68vh] pr-4">
            <div className="space-y-6 text-sm sm:text-base leading-7">
              <section>
                <h2 className="text-xl font-semibold text-primary mb-2">Bergman Race Rules & Regulations</h2>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">General Rules</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>The Organisers reserve the right to accept, reject, or limit participation at their sole discretion.</li>
                  <li>Participants may be withdrawn from the event at any stage if deemed physically unfit or unable to continue safely.</li>
                  <li>The Organisers reserve the right to amend rules, regulations, and event guidelines at any time without prior notice.</li>
                  <li>The race route is subject to change; any updates will be communicated to participants in advance.</li>
                  <li>All participants are responsible for understanding and adhering to the event rules and regulations.</li>
                  <li>All entries are non-transferable and non-refundable. Bib numbers cannot be exchanged under any circumstances.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">Podium & Trophy Collection</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>All podium finishers must collect their trophies at the official prize distribution ceremony.</li>
                  <li>Trophies not collected at the venue during the ceremony will not be couriered, shipped, or sent later under any circumstances.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">Bib & Kit Collection Policy (OTP-Based System)</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Bib and kit collection will be conducted strictly through a secure OTP verification system.</li>
                </ul>

                <h4 className="text-base font-semibold mt-3 mb-1">Collection Process</h4>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Participants must visit the designated Bib Collection Counter and provide their bib number.</li>
                  <li>An OTP will be automatically sent to the participant&apos;s registered mobile number and email address.</li>
                  <li>The bib kit will be handed over only after successful OTP verification.</li>
                  <li>After collecting the bib kit, participants may proceed to the Goodies Counter to collect Event T-shirt, Bike stickers, Bag, Two transition bags, and Bib belt.</li>
                </ul>

                <h4 className="text-base font-semibold mt-3 mb-1">Mandatory Participant Presence</h4>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Participants are required to be physically present to collect their bib kit.</li>
                </ul>

                <h4 className="text-base font-semibold mt-3 mb-1">No Kit Without OTP</h4>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Under no circumstances will a bib or kit be issued without valid OTP verification.</li>
                </ul>

                <h4 className="text-base font-semibold mt-3 mb-1">Goodies Collection by Representative</h4>
                <ul className="list-disc pl-6 space-y-1">
                  <li>In case the participant is unable to attend, only goodies (not the bib kit) may be collected by an authorized representative.</li>
                  <li>OTP verification from the registered participant is still mandatory.</li>
                </ul>

                <h4 className="text-base font-semibold mt-3 mb-1">Mobile Number Changes</h4>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Any request to update a registered mobile number must be made at the Help Desk with valid ID proof (e.g., DigiLocker or government-issued ID).</li>
                </ul>

                <h4 className="text-base font-semibold mt-3 mb-1">No Exceptions Policy</h4>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Failure to provide a valid OTP will result in denial of bib/kit or goodies collection. No exceptions will be made.</li>
                </ul>

                <h4 className="text-base font-semibold mt-3 mb-1">Uncollected Kits</h4>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Bibs, kits, or goodies not collected during the official collection window will not be couriered, shipped, or distributed later under any circumstances.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">Cancellation Policy</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>If cancelled within 48 hours of registration: 90% refund (excluding GST).</li>
                  <li>6+ months before event: 70% refund (excluding GST and processing charges and platform fees).</li>
                  <li>4 months before event: 50% refund (excluding GST).</li>
                  <li>3 months before event: 20% refund (excluding GST).</li>
                  <li>2 months or less before event: No refund.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">Deferral & Category Change Policy</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Requests must be raised at least 60 days before event date through official channels.</li>
                  <li>Deferral is valid for 1 year from original event date, subject to policy and approval.</li>
                  <li>Only one approved deferral per entry is allowed.</li>
                  <li>Fee difference may apply when moving to a higher-priced category/event.</li>
                </ul>
                <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-semibold mb-1">Current System Service Fees</p>
                  <div className="space-y-3">
                    <div>
                      <p className="font-semibold">Triathlon</p>
                      <ul className="list-disc pl-6 space-y-1">
                        <li>Deferral Fee: {deferralInr} / {deferralUsd}</li>
                        <li>Category Change Fee: {categoryChangeInr} / {categoryChangeUsd}</li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-semibold">Swimathon (Sub-category Type)</p>
                      <ul className="list-disc pl-6 space-y-1">
                        <li>Deferral Fee: {swimDeferralInr} / {swimDeferralUsd}</li>
                        <li>Category Change Fee: {swimCategoryChangeInr} / {swimCategoryChangeUsd}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">Weather & Safety Disclaimer</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Race start may be delayed, route modified, or event cancelled for safety reasons.</li>
                  <li>If swim conditions are unsafe, the swim leg may be replaced with a run segment.</li>
                  <li>No outside pacing or unauthorized support is permitted.</li>
                  <li>Littering outside designated zones is prohibited.</li>
                  <li>Headphones and nudity outside changing areas are not allowed.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">Race Entry Rules</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Open to participants of all nationalities.</li>
                  <li>Minimum age (Sub-category-wise): Triathlon - {triathlonMinAge} years, Swimathon (Sub-category Type) - {swimathonMinAge} years and above on race day.</li>
                  <li>No bib swapping or identity misuse; violation can lead to disqualification and ban.</li>
                  <li>Organisers may reschedule/cancel due to force majeure or hazardous conditions.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">Athlete Check-in & Discipline</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Mandatory check-in and race briefing attendance are required.</li>
                  <li>Timing chip must be worn as instructed throughout the race.</li>
                  <li>Bike check-in and check-out must follow designated slots and controls.</li>
                  <li>Swim, bike, and run segments must follow discipline-specific safety and conduct rules.</li>
                </ul>
              </section>
            </div>
          </ScrollArea>
        </CardContent>

        <CardFooter className="border-t pt-6">
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
