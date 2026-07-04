'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useToast } from '../../hooks/use-toast';
import {
  Building, Loader2, Download, RefreshCw, Search as SearchIcon, BarChart3, Users2, Trophy, ChevronDown, X, AlertCircle, HardDrive, Trash2, Zap, Clock, CheckCircle
} from 'lucide-react';
import type { Club } from '../../lib/types';
import {
  getAllClubsWithStatsAction,
  refreshClubStatsAction,
} from '../../lib/actions/clubStatsActions';
import { getUsersInClubAction } from '../../lib/actions/userActions';
import {
  masterSyncCacheAction,
  manualClearCacheAction,
  getCacheStatsAction,
} from '../../lib/actions/cacheManagementActions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Skeleton } from '../ui/skeleton';
import { Badge } from '../ui/badge';
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

type ClubWithStats = Club & { 
  rank?: number; 
  memberCount?: number; 
  totalPoints?: number;
  activeMembers?: number;
  pastMembers?: number;
  ownerEmail?: string;
  ownerMobile?: string;
};

export default function AthleteGovernanceTab() {
  const { toast } = useToast();
  const [clubs, setClubs] = useState<ClubWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  
  // Modal state for viewing members
  const [memberModalState, setMemberModalState] = useState<{
    isOpen: boolean;
    clubId: string | null;
    clubName: string | null;
  }>({
    isOpen: false,
    clubId: null,
    clubName: null,
  });

  // Cache management state
  const [isMasterSyncing, setIsMasterSyncing] = useState(false);
  const [isManualClearing, setIsManualClearing] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [cacheStats, setCacheStats] = useState<any>(null);

  const fetchClubs = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getAllClubsWithStatsAction();
      if (result.success && result.clubs) {
        // Sort clubs by totalPoints in descending order and add rank
        const rankedClubs = (result.clubs as ClubWithStats[])
          .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0))
          .map((club, index) => ({
            ...club,
            rank: index + 1,
          }));
        
        setClubs(rankedClubs);
        if (rankedClubs.length > 0) {
          toast({
            title: 'Clubs Loaded',
            description: `${rankedClubs.length} clubs loaded successfully`,
          });
        }
      } else {
        setClubs([]);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.message || 'Failed to load clubs',
        });
      }
    } catch (error) {
      console.error('Failed to fetch clubs:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: (error as Error).message || 'An unexpected error occurred',
      });
      setClubs([]);
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchClubs();
  }, [fetchClubs]);

  const filteredClubs = useMemo(() => {
    return clubs.filter(club => 
      club.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      club.coach_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (club.ownerEmail?.toLowerCase().includes(searchTerm.toLowerCase()) || false)
    );
  }, [clubs, searchTerm]);

  const handleRefreshStats = async () => {
    setIsRefreshing(true);
    try {
      await refreshClubStatsAction();
      toast({
        title: 'Stats Refreshed',
        description: 'Club statistics have been refreshed from KV cache',
      });
      await fetchClubs();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: (error as Error).message,
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDownloadOwnersList = () => {
    setIsDownloading(true);
    try {
      const ownersData = clubs.map(club => ({
        'Rank': club.rank || '-',
        'Club Name': club.name || '-',
        'Coach': club.coach_name || '-',
        'Owner Email': club.ownerEmail || '-',
        'Owner Mobile': club.ownerMobile || '-',
        'Members': club.memberCount || 0,
        'Total Points (2026)': club.totalPoints || 0,
      }));

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(ownersData);
      
      // Set column widths
      const columnWidths = [8, 25, 20, 30, 15, 12, 18];
      worksheet['!cols'] = columnWidths.map(width => ({ wch: width }));
      
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Club Owners');
      XLSX.writeFile(workbook, `Club_Owners_${new Date().toISOString().split('T')[0]}.xlsx`);
      
      toast({
        title: 'Downloaded',
        description: `Owners list downloaded with ${clubs.length} clubs`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Download Error',
        description: (error as Error).message,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const dashboardStats = useMemo(() => ({
    totalClubs: clubs.length,
    totalMembers: clubs.reduce((sum, club) => sum + (club.memberCount || 0), 0),
    totalPoints: clubs.reduce((sum, club) => sum + (club.totalPoints || 0), 0),
    avgMembersPerClub: clubs.length > 0 
      ? Math.round(clubs.reduce((sum, club) => sum + (club.memberCount || 0), 0) / clubs.length)
      : 0,
  }), [clubs]);

  const openMemberModal = useCallback((clubId: string, clubName: string) => {
    console.log('Opening member modal for club:', clubId, clubName);
    setMemberModalState({
      isOpen: true,
      clubId,
      clubName,
    });
  }, []);

  const closeMemberModal = useCallback(() => {
    console.log('Closing member modal');
    setMemberModalState({
      isOpen: false,
      clubId: null,
      clubName: null,
    });
  }, []);

  // Cache Management Handlers
  const handleMasterSync = async () => {
    setIsMasterSyncing(true);
    try {
      const result = await masterSyncCacheAction();
      if (result.success) {
        toast({
          title: 'Master Sync Completed',
          description: result.message,
        });
        await loadCacheStats();
      } else {
        toast({
          variant: 'destructive',
          title: 'Master Sync Failed',
          description: result.message,
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: (error as Error).message,
      });
    } finally {
      setIsMasterSyncing(false);
    }
  };

  const handleManualClearCache = async () => {
    setIsManualClearing(true);
    try {
      const result = await manualClearCacheAction();
      if (result.success) {
        toast({
          title: 'Cache Cleared',
          description: result.message,
        });
        await loadCacheStats();
      } else {
        toast({
          variant: 'destructive',
          title: 'Clear Cache Failed',
          description: result.message,
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: (error as Error).message,
      });
    } finally {
      setIsManualClearing(false);
    }
  };

  const loadCacheStats = async () => {
    setIsLoadingStats(true);
    try {
      const result = await getCacheStatsAction();
      if (result.success) {
        setCacheStats(result.stats);
      }
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  useEffect(() => {
    loadCacheStats();
  }, []);


  return (
    <div className="space-y-6">
      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dashboard" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="directory" className="flex items-center gap-2">
            <Users2 className="w-4 h-4" />
            Directory
          </TabsTrigger>
          <TabsTrigger value="clubs" className="flex items-center gap-2">
            <Building className="w-4 h-4" />
            Clubs
          </TabsTrigger>
          <TabsTrigger value="cache" className="flex items-center gap-2">
            <HardDrive className="w-4 h-4" />
            Cache Mgmt
          </TabsTrigger>
        </TabsList>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription className="text-xs">Total Clubs</CardDescription>
                <CardTitle className="text-2xl">{dashboardStats.totalClubs}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription className="text-xs">Total Athletes</CardDescription>
                <CardTitle className="text-2xl">{dashboardStats.totalMembers}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription className="text-xs">Total Points (2026)</CardDescription>
                <CardTitle className="text-2xl">{dashboardStats.totalPoints.toLocaleString()}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription className="text-xs">Avg Members/Club</CardDescription>
                <CardTitle className="text-2xl">{dashboardStats.avgMembersPerClub}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Governance Summary</CardTitle>
              <CardDescription>Overview of athlete governance metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm font-medium">Clubs with Members</span>
                  <Badge>{clubs.filter(c => (c.memberCount || 0) > 0).length}</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm font-medium">Clubs with Points</span>
                  <Badge>{clubs.filter(c => (c.totalPoints || 0) > 0).length}</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm font-medium">Clubs with Coach Assigned</span>
                  <Badge>{clubs.filter(c => c.coach_name).length}</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm font-medium">Clubs with Owner Email</span>
                  <Badge>{clubs.filter(c => c.ownerEmail).length}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Directory Tab */}
        <TabsContent value="directory" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Club Directory</CardTitle>
              <CardDescription>Search and filter clubs by name, coach, or owner</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search clubs, coaches, or owners..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : filteredClubs.length === 0 ? (
                <div className="text-center py-8">
                  <Trophy className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm text-muted-foreground">No clubs found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredClubs.map((club, index) => (
                    <div key={club.id} className="p-3 border rounded-lg hover:bg-muted/50">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-semibold text-sm">{club.name}</h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            Coach: {club.coach_name || 'Not assigned'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Owner: {club.ownerEmail || 'Not assigned'}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge variant="outline">{club.memberCount || 0} members</Badge>
                          <p className="text-xs text-muted-foreground mt-1">
                            {club.totalPoints || 0} points
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Clubs Tab */}
        <TabsContent value="clubs" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>View Clubs & Members</CardTitle>
                  <CardDescription>View club lists, their members, and performance</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search and Filter Section */}
              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-700">Search / Filter Clubs</div>
                
                <div className="flex flex-col gap-3">
                  {/* First Row: Search Input and Year Dropdown */}
                  <div className="flex gap-2 flex-wrap items-center">
                    {/* Search Input */}
                    <div className="relative flex-1 min-w-xs">
                      <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Filter clubs by name, coach, or owner..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>

                    {/* Year Dropdown */}
                    <div className="relative whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowYearDropdown(!showYearDropdown)}
                        className="flex items-center gap-2 px-4 py-2 h-10 border border-gray-300 bg-white hover:bg-gray-100 text-gray-900 font-semibold text-sm rounded-md"
                      >
                        <span>{selectedYear}</span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${showYearDropdown ? 'rotate-180' : ''}`} />
                      </Button>
                      
                      {/* Dropdown Menu */}
                      {showYearDropdown && (
                        <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-[1000] min-w-[120px]">
                          {[2026, 2025, 2024, 2023, 2022, 2021].map(year => (
                            <button
                              key={year}
                              onClick={() => {
                                setSelectedYear(year);
                                setShowYearDropdown(false);
                              }}
                              className={`w-full text-left px-4 py-2 text-sm hover:bg-blue-50 transition-colors ${
                                selectedYear === year 
                                  ? 'bg-blue-100 font-semibold text-blue-900' 
                                  : 'text-gray-700'
                              }`}
                            >
                              {year}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Second Row: Action Buttons */}
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefreshStats}
                      disabled={isRefreshing}
                      className="flex items-center gap-2"
                    >
                      {isRefreshing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      Refresh Stats
                    </Button>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadOwnersList}
                      disabled={isDownloading || clubs.length === 0}
                      className="flex items-center gap-2"
                    >
                      {isDownloading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      Download Owners List
                    </Button>
                  </div>
                </div>
              </div>

              {/* Table Section */}
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : filteredClubs.length === 0 ? (
                <div className="text-center py-12 border rounded-lg bg-muted/20">
                  <Building className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm text-muted-foreground">
                    {clubs.length === 0 ? 'No clubs found.' : 'No matching clubs found with your search.'}
                  </p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="w-16 text-center font-semibold">Rank</TableHead>
                        <TableHead className="min-w-[180px] font-semibold">Club Name</TableHead>
                        <TableHead className="min-w-[150px] font-semibold">Coach</TableHead>
                        <TableHead className="w-20 text-right font-semibold">Members</TableHead>
                        <TableHead className="w-32 text-right font-semibold">Total Points (2026)</TableHead>
                        <TableHead className="min-w-[200px] font-semibold">Owner Email</TableHead>
                        <TableHead className="w-32 text-right font-semibold">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredClubs.map((club) => (
                        <TableRow key={club.id} className="hover:bg-muted/50 transition-colors">
                          {/* Rank */}
                          <TableCell className="text-center font-semibold">
                            <Badge 
                              variant="outline" 
                              className="text-xs font-bold bg-blue-50 text-blue-900"
                            >
                              {club.rank ? getOrdinal(club.rank) : '-'}
                            </Badge>
                          </TableCell>

                          {/* Club Name */}
                          <TableCell className="font-medium text-sm">
                            {club.name || '-'}
                          </TableCell>

                          {/* Coach */}
                          <TableCell className="text-sm text-gray-600">
                            {club.coach_name || '-'}
                          </TableCell>

                          {/* Members Count */}
                          <TableCell className="text-right">
                            <Badge 
                              variant="secondary" 
                              className="text-xs"
                            >
                              {club.memberCount ?? 0}
                            </Badge>
                          </TableCell>

                          {/* Total Points */}
                          <TableCell className="text-right font-semibold text-lg">
                            <span className={club.totalPoints ? 'text-green-600' : 'text-gray-400'}>
                              {((club?.totalPoints ?? 0).toLocaleString())}
                            </span>
                          </TableCell>

                          {/* Owner Email */}
                          <TableCell className="text-xs text-gray-600 truncate max-w-xs">
                            {club.ownerEmail ? (
                              <a 
                                href={`mailto:${club.ownerEmail}`} 
                                className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                                title={club.ownerEmail}
                              >
                                {club.ownerEmail}
                              </a>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (!club.id || !club.name) {
                                  toast({
                                    variant: 'destructive',
                                    title: 'Error',
                                    description: 'Club information is incomplete',
                                  });
                                  return;
                                }
                                openMemberModal(club.id, club.name);
                              }}
                              className="text-xs font-medium cursor-pointer whitespace-nowrap hover:bg-blue-50"
                            >
                              View Members
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Results Summary */}
              {filteredClubs.length > 0 && (
                <div className="text-xs text-muted-foreground text-right pt-2">
                  Showing {filteredClubs.length} of {clubs.length} clubs
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cache Management Tab */}
        <TabsContent value="cache" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="w-5 h-5" />
                Cache Management
              </CardTitle>
              <CardDescription>
                Manage Cloudflare KV cache, flush stale data, and fix inconsistencies
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Cache Statistics */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Current Cache Status
                </h3>
                
                {isLoadingStats ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : cacheStats ? (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="p-3 border rounded-lg bg-blue-50">
                      <p className="text-xs text-gray-600">Users</p>
                      <p className="text-lg font-bold text-blue-900">{cacheStats.userEntries}</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-green-50">
                      <p className="text-xs text-gray-600">Clubs</p>
                      <p className="text-lg font-bold text-green-900">{cacheStats.clubEntries}</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-purple-50">
                      <p className="text-xs text-gray-600">Events</p>
                      <p className="text-lg font-bold text-purple-900">{cacheStats.eventEntries}</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-orange-50">
                      <p className="text-xs text-gray-600">System</p>
                      <p className="text-lg font-bold text-orange-900">{cacheStats.systemEntries}</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-gray-100">
                      <p className="text-xs text-gray-600">Total</p>
                      <p className="text-lg font-bold text-gray-900">{cacheStats.totalEntries}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Unable to load cache statistics</p>
                )}

                {cacheStats?.lastSyncTime && (
                  <p className="text-xs text-muted-foreground">
                    Last sync: {new Date(cacheStats.lastSyncTime).toLocaleString()}
                  </p>
                )}
              </div>

              <hr className="my-4" />

              {/* Master Sync Section */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-600" />
                    Master Sync
                  </h3>
                  <p className="text-xs text-gray-600 mt-1">
                    Flush all stale cache entries and rebuild fresh data from Firestore. Runs in batches to avoid Cloudflare rate limits.
                  </p>
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-center gap-2 border-yellow-200 hover:bg-yellow-50"
                      disabled={isMasterSyncing}
                    >
                      {isMasterSyncing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Syncing Cache...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          Run Master Sync
                        </>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm Master Cache Sync</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will:
                        <ul className="mt-2 ml-4 space-y-1 text-sm list-disc">
                          <li>Clear all user profile cache entries</li>
                          <li>Clear all club stats cache entries</li>
                          <li>Clear all event cache entries</li>
                          <li>Rebuild fresh data from Firestore</li>
                          <li>Process in batches to avoid rate limits</li>
                        </ul>
                        <p className="mt-3 font-semibold text-yellow-700">This may take a few minutes.</p>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleMasterSync} className="bg-yellow-600 hover:bg-yellow-700">
                        Start Sync
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <hr className="my-4" />

              {/* Manual Clear Cache Section */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-red-600" />
                    Manual Clear Cache
                  </h3>
                  <p className="text-xs text-gray-600 mt-1">
                    Remove ghost entries and fix inconsistencies. Scans cache for entries without Firestore records and removes them.
                  </p>
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-center gap-2 border-red-200 hover:bg-red-50"
                      disabled={isManualClearing}
                    >
                      {isManualClearing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Clearing...
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4" />
                          Clear Ghost Entries
                        </>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm Manual Cache Clear</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will:
                        <ul className="mt-2 ml-4 space-y-1 text-sm list-disc">
                          <li>Scan cache for orphaned user entries</li>
                          <li>Scan cache for orphaned club entries</li>
                          <li>Remove entries without Firestore records (ghost entries)</li>
                          <li>Clean up old temporary and system entries</li>
                          <li>Verify data integrity</li>
                        </ul>
                        <p className="mt-3 text-sm">
                          <strong>Safe:</strong> Only removes entries not found in Firestore.
                        </p>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleManualClearCache} className="bg-red-600 hover:bg-red-700">
                        Clear Cache
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <hr className="my-4" />

              {/* Information Box */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-sm text-blue-900 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  How It Works
                </h4>
                <ul className="mt-3 space-y-2 text-xs text-blue-800">
                  <li>• <strong>Master Sync:</strong> Complete cache rebuild with rate limiting (200ms between deletes)</li>
                  <li>• <strong>Manual Clear:</strong> Removes only ghost entries (orphaned cache with no Firestore record)</li>
                  <li>• <strong>Rate Limiting:</strong> Both operations use batched processing to avoid Cloudflare 429 errors</li>
                  <li>• <strong>Safe:</strong> Both operations are safe and can be run anytime without data loss</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Members Modal */}
      {memberModalState.isOpen && memberModalState.clubId && (
        <ClubMembersModal 
          clubId={memberModalState.clubId}
          clubName={memberModalState.clubName || 'Club'}
          onClose={closeMemberModal}
        />
      )}
    </div>
  );
}

interface ClubMembersModalProps {
  clubId: string;
  clubName: string;
  onClose: () => void;
}

function ClubMembersModal({ clubId, clubName, onClose }: ClubMembersModalProps) {
  const { toast } = useToast();
  const [members, setMembers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchMember, setSearchMember] = useState('');

  useEffect(() => {
    const fetchMembers = async () => {
      setIsLoading(true);
      setError(null);
      console.log('Fetching members for club:', clubId);
      
      try {
        if (!clubId) {
          throw new Error('Club ID is missing');
        }

        const result = await getUsersInClubAction(clubId);
        console.log('Members fetch result:', result);

        if (result.success && result.users) {
          setMembers(result.users);
          toast({
            title: 'Members Loaded',
            description: `${result.users.length} members found`,
          });
        } else {
          const errorMsg = result.message || 'Failed to load members';
          setError(errorMsg);
          toast({
            variant: 'destructive',
            title: 'Error',
            description: errorMsg,
          });
        }
      } catch (error) {
        const errorMsg = (error as Error).message || 'An unexpected error occurred';
        console.error('Failed to fetch members:', error);
        setError(errorMsg);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: errorMsg,
        });
      } finally {
        setIsLoading(false);
      }
    };

    if (clubId) {
      fetchMembers();
    }
  }, [clubId, toast]);

  const filteredMembers = useMemo(() => {
    return members.filter(member =>
      (member.name?.toLowerCase().includes(searchMember.toLowerCase()) || false) ||
      (member.email?.toLowerCase().includes(searchMember.toLowerCase()) || false) ||
      (member.mobile?.includes(searchMember) || false)
    );
  }, [members, searchMember]);

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-in fade-in">
      <Card className="w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <CardHeader className="flex flex-row items-center justify-between sticky top-0 bg-background border-b z-10">
          <div className="flex-1">
            <CardTitle className="text-lg">{clubName}</CardTitle>
            <CardDescription>
              {isLoading ? 'Loading members...' : `${filteredMembers.length} of ${members.length} members`}
            </CardDescription>
          </div>
          <button 
            onClick={onClose}
            className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-muted transition-colors ml-4"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </CardHeader>

        {/* Content */}
        <CardContent className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Search Bar */}
          {!isLoading && members.length > 0 && (
            <div className="relative">
              <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search members by name, email, or phone..."
                value={searchMember}
                onChange={(e) => setSearchMember(e.target.value)}
                className="pl-10"
              />
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-red-900 text-sm">Error Loading Members</h4>
                <p className="text-red-800 text-sm">{error}</p>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && members.length === 0 && (
            <div className="text-center py-12">
              <Users2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm text-muted-foreground font-medium">No members found in this club</p>
              <p className="text-xs text-muted-foreground mt-1">Members will appear once athletes join the club</p>
            </div>
          )}

          {/* No Search Results */}
          {!isLoading && !error && members.length > 0 && filteredMembers.length === 0 && (
            <div className="text-center py-8">
              <SearchIcon className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm text-muted-foreground">No members match your search</p>
            </div>
          )}

          {/* Members List */}
          {!isLoading && !error && filteredMembers.length > 0 && (
            <div className="space-y-2">
              {filteredMembers.map((member) => (
                <div 
                  key={member.id || member.uid} 
                  className="border rounded-lg p-3 sm:p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-sm truncate">{member.name || 'Unknown Member'}</h4>
                      <p className="text-xs text-muted-foreground truncate">{member.email || '-'}</p>
                      {member.mobile && (
                        <p className="text-xs text-muted-foreground">{member.mobile}</p>
                      )}
                      {(member.city || member.state) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {member.city}{member.state ? `, ${member.state}` : ''}
                        </p>
                      )}
                    </div>
                    {member.gender && (
                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        {member.gender}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>

        {/* Footer */}
        <div className="border-t p-4 bg-muted/30 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="cursor-pointer"
          >
            Close
          </Button>
        </div>
      </Card>
    </div>
  );
}
