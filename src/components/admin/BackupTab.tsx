// src/components/admin/BackupTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, DatabaseBackup, PlusCircle, Trash2, Download, History } from 'lucide-react';
import type { BackupRecord, EventCalendarEntry } from '@/lib/types';
import { createBackupAction, getBackupsForEventAction, deleteBackupAction, restoreBackupAction, restoreBackupToNewEventAction, fetchBackupDataAction } from '@/lib/actions';
import { format, parseISO } from 'date-fns';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import * as XLSX from 'xlsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '../ui/label';

interface BackupTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

export default function BackupTab({ events, isLoadingEvents, onDataRefresh }: BackupTabProps) {
    const { toast } = useToast();
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [allBackups, setAllBackups] = useState<BackupRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    // New states for restore functionality
    const [restoringBackup, setRestoringBackup] = useState<BackupRecord | null>(null);
    const [restoreTargetEventId, setRestoreTargetEventId] = useState<string | null>(null);
    const [isRestoring, setIsRestoring] = useState(false);
    const [isRestoringNew, setIsRestoringNew] = useState(false);
    
    const fetchAllBackups = useCallback(async () => {
        setIsLoading(true);
        const result = await getBackupsForEventAction(); 
        if(result.success && result.backups) {
            setAllBackups(result.backups);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
        setIsLoading(false);
    }, [toast]);
    
    useEffect(() => {
        fetchAllBackups();
    }, [fetchAllBackups]);
    

            const handleDownloadBackup = (backup: BackupRecord) => {
                try {
                    const wb = XLSX.utils.book_new();

                    const addSheet = (dataString: string | undefined | null, sheetName: string) => {
                        if (dataString) {
                            try {
                                const data = JSON.parse(dataString);
                                const dataArray = Array.isArray(data) ? data : [data];
                                if (dataArray.length > 0) {
                                    const ws = XLSX.utils.json_to_sheet(dataArray);
                                    XLSX.utils.book_append_sheet(wb, ws, sheetName);
                                }
                            } catch (e) {
                                console.warn(`Could not parse or add sheet for ${sheetName}`, e);
                            }
                        }
                    };

                    

                    const processAndDownload = (payload: { participantsData?: string | null; eventDocument?: string | null; ticketDefinitionsData?: string | null; bibAssignmentsData?: string | null; sponsorsData?: string | null; inventoryData?: string | null }) => {
                        let participants: any[] = [];
                        try {
                            if (payload.participantsData) {
                                const parsed = JSON.parse(payload.participantsData);
                                participants = Array.isArray(parsed) ? parsed : [parsed];
                            }
                        } catch (e) {
                            console.warn('Could not parse participantsData', e);
                            participants = [];
                        }

                        participants = participants.map(p => ({
                            ...p,
                            name: p.name || p.fullName || p.athleteName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Unnamed',
                        }));

                        if (participants.length > 0) {
                            const ws = XLSX.utils.json_to_sheet(participants);
                            XLSX.utils.book_append_sheet(wb, ws, 'Participants');
                        }

                        const getPathValue = (obj: any, path: string) => {
                            if (!obj || !path) return undefined;
                            return path.split('.').reduce((acc: any, key: string) => {
                                if (acc === null || acc === undefined) return undefined;
                                return acc[key];
                            }, obj);
                        };

                        const getFirst = (obj: any, keys: string[]) => {
                            for (const key of keys) {
                                const value = key.includes('.') ? getPathValue(obj, key) : obj?.[key];
                                if (value !== undefined && value !== null && value !== '') {
                                    return value;
                                }
                            }
                            return undefined;
                        };

                        const isTruthyYes = (v: any) => {
                            if (v === true) return true;
                            if (v === 1 || v === '1') return true;
                            if (v === false || v === 0 || v === '0') return false;
                            if (v === undefined || v === null || v === '') return false;
                            const s = String(v).trim().toLowerCase();
                            return ['yes', 'y', 'true', 't', '1', 'on'].includes(s);
                        };

                        const fromPaisa = (val: any) => {
                            if (val === null || val === undefined || val === '') return '';
                            const n = Number(val);
                            if (Number.isNaN(n)) return '';
                            return n / 100;
                        };

                        const amountFromFields = (p: any, paisaKeys: string[], plainKeys: string[]) => {
                            const paisaValue = getFirst(p, paisaKeys);
                            if (paisaValue !== undefined) {
                                return fromPaisa(paisaValue);
                            }
                            const plainValue = getFirst(p, plainKeys);
                            if (plainValue === undefined || plainValue === null || plainValue === '') return '';
                            return plainValue;
                        };

                        const bulkRows = participants.map((p) => {
                            const ticketPrice = amountFromFields(
                                p,
                                ['ticketPricePaisa', 'pricingBreakdown.basePricePaisa'],
                                ['ticketPrice', 'price', 'pricingBreakdown.basePrice']
                            );
                            const amountPaid = amountFromFields(
                                p,
                                ['amountPaidPaisa', 'originalAmountPaidAtFirstRegistrationPaisa'],
                                ['amountPaid', 'paid', 'amountPaidInr']
                            );
                            const balanceAmount = amountFromFields(
                                p,
                                ['balanceAmountPaisa'],
                                ['balanceAmount']
                            );
                            const taxAmount = amountFromFields(
                                p,
                                ['taxAmountPaidPaisa', 'taxAmountPaisa'],
                                ['taxAmountPaid', 'taxAmount']
                            );
                            const processingFee = amountFromFields(
                                p,
                                ['processingFeePaidPaisa', 'processingFeePaisa'],
                                ['processingFeePaid', 'processingFee']
                            );
                            const consentValue = getFirst(p, ['consentPromotions', 'receiveUpdates', 'receive_updates', 'optIn']);
                            const deferredPuneValue = getFirst(p, ['isDeferredFromPune', 'isDeferred_from_pune', 'deferredFromPune']);

                            return {
                                'BIB NO': p.bibNumber || p.bib || '',
                                'Name': p.name || p.fullName || '',
                                'Email Address': p.email || p.buyerEmail || '',
                                'Address': p.address || p.businessAddress || '',
                                'City': p.city || '',
                                'Pincode': p.pincode || '',
                                'State': p.state || '',
                                'Country': p.country || '',
                                'T Shirt Size': p.tshirtSize || '',
                                'Date Of Birth': p.dob || '',
                                'Phone Number': p.mobile || p.phone || '',
                                'Gender': p.gender || '',
                                'Blood Group': p.bloodGroup || '',
                                'Identity Proof': p.idProofUrl || p.idProof || '',
                                'Emergency Contact Number': p.emergencyContactNumber || p.emergencyContactPhone || '',
                                'Digital Signature (Name)': p.digitalSignatureName || p.digitalSignature || '',
                                'Rules & Regulations': isTruthyYes(p.agreedRules) || isTruthyYes(p.acceptedRules) ? 'Yes' : 'No',
                                'Waiver': isTruthyYes(p.agreedWaiver) || isTruthyYes(p.waiverAccepted) ? 'Yes' : 'No',
                                'Deferred': isTruthyYes(p.isDeferral) || !!p.deferralId ? 'Yes' : 'No',
                                'Ticket Price': ticketPrice,
                                'Amount Paid': amountPaid,
                                'Balance Amount': balanceAmount,
                                'Tax Amount': taxAmount,
                                'Processing Fee': processingFee,
                                'I would like to receive updates & notifications from this event organizer': isTruthyYes(consentValue) ? 'Yes' : 'No',
                                'Deferred from pune': (deferredPuneValue === undefined || deferredPuneValue === null || deferredPuneValue === '') ? '' : (isTruthyYes(deferredPuneValue) ? 'Yes' : 'No'),
                            };
                        });

                        if (bulkRows.length > 0) {
                            const headerOrder = [
                                'BIB NO','Name','Email Address','Address','City','Pincode','State','Country','T Shirt Size','Date Of Birth','Phone Number','Gender','Blood Group','Identity Proof','Emergency Contact Number','Digital Signature (Name)','Rules & Regulations','Waiver','Deferred','Ticket Price','Amount Paid','Balance Amount','Tax Amount','Processing Fee','I would like to receive updates & notifications from this event organizer','Deferred from pune'
                            ];
                            const ws2 = XLSX.utils.json_to_sheet(bulkRows, { header: headerOrder });
                            XLSX.utils.book_append_sheet(wb, ws2, 'Participant Bulk Upload');
                        }

                        addSheet(payload.eventDocument, 'EventDetails');
                        addSheet(payload.ticketDefinitionsData, 'TicketDefinitions');
                        addSheet(payload.bibAssignmentsData, 'BibAssignments');
                        addSheet(payload.sponsorsData, 'Sponsors');
                        addSheet(payload.inventoryData, 'Inventory');

                        if (wb.SheetNames.length === 0) {
                            toast({ variant: 'destructive', title: 'Download Error', description: 'Backup contains no data to download.' });
                            return;
                        }

                        const filename = `FullBackup_${backup.eventName.replace(/[^a-z0-9]/gi, '_')}_${format(parseISO(backup.createdAt), 'yyyyMMdd_HHmmss')}.xlsx`;
                        XLSX.writeFile(wb, filename);
                    };

                    (async () => {
                        if (backup.storagePath) {
                            const resp = await fetchBackupDataAction(backup.id);
                            if (!resp.success || !resp.data) {
                                toast({ variant: 'destructive', title: 'Download Error', description: resp.message });
                                return;
                            }
                            processAndDownload(resp.data);
                        } else {
                            processAndDownload({ participantsData: backup.participantsData, eventDocument: backup.eventDocument, ticketDefinitionsData: backup.ticketDefinitionsData, bibAssignmentsData: backup.bibAssignmentsData, sponsorsData: backup.sponsorsData, inventoryData: backup.inventoryData });
                        }
                    })();

                } catch (e: any) {
                    toast({ variant: 'destructive', title: 'Download Error', description: `Could not process backup data: ${e.message}` });
                }

            };

            const handleCreateBackup = async () => {
                if (!selectedEventId) {
                    toast({ variant: 'destructive', title: 'Create Backup', description: 'No event selected.' });
                    return;
                }
                setIsLoading(true);
                const resp = await createBackupAction(selectedEventId);
                setIsLoading(false);
                if (!resp.success) {
                    toast({ variant: 'destructive', title: 'Create Backup', description: resp.message });
                    return;
                }
                toast({ title: 'Backup created' });
                fetchAllBackups();
                onDataRefresh();
            };

            const handleDeleteBackup = async (id: string) => {
                const resp = await deleteBackupAction(id);
                if (!resp.success) {
                    toast({ variant: 'destructive', title: 'Delete Backup', description: resp.message });
                    return;
                }
                toast({ title: 'Backup deleted' });
                fetchAllBackups();
            };

            const handleRestoreToNew = async () => {
                if (!restoringBackup) return;
                setIsRestoringNew(true);
                const resp = await restoreBackupToNewEventAction(restoringBackup.id);
                setIsRestoringNew(false);
                if (!resp.success) {
                    toast({ variant: 'destructive', title: 'Restore Error', description: resp.message });
                    return;
                }
                toast({ title: 'Restore started' });
                fetchAllBackups();
                onDataRefresh();
                setRestoringBackup(null);
            };

            const handleRestoreBackup = async () => {
                if (!restoringBackup || !restoreTargetEventId) return;
                setIsRestoring(true);
                const resp = await restoreBackupAction(restoringBackup.id, restoreTargetEventId);
                setIsRestoring(false);
                if (!resp.success) {
                    toast({ variant: 'destructive', title: 'Restore Error', description: resp.message });
                    return;
                }
                toast({ title: 'Restore started' });
                fetchAllBackups();
                onDataRefresh();
                setRestoringBackup(null);
            };

    const displayedBackups = useMemo(() => {
        if (selectedEventId) {
            return allBackups.filter(b => b.eventId === selectedEventId);
        }
        return allBackups;
    }, [allBackups, selectedEventId]);

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><DatabaseBackup className="h-5 w-5 text-primary"/>Event Data Backups</CardTitle>
                    <CardDescription>Create, download, or restore backups of event data. Backups from deleted events will also appear here.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                     <Select onValueChange={(value) => setSelectedEventId(value === 'all' ? null : value)} disabled={isLoadingEvents}>
                        <SelectTrigger className="w-full md:w-[300px]">
                            <SelectValue placeholder="Filter backups by event..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Show All Backups</SelectItem>
                            {events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    
                    <div className="space-y-4 pt-4 border-t">
                        <div className="flex flex-col sm:flex-row sm:justify-end">
                            <Button onClick={handleCreateBackup} disabled={isLoading || !selectedEventId} className="w-full sm:w-auto">
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                <PlusCircle className="mr-2 h-4 w-4" /> Create Backup For Selected Event
                            </Button>
                        </div>
                        {isLoading ? (<div className="text-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>)
                         : displayedBackups.length > 0 ? (
                             <div className="rounded-md border">
                                <ul className="divide-y divide-border">
                                    {displayedBackups.map(backup => (
                                        <li key={backup.id} className="p-3 flex justify-between items-center flex-wrap gap-2">
                                            <div>
                                                <p className="font-semibold">{backup.eventName || 'Deleted Event'} <span className="text-xs text-muted-foreground">({backup.eventId})</span></p>
                                                <p className="text-sm text-muted-foreground">Backup from {format(parseISO(backup.createdAt), 'MMM dd, yyyy p')} - {backup.participantCount} participant(s)</p>
                                            </div>
                                            <div className="space-x-2">
                                                <Button size="sm" variant="outline" onClick={() => setRestoringBackup(backup)}><History className="h-4 w-4"/></Button>
                                                <Button size="sm" variant="outline" onClick={() => handleDownloadBackup(backup)}><Download className="h-4 w-4"/></Button>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild><Button size="sm" variant="destructive"><Trash2 className="h-4 w-4"/></Button></AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader><AlertDialogTitle>Delete Backup?</AlertDialogTitle><AlertDialogDescription>This will permanently delete this backup. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteBackup(backup.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : (
                            <p className="text-center text-muted-foreground pt-4">{selectedEventId ? "No backups found for this event." : "No backups found."}</p>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Dialog open={!!restoringBackup} onOpenChange={(open) => !open && setRestoringBackup(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Restore Backup</DialogTitle>
                        <DialogDescription>
                            Restoring <strong>{restoringBackup?.eventName}</strong> backup from {restoringBackup && format(parseISO(restoringBackup.createdAt), 'MMM dd, yyyy')}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div className="p-3 border rounded-md">
                            <h4 className="font-semibold mb-2">Option 1: Restore to a New Event</h4>
                            <p className="text-xs text-muted-foreground mb-3">This is the safest option and is recommended for recovering a deleted event.</p>
                            <Button onClick={handleRestoreToNew} disabled={isRestoring || isRestoringNew} className="w-full">
                                {isRestoringNew ? <Loader2 className="animate-spin mr-2"/> : <PlusCircle className="mr-2 h-4 w-4" />}
                                Restore as New Event
                            </Button>
                        </div>
                        <div className="p-3 border rounded-md">
                            <h4 className="font-semibold mb-2">Option 2: Overwrite an Existing Event</h4>
                             <p className="text-xs text-muted-foreground mb-3"><span className="font-bold text-destructive">WARNING:</span> This will overwrite all data (participants, tickets, etc.) in the selected target event.</p>
                            <Label htmlFor="restore-target">Select Target Event to Overwrite</Label>
                            <Select onValueChange={setRestoreTargetEventId} disabled={isRestoring || isRestoringNew}>
                                <SelectTrigger id="restore-target">
                                    <SelectValue placeholder="Select an event to restore to..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
                                </SelectContent>
                            </Select>
                             <Button onClick={handleRestoreBackup} disabled={!restoreTargetEventId || isRestoring || isRestoringNew} className="w-full mt-3">
                                {isRestoring ? <Loader2 className="animate-spin mr-2" /> : <History className="mr-2 h-4 w-4" />}
                                Overwrite Selected Event
                            </Button>
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
