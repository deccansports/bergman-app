// src/components/admin/BackupTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, DatabaseBackup, PlusCircle, Trash2, Download, History } from 'lucide-react';
import type { BackupRecord, EventCalendarEntry } from '@/lib/types';
import { createBackupAction, getBackupsForEventAction, deleteBackupAction, restoreBackupAction, restoreBackupToNewEventAction } from '@/lib/actions';
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
    
    const handleCreateBackup = async () => {
        if (!selectedEventId) {
            toast({ variant: 'destructive', title: 'Select an Event', description: 'Please select an event to back up.' });
            return;
        }
        setIsLoading(true);
        try {
            const result = await createBackupAction(selectedEventId);
            if (result && result.success) {
                toast({ title: 'Success', description: 'Backup created successfully.' });
                await fetchAllBackups();
            } else {
                toast({ variant: 'destructive', title: 'Error', description: result?.message || 'Failed to create backup.' });
            }
        } catch (e: any) {
            console.error(`[BackupTab] createBackupAction failed:`, e);
            toast({ variant: 'destructive', title: 'Error', description: `An unexpected error occurred: ${e.message}` });
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleDeleteBackup = async (backupId: string) => {
        const result = await deleteBackupAction(backupId);
        if (result.success) {
            toast({ title: 'Success', description: 'Backup deleted.' });
            setAllBackups(prev => prev.filter(b => b.id !== backupId));
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
    };
    
    const handleRestoreBackup = async () => {
        if (!restoringBackup || !restoreTargetEventId) {
          toast({ variant: 'destructive', title: 'Error', description: 'Backup and target event must be selected.' });
          return;
        }
        setIsRestoring(true);
        const result = await restoreBackupAction(restoringBackup.id, restoreTargetEventId);
        if (result.success) {
          toast({ title: 'Restore Successful', description: result.message });
          setRestoringBackup(null);
          setRestoreTargetEventId(null);
          onDataRefresh();
        } else {
          toast({ variant: 'destructive', title: 'Restore Failed', description: result.message, duration: 7000 });
        }
        setIsRestoring(false);
    };

    const handleRestoreToNew = async () => {
        if (!restoringBackup) return;
        setIsRestoringNew(true);
        const result = await restoreBackupToNewEventAction(restoringBackup.id);
        if (result.success) {
          toast({ title: 'Restore Successful', description: result.message });
          setRestoringBackup(null);
          onDataRefresh();
        } else {
          toast({ variant: 'destructive', title: 'Restore Failed', description: result.message, duration: 7000 });
        }
        setIsRestoringNew(false);
    };

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

            addSheet(backup.participantsData, 'Participants');
            addSheet(backup.eventDocument, 'EventDetails');
            addSheet(backup.ticketDefinitionsData, 'TicketDefinitions');
            addSheet(backup.bibAssignmentsData, 'BibAssignments');
            addSheet(backup.sponsorsData, 'Sponsors');
            addSheet(backup.inventoryData, 'Inventory');

            if (wb.SheetNames.length === 0) {
                toast({ variant: 'destructive', title: 'Download Error', description: 'Backup contains no data to download.' });
                return;
            }

            const filename = `FullBackup_${backup.eventName.replace(/[^a-z0-9]/gi, '_')}_${format(parseISO(backup.createdAt), 'yyyyMMdd_HHmmss')}.xlsx`;
            XLSX.writeFile(wb, filename);

        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Download Error', description: `Could not process backup data: ${e.message}` });
        }
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
