"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, RefreshCw, Send } from 'lucide-react';
import type { Worker, Communication, CommunicationTemplate } from '@/lib/types/workWithBergman';
import type { OpenRole, WorkerAssignment } from '@/lib/types/workWithBergman';
import type { EventCalendarEntry } from '@/lib/types/event';
import {
  createCommunicationTemplateAction,
  getAllWorkers,
  getAllAssignments,
  getCommunicationCampaignsAction,
  getCommunicationTemplatesAction,
  getOpenRoles,
  sendCommunicationCampaignAction,
} from '@/lib/actions/workBergmanActions';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';

export default function CommunicationsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [assignments, setAssignments] = useState<WorkerAssignment[]>([]);
  const [openRoles, setOpenRoles] = useState<OpenRole[]>([]);
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [templates, setTemplates] = useState<CommunicationTemplate[]>([]);
  const [campaigns, setCampaigns] = useState<Communication[]>([]);

  const [campaignType, setCampaignType] = useState<'Email' | 'WhatsApp'>('Email');
  const [campaignName, setCampaignName] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailHtmlBody, setEmailHtmlBody] = useState('');
  const [whatsAppBody, setWhatsAppBody] = useState('');
  const [whatsAppTemplateParamsText, setWhatsAppTemplateParamsText] = useState('');

  const [recipientMode, setRecipientMode] = useState<'all' | 'accepted' | 'selected' | 'single' | 'event' | 'role'>('all');
  const [singleWorkerId, setSingleWorkerId] = useState('');
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [workerSearch, setWorkerSearch] = useState('');

  const [statusMessage, setStatusMessage] = useState('');
  const [statusTone, setStatusTone] = useState<'idle' | 'success' | 'error'>('idle');

  const showStatus = (message: string, tone: 'success' | 'error') => {
    setStatusMessage(message);
    setStatusTone(tone);
  };

  const isUpcomingEvent = useCallback((event: EventCalendarEntry) => {
    const referenceDate = event.endDate || event.eventDate;
    if (!referenceDate) return false;

    const parsedDate = new Date(referenceDate);
    if (Number.isNaN(parsedDate.getTime())) return false;

    parsedDate.setHours(23, 59, 59, 999);
    return parsedDate.getTime() >= Date.now();
  }, []);

  const isValidEmail = (value?: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  const isValidPhone = (value?: string) => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 14;
  };
  const isLikelyWorkerName = (value?: string) => {
    const name = String(value || '').trim();
    if (!name || name.length < 2 || name.length > 80) return false;
    if (name.includes('@')) return false;
    if (/https?:\/\//i.test(name)) return false;
    if (name.includes('\n')) return false;
    return /[A-Za-z]/.test(name);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [workersResult, assignmentsResult, rolesResult, calendarResult, templatesResult, campaignsResult] = await Promise.all([
        getAllWorkers(),
        getAllAssignments(),
        getOpenRoles(),
        getCalendarEventsAction(),
        getCommunicationTemplatesAction(),
        getCommunicationCampaignsAction(),
      ]);

      setWorkers(workersResult);
      setAssignments(assignmentsResult);
      setOpenRoles(rolesResult.filter((role) => role.isActive));
      setEvents(calendarResult.success && calendarResult.events ? calendarResult.events : []);
      setTemplates(templatesResult);
      setCampaigns(campaignsResult);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to load communications data.');
      setStatusTone('error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const eligibleWorkers = useMemo(() => {
    return workers.filter((worker) => {
      if (!isLikelyWorkerName(worker.fullName)) return false;
      if (campaignType === 'Email') return isValidEmail(worker.email);
      return isValidPhone(worker.whatsappNumber);
    });
  }, [workers, campaignType]);

  const acceptedWorkers = useMemo(() => {
    return eligibleWorkers.filter((worker) => worker.isRecruitmentApproved);
  }, [eligibleWorkers]);

  const filteredWorkers = useMemo(() => {
    const query = workerSearch.trim().toLowerCase();
    if (!query) return eligibleWorkers;
    return eligibleWorkers.filter((worker) =>
      String(worker.fullName || '').toLowerCase().includes(query) ||
      String(worker.email || '').toLowerCase().includes(query)
    );
  }, [eligibleWorkers, workerSearch]);

  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => {
      const status = String(assignment.status || '').trim();
      return status !== 'Cancelled' && status !== 'Declined';
    }),
    [assignments]
  );

  const eventRecipientWorkers = useMemo(() => {
    if (!selectedEventId) return [] as Worker[];
    const workerIds = new Set(
      activeAssignments
        .filter((assignment) => String(assignment.eventId || '').trim() === selectedEventId)
        .map((assignment) => String(assignment.workerId || '').trim())
        .filter(Boolean)
    );

    return eligibleWorkers.filter((worker) => workerIds.has(worker.id));
  }, [activeAssignments, eligibleWorkers, selectedEventId]);

  const roleRecipientWorkers = useMemo(() => {
    if (!selectedRoleId) return [] as Worker[];
    const workerIds = new Set(
      activeAssignments
        .filter((assignment) => String(assignment.roleId || '').trim() === selectedRoleId)
        .map((assignment) => String(assignment.workerId || '').trim())
        .filter(Boolean)
    );

    return eligibleWorkers.filter((worker) => workerIds.has(worker.id));
  }, [activeAssignments, eligibleWorkers, selectedRoleId]);

  const roleOptionsForSelectedEvent = useMemo(() => {
    if (!selectedEventId) return openRoles;
    return openRoles.filter((role) => String(role.eventId || '').trim() === selectedEventId);
  }, [openRoles, selectedEventId]);

  const upcomingEvents = useMemo(
    () => events.filter((event) => isUpcomingEvent(event)),
    [events, isUpcomingEvent]
  );

  const selectedCount = useMemo(() => {
    if (recipientMode === 'all') return eligibleWorkers.length;
    if (recipientMode === 'accepted') return acceptedWorkers.length;
    if (recipientMode === 'event') return eventRecipientWorkers.length;
    if (recipientMode === 'role') return roleRecipientWorkers.length;
    if (recipientMode === 'single') return singleWorkerId ? 1 : 0;
    return selectedWorkerIds.length;
  }, [acceptedWorkers.length, recipientMode, eligibleWorkers.length, eventRecipientWorkers.length, roleRecipientWorkers.length, singleWorkerId, selectedWorkerIds.length]);

  useEffect(() => {
    const allowedIds = new Set(eligibleWorkers.map((worker) => worker.id));
    setSelectedWorkerIds((prev) => prev.filter((id) => allowedIds.has(id)));
    if (singleWorkerId && !allowedIds.has(singleWorkerId)) {
      setSingleWorkerId('');
    }
  }, [eligibleWorkers, singleWorkerId]);

  useEffect(() => {
    if (!selectedEventId) return;
    const allowedIds = new Set(upcomingEvents.map((event) => event.id));
    if (!allowedIds.has(selectedEventId)) {
      setSelectedEventId('');
      setSelectedRoleId('');
    }
  }, [selectedEventId, upcomingEvents]);

  const selectedWorker = eligibleWorkers.find((worker) => worker.id === singleWorkerId) || null;

  const recipientWorkers = useMemo(() => {
    if (recipientMode === 'all') return eligibleWorkers;
    if (recipientMode === 'accepted') return acceptedWorkers;
    if (recipientMode === 'event') return eventRecipientWorkers;
    if (recipientMode === 'role') return roleRecipientWorkers;
    if (recipientMode === 'single') return selectedWorker ? [selectedWorker] : [];
    return eligibleWorkers.filter((worker) => selectedWorkerIds.includes(worker.id));
  }, [acceptedWorkers, eligibleWorkers, recipientMode, eventRecipientWorkers, roleRecipientWorkers, selectedWorker, selectedWorkerIds]);

  const toggleWorkerSelection = (workerId: string, checked: boolean) => {
    setSelectedWorkerIds((prev) => {
      if (checked) {
        return prev.includes(workerId) ? prev : [...prev, workerId];
      }
      return prev.filter((id) => id !== workerId);
    });
  };

  const handleSaveTemplate = async () => {
    const body = campaignType === 'Email' ? emailHtmlBody.trim() : whatsAppBody.trim();

    setSaving(true);
    setStatusMessage('');

    const result = await createCommunicationTemplateAction({
      name: campaignName.trim(),
      type: campaignType,
      subject: campaignType === 'Email' ? emailSubject.trim() : undefined,
      body,
      category: 'Other',
    });

    setSaving(false);

    if (result.success) {
      showStatus('Template saved successfully.', 'success');
      await loadAll();
    } else {
      showStatus(result.error || 'Failed to save template.', 'error');
    }
  };

  const handleSendCampaign = async () => {
    const body = campaignType === 'Email' ? emailHtmlBody.trim() : whatsAppBody.trim();
    const whatsAppTemplateParams = campaignType === 'WhatsApp'
      ? whatsAppTemplateParamsText
          .split(/\n|,/g)
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    setSaving(true);
    setStatusMessage('');

    const result = await sendCommunicationCampaignAction({
      type: campaignType,
      campaignName: campaignName.trim(),
      subject: campaignType === 'Email' ? emailSubject.trim() : undefined,
      body,
      whatsAppTemplateParams,
      recipientMode,
      selectedWorkerIds,
      singleWorkerId,
      eventId: selectedEventId || undefined,
      roleId: selectedRoleId || undefined,
    });

    setSaving(false);

    if (result.success) {
      showStatus(result.message || 'Campaign sent successfully.', 'success');
      await loadAll();
    } else {
      showStatus(result.error || 'Failed to send campaign.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Communications</h2>
          <p className="text-sm text-gray-600 mt-1">Send emails and WhatsApp messages to workers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadAll} disabled={loading || saving}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => {
            setCampaignType('Email');
            setCampaignName('');
            setEmailSubject('');
            setEmailHtmlBody('');
            setWhatsAppBody('');
            setWhatsAppTemplateParamsText('');
            setRecipientMode('all');
            setSingleWorkerId('');
            setSelectedWorkerIds([]);
            setSelectedEventId('');
            setSelectedRoleId('');
          }}>
            <Plus className="w-4 h-4 mr-2" />
            New Campaign
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Campaign</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Campaign Type</Label>
              <select
                className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={campaignType}
                onChange={(e) => setCampaignType(e.target.value as 'Email' | 'WhatsApp')}
              >
                <option value="Email">Send Email</option>
                <option value="WhatsApp">Send WhatsApp</option>
              </select>
            </div>

            <div>
              <Label>Campaign Name</Label>
              <Input
                className="mt-2"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="June Volunteer Outreach"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Recipients</Label>
              <select
                className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={recipientMode}
                onChange={(e) => setRecipientMode(e.target.value as 'all' | 'accepted' | 'selected' | 'single' | 'event' | 'role')}
              >
                <option value="all">All Workers</option>
                <option value="accepted">Accepted Workers</option>
                <option value="event">Event-wise Staffing</option>
                <option value="role">Role-wise Staffing</option>
                <option value="selected">Selected Workers</option>
                <option value="single">Only One Worker</option>
              </select>
            </div>

            <div className="flex items-end">
              <div className="rounded-md border px-3 py-2 text-sm w-full">
                Estimated recipients: <span className="font-semibold">{selectedCount}</span>
              </div>
            </div>
          </div>

          {recipientMode === 'single' ? (
            <div>
              <Label>Select Worker</Label>
              <select
                className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={singleWorkerId}
                onChange={(e) => setSingleWorkerId(e.target.value)}
              >
                <option value="">Select one worker</option>
                {eligibleWorkers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.fullName} ({worker.email || worker.whatsappNumber || 'No contact'})
                  </option>
                ))}
              </select>
              {selectedWorker ? (
                <p className="text-xs text-muted-foreground mt-2">
                  Selected: {selectedWorker.fullName} · {selectedWorker.email || selectedWorker.whatsappNumber || 'No contact'}
                </p>
              ) : null}
            </div>
          ) : null}

          {recipientMode === 'event' ? (
            <div>
              <Label>Select Event</Label>
              <select
                className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={selectedEventId}
                onChange={(e) => {
                  setSelectedEventId(e.target.value);
                  setSelectedRoleId('');
                }}
              >
                <option value="">Select event</option>
                {upcomingEvents.map((event) => (
                  <option key={event.id} value={event.id}>{event.eventName}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-2">
                Event staffing recipients: {eventRecipientWorkers.length}
              </p>
            </div>
          ) : null}

          {recipientMode === 'role' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Event (optional)</Label>
                <select
                  className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={selectedEventId}
                  onChange={(e) => {
                    setSelectedEventId(e.target.value);
                    setSelectedRoleId('');
                  }}
                >
                  <option value="">All events</option>
                  {upcomingEvents.map((event) => (
                    <option key={event.id} value={event.id}>{event.eventName}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Select Role</Label>
                <select
                  className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                >
                  <option value="">Select role</option>
                  {roleOptionsForSelectedEvent.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.roleName} ({role.eventName})
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 text-xs text-muted-foreground">
                Role staffing recipients: {roleRecipientWorkers.length}
              </div>
            </div>
          ) : null}

          {recipientMode === 'selected' ? (
            <div className="space-y-2">
              <Label>Select Workers</Label>
              <Input
                value={workerSearch}
                onChange={(e) => setWorkerSearch(e.target.value)}
                placeholder="Search by name or email"
              />
              <div className="max-h-52 overflow-y-auto rounded-md border p-2 space-y-1">
                {filteredWorkers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3 text-center">No workers found.</p>
                ) : (
                  filteredWorkers.map((worker) => {
                    const checked = selectedWorkerIds.includes(worker.id);
                    return (
                      <label key={worker.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/40 cursor-pointer">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleWorkerSelection(worker.id, !!value)}
                        />
                        <span className="text-sm">
                          {worker.fullName} <span className="text-muted-foreground">({worker.email || worker.whatsappNumber || 'No contact'})</span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          {campaignType === 'Email' ? (
            <>
              <div>
                <Label>Email Subject</Label>
                <Input
                  className="mt-2"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Welcome to Team Bergman"
                />
              </div>

              <div>
                <Label>Email HTML Body</Label>
                <Textarea
                  className="mt-2 min-h-[180px] font-mono text-xs"
                  value={emailHtmlBody}
                  onChange={(e) => setEmailHtmlBody(e.target.value)}
                  placeholder="<h1>Hi {{workerName}}</h1><p>Your next role is ready.</p>"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label>AiSensy Campaign Name</Label>
                <Input
                  className="mt-2"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="ordershipped"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Use the exact AiSensy template campaign name.
                </p>
              </div>

              <div>
                <Label>WhatsApp Template Params (in required order)</Label>
                <Textarea
                  className="mt-2 min-h-[120px]"
                  value={whatsAppTemplateParamsText}
                  onChange={(e) => setWhatsAppTemplateParamsText(e.target.value)}
                  placeholder={"Param 1\nParam 2\nParam 3"}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Enter one param per line (or comma separated), in the same order as your AiSensy campaign template placeholders.
                </p>
              </div>

              <div>
                <Label>WhatsApp Message (optional internal note)</Label>
                <Textarea
                  className="mt-2 min-h-[120px]"
                  value={whatsAppBody}
                  onChange={(e) => setWhatsAppBody(e.target.value)}
                  placeholder="Optional note for campaign record"
                />
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleSaveTemplate} disabled={loading || saving}>
              Save Template
            </Button>
            <Button onClick={handleSendCampaign} disabled={loading || saving}>
              <Send className="w-4 h-4 mr-2" />
              Save & Send
            </Button>
          </div>

          {statusMessage ? (
            <div className={`rounded-md border px-3 py-2 text-sm ${statusTone === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {statusMessage}
            </div>
          ) : null}

          <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Preview recipient pool: {recipientWorkers.length} worker{recipientWorkers.length === 1 ? '' : 's'}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Communication Templates</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading templates…</div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">No templates created yet</p>
              <p className="text-sm text-gray-400">Create reusable templates for common messages</p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => (
                <div key={template.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{template.name}</p>
                    <Badge variant="outline">{template.type}</Badge>
                    <Badge variant="secondary">{template.category}</Badge>
                  </div>
                  {template.subject ? <p className="text-xs text-muted-foreground mt-1">Subject: {template.subject}</p> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading campaigns…</div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No campaigns sent yet.</div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((campaign) => (
                <div key={campaign.id} className="rounded-lg border p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-sm">{campaign.templateName || 'Untitled Campaign'}</p>
                    <p className="text-xs text-muted-foreground">
                      {campaign.type} · {campaign.target} · {campaign.sentAt ? new Date(String(campaign.sentAt)).toLocaleString() : 'Not sent'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Sent: {campaign.sentCount || 0}</Badge>
                    <Badge variant={campaign.status === 'Sent' ? 'default' : 'secondary'}>{campaign.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
