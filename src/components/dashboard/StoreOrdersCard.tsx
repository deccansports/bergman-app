// src/components/dashboard/StoreOrdersCard.tsx
"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShoppingBag, Loader2, Package, ArrowRight, Truck } from 'lucide-react';
import { getUserStoreSummaryAction } from '@/lib/actions/storeActions';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export default function StoreOrdersCard({ userId }: { userId: string }) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userId) {
      getUserStoreSummaryAction(userId).then(res => {
        if (res.success) {
          setSummary(res);
        }
        setLoading(false);
      });
    }
  }, [userId]);

  if (loading) {
    return (
      <Card className="shadow-lg border-primary/20">
        <CardContent className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!summary || summary.count === 0) {
    return (
      <Card className="shadow-lg border-primary/20 bg-primary/5 group transition-all hover:bg-primary/10 w-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            Official Merchandise
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground font-medium text-left">You haven&apos;t purchased official Bergman performance gear yet.</p>
          <Button asChild className="w-full bg-primary hover:bg-primary/90 font-black uppercase tracking-widest rounded-xl h-12">
            <Link href="/shop">
              Shop Now <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg border-primary/20 bg-slate-900 text-white overflow-hidden relative group text-left w-full">
      <div className="absolute top-0 right-0 h-1 w-full bg-gradient-to-r from-orange-600 to-orange-400" />
      <CardHeader className="pb-2 text-left">
        <CardTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-orange-500" />
          Your Gear Bag (History)
        </CardTitle>
        <CardDescription className="text-slate-400 text-left">View and track your merchandise orders.</CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6 pt-4">
        {/* STATS STRIP */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-3 bg-white/5 rounded-xl border border-white/10">
            <p className="text-[10px] font-black uppercase text-slate-400">Total Orders</p>
            <p className="text-2xl font-black text-white">{summary.count}</p>
          </div>
          <div className="p-3 bg-white/5 rounded-xl border border-white/10">
            <p className="text-[10px] font-black uppercase text-slate-400">Total Spent</p>
            <p className="text-2xl font-black text-orange-500">₹{summary.totalSpent}</p>
          </div>
          <div className="p-3 bg-white/5 rounded-xl border border-white/10 hidden sm:block">
            <p className="text-[10px] font-black uppercase text-slate-400">Last Status</p>
            <p className="text-lg font-black text-white uppercase tracking-tight">{summary.lastOrderStatus}</p>
          </div>
          <div className="p-3 bg-white/5 rounded-xl border border-white/10 hidden sm:block">
            <p className="text-[10px] font-black uppercase text-slate-400">Last Purchase</p>
            <p className="text-lg font-black text-white">{format(parseISO(summary.lastOrderDate), 'dd MMM')}</p>
          </div>
        </div>

        <Separator className="bg-white/10" />

        {/* ORDER LIST */}
        <div className="space-y-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Package className="h-4 w-4" /> Order History
          </h4>
          <div className="space-y-3">
            {summary.orders?.map((order: any) => (
              <div key={order.id} className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                  <div className="text-left">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 leading-none">Order ID</p>
                    <p className="font-mono text-sm font-bold text-white uppercase">{order.orderId || order.id.slice(-8)}</p>
                  </div>
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <Badge variant={order.status === 'Paid' || order.status === 'Delivered' ? 'default' : 'secondary'} className={cn("text-[10px] uppercase font-black", order.status === 'Paid' && "bg-green-600")}>
                      {order.status}
                    </Badge>
                    <span className="text-[10px] font-bold text-slate-400">{format(parseISO(order.createdAt), 'dd MMM yyyy')}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  {order.items?.map((item: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white uppercase tracking-tight">{item.name}</span>
                        {item.size && <Badge variant="outline" className="text-[10px] border-white/20 text-white h-4 px-1">{item.size}</Badge>}
                        <span className="text-slate-500">x{item.quantity}</span>
                      </div>
                      <span className="font-black text-slate-300">₹{item.salePrice * item.quantity}</span>
                    </div>
                  ))}
                </div>

                {order.trackingId && (
                  <div className="mt-3 p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] text-orange-400 font-bold uppercase tracking-wider">
                      <Truck className="h-3 w-3" /> {order.courierPartner}: {order.trackingId}
                    </div>
                    {order.trackingUrl && (
                      <Button variant="link" asChild className="h-auto p-0 text-xs font-black uppercase text-orange-500 underline">
                        <a href={order.trackingUrl} target="_blank">Track →</a>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 flex gap-3">
          <Button asChild className="flex-1 h-12 bg-white text-slate-900 hover:bg-slate-200 font-black uppercase tracking-widest rounded-xl text-xs">
            <Link href="/shop">
              Shop More Gear <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
