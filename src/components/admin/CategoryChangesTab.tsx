// src/components/admin/CategoryChangesTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { EventCalendarEntry, CategoryChangeLogEntry } from '@/lib/types';
import { getCategoryChangeLogAction } from '@/lib/actions/eventActions';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Repeat, ArrowRight, Download, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Input } from '../ui/input';
import * as XLSX from 'xlsx';

interface CategoryChangesTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function CategoryChangesTab({ events, isLoadingEvents }: CategoryChangesTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<CategoryChangeLogEntry[]>([]);
  const [isLoadingLog, setIsLoadingLog] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchLog = useCallback(async (eventId?: string) => {
    setIsLoadingLog(true);
    try {
        const result = await getCategoryChangeLogAction(eventId);
        if (result.success && result.log) {
          setLogEntries(result.log);
        } else {
          toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
    } finally {
        setIsLoadingLog(false);
    }
  }, [toast]);
  
  useEffect(() => {
    fetchLog(selectedEventId === 'all' ? undefined : (selectedEventId || undefined));
  }, [selectedEventId, fetchLog]);

  const filteredLogs = useMemo(() => {
      if (!searchTerm) return logEntries;
      const lowerTerm = searchTerm.toLowerCase();
      return logEntries.filter(log => 
        log.participantName?.toLowerCase().includes(lowerTerm) ||
        log.participantEmail?.toLowerCase().includes(lowerTerm) ||
        log.toTicketName?.toLowerCase().includes(lowerTerm)
      );
  }, [logEntries, searchTerm]);

  const handleDownload = () => {
      if (filteredLogs.length === 0) return;
      const data = filteredLogs.map(l => ({
          'Athlete': l.participantName,
          'Email': l.participantEmail,
          'Event': l.eventName,
          'From Category': l.fromTicketName,
          'To Category': l.toTicketName,
          'New BIB': l.toBibNumber || 'N/A',
          'Date': format(parseISO(l.changedAt), 'yyyy-MM-dd HH:mm'),
          'Payment ID': l.paymentId || 'N/A'
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Category Changes");
      XLSX.writeFile(wb, "Category_Change_Log.xlsx");
  };

  return (
    <Card className="border-none shadow-xl">
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="text-left">
            <CardTitle className="flex items-center gap-2 font-black uppercase italic tracking-tighter text-left">
                <Repeat className="h-5 w-5 text-purple-600" />
                Category Change Registry
            </CardTitle>
            <CardDescription className="text-left font-medium">Audit log of all category switches and associated fees.</CardDescription>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={filteredLogs.length === 0}>
                <Download className="h-4 w-4 mr-2" /> Export
            </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 text-left">
        <div className="flex flex-col sm:flex-row gap-4 items-center">
            <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents} value={selectedEventId || 'all'}>
                <SelectTrigger className="w-full sm:w-[300px] h-11 rounded-xl font-bold">
                    <SelectValue placeholder="Filter by Event..." />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Historical Changes</SelectItem>
                    {events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
                </SelectContent>
            </Select>
            <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="Filter by athlete or category..." 
                    className="pl-10 h-11 rounded-xl border-muted"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
        </div>

        <div className="rounded-xl border overflow-x-auto max-h-[60vh] shadow-inner">
            <Table>
                <TableHeader className="bg-muted/30">
                    <TableRow className="text-[10px] font-black uppercase tracking-widest">
                        <TableHead className="text-left">Athlete</TableHead>
                        <TableHead className="text-left">Event</TableHead>
                        <TableHead className="text-left">Transfer Path</TableHead>
                        <TableHead className="text-left">Date</TableHead>
                        <TableHead className="text-right pr-6">Ref</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoadingLog ? (
                        <TableRow><TableCell colSpan={5} className="text-center p-8"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                    ) : filteredLogs.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground italic">No category change records found.</TableCell></TableRow>
                    ) : (
                        filteredLogs.map(log => (
                            <TableRow key={log.id} className="hover:bg-muted/10 text-xs transition-colors">
                                <TableCell className="text-left">
                                    <div className="font-black uppercase text-sm leading-tight">{log.participantName}</div>
                                    <div className="text-[10px] font-bold text-muted-foreground lowercase">{log.participantEmail}</div>
                                </TableCell>
                                <TableCell className="text-left font-bold uppercase text-slate-500">{log.eventName}</TableCell>
                                <TableCell className="text-left">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="secondary" className="text-[9px] uppercase font-black">{log.fromTicketName}</Badge>
                                            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                            <Badge className="bg-purple-600 text-[9px] uppercase font-black">{log.toTicketName}</Badge>
                                        </div>
                                        {log.toBibNumber && (
                                            <div className="text-[10px] font-bold text-primary uppercase mt-1">New BIB: {log.toBibNumber}</div>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="text-left whitespace-nowrap font-medium text-slate-400">
                                    {format(parseISO(log.changedAt), 'dd MMM yyyy, p')}
                                </TableCell>
                                <TableCell className="text-right pr-6">
                                    {log.paymentId ? (
                                        <Badge variant="outline" className="font-mono text-[9px] uppercase hover:bg-primary/10 transition-colors">
                                            <Link href={`https://dashboard.razorpay.com/app/payments/${log.paymentId}`} target="_blank">{log.paymentId.replace('pay_', '')}</Link>
                                        </Badge>
                                    ) : <span className="text-slate-300">—</span>}
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
      </CardContent>
    </Card>
  );
}
