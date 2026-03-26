// src/components/admin/BirthdaysTab.tsx
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import type { EventCalendarEntry, EventParticipant } from '@/lib/types';
import { Cake, Search } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { parseISO, format } from 'date-fns';
import { getParticipantsForEventAction } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface BirthdaysTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function BirthdaysTab({ events, isLoadingEvents }: BirthdaysTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<EventParticipant[]>([]);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const selectedEvent = useMemo(() => {
    return events.find(e => e.id === selectedEventId);
  }, [events, selectedEventId]);

  useEffect(() => {
    if (selectedEventId) {
      setIsLoadingParticipants(true);
      getParticipantsForEventAction(selectedEventId)
        .then(result => {
          if(result.success && result.participants) {
            setParticipants(result.participants);
          } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
          }
        })
        .finally(() => setIsLoadingParticipants(false));
    } else {
      setParticipants([]);
    }
  }, [selectedEventId, toast]);

  const birthdayAthletes = useMemo(() => {
    if (!selectedEvent || !selectedEvent.eventDate || !participants) return [];
    
    try {
        const eventDate = parseISO(selectedEvent.eventDate);
        const dayBeforeEvent = new Date(eventDate);
        dayBeforeEvent.setDate(dayBeforeEvent.getDate() - 1);

        const eventMonthDay = `${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
        const dayBeforeMonthDay = `${String(dayBeforeEvent.getMonth() + 1).padStart(2, '0')}-${String(dayBeforeEvent.getDate()).padStart(2, '0')}`;
        
        return participants.filter(p => {
            if (!p.dob) return false;
            try {
                const dobMonthDay = p.dob.substring(5); // Extract MM-DD
                return dobMonthDay === eventMonthDay || dobMonthDay === dayBeforeMonthDay;
            } catch { return false; }
        });
    } catch {
        return [];
    }
  }, [selectedEvent, participants]);

  const filteredBirthdayAthletes = useMemo(() => {
    if (!searchTerm) return birthdayAthletes;
    return birthdayAthletes.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [birthdayAthletes, searchTerm]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Cake className="h-5 w-5 text-primary"/>Race Week Birthdays</CardTitle>
        <CardDescription>View participants whose birthday falls on race day or the day before.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents}>
            <SelectTrigger className="w-full sm:w-[300px]">
              <SelectValue placeholder="Select an Event..." />
            </SelectTrigger>
            <SelectContent>
              {events.map(e => (
                <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search birthday athletes by name..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9"
              disabled={!selectedEventId}
            />
          </div>
        </div>
        
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Athlete Name</TableHead>
                <TableHead>Date of Birth</TableHead>
                <TableHead>Age on Race Day</TableHead>
                <TableHead>BIB Number</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingEvents || isLoadingParticipants ? (
                <TableRow><TableCell colSpan={4} className="text-center"><Loader2 className="animate-spin mx-auto my-4"/></TableCell></TableRow>
              ) : !selectedEventId ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Please select an event.</TableCell></TableRow>
              ) : filteredBirthdayAthletes.length > 0 ? (
                filteredBirthdayAthletes.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.dob ? format(parseISO(p.dob), 'MMMM dd, yyyy') : 'N/A'}</TableCell>
                    <TableCell>{p.age}</TableCell>
                    <TableCell>{p.bibNumber || 'N/A'}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No birthdays on race week for this event.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
