// src/components/volunteer/FinisherItemsLogTab.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search as SearchIcon, Edit2, XCircle, CheckCircle, Medal, Shirt, RefreshCw, AlertTriangle } from 'lucide-react';
import type { EventParticipant, EventCalendarEntry } from '@/lib/types';
import { searchParticipantsForCheckInAction, markItemIssuedAction, updateParticipantTshirtSizeAction, resetIssuedItemStatusAction } from '@/lib/actions/volunteerActions';
import { updateParticipantStatusAction } from '@/lib/actions/participantActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

interface FinisherItemsLogTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

const TSHIRT_SIZES = ["34", "36", "38", "40", "42", "44", "46", "Unknown"];

export default function FinisherItemsLogTab({ events, isLoadingEvents }: FinisherItemsLogTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchedParticipant, setSearchedParticipant] = useState<EventParticipant | null>(null);
  const [isIssuingItem, setIsIssuingItem] = useState<'Medal' | 'Finisher Jersey' | null>(null);
  const [isEditingTshirtSize, setIsEditingTshirtSize] = useState(false);
  const [newTshirtSize, setNewTshirtSize] = useState('');
  const [isResettingItem, setIsResettingItem] = useState<'Medal' | 'Finisher Jersey' | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  
  useEffect(() => {
    setSearchTerm('');
    setSearchedParticipant(null);
  }, [selectedEventId]);

  const handleSearch = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!selectedEventId || !searchTerm) return;
    setIsSearching(true);
    setSearchedParticipant(null);
    setIsEditingTshirtSize(false);
    try {
        const result = await searchParticipantsForCheckInAction(selectedEventId, searchTerm, 'bibNumber');
        if (result.success && result.participant) {
            setSearchedParticipant(result.participant);
            setNewTshirtSize(result.participant.tshirtSize || '');
        } else {
            toast({ variant: "destructive", title: "Not Found", description: result.message });
        }
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        toast({ variant: "destructive", title: "Search Error", description: errMsg });
    } finally {
        setIsSearching(false);
    }
  };

    const handleUpdateStatus = async (status: 'Finished' | 'DNF' | 'DNS' | 'DNQ') => {
      if (!selectedEventId || !searchedParticipant) return;
      setIsUpdatingStatus(true);
      try {
        const result = await updateParticipantStatusAction(selectedEventId, searchedParticipant.id, status);
        if (result.success) {
            toast({ title: 'Status Updated', description: `Participant marked as ${status}.`});
            // Re-fetch participant data to show updated status
            const refreshResult = await searchParticipantsForCheckInAction(selectedEventId, searchTerm, 'bibNumber');
            if (refreshResult.success && refreshResult.participant) {
                setSearchedParticipant(refreshResult.participant);
            }
        } else {
            toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
        }
      } catch (error: unknown) {
         const errMsg = error instanceof Error ? error.message : 'Unknown error';
         toast({ variant: 'destructive', title: 'Error', description: `Failed to update status: ${errMsg}`});
      } finally {
        setIsUpdatingStatus(false);
      }
  };
  
  const handleMarkItemIssued = async (itemType: 'Medal' | 'Finisher Jersey') => {
    if (!selectedEventId || !searchedParticipant) return;
    setIsIssuingItem(itemType);
    try {
        const result = await markItemIssuedAction(selectedEventId, searchedParticipant.id, itemType);
        if (result.success) {
            toast({ title: "Success", description: result.message });
            // Re-fetch participant data to show updated status
            const refreshResult = await searchParticipantsForCheckInAction(selectedEventId, searchTerm, 'bibNumber');
            if (refreshResult.success && refreshResult.participant) {
                setSearchedParticipant(refreshResult.participant);
            }
        } else {
            toast({ variant: "destructive", title: "Failed", description: result.message });
        }
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        toast({ variant: "destructive", title: "Error", description: errMsg });
    } finally {
        setIsIssuingItem(null);
    }
  };

  const handleResetItem = async (itemType: 'Medal' | 'Finisher Jersey') => {
    if (!selectedEventId || !searchedParticipant) return;
    setIsResettingItem(itemType);
    try {
        const result = await resetIssuedItemStatusAction(selectedEventId, searchedParticipant.id, itemType);
        if (result.success) {
            toast({ title: "Success", description: result.message });
            const refreshResult = await searchParticipantsForCheckInAction(selectedEventId, searchTerm, 'bibNumber');
            if (refreshResult.success && refreshResult.participant) {
                setSearchedParticipant(refreshResult.participant);
            }
        } else {
            toast({ variant: 'destructive', title: "Reset Failed", description: result.message });
        }
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        toast({ variant: "destructive", title: "Error", description: errMsg });
    } finally {
        setIsResettingItem(null);
    }
  };
  
  const handleUpdateTshirtSize = async () => {
    if (!selectedEventId || !searchedParticipant?.id || !newTshirtSize) {
      toast({ variant: "destructive", title: "Error", description: "Participant and new size are required." });
      return;
    }
    const result = await updateParticipantTshirtSizeAction(selectedEventId, searchedParticipant.id, newTshirtSize);
    if (result.success) {
        toast({ title: "Success", description: result.message });
        setSearchedParticipant(prev => prev ? { ...prev, tshirtSize: newTshirtSize } : null);
        setIsEditingTshirtSize(false);
    } else {
        toast({ variant: "destructive", title: "Update Failed", description: result.message });
    }
  };

  const didNotFinish = ['DNF', 'DNS', 'DNQ'].includes(searchedParticipant?.status || '');

  return (
    <Card className="bg-background shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary"><Medal className="h-5 w-5" />Finisher goodies</CardTitle>
        <CardDescription>Search for a finisher by BIB to issue items like medals and jerseys.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select onValueChange={setSelectedEventId} value={selectedEventId || ''} disabled={isLoadingEvents}>
          <SelectTrigger><SelectValue placeholder="Select an Event..." /></SelectTrigger>
          <SelectContent>{events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}</SelectContent>
        </Select>
        <form onSubmit={handleSearch} className="flex gap-2">
            <Input placeholder="Enter athlete's BIB Number..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} disabled={isSearching || !selectedEventId} />
            <Button type="submit" disabled={!searchTerm || isSearching || !selectedEventId} className="min-w-[120px]">
                {isSearching ? <Loader2 className="animate-spin" /> : <SearchIcon className="h-4 w-4" />}
                <span className="ml-2">Search</span>
            </Button>
        </form>

        {searchedParticipant && (
          <Card className="mt-4 p-4 border-primary/20 bg-primary/5">
            <CardHeader className="p-0 pb-3"><CardTitle className="text-lg flex items-center gap-3">{searchedParticipant.name}</CardTitle></CardHeader>
            <CardContent className="p-0 text-sm space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                    <div><p className="text-xs font-semibold text-muted-foreground">BIB</p><p>{searchedParticipant.bibNumber || 'N/A'}</p></div>
                    <div><p className="text-xs font-semibold text-muted-foreground">Ticket</p><p>{searchedParticipant.ticketName || 'N/A'}</p></div>
                    <div className="md:col-span-2">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">T-Shirt Size</p>
                      {isEditingTshirtSize ? (
                        <div className="flex items-center gap-2">
                          <Select value={newTshirtSize} onValueChange={setNewTshirtSize}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{TSHIRT_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                          </Select>
                          <Button size="xs" onClick={handleUpdateTshirtSize}><CheckCircle className="h-3.5 w-3.5"/> </Button>
                          <Button size="xs" variant="ghost" onClick={() => setIsEditingTshirtSize(false)}><XCircle className="h-3.5 w-3.5"/></Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-base">{searchedParticipant.tshirtSize || 'N/A'}</p>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsEditingTshirtSize(true)}><Edit2 className="h-3.5 w-3.5 text-blue-600" /></Button>
                        </div>
                      )}
                    </div>
                    <div><p className="text-xs font-semibold text-muted-foreground">Waiver Status</p><div><Badge variant={searchedParticipant.checkInStatus === 'CheckedIn' ? 'default' : 'destructive'}>{searchedParticipant.checkInStatus || 'Pending'}</Badge></div></div>
                    <div><p className="text-xs font-semibold text-muted-foreground">Race Status</p><div><Badge variant={didNotFinish ? 'destructive' : 'default'}>{searchedParticipant.status || 'Unknown'}</Badge></div></div>
                    <div><p className="text-xs font-semibold text-muted-foreground">Medal Status</p><div><Badge variant={searchedParticipant.medalIssued ? 'default' : 'secondary'}>{searchedParticipant.medalIssued ? 'Issued' : 'Not Issued'}</Badge></div></div>
                    <div><p className="text-xs font-semibold text-muted-foreground">Finisher Jersey</p><div><Badge variant={!searchedParticipant.isEligibleForFinisherJersey ? 'secondary' : searchedParticipant.finisherJerseyIssued ? 'default' : 'secondary'}>
                      {!searchedParticipant.isEligibleForFinisherJersey ? 'Not Eligible' : searchedParticipant.finisherJerseyIssued ? 'Issued' : 'Not Issued'}
                    </Badge></div></div>
                </div>
                {searchedParticipant.checkInStatus !== 'CheckedIn' && (<Alert variant="destructive" className="mt-4 text-xs"><AlertTriangle className="h-4 w-4" /><AlertTitle>Waiver Pending</AlertTitle><AlertDescription>Athlete must complete waiver check-in before items can be issued.</AlertDescription></Alert>)}
                <div className="mt-4 pt-4 border-t flex flex-col md:flex-row gap-2">
                    <Button className="flex-1" onClick={() => handleMarkItemIssued('Medal')} disabled={isIssuingItem === 'Medal' || searchedParticipant.medalIssued || searchedParticipant.checkInStatus !== 'CheckedIn' || didNotFinish}>
                        {isIssuingItem === 'Medal' ? <Loader2 className="animate-spin" /> : <Medal className="h-4 w-4" />}
                        <span className="ml-2">{searchedParticipant.medalIssued ? 'Medal Issued' : 'Mark Medal Issued'}</span>
                    </Button>
                    <Button className="flex-1" onClick={() => handleMarkItemIssued('Finisher Jersey')} disabled={isIssuingItem === 'Finisher Jersey' || !searchedParticipant.isEligibleForFinisherJersey || searchedParticipant.finisherJerseyIssued || searchedParticipant.checkInStatus !== 'CheckedIn' || didNotFinish}>
                         {isIssuingItem === 'Finisher Jersey' ? <Loader2 className="animate-spin" /> : <Shirt className="h-4 w-4" />}
                        <span className="ml-2">{searchedParticipant.finisherJerseyIssued ? 'Jersey Issued' : 'Mark Jersey Issued'}</span>
                    </Button>
                </div>
                 <div className="mt-2 flex flex-wrap gap-2">
                    {searchedParticipant.medalIssued && (
                        <Button className="flex-1" variant="outline" size="sm" onClick={() => handleResetItem('Medal')} disabled={!!isResettingItem}>
                            {isResettingItem === 'Medal' ? <Loader2 className="animate-spin"/> : <RefreshCw className="h-4 w-4"/>}<span className="ml-2">Reset Medal</span>
                        </Button>
                    )}
                    {searchedParticipant.finisherJerseyIssued && (
                        <Button className="flex-1" variant="outline" size="sm" onClick={() => handleResetItem('Finisher Jersey')} disabled={!!isResettingItem}>
                            {isResettingItem === 'Finisher Jersey' ? <Loader2 className="animate-spin" /> : <RefreshCw className="h-4 w-4"/>}<span className="ml-2">Reset Jersey</span>
                        </Button>
                    )}
                </div>
                <div className="mt-4 pt-4 border-t flex flex-col sm:flex-row gap-2">
                    <Button className="flex-1" variant="destructive" onClick={() => handleUpdateStatus('DNF')} disabled={isUpdatingStatus || didNotFinish}>
                        {isUpdatingStatus && <Loader2 className="animate-spin" />}<span className="ml-2">Mark as DNF</span>
                    </Button>
                    <Button className="flex-1" variant="outline" onClick={() => handleUpdateStatus('Finished')} disabled={isUpdatingStatus || !didNotFinish}>
                        {isUpdatingStatus && <Loader2 className="animate-spin" />}<span className="ml-2">Reset DNF Status</span>
                    </Button>
                </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}
