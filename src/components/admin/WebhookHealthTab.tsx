// src/components/admin/WebhookHealthTab.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, AlertTriangle, PlayCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';

type WebhookLog = {
  id: string;
  source?: 'razorpay' | 'stripe' | string;
  event: string;
  razorpayPaymentId?: string;
  stripePaymentIntentId?: string;
  status: 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'SKIPPED_DUPLICATE' | 'ORPHANED' | 'IGNORED' | 'INVALID_JSON' | 'CONFIG_ERROR' | 'SIGNATURE_MISSING' | 'SIGNATURE_MISMATCH' | 'CRITICAL_ERROR' | 'processing' | 'processed' | 'processed_duplicate' | 'ignored';
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
    processing: 'secondary',
    processed: 'default',
    processed_duplicate: 'secondary',
    ignored: 'outline',
};

export default function WebhookHealthTab() {
  const { firebaseUserFromAuth } = useAuth();
  const { toast } = useToast();
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [retryingLogId, setRetryingLogId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'stripe' | 'razorpay'>('all');
  const [manualStripePaymentIntentId, setManualStripePaymentIntentId] = useState('');
  const [isManualStripeRetrying, setIsManualStripeRetrying] = useState(false);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const query = sourceFilter === 'all' ? '' : `?source=${sourceFilter}`;
      const response = await fetch(`/api/admin/webhook-health${query}`);
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
  }, [toast, sourceFilter]);
  
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

  const canRetryStripeLog = (log: WebhookLog) => {
    if (log.source !== 'stripe') return false;
    if (!log.stripePaymentIntentId) return false;
    const retryableStatuses = new Set(['FAILED', 'CRITICAL_ERROR', 'SIGNATURE_MISMATCH', 'SIGNATURE_MISSING']);
    return retryableStatuses.has(log.status);
  };

  const handleRetryStripe = async (log: WebhookLog) => {
    if (!log.stripePaymentIntentId) return;
    setRetryingLogId(log.id);
    try {
      const token = await firebaseUserFromAuth?.getIdToken();
      const response = await fetch('/api/admin/stripe/retry-finalization', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          paymentIntentId: log.stripePaymentIntentId,
          webhookLogId: log.id,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Stripe retry failed');
      }

      toast({
        title: 'Stripe Finalization Retried',
        description: result.message || 'Registration finalized successfully.',
      });
      await fetchLogs();
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'Retry Failed',
        description: e.message || 'Could not retry Stripe finalization',
      });
    } finally {
      setRetryingLogId(null);
    }
  };

  const handleManualStripeRetry = async () => {
    const paymentIntentId = manualStripePaymentIntentId.trim();
    if (!paymentIntentId) {
      toast({ variant: 'destructive', title: 'Missing Payment Intent', description: 'Paste a Stripe payment intent ID like pi_...' });
      return;
    }

    setIsManualStripeRetrying(true);
    try {
      const token = await firebaseUserFromAuth?.getIdToken();
      const response = await fetch('/api/admin/stripe/retry-finalization', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ paymentIntentId }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Manual Stripe finalization failed');
      }

      toast({ title: 'Stripe Registration Finalized', description: result.message || 'Registration finalized successfully.' });
      setManualStripePaymentIntentId('');
      await fetchLogs();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Manual Finalization Failed', description: e.message || 'Could not finalize Stripe registration' });
    } finally {
      setIsManualStripeRetrying(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Webhook Health</CardTitle>
        <CardDescription>Monitor Razorpay and Stripe webhooks and their processing status.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border p-4 space-y-3 bg-muted/20">
          <div>
            <p className="text-sm font-medium">Manual Stripe Finalization</p>
            <p className="text-xs text-muted-foreground">Paste a successful Stripe Payment Intent ID like pi_... to finalize an older stuck registration.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={manualStripePaymentIntentId}
              onChange={(e) => setManualStripePaymentIntentId(e.target.value)}
              placeholder="pi_3TFx3nDC4rWvQZIm0aeodQt5"
              disabled={isManualStripeRetrying}
            />
            <Button onClick={handleManualStripeRetry} disabled={isManualStripeRetrying || !manualStripePaymentIntentId.trim()}>
              {isManualStripeRetrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Finalize Stripe
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-between items-start sm:items-center">
            <p className="text-sm text-muted-foreground">Showing up to the latest 100 webhook events.</p>
            <div className="flex gap-2 w-full sm:w-auto">
            <div className="flex gap-1">
              <Button onClick={() => setSourceFilter('all')} variant={sourceFilter === 'all' ? 'default' : 'outline'} size="sm" disabled={isLoading || isProcessing}>All</Button>
              <Button onClick={() => setSourceFilter('stripe')} variant={sourceFilter === 'stripe' ? 'default' : 'outline'} size="sm" disabled={isLoading || isProcessing}>Stripe</Button>
              <Button onClick={() => setSourceFilter('razorpay')} variant={sourceFilter === 'razorpay' ? 'default' : 'outline'} size="sm" disabled={isLoading || isProcessing}>Razorpay</Button>
            </div>
                <Button onClick={fetchLogs} variant="outline" size="sm" disabled={isLoading || isProcessing} className="flex-1">
                    <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
                </Button>
                 <Button onClick={handleProcessWebhooks} size="sm" disabled={isProcessing || isLoading} className="flex-1">
                    {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <PlayCircle className="mr-2 h-4 w-4" />} Process Razorpay Pending
                </Button>
            </div>
        </div>
        <div className="rounded-md border max-h-[70vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gateway</TableHead>
                <TableHead>Payment ID</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Error/Detail</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center h-48"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary"/></TableCell></TableRow>
              ) : logs.length > 0 ? (
                logs.map(log => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Badge variant="outline" className="uppercase text-[10px]">
                        {log.source || 'unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.razorpayPaymentId || log.stripePaymentIntentId || 'N/A'}</TableCell>
                    <TableCell>{log.event}</TableCell>
                    <TableCell><Badge variant={statusVariantMap[log.status] || 'secondary'}>{log.status}</Badge></TableCell>
                    <TableCell>{log.receivedAt ? new Date(log.receivedAt).toLocaleString() : 'N/A'}</TableCell>
                    <TableCell className="text-xs text-destructive">{log.error || log.detail || '-'}</TableCell>
                    <TableCell className="text-right">
                      {canRetryStripeLog(log) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retryingLogId === log.id || isLoading || isProcessing}
                          onClick={() => handleRetryStripe(log)}
                        >
                          {retryingLogId === log.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Retry Stripe'}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                 <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">No webhook logs found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}