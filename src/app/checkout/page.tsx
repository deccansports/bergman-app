// src/app/checkout/page.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { useCart } from '@/context/StoreCartContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { 
    Loader2, ShoppingBag, ShieldCheck, ArrowLeft, 
    CreditCard, MapPin, Truck, CheckCircle2, Ticket,
    User, Smartphone, Mail, Building, Trash2
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function CheckoutPage() {
  const { cart, subtotal, totalCount, clearCart } = useCart();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [shippingSettings, setSettings] = useState({ minAmountFreeShipping: 2499, standardShipping: 150 });

  const [form, setForm] = useState({
    name: currentUser?.name || '',
    email: currentUser?.email || '',
    mobile: currentUser?.mobile || '',
    address: currentUser?.address || '',
    city: currentUser?.city || '',
    state: currentUser?.state || '',
    pincode: currentUser?.pincode || '',
  });

  useEffect(() => {
    fetch('/api/store/settings').then(r => r.json()).then(data => {
      if (data.success) setSettings(data.settings);
    });
  }, []);

  const shippingFee = subtotal >= shippingSettings.minAmountFreeShipping ? 0 : shippingSettings.standardShipping;
  const discountAmount = appliedCoupon ? (appliedCoupon.type === 'percentage' ? Math.round(subtotal * appliedCoupon.value / 100) : appliedCoupon.value) : 0;
  const grandTotal = subtotal - discountAmount + shippingFee;

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/store/validate-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode, subtotal })
      });
      const data = await res.json();
      if (data.success) {
        setAppliedCoupon(data.coupon);
        toast({ title: "Coupon Applied", description: `You saved ₹${data.coupon.type === 'percentage' ? `${data.coupon.value}%` : `₹${data.coupon.value}`}` });
      } else {
        toast({ variant: 'destructive', title: "Invalid Coupon", description: data.message });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.mobile || !form.address) {
      toast({ variant: 'destructive', title: "Incomplete Details", description: "Please fill in all shipping fields." });
      return;
    }

    setIsProcessing(true);
    try {
      const orderRes = await fetch('/api/store/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart,
          customer: form,
          couponCode: appliedCoupon?.code,
          userId: currentUser?.uid
        })
      });

      const orderData = await orderRes.json();
      if (!orderData.success) throw new Error(orderData.message);

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: orderData.amount,
        currency: "INR",
        name: "Bergman Store",
        description: `Order for ${form.name}`,
        order_id: orderData.orderId,
        handler: async (response: any) => {
          toast({ title: "Payment Successful", description: "Your order has been placed. Redirecting..." });
          clearCart();
          router.push('/orders');
        },
        prefill: {
          name: form.name,
          email: form.email,
          contact: form.mobile
        },
        theme: { color: "#2962FF" },
        modal: { ondismiss: () => setIsProcessing(false) }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err: any) {
      toast({ variant: 'destructive', title: "Checkout Error", description: err.message });
      setIsProcessing(false);
    }
  };

  if (cart.length === 0) {
    if (typeof window !== 'undefined') router.push('/shop');
    return null;
  }

  return (
    <div className="container mx-auto py-12 px-4 max-w-6xl text-left">
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-10 gap-4 text-left">
        <div className="space-y-1 text-left">
          <h1 className="text-4xl md:text-5xl font-black uppercase italic tracking-tighter text-left">Secure Checkout</h1>
          <p className="text-muted-foreground font-bold uppercase tracking-widest text-[10px]">Complete your order</p>
        </div>
        <Button variant="ghost" onClick={() => router.back()} className="font-bold uppercase text-[10px] tracking-widest h-8 px-4 rounded-xl border border-border">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Modify Bag
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start text-left">
        
        {/* FORM SECTION */}
        <div className="lg:col-span-7 space-y-8 text-left">
          <Card className="border-none shadow-xl rounded-[2.5rem] overflow-hidden text-left">
            <CardHeader className="bg-muted/30 p-8 border-b border-border/50 text-left">
              <CardTitle className="text-xl font-black uppercase tracking-widest flex items-center gap-3 text-left">
                <MapPin className="h-6 w-6 text-primary" /> 
                1. Shipping Logistics
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 text-left">
              <form id="checkout-form" onSubmit={handleCheckout} className="space-y-6 text-left">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                  <div className="space-y-2 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Full Name*</Label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                        <Input required placeholder="Recipient name" className="pl-10 h-11 rounded-xl font-bold" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                    </div>
                  </div>
                  <div className="space-y-2 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Contact Number*</Label>
                    <div className="relative">
                        <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                        <Input required placeholder="10-digit mobile" className="pl-10 h-11 rounded-xl font-bold" value={form.mobile} onChange={e => setForm({...form, mobile: e.target.value})} />
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-left">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Email Address*</Label>
                  <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                      <Input required type="email" placeholder="Order updates will be sent here" className="pl-10 h-11 rounded-xl lowercase font-bold" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
                  </div>
                </div>

                <div className="space-y-2 text-left">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Delivery Address*</Label>
                  <Textarea required placeholder="House No, Street, Landmark..." className="rounded-xl min-h-[100px] font-medium" value={form.address} onChange={e => setForm({...form, address: e.target.value})} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                  <div className="space-y-2 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">City*</Label>
                    <Input required placeholder="City" className="h-11 rounded-xl font-bold" value={form.city} onChange={e => setForm({...form, city: e.target.value})} />
                  </div>
                  <div className="space-y-2 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">State*</Label>
                    <Input required placeholder="State" className="h-11 rounded-xl font-bold" value={form.state} onChange={e => setForm({...form, state: e.target.value})} />
                  </div>
                  <div className="space-y-2 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pincode*</Label>
                    <Input required placeholder="6-digit" className="h-11 rounded-xl font-bold font-mono" value={form.pincode} onChange={e => setForm({...form, pincode: e.target.value})} />
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
          
          <div className="p-6 bg-primary/5 rounded-[2.5rem] border border-primary/10 flex items-start gap-4 text-left">
              <ShieldCheck className="h-6 w-6 text-primary shrink-0" />
              <div className="text-left">
                  <p className="font-black uppercase tracking-tight text-sm text-left">Standard Shipping Verified</p>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest leading-relaxed text-left">All products are shipped within 5-7 business days via trackable courier partners. A tracking link will be sent to your email.</p>
              </div>
          </div>
        </div>

        {/* SIDEBAR: SUMMARY & PAYMENT */}
        <div className="lg:col-span-5 text-left">
          <div className="sticky top-24 space-y-6 text-left">
            <Card className="border-none shadow-2xl rounded-[2.5rem] overflow-hidden bg-slate-900 text-white text-left">
              <CardHeader className="bg-white/5 p-8 border-b border-white/10 text-left">
                <CardTitle className="text-xl font-black uppercase tracking-widest flex items-center gap-3 text-left">
                    <ShoppingBag className="h-5 w-5 text-orange-500" />
                    Review Order
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8 space-y-6 text-left">
                
                {/* ITEMS MINI LIST */}
                <ScrollArea className="max-h-40 pr-4 -mr-4 text-left">
                    <div className="space-y-3 text-left">
                        {cart.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center text-left">
                                <div className="text-left">
                                    <p className="font-bold text-sm leading-tight text-white uppercase tracking-tight">{item.name}</p>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase">Qty: {item.quantity} • Size: {item.size}</p>
                                </div>
                                <span className="font-black text-slate-300 ml-4">₹{item.salePrice * item.quantity}</span>
                            </div>
                        ))}
                    </div>
                </ScrollArea>

                <Separator className="bg-white/10" />

                {/* COUPON */}
                <div className="space-y-3 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 text-left">Apply Coupon</Label>
                    <div className="flex gap-2 text-left">
                        <Input 
                            placeholder="Enter Code..." 
                            className="bg-white/5 border-white/10 text-white font-black tracking-widest placeholder:text-slate-600 rounded-xl h-11"
                            value={couponCode}
                            onChange={e => setCouponCode(e.target.value.toUpperCase())}
                            disabled={!!appliedCoupon}
                        />
                        <Button 
                            type="button" 
                            variant="secondary" 
                            className="h-11 rounded-xl px-6 font-black uppercase text-[10px] tracking-widest border border-white/10"
                            onClick={handleApplyCoupon}
                            disabled={loading || !!appliedCoupon || !couponCode}
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Apply'}
                        </Button>
                    </div>
                    {appliedCoupon && (
                        <div className="flex items-center justify-between bg-green-500/10 border border-green-500/20 p-2 rounded-lg">
                            <span className="text-[10px] font-black text-green-400 uppercase tracking-widest">PROMO APPLIED: {appliedCoupon.code}</span>
                            <button onClick={() => { setAppliedCoupon(null); setCouponCode(''); }} className="text-green-400 hover:text-white transition-colors">
                                <Trash2 className="h-3 w-3" />
                            </button>
                        </div>
                    )}
                </div>

                <div className="space-y-3 pt-2 text-left">
                    <div className="flex justify-between text-xs text-slate-400 font-bold uppercase tracking-widest text-left">
                        <span>Bag Subtotal</span>
                        <span className="text-white">₹{subtotal}</span>
                    </div>
                    {discountAmount > 0 && (
                        <div className="flex justify-between text-xs text-green-400 font-bold uppercase tracking-widest text-left">
                            <span>Coupon Savings</span>
                            <span>- ₹{discountAmount}</span>
                        </div>
                    )}
                    <div className="flex justify-between text-xs text-slate-400 font-bold uppercase tracking-widest text-left">
                        <span>Fulfillment (Shipping)</span>
                        <span className={cn(shippingFee === 0 ? "text-green-400" : "text-white")}>
                            {shippingFee === 0 ? "FREE" : `₹${shippingFee}`}
                        </span>
                    </div>
                    <Separator className="bg-white/10" />
                    <div className="flex justify-between items-end pt-2 text-left">
                        <div className="text-left">
                            <p className="text-[10px] font-black uppercase text-orange-500 tracking-widest leading-none">Amount to Pay</p>
                            <p className="text-5xl font-black text-white italic tracking-tighter mt-1">₹{grandTotal}</p>
                        </div>
                    </div>
                </div>

                <Button 
                  form="checkout-form"
                  type="submit"
                  disabled={isProcessing}
                  className="w-full h-16 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-base shadow-2xl shadow-primary/30 mt-4 group"
                >
                  {isProcessing ? <><Loader2 className="mr-3 h-6 w-6 animate-spin"/> Processing...</> : <><CreditCard className="mr-3 h-6 w-6 group-hover:scale-110 transition-transform" /> Confirm & Pay</>}
                </Button>
              </CardContent>
              <CardFooter className="bg-black/20 p-6 flex flex-col gap-3 text-left">
                <div className="flex items-center gap-3 text-[9px] font-bold text-slate-500 uppercase tracking-widest text-left">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    STOCK VERIFIED & RESERVED FOR 10 MINS
                </div>
                <div className="flex items-center gap-3 text-[9px] font-bold text-slate-500 uppercase tracking-widest text-left">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    RAZORPAY SECURE PAYMENT GATEWAY
                </div>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
