
// src/components/admin/DataSyncTab.tsx
"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button'; 
import { 
    Loader2, RefreshCw, Database, BarChart3, Trophy, Award, BookOpen, 
    Users2, Building, CheckCircle2, AlertCircle, TrendingUp, History, 
    Terminal, Zap, Package, LayoutGrid, Calendar, Info, PlayCircle, ExternalLink as ExternalLinkIcon,
    TicketPercent, Star, Trash2
} from 'lucide-react';
import { runDataSyncAction, rebuildAllRankingsAction } from '@/lib/actions';
import type { EventCalendarEntry, RaceResult } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn, serializeValue } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
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

const SyncSection = ({ title, description, children, icon: Icon }: { title: string, description: string, children: React.ReactNode, icon: React.ElementType }) => (
    <div className="p-5 border rounded-2xl bg-background shadow-sm space-y-4 hover:shadow-md transition-shadow">
        <div className="flex items-start gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
                <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
                <h4 className="font-bold text-base leading-none text-left">{title}</h4>
                <p className="text-xs text-muted-foreground mt-1.5 text-left">{description}</p>
            </div>
        </div>
        <div className="pt-2 text-left">
            {children}
        </div>
    </div>
);

export default function DataSyncTab({ events, isLoadingEvents }: { events: EventCalendarEntry[], isLoadingEvents: boolean }) {
  const { toast } = useToast();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<any>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [isFullRebuilding, setIsFullRebuilding] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setSyncLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
  }, []);

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  useEffect(() => {
    if (!activeJobId) return;
    const interval = setInterval(async () => {
        try {
            const res = await fetch(`/api/admin/upload-status/${activeJobId}`);
            if (!res.ok) return;
            const data = await res.json();
            setJobProgress(data);

            if (data.stage && data.stage !== jobProgress?.stage) {
                addLog(`Phase: ${data.stage}`);
            }

            if (data.status === 'completed' || data.status === 'failed') {
                clearInterval(interval);
                if (data.status === 'completed') {
                    addLog("✅ Task Finished Successfully.");
                    toast({ title: 'Sync Task Finished', description: data.message || 'Operation successful.' });
                } else {
                    addLog(`❌ Task Failed: ${data.message}`);
                    toast({ variant: 'destructive', title: 'Task Failed', description: data.message });
                }
                setActiveJobId(null);
            }
        } catch (e) {
            console.error("Polling failed", e);
        }
    }, 2500);
    return () => clearInterval(interval);
  }, [activeJobId, toast, jobProgress?.stage, addLog]);

  useEffect(() => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
  }, [syncLogs]);

  const handleSync = async (syncType: string, eventId?: string) => {
    const yearToSync = parseInt(selectedYear, 10);
    const eventName = events.find(e => e.id === eventId)?.eventName || "System";
    
    addLog(`Initiating ${syncType} sync for ${eventName}...`);
    
    try {
        const result = await runDataSyncAction(syncType, eventId, yearToSync);
        if (result && result.success && result.jobId) {
          setActiveJobId(result.jobId);
          addLog(`Job enqueued with ID: ${result.jobId.slice(-8)}`);
          
          return new Promise((resolve, reject) => {
              const checkInterval = setInterval(async () => {
                  try {
                    const res = await fetch(`/api/admin/upload-status/${result.jobId}`);
                    if (!res.ok) return;
                    const data = await res.json();
                    if (data.status === 'completed') {
                        clearInterval(checkInterval);
                        resolve(true);
                    } else if (data.status === 'failed') {
                        clearInterval(checkInterval);
                        reject(new Error(data.message));
                    }
                  } catch (e) {
                      // Silently continue
                  }
              }, 3000);
          });
        } else {
          const msg = result?.message || "Failed to start.";
          addLog(`Failed to start: ${msg}`);
          toast({ variant: 'destructive', title: 'Failed to Start', description: msg });
          throw new Error(msg);
        }
    } catch (e: any) {
        addLog(`Error: ${e.message}`);
    }
  };

  const handleFullSyncSequence = async () => {
      if (!selectedEventId) {
          toast({ variant: 'destructive', title: 'Selection Error', description: 'Select an event for Full Sync.' });
          return;
      }
      
      addLog(`🚀 Starting SEQUENTIAL FULL SYNC for ${selectedEventId}`);
      try {
          await handleSync('participants', selectedEventId);
          await sleep(1200);
          await handleSync('results', selectedEventId);
          await sleep(1200);
          await handleSync('leaderboard', selectedEventId);
          addLog("🏁 FULL SYSTEM SYNC COMPLETED SUCCESSFULLY");
      } catch (e: any) {
          addLog(`🛑 Sequence Halted: ${e.message}`);
      }
  };

  const handleFullRebuild = async () => {
      setIsFullRebuilding(true);
      addLog("Starting GLOBAL SYSTEM REBUILD (Clear Cache)...");
      try {
          const res = await rebuildAllRankingsAction();
          if (res && res.success) {
              addLog("✅ Global Rebuild Complete. Cache cleared.");
              toast({ title: "Global Rebuild Complete", description: res.message });
          } else {
              const errMsg = res?.message || "Internal server error during rebuild.";
              addLog(`❌ Rebuild Failed: ${errMsg}`);
              toast({ variant: 'destructive', title: "Rebuild Failed", description: errMsg });
          }
      } catch (err: any) {
          addLog(`❌ Fatal Error: ${err.message}`);
          toast({ variant: 'destructive', title: "Fatal Error", description: err.message });
      } finally {
          setIsFullRebuilding(false);
      }
  };
  
  const availableYears = useMemo(() => {
    const years = [];
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= 2023; y--) years.push(y.toString());
    return years;
  }, []);

  return (
    <div className="space-y-8 text-left">
      <Card className="border-none shadow-xl">
        <CardHeader className="bg-primary/5 pb-6 text-left">
          <CardTitle className="flex items-center gap-2 text-2xl font-black uppercase italic tracking-tighter text-left">
            <RefreshCw className={cn("h-6 w-6 text-primary", !!activeJobId && "animate-spin")} />
            KV Sync Console
          </CardTitle>
          <CardDescription className="font-medium text-left">
            Safe synchronization with Cloudflare rate protection. Mirrors Firestore data to the edge cache.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8 pt-6 text-left">
          
          <div className="space-y-2 text-left">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 text-left">
                  <Terminal className="h-3 w-3" /> Sync Activity Log
              </Label>
              <ScrollArea className="h-48 rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-xs text-green-500 shadow-inner" ref={scrollAreaRef}>
                  {syncLogs.length === 0 ? (
                      <p className="opacity-40 italic">Waiting for sync command...</p>
                  ) : (
                      <div className="space-y-1">
                          {syncLogs.map((log, i) => (
                              <div key={i} className="flex gap-2 text-left">
                                  <span className="opacity-50 shrink-0">#</span>
                                  <span>{log}</span>
                              </div>
                          ))}
                      </div>
                  )}
                  <ScrollBar orientation="vertical" />
              </ScrollArea>
          </div>

          {jobProgress && (
            <div className="p-6 border-2 border-primary/20 rounded-2xl bg-primary/5 animate-in fade-in slide-in-from-top-4 duration-500 space-y-4 text-left">
                <div className="flex justify-between items-center text-left">
                    <div className="flex items-center gap-3 text-left">
                        {jobProgress.status === 'processing' ? <Loader2 className="h-5 w-5 animate-spin text-primary"/> : jobProgress.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-green-600"/> : <AlertCircle className="h-5 w-5 text-destructive"/>}
                        <h4 className="font-bold text-base text-primary uppercase tracking-tight text-left">
                            {jobProgress.stage || "Syncing..."}
                        </h4>
                    </div>
                    <Badge variant="outline" className="bg-background text-lg font-black h-8 px-3">{Math.round(jobProgress.progress || 0)}%</Badge>
                </div>
                <Progress value={jobProgress.progress || 0} className="h-2.5" />
            </div>
          )}

          <div className="space-y-4 text-left">
              <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 text-left">
                  <Package className="h-4 w-4" /> 1. Event Sync Controls
              </h3>
              <div className="p-6 border rounded-2xl bg-muted/20 space-y-6 text-left">
                  <div className="max-w-md space-y-2 text-left">
                      <Label className="text-xs font-bold uppercase text-left">Target Race Event</Label>
                      <Select onValueChange={setSelectedEventId} disabled={!!activeJobId}>
                          <SelectTrigger className="h-11 rounded-xl bg-background border-none shadow-sm font-bold text-left">
                              <SelectValue placeholder="Select Event to Sync..." />
                          </SelectTrigger>
                          <SelectContent className="text-left">
                              {events.map(e => <SelectItem key={e.id} value={e.id} className="text-left">{e.eventName}</SelectItem>)}
                          </SelectContent>
                      </Select>
                  </div>

                  <div className="flex flex-wrap gap-3 text-left">
                      <Button onClick={() => handleSync('participants', selectedEventId!)} variant="outline" disabled={!!activeJobId || !selectedEventId} className="rounded-xl font-bold uppercase text-xs h-11 px-6 text-left">
                          <Users2 className="mr-2 h-4 w-4" /> Sync Participants
                      </Button>
                      <Button onClick={() => handleSync('results', selectedEventId!)} variant="outline" disabled={!!activeJobId || !selectedEventId} className="rounded-xl font-bold uppercase text-xs h-11 px-6 text-left">
                          <History className="mr-2 h-4 w-4" /> Sync Results
                      </Button>
                      <Button onClick={() => handleSync('leaderboard', selectedEventId!)} variant="outline" disabled={!!activeJobId || !selectedEventId} className="rounded-xl font-bold uppercase text-xs h-11 px-6 text-left">
                          <Trophy className="mr-2 h-4 w-4" /> Sync Leaderboards
                      </Button>
                      <Button onClick={handleFullSyncSequence} disabled={!!activeJobId || !selectedEventId} className="rounded-xl font-black uppercase tracking-widest text-xs h-11 px-10 bg-orange-600 hover:bg-orange-50 shadow-lg shadow-orange-600/20 text-left text-white">
                          <PlayCircle className="mr-2 h-5 w-5" /> Full Event Sync
                      </Button>
                  </div>
              </div>
          </div>

          <Separator className="opacity-50" />

          <div className="space-y-4 text-left">
              <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 text-left">
                  <LayoutGrid className="h-4 w-4" /> 2. Global Sync & Cache Flush
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-left">
                  <SyncSection title="Athlete Rewards" description="Sync seasonal points & tiers." icon={Zap}>
                      <div className="space-y-3 text-left">
                        <Select value={selectedYear} onValueChange={setSelectedYear} disabled={!!activeJobId}>
                            <SelectTrigger className="h-9 rounded-lg text-xs font-bold bg-muted/20 border-none text-left">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="text-left">{availableYears.map(y => <SelectItem key={y} value={y} className="text-left">{y} Season</SelectItem>)}</SelectContent>
                        </Select>
                        <Button variant="secondary" size="sm" onClick={() => handleSync('athleteRankings')} disabled={!!activeJobId} className="w-full font-black text-[9px] uppercase tracking-widest h-9 text-left justify-start bg-primary text-white hover:bg-primary/90 shadow-md">
                            <RefreshCw className={cn("mr-1.5 h-3 w-3", activeJobId === 'athleteRankings' && "animate-spin")}/>
                            Sync Points & Tiers
                        </Button>
                      </div>
                  </SyncSection>

                  <SyncSection title="Global Rankings" description="Rebuild Standings & Legends." icon={BarChart3}>
                      <div className="space-y-3 text-left">
                        <Button variant="outline" size="sm" onClick={() => handleSync('clubRankings')} disabled={!!activeJobId} className="w-full font-bold h-9 text-left justify-start">Sync Clubs</Button>
                        <Button variant="secondary" size="sm" onClick={() => handleSync('legacy')} disabled={!!activeJobId} className="w-full font-black text-[9px] uppercase tracking-widest h-9 text-left justify-start bg-amber-50 text-amber-700 hover:bg-amber-100"><Award className="mr-1.5 h-3 w-3"/>Sync Legacy Athletes</Button>
                      </div>
                  </SyncSection>

                  <SyncSection title="Master Sync" description="Flush stale cache & rebuild." icon={Trash2}>
                      <div className="space-y-3 text-left">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" className="w-full font-black text-[9px] uppercase tracking-widest h-9" disabled={isFullRebuilding}>
                                    {isFullRebuilding ? <Loader2 className="animate-spin mr-1.5 h-3 w-3"/> : <RefreshCw className="mr-1.5 h-3 w-3"/>}
                                    Manual Clear Cache
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="text-left rounded-3xl border-none shadow-2xl">
                                <AlertDialogHeader className="text-left">
                                    <AlertDialogTitle className="text-xl font-black uppercase italic tracking-tighter text-left">Flush Global Cache?</AlertDialogTitle>
                                    <AlertDialogDescription className="text-sm font-medium leading-relaxed text-left">
                                        This will completely wipe and regenerate every ranking, event index, and result key in the Cloudflare KV store. 
                                        Use this to resolve &quot;ghost&quot; registrations or stale leaderboards.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter className="text-left pt-4">
                                    <AlertDialogCancel className="rounded-xl font-bold uppercase text-xs">Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleFullRebuild} className="bg-destructive hover:bg-destructive/90 rounded-xl font-black uppercase tracking-widest text-xs h-11 px-8">
                                        Confirm Rebuild
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                        <p className="text-[8px] text-muted-foreground text-center uppercase">Fixes ghost entries</p>
                      </div>
                  </SyncSection>

                  <SyncSection title="Metadata Mirror" description="Site-wide support data." icon={Building}>
                      <div className="space-y-2 text-left">
                        <Button variant="outline" size="sm" onClick={() => handleSync('calendar')} disabled={!!activeJobId} className="w-full font-bold h-9 text-left justify-start">Sync Site Metadata</Button>
                        <Button variant="outline" size="sm" onClick={() => handleSync('coupons')} disabled={!!activeJobId} className="w-full font-bold h-9 flex items-center gap-2 text-left justify-start"><TicketPercent className="h-3 w-3"/>Sync Coupons</Button>
                      </div>
                  </SyncSection>
              </div>
          </div>
        </CardContent>
        <CardFooter className="bg-muted/30 border-t py-4 justify-between text-left">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 text-left">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                KV Cache Integrity Verified
            </p>
            <div className="flex gap-2 text-left">
                <Button variant="link" size="sm" asChild className="text-xs font-bold text-primary text-left">
                    <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer">Cloudflare Dashboard <ExternalLinkIcon className="ml-1.5 h-3 w-3"/></a>
                </Button>
            </div>
        </CardFooter>
      </Card>
    </div>
  );
}
