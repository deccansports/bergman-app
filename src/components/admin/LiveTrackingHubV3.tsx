'use client';

/**
 * Live Tracking Hub - Phase 1-3 Implementation
 * 
 * Clean modular architecture using:
 * - Phase 1: Feibot API Connections (credential management)
 * - Phase 2: Event Configuration Import (contests, splits, devices)
 * - Phase 3: Contest Mapping (1:1 Feibot contest → Bergman event)
 * 
 * UI Flow:
 * 1. Select Connection (Phase 1)
 * 2. Select Event to Configure (Phase 2)
 * 3. View Imported Contests
 * 4. Map Contests to Events (Phase 3)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, AlertCircle, Database, Zap, MapPin } from 'lucide-react';
import { ContestMappingPanel } from '@/components/admin/ContestMappingPanel';
import type { EventCalendarEntry } from '@/lib/types/event';

export interface LiveTrackingHubProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

interface Connection {
  id: string;
  accountId: string;
  status: 'active' | 'inactive' | 'failed';
  lastSuccessfulConnection: string | null;
  createdAt: string;
}

interface EventConfig {
  eventId: string;
  feibotEventUuid: string;
  contests: Array<{ uuid: string; name: string }>;
  importedAt: string;
}

export function LiveTrackingHub({ events, isLoadingEvents, onDataRefresh }: LiveTrackingHubProps) {
  const { toast } = useToast();

  // State
  const [selectedEventId, setSelectedEventId] = useState<string>(events[0]?.id || '');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [eventConfig, setEventConfig] = useState<EventConfig | null>(null);
  const [isLoadingConnections, setIsLoadingConnections] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isImportingConfig, setIsImportingConfig] = useState(false);

  // Load connections
  const loadConnections = useCallback(async () => {
    if (!selectedEventId) return;
    try {
      setIsLoadingConnections(true);
      const response = await fetch(`/api/feibot/connections?eventId=${encodeURIComponent(selectedEventId)}`);
      const data = await response.json();

      if (data.success) {
        setConnections(data.connections || []);
        if (data.connections?.length > 0 && !selectedConnectionId) {
          setSelectedConnectionId(data.connections[0].id);
        }
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to load connections', variant: 'destructive' });
    } finally {
      setIsLoadingConnections(false);
    }
  }, [selectedEventId, selectedConnectionId, toast]);

  // Load event config
  const loadEventConfig = useCallback(async () => {
    if (!selectedConnectionId) return;
    try {
      setIsLoadingConfig(true);
      const response = await fetch(
        `/api/feibot/events/${encodeURIComponent(selectedEventId)}/config?connectionId=${encodeURIComponent(selectedConnectionId)}`
      );
      const data = await response.json();

      if (data.success && data.config) {
        setEventConfig({
          eventId: selectedEventId,
          feibotEventUuid: data.config.eventUuid,
          contests: data.config.contests || [],
          importedAt: data.config.importedAt,
        });
      }
    } catch (error) {
      console.error('Error loading config:', error);
    } finally {
      setIsLoadingConfig(false);
    }
  }, [selectedConnectionId, selectedEventId]);

  // Import event config
  const handleImportConfig = useCallback(async () => {
    if (!selectedConnectionId) return;

    try {
      setIsImportingConfig(true);
      const response = await fetch(
        `/api/feibot/events/${encodeURIComponent(selectedEventId)}/config/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: selectedConnectionId }),
        }
      );

      const data = await response.json();

      if (data.success) {
        toast({ title: 'Success', description: 'Event configuration imported successfully' });
        await loadEventConfig();
        onDataRefresh();
      } else {
        toast({ title: 'Error', description: data.error || 'Import failed', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: String(error), variant: 'destructive' });
    } finally {
      setIsImportingConfig(false);
    }
  }, [selectedConnectionId, selectedEventId, toast, loadEventConfig, onDataRefresh]);

  // Load connections on event change
  useEffect(() => {
    loadConnections();
  }, [selectedEventId, loadConnections]);

  // Load config on connection change
  useEffect(() => {
    if (selectedConnectionId) {
      loadEventConfig();
    }
  }, [selectedConnectionId, loadEventConfig]);

  const selectedConnection = connections.find((c) => c.id === selectedConnectionId);
  const selectedEvent = events.find((e) => e.id === selectedEventId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle>Live Tracking Configuration</CardTitle>
          <CardDescription>Orchestrate timing data import and contest mapping</CardDescription>
        </CardHeader>
      </Card>

      {/* Event Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Step 1: Select Event</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              disabled={isLoadingEvents}
              className="w-full rounded border px-3 py-2"
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.eventName} ({event.eventDate})
                </option>
              ))}
            </select>
            {selectedEvent && (
              <div className="text-sm text-gray-600 pt-2">
                Selected: <strong>{selectedEvent.eventName}</strong>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Connection Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Step 2: Select Connection (Phase 1)
          </CardTitle>
          <CardDescription>Choose a Feibot API connection for this event</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingConnections ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : connections.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No connections available. Create one in Phase 1 first.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              {connections.map((conn) => (
                <button
                  key={conn.id}
                  onClick={() => setSelectedConnectionId(conn.id)}
                  className={`w-full rounded border p-4 text-left transition ${
                    selectedConnectionId === conn.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{conn.id.slice(0, 12)}...</div>
                      <div className="text-sm text-gray-600">
                        Account: {conn.accountId} • Status: {conn.status}
                      </div>
                    </div>
                    <Badge variant={conn.status === 'active' ? 'default' : 'secondary'}>
                      {conn.status}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import Event Config */}
      {selectedConnection && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Step 3: Import Event Config (Phase 2)
            </CardTitle>
            <CardDescription>Fetch contests, splits, and timing rules from Feibot</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {eventConfig ? (
              <div className="space-y-3">
                <Alert className="border-green-200 bg-green-50">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-800">
                    ✓ Configuration imported {new Date(eventConfig.importedAt).toLocaleString()}
                  </AlertDescription>
                </Alert>

                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded border p-4">
                    <div className="text-sm text-gray-600">Event UUID</div>
                    <div className="font-mono text-sm">{eventConfig.feibotEventUuid}</div>
                  </div>
                  <div className="rounded border p-4">
                    <div className="text-sm text-gray-600">Contests</div>
                    <div className="text-2xl font-bold">{eventConfig.contests.length}</div>
                  </div>
                  <div className="rounded border p-4">
                    <div className="text-sm text-gray-600">Status</div>
                    <Badge>Ready</Badge>
                  </div>
                </div>
              </div>
            ) : (
              <Button onClick={handleImportConfig} disabled={isImportingConfig} className="w-full">
                {isImportingConfig && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Import Configuration
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Contest Mapping */}
      {eventConfig && eventConfig.contests.length > 0 && (
        <ContestMappingPanel
          eventId={selectedEventId}
          connectionId={selectedConnectionId}
          availableContests={eventConfig.contests}
          onRefresh={onDataRefresh}
        />
      )}

      {/* Status Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span>Phase 1: Connection</span>
              <Badge variant={selectedConnection ? 'default' : 'secondary'}>
                {selectedConnection ? '✓ Active' : 'Pending'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Phase 2: Event Config</span>
              <Badge variant={eventConfig ? 'default' : 'secondary'}>
                {eventConfig ? '✓ Imported' : 'Pending'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Phase 3: Contest Mapping</span>
              <Badge variant={eventConfig ? 'default' : 'secondary'}>
                {eventConfig ? 'Ready' : 'Pending'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
