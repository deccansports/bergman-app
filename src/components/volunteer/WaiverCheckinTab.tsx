// src/components/volunteer/WaiverCheckinTab.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search as SearchIcon, Send, UserCheck, RefreshCw, AlertTriangle, CheckCircle, Hand, FileText } from 'lucide-react';
import type { EventParticipant } from '@/lib/types';
import { searchParticipantsForCheckInAction } from '@/lib/actions/volunteerActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import Image from 'next/image';

interface WaiverCheckinTabProps {
  eventId: string;
  activeTab: string;
  volunteerId: string;
  volunteerName: string;
}

const getInitials = (name?: string | null) => {
    if (!name) return 'A';
    const names = name.split(' ');
    if (names.length > 1) return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
    return name.substring(0, 2).toUpperCase();
};

export default function WaiverCheckinTab({ eventId, activeTab, volunteerId, volunteerName }: WaiverCheckinTabProps) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchBy, setSearchBy] = useState<'bibNumber' | 'mobile' | 'email' | 'name'>('bibNumber');
  const [isSearching, setIsSearching] = useState(false);
  const [searchedParticipant, setSearchedParticipant] = useState<EventParticipant | null>(null);
  const [searchedParticipantsList, setSearchedParticipantsList] = useState<EventParticipant[]>([]);
  const [otp, setOtp] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [checkInResult, setCheckInResult] = useState<{ success: boolean; message: string } | null>(null);
  const [resendCooldownActive, setResendCooldownActive] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);

  const [remarks, setRemarks] = useState('');
  const [isHandover, setIsHandover] = useState(false);
  const [handoverName, setHandoverName] = useState('');
  const [handoverMobile, setHandoverMobile] = useState('');
  const [isIdProofModalOpen, setIsIdProofModalOpen] = useState(false);


  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (resendCooldownActive && resendTimer > 0) {
      intervalId = setInterval(() => setResendTimer((t) => t - 1), 1000);
    } else if (resendTimer <= 0 && resendCooldownActive) {
      setResendCooldownActive(false);
      setResendTimer(30);
    }
    return () => clearInterval(intervalId);
  }, [resendCooldownActive, resendTimer]);

  const startOtpResendCooldown = () => {
    setResendCooldownActive(true);
    setResendTimer(30);
  };
  
  const handleResetSearch = () => {
    setSearchTerm('');
    setSearchedParticipant(null);
    setSearchedParticipantsList([]);
    setCheckInResult(null);
    setIsOtpSent(false);
    setOtp('');
    setRemarks('');
    setIsHandover(false);
    setHandoverName('');
    setHandoverMobile('');
  };
  
  const handleSearch = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!eventId || !searchTerm) {
      toast({ variant: 'destructive', title: 'Missing Information', description: 'Event assignment and a search term are required.' });
      return;
    }
    setIsSearching(true);
    setSearchedParticipant(null);
    setSearchedParticipantsList([]);
    setCheckInResult(null);
    setIsOtpSent(false);
    setOtp('');
    setRemarks('');
    setIsHandover(false);
    setHandoverName('');
    setHandoverMobile('');


    try {
      const result = await searchParticipantsForCheckInAction(eventId, searchTerm, searchBy);
      if (result.success) {
        if (result.participants) {
          setSearchedParticipantsList(result.participants);
        } else if (result.participant) {
          setSearchedParticipant(result.participant);
        }
        toast({ title: 'Search Complete', description: result.message });
      } else {
        toast({ variant: 'destructive', title: 'Not Found', description: result.message });
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Could not perform search.';
      toast({ variant: 'destructive', title: 'Search Error', description: errMsg });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSendOtp = async () => {
    if (!eventId || !searchedParticipant?.id) {
      toast({ variant: 'destructive', title: 'Missing Information', description: 'Participant details are required to send OTP.' });
      return;
    }
    setIsSendingOtp(true);
    setCheckInResult(null);
    try {
      const response = await fetch('/api/volunteer-checkin/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, participantId: searchedParticipant.id }),
      });
      const result = await response.json();

      if (response.ok && result.success) {
        toast({ title: 'OTP Sent', description: result.message });
        setIsOtpSent(true);
        startOtpResendCooldown();
      } else {
        toast({ variant: 'destructive', title: 'Failed to Send OTP', description: result.message });
        setIsOtpSent(false);
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Could not send OTP.';
      toast({ variant: 'destructive', title: 'Error', description: errMsg });
      setIsOtpSent(false);
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyAndCheckIn = async () => {
    if (!eventId || !searchedParticipant?.id || !otp) return;
    setIsVerifying(true);
    setCheckInResult(null);
    try {
      const response = await fetch('/api/volunteer-checkin/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, participantId: searchedParticipant.id, otp, volunteerId, volunteerName, clientTimestamp: new Date().toISOString(), checkInCounter: activeTab, remarks, handedOverTo: isHandover ? { name: handoverName, mobile: handoverMobile } : null }),
      });
      const result = await response.json();
      setCheckInResult(result);
      if (response.ok && result.success) {
        toast({ title: 'Check-in Successful', description: result.message });
        handleResetSearch();
      } else {
        toast({ variant: 'destructive', title: 'Check-in Failed', description: result.message });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not verify and check-in athlete.';
      setCheckInResult({ success: false, message });
      toast({ variant: 'destructive', title: 'Error', description: message });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <>
    <Card className="bg-background shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary"><UserCheck className="h-5 w-5" />Waiver Check-in</CardTitle>
        <CardDescription>Search for participants by BIB, mobile, email, or name to verify their waiver and check them in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
          <Select value={searchBy} onValueChange={(v) => setSearchBy(v as any)}>
            <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bibNumber">BIB Number</SelectItem>
              <SelectItem value="mobile">Mobile</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder={`Enter ${searchBy.replace('Number', ' No.')}...`} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} disabled={isSearching} className="flex-grow" />
          <Button type="submit" disabled={!searchTerm || isSearching} className="w-full sm:w-auto">
            {isSearching ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Searching...</> : <><SearchIcon className="h-4 w-4 mr-2" />Search</>}
          </Button>
          {(searchedParticipant || searchedParticipantsList.length > 0) && (
            <Button variant="outline" onClick={handleResetSearch}><RefreshCw className="h-4 w-4"/></Button>
          )}
        </form>

        {searchedParticipantsList.length > 0 && (
            <div className="space-y-2">
                <h4 className="text-sm font-semibold">Multiple participants found, please select one:</h4>
                {searchedParticipantsList.map(p => (
                    <Button key={p.id} variant="ghost" className="w-full justify-start h-auto" onClick={() => { setSearchedParticipant(p); setSearchedParticipantsList([]); }}>
                        <div className="flex items-center gap-3 text-left">
                            <Avatar><AvatarFallback>{getInitials(p.name)}</AvatarFallback></Avatar>
                            <div>
                                <div>{p.name}</div>
                                <div className="text-xs text-muted-foreground">BIB: {p.bibNumber || 'N/A'}</div>
                            </div>
                        </div>
                    </Button>
                ))}
            </div>
        )}

        {searchedParticipant && (
          <Card className="mt-4 p-4 border-green-600/20 bg-green-500/5">
             <CardHeader className="p-0 pb-3 flex flex-row justify-between items-start">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16 border-2 border-primary/30">
                  <AvatarImage src={searchedParticipant.userProfile?.photoURL || undefined} alt={searchedParticipant.name} />
                  <AvatarFallback className="text-xl">{getInitials(searchedParticipant.name)}</AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-xl flex items-center gap-3 text-primary">{searchedParticipant.name}</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 text-sm space-y-4">
              <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><strong>BIB:</strong> <div className="font-bold text-primary">{searchedParticipant.bibNumber || 'N/A'}</div></div>
                  <div><strong>Category:</strong> <div>{searchedParticipant.ticketName || 'N/A'}</div></div>
                  <div><strong>Status:</strong> <div><Badge variant={searchedParticipant.checkInStatus === 'CheckedIn' ? 'default' : 'destructive'}>{searchedParticipant.checkInStatus || 'Pending'}</Badge></div></div>
                  <div><strong>ID Proof:</strong>
                    {searchedParticipant.idProofUrl ? (
                      <Button variant="link" className="p-0 h-auto text-xs" onClick={() => setIsIdProofModalOpen(true)}>View Document</Button>
                    ) : (
                      ' Not Provided'
                    )}
                  </div>
              </div>
              {searchedParticipant.checkInStatus === 'CheckedIn' ? (
                <Alert variant="default" className="bg-green-100 border-green-200">
                    <AlertTitle className="text-green-800 flex items-center gap-1.5"><CheckCircle className="h-4 w-4" />Already Checked-in</AlertTitle>
                    <AlertDescription className="text-green-700">This participant was checked in at {searchedParticipant.checkedInAt ? new Date(searchedParticipant.checkedInAt).toLocaleTimeString() : 'N/A'} by {searchedParticipant.checkedInByVolunteerName || 'a volunteer'}.</AlertDescription>
                </Alert>
              ) : (
                <div className="pt-3 border-t space-y-3">
                  {!isOtpSent ? (
                    <Button onClick={handleSendOtp} disabled={isSendingOtp || resendCooldownActive} className="w-full">
                      {isSendingOtp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      <span className="ml-2">{resendCooldownActive ? `Resend OTP in ${resendTimer}s` : 'Send OTP for Verification'}</span>
                    </Button>
                  ) : (
                    <div className="space-y-4">
                       <div className="p-3 border rounded-md bg-background space-y-3">
                          <div className="space-y-1">
                            <Label htmlFor="remarks-checkin">Remarks (Optional)</Label>
                            <Textarea id="remarks-checkin" placeholder="e.g., ID verified manually, minor issue noted." value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox id="handover-check" checked={isHandover} onCheckedChange={(checked) => setIsHandover(checked as boolean)} />
                            <Label htmlFor="handover-check">Handing over kit to someone else?</Label>
                          </div>
                          {isHandover && (
                            <div className="grid grid-cols-2 gap-2 animate-in fade-in-0">
                                <div className="space-y-1">
                                    <Label htmlFor="handover-name">Receiver&apos;s Name</Label>
                                    <Input id="handover-name" value={handoverName} onChange={e => setHandoverName(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="handover-mobile">Receiver&apos;s Mobile</Label>
                                    <Input id="handover-mobile" type="tel" value={handoverMobile} onChange={e => setHandoverMobile(e.target.value)} />
                                </div>
                            </div>
                          )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <Input placeholder="Enter 6-digit OTP" value={otp} onChange={e => setOtp(e.target.value)} maxLength={6} disabled={isVerifying} className="text-center text-lg tracking-widest h-12" />
                        <Button onClick={handleVerifyAndCheckIn} disabled={isVerifying || otp.length !== 6}>
                          {isVerifying && <Loader2 className="h-4 w-4 animate-spin"/>}<span className="ml-2">Verify & Check-in</span>
                        </Button>
                      </div>
                    </div>
                  )}
                  {checkInResult && (
                      <Alert variant={checkInResult.success ? 'default' : 'destructive'} className="mt-2 text-xs"><AlertTitle>{checkInResult.success ? 'Success' : 'Error'}</AlertTitle><AlertDescription>{checkInResult.message}</AlertDescription></Alert>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
    
    <Dialog open={isIdProofModalOpen} onOpenChange={setIsIdProofModalOpen}>
        <DialogContent className="max-w-lg">
            <DialogHeader>
                <DialogTitle>ID Proof: {searchedParticipant?.name}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
                {searchedParticipant?.idProofUrl ? (
                    <Image src={searchedParticipant.idProofUrl} alt="ID Proof" width={500} height={700} className="w-full h-auto rounded-md" />
                ) : (
                    <p>No ID proof available to display.</p>
                )}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsIdProofModalOpen(false)}>Close</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    </>
  );
}
