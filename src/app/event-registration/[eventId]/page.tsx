// src/app/event-registration/[eventId]/page.tsx
"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getEventDetailsWithTicketsAction } from '@/lib/actions/eventActions';
import { createEventTicketOrderAction, unlockEventRegistrationWithAccessCodeAction } from '@/lib/actions';
import type { EventCalendarEntry, TicketDefinition, User } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, Ticket, CalendarDays, Info, ExternalLink, UserCircle, Mail, Smartphone, ShoppingCart, AlertTriangle, Users, ShieldCheck } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { RelayRegistrationForm } from '@/components/relay/RelayRegistrationForm';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, isBefore, isValid as isDateValid } from 'date-fns';
import { getEventRegistrationButtonState, isTicketHidden } from '@/lib/utils';

// Render ticket price display (prefer tier/subcategory prices, show min→max range,
// convert paisa to whole-rupee short format and avoid showing ₹0.00)
function getTicketPriceDisplay(ticket: any): string {
  try {
    const values: number[] = [];
    const pushIfNumber = (v: any) => {
      const n = Number(v);
      if (!Number.isNaN(n)) values.push(n);
    };

    pushIfNumber(ticket?.price);
    if (Array.isArray(ticket?.tiers)) {
      for (const t of ticket.tiers) pushIfNumber(t?.pricePaisa ?? t?.price);
    }
    if (Array.isArray(ticket?.subCategories)) {
      for (const sc of ticket.subCategories) {
        pushIfNumber(sc?.pricePaisa ?? sc?.price);
        if (Array.isArray(sc?.tiers)) for (const t of sc.tiers) pushIfNumber(t?.pricePaisa ?? t?.price);
      }
    }

    const positive = values.filter((v) => Number(v) > 0);
    if (positive.length === 0) {
      if ((ticket?.ticketType || '').toLowerCase() === 'free') return 'Free';
      return '—';
    }

    const minPaisa = Math.min(...positive);
    const maxPaisa = Math.max(...positive);

    const format = (paisa: number) => `₹${Math.round(Number(paisa) / 100).toLocaleString('en-IN')}`;
    if (minPaisa === maxPaisa) return format(minPaisa);
    return `${format(minPaisa)} - ${format(maxPaisa)}`;
  } catch (e) {
    return '—';
  }
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

export default function EventRegistrationPage() {
  const params = useParams();
  const eventId = params.eventId as string;
  const router = useRouter();
  const { currentUser, loading: authLoading, firebaseUserFromAuth } = useAuth();
  const { toast } = useToast();

  const [eventDetails, setEventDetails] = useState<EventCalendarEntry | null>(null);
  const [selectedIndividualTicketId, setSelectedIndividualTicketId] = useState<string | null>(null);
  const [selectedRelayTicketId, setSelectedRelayTicketId] = useState<string | null>(null);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [isUnlockingAccess, setIsUnlockingAccess] = useState(false);
  const [hasUnlockedHiddenAccess, setHasUnlockedHiddenAccess] = useState(false);
  const [unlockedHiddenTicketIds, setUnlockedHiddenTicketIds] = useState<string[]>([]);

  useEffect(() => {
    if (!eventId) return;
    setIsLoadingEvent(true);
    getEventDetailsWithTicketsAction(eventId)
      .then(result => {
        if (result.success && result.event) {
          setEventDetails(result.event);
        } else {
          setError(result.message || "Failed to load event details.");
          toast({ variant: "destructive", title: "Error", description: result.message });
        }
      })
      .catch(err => {
        setError(err.message || "An unexpected error occurred.");
        toast({ variant: "destructive", title: "Error", description: err.message });
      })
      .finally(() => setIsLoadingEvent(false));
  }, [eventId, toast]);

  const handleProceedToPayment = useCallback(async () => {
    if (!currentUser || !currentUser.email || !currentUser.name) {
      toast({ variant: "destructive", title: "Authentication Error", description: "Please log in and complete your profile (name required) to register." });
      router.push(`/login?redirect=/event-registration/${eventId}`);
      return;
    }
    if (!selectedIndividualTicketId) {
      toast({ variant: "destructive", title: "No Ticket Selected", description: "Please select a ticket type." });
      return;
    }
    if (!eventDetails) {
      toast({ variant: "destructive", title: "Event Error", description: "Event details not loaded." });
      return;
    }

    const selectedTicketDef = eventDetails.ticketDefinitions?.find(t => t.id === selectedIndividualTicketId);
    if (!selectedTicketDef) {
      toast({ variant: "destructive", title: "Ticket Error", description: "Selected ticket definition not found." });
      return;
    }

    setIsProcessingPayment(true);
    try {
      toast({title: 'Demo Mode Active', description: 'This is a demonstration and will not process a real payment.'});
       setTimeout(() => {
         toast({ title: "Registration Successful (Demo)", description: "This is a simulated successful registration." });
         router.push('/dashboard');
         setIsProcessingPayment(false);
       }, 2000);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Registration Error", description: err.message || "Could not process registration." });
    }
  }, [currentUser, eventId, selectedIndividualTicketId, eventDetails, router, toast]);

  const handleUnlockAccessCode = useCallback(async () => {
    if (!accessCode.trim()) {
      toast({ variant: 'destructive', title: 'Access Code Required', description: 'Enter an access code to open this hidden registration form.' });
      return;
    }

    setIsUnlockingAccess(true);
    try {
      const result = await unlockEventRegistrationWithAccessCodeAction(accessCode, eventId, 'eventId');
      if (!result.success || !result.event) {
        toast({ variant: 'destructive', title: 'Invalid Access Code', description: result.message });
        return;
      }

      setEventDetails(result.event);
      setHasUnlockedHiddenAccess(true);
      setUnlockedHiddenTicketIds(result.unlockedTicketIds || []);
      setSelectedIndividualTicketId(null);
      setSelectedRelayTicketId(null);
      toast({ title: 'Hidden Registration Unlocked', description: result.message });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Unlock Failed', description: error?.message || 'Could not validate the access code.' });
    } finally {
      setIsUnlockingAccess(false);
    }
  }, [accessCode, eventId, toast]);

  if (authLoading || isLoadingEvent) {
    return (
      <div className="flex flex-col min-h-screen">
        <AppHeader />
        <div className="flex-grow flex items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!currentUser) {
    if (typeof window !== "undefined") router.push(`/login?redirect=/event-registration/${eventId}`);
    return (
      <div className="flex flex-col min-h-screen">
        <AppHeader />
        <div className="flex-grow flex items-center justify-center text-muted-foreground">
          Redirecting to login...
        </div>
      </div>
    );
  }

  if (error || !eventDetails) {
    return (
      <div className="flex flex-col min-h-screen">
        <AppHeader />
        <div className="flex-grow flex flex-col items-center justify-center p-4 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h2 className="text-xl font-semibold text-destructive mb-2">Error Loading Event</h2>
          <p className="text-muted-foreground">{error || "Could not load event details. Please try again later."}</p>
          <Button onClick={() => router.back()} variant="outline" className="mt-6">Go Back</Button>
        </div>
      </div>
    );
  }

  if (eventDetails.isHidden && !currentUser?.isAdmin && !hasUnlockedHiddenAccess) {
    return (
      <div className="flex flex-col min-h-screen">
        <AppHeader />
        <div className="flex-grow flex flex-col items-center justify-center p-4 text-center">
          <Card className="max-w-md w-full shadow-lg text-left">
            <CardHeader className="text-center">
              <ShieldCheck className="h-12 w-12 text-primary mx-auto mb-3" />
              <CardTitle>Hidden Registration Form</CardTitle>
              <CardDescription>Enter the participant access code to open this hidden event form.</CardDescription>
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
              <Button onClick={() => router.push('/dashboard')} variant="outline" className="w-full">Back to Dashboard</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const registrationButtonState = getEventRegistrationButtonState(eventDetails);
  if (registrationButtonState === 'hide' && !currentUser?.isAdmin) {
    return (
      <div className="flex flex-col min-h-screen">
        <AppHeader />
        <div className="flex-grow flex flex-col items-center justify-center p-4 text-center">
          <Card className="max-w-md w-full shadow-lg text-left">
            <CardHeader className="text-center">
              <CardTitle>Registration Yet to Start</CardTitle>
              <CardDescription>Registrations for this event are not live yet. Please check back soon.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => router.back()} variant="outline" className="w-full">Go Back</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (registrationButtonState === 'sold_out' && !currentUser?.isAdmin) {
    return (
      <div className="flex flex-col min-h-screen">
        <AppHeader />
        <div className="flex-grow flex flex-col items-center justify-center p-4 text-center">
          <Card className="max-w-md w-full shadow-lg text-left">
            <CardHeader className="text-center">
              <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle>Sold Out</CardTitle>
              <CardDescription>Registrations for this event are currently sold out.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => router.back()} variant="outline" className="w-full">Go Back</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const now = new Date();
  const getTicketRegistrationType = (ticket: TicketDefinition): 'individual' | 'relay' | 'both' => {
    if (ticket.registrationType === 'individual' || ticket.registrationType === 'relay' || ticket.registrationType === 'both') {
      return ticket.registrationType;
    }
    const looksLikeRelay = /\brelay\b/i.test(ticket.ticketName || '') || /\brelay\b/i.test(ticket.description || '');
    return looksLikeRelay ? 'relay' : 'individual';
  };

  const canViewHiddenTicket = (ticket: TicketDefinition) => {
    if (!isTicketHidden(ticket)) return true;
    if (currentUser?.isAdmin) return true;
    if (!hasUnlockedHiddenAccess) return false;
    return unlockedHiddenTicketIds.includes(ticket.id);
  };

  const availableTickets = eventDetails.ticketDefinitions?.filter(ticket => {
    try {
      if (!canViewHiddenTicket(ticket)) return false;
      const openDate = parseISO(ticket.openDate + "T00:00:00Z");
      const closeDate = parseISO(ticket.closeDate + "T23:59:59Z");
      return isDateValid(openDate) && isDateValid(closeDate) && now >= openDate && now <= closeDate;
    } catch (e) {
      return false;
    }
  });

  const individualTickets = (availableTickets || []).filter((ticket) => getTicketRegistrationType(ticket) !== 'relay');
  const relayTickets = (availableTickets || []).filter((ticket) => getTicketRegistrationType(ticket) === 'relay');
  const selectedRelayTicket = selectedRelayTicketId
    ? relayTickets.find((t) => t.id === selectedRelayTicketId)
    : null;
  const hasHiddenTickets = !!eventDetails.ticketDefinitions?.some((ticket) => isTicketHidden(ticket));

  // Show relay form if relay is selected
  if (selectedRelayTicket) {
    return (
      <div className="flex flex-col min-h-screen bg-gradient-to-b from-background to-muted/10">
        <AppHeader />
        <main className="container mx-auto py-8 px-4 flex-grow">
          <div className="max-w-2xl mx-auto">
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedRelayTicketId(null);
              }}
              className="mb-4"
            >
              ← Back to Ticket Selection
            </Button>
            <RelayRegistrationForm
              eventId={eventId}
              ticketId={selectedRelayTicket.id}
              eventName={eventDetails.eventName}
              ticketName={selectedRelayTicket.ticketName}
              ticketPrice={selectedRelayTicket.price ?? 0}
              ticketGstPercent={selectedRelayTicket.gstPercent ?? null}
              eventCurrency={(eventDetails.currency === 'USD' ? 'USD' : 'INR')}
              onSuccess={(teamBib, relayTeamId) => {
                toast({
                  title: 'Success',
                  description: `Relay team created with bib: ${teamBib}`,
                });
                // TODO: Redirect to payment flow with relayTeamId
                setTimeout(() => router.push('/dashboard'), 2000);
              }}
            />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-background to-muted/10">
      <AppHeader />
      <main className="container mx-auto py-8 px-4 flex-grow">
        <div className="max-w-3xl mx-auto">
          <Card className="shadow-xl rounded-xl overflow-hidden border-t-4 border-primary">
            <CardHeader className="bg-primary/5 p-6">
              <CardTitle className="text-3xl font-bold text-primary">{eventDetails.eventName}</CardTitle>
              <div className="flex items-center text-md text-muted-foreground mt-2 gap-2">
                <CalendarDays className="h-5 w-5" />
                <span>{eventDetails.eventDate ? format(parseISO(eventDetails.eventDate), 'PPP') : 'Date TBD'}</span>
                {eventDetails.startTime && eventDetails.eventDate && (
                  <span className="flex items-center gap-1"><Info className="h-4 w-4" /> {eventDetails.startTime}</span>
                )}
              </div>
              {eventDetails.venueName && (
                <div className="flex items-center text-sm text-muted-foreground mt-1 gap-1">
                  <Info className="h-4 w-4" /> {eventDetails.venueName} {eventDetails.address && `- ${eventDetails.address}`}
                </div>
              )}

            </CardHeader>

            <CardContent className="p-6 space-y-6">
              {eventDetails.description && (
                <div className="prose prose-sm max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: eventDetails.description }} />
              )}

              <div className="space-y-6 border-t pt-6">
                <div className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
                    <UserCircle className="h-6 w-6 text-accent" /> Individual Tickets
                  </h3>
                  {individualTickets.length === 0 ? (
                    <p className="text-muted-foreground p-4 bg-muted/50 rounded-md border">
                      No individual tickets available.
                    </p>
                  ) : (
                    <RadioGroup
                      value={selectedIndividualTicketId || undefined}
                      onValueChange={(value) => {
                        setSelectedIndividualTicketId(value);
                        setSelectedRelayTicketId(null);
                      }}
                    >
                      {individualTickets.map((ticket) => (
                        <Label
                          key={ticket.id}
                          htmlFor={`ticket-${ticket.id}`}
                          className={`flex items-center justify-between p-4 border rounded-lg cursor-pointer transition-all hover:shadow-md
                                      ${selectedIndividualTicketId === ticket.id ? 'ring-2 ring-primary border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                        >
                          <div className="flex-grow">
                            <span className="font-semibold text-foreground">{ticket.ticketName}</span>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {ticket.description || (ticket.ticketType === 'Free' ? 'Free Entry' : '')}
                            </p>
                          </div>
                          <div className="text-right ml-4">
                            <span className="text-lg font-bold text-accent">
                              {getTicketPriceDisplay(ticket)}
                            </span>
                          </div>
                          <RadioGroupItem value={ticket.id} id={`ticket-${ticket.id}`} className="ml-4" />
                        </Label>
                      ))}
                    </RadioGroup>
                  )}
                </div>

                {relayTickets.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
                      <Users className="h-6 w-6 text-accent" /> Relay Tickets
                    </h3>
                    <p className="text-xs text-muted-foreground">Relay uses a dedicated form: Team Name → Participant 1 → Participant 2 → Participant 3 → Waiver.</p>
                    <RadioGroup
                      value={selectedRelayTicketId || undefined}
                      onValueChange={(value) => {
                        setSelectedRelayTicketId(value);
                        setSelectedIndividualTicketId(null);
                      }}
                    >
                      {relayTickets.map((ticket) => (
                        <Label
                          key={ticket.id}
                          htmlFor={`ticket-${ticket.id}`}
                          className={`flex w-full max-w-full items-center p-4 border rounded-lg cursor-pointer transition-all hover:shadow-md overflow-hidden
                                      ${selectedRelayTicketId === ticket.id ? 'ring-2 ring-primary border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                        >
                          <div className="flex-grow min-w-0">
                            <span className="block font-semibold text-foreground line-clamp-1">{ticket.ticketName}</span>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ticket.description || 'Relay Team Registration'}</p>
                          </div>
                          <div className="text-right ml-auto pl-4 shrink-0">
                            <span className="text-lg font-bold text-accent">
                              {getTicketPriceDisplay(ticket)}
                            </span>
                          </div>
                          <RadioGroupItem value={ticket.id} id={`ticket-${ticket.id}`} className="ml-4 shrink-0" />
                        </Label>
                      ))}
                    </RadioGroup>
                  </div>
                )}
              </div>

              {!currentUser?.isAdmin && hasHiddenTickets && (
                <div className="mt-4 pt-6 border-t">
                  <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                      <p className="text-sm font-semibold text-foreground">
                        {hasUnlockedHiddenAccess ? 'Access unlocked — private categories are now visible above.' : 'Have an access code? Enter it to unlock private ticket categories.'}
                      </p>
                    </div>
                    {!hasUnlockedHiddenAccess && (
                      <>
                        <p className="text-xs font-bold text-red-600">
                          Do not apply the discount coupon code here. If you have a coupon, please apply it in the Registration Form under the Pricing Breakdown section.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            value={accessCode}
                            onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                            placeholder="ENTER ACCESS CODE"
                            disabled={isUnlockingAccess}
                            className="font-black tracking-widest h-9 text-sm"
                          />
                          <Button type="button" size="sm" onClick={handleUnlockAccessCode} disabled={isUnlockingAccess} className="shrink-0">
                            {isUnlockingAccess ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Unlock
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </CardContent>

            <CardFooter className="p-6 bg-muted/30 border-t">
              <Button
                onClick={handleProceedToPayment}
                className="w-full text-lg py-6 bg-accent hover:bg-accent/90 text-accent-foreground"
                disabled={
                  !selectedIndividualTicketId ||
                  isProcessingPayment ||
                  individualTickets.length === 0 ||
                  !individualTickets.find(t => t.id === selectedIndividualTicketId)
                }
              >
                {isProcessingPayment ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Processing...</>
                ) : (
                  <><ShoppingCart className="mr-2 h-5 w-5" /> Proceed to Individual Checkout</>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </main>
      <footer className="py-6 text-center text-sm text-muted-foreground border-t bg-background">
        Copyright © 2025 BERGMAN. All rights reserved.
      </footer>
    </div>
  );
}
