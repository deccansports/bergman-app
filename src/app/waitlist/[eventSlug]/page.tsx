// src/app/waitlist/[eventSlug]/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2, Zap, Clock, CheckCircle2, Mail } from 'lucide-react';
import type { EventCalendarEntry } from '@/lib/types';
import type { WaitlistForm } from '@/lib/types/waitlist';
import { getEventBySlugAction, getWaitlistFormByEventAction, getWaitlistFormBySlugAction, listWaitlistEntriesAction, submitWaitlistEntryAction } from '@/lib/actions';
import { isTicketSaleOpen } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export default function PublicWaitlistPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = String(params.eventSlug || '');
  const preselectedTicketId = searchParams.get('ticketId') || '';

  const { toast } = useToast();
  const { currentUser } = useAuth();

  const [eventDetails, setEventDetails] = useState<EventCalendarEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWaitlistActive, setIsWaitlistActive] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState<WaitlistForm | null>(null);
  const [allowedTicketIds, setAllowedTicketIds] = useState<string[]>([]);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [now, setNow] = useState(Date.now());

  const [athleteName, setAthleteName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [ticketId, setTicketId] = useState(preselectedTicketId || '');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setIsLoading(true);
      try {
        const eventRes = await getEventBySlugAction(slug, false);
        const formBySlugRes = await getWaitlistFormBySlugAction(slug);

        let form: WaitlistForm | null = formBySlugRes.success && formBySlugRes.form ? formBySlugRes.form : null;
        let isActive = !!form?.isActive;
        const allowedIds = formBySlugRes.success && Array.isArray(formBySlugRes.form?.allowedTicketIds)
          ? formBySlugRes.form.allowedTicketIds.filter((id): id is string => !!String(id || '').trim())
          : [];
        if (!isActive && eventRes.success && eventRes.event?.id) {
          const formByEventRes = await getWaitlistFormByEventAction(eventRes.event.id);
          form = formByEventRes.success && formByEventRes.form ? formByEventRes.form : form;
          isActive = !!(formByEventRes.success && formByEventRes.form?.isActive);
          if (Array.isArray(formByEventRes.form?.allowedTicketIds)) {
            allowedIds.splice(0, allowedIds.length, ...formByEventRes.form.allowedTicketIds.filter((id): id is string => !!String(id || '').trim()));
          }
        }

        if (!mounted) return;

        if (eventRes.success && eventRes.event) {
          setEventDetails(eventRes.event);
        }

        setWaitlistForm(form);
        setIsWaitlistActive(isActive);
        setAllowedTicketIds(allowedIds);
      } catch {
        if (!mounted) return;
        setEventDetails(null);
        setIsWaitlistActive(false);
        setWaitlistForm(null);
        setAllowedTicketIds([]);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [slug]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Pre-fill form from logged-in user profile
  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.name && !athleteName) setAthleteName(currentUser.name);
    if (currentUser.email && !email) setEmail(currentUser.email);
    if ((currentUser as any).mobile && !mobile) setMobile((currentUser as any).mobile);
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check if this user already submitted a waitlist entry for this event
  useEffect(() => {
    if (!currentUser?.email || !eventDetails?.id) return;
    listWaitlistEntriesAction({ eventId: eventDetails.id, email: currentUser.email })
      .then((result) => {
        if (result.success && result.entries && result.entries.length > 0) {
          setAlreadySubmitted(true);
        }
      })
      .catch(() => {});
  }, [currentUser?.email, eventDetails?.id]);

  const waitlistTicketOptions = useMemo(() => {
    const tickets = eventDetails?.ticketDefinitions || [];
    return tickets.filter((ticket) => {
      if (allowedTicketIds.length > 0 && !allowedTicketIds.includes(ticket.id)) return false;
      const isSoldOut = ticket.isSoldOut === true;
      const isRegistrationOpen = isTicketSaleOpen(ticket.openDate, ticket.startTime, ticket.closeDate, ticket.endTime);
      const isClosedByDate = !isRegistrationOpen;
      return isSoldOut || isClosedByDate;
    });
  }, [allowedTicketIds, eventDetails?.ticketDefinitions]);

  const waitlistWindow = useMemo(() => {
    const openAt = waitlistForm?.waitlistOpenAt ? new Date(waitlistForm.waitlistOpenAt) : null;
    const closeAt = waitlistForm?.waitlistCloseAt ? new Date(waitlistForm.waitlistCloseAt) : null;
    const openValid = !!openAt && !Number.isNaN(openAt.getTime());
    const closeValid = !!closeAt && !Number.isNaN(closeAt.getTime());
    const isBeforeOpen = openValid && now < openAt!.getTime();
    const isAfterClose = closeValid && now > closeAt!.getTime();
    const isOpen = !!waitlistForm?.isActive && !isBeforeOpen && !isAfterClose;
    return {
      openAt,
      closeAt,
      isBeforeOpen,
      isAfterClose,
      isOpen,
      countdownToOpenMs: openValid ? Math.max(0, openAt!.getTime() - now) : null,
      countdownToCloseMs: closeValid ? Math.max(0, closeAt!.getTime() - now) : null,
    };
  }, [now, waitlistForm]);

  const selectedTicket = useMemo(() => {
    if (!ticketId) return null;
    return waitlistTicketOptions.find((ticket) => ticket.id === ticketId) || null;
  }, [waitlistTicketOptions, ticketId]);

  useEffect(() => {
    if (waitlistTicketOptions.length === 0) {
      if (ticketId) setTicketId('');
      return;
    }

    const existsInOptions = waitlistTicketOptions.some((ticket) => ticket.id === ticketId);
    if (!ticketId || !existsInOptions) {
      const initialTicketId = preselectedTicketId && waitlistTicketOptions.some((ticket) => ticket.id === preselectedTicketId)
        ? preselectedTicketId
        : waitlistTicketOptions[0].id;
      setTicketId(initialTicketId);
    }
  }, [preselectedTicketId, ticketId, waitlistTicketOptions]);

  const submit = async () => {
    if (!eventDetails) return;

    if (!athleteName.trim() || !email.trim() || !mobile.trim()) {
      toast({ variant: 'destructive', title: 'Missing details', description: 'Name, email and mobile are required.' });
      return;
    }

    if (!selectedTicket) {
      toast({ variant: 'destructive', title: 'Select a category', description: 'Please choose one of the available categories.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await submitWaitlistEntryAction({
        eventId: eventDetails.id,
        eventName: eventDetails.eventName,
        ticketId: selectedTicket.id,
        ticketName: selectedTicket.ticketName,
        athleteName: athleteName.trim(),
        email: email.trim(),
        mobile: mobile.trim(),
        message: message.trim() || null,
      });

      if (!result.success) throw new Error(result.message);

      toast({ title: 'Added to waitlist', description: 'Your request has been submitted successfully.' });
      setAlreadySubmitted(true);
      setAthleteName('');
      setEmail('');
      setMobile('');
      setTicketId(waitlistTicketOptions[0]?.id || '');
      setMessage('');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Submission failed', description: error?.message || 'Could not submit waitlist form.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <main className="container mx-auto px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border bg-card p-6 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" /> Loading waitlist form...
        </div>
      </main>
    );
  }

  if (!eventDetails) {
    return (
      <main className="container mx-auto px-4 py-10">
        <Card className="mx-auto max-w-xl">
          <CardHeader>
            <CardTitle>Waitlist Not Available</CardTitle>
            <CardDescription>The event could not be found for this waitlist link.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (alreadySubmitted) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 px-4 py-12">
        <div className="w-full max-w-xl">
          {/* Accent bar */}
          <div className="h-1 w-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500 mb-8" />

          {/* Main card */}
          <div className="relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-8 text-white shadow-2xl overflow-hidden">
            {/* Background pulse */}
            <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-blue-600/20 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

            {/* Bergman Logo */}
            <div className="mb-6 flex items-center justify-center">
              <Image
                src="https://firebasestorage.googleapis.com/v0/b/racehub-ao1fu.firebasestorage.app/o/BERGMAN%20LOGOS%2Fbm.png?alt=media&token=893533c9-e655-40d3-bfc2-9ae07c51a3b3"
                alt="Bergman Logo"
                width={220}
                height={96}
                priority
                className="h-20 w-auto object-contain drop-shadow-lg"
              />
            </div>

            {/* Tag */}
            <div className="mb-3 flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/20 border border-blue-400/30 px-3 py-1 text-xs font-bold tracking-widest text-blue-300 uppercase">
                <Zap className="h-3 w-3" /> Game On
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-center text-3xl font-extrabold tracking-tight mb-2">
              You&apos;re Officially on the Waitlist
            </h1>
            <p className="text-center text-blue-200 text-sm mb-8">
              {eventDetails?.eventName}
            </p>

            {/* Divider */}
            <div className="border-t border-white/10 mb-6" />

            {/* Info rows */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-500/20">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Spot Reserved</p>
                  <p className="text-xs text-slate-400">Your position in the waitlist queue is confirmed. Entries are offered on a first-come, first-served basis when slots open.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/20">
                  <Mail className="h-4 w-4 text-blue-400" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Confirmation Email Sent</p>
                  <p className="text-xs text-slate-400">Please check your inbox for the confirmation email. Don&apos;t forget to check your spam or promotions folder.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/20">
                  <Clock className="h-4 w-4 text-amber-400" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Waitlist Code + 2-Day Expiry</p>
                  <p className="text-xs text-slate-400">If accepted, your waitlist registration code will be shown on this page and sent to your email. You must complete registration within 2 days from the code issue time (before expiry). If your code/slot expires, you&apos;ll need to reapply for the waitlist and chances may be lower.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/20">
                  <Zap className="h-4 w-4 text-purple-400" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Email-Based Registration Only</p>
                  <p className="text-xs text-slate-400">The registration code will work only with the logged-in email address used for the waitlist request.</p>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-white/10 mt-6 mb-6" />

            {/* Bottom message */}
            <p className="text-center text-xs text-slate-500">
              Stay ready. Big things are coming.
            </p>
          </div>

          {/* Bottom accent */}
          <div className="h-1 w-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500 mt-8" />
        </div>
      </main>
    );
  }

  if (!waitlistWindow.isOpen) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 px-4 py-12">
        <Card className="mx-auto max-w-2xl border border-white/10 bg-white/5 text-white shadow-2xl backdrop-blur">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto inline-flex items-center rounded-full bg-blue-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-200 border border-blue-400/20">
              Waitlist Schedule
            </div>
            <CardTitle className="text-2xl font-extrabold tracking-tight text-white">
              {waitlistWindow.isBeforeOpen ? 'Waitlist Opens Soon' : 'Waitlist Closed'}
            </CardTitle>
            <CardDescription className="text-blue-100/80">
              {eventDetails.eventName}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            {waitlistWindow.isBeforeOpen && waitlistWindow.openAt ? (
              <>
                <p className="text-lg font-semibold text-white">Opening on {format(waitlistWindow.openAt, 'dd MMM yyyy, hh:mm a')}</p>
                <div className="mx-auto max-w-sm rounded-2xl border border-blue-400/20 bg-white/5 px-4 py-3">
                  <div className="text-xs uppercase tracking-widest text-blue-200/70">Opens in</div>
                  <div className="mt-1 text-2xl font-black text-white">{formatCountdown(waitlistWindow.countdownToOpenMs || 0)}</div>
                </div>
                <p className="text-sm text-blue-100/75">Please come back when the waitlist opens.</p>
              </>
            ) : waitlistWindow.isAfterClose && waitlistWindow.closeAt ? (
              <>
                <p className="text-lg font-semibold text-white">Closed on {format(waitlistWindow.closeAt, 'dd MMM yyyy, hh:mm a')}</p>
                <p className="text-sm text-blue-100/75">This waitlist window has ended.</p>
              </>
            ) : (
              <p className="text-sm text-blue-100/75">Waitlist is currently unavailable for this event.</p>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 px-4 py-10">
      <Card className="mx-auto max-w-2xl border border-slate-200 bg-white shadow-2xl">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-700">
            Join Waitlist
          </div>
          <div className="flex justify-center">
            <Image
              src="https://firebasestorage.googleapis.com/v0/b/racehub-ao1fu.firebasestorage.app/o/BERGMAN%20LOGOS%2Fbm.png?alt=media&token=893533c9-e655-40d3-bfc2-9ae07c51a3b3"
              alt="Bergman Logo"
              width={180}
              height={78}
              className="h-16 w-auto object-contain"
            />
          </div>
          <CardTitle className="text-2xl font-extrabold tracking-tight text-slate-900">Join Waitlist</CardTitle>
          <CardDescription className="font-semibold text-slate-600">{eventDetails.eventName}</CardDescription>
          {waitlistWindow.closeAt ? (
            <div className="mx-auto flex max-w-md items-center justify-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">
              <Clock className="h-4 w-4" />
              Closing in {formatCountdown(waitlistWindow.countdownToCloseMs || 0)}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-slate-700 font-semibold">Name</Label>
            <Input className="border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" value={athleteName} onChange={(e) => setAthleteName(e.target.value)} placeholder="Athlete name" />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-slate-700 font-semibold">Email</Label>
              <Input className="border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="athlete@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-700 font-semibold">Mobile</Label>
              <Input className="border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+91XXXXXXXXXX" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-700 font-semibold">Preferred ticket/category</Label>
            <Select value={ticketId} onValueChange={setTicketId}>
              <SelectTrigger className="border-slate-300 bg-white text-slate-900">
                <SelectValue placeholder="Select ticket/category" />
              </SelectTrigger>
              <SelectContent className="bg-white text-slate-900">
                {waitlistTicketOptions.map((ticket) => (
                    <SelectItem key={ticket.id} value={ticket.id}>{ticket.ticketName}{ticket.ticketCategory ? ` · ${ticket.ticketCategory}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {waitlistTicketOptions.length === 0 ? (
              <p className="text-xs text-amber-700 font-medium">
                No waitlist categories are available for this event right now.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-700 font-semibold">Message / reason (optional)</Label>
            <Textarea
              className="border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Share anything that helps us prioritize your request..."
            />
          </div>

          <Button
            className="w-full bg-sky-500 font-bold text-white shadow-lg shadow-sky-500/30 transition-colors hover:bg-sky-600 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
            onClick={submit}
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit Waitlist Request
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
