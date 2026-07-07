// src/components/admin/ParticipantsTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import type {
  EventCalendarEntry,
  EventParticipant,
  ParticipantWithProfile,
  Club,
  TicketDefinition,
} from "@/lib/types";

import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import {
  getParticipantsPaginatedAction,
  updateParticipantInEventAction,
  sendIndividualConfirmationWhatsAppAction,
  sendIndividualConfirmationEmailAction,
  updateCategoryForParticipantAction,
  getTicketDefinitionsForEventAction,
  runDataSyncAction,
  syncClubDataForEventParticipantsAction,
  deleteParticipantFromEventAction,
  cancelParticipantRegistrationByAdminAction,
  transferParticipantToEventAction,
  assignMissingBibsAction,
  reassignDuplicateBibsAction,
  findUserForParticipantRegistrationAction,
  registerParticipantFromDatabaseAction,
  repairLegacyParticipantsMirrorAction,
  getBelSeasonLeaderboardAction,
  verifyParticipantIntegrityAction,
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
  UserPlus,
  ArrowRightLeft,
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
import { format, parseISO, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
import { GST_PERCENTAGE } from "@/lib/constants";
import { INDIAN_STATES, USA_STATES } from "@/lib/constants";

const BEL_SEASON = 2025;

interface ParticipantsTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

function getParticipantDedupKey(participant: any, fallbackIndex: number): string {
  const normalize = (value: any) => String(value || '').trim().toLowerCase();
  const registrationId = normalize(participant?.registrationId);
  if (registrationId) return `registration:${registrationId}`;

  const bookingId = normalize(participant?.bookingId);
  if (bookingId) return `booking:${bookingId}`;

  const participantId = normalize(participant?.participantId || participant?.id);
  if (participantId) return `participant:${participantId}`;

  const bibNumber = normalize(participant?.bibNumber);
  if (bibNumber) return `bib:${bibNumber}`;

  return `fallback:${fallbackIndex}`;
}

function dedupeParticipants<T extends Record<string, any>>(items: T[]): T[] {
  const merged = new Map<string, T>();
  items.forEach((participant, index) => {
    const key = getParticipantDedupKey(participant, index);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, ...participant });
      return;
    }
    merged.set(key, participant);
  });
  return Array.from(merged.values());
}

function debugParticipants(
  firestoreParticipants: any[] = [],
  kvParticipants: any[] = [],
  feibotParticipants: any[] = [],
  athleteMasterParticipants: any[] = [],
  liveTrackingParticipants: any[] = [],
  finalParticipants: any[] = []
) {
  const analyse = (name: string, list: any[]) => {
    const ids = list
      .map((p) => String(p?.bookingId || p?.registrationId || p?.participantId || p?.id || '').trim())
      .filter(Boolean);
    const unique = new Set(ids);
    return {
      name,
      total: ids.length,
      unique: unique.size,
      duplicates: ids.length - unique.size,
    };
  };

  const summary = {
    firestore: firestoreParticipants.length,
    kv: kvParticipants.length,
    feibot: feibotParticipants.length,
    athleteMaster: athleteMasterParticipants.length,
    liveTracking: liveTrackingParticipants.length,
    final: finalParticipants.length,
    analysis: [
      analyse('Firestore', firestoreParticipants),
      analyse('KV', kvParticipants),
      analyse('Feibot', feibotParticipants),
      analyse('AthleteMaster', athleteMasterParticipants),
      analyse('LiveTracking', liveTrackingParticipants),
      analyse('Final', finalParticipants),
    ],
  };

  console.log('========================================');
  console.log('BERGMAN PARTICIPANT DEBUG');
  console.log(summary);
  console.log('========================================');
}

export default function ParticipantsTab({
  events,
  isLoadingEvents,
  onDataRefresh,
}: ParticipantsTabProps) {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const isViewOnlyAdmin = !!(currentUser?.isAdmin && currentUser?.adminAccessMode === 'view');

  const blockIfReadOnly = useCallback(() => {
    if (!isViewOnlyAdmin) return false;
    toast({
      variant: 'destructive',
      title: 'View-only admin',
      description: 'Your admin access is view-only. Editing and downloads are disabled.',
    });
    return true;
  }, [isViewOnlyAdmin, toast]);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantWithProfile[]>([]);
  const [belLookup, setBelLookup] = useState<Map<string, string>>(new Map());
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false);
  const [lastVisibleId, setLastVisibleId] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [sourceCountMeta, setSourceCountMeta] = useState<{ source: 'kv' | 'firestore' | null; rawTotalCount: number; dedupedTotalCount: number }>({
    source: null,
    rawTotalCount: 0,
    dedupedTotalCount: 0,
  });

  const [viewingParticipant, setViewingParticipant] = useState<EventParticipant | null>(null);
  const [allClubs, setAllClubs] = useState<Club[]>([]);

  const [participantSearchTerm, setParticipantSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ticketFilter, setTicketFilter] = useState("all");
  const [ageCategoryFilter, setAgeCategoryFilter] = useState("all");
  const [puneDeferredFilter, setPuneDeferredFilter] = useState("all");
  const [billingFilter, setBillingFilter] = useState("all");
  const [clubFilter, setClubFilter] = useState("all");
  const [belTierFilter, setBelTierFilter] = useState("all");

  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingClubs, setIsSyncingClubs] = useState(false);
  const [isAssigningBibs, setIsAssigningBibs] = useState(false);
  const [isCleaningBibs, setIsCleaningBibs] = useState(false);
  const [isVerifyingIntegrity, setIsVerifyingIntegrity] = useState(false);
  const [isRepairingLegacyMirror, setIsRepairingLegacyMirror] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState<string | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState<string | null>(null);

  const [participantToEdit, setParticipantToEdit] = useState<EventParticipant | null>(null);
  const [editingIdProofFile, setEditingIdProofFile] = useState<File | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [quickEditBib, setQuickEditBib] = useState<{ id: string; bib: string; name: string } | null>(null);
  const [quickEditAmount, setQuickEditAmount] = useState<{ id: string; amount: number; name: string; currency: 'INR' | 'USD' } | null>(null);
  const [isSavingQuickEdit, setIsSavingQuickEdit] = useState(false);

  const [categoryChangeParticipant, setCategoryChangeTarget] = useState<EventParticipant | null>(null);
  const [newTicketId, setNewTicketId] = useState("");
  const [newSubCategory, setNewSubCategory] = useState<string>("");
  const [isProcessingCatChange, setIsProcessingCatChange] = useState(false);
  const [categoryChangeTicketOptions, setCategoryChangeTicketOptions] = useState<TicketDefinition[]>([]);

  const [cancellationTarget, setCancellationTarget] = useState<EventParticipant | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [sendCancellationEmail, setSendCancellationEmail] = useState(true);
  const [isProcessingCancellation, setIsProcessingCancellation] = useState(false);

  const [transferTarget, setTransferTarget] = useState<EventParticipant | null>(null);
  const [transferTargetEventId, setTransferTargetEventId] = useState("");
  const [transferTargetTicketId, setTransferTargetTicketId] = useState("");
  const [transferTargetSubCategoryId, setTransferTargetSubCategoryId] = useState("");
  const [transferTicketOptions, setTransferTicketOptions] = useState<TicketDefinition[]>([]);
  const [transferAdminNote, setTransferAdminNote] = useState("");
  const [transferConfirmPaymentReceived, setTransferConfirmPaymentReceived] = useState(false);
  const [transferSendConfirmation, setTransferSendConfirmation] = useState(true);
  const [isProcessingTransfer, setIsProcessingTransfer] = useState(false);

  const [isAddFromDatabaseOpen, setIsAddFromDatabaseOpen] = useState(false);
  const [dbSearchEmail, setDbSearchEmail] = useState('');
  const [isSearchingDbUser, setIsSearchingDbUser] = useState(false);
  const [searchedDbUser, setSearchedDbUser] = useState<any | null>(null);
  const [manualTicketId, setManualTicketId] = useState('');
  const [manualSubCategoryId, setManualSubCategoryId] = useState('');
  const [manualAmountInr, setManualAmountInr] = useState<string>('');
  const [manualPaymentMethod, setManualPaymentMethod] = useState('Offline/Admin Manual');
  const [manualTransactionId, setManualTransactionId] = useState('');
  const [manualSendConfirmations, setManualSendConfirmations] = useState(false);
  const [manualIdProofFile, setManualIdProofFile] = useState<File | null>(null);
  const [manualReplaceIdProof, setManualReplaceIdProof] = useState(false);
  const [manualParticipantDetails, setManualParticipantDetails] = useState({
    name: '',
    mobile: '',
    dob: '',
    gender: '',
    bloodGroup: '',
    tshirtSize: '',
    idProofUrl: '',
    emergencyContactNumber: '',
    address: '',
    city: '',
    state: '',
    country: '',
    pincode: '',
  });
  const [isRegisteringFromDb, setIsRegisteringFromDb] = useState(false);

  useEffect(() => {
    getAllClubs().then(res => {
      if (res.success && res.clubs) setAllClubs(res.clubs);
    });
  }, []);

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
    let mounted = true;

    async function loadBelLookup() {
      const result = await getBelSeasonLeaderboardAction(BEL_SEASON);
      if (!mounted || !result.success) return;

      const lookup = new Map<string, string>();
      (result.rankings || []).forEach((athlete) => {
        if (athlete.athleteId) lookup.set(`uid:${athlete.athleteId}`, athlete.belTier);
        if (athlete.email) lookup.set(`email:${athlete.email.toLowerCase()}`, athlete.belTier);
        if (athlete.mobile) lookup.set(`mobile:${String(athlete.mobile).replace(/\D/g, '')}`, athlete.belTier);
      });
      setBelLookup(lookup);
    }

    loadBelLookup();
    return () => {
      mounted = false;
    };
  }, []);

  const fetchParticipants = useCallback(async (eventId: string, lastId: string | null, forceRefresh: boolean = false) => {
    setIsLoadingParticipants(true);
    try {
      const res = await getParticipantsPaginatedAction(eventId, 50, lastId, forceRefresh);
      if (res && res.success && res.participants) {
        const sourceRows = Array.isArray(res.participants) ? res.participants : [];
        const firestoreParticipants = res.source === 'firestore' ? sourceRows : [];
        const kvParticipants = res.source === 'kv' ? sourceRows : [];

        console.log('[ParticipantsTab] source-counts-before-merge', {
          eventId,
          source: res.source || 'unknown',
          firestoreRegistrations: res.source === 'firestore' ? Number(res.rawTotalCount || sourceRows.length) : 0,
          kvParticipants: res.source === 'kv' ? Number(res.rawTotalCount || sourceRows.length) : 0,
          feibotParticipants: 0,
          athleteMasterParticipants: 0,
          liveTrackingParticipants: 0,
          incomingPageCount: sourceRows.length,
          totalCount: Number(res.totalCount || 0),
          dedupedTotalCount: Number(res.dedupedTotalCount || 0),
        });

        if (!lastId) {
          console.log('[ParticipantsTab] merged-participant-count', {
            mode: 'replace',
            mergedParticipantCount: sourceRows.length,
          });
          setParticipants(res.participants);
        } else {
          setParticipants(prev => {
              const existingIds = new Set(prev.map(p => p.id));
              const uniqueNew = res.participants!.filter(p => !existingIds.has(p.id));
              const mergedParticipants = [...prev, ...uniqueNew];
              console.log('[ParticipantsTab] merged-participant-count', {
                mode: 'append',
                previousCount: prev.length,
                incomingCount: sourceRows.length,
                uniqueIncomingCount: uniqueNew.length,
                mergedParticipantCount: mergedParticipants.length,
              });
              return mergedParticipants;
          });
        }

        debugParticipants(
          firestoreParticipants,
          kvParticipants,
          [],
          [],
          [],
          !lastId ? sourceRows : []
        );

        setLastVisibleId(res.lastId || null);
        if (res.totalCount !== undefined) setTotalCount(res.totalCount);
        setSourceCountMeta({
          source: res.source || null,
          rawTotalCount: Number(res.rawTotalCount || 0),
          dedupedTotalCount: Number(res.dedupedTotalCount || res.totalCount || 0),
        });
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
      fetchParticipants(selectedEventId, null, false);
    } else {
      setParticipants([]);
      setTotalCount(0);
      setLastVisibleId(null);
    }
  }, [selectedEventId, fetchParticipants]);

  useEffect(() => {
    if (!selectedEventId) return;

    const interval = setInterval(() => {
      setLastVisibleId(null);
      fetchParticipants(selectedEventId, null, false);
    }, 20000);

    return () => clearInterval(interval);
  }, [selectedEventId, fetchParticipants]);

  useEffect(() => {
    const loadTickets = async () => {
      if (!selectedEventId) {
        setCategoryChangeTicketOptions([]);
        return;
      }
      const res = await getTicketDefinitionsForEventAction(selectedEventId);
      if (res.success && res.ticketDefinitions) {
        setCategoryChangeTicketOptions(res.ticketDefinitions);
      }
    };
    loadTickets();
  }, [selectedEventId]);

  useEffect(() => {
    const loadTransferTickets = async () => {
      if (!transferTargetEventId) {
        setTransferTicketOptions([]);
        return;
      }
      const res = await getTicketDefinitionsForEventAction(transferTargetEventId);
      if (res.success && res.ticketDefinitions) {
        setTransferTicketOptions(res.ticketDefinitions);
      } else {
        setTransferTicketOptions([]);
      }
    };
    loadTransferTickets();
  }, [transferTargetEventId]);

  const hasMore = Boolean(lastVisibleId);
  const uniqueParticipants = useMemo(() => dedupeParticipants(participants), [participants]);
  const displayTotalCount = hasMore ? Math.max(totalCount, uniqueParticipants.length) : uniqueParticipants.length;

  const loadMore = () => {
    if (selectedEventId && lastVisibleId) {
      fetchParticipants(selectedEventId, lastVisibleId);
    }
  };

  const refreshData = () => {
    if (selectedEventId) {
      setLastVisibleId(null);
      fetchParticipants(selectedEventId, null, false);
    }
  };

  const selectedEventCurrency = useMemo<'INR' | 'USD'>(() => {
    const eventCurrency = (events.find((e) => e.id === selectedEventId)?.currency || 'INR').toUpperCase();
    return eventCurrency === 'USD' ? 'USD' : 'INR';
  }, [events, selectedEventId]);

  const getParticipantCurrency = useCallback((participant?: ParticipantWithProfile | EventParticipant | null): 'INR' | 'USD' => {
    if (!participant) return selectedEventCurrency;
    const direct = String((participant as any)?.currency || '').toUpperCase();
    if (direct === 'USD' || direct === 'INR') return direct;

    const breakdown = String((participant as any)?.pricingBreakdown?.currency || '').toUpperCase();
    if (breakdown === 'USD' || breakdown === 'INR') return breakdown;

    const paymentMethod = String((participant as any)?.paymentMethod || '').toLowerCase();
    if (paymentMethod.includes('stripe')) return 'USD';

    return selectedEventCurrency;
  }, [selectedEventCurrency]);

  const ticketOptions = useMemo(() => {
    if (categoryChangeTicketOptions.length > 0) return categoryChangeTicketOptions;
    if (!selectedEventId) return [];
    const event = events.find((e) => e.id === selectedEventId);
    return event?.ticketDefinitions || [];
  }, [selectedEventId, events, categoryChangeTicketOptions]);

  const selectedNewTicket = useMemo(() => {
    return ticketOptions.find(t => t.id === newTicketId);
  }, [newTicketId, ticketOptions]);

  const availableSubCategories = useMemo(() => {
    return selectedNewTicket?.subCategories || [];
  }, [selectedNewTicket]);

  const selectedTransferTicket = useMemo(() => {
    return transferTicketOptions.find((t) => t.id === transferTargetTicketId);
  }, [transferTicketOptions, transferTargetTicketId]);

  const availableTransferSubCategories = useMemo(() => {
    return selectedTransferTicket?.subCategories || [];
  }, [selectedTransferTicket]);

  const transferTargetPricePaisa = useMemo(() => {
    if (!selectedTransferTicket) return 0;
    if (transferTargetSubCategoryId) {
      const sub = selectedTransferTicket.subCategories?.find((s) => s.id === transferTargetSubCategoryId);
      if (sub) return Number(sub.pricePaisa || 0);
    }
    return Number(selectedTransferTicket.price || 0);
  }, [selectedTransferTicket, transferTargetSubCategoryId]);

  const transferTargetCurrency = useMemo<'INR' | 'USD'>(() => {
    const eventCurrency = (events.find((e) => e.id === transferTargetEventId)?.currency || selectedEventCurrency).toUpperCase();
    return eventCurrency === 'USD' ? 'USD' : 'INR';
  }, [events, transferTargetEventId, selectedEventCurrency]);

  const transferTargetTaxPercent = useMemo(() => {
    if (transferTargetCurrency === 'USD') return 0;
    const ticketTax = Number(selectedTransferTicket?.gstPercent);
    return Number.isFinite(ticketTax) && ticketTax > 0 ? ticketTax : GST_PERCENTAGE;
  }, [selectedTransferTicket, transferTargetCurrency]);

  const transferTargetGstPaisa = useMemo(() => {
    if (transferTargetTaxPercent <= 0) return 0;
    return Math.round(transferTargetPricePaisa * (transferTargetTaxPercent / 100));
  }, [transferTargetPricePaisa, transferTargetTaxPercent]);

  const transferTargetPriceIncludingGstPaisa = useMemo(() => {
    return transferTargetPricePaisa + transferTargetGstPaisa;
  }, [transferTargetPricePaisa, transferTargetGstPaisa]);

  const transferAlreadyPaidPaisa = useMemo(() => {
    return Number(
      transferTarget?.amountPaidPaisa ??
      transferTarget?.originalAmountPaidAtFirstRegistrationPaisa ??
      transferTarget?.basePricePaisa ??
      0
    );
  }, [transferTarget]);

  const transferDifferencePaisa = useMemo(() => {
    return Math.max(0, transferTargetPriceIncludingGstPaisa - transferAlreadyPaidPaisa);
  }, [transferTargetPriceIncludingGstPaisa, transferAlreadyPaidPaisa]);

  const selectedManualTicket = useMemo(() => {
    return ticketOptions.find(t => t.id === manualTicketId);
  }, [ticketOptions, manualTicketId]);

  const manualSubCategories = useMemo(() => {
    return selectedManualTicket?.subCategories || [];
  }, [selectedManualTicket]);

  const ticketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    uniqueParticipants.forEach((p) => {
      if (!p.ticketId) return;
      counts[p.ticketId] = (counts[p.ticketId] || 0) + 1;
    });
    return counts;
  }, [uniqueParticipants]);

  const ageCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    uniqueParticipants.forEach((p) => {
      const key = String(p.ageCategory || '').trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [uniqueParticipants]);

  const ageCategoryOptions = useMemo(() => {
    return Object.keys(ageCategoryCounts).sort((a, b) => {
      const aNum = parseInt((a.match(/\d+/)?.[0] || '9999'), 10);
      const bNum = parseInt((b.match(/\d+/)?.[0] || '9999'), 10);
      if (aNum !== bNum) return aNum - bNum;
      return a.localeCompare(b);
    });
  }, [ageCategoryCounts]);

  const participantsWithClubCount = useMemo(() => {
    return uniqueParticipants.filter((p) => !!(p.clubId || p.clubName)).length;
  }, [uniqueParticipants]);

  const clubCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    uniqueParticipants.forEach((p) => {
      const cid = p.clubId || "";
      if (!cid) return;
      counts[cid] = (counts[cid] || 0) + 1;
    });
    return counts;
  }, [uniqueParticipants]);

  const filteredParticipants = useMemo(() => {
    return uniqueParticipants
      .filter((p) => statusFilter === "all" || p.ticketStatus === statusFilter)
      .filter((p) => ticketFilter === "all" || p.ticketId === ticketFilter)
      .filter((p) => ageCategoryFilter === "all" || String(p.ageCategory || '').trim() === ageCategoryFilter)
      .filter((p) => billingFilter === "all" || p.billingType === billingFilter)
      .filter((p) => {
        const hasClub = !!(p.clubId || p.clubName);
        if (clubFilter === "all") return true;
        if (clubFilter === "with-club") return hasClub;
        if (clubFilter === "no-club") return !hasClub;
        return p.clubId === clubFilter;
      })
      .filter((p) => {
        const isPune = p.previousDeferralDetails?.originalEventName?.toLowerCase().includes("pune");
        if (puneDeferredFilter === "all") return true;
        if (puneDeferredFilter === "yes") return !!isPune;
        if (puneDeferredFilter === "no") return !isPune;
        return true;
      })
      .filter((p) => {
        if (belTierFilter === "all") return true;
        const athleteUid = p.athleteUid ? `uid:${p.athleteUid}` : null;
        const emailKey = p.email ? `email:${p.email.toLowerCase()}` : null;
        const mobileKey = p.mobile ? `mobile:${String(p.mobile).replace(/\D/g, '')}` : null;
        const rawTier = (athleteUid && belLookup.get(athleteUid)) || (emailKey && belLookup.get(emailKey)) || (mobileKey && belLookup.get(mobileKey)) || null;
        const tier = (!rawTier || rawTier === 'Unranked') ? 'No Tier' : rawTier;
        return tier === belTierFilter;
      })
      .filter((p) => {
        const term = participantSearchTerm.toLowerCase();
        const relayMembers = Array.isArray((p as any).relayParticipants) ? (p as any).relayParticipants : [];
        return (
          !term ||
          p.name?.toLowerCase().includes(term) ||
          p.email?.toLowerCase().includes(term) ||
          p.bibNumber?.toLowerCase().includes(term) ||
          p.bookingId?.toLowerCase().includes(term) ||
          (p.relayTeamName || '').toLowerCase().includes(term) ||
          relayMembers.some((member: any) =>
            (member.name || '').toLowerCase().includes(term) ||
            (member.email || '').toLowerCase().includes(term) ||
            (member.bibNumber || member.bib || '').toLowerCase().includes(term)
          )
        );
      });
  }, [uniqueParticipants, participantSearchTerm, statusFilter, ticketFilter, ageCategoryFilter, puneDeferredFilter, billingFilter, clubFilter, belTierFilter, belLookup]);

  useEffect(() => {
    if (!selectedEventId) return;
    const mergedIds = participants
      .map((p) => String((p as any)?.bookingId || (p as any)?.registrationId || (p as any)?.participantId || p?.id || '').trim())
      .filter(Boolean);
    const uniqueMergedIds = new Set(mergedIds);
    console.log('[ParticipantsTab] participant-count-debug', {
      firestoreCount: sourceCountMeta.source === 'firestore' ? sourceCountMeta.rawTotalCount : 0,
      kvCount: sourceCountMeta.source === 'kv' ? sourceCountMeta.rawTotalCount : 0,
      mergedCount: participants.length,
      uniqueCount: uniqueParticipants.length,
      filteredCount: filteredParticipants.length,
      displayedCount: filteredParticipants.length,
      mergeIdStats: {
        total: mergedIds.length,
        unique: uniqueMergedIds.size,
        duplicates: mergedIds.length - uniqueMergedIds.size,
      },
    });
  }, [selectedEventId, sourceCountMeta, participants, uniqueParticipants.length, filteredParticipants.length]);

  const handleAssignMissingBibs = async () => {
    if (blockIfReadOnly()) return;
    if (!selectedEventId) return;
    setIsAssigningBibs(true);
    try {
      const result = await assignMissingBibsAction(selectedEventId);
      if (result?.success) {
        toast({ title: "BIB Assignment Complete", description: result.message });
        refreshData();
      } else {
        toast({ variant: "destructive", title: "Assignment Failed", description: result?.message || 'No response from server action.' });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Assignment Failed", description: e?.message || 'Unexpected error while assigning BIBs.' });
    } finally {
      setIsAssigningBibs(false);
    }
  };

  const handleRemoveDuplicateBibs = async () => {
    if (blockIfReadOnly()) return;
    if (!selectedEventId) return;
    setIsCleaningBibs(true);
    try {
      const result = await reassignDuplicateBibsAction(selectedEventId);
      if (result?.success) {
        toast({ title: "Cleanup Complete", description: result.message });
        refreshData();
      } else {
        toast({ variant: "destructive", title: "Cleanup Failed", description: result?.message || 'No response from server action.' });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Cleanup Failed", description: e?.message || 'Unexpected error while cleaning duplicate BIBs.' });
    } finally {
      setIsCleaningBibs(false);
    }
  };

  const handleSyncClubData = async () => {
      if (blockIfReadOnly()) return;
      if (!selectedEventId) return;
      setIsSyncingClubs(true);
      try {
        const res = await syncClubDataForEventParticipantsAction(selectedEventId);
        if (res.success) {
            toast({ title: "Clubs Synced", description: res.message });
            refreshData();
        } else {
            toast({ variant: "destructive", title: "Sync Failed", description: res.message });
        }
      } catch (error: any) {
        toast({ variant: "destructive", title: "Sync Failed", description: error?.message || 'Unexpected error while syncing clubs.' });
      } finally {
        setIsSyncingClubs(false);
      }
  };

  const handleSendWhatsApp = async (participant: EventParticipant) => {
    if (blockIfReadOnly()) return;
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
    if (blockIfReadOnly()) return;
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
    if (blockIfReadOnly()) return;
    if (!selectedEventId || !participantToEdit) return;
    setIsSavingEdit(true);
    try {
      const payload = { ...data } as any;

      if (editingIdProofFile) {
        const { storage } = await import('@/lib/firebase');
        const { ref: storageRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
        const safeFileName = editingIdProofFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const fileRef = storageRef(
          storage,
          `eventRegistrations/${selectedEventId}/idProofs/idProof-${participantToEdit.id}-${Date.now()}-${safeFileName}`
        );
        await uploadBytes(fileRef, editingIdProofFile);
        payload.idProofUrl = await getDownloadURL(fileRef);
      }

      const result = await updateParticipantInEventAction(selectedEventId, participantToEdit.id, payload);
      if (result.success) {
        toast({ title: "Participant Updated" });
        setParticipantToEdit(null);
        setEditingIdProofFile(null);
        refreshData();
      } else {
        toast({ variant: "destructive", title: "Update Failed", description: result.message });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update Failed", description: e?.message || 'Failed to save participant.' });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCancelRegistration = async () => {
    if (blockIfReadOnly()) return;
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
    if (blockIfReadOnly()) return;
    if (!selectedEventId) return;
    const result = await deleteParticipantFromEventAction(selectedEventId, participantId);
    if (result.success) {
      toast({ title: "Removed from Event" });
      refreshData();
    } else {
      toast({ variant: "destructive", title: "Error", description: result.message });
    }
  };

  const resetAddFromDatabaseState = () => {
    setDbSearchEmail('');
    setSearchedDbUser(null);
    setManualTicketId('');
    setManualSubCategoryId('');
    setManualAmountInr('');
    setManualPaymentMethod('Offline/Admin Manual');
    setManualTransactionId('');
    setManualSendConfirmations(false);
    setManualIdProofFile(null);
    setManualReplaceIdProof(false);
    setManualParticipantDetails({
      name: '',
      mobile: '',
      dob: '',
      gender: '',
      bloodGroup: '',
      tshirtSize: '',
      idProofUrl: '',
      emergencyContactNumber: '',
      address: '',
      city: '',
      state: '',
      country: '',
      pincode: '',
    });
  };

  const manualCountryNormalized = (manualParticipantDetails.country || '').trim().toLowerCase();
  const normalizeCountryName = (value?: string | null) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (['india', 'in'].includes(raw)) return 'India';
    if (['usa', 'us', 'united states', 'united states of america'].includes(raw)) return 'USA';
    return String(value).trim();
  };
  const manualStateOptions = useMemo(() => {
    const indiaAliases = new Set(['india', 'in']);
    const usaAliases = new Set(['usa', 'us', 'united states', 'united states of america']);
    if (indiaAliases.has(manualCountryNormalized)) return INDIAN_STATES.map((s) => s.name);
    if (usaAliases.has(manualCountryNormalized)) return USA_STATES.map((s) => s.name);
    return [] as string[];
  }, [manualCountryNormalized]);

  const manualCountrySelectValue = normalizeCountryName(manualParticipantDetails.country) || '__none__';

  useEffect(() => {
    const normalized = normalizeCountryName(manualParticipantDetails.country);
    if (normalized && normalized !== manualParticipantDetails.country) {
      setManualParticipantDetails((prev) => ({ ...prev, country: normalized }));
    }
  }, [manualParticipantDetails.country]);

  useEffect(() => {
    if (manualStateOptions.length === 0) return;
    if (manualParticipantDetails.state && !manualStateOptions.includes(manualParticipantDetails.state)) {
      setManualParticipantDetails((prev) => ({ ...prev, state: '' }));
    }
  }, [manualStateOptions, manualParticipantDetails.state]);

  const handleSearchDatabaseUser = async () => {
    const email = dbSearchEmail.trim().toLowerCase();
    if (!email) {
      toast({ variant: 'destructive', title: 'Email required', description: 'Please enter an email to search.' });
      return;
    }

    setIsSearchingDbUser(true);
    const result = await findUserForParticipantRegistrationAction(email);
    if (result.success && result.user) {
      setSearchedDbUser(result.user);
      setManualIdProofFile(null);
      setManualReplaceIdProof(false);
      setManualParticipantDetails({
        name: result.user.name || '',
        mobile: result.user.mobile || '',
        dob: result.user.dob || '',
        gender: result.user.gender || '',
        bloodGroup: result.user.bloodGroup || '',
        tshirtSize: result.user.tshirtSize || '',
        idProofUrl: result.user.idProofUrl || '',
        emergencyContactNumber: result.user.emergencyContactNumber || '',
        address: result.user.address || '',
        city: result.user.city || '',
        state: result.user.state || '',
        country: normalizeCountryName(result.user.country),
        pincode: result.user.pincode || '',
      });
      toast({ title: 'User found', description: `${result.user.name} loaded from database.` });
    } else {
      const fallbackName = email.split('@')[0]?.replace(/[._-]/g, ' ') || 'Athlete';
      setSearchedDbUser({
        uid: '',
        name: fallbackName,
        email,
        mobile: null,
        isNew: true,
      });
      setManualParticipantDetails(prev => ({
        ...prev,
        name: prev.name || fallbackName,
        country: normalizeCountryName(prev.country || 'India') || 'India',
      }));
      setManualIdProofFile(null);
      setManualReplaceIdProof(true);
      toast({ title: 'User not found', description: 'No user found. Fill details and register to create a new user + participant.' });
    }
    setIsSearchingDbUser(false);
  };

  const handleRegisterFromDatabase = async () => {
    if (blockIfReadOnly()) return;
    if (!selectedEventId) {
      toast({ variant: 'destructive', title: 'Event required', description: 'Please select an event first.' });
      return;
    }
    if (!searchedDbUser?.email) {
      toast({ variant: 'destructive', title: 'User required', description: 'Search and select a user first.' });
      return;
    }
    if (!manualTicketId) {
      toast({ variant: 'destructive', title: 'Ticket required', description: 'Please select a ticket.' });
      return;
    }
    if (!manualParticipantDetails.name.trim()) {
      toast({ variant: 'destructive', title: 'Name required', description: 'Please enter participant name.' });
      return;
    }
    if (manualSubCategories.length > 0 && !manualSubCategoryId) {
      toast({ variant: 'destructive', title: 'Sub-category required', description: 'Please select a sub-category.' });
      return;
    }

    const parsedAmount = manualAmountInr.trim() === '' ? null : Number(manualAmountInr);
    if (parsedAmount !== null && (Number.isNaN(parsedAmount) || parsedAmount < 0)) {
      toast({ variant: 'destructive', title: 'Invalid amount', description: 'Amount must be a valid positive number.' });
      return;
    }

    setIsRegisteringFromDb(true);

    let resolvedIdProofUrl = manualParticipantDetails.idProofUrl;
    if (manualIdProofFile) {
      try {
        const { storage } = await import('@/lib/firebase');
        const { ref: storageRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
        const safeFileName = manualIdProofFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const fileRef = storageRef(
          storage,
          `eventRegistrations/${selectedEventId}/idProofs/admin-manual-${Date.now()}-${safeFileName}`
        );
        await uploadBytes(fileRef, manualIdProofFile);
        resolvedIdProofUrl = await getDownloadURL(fileRef);
      } catch (uploadErr: any) {
        setIsRegisteringFromDb(false);
        toast({ variant: 'destructive', title: 'ID upload failed', description: uploadErr?.message || 'Could not upload ID proof file.' });
        return;
      }
    }

    const result = await registerParticipantFromDatabaseAction({
      eventId: selectedEventId,
      email: searchedDbUser.email,
      ticketId: manualTicketId,
      selectedSubCategory: manualSubCategoryId || null,
      amountPaidInr: parsedAmount,
      paymentMethod: manualPaymentMethod,
      transactionId: manualTransactionId,
      sendConfirmations: manualSendConfirmations,
      participantOverrides: {
        name: manualParticipantDetails.name,
        mobile: manualParticipantDetails.mobile,
        dob: manualParticipantDetails.dob,
        gender: manualParticipantDetails.gender,
        bloodGroup: manualParticipantDetails.bloodGroup,
        tshirtSize: manualParticipantDetails.tshirtSize,
        idProofUrl: resolvedIdProofUrl,
        emergencyContactNumber: manualParticipantDetails.emergencyContactNumber,
        address: manualParticipantDetails.address,
        city: manualParticipantDetails.city,
        state: manualParticipantDetails.state,
        country: manualParticipantDetails.country,
        pincode: manualParticipantDetails.pincode,
      },
    });

    if (result.success) {
      toast({ title: 'Participant added', description: result.message });
      setIsAddFromDatabaseOpen(false);
      resetAddFromDatabaseState();
      refreshData();
      onDataRefresh();
    } else {
      toast({ variant: 'destructive', title: 'Registration failed', description: result.message });
    }
    setIsRegisteringFromDb(false);
  };

  const handleCategoryChange = async () => {
    if (blockIfReadOnly()) return;
    if (!selectedEventId || !categoryChangeParticipant || !newTicketId) return;
    
    // If sub-categories are available and none selected, show error
    if (availableSubCategories.length > 0 && !newSubCategory) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select a sub-category.' });
      return;
    }

    setIsProcessingCatChange(true);
    const result = await updateCategoryForParticipantAction(selectedEventId, categoryChangeParticipant.id, newTicketId, newSubCategory || undefined);
    if (result.success) {
      toast({ title: "Category Updated", description: result.message });
      setCategoryChangeTarget(null);
      setNewTicketId("");
      setNewSubCategory("");
      refreshData();
    } else {
      toast({ variant: "destructive", title: "Error", description: result.message });
    }
    setIsProcessingCatChange(false);
  };

  const resetTransferModalState = () => {
    setTransferTarget(null);
    setTransferTargetEventId("");
    setTransferTargetTicketId("");
    setTransferTargetSubCategoryId("");
    setTransferTicketOptions([]);
    setTransferAdminNote("");
    setTransferConfirmPaymentReceived(false);
    setTransferSendConfirmation(true);
  };

  const handleTransferParticipant = async () => {
    if (blockIfReadOnly()) return;
    if (!selectedEventId || !transferTarget || !transferTargetEventId || !transferTargetTicketId) return;
    if (availableTransferSubCategories.length > 0 && !transferTargetSubCategoryId) {
      toast({ variant: 'destructive', title: 'Sub-category required', description: 'Please select a sub-category.' });
      return;
    }

    if (transferDifferencePaisa > 0 && !transferConfirmPaymentReceived) {
      toast({
        variant: 'destructive',
        title: 'Payment confirmation required',
        description: `Additional payment of ${(transferDifferencePaisa / 100).toFixed(2)} must be received before confirmation.`,
      });
      return;
    }

    setIsProcessingTransfer(true);
    const result = await transferParticipantToEventAction({
      sourceEventId: selectedEventId,
      sourceParticipantId: transferTarget.id,
      targetEventId: transferTargetEventId,
      targetTicketId: transferTargetTicketId,
      targetSubCategoryId: transferTargetSubCategoryId || null,
      adminNote: transferAdminNote || null,
      confirmPaymentReceived: transferDifferencePaisa <= 0 ? true : transferConfirmPaymentReceived,
      sendConfirmation: transferSendConfirmation,
    });

    if (result.success) {
      toast({ title: 'Transfer Processed', description: result.message });
      resetTransferModalState();
      refreshData();
      onDataRefresh();
    } else {
      toast({ variant: 'destructive', title: 'Transfer Failed', description: result.message });
    }
    setIsProcessingTransfer(false);
  };

  const saveQuickEditBib = async () => {
    if (blockIfReadOnly()) return;
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
    if (blockIfReadOnly()) return;
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
    if (blockIfReadOnly()) return;
    if (!selectedEventId) return;
    setIsSyncing(true);
    const result = await runDataSyncAction("participants", selectedEventId);
    if (result.success) {
      toast({ title: "Sync Complete", description: "Participants synced from Firestore to KV. Refreshing list..." });
      // Wait a bit for KV to propagate, then force refresh from Firestore
      await new Promise(resolve => setTimeout(resolve, 1500));
      setLastVisibleId(null);
      fetchParticipants(selectedEventId, null, true); // Force refresh bypasses KV cache
    } else {
      toast({ variant: "destructive", title: "Sync Failed", description: result.message });
    }
    setIsSyncing(false);
  };

  const handleVerifyIntegrity = async () => {
    if (!selectedEventId) return;
    setIsVerifyingIntegrity(true);
    const result = await verifyParticipantIntegrityAction(selectedEventId, 15);
    if (!result.success) {
      toast({ variant: "destructive", title: "Integrity Check Failed", description: result.message });
      setIsVerifyingIntegrity(false);
      return;
    }

    const mismatchSummary = `FS:${result.firestoreCount ?? 0} KV:${result.kvCount ?? 0} | Missing in FS:${result.missingInFirestoreCount ?? 0} Missing in KV:${result.missingInKvCount ?? 0} | Dup(FS):${result.duplicateGroupsInFirestore ?? 0} Dup(KV):${result.duplicateGroupsInKv ?? 0}`;

    console.log('[ParticipantsTab] integrity-check-result', result);

    toast({
      title: 'Integrity Check Complete',
      description: mismatchSummary,
    });

    setIsVerifyingIntegrity(false);
  };

  const handleRepairLegacyMirror = async () => {
    if (!selectedEventId) return;
    setIsRepairingLegacyMirror(true);
    const result = await repairLegacyParticipantsMirrorAction(selectedEventId);
    if (!result.success) {
      toast({ variant: 'destructive', title: 'Legacy Mirror Repair Failed', description: result.message });
      setIsRepairingLegacyMirror(false);
      return;
    }

    toast({
      title: 'Legacy Mirror Repaired',
      description: `${result.repairedCount ?? 0} participants mirrored to legacy collection.`,
    });

    setIsRepairingLegacyMirror(false);
  };

  const handleDownload = () => {
    if (blockIfReadOnly()) return;
    if (!selectedEventId) return;
    const params = new URLSearchParams({
      eventId: selectedEventId,
      type: 'individual',
      statusFilter,
      ticketFilter,
      ageCategoryFilter,
      puneDeferredFilter,
      billingFilter,
      clubFilter,
      belTierFilter,
      participantSearchTerm,
    });
    window.location.href = `/api/admin/download-participants?${params.toString()}`;
  };

  const handleDownloadRelay = () => {
    if (blockIfReadOnly()) return;
    if (!selectedEventId) return;
    const params = new URLSearchParams({
      eventId: selectedEventId,
      type: 'relay',
      statusFilter,
      ticketFilter,
      ageCategoryFilter,
      puneDeferredFilter,
      billingFilter,
      clubFilter,
      belTierFilter,
      participantSearchTerm,
    });
    window.location.href = `/api/admin/download-participants?${params.toString()}`;
  };

  const formatCurrency = (paisa: number | null | undefined, participant?: ParticipantWithProfile | EventParticipant | null) => {
    const code = getParticipantCurrency(participant);
    const symbol = code === 'USD' ? '$' : '₹';
    const locale = code === 'USD' ? 'en-US' : 'en-IN';
    if (paisa === null || paisa === undefined) return `${symbol}0`;
    return `${symbol}${(paisa / 100).toLocaleString(locale)}`;
  };

  const formatCurrencyByCode = (paisa: number | null | undefined, currencyCode: 'INR' | 'USD') => {
    const symbol = currencyCode === 'USD' ? '$' : '₹';
    const locale = currencyCode === 'USD' ? 'en-US' : 'en-IN';
    if (paisa === null || paisa === undefined) return `${symbol}0`;
    return `${symbol}${(paisa / 100).toLocaleString(locale)}`;
  };

  const toTitleCase = (value?: string | null) => {
    if (!value) return '';
    return value
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getBelTierForParticipant = (participant: ParticipantWithProfile) => {
    const athleteUid = participant.athleteUid ? `uid:${participant.athleteUid}` : null;
    const email = participant.email ? `email:${participant.email.toLowerCase()}` : null;
    const mobile = participant.mobile ? `mobile:${String(participant.mobile).replace(/\D/g, '')}` : null;

    const rawTier = (athleteUid && belLookup.get(athleteUid)) || (email && belLookup.get(email)) || (mobile && belLookup.get(mobile)) || null;
    if (rawTier === 'Unranked') return 'No Tier';
    return rawTier;
  };

  return (
    <>
      <Card>
        <CardHeader className="text-left">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div>
              <CardTitle>Participants List ({displayTotalCount})</CardTitle>
              <CardDescription>View and manage registrations. Showing {filteredParticipants.length} of {displayTotalCount}.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 w-full lg:w-auto">
              <Button
                size="sm"
                onClick={() => setIsAddFromDatabaseOpen(true)}
                disabled={!selectedEventId || isViewOnlyAdmin}
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Add from Database
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={!selectedEventId || isViewOnlyAdmin}>
                <Download className="h-4 w-4 mr-2" />
                Download Individual List
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownloadRelay} disabled={!selectedEventId || isViewOnlyAdmin}>
                <Download className="h-4 w-4 mr-2" />
                Download Relay List
              </Button>
              <Button size="sm" variant="outline" onClick={handleSyncKV} disabled={isSyncing || !selectedEventId || isViewOnlyAdmin}>
                {isSyncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Sync to KV
              </Button>
              <Button size="sm" variant="outline" onClick={handleVerifyIntegrity} disabled={isVerifyingIntegrity || !selectedEventId}>
                {isVerifyingIntegrity ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
                Verify FS ↔ KV
              </Button>
              <Button size="sm" variant="outline" onClick={handleRepairLegacyMirror} disabled={isRepairingLegacyMirror || !selectedEventId}>
                {isRepairingLegacyMirror ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Repair Legacy Mirror
              </Button>
              <Button size="sm" variant="outline" onClick={handleAssignMissingBibs} disabled={isAssigningBibs || !selectedEventId || isViewOnlyAdmin}>
                {isAssigningBibs ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Hash className="h-4 w-4 mr-2"/>}
                Assign Missing BIBs
              </Button>
              <Button size="sm" variant="outline" onClick={handleRemoveDuplicateBibs} disabled={isCleaningBibs || !selectedEventId || isViewOnlyAdmin}>
                {isCleaningBibs ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Trash2 className="h-4 w-4 mr-2"/>}
                Remove Duplicate BIBs
              </Button>
              <Button size="sm" variant="outline" onClick={handleSyncClubData} disabled={!selectedEventId || isSyncingClubs || isViewOnlyAdmin}>
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
                {sortedEvents.map((e) => (
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
                <Button variant="outline" onClick={refreshData} disabled={isLoadingParticipants} title="Refresh (uses cache)">
                  <RefreshCw className={cn("h-4 w-4", isLoadingParticipants && "animate-spin")} />
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => { setLastVisibleId(null); fetchParticipants(selectedEventId, null, true); }} 
                  disabled={isLoadingParticipants}
                  title="Force Refresh (bypasses cache, fetches from Firestore)"
                  className="text-orange-600 border-orange-300 hover:bg-orange-50"
                >
                  <RefreshCw className={cn("h-4 w-4", isLoadingParticipants && "animate-spin")} />
                  <span className="ml-1 text-xs">Force</span>
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
                    <SelectItem value="all">All Categories ({displayTotalCount})</SelectItem>
                    {ticketOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.ticketName} ({ticketCounts[t.id] || 0})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={ageCategoryFilter} onValueChange={setAgeCategoryFilter}>
                  <SelectTrigger className="w-[180px] text-xs h-8">
                    <SelectValue placeholder="Age Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Age: All ({displayTotalCount})</SelectItem>
                    {ageCategoryOptions.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category} ({ageCategoryCounts[category] || 0})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={clubFilter} onValueChange={setClubFilter}>
                  <SelectTrigger className="w-[220px] text-xs h-8">
                    <SelectValue placeholder="Club Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Club: All ({displayTotalCount})</SelectItem>
                    <SelectItem value="with-club">With Club ({participantsWithClubCount})</SelectItem>
                    <SelectItem value="no-club">Unaffiliated ({uniqueParticipants.length - participantsWithClubCount})</SelectItem>
                    {allClubs.filter((club) => (clubCounts[club.id] || 0) > 0).map((club) => (
                      <SelectItem key={club.id} value={club.id}>
                        {club.name} ({clubCounts[club.id]})
                      </SelectItem>
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

                <Select value={belTierFilter} onValueChange={setBelTierFilter}>
                  <SelectTrigger className="w-[160px] text-xs h-8">
                    <SelectValue placeholder="BEL Tier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">BEL Tier: All</SelectItem>
                    <SelectItem value="Gold">🥇 Gold</SelectItem>
                    <SelectItem value="Silver">🥈 Silver</SelectItem>
                    <SelectItem value="Bronze">🥉 Bronze</SelectItem>
                    <SelectItem value="Provisional">🔵 Provisional</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="border rounded-md overflow-auto bg-background max-h-[60vh] custom-scrollbar">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-10 shadow-sm">
                    <TableRow className="text-[11px] uppercase tracking-wider">
                      <TableHead>Athlete / Business</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>BEL {BEL_SEASON}</TableHead>
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
                        <TableCell colSpan={13} className="h-32 text-center text-muted-foreground italic">
                          No participants found for this event.
                        </TableCell>
                      </TableRow>
                    ) : filteredParticipants.map((p) => {
                        const isBusiness = p.billingType === 'business';
                        const isRelayTeam = !!p.isRelay;
                        const isPune = p.previousDeferralDetails?.originalEventName?.toLowerCase().includes("pune");
                        const hasDeferral = p.isDeferral === true || !!p.previousDeferralDetails || !!p.deferralId;
                        const belTier = getBelTierForParticipant(p);
                        const relayMembers = Array.isArray(p.relayParticipants) ? p.relayParticipants : [];
                        const relaySubtitle = relayMembers.map((member) => `${toTitleCase(member.role)}: ${toTitleCase(member.name)}`).join(' • ');
                        return (
                          <TableRow key={p.id} className="text-xs hover:bg-muted/30 group">
                            <TableCell className="font-medium">
                              <button 
                                onClick={() => setViewingParticipant(p)}
                                className="text-primary hover:underline transition-colors text-left font-bold"
                              >
                                {toTitleCase(isRelayTeam ? (p.relayTeamName || p.name) : p.name)}
                              </button>
                              {isRelayTeam && (
                                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-blue-700 uppercase font-black tracking-tight">
                                  <UserPlus className="h-2.5 w-2.5" /> Relay Team
                                </div>
                              )}
                              {isRelayTeam && relaySubtitle && (
                                <div className="mt-1 text-[10px] text-muted-foreground leading-relaxed max-w-[280px] whitespace-normal">
                                  {relaySubtitle}
                                </div>
                              )}
                              {isBusiness && (
                                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground uppercase font-black tracking-tight">
                                  <Building className="h-2.5 w-2.5" /> {toTitleCase(p.businessName)}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {(p.email || p.buyerEmail) || '—'}<br />{p.mobile || '—'}
                              {isRelayTeam && (
                                <div className="mt-1 text-[10px]">Captain: {toTitleCase(p.buyerName || relayMembers[0]?.name || '—')}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              {belTier && belTier !== 'No Tier' ? (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "h-5 text-[9px] uppercase font-black",
                                    belTier === 'Gold' && 'border-yellow-300 bg-yellow-50 text-yellow-700',
                                    belTier === 'Silver' && 'border-slate-300 bg-slate-50 text-slate-700',
                                    belTier === 'Bronze' && 'border-amber-300 bg-amber-50 text-amber-700',
                                    belTier === 'Provisional' && 'border-purple-300 bg-purple-50 text-purple-700',
                                  )}
                                >
                                  {belTier}
                                </Badge>
                              ) : '—'}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 font-mono">
                                {p.relayTeamBib || p.bibNumber || "—"}
                                <button
                                  onClick={() => setQuickEditBib({ id: p.id, bib: p.relayTeamBib || p.bibNumber || "", name: isRelayTeam ? (p.relayTeamName || p.name) : p.name })}
                                  className="text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                                  disabled={isViewOnlyAdmin}
                                >
                                  <PencilLine className="h-3 w-3" />
                                </button>
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {toTitleCase(p.ticketName)}
                              {isRelayTeam && <div className="text-[10px] text-muted-foreground">Team Registration</div>}
                            </TableCell>
                            <TableCell>
                              <Badge variant={p.ticketStatus === "Active" ? "default" : "secondary"} className="text-[10px] px-1.5 h-5">
                                {p.ticketStatus}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground truncate max-w-[120px]" title={toTitleCase(p.clubName) || ""}>
                              {toTitleCase(p.clubName) || "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {formatCurrency(p.amountPaidPaisa, p)}
                                <button
                                  onClick={() => setQuickEditAmount({ id: p.id, amount: (p.amountPaidPaisa || 0) / 100, name: isRelayTeam ? (p.relayTeamName || p.name) : p.name, currency: getParticipantCurrency(p) })}
                                  className="text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                                  disabled={isViewOnlyAdmin}
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
                              {isRelayTeam ? (
                                <Badge variant="outline" className="border-blue-600 text-blue-700 h-5 text-[9px] uppercase font-black">Relay</Badge>
                              ) : isBusiness ? (
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
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setParticipantToEdit(p)} title="Full Edit" disabled={isViewOnlyAdmin}><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  onClick={() => handleSendEmail(p)}
                                  disabled={isSendingEmail === p.id || isViewOnlyAdmin}
                                  title="Resend Email"
                                >
                                  {isSendingEmail === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => handleSendWhatsApp(p)}
                                  disabled={isSendingWhatsApp === p.id || !p.mobile || isViewOnlyAdmin}
                                  title="Resend WhatsApp"
                                >
                                  {isSendingWhatsApp === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                  onClick={() => {
                                    setCategoryChangeTarget(p);
                                    setNewTicketId(p.ticketId || "");
                                    setNewSubCategory(p.selectedSubCategory || "");
                                  }}
                                  disabled={isViewOnlyAdmin}
                                  title="Change Category"
                                >
                                  <Repeat className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                  onClick={() => {
                                    setTransferTarget(p);
                                    setTransferTargetEventId("");
                                    setTransferTargetTicketId("");
                                    setTransferTargetSubCategoryId("");
                                    setTransferTicketOptions([]);
                                    setTransferAdminNote("");
                                    setTransferConfirmPaymentReceived(false);
                                    setTransferSendConfirmation(true);
                                  }}
                                  disabled={isViewOnlyAdmin}
                                  title="Transfer Event"
                                >
                                  <ArrowRightLeft className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                  onClick={() => setCancellationTarget(p)}
                                  disabled={p.ticketStatus === 'Cancelled' || isViewOnlyAdmin}
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
                                      disabled={isViewOnlyAdmin}
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
                                      <AlertDialogAction onClick={() => handleDeleteParticipant(p.id)} className="bg-destructive hover:bg-destructive/90" disabled={isViewOnlyAdmin}>Delete Record</AlertDialogAction>
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

      {/* ADD PARTICIPANT FROM DATABASE MODAL */}
      <Dialog
        open={isAddFromDatabaseOpen}
        onOpenChange={(open) => {
          if (!open && !isRegisteringFromDb) {
            setIsAddFromDatabaseOpen(false);
            resetAddFromDatabaseState();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl text-left max-h-[85vh] flex flex-col overflow-hidden min-h-0">
          <DialogHeader>
            <DialogTitle>Add Participant from Database</DialogTitle>
            <DialogDescription>
              Search an existing user by email, then register them to the selected event with manual payment details.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto pr-2">
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
              <Input
                placeholder="Enter athlete email..."
                value={dbSearchEmail}
                onChange={(e) => setDbSearchEmail(e.target.value)}
              />
              <Button onClick={handleSearchDatabaseUser} disabled={isSearchingDbUser || !dbSearchEmail.trim()}>
                {isSearchingDbUser ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <SearchIcon className="h-4 w-4 mr-2" />
                )}
                Search User
              </Button>
            </div>

            {searchedDbUser && (
              <div className="rounded-md border p-3 bg-muted/30 space-y-1">
                <div className="text-sm font-semibold">{searchedDbUser.name}</div>
                <div className="text-xs text-muted-foreground">{searchedDbUser.email} • {searchedDbUser.mobile || 'No mobile'}</div>
                <div className="text-xs text-muted-foreground">
                  DOB: {searchedDbUser.dob || '—'} • Gender: {searchedDbUser.gender || '—'} • Club: {searchedDbUser.clubName || '—'}
                </div>
                <div className="text-xs text-muted-foreground">User ID: {searchedDbUser.uid || '—'}</div>
                {searchedDbUser.isNew && (
                  <div className="text-xs font-medium text-amber-600">New email: user will be created on registration.</div>
                )}
              </div>
            )}

            {searchedDbUser && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Participant Details (Editable)</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Name *</Label>
                    <Input
                      value={manualParticipantDetails.name}
                      onChange={(e) => setManualParticipantDetails(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Participant name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mobile</Label>
                    <Input
                      value={manualParticipantDetails.mobile}
                      onChange={(e) => setManualParticipantDetails(prev => ({ ...prev, mobile: e.target.value }))}
                      placeholder="Mobile number"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Date of Birth</Label>
                    <Input
                      type="date"
                      value={manualParticipantDetails.dob}
                      onChange={(e) => setManualParticipantDetails(prev => ({ ...prev, dob: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Gender</Label>
                    <Select
                      value={manualParticipantDetails.gender || "__none__"}
                      onValueChange={(val) => setManualParticipantDetails(prev => ({ ...prev, gender: val === '__none__' ? '' : val }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Not specified</SelectItem>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Blood Group</Label>
                    <Input
                      value={manualParticipantDetails.bloodGroup}
                      onChange={(e) => setManualParticipantDetails(prev => ({ ...prev, bloodGroup: e.target.value }))}
                      placeholder="e.g. O+"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>T-Shirt Size</Label>
                    <Input
                      value={manualParticipantDetails.tshirtSize}
                      onChange={(e) => setManualParticipantDetails(prev => ({ ...prev, tshirtSize: e.target.value }))}
                      placeholder="e.g. M"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>ID Proof</Label>
                    {!!manualParticipantDetails.idProofUrl && !manualReplaceIdProof && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" variant="outline" size="sm" asChild>
                          <a href={manualParticipantDetails.idProofUrl} target="_blank" rel="noreferrer">View ID</a>
                        </Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setManualReplaceIdProof(true)}>
                          Replace ID
                        </Button>
                      </div>
                    )}

                    {(manualReplaceIdProof || !manualParticipantDetails.idProofUrl) && (
                      <div className="space-y-2">
                        <Input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(e) => setManualIdProofFile(e.target.files?.[0] || null)}
                        />
                        {manualIdProofFile && (
                          <p className="text-xs text-muted-foreground">Selected file: {manualIdProofFile.name}</p>
                        )}
                        <Input
                          value={manualParticipantDetails.idProofUrl}
                          onChange={(e) => setManualParticipantDetails(prev => ({ ...prev, idProofUrl: e.target.value }))}
                          placeholder="Or paste ID proof URL/reference"
                        />
                        {!!manualParticipantDetails.idProofUrl && manualReplaceIdProof && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => { setManualReplaceIdProof(false); setManualIdProofFile(null); }}>
                            Keep Existing ID
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Emergency Contact</Label>
                    <Input
                      value={manualParticipantDetails.emergencyContactNumber}
                      onChange={(e) => setManualParticipantDetails(prev => ({ ...prev, emergencyContactNumber: e.target.value }))}
                      placeholder="Emergency contact number"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Address</Label>
                    <Input
                      value={manualParticipantDetails.address}
                      onChange={(e) => setManualParticipantDetails(prev => ({ ...prev, address: e.target.value }))}
                      placeholder="Address"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>City</Label>
                    <Input
                      value={manualParticipantDetails.city}
                      onChange={(e) => setManualParticipantDetails(prev => ({ ...prev, city: e.target.value }))}
                      placeholder="City"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>State</Label>
                    {manualStateOptions.length > 0 ? (
                      <Select
                        value={manualParticipantDetails.state || '__none__'}
                        onValueChange={(val) => setManualParticipantDetails(prev => ({ ...prev, state: val === '__none__' ? '' : val }))}
                      >
                        <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Select state</SelectItem>
                          {manualStateOptions.map((stateName) => (
                            <SelectItem key={stateName} value={stateName}>{stateName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={manualParticipantDetails.state}
                        onChange={(e) => setManualParticipantDetails(prev => ({ ...prev, state: e.target.value }))}
                        placeholder="State"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Country</Label>
                    <Select
                      value={manualCountrySelectValue}
                      onValueChange={(val) => setManualParticipantDetails(prev => ({ ...prev, country: val === '__none__' ? '' : val }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Not specified</SelectItem>
                        <SelectItem value="India">India</SelectItem>
                        <SelectItem value="USA">USA</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Pincode</Label>
                    <Input
                      value={manualParticipantDetails.pincode}
                      onChange={(e) => setManualParticipantDetails(prev => ({ ...prev, pincode: e.target.value }))}
                      placeholder="Pincode"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ticket</Label>
                <Select value={manualTicketId} onValueChange={(val) => { setManualTicketId(val); setManualSubCategoryId(''); }}>
                  <SelectTrigger><SelectValue placeholder="Select ticket" /></SelectTrigger>
                  <SelectContent>
                    {ticketOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.ticketName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {manualSubCategories.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Sub-Category</Label>
                  <Select value={manualSubCategoryId} onValueChange={setManualSubCategoryId}>
                    <SelectTrigger><SelectValue placeholder="Select sub-category" /></SelectTrigger>
                    <SelectContent>
                      {manualSubCategories.map((sc) => (
                        <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Amount Paid ({selectedEventCurrency})</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="Leave blank to use ticket price"
                  value={manualAmountInr}
                  onChange={(e) => setManualAmountInr(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Payment Method</Label>
                <Input
                  value={manualPaymentMethod}
                  onChange={(e) => setManualPaymentMethod(e.target.value)}
                  placeholder="Offline/Admin Manual"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label>Transaction ID (Optional)</Label>
                <Input
                  value={manualTransactionId}
                  onChange={(e) => setManualTransactionId(e.target.value)}
                  placeholder="Optional manual reference"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="manual-send-confirmations"
                checked={manualSendConfirmations}
                onCheckedChange={(v) => setManualSendConfirmations(!!v)}
              />
              <Label htmlFor="manual-send-confirmations" className="text-sm font-normal cursor-pointer">
                Send confirmation email/WhatsApp after registration
              </Label>
            </div>
          </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setIsAddFromDatabaseOpen(false); resetAddFromDatabaseState(); }} disabled={isRegisteringFromDb}>
              Cancel
            </Button>
            <Button
              onClick={handleRegisterFromDatabase}
              disabled={isRegisteringFromDb || !searchedDbUser || !manualTicketId}
            >
              {isRegisteringFromDb && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Register Participant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FULL EDIT MODAL */}
      <Dialog open={!!participantToEdit} onOpenChange={(o) => {
        if (!o && !isSavingEdit) {
          setParticipantToEdit(null);
          setEditingIdProofFile(null);
        }
      }} modal={!isSavingEdit}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col text-left overflow-hidden" onPointerDownOutside={(e) => { if (isSavingEdit) e.preventDefault(); }} onInteractOutside={(e) => { if (isSavingEdit) e.preventDefault(); }}>
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Edit Athlete Profile: {participantToEdit?.name}</DialogTitle>
            <DialogDescription>Update all registration details for this athlete.</DialogDescription>
          </DialogHeader>
          {participantToEdit && selectedEventId && events.find(e => e.id === selectedEventId) && (
            <ParticipantForm 
              eventDetails={events.find(e => e.id === selectedEventId)!}
              editingParticipant={participantToEdit}
              onIdProofFileChange={setEditingIdProofFile}
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
            <Label>Amount Paid ({quickEditAmount?.currency || selectedEventCurrency})</Label>
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
      <Dialog open={!!categoryChangeParticipant} onOpenChange={(o) => !o && (setCategoryChangeTarget(null), setNewTicketId(""), setNewSubCategory(""))}>
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
              <Select value={newTicketId} onValueChange={(val) => {setNewTicketId(val); setNewSubCategory("");}}>
                <SelectTrigger><SelectValue placeholder="Choose ticket..." /></SelectTrigger>
                <SelectContent>
                  {ticketOptions.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.ticketName}{t.id === categoryChangeParticipant?.ticketId ? " (Current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {availableSubCategories.length > 0 && (
              <div className="space-y-2 p-3 border rounded-lg bg-blue-50 border-blue-200">
                <Label className="text-xs font-semibold text-blue-700">Select Sub-Category (Swim Distance)</Label>
                <Select value={newSubCategory} onValueChange={setNewSubCategory}>
                  <SelectTrigger><SelectValue placeholder="Choose swim distance..." /></SelectTrigger>
                  <SelectContent>
                    {availableSubCategories.map(sc => (
                      <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => {setCategoryChangeTarget(null); setNewTicketId(""); setNewSubCategory("");}}>Cancel</Button>
            <Button onClick={handleCategoryChange} disabled={isProcessingCatChange || !newTicketId || (availableSubCategories.length > 0 && !newSubCategory)}>
              {isProcessingCatChange && <Loader2 className="animate-spin mr-2 h-4 w-4" />} Update Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EVENT TRANSFER MODAL */}
      <Dialog
        open={!!transferTarget}
        onOpenChange={(open) => {
          if (!open && !isProcessingTransfer) {
            resetTransferModalState();
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-hidden text-left sm:max-w-2xl flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-indigo-600" /> Event Transfer: {transferTarget?.name}
            </DialogTitle>
            <DialogDescription>
              Move this registration to another event and category. Source registration will be marked as transferred.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-2 pr-1 space-y-4">
            <div className="p-3 bg-muted rounded-md text-xs space-y-1">
              <div>Current Event: <strong>{events.find((e) => e.id === selectedEventId)?.eventName || '—'}</strong></div>
              <div>Current Ticket: <strong>{transferTarget?.ticketName || '—'}</strong></div>
              <div>Already Paid (incl. taxes/fees): <strong>{formatCurrencyByCode(transferAlreadyPaidPaisa, transferTargetCurrency)}</strong></div>
            </div>

            <div className="space-y-2">
              <Label>Target Event</Label>
              <Select
                value={transferTargetEventId}
                onValueChange={(val) => {
                  setTransferTargetEventId(val);
                  setTransferTargetTicketId("");
                  setTransferTargetSubCategoryId("");
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select target event" /></SelectTrigger>
                <SelectContent>
                  {sortedEvents
                    .filter((e) => e.id !== selectedEventId)
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Target Category</Label>
              <Select
                value={transferTargetTicketId}
                onValueChange={(val) => {
                  setTransferTargetTicketId(val);
                  setTransferTargetSubCategoryId("");
                }}
                disabled={!transferTargetEventId}
              >
                <SelectTrigger><SelectValue placeholder="Select target ticket" /></SelectTrigger>
                <SelectContent>
                  {transferTicketOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.ticketName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {availableTransferSubCategories.length > 0 && (
              <div className="space-y-2 p-3 border rounded-lg bg-blue-50 border-blue-200">
                <Label className="text-xs font-semibold text-blue-700">Target Sub-Category</Label>
                <Select value={transferTargetSubCategoryId} onValueChange={setTransferTargetSubCategoryId}>
                  <SelectTrigger><SelectValue placeholder="Choose sub-category..." /></SelectTrigger>
                  <SelectContent>
                    {availableTransferSubCategories.map((sc) => (
                      <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="p-3 rounded-md border text-xs space-y-1">
              <div>Target Base Price: <strong>{formatCurrencyByCode(transferTargetPricePaisa, transferTargetCurrency)}</strong></div>
              <div>
                + {transferTargetCurrency === 'USD' ? 'Tax' : 'GST'} ({transferTargetTaxPercent}%): <strong>{formatCurrencyByCode(transferTargetGstPaisa, transferTargetCurrency)}</strong>
              </div>
              <div>Target Price (incl. {transferTargetCurrency === 'USD' ? 'Tax' : 'GST'}): <strong>{formatCurrencyByCode(transferTargetPriceIncludingGstPaisa, transferTargetCurrency)}</strong></div>
              <div>Already Paid (incl. taxes/fees): <strong>{formatCurrencyByCode(transferAlreadyPaidPaisa, transferTargetCurrency)}</strong></div>
              <div className={cn('font-semibold', transferDifferencePaisa > 0 ? 'text-orange-700' : 'text-green-700')}>
                Difference to Collect (incl. {transferTargetCurrency === 'USD' ? 'Tax' : 'GST'}): {formatCurrencyByCode(transferDifferencePaisa, transferTargetCurrency)}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Admin Note (Optional)</Label>
              <Textarea
                placeholder="Reason or payment reference..."
                value={transferAdminNote}
                onChange={(e) => setTransferAdminNote(e.target.value)}
              />
            </div>

            {transferDifferencePaisa > 0 && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="transfer-confirm-payment"
                  checked={transferConfirmPaymentReceived}
                  onCheckedChange={(v) => setTransferConfirmPaymentReceived(!!v)}
                />
                <Label htmlFor="transfer-confirm-payment" className="text-sm font-normal cursor-pointer">
                  I confirm additional payment has been received
                </Label>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="transfer-send-confirmation"
                checked={transferSendConfirmation}
                onCheckedChange={(v) => setTransferSendConfirmation(!!v)}
              />
              <Label htmlFor="transfer-send-confirmation" className="text-sm font-normal cursor-pointer">
                Send updated registration confirmation email
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={resetTransferModalState} disabled={isProcessingTransfer}>Cancel</Button>
            <Button
              onClick={handleTransferParticipant}
              disabled={
                isProcessingTransfer ||
                !transferTargetEventId ||
                !transferTargetTicketId ||
                (availableTransferSubCategories.length > 0 && !transferTargetSubCategoryId) ||
                (transferDifferencePaisa > 0 && !transferConfirmPaymentReceived)
              }
            >
              {isProcessingTransfer && <Loader2 className="animate-spin mr-2 h-4 w-4" />} Confirm Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DETAIL MODAL */}
      <Dialog open={!!viewingParticipant} onOpenChange={(open) => !open && setViewingParticipant(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Participant Details</DialogTitle></DialogHeader>
          <div className="py-4">
            {viewingParticipant && <ParticipantDetailView participant={viewingParticipant} isViewOnlyAdmin={isViewOnlyAdmin} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
