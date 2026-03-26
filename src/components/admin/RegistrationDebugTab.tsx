// src/components/admin/RegistrationDebugTab.tsx
"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Bug, RefreshCw } from 'lucide-react';
import { findBrokenRegistrations } from '@/lib/actions/debugActions';
import { useAuth } from '@/context/AuthContext';
import { Badge } from '../ui/badge';
import { format, parseISO } from 'date-fns';
import { forceResyncRegistrationAction } from '@/lib/actions/adminSyncActions';

interface BrokenRegistration {
    orderId: string;
    email: string;
    name: string;
    transactionId?: string | null;
    updatedAt?: string;
    status?: string;
}

export default function RegistrationDebugTab() {
  const { toast } = useToast();
  const { firebaseUserFromAuth } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [brokenRegistrations, setBrokenRegistrations] = useState<BrokenRegistration[]>([]);
  const [isRetrying, setIsRetrying] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<string | null>(null);

  const handleFindBroken = useCallback(async () => {
    setIsLoading(true);
    const result = await findBrokenRegistrations();
    if (result.success) {
      setBrokenRegistrations(result.broken);
      toast({ title: 'Scan Complete', description: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsLoading(false);
  }, [toast]);
  
  useEffect(() => {
    handleFindBroken();
  }, [handleFindBroken]);

  const handleRetry = async (orderId: string) => {
    if (!firebaseUserFromAuth) {
        toast({ variant: 'destructive', title: 'Auth Error', description: 'You must be authenticated to perform this action.' });
        return;
    }
    setIsRetrying(orderId);
    try {
        const token = await firebaseUserFromAuth.getIdToken();
        const response = await fetch('/api/admin/retry-registration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ orderId }),
        });
        const result = await response.json();
        if (result.success) {
            toast({ title: 'Retry Successful', description: `Registration for order ${orderId} finalized.` });
            handleFindBroken(); // Re-check for broken registrations
        } else {
            throw new Error(result.message || 'Retry failed.');
        }
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Retry Failed', description: error.message });
    }
    setIsRetrying(null);
  };
  
  const handleForceSync = async (orderId: string) => {
    setIsSyncing(orderId);
    const res = await forceResyncRegistrationAction(orderId);
    if (res.success) {
      toast({ title: 'Synced', description: res.message });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: res.message });
    }
    setIsSyncing(null);
  };


  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2"><Bug className="h-5 w-5 text-destructive"/>Registration Debug</CardTitle>
              <CardDescription>Find and fix registrations that failed after a successful payment.</CardDescription>
            </div>
            <Button onClick={handleFindBroken} disabled={isLoading} size="sm" variant="outline">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Re-scan
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID / Payment ID</TableHead>
                  <TableHead>Athlete</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-24"><Loader2 className="animate-spin" /></TableCell></TableRow>
                ) : brokenRegistrations.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No broken registrations found.</TableCell></TableRow>
                ) : (
                  brokenRegistrations.map(log => (
                    <TableRow key={log.orderId}>
                      <TableCell className="font-mono text-xs">
                        <div>Order: {log.orderId}</div>
                        <div className="text-muted-foreground">Payment: {log.transactionId || 'N/A'}</div>
                      </TableCell>
                      <TableCell className="text-xs">{log.name}<br/>{log.email}</TableCell>
                      <TableCell>
                          <Badge variant={log.status === 'RegistrationFailed' ? 'destructive' : log.status === 'PaymentInitiated' ? 'secondary' : 'outline'}>
                              {log.status}
                          </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{log.updatedAt ? format(parseISO(log.updatedAt), 'MMM dd, p') : 'N/A'}</TableCell>
                      <TableCell className="text-right space-x-1">
                          <Button size="xs" onClick={() => handleRetry(log.orderId)} disabled={isRetrying === log.orderId}>
                            {isRetrying === log.orderId ? <Loader2 className="animate-spin h-3 w-3" /> : 'Retry Finalize'}
                          </Button>
                        <Button size="xs" variant="outline" onClick={() => handleForceSync(log.orderId)} disabled={isSyncing === log.orderId}>
                            {isSyncing === log.orderId ? <Loader2 className="animate-spin h-3 w-3" /> : 'Sync KV'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
