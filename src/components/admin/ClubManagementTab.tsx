// src/components/admin/ClubManagementTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useToast } from '../../hooks/use-toast';
import {
  Building, Loader2, Download, Trash2, Edit3, Briefcase, RefreshCw, UserCog, AlertTriangle
} from 'lucide-react';
import type { Club, ClubRankingEntry, ClubMemberPerformanceForAdmin } from '../../lib/types';
import {
  getAllClubs,
  fetchClubMemberPerformanceForAdmin,
  deleteClubAction,
} from '../../lib/actions';
import { getAllClubsWithStatsAction, refreshClubStatsAction } from '../../lib/actions/clubStatsActions';
import { syncClubOwnerEmails } from '../../lib/actions/clubSyncActions';
import { Label } from '../ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from '../ui/skeleton';
import { Badge } from '../ui/badge';
import { format as formatDate, parseISO } from 'date-fns';
import { getOrdinal } from '../../lib/utils';
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
} from "../ui/alert-dialog";
import { Textarea } from '../ui/textarea';
import { Alert } from '../ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { updateClubDetailsAction, transferClubOwnershipAction } from '../../lib/actions';
import { INDIAN_STATES, USA_STATES } from '../../lib/constants';
import { sortedCountries } from '../../lib/countries';

type ClubWithPerformance = Club & { rank?: number; memberCount?: number; ownerEmail?: string; ownerMobile?: string; totalPoints?: number; };

const NotApplicableSpan = () => <span className="text-xs text-muted-foreground">N/A</span>;

const isIndiaCountry = (country?: string) => {
  const value = String(country || '').trim().toLowerCase();
  return value === 'india';
};

const isUsaCountry = (country?: string) => {
  const value = String(country || '').trim().toLowerCase();
  return value === 'united states' || value === 'united states of america' || value === 'usa' || value === 'us';
};

export default function ClubManagementTab() {
  const { toast } = useToast();
  const [adminAllClubs, setAdminAllClubs] = useState<ClubWithPerformance[]>([]);
  const [isLoadingAdminAllClubs, setIsLoadingAdminAllClubs] = useState(true);
  const [selectedClubIdForViewMembers, setSelectedClubIdForViewMembers] = useState<string | null>(null);
  const [clubMembersWithPerformance, setClubMembersWithPerformance] = useState<ClubMemberPerformanceForAdmin[]>([]);
  const [isLoadingClubMemberPerformance, setIsLoadingClubMemberPerformance] = useState(false);
  const [clubMembersError, setClubMembersError] = useState<string | null>(null);
  const [selectedYearForClubView, setSelectedYearForClubView] = useState<string>(new Date().getFullYear().toString());
  const [dynamicClubPerformanceDetails, setDynamicClubPerformanceDetails] = useState<Partial<ClubRankingEntry> | null>(null);
  const [isLoadingDynamicClubPerformance, setIsLoadingDynamicClubPerformance] = useState(false);
  const [isDownloadingOwners, setIsDownloadingOwners] = useState(false);
  const [clubSearchTerm, setClubSearchTerm] = useState('');
  const [memberStatusFilter, setMemberStatusFilter] = useState<'active' | 'contributing' | 'past'>('active');
  const [deletingClub, setDeletingClub] = useState<Club | null>(null);
  const [isDeletingClub, setIsDeletingClub] = useState(false);
  const [deletionMessage, setDeletionMessage] = useState('');
  const [selectedYearForTable, setSelectedYearForTable] = useState<string>(new Date().getFullYear().toString());
  const [editingClub, setEditingClub] = useState<ClubWithPerformance | null>(null);
  const [isSavingClub, setIsSavingClub] = useState(false);
  const [editClubForm, setEditClubForm] = useState({
    name: '',
    coach_name: '',
    email: '',
    mobile: '',
    country: '',
    city: '',
    state: '',
  });
  const [transferringClub, setTransferringClub] = useState<ClubWithPerformance | null>(null);
  const [isTransferringOwnership, setIsTransferringOwnership] = useState(false);
  const [transferFormData, setTransferFormData] = useState({
    newOwnerEmail: '',
    reason: '',
  });
  const [isSyncingOwners, setIsSyncingOwners] = useState(false);
  const lastFetchedYearRef = useRef<string | null>(null);
  const isFetchingClubsRef = useRef(false);

  const fetchClubs = useCallback((force = false) => {
    if (!force && (isFetchingClubsRef.current || lastFetchedYearRef.current === selectedYearForTable)) {
      return;
    }

    isFetchingClubsRef.current = true;
    setIsLoadingAdminAllClubs(true);
    const year = parseInt(selectedYearForTable);
    getAllClubsWithStatsAction(year).then((clubsRes) => {
        if (clubsRes.success && clubsRes.clubs) {
            setAdminAllClubs(clubsRes.clubs as ClubWithPerformance[]);
            lastFetchedYearRef.current = selectedYearForTable;
        }
        else { 
          setAdminAllClubs([]); 
          toast({ variant: "destructive", title: "Clubs Error", description: clubsRes.message }); 
        }
    }).catch (e => {
        toast({ variant: "destructive", title: "Athlete Data Error", description: (e as Error).message });
    }).finally(() => {
      isFetchingClubsRef.current = false;
        setIsLoadingAdminAllClubs(false);
    });
  }, [selectedYearForTable, toast]);
  
  useEffect(() => {
    fetchClubs();
  }, [fetchClubs]);


  const onClubViewYearChange = useCallback((year: string) => {
    setSelectedYearForClubView(year);
  }, []);

  const onSelectClubForViewMembers = useCallback((clubId: string | null) => {
    console.log(`[ClubManagementTab] onSelectClubForViewMembers called with:`, clubId);
    setSelectedClubIdForViewMembers(clubId);
    if (clubId) {
      console.log(`[ClubManagementTab] Selected club for view members:`, clubId);
    }
  }, []);

  const fetchClubData = useCallback(() => {
     if (selectedClubIdForViewMembers) {
      console.log(`[ClubManagementTab] Fetching club data for club:`, selectedClubIdForViewMembers, `year:`, selectedYearForClubView, `filter:`, memberStatusFilter);
      setIsLoadingClubMemberPerformance(true);
      if(memberStatusFilter === 'active' || memberStatusFilter === 'contributing') {
          setIsLoadingDynamicClubPerformance(true);
      } else {
          setDynamicClubPerformanceDetails(null);
      }
      setClubMembersError(null);

      fetchClubMemberPerformanceForAdmin(selectedClubIdForViewMembers, selectedYearForClubView, memberStatusFilter)
        .then(result => {
          console.log(`[ClubManagementTab] Fetch result:`, result);
          if (result.success) {
            setClubMembersWithPerformance(result.membersWithPerformance || []);
            if ((memberStatusFilter === 'active' || memberStatusFilter === 'contributing') && result.clubPerformanceDetails) {
                setDynamicClubPerformanceDetails(result.clubPerformanceDetails);
            }
          } else {
            setClubMembersError(result.message);
            setClubMembersWithPerformance([]);
            if (memberStatusFilter === 'active' || memberStatusFilter === 'contributing') {
                setDynamicClubPerformanceDetails(null);
            }
          }
        })
        .catch(e => {
          console.error(`[ClubManagementTab] Fetch error:`, e);
          setClubMembersError((e as Error).message || "An unexpected error occurred.");
          setClubMembersWithPerformance([]);
          if (memberStatusFilter === 'active' || memberStatusFilter === 'contributing') {
              setDynamicClubPerformanceDetails(null);
          }
        })
        .finally(() => {
          setIsLoadingClubMemberPerformance(false);
          if (memberStatusFilter === 'active' || memberStatusFilter === 'contributing') {
             setIsLoadingDynamicClubPerformance(false);
          }
        });
    } else {
      setClubMembersWithPerformance([]);
      setDynamicClubPerformanceDetails(null);
      setClubMembersError(null);
    }
  }, [selectedClubIdForViewMembers, selectedYearForClubView, memberStatusFilter]);

  useEffect(() => {
    fetchClubData();
  }, [fetchClubData]);

  // Scroll to member card when a club is selected
  useEffect(() => {
    if (selectedClubIdForViewMembers) {
      setTimeout(() => {
        const card = document.getElementById('club-member-card');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }, [selectedClubIdForViewMembers]);

  const handleDownloadOwners = () => {
    setIsDownloadingOwners(true);
    try {
        const dataToExport = adminAllClubs.map(club => ({
            'Club Name': club.name,
            'Owner Name': club.coach_name,
            'Owner Email': club.ownerEmail || 'N/A',
            'Owner Mobile': club.ownerMobile || 'N/A',
            'Club Contact Email': club.email,
            'Club Contact Mobile': club.mobile,
        }));
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Club Owners");
        XLSX.writeFile(wb, "Club_Owner_Details.xlsx");
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Download Error', description: e.message || 'Could not download owner details.' });
    } finally {
        setIsDownloadingOwners(false);
    }
  };

  const filteredAdminAllClubs = useMemo(() => {
    let list = [...adminAllClubs];
    if (clubSearchTerm) {
      list = list.filter(club => club.name.toLowerCase().includes(clubSearchTerm.toLowerCase()));
    }
    
    // ARRANGE BY RANKS: Sort by rank ascending, N/A at the end
    return list.sort((a, b) => {
      const rankA = a.rank || Infinity;
      const rankB = b.rank || Infinity;
      
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      
      // Fallback: Total Points descending
      return (b.totalPoints || 0) - (a.totalPoints || 0);
    });
  }, [adminAllClubs, clubSearchTerm]);

  const availableYearsForClubView = useMemo(() => { const currentYear = new Date().getFullYear(); const years = []; for(let y = currentYear; y >= 2023; y--) years.push(y.toString()); return years; }, []);

  const handleDeleteClub = async () => {
    if (!deletingClub) return;
    setIsDeletingClub(true);
    const result = await deleteClubAction(deletingClub.id, deletingClub.ownerUid, deletionMessage);
    if (result.success) {
      toast({ title: 'Success', description: result.message });
      fetchClubs(true);
      if (selectedClubIdForViewMembers === deletingClub.id) {
        setSelectedClubIdForViewMembers(null);
      }
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setDeletingClub(null);
    setDeletionMessage('');
    setIsDeletingClub(false);
  };

  const openEditClub = (club: ClubWithPerformance) => {
    setEditingClub(club);
    setEditClubForm({
      name: club.name || '',
      coach_name: club.coach_name || '',
      email: club.email || '',
      mobile: club.mobile || '',
      country: club.country || '',
      city: club.city || '',
      state: club.state || '',
    });
  };

  const stateOptions = isIndiaCountry(editClubForm.country)
    ? INDIAN_STATES
    : isUsaCountry(editClubForm.country)
    ? USA_STATES
    : [];

  const handleSaveClub = async () => {
    if (!editingClub) return;
    setIsSavingClub(true);
    const result = await updateClubDetailsAction(editingClub.id, editClubForm);
    if (result.success) {
      toast({ title: 'Club updated', description: `${editClubForm.name} was updated successfully.` });
      setEditingClub(null);
      fetchClubs(true);
    } else {
      toast({ variant: 'destructive', title: 'Update failed', description: result.message });
    }
    setIsSavingClub(false);
  };

  const handleTransferOwnership = async () => {
    if (!transferringClub || !transferFormData.newOwnerEmail.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please enter a valid email address.' });
      return;
    }

    setIsTransferringOwnership(true);
    try {
      const result = await transferClubOwnershipAction(
        transferringClub.id,
        transferFormData.newOwnerEmail.trim(),
        'admin@bergmantri.com', // Current admin email performing the transfer
        transferFormData.reason || undefined
      );

      if (result.success) {
        toast({
          title: 'Club ownership transferred',
          description: result.message,
        });
        setTransferringClub(null);
        setTransferFormData({ newOwnerEmail: '', reason: '' });
        fetchClubs(true);
      } else {
        toast({
          variant: 'destructive',
          title: 'Transfer failed',
          description: result.message,
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: (error as Error).message || 'Failed to transfer ownership.',
      });
    } finally {
      setIsTransferringOwnership(false);
    }
  };

  const handleSyncClubOwners = async () => {
    setIsSyncingOwners(true);
    try {
      const result = await syncClubOwnerEmails();
      
      if (result.success) {
        toast({
          title: 'Sync Complete',
          description: `Successfully synced ${result.synced || 0} clubs with owner emails${result.errors && result.errors.length > 0 ? `. ${result.errors.length} errors occurred.` : ''}`,
        });
        // Refresh the clubs list to show updated data
        fetchClubs(true);
      } else {
        toast({
          variant: 'destructive',
          title: 'Sync Failed',
          description: result.message,
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: (error as Error).message || 'Failed to sync club owners.',
      });
    } finally {
      setIsSyncingOwners(false);
    }
  };

  return (
    <Card className="border-accent/30 bg-accent/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-accent" />
          View Clubs & Members
        </CardTitle>
        <CardDescription>View club lists, their members, and performance.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Search / Filter Clubs</Label>
            <Input
              placeholder="Filter clubs by name..."
              value={clubSearchTerm}
              onChange={(e) => setClubSearchTerm(e.target.value)}
              className="text-sm h-9"
              disabled={isLoadingAdminAllClubs}
            />
          </div>
          <div className="space-y-1 md:col-span-1">
            <Label className="text-xs">Select Year</Label>
            <Select value={selectedYearForTable} onValueChange={(v) => {
              setSelectedYearForTable(v);
              // Fetch clubs for the selected year
              setIsLoadingAdminAllClubs(true);
              const year = parseInt(v);
              getAllClubsWithStatsAction(year).then((clubsRes) => {
                  if (clubsRes.success && clubsRes.clubs) {
                      setAdminAllClubs(clubsRes.clubs as ClubWithPerformance[]);
                  }
                  else { 
                    setAdminAllClubs([]); 
                    toast({ variant: "destructive", title: "Clubs Error", description: clubsRes.message }); 
                  }
              }).catch (e => {
                  toast({ variant: "destructive", title: "Athlete Data Error", description: (e as Error).message });
              }).finally(() => {
                  setIsLoadingAdminAllClubs(false);
              });
            }}>
              <SelectTrigger className="text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYearsForClubView.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap md:justify-end items-end gap-2 col-span-1 md:col-span-3 mt-1 md:mt-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fetchClubs(true)}
              disabled={isLoadingAdminAllClubs}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingAdminAllClubs ? 'animate-spin' : ''}`} />
              Refresh Stats
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSyncClubOwners}
              disabled={isSyncingOwners}
              title="Syncs owner details for existing clubs that were created before this feature. New clubs are automatically synced."
            >
              {isSyncingOwners ? (
                <Loader2 className="animate-spin h-4 w-4 mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sync Owner Details (Existing Clubs)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadOwners}
              disabled={isDownloadingOwners || adminAllClubs.length === 0}
            >
              {isDownloadingOwners ? (
                <Loader2 className="animate-spin h-4 w-4 mr-2" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Download Owners List
            </Button>
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Club Name</TableHead>
                <TableHead>Coach</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Total Points ({selectedYearForTable})</TableHead>
                <TableHead>Club Contact Email</TableHead>
                <TableHead className="text-right min-w-[320px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingAdminAllClubs ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={`skeleton-${i}`}>
                    <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : filteredAdminAllClubs.length > 0 ? (
                filteredAdminAllClubs.map((club) => (
                  <TableRow key={club.id}>
                    <TableCell className="font-medium text-center">
                      {club.rank ? <Badge variant="default">{club.rank}</Badge> : <NotApplicableSpan />}
                    </TableCell>
                    <TableCell className="font-medium">{club.name}</TableCell>
                    <TableCell>{club.coach_name}</TableCell>
                    <TableCell>{club.memberCount ?? 0}</TableCell>
                    <TableCell className="font-semibold text-accent">{club.totalPoints ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{club.email || 'N/A'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 flex-wrap justify-end">
                      <Dialog open={editingClub?.id === club.id} onOpenChange={(open) => !open && setEditingClub(null)}>
                        <DialogTrigger asChild>
                          <Button variant="secondary" size="xs" onClick={() => openEditClub(club)}>
                            <Edit3 className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        </DialogTrigger>
                        {editingClub?.id === club.id && (
                          <DialogContent className="sm:max-w-lg">
                            <DialogHeader>
                              <DialogTitle>Edit Club</DialogTitle>
                              <DialogDescription>Update club details and contact information.</DialogDescription>
                            </DialogHeader>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Club Name</Label>
                                <Input value={editClubForm.name} onChange={(e) => setEditClubForm((prev) => ({ ...prev, name: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Coach</Label>
                                <Input value={editClubForm.coach_name} onChange={(e) => setEditClubForm((prev) => ({ ...prev, coach_name: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Contact Email</Label>
                                <Input value={editClubForm.email} onChange={(e) => setEditClubForm((prev) => ({ ...prev, email: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Contact Mobile</Label>
                                <Input value={editClubForm.mobile} onChange={(e) => setEditClubForm((prev) => ({ ...prev, mobile: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Country</Label>
                                <Select
                                  value={editClubForm.country || ''}
                                  onValueChange={(value) => setEditClubForm((prev) => ({
                                    ...prev,
                                    country: value,
                                    state: isIndiaCountry(value) || isUsaCountry(value) ? prev.state : '',
                                  }))}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select country" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {sortedCountries.map((country) => (
                                      <SelectItem key={country.code} value={country.name}>
                                        {country.flag} {country.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">City</Label>
                                <Input value={editClubForm.city} onChange={(e) => setEditClubForm((prev) => ({ ...prev, city: e.target.value }))} />
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <Label className="text-xs">State</Label>
                                {stateOptions.length > 0 ? (
                                  <Select
                                    value={editClubForm.state || ''}
                                    onValueChange={(value) => setEditClubForm((prev) => ({ ...prev, state: value }))}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder={`Select ${isIndiaCountry(editClubForm.country) ? 'state' : 'state'}`} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {stateOptions.map((state) => (
                                        <SelectItem key={state.value} value={state.name}>
                                          {state.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Input value={editClubForm.state} onChange={(e) => setEditClubForm((prev) => ({ ...prev, state: e.target.value }))} />
                                )}
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setEditingClub(null)}>Cancel</Button>
                              <Button onClick={handleSaveClub} disabled={isSavingClub}>
                                {isSavingClub && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
                                Save Changes
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        )}
                      </Dialog>
                      <Button variant="outline" size="xs" onClick={() => onSelectClubForViewMembers(club.id)}>
                        View Members
                      </Button>
                      <Dialog open={transferringClub?.id === club.id} onOpenChange={(open) => !open && setTransferringClub(null)}>
                        <DialogTrigger asChild>
                          <Button variant="secondary" size="xs" onClick={() => setTransferringClub(club)}>
                            <UserCog className="h-3 w-3 mr-1" />
                            Transfer
                          </Button>
                        </DialogTrigger>
                        {transferringClub?.id === club.id && (
                          <DialogContent className="sm:max-w-lg">
                            <DialogHeader>
                              <DialogTitle>Transfer Club Ownership</DialogTitle>
                              <DialogDescription>
                                Transfer <strong>{transferringClub.name}</strong> ownership to a new email address. The current owner&apos;s access will be revoked.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-2">
                              <Alert className="bg-yellow-50 border-yellow-200">
                                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                                <div className="ml-2">
                                  <p className="text-xs font-semibold text-yellow-800">
                                    Previous owner will lose access to this club immediately
                                  </p>
                                  <p className="text-xs text-yellow-700 mt-1">
                                    The complete ownership history will be preserved for audit purposes.
                                  </p>
                                </div>
                              </Alert>
                              <div className="space-y-1">
                                <Label className="text-xs">Current Owner</Label>
                                <Input
                                  disabled
                                  value={transferringClub.ownerEmail || 'N/A'}
                                  className="bg-gray-100"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">New Owner Email *</Label>
                                <Input
                                  type="email"
                                  placeholder="user@example.com"
                                  value={transferFormData.newOwnerEmail}
                                  onChange={(e) =>
                                    setTransferFormData((prev) => ({
                                      ...prev,
                                      newOwnerEmail: e.target.value,
                                    }))
                                  }
                                  disabled={isTransferringOwnership}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Reason for Transfer (Optional)</Label>
                                <Textarea
                                  placeholder="Briefly explain the reason for this transfer..."
                                  value={transferFormData.reason}
                                  onChange={(e) =>
                                    setTransferFormData((prev) => ({
                                      ...prev,
                                      reason: e.target.value,
                                    }))
                                  }
                                  disabled={isTransferringOwnership}
                                  className="resize-none h-20"
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button
                                variant="outline"
                                onClick={() => setTransferringClub(null)}
                                disabled={isTransferringOwnership}
                              >
                                Cancel
                              </Button>
                              <Button
                                onClick={handleTransferOwnership}
                                disabled={isTransferringOwnership || !transferFormData.newOwnerEmail.trim()}
                                className="bg-blue-600 hover:bg-blue-700"
                              >
                                {isTransferringOwnership && (
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                )}
                                Transfer Ownership
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        )}
                      </Dialog>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="xs" onClick={() => setDeletingClub(club)}>
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        {deletingClub && deletingClub?.id === club.id && (
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Club: {deletingClub?.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action is irreversible. All members will be de-affiliated. Please provide a brief reason
                                for deletion to notify the owner.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <Textarea
                              placeholder="Reason for deletion (will be sent to owner)..."
                              value={deletionMessage}
                              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDeletionMessage(e.target.value)}
                            />
                            <AlertDialogFooter>
                              <AlertDialogCancel onClick={() => setDeletingClub(null)}>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={handleDeleteClub} disabled={isDeletingClub || !deletionMessage}>
                                {isDeletingClub && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
                                Confirm &amp; Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        )}
                      </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    No clubs found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {selectedClubIdForViewMembers && (
          <Card className="mt-6 border-primary/30 scroll-mt-4" id="club-member-card">
            <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4">
              <div>
                <CardTitle className="text-lg">
                  Club Performance: {adminAllClubs.find((c) => c.id === selectedClubIdForViewMembers)?.name}
                </CardTitle>
                <CardDescription>Performance for year: {selectedYearForClubView}</CardDescription>
              </div>
              <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0 flex-wrap">
                <Select value={selectedYearForClubView} onValueChange={(v) => onClubViewYearChange(v)}>
                  <SelectTrigger className="w-full sm:w-[120px] text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableYearsForClubView.map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={memberStatusFilter} onValueChange={(v) => setMemberStatusFilter(v as any)}>
                  <SelectTrigger className="w-full sm:w-[150px] text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active Members</SelectItem>
                    <SelectItem value="contributing">Contributing Members</SelectItem>
                    <SelectItem value="past">Past Members</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => onSelectClubForViewMembers(null)}
                  className="text-xs"
                >
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {isLoadingDynamicClubPerformance && (memberStatusFilter === 'active' || memberStatusFilter === 'contributing') ? (
                <Skeleton className="h-20 w-full" />
              ) : dynamicClubPerformanceDetails && (memberStatusFilter === 'active' || memberStatusFilter === 'contributing') ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center mb-4">
                  <Card className="bg-primary/5">
                    <CardHeader className="p-2 pb-1">
                      <CardTitle className="text-2xl text-primary">{dynamicClubPerformanceDetails.totalPoints}</CardTitle>
                      <CardDescription className="text-xs">Total Points</CardDescription>
                    </CardHeader>
                  </Card>
                  <Card className="bg-primary/5">
                    <CardHeader className="p-2 pb-1">
                      <CardTitle className="text-2xl">{dynamicClubPerformanceDetails.athleteCount}</CardTitle>
                      <CardDescription className="text-xs">Contributing Athletes</CardDescription>
                    </CardHeader>
                  </Card>
                  <Card className="bg-primary/5">
                    <CardHeader className="p-2 pb-1">
                      <CardTitle className="text-2xl">{dynamicClubPerformanceDetails.eventCount}</CardTitle>
                      <CardDescription className="text-xs">Races Finished</CardDescription>
                    </CardHeader>
                  </Card>
                  <Card className="bg-primary/5">
                    <CardHeader className="p-2 pb-1">
                      <CardTitle className="text-2xl text-accent">
                        {dynamicClubPerformanceDetails.overallRank
                          ? `${dynamicClubPerformanceDetails.overallRank}${getOrdinal(
                              dynamicClubPerformanceDetails.overallRank
                            )}`
                          : 'N/A'}
                      </CardTitle>
                      <CardDescription className="text-xs">Club Rank (Overall)</CardDescription>
                    </CardHeader>
                  </Card>
                </div>
              ) : (
                (memberStatusFilter === 'active' || memberStatusFilter === 'contributing') && (
                  <p className="text-center text-xs text-muted-foreground py-2">
                    No performance data for this club in {selectedYearForClubView}.
                  </p>
                )
              )}

              <h4 className="text-md font-semibold mb-2 mt-4">
                {memberStatusFilter === 'active' ? 'Active' : memberStatusFilter === 'contributing' ? 'Contributing' : 'Past'} Member Contributions ({selectedYearForClubView})
              </h4>
              {isLoadingClubMemberPerformance ? (
                <Skeleton className="h-40 w-full" />
              ) : clubMembersError ? (
                <Alert variant="destructive">{clubMembersError}</Alert>
              ) : clubMembersWithPerformance.length > 0 ? (
                <div className="rounded-md border overflow-y-auto max-h-80">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rank</TableHead>
                        <TableHead>Athlete</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Affiliation Date</TableHead>
                        {memberStatusFilter === 'past' && <TableHead>Left Club Date</TableHead>}
                        <TableHead>Races</TableHead>
                        <TableHead className="text-right">Points ({selectedYearForClubView})</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clubMembersWithPerformance
                        .sort((a, b) => {
                          // For contributing filter: sort by rank
                          if (memberStatusFilter === 'contributing') {
                            if (a.clubRankForSelectedYear && b.clubRankForSelectedYear) {
                              return a.clubRankForSelectedYear - b.clubRankForSelectedYear;
                            }
                          }
                          // For active and past filters: sort by points descending (highest first)
                          return b.pointsEarnedForSelectedYear - a.pointsEarnedForSelectedYear;
                        })
                        .map((m) => {
                          const club = adminAllClubs.find((c) => c.id === selectedClubIdForViewMembers);
                          const isClubOwner = club && m.email && club.ownerEmail && m.email.toLowerCase() === club.ownerEmail.toLowerCase();
                          return (
                        <TableRow key={m.uid} className={`text-xs ${isClubOwner ? 'bg-amber-50 dark:bg-amber-950/30 border-l-4 border-amber-500' : ''}`}>
                          <TableCell className="font-medium text-center">
                            {m.pointsEarnedForSelectedYear > 0 ? m.clubRankForSelectedYear : 'N/A'}
                          </TableCell>
                          <TableCell className={isClubOwner ? 'font-bold text-amber-700 dark:text-amber-300' : ''}>
                            {m.name || <NotApplicableSpan />}
                            {isClubOwner && <Badge className="ml-2 bg-amber-600 text-white dark:bg-amber-500">👨‍💼 Coach/Admin</Badge>}
                          </TableCell>
                          <TableCell>{m.email || <NotApplicableSpan />}</TableCell>
                          <TableCell>
                            {m.clubAffiliationDate ? 
                              (() => {
                                try {
                                  return formatDate(parseISO(m.clubAffiliationDate), 'MMM dd, yyyy');
                                } catch (e) {
                                  return <NotApplicableSpan />;
                                }
                              })()
                              : <NotApplicableSpan />}
                          </TableCell>
                          {memberStatusFilter === 'past' && (
                            <TableCell>
                              {(m as any).clubLeftDate ?
                                (() => {
                                  try {
                                    return formatDate(parseISO((m as any).clubLeftDate), 'MMM dd, yyyy');
                                  } catch (e) {
                                    return <NotApplicableSpan />;
                                  }
                                })()
                                : <NotApplicableSpan />}
                            </TableCell>
                          )}
                          <TableCell>{m.racesFinishedInSelectedYear}</TableCell>
                          <TableCell className="text-right font-bold text-accent">{m.pointsEarnedForSelectedYear}</TableCell>
                        </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground py-4">No members found for this club and filter.</p>
              )}
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}
