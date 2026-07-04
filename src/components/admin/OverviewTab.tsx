// src/components/admin/OverviewTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { EventCalendarEntry, EventParticipant, CancellationEntry, OverviewMetrics, EventTicketStats } from '@/lib/types';
import { getEventRegistrationOverviewMetricsAction, computeCountryRegistrationMetricsAction, computeEventRegistrationMetricsAction } from '@/lib/actions/analyticsActions';
import { getTicketStatsAction, refreshTicketStatsCacheAction } from '@/lib/actions/ticketActions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, TrendingDown, IndianRupee, History, RefreshCw, Zap } from 'lucide-react';
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
  const [isRefreshingCache, setIsRefreshingCache] = useState(false);
  const [isAnalyticsSyncing, setIsAnalyticsSyncing] = useState(false);

  const normalizeCurrency = (value?: string | null): 'INR' | 'USD' => {
    return String(value || '').trim().toUpperCase() === 'USD' ? 'USD' : 'INR';
  };

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

  const fetchOverviewMetrics = useCallback((params: { eventId?: string, country?: 'IN' | 'US', currency?: 'INR' | 'USD' }) => {
    setIsMetricsLoading(true);
    const currency = params.currency || (params.country === 'US' ? 'USD' : 'INR');
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

  const handleRefreshKVCache = useCallback(async (country?: 'IN' | 'US', eventId?: string) => {
    setIsRefreshingCache(true);
    try {
      let result;
      if (eventId) {
        result = await computeEventRegistrationMetricsAction(eventId);
      } else if (country) {
        result = await computeCountryRegistrationMetricsAction(country);
      } else {
        throw new Error('Invalid parameters');
      }

      if (result.success) {
        const target = eventId ? 'Event' : country === 'IN' ? 'India' : 'USA';
        toast({ title: 'Cache Refreshed', description: `KV cache updated for ${target}.` });
        // Re-fetch metrics after refreshing cache
        if (eventId) {
          fetchOverviewMetrics({ eventId });
        } else if (selectedEventIdForStats === 'all-in' && country === 'IN') {
          fetchOverviewMetrics({ country: 'IN' });
        } else if (selectedEventIdForStats === 'all-us' && country === 'US') {
          fetchOverviewMetrics({ country: 'US' });
        }
      } else {
        toast({ variant: 'destructive', title: 'Refresh Failed', description: result.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setIsRefreshingCache(false);
    }
  }, [selectedEventIdForStats, toast, fetchOverviewMetrics]);

  const handleAnalyticsSyncAll = useCallback(async () => {
    setIsAnalyticsSyncing(true);
    try {
      const errors: string[] = [];

      // Re-compute ticket stats from Firestore and persist to KV
      const ticketStatsResult = await refreshTicketStatsCacheAction();
      if (!ticketStatsResult.success) {
        errors.push(`Ticket Stats: ${ticketStatsResult.message}`);
      } else if (ticketStatsResult.eventTicketStats) {
        setTicketStats(ticketStatsResult.eventTicketStats);
      }

      const inResult = await computeCountryRegistrationMetricsAction('IN');
      if (!inResult.success) errors.push(`IN: ${inResult.message}`);

      const usResult = await computeCountryRegistrationMetricsAction('US');
      if (!usResult.success) errors.push(`US: ${usResult.message}`);

      for (const event of upcomingEvents) {
        const eventResult = await computeEventRegistrationMetricsAction(event.id);
        if (!eventResult.success) {
          errors.push(`${event.eventName}: ${eventResult.message}`);
        }
      }

      if (errors.length > 0) {
        throw new Error(`Partial sync failures (${errors.length}).`);
      }

      toast({
        title: 'Analytics Synced',
        description: `KV cache updated for ticket stats, IN, US, and ${upcomingEvents.length} upcoming event(s).`,
      });

      // Refresh ticket stats after sync to update Ticket Sales & Stats card
      fetchTicketStats();

      // Refresh current metrics
      if (selectedEventIdForStats === 'all-in') {
        fetchOverviewMetrics({ country: 'IN' });
      } else if (selectedEventIdForStats === 'all-us') {
        fetchOverviewMetrics({ country: 'US' });
      } else if (selectedEventIdForStats && selectedEventIdForStats !== 'all') {
        fetchOverviewMetrics({ eventId: selectedEventIdForStats });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Sync Failed', description: error.message });
    } finally {
      setIsAnalyticsSyncing(false);
    }
  }, [selectedEventIdForStats, toast, fetchOverviewMetrics, fetchTicketStats, upcomingEvents]);

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
      const eventCurrency = normalizeCurrency(event?.currency);
      setActiveCurrency(eventCurrency);
      fetchOverviewMetrics({ eventId: selectedEventIdForStats, currency: eventCurrency });
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
    const normalizeCountryCode = (eventCountry?: string | null, eventCurrency?: string | null): 'IN' | 'US' | null => {
      const c = (eventCountry || '').trim().toLowerCase();
      const curr = (eventCurrency || '').trim().toUpperCase();
      if (c === 'in' || c === 'india' || curr === 'INR') return 'IN';
      if (c === 'us' || c === 'usa' || c === 'united states' || c === 'united states of america' || curr === 'USD') return 'US';
      return null;
    };

    if (selectedEventIdForStats === 'all' || selectedEventIdForStats === 'all-in' || selectedEventIdForStats === 'all-us') {
      const eventMetaById = new Map(events.map(e => [e.id, e]));

      const filteredStats = ticketStats.filter(stat => {
        const meta = eventMetaById.get(stat.eventId);
        if (!meta) return false;
        const mappedCountry = normalizeCountryCode(meta.country, meta.currency || null);

        if (selectedEventIdForStats === 'all-in') return mappedCountry === 'IN';
        if (selectedEventIdForStats === 'all-us') return mappedCountry === 'US';
        return true;
      });

      const ticketMap = new Map<string, { sold: number; remaining: number | 'Unlimited' }>();
      let totalRevenueFromEventPaisa = 0;
      let totalTicketsSoldInEvent = 0;

      for (const stat of filteredStats) {
        totalRevenueFromEventPaisa += stat.totalRevenueFromEventPaisa || 0;
        totalTicketsSoldInEvent += stat.totalTicketsSoldInEvent || 0;

        for (const ticket of stat.tickets || []) {
          const existing = ticketMap.get(ticket.ticketName) || { sold: 0, remaining: 0 };
          const existingRemaining = existing.remaining;
          const nextRemaining = ticket.remaining;

          let mergedRemaining: number | 'Unlimited' = 0;
          if (existingRemaining === 'Unlimited' || nextRemaining === 'Unlimited') {
            mergedRemaining = 'Unlimited';
          } else {
            mergedRemaining = Number(existingRemaining || 0) + Number(nextRemaining || 0);
          }

          ticketMap.set(ticket.ticketName, {
            sold: (existing.sold || 0) + (ticket.sold || 0),
            remaining: mergedRemaining,
          });
        }
      }

      return {
        eventId: selectedEventIdForStats,
        eventName:
          selectedEventIdForStats === 'all'
            ? 'All Upcoming Events (Global)'
            : selectedEventIdForStats === 'all-in'
              ? 'Upcoming Events (India)'
              : 'Upcoming Events (USA)',
        totalRevenueFromEventPaisa,
        totalTicketsSoldInEvent,
        tickets: Array.from(ticketMap.entries())
          .map(([ticketName, t], idx) => ({
            ticketDefinitionId: `${ticketName}-${idx}`,
            ticketName,
            sold: t.sold,
            remaining: t.remaining,
          }))
          .sort((a, b) => b.sold - a.sold),
      } as any;
    }

    return ticketStats.find(stat => stat.eventId === selectedEventIdForStats) || null;
  }, [ticketStats, selectedEventIdForStats, events]);

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
         <h3 className="text-lg font-semibold text-foreground">Registration Overview</h3>
         <div className="flex gap-2 w-full sm:w-auto">
           <Select value={selectedEventIdForStats} onValueChange={setSelectedEventIdForStats} disabled={isLoadingEvents}>
               <SelectTrigger className="flex-1 sm:flex-none sm:w-[250px] text-xs h-9">
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
           <Button 
             size="sm" 
             variant={isRefreshingCache ? 'default' : 'outline'}
             onClick={() => {
               if (selectedEventIdForStats === 'all-in') handleRefreshKVCache('IN');
               else if (selectedEventIdForStats === 'all-us') handleRefreshKVCache('US');
               else if (selectedEventIdForStats !== 'all') handleRefreshKVCache(undefined, selectedEventIdForStats);
             }}
             disabled={isRefreshingCache || selectedEventIdForStats === 'all'}
             className="h-9"
             title="Refresh KV cache for selected event/country"
           >
             <RefreshCw className={`h-4 w-4 ${isRefreshingCache ? 'animate-spin' : ''}`} />
           </Button>
           <Button 
             size="sm" 
             variant={isAnalyticsSyncing ? 'default' : 'outline'}
             onClick={handleAnalyticsSyncAll}
             disabled={isAnalyticsSyncing}
             className="h-9 bg-amber-600 hover:bg-amber-700"
             title="Auto-sync all analytics metrics to KV for upcoming events"
           >
             <Zap className={`h-4 w-4 ${isAnalyticsSyncing ? 'animate-spin' : ''}`} />
           </Button>
         </div>
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
                                  {selectedEventForTicketStats.tickets.map((ticket: any) => (
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
