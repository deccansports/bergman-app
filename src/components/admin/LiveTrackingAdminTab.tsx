
// src/components/admin/LiveTrackingAdminTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue,
  SelectGroup,
  SelectLabel
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { 
  Loader2, Satellite, TestTube2, RefreshCw, AlertTriangle, Save, Trash2, Download, Search, 
  Link as LinkIcon, Upload, Waves, Bike, Footprints, 
  Map as MapIcon, PlusCircle, Route, Copy, Hourglass, Database, FileText, CheckCircle2,
  XCircle
} from 'lucide-react';
import type { EventCalendarEntry, LiveTimingConfig, TicketDefinition, RaceResult, Status, Leg, Split, LiveAthlete } from '@/lib/types';
import {
  updateCalendarEventAction,
  testTimingPartnerApiAction,
  getPublicFinalResultsAction,
  updateTicketDefinitionAction,
  cloneTicketDataAction,
  deleteRaceResultsForEventAction
} from '@/lib/actions';
import { getDebugDataForBibAction } from '@/lib/actions/ingestActions';
import { format, parseISO } from 'date-fns';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import CourseMapDialog from '@/components/events/CourseMapDialog';
import { normalizeStatus, cn, isDuathlonEvent } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Form } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { Textarea } from '@/components/ui/textarea';

export interface LiveTrackingAdminTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

type BulkUploadStatus = 'idle' | 'uploading' | 'processing' | 'completed' | 'failed';
interface BulkUploadResult {
  row: number; bib: string; name: string; status: 'success' | 'error' | 'warning'; detail: string;
}

export default function LiveTrackingAdminTab({ events, isLoadingEvents, onDataRefresh }: LiveTrackingAdminTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [liveDataSource, setLiveDataSource] = useState<EventCalendarEntry['liveDataSource']>('none');
  const [liveTimingConfig, setLiveTimingConfig] = useState<LiveTimingConfig>({ apiUrl: '', apiKey: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [testBib, setTestBib] = useState('');
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [testApiResult, setTestApiResult] = useState<{ success: boolean; message: string; data?: any } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [showHomepageCard, setShowHomepageCard] = useState(false);
  
  const [raceDataFile, setRaceDataFile] = useState<File | null>(null);
  const [bulkUploadStatus, setBulkUploadStatus] = useState<BulkUploadStatus>('idle');
  const [bulkUploadProgress, setBulkUploadProgress] = useState(0);
  const [bulkUploadResults, setBulkUploadResults] = useState<BulkUploadResult[]>([]);
  const raceDataInputRef = useRef<HTMLInputElement>(null);
  
  const [ticketData, setTicketData] = useState<Record<string, Partial<TicketDefinition>>>({});
  const [isSavingTicket, setIsSavingTicket] = useState<string | null>(null);

  const [isCourseMapModalOpen, setIsCourseMapModalOpen] = useState(false);
  const [courseMapTicketId, setCourseMapTicketId] = useState<string | null>(null);

  const [finalResults, setFinalResults] = useState<RaceResult[]>([]);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false);
  const [isDeletingResults, setIsDeletingResults] = useState(false);
  
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [cloneTargetTicketId, setCloneTargetTicketId] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [sourceEventId, setSourceEventId] = useState<string | null>(null);

  const [debugData, setDebugData] = useState<{ rawReads?: any[], liveAthlete?: LiveAthlete | null } | null>(null);
  const [isLoadingDebugData, setIsLoadingDebugData] = useState(false);

  const form = useForm();

  const selectedEvent = useMemo(() => events.find((e: EventCalendarEntry) => e.id === selectedEventId), [events, selectedEventId]);

  const fetchEventData = useCallback(async (eventId: string) => {
    setIsLoadingParticipants(true);
    try {
      const results = await getPublicFinalResultsAction(eventId, null);
      if (results.success && results.participants) {
        setFinalResults(results.participants);
      } else {
        setFinalResults([]);
      }
    } catch (e: any) {
      setFinalResults([]);
    } finally {
      setIsLoadingParticipants(false);
    }
  }, []);

  useEffect(() => {
    if (selectedEventId) {
      const event = events.find((e: EventCalendarEntry) => e.id === selectedEventId);
      if (event) {
        setLiveDataSource(event.liveDataSource || 'none');
        setLiveTimingConfig(event.liveTimingConfig || { apiUrl: '', apiKey: '' });
        const initialTicketData: Record<string, Partial<TicketDefinition>> = {};
        if (event.ticketDefinitions) {
          event.ticketDefinitions.forEach((td: TicketDefinition) => {
              initialTicketData[td.id] = { ...td };
          });
        }
        setTicketData(initialTicketData);
        fetchEventData(selectedEventId);
      }
    }
  }, [selectedEventId, events, fetchEventData]);

  useEffect(() => {
    if (jobId) {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/admin/upload-status/${jobId}`);
          if (res.ok) {
            const data = await res.json();
            setJobStatus(data);
             if (data.results) setBulkUploadResults(data.results);
             if (data.progress) setBulkUploadProgress(data.progress);
            if (data.status === 'completed' || data.status === 'failed') {
              clearInterval(interval);
              setBulkUploadStatus(data.status);
              if(data.status === 'completed') {
                onDataRefresh();
                if(selectedEventId) fetchEventData(selectedEventId);
              }
              toast({ title: `Job ${data.status}`, description: data.message });
            }
          }
        } catch (e) { console.error("Failed to poll job status", e); }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [jobId, toast, onDataRefresh, selectedEventId, fetchEventData]);

  const raceStats = useMemo(() => {
    const total = finalResults.length;
    if (total === 0) return { total: 0, finished: 0, dnf: 0, dns: 0, dnq: 0 };
    const finished = finalResults.filter(p => normalizeStatus(p.status) === 'Finished').length;
    const dnf = finalResults.filter(p => normalizeStatus(p.status) === 'DNF').length;
    const dns = finalResults.filter(p => normalizeStatus(p.status) === 'DNS').length;
    const dnq = finalResults.filter(p => normalizeStatus(p.status) === 'DNQ').length;
    return { total, finished, dnf, dns, dnq };
  }, [finalResults]);

  const handleSaveSettings = async () => {
    if (!selectedEventId) return;
    setIsSaving(true);
    const payload: { [key: string]: any } = { liveDataSource };
    if (liveDataSource === 'timing_partner') {
        payload.liveTimingConfig = liveTimingConfig;
    } else {
        payload.deleteLiveTimingConfig = true;
    }
    const result = await updateCalendarEventAction(selectedEventId, payload);
    if(result.success) {
      toast({ title: 'Settings Saved', description: 'Live tracking settings have been updated.' });
      onDataRefresh();
    } else {
      toast({ variant: 'destructive', title: 'Save Failed', description: result.message });
    }
    setIsSaving(false);
  };
  
  const handleTestApi = async () => {
    if (!testBib) { toast({ variant: 'destructive', title: 'Input Error', description: 'Please enter a BIB number to test.' }); return; }
    setIsTestingApi(true); setTestApiResult(null); setDebugData(null);
    const result = await testTimingPartnerApiAction(liveTimingConfig.apiUrl!, testBib, selectedEventId);
    setTestApiResult(result);
    setIsTestingApi(false);
  };
  
  const handleFetchDebugData = async () => {
      if (!testBib || !selectedEventId) { toast({ variant: 'destructive', title: 'Input Error', description: 'Please enter an event and BIB number.' }); return; }
      setIsLoadingDebugData(true);
      setDebugData(null);
      const result = await getDebugDataForBibAction(selectedEventId, testBib);
      if(result.success) {
          setDebugData({ rawReads: result.rawReads, liveAthlete: result.liveAthlete });
      } else {
          toast({ variant: 'destructive', title: 'Fetch Error', description: result.message });
      }
      setIsLoadingDebugData(false);
  };

  const handleBulkUpload = async () => {
    if (!raceDataFile || !selectedEventId) {
      toast({ variant: "destructive", title: "Error", description: "Event and File are required." });
      return;
    }
    setBulkUploadStatus('uploading'); setBulkUploadProgress(0); setBulkUploadResults([]);
    const formData = new FormData();
    formData.append('raceDataFile', raceDataFile);
    formData.append('eventId', selectedEventId);

    try {
      const response = await fetch('/api/admin/bulk-upload-final-results', { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Failed to start upload job.");
      setBulkUploadStatus('processing');
      setJobId(result.jobId);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Upload Error", description: err.message });
      setBulkUploadStatus('failed');
    }
  };

  const handleDeleteResults = async () => {
    if (!selectedEventId) return;
    setIsDeletingResults(true);
    try {
        const result = await deleteRaceResultsForEventAction(selectedEventId);
        toast({ title: result.success ? 'Success' : 'Error', description: result.message, variant: result.success ? 'default' : 'destructive' });
        if (result.success) fetchEventData(selectedEventId);
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Error', description: `Failed to delete results: ${e.message}` });
    }
    setIsDeletingResults(false);
  };

  const handleSaveTicketSettings = async (ticketId: string) => {
    if (!selectedEventId || !ticketData[ticketId]) return;
    setIsSavingTicket(ticketId);
    const result = await updateTicketDefinitionAction(selectedEventId, ticketId, ticketData[ticketId] as TicketDefinition);
    if(result.success) {
        toast({ title: 'Success', description: 'Ticket settings saved.' });
        onDataRefresh();
    } else {
        toast({ variant: 'destructive', title: 'Save Failed', description: result.message });
    }
    setIsSavingTicket(null);
  };
  
  const handleTicketDataChange = (ticketId: string, field: string, value: any) => {
    setTicketData(prev => {
        const newTicketData = { ...prev };
        const ticket = { ...newTicketData[ticketId] };
        const fieldParts = field.split('.');
        if (fieldParts.length > 1) {
            let currentLevel: any = ticket;
            for (let i = 0; i < fieldParts.length - 1; i++) {
                if (!currentLevel[fieldParts[i]]) { currentLevel[fieldParts[i]] = {}; }
                currentLevel = currentLevel[fieldParts[i]];
            }
            currentLevel[fieldParts[fieldParts.length - 1]] = value;
        } else {
            (ticket as any)[field] = value;
        }
        newTicketData[ticketId] = ticket;
        return newTicketData;
    });
  };

  const handleCloneTicketData = async (sourceTicketId: string) => {
      if (!sourceEventId || !cloneTargetTicketId || !selectedEventId) return;
      setIsCloning(true);
      const result = await cloneTicketDataAction(sourceEventId, sourceTicketId, selectedEventId, cloneTargetTicketId);
      if (result.success) {
          toast({ title: 'Success', description: 'Data cloned successfully.' });
          onDataRefresh();
          setIsCloneModalOpen(false);
          setCloneTargetTicketId(null);
      } else {
          toast({ variant: 'destructive', title: 'Clone Failed', description: result.message });
      }
      setIsCloning(false);
  };

  const openCourseMapModal = (ticketId: string) => {
    setCourseMapTicketId(ticketId);
    setIsCourseMapModalOpen(true);
  };

  return (
    <div className="space-y-6 text-left">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Satellite className="h-5 w-5 text-primary"/>Live Tracking & Results Setup</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
             <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents} value={selectedEventId || ''}>
              <SelectTrigger className="w-full sm:w-[300px]"><SelectValue placeholder="Select an Event..." /></SelectTrigger>
              <SelectContent>{events.map((e: EventCalendarEntry) => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}</SelectContent>
            </Select>
             {selectedEventId && (
                <div className="flex items-center space-x-2 shrink-0">
                    <Switch id="show-homepage-card" checked={showHomepageCard} onCheckedChange={setShowHomepageCard} />
                    <Label htmlFor="show-homepage-card" className="text-sm font-medium">Show on Homepage</Label>
                    <Button variant="outline" size="sm" asChild><Link href={`/tracking/${selectedEvent?.id}`} target="_blank"><LinkIcon className="h-4 w-4"/></Link></Button>
                </div>
             )}
         </div>
            {selectedEventId && (
                <div className="space-y-6 mt-4">
                    <Card>
                       <CardHeader><CardTitle className="text-lg">Step 1: Live Data Source</CardTitle></CardHeader>
                       <CardContent>
                           <RadioGroup value={liveDataSource || 'none'} onValueChange={v => setLiveDataSource(v as any)} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                               {[
                                   { id: 'participants', label: 'From Registrations', desc: 'Manual volunteer entry' },
                                   { id: 'timing_partner', label: 'From Timing Partner', desc: 'Real-time RFID integration' },
                                   { id: 'race_results', label: 'From Final Results', desc: 'Static post-race data' },
                                   { id: 'none', label: 'Disable Tracking', desc: 'No live visibility' }
                               ].map(opt => (
                                   <Label key={opt.id} className={cn(
                                       "flex flex-col p-4 border-2 rounded-2xl cursor-pointer transition-all h-full",
                                       liveDataSource === opt.id ? "bg-primary border-primary text-white" : "bg-background border-muted hover:border-primary/30"
                                   )}>
                                       <div className="flex items-center justify-between mb-2">
                                           <span className="font-black uppercase tracking-tight text-sm">{opt.label}</span>
                                           <RadioGroupItem value={opt.id} className="sr-only" />
                                           {liveDataSource === opt.id && <CheckCircle2 className="h-4 w-4" />}
                                       </div>
                                       <p className={cn("text-[10px] uppercase font-bold", liveDataSource === opt.id ? "text-white/80" : "text-muted-foreground")}>{opt.desc}</p>
                                   </Label>
                               ))}
                           </RadioGroup>
                       </CardContent>
                       <CardFooter><Button onClick={handleSaveSettings} disabled={isSaving}>{isSaving && <Loader2 className="animate-spin mr-2 h-4 w-4"/>}Save Data Source</Button></CardFooter>
                    </Card>

                    {liveDataSource === 'timing_partner' && (
                       <Card>
                         <CardHeader><CardTitle className="text-lg">Step 2: Configure Timing Partner API</CardTitle></CardHeader>
                         <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1.5"><Label>API URL</Label><Input placeholder="https://api.timingpartner.com/results" value={liveTimingConfig.apiUrl || ''} onChange={e => setLiveTimingConfig(c => ({...c, apiUrl: e.target.value}))}/></div>
                                <div className="space-y-1.5"><Label>API Key (Optional)</Label><Input placeholder="Bearer token if required" value={liveTimingConfig.apiKey || ''} onChange={e => setLiveTimingConfig(c => ({...c, apiKey: e.target.value}))}/></div>
                            </div>
                         </CardContent>
                          <CardFooter className="flex justify-between flex-wrap gap-2">
                             <div className="flex gap-2">
                                <Input placeholder="Test BIB..." value={testBib} onChange={e => setTestBib(e.target.value)} className="w-28"/>
                                <Button onClick={handleTestApi} disabled={isTestingApi || !testBib}>{isTestingApi ? <Loader2 className="animate-spin h-4 w-4"/> : <TestTube2 className="h-4 w-4"/>} Test</Button>
                                <Button variant="outline" onClick={handleFetchDebugData} disabled={isLoadingDebugData || !testBib}>{isLoadingDebugData ? <Loader2 className="animate-spin h-4 w-4"/> : <Database className="h-4 w-4"/>} Debug</Button>
                            </div>
                         </CardFooter>
                          {testApiResult && <CardContent><Alert variant={testApiResult.success ? "default" : "destructive"}><AlertTitle>{testApiResult.success ? 'Success' : 'Failed'}</AlertTitle><AlertDescription>{testApiResult.message}</AlertDescription></Alert></CardContent>}
                       </Card>
                    )}
                    
                    <Card><CardHeader><CardTitle className="text-lg">Step 3: Upload Final Results</CardTitle></CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-center">
                                <Card className="bg-muted/30 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-2xl font-black">{raceStats.total}</CardTitle><CardDescription className="text-[10px] font-bold uppercase">Field Size</CardDescription></CardHeader></Card>
                                <Card className="bg-green-50 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-2xl font-black text-green-700">{raceStats.finished}</CardTitle><CardDescription className="text-[10px] font-bold uppercase text-green-600">Finished ({raceStats.total > 0 ? Math.round(raceStats.finished/raceStats.total*100) : 0}%)</CardDescription></CardHeader></Card>
                                <Card className="bg-red-50 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-2xl font-black text-red-700">{raceStats.dnf}</CardTitle><CardDescription className="text-[10px] font-bold uppercase text-red-600">DNF</CardDescription></CardHeader></Card>
                                <Card className="bg-yellow-50 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-2xl font-black text-yellow-700">{raceStats.dns}</CardTitle><CardDescription className="text-[10px] font-bold uppercase text-yellow-600">DNS</CardDescription></CardHeader></Card>
                                <Card className="bg-orange-50 border-none shadow-sm"><CardHeader className="p-3"><CardTitle className="text-2xl font-black text-orange-700">{raceStats.dnq}</CardTitle><CardDescription className="text-[10px] font-bold uppercase text-orange-600">DNQ</CardDescription></CardHeader></Card>
                            </div>
                            <Separator />
                            <div className="flex flex-wrap gap-3 items-end">
                              <div className="space-y-1.5"><Label className="text-xs uppercase font-black text-muted-foreground">Select Spreadsheet</Label><Input id="race-data-file" type="file" ref={raceDataInputRef} onChange={(e) => setRaceDataFile(e.target.files?.[0] || null)} accept=".csv, .xlsx" className="max-w-xs" /></div>
                              <Button onClick={handleBulkUpload} disabled={bulkUploadStatus === 'processing' || !raceDataFile}>{bulkUploadStatus === 'processing' ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <Upload className="mr-2 h-4 w-4"/>} Process Results</Button>
                              <Button variant="outline" asChild><a href="/templates/final_results_template.xlsx" download><Download className="mr-2 h-4 w-4"/> Template</a></Button>
                            </div>
                            {bulkUploadStatus !== 'idle' && (
                              <div className="space-y-3 p-4 border rounded-2xl bg-muted/10">
                                <div className="flex justify-between items-center text-xs font-bold uppercase"><span>Status: {bulkUploadStatus}</span><span>{Math.round(bulkUploadProgress)}%</span></div>
                                <Progress value={bulkUploadProgress} className="h-2" />
                                {bulkUploadResults.length > 0 && (
                                  <ScrollArea className="h-32 rounded-lg border bg-background p-2 text-[10px] space-y-1">
                                    {bulkUploadResults.map((r: BulkUploadResult)=>(<p key={r.row} className={r.status==='error'?'text-red-500':''}>[{r.status.toUpperCase()}] Row {r.row}: {r.detail}</p>))}
                                  </ScrollArea>
                                )}
                              </div>
                            )}
                        </CardContent>
                        <CardFooter className="bg-red-50/50 border-t border-red-100 flex justify-between items-center py-4">
                            <div className="flex items-center gap-2 text-red-700">
                                <AlertTriangle className="h-4 w-4" />
                                <span className="text-[10px] font-black uppercase tracking-widest">Dangerous Area</span>
                            </div>
                            <AlertDialog>
                                <AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={isDeletingResults || finalResults.length === 0}><Trash2 className="h-4 w-4 mr-2" /> Wipe Result Data</Button></AlertDialogTrigger>
                                <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm Data Wipe?</AlertDialogTitle><AlertDialogDescription>This will permanently delete all {finalResults.length} race results for &quot;{selectedEvent?.eventName}&quot;. STANDINGS WILL BE LOST.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteResults} className="bg-destructive">Confirm Wipe</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                            </AlertDialog>
                        </CardFooter>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Step 4: Define Course Maps, Splits & Distances</CardTitle>
                        <CardDescription>Assign GPX routes, segment lengths, and descriptive details for each race category.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <Form {...form}>
                          <div className="space-y-6">
                            {selectedEvent?.ticketDefinitions?.map((ticket: TicketDefinition) => {
                                const data = ticketData[ticket.id] || {};
                                const isTri = data.ticketCategory === 'Triathlon';
                                const isDua = isDuathlonEvent(data.ticketName);
                                const isSwim = data.ticketCategory === 'Swimming';
                                
                                return (
                                <Card key={ticket.id} className="border-2 border-muted overflow-hidden">
                                    <CardHeader className="bg-muted/30 p-4 flex flex-row justify-between items-center">
                                        <CardTitle className="text-base font-black uppercase italic tracking-tight">{ticket.ticketName}</CardTitle>
                                        <div className="flex gap-2">
                                            <Button variant="outline" size="xs" onClick={()=> openCourseMapModal(ticket.id)}><MapIcon className="h-3.5 w-3.5 mr-1.5"/>View Map</Button>
                                            <Button variant="ghost" size="xs" onClick={() => { setSourceEventId(null); setCloneTargetTicketId(ticket.id); setIsCloneModalOpen(true); }}><Copy className="h-3.5 w-3.5"/></Button>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="p-4 space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase">Category Type</Label>
                                                <Select value={data.ticketCategory || ''} onValueChange={v => handleTicketDataChange(ticket.id, 'ticketCategory', v)}>
                                                    <SelectTrigger className="h-9"><SelectValue placeholder="Select type..."/></SelectTrigger>
                                                    <SelectContent><SelectItem value="Triathlon">Triathlon</SelectItem><SelectItem value="Duathlon">Duathlon</SelectItem><SelectItem value="Swimming">Swimathon</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        {data.ticketCategory && (
                                            <div className="space-y-8 animate-in fade-in duration-500">
                                                <div className="space-y-3">
                                                    <h4 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                                        <Route className="h-4 w-4" /> 1. Segment Distances (KM)
                                                    </h4>
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                        {(isTri || isSwim) && <div className="space-y-1"><Label className="text-[10px] uppercase text-muted-foreground">Swim Dist</Label><Input type="number" step="0.1" value={(data.courseMaps as any)?.swimDistance ?? ''} onChange={e => handleTicketDataChange(ticket.id, 'courseMaps.swimDistance', Number(e.target.value))} /></div>}
                                                        {isDua && <div className="space-y-1"><Label className="text-[10px] uppercase text-muted-foreground">Run 1 Dist</Label><Input type="number" step="0.1" value={(data.courseMaps as any)?.run1Distance ?? ''} onChange={e => handleTicketDataChange(ticket.id, 'courseMaps.run1Distance', Number(e.target.value))} /></div>}
                                                        {(isTri || isDua) && <div className="space-y-1"><Label className="text-[10px] uppercase text-muted-foreground">Bike Dist</Label><Input type="number" step="0.1" value={(data.courseMaps as any)?.bikeDistance ?? ''} onChange={e => handleTicketDataChange(ticket.id, 'courseMaps.bikeDistance', Number(e.target.value))} /></div>}
                                                        {(isTri || isDua) && <div className="space-y-1"><Label className="text-[10px] uppercase text-muted-foreground">{isDua ? 'Run 2' : 'Run'} Dist</Label><Input type="number" step="0.1" value={(data.courseMaps as any)?.[isDua ? 'run2Distance' : 'runDistance'] ?? ''} onChange={e => handleTicketDataChange(ticket.id, `courseMaps.${isDua ? 'run2Distance' : 'runDistance'}`, Number(e.target.value))}/></div>}
                                                    </div>
                                                </div>

                                                <div className="space-y-4">
                                                    <h4 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                                        <FileText className="h-4 w-4" /> 2. Map Assets & Segment Descriptions
                                                    </h4>
                                                    <div className="grid grid-cols-1 gap-6">
                                                        {(isTri || isSwim) && (
                                                            <div className="space-y-2 p-4 border rounded-xl bg-muted/10">
                                                                <div className="flex items-center gap-2 text-sky-600 font-black text-[10px] uppercase mb-2"><Waves className="h-3 w-3"/> Swim Segment</div>
                                                                <Input placeholder="Swim GPX URL" value={(data.courseMaps as any)?.swimGpxUrl || ''} onChange={e => handleTicketDataChange(ticket.id, 'courseMaps.swimGpxUrl', e.target.value)} className="mb-2"/>
                                                                <Textarea placeholder="Describe the swim course..." value={(data.courseMaps as any)?.swimDescription || ''} onChange={e => handleTicketDataChange(ticket.id, 'courseMaps.swimDescription', e.target.value)} rows={3} className="text-xs" />
                                                            </div>
                                                        )}
                                                        {(isTri || isDua) && (
                                                            <div className="space-y-2 p-4 border rounded-xl bg-muted/10">
                                                                <div className="flex items-center gap-2 text-green-600 font-black text-[10px] uppercase mb-2"><Bike className="h-3 w-3"/> Bike Segment</div>
                                                                <Input placeholder="Bike GPX URL" value={(data.courseMaps as any)?.bikeGpxUrl || ''} onChange={e => handleTicketDataChange(ticket.id, 'courseMaps.bikeGpxUrl', e.target.value)} className="mb-2"/>
                                                                <Textarea placeholder="Describe the bike course..." value={(data.courseMaps as any)?.bikeDescription || ''} onChange={e => handleTicketDataChange(ticket.id, 'courseMaps.bikeDescription', e.target.value)} rows={3} className="text-xs" />
                                                            </div>
                                                        )}
                                                        {isDua && (
                                                            <div className="space-y-2 p-4 border rounded-xl bg-muted/10">
                                                                <div className="flex items-center gap-2 text-orange-600 font-black text-[10px] uppercase mb-2"><Footprints className="h-3 w-3"/> Run 1 Segment</div>
                                                                <Input placeholder="Run 1 GPX URL" value={(data.courseMaps as any)?.run1GpxUrl || ''} onChange={e => handleTicketDataChange(ticket.id, 'courseMaps.run1GpxUrl', e.target.value)} className="mb-2"/>
                                                                <Textarea placeholder="Describe the first run leg..." value={(data.courseMaps as any)?.run1Description || ''} onChange={e => handleTicketDataChange(ticket.id, 'courseMaps.run1Description', e.target.value)} rows={3} className="text-xs" />
                                                            </div>
                                                        )}
                                                        {(isTri || isDua) && (
                                                            <div className="space-y-2 p-4 border rounded-xl bg-muted/10">
                                                                <div className="flex items-center gap-2 text-orange-600 font-black text-[10px] uppercase mb-2"><Footprints className="h-3 w-3"/> {isDua ? 'Run 2' : 'Run'} Segment</div>
                                                                <Input placeholder="Run GPX URL" value={(data.courseMaps as any)?.[isDua ? 'run2GpxUrl' : 'runGpxUrl'] || ''} onChange={e => handleTicketDataChange(ticket.id, `courseMaps.${isDua ? 'run2GpxUrl' : 'runGpxUrl'}`, e.target.value)} className="mb-2"/>
                                                                <Textarea placeholder="Describe the final run leg..." value={(data.courseMaps as any)?.[isDua ? 'run2Description' : 'runDescription'] || ''} onChange={e => handleTicketDataChange(ticket.id, `courseMaps.${isDua ? 'run2Description' : 'runDescription'}`, e.target.value)} rows={3} className="text-xs" />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                    <CardFooter className="bg-muted/20 border-t flex justify-end p-3"><Button size="sm" onClick={() => handleSaveTicketSettings(ticket.id)} disabled={isSavingTicket === ticket.id}>{isSavingTicket === ticket.id ? <Loader2 className="animate-spin h-4 w-4 mr-2"/> : <Save className="h-4 w-4 mr-2"/>}Save Ticket Settings</Button></CardFooter>
                                </Card>
                            )})}
                          </div>
                        </Form>
                      </CardContent>
                    </Card>
                </div>
            )}
        </CardContent>
      </Card>
      
      {selectedEvent && courseMapTicketId && (<CourseMapDialog event={selectedEvent} isOpen={isCourseMapModalOpen} onClose={() => setIsCourseMapModalOpen(false)} ticketId={courseMapTicketId} />)}
      
       <Dialog open={isCloneModalOpen} onOpenChange={setIsCloneModalOpen}>
        <DialogContent className="text-left">
            <DialogHeader><DialogTitle className="text-left">Clone Map Config</DialogTitle><DialogDescription className="text-left">Copy GPX and distance data from another event category.</DialogDescription></DialogHeader>
            <div className="py-4 space-y-4 text-left">
                <div className="space-y-1"><Label className="text-xs">Source Event</Label>
                  <Select onValueChange={setSourceEventId}>
                    <SelectTrigger><SelectValue placeholder="Select Source Event..." /></SelectTrigger>
                    <SelectContent>{events.map((e: EventCalendarEntry) => ( e.id !== selectedEventId && <SelectItem key={`clone-e-${e.id}`} value={e.id}>{e.eventName}</SelectItem> ))}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Source Ticket</Label>
                  <Select onValueChange={(val) => handleCloneTicketData(val)} disabled={!sourceEventId}>
                    <SelectTrigger><SelectValue placeholder="Select Source Ticket..." /></SelectTrigger>
                    <SelectContent>{(events.find((e: EventCalendarEntry) => e.id === sourceEventId)?.ticketDefinitions || []).map((t: TicketDefinition) => ( <SelectItem key={`clone-t-${t.id}`} value={t.id}>{t.ticketName}</SelectItem> ))}</SelectContent>
                  </Select>
                </div>
            </div>
            <DialogFooter className="text-left"><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
