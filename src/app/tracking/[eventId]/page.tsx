
// src/app/tracking/[eventId]/page.tsx
import React, { Suspense } from 'react';
import { getEventDetailsWithTicketsAction } from '@/lib/actions';
import LiveTrackingClientPage from '@/components/live-tracking/LiveTrackingClientPage';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { isPast, parseISO, startOfDay } from 'date-fns';
import { getPublicFinalResultsAction } from '@/lib/actions/publicResultActions';
import type { RaceResult, LiveAthlete, Split, Status, Leg } from '@/lib/types';
import { hmsToSeconds, normalizeStatus, formatSecondsToHMS } from '@/lib/utils';

export const dynamic = "force-dynamic";

interface LiveTrackingPageProps {
  params: {
    eventId: string;
  };
}

// This is a Server Component responsible for fetching initial data.
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
  const isPastEvent = event.eventDate ? isPast(startOfDay(parseISO(event.eventDate))) : false;


  let initialLiveData: LiveAthlete[] = [];
  const shouldFetchResults = event.liveDataSource === 'race_results' || (isPastEvent && event.liveDataSource !== 'timing_partner');

  if (shouldFetchResults) {
    const resultsResult = await getPublicFinalResultsAction(eventId, null);
    if (resultsResult.success && resultsResult.participants) {
        initialLiveData = resultsResult.participants.map((p: RaceResult): LiveAthlete => {
            const ticketDef = event.ticketDefinitions?.find(td => td.id === p.ticketId);
            
            const chipTimeSeconds = p.chipTime ? hmsToSeconds(p.chipTime) : null;
            const isFinishedFromData = !!(chipTimeSeconds && chipTimeSeconds > 0 && chipTimeSeconds !== Infinity);
            const status: Status = isFinishedFromData ? 'Finished' : (normalizeStatus(p.status) as Status);
            const isFinished = status === 'Finished';

            const summary: LiveAthlete['summary'] = {
                SWIM: p.swim ? hmsToSeconds(p.swim) : null,
                T1: p.t1 ? hmsToSeconds(p.t1) : null,
                BIKE: p.bike ? hmsToSeconds(p.bike) : null,
                T2: p.t2 ? hmsToSeconds(p.t2) : null,
                RUN: p.run ? hmsToSeconds(p.run) : null,
                RUN1: p.run1 ? hmsToSeconds(p.run1) : null,
                RUN2: p.run2 ? hmsToSeconds(p.run2) : null,
                FINISHED: chipTimeSeconds,
            };
            
            let finalLeg: Leg | 'NOT_STARTED' = 'NOT_STARTED';

            const splits: Split[] = [];
            let cumulativeTime = 0;
            let cumulativeDistance = 0;
            const courseMaps = ticketDef?.courseMaps;

            if (summary.SWIM) {
                cumulativeTime += summary.SWIM || 0;
                const dist = courseMaps?.swimDistance || 0;
                cumulativeDistance += dist;
                splits.push({ segment: 'SWIM', time: cumulativeTime, distance: cumulativeDistance });
                finalLeg = 'SWIM';
            }
             if (summary.RUN1) {
                cumulativeTime += summary.RUN1 || 0;
                const dist = courseMaps?.run1Distance || 0;
                cumulativeDistance += dist;
                splits.push({ segment: 'RUN1', time: cumulativeTime, distance: cumulativeDistance });
                finalLeg = 'RUN1';
            }
            if (summary.T1) {
                cumulativeTime += summary.T1 || 0;
                splits.push({ segment: 'T1', time: cumulativeTime, distance: cumulativeDistance });
                finalLeg = 'T1';
            }
            if (summary.BIKE) {
                cumulativeTime += summary.BIKE || 0;
                const dist = courseMaps?.bikeDistance || 0;
                cumulativeDistance += dist;
                splits.push({ segment: 'BIKE', time: cumulativeTime, distance: cumulativeDistance });
                finalLeg = 'BIKE';
            }
            if (summary.T2) {
                cumulativeTime += summary.T2 || 0;
                splits.push({ segment: 'T2', time: cumulativeTime, distance: cumulativeDistance });
                finalLeg = 'T2';
            }
            if (summary.RUN) {
                cumulativeTime += summary.RUN || 0;
                const dist = courseMaps?.runDistance || 0;
                cumulativeDistance += dist;
                splits.push({ segment: 'RUN', time: cumulativeTime, distance: cumulativeDistance });
                finalLeg = 'RUN';
            }
             if (summary.RUN2) {
                cumulativeTime += summary.RUN2 || 0;
                const dist = courseMaps?.run2Distance || 0;
                cumulativeDistance += dist;
                splits.push({ segment: 'RUN2', time: cumulativeTime, distance: cumulativeDistance });
                finalLeg = 'RUN2';
            }
            if (isFinished && chipTimeSeconds) {
                splits.push({ segment: 'FINISHED', time: chipTimeSeconds, distance: cumulativeDistance });
                finalLeg = 'FINISHED';
            }
            
            const totalDistance = cumulativeDistance;
            const lastSplit = splits.length > 0 ? splits[splits.length - 1] : null;
            const secondToLastSplit = splits.length > 1 ? splits[splits.length - 2] : null;
            
            let progressDistance = 0;
            if (isFinished) {
                progressDistance = totalDistance;
            } else if (lastSplit) {
                const finalLegs: Leg[] = ['RUN', 'RUN2'];
                if (finalLegs.includes(lastSplit.segment as Leg) && status.startsWith('DNF') && secondToLastSplit) {
                    progressDistance = secondToLastSplit.distance;
                } else {
                    progressDistance = lastSplit.distance;
                }
            }


            return {
                id: p.docId || p.bibNumber, bib: p.bibNumber, name: p.name, category: p.category, ticketId: (p as any).ticketId || null,
                ticketName: (p as any).ticketName || p.raceCategory || 'N/A', 
                status,
                splits: splits,
                summary,
                athleteUid: p.athleteUid || null, ageGroup: p.category, gender: p.gender as 'Male' | 'Female',
                leg: finalLeg,
                startTime: 0, 
                lastUpdateTime: new Date(p.uploadedAt || Date.now()).getTime(),
                avatarUrl: (p as any).photoURL, country: (p as any).countryAtRace || null, clubName: p.clubNameAtRace || null, ranks: p.ranks || {},
                courseProgress: progressDistance,
            };
        });
    }
  }

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
