// src/app/club-dashboard/page.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { 
    LayoutDashboard, Users, Trophy, Award, BarChart3, Settings, 
    TrendingUp, Calendar, Building, Search, 
    RefreshCw, Camera, Save, Smartphone, 
    CalendarSearch, MapPin, Target, Crown, ShieldAlert, Loader2, CheckCircle2, AlertTriangle, Trash2, Flag as FlagIconLucide,
    Send, Instagram, Facebook, Globe
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
    getClubDashboardDataAction, 
    removeAthleteFromClubAction,
    updateClubDetailsAction,
    updateClubSocialLinks,
    updateClubLogoUrl,
    getClubRegistrationsAction,
    syncClubUpcomingIndexAction,
    sendEncouragementEmailAction
} from '@/lib/actions/clubActions';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import type { ClubDashboardData, Club, EventCalendarEntry, ClubDashboardUpcomingRegistration } from '@/lib/types';
import { format, parseISO, isBefore, startOfDay } from 'date-fns';
import { getOrdinal, getInitials, getCountryFlagEmoji, cn, isValidImageUrl } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ClubUpdateSchema, ClubSocialLinksUpdateSchema } from '@/lib/schemas';
import { storage as firebaseClientStorage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
    ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip
} from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';
import EventDisplayCard from '@/components/events/EventDisplayCard';
import { Skeleton } from '@/components/ui/skeleton';

export const dynamic = "force-dynamic";

function StatCard({ title, value, subValue, icon: Icon, colorClass }: { title: string, value: any, subValue?: string, icon: React.ElementType, colorClass: string }) {
    const displayValue = value !== undefined && value !== null ? (typeof value === 'number' ? value.toLocaleString() : value) : '—';
    return (
        <Card className="overflow-hidden border-none shadow-lg text-left">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-muted/30 text-left">
                <CardTitle className="text-sm font-medium text-muted-foreground text-left">{title}</CardTitle>
                <Icon className={cn("h-4 w-4", colorClass)} />
            </CardHeader>
            <CardContent className="pt-4 pb-6 bg-background text-left">
                <div className="text-3xl font-bold">{displayValue}</div>
                {subValue && <p className="text-xs text-muted-foreground mt-1">{subValue}</p>}
            </CardContent>
        </Card>
    );
}

export default function ClubDashboardPage() {
    const router = useRouter();
    const { currentUser, firebaseUserFromAuth, fetchUserProfile } = useAuth();
    const { toast } = useToast();
    const [data, setData] = useState<ClubDashboardData | null>(null);
    const [upcomingEvents, setUpcomingEvents] = useState<EventCalendarEntry[]>([]);
    const [upcomingSlates, setUpcomingSlates] = useState<ClubDashboardUpcomingRegistration[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingEvents, setIsLoadingEvents] = useState(true);
    const [isLoadingSlates, setIsLoadingSlates] = useState(false);
    const [isSyncingSlates, setIsSyncingSlates] = useState(false);
    const [isSendingEncouragement, setIsSendingEncouragement] = useState(false);
    const [activeTab, setActiveTab] = useState('overview');
    const [year, setYear] = useState(new Date().getFullYear());
    const [memberSearch, setMemberSearch] = useState('');
    const [isUpdatingLogo, setIsUpdatingLogo] = useState(false);
    const [isSavingDetails, setIsSavingDetails] = useState(false);
    const [isSavingSocials, setIsSavingSocials] = useState(false);
    const [isRemovingAthlete, setIsRemovingAthlete] = useState<string | null>(null);
    const [athleteToRemoveUid, setAthleteToRemoveUid] = useState<string | null>(null);
    const [removalReason, setRemovalReason] = useState('');
    const logoInputRef = useRef<HTMLInputElement>(null);

    const detailsForm = useForm<z.infer<typeof ClubUpdateSchema>>({
        resolver: zodResolver(ClubUpdateSchema),
        defaultValues: { name: '', coach_name: '', email: '', mobile: '', country: '', city: '', state: '' }
    });

    const socialsForm = useForm<z.infer<typeof ClubSocialLinksUpdateSchema>>({
        resolver: zodResolver(ClubSocialLinksUpdateSchema),
        defaultValues: { instagramUrl: '', facebookUrl: '', country: '', city: '', state: '', clubId: '', ownerUid: '' }
    });

    const fetchDashboardData = useCallback(async () => {
        const clubId = currentUser?.ownedClubId;
        if (!clubId) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        const result = await getClubDashboardDataAction(clubId, year);
        if (result.success && result.dashboard) {
            setData(result.dashboard);
            const club = result.dashboard.club;
            detailsForm.reset({
                name: club.name || '',
                coach_name: club.coach_name || '',
                email: club.email || '',
                mobile: club.mobile || '',
                country: club.country || '',
                city: club.city || '',
                state: club.state || ''
            });
            socialsForm.reset({
                instagramUrl: club.instagramUrl || '',
                facebookUrl: club.facebookUrl || '',
                country: club.country || '',
                city: club.city || '',
                state: club.state || '',
                clubId: club.id,
                ownerUid: currentUser?.uid || ''
            });
        }
        setIsLoading(false);
    }, [currentUser?.ownedClubId, currentUser?.uid, year, detailsForm, socialsForm]);

    const fetchUpcomingEvents = useCallback(async () => {
        setIsLoadingEvents(true);
        const result = await getCalendarEventsAction();
        if (result.success && result.events) {
            const today = startOfDay(new Date());
            const filtered = result.events.filter(e => {
                if (e.isHidden) return false;
                if (!e.eventDate) return true;
                return !isBefore(parseISO(e.eventDate), today);
            }).slice(0, 6);
            setUpcomingEvents(filtered);
        }
        setIsLoadingEvents(false);
    }, []);

    const fetchUpcomingSlates = useCallback(async () => {
        const clubId = currentUser?.ownedClubId;
        if (!clubId) return;
        setIsLoadingSlates(true);
        try {
            const result = await getClubRegistrationsAction(clubId);
            if (result.success && result.registrations) {
                setUpcomingSlates(result.registrations);
            }
        } catch (e) {
            console.error("Failed to fetch slates:", e);
        } finally {
            setIsLoadingSlates(false);
        }
    }, [currentUser?.ownedClubId]);

    const handleSyncSlates = async () => {
        const clubId = currentUser?.ownedClubId;
        if (!clubId) return;
        setIsSyncingSlates(true);
        try {
            const result = await syncClubUpcomingIndexAction(clubId);
            if (result.success) {
                toast({ title: "Sync Complete", description: result.message });
                fetchUpcomingSlates();
            } else {
                toast({ variant: 'destructive', title: "Sync Failed", description: result.message });
            }
        } finally {
            setIsSyncingSlates(false);
        }
    };

    const handleEncourageRegistration = async () => {
        const clubId = currentUser?.ownedClubId;
        if (!clubId) return;
        setIsSendingEncouragement(true);
        try {
            const result = await sendEncouragementEmailAction(clubId);
            if (result.success) {
                toast({ title: "Emails Sent", description: result.message });
                fetchDashboardData();
            } else {
                toast({ variant: 'destructive', title: "Failed to Send", description: result.message });
            }
        } catch (e: any) {
            toast({ variant: 'destructive', title: "Error", description: e.message || "An unexpected error occurred." });
        } finally {
            setIsSendingEncouragement(false);
        }
    };

    useEffect(() => {
        fetchDashboardData();
        fetchUpcomingEvents();
        fetchUpcomingSlates();
    }, [fetchDashboardData, fetchUpcomingEvents, fetchUpcomingSlates]);

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !data?.club.id) return;

        if (file.size > 1024 * 1024) {
            toast({ variant: "destructive", title: "File Too Large", description: "Logo must be 1MB or less." });
            return;
        }

        setIsUpdatingLogo(true);
        try {
            const filePath = `club-logos/${data.club.id}/logo-${Date.now()}.${file.name.split('.').pop()}`;
            const fileRef = ref(firebaseClientStorage, filePath);
            await uploadBytes(fileRef, file);
            const downloadURL = await getDownloadURL(fileRef);
            
            const result = await updateClubLogoUrl(data.club.id, downloadURL);
            if (result.success) {
                toast({ title: "Success", description: "Club logo updated." });
                setData(prev => prev ? { ...prev, club: { ...prev.club, logoUrl: downloadURL } } : null);
                if (fetchUserProfile && firebaseUserFromAuth) await fetchUserProfile(firebaseUserFromAuth);
            }
        } catch (error: any) {
            toast({ variant: "destructive", title: "Upload Failed", description: error.message });
        } finally {
            setIsUpdatingLogo(false);
            if (logoInputRef.current) logoInputRef.current.value = '';
        }
    };

    const onDetailsSubmit = async (values: z.infer<typeof ClubUpdateSchema>) => {
        if (!data?.club.id) return;
        setIsSavingDetails(true);
        const result = await updateClubDetailsAction(data.club.id, values);
        if (result.success) {
            toast({ title: "Success", description: "Club details updated." });
            fetchDashboardData();
        }
        setIsSavingDetails(false);
    };

    const onSocialsSubmit = async (values: z.infer<typeof ClubSocialLinksUpdateSchema>) => {
        if (!data?.club.id || !currentUser?.uid) return;
        setIsSavingSocials(true);
        const result = await updateClubSocialLinks({
            ...values,
            clubId: data.club.id,
            ownerUid: currentUser.uid,
        });
        if (result.success) {
            toast({ title: "Success", description: "Social & Locale links updated." });
            fetchDashboardData();
        }
        setIsSavingSocials(false);
    };

    const handleRemoveAthlete = async (athleteUid: string) => {
        if (!data?.club.id || !currentUser?.uid) return;
        if (athleteUid === currentUser.uid) {
            toast({ variant: "destructive", title: "Forbidden", description: "Club owners cannot remove themselves." });
            return;
        }
        if (!removalReason.trim()) {
            toast({ variant: "destructive", title: "Reason Required", description: "Please provide a reason." });
            return;
        }
        setIsRemovingAthlete(athleteUid);
        try {
            const result = await removeAthleteFromClubAction(
                currentUser.uid,
                data.club.id,
                athleteToRemoveUid || athleteUid,
                removalReason
            );
            if (result.success) {
                toast({ title: "Athlete Removed" });
                setRemovalReason('');
                fetchDashboardData();
            }
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error", description: error.message });
        } finally {
            setIsRemovingAthlete(null);
            setAthleteToRemoveUid(null);
        }
    };

    const filteredMembers = useMemo(() => {
        if (!data?.members) return [];
        return data.members.filter(m => 
            m.athleteName.toLowerCase().includes(memberSearch.toLowerCase()) ||
            m.email?.toLowerCase().includes(memberSearch.toLowerCase())
        );
    }, [data?.members, memberSearch]);

    const registrationStats = useMemo(() => {
        const total = data?.athleteCount || 0;
        const registered = new Set(upcomingSlates.map(s => s.athleteUid)).size;
        return {
            total,
            registered,
            remaining: Math.max(0, total - registered)
        };
    }, [data?.athleteCount, upcomingSlates]);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                <ShieldAlert className="h-12 w-12 text-muted-foreground" />
                <h2 className="text-xl font-bold">No Club Data Found</h2>
                <p className="text-muted-foreground">This dashboard is only available for registered club owners.</p>
            </div>
        );
    }

    const validLogoUrl = data.club?.logoUrl && isValidImageUrl(data.club.logoUrl) ? data.club.logoUrl : undefined;

    return (
        <div className="space-y-8 animate-in fade-in duration-700 text-left">
            {/* --- HEADER --- */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-6 border-b text-left">
                <div className="flex items-center gap-5 text-left w-full">
                    <div className="relative shrink-0 text-left">
                        <Avatar className="h-24 w-24 border-4 border-background bg-white shadow-xl">
                            <AvatarImage src={validLogoUrl} className="object-contain p-2" />
                            <AvatarFallback className="bg-primary/10 text-primary text-4xl"><Building /></AvatarFallback>
                        </Avatar>
                        <Badge className="absolute -bottom-2 -right-2 px-2 py-1 bg-accent text-white border-2 border-background font-black text-[10px] uppercase">
                            Ranked {data.globalRank || 'N/A'}{getOrdinal(data.globalRank || 0)}
                        </Badge>
                    </div>
                    <div className="text-left flex-grow">
                        <div className="flex items-center justify-start gap-2 text-left">
                            <h1 className="text-4xl font-black tracking-tighter uppercase text-left leading-none">{data.club?.name}</h1>
                            {data.globalRank === 1 && <Crown className="h-6 w-6 text-yellow-500 fill-yellow-500 animate-pulse" />}
                        </div>
                        <div className="flex flex-wrap items-center justify-start gap-3 mt-2 text-left">
                            <Badge variant="secondary" className="bg-primary/5 text-primary border-primary/20 font-bold uppercase tracking-wider">Coach {data.club?.coach_name}</Badge>
                            <div className="flex items-center gap-1.5 text-muted-foreground text-sm font-semibold">
                                <span>{getCountryFlagEmoji(data.club?.country)}</span>
                                <span>{data.club?.country || 'Global'}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3 bg-muted/30 p-2 rounded-xl border border-border/50 shrink-0">
                    <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v, 10))}>
                        <SelectTrigger className="w-[120px] font-black border-none shadow-none h-9">
                            <Calendar className="mr-2 h-4 w-4 text-primary" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="2026">2026</SelectItem>
                            <SelectItem value="2025">2025</SelectItem>
                            <SelectItem value="2024">2024</SelectItem>
                        </SelectContent>
                    </Select>
                    <Separator orientation="vertical" className="h-6" />
                    <Button variant="ghost" onClick={fetchDashboardData} size="icon" className="h-9 w-9 hover:bg-primary/10 hover:text-primary transition-colors">
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full text-left">
                <TabsList className="bg-muted/50 p-1 rounded-xl mb-8 border border-border/50 w-full md:w-auto overflow-x-auto no-scrollbar justify-start">
                    <TabsTrigger value="overview" className="rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest"><LayoutDashboard className="h-4 w-4"/>Overview</TabsTrigger>
                    <TabsTrigger value="members" className="rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest"><Users className="h-4 w-4"/>Members</TabsTrigger>
                    <TabsTrigger value="settings" className="rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest"><Settings className="h-4 w-4"/>Settings</TabsTrigger>
                </TabsList>

                {/* --- OVERVIEW TAB --- */}
                <TabsContent value="overview" className="space-y-8 animate-in slide-in-from-left-4 duration-500 text-left">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-left">
                        <StatCard title="Club Points" value={data.totalPoints} subValue={`${year} Season`} icon={TrendingUp} colorClass="text-primary" />
                        <StatCard title="Global Rank" value={data.globalRank ? `${data.globalRank}${getOrdinal(data.globalRank)}` : 'N/A'} icon={Award} colorClass="text-accent" />
                        <StatCard title="Roster Size" value={data.athleteCount} subValue="Active Athletes" icon={Users} colorClass="text-blue-500" />
                        <StatCard title="Race Finishes" value={data.eventCount} subValue="In Triathlon" icon={CheckCircle2} colorClass="text-green-500" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 auto-rows-min text-left">
                        <Card className="border-none shadow-xl bg-slate-900 text-white overflow-hidden flex flex-col h-fit text-left">
                            <CardHeader className="bg-white/5 border-b border-white/10 p-6 text-left">
                                <div className="flex items-center justify-between text-left">
                                    <div className="text-left">
                                        <CardTitle className="text-2xl font-black uppercase tracking-tighter flex items-center gap-2 text-left">
                                            <FlagIconLucide className="h-6 w-6 text-orange-500 fill-orange-500" />
                                            Next Race Line-Up
                                        </CardTitle>
                                        <CardDescription className="text-slate-400 font-medium mt-1 text-left">Club athletes locked in for the upcoming start line</CardDescription>
                                    </div>
                                    <Button variant="ghost" size="icon" onClick={handleSyncSlates} disabled={isSyncingSlates} className="h-10 w-10 text-white hover:bg-white/10">
                                        <RefreshCw className={cn("h-5 w-5", isSyncingSlates && "animate-spin")} />
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0 flex-grow text-left">
                                {isLoadingSlates ? (
                                    <div className="flex items-center justify-center py-20"><Loader2 className="h-10 w-10 animate-spin text-orange-500"/></div>
                                ) : (
                                <ScrollArea className="h-[400px] text-left">
                                    <Table>
                                        <TableHeader className="bg-white/5 sticky top-0 z-10">
                                            <TableRow className="hover:bg-transparent border-white/10">
                                                <TableHead className="font-bold uppercase text-[10px] tracking-widest pl-6 text-slate-400 text-left">Athlete</TableHead>
                                                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-400 text-left">BIB</TableHead>
                                                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-400 text-left">Race</TableHead>
                                                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-right pr-6 text-slate-400">Date</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {upcomingSlates.length > 0 ? upcomingSlates.map((reg, idx) => (
                                                <TableRow key={idx} className="hover:bg-white/5 border-white/5 text-left">
                                                    <TableCell className="pl-6 py-4 text-left">
                                                        <p className="font-bold text-sm text-left">{reg.athleteName}</p>
                                                        <p className="text-[10px] font-bold text-orange-500 uppercase tracking-tighter text-left">{reg.ticketName}</p>
                                                    </TableCell>
                                                    <TableCell className="text-left">
                                                        <Badge variant="outline" className="font-mono font-bold text-xs border-white/20 text-white px-2">
                                                            {reg.athleteBibNumber || 'TBD'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-left">
                                                        <p className="text-[10px] font-black uppercase text-slate-300 leading-tight text-left">{reg.eventName}</p>
                                                    </TableCell>
                                                    <TableCell className="text-right pr-6 font-mono text-xs text-slate-400">
                                                        {reg.eventDate && reg.eventDate !== 'TBD' ? format(parseISO(reg.eventDate), 'dd MMM yy') : 'TBD'}
                                                    </TableCell>
                                                </TableRow>
                                            )) : (
                                                <TableRow className="border-none">
                                                    <TableCell colSpan={4} className="text-center py-20 text-slate-500 italic text-sm">
                                                        No upcoming registrations found for members.
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </ScrollArea>
                                )}
                            </CardContent>
                        </Card>

                        <div className="space-y-6 text-left">
                            <Card className="border-none shadow-xl bg-primary text-primary-foreground text-left">
                                <CardHeader className="pb-2 text-left">
                                    <CardTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2 text-left">
                                        <BarChart3 className="h-5 w-5" />
                                        Registration Snapshot
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4 text-left">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
                                        <div className="p-3 bg-white/10 rounded-xl text-left">
                                            <p className="text-[10px] font-bold uppercase opacity-70">Affiliated</p>
                                            <p className="text-2xl font-black">{registrationStats.total}</p>
                                        </div>
                                        <div className="p-3 bg-white/10 rounded-xl border border-white/20 text-left">
                                            <p className="text-[10px] font-bold uppercase opacity-70">Confirmed</p>
                                            <p className="text-2xl font-black">{registrationStats.registered}</p>
                                        </div>
                                        <div className="p-3 bg-white/10 rounded-xl text-left">
                                            <p className="text-[10px] font-bold uppercase opacity-70">Yet to Register</p>
                                            <p className="text-2xl font-black">{registrationStats.remaining}</p>
                                        </div>
                                    </div>
                                    <div className="pt-4 border-t border-white/10 text-left">
                                        <div className="flex justify-between items-center mb-4 text-left">
                                            <p className="text-xs font-black uppercase tracking-widest opacity-80 text-left">Campaign Stats</p>
                                            <Badge variant="outline" className="bg-white/10 text-white border-white/20">
                                                Remaining: {data.emailStats.remaining} / {data.emailStats.totalLimit}
                                            </Badge>
                                        </div>
                                        <p className="text-sm font-bold leading-relaxed text-left">
                                            Champions are built before race day. <br/>
                                            Rally your squad, fill the start list, and rise in the Bergman Club Leaderboard.
                                        </p>
                                        <div className="mt-6 space-y-2 text-left">
                                            <Button 
                                                onClick={handleEncourageRegistration}
                                                disabled={isSendingEncouragement || registrationStats.remaining === 0 || data.emailStats.remaining === 0}
                                                className="w-full bg-white text-primary font-black uppercase tracking-widest h-12 rounded-xl"
                                            >
                                                {isSendingEncouragement ? (
                                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                                ) : (
                                                    <Send className="mr-2 h-5 w-5" />
                                                )}
                                                Encourage Registration
                                            </Button>
                                            <p className="text-[10px] font-medium text-white/60 leading-tight text-center">
                                                {data.emailStats.remaining > 0 
                                                    ? `Personalized call to action will be sent to ${registrationStats.remaining} athletes.` 
                                                    : "Monthly limit reached. Resets at the start of next month."}
                                            </p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-none shadow-xl h-fit text-left">
                                <CardHeader className="text-left">
                                    <div className="flex items-center justify-between text-left">
                                        <div className="text-left">
                                            <CardTitle className="text-xl font-black uppercase tracking-tight text-left">Event Impact</CardTitle>
                                            <CardDescription className="text-left">Points distribution across races</CardDescription>
                                        </div>
                                        <TrendingUp className="h-5 w-5 text-green-500" />
                                    </div>
                                </CardHeader>
                                <CardContent className="h-[200px] p-0 pb-4 text-left">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={data.monthlyPerformance || []} layout="vertical" margin={{ left: 20, right: 20 }}>
                                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} opacity={0.1} />
                                            <XAxis type="number" hide />
                                            <YAxis dataKey="month" type="category" axisLine={false} tickLine={false} tick={{fontSize: 10, fontStyle: 'bold', fill: 'hsl(var(--foreground))'}} width={40} />
                                            <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '12px' }} />
                                            <Bar dataKey="points" radius={[0, 4, 4, 0]} barSize={20}>
                                                {(data.monthlyPerformance || []).map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={index % 2 === 0 ? 'hsl(var(--primary))' : 'hsl(var(--accent))'} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    <Separator className="my-12" />
                    
                    <div className="space-y-6 text-left">
                        <div className="flex items-center justify-start gap-3 text-left">
                            <div className="flex-shrink-0 bg-primary/10 p-3 rounded-full">
                                <CalendarSearch className="h-6 w-6 text-primary" />
                            </div>
                            <div className="text-left">
                                <h2 className="text-2xl font-black uppercase tracking-tight text-left">Upcoming Bergman Events</h2>
                                <p className="text-sm text-muted-foreground text-left">Encourage your athletes to sign up for the next challenge.</p>
                            </div>
                        </div>
                        
                        {isLoadingEvents ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
                                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}
                            </div>
                        ) : upcomingEvents.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
                                {upcomingEvents.map(event => (
                                    <EventDisplayCard key={event.id} event={event} />
                                ))}
                            </div>
                        ) : (
                            <Card className="bg-muted/30 border-dashed border-2 text-left">
                                <CardContent className="p-12 text-center">
                                    <CalendarSearch className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                    <p className="text-muted-foreground font-medium text-center">No upcoming events found. Check back soon!</p>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </TabsContent>

                {/* --- MEMBERS TAB --- */}
                <TabsContent value="members" className="space-y-4 animate-in slide-in-from-left-4 duration-500 text-left">
                    <Card className="shadow-2xl border-none text-left">
                        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-left">
                            <div className="text-left">
                                <CardTitle className="text-2xl font-black uppercase tracking-tight text-left">Club Roster</CardTitle>
                                <CardDescription className="text-left">Manage and monitor performance of all affiliated athletes.</CardDescription>
                            </div>
                            <div className="relative w-full sm:w-80 text-left">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input placeholder="Search name or email..." className="pl-10 bg-muted/30 border-none h-10 text-sm font-semibold rounded-xl" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
                            </div>
                        </CardHeader>
                        <CardContent className="p-0 text-left">
                            <div className="rounded-none border-t overflow-x-auto text-left">
                                <Table>
                                    <TableHeader className="bg-muted/30">
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className="pl-6 font-bold uppercase text-[10px] tracking-widest text-left">Athlete</TableHead>
                                            <TableHead className="font-bold uppercase text-[10px] tracking-widest hidden md:table-cell text-left">Contact</TableHead>
                                            <TableHead className="text-right font-bold uppercase text-[10px] tracking-widest">Starts ({year})</TableHead>
                                            <TableHead className="text-right font-bold uppercase text-[10px] tracking-widest">Season Pts</TableHead>
                                            <TableHead className="text-right pr-6 font-bold uppercase text-[10px] tracking-widest">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredMembers.length > 0 ? filteredMembers.map((member) => (
                                            <TableRow key={member.athleteUid} className="hover:bg-muted/10 text-left">
                                                <TableCell className="pl-6 py-4 text-left">
                                                    <div className="flex items-center gap-3 text-left">
                                                        <Avatar className="h-10 w-10 border-2 border-muted shadow-sm">
                                                            <AvatarImage src={member.photoURL || undefined} className="object-cover" />
                                                            <AvatarFallback className="font-bold bg-muted text-muted-foreground">{getInitials(member.athleteName)}</AvatarFallback>
                                                        </Avatar>
                                                        <div className="text-left">
                                                            <p className="font-black text-sm uppercase text-left">{member.athleteName}</p>
                                                            <Badge variant="secondary" className="text-[10px] h-4 font-bold uppercase tracking-tighter mt-0.5">Active</Badge>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-left">
                                                    <p className="text-xs font-semibold text-muted-foreground lowercase text-left">{member.email || '-'}</p>
                                                </TableCell>
                                                <TableCell className="text-right font-mono font-bold text-slate-500">{member.racesFinished}</TableCell>
                                                <TableCell className="text-right text-left"><span className="font-black text-lg text-primary">{member.pointsContributed}</span></TableCell>
                                                <TableCell className="text-right pr-6 text-left">
                                                    {member.athleteUid === currentUser?.uid ? (
                                                        <Badge variant="outline" className="gap-1.5 border-primary/30 text-primary uppercase font-bold text-[10px]"><ShieldAlert className="h-3.5 w-3.5" /> Owner</Badge>
                                                    ) : (
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg h-8 w-8 p-0" disabled={isRemovingAthlete === member.athleteUid} title="Remove Athlete">
                                                                    {isRemovingAthlete === member.athleteUid ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                                </Button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent className="rounded-2xl border-none shadow-2xl text-left">
                                                                <AlertDialogHeader className="text-left">
                                                                    <div className="flex items-center gap-3 mb-2 text-left">
                                                                        <div className="p-3 bg-destructive/10 rounded-full"><AlertTriangle className="h-6 w-6 text-destructive" /></div>
                                                                        <div className="text-left">
                                                                            <AlertDialogTitle className="text-xl font-black uppercase tracking-tight text-left">Remove from Roster?</AlertDialogTitle>
                                                                            <AlertDialogDescription className="text-sm font-medium text-left">This will terminate <strong>{member.athleteName}&apos;s</strong> affiliation with your club.</AlertDialogDescription>
                                                                        </div>
                                                                    </div>
                                                                </AlertDialogHeader>
                                                                <div className="py-4 space-y-2 text-left">
                                                                    <Label htmlFor="removal-reason" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1 block text-left">Reason for Removal*</Label>
                                                                    <Textarea id="removal-reason" placeholder="Athlete changed teams, misconduct, etc..." value={removalReason} onChange={(e) => setRemovalReason(e.target.value)} className="rounded-xl border-muted bg-muted/30 focus:ring-primary" />
                                                                </div>
                                                                <AlertDialogFooter className="text-left">
                                                                    <AlertDialogCancel onClick={() => { setRemovalReason(''); setAthleteToRemoveUid(null); }}>Cancel</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => handleRemoveAthlete(member.athleteUid)} className="bg-destructive hover:bg-destructive/90">Confirm Removal</AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )) : (
                                            <TableRow className="border-none text-left">
                                                <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic text-sm">No members found matching your search.</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* --- SETTINGS TAB --- */}
                <TabsContent value="settings" className="space-y-6 animate-in slide-in-from-left-4 duration-500 max-w-4xl text-left">
                    <Card className="shadow-2xl border-none overflow-hidden text-left">
                        <CardHeader className="bg-muted/30 text-left">
                            <CardTitle className="text-2xl font-black uppercase tracking-tight text-left">Club Management</CardTitle>
                            <CardDescription className="text-left">Update your club identity and settings.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-8 space-y-10 text-left">
                            <div className="flex flex-col items-center gap-6 p-6 bg-primary/5 rounded-2xl border border-primary/10 text-left">
                                <div className="relative group text-left">
                                    <Avatar className="h-32 w-32 border-4 border-background bg-white shadow-2xl transition-transform group-hover:scale-105 duration-300">
                                        <AvatarImage src={validLogoUrl} className="object-contain p-2" />
                                        <AvatarFallback className="text-4xl bg-primary/5 text-primary"><Building /></AvatarFallback>
                                    </Avatar>
                                    <Button size="icon" variant="default" disabled={isUpdatingLogo} className="absolute bottom-0 right-0 rounded-full h-10 w-10 shadow-xl" onClick={() => logoInputRef.current?.click()}>
                                        {isUpdatingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-5 w-5" />}
                                    </Button>
                                    <input type="file" ref={logoInputRef} className="hidden" accept="image/*" onChange={handleLogoUpload} />
                                </div>
                                <div className="text-left">
                                    <h4 className="font-bold text-sm text-left">Club Logo</h4>
                                    <p className="mt-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary">
                                        📸 Logo Tip: For best display, upload square logos (1:1 aspect ratio) like 512×512px or 1024×1024px in PNG/JPG format.
                                    </p>
                                    <div className="text-[10px] text-muted-foreground mt-1 text-left space-y-1">
                                        <p className="font-bold text-primary">Recommended Specs:</p>
                                        <p>• Dimensions: 500 x 500 pixels (1:1 Square)</p>
                                        <p>• Format: PNG (preferred for transparency) or JPG</p>
                                        <p>• Max Size: 1 MB</p>
                                        <p>• Design: Keep important elements centered for circular cropping.</p>
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            <Form {...detailsForm}>
                                <form onSubmit={detailsForm.handleSubmit(onDetailsSubmit)} className="space-y-6 text-left">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                        <FormField control={detailsForm.control} name="name" render={({ field }) => (
                                            <FormItem className="text-left">
                                                <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Club Name (Not Editable)</FormLabel>
                                                <FormControl><Input {...field} value={field.value || ""} className="rounded-xl bg-muted/10 h-11 font-semibold cursor-not-allowed opacity-70" disabled={true} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={detailsForm.control} name="coach_name" render={({ field }) => (
                                            <FormItem className="text-left">
                                                <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Lead Coach / Owner</FormLabel>
                                                <FormControl><Input {...field} value={field.value || ""} className="rounded-xl bg-muted/30 h-11 font-semibold" disabled={isSavingDetails} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={detailsForm.control} name="email" render={({ field }) => (
                                            <FormItem className="text-left">
                                                <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Contact Email</FormLabel>
                                                <FormControl><Input {...field} value={field.value || ""} type="email" className="rounded-xl bg-muted/30 h-11 font-semibold" disabled={isSavingDetails} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={detailsForm.control} name="mobile" render={({ field }) => (
                                            <FormItem className="text-left">
                                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Contact Mobile</FormLabel>
                                                <FormControl><Input {...field} value={field.value || ""} placeholder="+91..." className="rounded-xl bg-muted/30 h-11 font-semibold" disabled={isSavingDetails} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>
                                    <div className="flex justify-end pt-2 text-left">
                                        <Button type="submit" disabled={isSavingDetails} className="bg-primary hover:bg-primary/90 rounded-xl px-8 font-bold uppercase tracking-wider text-xs h-11">
                                            {isSavingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                            Save Identity Changes
                                        </Button>
                                    </div>
                                </form>
                            </Form>

                            <Separator />

                            <Form {...socialsForm}>
                                <form onSubmit={socialsForm.handleSubmit(onSocialsSubmit)} className="space-y-6 text-left">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                        <FormField control={socialsForm.control} name="instagramUrl" render={({ field }) => (
                                            <FormItem className="text-left">
                                                <FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left text-left">
                                                    <Instagram className="h-3.5 w-3.5 text-pink-600" /> Instagram URL
                                                </FormLabel>
                                                <FormControl><Input {...field} value={field.value || ''} placeholder="https://instagram.com/club" className="rounded-xl bg-muted/30 h-11 font-semibold" disabled={isSavingSocials} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={socialsForm.control} name="facebookUrl" render={({ field }) => (
                                            <FormItem className="text-left">
                                                <FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left text-left">
                                                    <Facebook className="h-3.5 w-3.5 text-blue-600" /> Facebook URL
                                                </FormLabel>
                                                <FormControl><Input {...field} value={field.value || ''} placeholder="https://facebook.com/yourclub" className="rounded-xl bg-muted/30 h-11 font-semibold" disabled={isSavingSocials} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={socialsForm.control} name="city" render={({ field }) => (
                                            <FormItem className="text-left">
                                                <FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left text-left">
                                                    <MapPin className="h-3.5 w-3.5 text-primary" /> City
                                                </FormLabel>
                                                <FormControl><Input {...field} value={field.value || ""} placeholder="e.g. Pune" className="rounded-xl bg-muted/30 h-11 font-semibold" disabled={isSavingSocials} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={socialsForm.control} name="state" render={({ field }) => (
                                            <FormItem className="text-left">
                                                <FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left text-left">
                                                    <Globe className="h-3.5 w-3.5 text-primary" /> State
                                                </FormLabel>
                                                <FormControl><Input {...field} value={field.value || ""} placeholder="e.g. Maharashtra" className="rounded-xl bg-muted/30 h-11 font-semibold" disabled={isSavingSocials} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={socialsForm.control} name="country" render={({ field }) => (
                                            <FormItem className="text-left">
                                                <FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left text-left">
                                                    <Globe className="h-3.5 w-3.5 text-primary" /> Club Country
                                                </FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value || ''} disabled={isSavingSocials}>
                                                    <FormControl><SelectTrigger className="rounded-xl bg-muted/30 h-11 font-semibold text-left"><SelectValue placeholder="Select Country" /></SelectTrigger></FormControl>
                                                    <SelectContent className="text-left">
                                                        <SelectGroup className="text-left">
                                                            <SelectLabel className="text-left">Select Region</SelectLabel>
                                                            <SelectItem value="India" className="text-left">🇮🇳 India</SelectItem>
                                                            <SelectItem value="United States" className="text-left">🇺🇸 United States</SelectItem>
                                                            <SelectItem value="United Kingdom" className="text-left">🇬🇧 United Kingdom</SelectItem>
                                                            <SelectItem value="Australia" className="text-left">🇦🇺 Australia</SelectItem>
                                                            <SelectItem value="Singapore" className="text-left">🇸🇬 Singapore</SelectItem>
                                                            <SelectItem value="UAE" className="text-left">🇦🇪 UAE</SelectItem>
                                                        </SelectGroup>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>
                                    <div className="flex justify-end pt-2 text-left">
                                        <Button type="submit" variant="secondary" disabled={isSavingSocials} className="rounded-xl px-8 font-bold uppercase tracking-wider text-xs h-11 border border-border">
                                            {isSavingSocials ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4 text-primary" />}
                                            Update Social & Locale
                                        </Button>
                                    </div>
                                </form>
                            </Form>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
