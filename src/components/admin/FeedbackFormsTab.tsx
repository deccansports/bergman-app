// src/components/admin/FeedbackFormsTab.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventCalendarEntry } from '@/lib/types';
import {
  type FeedbackFormMapping,
  type FeedbackCouponAthleteRecord,
  createFeedbackFormMappingAction,
  updateFeedbackFormMappingAction,
  deleteFeedbackFormMappingAction,
  getFeedbackFormMappingsAction,
  getFeedbackCouponAthletesAction,
  syncFeedbackCouponAthletesToKVAction,
  syncFeedbackFormMappingAction,
  autoSyncFeedbackFormsAction,
  toggleFeedbackFormMappingActiveAction,
} from '@/lib/actions/feedbackFormActions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface FeedbackFormsTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

type FormState = {
  eventId: string;
  eventName: string;
  formUrl: string;
  sheetUrl: string;
  couponType: 'flat' | 'percentage';
  couponValue: number;
  expiryDays: number;
  active: boolean;
};

const defaultFormState: FormState = {
  eventId: '',
  eventName: '',
  formUrl: '',
  sheetUrl: '',
  couponType: 'flat',
  couponValue: 500,
  expiryDays: 30,
  active: true,
};

export default function FeedbackFormsTab({ events, isLoadingEvents }: FeedbackFormsTabProps) {
  const { toast } = useToast();

  const [mappings, setMappings] = useState<FeedbackFormMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FeedbackFormMapping | null>(null);
  const [formState, setFormState] = useState<FormState>(defaultFormState);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FeedbackFormMapping | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [autoSyncRunning, setAutoSyncRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'mappings' | 'athletes'>('mappings');
  const [athletes, setAthletes] = useState<FeedbackCouponAthleteRecord[]>([]);
  const [athletesLoading, setAthletesLoading] = useState(false);
  const [athletesSearch, setAthletesSearch] = useState('');
  const [athletesMappingFilter, setAthletesMappingFilter] = useState('all');
  const lockRef = useRef(false);
  const initialRunRef = useRef(false);
  const athletesKvBootstrapTriedRef = useRef(false);

  const fetchMappings = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getFeedbackFormMappingsAction();
      if (result.success && result.mappings) {
        setMappings(result.mappings);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error || 'Failed to load mappings.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load mappings.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const fetchAthletes = useCallback(async (mappingId?: string) => {
    setAthletesLoading(true);
    try {
      const requestMappingId = mappingId && mappingId !== 'all' ? mappingId : undefined;
      const result = await getFeedbackCouponAthletesAction({
        mappingId: mappingId && mappingId !== 'all' ? mappingId : undefined,
        limit: 500,
      });
      if (!result.success || !result.athletes) {
        toast({ variant: 'destructive', title: 'Error', description: result.error || 'Failed to load athletes list.' });
        return;
      }

      // One-time bootstrap: if KV is empty, rebuild from Firestore and reload from KV.
      if (!athletesKvBootstrapTriedRef.current && result.athletes.length === 0) {
        athletesKvBootstrapTriedRef.current = true;
        const bootstrap = await syncFeedbackCouponAthletesToKVAction({ limit: 1000 });
        if (bootstrap.success) {
          const reloaded = await getFeedbackCouponAthletesAction({
            mappingId: requestMappingId,
            limit: 500,
          });
          if (reloaded.success && reloaded.athletes) {
            setAthletes(reloaded.athletes);
            return;
          }
        }
      }

      setAthletes(result.athletes);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load athletes list.' });
    } finally {
      setAthletesLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchMappings();
  }, [fetchMappings]);

  useEffect(() => {
    if (activeTab !== 'athletes') return;
    fetchAthletes(athletesMappingFilter);
  }, [activeTab, athletesMappingFilter, fetchAthletes]);

  const resetForm = useCallback(() => {
    setFormState(defaultFormState);
    setEditing(null);
  }, []);

  const onEventChange = (eventId: string) => {
    const event = events.find((e) => e.id === eventId);
    setFormState((prev) => ({ ...prev, eventId, eventName: event?.eventName || '' }));
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (mapping: FeedbackFormMapping) => {
    setEditing(mapping);
    setFormState({
      eventId: mapping.eventId,
      eventName: mapping.eventName,
      formUrl: mapping.formUrl,
      sheetUrl: mapping.sheetUrl,
      couponType: mapping.coupon?.type === 'percentage' ? 'percentage' : 'flat',
      couponValue: Number(mapping.coupon?.value || 0),
      expiryDays: Number(mapping.coupon?.expiryDays ?? 30),
      active: mapping.active !== false,
    });
    setDialogOpen(true);
  };

  const saveMapping = async () => {
    if (!formState.eventId || !formState.formUrl || !formState.sheetUrl) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Event, Form URL and Sheet URL are required.' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        eventId: formState.eventId,
        eventName: formState.eventName,
        formUrl: formState.formUrl,
        sheetUrl: formState.sheetUrl,
        sheetId: '',
        coupon: {
          type: formState.couponType,
          value: Number(formState.couponValue || 0),
          expiryDays: Number(formState.expiryDays || 0),
        },
        lastSyncedRow: editing?.lastSyncedRow || 1,
        active: formState.active,
      };

      const res = editing
        ? await updateFeedbackFormMappingAction(editing.id, payload)
        : await createFeedbackFormMappingAction(payload);

      if (!res.success) {
        toast({ variant: 'destructive', title: 'Save failed', description: res.error || 'Could not save mapping.' });
        return;
      }

      toast({ title: 'Saved', description: 'Feedback form mapping saved.' });
      setDialogOpen(false);
      resetForm();
      await fetchMappings();
    } finally {
      setSaving(false);
    }
  };

  const deleteMapping = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    const res = await deleteFeedbackFormMappingAction(target.id);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Delete failed', description: res.error || 'Could not delete mapping.' });
      return;
    }
    toast({ title: 'Deleted', description: `Mapping for ${target.eventName} deleted.` });
    await fetchMappings();
  };

  const runSync = async (mapping: FeedbackFormMapping, forceResync = false) => {
    setSyncingId(mapping.id);
    try {
      const res = await syncFeedbackFormMappingAction(mapping.id, { forceResync });
      if (!res.success) {
        toast({ variant: 'destructive', title: forceResync ? 'Resync failed' : 'Sync failed', description: res.error || 'Sync failed.' });
        return;
      }
      toast({
        title: forceResync ? 'Resync completed' : 'Sync completed',
        description: `Coupons: ${res.created || 0}, Email: ${res.sentEmail || 0}, WhatsApp: ${res.sentWhatsApp || 0}, Skipped: ${res.skipped || 0}`,
      });
      await fetchMappings();
      if (activeTab === 'athletes') {
        await fetchAthletes(athletesMappingFilter);
      }
    } finally {
      setSyncingId(null);
    }
  };

  const runAutoSync = useCallback(async (silent = true, forceResync = false) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setAutoSyncRunning(true);
    try {
      const res = await autoSyncFeedbackFormsAction({ forceResync });
      if (!res.success) throw new Error(res.error || 'Auto sync failed');
      await fetchMappings();
      if (activeTab === 'athletes') {
        await fetchAthletes(athletesMappingFilter);
      }

      if (!silent) {
        toast({
          title: forceResync ? 'Auto resync completed' : 'Auto sync completed',
          description: `Mappings: ${res.synced || 0}, Coupons: ${res.created || 0}, Email: ${res.sentEmail || 0}, WhatsApp: ${res.sentWhatsApp || 0}`,
        });
      }
    } catch (error: any) {
      if (!silent) {
        toast({ variant: 'destructive', title: 'Auto sync failed', description: error.message || 'Auto sync failed.' });
      }
    } finally {
      setAutoSyncRunning(false);
      lockRef.current = false;
    }
  }, [activeTab, athletesMappingFilter, fetchAthletes, fetchMappings, toast]);

  useEffect(() => {
    if (initialRunRef.current) return;
    initialRunRef.current = true;
    runAutoSync(true, true);
  }, [runAutoSync]);

  useEffect(() => {
    if (!autoSyncEnabled) return;
    const id = setInterval(() => {
      runAutoSync(true, false);
    }, 30_000);
    return () => clearInterval(id);
  }, [autoSyncEnabled, runAutoSync]);

  const stats = useMemo(() => ({
    total: mappings.length,
    active: mappings.filter((m) => m.active).length,
    inactive: mappings.filter((m) => !m.active).length,
  }), [mappings]);

  const filteredAthletes = useMemo(() => {
    const q = athletesSearch.trim().toLowerCase();
    if (!q) return athletes;
    return athletes.filter((a) => {
      const haystack = [
        a.name || '',
        a.email || '',
        a.mobile || '',
        a.eventName || '',
        a.couponCode || '',
        a.status || '',
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [athletes, athletesSearch]);

  const athleteStats = useMemo(() => ({
    total: athletes.length,
    withCoupon: athletes.filter((a) => !!a.couponCode).length,
    sent: athletes.filter((a) => String(a.status || '').toLowerCase() === 'sent').length,
    failed: athletes.filter((a) => String(a.status || '').toLowerCase() === 'failed').length,
  }), [athletes]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Feedback Forms</CardTitle>
          <CardDescription>
            Auto-generate feedback coupons from Google Sheet responses and send instantly via email / WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'mappings' | 'athletes')}>
            <TabsList>
              <TabsTrigger value="mappings">Mappings</TabsTrigger>
              <TabsTrigger value="athletes">Athletes</TabsTrigger>
            </TabsList>

            <TabsContent value="mappings" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="py-3"><CardContent className="p-0 text-center"><p className="text-2xl font-bold">{stats.total}</p><p className="text-xs text-muted-foreground">Total</p></CardContent></Card>
            <Card className="py-3"><CardContent className="p-0 text-center"><p className="text-2xl font-bold text-green-600">{stats.active}</p><p className="text-xs text-muted-foreground">Active</p></CardContent></Card>
            <Card className="py-3"><CardContent className="p-0 text-center"><p className="text-2xl font-bold text-muted-foreground">{stats.inactive}</p><p className="text-xs text-muted-foreground">Inactive</p></CardContent></Card>
            <Card className="py-3"><CardContent className="p-0 text-center"><p className="text-2xl font-bold">30s</p><p className="text-xs text-muted-foreground">Auto Sync</p></CardContent></Card>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Add Feedback Form</Button>
            <Button size="sm" variant="outline" onClick={() => runAutoSync(false)} disabled={autoSyncRunning}>
              {autoSyncRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Sync All
            </Button>
            <Button size="sm" variant="outline" onClick={() => runAutoSync(false, true)} disabled={autoSyncRunning}>Resync All</Button>
            <div className="flex items-center gap-2 ml-auto">
              <Switch checked={autoSyncEnabled} onCheckedChange={setAutoSyncEnabled} id="feedback-auto-sync" />
              <Label htmlFor="feedback-auto-sync" className="text-sm text-muted-foreground">Auto Sync</Label>
            </div>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Coupon</TableHead>
                  <TableHead>Sync</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                ) : mappings.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No feedback mappings yet.</TableCell></TableRow>
                ) : mappings.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="font-semibold text-sm">{m.eventName}</div>
                      <div className="text-xs text-muted-foreground">{m.eventId}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{m.coupon?.type === 'percentage' ? `${m.coupon?.value}%` : `₹${m.coupon?.value}`}</div>
                      <div className="text-xs text-muted-foreground">Expiry: {m.coupon?.expiryDays ?? 30} days</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">Last Synced Row: <span className="font-semibold">{m.lastSyncedRow ?? 1}</span></div>
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={async () => {
                          const next = !m.active;
                          const res = await toggleFeedbackFormMappingActiveAction(m.id, next);
                          if (!res.success) {
                            toast({ variant: 'destructive', title: 'Update failed', description: res.error || 'Could not update status.' });
                            return;
                          }
                          setMappings((prev) => prev.map((x) => x.id === m.id ? { ...x, active: next } : x));
                        }}
                        className="focus:outline-none"
                      >
                        <Badge variant={m.active ? 'default' : 'outline'}>{m.active ? '● Active' : '○ Inactive'}</Badge>
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => runSync(m)} disabled={syncingId === m.id || !m.active}>
                          {syncingId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Sync'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => runSync(m, true)} disabled={syncingId === m.id || !m.active}>Resync</Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(m)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
            </TabsContent>

            <TabsContent value="athletes" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="py-3"><CardContent className="p-0 text-center"><p className="text-2xl font-bold">{athleteStats.total}</p><p className="text-xs text-muted-foreground">Total Athletes</p></CardContent></Card>
                <Card className="py-3"><CardContent className="p-0 text-center"><p className="text-2xl font-bold text-primary">{athleteStats.withCoupon}</p><p className="text-xs text-muted-foreground">With Coupon</p></CardContent></Card>
                <Card className="py-3"><CardContent className="p-0 text-center"><p className="text-2xl font-bold text-green-600">{athleteStats.sent}</p><p className="text-xs text-muted-foreground">Sent</p></CardContent></Card>
                <Card className="py-3"><CardContent className="p-0 text-center"><p className="text-2xl font-bold text-red-600">{athleteStats.failed}</p><p className="text-xs text-muted-foreground">Failed</p></CardContent></Card>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <Input
                  placeholder="Search athlete / email / coupon"
                  value={athletesSearch}
                  onChange={(e) => setAthletesSearch(e.target.value)}
                  className="w-full sm:max-w-sm"
                />
                <Select value={athletesMappingFilter} onValueChange={setAthletesMappingFilter}>
                  <SelectTrigger className="w-full sm:w-[260px]"><SelectValue placeholder="Filter by event" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Events</SelectItem>
                    {mappings.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.eventName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => fetchAthletes(athletesMappingFilter)} disabled={athletesLoading}>
                  {athletesLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const res = await syncFeedbackCouponAthletesToKVAction({ limit: 1000 });
                    if (!res.success) {
                      toast({ variant: 'destructive', title: 'KV sync failed', description: res.error || 'Could not sync athletes to KV.' });
                      return;
                    }
                    toast({ title: 'KV synced', description: `Synced ${res.count || 0} athlete records to KV.` });
                    await fetchAthletes(athletesMappingFilter);
                  }}
                  disabled={athletesLoading}
                >
                  Sync KV
                </Button>
              </div>

              <div className={`rounded-md border overflow-auto ${filteredAthletes.length >= 10 ? 'max-h-[65vh]' : ''}`}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shared At</TableHead>
                      <TableHead>Athlete</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Coupon Code</TableHead>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {athletesLoading ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                    ) : filteredAthletes.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No athletes found.</TableCell></TableRow>
                    ) : filteredAthletes.map((a) => {
                      const ts = a.createdAt ? new Date(a.createdAt) : null;
                      const displayDate = ts && !Number.isNaN(ts.getTime()) ? ts.toLocaleString() : 'N/A';
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="text-xs">{displayDate}</TableCell>
                          <TableCell>
                            <div className="font-semibold text-sm">{a.name || 'Athlete'}</div>
                            <div className="text-xs text-muted-foreground">{a.email || 'No email'}{a.mobile ? ` • ${a.mobile}` : ''}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{a.eventName || '-'}</div>
                            <div className="text-xs text-muted-foreground">Row: {a.rowNumber ?? '-'}</div>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs font-semibold">{a.couponCode || '-'}</span>
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-wrap gap-1">
                              <Badge variant={a.emailSent ? 'default' : 'outline'}>Email {a.emailSent ? '✓' : '✕'}</Badge>
                              <Badge variant={a.whatsappSent ? 'default' : 'outline'}>WhatsApp {a.whatsappSent ? '✓' : '✕'}</Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={String(a.status || '').toLowerCase() === 'sent' ? 'default' : (String(a.status || '').toLowerCase() === 'failed' ? 'destructive' : 'outline')}>
                              {a.status}
                            </Badge>
                            {a.error ? <div className="text-xs text-destructive mt-1">{a.error}</div> : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Feedback Form Mapping' : 'Create Feedback Form Mapping'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Event</Label>
                <Select value={formState.eventId} onValueChange={onEventChange} disabled={isLoadingEvents}>
                  <SelectTrigger><SelectValue placeholder="Select event" /></SelectTrigger>
                  <SelectContent>
                    {events.map((ev) => (
                      <SelectItem key={ev.id} value={ev.id}>{ev.eventName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Active</Label>
                <div className="h-10 px-3 rounded-md border flex items-center">
                  <Switch checked={formState.active} onCheckedChange={(v) => setFormState((p) => ({ ...p, active: v }))} />
                </div>
              </div>
            </div>

            <div>
              <Label>Google Form URL</Label>
              <Input value={formState.formUrl} onChange={(e) => setFormState((p) => ({ ...p, formUrl: e.target.value }))} placeholder="https://docs.google.com/forms/..." />
            </div>

            <div>
              <Label>Google Sheet URL</Label>
              <Input value={formState.sheetUrl} onChange={(e) => setFormState((p) => ({ ...p, sheetUrl: e.target.value }))} placeholder="https://docs.google.com/spreadsheets/..." />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Coupon Type</Label>
                <Select value={formState.couponType} onValueChange={(v: 'flat' | 'percentage') => setFormState((p) => ({ ...p, couponType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">Flat (₹)</SelectItem>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Coupon Value</Label>
                <Input type="number" min={1} value={formState.couponValue} onChange={(e) => setFormState((p) => ({ ...p, couponValue: Number(e.target.value || 0) }))} />
              </div>

              <div>
                <Label>Expiry (days)</Label>
                <Input type="number" min={0} value={formState.expiryDays} onChange={(e) => setFormState((p) => ({ ...p, expiryDays: Number(e.target.value || 0) }))} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveMapping} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Feedback Mapping?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the mapping and stop automatic coupon generation for this feedback form.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteMapping} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
