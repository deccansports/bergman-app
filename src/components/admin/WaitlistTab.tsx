// src/components/admin/WaitlistTab.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, RefreshCw } from 'lucide-react';
import { format, isValid, parseISO, startOfDay } from 'date-fns';
import type { EventCalendarEntry, WaitlistEntry, WaitlistEntryStatus } from '@/lib/types';
import {
  bulkSendWaitlistInvitationsAction,
  deleteWaitlistEntryAction,
  listWaitlistEntriesAction,
  listWaitlistFormsAction,
  sendWaitlistInvitationAction,
  upsertWaitlistFormAction,
  updateWaitlistCodeStatusAction,
  updateWaitlistEntryTicketAction,
  updateWaitlistEntryStatusAction,
} from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { WaitlistForm } from '@/lib/types/waitlist';

interface WaitlistTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents?: boolean;
}

const STATUS_OPTIONS: Array<{ value: WaitlistEntryStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'invited', label: 'Invited' },
  { value: 'code_sent', label: 'Code Sent' },
  { value: 'registered', label: 'Registered' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

const statusVariant: Record<WaitlistEntryStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  invited: 'default',
  code_sent: 'default',
  registered: 'outline',
  expired: 'destructive',
  cancelled: 'destructive',
};

function getDefaultWaitlistExpiryIso(): string {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 2);
  return expiry.toISOString();
}

function toDatetimeLocalValue(value?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function WaitlistTab({ events, isLoadingEvents = false }: WaitlistTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<WaitlistEntryStatus | 'all'>('all');
  const [ticketFilter, setTicketFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isUpdatingTicket, setIsUpdatingTicket] = useState<string | null>(null);
  const [isBulkSending, setIsBulkSending] = useState(false);
  const [isCreatingForm, setIsCreatingForm] = useState(false);
  const [registrationLink, setRegistrationLink] = useState('');
  const [formsByEventId, setFormsByEventId] = useState<Record<string, WaitlistForm>>({});
  const [selectedTicketIdsByEventId, setSelectedTicketIdsByEventId] = useState<Record<string, string[]>>({});
  const [waitlistOpenAtByEventId, setWaitlistOpenAtByEventId] = useState<Record<string, string>>({});
  const [waitlistCloseAtByEventId, setWaitlistCloseAtByEventId] = useState<Record<string, string>>({});
  const [ticketDrafts, setTicketDrafts] = useState<Record<string, string>>({});

  const upcomingEvents = useMemo(() => {
    const today = startOfDay(new Date()).getTime();

    return (events || [])
      .filter((event) => {
        const candidateDate = String(event.endDate || event.eventDate || '').trim();
        if (!candidateDate) return false;

        const isoParsed = parseISO(candidateDate);
        const parsed = isValid(isoParsed) ? isoParsed : new Date(candidateDate);
        if (!isValid(parsed)) return false;

        return startOfDay(parsed).getTime() >= today;
      })
      .sort((a, b) => {
        const aDate = parseISO(String(a.endDate || a.eventDate || ''));
        const bDate = parseISO(String(b.endDate || b.eventDate || ''));
        const aTs = isValid(aDate) ? aDate.getTime() : Number.MAX_SAFE_INTEGER;
        const bTs = isValid(bDate) ? bDate.getTime() : Number.MAX_SAFE_INTEGER;
        return aTs - bTs;
      });
  }, [events]);

  const selectedEvent = useMemo(
    () => upcomingEvents.find((event) => event.id === selectedEventId) || null,
    [upcomingEvents, selectedEventId]
  );

  const eventsById = useMemo(() => {
    const map = new Map<string, EventCalendarEntry>();
    for (const event of events || []) {
      if (event?.id) map.set(event.id, event);
    }
    return map;
  }, [events]);

  const ticketOptionsByEventId = useMemo(() => {
    const map = new Map<string, Array<{ id: string; label: string }>>();
    for (const event of events || []) {
      const options = (event.ticketDefinitions || [])
        .filter((ticket) => !ticket.isHidden && ticket.isSoldOut === true)
        .map((ticket) => ({
          id: ticket.id,
          label: `${ticket.ticketName}${ticket.ticketCategory ? ` · ${ticket.ticketCategory}` : ''}`,
        }));
      map.set(event.id, options);
    }
    return map;
  }, [events]);

  const ticketLabelByEventAndId = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const event of events || []) {
      const inner = new Map<string, string>();
      for (const ticket of event.ticketDefinitions || []) {
        if (!ticket?.id) continue;
        inner.set(ticket.id, `${ticket.ticketName}${ticket.ticketCategory ? ` · ${ticket.ticketCategory}` : ''}`);
      }
      map.set(event.id, inner);
    }
    return map;
  }, [events]);

  const getTicketLabel = useCallback((eventId: string, ticketId?: string | null, ticketName?: string | null) => {
    const direct = String(ticketName || '').trim();
    if (direct) return direct;
    const resolved = ticketLabelByEventAndId.get(eventId)?.get(String(ticketId || '').trim());
    return resolved || String(ticketId || 'Any category') || 'Any category';
  }, [ticketLabelByEventAndId]);

  const waitlistStats = useMemo(() => {
    // Compute stats using both entry.status and any associated code status
    const counts = { total: 0, sent: 0, registered: 0, expired: 0, pending: 0 };
    const now = Date.now();
    for (const entry of entries) {
      counts.total += 1;

      // Registered / pending / explicit expired on entry
      if (entry.status === 'registered') {
        counts.registered += 1;
        continue;
      }
      if (entry.status === 'pending') {
        counts.pending += 1;
        continue;
      }

      // If a waitlist code exists for this entry, prefer its status for sent/expired
      const code = entry.code;
      if (code) {
        const expiresAt = code.expiresAt ? new Date(code.expiresAt).getTime() : Number.NaN;
        const timeExpired = !Number.isNaN(expiresAt) && now > expiresAt;
        if (String(code.status).toLowerCase() === 'expired' || timeExpired) {
          counts.expired += 1;
        } else {
          // any other code state (active/used/revoked) counts as 'sent'
          counts.sent += 1;
        }
        continue;
      }

      // Fallback to entry.status
      if (entry.status === 'invited' || entry.status === 'code_sent') counts.sent += 1;
      if (entry.status === 'expired') counts.expired += 1;
    }

    return counts;
  }, [entries]);

  useEffect(() => {
    if (selectedEventId === 'all') return;
    const exists = upcomingEvents.some((event) => event.id === selectedEventId);
    if (!exists) setSelectedEventId('all');
  }, [selectedEventId, upcomingEvents]);

  useEffect(() => {
    if (!selectedEvent?.customSlug) return;
    const defaultLink = `${window.location.origin}/event-form/${selectedEvent.customSlug}`;
    setRegistrationLink(defaultLink);
  }, [selectedEvent?.customSlug]);

  const loadEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listWaitlistEntriesAction({
        eventId: selectedEventId === 'all' ? undefined : selectedEventId,
        status: selectedStatus,
        ticketId: ticketFilter === 'all' ? undefined : ticketFilter,
      });
      if (!result.success) throw new Error(result.message);
      const loaded = result.entries || [];
      setEntries(loaded);

    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Waitlist load failed', description: error?.message || 'Could not load waitlist entries.' });
    } finally {
      setIsLoading(false);
    }
  }, [selectedEventId, selectedStatus, ticketFilter, toast]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const loadActiveForms = useCallback(async () => {
    const result = await listWaitlistFormsAction();
    if (!result.success || !result.forms) {
      setFormsByEventId({});
      return;
    }

    const next: Record<string, WaitlistForm> = {};
    const nextOpenAt: Record<string, string> = {};
    const nextCloseAt: Record<string, string> = {};
    const nextTickets: Record<string, string[]> = {};
    for (const form of result.forms) {
      if (!form?.eventId) continue;
      next[form.eventId] = form;
      nextOpenAt[form.eventId] = toDatetimeLocalValue(form.waitlistOpenAt);
      nextCloseAt[form.eventId] = toDatetimeLocalValue(form.waitlistCloseAt);
      const soldOutTicketIds = new Set((ticketOptionsByEventId.get(form.eventId) || []).map((ticket) => ticket.id));
      nextTickets[form.eventId] = Array.isArray(form.allowedTicketIds)
        ? form.allowedTicketIds.map((id) => String(id || '').trim()).filter((id) => !!id && soldOutTicketIds.has(id))
        : [];
    }
    setFormsByEventId(next);
    setWaitlistOpenAtByEventId(nextOpenAt);
    setWaitlistCloseAtByEventId(nextCloseAt);
    setSelectedTicketIdsByEventId((prev) => ({ ...nextTickets, ...prev }));
  }, [ticketOptionsByEventId]);

  useEffect(() => {
    void loadActiveForms();
  }, [loadActiveForms]);

  const upsertLinkForEvent = useCallback(async (event: EventCalendarEntry, isActive: boolean) => {
    try {
      setIsCreatingForm(true);
      const result = await upsertWaitlistFormAction({
        eventId: event.id,
        eventName: event.eventName,
        slug: event.customSlug || event.eventName,
        isActive,
        allowedTicketIds: (selectedTicketIdsByEventId[event.id] || []).filter(Boolean),
        waitlistOpenAt: waitlistOpenAtByEventId[event.id] || null,
        waitlistCloseAt: waitlistCloseAtByEventId[event.id] || null,
        actor: 'admin-dashboard',
      });
      if (!result.success) throw new Error(result.message);
      toast({
        title: isActive ? 'Waitlist enabled' : 'Waitlist disabled',
        description: isActive
          ? `${event.eventName} waitlist form is now active.`
          : `${event.eventName} waitlist form has been disabled.`,
      });
      await loadActiveForms();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Update failed', description: error?.message || 'Could not update waitlist link.' });
    } finally {
      setIsCreatingForm(false);
    }
  }, [loadActiveForms, selectedTicketIdsByEventId, toast, waitlistOpenAtByEventId, waitlistCloseAtByEventId]);

  const saveFormSettingsForEvent = useCallback(async (event: EventCalendarEntry) => {
    try {
      setIsCreatingForm(true);
      const result = await upsertWaitlistFormAction({
        eventId: event.id,
        eventName: event.eventName,
        slug: event.customSlug || event.eventName,
        isActive: formsByEventId[event.id]?.isActive !== false,
        allowedTicketIds: (selectedTicketIdsByEventId[event.id] || []).filter(Boolean),
        waitlistOpenAt: waitlistOpenAtByEventId[event.id] || null,
        waitlistCloseAt: waitlistCloseAtByEventId[event.id] || null,
        actor: 'admin-dashboard',
      });
      if (!result.success) throw new Error(result.message);
      toast({ title: 'Waitlist saved', description: `${event.eventName} settings were updated.` });
      await loadActiveForms();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Save failed', description: error?.message || 'Could not save waitlist settings.' });
    } finally {
      setIsCreatingForm(false);
    }
  }, [formsByEventId, loadActiveForms, selectedTicketIdsByEventId, toast, waitlistOpenAtByEventId, waitlistCloseAtByEventId]);

  const createOrEnableForm = useCallback(async () => {
    if (!selectedEvent) {
      toast({ variant: 'destructive', title: 'Select event', description: 'Choose an event to enable waitlist form.' });
      return;
    }
    await upsertLinkForEvent(selectedEvent, true);
  }, [selectedEvent, toast, upsertLinkForEvent]);

  const sendInvite = useCallback(async (entry: WaitlistEntry) => {
    const getLinkForEvent = (eventId: string): string => {
      const manual = registrationLink.trim();
      if (manual) return manual;

      const event = eventsById.get(eventId);
      const slug = String(event?.customSlug || '').trim();
      if (!slug || typeof window === 'undefined') return '';
      return `${window.location.origin}/event-form/${slug}`;
    };

    const resolvedRegistrationLink = getLinkForEvent(entry.eventId);
    if (!resolvedRegistrationLink) {
      toast({
        variant: 'destructive',
        title: 'Registration link required',
        description: 'Add registration link before sending invites.',
      });
      return;
    }

    if (!registrationLink.trim()) {
      setRegistrationLink(resolvedRegistrationLink);
    }

    setIsSending(entry.id);
    try {
      const expiresAt = getDefaultWaitlistExpiryIso();
      const result = await sendWaitlistInvitationAction({
        entryId: entry.id,
        registrationLink: resolvedRegistrationLink,
        expiresAt,
        actor: 'admin-dashboard',
      });
      if (!result.success) throw new Error(result.message);
      toast({
        title: 'Invitation sent',
        description: `${entry.athleteName} received a unique waitlist code. Expires in 2 days.`,
      });
      await loadEntries();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Send failed', description: error?.message || 'Could not send invitation.' });
    } finally {
      setIsSending(null);
    }
  }, [eventsById, registrationLink, toast, loadEntries]);

  const sendBulkInvites = useCallback(async () => {
    const targetIds = entries
      .filter((entry) => entry.status === 'pending' || entry.status === 'invited')
      .map((entry) => entry.id);

    if (targetIds.length === 0) {
      toast({ title: 'No pending athletes', description: 'There are no pending/invited entries in this filtered list.' });
      return;
    }

    const inferLinkForBulk = (): string => {
      const manual = registrationLink.trim();
      if (manual) return manual;

      const targetEntries = entries.filter((entry) => targetIds.includes(entry.id));
      const eventIds = Array.from(new Set(targetEntries.map((entry) => entry.eventId).filter(Boolean)));
      if (eventIds.length !== 1 || typeof window === 'undefined') return '';

      const event = eventsById.get(eventIds[0]);
      const slug = String(event?.customSlug || '').trim();
      if (!slug) return '';
      return `${window.location.origin}/event-form/${slug}`;
    };

    const resolvedRegistrationLink = inferLinkForBulk();
    if (!resolvedRegistrationLink) {
      toast({
        variant: 'destructive',
        title: 'Registration link required',
        description: 'Add registration link before sending invites.',
      });
      return;
    }

    if (!registrationLink.trim()) {
      setRegistrationLink(resolvedRegistrationLink);
    }

    setIsBulkSending(true);
    try {
      const expiresAt = getDefaultWaitlistExpiryIso();
      const result = await bulkSendWaitlistInvitationsAction({
        entryIds: targetIds,
        registrationLink: resolvedRegistrationLink,
        expiresAt,
        actor: 'admin-dashboard',
      });

      if (!result.success && result.stats.sent === 0) {
        throw new Error(result.message);
      }

      toast({
        title: 'Bulk invite completed',
        description: `Sent ${result.stats.sent} / ${result.stats.total}. Failed: ${result.stats.failed}. Codes expire in 2 days.`,
      });
      await loadEntries();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Bulk send failed', description: error?.message || 'Could not send bulk invitations.' });
    } finally {
      setIsBulkSending(false);
    }
  }, [entries, eventsById, registrationLink, toast, loadEntries]);

  const markStatus = useCallback(async (entryId: string, status: WaitlistEntryStatus) => {
    const result = await updateWaitlistEntryStatusAction({ entryId, status });
    if (!result.success) {
      toast({ variant: 'destructive', title: 'Status update failed', description: result.message });
      return;
    }
    await loadEntries();
  }, [loadEntries, toast]);

  const revokeCodeForEntry = useCallback(async (entry: WaitlistEntry) => {
    if (!entry.codeId) {
      toast({ variant: 'destructive', title: 'No code', description: 'No code exists for this waitlist entry.' });
      return;
    }

    const result = await updateWaitlistCodeStatusAction({ codeId: entry.codeId, status: 'revoked' });
    if (!result.success) {
      toast({ variant: 'destructive', title: 'Revoke failed', description: result.message });
      return;
    }

    toast({ title: 'Code revoked', description: `Code revoked for ${entry.athleteName}.` });
    await loadEntries();
  }, [loadEntries, toast]);

  const deleteEntry = useCallback(async (entry: WaitlistEntry) => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Delete waitlist entry for ${entry.athleteName}? This will also delete the linked code and cannot be undone.`);
      if (!ok) return;
    }

    setIsDeleting(entry.id);
    try {
      const result = await deleteWaitlistEntryAction({ entryId: entry.id, actor: 'admin-dashboard' });
      if (!result.success) throw new Error(result.message);
      toast({ title: 'Entry deleted', description: `${entry.athleteName} was removed from waitlist.` });
      await loadEntries();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Delete failed', description: error?.message || 'Could not delete waitlist entry.' });
    } finally {
      setIsDeleting(null);
    }
  }, [loadEntries, toast]);

  const updateTicketCategory = useCallback(async (entry: WaitlistEntry) => {
    setIsUpdatingTicket(entry.id);
    try {
      const ticketId = String(ticketDrafts[entry.id] || '').trim() || null;
      const ticketName = ticketId
        ? (eventsById.get(entry.eventId)?.ticketDefinitions || []).find((ticket) => ticket.id === ticketId)?.ticketName || null
        : null;

      const result = await updateWaitlistEntryTicketAction({
        entryId: entry.id,
        ticketId,
        ticketName,
      });

      if (!result.success) {
        toast({ variant: 'destructive', title: 'Ticket update failed', description: result.message });
        return;
      }

      toast({ title: 'Ticket updated', description: `${entry.athleteName} category updated.` });
      setTicketDrafts((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      await loadEntries();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Ticket update failed', description: error?.message || 'Could not update ticket category.' });
    } finally {
      setIsUpdatingTicket(null);
    }
  }, [eventsById, loadEntries, ticketDrafts, toast]);

  const showEntryMessage = useCallback((entry: WaitlistEntry) => {
    toast({
      title: `Message from ${entry.athleteName}`,
      description: String(entry.message || '').trim() || 'No message provided.',
    });
  }, [toast]);

  const ticketFilterOptions = useMemo(() => {
    const selectedEvent = selectedEventId !== 'all' ? upcomingEvents.find((event) => event.id === selectedEventId) || null : null;

    const selectedTickets = (selectedEvent?.ticketDefinitions || [])
      .filter((ticket) => !ticket.isHidden)
      .map((ticket) => ({
        id: ticket.id,
        label: `${ticket.ticketName}${ticket.ticketCategory ? ` · ${ticket.ticketCategory}` : ''}`,
      }));

    if (selectedTickets.length > 0) return selectedTickets;

    const seen = new Set<string>();
    const fallback: Array<{ id: string; label: string }> = [];
    for (const entry of entries) {
      const ticketId = String(entry.ticketId || '').trim();
      if (!ticketId || seen.has(ticketId)) continue;
      seen.add(ticketId);
      fallback.push({ id: ticketId, label: getTicketLabel(entry.eventId, entry.ticketId, entry.ticketName) });
    }

    return fallback.sort((a, b) => a.label.localeCompare(b.label));
  }, [entries, getTicketLabel, selectedEventId, upcomingEvents]);

  const getExpiryLabel = useCallback((entry: WaitlistEntry): string => {
    const base = String(entry.codeSentAt || entry.invitedAt || '').trim();
    if (!base) return '—';

    const parsed = new Date(base);
    if (Number.isNaN(parsed.getTime())) return '—';

    const expiry = new Date(parsed);
    expiry.setDate(expiry.getDate() + 2);
    return format(expiry, 'dd MMM yyyy, HH:mm');
  }, []);

  const getEffectiveCodeStatus = useCallback((code?: WaitlistEntry['code'] | null): 'active' | 'used' | 'expired' | 'revoked' | 'missing' => {
    if (!code) return 'missing';
    const rawStatus = String(code.status || '').trim().toLowerCase();
    const now = Date.now();
    const expiresAt = code.expiresAt ? new Date(code.expiresAt).getTime() : Number.NaN;
    const isExpiredByTime = !Number.isNaN(expiresAt) && now > expiresAt;

    if (rawStatus === 'revoked') return 'revoked';
    if (rawStatus === 'used' || code.usageCount >= code.usageLimit) return 'used';
    if (rawStatus === 'expired' || isExpiredByTime) return 'expired';
    return 'active';
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Waitlist Management</CardTitle>
          <CardDescription>Manage event-wise waitlist entries, send unique codes, and track registrations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="space-y-1.5">
              <Label>Event</Label>
              <Select value={selectedEventId} onValueChange={setSelectedEventId}>
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingEvents ? 'Loading events...' : 'All events'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All events</SelectItem>
                  {upcomingEvents.map((event) => (
                    <SelectItem key={event.id} value={event.id}>{event.eventName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as WaitlistEntryStatus | 'all')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Ticket/Category</Label>
              <Select value={ticketFilter} onValueChange={setTicketFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All tickets" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tickets</SelectItem>
                  {ticketFilterOptions.map((ticket) => (
                    <SelectItem key={ticket.id} value={ticket.id}>{ticket.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Search</Label>
              <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search name, email, mobile, code" />
            </div>

            <div className="space-y-1.5">
              <Label>Registration Link</Label>
              <Input value={registrationLink} onChange={(e) => setRegistrationLink(e.target.value)} placeholder="https://.../event-form/my-event" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={loadEntries} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
            <Button variant="outline" onClick={createOrEnableForm} disabled={isCreatingForm || !selectedEvent || selectedEventId === 'all'}>
              {isCreatingForm ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Enable Waitlist Form
            </Button>
            <Button onClick={sendBulkInvites} disabled={isBulkSending || entries.length === 0}>
              {isBulkSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
              Send Invites (Pending)
            </Button>
              </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entries ({entries.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5 mb-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</div>
              <div className="text-xl font-black">{waitlistStats.total}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sent</div>
              <div className="text-xl font-black">{waitlistStats.sent}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Registered</div>
              <div className="text-xl font-black">{waitlistStats.registered}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Expired</div>
              <div className="text-xl font-black">{waitlistStats.expired}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pending</div>
              <div className="text-xl font-black">{waitlistStats.pending}</div>
            </div>
          </div>
          <div className="overflow-auto rounded-lg border max-h-[72vh]">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Athlete</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      <Loader2 className="h-4 w-4 inline mr-2 animate-spin" /> Loading entries...
                    </TableCell>
                  </TableRow>
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No waitlist entries found.</TableCell>
                  </TableRow>
                ) : (
                  // apply client-side search filter
                  entries
                    .filter((entry) => {
                      const q = String(searchTerm || '').trim().toLowerCase();
                      if (!q) return true;
                      const code = (entry.code?.code || '').toLowerCase();
                      return (
                        String(entry.athleteName || '').toLowerCase().includes(q) ||
                        String(entry.email || '').toLowerCase().includes(q) ||
                        String(entry.mobile || '').toLowerCase().includes(q) ||
                        String(entry.ticketName || '').toLowerCase().includes(q) ||
                        String(code).includes(q)
                      );
                    })
                    .map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <div className="font-medium">{entry.athleteName}</div>
                        <div className="text-xs text-muted-foreground">{entry.email}</div>
                        <div className="text-xs text-muted-foreground">{entry.mobile}</div>
                        <button
                          type="button"
                          onClick={() => showEntryMessage(entry)}
                          className="mt-1 text-xs font-medium text-orange-600 hover:underline"
                        >
                          View message
                        </button>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{entry.eventName}</TableCell>
                      <TableCell>
                        <div className="space-y-2 min-w-[220px]">
                          <div className="text-sm font-medium">{entry.ticketName || 'Any category'}</div>
                          <div className="flex gap-2 items-center">
                            <Select
                              value={ticketDrafts[entry.id] && ticketDrafts[entry.id].length > 0 ? ticketDrafts[entry.id] : (entry.ticketId || 'any')}
                              onValueChange={(value) => setTicketDrafts((prev) => ({ ...prev, [entry.id]: value === 'any' ? '' : value }))}
                            >
                              <SelectTrigger className="h-8 w-[180px]">
                                <SelectValue placeholder="Change category" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="any">Any category</SelectItem>
                                {(ticketOptionsByEventId.get(entry.eventId) || []).map((ticket) => (
                                  <SelectItem key={ticket.id} value={ticket.id}>{ticket.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updateTicketCategory(entry)}
                              disabled={isUpdatingTicket === entry.id || isDeleting === entry.id}
                            >
                              {isUpdatingTicket === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{entry.createdAt ? format(new Date(entry.createdAt), 'dd MMM yyyy, HH:mm') : '—'}</TableCell>
                      <TableCell>
                        {(() => {
                          const code = entry.code;
                          if (!code) return <span className="text-xs text-muted-foreground">—</span>;
                          const effectiveStatus = getEffectiveCodeStatus(code);
                          const used = effectiveStatus === 'used';
                          const codeStatusColor: Record<string, string> = {
                            active: 'text-green-700 bg-green-50 border-green-200',
                            used: 'text-gray-500 bg-gray-50 border-gray-200',
                            expired: 'text-red-600 bg-red-50 border-red-200',
                            revoked: 'text-red-700 bg-red-100 border-red-300',
                          };
                          const colorClass = codeStatusColor[effectiveStatus] || 'text-gray-500 bg-gray-50 border-gray-200';
                          return (
                            <div className="space-y-1 min-w-[140px]">
                              <div className="font-mono text-xs font-bold tracking-widest">{code.code}</div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${colorClass}`}>
                                  {effectiveStatus}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {used ? `${code.usageCount}/${code.usageLimit} used` : `${code.usageCount}/${code.usageLimit} — unused`}
                                </span>
                              </div>
                              {code.expiresAt && (
                                <div className="text-[10px] text-muted-foreground">
                                  Exp: {format(new Date(code.expiresAt), 'dd MMM yyyy, HH:mm')}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[entry.status]}>{entry.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => sendInvite(entry)}
                            disabled={isSending === entry.id || isDeleting === entry.id}
                          >
                            {isSending === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Send Code'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => markStatus(entry.id, 'cancelled')} disabled={isDeleting === entry.id}>Cancel</Button>
                          <Button size="sm" variant="outline" onClick={() => markStatus(entry.id, 'expired')} disabled={isDeleting === entry.id}>Expire</Button>
                          <Button size="sm" variant="outline" onClick={() => revokeCodeForEntry(entry)} disabled={isDeleting === entry.id}>Revoke</Button>
                          <Button size="sm" variant="destructive" onClick={() => deleteEntry(entry)} disabled={isDeleting === entry.id}>
                            {isDeleting === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Delete'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Public Waitlist Links</CardTitle>
          <CardDescription>Share these with athletes when categories are sold-out or closed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoadingEvents ? (
            <p className="text-sm text-muted-foreground">Loading events...</p>
          ) : (
            upcomingEvents.map((event) => {
              const currentForm = formsByEventId[event.id];
              const selectedTickets = selectedTicketIdsByEventId[event.id] || [];
              const soldOutTickets = ticketOptionsByEventId.get(event.id) || [];

              return (
                <div key={event.id} className="rounded border p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 font-medium">
                        {event.eventName}
                        {currentForm?.isActive ? <Badge variant="outline">Active</Badge> : <Badge variant="secondary">Disabled</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">/waitlist/{event.customSlug || event.id}</div>

                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold uppercase text-muted-foreground">Waitlist open date</Label>
                          <Input
                            type="datetime-local"
                            value={waitlistOpenAtByEventId[event.id] || ''}
                            onChange={(e) => setWaitlistOpenAtByEventId((prev) => ({ ...prev, [event.id]: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold uppercase text-muted-foreground">Waitlist close date</Label>
                          <Input
                            type="datetime-local"
                            value={waitlistCloseAtByEventId[event.id] || ''}
                            onChange={(e) => setWaitlistCloseAtByEventId((prev) => ({ ...prev, [event.id]: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold uppercase text-muted-foreground">Select tickets</Label>
                        <div className="flex flex-wrap gap-2">
                          {soldOutTickets.map((ticket) => {
                            const selected = selectedTickets.includes(ticket.id);
                            return (
                              <button
                                key={ticket.id}
                                type="button"
                                onClick={() => setSelectedTicketIdsByEventId((prev) => {
                                  const current = new Set(prev[event.id] || []);
                                  if (selected) current.delete(ticket.id);
                                  else current.add(ticket.id);
                                  return { ...prev, [event.id]: Array.from(current) };
                                })}
                                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 bg-white text-slate-700'}`}
                              >
                                {ticket.label}
                              </button>
                            );
                          })}
                          {soldOutTickets.length === 0 ? <span className="text-xs text-muted-foreground">No sold-out tickets available</span> : null}
                        </div>
                      </div>

                      {currentForm?.isActive ? (
                        <div className="text-xs text-muted-foreground">
                          Enabled for: {selectedTickets.length > 0 ? selectedTickets.map((ticketId) => soldOutTickets.find((ticket) => ticket.id === ticketId)?.label || ticketId).join(', ') : 'All sold-out tickets'}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                        onClick={() => void saveFormSettingsForEvent(event)}
                        disabled={isCreatingForm}
                      >
                        {isCreatingForm ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedEventId(event.id);
                          if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        Edit
                      </Button>
                      {currentForm?.isActive ? (
                        <Button variant="destructive" size="sm" onClick={() => void upsertLinkForEvent(event, false)} disabled={isCreatingForm}>
                          Disable Link
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => void upsertLinkForEvent(event, true)} disabled={isCreatingForm}>
                          Enable Link
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
