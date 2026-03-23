// src/components/bikeRack/BikeRackVolunteerTab.tsx
"use client";

import React, { useState, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search, Bike } from 'lucide-react';
import { useBikeRack } from './useBikeRack';
import { Badge } from '@/components/ui/badge';
import type { EventParticipant } from '@/lib/types';

interface Props {
  eventId: string;
}

export default function BikeRackVolunteerTab({ eventId }: Props) {
  const { toast } = useToast();
  const { assignments, participants, isLoading } = useBikeRack(eventId);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [foundRack, setFoundRack] = useState<{ rackName: string; athleteName: string; } | null>(null);

  const handleSearchBib = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearching(true);
    setFoundRack(null);
    const bibToFind = searchTerm.trim();
    if (!bibToFind) {
      setIsSearching(false);
      return;
    }
    const participant = participants.find(p => p.bibNumber === bibToFind);
    if (!participant) {
      toast({ variant: 'destructive', title: 'Not Found', description: `No participant found with BIB number ${bibToFind}.` });
      setIsSearching(false);
      return;
    }
    const bibNum = parseInt(bibToFind, 10);
    const rack = assignments.find(a => bibNum >= (a.bibFrom || 0) && bibNum <= (a.bibTo || 0));
    if (rack && rack.rackName) {
      setFoundRack({ rackName: rack.rackName, athleteName: participant.name });
      toast({ title: 'Found!', description: `BIB ${bibToFind} (${participant.name}) is assigned to Rack ${rack.rackName}.` });
    } else {
      toast({ variant: 'destructive', title: 'Not Assigned', description: `BIB ${bibToFind} (${participant.name}) is not assigned to any rack.` });
    }
    setIsSearching(false);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bike className="h-5 w-5 text-primary"/>Bike Rack Locator</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center items-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bike className="h-5 w-5 text-primary"/>Bike Rack Locator</CardTitle>
        <CardDescription>Enter a BIB number to find the assigned bike rack.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSearchBib} className="flex gap-2">
          <Input 
            placeholder="Enter BIB Number..." 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            disabled={isSearching}
          />
          <Button type="submit" disabled={isSearching || !searchTerm}>
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin"/> : <Search className="h-4 w-4" />}
          </Button>
        </form>
        {foundRack && searchTerm && (
            <div className="p-4 bg-green-100 border border-green-300 rounded-md text-center">
                <p className="font-semibold text-green-800">BIB <span className="font-bold text-lg">{searchTerm}</span> ({foundRack.athleteName}) is assigned to:</p>
                <p className="text-3xl font-bold text-green-700">Rack {foundRack.rackName}</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
}
