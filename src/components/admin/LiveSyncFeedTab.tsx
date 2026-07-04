// src/components/admin/LiveSyncFeedTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Loader2, Activity, CheckCircle2, AlertCircle, Clock, Mail, User, Zap, Trash2, Pause, Play, Filter
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SyncEvent {
  id: string;
  timestamp: string;
  type: 'participant' | 'event' | 'user' | 'registration';
  status: 'success' | 'error';
  message: string;
  data?: {
    email?: string;
    name?: string;
    eventName?: string;
    bookingId?: string;
  };
}

export default function LiveSyncFeedTab() {
  const { toast } = useToast();
  const [syncEvents, setSyncEvents] = useState<SyncEvent[]>([]);
  const [isLiveUpdating, setIsLiveUpdating] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const syncEventSourceRef = useRef<EventSource | null>(null);

  // Connect to Server-Sent Events for live updates
  useEffect(() => {
    if (!isLiveUpdating) return;

    const connectSSE = () => {
      try {
        const eventSource = new EventSource('/api/admin/live-sync-feed');
        syncEventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          setIsLoading(false);
          console.log('[LiveSync] Connected to feed');
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as SyncEvent;
            
            // Add to top of list with max 100 items
            setSyncEvents(prev => {
              const updated = [data, ...prev].slice(0, 100);
              return updated;
            });

            // Show toast for errors
            if (data.status === 'error') {
              toast({
                variant: 'destructive',
                title: `Sync Failed: ${data.type}`,
                description: data.message,
              });
            }
          } catch (err) {
            console.error('Failed to parse sync event:', err);
          }
        };

        eventSource.onerror = () => {
          console.error('[LiveSync] Connection error');
          eventSource.close();
          syncEventSourceRef.current = null;
          
          // Reconnect after 3 seconds
          setTimeout(connectSSE, 3000);
        };

        return () => {
          eventSource.close();
          syncEventSourceRef.current = null;
        };
      } catch (err) {
        console.error('[LiveSync] Failed to connect:', err);
        setIsLoading(false);
      }
    };

    const cleanup = connectSSE();
    return cleanup;
  }, [isLiveUpdating, toast]);

  const handleClear = useCallback(() => {
    if (window.confirm('Clear all sync events from view?')) {
      setSyncEvents([]);
      toast({ title: 'Cleared', description: 'Sync feed cleared' });
    }
  }, [toast]);

  const handleToggleLive = useCallback(() => {
    setIsLiveUpdating(!isLiveUpdating);
    if (!isLiveUpdating) {
      toast({ title: 'Live Sync Enabled', description: 'Receiving real-time updates' });
    } else {
      toast({ title: 'Live Sync Paused', description: 'Updates paused' });
    }
  }, [isLiveUpdating, toast]);

  const filteredEvents = filterType === 'all' 
    ? syncEvents 
    : syncEvents.filter(e => e.type === filterType);

  const stats = {
    total: syncEvents.length,
    success: syncEvents.filter(e => e.status === 'success').length,
    errors: syncEvents.filter(e => e.status === 'error').length,
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'participant':
        return <Zap className="h-4 w-4 text-blue-600" />;
      case 'event':
        return <Activity className="h-4 w-4 text-purple-600" />;
      case 'user':
        return <User className="h-4 w-4 text-green-600" />;
      case 'registration':
        return <Mail className="h-4 w-4 text-orange-600" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6 text-left">
      <Card className="border-primary/20 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-600 animate-pulse" />
              <CardTitle className="text-lg">Live Sync Feed</CardTitle>
              {isLiveUpdating && <Badge className="bg-green-600">LIVE</Badge>}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={isLiveUpdating ? 'default' : 'outline'}
                onClick={handleToggleLive}
              >
                {isLiveUpdating ? (
                  <Pause className="h-4 w-4 mr-1" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                {isLiveUpdating ? 'Pause' : 'Resume'}
              </Button>
              <Button size="sm" variant="outline" onClick={handleClear}>
                <Trash2 className="h-4 w-4 mr-1" />
                Clear
              </Button>
            </div>
          </div>
          <CardDescription>
            Real-time Firestore → KV sync activity. Updates appear instantly as they happen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-slate-50 rounded-lg border">
              <p className="text-[10px] font-black uppercase text-muted-foreground">Total Events</p>
              <p className="text-2xl font-black mt-1">{stats.total}</p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-[10px] font-black uppercase text-green-600">Success</p>
              <p className="text-2xl font-black text-green-600 mt-1">{stats.success}</p>
            </div>
            <div className="p-4 bg-red-50 rounded-lg border border-red-200">
              <p className="text-[10px] font-black uppercase text-red-600">Errors</p>
              <p className="text-2xl font-black text-red-600 mt-1">{stats.errors}</p>
            </div>
          </div>

          {/* Filter */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-muted-foreground">
              <Filter className="h-4 w-4 inline mr-1" />
              Filter by Type
            </label>
            <div className="flex gap-2 flex-wrap">
              {['all', 'participant', 'event', 'user', 'registration'].map(type => (
                <Button
                  key={type}
                  size="sm"
                  variant={filterType === type ? 'default' : 'outline'}
                  onClick={() => setFilterType(type)}
                  className="text-[11px]"
                >
                  {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          {/* Loading State */}
          {isLoading && (
            <Alert className="bg-blue-50 border-blue-200">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <AlertTitle className="text-blue-600">Connecting...</AlertTitle>
              <AlertDescription className="text-blue-600/90 text-xs mt-1">
                Establishing connection to live sync feed
              </AlertDescription>
            </Alert>
          )}

          {/* Sync Feed */}
          <ScrollArea className="border rounded-lg h-[600px] w-full pr-4">
            <div className="space-y-2 p-4">
              {filteredEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[500px] text-center">
                  <Activity className="h-12 w-12 text-muted-foreground/20 mb-2" />
                  <p className="text-muted-foreground text-sm">
                    {isLoading ? 'Connecting to live feed...' : 'No sync events yet'}
                  </p>
                </div>
              ) : (
                filteredEvents.map((event, idx) => (
                  <div
                    key={`${event.timestamp}-${idx}`}
                    className={`p-3 rounded-lg border text-[11px] transition-all ${
                      event.status === 'success'
                        ? 'bg-green-50 border-green-200'
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div className="mt-0.5 flex-shrink-0">
                        {event.status === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-grow min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {typeIcon(event.type)}
                          <span className="font-bold uppercase text-xs">
                            {event.type}
                          </span>
                          <Badge
                            variant={event.status === 'success' ? 'default' : 'destructive'}
                            className="text-[8px]"
                          >
                            {event.status}
                          </Badge>
                        </div>

                        {/* Details */}
                        <p className="text-muted-foreground mb-1 line-clamp-2">
                          {event.data?.email && (
                            <>
                              <Mail className="h-3 w-3 inline mr-1" />
                              {event.data.email}
                              {' • '}
                            </>
                          )}
                          {event.data?.name && (
                            <>
                              {event.data.name}
                              {' • '}
                            </>
                          )}
                          {event.data?.eventName && (
                            <>
                              {event.data.eventName}
                              {' • '}
                            </>
                          )}
                          {event.data?.bookingId && (
                            <>
                              Booking: {event.data.bookingId}
                            </>
                          )}
                        </p>

                        {/* Error message if present */}
                        {event.status === 'error' && (
                          <p className="text-red-600 font-semibold">{event.message}</p>
                        )}

                        {/* Timestamp */}
                        <div className="flex items-center gap-1 text-[9px] text-muted-foreground mt-1">
                          <Clock className="h-3 w-3" />
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Info */}
          <Alert className="bg-blue-50 border-blue-200">
            <Zap className="h-4 w-4 text-blue-600" />
            <AlertTitle className="text-blue-600">Real-Time Updates</AlertTitle>
            <AlertDescription className="text-blue-600/90 text-xs mt-1">
              Every Firestore write (participant, event, user, registration) triggers an immediate sync to Cloudflare KV.
              You&apos;re seeing live events as they happen.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
