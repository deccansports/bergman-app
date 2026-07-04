// src/components/admin/DeferralsTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { DeferralEntry, DeferralStats, EventCalendarEntry, GlobalServiceFees, ServiceFeeConfig } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Edit, Trash2, Send, PlusCircle, FileClock, IndianRupee, DollarSign, Save, Info, Mail, ShieldCheck } from 'lucide-react';
import { format, parseISO, addYears, endOfYear } from 'date-fns';
import {
  getAllDeferralsAction,
  getDeferralStatsAction,
  updateDeferralAction,
  deleteDeferralAction,
  addManualDeferralAction,
  sendMonthlyDeferralReminderEmailAction,
  sendManualDeferralReminderAction,
} from '@/lib/actions';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { getServiceFeesAction, updateServiceFeesAction } from '@/lib/actions/systemActions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AdminManualDeferralCreateSchema, type AdminManualDeferralCreateFormInput, AdminDeferralEditSchema, type AdminDeferralEditFormInput } from '@/lib/schemas';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '../ui/scroll-area';
import { Textarea } from '../ui/textarea';

const statusVariantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  'Pending Ticket Selection': 'secondary',
  'Used': 'default',
  'Confirmed': 'default',
  'Expired': 'destructive',
  'RevokedByAdmin': 'destructive',
};

const NO_ASSIGNMENT_PLACEHOLDER_VALUE = "--no-assignment-placeholder--";

function ServicePricingManager() {
  const { toast } = useToast();
  const [fees, setFees] = useState<GlobalServiceFees | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const monetaryFields: (keyof ServiceFeeConfig)[] = [
    'deferralFeePaisa',
    'deferralFeeUsdCents',
    'categoryChangeFeePaisa',
    'categoryChangeFeeUsdCents',
  ];

  useEffect(() => {
    getServiceFeesAction().then(res => {
      if (res.success && res.fees) setFees(res.fees);
      setIsLoading(false);
    });
  }, []);

  const handleUpdateFee = (category: keyof GlobalServiceFees, field: keyof ServiceFeeConfig, value: string) => {
    if (!fees) return;
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return;
    const numValue = monetaryFields.includes(field) ? Math.round(parsed * 100) : Math.round(parsed);
    setFees({
      ...fees,
      [category]: { ...fees[category], [field]: numValue }
    });
  };

  const handleSave = async () => {
    if (!fees) return;
    setIsSaving(true);
    const res = await updateServiceFeesAction(fees);
    if (res.success) toast({ title: "Success", description: "Pricing updated." });
    else toast({ variant: "destructive", title: "Error", description: res.message });
    setIsSaving(false);
  };

  if (isLoading) return <Loader2 className="animate-spin mx-auto my-10" />;

  const categories = Object.keys(fees || {}) as (keyof GlobalServiceFees)[];

  return (
    <Card className="border-primary/20">
      <CardHeader className="p-4">
        <CardTitle className="flex items-center gap-2 text-sm font-black uppercase text-left leading-none"><IndianRupee className="h-4 w-4 text-primary"/><DollarSign className="h-4 w-4 text-green-600 -ml-1"/>Service Pricing Matrix</CardTitle>
        <CardDescription className="text-left text-[10px] uppercase font-bold mt-1">Configure processing fees per race type.</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 text-left">
        <div className="rounded-xl border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10 text-[10px] font-black uppercase">
                <TableHead>Race Type</TableHead>
                <TableHead className="text-right">Def. Fee (₹)</TableHead>
                <TableHead className="text-right">Def. Fee ($)</TableHead>
                <TableHead className="text-right">Cat. Chg Fee (₹)</TableHead>
                <TableHead className="text-right">Cat. Chg Fee ($)</TableHead>
                <TableHead className="text-right">Min Age (Yrs)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => (
                <TableRow key={cat.toString()} className="h-10">
                  <TableCell className="font-bold uppercase tracking-tight text-xs">{cat.toString()}</TableCell>
                  <TableCell className="text-right">
                    <Input 
                      type="number" 
                      className="w-20 ml-auto h-7 text-right font-mono text-xs" 
                      value={(fees![cat]?.deferralFeePaisa || 0) / 100}
                      onChange={e => handleUpdateFee(cat, 'deferralFeePaisa', e.target.value)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input 
                      type="number" 
                      step="0.01"
                      className="w-20 ml-auto h-7 text-right font-mono text-xs border-green-300 focus-visible:ring-green-400" 
                      value={(fees![cat]?.deferralFeeUsdCents || 0) / 100}
                      onChange={e => handleUpdateFee(cat, 'deferralFeeUsdCents', e.target.value)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input 
                      type="number" 
                      className="w-20 ml-auto h-7 text-right font-mono text-xs" 
                      value={(fees![cat]?.categoryChangeFeePaisa || 0) / 100}
                      onChange={e => handleUpdateFee(cat, 'categoryChangeFeePaisa', e.target.value)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input 
                      type="number" 
                      step="0.01"
                      className="w-20 ml-auto h-7 text-right font-mono text-xs border-green-300 focus-visible:ring-green-400" 
                      value={(fees![cat]?.categoryChangeFeeUsdCents || 0) / 100}
                      onChange={e => handleUpdateFee(cat, 'categoryChangeFeeUsdCents', e.target.value)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      className="w-20 ml-auto h-7 text-right font-mono text-xs"
                      value={fees![cat]?.minimumAgeYears ?? (cat === 'Swimming' ? 9 : 16)}
                      onChange={e => handleUpdateFee(cat, 'minimumAgeYears', e.target.value)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <CardFooter className="justify-end bg-muted/20 border-t p-3">
        <Button onClick={handleSave} disabled={isSaving} size="sm" className="h-8 text-[10px] font-black uppercase tracking-widest">
          {isSaving ? <Loader2 className="animate-spin mr-2 h-3 w-3"/> : <Save className="mr-2 h-3 w-3"/>}
          Apply Matrix
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function DeferralsTab() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('management');
  const [requests, setRequests] = useState<DeferralEntry[]>([]);
  const [stats, setStats] = useState<DeferralStats | null>(null);
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDeferral, setSelectedDeferral] = useState<DeferralEntry | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingReminders, setIsSendingReminders] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  const editForm = useForm<AdminDeferralEditFormInput>({ resolver: zodResolver(AdminDeferralEditSchema) });
  const createForm = useForm<AdminManualDeferralCreateFormInput>({
    resolver: zodResolver(AdminManualDeferralCreateSchema),
    defaultValues: { name: '', email: '', originalEventId: '', originalAmountPaidPaisa: 0, estimatedOriginalBasePricePaisa: 0, deferralDate: new Date(), expiryDate: addYears(new Date(), 1) }
  });

  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    const [deferralsRes, statsRes, eventsRes] = await Promise.all([
      getAllDeferralsAction(),
      getDeferralStatsAction(),
      getCalendarEventsAction()
    ]);
    if (deferralsRes.success) setRequests(deferralsRes.deferrals || []);
    if (statsRes.success) setStats(statsRes.stats || null);
    if (eventsRes.success) setEvents(eventsRes.events || []);
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  useEffect(() => {
    if (isEditModalOpen && selectedDeferral) {
        editForm.reset({
            participantName: selectedDeferral.participantName || '',
            participantEmail: selectedDeferral.participantEmail,
            status: selectedDeferral.status,
            expiryDate: selectedDeferral.expiryDate ? parseISO(selectedDeferral.expiryDate) : undefined,
            originalAmountPaidPaisa: selectedDeferral.originalAmountPaidPaisa || 0,
            estimatedOriginalBasePricePaisa: selectedDeferral.estimatedOriginalBasePricePaisa || 0,
            adminNotes: selectedDeferral.notes || '',
            deferredToEventId: selectedDeferral.deferredToEventId || "NONE",
            deferredToTicketId: selectedDeferral.deferredToTicketId || "NONE",
        });
    }
  }, [isEditModalOpen, selectedDeferral, editForm]);

  const filteredRequests = useMemo(() => {
    if (!searchTerm) return requests;
    const term = searchTerm.toLowerCase();
    return requests.filter(d => 
      d.participantName?.toLowerCase().includes(term) || d.participantEmail.toLowerCase().includes(term)
    );
  }, [requests, searchTerm]);

  const handleBulkRemind = async () => {
      setIsSendingReminders(true);
      const res = await sendMonthlyDeferralReminderEmailAction();
      if(res.success) toast({title: "Reminders Sent", description: res.message});
      else toast({variant: "destructive", title: "Error", description: res.message});
      setIsSendingReminders(false);
      fetchAllData();
  };

  const handleManualRemind = async (id: string, channel: 'email' | 'whatsapp') => {
      const res = await sendManualDeferralReminderAction(id, channel);
      if(res.success) toast({title: "Reminder Sent"});
      else toast({variant: "destructive", description: res.message});
      fetchAllData();
  };

  const handleDelete = async (deferral: DeferralEntry) => {
    setIsDeletingId(deferral.id);
    const res = await deleteDeferralAction(deferral.id, deferral.userId);
    if (res.success) {
        toast({ title: "Deleted", description: "Deferral record removed." });
        fetchAllData();
    } else {
        toast({ variant: "destructive", title: "Error", description: res.message });
    }
    setIsDeletingId(null);
  };

  const handleEditSubmit = async (data: AdminDeferralEditFormInput) => {
    if (!selectedDeferral) return;
    setIsSubmitting(true);
    const res = await updateDeferralAction(selectedDeferral.id, data);
    if (res.success) {
        toast({ title: "Updated" });
        setIsEditModalOpen(false);
        fetchAllData();
    } else {
        toast({ variant: "destructive", title: "Error", description: res.message });
    }
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-6 text-left">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          <Card className="bg-primary/5 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-xl font-black">{stats?.totalDeferrals ?? 0}</CardTitle><CardDescription className="text-[9px] font-black uppercase tracking-widest leading-none">Total Credits</CardDescription></CardHeader></Card>
          <Card className="bg-green-50 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-xl font-black text-green-700">{stats?.completedDeferrals ?? 0}</CardTitle><CardDescription className="text-[9px] font-black uppercase tracking-widest leading-none text-green-600">Used</CardDescription></CardHeader></Card>
          <Card className="bg-blue-50 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-xl font-black text-blue-700">{stats?.pendingDeferrals ?? 0}</CardTitle><CardDescription className="text-[9px] font-black uppercase tracking-widest leading-none text-blue-600">Pending</CardDescription></CardHeader></Card>
          <Card className="bg-red-50 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-xl font-black text-red-700">{stats?.expiredDeferrals ?? 0}</CardTitle><CardDescription className="text-[9px] font-black uppercase tracking-widest leading-none text-red-600">Expired</CardDescription></CardHeader></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50 p-1 rounded-xl h-9">
          <TabsTrigger value="management" className="gap-2 font-bold uppercase text-[10px] tracking-widest h-7"><FileClock className="h-3.5 w-3.5"/>Management</TabsTrigger>
          <TabsTrigger value="audit" className="gap-2 font-bold uppercase text-[10px] tracking-widest h-7"><ShieldCheck className="h-3.5 w-3.5"/>Audit Trail</TabsTrigger>
          <TabsTrigger value="pricing" className="gap-2 font-bold uppercase text-[10px] tracking-widest h-7"><IndianRupee className="h-3.5 w-3.5"/>Service Pricing</TabsTrigger>
        </TabsList>

        <TabsContent value="management" className="space-y-6 text-left animate-in fade-in duration-500">
          <Card className="border-none shadow-xl">
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 border-b">
              <div className="text-left">
                <CardTitle className="flex items-center gap-2 text-lg font-black uppercase tracking-tight italic"><FileClock className="h-5 w-5 text-primary" />Deferral Registry</CardTitle>
                <CardDescription className="text-left text-[10px] font-bold uppercase">Credit Audit & Manual Operations</CardDescription>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <Button variant="outline" size="sm" onClick={handleBulkRemind} disabled={isSendingReminders} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-8"><Mail className="mr-1.5 h-3 w-3"/>Bulk Remind</Button>
                <Button size="sm" onClick={() => setIsCreateModalOpen(true)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest h-8"><PlusCircle className="mr-1.5 h-3 w-3"/>Manual Entry</Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-left">
              <Input placeholder="Filter by name or email..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="rounded-xl border-muted h-9 text-xs" />
              <div className="rounded-xl border overflow-x-auto max-h-[60vh] text-left shadow-inner">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow className="h-10 text-[10px] font-black uppercase">
                      <TableHead className="text-left pl-4">Athlete</TableHead>
                      <TableHead className="text-left">Original Race</TableHead>
                      <TableHead className="text-left">Status</TableHead>
                      <TableHead className="text-left">Credit</TableHead>
                      <TableHead className="text-right pr-4">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? <TableRow><TableCell colSpan={5} className="text-center p-8"><Loader2 className="animate-spin mx-auto text-primary"/></TableCell></TableRow>
                    : filteredRequests.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">No deferrals found.</TableCell></TableRow>
                    : filteredRequests.map(d => (
                      <TableRow key={d.id} className="hover:bg-muted/10 transition-colors text-left h-14">
                        <TableCell className="text-left pl-4">
                          <div className="font-black text-sm uppercase leading-tight">{d.participantName}</div>
                          <div className="text-[10px] font-bold text-muted-foreground lowercase">{d.participantEmail}</div>
                        </TableCell>
                        <TableCell className="text-left">
                            <p className="font-bold uppercase tracking-tight text-xs">{d.originalEventName}</p>
                            <p className="text-[9px] font-black text-slate-400 uppercase">Issued: {d.deferralDate}</p>
                        </TableCell>
                        <TableCell className="text-left"><Badge variant={statusVariantMap[d.status] || 'secondary'} className="text-[9px] uppercase font-black px-2 h-5">{d.status}</Badge></TableCell>
                        <TableCell className="font-black text-primary text-sm text-left">₹{(d.estimatedOriginalBasePricePaisa || 0) / 100}</TableCell>
                        <TableCell className="text-right pr-4 space-x-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-primary/10 hover:text-primary rounded-lg" onClick={() => handleManualRemind(d.id, 'email')} title="Resend Reminder"><Mail className="h-3.5 w-3.5"/></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-primary/10 hover:text-primary rounded-lg" onClick={() => { setSelectedDeferral(d); setIsEditModalOpen(true); }}><Edit className="h-3.5 w-3.5"/></Button>
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 rounded-lg" disabled={isDeletingId === d.id}>
                                      {isDeletingId === d.id ? <Loader2 className="animate-spin h-3.5 w-3.5"/> : <Trash2 className="h-3.5 w-3.5"/>}
                                  </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="text-left rounded-2xl border-none shadow-2xl">
                                  <AlertDialogHeader className="text-left">
                                      <AlertDialogTitle className="text-xl font-black uppercase italic tracking-tight text-left">Delete Deferral Record?</AlertDialogTitle>
                                      <AlertDialogDescription className="text-sm font-medium text-left">Remove the credit from <strong>{d.participantName}&apos;s</strong> account. This action is final.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter className="text-left pt-4">
                                      <AlertDialogCancel className="rounded-xl font-bold uppercase text-xs">Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDelete(d)} className="bg-destructive hover:bg-destructive/90 rounded-xl font-bold uppercase text-xs">Confirm Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pricing" className="animate-in fade-in duration-500">
          <ServicePricingManager />
        </TabsContent>

        <TabsContent value="audit" className="animate-in fade-in duration-500">
          <Card className="border-none shadow-xl">
            <CardHeader className="p-4 border-b">
              <CardTitle className="flex items-center gap-2 text-lg font-black uppercase tracking-tight italic"><ShieldCheck className="h-5 w-5 text-primary"/>Deferral Consumption Audit</CardTitle>
              <CardDescription className="text-[10px] font-bold uppercase">Which participant used each deferral credit and where it was applied</CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              <div className="rounded-xl border overflow-x-auto max-h-[65vh] shadow-inner">
                <Table>
                  <TableHeader className="bg-muted/30 sticky top-0 z-10">
                    <TableRow className="h-10 text-[10px] font-black uppercase">
                      <TableHead className="pl-4 text-left">Athlete</TableHead>
                      <TableHead className="text-left">From Race</TableHead>
                      <TableHead className="text-left">Status</TableHead>
                      <TableHead className="text-left">Used For Race</TableHead>
                      <TableHead className="text-left">Used Ticket</TableHead>
                      <TableHead className="text-right pr-4">Credit (₹)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={6} className="text-center p-8"><Loader2 className="animate-spin mx-auto text-primary"/></TableCell></TableRow>
                    ) : requests.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">No deferral records found.</TableCell></TableRow>
                    ) : [...requests].sort((a, b) => {
                        // Consumed/Used first, then pending, then expired
                        const order = (s: string) => s === 'Used' || s === 'Confirmed' ? 0 : s === 'Pending' || s === 'Pending Ticket Selection' ? 1 : 2;
                        return order(a.status) - order(b.status);
                      }).map(d => {
                      const isConsumed = d.status === 'Used' || d.status === 'Confirmed';
                      const isRevoked = d.status === 'RevokedByAdmin' || d.status === 'Expired';
                      return (
                        <TableRow key={d.id} className={`hover:bg-muted/10 text-left h-14 ${isConsumed ? 'bg-green-50/40' : isRevoked ? 'bg-red-50/30' : ''}`}>
                          <TableCell className="pl-4">
                            <div className="font-black text-sm uppercase leading-tight">{d.participantName}</div>
                            <div className="text-[10px] text-muted-foreground lowercase">{d.participantEmail}</div>
                          </TableCell>
                          <TableCell>
                            <p className="font-bold uppercase tracking-tight text-xs">{d.originalEventName}</p>
                            <p className="text-[9px] font-black text-slate-400 uppercase">{d.deferralDate || '—'}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariantMap[d.status] || 'secondary'} className="text-[9px] uppercase font-black px-2 h-5">{d.status}</Badge>
                          </TableCell>
                          <TableCell>
                            {isConsumed && d.deferredToEventName ? (
                              <p className="font-bold uppercase tracking-tight text-xs text-green-700">{d.deferredToEventName}</p>
                            ) : isRevoked ? (
                              <span className="text-[10px] text-muted-foreground italic">Revoked / Expired</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground italic">Not yet used</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {isConsumed && d.deferredToTicketName ? (
                              <Badge variant="outline" className="text-[9px] uppercase font-black">{d.deferredToTicketName}</Badge>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right pr-4 font-black text-primary">
                            ₹{((d.estimatedOriginalBasePricePaisa || 0) / 100).toLocaleString('en-IN')}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* EDIT MODAL */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-xl text-left rounded-2xl border-none shadow-2xl p-0 overflow-hidden">
            <DialogHeader className="px-6 pt-6 pb-2 border-b flex-shrink-0">
                <DialogTitle className="text-xl font-black uppercase italic tracking-tighter text-left">Edit Deferral Credit</DialogTitle>
                <DialogDescription className="text-left text-xs font-medium">Update record parameters or adjust credit values.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] px-6 text-left">
                <Form {...editForm}>
                    <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="space-y-5 py-6 text-left">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-left">
                            <FormField control={editForm.control} name="participantName" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Athlete Name</FormLabel><Input {...field} value={field.value || ''} className="rounded-xl h-10 font-bold" disabled={isSubmitting}/></FormItem>)}/>
                            <FormField control={editForm.control} name="participantEmail" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Email Address</FormLabel><Input {...field} value={field.value || ''} className="rounded-xl h-10 lowercase font-semibold" disabled={isSubmitting}/></FormItem>)}/>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-left">
                            <FormField control={editForm.control} name="status" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Status</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || ''} disabled={isSubmitting}>
                                    <FormControl><SelectTrigger className="rounded-xl h-10 font-bold text-left"><SelectValue/></SelectTrigger></FormControl>
                                    <SelectContent className="text-left">
                                        <SelectItem value="Pending Ticket Selection">Pending Selection</SelectItem>
                                        <SelectItem value="Used">Used</SelectItem>
                                        <SelectItem value="Expired">Expired</SelectItem>
                                        <SelectItem value="RevokedByAdmin">Revoked</SelectItem>
                                    </SelectContent>
                                </Select>
                            </FormItem>)}/>
                            <FormField control={editForm.control} name="expiryDate" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Expiry Date</FormLabel><Input type="date" value={field.value instanceof Date ? format(field.value, 'yyyy-MM-dd') : ''} onChange={e => field.onChange(parseISO(e.target.value))} className="rounded-xl h-10 font-bold" disabled={isSubmitting}/></FormItem>)}/>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-left">
                            <FormField
                              control={editForm.control}
                              name="deferredToEventId"
                              render={({ field }) => (
                                <FormItem className="text-left">
                                  <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Deferred To Event</FormLabel>
                                  <Select
                                    onValueChange={field.onChange}
                                    value={field.value || 'NONE'}
                                    disabled={isSubmitting}
                                  >
                                    <FormControl>
                                      <SelectTrigger className="rounded-xl h-10 font-bold text-left text-xs">
                                        <SelectValue placeholder="Select destination event..." />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent className="text-left">
                                      <SelectItem value="NONE" className="text-xs">Not Assigned</SelectItem>
                                      {events.map((e) => (
                                        <SelectItem key={e.id} value={e.id} className="text-xs">
                                          {e.eventName}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormDescription className="text-[10px] text-muted-foreground text-left">
                                    Select the event where this deferral credit was applied.
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-left">
                            <FormField control={editForm.control} name="estimatedOriginalBasePricePaisa" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Credit Value (Paisa)</FormLabel><Input type="number" {...field} value={field.value ?? ''} onChange={e => field.onChange(parseInt(e.target.value))} className="rounded-xl h-10 font-black text-primary" disabled={isSubmitting}/></FormItem>)}/>
                            <FormField control={editForm.control} name="originalAmountPaidPaisa" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Orig. Total Paid (Paisa)</FormLabel><Input type="number" {...field} value={field.value ?? ''} onChange={e => field.onChange(parseInt(e.target.value))} className="rounded-xl h-10" disabled={isSubmitting}/></FormItem>)}/>
                        </div>
                        <FormField control={editForm.control} name="adminNotes" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Internal Notes</FormLabel><Textarea {...field} value={field.value || ''} rows={3} className="rounded-xl text-xs" placeholder="Administrative notes for this deferral..." disabled={isSubmitting}/></FormItem>)}/>
                    </form>
                </Form>
            </ScrollArea>
            <DialogFooter className="px-6 py-4 border-t gap-3 flex-shrink-0 text-left">
                <DialogClose asChild><Button variant="ghost" className="rounded-xl font-bold uppercase text-xs" disabled={isSubmitting}>Cancel</Button></DialogClose>
                <Button onClick={editForm.handleSubmit(handleEditSubmit)} disabled={isSubmitting} className="rounded-xl h-11 px-8 font-black uppercase tracking-widest shadow-xl">
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                    Update Record
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CREATE MODAL */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="sm:max-w-md text-left rounded-2xl border-none shadow-2xl p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2 border-b flex-shrink-0">
              <DialogTitle className="text-xl font-black uppercase italic tracking-tighter text-left">Manual Credit Issuance</DialogTitle>
              <DialogDescription className="text-left text-xs font-medium">Issue a race credit to an athlete manually.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh] px-6 text-left">
            <Form {...createForm}>
                <form onSubmit={createForm.handleSubmit(async (val) => {
                setIsSubmitting(true);
                const res = await addManualDeferralAction(val);
                if (res.success) { toast({ title: "Created" }); setIsCreateModalOpen(false); fetchAllData(); }
                else toast({ variant: "destructive", title: "Error", description: res.message });
                setIsSubmitting(false);
                })} className="space-y-5 py-6 text-left">
                <FormField control={createForm.control} name="name" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Athlete Full Name*</FormLabel><Input {...field} value={field.value || ''} placeholder="John Doe" className="rounded-xl h-10 font-bold" disabled={isSubmitting}/></FormItem>)}/>
                <FormField control={createForm.control} name="email" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Email Address*</FormLabel><Input type="email" {...field} value={field.value || ''} placeholder="john@example.com" className="rounded-xl h-10 font-semibold" disabled={isSubmitting}/></FormItem>)}/>
                <FormField control={createForm.control} name="originalEventId" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Credit From Race*</FormLabel><Select onValueChange={field.onChange} value={field.value||NO_ASSIGNMENT_PLACEHOLDER_VALUE} disabled={isSubmitting}><FormControl><SelectTrigger className="rounded-xl h-10 font-bold text-left text-xs"><SelectValue placeholder="Select original event..."/></SelectTrigger></FormControl><SelectContent className="text-left">{events.map(e=>(<SelectItem key={e.id} value={e.id} className="text-xs">{e.eventName}</SelectItem>))}</SelectContent></Select></FormItem>)}/>
                <div className="grid grid-cols-2 gap-4 text-left">
                    <FormField control={createForm.control} name="deferralDate" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Issue Date</FormLabel><Input type="date" value={field.value ? format(field.value, 'yyyy-MM-dd') : ''} onChange={e => field.onChange(parseISO(e.target.value))} className="rounded-xl h-10 text-xs" disabled={isSubmitting}/></FormItem>)}/>
                    <FormField control={createForm.control} name="expiryDate" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Expiry Date</FormLabel><Input type="date" value={field.value ? format(field.value, 'yyyy-MM-dd') : ''} onChange={e => field.onChange(parseISO(e.target.value))} className="rounded-xl h-10 font-bold text-xs" disabled={isSubmitting}/></FormItem>)}/>
                </div>
                <div className="grid grid-cols-2 gap-4 text-left">
                    <FormField control={createForm.control} name="estimatedOriginalBasePricePaisa" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Base Credit (Paisa)*</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} onChange={e=>field.onChange(parseInt(e.target.value))} className="rounded-xl h-10 font-black text-primary" disabled={isSubmitting}/></FormControl></FormItem>)}/>
                    <FormField control={createForm.control} name="originalAmountPaidPaisa" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Total Paid (Paisa)*</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} onChange={e=>field.onChange(parseInt(e.target.value))} className="rounded-xl h-10" disabled={isSubmitting}/></FormControl></FormItem>)}/>
                </div>
                <p className="text-[9px] uppercase font-bold text-muted-foreground leading-tight text-center">100 Paisa = 1 Rupee. Base credit is for future ticket discounts.</p>
                <FormField control={createForm.control} name="adminNotes" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Administrative Reason</FormLabel><Textarea {...field} value={field.value || ''} placeholder="Internal reason for manual issuance..." className="rounded-xl text-xs" rows={2} disabled={isSubmitting}/></FormItem>)}/>
                </form>
            </Form>
          </ScrollArea>
          <DialogFooter className="px-6 py-4 border-t gap-3 flex-shrink-0 text-left">
              <DialogClose asChild><Button variant="ghost" className="rounded-xl font-bold uppercase text-xs" disabled={isSubmitting}>Cancel</Button></DialogClose>
              <Button onClick={createForm.handleSubmit(async (val) => {
                setIsSubmitting(true);
                const res = await addManualDeferralAction(val);
                if (res.success) { toast({ title: "Created" }); setIsCreateModalOpen(false); fetchAllData(); }
                else toast({ variant: "destructive", title: "Error", description: res.message });
                setIsSubmitting(false);
              })} disabled={isSubmitting} className="rounded-xl h-11 px-8 font-black uppercase tracking-widest shadow-xl">
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <PlusCircle className="mr-2 h-4 w-4"/>}
                  Issue Credit
              </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
