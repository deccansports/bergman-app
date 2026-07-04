// src/components/admin/AccountingTab.tsx
"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import type { EventCalendarEntry, EventParticipant, FinancialSummary, DeferralEntry, CategoryChangeEntry } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import {
  Loader2,
  RefreshCw,
  MessageSquare,
  IndianRupee,
  History,
  Repeat,
  RotateCcw,
  Search,
  Filter,
  Trash2,
  CalendarDays,
  CreditCard
} from "lucide-react";

import {
  getFinancialsForEventAction,
  getDeferralAccountingAction,
  getCategoryChangeAccountingAction,
  sendWhatsAppInvoiceAction,
  deleteZohoInvoiceAction,
  syncPaymentToZohoAction,
    syncOnlyPaymentToZohoAction,
    syncDeferralInvoiceToZohoAction,
    syncCategoryChangeInvoiceToZohoAction,
} from "@/lib/actions";
import { ScrollArea } from "@/components/ui/scroll-area";

import { format, parseISO } from "date-fns";

interface AccountingTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

const formatCurrency = (paisa: number) =>
  `₹${(paisa / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatCurrencyByCode = (minorUnits: number, currency: 'INR' | 'USD' = 'INR') => {
    const amount = (minorUnits || 0) / 100;
    if (currency === 'USD') {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
    }

    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
};

const isOfflineOrBulkPayment = (paymentMethod?: string | null): boolean => {
    const lower = String(paymentMethod || '').toLowerCase();
    return (
        lower.includes('offline') ||
        lower.includes('cash') ||
        lower.includes('bulk') ||
        lower.includes('admin') ||
        lower.includes('google form') ||
        lower.includes('google_form') ||
        lower.includes('form upload') ||
        lower.includes('manual')
    );
};

const getRegistrationMethod = (paymentMethod?: string | null): { label: string; variant: 'default' | 'secondary' | 'outline' } => {
    const lower = String(paymentMethod || '').toLowerCase();

    if (!lower) {
        return { label: 'Unknown', variant: 'outline' };
    }

    if (lower.includes('upi') || lower.includes('razorpay') || lower.includes('card') || lower.includes('online') || lower.includes('netbanking')) {
        return { label: 'Online', variant: 'default' };
    }

    if (lower.includes('admin') || lower.includes('offline') || lower.includes('cash') || lower.includes('manual') || lower.includes('bulk') || lower.includes('google form') || lower.includes('google_form')) {
        return { label: 'Offline', variant: 'secondary' };
    }

    return { label: paymentMethod || 'Other', variant: 'outline' };
};

export default function AccountingTab({ events, isLoadingEvents }: AccountingTabProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const isViewOnlyAdmin = !!(currentUser?.isAdmin && currentUser?.adminAccessMode === 'view');
  const isMobile = useIsMobile();

  const [selectedEventId, setSelectedEventId] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("registrations");
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  
  // Data States
  const [registrations, setRegistrations] = useState<EventParticipant[]>([]);
  const [deferrals, setDeferrals] = useState<DeferralEntry[]>([]);
  const [categoryChanges, setCategoryChanges] = useState<CategoryChangeEntry[]>([]);
  
  // Processing States
  const [isRetryingSync, setIsRetryingSync] = useState<string | null>(null);
  const [isDeletingInvoice, setIsDeletingInvoice] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<'all' | 'online' | 'offline'>('all');

  const fetchAllAccountingData = useCallback(async () => {
    setIsLoading(true);
    try {
      const eid = selectedEventId === 'all' ? undefined : selectedEventId;
      
      const [regRes, defRes, catRes] = await Promise.all([
        getFinancialsForEventAction(eid || 'all'), 
        getDeferralAccountingAction(eid),
        getCategoryChangeAccountingAction(eid)
      ]);

      if (regRes.success) {
        setRegistrations(regRes.transactions || []);
        setSummary(regRes.summary || null);
      } else {
        setRegistrations([]);
        setSummary(null);
      }

      if (defRes.success) setDeferrals(defRes.deferrals || []);
      if (catRes.success) setCategoryChanges(catRes.changes || []);

    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Load Error', description: e.message });
    } finally {
      setIsLoading(false);
    }
  }, [selectedEventId, toast]);

  useEffect(() => {
    fetchAllAccountingData();
  }, [fetchAllAccountingData]);

  const handleManualSync = async (id: string, type: 'registration' | 'deferral' | 'categoryChange', bookingId: string, eventId: string) => {
    setIsRetryingSync(id);
    try {
            const result =
                type === 'registration'
                    ? await syncPaymentToZohoAction(eventId, id)
                    : type === 'deferral'
                    ? await syncDeferralInvoiceToZohoAction(id)
                    : await syncCategoryChangeInvoiceToZohoAction(id);

      if (result.success) {
        toast({ title: "Sync Successful", description: result.message });
        fetchAllAccountingData();
      } else {
        toast({ variant: "destructive", title: "Sync Failed", description: result.message });
      }
    } catch (e: any) {
        toast({ variant: "destructive", title: "API Error", description: e.message });
    } finally {
      setIsRetryingSync(null);
    }
  };

  const handleSyncPaymentOnly = async (r: EventParticipant) => {
    if (!r.eventId) return;
    setIsRetryingSync(r.id);
    try {
        const result = await syncOnlyPaymentToZohoAction(r.eventId, r.id);
        if (result.success) {
            toast({ title: "Payment Synced", description: result.message });
            fetchAllAccountingData();
        } else {
            toast({ variant: "destructive", title: "Sync Failed", description: result.message });
        }
    } catch (e: any) {
        toast({ variant: "destructive", description: e.message });
    } finally {
        setIsRetryingSync(null);
    }
  };

  const handleDeleteInvoice = async (r: any) => {
    if (!r.eventId) return;
    setIsDeletingInvoice(r.id);
    try {
        const res = await deleteZohoInvoiceAction(r.eventId, r.id, r.invoiceId || null, r.invoiceNumber || null);
        if (res.success) {
            toast({ title: "Invoice Record Cleared" });
            fetchAllAccountingData();
        } else {
            toast({ variant: "destructive", description: res.message });
        }
    } catch (e: any) {
        toast({ variant: "destructive", description: e.message });
    } finally {
        setIsDeletingInvoice(null);
    }
  };

  const filteredRegistrations = useMemo(() => {
    let list = registrations.filter(r => {
        const matchesSearch = !searchTerm || r.name.toLowerCase().includes(searchTerm.toLowerCase()) || r.email?.toLowerCase().includes(searchTerm.toLowerCase()) || r.bookingId?.toLowerCase().includes(searchTerm.toLowerCase());
        
                const isOnline = !isOfflineOrBulkPayment(r.paymentMethod);
        const matchesType = paymentTypeFilter === 'all' || (paymentTypeFilter === 'online' ? isOnline : !isOnline);
        
        return matchesSearch && matchesType;
    });
    return list.sort((a, b) => new Date(b.registeredAt || 0).getTime() - new Date(a.registeredAt || 0).getTime());
  }, [registrations, searchTerm, paymentTypeFilter]);

  const filteredDeferrals = useMemo(() => {
    let list = deferrals.filter(d => !searchTerm || d.participantName?.toLowerCase().includes(searchTerm.toLowerCase()) || d.participantEmail.toLowerCase().includes(searchTerm.toLowerCase()));
    return list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [deferrals, searchTerm]);

  const filteredCategoryChanges = useMemo(() => {
    let list = categoryChanges.filter(c => !searchTerm || c.participantName?.toLowerCase().includes(searchTerm.toLowerCase()) || c.participantEmail.toLowerCase().includes(searchTerm.toLowerCase()));
    return list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [categoryChanges, searchTerm]);

    const summaryCurrency = useMemo<'INR' | 'USD'>(() => {
        if (selectedEventId !== 'all') {
            const selectedEvent = events.find((e) => e.id === selectedEventId);
            return selectedEvent?.currency === 'USD' ? 'USD' : 'INR';
        }

        const currencies = new Set(
            (registrations || [])
                .map((r) => String((r as any)?.pricingBreakdown?.currency || '').toUpperCase())
                .filter(Boolean)
        );
        return currencies.size === 1 && currencies.has('USD') ? 'USD' : 'INR';
    }, [selectedEventId, events, registrations]);

  const renderNav = () => {
    if (isMobile) {
      return (
        <div className="w-full mb-6">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="w-full h-11 rounded-xl bg-background border-muted font-bold text-left">
              <SelectValue placeholder="Select section..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="registrations">Race Invoices</SelectItem>
              <SelectItem value="deferrals">Deferral Fees</SelectItem>
              <SelectItem value="category">Category Upgrades</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    }
    return (
      <TabsList className="bg-muted/50 p-1 mb-6 rounded-xl border border-border/50">
        <TabsTrigger value="registrations" className="gap-2 font-black uppercase text-[10px] tracking-widest">
          <History className="h-4 w-4"/>Race Invoices
        </TabsTrigger>
        <TabsTrigger value="deferrals" className="gap-2 font-black uppercase text-[10px] tracking-widest">
          <RotateCcw className="h-4 w-4"/>Deferral Fees
        </TabsTrigger>
        <TabsTrigger value="category" className="gap-2 font-black uppercase text-[10px] tracking-widest">
          <Repeat className="h-4 w-4"/>Category Upgrades
        </TabsTrigger>
      </TabsList>
    );
  };

  return (
    <div className="space-y-6 text-left">
      <div className="flex flex-col md:flex-row justify-between items-center text-center md:text-left gap-4">
        <div className="w-full md:w-auto">
            <h2 className="text-2xl font-black uppercase italic tracking-tighter text-primary">Financial Control Center</h2>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Invoicing, Sync Audit & Revenue Tracking</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
            <Select value={selectedEventId} onValueChange={setSelectedEventId}>
                <SelectTrigger className="w-full md:w-[300px] h-11 rounded-xl bg-background border-muted font-bold text-left">
                    <SelectValue placeholder="All Events" />
                </SelectTrigger>
                <SelectContent className="text-left">
                    <SelectItem value="all" className="text-left">Consolidated (All Races)</SelectItem>
                    {events.map(e => <SelectItem key={e.id} value={e.id} className="text-left">{e.eventName}</SelectItem>)}
                </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 rounded-xl hidden sm:flex" onClick={fetchAllAccountingData} disabled={isLoading}>
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>
            <Button variant="outline" className="w-full sm:hidden h-11 rounded-xl" onClick={fetchAllAccountingData} disabled={isLoading}>
                <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
                Refresh Data
            </Button>
        </div>
      </div>

      {summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <Card className="bg-primary/5 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-xl font-black">{formatCurrencyByCode(summary.totalRevenue, summaryCurrency)}</CardTitle><CardDescription className="text-[9px] font-bold uppercase">Race Revenue</CardDescription></CardHeader></Card>
              <Card className="bg-green-50 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-xl font-black text-green-700">{formatCurrencyByCode(summary.totalOnlineRevenue, summaryCurrency)}</CardTitle><CardDescription className="text-[9px] font-bold uppercase text-green-600">Online Portions</CardDescription></CardHeader></Card>
              <Card className="bg-orange-50 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-xl font-black text-orange-700">{formatCurrencyByCode(summary.totalFees, summaryCurrency)}</CardTitle><CardDescription className="text-[9px] font-bold uppercase text-orange-600">Platform Costs</CardDescription></CardHeader></Card>
              <Card className="bg-muted border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-xl font-black">{summary.totalTransactions}</CardTitle><CardDescription className="text-[9px] font-bold uppercase">Field Size</CardDescription></CardHeader></Card>
          </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex justify-center md:justify-start">
            {renderNav()}
        </div>

        <Card className="border-none shadow-xl rounded-2xl overflow-hidden">
            <CardHeader className="bg-muted/30 border-b pb-4">
                <div className="flex flex-col lg:flex-row justify-between items-center gap-4">
                    <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
                        <div className="relative flex-grow md:w-80">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search records..." className="pl-10 h-10 rounded-xl bg-background border-none shadow-sm font-bold text-xs text-left" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                        </div>
                        <Select value={paymentTypeFilter} onValueChange={(v: any) => setPaymentTypeFilter(v)}>
                            <SelectTrigger className="w-full sm:w-32 h-10 rounded-xl bg-background border-none shadow-sm font-bold text-xs text-left">
                                <Filter className="mr-2 h-3 w-3" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="text-left">
                                <SelectItem value="all" className="text-left">All Modes</SelectItem>
                                <SelectItem value="online" className="text-left">Online Only</SelectItem>
                                <SelectItem value="offline" className="text-left">Offline Only</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Badge variant="outline" className="font-black uppercase text-[9px] tracking-[0.2em] bg-background">
                        {isLoading ? "Synchronizing..." : "Real-time Audit Active"}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                
                {/* 1. RACE REGISTRATIONS TAB */}
                <TabsContent value="registrations" className="m-0 border-none">
                    <div className="overflow-x-auto text-left">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="h-10 text-[10px] font-black uppercase">
                                    <TableHead className="pl-6 text-left"><div className="flex items-center gap-1"><CalendarDays className="h-3 w-3"/>Date</div></TableHead>
                                    <TableHead className="text-left">Athlete</TableHead>
                                    <TableHead className="text-left">Event</TableHead>
                                    <TableHead className="text-left">Registration</TableHead>
                                    <TableHead className="text-left">Amount</TableHead>
                                    <TableHead className="text-left">Sync Status</TableHead>
                                    <TableHead className="text-left">Invoice</TableHead>
                                    <TableHead className="text-right pr-6">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? <TableRow><TableCell colSpan={8} className="text-center p-12"><Loader2 className="animate-spin h-8 w-8 text-primary mx-auto"/></TableCell></TableRow>
                                : filteredRegistrations.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-16 text-muted-foreground italic">No registration records found.</TableCell></TableRow>
                                : filteredRegistrations.map(r => (
                                    <TableRow key={r.id} className="h-14 hover:bg-muted/10 transition-colors text-xs text-left">
                                        <TableCell className="pl-6 font-mono text-[10px] text-muted-foreground text-left">
                                            {r.registeredAt ? format(parseISO(r.registeredAt), 'dd MMM yyyy') : '—'}
                                        </TableCell>
                                        <TableCell className="text-left">
                                            <div className="font-bold uppercase tracking-tight text-left">{r.name}</div>
                                            <div className="text-[10px] text-muted-foreground lowercase text-left">{r.email}</div>
                                        </TableCell>
                                        <TableCell className="font-medium text-slate-500 uppercase text-left">{r.eventName}</TableCell>
                                        <TableCell className="text-left">
                                            {(() => {
                                                const method = getRegistrationMethod(r.paymentMethod);
                                                return <Badge variant={method.variant} className={cn("text-[9px] font-black uppercase", method.variant === 'default' ? 'bg-blue-600 text-white' : method.variant === 'secondary' ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground')}>{method.label}</Badge>;
                                            })()}
                                        </TableCell>
                                        <TableCell className="font-black text-primary text-left">{formatCurrencyByCode(r.amountPaidPaisa || 0, String((r as any)?.pricingBreakdown?.currency || '').toUpperCase() === 'USD' ? 'USD' : 'INR')}</TableCell>
                                        <TableCell className="text-left">
                                            <Badge variant={r.zohoSynced ? 'default' : 'secondary'} className={cn("text-[9px] font-black uppercase", r.zohoSynced ? "bg-green-600" : "bg-amber-100 text-amber-700")}>
                                                {r.zohoSynced ? "Synced" : r.zohoSyncError ? "Failed" : "Pending"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-mono text-[10px] text-left">{r.invoiceNumber || "—"}</TableCell>
                                        <TableCell className="text-right pr-6 space-x-1">
                                            {!r.invoiceNumber && !isOfflineOrBulkPayment(r.paymentMethod) && !r.zohoSynced && (
                                                <Button size="xs" variant="outline" className="rounded-lg h-7 px-3 font-black text-[9px] uppercase tracking-tighter" onClick={() => handleManualSync(r.id, 'registration', r.bookingId!, r.eventId!)} disabled={isRetryingSync === r.id || isViewOnlyAdmin}>
                                                    {isRetryingSync === r.id ? <Loader2 className="animate-spin h-3 w-3" /> : "Retry Sync"}
                                                </Button>
                                            )}
                                            {!r.invoiceNumber && isOfflineOrBulkPayment(r.paymentMethod) && !r.zohoSynced && (
                                                <Button size="xs" variant="outline" className="rounded-lg h-7 px-3 font-black text-[9px] uppercase tracking-tighter opacity-50" disabled>
                                                    No Sync Needed
                                                </Button>
                                            )}
                                            {r.invoiceNumber && (
                                                <div className="flex justify-end gap-1">
                                                    <Button size="xs" variant="ghost" className="h-7 w-7 text-blue-600 hover:bg-blue-50" title="Re-sync Payment" onClick={() => handleSyncPaymentOnly(r)} disabled={isRetryingSync === r.id || isViewOnlyAdmin}>
                                                        <CreditCard className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button size="xs" variant="ghost" className="h-7 w-7 text-green-600 hover:bg-green-50" onClick={() => sendWhatsAppInvoiceAction(r.eventId!, r.id)} disabled={isViewOnlyAdmin}>
                                                        <MessageSquare className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button size="xs" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/5" disabled={isDeletingInvoice === r.id || isViewOnlyAdmin}>
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent className="text-left">
                                                            <AlertDialogHeader className="text-left">
                                                                <AlertDialogTitle className="text-left">Delete Zoho Invoice Mapping?</AlertDialogTitle>
                                                                <AlertDialogDescription className="text-left">
                                                                    This will remove the invoice number and ID from the roster record. Use this if you need to re-sync or correct a payment mismatch.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter className="text-left">
                                                                <AlertDialogCancel>Back</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleDeleteInvoice(r)} className="bg-destructive" disabled={isViewOnlyAdmin}>Clear Mapping</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* 2. DEFERRALS TAB */}
                <TabsContent value="deferrals" className="m-0 border-none">
                    <div className="overflow-x-auto text-left">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="h-10 text-[10px] font-black uppercase">
                                    <TableHead className="pl-6 text-left"><div className="flex items-center gap-1"><CalendarDays className="h-3 w-3"/>Date</div></TableHead>
                                    <TableHead className="text-left">Athlete</TableHead>
                                    <TableHead className="text-left">Issued From</TableHead>
                                    <TableHead className="text-left">Fee Paid</TableHead>
                                    <TableHead className="text-left">Sync Status</TableHead>
                                    <TableHead className="text-left">Invoice</TableHead>
                                    <TableHead className="text-right pr-6">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? <TableRow><TableCell colSpan={7} className="text-center p-12"><Loader2 className="animate-spin h-8 w-8 text-primary mx-auto"/></TableCell></TableRow>
                                : filteredDeferrals.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-16 text-muted-foreground italic">No deferral fee records found.</TableCell></TableRow>
                                : filteredDeferrals.map(d => (
                                    <TableRow key={d.id} className="h-14 hover:bg-muted/10 transition-colors text-xs text-left">
                                        <TableCell className="pl-6 font-mono text-[10px] text-muted-foreground text-left">
                                            {d.createdAt ? format(parseISO(d.createdAt), 'dd MMM yyyy') : '—'}
                                        </TableCell>
                                        <TableCell className="text-left">
                                            <div className="font-bold uppercase tracking-tight text-left">{d.participantName}</div>
                                            <div className="text-[10px] text-muted-foreground lowercase text-left">{d.participantEmail}</div>
                                        </TableCell>
                                        <TableCell className="font-medium text-slate-500 uppercase text-left">{d.originalEventName}</TableCell>
                                        <TableCell className="font-black text-orange-600 text-left">{formatCurrency(d.totalAmountPaidPaisa || 200000)}</TableCell>
                                        <TableCell className="text-left">
                                            <Badge variant={d.invoiceNumber ? 'default' : 'secondary'} className={cn("text-[9px] font-black uppercase", d.invoiceNumber ? "bg-green-600" : "bg-amber-100 text-amber-700")}>
                                                {d.invoiceNumber ? "Synced" : "Pending"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-mono text-[10px] text-left">{d.invoiceNumber || "—"}</TableCell>
                                        <TableCell className="text-right pr-6">
                                            {!d.invoiceNumber && (
                                                <Button size="xs" variant="outline" className="rounded-lg h-7 px-3 font-black text-[9px] uppercase tracking-tighter" onClick={() => handleManualSync(d.id, 'deferral', d.id, d.originalEventId)} disabled={isRetryingSync === d.id}>
                                                    {isRetryingSync === d.id ? <Loader2 className="animate-spin h-3 w-3" /> : "Manual Sync"}
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* 3. CATEGORY CHANGES TAB */}
                <TabsContent value="category" className="m-0 border-none">
                    <div className="overflow-x-auto text-left">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="h-10 text-[10px] font-black uppercase">
                                    <TableHead className="pl-6 text-left"><div className="flex items-center gap-1"><CalendarDays className="h-3 w-3"/>Date</div></TableHead>
                                    <TableHead className="text-left">Athlete</TableHead>
                                    <TableHead className="text-left">Transition Path</TableHead>
                                    <TableHead className="text-left">Total Paid</TableHead>
                                    <TableHead className="text-left">Sync Status</TableHead>
                                    <TableHead className="text-left">Invoice</TableHead>
                                    <TableHead className="text-right pr-6">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? <TableRow><TableCell colSpan={7} className="text-center p-12"><Loader2 className="animate-spin h-8 w-8 text-primary mx-auto"/></TableCell></TableRow>
                                : filteredCategoryChanges.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-16 text-muted-foreground italic">No category change records found.</TableCell></TableRow>
                                : filteredCategoryChanges.map(c => (
                                    <TableRow key={c.id} className="h-14 hover:bg-muted/10 transition-colors text-xs text-left">
                                        <TableCell className="pl-6 font-mono text-[10px] text-muted-foreground text-left">
                                            {c.createdAt ? format(parseISO(c.createdAt), 'dd MMM yyyy') : '—'}
                                        </TableCell>
                                        <TableCell className="text-left">
                                            <div className="font-bold uppercase tracking-tight text-left">{c.participantName}</div>
                                            <div className="text-[10px] text-muted-foreground lowercase text-left">{c.participantEmail}</div>
                                        </TableCell>
                                        <TableCell className="max-w-[200px] text-left">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase truncate text-left">{c.fromTicketName}</div>
                                            <div className="flex items-center gap-1.5 text-[9px] font-black text-purple-600 uppercase text-left">
                                                <Repeat className="h-2.5 w-2.5" /> {c.toTicketName}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-black text-purple-600 text-left">{formatCurrency(c.totalPaidPaisa)}</TableCell>
                                        <TableCell className="text-left">
                                            <Badge variant={c.zohoSync?.status === 'success' ? 'default' : 'secondary'} className={cn("text-[9px] font-black uppercase", c.zohoSync?.status === 'success' ? "bg-green-600" : "bg-amber-100 text-amber-700")}>
                                                {c.zohoSync?.status || "Pending"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-mono text-[10px] text-left">{c.zohoSync?.invoiceNumber || "—"}</TableCell>
                                        <TableCell className="text-right pr-6">
                                            {c.zohoSync?.status !== 'success' && (
                                                <Button size="xs" variant="outline" className="rounded-lg h-7 px-3 font-black text-[9px] uppercase tracking-tighter" onClick={() => handleManualSync(c.id, 'categoryChange', c.id, c.eventId)} disabled={isRetryingSync === c.id}>
                                                    {isRetryingSync === c.id ? <Loader2 className="animate-spin h-3 w-3" /> : "Retry"}
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

            </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}
