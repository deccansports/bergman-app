// src/app/privacy-policy/page.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export default function PrivacyPolicyPage() {
  const router = useRouter();
  const privacyContent = `
Privacy Policy – Bergman Triathlon

1. **Information We Collect**
During registration, we collect personal data such as your name, age, gender, email, phone number, emergency contact, and relevant medical information.

2. **How We Use Your Information**
To manage event logistics, athlete tracking, safety protocols, timing, and post-race results.
To send important race updates, confirmations, or emergency information.
For post-race communications such as photos, certificates, or upcoming event announcements.

3. **Data Security**
We implement industry-standard security measures to protect your personal data and ensure it is not shared with third parties without consent (except race partners like timing teams, medical providers, or legal authorities if required).

4. **Cookies & Tracking**
Our website may use cookies to enhance user experience and track analytics. You can manage cookie settings via your browser.
  `;

  return (
    <div className="container mx-auto py-12 px-4 max-w-4xl">
      <Card className="max-w-3xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-primary">Privacy Policy – Bergman Triathlon</CardTitle>
          <CardDescription className="text-md text-muted-foreground pt-1">How we handle your data.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[60vh] pr-4">
             <div className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none text-foreground">
              {privacyContent.split('\n').map((paragraph, index) => {
                const trimmed = paragraph.trim();
                if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
                  return <h2 key={index} className="font-semibold text-xl mt-6 mb-3 text-primary">{trimmed.substring(2, trimmed.length - 2)}</h2>;
                } else if (trimmed.match(/^\d+\.\s\*\*/)) { 
                  const titleContent = trimmed.substring(trimmed.indexOf('**') + 2, trimmed.lastIndexOf('**'));
                  return <h3 key={index} className="font-medium text-lg mt-4 mb-1.5">{`${trimmed.substring(0, trimmed.indexOf('**'))} ${titleContent}`}</h3>;
                } else if (trimmed.match(/^\d+\.\s/)) { 
                  return <h3 key={index} className="font-medium text-lg mt-4 mb-1.5">{trimmed}</h3>;
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
