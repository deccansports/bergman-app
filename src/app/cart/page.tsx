// src/app/cart/page.tsx
"use client";

import React from 'react';
import { useCart } from '@/context/StoreCartContext';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShoppingBag, ArrowLeft, Trash2, Plus, Minus, ArrowRight, Package, CreditCard, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';

export default function CartPage() {
  const { cart, subtotal, totalCount, removeFromCart, updateQty } = useCart();
  const router = useRouter();

  if (cart.length === 0) {
    return (
      <div className="container mx-auto py-24 px-4 text-center space-y-6">
        <div className="h-24 w-24 bg-muted rounded-full flex items-center justify-center mx-auto mb-6 opacity-50">
          <ShoppingBag className="h-12 w-12 text-muted-foreground" />
        </div>
        <h1 className="text-4xl font-black uppercase italic tracking-tighter">Your Gear Bag is Empty</h1>
        <p className="text-muted-foreground font-medium max-w-sm mx-auto">It looks like you haven&apos;t added any performance gear to your bag yet.</p>
        <Button asChild className="rounded-xl h-12 px-10 font-black uppercase tracking-widest shadow-xl">
          <Link href="/shop">Start Shopping</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-12 px-4 text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 gap-4 text-left">
        <div className="text-left space-y-1">
          <h1 className="text-4xl md:text-5xl font-black uppercase italic tracking-tighter text-left">Review Your Bag</h1>
          <p className="text-muted-foreground font-bold uppercase tracking-widest text-[10px]">
            Ready to checkout with {totalCount} item(s)
          </p>
        </div>
        <Button variant="ghost" asChild className="font-bold uppercase text-xs tracking-widest text-muted-foreground hover:text-primary">
          <Link href="/shop"><ArrowLeft className="mr-2 h-4 w-4"/> Continue Shopping</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-left">
        
        {/* CART LIST */}
        <div className="lg:col-span-8 space-y-4 text-left">
          {cart.map((item) => (
            <Card key={`${item.productId}-${item.size}`} className="border-none shadow-xl rounded-3xl overflow-hidden bg-card group text-left">
              <CardContent className="p-6 sm:p-8 flex gap-6 text-left">
                <div className="relative h-32 w-24 sm:h-40 sm:w-32 rounded-2xl overflow-hidden bg-muted border shrink-0">
                  <Image src={item.image} alt={item.name} fill sizes="120px" className="object-cover transition-transform duration-500 group-hover:scale-110" />
                </div>
                
                <div className="flex-grow flex flex-col justify-between py-1 text-left">
                  <div className="space-y-1 text-left">
                    <div className="flex justify-between items-start text-left">
                      <h3 className="font-black text-lg sm:text-xl uppercase tracking-tight leading-tight text-left pr-4">{item.name}</h3>
                      <p className="font-black text-xl italic text-primary tracking-tighter">₹{item.salePrice * item.quantity}</p>
                    </div>
                    <div className="flex items-center gap-3 pt-2 text-left">
                      <Badge variant="secondary" className="font-black uppercase text-[10px] h-5 px-2">Size: {item.size}</Badge>
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">₹{item.salePrice} / unit</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/50 text-left">
                    <div className="flex items-center bg-muted/30 rounded-xl p-1 border border-border/50 text-left">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 hover:bg-background"
                        onClick={() => updateQty(item.productId, item.size, item.quantity - 1)}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="w-10 text-center font-black text-sm">{item.quantity}</span>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 hover:bg-background"
                        onClick={() => updateQty(item.productId, item.size, item.quantity + 1)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 font-bold uppercase text-[10px] tracking-widest h-10 px-4 rounded-xl"
                      onClick={() => removeFromCart(item.productId, item.size)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Remove
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* SUMMARY */}
        <div className="lg:col-span-4 text-left">
          <div className="sticky top-24 space-y-6 text-left">
            <Card className="border-none shadow-2xl rounded-[2.5rem] overflow-hidden bg-slate-900 text-white text-left">
              <CardHeader className="bg-white/5 p-8 border-b border-white/10 text-left">
                <CardTitle className="text-xl font-black uppercase tracking-widest text-left italic">Bag Summary</CardTitle>
              </CardHeader>
              <CardContent className="p-8 space-y-4 text-left">
                <div className="flex justify-between text-xs text-slate-400 font-bold uppercase tracking-widest text-left">
                  <span>Subtotal ({totalCount} items)</span>
                  <span className="text-white">₹{subtotal}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-400 font-bold uppercase tracking-widest text-left">
                  <span>Shipping</span>
                  <span className="text-green-400">Calculated at next step</span>
                </div>
                <Separator className="bg-white/10" />
                <div className="flex justify-between items-end pt-2 text-left">
                  <div className="text-left">
                    <p className="text-[10px] font-black uppercase text-primary tracking-widest leading-none">Net Total</p>
                    <p className="text-4xl font-black text-white italic tracking-tighter mt-1">₹{subtotal}</p>
                  </div>
                </div>
                
                <Button 
                  asChild
                  className="w-full h-16 rounded-2xl bg-orange-600 hover:bg-orange-700 text-white font-black uppercase tracking-widest text-base shadow-xl shadow-orange-600/30 mt-6"
                >
                  <Link href="/checkout">
                    Checkout Now <ArrowRight className="ml-2 h-6 w-6" />
                  </Link>
                </Button>
              </CardContent>
              <CardFooter className="bg-black/20 p-6 flex flex-col gap-3 text-left">
                <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-left">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    SECURE 256-BIT ENCRYPTED CHECKOUT
                </div>
                <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-left">
                    <Package className="h-4 w-4 text-primary" />
                    GST COMPLIANT TAX INVOICE PROVIDED
                </div>
              </CardFooter>
            </Card>
            
            <div className="p-6 bg-primary/5 rounded-[2rem] border border-primary/10 text-left">
                <div className="flex items-center gap-3 mb-2 text-left">
                    <CreditCard className="h-5 w-5 text-primary" />
                    <h4 className="font-black uppercase text-xs tracking-tight text-left">Payment Methods</h4>
                </div>
                <p className="text-[10px] text-muted-foreground font-medium leading-relaxed text-left">We accept UPI, Credit/Debit Cards, and Net Banking via Razorpay secure gateway.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
