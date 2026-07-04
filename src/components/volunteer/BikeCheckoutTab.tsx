// src/components/volunteer/BikeCheckoutTab.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search as SearchIcon, Send, Bike } from 'lucide-react';
import type { EventParticipant } from '@/lib/types';
import { searchParticipantForBikeAction, manualBikeCheckOutAction, sendBikeCheckoutReminderAction } from '@/lib/actions/volunteerActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';


interface BikeCheckoutTabProps {
  eventId: string;
  volunteerId: string;
  volunteerName: string;
}

const getBelStatus = (participant: EventParticipant | null): string => {
  if (!participant) return 'Unknown';
  const fromParticipant = String((participant as any)?.belStatus || (participant as any)?.belTier || '').trim();
  if (fromParticipant) return fromParticipant;
  const fromProfile = String((participant as any)?.userProfile?.belStatus || (participant as any)?.userProfile?.belTier || '').trim();
  if (fromProfile) return fromProfile;
  const qualified = (participant as any)?.belQualified ?? (participant as any)?.userProfile?.belQualified;
  if (qualified === true) return 'Qualified';
  if (qualified === false) return 'Not Qualified';
  return 'Unknown';
};

const belBadgeClass = (status: string): string => {
  const s = status.toLowerCase();
  if (s.includes('gold')) return 'bg-amber-400/20 text-amber-700 border-amber-500/40';
  if (s.includes('silver')) return 'bg-slate-300/30 text-slate-700 border-slate-400/40';
  if (s.includes('bronze')) return 'bg-orange-300/25 text-orange-800 border-orange-500/40';
  if (s.includes('qualified')) return 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40';
  if (s.includes('provisional')) return 'bg-sky-500/15 text-sky-700 border-sky-500/40';
  if (s.includes('not')) return 'bg-rose-500/15 text-rose-700 border-rose-500/40';
  return 'bg-muted text-muted-foreground border-border';
};

export default function BikeCheckoutTab({ eventId, volunteerId, volunteerName }: BikeCheckoutTabProps) {
  const { toast } = useToast();
  const RESEND_OTP_COOLDOWN_SECONDS = 30;

  const [bikeCheckoutSearchTerm, setBikeCheckoutSearchTerm] = useState('');
  const [bikeCheckoutSearchBy, setBikeCheckoutSearchBy] = useState<'bibNumber' | 'mobile' | 'email'>('bibNumber');
  const [isBikeCheckoutSearching, setIsBikeCheckoutSearching] = useState(false);
  const [bikeCheckoutParticipant, setBikeCheckoutParticipant] = useState<EventParticipant | null>(null);
  const [isSendingBikeCheckoutOtp, setIsSendingBikeCheckoutOtp] = useState(false);
  const [isBikeCheckoutOtpSent, setIsBikeCheckoutOtpSent] = useState(false);
  const [bikeCheckoutOtp, setBikeCheckoutOtp] = useState('');
  const [isVerifyingBikeCheckout, setIsVerifyingBikeCheckout] = useState(false);
  const [bikeCheckoutResult, setBikeCheckoutResult] = useState<{ success: boolean; message: string } | null>(null);
  const [bikeResendCooldownActive, setBikeResendCooldownActive] = useState(false);
  const [bikeResendTimer, setBikeResendTimer] = useState(RESEND_OTP_COOLDOWN_SECONDS);
  
  const [isManualHandoverModalOpen, setIsManualHandoverModalOpen] = useState(false);
  const [manualHandoverName, setManualHandoverName] = useState('');
  const [manualHandoverMobile, setManualHandoverMobile] = useState('');
  const [isProcessingManualHandover, setIsProcessingManualHandover] = useState(false);
  const [collectedByAthlete, setCollectedByAthlete] = useState(false);
  const [isSendingReminder, setIsSendingReminder] = useState(false);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (bikeResendCooldownActive && bikeResendTimer > 0) {
        intervalId = setInterval(() => setBikeResendTimer(t => t - 1), 1000);
    } else if (bikeResendTimer <= 0 && bikeResendCooldownActive) {
        setBikeResendCooldownActive(false);
        setBikeResendTimer(RESEND_OTP_COOLDOWN_SECONDS);
    }
    return () => clearInterval(intervalId);
  }, [bikeResendCooldownActive, bikeResendTimer]);

  const startBikeOtpResendCooldown = () => {
    setBikeResendCooldownActive(true);
    setBikeResendTimer(RESEND_OTP_COOLDOWN_SECONDS);
  };
  
  const handleBikeCheckoutSearch = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!eventId || !bikeCheckoutSearchTerm) return;
    setIsBikeCheckoutSearching(true);
    setBikeCheckoutParticipant(null);
    setBikeCheckoutResult(null);
    setBikeCheckoutOtp('');
    setIsBikeCheckoutOtpSent(false);
    try {
      const result = await searchParticipantForBikeAction(eventId, bikeCheckoutSearchTerm, bikeCheckoutSearchBy);
      if (result.success && result.participant) {
        setBikeCheckoutParticipant(result.participant);
      } else {
        toast({ variant: "destructive", title: "Not Found", description: result.message });
      }
    } catch (error: unknown) { 
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      toast({ variant: "destructive", title: "Search Error", description: errMsg }); 
    }
    finally { setIsBikeCheckoutSearching(false); }
  };
  
  const handleSendBikeCheckoutOtp = async () => {
    if (!eventId || !bikeCheckoutParticipant?.id) return;
    setIsSendingBikeCheckoutOtp(true);
    try {
        const response = await fetch('/api/volunteer-checkin/send-bike-checkout-otp', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ eventId: eventId, participantId: bikeCheckoutParticipant.id }),
        });
        const result = await response.json();
        if (response.ok && result.success) {
            toast({ title: 'OTP Sent', description: result.message });
            setIsBikeCheckoutOtpSent(true);
            startBikeOtpResendCooldown();
        } else {
            toast({ variant: 'destructive', title: 'Failed to Send OTP', description: result.message });
        }
    } catch (error: unknown) { 
      const errMsg = error instanceof Error ? error.message : 'Could not send OTP.';
      toast({ variant: 'destructive', title: 'Error', description: errMsg }); 
    }
    finally { setIsSendingBikeCheckoutOtp(false); }
  };
  
  const handleVerifyBikeCheckout = async () => {
    if (!eventId || !bikeCheckoutParticipant?.id || !bikeCheckoutOtp) return;
    setIsVerifyingBikeCheckout(true);
    try {
        const response = await fetch('/api/volunteer-checkin/verify-bike-checkout-otp', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                eventId, participantId: bikeCheckoutParticipant.id,
                otp: bikeCheckoutOtp, volunteerId, volunteerName,
                clientTimestamp: new Date().toISOString(),
            }),
        });
        const result = await response.json();
        setBikeCheckoutResult(result);
        if (response.ok && result.success) {
            toast({ title: "Bike Checked Out", description: result.message });
            setBikeCheckoutParticipant(null); setBikeCheckoutSearchTerm(''); setBikeCheckoutOtp(''); setIsBikeCheckoutOtpSent(false);
        } else {
            toast({ variant: 'destructive', title: "Check-out Failed", description: result.message });
        }
    } catch (error: unknown) { 
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      setBikeCheckoutResult({ success: false, message: errMsg }); 
      toast({ variant: 'destructive', title: 'Error', description: errMsg }); 
    }
    finally { setIsVerifyingBikeCheckout(false); }
  };
  
  const handleManualBikeCheckout = async () => {
    if (!eventId || !bikeCheckoutParticipant?.id) return;

    if (!collectedByAthlete && (manualHandoverName.trim() === '' || manualHandoverMobile.trim() === '')) {
        toast({ variant: "destructive", title: "Information Required", description: "Receiver's name and mobile are required unless collected by the athlete." });
        return;
    }
    
    setIsProcessingManualHandover(true);
    try {
      const result = await manualBikeCheckOutAction(eventId, bikeCheckoutParticipant.id, volunteerId, volunteerName, collectedByAthlete ? null : manualHandoverName, collectedByAthlete ? null : manualHandoverMobile);
      setBikeCheckoutResult(result);
      if (result.success) {
        toast({ title: "Bike Checked Out", description: "Bike manually checked out successfully." });
        setBikeCheckoutParticipant(null); setBikeCheckoutSearchTerm(''); setBikeCheckoutOtp(''); setIsBikeCheckoutOtpSent(false);
        setIsManualHandoverModalOpen(false); setManualHandoverName(''); setManualHandoverMobile(''); setCollectedByAthlete(false);
      } else {
        toast({ variant: "destructive", title: "Manual Check-out Failed", description: result.message });
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "Could not process manual bike check-out.";
      toast({ variant: "destructive", title: "Error", description: errMsg });
    } finally {
      setIsProcessingManualHandover(false);
    }
  };
  
  const handleSendReminder = async () => {
      if (!bikeCheckoutParticipant?.id || !bikeCheckoutParticipant.bibNumber) {
        toast({ variant: 'destructive', title: 'Missing Info', description: 'Participant ID or BIB is missing.' });
        return;
      }
      setIsSendingReminder(true);
      const result = await sendBikeCheckoutReminderAction(bikeCheckoutParticipant.id, eventId);
      if (result.success) {
        toast({ title: 'Reminder Sent!', description: `A bike checkout reminder has been sent to ${bikeCheckoutParticipant.name}.`});
        // Re-fetch participant data to update notification count if needed
        handleBikeCheckoutSearch();
      } else {
        toast({ variant: 'destructive', title: 'Send Failed', description: result.message });
      }
      setIsSendingReminder(false);
  };
  
  return (
    <Card className="bg-background shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary"><Bike className="h-5 w-5"/>Bike Check-out</CardTitle>
        <CardDescription>Search for a participant to check out their bicycle using OTP verification or manual override.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleBikeCheckoutSearch} className="flex flex-col sm:flex-row gap-2">
          <Select value={bikeCheckoutSearchBy} onValueChange={(v: string) => setBikeCheckoutSearchBy(v as 'bibNumber' | 'mobile' | 'email')}>
            <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bibNumber">BIB Number</SelectItem>
              <SelectItem value="mobile">Mobile</SelectItem>
              <SelectItem value="email">Email</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder={`Enter ${bikeCheckoutSearchBy.replace('Number', ' No.')}...`} value={bikeCheckoutSearchTerm} onChange={(e) => setBikeCheckoutSearchTerm(e.target.value)} disabled={isBikeCheckoutSearching} className="flex-grow"/>
          <Button type="submit" disabled={!bikeCheckoutSearchTerm || isBikeCheckoutSearching} className="w-full sm:w-auto">
            {isBikeCheckoutSearching ? <><Loader2 className="h-4 w-4 animate-spin mr-2"/> Searching...</> : <><SearchIcon className="h-4 w-4 mr-2"/>Search</>}
          </Button>
        </form>
         {bikeCheckoutParticipant && (
           <Card className="mt-4 p-4 border-destructive/20 bg-destructive/5">
              <CardHeader className="p-0 pb-3"><CardTitle className="text-lg flex items-center gap-3 text-primary">{bikeCheckoutParticipant.name}</CardTitle></CardHeader>
              <CardContent className="p-0 text-sm space-y-4">
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <p><strong>BIB:</strong> <span className="font-bold text-primary">{bikeCheckoutParticipant.bibNumber || 'N/A'}</span></p>
                  <p><strong>BEL:</strong> <Badge variant="outline" className={belBadgeClass(getBelStatus(bikeCheckoutParticipant))}>{getBelStatus(bikeCheckoutParticipant)}</Badge></p>
                    <p><strong>Bike Check-in:</strong> <Badge variant={bikeCheckoutParticipant.bikeCheckInStatus === 'CheckedIn' ? 'default' : 'destructive'}>{bikeCheckoutParticipant.bikeCheckInStatus || 'Pending'}</Badge></p>
                    <p><strong>Bike Check-out:</strong> <Badge variant={bikeCheckoutParticipant.bikeCheckOutStatus === 'CheckedOut' ? 'default' : 'secondary'}>{bikeCheckoutParticipant.bikeCheckOutStatus || 'Pending'}</Badge></p>
                </div>
                {bikeCheckoutParticipant.bikeCheckedOutManuallyTo && (
                    <Alert>
                        <AlertTitle>Manual Handover Details</AlertTitle>
                        <AlertDescription>
                            <p>Handed over to: <strong>{bikeCheckoutParticipant.bikeCheckedOutManuallyTo.name}</strong></p>
                            <p>Mobile: <strong>{bikeCheckoutParticipant.bikeCheckedOutManuallyTo.mobile}</strong></p>
                        </AlertDescription>
                    </Alert>
                )}
                <div className="pt-3 border-t space-y-3">
                    {!isBikeCheckoutOtpSent ? (
                      <Button onClick={handleSendBikeCheckoutOtp} disabled={isSendingBikeCheckoutOtp || bikeCheckoutParticipant.bikeCheckInStatus !== 'CheckedIn' || bikeCheckoutParticipant.bikeCheckOutStatus === 'CheckedOut' || bikeResendCooldownActive} className="w-full">
                        {isSendingBikeCheckoutOtp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}<span className="ml-2">{bikeResendCooldownActive ? `Resend OTP in ${bikeResendTimer}s` : 'Send OTP for Check-out'}</span>
                      </Button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <Input placeholder="Enter 6-digit OTP" value={bikeCheckoutOtp} onChange={e => setBikeCheckoutOtp(e.target.value)} maxLength={6} disabled={isVerifyingBikeCheckout} className="text-center text-lg tracking-widest h-12"/>
                        <Button onClick={handleVerifyBikeCheckout} disabled={isVerifyingBikeCheckout || bikeCheckoutOtp.length !== 6}>
                          {isVerifyingBikeCheckout && <Loader2 className="h-4 w-4 animate-spin"/>}<span className="ml-2">Verify & Check Out</span>
                        </Button>
                      </div>
                    )}
                    <div className="flex gap-2">
                        <Dialog open={isManualHandoverModalOpen} onOpenChange={setIsManualHandoverModalOpen}>
                            <DialogTrigger asChild>
                                <Button variant="outline" className="w-full" disabled={isProcessingManualHandover || bikeCheckoutParticipant.bikeCheckInStatus !== 'CheckedIn' || bikeCheckoutParticipant.bikeCheckOutStatus === 'CheckedOut'}>Manual Handover Override</Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Manual Handover Details</DialogTitle>
                                    <DialogDescription>Enter the details of the person collecting the bike, or check the box if the athlete is collecting it themselves.</DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                    <div className="flex items-center space-x-2">
                                    <Checkbox id="collected-by-athlete" checked={collectedByAthlete} onCheckedChange={(checked) => setCollectedByAthlete(checked as boolean)} />
                                    <Label htmlFor="collected-by-athlete">Collected by athlete themselves</Label>
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="receiver-name">Receiver&apos;s Name</Label>
                                        <Input id="receiver-name" value={manualHandoverName} onChange={(e) => setManualHandoverName(e.target.value)} disabled={collectedByAthlete} />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="receiver-mobile">Receiver&apos;s Mobile</Label>
                                        <Input id="receiver-mobile" type="tel" value={manualHandoverMobile} onChange={(e) => setManualHandoverMobile(e.target.value)} disabled={collectedByAthlete} />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                                    <Button onClick={handleManualBikeCheckout} disabled={isProcessingManualHandover}>
                                        {isProcessingManualHandover && <Loader2 className="animate-spin mr-2"/>} Confirm Handover
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                        <Button variant="secondary" className="w-full" onClick={handleSendReminder} disabled={isSendingReminder || bikeCheckoutParticipant.bikeCheckInStatus !== 'CheckedIn' || bikeCheckoutParticipant.bikeCheckOutStatus === 'CheckedOut'}>
                           {isSendingReminder ? <Loader2 className="animate-spin h-4 w-4" /> : <Send className="h-4 w-4"/>}<span className="ml-2">Send Reminder</span>
                        </Button>
                    </div>
                </div>
                {bikeCheckoutResult && <Alert variant={bikeCheckoutResult.success ? 'default' : 'destructive'} className="mt-2 text-xs"><AlertTitle>{bikeCheckoutResult.success ? 'Success' : 'Error'}</AlertTitle><AlertDescription>{bikeCheckoutResult.message}</AlertDescription></Alert>}
              </CardContent>
           </Card>
         )}
      </CardContent>
    </Card>
  );
}
