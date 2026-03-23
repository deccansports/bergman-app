// src/components/volunteer/BikeCheckinLogTab.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search as SearchIcon, RefreshCw, Bike, Check, X, Download } from 'lucide-react';
import type { EventParticipant, EventCalendarEntry } from '@/lib/types';
import { getCheckedInParticipantsForEventAction, resetBikeCheckInAction } from '@/lib/actions/volunteerActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, parseISO } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import * as XLSX from 'xlsx';


interface BikeCheckinLogTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function BikeCheckinLogTab({ events, isLoadingEvents }: BikeCheckinLogTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [participants, setParticipants] = useState<EventParticipant[]>([]);
  const [isResetting, setIsResetting] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [stats, setStats] = useState<{ checkedInCount: number; totalParticipants: number } | null>(null);

  const fetchCheckedInBikes = useCallback(async () => {
    if (!selectedEventId) return;
    setIsLoading(true);
    try {
      const result = await getCheckedInParticipantsForEventAction(selectedEventId, {});
      if (result.success && result.participants) {
        const bikeCheckedIn = result.participants.filter(p => p.bikeCheckInStatus === 'CheckedIn');
        setParticipants(bikeCheckedIn);
      } else {
        setParticipants([]);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch bike check-in log.' });
      }

      const statsResponse = await fetch(`/api/volunteer-stats/bike?eventId=${selectedEventId}`);
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        if (statsData.success) {
          setStats(statsData.stats);
        }
      }

    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch bike check-in log.' });
    } finally {
      setIsLoading(false);
    }
  }, [selectedEventId, toast]);

  useEffect(() => {
    if (selectedEventId) {
      fetchCheckedInBikes();
    }
  }, [selectedEventId, fetchCheckedInBikes]);

  const handleReset = async (participant: EventParticipant) => {
    if (!selectedEventId) return;
    setIsResetting(participant.id);
    const result = await resetBikeCheckInAction(selectedEventId, participant.id);
    if (result.success) {
      toast({ title: 'Success', description: `Bike check-in for ${participant.name} has been reset.` });
      fetchCheckedInBikes();
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
        'Check-in Time': p.bikeCheckedInAt ? format(parseISO(p.bikeCheckedInAt), 'MMM dd, yyyy p') : 'N/A',
        'Helmet Checked': p.bikeCheckInDetails?.helmetChecked ? 'Yes' : 'No',
        'Pump Checked': p.bikeCheckInDetails?.pumpChecked ? 'Yes' : 'No',
        'Remarks': p.bikeCheckInDetails?.remarks || '',
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bike Check-in Log");
    XLSX.writeFile(wb, `Bike_Checkin_Log_${eventName.replace(/[^a-z0-9]/gi, '_')}.xlsx`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bike className="h-5 w-5 text-primary"/>Bike Check-in Log</CardTitle>
        <CardDescription>View all participants whose bikes have been checked in.</CardDescription>
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
                <Card><CardHeader className="p-2 pb-1"><CardTitle>{stats.totalParticipants}</CardTitle><CardDescription className="text-xs">Total Eligible</CardDescription></CardHeader></Card>
                <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-green-600">{stats.checkedInCount}</CardTitle><CardDescription className="text-xs">Bikes In</CardDescription></CardHeader></Card>
                <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-yellow-600">{stats.totalParticipants - stats.checkedInCount}</CardTitle><CardDescription className="text-xs">Remaining</CardDescription></CardHeader></Card>
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
                <TableHeader><TableRow><TableHead>Athlete</TableHead><TableHead>BIB</TableHead><TableHead>Check-in Time</TableHead><TableHead>Helmet</TableHead><TableHead>Pump</TableHead><TableHead>Remarks</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {isLoading ? <TableRow><TableCell colSpan={7} className="text-center"><Loader2 className="animate-spin my-4 mx-auto"/></TableCell></TableRow>
                  : filteredParticipants.length > 0 ? filteredParticipants.map(p => (
                    <TableRow key={p.id}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.bibNumber}</TableCell>
                      <TableCell>{p.bikeCheckedInAt ? format(parseISO(p.bikeCheckedInAt), 'p') : 'N/A'}</TableCell>
                      <TableCell>{p.bikeCheckInDetails?.helmetChecked ? <Check className="text-green-600"/> : <X className="text-red-500"/>}</TableCell>
                      <TableCell>{p.bikeCheckInDetails?.pumpChecked ? <Check className="text-green-600"/> : <X className="text-red-500"/>}</TableCell>
                      <TableCell>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <p className="truncate max-w-[150px]">{p.bikeCheckInDetails?.remarks || 'None'}</p>
                                </TooltipTrigger>
                                <TooltipContent><p>{p.bikeCheckInDetails?.remarks || 'No remarks provided'}</p></TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button variant="outline" size="xs" disabled={isResetting === p.id}><RefreshCw className="h-3.5 w-3.5" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Reset Bike Check-in?</AlertDialogTitle><AlertDialogDescription>This will reset the bike check-in for {p.name}.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleReset(p)}>Reset</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4">No bikes checked in yet for this event.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
