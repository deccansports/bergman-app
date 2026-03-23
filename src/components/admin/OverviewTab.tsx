// src/components/admin/OverviewTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { EventCalendarEntry, EventParticipant, CancellationEntry, OverviewMetrics, EventTicketStats } from '@/lib/types';
import { getEventRegistrationOverviewMetricsAction } from '@/lib/actions/analyticsActions';
import { getTicketStatsAction } from '@/lib/actions/ticketActions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, TrendingDown, IndianRupee, History } from 'lucide-react';
import { format, parseISO, isAfter, startOfDay, isBefore } from 'date-fns';

interface OverviewTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function OverviewTab({ events, isLoadingEvents }: OverviewTabProps) {
  const { toast } = useToast();
  const [selectedEventIdForStats, setSelectedEventIdForStats] = useState<string>('all-in');
  const [overviewMetrics, setOverviewMetrics] = useState<OverviewMetrics | null>(null);
  const [isMetricsLoading, setIsMetricsLoading] = useState(true);
  const [ticketStats, setTicketStats] = useState<EventTicketStats[]>([]);
  const [isTicketStatsLoading, setIsTicketStatsLoading] = useState(true);
  const [activeCurrency, setActiveCurrency] = useState<'INR' | 'USD'>('INR');

  const upcomingEvents = useMemo(() => {
    if (!events) return [];
    const today = startOfDay(new Date());
    return events.filter(e => {
        if (!e.eventDate) return false; 
        try {
            return !isBefore(parseISO(e.eventDate), today);
        } catch {
            return false;
        }
    });
  }, [events]);

  const fetchOverviewMetrics = useCallback((params: { eventId?: string, country?: 'IN' | 'US' }) => {
    setIsMetricsLoading(true);
    const currency = params.country === 'US' ? 'USD' : 'INR';
    setActiveCurrency(currency);

    getEventRegistrationOverviewMetricsAction({} as any, params.eventId, params.country)
      .then((result: { success: boolean; metrics?: OverviewMetrics; message: string }) => {
        if (result && result.success && result.metrics) {
          setOverviewMetrics(result.metrics);
        } else {
          setOverviewMetrics(null);
          toast({ variant: 'destructive', title: 'Metrics Error', description: result?.message || 'Failed to fetch overview metrics.' });
        }
      })
      .catch((error: Error) => {
        console.error("Error fetching overview metrics:", error);
        setOverviewMetrics(null);
        toast({ variant: 'destructive', title: 'Metrics Error', description: 'An unexpected error occurred while fetching data.' });
      })
      .finally(() => setIsMetricsLoading(false));
  }, [toast]);
  
  const fetchTicketStats = useCallback(() => {
    setIsTicketStatsLoading(true);
    getTicketStatsAction()
      .then(result => {
        if (result && result.success && result.eventTicketStats) {
          setTicketStats(result.eventTicketStats);
        } else {
          toast({ variant: 'destructive', title: 'Ticket Stats Error', description: result?.message || 'Failed to fetch ticket stats.' });
        }
      })
      .catch((error) => {
        console.error("Error fetching ticket stats:", error);
        toast({ variant: 'destructive', title: 'Ticket Stats Error', description: 'An unexpected error occurred while fetching ticket stats.' });
      })
      .finally(() => setIsTicketStatsLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchTicketStats();
  }, [fetchTicketStats]);

  useEffect(() => {
    if (selectedEventIdForStats === 'all-in') {
      fetchOverviewMetrics({ country: 'IN' });
    } else if (selectedEventIdForStats === 'all-us') {
      fetchOverviewMetrics({ country: 'US' });
    } else if (selectedEventIdForStats === 'all') {
      fetchOverviewMetrics({});
    }
    else {
      const event = events.find(e => e.id === selectedEventIdForStats);
      setActiveCurrency((event?.currency || 'INR') as 'INR' | 'USD');
      fetchOverviewMetrics({ eventId: selectedEventIdForStats });
    }
  }, [selectedEventIdForStats, fetchOverviewMetrics, events]);

  const formatCurrency = (paisa: number | null | undefined) => {
    if (paisa === null || paisa === undefined) { return 'N/A'; }
    const value = paisa / 100;
    const symbol = activeCurrency === 'USD' ? '$' : '₹';
    const locale = activeCurrency === 'USD' ? 'en-US' : 'en-IN';
    return `${symbol}${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  
  const renderTransactionItem = (item: EventParticipant | CancellationEntry, index: number) => {
    const isRegistration = 'registeredAt' in item && item.registeredAt;
    if (!isRegistration) return null; 
    const transactionDate = item.registeredAt;
    const status = item.ticketStatus || "N/A";
    const statusVariant = status === 'Active' ? 'default' : status === 'Deferred' ? 'secondary' : 'destructive';
    const name = item.name || 'N/A';
    const email = 'email' in item ? (item.email || 'N/A') : 'N/A';
    const amount = formatCurrency(item.amountPaidPaisa);

    return (
      <TableRow key={`${item.id}-${index}`} className="text-xs">
        <TableCell>
          <div className="font-medium">{name}</div>
          <div className="text-muted-foreground">{email}</div>
        </TableCell>
        <TableCell>{item.eventName}</TableCell>
        <TableCell>{transactionDate ? format(parseISO(transactionDate), 'MMM dd, yyyy, p') : 'N/A'}</TableCell>
        <TableCell>{amount}</TableCell>
        <TableCell><Badge variant={statusVariant}>{status}</Badge></TableCell>
      </TableRow>
    );
  };
  
  const selectedEventForTicketStats = useMemo(() => {
    if (selectedEventIdForStats === 'all' || selectedEventIdForStats === 'all-in' || selectedEventIdForStats === 'all-us') return null;
    return ticketStats.find(stat => stat.eventId === selectedEventIdForStats);
  }, [ticketStats, selectedEventIdForStats]);

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
         <h3 className="text-lg font-semibold text-foreground">Registration Overview</h3>
         <Select value={selectedEventIdForStats} onValueChange={setSelectedEventIdForStats} disabled={isLoadingEvents}>
             <SelectTrigger className="w-full sm:w-[250px] text-xs h-9">
                 <SelectValue placeholder="Select an Event to View Stats..." />
             </SelectTrigger>
             <SelectContent>
                 <SelectItem value="all-in">Upcoming Events (India)</SelectItem>
                 <SelectItem value="all-us">Upcoming Events (USA)</SelectItem>
                 <SelectItem value="all">All Upcoming Events (Global)</SelectItem>
                 <hr className="my-1"/>
                 {upcomingEvents.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
             </SelectContent>
         </Select>
     </div>
      
      {isMetricsLoading ? <Skeleton className="h-24 w-full" /> : overviewMetrics ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 text-center">
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl">{overviewMetrics.totalRegistrations}</CardTitle><CardDescription className="text-xs">Total Regs</CardDescription></CardHeader></Card>
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl">{overviewMetrics.todaysRegistrations}</CardTitle><CardDescription className="text-xs">Today&apos;s Regs</CardDescription></CardHeader></Card>
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl text-primary">{formatCurrency(overviewMetrics.totalSales)}</CardTitle><CardDescription className="text-xs">Total Sales</CardDescription></CardHeader></Card>
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl text-teal-600">{overviewMetrics.totalFreeRegistrations}</CardTitle><CardDescription className="text-xs">Free Regs</CardDescription></CardHeader></Card>
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl text-red-600">{formatCurrency(overviewMetrics.totalRefunds)}</CardTitle><CardDescription className="text-xs">Total Refunds</CardDescription></CardHeader></Card>
          </div>
      ) : <p className="text-center text-sm text-muted-foreground pt-4">Please select a scope to view its overview.</p>}
      
      <div className="space-y-4 pt-6 border-t">
          <h3 className="text-lg font-semibold">Ticket Sales & Stats</h3>
          {isTicketStatsLoading ? <Skeleton className="h-48 w-full" /> : (
              <Card>
                  <CardContent className="p-4">
                      {selectedEventForTicketStats ? (
                          <div>
                              <h4 className="font-semibold">{selectedEventForTicketStats.eventName}</h4>
                              <p className="text-sm text-muted-foreground">Total Revenue: {formatCurrency(selectedEventForTicketStats.totalRevenueFromEventPaisa)} | Total Sold: {selectedEventForTicketStats.totalTicketsSoldInEvent}</p>
                              <ul className="list-disc pl-5 mt-2 text-sm space-y-1">
                                  {selectedEventForTicketStats.tickets.map(ticket => (
                                      <li key={ticket.ticketDefinitionId}>
                                          {ticket.ticketName}: <span className="font-medium">{ticket.sold} sold</span> (Remaining: {ticket.remaining})
                                      </li>
                                  ))}
                              </ul>
                          </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">Select a specific event in the dropdown above to view its ticket stats.</p>
                      )}
                  </CardContent>
              </Card>
          )}
      </div>

       <div className="w-full pt-6 border-t">
           <Card className="w-full">
              <CardHeader className="p-3">
                  <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4"/>Latest Registrations ({
                    selectedEventIdForStats === 'all' ? 'Upcoming (Global)' :
                    selectedEventIdForStats === 'all-in' ? 'Upcoming (India)' :
                    selectedEventIdForStats === 'all-us' ? 'Upcoming (USA)' :
                    events.find(e => e.id === selectedEventIdForStats)?.eventName
                  })</CardTitle>
              </CardHeader>
              <CardContent className="p-0 max-h-80 overflow-y-auto">
                  <Table>
                      <TableHeader>
                          <TableRow className="text-xs"><TableHead>Participant</TableHead><TableHead>Event</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                          {isMetricsLoading ? <TableRow><TableCell colSpan={5} className="text-center p-4"><Loader2 className="h-6 w-6 animate-spin mx-auto"/></TableCell></TableRow>
                          : overviewMetrics && overviewMetrics.recentTransactions.length > 0 ? (overviewMetrics.recentTransactions.map(renderTransactionItem))
                          : <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground p-4">No recent registrations found.</TableCell></TableRow>}
                      </TableBody>
                  </Table>
              </CardContent>
          </Card>
      </div>
    </div>
  );
}
