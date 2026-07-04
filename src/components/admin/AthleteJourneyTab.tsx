"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ExternalLink, Copy, Sparkles, Upload, Loader2 } from 'lucide-react';
import type { EventCalendarEntry } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { isBefore, parseISO, startOfDay } from 'date-fns';

interface AthleteJourneyTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function AthleteJourneyTab({ events, isLoadingEvents }: AthleteJourneyTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState('');
  const [bibNumber, setBibNumber] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const upcomingEvents = useMemo(() => {
    const today = startOfDay(new Date());
    return (events || []).filter((e) => {
      if (!e?.eventDate) return true;
      try {
        return !isBefore(parseISO(e.eventDate), today);
      } catch {
        return true;
      }
    });
  }, [events]);

  useEffect(() => {
    if (typeof window !== 'undefined') setBaseUrl(window.location.origin);
  }, []);

  useEffect(() => {
    if (!selectedEventId && upcomingEvents?.length > 0) {
      setSelectedEventId(upcomingEvents[0].id);
      return;
    }

    if (selectedEventId && !upcomingEvents.some((e) => e.id === selectedEventId)) {
      setSelectedEventId(upcomingEvents[0]?.id || '');
    }
  }, [selectedEventId, upcomingEvents]);

  const links = useMemo(() => {
    if (!baseUrl || !selectedEventId) {
      return { pre: '', post: '' };
    }

    const params = new URLSearchParams();
    params.set('eventId', selectedEventId);
    if (bibNumber.trim()) params.set('bib', bibNumber.trim());
    const q = params.toString();
    return {
      pre: `${baseUrl}/athlete-journey/race?${q}`,
      post: `${baseUrl}/athlete-journey/result?${q}`,
    };
  }, [baseUrl, selectedEventId, bibNumber]);

  const selectedEvent = useMemo(() => {
    return upcomingEvents.find((e) => e.id === selectedEventId) || null;
  }, [upcomingEvents, selectedEventId]);

  const handleLogoUpload = async () => {
    if (!selectedEventId || !logoFile || isUploadingLogo) return;
    setIsUploadingLogo(true);

    try {
      const formData = new FormData();
      formData.append('file', logoFile);
      formData.append('type', 'finishLedLogoUrl');
      formData.append('eventId', selectedEventId);

      const response = await fetch('/api/admin/upload-event-asset', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || 'Logo upload failed');
      }

      setLogoFile(null);
      toast({ title: 'Logo updated', description: 'Athlete Journey page logo saved for this event.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: error?.message || 'Could not upload logo.' });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const copy = async (value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast({ title: 'Copied', description: 'Link copied to clipboard.' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> Athlete Journey Links
        </CardTitle>
        <CardDescription>
          Generate direct links for Page 1 (My Race Dashboard) and Page 2 (My Finish Result).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Select Event</Label>
            <Select value={selectedEventId} onValueChange={setSelectedEventId} disabled={isLoadingEvents}>
              <SelectTrigger>
                <SelectValue placeholder="Select event" />
              </SelectTrigger>
              <SelectContent>
                {upcomingEvents.map((event) => (
                  <SelectItem key={event.id} value={event.id}>{event.eventName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>BIB Number (Optional)</Label>
            <Input value={bibNumber} onChange={(e) => setBibNumber(e.target.value)} placeholder="e.g. 1204" />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <Label className="text-sm font-semibold">Athlete Journey Logo</Label>
            <p className="text-xs text-muted-foreground mt-1">Upload logo for selected event. This will appear on both race/result pages.</p>
          </div>
          {!!(selectedEvent as any)?.finishLedLogoUrl && (
            <div className="rounded-md border bg-muted/20 p-2 inline-flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={String((selectedEvent as any).finishLedLogoUrl)} alt="Current event logo" className="h-10 w-auto object-contain" />
              <span className="text-xs text-muted-foreground">Current logo</span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              disabled={!selectedEventId || isUploadingLogo}
            />
            <Button onClick={() => void handleLogoUpload()} disabled={!selectedEventId || !logoFile || isUploadingLogo}>
              {isUploadingLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {isUploadingLogo ? 'Uploading...' : 'Upload Logo'}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Page 1 Link · My Race Dashboard (Pre-Race)</Label>
            <div className="flex flex-col md:flex-row gap-2">
              <Input readOnly value={links.pre} placeholder="Select event to generate link" />
              <Button variant="outline" onClick={() => void copy(links.pre)} disabled={!links.pre}><Copy className="mr-2 h-4 w-4" />Copy</Button>
              <Button asChild disabled={!links.pre}><a href={links.pre || '#'} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open</a></Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Page 2 Link · My Finish Result (Post-Race)</Label>
            <div className="flex flex-col md:flex-row gap-2">
              <Input readOnly value={links.post} placeholder="Select event to generate link" />
              <Button variant="outline" onClick={() => void copy(links.post)} disabled={!links.post}><Copy className="mr-2 h-4 w-4" />Copy</Button>
              <Button asChild disabled={!links.post}><a href={links.post || '#'} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open</a></Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
