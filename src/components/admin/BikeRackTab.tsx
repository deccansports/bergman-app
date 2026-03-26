// src/components/admin/BikeRackTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { EventCalendarEntry, BikeRackAssignment, ParticipantWithProfile } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Bike, Search, PlusCircle, Trash2, Save, Send, UserCheck, Download } from 'lucide-react';
import { getParticipantsForEventAction } from '@/lib/actions';
import {
  getBikeRackAssignmentsAction,
  saveBikeRackAssignmentsAction,
  sendBikeRackNotificationsAction
} from '@/lib/actions/bikeRackActions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { searchParticipantsForCheckInAction } from '@/lib/actions/volunteerActions';

interface BikeRackTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function BikeRackTab({ events, isLoadingEvents }: BikeRackTabProps) {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Partial<BikeRackAssignment>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [foundRack, setFoundRack] = useState<{ rackName: string; athleteName: string; } | null>(null);
  const [isBibSearching, setIsBibSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [waiverSignedCount, setWaiverSignedCount] = useState(0);

  const fetchRackData = useCallback(async (eventId: string) => {
    if (!eventId) return;
    setIsLoading(true);
    try {
        const [assignmentResult, statsResponse] = await Promise.all([
            getBikeRackAssignmentsAction(eventId),
            fetch(`/api/volunteer-stats/check-in?eventId=${eventId}`)
        ]);

        if (assignmentResult.success && assignmentResult.assignments) {
            setAssignments(assignmentResult.assignments);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch rack assignments.' });
        }

        if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            if (statsData.success) {
                setWaiverSignedCount(statsData.stats.checkedInCount);
            }
        }
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Error', description: `Failed to fetch data: ${e.message}` });
    } finally {
        setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedEventId) {
      fetchRackData(selectedEventId);
    } else {
        setAssignments([]);
        setWaiverSignedCount(0);
    }
  }, [selectedEventId, fetchRackData]);
  
  const handleSearchBib = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId) return;
    setIsBibSearching(true);
    setFoundRack(null);
    const bibToFind = searchTerm.trim();
    if (!bibToFind) {
      setIsBibSearching(false);
      return;
    }
    
    try {
        const participantResult = await searchParticipantsForCheckInAction(selectedEventId, bibToFind, 'bibNumber');
        if (!participantResult.success || !participantResult.participant) {
            toast({ variant: 'destructive', title: 'Not Found', description: `No participant found with BIB number ${bibToFind}.` });
            return;
        }

        const participant = participantResult.participant;
        const bibNum = parseInt(bibToFind, 10);
        const rack = assignments.find(a => bibNum >= (a.bibFrom || 0) && bibNum <= (a.bibTo || 0));
        
        if (rack && rack.rackName) {
          setFoundRack({ rackName: rack.rackName, athleteName: participant.name });
          toast({ title: 'Found!', description: `BIB ${bibToFind} (${participant.name}) is assigned to Rack ${rack.rackName}.` });
        } else {
          toast({ variant: 'destructive', title: 'Not Assigned', description: `BIB ${bibToFind} (${participant.name}) is not assigned to any rack.` });
        }
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Search Error', description: `An error occurred during search: ${e.message}` });
    } finally {
        setIsBibSearching(false);
    }
  };
  
  const handleAssignmentChange = (index: number, field: keyof BikeRackAssignment, value: string | number) => {
    const newAssignments = [...assignments];
    const assignmentToUpdate = { ...newAssignments[index] };
    (assignmentToUpdate as any)[field] = value;
    newAssignments[index] = assignmentToUpdate;
    setAssignments(newAssignments);
  };

  const handleAddRack = () => {
    setAssignments([...assignments, { rackName: '', bibFrom: undefined, bibTo: undefined }]);
  };

  const handleRemoveRack = (index: number) => {
    setAssignments(assignments.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!selectedEventId) return;
    setIsSaving(true);
    const result = await saveBikeRackAssignmentsAction(selectedEventId, assignments);
    if (result.success) {
      toast({ title: 'Success', description: 'Bike rack assignments saved.' });
      if (result.assignments) {
        setAssignments(result.assignments);
      }
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSaving(false);
  };
  
  const handleSendNotifications = async () => {
    if (!selectedEventId) return;
    setIsSending(true);
    const result = await sendBikeRackNotificationsAction(selectedEventId);
    if (result.success) {
      toast({ title: 'Success', description: result.message });
      fetchRackData(selectedEventId);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSending(false);
  };
  
  const handleGeneratePdf = async () => {
    if (!selectedEventId || assignments.length === 0) return;
    setIsGeneratingPdf(true);
    const eventName = events.find(e => e.id === selectedEventId)?.eventName || 'Bike Racks';
    
    try {
        const response = await fetch('/bmforranking.png');
        if (!response.ok) throw new Error("Failed to fetch logo image");
        const blob = await response.blob();
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
            const base64data = reader.result as string;
            try {
                const doc = new jsPDF();
                const imgWidth = 40; const imgHeight = 13; const pageWidth = doc.internal.pageSize.getWidth();
                const x = (pageWidth - imgWidth) / 2;
                doc.addImage(base64data, 'PNG', x, 10, imgWidth, imgHeight);
                doc.setFontSize(18);
                doc.text("Bike Rack Assignments", pageWidth / 2, 30, { align: 'center'});
                const sortedAssignments = [...assignments].sort((a, b) => (a.rackName || '').localeCompare(b.rackName || '', undefined, { numeric: true, sensitivity: 'base' }));
                const tableData = sortedAssignments.map(assignment => [`Rack ${assignment.rackName || 'N/A'}`, assignment.bibFrom || 'N/A', assignment.bibTo || 'N/A']);
                (doc as any).autoTable({ startY: 42, head: [['Rack Name/Number', 'BIB From', 'BIB To']], body: tableData, theme: 'striped', headStyles: { fillColor: [41, 128, 185] }, });
                doc.save(`${eventName.replace(/[^a-z0-9]/gi, '_')}_Bike_Racks.pdf`);
            } catch (e: any) {
                toast({ variant: 'destructive', title: 'PDF Error', description: `Failed to generate PDF: ${e.message}` });
            } finally { setIsGeneratingPdf(false); }
        };
        reader.onerror = () => {
            toast({ variant: 'destructive', title: 'PDF Error', description: 'Failed to load logo for PDF.' });
            setIsGeneratingPdf(false);
        }
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Network Error', description: 'Failed to fetch logo for PDF.' });
        setIsGeneratingPdf(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bike className="h-5 w-5 text-primary"/>Bike Racking Management</CardTitle>
        <CardDescription>Assign BIB number ranges to racks and notify athletes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents}>
          <SelectTrigger className="w-full sm:w-[300px]"><SelectValue placeholder="Select an Event..." /></SelectTrigger>
          <SelectContent>{(events || []).map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}</SelectContent>
        </Select>

        {selectedEventId && (
            <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                    <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl">{isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto"/> : waiverSignedCount}</CardTitle><CardDescription className="text-xs flex items-center justify-center gap-1"><UserCheck className="h-4 w-4"/>Waiver Signed</CardDescription></CardHeader></Card>
                </div>
                <form onSubmit={handleSearchBib} className="flex gap-2">
                  <Input 
                    placeholder="Enter BIB Number to find rack..." 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    type="number"
                    disabled={isBibSearching}
                  />
                  <Button type="submit" disabled={isBibSearching}>
                    <Search className="h-4 w-4 mr-2"/> Find Rack
                  </Button>
                </form>
                {foundRack && searchTerm && (
                    <div className="p-4 bg-green-100 border border-green-300 rounded-md text-center">
                        <p className="font-semibold text-green-800">BIB <span className="font-bold text-lg">{searchTerm}</span> ({foundRack.athleteName}) is assigned to:</p>
                        <p className="text-3xl font-bold text-green-700">Rack {foundRack.rackName}</p>
                    </div>
                )}

                <div className="pt-4 border-t">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Rack Configuration</h3>
                    <Button size="sm" onClick={handleAddRack} variant="outline">
                      <PlusCircle className="mr-2 h-4 w-4" /> Add Rack
                    </Button>
                  </div>
                  {isLoading ? (
                    <div className="text-center"><Loader2 className="animate-spin my-4 mx-auto"/></div>
                  ) : (
                    <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2">
                      {assignments.map((assignment, index) => (
                        <div
                          key={index}
                          className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-3 border rounded-md"
                        >
                          <div className="md:col-span-2 space-y-1">
                            <Label className="text-xs">Rack Name/Number</Label>
                            <Input placeholder="e.g., Rack A" value={assignment.rackName || ''} onChange={e => handleAssignmentChange(index, 'rackName', e.target.value)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">BIB From</Label>
                            <Input type="number" placeholder="e.g., 101" value={assignment.bibFrom ?? ''} onChange={e => handleAssignmentChange(index, 'bibFrom', Number(e.target.value))} />
                          </div>
                          <div className="flex items-end gap-2">
                            <div className="flex-grow space-y-1">
                              <Label className="text-xs">BIB To</Label>
                              <Input type="number" placeholder="e.g., 200" value={assignment.bibTo ?? ''} onChange={e => handleAssignmentChange(index, 'bibTo', Number(e.target.value))} />
                            </div>
                            <Button size="icon" variant="destructive" onClick={() => handleRemoveRack(index)} aria-label="Remove rule">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
            </>
        )}
      </CardContent>
      {selectedEventId && (
        <CardFooter className="flex flex-col sm:flex-row justify-end gap-2 border-t pt-6">
            <Button variant="outline" onClick={handleGeneratePdf} disabled={isGeneratingPdf || assignments.length === 0}>
                {isGeneratingPdf ? <Loader2 className="animate-spin h-4 w-4"/> : <Download className="h-4 w-4"/>} <span className="ml-2">Download PDF Report</span>
            </Button>
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="secondary" disabled={isSending || isLoading || waiverSignedCount === 0}>
                        {isSending ? <Loader2 className="animate-spin h-4 w-4"/> : <Send className="h-4 w-4"/>} <span className="ml-2">Send Notifications</span>
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Notifications</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will send a WhatsApp and Email message to waiver-signed participants with a BIB number in a defined rack range who have not been notified yet. Are you sure you want to proceed?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleSendNotifications}>Confirm & Send</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <Button onClick={handleSave} disabled={isSaving || isLoading}>
                {isSaving ? <Loader2 className="animate-spin h-4 w-4"/> : <Save className="h-4 w-4"/>} <span className="ml-2">Save Assignments</span>
            </Button>
        </CardFooter>
      )}
    </Card>
  );
}
