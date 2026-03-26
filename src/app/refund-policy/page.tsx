// src/app/refund-policy/page.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export default function RefundPolicyPage() {
  const router = useRouter();
  const refundContent = `
Return / Refund / Cancellation Policy – Bergman Triathlon

1. **Refund Policy**
- 6+ months before event: 70% refund (excluding GST and processing charges).
- 4 months before event: 50% refund (excluding GST).
- 3 months before event: 20% refund (excluding GST).
- 2 months or less before event: No refund.
- Refunds are processed within 15 working days of cancellation request approval.

2. **Deferral Policy**
- Deferral requests must be submitted 60 days prior to the event using the official form.
- Only one deferral per entry is allowed. The participant must pay any entry fee difference when transferring to a future event.
- Deferral fee: ₹2,499
- Deferral is valid for 1 year from the original event date.

3. **Transfer & Category Change**
- Name transfers and category changes are allowed up to 60 days before the event.
- Name change: ₹2,499
- Category change (lower or higher): ₹2,499 + fee difference (if applicable)
- No refunds for switching to a lower category.

4. **No Show / Force Majeure**
- No refunds or transfers will be granted in the event of no-show or event cancellation due to natural calamities, political unrest, or unforeseen circumstances beyond the control of the organizers.
  `;

  return (
    <div className="container mx-auto py-12 px-4 max-w-4xl">
      <Card className="max-w-3xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-primary">Return, Refund & Cancellation Policy – Bergman Triathlon</CardTitle>
          <CardDescription className="text-md text-muted-foreground pt-1">Details on refunds, deferrals, and transfers.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[60vh] pr-4">
             <div className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none text-foreground">
              {refundContent.split('\n').map((paragraph, index) => {
                const trimmed = paragraph.trim();
                if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
                   return <h2 key={index} className="font-semibold text-xl mt-6 mb-3 text-primary">{trimmed.substring(2, trimmed.length - 2)}</h2>;
                } else if (trimmed.match(/^\d+\.\s\*\*/)) { 
                  const titleContent = trimmed.substring(trimmed.indexOf('**') + 2, trimmed.lastIndexOf('**'));
                  return <h3 key={index} className="font-medium text-lg mt-4 mb-1.5">{`${trimmed.substring(0, trimmed.indexOf('**'))} ${titleContent}`}</h3>;
                } else if (trimmed.match(/^\d+\.\s/)) { 
                  return <h3 key={index} className="font-medium text-lg mt-4 mb-1.5">{trimmed}</h3>;
                } else if (trimmed.startsWith('- ')) {
                  return <li key={index} className="ml-6 list-disc my-1">{trimmed.substring(2)}</li>;
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
