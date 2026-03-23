// src/components/admin/AthleteMergeTab.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { 
    Users, Search, Loader2, ArrowRight, CheckCircle2, AlertTriangle, 
    Trash2, UserPlus, RefreshCw, Mail, Smartphone, History, Building
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
    findDuplicateAthletesAction, 
    mergeAthletesAction, 
    searchAthletesForAdminAction 
} from '@/lib/actions/adminActions';
import type { User } from '@/lib/types';
import { cn, getInitials } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
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

export default function AthleteMergeTab() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [isMerging, setIsMerging] = useState(false);
    const [duplicates, setDuplicates] = useState<{ email: string; users: User[] }[]>([]);
    
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<User[]>([]);
    
    const [primaryAccount, setPrimaryAccount] = useState<User | null>(null);
    const [duplicateAccount, setDuplicateAccount] = useState<User | null>(null);

    const scanDuplicates = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await findDuplicateAthletesAction();
            if (result.success && result.duplicates) {
                setDuplicates(result.duplicates);
            }
        } finally {
            setIsLoading(false);
        }
    }, []);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (searchTerm.length < 3) return;
        setIsLoading(true);
        const res = await searchAthletesForAdminAction(searchTerm, 'name');
        if (res.success && res.athletes) setSearchResults(res.athletes);
        setIsLoading(false);
    };

    const handleMerge = async () => {
        if (!primaryAccount || !duplicateAccount) return;
        setIsMerging(true);
        try {
            const res = await mergeAthletesAction(primaryAccount.uid, duplicateAccount.uid);
            if (res.success) {
                toast({ title: "Accounts Merged Successfully", description: res.message });
                setPrimaryAccount(null);
                setDuplicateAccount(null);
                scanDuplicates();
            } else {
                toast({ variant: 'destructive', title: "Merge Failed", description: res.message });
            }
        } finally {
            setIsMerging(false);
        }
    };

    const AthleteSmallCard = ({ user, type }: { user: User, type: 'primary' | 'duplicate' }) => (
        <Card className={cn(
            "p-4 border-2 transition-all text-left",
            type === 'primary' ? "border-primary bg-primary/5" : "border-destructive bg-destructive/5"
        )}>
            <div className="flex items-center gap-3 text-left">
                <Avatar className="h-10 w-10">
                    <AvatarImage src={user.photoURL || undefined} />
                    <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="text-left flex-grow">
                    <p className="font-bold text-sm uppercase text-left">{user.name}</p>
                    <p className="text-[10px] text-muted-foreground lowercase text-left">{user.email}</p>
                </div>
                <Badge variant={type === 'primary' ? 'default' : 'destructive'} className="text-[9px] uppercase font-black">
                    {type}
                </Badge>
            </div>
            <div className="mt-3 pt-3 border-t border-border/50 grid grid-cols-2 gap-2 text-[10px] font-bold uppercase text-muted-foreground text-left">
                <div className="flex items-center gap-1 text-left"><Smartphone className="h-3 w-3"/> {user.mobile || 'N/A'}</div>
                <div className="flex items-center gap-1 text-left"><Building className="h-3 w-3"/> {user.clubName || 'N/A'}</div>
            </div>
        </Card>
    );

    return (
        <div className="space-y-8 text-left animate-in fade-in duration-500">
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-left">
                {/* 1. SELECTOR BOX */}
                <div className="lg:col-span-2 space-y-6 text-left">
                    <Card className="border-none shadow-xl">
                        <CardHeader className="bg-primary/5 border-b text-left">
                            <CardTitle className="text-xl font-black uppercase italic tracking-tighter text-left">Merge Console</CardTitle>
                            <CardDescription className="text-left font-medium">Select two accounts to consolidate history and profile data.</CardDescription>
                        </CardHeader>
                        <CardContent className="pt-8 space-y-8 text-left">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                <div className="space-y-4 text-left">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2 text-left">
                                        <CheckCircle2 className="h-4 w-4"/> Step 1: Set Primary
                                    </h4>
                                    {primaryAccount ? (
                                        <div className="relative group text-left">
                                            <AthleteSmallCard user={primaryAccount} type="primary" />
                                            <button 
                                                className="absolute -top-2 -right-2 h-6 w-6 bg-background shadow-md border rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-muted-foreground hover:text-foreground"
                                                onClick={() => setPrimaryAccount(null)}
                                            >
                                                <X className="h-3 w-3"/>
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="h-32 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center bg-muted/20 text-muted-foreground text-left p-4">
                                            <UserPlus className="h-8 w-8 mb-2 opacity-30"/>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-center">Search & pick primary athlete</p>
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-4 text-left">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-destructive flex items-center gap-2 text-left">
                                        <Trash2 className="h-4 w-4"/> Step 2: Set Duplicate
                                    </h4>
                                    {duplicateAccount ? (
                                        <div className="relative group text-left">
                                            <AthleteSmallCard user={duplicateAccount} type="duplicate" />
                                            <button 
                                                className="absolute -top-2 -right-2 h-6 w-6 bg-background shadow-md border rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-muted-foreground hover:text-foreground"
                                                onClick={() => setDuplicateAccount(null)}
                                            >
                                                <X className="h-3 w-3"/>
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="h-32 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center bg-muted/20 text-muted-foreground text-left p-4">
                                            <UserPlus className="h-8 w-8 mb-2 opacity-30"/>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-center">Search & pick duplicate athlete</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {primaryAccount && duplicateAccount && (
                                <div className="pt-4 animate-in slide-in-from-bottom-4 duration-500 text-left">
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 font-black uppercase tracking-widest shadow-xl shadow-primary/20 text-left">
                                                <History className="mr-3 h-6 w-6"/> Consolidate Accounts
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent className="text-left rounded-3xl border-none shadow-2xl">
                                            <AlertDialogHeader className="text-left">
                                                <AlertDialogTitle className="text-2xl font-black uppercase italic tracking-tighter text-left">Final Merge Confirmation</AlertDialogTitle>
                                                <AlertDialogDescription className="text-sm font-medium leading-relaxed text-left">
                                                    You are about to merge <strong>{duplicateAccount.name}</strong> into <strong>{primaryAccount.name}</strong>.<br/><br/>
                                                    <ul className="list-disc pl-5 space-y-1 text-left">
                                                        <li className="text-left">All Race Registrations will be moved.</li>
                                                        <li className="text-left">All Race Results & Points will be moved.</li>
                                                        <li className="text-primary font-bold text-left">Primary profile will absorb missing contact info.</li>
                                                        <li className="text-destructive font-bold text-left">Duplicate profile will be PERMANENTLY DELETED.</li>
                                                    </ul>
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter className="pt-6 text-left">
                                                <AlertDialogCancel className="rounded-xl font-bold uppercase text-xs">Back to safety</AlertDialogCancel>
                                                <AlertDialogAction onClick={handleMerge} className="bg-primary hover:bg-primary/90 rounded-xl font-black uppercase tracking-widest text-xs h-11 px-8">
                                                    Execute Merge
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-none shadow-xl">
                        <CardHeader className="pb-4 text-left">
                            <CardTitle className="text-lg font-black uppercase text-left">Athlete Finder</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6 text-left">
                            <form onSubmit={handleSearch} className="flex gap-2 text-left">
                                <div className="relative flex-grow text-left">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input placeholder="Search athlete by name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10 h-11 rounded-xl font-bold border-muted text-left" />
                                </div>
                                <Button type="submit" disabled={isLoading} className="h-11 rounded-xl px-6 font-bold uppercase text-xs text-left">
                                    {isLoading ? <Loader2 className="animate-spin h-4 w-4" /> : <Search className="h-4 w-4" />}
                                </Button>
                            </form>

                            <div className="rounded-2xl border overflow-hidden text-left">
                                <Table>
                                    <TableHeader className="bg-muted/30">
                                        <TableRow className="h-10 text-[10px] font-black uppercase">
                                            <TableHead className="pl-6 text-left">Athlete</TableHead>
                                            <TableHead className="text-left">Contact</TableHead>
                                            <TableHead className="text-right pr-6">Set As</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {searchResults.length === 0 ? (
                                            <TableRow><TableCell colSpan={3} className="text-center py-10 text-muted-foreground italic text-xs">Search for athletes to begin consolidation.</TableCell></TableRow>
                                        ) : searchResults.map(u => (
                                            <TableRow key={u.uid} className="h-14 hover:bg-muted/5 transition-colors text-left">
                                                <TableCell className="pl-6 text-left">
                                                    <div className="font-bold text-xs uppercase text-left">{u.name}</div>
                                                    <div className="text-[10px] text-muted-foreground font-mono text-left">{u.uid.slice(-8)}</div>
                                                </TableCell>
                                                <TableCell className="text-left">
                                                    <div className="text-[10px] lowercase text-muted-foreground leading-tight text-left">{u.email}</div>
                                                    <div className="text-[10px] font-bold text-slate-400 mt-0.5 text-left">{u.mobile || 'No Mobile'}</div>
                                                </TableCell>
                                                <TableCell className="text-right pr-6 space-x-1">
                                                    <Button size="xs" variant="outline" onClick={() => setPrimaryAccount(u)} disabled={duplicateAccount?.uid === u.uid} className="font-black text-[9px] uppercase tracking-tighter">Primary</Button>
                                                    <Button size="xs" variant="outline" onClick={() => setDuplicateAccount(u)} disabled={primaryAccount?.uid === u.uid} className="font-black text-[9px] uppercase tracking-tighter text-destructive border-destructive/20 hover:bg-destructive/5">Duplicate</Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* 2. SYSTEM SCAN BOX */}
                <div className="space-y-6 text-left">
                    <Card className="border-none shadow-xl bg-muted/20 h-full flex flex-col text-left">
                        <CardHeader className="p-6 pb-2 text-left">
                            <CardTitle className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center justify-between text-left">
                                Detected Conflicts
                                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-primary/10 rounded-full" onClick={scanDuplicates} disabled={isLoading}>
                                    <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                                </Button>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 flex-grow text-left">
                            <ScrollArea className="h-[600px] p-6 pt-2 text-left">
                                {isLoading && <div className="flex justify-center py-12"><Loader2 className="animate-spin h-8 w-8 text-primary"/></div>}
                                {!isLoading && duplicates.length === 0 && (
                                    <div className="text-center py-20 space-y-3 opacity-40 text-left">
                                        <CheckCircle2 className="h-12 w-12 mx-auto text-green-600"/>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-center">No duplicate emails detected</p>
                                    </div>
                                )}
                                <div className="space-y-4 text-left">
                                    {duplicates.map((group, i) => (
                                        <div key={i} className="p-4 rounded-2xl bg-background border border-border shadow-sm space-y-3 text-left">
                                            <div className="flex items-center gap-2 border-b pb-2 mb-2 text-left">
                                                <Mail className="h-3 w-3 text-primary"/>
                                                <span className="text-[10px] font-black text-primary lowercase truncate">{group.email}</span>
                                            </div>
                                            <div className="space-y-2 text-left">
                                                {group.users.map(u => (
                                                    <div key={u.uid} className="flex items-center justify-between group/row text-left">
                                                        <div className="text-left">
                                                            <p className="text-xs font-bold uppercase truncate max-w-[120px] text-left">{u.name}</p>
                                                            <p className="text-[9px] text-muted-foreground font-mono text-left">{u.uid.slice(-6)}</p>
                                                        </div>
                                                        <div className="flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity text-left">
                                                            <Button size="xs" variant="outline" className="h-6 text-[8px] font-black text-left" onClick={() => {
                                                                setPrimaryAccount(u);
                                                                const other = group.users.find(other => other.uid !== u.uid);
                                                                if(other) setDuplicateAccount(other);
                                                            }}>Consolidate</Button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </CardContent>
                        <CardFooter className="bg-muted/30 border-t p-4 text-left">
                            <p className="text-[9px] font-bold text-muted-foreground leading-tight uppercase flex items-start gap-2 text-left">
                                <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0"/>
                                Automated duplicate check identifies users sharing the exact same email address.
                            </p>
                        </CardFooter>
                    </Card>
                </div>
            </div>
        </div>
    );
}

const X = ({ className }: { className?: string }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        width="24" height="24" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className={className}
    >
        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
    </svg>
);
