// src/components/admin/CancellationsTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { CancellationEntry, CancellationStats, AdminInitiateRefundFormInput } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { Loader2, Ban } from 'lucide-react';
import { format, parseISO } from 'date-fns';

import {
  getAllCancellationRequestsAction,
  getCancellationStatsAction,
  initiateRefundForCancellationAction,
  initiateRazorpayRefundForCancellationAction,
  markCancellationAsRefundedAction,
  syncCancellationCreditNoteAction,
  deleteCancellationRequestAction,
} from '@/lib/actions';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';

import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AdminInitiateRefundSchema } from '@/lib/schemas';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

const statusVariantMap: { [key in CancellationEntry['status']]: 'default' | 'secondary' | 'destructive' | 'outline' } = {
  Requested: 'outline',
  Processing: 'secondary',
  Refunded: 'default',
  Denied: 'destructive',
};

export default function CancellationsTab() {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const isViewOnlyAdmin = !!(currentUser?.isAdmin && currentUser?.adminAccessMode === 'view');

  const [requests, setRequests] = useState<CancellationEntry[]>([]);
  const [stats, setStats] = useState<CancellationStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefunding, setIsRefunding] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<CancellationEntry | null>(null);
  const [razorpayRefundAmount, setRazorpayRefundAmount] = useState<string>('');
  const [razorpayComments, setRazorpayComments] = useState<string>('');
  const [razorpayAmountError, setRazorpayAmountError] = useState<string>('');
  const [razorpayPaymentId, setRazorpayPaymentId] = useState<string>('');
  const [razorpayPaymentIdError, setRazorpayPaymentIdError] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState('all');

  const refundForm = useForm<AdminInitiateRefundFormInput>({
    resolver: zodResolver(AdminInitiateRefundSchema),
    defaultValues: { refundInitiatedDate: new Date(), refundTransactionId: '', adminNotes: '' },
  });

  const fetchCancellations = useCallback(async () => {
    setIsLoading(true);
    try {
      const [reqResult, statsResult] = await Promise.all([
        getAllCancellationRequestsAction(),
        getCancellationStatsAction()
      ]);

      if (reqResult.success && reqResult.cancellationRequests) {
        setRequests(reqResult.cancellationRequests);
      } else if (reqResult.message) {
        toast({ variant: 'destructive', title: 'Error', description: reqResult.message });
      }

      if (statsResult.success && statsResult.stats) {
        setStats(statsResult.stats);
      } else if (statsResult.message) {
        toast({ variant: 'destructive', title: 'Error', description: statsResult.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || "Failed to fetch data." });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchCancellations(); }, [fetchCancellations]);

  useEffect(() => {
    if (!selectedRequest) return;
    const defaultAmount = Number((selectedRequest.calculatedRefundAmountPaisa || 0) / 100).toFixed(2);
    setRazorpayRefundAmount(defaultAmount);
    setRazorpayComments('');
    setRazorpayAmountError('');
    setRazorpayPaymentId(selectedRequest.sourcePaymentId || '');
    setRazorpayPaymentIdError('');
  }, [selectedRequest]);

  const handleInitiateRefund = async (data: AdminInitiateRefundFormInput) => {
    if (!selectedRequest) return;
    setIsRefunding(selectedRequest.id);
    try {
      const result = await initiateRefundForCancellationAction(selectedRequest.id, data);
      if (result.success) {
        toast({ title: 'Success', description: result.message });
        fetchCancellations();
        setSelectedRequest(null);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } finally {
      setIsRefunding(null);
    }
  };

  const handleInitiateRazorpayRefund = async () => {
    if (!selectedRequest) return;
    const amount = Number(razorpayRefundAmount || 0);
    if (!(amount > 0)) {
      setRazorpayAmountError('Amount is required');
      return;
    }
    if (!razorpayPaymentId.trim()) {
      setRazorpayPaymentIdError(
        selectedIsRazorpay
          ? 'Razorpay Payment ID is required'
          : 'Stripe Payment ID is required (pi_... or ch_...)'
      );
      return;
    }
    setRazorpayAmountError('');
    setRazorpayPaymentIdError('');

    setIsRefunding(selectedRequest.id);
    try {
      const customAmountPaisa = Math.round(amount * 100);
      const calculatedAmountPaisa = Number(selectedRequest.calculatedRefundAmountPaisa || 0);
      const mode = customAmountPaisa === calculatedAmountPaisa ? 'calculated' : 'custom';

      const result = await initiateRazorpayRefundForCancellationAction(selectedRequest.id, {
        mode,
        customAmountPaisa,
        adminNotes: razorpayComments || null,
        paymentIdOverride: razorpayPaymentId.trim(),
      });

      if (result.success) {
        toast({ title: 'Success', description: result.message });
        fetchCancellations();
        setSelectedRequest(null);
        setRazorpayRefundAmount('');
        setRazorpayComments('');
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } finally {
      setIsRefunding(null);
    }
  };

  const handleDeleteRequest = async (cancellationId: string, userId: string) => {
    try {
      const result = await deleteCancellationRequestAction(cancellationId, userId);
      if (result.success) {
        toast({ title: 'Success', description: result.message });
        fetchCancellations();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const handleMarkRefunded = async () => {
    if (!selectedRequest) return;
    setIsRefunding(selectedRequest.id);
    try {
      const result = await markCancellationAsRefundedAction(selectedRequest.id);
      if (result.success) {
        toast({ title: 'Success', description: result.message });
        await fetchCancellations();
        setSelectedRequest(null);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } finally {
      setIsRefunding(null);
    }
  };

  const handleSyncCreditNote = async () => {
    if (!selectedRequest) return;
    setIsRefunding(selectedRequest.id);
    try {
      const result = await syncCancellationCreditNoteAction(selectedRequest.id);
      if (result.success) {
        toast({ title: 'Success', description: result.message });
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
      await fetchCancellations();
    } finally {
      setIsRefunding(null);
    }
  };

  const formatCurrency = (amount: number, currency?: string) =>
    currency === 'USD' ? `$${(amount / 100).toFixed(2)}` : `₹${(amount / 100).toFixed(2)}`;

  const eventOptions = useMemo(() => {
    const uniqueEvents = Array.from(new Set(requests.map((req) => String(req.eventName || '').trim()).filter(Boolean)));
    uniqueEvents.sort((a, b) => a.localeCompare(b));
    return uniqueEvents;
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return requests.filter((req) => {
      const matchesEvent = selectedEvent === 'all' || req.eventName === selectedEvent;
      if (!matchesEvent) return false;

      if (!query) return true;

      const participantName = String(req.participantName || '').toLowerCase();
      const participantEmail = String(req.participantEmail || '').toLowerCase();
      return participantName.includes(query) || participantEmail.includes(query);
    });
  }, [requests, selectedEvent, searchQuery]);

  const selectedPaymentGateway: 'stripe' | 'razorpay' | 'unknown' = (() => {
    if (!selectedRequest) return 'unknown';

    const method = String(selectedRequest.sourcePaymentMethod || '').toLowerCase();
    const paymentId = String(selectedRequest.sourcePaymentId || '');
    const invoiceId = String(selectedRequest.sourceInvoiceId || '');
    const currency = String(selectedRequest.currency || '').toUpperCase();

    if (
      paymentId.startsWith('pi_') ||
      paymentId.startsWith('ch_') ||
      invoiceId.startsWith('in_') ||
      method.includes('stripe') ||
      currency === 'USD'
    ) {
      return 'stripe';
    }

    if (paymentId.startsWith('pay_') || method.includes('razorpay') || currency === 'INR') {
      return 'razorpay';
    }

    return 'unknown';
  })();

  const selectedIsRazorpay = selectedPaymentGateway === 'razorpay';
  const selectedGatewayLabel = selectedPaymentGateway === 'stripe'
    ? 'Stripe'
    : selectedPaymentGateway === 'razorpay'
      ? 'Razorpay'
      : (selectedRequest?.sourcePaymentMethod || 'Unknown');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-primary" />
            Cancellation Requests
          </CardTitle>
          <CardDescription>Review and process athlete cancellation requests.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {isLoading ? <Skeleton className="h-24" /> : stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl">{stats.totalRequests}</CardTitle><CardDescription className="text-xs">Total Requests</CardDescription></CardHeader></Card>
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl text-yellow-600">{stats.pendingRequests}</CardTitle><CardDescription className="text-xs">Pending</CardDescription></CardHeader></Card>
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl text-blue-600">{stats.processingRefunds}</CardTitle><CardDescription className="text-xs">Processing</CardDescription></CardHeader></Card>
              <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl text-green-600">{formatCurrency(stats.totalRefundedAmountPaisa)}</CardTitle><CardDescription className="text-xs">Total Refunded</CardDescription></CardHeader></Card>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cancellation-search">Search by Name / Email</Label>
              <Input
                id="cancellation-search"
                placeholder="Type participant name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label>Filter by Event</Label>
              <Select value={selectedEvent} onValueChange={setSelectedEvent}>
                <SelectTrigger>
                  <SelectValue placeholder="Select event" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  {eventOptions.map((eventName) => (
                    <SelectItem key={eventName} value={eventName}>
                      {eventName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border overflow-x-auto max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Participant</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Payment ID</TableHead>
                  <TableHead>Invoice Number</TableHead>
                  <TableHead>Credit Note No.</TableHead>
                  <TableHead>RRN Refund No.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={10} className="h-24 text-center"><Loader2 className="animate-spin" /></TableCell></TableRow>
                ) : filteredRequests.length > 0 ? (
                  filteredRequests.map(req => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">
                        {req.participantName}
                        <div className="text-xs text-muted-foreground">{req.participantEmail}</div>
                      </TableCell>
                      <TableCell>{req.eventName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {req.requestedAt ? format(parseISO(req.requestedAt), 'MMM dd, yyyy') : 'N/A'}
                      </TableCell>
                      <TableCell>{formatCurrency(req.calculatedRefundAmountPaisa, req.currency)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {(() => {
                          const pid = String(req.sourcePaymentId || '');
                          const isGatewayPaymentId = pid.startsWith('pay_') || pid.startsWith('pi_') || pid.startsWith('ch_');
                          return isGatewayPaymentId ? pid : '—';
                        })()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{req.sourceInvoiceNumber || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{req.stripeCreditNoteNumber || req.zohoCreditNoteNumber || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {(() => {
                          if (req.refundRrn && req.refundRrn !== 'pending') return req.refundRrn;
                          if (req.status === 'Refunded' && req.refundTransactionId) return `pending (${req.refundTransactionId})`;
                          return '—';
                        })()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariantMap[req.status] || 'secondary'}>{req.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="outline" size="xs" onClick={() => setSelectedRequest(req)}>
                          View/Process
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="xs">Delete</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Request?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the cancellation record. It will NOT revert the participant&apos;s status.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteRequest(req.id, req.userId)} className="bg-destructive hover:bg-destructive/90">
                                Confirm Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                      {requests.length === 0 ? 'No cancellation requests found.' : 'No requests match the current filters.'}
                    </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {selectedRequest && (
        <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
          <DialogContent className="sm:max-w-xl text-left max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-left">Process Cancellation: {selectedRequest.participantName}</DialogTitle>
            </DialogHeader>

            <div className="py-4 space-y-4 text-left">
              <p><strong>Refund Policy Applied:</strong> {selectedRequest.refundPolicyApplied}</p>
              <p>
                <strong>Calculated Refund:</strong>{' '}
                <span className="font-bold text-primary">
                  {formatCurrency(selectedRequest.calculatedRefundAmountPaisa, selectedRequest.currency)}
                </span>
              </p>

              {(selectedRequest.sourcePaymentMethod || selectedRequest.sourcePaymentId) && (
                <Card>
                  <CardHeader className="p-4 border-b">
                    <CardTitle className="text-base">Payment Source</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 text-sm space-y-1">
                    <p><strong>Method:</strong> {selectedGatewayLabel}</p>
                    <p><strong>Payment ID:</strong> {selectedRequest.sourcePaymentId || 'N/A'}</p>
                    <p><strong>Invoice Number:</strong> {selectedRequest.sourceInvoiceNumber || 'N/A'}</p>
                    <p>
                      <strong>Refund RRN/ARN:</strong>{' '}
                      {selectedRequest.refundRrn && selectedRequest.refundRrn !== 'pending'
                        ? selectedRequest.refundRrn
                        : (selectedRequest.refundTransactionId ? `pending (${selectedRequest.refundTransactionId})` : 'N/A')}
                    </p>
                  </CardContent>
                </Card>
              )}

              {(selectedRequest.status === 'Processing' || selectedRequest.status === 'Refunded') && (
                <Card>
                  <CardHeader className="p-4 border-b">
                    <CardTitle className="text-base">Accounting</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Credit Note: {selectedRequest.stripeCreditNoteNumber || selectedRequest.stripeCreditNoteId || selectedRequest.zohoCreditNoteNumber || selectedRequest.zohoCreditNoteId || 'Not synced'}
                      {(selectedRequest.stripeCreditNoteStatus || selectedRequest.zohoCreditNoteStatus) ? ` (${selectedRequest.stripeCreditNoteStatus || selectedRequest.zohoCreditNoteStatus})` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Refund RRN/ARN: {selectedRequest.refundRrn && selectedRequest.refundRrn !== 'pending'
                        ? selectedRequest.refundRrn
                        : (selectedRequest.refundTransactionId ? `Pending (${selectedRequest.refundTransactionId})` : 'Not available')}
                    </p>
                    {!!(selectedRequest.stripeCreditNoteError || selectedRequest.zohoCreditNoteError) && (
                      <p className="text-xs text-destructive">{selectedRequest.stripeCreditNoteError || selectedRequest.zohoCreditNoteError}</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={handleSyncCreditNote}
                        disabled={isRefunding === selectedRequest.id || isViewOnlyAdmin}
                      >
                        {isRefunding === selectedRequest.id && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
                        Sync Credit Note
                      </Button>

                      {selectedRequest.status === 'Processing' && (
                        <Button
                          onClick={handleMarkRefunded}
                          disabled={isRefunding === selectedRequest.id || isViewOnlyAdmin}
                        >
                          {isRefunding === selectedRequest.id && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
                          Mark as Refunded
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {selectedRequest.bankDetails && (
                <Card>
                  <CardHeader className="p-4 border-b">
                    <CardTitle className="text-base">Bank Details</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 text-sm space-y-1">
                    <p><strong>Holder:</strong> {selectedRequest.bankDetails.accountHolderName}</p>
                    <p><strong>Account No:</strong> {selectedRequest.bankDetails.accountNumber}</p>
                    <p><strong>IFSC:</strong> {selectedRequest.bankDetails.ifscCode}</p>
                    <p><strong>Bank:</strong> {selectedRequest.bankDetails.bankName}</p>
                    <p><strong>Registered Mobile:</strong> {selectedRequest.bankDetails.registeredMobileNumber || 'N/A'}</p>
                  </CardContent>
                </Card>
              )}

              {!selectedRequest.bankDetails && !selectedIsRazorpay && (
                <Alert className="bg-muted/30">
                  <AlertDescription>
                    No bank details were provided by athlete. Use manual refund only after collecting account details.
                  </AlertDescription>
                </Alert>
              )}

              {selectedRequest.status === 'Requested' && selectedRequest.calculatedRefundAmountPaisa > 0 && (
                <Card>
                  <CardHeader className="p-4 border-b">
                    <CardTitle className="text-base">
                      {selectedIsRazorpay ? 'Refund from Razorpay' : 'Refund from Stripe'}
                    </CardTitle>
                    <CardDescription>
                      {selectedIsRazorpay ? 'Refund Payment (INR)' : 'Refund Payment (USD)'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-3 space-y-3 max-h-60 overflow-y-auto pr-2">
                    {!selectedIsRazorpay && !selectedRequest.sourcePaymentId && (
                      <Alert className="bg-muted/30">
                        <AlertDescription className="text-xs">
                          Legacy record detected. Enter Stripe Payment Intent ID manually to enable refund button.
                        </AlertDescription>
                      </Alert>
                    )}

                    {selectedIsRazorpay && (
                      <>
                        {!selectedRequest.sourcePaymentId && (
                          <Alert className="bg-muted/30">
                            <AlertDescription className="text-xs">
                              Legacy record detected. Enter Razorpay Payment ID manually to enable refund button.
                            </AlertDescription>
                          </Alert>
                        )}

                        <div className="space-y-1">
                          <Label htmlFor="razorpay-payment-id">Razorpay Payment ID</Label>
                          <Input
                            id="razorpay-payment-id"
                            placeholder="pay_xxxxx"
                            value={razorpayPaymentId}
                            onChange={(e) => {
                              setRazorpayPaymentId(e.target.value);
                              if (e.target.value) setRazorpayPaymentIdError('');
                            }}
                          />
                          {razorpayPaymentIdError ? <p className="text-xs text-destructive">{razorpayPaymentIdError}</p> : null}
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="refund-amount">Refund Amount</Label>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">₹</span>
                            <Input
                              id="refund-amount"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Enter the refund amount"
                              value={razorpayRefundAmount}
                              onChange={(e) => {
                                setRazorpayRefundAmount(e.target.value);
                                if (e.target.value) setRazorpayAmountError('');
                              }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">₹ - Indian Rupee (INR)</p>
                          {razorpayAmountError ? <p className="text-xs text-destructive">{razorpayAmountError}</p> : null}
                        </div>

                        <Alert className="bg-muted/30">
                          <AlertDescription className="text-xs">
                            Currently, Instant Refunds are available on TPV, netbanking and UPI only.
                          </AlertDescription>
                        </Alert>

                        <div className="space-y-1">
                          <Label htmlFor="refund-comments">+ Add Comments(Optional)</Label>
                          <Input
                            id="refund-comments"
                            placeholder="Add internal comments"
                            value={razorpayComments}
                            onChange={(e) => setRazorpayComments(e.target.value)}
                          />
                        </div>

                        <Button
                          onClick={handleInitiateRazorpayRefund}
                          disabled={isRefunding === selectedRequest.id}
                          className="w-full"
                        >
                          {isRefunding === selectedRequest.id && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
                          Refund Instantly
                        </Button>
                      </>
                    )}

                    {!selectedIsRazorpay && (
                      <>
                        <div className="space-y-1">
                          <Label htmlFor="stripe-payment-id">Stripe Payment ID</Label>
                          <Input
                            id="stripe-payment-id"
                            placeholder="pi_xxxxx or ch_xxxxx"
                            value={razorpayPaymentId}
                            onChange={(e) => {
                              setRazorpayPaymentId(e.target.value);
                              if (e.target.value) setRazorpayPaymentIdError('');
                            }}
                          />
                          {razorpayPaymentIdError ? <p className="text-xs text-destructive">{razorpayPaymentIdError}</p> : null}
                        </div>

                        <div className="space-y-1">
                          <Label>Refund Amount</Label>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">$</span>
                            <Input
                              type="number"
                              disabled
                              value={(selectedRequest.calculatedRefundAmountPaisa / 100).toFixed(2)}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">$ - US Dollar (USD) - Policy Refund</p>
                        </div>

                        <Alert className="bg-blue-50">
                          <AlertDescription className="text-xs">
                            Stripe refund will be processed with policy amount. A credit note will be automatically created for accounting purposes.
                          </AlertDescription>
                        </Alert>

                        <Button
                          onClick={handleInitiateRazorpayRefund}
                          disabled={isRefunding === selectedRequest.id}
                          className="w-full"
                        >
                          {isRefunding === selectedRequest.id && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
                          Refund & Create Credit Note
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {selectedRequest.status === 'Requested' && selectedRequest.calculatedRefundAmountPaisa > 0 && (
                <Form {...refundForm}>
                  <form
                    onSubmit={refundForm.handleSubmit(handleInitiateRefund)}
                    className="space-y-3 p-3 border rounded-lg bg-muted/30 text-left max-h-60 overflow-y-auto"
                  >
                    <FormField
                      control={refundForm.control}
                      name="refundInitiatedDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col text-left">
                          <FormLabel>Refund Initiated Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  type="button"
                                  variant={"outline"}
                                  className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {field.value ? format(field.value, "PPP") : "Pick a date"}
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={refundForm.control}
                      name="refundTransactionId"
                      render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel>Refund Transaction ID</FormLabel>
                          <Input {...field} />
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={refundForm.control}
                      name="adminNotes"
                      render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel>Admin Notes</FormLabel>
                          <Input {...field} value={field.value || ''} />
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button type="submit" disabled={isRefunding === selectedRequest.id || isViewOnlyAdmin} className="w-full">
                      {isRefunding === selectedRequest.id && (
                        <Loader2 className="animate-spin h-4 w-4 mr-2" />
                      )}
                      Initiate Refund &amp; Update Status
                    </Button>
                  </form>
                </Form>
              )}
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
