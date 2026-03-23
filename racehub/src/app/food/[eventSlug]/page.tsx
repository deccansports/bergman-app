// src/app/food/[eventSlug]/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Script from 'next/script';
import { useToast } from '@/hooks/use-toast';
import { getEventByFoodSlugAction } from '@/lib/actions/eventActions';
import { getPaidFoodItemsAction, createPaidFoodOrderAction } from '@/lib/actions/paidFoodActions';
import type { EventCalendarEntry, PaidFoodItem, PaidFoodCoupon } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Loader2, UtensilsCrossed, Minus, Plus, ShoppingCart, ArrowLeft, CheckCircle, Info } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { internationalMobileRegex } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

declare global {
  interface Window {
    Razorpay: any;
  }
}

const OrderItemSchema = z.object({
  itemId: z.string(),
  quantity: z.number().int().min(0),
});

const FoodPurchaseSchema = z.object({
  buyerName: z.string().min(2, "Name is required."),
  buyerEmail: z.string().email("A valid email is required."),
  buyerMobile: z.string().regex(internationalMobileRegex, "Please enter a valid mobile number."),
  items: z.array(OrderItemSchema).refine(items => items.some(item => item.quantity > 0), {
    message: "You must select at least one item."
  }),
});

type FoodPurchaseFormInput = z.infer<typeof FoodPurchaseSchema>;

export default function FoodPurchasePage() {
  const params = useParams();
  const eventSlug = params.eventSlug as string;
  const router = useRouter();
  const { toast } = useToast();

  const [eventDetails, setEventDetails] = useState<EventCalendarEntry | null>(null);
  const [foodItems, setFoodItems] = useState<PaidFoodItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderSuccessData, setOrderSuccessData] = useState<{ orderId: string } | null>(null);


  const form = useForm<FoodPurchaseFormInput>({
    resolver: zodResolver(FoodPurchaseSchema),
    defaultValues: {
      buyerName: '',
      buyerEmail: '',
      buyerMobile: '',
      items: [],
    },
  });

  const { fields, update } = useFieldArray({
    control: form.control,
    name: "items",
    keyName: "key",
  });

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const eventResult = await getEventByFoodSlugAction(eventSlug);

        if (!eventResult.success || !eventResult.event) {
          toast({ variant: 'destructive', title: 'Error', description: 'Event not found.' });
          router.push('/');
          return;
        }
        
        setEventDetails(eventResult.event);
        const currentEventId = eventResult.event.id;

        const itemsResult = await getPaidFoodItemsAction();
        if (itemsResult.success && itemsResult.items) {
          const applicableItems = itemsResult.items.filter((item: PaidFoodItem) => 
            item.isActive && (item.applicableEventIds.length === 0 || item.applicableEventIds.includes(currentEventId))
          );
          setFoodItems(applicableItems);
          form.reset({
            ...form.getValues(),
            items: applicableItems.map((item: PaidFoodItem) => ({ itemId: item.id, quantity: 0 })),
          });
        }
      } catch (error) {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to load data.' });
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [eventSlug, router, toast, form]);
  
  const watchedItems = form.watch("items");

  const orderSummary = useMemo(() => {
    let subtotal = 0;
    const itemsInOrder = watchedItems.map((watchedItem) => {
      const itemDetails = foodItems.find(fi => fi.id === watchedItem.itemId);
      if (!itemDetails || watchedItem.quantity === 0) return null;
      const itemTotal = itemDetails.price * watchedItem.quantity;
      subtotal += itemTotal;
      return { ...itemDetails, quantity: watchedItem.quantity, itemTotal };
    }).filter(Boolean);
    
    // For now, tax calculation is simplified. A more robust solution would aggregate by tax rate.
    const tax = subtotal * ((foodItems[0]?.taxPercentage || 0) / 100);
    const total = subtotal + tax;

    return { itemsInOrder, subtotal, tax, total };
  }, [watchedItems, foodItems]);
  
  const handleQuantityChange = (index: number, change: number) => {
    const currentQuantity = fields[index].quantity;
    const newQuantity = Math.max(0, currentQuantity + change);
    const maxPerOrder = foodItems.find(item => item.id === fields[index].itemId)?.maxPerOrder || 10;
    update(index, { ...fields[index], quantity: Math.min(newQuantity, maxPerOrder) });
  };
  
  const onSubmit = async (data: FoodPurchaseFormInput) => {
      setIsSubmitting(true);
      try {
        const orderInput = {
            ...data,
            eventId: eventDetails?.id || null,
            totalAmountPaisa: orderSummary.total,
        };
        const orderResult = await createPaidFoodOrderAction(orderInput);

        if (!orderResult.success || !orderResult.razorpayOrder) {
          toast({ variant: 'destructive', title: 'Order Error', description: orderResult.message || 'Could not create payment order.' });
          setIsSubmitting(false);
          return;
        }

        const rzp = new window.Razorpay({
            key: orderResult.razorpayKeyId,
            amount: orderResult.razorpayOrder.amount,
            currency: orderResult.razorpayOrder.currency,
            name: `${'${eventDetails?.eventName}'} - Food Purchase`,
            order_id: orderResult.razorpayOrder.id,
            handler: async (response: any) => {
                // Verification is handled by webhook, here we just show success
                setOrderSuccessData({
                    orderId: orderResult.orderId!,
                });
            },
            prefill: { name: data.buyerName, email: data.buyerEmail, contact: data.buyerMobile },
            notes: orderResult.razorpayOrder.notes,
            theme: { color: "#2563EB" },
            modal: { ondismiss: () => setIsSubmitting(false) }
        });
        rzp.open();

      } catch(e: any) {
          toast({ variant: 'destructive', title: 'Error', description: e.message });
          setIsSubmitting(false);
      }
  };

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }
  
  if (orderSuccessData) {
      return (
          <div className="flex flex-col min-h-screen">
              <AppHeader />
              <main className="flex-grow container mx-auto py-8 px-4 flex items-center justify-center">
                  <Card className="w-full max-w-lg text-center shadow-lg">
                      <CardHeader className="bg-green-100">
                          <CheckCircle className="h-12 w-12 text-green-600 mx-auto"/>
                          <CardTitle className="text-green-700">Order Successful!</CardTitle>
                          <CardDescription>Your order has been placed. You will receive your redemption coupons via WhatsApp and Email shortly.</CardDescription>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                           <p className="text-muted-foreground">Order ID: <span className="font-mono">{orderSuccessData.orderId}</span></p>
                           <Alert>
                            <Info className="h-4 w-4" />
                            <AlertTitle>Important!</AlertTitle>
                            <AlertDescription>
                                Please keep your Order ID safe. You will need it if you have any issues with your order.
                            </AlertDescription>
                          </Alert>
                      </CardContent>
                      <CardFooter>
                          <Button className="w-full" onClick={() => router.push('/')}>Go to Homepage</Button>
                      </CardFooter>
                  </Card>
              </main>
          </div>
      )
  }

  return (
    <>
      <Script
        id="razorpay-checkout-js-food"
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
      />
      <div className="flex flex-col min-h-screen">
        <AppHeader />
        <main className="flex-grow container mx-auto py-8 px-4">
          <Button variant="outline" size="sm" onClick={() => router.back()} className="mb-4">
              <ArrowLeft className="h-4 w-4 mr-2"/> Back
          </Button>
          <Card className="max-w-4xl mx-auto">
            <CardHeader className="text-center">
              <UtensilsCrossed className="h-8 w-8 mx-auto text-primary mb-2"/>
              <CardTitle>Food Purchase for {eventDetails?.eventName}</CardTitle>
              <CardDescription>Pre-order food for your family and friends.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="grid md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                          <h3 className="font-semibold text-lg">1. Your Details</h3>
                          <FormField control={form.control} name="buyerName" render={({ field }) => (<FormItem><FormLabel>Full Name</FormLabel><Input {...field} placeholder="Your Name" disabled={isSubmitting} /><FormMessage /></FormItem>)}/>
                          <FormField control={form.control} name="buyerEmail" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><Input {...field} type="email" placeholder="you@example.com" disabled={isSubmitting} /><FormMessage /></FormItem>)}/>
                          <FormField control={form.control} name="buyerMobile" render={({ field }) => (<FormItem><FormLabel>Mobile Number</FormLabel><Input {...field} type="tel" placeholder="+91..." disabled={isSubmitting} /><FormMessage /></FormItem>)}/>
                          
                          <h3 className="font-semibold text-lg pt-4">2. Select Items</h3>
                          <div className="space-y-3">
                              {fields.map((field, index) => {
                                  const itemDetails = foodItems.find(i => i.id === field.itemId);
                                  if (!itemDetails) return null;
                                  return (
                                      <div key={field.key} className="flex items-center justify-between p-3 border rounded-md">
                                          <div>
                                              <p className="font-medium">{itemDetails.name} <span className="text-xs text-muted-foreground">({itemDetails.isVeg ? 'Veg' : 'Non-Veg'})</span></p>
                                              <p className="text-sm font-bold text-primary">₹{(itemDetails.price/100).toFixed(2)}</p>
                                          </div>
                                          <div className="flex items-center gap-2">
                                              <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => handleQuantityChange(index, -1)} disabled={isSubmitting}><Minus className="h-4 w-4"/></Button>
                                              <span className="w-8 text-center font-bold text-lg">{watchedItems[index]?.quantity}</span>
                                              <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => handleQuantityChange(index, 1)} disabled={isSubmitting}><Plus className="h-4 w-4"/></Button>
                                          </div>
                                      </div>
                                  )
                              })}
                          </div>
                      </div>

                      <div className="space-y-4">
                          <h3 className="font-semibold text-lg">3. Order Summary</h3>
                          <Card className="bg-muted/50">
                              <CardContent className="p-4 space-y-2">
                                  {orderSummary.itemsInOrder.length > 0 ? (
                                      orderSummary.itemsInOrder.map((item, idx) => (
                                          item && <div key={idx} className="flex justify-between text-sm">
                                              <span>{item.name} x {item.quantity}</span>
                                              <span>₹{(item.itemTotal/100).toFixed(2)}</span>
                                          </div>
                                      ))
                                  ) : (
                                      <p className="text-sm text-muted-foreground">Select items to see your order summary.</p>
                                  )}
                                  <Separator />
                                  <div className="flex justify-between text-sm">
                                      <span className="text-muted-foreground">Subtotal</span>
                                      <span>₹{(orderSummary.subtotal/100).toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between text-sm">
                                      <span className="text-muted-foreground">Taxes</span>
                                      <span>₹{(orderSummary.tax/100).toFixed(2)}</span>
                                  </div>
                                  <Separator />
                                  <div className="flex justify-between font-bold text-lg">
                                      <span>Total</span>
                                      <span>₹{(orderSummary.total/100).toFixed(2)}</span>
                                  </div>
                                  <Button className="w-full mt-4" type="submit" disabled={isLoading || isSubmitting || orderSummary.total <= 0}>
                                      {isSubmitting ? <Loader2 className="animate-spin mr-2"/> : <ShoppingCart className="mr-2"/>}
                                      Proceed to Pay
                                  </Button>
                              </CardContent>
                          </Card>
                      </div>
                  </form>
              </Form>
            </CardContent>
          </Card>
        </main>
      </div>
    </>
  );
}
