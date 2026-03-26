// src/components/admin/FoodLogTab.tsx
"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { UtensilsCrossed, Loader2, Search as SearchIcon, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import type { EventParticipant, EventCalendarEntry } from '@/lib/types';
import { markItemIssuedAction, searchParticipantsForCheckInAction, resetIssuedItemStatusAction } from '@/lib/actions/volunteerActions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface FoodLogTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function FoodLogTab({ events, isLoadingEvents }: FoodLogTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchedParticipant, setSearchedParticipant] = useState<EventParticipant | null>(null);
  const [isIssuing, setIsIssuing] = useState<'Breakfast' | 'Lunch' | null>(null);
  const [mealToIssue, setMealToIssue] = useState<'Breakfast' | 'Lunch' | null>(null);
  const [foodStats, setFoodStats] = useState<{ breakfast: number, lunch: number, total: number } | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isResetting, setIsResetting] = useState<'Breakfast' | 'Lunch' | null>(null);

  const fetchFoodStats = useCallback(async (currentEventId: string) => {
    setIsLoadingStats(true);
    try {
      const response = await fetch(`/api/volunteer-stats/food?eventId=${currentEventId}`);
      if(response.ok) {
        const data = await response.json();
        if(data.success) {
          const totalParticipantsResponse = await fetch(`/api/volunteer-stats/check-in?eventId=${currentEventId}`);
          const totalData = await totalParticipantsResponse.json();
          const total = totalData.success ? totalData.stats.totalParticipants : 0;
          setFoodStats({ ...data.stats, total });
        } else { throw new Error(data.message); }
      } else { throw new Error('Failed to fetch stats from server.'); }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: `Could not fetch food stats: ${e.message}` });
    }
    setIsLoadingStats(false);
  }, [toast]);

  useEffect(() => {
    if (selectedEventId) {
      fetchFoodStats(selectedEventId);
      setSearchTerm('');
      setSearchedParticipant(null);
    } else {
      setFoodStats(null);
      setIsLoadingStats(false);
    }
  }, [selectedEventId, fetchFoodStats]);

  const handleSearch = useCallback(async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!selectedEventId || !searchTerm) return;
    setIsSearching(true);
    setSearchedParticipant(null);
    setMealToIssue(null);
    try {
      const result = await searchParticipantsForCheckInAction(selectedEventId, searchTerm, 'bibNumber');
      if (result.success && result.participant) {
        setSearchedParticipant(result.participant);
      } else {
        toast({ variant: "destructive", title: "Not Found", description: result.message });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Search Error", description: err.message });
    } finally {
      setIsSearching(false);
    }
  }, [selectedEventId, searchTerm, toast]);
  
  const handleIssueMeal = async () => {
    if (!selectedEventId || !searchedParticipant?.id || !mealToIssue) return;
    setIsIssuing(mealToIssue);
    try {
      const result = await markItemIssuedAction(selectedEventId, searchedParticipant.id, mealToIssue);
      if (result.success) {
        toast({ title: 'Success', description: result.message });
        await handleSearch(); // Refresh participant data
        await fetchFoodStats(selectedEventId); // Refresh stats
      } else {
        toast({ variant: "destructive", title: "Failed", description: result.message });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setIsIssuing(null);
    }
  };

  const handleResetMeal = async (mealType: 'Breakfast' | 'Lunch') => {
      if (!selectedEventId || !searchedParticipant?.id) return;
      setIsResetting(mealType);
      try {
        const result = await resetIssuedItemStatusAction(selectedEventId, searchedParticipant.id, mealType);
        if (result.success) {
            toast({ title: 'Success', description: result.message });
            await handleSearch(); // Refresh data
            await fetchFoodStats(selectedEventId);
        } else {
            toast({ variant: 'destructive', title: "Reset Failed", description: result.message });
        }
      } catch (e: any) {
        toast({ variant: 'destructive', title: "Error", description: `Could not reset status: ${e.message}` });
      } finally {
        setIsResetting(null);
      }
  };

  const now = new Date();
  const isBreakfastTime = now.getHours() >= 7 && now.getHours() < 12;
  const isLunchTime = now.getHours() >= 12 && (now.getHours() < 16 || (now.getHours() === 16 && now.getMinutes() <= 30));

  return (
    <Card className="bg-background shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary"><UtensilsCrossed className="h-5 w-5"/>Food Log</CardTitle>
        <CardDescription>Search for an athlete by BIB number to manage food plate issuance.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select onValueChange={setSelectedEventId} value={selectedEventId || ''} disabled={isLoadingEvents}>
          <SelectTrigger><SelectValue placeholder="Select an Event..." /></SelectTrigger>
          <SelectContent>{events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}</SelectContent>
        </Select>
        
        {isLoadingStats && selectedEventId ? <p>Loading stats...</p> : selectedEventId && foodStats && (
          <div className="p-4 border rounded-lg bg-muted/30">
            <h3 className="text-lg font-semibold mb-2">Food Log Overview</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl">{foodStats.total}</CardTitle><CardDescription className="text-xs">Total Participants</CardDescription></CardHeader></Card>
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl text-green-600">{foodStats.breakfast}</CardTitle><CardDescription className="text-xs">Breakfasts Issued</CardDescription></CardHeader></Card>
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl text-blue-600">{foodStats.lunch}</CardTitle><CardDescription className="text-xs">Lunches Issued</CardDescription></CardHeader></Card>
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl text-yellow-600">{foodStats.total - (foodStats.breakfast + foodStats.lunch)}</CardTitle><CardDescription className="text-xs">Remaining</CardDescription></CardHeader></Card>
            </div>
          </div>
        )}

        <form onSubmit={handleSearch} className="flex gap-2">
            <Input placeholder="Enter athlete's BIB Number..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} disabled={isSearching || !selectedEventId} />
            <Button type="submit" disabled={!searchTerm || isSearching || !selectedEventId} className="min-w-[120px]">
                {isSearching ? <Loader2 className="animate-spin" /> : <SearchIcon className="h-4 w-4" />}
                <span className="ml-2">Search</span>
            </Button>
        </form>
        {searchedParticipant && (
            <Card className="mt-4 p-4 border-primary/20 bg-primary/5">
                <CardHeader className="p-0 pb-3"><CardTitle className="text-lg flex items-center gap-3 text-primary">{searchedParticipant.name}</CardTitle></CardHeader>
                <CardContent className="p-0 text-sm space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                        <div><p className="text-xs font-semibold text-muted-foreground">BIB</p><p className="font-bold">{searchedParticipant.bibNumber || 'N/A'}</p></div>
                        <div><p className="text-xs font-semibold text-muted-foreground">Ticket</p><p>{searchedParticipant.ticketName || 'N/A'}</p></div>
                        <div><p className="text-xs font-semibold text-muted-foreground">Breakfast</p><div><Badge variant={searchedParticipant.breakfastIssued ? 'default' : 'secondary'}>{searchedParticipant.breakfastIssued ? 'Issued' : 'Not Issued'}</Badge></div></div>
                        <div><p className="text-xs font-semibold text-muted-foreground">Lunch</p><div><Badge variant={searchedParticipant.lunchIssued ? 'default' : 'secondary'}>{searchedParticipant.lunchIssued ? 'Issued' : 'Not Issued'}</Badge></div></div>
                    </div>
                     {searchedParticipant.checkInStatus !== 'CheckedIn' && (
                        <Alert variant="destructive" className="mt-4 text-xs"><AlertTriangle className="h-4 w-4" /><AlertTitle>Waiver Pending</AlertTitle><AlertDescription>Athlete must complete waiver check-in before meals can be issued.</AlertDescription></Alert>
                    )}
                    <div className="pt-3 border-t">
                      <Label>Select Meal to Issue</Label>
                      <RadioGroup onValueChange={(v) => setMealToIssue(v as 'Breakfast' | 'Lunch')} value={mealToIssue || ''} className="flex gap-4 py-2">
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="Breakfast" id="r-breakfast" disabled={!isBreakfastTime || searchedParticipant.breakfastIssued || searchedParticipant.lunchIssued} />
                          <Label htmlFor="r-breakfast">Breakfast (7am-12pm)</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="Lunch" id="r-lunch" disabled={!isLunchTime || searchedParticipant.lunchIssued || searchedParticipant.breakfastIssued} />
                          <Label htmlFor="r-lunch">Lunch (12pm-4:30pm)</Label>
                        </div>
                      </RadioGroup>
                      <Button onClick={handleIssueMeal} disabled={!mealToIssue || isIssuing !== null || searchedParticipant.checkInStatus !== 'CheckedIn' || (mealToIssue === 'Breakfast' && !isBreakfastTime) || (mealToIssue === 'Lunch' && !isLunchTime) || searchedParticipant.breakfastIssued || searchedParticipant.lunchIssued} className="w-full mt-2">
                          {isIssuing ? <Loader2 className="animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                          <span className="ml-2">Issue Selected Meal</span>
                      </Button>
                       {(searchedParticipant.breakfastIssued || searchedParticipant.lunchIssued) && (
                          <div className="mt-2 pt-2 border-t flex gap-2">
                            {searchedParticipant.breakfastIssued && (
                              <Button variant="outline" size="sm" onClick={() => handleResetMeal('Breakfast')} disabled={!!isResetting} className="flex-1">
                                {isResetting === 'Breakfast' ? <Loader2 className="animate-spin"/> : <RefreshCw className="h-4 w-4"/>}<span className="ml-2">Reset Breakfast</span>
                              </Button>
                            )}
                             {searchedParticipant.lunchIssued && (
                              <Button variant="outline" size="sm" onClick={() => handleResetMeal('Lunch')} disabled={!!isResetting} className="flex-1">
                                {isResetting === 'Lunch' ? <Loader2 className="animate-spin"/> : <RefreshCw className="h-4 w-4"/>}<span className="ml-2">Reset Lunch</span>
                              </Button>
                            )}
                          </div>
                       )}
                    </div>
                </CardContent>
            </Card>
        )}
      </CardContent>
    </Card>
  );
}
