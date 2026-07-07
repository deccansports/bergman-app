// src/components/admin/TicketsTab.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useForm, useFieldArray, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import {
  Ticket,
  PlusCircle,
  Trash2,
  Loader2,
  Save,
  ArrowUp,
  ArrowDown,
  Copy,
  CalendarDays,
  Hourglass,
  Clock,
} from "lucide-react";

import {
  addTicketDefinitionAction,
  updateTicketDefinitionAction,
  deleteTicketDefinitionAction,
  updateTicketOrderAction,
  cloneTicketDataAction,
} from "@/lib/actions";

import type {
  EventCalendarEntry,
  TicketDefinition,
  PricingTier,
  SwimDistanceCategory,
} from "@/lib/types";

import {
  TicketDefinitionSchema,
  type TicketDefinitionFormInput,
} from "@/lib/schemas";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogFooter,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isDuathlonEvent } from "@/lib/utils";
import { startOfDay, parseISO, format, isValid, parse } from "date-fns";

const getCurrencySymbol = (currency?: string | null) => (currency || 'INR').toUpperCase() === 'USD' ? '$' : '₹';

const formatCurrency = (paisa: number | null | undefined, currency?: string | null) => {
  const code = (currency || 'INR').toUpperCase();
  const symbol = getCurrencySymbol(code);
  const locale = code === 'USD' ? 'en-US' : 'en-IN';
  if (paisa === null || paisa === undefined) return `${symbol}0.00`;
  return `${symbol}${(paisa / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatRegistrationEnd = (ticket: TicketDefinition) => {
  if (!ticket.closeDate) return 'No end date';

  const parsedCloseDate = parseISO(ticket.closeDate);
  const formattedDate = isValid(parsedCloseDate)
    ? format(parsedCloseDate, 'dd MMM yyyy')
    : ticket.closeDate;

  return ticket.endTime ? `${formattedDate} • ${ticket.endTime}` : formattedDate;
};

const formatRegistrationStart = (ticket: TicketDefinition) => {
  if (!ticket.openDate) return 'No start date';

  const parsedOpenDate = parseISO(ticket.openDate);
  const formattedDate = isValid(parsedOpenDate)
    ? format(parsedOpenDate, 'dd MMM yyyy')
    : ticket.openDate;

  return ticket.startTime ? `${formattedDate} • ${ticket.startTime}` : formattedDate;
};

const hasTicketSaleEnded = (ticket: TicketDefinition) => {
  if (!ticket.closeDate) return false;

  const endDateTime = parse(
    `${ticket.closeDate} ${ticket.endTime || '23:59'}`,
    'yyyy-MM-dd HH:mm',
    new Date()
  );

  if (!isValid(endDateTime)) return false;
  return new Date() > endDateTime;
};

const getTicketStatus = (ticket: TicketDefinition): { label: string; variant: 'default' | 'destructive' | 'secondary' } => {
  if (ticket.isSoldOut) {
    return { label: 'Sold Out', variant: 'destructive' };
  }

  if (hasTicketSaleEnded(ticket)) {
    return { label: 'Sale Ended', variant: 'secondary' };
  }

  return { label: 'Active', variant: 'default' };
};

function TierDatePicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value?: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selectedDate = value ? parseISO(value) : undefined;
  const validDate = selectedDate && isValid(selectedDate) ? selectedDate : undefined;
  const displayLabel = validDate ? format(validDate, 'dd MMM yyyy') : 'Select date';

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-8 w-full justify-between px-2 text-xs"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        >
          <span className={`truncate ${validDate ? '' : 'text-muted-foreground'}`}>{displayLabel}</span>
          <CalendarDays className="ml-2 h-3.5 w-3.5 shrink-0 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 z-[9999]"
        align="start"
        side="bottom"
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label || 'Select date'}
        </div>
        <Calendar
          mode="single"
          selected={validDate}
          onSelect={(date) => {
            onChange(date ? format(date, 'yyyy-MM-dd') : '');
            setOpen(false);
          }}
          defaultMonth={validDate}
        />
        {validDate && (
          <div className="border-t p-2 flex justify-between items-center">
            <span className="text-xs text-muted-foreground">{format(validDate, 'dd MMM yyyy')}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive"
              onClick={() => { onChange(''); setOpen(false); }}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface TicketsTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

export default function TicketsTab({
  events,
  isLoadingEvents,
  onDataRefresh,
}: TicketsTabProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const isViewOnlyAdmin = !!(currentUser?.isAdmin && currentUser?.adminAccessMode === 'view');

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [localTickets, setLocalTickets] = useState<TicketDefinition[]>([]);
  const [editingTicket, setEditingTicket] = useState<TicketDefinition | null>(null);
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);

  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [cloneTargetTicketId, setCloneTargetTicketId] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [sourceEventId, setSourceEventId] = useState<string | null>(null);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId),
    [events, selectedEventId]
  );
  const selectedEventCurrency = (selectedEvent?.currency || 'INR').toUpperCase();
  const selectedEventCurrencySymbol = getCurrencySymbol(selectedEventCurrency);
  const selectedEventMinorUnitLabel = selectedEventCurrency === 'USD' ? 'Cents' : 'Paisa';

  const sortedEvents = useMemo(() => {
    const today = startOfDay(new Date());
    
    const upcoming: EventCalendarEntry[] = [];
    const past: EventCalendarEntry[] = [];
    
    events.forEach(event => {
      const eventDate = event.eventDate ? startOfDay(parseISO(event.eventDate)) : null;
      if (eventDate && eventDate >= today) {
        upcoming.push(event);
      } else {
        past.push(event);
      }
    });
    
    // Sort upcoming by date ascending (earliest first)
    upcoming.sort((a, b) => {
      const aDate = a.eventDate ? startOfDay(parseISO(a.eventDate)) : null;
      const bDate = b.eventDate ? startOfDay(parseISO(b.eventDate)) : null;
      if (aDate && bDate) return aDate.getTime() - bDate.getTime();
      if (aDate) return -1;
      if (bDate) return 1;
      return 0;
    });
    
    // Sort past by date descending (latest first, so 2025, 2024, 2023, etc.)
    past.sort((a, b) => {
      const aDate = a.eventDate ? startOfDay(parseISO(a.eventDate)) : null;
      const bDate = b.eventDate ? startOfDay(parseISO(b.eventDate)) : null;
      if (aDate && bDate) return bDate.getTime() - aDate.getTime();
      if (aDate) return 1;
      if (bDate) return -1;
      return 0;
    });
    
    return [...upcoming, ...past];
  }, [events]);

  useEffect(() => {
    if (selectedEvent?.ticketDefinitions) {
      const sorted = [...selectedEvent.ticketDefinitions].sort(
        (a, b) => (a.order || 0) - (b.order || 0)
      );
      setLocalTickets(sorted);
    } else {
      setLocalTickets([]);
    }
  }, [selectedEvent]);

  const form = useForm<TicketDefinitionFormInput>({
    resolver: zodResolver(TicketDefinitionSchema),
    defaultValues: {
      ticketName: "",
      description: "",
      registrationType: "individual",
      eventDate: "",
      openDate: "",
      raceStartTime: "",
      closeDate: "",
      price: 0,
      ticketType: "Paid",
      maxQuantity: undefined,
      isSoldOut: false,
      isHidden: false,
      hasFinisherJersey: false,
      ticketCategory: "Triathlon",
      order: 0,
      tiers: [],
      subCategories: [],
      applicableAgeGroups: "",
      hsnCode: "",
      gstPercent: undefined,
      cutoffs: {
        mode: 'overall',
        overall: '',
        swim: '',
        bike: '',
        run: '',
        run1: '',
        run2: '',
      },
    },
  });

  const { fields: tierFields, append: appendTier, remove: removeTier } =
    useFieldArray({
      control: form.control,
      name: "tiers",
    });

  const { fields: subCategoryFields, append: appendSubCategory, remove: removeSubCategory } =
    useFieldArray({
      control: form.control,
      name: "subCategories",
    });

  useEffect(() => {
    if (isTicketModalOpen && editingTicket) {
      form.reset({
        ticketName: editingTicket.ticketName,
        description: editingTicket.description || "",
        registrationType: editingTicket.registrationType || "individual",
        eventDate: editingTicket.eventDate || "",
        openDate: editingTicket.openDate || "",
        raceStartTime: editingTicket.raceStartTime || editingTicket.startTime || "",
        closeDate: editingTicket.closeDate || "",
        endTime: editingTicket.endTime || "",
        price: editingTicket.price ? editingTicket.price / 100 : 0,
        ticketType: editingTicket.ticketType,
        maxQuantity: editingTicket.maxQuantity || undefined,
        isSoldOut: editingTicket.isSoldOut || false,
        isHidden: editingTicket.isHidden || false,
        hasFinisherJersey: editingTicket.hasFinisherJersey || false,
        ticketCategory: editingTicket.ticketCategory || "Triathlon",
        order: editingTicket.order || 0,
        tiers: editingTicket.tiers || [],
        subCategories: editingTicket.subCategories?.map(s => ({
            ...s,
            applicableAgeGroups: Array.isArray(s.applicableAgeGroups) ? s.applicableAgeGroups.join(', ') : (s.applicableAgeGroups || ""),
            cutoff: s.cutoff || ""
        })) || [],
        applicableAgeGroups: Array.isArray(editingTicket.applicableAgeGroups) 
          ? editingTicket.applicableAgeGroups.join(", ") 
          : (editingTicket.applicableAgeGroups || ""),
        hsnCode: editingTicket.hsnCode || "",
        gstPercent: editingTicket.gstPercent ?? (selectedEventCurrency === 'USD' ? undefined : 18),
        cutoffs: editingTicket.cutoffs || {
          mode: 'overall',
          overall: '',
          swim: '',
          bike: '',
          run: '',
          run1: '',
          run2: '',
        },
      });
    } else if (isTicketModalOpen && !editingTicket) {
      form.reset({
        ticketName: "",
        description: "",
        registrationType: "individual",
        eventDate: "",
        openDate: "",
        raceStartTime: "",
        closeDate: "",
        endTime: "",
        price: 0,
        ticketType: "Paid",
        isSoldOut: false,
        isHidden: false,
        hasFinisherJersey: false,
        ticketCategory: "Triathlon",
        order: 0,
        tiers: [],
        subCategories: [],
        applicableAgeGroups: "",
        hsnCode: "",
        gstPercent: selectedEventCurrency === 'USD' ? undefined : 18,
        cutoffs: {
          mode: 'overall',
          overall: '',
          swim: '',
          bike: '',
          run: '',
          run1: '',
          run2: '',
        },
      });
    }
  }, [editingTicket, isTicketModalOpen, form, selectedEventCurrency]);

  const onTicketSubmit: SubmitHandler<TicketDefinitionFormInput> = async (data) => {
    if (!selectedEventId) return;
    setIsSubmitting(true);

    const ageGroupsArray = typeof data.applicableAgeGroups === 'string' 
      ? data.applicableAgeGroups.split(",").map((s: string) => s.trim()).filter(Boolean)
      : (data.applicableAgeGroups || []);

    const payload: Partial<TicketDefinition> = {
      ...data,
      price: data.ticketType === "Paid" ? (data.price || 0) * 100 : null,
      applicableAgeGroups: ageGroupsArray,
      gstPercent: selectedEventCurrency === 'USD'
        ? (data.gstPercent === null || data.gstPercent === undefined || data.gstPercent === ('' as any) ? undefined : Number(data.gstPercent))
        : (data.gstPercent === null || data.gstPercent === undefined ? 18 : Number(data.gstPercent)), 
      tiers: (data.tiers || []).map((t: any) => ({ ...t, pricePaisa: Number(t.pricePaisa) })),
      subCategories: (data.subCategories || []).map((s: any) => {
          const catAgeGroups = Array.isArray(s.applicableAgeGroups) ? s.applicableAgeGroups : (typeof s.applicableAgeGroups === 'string' ? s.applicableAgeGroups.split(',').map((ss: string) => ss.trim()) : []);
          return {
            ...s,
            pricePaisa: Number(s.pricePaisa),
            applicableAgeGroups: catAgeGroups,
            cutoff: s.cutoff || null,
            tiers: (s.tiers || []).map((st: any) => ({ ...st, pricePaisa: Number(st.pricePaisa) }))
          }
      }),
    };

    try {
      const result = editingTicket
        ? await updateTicketDefinitionAction(selectedEventId, editingTicket.id, payload)
        : await addTicketDefinitionAction(selectedEventId, data);

      if (result.success) {
        toast({ title: "Success", description: result.message });
        onDataRefresh();
        setIsTicketModalOpen(false);
        setEditingTicket(null);
      } else {
        toast({ variant: "destructive", title: "Error", description: result.message });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloneTicketData = async (sourceTicketId: string) => {
      if (!sourceEventId || !cloneTargetTicketId || !selectedEventId) return;
      setIsCloning(true);
      try {
        const result = await cloneTicketDataAction(sourceEventId, sourceTicketId, selectedEventId, cloneTargetTicketId);
        if (result.success) {
            toast({ title: 'Success', description: 'Data cloned successfully.' });
            onDataRefresh(); 
            setIsCloneModalOpen(false);
            setCloneTargetTicketId(null);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
      } finally {
        setIsCloning(false);
      }
  };

  const handleDeleteTicket = async (ticketId: string) => {
    if (!selectedEventId) return;
    const result = await deleteTicketDefinitionAction(selectedEventId, ticketId);
    if (result.success) {
      toast({ title: "Success", description: result.message });
      onDataRefresh();
    }
  };

  const handleMove = (index: number, direction: "up" | "down") => {
    const newTickets = [...localTickets];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= newTickets.length) return;
    const temp = newTickets[index];
    newTickets[index] = newTickets[newIndex];
    newTickets[newIndex] = temp;
    setLocalTickets(newTickets);
  };

  const handleSaveOrder = async () => {
    if (!selectedEventId) return;
    setIsOrdering(true);
    const orderData = localTickets.map((t, i) => ({ id: t.id, order: i }));
    const result = await updateTicketOrderAction(selectedEventId, orderData);
    if (result.success) {
      toast({ title: "Order Saved", description: result.message });
      onDataRefresh();
    }
    setIsOrdering(false);
  };

  const isDua = isDuathlonEvent(form.watch("ticketName"));
  const getTicketRegistrationType = (ticket: TicketDefinition): 'individual' | 'relay' | 'both' => {
    if (ticket.registrationType === 'individual' || ticket.registrationType === 'relay' || ticket.registrationType === 'both') {
      return ticket.registrationType;
    }
    const looksLikeRelay = /\brelay\b/i.test(ticket.ticketName || '') || /\brelay\b/i.test(ticket.description || '');
    return looksLikeRelay ? 'relay' : 'individual';
  };

  return (
    <div className="space-y-6 text-left">
      <Card>
        <CardHeader className="flex flex-col lg:flex-row items-start lg:items-center justify-between text-left gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-left">
              <Ticket className="h-5 w-5 text-primary" />
              Ticket Definitions
            </CardTitle>
            <CardDescription className="text-left">
              Define ticket types, pricing tiers, and distance categories.
            </CardDescription>
          </div>
          {selectedEventId && (
            <Button size="sm" onClick={() => { setEditingTicket(null); setIsTicketModalOpen(true); }} disabled={isViewOnlyAdmin}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Ticket
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={selectedEventId || ""} onValueChange={setSelectedEventId}>
            <SelectTrigger className="w-full md:w-1/2">
              <SelectValue placeholder="Select Event" />
            </SelectTrigger>
            <SelectContent>
              {sortedEvents.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedEventId && (
            <div className="border rounded-md overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Order</TableHead>
                    <TableHead>Ticket Name</TableHead>
                    <TableHead>Registration</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Base Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {localTickets.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground italic">No tickets defined.</TableCell></TableRow>
                  ) : localTickets.map((ticket, index) => (
                    <TableRow key={ticket.id}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={index === 0} onClick={() => handleMove(index, "up")}>
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={index === localTickets.length - 1} onClick={() => handleMove(index, "down")}>
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="font-bold">{ticket.ticketName}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline" className="w-fit capitalize">
                            {getTicketRegistrationType(ticket) === 'both'
                              ? 'Both'
                              : getTicketRegistrationType(ticket)}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            Starts: {formatRegistrationStart(ticket)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            Ends: {formatRegistrationEnd(ticket)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{ticket.eventDate || 'Same as Event'}</TableCell>
                      <TableCell><Badge variant="secondary">{ticket.ticketCategory}</Badge></TableCell>
                      <TableCell>{formatCurrency(ticket.price, selectedEventCurrency)}</TableCell>
                      <TableCell>
                        {(() => {
                          const status = getTicketStatus(ticket);
                          return <Badge variant={status.variant}>{status.label}</Badge>;
                        })()}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Dialog 
                          open={isCloneModalOpen && cloneTargetTicketId === ticket.id} 
                          onOpenChange={(open) => { if (!open) setCloneTargetTicketId(null); else { setIsCloneModalOpen(true); setCloneTargetTicketId(ticket.id); } }}
                        >
                          <DialogTrigger asChild><Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Clone Config"><Copy className="h-4 w-4"/></Button></DialogTrigger>
                          <DialogContent className="text-left">
                            <DialogHeader className="text-left"><DialogTitle className="text-left">Clone Configuration to {ticket.ticketName}</DialogTitle></DialogHeader>
                            <div className="py-4 space-y-4 text-left">
                                <Select onValueChange={setSourceEventId} disabled={isLoadingEvents}>
                                    <SelectTrigger><SelectValue placeholder="Select Source Event..." /></SelectTrigger>
                                    <SelectContent>{events.map(e => ( e.id !== selectedEventId && <SelectItem key={`clone-${e.id}`} value={e.id}>{e.eventName}</SelectItem> ))}</SelectContent>
                                </Select>
                                <Select onValueChange={(val) => handleCloneTicketData(val)} disabled={!sourceEventId}>
                                    <SelectTrigger><SelectValue placeholder="Select Source Ticket..." /></SelectTrigger>
                                    <SelectContent>{(events.find(e => e.id === sourceEventId)?.ticketDefinitions || []).map(t => ( <SelectItem key={`clone-t-${t.id}`} value={t.id}>{t.ticketName}</SelectItem> ))}</SelectContent>
                                </Select>
                            </div>
                            <DialogFooter className="text-left"><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose></DialogFooter>
                          </DialogContent>
                        </Dialog>
                        <Button size="sm" variant="outline" onClick={() => { setEditingTicket(ticket); setIsTicketModalOpen(true); }} disabled={isViewOnlyAdmin}>Edit</Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="sm" variant="destructive" disabled={isViewOnlyAdmin}>Delete</Button></AlertDialogTrigger>
                          <AlertDialogContent className="text-left">
                            <AlertDialogHeader className="text-left">
                              <AlertDialogTitle className="text-left">Delete {ticket.ticketName}?</AlertDialogTitle>
                              <AlertDialogDescription className="text-left">This will remove the ticket definition and cannot be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="text-left">
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteTicket(ticket.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        {selectedEventId && localTickets.length > 0 && (
          <CardFooter className="flex justify-end border-t pt-4">
            <Button size="sm" variant="outline" onClick={handleSaveOrder} disabled={isOrdering}>
              {isOrdering ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="mr-2 h-4 w-4" />}
              Save Display Order
            </Button>
          </CardFooter>
        )}
      </Card>

      <Dialog open={isTicketModalOpen} onOpenChange={setIsTicketModalOpen}>
        <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2 text-left flex-shrink-0">
            <DialogTitle className="text-left">{editingTicket ? "Edit" : "Add"} Ticket Definition</DialogTitle>
            <DialogDescription className="text-left">Configure pricing, tiers, and sale dates.</DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="flex-1 px-6 overflow-y-auto">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onTicketSubmit)} className="space-y-6 text-left py-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                  <FormField control={form.control} name="ticketName" render={({ field }) => (<FormItem className="text-left"><FormLabel className="text-left">Ticket Name*</FormLabel><FormControl><Input {...field} placeholder="e.g., Olympic Triathlon" disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="ticketCategory" render={({ field }) => (
                    <FormItem className="text-left"><FormLabel className="text-left">Category*</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""} disabled={isSubmitting}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select..."/></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="Triathlon">Triathlon</SelectItem>
                          <SelectItem value="Duathlon">Duathlon</SelectItem>
                          <SelectItem value="Marathon">Marathon</SelectItem>
                          <SelectItem value="Cycling">Cycling</SelectItem>
                          <SelectItem value="Swimming">Swimming</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem className="text-left">
                    <FormLabel className="text-left">Ticket Description (Optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ""} placeholder="Brief description shown to participants (e.g., eligibility criteria, special notes)" disabled={isSubmitting} rows={2} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                  <FormField control={form.control} name="registrationType" render={({ field }) => (
                    <FormItem className="text-left">
                      <FormLabel className="text-left">Registration Type*</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || 'individual'} disabled={isSubmitting}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select registration type"/></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="individual">Individual only</SelectItem>
                          <SelectItem value="relay">Relay only</SelectItem>
                          <SelectItem value="both">Both (Individual + Relay)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription className="text-[10px]">
                        Choose who can use this ticket.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                    <FormField control={form.control} name="eventDate" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="flex items-center gap-2">
                                <CalendarDays className="h-4 w-4 text-primary" />
                                Race Date (Optional)
                            </FormLabel>
                            <FormControl><Input type="date" {...field} value={field.value ?? ""} disabled={isSubmitting} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="raceStartTime" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="flex items-center gap-2">
                                <Clock className="h-4 w-4 text-primary" />
                                Race Start Time (Optional)
                            </FormLabel>
                            <FormControl><Input type="time" {...field} value={field.value ?? ""} disabled={isSubmitting} /></FormControl>
                            <FormDescription className="text-[10px]">Official race gun-start time (24-hour). Powers the countdown timer on the live tracking page.</FormDescription>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                    <FormField control={form.control} name="openDate" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Sale Start Date*</FormLabel>
                            <FormControl><Input type="date" {...field} value={field.value ?? ""} disabled={isSubmitting} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="closeDate" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Sale End Date*</FormLabel>
                            <FormControl><Input type="date" {...field} value={field.value ?? ""} disabled={isSubmitting} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="endTime" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Sale End Time (Optional)</FormLabel>
                            <FormControl><Input type="time" {...field} value={field.value ?? ""} disabled={isSubmitting} /></FormControl>
                            <FormDescription className="text-[10px]">24-hour format. Defaults to 23:59 if not set.</FormDescription>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left p-4 bg-muted/20 rounded-xl border border-dashed">
                  <FormField control={form.control} name="hsnCode" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-bold text-xs uppercase text-primary">HSN / SAC Code</FormLabel>
                      <FormControl><Input {...field} value={field.value ?? ""} placeholder="e.g. 999652" disabled={isSubmitting} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="gstPercent" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-bold text-xs uppercase text-primary">{selectedEventCurrency === 'USD' ? 'Tax Percentage (%)' : 'GST Percentage (%)'}</FormLabel>
                      <FormControl><Input type="number" {...field} value={field.value ?? ""} placeholder={selectedEventCurrency === 'USD' ? 'Optional' : '18'} onChange={e => field.onChange(e.target.value === '' ? null : Number(e.target.value))} disabled={isSubmitting}/></FormControl>
                      <FormDescription className="text-[10px]">{selectedEventCurrency === 'USD' ? 'Optional for USD events.' : 'Defaults to 18% for INR events.'}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                  <FormField control={form.control} name="ticketType" render={({ field }) => (
                    <FormItem className="text-left"><FormLabel className="text-left">Type*</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="Paid">Paid</SelectItem>
                          <SelectItem value="Free">Free</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  {form.watch('ticketType') === 'Paid' && (
                    <FormField control={form.control} name="price" render={({ field }) => (<FormItem className="text-left"><FormLabel className="text-left">Base Price ({selectedEventCurrencySymbol})*</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} onChange={e => field.onChange(Number(e.target.value))} /></FormControl><FormDescription className="text-[10px]">Currency: {selectedEventCurrency}</FormDescription></FormItem>)} />
                  )}
                  <FormField control={form.control} name="maxQuantity" render={({ field }) => (<FormItem className="text-left"><FormLabel className="text-left">Total Slots (Optional)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === '' ? null : Number(e.target.value))} /></FormControl></FormItem>)} />
                </div>

                <FormField control={form.control} name="applicableAgeGroups" render={({ field }) => (<FormItem className="text-left"><FormLabel className="text-left">Eligible Age Groups (CSV)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="e.g., 18-30, 31-40, 41-50, Above 51" /></FormControl><FormMessage /></FormItem>)} />

                <Separator />

                <div className="space-y-4 pt-4 border-t border-dashed text-left">
                  <h4 className="font-bold text-sm uppercase tracking-widest text-primary flex items-center gap-2">
                    <Hourglass className="h-4 w-4" /> Cut-off Timings
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField control={form.control} name="cutoffs.mode" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-bold uppercase text-left">Cut-off Tracking Mode</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || 'overall'}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="overall">Overall Finish Time Only</SelectItem>
                            <SelectItem value="segment">By Individual Segment (Intermediate)</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />

                    {form.watch('cutoffs.mode') === 'overall' ? (
                      <FormField control={form.control} name="cutoffs.overall" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-bold uppercase text-left">Overall Finish Cut-off</FormLabel>
                          <FormControl><Input {...field} value={field.value ?? ""} placeholder="HH:MM:SS (e.g. 08:30:00)" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    ) : (
                      <div className="grid grid-cols-2 gap-4 md:col-span-2 p-4 bg-muted/30 rounded-xl text-left">
                        {!isDua ? (
                          <>
                            <FormField control={form.control} name="cutoffs.swim" render={({ field }) => (
                              <FormItem><FormLabel className="text-[10px] font-black uppercase text-left">Swim Cut-off</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="HH:MM:SS"/></FormControl></FormItem>
                            )} />
                            <FormField control={form.control} name="cutoffs.bike" render={({ field }) => (
                              <FormItem><FormLabel className="text-[10px] font-black uppercase text-left">Bike Finish (Cum.)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="HH:MM:SS"/></FormControl></FormItem>
                            )} />
                            <FormField control={form.control} name="cutoffs.run" render={({ field }) => (
                              <FormItem><FormLabel className="text-[10px] font-black uppercase text-left">Overall Finish</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="HH:MM:SS"/></FormControl></FormItem>
                            )} />
                          </>
                        ) : (
                          <>
                            <FormField control={form.control} name="cutoffs.run1" render={({ field }) => (
                              <FormItem><FormLabel className="text-[10px] font-black uppercase text-left">Run 1 Cut-off</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="HH:MM:SS"/></FormControl></FormItem>
                            )} />
                            <FormField control={form.control} name="cutoffs.bike" render={({ field }) => (
                              <FormItem><FormLabel className="text-[10px] font-black uppercase text-left">Bike Finish (Cum.)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="HH:MM:SS"/></FormControl></FormItem>
                            )} />
                            <FormField control={form.control} name="cutoffs.run2" render={({ field }) => (
                              <FormItem><FormLabel className="text-[10px] font-black uppercase text-left">Overall Finish</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="HH:MM:SS"/></FormControl></FormItem>
                            )} />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                <div className="space-y-4 text-left">
                  <div className="flex items-center justify-between text-left">
                    <h4 className="font-bold text-sm uppercase tracking-widest text-primary text-left">Main Ticket Pricing Tiers</h4>
                    <Button type="button" variant="outline" size="sm" onClick={() => appendTier({ name: '', pricePaisa: 0 })}>
                      <PlusCircle className="mr-2 h-4 w-4" />Add Tier
                    </Button>
                  </div>
                  {tierFields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-3 border rounded-lg bg-muted/30 text-left">
                      <FormField control={form.control} name={`tiers.${index}.name`} render={({ field }) => (<FormItem className="text-left"><FormLabel className="text-xs text-left">Tier Name</FormLabel><Input {...field} placeholder="Early Bird" /></FormItem>)} />
                      <FormField control={form.control} name={`tiers.${index}.pricePaisa`} render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel className="text-xs text-left">Price ({selectedEventMinorUnitLabel})</FormLabel>
                          <Input type="number" {...field} value={field.value ?? ""} onChange={e => field.onChange(Number(e.target.value))} />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`tiers.${index}.slotLimit`} render={({ field }) => (<FormItem className="text-left"><FormLabel className="text-xs text-left">Slot Limit</FormLabel><Input type="number" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === '' ? null : Number(e.target.value))} /></FormItem>)} />
                      <div className="flex gap-2 text-left">
                        <FormField control={form.control} name={`tiers.${index}.endDate`} render={({ field }) => (
                          <FormItem className="flex-1 text-left">
                            <FormLabel className="text-xs text-left">End Date</FormLabel>
                            <FormControl>
                              <TierDatePicker
                                value={field.value || ''}
                                onChange={field.onChange}
                                disabled={isSubmitting}
                                label="Tier End Date"
                              />
                            </FormControl>
                          </FormItem>
                        )} />
                        <Button type="button" variant="ghost" size="icon" className="text-destructive h-10 w-10 shrink-0" onClick={() => removeTier(index)}><Trash2 className="h-4 w-4"/></Button>
                      </div>
                    </div>
                  ))}
                </div>

                <Separator />

                {form.watch('ticketCategory') === 'Swimming' && (
                    <div className="space-y-6 pt-4 text-left">
                        <div className="flex items-center justify-between text-left">
                            <h4 className="font-bold text-sm uppercase tracking-widest text-primary text-left">Distance Categories (Swimathon)</h4>
                            <Button type="button" variant="outline" size="sm" onClick={() => appendSubCategory({ id: `sub-${Date.now()}`, name: '', pricePaisa: 0, applicableAgeGroups: '', cutoff: '' })}>
                                <PlusCircle className="mr-2 h-4 w-4"/>Add Distance
                            </Button>
                        </div>
                        {subCategoryFields.map((field, index) => (
                            <div key={field.id} className="p-4 border-2 rounded-xl space-y-4 bg-primary/5 text-left">
                                <div className="flex justify-between items-center text-left">
                                    <h5 className="font-black uppercase text-xs text-primary">Distance #{index + 1}</h5>
                                    <Button type="button" variant="ghost" size="sm" className="text-destructive h-8 px-2" onClick={() => removeSubCategory(index)}><Trash2 className="h-4 w-4 mr-1.5"/>Remove Distance</Button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-left">
                                    <FormField control={form.control} name={`subCategories.${index}.name`} render={({ field }) => (<FormItem><FormLabel className="text-xs">Distance Name</FormLabel><Input {...field} placeholder="500 Mtrs" /></FormItem>)} />
                                    <FormField control={form.control} name={`subCategories.${index}.pricePaisa`} render={({ field }) => (<FormItem><FormLabel className="text-xs">Base Price ({selectedEventMinorUnitLabel})</FormLabel><Input type="number" {...field} value={field.value ?? 0} onChange={e => field.onChange(Number(e.target.value))} /></FormItem>)} />
                                    <FormField control={form.control} name={`subCategories.${index}.applicableAgeGroups`} render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs">Age Groups (CSV)</FormLabel>
                                            <Input {...field} value={field.value ?? ""} placeholder="e.g., 10-12, 13-15" />
                                        </FormItem>
                                    )} />
                                    <FormField control={form.control} name={`subCategories.${index}.cutoff`} render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs">Distance Cutoff (HH:MM:SS)</FormLabel>
                                            <Input {...field} value={field.value ?? ""} placeholder="HH:MM:SS" />
                                        </FormItem>
                                    )} />
                                </div>
                                
                                <div className="space-y-3 pt-2 text-left">
                                    <div className="flex items-center justify-between text-left">
                                        <Label className="text-[10px] font-black uppercase text-muted-foreground">Sub-Category Tiers</Label>
                                        <Button type="button" variant="ghost" size="xs" className="h-6 text-[9px] uppercase font-bold" onClick={() => {
                                            const current = form.getValues(`subCategories.${index}.tiers`) || [];
                                            form.setValue(`subCategories.${index}.tiers`, [...current, { name: '', pricePaisa: 0, slotLimit: null, endDate: null }]);
                                        }}>+ Add Tier</Button>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        {(form.watch(`subCategories.${index}.tiers`) || []).map((tier: any, tIdx: number) => (
                                            <div key={tIdx} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end p-2 bg-background rounded-lg border text-left">
                                                <div className="space-y-1">
                                                    <Label className="text-[10px] uppercase font-bold">Tier Name</Label>
                                                    <Input className="h-8 text-xs" placeholder="Tier Name" value={tier.name} onChange={e => {
                                                        const tiers = [...(form.getValues(`subCategories.${index}.tiers`) || [])];
                                                        tiers[tIdx].name = e.target.value;
                                                        form.setValue(`subCategories.${index}.tiers`, tiers);
                                                    }} />
                                                </div>
                                                <div className="space-y-1">
                                                  <Label className="text-[10px] uppercase font-bold">Price ({selectedEventMinorUnitLabel})</Label>
                                                  <Input type="number" className="h-8 text-xs" placeholder={`Price (${selectedEventMinorUnitLabel})`} value={tier.pricePaisa} onChange={e => {
                                                        const tiers = [...(form.getValues(`subCategories.${index}.tiers`) || [])];
                                                        tiers[tIdx].pricePaisa = Number(e.target.value);
                                                        form.setValue(`subCategories.${index}.tiers`, tiers);
                                                    }} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-[10px] uppercase font-bold">End Date / Slots</Label>
                                                    <div className="grid grid-cols-2 gap-1">
                                                    <TierDatePicker value={tier.endDate || ''} onChange={(value) => {
                                                            const tiers = [...(form.getValues(`subCategories.${index}.tiers`) || [])];
                                                      tiers[tIdx].endDate = value;
                                                            form.setValue(`subCategories.${index}.tiers`, tiers);
                                                    }} label="Tier End Date" />
                                                        <Input type="number" className="h-8 text-xs" placeholder="Slots" value={tier.slotLimit || ''} onChange={e => {
                                                            const tiers = [...(form.getValues(`subCategories.${index}.tiers`) || [])];
                                                            tiers[tIdx].slotLimit = Number(e.target.value);
                                                            form.setValue(`subCategories.${index}.tiers`, tiers);
                                                        }} />
                                                    </div>
                                                </div>
                                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive ml-auto" onClick={() => {
                                                    const tiers = (form.getValues(`subCategories.${index}.tiers`) || []).filter((_: any, i: number) => i !== tIdx);
                                                    form.setValue(`subCategories.${index}.tiers`, tiers);
                                                }}><Trash2 className="h-3.5 w-3.5"/></Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex flex-wrap gap-x-10 gap-y-4 pt-4 text-left border-t">
                  <FormField control={form.control} name="isSoldOut" render={({ field }) => (<FormItem className="flex items-center gap-2 space-y-0 text-left"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="font-bold cursor-pointer uppercase text-xs">Sold Out</FormLabel></FormItem>)} />
                  <FormField control={form.control} name="isHidden" render={({ field }) => (<FormItem className="flex items-center gap-2 space-y-0 text-left"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="font-bold cursor-pointer uppercase text-xs">Hidden</FormLabel></FormItem>)} />
                  <FormField control={form.control} name="hasFinisherJersey" render={({ field }) => (<FormItem className="flex items-center gap-2 space-y-0 text-left"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="font-bold cursor-pointer uppercase text-xs">Includes Jersey</FormLabel></FormItem>)} />
                </div>
              </form>
            </Form>
          </ScrollArea>

          <DialogFooter className="p-6 border-t bg-muted/30 flex-shrink-0 text-left">
            <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
            <Button onClick={form.handleSubmit(onTicketSubmit)} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Ticket Definition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
