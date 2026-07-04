"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, RefreshCw } from 'lucide-react';
import type { OpenRole, Payment, Worker, WorkerAssignment } from '@/lib/types/workWithBergman';
import {
  assignWorkerToRole,
  deleteAssignmentAction,
  getAllAssignments,
  getAllPaymentsAction,
  getAllWorkers,
  getOpenRoles,
  confirmAssignmentAction,
  revokeAssignmentAction,
  syncApprovedWorkWithBergmanApplicationsToAssignmentsAction,
  sendAssignmentNotificationAction,
  recordAssignmentPaymentAction,
  sendPaymentConfirmationEmailAction,
} from '@/lib/actions/workBergmanActions';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import type { EventCalendarEntry } from '@/lib/types/event';

export default function EventStaffingTab() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [roles, setRoles] = useState<OpenRole[]>([]);
  const [assignments, setAssignments] = useState<WorkerAssignment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [eventsById, setEventsById] = useState<Record<string, EventCalendarEntry>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedAssignment, setSelectedAssignment] = useState<WorkerAssignment | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    travelReimbursement: '0',
    paymentMethod: 'Bank Transfer' as Payment['paymentMethod'],
    transactionId: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      await syncApprovedWorkWithBergmanApplicationsToAssignmentsAction();
      const [workersRes, rolesRes, assignmentsRes, paymentsRes, calendarRes] = await Promise.all([
        getAllWorkers(),
        getOpenRoles(),
        getAllAssignments(),
        getAllPaymentsAction(),
        getCalendarEventsAction(),
      ]);

      setWorkers(workersRes.filter((w) => w.status === 'Active'));
      setRoles(rolesRes);
      setAssignments(assignmentsRes);
      setPayments(paymentsRes);

      const byId: Record<string, EventCalendarEntry> = {};
      if (calendarRes.success && Array.isArray(calendarRes.events)) {
        for (const event of calendarRes.events) {
          if (!event?.id) continue;
          byId[String(event.id)] = event;
        }
      }
      setEventsById(byId);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to load staffing data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const eventOptions = useMemo(() => {
    const map = new Map<string, string>();
    roles.forEach((role) => {
      if (!role.eventId) return;
      const resolvedName = eventsById[role.eventId]?.eventName || role.eventName || role.eventId;
      map.set(role.eventId, resolvedName);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [roles, eventsById]);

  const resolveEventName = (eventId: string, fallback?: string) => {
    const match = eventOptions.find((event) => event.id === eventId);
    return match?.name || fallback || eventId || 'Untitled Event';
  };

  const openAssignmentDetails = (assignment: WorkerAssignment) => {
    setSelectedAssignment(assignment);
  };

  const openPaymentTransfer = (assignment: WorkerAssignment) => {
    setSelectedAssignment(assignment);
    setPaymentForm({
      travelReimbursement: '0',
      paymentMethod: 'Bank Transfer',
      transactionId: '',
      paymentDate: new Date().toISOString().slice(0, 10),
      notes: '',
    });
    setPaymentDialogOpen(true);
  };

  const closeAssignmentDetails = () => {
    setSelectedAssignment(null);
  };

  const closePaymentDialog = () => {
    setPaymentDialogOpen(false);
  };

  const handleRevokeAssignment = async (assignmentId: string) => {
    const confirmed = window.confirm('Revoke this staff assignment and return the vacancy to the role?');
    if (!confirmed) return;

    setSaving(true);
    const result = await revokeAssignmentAction(assignmentId);
    setSaving(false);

    if (result.success) {
      setStatusMessage('Staff assignment revoked.');
      await loadData();
      if (selectedAssignment?.id === assignmentId) closeAssignmentDetails();
    } else {
      setStatusMessage(result.error || 'Failed to revoke assignment.');
    }
  };

  const handleDeleteAssignment = async (assignmentId: string) => {
    const confirmed = window.confirm('Delete this assignment permanently?');
    if (!confirmed) return;

    setSaving(true);
    const result = await deleteAssignmentAction(assignmentId);
    setSaving(false);

    if (result.success) {
      setStatusMessage('Staff assignment deleted.');
      await loadData();
      if (selectedAssignment?.id === assignmentId) closeAssignmentDetails();
    } else {
      setStatusMessage(result.error || 'Failed to delete assignment.');
    }
  };

  const handleSendAssignmentNotification = async (assignmentId: string, channel: 'Email' | 'WhatsApp') => {
    setSaving(true);
    const result = await sendAssignmentNotificationAction(assignmentId, channel);
    setSaving(false);

    if (result.success) {
      setStatusMessage(result.message || `${channel} sent.`);
    } else {
      setStatusMessage(result.error || `Failed to send ${channel.toLowerCase()}.`);
    }
  };

  const handleTransferAmount = async () => {
    if (!selectedAssignment) return;

    setSaving(true);
    const result = await recordAssignmentPaymentAction({
      assignmentId: selectedAssignment.id,
      travelReimbursement: Number(paymentForm.travelReimbursement || 0),
      paymentMethod: paymentForm.paymentMethod,
      transactionId: paymentForm.transactionId,
      paymentDate: paymentForm.paymentDate,
      notes: paymentForm.notes,
    });
    setSaving(false);

    if (result.success) {
      setStatusMessage(result.message || 'Payment recorded successfully.');
      closePaymentDialog();
      await loadData();
    } else {
      setStatusMessage(result.error || 'Failed to record payment.');
    }
  };

  const handleConfirmAssignment = async (assignmentId: string) => {
    setSaving(true);
    const result = await confirmAssignmentAction(assignmentId);
    setSaving(false);

    if (result.success) {
      setStatusMessage('Assignment confirmed and email sent.');
      await loadData();
      if (selectedAssignment?.id === assignmentId) {
        const updated = assignments.find((assignment) => assignment.id === assignmentId) || selectedAssignment;
        setSelectedAssignment(updated ? { ...updated, status: 'Confirmed', confirmedAt: new Date() } as WorkerAssignment : null);
      }
    } else {
      setStatusMessage(result.error || 'Failed to confirm assignment.');
    }
  };

  const roleOptions = useMemo(() => {
    if (!selectedEventId) return roles;
    return roles.filter((role) => role.eventId === selectedEventId);
  }, [roles, selectedEventId]);

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) || null,
    [roles, selectedRoleId]
  );

  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.id === selectedWorkerId) || null,
    [workers, selectedWorkerId]
  );

  const handleAssign = async () => {
    setStatusMessage('');

    if (!selectedRole || !selectedWorker) {
      setStatusMessage('Select event, role, and worker before assigning.');
      return;
    }

    setSaving(true);
    const result = await assignWorkerToRole({
      workerId: selectedWorker.id,
      workerName: selectedWorker.fullName,
      workerEmail: selectedWorker.email,
      roleId: selectedRole.id,
      roleName: selectedRole.roleName,
      eventId: selectedRole.eventId,
      eventName: resolveEventName(selectedRole.eventId, selectedRole.eventName),
      assignmentDate: new Date(),
      startDate: selectedRole.startDate,
      endDate: selectedRole.endDate,
      status: 'Pending',
      paymentAmount: selectedRole.paymentAmount,
      paymentStatus: 'Pending',
      assignedBy: 'Admin',
      notes: notes.trim() || undefined,
    });
    setSaving(false);

    if (result.success) {
      setStatusMessage('Worker assigned successfully.');
      setSelectedWorkerId('');
      setNotes('');
      await loadData();
    } else {
      setStatusMessage(result.error || 'Failed to assign worker.');
    }
  };

  const assignmentStats = useMemo(() => ({
    total: assignments.length,
    pending: assignments.filter((a) => a.status === 'Pending').length,
    confirmed: assignments.filter((a) => a.status === 'Confirmed').length,
    completed: assignments.filter((a) => a.status === 'Completed').length,
  }), [assignments]);

  const paymentStats = useMemo(() => ({
    count: payments.length,
    totalPaid: payments.reduce((sum, payment) => sum + Number(payment.totalAmount || payment.amount || 0), 0),
  }), [payments]);

  const getStatusVariant = (status: WorkerAssignment['status']) => {
    if (status === 'Confirmed' || status === 'Completed') return 'default';
    if (status === 'Declined' || status === 'Cancelled') return 'destructive';
    return 'secondary';
  };

  const selectedAssignmentWorker = useMemo(
    () => (selectedAssignment ? workers.find((worker) => worker.id === selectedAssignment.workerId) || null : null),
    [workers, selectedAssignment]
  );

  const selectedPayment = useMemo(
    () => (selectedAssignment ? payments.find((payment) => payment.assignmentId === selectedAssignment.id) || null : null),
    [payments, selectedAssignment]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Event Staffing</h2>
          <p className="text-sm text-gray-600 mt-1">Assign workers to event roles</p>
        </div>
        <div className="grid grid-cols-1 sm:flex gap-2">
          <Button variant="outline" onClick={loadData} disabled={loading || saving} className="w-full sm:w-auto">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={handleAssign} disabled={loading || saving} className="w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-2" />
            Assign Worker
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assign Worker</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Event</Label>
            <select
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedEventId}
              onChange={(e) => {
                setSelectedEventId(e.target.value);
                setSelectedRoleId('');
              }}
            >
              <option value="">Select Event</option>
              {eventOptions.map((event) => (
                <option key={event.id} value={event.id}>{event.name}</option>
              ))}
            </select>
          </div>

          <div>
            <Label>Role</Label>
            <select
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
            >
              <option value="">Select Role</option>
              {roleOptions.map((role) => (
                <option key={role.id} value={role.id}>{role.roleName} ({resolveEventName(role.eventId, role.eventName)})</option>
              ))}
            </select>
          </div>

          <div>
            <Label>Worker</Label>
            <select
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedWorkerId}
              onChange={(e) => setSelectedWorkerId(e.target.value)}
            >
              <option value="">Select Worker</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{worker.fullName} ({worker.email})</option>
              ))}
            </select>
          </div>

          <div>
            <Label>Notes</Label>
            <Input
              className="mt-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional assignment note"
            />
          </div>

          <div className="md:col-span-2 text-sm text-muted-foreground">
            {selectedRole ? (
              <div>
                Role window: {new Date(String(selectedRole.startDate)).toLocaleDateString()} - {new Date(String(selectedRole.endDate)).toLocaleDateString()} · Payment ₹{selectedRole.paymentAmount || 0} · Event: {resolveEventName(selectedRole.eventId, selectedRole.eventName)}
              </div>
            ) : (
              <div>Select a role to view assignment details.</div>
            )}
          </div>

          {statusMessage ? (
            <div className="md:col-span-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">{statusMessage}</div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="grid gap-3 sm:grid-cols-5">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Total Assignments</div>
              <div className="text-2xl font-bold">{assignmentStats.total}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Pending</div>
              <div className="text-2xl font-bold">{assignmentStats.pending}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Confirmed</div>
              <div className="text-2xl font-bold">{assignmentStats.confirmed}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Completed</div>
              <div className="text-2xl font-bold">{assignmentStats.completed}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Payments</div>
              <div className="text-2xl font-bold">{paymentStats.count}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Worker Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading assignments…</div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">No assignments yet</p>
              <p className="text-sm text-gray-400">Create roles and add workers to start assigning staff</p>
            </div>
          ) : (
            <div className="space-y-3">
              {assignments.map((assignment) => (
                <div key={assignment.id} className="rounded-lg border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <button
                      type="button"
                      className="font-medium text-left text-primary hover:underline"
                      onClick={() => openAssignmentDetails(assignment)}
                    >
                      {assignment.workerName}
                    </button>
                    <div className="text-sm text-muted-foreground">{assignment.workerEmail}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {assignment.roleName} · {resolveEventName(assignment.eventId, assignment.eventName)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(String(assignment.startDate)).toLocaleDateString()} - {new Date(String(assignment.endDate)).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={getStatusVariant(assignment.status)}>{assignment.status}</Badge>
                    <Badge variant="outline">₹{assignment.paymentAmount || 0}</Badge>
                    {assignment.paymentStatus === 'Paid' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => openAssignmentDetails(assignment)}
                        disabled={saving}
                        className="h-7 px-2.5"
                      >
                        Paid
                      </Button>
                    ) : (
                      <Badge variant="outline">{assignment.paymentStatus || 'Pending'}</Badge>
                    )}
                    {assignment.paymentStatus !== 'Paid' ? (
                      <Button size="sm" variant="secondary" onClick={() => openPaymentTransfer(assignment)} disabled={saving}>
                        Transfer Amount
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => openAssignmentDetails(assignment)}>
                      View Details
                    </Button>
                    {assignment.status !== 'Confirmed' ? (
                      <Button size="sm" onClick={() => handleConfirmAssignment(assignment.id)} disabled={saving}>
                        Confirm
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => handleRevokeAssignment(assignment.id)} disabled={saving}>
                      Revoke
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDeleteAssignment(assignment.id)} disabled={saving}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedAssignment && !paymentDialogOpen} onOpenChange={(open) => !open && closeAssignmentDetails()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedAssignment ? (
            <>
              <DialogHeader>
                <DialogTitle>{selectedAssignment.workerName}</DialogTitle>
                <DialogDescription>
                  {selectedAssignment.roleName} · {resolveEventName(selectedAssignment.eventId, selectedAssignment.eventName)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><span className="font-medium">Email:</span> {selectedAssignment.workerEmail}</div>
                  <div><span className="font-medium">Mobile:</span> {selectedAssignmentWorker?.whatsappNumber || '—'}</div>
                  <div><span className="font-medium">Status:</span> {selectedAssignment.status}</div>
                  <div><span className="font-medium">Payment:</span> ₹{selectedAssignment.paymentAmount || 0}</div>
                  <div><span className="font-medium">Payment Status:</span> {selectedAssignment.paymentStatus || 'Pending'}</div>
                  <div><span className="font-medium">Role Window:</span> {new Date(String(selectedAssignment.startDate)).toLocaleDateString()} - {new Date(String(selectedAssignment.endDate)).toLocaleDateString()}</div>
                  <div><span className="font-medium">Assigned By:</span> {selectedAssignment.assignedBy || 'Admin'}</div>
                </div>

                {selectedPayment ? (
                  <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
                    <div className="font-medium">Transaction Details</div>
                    <div>Honorarium: ₹{Number(selectedPayment.honorarium || 0).toLocaleString('en-IN')}</div>
                    <div>Travel Reimbursement: ₹{Number(selectedPayment.travelReimbursement || 0).toLocaleString('en-IN')}</div>
                    <div>Total Amount: ₹{Number(selectedPayment.totalAmount || selectedPayment.amount || 0).toLocaleString('en-IN')}</div>
                    <div>Payment Date: {selectedPayment.paymentDate ? new Date(String(selectedPayment.paymentDate)).toLocaleDateString('en-IN') : selectedPayment.paidDate ? new Date(String(selectedPayment.paidDate)).toLocaleDateString('en-IN') : '—'}</div>
                    <div>Payment Method: {selectedPayment.paymentMethod}</div>
                    <div>Transaction / UTR Number: {selectedPayment.transactionId || '—'}</div>
                  </div>
                ) : null}

                {selectedAssignmentWorker ? (
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                    <div className="font-medium">Worker Profile</div>
                    <div>Name: {selectedAssignmentWorker.fullName}</div>
                    <div>Mobile: {selectedAssignmentWorker.whatsappNumber || '—'}</div>
                    <div>City: {selectedAssignmentWorker.city || '—'}{selectedAssignmentWorker.state ? `, ${selectedAssignmentWorker.state}` : ''}</div>
                    <div>Travel Availability: {selectedAssignmentWorker.travelAvailability || '—'}</div>
                  </div>
                ) : null}

                {selectedAssignmentWorker ? (
                  <div className="rounded-lg border bg-background p-4 space-y-2">
                    <div className="font-medium">Bank Details</div>
                    <div>Account Holder Name: {selectedAssignmentWorker.bankAccountName || '—'}</div>
                    <div>Account Number: {selectedAssignmentWorker.bankAccountNumber || '—'}</div>
                    <div>IFSC Code: {selectedAssignmentWorker.ifscCode || '—'}</div>
                    <div>UPI ID: {selectedAssignmentWorker.upiId || '—'}</div>
                    <div>PAN Number: {selectedAssignmentWorker.panNumber || '—'}</div>
                  </div>
                ) : null}

                {selectedAssignment.notes ? (
                  <div>
                    <div className="font-medium mb-1">Notes</div>
                    <p className="text-muted-foreground whitespace-pre-wrap">{selectedAssignment.notes}</p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {selectedAssignment.paymentStatus !== 'Paid' ? (
                    <Button type="button" onClick={() => openPaymentTransfer(selectedAssignment)} disabled={saving}>
                      Transfer Amount
                    </Button>
                  ) : selectedPayment ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={async () => {
                        setSaving(true);
                        const result = await sendPaymentConfirmationEmailAction(selectedPayment.id);
                        setSaving(false);
                        setStatusMessage(result.success ? result.message || 'Payment email sent.' : result.error || 'Failed to send payment email.');
                      }}
                      disabled={saving}
                    >
                      Send Payment Email
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" onClick={() => handleSendAssignmentNotification(selectedAssignment.id, 'Email')} disabled={saving}>
                    Send Email
                  </Button>
                  <Button type="button" variant="outline" onClick={() => handleSendAssignmentNotification(selectedAssignment.id, 'WhatsApp')} disabled={saving}>
                    Send WhatsApp
                  </Button>
                  {selectedAssignment.status !== 'Confirmed' ? (
                    <Button type="button" onClick={() => handleConfirmAssignment(selectedAssignment.id)} disabled={saving}>
                      Confirm & Send Email
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" onClick={() => handleRevokeAssignment(selectedAssignment.id)} disabled={saving}>
                    Revoke Staff
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => handleDeleteAssignment(selectedAssignment.id)} disabled={saving}>
                    Delete Assignment
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen && !!selectedAssignment} onOpenChange={(open) => !open && closePaymentDialog()}>
        <DialogContent className="max-w-xl">
          {selectedAssignment ? (
            <>
              <DialogHeader>
                <DialogTitle>Transfer Amount</DialogTitle>
                <DialogDescription>
                  Record a transfer and send the payment confirmation email.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><span className="font-medium">Worker:</span> {selectedAssignment.workerName}</div>
                  <div><span className="font-medium">Event:</span> {resolveEventName(selectedAssignment.eventId, selectedAssignment.eventName)}</div>
                  <div><span className="font-medium">Role:</span> {selectedAssignment.roleName}</div>
                  <div><span className="font-medium">Honorarium:</span> ₹{selectedAssignment.paymentAmount || 0}</div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="transfer-travel">Travel Reimbursement</Label>
                    <Input
                      id="transfer-travel"
                      type="number"
                      min="0"
                      value={paymentForm.travelReimbursement}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, travelReimbursement: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="transfer-method">Payment Method</Label>
                    <select
                      id="transfer-method"
                      className="mt-0 h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={paymentForm.paymentMethod}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, paymentMethod: e.target.value as Payment['paymentMethod'] }))}
                    >
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="UPI">UPI</option>
                      <option value="Cash">Cash</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="transfer-utr">Transaction / UTR Number</Label>
                    <Input
                      id="transfer-utr"
                      value={paymentForm.transactionId}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, transactionId: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="transfer-date">Payment Date</Label>
                    <Input
                      id="transfer-date"
                      type="date"
                      value={paymentForm.paymentDate}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, paymentDate: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="transfer-notes">Notes</Label>
                  <textarea
                    id="transfer-notes"
                    className="min-h-[96px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={paymentForm.notes}
                    onChange={(e) => setPaymentForm((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Optional payment notes"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={closePaymentDialog} disabled={saving}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleTransferAmount} disabled={saving}>
                    Record Transfer
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
