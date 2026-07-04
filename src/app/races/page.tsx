
// src/app/races/page.tsx
"use client";

import React, { Suspense, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Satellite, Calendar, History, Loader2, ArrowRight, ArrowLeft, ImageIcon } from 'lucide-react';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { listWaitlistFormsAction } from '@/lib/actions';
import type { EventCalendarEntry } from '@/lib/types';
import { parseISO, isToday, isFuture, isPast, startOfDay, isAfter, isBefore } from 'date-fns';
import { useRouter } from 'next/navigation';
import EventDisplayCard from '@/components/events/EventDisplayCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isEventHidden, normalizeStateNameForCountry } from '@/lib/utils';

const ALL_OPTION = 'ALL';

const normalizeValue = (value?: string | null) => (value || '').trim();

const deriveCity = (event: EventCalendarEntry): string => {
  const directCity = normalizeValue(event.city);
  if (directCity) return directCity;

  const fromAddress = normalizeValue(event.address);
  if (fromAddress) {
    const parts = fromAddress.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
    if (parts.length === 1) return parts[0];
  }

  return '';
};

function RacesPageContent() {
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeWaitlistEventIds, setActiveWaitlistEventIds] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string>(ALL_OPTION);
  const [selectedState, setSelectedState] = useState<string>(ALL_OPTION);
  const [selectedCity, setSelectedCity] = useState<string>(ALL_OPTION);

  useEffect(() => {
    Promise.all([getCalendarEventsAction(), listWaitlistFormsAction()]).then(([result, waitlistResult]) => {
      if (result.success && result.events) {
        const now = new Date();
        const upcomingEvents = result.events.filter(event => {
          if (isEventHidden(event)) return false;
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
      if (waitlistResult.success && waitlistResult.forms) {
        setActiveWaitlistEventIds(
          waitlistResult.forms.filter(f => f.isActive).map(f => f.eventId)
        );
      }
      setIsLoading(false);
    });
  }, []);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const event of events) {
      const country = normalizeValue(event.country);
      if (country) set.add(country);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [events]);

  const states = useMemo(() => {
    const set = new Set<string>();
    for (const event of events) {
      const country = normalizeValue(event.country);
      const state = normalizeValue(normalizeStateNameForCountry(event.state, event.country));
      if (!state) continue;
      if (selectedCountry !== ALL_OPTION && country !== selectedCountry) continue;
      set.add(state);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [events, selectedCountry]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const event of events) {
      const country = normalizeValue(event.country);
      const state = normalizeValue(normalizeStateNameForCountry(event.state, event.country));
      const city = deriveCity(event);
      if (!city) continue;
      if (selectedCountry !== ALL_OPTION && country !== selectedCountry) continue;
      if (selectedState !== ALL_OPTION && state !== selectedState) continue;
      set.add(city);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [events, selectedCountry, selectedState]);

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      const country = normalizeValue(event.country);
      const state = normalizeValue(normalizeStateNameForCountry(event.state, event.country));
      const city = deriveCity(event);

      if (selectedCountry !== ALL_OPTION && country !== selectedCountry) return false;
      if (selectedState !== ALL_OPTION && state !== selectedState) return false;
      if (selectedCity !== ALL_OPTION && city !== selectedCity) return false;

      return true;
    });
  }, [events, selectedCountry, selectedState, selectedCity]);

  const handleCountryChange = (value: string) => {
    setSelectedCountry(value);
    setSelectedState(ALL_OPTION);
    setSelectedCity(ALL_OPTION);
  };

  const handleStateChange = (value: string) => {
    setSelectedState(value);
    setSelectedCity(ALL_OPTION);
  };

  return (
      <section className="w-full py-12 md:py-16">
        <div className="container px-4 md:px-6 mx-auto">
          <div className="space-y-4 text-center mb-12">
              <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl">All Upcoming Races</h1>
              <p className="max-w-[900px] mx-auto text-muted-foreground md:text-xl/relaxed">
                  Find your next challenge. Explore all upcoming Bergman events and secure your spot at the starting line.
              </p>

              <div className="mx-auto mt-6 grid w-full max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3 text-left">
                <Select value={selectedCountry} onValueChange={handleCountryChange}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue placeholder="Filter by country" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_OPTION}>All Countries</SelectItem>
                    {countries.map(country => (
                      <SelectItem key={country} value={country}>{country}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedState} onValueChange={handleStateChange}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue placeholder="Filter by state" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_OPTION}>All States</SelectItem>
                    {states.map(state => (
                      <SelectItem key={state} value={state}>{state}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedCity} onValueChange={setSelectedCity}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue placeholder="Filter by city" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_OPTION}>All Cities</SelectItem>
                    {cities.map(city => (
                      <SelectItem key={city} value={city}>{city}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
          </div>
          
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
              {isLoading ? (
                  <div className="col-span-full flex justify-center py-20"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>
              ) : filteredEvents.length > 0 ? (
                  filteredEvents.map((event) => (
                    <EventDisplayCard key={event.id} event={event} layout="horizontal" activeWaitlistEventIds={activeWaitlistEventIds} />
                  ))
              ) : (
                  <p className="col-span-full text-center text-muted-foreground py-20">No upcoming events match the selected Country/State/City filters.</p>
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
