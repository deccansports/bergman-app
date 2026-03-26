// src/components/admin/AgeGroupTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { EventCalendarEntry, TicketDefinition } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { updateCalendarEventAction, updateTicketDefinitionAction } from '@/lib/actions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save, UserPlus, Copy } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from '@/components/ui/dialog';

interface AgeGroupTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

const EVENT_WIDE_KEY = 'event-wide';

export default function AgeGroupTab({ events, isLoadingEvents, onDataRefresh }: AgeGroupTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string>(EVENT_WIDE_KEY); // 'event-wide' or ticket ID
  const [ageCategories, setAgeCategories] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [cloneSourceEventId, setCloneSourceEventId] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);

  const selectedEvent = useMemo(() => events.find(e => e.id === selectedEventId), [events, selectedEventId]);

  useEffect(() => {
    // Reset ticket selection when event changes
    setSelectedTarget(EVENT_WIDE_KEY);
  }, [selectedEventId]);

  useEffect(() => {
    if (selectedEvent) {
      if (selectedTarget === EVENT_WIDE_KEY) {
        setAgeCategories((selectedEvent.ageCategories || []).join(', '));
      } else {
        const ticket = selectedEvent.ticketDefinitions?.find(t => t.id === selectedTarget);
        const ageGroups = ticket?.applicableAgeGroups;
        const ageGroupsString = Array.isArray(ageGroups) ? ageGroups.join(', ') : (ageGroups || '');
        setAgeCategories(ageGroupsString);
      }
    } else {
      setAgeCategories('');
    }
  }, [selectedEvent, selectedTarget]);

  const handleSaveAgeGroups = async () => {
    if (!selectedEventId) return;
    setIsSaving(true);
    const ageGroupsArray = ageCategories.split(',').map(s => s.trim()).filter(Boolean);
    
    let result;
    if (selectedTarget === EVENT_WIDE_KEY) {
      result = await updateCalendarEventAction(selectedEventId, { ageCategories: ageGroupsArray });
    } else {
      result = await updateTicketDefinitionAction(selectedEventId, selectedTarget, { applicableAgeGroups: ageGroupsArray });
    }

    if (result.success) {
      toast({ title: 'Success', description: 'Age groups updated successfully.' });
      onDataRefresh();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSaving(false);
  };
  
  const handleClone = async () => {
    if (!cloneSourceEventId || !selectedEventId) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select a source event.' });
      return;
    }
    setIsCloning(true);
    const sourceEvent = events.find(e => e.id === cloneSourceEventId);
    if (!sourceEvent) {
      toast({ variant: 'destructive', title: 'Error', description: 'Source event not found.' });
      setIsCloning(false);
      return;
    }
    
    const ageGroupsToClone = sourceEvent.ageCategories || [];
    const result = await updateCalendarEventAction(selectedEventId, { ageCategories: ageGroupsToClone });
    
    if (result.success) {
        toast({ title: 'Success', description: `Cloned ${ageGroupsToClone.length} age groups.` });
        setAgeCategories(ageGroupsToClone.join(', '));
        onDataRefresh();
        setIsCloneModalOpen(false);
    } else {
        toast({ variant: 'destructive', title: 'Clone Failed', description: result.message });
    }
    setIsCloning(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-primary" />
          Age Group Management
        </CardTitle>
        <CardDescription>
          Define comma-separated age group ranges for an entire event or for a specific ticket category (e.g., 18-24, 25-29, 30-34, Above 51).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            onValueChange={setSelectedEventId}
            disabled={isLoadingEvents}
            value={selectedEventId || ''}
          >
            <SelectTrigger>
              <SelectValue placeholder="1. Select an Event..." />
            </SelectTrigger>
            <SelectContent>
              {events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
            </SelectContent>
          </Select>

          {selectedEventId && (
             <Select
                value={selectedTarget}
                onValueChange={setSelectedTarget}
                disabled={!selectedEvent}
              >
              <SelectTrigger>
                <SelectValue placeholder="2. Select Target..." />
              </SelectTrigger>
              <SelectContent>
                  <SelectItem value={EVENT_WIDE_KEY}>Event-Wide Age Groups</SelectItem>
                  {selectedEvent?.ticketDefinitions?.map((t: TicketDefinition) => (
                      <SelectItem key={t.id} value={t.id}>{t.ticketName}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>


        {selectedEventId && (
          <div className="pt-4 border-t space-y-4">
            <Textarea
              value={ageCategories}
              onChange={(e) => setAgeCategories(e.target.value)}
              placeholder="e.g., 18-24, 25-30, 31-40, Above 40"
              rows={4}
            />
            <div className="flex justify-end gap-2">
              <Dialog open={isCloneModalOpen} onOpenChange={setIsCloneModalOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" disabled={isSaving}>
                    <Copy className="mr-2 h-4 w-4" />
                    Clone from Event
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clone Age Groups</DialogTitle>
                    <DialogDescription>
                      Select an event to copy its age group configuration. This will overwrite the current settings for {selectedEvent?.eventName}.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Select onValueChange={setCloneSourceEventId} disabled={isLoadingEvents}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select source event..." />
                        </SelectTrigger>
                        <SelectContent>
                            {events.filter(e => e.id !== selectedEventId).map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
                        </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                    <Button onClick={handleClone} disabled={isCloning || !cloneSourceEventId}>
                      {isCloning ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Copy className="mr-2 h-4 w-4" />}
                      Clone
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button onClick={handleSaveAgeGroups} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Age Groups
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
