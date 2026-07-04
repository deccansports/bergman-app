// src/components/admin/FirestoreDebugTab.tsx
"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Server, AlertTriangle, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getFeedbackSyncDebugMetricsAction } from '@/lib/actions/feedbackFormActions';
import { useToast } from '@/hooks/use-toast';

export default function FirestoreDebugTab() {
  const { toast } = useToast();
  const gcpProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const loggingUrl = `https://console.cloud.google.com/logs/query;query=resource.type%3D"audited_resource"%0Aresource.labels.service%3D"firestore.googleapis.com";timeRange=PT1H;?project=${gcpProjectId}`;

  const [isLoading, setIsLoading] = useState(true);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof getFeedbackSyncDebugMetricsAction>>['metrics'] | null>(null);

  const loadMetrics = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getFeedbackSyncDebugMetricsAction();
      if (res.success && res.metrics) {
        setMetrics(res.metrics);
      } else {
        toast({ variant: 'destructive', title: 'Debug load failed', description: res.error || 'Could not load Firestore debug metrics.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Debug load failed', description: 'Could not load Firestore debug metrics.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  return (
    <div className="space-y-4">
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-amber-600" />
            Firestore Operations Debugging
          </CardTitle>
          <CardDescription>
            Read estimates, sync diagnostics, and recent activity for feedback coupon pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Detailed operational metrics (optimized path).</div>
            <Button size="sm" variant="outline" onClick={loadMetrics} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh Metrics
            </Button>
          </div>

          <div className="p-4 border border-dashed rounded-lg bg-background">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-amber-500 flex-shrink-0 mt-1" />
              <div>
                <h4 className="font-semibold text-foreground">Cloud Logging remains source of truth</h4>
                <p className="text-sm text-muted-foreground mt-1">
                  UI shows deep diagnostics and read estimates. For raw operation-level audit, use Google Cloud Logs Explorer.
                </p>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
          ) : metrics ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card><CardContent className="py-3 text-center"><p className="text-xl font-bold">{metrics.mappings.active}</p><p className="text-xs text-muted-foreground">Active Mappings</p></CardContent></Card>
                <Card><CardContent className="py-3 text-center"><p className="text-xl font-bold">{metrics.dispatch.last24h}</p><p className="text-xs text-muted-foreground">Dispatches (24h)</p></CardContent></Card>
                <Card><CardContent className="py-3 text-center"><p className="text-xl font-bold">{metrics.coupons.feedbackCouponsLast24h}</p><p className="text-xs text-muted-foreground">Coupons (24h)</p></CardContent></Card>
                <Card><CardContent className="py-3 text-center"><p className="text-xl font-bold text-amber-600">~{metrics.estimatedReads.perAutoSyncCycleReads}</p><p className="text-xs text-muted-foreground">Reads / Auto Cycle</p></CardContent></Card>
              </div>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Estimated Firestore Read Breakdown</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>Base reads per mapping sync: <strong>{metrics.estimatedReads.perMappingSyncBaseReads}</strong></div>
                  <div>Estimated reads per auto sync cycle: <strong>{metrics.estimatedReads.perAutoSyncCycleReads}</strong></div>
                  <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                    {metrics.estimatedReads.notes.map((note, idx) => <li key={idx}>{note}</li>)}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Recent Sync Details (Top 100)</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>Event</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Coupon</TableHead>
                          <TableHead>Email/WA</TableHead>
                          <TableHead>Row</TableHead>
                          <TableHead>Created At</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {metrics.recentDispatches.length === 0 ? (
                          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No sync activity found.</TableCell></TableRow>
                        ) : metrics.recentDispatches.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>
                              <Badge variant={row.status === 'sent' ? 'default' : row.status === 'failed' ? 'destructive' : 'secondary'}>{row.status}</Badge>
                            </TableCell>
                            <TableCell>{row.eventName || '—'}</TableCell>
                            <TableCell className="text-xs">{row.email || '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{row.couponCode || '—'}</TableCell>
                            <TableCell className="text-xs">{row.emailSent ? 'Email✅' : 'Email❌'} / {row.whatsappSent ? 'WA✅' : 'WA❌'}</TableCell>
                            <TableCell>{row.rowNumber ?? '—'}</TableCell>
                            <TableCell className="text-xs">{row.createdAt || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <div className="text-center">
            <Button asChild>
              <a href={loggingUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Google Cloud Logging for Firestore
              </a>
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Opens Cloud Logs Explorer pre-filtered for Firestore operations.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
