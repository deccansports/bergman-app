// src/components/dashboard/RegisteredEvents.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { AthleteRegisteredEventDetail, ParticipantWithProfile } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { getAthleteRegisteredEventsAction, getParticipantsForEventAction } from '@/lib/actions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ClipboardList, RotateCcw, XCircle, RepeatIcon, Eye, Map, CalendarSearch, Info, Download } from 'lucide-react';
import { format, parseISO, parse, isValid, isBefore, startOfDay } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import { cn } from '@/lib/utils';

import CancellationRequestModal from '@/components/dashboard/CancellationRequestModal';
import DeferralRequestModal from '@/components/dashboard/DeferralRequestModal';
import CategoryChangeModal from '@/components/dashboard/CategoryChangeModal';
import CourseMapDialog from '@/components/events/CourseMapDialog';
import ParticipantDetailView from './ParticipantDetailView';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';


function EventsSkeleton() {
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </CardHeader>
      <CardContent>
        <div className="flex justify-center items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function RegisteredEvents() {
  const { currentUser, firebaseUserFromAuth, fetchUserProfile } = useAuth();
  const { toast } = useToast();
  const [registeredEvents, setRegisteredEvents] = useState<AthleteRegisteredEventDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isCancellationModalOpen, setIsCancellationModalOpen] = useState(false);
  const [cancellationTargetEvent, setCancellationTargetEvent] = useState<AthleteRegisteredEventDetail | null>(null);
  
  const [isDeferralModalOpen, setIsDeferralModalOpen] = useState(false);
  const [deferralTargetEvent, setDeferralTargetEvent] = useState<AthleteRegisteredEventDetail | null>(null);

  const [isCategoryChangeModalOpen, setIsCategoryChangeModalOpen] = useState(false);
  const [categoryChangeTargetEvent, setCategoryChangeTargetEvent] = useState<AthleteRegisteredEventDetail | null>(null);
  
  const [isCourseMapModalOpen, setIsCourseMapModalOpen] = useState(false);
  const [courseMapTargetEvent, setCourseMapTargetEvent] = useState<AthleteRegisteredEventDetail | null>(null);
  
  const [viewingParticipant, setViewingParticipant] = useState<ParticipantWithProfile | null>(null);
  const [isViewingParticipant, setIsViewingParticipant] = useState(false);
  const [isLoadingViewRegistration, setIsLoadingViewRegistration] = useState(false);


  const fetchRegisteredEvents = useCallback(async () => {
    if (!currentUser?.uid) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await getAthleteRegisteredEventsAction(currentUser.uid, currentUser.email || null);
      if (result.success && result.events) {
        setRegisteredEvents(result.events);
      } else {
        setError(result.message || 'Failed to fetch registered events.');
      }
    } catch (e: any) {
      setError(e.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.uid, currentUser?.email]);

  useEffect(() => {
    fetchRegisteredEvents();
  }, [fetchRegisteredEvents]);
  
  const handleActionSuccess = useCallback(async (actionType: 'deferral' | 'cancellation' | 'categoryChange') => {
    if (actionType === 'cancellation') setIsCancellationModalOpen(false);
    if (actionType === 'categoryChange') setIsCategoryChangeModalOpen(false);
    if (actionType === 'deferral') setIsDeferralModalOpen(false);
    
    setCancellationTargetEvent(null);
    setCategoryChangeTargetEvent(null);
    setDeferralTargetEvent(null);
    
    if (firebaseUserFromAuth && fetchUserProfile) {
      await fetchUserProfile(firebaseUserFromAuth);
    }
    await fetchRegisteredEvents(); 
    
    toast({
      title: `${actionType.charAt(0).toUpperCase() + actionType.slice(1)} Processed`,
      description: `Your ${actionType} request has been successfully processed.`
    });

  }, [firebaseUserFromAuth, fetchUserProfile, fetchRegisteredEvents, toast]);

  const upcomingRegistrations = useMemo(() => {
    const today = startOfDay(new Date());
    return registeredEvents.filter(event => {
        const status = String(event.ticketStatus || '').trim().toLowerCase();
        const isTerminalStatus =
          status.includes('cancel') ||
          status.includes('defer') ||
          status.includes('refund') ||
          status.includes('inactive') ||
          status.includes('failed') ||
          status.includes('expired');
        if (isTerminalStatus) return false;

        const isCompletedStatus =
          status.includes('finish') ||
          status.includes('completed') ||
          status === 'dnf' ||
          status === 'dns';
        if (isCompletedStatus) return false;

        // Upcoming view should not show past events.
        if (!event.eventDate || event.eventDate === 'TBD') return true;

        const rawDate = String(event.eventDate || '').trim();
        let parsedDate = parseISO(rawDate);
        if (!isValid(parsedDate)) parsedDate = parse(rawDate, 'dd/MM/yy', new Date());
        if (!isValid(parsedDate)) parsedDate = parse(rawDate, 'dd/MM/yyyy', new Date());
        if (!isValid(parsedDate)) return true;

        return !isBefore(startOfDay(parsedDate), today);
    });
  }, [registeredEvents]);

  const displayRegistrations = useMemo(() => upcomingRegistrations, [upcomingRegistrations]);

  const handleOpenCancellationModal = (eventDetail: AthleteRegisteredEventDetail) => {
    setCancellationTargetEvent(eventDetail);
    setIsCancellationModalOpen(true);
  };
  const handleOpenDeferralModal = (eventDetail: AthleteRegisteredEventDetail) => {
    if (!eventDetail.canBeDeferred) {
      toast({
        variant: 'destructive',
        title: 'Deferral window closed',
        description: 'This registration is no longer within the deferral window.',
      });
      return;
    }
    setDeferralTargetEvent(eventDetail);
    setIsDeferralModalOpen(true);
  };
  const handleOpenCategoryChangeModal = (eventDetail: AthleteRegisteredEventDetail) => {
    if (!eventDetail.canChangeCategory) {
      toast({
        variant: 'destructive',
        title: 'Category change window closed',
        description: 'This registration is no longer within the category change window.',
      });
      return;
    }
    setCategoryChangeTargetEvent(eventDetail);
    setIsCategoryChangeModalOpen(true);
  };
  const handleOpenCourseMapModal = (eventDetail: AthleteRegisteredEventDetail) => {
    setCourseMapTargetEvent(eventDetail);
    setIsCourseMapModalOpen(true);
  };
  
   const handleViewRegistration = async (eventDetail: AthleteRegisteredEventDetail) => {
    if (!currentUser?.uid || !eventDetail.participantId || !eventDetail.eventId) {
        toast({ variant: "destructive", title: "Invalid data" });
        return;
    }

    setIsLoadingViewRegistration(true);
    try {
        const result = await getParticipantsForEventAction(eventDetail.eventId);
        if (result.success && result.participants) {
            const participantRecord = (result.participants as ParticipantWithProfile[]).find(p => p.id === eventDetail.participantId);
            if (!participantRecord) {
                toast({ variant: "destructive", title: "Not found" });
                return;
            }
            setViewingParticipant(participantRecord);
            setIsViewingParticipant(true);
        } else {
            toast({ variant: "destructive", title: "Error", description: result.message });
        }
    } finally {
        setIsLoadingViewRegistration(false);
    }
  };

  if (isLoading) return <EventsSkeleton />;

  if (error) {
    return (
      <Card className="shadow-lg border-destructive/20 bg-destructive/5 text-left w-full">
        <CardHeader>
          <CardTitle className="text-2xl font-bold tracking-tight text-destructive flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Your Upcoming Registrations
          </CardTitle>
          <CardDescription>Could not load registrations right now.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive mb-4">{error}</p>
          <Button onClick={() => fetchRegisteredEvents()} variant="outline">Retry</Button>
        </CardContent>
      </Card>
    );
  }
  
  if (displayRegistrations.length === 0) {
    return (
      <Card className="shadow-lg border-primary/20 bg-primary/5 text-left w-full">
        <CardHeader>
          <CardTitle className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Your Upcoming Registrations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10">
            <CalendarSearch className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-semibold text-muted-foreground">No Upcoming Registrations Found</p>
            <p className="text-sm text-muted-foreground mt-1">Ready for your next challenge? Explore our races.</p>
            <Button asChild className="mt-4">
              <Link href="/races">View Upcoming Races</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="w-full overflow-hidden border border-primary/20 bg-gradient-to-br from-sky-50 via-background to-indigo-50 shadow-xl shadow-primary/10 dark:border-primary/30 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/40">
        <CardHeader className="border-b border-border/40 bg-background/70 backdrop-blur-sm dark:bg-background/30">
          <CardTitle className="flex items-center gap-2 text-2xl font-black tracking-tight text-primary">
            <ClipboardList className="h-6 w-6" />
            Your Upcoming Registrations
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Manage your active registrations for upcoming events. Past races can be found in your Race History and My Orders.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
            <div className="overflow-x-auto rounded-2xl border border-border/50 bg-background/95 shadow-sm dark:bg-slate-900/80">
              <Table>
                <TableHeader className="bg-muted/60 dark:bg-slate-800/80">
                  <TableRow className="h-12 border-b text-[10px] font-black uppercase tracking-widest">
                    <TableHead className="pl-6">Event Name</TableHead>
                    <TableHead>Event Date</TableHead>
                    <TableHead>Your Ticket</TableHead>
                    <TableHead>BIB NO</TableHead>
                    <TableHead>Booking ID</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRegistrations.map((event) => {
                    const hasCourseMaps = !!event.ticketDefinitions?.some(td => 
                      td.courseMaps?.swimGpxUrl || td.courseMaps?.bikeGpxUrl || td.courseMaps?.runGpxUrl || td.courseMaps?.run1GpxUrl || td.courseMaps?.run2GpxUrl
                    );

                    return (
                      <TableRow key={event.participantId} className="h-16 hover:bg-muted/30 transition-colors border-border/50 text-xs">
                          <TableCell className="pl-6 font-black uppercase tracking-tight text-foreground">
                            {event.eventName}
                          </TableCell>
                          <TableCell className="font-bold text-muted-foreground">
                            {event.eventDate ? format(parseISO(event.eventDate), 'dd MMM yyyy') : 'TBD'}
                          </TableCell>
                          <TableCell className="font-black uppercase text-[10px] text-primary">{event.ticketName}</TableCell>
                          <TableCell className="font-mono text-lg font-black text-primary italic">
                            {event.athleteBibNumber || 'TBD'}
                          </TableCell>
                          <TableCell className="font-mono font-bold text-muted-foreground">
                            {event.bookingId || '—'}
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <div className="ml-auto flex max-w-[460px] flex-wrap items-center justify-end gap-2">
                                <Button variant="outline" size="xs" className="h-8 w-[94px] justify-center rounded-lg border-border/50 text-[9px] font-black uppercase tracking-widest gap-1.5" onClick={() => handleViewRegistration(event)}>
                                    <Eye className="h-3 w-3" /> View
                                </Button>
                                {!!event.bookingId && (!!event.invoiceNumber || !!event.invoiceId) && (
                                    <Button asChild variant="outline" size="xs" className="h-8 w-[94px] justify-center rounded-lg border-emerald-300 text-[9px] font-black uppercase tracking-widest gap-1.5 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
                                      <a href={`/api/invoice/${event.bookingId}${event.eventId ? `?eventId=${encodeURIComponent(event.eventId)}` : ''}`} target="_blank" rel="noopener noreferrer">
                                        <Download className="h-3 w-3" /> Invoice
                                      </a>
                                    </Button>
                                )}
                                {hasCourseMaps && (
                                    <Button variant="outline" size="xs" className="h-8 w-[94px] justify-center rounded-lg border-sky-200 text-[9px] font-black uppercase tracking-widest gap-1.5 text-sky-600 hover:bg-sky-50 dark:text-sky-300 dark:border-sky-800 dark:hover:bg-sky-950/40" onClick={() => handleOpenCourseMapModal(event)}>
                                        <Map className="h-3 w-3" /> Map
                                    </Button>
                                )}
                                <Button variant="outline" size="xs" className="h-8 w-[94px] justify-center rounded-lg border-orange-200 text-[9px] font-black uppercase tracking-widest gap-1.5 text-orange-600 hover:bg-orange-50 dark:text-orange-300 dark:border-orange-800 dark:hover:bg-orange-950/40" onClick={() => handleOpenDeferralModal(event)}>
                                  <RotateCcw className="h-3 w-3" /> Defer
                                </Button>
                                <Button variant="outline" size="xs" className="h-8 w-[94px] justify-center rounded-lg border-red-200 text-[9px] font-black uppercase tracking-widest gap-1.5 text-red-600 hover:bg-red-50 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-950/40" onClick={() => handleOpenCancellationModal(event)}>
                                  <XCircle className="h-3 w-3" /> Cancel
                                </Button>
                                <Button variant="outline" size="xs" className="h-8 w-[94px] justify-center rounded-lg border-purple-200 text-[9px] font-black uppercase tracking-widest gap-1.5 text-purple-600 hover:bg-purple-50 dark:text-purple-300 dark:border-purple-800 dark:hover:bg-purple-950/40" onClick={() => handleOpenCategoryChangeModal(event)}>
                                  <RepeatIcon className="h-3 w-3" /> Change
                                </Button>
                                <Button asChild variant="outline" size="xs" className="h-8 w-[94px] justify-center rounded-lg border-border/60 text-[9px] font-black uppercase tracking-widest gap-1.5 hover:bg-muted/50 dark:border-border/70">
                                    <Link href={`/races/${event.customSlug || event.eventId}`}><Info className="h-3 w-3" /> Info</Link>
                                </Button>
                            </div>
                          </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
        </CardContent>
      </Card>
      
      {cancellationTargetEvent && currentUser && (
        <CancellationRequestModal isOpen={isCancellationModalOpen} onClose={() => setIsCancellationModalOpen(false)} eventDetail={cancellationTargetEvent} athleteUid={currentUser.uid} athleteEmail={currentUser.email || ''} onCancellationSuccess={() => handleActionSuccess('cancellation')} />
      )}
      {deferralTargetEvent && currentUser && (
        <DeferralRequestModal isOpen={isDeferralModalOpen} onClose={() => setIsDeferralModalOpen(false)} eventDetail={deferralTargetEvent} onDeferralSuccess={() => handleActionSuccess('deferral')} />
      )}
      {categoryChangeTargetEvent && (
        <CategoryChangeModal isOpen={isCategoryChangeModalOpen} onClose={() => setIsCategoryChangeModalOpen(false)} eventDetail={categoryChangeTargetEvent} onSuccess={() => handleActionSuccess('categoryChange')} />
      )}
      {courseMapTargetEvent && (
        <CourseMapDialog event={courseMapTargetEvent} isOpen={isCourseMapModalOpen} onClose={() => setIsCourseMapModalOpen(false)} ticketId={courseMapTargetEvent.ticketId} />
      )}
       <Dialog open={isViewingParticipant} onOpenChange={setIsViewingParticipant}>
            <DialogContent className="max-w-2xl text-left">
                <DialogHeader>
                    <DialogTitle className="text-left font-black uppercase italic tracking-tighter">Registration Profile</DialogTitle>
                </DialogHeader>
                <div className="py-4">
                    {viewingParticipant ? <ParticipantDetailView participant={viewingParticipant} /> : <div className="flex justify-center p-8"><Loader2 className="animate-spin text-primary" /></div>}
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Close Details</Button></DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </>
  );
}
