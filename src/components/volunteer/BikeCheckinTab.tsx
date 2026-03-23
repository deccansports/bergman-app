// src/components/volunteer/BikeCheckinTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { EventParticipant, BikeRackAssignment } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Loader2, Search as SearchIcon, Bike, AlertTriangle, Check } from 'lucide-react';
import { searchParticipantForBikeAction, bikeCheckInAction } from '@/lib/actions/volunteerActions';
import { getBikeRackAssignmentsAction } from '@/lib/actions/bikeRackActions';


interface BikeCheckinTabProps {
  eventId: string;
}

export default function BikeCheckinTab({ eventId }: BikeCheckinTabProps) {
  const { toast } = useToast();
  const [bikeSearchTerm, setBikeSearchTerm] = useState('');
  const [bikeSearchBy, setBikeSearchBy] = useState<'bibNumber' | 'mobile' | 'email'>('bibNumber');
  const [isBikeSearching, setIsBikeSearching] = useState(false);
  const [bikeSearchedParticipant, setBikeSearchedParticipant] = useState<EventParticipant | null>(null);
  const [isBikeCheckingIn, setIsBikeCheckingIn] = useState(false);
  const [bikeCheckInResult, setBikeCheckInResult] = useState<{ success: boolean; message: string } | null>(null);
  const [remarks, setRemarks] = useState('');
  const [helmetCheck, setHelmetCheck] = useState(false);

  const [rackAssignments, setRackAssignments] = useState<BikeRackAssignment[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);

  useEffect(() => {
    if (eventId) {
        setIsLoadingAssignments(true);
        getBikeRackAssignmentsAction(eventId)
            .then(result => {
                if(result.success && result.assignments) {
                    setRackAssignments(result.assignments);
                }
            })
            .finally(() => setIsLoadingAssignments(false));
    }
  }, [eventId]);

  // When a participant is found, pre-fill the form with their existing details
  useEffect(() => {
    if (bikeSearchedParticipant && bikeSearchedParticipant.bikeCheckInStatus === 'CheckedIn' && bikeSearchedParticipant.bikeCheckInDetails) {
      setRemarks(bikeSearchedParticipant.bikeCheckInDetails.remarks || '');
      setHelmetCheck(bikeSearchedParticipant.bikeCheckInDetails.helmetChecked || false);
    } else {
      setRemarks('');
      setHelmetCheck(false);
    }
  }, [bikeSearchedParticipant]);


  const handleBikeSearch = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!eventId || !bikeSearchTerm) return;
    setIsBikeSearching(true);
    setBikeSearchedParticipant(null);
    setBikeCheckInResult(null);
    // Resetting fields before a new search
    setRemarks('');
    setHelmetCheck(false);

    try {
      const result = await searchParticipantForBikeAction(eventId, bikeSearchTerm, bikeSearchBy);
      if (result.success && result.participant) {
        setBikeSearchedParticipant(result.participant);
      } else {
        toast({ variant: "destructive", title: "Not Found", description: result.message });
      }
    } catch (err: any) { 
      toast({ variant: "destructive", title: "Search Error", description: err.message }); 
    } finally { 
      setIsBikeSearching(false); 
    }
  };

  const handleBikeCheckIn = async () => {
    if (!eventId || !bikeSearchedParticipant?.id) return;
    setIsBikeCheckingIn(true);
    try {
      const result = await bikeCheckInAction(
        eventId,
        bikeSearchedParticipant.id,
        new Date().toISOString(),
        remarks,
        helmetCheck,
        false // pumpCheck is now hardcoded to false as it's removed
      );
      setBikeCheckInResult(result);
      if (result.success) {
        toast({ title: "Bike Checked In", description: result.message });
        const updatedResult = await searchParticipantForBikeAction(eventId, bikeSearchTerm, bikeSearchBy);
        if (updatedResult.success && updatedResult.participant) {
          setBikeSearchedParticipant(updatedResult.participant);
        } else {
          setBikeSearchedParticipant(null); 
        }
      } else {
        toast({ variant: "destructive", title: "Check-in Failed", description: result.message });
      }
    } catch (err: any) { 
      toast({ variant: "destructive", title: "Error", description: err.message }); 
    } finally { 
      setIsBikeCheckingIn(false); 
    }
  };

  const assignedRackName = useMemo(() => {
    if (!bikeSearchedParticipant?.bibNumber || rackAssignments.length === 0) return null;
    const bibNum = parseInt(bikeSearchedParticipant.bibNumber, 10);
    if (isNaN(bibNum)) return null;

    const assignedRack = rackAssignments.find(rack => 
      bibNum >= rack.bibFrom && bibNum <= rack.bibTo
    );
    return assignedRack?.rackName || 'Not Assigned';
  }, [bikeSearchedParticipant, rackAssignments]);
  
  return (
    <Card className="bg-background shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary"><Bike className="h-5 w-5"/>Bike Check-in</CardTitle>
        <CardDescription>Search for a participant to check in their bicycle. Uses your assigned event.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleBikeSearch} className="flex flex-col sm:flex-row gap-2">
          <Select value={bikeSearchBy} onValueChange={(v) => setBikeSearchBy(v as any)}>
            <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bibNumber">BIB Number</SelectItem>
              <SelectItem value="mobile">Mobile</SelectItem>
              <SelectItem value="email">Email</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder={`Enter ${bikeSearchBy.replace('Number', ' No.')}...`} value={bikeSearchTerm} onChange={(e) => setBikeSearchTerm(e.target.value)} disabled={isBikeSearching} className="flex-grow" />
          <Button type="submit" disabled={!bikeSearchTerm || isBikeSearching} className="w-full sm:w-auto">
            {isBikeSearching ? <><Loader2 className="h-4 w-4 animate-spin mr-2"/> Searching...</> : <><SearchIcon className="h-4 w-4 mr-2"/>Search</>}
          </Button>
        </form>
         {bikeSearchedParticipant && (
           <Card className="mt-4 p-4 border-green-600/20 bg-green-500/5">
              <CardHeader className="p-0 pb-3">
                <CardTitle className="text-lg flex items-center gap-3 text-primary">{bikeSearchedParticipant.name}</CardTitle>
              </CardHeader>
              <CardContent className="p-0 text-sm space-y-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div><p className="text-xs font-semibold text-muted-foreground">BIB</p><p className="font-bold">{bikeSearchedParticipant.bibNumber || 'N/A'}</p></div>
                  <div><p className="text-xs font-semibold text-muted-foreground">Waiver Status</p><div><Badge variant={bikeSearchedParticipant.checkInStatus === 'CheckedIn' ? 'default' : 'destructive'}>{bikeSearchedParticipant.checkInStatus || 'Pending'}</Badge></div></div>
                  <div><p className="text-xs font-semibold text-muted-foreground">Bike Status</p><div><Badge variant={bikeSearchedParticipant.bikeCheckInStatus === 'CheckedIn' ? 'default' : 'secondary'}>{bikeSearchedParticipant.bikeCheckInStatus || 'Pending'}</Badge></div></div>
                  <div><p className="text-xs font-semibold text-muted-foreground">Assigned Rack</p><div>{isLoadingAssignments ? <Loader2 className="h-4 w-4 animate-spin"/> : <Badge variant="outline" className="text-base font-semibold border-primary text-primary">{assignedRackName ? `Rack ${assignedRackName}` : 'N/A'}</Badge>}</div></div>
                </div>
                {bikeSearchedParticipant.checkInStatus !== 'CheckedIn' && (
                  <Alert variant="destructive" className="mt-2 text-xs">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Waiver Pending</AlertTitle>
                    <AlertDescription>The athlete must complete the main waiver check-in before their bike can be checked in.</AlertDescription>
                  </Alert>
                )}
                 <div className="space-y-2 pt-3">
                    <Label htmlFor="remarks-checkin">Remarks</Label>
                    <Textarea id="remarks-checkin" placeholder="Note any observations (e.g., scratches, specific gear)..." value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={isBikeCheckingIn || bikeSearchedParticipant.bikeCheckInStatus === 'CheckedIn'} />
                </div>
                <div className="flex items-center space-x-4 pt-2">
                    <div className="flex items-center space-x-2">
                        <Checkbox id="helmet-check" checked={helmetCheck} onCheckedChange={(checked) => setHelmetCheck(checked as boolean)} disabled={isBikeCheckingIn || bikeSearchedParticipant.bikeCheckInStatus === 'CheckedIn'} />
                        <Label htmlFor="helmet-check">Helmet Checked</Label>
                    </div>
                </div>
                <div className="pt-3 border-t mt-3">
                    <Button onClick={handleBikeCheckIn} disabled={isBikeCheckingIn || bikeSearchedParticipant.checkInStatus !== 'CheckedIn' || bikeSearchedParticipant.bikeCheckInStatus === 'CheckedIn'} className="w-full">
                        {isBikeCheckingIn && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        {bikeSearchedParticipant.bikeCheckInStatus === 'CheckedIn' ? 'Bike Already Checked In' : 'Confirm Bike Check-in'}
                    </Button>
                </div>
                 {bikeCheckInResult && <Alert variant={bikeCheckInResult.success ? 'default' : 'destructive'} className="mt-2 text-xs"><AlertTitle>{bikeCheckInResult.success ? 'Success' : 'Error'}</AlertTitle><AlertDescription>{bikeCheckInResult.message}</AlertDescription></Alert>}
              </CardContent>
           </Card>
         )}
      </CardContent>
    </Card>
  );
}
