"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { RefreshCw } from 'lucide-react';
import type { Worker } from '@/lib/types/workWithBergman';
import { getAllWorkers, setWorkerRecruitmentApprovalAction } from '@/lib/actions/workBergmanActions';

export default function ApplicationsTab() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [cityFilter, setCityFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'applied_desc' | 'applied_asc' | 'name_asc' | 'name_desc'>('applied_desc');
  const [processingWorkerId, setProcessingWorkerId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const all = await getAllWorkers();
    setWorkers(
      all.filter((w) => {
        if (!w.syncedFromGoogleSheet) return false;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(w.email || '').trim())) return false;
        if (!String(w.fullName || '').trim()) return false;
        return true;
      })
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const submitted = workers.length;
  const approved = workers.filter((w) => !!w.isRecruitmentApproved).length;
  const underReview = workers.filter((w) => !w.isRecruitmentApproved).length;
  const assigned = 0;

  const handleApprovalChange = async (workerId: string, approvedValue: boolean) => {
    setProcessingWorkerId(workerId);
    const result = await setWorkerRecruitmentApprovalAction(workerId, approvedValue);
    setProcessingWorkerId(null);

    if (result.success) {
      await loadData();
    }
  };

  const cityOptions = useMemo(() => {
    const set = new Set<string>();
    workers.forEach((w) => {
      const city = String(w.city || '').trim();
      if (city) set.add(city);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [workers]);

  const stateOptions = useMemo(() => {
    const set = new Set<string>();
    workers.forEach((w) => {
      const state = String(w.state || '').trim();
      if (state) set.add(state);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [workers]);

  const filteredWorkers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    let list = [...workers].filter((w) => {
      if (stateFilter !== 'all') {
        const state = String(w.state || '').trim().toLowerCase();
        if (state !== stateFilter.toLowerCase()) return false;
      }

      if (cityFilter !== 'all') {
        const city = String(w.city || '').trim().toLowerCase();
        if (city !== cityFilter.toLowerCase()) return false;
      }

      if (!q) return true;

      return (
        String(w.fullName || '').toLowerCase().includes(q) ||
        String(w.email || '').toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      const aTime = new Date(String(a.lastSyncedAt || a.createdAt || '')).getTime();
      const bTime = new Date(String(b.lastSyncedAt || b.createdAt || '')).getTime();

      if (sortBy === 'applied_desc') return bTime - aTime;
      if (sortBy === 'applied_asc') return aTime - bTime;
      if (sortBy === 'name_desc') return String(b.fullName || '').localeCompare(String(a.fullName || ''));
      return String(a.fullName || '').localeCompare(String(b.fullName || ''));
    });

    return list;
  }, [workers, searchQuery, cityFilter, stateFilter, sortBy]);

  const formatAppliedAt = (w: Worker) => {
    const raw = String(w.lastSyncedAt || w.createdAt || '');
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString();
  };

  const getTravelAvailabilityLabel = (w: Worker) => {
    const legacy = w as unknown as Record<string, unknown>;
    const legacyLogistics = legacy.logistics as { canTravel?: unknown } | undefined;
    const legacyValue = legacy.canTravel;
    const raw = typeof legacyLogistics?.canTravel === 'boolean'
      ? legacyLogistics.canTravel
      : typeof legacyValue === 'boolean'
        ? legacyValue
        : null;

    if (raw === true) return 'Yes';
    if (raw === false) return 'No';

    const travelAvailability = String(w.travelAvailability || '').trim().toLowerCase();
    if (travelAvailability) {
      if (['yes', 'true', 'available', 'available for 2-3 days prior to the event (mandatory)'].includes(travelAvailability)) {
        return 'Yes';
      }
      if (['no', 'false'].includes(travelAvailability)) {
        return 'No';
      }
    }

    return '—';
  };

  const getTravelAvailabilityBadgeClasses = (w: Worker) => {
    const label = getTravelAvailabilityLabel(w);
    if (label === 'Yes') return 'bg-green-100 text-green-700 border-green-200';
    if (label === 'No') return 'bg-red-100 text-red-700 border-red-200';
    return 'bg-muted text-muted-foreground border-border';
  };

  const resolveIdCardUrl = (worker: Worker): string => {
    const legacy = worker as unknown as Record<string, unknown>;
    const candidates = [
      worker.idCardUrl,
      legacy.uploadYourId,
      legacy.uploadYourID,
      legacy.idProofUrl,
      legacy.idCard,
      legacy.idUrl,
    ];

    for (const item of candidates) {
      const value = String(item || '').trim();
      if (value) return value;
    }

    return '';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Google Sheet Applications</h2>
          <p className="text-sm text-gray-600 mt-1">Imported worker records from the live sheet</p>
        </div>
        <Button variant="outline" onClick={loadData} className="w-full sm:w-auto">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-600">Submitted</p>
            <p className="text-3xl font-bold mt-2">{submitted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-600">Under Review</p>
            <p className="text-3xl font-bold mt-2">{underReview}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-600">Approved</p>
            <p className="text-3xl font-bold mt-2">{approved}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-600">Assigned</p>
            <p className="text-3xl font-bold mt-2">{assigned}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Imported Workers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">All States</option>
              {stateOptions.map((state) => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>

            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">All Cities</option>
              {cityOptions.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'applied_desc' | 'applied_asc' | 'name_asc' | 'name_desc')}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="applied_desc">Applied At (Newest)</option>
              <option value="applied_asc">Applied At (Oldest)</option>
              <option value="name_asc">Name (A-Z)</option>
              <option value="name_desc">Name (Z-A)</option>
            </select>
          </div>

          {loading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading imported entries…</div>
          ) : filteredWorkers.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">No imported entries found yet</p>
              <p className="text-sm text-gray-400">Run Google Sheet manual sync in Settings tab.</p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:hidden">
                {filteredWorkers.map((w) => (
                  <div key={w.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{w.fullName}</p>
                        <p className="text-xs text-muted-foreground break-all">{w.email}</p>
                      </div>
                      <Badge variant={w.isRecruitmentApproved ? 'default' : 'outline'}>
                        {w.isRecruitmentApproved ? 'Approved' : 'Under Review'}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <div>City: {w.city || 'No city'}{w.state ? `, ${w.state}` : ''}</div>
                      <div>Applied: {formatAppliedAt(w)}</div>
                      <div className="mt-1">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getTravelAvailabilityBadgeClasses(w)}`}>
                          Travel 2–3 Days: {getTravelAvailabilityLabel(w)}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelectedWorker(w)}>
                        View Details
                      </Button>
                      {w.isRecruitmentApproved ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleApprovalChange(w.id, false)}
                          disabled={processingWorkerId === w.id}
                        >
                          Revoke
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleApprovalChange(w.id, true)}
                          disabled={processingWorkerId === w.id}
                        >
                          Approve
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block rounded-lg border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left p-3 font-medium">Name</th>
                        <th className="text-left p-3 font-medium">Email</th>
                        <th className="text-left p-3 font-medium">City</th>
                        <th className="text-left p-3 font-medium">Travel 2–3 Days</th>
                        <th className="text-left p-3 font-medium">Applied At</th>
                        <th className="text-left p-3 font-medium">Status</th>
                        <th className="text-right p-3 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredWorkers.map((w) => (
                        <tr key={w.id} className="border-t">
                          <td className="p-3 font-medium">{w.fullName}</td>
                          <td className="p-3 text-muted-foreground">{w.email}</td>
                          <td className="p-3 text-muted-foreground">{w.city || 'No city'}{w.state ? `, ${w.state}` : ''}</td>
                          <td className="p-3 text-muted-foreground">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getTravelAvailabilityBadgeClasses(w)}`}>
                              {getTravelAvailabilityLabel(w)}
                            </span>
                          </td>
                          <td className="p-3 text-muted-foreground">{formatAppliedAt(w)}</td>
                          <td className="p-3">
                            <Badge variant={w.isRecruitmentApproved ? 'default' : 'outline'}>
                              {w.isRecruitmentApproved ? 'Approved' : 'Under Review'}
                            </Badge>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => setSelectedWorker(w)}>
                                View Details
                              </Button>
                              {w.isRecruitmentApproved ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleApprovalChange(w.id, false)}
                                  disabled={processingWorkerId === w.id}
                                >
                                  Revoke
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => handleApprovalChange(w.id, true)}
                                  disabled={processingWorkerId === w.id}
                                >
                                  Approve
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedWorker} onOpenChange={(open) => !open && setSelectedWorker(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedWorker?.fullName || 'Application Details'}</DialogTitle>
            <DialogDescription>
              {selectedWorker?.email || 'No email'}
            </DialogDescription>
          </DialogHeader>

          {selectedWorker ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div><span className="font-medium">Phone:</span> {selectedWorker.whatsappNumber || '—'}</div>
                <div><span className="font-medium">Gender:</span> {selectedWorker.gender || '—'}</div>
                <div><span className="font-medium">DOB:</span> {selectedWorker.dob || '—'}</div>
                <div><span className="font-medium">Age:</span> {selectedWorker.age || '—'}</div>
                <div><span className="font-medium">City:</span> {selectedWorker.city || '—'}</div>
                <div><span className="font-medium">State:</span> {selectedWorker.state || '—'}</div>
                <div><span className="font-medium">Country:</span> {selectedWorker.country || '—'}</div>
                <div><span className="font-medium">T-shirt Size:</span> {selectedWorker.tshirtSize || '—'}</div>
                <div><span className="font-medium">Occupation:</span> {selectedWorker.occupation || '—'}</div>
                <div><span className="font-medium">Triathlete:</span> {selectedWorker.isTriathlete ? 'Yes' : 'No'}</div>
              </div>

              <div className="text-sm">
                <p className="font-medium mb-1">Address</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{selectedWorker.address || '—'}</p>
              </div>

              <div className="text-sm">
                <p className="font-medium mb-1">Languages</p>
                <p className="text-muted-foreground">{selectedWorker.languages?.join(', ') || '—'}</p>
              </div>

              <div className="text-sm">
                <p className="font-medium mb-1">Sports Participated</p>
                <p className="text-muted-foreground">{selectedWorker.sportsParticipated?.join(', ') || '—'}</p>
              </div>

              <div className="text-sm">
                <p className="font-medium mb-1">Event Experience</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{selectedWorker.eventExperience || '—'}</p>
              </div>

              <div className="text-sm">
                <p className="font-medium mb-1">Leadership Experience</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{selectedWorker.leadershipExperience || '—'}</p>
              </div>

              <div className="text-sm">
                <p className="font-medium mb-1">Previous Organizers</p>
                <p className="text-muted-foreground">{selectedWorker.previousOrganizers?.join(', ') || '—'}</p>
              </div>

              <div className="text-sm">
                <p className="font-medium mb-1">Certifications</p>
                <p className="text-muted-foreground">{selectedWorker.certifications?.join(', ') || '—'}</p>
              </div>

              <div className="text-sm">
                <p className="font-medium mb-1">Skills</p>
                <p className="text-muted-foreground">{selectedWorker.skills?.join(', ') || '—'}</p>
              </div>

              <div className="text-sm">
                <p className="font-medium mb-1">Why good fit / Notes</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{selectedWorker.notes || '—'}</p>
              </div>

              <div className="text-sm">
                <p className="font-medium mb-1">ID Card</p>
                {resolveIdCardUrl(selectedWorker) ? (
                  <a
                    href={resolveIdCardUrl(selectedWorker)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Open uploaded ID
                  </a>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
