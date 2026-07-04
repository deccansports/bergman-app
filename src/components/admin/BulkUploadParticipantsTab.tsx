// src/components/admin/BulkUploadParticipantsTab.tsx
"use client";

import React, { useState, useRef, useMemo } from 'react';
import type { EventCalendarEntry, TicketDefinition, SwimDistanceCategory } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, Upload } from 'lucide-react';

interface BulkUploadParticipantsTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

type BulkUploadStatus = 'idle' | 'uploading' | 'processing' | 'completed' | 'failed';
interface BulkUploadResult {
  row: number;
  email: string;
  name: string;
  status: 'success' | 'error' | 'warning';
  detail: string;
}

export default function BulkUploadParticipantsTab({ events, isLoadingEvents, onDataRefresh }: BulkUploadParticipantsTabProps) {
  const { toast } = useToast();
  const [bulkUploadFile, setBulkUploadFile] = useState<File | null>(null);
  const [bulkUploadStatus, setBulkUploadStatus] = useState<BulkUploadStatus>('idle');
  const [bulkUploadProgress, setBulkUploadProgress] = useState(0);
  const [bulkUploadResults, setBulkUploadResults] = useState<BulkUploadResult[]>([]);
  const [bulkUploadFinalMessage, setBulkUploadFinalMessage] = useState<string | null>(null);
  const bulkUploadInputRef = useRef<HTMLInputElement>(null);
  const [sendConfirmation, setSendConfirmation] = useState(false);
  const [bulkUploadEventId, setBulkUploadEventId] = useState<string | null>(null);
  const [bulkUploadAssignedTicketId, setBulkUploadAssignedTicketId] = useState<string | null>(null);
  const [bulkUploadAssignedSubCategoryId, setBulkUploadAssignedSubCategoryId] = useState<string | null>(null);

  const selectedEvent = useMemo(() => events.find(e => e.id === bulkUploadEventId), [events, bulkUploadEventId]);
  
  const selectedTicket = useMemo(() => 
    selectedEvent?.ticketDefinitions?.find(t => t.id === bulkUploadAssignedTicketId),
  [selectedEvent, bulkUploadAssignedTicketId]);

  const subCategories = useMemo(() => 
    selectedTicket?.subCategories || [], 
  [selectedTicket]);

  const handleBulkUpload = async () => {
    if (!bulkUploadFile || !bulkUploadEventId || !bulkUploadAssignedTicketId) {
        toast({ variant: "destructive", title: "Error", description: "Event, Ticket, and File are required." });
        return;
    }

    if (subCategories.length > 0 && !bulkUploadAssignedSubCategoryId) {
        toast({ variant: "destructive", title: "Selection Error", description: "This ticket has sub-categories. Please select one (e.g. Distance)." });
        return;
    }

    setBulkUploadStatus('uploading');
    setBulkUploadProgress(0);
    setBulkUploadResults([]);
    setBulkUploadFinalMessage(null);
    
    const formData = new FormData();
    formData.append('participantSheet', bulkUploadFile);
    formData.append('eventId', bulkUploadEventId);
    formData.append('assignedTicketId', bulkUploadAssignedTicketId);
    if (bulkUploadAssignedSubCategoryId) {
        formData.append('assignedSubCategoryId', bulkUploadAssignedSubCategoryId);
    }
    formData.append('sendConfirmations', String(sendConfirmation));

    try {
        const response = await fetch('/api/admin/bulk-upload-participants', { method: 'POST', body: formData });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Failed to start upload job.");
        
        setBulkUploadStatus('processing');
        const jobId = result.jobId;

        const intervalId = setInterval(async () => {
            try {
                const statusRes = await fetch(`/api/admin/upload-status/${jobId}`);
                if (!statusRes.ok) {
                    clearInterval(intervalId);
                    setBulkUploadStatus('failed');
                    setBulkUploadFinalMessage('Failed to get job status.');
                    return;
                }

                const jobData = await statusRes.json();
                setBulkUploadProgress(jobData.progress || 0);
                setBulkUploadResults(jobData.results || []);

                if (jobData.status === 'completed' || jobData.status === 'failed') {
                    clearInterval(intervalId);
                    setBulkUploadStatus(jobData.status);
                    setBulkUploadFinalMessage(jobData.message || 'Processing finished.');
                    if (jobData.status === 'completed') {
                        onDataRefresh();
                    }
                }
            } catch {
                clearInterval(intervalId);
                setBulkUploadStatus('failed');
                setBulkUploadFinalMessage('Error while checking upload status.');
            }
        }, 2000);

    } catch (err: any) {
        toast({ variant: "destructive", title: "Processing Error", description: `An error occurred: ${err.message}` });
        setBulkUploadStatus('failed');
    }
  };
  
  return (
    <Card>
        <CardHeader className="text-left">
            <CardTitle>Bulk Upload Participants</CardTitle>
            <CardDescription>
                Upload a CSV/Excel file. Existing participants (by email for the event) will be updated. New participants will be created.
                <Button variant="link" asChild className="p-0 h-auto ml-1 text-xs"><a href="/templates/participants_template.xlsx" download>Download Template</a></Button>
            </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-left">
             {bulkUploadStatus === 'idle' ? (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end text-left">
                        <div className="space-y-1.5 text-left">
                            <label className="text-sm font-medium">1. Select Event for Upload</label>
                            <Select onValueChange={(value) => { setBulkUploadEventId(value); setBulkUploadAssignedTicketId(null); setBulkUploadAssignedSubCategoryId(null); }} disabled={isLoadingEvents}>
                                <SelectTrigger><SelectValue placeholder="Select Event"/></SelectTrigger>
                                <SelectContent>{events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5 text-left">
                            <label className="text-sm font-medium">2. Assign Ticket Type</label>
                            <Select onValueChange={(val) => { setBulkUploadAssignedTicketId(val); setBulkUploadAssignedSubCategoryId(null); }} disabled={!bulkUploadEventId}>
                                <SelectTrigger><SelectValue placeholder="Assign all to ticket..."/></SelectTrigger>
                                <SelectContent>{selectedEvent?.ticketDefinitions?.map(t=>(<SelectItem key={t.id} value={t.id}>{t.ticketName}</SelectItem>))}</SelectContent>
                            </Select>
                        </div>
                        {subCategories.length > 0 && (
                            <div className="space-y-1.5 animate-in slide-in-from-top-1 duration-200 text-left">
                                <label className="text-sm font-medium">3. Assign Sub-Category</label>
                                <Select onValueChange={setBulkUploadAssignedSubCategoryId} value={bulkUploadAssignedSubCategoryId || ""}>
                                    <SelectTrigger><SelectValue placeholder="Select sub-category..."/></SelectTrigger>
                                    <SelectContent>
                                        {subCategories.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end text-left">
                         <div className="space-y-1.5 text-left">
                            <label htmlFor="bulk-upload-file" className="text-sm font-medium">4. Select File</label>
                            <Input id="bulk-upload-file" type="file" ref={bulkUploadInputRef} onChange={(e) => setBulkUploadFile(e.target.files?.[0] || null)} accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" />
                        </div>
                         <div className="flex items-center space-x-2 pt-6 text-left">
                            <Checkbox id="sendBulkConfirm" checked={sendConfirmation} onCheckedChange={(c) => setSendConfirmation(!!c)}/>
                            <label htmlFor="sendBulkConfirm" className="text-sm font-normal">Send confirmation notifications</label>
                        </div>
                    </div>
                </div>
            ) : (
                 <div className="mt-2 space-y-2 flex-grow min-h-0 text-left">
                     <h4 className="text-sm font-semibold flex-shrink-0">Processing...</h4>
                     <Progress value={bulkUploadProgress} className="w-full" />
                     <p className="text-xs text-muted-foreground">{Math.round(bulkUploadProgress)}% complete</p>
                    <ScrollArea className="h-64 rounded-md border text-left"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader><TableBody>{bulkUploadResults.map(r => (
                              <TableRow key={r.row} className={r.status === 'error' ? 'bg-red-100' : r.status === 'warning' ? 'bg-yellow-100' : ''}>
                                  <TableCell className="text-xs">{r.name}</TableCell><TableCell className="text-xs">{r.email}</TableCell><TableCell className="text-xs">{r.status}</TableCell><TableCell className="text-xs">{r.detail}</TableCell>
                              </TableRow>
                          ))}</TableBody>
                        </Table>
                    </ScrollArea>
                </div>
            )}
             {bulkUploadFinalMessage && (<Alert variant={bulkUploadStatus === 'failed' ? 'destructive' : 'default'} className="mt-4 text-left">
                    <AlertTitle>{bulkUploadStatus === 'completed' ? 'Processing Complete' : 'Processing Failed'}</AlertTitle>
                    <p className="text-sm">{bulkUploadFinalMessage}</p>
                </Alert>
            )}
        </CardContent>
        <CardFooter className="justify-start">
             <Button onClick={handleBulkUpload} disabled={bulkUploadStatus !== 'idle' || !bulkUploadFile || !bulkUploadEventId || !bulkUploadAssignedTicketId}>
                {bulkUploadStatus !== 'idle' ? <Loader2 className="animate-spin h-4 w-4 mr-2"/> : <Upload className="h-4 w-4 mr-2"/>}
                {bulkUploadStatus !== 'idle' ? "Processing..." : "Process Sheet"}
            </Button>
            {bulkUploadStatus !== 'idle' && (
                <Button variant="outline" className="ml-2" onClick={() => { setBulkUploadStatus('idle'); setBulkUploadFile(null); if(bulkUploadInputRef.current) bulkUploadInputRef.current.value = ""; }}>Start New Upload</Button>
            )}
        </CardFooter>
    </Card>
  );
}
