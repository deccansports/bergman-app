// src/components/layout/UpcomingEventsSection.tsx
"use client";

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Calendar, ArrowRight, Loader2 } from 'lucide-react';
import type { EventCalendarEntry } from '@/lib/types';
import EventDisplayCard from '../events/EventDisplayCard';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isEventHidden, normalizeStateNameForCountry } from '@/lib/utils';

interface UpcomingEventsSectionProps {
  events: EventCalendarEntry[];
  isLoading: boolean;
  activeWaitlistEventIds?: string[];
}

const ALL_OPTION = 'ALL';

const normalize = (value?: string | null) => (value || '').trim();

const deriveCity = (event: EventCalendarEntry): string => {
  const direct = normalize(event.city);
  if (direct) return direct;

  const address = normalize(event.address);
  if (!address) return '';

  const parts = address.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || '';
};

export default function UpcomingEventsSection({ events, isLoading, activeWaitlistEventIds }: UpcomingEventsSectionProps) {
  const [search, setSearch] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<string>(ALL_OPTION);
  const [selectedState, setSelectedState] = useState<string>(ALL_OPTION);
  const [selectedCity, setSelectedCity] = useState<string>(ALL_OPTION);

  const countries = useMemo(() => {
    const set = new Set<string>();
    events.forEach(event => {
      const country = normalize(event.country);
      if (country) set.add(country);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [events]);

  const states = useMemo(() => {
    const set = new Set<string>();
    events.forEach(event => {
      const country = normalize(event.country);
      const state = normalize(normalizeStateNameForCountry(event.state, event.country));
      if (!state) return;
      if (selectedCountry !== ALL_OPTION && country !== selectedCountry) return;
      set.add(state);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [events, selectedCountry]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    events.forEach(event => {
      const country = normalize(event.country);
      const state = normalize(normalizeStateNameForCountry(event.state, event.country));
      const city = deriveCity(event);
      if (!city) return;
      if (selectedCountry !== ALL_OPTION && country !== selectedCountry) return;
      if (selectedState !== ALL_OPTION && state !== selectedState) return;
      set.add(city);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [events, selectedCountry, selectedState]);

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter(event => {
      if (isEventHidden(event)) return false;

      const country = normalize(event.country);
      const state = normalize(normalizeStateNameForCountry(event.state, event.country));
      const city = deriveCity(event);

      if (selectedCountry !== ALL_OPTION && country !== selectedCountry) return false;
      if (selectedState !== ALL_OPTION && state !== selectedState) return false;
      if (selectedCity !== ALL_OPTION && city !== selectedCity) return false;

      if (!term) return true;

      const haystack = [
        event.eventName,
        event.venueName,
        event.address,
        country,
        state,
        city,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [events, search, selectedCountry, selectedState, selectedCity]);

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
    <section id="events" className="w-full py-12 md:py-24 lg:py-32">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl">Upcoming Events</h2>
            <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
              Join the Next Challenge. Find your next race and be part of the Bergman experience. Registration is just a click away.
            </p>

            <div className="mx-auto mt-4 grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search event / venue / city"
                className="h-10 rounded-xl"
              />

              <Select value={selectedCountry} onValueChange={handleCountryChange}>
                <SelectTrigger className="h-10 rounded-xl">
                  <SelectValue placeholder="Country" />
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
                  <SelectValue placeholder="State" />
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
                  <SelectValue placeholder="City" />
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
        </div>
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 py-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {isLoading ? (
            <div className="col-span-full flex justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>
          ) : filteredEvents.length > 0 ? (
            filteredEvents.map(event => (
              <EventDisplayCard key={event.id} event={event} layout="vertical" activeWaitlistEventIds={activeWaitlistEventIds} />
            ))
          ) : (
            <p className="col-span-full text-center text-muted-foreground">No upcoming events match your search/filters.</p>
          )}
        </div>
      </div>
    </section>
  );
}
