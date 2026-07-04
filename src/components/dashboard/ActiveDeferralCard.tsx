// src/components/dashboard/ActiveDeferralCard.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import type { User, EventCalendarEntry } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CalendarSearch, ArrowRight, XCircle } from 'lucide-react';
import { useCountdown, CountdownTimeUnit } from '@/hooks/useCountdown';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { getEligibleEventsForDeferralAction, clearActiveDeferralNoticeAction } from '@/lib/actions/userActions';
import { getActiveDeferralForUserAction } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { Skeleton } from '../ui/skeleton';

interface ActiveDeferralCardProps {
  user: User;
}

export default function ActiveDeferralCard({ user }: ActiveDeferralCardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { firebaseUserFromAuth, fetchUserProfile } = useAuth();
  
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

  const [resolvedActiveDeferral, setResolvedActiveDeferral] = useState<any | null>(user.activeDeferral || null);

  useEffect(() => {
    setResolvedActiveDeferral(user.activeDeferral || null);
  }, [user.activeDeferral]);

  useEffect(() => {
    let isMounted = true;

    const shouldHydrateFromDeferrals = !user.activeDeferral || !user.activeDeferral.deferralId;
    if (!shouldHydrateFromDeferrals) return;

    getActiveDeferralForUserAction(user.uid, user.email || null)
      .then((res) => {
        if (!isMounted) return;
        if (res.success) {
          setResolvedActiveDeferral(res.activeDeferral || null);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setResolvedActiveDeferral(null);
      });

    return () => {
      isMounted = false;
    };
  }, [user.uid, user.email, user.activeDeferral]);

  const countdown = useCountdown(resolvedActiveDeferral?.expiryDate || '', '23:59:59');
  
  const [eligibleEvents, setEligibleEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [selectedEventSlug, setSelectedEventSlug] = useState<string | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);

  const fetchEligibleEvents = useCallback(async () => {
    if (!user?.uid || !user?.email) return;
    setIsLoadingEvents(true);
    try {
      const [eligibleResult] = await Promise.all([
        getEligibleEventsForDeferralAction(user.uid, user.email),
      ]);
      
      if (eligibleResult.success && eligibleResult.events) {
        setEligibleEvents(eligibleResult.events);
      } else {
        toast({ variant: "destructive", title: "Error", description: "Could not load eligible events for deferral." });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: `Failed to fetch events: ${e.message}` });
    } finally {
      setIsLoadingEvents(false);
    }
  }, [toast, user.uid, user.email]);

  useEffect(() => {
    if(resolvedActiveDeferral && resolvedActiveDeferral.status === 'Pending Ticket Selection') {
        fetchEligibleEvents();
    }
  }, [fetchEligibleEvents, resolvedActiveDeferral]);
  
  const handleProceedToRegister = () => {
    if (selectedEventSlug && resolvedActiveDeferral?.deferralId) {
      router.push(`/event-form/${selectedEventSlug}?deferralId=${resolvedActiveDeferral.deferralId}`);
    }
  };
  
  const handleDismissNotice = async () => {
    if (!user.uid) return;
    setIsDismissing(true);
    try {
      const result = await clearActiveDeferralNoticeAction(user.uid);
      if (result.success) {
        toast({ title: 'Notice Cleared', description: 'The expired deferral notice has been removed.' });
        if(firebaseUserFromAuth) {
            await fetchUserProfile(firebaseUserFromAuth);
        }
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsDismissing(false);
    }
  };
  
  if (!resolvedActiveDeferral || (resolvedActiveDeferral.status !== 'Pending Ticket Selection' && resolvedActiveDeferral.status !== 'Expired')) {
    return null;
  }
  
  const isExpired = !countdown || countdown.isPast || resolvedActiveDeferral.status === 'Expired';
  const creditAmount = resolvedActiveDeferral.estimatedOriginalBasePricePaisa;

  if (!isClient) {
    return <Skeleton className="w-full h-52" />;
  }

  return (
    <Card className={cn(
      "shadow-lg border-orange-500/30 bg-gradient-to-tr from-orange-500/10 via-orange-500/5 to-transparent",
      isExpired && "opacity-80 bg-gradient-to-tr from-destructive/10 via-destructive/5 to-transparent border-destructive/20"
    )}>
        <CardHeader>
            <CardTitle className={cn(
                "text-2xl font-bold tracking-tight flex items-center gap-2",
                isExpired ? "text-destructive" : "text-orange-600"
            )}>
                <CalendarSearch className="h-6 w-6" />
                Your Deferral Credit Status
            </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
             {isExpired ? (
                <div className="text-center p-4 rounded-lg space-y-2">
                  <p className="font-semibold text-foreground">
                    Your deferral credit from <strong>{resolvedActiveDeferral.originalEventName}</strong> is no longer valid.
                  </p>
                   {typeof creditAmount === 'number' && (
                        <p className="text-sm text-muted-foreground">
                            Original Credit Amount: <span className="font-medium">₹{(creditAmount / 100).toLocaleString('en-IN')}</span>
                        </p>
                    )}
                  <p className="text-sm text-muted-foreground">Status: <Badge variant="destructive">Expired</Badge></p>
                </div>
            ) : countdown ? (
                <>
                <p className="text-muted-foreground">You have an active deferral credit from <strong>{resolvedActiveDeferral.originalEventName}</strong>. Use it to register for an upcoming event before it expires.</p>
                    {typeof creditAmount === 'number' && creditAmount > 0 && (
                        <div className="text-center p-4 bg-orange-100/50 border border-orange-200 rounded-lg">
                            <p className="text-sm font-medium text-orange-800">Available Credit</p>
                            <p className="text-4xl font-bold text-orange-700">
                                ₹{(creditAmount / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                        </div>
                    )}
                    <div>
                        <p className="text-sm font-medium text-center mb-2">Time remaining to use your deferral credit:</p>
                        <div className="flex justify-center items-center gap-2 sm:gap-4 text-center text-orange-600">
                            <CountdownTimeUnit value={countdown.days} label="Days" />
                            <CountdownTimeUnit value={countdown.hours} label="Hours" />
                            <CountdownTimeUnit value={countdown.minutes} label="Mins" />
                            <CountdownTimeUnit value={countdown.seconds} label="Secs" />
                        </div>
                      <p className="text-center text-xs text-muted-foreground mt-2">Expires on: {resolvedActiveDeferral.expiryDate ? format(new Date(resolvedActiveDeferral.expiryDate), 'MMM dd, yyyy') : 'N/A'}</p>
                    </div>
                </>
            ) : null}
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row gap-2 items-center p-4 border-t bg-muted/20">
          {isExpired ? (
              <Button className="w-full" variant="outline" onClick={handleDismissNotice} disabled={isDismissing}>
                {isDismissing ? <Loader2 className="h-4 w-4 animate-spin"/> : <XCircle className="h-4 w-4"/>}
                <span className="ml-2">Dismiss This Notice</span>
              </Button>
          ) : (
            <>
              <div className="w-full flex-grow">
                <Label className="text-xs">Choose your next race:</Label>
                {isLoadingEvents ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm h-9">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading eligible events...
                  </div>
                ) : (
                  <Select onValueChange={setSelectedEventSlug} value={selectedEventSlug || ""} disabled={isLoadingEvents}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select an eligible event..." />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleEvents.length > 0 ? eligibleEvents.map(event => (
                        <SelectItem key={event.id} value={event.customSlug!}>
                          {event.eventName}
                        </SelectItem>
                      )) : (
                        <SelectItem value="none" disabled>No eligible events available</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Button className="w-full sm:w-auto self-end" onClick={handleProceedToRegister} disabled={!selectedEventSlug || isLoadingEvents}>
                Proceed to Register <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          )}
        </CardFooter>
    </Card>
  );
}

    