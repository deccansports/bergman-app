import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { getServiceFeesAction } from '@/lib/actions';

const formatInr = (paisa: number) => `₹${(paisa / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatUsd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function RefundPolicyPage() {
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
      <Card className="max-w-3xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-primary">Return, Refund & Cancellation Policy – Bergman Triathlon</CardTitle>
          <CardDescription className="text-md text-muted-foreground pt-1">Details on refunds, deferrals, and category changes.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[60vh] pr-4">
            <div className="space-y-6 text-sm sm:text-base leading-7">
              <section>
                <h3 className="text-lg font-semibold mb-2">1. Refund Policy</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>If cancelled within 48 hours of registration: 90% refund (excluding GST).</li>
                  <li>6+ months before event: 70% refund (excluding GST and processing charges and platform fees).</li>
                  <li>4 months before event: 50% refund (excluding GST).</li>
                  <li>3 months before event: 20% refund (excluding GST).</li>
                  <li>2 months or less before event: No refund.</li>
                  <li>Approved refunds are processed within 15 working days.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">2. Deferral Policy</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Deferral requests must be submitted at least 60 days before event date.</li>
                  <li>Only one deferral per entry is allowed, subject to approval.</li>
                  <li>Fee difference may apply when moving to a higher-priced event/category.</li>
                  <li>Deferral validity: 1 year from original event date.</li>
                </ul>
                <p className="mt-2"><strong>Deferral Fee:</strong> {deferralInr} / {deferralUsd}</p>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">3. Category Change</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Category change requests are allowed up to 60 days before event date.</li>
                  <li>
                    Triathlon Fees: Deferral {deferralInr} / {deferralUsd}, Category Change {categoryChangeInr} / {categoryChangeUsd}
                  </li>
                  <li>
                    Swimathon (Sub-category Type) Fees: Deferral {swimDeferralInr} / {swimDeferralUsd}, Category Change {swimCategoryChangeInr} / {swimCategoryChangeUsd}
                  </li>
                  <li>No fee-difference refund applies when switching to a lower category.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">4. No Show / Force Majeure</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>No refund/transfer in case of no-show.</li>
                  <li>No refund if event is cancelled due to force majeure, natural calamity, safety risk, or regulatory restriction.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-lg font-semibold mb-2">5. Age Eligibility</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Triathlon minimum age: {triathlonMinAge} years on race day.</li>
                  <li>Swimathon (Sub-category Type) minimum age: {swimathonMinAge} years and above on race day.</li>
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
