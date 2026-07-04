// src/components/dashboard/ClubAffiliationCard.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Building, Edit3, Check, X, AlertTriangle } from 'lucide-react';
import type { User, Club, RegisterClubExistingUserInput } from '@/lib/types';
import { updateUserProfile } from '@/lib/actions/userActions';
import { getClubListAction, registerClubForExistingUser } from '@/lib/actions/clubActions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { RegisterClubExistingUserSchema } from '@/lib/schemas';
import { useAuth } from '@/context/AuthContext';
import { countriesByContinent } from '@/lib/countries';
import { INDIAN_STATES } from '@/lib/constants';
import { COUNTRY_CODES } from '@/lib/constants/country-codes';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Instagram, Facebook } from 'lucide-react';
import { ClubPolicyAcceptance } from '@/components/club/ClubPolicyAcceptance';

function RegisterClubFormForModal({ onSuccess, onClose }: { onSuccess: (newClub: Club) => void, onClose: () => void }) {
  const { currentUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const [dialCode, setDialCode] = useState('+91');
  const [policyAccepted, setPolicyAccepted] = useState(false);

  const form = useForm<RegisterClubExistingUserInput>({
    resolver: zodResolver(RegisterClubExistingUserSchema),
    defaultValues: { 
        clubName: '', 
        coachName: '',
        clubContactEmail: '', 
        clubContactMobile: '', 
        instagramUrl: '', 
        facebookUrl: '', 
        country: 'India',
        city: '',
        state: ''
    },
  });

  const watchedCountry = form.watch('country');
  useEffect(() => {
    if (watchedCountry) {
        const country = COUNTRY_CODES.find(c => c.name.toLowerCase() === watchedCountry.toLowerCase());
        if (country) setDialCode(country.dial_code);
    }
  }, [watchedCountry]);

  async function onSubmit(values: RegisterClubExistingUserInput) {
    if (!currentUser?.uid) return;
    setIsLoading(true);
    try {
      const fullMobile = `${dialCode}${values.clubContactMobile.replace(/\D/g, '')}`;
      const result = await registerClubForExistingUser(currentUser.uid, currentUser.name || null, { ...values, clubContactMobile: fullMobile });
      if (result.success && result.club) {
        toast({ title: "Club Registered!" });
        onSuccess(result.club);
      } else {
        toast({ variant: "destructive", title: "Failed", description: result.message });
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
     <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 text-left">
        <div className="max-h-[45vh] overflow-y-auto pr-4 space-y-4 py-2">
                <FormField control={form.control} name="clubName" render={({ field }) => ( <FormItem><FormLabel>Club Name</FormLabel><FormControl><Input {...field} placeholder="Official Name" disabled={isLoading} /></FormControl><FormMessage /></FormItem> )} />
                <FormField control={form.control} name="coachName" render={({ field }) => ( <FormItem><FormLabel>Coach / Owner Name</FormLabel><FormControl><Input {...field} value={field.value || ""} placeholder="Your full name" disabled={isLoading} /></FormControl><FormMessage /></FormItem> )} />
                <FormField control={form.control} name="clubContactEmail" render={({ field }) => ( <FormItem><FormLabel>Public Contact Email</FormLabel><FormControl><Input type="email" {...field} value={field.value || ""} disabled={isLoading} /></FormControl><FormMessage /></FormItem> )} />
                
                <div className="space-y-1 text-left">
                    <FormLabel className="text-xs font-bold uppercase text-muted-foreground">Contact Mobile (WhatsApp)</FormLabel>
                    <div className="flex gap-2">
                        <Select value={dialCode} onValueChange={setDialCode}>
                            <SelectTrigger className="w-20 h-10 rounded-xl font-bold bg-muted/20 px-2">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                                {COUNTRY_CODES.map(c => <SelectItem key={c.code} value={c.dial_code}>{c.dial_code}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormField control={form.control} name="clubContactMobile" render={({ field }) => ( <FormItem className="flex-grow"><FormControl><Input type="tel" placeholder="9876543210" {...field} value={field.value || ""} disabled={isLoading} /></FormControl><FormMessage /></FormItem> )} />
                    </div>
                </div>
                
                <Separator />
                
                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="instagramUrl" render={({ field }) => ( <FormItem><FormLabel className="flex items-center gap-2"><Instagram className="h-3 w-3 text-pink-600"/> Instagram</FormLabel><FormControl><Input {...field} value={field.value || ""} placeholder="URL" disabled={isLoading} /></FormControl></FormItem> )} />
                    <FormField control={form.control} name="facebookUrl" render={({ field }) => ( <FormItem><FormLabel className="flex items-center gap-2"><Facebook className="h-3 w-3 text-blue-600"/> Facebook</FormLabel><FormControl><Input {...field} value={field.value || ""} placeholder="URL" disabled={isLoading} /></FormControl></FormItem> )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="country" render={({ field }) => (
                        <FormItem><FormLabel>Country</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || 'India'}>
                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                    {Object.entries(countriesByContinent).map(([continent, countries]) => (
                                        <SelectGroup key={continent}>
                                            <SelectLabel>{continent}</SelectLabel>
                                            {countries.map(country => <SelectItem key={country.code} value={country.name}>{country.name}</SelectItem>)}
                                        </SelectGroup>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="city" render={({ field }) => ( <FormItem><FormLabel>City</FormLabel><FormControl><Input {...field} value={field.value || ""} placeholder="e.g. Pune" disabled={isLoading} /></FormControl></FormItem> )} />
                </div>
                {form.watch('country') === 'India' && (
                    <FormField control={form.control} name="state" render={({ field }) => (
                        <FormItem><FormLabel>State</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ''}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select state"/></SelectTrigger></FormControl>
                                <SelectContent>
                                    {INDIAN_STATES.map(s => <SelectItem key={s.value} value={s.name}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )} />
                )}
                <ClubPolicyAcceptance accepted={policyAccepted} onAcceptChange={setPolicyAccepted} />
            </div>
        <DialogFooter className="pt-4 border-t">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button type="submit" disabled={isLoading || !policyAccepted}>{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Register Club</Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export function ClubAffiliationCard({ user: initialUser, onUpdate }: { user: User | null; onUpdate?: (updatedData: Partial<User>) => void; }) {
  const [isLoading, setIsLoading] = useState(false);
  const [allClubs, setAllClubs] = useState<{ id: string; name: string }[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [clubSearchTerm, setClubSearchTerm] = useState('');
  const [isClubModalOpen, setIsClubModalOpen] = useState(false);
  const [isUnaffiliateDialogOpen, setIsUnaffiliateDialogOpen] = useState(false);
  const [isClubPolicyModalOpen, setIsClubPolicyModalOpen] = useState(false);
  const { toast } = useToast();
  const { currentUser, firebaseUserFromAuth, fetchUserProfile } = useAuth();

  const user = currentUser || initialUser;

  useEffect(() => {
    if (user) {
      setSelectedClubId(user.clubId || null);
    }
  }, [user]);

  useEffect(() => {
    getClubListAction().then(res => { if (res.success && res.clubs) setAllClubs(res.clubs); });
  }, []);

  const handleClubChange = async () => {
    if (!user?.uid) return;
    setIsLoading(true);
    try {
      const result = await updateUserProfile(user.uid, { clubId: selectedClubId === "NONE" ? null : selectedClubId } as any);
      if (result.success) {
        toast({ title: 'Club Affiliation Updated!', description: 'Your club affiliation has been successfully changed.' });
        if (fetchUserProfile && firebaseUserFromAuth) await fetchUserProfile(firebaseUserFromAuth);
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) return null;

  const filteredClubs = allClubs.filter(club => club.name.toLowerCase().includes(clubSearchTerm.toLowerCase()));
  const currentClubName = user.clubName || 'None / Unaffiliated';
  const isClubOwner = !!user.ownedClubId;
  const currentAffiliationClass = user?.clubId
    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-blue-700 shadow-md shadow-blue-600/25"
    : "bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 border-slate-300";

  return (
    <Card className="w-full shadow-lg rounded-xl border-l-4 border-blue-500 overflow-hidden hover:shadow-xl transition-shadow duration-300 bg-gradient-to-br from-blue-50/50 to-background">
      <CardHeader className="bg-gradient-to-r from-blue-500/10 to-blue-400/5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/20 rounded-lg">
              <Building className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-lg font-black uppercase tracking-tight">Club Affiliation</CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                {isClubOwner ? 'You are a club owner' : 'Manage your club association'}
              </CardDescription>
            </div>
          </div>
          <Edit3 className="h-5 w-5 text-muted-foreground opacity-50" />
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-5">
        {/* Current Club Display */}
        <div className="bg-gradient-to-r from-blue-500/5 to-transparent p-5 rounded-lg border border-blue-200/50">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-3">Current Affiliation</Label>
          <div className="flex items-center justify-between gap-4">
            <div className={`inline-flex items-center rounded-xl border px-4 py-2.5 text-sm md:text-base font-black tracking-tight ${currentAffiliationClass}`}>
              <Building className="h-4 w-4 mr-2" />
              <span className="truncate max-w-[220px] md:max-w-[280px]">{currentClubName}</span>
            </div>
            <div className="flex items-center gap-3">
              {isClubOwner && (
                <Badge className="bg-green-100 text-green-800 border-green-300">
                  <Check className="h-3 w-3 mr-1" />
                  Owner
                </Badge>
              )}
              {!isClubOwner && user?.clubId && (
                <Dialog open={isUnaffiliateDialogOpen} onOpenChange={setIsUnaffiliateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      variant="destructive"
                      size="sm"
                      className="h-9 px-3 text-xs font-bold uppercase tracking-wide rounded-lg"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Unaffiliate
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md rounded-xl">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-lg">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        Unaffiliate Club
                      </DialogTitle>
                      <DialogDescription>Please review the club policy details before continuing.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
                        <p className="text-sm text-destructive font-semibold mb-2">⚠️ Warning</p>
                        <div className="space-y-2 text-sm text-foreground leading-relaxed">
                          <p>
                            You are about to unaffiliate from <strong>{currentClubName}</strong>. This will remove your active club association.
                          </p>
                          <p>
                            As per club policy, points earned while you were affiliated with this club remain tied to that club period.
                          </p>
                          <p>
                            If you join a new club later, only points earned from races completed after joining the new club will count toward that new affiliation.
                          </p>
                        </div>
                      </div>
                    </div>
                    <DialogFooter className="gap-2 flex-col sm:flex-row sm:justify-between">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setIsUnaffiliateDialogOpen(false);
                          setIsClubPolicyModalOpen(true);
                        }}
                        className="rounded-lg w-full sm:w-auto"
                      >
                        📖 Club Policy
                      </Button>
                      <div className="flex w-full sm:w-auto gap-2">
                      <Button 
                        variant="outline" 
                        onClick={() => setIsUnaffiliateDialogOpen(false)}
                        className="rounded-lg flex-1 sm:flex-none"
                      >
                        Cancel
                      </Button>
                      <Button 
                        variant="destructive"
                        onClick={async () => {
                          if (!user?.uid) return;
                          setIsLoading(true);
                          try {
                            const result = await updateUserProfile(user.uid, { clubId: null } as any);
                            if (result.success) {
                              toast({ title: 'Club Unaffiliated!', description: 'Your club affiliation has been removed. You can join another club anytime.' });
                              setSelectedClubId(null);
                              setIsUnaffiliateDialogOpen(false);
                              if (fetchUserProfile && firebaseUserFromAuth) await fetchUserProfile(firebaseUserFromAuth);
                            }
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                        disabled={isLoading}
                        className="rounded-lg flex-1 sm:flex-none"
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Unaffiliating...
                          </>
                        ) : (
                          <>
                            <X className="h-4 w-4 mr-2" />
                            Yes, Unaffiliate
                          </>
                        )}
                      </Button>
                      </div>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>

          {/* Warning Message when affiliated */}
          {user?.clubId && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900">
                <strong>⚠️ Club Affiliation Active:</strong> You are currently affiliated with {currentClubName}. Unaffiliating will remove your association. You can join another club anytime after unaffiliating.
              </p>
            </div>
          )}
        </div>

        {isClubOwner ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm text-amber-900">
              ✓ <strong>Club Owner Status:</strong> Your affiliation is locked to your own club. To change affiliation, you must transfer club ownership.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Search and Club Selection Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Search Column */}
              <div className="space-y-3">
                <Label htmlFor="club-search" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  🔍 Search Club
                </Label>
                <Input 
                  id="club-search"
                  type="text"
                  placeholder='Type club name...' 
                  className='w-full rounded-lg border border-input bg-background hover:border-blue-400 focus:border-blue-500 transition-colors h-11' 
                  onChange={(e) => setClubSearchTerm(e.target.value)} 
                  value={clubSearchTerm}
                />
                
                {/* Search Results List */}
                {clubSearchTerm && (
                  <div className="border border-blue-200 rounded-lg overflow-hidden shadow-sm bg-background">
                    <div className="max-h-48 overflow-y-auto">
                      {filteredClubs.length > 0 ? (
                        filteredClubs.map(club => (
                          <button
                            key={club.id}
                            onClick={() => {
                              setSelectedClubId(club.id);
                              setClubSearchTerm('');
                            }}
                            className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-blue-50 border-b border-blue-100/50 last:border-b-0 transition-colors"
                          >
                            <Building className="h-4 w-4 text-blue-600 flex-shrink-0" />
                            <span className="font-medium text-foreground truncate">{club.name}</span>
                          </button>
                        ))
                      ) : (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                          No clubs found matching &quot;{clubSearchTerm}&quot;
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Select Column */}
              <div className="space-y-3">
                <Label htmlFor="club-select" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  📋 Select Club
                </Label>
                <Select onValueChange={(value) => {
                  setSelectedClubId(value);
                  setClubSearchTerm('');
                }} value={selectedClubId || "NONE"}>
                  <SelectTrigger id="club-select" className="bg-background border border-input shadow-sm rounded-lg h-11 hover:border-blue-400 focus:border-blue-500 transition-colors">
                    <SelectValue placeholder="Select club..." />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg w-full min-w-[300px]">
                    <SelectItem value="NONE">
                      <div className="flex items-center gap-2">
                        <X className="h-4 w-4" />
                        No Affiliation
                      </div>
                    </SelectItem>
                    {allClubs.map(club => (
                      <SelectItem key={club.id} value={club.id}>
                        <div className="flex items-center gap-2">
                          <Building className="h-4 w-4" />
                          {club.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Update Button */}
            <Button 
              onClick={handleClubChange} 
              disabled={isLoading || selectedClubId === (user?.clubId || null)}
              className="w-full h-11 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold uppercase tracking-wide rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Update Affiliation
                </>
              )}
            </Button>

            {/* Register Club Link */}
            <Dialog open={isClubModalOpen} onOpenChange={setIsClubModalOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="outline"
                  className="w-full h-10 border-blue-300 text-blue-600 hover:bg-blue-50 font-semibold rounded-lg"
                >
                  + Register Your Club
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md text-left">
                <DialogHeader>
                  <DialogTitle>Register Your Club</DialogTitle>
                  <DialogDescription>Become an owner and manage your squad on Bergman.</DialogDescription>
                </DialogHeader>
                <RegisterClubFormForModal 
                  onSuccess={(newClub) => { 
                      toast({ title: "Club Registered", description: "Welcome to club management!" }); 
                      if (onUpdate) onUpdate({ ownedClubId: newClub.id, ownedClubName: newClub.name, clubId: newClub.id, clubName: newClub.name }); 
                      setIsClubModalOpen(false); 
                  }} 
                  onClose={() => setIsClubModalOpen(false)} 
                />
              </DialogContent>
            </Dialog>
            {/* Helper Text */}
            <p className="text-xs text-muted-foreground text-center pt-2 leading-relaxed">
              Can&apos;t find your club? Register it and become the owner to manage members and events.
            </p>
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={() => setIsClubPolicyModalOpen(true)}
          className="w-full h-10 border-blue-300 text-blue-700 hover:bg-blue-50 font-semibold rounded-lg"
        >
          📖 Club Policy
        </Button>

        <Dialog open={isClubPolicyModalOpen} onOpenChange={setIsClubPolicyModalOpen}>
          <DialogContent className="sm:max-w-3xl text-left rounded-xl">
            <DialogHeader>
              <DialogTitle className="text-xl font-black uppercase tracking-tight">Bergman Affiliate Club Policy</DialogTitle>
              <DialogDescription>Effective for club affiliations, points allocation, and rankings across Bergman events.</DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[70vh] pr-4">
              <div className="space-y-5 py-1 text-sm leading-relaxed">
                <section className="space-y-1">
                  <h4 className="font-bold">1. Purpose</h4>
                  <p>The Bergman Affiliate Club system is designed to promote team spirit, athlete development, and fair club rankings across all Bergman events.</p>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">2. Club Affiliation Rules</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Athletes must officially affiliate with a club before participating in a race for their points to count toward that club.</li>
                    <li>Club affiliation must be completed through the official Bergman system or registration platform.</li>
                    <li>Any affiliation made after race participation will not be considered for past events.</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">3. Points Allocation Policy</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Points earned by an athlete before joining a club will not be added to the club&rsquo;s total.</li>
                    <li>Only points earned after official club affiliation will be counted toward club rankings.</li>
                    <li>Points once allocated to a club are final and non-transferable.</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">4. Club Change Policy</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Athletes are allowed to change their club affiliation at any time.</li>
                    <li>All points earned while representing a previous club will remain permanently with that club.</li>
                    <li>Points earned after joining a new club will only count toward the new club.</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">5. Athlete Removal by Club</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>A Club Owner/Coach has the right to remove any affiliated athlete if the athlete is no longer an active member of the club or violates club or Bergman policies.</li>
                    <li>All previously earned points remain with the club.</li>
                    <li>Removal does not retroactively affect club rankings.</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">6. Club Ranking Eligibility</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>A club must have a minimum of 3 affiliated athletes who have earned points to be eligible for ranking.</li>
                    <li>If fewer than 3 athletes have points, the club will be marked as “Unranked”.</li>
                    <li>Once the minimum requirement is met, the club is automatically included in official rankings.</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">7. Communication &amp; Notifications</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>When an athlete joins a club, an email notification will be sent to the Club Owner/Coach.</li>
                    <li>A WhatsApp notification will also be triggered.</li>
                    <li>Notifications will include athlete name, contact details, and registration confirmation.</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">8. Event Visibility for Club Owners</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Club Owners/Coaches will have access to view all registered events of their affiliated athletes.</li>
                    <li>Club Owners/Coaches will be able to view athlete participation status (Registered / Completed / DNF / DNS).</li>
                    <li>This visibility supports better coaching, team planning, and performance tracking.</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">9. Athlete Responsibilities</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Athletes must ensure accurate club selection during registration.</li>
                    <li>Athletes must comply with all Bergman race rules and club policies.</li>
                    <li>By joining a club, athletes consent to sharing necessary registration and event participation details with their club coach/owner.</li>
                    <li>Any misuse of club affiliation (false claims, dual representation, etc.) may lead to disqualification, removal from rankings, or a ban from future events (if severe).</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">10. Club Responsibilities</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Clubs must maintain accurate and genuine athlete memberships.</li>
                    <li>Clubs must use athlete data responsibly and only for training and event-related purposes.</li>
                    <li>Clubs must ensure fair representation and ethical conduct.</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">11. Rankings &amp; Leaderboards</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Club rankings are calculated based on total points accumulated by affiliated athletes.</li>
                    <li>Rankings are dynamic and updated after each event.</li>
                    <li>In case of disputes, the Bergman Organising Committee&rsquo;s decision is final.</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">12. Fair Play &amp; Integrity</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Bergman promotes fair competition, transparency in rankings, and respect among clubs and athletes.</li>
                    <li>Any attempt to manipulate rankings or exploit the system will result in penalty or disqualification of club and/or athletes.</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">13. Rights of the Organisers</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Bergman Organisers reserve the right to modify or update the club policy at any time.</li>
                    <li>Bergman Organisers reserve the right to audit club affiliations and points allocation.</li>
                    <li>Bergman Organisers reserve the right to take necessary action in case of disputes or violations.</li>
                  </ul>
                </section>

                <section className="space-y-1">
                  <h4 className="font-bold">14. Acceptance of Policy</h4>
                  <p>By affiliating with a club or participating in Bergman events, athletes and clubs agree to abide by this policy.</p>
                </section>
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsClubPolicyModalOpen(false)} className="rounded-lg">
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
