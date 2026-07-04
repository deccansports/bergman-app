'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  Building2,
  Search,
  Loader2,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Mail,
  Smartphone,
  MapPin,
  Users,
  RefreshCw,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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
} from '@/components/ui/alert-dialog';

interface Club {
  id: string;
  name: string;
  coach_name?: string;
  coachName?: string;
  email?: string;
  mobile?: string;
  city?: string;
  state?: string;
  country?: string;
  memberCount?: number;
}

interface DuplicateGroup {
  name: string;
  clubs: Club[];
}

export default function ClubMergeTab() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Club[]>([]);

  const [primaryClub, setPrimaryClub] = useState<Club | null>(null);
  const [duplicateClubes, setDuplicateClubes] = useState<Club[]>([]);

  const scanDuplicates = useCallback(async () => {
    setIsLoading(true);
    try {
      console.log('[ClubMergeTab] Scanning for duplicates...');
      const res = await fetch('/api/admin/clubs-duplicates', {
        cache: 'no-store'
      });
      const data = await res.json();
      
      console.log('[ClubMergeTab] Response:', data);

      if (data.details?.byName) {
        const groups: DuplicateGroup[] = Object.entries(
          data.details.byName
        ).map(([name, clubs]: [string, any]) => ({
          name,
          clubs: clubs as Club[],
        }));

        console.log('[ClubMergeTab] Found duplicate groups:', groups);
        setDuplicates(groups);
        
        if (groups.length > 0) {
          toast({
            title: 'Scan Complete',
            description: `Found ${groups.length} duplicate groups`,
          });
        } else {
          toast({
            title: 'Scan Complete',
            description: 'No duplicate groups found',
          });
        }
      } else {
        console.warn('[ClubMergeTab] No byName data in response:', data);
        toast({
          title: 'Warning',
          description: 'No duplicates found in Firestore',
        });
      }
    } catch (error) {
      console.error('[ClubMergeTab] Scan error:', error);
      toast({
        title: 'Error',
        description: 'Failed to scan for duplicates: ' + String(error),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.length < 2) return;

    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/clubs-duplicates');
      const data = await res.json();

      if (data.allClubs) {
        const results = data.allClubs.filter((club: Club) =>
          club.name?.toLowerCase().includes(searchTerm.toLowerCase())
        );
        setSearchResults(results);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleMerge = async () => {
    if (!primaryClub || duplicateClubes.length === 0) return;

    setIsMerging(true);
    try {
      const duplicateIds = duplicateClubes.map((c) => c.id);

      const res = await fetch('/api/admin/merge-duplicate-clubs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryClubId: primaryClub.id,
          duplicateClubIds: duplicateIds,
        }),
      });

      const result = await res.json();

      if (result.success) {
        toast({
          title: 'Merge Successful',
          description: result.message || 'Clubs merged successfully',
        });
        setPrimaryClub(null);
        setDuplicateClubes([]);
        scanDuplicates();
      } else {
        toast({
          title: 'Error',
          description: result.message || 'Failed to merge clubs',
          variant: 'destructive',
        });
      }
    } finally {
      setIsMerging(false);
    }
  };

  useEffect(() => {
    scanDuplicates();
  }, [scanDuplicates]);

  return (
    <div className="space-y-6">
      {/* Scan for Duplicates Card */}
      <Card className="border border-blue-200">
        <CardHeader className="bg-blue-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-blue-600" />
              <div>
                <CardTitle>Scan for Duplicate Clubs</CardTitle>
                <CardDescription>
                  Identify clubs with identical or similar names
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Button onClick={scanDuplicates} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoading ? 'Scanning...' : 'Scan for Duplicates'}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const res = await fetch('/api/admin/clubs-list', {
                    cache: 'no-store'
                  });
                  const data = await res.json();
                  console.log('[ClubMergeTab] All clubs:', data);
                  alert(`Total clubs in Firestore: ${data.total_clubs}\nDuplicate groups: ${data.duplicate_name_groups}\n\nCheck console for details`);
                } catch (error) {
                  console.error('Error fetching clubs list:', error);
                }
              }}
            >
              <Building2 className="mr-2 h-4 w-4" />
              View All Clubs
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const res = await fetch('/api/admin/clubs-debug', {
                    cache: 'no-store'
                  });
                  const data = await res.json();
                  console.log('[ClubMergeTab] Debug Info:', data);
                  alert(`DEBUG OUTPUT:\nTotal: ${data.summary.total_clubs}\nDups by Name: ${data.summary.duplicate_name_groups}\nDups by Coach: ${data.summary.duplicate_coach_groups}\n\nFull output in console (F12)`);
                } catch (error) {
                  console.error('Error fetching debug info:', error);
                }
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Debug
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Search by Name */}
      <Card>
        <CardHeader>
          <CardTitle>Search Clubs by Name</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              placeholder="Enter club name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Search
            </Button>
          </form>

          {searchResults.length > 0 && (
            <ScrollArea className="mt-4 h-64">
              <div className="space-y-2">
                {searchResults.map((club) => (
                  <div
                    key={club.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex-1">
                      <p className="font-semibold">{club.name}</p>
                      <p className="text-sm text-gray-600">
                        Coach: {club.coach_name || club.coachName || 'N/A'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Detected Duplicates */}
      {duplicates.length > 0 && (
        <Card className="border border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-900">
              <AlertTriangle className="h-5 w-5" />
              Detected Duplicate Groups ({duplicates.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-96">
              <div className="space-y-4 pr-4">
                {duplicates.map((group, idx) => (
                  <Card key={idx} className="border border-amber-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">{group.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table className="text-sm">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Club Name</TableHead>
                            <TableHead>Coach</TableHead>
                            <TableHead>City</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.clubs.map((club) => (
                            <TableRow key={club.id}>
                              <TableCell className="font-semibold">
                                {club.name}
                              </TableCell>
                              <TableCell>
                                {club.coach_name || club.coachName || '-'}
                              </TableCell>
                              <TableCell>{club.city || '-'}</TableCell>
                              <TableCell className="text-xs">
                                {club.email || '-'}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant={
                                    primaryClub?.id === club.id
                                      ? 'default'
                                      : 'outline'
                                  }
                                  onClick={() => setPrimaryClub(club)}
                                >
                                  {primaryClub?.id === club.id
                                    ? 'Primary ✓'
                                    : 'Set Primary'}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Merge Configuration */}
      {primaryClub && (
        <Card className="border border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-900">
              <CheckCircle2 className="h-5 w-5" />
              Merge Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Primary Club */}
            <div>
              <p className="text-sm font-semibold text-green-900 mb-2">
                Primary Club (Keep)
              </p>
              <Card className="bg-white border-green-300">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-4">
                    <Building2 className="h-5 w-5 text-green-600 mt-1" />
                    <div className="flex-1">
                      <p className="font-semibold text-base">{primaryClub.name}</p>
                      <div className="grid grid-cols-2 gap-2 mt-2 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <Users className="h-4 w-4" />
                          Coach: {primaryClub.coach_name || primaryClub.coachName || 'N/A'}
                        </div>
                        {primaryClub.city && (
                          <div className="flex items-center gap-1">
                            <MapPin className="h-4 w-4" />
                            {primaryClub.city}
                          </div>
                        )}
                        {primaryClub.email && (
                          <div className="flex items-center gap-1">
                            <Mail className="h-4 w-4" />
                            {primaryClub.email}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Separator />

            {/* Select Duplicates to Merge */}
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-2">
                Select Clubs to Merge Into Primary
              </p>
              {duplicates.map((group) => {
                const duplicatesInGroup = group.clubs.filter(
                  (c) => c.id !== primaryClub.id
                );
                if (duplicatesInGroup.length === 0) return null;

                return (
                  <div key={group.name} className="space-y-2 mb-4">
                    {duplicatesInGroup.map((club) => (
                      <div
                        key={club.id}
                        className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={duplicateClubes.some((c) => c.id === club.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDuplicateClubes([...duplicateClubes, club]);
                            } else {
                              setDuplicateClubes(
                                duplicateClubes.filter((c) => c.id !== club.id)
                              );
                            }
                          }}
                          className="h-4 w-4"
                        />
                        <div className="flex-1 text-sm">
                          <p className="font-semibold">{club.name}</p>
                          <p className="text-gray-600">
                            Coach: {club.coach_name || club.coachName || 'N/A'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {duplicateClubes.length > 0 && (
              <>
                <Separator />
                <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-900">
                  <p className="font-semibold mb-1">Merge Preview</p>
                  <ul className="space-y-1">
                    <li>
                      ✓ Keep: <span className="font-semibold">{primaryClub.name}</span>
                    </li>
                    {duplicateClubes.map((club) => (
                      <li key={club.id}>
                        ✗ Delete: <span className="font-semibold">{club.name}</span>
                      </li>
                    ))}
                    <li className="mt-2">
                      → All members and events will be moved to the primary club
                    </li>
                  </ul>
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      className="w-full"
                      size="lg"
                      disabled={isMerging}
                    >
                      {isMerging && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {isMerging ? 'Merging...' : 'Confirm Merge'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm Club Merge</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will merge {duplicateClubes.length} club(s) into{' '}
                        <span className="font-semibold">{primaryClub.name}</span>. All members and events will be moved. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleMerge}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        Merge Clubs
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
