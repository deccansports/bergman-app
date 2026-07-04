// src/components/admin/UserDataSyncTab.tsx
"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { 
  Loader2, RefreshCw, CheckCircle2, AlertCircle, Copy, Download, Eye, ChevronDown, ChevronUp, Database
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
  totalParticipants?: number;
  usersWithIdProof?: number;
  usersWithGst?: number;
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
    itemsSynced?: string[];
  }>;
}

export default function UserDataSyncTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedDetails, setExpandedDetails] = useState(false);

  const fetchStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      const response = await fetch('/api/admin/sync-user-data?status=true');
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

  // Load status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSyncAll = useCallback(async () => {
    if (!window.confirm('This will sync ID proofs, GST details, and business information from all participants to user profiles. Continue?')) {
      return;
    }

    setIsSyncing(true);
    try {
      const response = await fetch('/api/admin/sync-user-data', {
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
        // Refresh status
        await fetchStatus();
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
        description: error instanceof Error ? error.message : 'Failed to sync data',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [toast, fetchStatus]);

  const handleCopyJson = () => {
    if (syncResult?.details) {
      navigator.clipboard.writeText(JSON.stringify(syncResult.details, null, 2));
      toast({ title: 'Copied to clipboard' });
    }
  };

  return (
    <div className="space-y-6 text-left">
      <Card className="border-primary/20 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Database className="h-5 w-5 text-blue-600" />
            User Data Sync
          </CardTitle>
          <CardDescription>
            Synchronize user profile data including ID proofs, GST numbers, and business details from participant registrations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Status Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Current Sync Status
            </h3>

            {isLoadingStatus ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : status ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <p className="text-[10px] font-black uppercase text-blue-600 mb-1">Total Participants</p>
                  <p className="text-2xl font-black text-blue-900">{status.totalParticipants || 0}</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-[10px] font-black uppercase text-green-600 mb-1">With ID Proof</p>
                  <p className="text-2xl font-black text-green-900">{status.usersWithIdProof || 0}</p>
                </div>
                <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <p className="text-[10px] font-black uppercase text-orange-600 mb-1">With GST Details</p>
                  <p className="text-2xl font-black text-orange-900">{status.usersWithGst || 0}</p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <p className="text-[10px] font-black uppercase text-purple-600 mb-1">Syncable</p>
                  <p className="text-2xl font-black text-purple-900">{status.potentialSyncCandidates || 0}</p>
                </div>
              </div>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Status Unavailable</AlertTitle>
                <AlertDescription>Could not fetch sync status. Please try again.</AlertDescription>
              </Alert>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-4 border-t">
            <Button
              onClick={handleSyncAll}
              disabled={isSyncing || isLoadingStatus}
              className="gap-2 bg-blue-600 hover:bg-blue-700"
            >
              {isSyncing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Sync All User Data
                </>
              )}
            </Button>
            <Button
              onClick={fetchStatus}
              disabled={isLoadingStatus}
              variant="outline"
              className="gap-2"
            >
              {isLoadingStatus ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Refresh Status
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sync Results */}
      {syncResult && (
        <Card className={syncResult.success ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30"}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {syncResult.success ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-600" />
                  )}
                  {syncResult.message}
                </CardTitle>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpandedDetails(!expandedDetails)}
              >
                {expandedDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </CardHeader>

          {/* Summary Stats */}
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-background rounded-lg border">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Synced</p>
                <p className="text-lg font-black text-green-600">{syncResult.syncedCount || 0}</p>
              </div>
              <div className="p-3 bg-background rounded-lg border">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Skipped</p>
                <p className="text-lg font-black text-yellow-600">{syncResult.skippedCount || 0}</p>
              </div>
              <div className="p-3 bg-background rounded-lg border">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Errors</p>
                <p className="text-lg font-black text-red-600">{syncResult.errorCount || 0}</p>
              </div>
            </div>

            {/* Detailed Results Table */}
            {expandedDetails && syncResult.details && syncResult.details.length > 0 && (
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    Detailed Sync Results ({syncResult.details.length} records)
                  </h4>
                </div>
                <ScrollArea className="border rounded-lg h-[400px] w-full">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/50 z-10">
                      <TableRow>
                        <TableHead className="text-[9px] font-black uppercase min-w-[200px]">Email</TableHead>
                        <TableHead className="text-[9px] font-black uppercase min-w-[80px]">UID</TableHead>
                        <TableHead className="text-[9px] font-black uppercase min-w-[70px]">Status</TableHead>
                        <TableHead className="text-[9px] font-black uppercase min-w-[200px]">Items Synced</TableHead>
                        <TableHead className="text-[9px] font-black uppercase min-w-[200px]">Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncResult.details.map((detail, idx) => (
                        <TableRow key={idx} className="text-[10px]">
                          <TableCell className="font-mono text-muted-foreground">{detail.email}</TableCell>
                          <TableCell className="font-mono text-[9px]">{detail.uid ? detail.uid.slice(0, 8) : '—'}</TableCell>
                          <TableCell>
                            <Badge 
                              variant={
                                detail.status === 'synced' ? 'default' : 
                                detail.status === 'skipped' ? 'secondary' : 
                                'destructive'
                              }
                              className="text-[8px]"
                            >
                              {detail.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {detail.itemsSynced && detail.itemsSynced.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {detail.itemsSynced.map((item, i) => (
                                  <Badge key={i} variant="outline" className="text-[8px]">{item}</Badge>
                                ))}
                              </div>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{detail.reason || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>

                {/* Export Button */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopyJson}
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Details
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Info Alert */}
      <Alert className="bg-blue-50/50 border-blue-200">
        <Database className="h-4 w-4" />
        <AlertTitle>What Gets Synced</AlertTitle>
        <AlertDescription className="mt-2 space-y-1 text-sm">
          <p>✓ <strong>ID Proofs:</strong> From all participant registrations</p>
          <p>✓ <strong>GST Numbers:</strong> Business registration details</p>
          <p>✓ <strong>Business Details:</strong> Company name, address, city, state, pincode</p>
          <p>✓ <strong>KV Cache:</strong> Updated automatically with synced data</p>
        </AlertDescription>
      </Alert>
    </div>
  );
}
