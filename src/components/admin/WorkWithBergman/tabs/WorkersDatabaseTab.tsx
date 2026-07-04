"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Search, RefreshCw } from 'lucide-react';
import type { Worker } from '@/lib/types/workWithBergman';
import { getAllWorkers } from '@/lib/actions/workBergmanActions';

export default function WorkersDatabaseTab() {
  const [query, setQuery] = useState('');
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [detailType, setDetailType] = useState<'skills' | 'certs' | null>(null);

  const loadWorkers = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getAllWorkers();
      setAllWorkers(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workers');
      setAllWorkers([]);
    }
    setLoading(false);
  };

  const isValidEmail = (value?: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  const hasSaneName = (value?: string) => {
    const name = String(value || '').trim();
    if (!name || name.length < 2 || name.length > 80) return false;
    if (/[,:;()\[\]{}]/.test(name)) return false;
    if (/\d/.test(name)) return false;
    if (!/^[A-Za-z .'-]+$/.test(name)) return false;
    const parts = name.split(/\s+/).filter(Boolean);
    return parts.length >= 1 && parts.length <= 6;
  };

  useEffect(() => {
    loadWorkers();
  }, []);

  const workers = useMemo(() => {
    const cleaned = allWorkers.filter((w) => hasSaneName(w.fullName) && isValidEmail(w.email));
    const q = query.trim().toLowerCase();
    if (!q) return cleaned;
    return cleaned.filter((w) =>
      String(w.fullName || '').toLowerCase().includes(q) ||
      String(w.email || '').toLowerCase().includes(q) ||
      String(w.workerId || '').toLowerCase().includes(q)
    );
  }, [allWorkers, query]);

  const stats = useMemo(() => ({
    total: workers.length,
    active: workers.filter((w) => w.status === 'Active').length,
    blacklisted: workers.filter((w) => w.status === 'Blacklisted').length,
    imported: workers.filter((w) => !!w.syncedFromGoogleSheet).length,
  }), [workers]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Workers Database</h2>
          <p className="text-sm text-gray-600 mt-1">Live workforce records from Firestore</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadWorkers}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Total Workers</div>
              <div className="text-2xl font-bold">{stats.total}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Active</div>
              <div className="text-2xl font-bold">{stats.active}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Blacklisted</div>
              <div className="text-2xl font-bold">{stats.blacklisted}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Google Sheet Synced</div>
              <div className="text-2xl font-bold">{stats.imported}</div>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email..."
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workers</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading workers…</div>
          ) : error ? (
            <div className="py-10 text-center text-sm text-red-600">{error}</div>
          ) : workers.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No workers found. Connect a Google Sheet and run sync.</div>
          ) : (
            <div className="space-y-3">
              {workers.map((worker) => (
                <div key={worker.id} className="rounded-lg border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">{worker.fullName}</div>
                    <div className="text-sm text-muted-foreground">{worker.email}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {worker.city || 'No city'}{worker.state ? `, ${worker.state}` : ''} · {worker.workerId}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={worker.status === 'Active' ? 'default' : worker.status === 'Blacklisted' ? 'destructive' : 'secondary'}>
                      {worker.status}
                    </Badge>
                    {worker.syncedFromGoogleSheet ? <Badge variant="outline">Google Sheet</Badge> : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedWorker(worker);
                        setDetailType('skills');
                      }}
                    >
                      {worker.skills?.length || 0} skills
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedWorker(worker);
                        setDetailType('certs');
                      }}
                    >
                      {worker.certifications?.length || 0} certs
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedWorker && !!detailType} onOpenChange={(open) => {
        if (!open) {
          setSelectedWorker(null);
          setDetailType(null);
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedWorker?.fullName} · {detailType === 'skills' ? 'Skills' : 'Certifications'}
            </DialogTitle>
            <DialogDescription>
              {selectedWorker?.email}
            </DialogDescription>
          </DialogHeader>

          {detailType === 'skills' ? (
            <div className="space-y-2">
              {(selectedWorker?.skills || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No skills available.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(selectedWorker?.skills || []).map((item, idx) => (
                    <Badge key={`${item}-${idx}`} variant="secondary">{item}</Badge>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {(selectedWorker?.certifications || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No certifications available.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(selectedWorker?.certifications || []).map((item, idx) => (
                    <Badge key={`${item}-${idx}`} variant="secondary">{item}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
