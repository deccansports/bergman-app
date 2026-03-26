// src/app/event-registration/[eventId]/page.tsx
"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getEventDetailsWithTicketsAction } from '@/lib/actions/eventActions'; // MODIFIED IMPORT
import { createEventTicketOrderAction } from '@/lib/actions'; // New direct registration action
import type { EventCalendarEntry, TicketDefinition, User } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, Ticket, CalendarDays, Info, ExternalLink, UserCircle, Mail, Smartphone, ShoppingCart, AlertTriangle } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, isBefore, isValid as isDateValid } from 'date-fns';

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
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false); // Still used for UI feedback
  const [error, setError] = useState<string | null>(null);

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
    if (!selectedTicketId) {
      toast({ variant: "destructive", title: "No Ticket Selected", description: "Please select a ticket type." });
      return;
    }
    if (!eventDetails) {
      toast({ variant: "destructive", title: "Event Error", description: "Event details not loaded." });
      return;
    }

    const selectedTicketDef = eventDetails.ticketDefinitions?.find(t => t.id === selectedTicketId);
    if (!selectedTicketDef) {
      toast({ variant: "destructive", title: "Ticket Error", description: "Selected ticket definition not found." });
      return;
    }
    
    // For demo: Check if ticket is priced. If so, we'll simulate a free registration.
    // If it's actually free, the original logic could be used if we implement a separate free reg flow.
    const isPricedTicketForDemo = !!(selectedTicketDef.ticketType === 'Paid' && selectedTicketDef.price && selectedTicketDef.price > 0);

    setIsProcessingPayment(true);
    try {
      // <<<< DEMO MODE BLOCK >>>>
      toast({title: 'Demo Mode Active', description: 'This is a demonstration and will not process a real payment.'});
       setTimeout(() => {
         toast({ title: "Registration Successful (Demo)", description: "This is a simulated successful registration." });
         router.push('/dashboard');
         setIsProcessingPayment(false);
       }, 2000);
      // <<<< END DEMO MODE BLOCK >>>>

    } catch (err: any) {
      toast({ variant: "destructive", title: "Registration Error", description: err.message || "Could not process registration." });
    } finally {
      // In a real scenario, this might be handled within the Razorpay callbacks, but for demo it's here.
      // setIsProcessingPayment(false); 
    }
  }, [currentUser, eventId, selectedTicketId, eventDetails, router, toast]);

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

  const now = new Date();
  const availableTickets = eventDetails.ticketDefinitions?.filter(ticket => {
    try {
      const openDate = parseISO(ticket.openDate + "T00:00:00Z");
      const closeDate = parseISO(ticket.closeDate + "T23:59:59Z");
      return isDateValid(openDate) && isDateValid(closeDate) && now >= openDate && now <= closeDate;
    } catch (e) {
      return false;
    }
  });

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

              <div className="space-y-4">
                <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <Ticket className="h-6 w-6 text-accent" /> Select Your Ticket
                </h3>
                {!availableTickets || availableTickets.length === 0 ? (
                  <p className="text-muted-foreground p-4 bg-muted/50 rounded-md border">
                    Ticket sales are currently closed or no tickets are defined for this event. Please check back later or contact the organizer.
                  </p>
                ) : (
                  <RadioGroup value={selectedTicketId || undefined} onValueChange={setSelectedTicketId}>
                    {availableTickets.map((ticket) => (
                      <Label
                        key={ticket.id}
                        htmlFor={`ticket-${ticket.id}`}
                        className={`flex items-center justify-between p-4 border rounded-lg cursor-pointer transition-all hover:shadow-md
                                     ${selectedTicketId === ticket.id ? 'ring-2 ring-primary border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                      >
                        <div className="flex-grow">
                          <span className="font-semibold text-foreground">{ticket.ticketName}</span>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {ticket.description || (ticket.ticketType === 'Free' ? 'Free Entry' : '')}
                          </p>
                        </div>
                        <div className="text-right ml-4">
                          <span className="text-lg font-bold text-accent">
                            {ticket.ticketType === 'Paid' && ticket.price !== null && ticket.price !== undefined ? `₹${(ticket.price / 100).toFixed(2)}` : 'FREE'}
                          </span>
                          {ticket.maxQuantity && (
                            <p className="text-xs text-muted-foreground">
                              {ticket.maxQuantity - (eventDetails.participants?.filter(p => p.ticketName === ticket.ticketName).length || 0) > 0
                               ? `${ticket.maxQuantity - (eventDetails.participants?.filter(p => p.ticketName === ticket.ticketName).length || 0)} left`
                               : 'Sold Out'}
                            </p>
                          )}
                        </div>
                        <RadioGroupItem value={ticket.id} id={`ticket-${ticket.id}`} className="ml-4" />
                      </Label>
                    ))}
                  </RadioGroup>
                )}
              </div>

            </CardContent>
            <CardFooter className="p-6 bg-muted/30 border-t">
              <Button
                onClick={handleProceedToPayment}
                className="w-full text-lg py-6 bg-accent hover:bg-accent/90 text-accent-foreground"
                disabled={!selectedTicketId || isProcessingPayment || !availableTickets || availableTickets.length === 0 || !availableTickets.find(t=>t.id === selectedTicketId)}
              >
                {isProcessingPayment ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Processing...</>
                ) : (
                  // Text changed for demo mode clarity
                  <><ShoppingCart className="mr-2 h-5 w-5" /> Register (Demo Mode)</>
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
