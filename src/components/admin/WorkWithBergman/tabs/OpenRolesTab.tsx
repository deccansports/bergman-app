"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import jsPDF from 'jspdf';
import type { OpenRole } from '@/lib/types/workWithBergman';
import { createRolesForEventsAction, deleteRole, getOpenRoles, updateRole } from '@/lib/actions/workBergmanActions';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import type { EventCalendarEntry } from '@/lib/types/event';

export default function OpenRolesTab() {
  const [roles, setRoles] = useState<OpenRole[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<EventCalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingRoleSnapshot, setEditingRoleSnapshot] = useState<OpenRole | null>(null);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [reportingDatesByEvent, setReportingDatesByEvent] = useState<Record<string, string>>({});
  const [useSameConfigurationAcrossEvents, setUseSameConfigurationAcrossEvents] = useState(true);
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [numberRequired, setNumberRequired] = useState('1');
  const [paymentAmount, setPaymentAmount] = useState('0');
  const [reportingDate, setReportingDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [requiredSkills, setRequiredSkills] = useState('');
  const [reportingInstructions, setReportingInstructions] = useState('');
  const [selectedRoleForPreview, setSelectedRoleForPreview] = useState<OpenRole | null>(null);

  const loadRoles = async () => {
    setLoading(true);
    const [rolesResult, eventsResult] = await Promise.all([
      getOpenRoles(),
      getCalendarEventsAction(),
    ]);

    setRoles(rolesResult);
    setUpcomingEvents(eventsResult.success && eventsResult.events ? eventsResult.events : []);

    setLoading(false);
  };

  const upcomingOnlyEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const parseDate = (value?: string | null) => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    return upcomingEvents.filter((event) => {
      const refDate = parseDate(event.endDate) || parseDate(event.eventDate);
      if (!refDate) return false;
      refDate.setHours(0, 0, 0, 0);
      return refDate.getTime() >= today.getTime();
    });
  }, [upcomingEvents]);

  const selectedEvent = useMemo(
    () => upcomingOnlyEvents.find((event) => event.id === selectedEventId) || null,
    [upcomingOnlyEvents, selectedEventId]
  );

  const resolveEventName = (eventId: string, fallback?: string) => {
    const matched = upcomingOnlyEvents.find((event) => event.id === eventId);
    const fallbackName = String(fallback || '').trim();
    const resolved = String(matched?.eventName || fallbackName || eventId || 'Selected Event').trim();

    if (resolved === eventId && fallbackName && fallbackName !== eventId) {
      return fallbackName;
    }

    return resolved;
  };

  const resetForm = () => {
    setEditingRoleId(null);
    setEditingRoleSnapshot(null);
    setSelectedEventId('');
    setSelectedEventIds([]);
    setReportingDatesByEvent({});
    setUseSameConfigurationAcrossEvents(true);
    setRoleName('');
    setRoleDescription('');
    setCategory('General');
    setNumberRequired('1');
    setPaymentAmount('0');
    setReportingDate('');
    setStartDate('');
    setEndDate('');
    setRequiredSkills('');
    setReportingInstructions('');
  };

  const toDateInput = (value: unknown): string => {
    if (!value) return '';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  };

  const handleEditRole = (role: OpenRole) => {
    setEditingRoleId(role.id);
    setEditingRoleSnapshot(role);
    setSelectedEventId(role.eventId || '');
    setSelectedEventIds(role.eventId ? [role.eventId] : []);
    setReportingDatesByEvent(role.eventId ? { [role.eventId]: toDateInput(role.reportingDate || role.startDate) } : {});
    setUseSameConfigurationAcrossEvents(true);
    setRoleName(role.roleName || '');
    setRoleDescription(role.roleDescription || '');
    setCategory(role.category || 'General');
    setNumberRequired(String(role.numberRequired || 1));
    setPaymentAmount(String(role.paymentAmount || 0));
    setReportingDate(toDateInput(role.reportingDate || role.startDate));
    setStartDate(toDateInput(role.startDate));
    setEndDate(toDateInput(role.endDate));
    setRequiredSkills((role.requiredSkills || []).join(', '));
    setReportingInstructions(String(role.reportingInstructions || ''));
    setStatusMessage(`Editing role: ${role.roleName}`);
  };

  const toggleApplicableEvent = (eventId: string, checked: boolean) => {
    setSelectedEventIds((prev) => {
      if (checked) {
        return prev.includes(eventId) ? prev : [...prev, eventId];
      }
      return prev.filter((id) => id !== eventId);
    });

    setReportingDatesByEvent((prev) => {
      if (checked) {
        const alreadySet = prev[eventId];
        if (alreadySet) return prev;
        const event = upcomingOnlyEvents.find((item) => item.id === eventId);
        const fallback = toDateInput(event?.eventDate || event?.endDate || '');
        return { ...prev, [eventId]: fallback };
      }

      if (!(eventId in prev)) return prev;
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
  };

  const sanitizeFileName = (value: string) => String(value || 'role').trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'role';

  const downloadRoleAgreementPdf = (role: OpenRole) => {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    const lineHeight = 6;
    let y = 16;

    const ensureSpace = (needed: number) => {
      if (y + needed <= pageHeight - margin) return;
      doc.addPage();
      y = 16;
    };

    const addHeader = (title: string, subtitle: string) => {
      doc.setFillColor(9, 18, 36);
      doc.rect(0, 0, pageWidth, 28, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text('BERGMAN TRIATHLON', pageWidth / 2, 10, { align: 'center' });
      doc.setFontSize(10);
      doc.text('WORK WITH BERGMAN', pageWidth / 2, 16, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('OFFICIALS, VOLUNTEERS & FREELANCERS', pageWidth / 2, 22, { align: 'center' });
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(title, margin, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(subtitle, margin, 46);
      y = 54;
    };

    const addWrapped = (text: string, fontSize = 10.5) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fontSize);
      const lines = doc.splitTextToSize(text, contentWidth) as string[];
      lines.forEach((line) => {
        ensureSpace(lineHeight);
        doc.text(line, margin, y);
        y += lineHeight;
      });
      y += 1;
    };

    const addSection = (title: string, bullets: string[] | string) => {
      const bulletList = Array.isArray(bullets) ? bullets : [bullets];
      const estimated = 10 + bulletList.length * 7 + 4;
      ensureSpace(estimated);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, y, contentWidth, estimated, 3, 3, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(title, margin + 4, y + 7);
      let cursorY = y + 14;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      bulletList.forEach((item) => {
        const wrapped = doc.splitTextToSize(`• ${item}`, contentWidth - 8) as string[];
        wrapped.forEach((line) => {
          doc.text(line, margin + 4, cursorY);
          cursorY += 5.2;
        });
      });
      y += estimated + 4;
    };

    const eventName = role.eventName || 'Selected Event';
    const resolvedEventName = resolveEventName(role.eventId, role.eventName);
    const eventDates = `${role.startDate ? new Date(role.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'TBD'}${role.endDate && String(role.endDate) !== String(role.startDate) ? ` - ${new Date(role.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}`;
    const reportingDate = role.reportingDate ? new Date(role.reportingDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'TBD';
    const honorarium = `₹${Number(role.paymentAmount || 0).toLocaleString('en-IN')}`;
    const reportingTo = role.reportingManager || role.reportingManagerId || role.reportingInstructions || 'TBD';

    addHeader('Rules, Regulations & Waiver Agreement', `${role.roleName || 'Role'} · ${resolvedEventName}`);
    addWrapped(`Event Honorarium: ${honorarium} · Reporting To: ${reportingTo} · Reporting Date: ${reportingDate} · Event Dates: ${eventDates} · Vacancies: ${Math.max(0, Number(role.numberRequired || 0) - Number(role.numberAssigned || 0))}`);

    addSection('1. ROLE ACCEPTANCE', [
      'I have read and understood the role description.',
      'I possess the skills, qualifications, and experience required for the assigned role.',
      'I agree to perform my duties professionally and responsibly.',
      'I understand that role assignments may change based on event requirements.',
    ]);
    addSection('2. ATTENDANCE & REPORTING', [
      'I will report at the designated time and location provided by the event organizers.',
      'I will attend all mandatory briefings, training sessions, and meetings.',
      'I will notify the event team immediately if I am unable to attend.',
      'Repeated no-shows may affect future opportunities with Bergman.',
    ]);
    addSection('3. CODE OF CONDUCT', [
      'Treat athletes, volunteers, officials, sponsors, partners, spectators, and staff with respect.',
      'Maintain professionalism at all times.',
      'Follow instructions from the Race Director, Event Director, Chief Referee, and designated supervisors.',
      'Represent Bergman Triathlon positively.',
      'Do not harass, discriminate, intimidate, or abuse any individual.',
      'Do not use offensive language or inappropriate behaviour.',
      'Do not consume alcohol, narcotics, or prohibited substances while on duty.',
      'Do not engage in actions that may damage the reputation of Bergman Triathlon.',
    ]);
    addSection('4. SAFETY REQUIREMENTS', [
      'I will prioritize participant and public safety at all times.',
      'I will immediately report hazards, incidents, injuries, or emergencies.',
      'I will follow all safety protocols and emergency procedures.',
      'I will not perform tasks that I am not trained or authorized to perform.',
    ]);
    addSection('5. CONFIDENTIALITY', [
      'I may receive confidential information relating to athletes, sponsors, partners, operations, or event planning.',
      'I will not share confidential information without authorization.',
      'I will not distribute internal documents, contact information, or event data without permission.',
    ]);
    addSection('6. MEDIA & PHOTOGRAPHY CONSENT', 'I grant Bergman Triathlon and Deccan Sports Club permission to photograph, film, record, and use my image, voice, likeness, and name for promotional, marketing, educational, and media purposes without additional compensation.');
    addSection('7. COMPENSATION', [
      'I understand that the stated honorarium is a fixed event-based amount and not a daily rate unless specifically stated otherwise.',
      'Payment, if applicable, will be processed according to Bergman policies and may be subject to verification of attendance and completion of assigned duties.',
      'Travel, accommodation, meals, or other expenses are not included unless explicitly approved by the organizers.',
    ]);
    addSection('8. EQUIPMENT & PROPERTY', [
      'Any event equipment, uniforms, radios, credentials, or materials provided remain the property of Bergman Triathlon.',
      'I agree to return all issued items upon request.',
      'I may be responsible for damage caused through negligence or misuse.',
    ]);
    addSection('9. LIABILITY WAIVER', [
      'I understand that participation in event operations may involve physical activity, travel, outdoor conditions, traffic exposure, water environments, and other inherent risks.',
      'I voluntarily assume all risks associated with my participation.',
      'I release and hold harmless Deccan Sports Club, Bergman Triathlon, event organizers, sponsors, partners, venues, government authorities, volunteers, contractors, and staff from any claims, injuries, losses, damages, liabilities, or expenses arising from my participation except where prohibited by law.',
    ]);
    addSection('10. TERMINATION OF ASSIGNMENT', [
      'Remove or reassign personnel at any time.',
      'Terminate assignments due to misconduct, safety concerns, rule violations, non-performance, or operational requirements.',
      'Withhold accreditation or future assignments where justified.',
    ]);
    addSection('12. REPORTING OFF DUTY & DEPARTURE', [
      'I am required to remain available for my assigned duties until officially released by my designated Team Leader, Director, or Event Supervisor.',
      'I will not leave my assigned location, venue, course, transition area, aid station, or event site without informing and obtaining approval from my Team Leader, Director, or designated supervisor.',
      'I will report the completion of my assigned duties before leaving the event.',
      'I may be required to assist with event closeout, equipment collection, venue restoration, or operational wrap-up activities related to my role.',
      'My assignment shall be considered complete only after I have been formally released by my reporting supervisor.',
      'Leaving the event without notification or approval may be treated as abandonment of duties and may affect future assignments, payments, reimbursements, certifications, references, or opportunities with Bergman Triathlon.',
    ]);
    addSection('13. AGREEMENT', [
      'I have read and understood the role description.',
      'I have read and agree to the Rules, Regulations & Waiver Agreement.',
      'I understand the event honorarium and compensation terms.',
      'I agree to comply with all event policies and instructions.',
      'I voluntarily accept this assignment and associated responsibilities.',
    ]);

    const autoFillBoxHeight = 26;
    ensureSpace(autoFillBoxHeight);
    doc.setFillColor(9, 18, 36);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, contentWidth, autoFillBoxHeight, 3, 3, 'FD');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Name: Auto fill', margin + 4, y + 7);
    doc.text(`Role: ${role.roleName || 'Auto fill'}`, margin + 4, y + 13);
    doc.text(`Event: ${resolvedEventName}`, margin + 100, y + 7);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, margin + 100, y + 13);
    doc.setTextColor(0, 0, 0);

    ensureSpace(14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Digital Acceptance: Accepted via Work With Bergman Portal', margin, y + 8);

    doc.save(`${sanitizeFileName(role.roleName)}_Waiver_Agreement.pdf`);
  };

  const setEventReportingDate = (eventId: string, value: string) => {
    setReportingDatesByEvent((prev) => ({ ...prev, [eventId]: value }));
  };

  const handleDeleteRole = async (roleId: string, roleNameValue: string) => {
    const confirmed = window.confirm(`Delete role "${roleNameValue}"?`);
    if (!confirmed) return;

    setSaving(true);
    const result = await deleteRole(roleId);
    setSaving(false);

    if (result.success) {
      setStatusMessage('Role deleted successfully.');
      if (editingRoleId === roleId) resetForm();
      await loadRoles();
    } else {
      setStatusMessage(result.error || 'Failed to delete role.');
    }
  };

  const handleSaveRole = async () => {
    setSaving(true);
    setStatusMessage('');

    const commonRoleData = {
      roleName: roleName.trim(),
      roleDescription: roleDescription.trim(),
      category: category.trim(),
      numberRequired: Number(numberRequired) || 1,
      paymentAmount: Number(paymentAmount) || 0,
      requiredSkills: requiredSkills.split(',').map((s) => s.trim()).filter(Boolean),
      reportingInstructions: reportingInstructions.trim() || undefined,
      isActive: true,
    };

    if (editingRoleId) {
      const resolvedEvent = upcomingOnlyEvents.find((event) => event.id === selectedEventId) || null;
      const fallbackStart = resolvedEvent?.eventDate
        ? new Date(resolvedEvent.eventDate)
        : editingRoleSnapshot?.startDate
          ? new Date(String(editingRoleSnapshot.startDate))
          : new Date();
      const fallbackEnd = resolvedEvent?.endDate
        ? new Date(resolvedEvent.endDate)
        : resolvedEvent?.eventDate
          ? new Date(resolvedEvent.eventDate)
          : editingRoleSnapshot?.endDate
            ? new Date(String(editingRoleSnapshot.endDate))
            : fallbackStart;

      const payload = {
        eventId: resolvedEvent?.id || editingRoleSnapshot?.eventId || '',
        eventName: resolvedEvent?.eventName || editingRoleSnapshot?.eventName || '',
        ...commonRoleData,
        reportingDate: reportingDate ? new Date(reportingDate) : fallbackStart,
        startDate: startDate ? new Date(startDate) : fallbackStart,
        endDate: endDate ? new Date(endDate) : fallbackEnd,
      };

      const result = await updateRole(editingRoleId, payload);

      setSaving(false);

      if (result.success) {
        setStatusMessage('Role updated successfully.');
        resetForm();
        await loadRoles();
      } else {
        setStatusMessage(result.error || 'Failed to save role.');
      }

      return;
    }

    const eventIdsToUse = Array.from(new Set(selectedEventIds.filter(Boolean)));
    if (eventIdsToUse.length === 0) {
      setSaving(false);
      setStatusMessage('Select one or more applicable events first.');
      return;
    }

    const missingReportingDateForEvent = eventIdsToUse.find((eventId) => !reportingDatesByEvent[eventId]);
    if (missingReportingDateForEvent) {
      setSaving(false);
      setStatusMessage('Add reporting date for each selected event.');
      return;
    }

    const createResult = await createRolesForEventsAction({
      eventIds: eventIdsToUse,
      roleData: commonRoleData,
      useSameConfigurationAcrossEvents,
      perEventReportingDates: eventIdsToUse.reduce<Record<string, string>>((acc, eventId) => {
        acc[eventId] = reportingDatesByEvent[eventId];
        return acc;
      }, {}),
    });

    setSaving(false);

    if (createResult.success) {
      const createdCount = Number(createResult.createdCount || 0);
      setStatusMessage(
        createdCount > 1
          ? `Role created for ${createdCount} events successfully.`
          : 'Role saved successfully.'
      );
      resetForm();
      await loadRoles();
    } else {
      setStatusMessage(createResult.error || 'Failed to save role.');
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  useEffect(() => {
    const validEventIds = new Set(upcomingOnlyEvents.map((event) => event.id));

    setSelectedEventIds((prev) => {
      const next = prev.filter((id) => validEventIds.has(id));
      return next.length === prev.length ? prev : next;
    });

    setReportingDatesByEvent((prev) => {
      const selectedSet = new Set(selectedEventIds.filter((id) => validEventIds.has(id)));
      const nextEntries = Object.entries(prev).filter(([eventId]) => selectedSet.has(eventId));
      if (nextEntries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(nextEntries);
    });

    if (editingRoleId) {
      if (!validEventIds.has(selectedEventId)) {
        setSelectedEventId(upcomingOnlyEvents[0]?.id || '');
      }
      return;
    }

    if (selectedEventId) {
      setSelectedEventId('');
    }
  }, [upcomingOnlyEvents, selectedEventId, editingRoleId, selectedEventIds]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Open Roles</h2>
          <p className="text-sm text-gray-600 mt-1">Live event staffing roles from Firestore</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadRoles}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={handleSaveRole} disabled={saving}>
            <Plus className="w-4 h-4 mr-2" />
            {editingRoleId ? 'Update Role' : 'Save Role'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{editingRoleId ? 'Edit Role' : 'Create / Save Role'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            {editingRoleId ? (
              <>
                <Label>Upcoming Event</Label>
                <Select value={selectedEventId} onValueChange={setSelectedEventId}>
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder="Select an upcoming event" />
                  </SelectTrigger>
                  <SelectContent>
                    {upcomingOnlyEvents.length > 0 ? upcomingOnlyEvents.map((event) => (
                      <SelectItem key={event.id} value={event.id}>
                        {event.eventName}{event.displayDateRange ? ` — ${event.displayDateRange}` : event.eventDate ? ` — ${event.eventDate}` : ''}
                      </SelectItem>
                    )) : (
                      <SelectItem value="__none__" disabled>No upcoming events found</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {selectedEvent ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Selected: {selectedEvent.eventName}{selectedEvent.displayDateRange ? ` · ${selectedEvent.displayDateRange}` : ''}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <Label>Applicable Events</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Select one or more events for which this role should be available.
                </p>
                <div className="mt-2 max-h-56 overflow-y-auto rounded-md border p-2 space-y-2">
                  {upcomingOnlyEvents.length > 0 ? upcomingOnlyEvents.map((event) => {
                    const checked = selectedEventIds.includes(event.id);
                    return (
                      <label key={event.id} className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/40 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          onChange={(e) => toggleApplicableEvent(event.id, e.target.checked)}
                        />
                        <span className="text-sm">
                          {event.eventName}
                          {(event.displayDateRange || event.eventDate) ? (
                            <span className="text-muted-foreground"> — {event.displayDateRange || event.eventDate}</span>
                          ) : null}
                        </span>
                      </label>
                    );
                  }) : (
                    <p className="text-sm text-muted-foreground p-2">No upcoming events found.</p>
                  )}
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useSameConfigurationAcrossEvents}
                    onChange={(e) => setUseSameConfigurationAcrossEvents(e.target.checked)}
                  />
                  Use same role configuration across all selected events
                </label>
              </>
            )}
          </div>
          <div>
            <Label>Role Name</Label>
            <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} className="mt-2" placeholder="Swim Marshal" />
          </div>
          <div>
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-2" placeholder="General" />
          </div>
          <div>
            <Label>Positions Required</Label>
            <Input type="number" min={1} value={numberRequired} onChange={(e) => setNumberRequired(e.target.value)} className="mt-2" />
          </div>
          <div>
            <Label>Payment Amount</Label>
            <Input type="number" min={0} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="mt-2" />
          </div>
          {editingRoleId ? (
            <div className="md:col-span-2 rounded-md border p-3 space-y-2">
              <p className="text-sm font-medium">Reporting Date</p>
              <p className="text-xs text-muted-foreground">
                Event start and end dates are taken from the selected event automatically. Only the reporting date is editable here.
              </p>
              <div>
                <Label>Reporting Date</Label>
                <Input type="date" value={reportingDate} onChange={(e) => setReportingDate(e.target.value)} className="mt-2" />
              </div>
            </div>
          ) : (
            <div className="md:col-span-2 rounded-md border p-3 space-y-2">
              <p className="text-sm font-medium">Event Date & Reporting Date</p>
              <p className="text-xs text-muted-foreground">
                Event start/end dates are taken automatically from each selected event. Add reporting date for each selected event.
              </p>
              <div className="space-y-2">
                {selectedEventIds.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Select events above to add reporting dates.</p>
                ) : selectedEventIds.map((eventId) => {
                  const event = upcomingOnlyEvents.find((item) => item.id === eventId);
                  return (
                    <div key={eventId} className="grid gap-2 rounded border p-2 md:grid-cols-[1fr_auto] md:items-center">
                      <div>
                        <p className="text-sm font-medium">{event?.eventName || eventId}</p>
                        <p className="text-xs text-muted-foreground">
                          Event Date: {event?.displayDateRange || event?.eventDate || 'From event calendar'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs">Reporting Date</Label>
                        <Input
                          type="date"
                          value={reportingDatesByEvent[eventId] || ''}
                          onChange={(e) => setEventReportingDate(eventId, e.target.value)}
                          className="mt-1 w-full md:w-[180px]"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="md:col-span-2">
            <Label>Role Description</Label>
            <Textarea value={roleDescription} onChange={(e) => setRoleDescription(e.target.value)} className="mt-2" placeholder="Describe the role responsibilities" />
          </div>
          <div className="md:col-span-2">
            <Label>Reporting Instructions</Label>
            <Textarea value={reportingInstructions} onChange={(e) => setReportingInstructions(e.target.value)} className="mt-2" placeholder="Reporting point, manager contact, and briefing instructions" />
          </div>
          <div className="md:col-span-2">
            <Label>Required Skills</Label>
            <Input value={requiredSkills} onChange={(e) => setRequiredSkills(e.target.value)} className="mt-2" placeholder="First Aid, Communication, Cycling" />
          </div>
          <div className="md:col-span-2 flex flex-wrap gap-2 items-center">
            <Button onClick={handleSaveRole} disabled={saving}>{editingRoleId ? 'Update Role' : 'Save Role'}</Button>
            <Button variant="outline" onClick={resetForm} disabled={saving}>{editingRoleId ? 'Cancel Edit' : 'Clear'}</Button>
            {statusMessage ? <span className="text-sm text-muted-foreground">{statusMessage}</span> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available Roles</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading roles…</div>
          ) : roles.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No active roles found.</div>
          ) : (
            <div className="grid gap-3">
              {roles.map((role) => {
                const remaining = Math.max(0, role.numberRequired - (role.numberAssigned || 0));
                return (
                  <div
                    key={role.id}
                    className="rounded-lg border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setSelectedRoleForPreview(role)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedRoleForPreview(role);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open details for ${role.roleName}`}
                  >
                    <div>
                      <div className="font-medium">{role.roleName}</div>
                      <div className="text-sm text-muted-foreground">{resolveEventName(role.eventId, role.eventName)}</div>
                      <div className="text-xs text-muted-foreground mt-1">{role.category} · {role.paymentAmount ? `₹${role.paymentAmount}` : 'Paid role'}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">Required: {role.numberRequired}</Badge>
                      <Badge variant="outline">Assigned: {role.numberAssigned || 0}</Badge>
                      <Badge variant={remaining > 0 ? 'destructive' : 'default'}>Remaining: {remaining}</Badge>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleEditRole(role); }} disabled={saving}>
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); downloadRoleAgreementPdf(role); }} disabled={saving}>
                        Download Agreement
                      </Button>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleDeleteRole(role.id, role.roleName); }} disabled={saving}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedRoleForPreview} onOpenChange={(open) => !open && setSelectedRoleForPreview(null)}>
        <DialogContent className="sm:max-w-lg text-left">
          <DialogHeader>
            <DialogTitle>{selectedRoleForPreview?.roleName || 'Role details'}</DialogTitle>
            <DialogDescription>
              {selectedRoleForPreview
                ? resolveEventName(selectedRoleForPreview.eventId, selectedRoleForPreview.eventName)
                : 'Role information'}
            </DialogDescription>
          </DialogHeader>

          {selectedRoleForPreview && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Category:</span> {selectedRoleForPreview.category || 'General'}</div>
                <div><span className="text-muted-foreground">Payment:</span> ₹{selectedRoleForPreview.paymentAmount || 0}</div>
                <div><span className="text-muted-foreground">Required:</span> {selectedRoleForPreview.numberRequired || 0}</div>
                <div><span className="text-muted-foreground">Assigned:</span> {selectedRoleForPreview.numberAssigned || 0}</div>
              </div>

              <div>
                <div className="text-muted-foreground">Reporting To</div>
                <div>{selectedRoleForPreview.reportingManager || selectedRoleForPreview.reportingManagerId || selectedRoleForPreview.reportingInstructions || 'Not set'}</div>
              </div>

              <div>
                <div className="text-muted-foreground">Reporting Date</div>
                <div>{selectedRoleForPreview.reportingDate ? String(selectedRoleForPreview.reportingDate) : (selectedRoleForPreview.startDate ? String(selectedRoleForPreview.startDate) : 'Not set')}</div>
              </div>

              <div>
                <div className="text-muted-foreground">Description</div>
                <div>{selectedRoleForPreview.roleDescription || 'No description provided.'}</div>
              </div>

              <div>
                <div className="text-muted-foreground">Reporting Instructions</div>
                <div>{selectedRoleForPreview.reportingInstructions || 'No reporting instructions provided.'}</div>
              </div>

              <div>
                <div className="text-muted-foreground">Required Skills</div>
                <div>
                  {Array.isArray(selectedRoleForPreview.requiredSkills) && selectedRoleForPreview.requiredSkills.length > 0
                    ? selectedRoleForPreview.requiredSkills.join(', ')
                    : 'Not specified'}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
