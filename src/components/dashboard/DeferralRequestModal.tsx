// src/components/dashboard/DeferralRequestModal.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Checkbox } from "@/components/ui/checkbox";
import { Label as CheckboxLabel } from "@/components/ui/label"; 
import { Loader2, RotateCcw, Clock, Info, CreditCard } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { AthleteRegisteredEventDetail, GlobalServiceFees, PricingBreakdown, PricingInput } from '@/lib/types';
import { PAYMENT_GATEWAY_FEE_PERCENTAGE, PLATFORM_FEE_PAISA, DEFERRAL_WINDOW_DAYS, GST_PERCENTAGE } from '@/lib/constants';
import { createDeferralFeeOrderAction, verifyDeferralFeePaymentAndProcessAction } from '@/lib/actions/paymentActions';
import { getServiceFeesAction } from '@/lib/actions/systemActions';
import { useAuth } from '@/context/AuthContext';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { calculatePricing } from '@/lib/pricingEngine';
import { useCountdown, CountdownTimeUnit } from '@/hooks/useCountdown';
import { subDays, format } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

const formatCurrencyLocal = (paisa: number | null | undefined, currency: 'INR' | 'USD' = 'INR') => {
  if (paisa === null || paisa === undefined) return currency === 'USD' ? '$0.00' : '₹0.00';
  const locale = currency === 'USD' ? 'en-US' : 'en-IN';
  const symbol = currency === 'USD' ? '$' : '₹';
  return `${symbol}${(paisa / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

interface DeferralRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventDetail: AthleteRegisteredEventDetail;
  onDeferralSuccess: () => void;
}

export default function DeferralRequestModal({ isOpen, onClose, eventDetail, onDeferralSuccess }: DeferralRequestModalProps) {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [feeBreakdown, setFeeBreakdown] = useState<PricingBreakdown | null>(null);
  const [isComputing, setIsComputing] = useState(true);
  const eventCurrency: 'INR' | 'USD' = eventDetail?.currency === 'USD' ? 'USD' : 'INR';

  const deadlineDate = useMemo(() => {
    if (!eventDetail?.eventDate) return null;
    return subDays(new Date(eventDetail.eventDate), DEFERRAL_WINDOW_DAYS);
  }, [eventDetail]);

  const countdown = useCountdown(deadlineDate ? format(deadlineDate, 'yyyy-MM-dd') : '');

  useEffect(() => {
    if (!isOpen || !eventDetail) return;
    setIsComputing(true);
    
    getServiceFeesAction().then(res => {
      const globalFees = (res.fees as GlobalServiceFees) || ({} as GlobalServiceFees);
      const isUsd = eventDetail.currency === 'USD';
      const categoryName = (eventDetail.ticketName || '').toUpperCase();
      const typeKey = categoryName.includes('SWIM') ? 'Swimming' : (categoryName.includes('DUATHLON') ? 'Duathlon' : 'Triathlon');
      const baseFee = isUsd
        ? ((globalFees as any)[typeKey]?.deferralFeeUsdCents ?? (globalFees as any)?.deferralFeeUsdCents ?? 5000)
        : ((globalFees as any)[typeKey]?.deferralFeePaisa ?? (globalFees as any)?.deferralFeePaisa ?? 200000);

      const pricingInput: PricingInput = {
        basePrice: baseFee,
        discount: 0,
        gatewayRate: isUsd ? 0.03 : (PAYMENT_GATEWAY_FEE_PERCENTAGE / 100),
        platformFeeBase: isUsd ? 0 : PLATFORM_FEE_PAISA,
        taxEnabled: !isUsd,
        gstRate: isUsd ? 0 : (GST_PERCENTAGE / 100),
        currency: isUsd ? 'USD' : 'INR',
      };
      setFeeBreakdown(calculatePricing(pricingInput));
      setIsComputing(false);
    });
  }, [isOpen, eventDetail]);

  const handleRequestDeferral = async () => {
    if (!agreedToTerms || !feeBreakdown || !currentUser) return;
    setIsLoading(true);
    try {
      const orderResult = await createDeferralFeeOrderAction({
        eventId: eventDetail.id,
        participantId: eventDetail.participantId!,
        athleteUid: currentUser.uid,
        athleteEmail: currentUser.email!,
        athleteName: currentUser.name || 'Athlete',
        totalAmountToChargePaisa: feeBreakdown.totalPayable,
        originUrl: window.location.origin,
      });

      if (!orderResult.success || !orderResult.orderId) throw new Error(orderResult.message);

      if (orderResult.paymentGateway === 'stripe') {
        if (!orderResult.checkoutUrl) throw new Error('Stripe checkout URL is missing.');
        window.location.assign(orderResult.checkoutUrl);
        return;
      }

      const rzp = new (window as any).Razorpay({
        key: orderResult.keyId, amount: orderResult.amount, currency: orderResult.currency,
        name: `Deferral Fee`, order_id: orderResult.orderId,
        handler: async (response: any) => {
            setIsLoading(true); 
            const verRes = await verifyDeferralFeePaymentAndProcessAction({
                ...response, ...(orderResult.notes || {}), 
            } as any);
            if (verRes.success) onDeferralSuccess();
            else toast({ variant: "destructive", title: "Error", description: verRes.message });
            setIsLoading(false);
        },
        prefill: { name: currentUser.name, email: currentUser.email, contact: currentUser.mobile },
        theme: { color: "#F97316" },
        modal: { 
            ondismiss: () => setIsLoading(false),
            escape: true,
            backdropclose: true
        }
      });
      rzp.open();
    } catch (e: any) {
      toast({ variant: "destructive", description: e.message });
      setIsLoading(false);
    }
  };

  const estimatedCreditPaisa = useMemo(() => {
    const paid =
      eventDetail.originalAmountPaidAtFirstRegistrationPaisa ??
      eventDetail.amountPaidPaisa;

    if (paid && paid > 0) return paid;

    const base = eventDetail.pricingBreakdown?.base ?? eventDetail.basePricePaisa ?? 0;
    const discount = eventDetail.pricingBreakdown?.discount ?? eventDetail.couponDiscountPaisa ?? 0;

    return Math.max(0, base - discount);
  }, [eventDetail]);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isLoading && onClose()} modal={!isLoading}>
      <DialogContent 
        className="sm:max-w-md text-left rounded-2xl border-none shadow-2xl p-0 overflow-hidden"
        onPointerDownOutside={(e) => { if (isLoading) e.preventDefault(); }}
        onInteractOutside={(e) => { if (isLoading) e.preventDefault(); }}
      >
        <DialogHeader className="px-6 pt-6 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2 text-orange-600 text-left text-lg font-black uppercase italic tracking-tighter">
            <RotateCcw className="h-5 w-5" /> Request Deferral
          </DialogTitle>
          <DialogDescription className="text-left text-xs font-medium">
            Moving <strong>{eventDetail.eventName}</strong> to next season.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] px-6">
          <div className="space-y-4 py-4 text-left">
            {deadlineDate && countdown && !countdown.isPast && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-center">
                <p className="text-[10px] font-black uppercase text-destructive tracking-widest mb-2 text-center leading-none">Time remaining to defer:</p>
                <div className="flex justify-center gap-2 text-destructive">
                  <CountdownTimeUnit value={countdown.days} label="Days"/>
                  <CountdownTimeUnit value={countdown.hours} label="Hrs"/>
                  <CountdownTimeUnit value={countdown.minutes} label="Min"/>
                  <CountdownTimeUnit value={countdown.seconds} label="Sec"/>
                </div>
              </div>
            )}

            <Alert className="bg-amber-50 border-amber-200 text-amber-800 p-3 rounded-xl">
              <Info className="h-4 w-4" />
              <AlertTitle className="text-xs font-bold uppercase tracking-tight text-left">Future Race Credit</AlertTitle>
              <AlertDescription className="mt-0.5 text-[10px] font-medium text-left">
                You will receive a credit of <strong>{formatCurrencyLocal(estimatedCreditPaisa, eventCurrency)}</strong> valid for next season.
              </AlertDescription>
            </Alert>

            <div className="space-y-2 text-left">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Service Fee Breakdown</h4>
              {isComputing ? <div className="flex justify-center py-2 text-left"><Loader2 className="animate-spin h-5 w-5 text-primary"/></div> : feeBreakdown && (
                <div className="bg-muted/30 p-4 rounded-2xl space-y-1 text-xs border border-border/50 text-left shadow-inner">
                  <div className="flex justify-between font-bold uppercase tracking-tight text-left"><span>Processing Base</span><span>{formatCurrencyLocal(feeBreakdown.base, eventCurrency)}</span></div>
                  <div className="flex justify-between text-[10px] text-muted-foreground text-left"><span>Platform & Processing</span><span>{formatCurrencyLocal(feeBreakdown.platformFeeBase + feeBreakdown.processingFeeBase, eventCurrency)}</span></div>
                  <div className="flex justify-between text-[10px] text-muted-foreground text-left"><span>Consolidated GST ({GST_PERCENTAGE}%)</span><span>{formatCurrencyLocal(feeBreakdown.platformGST + feeBreakdown.processingGST + feeBreakdown.eventGST, eventCurrency)}</span></div>
                  <Separator className="my-2" />
                  <div className="flex justify-between font-black text-primary text-lg italic tracking-tighter text-left">
                    <span>Total Service Fee</span>
                    <span>{formatCurrencyLocal(feeBreakdown.totalPayable, eventCurrency)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 bg-muted/20 border rounded-xl text-[10px] text-muted-foreground leading-relaxed text-left">
              <h4 className="font-black uppercase text-foreground text-left mb-1">Deferral Policy</h4>
              <ul className="list-disc pl-4 space-y-0.5 font-medium text-left">
                <li>Valid for one year from original date.</li>
                <li>Single-use credit only.</li>
                <li>Pay price difference at future registration.</li>
                <li>Strictly non-refundable.</li>
              </ul>
            </div>

            <div className="flex items-start space-x-3 pt-1 text-left">
              <Checkbox id="def-terms" onCheckedChange={(v) => setAgreedToTerms(!!v)}/>
              <CheckboxLabel htmlFor="def-terms" className="text-[10px] text-muted-foreground font-black uppercase tracking-tight leading-tight cursor-pointer text-left">
                I agree to the Deferral Policy and non-refundable service fee.
              </CheckboxLabel>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="px-6 py-4 border-t text-left">
          <Button 
            onClick={handleRequestDeferral} 
            disabled={isLoading || !agreedToTerms || isComputing} 
            className="w-full h-12 rounded-xl bg-orange-600 hover:bg-orange-700 font-black uppercase tracking-widest text-white shadow-xl shadow-orange-600/20 text-left"
          >
            {isLoading ? <Loader2 className="mr-3 h-5 w-5 animate-spin"/> : <CreditCard className="mr-3 h-5 w-5"/>}
            {isLoading ? "Awaiting Payment..." : "Authorize & Pay Fee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
