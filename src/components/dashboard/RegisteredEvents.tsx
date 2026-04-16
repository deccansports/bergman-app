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
    <div className="bg-gradient-to-br from-slate-900 via-[#1d3557] to-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/10 animate-pulse" />
          <div className="space-y-2">
            <div className="h-5 w-48 bg-white/10 animate-pulse rounded" />
            <div className="h-3 w-32 bg-white/10 animate-pulse rounded" />
          </div>
        </div>
        <div className="h-7 w-20 bg-white/10 animate-pulse rounded-full" />
      </div>
      {[1, 2].map((i) => (
        <div key={i} className="mb-4 bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex gap-3">
            <div className="w-1 rounded-full bg-white/10 animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-56 bg-white/10 animate-pulse rounded" />
              <div className="h-3 w-40 bg-white/10 animate-pulse rounded" />
              <div className="h-10 w-16 bg-white/10 animate-pulse rounded mt-2" />
              <div className="flex gap-2 mt-2">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="h-8 w-14 bg-white/10 animate-pulse rounded-full" />
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
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

  if (error) {
    return (
      <div className="bg-gradient-to-br from-slate-900 via-[#1d3557] to-slate-900 border border-red-500/40 rounded-2xl shadow-2xl p-8 text-left w-full">
        <div className="flex items-center gap-3 mb-2">
          <XCircle className="h-6 w-6 text-red-400" />
          <p className="text-white font-black uppercase tracking-tight text-lg">Failed to Load Registrations</p>
        </div>
        <p className="text-white/60 text-sm">{error}</p>
        <Button onClick={fetchRegisteredEvents} className="mt-4 bg-[#e63946] hover:bg-[#c1121f] text-white font-black uppercase tracking-widest rounded-full px-6">
          Retry
        </Button>
      </div>
    );
  }

  if (upcomingRegistrations.length === 0) {
    return (
      <div className="bg-gradient-to-br from-slate-900 via-[#1d3557] to-slate-900 border border-white/10 rounded-2xl shadow-2xl p-12 text-center w-full">
        <div className="text-6xl mb-4">🏃</div>
        <p className="text-white font-black uppercase italic tracking-tight text-2xl mb-2">No Upcoming Races</p>
        <p className="text-white/50 text-sm mb-6">Ready for your next challenge? Explore our events.</p>
        <Button asChild className="bg-[#e63946] hover:bg-[#c1121f] text-white font-black uppercase tracking-widest rounded-full px-6">
          <Link href="/races">Find Your Race →</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="relative bg-gradient-to-br from-slate-900 via-[#1d3557] to-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden w-full text-left">
        {/* Diagonal sport-line SVG background pattern */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 20px)',
          }}
        />

        {/* Header */}
        <div className="relative flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e63946] shadow-lg flex-shrink-0">
              <ClipboardList className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-white font-black uppercase italic tracking-tight text-xl leading-tight">
                Your Registrations
              </p>
              <p className="text-white/60 text-xs uppercase tracking-widest">
                Manage your active race entries
              </p>
            </div>
          </div>
          <div className="flex-shrink-0 rounded-full bg-[#e63946] px-3 py-1 text-xs font-black uppercase tracking-widest text-white shadow">
            {upcomingRegistrations.length} Active
          </div>
        </div>

        {/* Registration cards */}
        <div className="relative px-6 pb-6 space-y-3">
          {upcomingRegistrations.map((event) => {
            const hasCourseMaps = !!event.ticketDefinitions?.some(
              (td) =>
                td.courseMaps?.swimGpxUrl ||
                td.courseMaps?.bikeGpxUrl ||
                td.courseMaps?.runGpxUrl ||
                td.courseMaps?.run1GpxUrl ||
                td.courseMaps?.run2GpxUrl
            );

            const statusColor =
              event.ticketStatus === 'Active'
                ? 'bg-green-500/20 text-green-400 border-green-500/30'
                : event.ticketStatus === 'Confirmed'
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                : event.ticketStatus === 'Pending'
                ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                : 'bg-white/10 text-white/50 border-white/20';

            return (
              <div
                key={event.participantId}
                className="flex gap-3 bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 hover:border-orange-500/40 transition-all"
              >
                {/* Left accent bar */}
                <div className="w-1 rounded-full bg-gradient-to-b from-orange-500 to-red-600 flex-shrink-0" />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Event name + status */}
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-white font-black uppercase tracking-tight text-base leading-tight">
                      {event.eventName}
                    </p>
                    <span
                      className={cn(
                        'flex-shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest',
                        statusColor
                      )}
                    >
                      {event.ticketStatus || 'Unknown'}
                    </span>
                  </div>

                  {/* Date · Ticket */}
                  <p className="text-white/60 text-xs uppercase tracking-widest mb-3">
                    {event.eventDate
                      ? format(parseISO(event.eventDate), 'dd MMM yyyy')
                      : 'TBD'}{' '}
                    · {event.ticketName}
                  </p>

                  {/* BIB + Booking ID */}
                  <div className="flex items-end gap-5 mb-3">
                    <div>
                      <p className="text-[9px] text-white/40 uppercase tracking-widest mb-0.5">
                        Bib
                      </p>
                      <p className="text-4xl font-black text-orange-400 italic leading-none">
                        {event.athleteBibNumber || 'TBD'}
                      </p>
                    </div>
                    {event.bookingId && (
                      <div className="pb-0.5">
                        <p className="text-[9px] text-white/40 uppercase tracking-widest mb-0.5">
                          Booking
                        </p>
                        <p className="font-mono text-white/40 text-xs">
                          {event.bookingId}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="xs"
                      className="h-8 rounded-full px-3 text-[9px] font-black uppercase tracking-widest gap-1.5 bg-slate-700 hover:bg-slate-600 text-white border-0"
                      onClick={() => handleViewRegistration(event)}
                    >
                      <Eye className="h-3 w-3" />
                      <span className="hidden md:inline">View</span>
                    </Button>
                    {hasCourseMaps && (
                      <Button
                        size="xs"
                        className="h-8 rounded-full px-3 text-[9px] font-black uppercase tracking-widest gap-1.5 bg-sky-700 hover:bg-sky-600 text-white border-0"
                        onClick={() => handleOpenCourseMapModal(event)}
                      >
                        <Map className="h-3 w-3" />
                        <span className="hidden md:inline">Map</span>
                      </Button>
                    )}
                    {event.canBeDeferred && (
                      <Button
                        size="xs"
                        className="h-8 rounded-full px-3 text-[9px] font-black uppercase tracking-widest gap-1.5 bg-orange-700 hover:bg-orange-600 text-white border-0"
                        onClick={() => handleOpenDeferralModal(event)}
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span className="hidden md:inline">Defer</span>
                      </Button>
                    )}
                    {event.canBeCancelled && (
                      <Button
                        size="xs"
                        className="h-8 rounded-full px-3 text-[9px] font-black uppercase tracking-widest gap-1.5 bg-red-700 hover:bg-red-600 text-white border-0"
                        onClick={() => handleOpenCancellationModal(event)}
                        disabled={
                          !!event.previousDeferralDetails ||
                          !(event.amountPaidPaisa && event.amountPaidPaisa > 0)
                        }
                      >
                        <XCircle className="h-3 w-3" />
                        <span className="hidden md:inline">Cancel</span>
                      </Button>
                    )}
                    {event.canChangeCategory && (
                      <Button
                        size="xs"
                        className="h-8 rounded-full px-3 text-[9px] font-black uppercase tracking-widest gap-1.5 bg-purple-700 hover:bg-purple-600 text-white border-0"
                        onClick={() => handleOpenCategoryChangeModal(event)}
                      >
                        <RepeatIcon className="h-3 w-3" />
                        <span className="hidden md:inline">Change</span>
                      </Button>
                    )}
                    <Button
                      asChild
                      size="xs"
                      className="h-8 rounded-full px-3 text-[9px] font-black uppercase tracking-widest gap-1.5 bg-white/10 hover:bg-white/20 text-white border-0"
                    >
                      <Link href={`/races/${event.customSlug || event.eventId}`}>
                        <Info className="h-3 w-3" />
                        <span className="hidden md:inline">Info</span>
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
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
