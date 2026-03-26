// src/components/dashboard/UserProfile.tsx
"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, Smartphone, Edit, Camera, Building, Users, ShieldAlert, Globe, MapPin, Check, Instagram, Facebook } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { User, Club, RegisterClubExistingUserInput, UserProfileUpdateData } from '@/lib/types';
import { storage as firebaseClientStorage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { updateUserProfile } from '@/lib/actions/userActions';
import { getClubListAction, registerClubForExistingUser } from '@/lib/actions/clubActions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { RegisterClubExistingUserSchema } from '@/lib/schemas';
import { useAuth } from '@/context/AuthContext';
import { countriesByContinent } from '@/lib/countries';
import { INDIAN_STATES, NO_CLUB_SELECTED_VALUE } from '@/lib/constants';
import { COUNTRY_CODES } from '@/lib/constants/country-codes';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { getCountryFlagEmoji, toDateStringSafe, isValidImageUrl, getInitials } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

function RegisterClubFormForModal({ onSuccess, onClose }: { onSuccess: (newClub: Club) => void, onClose: () => void }) {
  const { currentUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const [dialCode, setDialCode] = useState('+91');

  const form = useForm<RegisterClubExistingUserInput>({
    resolver: zodResolver(RegisterClubExistingUserSchema),
    defaultValues: { 
        clubName: '', 
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
        <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4 py-2">
                <FormField control={form.control} name="clubName" render={({ field }) => ( <FormItem><FormLabel>Club Name</FormLabel><FormControl><Input {...field} placeholder="Official Name" disabled={isLoading} /></FormControl><FormMessage /></FormItem> )} />
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
            </div>
        </ScrollArea>
        <DialogFooter className="pt-4 border-t">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button type="submit" disabled={isLoading}>{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Register Club</Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

const profileSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters.' }).optional(),
  mobile: z.string().min(10, { message: 'Mobile number must be at least 10 digits.' }).optional().or(z.literal('')),
  country: z.string().optional().or(z.literal('')), 
  state: z.string().optional().or(z.literal('')),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export function UserProfile({ user: initialUser, onUpdate }: { user: User | null; onUpdate?: (updatedData: Partial<User>) => void; }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [allClubs, setAllClubs] = useState<{ id: string; name: string }[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [clubSearchTerm, setClubSearchTerm] = useState('');
  const [isClubModalOpen, setIsClubModalOpen] = useState(false);
  const [dialCode, setDialCode] = useState('+91');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { currentUser, firebaseUserFromAuth, fetchUserProfile } = useAuth();

  const user = currentUser || initialUser;

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: '', mobile: '', country: '', state: '' },
  });

  const watchedCountry = profileForm.watch("country");

  useEffect(() => {
    if (watchedCountry) {
        const country = COUNTRY_CODES.find(c => c.name.toLowerCase() === watchedCountry.toLowerCase());
        if (country) setDialCode(country.dial_code);
    }
  }, [watchedCountry]);

  useEffect(() => {
    if (user) {
      let mobileOnly = user.mobile || '';
      if (mobileOnly.startsWith('+')) {
          const matched = COUNTRY_CODES.find(c => mobileOnly.startsWith(c.dial_code));
          if (matched) {
              setDialCode(matched.dial_code);
              mobileOnly = mobileOnly.replace(matched.dial_code, '');
          }
      }

      profileForm.reset({ 
        name: user.name || '', 
        mobile: mobileOnly, 
        country: user.country || 'India', 
        state: user.state || '' 
      });
      setSelectedClubId(user.clubId || null);
    }
  }, [user, profileForm]);

  useEffect(() => {
    getClubListAction().then(res => { if (res.success && res.clubs) setAllClubs(res.clubs); });
  }, []);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!user?.uid || !file || !firebaseClientStorage) return;
    setIsUploading(true);
    const filePath = `profilePictures/${user.uid}/profile.${file.name.split('.').pop()}`;
    try {
      const fileRef = ref(firebaseClientStorage, filePath);
      await uploadBytes(fileRef, file);
      const downloadURL = await getDownloadURL(fileRef);
      const result = await updateUserProfile(user.uid, { photoURL: downloadURL } as UserProfileUpdateData);
      if (result.success && onUpdate) onUpdate(result.updatedUser as Partial<User>);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Upload Failed' });
    } finally {
      setIsUploading(false);
    }
  };

  const onSubmitDetails = async (data: ProfileFormData) => {
    if (!user?.uid) return;
    setIsLoading(true);
    try {
        const fullMobile = `${dialCode}${data.mobile?.replace(/\D/g, '')}`;
        const result = await updateUserProfile(user.uid, { ...data, mobile: fullMobile } as UserProfileUpdateData);
        if (result.success) {
            toast({ title: 'Profile Updated' });
            if (fetchUserProfile && firebaseUserFromAuth) await fetchUserProfile(firebaseUserFromAuth);
            setIsEditing(false);
        }
    } finally {
      setIsLoading(false);
    }
  };

  const handleClubChange = async () => {
    if (!user?.uid) return;
    setIsLoading(true);
    try {
      const result = await updateUserProfile(user.uid, { clubId: selectedClubId === "NONE" ? null : selectedClubId } as UserProfileUpdateData);
      if (result.success) {
        toast({ title: 'Club Affiliation Updated!' });
        if (fetchUserProfile && firebaseUserFromAuth) await fetchUserProfile(firebaseUserFromAuth);
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) return null;

  const filteredClubs = allClubs.filter(club => club.name.toLowerCase().includes(clubSearchTerm.toLowerCase()));
  const validPhotoUrl = isValidImageUrl(user.photoURL) ? user.photoURL : undefined;

  return (
     <Card className="w-full shadow-xl relative overflow-hidden rounded-xl border-t-4 border-primary/50 text-left">
        <div className="absolute top-2 right-2 z-10">
           <Dialog open={isEditing} onOpenChange={setIsEditing}>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-primary hover:bg-primary/10 rounded-full">
                        <Edit className="h-4 w-4" />
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md text-left">
                    <DialogHeader>
                        <DialogTitle>Edit Profile Details</DialogTitle>
                        <DialogDescription>Update your personal info used for race registrations.</DialogDescription>
                    </DialogHeader>
                    <Form {...profileForm}>
                        <form onSubmit={profileForm.handleSubmit(onSubmitDetails)} className="space-y-4 py-4 text-left">
                            <FormField control={profileForm.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Full Name</FormLabel>
                                    <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}/>
                            
                            <div className="space-y-1">
                                <FormLabel>Mobile Number (WhatsApp)</FormLabel>
                                <div className="flex gap-2">
                                    <Select value={dialCode} onValueChange={setDialCode}>
                                        <SelectTrigger className="w-20 h-10 rounded-xl font-bold bg-muted/20 px-2">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-60">
                                            {COUNTRY_CODES.map(c => <SelectItem key={c.code} value={c.dial_code}>{c.dial_code}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <FormField control={profileForm.control} name="mobile" render={({ field }) => (
                                        <FormItem className="flex-grow">
                                            <FormControl><Input {...field} value={field.value ?? ""} placeholder="9876543210"/></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}/>
                                </div>
                            </div>

                            <FormField control={profileForm.control} name="country" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Country</FormLabel>
                                    <Select onValueChange={(value) => { field.onChange(value === "NONE" ? "" : value); if (value !== "India") { profileForm.setValue("state", ""); } }} value={field.value || "NONE"}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="Select Country"/></SelectTrigger></FormControl>
                                        <SelectContent>
                                            {Object.entries(countriesByContinent).map(([continent, countries]) => (
                                                <SelectGroup key={continent}>
                                                    <SelectLabel>{continent}</SelectLabel>
                                                    {countries.map(country => (<SelectItem key={country.code} value={country.name}>{country.name}</SelectItem>))}
                                                </SelectGroup>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}/>
                            {watchedCountry === 'India' && (
                                <FormField control={profileForm.control} name="state" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>State (India)</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value || ''}>
                                            <FormControl><SelectTrigger><SelectValue placeholder="Select State..."/></SelectTrigger></FormControl>
                                            <SelectContent>
                                                {INDIAN_STATES.map(state => (<SelectItem key={state.value} value={state.name}>{state.name}</SelectItem>))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}/>
                            )}
                            <DialogFooter>
                                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                                <Button type="submit" disabled={isLoading}>{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        </div>

      <CardHeader className="flex flex-col items-center text-center gap-4 pb-4 bg-gradient-to-b from-primary/5 to-accent/5 p-6 pt-8 text-left">
          <div className="relative group">
              <Avatar className="h-24 w-24 border-4 border-background shadow-lg">
                  <AvatarImage src={validPhotoUrl} alt={user.name || 'Profile'} className="object-cover" />
                  <AvatarFallback className="bg-primary/20 text-primary text-3xl font-semibold">{getInitials(user.name)}</AvatarFallback>
              </Avatar>
              <Button variant="outline" size="icon" className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-background/80 shadow-md" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                {isUploading ? <Loader2 className="h-4 w-4 animate-pulse" /> : <Camera className="h-4 w-4 text-primary" />}
              </Button>
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight text-foreground text-center">{user.name || 'Athlete Profile'}</CardTitle>
      </CardHeader>
      
      <CardContent className="p-6 space-y-3 text-sm text-left">
        <div className="flex items-center gap-3 border-b border-border/50 pb-3 font-medium">
            <Mail className="h-5 w-5 text-primary shrink-0" />
            <span className="truncate">{user.email}</span>
        </div>
        <div className="flex items-center gap-3 border-b border-border/50 pb-3 font-medium">
            <Smartphone className="h-5 w-5 text-primary shrink-0" />
            <span>{user.mobile || 'No mobile number'}</span>
        </div>
        <div className="flex items-center gap-3 border-b border-border/50 pb-3 font-medium">
            <span className="h-5 w-5 flex items-center justify-center text-xl shrink-0">
                {getCountryFlagEmoji(user.country)}
            </span>
            <span className="text-foreground capitalize">
                {user.country || 'Country not set'}
                {user.state ? `, ${user.state}` : ''}
            </span>
        </div>
        
        {user.ownedClubId ? (
            <Alert className="bg-primary/5 border-primary/20 text-left mt-4 rounded-xl">
                <ShieldAlert className="h-4 w-4 text-primary" />
                <AlertTitle className="font-bold">Club Owner Status</AlertTitle>
                <AlertDescription className="text-xs text-left">You are the owner of <strong>{user.ownedClubName}</strong>. Affiliation is locked to your own club.</AlertDescription>
            </Alert>
        ) : (
          <div className="space-y-3 pt-4 text-left">
            <Label className="flex items-center gap-2 font-bold text-sm uppercase tracking-tight text-muted-foreground">
                <Users className="h-4 w-4 text-primary"/>
                Current Club: <span className="text-primary">{user.clubName || 'None / Unaffiliated'}</span>
            </Label>
            <div className="flex gap-2">
                <Select onValueChange={setSelectedClubId} value={selectedClubId || "NONE"}>
                    <SelectTrigger className="flex-grow bg-muted/20 border-none shadow-none"><SelectValue placeholder="Select club..." /></SelectTrigger>
                    <SelectContent>
                        <div className='p-2'><Input placeholder='Search Club...' className='w-full' onChange={(e) => setClubSearchTerm(e.target.value)} value={clubSearchTerm} /></div>
                        <SelectItem value="NONE">No Affiliation</SelectItem>
                        {filteredClubs.map(club => (<SelectItem key={club.id} value={club.id}>{club.name}</SelectItem>))}
                    </SelectContent>
                </Select>
                <Button onClick={handleClubChange} disabled={isLoading || selectedClubId === (user?.clubId || null)} className="shrink-0 h-10 font-bold">Update</Button>
            </div>
            <div className="text-center pt-2">
                <Dialog open={isClubModalOpen} onOpenChange={setIsClubModalOpen}>
                    <DialogTrigger asChild>
                        <button type="button" className="text-xs font-semibold text-muted-foreground hover:text-primary underline">Is your club not listed? Register it here.</button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md text-left">
                      <DialogHeader>
                        <DialogTitle>Register Your Club</DialogTitle>
                        <DialogDescription>Become an owner and manage your squad on Bergman.</DialogDescription>
                      </DialogHeader>
                      <RegisterClubFormForModal 
                        onSuccess={(newClub) => { 
                            toast({ title: "Club Registered" }); 
                            if (onUpdate) onUpdate({ ownedClubId: newClub.id, ownedClubName: newClub.name, clubId: newClub.id, clubName: newClub.name }); 
                            setIsClubModalOpen(false); 
                        }} 
                        onClose={() => setIsClubModalOpen(false)} 
                      />
                    </DialogContent>
                </Dialog>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
