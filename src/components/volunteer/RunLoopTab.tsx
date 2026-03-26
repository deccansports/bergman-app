// src/components/volunteer/RunLoopTab.tsx
"use client";

import React, { useState, useCallback, useMemo } from 'react';
import type { EventParticipant, TicketDefinition } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search, Footprints, PlusCircle, MinusCircle } from 'lucide-react';
import { searchParticipantsForCheckInAction, recordLoopAction } from '@/lib/actions';

interface RunLoopTabProps {
  eventId: string;
  volunteerId: string;
  volunteerName: string;
  eventDetails: { ticketDefinitions?: TicketDefinition[] } | null;
}

export default function RunLoopTab({ eventId, volunteerId, volunteerName, eventDetails }: RunLoopTabProps) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [participant, setParticipant] = useState<EventParticipant | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!searchTerm) return;
    setIsSearching(true);
    setParticipant(null);
    try {
      const result = await searchParticipantsForCheckInAction(eventId, searchTerm, 'bibNumber');
      if (result.success && result.participant) {
        setParticipant(result.participant);
      } else {
        toast({ variant: 'destructive', title: 'Not Found', description: result.message });
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      toast({ variant: 'destructive', title: 'Error', description: `Search failed: ${errMsg}` });
    } finally {
      setIsSearching(false);
    }
  }, [eventId, searchTerm, toast]);

  const handleRecordLoop = useCallback(async (increment: boolean) => {
    if (!participant?.bibNumber) return;
    setIsRecording(true);
    try {
      const result = await recordLoopAction({
        eventId,
        bibNumber: participant.bibNumber,
        segment: 'RUN',
        volunteerId,
        volunteerName,
        increment,
      });
      if (result.success && result.participant) {
        toast({ title: 'Success', description: `Run loop count for BIB ${participant.bibNumber} updated.` });
        setParticipant(null); // Clear participant
        setSearchTerm('');   // Clear search term
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      toast({ variant: 'destructive', title: 'Error', description: `Failed to record loop: ${errMsg}` });
    } finally {
      setIsRecording(false);
    }
  }, [eventId, participant, volunteerId, volunteerName, toast]);

  const { requiredLoops, completedLoops } = useMemo(() => {
    if (!participant || !eventDetails?.ticketDefinitions) {
      return { requiredLoops: 0, completedLoops: 0 };
    }
    const ticket = eventDetails.ticketDefinitions.find(t => t.id === participant.ticketId);
    return { 
        requiredLoops: ticket?.runLoops || 0, 
        completedLoops: participant.runLoopsCompleted || 0 
    };
  }, [participant, eventDetails]);
  
  const remainingLoops = Math.max(0, requiredLoops - completedLoops);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Footprints className="h-5 w-5 text-primary"/>Run Loop Counter</CardTitle>
        <CardDescription>Enter a BIB number to record a completed run loop.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSearch} className="flex gap-2">
            <Input 
                placeholder="Enter athlete's BIB Number..." 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)} 
                disabled={isSearching}
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
            />
            <Button type="submit" disabled={!searchTerm || isSearching}>
                {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
            </Button>
        </form>

        {participant && (
            <Card className="mt-4 p-4 border-green-600/20 bg-green-500/5">
                <CardHeader className="p-0 pb-4">
                    <CardTitle className="text-lg text-primary">{participant.name} (BIB: {participant.bibNumber})</CardTitle>
                    <CardDescription>{participant.ticketName}</CardDescription>
                </CardHeader>
                <CardContent className="p-0 text-sm space-y-4">
                     <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="p-2 border rounded-md bg-background">
                            <p className="text-2xl font-bold text-green-600">{completedLoops}</p>
                            <p className="text-xs text-muted-foreground">Completed</p>
                        </div>
                        <div className="p-2 border rounded-md bg-background">
                             <p className="text-2xl font-bold text-yellow-600">{remainingLoops}</p>
                            <p className="text-xs text-muted-foreground">Remaining</p>
                        </div>
                        <div className="p-2 border rounded-md bg-background">
                             <p className="text-2xl font-bold">{requiredLoops}</p>
                            <p className="text-xs text-muted-foreground">Required</p>
                        </div>
                    </div>
                     <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t">
                        <Button onClick={() => handleRecordLoop(true)} className="flex-1 h-14 text-base" disabled={isRecording || completedLoops >= requiredLoops}>
                            {isRecording && <Loader2 className="animate-spin mr-2"/>} <PlusCircle className="mr-2 h-6 w-6"/> Record Loop +1
                        </Button>
                        <Button variant="outline" size="icon" className="h-14 w-full sm:w-14 shrink-0" onClick={() => handleRecordLoop(false)} disabled={isRecording}>
                            <MinusCircle className="h-6 w-6 text-destructive"/>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        )}
      </CardContent>
    </Card>
  );
}
