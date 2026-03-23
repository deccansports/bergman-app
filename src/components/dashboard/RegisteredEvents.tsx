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
import { Loader2, ClipboardList, RotateCcw, XCircle, RepeatIcon, Eye, Map, CalendarSearch, Info } from 'lucide-react';
import { format, parseISO, isBefore, startOfDay } from 'date-fns';
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
      const result = await getAthleteRegisteredEventsAction(currentUser.uid);
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
  }, [currentUser?.uid]);

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
        if (event.ticketStatus !== 'Active' && event.ticketStatus !== 'Confirmed') return false;
        if (!event.eventDate || event.eventDate === 'TBD') return true;
        return !isBefore(parseISO(event.eventDate), today);
    });
  }, [registeredEvents]);

  const handleOpenCancellationModal = (eventDetail: AthleteRegisteredEventDetail) => {
    setCancellationTargetEvent(eventDetail);
    setIsCancellationModalOpen(true);
  };
  const handleOpenDeferralModal = (eventDetail: AthleteRegisteredEventDetail) => {
    setDeferralTargetEvent(eventDetail);
    setIsDeferralModalOpen(true);
  };
  const handleOpenCategoryChangeModal = (eventDetail: AthleteRegisteredEventDetail) => {
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
  
  if (upcomingRegistrations.length === 0) {
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
      <Card className="shadow-lg border-primary/20 bg-blue-50/30 text-left w-full border-none">
        <CardHeader>
          <CardTitle className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Your Upcoming Registrations
          </CardTitle>
          <CardDescription>
            Manage your active registrations for upcoming events. Past races can be found in your Race History and My Orders.
          </CardDescription>
        </CardHeader>
        <CardContent>
            <div className="overflow-x-auto rounded-xl border bg-background shadow-sm">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="h-12 border-b text-[10px] font-black uppercase tracking-widest">
                    <TableHead className="pl-6">Event Name</TableHead>
                    <TableHead>Event Date</TableHead>
                    <TableHead>Your Ticket</TableHead>
                    <TableHead>BIB NO</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingRegistrations.map((event) => {
                    const hasCourseMaps = !!event.ticketDefinitions?.some(td => 
                      td.courseMaps?.swimGpxUrl || td.courseMaps?.bikeGpxUrl || td.courseMaps?.runGpxUrl || td.courseMaps?.run1GpxUrl || td.courseMaps?.run2GpxUrl
                    );

                    return (
                      <TableRow key={event.participantId} className="h-16 hover:bg-muted/30 transition-colors border-border/50 text-xs">
                          <TableCell className="pl-6 font-black uppercase tracking-tight text-foreground">{event.eventName}</TableCell>
                          <TableCell className="font-bold text-slate-500">
                            {event.eventDate ? format(parseISO(event.eventDate), 'dd MMM yyyy') : 'TBD'}
                          </TableCell>
                          <TableCell className="font-black uppercase text-[10px] text-primary">{event.ticketName}</TableCell>
                          <TableCell className="font-mono text-lg font-black text-primary italic">
                            {event.athleteBibNumber || 'TBD'}
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                <Button variant="outline" size="xs" className="h-8 rounded-lg font-black uppercase text-[9px] tracking-widest gap-1.5 border-border/50" onClick={() => handleViewRegistration(event)}>
                                    <Eye className="h-3 w-3" /> View
                                </Button>
                                {hasCourseMaps && (
                                    <Button variant="outline" size="xs" className="h-8 rounded-lg font-black uppercase text-[9px] tracking-widest gap-1.5 text-sky-600 border-sky-200 hover:bg-sky-50" onClick={() => handleOpenCourseMapModal(event)}>
                                        <Map className="h-3 w-3" /> Map
                                    </Button>
                                )}
                                {event.canBeDeferred && (
                                    <Button variant="outline" size="xs" className="h-8 rounded-lg font-black uppercase text-[9px] tracking-widest gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50" onClick={() => handleOpenDeferralModal(event)}>
                                        <RotateCcw className="h-3 w-3" /> Defer
                                    </Button>
                                )}
                                {event.canBeCancelled && (
                                    <Button variant="outline" size="xs" className="h-8 rounded-lg font-black uppercase text-[9px] tracking-widest gap-1.5 text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleOpenCancellationModal(event)} disabled={!!event.previousDeferralDetails || !(event.amountPaidPaisa && event.amountPaidPaisa > 0)}>
                                        <XCircle className="h-3 w-3" /> Cancel
                                    </Button>
                                )}
                                {event.canChangeCategory && (
                                    <Button variant="outline" size="xs" className="h-8 rounded-lg font-black uppercase text-[9px] tracking-widest gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50" onClick={() => handleOpenCategoryChangeModal(event)}>
                                        <RepeatIcon className="h-3 w-3" /> Change
                                    </Button>
                                )}
                                <Button asChild variant="ghost" size="xs" className="h-8 rounded-lg font-black uppercase text-[9px] tracking-widest gap-1.5 hover:bg-muted/50">
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
