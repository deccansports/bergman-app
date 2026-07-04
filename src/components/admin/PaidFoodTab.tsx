// src/components/admin/PaidFoodTab.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Trash2, Loader2, Edit, UtensilsCrossed, Settings, ListOrdered, ClipboardList, TrendingUp, Link as LinkIcon, Save, Copy, RefreshCw, Search, BarChart3, Ban, IndianRupee } from 'lucide-react';
import type { PaidFoodItem, EventCalendarEntry, PaidFoodOrder, PaidFoodCoupon, PaidFoodStats } from '@/lib/types';
import { addPaidFoodItemAction, getPaidFoodItemsAction, updatePaidFoodItemAction, deletePaidFoodItemAction, resetFoodCouponAction, getPaidFoodStatsAndLogsAction, cancelAndRefundPaidFoodOrderAction, cancelPaidFoodOrderAction, repairPaidFoodOrdersAction } from '@/lib/actions';
import { updateCalendarEventAction } from '@/lib/actions/eventActions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger } from '@/components/ui/dialog';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from '@/components/ui/separator';
import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';


interface PaidFoodTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

const paidFoodNavItems = [
    { id: 'overview', label: 'Overview & Logs', icon: BarChart3 },
    { id: 'items', label: 'Manage Items', icon: ListOrdered },
    { id: 'orders', label: 'Orders & Redemptions', icon: ClipboardList },
    { id: 'settings', label: 'Settings', icon: Settings },
];

const PaidFoodItemSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters."),
    description: z.string().optional().nullable(),
    price: z.number().min(0, "Price must be a non-negative number."),
    isVeg: z.boolean().default(true),
    taxPercentage: z.number().int().min(0).max(100).default(0),
    maxPerOrder: z.number().int().min(1, "Max per order must be at least 1.").default(10),
    inventory: z.number().int().min(0, "Inventory must be a non-negative number.").optional().nullable(),
    isActive: z.boolean().default(true),
    applicableEventIds: z.array(z.string()),
});
type PaidFoodItemFormInput = z.infer<typeof PaidFoodItemSchema>;

export default function PaidFoodTab({ events, isLoadingEvents, onDataRefresh }: PaidFoodTabProps) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('overview');
  const [items, setItems] = useState<PaidFoodItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<PaidFoodItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [eventSlugs, setEventSlugs] = useState<Record<string, string>>({});
  const [isSavingSlug, setIsSavingSlug] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [isSearchingOrders, setIsSearchingOrders] = useState(false);
  const [orderSearchTerm, setOrderSearchTerm] = useState('');
  const [orderSearchBy, setOrderSearchBy] = useState<'orderId' | 'mobile' | 'coupon'>('orderId');
  const [foundOrder, setFoundOrder] = useState<{ order: PaidFoodOrder, coupons: PaidFoodCoupon[] } | null>(null);
  const [isResettingCoupon, setIsResettingCoupon] = useState<string | null>(null);
  const [stats, setStats] = useState<PaidFoodStats | null>(null);
  const [logs, setLogs] = useState<PaidFoodOrder[]>([]);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string>('all');
  const [isRefunding, setIsRefunding] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState<string | null>(null);
  const [isRepairingOrders, setIsRepairingOrders] = useState(false);


  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  const fetchStatsAndLogs = useCallback(async (eventId?: string) => {
      setIsLoadingStats(true);
      const result = await getPaidFoodStatsAndLogsAction(eventId);
      if (result.success) {
          setStats(result.stats || null);
          setLogs(result.logs || []);
      } else {
          toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch stats and logs.' });
      }
      setIsLoadingStats(false);
  }, [toast]);


  const form = useForm<PaidFoodItemFormInput>({
    resolver: zodResolver(PaidFoodItemSchema),
    defaultValues: { name: '', description: '', price: 0, isVeg: true, taxPercentage: 0, maxPerOrder: 10, inventory: null, isActive: true, applicableEventIds: [] },
  });

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    const result = await getPaidFoodItemsAction();
    if (result.success && result.items) {
      setItems(result.items);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsLoading(false);
  }, [toast]);
  
  useEffect(() => {
    if (events) {
      const initialSlugs = events.reduce((acc, event) => {
        acc[event.id] = event.foodPurchaseSlug || '';
        return acc;
      }, {} as Record<string, string>);
      setEventSlugs(initialSlugs);
    }
  }, [events]);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { fetchStatsAndLogs(selectedEventId === 'all' ? undefined : selectedEventId) }, [selectedEventId, fetchStatsAndLogs]);

  
  useEffect(() => {
    if (isModalOpen && editingItem) {
        form.reset({ ...editingItem, price: editingItem.price / 100 }); // Convert paisa to rupees for form
    } else if (isModalOpen && !editingItem) {
        form.reset({ name: '', description: '', price: 0, isVeg: true, taxPercentage: 0, maxPerOrder: 10, inventory: null, isActive: true, applicableEventIds: [] });
    }
  }, [isModalOpen, editingItem, form]);

  const handleFormSubmit = async (data: PaidFoodItemFormInput) => {
    setIsSubmitting(true);
    const payload = { ...data, price: Math.round(data.price * 100) }; // Convert rupees to paisa for DB
    const action = editingItem ? updatePaidFoodItemAction(editingItem.id, payload) : addPaidFoodItemAction(payload as Omit<PaidFoodItem, 'id' | 'createdAt' | 'updatedAt'>);
    const result = await action;
    if (result.success) {
      toast({ title: 'Success', description: result.message });
      await fetchItems();
      setIsModalOpen(false); setEditingItem(null);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };

  const handleDeleteItem = async (id: string) => {
    setIsDeleting(id);
    const result = await deletePaidFoodItemAction(id);
    if (result.success) { toast({ title: 'Success', description: 'Item deleted.' }); await fetchItems(); }
    else { toast({ variant: 'destructive', title: 'Error', description: result.message }); }
    setIsDeleting(null);
  };

  const handleSlugChange = (eventId: string, value: string) => {
    setEventSlugs(prev => ({ ...prev, [eventId]: value }));
  };

  const handleSaveSlug = async (eventId: string) => {
    setIsSavingSlug(eventId);
    const slugToSave = eventSlugs[eventId] || null;
    const result = await updateCalendarEventAction(eventId, { foodPurchaseSlug: slugToSave });
    if (result.success) {
      toast({ title: 'Success', description: 'Food page link updated.' });
      if (onDataRefresh) {
        onDataRefresh();
      }
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSavingSlug(null);
  };
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied!', description: 'Full link copied to clipboard.' });
  };
  
  const handleOrderSearch = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!orderSearchTerm) return;
    setIsSearchingOrders(true);
    setFoundOrder(null);
    try {
      const response = await fetch('/api/admin/paid-food/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term: orderSearchTerm, by: orderSearchBy }),
      });
      const result = await response.json();
      if (response.ok && result.success && result.order) {
        setFoundOrder({ order: result.order, coupons: result.coupons || [] });
      } else {
        toast({ variant: 'destructive', title: 'Order Not Found', description: result.message });
      }
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Error', description: 'An error occurred during search.' });
    }
    setIsSearchingOrders(false);
  };

  const handleResetCoupon = async (couponId: string) => {
    setIsResettingCoupon(couponId);
    const result = await resetFoodCouponAction(couponId);
    if (result.success) {
      toast({ title: 'Success', description: result.message });
      if (foundOrder) {
        const response = await fetch('/api/admin/paid-food/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ term: foundOrder.order.orderId, by: 'orderId' })
        });
        const searchResult = await response.json();
        if (searchResult.success && searchResult.order) {
          setFoundOrder({ order: searchResult.order, coupons: searchResult.coupons || [] });
        }
      }
    } else {
      toast({ variant: 'destructive', title: 'Reset Failed', description: result.message });
    }
    setIsResettingCoupon(null);
  };

  const handleCancelAndRefund = async (orderId: string) => {
    setIsRefunding(orderId);
    const result = await cancelAndRefundPaidFoodOrderAction(orderId);
    if(result.success) {
        toast({ title: 'Success', description: result.message });
        fetchStatsAndLogs(selectedEventId === 'all' ? undefined : selectedEventId);
        setFoundOrder(null);
    } else {
        toast({ variant: 'destructive', title: 'Refund Failed', description: result.message, duration: 7000 });
    }
    setIsRefunding(null);
  };

  const handleCancelOnly = async (orderId: string) => {
    setIsCancelling(orderId);
    const result = await cancelPaidFoodOrderAction(orderId);
    if (result.success) {
      toast({ title: 'Success', description: result.message });
      fetchStatsAndLogs(selectedEventId === 'all' ? undefined : selectedEventId);
      setFoundOrder(null);
    } else {
      toast({ variant: 'destructive', title: 'Cancellation Failed', description: result.message });
    }
    setIsCancelling(null);
  };

  const handleRepairOrders = async () => {
    setIsRepairingOrders(true);
    const result = await repairPaidFoodOrdersAction({
      limit: 150,
      eventId: selectedEventId === 'all' ? undefined : selectedEventId,
    });

    if (result.success) {
      toast({ title: 'Repair complete', description: result.message, duration: 7000 });
      await fetchStatsAndLogs(selectedEventId === 'all' ? undefined : selectedEventId);
    } else {
      toast({ variant: 'destructive', title: 'Repair failed', description: result.message, duration: 7000 });
    }

    setIsRepairingOrders(false);
  };

  const formatCurrency = (paisa: number) => `₹${(paisa / 100).toFixed(2)}`;
  
  const renderNav = () => {
    if (isMobile) {
        return (
            <Select value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a section..." />
                </SelectTrigger>
                <SelectContent>
                    {paidFoodNavItems.map(item => (
                        <SelectItem key={item.id} value={item.id}>
                            <div className="flex items-center gap-2">
                                <item.icon className="h-4 w-4" />
                                {item.label}
                            </div>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }
    return (
        <TabsList className="grid w-full grid-cols-1 md:grid-cols-4">
            {paidFoodNavItems.map(item => (
                 <TabsTrigger key={item.id} value={item.id}><item.icon className="mr-2"/>{item.label}</TabsTrigger>
            ))}
        </TabsList>
    );
  };


  return (
    <div className="space-y-6">
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full text-left">
        {renderNav()}
        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary"/>Paid Food Overview</CardTitle>
                </div>
                <Button variant="outline" onClick={handleRepairOrders} disabled={isRepairingOrders || isLoadingStats}>
                  {isRepairingOrders ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Repair stuck paid orders
                </Button>
              </div>
              <div className="flex items-center gap-4">
                  <CardDescription>View overall statistics for paid food sales and redemptions.</CardDescription>
                  <Select onValueChange={(value) => setSelectedEventId(value)} defaultValue={selectedEventId}>
                      <SelectTrigger className="w-[250px] h-8 text-xs">
                          <SelectValue placeholder="Filter by Event..." />
                      </SelectTrigger>
                      <SelectContent>
                          <SelectItem value="all">All Events</SelectItem>
                          {events.map(e => (
                              <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>
                          ))}
                      </SelectContent>
                  </Select>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
                {isLoadingStats ? <p>Loading stats...</p> : stats ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                    <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl text-primary">{formatCurrency(stats.totalRevenue)}</CardTitle><CardDescription className="text-xs">Total Revenue</CardDescription></CardHeader></Card>
                    <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl">{stats.totalOrders}</CardTitle><CardDescription className="text-xs">Total Orders</CardDescription></CardHeader></Card>
                    <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl">{stats.totalItemsSold}</CardTitle><CardDescription className="text-xs">Total Items Sold</CardDescription></CardHeader></Card>
                    <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-2xl">{stats.totalItemsRedeemed}</CardTitle><CardDescription className="text-xs">Total Items Redeemed</CardDescription></CardHeader></Card>
                  </div>
                ) : <p>No stats available.</p>}
                
                <h3 className="text-lg font-semibold pt-4 border-t">Recent Orders</h3>
                 <div className="rounded-md border overflow-x-auto max-h-[50vh]">
                    <Table>
                      <TableHeader><TableRow><TableHead>Order ID</TableHead><TableHead>Buyer</TableHead><TableHead>Items</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                      <TableBody>{isLoadingStats ? <TableRow><TableCell colSpan={6} className="text-center p-8"><Loader2 className="animate-spin"/></TableCell></TableRow> : logs.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground p-8">No orders found.</TableCell></TableRow> : logs.map(log => (<TableRow key={log.id}><TableCell className="font-mono text-xs">{log.orderId}</TableCell><TableCell>{log.buyerName}<br/><span className="text-xs text-muted-foreground">{log.buyerMobile}</span></TableCell><TableCell><ul className="list-disc pl-4 text-xs">{log.items.map(item=><li key={item.itemId}>{item.itemName} x{item.quantity}</li>)}</ul></TableCell><TableCell>{formatCurrency(log.totalAmountPaisa)}</TableCell><TableCell><Badge variant={log.status === 'Refunded' || log.status === 'Cancelled' ? 'destructive' : 'default'}>{log.status || 'Paid'}</Badge></TableCell><TableCell className="text-xs">{format(parseISO(log.createdAt), 'MMM dd, p')}</TableCell></TableRow>))}</TableBody>
                    </Table>
                 </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="items" className="mt-4">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle className="flex items-center gap-2"><UtensilsCrossed className="h-5 w-5 text-primary"/> Food Items</CardTitle><CardDescription>Create and manage food items available for purchase.</CardDescription></div>
                <Button size="sm" onClick={() => { setEditingItem(null); setIsModalOpen(true); }}><PlusCircle className="mr-2 h-4 w-4"/>Add Item</Button>
                </CardHeader>
                <CardContent>
                <div className="rounded-md border overflow-x-auto">
                    <Table>
                    <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Price</TableHead><TableHead>Type</TableHead><TableHead>Tax</TableHead><TableHead>Inventory</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>{isLoading ? (<TableRow><TableCell colSpan={7} className="text-center h-24"><Loader2 className="animate-spin h-6 w-6 mx-auto text-primary"/></TableCell></TableRow>) : items.length === 0 ? (<TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No food items created yet.</TableCell></TableRow>) : (items.map((item) => (<TableRow key={item.id}><TableCell className="font-medium">{item.name}</TableCell><TableCell>₹{(item.price / 100).toFixed(2)}</TableCell><TableCell>{item.isVeg ? 'Veg' : 'Non-Veg'}</TableCell><TableCell>{item.taxPercentage}%</TableCell><TableCell>{item.inventory ?? 'N/A'}</TableCell><TableCell>{item.isActive ? 'Active' : 'Inactive'}</TableCell><TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="xs" onClick={() => { setEditingItem(item); setIsModalOpen(true); }}><Edit className="h-3.5 w-3.5" /></Button>
                        <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" disabled={isDeleting === item.id}>{isDeleting === item.id ? <Loader2 className="animate-spin h-3.5 w-3.5"/> : <Trash2 className="h-3.5 w-3.5"/>}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete Item?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the item &quot;{item.name}&quot;.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteItem(item.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></TableCell></TableRow>)))}</TableBody>
                    </Table>
                </div>
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="orders" className="mt-4">
            <Card>
                <CardHeader><CardTitle>Search Orders</CardTitle><CardDescription>Search for an order by its unique Order ID, the buyer&apos;s mobile number, or a specific 4-digit coupon code.</CardDescription></CardHeader>
                <CardContent>
                    <form onSubmit={handleOrderSearch} className="flex gap-2">
                        <Select value={orderSearchBy} onValueChange={(v) => setOrderSearchBy(v as 'orderId' | 'mobile' | 'coupon')}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="orderId">Order ID</SelectItem>
                                <SelectItem value="mobile">Mobile Number</SelectItem>
                                <SelectItem value="coupon">4-Digit Code</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input placeholder={`Enter ${orderSearchBy.replace('Id', ' ID')}...`} value={orderSearchTerm} onChange={e => setOrderSearchTerm(e.target.value)} disabled={isSearchingOrders} maxLength={orderSearchBy === 'coupon' ? 4 : undefined} />
                        <Button type="submit" disabled={isSearchingOrders}>{isSearchingOrders ? <Loader2 className="animate-spin" /> : 'Search'}</Button>
                    </form>
                    {foundOrder && (
                        <Card className="mt-4">
                            <CardHeader><CardTitle>Order Details</CardTitle><CardDescription>Order for {foundOrder.order.buyerName} ({foundOrder.order.buyerMobile}) - Status: <Badge variant={foundOrder.order.status === 'Refunded' || foundOrder.order.status === 'Cancelled' ? 'destructive' : 'default'}>{foundOrder.order.status || 'Paid'}</Badge></CardDescription></CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Coupon Code</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {foundOrder.coupons.map(coupon => (
                                            <TableRow key={coupon.id}>
                                                <TableCell>{coupon.itemName}</TableCell>
                                                <TableCell className="font-mono">{coupon.id}</TableCell>
                                                <TableCell><Badge variant={coupon.status === 'REDEEMED' ? 'destructive' : coupon.status === 'VOID' ? 'outline' : 'default'} className={coupon.status === 'ISSUED' ? 'bg-green-600' : ''}>{coupon.status}</Badge></TableCell>
                                                <TableCell className="text-right">
                                                    {coupon.status === 'REDEEMED' && (
                                                        <Button size="xs" variant="outline" onClick={() => handleResetCoupon(coupon.id)} disabled={isResettingCoupon === coupon.id}>
                                                            {isResettingCoupon === coupon.id ? <Loader2 className="animate-spin h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}
                                                            <span className="ml-1.5">Reset</span>
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                             <CardFooter className="gap-2">
                                {foundOrder.order.status !== 'Refunded' && foundOrder.order.status !== 'Cancelled' && (
                                    <>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="destructive" disabled={isRefunding === foundOrder.order.orderId || isCancelling === foundOrder.order.orderId}>
                                                    <IndianRupee className="mr-2 h-4 w-4"/> Refund Order
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                    <AlertDialogDescription>This will attempt to issue a full refund via Razorpay for the order placed by {foundOrder.order.buyerName}. All associated coupons will be voided. This action cannot be undone.</AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleCancelAndRefund(foundOrder.order.orderId)} disabled={isRefunding === foundOrder.order.orderId} className="bg-destructive hover:bg-destructive/90">
                                                      {isRefunding === foundOrder.order.orderId && <Loader2 className="animate-spin mr-2"/>} Confirm & Refund
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="outline" disabled={isRefunding === foundOrder.order.orderId || isCancelling === foundOrder.order.orderId}>
                                                    <Ban className="mr-2 h-4 w-4"/> Cancel Order (No Refund)
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                    <AlertDialogDescription>This will cancel the order for {foundOrder.order.buyerName} without initiating a monetary refund. All coupons will be voided. This is useful for cash refunds or other offline settlements. This cannot be undone.</AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Back</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleCancelOnly(foundOrder.order.orderId)} disabled={isCancelling === foundOrder.order.orderId} >
                                                      {isCancelling === foundOrder.order.orderId && <Loader2 className="animate-spin mr-2"/>} Confirm Cancellation
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </>
                                )}
                            </CardFooter>
                        </Card>
                    )}
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="settings" className="mt-4 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><LinkIcon className="h-5 w-5 text-primary"/>Event Food Page Links</CardTitle>
                    <CardDescription>View and edit the URL slugs for each event&apos;s paid food page. The final URL will be {baseUrl}/food/[slug].</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {isLoadingEvents ? ( <p>Loading events...</p> ) : (
                        events.map(event => (
                            <div key={event.id} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-3 border rounded-md">
                                <span className="font-medium text-sm flex-1">{event.eventName}</span>
                                <div className="relative flex-grow w-full sm:w-auto">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">/food/</span>
                                    <Input 
                                        className="pl-12"
                                        placeholder="e.g., ozar-food-2025"
                                        value={eventSlugs[event.id] || ''}
                                        onChange={(e) => handleSlugChange(event.id, e.target.value)}
                                        disabled={isSavingSlug === event.id}
                                    />
                                </div>
                                <div className="flex gap-2 w-full sm:w-auto">
                                  <Button size="sm" onClick={() => handleSaveSlug(event.id)} disabled={isSavingSlug === event.id} className="w-full sm:w-auto">
                                      {isSavingSlug === event.id ? <Loader2 className="animate-spin h-4 w-4"/> : <Save className="h-4 w-4"/>}
                                      <span className="ml-2">Save</span>
                                  </Button>
                                   <Button size="sm" variant="outline" onClick={() => copyToClipboard(`${baseUrl}/food/${eventSlugs[event.id]}`)} disabled={!eventSlugs[event.id]}>
                                      <Copy className="h-4 w-4"/>
                                  </Button>
                                </div>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>
        </TabsContent>
    </Tabs>
      
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md text-left">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit' : 'Add New'} Food Item</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleFormSubmit)} className="flex flex-col h-full">
              <ScrollArea className="flex-grow p-1 pr-4 -mr-4 custom-scrollbar" style={{ height: '65vh' }}>
                <div className="space-y-4 py-4 pr-4">
                  <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><Input placeholder="e.g., Veg Biryani" {...field} disabled={isSubmitting}/><FormMessage/></FormItem>)}/>
                  <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description (Optional)</FormLabel><Textarea placeholder="A short description of the item" {...field} value={field.value || ''} disabled={isSubmitting}/><FormMessage/></FormItem>)}/>
                  <FormField control={form.control} name="price" render={({ field }) => (<FormItem><FormLabel>Price (INR)</FormLabel><Input type="number" step="0.01" placeholder="e.g., 250.00" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} disabled={isSubmitting}/><FormMessage/></FormItem>)}/>
                  <FormField control={form.control} name="taxPercentage" render={({ field }) => (<FormItem><FormLabel>Tax (%)</FormLabel><Input type="number" step="1" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} disabled={isSubmitting}/><FormMessage/></FormItem>)}/>
                  <FormField control={form.control} name="inventory" render={({ field }) => (<FormItem><FormLabel>Inventory Count (Optional)</FormLabel><Input type="number" step="1" {...field} onChange={e => field.onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))} value={field.value ?? ''} placeholder="Leave empty for unlimited" disabled={isSubmitting}/><FormMessage/></FormItem>)}/>
                  <FormField control={form.control} name="maxPerOrder" render={({ field }) => (<FormItem><FormLabel>Max Quantity Per Order</FormLabel><Input type="number" step="1" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 1)} disabled={isSubmitting}/><FormMessage/></FormItem>)}/>
                  <FormField control={form.control} name="applicableEventIds" render={() => (<FormItem><FormLabel>Applicable Events</FormLabel><FormDescription>Select which events this item is available for. Select none for all events.</FormDescription><div className="grid grid-cols-2 gap-2 p-2 border rounded-md max-h-40 overflow-y-auto">{isLoadingEvents ? <p>Loading events...</p> : events.map((event) => (<FormField key={event.id} control={form.control} name="applicableEventIds" render={({ field }) => (<FormItem key={event.id} className="flex flex-row items-start space-x-3 space-y-0"><FormControl><Checkbox checked={field.value?.includes(event.id)} onCheckedChange={(checked) => {return checked ? field.onChange([...(field.value || []), event.id]) : field.onChange((field.value || []).filter(value => value !== event.id))}}/></FormControl><FormLabel className="text-sm font-normal">{event.eventName}</FormLabel></FormItem>)}/>))}</div><FormMessage /></FormItem>)}/>
                  <div className="flex justify-between items-center pt-2">
                      <FormField control={form.control} name="isVeg" render={({ field }) => (<FormItem className="flex items-center gap-2"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={isSubmitting}/></FormControl><FormLabel className="!mt-0">Is Veg?</FormLabel></FormItem>)}/>
                      <FormField control={form.control} name="isActive" render={({ field }) => (<FormItem className="flex items-center gap-2"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={isSubmitting}/></FormControl><FormLabel className="!mt-0">Is Active?</FormLabel></FormItem>)}/>
                  </div>
                </div>
              </ScrollArea>
              <DialogFooter className="pt-4 border-t flex-shrink-0">
                  <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                  <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : null}{editingItem ? 'Save Changes' : 'Add Item'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
