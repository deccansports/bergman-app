// src/components/layout/UpcomingEventsSection.tsx
"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Calendar, ArrowRight, Loader2 } from 'lucide-react';
import type { EventCalendarEntry } from '@/lib/types';
import EventDisplayCard from '../events/EventDisplayCard';

interface UpcomingEventsSectionProps {
  events: EventCalendarEntry[];
  isLoading: boolean;
}

export default function UpcomingEventsSection({ events, isLoading }: UpcomingEventsSectionProps) {
  return (
    <section id="events" className="w-full py-12 md:py-24 lg:py-32">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl">Upcoming Events</h2>
            <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
              Join the Next Challenge. Find your next race and be part of the Bergman experience. Registration is just a click away.
            </p>
          </div>
        </div>
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 py-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {isLoading ? (
            <div className="col-span-full flex justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>
          ) : events.length > 0 ? (
            events.map(event => (
              <EventDisplayCard key={event.id} event={event} layout="vertical" />
            ))
          ) : (
            <p className="col-span-full text-center text-muted-foreground">No upcoming events scheduled. Please check back soon!</p>
          )}
        </div>
      </div>
    </section>
  );
}
