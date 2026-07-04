
// src/components/admin/EmailCampaignsTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { 
    Mail, Loader2, Send, History, 
  Search, RefreshCw, TestTube2, Globe, Users, Building, FileUp,
    CheckCircle2, XCircle, Clock
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { 
    getCalendarEventsAction,
    getCampaignLogsAction,
    sendTestCampaignEmailAction
} from '@/lib/actions';
import type { EventCalendarEntry, CampaignLogEntry } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAuth } from '@/context/AuthContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { format, parseISO } from 'date-fns';

const EmailCampaignSchema = z.object({
  targetType: z.enum(['event', 'all_athletes', 'club_owners']),
  eventId: z.string().optional(),
  ticketIds: z.array(z.string()).default([]),
  excludeRegistered: z.boolean().default(false),
  subject: z.string().min(5, "Subject must be at least 5 characters long."),
  htmlContent: z.string().min(20, "Email content must be at least 20 characters long."),
  attachmentFile: z.instanceof(File).optional().nullable(),
  year: z.string().default(new Date().getFullYear().toString()),
});

type EmailCampaignFormInput = z.infer<typeof EmailCampaignSchema>;

export default function EmailCampaignsTab() {
  const { toast } = useToast();
  const { firebaseUserFromAuth } = useAuth();
  
  const [activeTab, setActiveTab] = useState('send');
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [logs, setLogs] = useState<CampaignLogEntry[]>([]);
  const [logStats, setLogStats] = useState<{ totalSent: number; sentToday: number }>({ totalSent: 0, sentToday: 0 });
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeJob, setActiveJob] = useState<{
    jobId: string;
    status: string;
    progress: number;
    emailsSent: number;
    emailsFailed: number;
    totalRecipients: number;
    errorMessage?: string | null;
  } | null>(null);
  const pollIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const form = useForm<EmailCampaignFormInput>({
    resolver: zodResolver(EmailCampaignSchema),
    defaultValues: { targetType: 'event', eventId: '', ticketIds: [], excludeRegistered: false, subject: '', htmlContent: '', attachmentFile: null },
  });

  const targetType = form.watch('targetType');
  const selectedEventId = form.watch('eventId');
  const excludeRegistered = form.watch('excludeRegistered');

  const selectedEvent = useMemo(() => 
    events.find(e => e.id === selectedEventId), 
  [events, selectedEventId]);

  const availableTickets = useMemo(() => 
    selectedEvent?.ticketDefinitions || [], 
  [selectedEvent]);

  const fetchData = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
        const [eRes, lRes] = await Promise.all([
            getCalendarEventsAction(),
            getCampaignLogsAction()
        ]);
        if (eRes.success) setEvents(eRes.events || []);
      if (lRes.success) {
        setLogs(lRes.logs || []);
        setLogStats(lRes.stats || { totalSent: 0, sentToday: 0 });
      }
    } catch (e) {
        console.error("Fetch failed:", e);
    } finally {
        setIsLoadingLogs(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const startPolling = useCallback((jobId: string, token: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/campaign-job/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success && data.job) {
          setActiveJob(prev => ({ ...(prev ?? { jobId, status: 'processing', progress: 0, emailsSent: 0, emailsFailed: 0, totalRecipients: 0 }), ...data.job }));
          if (data.job.status === 'completed' || data.job.status === 'failed') {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            fetchData();
          }
        }
      } catch (e) { /* ignore poll errors */ }
    };
    poll();
    pollIntervalRef.current = setInterval(poll, 3000);
  }, [fetchData]);

  const onSendCampaign = async (data: EmailCampaignFormInput) => {
    if (!firebaseUserFromAuth) return;
    
    if (data.targetType === 'event' && !data.excludeRegistered && data.ticketIds.length === 0) {
        toast({ variant: 'destructive', title: 'Targeting Error', description: 'Please select at least one ticket category to send to.' });
        return;
    }

    setIsSending(true);
    setActiveJob(null);
    try {
        const token = await firebaseUserFromAuth.getIdToken();

        let attachmentData: { filename: string; data: string; type: string } | undefined;
        if (data.attachmentFile) {
          const fileContent = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = reject;
            reader.readAsDataURL(data.attachmentFile!);
          });

          attachmentData = {
            filename: data.attachmentFile.name,
            data: fileContent.split(',')[1] || '',
            type: data.attachmentFile.type || 'application/octet-stream',
          };
        }

        const res = await fetch('/api/admin/send-campaign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                ...data,
                attachmentFile: undefined,
                attachment: attachmentData,
                ticketNames: data.ticketIds.map(id => availableTickets.find(t => t.id === id)?.ticketName).join(', '),
                eventName: selectedEvent?.eventName,
            }),
        });
        const result = await res.json();
        if (res.ok && result.success) {
            toast({ title: '🚀 Campaign Queued', description: result.message });
            form.reset();
            if (result.jobId) {
                setActiveJob({ jobId: result.jobId, status: 'queued', progress: 0, emailsSent: 0, emailsFailed: 0, totalRecipients: 0 });
                startPolling(result.jobId, token);
                setActiveTab('logs');
            }
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
    } finally {
        setIsSending(false);
    }
  };

  const handleSendTest = async () => {
    if (!testEmail || !z.string().email().safeParse(testEmail).success) {
      toast({ variant: 'destructive', title: 'Invalid Email', description: 'Please enter a valid test recipient email.' });
      return;
    }
    const { subject, htmlContent } = form.getValues();
    if (!subject || !htmlContent) {
      toast({ variant: 'destructive', title: 'Missing Content', description: 'Subject and content are required for test.' });
      return;
    }

    const attachmentFile = form.getValues('attachmentFile');
    let attachmentData: { filename: string; data: string; type: string } | null = null;
    if (attachmentFile) {
      try {
        const fileContent = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = reject;
          reader.readAsDataURL(attachmentFile);
        });
        attachmentData = {
          filename: attachmentFile.name,
          data: fileContent.split(',')[1] || '',
          type: attachmentFile.type || 'application/octet-stream',
        };
      } catch (e) {
        toast({ variant: 'destructive', title: 'Attachment Error', description: 'Failed to read attachment file.' });
        setIsSendingTest(false);
        return;
      }
    }

    setIsSendingTest(true);
    const result = await sendTestCampaignEmailAction(testEmail, subject, htmlContent, attachmentData);
    if (result.success) {
      toast({ title: 'Test Sent', description: `Check your inbox at ${testEmail}` });
    } else {
      toast({ variant: 'destructive', title: 'Test Failed', description: result.message });
    }
    setIsSendingTest(false);
  };

  const filteredLogs = useMemo(() => {
    if (!searchTerm) return logs;
    const lowerTerm = searchTerm.toLowerCase();
    return logs.filter(l => 
        l.recipientEmail?.toLowerCase().includes(lowerTerm) || 
        l.subject?.toLowerCase().includes(lowerTerm)
    );
  }, [logs, searchTerm]);

  const derivedLogStats = useMemo(() => {
    const successCount = logs.filter((log) => String(log.status || '').toLowerCase() === 'success').length;
    const failedCount = logs.filter((log) => String(log.status || '').toLowerCase() !== 'success').length;
    return {
      totalSent: logStats.totalSent || logs.length,
      sentToday: logStats.sentToday || 0,
      successCount,
      failedCount,
    };
  }, [logStats, logs]);

  return (
    <div className="space-y-6 text-left">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-muted/50 p-1 mb-4">
          <TabsTrigger value="send" className="gap-2 font-bold uppercase text-[10px] tracking-widest"><Mail className="h-4 w-4"/> New Broadcast</TabsTrigger>
          <TabsTrigger value="logs" className="gap-2 font-bold uppercase text-[10px] tracking-widest"><History className="h-4 w-4"/> Campaign History</TabsTrigger>
        </TabsList>

        <TabsContent value="send" className="animate-in fade-in duration-500">
          <Card className="border-none shadow-lg text-left">
            <CardHeader>
              <CardTitle className="text-xl font-black uppercase tracking-tight italic">Dispatch Email Broadcast</CardTitle>
              <CardDescription>Target race participants, all athletes, or club owners.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSendCampaign)} className="space-y-8 text-left">
                  
                  <FormField control={form.control} name="targetType" render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Target Audience Segment*</FormLabel>
                      <FormControl>
                        <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex flex-col sm:flex-row gap-6">
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl><RadioGroupItem value="event" id="tg-email-event" /></FormControl>
                            <Label htmlFor="tg-email-event" className="font-bold text-sm cursor-pointer">Event Participants</Label>
                          </FormItem>
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl><RadioGroupItem value="all_athletes" id="tg-email-all" /></FormControl>
                            <Label htmlFor="tg-email-all" className="font-bold text-sm cursor-pointer">All Verified Athletes</Label>
                          </FormItem>
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl><RadioGroupItem value="club_owners" id="tg-email-owners" /></FormControl>
                            <Label htmlFor="tg-email-owners" className="font-bold text-sm cursor-pointer">All Club Owners</Label>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                    </FormItem>
                  )} />

                  {targetType === 'event' && (
                    <div className="space-y-6 p-6 border-2 border-primary/10 bg-primary/5 rounded-2xl animate-in slide-in-from-top-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <FormField control={form.control} name="eventId" render={({ field }) => (
                                <FormItem><FormLabel className="text-[10px] font-black uppercase tracking-widest text-primary">1. Select Race Event*</FormLabel>
                                    <Select onValueChange={(v) => { field.onChange(v); form.setValue('ticketIds', []); }} value={field.value}>
                                        <FormControl><SelectTrigger className="rounded-xl h-11 bg-background font-bold"><SelectValue placeholder="Choose event..."/></SelectTrigger></FormControl>
                                        <SelectContent>
                                            {events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )} />
                            <div className="flex items-center space-x-3 pt-6">
                                <FormField control={form.control} name="excludeRegistered" render={({ field }) => (
                                    <FormItem className="flex items-center gap-2 space-y-0">
                                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange}/></FormControl>
                                        <FormLabel className="text-xs font-black uppercase text-primary">Target non-registered athletes</FormLabel>
                                    </FormItem>
                                )} />
                            </div>
                        </div>

                        {selectedEventId && !excludeRegistered && (
                            <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-300">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-primary">2. Target Specific Ticket Categories*</Label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {availableTickets.map(ticket => (
                                        <div key={ticket.id} className="flex items-center space-x-3 p-3 rounded-xl bg-background border border-primary/10 hover:border-primary/30 transition-all">
                                            <Checkbox 
                                                id={`ticket-${ticket.id}`} 
                                                checked={form.watch('ticketIds').includes(ticket.id)}
                                                onCheckedChange={(checked) => {
                                                    const current = form.getValues('ticketIds');
                                                    if (checked) form.setValue('ticketIds', [...current, ticket.id]);
                                                    else form.setValue('ticketIds', current.filter(id => id !== ticket.id));
                                                }}
                                            />
                                            <Label htmlFor={`ticket-${ticket.id}`} className="text-xs font-bold uppercase cursor-pointer flex-grow">{ticket.ticketName}</Label>
                                        </div>
                                    ))}
                                </div>
                                {availableTickets.length > 0 && (
                                    <div className="flex gap-2 pt-1">
                                        <button type="button" className="text-[10px] font-bold uppercase tracking-tighter text-primary" onClick={() => form.setValue('ticketIds', availableTickets.map(t => t.id))}>Select All</button>
                                        <button type="button" className="text-[10px] font-bold uppercase tracking-tighter text-primary" onClick={() => form.setValue('ticketIds', [])}>Clear All</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                  )}

                  <FormField control={form.control} name="subject" render={({ field }) => (
                    <FormItem><FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Email Subject Line*</FormLabel><FormControl><Input {...field} placeholder="e.g., Important Race Day Information for {{name}}" className="rounded-xl h-11 font-bold" /></FormControl><FormMessage/></FormItem>
                  )} />

                  <FormField control={form.control} name="htmlContent" render={({ field }) => (
                    <FormItem>
                        <div className="flex justify-between items-center mb-1 text-left">
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">HTML Email Body*</FormLabel>
                            <div className="flex flex-wrap gap-1">
                                {['name', 'bib_number', 'club_name', 'event_name'].map(p => (
                                    <Badge key={p} variant="outline" className="text-[9px] font-bold uppercase tracking-tighter">{"{{"}{p}{"}}"}</Badge>
                                ))}
                            </div>
                        </div>
                        <FormControl><Textarea {...field} rows={15} placeholder="<p>Hello {{name}},</p><p>Your BIB number for {{event_name}} is {{bib_number}}...</p>" className="rounded-xl font-mono text-xs leading-relaxed" /></FormControl><FormMessage/>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="attachmentFile" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Attachment (Optional)</FormLabel>
                      <div className="flex flex-col gap-3">
                        <Input
                          type="file"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            field.onChange(file);
                          }}
                          accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.gif,.zip"
                          className="h-10 rounded-xl cursor-pointer"
                        />
                        {form.watch('attachmentFile') && (
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2">
                            <FileUp className="h-4 w-4 text-blue-600" />
                            <span className="text-xs font-semibold text-blue-700">{form.watch('attachmentFile')?.name}</span>
                          </div>
                        )}
                        <p className="text-[9px] text-muted-foreground">Max size: 15 MB. Supported: PDF, DOC, DOCX, TXT, JPG, PNG, GIF, ZIP</p>
                      </div>
                    </FormItem>
                  )} />

                  <div className="p-4 border-t bg-muted/30 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4">
                      <div className="w-full sm:w-auto text-left">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Quick Test:</Label>
                          <div className="flex gap-2 mt-1 text-left">
                              <Input placeholder="test@email.com" value={testEmail} onChange={e => setTestEmail(e.target.value)} className="h-10 w-64" />
                              <Button type="button" variant="outline" onClick={handleSendTest} disabled={isSendingTest || !testEmail} className="h-10 px-6 font-bold uppercase text-xs rounded-xl">
                                  {isSendingTest ? <Loader2 className="animate-spin h-4 w-4" /> : <TestTube2 className="h-4 w-4 mr-2" />}
                                  Test
                              </Button>
                          </div>
                      </div>
                      <Button type="submit" disabled={isSending} className="w-full sm:w-auto h-12 px-10 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase tracking-widest text-sm shadow-xl">
                        {isSending ? <Loader2 className="animate-spin mr-3 h-5 w-5"/> : <Send className="mr-3 h-5 w-5"/>}
                        Dispatch Broadcast
                      </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="animate-in fade-in duration-500">
          <Card className="border-none shadow-lg">
            <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-left">
                    <div>
                        <CardTitle className="text-xl font-black uppercase tracking-tight">Campaign Logs</CardTitle>
                        <CardDescription>History of dispatched email broadcasts.</CardDescription>
                    </div>
                    <div className="relative w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Filter logs..." className="pl-8 h-9 text-xs" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-6">
                {activeJob && (
                  <div className={`rounded-2xl border p-4 space-y-3 ${
                    activeJob.status === 'completed' ? 'bg-green-50 border-green-200' :
                    activeJob.status === 'failed' ? 'bg-red-50 border-red-200' :
                    'bg-blue-50 border-blue-200 animate-pulse-subtle'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {activeJob.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-green-600" /> :
                         activeJob.status === 'failed' ? <XCircle className="h-5 w-5 text-red-600" /> :
                         <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />}
                        <span className="font-black uppercase text-xs tracking-widest">
                          {activeJob.status === 'completed' ? 'Campaign Completed' :
                           activeJob.status === 'failed' ? 'Campaign Failed' :
                           activeJob.status === 'queued' ? 'Campaign Queued…' :
                           'Sending in Background…'}
                        </span>
                      </div>
                      <button onClick={() => setActiveJob(null)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
                    </div>
                    {activeJob.status !== 'queued' && (
                      <Progress value={activeJob.progress} className="h-2" />
                    )}
                    <div className="flex gap-4 text-xs font-bold">
                      <span>Sent: <span className="text-green-700">{activeJob.emailsSent}</span></span>
                      <span>Failed: <span className="text-red-600">{activeJob.emailsFailed}</span></span>
                      {activeJob.totalRecipients > 0 && <span>Total: {activeJob.totalRecipients}</span>}
                      {activeJob.progress > 0 && <span>{activeJob.progress}%</span>}
                    </div>
                    {activeJob.errorMessage && <p className="text-xs text-red-600">{activeJob.errorMessage}</p>}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {[
                      { label: 'Total Sent', value: derivedLogStats.totalSent, color: 'text-slate-900' },
                      { label: 'Sent Today', value: derivedLogStats.sentToday, color: 'text-blue-600' },
                      { label: 'Successful', value: derivedLogStats.successCount, color: 'text-green-600' },
                      { label: 'Failed', value: derivedLogStats.failedCount, color: 'text-red-600' },
                    ].map((stat) => (
                      <div key={stat.label} className="rounded-2xl border bg-muted/20 p-4 text-left shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{stat.label}</div>
                        <div className={`mt-2 text-2xl font-black ${stat.color}`}>{stat.value}</div>
                      </div>
                    ))}
                </div>

                <div className="overflow-hidden rounded-xl border">
                <Table>
                    <TableHeader className="bg-muted/30">
                        <TableRow>
                            <TableHead className="font-bold uppercase text-[10px] text-left">Recipient</TableHead>
                            <TableHead className="font-bold uppercase text-[10px] text-left">Subject</TableHead>
                        <TableHead className="font-bold uppercase text-[10px] text-left">Attachment</TableHead>
                            <TableHead className="font-bold uppercase text-[10px] text-left">Status</TableHead>
                            <TableHead className="text-right font-bold uppercase text-[10px]">Date</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredLogs.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground italic">No logs match your filters.</TableCell></TableRow>
                        ) : filteredLogs.map(log => (
                            <TableRow key={log.id} className="hover:bg-muted/5 transition-colors text-left">
                                <TableCell>
                                    <div className="font-bold text-sm uppercase">{log.recipientName || 'Athlete'}</div>
                                    <div className="text-[10px] text-muted-foreground lowercase">{log.recipientEmail || ''}</div>
                                </TableCell>
                                <TableCell className="max-w-xs truncate text-xs font-medium">{log.subject || ''}</TableCell>
                          <TableCell>
                            <Badge variant={log.hasAttachment ? 'default' : 'secondary'} className="text-[9px] uppercase font-black">
                            {log.hasAttachment ? 'Yes' : 'No'}
                            </Badge>
                          </TableCell>
                                <TableCell><Badge variant={log.status === 'Success' ? 'default' : 'destructive'} className="text-[9px] uppercase font-black">{log.status}</Badge></TableCell>
                                <TableCell className="text-right text-[10px] text-muted-foreground">
                                    {log.sentAt ? format(parseISO(log.sentAt), 'MMM dd, p') : '—'}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
