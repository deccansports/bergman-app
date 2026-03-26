// src/components/admin/AthletesAndClubsTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import {
  Search as SearchIcon,
  AlertTriangle,
  Download,
  Loader2,
  Users2,
  LineChart,
  Building,
  Activity,
  ChevronDown,
  ChevronUp,
  Edit,
  UserCog,
  UserPlus,
  Trash2,
  PlusCircle,
  FileUp,
  CheckCircle2,
  XCircle,
  Flag as FlagIconLucide,
  MapPin,
  HeartPulse,
  Shirt,
  Save,
  ShieldAlert,
  History as HistoryIcon,
} from "lucide-react";
import ClubManagementTab from "./ClubManagementTab";

import {
  getAdminAthleteAnalyticsAction,
} from "@/lib/actions/analyticsActions";
import {
  searchAthletesForAdminAction,
  removeDuplicateUsersAction,
  exportAllUsersAction,
  updateRaceResultByAdminAction,
} from "@/lib/actions/adminActions";
import { createUserAction, updateUserProfile } from '@/lib/actions/userActions';
import { getRecentClubsAction, getAllClubs } from "@/lib/actions/clubActions";
import { useAuth } from "@/context/AuthContext";

import type { 
    User, 
    RaceResult, 
    AdminAthleteAnalytics, 
    Club, 
    UserProfileUpdateData, 
    CreateUserFormInput, 
    AdminParticipantEditFormInput, 
    AdminRaceResultEditFormInput 
} from "@/lib/types";
import {
  AdminParticipantEditSchema,
  CreateUserSchema,
  AdminRaceResultEditSchema,
} from "@/lib/schemas";
import { normalizeStatus, getOrdinal, getInitials, getCountryFlagEmoji, toDateStringSafe } from "@/lib/utils";
import { GENDERS, BLOOD_GROUPS, KID_TSHIRT_SIZES, ADULT_TSHIRT_SIZES, NO_CLUB_SELECTED_VALUE, INDIAN_STATES } from '@/lib/constants';
import { countriesByContinent } from '@/lib/countries';
import { COUNTRY_CODES } from '@/lib/constants/country-codes';

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormControl,
} from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
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
import { format, parseISO, differenceInYears } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from '@/hooks/use-mobile';

function CreateUserForm({ isSubmitting, onSubmit }: { isSubmitting: boolean; onSubmit: (data: CreateUserFormInput) => void; }) {
    const form = useForm<CreateUserFormInput>({ resolver: zodResolver(CreateUserSchema), defaultValues: { name: '', email: '', mobile: '' } });
    return (<Form {...form}><form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 text-left"><FormField name="name" control={form.control} render={({ field }) => ( <FormItem className="text-left"><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>)}/><FormField name="email" control={form.control} render={({ field }) => ( <FormItem className="text-left"><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl></FormItem>)}/><FormField name="mobile" control={form.control} render={({ field }) => ( <FormItem className="text-left"><FormLabel>Mobile</FormLabel><FormControl><Input type="tel" {...field} value={field.value || ''} /></FormControl></FormItem>)}/><DialogFooter className="text-left"><DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Creating...' : 'Create'}</Button></DialogFooter></form></Form>);
}

function AdminAthleteEditForm({ isSubmitting, onSubmit, editingUser, allClubs }: { isSubmitting: boolean; onSubmit: (data: AdminParticipantEditFormInput) => void; editingUser: User | null, allClubs: Club[] }) {
    const form = useForm<AdminParticipantEditFormInput>({ resolver: zodResolver(AdminParticipantEditSchema) });
    const [dialCode, setDialCode] = useState('+91');

    useEffect(() => {
        if (editingUser) {
            let mobileOnly = editingUser.mobile || '';
            if (mobileOnly.startsWith('+')) {
                const matched = COUNTRY_CODES.find(c => mobileOnly.startsWith(c.dial_code));
                if (matched) {
                    setDialCode(matched.dial_code);
                    mobileOnly = mobileOnly.replace(matched.dial_code, '');
                }
            }

            form.reset({
                name: editingUser.name || '',
                mobile: mobileOnly,
                personalRaceEmail: editingUser.personalRaceEmail || '',
                gender: editingUser.gender as "Male" | "Female" | "Other" | undefined,
                dob: toDateStringSafe(editingUser.dob) || '',
                bloodGroup: editingUser.bloodGroup || '',
                tshirtSize: editingUser.tshirtSize || '',
                emergencyContactNumber: editingUser.emergencyContactNumber || '',
                address: editingUser.address || '',
                city: editingUser.city || '',
                pincode: editingUser.pincode || '',
                country: editingUser.country || 'India',
                state: editingUser.state || '',
                clubId: editingUser.clubId || NO_CLUB_SELECTED_VALUE,
                clubAffiliationDate: toDateStringSafe(editingUser.clubAffiliationDate) || '',
            });
        }
    }, [editingUser, form]);

    const countryValueFromForm = form.watch("country");
    const dobValue = form.watch("dob");

    useEffect(() => {
        if (countryValueFromForm) {
            const country = COUNTRY_CODES.find(c => c.name.toLowerCase() === countryValueFromForm.toLowerCase());
            if (country) setDialCode(country.dial_code);
        }
    }, [countryValueFromForm]);

    const tshirtSizeOptions = useMemo(() => {
        if (dobValue) {
            try {
                const age = differenceInYears(new Date(), parseISO(dobValue));
                if (age < 16) return KID_TSHIRT_SIZES;
            } catch (e) { /* Fallback to adult sizes */ }
        }
        return ADULT_TSHIRT_SIZES;
    }, [dobValue]);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => onSubmit({ ...data, mobile: `${dialCode}${data.mobile?.replace(/\D/g, '')}` }))} className="flex flex-col h-full text-left">
                <ScrollArea className="flex-1 p-6">
                  <div className="space-y-6 text-left pb-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField name="name" control={form.control} render={({ field }) => (
                            <FormItem className="text-left">
                                <FormLabel>Full Name*</FormLabel>
                                <FormControl><Input {...field} value={field.value || ""} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <div className="space-y-1">
                            <FormLabel>Mobile (WhatsApp)</FormLabel>
                            <div className="flex gap-2">
                                <Select value={dialCode} onValueChange={setDialCode}>
                                    <SelectTrigger className="w-20 h-10 rounded-xl font-bold bg-muted/20 px-2">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {COUNTRY_CODES.map(c => <SelectItem key={c.code} value={c.dial_code}>{c.dial_code}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <FormField name="mobile" control={form.control} render={({ field }) => (
                                    <FormItem className="flex-grow">
                                        <FormControl><Input {...field} value={field.value || ""} /></FormControl>
                                    </FormItem>
                                )} />
                            </div>
                        </div>
                    </div>
                    <FormField control={form.control} name="personalRaceEmail" render={({ field }) => (
                        <FormItem className="text-left">
                            <FormLabel>Personal Race Email (for results sync)</FormLabel>
                            <FormControl><Input type="email" {...field} value={field.value || ""} placeholder="Default is login email"/></FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField name="gender" control={form.control} render={({ field }) => (<FormItem className="text-left"><FormLabel>Gender*</FormLabel><Select onValueChange={field.onChange} value={field.value || ''}><FormControl><SelectTrigger><SelectValue placeholder="Select..."/></SelectTrigger></FormControl><SelectContent>{GENDERS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select></FormItem>)} />
                        <FormField name="dob" control={form.control} render={({ field }) => (<FormItem className="text-left"><FormLabel>Date of Birth</FormLabel><FormControl><Input type="date" {...field} value={field.value || ''} /></FormControl></FormItem>)} />
                    </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField name="bloodGroup" control={form.control} render={({ field }) => (<FormItem className="text-left"><FormLabel>Blood Group</FormLabel><Select onValueChange={field.onChange} value={field.value || ''}><FormControl><SelectTrigger><SelectValue placeholder="Select..."/></SelectTrigger></FormControl><SelectContent>{BLOOD_GROUPS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select></FormItem>)} />
                        <FormField name="tshirtSize" control={form.control} render={({ field }) => (<FormItem className="text-left"><FormLabel>T-Shirt Size</FormLabel><Select onValueChange={field.onChange} value={field.value || ''}><FormControl><SelectTrigger><SelectValue placeholder="Select..."/></SelectTrigger></FormControl><SelectContent>{tshirtSizeOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></FormItem>)} />
                    </div>
                    
                    <Separator className="my-4"/>
                    <h4 className="text-xs font-black uppercase tracking-widest text-primary">Location & Club</h4>
                    
                    <FormField name="address" control={form.control} render={({ field }) => (<FormItem className="text-left"><FormLabel>Address</FormLabel><FormControl><Input {...field} value={field.value || ''} /></FormControl></FormItem>)} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField name="city" control={form.control} render={({ field }) => (<FormItem className="text-left"><FormLabel>City</FormLabel><FormControl><Input {...field} value={field.value || ''} /></FormControl></FormItem>)} />
                        <FormField name="pincode" control={form.control} render={({ field }) => ( <FormItem className="text-left"><FormLabel>Pincode</FormLabel><FormControl><Input {...field} value={field.value || ''} /></FormControl></FormItem>)} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField name="country" render={({ field }) => (<FormItem className="text-left"><FormLabel>Country</FormLabel><Select onValueChange={(value) => { field.onChange(value === "NONE" ? "" : value); if (value !== "India") { form.setValue("state", ""); } }} value={field.value || 'India'}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{Object.entries(countriesByContinent).map(([continent, countries]) => (<SelectGroup key={continent}><SelectLabel>{continent}</SelectLabel>{countries.map(country => (<SelectItem key={country.code} value={country.name}>{country.name}</SelectItem>))}</SelectGroup>))}</SelectContent></Select></FormItem>)}/>
                        {countryValueFromForm === 'India' && (
                            <FormField
                                control={form.control}
                                name="state"
                                render={({ field }) => (
                                    <FormItem className="text-left">
                                        <FormLabel>State (India)</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value || ''}>
                                            <FormControl><SelectTrigger><SelectValue placeholder="Select State..."/></SelectTrigger></FormControl>
                                            <SelectContent>
                                                {INDIAN_STATES.map(state => (
                                                    <SelectItem key={state.value} value={state.name}>{state.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage/>
                                    </FormItem>
                                )}
                            />
                        )}
                    </div>
                    
                    <Separator className="my-4"/>
                    
                    <FormField name="clubId" control={form.control} render={({ field }) => (<FormItem className="text-left"><FormLabel>Club Affiliation</FormLabel><Select onValueChange={(value) => field.onChange(value === NO_CLUB_SELECTED_VALUE ? null : value)} value={field.value || NO_CLUB_SELECTED_VALUE}><FormControl><SelectTrigger><SelectValue placeholder="Select..."/></SelectTrigger></FormControl><SelectContent><SelectItem value={NO_CLUB_SELECTED_VALUE}>None / Not Affiliated</SelectItem>{allClubs.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></FormItem>)}/>
                    <FormField control={form.control} name="clubAffiliationDate" render={({ field }) => (<FormItem className="text-left"><FormLabel>Club Affiliation Date</FormLabel><FormControl><Input type="date" {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>)} />
                  </div>
                </ScrollArea>
                <DialogFooter className="p-6 border-t flex-shrink-0 bg-muted/20">
                    <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                    <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <Save className="mr-2 h-4 w-4"/>}Save Athlete Profile</Button>
                </DialogFooter>
            </form>
        </Form>
    );
}

function AdminRaceResultEditForm({ isSubmitting, onSubmit, raceResult }: { isSubmitting: boolean; onSubmit: (data: AdminRaceResultEditFormInput) => void; raceResult: RaceResult | null }) {
    const form = useForm<AdminRaceResultEditFormInput>({ resolver: zodResolver(AdminRaceResultEditSchema) });

    useEffect(() => {
        if (raceResult) {
            form.reset({
                ...raceResult,
                raceDate: toDateStringSafe(raceResult.raceDate),
                eventCategory: (raceResult.eventCategory as 'TRIATHLON' | 'DUATHLON' | 'OTHER' | 'SWIMMING' | undefined | null) ?? null,
            } as any);
        }
    }, [raceResult, form]);
    
    const eventCategory = form.watch('eventCategory');

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col h-full text-left">
                <ScrollArea className="flex-1 p-6">
                  <div className="space-y-6 text-left pb-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField name="name" render={({field}) => (<FormItem className="text-left"><FormLabel>Name*</FormLabel><FormControl><Input {...field} value={field.value || ''}/></FormControl></FormItem>)} />
                        <FormField name="bibNumber" render={({field}) => (<FormItem className="text-left"><FormLabel>BIB*</FormLabel><FormControl><Input {...field} value={field.value || ''}/></FormControl></FormItem>)} />
                    </div>
                     <FormField name="status" render={({field}) => (<FormItem className="text-left"><FormLabel>Race Status*</FormLabel><FormControl><Input {...field} value={field.value || ''}/></FormControl></FormItem>)} />
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField name="raceCategory" render={({field}) => (<FormItem className="text-left"><FormLabel>Race Category*</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="e.g., Bergman 113 Triathlon"/></FormControl><FormMessage/></FormItem>)} />
                        <FormField name="eventCategory" render={({field}) => (
                           <FormItem className="text-left">
                             <FormLabel>Event Discipline</FormLabel>
                             <Select onValueChange={(value) => field.onChange(value === 'NONE' ? null : value as any)} value={field.value || 'NONE'}>
                               <FormControl><SelectTrigger><SelectValue placeholder="Select discipline..."/></SelectTrigger></FormControl>
                               <SelectContent className="text-left">
                                 <SelectItem value="TRIATHLON">Triathlon</SelectItem>
                                 <SelectItem value="DUATHLON">Duathlon</SelectItem>
                                 <SelectItem value="SWIMMING">Swimathon</SelectItem>
                                 <SelectItem value="OTHER">Other</SelectItem>
                                 <SelectItem value="NONE">None</SelectItem>
                               </SelectContent>
                             </Select>
                             <FormMessage />
                           </FormItem>
                         )} />
                     </div>

                     <div className="grid grid-cols-3 gap-4">
                        <FormField name="oRank" render={({field}) => (<FormItem className="text-left"><FormLabel>Overall Rank</FormLabel><FormControl><Input {...field} value={field.value || ''}/></FormControl></FormItem>)} />
                        <FormField name="gRank" render={({field}) => (<FormItem className="text-left"><FormLabel>Gender Rank</FormLabel><FormControl><Input {...field} value={field.value || ''}/></FormControl></FormItem>)} />
                        <FormField name="cRank" render={({field}) => (<FormItem className="text-left"><FormLabel>Category Rank</FormLabel><FormControl><Input {...field} value={field.value || ''}/></FormControl></FormItem>)} />
                     </div>
                     
                     <Separator className="my-4"/>
                     <h4 className="text-xs font-black uppercase tracking-widest text-primary">Splits (HH:MM:SS)</h4>

                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <FormField name="chipTime" render={({field}) => (<FormItem className="text-left"><FormLabel>Finish Time*</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="HH:MM:SS"/></FormControl></FormItem>)} />
                        
                        {(eventCategory === 'TRIATHLON' || eventCategory === 'SWIMMING') && (
                            <FormField name="swim" render={({field}) => (<FormItem className="text-left"><FormLabel>Swim</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="HH:MM:SS"/></FormControl></FormItem>)} />
                        )}
                        {eventCategory === 'DUATHLON' && (
                            <FormField name="run1" render={({field}) => (<FormItem className="text-left"><FormLabel>Run 1</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="HH:MM:SS"/></FormControl></FormItem>)} />
                        )}

                        <FormField name="t1" render={({field}) => (<FormItem className="text-left"><FormLabel>T1</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="HH:MM:SS"/></FormControl></FormItem>)} />
                        <FormField name="bike" render={({field}) => (<FormItem className="text-left"><FormLabel>Bike</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="HH:MM:SS"/></FormControl></FormItem>)} />
                        <FormField name="t2" render={({field}) => (<FormItem className="text-left"><FormLabel>T2</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="HH:MM:SS"/></FormControl></FormItem>)} />
                        
                        {(eventCategory === 'TRIATHLON' || eventCategory === 'OTHER') && (
                            <FormField name="run" render={({field}) => (<FormItem className="text-left"><FormLabel>Run</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="HH:MM:SS"/></FormControl></FormItem>)} />
                        )}
                        {eventCategory === 'DUATHLON' && (
                            <FormField name="run2" render={({field}) => (<FormItem className="text-left"><FormLabel>Run 2</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="HH:MM:SS"/></FormControl></FormItem>)} />
                        )}
                     </div>
                  </div>
                </ScrollArea>
                 <DialogFooter className="p-6 border-t flex-shrink-0 bg-muted/20">
                    <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                    <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <Save className="mr-2 h-4 w-4"/>}Save Race Result</Button>
                </DialogFooter>
            </form>
        </Form>
    );
}

const AnalyticsOverview = () => {
    const [analytics, setAnalytics] = useState<AdminAthleteAnalytics | null>(null);
    const [recentSignups, setRecentSignups] = useState<any[]>([]);
    const [recentClubs, setRecentClubs] = useState<Club[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            const [analyticsRes, clubsRes] = await Promise.all([
                getAdminAthleteAnalyticsAction(),
                getRecentClubsAction(5)
            ]);
            if (analyticsRes.success) {
                setAnalytics(analyticsRes.analytics || null);
                setRecentSignups(analyticsRes.recentSignups || []);
            }
            if (clubsRes.success) {
                setRecentClubs(clubsRes.recentClubs || []);
            }
            setIsLoading(false);
        };
        fetchData();
    }, []);

    if (isLoading) {
        return <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><Skeleton className="h-64"/><Skeleton className="h-64"/></div>;
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-left">
            <Card className="border-none shadow-lg">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><LineChart className="h-5 w-5"/>Platform Engagement</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-center">
                   <Card className="p-3 bg-muted/20 border-none shadow-sm"><p className="text-2xl font-black">{analytics?.totalAthletes ?? 0}</p><p className="text-[10px] font-bold uppercase text-muted-foreground">Total Athletes</p></Card>
                   <Card className="p-3 bg-muted/20 border-none shadow-sm"><p className="text-2xl font-black">{analytics?.totalClubsWithAthletes ?? 0}</p><p className="text-[10px] font-bold uppercase text-muted-foreground">Active Clubs</p></Card>
                   <Card className="p-3 bg-primary/5 border-none shadow-sm"><p className="text-2xl font-black text-primary">{analytics?.signupsToday ?? 0}</p><p className="text-[10px] font-bold uppercase text-muted-foreground">Signups Today</p></Card>
                   <Card className="p-3 bg-primary/5 border-none shadow-sm"><p className="text-2xl font-black text-primary">{analytics?.signupsThisWeek ?? 0}</p><p className="text-[10px] font-bold uppercase text-muted-foreground">New This Week</p></Card>
                </CardContent>
            </Card>
            <div className="space-y-4 text-left">
                <Card className="border-none shadow-lg overflow-hidden">
                    <CardHeader className="pb-2 bg-muted/30"><CardTitle className="text-sm font-black uppercase tracking-widest">Newest Members</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <Table><TableBody>{recentSignups.map(s=>(<TableRow key={s.uid} className="text-xs hover:bg-muted/50"><TableCell className="font-bold uppercase">{s.name}</TableCell><TableCell className="text-muted-foreground lowercase">{s.email}</TableCell><TableCell className="text-right text-muted-foreground font-mono">{s.createdAt?format(parseISO(s.createdAt),'dd MMM'):'—'}</TableCell></TableRow>))}</TableBody></Table>
                    </CardContent>
                </Card>
                 <Card className="border-none shadow-lg overflow-hidden">
                    <CardHeader className="pb-2 bg-muted/30"><CardTitle className="text-sm font-black uppercase tracking-widest">Recent Club Registrations</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <Table><TableBody>{recentClubs.map(c=>(<TableRow key={c.id} className="text-xs hover:bg-muted/50"><TableCell className="font-bold uppercase">{c.name}</TableCell><TableCell className="text-muted-foreground italic">Coach {c.coach_name}</TableCell><TableCell className="text-right text-muted-foreground font-mono">{c.createdAt?format(parseISO(c.createdAt),'dd MMM'):'—'}</TableCell></TableRow>))}</TableBody></Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};


function ManageAthletesTab({ onRefresh }: { onRefresh: () => void }) {
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [searchBy, setSearchBy] = useState<'name' | 'email' | 'mobile' | 'bibNumber'>('name');
    const [isSearching, setIsSearching] = useState(false);
    const [isCleaning, setIsCleaning] = useState(false);
    const [searchResults, setSearchResults] = useState<Array<User & { races?: RaceResult[]; upcomingEvents?: any[] }>>([]);
    const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [allClubs, setAllClubs] = useState<Club[]>([]);
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
    const [editingRaceResult, setEditingRaceResult] = useState<RaceResult | null>(null);


    useEffect(() => {
        getAllClubs().then(result => {
            if(result.success && result.clubs) {
                setAllClubs(result.clubs);
            }
        })
    }, []);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchTerm) return;
        setIsSearching(true);
        setExpandedUserId(null); 
        const result = await searchAthletesForAdminAction(searchTerm, searchBy);
        if (result.success && result.athletes) {
            setSearchResults(result.athletes);
        } else {
            toast({ variant: 'destructive', title: 'Search Failed', description: result.message });
        }
        setIsSearching(false);
    };

    const handleCreateUser = async (data: CreateUserFormInput) => {
        setIsSubmitting(true);
        const result = await createUserAction({
            name: data.name,
            email: data.email,
            mobile: data.mobile || null
        });
        if (result.success) {
            toast({ title: 'Success', description: 'User created successfully.' });
            setIsCreateUserModalOpen(false);
            onRefresh();
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
        setIsSubmitting(false);
    };

    const handleUpdateUser = async (data: AdminParticipantEditFormInput) => {
        if (!editingUser) return;
        setIsSubmitting(true);
        
        const result = await updateUserProfile(editingUser.uid, data as UserProfileUpdateData);

        if (result.success) {
            toast({ title: 'Success', description: 'Athlete updated.' });
            setEditingUser(null);
            onRefresh();
            if(searchTerm) {
                const searchResult = await searchAthletesForAdminAction(searchTerm, searchBy);
                if (searchResult.success && searchResult.athletes) {
                    setSearchResults(searchResult.athletes);
                }
            }
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
        setIsSubmitting(false);
    };
    
    const handleUpdateRaceResult = async (data: AdminRaceResultEditFormInput) => {
        if (!editingRaceResult || !editingRaceResult.docId) return;
        setIsSubmitting(true);
        const result = await updateRaceResultByAdminAction(editingRaceResult.docId, data);
        if (result.success) {
            toast({ title: "Success", description: "Race result updated." });
            setEditingRaceResult(null);
            onRefresh();
            if(searchTerm) {
                const searchResult = await searchAthletesForAdminAction(searchTerm, searchBy);
                if (searchResult.success && searchResult.athletes) {
                    setSearchResults(searchResult.athletes);
                }
            }
        } else {
            toast({ variant: 'destructive', title: "Error", description: result.message });
        }
        setIsSubmitting(false);
    };

    const handleExport = async () => {
        setIsSearching(true); 
        const result = await exportAllUsersAction();
        if (result.success && result.fileContent) {
            const link = document.createElement("a");
            link.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + result.fileContent;
            link.download = "all_bergman_users.xlsx";
            link.click();
        } else {
            toast({ variant: 'destructive', title: 'Export Failed', description: result.message });
        }
        setIsSearching(false);
    };

    const handleCleanDuplicates = async () => {
        setIsCleaning(true);
        try {
            const res = await removeDuplicateUsersAction();
            if (res.success) {
                toast({ title: 'Cleanup Complete', description: res.message });
                onRefresh();
            } else {
                toast({ variant: 'destructive', title: 'Cleanup Failed', description: res.message });
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsCleaning(false);
        }
    };

    return (
        <div className="space-y-4 text-left">
            <div className="flex flex-wrap gap-2 text-left">
                <Dialog open={isCreateUserModalOpen} onOpenChange={setIsCreateUserModalOpen}>
                    <DialogTrigger asChild><Button size="sm" className="rounded-xl font-bold uppercase text-xs tracking-widest"><UserPlus className="mr-2 h-4 w-4"/>Create User</Button></DialogTrigger>
                    <DialogContent className="text-left">
                        <DialogHeader className="text-left">
                          <DialogTitle className="text-left">Create New User Profile</DialogTitle>
                          <DialogDescription className="text-left">Create a new user account in the system manually.</DialogDescription>
                        </DialogHeader>
                        <CreateUserForm isSubmitting={isSubmitting} onSubmit={handleCreateUser} />
                    </DialogContent>
                </Dialog>
                 <Button size="sm" variant="outline" onClick={handleExport} disabled={isSearching} className="rounded-xl font-bold uppercase text-xs tracking-widest"><Download className="mr-2 h-4 w-4"/>Export All Users</Button>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" disabled={isSearching || isCleaning} className="rounded-xl font-bold uppercase text-xs tracking-widest">
                            {isCleaning ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4"/>}
                            Clean Duplicates
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="text-left rounded-2xl border-none shadow-2xl">
                        <AlertDialogHeader className="text-left">
                            <AlertDialogTitle className="text-xl font-black uppercase italic tracking-tighter text-left">Confirm Duplicate Cleanup</AlertDialogTitle>
                            <AlertDialogDescription className="text-sm font-medium text-left leading-relaxed">
                                This will scan the entire athlete directory for accounts sharing the same email address. 
                                It will keep the <strong>most recently updated</strong> profile and merge missing data from duplicates before deleting them. 
                                This operation is irreversible.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="text-left pt-4">
                            <AlertDialogCancel className="rounded-xl font-bold uppercase text-xs">Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleCleanDuplicates} className="bg-destructive hover:bg-destructive/90 rounded-xl font-black uppercase tracking-widest text-xs h-11 px-8">
                                Proceed with Cleanup
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
             <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 text-left">
                <Input placeholder="Enter name, email, or mobile..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} disabled={isSearching} className="rounded-xl h-11 border-muted font-bold"/>
                <Select value={searchBy} onValueChange={v => setSearchBy(v as any)}><SelectTrigger className="w-full sm:w-[150px] h-11 rounded-xl font-bold"><SelectValue /></SelectTrigger><SelectContent className="text-left"><SelectItem value="name">Name</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="mobile">Mobile</SelectItem><SelectItem value="bibNumber">BIB Number</SelectItem></SelectContent></Select>
                <Button type="submit" disabled={isSearching || !searchTerm} className="h-11 px-6 rounded-xl font-black shadow-xl shadow-primary/20">{isSearching ? <Loader2 className="animate-spin h-4 w-4" /> : <SearchIcon className="h-4 w-4" />}</Button>
            </form>
            <div className="rounded-2xl border overflow-hidden shadow-xl bg-card text-left">
              <Table>
                <TableHeader className="bg-muted/30">
                    <TableRow className="h-10 text-[10px] font-black uppercase tracking-widest border-b">
                        <TableHead className="pl-6 text-left">Athlete</TableHead>
                        <TableHead className="text-left">Contact</TableHead>
                        <TableHead className="text-left">Verified</TableHead>
                        <TableHead className="text-left">Affiliation</TableHead>
                        <TableHead className="text-left">Signed Up</TableHead>
                        <TableHead className="text-right pr-6">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                  {isSearching ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
                      </TableCell>
                    </TableRow>
                  ) : searchResults.length > 0 ? (
                    searchResults.map(user => {
                      const age = user.dob ? differenceInYears(new Date(), parseISO(user.dob)) : null;
                      return (
                        <React.Fragment key={user.uid}>
                            <TableRow onClick={() => setExpandedUserId(expandedUserId === user.uid ? null : user.uid)} className="h-16 cursor-pointer hover:bg-muted/10 transition-colors text-left border-border/50">
                                <TableCell className="pl-6 text-left">
                                    <div className="flex items-center gap-3 text-left">
                                        <Avatar className="h-10 w-10 border shadow-sm">
                                            <AvatarImage src={user.photoURL || undefined} alt={user.name || ''}/>
                                            <AvatarFallback className="bg-muted text-muted-foreground">{getInitials(user.name)}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex items-center text-left">
                                            <span className="font-black uppercase text-sm tracking-tight mr-1.5 text-left">{getCountryFlagEmoji(user.country)} {user.name}</span>
                                            {expandedUserId === user.uid ? <ChevronUp className="h-4 w-4 text-primary" /> : <ChevronDown className="h-4 w-4 text-slate-300" />}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="text-left">
                                    <div className="text-xs font-semibold lowercase leading-tight text-left">{user.email}</div>
                                    <div className="text-[10px] font-bold text-muted-foreground mt-0.5 text-left">{user.mobile || '—'}</div>
                                </TableCell>
                                <TableCell className="text-left">{user.emailVerified ? <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200 uppercase font-black text-[9px]">Yes</Badge> : <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 uppercase font-black text-[9px]">No</Badge>}</TableCell>
                                <TableCell className="text-left">
                                    <div className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1.5 text-left">
                                        <Building className="h-3 w-3 opacity-50"/> {user.clubName || 'Independent'}
                                    </div>
                                </TableCell>
                                <TableCell className="text-left">
                                    <p className="text-[10px] font-bold uppercase text-slate-400 font-mono text-left">{user.createdAt ? format(parseISO(user.createdAt), 'dd MMM yyyy') : '—'}</p>
                                </TableCell>
                                <TableCell className="text-right pr-6">
                                    <Button size="xs" variant="outline" className="rounded-lg h-8 px-4 font-black uppercase text-[10px] tracking-widest text-primary border-primary/20 hover:bg-primary/5" onClick={(e) => {e.stopPropagation(); setEditingUser(user);}}>Manage</Button>
                                </TableCell>
                            </TableRow>
                            {expandedUserId === user.uid && (
                                <TableRow className="bg-muted/10">
                                    <TableCell colSpan={6} className="p-0 border-none">
                                        <div className="p-6 space-y-6 text-left animate-in slide-in-from-top-2 duration-500">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                                                <div className="space-y-3 text-left">
                                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2 text-left"><ShieldAlert className="h-3.5 w-3.5"/> Extended Profile</h4>
                                                    <div className="grid grid-cols-2 gap-4 text-[10px] font-bold uppercase text-muted-foreground text-left">
                                                        <div className="text-left"><span className="block opacity-50 mb-0.5">Gender</span><span className="text-foreground">{user.gender || '—'}</span></div>
                                                        <div className="text-left"><span className="block opacity-50 mb-0.5">Calculated Age</span><span className="text-foreground">{age || '—'}</span></div>
                                                        <div className="text-left"><span className="block opacity-50 mb-0.5">Blood Group</span><span className="text-foreground">{user.bloodGroup || '—'}</span></div>
                                                        <div className="text-left"><span className="block opacity-50 mb-0.5">T-Shirt Size</span><span className="text-foreground">{user.tshirtSize || '—'}</span></div>
                                                    </div>
                                                </div>
                                                <div className="space-y-3 text-left">
                                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2 text-left"><MapPin className="h-3.5 w-3.5"/> Site Localization</h4>
                                                    <div className="text-xs font-bold uppercase text-foreground text-left">
                                                        {user.city || '—'}, {user.state || '—'}
                                                        <p className="text-[9px] text-muted-foreground font-black mt-1 leading-none">{user.country || 'Global'}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            <Separator className="opacity-50"/>

                                            <div className="space-y-4 text-left">
                                                <div className="flex justify-between items-center text-left">
                                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2 text-left"><HistoryIcon className="h-3.5 w-3.5"/> Upcoming Events</h4>
                                                    <Badge variant="outline" className="font-black text-[9px] uppercase">{user.upcomingEvents?.length || 0} Registered</Badge>
                                                </div>
                                                {user.upcomingEvents && user.upcomingEvents.length > 0 ? (
                                                    <div className="rounded-xl border bg-background overflow-hidden text-left shadow-sm">
                                                        <Table>
                                                            <TableHeader className="bg-muted/50"><TableRow className="h-8 text-[9px] font-black uppercase border-b"><TableHead className="pl-4">Event Name</TableHead><TableHead>Booking ID</TableHead><TableHead>Ticket Status</TableHead><TableHead className="text-right pr-4">Registration Date</TableHead></TableRow></TableHeader>
                                                            <TableBody>
                                                                {user.upcomingEvents.map((e, idx) => (
                                                                    <TableRow key={idx} className="h-10 text-[10px] font-medium hover:bg-muted/20 border-border/50 text-left">
                                                                        <TableCell className="pl-4 font-bold uppercase text-primary">{e.eventName}</TableCell>
                                                                        <TableCell className="font-mono text-muted-foreground">{e.bookingId || '—'}</TableCell>
                                                                        <TableCell><Badge variant="outline" className="text-[9px] font-bold">Active</Badge></TableCell>
                                                                        <TableCell className="text-right pr-4 text-muted-foreground">{e.registeredDate ? format(parseISO(e.registeredDate), 'dd MMM yyyy') : '—'}</TableCell>
                                                                    </TableRow>
                                                                ))}
                                                            </TableBody>
                                                        </Table>
                                                    </div>
                                                ) : <div className="text-center py-6 bg-muted/20 rounded-xl text-[10px] uppercase font-bold text-muted-foreground italic">No upcoming registrations.</div>}
                                            </div>

                                            <Separator className="opacity-50"/>

                                            <div className="space-y-4 text-left">
                                                <div className="flex justify-between items-center text-left">
                                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2 text-left"><HistoryIcon className="h-3.5 w-3.5"/> Verified Race Participation</h4>
                                                    <Badge variant="outline" className="font-black text-[9px] uppercase">{user.races?.length || 0} Finished</Badge>
                                                </div>
                                                {user.races && user.races.length > 0 ? (
                                                    <div className="rounded-xl border bg-background overflow-hidden text-left shadow-sm">
                                                        <Table>
                                                            <TableHeader className="bg-muted/50"><TableRow className="h-8 text-[9px] font-black uppercase border-b"><TableHead className="pl-4">Event Date</TableHead><TableHead>Discipline</TableHead><TableHead>BIB</TableHead><TableHead>Rank</TableHead><TableHead className="text-right pr-4">Points</TableHead></TableRow></TableHeader>
                                                            <TableBody>
                                                                {user.races.map(r => (
                                                                    <TableRow key={r.docId} className="h-10 text-[10px] font-medium hover:bg-muted/20 border-border/50 text-left">
                                                                        <TableCell className="pl-4 font-mono text-muted-foreground">{r.raceDate}</TableCell>
                                                                        <TableCell className="font-bold uppercase text-primary">{r.raceCategory || r.eventName}</TableCell>
                                                                        <TableCell className="font-mono">{r.bibNumber}</TableCell>
                                                                        <TableCell className="font-bold">{r.oRank}{getOrdinal(Number(r.oRank))}</TableCell>
                                                                        <TableCell className="text-right pr-4 font-black italic text-sm">{r.pointsAwarded || 0}</TableCell>
                                                                    </TableRow>
                                                                ))}
                                                            </TableBody>
                                                        </Table>
                                                    </div>
                                                ) : <div className="text-center py-6 bg-muted/20 rounded-xl text-[10px] uppercase font-bold text-muted-foreground italic">No race history on record.</div>}
                                            </div>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                        </React.Fragment>
                      )
                    })
                  ) : (
                     <TableRow>
                        <TableCell colSpan={6} className="h-32 text-center text-muted-foreground italic text-sm">
                            Query the database to view athlete records.
                        </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            
             <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
                <DialogContent className="max-w-2xl h-[90vh] flex flex-col p-0 overflow-hidden text-left rounded-3xl border-none shadow-2xl">
                    <DialogHeader className="p-6 border-b bg-primary/5 flex-shrink-0 text-left">
                        <DialogTitle className="text-xl font-black uppercase italic tracking-tighter text-left">Edit Athlete Portfolio</DialogTitle>
                        <DialogDescription className="text-left text-xs font-medium">Update master profile parameters for <strong>{editingUser?.name}</strong>.</DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 min-h-0">
                        <AdminAthleteEditForm isSubmitting={isSubmitting} onSubmit={handleUpdateUser} editingUser={editingUser} allClubs={allClubs} />
                    </div>
                </DialogContent>
            </Dialog>

             <Dialog open={!!editingRaceResult} onOpenChange={(open) => !open && setEditingRaceResult(null)}>
                <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0 overflow-hidden text-left rounded-3xl border-none shadow-2xl">
                    <DialogHeader className="p-6 border-b bg-orange-50 flex-shrink-0 text-left">
                        <DialogTitle className="text-xl font-black uppercase italic tracking-tighter text-orange-600 text-left">Override Race Result</DialogTitle>
                        <DialogDescription className="text-left text-xs font-medium">Correct timing, status, or rank for <strong>{editingRaceResult?.eventName}</strong>.</DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 min-h-0">
                        <AdminRaceResultEditForm isSubmitting={isSubmitting} onSubmit={handleUpdateRaceResult} raceResult={editingRaceResult} />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function AthletesAndClubsTab() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const isMobile = useIsMobile();

  const onRefresh = useCallback(() => {
    toast({ title: 'Directory Synchronized' });
  }, [toast]);
  
  const navItems = [
    { id: 'overview', label: 'Dashboard', icon: LineChart },
    { id: 'athletes', label: 'Directory', icon: Users2 },
    { id: 'clubs', label: 'Clubs', icon: Building }
  ];

  const renderNav = () => {
    if (isMobile) {
      return (
        <Select value={activeTab} onValueChange={setActiveTab}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Navigate..." />
          </SelectTrigger>
          <SelectContent>
            {navItems.map(item => (
              <SelectItem key={item.id} value={item.id}>
                <div className="flex items-center gap-2">
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
        <TabsList className="grid w-full grid-cols-3 bg-muted/50 p-1 rounded-xl h-11 border">
            {navItems.map(item => (
                 <TabsTrigger key={item.id} value={item.id} className="rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest h-9"><item.icon className="h-4 w-4"/>{item.label}</TabsTrigger>
            ))}
        </TabsList>
    );
  };

  return (
    <Card className="border-none shadow-xl text-left">
      <CardHeader className="bg-primary/5 border-b pb-6 text-left">
        <CardTitle className="flex items-center gap-2 text-2xl font-black uppercase italic tracking-tighter text-left">
          <Users2 className="h-6 w-6 text-primary" />
          Athlete Governance
        </CardTitle>
        <CardDescription className="text-left font-medium">Manage the global database of athletes, their results, and club affiliations.</CardDescription>
      </CardHeader>
      <CardContent className="pt-8 text-left">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full text-left">
            {renderNav()}
            <TabsContent value="overview" className="mt-8 animate-in fade-in slide-in-from-left-4 duration-500 text-left">
                <AnalyticsOverview />
            </TabsContent>
            <TabsContent value="athletes" className="mt-8 animate-in fade-in slide-in-from-left-4 duration-500 text-left">
                <ManageAthletesTab onRefresh={onRefresh} />
            </TabsContent>
            <TabsContent value="clubs" className="mt-8 animate-in fade-in slide-in-from-left-4 duration-500 text-left">
                <ClubManagementTab />
            </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
