// src/app/dashboard/page.tsx
"use client";

import * as React from "react";
import Script from 'next/script'; // Import Script component
import { useEffect, useState, useCallback, Suspense, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getAthleteRegisteredEventsAction, fetchRaceDataForUserFromFirestore } from '@/lib/actions';
import type { RaceResult, User, EventCalendarEntry, AthleteRegisteredEventDetail, ActiveDeferralInfo, ActiveCancellationInfo, TicketDefinition, DeferralCompletionDetails } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2, Trophy, CalendarSearch, Info, Rocket, ExternalLink, Ticket, RotateCcw, XCircle as XCircleIcon, CheckCircle2, Ban, RepeatIcon, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { getCalendarEventsAction } from '@/lib/actions'; 
import { getTicketDefinitionsForEventAction } from '@/lib/actions/ticketActions';
import { clearActiveCancellationNoticeAction } from '@/lib/actions/userActions';
import { getEligibleEventsForDeferralAction } from '@/lib/actions/deferralActions';
import { createCategoryChangeRazorpayOrderAction, verifyCategoryChangePaymentAndProcessAction, createDeferralFeeOrderAction, verifyDeferralFeePaymentAndProcessAction } from '@/lib/actions/paymentActions';
import EventDisplayCard from '@/components/events/EventDisplayCard';
import { Card, CardContent, CardFooter, CardHeader, CardDescription, CardTitle } from '@/components/ui/card';
import CancellationRequestModal from '@/components/dashboard/CancellationRequestModal';
import DeferralRequestModal from '@/components/dashboard/DeferralRequestModal';
import { Badge } from '@/components/ui/badge';
import { useCountdown, CountdownTimeUnit } from '@/hooks/useCountdown';
import RegisteredEvents from '@/components/dashboard/RegisteredEvents';


import { RaceTable } from "@/components/dashboard/RaceTable";
import { EventSummary } from "@/components/dashboard/EventSummary";
import { UserProfile } from "@/components/dashboard/UserProfile";
import { YearlyRanking } from "@/components/dashboard/YearlyRanking";
import { YearlyProgressReport } from "@/components/dashboard/YearlyProgressReport";
import { Separator } from "@/components/ui/separator";
import { format, isPast, parseISO, differenceInDays, getYear, endOfYear, addYears, isToday, isEqual, subDays } from 'date-fns';
import { PLATFORM_FEE_PAISA, CATEGORY_CHANGE_FEE_PAISA, PAYMENT_GATEWAY_FEE_PERCENTAGE, CANCELLATION_GST_PERCENTAGE, CATEGORY_CHANGE_GST_PERCENTAGE, DEFERRAL_WINDOW_DAYS, CATEGORY_CHANGE_WINDOW_DAYS, DAYS_FOR_NO_REFUND_WINDOW, DEFERRAL_FEE_PAISA } from '@/lib/constants';
import { useRouter, useSearchParams } from 'next/navigation';
import FinishCard from '@/components/dashboard/FinishCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


declare global {
  interface Window {
    Razorpay: any;
  }
}

function DashboardSkeleton() {
  return (
    <div className="max-w-6xl mx-auto w-full space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Skeleton className="h-56 md:col-span-1 rounded-lg shadow-md border-t-4 border-primary/30" />
        <div className="md:col-span-2 space-y-4">
          <Skeleton className="h-12 w-3/4 rounded-md" />
          <Skeleton className="h-8 w-1/2 rounded-md" />
           <Skeleton className="h-8 w-1/2 rounded-md" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 rounded-lg shadow-md" />)}
      </div>
      <Skeleton className="h-72 w-full rounded-lg shadow-md border-t-4 border-primary/30" />
      <Skeleton className="h-96 w-full rounded-lg shadow-md border-t-4 border-accent/30" />
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <Skeleton className="h-10 w-full sm:w-1/2 rounded-md" />
          <Skeleton className="h-10 w-full sm:w-[250px] rounded-md" />
        </div>
        <Skeleton className="h-[60vh] w-full rounded-lg shadow-md" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3 rounded-md" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-80 rounded-lg shadow-md" />)}
        </div>
      </div>
      <div className="space-y-4 mt-8">
        <Skeleton className="h-10 w-2/5 rounded-md" />
         <Skeleton className="h-48 w-full rounded-lg shadow-md" />
      </div>
    </div>
  );
}

const DeferralExpiryCountdown = ({ expiryDateString }: { expiryDateString: string | null }) => {
  const countdown = useCountdown(expiryDateString || '', '23:59');

  if (!countdown) {
    // Render a placeholder or nothing while waiting for client-side mount
    return <div className="mt-2 p-2 bg-orange-100/50 border border-orange-200 rounded-md h-[72px]" />;
  }

  const { days, hours, minutes, seconds, isPast } = countdown;
  
  if (isPast) {
    return <p className="text-sm font-semibold text-destructive">Deferral period has expired.</p>;
  }

  return (
    <div className="mt-2 p-3 bg-orange-100/50 border border-orange-200 rounded-md">
      <p className="text-xs text-center font-medium text-orange-700 mb-2">Time until your deferral credit expires:</p>
      <div className="flex justify-around items-center gap-1.5 text-center text-orange-600">
        <CountdownTimeUnit value={days} label="Days" />
        <CountdownTimeUnit value={hours} label="Hours" />
        <CountdownTimeUnit value={minutes} label="Mins" />
        <CountdownTimeUnit value={seconds} label="Secs" />
      </div>
    </div>
  );
};


function DashboardPageContent() {
  const { currentUser: userFromAuth, firebaseUserFromAuth, loading: authLoading, isAuthenticating, fetchUserProfile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentUserRaces, setCurrentUserRaces] = useState<RaceResult[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showFinishCardForBookingId, setShowFinishCardForBookingId] = useState<string | null>(null);

  const [generalUpcomingEvents, setGeneralUpcomingEvents] = useState<EventCalendarEntry[]>([]);
  const [generalEventsLoading, setGeneralEventsLoading] = useState(true);
  
  const [eligibleDeferralEvents, setEligibleDeferralEvents] = useState<EventCalendarEntry[]>([]);
  const [userRegisteredEventIds, setUserRegisteredEventIds] = useState<Set<string>>(new Set());
  
  const [selectedEventIdForDeferredEvent, setSelectedEventIdForDeferredEvent] = useState<string | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    let ignore = false;
    const fetchAllData = async () => {
      if (ignore) return;
      if (!authLoading && !isAuthenticating && userFromAuth?.uid) {
        setDataLoading(true);
        setFetchError(null);

        const promises = [
            fetchRaceDataForUserFromFirestore(userFromAuth.email, userFromAuth.personalRaceEmail).then(result => {
                if (!ignore) {
                  if (result.success && result.races) {
                    setCurrentUserRaces(result.races);
                  } else {
                    setFetchError(result.message);
                  }
                }
            }),
            getCalendarEventsAction().then(result => {
                if (!ignore) {
                    if (result.success && result.events) {
                        const now = new Date();
                        const filtered = result.events.filter(event => {
                            if (event.eventDate === null) return true;
                            const end = new Date(`${event.endDate || event.eventDate}T${event.endTime || '23:59:59'}`);
                            return !isNaN(end.getTime()) && end >= now;
                        }).sort((a,b) => (new Date(a.eventDate||'').getTime())-(new Date(b.eventDate||'').getTime()));
                        setGeneralUpcomingEvents(filtered);
                    }
                }
            }).finally(() => { if (!ignore) setGeneralEventsLoading(false); }),
            getEligibleEventsForDeferralAction().then(result => {
                if (!ignore && result.success && result.events) {
                    setEligibleDeferralEvents(result.events);
                }
            }),
            getAthleteRegisteredEventsAction(userFromAuth.uid).then(result => {
                if (!ignore && result.success && result.events) {
                    setUserRegisteredEventIds(new Set(result.events.map(e => e.id)));
                }
            })
        ];
        
        Promise.allSettled(promises).finally(() => {
          if (!ignore) setDataLoading(false);
        });

      } else if (!authLoading && !isAuthenticating) {
        setDataLoading(false);
        setGeneralEventsLoading(false);
      }
    };
    fetchAllData();
    return () => { ignore = true; };
  }, [userFromAuth, authLoading, isAuthenticating]);

  const finalEligibleDeferralEvents = useMemo(() => {
    const originalEventId = userFromAuth?.activeDeferral?.originalEventId;
    return eligibleDeferralEvents.filter(event => 
        event.id !== originalEventId && !userRegisteredEventIds.has(event.id)
    );
  }, [eligibleDeferralEvents, userRegisteredEventIds, userFromAuth]);
  
  const isAlreadyRegisteredForSelectedDeferralEvent = useMemo(() => {
      if (!selectedEventIdForDeferredEvent) return false;
      return userRegisteredEventIds.has(selectedEventIdForDeferredEvent);
  }, [selectedEventIdForDeferredEvent, userRegisteredEventIds]);


  useEffect(() => {
    const bookingId = searchParams.get('bookingId');
    if (bookingId) {
      setShowFinishCardForBookingId(bookingId);
      router.replace('/dashboard', { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (userFromAuth?.activeDeferral?.deferredToEventId && !selectedEventIdForDeferredEvent) {
        setSelectedEventIdForDeferredEvent(userFromAuth.activeDeferral.deferredToEventId);
    }
  }, [userFromAuth, selectedEventIdForDeferredEvent]);


  useEffect(() => { if (fetchError) toast({ variant: 'destructive', title: 'Your Race Data Error', description: fetchError, duration: 7000 }); }, [fetchError, toast]);

  const handleUserUpdate = useCallback((updatedData: Partial<User>) => { toast({ title: "Profile Updated", description: "Your profile information has been refreshed."}); }, [toast]);

  const handleProceedToDeferralForm = useCallback(() => {
    if (!userFromAuth?.activeDeferral || !selectedEventIdForDeferredEvent || isAlreadyRegisteredForSelectedDeferralEvent) {
        toast({ variant: "destructive", title: "Error", description: "Invalid state for completing deferral." });
        return;
    }

    const chosenEvent = finalEligibleDeferralEvents.find(e => e.id === selectedEventIdForDeferredEvent);
    if (!chosenEvent?.customSlug) {
        toast({ variant: "destructive", title: "Error", description: "The selected event does not have a registration form configured." });
        return;
    }
    
    const queryParams = new URLSearchParams({
        deferralId: userFromAuth.activeDeferral.deferralId,
        originalTicketId: userFromAuth.activeDeferral.originalTicketId || 'unknown'
    });
    router.push(`/event-form/${chosenEvent.customSlug}?${queryParams.toString()}`);

  }, [userFromAuth, selectedEventIdForDeferredEvent, isAlreadyRegisteredForSelectedDeferralEvent, finalEligibleDeferralEvents, router, toast]);

  const handleDismissCancellation = async () => {
    if (!userFromAuth?.uid) return;
    const result = await clearActiveCancellationNoticeAction(userFromAuth.uid);
    if (result.success) {
      toast({ title: "Notice Dismissed", description: "The cancellation notice has been cleared." });
      if (fetchUserProfile && firebaseUserFromAuth) {
        await fetchUserProfile(firebaseUserFromAuth);
      }
    } else {
      toast({ variant: "destructive", title: "Error", description: result.message });
    }
  };

  const finishedRaceForCard = useMemo(() => {
    if (!showFinishCardForBookingId || currentUserRaces.length === 0) return null;
    return currentUserRaces.find(r => r.status === 'Finished') || null;
  }, [showFinishCardForBookingId, currentUserRaces]);


  if (authLoading || isAuthenticating || (userFromAuth && dataLoading && !fetchError) ) return <DashboardSkeleton />;
  if (!userFromAuth) return (<div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-muted-foreground">Verifying user session...</p></div>);
  const combinedError = fetchError;

  return (
    <>
      <div className="flex justify-center">
          <div className="w-full max-w-6xl space-y-8">
              {finishedRaceForCard && (
                <FinishCard race={finishedRaceForCard} onDismiss={() => setShowFinishCardForBookingId(null)} />
              )}

              <UserProfile user={userFromAuth} onUpdate={handleUserUpdate} />
              {combinedError && (<Alert variant="destructive" className="shadow-md"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error Loading Race Data</AlertTitle><AlertDescription>{fetchError && <p>Your races: {fetchError}</p>}<p className='mt-2 text-xs'>Try refreshing.</p></AlertDescription></Alert>)}
              
              <RegisteredEvents />

              {userFromAuth.activeDeferral?.status === 'Pending Ticket Selection' && (
                  <Card className="shadow-xl rounded-xl overflow-hidden border-t-4 border-orange-500 bg-orange-500/5">
                      <CardHeader>
                          <CardTitle className="text-2xl font-bold tracking-tight text-orange-600 flex items-center gap-2">
                              <RotateCcw className="h-6 w-6" /> Your Deferral Credit is Active!
                          </CardTitle>
                          <CardDescription className="text-orange-700/80">
                              You have an active deferral credit from <strong>{userFromAuth.activeDeferral.originalEventName}</strong>. 
                              Use it to register for an upcoming event before it expires.
                          </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                           <DeferralExpiryCountdown expiryDateString={userFromAuth.activeDeferral.expiryDate} />
                           {finalEligibleDeferralEvents.length > 0 ? (
                               <div className="space-y-2">
                                  <label className="text-sm font-medium">Choose your next race:</label>
                                  <Select onValueChange={setSelectedEventIdForDeferredEvent} value={selectedEventIdForDeferredEvent || ''}>
                                      <SelectTrigger><SelectValue placeholder="Select an eligible event..."/></SelectTrigger>
                                      <SelectContent>
                                        {finalEligibleDeferralEvents.map(e => (
                                          <SelectItem key={e.id} value={e.id}>
                                            {e.eventDate ? `${format(parseISO(e.eventDate), 'dd MMM, yyyy')} - ` : ''}{e.eventName}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                  </Select>
                               </div>
                           ) : ( <p className="text-sm text-muted-foreground">No eligible events available for deferral at this time (this excludes the original event and any events you're already registered for).</p> )}
                      </CardContent>
                      <CardFooter>
                          <Button className="w-full" onClick={handleProceedToDeferralForm} disabled={!selectedEventIdForDeferredEvent || isAlreadyRegisteredForSelectedDeferralEvent}>
                              {isAlreadyRegisteredForSelectedDeferralEvent ? 'Already Registered for This Event' : 'Proceed to Register'}
                          </Button>
                      </CardFooter>
                  </Card>
              )}

              <EventSummary races={currentUserRaces} />
              
              <Card>
                <CardHeader>
                    <CardTitle>Your Race History</CardTitle>
                    <CardDescription>A comprehensive log of all your race results.</CardDescription>
                </CardHeader>
                <CardContent>
                    <RaceTable races={currentUserRaces} />
                </CardContent>
              </Card>

              <YearlyRanking currentUser={userFromAuth} />
              <YearlyProgressReport currentUserRaces={currentUserRaces} currentUser={userFromAuth}/>
              <Separator className="my-8" />
              <div id="upcoming-bergman-events-section"><h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2"><CalendarSearch className="h-6 w-6 text-accent" />Upcoming Bergman Events (All)</h2><p className="text-sm text-muted-foreground mt-1">Choose and register for your event! Some events use our direct registration form, others use an external link. Dates might be &quot;TBD&quot;.</p></div>
              {generalEventsLoading ? (<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{[...Array(3)].map((_, i) => <Skeleton key={`gen-skel-${i}`} className="h-80 rounded-lg shadow-md" />)}</div>)
              : generalUpcomingEvents.length > 0 ? (<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{generalUpcomingEvents.map(event => (<EventDisplayCard key={`gen-${event.id}`} event={event} />))}</div>)
              : (<Card className="bg-secondary/30 border-accent/30"><CardContent className="p-6 text-center"><CalendarSearch className="h-10 w-10 text-accent mx-auto mb-3" /><p className="text-lg font-semibold text-foreground">No general upcoming events scheduled.</p><p className="text-muted-foreground mt-1">Check back soon for new announcements!</p></CardContent></Card>)}
          </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
    return (
        <Suspense fallback={<DashboardSkeleton />}>
            <DashboardPageContent />
        </Suspense>
    );
}
