// src/components/dashboard/RacePhotosCard.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Camera, ExternalLink, RefreshCw, Search, UserRoundSearch, CalendarDays, AlertCircle, Loader2, Mail, Phone, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getMappedRacePhotoEventsAction, findRacePhotoParticipantsAction } from '@/lib/actions';
import type { MappedRacePhotoEvent } from '@/lib/actions/racePhotoActions';

type EventsResponse = {
  success?: boolean;
  events?: MappedRacePhotoEvent[];
  message?: string;
  error?: string;
};

function extractYear(value: string) {
  const match = value.match(/(20\d{2})/);
  return match?.[1] ?? null;
}

function formatDate(value?: string | null) {
  if (!value) return 'TBD';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

type LookupMatch = {
  participantId: string;
  athleteName: string;
  bibNumber: string;
  ticketName?: string | null;
  email?: string | null;
  mobile?: string | null;
};

function buildDirectGalleryUrl(event: MappedRacePhotoEvent, bibNumber: string) {
  if (event.splitSecondPixEventSlug && bibNumber) {
    return `https://new.splitsecondpix.com/events/${encodeURIComponent(event.splitSecondPixEventSlug)}/${encodeURIComponent(bibNumber)}#search-result`;
  }
  return event.eventUrl || 'https://new.splitsecondpix.com';
}

async function resolveGalleryUrl(event: MappedRacePhotoEvent, bibNumber: string) {
  const params = new URLSearchParams({
    bib_number: bibNumber,
    event_id: event.splitSecondPixEventId,
  });
  if (event.splitSecondPixEventSlug) params.set('event_slug', event.splitSecondPixEventSlug);

  try {
    const response = await fetch(`/api/race-photos?${params.toString()}`, { cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    return json?.galleryUrl || json?.redirectUrl || buildDirectGalleryUrl(event, bibNumber);
  } catch {
    return buildDirectGalleryUrl(event, bibNumber);
  }
}

function EventCard({ event, defaultIdentifier }: { event: MappedRacePhotoEvent; defaultIdentifier?: string }) {
  const year = extractYear(event.eventName || event.splitSecondPixEventName || '');
  const [identifier, setIdentifier] = useState(defaultIdentifier || '');
  const [lookupMatches, setLookupMatches] = useState<LookupMatch[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [activeGalleryUrl, setActiveGalleryUrl] = useState<string | null>(null);
  const [isResolvingBib, setIsResolvingBib] = useState<string | null>(null);

  useEffect(() => {
    if (!identifier && defaultIdentifier) setIdentifier(defaultIdentifier);
  }, [defaultIdentifier, identifier]);

  const handleLookup = async () => {
    const cleaned = identifier.trim();
    if (!cleaned) {
      setLookupError('Enter the same registered email or mobile number used for this event.');
      setLookupMatches([]);
      return;
    }

    setIsSearching(true);
    setLookupError(null);
    try {
      const result = await findRacePhotoParticipantsAction(event.eventId, cleaned);
      if (result.success && result.participants) {
        setLookupMatches(result.participants as LookupMatch[]);
      } else {
        setLookupMatches([]);
        setLookupError(result.message || 'No matching bib found for this event.');
      }
    } catch (error: any) {
      setLookupMatches([]);
      setLookupError(error?.message || 'Failed to search this event.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleOpenGallery = async (match: LookupMatch, mode: 'modal' | 'tab') => {
    setIsResolvingBib(match.bibNumber);
    const newTab = mode === 'tab' ? window.open('', '_blank', 'noopener,noreferrer') : null;
    try {
      const url = await resolveGalleryUrl(event, match.bibNumber);
      if (mode === 'modal') {
        setActiveGalleryUrl(url);
      } else if (newTab) {
        newTab.location.href = url;
      }
    } finally {
      setIsResolvingBib(null);
    }
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-background/80 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">{event.eventName}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
                Event
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                <CalendarDays className="mr-1 h-3.5 w-3.5" /> {formatDate(event.eventDate)}
              </Badge>
              {year && (
                <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                  <CalendarDays className="mr-1 h-3.5 w-3.5" /> {year}
                </Badge>
              )}
              {event.splitSecondPixSearchByFace && (
                <Badge className="rounded-full px-3 py-1 text-xs bg-pink-600 hover:bg-pink-600">
                  Face Search
                </Badge>
              )}
              {event.splitSecondPixSearchByBib && (
                <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                  Bib Search
                </Badge>
              )}
            </div>
          </div>

          {event.splitSecondPixEventName && event.splitSecondPixEventName !== event.eventName && (
            <p className="text-xs text-muted-foreground">
              Partner listing: {event.splitSecondPixEventName}
            </p>
          )}

          <p className="text-sm text-muted-foreground max-w-2xl">
            Photos are fetched from our photos partner Split Second Pix. Open this event to continue with gallery browsing and, when enabled, face search.
          </p>

          <div className="rounded-xl border border-purple-500/15 bg-purple-50/70 p-4 dark:bg-purple-950/10 space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Find my bib using registered email or mobile</p>
              <p className="text-xs text-muted-foreground">
                Works even if you are not logged in. We match your registration for this event and open the linked Split Second Pix gallery using your bib.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                {identifier.includes('@') ? <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /> : <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />}
                <Input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Enter registered email or mobile"
                  className="h-11 rounded-xl pl-9"
                />
              </div>
              <Button onClick={handleLookup} disabled={isSearching} className="rounded-xl gap-2 h-11">
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Find My Photos
              </Button>
            </div>
            {lookupError && <p className="text-xs text-destructive">{lookupError}</p>}
            {lookupMatches.length > 0 && (
              <div className="space-y-2">
                {lookupMatches.map((match) => (
                  <div key={match.participantId} className="rounded-xl border bg-background/90 p-3">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{match.athleteName}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <Badge variant="secondary">Bib #{match.bibNumber}</Badge>
                          {match.ticketName && <Badge variant="outline">{match.ticketName}</Badge>}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          className="rounded-xl gap-2"
                          onClick={() => handleOpenGallery(match, 'tab')}
                          disabled={isResolvingBib === match.bibNumber}
                        >
                          {isResolvingBib === match.bibNumber ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                          Open My Gallery
                        </Button>
                        <Button
                          variant="outline"
                          className="rounded-xl gap-2"
                          onClick={() => handleOpenGallery(match, 'modal')}
                          disabled={isResolvingBib === match.bibNumber}
                        >
                          {isResolvingBib === match.bibNumber ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                          Open in Modal
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row md:flex-col md:min-w-[180px]">
          <Button asChild className="rounded-xl gap-2">
            <a href={event.eventUrl || 'https://new.splitsecondpix.com'} target="_blank" rel="noopener noreferrer">
              View Event Photos <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
          <Button asChild variant="outline" className="rounded-xl gap-2">
            <a href={(event.splitSecondPixSearchByFace && event.eventUrl) ? event.eventUrl : 'https://new.splitsecondpix.com/contact-us'} target="_blank" rel="noopener noreferrer">
              {event.splitSecondPixSearchByFace ? 'Face Search' : 'Partner Support'} <UserRoundSearch className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>

      <Dialog open={!!activeGalleryUrl} onOpenChange={(open) => !open && setActiveGalleryUrl(null)}>
        <DialogContent className="w-[95vw] max-w-6xl p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 border-b">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle className="text-left">Split Second Pix Gallery</DialogTitle>
              {activeGalleryUrl && (
                <Button asChild size="sm" variant="outline" className="gap-2 rounded-lg">
                  <a href={activeGalleryUrl} target="_blank" rel="noopener noreferrer">
                    Open in New Tab <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="h-[75vh] bg-background">
            {activeGalleryUrl ? (
              <iframe
                title="Split Second Pix Gallery"
                src={activeGalleryUrl}
                className="h-full w-full"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
                Gallery URL unavailable.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function RacePhotosCard() {
  const { currentUser } = useAuth();
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [events, setEvents] = useState<MappedRacePhotoEvent[]>([]);
  const [search, setSearch] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);

    try {
      const json: EventsResponse = await getMappedRacePhotoEventsAction();
      if (!json.success) {
        throw new Error(json.error || json.message || 'Failed to load mapped race photo events');
      }

      const nextEvents = Array.isArray(json.events) ? json.events : [];
      setEvents(nextEvents);
      setStatus('done');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to load mapped race photo events');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      const matchesSearch =
        !query ||
        event.eventName.toLowerCase().includes(query) ||
        String(event.splitSecondPixEventName || '').toLowerCase().includes(query) ||
        String(event.splitSecondPixEventSlug || '').toLowerCase().includes(query) ||
        formatDate(event.eventDate).toLowerCase().includes(query) ||
        (extractYear(event.eventName)?.includes(query) ?? false);

      return matchesSearch;
    });
  }, [events, search]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.eventId === selectedEventId) || null,
    [events, selectedEventId]
  );

  const defaultIdentifier = useMemo(() => {
    const email = String(currentUser?.email || '').trim();
    const mobile = String(currentUser?.mobile || '').trim();
    return email || mobile || '';
  }, [currentUser?.email, currentUser?.mobile]);

  return (
    <Card className="shadow-lg border-purple-500/20 bg-gradient-to-br from-purple-50 via-background to-pink-50 dark:from-purple-950/30 dark:via-background dark:to-pink-950/20 overflow-hidden">
      <div className="h-1 w-full bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500" />

      <CardHeader className="space-y-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-md shrink-0">
              <Camera className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-xl font-bold tracking-tight bg-gradient-to-r from-purple-700 to-pink-600 dark:from-purple-400 dark:to-pink-400 bg-clip-text text-transparent">
                Race Photos
              </CardTitle>
              <CardDescription className="text-sm">
                Your official race photos powered by{' '}
                <a
                  href="https://new.splitsecondpix.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:no-underline inline-flex items-center gap-1"
                >
                  Split Second Pix <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </CardDescription>
            </div>
          </div>

          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={load} disabled={status === 'loading'}>
            <RefreshCw className={cn('h-4 w-4', status === 'loading' && 'animate-spin')} />
          </Button>
        </div>

        <div className="rounded-2xl border border-purple-500/15 bg-background/70 p-4 text-sm text-muted-foreground">
          Everything is handled by Split Second Pix. We map their event galleries here for quick access. If you have questions, contact{' '}
          <a
            href="https://new.splitsecondpix.com/contact-us"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:no-underline"
          >
            Split Second Pix support
          </a>
          .
        </div>

        <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search event, year, or slug"
              className="h-11 rounded-xl pl-9"
            />
          </div>
          <Select value={selectedEventId} onValueChange={setSelectedEventId}>
            <SelectTrigger className="h-11 rounded-xl">
              <SelectValue placeholder="Select an event" />
            </SelectTrigger>
            <SelectContent>
              {filteredEvents.map((event) => (
                <SelectItem key={event.eventId} value={event.eventId}>
                  {event.eventName} {formatDate(event.eventDate) ? `• ${formatDate(event.eventDate)}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        {status === 'loading' && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-purple-500" />
              Fetching mapped race photo events…
            </div>
            <div className="grid gap-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-36 rounded-2xl" />
              ))}
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertCircle className="h-10 w-10 text-destructive/70" />
            <p className="text-sm text-muted-foreground max-w-md">{errorMsg}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" onClick={load} className="rounded-xl gap-2">
                <RefreshCw className="h-4 w-4" /> Retry
              </Button>
              <Button asChild className="rounded-xl gap-2">
                <a href="https://new.splitsecondpix.com/contact-us" target="_blank" rel="noopener noreferrer">
                  Contact Partner <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        )}

        {status === 'done' && events.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Camera className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-base font-medium text-foreground">No race photos found yet.</p>
            <p className="text-sm text-muted-foreground max-w-md">
              Photos are usually available 24–48 hours after your race. Check back soon!
            </p>
          </div>
        )}

        {status === 'done' && events.length > 0 && !selectedEvent && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Camera className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-base font-medium text-foreground">Select an event to continue.</p>
            <p className="text-sm text-muted-foreground max-w-md">
              Choose one mapped Bergman event from the dropdown to open its Split Second Pix gallery and search options.
            </p>
          </div>
        )}

        {status === 'done' && selectedEvent && (
          <div className="space-y-4">
            <EventCard key={selectedEvent.eventId} event={selectedEvent} defaultIdentifier={defaultIdentifier} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

