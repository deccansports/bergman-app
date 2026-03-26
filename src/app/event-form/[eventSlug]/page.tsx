// src/app/event-form/[eventSlug]/page.tsx
"use client";

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { EventCalendarEntry, TicketDefinition, PublicUserProfileData, DeferralEntry, Coupon, ParticipantWithProfile, FeeDetails, HomepageSliderItem, RegistrationAttempt, PricingBreakdown } from '@/lib/types';
import { 
  getEventBySlugAction, 
  getEventDetailsWithTicketsAction, 
  getPublicFinalResultsAction, 
  getDistinctEventsFromResultsAction, 
  getAthleteRankingData,
  getHomepageSliderItemsAction,
  getDeferralDetailsByIdAction,
  checkParticipantRegistrationByEmail,
  getParticipantsForEventAction
} from '@/lib/actions';
import { createEventTicketOrderAction, submitPublicEventRegistrationAction } from '@/lib/actions';
import EventRegistrationForm from '@/components/events/EventRegistrationForm';
import CourseMapDialog from '@/components/events/CourseMapDialog';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
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
  const [registeredDates, setRegisteredDates] = useState<string[]>([]);
  const [isLoadingRegistrationStatus, setIsLoadingRegistrationStatus] = useState(true);

  const [viewingParticipant, setViewingParticipant] = useState<ParticipantWithProfile | null>(null);
  const [isViewingParticipant, setIsViewingParticipant] = useState(false);
  const [isLoadingViewRegistration, setIsLoadingViewRegistration] = useState(false);
  const [isCourseMapModalOpen, setIsCourseMapModalOpen] = useState(false);
  const [isFormVisible, setIsFormVisible] = useState(false);
  
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

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
      
      Promise.all([
        getEventBySlugAction(eventSlug as string),
        getHomepageSliderItemsAction()
      ]).then(([eventResult, sliderResult]) => {
        if (eventResult.success && eventResult.event) {
          setEventDetails(eventResult.event);
          if (sliderResult.success && sliderResult.items) {
            const linkedItem = sliderResult.items.find(item => 
                item.eventId === eventResult.event?.id || 
                item.pageSlug === eventSlug
            );
            setSliderItem(linkedItem || null);
          }
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
  }, [eventSlug, toast]);

  useEffect(() => {
    if (currentUser?.email && eventDetails?.id) {
      setIsLoadingRegistrationStatus(true);
      checkParticipantRegistrationByEmail(eventDetails.id, currentUser.email)
        .then((result) => {
          if (result.success && result.isRegistered) {
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
            setRegisteredDates([]);
          }
        })
        .finally(() => setIsLoadingRegistrationStatus(false));
    } else {
      setIsLoadingRegistrationStatus(false);
    }
  }, [currentUser, eventDetails]);

  const handleViewRegistration = async () => {
    if (!currentUser || !eventDetails) return;
    setIsLoadingViewRegistration(true);
    try {
        const result = await getParticipantsForEventAction(eventDetails.id);
        if (result.success && result.participants) {
            const participantRecord = result.participants.find(p => p.email?.toLowerCase() === currentUser.email?.toLowerCase());
            if (participantRecord) {
                setViewingParticipant(participantRecord);
                setIsViewingParticipant(true);
            } else {
                toast({ variant: "destructive", title: "Error", description: "Could not find your registration details." });
            }
        } else {
            toast({ variant: "destructive", title: "Error", description: "Could not fetch event participants." });
        }
    } finally {
        setIsLoadingViewRegistration(false);
    }
  };

  const onSubmitRegistration = async (data: any, feeDetails: FeeDetails | null, coupon: Coupon | null) => {
    const selectedTicketDef = eventDetails?.ticketDefinitions?.find(t => t.id === data.ticketId);
    if (!eventDetails || !data.ticketId || !selectedTicketDef) { toast({ variant: "destructive", title: "Submission Error", description: "Event or ticket details are missing." }); return; }
    if (!currentUser?.idProofUrl && !idProofFile) { toast({ variant: "destructive", title: "ID Proof Required", description: "Please upload your ID proof document." }); return; }
    if (!feeDetails) {
        toast({ variant: 'destructive', title: 'Fee Error', description: 'Fee details could not be calculated. Please re-select a ticket.'});
        return;
    }

    setIsSubmittingRegistration(true);
    
    let finalIdProofUrl: string | null = currentUser?.idProofUrl || null;
    if (idProofFile) {
        const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
        const { storage } = await import('@/lib/firebase');
        const fileName = `idProof-${currentUser?.uid || 'guest'}-${Date.now()}.${idProofFile.name.split('.').pop()}`;
        const idProofStorageRef = ref(storage, `eventRegistrations/${eventDetails.id}/idProofs/${fileName}`);
        await uploadBytes(idProofStorageRef, idProofFile);
        finalIdProofUrl = await getDownloadURL(idProofStorageRef);
    }
    const { idProofFile: _, ...formDataForServer } = data;

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
        gstRate: GST_PERCENTAGE / 100,
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
      pricingBreakdown: pricingBreakdownForAction,
      isDeferral: !!deferralId,
      deferralId: deferralId || null,
      amountPaidPaisa: feeDetails.totalPayablePaisa,
    };
    
    try {
        const orderResult = await createEventTicketOrderAction(registrationPayload as RegistrationAttempt);
        if (!orderResult.success || !orderResult.orderId) {
          throw new Error(orderResult.message || "Could not create payment order.");
        }
        
        if (feeDetails.totalPayablePaisa <= 0) {
            const finalizationResult = await submitPublicEventRegistrationAction(orderResult.orderId);
            if (finalizationResult.success && finalizationResult.bookingId) {
                toast({ title: 'Registration Complete!', description: finalizationResult.message });
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
                    setIsSubmittingRegistration(true);
                    toast({ title: "Payment Received", description: "Finalizing your registration..." });
                    setTimeout(() => {
                        router.push(`/dashboard?bookingId=${orderResult.orderId}`);
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
  
  if (eventError || !eventDetails) {
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
  
  const now = startOfDay(new Date());
  const openTickets = eventDetails.ticketDefinitions?.filter(ticket => {
    if (ticket.isHidden) return false;
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

  const formattedEventDate = eventDetails.displayDateRange || (eventDetails.eventDate ? format(parseISO(eventDetails.eventDate), 'PPP') : 'Date TBD');

  return (
    <>
      <main className="flex-grow">
        <section className="relative w-full h-[50vh] md:h-[60vh] overflow-hidden bg-slate-900 text-white">
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
          <div className="absolute bottom-0 left-0 right-0 p-4 md:p-8 lg:p-12 text-left">
              <div className="container px-4 md:px-6">
              <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
              >
                  <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tighter text-shadow-lg text-left">{eventDetails.eventName}</h1>
                  <p className="max-w-[600px] text-base md:text-lg mt-2 text-shadow text-left">{eventDetails.description}</p>
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
                {isAlreadyRegisteredCompletely && !deferralId ? (
                  <div className="text-center py-8 px-4 border-2 border-dashed border-green-500 rounded-lg bg-green-50">
                      <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-3" />
                      <h3 className="text-xl font-semibold text-green-800">You Are Fully Registered!</h3>
                      <p className="text-muted-foreground mt-1">You have secured your spot for all available dates in <strong>{eventDetails.eventName}</strong>.</p>
                      <Button onClick={handleViewRegistration} className="mt-4" disabled={isLoadingViewRegistration}>
                        {isLoadingViewRegistration ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                        View Your Registrations
                      </Button>
                  </div>
                ) : isFormVisible ? (
                   <EventRegistrationForm
                      eventDetails={eventDetails}
                      availableTickets={openTickets || []}
                      onSubmitRegistrationCallback={onSubmitRegistration}
                      isLoading={isSubmittingRegistration}
                      idProofFile={idProofFile}
                      onIdProofFileChange={handleIdFileChange}
                      currentUserForForm={currentUser as PublicUserProfileData}
                      formMode="public"
                      deferralDetails={deferralDetails}
                      appliedCoupon={appliedCoupon}
                      setAppliedCoupon={setAppliedCoupon}
                      setSelectedTicketId={setSelectedTicketId}
                      registeredDates={registeredDates}
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
                    <Button size="lg" className="w-full sm:w-auto" onClick={() => setIsFormVisible(true)}>
                        <Ticket className="mr-2 h-5 w-5" /> {registeredDates.length > 0 ? "Register for Another Date" : "Register Now"}
                    </Button>
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
              ticketId={selectedTicketId}
          />
      )}
    </>
  );
}
