"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw } from 'lucide-react';
import type { Application, OpenRole } from '@/lib/types/workWithBergman';
import {
  approveWorkWithBergmanApplicationAction,
  cancelRejectWorkWithBergmanApplicationAction,
  getAllApplicationsAction,
  getOpenRoles,
  rejectWorkWithBergmanApplicationAction,
} from '@/lib/actions/workBergmanActions';

export default function PendingApplicationsTab() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [openRoles, setOpenRoles] = useState<OpenRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [allApplications, roles] = await Promise.all([
      getAllApplicationsAction(),
      getOpenRoles(),
    ]);
    setApplications(allApplications);
    setOpenRoles(roles);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pendingApplications = useMemo(
    () => applications.filter((application) => application.status === 'Submitted'),
    [applications]
  );

  const rejectedApplications = useMemo(
    () => applications.filter((application) => application.status === 'Rejected'),
    [applications]
  );

  const pendingCount = useMemo(() => pendingApplications.length, [pendingApplications]);

  const roleById = useMemo(() => {
    const map = new Map<string, OpenRole>();
    openRoles.forEach((role) => map.set(role.id, role));
    return map;
  }, [openRoles]);

  const formatField = (value?: string | number | boolean | null) => {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  };

  const formatMultiValue = (values?: Array<string | undefined | null>) => {
    const filtered = (values || []).map((value) => String(value || '').trim()).filter(Boolean);
    return filtered.length ? filtered.join(', ') : '—';
  };

  const getPreferredRoleStatuses = (application: Application) => {
    const preferences = application.rolePreferenceDetails || [];
    return preferences.map((preference) => {
      const role = roleById.get(preference.roleId);
      const assigned = Number(role?.numberAssigned || 0);
      const required = Number(role?.numberRequired || 0);
      const remaining = Math.max(0, required - assigned);
      return {
        ...preference,
        available: !!role && role.isActive && role.eventId === application.selectedEvent?.eventId && remaining > 0,
        remaining,
      };
    });
  };

  const getAvailablePreferredRoles = (application: Application) => {
    return getPreferredRoleStatuses(application).filter((role) => role.available);
  };

  const openApplicationDetails = (application: Application) => {
    setSelectedApplication(application);
  };

  const handleAccept = async (applicationId: string) => {
    setProcessingId(applicationId);
    setStatusMessage('');
    const result = await approveWorkWithBergmanApplicationAction(applicationId);
    setProcessingId(null);

    if (result.success) {
      setStatusMessage(result.message || 'Application accepted.');
      await loadData();
    } else {
      setStatusMessage(result.error || 'Failed to accept application.');
    }
  };

  const handleReject = async (applicationId: string) => {
    setProcessingId(applicationId);
    setStatusMessage('');
    const result = await rejectWorkWithBergmanApplicationAction(applicationId);
    setProcessingId(null);

    if (result.success) {
      setStatusMessage(result.message || 'Application rejected.');
      if (selectedApplication?.id === applicationId) {
        setSelectedApplication(null);
      }
      await loadData();
    } else {
      setStatusMessage(result.error || 'Failed to reject application.');
    }
  };

  const handleCancelReject = async (applicationId: string) => {
    setProcessingId(applicationId);
    setStatusMessage('');
    const result = await cancelRejectWorkWithBergmanApplicationAction(applicationId);
    setProcessingId(null);

    if (result.success) {
      setStatusMessage(result.message || 'Application restored to pending.');
      await loadData();
    } else {
      setStatusMessage(result.error || 'Failed to restore application.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Pending Applications</h2>
          <p className="text-sm text-gray-600 mt-1">Review and accept public Work With Bergman submissions</p>
        </div>
        <Button variant="outline" onClick={loadData} disabled={loading}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Applications ({pendingCount})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading pending applications…</div>
          ) : pendingApplications.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No pending applications.</div>
          ) : (
            <div className="space-y-3">
              {pendingApplications.map((application) => {
                const appliedAt = application.submittedAt ? new Date(String(application.submittedAt)).toLocaleString() : '—';
                const roleList = application.rolePreferenceDetails?.map((role) => role.roleName || role.roleId).filter(Boolean).join(', ') || '—';
                const availableRoles = getAvailablePreferredRoles(application);
                const availableRolesLabel = availableRoles.length
                  ? availableRoles.map((role) => role.roleName || role.roleId).join(', ')
                  : 'No preferred roles available';
                return (
                  <div
                    key={application.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openApplicationDetails(application)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openApplicationDetails(application);
                      }
                    }}
                    className="rounded-lg border p-3 text-sm cursor-pointer transition-colors hover:bg-muted/40"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">{application.fullName}</p>
                        <p className="text-muted-foreground break-all">{application.email}</p>
                        <p className="text-muted-foreground mt-1">
                          {application.selectedEvent?.eventName || 'Selected event'}
                          {application.rolePreferenceDetails?.[0]?.roleName ? ` · ${application.rolePreferenceDetails[0].roleName}` : ''}
                        </p>
                      </div>
                      <Badge variant="outline">{application.status}</Badge>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>City: {application.personalDetails?.city || '—'}</span>
                      <span>Applied: {appliedAt}</span>
                      <span>Roles: {roleList}</span>
                      <span>Available: {availableRolesLabel}</span>
                    </div>

                    <div className="mt-3 flex justify-end">
                      <Button
                        variant="outline"
                        className="mr-2"
                        onClick={(event) => {
                          event.stopPropagation();
                          openApplicationDetails(application);
                        }}
                      >
                        View submitted form
                      </Button>
                      <Button
                        variant="destructive"
                        className="mr-2"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleReject(application.id);
                        }}
                        disabled={processingId === application.id}
                      >
                        Reject
                      </Button>
                      <Button
                        onClick={(event) => {
                          event.stopPropagation();
                          handleAccept(application.id);
                        }}
                        disabled={processingId === application.id || availableRoles.length === 0}
                      >
                        Accept
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {statusMessage ? (
            <div className="mt-4 rounded-md border px-3 py-2 text-sm text-muted-foreground">{statusMessage}</div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rejected Applications ({rejectedApplications.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading rejected applications…</div>
          ) : rejectedApplications.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No rejected applications.</div>
          ) : (
            <div className="space-y-3">
              {rejectedApplications.map((application) => {
                const appliedAt = application.submittedAt ? new Date(String(application.submittedAt)).toLocaleString() : '—';
                const roleList = application.rolePreferenceDetails?.map((role) => role.roleName || role.roleId).filter(Boolean).join(', ') || '—';
                return (
                  <div
                    key={application.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openApplicationDetails(application)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openApplicationDetails(application);
                      }
                    }}
                    className="rounded-lg border p-3 text-sm cursor-pointer transition-colors hover:bg-muted/40"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">{application.fullName}</p>
                        <p className="text-muted-foreground break-all">{application.email}</p>
                        <p className="text-muted-foreground mt-1">
                          {application.selectedEvent?.eventName || 'Selected event'}
                          {application.rolePreferenceDetails?.[0]?.roleName ? ` · ${application.rolePreferenceDetails[0].roleName}` : ''}
                        </p>
                      </div>
                      <Badge variant="outline">{application.status}</Badge>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>City: {application.personalDetails?.city || '—'}</span>
                      <span>Applied: {appliedAt}</span>
                      <span>Roles: {roleList}</span>
                    </div>

                    <div className="mt-3 flex justify-end">
                      <Button
                        variant="outline"
                        className="mr-2"
                        onClick={(event) => {
                          event.stopPropagation();
                          openApplicationDetails(application);
                        }}
                      >
                        View submitted form
                      </Button>
                      <Button
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCancelReject(application.id);
                        }}
                        disabled={processingId === application.id}
                      >
                        Cancel Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedApplication} onOpenChange={(open) => !open && setSelectedApplication(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submitted form</DialogTitle>
            <DialogDescription>
              Full application details for {selectedApplication?.fullName || 'the selected applicant'}
            </DialogDescription>
          </DialogHeader>

          {selectedApplication ? (
            <div className="space-y-6 text-sm">
              <section className="space-y-2">
                <h3 className="font-semibold">Applicant</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-muted-foreground">
                  <p><span className="font-medium text-foreground">Name:</span> {formatField(selectedApplication.fullName)}</p>
                  <p><span className="font-medium text-foreground">Email:</span> {formatField(selectedApplication.email)}</p>
                  <p><span className="font-medium text-foreground">Phone:</span> {formatField(selectedApplication.personalDetails?.phone)}</p>
                  <p><span className="font-medium text-foreground">Alternative mobile:</span> {formatField(selectedApplication.personalDetails?.alternatePhone)}</p>
                  <p><span className="font-medium text-foreground">City:</span> {formatField(selectedApplication.personalDetails?.city)}</p>
                  <p><span className="font-medium text-foreground">State:</span> {formatField(selectedApplication.personalDetails?.state)}</p>
                  <p><span className="font-medium text-foreground">Pincode:</span> {formatField(selectedApplication.personalDetails?.pincode)}</p>
                  <p><span className="font-medium text-foreground">Applied:</span> {selectedApplication.submittedAt ? new Date(String(selectedApplication.submittedAt)).toLocaleString() : '—'}</p>
                  <p><span className="font-medium text-foreground">Status:</span> {formatField(selectedApplication.status)}</p>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold">Selected event and roles</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-muted-foreground">
                  <p><span className="font-medium text-foreground">Event:</span> {formatField(selectedApplication.selectedEvent?.eventName)}</p>
                  <p><span className="font-medium text-foreground">Event date:</span> {formatField(selectedApplication.selectedEvent?.eventDate)}</p>
                  <p className="md:col-span-2"><span className="font-medium text-foreground">Role preferences:</span> {formatMultiValue(selectedApplication.rolePreferenceDetails?.map((role) => role.roleName || role.roleId))}</p>
                  <div className="md:col-span-2 flex flex-wrap gap-2">
                    {getPreferredRoleStatuses(selectedApplication).map((role) => (
                      <Badge key={role.roleId} variant={role.available ? 'default' : 'secondary'}>
                        {role.roleName || role.roleId} · {role.available ? `Available (${role.remaining} left)` : 'Full'}
                      </Badge>
                    ))}
                  </div>
                  <p className="md:col-span-2"><span className="font-medium text-foreground">Event preferences:</span> {formatMultiValue(selectedApplication.eventPreferences)}</p>
                  <p className="md:col-span-2"><span className="font-medium text-foreground">Skills:</span> {formatMultiValue(selectedApplication.skills)}</p>
                  <p className="md:col-span-2"><span className="font-medium text-foreground">Certifications:</span> {formatMultiValue(selectedApplication.certifications)}</p>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold">Experience</h3>
                <div className="grid grid-cols-1 gap-2 text-muted-foreground">
                  <p><span className="font-medium text-foreground">Years in sports:</span> {formatField(selectedApplication.experience?.yearsInSports)}</p>
                  <p><span className="font-medium text-foreground">Event experience:</span> {formatField(selectedApplication.experience?.eventExperience)}</p>
                  <p><span className="font-medium text-foreground">Leadership experience:</span> {formatField(selectedApplication.experience?.leadershipExperience)}</p>
                  <p><span className="font-medium text-foreground">Travel availability:</span> {formatField(selectedApplication.travelAvailability)}</p>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold">Logistics and agreements</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-muted-foreground">
                  <p><span className="font-medium text-foreground">Can travel:</span> {formatField(selectedApplication.logistics?.canTravel)}</p>
                  <p><span className="font-medium text-foreground">Need accommodation:</span> {formatField(selectedApplication.logistics?.needAccommodation)}</p>
                  <p><span className="font-medium text-foreground">Need local transport:</span> {formatField(selectedApplication.logistics?.needLocalTransport)}</p>
                  <p><span className="font-medium text-foreground">Freelance agreement:</span> {formatField(selectedApplication.agreements?.freelance)}</p>
                  <p><span className="font-medium text-foreground">Duties agreement:</span> {formatField(selectedApplication.agreements?.duties)}</p>
                  <p><span className="font-medium text-foreground">Reporting agreement:</span> {formatField(selectedApplication.agreements?.reporting)}</p>
                  <p><span className="font-medium text-foreground">Travel reimbursement accepted:</span> {formatField(selectedApplication.agreements?.travelReimbursementPolicyAccepted)}</p>
                  <p><span className="font-medium text-foreground">Accommodation policy accepted:</span> {formatField(selectedApplication.agreements?.accommodationPolicyAccepted)}</p>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold">Emergency contact</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-muted-foreground">
                  <p><span className="font-medium text-foreground">Name:</span> {formatField(selectedApplication.emergencyContact?.name)}</p>
                  <p><span className="font-medium text-foreground">Phone:</span> {formatField(selectedApplication.emergencyContact?.phone)}</p>
                  <p><span className="font-medium text-foreground">Relationship:</span> {formatField(selectedApplication.emergencyContact?.relationship)}</p>
                </div>
              </section>

              {selectedApplication.bankDetails ? (
                <section className="space-y-2">
                  <h3 className="font-semibold">Bank details</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-muted-foreground">
                    <p><span className="font-medium text-foreground">Account name:</span> {formatField(selectedApplication.bankDetails.accountName)}</p>
                    <p><span className="font-medium text-foreground">Account number:</span> {formatField(selectedApplication.bankDetails.accountNumber)}</p>
                    <p><span className="font-medium text-foreground">IFSC:</span> {formatField(selectedApplication.bankDetails.ifscCode)}</p>
                    <p><span className="font-medium text-foreground">UPI ID:</span> {formatField(selectedApplication.bankDetails.upiId)}</p>
                  </div>
                </section>
              ) : null}

              {selectedApplication.notes ? (
                <section className="space-y-2">
                  <h3 className="font-semibold">Notes</h3>
                  <p className="text-muted-foreground whitespace-pre-wrap">{selectedApplication.notes}</p>
                </section>
              ) : null}

              {selectedApplication.documents?.length ? (
                <section className="space-y-2">
                  <h3 className="font-semibold">Documents</h3>
                  <ul className="space-y-1 text-muted-foreground">
                    {selectedApplication.documents.map((document, index) => (
                      <li key={`${document.type || 'document'}-${index}`}>
                        {document.type || 'Document'}: {document.documentName || document.documentUrl || 'Uploaded'}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}