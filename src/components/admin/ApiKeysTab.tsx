// src/components/admin/ApiKeysTab.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import type { ApiKey } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { createApiKeyAction, getApiKeysAction, revokeApiKeyAction } from '@/lib/actions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, KeyRound, PlusCircle, Trash2, Copy, Info } from 'lucide-react';
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
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

export default function ApiKeysTab() {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);

  const fetchApiKeys = useCallback(async () => {
    if (!currentUser?.uid) return;
    setIsLoading(true);
    const result = await getApiKeysAction(currentUser.uid);
    if (result.success && result.keys) {
      setKeys(result.keys);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch API keys.' });
    }
    setIsLoading(false);
  }, [currentUser?.uid, toast]);

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  const handleCreateKey = async () => {
    if (!currentUser?.uid || !newKeyName.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Key name is required.' });
      return;
    }
    setIsSubmitting(true);
    const result = await createApiKeyAction(currentUser.uid, newKeyName.trim());
    if (result.success && result.apiKey) {
      setGeneratedApiKey(result.apiKey);
      await fetchApiKeys();
      setNewKeyName('');
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };

  const handleRevokeKey = async (keyId: string) => {
    const result = await revokeApiKeyAction(keyId);
    if (result.success) {
      toast({ title: 'Success', description: 'API Key revoked.' });
      setKeys(prev => prev.filter(k => k.id !== keyId));
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard!' });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary"/>API Key Management</CardTitle>
          <CardDescription>
            Generate and manage API keys for live timing data ingestion. Provide these keys to your timing partners.
            The key must be included in the `Authorization` header of their API requests as a `Bearer` token (e.g., `Authorization: Bearer bm_live_...`).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Card className="bg-muted/30 border-dashed">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Create New API Key</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="Enter a name for the key (e.g., 'Timing Partner 2024')"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  disabled={isSubmitting}
                />
                <Button onClick={handleCreateKey} disabled={isSubmitting || !newKeyName.trim()}>
                  {isSubmitting ? <Loader2 className="animate-spin h-4 w-4" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                  Generate Key
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Your API Keys</h3>
             <div className="rounded-md border max-h-[60vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary"/></TableCell></TableRow>
                  ) : keys.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No API keys created yet.</TableCell></TableRow>
                  ) : (
                    keys.map(key => (
                      <TableRow key={key.id}>
                        <TableCell className="font-medium">{key.name}</TableCell>
                        <TableCell className="font-mono text-xs">{key.prefix}...</TableCell>
                        <TableCell className="text-xs">{format(parseISO(key.createdAt), 'MMM dd, yyyy')}</TableCell>
                        <TableCell className="text-xs">{key.lastUsed ? format(parseISO(key.lastUsed), 'MMM dd, yyyy p') : 'Never'}</TableCell>
                        <TableCell className="text-right">
                           <AlertDialog>
                            <AlertDialogTrigger asChild><Button size="xs" variant="destructive"><Trash2 className="h-3.5 w-3.5"/></Button></AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Revoke API Key &quot;{key.name}&quot;?</AlertDialogTitle>
                                    <AlertDialogDescription>This action cannot be undone. Any service using this key will immediately lose access.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleRevokeKey(key.id)} className="bg-destructive hover:bg-destructive/90">Revoke Key</AlertDialogAction>
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
          </div>
        </CardContent>
      </Card>
      
      <Dialog open={!!generatedApiKey} onOpenChange={(open) => !open && setGeneratedApiKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="text-green-600"/>API Key Generated Successfully!</DialogTitle>
            <DialogDescription>Please copy your new API key now. You won’t be able to see it again.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
             <div className="p-3 bg-destructive/10 border-l-4 border-destructive text-destructive-foreground">
                <h4 className="font-semibold flex items-center gap-2"><Info className="h-4 w-4"/>Important</h4>
                <p className="text-xs mt-1">This is the only time you will see the full API key. Store it in a secure location immediately.</p>
            </div>
            <div className="relative">
                <Input readOnly value={generatedApiKey || ''} className="font-mono pr-10"/>
                <Button size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8" onClick={() => copyToClipboard(generatedApiKey || '')}>
                    <Copy className="h-4 w-4"/>
                </Button>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="default">I have copied the key</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
