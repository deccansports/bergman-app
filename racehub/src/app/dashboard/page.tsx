// src/app/dashboard/page.tsx
"use client";

import * as React from "react";
import Script from 'next/script'; // Import Script component
import { useEffect, useState, useCallback, Suspense, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { fetchRaceDataForUserFromFirestore } from '@/lib/actions';
import type { RaceResult, User, EventCalendarEntry, AthleteRegisteredEventDetail, ActiveDeferralInfo, ActiveCancellationInfo, TicketDefinition, DeferralCompletionDetails } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2, Trophy, CalendarSearch, ClipboardList, Info, List, Rocket, ExternalLink, Ticket, RotateCcw, CreditCard, XCircle as XCircleIcon, CheckCircle, Ban, HandCoins, RepeatIcon, ShieldAlert, Save, Users, User as UserIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { getCalendarEventsAction } from '@/lib/actions'; 
import { getTicketDefinitionsForEventAction } from '@/lib/actions/ticketActions';
import { getAthleteUpcomingRegisteredEventsAction, clearActiveCancellationNoticeAction } from '@/lib/actions/userActions';
import { getEligibleEventsForDeferralAction } from '@/lib/actions/deferralActions';
import { createCategoryChangeRazorpayOrderAction, verifyCategoryChangePaymentAndProcessAction, verifyAthleteDeferralUpgradePaymentAction, createDeferralFeeOrderAction, verifyDeferralFeePaymentAndProcessAction } from '@/lib/actions/paymentActions';
import EventDisplayCard from '@/components/events/EventDisplayCard';
import { Card, CardContent, CardFooter, CardHeader, CardDescription, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import CancellationRequestModal from '@/components/dashboard/CancellationRequestModal';
import DeferralRequestModal from '@/components/dashboard/DeferralRequestModal';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCountdown, CountdownTimeUnit } from '@/hooks/useCountdown';


import { RaceTable } from "@/components/dashboard/RaceTable";
import { EventSummary } from "@/components/dashboard/EventSummary";
import { UserProfile } from "@/components/dashboard/UserProfile";
import { YearlyRanking } from "@/components/dashboard/YearlyRanking";
import { YearlyProgressReport } from "@/components/dashboard/YearlyProgressReport";
import { Separator } from "@/components/ui/separator";
import { format, isPast, parseISO, differenceInDays, getYear, endOfYear, addYears, isToday, isEqual, subDays } from 'date-fns';
import { PLATFORM_FEE_PAISA, CATEGORY_CHANGE_FEE_PAISA, PAYMENT_GATEWAY_FEE_PERCENTAGE, CANCELLATION_GST_PERCENTAGE, CATEGORY_CHANGE_GST_PERCENTAGE, DEFERRAL_WINDOW_DAYS, CATEGORY_CHANGE_WINDOW_DAYS, DAYS_FOR_NO_REFUND_WINDOW, DEFERRAL_FEE_PAISA } from '@/lib/constants';
import { useRouter, useSearchParams } from 'next/navigation';
import FinishCard from '@/components/dashboard/FinishCard';


declare global {
  interface Window {
    Razorpay: any;
  }
}

function DashboardSkeleton() {
  return (
    <div className="max-w-6xl mx-auto w-full space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Skeleton className="h-56 md:col-span-1 rounded-lg shadow-md border-t-4 border-primary/30" />
        <div className="md:col-span-2 space-y-4">
          <Skeleton className="h-12 w-3/4 rounded-md" />
          <Skeleton className="h-8 w-1/2 rounded-md" />
           <Skeleton className="h-8 w-1/2 rounded-md" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 rounded-lg shadow-md" />)}
      </div>
      <Skeleton className="h-72 w-full rounded-lg shadow-md border-t-4 border-primary/30" />
      <Skeleton className="h-96 w-full rounded-lg shadow-md border-t-4 border-accent/30" />
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <Skeleton className="h-10 w-full sm:w-1/2 rounded-md" />
          <Skeleton className="h-10 w-full sm:w-[250px] rounded-md" />
        </div>
        <Skeleton className="h-[60vh] w-full rounded-lg shadow-md" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3 rounded-md" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-80 rounded-lg shadow-md" />)}
        </div>
      </div>
      <div className="space-y-4 mt-8">
        <Skeleton className="h-10 w-2/5 rounded-md" />
         <Skeleton className="h-48 w-full rounded-lg shadow-md" />
      </div>
    </div>
  );
}

const DeferralExpiryCountdown = ({ expiryDateString }: { expiryDateString: string }) => {
  const countdown = useCountdown(expiryDateString, '23:59');

  if (!countdown) {
    // Render a placeholder or nothing while waiting for client-side mount
    return <div className="mt-2 p-2 bg-orange-100/50 border border-orange-200 rounded-md h-[72px]" />;
  }

  const { days, hours, minutes, seconds, isPast } = countdown;
  
  if (isPast) {
    return <p className="text-sm font-semibold text-destructive">Deferral period has expired.</p>;
  }

  return (
    <div className="mt-2 p-2 bg-orange-100/50 border border-orange-200 rounded-md">
      <p className="text-xs text-center font-medium text-orange-700 mb-1">Time until deferral expires:</p>
      <div className="flex justify-around items-center gap-1.5 text-center">
        {days > 0 && <CountdownTimeUnit value={days} label="Days" />}
        <CountdownTimeUnit value={hours} label="Hours" />
        <CountdownTimeUnit value={minutes} label="Mins" />
        <CountdownTimeUnit value={seconds} label="Secs" />
      </div>
    </div>
  );
};


const ActionCountdown = ({ eventDate, windowDays, label, cardStyle = false }: { eventDate: string | null, windowDays: number, label: string, cardStyle?: boolean }) => {
    const deadlineDateString = useMemo(() => {
        if (!eventDate) return '';
        try {
            const deadlineDate = subDays(parseISO(eventDate), windowDays);
            return format(deadlineDate, 'yyyy-MM-dd');
        } catch (e) {
            return '';
        }
    }, [eventDate, windowDays]);

    const countdown = useCountdown(deadlineDateString, '23:59');

    if (!eventDate || !countdown || countdown.isPast) {
        if (cardStyle) {
             return (
                <div className="mt-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-center shadow-inner">
                    <p className="font-semibold text-destructive">{label} Window Closed</p>
                    <p className="text-xs text-destructive/80 mt-1">Must be requested at least {windowDays} days before the event.</p>
                </div>
             )
        }
        return <p className="text-xs text-muted-foreground">{label}: <span className="font-semibold text-destructive">Window Closed</span></p>;
    }

    const { days, hours, minutes } = countdown;

    if (cardStyle) {
        return (
            <div className="mt-3 p-3 bg-purple-100/50 border border-purple-200 rounded-lg shadow-inner">
                <p className="text-xs text-center font-medium text-purple-700 mb-2">{label} Window Closes In:</p>
                <div className="flex justify-around items-center gap-2 text-center text-purple-600">
                    <CountdownTimeUnit value={days} label="Days" />
                    <CountdownTimeUnit value={hours} label="Hours" />
                    <CountdownTimeUnit value={minutes} label="Mins" />
                </div>
            </div>
        );
    }
    
    return (
        <div className="text-xs text-muted-foreground">
            <p>{label}: <span className="font-semibold text-primary">{days}d {hours}h {minutes}m</span></p>
        </div>
    );
}


function DashboardPageContent() {
  const { currentUser: userFromAuth, firebaseUserFromAuth, loading: authLoading, isAuthenticating, fetchUserProfile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentUserRaces, setCurrentUserRaces] = useState<RaceResult[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showFinishCardForBookingId, setShowFinishCardForBookingId] = useState<string | null>(null);

  const [generalUpcomingEvents, setGeneralUpcomingEvents] = useState<EventCalendarEntry[]>([]);
  const [generalEventsLoading, setGeneralEventsLoading] = useState(true);

  const [userRegisteredEvents, setUserRegisteredEvents] = useState<AthleteRegisteredEventDetail[]>([]);
  const [userRegisteredEventsLoading, setUserRegisteredEventsLoading] = useState(true);

  const [eligibleDeferralEvents, setEligibleDeferralEvents] = useState<EventCalendarEntry[]>([]);
  const [eligibleDeferralEventsLoading, setEligibleDeferralEventsLoading] = useState(true);
  const [isDeferralModalOpen, setIsDeferralModalOpen] = useState(false);
  const [deferralTargetEvent, setDeferralTargetEvent] = useState<AthleteRegisteredEventDetail | null>(null);

  const [isCancellationModalOpen, setIsCancellationModalOpen] = useState(false);
  const [cancellationTargetEvent, setCancellationTargetEvent] = useState<AthleteRegisteredEventDetail | null>(null);

  const [isCategoryChangeModalOpen, setIsCategoryChangeModalOpen] = useState(false);
  const [categoryChangeTargetEvent, setCategoryChangeTargetEvent] = useState<AthleteRegisteredEventDetail | null>(null);
  const [categoryChangeTargetEventTickets, setCategoryChangeTargetEventTickets] = useState<TicketDefinition[]>([]);
  const [isLoadingCategoryChangeTickets, setIsLoadingCategoryChangeTickets] = useState(false);
  const [selectedNewTicketIdForCategoryChange, setSelectedNewTicketIdForCategoryChange] = useState<string | null>(null);
  const [agreedToCategoryChangeTerms, setAgreedToCategoryChangeTerms] = useState(false);
  const [categoryChangeCalculatedFees, setCategoryChangeCalculatedFees] = useState<{
    standardCategoryChangeFeePaisa: number;
    platformFeePaisa: number;
    gatewayFeeOnTopPaisa: number;
    originalTicketBasePricePaisa?: number;
    newTicketBasePricePaisa?: number;
    priceDifferencePaisa?: number;
    gstOnDifferencePaisa?: number;
    priceDifferenceComponentTotalPaisa?: number;
    totalPayablePaisa: number;
  } | null>(null);
  const [isProcessingCategoryChangePayment, setIsProcessingCategoryChangePayment] = useState(false);
  const [selectedEventIdForDeferredEvent, setSelectedEventIdForDeferredEvent] = useState<string | null>(null);
  const [isAlreadyRegisteredForSelectedDeferralEvent, setIsAlreadyRegisteredForSelectedDeferralEvent] = useState(false);


  const { toast } = useToast();

  const refreshRegisteredEvents = useCallback(async () => {
    if (userFromAuth?.uid) {
      setUserRegisteredEventsLoading(true);
      try {
        const result = await getAthleteUpcomingRegisteredEventsAction(userFromAuth.uid);
        if (result.success && result.events) {
          setUserRegisteredEvents(result.events);
        } else {
          setUserRegisteredEvents([]);
        }
      } catch (error: any) {
      } finally {
        setUserRegisteredEventsLoading(false);
      }
    }
  }, [userFromAuth]);


  useEffect(() => {
    let ignore = false;
    const fetchAllData = async () => {
      if (ignore) {
        return;
      }
      if (!authLoading && !isAuthenticating && userFromAuth?.uid) {
        setDataLoading(true);
        setFetchError(null);

        const userRacesPromise = fetchRaceDataForUserFromFirestore(userFromAuth.email, userFromAuth.personalRaceEmail)
          .then(result => {
            if (!ignore) {
              if (result && result.success && Array.isArray(result.races)) {
                setCurrentUserRaces(result.races);
              } else {
                setCurrentUserRaces([]);
                setFetchError(result?.message || 'Could not load your race data.');
              }
            }
          })
          .catch(error => { if (!ignore) setFetchError(error.message || 'Could not load your race data.'); });

        setGeneralEventsLoading(true);
        const generalEventsPromise = getCalendarEventsAction()
          .then(result => {
            if (!ignore) {
              if (result.success && result.events) {
                const now = new Date();
                const filteredUpcomingEvents = result.events.filter(event => {
                  if (event.eventDate === null) return true;
                  const eventEndDateTimeString = `${'${event.endDate || event.eventDate}'}T${'${event.endTime || \'23:59:59\'}'}`;
                  try { const eventEndDateTime = new Date(eventEndDateTimeString); return !isNaN(eventEndDateTime.getTime()) && eventEndDateTime >= now; }
                  catch (e) { return false; }
                }).sort((a, b) => { const dateA = a.eventDate ? new Date(a.eventDate).getTime() : Infinity; const dateB = b.eventDate ? new Date(b.eventDate).getTime() : Infinity; return dateA - dateB;});
                setGeneralUpcomingEvents(filteredUpcomingEvents);
              } else { setGeneralUpcomingEvents([]); }
            }
          })
          .catch(error => { if(!ignore) {  } })
          .finally(() => { if(!ignore) setGeneralEventsLoading(false); });

        const registeredEventsPromise = refreshRegisteredEvents();

        setEligibleDeferralEventsLoading(true);
        const eligibleDeferralEventsPromise = getEligibleEventsForDeferralAction()
          .then(result => {
            if(!ignore) {
              if (result.success && result.events) setEligibleDeferralEvents(result.events);
              else { setEligibleDeferralEvents([]); }
            }
          })
          .catch(error => { if(!ignore) {  } })
          .finally(() => { if(!ignore) setEligibleDeferralEventsLoading(false); });

        try { await Promise.all([userRacesPromise, generalEventsPromise, registeredEventsPromise, eligibleDeferralEventsPromise]); }
        finally { if (!ignore) setDataLoading(false); }
      } else if (!authLoading && !isAuthenticating) {
        setCurrentUserRaces([]); setGeneralUpcomingEvents([]); setUserRegisteredEvents([]); setEligibleDeferralEvents([]);
        setDataLoading(false); setGeneralEventsLoading(false); setUserRegisteredEventsLoading(false); setEligibleDeferralEventsLoading(false);
      }
    };
    fetchAllData();
    return () => { ignore = true; };
  }, [userFromAuth, authLoading, isAuthenticating, refreshRegisteredEvents]);
  
  useEffect(() => {
    const bookingId = searchParams.get('bookingId');
    if (bookingId) {
      setShowFinishCardForBookingId(bookingId);
      // Clean the URL
      router.replace('/dashboard', { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (userFromAuth?.activeDeferral?.deferredToEventId && !selectedEventIdForDeferredEvent) {
        console.log(`[Dashboard] Pre-setting deferred event ID from user profile: ${'${userFromAuth.activeDeferral.deferredToEventId}'}`);
        setSelectedEventIdForDeferredEvent(userFromAuth.activeDeferral.deferredToEventId);
    }
  }, [userFromAuth, selectedEventIdForDeferredEvent]);


  useEffect(() => { if (fetchError) toast({ variant: 'destructive', title: 'Your Race Data Error', description: fetchError, duration: 7000 }); }, [fetchError, toast]);

  const handleUserUpdate = useCallback((updatedData: Partial<User>) => { toast({ title: "Profile Updated", description: "Your profile information has been refreshed."}); }, [toast]);

  const handleOpenDeferralModal = (eventDetail: AthleteRegisteredEventDetail) => {
    setDeferralTargetEvent(eventDetail);
    setIsDeferralModalOpen(true);
  };
  const handleOpenCancellationModal = (eventDetail: AthleteRegisteredEventDetail) => { setCancellationTargetEvent(eventDetail); setIsCancellationModalOpen(true); };

  const handleOpenCategoryChangeModal = useCallback(async (eventDetail: AthleteRegisteredEventDetail) => {
    setCategoryChangeTargetEvent(eventDetail);
    setSelectedNewTicketIdForCategoryChange(null);
    setCategoryChangeCalculatedFees(null);
    setAgreedToCategoryChangeTerms(false);
    setIsCategoryChangeModalOpen(true);
    setIsLoadingCategoryChangeTickets(true);
    try {
      const result = await getTicketDefinitionsForEventAction(eventDetail.id);
      if (result.success && result.ticketDefinitions) {
        setCategoryChangeTargetEventTickets(result.ticketDefinitions);
      } else {
        setCategoryChangeTargetEventTickets([]);
      }
    } catch (error: any) {
      setCategoryChangeTargetEventTickets([]);
    } finally {
      setIsLoadingCategoryChangeTickets(false);
    }
  }, []);


  useEffect(() => {
    if (!categoryChangeTargetEvent || !selectedNewTicketIdForCategoryChange) {
        const standardFeeBasePaisa = CATEGORY_CHANGE_FEE_PAISA;
        const platformFeePaisa = PLATFORM_FEE_PAISA;
        const totalBeforeGatewayFee = standardFeeBasePaisa + platformFeePaisa;
        const gatewayFeeOnTopPaisa = Math.round(totalBeforeGatewayFee * (PAYMENT_GATEWAY_FEE_PERCENTAGE / 100));
        setCategoryChangeCalculatedFees({
          standardCategoryChangeFeePaisa: standardFeeBasePaisa,
          platformFeePaisa: platformFeePaisa,
          gatewayFeeOnTopPaisa: gatewayFeeOnTopPaisa,
          totalPayablePaisa: totalBeforeGatewayFee + gatewayFeeOnTopPaisa,
        });
        return;
    }

    const newTicketDef = categoryChangeTargetEventTickets.find(t => t.id === selectedNewTicketIdForCategoryChange);
    if (!newTicketDef || newTicketDef.price === null || newTicketDef.price === undefined) {
        setCategoryChangeCalculatedFees(null); // Or handle as free ticket if necessary
        return;
    }
    
    const originalTicketBasePricePaisa = 
        userFromAuth?.activeDeferral && userFromAuth.activeDeferral.status === 'Pending Ticket Selection'
            ? userFromAuth.activeDeferral.estimatedOriginalBasePricePaisa ?? 0
            : categoryChangeTargetEvent.originalAmountPaidAtFirstRegistrationPaisa ?? 0;

    const standardFeeBasePaisa = CATEGORY_CHANGE_FEE_PAISA;
    const platformFeePaisa = PLATFORM_FEE_PAISA;

    let priceDifferenceComponentTotalPaisa = 0;
    let newTicketBasePricePaisaCalc = newTicketDef.price;
    let priceDifferencePaisaCalc = 0;
    let gstOnDifferencePaisaCalc = 0;

    if (newTicketBasePricePaisaCalc > originalTicketBasePricePaisa) {
        priceDifferencePaisaCalc = newTicketBasePricePaisaCalc - originalTicketBasePricePaisa;
        gstOnDifferencePaisaCalc = Math.round(priceDifferencePaisaCalc * (CATEGORY_CHANGE_GST_PERCENTAGE / 100));
        priceDifferenceComponentTotalPaisa = priceDifferencePaisaCalc + gstOnDifferencePaisaCalc;
    }

    const totalBeforeGatewayFee = standardFeeBasePaisa + platformFeePaisa + priceDifferenceComponentTotalPaisa;
    const gatewayFeeOnTopPaisa = Math.round(totalBeforeGatewayFee * (PAYMENT_GATEWAY_FEE_PERCENTAGE / 100));

    setCategoryChangeCalculatedFees({
        standardCategoryChangeFeePaisa: standardFeeBasePaisa,
        platformFeePaisa: platformFeePaisa,
        gatewayFeeOnTopPaisa: gatewayFeeOnTopPaisa,
        originalTicketBasePricePaisa: originalTicketBasePricePaisa,
        newTicketBasePricePaisa: newTicketBasePricePaisaCalc,
        priceDifferencePaisa: priceDifferencePaisaCalc,
        gstOnDifferencePaisa: gstOnDifferencePaisaCalc,
        priceDifferenceComponentTotalPaisa: priceDifferenceComponentTotalPaisa,
        totalPayablePaisa: totalBeforeGatewayFee + gatewayFeeOnTopPaisa,
    });

}, [categoryChangeTargetEvent, selectedNewTicketIdForCategoryChange, categoryChangeTargetEventTickets, userFromAuth?.activeDeferral]);

  const handleActionSuccess = useCallback(async (actionType: 'deferral' | 'cancellation' | 'categoryChange') => {
    if (actionType === 'cancellation') setIsCancellationModalOpen(false);
    if (actionType === 'categoryChange') setIsCategoryChangeModalOpen(false);
    if (actionType === 'deferral') setIsDeferralModalOpen(false);
    setCancellationTargetEvent(null); setCategoryChangeTargetEvent(null); setDeferralTargetEvent(null);
    setSelectedNewTicketIdForCategoryChange(null); setCategoryChangeCalculatedFees(null); setAgreedToCategoryChangeTerms(false);
    setSelectedEventIdForDeferredEvent(null);
    
    if (firebaseUserFromAuth && fetchUserProfile) {
        console.log(`[DashboardPage] Action success for ${'${actionType}'}. Triggering profile refresh.`);
        await fetchUserProfile(firebaseUserFromAuth);
    }
    await refreshRegisteredEvents(); 
    
    toast({ title: `${'${actionType.charAt(0).toUpperCase() + actionType.slice(1)}'} Processed`, description: `Your ${actionType} request has been successfully processed.` });
  }, [firebaseUserFromAuth, fetchUserProfile, refreshRegisteredEvents, toast]);


  const handleRequestCategoryChange = async () => {
    if (!userFromAuth || !categoryChangeTargetEvent || !selectedNewTicketIdForCategoryChange || !categoryChangeCalculatedFees || categoryChangeCalculatedFees.totalPayablePaisa < 0) {
      toast({ variant: "destructive", title: "Error", description: "Missing data for category change or fee calculation error." });
      return;
    }
    if (!agreedToCategoryChangeTerms) {
        toast({ variant: "destructive", title: "Agreement Required", description: "You must agree to the terms to change category." });
        return;
    }
    const newTicketDef = categoryChangeTargetEventTickets.find(t => t.id === selectedNewTicketIdForCategoryChange);
    if (!newTicketDef) {
      toast({ variant: "destructive", title: "Error", description: "Selected new ticket not found." });
      return;
    }

    try {
      const orderInput = {
        originalEventId: categoryChangeTargetEvent.id,
        originalEventName: categoryChangeTargetEvent.eventName,
        originalParticipantId: categoryChangeTargetEvent.participantId!,
        newTicketId: newTicketDef.id,
        newTicketName: newTicketDef.ticketName,
        newTicketBasePricePaisa: newTicketDef.price || 0,
        originalTicketBasePricePaisa: categoryChangeCalculatedFees.originalTicketBasePricePaisa || 0,
        totalAmountToChargePaisa: categoryChangeCalculatedFees.totalPayablePaisa,
        feeBreakdown: {
            standardCategoryChangeFeePaisa: categoryChangeCalculatedFees.standardCategoryChangeFeePaisa,
            platformFeePaisa: categoryChangeCalculatedFees.platformFeePaisa,
            priceDifferencePaisa: categoryChangeCalculatedFees.priceDifferencePaisa,
            gstOnDifferencePaisa: categoryChangeCalculatedFees.gstOnDifferencePaisa,
            gatewayFeeOnTopPaisa: categoryChangeCalculatedFees.gatewayFeeOnTopPaisa,
        },
        athleteUid: userFromAuth.uid,
        athleteEmail: userFromAuth.email!,
        athleteName: userFromAuth.name!,
      };
      
      const orderResult = await createCategoryChangeRazorpayOrderAction(orderInput);

      if (!orderResult.success || !orderResult.orderId) {
        toast({ variant: "destructive", title: "Payment Error", description: orderResult.message || "Could not create payment order." });
        return;
      }
      
      const razorpayOptions = {
        key: orderResult.keyId,
        amount: orderResult.amount,
        currency: orderResult.currency,
        name: `Bergman - Category Change`,
        description: `Fee for ${categoryChangeTargetEvent.eventName}`,
        order_id: orderResult.orderId,
        handler: async function (response: any) {
            setIsProcessingCategoryChangePayment(true);
            const verificationResult = await verifyCategoryChangePaymentAndProcessAction({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
                ...orderInput
            });
            if(verificationResult.success) {
                handleActionSuccess('categoryChange');
            } else {
                toast({ variant: "destructive", title: "Verification Failed", description: verificationResult.message });
            }
            setIsProcessingCategoryChangePayment(false);
        },
        prefill: { name: userFromAuth.name, email: userFromAuth.email, contact: userFromAuth.mobile },
        notes: orderResult.notes,
        theme: { color: "#8B5CF6" },
         modal: {
          ondismiss: function() {
            toast({variant: "default", title:"Payment Cancelled", description: "Category change payment was not completed."})
            setIsProcessingCategoryChangePayment(false);
          }
        }
      };

      if (typeof window.Razorpay !== 'function') {
          toast({ variant: "destructive", title: "Payment Gateway Error", description: "Razorpay script did not load. Please refresh and try again."});
          return;
      }

      const rzp = new window.Razorpay(razorpayOptions);
      rzp.on('payment.failed', (response: any) => {
        toast({ variant: "destructive", title: "Payment Failed", description: response.error.description || "An error occurred."});
        setIsProcessingCategoryChangePayment(false);
      });
      rzp.open();

    } catch (err: any) {
      toast({ variant: "destructive", title: "Category Change Error", description: err.message || "Could not initiate category change." });
    }
  };


  useEffect(() => {
    if (selectedEventIdForDeferredEvent) {
      const alreadyRegistered = userRegisteredEvents.some(regEvent => regEvent.id === selectedEventIdForDeferredEvent && regEvent.ticketStatus === 'Active');
      setIsAlreadyRegisteredForSelectedDeferralEvent(alreadyRegistered);
      if (alreadyRegistered) {
        toast({ variant: "destructive", title: "Already Registered", description: "You are already registered for this event. Please choose a different event.", duration: 7000 });
      }
    } else {
      setIsAlreadyRegisteredForSelectedDeferralEvent(false);
    }
  }, [selectedEventIdForDeferredEvent, userRegisteredEvents, toast]);

  const handleProceedToDeferralForm = useCallback(() => {
    if (!userFromAuth?.activeDeferral || !selectedEventIdForDeferredEvent || isAlreadyRegisteredForSelectedDeferralEvent) {
        toast({ variant: "destructive", title: "Error", description: "Invalid state for completing deferral." });
        return;
    }

    const chosenEvent = eligibleDeferralEvents.find(e => e.id === selectedEventIdForDeferredEvent);
    if (!chosenEvent?.customSlug) {
        toast({ variant: "destructive", title: "Error", description: "The selected event does not have a registration form configured." });
        return;
    }
    
    const queryParams = new URLSearchParams({
        deferralId: userFromAuth.activeDeferral.deferralId,
        originalTicketId: userFromAuth.activeDeferral.originalTicketId || 'unknown'
    });
    router.push(`/event-form/${'${chosenEvent.customSlug}'}?${'${queryParams.toString()}'}`);

  }, [userFromAuth, selectedEventIdForDeferredEvent, isAlreadyRegisteredForSelectedDeferralEvent, eligibleDeferralEvents, router, toast]);

  const handleDismissCancellation = async () => {
    if (!userFromAuth?.uid) return;
    const result = await clearActiveCancellationNoticeAction(userFromAuth.uid);
    if (result.success) {
      toast({ title: "Notice Dismissed", description: "The cancellation notice has been cleared." });
      if (fetchUserProfile && firebaseUserFromAuth) {
        await fetchUserProfile(firebaseUserFromAuth);
      }
    } else {
      toast({ variant: "destructive", title: "Error", description: result.message });
    }
  };

  const firstDeferrableEvent = useMemo(() => {
    if (userRegisteredEventsLoading || userFromAuth?.activeDeferral) {
        return null;
    }
    return userRegisteredEvents.find(e => e.canBeDeferred && e.ticketStatus === 'Active');
  }, [userRegisteredEvents, userRegisteredEventsLoading, userFromAuth]);


  const renderActiveCancellationInfo = () => {
    if (!userFromAuth || !userFromAuth.activeCancellation) return null;
    const { activeCancellation } = userFromAuth;
    
    if (activeCancellation.status === 'Requested' && (!activeCancellation.expectedRefundAmountPaisa || activeCancellation.expectedRefundAmountPaisa <= 0)) {
        return null; // Hide card if no refund is expected
    }

    let title = "Cancellation Request Status";
    let message = "";
    let cardClass = "bg-yellow-500/10 border-yellow-600";
    let icon = <Info className="h-5 w-5 text-yellow-700" />;
    let isDismissible = false;

    switch (activeCancellation.status) {
      case 'Requested':
        title = "Cancellation Requested";
        message = `Your cancellation request for ${activeCancellation.eventName} is pending admin review. Expected refund (if any): ₹${'${((activeCancellation.expectedRefundAmountPaisa || 0) / 100).toFixed(2)}'}.`;
        break;
      case 'Processing':
        title = "Refund Initiated";
        message = `Your refund for ${activeCancellation.eventName} is being processed. Initiated: ${'${activeCancellation.refundInitiatedDate ? format(parseISO(activeCancellation.refundInitiatedDate), \'MMM dd, yyyy\') : \'N/A\'}'}. TxID: ${'${activeCancellation.refundTransactionId || \'Pending Admin Update\'}'}.`;
        cardClass = "bg-blue-500/10 border-blue-600";
        icon = <Loader2 className="h-5 w-5 text-blue-700 animate-spin" />;
        isDismissible = true;
        break;
      case 'Refunded':
        title = "Cancellation Confirmed & Refunded";
        message = `Your cancellation for ${activeCancellation.eventName} has been confirmed and refund processed. Initiated: ${'${activeCancellation.refundInitiatedDate ? format(parseISO(activeCancellation.refundInitiatedDate), \'MMM dd, yyyy\') : \'N/A\'}'}. TxID: ${'${activeCancellation.refundTransactionId || \'N/A\'}'}.`;
        cardClass = "bg-green-600/10 border-green-700";
        icon = <CheckCircle className="h-5 w-5 text-green-700" />;
        isDismissible = true;
        break;
      case 'Denied':
        title = "Cancellation Denied";
        message = `Your cancellation request for ${activeCancellation.eventName} was not approved. Please check your email or contact support for details.`;
        cardClass = "bg-destructive/10 border-destructive";
        icon = <XCircleIcon className="h-5 w-5 text-destructive" />;
        isDismissible = true;
        break;
      default:
        return null;
    }
    return (
      <Card className={`${'${cardClass}'} shadow-md`}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">{icon} {title}</div>
            {isDismissible && (
              <Button variant="ghost" size="xs" onClick={handleDismissCancellation} className="h-6 w-6 p-0 text-muted-foreground hover:bg-black/10">
                <XCircleIcon className="h-4 w-4" />
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent><p>{message}</p></CardContent>
      </Card>
    );
  };


  const renderDeferralSection = () => {
    if (!userFromAuth || !userFromAuth.activeDeferral) {
      return null;
    }
    const { activeDeferral } = userFromAuth;

    if (['Used', 'Confirmed', 'RevokedByAdmin'].includes(activeDeferral.status)) {
        console.log(`[DashboardPage] renderDeferralSection: Hiding card because activeDeferral status is terminal: ${'${activeDeferral.status}'}.`);
        return null;
    }
    
    const expiryDate = activeDeferral.expiryDate ? parseISO(activeDeferral.expiryDate) : null;
    const isExpired = expiryDate ? isPast(expiryDate) && !isToday(expiryDate) : false;

    if (isExpired && activeDeferral.status !== 'Used' && activeDeferral.status !== 'Confirmed') {
      return (
        <Card className="bg-destructive/10 border-destructive shadow-md">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle /> Deferral Expired
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p>Your deferral from <strong>{activeDeferral.originalEventName}</strong> (issued {activeDeferral.deferralDate ? format(parseISO(activeDeferral.deferralDate), 'MMM dd, yyyy') : 'N/A'}) expired on {expiryDate ? format(expiryDate, 'MMM dd, yyyy') : 'N/A'}.</p>
          </CardContent>
        </Card>
      );
    }
    
    if (activeDeferral.status === 'ProcessingConfirmation') {
      return (
        <Card className="bg-blue-500/10 border-blue-600 shadow-md">
          <CardHeader>
            <CardTitle className="text-blue-700 flex items-center gap-2"><Loader2 className="animate-spin" /> Processing Your Choice</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Your ticket selection for the deferred event is currently being processed. Please wait a moment. This card will update once complete.</p>
            {activeDeferral.expiryDate && !isExpired && <DeferralExpiryCountdown expiryDateString={activeDeferral.expiryDate!} />}
          </CardContent>
        </Card>
      );
    }

    if (activeDeferral.status === 'Pending Ticket Selection' || activeDeferral.status === 'TBD') {
        const validEligibleEvents = eligibleDeferralEvents.filter(e => e.id && e.id.trim() !== '');

        return (
            <Card className="bg-orange-500/10 border-orange-600 shadow-md">
                <CardHeader>
                    <CardTitle className="text-orange-700 flex items-center gap-2"><CalendarSearch /> Choose Your Event</CardTitle>
                    <CardDescription className="text-orange-600 text-sm mt-1">
                        You have an active deferral from <strong>{activeDeferral.originalEventName || 'a previous event'}</strong>.
                        This deferral must be used for an event occurring on or before <strong className="font-semibold">{activeDeferral.expiryDate ? format(parseISO(activeDeferral.expiryDate), 'MMM dd, yyyy') : 'N/A'}</strong>.
                        Please select an upcoming event to proceed to its registration form.
                    </CardDescription>
                    {activeDeferral.expiryDate && !isExpired && <DeferralExpiryCountdown expiryDateString={activeDeferral.expiryDate} />}
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="deferredEventSelect" className="text-sm font-medium text-foreground">1. Select Event to Defer To:</Label>
                        {activeDeferral.deferredToEventId ? (
                            <div className="p-2 border rounded-md bg-muted text-sm">
                                <span className="font-semibold">{activeDeferral.deferredToEventName || 'Selected Event'}</span>
                                <p className="text-xs text-muted-foreground">This event was chosen during your deferral request. Proceed to its registration form below.</p>
                            </div>
                        ) : (
                            <Select value={selectedEventIdForDeferredEvent || ""} onValueChange={setSelectedEventIdForDeferredEvent} disabled={eligibleDeferralEventsLoading}>
                                <SelectTrigger id="deferredEventSelect"><SelectValue placeholder="Choose event..." /></SelectTrigger>
                                <SelectContent>
                                    {eligibleDeferralEventsLoading ? (<SelectItem value="loading-events" disabled>Loading events...</SelectItem>)
                                    : validEligibleEvents.length > 0 ? (validEligibleEvents.map(event => (<SelectItem key={event.id} value={event.id}>{event.eventName} ({event.eventDate ? format(parseISO(event.eventDate), 'MMM dd, yyyy') : 'TBD'})</SelectItem>)))
                                    : (<SelectItem value="no-eligible-events" disabled>No eligible future events found.</SelectItem>)}
                                </SelectContent>
                            </Select>
                        )}
                         {isAlreadyRegisteredForSelectedDeferralEvent && (
                            <Alert variant="destructive" className="mt-2 text-xs">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>Already Registered</AlertTitle>
                                <AlertDescription>You are already registered for this event. Please choose a different event.</AlertDescription>
                            </Alert>
                        )}
                    </div>
                </CardContent>
                <CardFooter>
                    <Button
                        onClick={handleProceedToDeferralForm}
                        disabled={!selectedEventIdForDeferredEvent || isAlreadyRegisteredForSelectedDeferralEvent}
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                    >
                         <CheckCircle className="mr-2 h-4 w-4" />
                        Proceed to Registration Form
                    </Button>
                </CardFooter>
            </Card>
        );
    }


    if (activeDeferral.status === 'Pending Upgrade Payment' && activeDeferral.upgradePaymentOrderId) {
        return (
            <Card className="bg-yellow-500/10 border-yellow-600 shadow-md">
                <CardHeader>
                    <CardTitle className="text-yellow-700 flex items-center gap-2"><Loader2 className="animate-spin" /> Deferral Upgrade Payment Pending</CardTitle>
                    {activeDeferral.expiryDate && !isExpired && <DeferralExpiryCountdown expiryDateString={activeDeferral.expiryDate} />}
                </CardHeader>
                <CardContent>
                    <p>Your ticket choice for <strong>{activeDeferral.deferredToEventName}</strong> (Ticket: {activeDeferral.deferredToTicketName}) requires an upgrade payment of <strong>₹{((activeDeferral.amountDueForUpgradePaisa || 0) / 100).toFixed(2)}</strong>.</p>
                    <p className="mt-2">Order ID: <strong>{activeDeferral.upgradePaymentOrderId}</strong>. Please complete the payment via the link/method provided by Razorpay or contact support if you have not received it.</p>
                    <p className="text-xs mt-1">Once payment is confirmed, your registration will be finalized.</p>
                </CardContent>
            </Card>
        );
    }

    if (activeDeferral.status === 'Pending' && activeDeferral.code) return (<Card className="bg-yellow-500/10 border-yellow-600 shadow-md"><CardHeader><CardTitle className="text-yellow-700 flex items-center gap-2"><Info /> Deferral Pending</CardTitle>{activeDeferral.expiryDate && !isExpired && <DeferralExpiryCountdown expiryDateString={activeDeferral.expiryDate} />}</CardHeader><CardContent><p>Your deferral from <strong>{activeDeferral.originalEventName}</strong> is pending. A deferral code <code className="font-mono bg-yellow-200 text-yellow-800 px-1.5 py-0.5 rounded-sm">{activeDeferral.code}</code> was sent to you on {activeDeferral.deferralDate ? format(parseISO(activeDeferral.deferralDate), 'MMM dd, yyyy') : 'N/A'}. This deferral is valid for events until <strong className="text-yellow-800">{activeDeferral.expiryDate ? format(parseISO(activeDeferral.expiryDate), 'MMM dd, yyyy') : 'N/A'}</strong>. Please use this code when registering for your next event.</p></CardContent></Card>);
    
    return null;
  };
  
  const renderDeferralAvailableInfo = () => {
    if (!firstDeferrableEvent) {
      return null;
    }

    const handleScrollToEvents = () => {
      document.getElementById('your-registered-events-section')?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
      <Card className="bg-blue-500/10 border-blue-600 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-700">
            <RotateCcw className="h-5 w-5" /> Deferral Available for Your Upcoming Race
          </CardTitle>
          <CardDescription className="text-blue-600">
            You are eligible to defer your registration for <strong>{firstDeferrableEvent.eventName}</strong>. If your plans have changed, you can request a deferral to a future event for a fee.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={handleScrollToEvents} className="bg-blue-600 hover:bg-blue-700">
            Manage Your Registrations
          </Button>
        </CardFooter>
      </Card>
    );
  };

  const finishedRaceForCard = useMemo(() => {
    if (!showFinishCardForBookingId || currentUserRaces.length === 0) return null;
    // This is a simplification. A robust solution might need to check against a participant record by bookingId.
    // For now, we find the most recent finished race.
    return currentUserRaces.find(r => r.status === 'Finished') || null;
  }, [showFinishCardForBookingId, currentUserRaces]);


  if (authLoading || isAuthenticating || (userFromAuth && dataLoading && !fetchError) ) return <DashboardSkeleton />;
  if (!userFromAuth) return (<div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-muted-foreground">Verifying user session...</p></div>);
  const combinedError = fetchError;

  return (
    <>
      <Script
          id="razorpay-checkout-js-dashboard"
          src="https://checkout.razorpay.com/v1/checkout.js"
          strategy="lazyOnload"
      />
      <div className="flex justify-center">
          <div className="w-full max-w-6xl space-y-8">
              {finishedRaceForCard && (
                <FinishCard race={finishedRaceForCard} onDismiss={() => setShowFinishCardForBookingId(null)} />
              )}

              <UserProfile user={userFromAuth} onUpdate={handleUserUpdate} />
              {combinedError && (<Alert variant="destructive" className="shadow-md"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error Loading Race Data</AlertTitle><AlertDescription>{fetchError && <p>Your races: {fetchError}</p>}<p className='mt-2 text-xs'>Some features might be limited. Try refreshing.</p></AlertDescription></Alert>)}

              {renderDeferralAvailableInfo()}
              {renderDeferralSection()}
              {userFromAuth?.activeCancellation && renderActiveCancellationInfo()}
              { (userFromAuth?.activeDeferral || (userFromAuth?.activeCancellation && userFromAuth.activeCancellation.expectedRefundAmountPaisa > 0) || firstDeferrableEvent) && <Separator className="my-8" />}


              <EventSummary races={currentUserRaces} />
              <YearlyRanking currentUser={userFromAuth} />
              <YearlyProgressReport currentUserRaces={currentUserRaces} currentUser={userFromAuth}/>
              <Separator className="my-8" />
              <div id="your-registered-events-section"><h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2"><ClipboardList className="h-6 w-6 text-primary" />Your Registered Upcoming Events</h2><p className="text-sm text-muted-foreground mt-1">Events you are registered for. Manage deferrals or cancellations if eligible.</p></div>
              {userRegisteredEventsLoading ? (<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"><Skeleton className="h-60 rounded-lg shadow-md" /><Skeleton className="h-60 rounded-lg shadow-md md:col-span-2" /></div>)
              : userRegisteredEvents.length > 0 ? (<Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow><TableHead>Athlete Name</TableHead><TableHead>Event Name</TableHead><TableHead>Event Date</TableHead><TableHead>Your Ticket</TableHead><TableHead>BIB NO</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                  <TableBody>{userRegisteredEvents.map(event => {
                    let actionContent;

                    if (event.ticketStatus === 'Active') {
                      actionContent = (
                        <div className="flex items-center gap-2 flex-wrap">
                            {event.canBeDeferred ? (
                                <Button variant="outline" size="xs" onClick={() => handleOpenDeferralModal(event)} className="text-xs border-orange-500 text-orange-600 hover:bg-orange-50" disabled={!!userFromAuth?.activeDeferral}>
                                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Defer
                                </Button>
                            ) : (
                                <p className="text-xs text-muted-foreground px-2">{event.deferralMessage}</p>
                            )}

                            {event.canBeCancelled ? (
                              <Button variant="outline" size="xs" onClick={() => handleOpenCancellationModal(event)} className="text-xs border-red-500 text-red-600 hover:bg-red-50" disabled={!!event.previousDeferralDetails || !(event.amountPaidPaisa && event.amountPaidPaisa > 0)}>
                                <XCircleIcon className="mr-1.5 h-3.5 w-3.5" /> Cancel
                              </Button>
                            ) : (
                              <p className="text-xs text-muted-foreground px-2">{event.refundPolicyApplied || 'Cancellation window closed.'}</p>
                            )}

                            {event.canChangeCategory ? (
                                <Button variant="outline" size="xs" onClick={() => handleOpenCategoryChangeModal(event)} className="text-xs border-purple-500 text-purple-600 hover:bg-purple-50">
                                  <RepeatIcon className="mr-1.5 h-3.5 w-3.5" /> Change Category
                                </Button>
                            ) : (
                              <p className="text-xs text-muted-foreground px-2">{event.categoryChangeMessage}</p>
                            )}
                        </div>
                      );
                    } else if (event.previousDeferralDetails) {
                      actionContent = (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="text-xs bg-yellow-100 text-yellow-700 border-yellow-300 cursor-default flex items-center gap-1">
                                <RotateCcw className="h-3 w-3" /> Previously Deferred
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-sm">This registration resulted from a previous deferral and cannot be deferred or cancelled again.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    } else if (event.ticketStatus === 'Deferred') {
                      actionContent = (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-blue-300 cursor-default">System Deferred</Badge>
                            </TooltipTrigger>
                            <TooltipContent><p>This registration has been deferred by the system. No further actions available.</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    } else if (event.ticketStatus === 'Cancelled') {
                      actionContent = (
                          <TooltipProvider>
                              <Tooltip>
                                  <TooltipTrigger asChild>
                                      <Badge variant="destructive" className="text-xs cursor-default">Cancelled</Badge>
                                  </TooltipTrigger>
                                  <TooltipContent><p>This registration has been cancelled. No further actions available.</p></TooltipContent>
                              </Tooltip>
                          </TooltipProvider>
                      );
                    } else {
                      actionContent = (
                          <TooltipProvider>
                              <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="outline" className="text-xs cursor-default">{event.ticketStatus || 'Status Unknown'}</Badge>
                                  </TooltipTrigger>
                                  <TooltipContent><p>Current ticket status: {event.ticketStatus || 'Unknown'}. Actions may be limited.</p></TooltipContent>
                              </Tooltip>
                          </TooltipProvider>
                      );
                    }

                    return (
                      <TableRow key={`reg-${'${event.id}'}-${'${event.participantId}'}`}>
                          <TableCell className="font-medium">
                              {event.athleteName || <span className="text-muted-foreground text-xs">N/A</span>}
                          </TableCell>
                          <TableCell>
                              {event.eventName}
                          </TableCell>
                          <TableCell>{event.eventDate ? format(parseISO(event.eventDate), 'MMM dd, yyyy') : 'TBD'}{event.startTime && <span className="text-xs text-muted-foreground ml-1">({event.startTime})</span>}</TableCell>
                          <TableCell>{event.ticketName || <span className="text-muted-foreground text-xs">N/A</span>}</TableCell>
                          <TableCell>{event.athleteBibNumber || <span className="text-muted-foreground text-xs">N/A</span>}</TableCell>
                          <TableCell className="space-x-1.5">
                              {actionContent}
                          </TableCell>
                      </TableRow>
                    );
                  })}</TableBody>
              </Table></div></CardContent></Card>)
              : (<Card className="bg-secondary/30 border-primary/30"><CardContent className="p-6 text-center space-y-2"><ClipboardList className="h-10 w-10 text-primary mx-auto mb-3" /><p className="text-lg font-semibold text-foreground">No upcoming events registered.</p><p className="text-muted-foreground">Register for an event to see it here.</p><p className="text-xs text-muted-foreground">If you believe this is a mistake, contact <a href="mailto:info@bergmantri.com" className="underline text-primary">info@bergmantri.com</a>.</p></CardContent></Card>)}
              <Separator className="my-8" />
              <div id="upcoming-bergman-events-section"><h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2"><CalendarSearch className="h-6 w-6 text-accent" />Upcoming Bergman Events (All)</h2><p className="text-sm text-muted-foreground mt-1">Choose and register for your event! Some events use our direct registration form, others use an external link. Dates might be &quot;TBD&quot;.</p></div>
              {generalEventsLoading ? (<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{[...Array(3)].map((_, i) => <Skeleton key={`gen-skel-${i}`} className="h-80 rounded-lg shadow-md" />)}</div>)
              : generalUpcomingEvents.length > 0 ? (<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{generalUpcomingEvents.map(event => (<EventDisplayCard key={`gen-${event.id}`} event={event} />))}</div>)
              : (<Card className="bg-secondary/30 border-accent/30"><CardContent className="p-6 text-center"><CalendarSearch className="h-10 w-10 text-accent mx-auto mb-3" /><p className="text-lg font-semibold text-foreground">No general upcoming events scheduled.</p><p className="text-muted-foreground mt-1">Check back soon for new announcements!</p></CardContent></Card>)}
              <Separator className="my-8" />
              <h2 className="text-2xl font-bold tracking-tight text-foreground pt-4 border-b pb-2">Your Races</h2>
              <RaceTable races={currentUserRaces} />
              {cancellationTargetEvent && userFromAuth && (<Suspense fallback={<div>Loading...</div>}><CancellationRequestModal isOpen={isCancellationModalOpen} onClose={() => { setIsCancellationModalOpen(false); setCancellationTargetEvent(null); }} eventDetail={cancellationTargetEvent} athleteUid={userFromAuth.uid} athleteEmail={userFromAuth.email || ''} onCancellationSuccess={() => handleActionSuccess('cancellation')} /></Suspense>)}
              {deferralTargetEvent && userFromAuth && (<Suspense fallback={<div>Loading...</div>}><DeferralRequestModal isOpen={isDeferralModalOpen} onClose={() => setIsDeferralModalOpen(false)} eventDetail={deferralTargetEvent} onDeferralSuccess={() => handleActionSuccess('deferral')} /></Suspense>)}


              {categoryChangeTargetEvent && userFromAuth && (
                <Dialog modal={false} open={isCategoryChangeModalOpen} onOpenChange={(isOpen) => { setIsCategoryChangeModalOpen(isOpen); if (!isOpen) { setCategoryChangeTargetEvent(null); setAgreedToCategoryChangeTerms(false);} }}>
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2"><RepeatIcon className="h-5 w-5 text-purple-600" /> Request Ticket Change</DialogTitle>
                      <DialogDescription className="text-sm text-muted-foreground">
                        For event: <strong>{categoryChangeTargetEvent.eventName}</strong> on {categoryChangeTargetEvent.eventDate ? format(parseISO(categoryChangeTargetEvent.eventDate), 'MMM dd, yyyy') : 'Date TBD'}.
                        <br/>Current Ticket: {categoryChangeTargetEvent.ticketName || 'N/A'}
                      </DialogDescription>
                      <ActionCountdown eventDate={categoryChangeTargetEvent.eventDate} windowDays={CATEGORY_CHANGE_WINDOW_DAYS} label="Time left to Change" cardStyle={true}/>
                    </DialogHeader>
                    <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                      {isLoadingCategoryChangeTickets ? (
                        <div className="flex items-center justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-purple-600" /><p className="ml-2 text-sm">Loading available tickets...</p></div>
                      ) : categoryChangeTargetEventTickets.length > 0 ? (
                        <div className="space-y-2">
                          <Label htmlFor="newTicketSelect" className="text-sm font-medium">Select New Ticket Type:</Label>
                          <Select
                            value={selectedNewTicketIdForCategoryChange || ""}
                            onValueChange={setSelectedNewTicketIdForCategoryChange}
                            disabled={isProcessingCategoryChangePayment}
                          >
                            <SelectTrigger id="newTicketSelect"><SelectValue placeholder="Choose new ticket..." /></SelectTrigger>
                            <SelectContent>
                              {categoryChangeTargetEventTickets.map(ticket => (
                                <SelectItem key={ticket.id} value={ticket.id} disabled={ticket.id === categoryChangeTargetEvent.ticketId}>
                                  {ticket.ticketName} ({ticket.ticketType === 'Paid' && ticket.price != null ? `₹${(ticket.price / 100).toFixed(2)}` : 'Free'})
                                  {ticket.id === categoryChangeTargetEvent.ticketId && " (Current)"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No other ticket types available for this event.</p>
                      )}

                      {categoryChangeCalculatedFees && (
                        <div className="text-xs space-y-1 mt-3 p-3 border rounded-md bg-muted/30">
                          <h4 className="font-semibold text-sm mb-1.5 text-foreground">Fee Breakdown:</h4>
                          <p>Category Change Fee (incl. GST): ₹{(categoryChangeCalculatedFees.standardCategoryChangeFeePaisa / 100).toFixed(2)}</p>
                          <p>Platform Fee: ₹{(categoryChangeCalculatedFees.platformFeePaisa / 100).toFixed(2)}</p>
                          
                          {categoryChangeCalculatedFees.priceDifferencePaisa !== undefined && categoryChangeCalculatedFees.priceDifferencePaisa > 0 && selectedNewTicketIdForCategoryChange && (
                            <>
                              <p>Ticket Price Difference: ₹{(categoryChangeCalculatedFees.priceDifferencePaisa / 100).toFixed(2)}</p>
                              <p>GST on Difference ({CATEGORY_CHANGE_GST_PERCENTAGE}%): + ₹{((categoryChangeCalculatedFees.gstOnDifferencePaisa || 0) / 100).toFixed(2)}</p>
                            </>
                          )}
                          <p>Payment Gateway Fee ({PAYMENT_GATEWAY_FEE_PERCENTAGE}%): ₹{((categoryChangeCalculatedFees.gatewayFeeOnTopPaisa || 0) / 100).toFixed(2)}</p>
                          <hr className="my-1.5 border-primary/50" />
                          <p className="font-bold text-primary text-base">Total Amount Payable: ₹{(categoryChangeCalculatedFees.totalPayablePaisa / 100).toFixed(2)}</p>
                          <p className="text-muted-foreground text-[10px] italic">This amount includes all applicable fees and taxes.</p>
                        </div>
                      )}
                      <div className="p-3 bg-muted/50 border border-border rounded-md mt-3">
                          <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5 text-foreground"><ShieldAlert className="h-4 w-4 text-amber-600"/>Ticket Change Policy:</h4>
                          <div className="space-y-1 text-xs text-muted-foreground whitespace-pre-line max-h-24 overflow-y-auto pr-1 custom-scrollbar">
                            <p>1. A standard category change fee of **₹{((CATEGORY_CHANGE_FEE_PAISA) / 100).toFixed(2)}/- plus platform fees** applies. Must be requested at least **${CATEGORY_CHANGE_WINDOW_DAYS} days** prior to event.</p>
                            <p>2. If changing to a higher-priced category, you pay the standard fee PLUS the ticket price difference (with GST).</p>
                            <p>3. If changing to a lower-priced category, the standard fee applies; no refund for price difference.</p>
                          </div>
                      </div>
                      <div className="flex items-center space-x-2 pt-3">
                          <Checkbox id="category-change-terms" checked={agreedToCategoryChangeTerms} onCheckedChange={(checked) => setAgreedToCategoryChangeTerms(checked as boolean)} disabled={isProcessingCategoryChangePayment} />
                          <Label htmlFor="category-change-terms" className="text-xs cursor-pointer text-muted-foreground leading-tight">
                              I have read and agree to the Ticket Change Rules &amp; Regulations.
                          </Label>
                      </div>
                    </div>
                    <DialogFooter>
                      <DialogClose asChild><Button variant="outline" disabled={isProcessingCategoryChangePayment} onClick={() => setAgreedToCategoryChangeTerms(false)}>Cancel</Button></DialogClose>
                      <Button
                        onClick={handleRequestCategoryChange}
                        disabled={isProcessingCategoryChangePayment || !selectedNewTicketIdForCategoryChange || !categoryChangeCalculatedFees || categoryChangeTargetEventTickets.length === 0 || !agreedToCategoryChangeTerms}
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        {isProcessingCategoryChangePayment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                        Proceed to Pay &amp; Change
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
          </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
    return (
        <Suspense fallback={<DashboardSkeleton />}>
            <DashboardPageContent />
        </Suspense>
    );
}
