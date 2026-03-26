// src/app/dashboard/page.tsx
"use client";

import * as React from "react";
import { useEffect, useState, useCallback, Suspense, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getAthleteRaceHistoryAction } from '@/lib/actions';
import type { RaceResult, User, EventCalendarEntry } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2, CalendarSearch } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import RegisteredEvents from '@/components/dashboard/RegisteredEvents';

import { RaceTable } from "@/components/dashboard/RaceTable";
import EventDisplayCard from '@/components/events/EventDisplayCard';
import { EventSummary } from "@/components/dashboard/EventSummary";
import { UserProfile } from "@/components/dashboard/UserProfile";
import { YearlyRanking } from "@/components/dashboard/YearlyRanking";
import { YearlyProgressReport } from "@/components/dashboard/YearlyProgressReport";
import { Separator } from "@/components/ui/separator";
import { useRouter, useSearchParams } from 'next/navigation';
import FinishCard from '@/components/dashboard/FinishCard';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import ActiveDeferralCard from "@/components/dashboard/ActiveDeferralCard";
import AthleteRewardsWidget from "@/components/dashboard/AthleteRewardsWidget";
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { parseISO, isBefore, startOfDay } from 'date-fns';
import { normalizeStatus } from '@/lib/utils';

export const dynamic = "force-dynamic";

function DashboardSkeleton() {
  return (
    <div className="max-w-6xl mx-auto w-full space-y-8 text-left">
      <div className="space-y-6">
        <Skeleton className="h-64 w-full rounded-xl shadow-md" />
        <Skeleton className="h-40 w-full rounded-xl shadow-md" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 rounded-lg shadow-md" />)}
      </div>
      <Skeleton className="h-[60vh] w-full rounded-lg shadow-md" />
    </div>
  );
}

function DashboardPageContent() {
  const { currentUser, loading: authLoading, isAuthenticating } = useAuth();
  const userFromAuth = currentUser; 
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentUserRaces, setCurrentUserRaces] = useState<RaceResult[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<EventCalendarEntry[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showFinishCardForBookingId, setShowFinishCardForBookingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let ignore = false;
    const fetchRaces = async () => {
      if (!authLoading && !isAuthenticating && userFromAuth?.uid && userFromAuth.email) {
        setDataLoading(true);
        setFetchError(null);
        getAthleteRaceHistoryAction(userFromAuth.email).then((result) => {
          if (!ignore) {
            if (result.success && result.races) {
              setCurrentUserRaces(result.races);
            } else {
              setFetchError(result.message || 'Failed to fetch race data.');
            }
            setDataLoading(false);
          }
        });
      } else if (!authLoading && !isAuthenticating) {
        setDataLoading(false);
      }
    };
    fetchRaces();
    return () => { ignore = true; };
  }, [userFromAuth, authLoading, isAuthenticating]);

  useEffect(() => {
    const bookingId = searchParams.get('bookingId');
    if (bookingId) {
      setShowFinishCardForBookingId(bookingId);
      router.replace('/dashboard', { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    setEventsLoading(true);
    getCalendarEventsAction()
        .then(result => {
          if (result.success && result.events) {
            const now = new Date();
            const filteredUpcomingEvents = result.events.filter(event => {
              if (event.isHidden) return false;
              if (event.eventDate === null) return true;
              const eventDate = parseISO(event.eventDate);
              return !isBefore(eventDate, startOfDay(now));
            }).sort((a, b) => { 
                const dateA = a.eventDate ? new Date(a.eventDate).getTime() : Infinity; 
                const dateB = b.eventDate ? new Date(b.eventDate).getTime() : Infinity; 
                return dateA - dateB; 
            });
            setUpcomingEvents(filteredUpcomingEvents);
          } else setUpcomingEvents([]);
        }).catch(error => console.error(error)).finally(() => setEventsLoading(false));
  }, []);

  const handleUserUpdate = useCallback((updatedData: Partial<User>) => { 
    toast({ title: "Profile Updated", description: "Your profile information has been refreshed."}); 
  }, [toast]);

  const finishedRaceForCard = useMemo(() => {
    if (!showFinishCardForBookingId || currentUserRaces.length === 0) return null;
    return currentUserRaces.find(r => normalizeStatus(r.status) === 'Finished') || null;
  }, [showFinishCardForBookingId, currentUserRaces]);


  if (authLoading || isAuthenticating || (userFromAuth && dataLoading && !fetchError) ) return <DashboardSkeleton />;
  if (!userFromAuth) return (<div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-muted-foreground text-left">Verifying user session...</p></div>);

  return (
    <div className="flex justify-center text-left">
        <div className="w-full max-w-6xl space-y-8">
            {finishedRaceForCard && (
              <FinishCard race={finishedRaceForCard} onDismiss={() => setShowFinishCardForBookingId(null)} />
            )}
            
            <div className="space-y-6 w-full">
                <UserProfile user={userFromAuth} onUpdate={handleUserUpdate} />

                <RegisteredEvents />
                <AthleteRewardsWidget />
                <ActiveDeferralCard user={userFromAuth} />
            </div>
            
            {fetchError && (
                <Alert variant="destructive" className="shadow-md">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Error Loading Race Data</AlertTitle>
                    <AlertDescription>{fetchError}</AlertDescription>
                </Alert>
            )}
            
            <EventSummary races={currentUserRaces} />
            
            <Card className="w-full">
              <CardHeader className="text-left">
                  <CardTitle className="text-left">Your Race History</CardTitle>
                  <CardDescription className="text-left">A comprehensive log of all your race results.</CardDescription>
              </CardHeader>
              <CardContent>
                  <RaceTable races={currentUserRaces} />
              </CardContent>
            </Card>

            <div className="w-full">
                <YearlyRanking currentUser={userFromAuth} />
            </div>
            <div className="w-full">
                <YearlyProgressReport currentUserRaces={currentUserRaces} currentUser={userFromAuth}/>
            </div>

            <Separator className="my-8" />
            <div className="text-left">
              <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2 text-left justify-start">
                <CalendarSearch className="h-6 w-6 text-accent" /> Upcoming Bergman Events
              </h2>
              <p className="text-sm text-muted-foreground mt-1 text-left">Choose and register for your next event.</p>
            </div>
            
            {eventsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-lg shadow-md" />)}
                </div>
            ) : upcomingEvents.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {upcomingEvents.map(event => (<EventDisplayCard key={event.id} event={event} />))}
                </div>
            ) : (
                <Card className="bg-secondary/30 border-accent/30">
                  <CardContent className="p-6 text-center">
                    <CalendarSearch className="h-10 w-10 text-accent mx-auto mb-3" />
                    <p className="text-lg font-semibold text-foreground">No upcoming events scheduled.</p>
                  </CardContent>
                </Card>
            )}

            <div className="mt-6 text-sm text-muted-foreground text-center border-t pt-4">
                <p>If you think your timing or race data is incorrect, please inform our support tech team at <a href="mailto:info@bergmantri.com" className="text-primary underline hover:no-underline">info@bergmantri.com</a>. They will verify and update accordingly.</p>
            </div>
        </div>
    </div>
  );
}

export default function DashboardPage() {
    return (
        <Suspense fallback={<DashboardSkeleton />}>
            <DashboardPageContent />
        </Suspense>
  );
}
