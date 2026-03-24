// src/components/admin/AiInsightsTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Bot, Search, MessageSquare, TrendingUp, RefreshCw, Globe, Zap, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { Input } from '../ui/input';
import { getInitials, cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { syncWebsiteToKVAction } from '@/lib/actions/faqActions';
import { useAuth } from '@/context/AuthContext';

interface AiLog {
    id: string;
    userName: string;
    question: string;
    answer: string;
    timestamp: any;
}

export default function AiInsightsTab() {
    const { toast } = useToast();
    const { currentUser } = useAuth();
    const [logs, setLogs] = useState<AiLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [streamError, setStreamError] = useState<string | null>(null);

    const fetchLogs = useCallback(() => {
        if (!db || !currentUser?.isAdmin) return;
        setStreamError(null);
        setIsLoading(true);
        
        try {
            // REQUIRES FIRESTORE INDEX: aiLogs { timestamp: DESC }
            const q = query(collection(db, "aiLogs"), orderBy("timestamp", "desc"), limit(50));
            
            const unsubscribe = onSnapshot(q, (snapshot) => {
                const fetchedLogs = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                } as AiLog));
                setLogs(fetchedLogs);
                setIsLoading(false);
            }, (err) => {
                console.error("AI Logs Stream Error:", err);
                setStreamError(err.message || "Connection error. Please check Firestore permissions and indexes.");
                setIsLoading(false);
            });

            return unsubscribe;
        } catch (err: any) {
            setStreamError(err.message);
            setIsLoading(false);
        }
    }, [currentUser?.isAdmin]);

    useEffect(() => {
        if (currentUser?.isAdmin) {
            const unsubscribe = fetchLogs();
            return () => { if(unsubscribe) unsubscribe(); };
        }
    }, [fetchLogs, currentUser?.isAdmin]);

    const stats = useMemo(() => {
        const total = logs.length;
        const recentHour = logs.filter(l => {
            const date = l.timestamp?.toDate ? l.timestamp.toDate() : (l.timestamp ? new Date(l.timestamp) : new Date());
            return (Date.now() - date.getTime()) < 3600000;
        }).length;
        return { total, recentHour };
    }, [logs]);

    const handleSyncKB = async () => {
        setIsSyncing(true);
        try {
            const result = await syncWebsiteToKVAction();
            if (result.success) {
                toast({ title: 'KB Sync Complete', description: result.message });
            } else {
                toast({ variant: 'destructive', title: 'Sync Failed', description: result.message });
            }
        } finally {
            setIsSyncing(false);
        }
    };

    const filteredLogs = useMemo(() => {
        if (!searchTerm) return logs;
        const lower = searchTerm.toLowerCase();
        return logs.filter(l => 
            l.question.toLowerCase().includes(lower) || 
            l.userName.toLowerCase().includes(lower)
        );
    }, [logs, searchTerm]);

    if (!currentUser?.isAdmin) {
        return <div className="p-8 text-center">Unauthorized access.</div>;
    }

    return (
        <div className="space-y-6 text-left">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-primary/5 border-none shadow-md">
                    <CardHeader className="p-4 text-left">
                        <CardTitle className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 text-left">
                            <MessageSquare className="h-4 w-4" /> Interaction Volume
                        </CardTitle>
                        <div className="text-3xl font-black italic tracking-tighter mt-2 text-left">{stats.total}</div>
                        <CardDescription className="text-[10px] font-bold uppercase text-left">Total queries recorded</CardDescription>
                    </CardHeader>
                </Card>
                
                <Card className="bg-orange-50 border-none shadow-sm">
                    <CardHeader className="p-4 text-left">
                        <CardTitle className="text-sm font-black uppercase tracking-widest text-orange-600 flex items-center gap-2 text-left">
                            <TrendingUp className="h-4 w-4" /> Velocity
                        </CardTitle>
                        <div className="text-3xl font-black italic tracking-tighter mt-2 text-left">{stats.recentHour}</div>
                        <CardDescription className="text-[10px] font-bold uppercase text-left">Questions in the last hour</CardDescription>
                    </CardHeader>
                </Card>

                <Card className="border-2 border-dashed bg-muted/20">
                    <CardHeader className="p-4 text-left">
                        <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2 text-left">
                            <Globe className="h-4 w-4 text-primary" /> Knowledge Base
                        </CardTitle>
                        <Button 
                            variant="default" 
                            size="sm" 
                            className="mt-2 h-9 rounded-xl font-black uppercase text-[10px] tracking-widest"
                            onClick={handleSyncKB}
                            disabled={isSyncing}
                        >
                            {isSyncing ? <Loader2 className="animate-spin mr-2 h-3 w-3" /> : <RefreshCw className="mr-2 h-3 w-3" />}
                            Sync Website Content
                        </Button>
                    </CardHeader>
                </Card>
            </div>

            {streamError && (
                <Card className="border-destructive/20 bg-destructive/5">
                    <CardContent className="p-4 flex items-center gap-3 text-destructive">
                        <AlertCircle className="h-5 w-5" />
                        <div className="text-left">
                            <p className="font-bold uppercase text-[10px] tracking-widest text-left">Connection Error</p>
                            <p className="font-medium text-left">{streamError}</p>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card className="border-none shadow-xl overflow-hidden">
                <CardHeader className="bg-muted/30 border-b pb-4 text-left">
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-left">
                        <div className="text-left">
                            <CardTitle className="text-xl font-black uppercase italic tracking-tighter flex items-center gap-2 text-left">
                                <Bot className="h-5 w-5 text-primary" />
                                Elite AI Conversation Stream
                            </CardTitle>
                            <CardDescription className="text-xs font-medium text-left">Monitoring real-time athlete-AI interactions.</CardDescription>
                        </div>
                        <div className="relative w-full sm:w-80 text-left">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Filter by athlete or topic..." 
                                className="pl-10 h-10 rounded-xl bg-background border-none shadow-sm text-xs font-bold text-left"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0 text-left">
                    <div className="overflow-x-auto text-left">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="h-10 text-[10px] font-black uppercase tracking-widest border-b">
                                    <TableHead className="pl-6 text-left">Athlete</TableHead>
                                    <TableHead className="w-[40%] text-left">Question</TableHead>
                                    <TableHead className="w-[40%] text-left">AI Response</TableHead>
                                    <TableHead className="text-right pr-6">Time</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow><TableCell colSpan={4} className="text-center h-48"><Loader2 className="animate-spin h-8 w-8 mx-auto text-primary"/></TableCell></TableRow>
                                ) : filteredLogs.length === 0 ? (
                                    <TableRow><TableCell colSpan={4} className="text-center py-20 text-muted-foreground italic">No conversations logged yet.</TableCell></TableRow>
                                ) : (
                                    filteredLogs.map(log => {
                                        const date = log.timestamp?.toDate ? log.timestamp.toDate() : (log.timestamp ? new Date(log.timestamp) : null);
                                        return (
                                            <TableRow key={log.id} className="h-16 hover:bg-muted/10 transition-colors text-xs border-border/50">
                                                <TableCell className="pl-6 text-left">
                                                    <div className="flex items-center gap-2 text-left">
                                                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                                                            {getInitials(log.userName)}
                                                        </div>
                                                        <span className="font-bold uppercase tracking-tight text-left">{log.userName}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-left font-medium text-slate-600">
                                                    <p className="line-clamp-2 text-left">{log.question}</p>
                                                </TableCell>
                                                <TableCell className="text-left">
                                                    <div className="bg-primary/5 rounded-lg p-2 border border-primary/10 line-clamp-2 text-left">
                                                        {log.answer}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right pr-6 font-mono text-[10px] text-muted-foreground">
                                                    {date instanceof Date ? format(date, 'MMM dd, p') : '—'}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
                <CardFooter className="bg-muted/30 border-t p-4 text-left">
                    <p className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left">
                        <Zap className="h-3 w-3 text-primary" /> Auto-learning enabled. Frequently asked queries are used to refine the Knowledge Base.
                    </p>
                </CardFooter>
            </Card>
        </div>
    );
}
