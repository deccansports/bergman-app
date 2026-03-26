// src/components/admin/FinishLedTab.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tv, Copy, ExternalLink, Info } from 'lucide-react';
import type { EventCalendarEntry } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { isBefore, parseISO, startOfDay } from 'date-fns';

interface FinishLedTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

const PIXELS_PER_FOOT = 3600;

export default function FinishLedTab({ events, isLoadingEvents }: FinishLedTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string>('');
  const [baseUrl, setBaseUrl] = useState('');
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [widthFeet, setWidthFeet] = useState(8);
  const [heightFeet, setHeightFeet] = useState(2);

  const upcomingEvents = useMemo(() => {
    if (!events) return [];
    const today = startOfDay(new Date());
    return events.filter(e => {
        if (!e.eventDate) return true; // Keep TBD events
        try {
            return !isBefore(parseISO(e.eventDate), today);
        } catch {
            return false;
        }
    });
  }, [events]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBaseUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (selectedEventId && baseUrl) {
        const url = new URL(`${baseUrl}/finish_line_led.html`);
        url.searchParams.set('eventId', selectedEventId);
        if (isDemoMode) {
            url.searchParams.set('demo', 'true');
        }
        if (widthFeet > 0) url.searchParams.set('w', String(widthFeet * PIXELS_PER_FOOT));
        if (heightFeet > 0) url.searchParams.set('h', String(heightFeet * PIXELS_PER_FOOT));

        setGeneratedUrl(url.toString());
    } else {
      setGeneratedUrl('');
    }
  }, [selectedEventId, baseUrl, isDemoMode, widthFeet, heightFeet]);

  const copyToClipboard = () => {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(generatedUrl);
    toast({ title: 'Link Copied!', description: 'The URL has been copied to your clipboard.' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tv className="h-5 w-5 text-primary" />
          Finish Line LED Display
        </CardTitle>
        <CardDescription>
          Generate a link for the finish line LED screen for a specific event. This page is designed for public display and updates in real-time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>1. Select an Upcoming Event</Label>
          <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents}>
            <SelectTrigger className="w-full md:w-1/2">
              <SelectValue placeholder="Select an Event..." />
            </SelectTrigger>
            <SelectContent>
              {upcomingEvents.map(e => (
                <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
            <Label>2. Configure LED Size (in Feet)</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/50 max-w-md">
                <div>
                    <Label htmlFor="led-width" className="text-xs text-muted-foreground">Width (ft)</Label>
                    <Input id="led-width" type="number" placeholder="Width (ft)" value={widthFeet} onChange={e => setWidthFeet(Number(e.target.value))} />
                </div>
                <div>
                    <Label htmlFor="led-height" className="text-xs text-muted-foreground">Height (ft)</Label>
                    <Input id="led-height" type="number" placeholder="Height (ft)" value={heightFeet} onChange={e => setHeightFeet(Number(e.target.value))} />
                </div>
            </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <Switch id="demo-mode" checked={isDemoMode} onCheckedChange={setIsDemoMode} />
          <Label htmlFor="demo-mode">Enable Demo Mode</Label>
        </div>
        <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
                {isDemoMode 
                    ? "Demo mode is ON. The generated link will show sample finisher data for testing the display."
                    : "Demo mode is OFF. The generated link will show real-time finisher data from the selected event."
                }
            </AlertDescription>
        </Alert>

        {generatedUrl && (
          <div className="space-y-2 pt-4 border-t">
            <Label className="font-medium">3. Use This Link</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input readOnly value={generatedUrl} />
              <Button onClick={copyToClipboard} variant="outline">
                <Copy className="mr-2 h-4 w-4" /> Copy Link
              </Button>
              <Button asChild>
                <a href={generatedUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" /> Open in New Tab
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              Open this link on the computer connected to the LED screen. Ensure it is in full-screen mode for the best experience.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
