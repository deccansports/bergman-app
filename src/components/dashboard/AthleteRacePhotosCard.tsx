"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Camera, ChevronDown, ChevronUp, ExternalLink, Loader2, UserRoundSearch } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/context/AuthContext';
import { getAthleteRegisteredEventsAction } from '@/lib/actions';

interface AthletePhotoImage {
  id: string | number;
  url: string;
  thumbnail_url?: string;
  download_url?: string | null;
}

interface AthletePhotoApiResponse {
  images?: AthletePhotoImage[];
  redirectUrl?: string | null;
  galleryUrl?: string | null;
  productType?: string | null;
  error?: string;
}

interface AthleteMappedEvent {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  bibNumber: string;
  splitSecondPixEventId: string;
  splitSecondPixEventSlug?: string | null;
  splitSecondPixSearchByFace?: boolean | null;
}

interface AthletePhotoResult extends AthleteMappedEvent {
  images: AthletePhotoImage[];
  redirectUrl?: string | null;
  galleryUrl?: string | null;
}

function formatDate(value?: string | null) {
  if (!value) return null;
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

export default function AthleteRacePhotosCard() {
  const { currentUser } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [results, setResults] = useState<AthletePhotoResult[]>([]);
  const [activeGalleryUrl, setActiveGalleryUrl] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function load() {
      if (!currentUser?.uid) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const res = await getAthleteRegisteredEventsAction(currentUser.uid, currentUser.email || null, { upcomingOnly: false });
        const mappedEvents: AthleteMappedEvent[] = (res.success && res.events ? res.events : [])
          .filter((event) => event.athleteBibNumber && event.splitSecondPixEventId)
          .map((event) => ({
            eventId: event.eventId,
            eventName: event.eventName,
            eventDate: event.eventDate,
            bibNumber: String(event.athleteBibNumber || '').trim(),
            splitSecondPixEventId: String(event.splitSecondPixEventId || '').trim(),
            splitSecondPixEventSlug: event.splitSecondPixEventSlug || null,
            splitSecondPixSearchByFace: event.splitSecondPixSearchByFace ?? null,
          }))
          .filter((event) => event.bibNumber && event.splitSecondPixEventId)
          .reduce<AthleteMappedEvent[]>((acc, event) => {
            const dedupeKey = `${String(event.eventId || '').trim()}::${String(event.bibNumber || '').trim()}`;
            if (!dedupeKey.trim()) return acc;
            if (acc.some((item) => `${String(item.eventId || '').trim()}::${String(item.bibNumber || '').trim()}` === dedupeKey)) {
              return acc;
            }
            acc.push(event);
            return acc;
          }, [])
          .sort((a, b) => {
            const aTime = a?.eventDate ? new Date(a.eventDate).getTime() : 0;
            const bTime = b?.eventDate ? new Date(b.eventDate).getTime() : 0;
            return bTime - aTime;
          });

        const photoResults = await Promise.all(
          mappedEvents.map(async (event) => {
            const fallbackGalleryUrl = event.splitSecondPixEventSlug
              ? `https://new.splitsecondpix.com/events/${event.splitSecondPixEventSlug}/${encodeURIComponent(event.bibNumber)}#search-result`
              : null;

            try {
              const params = new URLSearchParams({
                bib_number: event.bibNumber,
                event_id: event.splitSecondPixEventId,
              });
              if (event.splitSecondPixEventSlug) {
                params.set('event_slug', event.splitSecondPixEventSlug);
              }

              const photoRes = await fetch(`/api/race-photos?${params.toString()}`, { cache: 'no-store' });

              const json: AthletePhotoApiResponse = await photoRes.json();
              if (!photoRes.ok) {
                return null;
              }

              const images = Array.isArray(json.images) ? json.images : [];
              const galleryUrl = json.galleryUrl || fallbackGalleryUrl;
              const redirectUrl = json.redirectUrl || null;

              return {
                ...event,
                images,
                redirectUrl,
                galleryUrl,
              } satisfies AthletePhotoResult;
            } catch {
              return {
                ...event,
                images: [],
                redirectUrl: null,
                galleryUrl: fallbackGalleryUrl,
              } satisfies AthletePhotoResult;
            }
          })
        );

        if (!ignore) {
          setResults(photoResults as AthletePhotoResult[]);
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [currentUser?.uid, currentUser?.email]);

  const titleText = useMemo(() => {
    if (results.length === 0) return 'My Race Photos';
    return `My Race Photos (${results.length})`;
  }, [results.length]);

  const totalPhotos = useMemo(() => {
    return results.reduce((sum, result) => sum + result.images.length, 0);
  }, [results]);

  const eventsWithGallery = useMemo(() => {
    return results.filter((result) => !!(result.galleryUrl || result.redirectUrl || result.splitSecondPixEventSlug)).length;
  }, [results]);

  if (!currentUser) return null;

  return (
    <Card className="shadow-sm border-emerald-500/20 bg-gradient-to-br from-emerald-50 via-background to-cyan-50 dark:from-emerald-950/20 dark:to-cyan-950/20 overflow-hidden">
      <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-sky-500" />
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Camera className="h-5 w-5 text-emerald-600" /> {titleText}
            </CardTitle>
            <CardDescription>
              Directly matched using your registered event and bib details, then fetched from Split Second Pix.
            </CardDescription>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-2 rounded-xl"
            onClick={() => setIsExpanded((prev) => !prev)}
          >
            {isExpanded ? 'Collapse' : 'Expand'}
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {!isLoading && results.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Badge variant="outline">{totalPhotos} preview photos</Badge>
            <Badge variant="secondary">{results.length} linked event{results.length === 1 ? '' : 's'}</Badge>
            <Badge variant="outline">{eventsWithGallery} events with gallery</Badge>
          </div>
        )}
      </CardHeader>
      <CardContent className={isExpanded ? 'space-y-5' : 'pt-0'}>
        {isLoading && (
          <div className="grid gap-4">
            {[...Array(2)].map((_, index) => (
              <Skeleton key={index} className="h-48 rounded-2xl" />
            ))}
          </div>
        )}

        {!isLoading && results.length === 0 && (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No mapped race-photo events found for your registrations yet.
          </div>
        )}

        {!isLoading && isExpanded && results.map((result) => (
          <div key={`${result.eventId}-${result.bibNumber}`} className="rounded-2xl border bg-background/80 p-4 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div>
                  <p className="text-lg font-semibold text-foreground">{result.eventName}</p>
                  <p className="text-sm text-muted-foreground">{formatDate(result.eventDate) || 'TBD'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Bib #{result.bibNumber}</Badge>
                  <Badge variant="outline">
                    {result.images.length > 0
                      ? `${result.images.length} preview photos`
                      : (result.galleryUrl || result.redirectUrl || result.splitSecondPixEventSlug)
                        ? 'Photos in gallery'
                        : '0 photos'}
                  </Badge>
                  {result.splitSecondPixSearchByFace && <Badge className="bg-pink-600 hover:bg-pink-600">Face Search</Badge>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild className="rounded-xl gap-2">
                  <a
                    href={result.galleryUrl || result.redirectUrl || (result.splitSecondPixEventSlug ? `https://new.splitsecondpix.com/events/${result.splitSecondPixEventSlug}/${encodeURIComponent(result.bibNumber)}#search-result` : 'https://new.splitsecondpix.com')}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open My Gallery <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => setActiveGalleryUrl(result.galleryUrl || result.redirectUrl || (result.splitSecondPixEventSlug ? `https://new.splitsecondpix.com/events/${result.splitSecondPixEventSlug}/${encodeURIComponent(result.bibNumber)}#search-result` : null))}
                  disabled={!result.galleryUrl && !result.redirectUrl && !result.splitSecondPixEventSlug}
                >
                  Open in Modal
                </Button>
                {result.splitSecondPixSearchByFace && result.splitSecondPixEventSlug && (
                  <Button asChild variant="outline" className="rounded-xl gap-2">
                    <a
                      href={`https://new.splitsecondpix.com/events/${result.splitSecondPixEventSlug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Face Search <UserRoundSearch className="h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            </div>

            {result.images.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {result.images.slice(0, 6).map((image) => (
                  <div key={image.id} className="relative overflow-hidden rounded-xl border bg-muted aspect-square">
                    <Image
                      src={image.thumbnail_url || image.url}
                      alt={result.eventName}
                      fill
                      unoptimized
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Preview photos are unavailable from partner API for this bib. Open gallery to view full results.</p>
            )}

            {result.images.length > 6 && (
              <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5" /> {result.images.length - 6} more photos available in the full gallery.
              </p>
            )}
          </div>
        ))}

        {!isLoading && results.length > 0 && !isExpanded && (
          <div className="rounded-2xl border border-dashed border-emerald-500/25 bg-background/70 p-5 text-sm text-muted-foreground">
            Expand to view your race photos, linked events, and gallery actions.
          </div>
        )}
      </CardContent>

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
              <div className="h-full w-full">
                <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                  If partner checkout opens inside the modal, use <span className="font-semibold text-foreground">Open in New Tab</span> above for purchase flow.
                </div>
                <iframe
                  title="Split Second Pix Gallery"
                  src={activeGalleryUrl}
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
    </Card>
  );
}
