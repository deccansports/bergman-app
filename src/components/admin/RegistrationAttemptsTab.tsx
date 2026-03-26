// src/components/admin/RegistrationAttemptsTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { RegistrationAttempt, EventCalendarEntry, ReminderInfo } from '@/lib/types';
import { getRegistrationAttemptsAction, sendIncompleteRegistrationNoticeAction, deleteRegistrationAttemptAction } from '@/lib/actions'; 
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Search, Mail, MessageSquare, Target, Trash2, Info } from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';


interface RegistrationAttemptsTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

const statusVariantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  Potential: 'outline',
  PaymentInitiated: 'secondary',
  PaymentCaptured: 'secondary',
  'Payment Failed': 'destructive',
  Completed: 'default',
  RegistrationFailed: 'destructive',
};

const MAX_REMINDERS_POTENTIAL = 2;
const MAX_REMINDERS_PAYMENT_INITIATED = 4;

export default function RegistrationAttemptsTab({ events, isLoadingEvents }: RegistrationAttemptsTabProps) {
  const { toast } = useToast();
  const [attempts, setAttempts] = useState<RegistrationAttempt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSendingNotif, setIsSendingNotif] = useState<{ type: 'email' | 'whatsapp', attemptId: string } | null>(null);
  const [isDeletingAttemptId, setIsDeletingAttemptId] = useState<string | null>(null);

  const fetchAttempts = useCallback(async (eventId?: string) => {
    setIsLoading(true);
    try {
      const result = await getRegistrationAttemptsAction(eventId || undefined);
      if (result.success && result.attempts) {
        setAttempts(result.attempts);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch registration attempts.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAttempts(selectedEventId || undefined);
  }, [selectedEventId, fetchAttempts]);

  const filteredAttempts = useMemo(() => {
    return attempts.filter(attempt => {
        const term = searchTerm.toLowerCase();
        return !term ||
            attempt.name.toLowerCase().includes(term) ||
            attempt.email.toLowerCase().includes(term) ||
            (attempt.mobile && attempt.mobile.includes(term));
    });
  }, [attempts, searchTerm]);

  const handleSendNotification = async (channel: 'email' | 'whatsapp', attempt: RegistrationAttempt) => {
    setIsSendingNotif({ type: channel, attemptId: attempt.id });
    try {
        const event = events.find(e => e.id === attempt.eventId);
        const redirectUrl = event?.customSlug ? `${window.location.origin}/event-form/${event.customSlug}` : null;
        
        const result = await sendIncompleteRegistrationNoticeAction(
          attempt.name,
          channel === 'email' ? attempt.email : null,
          attempt.eventName,
          redirectUrl,
          channel === 'whatsapp' ? (attempt.mobile ?? null) : null
      );

      if (result.success) {
        toast({ title: 'Success', description: result.message });
        fetchAttempts(selectedEventId || undefined);
      } else {
        toast({ variant: 'destructive', title: 'Failed', description: result.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'An unexpected error occurred.' });
    } finally {
      setIsSendingNotif(null);
    }
  };

  const handleDeleteAttempt = async (attemptId: string) => {
    setIsDeletingAttemptId(attemptId);
    try {
      const result = await deleteRegistrationAttemptAction(attemptId);
      if (result.success) {
        toast({ title: 'Success', description: result.message });
        setAttempts(prev => prev.filter(a => a.id !== attemptId));
      } else {
        toast({ variant: 'destructive', title: 'Failed', description: result.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Could not delete the attempt.' });
    } finally {
      setIsDeletingAttemptId(null);
    }
  };


  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-primary"/>Incomplete Registrations</CardTitle>
          <CardDescription>Track users who started but did not complete registration. Use the action buttons to send them a follow-up reminder.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select onValueChange={(value) => setSelectedEventId(value === 'all' ? null : value)} disabled={isLoadingEvents}>
                  <SelectTrigger><SelectValue placeholder="Filter by Event..." /></SelectTrigger>
                  <SelectContent>
                      <SelectItem value="all">All Events</SelectItem>
                      {events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
                  </SelectContent>
              </Select>
              <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search name, email, mobile..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
              </div>
          </div>
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Athlete</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead>Reminders Sent</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center h-24"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary"/></TableCell></TableRow>
                ) : filteredAttempts.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">No incomplete registrations found.</TableCell></TableRow>
                ) : (
                  filteredAttempts.map(attempt => {
                    const reminders = attempt.remindersSent || { email: { count: 0, dates: [] }, whatsapp: { count: 0, dates: [] } };
                    const emailCount = reminders.email?.count || 0;
                    const whatsappCount = reminders.whatsapp?.count || 0;
                    const totalRemindersSent = emailCount + whatsappCount;
                    const statusKey = (attempt.status as string) === 'pending' ? 'pending' : (attempt.status || 'Potential');
                    const maxReminders = statusKey === 'Potential' || statusKey === 'pending' ? MAX_REMINDERS_POTENTIAL : MAX_REMINDERS_PAYMENT_INITIATED;
                    const canSendMore = totalRemindersSent < maxReminders;
                    const updatedAtDate = attempt.updatedAt ? (typeof attempt.updatedAt === 'string' ? parseISO(attempt.updatedAt) : attempt.updatedAt) : null;

                    return (
                      <TableRow key={attempt.id}>
                        <TableCell>
                          <div className="font-medium">{attempt.name}</div>
                          <div className="text-xs text-muted-foreground">{attempt.email}</div>
                          <div className="text-xs text-muted-foreground">{attempt.mobile || 'No mobile'}</div>
                        </TableCell>
                        <TableCell>
                            <div className="font-medium">{attempt.eventName}</div>
                            <div className="text-xs text-muted-foreground">{attempt.ticketName}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariantMap[statusKey] || 'secondary'}>{statusKey}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                           {updatedAtDate && isValid(updatedAtDate) ? format(updatedAtDate, 'MMM dd, yyyy p') : 'N/A'}
                        </TableCell>
                         <TableCell className="text-xs">
                           <Popover>
                             <PopoverTrigger asChild>
                               <Button variant="ghost" size="sm" className="flex items-center gap-2 cursor-pointer h-auto p-1 text-xs">
                                 <Mail className="h-3.5 w-3.5 text-muted-foreground" /> {emailCount}
                                 <MessageSquare className="h-3.5 w-3.5 text-muted-foreground ml-2" /> {whatsappCount}
                               </Button>
                             </PopoverTrigger>
                             <PopoverContent className="w-60 text-xs">
                               <div className="space-y-2">
                                 <p className="font-semibold">Reminder History</p>
                                 <div>
                                   <p><strong>Email ({emailCount}):</strong></p>
                                   {reminders?.email?.dates?.length > 0 ? (
                                     <ul className="list-disc pl-4">{reminders.email.dates.map((d: string, i: number) => <li key={`e-${i}`}>{format(parseISO(d), 'MMM dd, yyyy')}</li>)}</ul>
                                   ) : <p className="text-muted-foreground">None sent.</p>}
                                 </div>
                                 <div>
                                   <p><strong>WhatsApp ({whatsappCount}):</strong></p>
                                   {reminders?.whatsapp?.dates?.length > 0 ? (
                                     <ul className="list-disc pl-4">{reminders.whatsapp.dates.map((d: string, i: number) => <li key={`w-${i}`}>{format(parseISO(d), 'MMM dd, yyyy')}</li>)}</ul>
                                   ) : <p className="text-muted-foreground">None sent.</p>}
                                 </div>
                                 <p className="text-muted-foreground pt-1 border-t">Max reminders for this status: {maxReminders}.</p>
                               </div>
                             </PopoverContent>
                           </Popover>
                         </TableCell>
                        <TableCell className="space-x-1 text-right">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span>
                                            <Button size="xs" variant="outline" onClick={() => handleSendNotification('email', attempt)} disabled={isSendingNotif?.attemptId === attempt.id || isDeletingAttemptId === attempt.id || !canSendMore}>
                                                {isSendingNotif?.type === 'email' && isSendingNotif?.attemptId === attempt.id ? <Loader2 className="h-3 w-3 animate-spin"/> : <Mail className="h-3 w-3" />}
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{canSendMore ? 'Send Email Reminder' : 'Reminder limit reached.'}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                                 <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span>
                                            <Button size="xs" variant="outline" onClick={() => handleSendNotification('whatsapp', attempt)} disabled={!attempt.mobile || isSendingNotif?.attemptId === attempt.id || isDeletingAttemptId === attempt.id || !canSendMore}>
                                               {isSendingNotif?.type === 'whatsapp' && isSendingNotif?.attemptId === attempt.id ? <Loader2 className="h-3 w-3 animate-spin"/> : <MessageSquare className="h-3 w-3" />}
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{!attempt.mobile ? 'No mobile number' : canSendMore ? 'Send WhatsApp Reminder' : 'Reminder limit reached.'}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button size="xs" variant="ghost" className="text-destructive/70 hover:text-destructive" disabled={isDeletingAttemptId === attempt.id || !!isSendingNotif}>
                                        {isDeletingAttemptId === attempt.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            This will permanently delete the registration attempt record for <strong>{attempt.name}</strong> ({attempt.email}). This action cannot be undone.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDeleteAttempt(attempt.id)} className="bg-destructive hover:bg-destructive/90">
                                            Delete Attempt
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
