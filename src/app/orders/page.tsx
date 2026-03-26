
// src/app/orders/page.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { 
    getUserStoreSummaryAction 
} from '@/lib/actions/storeActions';
import { 
    getAthleteRegisteredEventsAction 
} from '@/lib/actions/userActions';
import type { StoreOrder, AthleteRegisteredEventDetail } from '@/lib/types';
import { 
    Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter 
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
    ShoppingBag, Ticket, Loader2, Package, Truck, Download, 
    ArrowRight, History, Calendar, ExternalLink, RefreshCw, Search, X, Award, Info
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import Image from 'next/image';
import { cn, isValidImageUrl } from '@/lib/utils';

function OrderSkeleton() {
    return (
        <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                    <CardHeader className="h-24 bg-muted" />
                    <CardContent className="h-32" />
                </Card>
            ))}
        </div>
    );
}

export default function OrdersDashboardPage() {
    const { currentUser } = useAuth();
    const { toast } = useToast();
    const [merchOrders, setMerchOrders] = useState<StoreOrder[]>([]);
    const [ticketOrders, setTicketOrders] = useState<AthleteRegisteredEventDetail[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('merchandise');
    const [searchTerm, setSearchTerm] = useState('');

    const fetchData = useCallback(async () => {
        if (!currentUser?.uid) return;
        setLoading(true);
        try {
            const [storeRes, ticketsRes] = await Promise.all([
                getUserStoreSummaryAction(currentUser.uid),
                getAthleteRegisteredEventsAction(currentUser.uid)
            ]);

            if (storeRes.success) {
                setMerchOrders(storeRes.orders || []);
            }
            if (ticketsRes.success) {
                setTicketOrders(ticketsRes.events || []);
            }
        } catch (e) {
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to load order history.' });
        } finally {
            setLoading(false);
        }
    }, [currentUser?.uid, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const filteredMerch = useMemo(() => {
        if (!searchTerm) return merchOrders;
        const lower = searchTerm.toLowerCase();
        return merchOrders.filter(o => 
            o.orderId?.toLowerCase().includes(lower) ||
            o.items.some(i => i.name.toLowerCase().includes(lower)) ||
            (o.createdAt && format(parseISO(o.createdAt), 'MMM dd yyyy').toLowerCase().includes(lower))
        );
    }, [merchOrders, searchTerm]);

    const filteredTickets = useMemo(() => {
        if (!searchTerm) return ticketOrders;
        const lower = searchTerm.toLowerCase();
        return ticketOrders.filter(t => 
            t.eventName.toLowerCase().includes(lower) ||
            t.bookingId?.toLowerCase().includes(lower) ||
            t.ticketName?.toLowerCase().includes(lower) ||
            (t.eventDate && format(parseISO(t.eventDate), 'MMM dd yyyy').toLowerCase().includes(lower))
        );
    }, [ticketOrders, searchTerm]);

    return (
        <div className="container mx-auto py-12 px-4 max-w-6xl text-left">
            <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-10 gap-6">
                <div className="space-y-2 text-left">
                    <h1 className="text-4xl font-black uppercase italic tracking-tighter flex items-center gap-3 text-left text-primary">
                        <History className="h-8 w-8" /> My Portfolio
                    </h1>
                    <p className="text-muted-foreground font-medium text-left">Gear, tickets, and race experiences.</p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                    <div className="relative flex-grow sm:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input 
                            placeholder="Search by name, ID or date..." 
                            className="pl-10 h-11 rounded-xl bg-muted/30 border-none focus:ring-2 focus:ring-primary"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                    <Button variant="outline" size="icon" onClick={fetchData} disabled={loading} className="rounded-xl h-11 w-11 shrink-0">
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-muted/50 p-1 mb-10 rounded-xl border border-border/50">
                    <TabsTrigger value="merchandise" className="rounded-lg font-black uppercase text-[10px] tracking-widest gap-2 h-10">
                        <ShoppingBag className="h-4 w-4" /> Merchandise
                    </TabsTrigger>
                    <TabsTrigger value="tickets" className="rounded-lg font-black uppercase text-[10px] tracking-widest gap-2 h-10">
                        <Ticket className="h-4 w-4" /> Race Tickets
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="merchandise" className="animate-in slide-in-from-left-4 duration-500">
                    {loading ? <OrderSkeleton /> : filteredMerch.length === 0 ? (
                        <div className="text-center py-20 bg-muted/20 rounded-3xl border-2 border-dashed">
                            <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                            <p className="text-lg font-bold text-muted-foreground text-center">{searchTerm ? "No orders match your search." : "No merchandise orders yet."}</p>
                            <Button asChild className="mt-6 rounded-xl font-black uppercase tracking-widest" variant="outline">
                                <Link href="/shop">Start Shopping</Link>
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {filteredMerch.map(order => (
                                <Card key={order.id} className="overflow-hidden border-none shadow-xl bg-card rounded-3xl group transition-all hover:shadow-2xl">
                                    <CardHeader className="bg-muted/30 p-6 sm:p-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-left">
                                        <div className="flex flex-wrap gap-x-8 gap-y-4 text-left">
                                            <div className="space-y-1 text-left">
                                                <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest text-left">Order Reference</p>
                                                <p className="font-mono text-sm font-bold text-primary uppercase text-left">{order.orderId || order.id.slice(-8)}</p>
                                            </div>
                                            <div className="space-y-1 text-left">
                                                <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest text-left">Date Placed</p>
                                                <p className="text-sm font-bold text-left">{order.createdAt ? format(parseISO(order.createdAt), 'dd MMM yyyy') : '—'}</p>
                                            </div>
                                            <div className="space-y-1 text-left">
                                                <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest text-left">Order Total</p>
                                                <p className="text-sm font-black text-orange-600 text-left">₹{order.totalAmount}</p>
                                            </div>
                                        </div>
                                        <Badge variant={order.status === 'Paid' || order.status === 'Delivered' || order.status === 'Shipped' ? 'default' : 'secondary'} className={cn("text-[10px] font-black uppercase px-3 py-1", (order.status === 'Paid' || order.status === 'Shipped' || order.status === 'Delivered') && "bg-green-600")}>
                                            {order.status}
                                        </Badge>
                                    </CardHeader>
                                    <CardContent className="p-6 sm:p-8">
                                        <div className="space-y-6">
                                            {order.items.map((item, idx) => (
                                                <div key={idx} className="flex gap-6 items-start group/item">
                                                    <div className="relative h-24 w-20 rounded-2xl overflow-hidden bg-muted border border-border/50 shrink-0 shadow-inner">
                                                        {isValidImageUrl(item.image) ? (
                                                            <Image src={item.image} alt={item.name} fill className="object-cover transition-transform group-hover/item:scale-110 duration-500" />
                                                        ) : (
                                                            <div className="flex items-center justify-center h-full"><Package className="h-8 w-8 text-muted-foreground/30" /></div>
                                                        )}
                                                    </div>
                                                    <div className="flex-grow space-y-1 pt-1 text-left">
                                                        <h4 className="font-black text-base uppercase tracking-tight leading-tight text-left">{item.name}</h4>
                                                        <div className="flex items-center gap-3 mt-2">
                                                            {item.size && <Badge variant="secondary" className="text-[10px] h-5 font-bold uppercase">{item.size}</Badge>}
                                                            <span className="text-xs text-muted-foreground font-bold">Qty: {item.quantity}</span>
                                                            <span className="text-xs font-black text-slate-400">@ ₹{item.salePrice}</span>
                                                        </div>
                                                        <div className="pt-3 text-left">
                                                            <Button variant="link" asChild className="p-0 h-auto text-[10px] font-black uppercase tracking-widest text-primary">
                                                                <Link href="/shop">View Product →</Link>
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {order.status === 'Shipped' && order.trackingId && (
                                            <div className="mt-8 p-5 rounded-2xl bg-primary/5 border border-primary/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-left">
                                                <div className="flex items-center gap-4 text-left">
                                                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
                                                        <Truck className="h-6 w-6 text-primary" />
                                                    </div>
                                                    <div className="text-left">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground leading-none text-left">In Transit: {order.courierPartner}</p>
                                                        <p className="text-sm font-bold mt-1 uppercase text-left">AWB: {order.trackingId}</p>
                                                    </div>
                                                </div>
                                                {order.trackingUrl && (
                                                    <Button asChild size="sm" className="w-full sm:w-auto rounded-xl font-black uppercase text-[10px] tracking-widest h-10 px-6">
                                                        <a href={order.trackingUrl} target="_blank">Live Tracking <ExternalLink className="ml-2 h-3 w-3" /></a>
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </CardContent>
                                    <CardFooter className="bg-muted/10 p-6 sm:px-8 border-t flex flex-col sm:flex-row justify-end gap-3">
                                        {(order.invoiceId && ['Paid', 'Shipped', 'Delivered', 'Processing'].includes(order.status)) && (
                                            <Button variant="outline" size="sm" asChild className="w-full sm:w-auto rounded-xl font-black uppercase text-[10px] tracking-widest h-11 px-6 bg-background">
                                                <a href={`/api/invoice/${order.orderId || order.id}`} target="_blank">
                                                    <Download className="mr-2 h-4 w-4" /> Download Tax Invoice
                                                </a>
                                            </Button>
                                        )}
                                        <Button asChild size="sm" variant="secondary" className="w-full sm:w-auto rounded-xl font-black uppercase text-[10px] tracking-widest h-11 px-6 border border-border">
                                            <Link href="/shop">Buy Again</Link>
                                        </Button>
                                    </CardFooter>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="tickets" className="animate-in slide-in-from-left-4 duration-500">
                    {loading ? <OrderSkeleton /> : filteredTickets.length === 0 ? (
                        <div className="text-center py-20 bg-muted/20 rounded-3xl border-2 border-dashed">
                            <Ticket className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                            <p className="text-lg font-bold text-muted-foreground text-center">{searchTerm ? "No registrations match your search." : "No ticket purchases found."}</p>
                            <Button asChild className="mt-6 rounded-xl font-black uppercase tracking-widest" variant="outline">
                                <Link href="/races">View All Races</Link>
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {filteredTickets.map(ticket => (
                                <Card key={ticket.participantId} className="overflow-hidden border-none shadow-xl bg-card rounded-3xl group transition-all hover:shadow-2xl">
                                    <CardHeader className="bg-muted/30 p-6 sm:p-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-left">
                                        <div className="flex flex-wrap gap-x-8 gap-y-4 text-left">
                                            <div className="space-y-1 text-left">
                                                <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest text-left">Booking ID</p>
                                                <p className="font-mono text-sm font-bold text-primary uppercase text-left">{ticket.bookingId || 'PENDING'}</p>
                                            </div>
                                            <div className="space-y-1 text-left">
                                                <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest text-left">Registered Date</p>
                                                <p className="text-sm font-bold text-left">{ticket.registeredAt ? format(parseISO(ticket.registeredAt), 'dd MMM yyyy') : '—'}</p>
                                            </div>
                                        </div>
                                        <Badge variant={ticket.ticketStatus === 'Active' || ticket.ticketStatus === 'Confirmed' ? 'default' : 'secondary'} className={cn("text-[10px] font-black uppercase px-3 py-1", (ticket.ticketStatus === 'Active' || ticket.ticketStatus === 'Confirmed') && "bg-green-600")}>
                                            {ticket.ticketStatus}
                                        </Badge>
                                    </CardHeader>
                                    <CardContent className="p-6 sm:p-8 text-left">
                                        <div className="flex flex-col md:flex-row justify-between gap-8 text-left">
                                            <div className="space-y-6 flex-1 text-left">
                                                <div className="flex items-center gap-4 text-left">
                                                    <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
                                                        <Ticket className="h-7 w-7 text-primary" />
                                                    </div>
                                                    <div className="text-left">
                                                        <h3 className="text-2xl font-black uppercase tracking-tight italic text-primary leading-tight text-left">{ticket.eventName}</h3>
                                                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-1 text-left">{ticket.ticketName}</p>
                                                    </div>
                                                </div>
                                                
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 text-left">
                                                    <div className="text-left">
                                                        <p className="text-[10px] font-black uppercase text-muted-foreground mb-1 text-left">Race Date</p>
                                                        <div className="flex items-center gap-2 font-bold text-sm text-left">
                                                            <Calendar className="h-4 w-4 text-primary" />
                                                            {ticket.eventDate ? format(parseISO(ticket.eventDate), 'dd MMM yyyy') : 'TBD'}
                                                        </div>
                                                    </div>
                                                    <div className="text-left">
                                                        <p className="text-[10px] font-black uppercase text-muted-foreground mb-1 text-left">BIB Number</p>
                                                        <div className="text-xl font-black text-orange-500 font-mono tracking-tighter text-left">
                                                            {ticket.athleteBibNumber || 'TBD'}
                                                        </div>
                                                    </div>
                                                    <div className="text-left hidden sm:block">
                                                        <p className="text-[10px] font-black uppercase text-muted-foreground mb-1 text-left">Category</p>
                                                        <p className="text-sm font-bold uppercase text-left">{ticket.athleteRaceCategory || 'N/A'}</p>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div className="md:w-1/3 p-6 bg-slate-900 text-white rounded-3xl flex flex-col justify-center shadow-xl border-l-4 border-orange-500 text-left">
                                                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 text-left">Fee Paid (Total)</p>
                                                <p className="text-4xl font-black text-orange-500 tracking-tighter italic text-left">₹{(ticket.amountPaidPaisa || 0) / 100}</p>
                                                <div className="mt-4 pt-4 border-t border-white/10 space-y-1 text-left">
                                                    <p className="text-[9px] text-slate-500 font-bold uppercase text-left">Incl. Platform & Processing Fees</p>
                                                    <p className="text-[9px] text-slate-500 font-bold uppercase text-left">GST Registered Organization</p>
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                    <CardFooter className="bg-muted/10 p-6 sm:px-8 border-t flex flex-col sm:flex-row justify-end gap-3">
                                        <Button asChild size="sm" className="w-full sm:w-auto rounded-xl font-black uppercase text-[10px] tracking-widest h-11 px-6">
                                            <Link href={`/races/${ticket.customSlug || ticket.eventId}`}>Race Information</Link>
                                        </Button>
                                    </CardFooter>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
