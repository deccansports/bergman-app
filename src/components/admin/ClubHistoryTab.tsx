'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useToast } from '../../hooks/use-toast';
import { useAuth } from '../../context/AuthContext';
import {
  RefreshCw, Download, Copy, Loader2, AlertCircle, CheckCircle, LogOut,
} from 'lucide-react';
import type { ClubHistoryEntry } from '../../lib/types';
import {
  getCandidatesForHistoryMigrationAction,
  migrateClubHistoryForAllUsersAction,
  getClubMembersWithHistoryFilterAction,
  backfillClubRootFieldsAction,
} from '../../lib/actions/clubHistoryActions';
import { syncAllEventsClubDataAction } from '../../lib/actions/clubActions';
import { Label } from '../ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { formatDate } from 'date-fns';
import * as XLSX from 'xlsx';
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

interface MigrationResult {
  migratedCount: number;
  failedCount: number;
  errors?: string[];
}

interface MemberRecord {
  uid: string;
  name: string;
  email: string;
  joinedAt?: string;
  leftAt?: string;
}

export default function ClubHistoryTab() {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const isViewOnlyAdmin = !!(currentUser?.isAdmin && currentUser?.adminAccessMode === 'view');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [selectedClubId, setSelectedClubId] = useState<string>('');
  const [memberFilter, setMemberFilter] = useState<'active' | 'past'>('active');
  const [clubMembers, setClubMembers] = useState<MemberRecord[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [isBackfillingClubs, setIsBackfillingClubs] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ fixedCount: number; skippedCount: number; failedCount: number; participantDocsUpdated?: number } | null>(null);
  const [isSyncingAllEvents, setIsSyncingAllEvents] = useState(false);
  const [syncAllResult, setSyncAllResult] = useState<{ eventsProcessed: number; participantsUpdated: number; failedCount: number } | null>(null);

  const handleBackfillClubRootFields = async () => {
    setIsBackfillingClubs(true);
    setBackfillResult(null);
    try {
      const res = await backfillClubRootFieldsAction();
      if (res.success) {
        setBackfillResult({ fixedCount: res.fixedCount || 0, skippedCount: res.skippedCount || 0, failedCount: res.failedCount || 0, participantDocsUpdated: res.participantDocsUpdated });
        toast({ title: 'Club Backfill Complete', description: res.message });
      } else {
        toast({ variant: 'destructive', title: 'Backfill Failed', description: res.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setIsBackfillingClubs(false);
    }
  };

  const handleSyncAllEvents = async () => {
    setIsSyncingAllEvents(true);
    setSyncAllResult(null);
    try {
      const res = await syncAllEventsClubDataAction();
      if (res.success) {
        setSyncAllResult({ eventsProcessed: res.eventsProcessed || 0, participantsUpdated: res.participantsUpdated || 0, failedCount: res.failedCount || 0 });
        toast({ title: 'All Events Synced', description: res.message });
      } else {
        toast({ variant: 'destructive', title: 'Sync Failed', description: res.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setIsSyncingAllEvents(false);
    }
  };

  const fetchCandidates = useCallback(async () => {
    setIsLoadingCandidates(true);
    try {
      const result = await getCandidatesForHistoryMigrationAction();
      if (result.success) {
        setCandidates(result.candidates || []);
        toast({
          title: 'Candidates Loaded',
          description: `Found ${result.totalCandidates} users needing migration`,
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
      setIsLoadingCandidates(false);
    }
  }, [toast]);

  const handleMigrate = async () => {
    setIsMigrating(true);
    try {
      const result = await migrateClubHistoryForAllUsersAction();
      if (result.success) {
        setMigrationResult({
          migratedCount: result.migratedCount || 0,
          failedCount: result.failedCount || 0,
          errors: result.errors,
        });
        setCandidates([]); // Clear candidates after migration
        toast({
          title: 'Migration Complete',
          description: `Migrated ${result.migratedCount} users`,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Migration Failed',
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
      setIsMigrating(false);
    }
  };

  const fetchClubMembers = useCallback(async (clubId: string, filter: 'active' | 'past') => {
    if (!clubId) return;

    setIsLoadingMembers(true);
    try {
      const result = await getClubMembersWithHistoryFilterAction(clubId, filter);
      if (result.success) {
        setClubMembers(result.members || []);
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
      setIsLoadingMembers(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedClubId) {
      fetchClubMembers(selectedClubId, memberFilter);
    }
  }, [selectedClubId, memberFilter, fetchClubMembers]);

  const downloadCandidatesReport = () => {
    const ws = XLSX.utils.json_to_sheet(candidates);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Migration Candidates');
    XLSX.writeFile(wb, 'club-history-migration-candidates.xlsx');
    toast({
      title: 'Downloaded',
      description: 'Migration candidates report downloaded',
    });
  };

  const downloadMembersReport = () => {
    const ws = XLSX.utils.json_to_sheet(clubMembers);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Club Members - ${memberFilter}`);
    XLSX.writeFile(wb, `club-members-${memberFilter}.xlsx`);
    toast({
      title: 'Downloaded',
      description: `${memberFilter} members report downloaded`,
    });
  };

  const copyToClipboard = (data: any) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast({
      title: 'Copied',
      description: 'Data copied to clipboard',
    });
  };

  const toggleExpandRow = (uid: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(uid)) {
      newExpanded.delete(uid);
    } else {
      newExpanded.add(uid);
    }
    setExpandedRows(newExpanded);
  };

  return (
    <div className="space-y-6">
      {/* Backfill Club Root Fields Section */}
      <Card className="border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            Fix Club Migration (Root Fields Backfill)
          </CardTitle>
          <CardDescription>
            Fixes users whose <code>clubId</code> / <code>clubName</code> root fields are <strong>null</strong> but <code>clubHistory</code> already has an active entry. This is a migration gap fix — run once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>When to use this</AlertTitle>
            <AlertDescription>
              If a user appears as &quot;no club&quot; in the Participants tab despite being a club member, run this fix. It copies the active <code>clubHistory</code> entry back to the root <code>clubId</code> / <code>clubName</code> fields, then re-run &quot;Sync Club Data&quot; on the relevant event.
            </AlertDescription>
          </Alert>
          <Button onClick={handleBackfillClubRootFields} disabled={isBackfillingClubs || isViewOnlyAdmin} size="sm">
            {isBackfillingClubs ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Run Club Root Fields Backfill
          </Button>
          {backfillResult && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertTitle>Backfill Complete</AlertTitle>
              <AlertDescription>
                Fixed: <strong>{backfillResult.fixedCount}</strong> users &nbsp;|&nbsp; Skipped (already had club): {backfillResult.skippedCount} &nbsp;|&nbsp; Failed: {backfillResult.failedCount}
                <br />
                <span className="text-xs text-muted-foreground mt-1 block">Now go to the Participants tab and click <strong>&quot;Sync Club Data&quot;</strong> for each event to propagate the club into participant records.</span>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Migration Section */}
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Club History Migration
          </CardTitle>
          <CardDescription>
            Migrate existing club affiliations to club history tracking system
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>One-time Migration</AlertTitle>
            <AlertDescription>
              This will add clubHistory array to all users with existing club affiliations. Current club becomes the first active entry.
            </AlertDescription>
          </Alert>

          <div className="flex gap-2">
            <Button
              onClick={fetchCandidates}
              disabled={isLoadingCandidates || isViewOnlyAdmin}
              variant="outline"
              size="sm"
            >
              {isLoadingCandidates ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Check Candidates
            </Button>

            {candidates.length > 0 && (
              <>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button disabled={isMigrating || isViewOnlyAdmin} size="sm">
                      {isMigrating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Migrate {candidates.length} Users
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm Migration</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will migrate {candidates.length} users to the new club history system. This action is irreversible.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleMigrate} disabled={isViewOnlyAdmin}>
                        Proceed with Migration
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <Button
                  onClick={downloadCandidatesReport}
                  variant="ghost"
                  size="sm"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </>
            )}
          </div>

          {candidates.length > 0 && (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User Name</TableHead>
                    <TableHead>Current Club</TableHead>
                    <TableHead>Affiliation Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((candidate) => (
                    <TableRow key={candidate.uid}>
                      <TableCell className="font-medium">{candidate.name}</TableCell>
                      <TableCell>{candidate.clubName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {candidate.clubAffiliationDate}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {migrationResult && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertTitle>Migration Complete</AlertTitle>
              <AlertDescription>
                Migrated: {migrationResult.migratedCount} | Failed: {migrationResult.failedCount}
                {migrationResult.errors && migrationResult.errors.length > 0 && (
                  <div className="mt-2 text-xs">
                    <button
                      onClick={() => copyToClipboard(migrationResult.errors)}
                      className="text-green-600 hover:underline"
                    >
                      View Errors
                    </button>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Global Participant Club Sync */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-blue-600" />
            Sync Club Data Across All Events
          </CardTitle>
          <CardDescription>
            One-click global sync to update participant <code>clubId</code>/<code>clubName</code> in every event using current user profiles.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleSyncAllEvents}
            disabled={isSyncingAllEvents || isViewOnlyAdmin}
            size="sm"
            variant="outline"
            className="border-blue-400 text-blue-700 hover:bg-blue-100"
          >
            {isSyncingAllEvents ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {isSyncingAllEvents ? 'Syncing all events…' : 'Run Global Event Sync'}
          </Button>

          {syncAllResult && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertTitle>Global Sync Complete</AlertTitle>
              <AlertDescription>
                Events processed: <strong>{syncAllResult.eventsProcessed}</strong> &nbsp;|&nbsp; Participant docs updated: <strong>{syncAllResult.participantsUpdated}</strong> &nbsp;|&nbsp; Failed: {syncAllResult.failedCount}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Club Members History Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Club Members by History</CardTitle>
          <CardDescription>
            View active and past members with their club history
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="club-select" className="text-sm font-medium mb-2 block">
                Select Club (Demo)
              </Label>
              <Input
                id="club-select"
                placeholder="Enter club ID to filter members"
                value={selectedClubId}
                onChange={(e) => setSelectedClubId(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-sm font-medium mb-2 block">Member Status</Label>
              <Select value={memberFilter} onValueChange={(v) => setMemberFilter(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active Members</SelectItem>
                  <SelectItem value="past">Past Members</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedClubId && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="font-medium">
                  {memberFilter === 'active' ? 'Active' : 'Past'} Members ({clubMembers.length})
                </h3>
                {clubMembers.length > 0 && (
                  <div className="flex gap-2">
                    <Button
                      onClick={downloadMembersReport}
                      variant="ghost"
                      size="sm"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export
                    </Button>
                    <Button
                      onClick={() => copyToClipboard(clubMembers)}
                      variant="ghost"
                      size="sm"
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                  </div>
                )}
              </div>

              {isLoadingMembers ? (
                <Skeleton className="h-40 w-full" />
              ) : clubMembers.length > 0 ? (
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[200px]">Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="w-[150px]">Joined</TableHead>
                        {memberFilter === 'past' && (
                          <TableHead className="w-[150px]">Left</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clubMembers.map((member) => (
                        <TableRow
                          key={member.uid}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleExpandRow(member.uid)}
                        >
                          <TableCell className="font-medium">{member.name}</TableCell>
                          <TableCell className="text-sm">{member.email}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {member.joinedAt
                              ? formatDate(new Date(member.joinedAt), 'MMM d, yyyy')
                              : 'N/A'}
                          </TableCell>
                          {memberFilter === 'past' && (
                            <TableCell className="text-sm text-muted-foreground">
                              {member.leftAt
                                ? formatDate(new Date(member.leftAt), 'MMM d, yyyy')
                                : 'N/A'}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  No {memberFilter} members found for this club
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* How It Works */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-base">How Club History Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <h4 className="font-medium text-blue-900 mb-1">📝 Club History Entry</h4>
            <p className="text-blue-800">
              Each club membership is tracked with: clubId, clubName, joinedAt, leftAt (if past member), and isActive status.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-blue-900 mb-1">🔄 Club Change Process</h4>
            <p className="text-blue-800">
              When an athlete switches clubs:
            </p>
            <ul className="list-disc list-inside text-blue-800 ml-2">
              <li>Old club marked as inactive with leftAt timestamp</li>
              <li>New club added with isActive = true</li>
              <li>Main fields updated (clubId, clubName, clubAffiliationDate)</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-blue-900 mb-1">📊 Analytics & Reports</h4>
            <p className="text-blue-800">
              Club admins can view complete member journey: when they joined, how long they stayed, and current status.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
