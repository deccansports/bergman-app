// src/components/admin/CancellationsTab.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import type { CancellationEntry, CancellationStats, AdminInitiateRefundFormInput } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

import { Loader2, Ban } from 'lucide-react';
import { format, parseISO } from 'date-fns';

import {
  getAllCancellationRequestsAction,
  getCancellationStatsAction,
  initiateRefundForCancellationAction,
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

const statusVariantMap: { [key in CancellationEntry['status']]: 'default' | 'secondary' | 'destructive' | 'outline' } = {
  Requested: 'outline',
  Processing: 'secondary',
  Refunded: 'default',
  Denied: 'destructive',
};

export default function CancellationsTab() {
  const { toast } = useToast();

  const [requests, setRequests] = useState<CancellationEntry[]>([]);
  const [stats, setStats] = useState<CancellationStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefunding, setIsRefunding] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<CancellationEntry | null>(null);

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

  const formatCurrency = (amount: number) => `₹${(amount / 100).toFixed(2)}`;

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

          <div className="rounded-md border overflow-x-auto max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Participant</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="animate-spin" /></TableCell></TableRow>
                ) : requests.length > 0 ? (
                  requests.map(req => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">
                        {req.participantName}
                        <div className="text-xs text-muted-foreground">{req.participantEmail}</div>
                      </TableCell>
                      <TableCell>{req.eventName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {req.requestedAt ? format(parseISO(req.requestedAt), 'MMM dd, yyyy') : 'N/A'}
                      </TableCell>
                      <TableCell>{formatCurrency(req.calculatedRefundAmountPaisa)}</TableCell>
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
                  <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No cancellation requests found.
                    </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {selectedRequest && (
        <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
          <DialogContent className="sm:max-w-xl text-left">
            <DialogHeader>
              <DialogTitle className="text-left">Process Cancellation: {selectedRequest.participantName}</DialogTitle>
            </DialogHeader>

            <div className="py-4 space-y-4 text-left">
              <p><strong>Refund Policy Applied:</strong> {selectedRequest.refundPolicyApplied}</p>
              <p>
                <strong>Calculated Refund:</strong>{' '}
                <span className="font-bold text-primary">
                  {formatCurrency(selectedRequest.calculatedRefundAmountPaisa)}
                </span>
              </p>

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

              {selectedRequest.status === 'Requested' && selectedRequest.calculatedRefundAmountPaisa > 0 && (
                <Form {...refundForm}>
                  <form
                    onSubmit={refundForm.handleSubmit(handleInitiateRefund)}
                    className="space-y-4 p-4 border rounded-lg bg-muted/30 text-left"
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

                    <Button type="submit" disabled={isRefunding === selectedRequest.id} className="w-full">
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
