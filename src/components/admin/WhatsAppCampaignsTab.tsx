// src/components/admin/WhatsAppCampaignsTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { 
    Send, Target, Plus, Trash2, 
    SwitchCamera, Loader2, Info, Clock, TestTube2, Image as ImageIcon, FileText, CheckCircle2, AlertCircle, AlertTriangle
} from 'lucide-react';
import type { EventCalendarEntry, WhatsAppCampaignFormInput } from '@/lib/types';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { WhatsAppCampaignSchema } from '@/lib/schemas';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/context/AuthContext';
import { Progress } from '../ui/progress';
import { ScrollArea } from '../ui/scroll-area';

export default function WhatsAppCampaignsTab() {
    const { toast } = useToast();
    const { firebaseUserFromAuth } = useAuth();
    const [events, setEvents] = useState<EventCalendarEntry[]>([]);
    const [isLoadingEvents, setIsLoadingEvents] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSendingTest, setIsSendingTest] = useState(false);
    const [testMobile, setTestMobile] = useState('');
    
    // Progress Tracking
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [jobStatus, setJobStatus] = useState<any>(null);

    const form = useForm<WhatsAppCampaignFormInput>({
        resolver: zodResolver(WhatsAppCampaignSchema),
        defaultValues: {
            targetType: 'event',
            campaignName: '',
            templateName: '',
            mediaUrl: '',
            mediaFilename: '',
            eventId: '',
            ticketIds: [],
            statusFilter: ['Active', 'Confirmed'],
            excludeRegistered: false,
            templateParams: [{ value: '{{name}}' }],
            throttling: { rate: 20, intervalSeconds: 2 } // Optimized for serverless
        },
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "templateParams"
    });

    const watchedTargetType = form.watch('targetType');
    const watchedEventId = form.watch('eventId');
    const watchedExcludeRegistered = form.watch('excludeRegistered');

    const selectedEvent = useMemo(() => 
        events.find(e => e.id === watchedEventId), 
    [events, watchedEventId]);

    const availableTickets = useMemo(() => 
        selectedEvent?.ticketDefinitions || [], 
  [selectedEvent]);

    useEffect(() => {
        setIsLoadingEvents(true);
        getCalendarEventsAction().then(res => {
            if (res.success && res.events) setEvents(res.events);
            setIsLoadingEvents(false);
        });
    }, []);

    // Polling for job status
    useEffect(() => {
        if (!activeJobId) return;

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/admin/upload-status/${activeJobId}`);
                if (res.ok) {
                    const data = await res.json();
                    setJobStatus(data);
                    if (data.status === 'completed' || data.status === 'failed') {
                        clearInterval(interval);
                        setActiveJobId(null);
                        if (data.status === 'completed') {
                            toast({ title: 'Broadcast Complete', description: data.message });
                        } else {
                            toast({ variant: 'destructive', title: 'Broadcast Failed', description: data.message });
                        }
                    }
                }
            } catch (e) {
                console.error("Polling failed", e);
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [activeJobId, toast]);

    const handleSelectAllTickets = () => {
        form.setValue('ticketIds', availableTickets.map(t => t.id));
    };

    const handleClearAllTickets = () => {
        form.setValue('ticketIds', []);
    };

    const handleSendTest = async () => {
        if (!testMobile || testMobile.length < 10) {
            toast({ variant: 'destructive', title: 'Invalid Mobile', description: 'Enter a valid 10-digit number for testing.' });
            return;
        }
        
        const values = form.getValues();
        if (!values.templateName) {
            toast({ variant: 'destructive', title: 'Missing Template', description: 'Template name is required for testing.' });
            return;
        }

        setIsSendingTest(true);
        try {
            console.log("[WhatsAppCampaignsTab] Dispatching test message...");
            const token = await firebaseUserFromAuth?.getIdToken();
            const res = await fetch('/api/admin/send-whatsapp-campaign', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ ...values, isTest: true, testMobile }),
            });
            const result = await res.json();
            if (result.success) {
                toast({ title: 'Test Sent', description: 'Check your phone for the message.' });
            } else {
                toast({ variant: 'destructive', title: 'Test Failed', description: result.message });
            }
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message });
        } finally {
            setIsSendingTest(false);
        }
    };

    async function onSubmit(values: WhatsAppCampaignFormInput) {
        if (!confirm("Are you sure you want to trigger this WhatsApp broadcast? This will be queued as a background job.")) return;
        
        setIsSubmitting(true);
        setJobStatus(null);
        try {
            console.log("[WhatsAppCampaignsTab] Initializing background broadcast job...");
            const token = await firebaseUserFromAuth?.getIdToken();

            const res = await fetch('/api/admin/send-whatsapp-campaign', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(values),
            });
            const data = await res.json();
            if (res.ok && data.success && data.jobId) {
                toast({ title: 'Broadcast Enqueued', description: 'Background delivery process started.' });
                setActiveJobId(data.jobId);
            } else {
                toast({ variant: 'destructive', title: 'Initialization Error', description: data.message || "Failed to start broadcast." });
            }
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Network Error', description: e.message });
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="space-y-6 text-left">
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 text-left">
                    <Card className="border-none shadow-xl">
                        <CardHeader className="bg-primary/5 border-b pb-6 text-left">
                            <CardTitle className="text-2xl font-black uppercase tracking-tight italic flex items-center gap-2 text-left">
                                <Send className="h-6 w-6 text-primary" /> WhatsApp Broadcast Studio
                            </CardTitle>
                            <CardDescription className="text-left">Dispatch highly-targeted mass messages via the AiSensy API.</CardDescription>
                        </CardHeader>
                        <CardContent className="pt-8 space-y-10 text-left">
                            
                            {/* PROGRESS TRACKER */}
                            {jobStatus && (
                                <div className="p-6 border-2 border-primary/20 rounded-2xl bg-primary/5 space-y-4 animate-in fade-in duration-500 text-left">
                                    <div className="flex justify-between items-center text-left">
                                        <div className="flex items-center gap-3 text-left">
                                            {jobStatus.status === 'processing' ? <Loader2 className="h-5 w-5 animate-spin text-primary"/> : jobStatus.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-green-600"/> : <AlertCircle className="h-5 w-5 text-destructive"/>}
                                            <h4 className="font-bold text-base text-primary uppercase tracking-tight text-left">
                                                {jobStatus.stage || "Initializing..."}
                                            </h4>
                                        </div>
                                        <Badge variant="outline" className="bg-background font-black">{Math.round(jobStatus.progress || 0)}%</Badge>
                                    </div>
                                    <Progress value={jobStatus.progress || 0} className="h-2" />
                                    <p className="text-xs text-muted-foreground font-medium text-left">{jobStatus.message}</p>
                                </div>
                            )}

                            <div className="space-y-6 text-left">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 text-left">
                                    <Target className="h-4 w-4" /> 1. Segmentation & Targeting
                                </h3>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                                    <FormField control={form.control} name="targetType" render={({ field }) => (
                                        <FormItem className="text-left">
                                            <FormLabel className="text-[10px] font-black uppercase text-left">Primary Audience Group</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl><SelectTrigger className="h-11 rounded-xl font-bold text-left"><SelectValue placeholder="Select group"/></SelectTrigger></FormControl>
                                                <SelectContent className="text-left">
                                                    <SelectItem value="event">Event Participants</SelectItem>
                                                    <SelectItem value="all_athletes">Global Athlete Database</SelectItem>
                                                    <SelectItem value="club_owners">All Club Owners</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )} />

                                    <FormField control={form.control} name="campaignName" render={({ field }) => (
                                        <FormItem className="text-left">
                                            <FormLabel className="text-[10px] font-black uppercase text-left">Internal Log Name</FormLabel>
                                            <FormControl><Input placeholder="e.g., Ozar 2026 Confirmation Reminder" className="h-11 rounded-xl font-bold text-left" {...field} /></FormControl>
                                        </FormItem>
                                    )} />
                                </div>

                                {watchedTargetType === 'event' && (
                                    <div className="p-6 border-2 border-primary/10 bg-primary/5 rounded-2xl animate-in slide-in-from-top-2 space-y-6 text-left">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                            <FormField control={form.control} name="eventId" render={({ field }) => (
                                                <FormItem className="text-left">
                                                    <FormLabel className="text-[10px] font-black uppercase text-primary text-left">Target Race Event*</FormLabel>
                                                    <Select onValueChange={(v) => { field.onChange(v); form.setValue('ticketIds', []); }} value={field.value || ""}>
                                                        <FormControl><SelectTrigger className="h-11 rounded-xl bg-background font-bold border-primary/20 text-left"><SelectValue placeholder="Choose event..."/></SelectTrigger></FormControl>
                                                        <SelectContent className="text-left">
                                                            {events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </FormItem>
                                            )} />
                                            
                                            <div className="flex items-center pt-6 text-left">
                                                <FormField control={form.control} name="excludeRegistered" render={({ field }) => (
                                                    <FormItem className="flex items-center gap-3 space-y-0 text-left">
                                                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange}/></FormControl>
                                                        <div className="space-y-0.5 text-left">
                                                            <FormLabel className="text-xs font-black uppercase text-primary text-left">Prospecting Mode</FormLabel>
                                                            <FormDescription className="text-[9px] uppercase font-bold text-muted-foreground text-left">Target athletes NOT registered for this race</FormDescription>
                                                        </div>
                                                    </FormItem>
                                                )} />
                                            </div>
                                        </div>

                                        {watchedEventId && !watchedExcludeRegistered && (
                                            <div className="space-y-4 animate-in fade-in duration-300 text-left">
                                                <div className="flex items-center justify-between text-left">
                                                    <Label className="text-[10px] font-black uppercase tracking-widest text-primary text-left">Target Specific Ticket Categories*</Label>
                                                    <div className="flex gap-3 text-left">
                                                        <button type="button" onClick={handleSelectAllTickets} className="text-[10px] font-black uppercase tracking-tighter text-primary hover:underline">Select All</button>
                                                        <button type="button" onClick={handleClearAllTickets} className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground hover:underline">Clear All</button>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-left">
                                                    {availableTickets.map(ticket => (
                                                        <div key={ticket.id} className="flex items-center space-x-3 p-3 rounded-xl bg-background border border-primary/10 hover:border-primary/30 transition-all text-left">
                                                            <Checkbox 
                                                                id={`wa-ticket-${ticket.id}`} 
                                                                checked={form.watch('ticketIds')?.includes(ticket.id)}
                                                                onCheckedChange={(checked) => {
                                                                    const current = form.getValues('ticketIds') || [];
                                                                    if (checked) form.setValue('ticketIds', [...current, ticket.id]);
                                                                    else form.setValue('ticketIds', current.filter(id => id !== ticket.id));
                                                                }}
                                                            />
                                                            <Label htmlFor={`wa-ticket-${ticket.id}`} className="text-xs font-bold uppercase cursor-pointer flex-grow truncate text-left">{ticket.ticketName}</Label>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <Separator />

                            <div className="space-y-6 text-left">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 text-left">
                                    <SwitchCamera className="h-4 w-4" /> 2. AiSensy Template & Media Config
                                </h3>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 text-left">
                                    <div className="space-y-6 text-left">
                                        <FormField control={form.control} name="templateName" render={({ field }) => (
                                            <FormItem className="text-left">
                                                <FormLabel className="text-[10px] font-black uppercase text-left">Official Template Name*</FormLabel>
                                                <FormControl><Input placeholder="Exact name from AiSensy dashboard" className="h-11 rounded-xl font-mono uppercase font-bold text-left" {...field} /></FormControl>
                                                <FormDescription className="text-[9px] font-bold text-left">Must match your approved template name exactly.</FormDescription>
                                            </FormItem>
                                        )} />

                                        <div className="p-6 border-2 border-dashed rounded-2xl bg-muted/20 space-y-4 text-left">
                                            <Label className="text-xs font-bold uppercase flex items-center gap-2 text-left">
                                                <ImageIcon className="h-4 w-4 text-primary" /> Media Attachment (Optional)
                                            </Label>
                                            <FormField control={form.control} name="mediaUrl" render={({ field }) => (
                                                <FormItem className="text-left">
                                                    <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Direct URL (Image/PDF)</FormLabel>
                                                    <FormControl><Input placeholder="https://storage.googleapis.com/..." className="text-xs font-mono h-9 text-left" {...field} value={field.value || ""} /></FormControl>
                                                </FormItem>
                                            )} />
                                            <FormField control={form.control} name="mediaFilename" render={({ field }) => (
                                                <FormItem className="text-left">
                                                    <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Filename Appearance</FormLabel>
                                                    <FormControl><Input placeholder="e.g., event_guide.pdf" className="text-xs h-9 text-left" {...field} value={field.value || ""} /></FormControl>
                                                </FormItem>
                                            )} />
                                        </div>
                                    </div>

                                    <div className="space-y-4 text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Dynamic Parameters (in order)</Label>
                                        <p className="text-[9px] font-bold text-primary uppercase text-left">Each box below replaces {"{{1}}"}, {"{{2}}"}, etc. in your AiSensy template.</p>
                                        <div className="space-y-2 text-left">
                                            {fields.map((field, index) => (
                                                <div key={field.id} className="flex gap-2 animate-in slide-in-from-right-2 text-left">
                                                    <Badge variant="outline" className="h-10 w-14 shrink-0 font-black text-xs bg-muted/30">
                                                        {"{{"}{index + 1}{"}}"}
                                                    </Badge>
                                                    <FormField control={form.control} name={`templateParams.${index}.value`} render={({ field }) => (
                                                        <FormControl><Input placeholder="Placeholder or static text" className="h-10 font-bold text-left" {...field} /></FormControl>
                                                    )} />
                                                    <Button type="button" variant="ghost" size="icon" className="text-destructive h-10 w-10" onClick={() => remove(index)}><Trash2 className="h-4 w-4"/></Button>
                                                </div>
                                            ))}
                                            <Button type="button" variant="outline" size="sm" className="w-full mt-2 border-dashed rounded-xl h-10 font-bold" onClick={() => append({ value: '' })}>
                                                <Plus className="mr-2 h-4 w-4" /> Add Next Parameter
                                            </Button>
                                        </div>
                                        <div className="p-3 rounded-lg bg-primary/5 border border-dashed border-primary/30 flex items-start gap-2 text-left">
                                            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                                            <div className="text-[9px] font-bold text-muted-foreground uppercase leading-tight text-left">
                                                Use these tokens for personalization: <br/>
                                                <span className="text-primary">{"{{name}}"}, {"{{bib_number}}"}, {"{{ticket_name}}"}, {"{{event_name}}"}, {"{{booking_id}}"}, {"{{mobile}}"}, {"{{email}}"}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            <div className="space-y-6 text-left">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 text-left">
                                    <Clock className="h-4 w-4" /> 3. Delivery & Scheduling
                                </h3>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 items-end text-left">
                                    <FormField control={form.control} name="scheduledAt" render={({ field }) => (
                                        <FormItem className="text-left">
                                            <FormLabel className="text-[10px] font-black uppercase text-left">Schedule Release (Optional)</FormLabel>
                                            <FormControl><Input type="datetime-local" className="h-11 rounded-xl text-left" {...field} value={field.value || ""} /></FormControl>
                                            <FormDescription className="text-[9px] font-bold text-left">Leave blank for immediate dispatch.</FormDescription>
                                        </FormItem>
                                    )} />

                                    <FormField control={form.control} name="throttling.rate" render={({ field }) => (
                                        <FormItem className="text-left">
                                            <FormLabel className="text-[10px] font-black uppercase text-left">Messages per batch</FormLabel>
                                            <FormControl><Input type="number" className="h-11 rounded-xl font-bold text-left" {...field} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl>
                                        </FormItem>
                                    )} />

                                    <FormField control={form.control} name="throttling.intervalSeconds" render={({ field }) => (
                                        <FormItem className="text-left">
                                            <FormLabel className="text-[10px] font-black uppercase text-left">Cooldown (Seconds)</FormLabel>
                                            <FormControl><Input type="number" className="h-11 rounded-xl font-bold text-left" {...field} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl>
                                        </FormItem>
                                    )} />
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="bg-muted/30 border-t p-8 flex flex-col sm:flex-row justify-between items-center gap-6 text-left">
                            <div className="w-full sm:w-auto text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 mb-2 text-left">
                                    <TestTube2 className="h-3 w-3" /> Quick Sandbox Test
                                </Label>
                                <div className="flex gap-2 text-left">
                                    <Input 
                                        placeholder="Mobile (+91...)" 
                                        className="h-11 w-64 rounded-xl font-bold text-left"
                                        value={testMobile}
                                        onChange={e => setTestMobile(e.target.value)}
                                    />
                                    <Button 
                                        type="button" 
                                        variant="secondary" 
                                        className="h-11 px-6 rounded-xl font-black uppercase text-[10px] tracking-widest text-left"
                                        onClick={handleSendTest}
                                        disabled={isSendingTest || !testMobile}
                                    >
                                        {isSendingTest ? <Loader2 className="animate-spin h-4 w-4" /> : <TestTube2 className="h-4 w-4 mr-2" />}
                                        Send Test
                                    </Button>
                                </div>
                            </div>

                            <Button type="submit" disabled={isSubmitting || !!activeJobId} className="h-14 px-12 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-base shadow-2xl shadow-primary/20 text-left">
                                {isSubmitting ? <Loader2 className="mr-3 h-6 w-6 animate-spin"/> : <Send className="mr-3 h-6 w-6"/>}
                                Initialize Broadcast
                            </Button>
                        </CardFooter>
                    </Card>
                </form>
            </Form>
        </div>
    );
}
