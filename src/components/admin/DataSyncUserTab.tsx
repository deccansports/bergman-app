'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useToast } from '../../hooks/use-toast';
import {
  RefreshCw, Copy, Loader2, AlertCircle, CheckCircle, Activity, Trash2, Clock,
} from 'lucide-react';
import {
  syncAllUsersToKVAction,
  getUserSyncStatusAction,
  createUserFromRegistrationAction,
} from '../../lib/actions/userSyncActions';
import { 
  syncUsersFromParticipantsAction,
} from '../../lib/actions/idSyncActions';
import { Label } from '../ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';

interface SyncStatus {
  totalUsersInFirestore: number;
  usersInKV: number;
  syncPercentage: number;
}

interface SyncResult {
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
  rateLimitRetries?: number;
  message: string;
  errors?: string[];
}

interface SyncActivityLog {
  id: string;
  type: 'sync-kv' | 'create-users' | 'sync-ids';
  timestamp: Date;
  status: 'success' | 'failed' | 'in-progress';
  syncedCount: number;
  failedCount: number;
  skippedCount?: number;
  duration?: number;
  message: string;
}

export default function DataSyncUserTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [batchSize, setBatchSize] = useState('10');
  const [delayMs, setDelayMs] = useState('500');
  const [maxUsers, setMaxUsers] = useState('');
  const [activityLog, setActivityLog] = useState<SyncActivityLog[]>([]);
  const [startTime, setStartTime] = useState<number | null>(null);

  const fetchStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      const result = await getUserSyncStatusAction();
      if (result.success) {
        setStatus({
          totalUsersInFirestore: result.totalUsersInFirestore || 0,
          usersInKV: result.usersInKV || 0,
          syncPercentage: result.syncPercentage || 0,
        });
        toast({
          title: 'Status Loaded',
          description: `${result.totalUsersInFirestore} users in Firestore, ${result.usersInKV} synced to KV`,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.message,
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    } finally {
      setIsLoadingStatus(false);
    }
  }, [toast]);

  const handleSyncToKV = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    setStartTime(Date.now());
    
    const logEntry: SyncActivityLog = {
      id: `sync-kv-${Date.now()}`,
      type: 'sync-kv',
      timestamp: new Date(),
      status: 'in-progress',
      syncedCount: 0,
      failedCount: 0,
      message: 'Syncing users to KV cache...',
    };
    setActivityLog(prev => [logEntry, ...prev]);

    try {
      const result = await syncAllUsersToKVAction({
        batchSize: parseInt(batchSize) || 10,
        delayMs: parseInt(delayMs) || 500,
        maxUsers: maxUsers ? parseInt(maxUsers) : undefined,
      });

      const duration = Date.now() - (startTime || Date.now());

      setSyncResult({
        syncedCount: result.syncedCount || 0,
        failedCount: result.failedCount || 0,
        skippedCount: 0,
        rateLimitRetries: result.rateLimitRetries,
        message: result.message,
        errors: result.errors,
      });

      // Update activity log with success
      setActivityLog(prev => prev.map(entry => 
        entry.id === logEntry.id 
          ? { 
              ...entry, 
              status: 'success',
              syncedCount: result.syncedCount || 0,
              failedCount: result.failedCount || 0,
              duration,
              message: result.message,
            }
          : entry
      ));

      toast({
        title: 'Sync Complete',
        description: result.message,
      });

      // Refresh status after sync
      await fetchStatus();
    } catch (error: any) {
      const duration = Date.now() - (startTime || Date.now());

      // Update activity log with failure
      setActivityLog(prev => prev.map(entry => 
        entry.id === logEntry.id 
          ? { 
              ...entry, 
              status: 'failed',
              duration,
              message: error.message,
            }
          : entry
      ));

      toast({
        variant: 'destructive',
        title: 'Sync Failed',
        description: error.message,
      });
    } finally {
      setIsSyncing(false);
      setStartTime(null);
    }
  };

  const handleCreateMissingUsers = async () => {
    setIsSyncing(true);
    setStartTime(Date.now());

    const logEntry: SyncActivityLog = {
      id: `create-users-${Date.now()}`,
      type: 'create-users',
      timestamp: new Date(),
      status: 'in-progress',
      syncedCount: 0,
      failedCount: 0,
      message: 'Creating missing user accounts...',
    };
    setActivityLog(prev => [logEntry, ...prev]);

    try {
      const result = await syncUsersFromParticipantsAction();

      const duration = Date.now() - (startTime || Date.now());

      setSyncResult({
        syncedCount: result.syncedCount || 0,
        failedCount: result.errorCount || 0,
        skippedCount: result.skippedCount || 0,
        message: result.message,
      });

      // Update activity log with success
      setActivityLog(prev => prev.map(entry => 
        entry.id === logEntry.id 
          ? { 
              ...entry, 
              status: 'success',
              syncedCount: result.syncedCount || 0,
              failedCount: result.errorCount || 0,
              skippedCount: result.skippedCount || 0,
              duration,
              message: result.message,
            }
          : entry
      ));

      toast({
        title: 'User Creation Complete',
        description: `Created ${result.syncedCount} users from participant data`,
      });

      // Refresh status
      await fetchStatus();
    } catch (error: any) {
      const duration = Date.now() - (startTime || Date.now());

      // Update activity log with failure
      setActivityLog(prev => prev.map(entry => 
        entry.id === logEntry.id 
          ? { 
              ...entry, 
              status: 'failed',
              duration,
              message: error.message,
            }
          : entry
      ));

      toast({
        variant: 'destructive',
        title: 'Creation Failed',
        description: error.message,
      });
    } finally {
      setIsSyncing(false);
      setStartTime(null);
    }
  };

  const copyResults = () => {
    if (syncResult) {
      navigator.clipboard.writeText(JSON.stringify(syncResult, null, 2));
      toast({
        title: 'Copied',
        description: 'Results copied to clipboard',
      });
    }
  };

  const clearActivityLog = () => {
    setActivityLog([]);
    toast({
      title: 'Cleared',
      description: 'Activity log cleared',
    });
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getTypeLabel = (type: SyncActivityLog['type']) => {
    switch (type) {
      case 'sync-kv':
        return 'Sync to KV';
      case 'create-users':
        return 'Create Users';
      case 'sync-ids':
        return 'Sync IDs';
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="sync-kv" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="sync-kv">Sync to KV</TabsTrigger>
          <TabsTrigger value="create-users">Create Missing Users</TabsTrigger>
        </TabsList>

        {/* Sync to KV Tab */}
        <TabsContent value="sync-kv" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Sync All Users to KV Cache
              </CardTitle>
              <CardDescription>
                Synchronize all Firestore users to KV cache with rate limiting
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status Section */}
              <Alert className="bg-blue-50 border-blue-200">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertTitle>Sync Status</AlertTitle>
                <AlertDescription>
                  Check current synchronization status between Firestore and KV cache
                </AlertDescription>
              </Alert>

              {isLoadingStatus ? (
                <Skeleton className="h-20 w-full" />
              ) : status ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <Card className="bg-primary/5">
                      <CardHeader className="p-3">
                        <CardDescription className="text-xs">Users in Firestore</CardDescription>
                        <CardTitle className="text-2xl">{status.totalUsersInFirestore}</CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="bg-green-50">
                      <CardHeader className="p-3">
                        <CardDescription className="text-xs">Users in KV</CardDescription>
                        <CardTitle className="text-2xl text-green-600">{status.usersInKV}</CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="bg-blue-50">
                      <CardHeader className="p-3">
                        <CardDescription className="text-xs">Sync %</CardDescription>
                        <CardTitle className="text-2xl text-blue-600">{status.syncPercentage}%</CardTitle>
                      </CardHeader>
                    </Card>
                  </div>
                  <Progress value={status.syncPercentage} className="h-2" />
                </div>
              ) : null}

              <Button
                onClick={fetchStatus}
                disabled={isLoadingStatus}
                variant="outline"
                size="sm"
              >
                {isLoadingStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Check Status
              </Button>

              {/* Rate Limiting Options */}
              <div className="space-y-3 border-t pt-4">
                <h3 className="font-medium text-sm">Rate Limiting Options</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Batch Size</Label>
                    <Input
                      type="number"
                      value={batchSize}
                      onChange={(e) => setBatchSize(e.target.value)}
                      placeholder="10"
                      disabled={isSyncing}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Delay (ms)</Label>
                    <Input
                      type="number"
                      value={delayMs}
                      onChange={(e) => setDelayMs(e.target.value)}
                      placeholder="500"
                      disabled={isSyncing}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Max Users (optional)</Label>
                    <Input
                      type="number"
                      value={maxUsers}
                      onChange={(e) => setMaxUsers(e.target.value)}
                      placeholder="All"
                      disabled={isSyncing}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Sync Button */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={isSyncing} className="w-full">
                    {isSyncing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Sync All Users to KV
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirm Sync</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will sync all {status?.totalUsersInFirestore || 'N/A'} users to KV cache.
                      Batch size: {batchSize}, Delay: {delayMs}ms
                      {maxUsers && `, Max users: ${maxUsers}`}
                      <br />
                      <br />
                      Rate limiting is enabled to prevent 429 errors. This may take several minutes.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSyncToKV}>Proceed</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* Results */}
              {syncResult && (
                <Alert className="border-green-200 bg-green-50">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertTitle>Sync Complete</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-1 text-sm">
                      <p>Synced: {syncResult.syncedCount}</p>
                      <p>Failed: {syncResult.failedCount}</p>
                      {syncResult.rateLimitRetries && (
                        <p>Rate limit retries: {syncResult.rateLimitRetries}</p>
                      )}
                      <button
                        onClick={copyResults}
                        className="text-green-600 hover:underline text-xs mt-2"
                      >
                        Copy full results
                      </button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Create Missing Users Tab */}
        <TabsContent value="create-users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader2 className="w-5 h-5" />
                Create Missing User Accounts
              </CardTitle>
              <CardDescription>
                Create user accounts from participant data for registrations without accounts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="bg-amber-50 border-amber-200">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertTitle>For Missing Users</AlertTitle>
                <AlertDescription>
                  This scans all event participants and creates user accounts for those who don&apos;t have one
                  yet. Useful when users sign in via Google during registration without creating a full account.
                </AlertDescription>
              </Alert>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={isSyncing} className="w-full">
                    {isSyncing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Create Missing User Accounts
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Create Missing Users?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will scan all event participants and create user accounts for those registered
                      but without a Firestore user document. This is a one-time operation.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCreateMissingUsers}>Proceed</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {syncResult && (
                <Alert className="border-green-200 bg-green-50">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertTitle>Creation Complete</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-1 text-sm">
                      <p>Created: {syncResult.syncedCount}</p>
                      <p>Skipped: {syncResult.skippedCount}</p>
                      <p>Errors: {syncResult.failedCount}</p>
                      {syncResult.errors && syncResult.errors.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs hover:underline">View errors</summary>
                          <pre className="text-xs bg-red-50 p-2 rounded mt-1 overflow-auto max-h-40">
                            {syncResult.errors.join('\n')}
                          </pre>
                        </details>
                      )}
                      <button
                        onClick={copyResults}
                        className="text-green-600 hover:underline text-xs mt-2"
                      >
                        Copy full results
                      </button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Sync Activity Log */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            <div>
              <CardTitle>Sync Activity Log</CardTitle>
              <CardDescription>History of all user synchronization operations</CardDescription>
            </div>
          </div>
          {activityLog.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearActivityLog}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Clear
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {activityLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500">
              <Activity className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">No sync activities yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activityLog.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    entry.status === 'success'
                      ? 'bg-green-50 border-green-200'
                      : entry.status === 'failed'
                        ? 'bg-red-50 border-red-200'
                        : 'bg-blue-50 border-blue-200'
                  }`}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {entry.status === 'success' && (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    )}
                    {entry.status === 'failed' && (
                      <AlertCircle className="w-5 h-5 text-red-600" />
                    )}
                    {entry.status === 'in-progress' && (
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">
                          {getTypeLabel(entry.type)}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {entry.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="text-right">
                        {entry.duration && (
                          <p className="text-xs text-gray-600 font-mono">
                            {formatDuration(entry.duration)}
                          </p>
                        )}
                        <Badge
                          variant={
                            entry.status === 'success'
                              ? 'default'
                              : entry.status === 'failed'
                                ? 'destructive'
                                : 'secondary'
                          }
                          className="mt-1"
                        >
                          {entry.status === 'in-progress'
                            ? 'In Progress'
                            : entry.status === 'success'
                              ? 'Success'
                              : 'Failed'}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-700">
                      <p>{entry.message}</p>
                      {(entry.syncedCount > 0 ||
                        entry.failedCount > 0 ||
                        (entry.skippedCount && entry.skippedCount > 0)) && (
                        <div className="mt-1.5 flex gap-3 text-gray-600">
                          {entry.syncedCount > 0 && (
                            <span>
                              ✓ <span className="font-mono font-semibold text-green-700">{entry.syncedCount}</span> synced
                            </span>
                          )}
                          {entry.failedCount > 0 && (
                            <span>
                              ✗ <span className="font-mono font-semibold text-red-700">{entry.failedCount}</span> failed
                            </span>
                          )}
                          {entry.skippedCount && entry.skippedCount > 0 && (
                            <span>
                              ○ <span className="font-mono font-semibold text-yellow-700">{entry.skippedCount}</span> skipped
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Information Cards */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-base">User Sync Workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <h4 className="font-medium text-blue-900 mb-1">1️⃣ Create Missing Users</h4>
            <p className="text-blue-800">
              When participants register without creating a user account, this creates the account from their participant data.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-blue-900 mb-1">2️⃣ Sync to KV Cache</h4>
            <p className="text-blue-800">
              Synchronizes all users to KV cache with rate limiting to improve read performance and reduce database load.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-blue-900 mb-1">3️⃣ Monitor Activity</h4>
            <p className="text-blue-800">
              Check the sync activity log below to track all user synchronization operations and their results.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
