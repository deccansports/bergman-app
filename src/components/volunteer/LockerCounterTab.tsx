// src/components/volunteer/LockerCounterTab.tsx
"use client";

import React, { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search as SearchIcon, Package, PackageOpen, KeyRound, AlertTriangle } from 'lucide-react';
import type { EventParticipant } from '@/lib/types';
import { searchParticipantsForCheckInAction, assignLockerAction, returnLockerAction } from '@/lib/actions/volunteerActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

interface LockerCounterTabProps {
  eventId: string;
}

export default function LockerCounterTab({ eventId }: LockerCounterTabProps) {
  const { toast } = useToast();
  
  // States for Locker Allocation
  const [lockerSearchTerm, setLockerSearchTerm] = useState('');
  const [isLockerSearching, setIsLockerSearching] = useState(false);
  const [lockerSearchedParticipant, setLockerSearchedParticipant] = useState<EventParticipant | null>(null);
  const [isAssigningLocker, setIsAssigningLocker] = useState(false);
  const [lockerAssignmentResult, setLockerAssignmentResult] = useState<{ success: boolean; message: string } | null>(null);

  // States for Locker Return
  const [lockerReturnSearchTerm, setLockerReturnSearchTerm] = useState('');
  const [isReturningLocker, setIsReturningLocker] = useState(false);

  const handleLockerSearch = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!eventId || !lockerSearchTerm) return;
    setIsLockerSearching(true);
    setLockerSearchedParticipant(null);
    setLockerAssignmentResult(null);
    try {
      const result = await searchParticipantsForCheckInAction(eventId, lockerSearchTerm, 'bibNumber');
      if (result.success && result.participant) {
        setLockerSearchedParticipant(result.participant);
      } else {
        toast({ variant: "destructive", title: "Not Found", description: result.message });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Search Error", description: err.message });
    } finally {
      setIsLockerSearching(false);
    }
  };

  const handleAssignLocker = async () => {
    if (!eventId || !lockerSearchedParticipant) return;
    setIsAssigningLocker(true);
    setLockerAssignmentResult(null);
    try {
      const result = await assignLockerAction(eventId, lockerSearchedParticipant.id);
      setLockerAssignmentResult(result);
      if (result.success) {
        toast({ title: "Locker Assigned!", description: result.message });
        const updatedResult = await searchParticipantsForCheckInAction(eventId, lockerSearchedParticipant.bibNumber!, 'bibNumber');
        if (updatedResult.success && updatedResult.participant) {
          setLockerSearchedParticipant(updatedResult.participant);
        }
      } else {
        toast({ variant: "destructive", title: "Assignment Failed", description: result.message });
      }
    } catch (err: any) {
      setLockerAssignmentResult({ success: false, message: "An unexpected error occurred." });
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setIsAssigningLocker(false);
    }
  };

  const handleReturnLocker = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!eventId || !lockerReturnSearchTerm) return;
    setIsReturningLocker(true);
    try {
        const result = await returnLockerAction(eventId, lockerReturnSearchTerm);
        if(result.success) {
            toast({ title: 'Success', description: result.message });
            setLockerReturnSearchTerm('');
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
    } catch (err: any) {
        toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
        setIsReturningLocker(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="bg-background shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-primary"><Package className="h-5 w-5" />Locker Allocation</CardTitle>
          <CardDescription>Search for an athlete by BIB to assign a locker.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleLockerSearch} className="flex flex-col sm:flex-row gap-2">
              <Input placeholder="Enter athlete's BIB Number..." value={lockerSearchTerm} onChange={(e) => setLockerSearchTerm(e.target.value)} disabled={isLockerSearching} />
              <Button type="submit" disabled={!lockerSearchTerm || isLockerSearching} className="min-w-[120px]">
                {isLockerSearching ? <><Loader2 className="h-4 w-4 animate-spin"/> Searching...</> : <><SearchIcon className="h-4 w-4"/><span className="ml-2">Search</span></>}
              </Button>
          </form>
          {lockerSearchedParticipant && (
            <Card className="mt-4 p-4 border-primary/20 bg-primary/5">
              <CardHeader className="p-0 pb-3"><CardTitle className="text-lg flex items-center gap-3 text-primary">{lockerSearchedParticipant.name}</CardTitle></CardHeader>
              <CardContent className="p-0 text-sm space-y-2">
                  <div><strong>BIB:</strong> <span className="font-bold text-primary">{lockerSearchedParticipant.bibNumber || 'N/A'}</span></div>
                  <div><strong>Waiver Status:</strong> <Badge variant={lockerSearchedParticipant.checkInStatus === 'CheckedIn' ? 'default' : 'destructive'}>{lockerSearchedParticipant.checkInStatus || 'Pending'}</Badge></div>
                  <div><strong>Locker Number:</strong> {lockerSearchedParticipant.lockerNumber ? <Badge variant="default" className="text-base font-mono">{lockerSearchedParticipant.lockerNumber}</Badge> : <Badge variant="secondary">Not Assigned</Badge>}</div>
                  <div className="pt-3 border-t mt-3">
                      <Button onClick={handleAssignLocker} disabled={isAssigningLocker || !!lockerSearchedParticipant.lockerNumber || lockerSearchedParticipant.checkInStatus !== 'CheckedIn'} className="w-full">
                          {isAssigningLocker ? <Loader2 className="h-4 w-4 animate-spin"/> : <KeyRound className="h-4 w-4"/>}
                          <span className="ml-2">{lockerSearchedParticipant.lockerNumber ? "Locker Already Assigned" : "Generate & Assign Locker"}</span>
                      </Button>
                  </div>
                   {lockerSearchedParticipant.checkInStatus !== 'CheckedIn' && (
                      <Alert variant="destructive" className="mt-4 text-xs">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Waiver Pending</AlertTitle>
                        <AlertDescription>The athlete must complete the main waiver check-in before a locker can be assigned.</AlertDescription>
                      </Alert>
                    )}
              </CardContent>
            </Card>
          )}
          {lockerAssignmentResult && <Alert variant={lockerAssignmentResult.success ? 'default' : 'destructive'}><AlertTitle>{lockerAssignmentResult.success ? 'Success' : 'Error'}</AlertTitle><AlertDescription>{lockerAssignmentResult.message}</AlertDescription></Alert>}
        </CardContent>
      </Card>
       <Card className="bg-background shadow-md">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-600"><PackageOpen className="h-5 w-5" /> Locker Return</CardTitle>
                <CardDescription>Enter the locker number provided by the athlete to complete the return.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <form onSubmit={handleReturnLocker} className="flex flex-col sm:flex-row gap-2">
                    <Input placeholder="Enter 4-digit Locker Number..." value={lockerReturnSearchTerm} onChange={(e) => setLockerReturnSearchTerm(e.target.value)} maxLength={4} disabled={isReturningLocker} />
                    <Button type="submit" disabled={!lockerReturnSearchTerm || isReturningLocker} className="min-w-[120px] bg-blue-600 hover:bg-blue-700">
                        {isReturningLocker ? <Loader2 className="animate-spin h-4 w-4"/> : <PackageOpen className="h-4 w-4"/>}
                        <span className="ml-2">Return</span>
                    </Button>
                </form>
            </CardContent>
        </Card>
    </div>
  );
}
