// src/components/admin/LoopLogTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { EventCalendarEntry, LoopLog } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Download, Search, Trash2, RefreshCw } from 'lucide-react';
import { getLoopLogsForEventAction, deleteLoopLogsForEventAction, deleteAthleteLoopLogsAction } from '@/lib/actions/loopActions';
import { format, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";


interface LoopLogTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function LoopLogTab({ events, isLoadingEvents }: LoopLogTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LoopLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAthleteLogs, setSelectedAthleteLogs] = useState<LoopLog[]>([]);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);


  const fetchLogs = useCallback(async (eventId: string) => {
    setIsLoading(true);
    try {
      const result = await getLoopLogsForEventAction(eventId);
      if (result.success && result.logs) {
        setLogs(result.logs);
      } else {
        setLogs([]);
        toast({ variant: 'destructive', title: 'Error', description: result.message || 'Could not fetch loop logs.' });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: `An unexpected error occurred: ${e.message}` });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    if (selectedEventId) {
      fetchLogs(selectedEventId);
    } else {
      setLogs([]);
    }
  }, [selectedEventId, fetchLogs]);

  const uniqueBibLogs = useMemo(() => {
    const seenBibs = new Set<string>();
    const latestLogPerBib: LoopLog[] = [];
    
    // Sort logs by timestamp descending to easily find the latest
    const sortedLogs = [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    for (const log of sortedLogs) {
        if (!seenBibs.has(log.bibNumber) && 
            (searchTerm === '' ||
             log.bibNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
             log.volunteerName?.toLowerCase().includes(searchTerm.toLowerCase()))
           ) {
            seenBibs.add(log.bibNumber);
            latestLogPerBib.push(log);
        }
    }
    return latestLogPerBib;
  }, [logs, searchTerm]);

  
  const handleOpenAthleteLog = (bibNumber: string) => {
    const athleteLogs = logs.filter(log => log.bibNumber === bibNumber).sort((a,b) => parseISO(b.timestamp).getTime() - parseISO(a.timestamp).getTime());
    setSelectedAthleteLogs(athleteLogs);
    setIsDetailModalOpen(true);
  };
  
  const processedAthleteLogsForModal = useMemo(() => {
      const incrementLogs = selectedAthleteLogs.filter(log => log.action === 'increment');
      const latestEntries = new Map<string, LoopLog>();
      for (const log of incrementLogs) {
          const key = `${log.segment}-${log.loopNumber}`;
          if (!latestEntries.has(key)) {
              latestEntries.set(key, log);
          }
      }
      return Array.from(latestEntries.values()).sort((a, b) => parseISO(b.timestamp).getTime() - parseISO(a.timestamp).getTime());
  }, [selectedAthleteLogs]);

  const handleDownload = () => {
    if (logs.length === 0 || !selectedEventId) return;
    const eventName = events.find(e => e.id === selectedEventId)?.eventName || 'export';
    
    // Group logs by bib and segment
    const groupedData: Record<string, Record<string, LoopLog[]>> = {};
    logs.forEach(log => {
        if (log.action === 'increment') {
            const key = `${log.bibNumber}-${log.segment}`;
            if (!groupedData[key]) {
                groupedData[key] = {};
            }
            if (!groupedData[key][log.loopNumber]) {
                groupedData[key][log.loopNumber] = [];
            }
            groupedData[key][log.loopNumber].push(log);
        }
    });

    const dataForExport: any[] = [];
    
    for (const key in groupedData) {
        const [bibNumber, segment] = key.split('-');
        const loops = groupedData[key];
        const maxLoop = Math.max(...Object.keys(loops).map(Number));
        const row: Record<string, any> = { 'BIB Number': bibNumber, 'Segment': segment, 'Volunteer Name': '' };
        
        let lastVolunteer = '';
        for (let i = 1; i <= maxLoop; i++) {
            const loopRecords = loops[i];
            if (loopRecords && loopRecords.length > 0) {
                // Find the latest record for this loop number
                const latestRecord = loopRecords.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
                row[`Loop ${i}`] = 'Yes';
                row[`Timestamp ${i}`] = latestRecord.timestamp ? format(parseISO(latestRecord.timestamp), 'yyyy-MM-dd pp') : 'N/A';
                lastVolunteer = latestRecord.volunteerName; // Capture the last known volunteer
            } else {
                row[`Loop ${i}`] = 'No';
                row[`Timestamp ${i}`] = '';
            }
        }
        row['Volunteer Name'] = lastVolunteer;
        dataForExport.push(row);
    }
    
    // Dynamically create headers
    const allHeaders = new Set(['BIB Number', 'Segment']);
    dataForExport.forEach(row => {
        Object.keys(row).forEach(key => allHeaders.add(key));
    });
    const sortedHeaders = Array.from(allHeaders).sort((a, b) => {
        if (a === 'Volunteer Name') return 1;
        if (b === 'Volunteer Name') return -1;
        if (a.startsWith('Loop') && b.startsWith('Timestamp')) return -1;
        if (a.startsWith('Timestamp') && b.startsWith('Loop')) return 1;
        return a.localeCompare(b, undefined, { numeric: true });
    });


    const ws = XLSX.utils.json_to_sheet(dataForExport, { header: sortedHeaders });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pivoted Loop Logs");
    XLSX.writeFile(wb, `PivotedLoopLog_${eventName.replace(/[^a-z0-9]/gi, '_')}.xlsx`);
  };

  const handleResetLogs = async () => {
    if (!selectedEventId) return;
    setIsDeleting(true);
    const result = await deleteLoopLogsForEventAction(selectedEventId);
    if (result.success) {
        toast({ title: 'Success', description: result.message });
        setLogs([]); // Clear logs from UI
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsDeleting(false);
  };
  
  const handleResetAthleteLogs = async (bib: string) => {
    if (!selectedEventId) return;
    setIsLoading(true);
    const result = await deleteAthleteLoopLogsAction(selectedEventId, bib);
    if (result.success) {
      toast({ title: 'Success', description: result.message });
      fetchLogs(selectedEventId); // Re-fetch all logs to update the view
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsLoading(false);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Loop Count Log</CardTitle>
          <CardDescription>View and export all loop entries recorded by volunteers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents}>
              <SelectTrigger className="w-full sm:w-[300px]">
                <SelectValue placeholder="Select an Event..." />
              </SelectTrigger>
              <SelectContent>
                {events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input 
              placeholder="Search by BIB or Volunteer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-[300px]"
              disabled={!selectedEventId}
            />
            <Button onClick={handleDownload} disabled={isLoading || logs.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Download Full Log
            </Button>
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={isDeleting || isLoading || !selectedEventId}>
                        {isDeleting ? <Loader2 className="animate-spin h-4 w-4"/> : <Trash2 className="h-4 w-4"/>}
                        <span className="ml-2">Reset All Logs</span>
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>This will permanently delete all loop log entries for the selected event. This action cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleResetLogs} disabled={isDeleting}>
                            {isDeleting ? 'Deleting...' : 'Confirm & Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

          </div>

          <div className="rounded-md border max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BIB</TableHead>
                  <TableHead>Segment</TableHead>
                  <TableHead>Last Loop Recorded</TableHead>
                  <TableHead>Last Timestamp</TableHead>
                  <TableHead>Last Volunteer</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center"><Loader2 className="animate-spin my-4 mx-auto"/></TableCell></TableRow>
                ) : uniqueBibLogs.length > 0 ? (
                  uniqueBibLogs.map((log) => {
                     const lastLog = logs.filter(l => l.bibNumber === log.bibNumber).sort((a,b) => parseISO(b.timestamp).getTime() - parseISO(a.timestamp).getTime())[0];
                     return (
                        <TableRow key={log.id}>
                          <TableCell>
                            <Button variant="link" className="p-0 h-auto" onClick={() => handleOpenAthleteLog(log.bibNumber)}>
                                {log.bibNumber}
                            </Button>
                          </TableCell>
                          <TableCell>{lastLog.segment}</TableCell>
                          <TableCell>{lastLog.loopNumber}</TableCell>
                          <TableCell>{lastLog.timestamp ? format(parseISO(lastLog.timestamp), 'p') : 'N/A'}</TableCell>
                          <TableCell>{lastLog.volunteerName}</TableCell>
                           <TableCell className="text-right">
                              <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                      <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5"/></Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                      <AlertDialogHeader>
                                          <AlertDialogTitle>Reset Logs for BIB {log.bibNumber}?</AlertDialogTitle>
                                          <AlertDialogDescription>This will delete all logs for this athlete and reset their loop counts to zero.</AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => handleResetAthleteLogs(log.bibNumber)} className="bg-destructive hover:bg-destructive/90">
                                              Reset Logs
                                          </AlertDialogAction>
                                      </AlertDialogFooter>
                                  </AlertDialogContent>
                              </AlertDialog>
                           </TableCell>
                        </TableRow>
                     )
                  })
                ) : (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No loop logs found for the selected event or filter.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      
       <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Loop History for BIB: {selectedAthleteLogs[0]?.bibNumber}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] -mx-6 px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Segment</TableHead>
                  <TableHead>Loop #</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Volunteer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processedAthleteLogsForModal.map(log => (
                  <TableRow key={log.id}>
                    <TableCell><Badge variant="secondary">{log.segment}</Badge></TableCell>
                    <TableCell className="font-semibold">{log.loopNumber}</TableCell>
                    <TableCell>{format(parseISO(log.timestamp), 'MMM dd, pp')}</TableCell>
                    <TableCell>{log.volunteerName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
