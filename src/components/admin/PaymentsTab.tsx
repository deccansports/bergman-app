// src/components/admin/PaymentsTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, IndianRupee, Search, RefreshCw } from 'lucide-react';
import type { PaymentRecord } from '@/lib/types';
import { getPaymentRecordsAction, refundPaymentAction } from '@/lib/actions';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface Props {
  selectedEventId: string | null | undefined;
}

export default function PaymentsTab({ selectedEventId }: Props) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const isViewOnlyAdmin = !!(currentUser?.isAdmin && currentUser?.adminAccessMode === 'view');
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchBy, setSearchBy] = useState<'paymentId' | 'orderId' | 'email' | 'contact' | 'method'>('paymentId');
  const [isRefunding, setIsRefunding] = useState<string | null>(null);

  const fetchPayments = useCallback(async (term?: string, by?: typeof searchBy, eventId?: string | null) => {
    setIsLoading(true);
    try {
      const result = await getPaymentRecordsAction({ searchTerm: term, searchBy: by });
      if (result.success && result.payments) {
        setPayments(result.payments);
      } else {
        setPayments([]);
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch payments.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);
  
  useEffect(() => {
    fetchPayments(undefined, undefined, selectedEventId || undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  const filteredPayments = useMemo(() => {
    if (!searchTerm.trim()) return payments;
    const term = searchTerm.toLowerCase().trim();
    return payments.filter((p) => {
      switch (searchBy) {
        case 'paymentId': return p.id?.toLowerCase().includes(term);
        case 'orderId': return (p as any).order_id?.toLowerCase().includes(term);
        case 'email': return p.email?.toLowerCase().includes(term);
        case 'contact': return String(p.contact || '').toLowerCase().includes(term);
        case 'method': return p.method?.toLowerCase().includes(term);
        default: return true;
      }
    });
  }, [payments, searchTerm, searchBy]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchPayments(searchTerm, searchBy, selectedEventId || undefined);
  };
  
  const handleRefund = async (paymentId: string) => {
    setIsRefunding(paymentId);
    const result = await refundPaymentAction(paymentId);
    if(result.success) {
        toast({ title: 'Refund Initiated', description: result.message });
        await fetchPayments(searchTerm, searchBy, selectedEventId || undefined);
    } else {
        toast({ variant: 'destructive', title: 'Refund Failed', description: result.message });
    }
    setIsRefunding(null);
  };

  const getNoteDisplay = (notes: Record<string, any> | undefined) => {
    if (!notes) return 'N/A';
    
    // Default display is the type
    let display = notes.type || 'N/A';
    
    const eventName = notes.eventName || 'event';

    if (notes.type === 'event_registration') {
      display = `Event Registration (${eventName})`;
    } else if (notes.type === 'category_change') {
      display = `Category Change (${eventName})`;
    } else if (notes.type === 'paid_food_purchase') {
      display = `Food Purchase (${eventName})`;
    } else if (notes.type === 'deferral_fee') {
      display = `Deferral Fee (${eventName})`;
    }
    
    return display;
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><IndianRupee className="h-5 w-5 text-primary"/>Payment Transactions</CardTitle>
        <CardDescription>View and manage recent transactions from Razorpay for the selected event.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
            <Select value={searchBy} onValueChange={v => setSearchBy(v as any)}><SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="paymentId">Payment ID</SelectItem><SelectItem value="orderId">Order ID</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="contact">Contact</SelectItem><SelectItem value="method">Method</SelectItem>
            </SelectContent></Select>
            <Input placeholder={`Search by ${searchBy}...`} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} disabled={isLoading} className="flex-grow"/>
            <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
                {isLoading ? <Loader2 className="animate-spin h-4 w-4"/> : <Search className="h-4 w-4" />}
                <span className="ml-2">Search</span>
            </Button>
            <Button variant="outline" onClick={() => fetchPayments(searchTerm || undefined, searchBy, selectedEventId || undefined)} disabled={isLoading}><RefreshCw className="h-4 w-4"/></Button>
        </form>
        <div className="rounded-md border max-h-[70vh] overflow-auto">
            <Table>
                <TableHeader><TableRow><TableHead>Payment ID</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Contact</TableHead><TableHead>Notes</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                    {isLoading ? <TableRow><TableCell colSpan={8} className="text-center p-8"><Loader2 className="animate-spin h-8 w-8 text-primary mx-auto"/></TableCell></TableRow>
                    : filteredPayments.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-8">No payments found for the current filter.</TableCell></TableRow>
                    : filteredPayments.map(p => (
                        <TableRow key={p.id}>
                            <TableCell className="font-mono text-xs">{p.id.replace('pay_', '')}</TableCell>
                            <TableCell>₹{(p.amount / 100).toFixed(2)}</TableCell>
                            <TableCell>{p.method}</TableCell>
                            <TableCell className="text-xs">{p.email}<br/>{p.contact}</TableCell>
                            <TableCell className="text-xs max-w-xs truncate">
                              {getNoteDisplay(p.notes)}
                            </TableCell>
                            <TableCell className="text-xs">{format(new Date(p.created_at * 1000), 'MMM dd, p')}</TableCell>
                            <TableCell><Badge variant={p.status === 'captured' ? 'default' : 'destructive'}>{p.status}</Badge></TableCell>
                            <TableCell>
                                {p.status === 'captured' && p.amount_refunded === 0 && (
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button size="xs" variant="destructive" disabled={isRefunding === p.id || isViewOnlyAdmin}>
                                                {isRefunding === p.id ? <Loader2 className="animate-spin h-4 w-4"/> : 'Refund'}
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader><AlertDialogTitle>Confirm Full Refund</AlertDialogTitle><AlertDialogDescription>This will initiate a full refund of ₹{(p.amount/100).toFixed(2)} for payment {p.id}. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={()=>handleRefund(p.id)} disabled={isRefunding===p.id || isViewOnlyAdmin}>Confirm Refund</AlertDialogAction></AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
      </CardContent>
    </Card>
  );
}
