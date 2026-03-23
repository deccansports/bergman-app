
// src/components/admin/LoopManagementTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { EventCalendarEntry, TicketDefinition } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { updateTicketDefinitionAction } from '@/lib/actions/ticketActions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { Loader2, Save, Repeat } from 'lucide-react';
import { Label } from '@/components/ui/label';

interface LoopManagementTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

export default function LoopManagementTab({ events, isLoadingEvents, onDataRefresh }: LoopManagementTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [ticketLoopData, setTicketLoopData] = useState<Record<string, { swimLoops?: number | null; bikeLoops?: number | null; runLoops?: number | null; }>>({});
  const [isSaving, setIsSaving] = useState<string | null>(null);

  const selectedEvent = useMemo(() => events.find(e => e.id === selectedEventId), [events, selectedEventId]);

  useEffect(() => {
    if (selectedEvent?.ticketDefinitions) {
      const initialData = selectedEvent.ticketDefinitions.reduce((acc: Record<string, any>, ticket: TicketDefinition) => {
        acc[ticket.id] = {
          swimLoops: ticket.swimLoops ?? null,
          bikeLoops: ticket.bikeLoops ?? null,
          runLoops: ticket.runLoops ?? null,
        };
        return acc;
      }, {} as Record<string, any>);
      setTicketLoopData(initialData);
    } else {
      setTicketLoopData({});
    }
  }, [selectedEvent]);

  const handleLoopChange = (ticketId: string, segment: 'swimLoops' | 'bikeLoops' | 'runLoops', value: string) => {
    const numValue = value === '' ? null : parseInt(value, 10);
    // Check if numValue is NaN (which happens if parseInt fails) or negative, but allow null
    if (numValue !== null && (isNaN(numValue) || numValue < 0)) return;

    setTicketLoopData(prev => ({
      ...prev,
      [ticketId]: {
        ...prev[ticketId],
        [segment]: numValue,
      },
    }));
  };

  const handleSaveLoops = async (ticketId: string) => {
    if (!selectedEventId) return;
    setIsSaving(ticketId);

    const dataToSave = ticketLoopData[ticketId];
    if (!dataToSave) {
        toast({ variant: 'destructive', title: 'Error', description: 'No data to save.' });
        setIsSaving(null);
        return;
    }
    
    const result = await updateTicketDefinitionAction(selectedEventId, ticketId, dataToSave);

    if (result.success) {
      toast({ title: 'Success', description: 'Loop counts updated successfully.' });
      onDataRefresh(); // Refresh all event data to ensure consistency
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSaving(null);
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Repeat className="h-5 w-5 text-primary" />
          Loop Count Management
        </CardTitle>
        <CardDescription>
          Set the required number of loops for Swim, Bike, and Run segments for each ticket category.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents} value={selectedEventId || ''}>
          <SelectTrigger className="w-full md:w-[300px]">
            <SelectValue placeholder="Select an Event..." />
          </SelectTrigger>
          <SelectContent>
            {events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
          </SelectContent>
        </Select>

        {selectedEventId && (
          <div className="pt-4 border-t space-y-4">
            {selectedEvent?.ticketDefinitions?.length === 0 && <p className="text-muted-foreground text-center">No tickets defined for this event.</p>}
            {selectedEvent?.ticketDefinitions?.map((ticket: TicketDefinition) => (
              <div key={ticket.id} className="p-4 border rounded-lg space-y-3">
                <div className="flex justify-between items-center">
                    <h4 className="font-semibold text-lg">{ticket.ticketName}</h4>
                    <Button size="sm" onClick={() => handleSaveLoops(ticket.id)} disabled={isSaving === ticket.id}>
                        {isSaving === ticket.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save
                    </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor={`swim-${ticket.id}`}>Swim Loops</Label>
                    <Input id={`swim-${ticket.id}`} type="number" min="0" placeholder="e.g., 2" value={ticketLoopData[ticket.id]?.swimLoops ?? ''} onChange={(e) => handleLoopChange(ticket.id, 'swimLoops', e.target.value)} />
                  </div>
                   <div>
                    <Label htmlFor={`bike-${ticket.id}`}>Bike Loops</Label>
                    <Input id={`bike-${ticket.id}`} type="number" min="0" placeholder="e.g., 3" value={ticketLoopData[ticket.id]?.bikeLoops ?? ''} onChange={(e) => handleLoopChange(ticket.id, 'bikeLoops', e.target.value)} />
                  </div>
                   <div>
                    <Label htmlFor={`run-${ticket.id}`}>Run Loops</Label>
                    <Input id={`run-${ticket.id}`} type="number" min="0" placeholder="e.g., 4" value={ticketLoopData[ticket.id]?.runLoops ?? ''} onChange={(e) => handleLoopChange(ticket.id, 'runLoops', e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
