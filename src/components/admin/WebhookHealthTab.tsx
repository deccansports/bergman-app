// src/components/admin/WebhookHealthTab.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, AlertTriangle, PlayCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';

type WebhookLog = {
  id: string;
  event: string;
  razorpayPaymentId: string;
  status: 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'SKIPPED_DUPLICATE' | 'ORPHANED' | 'IGNORED' | 'INVALID_JSON' | 'CONFIG_ERROR' | 'SIGNATURE_MISSING' | 'SIGNATURE_MISMATCH' | 'CRITICAL_ERROR';
  receivedAt: string;
  processedAt?: string | null;
  error?: string | null;
  detail?: string | null;
};

const statusVariantMap: { [key: string]: 'default' | 'secondary' | 'destructive' | 'outline' } = {
    PROCESSED: 'default',
    RECEIVED: 'secondary',
    FAILED: 'destructive',
    SKIPPED_DUPLICATE: 'secondary',
    ORPHANED: 'destructive',
    IGNORED: 'outline',
    INVALID_JSON: 'destructive',
    CONFIG_ERROR: 'destructive',
    SIGNATURE_MISSING: 'destructive',
    SIGNATURE_MISMATCH: 'destructive',
    CRITICAL_ERROR: 'destructive',
};

export default function WebhookHealthTab() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/webhook-health");
      if (!response.ok) {
        throw new Error('Failed to fetch webhook health data.');
      }
      const data = await response.json();
      setLogs(data);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: `Could not load logs: ${e.message}` });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);
  
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleProcessWebhooks = async () => {
    setIsProcessing(true);
    try {
        const response = await fetch('/api/jobs/process-razorpay-webhooks', { method: 'POST' });
        const result = await response.json();
        if (response.ok && result.success) {
            toast({ title: 'Processing Complete', description: result.message });
        } else {
            throw new Error(result.message || 'Failed to trigger webhook processing.');
        }
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Processing Error', description: e.message });
    } finally {
        setIsProcessing(false);
        fetchLogs(); // Refresh logs after processing
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Razorpay Webhook Health</CardTitle>
        <CardDescription>Monitor incoming payment webhooks and their processing status for Zoho synchronization.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-2 justify-between items-start sm:items-center">
            <p className="text-sm text-muted-foreground">Showing the last 50 webhook events received.</p>
            <div className="flex gap-2 w-full sm:w-auto">
                <Button onClick={fetchLogs} variant="outline" size="sm" disabled={isLoading || isProcessing} className="flex-1">
                    <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
                </Button>
                 <Button onClick={handleProcessWebhooks} size="sm" disabled={isProcessing || isLoading} className="flex-1">
                    {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <PlayCircle className="mr-2 h-4 w-4" />} Process Pending
                </Button>
            </div>
        </div>
        <div className="rounded-md border max-h-[70vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment ID</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Error/Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center h-48"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary"/></TableCell></TableRow>
              ) : logs.length > 0 ? (
                logs.map(log => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs">{log.razorpayPaymentId || 'N/A'}</TableCell>
                    <TableCell>{log.event}</TableCell>
                    <TableCell><Badge variant={statusVariantMap[log.status] || 'secondary'}>{log.status}</Badge></TableCell>
                    <TableCell>{log.receivedAt ? new Date(log.receivedAt).toLocaleString() : 'N/A'}</TableCell>
                    <TableCell className="text-xs text-destructive">{log.error || log.detail || '-'}</TableCell>
                  </TableRow>
                ))
              ) : (
                 <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">No webhook logs found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}