// src/components/admin/ParticipantsTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import type {
  EventCalendarEntry,
  EventParticipant,
  ParticipantWithProfile,
  Club,
} from "@/lib/types";

import { useToast } from "@/hooks/use-toast";
import {
  getParticipantsPaginatedAction,
  updateParticipantInEventAction,
  sendIndividualConfirmationWhatsAppAction,
  sendIndividualConfirmationEmailAction,
  updateCategoryForParticipantAction,
  runDataSyncAction,
  syncClubDataForEventParticipantsAction,
  deleteParticipantFromEventAction,
  cancelParticipantRegistrationByAdminAction,
  assignMissingBibsAction,
  reassignDuplicateBibsAction,
} from "@/lib/actions";

import { getAllClubs } from "@/lib/actions/clubActions";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Loader2,
  Download,
  Trash2,
  RefreshCw,
  MessageSquare,
  Repeat,
  Eye,
  PencilLine,
  Search as SearchIcon,
  Mail,
  Ban,
  Pencil,
  Hash,
  AlertTriangle,
  ChevronRight,
  Building,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogClose } from "@/components/ui/dialog";
import ParticipantDetailView from "@/components/admin/ParticipantDetailView";
import ParticipantForm from "@/components/admin/ParticipantForm";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";

interface ParticipantsTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

export default function ParticipantsTab({
  events,
  isLoadingEvents,
  onDataRefresh,
}: ParticipantsTabProps) {
  const { toast } = useToast();

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantWithProfile[]>([]);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false);
  const [lastVisibleId, setLastVisibleId] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const [viewingParticipant, setViewingParticipant] = useState<EventParticipant | null>(null);
  const [allClubs, setAllClubs] = useState<Club[]>([]);

  const [participantSearchTerm, setParticipantSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ticketFilter, setTicketFilter] = useState("all");
  const [puneDeferredFilter, setPuneDeferredFilter] = useState("all");
  const [billingFilter, setBillingFilter] = useState("all");

  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingClubs, setIsSyncingClubs] = useState(false);
  const [isAssigningBibs, setIsAssigningBibs] = useState(false);
  const [isCleaningBibs, setIsCleaningBibs] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState<string | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState<string | null>(null);

  const [participantToEdit, setParticipantToEdit] = useState<EventParticipant | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [quickEditBib, setQuickEditBib] = useState<{ id: string; bib: string; name: string } | null>(null);
  const [quickEditAmount, setQuickEditAmount] = useState<{ id: string; amount: number; name: string } | null>(null);
  const [isSavingQuickEdit, setIsSavingQuickEdit] = useState(false);

  const [categoryChangeParticipant, setCategoryChangeTarget] = useState<EventParticipant | null>(null);
  const [newTicketId, setNewTicketId] = useState("");
  const [isProcessingCatChange, setIsProcessingCatChange] = useState(false);

  const [cancellationTarget, setCancellationTarget] = useState<EventParticipant | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [sendCancellationEmail, setSendCancellationEmail] = useState(true);
  const [isProcessingCancellation, setIsProcessingCancellation] = useState(false);

  useEffect(() => {
    getAllClubs().then(res => {
      if (res.success && res.clubs) setAllClubs(res.clubs);
    });
  }, []);

  const fetchParticipants = useCallback(async (eventId: string, lastId: string | null) => {
    setIsLoadingParticipants(true);
    try {
      const res = await getParticipantsPaginatedAction(eventId, 50, lastId);
      if (res && res.success && res.participants) {
        if (!lastId) {
          setParticipants(res.participants);
        } else {
          setParticipants(prev => {
              const existingIds = new Set(prev.map(p => p.id));
              const uniqueNew = res.participants!.filter(p => !existingIds.has(p.id));
              return [...prev, ...uniqueNew];
          });
        }
        setLastVisibleId(res.lastId || null);
        if (res.totalCount !== undefined) setTotalCount(res.totalCount);
      } else if (res && !res.success) {
          toast({ variant: 'destructive', title: 'Fetch Error', description: res.message });
      }
    } catch (err: any) {
        console.error("[ParticipantsTab] Fetch Error:", err);
    } finally {
      setIsLoadingParticipants(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedEventId) {
      setParticipants([]);
      setLastVisibleId(null);
      fetchParticipants(selectedEventId, null);
    } else {
      setParticipants([]);
      setTotalCount(0);
      setLastVisibleId(null);
    }
  }, [selectedEventId, fetchParticipants]);

  const hasMore = participants.length < totalCount;

  const loadMore = () => {
    if (selectedEventId && lastVisibleId) {
      fetchParticipants(selectedEventId, lastVisibleId);
    }
  };

  const refreshData = () => {
    if (selectedEventId) {
      setLastVisibleId(null);
      fetchParticipants(selectedEventId, null);
    }
  };

  const ticketOptions = useMemo(() => {
    if (!selectedEventId) return [];
    const event = events.find((e) => e.id === selectedEventId);
    return event?.ticketDefinitions || [];
  }, [selectedEventId, events]);

  const filteredParticipants = useMemo(() => {
    return participants
      .filter((p) => statusFilter === "all" || p.ticketStatus === statusFilter)
      .filter((p) => ticketFilter === "all" || p.ticketId === ticketFilter)
      .filter((p) => billingFilter === "all" || p.billingType === billingFilter)
      .filter((p) => {
        const isPune = p.previousDeferralDetails?.originalEventName?.toLowerCase().includes("pune");
        if (puneDeferredFilter === "all") return true;
        if (puneDeferredFilter === "yes") return !!isPune;
        if (puneDeferredFilter === "no") return !isPune;
        return true;
      })
      .filter((p) => {
        const term = participantSearchTerm.toLowerCase();
        return (
          !term ||
          p.name?.toLowerCase().includes(term) ||
          p.email?.toLowerCase().includes(term) ||
          p.bibNumber?.toLowerCase().includes(term) ||
          p.bookingId?.toLowerCase().includes(term)
        );
      });
  }, [participants, participantSearchTerm, statusFilter, ticketFilter, puneDeferredFilter, billingFilter]);

  const handleAssignMissingBibs = async () => {
    if (!selectedEventId) return;
    setIsAssigningBibs(true);
    const result = await assignMissingBibsAction(selectedEventId);
    if (result.success) {
      toast({ title: "BIB Assignment Complete", description: result.message });
      refreshData();
    } else {
      toast({ variant: "destructive", title: "Assignment Failed", description: result.message });
    }
    setIsAssigningBibs(false);
  };

  const handleRemoveDuplicateBibs = async () => {
    if (!selectedEventId) return;
    setIsCleaningBibs(true);
    const result = await reassignDuplicateBibsAction(selectedEventId);
    if (result.success) {
      toast({ title: "Cleanup Complete", description: result.message });
      refreshData();
    } else {
      toast({ variant: "destructive", title: "Cleanup Failed", description: result.message });
    }
    setIsCleaningBibs(false);
  };

  const handleSyncClubData = async () => {
      if (!selectedEventId) return;
      setIsSyncingClubs(true);
      const res = await syncClubDataForEventParticipantsAction(selectedEventId);
      if (res.success) {
          toast({ title: "Clubs Synced", description: res.message });
          refreshData();
      } else {
          toast({ variant: "destructive", title: "Sync Failed", description: res.message });
      }
      setIsSyncingClubs(false);
  };

  const handleSendWhatsApp = async (participant: EventParticipant) => {
    if (!selectedEventId) return;
    setIsSendingWhatsApp(participant.id);
    const result = await sendIndividualConfirmationWhatsAppAction(selectedEventId, participant.id);
    if (result.success) {
      toast({ title: "WhatsApp Sent", description: `Confirmation sent to ${participant.name}` });
    } else {
      toast({ variant: "destructive", title: "Failed", description: result.message });
    }
    setIsSendingWhatsApp(null);
  };

  const handleSendEmail = async (participant: EventParticipant) => {
    if (!selectedEventId) return;
    setIsSendingEmail(participant.id);
    const result = await sendIndividualConfirmationEmailAction(selectedEventId, participant.id);
    if (result.success) {
      toast({ title: "Email Sent", description: `Confirmation resent to ${participant.email}` });
    } else {
      toast({ variant: "destructive", title: "Failed", description: result.message });
    }
    setIsSendingEmail(null);
  };

  const handleEditSubmit = async (data: any) => {
    if (!selectedEventId || !participantToEdit) return;
    setIsSavingEdit(true);
    const result = await updateParticipantInEventAction(selectedEventId, participantToEdit.id, data);
    if (result.success) {
      toast({ title: "Participant Updated" });
      setParticipantToEdit(null);
      refreshData();
    } else {
      toast({ variant: "destructive", title: "Update Failed", description: result.message });
    }
    setIsSavingEdit(false);
  };

  const handleCancelRegistration = async () => {
    if (!selectedEventId || !cancellationTarget) return;
    setIsProcessingCancellation(true);
    const result = await cancelParticipantRegistrationByAdminAction(
      selectedEventId,
      cancellationTarget.id,
      cancellationReason,
      sendCancellationEmail
    );
    if (result.success) {
      toast({ title: "Registration Cancelled" });
      setCancellationTarget(null);
      setCancellationReason("");
      refreshData();
    } else {
      toast({ variant: "destructive", title: "Cancellation Failed", description: result.message });
    }
    setIsProcessingCancellation(false);
  };

  const handleDeleteParticipant = async (participantId: string) => {
    if (!selectedEventId) return;
    const result = await deleteParticipantFromEventAction(selectedEventId, participantId);
    if (result.success) {
      toast({ title: "Removed from Event" });
      refreshData();
    } else {
      toast({ variant: "destructive", title: "Error", description: result.message });
    }
  };

  const handleCategoryChange = async () => {
    if (!selectedEventId || !categoryChangeParticipant || !newTicketId) return;
    setIsProcessingCatChange(true);
    const result = await updateCategoryForParticipantAction(selectedEventId, categoryChangeParticipant.id, newTicketId);
    if (result.success) {
      toast({ title: "Category Updated", description: result.message });
      setCategoryChangeTarget(null);
      setNewTicketId("");
      refreshData();
    } else {
      toast({ variant: "destructive", title: "Error", description: result.message });
    }
    setIsProcessingCatChange(false);
  };

  const saveQuickEditBib = async () => {
    if (!selectedEventId || !quickEditBib) return;
    setIsSavingQuickEdit(true);
    const result = await updateParticipantInEventAction(selectedEventId, quickEditBib.id, { bibNumber: quickEditBib.bib });
    if (result.success) {
      toast({ title: "BIB Updated" });
      setQuickEditBib(null);
      refreshData();
    } else {
      toast({ variant: "destructive", title: "Error", description: result.message });
    }
    setIsSavingQuickEdit(false);
  };

  const saveQuickEditAmount = async () => {
    if (!selectedEventId || !quickEditAmount) return;
    setIsSavingQuickEdit(true);
    const result = await updateParticipantInEventAction(selectedEventId, quickEditAmount.id, { amountPaidPaisa: Math.round(quickEditAmount.amount * 100) });
    if (result.success) {
      toast({ title: "Amount Updated" });
      setQuickEditAmount(null);
      refreshData();
    } else {
      toast({ variant: "destructive", title: "Error", description: result.message });
    }
    setIsSavingQuickEdit(false);
  };

  const handleSyncKV = async () => {
    if (!selectedEventId) return;
    setIsSyncing(true);
    const result = await runDataSyncAction("registrations", selectedEventId);
    if (result.success) {
      toast({ title: "Sync Triggered", description: "Background job started." });
    } else {
      toast({ variant: "destructive", title: "Sync Failed", description: result.message });
    }
    setIsSyncing(false);
  };

  const handleDownload = () => {
    if (!selectedEventId) return;
    window.location.href = `/api/admin/download-participants?eventId=${selectedEventId}`;
  };

  const formatCurrency = (paisa: number | null | undefined) => {
    if (paisa === null || paisa === undefined) return "₹0";
    return `₹${(paisa / 100).toLocaleString("en-IN")}`;
  };

  return (
    <>
      <Card>
        <CardHeader className="text-left">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div>
              <CardTitle>Participants List ({totalCount})</CardTitle>
              <CardDescription>View and manage registrations. Showing {participants.length} of {totalCount}.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 w-full lg:w-auto">
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={!selectedEventId}>
                <Download className="h-4 w-4 mr-2" />
                Download List
              </Button>
              <Button size="sm" variant="outline" onClick={handleSyncKV} disabled={isSyncing || !selectedEventId}>
                {isSyncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Sync to KV
              </Button>
              <Button size="sm" variant="outline" onClick={handleAssignMissingBibs} disabled={isAssigningBibs || !selectedEventId}>
                {isAssigningBibs ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Hash className="h-4 w-4 mr-2"/>}
                Assign Missing BIBs
              </Button>
              <Button size="sm" variant="outline" onClick={handleRemoveDuplicateBibs} disabled={isCleaningBibs || !selectedEventId}>
                {isCleaningBibs ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Trash2 className="h-4 w-4 mr-2"/>}
                Remove Duplicate BIBs
              </Button>
              <Button size="sm" variant="outline" onClick={handleSyncClubData} disabled={!selectedEventId || isSyncingClubs}>
                {isSyncingClubs ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Building className="h-4 w-4 mr-2"/>}
                Sync Club Data
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select onValueChange={(value) => setSelectedEventId(value || null)} disabled={isLoadingEvents} value={selectedEventId ?? ""}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="1. Select Event..." />
              </SelectTrigger>
              <SelectContent>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedEventId && (
              <div className="flex gap-2">
                <Input
                  placeholder="Search current batch..."
                  value={participantSearchTerm}
                  onChange={(e) => setParticipantSearchTerm(e.target.value)}
                  className="flex-grow"
                />
                <Button variant="outline" onClick={refreshData} disabled={isLoadingParticipants}>
                  <RefreshCw className={cn("h-4 w-4", isLoadingParticipants && "animate-spin")} />
                </Button>
              </div>
            )}
          </div>

          {selectedEventId && (
            <>
              <div className="flex flex-wrap gap-2 pt-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px] text-xs h-8">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Cancelled">Cancelled</SelectItem>
                    <SelectItem value="Deferred">Deferred</SelectItem>
                    <SelectItem value="Refunded">Refunded</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={ticketFilter} onValueChange={setTicketFilter}>
                  <SelectTrigger className="w-[220px] text-xs h-8">
                    <SelectValue placeholder="Ticket Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {ticketOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.ticketName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={billingFilter} onValueChange={setBillingFilter}>
                  <SelectTrigger className="w-[140px] text-xs h-8">
                    <SelectValue placeholder="Billing Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Billing: All</SelectItem>
                    <SelectItem value="personal">Individual (B2C)</SelectItem>
                    <SelectItem value="business">Business (B2B)</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={puneDeferredFilter} onValueChange={setPuneDeferredFilter}>
                  <SelectTrigger className="w-[140px] text-xs h-8">
                    <SelectValue placeholder="From Pune" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Pune Deferral: All</SelectItem>
                    <SelectItem value="yes">Pune: Yes</SelectItem>
                    <SelectItem value="no">Pune: No</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="border rounded-md overflow-auto bg-background max-h-[60vh] custom-scrollbar">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-10 shadow-sm">
                    <TableRow className="text-[11px] uppercase tracking-wider">
                      <TableHead>Athlete / Business</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>BIB</TableHead>
                      <TableHead>Ticket</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Club</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Def.</TableHead>
                      <TableHead>Pune</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Registered</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredParticipants.length === 0 && !isLoadingParticipants ? (
                      <TableRow>
                        <TableCell colSpan={12} className="h-32 text-center text-muted-foreground italic">
                          No participants found for this event.
                        </TableCell>
                      </TableRow>
                    ) : filteredParticipants.map((p) => {
                        const isBusiness = p.billingType === 'business';
                        const isPune = p.previousDeferralDetails?.originalEventName?.toLowerCase().includes("pune");
                        const hasDeferral = p.isDeferral === true || !!p.previousDeferralDetails || !!p.deferralId;
                        return (
                          <TableRow key={p.id} className="text-xs hover:bg-muted/30 group">
                            <TableCell className="font-medium">
                              <button 
                                onClick={() => setViewingParticipant(p)}
                                className="text-primary hover:underline transition-colors text-left font-bold"
                              >
                                {p.name}
                              </button>
                              {isBusiness && (
                                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground uppercase font-black tracking-tight">
                                  <Building className="h-2.5 w-2.5" /> {p.businessName}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {p.email}<br />{p.mobile}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 font-mono">
                                {p.bibNumber || "—"}
                                <button
                                  onClick={() => setQuickEditBib({ id: p.id, bib: p.bibNumber || "", name: p.name })}
                                  className="text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <PencilLine className="h-3 w-3" />
                                </button>
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{p.ticketName}</TableCell>
                            <TableCell>
                              <Badge variant={p.ticketStatus === "Active" ? "default" : "secondary"} className="text-[10px] px-1.5 h-5">
                                {p.ticketStatus}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground truncate max-w-[120px]" title={p.clubName || ""}>
                              {p.clubName || "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {formatCurrency(p.amountPaidPaisa)}
                                <button
                                  onClick={() => setQuickEditAmount({ id: p.id, amount: (p.amountPaidPaisa || 0) / 100, name: p.name })}
                                  className="text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <PencilLine className="h-3 w-3" />
                                </button>
                              </div>
                            </TableCell>
                            <TableCell>
                                {hasDeferral ? <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-200">Yes</Badge> : "—"}
                            </TableCell>
                            <TableCell>
                                {isPune ? <Badge variant="outline" className="bg-sky-50 text-sky-600 border-sky-200">Yes</Badge> : "—"}
                            </TableCell>
                            <TableCell>
                              {isBusiness ? (
                                <Badge variant="outline" className="border-primary text-primary h-5 text-[9px] uppercase font-black">B2B</Badge>
                              ) : (
                                <Badge variant="outline" className="h-5 text-[9px] uppercase font-black text-muted-foreground">B2C</Badge>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {p.registeredAt ? format(parseISO(p.registeredAt), "dd/MM/yy") : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewingParticipant(p)} title="View Detail"><Eye className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setParticipantToEdit(p)} title="Full Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  onClick={() => handleSendEmail(p)}
                                  disabled={isSendingEmail === p.id}
                                  title="Resend Email"
                                >
                                  {isSendingEmail === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => handleSendWhatsApp(p)}
                                  disabled={isSendingWhatsApp === p.id || !p.mobile}
                                  title="Resend WhatsApp"
                                >
                                  {isSendingWhatsApp === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                  onClick={() => setCategoryChangeTarget(p)}
                                  title="Change Category"
                                >
                                  <Repeat className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                  onClick={() => setCancellationTarget(p)}
                                  disabled={p.ticketStatus === 'Cancelled'}
                                  title="Cancel Registration"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      title="Delete Record"
                                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete {p.name}?</AlertDialogTitle>
                                      <AlertDialogDescription>This will permanently delete the registration record from this event. This is irreversible.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDeleteParticipant(p.id)} className="bg-destructive hover:bg-destructive/90">Delete Record</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    {isLoadingParticipants && (
                      <TableRow>
                        <TableCell colSpan={12} className="h-24 text-center">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              
              {hasMore && (
                <div className="flex justify-center pt-4">
                  <Button variant="outline" onClick={loadMore} disabled={isLoadingParticipants}>
                    {isLoadingParticipants ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ChevronRight className="h-4 w-4 mr-2" />}
                    Load More Participants
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* FULL EDIT MODAL */}
      <Dialog open={!!participantToEdit} onOpenChange={(o) => !o && !isSavingEdit && setParticipantToEdit(null)} modal={!isSavingEdit}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col text-left overflow-hidden" onPointerDownOutside={(e) => { if (isSavingEdit) e.preventDefault(); }} onInteractOutside={(e) => { if (isSavingEdit) e.preventDefault(); }}>
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Edit Athlete Profile: {participantToEdit?.name}</DialogTitle>
            <DialogDescription>Update all registration details for this athlete.</DialogDescription>
          </DialogHeader>
          {participantToEdit && selectedEventId && events.find(e => e.id === selectedEventId) && (
            <ParticipantForm 
              eventDetails={events.find(e => e.id === selectedEventId)!}
              editingParticipant={participantToEdit}
              onIdProofFileChange={() => {}}
              isLoading={isSavingEdit}
              allClubs={allClubs}
              onSubmitCallback={handleEditSubmit}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* QUICK EDIT BIB MODAL */}
      <Dialog open={!!quickEditBib} onOpenChange={(o) => !o && setQuickEditBib(null)}>
        <DialogContent className="sm:max-w-xs text-left">
          <DialogHeader><DialogTitle>Edit BIB: {quickEditBib?.name}</DialogTitle></DialogHeader>
          <div className="py-4 space-y-2">
            <Label>New BIB Number</Label>
            <Input
              value={quickEditBib?.bib || ""}
              onChange={(e) => setQuickEditBib(prev => prev ? { ...prev, bib: e.target.value } : null)}
              placeholder="Enter BIB..."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setQuickEditBib(null)}>Cancel</Button>
            <Button onClick={saveQuickEditBib} disabled={isSavingQuickEdit}>
              {isSavingQuickEdit && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QUICK EDIT AMOUNT MODAL */}
      <Dialog open={!!quickEditAmount} onOpenChange={(o) => !o && setQuickEditAmount(null)}>
        <DialogContent className="sm:max-w-xs text-left">
          <DialogHeader><DialogTitle>Edit Amount: {quickEditAmount?.name}</DialogTitle></DialogHeader>
          <div className="py-4 space-y-2">
            <Label>Amount Paid (INR)</Label>
            <Input
              type="number"
              value={quickEditAmount?.amount || 0}
              onChange={(e) => setQuickEditAmount(prev => prev ? { ...prev, amount: Number(e.target.value) } : null)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => quickEditAmount && setQuickEditAmount(null)}>Cancel</Button>
            <Button onClick={saveQuickEditAmount} disabled={isSavingQuickEdit}>
              {isSavingQuickEdit && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CANCELLATION MODAL */}
      <Dialog open={!!cancellationTarget} onOpenChange={(o) => !o && setCancellationTarget(null)}>
        <DialogContent className="sm:max-w-md text-left">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <Ban className="h-5 w-5" /> Cancel Registration
            </DialogTitle>
            <DialogDescription>
              Mark <strong>{cancellationTarget?.name}</strong> as cancelled. This will release their BIB and invalidate their ticket.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Reason for Cancellation</Label>
              <Textarea 
                placeholder="e.g., Medical emergency, personal request..." 
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox 
                id="send-cancel-email" 
                checked={sendCancellationEmail} 
                onCheckedChange={(v) => setSendCancellationEmail(!!v)} 
              />
              <Label htmlFor="send-cancel-email" className="text-xs font-normal cursor-pointer">
                Notify athlete via email
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancellationTarget(null)}>Back</Button>
            <Button 
              variant="destructive" 
              onClick={handleCancelRegistration} 
              disabled={isProcessingCancellation || !cancellationReason.trim()}
            >
              {isProcessingCancellation && <Loader2 className="animate-spin mr-2 h-4 w-4" />} Confirm Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CATEGORY CHANGE MODAL */}
      <Dialog open={!!categoryChangeParticipant} onOpenChange={(o) => !o && setCategoryChangeTarget(null)}>
        <DialogContent className="text-left">
          <DialogHeader>
            <DialogTitle>Change Category: {categoryChangeParticipant?.name}</DialogTitle>
            <DialogDescription>
              Switch the athlete to a different race category. A new BIB will be automatically assigned.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="p-3 bg-muted rounded-md text-xs">
              Current: <strong>{categoryChangeParticipant?.ticketName}</strong> (BIB: {categoryChangeParticipant?.bibNumber || "None"})
            </div>
            <div className="space-y-2">
              <Label>Select New Category</Label>
              <Select value={newTicketId} onValueChange={setNewTicketId}>
                <SelectTrigger><SelectValue placeholder="Choose ticket..." /></SelectTrigger>
                <SelectContent>
                  {ticketOptions.filter(t => t.id !== categoryChangeParticipant?.ticketId).map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.ticketName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCategoryChangeTarget(null)}>Cancel</Button>
            <Button onClick={handleCategoryChange} disabled={isProcessingCatChange || !newTicketId}>
              {isProcessingCatChange && <Loader2 className="animate-spin mr-2 h-4 w-4" />} Update Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DETAIL MODAL */}
      <Dialog open={!!viewingParticipant} onOpenChange={(open) => !open && setViewingParticipant(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Participant Details</DialogTitle></DialogHeader>
          <div className="py-4">
            {viewingParticipant && <ParticipantDetailView participant={viewingParticipant} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
