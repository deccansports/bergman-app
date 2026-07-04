// src/components/admin/GoogleFormTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Loader2, RefreshCw, CheckCircle2, XCircle, Search, Image as ImageIcon,
  ClipboardList, AlertTriangle, Plus, Trash2, Pencil, Link2, ExternalLink, ArrowRight,
} from 'lucide-react';
import {
  getGoogleFormRegistrationsAction,
  approveGoogleFormRegistrationAction,
  resyncGoogleFormRegistrationAction,
  rejectGoogleFormRegistrationAction,
  rebuildRegistrationsCacheFromFirestoreAction,
  getFormMappingsAction,
  createFormMappingAction,
  updateFormMappingAction,
  deleteFormMappingAction,
  toggleFormMappingActiveAction,
  testFormMappingAction,
  syncFormMappingFromSheetAction,
  autoSyncAllFormMappingsAction,
  type GoogleFormRegistration,
  type FormMapping,
  type FormMappingInput,
  type TicketConfig,
} from '@/lib/actions/googleFormActions';
import type { EventCalendarEntry, TicketDefinition } from '@/lib/types';
import { getTicketDefinitionsForEventAction } from '@/lib/actions/ticketActions';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractFormId(input: string): string {
  // Extract from Google Form URL: /d/FORM_ID/ or /d/e/FORM_ID/
  const match = input.match(/\/d\/(?:e\/)?([a-zA-Z0-9_-]{10,})/);
  if (match) return match[1];
  return input.trim();
}

function extractSheetId(input: string): string {
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (match) return match[1];
  return input.trim();
}

function isValidGoogleFormUrl(input: string): boolean {
  return /^https:\/\/docs\.google\.com\/forms\//i.test(input.trim());
}

function isValidGoogleSheetUrl(input: string): boolean {
  return /^https:\/\/docs\.google\.com\/spreadsheets\//i.test(input.trim());
}

function getGoogleFormUrl(formId: string): string {
  return `https://docs.google.com/forms/d/${formId}/viewform`;
}

function getGoogleSheetUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

function toPaisaFromEventPrice(raw: number | null | undefined): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Heuristic: large values ending in 00 are likely already paisa.
  if (n >= 100000 && n % 100 === 0) return Math.round(n);
  return Math.round(n * 100);
}

function formatRupeeFromPaisa(paisa: number): string {
  const rupees = paisa / 100;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function getDirectImageUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (url.includes('drive.google.com/uc')) return url;
  const match = url.match(/\/d\/([\w-]+)/);
  if (match) return `https://drive.google.com/uc?export=view&id=${match[1]}`;
  return url;
}

function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status?.toLowerCase()) {
    case 'approved': return 'default';
    case 'rejected': return 'destructive';
    case 'pending': return 'secondary';
    default: return 'outline';
  }
}

function getPaymentVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status?.toLowerCase()) {
    case 'paid': return 'default';
    case 'pending': return 'secondary';
    case 'failed': return 'destructive';
    default: return 'outline';
  }
}

// ─── Payment Proof Thumbnail ──────────────────────────────────────────────────

function PaymentProofThumbnail({ url, name }: { url: string | undefined; name: string }) {
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const directUrl = getDirectImageUrl(url);

  if (!directUrl) return <span className="text-muted-foreground text-xs italic">No proof</span>;

  if (imgError) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary text-xs underline flex items-center gap-1">
        <ImageIcon className="h-3 w-3" /> View
      </a>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group relative rounded overflow-hidden border border-border hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
        title={`Payment proof – ${name}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={directUrl}
          alt={`Payment proof – ${name}`}
          className="h-12 w-16 object-cover group-hover:opacity-80 transition-opacity"
          onError={() => setImgError(true)}
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
          <ImageIcon className="h-4 w-4 text-white" />
        </div>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl p-2 flex items-center justify-center bg-black/90">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={directUrl}
            alt={`Payment proof – ${name}`}
            className="max-h-[80vh] max-w-full rounded object-contain"
            onError={() => { setImgError(true); setOpen(false); }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Ticket Row Editor ────────────────────────────────────────────────────────

interface TicketRow {
  optionKey: string;
  ourTicketId: string;
  ourTicketName: string;
  selectedSubCategoryId?: string;
  selectedSubCategoryName?: string;
  formOptionLabel: string;
  price: string;
}

const EMPTY_TICKET_ROW: TicketRow = { optionKey: '', ourTicketId: '', ourTicketName: '', selectedSubCategoryId: '', selectedSubCategoryName: '', formOptionLabel: '', price: '' };

interface TicketOption {
  key: string;
  ourTicketId: string;
  ourTicketName: string;
  selectedSubCategoryId?: string;
  selectedSubCategoryName?: string;
  defaultPricePaisa: number;
}

function TicketEditor({
  rows,
  onChange,
  ticketDefinitions,
  loadingTickets,
}: {
  rows: TicketRow[];
  onChange: (rows: TicketRow[]) => void;
  ticketDefinitions: TicketDefinition[];
  loadingTickets: boolean;
}) {
  const addRow = () => onChange([...rows, { ...EMPTY_TICKET_ROW }]);
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  const ticketOptions = useMemo<TicketOption[]>(() => {
    const options: TicketOption[] = [];
    for (const td of ticketDefinitions) {
      const basePricePaisa = toPaisaFromEventPrice(td.price);
      const subCategories = Array.isArray(td.subCategories) ? td.subCategories : [];

      // Keep a base ticket option as well.
      options.push({
        key: td.id,
        ourTicketId: td.id,
        ourTicketName: td.ticketName,
        defaultPricePaisa: basePricePaisa,
      });

      for (const sub of subCategories) {
        options.push({
          key: `${td.id}::${sub.id}`,
          ourTicketId: td.id,
          ourTicketName: `${td.ticketName} - ${sub.name}`,
          selectedSubCategoryId: sub.id,
          selectedSubCategoryName: sub.name,
          defaultPricePaisa: Number(sub.pricePaisa ?? basePricePaisa) || 0,
        });
      }
    }
    return options;
  }, [ticketDefinitions]);

  const selectOurTicket = (i: number, optionKey: string) => {
    const option = ticketOptions.find((t) => t.key === optionKey);
    if (!option) return;
    const next = rows.map((r, idx) =>
      idx === i
        ? {
            ...r,
            optionKey: option.key,
            ourTicketId: option.ourTicketId,
            ourTicketName: option.ourTicketName,
            selectedSubCategoryId: option.selectedSubCategoryId || '',
            selectedSubCategoryName: option.selectedSubCategoryName || '',
            // Auto-fill form label with our ticket name (user can override)
            formOptionLabel: r.formOptionLabel || option.ourTicketName,
            // Auto-fill mapping amount in paisa from event ticket rupee value
            price: r.price || String(option.defaultPricePaisa),
          }
        : r
    );
    onChange(next);
  };

  const updateField = (i: number, field: keyof TicketRow, value: string) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r));
    onChange(next);
  };

  const noTickets = !loadingTickets && ticketDefinitions.length === 0;

  return (
    <div className="space-y-3">
      {/* Column headers */}
      <div className="grid grid-cols-[1fr_1fr_100px_36px] gap-2 text-xs font-semibold text-muted-foreground px-1">
        <span>Our Ticket</span>
        <span>Google Form Option (exact text)</span>
        <span>Amount (paisa)</span>
        <span />
      </div>

      {noTickets && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md px-3 py-2">
          ⚠ No tickets found for the selected event. Select an event first.
        </p>
      )}

      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_100px_36px] gap-2 items-start">
          {/* Our Ticket dropdown */}
          <Select
            value={row.optionKey || (row.selectedSubCategoryId ? `${row.ourTicketId}::${row.selectedSubCategoryId}` : row.ourTicketId)}
            onValueChange={(val) => selectOurTicket(i, val)}
            disabled={loadingTickets || noTickets}
          >
            <SelectTrigger className="h-9 text-sm">
              {loadingTickets
                ? <span className="text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" />Loading…</span>
                : <SelectValue placeholder="Select ticket…" />
              }
            </SelectTrigger>
            <SelectContent>
              {ticketOptions.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  <div className="flex flex-col">
                    <span>{opt.ourTicketName}</span>
                    <span className="text-xs text-muted-foreground">Event: {formatRupeeFromPaisa(opt.defaultPricePaisa)}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Google Form option label */}
          <Input
            value={row.formOptionLabel}
            onChange={(e) => updateField(i, 'formOptionLabel', e.target.value)}
            placeholder="e.g. Olympic Triathlon"
            className="h-9 text-sm"
          />

          {/* Price override */}
          <Input
            type="number"
            value={row.price}
            onChange={(e) => updateField(i, 'price', e.target.value)}
            placeholder="500000"
            min={0}
            className="h-9 text-sm"
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-destructive hover:bg-destructive/10"
            onClick={() => removeRow(i)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addRow} className="gap-1.5 mt-1" disabled={noTickets}>
        <Plus className="h-3.5 w-3.5" /> Add Ticket Mapping
      </Button>
    </div>
  );
}

// ─── Form Mapping Dialog ──────────────────────────────────────────────────────

interface MappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: FormMapping | null;
  events: EventCalendarEntry[];
  onSaved: (mapping: FormMapping) => void;
}

function MappingDialog({ open, onOpenChange, editing, events, onSaved }: MappingDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Fields
  const [formInput, setFormInput] = useState('');
  const [sheetInput, setSheetInput] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [active, setActive] = useState(true);
  const [ticketRows, setTicketRows] = useState<TicketRow[]>([{ ...EMPTY_TICKET_ROW }]);
  const [testResult, setTestResult] = useState<{
    mappingOk?: boolean;
    rowsCount?: number;
    lastSyncedRow?: number;
    newEntries?: number;
    ticketColumn?: string | null;
    lastRowTicket?: string | null;
    unmappedTickets?: string[];
    error?: string;
  } | null>(null);

  // Ticket definitions for selected event
  const [ticketDefs, setTicketDefs] = useState<TicketDefinition[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  // Populate when editing
  useEffect(() => {
    if (editing) {
      setFormInput(editing.formUrl || getGoogleFormUrl(editing.formId));
      setSheetInput(editing.sheetUrl || (editing.sheetId ? getGoogleSheetUrl(editing.sheetId) : ''));
      setSelectedEventId(editing.eventId);
      setSourceName(editing.sourceName);
      setActive(editing.active);
      const rows = Object.values(editing.tickets).map((t) => ({
        optionKey: t.selectedSubCategoryId ? `${t.ourTicketId ?? ''}::${t.selectedSubCategoryId}` : (t.ourTicketId ?? ''),
        ourTicketId: t.ourTicketId ?? '',
        ourTicketName: t.ourTicketName ?? t.category ?? '',
        selectedSubCategoryId: t.selectedSubCategoryId ?? '',
        selectedSubCategoryName: t.selectedSubCategoryName ?? '',
        formOptionLabel: t.formOptionLabel ?? t.category ?? '',
        price: String(t.price),
      }));
      setTicketRows(rows.length > 0 ? rows : [{ ...EMPTY_TICKET_ROW }]);
    } else {
      setFormInput('');
      setSheetInput('');
      setSelectedEventId('');
      setSourceName('');
      setActive(true);
      setTicketRows([{ ...EMPTY_TICKET_ROW }]);
    }
    setTestResult(null);
  }, [editing, open]);

  // Fetch ticket definitions when event changes
  useEffect(() => {
    if (!selectedEventId) { setTicketDefs([]); return; }
    setLoadingTickets(true);
    getTicketDefinitionsForEventAction(selectedEventId)
      .then((res) => {
        if (res.success && res.ticketDefinitions) setTicketDefs(res.ticketDefinitions);
        else setTicketDefs([]);
      })
      .catch(() => setTicketDefs([]))
      .finally(() => setLoadingTickets(false));
  }, [selectedEventId]);

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  const buildTicketsPayload = (): Record<string, TicketConfig> => {
    const validRows = ticketRows
      .filter((r) => r.ourTicketId.trim() && r.formOptionLabel.trim())
      .map((r) => ({
        ourTicketId: r.ourTicketId.trim(),
        ourTicketName: r.ourTicketName.trim(),
        selectedSubCategoryId: r.selectedSubCategoryId?.trim() || undefined,
        selectedSubCategoryName: r.selectedSubCategoryName?.trim() || undefined,
        formOptionLabel: r.formOptionLabel.trim(),
        price: Number(r.price) || 0,
      }));

    const tickets: Record<string, TicketConfig> = {};
    for (const row of validRows) {
      const key = `${row.ourTicketId}::${row.selectedSubCategoryId || ''}`;
      tickets[key] = row;
    }
    return tickets;
  };

  const validateBeforeSave = (): string | null => {
    if (!isValidGoogleFormUrl(formInput)) return 'Valid Google Form URL is required.';
    if (!extractFormId(formInput)) return 'Could not extract Form ID from Form URL.';
    if (!isValidGoogleSheetUrl(sheetInput)) return 'Valid Google Sheet URL is required.';
    if (!extractSheetId(sheetInput)) return 'Could not extract Sheet ID from Sheet URL.';
    if (!selectedEventId) return 'Please select an event.';
    if (!sourceName.trim()) return 'Source name is required.';

    const validRows = ticketRows.filter((r) => r.ourTicketId.trim() && r.formOptionLabel.trim());
    if (validRows.length === 0) return 'Add at least 1 valid ticket mapping.';

    const ourTicketIds = validRows.map((r) => `${r.ourTicketId.trim()}::${String(r.selectedSubCategoryId || '').trim()}`);
    const formOptions = validRows.map((r) => r.formOptionLabel.trim().toLowerCase());
    if (new Set(ourTicketIds).size !== ourTicketIds.length) return 'Duplicate Our Ticket/Sub-category mapping found.';
    if (new Set(formOptions).size !== formOptions.length) return 'Duplicate Google Form Option found in mappings.';

    return null;
  };

  const handleTestMapping = async () => {
    const validationError = validateBeforeSave();
    if (validationError) {
      toast({ variant: 'destructive', title: 'Validation', description: validationError });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const result = await testFormMappingAction({
        sheetUrl: sheetInput.trim(),
        sheetId: extractSheetId(sheetInput),
        tickets: buildTicketsPayload(),
        lastSyncedRow: editing?.lastSyncedRow ?? 1,
      });

      if (!result.success) {
        setTestResult({ error: result.error });
        toast({ variant: 'destructive', title: 'Test Failed', description: result.error || 'Could not test mapping.' });
        return;
      }

      setTestResult({
        mappingOk: result.mappingOk,
        rowsCount: result.rowsCount,
        lastSyncedRow: result.lastSyncedRow,
        newEntries: result.newEntries,
        ticketColumn: result.ticketColumn,
        lastRowTicket: result.lastRowTicket,
        unmappedTickets: result.unmappedTickets,
      });

      if (result.mappingOk) {
        toast({ title: '✅ Mapping OK', description: `Sheet rows: ${result.rowsCount ?? 0}. New entries: ${result.newEntries ?? 0}.` });
      } else {
        toast({ variant: 'destructive', title: '❌ Mapping mismatch', description: result.error || 'Some sheet tickets are not mapped.' });
      }
    } catch {
      setTestResult({ error: 'Could not test mapping.' });
      toast({ variant: 'destructive', title: 'Error', description: 'Could not test mapping.' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const validationError = validateBeforeSave();
    if (validationError) {
      toast({ variant: 'destructive', title: 'Validation', description: validationError });
      return;
    }

    const formId = extractFormId(formInput);
    const sheetId = extractSheetId(sheetInput);
    const tickets = buildTicketsPayload();

    const payload: FormMappingInput = {
      formUrl: formInput.trim(),
      formId,
      sheetUrl: sheetInput.trim(),
      sheetId,
      eventId: selectedEventId,
      eventName: selectedEvent?.eventName || selectedEventId,
      sourceName: sourceName.trim(),
      tickets,
      lastSyncedRow: editing?.lastSyncedRow ?? 1,
      active,
    };

    setSaving(true);
    try {
      if (editing) {
        const result = await updateFormMappingAction(editing.id, payload);
        if (!result.success) throw new Error(result.error);
        onSaved({ ...editing, ...payload });
        toast({ title: '✅ Updated', description: 'Form mapping updated successfully.' });
      } else {
        const result = await createFormMappingAction(payload);
        if (!result.success) throw new Error(result.error);
        onSaved({ id: result.id!, ...payload });
        toast({ title: '✅ Created', description: 'Form mapping created successfully.' });
      }
      onOpenChange(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'Could not save form mapping.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Form Mapping' : 'Add New Form Mapping'}</DialogTitle>
          <DialogDescription>
            Map a Google Form to an event and source channel. Each form can have its own ticket types and pricing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Form URL / ID */}
          <div className="space-y-1.5">
            <Label htmlFor="formInput">Google Form URL <span className="text-destructive">*</span></Label>
            <div className="flex gap-2">
              <Input
                id="formInput"
                value={formInput}
                onChange={(e) => setFormInput(e.target.value)}
                placeholder="https://docs.google.com/forms/d/e/.../viewform"
                className="flex-1"
              />
              {formInput && extractFormId(formInput) && (
                <a
                  href={getGoogleFormUrl(extractFormId(formInput))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center px-3 border rounded-md text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                  title="Preview form"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
            {formInput && (
              <p className="text-xs text-muted-foreground">
                Extracted Public Form ID: <code className="font-mono bg-muted px-1 rounded">{extractFormId(formInput)}</code>
              </p>
            )}
          </div>

          {/* Sheet URL */}
          <div className="space-y-1.5">
            <Label htmlFor="sheetInput">Google Sheet URL <span className="text-destructive">*</span></Label>
            <div className="flex gap-2">
              <Input
                id="sheetInput"
                value={sheetInput}
                onChange={(e) => setSheetInput(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                className="flex-1"
              />
              {sheetInput && extractSheetId(sheetInput) && (
                <a
                  href={getGoogleSheetUrl(extractSheetId(sheetInput))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center px-3 border rounded-md text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                  title="Open sheet"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
            {sheetInput && (
              <p className="text-xs text-muted-foreground">
                Extracted Sheet ID: <code className="font-mono bg-muted px-1 rounded">{extractSheetId(sheetInput)}</code>
              </p>
            )}
          </div>

          {/* Event */}
          <div className="space-y-1.5">
            <Label htmlFor="eventSelect">Event <span className="text-destructive">*</span></Label>
            <Select value={selectedEventId} onValueChange={setSelectedEventId}>
              <SelectTrigger id="eventSelect">
                <SelectValue placeholder="Select an event…" />
              </SelectTrigger>
              <SelectContent>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Source Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sourceName">Source / Partner Name <span className="text-destructive">*</span></Label>
            <Input
              id="sourceName"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="e.g. Club Registration, School Campaign, Offline Desk"
            />
            <p className="text-xs text-muted-foreground">Used for tracking — registrations will store this as <code className="font-mono bg-muted px-1 rounded">sourceName</code>.</p>
          </div>

          {/* Ticket Types */}
          <div className="space-y-2">
            <Label>Ticket Mappings <span className="text-destructive">*</span></Label>
            <p className="text-xs text-muted-foreground">
              Select each of <strong>our tickets</strong>, then type the <strong>exact text</strong> of the matching option in the Google Form.
            </p>
            <TicketEditor
              rows={ticketRows}
              onChange={setTicketRows}
              ticketDefinitions={ticketDefs}
              loadingTickets={loadingTickets}
            />
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/30">
            <div>
              <p className="text-sm font-medium">Form Active</p>
              <p className="text-xs text-muted-foreground">Inactive forms stop accepting new registrations.</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleTestMapping} disabled={testing || saving} className="gap-1.5">
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            Test Mapping
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? 'Save Changes' : 'Create Mapping'}
          </Button>
        </DialogFooter>

        {testResult && (
          <div className="mt-3 rounded-lg border p-3 text-sm space-y-1">
            <div className="flex items-center gap-2">
              {testResult.mappingOk ? (
                <Badge variant="default">✅ Mapping OK</Badge>
              ) : (
                <Badge variant="destructive">❌ Mapping Issue</Badge>
              )}
              {testResult.ticketColumn ? <span className="text-muted-foreground">Ticket column: {testResult.ticketColumn}</span> : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div>Sheet Rows: <strong>{testResult.rowsCount ?? 0}</strong></div>
              <div>Last Synced: <strong>{testResult.lastSyncedRow ?? 1}</strong></div>
              <div>New Entries: <strong>{testResult.newEntries ?? 0}</strong></div>
            </div>
            {testResult.lastRowTicket ? (
              <div className="text-xs">Last Row Ticket: <strong>{testResult.lastRowTicket}</strong></div>
            ) : null}
            {testResult.unmappedTickets && testResult.unmappedTickets.length > 0 ? (
              <div className="text-xs text-destructive">Ticket not mapped: {testResult.unmappedTickets.join(', ')}</div>
            ) : null}
            {testResult.error ? <div className="text-xs text-destructive">{testResult.error}</div> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Form Mappings Panel ──────────────────────────────────────────────────────

function FormMappingsPanel({ events, isLoadingEvents }: { events: EventCalendarEntry[]; isLoadingEvents: boolean }) {
  const { toast } = useToast();
  const [mappings, setMappings] = useState<FormMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FormMapping | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FormMapping | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [autoSyncRunning, setAutoSyncRunning] = useState(false);
  const autoSyncLockRef = useRef(false);

  const fetchMappings = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getFormMappingsAction();
      if (result.success && result.mappings) setMappings(result.mappings);
      else toast({ variant: 'destructive', title: 'Error', description: result.error });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not load form mappings.' });
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchMappings();
    // fetch once on mount; avoid refetch loops from unstable hook deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaved = useCallback((mapping: FormMapping) => {
    setMappings((prev) => {
      const exists = prev.some((m) => m.id === mapping.id);
      return exists ? prev.map((m) => m.id === mapping.id ? mapping : m) : [mapping, ...prev];
    });
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const result = await deleteFormMappingAction(deleteTarget.id);
      if (!result.success) throw new Error(result.error);
      setMappings((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      toast({ title: '🗑️ Deleted', description: `Mapping for "${deleteTarget.sourceName}" removed.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleToggle = async (mapping: FormMapping) => {
    setTogglingId(mapping.id);
    try {
      const result = await toggleFormMappingActiveAction(mapping.id, !mapping.active);
      if (!result.success) throw new Error(result.error);
      setMappings((prev) => prev.map((m) => m.id === mapping.id ? { ...m, active: !m.active } : m));
      toast({ title: mapping.active ? '⏸ Deactivated' : '▶ Activated', description: `"${mapping.sourceName}" is now ${mapping.active ? 'inactive' : 'active'}.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setTogglingId(null);
    }
  };

  const handleSync = async (mapping: FormMapping) => {
    setSyncingId(mapping.id);
    try {
      const result = await syncFormMappingFromSheetAction(mapping.id);
      if (!result.success) throw new Error(result.error || 'Sync failed');

      setMappings((prev) => prev.map((m) =>
        m.id === mapping.id
          ? { ...m, lastSyncedRow: result.lastSyncedRow ?? m.lastSyncedRow }
          : m
      ));

      toast({
        title: '✅ Sync completed',
        description: `${result.created ?? 0} imported, ${result.updated ?? 0} updated, ${result.skipped ?? 0} skipped.`,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Sync failed', description: err.message || 'Could not sync from sheet.' });
    } finally {
      setSyncingId(null);
    }
  };

  const handleResync = async (mapping: FormMapping) => {
    setSyncingId(mapping.id);
    try {
      const result = await syncFormMappingFromSheetAction(mapping.id, { forceResync: true });
      if (!result.success) throw new Error(result.error || 'Resync failed');

      setMappings((prev) => prev.map((m) =>
        m.id === mapping.id
          ? { ...m, lastSyncedRow: result.lastSyncedRow ?? m.lastSyncedRow }
          : m
      ));

      toast({
        title: '✅ Resync completed',
        description: `${result.created ?? 0} imported, ${result.updated ?? 0} updated, ${result.skipped ?? 0} skipped after full scan.`,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Resync failed', description: err.message || 'Could not resync from sheet.' });
    } finally {
      setSyncingId(null);
    }
  };

  const runAutoSync = useCallback(async (silent = true, forceResync = false) => {
    if (autoSyncLockRef.current) return;
    autoSyncLockRef.current = true;
    setAutoSyncRunning(true);
    try {
      const result = await autoSyncAllFormMappingsAction({ forceResync });
      if (!result.success) throw new Error(result.error || 'Auto sync failed');

      await fetchMappings();

      if (!silent) {
        toast({
          title: forceResync ? '✅ Auto resync completed' : '✅ Auto sync completed',
          description: `Mappings: ${result.synced ?? 0}, imported: ${result.created ?? 0}, updated: ${result.updated ?? 0}, skipped: ${result.skipped ?? 0}`,
        });
      }
    } catch (err: any) {
      if (!silent) {
        toast({ variant: 'destructive', title: 'Auto sync failed', description: err.message || 'Could not auto sync.' });
      }
    } finally {
      setAutoSyncRunning(false);
      autoSyncLockRef.current = false;
    }
  }, [fetchMappings, toast]);

  useEffect(() => {
    if (!autoSyncEnabled) return;

    // Delay first sync by 10s so the initial page render is not blocked.
    // After that, sync every 90 seconds to pick up new sheet submissions.
    const firstRunId = setTimeout(() => runAutoSync(true), 10_000);
    const id = setInterval(() => runAutoSync(true), 90_000);

    return () => { clearTimeout(firstRunId); clearInterval(id); };
  }, [autoSyncEnabled, runAutoSync]);

  const stats = useMemo(() => ({
    total: mappings.length,
    active: mappings.filter((m) => m.active).length,
    inactive: mappings.filter((m) => !m.active).length,
    events: new Set(mappings.map((m) => m.eventId)).size,
  }), [mappings]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Each Google Form is mapped to an event and a source channel (partner/club/campaign). Multiple forms can share the same event.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant={autoSyncEnabled ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAutoSyncEnabled((v) => !v)}
            className="gap-1.5"
            title="Automatically sync active mappings every 60 seconds"
          >
            {autoSyncEnabled ? 'Auto Sync: ON' : 'Auto Sync: OFF'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => runAutoSync(false)}
            disabled={autoSyncRunning}
            className="gap-1.5"
            title="Run auto sync now for all active mappings"
          >
            {autoSyncRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync All
          </Button>
          <Button variant="outline" size="sm" onClick={fetchMappings} disabled={isLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add Form Mapping
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Forms', value: stats.total, color: 'text-foreground' },
          { label: 'Active', value: stats.active, color: 'text-green-500' },
          { label: 'Inactive', value: stats.inactive, color: 'text-muted-foreground' },
          { label: 'Events Covered', value: stats.events, color: 'text-primary' },
        ].map((s) => (
          <Card key={s.label} className="text-center py-3">
            <CardContent className="p-0">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : mappings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
              <Link2 className="h-10 w-10 opacity-30" />
              <p className="text-sm">No form mappings yet.</p>
              <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-1.5">
                <Plus className="h-4 w-4" /> Add Your First Mapping
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Form / Sheet</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Source / Partner</TableHead>
                    <TableHead>Ticket Types</TableHead>
                    <TableHead>Sync</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((m) => (
                    <TableRow key={m.id} className={!m.active ? 'opacity-50' : ''}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">Form:</span>
                            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded max-w-[120px] truncate block" title={m.formId}>{m.formId}</code>
                            <a href={m.formUrl || getGoogleFormUrl(m.formId)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors" title="Open form">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">Sheet:</span>
                            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded max-w-[120px] truncate block" title={m.sheetId}>{m.sheetId}</code>
                            <a href={m.sheetUrl || getGoogleSheetUrl(m.sheetId)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors" title="Open sheet">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{m.eventName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{m.eventId}</div>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-sm">{m.sourceName}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 max-w-[260px]">
                          {Object.values(m.tickets).map((t, idx) => (
                            <div key={idx} className="flex items-center gap-1 text-xs">
                              <span className="font-medium text-foreground truncate max-w-[90px]" title={t.ourTicketName || t.category}>
                                {t.ourTicketName || t.category || '—'}
                              </span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="text-muted-foreground truncate max-w-[90px]" title={t.formOptionLabel || t.category}>
                                {t.formOptionLabel || t.category || '—'}
                              </span>
                              <span className="text-primary font-mono ml-auto shrink-0">{t.price.toLocaleString('en-IN')}p</span>
                            </div>
                          ))}
                          {Object.keys(m.tickets).length === 0 && (
                            <span className="text-xs text-muted-foreground italic">No tickets</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">
                          <div>Last Synced Row: <span className="font-semibold">{m.lastSyncedRow ?? 1}</span></div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => handleToggle(m)}
                          disabled={togglingId === m.id}
                          className="focus:outline-none"
                          title={m.active ? 'Click to deactivate' : 'Click to activate'}
                        >
                          {togglingId === m.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Badge variant={m.active ? 'default' : 'outline'} className="cursor-pointer hover:opacity-80 transition-opacity">
                              {m.active ? '● Active' : '○ Inactive'}
                            </Badge>
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => handleSync(m)}
                            disabled={syncingId === m.id || !m.active}
                            title={m.active ? 'Sync new rows from sheet' : 'Activate mapping to sync'}
                          >
                            {syncingId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Sync'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => handleResync(m)}
                            disabled={syncingId === m.id || !m.active}
                            title={m.active ? 'Re-scan full sheet from start' : 'Activate mapping to resync'}
                          >
                            {syncingId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Resync'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => { setEditing(m); setDialogOpen(true); }}
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(m)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <MappingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        events={events}
        onSaved={handleSaved}
      />

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Form Mapping?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the mapping for <strong>&quot;{deleteTarget?.sourceName}&quot;</strong> (Form: <code className="font-mono text-xs">{deleteTarget?.formId}</code>). Existing registrations will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Registrations Panel ──────────────────────────────────────────────────────

function RegistrationsPanel() {
  const { toast } = useToast();
  const [registrations, setRegistrations] = useState<GoogleFormRegistration[]>([]);
  const [selectedRegistration, setSelectedRegistration] = useState<GoogleFormRegistration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [isBulkResyncing, setIsBulkResyncing] = useState(false);
  const [autoFetchEnabled, setAutoFetchEnabled] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const autoFetchLockRef = useRef(false);

  const fetchRegistrations = useCallback(async (showLoader = true) => {
    if (showLoader) setIsLoading(true);
    try {
      const result = await getGoogleFormRegistrationsAction();
      if (result.success && result.registrations) {
        setRegistrations(result.registrations);
        // If KV cache was empty (cold start), rebuild from Firestore immediately
        // instead of waiting 8s for the Google Sheets background sync.
        if (result.registrations.length === 0 && showLoader) {
          rebuildRegistrationsCacheFromFirestoreAction().then(async (rebuild) => {
            if (rebuild.success && (rebuild.count ?? 0) > 0) {
              const fresh = await getGoogleFormRegistrationsAction();
              if (fresh.success && fresh.registrations) setRegistrations(fresh.registrations);
            }
          }).catch(() => {/* silent */});
        }
      } else if (showLoader) {
        toast({ variant: 'destructive', title: 'Error', description: result.error || 'Failed to load registrations.' });
      }
    } catch {
      if (showLoader) toast({ variant: 'destructive', title: 'Error', description: 'Unexpected error.' });
    } finally {
      if (showLoader) setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncAndRefreshRegistrations = useCallback(async () => {
    if (autoFetchLockRef.current) return;
    autoFetchLockRef.current = true;
    try {
      // Only read from KV — FormMappingsPanel handles the actual Google Sheets sync.
      // Calling autoSyncAllFormMappingsAction here causes double sheet fetches that
      // block the server when both panels are mounted.
      const result = await getGoogleFormRegistrationsAction();
      if (result.success && result.registrations) {
        setRegistrations(result.registrations);
      }
    } catch {
      // Silent background refresh failure; manual refresh remains available.
    } finally {
      autoFetchLockRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchRegistrations();
    // fetch once on mount; avoid refetch loops from unstable hook deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoFetchEnabled) return;

    const run = async () => {
      await syncAndRefreshRegistrations();
    };

    // Delay the first sync so the initial registrations list renders fast.
    const firstRunId = setTimeout(run, 8_000);
    // keep registrations fresh when new form entries are imported
    const id = setInterval(run, 60_000);
    return () => {
      clearTimeout(firstRunId);
      clearInterval(id);
    };
  }, [autoFetchEnabled, syncAndRefreshRegistrations]);

  // Unique source names for filter dropdown
  const sourceNames = useMemo(() => {
    const names = [...new Set(registrations.map((r) => r.sourceName).filter(Boolean))] as string[];
    return names.sort();
  }, [registrations]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const toTime = (value: unknown): number => {
      if (!value) return 0;
      const raw = String(value);
      const t = new Date(raw).getTime();
      return Number.isFinite(t) ? t : 0;
    };

    return registrations
      .filter((r) => {
        const matchesStatus = statusFilter === 'all' || r.status?.toLowerCase() === statusFilter;
        const matchesSource = sourceFilter === 'all' || r.sourceName === sourceFilter;
        const matchesSearch = !term ||
          r.name?.toLowerCase().includes(term) ||
          r.email?.toLowerCase().includes(term) ||
          r.phone?.includes(term) ||
          r.bibNumber?.toLowerCase().includes(term) ||
          r.eventCategory?.toLowerCase().includes(term) ||
          r.sourceName?.toLowerCase().includes(term);
        return matchesStatus && matchesSource && matchesSearch;
      })
      .sort((a, b) => {
        const aTime = Math.max(
          toTime((a as any).createdAt),
          toTime((a as any).updatedAt),
          toTime((a as any).importedAt),
        );
        const bTime = Math.max(
          toTime((b as any).createdAt),
          toTime((b as any).updatedAt),
          toTime((b as any).importedAt),
        );
        return bTime - aTime;
      });
  }, [registrations, search, statusFilter, sourceFilter]);

  // Per-source stats
  const sourceStats = useMemo(() => {
    const map: Record<string, { total: number; approved: number; pending: number }> = {};
    registrations.forEach((r) => {
      const key = r.sourceName || 'Unknown';
      if (!map[key]) map[key] = { total: 0, approved: 0, pending: 0 };
      map[key].total++;
      if (r.status?.toLowerCase() === 'approved') map[key].approved++;
      else if (!r.status || r.status?.toLowerCase() === 'pending') map[key].pending++;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [registrations]);

  const counts = useMemo(() => ({
    total: registrations.length,
    pending: registrations.filter((r) => !r.status || r.status?.toLowerCase() === 'pending').length,
    approved: registrations.filter((r) => r.status?.toLowerCase() === 'approved').length,
    rejected: registrations.filter((r) => r.status?.toLowerCase() === 'rejected').length,
  }), [registrations]);

  const approvedVisibleCount = useMemo(
    () => filtered.filter((r) => r.status?.toLowerCase() === 'approved').length,
    [filtered]
  );

  const handleApprove = async (reg: GoogleFormRegistration) => {
    setActionLoadingId(reg.id);
    try {
      const result = await approveGoogleFormRegistrationAction(reg.id, reg.eventCategory || '');
      if (result.success) {
        toast({ title: '✅ Approved', description: `Bib #${result.bibNumber} assigned to ${reg.name}.` });
        setRegistrations((prev) =>
          prev.map((r) => r.id === reg.id ? { ...r, status: 'approved', paymentStatus: 'paid', bibNumber: result.bibNumber } : r)
        );
      } else {
        toast({ variant: 'destructive', title: 'Failed', description: result.error });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not approve.' });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (reg: GoogleFormRegistration) => {
    setActionLoadingId(reg.id);
    try {
      const result = await rejectGoogleFormRegistrationAction(reg.id);
      if (result.success) {
        toast({ title: '🚫 Rejected', description: `${reg.name}'s registration rejected.` });
        setRegistrations((prev) => prev.map((r) => r.id === reg.id ? { ...r, status: 'rejected' } : r));
      } else {
        toast({ variant: 'destructive', title: 'Failed', description: result.error });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not reject.' });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleBulkResyncApproved = async () => {
    const targets = filtered.filter((r) => r.status?.toLowerCase() === 'approved');
    if (targets.length === 0) {
      toast({ title: 'No approved registrations', description: 'Apply filters or approve registrations first.' });
      return;
    }

    setIsBulkResyncing(true);
    let success = 0;
    let failed = 0;

    try {
      for (const reg of targets) {
        try {
          const res = await resyncGoogleFormRegistrationAction(reg.id, reg.eventCategory || '');
          if (res.success) success++;
          else failed++;
        } catch {
          failed++;
        }
      }

      await fetchRegistrations(false);
      toast({
        title: 'Resync completed',
        description: `${success} updated, ${failed} failed.`,
      });
    } finally {
      setIsBulkResyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch checked={autoFetchEnabled} onCheckedChange={setAutoFetchEnabled} id="auto-fetch-registrations" />
          <Label htmlFor="auto-fetch-registrations" className="text-sm text-muted-foreground">
            Auto fetch updates every 60s
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkResyncApproved}
            disabled={isBulkResyncing || approvedVisibleCount === 0}
            title="Re-sync currently visible approved registrations"
          >
            {isBulkResyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Resync Approved ({approvedVisibleCount})
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchRegistrations(true)} disabled={isLoading || isBulkResyncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: counts.total, color: 'text-foreground' },
          { label: 'Pending', value: counts.pending, color: 'text-yellow-500' },
          { label: 'Approved', value: counts.approved, color: 'text-green-500' },
          { label: 'Rejected', value: counts.rejected, color: 'text-red-500' },
        ].map((s) => (
          <Card key={s.label} className="text-center py-3">
            <CardContent className="p-0">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-Source Breakdown */}
      {sourceStats.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Partner / Source Breakdown</CardTitle>
            <CardDescription>Registrations by source channel</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {sourceStats.map(([name, stat]) => (
                <div
                  key={name}
                  className="flex items-center gap-3 border rounded-lg px-3 py-2 cursor-pointer hover:border-primary transition-colors"
                  onClick={() => setSourceFilter(sourceFilter === name ? 'all' : name)}
                  title={`Filter by ${name}`}
                >
                  <div>
                    <p className="text-sm font-semibold">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      {stat.total} total · {stat.approved} approved · {stat.pending} pending
                    </p>
                  </div>
                  {sourceFilter === name && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, phone, bib, category…"
                className="pl-9"
              />
            </div>
            {sourceNames.length > 0 && (
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-full sm:w-52">
                  <SelectValue placeholder="All Sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  {sourceNames.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Registrations
            <span className="ml-2 text-muted-foreground font-normal text-sm">({filtered.length} shown)</span>
          </CardTitle>
          {counts.pending > 0 && (
            <CardDescription className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400">
              <AlertTriangle className="h-4 w-4" />
              {counts.pending} registration{counts.pending !== 1 ? 's' : ''} pending review
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
              <ClipboardList className="h-10 w-10 opacity-30" />
              <p className="text-sm">No registrations found{search || statusFilter !== 'all' || sourceFilter !== 'all' ? ' matching your filters' : ''}.</p>
            </div>
          ) : (
            <div className={`overflow-x-auto ${filtered.length >= 10 ? 'max-h-[70vh] overflow-y-auto' : ''}`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Athlete</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Proof</TableHead>
                    <TableHead>Bib #</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((reg) => {
                    const isPending = !reg.status || reg.status?.toLowerCase() === 'pending';
                    const isApproved = reg.status?.toLowerCase() === 'approved';
                    const isRejected = reg.status?.toLowerCase() === 'rejected';
                    const isActioning = actionLoadingId === reg.id;

                    return (
                      <TableRow key={reg.id} className={isPending ? 'bg-yellow-50/40 dark:bg-yellow-900/10' : ''}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => setSelectedRegistration(reg)}
                            className="text-left hover:text-primary transition-colors"
                            title="View full form details"
                          >
                            <div className="font-medium underline-offset-2 hover:underline">{reg.name || '—'}</div>
                            {reg.email && <div className="text-xs text-muted-foreground">{reg.email}</div>}
                            {reg.phone && <div className="text-xs text-muted-foreground">{reg.phone}</div>}
                          </button>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{reg.eventCategory || '—'}</span>
                          {reg.eventName && <div className="text-xs text-muted-foreground">{reg.eventName}</div>}
                        </TableCell>
                        <TableCell>
                          {reg.sourceName ? (
                            <Badge variant="outline" className="text-xs font-normal">{reg.sourceName}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(reg.status)} className="capitalize">
                            {reg.status || 'Pending'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getPaymentVariant(reg.paymentStatus ?? '')} className="capitalize">
                            {reg.paymentStatus || '—'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <PaymentProofThumbnail url={reg.paymentProof} name={reg.name} />
                        </TableCell>
                        <TableCell>
                          {reg.bibNumber ? (
                            <span className="font-mono font-semibold text-primary">{reg.bibNumber}</span>
                          ) : (
                            <span className="text-muted-foreground text-xs italic">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {!isApproved && !isRejected && (
                              <>
                                <Button
                                  size="sm"
                                  className="h-8 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                                  onClick={() => handleApprove(reg)}
                                  disabled={isActioning}
                                >
                                  {isActioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-8 gap-1.5"
                                  onClick={() => handleReject(reg)}
                                  disabled={isActioning}
                                >
                                  {isActioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                                  Reject
                                </Button>
                              </>
                            )}
                            {isApproved && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1.5 border-green-500/40 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
                                onClick={async () => {
                                  setActionLoadingId(reg.id);
                                  try {
                                    const result = await resyncGoogleFormRegistrationAction(reg.id, reg.eventCategory || '');
                                    if (result.success) {
                                      toast({ title: '✅ Re-synced', description: `Bib #${result.bibNumber || 'N/A'} updated for ${reg.name}.` });
                                      setRegistrations((prev) =>
                                        prev.map((r) => r.id === reg.id ? { ...r, status: 'approved', paymentStatus: 'paid', bibNumber: result.bibNumber } : r)
                                      );
                                    } else {
                                      toast({ variant: 'destructive', title: 'Resync failed', description: result.error });
                                    }
                                  } catch {
                                    toast({ variant: 'destructive', title: 'Resync failed', description: 'Could not re-sync registration.' });
                                  } finally {
                                    setActionLoadingId(null);
                                  }
                                }}
                                disabled={isActioning}
                                title="Re-sync participant profile and correct fallback BIB if needed"
                              >
                                {isActioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                Re-sync
                              </Button>
                            )}
                            {isRejected && (
                              <span className="text-xs text-red-500 flex items-center gap-1">
                                <XCircle className="h-3.5 w-3.5" /> Rejected
                              </span>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() => setSelectedRegistration(reg)}
                              title="View full form details"
                            >
                              View
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedRegistration} onOpenChange={(open) => !open && setSelectedRegistration(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registration Details</DialogTitle>
            <DialogDescription>
              Full Google Form data for this registration.
            </DialogDescription>
          </DialogHeader>

          {selectedRegistration && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {[
                ['Name', selectedRegistration.name],
                ['Email', selectedRegistration.email],
                ['Phone', selectedRegistration.phone],
                ['Category', selectedRegistration.eventCategory],
                ['Event', selectedRegistration.eventName],
                ['Source', selectedRegistration.sourceName],
                ['Status', selectedRegistration.status],
                ['Payment Status', selectedRegistration.paymentStatus],
                ['BIB Number', selectedRegistration.bibNumber],
                ['DOB', (selectedRegistration as any).dob],
                ['Gender', (selectedRegistration as any).gender],
                ['Age Category', (selectedRegistration as any).ageCategory],
                ['Blood Group', (selectedRegistration as any).bloodGroup],
                ['T-shirt Size', (selectedRegistration as any).tshirtSize],
                ['Address', (selectedRegistration as any).address],
                ['City', (selectedRegistration as any).city],
                ['Pincode', (selectedRegistration as any).pincode],
                ['State', (selectedRegistration as any).state],
                ['Country', (selectedRegistration as any).country],
                ['Club / Group', (selectedRegistration as any).sourceClubName],
                ['Emergency Contact', (selectedRegistration as any).emergencyContactNumber],
                ['Timing Proof', (selectedRegistration as any).previousTimingCertificateUrl],
                ['ID Proof', (selectedRegistration as any).idProofUrl],
                ['Digital Signature', (selectedRegistration as any).digitalSignatureName],
                ['Imported At', String((selectedRegistration as any).importedAt || '')],
                ['Updated At', String((selectedRegistration as any).updatedAt || '')],
                ['Form ID', selectedRegistration.formId],
                ['Sheet ID', selectedRegistration.sheetId],
              ].map(([label, value]) => (
                <div key={label} className="rounded border p-2">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="font-medium break-all">{String(value || '—')}</div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRegistration(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

interface GoogleFormTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function GoogleFormTab({ events, isLoadingEvents }: GoogleFormTabProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          Google Form Registrations
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Map Google Forms to events, manage partner/source channels, and review incoming registrations.
        </p>
      </div>

      <Tabs defaultValue="mappings" className="w-full">
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="mappings" className="gap-1.5">
            <Link2 className="h-4 w-4" /> Form Mappings
          </TabsTrigger>
          <TabsTrigger value="registrations" className="gap-1.5">
            <ClipboardList className="h-4 w-4" /> Registrations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mappings" className="mt-6">
          <FormMappingsPanel events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>

        <TabsContent value="registrations" className="mt-6">
          <RegistrationsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
