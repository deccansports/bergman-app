// src/components/volunteer/BikeCheckoutLogTab.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search as SearchIcon, Bike, User, RefreshCw, Download } from 'lucide-react';
import type { EventParticipant, EventCalendarEntry } from '@/lib/types';
import { getBikeCheckedOutParticipantsForEventAction, resetBikeCheckOutAction } from '@/lib/actions/volunteerActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, parseISO } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import * as XLSX from 'xlsx';

interface BikeCheckoutLogTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function BikeCheckoutLogTab({ events, isLoadingEvents }: BikeCheckoutLogTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [participants, setParticipants] = useState<EventParticipant[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [stats, setStats] = useState<{ checkedInCount: number; checkedOutCount: number } | null>(null);
  const [isResetting, setIsResetting] = useState<string | null>(null);

  const fetchCheckedOutBikes = useCallback(async () => {
    if (!selectedEventId) return;
    setIsLoading(true);
    try {
      const result = await getBikeCheckedOutParticipantsForEventAction(selectedEventId);
      if (result.success && result.participants) {
        setParticipants(result.participants);
      } else {
        setParticipants([]);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch bike check-out log.' });
      }

      const statsResponse = await fetch(`/api/volunteer-stats/bike?eventId=${selectedEventId}`);
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        if (statsData.success) {
          setStats(statsData.stats);
        }
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch bike check-out log.' });
    } finally {
      setIsLoading(false);
    }
  }, [selectedEventId, toast]);

  useEffect(() => {
    if (selectedEventId) {
      fetchCheckedOutBikes();
    }
  }, [selectedEventId, fetchCheckedOutBikes]);
  
  const handleReset = async (participant: EventParticipant) => {
    if (!selectedEventId) return;
    setIsResetting(participant.id);
    const result = await resetBikeCheckOutAction(selectedEventId, participant.id);
    if (result.success) {
        toast({ title: 'Success', description: `Bike check-out for ${participant.name} has been reset.`});
        fetchCheckedOutBikes();
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsResetting(null);
  };

  const filteredParticipants = participants.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.bibNumber?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const handleDownload = () => {
    if (filteredParticipants.length === 0 || !selectedEventId) return;
    const eventName = events.find(e => e.id === selectedEventId)?.eventName || 'export';
    
    const dataToExport = filteredParticipants.map(p => ({
        'BIB Number': p.bibNumber,
        'Athlete Name': p.name,
        'Check-out Time': p.bikeCheckedOutAt ? format(parseISO(p.bikeCheckedOutAt), 'MMM dd, yyyy p') : 'N/A',
        'Handed To Name': p.bikeCheckedOutManuallyTo?.name || 'Athlete',
        'Handed To Mobile': p.bikeCheckedOutManuallyTo?.mobile || 'N/A',
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bike Check-out Log");
    XLSX.writeFile(wb, `Bike_Checkout_Log_${eventName.replace(/[^a-z0-9]/gi, '_')}.xlsx`);
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bike className="h-5 w-5 text-primary"/>Bike Check-out Log</CardTitle>
        <CardDescription>View all participants whose bikes have been checked out.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select onValueChange={setSelectedEventId} value={selectedEventId || ''} disabled={isLoadingEvents}>
          <SelectTrigger className="w-full sm:w-[300px]"><SelectValue placeholder="Select an Event..." /></SelectTrigger>
          <SelectContent>{(events || []).map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}</SelectContent>
        </Select>

         {selectedEventId && (
          <>
            {isLoading ? <p>Loading stats...</p> : stats && (
              <div className="grid grid-cols-3 gap-4 text-center">
                <Card><CardHeader className="p-2 pb-1"><CardTitle>{stats.checkedInCount}</CardTitle><CardDescription className="text-xs">Bikes In</CardDescription></CardHeader></Card>
                <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-green-600">{stats.checkedOutCount}</CardTitle><CardDescription className="text-xs">Bikes Out</CardDescription></CardHeader></Card>
                <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-yellow-600">{stats.checkedInCount - stats.checkedOutCount}</CardTitle><CardDescription className="text-xs">Remaining</CardDescription></CardHeader></Card>
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
                <Input placeholder="Search by name or BIB..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                <Button onClick={handleDownload} variant="outline" disabled={isLoading || filteredParticipants.length === 0}>
                    <Download className="h-4 w-4 mr-2"/> Download Log
                </Button>
            </div>
            <div className="rounded-md border max-h-[50vh] overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Athlete</TableHead><TableHead>BIB</TableHead><TableHead>Check-out Time</TableHead><TableHead>Handed Over To</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {isLoading ? <TableRow><TableCell colSpan={5} className="text-center"><Loader2 className="animate-spin my-4 mx-auto"/></TableCell></TableRow>
                  : filteredParticipants.length > 0 ? filteredParticipants.map(p => (
                    <TableRow key={p.id}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.bibNumber}</TableCell>
                      <TableCell>{p.bikeCheckedOutAt ? format(parseISO(p.bikeCheckedOutAt), 'p') : 'N/A'}</TableCell>
                      <TableCell>
                        {p.bikeCheckedOutManuallyTo ? (
                            <div className="text-xs">
                                <p><strong>Name:</strong> {p.bikeCheckedOutManuallyTo.name}</p>
                                <p><strong>Mobile:</strong> {p.bikeCheckedOutManuallyTo.mobile}</p>
                            </div>
                        ) : (
                            <span className="flex items-center gap-1 text-green-600"><User className="h-4 w-4"/> Athlete</span>
                        )}
                      </TableCell>
                       <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="xs" disabled={isResetting === p.id}><RefreshCw className="h-3.5 w-3.5"/></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Reset Bike Check-out?</AlertDialogTitle>
                              <AlertDialogDescription>This will reset the bike check-out status for {p.name}.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleReset(p)}>Reset</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No bikes checked out yet for this event.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
