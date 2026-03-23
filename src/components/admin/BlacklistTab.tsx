// src/components/admin/BlacklistTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, Trash2, ShieldX } from 'lucide-react';
import type { User } from '@/lib/types';
import { getBlacklistedUsersAction, blacklistUserAction, unblacklistUserAction } from '@/lib/actions/userActions';
import { searchAthletesForAdminAction } from '@/lib/actions/adminActions';
import { format, parseISO } from 'date-fns';
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
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
  DialogClose
} from '@/components/ui/dialog';
import { Label } from '../ui/label';

export default function BlacklistTab() {
  const { toast } = useToast();
  const [blacklistedUsers, setBlacklistedUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isBlacklistModalOpen, setIsBlacklistModalOpen] = useState(false);
  const [blacklistReason, setBlacklistReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchBlacklistedUsers = useCallback(async () => {
    setIsLoading(true);
    const result = await getBlacklistedUsersAction();
    if (result.success && result.users) {
      setBlacklistedUsers(result.users);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchBlacklistedUsers();
  }, [fetchBlacklistedUsers]);

  const handleSearch = async () => {
    if (searchTerm.length < 3) return;
    setIsSearching(true);
    setSearchResults([]);
    try {
      // Assuming searchAthletesForAdminAction exists and works as intended
      const result = await searchAthletesForAdminAction(searchTerm, 'name');
      if (result.success && result.athletes) {
        setSearchResults(result.athletes);
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to search for athletes.' });
    }
    setIsSearching(false);
  };
  
  const handleBlacklistUser = async () => {
    if (!selectedUser || !blacklistReason) return;
    setIsSubmitting(true);
    const result = await blacklistUserAction(selectedUser.uid, blacklistReason);
    if(result.success) {
        toast({ title: 'Success', description: 'User has been blacklisted.' });
        fetchBlacklistedUsers();
        setIsBlacklistModalOpen(false);
        setSelectedUser(null);
        setBlacklistReason('');
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };

  const handleUnblacklistUser = async (userId: string) => {
    const result = await unblacklistUserAction(userId);
    if(result.success) {
        toast({ title: 'Success', description: 'User has been removed from the blacklist.' });
        fetchBlacklistedUsers();
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldX className="h-5 w-5 text-destructive" />Blacklist Management</CardTitle>
          <CardDescription>Search for and add users to a blacklist to prevent them from registering for future events.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Dialog open={isBlacklistModalOpen} onOpenChange={setIsBlacklistModalOpen}>
              <DialogTrigger asChild>
                  <Button>Add User to Blacklist</Button>
              </DialogTrigger>
              <DialogContent>
                  <DialogHeader><DialogTitle>Blacklist a User</DialogTitle></DialogHeader>
                  <div className="space-y-4 py-4">
                      <div className="flex gap-2">
                          <Input placeholder="Search user by name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                          <Button onClick={handleSearch} disabled={isSearching}>{isSearching ? <Loader2 className="animate-spin" /> : <Search />}</Button>
                      </div>
                      {searchResults.length > 0 && (
                          <div className="max-h-40 overflow-y-auto border rounded-md">
                              {searchResults.map(user => (
                                  <div key={user.uid} className={`p-2 cursor-pointer hover:bg-muted ${selectedUser?.uid === user.uid ? 'bg-primary/20' : ''}`} onClick={() => setSelectedUser(user)}>
                                      {user.name} ({user.email})
                                  </div>
                              ))}
                          </div>
                      )}
                      {selectedUser && (
                          <div className="space-y-2 p-2 border rounded-md bg-muted/50">
                              <p><strong>Selected:</strong> {selectedUser.name}</p>
                              <Label htmlFor="blacklist-reason">Reason for Blacklisting</Label>
                              <Textarea id="blacklist-reason" value={blacklistReason} onChange={e => setBlacklistReason(e.target.value)} placeholder="e.g., Previous misconduct..." />
                          </div>
                      )}
                  </div>
                  <DialogFooter>
                      <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                      <Button onClick={handleBlacklistUser} disabled={!selectedUser || !blacklistReason || isSubmitting}>
                          {isSubmitting && <Loader2 className="animate-spin mr-2"/>} Confirm Blacklist
                      </Button>
                  </DialogFooter>
              </DialogContent>
          </Dialog>
          
          <div className="rounded-md border max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Reason</TableHead><TableHead>Date Blacklisted</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-24"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                ) : blacklistedUsers.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No users are currently blacklisted.</TableCell></TableRow>
                ) : (
                  blacklistedUsers.map(user => (
                    <TableRow key={user.uid}>
                      <TableCell>{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{(user as any).blacklistReason || 'N/A'}</TableCell>
                      <TableCell className="text-xs">{(user as any).blacklistedAt ? format(parseISO((user as any).blacklistedAt), 'MMM dd, yyyy') : 'N/A'}</TableCell>
                      <TableCell className="text-right">
                         <AlertDialog>
                            <AlertDialogTrigger asChild><Button variant="outline" size="xs">Remove</Button></AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove {user.name} from Blacklist?</AlertDialogTitle>
                                  <AlertDialogDescription>This will allow the user to register for future events.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleUnblacklistUser(user.uid)}>Confirm &amp; Remove</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                         </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
