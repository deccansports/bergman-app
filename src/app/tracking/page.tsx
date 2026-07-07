
// src/app/tracking/page.tsx
"use client";

import React, { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Satellite, Calendar, History, Loader2, ArrowRight, ArrowLeft, ImageIcon } from 'lucide-react';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import type { EventCalendarEntry } from '@/lib/types';
import { parseISO, isToday, isFuture, isPast, startOfDay, isAfter } from 'date-fns';
import { useRouter } from 'next/navigation';
import { isEventHidden } from '@/lib/utils';

function buildEventCategoryDateSummary(event: EventCalendarEntry) {
  const fallbackDate = String(event?.eventDate || '').trim();
  const normalizeDateKey = (value: string) => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return normalized.includes('T') ? normalized.slice(0, 10) : normalized;
  };
  const getOrdinal = (day: number) => {
    const mod100 = day % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
    const mod10 = day % 10;
    if (mod10 === 1) return `${day}st`;
    if (mod10 === 2) return `${day}nd`;
    if (mod10 === 3) return `${day}rd`;
    return `${day}th`;
  };

  const dateKeys = (event.ticketDefinitions || [])
    .map((ticket) => normalizeDateKey(String(ticket?.eventDate || fallbackDate).trim()))
    .filter(Boolean)
    .sort((a, b) => new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime());

  const uniqueDateKeys = Array.from(new Set(dateKeys));
  if (uniqueDateKeys.length === 0) {
    if (!fallbackDate) return 'Date TBD';
    const fallback = new Date(`${fallbackDate}T00:00:00Z`);
    if (Number.isNaN(fallback.getTime())) return 'Date TBD';
    return `${getOrdinal(fallback.getUTCDate())} ${fallback.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
  }

  const dates = uniqueDateKeys
    .map((key) => ({ key, date: new Date(`${key}T00:00:00Z`) }))
    .filter((item) => !Number.isNaN(item.date.getTime()));

  if (dates.length === 0) return 'Date TBD';
  if (dates.length === 1) {
    const d = dates[0].date;
    return `${getOrdinal(d.getUTCDate())} ${d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
  }

  const sameMonthYear = dates.every((item) => item.date.getUTCMonth() === dates[0].date.getUTCMonth() && item.date.getUTCFullYear() === dates[0].date.getUTCFullYear());
  if (sameMonthYear) {
    const dayLabels = dates.map((item) => getOrdinal(item.date.getUTCDate()));
    const joinedDays = dayLabels.length === 2
      ? `${dayLabels[0]} & ${dayLabels[1]}`
      : `${dayLabels.slice(0, -1).join(', ')} & ${dayLabels[dayLabels.length - 1]}`;
    const monthYear = dates[0].date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return `${joinedDays} ${monthYear}`;
  }

  return dates
    .map((item) => `${getOrdinal(item.date.getUTCDate())} ${item.date.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })}`)
    .join(' • ');
}

function RaceTrackingContent() {
  const [liveEvents, setLiveEvents] = useState<EventCalendarEntry[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<EventCalendarEntry[]>([]);
  const [pastEvents, setPastEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAndCategorizeEvents = async () => {
      const { events } = await getCalendarEventsAction();
      if (events) {
        const today = startOfDay(new Date());
        const nonHiddenEvents = events.filter(event => !isEventHidden(event));

        const currentLiveEvents = nonHiddenEvents.filter(event => 
            event.eventDate && isToday(parseISO(event.eventDate)) && event.liveDataSource !== 'none'
        );

        const futureEvents = nonHiddenEvents.filter(event => {
            if (!event.eventDate) return true; // TBD events are upcoming
            try {
                const eventStartDate = parseISO(event.eventDate);
                return isAfter(eventStartDate, today);
            } catch {
                return false;
            }
        });
        
        const historicalEvents = nonHiddenEvents.filter(event => {
            if (!event.eventDate) return false;
             try {
                const eventStartDate = parseISO(event.eventDate);
                return isPast(eventStartDate) && !isToday(eventStartDate);
            } catch {
                return false;
            }
        });

        // Sort past events from latest to oldest
        historicalEvents.sort((a, b) => {
            if (!a.eventDate || !b.eventDate) return 0;
            try {
                const dateA = parseISO(a.eventDate);
                const dateB = parseISO(b.eventDate);
                return dateB.getTime() - dateA.getTime(); // Latest first
            } catch {
                return 0;
            }
        });

        setLiveEvents(currentLiveEvents);
        setUpcomingEvents(futureEvents);
        setPastEvents(historicalEvents);
      }
      setIsLoading(false);
    };

    fetchAndCategorizeEvents();
  }, []);

  const renderEventList = (eventList: EventCalendarEntry[], title: string, icon: React.ElementType) => (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 bg-primary/10 p-3 rounded-full">
          {React.createElement(icon, { className: 'h-6 w-6 text-primary' })}
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">{title}</h2>
      </div>
      {eventList.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {eventList.map(event => (
             <Card key={event.id} className="w-full overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 rounded-lg border flex flex-col group relative">
                 {event.photoUrl ? (
                    <div className="relative w-full h-48 overflow-hidden">
                        <Image
                            src={event.photoUrl}
                            alt={event.eventName || 'Event image'}
                            fill
                            className="object-cover transition-transform duration-300 group-hover:scale-105"
                            data-ai-hint="event banner"
                            loading="lazy"
                        />
                    </div>
                 ) : (
                    <div className="w-full h-48 bg-muted flex items-center justify-center">
                        <ImageIcon className="h-16 w-16 text-muted-foreground" />
                    </div>
                 )}
                 <div className="flex flex-col flex-grow p-4">
                    <CardHeader className="p-0 mb-2">
                        <CardTitle className="text-xl font-semibold text-primary">{event.eventName}</CardTitle>
                        <CardDescription className="text-sm">
                      {buildEventCategoryDateSummary(event)}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow p-0">
                        <p className="text-sm text-muted-foreground line-clamp-2">{event.description}</p>
                    </CardContent>
                    <CardFooter className="p-0 pt-4 mt-auto">
                        <Button asChild className="w-full">
                        <Link href={`/live-tracking/${event.customSlug || event.id}`}>
                                {title === 'Past Events' ? 'View Results / Replay' : 'Go to Tracking'}
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                        </Button>
                    </CardFooter>
                 </div>
             </Card>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground italic">No {title.toLowerCase()} at the moment.</p>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-12">
      {renderEventList(liveEvents, "Live Events", Satellite)}
      {renderEventList(upcomingEvents, "Upcoming Events", Calendar)}
      {renderEventList(pastEvents, "Past Events", History)}
    </div>
  );
}

export default function TrackingPage() {
  const router = useRouter();
  return (
    <>
        <section className="w-full py-12 md:py-16 lg:py-20 bg-gradient-to-r from-primary/10 via-background to-background">
          <div className="container px-4 md:px-6 mx-auto text-center">
            <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl text-primary">
              Bergman Race Tracking
            </h1>
            <p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl mt-4">
              Select an event below to view the live race map, athlete leaderboards, and real-time progress.
            </p>
          </div>
        </section>
        <section className="w-full py-12 md:py-16">
            <div className="container px-4 md:px-6 mx-auto">
                <Suspense fallback={<div className="flex justify-center items-center py-20"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
                  <RaceTrackingContent />
                </Suspense>
            </div>
        </section>
    </>
  );
}
