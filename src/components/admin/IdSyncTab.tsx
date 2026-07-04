// src/components/admin/IdSyncTab.tsx
"use client";

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { 
  Loader2, RefreshCw, CheckCircle2, AlertCircle, Copy, Download, Eye, ChevronDown, ChevronUp
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SyncStatus {
  totalUsers?: number;
  usersWithId?: number;
  usersWithoutId?: number;
  potentialSyncCandidates?: number;
}

interface SyncResult {
  success: boolean;
  message: string;
  syncedCount?: number;
  skippedCount?: number;
  errorCount?: number;
  details?: Array<{
    email: string;
    uid?: string;
    status: 'synced' | 'skipped' | 'error';
    reason?: string;
  }>;
}

export default function IdSyncTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedDetails, setExpandedDetails] = useState(false);

  const fetchStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      const response = await fetch('/api/admin/sync-participant-ids?status=true');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch status',
      });
    } finally {
      setIsLoadingStatus(false);
    }
  }, [toast]);

  const handleSyncAll = useCallback(async () => {
    if (!window.confirm('This will sync ID proofs from all participants to user profiles. Continue?')) {
      return;
    }

    setIsSyncing(true);
    try {
      const response = await fetch('/api/admin/sync-participant-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-all' }),
      });
      const data: SyncResult = await response.json();
      setSyncResult(data);

      if (data.success) {
        toast({
          title: 'Sync Complete',
          description: `Synced: ${data.syncedCount}, Skipped: ${data.skippedCount}, Errors: ${data.errorCount}`,
        });
        setExpandedDetails(true);
      } else {
        toast({
          variant: 'destructive',
          title: 'Sync Failed',
          description: data.message,
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to sync',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [toast]);

  const downloadReport = useCallback(() => {
    if (!syncResult?.details) return;

    const csv = [
      ['Email', 'UID', 'Status', 'Reason'].join(','),
      ...syncResult.details.map(item =>
        [
          item.email,
          item.uid || '',
          item.status,
          item.reason || '',
        ]
          .map(v => `"${v}"`)
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `id-sync-report-${new Date().toISOString()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }, [syncResult]);

  const copyReport = useCallback(() => {
    if (!syncResult) return;
    const text = JSON.stringify(syncResult, null, 2);
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  }, [syncResult, toast]);

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            ID Proof Sync Status
          </CardTitle>
          <CardDescription>
            Sync ID proofs from event participants to user profiles
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Total Users</p>
                <p className="text-2xl font-bold text-blue-600">{status.totalUsers || 0}</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase">With ID</p>
                <p className="text-2xl font-bold text-green-600">{status.usersWithId || 0}</p>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Without ID</p>
                <p className="text-2xl font-bold text-orange-600">{status.usersWithoutId || 0}</p>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Can Sync</p>
                <p className="text-2xl font-bold text-purple-600">{status.potentialSyncCandidates || 0}</p>
              </div>
            </div>
          ) : (
            <div className="h-20 flex items-center justify-center text-muted-foreground">
              Click &quot;Check Status&quot; to load sync information
            </div>
          )}
        </CardContent>
        <CardFooter className="gap-2">
          <Button
            onClick={fetchStatus}
            disabled={isLoadingStatus || isSyncing}
            variant="outline"
          >
            {isLoadingStatus ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading...</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" /> Check Status</>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Sync Alert */}
      {status && status.potentialSyncCandidates && status.potentialSyncCandidates > 0 && (
        <Alert className="border-purple-200 bg-purple-50">
          <AlertCircle className="h-4 w-4 text-purple-600" />
          <AlertTitle className="text-purple-900">
            {status.potentialSyncCandidates} IDs Ready to Sync
          </AlertTitle>
          <AlertDescription className="text-purple-800">
            Found {status.potentialSyncCandidates} users without saved ID proofs who have IDs in their event participant records.
            These can be automatically synced to their profiles.
          </AlertDescription>
        </Alert>
      )}

      {/* Sync Control Card */}
      <Card>
        <CardHeader>
          <CardTitle>Sync All ID Proofs</CardTitle>
          <CardDescription>
            Match participants to users by email or UID and sync their ID proofs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>How it works</AlertTitle>
            <AlertDescription className="space-y-2 mt-2">
              <p>1. Searches all event participants for ID proofs</p>
              <p>2. Matches participants to users by email or UID</p>
              <p>3. Only syncs to users who don&apos;t already have an ID</p>
              <p>4. Generates detailed report of what was synced</p>
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleSyncAll}
            disabled={isSyncing || isLoadingStatus}
            className="bg-purple-600 hover:bg-purple-700"
            size="lg"
          >
            {isSyncing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Syncing...</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" /> Sync All IDs</>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Results Card */}
      {syncResult && (
        <Card className={syncResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {syncResult.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600" />
                )}
                <CardTitle className={syncResult.success ? 'text-green-900' : 'text-red-900'}>
                  {syncResult.success ? 'Sync Completed' : 'Sync Failed'}
                </CardTitle>
              </div>
              <Badge variant={syncResult.success ? 'default' : 'destructive'}>
                {syncResult.success ? 'Success' : 'Error'}
              </Badge>
            </div>
            <CardDescription className={syncResult.success ? 'text-green-700' : 'text-red-700'}>
              {syncResult.message}
            </CardDescription>
          </CardHeader>

          {syncResult.success && (
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-lg p-4 border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Synced</p>
                  <p className="text-2xl font-bold text-green-600">{syncResult.syncedCount || 0}</p>
                </div>
                <div className="bg-white rounded-lg p-4 border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Skipped</p>
                  <p className="text-2xl font-bold text-orange-600">{syncResult.skippedCount || 0}</p>
                </div>
                <div className="bg-white rounded-lg p-4 border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Errors</p>
                  <p className="text-2xl font-bold text-red-600">{syncResult.errorCount || 0}</p>
                </div>
              </div>

              {/* Details Table */}
              {syncResult.details && syncResult.details.length > 0 && (
                <div className="space-y-2">
                  <div
                    className="flex items-center justify-between cursor-pointer p-2 rounded hover:bg-white/50"
                    onClick={() => setExpandedDetails(!expandedDetails)}
                  >
                    <p className="font-semibold flex items-center gap-2">
                      {expandedDetails ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      Detailed Report ({syncResult.details.length} items)
                    </p>
                  </div>

                  {expandedDetails && (
                    <ScrollArea className="border rounded-lg">
                      <Table className="text-sm">
                        <TableHeader>
                          <TableRow className="bg-white/50">
                            <TableHead className="w-40">Email</TableHead>
                            <TableHead className="w-32">UID</TableHead>
                            <TableHead className="w-20">Status</TableHead>
                            <TableHead>Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {syncResult.details.map((item, idx) => (
                            <TableRow key={idx} className="text-xs">
                              <TableCell className="font-mono break-all">{item.email}</TableCell>
                              <TableCell className="font-mono truncate">{item.uid || '-'}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    item.status === 'synced'
                                      ? 'default'
                                      : item.status === 'skipped'
                                      ? 'secondary'
                                      : 'destructive'
                                  }
                                >
                                  {item.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {item.reason || '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </div>
              )}
            </CardContent>
          )}

          <CardFooter className="gap-2">
            <Button
              onClick={copyReport}
              variant="outline"
              size="sm"
            >
              <Copy className="h-4 w-4 mr-2" /> Copy JSON
            </Button>
            {syncResult.details && syncResult.details.length > 0 && (
              <Button
                onClick={downloadReport}
                variant="outline"
                size="sm"
              >
                <Download className="h-4 w-4 mr-2" /> Download CSV
              </Button>
            )}
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
