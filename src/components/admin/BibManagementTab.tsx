"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { EventCalendarEntry, BibAssignmentRule, TicketDefinition, SwimDistanceCategory } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Loader2, PlusCircle, Trash2, Hash, Copy, Save } from 'lucide-react';
import {
  getBibAssignmentsForTicketAction,
  saveBibAssignmentsAction,
  cloneBibAssignmentsAction
} from '@/lib/actions';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

interface BibManagementTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function BibManagementTab({ events, isLoadingEvents }: BibManagementTabProps) {
  const { toast } = useToast();

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedSubCategoryId, setSelectedSubCategoryId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Partial<BibAssignmentRule>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneSourceEventId, setCloneSourceEventId] = useState<string | null>(null);
  const [cloneSourceTicketId, setCloneSourceTicketId] = useState<string | null>(null);

  const selectedEvent = useMemo(
    () => events.find(e => e.id === selectedEventId),
    [events, selectedEventId]
  );

  const activeTicket = useMemo(
    () => selectedEvent?.ticketDefinitions?.find(t => t.id === selectedTicketId),
    [selectedEvent, selectedTicketId]
  );

  const sourceTickets = useMemo(
    () => events.find(e => e.id === cloneSourceEventId)?.ticketDefinitions || [],
    [events, cloneSourceEventId]
  );

  const fetchAssignments = useCallback(async (eventId: string, ticketId: string, subId: string | null) => {
    setIsLoading(true);
    try {
        const result = await getBibAssignmentsForTicketAction(eventId, ticketId, subId);
        if (result.success) {
          setAssignments(result.assignments || []);
        } else {
          toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
    } finally {
        setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedEventId && selectedTicketId) {
      fetchAssignments(selectedEventId, selectedTicketId, selectedSubCategoryId);
    } else {
      setAssignments([]);
    }
  }, [selectedEventId, selectedTicketId, selectedSubCategoryId, fetchAssignments]);

  const handleAssignmentChange = (index: number, field: keyof BibAssignmentRule, value: any) => {
    const newAssignments = [...assignments];
    const assignmentToUpdate = { ...newAssignments[index] };
    (assignmentToUpdate as any)[field] = value;
    newAssignments[index] = assignmentToUpdate;
    setAssignments(newAssignments);
  };

  const handleAddRule = () => {
    setAssignments([
      ...assignments,
      { 
        ageGroup: 'Any', 
        gender: 'Any', 
        startBib: 0, 
        endBib: 0, 
        selectedSubCategory: (selectedSubCategoryId === "NONE" || !selectedSubCategoryId) ? null : selectedSubCategoryId 
      }
    ]);
  };

  const handleRemoveRule = (index: number) => {
    setAssignments(assignments.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!selectedEventId || !selectedTicketId) return;
    setIsSaving(true);
    const result = await saveBibAssignmentsAction(selectedEventId, selectedTicketId, selectedSubCategoryId, assignments);
    if (result.success) {
      toast({ title: "Success", description: result.message });
      fetchAssignments(selectedEventId, selectedTicketId, selectedSubCategoryId);
    } else {
      toast({ variant: 'destructive', title: 'Save Failed', description: result.message });
    }
    setIsSaving(false);
  };

  const handleClone = async () => {
    if (!cloneSourceEventId || !cloneSourceTicketId || !selectedEventId || !selectedTicketId) return;
    setIsCloning(true);
    const result = await cloneBibAssignmentsAction(
      cloneSourceEventId,
      cloneSourceTicketId,
      selectedEventId,
      selectedTicketId,
      selectedSubCategoryId
    );
    if (result.success) {
      toast({ title: "Success", description: result.message });
      fetchAssignments(selectedEventId, selectedTicketId, selectedSubCategoryId);
      setIsCloneModalOpen(false);
    } else {
      toast({ variant: 'destructive', title: 'Clone Failed', description: result.message });
    }
    setIsCloning(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-left">
          <Hash className="h-5 w-5 text-primary" />
          BIB Number Management
        </CardTitle>
        <CardDescription className="text-left">
          Define specific BIB number ranges for different ticket categories, sub-categories, age groups, and genders.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Select
            onValueChange={(v) => { setSelectedEventId(v); setSelectedTicketId(null); setSelectedSubCategoryId(null); }}
            disabled={isLoadingEvents}
            value={selectedEventId || ""}
          >
            <SelectTrigger>
              <SelectValue placeholder="1. Select an Event..." />
            </SelectTrigger>
            <SelectContent>
              {events.map(e => (
                <SelectItem key={e.id} value={e.id}>
                  {e.eventName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedEventId && (
            <Select
              onValueChange={(v) => { setSelectedTicketId(v); setSelectedSubCategoryId(null); }}
              disabled={!selectedEvent}
              value={selectedTicketId || ''}
            >
              <SelectTrigger>
                <SelectValue placeholder="2. Select a Ticket Category..." />
              </SelectTrigger>
              <SelectContent>
                {selectedEvent?.ticketDefinitions?.map((t: TicketDefinition) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.ticketName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {activeTicket && activeTicket.subCategories && activeTicket.subCategories.length > 0 && (
            <Select
              onValueChange={setSelectedSubCategoryId}
              value={selectedSubCategoryId || "NONE"}
            >
              <SelectTrigger>
                <SelectValue placeholder="3. Select Sub-Category..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">All Sub-Categories (Shared BIB Pool)</SelectItem>
                {activeTicket.subCategories.map((s: SwimDistanceCategory) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {selectedTicketId && (
          <div className="pt-4 border-t">
            <div className="flex justify-between items-center mb-4 text-left">
              <h3 className="text-lg font-semibold text-left">
                Rules for {activeTicket?.ticketName}
                {selectedSubCategoryId && selectedSubCategoryId !== "NONE" && ` - ${activeTicket?.subCategories?.find(s => s.id === selectedSubCategoryId)?.name}`}
              </h3>

              <div className="flex gap-2">
                <Dialog open={isCloneModalOpen} onOpenChange={setIsCloneModalOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      <Copy className="mr-2 h-4 w-4" />
                      Clone Rules
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="text-left">
                    <DialogHeader className="text-left">
                      <DialogTitle className="text-left">Clone BIB Rules</DialogTitle>
                      <DialogDescription className="text-left">
                        Copy rules from another ticket to this one. This will overwrite existing rules for the current selection.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="py-4 space-y-4 text-left">
                      <Select onValueChange={setCloneSourceEventId} disabled={isLoadingEvents}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select source event..." />
                        </SelectTrigger>
                        <SelectContent>
                            {events.filter(e => e.id !== selectedEventId).map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
                        </SelectContent>
                      </Select>

                      <Select onValueChange={setCloneSourceTicketId} disabled={!cloneSourceEventId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select Source Ticket..." />
                        </SelectTrigger>
                        <SelectContent>
                          {sourceTickets.map(t => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.ticketName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <DialogFooter className="text-left">
                      <DialogClose asChild>
                        <Button variant="ghost">Cancel</Button>
                      </DialogClose>
                      <Button onClick={handleClone} disabled={isCloning || !cloneSourceTicketId}>
                        {isCloning && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                        Clone
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Button size="sm" onClick={handleAddRule}>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Add Rule
                </Button>
              </div>
            </div>

            {isLoading ? (
              <div className="text-center py-8"><Loader2 className="animate-spin h-8 w-8 mx-auto text-primary" /></div>
            ) : (
              <div className="space-y-3">
                {assignments.length === 0 ? (
                    <p className="text-center py-10 text-muted-foreground italic">No rules defined for this selection. Click &quot;Add Rule&quot; to start.</p>
                ) : assignments.map((rule, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-3 border rounded-md shadow-sm bg-muted/10"
                  >
                    <div className="space-y-1.5 text-left">
                      <Label className="text-xs">Age Group</Label>
                      <Select
                        value={rule.ageGroup}
                        onValueChange={(val) => handleAssignmentChange(index, 'ageGroup', val)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Any">Any Age Group</SelectItem>
                          {selectedEvent?.ageCategories?.map((ag: string) => (
                            <SelectItem key={ag} value={ag}>{ag}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5 text-left">
                      <Label className="text-xs">Gender</Label>
                      <Select
                        value={rule.gender}
                        onValueChange={(val) => handleAssignmentChange(index, 'gender', val)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Any">Any</SelectItem>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-left">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Start BIB</Label>
                        <Input
                          type="number"
                          placeholder="e.g. 1001"
                          value={rule.startBib ?? ''}
                          onChange={(e) =>
                            handleAssignmentChange(
                              index,
                              'startBib',
                              Number.isNaN(parseInt(e.target.value, 10))
                                ? 0
                                : parseInt(e.target.value, 10)
                            )
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">End BIB</Label>
                        <Input
                          type="number"
                          placeholder="e.g. 1500"
                          value={rule.endBib ?? ''}
                          onChange={(e) =>
                            handleAssignmentChange(
                              index,
                              'endBib',
                              Number.isNaN(parseInt(e.target.value, 10))
                                ? 0
                                : parseInt(e.target.value, 10)
                            )
                          }
                        />
                      </div>
                    </div>

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleRemoveRule(index)}
                      aria-label="Remove rule"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {assignments.length > 0 && (
                <div className="mt-4 flex justify-end">
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Rules
                </Button>
                </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
