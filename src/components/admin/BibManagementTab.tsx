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
import { Loader2, PlusCircle, Trash2, Hash, Copy, Save, Users, Info } from 'lucide-react';
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

  /** True when the selected ticket supports relay registrations */
  const isRelayTicket = useMemo(() => {
    const rt = activeTicket?.registrationType;
    return rt === 'relay' || rt === 'both';
  }, [activeTicket]);

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

  /** Add a standard individual-ticket rule (age group + gender based) */
  const handleAddRule = () => {
    setAssignments([
      ...assignments,
      {
        ageGroup: 'Any',
        gender: 'Any',
        startBib: 0,
        endBib: 0,
        selectedSubCategory: (selectedSubCategoryId === "NONE" || !selectedSubCategoryId) ? null : selectedSubCategoryId,
      }
    ]);
  };

  /** Add a relay BIB range rule (no age/gender — just a numeric range) */
  const handleAddRelayRule = () => {
    setAssignments([{
      isRelay: true,
      ageGroup: 'Any',
      gender: 'Any',
      startBib: 0,
      endBib: 0,
      selectedSubCategory: null,
    }]);
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
          Define BIB number ranges for ticket categories. Relay tickets use a team-number range —
          each team gets sequential bibs like <strong>101S</strong>, <strong>101B</strong>, <strong>101R</strong>.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Event / Ticket / Sub-category selectors ── */}
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
                <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
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
                    {(t.registrationType === 'relay' || t.registrationType === 'both') && (
                      <span className="ml-1 text-xs text-blue-600 font-medium">(Relay)</span>
                    )}
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
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* ── Rules section ── */}
        {selectedTicketId && (
          <div className="pt-4 border-t">
            <div className="flex justify-between items-center mb-4 text-left">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                {isRelayTicket && <Users className="h-4 w-4 text-blue-600" />}
                Rules for {activeTicket?.ticketName}
                {selectedSubCategoryId && selectedSubCategoryId !== "NONE" &&
                  ` — ${activeTicket?.subCategories?.find(s => s.id === selectedSubCategoryId)?.name}`}
              </h3>

              <div className="flex gap-2">
                {/* Clone dialog */}
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
                        <SelectTrigger><SelectValue placeholder="Select source event..." /></SelectTrigger>
                        <SelectContent>
                          {events.filter(e => e.id !== selectedEventId).map(e =>
                            <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <Select onValueChange={setCloneSourceTicketId} disabled={!cloneSourceEventId}>
                        <SelectTrigger><SelectValue placeholder="Select Source Ticket..." /></SelectTrigger>
                        <SelectContent>
                          {sourceTickets.map(t => (
                            <SelectItem key={t.id} value={t.id}>{t.ticketName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <DialogFooter className="text-left">
                      <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                      <Button onClick={handleClone} disabled={isCloning || !cloneSourceTicketId}>
                        {isCloning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Clone
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Relay ticket: show "Set Relay Range" only when no rule exists yet */}
                {isRelayTicket && assignments.length === 0 && (
                  <Button size="sm" onClick={handleAddRelayRule}>
                    <Users className="mr-2 h-4 w-4" />
                    Set Relay Range
                  </Button>
                )}

                {/* Individual ticket: normal "Add Rule" */}
                {!isRelayTicket && (
                  <Button size="sm" onClick={handleAddRule}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Rule
                  </Button>
                )}
              </div>
            </div>

            {isLoading ? (
              <div className="text-center py-8">
                <Loader2 className="animate-spin h-8 w-8 mx-auto text-primary" />
              </div>
            ) : (
              <div className="space-y-3">
                {assignments.length === 0 ? (
                  <p className="text-center py-10 text-muted-foreground italic">
                    No rules defined. Click &quot;{isRelayTicket ? 'Set Relay Range' : 'Add Rule'}&quot; to start.
                  </p>

                ) : isRelayTicket ? (
                  /* ── Relay BIB range UI ── */
                  assignments.map((rule, index) => (
                    <div key={index} className="p-4 border rounded-md bg-blue-50/40 border-blue-200 space-y-4">
                      <div className="flex items-center gap-2 text-blue-700 font-semibold text-sm">
                        <Users className="h-4 w-4" /> Relay Team BIB Range
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5 text-left">
                          <Label className="text-xs font-medium">Start BIB</Label>
                          <Input
                            type="number"
                            placeholder="e.g. 101"
                            value={rule.startBib ?? ''}
                            onChange={(e) =>
                              handleAssignmentChange(index, 'startBib',
                                Number.isNaN(parseInt(e.target.value, 10)) ? 0 : parseInt(e.target.value, 10))
                            }
                          />
                        </div>
                        <div className="space-y-1.5 text-left">
                          <Label className="text-xs font-medium">End BIB</Label>
                          <Input
                            type="number"
                            placeholder="e.g. 199"
                            value={rule.endBib ?? ''}
                            onChange={(e) =>
                              handleAssignmentChange(index, 'endBib',
                                Number.isNaN(parseInt(e.target.value, 10)) ? 0 : parseInt(e.target.value, 10))
                            }
                          />
                        </div>
                      </div>

                      {/* Live preview — shown as soon as valid range is entered */}
                      {(rule.startBib ?? 0) > 0 && (rule.endBib ?? 0) >= (rule.startBib ?? 0) && (
                        <div className="rounded-md bg-white border border-blue-100 p-3 text-xs space-y-2">
                          <div className="flex items-center gap-1.5 font-semibold text-blue-600">
                            <Info className="h-3.5 w-3.5" /> BIB Preview
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            {[rule.startBib!, rule.startBib! + 1, rule.startBib! + 2]
                              .filter(n => n <= rule.endBib!)
                              .map(n => (
                                <div key={n} className="bg-blue-50 rounded p-2 space-y-1">
                                  <div className="font-bold text-blue-700">Team #{n}</div>
                                  <div className="flex justify-center gap-1 flex-wrap">
                                    <span className="bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded font-mono">{n}S</span>
                                    <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-mono">{n}B</span>
                                    <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-mono">{n}R</span>
                                  </div>
                                </div>
                              ))
                            }
                          </div>
                          <p className="text-center text-muted-foreground">
                            S&nbsp;=&nbsp;Swim &nbsp;·&nbsp; B&nbsp;=&nbsp;Bike &nbsp;·&nbsp; R&nbsp;=&nbsp;Run
                            &nbsp;·&nbsp; Capacity:&nbsp;<strong>{rule.endBib! - rule.startBib! + 1}</strong>&nbsp;teams
                          </p>
                        </div>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleRemoveRule(index)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" /> Remove Range
                      </Button>
                    </div>
                  ))

                ) : (
                  /* ── Individual ticket rules: age group + gender ── */
                  assignments.map((rule, index) => (
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
                          <SelectTrigger><SelectValue /></SelectTrigger>
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
                          <SelectTrigger><SelectValue /></SelectTrigger>
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
                              handleAssignmentChange(index, 'startBib',
                                Number.isNaN(parseInt(e.target.value, 10)) ? 0 : parseInt(e.target.value, 10))
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
                              handleAssignmentChange(index, 'endBib',
                                Number.isNaN(parseInt(e.target.value, 10)) ? 0 : parseInt(e.target.value, 10))
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
                  ))
                )}
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
