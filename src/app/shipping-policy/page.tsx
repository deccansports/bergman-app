// src/app/shipping-policy/page.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export default function ShippingPolicyPage() {
  const router = useRouter();
  const shippingContent = `
Shipping Policy – Bergman Triathlon

1. **Event-Related Deliverables**
- Race kits must be collected in person during athlete check-in. No race kits will be shipped unless specified for virtual participation.
- E-certificates, race results, and official photos will be sent via email after the event.

2. **Bergman Apparel & Merchandise**
We offer Bergman-branded apparel and merchandise through our official store.
**Shipping:**
- Orders are shipped within 5–7 business days after confirmation.
- Tracking details will be shared via email or SMS once dispatched.
- Delivery timelines may vary by location.
**Exchange Policy:**
Products can only be exchanged if:
- The wrong size was shipped.
- The product is defective or damaged on arrival.
- Exchange must be requested within 7 days of delivery with valid proof (photo/video) sent to our support team.
**Non-Exchangeable Conditions:**
No exchanges or returns will be accepted if:
- The product has been used.
- Original tags are broken or removed.
- The product was damaged due to improper use or washing.
**Refunds:**
- No refunds are provided for apparel or merchandise purchases unless the product is out of stock or cannot be exchanged.

3. **Undelivered / Returned Items**
- If a shipment is returned due to an incorrect address or failure to receive, the customer must bear re-shipping costs.
- If the item is undeliverable and unclaimed for over 15 days, the order will be considered closed.
  `;

  return (
    <div className="container mx-auto py-12 px-4 max-w-4xl">
      <Card className="max-w-3xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-primary">Shipping Policy – Bergman Triathlon</CardTitle>
          <CardDescription className="text-md text-muted-foreground pt-1">Information about deliverables and merchandise.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[60vh] pr-4">
            <div className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none text-foreground">
              {shippingContent.split('\n').map((paragraph, index) => {
                const trimmed = paragraph.trim();
                 if (trimmed.startsWith('**') && trimmed.endsWith('**')) { // Main section titles
                  return <h2 key={index} className="font-semibold text-xl mt-6 mb-3 text-primary">{trimmed.substring(2, trimmed.length - 2)}</h2>;
                } else if (trimmed.match(/^\d+\.\s\*\*/)) { // Numbered list items that are also bolded sub-titles
                  const titleContent = trimmed.substring(trimmed.indexOf('**') + 2, trimmed.lastIndexOf('**'));
                  return <h3 key={index} className="font-medium text-lg mt-4 mb-1.5">{`${trimmed.substring(0, trimmed.indexOf('**'))} ${titleContent}`}</h3>;
                } else if (trimmed.match(/^\d+\.\s/)) { // Simple numbered list items
                  return <h3 key={index} className="font-medium text-lg mt-4 mb-1.5">{trimmed}</h3>;
                } else if (trimmed.startsWith('- ')) { // Bullet points
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
