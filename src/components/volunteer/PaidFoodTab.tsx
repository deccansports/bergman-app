// src/components/volunteer/PaidFoodTab.tsx
"use client";

import React, { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search as SearchIcon, UtensilsCrossed, RefreshCw } from 'lucide-react';
import type { PaidFoodOrder, PaidFoodCoupon } from '@/lib/types';
import { redeemFoodCouponAction } from '@/lib/actions/paidFoodActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface PaidFoodTabProps {
  eventId: string;
}

export default function PaidFoodTab({ eventId }: PaidFoodTabProps) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchBy, setSearchBy] = useState<'mobile' | 'email' | 'orderId' | 'coupon'>('coupon');
  const [isSearching, setIsSearching] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState<string | null>(null);
  const [foundOrder, setFoundOrder] = useState<{ order: PaidFoodOrder, coupons: PaidFoodCoupon[] } | null>(null);

  const handleSearch = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!searchTerm) return;
    setIsSearching(true);
    setFoundOrder(null);
    try {
      const response = await fetch('/api/admin/paid-food/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term: searchTerm, by: searchBy }),
      });
      const result = await response.json();
      if (response.ok && result.success && result.order) {
        toast({ title: 'Order Found!', description: `Displaying order for ${result.order.buyerName}.` });
        setFoundOrder({ order: result.order, coupons: result.coupons || [] });
      } else {
        toast({ variant: 'destructive', title: 'Not Found', description: result.message });
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Could not perform search.';
      toast({ variant: 'destructive', title: 'Error', description: errMsg });
    } finally {
      setIsSearching(false);
    }
  }, [searchTerm, searchBy, toast]);

  const handleRedeem = useCallback(async (code: string, volunteerUid: string) => {
    setIsRedeeming(code);
    try {
      const result = await redeemFoodCouponAction(code, volunteerUid);
      if (result.success) {
        toast({ title: 'Success', description: result.message });
        if (foundOrder) {
          const updatedCoupons = foundOrder.coupons.map(c => c.id === code ? { ...c, status: 'REDEEMED' as const } : c);
          setFoundOrder({ ...foundOrder, coupons: updatedCoupons });
        }
      } else {
        toast({ variant: 'destructive', title: 'Redemption Failed', description: result.message });
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Could not redeem coupon.';
      toast({ variant: 'destructive', title: 'Error', description: errMsg });
    } finally {
      setIsRedeeming(null);
    }
  }, [foundOrder, toast]);
  
  // This is a placeholder for the current user's ID, which should come from an auth context.
  const volunteerUid = "volunteer-123";

  return (
    <Card className="bg-background shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-green-600"><UtensilsCrossed className="h-5 w-5"/>Paid Food Redemption</CardTitle>
        <CardDescription>Search for an order by mobile, email, or coupon code to redeem purchased items.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
          <Select value={searchBy} onValueChange={(v) => setSearchBy(v as any)}>
            <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="coupon">4-Digit Code</SelectItem>
              <SelectItem value="mobile">Mobile Number</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="orderId">Order ID</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder={`Enter ${searchBy}...`} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} disabled={isSearching} maxLength={searchBy === 'coupon' ? 4 : undefined} />
          <Button type="submit" disabled={isSearching || !searchTerm}>
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin"/> : <SearchIcon className="h-4 w-4" />}<span className="ml-2">Find</span>
          </Button>
        </form>
        {foundOrder && (
          <Card className="mt-4">
            <CardHeader><CardTitle>Order Details</CardTitle><CardDescription>Order for {foundOrder.order.buyerName} ({foundOrder.order.buyerMobile})</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Coupon Code</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {foundOrder.coupons.map(coupon => (
                    <TableRow key={coupon.id}>
                      <TableCell>{coupon.itemName}</TableCell>
                      <TableCell className="font-mono">{coupon.id}</TableCell>
                      <TableCell><Badge variant={coupon.status === 'REDEEMED' ? 'destructive' : 'default'} className={coupon.status === 'ISSUED' ? 'bg-green-600' : ''}>{coupon.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {coupon.status === 'ISSUED' && (
                          <Button size="xs" onClick={() => handleRedeem(coupon.id, volunteerUid)} disabled={isRedeeming === coupon.id}>
                            {isRedeeming === coupon.id ? <Loader2 className="animate-spin h-3 w-3" /> : 'Redeem'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}
