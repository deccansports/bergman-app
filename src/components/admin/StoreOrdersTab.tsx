// src/components/admin/StoreOrdersTab.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { 
  getStoreOrdersAction, 
  updateStoreOrderStatusAction,
  getStoreAnalyticsAction,
  syncStoreOrderToZohoAction,
  reconcileStoreOrderAction,
  sendStoreInvoiceWhatsAppAction,
  cancelAndRefundStoreOrderAction
} from '@/lib/actions/storeActions';
import type { StoreOrder } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, Search, TrendingUp, IndianRupee, PackageCheck, ShoppingBag, 
  Truck, ExternalLink, Printer, RefreshCw, Calculator, MessageSquare, User, MapPin, Package, CreditCard, ShieldCheck, ArrowUp, ArrowDown, XCircle
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter, 
  DialogDescription,
  DialogClose
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import jsPDF from 'jspdf';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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

export default function StoreOrdersTab() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('fulfillment');
  
  const [trackingModal, setTrackingModal] = useState<{ open: boolean; order: StoreOrder | null }>({ open: false, order: null });
  const [detailModal, setDetailModal] = useState<{ open: boolean; order: StoreOrder | null }>({ open: false, order: null });
  const [trackingData, setTrackingData] = useState({ trackingId: '', courierPartner: '', trackingUrl: '' });
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [oRes, aRes] = await Promise.all([
        getStoreOrdersAction(),
        getStoreAnalyticsAction()
      ]);
      if (oRes.success) setOrders(oRes.orders || []);
      if (aRes.success) setAnalytics(aRes.stats);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleStatusChange = async (order: StoreOrder, status: string) => {
    if (status === 'Shipped') {
      setTrackingModal({ open: true, order });
      setTrackingData({ 
        trackingId: order.trackingId || '', 
        courierPartner: order.courierPartner || '', 
        trackingUrl: order.trackingUrl || '' 
      });
      return;
    }

    const res = await updateStoreOrderStatusAction(order.id, status);
    if (res.success) {
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: status as any } : o));
      toast({ title: "Status Updated" });
      loadData(); // Refresh analytics
    }
  };

  const handleSaveTracking = async () => {
    if (!trackingModal.order) return;
    if (!trackingData.trackingId || !trackingData.courierPartner) {
      toast({ variant: 'destructive', title: 'Required Fields', description: 'Tracking ID and Partner Name are required.' });
      return;
    }

    setIsSubmitting(trackingModal.order.id);
    const res = await updateStoreOrderStatusAction(trackingModal.order.id, 'Shipped', trackingData);
    if (res.success) {
      setOrders(prev => prev.map(o => o.id === trackingModal.order!.id ? { ...o, status: 'Shipped', ...trackingData } : o));
      toast({ title: "Order Marked as Shipped" });
      setTrackingModal({ open: false, order: null });
      loadData();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: res.message });
    }
    setIsSubmitting(null);
  };

  const handleCancelAndRefund = async (orderId: string) => {
    setIsSubmitting(orderId);
    try {
        const res = await cancelAndRefundStoreOrderAction(orderId);
        if (res.success) {
            toast({ title: "Order Refunded", description: res.message });
            loadData();
        } else {
            toast({ variant: 'destructive', title: 'Action Failed', description: res.message });
        }
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
        setIsSubmitting(null);
    }
  };

  const handleManualSync = async (orderId: string) => {
    setIsSubmitting(orderId);
    try {
      const res = await syncStoreOrderToZohoAction(orderId);
      if (res.success) {
        toast({ title: "Sync Successful", description: res.message });
        loadData();
      } else {
        toast({ variant: 'destructive', title: "Sync Failed", description: res.message });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Error", description: e.message });
    } finally {
      setIsSubmitting(null);
    }
  };

  const handleReconcilePayment = async (orderId: string) => {
    setIsSubmitting(orderId);
    try {
      const res = await reconcileStoreOrderAction(orderId);
      if (res.success) {
        toast({ title: "Payment Reconciled", description: res.message });
        loadData();
      } else {
        toast({ variant: 'destructive', title: "Reconciliation Failed", description: res.message });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Error", description: e.message });
    } finally {
      setIsSubmitting(null);
    }
  };

  const handleSendWhatsAppInvoice = async (orderId: string) => {
    setIsSubmitting(orderId);
    try {
      const res = await sendStoreInvoiceWhatsAppAction(orderId);
      if (res.success) {
        toast({ title: "WhatsApp Sent", description: res.message });
      } else {
        toast({ variant: 'destructive', title: "Send Failed", description: res.message });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Error", description: e.message });
    } finally {
      setIsSubmitting(null);
    }
  };

  const generateShippingLabel = (order: StoreOrder) => {
    try {
      const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a5' });
      const width = doc.internal.pageSize.getWidth();
      const height = doc.internal.pageSize.getHeight();
      const margin = 10;

      doc.setDrawColor(0);
      doc.setLineWidth(0.5);
      doc.rect(margin, margin, width - (margin * 2), height - (margin * 2));

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text("BERGMAN STORE SHIPPING LABEL", width / 2, margin + 12, { align: 'center' });
      doc.setLineWidth(0.3);
      doc.line(margin + 5, margin + 18, width - margin - 5, margin + 18);

      const leftColX = margin + 10;
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text("SHIP TO:", leftColX, margin + 30);
      
      doc.setFontSize(18);
      doc.setTextColor(0);
      doc.setFont('helvetica', 'bold');
      doc.text(order.customerName.toUpperCase(), leftColX, margin + 40);
      
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      const addressWidth = (width / 2) - (margin * 2);
      const splitAddress = doc.splitTextToSize(order.shippingAddress, addressWidth);
      doc.text(splitAddress, leftColX, margin + 50);
      
      const addrHeight = splitAddress.length * 6;
      const cityY = margin + 50 + addrHeight + 2;
      
      doc.setFont('helvetica', 'bold');
      doc.text(`${order.city}, ${order.state} - ${order.pincode}`, leftColX, cityY);
      doc.text(`PH: ${order.mobile}`, leftColX, cityY + 8);

      const rightColX = width / 2 + 10;
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.setFont('helvetica', 'normal');
      doc.text("ORDER DETAILS:", rightColX, margin + 30);
      
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.setFont('helvetica', 'bold');
      doc.text(`Order ID: ${order.orderId || order.id}`, rightColX, margin + 40);
      doc.text(`Invoice No: ${order.invoiceNumber || 'PENDING'}`, rightColX, margin + 48);
      doc.setFont('helvetica', 'normal');
      doc.text(`Date: ${format(new Date(order.createdAt), 'dd MMM yyyy')}`, rightColX, margin + 56);

      const senderY = height - margin - 45;
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text("FROM / SENDER:", rightColX, senderY);
      
      doc.setTextColor(0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text("Bergman Triathlon", rightColX, senderY + 10);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(["E/G 1, Rajarampuri, 13th Lane", "Kolhapur – 416008", "Phone: 8208172409"], rightColX, senderY + 17);

      doc.setDrawColor(230);
      doc.line(width / 2, margin + 25, width / 2, height - margin - 10);

      doc.save(`ShippingLabel_${order.customerName.replace(/\s+/g, '_')}.pdf`);
      toast({ title: "Label Generated" });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Print Error', description: 'Could not generate label.' });
    }
  };

  const filtered = orders.filter(o => 
    o.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.orderId?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 text-left">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-primary/5"><CardHeader className="p-4"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center"><IndianRupee className="mr-2 h-4 w-4" /> Total Revenue</CardTitle><div className="text-2xl font-bold mt-1">₹{analytics?.totalRevenue?.toLocaleString() || 0}</div></CardHeader></Card>
        <Card className="bg-primary/5"><CardHeader className="p-4"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center"><ShoppingBag className="mr-2 h-4 w-4" /> Paid Orders</CardTitle><div className="text-2xl font-bold mt-1">{analytics?.totalOrders || 0}</div></CardHeader></Card>
        <Card className="bg-primary/5"><CardHeader className="p-4"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center"><TrendingUp className="mr-2 h-4 w-4" /> Avg Order</CardTitle><div className="text-2xl font-bold mt-1">₹{Math.round(analytics?.avgOrderValue || 0)}</div></CardHeader></Card>
        <Card className="bg-primary/5"><CardHeader className="p-4"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center"><PackageCheck className="mr-2 h-4 w-4" /> Total GST</CardTitle><div className="text-2xl font-bold mt-1">₹{analytics?.totalGst?.toLocaleString() || 0}</div></CardHeader></Card>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search orders..." className="pl-8" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          {loading ? <Loader2 className="animate-spin h-4 w-4 mr-2"/> : <RefreshCw className="h-4 w-4 mr-2"/>} Refresh Data
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50 p-1 mb-4">
          <TabsTrigger value="fulfillment" className="gap-2"><Truck className="h-4 w-4"/> Fulfillment</TabsTrigger>
          <TabsTrigger value="accounting" className="gap-2"><Calculator className="h-4 w-4"/> Accounting</TabsTrigger>
        </TabsList>

        <TabsContent value="fulfillment">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Invoice No.</TableHead>
                    <TableHead>Fulfillment</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground italic">No orders found.</TableCell></TableRow>
                  ) : filtered.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs uppercase">{o.orderId || o.id.slice(-8)}</TableCell>
                      <TableCell>
                        <Button 
                          variant="link" 
                          className="p-0 h-auto font-bold text-sm uppercase tracking-tight text-left"
                          onClick={() => setDetailModal({ open: true, order: o })}
                        >
                          {o.customerName}
                        </Button>
                        <div className="text-[10px] text-muted-foreground">{o.city}, {o.state}</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground lowercase">{o.email}</TableCell>
                      <TableCell>₹{o.totalAmount}</TableCell>
                      <TableCell><Badge variant={o.status === 'Paid' || o.status === 'Delivered' ? 'default' : 'secondary'}>{o.status}</Badge></TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">{o.invoiceNumber || '—'}</TableCell>
                      <TableCell>
                        {o.status === 'Shipped' ? (
                          <div className="text-[10px] leading-tight text-muted-foreground">
                            <p className="font-bold uppercase">{o.courierPartner}</p>
                            <p>ID: {o.trackingId}</p>
                          </div>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">{format(new Date(o.createdAt), 'MMM dd, p')}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="outline" size="xs" onClick={() => generateShippingLabel(o)}>
                            <Printer className="h-3 w-3 mr-1" /> Label
                          </Button>
                          
                          {['Paid', 'Processing', 'Shipped'].includes(o.status) && (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="outline" size="xs" className="text-destructive border-destructive/20 hover:bg-destructive/10" disabled={isSubmitting === o.id}>
                                        <XCircle className="h-3 w-3 mr-1" /> Refund
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Cancel & Refund Order?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            This will initiate a full refund via Razorpay for <strong>₹{o.totalAmount}</strong>. 
                                            The items will be automatically restocked in the store inventory. This action cannot be undone.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Back</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleCancelAndRefund(o.id)} className="bg-destructive hover:bg-destructive/90">
                                            Confirm & Refund
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                          )}

                          <Select value={o.status} onValueChange={(v) => handleStatusChange(o, v)}>
                            <SelectTrigger className="w-[120px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Pending">Pending</SelectItem>
                              <SelectItem value="Paid">Paid</SelectItem>
                              <SelectItem value="Processing">Processing</SelectItem>
                              <SelectItem value="Shipped">Shipped</SelectItem>
                              <SelectItem value="Delivered">Delivered</SelectItem>
                              <SelectItem value="Cancelled">Cancelled</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounting">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Order Status</TableHead>
                    <TableHead>Invoice No.</TableHead>
                    <TableHead>Sync Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground italic">No data found.</TableCell></TableRow>
                  ) : filtered.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs uppercase">{o.orderId || o.id.slice(-8)}</TableCell>
                      <TableCell>
                        <Button 
                          variant="link" 
                          className="p-0 h-auto font-bold text-sm uppercase tracking-tight text-left"
                          onClick={() => setDetailModal({ open: true, order: o })}
                        >
                          {o.customerName}
                        </Button>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground lowercase">{o.email}</TableCell>
                      <TableCell>₹{o.totalAmount}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{o.status}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{o.invoiceNumber || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={o.zohoSynced ? 'default' : 'secondary'} className={cn(!o.zohoSynced && !o.zohoSyncError && "bg-amber-100 text-amber-700")}>
                          {o.zohoSynced ? 'Synced' : o.zohoSyncError ? 'Failed' : 'Pending Sync'}
                        </Badge>
                        {o.zohoSyncError && <p className="text-[10px] text-destructive mt-1 max-w-[150px] truncate" title={o.zohoSyncError}>{o.zohoSyncError}</p>}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {o.status === 'Pending' && (
                          <Button size="xs" variant="outline" onClick={() => handleReconcilePayment(o.id)} disabled={isSubmitting === o.id}>
                            {isSubmitting === o.id ? <Loader2 className="animate-spin h-3 w-3"/> : <ShieldCheck className="h-3 w-3 mr-1"/>} Reconcile
                          </Button>
                        )}
                        {!o.zohoSynced && o.status !== 'Pending' && (
                          <Button size="xs" variant="outline" onClick={() => handleManualSync(o.id)} disabled={isSubmitting === o.id}>
                            {isSubmitting === o.id ? <Loader2 className="animate-spin h-3 w-3"/> : <RefreshCw className="h-3 w-3 mr-1"/>} Sync
                          </Button>
                        )}
                        {o.zohoSynced && (
                          <Button size="xs" variant="outline" onClick={() => handleSendWhatsAppInvoice(o.id)} disabled={isSubmitting === o.id || !o.mobile}>
                            {isSubmitting === o.id ? <Loader2 className="animate-spin h-3 w-3"/> : <MessageSquare className="h-3 w-3 mr-1"/>} WhatsApp
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Detail Modal */}
      <Dialog open={detailModal.open} onOpenChange={(o) => !o && setDetailModal({ open: false, order: null })}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-2xl font-black uppercase tracking-tighter italic">
              <ShoppingBag className="h-6 w-6 text-primary" />
              Order Summary: {detailModal.order?.orderId || detailModal.order?.id.slice(-8)}
            </DialogTitle>
            <DialogDescription className="text-left font-medium">
              Placed on {detailModal.order && format(new Date(detailModal.order.createdAt), 'dd MMM yyyy, p')}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[70vh] pr-4 -mr-4">
            {detailModal.order && (
              <div className="space-y-8 py-4 text-left">
                {/* Status Banner */}
                <div className="flex items-center justify-between p-4 bg-primary/5 rounded-xl border border-primary/10">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground leading-none">Order Status</p>
                    <p className="text-xl font-black text-primary uppercase italic">{detailModal.order.status}</p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground leading-none">Invoice</p>
                    <p className="font-mono text-sm font-bold">{detailModal.order.invoiceNumber || 'PENDING'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Customer Info */}
                  <div className="space-y-4">
                    <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                      <User className="h-4 w-4 text-primary" /> Customer Profile
                    </h4>
                    <div className="space-y-2 bg-muted/30 p-4 rounded-xl text-sm border border-border/50">
                      <p><span className="font-bold uppercase text-[10px] text-muted-foreground block">Name</span> {detailModal.order.customerName}</p>
                      <p><span className="font-bold uppercase text-[10px] text-muted-foreground block">Email</span> {detailModal.order.email}</p>
                      <p><span className="font-bold uppercase text-[10px] text-muted-foreground block">Mobile</span> {detailModal.order.mobile}</p>
                    </div>
                  </div>

                  {/* Shipping Info */}
                  <div className="space-y-4">
                    <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-primary" /> Shipping Destination
                    </h4>
                    <div className="space-y-2 bg-muted/30 p-4 rounded-xl text-sm border border-border/50">
                      <p className="font-medium">{detailModal.order.shippingAddress}</p>
                      <p className="font-bold uppercase tracking-tight text-primary">
                        {detailModal.order.city}, {detailModal.order.state} - {detailModal.order.pincode}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Items Table */}
                <div className="space-y-4">
                  <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" /> Gear Manifest
                  </h4>
                  <div className="border rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest h-10">Product</TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest h-10">Size</TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest h-10 text-center">Qty</TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest h-10 text-right">Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailModal.order.items.map((item, i) => (
                          <TableRow key={i} className="text-sm">
                            <TableCell className="font-bold">{item.name}</TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px] font-black uppercase">{item.size || 'OS'}</Badge></TableCell>
                            <TableCell className="text-center font-mono">{item.quantity}</TableCell>
                            <TableCell className="text-right font-black">₹{item.salePrice * item.quantity}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Financial Split */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                  <div className="space-y-4">
                    <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-primary" /> Payment Reference
                    </h4>
                    <div className="bg-muted/30 p-4 rounded-xl text-sm border border-border/50 font-mono space-y-2">
                      <p><span className="text-[10px] font-black uppercase block text-muted-foreground">Gateway Order</span> {detailModal.order.razorpayOrderId}</p>
                      <p><span className="text-[10px] font-black uppercase block text-muted-foreground">Payment ID</span> {detailModal.order.paymentId || '—'}</p>
                      {detailModal.order.couponCode && (
                        <p><span className="text-[10px] font-black uppercase block text-muted-foreground">Coupon Applied</span> <Badge className="bg-green-600 h-5 text-[10px] uppercase font-black tracking-widest">{detailModal.order.couponCode}</Badge></p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 bg-slate-900 text-white p-6 rounded-2xl shadow-xl">
                    <div className="flex justify-between text-xs text-slate-400 font-bold uppercase tracking-widest">
                      <span>Gross Subtotal</span>
                      <span className="text-white">₹{detailModal.order.subtotal}</span>
                    </div>
                    {detailModal.order.discount > 0 && (
                      <div className="flex justify-between text-xs text-green-400 font-bold uppercase tracking-widest">
                        <span>Savings (Discount)</span>
                        <span>- ₹{detailModal.order.discount}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs text-slate-400 font-bold uppercase tracking-widest">
                      <span>Fulfillment (Shipping)</span>
                      <span className={cn(detailModal.order.shipping === 0 ? "text-green-400" : "text-white")}>
                        {detailModal.order.shipping === 0 ? "FREE" : `₹${detailModal.order.shipping}`}
                      </span>
                    </div>
                    <Separator className="bg-white/10" />
                    <div className="flex justify-between items-center pt-2">
                      <span className="text-xl font-black italic uppercase text-primary tracking-tighter">Net Total Paid</span>
                      <span className="text-3xl font-black text-white">₹{detailModal.order.totalAmount}</span>
                    </div>
                    <div className="flex justify-between text-[9px] text-slate-500 font-black uppercase tracking-widest pt-2">
                      <span>Extracted GST Total</span>
                      <span>₹{detailModal.order.totalGst || detailModal.order.gstAmount || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>

          <DialogFooter className="border-t pt-4">
            <DialogClose asChild>
              <Button variant="outline">Close Summary</Button>
            </DialogClose>
            {detailModal.order?.status === 'Paid' && (
              <Button onClick={() => handleStatusChange(detailModal.order!, 'Processing')}>
                Start Processing
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tracking Modal */}
      <Dialog open={trackingModal.open} onOpenChange={(o) => !o && setTrackingModal({ open: false, order: null })}>
        <DialogContent className="sm:max-w-md text-left">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-black uppercase tracking-tighter italic">
              <Truck className="h-6 w-6"/> Dispatch Shipment
            </DialogTitle>
            <DialogDescription className="text-left">Enter tracking information for {trackingModal.order?.customerName}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 text-left">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Courier Name / Partner</Label>
              <Input placeholder="e.g., Delhivery, BlueDart" value={trackingData.courierPartner} onChange={e => setTrackingData({...trackingData, courierPartner: e.target.value})} className="rounded-xl h-11" />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Tracking ID / AWB Number</Label>
              <Input placeholder="Enter unique tracking number" value={trackingData.trackingId} onChange={e => setTrackingData({...trackingData, trackingId: e.target.value})} className="rounded-xl h-11" />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Tracking Link (Optional)</Label>
              <Input placeholder="https://..." value={trackingData.trackingUrl} onChange={e => setTrackingData({...trackingData, trackingUrl: e.target.value})} className="rounded-xl h-11" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTrackingModal({ open: false, order: null })}>Cancel</Button>
            <Button onClick={handleSaveTracking} disabled={!!isSubmitting} className="rounded-xl h-11 px-6 font-black uppercase tracking-widest bg-primary hover:bg-primary/90">
              {isSubmitting ? <Loader2 className="animate-spin h-4 w-4 mr-2"/> : <PackageCheck className="mr-2 h-4 w-4"/>}
              Save & Ship
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
