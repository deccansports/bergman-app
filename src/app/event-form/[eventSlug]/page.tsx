// src/app/event-form/[eventSlug]/page.tsx
"use client";

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { EventCalendarEntry, TicketDefinition, PublicUserProfileData, DeferralEntry, Coupon, ParticipantWithProfile, FeeDetails, HomepageSliderItem, RegistrationAttempt, PricingBreakdown, WaitlistEntry } from '@/lib/types';
import { 
  getEventBySlugAction, 
  getEventDetailsWithTicketsAction, 
  getPublicFinalResultsAction, 
  getDistinctEventsFromResultsAction, 
  getAthleteRankingData,
  getHomepageSliderItemsAction,
  getDeferralDetailsByIdAction,
  checkParticipantRegistrationByEmail,
  getParticipantForEventByEmailAction,
  unlockEventRegistrationWithAccessCodeAction,
  verifyEventRegistrationPaymentAndFinalizeAction,
  listWaitlistEntriesAction,
} from '@/lib/actions';
import { getWaitlistCodeForEntryAction, getWaitlistFormByEventAction } from '@/lib/actions/waitlistActions';
import { createEventTicketOrderAction, submitPublicEventRegistrationAction } from '@/lib/actions';
import { syncUserDataFromParticipantsAction } from '@/lib/actions/userDataSyncActions';
import EventRegistrationForm from '@/components/events/EventRegistrationForm';
import { RelayRegistrationForm } from '@/components/relay/RelayRegistrationForm';
import CourseMapDialog from '@/components/events/CourseMapDialog';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Ticket, CalendarDays, ArrowLeft, AlertTriangle, ShieldCheck, CheckCircle2, Map, Ban } from 'lucide-react';
import { format, parseISO, isValid as isDateValid, startOfDay } from 'date-fns';
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger } from '@/components/ui/dialog';
import ParticipantDetailView from '@/components/admin/ParticipantDetailView';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useCountdown, CountdownTimeUnit } from '@/hooks/useCountdown';
import { GST_PERCENTAGE } from '@/lib/constants';
import { getEventRegistrationButtonState, isTicketHidden } from '@/lib/utils';


declare global {
  interface Window {
    Razorpay: any;
  }
}

const CountdownDisplay = ({ date, time }: { date: string | null | undefined, time?: string | null }) => {
  const countdown = useCountdown(date || '', time ?? '00:00');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="mt-4 p-3 bg-black/20 border border-white/10 rounded-lg shadow-inner h-[72px]" />
    );
  }

  if (!countdown || countdown.isPast) {
    return null;
  }

  return (
    <div className="mt-4 p-3 bg-black/20 border border-white/10 rounded-lg shadow-inner">
      <div className="flex justify-around items-center gap-2 text-center text-white">
        <div className="flex flex-col items-center w-14"><span className="text-2xl font-bold tracking-tighter">{countdown.days}</span><span className="text-[10px] uppercase text-muted-foreground">Days</span></div>
        <div className="flex flex-col items-center w-14"><span className="text-2xl font-bold tracking-tighter">{countdown.hours}</span><span className="text-[10px] uppercase text-muted-foreground">Hours</span></div>
        <div className="flex flex-col items-center w-14"><span className="text-2xl font-bold tracking-tighter">{countdown.minutes}</span><span className="text-[10px] uppercase text-muted-foreground">Mins</span></div>
        <div className="flex flex-col items-center w-14"><span className="text-2xl font-bold tracking-tighter">{countdown.seconds}</span><span className="text-[10px] uppercase text-muted-foreground">Secs</span></div>
      </div>
    </div>
  );
};

export default function PublicEventFormPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const eventSlug = params.eventSlug as string;
  const deferralId = searchParams.get('deferralId');

  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, loading: authLoading } = useAuth();

  const [eventDetails, setEventDetails] = useState<EventCalendarEntry | null>(null);
  const [sliderItem, setSliderItem] = useState<HomepageSliderItem | null>(null);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);
  
  const [isSubmittingRegistration, setIsSubmittingRegistration] = useState(false);
  const [idProofFile, setIdProofFile] = useState<File | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  
  const [deferralDetails, setDeferralDetails] = useState<DeferralEntry | null>(null);
  const [isLoadingDeferral, setIsLoadingDeferral] = useState(false);
  const [isAlreadyRegisteredCompletely, setIsAlreadyRegisteredCompletely] = useState(false);
  const [isBlockedByAdmin, setIsBlockedByAdmin] = useState(false);
  const [registeredDates, setRegisteredDates] = useState<string[]>([]);
  const [isLoadingRegistrationStatus, setIsLoadingRegistrationStatus] = useState(true);

  const [viewingParticipant, setViewingParticipant] = useState<ParticipantWithProfile | null>(null);
  const [isViewingParticipant, setIsViewingParticipant] = useState(false);
  const [isLoadingViewRegistration, setIsLoadingViewRegistration] = useState(false);
  const [isCourseMapModalOpen, setIsCourseMapModalOpen] = useState(false);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [isUnlockingAccess, setIsUnlockingAccess] = useState(false);
  const [hiddenAccessRequired, setHiddenAccessRequired] = useState(false);
  const [hasUnlockedHiddenAccess, setHasUnlockedHiddenAccess] = useState(false);
  const [unlockedHiddenTicketIds, setUnlockedHiddenTicketIds] = useState<string[]>([]);
  
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedRelayTicketId, setSelectedRelayTicketId] = useState<string | null>(null);
  const [isPrivateTicketMode, setIsPrivateTicketMode] = useState(false);

  const [userWaitlistEntry, setUserWaitlistEntry] = useState<WaitlistEntry | null>(null);
  const [isLoadingWaitlistStatus, setIsLoadingWaitlistStatus] = useState(false);
  const [isWaitlistActive, setIsWaitlistActive] = useState(false);
  const [waitlistCodeApplied, setWaitlistCodeApplied] = useState(false);
  const [waitlistCodeValue, setWaitlistCodeValue] = useState<string | null>(null);
  const [waitlistCodeExpiresAt, setWaitlistCodeExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    if (deferralId) {
      setIsLoadingDeferral(true);
      getDeferralDetailsByIdAction(deferralId).then(result => {
        if (result.success && result.deferral) { setDeferralDetails(result.deferral); } 
        else { toast({ variant: 'destructive', title: 'Deferral Error', description: result.message || 'Could not load your deferral details.' }); setEventError("Could not validate your deferral credit."); }
      }).finally(() => setIsLoadingDeferral(false));
    }
  }, [deferralId, toast]);
  
  useEffect(() => {
    if (eventSlug) {
      setIsLoadingEvent(true);
      setEventError(null);
      setHiddenAccessRequired(false);
      setHasUnlockedHiddenAccess(false);
      setUnlockedHiddenTicketIds([]);
      
      Promise.all([
        getEventBySlugAction(eventSlug as string, !!currentUser?.isAdmin),
        getHomepageSliderItemsAction()
      ]).then(([eventResult, sliderResult]) => {
        if (eventResult.success && eventResult.event) {
          setEventDetails(eventResult.event);
          // Check if waitlist form is active for this event
          getWaitlistFormByEventAction(eventResult.event.id)
            .then(wResult => setIsWaitlistActive(wResult.success && wResult.form?.isActive === true))
            .catch(() => setIsWaitlistActive(false));
          if (sliderResult.success && sliderResult.items) {
            const linkedItem = sliderResult.items.find(item => 
                item.eventId === eventResult.event?.id || 
                item.pageSlug === eventSlug
            );
            setSliderItem(linkedItem || null);
          }
        } else if (!currentUser?.isAdmin && /hidden/i.test(eventResult.message || '')) {
          setHiddenAccessRequired(true);
          setEventDetails(null);
        } else {
          setEventError(eventResult.message || "Failed to load event details.");
          toast({ variant: "destructive", title: "Event Not Found", description: eventResult.message });
        }
      }).catch(err => {
        setEventError(err.message || "An unexpected error occurred.");
        toast({ variant: "destructive", title: "Error Loading Event", description: err.message });
      })
      .finally(() => {
        setIsLoadingEvent(false);
      });
    }
  }, [eventSlug, toast, currentUser?.isAdmin]);

  const handleUnlockAccessCode = useCallback(async () => {
    if (!accessCode.trim()) {
      toast({ variant: 'destructive', title: 'Access Code Required', description: 'Enter an access code to open this hidden registration form.' });
      return;
    }

    setIsUnlockingAccess(true);
    try {
      const result = await unlockEventRegistrationWithAccessCodeAction(accessCode, eventSlug, 'slug');
      if (!result.success || !result.event) {
        toast({ variant: 'destructive', title: 'Invalid Access Code', description: result.message });
        return;
      }

      setEventDetails(result.event);
      setEventError(null);
      setHiddenAccessRequired(false);
      setHasUnlockedHiddenAccess(true);
      setUnlockedHiddenTicketIds(result.unlockedTicketIds || []);
      setIsFormVisible(false);
      setSelectedTicketId(null);
      setSelectedRelayTicketId(null);
      toast({ title: 'Hidden Registration Unlocked', description: result.message });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Unlock Failed', description: error?.message || 'Could not validate the access code.' });
    } finally {
      setIsUnlockingAccess(false);
    }
  }, [accessCode, eventSlug, toast]);

  useEffect(() => {
    if (currentUser?.email && eventDetails?.id) {
      setIsLoadingRegistrationStatus(true);
      checkParticipantRegistrationByEmail(eventDetails.id, currentUser.email)
        .then((result) => {
          if (result.success && result.isRegistered) {
            if (result.blockedByAdmin) {
              setIsBlockedByAdmin(true);
              setIsAlreadyRegisteredCompletely(true);
              setRegisteredDates([]);
              return;
            }
            setIsBlockedByAdmin(false);
            setRegisteredDates(result.registeredDates || []);
            
            const availableDates = new Set<string>();
            eventDetails.ticketDefinitions?.forEach(td => {
                const d = td.eventDate || eventDetails.eventDate;
                if (d) availableDates.add(d);
            });
            
            const hasRegisteredForAllDates = Array.from(availableDates).every(date => result.registeredDates?.includes(date));
            setIsAlreadyRegisteredCompletely(hasRegisteredForAllDates);
          } else {
            setIsAlreadyRegisteredCompletely(false);
            setIsBlockedByAdmin(false);
            setRegisteredDates([]);
          }
        })
        .finally(() => setIsLoadingRegistrationStatus(false));
    } else {
      setIsLoadingRegistrationStatus(false);
    }
  }, [currentUser, eventDetails]);

  // Load this user's waitlist entry for the current event
  useEffect(() => {
    if (!currentUser?.email || !eventDetails?.id) {
      setUserWaitlistEntry(null);
      setWaitlistCodeValue(null);
      setWaitlistCodeExpiresAt(null);
      return;
    }
    setIsLoadingWaitlistStatus(true);
    listWaitlistEntriesAction({ eventId: eventDetails.id, email: currentUser.email })
      .then(async (result) => {
        if (result.success && result.entries && result.entries.length > 0) {
          const entry = result.entries[0];
          setUserWaitlistEntry(entry);
          // Fetch actual code value if a code has been issued
          if (entry.codeId && (entry.status === 'code_sent' || entry.status === 'invited') && currentUser?.email) {
            try {
              const codeResult = await getWaitlistCodeForEntryAction({ entryId: entry.id, email: currentUser.email });
              if (codeResult.success && codeResult.code) {
                setWaitlistCodeValue(codeResult.code.code);
                setWaitlistCodeExpiresAt(codeResult.code.expiresAt || null);
              }
            } catch { /* non-blocking */ }
          }
        } else {
          setUserWaitlistEntry(null);
          setWaitlistCodeValue(null);
          setWaitlistCodeExpiresAt(null);
        }
      })
      .catch(() => { setUserWaitlistEntry(null); setWaitlistCodeValue(null); setWaitlistCodeExpiresAt(null); })
      .finally(() => setIsLoadingWaitlistStatus(false));
  }, [currentUser?.email, eventDetails?.id]);

  const handleViewRegistration = async () => {
    if (!currentUser || !eventDetails) return;
    setIsLoadingViewRegistration(true);
    try {
      const result = await getParticipantForEventByEmailAction(eventDetails.id, currentUser.email || '');
      if (result.success && result.participant) {
        setViewingParticipant(result.participant);
        setIsViewingParticipant(true);
      } else {
        toast({ variant: "destructive", title: "Error", description: result.message || "Could not find your registration details." });
      }
    } finally {
        setIsLoadingViewRegistration(false);
    }
  };

  const onSubmitRegistration = async (data: any, feeDetails: FeeDetails | null, coupon: Coupon | null) => {
    const selectedTicketDef = eventDetails?.ticketDefinitions?.find(t => t.id === data.ticketId);
    if (!eventDetails || !data.ticketId || !selectedTicketDef) { toast({ variant: "destructive", title: "Submission Error", description: "Event or ticket details are missing." }); return; }
    if ((!currentUser?.idProofUrl || currentUser.idProofUrl === 'na') && !idProofFile) { 
        toast({ variant: "destructive", title: "ID Proof Required", description: "Please upload your ID proof document." }); 
        return; 
    }
    if (!feeDetails) {
        toast({ variant: 'destructive', title: 'Fee Error', description: 'Fee details could not be calculated. Please re-select a ticket.'});
        return;
    }

    setIsSubmittingRegistration(true);
    
    let finalIdProofUrl: string | null = (currentUser?.idProofUrl && currentUser.idProofUrl !== 'na') ? currentUser.idProofUrl : null;
    if (idProofFile) {
        const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
        const { storage } = await import('@/lib/firebase');
        const fileName = `idProof-${currentUser?.uid || 'guest'}-${Date.now()}.${idProofFile.name.split('.').pop()}`;
        const idProofStorageRef = ref(storage, `eventRegistrations/${eventDetails.id}/idProofs/${fileName}`);
        await uploadBytes(idProofStorageRef, idProofFile);
        finalIdProofUrl = await getDownloadURL(idProofStorageRef);
        
        // Save ID to user profile for future registrations
        if (currentUser?.uid) {
            try {
                const { updateDoc, doc } = await import('firebase/firestore');
                const { db } = await import('@/lib/firebase');
                await updateDoc(doc(db, 'users', currentUser.uid), {
                    idProofUrl: finalIdProofUrl,
                    updatedAt: new Date(),
                });
                toast({ title: "ID Saved", description: "Your ID proof has been saved to your profile for future registrations." });
            
                // Update KV cache with ID proof sync
                try {
                    await fetch('/api/admin/sync-user-data', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            action: 'sync-user',
                            userId: currentUser.uid,
                            email: currentUser.email 
                        }),
                    }).catch(() => {
                        // Silently fail KV update - don't block registration
                    });
                } catch (kvErr) {
                    console.warn("KV update failed:", kvErr);
                }
            } catch (err) {
                console.error("Error saving ID to profile:", err);
                // Don't block registration if profile update fails
            }
        }
    }

    // Save address and business details to user profile
    if (currentUser?.uid) {
        try {
            const { updateDoc, doc } = await import('firebase/firestore');
            const { db } = await import('@/lib/firebase');
            
            const addressUpdateData: Record<string, any> = {
                updatedAt: new Date(),
            };

            // Save regular address details
            if (data.address) addressUpdateData.address = data.address;
            if (data.city) addressUpdateData.city = data.city;
            if (data.state) addressUpdateData.state = data.state;
            if (data.pincode) addressUpdateData.pincode = data.pincode;

            // Save business details if GST is provided
            if (data.gstin) {
                addressUpdateData.gstin = data.gstin;
                if (data.businessName) addressUpdateData.businessName = data.businessName;
                addressUpdateData.businessAddress = data.address || null;
                if (data.city) addressUpdateData.businessCity = data.city;
                if (data.state) addressUpdateData.businessState = data.state;
                if (data.pincode) addressUpdateData.businessPincode = data.pincode;
            }

            // Update user profile with address and business data
            await updateDoc(doc(db, 'users', currentUser.uid), addressUpdateData);
            
            // Update KV cache with address/business details sync
            try {
                await fetch('/api/admin/sync-user-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        action: 'sync-user',
                        userId: currentUser.uid,
                        email: currentUser.email 
                    }),
                }).catch(() => {
                    // Silently fail KV update - don't block registration
                });
            } catch (kvErr) {
                console.warn("KV update failed:", kvErr);
            }
        } catch (err) {
            console.error("Error saving address/business details to profile:", err);
            // Don't block registration if profile update fails
        }
    }

    const { idProofFile: _, ...formDataForServer } = data;

    const selectedTicketTaxPercent = Number((selectedTicketDef as any)?.gstPercent);
    const hasSelectedTicketTax = Number.isFinite(selectedTicketTaxPercent) && selectedTicketTaxPercent > 0;
    const normalizedEventCountry = String(eventDetails.country || '').trim().toLowerCase();
    const isUsdOrUsaEvent =
      String(eventDetails.currency || '').toUpperCase() === 'USD' ||
      normalizedEventCountry === 'united states' ||
      normalizedEventCountry === 'usa' ||
      normalizedEventCountry === 'us' ||
      normalizedEventCountry === 'united states of america';
    const internationalTaxExplicitlyEnabled =
      (eventDetails as any)?.enableInternationalTax === true ||
      (eventDetails as any)?.collectTax === true ||
      (eventDetails as any)?.taxEnabled === true;
    const effectiveTaxRate = hasSelectedTicketTax
      ? (isUsdOrUsaEvent
          ? (internationalTaxExplicitlyEnabled ? selectedTicketTaxPercent / 100 : 0)
          : selectedTicketTaxPercent / 100)
      : (isUsdOrUsaEvent ? 0 : (GST_PERCENTAGE / 100));

    const pricingBreakdownForAction: PricingBreakdown = {
        base: feeDetails.basePricePaisa,
        discount: (feeDetails.couponDiscountPaisa || 0) + (feeDetails.deferralCreditPaisa || 0),
        eventGST: feeDetails.eventGstPaisa,
        platformFeeBase: feeDetails.platformFeeBasePaisa,
        platformGST: feeDetails.platformGST,
        processingFeeBase: feeDetails.processingFeeBasePaisa,
        processingGST: feeDetails.processingGST,
        roundingAdjustment: feeDetails.roundingAdjustmentPaisa,
        totalPayable: feeDetails.totalPayablePaisa,
        currency: (eventDetails.currency as "INR" | "USD") ?? "INR",
        gstRate: effectiveTaxRate,
        version: "v3.0.0",
    };

    const registrationPayload: Omit<RegistrationAttempt, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'remindersSent'> = {
      ...formDataForServer,
      idProofUrl: finalIdProofUrl,
      eventId: eventDetails.id,
      eventName: eventDetails.eventName,
      ticketId: data.ticketId,
      ticketName: selectedTicketDef.ticketName,
      userId: currentUser?.uid || null,
      couponCode: coupon?.code || null,
      waitlistCode: waitlistCodeApplied && userWaitlistEntry && userWaitlistEntry.ticketId === data.ticketId ? waitlistCodeValue || null : null,
      waitlistCodeEmail: waitlistCodeApplied && userWaitlistEntry && userWaitlistEntry.ticketId === data.ticketId ? currentUser?.email || null : null,
      waitlistCodeId: waitlistCodeApplied && userWaitlistEntry && userWaitlistEntry.ticketId === data.ticketId ? userWaitlistEntry.codeId || null : null,
      waitlistCodeEntryId: waitlistCodeApplied && userWaitlistEntry && userWaitlistEntry.ticketId === data.ticketId ? userWaitlistEntry.id || null : null,
      pricingBreakdown: pricingBreakdownForAction,
      isDeferral: !!deferralId,
      deferralId: deferralId || null,
      amountPaidPaisa: feeDetails.totalPayablePaisa,
    };
    
    try {
        const orderResult = await createEventTicketOrderAction({
          ...(registrationPayload as RegistrationAttempt),
          originUrl: window.location.origin,
        } as RegistrationAttempt & { originUrl: string });
        if (!orderResult.success || (!orderResult.orderId && !orderResult.checkoutUrl)) {
          throw new Error(orderResult.message || "Could not create payment order.");
        }
        
        if (feeDetails.totalPayablePaisa <= 0) {
            const freeOrderId = orderResult.orderId;
            if (!freeOrderId) {
              throw new Error('Missing order ID for free registration finalization.');
            }
            const finalizationResult = await submitPublicEventRegistrationAction(freeOrderId);
            if (finalizationResult.success && finalizationResult.bookingId) {
                toast({ title: 'Registration Complete!', description: finalizationResult.message });
                
                // Auto-sync user data after successful registration
                if (currentUser?.uid && currentUser?.email) {
                    try {
                        await syncUserDataFromParticipantsAction(currentUser.uid, currentUser.email);
                        // Update KV cache
                        await fetch('/api/admin/sync-user-data?status=true');
                    } catch (syncErr) {
                        console.error("Error syncing user data to KV:", syncErr);
                        // Don't block the user from proceeding
                    }
                }
                
                router.push(`/dashboard?bookingId=${finalizationResult.bookingId}`);
            } else {
                throw new Error(finalizationResult.message || 'Free registration finalization failed.');
            }
        } else if (orderResult.paymentGateway === 'razorpay') {
             if (!window.Razorpay) {
                toast({ variant: 'destructive', title: 'Gateway Error', description: 'Payment gateway not loaded. Please refresh.' });
                setIsSubmittingRegistration(false);
                return;
             }

             const options = {
                key: orderResult.keyId,
                amount: orderResult.amount,
                currency: orderResult.currency,
                name: eventDetails.eventName,
                description: `Ticket: ${selectedTicketDef.ticketName}`,
                order_id: orderResult.orderId,
                handler: async (response: any) => {
                  // Payment successful - finalize immediately (webhook remains idempotent backup)
                    setIsSubmittingRegistration(true);
                    toast({ title: "Payment Received", description: "Processing your registration..." });

                  try {
                    const registrationAttemptId = String(orderResult?.notes?.registrationAttemptId || '').trim() || undefined;
                    const verifyAndFinalize = await verifyEventRegistrationPaymentAndFinalizeAction({
                      razorpay_order_id: response?.razorpay_order_id,
                      razorpay_payment_id: response?.razorpay_payment_id,
                      razorpay_signature: response?.razorpay_signature,
                      registrationAttemptId,
                    });

                    if (!verifyAndFinalize.success) {
                      const msg = String(verifyAndFinalize.message || 'Finalization failed after payment capture.');
                      const isAdminBlocked = msg.toLowerCase().includes('deleted by admin') || msg.toLowerCase().includes('deletion guard');
                      if (isAdminBlocked) {
                        toast({
                          variant: 'destructive',
                          title: 'Registration Blocked',
                          description: 'This registration was deleted by admin and cannot be auto-recreated.',
                        });
                        setIsSubmittingRegistration(false);
                        router.push('/dashboard');
                        return;
                      }
                      throw new Error(msg);
                    }
                  } catch (finalizeErr: any) {
                    console.error('Razorpay immediate finalization failed:', finalizeErr);
                    // Keep existing UX fallback: dashboard processing while webhook retries.
                  }
                    
                    // Auto-sync user data after successful payment
                    if (currentUser?.uid && currentUser?.email) {
                        try {
                            await syncUserDataFromParticipantsAction(currentUser.uid, currentUser.email);
                            // Update KV cache
                            await fetch('/api/admin/sync-user-data?status=true');
                        } catch (syncErr) {
                            console.error("Error syncing user data to KV:", syncErr);
                            // Don't block the user from proceeding
                        }
                    }
                    
                    // Redirect to dashboard - webhook will complete the registration
                    setTimeout(() => {
                        router.push(`/dashboard?payment=processing&type=registration`);
                    }, 2000);
                },
                prefill: { name: data.name, email: data.email, contact: data.mobile || '' },
                notes: orderResult.notes,
                theme: { color: "#2962FF" },
                modal: { ondismiss: () => { toast({ variant: "default", title: "Payment Cancelled" }); setIsSubmittingRegistration(false); } }
            };

            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', (response: any) => { 
                toast({ variant: "destructive", title: "Payment Failed", description: response.error.description }); 
                setIsSubmittingRegistration(false); 
            });
            rzp.open();
        } else if (orderResult.paymentGateway === 'stripe' && orderResult.checkoutUrl) {
          window.location.assign(orderResult.checkoutUrl);
        } else {
             throw new Error("Unsupported payment gateway provided.");
        }

    } catch (err: any) {
        toast({ variant: "destructive", title: "Error", description: err.message });
        setIsSubmittingRegistration(false);
    }
  };
  
  const handleIdFileChange = useCallback((file: File | null) => { setIdProofFile(file); }, []);
  
  const hasCourseMaps = useMemo(() => {
    return eventDetails?.ticketDefinitions?.some(td => 
        td.courseMaps?.swimGpxUrl || 
        td.courseMaps?.bikeGpxUrl || 
        td.courseMaps?.runGpxUrl ||
        td.courseMaps?.run1GpxUrl ||
        td.courseMaps?.run2GpxUrl
    );
  }, [eventDetails]);


  if (authLoading || isLoadingEvent || isLoadingRegistrationStatus || isLoadingDeferral) {
    return (
      <div className="flex flex-col min-h-screen">
        <div className="flex-grow flex items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>
      </div>
    );
  }
  
  if ((eventError || !eventDetails) && !hiddenAccessRequired) {
    return (
      <div className="flex flex-col min-h-screen">
        <div className="flex-grow flex flex-col items-center justify-center p-4 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h2 className="text-xl font-semibold text-destructive mb-2">Error Loading Event</h2>
          <p className="text-muted-foreground">{eventError || "This event could not be found or is unavailable."}</p>
          <Button onClick={() => router.push('/')} variant="outline" className="mt-6">Go to Homepage</Button>
        </div>
      </div>
    );
  }

  if (!currentUser) {
     return (
        <div className="flex flex-col min-h-screen">
            <div className="flex-grow flex items-center justify-center">
                <Card className="max-w-md w-full text-center p-8 shadow-lg">
                    <CardHeader>
                        <ShieldCheck className="h-12 w-12 text-primary mx-auto mb-3" />
                        <CardTitle>Please Login to Register</CardTitle>
                        <CardDescription>To register for this event, please log in or create an account.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button asChild className="w-full"><Link href={`/login?redirect=/event-form/${eventSlug}`}>Login or Create Account</Link></Button>
                    </CardContent>
                </Card>
            </div>
      </div>
     );
  }

  if (currentUser.isBlacklisted) {
    return (
       <div className="flex flex-col min-h-screen">
           <div className="flex-grow flex items-center justify-center">
               <Card className="max-w-md w-full text-center p-8 shadow-lg border-destructive">
                   <CardHeader>
                       <Ban className="h-12 w-12 text-destructive mx-auto mb-3" />
                       <CardTitle className="text-destructive">Registration Blocked</CardTitle>
                       <CardDescription>
                         Your account is not permitted to register for events at this time due to: {currentUser.blacklistReason || 'a violation of our terms'}.
                       </CardDescription>
                   </CardHeader>
                   <CardContent>
                       <p className="text-sm">Please contact support at <a href="mailto:info@bergmantri.com" className="underline">info@bergmantri.com</a> if you believe this is an error.</p>
                       <Button onClick={() => router.push('/dashboard')} variant="outline" className="mt-6">Go to Dashboard</Button>
                   </CardContent>
               </Card>
           </div>
     </div>
    );
  }

  if (hiddenAccessRequired && !eventDetails) {
    return (
      <div className="flex flex-col min-h-screen">
        <main className="flex-grow flex items-center justify-center p-4">
          <Card className="max-w-md w-full shadow-lg">
            <CardHeader className="text-center">
              <ShieldCheck className="h-12 w-12 text-primary mx-auto mb-3" />
              <CardTitle>Hidden Registration Form</CardTitle>
              <CardDescription>Enter the access code shared with participants to open this registration form.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                placeholder="ENTER ACCESS CODE"
                className="h-11 font-black tracking-widest text-center"
                disabled={isUnlockingAccess}
              />
              <Button className="w-full" onClick={handleUnlockAccessCode} disabled={isUnlockingAccess}>
                {isUnlockingAccess ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Unlock Registration
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (!eventDetails) {
    return (
      <div className="flex flex-col min-h-screen">
        <main className="flex-grow flex items-center justify-center p-4">
          <Card className="max-w-md w-full shadow-lg">
            <CardHeader className="text-center">
              <CardTitle>Event Not Found</CardTitle>
              <CardDescription>
                The event may be unavailable or the registration link is invalid.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => router.push('/dashboard')}>Go to Dashboard</Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const registrationButtonState = getEventRegistrationButtonState(eventDetails);
  if (registrationButtonState === 'hide' && !currentUser?.isAdmin) {
    return (
      <div className="flex flex-col min-h-screen">
        <main className="flex-grow flex items-center justify-center p-4">
          <Card className="max-w-md w-full shadow-lg">
            <CardHeader className="text-center">
              <CardTitle>Registration Yet to Start</CardTitle>
              <CardDescription>Registrations for this event are not live yet. Please check back soon.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => router.push(eventDetails.customSlug ? `/races/${eventDetails.customSlug}` : '/races')}>View Event Details</Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }
  const isEventSoldOutForPublic = registrationButtonState === 'sold_out' && !currentUser?.isAdmin;
  
  const now = startOfDay(new Date());
  const canViewHiddenTicket = (ticket: TicketDefinition) => {
    if (!isTicketHidden(ticket)) return true;
    if (currentUser?.isAdmin) return true;
    if (!hasUnlockedHiddenAccess) return false;
    return unlockedHiddenTicketIds.includes(ticket.id);
  };

  const openTickets = eventDetails.ticketDefinitions?.filter(ticket => {
    if (!canViewHiddenTicket(ticket)) return false;
    if (ticket.isSoldOut) return true;
    
    // LENIENT FILTER: Show if no dates provided
    if (!ticket.openDate || !ticket.closeDate) return true;
    
    try {
      const openDate = parseISO(ticket.openDate);
      const closeDate = parseISO(ticket.closeDate);
      closeDate.setHours(23,59,59,999);
      return now >= openDate && now <= closeDate;
    } catch (e) { return true; }
  });

  const getTicketRegistrationType = (ticket: TicketDefinition): 'individual' | 'relay' | 'both' => {
    if (ticket.registrationType === 'individual' || ticket.registrationType === 'relay' || ticket.registrationType === 'both') {
      return ticket.registrationType;
    }
    const looksLikeRelay = /\brelay\b/i.test(ticket.ticketName || '') || /\brelay\b/i.test(ticket.description || '');
    return looksLikeRelay ? 'relay' : 'individual';
  };

  // Helper to get price display for tickets (handles subcategories with tiers)
  const getTicketPriceDisplay = (ticket: TicketDefinition): string => {
    // If ticket has subcategories, get the price range from last tier of each subcategory
    if (ticket.subCategories && ticket.subCategories.length > 0) {
      const lastTierPrices: number[] = [];
      for (const sub of ticket.subCategories) {
        if (sub.tiers && sub.tiers.length > 0) {
          // Get the last tier price (Tier 3 or highest tier)
          const lastTier = sub.tiers[sub.tiers.length - 1];
          lastTierPrices.push(lastTier.pricePaisa);
        } else if (sub.pricePaisa) {
          lastTierPrices.push(sub.pricePaisa);
        }
      }
      if (lastTierPrices.length > 0) {
        const minPrice = Math.min(...lastTierPrices);
        const maxPrice = Math.max(...lastTierPrices);
        if (minPrice === maxPrice) {
          return `₹${(minPrice / 100).toLocaleString('en-IN')}`;
        }
        return `₹${(minPrice / 100).toLocaleString('en-IN')} - ₹${(maxPrice / 100).toLocaleString('en-IN')}`;
      }
    }
    // Fall back to ticket price or tiers
    if (ticket.tiers && ticket.tiers.length > 0) {
      const lastTier = ticket.tiers[ticket.tiers.length - 1];
      return `₹${(lastTier.pricePaisa / 100).toLocaleString('en-IN')}`;
    }
    if (ticket.ticketType === 'Paid' && ticket.price) {
      return `₹${(ticket.price / 100).toLocaleString('en-IN')}`;
    }
    return 'FREE';
  };

  const waitlistUnlockedTicketId = (waitlistCodeApplied && userWaitlistEntry?.ticketId) ? userWaitlistEntry.ticketId : null;
  const individualOpenTickets = (openTickets || []).filter(t => getTicketRegistrationType(t) !== 'relay');
  const relayOpenTickets = (openTickets || []).filter(t => getTicketRegistrationType(t) === 'relay');
  const publicIndividualTickets = individualOpenTickets
    .filter((ticket) => !isTicketHidden(ticket))
    .map((ticket) =>
      waitlistUnlockedTicketId && ticket.id === waitlistUnlockedTicketId
        ? { ...ticket, isSoldOut: false }
        : ticket
    );
  const unlockedHiddenIndividualTickets = individualOpenTickets.filter((ticket) => isTicketHidden(ticket));
  const publicRelayTickets = relayOpenTickets.filter((ticket) => !isTicketHidden(ticket));
  const unlockedHiddenRelayTickets = relayOpenTickets.filter((ticket) => isTicketHidden(ticket));
  const selectedRelayTicket = relayOpenTickets.find(t => t.id === selectedRelayTicketId) || null;
  const hasHiddenTickets = !!eventDetails.ticketDefinitions?.some((ticket) => isTicketHidden(ticket));
  const hasSoldOutTickets = !!eventDetails.ticketDefinitions?.some((ticket) => ticket.isSoldOut === true);
  const isSoldOutState = hasSoldOutTickets || eventDetails.isSoldOut === true;
  const shouldShowWaitlistOption = isSoldOutState && isWaitlistActive;
  const isSoldOutButWaitlistInactive = isSoldOutState && !isWaitlistActive;

  const formattedEventDate = eventDetails.displayDateRange || (eventDetails.eventDate ? format(parseISO(eventDetails.eventDate), 'PPP') : 'Date TBD');
  const waitlistFormLink = `/waitlist/${eventSlug}`;

  return (
    <>
      <main className="flex-grow">
        <section className="relative w-full h-[56vh] md:h-[60vh] overflow-hidden bg-slate-900 text-white">
          <AnimatePresence>
              <motion.div
              key={eventDetails.id}
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.5 }}
              className="absolute inset-0"
              >
              {sliderItem && sliderItem.type === 'video' ? (
                <video
                  src={sliderItem.src}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                  key={sliderItem.src}
                />
              ) : (
                <Image
                  src={sliderItem?.src || eventDetails.photoUrl || 'https://picsum.photos/seed/default/1920/1080'}
                  alt={eventDetails.eventName}
                  fill
                  sizes="100vw"
                  className="object-cover"
                  priority
                />
              )}
              </motion.div>
          </AnimatePresence>
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
            <div className="absolute inset-0 flex items-end px-4 pb-5 pt-24 md:px-8 md:pb-8 md:pt-28 lg:px-12 lg:pb-12 text-left">
              <div className="container px-0 md:px-6">
              <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
              >
                <h1 className="max-w-4xl text-2xl leading-tight sm:text-5xl lg:text-6xl font-bold tracking-tighter text-shadow-lg text-left">{eventDetails.eventName}</h1>
                <p className="max-w-[600px] text-sm md:text-lg mt-2 text-shadow text-left">{eventDetails.description}</p>
                  <CountdownDisplay date={eventDetails.eventDate ?? null} />
              </motion.div>
              </div>
          </div>
        </section>

        <div className="container mx-auto py-8 px-4 -mt-16 relative z-10 text-left">
          <div className="max-w-3xl mx-auto">
            <Card className="shadow-xl rounded-xl overflow-hidden">
               <CardHeader className="bg-primary/5 p-6 relative text-center">
                  <Button variant="outline" size="sm" className="absolute top-4 left-4 text-xs" onClick={() => router.back()}><ArrowLeft className="h-4 w-4 mr-1.5"/>Back</Button>
                  <CardTitle className="text-2xl font-bold text-primary text-center pt-8">Event Registration</CardTitle>
                  <div className="flex items-center justify-center text-md text-muted-foreground mt-2 gap-2"><CalendarDays className="h-5 w-5" /><span>{formattedEventDate}</span></div>

                  {hasCourseMaps && (
                      <div className="text-center mt-4">
                          <Button variant="secondary" className="bg-sky-500 hover:bg-sky-600 text-white" size="sm" onClick={() => setIsCourseMapModalOpen(true)}>
                              <Map className="mr-2 h-4 w-4" /> View Course Maps
                          </Button>
                      </div>
                  )}
               </CardHeader>
              <CardContent className="p-6 space-y-6">
                {/* Waitlist status banner for logged-in users */}
                {userWaitlistEntry && (() => {
                  const entry = userWaitlistEntry;
                  const isCodeAvailable = (entry.status === 'code_sent' || entry.status === 'invited') && !!entry.codeId;
                  const statusColors: Record<string, string> = {
                    pending: 'border-yellow-300 bg-yellow-50 text-yellow-900',
                    invited: 'border-blue-300 bg-blue-50 text-blue-900',
                    code_sent: 'border-green-300 bg-green-50 text-green-900',
                    registered: 'border-green-400 bg-green-100 text-green-900',
                    expired: 'border-red-300 bg-red-50 text-red-900',
                    cancelled: 'border-gray-300 bg-gray-50 text-gray-700',
                  };
                  const colorClass = statusColors[entry.status] || 'border-gray-200 bg-gray-50 text-gray-700';
                  const isAcceptedState = entry.status === 'invited' || entry.status === 'code_sent';
                  const wrapperClass = isAcceptedState
                    ? 'rounded-xl border border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-4 text-sm shadow-md'
                    : `rounded-lg border p-4 text-sm ${colorClass}`;

                  return (
                    <div className={wrapperClass}>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="font-semibold">
                            Your Waitlist Status:{' '}
                            <span className={`capitalize ${isAcceptedState ? 'inline-flex items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white ml-1 tracking-wide' : ''}`}>
                              {entry.status.replace('_', ' ')}
                            </span>
                          </p>
                          {entry.ticketName && <p className="text-xs mt-0.5">Category: {entry.ticketName}</p>}
                        </div>
                        {isLoadingWaitlistStatus && <Loader2 className="h-4 w-4 animate-spin" />}
                      </div>
                      {entry.status === 'pending' && (
                        <p className="mt-1 text-xs">You are on the waitlist. We will contact you when a spot opens.</p>
                      )}
                      {(entry.status === 'invited' || entry.status === 'code_sent') && (
                        <div className="mt-3 space-y-3">
                          <p className="text-xs font-semibold text-emerald-800">A spot has opened for you. Entries are first-come, first-served.</p>

                          <div className="rounded-lg border border-emerald-300 bg-emerald-50/60 p-3">
                            <div className="text-[11px] uppercase tracking-widest font-bold text-emerald-700 mb-1">Waitlist Registration Code</div>
                            <span className="inline-block rounded bg-white border border-emerald-300 px-3 py-1 font-mono font-extrabold tracking-widest text-base text-emerald-900">
                              {waitlistCodeValue || 'Check email'}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            {!waitlistCodeApplied && (
                              <Button
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                onClick={() => {
                                  setWaitlistCodeApplied(true);
                                  if (entry.ticketId) setSelectedTicketId(entry.ticketId);
                                  setIsPrivateTicketMode(false);
                                  setIsFormVisible(true);
                                  toast({ title: 'Spot unlocked!', description: 'Your waitlist ticket is now available. Complete your registration below.' });
                                }}
                              >
                                Complete Registration
                              </Button>
                            )}
                            {waitlistCodeApplied && (
                              <span className="text-xs font-bold text-emerald-700">✓ Ticket unlocked — scroll down to register</span>
                            )}
                          </div>

                          <p className="text-xs text-slate-700">
                            Your waitlist code is shown above and also sent to your email. Use the same logged-in email for registration.
                          </p>
                          <p className="text-xs text-slate-700">
                            You must complete registration within 2 days from code issue time
                            {waitlistCodeExpiresAt && !Number.isNaN(new Date(waitlistCodeExpiresAt).getTime())
                              ? (
                                <span className="font-bold text-red-600">{` (expires on ${format(new Date(waitlistCodeExpiresAt), 'dd MMM yyyy, HH:mm')}).`}</span>
                              )
                              : ' before expiry.'}
                          </p>
                          <p className="text-xs text-slate-700">
                            If your code/slot expires, you may need to reapply to the waitlist and chances may be lower.
                          </p>
                        </div>
                      )}
                      {entry.status === 'registered' && (
                        <p className="mt-1 text-xs font-medium">You have successfully registered through the waitlist. 🎉</p>
                      )}
                      {entry.status === 'expired' && (
                        <p className="mt-1 text-xs">Your waitlist code expired. Please join the waitlist again if a spot reopens.</p>
                      )}
                    </div>
                  );
                })()}

                {isEventSoldOutForPublic && shouldShowWaitlistOption && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    <p className="font-semibold">This event is currently sold out.</p>
                    <p className="mt-1">You can join the waitlist and we will notify you when a spot opens.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={waitlistFormLink}>Join Waitlist</Link>
                      </Button>
                    </div>
                  </div>
                )}

                {isEventSoldOutForPublic && isSoldOutButWaitlistInactive && (
                  <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
                    <p className="font-semibold">This event is currently sold out.</p>
                    <p className="mt-1">The waitlist is not open for this event yet. Please check back later.</p>
                  </div>
                )}

                {isAlreadyRegisteredCompletely && !deferralId ? (
                  isBlockedByAdmin ? (
                  <div className="text-center py-8 px-4 border-2 border-dashed border-destructive rounded-lg bg-red-50">
                      <Ban className="h-12 w-12 text-destructive mx-auto mb-3" />
                      <h3 className="text-xl font-semibold text-destructive">Registration Not Available</h3>
                      <p className="text-muted-foreground mt-1">Your registration for <strong>{eventDetails.eventName}</strong> is currently unavailable. Please contact support at <a href="mailto:info@bergmantri.com" className="underline text-primary">info@bergmantri.com</a> for assistance.</p>
                      <Button onClick={() => router.push('/dashboard')} variant="outline" className="mt-4">Go to Dashboard</Button>
                  </div>
                  ) : (
                  <div className="text-center py-8 px-4 border-2 border-dashed border-green-500 rounded-lg bg-green-50">
                      <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-3" />
                      <h3 className="text-xl font-semibold text-green-800">You Are Fully Registered!</h3>
                      <p className="text-muted-foreground mt-1">You have secured your spot for all available dates in <strong>{eventDetails.eventName}</strong>.</p>
                      <Button onClick={handleViewRegistration} className="mt-4" disabled={isLoadingViewRegistration}>
                        {isLoadingViewRegistration ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                        View Your Registrations
                      </Button>
                  </div>
                  )
                ) : selectedRelayTicket ? (
                  <div className="space-y-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedRelayTicketId(null)}
                    >
                      <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Tickets
                    </Button>
                    <RelayRegistrationForm
                      eventId={eventDetails.id}
                      ticketId={selectedRelayTicket.id}
                      eventName={eventDetails.eventName}
                      ticketName={selectedRelayTicket.ticketName}
                      ticketPrice={selectedRelayTicket.price ?? 0}
                      ticketGstPercent={selectedRelayTicket.gstPercent ?? null}
                      eventCurrency={(eventDetails.currency === 'USD' ? 'USD' : 'INR')}
                      onSuccess={(teamBib) => {
                        toast({
                          title: 'Relay Team Registered',
                          description: `Team created successfully. Team bib: ${teamBib}`,
                        });
                        router.push('/dashboard');
                      }}
                    />
                  </div>
                ) : isFormVisible ? (
                   <EventRegistrationForm
                      eventDetails={eventDetails}
                      availableTickets={isPrivateTicketMode ? unlockedHiddenIndividualTickets : publicIndividualTickets}
                      onSubmitRegistrationCallback={onSubmitRegistration}
                      isLoading={isSubmittingRegistration}
                     waitlistFormUrl={shouldShowWaitlistOption && !waitlistCodeApplied ? waitlistFormLink : null}
                      idProofFile={idProofFile}
                      onIdProofFileChange={handleIdFileChange}
                      currentUserForForm={currentUser as PublicUserProfileData}
                      formMode="public"
                      deferralDetails={deferralDetails}
                      appliedCoupon={appliedCoupon}
                      setAppliedCoupon={setAppliedCoupon}
                      setSelectedTicketId={setSelectedTicketId}
                      registeredDates={registeredDates}
                      preSelectedTicketId={isPrivateTicketMode ? selectedTicketId : (waitlistCodeApplied && userWaitlistEntry?.ticketId ? userWaitlistEntry.ticketId : null)}
                       waitlistOverrideTicketId={waitlistCodeApplied && userWaitlistEntry?.ticketId ? userWaitlistEntry.ticketId : null}
                    />
                ) : (
                  <div className="text-center py-8 px-4">
                    <h3 className="text-2xl font-semibold mb-4">{registeredDates.length > 0 ? "Add Another Category" : "Ready to Race?"}</h3>
                    <p className="text-muted-foreground mb-6">
                        {registeredDates.length > 0 
                            ? `You've registered for ${registeredDates.length} date(s). You can still register for categories on other days!`
                            : "Click the button below to open the registration form and secure your spot."
                        }
                    </p>

                    <div className="grid grid-cols-1 gap-4 max-w-xl mx-auto">
                      {/* Individual Section - Public tickets only */}
                      <div className="text-left border rounded-lg p-4 bg-muted/20">
                        <h4 className="font-semibold mb-3">Individual</h4>
                          {publicIndividualTickets.length > 0 ? (
                            <div className="space-y-3">
                              <Button
                                size="lg"
                                className="w-full h-11"
                                onClick={() => {
                                  setSelectedRelayTicketId(null);
                                  setIsPrivateTicketMode(false);
                                  setIsFormVisible(true);
                                }}
                              >
                                <Ticket className="mr-2 h-5 w-5" />
                                {registeredDates.length > 0 ? 'Register Individual Category' : 'Register Individual'}
                              </Button>
                            </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">No individual tickets available.</p>
                            {shouldShowWaitlistOption && (
                              <Button asChild variant="outline" size="sm">
                                <Link href={waitlistFormLink}>Join Waitlist</Link>
                              </Button>
                            )}
                            {isSoldOutButWaitlistInactive && (
                              <p className="text-xs text-slate-500 mt-1">Waitlist is not open for this event yet.</p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Relay Section - Public tickets only */}
                      {publicRelayTickets.length > 0 && (
                        <div className="text-left border rounded-lg p-4 bg-muted/20">
                          <h4 className="font-semibold mb-2">Relay</h4>
                          <p className="text-xs text-muted-foreground mb-3">Team Name → Participant 1 → Participant 2 → Participant 3 → Waiver</p>
                          <div className="space-y-2">
                              {publicRelayTickets.map((ticket) => (
                              <Button
                                key={ticket.id}
                                variant="outline"
                                size="lg"
                                className="w-full h-auto min-h-11 px-3 py-3 whitespace-normal"
                                onClick={() => {
                                  setIsFormVisible(false);
                                  setSelectedRelayTicketId(ticket.id);
                                }}
                              >
                                <div className="flex w-full min-w-0 flex-col items-start gap-1 text-left">
                                  <div className="flex w-full items-center justify-between gap-3">
                                    <span className="block min-w-0 break-words text-left leading-snug font-semibold">
                                      {ticket.ticketName}
                                    </span>
                                    <span className="shrink-0 font-bold text-right">
                                      {getTicketPriceDisplay(ticket)}
                                    </span>
                                  </div>
                                  {ticket.description && (
                                    <span className="text-xs text-muted-foreground text-left font-normal">
                                      {ticket.description}
                                    </span>
                                  )}
                                </div>
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Private Individual Tickets Section - Separate like Relay */}
                      {hasUnlockedHiddenAccess && unlockedHiddenIndividualTickets.length > 0 && (
                        <div className="text-left border-2 rounded-lg p-4 bg-red-50 dark:bg-red-950 border-red-400 dark:border-red-600">
                          <div className="flex items-center gap-2 mb-3">
                            <ShieldCheck className="h-4 w-4 text-red-600 dark:text-red-400" />
                            <h4 className="font-semibold text-red-700 dark:text-red-300">Private Individual Tickets</h4>
                          </div>
                          <div className="space-y-2">
                            {unlockedHiddenIndividualTickets.map((ticket) => (
                              <Button
                                key={ticket.id}
                                variant="outline"
                                size="lg"
                                className="w-full h-auto min-h-11 px-3 py-3 whitespace-normal border-red-300 dark:border-red-600 bg-white dark:bg-red-900/50 hover:bg-red-50 dark:hover:bg-red-900 hover:border-red-400 dark:hover:border-red-500"
                                onClick={() => {
                                  setSelectedRelayTicketId(null);
                                  setIsPrivateTicketMode(true);
                                  setSelectedTicketId(ticket.id);
                                  setIsFormVisible(true);
                                }}
                              >
                                <div className="flex w-full min-w-0 flex-col items-start gap-1 text-left">
                                  <div className="flex w-full items-center justify-between gap-3">
                                    <span className="block min-w-0 break-words text-left leading-snug font-semibold">
                                      {ticket.ticketName}
                                    </span>
                                    <span className="shrink-0 font-bold text-right">
                                      {getTicketPriceDisplay(ticket)}
                                    </span>
                                  </div>
                                  {ticket.description && (
                                    <span className="text-xs text-muted-foreground text-left font-normal">
                                      {ticket.description}
                                    </span>
                                  )}
                                </div>
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Private Relay Tickets Section - Separate */}
                      {hasUnlockedHiddenAccess && unlockedHiddenRelayTickets.length > 0 && (
                        <div className="text-left border-2 rounded-lg p-4 bg-red-50 dark:bg-red-950 border-red-400 dark:border-red-600">
                          <div className="flex items-center gap-2 mb-2">
                            <ShieldCheck className="h-4 w-4 text-red-600 dark:text-red-400" />
                            <h4 className="font-semibold text-red-700 dark:text-red-300">Private Relay Tickets</h4>
                          </div>
                          <p className="text-xs text-muted-foreground mb-3">Team Name → Participant 1 → Participant 2 → Participant 3 → Waiver</p>
                          <div className="space-y-2">
                            {unlockedHiddenRelayTickets.map((ticket) => (
                              <Button
                                key={ticket.id}
                                variant="outline"
                                size="lg"
                                className="w-full h-auto min-h-11 px-3 py-3 whitespace-normal border-red-300 dark:border-red-600 bg-white dark:bg-red-900/50 hover:bg-red-50 dark:hover:bg-red-900 hover:border-red-400 dark:hover:border-red-500"
                                onClick={() => {
                                  setIsFormVisible(false);
                                  setSelectedRelayTicketId(ticket.id);
                                }}
                              >
                                <div className="flex w-full min-w-0 flex-col items-start gap-1 text-left">
                                  <div className="flex w-full items-center justify-between gap-3">
                                    <span className="block min-w-0 break-words text-left leading-snug font-semibold">
                                      {ticket.ticketName}
                                    </span>
                                    <span className="shrink-0 font-bold text-right">
                                      {getTicketPriceDisplay(ticket)}
                                    </span>
                                  </div>
                                  {ticket.description && (
                                    <span className="text-xs text-muted-foreground text-left font-normal">
                                      {ticket.description}
                                    </span>
                                  )}
                                </div>
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Access Code Input - At the end */}
                      {!hasUnlockedHiddenAccess && (
                        <div className="text-left border rounded-lg p-4 bg-muted/20 border-dashed border-primary/40">
                          <div className="flex items-center gap-2 mb-3">
                            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                            <h4 className="font-semibold">Have an Access Code?</h4>
                          </div>
                          <p className="text-xs text-muted-foreground mb-3">Enter it to unlock private ticket categories.</p>
                          <p className="text-xs font-bold text-red-600 mb-3">
                            Do not apply the discount coupon code here. If you have a coupon, please apply it in the Registration Form under the Pricing Breakdown section.
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                              value={accessCode}
                              onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                              placeholder="ENTER ACCESS CODE"
                              disabled={isUnlockingAccess}
                              className="font-black tracking-widest h-10 text-sm"
                            />
                            <Button type="button" size="default" onClick={handleUnlockAccessCode} disabled={isUnlockingAccess} className="shrink-0">
                              {isUnlockingAccess ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              Unlock
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Success message when unlocked */}
                      {hasUnlockedHiddenAccess && (
                        <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 flex items-center justify-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
                          <p className="text-sm font-semibold text-green-700">
                            Access unlocked — private categories are now visible above.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <Dialog open={isViewingParticipant} onOpenChange={setIsViewingParticipant}>
        <DialogContent className="max-w-2xl text-left">
            <DialogHeader>
                <DialogTitle className="text-left">Registration Details: {viewingParticipant?.name}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
                {viewingParticipant ? (
                    <ParticipantDetailView participant={viewingParticipant} />
                ) : (
                    <div className="flex justify-center items-center h-48">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                )}
            </div>
        </DialogContent>
      </Dialog>
      {eventDetails && hasCourseMaps && (
          <CourseMapDialog
              event={eventDetails}
              isOpen={isCourseMapModalOpen}
              onClose={() => setIsCourseMapModalOpen(false)}
                ticketId={selectedTicketId || selectedRelayTicketId}
          />
      )}
    </>
  );
}
