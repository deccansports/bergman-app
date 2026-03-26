// src/components/admin/ClubManagementTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useToast } from '../../hooks/use-toast';
import {
  Building, Loader2, Download, Trash2, Edit3, Briefcase, RefreshCw
} from 'lucide-react';
import type { User, RaceResult, Club, ClubRankingEntry, ClubMemberPerformanceForAdmin } from '../../lib/types';
import {
  getAllClubs,
  fetchClubMemberPerformanceForAdmin,
  deleteClubAction,
} from '../../lib/actions';
import { Label } from '../ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from '../ui/skeleton';
import { Separator } from '../ui/separator';
import { Badge } from '../ui/badge';
import { format as formatDate, parseISO, isValid as isDateValid } from 'date-fns';
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

type ClubWithPerformance = Club & { rank?: number; memberCount?: number; ownerEmail?: string; ownerMobile?: string; totalPoints?: number; };

const NotApplicableSpan = () => <span className="text-xs text-muted-foreground">N/A</span>;

export default function ClubManagementTab() {
  const { toast } = useToast();
  const [adminAllClubs, setAdminAllClubs] = useState<ClubWithPerformance[]>([]);
  const [isLoadingAdminAllClubs, setIsLoadingAdminAllClubs] = useState(true);
  const [selectedClubIdForViewMembers, setSelectedClubIdForViewMembers] = useState<string | null>(null);
  const [clubMembersWithPerformance, setClubMembersWithPerformance] = useState<ClubMemberPerformanceForAdmin[]>([]);
  const [isLoadingClubMemberPerformance, setIsLoadingClubMemberPerformance] = useState(false);
  const [clubMembersError, setClubMembersError] = useState<string | null>(null);
  const [selectedYearForClubView, setSelectedYearForClubView] = useState<string>(new Date().getFullYear().toString());
  const [dynamicClubPerformanceDetails, setDynamicClubPerformanceDetails] = useState<ClubRankingEntry | null>(null);
  const [isLoadingDynamicClubPerformance, setIsLoadingDynamicClubPerformance] = useState(false);
  const [isDownloadingOwners, setIsDownloadingOwners] = useState(false);
  const [clubSearchTerm, setClubSearchTerm] = useState('');
  const [memberStatusFilter, setMemberStatusFilter] = useState<'active' | 'past'>('active');
  const [deletingClub, setDeletingClub] = useState<Club | null>(null);
  const [isDeletingClub, setIsDeletingClub] = useState(false);
  const [deletionMessage, setDeletionMessage] = useState('');

  const fetchClubs = useCallback(() => {
    setIsLoadingAdminAllClubs(true);
    getAllClubs().then((clubsRes) => {
        if (clubsRes.success && clubsRes.clubs) {
            setAdminAllClubs(clubsRes.clubs as ClubWithPerformance[]);
        }
        else { setAdminAllClubs([]); toast({ variant: "destructive", title: "Clubs Error", description: clubsRes.message }); }
    }).catch (e => {
        toast({ variant: "destructive", title: "Athlete Data Error", description: (e as Error).message });
    }).finally(() => {
        setIsLoadingAdminAllClubs(false);
    });
  }, [toast]);
  
  useEffect(() => {
    fetchClubs();
  }, [fetchClubs]);


  const onClubViewYearChange = useCallback((year: string) => {
    setSelectedYearForClubView(year);
  }, []);

  const onSelectClubForViewMembers = useCallback((clubId: string | null) => {
    setSelectedClubIdForViewMembers(clubId);
  }, []);

  const fetchClubData = useCallback(() => {
     if (selectedClubIdForViewMembers) {
      setIsLoadingClubMemberPerformance(true);
      if(memberStatusFilter === 'active') {
          setIsLoadingDynamicClubPerformance(true);
      } else {
          setDynamicClubPerformanceDetails(null);
      }
      setClubMembersError(null);

      fetchClubMemberPerformanceForAdmin(selectedClubIdForViewMembers, selectedYearForClubView, memberStatusFilter)
        .then(result => {
          if (result.success) {
            setClubMembersWithPerformance(result.membersWithPerformance || []);
            if (memberStatusFilter === 'active') {
                setDynamicClubPerformanceDetails(result.clubPerformanceDetails || null);
            }
          } else {
            setClubMembersError(result.message);
            setClubMembersWithPerformance([]);
            if (memberStatusFilter === 'active') {
                setDynamicClubPerformanceDetails(null);
            }
          }
        })
        .catch(e => {
          setClubMembersError((e as Error).message || "An unexpected error occurred.");
          setClubMembersWithPerformance([]);
          if (memberStatusFilter === 'active') {
              setDynamicClubPerformanceDetails(null);
          }
        })
        .finally(() => {
          setIsLoadingClubMemberPerformance(false);
          if (memberStatusFilter === 'active') {
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
    if (!clubSearchTerm) return adminAllClubs;
    return adminAllClubs.filter(club => club.name.toLowerCase().includes(clubSearchTerm.toLowerCase()));
  }, [adminAllClubs, clubSearchTerm]);

  const availableYearsForClubView = useMemo(() => { const currentYear = new Date().getFullYear(); const years = []; for(let y = currentYear; y >= 2023; y--) years.push(y.toString()); return years; }, []);

  const handleDeleteClub = async () => {
    if (!deletingClub) return;
    setIsDeletingClub(true);
    const result = await deleteClubAction(deletingClub.id, deletingClub.ownerUid, deletionMessage);
    if (result.success) {
      toast({ title: 'Success', description: result.message });
      fetchClubs();
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Search / Filter Clubs</Label>
            <Input
              placeholder="Filter clubs by name..."
              value={clubSearchTerm}
              onChange={(e) => setClubSearchTerm(e.target.value)}
              className="text-sm h-9"
              disabled={isLoadingAdminAllClubs}
            />
          </div>
          <div className="flex justify-end items-end">
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
                <TableHead>Total Points ({new Date().getFullYear()})</TableHead>
                <TableHead>Owner Email</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingAdminAllClubs ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    <Loader2 className="animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filteredAdminAllClubs.length > 0 ? (
                filteredAdminAllClubs.map((club) => (
                  <TableRow key={club.id}>
                    <TableCell className="font-medium text-center">{club.rank || 'N/A'}</TableCell>
                    <TableCell className="font-medium">{club.name}</TableCell>
                    <TableCell>{club.coach_name}</TableCell>
                    <TableCell>{club.memberCount ?? 0}</TableCell>
                    <TableCell className="font-semibold text-accent">{club.totalPoints ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{club.ownerEmail || 'N/A'}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="outline" size="xs" onClick={() => onSelectClubForViewMembers(club.id)}>
                        View Members
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="xs" onClick={() => setDeletingClub(club)}>
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        {deletingClub?.id === club.id && (
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Club: {deletingClub.name}?</AlertDialogTitle>
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
          <Card className="mt-4 border-primary/30">
            <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4">
              <div>
                <CardTitle className="text-lg">
                  Club Performance: {adminAllClubs.find((c) => c.id === selectedClubIdForViewMembers)?.name}
                </CardTitle>
                <CardDescription>Performance for year: {selectedYearForClubView}</CardDescription>
              </div>
              <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
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
                    <SelectItem value="past">Past Members</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {isLoadingDynamicClubPerformance && memberStatusFilter === 'active' ? (
                <Skeleton className="h-20 w-full" />
              ) : dynamicClubPerformanceDetails && memberStatusFilter === 'active' ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center mb-4">
                  <Card className="bg-primary/5">
                    <CardHeader className="p-2 pb-1">
                      <CardTitle className="text-2xl text-primary">{dynamicClubPerformanceDetails.totalPoints}</CardTitle>
                      <CardDescription className="text-xs">Total Points</CardDescription>
                    </CardHeader>
                  </Card>
                  <Card className="bg-primary/5">
                    <CardHeader className="p-2 pb-1">
                      <CardTitle className="text-2xl">{dynamicClubPerformanceDetails.contributingAthletes}</CardTitle>
                      <CardDescription className="text-xs">Contributing Athletes</CardDescription>
                    </CardHeader>
                  </Card>
                  <Card className="bg-primary/5">
                    <CardHeader className="p-2 pb-1">
                      <CardTitle className="text-2xl">{dynamicClubPerformanceDetails.racesFinishedByMembers}</CardTitle>
                      <CardDescription className="text-xs">Races Finished</CardDescription>
                    </CardHeader>
                  </Card>
                  <Card className="bg-primary/5">
                    <CardHeader className="p-2 pb-1">
                      <CardTitle className="text-2xl text-accent">
                        {dynamicClubPerformanceDetails.overallRankCalculated
                          ? `${dynamicClubPerformanceDetails.overallRankCalculated}${getOrdinal(
                              dynamicClubPerformanceDetails.overallRankCalculated
                            )}`
                          : 'N/A'}
                      </CardTitle>
                      <CardDescription className="text-xs">Club Rank (Overall)</CardDescription>
                    </CardHeader>
                  </Card>
                </div>
              ) : (
                memberStatusFilter === 'active' && (
                  <p className="text-center text-xs text-muted-foreground py-2">
                    No performance data for this club in {selectedYearForClubView}.
                  </p>
                )
              )}

              <h4 className="text-md font-semibold mb-2 mt-4">
                {memberStatusFilter === 'active' ? 'Active' : 'Past'} Member Contributions ({selectedYearForClubView})
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
                        <TableHead>Races</TableHead>
                        <TableHead className="text-right">Points ({selectedYearForClubView})</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clubMembersWithPerformance.map((m) => (
                        <TableRow key={m.uid} className="text-xs">
                          <TableCell className="font-medium text-center">
                            {m.pointsEarnedForSelectedYear > 0 ? m.clubRankForSelectedYear : 'N/A'}
                          </TableCell>
                          <TableCell>{m.name}</TableCell>
                          <TableCell>{m.email}</TableCell>
                          <TableCell>
                            {m.clubAffiliationDate ? formatDate(parseISO(m.clubAffiliationDate), 'MMM dd, yyyy') : <NotApplicableSpan />}
                          </TableCell>
                          <TableCell>{m.racesFinishedInSelectedYear}</TableCell>
                          <TableCell className="text-right font-bold text-accent">{m.pointsEarnedForSelectedYear}</TableCell>
                        </TableRow>
                      ))}
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
