// src/components/admin/ClubCommunicationTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Mail, Loader2, Send, TestTube2 } from 'lucide-react';
import type { User } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { useAuth } from '@/context/AuthContext';
import { sendTestCampaignEmailAction } from '@/lib/actions/emailActions';

const MIN_YEAR_FOR_STATS = 2023;

const ClubOwnerCampaignSchema = z.object({
  subject: z.string().min(5, "Subject must be at least 5 characters long."),
  htmlContent: z.string().min(20, "Email content must be at least 20 characters long."),
  year: z.string().min(4, "Please select a year."),
});
type ClubOwnerCampaignFormInput = z.infer<typeof ClubOwnerCampaignSchema>;

export default function ClubCommunicationTab() {
  const { toast } = useToast();
  const { firebaseUserFromAuth } = useAuth();
  const [isSendingCampaign, setIsSendingCampaign] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testEmail, setTestEmail] = useState('');

  const currentYear = new Date().getFullYear();
  const availableYearsForAdmin = useMemo(() => {
    const years = [];
    for (let y = currentYear; y >= MIN_YEAR_FOR_STATS; y--) {
      years.push(y.toString());
    }
    return years;
  }, [currentYear]);

  const clubOwnerCampaignForm = useForm<ClubOwnerCampaignFormInput>({
    resolver: zodResolver(ClubOwnerCampaignSchema),
    defaultValues: { subject: '', htmlContent: '', year: new Date().getFullYear().toString() },
  });

  const onSendClubOwnerCampaign = async (data: ClubOwnerCampaignFormInput) => {
    if (!firebaseUserFromAuth) return toast({ variant: 'destructive', title: 'Authentication Error' });
    setIsSendingCampaign(true);
    try {
        const token = await firebaseUserFromAuth.getIdToken();
        const response = await fetch('/api/admin/send-campaign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ ...data, targetType: 'club_owners' }) // Specify target
        });
        const result = await response.json();
        if(response.ok) toast({ title: 'Campaign Sent!', description: result.message });
        else toast({ variant: 'destructive', title: 'Campaign Failed', description: result.message });
        clubOwnerCampaignForm.reset();
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
        setIsSendingCampaign(false);
    }
  };

  const handleSendTestClubOwnerEmail = async () => {
    if (!testEmail || !z.string().email().safeParse(testEmail).success) {
      return toast({ variant: 'destructive', title: 'Invalid Test Email' });
    }
    const { subject, htmlContent } = clubOwnerCampaignForm.getValues();
    if (!subject || !htmlContent) {
      return toast({ variant: 'destructive', title: 'Missing Content', description: 'Subject and body are required.' });
    }
    setIsSendingTest(true);
    const result = await sendTestCampaignEmailAction(testEmail, subject, htmlContent, null);
    if(result.success) {
      toast({title: 'Test Sent', description: `Test email sent to ${testEmail}.`});
    } else {
      toast({ variant: 'destructive', title: 'Test Failed', description: result.message });
    }
    setIsSendingTest(false);
  };
  
  return (
    <Card className="border-green-600/30 bg-green-600/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-green-700"/>Club Owner Communication</CardTitle>
        <CardDescription>Send a bulk email to all registered club owners.</CardDescription>
      </CardHeader>
      <CardContent>
          <Form {...clubOwnerCampaignForm}>
              <form onSubmit={clubOwnerCampaignForm.handleSubmit(onSendClubOwnerCampaign)} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={clubOwnerCampaignForm.control} name="year" render={({ field }) => (
                        <FormItem><FormLabel>Ranking Year for Placeholders</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select Year..." /></SelectTrigger></FormControl>
                            <SelectContent>{availableYearsForAdmin.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}</SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={clubOwnerCampaignForm.control} name="subject" render={({ field }) => (<FormItem><FormLabel>Subject</FormLabel><Input {...field} placeholder="e.g., Your Club's {{year}} Performance" disabled={isSendingCampaign || isSendingTest} /><FormMessage /></FormItem>)} />
                  </div>
                  <FormField
                    control={clubOwnerCampaignForm.control}
                    name="htmlContent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Body</FormLabel>
                        <Textarea
                          {...field}
                          placeholder="Dear {{owner_name}}, your club {{club_name}} ranked {{club_rank}} with {{club_points}} points in {{year}}."
                          rows={8}
                          disabled={isSendingCampaign || isSendingTest}
                        />
                        <FormDescription className="text-xs">
                          Placeholders: `owner_name`, `club_name`, `club_rank`, `club_points`, `year`. Basic HTML is supported.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <CardFooter className="flex flex-col sm:flex-row justify-between items-center gap-4 p-0 pt-4">
                      <div className="w-full sm:w-auto">
                          <Label htmlFor="test-email-input" className="text-xs">Send Test To:</Label>
                          <div className="flex gap-2">
                              <Input id="test-email-input" type="email" placeholder="test.recipient@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} disabled={isSendingTest || isSendingCampaign} className="h-9"/>
                              <Button type="button" variant="outline" size="sm" onClick={handleSendTestClubOwnerEmail} disabled={isSendingTest || isSendingCampaign || !testEmail}>
                                  {isSendingTest ? <Loader2 className="animate-spin h-4 w-4"/> : <TestTube2 className="h-4 w-4"/>}<span className="ml-2 hidden sm:inline">Test</span>
                              </Button>
                          </div>
                      </div>
                      <Button type="submit" size="sm" className="w-full sm:w-auto bg-green-700 hover:bg-green-800 text-white" disabled={isSendingCampaign || isSendingTest}>
                          {isSendingCampaign ? <Loader2 className="animate-spin h-4 w-4"/> : <Send className="h-4 w-4"/>}<span className="ml-2">Send to All Owners</span>
                      </Button>
                  </CardFooter>
              </form>
          </Form>
      </CardContent>
    </Card>
  );
}
