
// src/app/races/page.tsx
"use client";

import React, { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Satellite, Calendar, History, Loader2, ArrowRight, ArrowLeft, ImageIcon } from 'lucide-react';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import type { EventCalendarEntry } from '@/lib/types';
import { parseISO, isToday, isFuture, isPast, startOfDay, isAfter, isBefore } from 'date-fns';
import { useRouter } from 'next/navigation';
import EventDisplayCard from '@/components/events/EventDisplayCard';

function RacesPageContent() {
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getCalendarEventsAction().then(result => {
      if (result.success && result.events) {
        const now = new Date();
        const upcomingEvents = result.events.filter(event => {
          if (event.isHidden) return false;
          if (!event.eventDate) return true; // Keep TBD events
          try {
            return !isBefore(parseISO(event.eventDate), startOfDay(now));
          } catch {
            return false;
          }
        });
        
        upcomingEvents.sort((a, b) => {
            const dateA = a.eventDate ? new Date(a.eventDate).getTime() : Infinity; // TBD dates go to the end
            const dateB = b.eventDate ? new Date(b.eventDate).getTime() : Infinity;
            return dateA - dateB;
        });
        
        setEvents(upcomingEvents);
      }
      setIsLoading(false);
    });
  }, []);

  return (
      <section className="w-full py-12 md:py-16">
        <div className="container px-4 md:px-6 mx-auto">
          <div className="space-y-4 text-center mb-12">
              <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl">All Upcoming Races</h1>
              <p className="max-w-[900px] mx-auto text-muted-foreground md:text-xl/relaxed">
                  Find your next challenge. Explore all upcoming Bergman events and secure your spot at the starting line.
              </p>
          </div>
          
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
              {isLoading ? (
                  <div className="col-span-full flex justify-center py-20"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>
              ) : events.length > 0 ? (
                  events.map((event) => (
                    <EventDisplayCard key={event.id} event={event} layout="horizontal" />
                  ))
              ) : (
                  <p className="col-span-full text-center text-muted-foreground py-20">No upcoming events scheduled. Please check back soon!</p>
              )}
          </div>
        </div>
      </section>
  );
}

export default function RacesPage() {
    const router = useRouter();
    return (
        <main>
            <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-background"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
                <RacesPageContent />
            </Suspense>
        </main>
    );
}
