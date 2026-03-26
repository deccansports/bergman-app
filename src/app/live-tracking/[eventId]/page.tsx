// src/app/live-tracking/[eventId]/page.tsx
import React, { Suspense } from 'react';
import { getEventDetailsWithTicketsAction } from '@/lib/actions';
import LiveTrackingClientPage from '@/components/live-tracking/LiveTrackingClientPage';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { isPast, parseISO, startOfDay } from 'date-fns';
import { getPublicFinalResultsAction } from '@/lib/actions/publicResultActions';
import type { RaceResult, LiveAthlete, Split, Status } from '@/lib/types';
import { hmsToSeconds, normalizeStatus } from '@/lib/utils';

interface LiveTrackingPageProps {
  params: {
    eventId: string;
  };
}

// This is now a Server Component responsible for fetching initial data.
async function LiveTrackingPageContent({ params }: LiveTrackingPageProps) {
  const { eventId } = params;
  const eventDetailsResult = await getEventDetailsWithTicketsAction(eventId);

  if (!eventDetailsResult.success || !eventDetailsResult.event) {
    return (
        <main className="flex-grow container mx-auto p-4 text-center">
          <h1 className="text-2xl font-bold text-destructive">Event Not Found</h1>
          <p className="text-muted-foreground">{eventDetailsResult.message || 'The requested event could not be loaded.'}</p>
        </main>
    );
  }

  const event = eventDetailsResult.event;
  // FIX: Use startOfDay to prevent timezone issues where an event on the current day is considered "past".
  const isPastEvent = event.eventDate ? isPast(startOfDay(parseISO(event.eventDate))) : false;


  let initialLiveData: LiveAthlete[] = [];
  // Corrected Logic: Fetch results if source is 'race_results' OR if it's a past event and not a live source.
  const shouldFetchResults = event.liveDataSource === 'race_results' || (isPastEvent && event.liveDataSource !== 'timing_partner');

  if (shouldFetchResults) {
    const resultsResult = await getPublicFinalResultsAction(eventId, null);
    if (resultsResult.success && resultsResult.participants) {
      initialLiveData = resultsResult.participants.map((p: RaceResult): LiveAthlete => {
          const splits: Split[] = [];
          if (p.swim) splits.push({ segment: 'SWIM', time: hmsToSeconds(p.swim), distance: 0 });
          if (p.run1) splits.push({ segment: 'RUN1', time: hmsToSeconds(p.run1), distance: 0 });
          if (p.t1) splits.push({ segment: 'T1', time: hmsToSeconds(p.t1), distance: 0 });
          if (p.bike) splits.push({ segment: 'BIKE', time: hmsToSeconds(p.bike), distance: 0 });
          if (p.t2) splits.push({ segment: 'T2', time: hmsToSeconds(p.t2), distance: 0 });
          if (p.run) splits.push({ segment: 'RUN', time: hmsToSeconds(p.run), distance: 0 });
          if (p.run2) splits.push({ segment: 'RUN2', time: hmsToSeconds(p.run2), distance: 0 });
          
          const finalTime = p.chipTime ? hmsToSeconds(p.chipTime) : Infinity;
          if (finalTime !== Infinity) {
              splits.push({ segment: 'FINISHED', time: finalTime, distance: 0 });
          }
          
          return {
            id: p.docId || p.bibNumber, bib: p.bibNumber, name: p.name, category: p.category, ticketId: (p as any).ticketId || null,
            ticketName: (p as any).ticketName || p.raceCategory || 'N/A', status: normalizeStatus(p.status) as Status,
            splits: splits, athleteUid: p.athleteUid || null, ageGroup: p.category, gender: p.gender as 'Male' | 'Female',
            leg: 'FINISHED', startTime: 0, // Using 0 for startTime to indicate it's from final results
            lastUpdateTime: new Date(p.uploadedAt || Date.now()).getTime(),
            avatarUrl: (p as any).photoURL, country: (p as any).countryAtRace || null, clubName: p.clubNameAtRace || null, ranks: p.ranks || {}
          };
      });
    }
  }

  // Disable tracking page only if tracking is explicitly set to 'none' AND the event is not in the past.
  // For past events, we allow access for replay purposes.
  if (event.liveDataSource === 'none' && !isPastEvent) {
    return (
        <main className="flex-grow container mx-auto p-4 text-center flex items-center justify-center">
          <div className="space-y-4">
              <AlertTriangle className="h-16 w-16 text-muted-foreground mx-auto" />
              <h1 className="text-2xl font-bold text-foreground">Live Tracking Unavailable</h1>
              <p className="text-muted-foreground">Live tracking is not available for this event at the moment. Please check back later.</p>
              <Button asChild variant="outline" className="mt-4">
                  <Link href="/tracking">
                      <ArrowLeft className="mr-2 h-4 w-4"/> Back to Events
                  </Link>
              </Button>
          </div>
        </main>
    );
  }

  // The eventDetailsResult.event is now fully serialized by the server action
  return (
      <LiveTrackingClientPage 
        initialEventDetails={eventDetailsResult.event} 
        isPastEvent={isPastEvent}
        initialLiveData={initialLiveData}
      />
  );
}


export default function TrackingEventPage({ params }: LiveTrackingPageProps) {
    return (
      <Suspense fallback={
        <div className="flex h-screen w-full items-center justify-center bg-background">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      }>
        <LiveTrackingPageContent params={params} />
      </Suspense>
    );
}
