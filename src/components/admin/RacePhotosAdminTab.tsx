"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, ExternalLink, Hash, Loader2, Search, Sparkles, Unlink2, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { getParticipantsForEventAction, searchSplitSecondPixEventsAction, updateCalendarEventAction } from '@/lib/actions';
import type { EventCalendarEntry } from '@/lib/types';
import type { SplitSecondPixSearchResult } from '@/lib/actions/racePhotoActions';

interface RacePhotosAdminTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

interface EventStats {
  totalParticipants: number;
  withBib: number;
  uniqueBibCount: number;
}

interface AdminBibPhotoImage {
  id: string | number;
  url: string;
  thumbnail_url?: string;
}

interface AdminBibPhotoResponse {
  images?: AdminBibPhotoImage[];
  redirectUrl?: string | null;
  galleryUrl?: string | null;
  error?: string;
  detail?: string;
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

export default function RacePhotosAdminTab({ events, isLoadingEvents, onDataRefresh }: RacePhotosAdminTabProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'mapping' | 'athlete-search'>('mapping');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [partnerQuery, setPartnerQuery] = useState('');
  const [partnerResults, setPartnerResults] = useState<SplitSecondPixSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [eventStats, setEventStats] = useState<EventStats>({ totalParticipants: 0, withBib: 0, uniqueBibCount: 0 });
  const [bibQuery, setBibQuery] = useState('');
  const [isBibSearching, setIsBibSearching] = useState(false);
  const [bibSearchResult, setBibSearchResult] = useState<{ images: AdminBibPhotoImage[]; redirectUrl?: string | null; galleryUrl?: string | null } | null>(null);
  const [bibSearchError, setBibSearchError] = useState<string | null>(null);
  const [isGalleryModalOpen, setIsGalleryModalOpen] = useState(false);

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const aTime = a?.eventDate ? new Date(a.eventDate).getTime() : 0;
      const bTime = b?.eventDate ? new Date(b.eventDate).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return String(a.eventName || '').localeCompare(String(b.eventName || ''));
    });
  }, [events]);

  useEffect(() => {
    if (!selectedEventId && sortedEvents.length > 0) {
      setSelectedEventId(sortedEvents[0].id);
    }
  }, [sortedEvents, selectedEventId]);

  const selectedEvent = useMemo(
    () => sortedEvents.find((event) => event.id === selectedEventId) || null,
    [sortedEvents, selectedEventId]
  );

  const mappedEventsCount = useMemo(
    () => events.filter((event) => String(event.splitSecondPixEventId || '').trim()).length,
    [events]
  );

  const runSearch = useCallback(async (queryOverride?: string) => {
    const nextQuery = (queryOverride ?? '').trim();
    if (!nextQuery) {
      setPartnerResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const result = await searchSplitSecondPixEventsAction(nextQuery);
      if (result.success) {
        setPartnerResults(result.events || []);
      } else {
        toast({ variant: 'destructive', title: 'Search failed', description: result.message });
      }
    } finally {
      setIsSearching(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!selectedEvent) return;
    setPartnerQuery(selectedEvent.eventName || '');
    runSearch(selectedEvent.eventName || '');
  }, [selectedEvent, runSearch]);

  useEffect(() => {
    if (!selectedEventId) return;
    setIsLoadingStats(true);
    getParticipantsForEventAction(selectedEventId)
      .then((result) => {
        const participants = result.success && result.participants ? result.participants : [];
        const bibs = participants
          .map((participant) => String(participant?.bibNumber || '').trim())
          .filter(Boolean);

        setEventStats({
          totalParticipants: participants.length,
          withBib: bibs.length,
          uniqueBibCount: new Set(bibs).size,
        });
      })
      .finally(() => setIsLoadingStats(false));
  }, [selectedEventId]);

  const handleMapEvent = async (partnerEvent: SplitSecondPixSearchResult) => {
    if (!selectedEvent) return;
    setIsSaving(true);
    try {
      const result = await updateCalendarEventAction(selectedEvent.id, {
        splitSecondPixEventId: partnerEvent.id,
        splitSecondPixEventName: partnerEvent.name,
        splitSecondPixEventSlug: partnerEvent.slug,
        splitSecondPixSearchByBib: partnerEvent.searchByBib,
        splitSecondPixSearchByFace: partnerEvent.searchByFace,
      });

      if (!result.success) {
        toast({ variant: 'destructive', title: 'Mapping failed', description: result.message });
        return;
      }

      toast({ title: 'Race photo mapping saved', description: `${selectedEvent.eventName} is now linked to ${partnerEvent.name}.` });
      onDataRefresh();
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearMapping = async () => {
    if (!selectedEvent) return;
    setIsSaving(true);
    try {
      const result = await updateCalendarEventAction(selectedEvent.id, {
        splitSecondPixEventId: null,
        splitSecondPixEventName: null,
        splitSecondPixEventSlug: null,
        splitSecondPixSearchByBib: null,
        splitSecondPixSearchByFace: null,
      });

      if (!result.success) {
        toast({ variant: 'destructive', title: 'Clear failed', description: result.message });
        return;
      }

      toast({ title: 'Race photo mapping cleared', description: `${selectedEvent.eventName} is no longer linked.` });
      onDataRefresh();
    } finally {
      setIsSaving(false);
    }
  };

  const handleBibSearch = useCallback(async () => {
    const bib = bibQuery.trim();
    const mappedEventId = String(selectedEvent?.splitSecondPixEventId || '').trim();

    if (!selectedEvent) {
      toast({ variant: 'destructive', title: 'Select an event', description: 'Please select an event first.' });
      return;
    }

    if (!mappedEventId) {
      toast({
        variant: 'destructive',
        title: 'Event not mapped',
        description: 'Please map this event with Split Second Pix before searching by bib.',
      });
      return;
    }

    if (!bib) {
      toast({ variant: 'destructive', title: 'Bib required', description: 'Enter a bib number to search photos.' });
      return;
    }

    setIsBibSearching(true);
    setBibSearchError(null);

    try {
      const mappedSlug = String(selectedEvent?.splitSecondPixEventSlug || '').trim();
      const params = new URLSearchParams({
        bib_number: bib,
        event_id: mappedEventId,
      });
      if (mappedSlug) {
        params.set('event_slug', mappedSlug);
      }

      const response = await fetch(`/api/race-photos?${params.toString()}`, { cache: 'no-store' });

      const json: AdminBibPhotoResponse = await response.json();
      if (!response.ok) {
        throw new Error(json.error || json.detail || 'Failed to fetch athlete photos');
      }

      const images = Array.isArray(json.images) ? json.images : [];
      setBibSearchResult({ images, redirectUrl: json.redirectUrl || null, galleryUrl: json.galleryUrl || null });

      if (images.length > 0) {
        toast({
          title: 'Photos found',
          description: `Found ${images.length} photo${images.length === 1 ? '' : 's'} for bib ${bib}.`,
        });
      } else {
        toast({
          title: 'Preview unavailable',
          description: `No preview photos returned by partner API for bib ${bib}. Open Athlete Gallery to verify full results.`,
        });
      }
    } catch (error: any) {
      const message = error?.message || 'Failed to fetch athlete photos';
      setBibSearchResult(null);
      setBibSearchError(message);
      toast({ variant: 'destructive', title: 'Search failed', description: message });
    } finally {
      setIsBibSearching(false);
    }
  }, [bibQuery, selectedEvent, toast]);

  return (
    <div className="space-y-6">
      <Card className="border-purple-500/20 bg-gradient-to-br from-purple-50 via-background to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-purple-600" /> Race Photos Mapping
          </CardTitle>
          <CardDescription>
            Link each Bergman event to its Split Second Pix event. New events appear here automatically because this tab reads the live events list.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border bg-background/80 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total events</p>
            <p className="mt-2 text-2xl font-semibold">{events.length}</p>
          </div>
          <div className="rounded-2xl border bg-background/80 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Mapped events</p>
            <p className="mt-2 text-2xl font-semibold">{mappedEventsCount}</p>
          </div>
          <div className="rounded-2xl border bg-background/80 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Participants</p>
            <p className="mt-2 text-2xl font-semibold">{isLoadingStats ? '…' : eventStats.totalParticipants}</p>
          </div>
          <div className="rounded-2xl border bg-background/80 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Participants with bibs</p>
            <p className="mt-2 text-2xl font-semibold">{isLoadingStats ? '…' : eventStats.withBib}</p>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'mapping' | 'athlete-search')} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 rounded-xl">
          <TabsTrigger value="mapping" className="rounded-lg">Event Mapping</TabsTrigger>
          <TabsTrigger value="athlete-search" className="rounded-lg">Athlete Bib Search</TabsTrigger>
        </TabsList>

        <TabsContent value="mapping" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Select Bergman Event</CardTitle>
                <CardDescription>Choose the internal event to map with Split Second Pix.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select value={selectedEventId} onValueChange={setSelectedEventId} disabled={isLoadingEvents || events.length === 0}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select internal event" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedEvents.map((event) => (
                      <SelectItem key={event.id} value={event.id}>
                        {event.eventName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedEvent ? (
                  <div className="rounded-2xl border bg-muted/30 p-4 space-y-3">
                    <div>
                      <p className="font-medium text-foreground">{selectedEvent.eventName}</p>
                      <p className="text-sm text-muted-foreground">{formatDate(selectedEvent.eventDate)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedEvent.splitSecondPixEventId ? (
                        <>
                          <Badge className="bg-emerald-600 hover:bg-emerald-600">Mapped</Badge>
                          <Badge variant="outline">SSP ID: {selectedEvent.splitSecondPixEventId}</Badge>
                          {selectedEvent.splitSecondPixSearchByFace && <Badge variant="secondary">Face Search</Badge>}
                          {selectedEvent.splitSecondPixSearchByBib && <Badge variant="secondary">Bib Search</Badge>}
                        </>
                      ) : (
                        <Badge variant="outline">Not mapped yet</Badge>
                      )}
                    </div>
                    {selectedEvent.splitSecondPixEventSlug && (
                      <a
                        href={`https://new.splitsecondpix.com/events/${selectedEvent.splitSecondPixEventSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary underline hover:no-underline"
                      >
                        Open mapped partner event <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border bg-background p-3">
                        <p className="text-xs text-muted-foreground">With bib numbers</p>
                        <p className="mt-1 font-semibold">{isLoadingStats ? 'Loading…' : eventStats.withBib}</p>
                      </div>
                      <div className="rounded-xl border bg-background p-3">
                        <p className="text-xs text-muted-foreground">Unique bibs</p>
                        <p className="mt-1 font-semibold">{isLoadingStats ? 'Loading…' : eventStats.uniqueBibCount}</p>
                      </div>
                    </div>
                    <Button variant="outline" onClick={handleClearMapping} disabled={!selectedEvent.splitSecondPixEventId || isSaving} className="w-full rounded-xl gap-2">
                      {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink2 className="h-4 w-4" />} Clear Mapping
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                    Select an event to manage its photo mapping.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-purple-600" /> Split Second Pix Search</CardTitle>
                <CardDescription>Search the partner event list and link the correct event to the selected Bergman event.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={partnerQuery}
                      onChange={(e) => setPartnerQuery(e.target.value)}
                      placeholder="Search Split Second Pix events"
                      className="rounded-xl pl-9"
                    />
                  </div>
                  <Button onClick={() => runSearch(partnerQuery)} disabled={isSearching} className="rounded-xl gap-2">
                    {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
                  </Button>
                </div>

                <div className="rounded-2xl border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Partner event</TableHead>
                        <TableHead>Search types</TableHead>
                        <TableHead>Slug</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isSearching ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                          </TableCell>
                        </TableRow>
                      ) : partnerResults.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                            No Split Second Pix events found for this search.
                          </TableCell>
                        </TableRow>
                      ) : partnerResults.map((result) => (
                        <TableRow key={result.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium">{result.name}</p>
                              <p className="text-xs text-muted-foreground inline-flex items-center gap-1"><Hash className="h-3 w-3" /> {result.id}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              {result.searchByBib && <Badge variant="secondary">Bib</Badge>}
                              {result.searchByFace && <Badge className="bg-pink-600 hover:bg-pink-600">Face</Badge>}
                              {!result.searchByBib && !result.searchByFace && <Badge variant="outline">Unknown</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{result.slug || '—'}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              {result.eventUrl && (
                                <Button asChild variant="outline" size="sm" className="rounded-lg">
                                  <a href={result.eventUrl} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                </Button>
                              )}
                              <Button size="sm" className="rounded-lg" onClick={() => handleMapEvent(result)} disabled={!selectedEvent || isSaving}>
                                Link event
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-purple-600" /> Event Mapping Overview</CardTitle>
              <CardDescription>Every new event is listed here automatically. Unmapped events are easy to spot.</CardDescription>
            </CardHeader>
            <CardContent className="rounded-2xl border overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Partner mapping</TableHead>
                    <TableHead className="text-right">Manage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium">{event.eventName}</p>
                          <p className="text-xs text-muted-foreground">{event.id}</p>
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(event.eventDate)}</TableCell>
                      <TableCell>
                        {event.splitSecondPixEventId ? (
                          <div className="flex flex-wrap gap-2">
                            <Badge className="bg-emerald-600 hover:bg-emerald-600">Mapped</Badge>
                            <Badge variant="outline">{event.splitSecondPixEventName || event.splitSecondPixEventId}</Badge>
                          </div>
                        ) : (
                          <Badge variant="outline">Unmapped</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setSelectedEventId(event.id)}>
                          Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="athlete-search" className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-4 w-4 text-purple-600" /> Search Athlete Photos by Bib
              </CardTitle>
              <CardDescription>
                Select a mapped event and bib number to search Split Second Pix photos for a specific athlete.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_200px_auto]">
                <Select value={selectedEventId} onValueChange={setSelectedEventId} disabled={isLoadingEvents || events.length === 0}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select mapped event" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedEvents.map((event) => (
                      <SelectItem key={event.id} value={event.id}>
                        {event.eventName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  value={bibQuery}
                  onChange={(e) => setBibQuery(e.target.value)}
                  placeholder="Enter bib number"
                  className="rounded-xl"
                />

                <Button onClick={handleBibSearch} disabled={isBibSearching} className="rounded-xl gap-2">
                  {isBibSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
                </Button>
              </div>

              <div className="rounded-2xl border bg-muted/20 p-4 space-y-3">
                {selectedEvent ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{selectedEvent.eventName}</Badge>
                      {selectedEvent.splitSecondPixEventId ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Mapped</Badge>
                      ) : (
                        <Badge variant="destructive">Not mapped</Badge>
                      )}
                      {selectedEvent.splitSecondPixEventId && <Badge variant="secondary">SSP ID: {selectedEvent.splitSecondPixEventId}</Badge>}
                    </div>

                    {selectedEvent.splitSecondPixEventSlug && (
                      <a
                        href={`https://new.splitsecondpix.com/events/${selectedEvent.splitSecondPixEventSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary underline hover:no-underline"
                      >
                        Open mapped partner event <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Select an event to begin bib search.</p>
                )}
              </div>

              {bibSearchError && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  {bibSearchError}
                </div>
              )}

              {!bibSearchError && bibSearchResult && (
                <div className="rounded-2xl border bg-background p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">Bib #{bibQuery.trim()}</Badge>
                    <Badge variant="outline">{bibSearchResult.images.length} photos</Badge>
                  </div>

                  {bibSearchResult.images.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No preview photos returned for this bib. Use Open Athlete Gallery to verify the full event result page.</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Preview loaded successfully. You can also open the full gallery.</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button asChild className="rounded-xl gap-2">
                      <a
                        href={bibSearchResult.galleryUrl || bibSearchResult.redirectUrl || (selectedEvent?.splitSecondPixEventSlug ? `https://new.splitsecondpix.com/events/${selectedEvent.splitSecondPixEventSlug}/${encodeURIComponent(bibQuery.trim())}#search-result` : 'https://new.splitsecondpix.com')}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Athlete Gallery <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                    {!!(bibSearchResult.galleryUrl || bibSearchResult.redirectUrl) && (
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => setIsGalleryModalOpen(true)}
                      >
                        Open in Modal
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isGalleryModalOpen} onOpenChange={setIsGalleryModalOpen}>
        <DialogContent className="w-[95vw] max-w-6xl p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 border-b">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle className="text-left">Split Second Pix Athlete Gallery</DialogTitle>
              {(bibSearchResult?.galleryUrl || bibSearchResult?.redirectUrl) && (
                <Button asChild size="sm" variant="outline" className="gap-2 rounded-lg">
                  <a
                    href={bibSearchResult?.galleryUrl || bibSearchResult?.redirectUrl || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in New Tab <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="h-[75vh] bg-background">
            {(bibSearchResult?.galleryUrl || bibSearchResult?.redirectUrl) ? (
              <div className="h-full w-full">
                <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                  If partner checkout opens inside the modal, use <span className="font-semibold text-foreground">Open in New Tab</span> above for purchase flow.
                </div>
                <iframe
                  title="Split Second Pix Athlete Gallery"
                  src={bibSearchResult?.galleryUrl || bibSearchResult?.redirectUrl || undefined}
                  className="h-[calc(100%-37px)] w-full"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
                />
              </div>
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
