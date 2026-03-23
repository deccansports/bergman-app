
// src/components/volunteer/CheckinLogTab.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search as SearchIcon, RefreshCw, Download, Info } from 'lucide-react';
import type { EventParticipant, EventCalendarEntry } from '@/lib/types';
import { getCheckedInParticipantsForEventAction, resetParticipantCheckInStatusAction } from '@/lib/actions/volunteerActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, parseISO } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import * as XLSX from 'xlsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';


interface CheckinLogTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

type CheckInLogSearchBy = 'name' | 'bibNumber' | 'email';

export default function CheckinLogTab({ events, isLoadingEvents }: CheckinLogTabProps) {
  const { toast } = useToast();
  const [checkInLogEventId, setCheckInLogEventId] = useState<string | null>(null);
  const [isLoadingCheckInLog, setIsLoadingCheckInLog] = useState(false);
  const [checkedInParticipants, setCheckedInParticipants] = useState<EventParticipant[]>([]);
  const [isResettingCheckIn, setIsResettingCheckIn] = useState<string | null>(null);
  const [checkInLogFilter, setCheckInLogFilter] = useState<{
    counter: string;
    searchTerm: string;
    searchBy: CheckInLogSearchBy;
  }>({ counter: '', searchTerm: '', searchBy: 'name' });
  const [stats, setStats] = useState<{ totalParticipants: number, checkedInCount: number, remainingCount: number } | null>(null);

  const fetchStats = useCallback(async (eventId: string) => {
    try {
        const response = await fetch(`/api/volunteer-stats/check-in?eventId=${eventId}`);
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                setStats(data.stats);
            }
        }
    } catch (e) {
        console.error("Failed to fetch check-in stats", e);
    }
  }, []);

  const handleFetchCheckInLog = useCallback(async () => {
    if (!checkInLogEventId) return;
    setIsLoadingCheckInLog(true);
    try {
      const result = await getCheckedInParticipantsForEventAction(checkInLogEventId, checkInLogFilter);
      if (result.success && result.participants) {
        setCheckedInParticipants(result.participants);
      } else {
        setCheckedInParticipants([]);
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch check-in log.' });
    } finally {
      setIsLoadingCheckInLog(false);
    }
  }, [checkInLogEventId, checkInLogFilter, toast]);

  useEffect(() => {
    if (checkInLogEventId) {
      handleFetchCheckInLog();
      fetchStats(checkInLogEventId);
    }
  }, [checkInLogEventId, handleFetchCheckInLog, fetchStats]);

  const handleResetCheckInStatus = async (participantId: string, participantName: string) => {
    if (!checkInLogEventId) return;
    setIsResettingCheckIn(participantId);
    const res = await resetParticipantCheckInStatusAction(checkInLogEventId, participantId);
    if (res.success) {
      toast({ title: 'Success', description: `Check-in for ${participantName} has been reset.` });
      handleFetchCheckInLog();
      fetchStats(checkInLogEventId);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: res.message });
    }
    setIsResettingCheckIn(null);
  };
  
  const handleDownloadLog = () => {
    if (!checkedInParticipants.length || !checkInLogEventId) {
        toast({
            variant: 'destructive',
            title: 'No Data',
            description: 'There is no check-in data to download for the selected event.'
        });
        return;
    }

    const eventName = events.find(e => e.id === checkInLogEventId)?.eventName || 'Event';

    const dataToExport = checkedInParticipants.map(p => ({
        'Athlete Name': p.name,
        'BIB Number': p.bibNumber || 'N/A',
        'Ticket': p.ticketName,
        'Checked-in At': p.checkedInAt ? format(parseISO(p.checkedInAt), 'MMM dd, yyyy p') : 'N/A',
        'Volunteer': p.checkedInByVolunteerName || 'N/A',
        'Counter': p.checkInCounter || 'N/A',
        'Waiver Remarks': p.checkInDetails?.remarks || 'N/A',
        'Handover To Name': p.checkInDetails?.handedOverTo?.name || 'N/A',
        'Handover To Mobile': p.checkInDetails?.handedOverTo?.mobile || 'N/A'
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Waiver Check-in Log");
    XLSX.writeFile(wb, `WaiverCheckinLog_${eventName.replace(/[^a-z0-9]/gi, '_')}.xlsx`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Waiver Check-in Log</CardTitle>
        <CardDescription>View and manage participants who have completed waiver check-in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select onValueChange={setCheckInLogEventId} value={checkInLogEventId || ''} disabled={isLoadingEvents}>
          <SelectTrigger className="w-full sm:w-[300px]"><SelectValue placeholder="Select an Event..." /></SelectTrigger>
          <SelectContent>{events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}</SelectContent>
        </Select>
        {checkInLogEventId && (
          <>
            {isLoadingCheckInLog ? <p>Loading stats...</p> : stats && (
              <div className="grid grid-cols-3 gap-4 text-center">
                <Card><CardHeader className="p-2 pb-1"><CardTitle>{stats.totalParticipants}</CardTitle><CardDescription className="text-xs">Total</CardDescription></CardHeader></Card>
                <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-green-600">{stats.checkedInCount}</CardTitle><CardDescription className="text-xs">Checked-in</CardDescription></CardHeader></Card>
                <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-yellow-600">{stats.remainingCount}</CardTitle><CardDescription className="text-xs">Remaining</CardDescription></CardHeader></Card>
              </div>
            )}
            <div className="flex gap-2">
                <form onSubmit={(e) => { e.preventDefault(); handleFetchCheckInLog(); }} className="flex-grow flex gap-2">
                    <Input placeholder="Search..." value={checkInLogFilter.searchTerm} onChange={e => setCheckInLogFilter(f => ({ ...f, searchTerm: e.target.value }))} disabled={isLoadingCheckInLog} />
                    <Button type="submit" disabled={isLoadingCheckInLog} variant="secondary">
                        {isLoadingCheckInLog ? <Loader2 className="animate-spin" /> : <SearchIcon />}
                    </Button>
                </form>
                 <Button onClick={handleDownloadLog} disabled={isLoadingCheckInLog || checkedInParticipants.length === 0} variant="outline">
                    <Download className="h-4 w-4"/>
                </Button>
            </div>
            <div className="rounded-md border max-h-[50vh] overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Athlete</TableHead><TableHead>BIB</TableHead><TableHead>Checked-in</TableHead><TableHead>Volunteer</TableHead><TableHead>Details</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {isLoadingCheckInLog ? <TableRow><TableCell colSpan={6} className="text-center"><Loader2 className="animate-spin my-4 mx-auto"/></TableCell></TableRow>
                    : checkedInParticipants.length > 0 ? checkedInParticipants.map(p => (
                      <TableRow key={p.id}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell>{p.bibNumber || 'N/A'}</TableCell>
                        <TableCell>{p.checkedInAt ? format(parseISO(p.checkedInAt), 'p') : 'N/A'}</TableCell>
                        <TableCell>{p.checkedInByVolunteerName || 'N/A'}</TableCell>
                        <TableCell>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="xs"><Info className="h-4 w-4"/></Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 text-xs">
                              <div className="space-y-2">
                                <p><strong>Remarks:</strong> {p.checkInDetails?.remarks || 'None'}</p>
                                <p><strong>Handover To:</strong> {p.checkInDetails?.handedOverTo ? `${p.checkInDetails.handedOverTo.name} (${p.checkInDetails.handedOverTo.mobile})` : 'Athlete'}</p>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </TableCell>
                        <TableCell>
                          <AlertDialog>
                            <AlertDialogTrigger asChild><Button variant="outline" size="xs" disabled={isResettingCheckIn === p.id}><RefreshCw className="h-3.5 w-3.5" /></Button></AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader><AlertDialogTitle>Reset Check-in?</AlertDialogTitle><AlertDialogDescription>This will reset the waiver status for {p.name}.</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleResetCheckInStatus(p.id, p.name)}>Reset</AlertDialogAction></AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    )) : <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">No checked-in participants found.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
